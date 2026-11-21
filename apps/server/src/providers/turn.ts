import { createHash } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
	type Agent,
	byosModelId,
	type Message,
	PROVIDER_PRESETS,
	type Provider,
	type ThinkingSetting,
	type Usage,
} from "@sekai/shared";
import { and, eq } from "drizzle-orm";
import type { ToolCallEnv } from "../agent/loop.ts";
import type { BuiltPrompt } from "../agent/prompt.ts";
import { RefusalError } from "../agent/refusal.ts";
import { db, schema } from "../db/index.ts";

import { newId } from "../lib/ids.ts";
import { truncate, truncateMiddle } from "../lib/text.ts";
import { listAgents } from "../services/agents.ts";
import { listMessages } from "../services/messages.ts";
import { getUploadRow, isTextFile, readUploadText } from "../services/uploads.ts";
import { bridgeUrl, ExternalTurnState, newBridgeToken, registerTurn } from "./bridge.ts";
import { workspaceDir } from "./process.ts";
import { modelLabel, requireProvider } from "./store.ts";

export type ExternalSession = typeof schema.externalSessions.$inferSelect;

export type TurnBlock = { type: "text"; text: string } | { type: "image"; mime: string; data: string };

export interface ComposeOptions {
	/** A new agent-side session: it hasn't seen anything yet. */
	fresh: boolean;
	/**
	 * How Sekai's instructions reach the agent:
	 * - never: the runner passes them as a system prompt on every turn (Claude Agent SDK).
	 * - full: put them all in this prompt (a new ACP session that takes no system prompt).
	 * - changes: re-send only sections that changed since last turn, plus the current situation (ACP).
	 */
	instructions: "never" | "full" | "changes";
	/** Whether the agent accepts images in the prompt. */
	images: boolean;
}

export interface Composed {
	blocks: TurnBlock[];
	/** createdAt of the newest message included, so the next turn starts after it. */
	syncedAt: number | null;
	hashes: Record<string, string>;
}

export interface RunnerInput {
	provider: Provider;
	agent: Agent;
	model: string | null;
	thinking: ThinkingSetting;
	session: ExternalSession;
	cwd: string;
	mcpUrl: string;
	state: ExternalTurnState;
	env: ToolCallEnv;
	/** Sekai's full instructions, for agents that take a system prompt. */
	system: string;
	compose(opts: ComposeOptions): Promise<Composed>;
	/** Persist the agent-side session id as soon as it exists (so a failed turn doesn't lose it). */
	onSession(sessionId: string): Promise<void>;
}

export interface RunnerResult {
	sessionId: string;
	usage: Usage;
	composed: Composed;
}

export class ExternalTurnError extends Error {
	constructor(
		message: string,
		readonly sideEffects: boolean,
	) {
		super(message);
		this.name = "ExternalTurnError";
	}
}

// ---------------------------------------------------------------- sessions

async function ensureSession(agentId: string, conversationId: string, providerId: string): Promise<ExternalSession> {
	const where = and(
		eq(schema.externalSessions.agentId, agentId),
		eq(schema.externalSessions.conversationId, conversationId),
		eq(schema.externalSessions.providerId, providerId),
	);
	const existing = await db.query.externalSessions.findFirst({ where });
	if (existing) return existing;
	const now = Date.now();
	await db
		.insert(schema.externalSessions)
		.values({
			id: newId("xs"),
			agentId,
			conversationId,
			providerId,
			token: newBridgeToken(),
			sessionId: null,
			syncedAt: null,
			promptHashes: null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();
	const row = await db.query.externalSessions.findFirst({ where });
	if (!row) throw new Error("Couldn't create the external session");
	return row;
}

async function saveSession(id: string, patch: Partial<ExternalSession>): Promise<void> {
	await db
		.update(schema.externalSessions)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(schema.externalSessions.id, id));
}

// ---------------------------------------------------------------- prompt

const SEED_MESSAGES = 60;
const SEED_CHARS = 60_000;
const MESSAGE_CHARS = 6_000;
const INLINE_FILE_CHARS = 20_000;
const MAX_IMAGES = 4;

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function runningNote(provider: Provider, cwd: string, userName: string): string {
	const preset = PROVIDER_PRESETS[provider.preset];
	const who = userName || "the user";
	const tools =
		provider.preset === "pi"
			? "- This Pi session is chat-only. You have no tools, even if other instructions name them. Do not claim to have used them."
			: `- Sekai tools: the tools these instructions name (memory_save, note_write, routine_create, agent_ask…) come from the MCP server called "sekai". Your client may show them with a prefix, such as mcp__sekai__memory_save. Use them for memory, notes, routines and reminders, skills and teammates: that's how your work shows up in Sekai.
- Your own tools (files, shell, web) work in your workspace folder: ${cwd}. Files ${who} attaches are copied into its inbox/ folder.`;
	return `# How you're running
You're running in ${provider.title} (${preset.vendor}) on ${who}'s computer, connected to Sekai. Sekai shows your reply in the chat and keeps the conversation.
${tools}
- Write your reply as normal Markdown; it's posted to the chat as-is. Don't mention these mechanics unless asked.`;
}

function textOf(m: Message): string {
	return m.parts
		.filter((p) => p.type === "text")
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("")
		.trim();
}

function toolSummary(m: Message): string {
	const done = m.parts.flatMap((p) => (p.type === "tool" && p.status === "done" ? [p.title ?? p.name] : []));
	return done.length ? ` (did: ${done.slice(0, 8).join("; ")})` : "";
}

async function copyToInbox(cwd: string, uploadId: string, name: string): Promise<string> {
	const row = await getUploadRow(uploadId);
	const ext = extname(name);
	const stem =
		basename(name, ext)
			.replace(/[^\w.-]+/g, "_")
			.slice(0, 60) || "file";
	const file = `${stem}-${uploadId.slice(-6)}${ext}`;
	await copyFile(row.path, join(cwd, "inbox", file));
	return `inbox/${file}`;
}

/** Composes an external agent's turn from the Sekai conversation, sending only what it hasn't seen. */
function composer(opts: {
	provider: Provider;
	env: ToolCallEnv;
	session: ExternalSession;
	prompt: BuiltPrompt;
	system: string;
	cwd: string;
	triggerText: string | null;
	before?: number;
}) {
	const { provider, env, session, prompt, cwd } = opts;
	const { agent, conversation } = env.ctx;
	const userLabel = env.userName || "User";
	const isGroup = conversation.kind === "group";

	return async (o: ComposeOptions): Promise<Composed> => {
		const agents = new Map((await listAgents()).map((a) => [a.id, a]));
		const all = (await listMessages(conversation.id)).filter(
			(m) =>
				m.id !== env.ctx.messageId &&
				m.status !== "streaming" &&
				(opts.before === undefined || m.createdAt < opts.before),
		);
		const own = (m: Message) => m.sender === "agent" && m.agentId === agent.id;
		const viaThisProvider = (m: Message) => own(m) && (m.meta.models ?? []).some((x) => x.startsWith(provider.id));
		const since = o.fresh ? null : session.syncedAt;
		const pool = o.fresh
			? all.slice(-SEED_MESSAGES)
			: all.filter((m) => m.createdAt > (since ?? 0) && !viaThisProvider(m));

		// What the agent is answering: the routine's instruction, or the newest message that isn't its own.
		let current: Message | null = null;
		if (!opts.triggerText) {
			for (let i = pool.length - 1; i >= 0; i--) {
				const m = pool[i];
				if (m && !own(m)) {
					current = m;
					break;
				}
			}
		}

		const speaker = (m: Message) => {
			if (m.sender === "user") return userLabel;
			if (m.sender === "system") return "Sekai";
			if (own(m)) return "You";
			return agents.get(m.agentId ?? "")?.name ?? "Former teammate";
		};
		const render = (m: Message) => {
			const files = m.attachments.length ? ` [attached: ${m.attachments.map((a) => a.name).join(", ")}]` : "";
			const tools = own(m) ? toolSummary(m) : "";
			const body = truncateMiddle(textOf(m), MESSAGE_CHARS);
			if (!body && !files) return null;
			return `[${speaker(m)}]${tools}: ${body}${files}`;
		};

		const context: string[] = [];
		let size = 0;
		for (const m of [...pool].reverse()) {
			if (m === current) continue;
			const line = render(m);
			if (!line) continue;
			size += line.length;
			if (size > SEED_CHARS) break;
			context.unshift(line);
		}

		const sections = prompt.sections.filter((s) => s.id !== "situation");
		const note = runningNote(provider, cwd, env.userName);
		const hashes: Record<string, string> = Object.fromEntries([
			...sections.map((s) => [s.id, hash(s.content)]),
			["running", hash(note)],
		]);

		const parts: string[] = [];
		if (o.instructions === "full") {
			parts.push(`<sekai_instructions>\n${opts.system}\n</sekai_instructions>`);
		} else if (o.instructions === "changes") {
			const before = o.fresh ? hashes : (session.promptHashes ?? {});
			const changed = sections.filter((s) => before[s.id] !== hashes[s.id]);
			if (before.running !== hashes.running)
				parts.push(`<sekai_instructions_update>\n${note}\n</sekai_instructions_update>`);
			if (changed.length) {
				parts.push(
					`<sekai_instructions_update>\nThese parts of your instructions changed since your last reply; they replace the earlier versions.\n\n${changed.map((s) => s.content).join("\n\n")}\n</sekai_instructions_update>`,
				);
			}
			const situation = prompt.sections.find((s) => s.id === "situation");
			if (situation) parts.push(`<sekai_situation>\n${situation.content}\n</sekai_situation>`);
		}
		if (o.fresh && conversation.summary) {
			parts.push(
				`<summary_of_earlier_conversation>\n${conversation.summary}\n</summary_of_earlier_conversation>`,
			);
		}
		if (context.length) {
			const tag = o.fresh ? "conversation_so_far" : "since_your_last_reply";
			parts.push(`<${tag}>\n${context.join("\n\n")}\n</${tag}>`);
		}

		// The new input, with attachments copied into the workspace (and images inline when supported).
		const images: TurnBlock[] = [];
		let input: string;
		if (opts.triggerText) {
			input = opts.triggerText;
		} else if (current) {
			const lines = [isGroup || parts.length ? `[${speaker(current)}]: ${textOf(current)}` : textOf(current)];
			for (const a of current.attachments) {
				try {
					const path = await copyToInbox(cwd, a.id, a.name);
					lines.push(`[Attached ${a.kind === "image" ? "image" : "file"}: ${a.name}, saved as ${path}]`);
					if (isTextFile(a)) {
						lines.push(
							`<file name="${a.name}">\n${await readUploadText(a.id, INLINE_FILE_CHARS)}\n</file>`,
						);
					} else if (
						o.images &&
						a.kind === "image" &&
						a.mime !== "image/svg+xml" &&
						images.length < MAX_IMAGES
					) {
						const row = await getUploadRow(a.id);
						if (row.size <= 5 * 1024 * 1024) {
							const data = Buffer.from(await Bun.file(row.path).arrayBuffer()).toString("base64");
							images.push({ type: "image", mime: a.mime, data });
						}
					}
				} catch {
					lines.push(`[Attached: ${a.name} (couldn't be copied)]`);
				}
			}
			input = lines.join("\n");
		} else if (env.ctx.trigger === "regenerate") {
			input =
				"(The user discarded your last reply. Answer the most recent message again, taking a different approach.)";
		} else {
			input = "(Continue.)";
		}
		if (parts.length) parts.push(`Reply to this message:\n\n${input}`);
		else parts.push(input);

		const newest = pool.reduce((t, m) => Math.max(t, m.createdAt), session.syncedAt ?? 0);
		return {
			blocks: [{ type: "text", text: parts.join("\n\n") }, ...images],
			syncedAt: newest || null,
			hashes,
		};
	};
}

// ---------------------------------------------------------------- run

export interface ExternalTurnInput {
	env: ToolCallEnv;
	providerId: string;
	model: string | null;
	thinking: ThinkingSetting;
	prompt: BuiltPrompt;
	triggerText: string | null;
	/** Start the agent's session over (retrying an answer it must not see again). */
	restart?: boolean;
	/** Only messages from before this time count (retrying an earlier answer). */
	before?: number;
	runner: (input: RunnerInput) => Promise<RunnerResult>;
}

export interface ExternalTurnResult {
	usage: Usage;
	steps: number;
	model: string;
	models: string[];
}

/** One reply from an external agent: session bookkeeping, the tools bridge, and the prompt plan. */
export async function runExternalTurn(input: ExternalTurnInput): Promise<ExternalTurnResult> {
	const { env } = input;
	const { agent, conversation } = env.ctx;
	const provider = requireProvider(input.providerId);
	if (!provider.enabled) {
		throw new Error(
			`${provider.title} is turned off. Turn it on in Settings → Subscriptions, or pick another model.`,
		);
	}
	let session = await ensureSession(agent.id, conversation.id, provider.id);
	if (input.restart && (session.sessionId || session.syncedAt)) {
		await saveSession(session.id, { sessionId: null, syncedAt: null, promptHashes: null });
		session = { ...session, sessionId: null, syncedAt: null, promptHashes: null };
	}
	const cwd = workspaceDir(agent.id);
	const state = new ExternalTurnState(env);
	const unregister = registerTurn(agent.id, conversation.id, state);
	const system = `${input.prompt.text}\n\n${runningNote(provider, cwd, env.userName)}`;
	const rawId = byosModelId(provider.id, input.model);
	try {
		const result = await input.runner({
			provider,
			agent,
			model: input.model,
			thinking: input.thinking,
			session,
			cwd,
			mcpUrl: bridgeUrl(session.token),
			state,
			env,
			system,
			compose: composer({
				provider,
				env,
				session,
				prompt: input.prompt,
				system,
				cwd,
				triggerText: input.triggerText,
				before: input.before,
			}),
			onSession: (sessionId) => saveSession(session.id, { sessionId }),
		});
		await saveSession(session.id, {
			sessionId: result.sessionId,
			syncedAt: result.composed.syncedAt,
			promptHashes: result.composed.hashes,
		});
		return { usage: result.usage, steps: 1, model: modelLabel(rawId), models: [rawId] };
	} catch (err) {
		if (env.ctx.signal.aborted) throw err;
		if (err instanceof RefusalError) {
			// The agent's session holds its refusal; start it over so it never sees it again.
			await saveSession(session.id, { sessionId: null, syncedAt: null, promptHashes: null });
			throw err;
		}
		const message = err instanceof Error ? err.message : String(err);
		throw new ExternalTurnError(truncate(message, 2000), state.sideEffects);
	} finally {
		unregister();
	}
}
