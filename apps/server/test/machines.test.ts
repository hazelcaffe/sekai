import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MachineSettings } from "@sekai/shared";
import { gateFor } from "../src/agent/permissions.ts";
import { randomPassword, seal, unseal } from "../src/lib/secrets.ts";
import { formatTree, pngSize } from "../src/machines/desktop.ts";
import { Guest } from "../src/machines/guest.ts";
import { buildIso, seedIso } from "../src/machines/iso.ts";
import { hostnameFor, linuxUsername } from "../src/machines/keys.ts";
import { backendOf, setupFailure, specsFor } from "../src/machines/manager.ts";
import { ForeignVmError, ProxmoxClient, pickAddresses } from "../src/machines/proxmox.ts";
import {
	computerPlan,
	computerSetupScript,
	computerUserData,
	desktopHelper,
	devboxPlan,
	devboxSetupScript,
	devboxUserData,
	HELPER_PATH,
	READY_FILE,
	SETUP_SCRIPT,
	type SetupPlan,
	toBashScript,
	toCloudConfig,
} from "../src/machines/setup.ts";
import { defaultSettings, withDefaults } from "../src/services/settings.ts";

describe("names", () => {
	test("bot names become valid Linux usernames", () => {
		expect(linuxUsername("Smoke")).toBe("smoke");
		expect(linuxUsername("Dr. Zoë Bot 3000")).toBe("dr-zoe-bot-3000");
		expect(linuxUsername("42 Ninjas")).toBe("ninjas");
		expect(linuxUsername("🐟")).toBe("bot");
		expect(linuxUsername("root")).toBe("root-bot");
		expect(linuxUsername("x".repeat(80)).length).toBeLessThanOrEqual(30);
		expect(hostnameFor("Pip", "dev-api")).toBe("pip-dev-api");
	});
});

describe("addresses", () => {
	test("Tailscale and LAN are told apart; loopback and Docker are skipped", () => {
		expect(
			pickAddresses([
				{ name: "lo", ips: ["127.0.0.1", "::1"] },
				{ name: "docker0", ips: ["172.17.0.1"] },
				{ name: "ens18", ips: ["192.168.0.40", "fe80::1"] },
				{ name: "tailscale0", ips: ["100.101.102.103"] },
			]),
		).toEqual({ lan: "192.168.0.40", tailscale: "100.101.102.103" });
		expect(pickAddresses([{ name: "eth0", ips: ["10.0.0.5"] }])).toEqual({ lan: "10.0.0.5", tailscale: null });
	});
});

describe("cloud-init seed", () => {
	test("an ISO 9660 image with Joliet names and the cidata label", () => {
		const iso = seedIso("#cloud-config\n", "instance-id: x\n");
		expect(iso.length % 2048).toBe(0);
		const at = (sector: number, len: number) =>
			new TextDecoder().decode(iso.slice(sector * 2048, sector * 2048 + len));
		expect(at(16, 6).slice(1)).toBe("CD001");
		expect(iso[16 * 2048]).toBe(1);
		expect(iso[17 * 2048]).toBe(2);
		expect(iso[18 * 2048]).toBe(255);
		expect(at(16, 72).slice(40).trim()).toBe("CIDATA");
		// Joliet escape sequence for UCS-2 level 3.
		expect([...iso.slice(17 * 2048 + 88, 17 * 2048 + 91)]).toEqual([0x25, 0x2f, 0x45]);
		const text = new TextDecoder().decode(iso);
		expect(text).toContain("#cloud-config");
		expect(text).toContain("instance-id: x");
	});

	test("only a flat directory that fits in one sector", () => {
		const many = Array.from({ length: 60 }, (_, i) => ({ name: `file-${i}`, data: new Uint8Array(1) }));
		expect(() => buildIso(many, "x")).toThrow();
	});

	test("the computer's cloud-config sets up the desktop, access and Tailscale", () => {
		const ud = computerUserData({
			hostname: "pip",
			displayName: "Pip",
			username: "pip",
			userPassword: "u-pass",
			rootPassword: "r-pass",
			vncPassword: "vncpass1",
			publicKey: "ssh-ed25519 AAAA test",
			tailscaleAuthKey: "tskey-auth-123",
			timezone: "UTC",
		});
		expect(ud.startsWith("#cloud-config\n")).toBe(true);
		const cfg = JSON.parse(ud.slice("#cloud-config\n".length));
		expect(cfg.packages).toEqual(
			expect.arrayContaining(["xfce4", "xfce4-goodies", "x11vnc", "xrdp", "qemu-guest-agent"]),
		);
		expect(cfg.users[0]).toMatchObject({
			name: "pip",
			sudo: "ALL=(ALL) NOPASSWD:ALL",
			ssh_authorized_keys: ["ssh-ed25519 AAAA test"],
		});
		expect(cfg.chpasswd.users).toEqual([
			{ name: "root", password: "r-pass", type: "text" },
			{ name: "pip", password: "u-pass", type: "text" },
		]);
		const run = JSON.stringify(cfg.runcmd);
		expect(run).toContain("google-chrome-stable");
		expect(run).toContain("tailscale up --authkey=");
		expect(run).toContain("/var/lib/sekai/ready");
		expect(cfg.write_files.some((f: { path: string }) => f.path === "/usr/local/bin/sekai-desktop")).toBe(true);
	});

	test("without a Tailscale key, nothing joins a tailnet", () => {
		const base = {
			hostname: "pip",
			displayName: "Pip",
			username: "pip",
			userPassword: "u",
			rootPassword: "r",
			publicKey: "k",
			tailscaleAuthKey: "",
			timezone: "UTC",
		};
		expect(computerUserData({ ...base, vncPassword: "v" })).not.toContain("tailscale");
		expect(devboxSetupScript(base)).not.toContain("tailscale");
		expect(devboxSetupScript({ ...base, tailscaleAuthKey: "tskey" })).toContain("userspace-networking");
	});
});

describe("secrets", () => {
	test("round trip, and every seal is different", () => {
		const a = seal("hunter2");
		expect(unseal(a)).toBe("hunter2");
		expect(seal("hunter2")).not.toBe(a);
		expect(() => unseal(`${a.slice(0, -4)}AAAA`)).toThrow();
	});

	test("passwords use the readable alphabet", () => {
		const p = randomPassword(64);
		expect(p).toHaveLength(64);
		expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
	});
});

describe("Proxmox client", () => {
	function fake(routes: Record<string, (url: URL, init: RequestInit) => unknown>) {
		const calls: string[] = [];
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const key = `${init?.method ?? "GET"} ${url.pathname.replace("/api2/json", "")}`;
			calls.push(key);
			const handler = Object.entries(routes).find(([k]) => key.startsWith(k))?.[1];
			if (!handler) return new Response("nope", { status: 501, statusText: "Not Implemented" });
			const out = handler(url, init ?? {});
			if (out instanceof Response) return out;
			return Response.json({ data: out });
		}) as typeof fetch;
		const client = new ProxmoxClient(
			{
				url: "https://pve:8006",
				tokenId: "sekai@pve!bots",
				tokenSecret: "s3cret",
				node: "pve",
				storage: "local-lvm",
				imageStorage: "local",
				bridge: "vmbr0",
				vmidStart: 7000,
				insecureTls: true,
			},
			fetcher,
		);
		return { client, calls };
	}

	test("token auth, and the first free id from the start", async () => {
		let auth = "";
		const { client } = fake({
			"GET /cluster/resources": (_u, init) => {
				auth = (init.headers as Record<string, string>).authorization ?? "";
				return [{ vmid: 7000 }, { vmid: 7001 }, { vmid: 105 }];
			},
		});
		expect(await client.freeVmid(7000)).toBe(7002);
		expect(auth).toBe("PVEAPIToken=sekai@pve!bots=s3cret");
	});

	test("a failed task reports its log", async () => {
		const upid = "UPID:pve:0001:0002:0003:qmcreate:7002:root@pam:";
		const { client } = fake({
			"POST /nodes/pve/qemu": () => upid,
			"GET /nodes/pve/tasks": (url) =>
				url.pathname.endsWith("/status")
					? { status: "stopped", exitstatus: "command failed" }
					: [{ t: "starting" }, { t: "storage 'local-lvm' does not exist" }, { t: "TASK ERROR" }],
		});
		await expect(client.createVm({ vmid: 7002 })).rejects.toThrow(/does not exist/);
	});

	test("API errors carry Proxmox's reason", async () => {
		const { client } = fake({
			"GET /version": () => new Response("", { status: 401, statusText: "authentication failure" }),
		});
		await expect(client.version()).rejects.toThrow("authentication failure");
	});

	test("not set up yet", async () => {
		const c = new ProxmoxClient({
			url: "",
			tokenId: "",
			tokenSecret: "",
			node: "",
			storage: "",
			imageStorage: "",
			bridge: "",
			vmidStart: 100,
			insecureTls: false,
		});
		await expect(c.version()).rejects.toThrow(/isn't set up/);
	});
});

describe("approvals", () => {
	test("askFirst always asks: in YOLO, and even over an allow rule (only an off rule or read-only stops it)", () => {
		const tool = {
			name: "computer_request",
			category: "machines",
			risk: "write" as const,
			askFirst: "Bots ask first.",
		};
		const none = { conversation: {}, agent: {}, global: {} };
		expect(gateFor(tool, "yolo", none)).toMatchObject({
			action: "ask",
			reason: "Bots ask first.",
			alwaysAsk: true,
		});
		expect(gateFor(tool, "yolo", { ...none, global: { computer_request: "allow" } })).toMatchObject({
			action: "ask",
			alwaysAsk: true,
		});
		expect(gateFor(tool, "yolo", { ...none, global: { computer_request: "off" } })).toMatchObject({
			action: "deny",
		});
		expect(gateFor(tool, "readonly", none)).toMatchObject({ action: "deny" });
		expect(gateFor({ ...tool, askFirst: null }, "yolo", none)).toMatchObject({ action: "run" });
	});
});

describe("desktop", () => {
	test("PNG size from the header", () => {
		const png = new Uint8Array(24);
		png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		new DataView(png.buffer).setUint32(16, 1280);
		new DataView(png.buffer).setUint32(20, 800);
		expect(pngSize(png)).toEqual({ width: 1280, height: 800 });
	});

	test("the accessibility tree in screenshot pixels", () => {
		const text = formatTree(
			{
				activeWindow: "Notes",
				apps: ["mousepad"],
				elements: [
					{
						id: "0.1.2",
						role: "push button",
						name: "Save",
						box: [900, 450, 90, 36],
						states: ["focused"],
						value: null,
						actions: ["click"],
					},
				],
			},
			1.125,
		);
		expect(text).toContain('[0.1.2] push button "Save" at (800,400 80x32) focused actions:click');
		expect(text).toContain("Active window: Notes");
	});
});

describe("Proxmox permission errors", () => {
	test("say what to change in Proxmox", async () => {
		const { permissionHelp } = await import("../src/machines/proxmox.ts");
		const msg = permissionHelp(
			"root@pam!sekai",
			"Permission check failed (/storage/local, Datastore.Audit|Datastore.AllocateSpace)",
		);
		expect(msg).toContain("on /storage/local");
		expect(msg).toContain("Datastore.Audit or Datastore.AllocateSpace");
		expect(msg).toContain("Privilege Separation");
	});
});

describe("setup, described once for VMs and containers", () => {
	const input = {
		hostname: "pip",
		displayName: "Pip",
		username: "pip",
		userPassword: "user-Secret-1",
		rootPassword: "root-Secret-2",
		vncPassword: "vncSec3t",
		publicKey: "ssh-ed25519 AAAA test",
		tailscaleAuthKey: "tskey-auth-Secret4",
		timezone: "Europe/Paris",
	};
	const secrets = [input.userPassword, input.rootPassword, input.vncPassword, input.tailscaleAuthKey];
	const cloud = (plan: SetupPlan) => JSON.parse(toCloudConfig(plan).slice("#cloud-config\n".length));
	/** The files a bash script writes, decoded. */
	function bashFiles(script: string): Map<string, string> {
		const files = new Map<string, string>();
		for (const m of script.matchAll(/base64 -d > '([^']+)' <<'SEKAI_FILE'\n([\s\S]*?)\nSEKAI_FILE/g)) {
			files.set(m[1] ?? "", Buffer.from((m[2] ?? "").replace(/\n/g, ""), "base64").toString("utf8"));
		}
		return files;
	}

	for (const [kind, plan] of [
		["computer on a VM", computerPlan(input, "vm")],
		["computer in a container", computerPlan(input, "lxc")],
		["devbox on a VM", devboxPlan(input, "vm")],
		["devbox in a container", devboxPlan(input, "lxc")],
	] as const) {
		test(`${kind}: cloud-init and bash carry the same packages, files and steps`, () => {
			const cfg = cloud(plan);
			const sh = toBashScript(plan);
			expect(cfg.packages).toEqual(plan.packages);
			const apt = sh.split("\n").find((l) => l.startsWith("apt-get install")) ?? "";
			for (const p of plan.packages) expect(apt.split(" ")).toContain(p);
			const written = bashFiles(sh);
			for (const f of plan.files) {
				expect(written.get(f.path)).toBe(f.content);
				const entry = cfg.write_files.find((w: { path: string }) => w.path === f.path);
				const content =
					entry.encoding === "b64" ? Buffer.from(entry.content, "base64").toString("utf8") : entry.content;
				expect(content).toBe(f.content);
				expect(Boolean(entry.defer)).toBe(Boolean(f.user));
			}
			const runcmd = JSON.stringify(cfg.runcmd);
			for (const s of plan.steps) {
				expect(sh).toContain(s.run);
				expect(runcmd).toContain(JSON.stringify(s.run).slice(1, -1));
				if (s.label) {
					expect(sh).toContain(`progress '${s.label}'`);
					expect(runcmd).toContain(s.label);
				}
			}
			expect(cfg.users[0]).toMatchObject({ name: "pip", groups: plan.user.groups });
			expect(sh).toContain(`useradd -m -s /bin/bash -c 'Pip' -G ${plan.user.groups.join(",")} pip`);
			expect(cfg.timezone).toBe("Europe/Paris");
			expect(sh).toContain("/usr/share/zoneinfo/Europe/Paris");
			expect(runcmd).toContain(READY_FILE);
			expect(sh).toContain(`date +%s > ${READY_FILE}`);
			expect(Bun.spawnSync(["bash", "-n", "-c", sh]).exitCode).toBe(0);
		});
	}

	test("both backends of a computer get the same desktop", () => {
		const vm = computerPlan(input, "vm");
		const lxc = computerPlan(input, "lxc");
		for (const p of [
			"xfce4",
			"xfce4-goodies",
			"x11vnc",
			"xrdp",
			"xorgxrdp",
			"xdotool",
			"at-spi2-core",
			"fonts-noto",
		]) {
			expect(vm.packages).toContain(p);
			expect(lxc.packages).toContain(p);
		}
		const labels = (p: SetupPlan) => p.steps.flatMap((s) => (s.label ? [s.label] : []));
		expect(labels(lxc)).toEqual(labels(vm));
		const shared = vm.files.filter((f) => lxc.files.some((g) => g.path === f.path));
		for (const path of [
			"/usr/local/bin/sekai-desktop",
			"/etc/opt/chrome/policies/managed/sekai.json",
			"/etc/systemd/system/sekai-vnc@.service",
			"/home/pip/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml",
			"/home/pip/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-power-manager.xml",
		]) {
			expect(shared.some((f) => f.path === path)).toBe(true);
		}
		expect(vm.packages).toContain("qemu-guest-agent");
		expect(lxc.packages).not.toContain("qemu-guest-agent");
	});

	test("the container's computer: a virtual screen on :0, x11vnc, Chrome, the helper, RDP, no display manager", () => {
		const sh = computerSetupScript(input);
		const files = bashFiles(sh);
		expect(sh).toMatch(/apt-get install .* xvfb .* lightdm-$/m);
		expect(files.get("/usr/local/bin/sekai-session")).toContain('Xvfb "$DISPLAY" -screen 0 "$SCREEN"x24');
		expect(files.get("/usr/local/bin/sekai-session")).toContain("startxfce4");
		expect(files.get("/etc/sekai/desktop/pip.env")).toBe("DISPLAY=:0\nSCREEN=1440x900\nVNC_PORT=5900\n");
		const session = files.get("/etc/systemd/system/sekai-desktop@.service") ?? "";
		expect(session).toContain("User=%i");
		expect(session).toContain("PAMName=login");
		const vnc = files.get("/etc/systemd/system/sekai-vnc@.service") ?? "";
		expect(vnc).toContain("User=%i");
		expect(vnc).toContain("-rfbport $VNC_PORT");
		expect(files.get(HELPER_PATH)).toBe(desktopHelper);
		expect(files.get("/etc/opt/chrome/policies/managed/sekai.json")).toContain('"PasswordManagerEnabled": false');
		expect(files.get("/home/pip/.xsession")).toContain("dbus-run-session -- startxfce4");
		expect(sh).toContain("google-chrome-stable_current_amd64.deb");
		expect(sh).toContain("x11vnc -storepasswd");
		expect(sh).toContain("systemctl enable --now sekai-desktop@pip");
		expect(sh).toContain("--tun=userspace-networking");
		expect(sh).not.toContain("qemu-guest-agent");
		expect(sh).not.toContain("lightdm.conf");
	});

	test("the VM's computer keeps lightdm's autologin and the guest agent", () => {
		const cfg = cloud(computerPlan(input, "vm"));
		const lightdm = cfg.write_files.find((f: { path: string }) => f.path.startsWith("/etc/lightdm/"));
		expect(lightdm.content).toContain("autologin-user=pip");
		expect(JSON.stringify(cfg.runcmd)).toContain("systemctl start qemu-guest-agent");
		expect(JSON.stringify(cfg.runcmd)).not.toContain("userspace-networking");
		expect(JSON.stringify(cfg.runcmd)).toContain("systemctl restart lightdm");
	});

	test("a devbox VM has no desktop", () => {
		const ud = devboxUserData(input);
		expect(ud).not.toContain("xfce4");
		expect(ud).not.toContain("x11vnc");
		expect(ud).toContain("qemu-guest-agent");
	});

	test("secrets stay out of the setup log and are removed afterwards", () => {
		for (const sh of [computerSetupScript(input), devboxSetupScript(input)]) {
			const lines = sh.split("\n");
			// Everything after this goes to the log; nothing traces commands.
			expect(lines.findIndex((l) => l.startsWith("exec >>"))).toBeLessThan(
				lines.findIndex((l) => secrets.some((s) => l.includes(s))),
			);
			expect(sh).not.toMatch(/set -[a-z]*x|set -o xtrace/);
			for (const line of lines.filter((l) => secrets.some((s) => l.includes(s)))) {
				// Into chpasswd, x11vnc's password file (its message thrown away) or tailscale up, which don't print them.
				expect(/\| chpasswd$|-storepasswd '[^']+' \S+ >\/dev\/null|tailscale up --authkey=/.test(line)).toBe(
					true,
				);
				expect(line).not.toMatch(/progress '.*Secret/);
			}
			expect(sh).toContain(`trap 'rc=$?; rm -f ${SETUP_SCRIPT};`);
		}
		for (const plan of [computerPlan(input, "vm"), devboxPlan(input, "vm")]) {
			const last = JSON.stringify(cloud(plan).runcmd.at(-1));
			for (const copy of ["user-data.txt", "cloud-config.txt", "obj.pkl", "combined-cloud-config.json"]) {
				expect(last).toContain(copy);
			}
			expect(last).toContain("touch /etc/cloud/cloud-init.disabled");
		}
	});

	test("a failed setup reads as the end of its log", () => {
		expect(
			setupFailure(
				"== Installing tools\nGet:1 http://deb.debian.org trixie InRelease\nE: Unable to locate package nope\n\n",
			),
		).toBe("Setup failed: Get:1 http://deb.debian.org trixie InRelease / E: Unable to locate package nope");
		expect(setupFailure("")).toBe("Setup failed");
	});
});

describe("backends", () => {
	test("Proxmox machines from before backends: computers were VMs, devboxes containers", () => {
		expect(backendOf({ provider: "proxmox", kind: "computer", backend: null })).toBe("vm");
		expect(backendOf({ provider: "proxmox", kind: "devbox", backend: null })).toBe("lxc");
		expect(backendOf({ provider: "proxmox", kind: "computer", backend: "lxc" })).toBe("lxc");
		expect(backendOf({ provider: "proxmox", kind: "devbox", backend: "vm" })).toBe("vm");
		expect(backendOf({ provider: "ssh", kind: "computer", backend: null })).toBeNull();
		expect(backendOf({ provider: "local", kind: "device", backend: null })).toBeNull();
		const sql = readFileSync(join(import.meta.dir, "../drizzle/0016_machine_backend.sql"), "utf8");
		expect(sql).toContain(`ADD COLUMN "backend" text`);
		expect(sql).toContain(
			`UPDATE "machines" SET "backend" = CASE WHEN "kind" = 'computer' THEN 'vm' ELSE 'lxc' END WHERE "provider" = 'proxmox'`,
		);
	});

	test("settings saved before backends load with the defaults", () => {
		const base = defaultSettings();
		const { computerBackend: _c, devboxBackend: _d, ...old } = { ...base.machines, devboxTtlHours: 6 };
		const merged = withDefaults(base, { machines: old as never });
		expect(merged.machines.computerBackend).toBe("vm");
		expect(merged.machines.devboxBackend).toBe("lxc");
		expect(merged.machines.devboxTtlHours).toBe(6);
		expect(MachineSettings.parse(old)).toMatchObject({ computerBackend: "vm", devboxBackend: "lxc" });
		const chosen = withDefaults(base, { machines: { ...base.machines, computerBackend: "lxc" } });
		expect(chosen.machines.computerBackend).toBe("lxc");
	});

	test("only computers on VMs balloon", () => {
		const base = { cores: 4, memoryMb: 8192, minMemoryMb: 2048, diskGb: 64 };
		expect(specsFor("computer", "vm", base).minMemoryMb).toBe(2048);
		expect(specsFor("computer", "lxc", base).minMemoryMb).toBe(0);
		expect(specsFor("devbox", "vm", base).minMemoryMb).toBe(0);
		expect(specsFor("computer", "vm", base, { memoryMb: 1024 }).minMemoryMb).toBe(1024);
	});

	function fakeProxmox(status = "running") {
		const calls: string[] = [];
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const path = url.pathname.replace("/api2/json", "");
			const body = init?.body instanceof URLSearchParams ? `?${init.body}` : url.search;
			calls.push(`${init?.method ?? "GET"} ${path}${body}`);
			if (path.endsWith("/status/current")) return Response.json({ data: { status } });
			if (path.endsWith("/config") && (init?.method ?? "GET") === "GET") {
				return Response.json({
					data: { name: "pip", hostname: "pip", ide2: "local:iso/sekai-seed-9100.iso,media=cdrom" },
				});
			}
			return Response.json({ data: null });
		}) as typeof fetch;
		const px = new ProxmoxClient(
			{
				url: "https://pve:8006",
				tokenId: "sekai@pve!bots",
				tokenSecret: "s3cret",
				node: "pve",
				storage: "local-lvm",
				imageStorage: "local",
				bridge: "vmbr0",
				vmidStart: 9100,
				insecureTls: true,
			},
			fetcher,
		);
		return { px, calls };
	}

	test("a container resizes live, without ballooning; a VM asks for a restart", async () => {
		const from = { cores: 2, memoryMb: 4096, minMemoryMb: 0, diskGb: 16 };
		const to = { cores: 4, memoryMb: 6144, minMemoryMb: 0, diskGb: 20 };
		const lxc = fakeProxmox();
		expect(await new Guest(lxc.px, 9100, "lxc", "pip", "local").resize(from, to)).toBe(false);
		expect(lxc.calls).toEqual([
			"PUT /nodes/pve/lxc/9100/config?cores=4&memory=6144",
			"PUT /nodes/pve/lxc/9100/resize?disk=rootfs&size=20G",
		]);
		const vm = fakeProxmox();
		expect(await new Guest(vm.px, 9100, "vm", "pip", "local").resize(from, to)).toBe(true);
		expect(vm.calls).toEqual([
			"POST /nodes/pve/qemu/9100/config?cores=4&memory=6144&balloon=0",
			"PUT /nodes/pve/qemu/9100/resize?disk=scsi0&size=20G",
		]);
		const same = fakeProxmox();
		expect(await new Guest(same.px, 9100, "vm", "pip", "local").resize(from, { ...from, diskGb: 20 })).toBe(false);
	});

	test("power, delete and checkpoints go to the right kind of guest", async () => {
		const lxc = fakeProxmox();
		const ct = new Guest(lxc.px, 9100, "lxc", "pip", "local");
		expect(ct.kind).toBe("lxc");
		await ct.power("start");
		await ct.remove();
		expect(lxc.calls).toEqual([
			"POST /nodes/pve/lxc/9100/status/start?",
			"GET /nodes/pve/lxc/9100/status/current",
			"GET /nodes/pve/lxc/9100/config",
			"POST /nodes/pve/lxc/9100/status/stop?",
			"DELETE /nodes/pve/lxc/9100?purge=1&force=1",
		]);

		const vm = fakeProxmox("stopped");
		const guest = new Guest(vm.px, 9100, "vm", "pip", "local");
		expect(guest.kind).toBe("qemu");
		// Starting a VM ejects a leftover setup seed first (it was deleted, so the VM couldn't start).
		await guest.power("start");
		expect(vm.calls).toEqual([
			"GET /nodes/pve/qemu/9100/config?current=1",
			"POST /nodes/pve/qemu/9100/config?ide2=none%2Cmedia%3Dcdrom",
			"POST /nodes/pve/qemu/9100/status/start?",
		]);
		vm.calls.length = 0;
		await guest.remove();
		expect(vm.calls).toEqual([
			"GET /nodes/pve/qemu/9100/status/current",
			"GET /nodes/pve/qemu/9100/config",
			"DELETE /nodes/pve/qemu/9100?purge=1&destroy-unreferenced-disks=1",
			"DELETE /nodes/pve/storage/local/content/local%3Aiso%2Fsekai-seed-9100.iso",
		]);
	});

	test("a VM still starting (no guest agent yet) restarts the hard way", async () => {
		const calls: string[] = [];
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			const path = new URL(String(input)).pathname.replace("/api2/json/nodes/pve/qemu/9100", "");
			calls.push(`${init?.method ?? "GET"} ${path}`);
			if (path === "/status/reboot") {
				return new Response("", {
					status: 500,
					statusText: "VM quit/powerdown failed - got timeout: QEMU Guest Agent is not running",
				});
			}
			return Response.json({ data: path === "/config" ? {} : null });
		}) as typeof fetch;
		const px = new ProxmoxClient(
			{
				url: "https://pve:8006",
				tokenId: "t",
				tokenSecret: "s",
				node: "pve",
				storage: "local",
				imageStorage: "local",
				bridge: "vmbr0",
				vmidStart: 9100,
				insecureTls: true,
			},
			fetcher,
		);
		await new Guest(px, 9100, "vm", "pip", "local").power("reboot");
		expect(calls).toEqual(["POST /status/reboot", "POST /status/stop", "POST /status/start"]);
	});

	test("a guest that took over the id is left alone", async () => {
		const { px } = fakeProxmox();
		await expect(new Guest(px, 9100, "lxc", "someone-else", "local").remove()).rejects.toBeInstanceOf(
			ForeignVmError,
		);
		await expect(new Guest(px, 9100, "vm", "someone-else", "local").remove()).rejects.toBeInstanceOf(
			ForeignVmError,
		);
	});
});
