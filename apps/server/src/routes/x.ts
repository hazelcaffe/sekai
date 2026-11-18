import { Hono } from "hono";
import { connectX, disconnectX, getXAccount, updateX } from "../x/accounts.ts";
import { changesNeed, ok, ownBotParam, readJson } from "./util.ts";

/** A bot's X account: connect with its auth_token, choose whose mentions it answers. */
export const xRoutes = new Hono()
	.use("/:agentId", ownBotParam(), changesNeed("channels"))
	.get("/:agentId", async (c) => c.json(await getXAccount(c.req.param("agentId"))))
	.put("/:agentId", async (c) => c.json(await connectX(c.req.param("agentId"), await readJson(c))))
	.patch("/:agentId", async (c) => c.json(await updateX(c.req.param("agentId"), await readJson(c))))
	.delete("/:agentId", async (c) => {
		await disconnectX(c.req.param("agentId"));
		return c.json(ok);
	});
