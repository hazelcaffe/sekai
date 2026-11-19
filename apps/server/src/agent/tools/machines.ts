import type { Agent, Machine } from "@sekai/shared";
import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { truncateMiddle } from "../../lib/text.ts";
import { driverFor } from "../../machines/drivers.ts";
import {
	backendOf,
	computerOf,
	createMachine,
	deleteMachine,
	findMachine,
	getMachine,
	listMachines,
	machineAccess,
	updateMachine,
} from "../../machines/manager.ts";
import { type BotMachine, machinesForBot } from "../../machines/seats.ts";
import { getSettings } from "../../services/settings.ts";
import { askOn, machineTarget, onMachine, peek, pick, riskOn } from "./targets.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

/** Bots' machines from the bot's side: asking for a computer, devboxes, and running commands on them. */

async function proxmoxReady(): Promise<boolean> {
	const p = (await getSettings()).machines.proxmox;
	return Boolean(p.url && p.tokenId && p.node);
}

async function hasMachine(agent: Agent): Promise<boolean> {
	return (await machinesForBot(agent.id)).length > 0;
}

/** Its own machines (not ones shared with it), in this run. */
async function hasOwnMachine(agent: Agent): Promise<boolean> {
	return (await machinesForBot(agent.id)).some((m) => !m.seat);
}

function describe(m: Machine | BotMachine): string {
	if (m.kind === "device") {
		return [
			`${m.name} (the user's own computer, lent to you through the Sekai desktop app): ${m.status === "running" ? "online" : "offline"}.`,
			`You act as ${m.username}. Use on: "device" with the computer_ and browser_ tools, and machine: "device" with run_command and the file tools. Everything you do there is the user's real computer: be careful.`,
		].join("\n");
	}
	const where = [
		m.addresses.tailscale && `Tailscale ${m.addresses.tailscale}`,
		m.addresses.lan && `LAN ${m.addresses.lan}`,
	]
		.filter(Boolean)
		.join(", ");
	const backend = backendOf(m);
	const runsAs = backend === "vm" ? ", a virtual machine" : backend === "lxc" ? ", a container" : "";
	const seat = "seat" in m ? m.seat : null;
	const lines = [
		`${m.name} (${m.kind}${runsAs}${seat ? `, ${seat.ownerBot}'s, shared with you` : ""}): ${m.status}${m.statusDetail ? ` (${m.statusDetail})` : ""}`,
		`Host ${m.hostname}${where ? `, ${where}` : ""}; your account: ${m.username} (sudo, no password needed); root also exists.`,
		`Size: ${m.specs.cores} cores, ${Math.round(m.specs.memoryMb / 1024)} GB RAM${m.specs.minMemoryMb ? ` (ballooning from ${Math.round(m.specs.minMemoryMb / 1024)} GB)` : ""}, ${m.specs.diskGb} GB disk.`,
	];
	if (m.kind === "computer")
		lines.push(
			seat
				? `Desktop: your own screen (display :${seat.display}) with XFCE and Google Chrome (its debugging port ${seat.cdpPort}); VNC on port ${m.ports.vnc ?? "-"}.`
				: `Desktop: XFCE with Google Chrome. VNC on port ${m.ports.vnc ?? "-"}, RDP on ${m.ports.rdp ?? "-"}.`,
		);
	if (seat)
		lines.push(
			`Other bots work on it too, each in its own account. Powering it, resizing it, checkpoints and deleting it are for ${seat.ownerBot} and its owner.`,
		);
	if (m.expiresAt) lines.push(`Deleted automatically ${new Date(m.expiresAt).toISOString()} unless extended.`);
	return lines.join("\n");
}

const machine = onMachine;

/** The machine a call targets, by name, without requiring it to be running (status, resize, passwords). */
async function target(ctx: ToolContext, ref?: string): Promise<BotMachine> {
	const all = await machinesForBot(ctx.agent.id);
	const m = pick(all, ref) ?? (!ref && all.length === 1 ? all[0] : null);
	if (m) return m;
	if (!ref && all.length > 1) throw new ToolError(`Say which machine: ${all.map((x) => x.name).join(", ")}.`);
	throw new ToolError(ref ? `You don't have a machine called "${ref}".` : "You don't have a computer or devbox.");
}

/** Power, size, checkpoints and deleting are the machine's own bot's: a shared machine says whose it is. */
function ownOnly(m: BotMachine, what: string): void {
	if (m.seat) {
		throw new ToolError(
			`${m.name} is ${m.seat.ownerBot}'s, shared with you: only ${m.seat.ownerBot} and its owner can ${what}. You can run commands and use files${m.kind === "computer" ? ", your own screen and browser" : ""} there.`,
		);
	}
}

/** Commands and files: weighed by where they run (the user's own computer counts as external). */
const onTarget = <S extends z.ZodType>(base: "read" | "write") => ({
	riskFor: async (args: z.infer<S>, ctx: ToolContext) =>
		riskOn(await peek(ctx, (args as { machine?: string }).machine, false), base),
	askFirst: async (args: z.infer<S>, ctx: ToolContext) =>
		askOn(await peek(ctx, (args as { machine?: string }).machine, false), base),
});

function shellNote(m: Machine): string {
	return m.kind === "device" ? ` on ${m.name} (the user's computer)` : m.kind === "devbox" ? ` on ${m.name}` : "";
}

const MAX_EDIT_BYTES = 4_000_000;

/** Asks you unless you've let bots get machines on their own. */
async function askUnlessAllowed(what: string): Promise<string | null> {
	return (await getSettings()).machines.agentRequests === "allow" ? null : `Bots ask before ${what}.`;
}

const backend = z
	.enum(["vm", "lxc"])
	.optional()
	.describe(
		"lxc: a container, lighter and quicker to start. vm: a virtual machine, fully separate with its own kernel (for Docker-heavy work, kernel modules or other low-level work). Leave it out for the usual choice.",
	);

async function waitUntilReady(id: string, ms: number): Promise<Machine | null> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const m = await getMachine(id);
		if (!m || m.status === "running" || m.status === "error") return m;
		await Bun.sleep(3000);
	}
	return getMachine(id);
}

export const machineTools = [
	defineTool({
		name: "computer_request",
		description:
			"Ask the user for a computer of your own: a Debian desktop (XFCE, Chrome) you control with the computer_ tools, use from the terminal with run_command, and browse with on screen. It runs as a virtual machine or a container on the user's Proxmox server. It takes about 10 minutes to set up. Explain why you need it.",
		category: "machines",
		parameters: z.object({
			reason: z.string().min(1).max(500),
			backend,
			cores: z.number().int().min(1).max(32).optional(),
			memoryGb: z.number().min(1).max(128).optional(),
			diskGb: z.number().int().min(16).max(2048).optional(),
		}),
		risk: "write",
		title: () => "Asked for a computer",
		available: async (agent) => (await proxmoxReady()) && !(await computerOf(agent.id)),
		askFirst: () => askUnlessAllowed("getting a computer"),
		async execute(args, ctx) {
			try {
				const m = await createMachine(
					{
						agentId: ctx.agent.id,
						kind: "computer",
						backend: args.backend,
						specs: {
							...(args.cores ? { cores: args.cores } : {}),
							...(args.memoryGb ? { memoryMb: Math.round(args.memoryGb * 1024) } : {}),
							...(args.diskGb ? { diskGb: args.diskGb } : {}),
						},
					},
					"agent",
				);
				return `Your computer is being set up (about 10 minutes).\n${describe(m)}\nCheck on it with computer_status; the computer_ tools appear once it's running.`;
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "computer_status",
		description:
			"Your computer, devboxes and any computer the user lent you: status, addresses, size, and how to reach them.",
		category: "machines",
		parameters: z.object({}),
		risk: "read",
		title: () => "Checked my machines",
		available: hasMachine,
		async execute(_args, ctx) {
			const all = await machinesForBot(ctx.agent.id);
			return all.map(describe).join("\n\n");
		},
	}),
	defineTool({
		name: "computer_resize",
		description: "Ask for more (or less) CPU, memory or disk on your computer or a devbox. Disks can only grow.",
		category: "machines",
		parameters: z.object({
			machine,
			cores: z.number().int().min(1).max(32).optional(),
			memoryGb: z.number().min(1).max(128).optional(),
			diskGb: z.number().int().min(4).max(2048).optional(),
			reason: z.string().min(1).max(300),
		}),
		risk: "write",
		title: () => "Asked to resize a machine",
		available: hasOwnMachine,
		askFirst: () => askUnlessAllowed("resizing their machines"),
		async execute(args, ctx) {
			const m = await target(ctx, args.machine);
			ownOnly(m, "resize it");
			try {
				const next = await updateMachine(m.id, {
					specs: {
						...(args.cores ? { cores: args.cores } : {}),
						...(args.memoryGb
							? {
									memoryMb: Math.round(args.memoryGb * 1024),
									minMemoryMb: Math.min(m.specs.minMemoryMb, Math.round(args.memoryGb * 1024)),
								}
							: {}),
						...(args.diskGb ? { diskGb: args.diskGb } : {}),
					},
				});
				return `Resized.\n${describe(next)}`;
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "machine_credentials",
		description:
			"The passwords on one of your machines: your account's (for sudo prompts and the screen), root's, and VNC's. Only use them where a password is truly needed.",
		category: "machines",
		parameters: z.object({ machine }),
		risk: "read",
		title: () => "Looked up machine passwords",
		available: hasMachine,
		async execute(args, ctx) {
			const m = await target(ctx, args.machine);
			const a = await machineAccess(m.id, ctx.agent.id);
			if (!a.userPassword) return `${m.name} is the user's own machine; they didn't give Sekai its passwords.`;
			return [
				`${a.username}: ${a.userPassword}`,
				...(a.rootPassword ? [`root: ${a.rootPassword}`] : []),
				...(a.vncPassword ? [`VNC: ${a.vncPassword}`] : []),
			].join("\n");
		},
	}),
	defineTool({
		name: "run_command",
		description:
			'Run a shell command on your computer or a devbox, as your own user (use sudo for admin), or on the user\'s computer with machine: "device" (their default shell: PowerShell on Windows, zsh or bash on macOS and Linux; in the folder they chose). Good for installing software, git, builds, tests, scripts and files. Long jobs: run them in the background and check back.',
		category: "machines",
		parameters: z.object({
			command: z.string().min(1).max(20_000),
			machine,
			cwd: z
				.string()
				.optional()
				.describe("Directory to run in (default: your home, or the user's chosen folder)"),
			timeoutSeconds: z.number().int().min(1).max(3600).default(120),
		}),
		risk: "write",
		title: (a) => `Ran \`${a.command.length > 60 ? `${a.command.slice(0, 60)}…` : a.command}\``,
		available: hasMachine,
		...onTarget("write"),
		async execute(args, ctx) {
			const m = await machineTarget(ctx, args.machine);
			// Something that can break the machine (sudo, apt, rm -r…): a checkpoint first, to roll back to.
			const { checkpointBefore } = await import("../../machines/manager.ts");
			const saved = await checkpointBefore(m, args.command, Boolean(m.seat));
			const driver = await driverFor(m, ctx.agent.id);
			const r = await driver
				.exec(args.command, { cwd: args.cwd, timeoutMs: args.timeoutSeconds * 1000, signal: ctx.signal })
				.catch((err: unknown) => {
					throw new ToolError(errorMessage(err));
				});
			const parts = [
				...(saved ? [saved] : []),
				r.timedOut
					? `Timed out after ${args.timeoutSeconds}s${shellNote(m)} (still running? use background jobs for long work)`
					: `Exit code ${r.code}${shellNote(m)}`,
			];
			if (r.stdout.trim()) parts.push(`stdout:\n${truncateMiddle(r.stdout, 12_000)}`);
			if (r.stderr.trim()) parts.push(`stderr:\n${truncateMiddle(r.stderr, 6_000)}`);
			return parts.join("\n");
		},
	}),
	defineTool({
		name: "machine_checkpoint",
		description:
			"Checkpoints of your computer or devbox: snapshots of its disk, or full backups where its storage can't snapshot (those take a minute or more to save). list: what there is. create: save the machine as it is now, before something risky (with snapshots, Sekai also saves one on its own before commands like sudo, apt or rm -r). restore: go back to one (everything since is lost; the machine restarts). delete: remove one.",
		category: "machines",
		parameters: z.object({
			action: z.enum(["list", "create", "restore", "delete"]),
			machine,
			label: z.string().max(200).optional().describe("create: what it's for"),
			name: z.string().max(60).optional().describe("restore/delete: the checkpoint's name from list"),
		}),
		risk: "write",
		riskFor: (args) => (args.action === "list" ? "read" : args.action === "create" ? "write" : "destructive"),
		title: (a) =>
			a.action === "create"
				? "Saved a checkpoint"
				: a.action === "restore"
					? `Went back to checkpoint ${a.name ?? ""}`
					: a.action === "delete"
						? "Deleted a checkpoint"
						: "Listed checkpoints",
		available: hasOwnMachine,
		async execute(args, ctx) {
			const { deleteCheckpoint, listCheckpoints, makeCheckpoint, restoreCheckpoint } = await import(
				"../../machines/manager.ts"
			);
			const m = await machineTarget(ctx, args.machine);
			ownOnly(m, "save or restore its checkpoints");
			try {
				switch (args.action) {
					case "list":
						return { checkpoints: await listCheckpoints(m.id) };
					case "create":
						return { saved: await makeCheckpoint(m.id, args.label ?? "Saved by the bot") };
					case "restore":
						if (!args.name) throw new ToolError("Say which checkpoint (its name from list)");
						await restoreCheckpoint(m.id, args.name);
						return { restored: args.name, note: "The machine went back to that point and restarted." };
					case "delete":
						if (!args.name) throw new ToolError("Say which checkpoint (its name from list)");
						await deleteCheckpoint(m.id, args.name);
						return { deleted: args.name };
				}
			} catch (err) {
				if (err instanceof ToolError) throw err;
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "read_file",
		description: 'Read a text file on your computer, a devbox, or the user\'s computer (machine: "device").',
		category: "machines",
		parameters: z.object({
			path: z.string().min(1),
			machine,
			maxBytes: z.number().int().min(100).max(500_000).default(60_000),
		}),
		risk: "read",
		title: (a) => `Read ${a.path}`,
		available: hasMachine,
		...onTarget("read"),
		async execute(args, ctx) {
			const m = await machineTarget(ctx, args.machine);
			const text = await (await driverFor(m, ctx.agent.id))
				.readFile(args.path, args.maxBytes)
				.catch((err: unknown) => {
					throw new ToolError(errorMessage(err));
				});
			if (!text) return "(empty file)";
			const more = new TextEncoder().encode(text).length >= args.maxBytes;
			return more
				? `${text}\n… (stopped at ${args.maxBytes} bytes; raise maxBytes or read a part with run_command)`
				: text;
		},
	}),
	defineTool({
		name: "write_file",
		description:
			'Write a whole text file on your computer, a devbox, or the user\'s computer (machine: "device"); folders are created as needed. To change part of a file, use edit_file.',
		category: "machines",
		parameters: z.object({
			path: z.string().min(1),
			content: z.string().max(2_000_000),
			machine,
			append: z.boolean().optional(),
		}),
		risk: "write",
		title: (a) => `${a.append ? "Added to" : "Wrote"} ${a.path}`,
		available: hasMachine,
		...onTarget("write"),
		async execute(args, ctx) {
			const m = await machineTarget(ctx, args.machine);
			await (await driverFor(m, ctx.agent.id))
				.writeFile(args.path, args.content, args.append)
				.catch((err: unknown) => {
					throw new ToolError(errorMessage(err));
				});
			return `Wrote ${args.content.length} characters to ${args.path}${shellNote(m) || ` on ${m.name}`}.`;
		},
	}),
	defineTool({
		name: "edit_file",
		description:
			"Change part of a text file: replaces oldText with newText exactly (whitespace and line breaks included). oldText must appear once, unless replaceAll is set; include a few surrounding lines to make it unique. Read the file first.",
		category: "machines",
		parameters: z.object({
			path: z.string().min(1),
			oldText: z.string().min(1),
			newText: z.string(),
			replaceAll: z.boolean().optional(),
			machine,
		}),
		risk: "write",
		title: (a) => `Edited ${a.path}`,
		available: hasMachine,
		...onTarget("write"),
		async execute(args, ctx) {
			const m = await machineTarget(ctx, args.machine);
			const driver = await driverFor(m, ctx.agent.id);
			const fail = (err: unknown) => {
				throw new ToolError(errorMessage(err));
			};
			const text = await driver.readFile(args.path, MAX_EDIT_BYTES).catch(fail);
			if (new TextEncoder().encode(text).length >= MAX_EDIT_BYTES) {
				throw new ToolError("That file is too big to edit this way; use run_command (sed, a script) instead.");
			}
			const result = applyEdit(text, args.oldText, args.newText, args.replaceAll ?? false);
			if (typeof result === "string") throw new ToolError(result);
			await driver.writeFile(args.path, result.text).catch(fail);
			return `Replaced ${result.count} occurrence${result.count === 1 ? "" : "s"} in ${args.path}${shellNote(m)}.`;
		},
	}),
	defineTool({
		name: "devbox_create",
		description:
			"Spin up a devbox: a temporary Linux machine (Debian, no desktop; a container or a virtual machine) for development, builds or experiments, with your SSH key, a sudo account and Tailscale. It's deleted automatically after ttlHours. Use run_command with machine: <name> to work in it.",
		category: "machines",
		parameters: z.object({
			name: z.string().min(1).max(40).optional().describe("Short name, e.g. api-test"),
			purpose: z.string().min(1).max(300),
			backend,
			ttlHours: z
				.number()
				.min(0.25)
				.max(24 * 7)
				.optional(),
			cores: z.number().int().min(1).max(16).optional(),
			memoryGb: z.number().min(0.5).max(64).optional(),
			diskGb: z.number().int().min(4).max(500).optional(),
		}),
		risk: "write",
		title: (a) => `Created devbox ${a.name ?? ""}`.trim(),
		available: proxmoxReady,
		async execute(args, ctx) {
			let m: Machine;
			try {
				m = await createMachine(
					{
						agentId: ctx.agent.id,
						kind: "devbox",
						backend: args.backend,
						name: args.name,
						ttlHours: args.ttlHours,
						specs: {
							...(args.cores ? { cores: args.cores } : {}),
							...(args.memoryGb ? { memoryMb: Math.round(args.memoryGb * 1024) } : {}),
							...(args.diskGb ? { diskGb: args.diskGb } : {}),
						},
					},
					"agent",
				);
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
			const done = await waitUntilReady(m.id, 5 * 60_000);
			if (done?.status === "error") throw new ToolError(`The devbox failed to set up: ${done.statusDetail}`);
			return done?.status === "running"
				? `Ready.\n${describe(done)}`
				: `Still setting up; check with computer_status.\n${describe(done ?? m)}`;
		},
	}),
	defineTool({
		name: "devbox_delete",
		description: "Delete one of your devboxes and everything on it.",
		category: "machines",
		parameters: z.object({ name: z.string().min(1) }),
		risk: "destructive",
		title: (a) => `Deleted devbox ${a.name}`,
		available: async (agent) => (await listMachines({ agentId: agent.id })).some((m) => m.kind === "devbox"),
		async execute(args, ctx) {
			const m = await findMachine(ctx.agent.id, args.name);
			if (m?.kind !== "devbox") throw new ToolError(`You don't have a devbox called "${args.name}".`);
			await deleteMachine(m.id);
			return `Deleted ${m.name}.`;
		},
	}),
	defineTool({
		name: "devbox_extend",
		description: "Keep a devbox longer: it's deleted this many hours from now instead.",
		category: "machines",
		parameters: z.object({
			name: z.string().min(1),
			hours: z
				.number()
				.min(0.25)
				.max(24 * 7),
		}),
		risk: "write",
		title: (a) => `Kept devbox ${a.name} for ${a.hours}h`,
		available: async (agent) => (await listMachines({ agentId: agent.id })).some((m) => m.kind === "devbox"),
		async execute(args, ctx) {
			const m = await findMachine(ctx.agent.id, args.name);
			if (m?.kind !== "devbox") throw new ToolError(`You don't have a devbox called "${args.name}".`);
			const next = await updateMachine(m.id, { ttlHours: args.hours });
			return describe(next);
		},
	}),
];

/** An exact find-and-replace; an error message when oldText is missing or ambiguous. */
export function applyEdit(
	text: string,
	oldText: string,
	newText: string,
	replaceAll: boolean,
): { text: string; count: number } | string {
	const count = text.split(oldText).length - 1;
	if (count === 0) {
		// Line endings are the usual culprit: the file uses CRLF and the edit doesn't (or the other way).
		const crlf = text.includes("\r\n");
		const fixed = crlf ? oldText.replace(/\r?\n/g, "\r\n") : oldText.replace(/\r\n/g, "\n");
		if (fixed !== oldText && text.includes(fixed)) {
			const fixedNew = crlf ? newText.replace(/\r?\n/g, "\r\n") : newText.replace(/\r\n/g, "\n");
			return applyEdit(text, fixed, fixedNew, replaceAll);
		}
		return "oldText isn't in the file. Read it again and copy the exact text, including indentation.";
	}
	if (count > 1 && !replaceAll) {
		return `oldText appears ${count} times. Include more surrounding lines to pick one, or set replaceAll.`;
	}
	return {
		text: replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, () => newText),
		count: replaceAll ? count : 1,
	};
}
