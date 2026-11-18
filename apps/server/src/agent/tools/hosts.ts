import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { truncateMiddle } from "../../lib/text.ts";
import { findReachable, grantAccess, reachableFor, revokeAccess, runAs } from "../../machines/hosts.ts";
import { listAgents } from "../../services/agents.ts";
import { defineTool, ToolError } from "./types.ts";

const MODE_WORD: Record<string, string> = {
	yolo: "YOLO mode",
	auto: "approved (auto mode)",
	primary: "approved (primary bot mode)",
	manual: "the user",
};

/**
 * Whether a request would get root (or Administrator): the account it names, or else the device's own account
 * (which can be root too, e.g. when Sekai runs as root).
 */
async function rootAccount(agentId: string, host: string, as: string | undefined): Promise<boolean> {
	const t = await findReachable(agentId, host).catch(() => null);
	const account = as?.trim() || (t?.kind === "host" ? t.accounts?.[0]?.name : undefined);
	return Boolean(account && /^(root|administrator)$/i.test(account));
}

export const hostTools = [
	defineTool({
		name: "hosts_list",
		category: "machines",
		description:
			"The user's own servers and devices (often on their tailnet), and other bots' computers and devboxes, with whether you may use each. A device can have several accounts (its user's own first, maybe root): you're let in per account. To use one you don't have, ask with host_request_access, or ask the primary bot to grant it.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Listed devices",
		async execute(_args, ctx) {
			return { devices: await reachableFor(ctx.agent.id) };
		},
	}),
	defineTool({
		name: "host_request_access",
		category: "machines",
		description:
			"Ask to use one of the user's devices or another bot's machine (by name from hosts_list). Say why. as: one of the device's accounts (default: its user's own; ask for root only when the task really needs it). When it's approved, your own SSH key is added there and host_run works. Only ask for what the task needs.",
		parameters: z.object({
			host: z.string().min(1),
			reason: z.string().min(1).max(500),
			as: z.string().optional().describe("Account on the device (default: its own)"),
		}),
		risk: "external",
		// Root on one of your own devices: always yours to say, whatever the approval mode.
		askFirst: async (args, ctx) =>
			(await rootAccount(ctx.agent.id, args.host, args.as)) ? "A bot wants root on one of your devices" : null,
		title: (a) => `Asked to use ${a.host}${a.as ? ` as ${a.as}` : ""}`,
		async execute(args, ctx) {
			try {
				const granted = await grantAccess(
					ctx.agent.id,
					args.host,
					MODE_WORD[ctx.approvalMode] ?? ctx.approvalMode,
					args.reason,
					args.as,
				);
				return {
					access: true,
					host: granted.name,
					as: granted.account,
					note: "Your key is installed there; use host_run.",
				};
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "host_run",
		category: "machines",
		description:
			"Run a shell command on one of the user's devices or another bot's machine you've been given access to (your own key; see hosts_list). as: which of the device's accounts (default: its own, or the one you were let into). On the user's real devices, only do what they asked and be careful, above all as root.",
		parameters: z.object({
			host: z.string().min(1),
			as: z.string().optional().describe("Account on the device"),
			command: z.string().min(1).max(20_000),
			cwd: z.string().optional(),
			timeout_seconds: z.number().int().min(1).max(1800).optional(),
		}),
		risk: "external",
		async riskFor(args, ctx) {
			// Another bot's devbox is the team's sandbox; the user's own devices are the real world.
			const t = await findReachable(ctx.agent.id, args.host).catch(() => null);
			return t?.kind === "machine" ? "write" : "external";
		},
		title: (a) => `Ran \`${a.command.slice(0, 60)}\` on ${a.host}${a.as ? ` as ${a.as}` : ""}`,
		async execute(args, ctx) {
			try {
				const r = await runAs(ctx.agent.id, args.host, args.command, {
					cwd: args.cwd,
					timeoutMs: (args.timeout_seconds ?? 120) * 1000,
					signal: ctx.signal,
					as: args.as,
				});
				const out = new TextDecoder().decode(r.stdout);
				return {
					host: r.name,
					as: r.account,
					exit_code: r.code,
					timed_out: r.timedOut || undefined,
					output: truncateMiddle(out, 20_000),
					stderr: r.stderr ? truncateMiddle(r.stderr, 6000) : undefined,
				};
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "host_grant",
		category: "machines",
		description:
			"As the primary bot: let a teammate use one of the user's devices or another bot's machine, when they ask you and it's clearly for what the user wants. Their own key is added there. Say no (just don't call this) when it's not needed.",
		parameters: z.object({
			agent: z.string().min(1).describe("The teammate's name"),
			host: z.string().min(1),
			as: z.string().optional().describe("Account on the device (default: its own)"),
			reason: z.string().min(1).max(500),
		}),
		risk: "write",
		available: (agent) => agent.isPrimary,
		askFirst: async (args, ctx) =>
			(await rootAccount(ctx.agent.id, args.host, args.as))
				? "Root on one of your devices, for a teammate"
				: null,
		title: (a) => `Let ${a.agent} use ${a.host}${a.as ? ` as ${a.as}` : ""}`,
		async execute(args, ctx) {
			const mate = (await listAgents()).find((a) => a.name.toLowerCase() === args.agent.trim().toLowerCase());
			if (!mate) throw new ToolError(`No teammate called ${args.agent}`);
			if (mate.id === ctx.agent.id) throw new ToolError("Use host_request_access for yourself");
			try {
				const g = await grantAccess(
					mate.id,
					args.host,
					`${ctx.agent.name} (primary bot)`,
					args.reason,
					args.as,
				);
				return { granted: true, to: mate.name, host: g.name, as: g.account };
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "host_revoke",
		category: "machines",
		description: "Take away access to a device: your own (when you're done), or, as the primary bot, a teammate's.",
		parameters: z.object({
			host: z.string().min(1),
			as: z.string().optional().describe("Just this account (default: every account)"),
			agent: z.string().optional().describe("A teammate (primary bot only)"),
		}),
		risk: "write",
		title: (a) => `Removed ${a.agent ? `${a.agent}'s ` : ""}access to ${a.host}`,
		async execute(args, ctx) {
			let id = ctx.agent.id;
			if (args.agent) {
				if (!ctx.agent.isPrimary) throw new ToolError("Only the primary bot can remove a teammate's access");
				const mate = (await listAgents()).find(
					(a) => a.name.toLowerCase() === args.agent?.trim().toLowerCase(),
				);
				if (!mate) throw new ToolError(`No teammate called ${args.agent}`);
				id = mate.id;
			}
			return { revoked: await revokeAccess(id, args.host, args.as) };
		},
	}),
];
