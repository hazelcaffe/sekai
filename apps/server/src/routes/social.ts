import { Hono } from "hono";
import { connectIg, disconnectIg, getIgAccount, updateIg } from "../social/instagram.ts";
import { connectTt, disconnectTt, getTtAccount, updateTt } from "../social/tiktok.ts";
import { changesNeed, ok, ownBotParam, readJson } from "./util.ts";

/** A bot's Instagram account: connect with its sessionid cookie, choose whose DMs it answers. */
export const instagramRoutes = new Hono()
	.use("/:agentId", ownBotParam(), changesNeed("channels"))
	.get("/:agentId", async (c) => c.json(await getIgAccount(c.req.param("agentId"))))
	.put("/:agentId", async (c) => c.json(await connectIg(c.req.param("agentId"), await readJson(c))))
	.patch("/:agentId", async (c) => c.json(await updateIg(c.req.param("agentId"), await readJson(c))))
	.delete("/:agentId", async (c) => {
		await disconnectIg(c.req.param("agentId"));
		return c.json(ok);
	});

/** A bot's TikTok account. */
export const tiktokRoutes = new Hono()
	.use("/:agentId", ownBotParam(), changesNeed("channels"))
	.get("/:agentId", async (c) => c.json(await getTtAccount(c.req.param("agentId"))))
	.put("/:agentId", async (c) => c.json(await connectTt(c.req.param("agentId"), await readJson(c))))
	.patch("/:agentId", async (c) => c.json(await updateTt(c.req.param("agentId"), await readJson(c))))
	.delete("/:agentId", async (c) => {
		await disconnectTt(c.req.param("agentId"));
		return c.json(ok);
	});
