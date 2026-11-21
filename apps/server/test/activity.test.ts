import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";
import { resolveActivityScope } from "../src/services/activity.ts";

describe("resolveActivityScope", () => {
	test("non-admins always stay scoped to themselves", () => {
		const member = { userId: "usr_mika", admin: false };
		expect(resolveActivityScope(member)).toEqual({ kind: "me", userId: "usr_mika" });
		expect(resolveActivityScope(member, "me")).toEqual({ kind: "me", userId: "usr_mika" });
		expect(resolveActivityScope(member, "all")).toEqual({ kind: "me", userId: "usr_mika" });
		expect(resolveActivityScope(member, "usr_other")).toEqual({ kind: "me", userId: "usr_mika" });
	});

	test("admins default to Just me and may switch to Everyone or a person", () => {
		const admin = { userId: "usr_ada", admin: true };
		expect(resolveActivityScope(admin)).toEqual({ kind: "me", userId: "usr_ada" });
		expect(resolveActivityScope(admin, "me")).toEqual({ kind: "me", userId: "usr_ada" });
		expect(resolveActivityScope(admin, "all")).toEqual({ kind: "all", userId: null });
		expect(resolveActivityScope(admin, "usr_mika")).toEqual({ kind: "user", userId: "usr_mika" });
	});

	test("internal callers without an actor see all entries", () => {
		expect(resolveActivityScope(null)).toEqual({ kind: "all", userId: null });
	});
});

const MAIN_DB = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const TEST_DB = MAIN_DB.replace(/\/[^/?]+(\?.*)?$/, "/sekai_activity_test$1");

async function prepareDb(): Promise<boolean> {
	const sql = postgres(MAIN_DB, { max: 1, connect_timeout: 3, onnotice: () => {} });
	try {
		const [row] = await sql`select 1 from pg_database where datname = 'sekai_activity_test'`;
		if (!row) await sql.unsafe("create database sekai_activity_test");
		return true;
	} catch {
		return false;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

const dbReady = await prepareDb();

describe("activity log scope and isolation", () => {
	test.skipIf(!dbReady)(
		"members see only theirs; admins see what happened in Everyone, never what it carried",
		async () => {
			const p = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "activity-check.ts")], {
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					DATABASE_URL: TEST_DB,
					SEKAI_DATA_DIR: join(import.meta.dir, ".activity-data"),
					SEKAI_LOG_LEVEL: "error",
					GATEWAY_URL: "http://127.0.0.1:9/v1",
				},
			});
			const out = await new Response(p.stdout).text();
			const line = out.split("\n").find((l) => l.startsWith("REPORT "));
			if (!line) throw new Error(`no report: ${out}\n${await new Response(p.stderr).text()}`);
			const member = (title: string) => ({ title, userName: "Mika Aoki", agentName: "Moss", hasChat: false });
			const hidden = (title: string) => ({
				title,
				args: {},
				result: null,
				error: null,
				note: null,
				private: true,
			});
			expect(JSON.parse(line.slice(7))).toEqual({
				madeUp: {
					shown: [
						{ tool: "unknown", title: "Used a tool" },
						{ tool: "external", title: "Used one of its own tools" },
					],
					searchBuiltin: [],
					searchExternal: [],
					leaks: [],
					memberSeesOwn: ["kestrel_ledger_42", "OspreyVault"],
				},
				privacy: {
					adminSeesMembers: [hidden("Searched the library"), hidden("Wrote a note")],
					adminSeesOwn: [
						{
							title: "Saved studio plan",
							args: { title: "Studio plan" },
							result: "ok",
							error: null,
							note: null,
							private: false,
						},
					],
					memberSeesOwn: [
						{
							title: "Searched field notes",
							args: { q: "field notes" },
							result: "2 passages about the harbour",
							error: null,
							note: "Mika asked for the field notes",
							private: false,
						},
						{
							title: "Wrote note “Diary”",
							args: { title: "Diary", content: "a private thought" },
							result: null,
							error: "The note “Diary” is too long",
							note: null,
							private: false,
						},
					],
					adminSearchResult: [],
					adminSearchArgs: [],
					adminSearchError: [],
					adminSearchNote: [],
					adminSearchTitle: [],
					adminSearchOneMember: [],
					adminSearchLabel: ["Searched the library"],
					adminSearchTool: ["Wrote a note", "Saved studio plan"],
					adminSearchOwnArgs: ["Saved studio plan"],
					memberSearchOwn: ["Searched field notes"],
					csvLeaks: [],
					jsonlLeaks: [],
					csvKeepsOwn: true,
				},
				memberDefault: ["Searched field notes", "Wrote note “Diary”"],
				memberAllAttempt: ["Searched field notes", "Wrote note “Diary”"],
				memberAdminAttempt: ["Searched field notes", "Wrote note “Diary”"],
				memberCsvHasAdmin: false,
				memberJsonlHasAdmin: false,
				adminDefault: [{ title: "Saved studio plan", hasChat: true }],
				adminAll: [
					member("Searched the library"),
					member("Wrote a note"),
					{ title: "Saved studio plan", userName: "Ada Lovelace", agentName: "Nori", hasChat: true },
				],
				adminMemberOnly: [member("Searched the library"), member("Wrote a note")],
				adminCsvHasBoth: true,
				adminCsvHidesMemberChat: true,
				adminJsonl: [
					{ title: "Searched the library", person: "Mika Aoki", hasChat: false },
					{ title: "Wrote a note", person: "Mika Aoki", hasChat: false },
					{ title: "Saved studio plan", person: "Ada Lovelace", hasChat: true },
				],
			});
		},
	);
});
