import { ExtensionConnect, ExtensionResult } from "@sekai/shared";
import { Hono } from "hono";
import { z } from "zod";
import { decideApproval, listPendingApprovals } from "../agent/approvals.ts";
import { cancelConversationRuns, sendUserMessage } from "../agent/runtime.ts";
import { requireActorId, requirePermission } from "../auth/actor.ts";
import { requireRecentAuth } from "../auth/routes.ts";
import { createToken } from "../auth/service.ts";
import { extensionBroker } from "../browser/extension.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { getAgent, listOwnAgents } from "../services/agents.ts";
import { createConversation, listConversations, requireConversation } from "../services/conversations.ts";
import { listMessages } from "../services/messages.ts";
import { body, ok } from "./util.ts";

async function ownBot(id: string) {
	const agent = await getAgent(id);
	if (!agent || agent.userId !== requireActorId()) throw notFound("Agent");
	return agent;
}

/** Every sidebar chat is a direct chat with your own bot, never a shared bot's private browser. */
async function ownChat(id: string) {
	const chat = await requireConversation(id);
	if (chat.kind !== "direct" || !chat.agentId) throw notFound("Conversation");
	await ownBot(chat.agentId);
	return chat;
}

export const extensionRoutes = new Hono()
	.use("*", async (c, next) => {
		requirePermission("browser");
		c.header("cache-control", "no-store");
		return next();
	})
	.post("/token", async (c) => {
		requireRecentAuth(c);
		const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(80) }));
		return c.json(await createToken(requireActorId(), name, "extension"), 201);
	})
	.get("/agents", async (c) => c.json((await listOwnAgents()).map(({ id, name }) => ({ id, name }))))
	.get("/chats/:agentId", async (c) => {
		await ownBot(c.req.param("agentId"));
		return c.json(await listConversations({ kind: "direct", agentId: c.req.param("agentId"), archived: false }));
	})
	.post("/chats", async (c) => {
		const { agentId } = await body(c, z.object({ agentId: z.string().min(1).max(80) }));
		await ownBot(agentId);
		return c.json(await createConversation({ kind: "direct", agentId, title: "Browser chat" }), 201);
	})
	.get("/chat/:id", async (c) => {
		await ownChat(c.req.param("id"));
		return c.json({
			messages: await listMessages(c.req.param("id"), { limit: 100 }),
			approvals: listPendingApprovals().filter((a) => a.conversationId === c.req.param("id")),
		});
	})
	.post("/chat/:id/messages", async (c) => {
		await ownChat(c.req.param("id"));
		const { text } = await body(c, z.object({ text: z.string().trim().min(1).max(30_000) }));
		return c.json(await sendUserMessage(c.req.param("id"), { text }), 201);
	})
	.post("/chat/:id/stop", async (c) => {
		await ownChat(c.req.param("id"));
		return c.json({ cancelled: await cancelConversationRuns(c.req.param("id")) });
	})
	.post("/chat/:id/approve", async (c) => {
		await ownChat(c.req.param("id"));
		const { toolCallId, approve } = await body(
			c,
			z.object({ toolCallId: z.string().max(200), approve: z.boolean() }),
		);
		if (!listPendingApprovals().some((a) => a.conversationId === c.req.param("id") && a.toolCallId === toolCallId))
			throw notFound("Pending approval");
		await decideApproval(toolCallId, { approve, scope: "once" });
		return c.json(ok);
	})
	.post("/sessions", async (c) => {
		const input = await body(c, ExtensionConnect);
		const chat = await ownChat(input.conversationId);
		if (chat.agentId !== input.agentId) throw notFound("Conversation");
		const p = c.get("principal");
		if (p.kind !== "token" || p.scope !== "extension")
			throw badRequest("Use a browser extension token to share tabs.");
		try {
			return c.json(extensionBroker.connect(requireActorId(), p.tokenId, input), 201);
		} catch (err) {
			throw badRequest(errorMessage(err));
		}
	})
	.use("/sessions/:id/*", async (c, next) => {
		if (c.get("principal").kind !== "token") throw notFound("Browser connection");
		return next();
	})
	.post("/sessions/:id/poll", (c) => {
		const p = c.get("principal");
		if (p.kind !== "token") throw notFound("Browser connection");
		try {
			return c.json(extensionBroker.poll(requireActorId(), p.tokenId, c.req.param("id")));
		} catch {
			throw notFound("Browser connection");
		}
	})
	.post("/sessions/:id/result", async (c) => {
		const p = c.get("principal");
		if (p.kind !== "token") throw notFound("Browser connection");
		const result = await body(c, ExtensionResult);
		try {
			if (!extensionBroker.complete(requireActorId(), p.tokenId, c.req.param("id"), result))
				throw notFound("Browser command");
		} catch {
			throw notFound("Browser command");
		}
		return c.json(ok);
	})
	.post("/sessions/:id/check", async (c) => {
		const p = c.get("principal");
		if (p.kind !== "token") throw notFound("Browser connection");
		const { commandId } = await body(c, z.object({ commandId: z.string().min(1).max(80) }));
		try {
			if (!extensionBroker.claim(requireActorId(), p.tokenId, c.req.param("id"), commandId))
				throw notFound("Active browser command");
		} catch {
			throw notFound("Active browser command");
		}
		return c.json(ok);
	})
	.delete("/sessions/:id", (c) => {
		const p = c.get("principal");
		if (p.kind !== "token") throw notFound("Browser connection");
		try {
			extensionBroker.disconnect(requireActorId(), p.tokenId, c.req.param("id"));
		} catch {
			throw notFound("Browser connection");
		}
		return c.json(ok);
	});
