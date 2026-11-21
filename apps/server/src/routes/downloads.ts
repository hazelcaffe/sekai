import { Hono } from "hono";
import { APP_VERSION } from "../config.ts";
import { createDownloadsSource } from "../services/downloads.ts";

const downloads = createDownloadsSource({ version: APP_VERSION });

/** Where to get the desktop, phone and browser apps of this server's release (for anyone signed in). */
export const downloadRoutes = new Hono().get("/downloads", async (c) => c.json(await downloads.get()));
