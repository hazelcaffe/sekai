import { Hono } from "hono";
import { z } from "zod";
import { authenticateProvider, startCheck } from "../providers/index.ts";
import {
	createProvider,
	deleteProvider,
	listProviders,
	publicProviderById,
	requireProvider,
	updateProvider,
} from "../providers/store.ts";
import { body, ok, readJson } from "./util.ts";

export const providerRoutes = new Hono()
	.get("/", (c) => c.json(listProviders()))
	.post("/", async (c) => {
		const created = await createProvider((await readJson(c)) as never);
		if (created.enabled) startCheck(created.id);
		return c.json(publicProviderById(created.id), 201);
	})
	.patch("/:id", async (c) => {
		const id = c.req.param("id");
		const before = requireProvider(id);
		const updated = await updateProvider(id, (await readJson(c)) as never);
		const relaunch =
			updated.command !== before.command ||
			JSON.stringify(updated.args) !== JSON.stringify(before.args) ||
			JSON.stringify(updateProviderEnvKeys(updated.env)) !== JSON.stringify(updateProviderEnvKeys(before.env)) ||
			(updated.enabled && !before.enabled);
		if (relaunch && updated.enabled) startCheck(id);
		return c.json(publicProviderById(id));
	})
	.delete("/:id", async (c) => {
		await deleteProvider(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/check", (c) => {
		const id = c.req.param("id");
		requireProvider(id);
		startCheck(id);
		return c.json(publicProviderById(id));
	})
	.post("/:id/authenticate", async (c) => {
		const id = c.req.param("id");
		const { methodId } = await body(c, z.object({ methodId: z.string().min(1) }));
		await authenticateProvider(id, methodId);
		return c.json(publicProviderById(id));
	});

/** Env changes that matter for a re-check (masked values compare equal, so compare keys and lengths). */
function updateProviderEnvKeys(env: Record<string, string>): string[] {
	return Object.entries(env)
		.map(([k, v]) => `${k}:${v.length}`)
		.sort();
}
