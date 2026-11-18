import type { Agent } from "./agent.ts";
import type { Conversation } from "./conversation.ts";
import type { Machine } from "./machine.ts";
import type { Message, MessagePart } from "./message.ts";
import type { Routine } from "./routine.ts";
import type { Run } from "./run.ts";

/** Everything the server pushes over GET /api/events (Server-Sent Events, one JSON object per event). */
/** A call a bot is making to you. */
export interface CallRing {
	id: string;
	agentId: string;
	conversationId: string;
	reason: string;
	expiresAt: number;
}

export type ServerEvent =
	| { type: "hello"; serverTime: number }
	| { type: "message.created"; message: Message }
	| { type: "message.updated"; message: Message }
	/** Append text to a streaming text/reasoning/advisor part. */
	| { type: "message.delta"; conversationId: string; messageId: string; index: number; delta: string }
	/** Insert or replace a whole part (new part, tool status change). */
	| { type: "message.part"; conversationId: string; messageId: string; index: number; part: MessagePart }
	| { type: "message.deleted"; conversationId: string; messageId: string }
	| { type: "conversation.created"; conversation: Conversation }
	| { type: "conversation.updated"; conversation: Conversation }
	| { type: "conversation.deleted"; conversationId: string }
	| { type: "conversation.reset"; conversationId: string }
	| { type: "agent.created"; agent: Agent }
	| { type: "agent.updated"; agent: Agent }
	| { type: "agent.deleted"; agentId: string }
	| { type: "run.updated"; run: Run }
	| { type: "routine.changed"; routineId: string; routine: Routine | null }
	| { type: "memory.changed"; agentId: string | null }
	| { type: "note.changed"; agentId: string }
	| { type: "skill.changed" }
	| { type: "mcp.changed"; serverId: string }
	| { type: "settings.changed" }
	| { type: "channel.changed"; channelId: string }
	| { type: "provider.changed"; providerId: string }
	| { type: "pairing.changed"; pending: number }
	/** The set of tool calls waiting for approval changed. */
	| { type: "approvals.changed"; pending: number }
	| { type: "machine.changed"; machine: Machine }
	| { type: "machine.deleted"; machineId: string; agentId: string }
	/** A document was added to the library, finished indexing, or was renamed or deleted. */
	| { type: "library.changed" }
	/** A backup was made, deleted or uploaded, or the backup settings changed. */
	| { type: "backups.changed" }
	/** A checkpoint of this machine was made, restored or deleted (by you, a bot, or Sekai before a risky command). */
	| { type: "machine.checkpoints"; machineId: string }
	/** A bot's code indexes changed (indexing progress, done, deleted). */
	| { type: "code.changed"; agentId: string }
	/** A bot is calling you: answer in the app (or it messages you instead). */
	| { type: "call.ring"; ring: CallRing }
	| { type: "call.ring.ended"; ringId: string; outcome: "answered" | "declined" | "missed" }
	/** Bots waiting for you to sign them in somewhere. */
	| { type: "credentials.changed"; pending: number }
	| {
			type: "notification";
			title: string;
			body: string;
			agentId: string | null;
			conversationId: string | null;
			/** Where tapping it goes, when that isn't the chat (e.g. /admin for a server problem). */
			url?: string;
			/** A request waiting for your approval: push notifications can offer Approve / Deny. */
			approval?: { toolCallId: string; alwaysAsk: boolean };
	  };

export type ServerEventType = ServerEvent["type"];
