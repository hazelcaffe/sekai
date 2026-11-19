import { describe, expect, test } from "bun:test";
import type { Machine } from "@sekai/shared";
import { browserTools } from "../src/agent/tools/browser.ts";
import { computerTools } from "../src/agent/tools/computer.ts";
import { toolAllowed } from "../src/agent/tools/index.ts";
import { type Actor, runAs } from "../src/auth/actor.ts";
import { nextSharedPort } from "../src/browser/shared.ts";
import { pickMachine } from "../src/machines/drivers.ts";
import { seatOf, seatOfMember, seatPorts } from "../src/machines/manager.ts";
import { seatSecrets, seatView } from "../src/machines/seats.ts";
import {
	FIRST_MEMBER_DISPLAY,
	LAST_MEMBER_DISPLAY,
	memberRemoveScript,
	memberSetupScript,
	nextDisplay,
	uniqueUsername,
} from "../src/machines/setup.ts";
import { shq } from "../src/machines/ssh.ts";
import { sharedRule } from "../src/services/visibility.ts";

const OWNER = "usr_owner";
const OTHER = "usr_other";
const VIEWER = "usr_viewer";

describe("who may use a shared machine or browser", () => {
	const off = { ownerId: OWNER, shareWithViewers: false };
	const on = { ownerId: OWNER, shareWithViewers: true };
	const mine = { userId: OWNER };
	const theirs = { userId: OTHER };

	test("in the owner's runs: their bots, and bots shared with them", () => {
		expect(sharedRule(off, mine, OWNER, false)).toBe(true);
		expect(sharedRule(off, theirs, OWNER, true)).toBe(true);
		// A bot that's no longer shared with the owner can't.
		expect(sharedRule(off, theirs, OWNER, false)).toBe(false);
	});

	test("for someone the owner's bot is shared with: only with the switch on", () => {
		expect(sharedRule(off, mine, VIEWER, true)).toBe(false);
		expect(sharedRule(on, mine, VIEWER, true)).toBe(true);
		// Not a bot they can see.
		expect(sharedRule(on, mine, VIEWER, false)).toBe(false);
	});

	test("a bot someone shared with the owner never uses it outside the owner's runs", () => {
		// In its own owner's chats…
		expect(sharedRule(off, theirs, OTHER, false)).toBe(false);
		expect(sharedRule(on, theirs, OTHER, false)).toBe(false);
		// …or anyone else's, switch or not.
		expect(sharedRule(on, theirs, VIEWER, true)).toBe(false);
	});

	test("Sekai's own work for a bot counts as its owner's", () => {
		expect(sharedRule(off, mine, null, false)).toBe(true);
		expect(sharedRule(on, theirs, null, false)).toBe(false);
	});
});

describe("tools in someone else's run", () => {
	const actor = (userId: string): Actor =>
		({
			userId,
			roleId: "role_admin",
			roleName: "Admin",
			admin: true,
			permissions: ["admin"],
			limits: { maxBots: null, maxTokensPerDay: null, maxCostPerMonth: null, maxStorageMb: null, models: null },
			can: new Set(["admin"]),
		}) as unknown as Actor;
	const bot = { userId: OTHER };
	const tool = (name: string, category: string) => ({ name, category });

	test("only what's shared reaches: a seat's commands, a screen, a browser", () => {
		runAs(actor(OWNER), () => {
			const none = undefined;
			const seat = { machines: true, screens: false, browsers: false };
			const all = { machines: true, screens: true, browsers: true };
			expect(toolAllowed(tool("run_command", "machines"), bot, none)).toBe(false);
			expect(toolAllowed(tool("run_command", "machines"), bot, seat)).toBe(true);
			expect(toolAllowed(tool("computer_screenshot", "computer"), bot, seat)).toBe(false);
			expect(toolAllowed(tool("computer_screenshot", "computer"), bot, all)).toBe(true);
			expect(toolAllowed(tool("browser_open", "browser"), bot, all)).toBe(true);
			// Machine-wide things, new machines and the bot's accounts stay its owner's.
			for (const name of ["machine_checkpoint", "computer_resize", "devbox_create", "computer_request"]) {
				expect(toolAllowed(tool(name, "machines"), bot, all)).toBe(false);
			}
			expect(toolAllowed(tool("browser_social", "browser"), bot, all)).toBe(false);
			expect(toolAllowed(tool("browser_account", "browser"), bot, all)).toBe(false);
			expect(toolAllowed(tool("extension_browser", "browser"), bot, all)).toBe(false);
			// Its own owner's runs are untouched.
			expect(toolAllowed(tool("devbox_create", "machines"), { userId: OWNER }, none)).toBe(true);
		});
	});

	test("every computer_ and browser_ tool is covered", () => {
		expect(computerTools.length).toBeGreaterThan(5);
		expect(browserTools.every((t) => t.category === "browser")).toBe(true);
	});
});

const machine = (over: Partial<Machine> = {}): Machine => ({
	id: "mch_1",
	agentId: "agt_owner",
	kind: "computer",
	provider: "proxmox",
	backend: "lxc",
	name: "Ada's computer",
	status: "running",
	statusDetail: null,
	specs: { cores: 2, memoryMb: 4096, minMemoryMb: 0, diskGb: 32 },
	hostname: "ada",
	username: "ada",
	addresses: { lan: "192.168.0.50", tailscale: null },
	ports: { ssh: 22, vnc: 5900, rdp: 3389 },
	remoteId: "pve/9100",
	expiresAt: null,
	shareWithViewers: false,
	createdBy: "user",
	createdAt: 1,
	updatedAt: 1,
	lastUsedAt: null,
	...over,
});

const member = (over: Record<string, unknown> = {}) => ({
	id: "mbr_1",
	machineId: "mch_1",
	agentId: "agt_bo",
	username: "bo",
	display: 10,
	vncPort: 5910,
	cdpPort: 9232,
	status: "ready" as const,
	statusDetail: null,
	secrets: "sealed",
	createdAt: 2,
	updatedAt: 2,
	...over,
});

describe("seats", () => {
	test("the machine's own bot keeps today's seat: its account, :0, VNC 5900, Chrome 9222", async () => {
		const seat = await seatOf(machine());
		expect(seat).toMatchObject({ own: true, username: "ada", display: 0, vncPort: 5900, cdpPort: 9222 });
		expect(
			(await seatOf(machine({ kind: "devbox", ports: { ssh: 22, vnc: null, rdp: null } }))).display,
		).toBeNull();
	});

	test("a member's seat is its own account, screen and ports", () => {
		expect(seatOfMember(member())).toMatchObject({
			own: false,
			agentId: "agt_bo",
			username: "bo",
			display: 10,
			vncPort: 5910,
			cdpPort: 9232,
		});
	});

	test("a member sees the machine with its own account, VNC port and the seat's state", () => {
		const view = seatView(machine(), member(), "Ada");
		expect(view).toMatchObject({
			username: "bo",
			ports: { vnc: 5910 },
			status: "running",
			seat: { ownerBot: "Ada" },
		});
		expect(seatView(machine(), member({ status: "adding", statusDetail: "Installing" }), "Ada")).toMatchObject({
			status: "provisioning",
			statusDetail: "Installing",
		});
		expect(seatView(machine(), member({ status: "error", statusDetail: "No room" }), "Ada").status).toBe("error");
		expect(seatView(machine({ status: "stopped" }), member(), "Ada").status).toBe("stopped");
	});

	test("a bot someone else owns gets a key of its seat's own; yours use their usual key", async () => {
		const theirs = await seatSecrets("bo", true, true);
		expect(theirs.key?.publicKey).toStartWith("ssh-ed25519 ");
		expect(theirs.key?.privateKey).toContain("PRIVATE KEY");
		expect(theirs.vncPassword).toHaveLength(8);
		const mine = await seatSecrets("ada", false, false);
		expect(mine.key).toBeUndefined();
		expect(mine.vncPassword).toBeNull();
		expect(mine.userPassword.length).toBeGreaterThanOrEqual(20);
	});

	test('"computer" is the bot\'s own computer first, then a shared one', () => {
		const own = { ...machine({ id: "mch_own", name: "Mine" }), seat: null };
		const shared = { ...seatView(machine({ id: "mch_shared", name: "Ada's computer" }), member(), "Ada") };
		expect(pickMachine([own, shared], "computer")?.id).toBe("mch_own");
		expect(pickMachine([shared], undefined)?.id).toBe("mch_shared");
		expect(pickMachine([own, shared], "Ada's computer")?.id).toBe("mch_shared");
	});
});

describe("screens and ports", () => {
	test("members' screens start at :10 and skip taken ones", () => {
		expect(nextDisplay([])).toBe(FIRST_MEMBER_DISPLAY);
		expect(nextDisplay([0, 10, 11, 13])).toBe(12);
		expect(nextDisplay(Array.from({ length: 100 }, (_, i) => i))).toBeNull();
		expect(seatPorts(12)).toEqual({ vncPort: 5912, cdpPort: 9234 });
		// Members' Chromes stay below the shared browsers' ports.
		expect(seatPorts(LAST_MEMBER_DISPLAY).cdpPort).toBeLessThan(9300);
	});

	test("shared browsers' Chromes take ports from 9300", () => {
		expect(nextSharedPort([])).toBe(9300);
		expect(nextSharedPort([9300, 9302])).toBe(9301);
	});

	test("usernames are unique on the machine", () => {
		expect(uniqueUsername("bo", ["ada", "root"])).toBe("bo");
		expect(uniqueUsername("bo", ["bo", "bo-2"])).toBe("bo-3");
		expect(uniqueUsername("x".repeat(30), ["x".repeat(30)]).length).toBeLessThanOrEqual(32);
	});
});

describe("a member's setup", () => {
	const input = {
		username: "bo",
		displayName: `Bo "$(rm -rf /)" O'Neil`,
		password: "p'a$s`w\"d-123",
		publicKey: "ssh-ed25519 AAAAC3Nza bo@sekai",
		desktop: { display: 11, vncPassword: "v'n$c1" },
	};

	test("is valid bash, and quotes what a bot or a password could hold", () => {
		const script = memberSetupScript(input);
		const check = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(script) });
		expect(check.exitCode).toBe(0);
		expect(script).toContain(`-c 'Bo "$(rm -rf /)" O'\\''Neil'`);
		expect(script).toContain(`echo 'bo:p'\\''a$s\`w"d-123' | chpasswd`);
		expect(script).toContain(`x11vnc -storepasswd 'v'\\''n$c1' /etc/sekai/vnc/bo.pass >/dev/null 2>&1`);
	});

	test("never prints a password to its log", () => {
		const script = memberSetupScript(input);
		const secrets = [shq(`bo:${input.password}`), shq(input.desktop.vncPassword)];
		const lines = script.split("\n").filter((l) => secrets.some((x) => l.includes(x)));
		// Only the two lines that set them, and neither echoes to the log.
		expect(lines).toHaveLength(2);
		expect(script).not.toContain("set -x");
		expect(lines.every((l) => /\| chpasswd$|>\/dev\/null 2>&1$/.test(l))).toBe(true);
		// The script removes itself when it ends (it holds the passwords).
		expect(script).toContain("rm -f /var/lib/sekai/members/bo/setup.sh");
	});

	test("gives it its own sudo, key, and on a computer its own screen and VNC", () => {
		const script = memberSetupScript(input);
		expect(script).toContain("/etc/sudoers.d/91-sekai-bo");
		expect(script).toContain("/home/bo/.ssh/authorized_keys");
		expect(script).toContain("sekai-desktop@bo");
		expect(script).toContain("sekai-vnc@bo");
		// The env file the desktop helper reads: display :11, VNC 5911.
		const env = Buffer.from("DISPLAY=:11\nSCREEN=1440x900\nVNC_PORT=5911\n").toString("base64");
		expect(script.replace(/\n/g, "")).toContain(env);
		const devbox = memberSetupScript({ ...input, desktop: null });
		expect(devbox).not.toContain("sekai-desktop@");
		expect(Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(devbox) }).exitCode).toBe(0);
	});

	test("removing refuses names that aren't plain accounts", () => {
		expect(() => memberRemoveScript("bo; rm -rf /")).toThrow();
		expect(() => memberSetupScript({ ...input, username: "-o" })).toThrow();
		const remove = memberRemoveScript("bo", 11);
		expect(remove).toContain("rm -f /tmp/.X11-lock /tmp/.X11-unix/X11");
		expect(remove).toContain("userdel -r bo");
		expect(remove).toContain("systemctl disable --now sekai-vnc@bo sekai-desktop@bo");
		expect(Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(remove) }).exitCode).toBe(0);
	});
});
