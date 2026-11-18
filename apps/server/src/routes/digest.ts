import { Hono } from "hono";
import { configureDigest, digestStatus, sendDigest } from "../services/digest.ts";
import { readJson } from "./util.ts";

export const digestRoutes = new Hono()
	.get("/", async (c) => c.json(await digestStatus()))
	.patch("/", async (c) => c.json(await configureDigest(await readJson(c))))
	// Send one now (even on a quiet day), to see what it looks like.
	.post("/send", async (c) => c.json({ sent: await sendDigest({ force: true }) }));
