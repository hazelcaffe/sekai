import { SignalLinkStart, SignalProfile, SignalRegister, SignalVerify } from "@sekai/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import { requireRecentAuth } from "../auth/routes.ts";
import { restartChannel } from "../channels/manager.ts";
import { status } from "../channels/state.ts";
import { db, schema } from "../db/index.ts";
import {
	getSignalLink,
	requestSignalCode,
	setSignalProfile,
	signalAccountInfo,
	startSignalLink,
	trustSignalIdentity,
	verifySignalCode,
} from "../signal/accounts.ts";
import { restartSignalDaemon, signalEngineStatus, startSignalInstall } from "../signal/engine.ts";
import { body, ok } from "./util.ts";

/** Once signal-cli is installed, Signal accounts that were waiting for it connect right away. */
async function startWaitingAccounts(): Promise<void> {
	const rows = await db.select().from(schema.channels).where(eq(schema.channels.type, "signal"));
	for (const c of rows) if (c.enabled && status(c.id).state !== "connected") void restartChannel(c.id);
}

/**
 * Bots' Signal accounts: signal-cli on this server (its state; admins install and restart it), connecting an account
 * (linking to a phone, or registering a number), and an account's own page. Removing one is DELETE /channels/:id.
 */
export const signalRoutes = new Hono()
	.use("*", async (_c, next) => {
		requirePermission("channels");
		return next();
	})
	.get("/status", (c) => c.json(signalEngineStatus()))
	// Installing and restarting it are the server's setup.
	.post("/install", (c) => {
		requirePermission("admin");
		requireRecentAuth(c);
		void startSignalInstall()
			.then(startWaitingAccounts)
			.catch(() => {});
		return c.json(signalEngineStatus());
	})
	.post("/restart", async (c) => {
		requirePermission("admin");
		await restartSignalDaemon();
		return c.json(signalEngineStatus());
	})
	// A new account is a new sign-in for the bot: confirm it's you first.
	.post("/link", async (c) => {
		const input = await body(c, SignalLinkStart);
		requireRecentAuth(c);
		return c.json(await startSignalLink(input), 201);
	})
	.get("/link/:id", (c) => c.json(getSignalLink(c.req.param("id"))))
	.post("/register", async (c) => {
		const input = await body(c, SignalRegister);
		requireRecentAuth(c);
		return c.json(await requestSignalCode(input));
	})
	.post("/verify", async (c) => {
		const input = await body(c, SignalVerify);
		requireRecentAuth(c);
		return c.json(await verifySignalCode(input));
	})
	.get("/accounts/:id", async (c) => c.json(await signalAccountInfo(c.req.param("id"))))
	.post("/accounts/:id/profile", async (c) =>
		c.json(await setSignalProfile(c.req.param("id"), await body(c, SignalProfile))),
	)
	.post("/accounts/:id/trust", async (c) => {
		const { id } = await body(c, z.object({ id: z.string().min(1).max(64) }));
		requireRecentAuth(c);
		await trustSignalIdentity(c.req.param("id"), id);
		return c.json(ok);
	});
