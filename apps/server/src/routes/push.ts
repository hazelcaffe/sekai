import { MobilePushToken } from "@sekai/shared";
import { Hono } from "hono";
import { z } from "zod";
import { addDevice, removeDevice } from "../mobile/devices.ts";
import { apnsReady, fcmClientConfig } from "../mobile/settings.ts";
import { addSubscription, pushToMe, removeSubscription, vapidPublicKey } from "../push.ts";
import { body, ok } from "./util.ts";

const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export const pushRoutes = new Hono()
	.get("/key", async (c) => c.json({ publicKey: await vapidPublicKey() }))
	.post("/subscriptions", async (c) => {
		const sub = await body(c, Sub);
		return c.json({ devices: await addSubscription(sub, c.req.header("user-agent") ?? "") }, 201);
	})
	.post("/unsubscribe", async (c) => {
		const { endpoint } = await body(c, z.object({ endpoint: z.string() }));
		await removeSubscription(endpoint);
		return c.json(ok);
	})
	// The iOS and Android apps: what they need to turn push on, and their phones' tokens.
	.get("/mobile", async (c) => c.json({ fcm: await fcmClientConfig(), apns: await apnsReady() }))
	.post("/devices", async (c) => c.json({ devices: await addDevice(await body(c, MobilePushToken)) }, 201))
	.post("/devices/remove", async (c) => {
		const { token } = await body(c, z.object({ token: z.string().max(4096) }));
		await removeDevice(token);
		return c.json(ok);
	})
	.post("/test", async (c) =>
		c.json({
			sent: await pushToMe({
				title: "Sekai",
				body: "Push notifications work on this device. 🎉",
				url: "/settings?tab=notifications",
				tag: "sekai-test",
				// Shown even while Sekai is open (that's when you press the button).
				test: true,
			}),
		}),
	);
