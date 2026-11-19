import { Hono } from "hono";
import { z } from "zod";
import { bus } from "../events/bus.ts";
import {
	checkWebEngine,
	installWebEngine,
	restartWebEngine,
	startWebEngine,
	stopWebEngine,
	webEngineStatus,
} from "../web/engine.ts";
import { publicWebSettings, saveWebSettings, webSettings } from "../web/settings.ts";
import { body, readJson } from "./util.ts";

const masked = async () => {
	const status = await webEngineStatus();
	return { ...status, settings: publicWebSettings(status.settings) };
};

/** Admin → Web reading: Firecrawl Local, run here or reached elsewhere, and what may go to Firecrawl's cloud. */
export const webRoutes = new Hono()
	.get("/", async (c) => c.json(await masked()))
	.patch("/settings", async (c) => {
		const before = await webSettings();
		const next = await saveWebSettings(await readJson(c));
		bus.emit({ type: "settings.changed" });
		// Anything but "crawl" changes how (or whether) the engine runs.
		const sameEngine =
			before.mode === next.mode &&
			before.port === next.port &&
			before.url === next.url &&
			before.token === next.token &&
			before.browser === next.browser &&
			before.cloud === next.cloud &&
			before.apiKey === next.apiKey;
		if (!sameEngine) {
			if (next.mode === "off") await stopWebEngine();
			else await startWebEngine();
		}
		return c.json(await masked());
	})
	.post("/install", async (c) => {
		await installWebEngine();
		return c.json(await masked());
	})
	.post("/restart", async (c) => {
		await restartWebEngine();
		return c.json(await masked());
	})
	.post("/check", async (c) => {
		const { url } = await body(c, z.object({ url: z.string().min(1).max(2000) }));
		return c.json(await checkWebEngine(url, c.req.raw.signal));
	});
