import {
	type Agent,
	type Checkpoint,
	type Machine,
	type MachineAccess,
	MachineCreate,
	type MachineCreate as MachineCreateInput,
	type MachineSpecs,
	MachineUpdate,
	type MachineUpdate as MachineUpdateInput,
} from "@sekai/shared";
import { and, eq } from "drizzle-orm";
import { currentActor, requirePermission } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { agentOwner } from "../events/scope.ts";
import { badRequest, errorMessage, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { randomPassword, sealJson, unsealJson } from "../lib/secrets.ts";
import { getAgent } from "../services/agents.ts";
import { effectiveTimezone, getSettings } from "../services/settings.ts";
import { requireOwnAgent } from "../services/visibility.ts";
import { BridgeDesktop, type DeviceHello, isDeviceOnline, revokeDevice, setBridgeHooks } from "./bridge.ts";
import {
	computerUserData,
	desktopHelper,
	devboxSetupScript,
	installHelperScript,
	metaData,
	PROGRESS_FILE,
	READY_FILE,
} from "./cloudinit.ts";
import { Desktop, type DesktopControl } from "./desktop.ts";
import { seedIso } from "./iso.ts";
import { agentKeyFile, agentKeypair, hostnameFor, linuxUsername } from "./keys.ts";
import { DEBIAN_IMAGE, ForeignVmError, ProxmoxClient, ProxmoxError, permissionHelp, pickAddresses } from "./proxmox.ts";
import { type SshTarget, sshExec, sshForget, sshReachable, sshText } from "./ssh.ts";
import { machineAuthKey } from "./tailscale.ts";

/**
 * Bots' machines: their own computer (a Proxmox VM with a desktop) and devboxes (temporary containers).
 * Creating one returns right away; setup continues in the background and status updates stream to the app.
 */

type Row = typeof schema.machines.$inferSelect;
interface Secrets {
	userPassword: string;
	rootPassword: string;
	vncPassword: string | null;
}

const PROVISION_TIMEOUT_MS = 45 * 60_000;

function toMachine(row: Row): Machine {
	const { secrets: _secrets, ...rest } = row;
	return rest;
}

async function patch(id: string, fields: Partial<Row>): Promise<Machine | null> {
	await db
		.update(schema.machines)
		.set({ ...fields, updatedAt: Date.now() })
		.where(eq(schema.machines.id, id));
	const row = await db.query.machines.findFirst({ where: eq(schema.machines.id, id) });
	if (!row) return null;
	const machine = toMachine(row);
	bus.emit({ type: "machine.changed", machine });
	return machine;
}

const detail = (id: string, statusDetail: string, status?: Machine["status"]) =>
	patch(id, status ? { statusDetail, status } : { statusDetail });

// ---------------------------------------------------------------- queries

/**
 * A bot's computers are its owner's: nobody else sees or controls them (not even someone it's shared with).
 * Sekai itself sees them all.
 */
export async function listMachines(filter: { agentId?: string } = {}): Promise<Machine[]> {
	const me = currentActor()?.userId;
	const rows = me
		? (
				await db
					.select({ m: schema.machines })
					.from(schema.machines)
					.innerJoin(schema.agents, eq(schema.agents.id, schema.machines.agentId))
					.where(
						and(
							eq(schema.agents.userId, me),
							filter.agentId ? eq(schema.machines.agentId, filter.agentId) : undefined,
						),
					)
			).map((r) => r.m)
		: await db
				.select()
				.from(schema.machines)
				.where(filter.agentId ? eq(schema.machines.agentId, filter.agentId) : undefined);
	return rows.map(toMachine).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getMachine(id: string): Promise<Machine | null> {
	const row = await db.query.machines.findFirst({ where: eq(schema.machines.id, id) });
	if (!row) return null;
	const me = currentActor()?.userId;
	if (me && (await agentOwner(row.agentId)) !== me) return null;
	return toMachine(row);
}

export async function requireMachine(id: string): Promise<Machine> {
	const m = await getMachine(id);
	if (!m) throw notFound("Machine");
	return m;
}

/** The bot's computer, if it has one. */
export async function computerOf(agentId: string): Promise<Machine | null> {
	const row = await db.query.machines.findFirst({
		where: and(eq(schema.machines.agentId, agentId), eq(schema.machines.kind, "computer")),
	});
	return row ? toMachine(row) : null;
}

/** A machine of this bot by id, name or hostname ("computer" means its computer). */
export async function findMachine(agentId: string, ref?: string | null): Promise<Machine | null> {
	const all = await listMachines({ agentId });
	if (!ref || ref === "computer") return all.find((m) => m.kind === "computer") ?? null;
	const r = ref.toLowerCase();
	return all.find((m) => m.id === ref || m.name.toLowerCase() === r || m.hostname === r) ?? null;
}

export async function machineAccess(id: string): Promise<MachineAccess> {
	const row = await db.query.machines.findFirst({ where: eq(schema.machines.id, id) });
	if (!row) throw notFound("Machine");
	const agent = await getAgent(row.agentId);
	const keys = await agentKeypair(row.agentId, agent?.name ?? "bot");
	const s = unsealJson<Secrets>(row.secrets);
	return {
		machineId: row.id,
		username: row.username,
		userPassword: s.userPassword,
		rootPassword: s.rootPassword,
		vncPassword: s.vncPassword,
		publicKey: keys.publicKey,
		privateKey: keys.privateKey,
	};
}

/** How Sekai reaches the machine: Tailscale first (stable and encrypted), then the LAN. */
export async function sshTarget(m: Machine, user?: string): Promise<SshTarget> {
	if (m.provider === "local") throw new Error(`${m.name} is reached through the desktop app, not SSH`);
	const host = m.addresses.tailscale ?? m.addresses.lan;
	if (!host) throw new Error(`${m.name} has no address yet`);
	const agent = await getAgent(m.agentId);
	return {
		machineId: m.id,
		host,
		port: m.ports.ssh,
		user: user ?? m.username,
		keyFile: await agentKeyFile(m.agentId, agent?.name ?? "bot"),
	};
}

const desktops = new Map<string, { desktop: Desktop; host: string }>();

/** The machine's desktop, for screenshots and input: over SSH, or through the desktop app for your computer. */
export async function desktopOf(m: Machine): Promise<DesktopControl> {
	if (m.provider === "local") {
		if (!m.remoteId) throw new Error("This computer isn't linked to a desktop app");
		const agent = await getAgent(m.agentId);
		return new BridgeDesktop(m.remoteId, { id: m.agentId, name: agent?.name ?? "A bot" });
	}
	const target = await sshTarget(m);
	const cached = desktops.get(m.id);
	if (cached && cached.host === target.host) return cached.desktop;
	const desktop = new Desktop(target);
	desktops.set(m.id, { desktop, host: target.host });
	return desktop;
}

/** Computers you've taken over: the bot keeps its hands off until you hand them back. */
const takenOver = new Map<string, number>();
const TAKEOVER_MAX_MS = 2 * 3_600_000;

export function setTakeover(id: string, active: boolean): void {
	if (active) takenOver.set(id, Date.now());
	else takenOver.delete(id);
}

export function isTakenOver(id: string): boolean {
	const since = takenOver.get(id);
	if (since && Date.now() - since > TAKEOVER_MAX_MS) takenOver.delete(id);
	return takenOver.has(id);
}

export async function touchMachine(id: string): Promise<void> {
	await db.update(schema.machines).set({ lastUsedAt: Date.now() }).where(eq(schema.machines.id, id));
}

// ---------------------------------------------------------------- create

function specsFor(kind: Machine["kind"], base: MachineSpecs, custom?: Partial<MachineSpecs>): MachineSpecs {
	const s = { ...base, ...custom };
	if (s.minMemoryMb > s.memoryMb) s.minMemoryMb = s.memoryMb;
	if (kind === "devbox") s.minMemoryMb = 0;
	return s;
}

export async function createMachine(input: MachineCreateInput, createdBy: "user" | "agent" = "user"): Promise<Machine> {
	const data = parse(MachineCreate, input);
	if (data.kind === "device" || data.provider === "local") {
		throw badRequest("Lend your computer to bots from the Sekai desktop app on that computer");
	}
	requirePermission("computers");
	const agent = await getAgent(data.agentId);
	if (!agent) throw notFound("Agent");
	requireOwnAgent(agent);
	const settings = (await getSettings()).machines;
	const mine = await listMachines({ agentId: agent.id });
	if (data.kind === "computer" && mine.some((m) => m.kind === "computer")) {
		throw badRequest(`${agent.name} already has a computer`);
	}
	if (data.kind === "devbox" && mine.filter((m) => m.kind === "devbox").length >= settings.maxDevboxesPerAgent) {
		throw badRequest(`${agent.name} already has ${settings.maxDevboxesPerAgent} devboxes; delete one first`);
	}
	if (data.provider === "proxmox" && (!settings.proxmox.url || !settings.proxmox.tokenId || !settings.proxmox.node)) {
		throw badRequest("Set up Proxmox first (Settings → Computers)");
	}
	if (data.provider === "ssh" && !data.ssh) throw badRequest("Say where the machine is (host, port, user)");

	const specs = specsFor(
		data.kind,
		data.kind === "computer" ? settings.computerSpecs : settings.devboxSpecs,
		data.specs,
	);
	const username = data.provider === "ssh" && data.ssh ? data.ssh.username : linuxUsername(agent.name);
	const suffix =
		data.kind === "devbox"
			? data.name
				? linuxUsername(data.name)
				: `dev-${Math.random().toString(36).slice(2, 6)}`
			: undefined;
	const hostname = data.provider === "ssh" && data.ssh ? data.ssh.host : hostnameFor(agent.name, suffix);
	const name = data.name || (data.kind === "computer" ? `${agent.name}'s computer` : hostname);
	const secrets: Secrets =
		data.provider === "ssh"
			? { userPassword: "", rootPassword: "", vncPassword: null }
			: {
					userPassword: randomPassword(20),
					rootPassword: randomPassword(24),
					vncPassword: data.kind === "computer" ? randomPassword(8) : null,
				};
	const ttlHours = data.ttlHours ?? (data.kind === "devbox" ? settings.devboxTtlHours : undefined);
	const now = Date.now();
	const row: Row = {
		id: newId("mch"),
		agentId: agent.id,
		kind: data.kind,
		provider: data.provider,
		name,
		status: "creating",
		statusDetail: "Getting ready",
		specs,
		hostname,
		username,
		addresses: { lan: data.provider === "ssh" && data.ssh ? data.ssh.host : null, tailscale: null },
		ports: {
			ssh: data.ssh?.port ?? 22,
			vnc: data.kind === "computer" ? (data.ssh?.vncPort ?? (data.provider === "ssh" ? null : 5900)) : null,
			rdp: data.kind === "computer" ? (data.ssh?.rdpPort ?? (data.provider === "ssh" ? null : 3389)) : null,
		},
		remoteId: null,
		secrets: sealJson(secrets),
		expiresAt: ttlHours ? now + ttlHours * 3_600_000 : null,
		createdBy,
		lastUsedAt: null,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.machines).values(row);
	const machine = toMachine(row);
	bus.emit({ type: "machine.changed", machine });
	void provision(machine.id);
	return machine;
}

function provision(id: string): Promise<void> {
	const run = async () => {
		const m = await requireMachine(id);
		const agent = await getAgent(m.agentId);
		if (!agent) throw new Error("The bot was deleted");
		if (m.provider === "ssh") await adoptSsh(m);
		else if (m.kind === "computer") await provisionComputer(m, agent);
		else await provisionDevbox(m, agent);
	};
	return Promise.race([
		run(),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("Setup took too long")), PROVISION_TIMEOUT_MS),
		),
	]).catch(async (err: unknown) => {
		log.warn(`machine ${id}: setup failed: ${errorMessage(err)}`);
		const m = await getMachine(id);
		if (m && m.status !== "deleting") await patch(id, { status: "error", statusDetail: errorMessage(err) });
	});
}

async function secretsOf(id: string): Promise<Secrets> {
	const row = await db.query.machines.findFirst({ where: eq(schema.machines.id, id) });
	if (!row) throw notFound("Machine");
	return unsealJson<Secrets>(row.secrets);
}

function proxmox(settings: Awaited<ReturnType<typeof getSettings>>["machines"]): ProxmoxClient {
	return new ProxmoxClient(settings.proxmox);
}

function vmidOf(m: Machine): number | null {
	const id = m.remoteId?.split("/")[1];
	return id ? Number(id) : null;
}

/** VM ids are handed out one at a time, skipping any id a Sekai machine already holds (even a failed one). */
let allocating: Promise<unknown> = Promise.resolve();

async function claimVmid(m: Machine, px: ProxmoxClient, start: number, node: string): Promise<number> {
	const run = allocating.then(async () => {
		const taken = new Set(
			(await listMachines()).flatMap((x) => (x.id !== m.id && vmidOf(x) ? [vmidOf(x) as number] : [])),
		);
		const vmid = await px.freeVmid(start, taken);
		await patch(m.id, { remoteId: `${node}/${vmid}` });
		return vmid;
	});
	allocating = run.catch(() => {});
	return run;
}

/** Creating the VM failed: forget its id, so deleting this machine later can never hit whoever gets that id next. */
const dropVmid = (m: Machine) => async (err: unknown) => {
	await patch(m.id, { remoteId: null });
	throw err;
};

/** A setup resumed after a restart: remove what the interrupted one built, then build afresh (never two VMs). */
async function clearHalfBuilt(m: Machine, px: ProxmoxClient, imageStorage: string): Promise<void> {
	const old = vmidOf(m);
	if (!old) return;
	try {
		if (m.kind === "computer") {
			await px.deleteVm(old, m.hostname);
			await px.deleteVolume(imageStorage, `${imageStorage}:iso/sekai-seed-${old}.iso`).catch(() => {});
		} else {
			await px.deleteLxc(old, m.hostname);
		}
	} catch (err) {
		if (!(err instanceof ForeignVmError)) throw err;
	}
	await patch(m.id, { remoteId: null });
}

/** A bot's computer on Proxmox, set up by cloud-init from a NoCloud seed. */
async function provisionComputer(m: Machine, agent: Agent): Promise<void> {
	const settings = (await getSettings()).machines;
	const px = proxmox(settings);
	const { imageStorage, storage, bridge, node } = settings.proxmox;

	await detail(m.id, "Checking Proxmox");
	const imageVolume = `${imageStorage}:import/${DEBIAN_IMAGE.file}`;
	let images: string[];
	try {
		images = await px.volumes(imageStorage, "import");
	} catch (err) {
		if (err instanceof ProxmoxError && err.status === 403) throw err;
		throw new Error(
			`Storage "${imageStorage}" can't hold disk images to import. In Proxmox, edit it (Datacenter → Storage) and add the "Import" content type. (${errorMessage(err)})`,
		);
	}
	if (!images.includes(imageVolume)) {
		await detail(m.id, "Downloading Debian 13 (only the first time)");
		await px.downloadUrl(imageStorage, "import", DEBIAN_IMAGE.file, DEBIAN_IMAGE.url);
	}

	await clearHalfBuilt(m, px, imageStorage);
	const vmid = await claimVmid(m, px, settings.proxmox.vmidStart, node);
	const secrets = await secretsOf(m.id);
	const keys = await agentKeypair(agent.id, agent.name);
	const userData = computerUserData({
		hostname: m.hostname,
		displayName: agent.name,
		username: m.username,
		userPassword: secrets.userPassword,
		rootPassword: secrets.rootPassword,
		vncPassword: secrets.vncPassword ?? randomPassword(8),
		publicKey: keys.publicKey,
		tailscaleAuthKey: await machineAuthKey(settings.tailscaleAuthKey, m.hostname),
		timezone: await effectiveTimezone(),
	});
	const seedName = `sekai-seed-${vmid}.iso`;
	await detail(m.id, "Preparing cloud-init");
	await px.upload(imageStorage, "iso", seedName, seedIso(userData, metaData(`sekai-${m.id}`, m.hostname)));

	await detail(m.id, "Creating the VM");
	await px
		.createVm({
			vmid,
			name: m.hostname,
			description: `Sekai computer for ${agent.name}`,
			tags: "sekai",
			ostype: "l26",
			machine: "q35",
			cpu: "host",
			sockets: 1,
			cores: m.specs.cores,
			memory: m.specs.memoryMb,
			balloon: m.specs.minMemoryMb,
			scsihw: "virtio-scsi-single",
			scsi0: `${storage}:0,import-from=${imageVolume},discard=on,ssd=1,iothread=1`,
			ide2: `${imageStorage}:iso/${seedName},media=cdrom`,
			net0: `virtio,bridge=${bridge}`,
			agent: "enabled=1",
			vga: "std",
			boot: "order=scsi0",
			onboot: 1,
		})
		.catch(dropVmid(m));
	await px.resizeVmDisk(vmid, "scsi0", `${m.specs.diskGb}G`);
	await px.vmPower(vmid, "start");
	await patch(m.id, { status: "provisioning", statusDetail: "Booting" });

	// cloud-init installs the desktop; follow along through the guest agent once it's installed.
	const deadline = Date.now() + PROVISION_TIMEOUT_MS;
	for (;;) {
		if (Date.now() > deadline) throw new Error("Setup took too long");
		const current = await getMachine(m.id);
		if (!current || current.status === "deleting") return;
		const ifaces = await px.guestInterfaces(vmid).catch(() => null);
		if (ifaces) {
			const addresses = pickAddresses(
				ifaces.map((i) => ({
					name: i.name,
					ips: (i["ip-addresses"] ?? []).map((a) => a["ip-address"]),
				})),
			);
			if (addresses.lan !== current.addresses.lan || addresses.tailscale !== current.addresses.tailscale) {
				await patch(m.id, { addresses });
			}
			const progress = (await px.guestFile(vmid, PROGRESS_FILE))?.trim();
			if (progress && progress !== current.statusDetail) await detail(m.id, progress);
			const ready = await px.guestFile(vmid, READY_FILE);
			if (ready && (addresses.tailscale || addresses.lan)) {
				const fresh = await requireMachine(m.id);
				if (await sshReachable(await sshTarget(fresh))) break;
				await detail(m.id, "Waiting for SSH");
			}
		} else if (current.statusDetail === "Booting") {
			await detail(m.id, "Installing the desktop (takes a few minutes)");
		}
		await Bun.sleep(5000);
	}
	// The seed holds passwords: eject and delete it now that it's done its job. (Ejecting takes effect right away;
	// removing the drive from a running VM would wait for the next boot, and a checkpoint taken until then would
	// bring back a VM that can't start without the deleted seed.)
	await px.setVmConfig(vmid, { ide2: "none,media=cdrom" }).catch(() => {});
	await px.deleteVolume(imageStorage, `${imageStorage}:iso/${seedName}`).catch(() => {});
	await patch(m.id, { status: "running", statusDetail: null });
	log.info(`machine ${m.name} is ready`);
}

/** A devbox: a Debian 13 container, set up over SSH (containers don't run cloud-init). */
async function provisionDevbox(m: Machine, agent: Agent): Promise<void> {
	const settings = (await getSettings()).machines;
	const px = proxmox(settings);
	const { imageStorage, storage, bridge, node } = settings.proxmox;

	await detail(m.id, "Checking Proxmox");
	let template = (await px.volumes(imageStorage, "vztmpl"))
		.filter((v) => /debian-13-standard/.test(v))
		.sort()
		.at(-1);
	if (!template) {
		const name = await px.debianTemplate();
		if (!name)
			throw new Error("Proxmox doesn't offer a Debian 13 container template (run pveam update on the host)");
		await detail(m.id, "Downloading the Debian 13 template (only the first time)");
		await px.downloadTemplate(imageStorage, name);
		template = `${imageStorage}:vztmpl/${name}`;
	}

	await clearHalfBuilt(m, px, imageStorage);
	const vmid = await claimVmid(m, px, settings.proxmox.vmidStart, node);
	const secrets = await secretsOf(m.id);
	const keys = await agentKeypair(agent.id, agent.name);
	await detail(m.id, "Creating the container");
	await px
		.createLxc({
			vmid,
			ostemplate: template,
			hostname: m.hostname,
			description: `Sekai devbox for ${agent.name}`,
			tags: "sekai;devbox",
			cores: m.specs.cores,
			memory: m.specs.memoryMb,
			swap: 512,
			rootfs: `${storage}:${m.specs.diskGb}`,
			net0: `name=eth0,bridge=${bridge},ip=dhcp`,
			unprivileged: 1,
			features: "nesting=1",
			password: secrets.rootPassword,
			"ssh-public-keys": `${keys.publicKey}\n`,
			start: 1,
		})
		.catch(dropVmid(m));
	await patch(m.id, { status: "provisioning", statusDetail: "Starting" });

	let lan: string | null = null;
	for (let i = 0; i < 90 && !lan; i++) {
		const ifaces = await px.lxcInterfaces(vmid).catch(() => []);
		lan = pickAddresses(ifaces.map((x) => ({ name: x.name, ips: x.inet ? [x.inet.split("/")[0] ?? ""] : [] }))).lan;
		if (!lan) await Bun.sleep(2000);
	}
	if (!lan) throw new Error("The container didn't get an IP address (is DHCP available on that bridge?)");
	await patch(m.id, { addresses: { lan, tailscale: null } });

	const root = await sshTarget(await requireMachine(m.id), "root");
	for (let i = 0; i < 30 && !(await sshReachable(root)); i++) await Bun.sleep(2000);
	await detail(m.id, "Setting up");
	const script = devboxSetupScript({
		hostname: m.hostname,
		displayName: agent.name,
		username: m.username,
		userPassword: secrets.userPassword,
		rootPassword: secrets.rootPassword,
		publicKey: keys.publicKey,
		tailscaleAuthKey: await machineAuthKey(settings.tailscaleAuthKey, m.hostname),
		timezone: await effectiveTimezone(),
	});
	const r = await sshExec(root, "bash -s", { input: script, timeoutMs: 20 * 60_000 });
	if (r.code !== 0) throw new Error(`Setup failed: ${r.stderr.trim().slice(-500)}`);
	const tailscale = settings.tailscaleAuthKey
		? (await sshText(root, "tailscale ip -4 2>/dev/null | head -1").catch(() => "")).trim() || null
		: null;
	await patch(m.id, { addresses: { lan, tailscale }, status: "running", statusDetail: null });
	log.info(`devbox ${m.name} is ready`);
}

/** A machine you already run: Sekai checks it can get in with the bot's key and installs the desktop helper. */
async function adoptSsh(m: Machine): Promise<void> {
	await patch(m.id, { status: "provisioning", statusDetail: "Connecting" });
	const target = await sshTarget(m);
	if (!(await sshReachable(target))) {
		const access = await machineAccess(m.id);
		throw new Error(
			`Can't sign in as ${m.username}@${target.host}. Add the bot's key to ~/.ssh/authorized_keys there: ${access.publicKey}`,
		);
	}
	// What it actually has, rather than the defaults for new machines.
	const facts = await sshText(
		target,
		"nproc; awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo; df -BG --output=size / | tail -1 | tr -dc 0-9",
	).catch(() => "");
	const [cores, memoryMb, diskGb] = facts
		.trim()
		.split("\n")
		.map((x) => Number(x.trim()));
	if (cores && memoryMb && diskGb) await patch(m.id, { specs: { cores, memoryMb, minMemoryMb: 0, diskGb } });
	if (m.kind === "computer") {
		await detail(m.id, "Installing the desktop helper");
		await sshText(target, installHelperScript(), { input: desktopHelper });
		const info = await (await desktopOf(m)).info().catch((err: unknown) => {
			throw new Error(
				`The desktop isn't reachable (${errorMessage(err)}). Is a graphical session running on :0?`,
			);
		});
		log.info(`machine ${m.name}: desktop ${info.width}x${info.height}`);
	}
	await patch(m.id, { status: "running", statusDetail: null });
}

/** Tries the setup of a machine you added over SSH again (after adding the bot's key there, say). */
export async function retryMachine(id: string): Promise<Machine> {
	const m = await requireMachine(id);
	if (m.provider !== "ssh") throw badRequest("Delete this machine and create it again");
	if (m.status === "running") return m;
	const next = (await patch(id, { status: "creating", statusDetail: "Trying again" })) ?? m;
	void provision(id);
	return next;
}

// ---------------------------------------------------------------- change, power, delete

export async function updateMachine(id: string, input: MachineUpdateInput): Promise<Machine> {
	const data = parse(MachineUpdate, input);
	const m = await requireMachine(id);
	const fields: Partial<Row> = {};
	if (data.name) fields.name = data.name;
	if (data.ttlHours !== undefined && m.kind === "devbox") fields.expiresAt = Date.now() + data.ttlHours * 3_600_000;
	if (data.specs) {
		const next = specsFor(m.kind, m.specs, data.specs);
		if (next.diskGb < m.specs.diskGb) throw badRequest("Disks can only grow");
		await resize(m, next);
		fields.specs = next;
	}
	return (await patch(id, fields)) ?? m;
}

async function resize(m: Machine, next: MachineSpecs): Promise<void> {
	if (m.provider !== "proxmox") throw badRequest("Only Proxmox machines can be resized from Sekai");
	const vmid = vmidOf(m);
	if (!vmid) throw badRequest("This machine isn't on Proxmox yet");
	const px = proxmox((await getSettings()).machines);
	if (m.kind === "computer") {
		await px.setVmConfig(vmid, { cores: next.cores, memory: next.memoryMb, balloon: next.minMemoryMb });
		if (next.diskGb > m.specs.diskGb) await px.resizeVmDisk(vmid, "scsi0", `${next.diskGb}G`);
		// CPU and memory changes need a restart unless hotplug is on.
		if ((next.cores !== m.specs.cores || next.memoryMb !== m.specs.memoryMb) && m.status === "running") {
			await detail(m.id, "Restarting to apply the new size");
			await px.vmPower(vmid, "reboot");
			await patch(m.id, { statusDetail: null });
		}
	} else {
		await px.setLxcConfig(vmid, { cores: next.cores, memory: next.memoryMb });
		if (next.diskGb > m.specs.diskGb) await px.resizeLxcDisk(vmid, `${next.diskGb}G`);
	}
}

export async function powerMachine(id: string, action: "start" | "stop" | "restart"): Promise<Machine> {
	const m = await requireMachine(id);
	if (m.provider === "local") throw badRequest("Sekai doesn't power your own computer on or off");
	if (m.provider !== "proxmox") throw badRequest("Sekai can only power Proxmox machines on and off");
	const vmid = vmidOf(m);
	if (!vmid) throw badRequest("This machine isn't on Proxmox yet");
	const px = proxmox((await getSettings()).machines);
	const verb = action === "restart" ? "reboot" : action === "stop" ? "shutdown" : "start";
	if (m.kind === "computer" && verb === "start") await ejectSeed(px, vmid);
	if (m.kind === "computer") await px.vmPower(vmid, verb);
	else await px.lxcPower(vmid, verb);
	return (await patch(id, { status: action === "stop" ? "stopped" : "running", statusDetail: null })) ?? m;
}

export async function deleteMachine(id: string): Promise<void> {
	const m = await requireMachine(id);
	if (m.provider === "local") {
		// Your computer: the bot just stops being allowed on it (the app is told, so it stays that way).
		if (m.remoteId) revokeDevice(m.remoteId, m.agentId);
		await db.delete(schema.machines).where(eq(schema.machines.id, id));
		bus.emit({ type: "machine.deleted", machineId: id, agentId: m.agentId });
		return;
	}
	await patch(id, { status: "deleting", statusDetail: "Deleting" });
	try {
		if (m.provider === "proxmox") {
			const vmid = vmidOf(m);
			if (vmid) {
				const settings = (await getSettings()).machines;
				const px = proxmox(settings);
				if (m.kind === "computer") {
					await px.deleteVm(vmid, m.hostname);
					const seed = `${settings.proxmox.imageStorage}:iso/sekai-seed-${vmid}.iso`;
					await px.deleteVolume(settings.proxmox.imageStorage, seed).catch(() => {});
				} else {
					await px.deleteLxc(vmid, m.hostname);
				}
				await deleteBackupCheckpoints(m, px, vmid);
			}
		}
	} catch (err) {
		// Its id belongs to another machine now: nothing of this one is left to delete there.
		if (err instanceof ForeignVmError) log.warn(errorMessage(err));
		else {
			await patch(id, { status: "error", statusDetail: `Couldn't delete it: ${errorMessage(err)}` });
			throw err;
		}
	}
	if (m.addresses.lan || m.addresses.tailscale) await sshForget(await sshTarget(m)).catch(() => {});
	desktops.delete(id);
	await db.delete(schema.machines).where(eq(schema.machines.id, id));
	bus.emit({ type: "machine.deleted", machineId: id, agentId: m.agentId });
}

/** Before a bot is deleted: its machines go too (they'd otherwise keep running on Proxmox). */
export async function deleteAgentMachines(agentId: string): Promise<void> {
	for (const m of await listMachines({ agentId })) {
		await deleteMachine(m.id).catch((err: unknown) => log.warn(`couldn't delete ${m.name}: ${errorMessage(err)}`));
	}
}

/** Checks the Proxmox settings: version, nodes and storages. */
export async function testProxmox() {
	const px = proxmox((await getSettings()).machines);
	try {
		const version = await px.version();
		const nodes = (await px.nodes()).map((n) => n.node);
		// A privilege-separated token with no permissions still logs in, but sees nothing.
		const perms = await px.get<Record<string, unknown>>("/access/permissions").catch(() => null);
		if (perms && Object.keys(perms).length === 0) {
			return {
				ok: false,
				version: version.version,
				error: permissionHelp((await getSettings()).machines.proxmox.tokenId, "the token has no permissions"),
				nodes,
				storages: [],
			};
		}
		const storages = px.node ? (await px.storages()).map((s) => `${s.storage} (${s.content})`) : [];
		return { ok: true, version: version.version, error: null, nodes, storages };
	} catch (err) {
		return { ok: false, version: null, error: errorMessage(err), nodes: [], storages: [] };
	}
}

// ---------------------------------------------------------------- your computer (desktop app)

/**
 * The app said hello: one device machine per bot it lets use the computer, and none for the rest. Only the app's
 * person's own bots: someone else's app can't lend its computer to your bots, or touch yours.
 */
async function syncDevice(hello: DeviceHello, userId: string): Promise<void> {
	const own = new Set(
		(await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.userId, userId))).map(
			(a) => a.id,
		),
	);
	const rows = (await db.select().from(schema.machines).where(eq(schema.machines.remoteId, hello.deviceId))).filter(
		(r) => own.has(r.agentId),
	);
	const allowed = new Set((hello.settings.enabled ? hello.settings.agentIds : []).filter((id) => own.has(id)));
	const specs: MachineSpecs = { ...hello.specs, minMemoryMb: 0 };
	for (const row of rows) {
		if (row.provider !== "local") continue;
		if (!allowed.has(row.agentId)) {
			await db.delete(schema.machines).where(eq(schema.machines.id, row.id));
			bus.emit({ type: "machine.deleted", machineId: row.id, agentId: row.agentId });
		} else {
			await patch(row.id, {
				status: "running",
				statusDetail: null,
				name: hello.name,
				hostname: hello.name,
				username: hello.user,
				specs,
			});
			allowed.delete(row.agentId);
		}
	}
	const now = Date.now();
	for (const agentId of allowed) {
		const row: Row = {
			id: newId("mch"),
			agentId,
			kind: "device",
			provider: "local",
			name: hello.name,
			status: "running",
			statusDetail: null,
			specs,
			hostname: hello.name,
			username: hello.user,
			addresses: { lan: null, tailscale: null },
			ports: { ssh: 0, vnc: null, rdp: null },
			remoteId: hello.deviceId,
			secrets: sealJson({ userPassword: "", rootPassword: "", vncPassword: null } satisfies Secrets),
			expiresAt: null,
			createdBy: "user",
			lastUsedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		await db.insert(schema.machines).values(row);
		bus.emit({ type: "machine.changed", machine: toMachine(row) });
	}
}

async function deviceOffline(deviceId: string): Promise<void> {
	const rows = await db.select().from(schema.machines).where(eq(schema.machines.remoteId, deviceId));
	for (const row of rows) {
		if (row.provider === "local") await patch(row.id, { status: "stopped", statusDetail: "Offline" });
	}
}

/** You pressed stop on your computer: every bot working there stops now. */
async function deviceStop(deviceId: string): Promise<void> {
	const rows = await db.select().from(schema.machines).where(eq(schema.machines.remoteId, deviceId));
	const { cancelRun } = await import("../agent/runtime.ts");
	const { listRuns } = await import("../services/runs.ts");
	for (const row of rows) {
		const runs = await listRuns({
			agentId: row.agentId,
			status: ["queued", "running", "awaiting_approval"],
			limit: 50,
		});
		for (const r of runs) await cancelRun(r.id);
	}
}

// ---------------------------------------------------------------- startup and cleanup

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Resumes setups interrupted by a restart and deletes devboxes whose time is up. */
export async function initMachines(): Promise<void> {
	setBridgeHooks({ onHello: syncDevice, onOffline: deviceOffline, onStop: deviceStop });
	for (const m of await listMachines()) {
		if (m.provider === "local") {
			if (m.remoteId && !isDeviceOnline(m.remoteId))
				await patch(m.id, { status: "stopped", statusDetail: "Offline" });
			continue;
		}
		if (m.status === "creating" || m.status === "provisioning") {
			if (m.remoteId || m.provider === "ssh") void provision(m.id);
			else await patch(m.id, { status: "error", statusDetail: "Setup was interrupted; delete it and try again" });
		}
		if (m.status === "deleting") void deleteMachine(m.id).catch(() => {});
	}
	sweeper = setInterval(async () => {
		const now = Date.now();
		for (const m of await listMachines().catch(() => [])) {
			if (m.kind === "devbox" && m.expiresAt && m.expiresAt < now && m.status !== "deleting") {
				log.info(`devbox ${m.name} expired`);
				void deleteMachine(m.id).catch((err: unknown) => log.warn(`expired devbox: ${errorMessage(err)}`));
			}
		}
	}, 60_000);
}

export function shutdownMachines(): void {
	if (sweeper) clearInterval(sweeper);
}

// ---------------------------------------------------------------- checkpoints (Proxmox snapshots or backups)

/**
 * A checkpoint is a Proxmox snapshot of the machine's disk when its storage takes them (seconds, nothing copied),
 * or else a full backup (vzdump: a minute or more, and disk space, but it works on any storage).
 */
export type CheckpointMode = "snapshot" | "backup";

/** Sekai keeps this many automatic checkpoints per machine (yours stay until you delete them). */
const AUTO_KEEP = 3;
const AUTO_PREFIX = "auto: ";
/** One checkpoint operation per machine at a time (Proxmox locks the VM while it works). */
const checkpointLocks = new Map<string, Promise<unknown>>();
const modes = new Map<string, { mode: CheckpointMode; at: number }>();

function locked<T>(machineId: string, fn: () => Promise<T>): Promise<T> {
	const prev = checkpointLocks.get(machineId) ?? Promise.resolve();
	const run = prev.catch(() => {}).then(fn);
	checkpointLocks.set(
		machineId,
		run.catch(() => {}),
	);
	return run;
}

async function checkpointTarget(id: string): Promise<{
	m: Machine;
	px: ProxmoxClient;
	kind: "qemu" | "lxc";
	vmid: number;
	mode: CheckpointMode;
}> {
	const m = await requireMachine(id);
	const vmid = vmidOf(m);
	if (m.provider !== "proxmox" || !vmid) throw badRequest("Only bots' own computers and devboxes have checkpoints");
	const px = proxmox((await getSettings()).machines);
	const kind = m.kind === "computer" ? "qemu" : "lxc";
	const known = modes.get(id);
	let mode = known && Date.now() - known.at < 10 * 60_000 ? known.mode : null;
	if (!mode) {
		mode = (await px.canSnapshot(kind, vmid).catch(() => true)) ? "snapshot" : "backup";
		modes.set(id, { mode, at: Date.now() });
	}
	return { m, px, kind, vmid, mode };
}

/** Backups carry this in their notes: a reused VM id must never show another machine's backups. */
const backupTag = (m: Machine) => `sekai ${m.id} | `;
/** Backups made before the rename (Feesh → Sekai) carry the old name. */
const legacyBackupTag = (m: Machine) => `feesh ${m.id} | `;

async function sekaiBackups(px: ProxmoxClient, m: Machine, vmid: number) {
	const storage = await px.backupStorage();
	const tags = [backupTag(m), legacyBackupTag(m)];
	return {
		storage,
		list: (await px.backups(storage, vmid))
			.filter((b) => tags.some((t) => b.notes.startsWith(t)))
			// Labels read the same whichever name made them.
			.map((b) =>
				b.notes.startsWith(tags[1] ?? "") ? { ...b, notes: b.notes.replace(/^feesh /, "sekai ") } : b,
			),
	};
}

function snapshotProblem(err: unknown): Error {
	const msg = errorMessage(err);
	if (/snapshot feature is not available|not supported|can't snapshot|raw/i.test(msg)) {
		return badRequest(
			"This machine's disk can't be checkpointed: its Proxmox storage doesn't take snapshots (qcow2 on a directory, LVM-thin, ZFS or Ceph can).",
		);
	}
	return err instanceof Error ? err : new Error(msg);
}

export async function listCheckpoints(id: string): Promise<{ mode: CheckpointMode; checkpoints: Checkpoint[] }> {
	const { m, px, kind, vmid, mode } = await checkpointTarget(id);
	if (mode === "backup") {
		const { list } = await sekaiBackups(px, m, vmid);
		const tag = backupTag(m);
		return {
			mode,
			checkpoints: list
				.map((b) => ({
					name: b.volid,
					label: b.notes.slice(tag.length).trim() || "Backup",
					auto: false,
					at: b.ctime,
					kind: "backup" as const,
					size: b.size,
				}))
				.reverse(),
		};
	}
	return {
		mode,
		checkpoints: (await px.snapshots(kind, vmid))
			.map((s) => {
				const auto = s.description.startsWith(AUTO_PREFIX);
				return {
					name: s.name,
					label: (auto ? s.description.slice(AUTO_PREFIX.length) : s.description).trim() || s.name,
					auto,
					at: s.snaptime,
					kind: "snapshot" as const,
					size: null,
				};
			})
			.reverse(),
	};
}

/** Saves the machine as it is now. Automatic ones (before a risky command) keep only the latest few. */
export async function makeCheckpoint(id: string, label: string, auto = false): Promise<Checkpoint> {
	return locked(id, async () => {
		const { m, px, kind, vmid, mode } = await checkpointTarget(id);
		const text = label.replace(/\s+/g, " ").trim().slice(0, 200) || "Checkpoint";
		if (mode === "backup") {
			if (auto) throw badRequest("Automatic checkpoints need storage that takes snapshots");
			const storage = await px.backupStorage();
			await patch(id, { statusDetail: "Saving a checkpoint (a full backup)" });
			try {
				await px.backup(vmid, storage, `${backupTag(m)}${text}`);
			} finally {
				await patch(id, { statusDetail: null });
			}
			const newest = (await sekaiBackups(px, m, vmid)).list.at(-1);
			if (!newest) throw new Error("The backup finished but Proxmox doesn't list it");
			log.info(`checkpoint (backup) ${newest.volid} of machine ${id}: ${text}`);
			bus.emit({ type: "machine.checkpoints", machineId: id });
			return {
				name: newest.volid,
				label: text,
				auto: false,
				at: newest.ctime,
				kind: "backup",
				size: newest.size,
			};
		}
		// Proxmox names: a letter, then letters, digits, - and _, at most 40.
		const name = `${auto ? "auto" : "cp"}-${Date.now().toString(36)}`;
		try {
			await px.snapshot(kind, vmid, name, `${auto ? AUTO_PREFIX : ""}${text}`);
		} catch (err) {
			throw snapshotProblem(err);
		}
		if (auto) {
			const autos = (await px.snapshots(kind, vmid)).filter((s) => s.description.startsWith(AUTO_PREFIX));
			for (const old of autos.slice(0, Math.max(0, autos.length - AUTO_KEEP))) {
				await px
					.deleteSnapshot(kind, vmid, old.name)
					.catch((err: unknown) =>
						log.warn(`couldn't remove old checkpoint ${old.name}: ${errorMessage(err)}`),
					);
			}
		}
		log.info(`checkpoint ${name} of machine ${id}${auto ? " (auto)" : ""}: ${text}`);
		bus.emit({ type: "machine.checkpoints", machineId: id });
		return { name, label: text, auto, at: Date.now(), kind: "snapshot", size: null };
	});
}

/**
 * A stopped VM that still points at its setup seed (deleted once setup finished) can't start: Proxmox refuses a
 * missing volume. That happens after going back to a checkpoint taken before the seed was ejected.
 */
async function ejectSeed(px: ProxmoxClient, vmid: number): Promise<void> {
	const cfg = await px.vmConfig(vmid).catch(() => ({}) as Record<string, string | number>);
	const stale = Object.entries(cfg).filter(
		([k, v]) => /^(ide|sata|scsi)\d+$/.test(k) && /iso\/(sekai|feesh)-seed-/.test(String(v)),
	);
	for (const [k] of stale) await px.setVmConfig(vmid, { [k]: "none,media=cdrom" });
}

/** Puts the machine back to a checkpoint (everything since is lost) and starts it again if it was running. */
export async function restoreCheckpoint(id: string, name: string): Promise<void> {
	return locked(id, async () => {
		const { m, px, kind, vmid, mode } = await checkpointTarget(id);
		const wasRunning = m.status === "running";
		if (mode === "backup") {
			const { list } = await sekaiBackups(px, m, vmid);
			if (!list.some((b) => b.volid === name)) throw notFound("Checkpoint");
		} else if (!(await px.snapshots(kind, vmid)).some((s) => s.name === name)) {
			throw notFound("Checkpoint");
		}
		await patch(id, { statusDetail: "Going back to a checkpoint" });
		try {
			if (mode === "backup") {
				// A restore replaces the machine, so it has to be off first.
				const status = kind === "qemu" ? await px.vmStatus(vmid) : await px.lxcStatus(vmid);
				if (status.status === "running") {
					if (kind === "qemu") await px.vmPower(vmid, "stop");
					else await px.lxcPower(vmid, "stop");
				}
				await px.restoreBackup(kind, vmid, name, (await getSettings()).machines.proxmox.storage);
			} else {
				// Started here rather than by the rollback, so a stale setup seed can be ejected in between.
				await px.rollback(kind, vmid, name, false);
			}
			if (kind === "qemu") await ejectSeed(px, vmid);
			if (wasRunning) {
				if (kind === "qemu") await px.vmPower(vmid, "start");
				else await px.lxcPower(vmid, "start");
			}
		} catch (err) {
			await patch(id, { statusDetail: null });
			throw snapshotProblem(err);
		}
		// Its desktop and SSH sessions start over.
		desktops.delete(id);
		await patch(id, { statusDetail: null });
		log.info(`machine ${id} went back to ${name}`);
		bus.emit({ type: "machine.checkpoints", machineId: id });
	});
}

export async function deleteCheckpoint(id: string, name: string): Promise<void> {
	return locked(id, async () => {
		const { m, px, kind, vmid, mode } = await checkpointTarget(id);
		if (mode === "backup") {
			const { storage, list } = await sekaiBackups(px, m, vmid);
			if (!list.some((b) => b.volid === name)) throw notFound("Checkpoint");
			await px.deleteVolume(storage, name);
		} else {
			if (!(await px.snapshots(kind, vmid)).some((s) => s.name === name)) throw notFound("Checkpoint");
			await px.deleteSnapshot(kind, vmid, name);
		}
		bus.emit({ type: "machine.checkpoints", machineId: id });
	});
}

/** A deleted machine's backup checkpoints go with it (snapshots go with the VM itself). */
async function deleteBackupCheckpoints(m: Machine, px: ProxmoxClient, vmid: number): Promise<void> {
	try {
		const { storage, list } = await sekaiBackups(px, m, vmid);
		for (const b of list) await px.deleteVolume(storage, b.volid);
	} catch (err) {
		log.debug(`couldn't clean up ${m.name}'s backups: ${errorMessage(err)}`);
	}
}

/** Commands that can break a machine: worth a checkpoint first. */
const RISKY_COMMAND =
	/\b(sudo|apt(-get)?|dpkg|snap\s+(install|remove)|pip3?\s+install|npm\s+(i|install)\s+-g|rm\s+-[a-zA-Z]*[rf]|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|systemctl|reboot|shutdown|update-alternatives)\b|>\s*\/(etc|usr|boot)\/|curl[^|\n]*\|\s*(ba)?sh|wget[^|\n]*\|\s*(ba)?sh/;
/** Whether a command could break the machine (and gets a checkpoint first). */
export function isRiskyCommand(command: string): boolean {
	return RISKY_COMMAND.test(command);
}
const lastAuto = new Map<string, number>();
const AUTO_GAP_MS = 30 * 60_000;

/**
 * Before a risky command on a bot's own Proxmox machine: a checkpoint, at most every 30 minutes per machine.
 * Returns a line for the tool result, or null when none was made (not risky, too soon, or it can't).
 */
export async function checkpointBefore(m: Machine, command: string): Promise<string | null> {
	if (m.provider !== "proxmox" || !vmidOf(m) || !isRiskyCommand(command)) return null;
	// Full backups take too long to make before every risky command: only snapshots are automatic.
	if (modes.get(m.id)?.mode === "backup") return null;
	const now = Date.now();
	if (now - (lastAuto.get(m.id) ?? 0) < AUTO_GAP_MS) return null;
	lastAuto.set(m.id, now);
	try {
		const cp = await makeCheckpoint(m.id, `Before \`${command.replace(/\s+/g, " ").slice(0, 80)}\``, true);
		return `Saved a checkpoint first (${cp.name}); machine_checkpoint can roll back to it if this breaks something.`;
	} catch (err) {
		log.debug(`no checkpoint before a risky command on ${m.name}: ${errorMessage(err)}`);
		return null;
	}
}
