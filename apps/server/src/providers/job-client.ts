import type { WorkspaceTool } from "../jobs/workspace.ts";
import { newId } from "../lib/ids.ts";

/** Only installed on dedicated job hosts. There is no default workspace for an unknown session. */
export class JobClient {
	sessionId: string | null = null;
	private terminals = new Map<
		string,
		{ abort: AbortController; done: Promise<void>; output: string; code: number | null }
	>();
	constructor(
		readonly call: (name: WorkspaceTool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
	) {}
	check(id: string) {
		if (this.sessionId !== id) throw new Error("No active job for this session.");
	}
	path(p: string) {
		return p.startsWith("/work/") ? p.slice(6) : p;
	}
	async read(id: string, path: string, line?: number | null, limit?: number | null) {
		this.check(id);
		const content = await this.call("read_file", { path: this.path(path) });
		const start = Math.max(0, (line ?? 1) - 1);
		return {
			content: content
				.split("\n")
				.slice(start, limit != null ? start + limit : undefined)
				.join("\n"),
		};
	}
	async write(id: string, path: string, content: string) {
		this.check(id);
		await this.call("write_file", { path: this.path(path), content });
		return {};
	}
	create(id: string, command: string, args: string[] | null | undefined, cwd?: string | null) {
		this.check(id);
		if (cwd && cwd !== "/work" && cwd !== ".") throw new Error("The terminal runs in the job folder.");
		if (this.terminals.size >= 4) throw new Error("Release a terminal first.");
		const terminalId = newId("term");
		const t = { abort: new AbortController(), done: Promise.resolve(), output: "", code: null as number | null };
		const quote = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
		t.done = this.call(
			"terminal",
			{ command: [command, ...(args ?? [])].map(quote).join(" ") },
			t.abort.signal,
		).then(
			(out) => {
				t.output = out;
				t.code = Number(out.match(/^Exit code (\d+)/)?.[1] ?? 1);
			},
			() => {
				t.output = "The command was blocked or stopped.";
				t.code = 1;
			},
		);
		this.terminals.set(terminalId, t);
		return { terminalId };
	}
	terminal(id: string, key: string) {
		this.check(id);
		const t = this.terminals.get(key);
		if (!t) throw new Error("Unknown terminal.");
		return t;
	}
	release(id: string, key: string) {
		this.terminal(id, key).abort.abort();
		this.terminals.delete(key);
		return {};
	}
}
