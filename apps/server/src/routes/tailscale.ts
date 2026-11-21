import { Hono } from "hono";
import { z } from "zod";
import {
	clearTailscaleApi,
	renewAuthKey,
	setByIp,
	setDefaultUser,
	setHttps,
	setTailscaleApi,
	tailscaleOverview,
} from "../machines/tailscale.ts";
import { body, ok, readJson } from "./util.ts";

/** Settings → Network & devices: this server on the tailnet, its HTTPS address, the API key, the auth key for new machines. */
export const tailscaleRoutes = new Hono()
	.get("/", async (c) => c.json(await tailscaleOverview()))
	.put("/api", async (c) => c.json(await setTailscaleApi(await readJson(c))))
	.delete("/api", async (c) => {
		await clearTailscaleApi();
		return c.json(ok);
	})
	.post("/https", async (c) => {
		const { on } = await body(c, z.object({ on: z.boolean() }));
		return c.json(await setHttps(on));
	})
	.post("/by-ip", async (c) => {
		const { on } = await body(c, z.object({ on: z.boolean() }));
		return c.json(await setByIp(on));
	})
	.post("/auth-key", async (c) => c.json(await renewAuthKey()))
	.put("/default-user", async (c) => {
		const { user } = await body(c, z.object({ user: z.string().min(1).max(64) }));
		await setDefaultUser(user);
		return c.json(await tailscaleOverview());
	});
