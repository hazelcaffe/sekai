import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import {
	deleteCodeIndex,
	getCodeIndex,
	indexFolder,
	listCodeIndexes,
	refreshCodeIndex,
	searchCode,
} from "../code/indexer.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { getMachine } from "../machines/manager.ts";
import { body, ok } from "./util.ts";

/** Bots' code indexes: index a folder on one of their machines, refresh, search, delete. */
export const codeRoutes = new Hono()
	.get("/", async (c) => c.json(await listCodeIndexes(c.req.query("agentId") || undefined)))
	.post("/", async (c) => {
		const b = await body(
			c,
			z.object({
				machineId: z.string().min(1),
				root: z.string().min(1).max(1000),
				name: z.string().max(60).optional(),
			}),
		);
		requirePermission("code");
		const m = await getMachine(b.machineId);
		if (!m) throw notFound("Machine");
		if (!b.root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(b.root)) throw badRequest("Use the folder's full path");
		return c.json(await indexFolder({ agentId: m.agentId, machine: m, root: b.root, name: b.name }), 201);
	})
	.get("/:id", async (c) => c.json(await getCodeIndex(c.req.param("id"))))
	.post("/:id/refresh", async (c) => c.json(await refreshCodeIndex(c.req.param("id"))))
	.post("/:id/search", async (c) => {
		const b = await body(
			c,
			z.object({ query: z.string().min(1).max(500), limit: z.number().int().max(30).optional() }),
		);
		return c.json(await searchCode([c.req.param("id")], b.query, { limit: b.limit }));
	})
	.delete("/:id", async (c) => {
		await deleteCodeIndex(c.req.param("id"));
		return c.json(ok);
	});
