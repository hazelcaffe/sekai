// End-to-end check for activity log scoping and isolation across users; run by activity.test.ts.
import { rmSync } from "node:fs";
import { createApp } from "../../src/app.ts";
import { resetRateLimits } from "../../src/auth/routes.ts";
import { ensureSetupCode, resetAuthCaches, setupCodeForTests } from "../../src/auth/service.ts";
import { config } from "../../src/config.ts";
import { closeDb, db, initDb, schema } from "../../src/db/index.ts";
import { newId } from "../../src/lib/ids.ts";

await initDb();
await db.delete(schema.activityLog);
await db.delete(schema.users);
resetAuthCaches();
resetRateLimits();

await ensureSetupCode("http://127.0.0.1");
const app = createApp();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req, srv) => app.fetch(req, srv) });
const base = `http://127.0.0.1:${server.port}`;

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

async function call(method: string, path: string, opts: { body?: unknown; jar: Jar }) {
	const headers: Record<string, string> = { origin: base, cookie: opts.jar.header() };
	if (opts.body !== undefined) headers["content-type"] = "application/json";
	const res = await fetch(`${base}${path}`, {
		method,
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	});
	opts.jar.take(res);
	const text = await res.text();
	try {
		return { status: res.status, data: text ? JSON.parse(text) : null, text };
	} catch {
		return { status: res.status, data: text, text };
	}
}

const admin = new Jar();
const member = new Jar();

try {
	await call("POST", "/api/auth/setup", {
		jar: admin,
		body: { username: "ada", name: "Ada Lovelace", password: "correct horse battery", code: setupCodeForTests() },
	});
	const adminMe = await call("GET", "/api/auth/status", { jar: admin });
	const adminId = String(adminMe.data.user.id);

	const created = await call("POST", "/api/admin/users", {
		jar: admin,
		body: { username: "mika", name: "Mika Aoki", roleId: "role_member", password: "temporary" },
	});
	const memberId = String(created.data.user.id);
	await call("POST", "/api/auth/login", {
		jar: member,
		body: { username: "mika", password: created.data.temporaryPassword },
	});
	await call("POST", "/api/auth/password", { jar: member, body: { next: "mika's own long password" } });

	const adminBot = (await call("POST", "/api/agents", { jar: admin, body: { name: "Nori" } })).data;
	const memberBot = (await call("POST", "/api/agents", { jar: member, body: { name: "Moss" } })).data;
	const adminChat = (
		await call("POST", "/api/conversations", { jar: admin, body: { kind: "direct", agentId: adminBot.id } })
	).data;
	const memberChat = (
		await call("POST", "/api/conversations", { jar: member, body: { kind: "direct", agentId: memberBot.id } })
	).data;

	await db.insert(schema.activityLog).values([
		{
			id: newId("act", 20),
			at: 2_000,
			userId: adminId,
			agentId: adminBot.id,
			conversationId: adminChat.id,
			messageId: "msg_admin",
			runId: "run_admin",
			toolCallId: "tc_admin",
			tool: "note_write",
			title: "Saved studio plan",
			source: "builtin",
			risk: "write",
			status: "done",
			decision: "approved",
			decidedBy: "user",
			note: null,
			args: { title: "Studio plan" },
			result: "ok",
			error: null,
			durationMs: 120,
		},
		{
			id: newId("act", 20),
			at: 3_000,
			userId: memberId,
			agentId: memberBot.id,
			conversationId: memberChat.id,
			messageId: "msg_member",
			runId: "run_member",
			toolCallId: "tc_member",
			tool: "library_search",
			title: "Searched field notes",
			source: "builtin",
			risk: "read",
			status: "done",
			decision: "approved",
			decidedBy: "reviewer",
			note: "Mika asked for the field notes",
			args: { q: "field notes" },
			result: "2 passages about the harbour",
			error: null,
			durationMs: 45,
		},
		{
			id: newId("act", 20),
			at: 2_500,
			userId: memberId,
			agentId: memberBot.id,
			conversationId: memberChat.id,
			messageId: "msg_member_2",
			runId: "run_member",
			toolCallId: "tc_member_2",
			tool: "note_write",
			title: "Wrote note “Diary”",
			source: "builtin",
			risk: "write",
			status: "error",
			decision: null,
			decidedBy: null,
			note: null,
			args: { title: "Diary", content: "a private thought" },
			result: null,
			error: "The note “Diary” is too long",
			durationMs: 12,
		},
	]);

	const memberDefault = (await call("GET", "/api/activity", { jar: member })).data as { title: string }[];
	const memberAllAttempt = (await call("GET", "/api/activity?scope=all", { jar: member })).data as {
		title: string;
	}[];
	const memberAdminAttempt = (await call("GET", `/api/activity?scope=${adminId}`, { jar: member })).data as {
		title: string;
	}[];
	const memberCsvAttempt = (await call("GET", "/api/activity/export?format=csv&scope=all", { jar: member })).text;
	const memberJsonlAttempt = (
		await call("GET", `/api/activity/export?format=jsonl&scope=${adminId}`, { jar: member })
	).text;

	const adminDefault = (await call("GET", "/api/activity", { jar: admin })).data as {
		title: string;
		conversationId: string | null;
	}[];
	const adminAll = (await call("GET", "/api/activity?scope=all", { jar: admin })).data as {
		title: string;
		userName: string | null;
		agentName: string | null;
		conversationId: string | null;
		messageId: string | null;
	}[];
	const adminMemberOnly = (await call("GET", `/api/activity?scope=${memberId}`, { jar: admin })).data as {
		title: string;
		userName: string | null;
		agentName: string | null;
		conversationId: string | null;
	}[];
	const adminCsvAll = (await call("GET", "/api/activity/export?format=csv&scope=all", { jar: admin })).text;
	const adminJsonlText = (await call("GET", "/api/activity/export?format=jsonl&scope=all", { jar: admin })).text;
	const adminJsonlAll = adminJsonlText
		.trim()
		.split("\n")
		.map(
			(l) =>
				JSON.parse(l) as {
					title: string;
					person: string;
					conversationId: string | null;
					messageId: string | null;
				},
		);

	type Entry = {
		title: string;
		args: Record<string, unknown>;
		result: string | null;
		error: string | null;
		note: string | null;
		private?: boolean;
	};
	const search = async (jar: Jar, q: string, scope = "all") =>
		((await call("GET", `/api/activity?scope=${scope}&q=${encodeURIComponent(q)}`, { jar })).data as Entry[]).map(
			(x) => x.title,
		);
	const shown = (x: Entry) => ({
		title: x.title,
		args: x.args,
		result: x.result,
		error: x.error,
		note: x.note,
		private: x.private ?? false,
	});
	const memberOwn = (await call("GET", "/api/activity", { jar: member })).data as Entry[];
	const adminAllFull = (await call("GET", "/api/activity?scope=all", { jar: admin })).data as Entry[];
	const privacy = {
		// Someone else's entry: what happened, never what it carried.
		adminSeesMembers: adminAllFull.filter((x) => x.private).map(shown),
		adminSeesOwn: adminAllFull.filter((x) => !x.private).map(shown),
		memberSeesOwn: memberOwn.map(shown),
		// Searching for what someone else's entry carried finds nothing; its tool and plain name do.
		adminSearchResult: await search(admin, "harbour"),
		adminSearchArgs: await search(admin, "field"),
		adminSearchError: await search(admin, "too long"),
		adminSearchNote: await search(admin, "asked"),
		adminSearchTitle: await search(admin, "Diary"),
		adminSearchOneMember: await search(admin, "harbour", memberId),
		adminSearchLabel: await search(admin, "searched"),
		adminSearchTool: await search(admin, "note_write"),
		adminSearchOwnArgs: await search(admin, "Studio"),
		memberSearchOwn: await search(member, "harbour", "me"),
		// Neither export carries it.
		csvLeaks: ["harbour", "field notes", "Diary", "private thought", "too long", "Mika asked"].filter((w) =>
			adminCsvAll.includes(w),
		),
		jsonlLeaks: ["harbour", "field notes", "Diary", "private thought", "too long", "Mika asked"].filter((w) =>
			adminJsonlText.includes(w),
		),
		csvKeepsOwn: adminCsvAll.includes("Studio plan"),
	};

	// Names a model or an outside agent made up are free text (they could carry what the chat said): others never see
	// or find them by it, in the list, search or either export.
	const madeUpRow = (id: string, at: number, tool: string, source: "builtin" | "external") => ({
		id: newId("act", 20),
		at,
		userId: memberId,
		agentId: memberBot.id,
		conversationId: memberChat.id,
		messageId: `msg_${id}`,
		runId: "run_member",
		toolCallId: `tc_${id}`,
		tool,
		title: tool,
		source,
		risk: null,
		status: "error" as const,
		decision: null,
		decidedBy: null,
		note: null,
		args: {},
		result: null,
		error: null,
		durationMs: 1,
	});
	await db
		.insert(schema.activityLog)
		.values([
			madeUpRow("made_up", 1_000, "kestrel_ledger_42", "builtin"),
			madeUpRow("agent", 900, "OspreyVault", "external"),
		]);
	const afterMadeUp = (await call("GET", `/api/activity?scope=${memberId}`, { jar: admin })).data as {
		tool: string;
		title: string;
	}[];
	const madeUpCsv = (await call("GET", "/api/activity/export?format=csv&scope=all", { jar: admin })).text;
	const madeUpJsonl = (await call("GET", "/api/activity/export?format=jsonl&scope=all", { jar: admin })).text;
	const madeUp = {
		shown: afterMadeUp
			.filter((x) => x.title !== "Searched the library" && x.title !== "Wrote a note")
			.map((x) => ({
				tool: x.tool,
				title: x.title,
			})),
		searchBuiltin: await search(admin, "kestrel"),
		searchExternal: await search(admin, "osprey"),
		leaks: ["kestrel", "Osprey"].filter((w) => madeUpCsv.includes(w) || madeUpJsonl.includes(w)),
		memberSeesOwn: ((await call("GET", "/api/activity", { jar: member })).data as { tool: string }[])
			.map((x) => x.tool)
			.filter((t) => t === "kestrel_ledger_42" || t === "OspreyVault"),
	};

	process.stdout.write(
		`REPORT ${JSON.stringify({
			madeUp,
			privacy,
			memberDefault: memberDefault.map((x) => x.title),
			memberAllAttempt: memberAllAttempt.map((x) => x.title),
			memberAdminAttempt: memberAdminAttempt.map((x) => x.title),
			memberCsvHasAdmin: memberCsvAttempt.includes("Saved studio plan"),
			memberJsonlHasAdmin:
				memberJsonlAttempt.includes("Saved studio plan") || memberJsonlAttempt.includes(adminChat.id),
			adminDefault: adminDefault.map((x) => ({ title: x.title, hasChat: Boolean(x.conversationId) })),
			adminAll: adminAll.map((x) => ({
				title: x.title,
				userName: x.userName,
				agentName: x.agentName,
				hasChat: Boolean(x.conversationId || x.messageId),
			})),
			adminMemberOnly: adminMemberOnly.map((x) => ({
				title: x.title,
				userName: x.userName,
				agentName: x.agentName,
				hasChat: Boolean(x.conversationId),
			})),
			adminCsvHasBoth:
				adminCsvAll.includes("Mika Aoki") &&
				adminCsvAll.includes("Moss") &&
				adminCsvAll.includes("Ada Lovelace"),
			// Exports never point into someone else's chat either.
			adminCsvHidesMemberChat: !adminCsvAll.includes(memberChat.id) && !adminCsvAll.includes("msg_member"),
			adminJsonl: adminJsonlAll.map((x) => ({
				title: x.title,
				person: x.person,
				hasChat: Boolean(x.conversationId || x.messageId),
			})),
		})}\n`,
	);
} finally {
	server.stop(true);
	await closeDb();
	rmSync(config.dataDir, { recursive: true, force: true });
}
