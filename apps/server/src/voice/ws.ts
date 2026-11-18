import type { Server, ServerWebSocket } from "bun";
import { type Actor, can, runAs } from "../auth/actor.ts";
import { socketActor } from "../auth/index.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { answerRing, ringReason } from "../outreach/calls.ts";
import { getAgent } from "../services/agents.ts";
import { getConversation } from "../services/conversations.ts";
import { Dictation } from "./dictation.ts";
import { type CallSession, VoiceCall } from "./voice-call.ts";

export interface VoiceSocket {
	kind: "voice";
	/** Who's talking: the session runs as them (their chat, their bots, their limits). */
	actor: Actor | null;
	mode: "dictate" | "call";
	conversationId: string | null;
	agentId: string | null;
	/** Answering a bot's call (call_user). */
	ring: string | null;
	session: Dictation | CallSession | null;
}

const CALL_PATH = /^\/api\/voice\/call\/([^/]+)$/;

/** /api/voice/dictate and /api/voice/call/:conversationId as WebSockets (signed in, from Sekai's own pages). */
export async function upgradeVoice(req: Request, server: Server<VoiceSocket>): Promise<Response | undefined | null> {
	const url = new URL(req.url);
	const call = url.pathname.match(CALL_PATH);
	if (url.pathname !== "/api/voice/dictate" && !call) return null;
	const actor = await socketActor(req);
	if (actor instanceof Response) return actor;
	if (!can("voice", actor)) return Response.json({ error: "Your role doesn't include voice" }, { status: 403 });
	return runAs(actor, () => upgradeAs(req, server, url, call, actor));
}

async function upgradeAs(
	req: Request,
	server: Server<VoiceSocket>,
	url: URL,
	call: RegExpMatchArray | null,
	actor: Actor,
): Promise<Response | undefined> {
	let data: VoiceSocket = {
		kind: "voice",
		actor,
		mode: "dictate",
		conversationId: null,
		agentId: null,
		ring: url.searchParams.get("ring"),
		session: null,
	};
	// Dictation in a chat uses that bot's dictation model.
	const chatId = url.searchParams.get("conversation");
	if (!call && chatId) {
		const c = await getConversation(chatId);
		if (c?.kind === "direct" && c.agentId) data.agentId = c.agentId;
	}
	if (call?.[1]) {
		const conversation = await getConversation(call[1]);
		if (!conversation) return Response.json({ error: "Chat not found" }, { status: 404 });
		if (conversation.kind !== "direct" || !conversation.agentId) {
			return Response.json({ error: "Calls are for chats with one bot" }, { status: 400 });
		}
		const agent = await getAgent(conversation.agentId);
		if (!agent) return Response.json({ error: "Bot not found" }, { status: 404 });
		if (agent.status !== "active") return Response.json({ error: `${agent.name} is paused` }, { status: 409 });
		data = { ...data, mode: "call", conversationId: conversation.id, agentId: agent.id };
	}
	return server.upgrade(req, { data })
		? undefined
		: Response.json({ error: "Expected a WebSocket" }, { status: 400 });
}

function sendJson(ws: ServerWebSocket<VoiceSocket>, ev: unknown): void {
	if (ws.readyState === 1) ws.send(JSON.stringify(ev));
}

export const voiceWebSocket = {
	open(ws: ServerWebSocket<VoiceSocket>) {
		return runAs(ws.data.actor, () => openAs(ws));
	},
	message(ws: ServerWebSocket<VoiceSocket>, raw: string | Buffer) {
		runAs(ws.data.actor, () => messageAs(ws, raw));
	},
	close(ws: ServerWebSocket<VoiceSocket>) {
		runAs(ws.data.actor, () => closeAs(ws));
	},
};

async function openAs(ws: ServerWebSocket<VoiceSocket>) {
	try {
		if (ws.data.mode === "dictate") {
			const d = new Dictation((ev) => {
				sendJson(ws, ev);
				if (ev.type === "done") ws.close(1000);
			}, ws.data.agentId);
			ws.data.session = d;
			await d.start();
			return;
		}
		const conversation = ws.data.conversationId ? await getConversation(ws.data.conversationId) : null;
		const agent = ws.data.agentId ? await getAgent(ws.data.agentId) : null;
		if (!conversation || !agent) throw new Error("The chat is gone");
		// Hung up before the call was set up: nothing to start.
		if (ws.readyState !== 1) return;
		const call = new VoiceCall(
			conversation,
			agent,
			(ev) => {
				sendJson(ws, ev);
				if (ev.type === "ended") setTimeout(() => ws.close(1000), 300);
			},
			(pcm) => {
				if (ws.readyState === 1) ws.send(pcm);
			},
		);
		ws.data.session = call;
		// Picking up a bot's call: it opens with why it called.
		const ring = ringReason(ws.data.ring);
		if (ws.data.ring) answerRing(ws.data.ring, conversation.id);
		log.info(`call ${ring ? "answered" : "started"} with ${agent.name}`);
		await call.start({ greet: true, reason: ring?.agentId === agent.id ? ring.reason : undefined });
	} catch (err) {
		sendJson(ws, { type: "error", message: errorMessage(err) });
		ws.close(1011);
	}
}

function messageAs(ws: ServerWebSocket<VoiceSocket>, raw: string | Buffer) {
	const s = ws.data.session;
	if (!s) return;
	if (typeof raw !== "string") {
		s.audio(new Uint8Array(raw));
		return;
	}
	let msg: { type?: string; on?: boolean; itemId?: string; ms?: number; text?: string };
	try {
		msg = JSON.parse(raw) as typeof msg;
	} catch {
		return;
	}
	if (s instanceof Dictation) {
		if (msg.type === "stop") s.stop();
		return;
	}
	if (msg.type === "mute") s.mute(Boolean(msg.on));
	else if (msg.type === "played" && msg.itemId) s.played(msg.itemId, Number(msg.ms) || 0);
	else if (msg.type === "hangup") s.end("hung up");
	else if (msg.type === "say" && msg.text) s.say(String(msg.text).slice(0, 2000));
}

function closeAs(ws: ServerWebSocket<VoiceSocket>) {
	const s = ws.data.session;
	if (s instanceof Dictation) s.close();
	else if (s) {
		s.end("hung up");
		log.info("call ended");
	}
	ws.data.session = null;
}
