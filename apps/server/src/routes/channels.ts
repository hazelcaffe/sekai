import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import {
	createChannel,
	decidePairing,
	deleteChannel,
	listAllBindings,
	listBindings,
	listChannels,
	listPairings,
	requireOwnChannel,
	restartChannel,
	unlinkBinding,
	updateBinding,
	updateChannel,
} from "../channels/manager.ts";
import { notFound } from "../lib/errors.ts";
import { body, ok, readJson } from "./util.ts";

export const channelRoutes = new Hono()
	.use("*", async (c, next) => {
		// Setting up accounts needs the role's "Accounts"; seeing and unlinking your linked chats doesn't.
		if (c.req.method !== "GET" && !c.req.path.includes("/bindings/")) requirePermission("channels");
		return next();
	})
	.get("/", async (c) => c.json(await listChannels({ agentId: c.req.query("agentId") || undefined })))
	.get("/links", async (c) => c.json(await listAllBindings()))
	.post("/", async (c) => c.json(await createChannel((await readJson(c)) as never), 201))
	.get("/pairings", async (c) => c.json(await listPairings()))
	.post("/pairings/:code", async (c) => {
		const { approve } = await body(c, z.object({ approve: z.boolean() }));
		if (!(await decidePairing(c.req.param("code"), approve))) throw notFound("Pairing request");
		return c.json(ok);
	})
	.delete("/bindings/:id", async (c) => {
		await unlinkBinding(c.req.param("id"));
		return c.json(ok);
	})
	.patch("/bindings/:id", async (c) => c.json(await updateBinding(c.req.param("id"), (await readJson(c)) as never)))
	.patch("/:id", async (c) => c.json(await updateChannel(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteChannel(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/restart", async (c) => {
		await requireOwnChannel(c.req.param("id"));
		return c.json(await restartChannel(c.req.param("id")));
	})
	.get("/:id/bindings", async (c) => c.json(await listBindings(c.req.param("id"))));
