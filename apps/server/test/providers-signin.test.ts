import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	joinCommandLine,
	PROVIDER_PRESET_IDS,
	PROVIDER_PRESETS,
	type Provider,
	type SignInServerMessage,
	splitCommandLine,
} from "@sekai/shared";
import type { Actor } from "../src/auth/actor.ts";
import { denyReason, type Principal } from "../src/auth/index.ts";
import { REAUTH_MS } from "../src/auth/routes.ts";
import { DATA_PATHS } from "../src/backups/archive.ts";
import { config } from "../src/config.ts";
import { configEnv, providerDir, providerEnv, toolsBinDir } from "../src/providers/process.ts";
import { resolveSignInCommand } from "../src/providers/setup.ts";
import {
	issueSignInTicket,
	resetSignInState,
	type SignInSocket,
	setAfterSignIn,
	signInWebSocket,
	upgradeSignIn,
} from "../src/providers/signin.ts";
import {
	detectDeviceCode,
	detectPastePrompt,
	detectSignInLink,
	SignInDetector,
	stripAnsi,
} from "../src/providers/signin-detect.ts";
import { checkSignInCommand, isSecretEnv, sealEnv, setProviderStatus, unsealEnv } from "../src/providers/store.ts";
import {
	clearToolCaches,
	compareVersions,
	inspectTool,
	isOlderVersion,
	parseVersion,
	resolveInstallArgs,
	resolveInstallEnv,
} from "../src/providers/tools.ts";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
	return {
		id: "prv_test123",
		preset: "custom",
		kind: "acp",
		title: "Test Sub",
		enabled: true,
		command: "my-agent",
		args: ["acp"],
		env: {},
		extraModels: [],
		signInCommand: [],
		ownConfig: true,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function makeActor(admin: boolean, userId = "usr_1"): Actor {
	const perms = admin ? (["admin"] as const) : (["subscriptions", "bots"] as const);
	return {
		userId,
		roleId: admin ? "role_admin" : "role_member",
		roleName: admin ? "Admin" : "Member",
		admin,
		permissions: [...perms],
		limits: {
			models: null,
			maxBots: null,
			tokensPerDay: null,
			tokensPerMonth: null,
			costPerMonth: null,
			storageMb: null,
		},
		can: new Set(perms),
	};
}

// ---------------------------------------------------------------- argv splitting & validation

describe("sign-in argv splitting and validation", () => {
	test("splits quoted command lines safely without shell expansion", () => {
		expect(splitCommandLine("codex login --device-auth")).toEqual(["codex", "login", "--device-auth"]);
		expect(splitCommandLine(`my-cli login --url "https://example.com/?a=1&b=2" --note 'hello $HOME'`)).toEqual([
			"my-cli",
			"login",
			"--url",
			"https://example.com/?a=1&b=2",
			"--note",
			"hello $HOME",
		]);
		expect(splitCommandLine("my-cli login ; rm -rf / | cat")).toEqual([
			"my-cli",
			"login",
			";",
			"rm",
			"-rf",
			"/",
			"|",
			"cat",
		]);
		expect(splitCommandLine(`my-cli "unclosed`)).toBeNull();
		expect(splitCommandLine(`my-cli 'unclosed`)).toBeNull();
		expect(splitCommandLine("   ")).toEqual([]);
	});

	test("round-trips argv through joinCommandLine and splitCommandLine", () => {
		const argv = ["my-agent", "auth", "login", "--label", "hazel's box", "--extra", "a b"];
		expect(splitCommandLine(joinCommandLine(argv))).toEqual(argv);
	});

	test("rejects shells, launchers, interpreters, flags, and NUL bytes", () => {
		for (const bad of [
			["sh", "-c", "id"],
			["/bin/bash", "-i"],
			["/usr/bin/zsh"],
			["python3", "-c", "import os"],
			["node", "-e", "process.exit()"],
			["bun", "eval", "1"],
			["env", "bash"],
			["sudo", "codex"],
			["ssh", "host"],
			["cmd.exe", "/c", "dir"],
			["-c", "echo"],
			["codex", "login\0--bad"],
		]) {
			expect(() => checkSignInCommand(bad)).toThrow();
		}
		expect(checkSignInCommand([])).toEqual([]);
		expect(checkSignInCommand(["codex", "login", "--device-auth"])).toEqual(["codex", "login", "--device-auth"]);
		expect(checkSignInCommand(["/opt/bin/my-agent", "login"])).toEqual(["/opt/bin/my-agent", "login"]);
	});

	test("resolves preset commands, Pi targets, Custom overrides, and ACP terminal authMethods", async () => {
		const codex = resolveSignInCommand(makeProvider({ preset: "codex" }));
		expect(codex?.argv).toEqual(["codex", "login", "--device-auth"]);

		const claude = resolveSignInCommand(makeProvider({ preset: "claude", kind: "claude-sdk", command: "" }));
		expect(claude?.argv.slice(1)).toEqual(["auth", "login"]);
		expect(claude?.display).toBe("claude auth login");

		const pi = resolveSignInCommand(makeProvider({ preset: "pi" }), { target: "anthropic", requireTarget: true });
		expect(pi?.argv).toEqual(["pi", "auth", "login", "anthropic", "--no-browser"]);
		expect(() => resolveSignInCommand(makeProvider({ preset: "pi" }), { requireTarget: true })).toThrow();
		expect(() =>
			resolveSignInCommand(makeProvider({ preset: "pi" }), { target: "not-a-provider;sh", requireTarget: true }),
		).toThrow();

		const custom = resolveSignInCommand(
			makeProvider({ preset: "custom", signInCommand: ["my-cli", "auth", "device"] }),
		);
		expect(custom?.argv).toEqual(["my-cli", "auth", "device"]);

		const acpProv = makeProvider({ id: "prv_acp_term", preset: "custom", command: "my-acp-cli", args: ["acp"] });
		await setProviderStatus(acpProv.id, {
			authMethods: [
				{
					id: "oauth-term",
					name: "Sign in via terminal",
					description: "Run interactive login",
					terminal: "my-acp-cli login --headless",
					args: ["login", "--headless"],
					env: { ACP_HEADLESS: "1" },
				},
			],
		});
		const termResolved = resolveSignInCommand(acpProv, { methodId: "oauth-term" });
		expect(termResolved?.argv).toEqual(["my-acp-cli", "login", "--headless"]);
		expect(termResolved?.extraEnv).toEqual({ ACP_HEADLESS: "1" });
	});
});

// ---------------------------------------------------------------- link / code / paste detection

describe("sign-in terminal output detection", () => {
	test("detects Codex --device-auth URL and code", () => {
		const sample = `
Welcome to Codex!
Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   \u001b[36mhttps://auth.openai.com/codex/device\u001b[0m

2. Enter this one-time code (expires in 15 minutes)
   \u001b[1mABCD-12345\u001b[0m
`;
		const det = new SignInDetector();
		expect(det.push(sample)).toEqual([
			{ type: "link", url: "https://auth.openai.com/codex/device" },
			{ type: "code", code: "ABCD-12345" },
		]);
		// Duplicate chunks don't re-emit
		expect(det.push("waiting for authorization...")).toEqual([]);
	});

	test("detects Grok --device-auth URL and code", () => {
		const sample = `
To sign in to Grok Build:
Visit: https://accounts.x.ai/device
Enter code: WXYZ-4821
`;
		const stripped = stripAnsi(sample);
		expect(detectSignInLink(stripped)).toBe("https://accounts.x.ai/device");
		expect(detectDeviceCode(stripped)).toBe("WXYZ-4821");
	});

	test("detects Claude Code wrapped OAuth URL and paste prompt, ignoring localhost callback", () => {
		const sample = `
Listening on http://localhost:54321/callback
Browser didn't open? Use the url below to sign in:
https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-
5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback

Paste code here if prompted >
`;
		const det = new SignInDetector();
		const events = det.push(sample);
		expect(events).toContainEqual({
			type: "link",
			url: "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback",
		});
		expect(events).toContainEqual({ type: "paste" });
	});

	test("detects Pi GitHub Copilot device code and URL", () => {
		const sample = `
│ Open https://github.com/login/device
│ Enter this verification code:
│ A1B2-C3D4
`;
		const stripped = stripAnsi(sample);
		expect(detectSignInLink(stripped)).toBe("https://github.com/login/device");
		expect(detectDeviceCode(stripped)).toBe("A1B2-C3D4");
	});

	test("detects Devin manual token flow URL and paste prompt", () => {
		const sample = `
Open this page in your browser to generate a CLI token:
https://app.devin.ai/settings/cli-token
Paste your token below and press Enter:
`;
		const stripped = stripAnsi(sample);
		expect(detectSignInLink(stripped)).toBe("https://app.devin.ai/settings/cli-token");
		expect(detectPastePrompt(stripped)).toBe(true);
	});

	test("does not mistake localhost URLs or normal text for links or codes", () => {
		const sample = "Local server listening at http://127.0.0.1:49374/callback\nStatus: HTTP-2026 OK";
		expect(detectSignInLink(sample)).toBeNull();
		expect(detectDeviceCode(sample)).toBeNull();
		expect(detectPastePrompt(sample)).toBe(false);
	});
});

// ---------------------------------------------------------------- config dirs, env & secrets

describe("isolated subscription config folders and sealed env", () => {
	const origDataDir = config.dataDir;
	let scratch = "";

	beforeEach(() => {
		scratch = join(tmpdir(), `sekai-subs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(scratch, { recursive: true });
		(config as { dataDir: string }).dataDir = scratch;
	});

	afterEach(() => {
		(config as { dataDir: string }).dataDir = origDataDir;
		rmSync(scratch, { recursive: true, force: true });
	});

	test("creates private 0700 config dirs per preset when ownConfig is true", () => {
		for (const presetId of PROVIDER_PRESET_IDS) {
			const p = makeProvider({ id: `prv_${presetId}`, preset: presetId, ownConfig: true });
			const env = configEnv(p, true);
			const expectedKeys = Object.keys(PROVIDER_PRESETS[presetId].configDirs);
			expect(Object.keys(env).sort()).toEqual(expectedKeys.sort());
			const base = providerDir(p.id);
			expect(existsSync(base)).toBe(true);
			expect(statSync(base).mode & 0o777).toBe(0o700);
			for (const dir of Object.values(env)) {
				expect(dir.startsWith(base)).toBe(true);
				expect(statSync(dir).mode & 0o777).toBe(0o700);
			}
		}

		// Specific key checks
		expect(configEnv(makeProvider({ preset: "claude" }), false)).toEqual({
			CLAUDE_CONFIG_DIR: join(scratch, "providers", "prv_test123", "claude"),
		});
		expect(configEnv(makeProvider({ preset: "codex" }), false)).toEqual({
			CODEX_HOME: join(scratch, "providers", "prv_test123", "codex"),
		});
		expect(configEnv(makeProvider({ preset: "opencode" }), false)).toMatchObject({
			XDG_CONFIG_HOME: join(scratch, "providers", "prv_test123", "config"),
			XDG_DATA_HOME: join(scratch, "providers", "prv_test123", "data"),
		});
		expect(configEnv(makeProvider({ preset: "pi" }), false)).toEqual({
			PI_CODING_AGENT_DIR: join(scratch, "providers", "prv_test123", "pi"),
		});
	});

	test("keeps default env when ownConfig is false and puts tools/bin first on PATH", () => {
		const p = makeProvider({
			preset: "codex",
			ownConfig: false,
			env: { CUSTOM_VAR: "ok" },
		});
		expect(configEnv(p, false)).toEqual({});
		const env = providerEnv(p);
		expect(env.PATH?.startsWith(toolsBinDir())).toBe(true);
		expect(env.CUSTOM_VAR).toBe("ok");
		expect(env.DATABASE_URL).toBeUndefined();
	});

	test("seals secret-looking env values at rest and unseals them back cleanly", () => {
		expect(isSecretEnv("ANTHROPIC_API_KEY")).toBe(true);
		expect(isSecretEnv("OPENAI_API_KEY")).toBe(true);
		expect(isSecretEnv("XAI_API_KEY")).toBe(true);
		expect(isSecretEnv("META_API_KEY")).toBe(true);
		expect(isSecretEnv("MUSE_EXPERIMENTAL_ACP")).toBe(false);

		const plain = {
			ANTHROPIC_API_KEY: "sk-ant-super-secret-123456",
			MUSE_EXPERIMENTAL_ACP: "on",
		};
		const sealed = sealEnv(plain);
		expect(sealed.ANTHROPIC_API_KEY).toStartWith("v1:");
		expect(sealed.ANTHROPIC_API_KEY).not.toContain("super-secret");
		expect(sealed.MUSE_EXPERIMENTAL_ACP).toBe("on");
		// Sealing twice is idempotent
		expect(sealEnv(sealed)).toEqual(sealed);
		expect(unsealEnv(sealed)).toEqual(plain);
	});

	test("backups include the providers folder", () => {
		expect(DATA_PATHS).toContain("providers");
	});
});

// ---------------------------------------------------------------- installer version handling

describe("installer version and tool inspection", () => {
	const origDataDir = config.dataDir;
	let scratch = "";

	beforeEach(() => {
		scratch = join(tmpdir(), `sekai-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(scratch, { recursive: true });
		(config as { dataDir: string }).dataDir = scratch;
		clearToolCaches();
	});

	afterEach(() => {
		(config as { dataDir: string }).dataDir = origDataDir;
		rmSync(scratch, { recursive: true, force: true });
		clearToolCaches();
	});

	test("parses and compares semver versions accurately", () => {
		expect(parseVersion("opencode v2.4.1\n")).toBe("2.4.1");
		expect(parseVersion("codex-cli 0.171.0")).toBe("0.171.0");
		expect(parseVersion("v22.19.0")).toBe("22.19.0");
		expect(parseVersion("no version here")).toBeNull();

		expect(compareVersions("2.4.1", "2.4.1")).toBe(0);
		expect(compareVersions("2.4.0", "2.4.1")).toBeLessThan(0);
		expect(compareVersions("2.10.0", "2.4.1")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);

		expect(isOlderVersion("2.2.5", "2.4.1")).toBe(true);
		expect(isOlderVersion("2.4.1", "2.4.1")).toBe(false);
		expect(isOlderVersion("2.5.0", "2.4.1")).toBe(false);
		expect(isOlderVersion("1.0.0", "latest")).toBe(true);
	});

	test("expands VERSION and DIR placeholders for script installers", () => {
		expect(resolveInstallArgs(["--version", "VERSION", "--no-modify-path"], "2.4.1")).toEqual([
			"--version",
			"2.4.1",
			"--no-modify-path",
		]);
		expect(resolveInstallEnv({ HOME: "DIR", XDG_DATA_HOME: "DIR/share", FOO: "bar" }, "/srv/tools/devin")).toEqual({
			HOME: "/srv/tools/devin",
			XDG_DATA_HOME: "/srv/tools/devin/share",
			FOO: "bar",
		});
	});

	test("detects managed tools in <dataDir>/tools/bin and reports manual tools as unavailable", async () => {
		const binDir = toolsBinDir();
		mkdirSync(binDir, { recursive: true });
		const fakeBin = join(binDir, "opencode");
		writeFileSync(fakeBin, "#!/bin/sh\necho 'opencode v2.2.5'\n", { mode: 0o755 });
		chmodSync(fakeBin, 0o755);

		const state = await inspectTool("opencode", "agent", { isAdmin: true, envPath: "" });
		expect(state.installed).toBe(true);
		expect(state.managed).toBe(true);
		expect(state.version).toBe("2.2.5");
		expect(state.wanted).toBe("2.4.1");
		expect(state.updateAvailable).toBe(true);
		expect(state.path).toBe(fakeBin);

		// Non-admins don't see server paths
		const nonAdmin = await inspectTool("opencode", "agent", { isAdmin: false, envPath: "" });
		expect(nonAdmin.path).toBeNull();

		// Manual tools explain why they can't be installed from the browser
		const agy = await inspectTool("antigravity", "agent", { isAdmin: true, envPath: "" });
		expect(agy.unavailable).toContain("manual download");
		expect(agy.updateAvailable).toBe(false);
	});
});

// ---------------------------------------------------------------- WebSocket security & E2E fake sign-in

describe("sign-in terminal WebSocket security and end-to-end PTY flow", () => {
	const origDataDir = config.dataDir;
	let scratch = "";
	let fakeScript = "";

	beforeEach(() => {
		scratch = join(tmpdir(), `sekai-ws-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(scratch, { recursive: true });
		(config as { dataDir: string }).dataDir = scratch;
		resetSignInState();

		// A standalone executable script (NOT a shell name) that simulates a real CLI device-code + paste login.
		fakeScript = join(scratch, "fake-cli-login");
		writeFileSync(
			fakeScript,
			`#!/bin/sh
echo "Open this sign-in page:"
echo "https://auth.example.test/device"
echo "Enter this one-time code:"
echo "K7M9-P4Q2"
echo "Paste your token here:"
IFS= read -r token
echo "RECEIVED:\${token}:HOME=\${HOME}"
exit 0
`,
			{ mode: 0o755 },
		);
		chmodSync(fakeScript, 0o755);
	});

	afterEach(() => {
		resetSignInState();
		setAfterSignIn(() => {});
		(config as { dataDir: string }).dataDir = origDataDir;
		rmSync(scratch, { recursive: true, force: true });
	});

	test("refuses unauthenticated, wrong-origin, non-admin, stale-reauth, wrong-user and reused tickets", async () => {
		const provider = makeProvider({
			id: "prv_ws_sec",
			preset: "custom",
			signInCommand: [fakeScript],
		});
		const adminActor = makeActor(true, "usr_admin");
		const memberActor = makeActor(false, "usr_member");
		const recentSession: Principal = {
			kind: "session",
			userId: "usr_admin",
			sessionId: "ses_1",
			verifiedAt: Date.now(),
			restriction: null,
		};
		const staleSession: Principal = {
			kind: "session",
			userId: "usr_admin",
			sessionId: "ses_1",
			verifiedAt: Date.now() - REAUTH_MS - 60_000,
			restriction: null,
		};

		let mode: "none" | "wrong-origin" | "member" | "stale" | "other-user" | "ok" = "none";

		const server = Bun.serve<SignInSocket>({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(req, srv) {
				const res = await upgradeSignIn(req, srv, async (r) => {
					if (mode === "none") return Response.json({ error: "Sign in to continue" }, { status: 401 });
					if (mode === "wrong-origin") {
						const deny = denyReason(recentSession, r, { websocket: true });
						if (deny) return Response.json({ error: deny }, { status: 403 });
					}
					if (mode === "member") {
						return {
							actor: memberActor,
							principal: { ...recentSession, userId: "usr_member" },
						};
					}
					if (mode === "stale") return { actor: adminActor, principal: staleSession };
					if (mode === "other-user") {
						return {
							actor: makeActor(true, "usr_other"),
							principal: { ...recentSession, userId: "usr_other", sessionId: "ses_2" },
						};
					}
					return { actor: adminActor, principal: recentSession };
				});
				return res ?? new Response("not found", { status: 404 });
			},
			websocket: signInWebSocket,
		});

		try {
			const base = `http://127.0.0.1:${server.port}`;
			const { ticket } = issueSignInTicket({
				providerId: provider.id,
				provider,
				userId: "usr_admin",
				sessionId: "ses_1",
			});

			// 1. No session → 401
			mode = "none";
			expect((await fetch(`${base}/api/providers/signin/${ticket}`)).status).toBe(401);

			// 2. Wrong origin → 403
			mode = "wrong-origin";
			const wrongOriginRes = await fetch(`${base}/api/providers/signin/${ticket}`, {
				headers: { origin: "https://evil.example" },
			});
			expect(wrongOriginRes.status).toBe(403);

			// 3. Non-admin → 403
			mode = "member";
			expect((await fetch(`${base}/api/providers/signin/${ticket}`)).status).toBe(403);

			// 4. No recent auth → 403 reauth_required
			mode = "stale";
			const staleRes = await fetch(`${base}/api/providers/signin/${ticket}`);
			expect(staleRes.status).toBe(403);
			expect(((await staleRes.json()) as { code?: string }).code).toBe("reauth_required");

			// 5. Wrong user → 403
			mode = "other-user";
			expect((await fetch(`${base}/api/providers/signin/${ticket}`)).status).toBe(403);

			// 6. Unknown ticket → 404
			mode = "ok";
			expect((await fetch(`${base}/api/providers/signin/nonexistent_ticket_xyz`)).status).toBe(404);
		} finally {
			server.stop(true);
		}
	});

	test("runs a fake sign-in script over the WebSocket, detects link/code/paste, accepts input, and re-checks", async () => {
		const provider = makeProvider({
			id: "prv_ws_e2e",
			preset: "custom",
			ownConfig: true,
			signInCommand: [fakeScript],
		});
		const adminActor = makeActor(true, "usr_admin");
		const recentSession: Principal = {
			kind: "session",
			userId: "usr_admin",
			sessionId: "ses_e2e",
			verifiedAt: Date.now(),
			restriction: null,
		};

		const checked: string[] = [];
		setAfterSignIn((id) => checked.push(id));

		const server = Bun.serve<SignInSocket>({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(req, srv) {
				const res = await upgradeSignIn(req, srv, async () => ({
					actor: adminActor,
					principal: recentSession,
				}));
				return res ?? new Response("not found", { status: 404 });
			},
			websocket: signInWebSocket,
		});

		try {
			const { ticket } = issueSignInTicket({
				providerId: provider.id,
				provider,
				userId: "usr_admin",
				sessionId: "ses_e2e",
			});

			const wsUrl = `ws://127.0.0.1:${server.port}/api/providers/signin/${ticket}`;
			const events: SignInServerMessage[] = [];
			let rawOutput = "";
			let sentInput = false;

			await new Promise<void>((resolvePromise, rejectPromise) => {
				const ws = new WebSocket(wsUrl);
				ws.binaryType = "arraybuffer";
				const timeout = setTimeout(() => {
					ws.close();
					rejectPromise(new Error(`Timed out waiting for sign-in exit. Output:\n${rawOutput}`));
				}, 10_000);

				ws.addEventListener("open", () => {
					ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
				});

				ws.addEventListener("message", (ev) => {
					if (ev.data instanceof ArrayBuffer) {
						rawOutput += new TextDecoder().decode(ev.data);
						return;
					}
					if (typeof ev.data === "string") {
						const msg = JSON.parse(ev.data) as SignInServerMessage;
						events.push(msg);
						if (msg.type === "paste" && !sentInput) {
							sentInput = true;
							// While open, a second sign-in ticket for the same subscription must be rejected (409).
							expect(() =>
								issueSignInTicket({
									providerId: provider.id,
									provider,
									userId: "usr_admin",
									sessionId: "ses_e2e",
								}),
							).toThrow();
							ws.send(JSON.stringify({ type: "input", data: "my-secret-token\r" }));
						}
						if (msg.type === "exit") {
							clearTimeout(timeout);
							resolvePromise();
						}
					}
				});

				ws.addEventListener("error", (err) => {
					clearTimeout(timeout);
					rejectPromise(err);
				});
			});

			expect(events).toContainEqual({ type: "started", command: fakeScript });
			expect(events).toContainEqual({ type: "link", url: "https://auth.example.test/device" });
			expect(events).toContainEqual({ type: "code", code: "K7M9-P4Q2" });
			expect(events).toContainEqual({ type: "paste" });
			expect(events).toContainEqual({ type: "exit", code: 0, reason: "exited" });
			expect(rawOutput).toContain(`RECEIVED:my-secret-token:HOME=${join(providerDir(provider.id), "home")}`);
			expect(checked).toEqual([provider.id]);

			// Single-use: replaying the same ticket is refused (404).
			const replay = await fetch(`http://127.0.0.1:${server.port}/api/providers/signin/${ticket}`);
			expect(replay.status).toBe(404);
		} finally {
			server.stop(true);
		}
	}, 15_000);
});
