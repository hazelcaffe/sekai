import type { MachineSettings } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";

/**
 * A small Proxmox VE API client: just what bots' computers and devboxes need. Authenticates with an API token
 * (Datacenter → Permissions → API Tokens); see the README for the privileges it needs.
 */

export type ProxmoxConfig = MachineSettings["proxmox"];

export const DEBIAN_IMAGE = {
	file: "debian-13-generic-amd64.qcow2",
	url: "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2",
};

/** The id now belongs to another VM or container (not the machine being deleted); it's left alone. */
export class ForeignVmError extends Error {
	override name = "ForeignVmError";
}

export class ProxmoxError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ProxmoxError";
	}
}

/**
 * Proxmox's "Permission check failed (/storage/local, Datastore.Audit|Datastore.AllocateSpace)" as something
 * you can act on. The usual cause: an API token made with "Privilege Separation", which starts with no rights.
 */
export function permissionHelp(tokenId: string, reason: string): string {
	const m = reason.match(/\((\/[^,)]*),\s*([^)]+)\)/);
	const where = m?.[1] ? ` on ${m[1]}` : "";
	const needs = m?.[2] ? ` (it needs ${m[2].split("|").join(" or ")})` : "";
	return `Proxmox didn't let the API token ${tokenId || ""} do this${where}${needs}. In Proxmox, open Datacenter → Permissions → API Tokens, edit the token and untick "Privilege Separation". Or keep it and add a permission for the token: Datacenter → Permissions → Add → API Token Permission, path "/", role "Administrator".`.replace(
		/\s+/g,
		" ",
	);
}

type Params = Record<string, string | number | boolean | string[] | undefined>;

function form(params: Params): URLSearchParams {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined) continue;
		if (Array.isArray(v)) for (const item of v) body.append(k, item);
		else body.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
	}
	return body;
}

export interface GuestInterface {
	name: string;
	"ip-addresses"?: { "ip-address": string; "ip-address-type": "ipv4" | "ipv6"; prefix: number }[];
}

export class ProxmoxClient {
	constructor(
		readonly cfg: ProxmoxConfig,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	get node(): string {
		return this.cfg.node;
	}

	private async call<T>(
		method: string,
		path: string,
		params?: Params,
		body?: FormData | URLSearchParams,
	): Promise<T> {
		if (!this.cfg.url || !this.cfg.tokenId || !this.cfg.tokenSecret) {
			throw new ProxmoxError("Proxmox isn't set up yet (Settings → Computers)", 0);
		}
		const query = method === "GET" || method === "DELETE" ? form(params ?? {}).toString() : "";
		const url = `${this.cfg.url.replace(/\/+$/, "")}/api2/json${path}${query ? `?${query}` : ""}`;
		const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
			method,
			headers: { authorization: `PVEAPIToken=${this.cfg.tokenId}=${this.cfg.tokenSecret}` },
			body: body ?? (method === "GET" || method === "DELETE" ? undefined : form(params ?? {})),
			signal: AbortSignal.timeout(120_000),
			...(this.cfg.insecureTls ? { tls: { rejectUnauthorized: false } } : {}),
		};
		let res: Response;
		try {
			res = await this.fetcher(url, init);
		} catch (err) {
			throw new ProxmoxError(`Can't reach Proxmox at ${this.cfg.url}: ${errorMessage(err)}`, 0);
		}
		const text = await res.text();
		let json: { data?: T; errors?: Record<string, string>; message?: string } = {};
		try {
			json = text ? JSON.parse(text) : {};
		} catch {}
		if (!res.ok) {
			const detail = json.errors
				? Object.entries(json.errors)
						.map(([k, v]) => `${k}: ${v}`)
						.join("; ")
				: json.message || text.slice(0, 300);
			const reason = `${res.statusText} ${detail}`;
			if (res.status === 403 || /permission check failed/i.test(reason)) {
				throw new ProxmoxError(permissionHelp(this.cfg.tokenId, reason), 403);
			}
			// Proxmox puts the reason in the status line.
			throw new ProxmoxError(
				`${res.statusText || `HTTP ${res.status}`}${detail ? ` (${detail})` : ""}`.trim(),
				res.status,
			);
		}
		return json.data as T;
	}

	get = <T>(path: string, params?: Params) => this.call<T>("GET", path, params);
	post = <T>(path: string, params?: Params) => this.call<T>("POST", path, params);
	put = <T>(path: string, params?: Params) => this.call<T>("PUT", path, params);
	del = <T>(path: string, params?: Params) => this.call<T>("DELETE", path, params);

	version() {
		return this.get<{ version: string; release: string }>("/version");
	}

	nodes() {
		return this.get<{ node: string; status: string }[]>("/nodes");
	}

	storages() {
		return this.get<
			{ storage: string; content: string; type: string; active?: number; avail?: number; total?: number }[]
		>(`/nodes/${this.node}/storage`);
	}

	/** The first id from `start` up that no VM or container uses (nor any id in `taken`, e.g. Sekai's own records). */
	async freeVmid(start: number, taken: Set<number> = new Set()): Promise<number> {
		const used = new Set(
			(await this.get<{ vmid?: number }[]>("/cluster/resources", { type: "vm" })).flatMap((r) =>
				r.vmid ? [r.vmid] : [],
			),
		);
		let id = start;
		while (used.has(id) || taken.has(id)) id++;
		return id;
	}

	/** A "this VM doesn't exist" answer (Proxmox says so with a 500 and a message, or a 404). */
	static gone(err: unknown): boolean {
		return (
			err instanceof ProxmoxError && (err.status === 404 || /does not exist|no such|not found/i.test(err.message))
		);
	}

	/** Waits for a task (UPID) to finish; throws with its log tail if it failed. */
	async wait(upid: string | null | undefined, timeoutMs = 30 * 60_000): Promise<void> {
		if (!upid || typeof upid !== "string" || !upid.startsWith("UPID:")) return;
		const node = upid.split(":")[1] ?? this.node;
		const deadline = Date.now() + timeoutMs;
		const path = `/nodes/${node}/tasks/${encodeURIComponent(upid)}`;
		for (;;) {
			const s = await this.get<{ status: string; exitstatus?: string }>(`${path}/status`);
			if (s.status === "stopped") {
				if (s.exitstatus && s.exitstatus !== "OK" && !s.exitstatus.startsWith("WARNINGS")) {
					const log = await this.get<{ t: string }[]>(`${path}/log`, { limit: 400 }).catch(() => []);
					const tail = log
						.map((l) => l.t)
						.filter((l) => l && l !== "TASK OK")
						.slice(-6)
						.join(" / ");
					throw new ProxmoxError(`${s.exitstatus}${tail ? `: ${tail}` : ""}`, 500);
				}
				return;
			}
			if (Date.now() > deadline) throw new ProxmoxError("A Proxmox task took too long", 504);
			await Bun.sleep(1500);
		}
	}

	async volumes(storage: string, content: string): Promise<string[]> {
		const list = await this.get<{ volid: string }[]>(`/nodes/${this.node}/storage/${storage}/content`, {
			content,
		});
		return list.map((v) => v.volid);
	}

	/** Has Proxmox download a file (cloud image, template, ISO) straight onto a storage. */
	async downloadUrl(storage: string, content: "iso" | "vztmpl" | "import", filename: string, url: string) {
		const upid = await this.post<string>(`/nodes/${this.node}/storage/${storage}/download-url`, {
			content,
			filename,
			url,
		});
		await this.wait(upid, 60 * 60_000);
	}

	async upload(storage: string, content: "iso" | "vztmpl" | "import", filename: string, data: Uint8Array) {
		const body = new FormData();
		body.append("content", content);
		body.append("filename", new Blob([data]), filename);
		const upid = await this.call<string>("POST", `/nodes/${this.node}/storage/${storage}/upload`, undefined, body);
		await this.wait(upid);
	}

	async deleteVolume(storage: string, volid: string) {
		const upid = await this.del<string>(
			`/nodes/${this.node}/storage/${storage}/content/${encodeURIComponent(volid)}`,
		);
		await this.wait(upid);
	}

	// ---------------------------------------------------------------- VMs

	async createVm(params: Params) {
		await this.wait(await this.post<string>(`/nodes/${this.node}/qemu`, params));
	}

	async resizeVmDisk(vmid: number, disk: string, size: string) {
		await this.wait(await this.put<string | null>(`/nodes/${this.node}/qemu/${vmid}/resize`, { disk, size }));
	}

	/** The VM's configuration as it is now (not with changes waiting for the next boot). */
	vmConfig(vmid: number) {
		return this.get<Record<string, string | number>>(`/nodes/${this.node}/qemu/${vmid}/config`, { current: 1 });
	}

	async setVmConfig(vmid: number, params: Params) {
		await this.wait(await this.post<string | null>(`/nodes/${this.node}/qemu/${vmid}/config`, params));
	}

	async vmPower(vmid: number, action: "start" | "stop" | "shutdown" | "reboot") {
		await this.wait(await this.post<string>(`/nodes/${this.node}/qemu/${vmid}/status/${action}`));
	}

	vmStatus(vmid: number) {
		return this.get<{ status: string; qmpstatus?: string; uptime?: number }>(
			`/nodes/${this.node}/qemu/${vmid}/status/current`,
		);
	}

	/** Deletes a VM; with `expectName`, only if it's that one (never someone else's that took the id). */
	async deleteVm(vmid: number, expectName?: string) {
		let s: Awaited<ReturnType<typeof this.vmStatus>>;
		try {
			s = await this.vmStatus(vmid);
		} catch (err) {
			if (ProxmoxClient.gone(err)) return;
			throw err;
		}
		if (expectName) {
			const cfg = await this.get<{ name?: string }>(`/nodes/${this.node}/qemu/${vmid}/config`);
			if (cfg.name && cfg.name !== expectName)
				throw new ForeignVmError(`VM ${vmid} is "${cfg.name}" now, not this machine, so Sekai left it alone`);
		}
		if (s.status === "running") await this.vmPower(vmid, "stop");
		await this.wait(
			await this.del<string>(`/nodes/${this.node}/qemu/${vmid}`, { purge: 1, "destroy-unreferenced-disks": 1 }),
		);
	}

	/** Network interfaces as the QEMU guest agent sees them (fails until the agent is running). */
	async guestInterfaces(vmid: number): Promise<GuestInterface[]> {
		const r = await this.get<{ result: GuestInterface[] }>(
			`/nodes/${this.node}/qemu/${vmid}/agent/network-get-interfaces`,
		);
		return r.result ?? [];
	}

	/** Reads a small file inside the VM through the guest agent; null when it doesn't exist yet. */
	async guestFile(vmid: number, file: string): Promise<string | null> {
		try {
			const r = await this.get<{ content: string }>(`/nodes/${this.node}/qemu/${vmid}/agent/file-read`, { file });
			return r.content;
		} catch {
			return null;
		}
	}

	// ---------------------------------------------------------------- containers

	async createLxc(params: Params) {
		await this.wait(await this.post<string>(`/nodes/${this.node}/lxc`, params));
	}

	async lxcPower(vmid: number, action: "start" | "stop" | "shutdown" | "reboot") {
		await this.wait(await this.post<string>(`/nodes/${this.node}/lxc/${vmid}/status/${action}`));
	}

	lxcStatus(vmid: number) {
		return this.get<{ status: string }>(`/nodes/${this.node}/lxc/${vmid}/status/current`);
	}

	lxcInterfaces(vmid: number) {
		return this.get<{ name: string; inet?: string; inet6?: string }[]>(
			`/nodes/${this.node}/lxc/${vmid}/interfaces`,
		);
	}

	async setLxcConfig(vmid: number, params: Params) {
		await this.wait(await this.put<string | null>(`/nodes/${this.node}/lxc/${vmid}/config`, params));
	}

	async resizeLxcDisk(vmid: number, size: string) {
		await this.wait(
			await this.put<string | null>(`/nodes/${this.node}/lxc/${vmid}/resize`, { disk: "rootfs", size }),
		);
	}

	/** Deletes a container; with `expectName`, only if it's that one. */
	async deleteLxc(vmid: number, expectName?: string) {
		let s: Awaited<ReturnType<typeof this.lxcStatus>>;
		try {
			s = await this.lxcStatus(vmid);
		} catch (err) {
			if (ProxmoxClient.gone(err)) return;
			throw err;
		}
		if (expectName) {
			const cfg = await this.get<{ hostname?: string }>(`/nodes/${this.node}/lxc/${vmid}/config`);
			if (cfg.hostname && cfg.hostname !== expectName)
				throw new ForeignVmError(
					`Container ${vmid} is "${cfg.hostname}" now, not this machine, so Sekai left it alone`,
				);
		}
		if (s.status === "running") await this.lxcPower(vmid, "stop");
		await this.wait(await this.del<string>(`/nodes/${this.node}/lxc/${vmid}`, { purge: 1, force: 1 }));
	}

	// ---------------------------------------------------------------- snapshots (checkpoints)

	/** A VM's or container's snapshots, oldest first (without Proxmox's "current" marker). */
	async snapshots(
		kind: "qemu" | "lxc",
		vmid: number,
	): Promise<{ name: string; description: string; snaptime: number }[]> {
		const rows = await this.get<{ name: string; description?: string; snaptime?: number }[]>(
			`/nodes/${this.node}/${kind}/${vmid}/snapshot`,
		);
		return rows
			.filter((r) => r.name !== "current")
			.map((r) => ({ name: r.name, description: r.description ?? "", snaptime: (r.snaptime ?? 0) * 1000 }))
			.sort((a, b) => a.snaptime - b.snaptime);
	}

	/** Whether this machine's disks can take snapshots (qcow2 on a directory, LVM-thin, ZFS, Ceph: yes; raw: no). */
	async canSnapshot(kind: "qemu" | "lxc", vmid: number): Promise<boolean> {
		const r = await this.get<{ hasFeature?: number | boolean }>(`/nodes/${this.node}/${kind}/${vmid}/feature`, {
			feature: "snapshot",
		});
		return Boolean(r.hasFeature);
	}

	/** Where backups can go: the image storage if it takes them, else the disk storage, else any that does. */
	async backupStorage(): Promise<string> {
		const all = (await this.storages()).filter((s) => s.active !== 0 && s.content.split(",").includes("backup"));
		const pick =
			all.find((s) => s.storage === this.cfg.imageStorage) ??
			all.find((s) => s.storage === this.cfg.storage) ??
			all[0];
		if (!pick)
			throw new ProxmoxError('No Proxmox storage takes backups (add "VZDump backup file" to one\'s content)', 0);
		return pick.storage;
	}

	/** A full backup (vzdump, zstd), with `notes` to find it again. The machine keeps running when it can. */
	async backup(vmid: number, storage: string, notes: string) {
		await this.wait(
			await this.post<string>(`/nodes/${this.node}/vzdump`, {
				vmid,
				storage,
				// Snapshot mode where the storage allows it; otherwise vzdump falls back to suspend on its own.
				mode: "snapshot",
				compress: "zstd",
				"notes-template": notes.replace(/[{}\n]/g, " "),
			}),
			60 * 60_000,
		);
	}

	/** A machine's backups in a storage, oldest first. */
	async backups(
		storage: string,
		vmid: number,
	): Promise<{ volid: string; ctime: number; size: number; notes: string }[]> {
		const rows = await this.get<{ volid: string; ctime?: number; size?: number; notes?: string }[]>(
			`/nodes/${this.node}/storage/${storage}/content`,
			{ content: "backup", vmid },
		);
		return rows
			.map((r) => ({ volid: r.volid, ctime: (r.ctime ?? 0) * 1000, size: r.size ?? 0, notes: r.notes ?? "" }))
			.sort((a, b) => a.ctime - b.ctime);
	}

	/** Puts a machine back from a backup, replacing it (it must be stopped). */
	async restoreBackup(kind: "qemu" | "lxc", vmid: number, volid: string, storage: string) {
		await this.wait(
			await this.post<string>(
				`/nodes/${this.node}/${kind}`,
				kind === "lxc"
					? { vmid, ostemplate: volid, restore: 1, force: 1, storage }
					: { vmid, archive: volid, force: 1, storage },
			),
			60 * 60_000,
		);
	}

	/** Takes a snapshot of the disk (not the memory, so it's quick and the machine keeps running). */
	async snapshot(kind: "qemu" | "lxc", vmid: number, name: string, description: string) {
		await this.wait(
			await this.post<string>(`/nodes/${this.node}/${kind}/${vmid}/snapshot`, {
				snapname: name,
				description,
				...(kind === "qemu" ? { vmstate: 0 } : {}),
			}),
			10 * 60_000,
		);
	}

	/** Rolls back to a snapshot, starting the machine again afterwards when `start` (a disk-only snapshot stops it). */
	async rollback(kind: "qemu" | "lxc", vmid: number, name: string, start: boolean) {
		await this.wait(
			await this.post<string>(
				`/nodes/${this.node}/${kind}/${vmid}/snapshot/${encodeURIComponent(name)}/rollback`,
				start ? { start: 1 } : {},
			),
			15 * 60_000,
		);
	}

	async deleteSnapshot(kind: "qemu" | "lxc", vmid: number, name: string) {
		await this.wait(
			await this.del<string>(`/nodes/${this.node}/${kind}/${vmid}/snapshot/${encodeURIComponent(name)}`),
			10 * 60_000,
		);
	}

	/** The newest Debian 13 container template Proxmox offers. */
	async debianTemplate(): Promise<string | null> {
		const list = await this.get<{ template: string; os?: string }[]>(`/nodes/${this.node}/aplinfo`);
		const names = list
			.map((t) => t.template)
			.filter((t) => /^debian-13-standard_.*_amd64\.tar\.(zst|gz|xz)$/.test(t));
		return names.sort().at(-1) ?? null;
	}

	async downloadTemplate(storage: string, template: string) {
		await this.wait(await this.post<string>(`/nodes/${this.node}/aplinfo`, { storage, template }), 60 * 60_000);
	}
}

/** The first IPv4 address on an interface that isn't loopback or Docker, preferring Tailscale's 100.x one. */
export function pickAddresses(ifaces: { name: string; ips: string[] }[]): {
	lan: string | null;
	tailscale: string | null;
} {
	let lan: string | null = null;
	let tailscale: string | null = null;
	for (const i of ifaces) {
		for (const ip of i.ips) {
			if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
			if (i.name.startsWith("tailscale") || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) tailscale ??= ip;
			else if (!i.name.startsWith("docker") && !i.name.startsWith("br-") && !i.name.startsWith("veth"))
				lan ??= ip;
		}
	}
	return { lan, tailscale };
}
