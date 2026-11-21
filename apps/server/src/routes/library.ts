import { SkillImport } from "@sekai/shared";
import { Hono } from "hono";
import { requestOrigin } from "../auth/request.ts";
import { config } from "../config.ts";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { mcpIcon } from "../mcp/icons.ts";
import {
	connect,
	createServer,
	deleteServer,
	disconnect,
	finishSignIn,
	listServersWithStatus,
	requireOwnServerById,
	signOut,
	startSignIn,
	updateServer,
} from "../mcp/manager.ts";
import {
	createSkill,
	deleteSkill,
	listSkills,
	parseSkillMarkdown,
	requireSkill,
	skillToMarkdown,
	updateSkill,
} from "../services/skills.ts";
import { body, ok, readJson } from "./util.ts";

export const skillRoutes = new Hono()
	.get("/", async (c) => c.json(await listSkills()))
	.post("/", async (c) => c.json(await createSkill((await readJson(c)) as never, "user"), 201))
	.post("/import", async (c) => {
		const { markdown } = await body(c, SkillImport);
		return c.json(await createSkill(parseSkillMarkdown(markdown), "user"), 201);
	})
	.get("/:id", async (c) => c.json(await requireSkill(c.req.param("id"))))
	.get("/:id/export", async (c) => {
		const skill = await requireSkill(c.req.param("id"));
		c.header("content-type", "text/markdown; charset=utf-8");
		c.header("content-disposition", `attachment; filename="${skill.name}.SKILL.md"`);
		return c.body(skillToMarkdown(skill));
	})
	.patch("/:id", async (c) => c.json(await updateSkill(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteSkill(c.req.param("id"));
		return c.json(ok);
	});

export const mcpRoutes = new Hono()
	// One app's routes: yours only (an admin's app shared with everyone shows up, but only they change it).
	.use("/:id/*", async (c, next) => {
		const id = c.req.param("id") ?? "";
		if (id !== "oauth" && id !== "icons") await requireOwnServerById(id);
		return next();
	})
	.get("/", async (c) => c.json(await listServersWithStatus()))
	.post("/", async (c) => c.json(await createServer((await readJson(c)) as never), 201))
	.patch("/:id", async (c) => c.json(await updateServer(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteServer(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/connect", async (c) => {
		await disconnect(c.req.param("id"));
		return c.json(await connect(c.req.param("id")));
	})
	.post("/:id/disconnect", async (c) => c.json(await disconnect(c.req.param("id"))))
	/**
	 * Sign in to an app. Apps only send you back to https or localhost addresses: when you use Sekai at another
	 * plain-http address, you come back to localhost and paste that address into Sekai (pasteBack).
	 */
	.post("/:id/sign-in", async (c) => {
		const input = ((await readJson(c).catch(() => ({}))) ?? {}) as { loopback?: boolean };
		const origin = requestOrigin(c.req.raw);
		if (!origin) throw badRequest("Open Sekai in the browser to sign in");
		const u = new URL(origin);
		const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
		const pasteBack = input.loopback ? !local : u.protocol === "http:" && !local;
		const redirectOrigin =
			pasteBack || input.loopback ? `http://localhost:${local ? u.port || config.port : config.port}` : origin;
		const { url } = await startSignIn(c.req.param("id"), redirectOrigin);
		return c.json({ url, pasteBack });
	})
	.post("/:id/sign-out", async (c) => {
		await signOut(c.req.param("id"));
		return c.json(ok);
	})
	/** The address you landed on after signing in (when the app couldn't send you back to Sekai). */
	.post("/oauth/finish", async (c) => {
		const input = (await readJson(c)) as { url?: string };
		let u: URL;
		try {
			u = new URL(String(input.url ?? "").trim());
		} catch {
			throw badRequest("Paste the whole address from the browser's address bar");
		}
		const error = u.searchParams.get("error");
		if (error) throw badRequest(u.searchParams.get("error_description") ?? error);
		const code = u.searchParams.get("code");
		const state = u.searchParams.get("state");
		if (!code || !state) throw badRequest("That address has no sign-in code in it");
		return c.json({ serverId: await finishSignIn(state, code) });
	})
	// Apps send the browser back here after you approve.
	.get("/oauth/callback", async (c) => {
		const back = (q: string) => c.redirect(`/settings/apps?tab=mcp&${q}`, 302);
		const error = c.req.query("error");
		if (error) return back(`signin_error=${encodeURIComponent(c.req.query("error_description") ?? error)}`);
		const code = c.req.query("code");
		const state = c.req.query("state");
		if (!code || !state) return back("signin_error=The+app+didn%27t+send+a+code");
		try {
			return back(`signed_in=${encodeURIComponent(await finishSignIn(state, code))}`);
		} catch (err) {
			log.warn(`app sign-in failed: ${errorMessage(err)}`);
			return back(`signin_error=${encodeURIComponent(errorMessage(err))}`);
		}
	})
	/** An app's icon (its site's favicon, fetched once and kept). */
	.get("/icons/:domain", async (c) => {
		const icon = await mcpIcon(c.req.param("domain"));
		if (!icon) return c.body(null, 404);
		return new Response(Bun.file(icon.file), {
			headers: { "content-type": icon.type, "cache-control": "private, max-age=604800" },
		});
	});
