import { Hono } from "hono";
import {
	createSharedBrowser,
	deleteSharedBrowser,
	listSharedBrowsers,
	updateSharedBrowser,
} from "../browser/shared.ts";
import { ok, readJson } from "./util.ts";

/** Your shared browsers: one browser several bots use, on the server or one of your computers. */
export const sharedBrowserRoutes = new Hono()
	.get("/", async (c) => c.json(await listSharedBrowsers(c.req.query("agentId") || undefined)))
	.post("/", async (c) => c.json(await createSharedBrowser(await readJson(c)), 201))
	.patch("/:id", async (c) => c.json(await updateSharedBrowser(c.req.param("id"), await readJson(c))))
	.delete("/:id", async (c) => {
		await deleteSharedBrowser(c.req.param("id"));
		return c.json(ok);
	});
