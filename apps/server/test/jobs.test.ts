import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { onJobMachine, projectFolder, workspaceCall } from "../src/jobs/workspace.ts";
import { JobClient } from "../src/providers/job-client.ts";

describe("The worker's file and terminal capabilities", () => {
	test("a fake SSH seat receives only its scoped workspace request", async () => {
		const home = await mkdtemp(join(tmpdir(), "sekai-seat-"));
		const fakeSSH = async (command: string, input: string) => {
			const p = Bun.spawn(["/bin/sh", "-c", command], {
				env: { HOME: home, PATH: "/usr/bin:/bin" },
				stdin: new Blob([input]),
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, out, err] = await Promise.all([
				p.exited,
				new Response(p.stdout).text(),
				new Response(p.stderr).text(),
			]);
			if (code) throw Error(err);
			return out;
		};
		const call = (op: string, args: Record<string, unknown>) =>
			onJobMachine(fakeSSH, JSON.stringify({ root: "project", op, ...args }));
		try {
			await call("init", {});
			await call("write_file", { path: "index.ts", content: "// hello" });
			expect(await call("read_file", { path: "index.ts" })).toBe("// hello");
			await symlink(home, join(home, "project", "out"));
			await expect(call("read_file", { path: "out/index.ts" })).rejects.toThrow();
			await expect(call("write_file", { path: "../bad", content: "no" })).rejects.toThrow();
			if (Bun.which("bwrap")) {
				const out = await call("terminal", { command: "cat index.ts; test ! -d /home" });
				expect(out.startsWith("Exit code 0\n// hello") || out.includes("bwrap:")).toBe(true);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
	test("only the active session can use its work folder, including through links", async () => {
		const temp = await mkdtemp(join(tmpdir(), "sekai-job-"));
		const dir = { folder: join(temp, "work"), machineId: null, agentId: "test" };
		const signal = new AbortController().signal;
		const client = new JobClient((name, args) => workspaceCall(dir, name, args, signal));
		client.sessionId = "s";
		try {
			await workspaceCall(dir, "init", {}, signal);
			await client.write("s", "/work/a/b", "line one\nline two");
			expect((await client.read("s", "/work/a/b", 2, 1)).content).toBe("line two");
			await expect(client.read("another", "a/b")).rejects.toThrow();
			await expect(client.read("s", "../outside")).rejects.toThrow();
			await writeFile(join(temp, "outside"), "private");
			await symlink(temp, join(dir.folder, "alias"));
			await expect(client.write("s", "alias/outside", "replacement")).rejects.toThrow();
			expect(() => projectFolder("../other")).toThrow();
			expect(() => projectFolder(".ssh")).toThrow();
			expect(() => client.create("s", "ls", [], "/tmp")).toThrow();
			if (Bun.which("bwrap")) {
				const { terminalId } = client.create("s", "/bin/sh", ["-c", `cat a/b; test ! -f '${temp}/outside'`]);
				const t = client.terminal("s", terminalId);
				await t.done;
				// A kernel that disallows user namespaces denies execution; it never falls back to the host shell.
				if (t.code === 0) expect(t.output).toContain("line two");
				else expect(t.output).toMatch(/bwrap|blocked/);
				client.release("s", terminalId);
				expect(() => client.terminal("s", terminalId)).toThrow();
			}
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
});

const url = process.env.DATABASE_URL ?? "postgres://sekai:sekai@127.0.0.1:5433/sekai";
const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
const ready = await sql`select 1`.then(
	() => true,
	() => false,
);
await sql.end();
test.skipIf(!ready)(
	"worker lifecycle through the tools bridge, approvals, isolated sessions and recovery",
	async () => {
		const name = `sekai_jobs_test_${process.pid}`;
		const admin = postgres(url, { max: 1, onnotice: () => {} });
		const data = await mkdtemp(join(tmpdir(), "sekai-jobs-test-"));
		try {
			await admin.unsafe(`create database ${name}`);
			const db = new URL(url);
			db.pathname = `/${name}`;
			const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/jobs-check.ts")], {
				env: {
					...process.env,
					DATABASE_URL: db.href,
					SEKAI_DATA_DIR: data,
					GATEWAY_URL: "http://127.0.0.1:9/v1",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, out, err] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (code) throw new Error((out + err).slice(-4000));
			expect(out).toContain("Jobs verified");
		} finally {
			await admin.unsafe(`drop database if exists ${name} with (force)`);
			await admin.end();
			await rm(data, { recursive: true, force: true });
		}
	},
	60_000,
);
