// Several people on one server, end to end against a scratch database; prints a JSON report. access.test.ts runs
// this as its own process so DATABASE_URL applies before the server's modules load.
import { rmSync } from "node:fs";
import { RoleLimits } from "@sekai/shared";
import { eq } from "drizzle-orm";
import { sharedReach, toolAllowed } from "../../src/agent/tools/index.ts";
import { createApp } from "../../src/app.ts";
import { actorFor, forgetActors, runAs } from "../../src/auth/actor.ts";
import { resetRateLimits } from "../../src/auth/routes.ts";
import { ensureSetupCode, resetAuthCaches, setupCodeForTests } from "../../src/auth/service.ts";
import { base32Decode, base32Encode, currentStep, totpAt } from "../../src/auth/totp.ts";
import { requestLogin, saveLogin } from "../../src/browser/credentials.ts";
import { browsersForBot } from "../../src/browser/shared.ts";
import { bindingsForChat, recordPlatformMessage, sekaiMessageId } from "../../src/channels/state.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { eventVisibleTo } from "../../src/events/scope.ts";
import { sealJson } from "../../src/lib/secrets.ts";
import { machinesForBot } from "../../src/machines/seats.ts";
import { forgetShares } from "../../src/services/visibility.ts";

await initDb();
await db.delete(schema.users);
// Limits and permissions set by an earlier run.
const MEMBER_PERMISSIONS = ["bots", "web", "browser", "routines", "library", "voice", "compare"] as const;
await db
	.update(schema.roles)
	.set({ limits: RoleLimits.parse({}), permissions: [...MEMBER_PERMISSIONS] })
	.where(eq(schema.roles.id, "role_member"));
resetAuthCaches();
resetRateLimits();

await ensureSetupCode("http://127.0.0.1");
const app = createApp();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req, srv) => app.fetch(req, srv) });
const base = `http://127.0.0.1:${server.port}`;
const report: Record<string, unknown> = {};

async function call(
	method: string,
	path: string,
	opts: { body?: unknown; cookie?: string; form?: FormData; jar?: Jar; token?: string } = {},
) {
	const headers: Record<string, string> = { origin: base };
	if (opts.body !== undefined) headers["content-type"] = "application/json";
	const cookie = opts.jar ? opts.jar.header() : opts.cookie;
	if (cookie) headers.cookie = cookie;
	if (opts.token) headers.authorization = `Bearer ${opts.token}`;
	const res = await fetch(`${base}${path}`, {
		method,
		headers,
		body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
		redirect: "manual",
	});
	opts.jar?.take(res);
	const text = await res.text();
	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	// Loosely typed: the report only reads a few fields.
	// biome-ignore lint/suspicious/noExplicitAny: test fixture
	return { status: res.status, data: data as any };
}

/** Cookies a browser would keep (the session, and the pending two-factor sign-in). */
class Jar {
	private cookies = new Map<string, string>();
	take(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair = ""] = c.split(";");
			const i = pair.indexOf("=");
			const name = pair.slice(0, i);
			const value = pair.slice(i + 1);
			if (!value || /Max-Age=0/.test(c)) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}
	header() {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}
}

const admin = new Jar();
const member = new Jar();

try {
	const setup = await call("POST", "/api/auth/setup", {
		jar: admin,
		body: { username: "ada", name: "Ada", password: "correct horse battery", code: setupCodeForTests() },
	});
	if (setup.status !== 200) throw new Error(`setup: ${JSON.stringify(setup.data)}`);

	// An admin makes an account with a temporary password; it must be changed first.
	const created = await call("POST", "/api/admin/users", {
		jar: admin,
		body: { username: "bo", name: "Bo", email: "bo@example.com", roleId: "role_member", password: "temporary" },
	});
	const temp = String(created.data.temporaryPassword ?? "");
	report.adminCreatesMember = { status: created.status, temporary: temp.length > 10 };
	// Single sign-on only works when their first sign-in can find the account: an email, and a provider that
	// matches verified emails.
	const ssoOnly = async (email: string | null) =>
		(
			await call("POST", "/api/admin/users", {
				jar: admin,
				body: { name: "Sso Person", username: "sso-person", roleId: "role_member", password: "none", email },
			})
		).status;
	const ssoReport: Record<string, number> = { noProvider: await ssoOnly("sso@example.com") };
	const provider = await call("POST", "/api/admin/sso", {
		jar: admin,
		body: { kind: "github", name: "GitHub", clientId: "id", clientSecret: "secret", linkByEmail: false },
	});
	ssoReport.noEmailMatching = await ssoOnly("sso@example.com");
	await call("PATCH", `/api/admin/sso/${provider.data.id}`, { jar: admin, body: { linkByEmail: true } });
	ssoReport.noEmail = await ssoOnly(null);
	ssoReport.works = await ssoOnly("sso@example.com");
	await call("DELETE", `/api/admin/sso/${provider.data.id}`, { jar: admin });
	report.ssoOnly = ssoReport;
	const memberId = String((created.data.user as { id: string }).id);
	const signIn = await call("POST", "/api/auth/login", { jar: member, body: { username: "bo", password: temp } });
	report.memberMustChange = { status: signIn.status, restriction: signIn.data.restriction };
	report.restrictedBlocked = (await call("GET", "/api/agents", { jar: member })).status;
	report.passwordChanged = (
		await call("POST", "/api/auth/password", { jar: member, body: { next: "bo's own long password" } })
	).status;
	report.memberAfterChange = (await call("GET", "/api/agents", { jar: member })).status;

	// Each person's bots are their own.
	const adminBot = (
		await call("POST", "/api/agents", { jar: admin, body: { name: "admin's", instructions: "secret rules" } })
	).data;
	await call("POST", "/api/agents", { jar: member, body: { name: "mine" } });
	report.memberSeesOwnBotsOnly = (await call("GET", "/api/agents", { jar: member })).data.map(
		(a: { name: string }) => a.name,
	);
	report.othersBot = (await call("GET", `/api/agents/${adminBot.id}`, { jar: member })).status;
	report.othersBotPatch = (
		await call("PATCH", `/api/agents/${adminBot.id}`, { jar: member, body: { name: "taken" } })
	).status;

	// Shared: they see it (without its private setup), chat with it, but can't change it.
	await call("POST", `/api/agents/${adminBot.id}/shares`, { jar: admin, body: { kind: "user", userId: memberId } });
	const shared = (await call("GET", "/api/agents", { jar: member })).data.find(
		(a: { id: string }) => a.id === adminBot.id,
	) as { name: string; sharedBy: string; instructions: string };
	report.sharedAppears = { name: shared?.name, sharedBy: shared?.sharedBy, instructions: shared?.instructions };
	report.sharedPatch = (
		await call("PATCH", `/api/agents/${adminBot.id}`, { jar: member, body: { name: "taken" } })
	).status;
	const chat = await call("POST", "/api/conversations", {
		jar: member,
		body: { kind: "direct", agentId: adminBot.id, title: "hello there" },
	});
	report.sharedChat = chat.status;
	report.adminSeesMemberChat = (await call("GET", `/api/conversations/${chat.data.id}`, { jar: admin })).status;
	report.adminChatList = (await call("GET", "/api/conversations", { jar: admin })).data.length;
	await call("POST", `/api/conversations/${chat.data.id}/messages`, {
		jar: member,
		body: { text: "zebra crossing" },
	});
	const adminChat = await call("POST", "/api/conversations", {
		jar: admin,
		body: { kind: "direct", agentId: adminBot.id },
	});
	const memberRole = (await call("GET", "/api/admin/roles", { jar: admin })).data.find(
		(r: { id: string }) => r.id === "role_member",
	);
	await call("PATCH", "/api/admin/roles/role_member", {
		jar: admin,
		body: { permissions: [...memberRole.permissions, "channels"] },
	});
	const slack = await call("POST", "/api/channels", {
		jar: admin,
		body: {
			agentId: adminBot.id,
			type: "slack",
			enabled: false,
			secrets: { botToken: "xoxb-test-only", appToken: "xapp-test-only" },
		},
	});
	const storedSlack = await db.query.channels.findFirst({ where: eq(schema.channels.id, String(slack.data.id)) });
	await db.insert(schema.channelBindings).values({
		id: "cb_slack_access",
		channelId: String(slack.data.id),
		externalChatId: "slack:T1:C1:100.000001",
		conversationId: String(adminChat.data.id),
		chatName: "Slack thread",
		isGroup: true,
		listen: true,
		createdAt: Date.now(),
	});
	report.slack = {
		created: slack.status,
		sealed: Boolean(
			storedSlack?.secrets.botToken?.startsWith("v1:") && storedSlack.secrets.appToken?.startsWith("v1:"),
		),
		masked: !JSON.stringify(slack.data.secrets).includes("test-only"),
		otherList: (await call("GET", `/api/channels?agentId=${adminBot.id}`, { jar: member })).data.length,
		otherPatch: (
			await call("PATCH", `/api/channels/${slack.data.id}`, { jar: member, body: { allowFrom: ["UINTRUDER"] } })
		).status,
		otherBindings: (await call("GET", `/api/channels/${slack.data.id}/bindings`, { jar: member })).status,
		otherBindingPatch: (
			await call("PATCH", "/api/channels/bindings/cb_slack_access", { jar: member, body: { listen: false } })
		).status,
		otherChannelCreate: (
			await call("POST", "/api/channels", {
				jar: member,
				body: { agentId: adminBot.id, type: "slack", enabled: false },
			})
		).status,
		otherThreadLinks: await runAs(
			await actorFor(memberId),
			async () => (await bindingsForChat("slack:T1:C1:100.000001")).length,
		),
	};
	await call("PATCH", "/api/admin/roles/role_member", { jar: admin, body: { permissions: memberRole.permissions } });
	await db.insert(schema.messages).values({
		id: "msg_admin_secret",
		conversationId: String(adminChat.data.id),
		sender: "user",
		agentId: null,
		parts: [{ type: "text", text: "platypus secret" }],
		attachments: [],
		replyToId: null,
		status: "done",
		error: null,
		model: null,
		usage: null,
		runId: null,
		meta: {},
		searchText: "platypus secret",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	await recordPlatformMessage({
		channelId: String(slack.data.id),
		chatId: "slack:T1:C1:100.000001",
		externalMessageId: "100.000002",
		messageId: "msg_admin_secret",
		direction: "in",
	});
	report.slack = {
		...(report.slack as Record<string, unknown>),
		otherMessageLookup: await runAs(await actorFor(memberId), () =>
			sekaiMessageId("slack:T1:C1:100.000001", "100.000002"),
		),
		ownerSeesStatus: await eventVisibleTo(
			{ type: "channel.changed", channelId: String(slack.data.id) },
			"admins",
			await actorFor(String(setup.data.user.id)),
		),
		otherSeesStatus: await eventVisibleTo(
			{ type: "channel.changed", channelId: String(slack.data.id) },
			"everyone",
			await actorFor(memberId),
		),
	};
	report.memberSearch = (await call("GET", "/api/search/messages?q=platypus", { jar: member })).data.length;

	// Browser tokens see only their owner's bots/chats and cannot reach setup or other people's grants.
	const browserToken = (await call("POST", "/api/extension/token", { jar: admin, body: { name: "test browser" } }))
		.data;
	const browserSession = await call("POST", "/api/extension/sessions", {
		token: browserToken.token,
		body: { agentId: adminBot.id, conversationId: adminChat.data.id, name: "Browser" },
	});
	const memberToken = (await call("POST", "/api/extension/token", { jar: member, body: { name: "member browser" } }))
		.data;
	report.browserExtension = {
		connected: browserSession.status,
		otherChat: (await call("GET", `/api/extension/chat/${adminChat.data.id}`, { token: memberToken.token })).status,
		otherGrant: (
			await call("POST", `/api/extension/sessions/${browserSession.data.id}/poll`, { token: memberToken.token })
		).status,
		sharedBot: (
			await call("POST", "/api/extension/sessions", {
				token: memberToken.token,
				body: { agentId: adminBot.id, conversationId: chat.data.id, name: "No" },
			})
		).status,
		setupBlocked: (await call("GET", "/api/settings", { token: browserToken.token })).status,
		tokenMintBlocked: (
			await call("POST", "/api/extension/token", { token: browserToken.token, body: { name: "No" } })
		).status,
	};
	await call("DELETE", `/api/extension/sessions/${browserSession.data.id}`, { token: browserToken.token });

	// Server setup is for admins; personal settings are each person's.
	report.memberBackups = (await call("GET", "/api/backups", { jar: member })).status;
	report.memberAdminUsers = (await call("GET", "/api/admin/users", { jar: member })).status;
	report.memberServerSetting = (
		await call("PATCH", "/api/settings", { jar: member, body: { contextMessageLimit: 20 } })
	).status;
	const tz = await call("PATCH", "/api/settings", { jar: member, body: { timezone: "Asia/Tokyo" } });
	report.memberTimezone = {
		status: tz.status,
		mine: (await call("GET", "/api/settings", { jar: member })).data.timezone,
		admins: (await call("GET", "/api/settings", { jar: admin })).data.timezone,
	};
	// A change that includes a server setting is refused whole: none of your own part is saved either.
	const before = (await call("GET", "/api/settings", { jar: member })).data;
	const mixed = await call("PATCH", "/api/settings", {
		jar: member,
		body: {
			userName: "Someone else",
			timezone: "Europe/Paris",
			defaultModel: { model: "claude-haiku-5-5", thinking: "default" },
		},
	});
	const after = (await call("GET", "/api/settings", { jar: member })).data;
	report.memberMixedSetting = {
		status: mixed.status,
		timezoneKept: after.timezone === before.timezone,
		nameKept: after.userName === before.userName,
		serverDefaultKept: after.defaultModel.model === before.defaultModel.model,
	};

	// Files: yours only.
	const form = new FormData();
	form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
	const upload = (await call("POST", "/api/uploads", { jar: member, form })).data;
	report.uploadOwner = (await call("GET", `/api/uploads/${upload.id}`, { jar: member })).status;
	report.uploadOthers = (await call("GET", `/api/uploads/${upload.id}`, { jar: admin })).status;

	// Memory: a shared bot remembers each person separately.
	await call("POST", "/api/memories", {
		jar: member,
		body: { agentId: adminBot.id, kind: "fact", content: "Bo likes tea" },
	});
	report.memoryKeptApart = {
		member: (await call("GET", `/api/memories?agentId=${adminBot.id}`, { jar: member })).data.length,
		admin: (await call("GET", `/api/memories?agentId=${adminBot.id}`, { jar: admin })).data.length,
	};

	// Shared machines and browsers: Bo shares his bot with Ada; Ada shares her bot's computer and a browser with it.
	await call("PATCH", "/api/admin/roles/role_member", {
		jar: admin,
		body: { permissions: [...MEMBER_PERMISSIONS, "share", "computers"] },
	});
	forgetActors();
	const adminId = String((setup.data.user as { id: string }).id);
	const boBot = (await call("GET", "/api/agents", { jar: member })).data.find(
		(a: { name: string }) => a.name === "mine",
	) as { id: string };
	const secretBot = (await call("POST", "/api/agents", { jar: member, body: { name: "secret" } })).data as {
		id: string;
	};
	await call("POST", `/api/agents/${boBot.id}/shares`, { jar: member, body: { kind: "user", userId: adminId } });
	forgetShares();
	const now = Date.now();
	await db.insert(schema.machines).values({
		id: "mch_access_test",
		agentId: adminBot.id,
		kind: "computer",
		provider: "ssh",
		backend: null,
		name: "Ada's test computer",
		status: "running",
		statusDetail: null,
		specs: { cores: 2, memoryMb: 4096, minMemoryMb: 0, diskGb: 32 },
		hostname: "127.0.0.1",
		username: "admins",
		addresses: { lan: "127.0.0.1", tailscale: null },
		ports: { ssh: 9, vnc: 9, rdp: null },
		remoteId: null,
		secrets: sealJson({ userPassword: "", rootPassword: "", vncPassword: null }),
		expiresAt: null,
		shareWithViewers: false,
		createdBy: "user",
		lastUsedAt: null,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(schema.machineMembers).values({
		id: "mbr_access_test",
		machineId: "mch_access_test",
		agentId: boBot.id,
		username: "mine",
		display: 10,
		vncPort: 5910,
		cdpPort: 9232,
		status: "ready",
		statusDetail: null,
		secrets: sealJson({ userPassword: "bo-seat-password", vncPassword: "vncpass" }),
		createdAt: now,
		updatedAt: now,
	});
	const ada = await actorFor(adminId);
	const bo = await actorFor(memberId);
	const seatsOf = async (agentId: string, who: typeof ada) =>
		(await machinesForBot(agentId, who)).filter((m) => m.id === "mch_access_test").length;
	const browserCount = async (agentId: string, who: typeof ada) => (await browsersForBot(agentId, who)).length;
	const canRun = (agent: { id: string; userId: string }, who: typeof ada) =>
		runAs(who, async () =>
			toolAllowed({ name: "run_command", category: "machines" }, agent, await sharedReach(agent.id)),
		);
	const boBotRow = { id: boBot.id, userId: memberId };
	const adminBotRow = { id: String(adminBot.id), userId: adminId };
	const machines = {
		othersMachine: (await call("GET", "/api/machines/mch_access_test", { jar: member })).status,
		othersMembers: (await call("GET", "/api/machines/mch_access_test/members", { jar: member })).status,
		othersScreen: (await call("GET", `/api/machines/mch_access_test/screen?agent=${boBot.id}`, { jar: member }))
			.status,
		othersAccess: (await call("GET", `/api/machines/mch_access_test/access?agent=${boBot.id}`, { jar: member }))
			.status,
		othersAdd: (
			await call("POST", "/api/machines/mch_access_test/members", {
				jar: member,
				body: { agentId: secretBot.id },
			})
		).status,
		othersViewers: (
			await call("PATCH", "/api/machines/mch_access_test", { jar: member, body: { shareWithViewers: true } })
		).status,
		addUnsharedBot: (
			await call("POST", "/api/machines/mch_access_test/members", { jar: admin, body: { agentId: secretBot.id } })
		).status,
		ownerSeesSeat: (await call("GET", `/api/machines/seats?agentId=${boBot.id}`, { jar: admin })).data.length,
		botsOwnerSeesSeat: (await call("GET", `/api/machines/seats?agentId=${boBot.id}`, { jar: member })).data.length,
		ownerSeesMembers: (await call("GET", "/api/machines/mch_access_test/members", { jar: admin })).data.map(
			(m: { agentName: string; sharedBy: string | null; available: boolean }) =>
				`${m.agentName}/${m.sharedBy}/${m.available}`,
		),
		sharedBotInOwnersChats: await seatsOf(boBot.id, ada),
		sharedBotInItsOwnersChats: await seatsOf(boBot.id, bo),
		ownersBotForViewerOff: await seatsOf(String(adminBot.id), bo),
		toolsSharedBotInOwnersChats: await canRun(boBotRow, ada),
		toolsOwnersBotForViewerOff: await canRun(adminBotRow, bo),
	};
	await call("PATCH", "/api/machines/mch_access_test", { jar: admin, body: { shareWithViewers: true } });
	Object.assign(machines, {
		ownersBotForViewerOn: await seatsOf(String(adminBot.id), bo),
		toolsOwnersBotForViewerOn: await canRun(adminBotRow, bo),
		sharedBotForViewerOn: await seatsOf(boBot.id, bo),
		events: {
			owner: await eventVisibleTo({ type: "machine.members", machineId: "mch_access_test" }, "everyone", ada),
			other: await eventVisibleTo({ type: "machine.members", machineId: "mch_access_test" }, "everyone", bo),
		},
	});
	report.sharedMachines = machines;

	const browser = await call("POST", "/api/shared-browsers", {
		jar: admin,
		body: { name: "Team", agentIds: [adminBot.id, boBot.id] },
	});
	const browsers = {
		created: browser.status,
		unsharedBot: (
			await call("POST", "/api/shared-browsers", { jar: admin, body: { name: "No", agentIds: [secretBot.id] } })
		).status,
		othersList: (await call("GET", "/api/shared-browsers", { jar: member })).data.length,
		othersPatch: (
			await call("PATCH", `/api/shared-browsers/${browser.data.id}`, { jar: member, body: { name: "x" } })
		).status,
		othersDelete: (await call("DELETE", `/api/shared-browsers/${browser.data.id}`, { jar: member })).status,
		sharedBotInOwnersChats: await browserCount(boBot.id, ada),
		sharedBotInItsOwnersChats: await browserCount(boBot.id, bo),
		ownersBotForViewerOff: await browserCount(String(adminBot.id), bo),
		events: {
			owner: await eventVisibleTo({ type: "browsers.changed", userId: adminId }, [adminId], ada),
			other: await eventVisibleTo({ type: "browsers.changed", userId: adminId }, "everyone", bo),
		},
	};
	await call("PATCH", `/api/shared-browsers/${browser.data.id}`, { jar: admin, body: { shareWithViewers: true } });
	Object.assign(browsers, {
		ownersBotForViewerOn: await browserCount(String(adminBot.id), bo),
		sharedBotForViewerOn: await browserCount(boBot.id, bo),
	});
	report.sharedBrowsers = browsers;

	// A bot's saved logins are its owner's: not used (or saved) when it signs in for someone else.
	await saveLogin(boBot.id, "example.com", "bo@example.com", "bo's site password");
	const login = (who: typeof ada) =>
		runAs(who, () =>
			requestLogin({
				agentId: boBot.id,
				conversationId: null,
				url: "https://example.com/login",
				reason: "test",
				fields: ["username", "password"],
				timeoutMs: 200,
				signal: AbortSignal.timeout(1000),
			}),
		);
	report.savedLogins = {
		itsOwner: (await login(bo))?.username ?? null,
		someoneElse: (await login(ada))?.username ?? null,
	};

	// Role limits.
	await call("PATCH", "/api/admin/roles/role_member", { jar: admin, body: { limits: { maxBots: 1 } } });
	report.botLimit = (await call("POST", "/api/agents", { jar: member, body: { name: "second" } })).status;

	// Live events reach only the chat's owner.
	const adminActor = await actorFor(String((setup.data.user as { id: string }).id));
	const memberActor = await actorFor(memberId);
	const ev = { type: "conversation.reset", conversationId: String(chat.data.id) } as const;
	const adminEv = { type: "conversation.reset", conversationId: String(adminChat.data.id) } as const;
	report.events = {
		memberGetsOwnChat: await eventVisibleTo(ev, "everyone", memberActor),
		adminGetsMemberChat: await eventVisibleTo(ev, "everyone", adminActor),
		memberGetsAdminChat: await eventVisibleTo(adminEv, [memberId], memberActor),
	};

	// Two-factor sign-in with an authenticator app.
	const totp = (await call("POST", "/api/auth/mfa/totp/setup", { jar: member })).data;
	const secret = base32Encode(base32Decode(String(totp.secret)));
	const confirm = await call("POST", "/api/auth/mfa/totp/confirm", {
		jar: member,
		body: { code: await totpAt(secret, currentStep() - 1) },
	});
	const codes = (confirm.data.recoveryCodes as string[] | undefined) ?? [];
	await call("POST", "/api/auth/logout", { jar: member });
	const step1 = await call("POST", "/api/auth/login", {
		jar: member,
		body: { username: "bo@example.com", password: "bo's own long password" },
	});
	const wrong = await call("POST", "/api/auth/mfa/verify", { jar: member, body: { method: "totp", code: "000000" } });
	const code = await totpAt(secret, currentStep());
	const right = await call("POST", "/api/auth/mfa/verify", { jar: member, body: { method: "totp", code } });
	await call("POST", "/api/auth/logout", { jar: member });
	await call("POST", "/api/auth/login", {
		jar: member,
		body: { username: "bo", password: "bo's own long password" },
	});
	const reuse = await call("POST", "/api/auth/mfa/verify", { jar: member, body: { method: "totp", code } });
	report.totp = {
		setUp: confirm.status === 200,
		recoveryCodes: codes.length,
		signIn: step1.data.status,
		wrong: wrong.status,
		right: right.data.status,
		reuse: reuse.status,
	};
	const recovered = await call("POST", "/api/auth/mfa/verify", {
		jar: member,
		body: { method: "recovery", code: codes[0] },
	});
	report.recovery = recovered.data.status;

	// Turned off: signed out at once.
	await call("PATCH", `/api/admin/users/${memberId}`, { jar: admin, body: { disabled: true } });
	report.disabled = (await call("GET", "/api/agents", { jar: member })).status;
	// There's always an admin.
	report.lastAdmin = (
		await call("PATCH", `/api/admin/users/${(setup.data.user as { id: string }).id}`, {
			jar: admin,
			body: { roleId: "role_member" },
		})
	).status;
} catch (err) {
	report.error = String(err instanceof Error ? err.stack : err);
} finally {
	console.info(`REPORT ${JSON.stringify(report)}`);
	await db.delete(schema.users);
	server.stop(true);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
	process.exit(0);
}
