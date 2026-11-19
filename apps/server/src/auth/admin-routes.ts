import { EmailConfig, MobilePushSettings, patchOf, SmsConfig } from "@sekai/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { badRequest } from "../lib/errors.ts";
import { mobileStatus, saveMobileSettings } from "../mobile/settings.ts";
import { body, ok, readJson } from "../routes/util.ts";
import {
	publicEmailConfig,
	publicSmsConfig,
	saveEmailConfig,
	saveSmsConfig,
	sendEmail,
	sendSms,
} from "../services/messaging.ts";
import { createRole, deleteRole, listRoles, updateRole } from "./roles.ts";
import { publicUrl, requireRecentAuth } from "./routes.ts";
import { revokeEverything } from "./service.ts";
import { createProvider, deleteProvider, listProviders, updateProvider } from "./sso.ts";
import {
	createUser,
	deleteUser,
	getManagedUser,
	listUsers,
	resetUserMfa,
	resetUserPassword,
	updateUser,
} from "./users.ts";

/**
 * Admin: people, roles, how they sign in, and push for the phone apps (/api/admin, admins only). Changes ask the
 * admin to confirm it's them when they last did a while ago.
 */

const me = (c: Context) => c.get("actor").userId;

export const adminRoutes = new Hono()
	.use("*", async (c, next) => {
		if (c.req.method !== "GET") requireRecentAuth(c);
		return next();
	})

	// People
	.get("/users", async (c) => c.json(await listUsers()))
	.post("/users", async (c) => c.json(await createUser((await readJson(c)) as never, publicUrl(c)), 201))
	.get("/users/:id", async (c) => c.json(await getManagedUser(c.req.param("id"))))
	.patch("/users/:id", async (c) => c.json(await updateUser(c.req.param("id"), (await readJson(c)) as never, me(c))))
	.post("/users/:id/reset-password", async (c) => {
		const { how } = await body(c, z.object({ how: z.enum(["temporary", "link"]).default("temporary") }));
		return c.json(await resetUserPassword(c.req.param("id"), how, publicUrl(c)));
	})
	.post("/users/:id/reset-mfa", async (c) => c.json(await resetUserMfa(c.req.param("id"))))
	.post("/users/:id/sign-out", async (c) => {
		await revokeEverything(c.req.param("id"), { tokens: false });
		return c.json(ok);
	})
	.delete("/users/:id", async (c) => {
		await deleteUser(c.req.param("id"), me(c));
		return c.json(ok);
	})

	// Roles
	.get("/roles", async (c) => c.json(await listRoles()))
	.post("/roles", async (c) => c.json(await createRole((await readJson(c)) as never), 201))
	.patch("/roles/:id", async (c) => c.json(await updateRole(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/roles/:id", async (c) => {
		await deleteRole(c.req.param("id"));
		return c.json(ok);
	})

	// Single sign-on
	.get("/sso", async (c) => c.json(await listProviders(publicUrl(c))))
	.post("/sso", async (c) => c.json(await createProvider((await readJson(c)) as never, publicUrl(c)), 201))
	.patch("/sso/:id", async (c) => c.json(await updateProvider(c.req.param("id"), await readJson(c), publicUrl(c))))
	.delete("/sso/:id", async (c) => {
		await deleteProvider(c.req.param("id"));
		return c.json(ok);
	})

	// Email and text messages (codes, invites, password resets)
	.get("/email", async (c) => c.json(await publicEmailConfig()))
	.put("/email", async (c) => c.json(await saveEmailConfig(await body(c, patchOf(EmailConfig)))))
	.post("/email/test", async (c) => {
		const { to } = await body(c, z.object({ to: z.string().trim().email() }));
		await sendEmail(
			to,
			"Sekai can send email",
			"This is a test from Sekai. Sign-in codes, invites and password resets will come from this address.",
		);
		return c.json(ok);
	})
	.get("/sms", async (c) => c.json(await publicSmsConfig()))
	.put("/sms", async (c) => c.json(await saveSmsConfig(await body(c, patchOf(SmsConfig)))))
	.post("/sms/test", async (c) => {
		const { to } = await body(c, z.object({ to: z.string().trim() }));
		if (!/^\+[1-9]\d{6,14}$/.test(to)) throw badRequest("Use the number with its country code, like +15551234567");
		await sendSms(to, "This is a test from Sekai: text messages work.");
		return c.json(ok);
	})

	// The phone apps' push: Firebase (Android) and Apple push (iOS)
	.get("/mobile", async (c) => c.json(await mobileStatus()))
	.put("/mobile", async (c) => c.json(await saveMobileSettings(await body(c, patchOf(MobilePushSettings)))));
