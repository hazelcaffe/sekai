import {
	type Agent,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalModeSetting,
	type Channel,
	type ChannelBinding,
	type Message,
	type ModelInfo,
	THINKING_LEVELS,
	type ThinkingSetting,
} from "@sekai/shared";
import { resolveApprovalMode } from "../agent/permissions.ts";
import { modelName } from "../agent/strategies.ts";
import { errorMessage } from "../lib/errors.ts";
import { truncate } from "../lib/text.ts";
import { formatShort, parseWhen } from "../lib/time.ts";
import { listModels } from "../llm/catalog.ts";
import { providerModels } from "../providers/store.ts";
import { describeSchedule } from "../scheduler/schedule.ts";
import { listAgents, updateAgent } from "../services/agents.ts";
import { getConversation, updateConversation } from "../services/conversations.ts";
import { createMemory, deleteMemory, getMemory, getNote, listMemories, listNotes } from "../services/memories.ts";
import { getMessage, listMessages } from "../services/messages.ts";
import { createRoutine, listRoutines, updateRoutine } from "../services/routines.ts";
import { effectiveTimezone, getSettings } from "../services/settings.ts";
import { agentBots, sekaiMessageId } from "./state.ts";
import type { ApprovalChoice, ChannelAdapter, ChatRef, CommandOptions, CommandSpec, Reply } from "./types.ts";

const THINKING_CHOICES = ["default", ...THINKING_LEVELS].map((t) => ({ name: t, value: t }));
const MODE_CHOICES = [
	{ name: "Same as the bot", value: "inherit" },
	...APPROVAL_MODES.map((m) => ({ name: APPROVAL_MODE_INFO[m].title, value: m })),
];

/** Every command, as slash commands and as typed /commands (so other bots and old clients can use them). */
export const COMMANDS: CommandSpec[] = [
	{ name: "help", description: "What I can do here" },
	{ name: "new", description: "Start a fresh chat here (I keep my memory)", public: true },
	{ name: "stop", description: "Stop what I'm doing", public: true },
	{ name: "status", description: "How I'm set up in this chat" },
	{
		name: "join",
		description: "Join your voice channel and talk",
		public: true,
		options: [{ name: "channel", description: "A voice channel (default: the one you're in)", type: "string" }],
	},
	{ name: "leave", description: "Leave the voice channel", public: true },
	{
		name: "retry",
		description: "Answer my last reply again",
		options: [
			{ name: "model", description: "Use another model for this answer", type: "string", autocomplete: true },
			{
				name: "erase",
				description: "Erase the old answer instead of keeping it as a previous version",
				type: "boolean",
			},
		],
	},
	{
		name: "model",
		description: "See or change my model",
		options: [
			{ name: "model", description: "The model I use from now on", type: "string", autocomplete: true },
			{ name: "thinking", description: "How hard I think", type: "string", choices: THINKING_CHOICES },
		],
	},
	{
		name: "mode",
		description: "What I may do without asking, in this chat",
		options: [{ name: "mode", description: "Approval mode", type: "string", choices: MODE_CHOICES }],
	},
	{
		name: "memory",
		description: "What I remember",
		subcommands: [
			{
				name: "list",
				description: "Show what I remember",
				options: [{ name: "search", description: "Only memories containing this", type: "string" }],
			},
			{
				name: "add",
				description: "Tell me something to remember",
				options: [{ name: "text", description: "What to remember", type: "string", required: true }],
			},
			{
				name: "forget",
				description: "Make me forget something",
				options: [
					{ name: "memory", description: "Which memory", type: "string", required: true, autocomplete: true },
				],
			},
		],
	},
	{
		name: "notes",
		description: "My notes",
		options: [{ name: "search", description: "Only notes containing this", type: "string" }],
	},
	{
		name: "routines",
		description: "My routines and reminders",
		subcommands: [
			{ name: "list", description: "Show my routines" },
			...(["pause", "resume", "run"] as const).map((name) => ({
				name,
				description:
					name === "run" ? "Run a routine now" : `${name === "pause" ? "Pause" : "Resume"} a routine`,
				options: [
					{
						name: "routine",
						description: "Which routine",
						type: "string" as const,
						required: true,
						autocomplete: true,
					},
				],
			})),
		],
	},
	{
		name: "remind",
		description: "Set a reminder",
		public: true,
		options: [
			{
				name: "when",
				description: "in 20 minutes, in 2 hours, 2026-12-01 09:00, tomorrow at 9…",
				type: "string",
				required: true,
			},
			{ name: "what", description: "What to remind you of", type: "string", required: true },
		],
	},
	{ name: "approvals", description: "Actions waiting for your OK" },
	{
		name: "approve",
		description: "Approve a waiting action by its code",
		options: [{ name: "code", description: "The code on the request", type: "string", required: true }],
	},
	{
		name: "deny",
		description: "Deny a waiting action by its code",
		options: [{ name: "code", description: "The code on the request", type: "string", required: true }],
	},
	{ name: "team", description: "The other bots" },
	{
		name: "group",
		description: "Make this channel a group chat with other bots",
		subcommands: [
			{
				name: "link",
				description: "Link this channel to a group chat with other bots",
				options: [{ name: "bots", description: "Their names, e.g. Echo Pip", type: "string" }],
			},
			{ name: "unlink", description: "Go back to separate chats per bot" },
			{ name: "show", description: "Who's in this channel's group chat" },
		],
	},
	{
		name: "trust",
		description: "Let someone talk to me (owner only)",
		options: [
			{
				name: "who",
				description: "@someone, or leave empty with everyone:on",
				type: "string",
				autocomplete: true,
			},
			{
				name: "remove",
				description: "untrust them instead",
				type: "string",
				choices: [
					{ name: "trust", value: "off" },
					{ name: "untrust", value: "on" },
				],
			},
			{
				name: "everyone",
				description: "in a group chat: everyone in it",
				type: "string",
				choices: [
					{ name: "no", value: "off" },
					{ name: "yes", value: "on" },
				],
			},
		],
	},
	{
		name: "listen",
		description: "Answer every message here, not only mentions",
		options: [
			{
				name: "state",
				description: "on or off",
				type: "string",
				choices: [
					{ name: "on", value: "on" },
					{ name: "off", value: "off" },
				],
			},
		],
	},
	{ name: "profile", description: "Who I am" },
	{ name: "context", description: "What I see on my next turn" },
	{ name: "compact", description: "Summarize older messages to free up room" },
	{ name: "Retry", description: "", kind: "message" },
	{ name: "Retry with another model", description: "", kind: "message" },
	{ name: "Erase and retry", description: "", kind: "message" },
];

/** What a command can reach. Hooks are the manager's, so commands stay free of platform and routing code. */
export interface CommandEnv {
	channel: Channel;
	agent: Agent;
	adapter: ChannelAdapter;
	chat: ChatRef;
	/** This chat's binding, if it has one already. */
	existing: ChannelBinding | null;
	/** This chat's binding, created on first use. */
	binding(): Promise<ChannelBinding>;
	targetMessageId: string | null;
	/** Whether this bot can read messages that don't mention it. */
	readsAll: boolean;
	hooks: {
		newChat(binding: ChannelBinding): Promise<void>;
		linkGroup(agentIds: string[]): Promise<string>;
		unlinkGroup(): Promise<string>;
		setListen(on: boolean): Promise<string>;
		resendApprovals(binding: ChannelBinding): Promise<number>;
		decideApproval(code: string, choice: ApprovalChoice): Promise<string>;
		/** Joins a voice channel (the one you're in, or by name) and starts a call there. */
		joinVoice(where: string | null): Promise<string>;
		leaveVoice(): Promise<string>;
		/** Lets user ids talk to the account (add), or stops them (remove). Returns a confirmation line. */
		trust(ids: string[], remove: boolean): Promise<string>;
		/** Posts text into this chat's conversation as you, and has the agent answer it. */
		say(text: string): Promise<void>;
	};
}

/** /help: the commands, plus what this platform does differently (voice only where there is any). */
function helpText(adapter: CommandEnv["adapter"]): string {
	return [
		adapter.help?.intro ??
			"**Talk to me** by DM, or mention me in a server. Reply to one of my messages to continue that thread.",
		"**Chat:** /new · /stop · /retry · /compact · /context",
		...(adapter.voice ? ['**Voice:** /join (or just say "join vc") · /leave'] : []),
		"**Me:** /status · /model · /mode · /profile",
		"**Memory:** /memory list · /memory add · /memory forget · /notes",
		"**Plans:** /remind · /routines · /approvals",
		"**Together:** /team · /group link · /group unlink · /listen · /trust",
		...(adapter.help?.tips ? [adapter.help.tips] : []),
	].join("\n");
}

/** People in a /trust: Discord's numeric ids or Slack's member ids, as typed or from mentions. */
const PERSON_ID = /\b(?:\d{15,25}|[UW][A-Z0-9]{6,})\b/g;

// ---------------------------------------------------------------- helpers

function opt(options: CommandOptions, name: string): string {
	const v = options[name];
	return v === undefined || v === null ? "" : String(v).trim();
}

function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

async function catalog(): Promise<ModelInfo[]> {
	const gateway = await listModels().catch(() => [] as ModelInfo[]);
	return [...providerModels(), ...gateway];
}

/** A model by id, or by its display name ("Sonnet 5.5"). */
async function findModel(ref: string): Promise<ModelInfo | null> {
	const all = await catalog();
	const needle = ref.trim().toLowerCase();
	return (
		all.find((m) => m.id.toLowerCase() === needle) ??
		all.find((m) => m.name.toLowerCase() === needle) ??
		all.find((m) => m.name.toLowerCase().replace(/\s*\(.*\)$/, "") === needle) ??
		null
	);
}

/** A short list of models for menus (25 at most): yours first, then the newest few from each provider. */
async function modelMenu(current: string | null): Promise<{ value: string; label: string; description?: string }[]> {
	const all = await catalog();
	const picked: ModelInfo[] = [];
	const add = (m: ModelInfo | undefined) => {
		if (m && !picked.some((p) => p.id === m.id) && picked.length < 25) picked.push(m);
	};
	add(all.find((m) => m.id === current));
	for (const m of all.filter((x) => x.byos)) add(m);
	const perProvider = new Map<string, number>();
	for (const m of all) {
		const n = perProvider.get(m.provider) ?? 0;
		const cap = ["anthropic", "openai", "google", "xai"].includes(m.provider) ? 4 : 1;
		if (n < cap) {
			add(m);
			perProvider.set(m.provider, n + 1);
		}
	}
	return picked.map((m) => ({
		value: m.id,
		label: truncate(m.name, 100),
		description: m.byos ? `Your ${m.byos.providerTitle} subscription` : m.provider,
	}));
}

/** The reply a retry is about: the message it was used on, or this agent's last answer in this chat. */
async function retryTarget(env: CommandEnv): Promise<Message | string> {
	const binding = env.existing;
	if (env.targetMessageId) {
		const id = await sekaiMessageId(env.chat.chatId, env.targetMessageId);
		const m = id ? await getMessage(id) : null;
		if (!m) return "I don't know that message. Retry works on my replies here.";
		if (m.sender === "agent") return m;
		// Used on your message: retry the answer to it.
		const history = await listMessages(m.conversationId);
		const after = history.slice(history.findIndex((x) => x.id === m.id) + 1);
		const answer = after.find((x) => x.sender === "agent");
		return answer ?? "Nobody has answered that message yet.";
	}
	if (!binding) return "There's nothing to retry here yet.";
	const history = await listMessages(binding.conversationId, { limit: 50 });
	const mine = [...history].reverse().find((m) => m.sender === "agent" && m.agentId === env.agent.id);
	return mine ?? "There's nothing to retry here yet.";
}

async function doRetry(env: CommandEnv, model: string, erase: boolean): Promise<Reply> {
	const target = await retryTarget(env);
	if (typeof target === "string") return { text: target };
	if (target.status === "streaming") return { text: "I'm still writing that one. Use /stop first." };
	let modelId: string | null = null;
	if (model) {
		const found = await findModel(model);
		if (!found) return { text: `I don't know the model "${model}". Try /model to see some.` };
		modelId = found.id;
	}
	const { retryMessage } = await import("../agent/runtime.ts");
	await retryMessage(target.id, {
		wipe: erase,
		model: modelId ? { model: modelId, thinking: "default" } : null,
	});
	const how = erase ? "Erasing that answer and trying again" : "Trying again";
	return { text: `${how}${modelId ? ` with ${await modelName(modelId)}` : ""}…`, react: erase ? "🧽" : "🔁" };
}

// ---------------------------------------------------------------- commands

export async function runCommand(env: CommandEnv, name: string, sub: string | null, o: CommandOptions): Promise<Reply> {
	const { agent } = env;
	try {
		switch (name) {
			case "help":
			case "start":
				return { text: `${name === "start" ? `Hi, I'm ${agent.name}.\n` : ""}${helpText(env.adapter)}` };

			case "new": {
				await env.hooks.newChat(await env.binding());
				return { text: "Started a fresh chat. I still remember everything I've saved.", react: "🆕" };
			}

			case "stop": {
				const b = env.existing;
				const { cancelConversationRuns } = await import("../agent/runtime.ts");
				const n = b ? await cancelConversationRuns(b.conversationId) : 0;
				return { text: n ? "Stopped." : "Nothing to stop.", react: n ? "⏹️" : undefined };
			}

			case "status":
				return { text: await statusText(env) };

			case "join":
				return { text: await env.hooks.joinVoice(opt(o, "channel") || null) };
			case "leave":
				return { text: await env.hooks.leaveVoice() };

			case "retry":
				return doRetry(env, opt(o, "model"), o.erase === true);
			case "Retry":
				return doRetry(env, "", false);
			case "Erase and retry":
				return doRetry(env, "", true);
			case "Retry with another model": {
				const target = await retryTarget(env);
				if (typeof target === "string") return { text: target };
				return {
					text: "Which model should answer instead? The current answer stays as a previous version.",
					select: {
						id: `rm:${target.id}`,
						placeholder: "Pick a model",
						options: await modelMenu(target.model),
					},
				};
			}

			case "model":
				return setModel(env, opt(o, "model"), opt(o, "thinking"));

			case "mode":
				return setMode(env, opt(o, "mode"));

			case "memory":
				return memory(env, sub ?? "list", o);

			case "notes": {
				const q = opt(o, "search").toLowerCase();
				const notes = (await listNotes(agent.id)).filter(
					(n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
				);
				if (notes.length === 0)
					return { text: q ? `No notes about "${q}".` : "I haven't written any notes yet." };
				return {
					text: `**${agent.name}'s notes**\n${notes
						.slice(0, 20)
						.map((n) => `• ${n.pinned ? "📌 " : ""}${truncate(n.title, 80)}`)
						.join("\n")}`,
					select: {
						id: "note",
						placeholder: "Open a note",
						options: notes.slice(0, 25).map((n) => ({ value: n.id, label: truncate(n.title, 100) })),
					},
				};
			}

			case "routines":
				return routines(env, sub ?? "list", opt(o, "routine"));

			case "remind":
				return remind(env, opt(o, "when"), opt(o, "what"));

			case "approvals": {
				const n = await env.hooks.resendApprovals(await env.binding());
				return {
					text: n
						? `${n} waiting. I posted ${n === 1 ? "it" : "them"} again here.`
						: "Nothing is waiting for you.",
				};
			}

			case "approve":
			case "deny":
				return {
					text: await env.hooks.decideApproval(
						opt(o, "code").toUpperCase(),
						name === "approve" ? "approve" : "deny",
					),
				};

			case "team":
				return { text: await teamText(env) };

			case "trust": {
				// Owner only; the manager already refuses others (I only take commands from my owner).
				const remove = opt(o, "remove") === "on";
				const everyone = opt(o, "everyone") === "on";
				const who = opt(o, "who");
				const ids = new Set(who.match(PERSON_ID) ?? []);
				if (everyone) {
					if (!env.chat.isGroup)
						return { text: "Trust everyone works in a group chat. Elsewhere, /trust @someone." };
					if (env.adapter.groupMembers) {
						for (const id of await env.adapter.groupMembers(env.chat.chatId).catch(() => [] as string[]))
							ids.add(id);
					}
					for (const id of ids) if (id === env.agent.id) ids.delete(id);
					if (!ids.size) return { text: "I couldn't see who's in here. Try /trust @someone." };
					return { text: await env.hooks.trust([...ids], false) };
				}
				if (!ids.size) return { text: "Who? /trust @someone (or /trust everyone:on in a group chat)." };
				return { text: await env.hooks.trust([...ids], remove) };
			}

			case "group":
				return group(env, sub ?? "show", opt(o, "bots"));

			case "listen": {
				const state = opt(o, "state").toLowerCase();
				if (!state) {
					const on = env.existing?.listen ?? false;
					return {
						text: on
							? "I answer every message here. `/listen off` makes me answer only when mentioned."
							: "I answer here when mentioned. `/listen on` makes me answer every message.",
					};
				}
				return { text: await env.hooks.setListen(state === "on") };
			}

			case "profile":
				return {
					text: [
						`**${agent.name}**${agent.label ? ` · ${agent.label}` : ""}`,
						agent.job ? `*${truncate(agent.job, 400)}*` : null,
						agent.personality ? `\n${truncate(agent.personality, 900)}` : null,
						`\n${env.adapter.subtext(`${await modelName(agent.models.primary.model)}${agent.isPrimary ? " · your primary bot" : ""}`)}`,
					]
						.filter(Boolean)
						.join("\n"),
				};

			case "context":
				return { text: await contextText(env) };

			case "compact": {
				const b = env.existing;
				if (!b) return { text: "There's nothing to summarize here yet." };
				const { compactConversation } = await import("../agent/compaction.ts");
				const c = await compactConversation(b.conversationId, { agent });
				return {
					text: c.summary
						? "Summarized the older messages. I still have the gist, with more room for what's next."
						: "There wasn't enough to summarize yet.",
					react: "🗜️",
				};
			}

			default:
				return { text: `I don't know /${name}. Try /help.` };
		}
	} catch (err) {
		return { text: `⚠️ ${truncate(errorMessage(err), 500)}` };
	}
}

async function statusText(env: CommandEnv): Promise<string> {
	const { agent } = env;
	const b = env.existing;
	const conversation = b ? await getConversation(b.conversationId) : null;
	const settings = await getSettings();
	const mode = resolveApprovalMode(settings, agent, conversation);
	const where =
		conversation?.settings.approvalMode && conversation.settings.approvalMode !== "inherit"
			? "for this chat"
			: agent.capabilities.approvalMode !== "inherit"
				? `for ${agent.name}`
				: "for every bot";
	const thinking = agent.models.primary.thinking;
	const lines = [
		`**${agent.name}**${agent.label ? ` · ${agent.label}` : ""}${agent.status !== "active" ? ` · ${agent.status}` : ""}`,
		`Model: ${await modelName(agent.models.primary.model)}${thinking !== "default" ? ` (thinking: ${thinking})` : ""}`,
		`Approvals: ${APPROVAL_MODE_INFO[mode].title}, ${where}`,
	];
	if (conversation) {
		if (conversation.kind === "group") {
			const all = await listAgents();
			const names = all.filter((a) => conversation.memberIds.includes(a.id)).map((a) => a.name);
			lines.push(`Chat: group with ${names.join(", ")}`);
		} else lines.push(`Chat: ${conversation.title}`);
	} else lines.push("Chat: none yet (say something to start one)");
	if (env.chat.isGroup) {
		lines.push(
			b?.listen ? "Answering every message here" : "Answering here when mentioned",
			env.readsAll
				? env.adapter.subtext("I can read messages that don't mention me.")
				: env.adapter.subtext("I only see messages that mention me (Message Content Intent is off)."),
		);
	}
	return lines.join("\n");
}

async function setModel(env: CommandEnv, model: string, thinking: string): Promise<Reply> {
	const { agent } = env;
	const current = agent.models.primary;
	if (!model && !thinking) {
		return {
			text: `I'm using **${await modelName(current.model)}**${current.thinking !== "default" ? ` (thinking: ${current.thinking})` : ""}. Pick another for everything I do:`,
			select: {
				id: "model",
				placeholder: "Pick a model",
				options: (await modelMenu(current.model)).map((m) => ({ ...m, selected: m.value === current.model })),
			},
		};
	}
	const found = model ? await findModel(model) : null;
	if (model && !found) return { text: `I don't know the model "${model}". Use /model to pick from a list.` };
	const id = found?.id ?? current.model;
	const level = (thinking || (found ? "default" : current.thinking)) as ThinkingSetting;
	if (level !== "default" && found && !found.thinkingLevels.includes(level as never) && found.thinkingLevels.length) {
		return {
			text: `${found.name} doesn't have a "${level}" thinking level. It has: ${found.thinkingLevels.join(", ")}.`,
		};
	}
	await updateAgent(agent.id, { models: { ...agent.models, primary: { model: id, thinking: level } } });
	return {
		text: `Switched to **${await modelName(id)}**${level !== "default" ? ` (thinking: ${level})` : ""} for everything I do.`,
		react: "✅",
	};
}

async function setMode(env: CommandEnv, mode: string): Promise<Reply> {
	const binding = await env.binding();
	const conversation = await getConversation(binding.conversationId);
	const current = (conversation?.settings.approvalMode ?? "inherit") as ApprovalModeSetting;
	if (!mode) {
		const settings = await getSettings();
		const effective = resolveApprovalMode(settings, env.agent, conversation);
		return {
			text: `Approvals here: **${APPROVAL_MODE_INFO[effective].title}**${current === "inherit" ? " (same as the bot)" : ""}.\n${env.adapter.subtext(APPROVAL_MODE_INFO[effective].description)}`,
			select: {
				id: "mode",
				placeholder: "Change for this chat",
				options: MODE_CHOICES.map((c) => ({
					value: c.value,
					label: c.name,
					description:
						c.value === "inherit"
							? undefined
							: truncate(
									APPROVAL_MODE_INFO[c.value as never as keyof typeof APPROVAL_MODE_INFO].description,
									100,
								),
					selected: c.value === current,
				})),
			},
		};
	}
	const value = MODE_CHOICES.find((c) => c.value === mode || c.name.toLowerCase() === mode.toLowerCase())?.value;
	if (!value) return { text: `Modes: ${MODE_CHOICES.map((c) => c.value).join(", ")}.` };
	await updateConversation(binding.conversationId, { settings: { approvalMode: value as ApprovalModeSetting } });
	return {
		text:
			value === "inherit"
				? "This chat uses the bot's approval mode again."
				: `Approvals in this chat: **${APPROVAL_MODE_INFO[value as keyof typeof APPROVAL_MODE_INFO].title}**.`,
		react: "✅",
	};
}

const KIND_ICON: Record<string, string> = {
	about_user: "👤",
	preference: "❤️",
	rule: "📏",
	fact: "📎",
	work_log: "🗂️",
};

async function memory(env: CommandEnv, sub: string, o: CommandOptions): Promise<Reply> {
	const { agent } = env;
	if (sub === "add") {
		const text = opt(o, "text");
		if (!text) return { text: "What should I remember? `/memory add I take my coffee black`" };
		await createMemory({ agentId: agent.id, kind: "fact", content: text }, "user");
		return { text: `Got it. I'll remember: ${truncate(text, 200)}`, react: "🧠" };
	}
	if (sub === "forget") {
		const ref = opt(o, "memory");
		const byId = ref ? await getMemory(ref) : null;
		const matches = byId
			? [byId]
			: ref
				? await listMemories({ agentId: agent.id, includeShared: true, query: ref, limit: 10 })
				: [];
		const target = matches.length === 1 ? matches[0] : null;
		if (!target) {
			return {
				text: matches.length
					? `Several memories match "${ref}". Which one?`
					: `I don't remember anything about "${ref}".`,
				select: matches.length ? forgetMenu(matches) : undefined,
			};
		}
		if (target.agentId !== null && target.agentId !== agent.id) return { text: "That isn't one of my memories." };
		await deleteMemory(target.id);
		return { text: `Forgotten: ${truncate(target.content, 200)}`, react: "🗑️" };
	}
	const q = opt(o, "search");
	const all = await listMemories({ agentId: agent.id, includeShared: true, query: q || undefined, limit: 40 });
	if (all.length === 0) return { text: q ? `Nothing about "${q}".` : "I haven't saved any memories yet." };
	const lines = all
		.slice(0, 15)
		.map(
			(m) =>
				`${KIND_ICON[m.kind] ?? "•"} ${truncate(m.content.replace(/\s+/g, " "), 140)}${m.agentId ? "" : " *(shared)*"}`,
		);
	return {
		text: `**What ${agent.name} remembers**${all.length > 15 ? ` (15 of ${all.length})` : ""}\n${lines.join("\n")}`,
		select: forgetMenu(all),
	};
}

function forgetMenu(memories: { id: string; content: string }[]) {
	return {
		id: "mf",
		placeholder: "Forget one…",
		options: memories
			.slice(0, 25)
			.map((m) => ({ value: m.id, label: truncate(m.content.replace(/\s+/g, " "), 100) })),
	};
}

async function routines(env: CommandEnv, sub: string, ref: string): Promise<Reply> {
	const all = await listRoutines({ agentId: env.agent.id });
	const tz = await effectiveTimezone();
	if (sub === "list") {
		if (all.length === 0) return { text: "No routines or reminders yet. Ask me to set one up, or use /remind." };
		return {
			text: `**${env.agent.name}'s routines**\n${all
				.slice(0, 20)
				.map(
					(r) =>
						`${r.enabled ? "•" : "⏸️"} **${truncate(r.name, 60)}**: ${describeSchedule(r.schedule, r.timezone === "auto" ? tz : r.timezone)}${r.enabled && r.nextRunAt ? ` · next ${formatShort(r.nextRunAt, tz)}` : ""}`,
				)
				.join("\n")}`,
		};
	}
	const needle = ref.toLowerCase();
	const r = all.find((x) => x.id === ref) ?? all.find((x) => x.name.toLowerCase().includes(needle));
	if (!r) return { text: `I don't have a routine called "${ref}".` };
	if (sub === "run") {
		const { dispatchRoutine } = await import("../scheduler/runner.ts");
		void dispatchRoutine(r, { test: true });
		return { text: `Running **${r.name}** now.`, react: "▶️" };
	}
	await updateRoutine(r.id, { enabled: sub === "resume" });
	return { text: `${sub === "resume" ? "Resumed" : "Paused"} **${r.name}**.`, react: sub === "resume" ? "▶️" : "⏸️" };
}

/** "in 20 minutes take the pizza out" → when + what; also "2026-12-01 09:00 call mum". */
export function splitReminder(phrase: string): { when: string; what: string } | null {
	const rel = phrase.match(/^(in\s+\d+(?:\.\d+)?\s*[a-z]+)\s+(?:to\s+)?([\s\S]+)$/i);
	if (rel?.[1] && rel[2]) return { when: rel[1], what: rel[2].trim() };
	const iso = phrase.match(/^(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)\s+(?:to\s+)?([\s\S]+)$/);
	if (iso?.[1] && iso[2]) return { when: iso[1].replace(" ", "T"), what: iso[2].trim() };
	return null;
}

async function remind(env: CommandEnv, when: string, whatInput: string): Promise<Reply> {
	let what = whatInput;
	const tz = await effectiveTimezone();
	let at = when ? parseWhen(when, tz) : null;
	if (at === null) {
		// Typed as one phrase: "/remind in 20 minutes take the pizza out".
		const split = splitReminder(`${when} ${what}`.trim());
		if (split) {
			at = parseWhen(split.when, tz);
			what = split.what;
		}
	}
	if (!what) return { text: "What should I remind you of? `/remind in 20 minutes take the pizza out`" };
	if (at !== null && at > Date.now() - 30_000) {
		const binding = await env.binding();
		await createRoutine({
			agentId: env.agent.id,
			conversationId: binding.conversationId,
			name: truncate(what, 80),
			instruction: what,
			action: "notify",
			schedule: { type: "once", at },
			timezone: "auto",
		});
		return { text: `⏰ I'll remind you ${formatShort(at, tz)}: ${truncate(what, 200)}`, react: "⏰" };
	}
	// Times like "tomorrow at 9" or "every Monday": the agent works it out and confirms.
	await env.hooks.say(`Remind me ${when || "later"}: ${what}`);
	return { text: "Setting that up…", react: "⏰" };
}

async function teamText(env: CommandEnv): Promise<string> {
	const all = (await listAgents()).filter((a) => !a.hidden);
	const bots = new Map([...agentBots()].map(([botId, v]) => [v.agentId, botId]));
	const lines = all.map((a) => {
		const bot = bots.get(a.id);
		const who = bot && env.chat.isGroup ? env.adapter.mention(bot) : `**${a.name}**`;
		const tags = [
			a.id === env.agent.id ? "me" : null,
			a.isPrimary ? "primary" : null,
			a.status !== "active" ? a.status : null,
		]
			.filter(Boolean)
			.join(", ");
		const extra = [tags, bot ? null : "no bot here"].filter(Boolean).join(", ");
		return `• ${who}${a.label ? ` · ${a.label}` : ""}${extra ? ` *(${extra})*` : ""}`;
	});
	return `**The team**\n${lines.join("\n")}\n${env.adapter.subtext("/group link makes this channel a group chat with any of them.")}`;
}

async function group(env: CommandEnv, sub: string, bots: string): Promise<Reply> {
	if (!env.chat.isGroup) return { text: "Group chats work in server channels. Use /group link in one." };
	if (sub === "unlink") return { text: await env.hooks.unlinkGroup() };
	if (sub === "show") {
		const b = env.existing;
		const conversation = b ? await getConversation(b.conversationId) : null;
		if (conversation?.kind !== "group") {
			return { text: "This channel isn't a group chat. `/group link Echo Pip` makes it one." };
		}
		const all = await listAgents();
		const bot = new Map([...agentBots()].map(([botId, v]) => [v.agentId, botId]));
		const names = all
			.filter((a) => conversation.memberIds.includes(a.id))
			.map((a) => (bot.has(a.id) ? env.adapter.mention(bot.get(a.id) ?? "") : `**${a.name}**`));
		return { text: `This channel is a group chat with ${names.join(", ")}.` };
	}
	const others = (await listAgents()).filter((a) => a.id !== env.agent.id && !a.hidden);
	if (!bots.trim()) {
		if (others.length === 0) return { text: "There are no other bots yet. Make one in Sekai first." };
		return {
			text: "Who should be in this channel's group chat with me?",
			select: {
				id: "gl",
				placeholder: "Pick bots",
				min: 1,
				max: Math.min(7, others.length),
				options: others
					.slice(0, 25)
					.map((a) => ({ value: a.id, label: a.name, description: a.label || undefined })),
			},
		};
	}
	const names = bots
		.split(/[\s,]+/)
		.map((s) => s.replace(/^@/, "").trim().toLowerCase())
		.filter(Boolean);
	const chosen = others.filter((a) => names.includes(a.name.toLowerCase()));
	const unknown = names.filter(
		(n) => n !== env.agent.name.toLowerCase() && !chosen.some((a) => a.name.toLowerCase() === n),
	);
	if (unknown.length) return { text: `I don't know ${unknown.map((n) => `"${n}"`).join(", ")}. Try /team.` };
	if (chosen.length === 0) return { text: "Name at least one other bot, e.g. `/group link Echo`." };
	return { text: await env.hooks.linkGroup([env.agent.id, ...chosen.map((a) => a.id)]) };
}

async function contextText(env: CommandEnv): Promise<string> {
	const { buildAgentContext } = await import("../agent/context.ts");
	const ctx = await buildAgentContext(env.agent, env.existing?.conversationId);
	const pct = ctx.contextWindow ? Math.round((ctx.totalTokens / ctx.contextWindow) * 100) : 0;
	const sections = [...ctx.sections]
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, 8)
		.map((s) => `• ${s.title}: ${fmtTokens(s.tokens)}`);
	return [
		`**What ${env.agent.name} sees next turn**: ${fmtTokens(ctx.totalTokens)} of ${fmtTokens(ctx.contextWindow)} tokens (${pct}%) on ${await modelName(ctx.model)}`,
		...sections,
		`• History: ${ctx.history.messages} messages, ${fmtTokens(ctx.history.tokens)}${ctx.history.summarizedMessages ? ` (+ a summary of ${ctx.history.summarizedMessages} older)` : ""}`,
		`• Tools: ${ctx.tools.length}`,
		env.adapter.subtext("The Brain tab in Sekai shows all of it."),
	].join("\n");
}

// ---------------------------------------------------------------- buttons and menus

/** A button or menu was used. Returns what its message should show now (null leaves it as is). */
export async function runAction(env: CommandEnv, id: string, values: string[]): Promise<Reply | null> {
	const [kind, ...rest] = id.split(":");
	const value = values[0] ?? "";
	try {
		switch (kind) {
			case "ap": {
				const [code, choice] = rest;
				if (!code || !choice) return null;
				const result = await env.hooks.decideApproval(code, choice as ApprovalChoice);
				return { text: result };
			}
			case "rm": {
				const messageId = rest[0];
				const m = messageId ? await getMessage(messageId) : null;
				if (!m) return { text: "That reply no longer exists." };
				if (m.status === "streaming") return { text: "It's still being written. Use /stop first." };
				const { retryMessage } = await import("../agent/runtime.ts");
				await retryMessage(m.id, { model: { model: value, thinking: "default" } });
				return { text: `Trying again with ${await modelName(value)}…` };
			}
			case "model": {
				const r = await setModel(env, value, "");
				return { text: r.text };
			}
			case "mode": {
				const r = await setMode(env, value);
				return { text: r.text };
			}
			case "mf": {
				const m = await getMemory(value);
				if (!m) return { text: "Already forgotten." };
				if (m.agentId !== null && m.agentId !== env.agent.id) return { text: "That isn't one of my memories." };
				await deleteMemory(m.id);
				return { text: `Forgotten: ${truncate(m.content, 200)}` };
			}
			case "note": {
				const n = await getNote(value);
				if (!n || n.agentId !== env.agent.id) return { text: "That note is gone." };
				return { text: `**${n.title}**\n${truncate(n.content, 1700)}` };
			}
			case "gl":
				return { text: await env.hooks.linkGroup([env.agent.id, ...values.filter((v) => v !== env.agent.id)]) };
			default:
				return null;
		}
	} catch (err) {
		return { text: `⚠️ ${truncate(errorMessage(err), 500)}` };
	}
}

// ---------------------------------------------------------------- autocomplete

export async function autocomplete(
	env: Pick<CommandEnv, "agent">,
	option: string,
	value: string,
): Promise<{ name: string; value: string }[]> {
	const q = value.trim().toLowerCase();
	if (option === "model") {
		const all = await catalog();
		const hits = q
			? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
			: (await modelMenu(env.agent.models.primary.model))
					.map((m) => all.find((x) => x.id === m.value))
					.filter((m) => m !== undefined);
		return hits.slice(0, 25).map((m) => ({
			name: truncate(`${m.name} · ${m.byos ? m.byos.providerTitle : m.provider}`, 100),
			value: m.id.slice(0, 100),
		}));
	}
	if (option === "memory") {
		const all = await listMemories({ agentId: env.agent.id, query: q || undefined, limit: 25 });
		return all.map((m) => ({ name: truncate(m.content.replace(/\s+/g, " "), 100), value: m.id }));
	}
	if (option === "routine") {
		const all = await listRoutines({ agentId: env.agent.id });
		return all
			.filter((r) => !q || r.name.toLowerCase().includes(q))
			.slice(0, 25)
			.map((r) => ({ name: truncate(`${r.enabled ? "" : "⏸ "}${r.name}`, 100), value: r.id }));
	}
	return [];
}
