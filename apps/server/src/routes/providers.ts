import { Hono } from "hono";
import { z } from "zod";
import { can } from "../auth/actor.ts";
import { badRequest } from "../lib/errors.ts";
import { authenticateProvider, startCheck } from "../providers/index.ts";
import { withSetup } from "../providers/setup.ts";
import { isSigningIn, issueSignInTicket } from "../providers/signin.ts";
import {
	createProvider,
	deleteProvider,
	listProviders,
	publicProviderById,
	requireProvider,
	updateProvider,
} from "../providers/store.ts";
import { isToolId, presetsUsingTool, startToolInstall } from "../providers/tools.ts";
import { body, ok, readJson } from "./util.ts";

const SignInBody = z.object({
	methodId: z.string().min(1).max(200).optional(),
	target: z.string().min(1).max(120).optional(),
});

async function fullProvider(id: string, isAdmin: boolean) {
	return withSetup(publicProviderById(id), { isAdmin, isSigningIn });
}

export const providerRoutes = new Hono()
	.get("/", async (c) => {
		const isAdmin = can("admin");
		const list = await Promise.all(listProviders().map((p) => withSetup(p, { isAdmin, isSigningIn })));
		return c.json(list);
	})
	.post("/", async (c) => {
		const created = await createProvider((await readJson(c)) as never);
		if (created.enabled) startCheck(created.id);
		return c.json(await fullProvider(created.id, true), 201);
	})
	.post("/tools/:toolId/install", async (c) => {
		const toolId = c.req.param("toolId");
		if (!isToolId(toolId)) throw badRequest("Unknown subscription tool.");
		await startToolInstall(toolId, (installedId) => {
			const presets = presetsUsingTool(installedId);
			for (const p of listProviders()) {
				if (p.enabled && presets.has(p.preset)) startCheck(p.id);
			}
		});
		return c.json(ok);
	})
	.patch("/:id", async (c) => {
		const id = c.req.param("id");
		const before = requireProvider(id);
		const updated = await updateProvider(id, (await readJson(c)) as never);
		const relaunch =
			updated.command !== before.command ||
			updated.ownConfig !== before.ownConfig ||
			JSON.stringify(updated.args) !== JSON.stringify(before.args) ||
			JSON.stringify(updateProviderEnvKeys(updated.env)) !== JSON.stringify(updateProviderEnvKeys(before.env)) ||
			(updated.enabled && !before.enabled);
		if (relaunch && updated.enabled) startCheck(id);
		return c.json(await fullProvider(id, true));
	})
	.delete("/:id", async (c) => {
		await deleteProvider(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/check", async (c) => {
		const id = c.req.param("id");
		requireProvider(id);
		startCheck(id);
		return c.json(await fullProvider(id, true));
	})
	.post("/:id/authenticate", async (c) => {
		const id = c.req.param("id");
		const { methodId } = await body(c, z.object({ methodId: z.string().min(1) }));
		await authenticateProvider(id, methodId);
		return c.json(await fullProvider(id, true));
	})
	.post("/:id/signin", async (c) => {
		const id = c.req.param("id");
		const raw = await readJson(c).catch(() => ({}));
		const parsed = SignInBody.safeParse(raw ?? {});
		if (!parsed.success) throw badRequest("Invalid sign-in request.");
		const principal = c.get("principal");
		const actor = c.get("actor");
		const ticket = issueSignInTicket({
			providerId: id,
			userId: actor.userId,
			sessionId: principal.kind === "session" ? principal.sessionId : null,
			methodId: parsed.data.methodId,
			target: parsed.data.target,
		});
		return c.json(ticket);
	});

/** Env changes that matter for a re-check (masked values compare equal, so compare keys and lengths). */
function updateProviderEnvKeys(env: Record<string, string>): string[] {
	return Object.entries(env)
		.map(([k, v]) => `${k}:${v.length}`)
		.sort();
}
