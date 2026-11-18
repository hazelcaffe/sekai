import { describe, expect, test } from "bun:test";
import { gateFor } from "../src/agent/permissions.ts";
import { randomPassword, seal, unseal } from "../src/lib/secrets.ts";
import { computerUserData, devboxSetupScript } from "../src/machines/cloudinit.ts";
import { formatTree, pngSize } from "../src/machines/desktop.ts";
import { buildIso, seedIso } from "../src/machines/iso.ts";
import { hostnameFor, linuxUsername } from "../src/machines/keys.ts";
import { ProxmoxClient, pickAddresses } from "../src/machines/proxmox.ts";

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
