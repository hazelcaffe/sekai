import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import { requireRecentAuth } from "../auth/routes.ts";
import {
	changesCredentials,
	connectAccount,
	createMailbox,
	decideSender,
	getEmailAccount,
	guessServers,
	recentMail,
	reconnectAccount,
	removeAccount,
	senderNotes,
	testAccount,
	updateAccount,
} from "../email/accounts.ts";
import {
	checkMailcow,
	emailOptions,
	forgetMailcow,
	mailcowSettings,
	publicMailcow,
	saveMailcowSettings,
} from "../email/settings.ts";
import { body, ok, ownBotParam, queryBool, queryInt, readJson } from "./util.ts";

/**
 * Email: the mailcow connection (admins, Settings → Bots → Email) and each bot's own address (its owner, with the
 * role's Accounts feature to change it).
 */
export const emailRoutes = new Hono()
	.use("/mailcow/*", async (_c, next) => {
		requirePermission("admin");
		return next();
	})
	.use("/mailcow", async (_c, next) => {
		requirePermission("admin");
		return next();
	})
	.get("/mailcow", async (c) => c.json(publicMailcow(await mailcowSettings())))
	.put("/mailcow", async (c) => {
		const input = await readJson(c);
		requireRecentAuth(c);
		return c.json(await saveMailcowSettings(input));
	})
	.delete("/mailcow", async (c) => {
		requireRecentAuth(c);
		await forgetMailcow();
		return c.json(ok);
	})
	.post("/mailcow/check", async (c) => {
		requireRecentAuth(c);
		return c.json(await checkMailcow(await readJson(c)));
	})
	// What a bot's owner can choose from, the servers for an address, signing in without saving.
	.use("*", async (c, next) => {
		if (c.req.method !== "GET") requirePermission("channels");
		return next();
	})
	.get("/options", async (c) => c.json(await emailOptions()))
	.get("/autoconfig", async (c) => c.json(await guessServers(c.req.query("address") ?? "")))
	.post("/test", async (c) => c.json(await testAccount(await readJson(c))))
	.get("/senders", async (c) => c.json(await senderNotes()))
	.post("/senders/:id", async (c) => {
		const { allow } = await body(c, z.object({ allow: z.boolean() }));
		await decideSender(c.req.param("id"), allow);
		return c.json(ok);
	})
	.use("/accounts/:agentId/*", ownBotParam())
	.use("/accounts/:agentId", ownBotParam())
	.get("/accounts/:agentId", async (c) => c.json(await getEmailAccount(c.req.param("agentId"))))
	.post("/accounts/:agentId/mailbox", async (c) =>
		c.json(await createMailbox(c.req.param("agentId"), await readJson(c)), 201),
	)
	.put("/accounts/:agentId", async (c) => {
		requireRecentAuth(c);
		return c.json(await connectAccount(c.req.param("agentId"), await readJson(c)), 201);
	})
	.patch("/accounts/:agentId", async (c) => {
		const input = await readJson(c);
		if (changesCredentials(input)) requireRecentAuth(c);
		return c.json(await updateAccount(c.req.param("agentId"), input));
	})
	.delete("/accounts/:agentId", async (c) => {
		const deleteMailbox = queryBool(c.req.query("mailbox")) ?? false;
		if (deleteMailbox) requireRecentAuth(c);
		await removeAccount(c.req.param("agentId"), { deleteMailbox });
		return c.json(ok);
	})
	.post("/accounts/:agentId/reconnect", async (c) => c.json(await reconnectAccount(c.req.param("agentId"))))
	.get("/accounts/:agentId/mail", async (c) =>
		c.json(await recentMail(c.req.param("agentId"), queryInt(c.req.query("limit"), 20))),
	);
