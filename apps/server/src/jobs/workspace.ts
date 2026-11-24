import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import { badRequest } from "../lib/errors.ts";
import { sshTarget } from "../machines/manager.ts";
import { machinesForBot } from "../machines/seats.ts";
import { shq, sshText } from "../machines/ssh.ts";
import helper from "./workspace.py" with { type: "text" };

const path = z
	.string()
	.min(1)
	.max(512)
	.refine(
		(p) =>
			p
				.split("/")
				.every(
					(c) =>
						c &&
						c !== "." &&
						c !== ".." &&
						!c.includes("\\") &&
						[...c].every((ch) => ch.charCodeAt(0) >= 32),
				),
		"Use a path relative to the job folder.",
	);
export const workspaceTools = {
	read_file: z.object({ path }),
	write_file: z.object({ path, content: z.string().max(128 * 1024) }),
	terminal: z.object({ command: z.string().min(1).max(8000) }),
};
export type WorkspaceTool = keyof typeof workspaceTools;
type MachineExec = (command: string, input: string) => Promise<string>;
/** The only remote command is the fixed helper. Paths, commands and file contents travel on stdin. */
export async function onJobMachine(exec: MachineExec, input: string): Promise<string> {
	return JSON.parse(await exec(`/usr/bin/python3 -I -c ${shq(helper)}`, input));
}
export function projectFolder(input: string): string {
	if (!path.safeParse(input).success || input.split("/").some((s) => s.startsWith(".")))
		throw badRequest("Choose a project folder inside the bot’s home.");
	return input;
}

export async function workspaceCall(
	job: { agentId: string; machineId: string | null; folder: string },
	op: WorkspaceTool | "init",
	args: Record<string, unknown>,
	signal: AbortSignal,
): Promise<string> {
	const input = JSON.stringify({ ...(op === "init" ? {} : workspaceTools[op].parse(args)), root: job.folder, op });
	signal.throwIfAborted();
	if (job.machineId) {
		requirePermission("computers");
		const machine = (await machinesForBot(job.agentId)).find(
			(m) => m.id === job.machineId && m.kind !== "device" && m.status === "running",
		);
		if (!machine) throw badRequest("This bot no longer has a running computer for this job.");
		const target = await sshTarget(machine, job.agentId);
		signal.throwIfAborted();
		return onJobMachine(
			(command, body) => sshText(target, command, { input: body, signal, timeoutMs: 65000 }),
			input,
		);
	}
	const p = Bun.spawn(["/usr/bin/python3", "-I", "-c", helper], {
		stdin: new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: "/usr/bin:/bin" },
		signal,
	});
	const [code, out, err] = await Promise.all([
		p.exited,
		new Response(p.stdout).text(),
		new Response(p.stderr).text(),
	]);
	if (code) throw badRequest(err.trim().slice(-500) || "The workspace operation failed.");
	return JSON.parse(out);
}
