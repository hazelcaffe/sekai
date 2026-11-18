import {
	type Agent,
	AVATAR_COLORS,
	AVATAR_SHAPES,
	type Avatar,
	type AvatarColorName,
	GALLERY,
	messageText,
	randomAvatar,
	randomCharacter,
} from "@sekai/shared";
import { z } from "zod";
import { truncate } from "../../lib/text.ts";
import { createAgent, findAgent, listAgents, updateAgent } from "../../services/agents.ts";
import { getDirectConversation } from "../../services/conversations.ts";
import { createMessage } from "../../services/messages.ts";
import { defineTool, ToolError } from "./types.ts";

/** Agent-to-agent hops allowed from one message you send, so agents can't ping-pong forever. */
export const MAX_HANDOFF_DEPTH = 4;
/** How long agent_ask waits for a teammate's answer. */
const ASK_TIMEOUT_MS = 30 * 60_000;

const colorNames = Object.keys(AVATAR_COLORS) as [AvatarColorName, ...AvatarColorName[]];
const galleryIds = GALLERY.map((g) => g.id) as [string, ...string[]];

/** A character icon when one is named (or nothing is said about the look); a drawn character for a shape or color. */
export function avatarFor(args: { name: string; character?: string; shape?: string; color?: string }): Avatar {
	const icon = args.character ? GALLERY.find((g) => g.id === args.character) : undefined;
	if (icon) return { kind: "gallery", id: icon.id, color: icon.color.toLowerCase() };
	if (!args.shape && !args.color) return randomAvatar(args.name);
	const base = randomCharacter(args.name);
	return {
		...base,
		shape: (AVATAR_SHAPES as readonly string[]).includes(args.shape ?? "")
			? (args.shape as typeof base.shape)
			: base.shape,
		color: args.color && args.color in AVATAR_COLORS ? AVATAR_COLORS[args.color as AvatarColorName] : base.color,
	};
}

export const agentTools = [
	defineTool({
		name: "agent_list",
		category: "agents",
		description: "List the other agents on the team with their jobs, so you know who to hand work to.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Checked the team",
		async execute(_args, ctx) {
			return (await listAgents()).map((a) => ({
				name: a.name,
				label: a.label,
				job: truncate(a.job, 400),
				status: a.status,
				primary: a.isPrimary,
				you: a.id === ctx.agent.id,
			}));
		},
	}),
	defineTool({
		name: "agent_message",
		category: "agents",
		description:
			"Hand off work or ask another agent something. The message lands in that agent's own chat and it replies there asynchronously (it can message you back). Make the request complete and self-contained: goal, inputs, deadline, where to report.",
		parameters: z.object({
			to: z.string().describe("Agent name"),
			message: z.string().min(1).max(20_000),
		}),
		risk: "external",
		title: (a) => `Messaged ${a.to.replace(/^@/, "")}`,
		async execute(args, ctx) {
			const target = await findAgent(args.to);
			if (!target) throw new ToolError(`No agent named "${args.to}". Use agent_list to see the team.`);
			if (target.id === ctx.agent.id) throw new ToolError("You can't message yourself.");
			if (target.status === "paused") throw new ToolError(`${target.name} is paused and won't respond.`);
			if (ctx.depth >= MAX_HANDOFF_DEPTH) {
				throw new ToolError("Handoff limit reached for this request. Report back to the user instead.");
			}
			const conversation = await getDirectConversation(target.id);
			const message = await createMessage({
				conversationId: conversation.id,
				sender: "agent",
				agentId: ctx.agent.id,
				parts: [{ type: "text", text: args.message }],
				meta: { trigger: "handoff", fromAgentId: ctx.agent.id },
			});
			const { enqueueRun } = await import("../runtime.ts");
			await enqueueRun({
				agentId: target.id,
				conversationId: conversation.id,
				trigger: "handoff",
				depth: ctx.depth + 1,
				sourceMessageId: message.id,
			});
			return { delivered: true, to: target.name, note: `${target.name} will reply in its own chat.` };
		},
	}),
	defineTool({
		name: "agent_ask",
		category: "agents",
		description:
			"Ask another agent something and wait for its answer (it uses its own memory, skills and tools). Use it when a teammate owns the knowledge or the work. The exchange is kept in a team chat the user can read. Ask one clear, self-contained question.",
		parameters: z.object({
			to: z.string().describe("Agent name"),
			question: z.string().min(1).max(20_000),
		}),
		risk: "write",
		title: (a) => `Asked ${a.to.replace(/^@/, "")}`,
		async execute(args, ctx) {
			const target = await findAgent(args.to);
			if (!target) throw new ToolError(`No agent named "${args.to}". Use agent_list to see the team.`);
			if (target.id === ctx.agent.id) throw new ToolError("You can't ask yourself.");
			if (target.status === "paused") throw new ToolError(`${target.name} is paused and can't answer.`);
			if (ctx.askChain.includes(target.id)) {
				throw new ToolError(
					`${target.name} is already waiting on your answer. Answer them directly instead of asking back.`,
				);
			}
			if (ctx.depth >= MAX_HANDOFF_DEPTH) {
				throw new ToolError("Too many agents are already involved in this request. Answer with what you have.");
			}
			const { getTeamThread } = await import("../../services/conversations.ts");
			const { enqueueRun, cancelRun, waitForRun } = await import("../runtime.ts");
			const { getMessage } = await import("../../services/messages.ts");
			const thread = await getTeamThread(ctx.agent.id, target.id);
			// Asking from inside that very thread would queue their answer behind this reply, which waits for it.
			if (thread.id === ctx.conversation.id) {
				throw new ToolError(
					`You're already in your thread with ${target.name}: ask them in your reply and mention @${target.name}.`,
				);
			}
			const question = await createMessage({
				conversationId: thread.id,
				sender: "agent",
				agentId: ctx.agent.id,
				parts: [{ type: "text", text: args.question }],
				meta: { trigger: "ask", fromAgentId: ctx.agent.id },
			});
			const run = await enqueueRun({
				agentId: target.id,
				conversationId: thread.id,
				trigger: "ask",
				depth: ctx.depth + 1,
				sourceMessageId: question.id,
				askChain: [...ctx.askChain, ctx.agent.id],
			});
			const onAbort = () => void cancelRun(run.id);
			ctx.signal.addEventListener("abort", onAbort, { once: true });
			try {
				// Never wait forever (two bots asking each other across threads would otherwise hang both chats).
				const done = await Promise.race([
					waitForRun(run.id),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), ASK_TIMEOUT_MS)),
				]);
				if (done === null) {
					void cancelRun(run.id);
					throw new ToolError(`${target.name} didn't answer within ${ASK_TIMEOUT_MS / 60_000} minutes.`);
				}
				if (done?.status !== "done" || !done.messageId) {
					throw new ToolError(
						`${target.name} couldn't answer (${done?.error ?? done?.status ?? "no reply"}).`,
					);
				}
				const reply = await getMessage(done.messageId);
				const text = reply ? messageText(reply) : "";
				return text ? `${target.name} answered:\n\n${text}` : `${target.name} replied without text.`;
			} finally {
				ctx.signal.removeEventListener("abort", onAbort);
			}
		},
	}),
	defineTool({
		name: "team_chat_start",
		category: "agents",
		description:
			"Start a group chat with other agents (the user is in it too) to work something out together, and post your kickoff message. In the kickoff, @mention who owns which step; mentioned agents reply and can @mention each other. Use for multi-agent work that benefits from discussion; for a single question use agent_ask.",
		parameters: z.object({
			title: z.string().min(1).max(120),
			members: z.array(z.string()).min(1).max(6).describe("Agent names to invite (you're added automatically)"),
			purpose: z.string().max(2000).optional(),
			kickoff: z.string().min(1).max(20_000).describe("Your first message; @mention owners"),
		}),
		risk: "external",
		title: (a) => `Started team chat “${a.title}”`,
		async execute(args, ctx) {
			const members: Agent[] = [];
			for (const name of args.members) {
				const a = await findAgent(name);
				if (!a) throw new ToolError(`No agent named "${name}".`);
				if (a.id !== ctx.agent.id) members.push(a);
			}
			if (members.length === 0) throw new ToolError("Invite at least one other agent.");
			if (ctx.depth >= MAX_HANDOFF_DEPTH) throw new ToolError("Too many agent hops for this request.");
			const { createConversation } = await import("../../services/conversations.ts");
			const { startGroupTurn } = await import("../runtime.ts");
			const conversation = await createConversation({
				kind: "group",
				memberIds: [ctx.agent.id, ...members.map((m) => m.id)],
				title: args.title,
				settings: { purpose: args.purpose ?? "", createdByAgentId: ctx.agent.id },
			});
			const kickoff = await createMessage({
				conversationId: conversation.id,
				sender: "agent",
				agentId: ctx.agent.id,
				parts: [{ type: "text", text: args.kickoff }],
				meta: { trigger: "group", fromAgentId: ctx.agent.id },
			});
			const responders = await startGroupTurn(conversation, kickoff, [ctx.agent, ...members], {
				exclude: ctx.agent.id,
				depth: ctx.depth + 1,
			});
			const names = responders.map((id) => members.find((m) => m.id === id)?.name ?? id);
			return {
				started: true,
				conversation: conversation.title,
				replying: names,
				note: "The discussion continues in that group chat; the user can follow it there.",
			};
		},
	}),
	defineTool({
		name: "agent_create",
		category: "agents",
		description:
			"Create a new focused agent when a recurring job deserves its own owner. Give it one clear job, a short label and a personality. Ask the user before creating several.",
		parameters: z.object({
			name: z.string().min(1).max(60),
			label: z.string().max(80).optional(),
			job: z.string().max(8000),
			personality: z.string().max(8000).optional(),
			instructions: z.string().max(20_000).optional(),
			character: z
				.enum(galleryIds)
				.optional()
				.describe("A character icon for its avatar (Colorful Stage), e.g. vs-miku, ln-ichika, n25-kanade"),
			shape: z.enum(AVATAR_SHAPES).optional().describe("Or a drawn avatar: its shape"),
			color: z.enum(colorNames).optional().describe("Or a drawn avatar: its color"),
		}),
		risk: "external",
		title: (a) => `Created agent ${a.name}`,
		async execute(args, ctx) {
			if (await findAgent(args.name)) throw new ToolError(`An agent named "${args.name}" already exists.`);
			const avatar = avatarFor(args);
			const agent = await createAgent({
				name: args.name,
				label: args.label ?? "",
				job: args.job,
				personality: args.personality ?? "",
				instructions: args.instructions ?? "",
				avatar,
				models: ctx.agent.models,
				isPrimary: false,
			});
			return { created: true, name: agent.name, id: agent.id };
		},
	}),
	defineTool({
		name: "agent_update_self",
		category: "agents",
		description:
			"Update your own profile when the user changes your role: label, job, personality or standing instructions. Pass only the fields that change; they replace the old text.",
		parameters: z.object({
			name: z.string().min(1).max(60).optional(),
			label: z.string().max(80).optional(),
			job: z.string().max(8000).optional(),
			personality: z.string().max(8000).optional(),
			instructions: z.string().max(20_000).optional(),
		}),
		risk: "external",
		title: () => "Updated own profile",
		async execute(args, ctx) {
			const agent = await updateAgent(ctx.agent.id, args);
			return { updated: Object.keys(args), name: agent.name, label: agent.label };
		},
	}),
];
