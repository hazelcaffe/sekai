import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { compactConversation } from "../agent/compaction.ts";
import { cancelConversationRuns, retryMessage, sendUserMessage, setMessageVersion } from "../agent/runtime.ts";
import {
	createConversation,
	deleteConversation,
	listConversations,
	requireConversation,
	resetConversation,
	setConversationSummary,
	updateConversation,
} from "../services/conversations.ts";
import { deleteMessage, listMessages, requireMessage } from "../services/messages.ts";
import { body, ok, queryBool, queryInt, readJson } from "./util.ts";

/** Every route about one chat checks it's yours first (someone else's chat is "not found"). */
const ownChat: MiddlewareHandler = async (c, next) => {
	await requireConversation(c.req.param("id") ?? "");
	return next();
};

export const conversationRoutes = new Hono()
	.use("/:id/*", ownChat)
	.get("/", async (c) => {
		const kind = c.req.query("kind");
		return c.json(
			await listConversations({
				agentId: c.req.query("agentId") || undefined,
				kind: kind === "direct" || kind === "group" ? kind : undefined,
				archived: queryBool(c.req.query("archived")),
			}),
		);
	})
	.post("/", async (c) => c.json(await createConversation((await readJson(c)) as never), 201))
	.get("/:id", async (c) => c.json(await requireConversation(c.req.param("id"))))
	.patch("/:id", async (c) => c.json(await updateConversation(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await cancelConversationRuns(c.req.param("id"));
		await deleteConversation(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/reset", async (c) => {
		await cancelConversationRuns(c.req.param("id"));
		return c.json(await resetConversation(c.req.param("id")));
	})
	.post("/:id/compact", async (c) => c.json(await compactConversation(c.req.param("id"), { keepRecent: 6 })))
	.post("/:id/clear-summary", async (c) => {
		await requireConversation(c.req.param("id"));
		return c.json(await setConversationSummary(c.req.param("id"), null, null));
	})
	.get("/:id/messages", async (c) => {
		await requireConversation(c.req.param("id"));
		return c.json(
			await listMessages(c.req.param("id"), {
				before: queryInt(c.req.query("before")),
				limit: queryInt(c.req.query("limit"), 200),
			}),
		);
	})
	.post("/:id/messages", async (c) =>
		c.json(await sendUserMessage(c.req.param("id"), (await readJson(c)) as never), 201),
	)
	.post("/:id/stop", async (c) => c.json({ cancelled: await cancelConversationRuns(c.req.param("id")) }));

export const messageRoutes = new Hono()
	.delete("/:id", async (c) => {
		const m = await requireMessage(c.req.param("id"));
		if (m.status === "streaming" && m.runId) {
			const { cancelRun } = await import("../agent/runtime.ts");
			await cancelRun(m.runId);
		}
		await deleteMessage(m.id);
		return c.json(ok);
	})
	.post("/:id/retry", async (c) => {
		await retryMessage(c.req.param("id"), (await readJson(c)) as never);
		return c.json(ok);
	})
	// Older clients: "regenerate" is a retry that keeps the old answer as a version.
	.post("/:id/regenerate", async (c) => {
		await retryMessage(c.req.param("id"), {});
		return c.json(ok);
	})
	.post("/:id/version", async (c) => {
		const { version } = await body(c, z.object({ version: z.number().int().min(0) }));
		return c.json(await setMessageVersion(c.req.param("id"), version));
	});
