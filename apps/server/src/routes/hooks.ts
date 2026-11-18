import { Hono } from "hono";
import { log } from "../lib/log.ts";
import { truncate } from "../lib/text.ts";
import { dispatchRoutine } from "../scheduler/runner.ts";
import { routineForHook } from "../services/routines.ts";

/** At most one run per webhook this often (a chatty sender can't flood the bot or the gateway). */
const MIN_GAP_MS = 10_000;
const lastCall = new Map<string, number>();

/**
 * Webhooks for event routines: /api/hooks/<token> (GET or POST, no sign-in; the token is the key). What's sent
 * (JSON, form or text, up to 32 KB) is passed to the bot with the run.
 */
export const hookRoutes = new Hono().all("/:token", async (c) => {
	if (c.req.method !== "POST" && c.req.method !== "GET" && c.req.method !== "PUT")
		return c.json({ error: "Use POST" }, 405);
	const routine = await routineForHook(c.req.param("token"));
	if (!routine) return c.json({ error: "Not found" }, 404);
	if (!routine.enabled) return c.json({ error: "This routine is paused" }, 409);
	const now = Date.now();
	if (now - (lastCall.get(routine.id) ?? 0) < MIN_GAP_MS) {
		return c.json({ error: "Too soon after the last call; try again in a few seconds" }, 429);
	}
	lastCall.set(routine.id, now);

	let detail = "";
	const query = new URL(c.req.url).searchParams;
	if ([...query.keys()].length) detail += `Query: ${JSON.stringify(Object.fromEntries(query))}\n`;
	if (c.req.method !== "GET") {
		const raw = await c.req.text().catch(() => "");
		let body = raw;
		try {
			body = JSON.stringify(JSON.parse(raw), null, 2);
		} catch {}
		if (body.trim()) detail += truncate(body, 32_000);
	}
	const from = c.req.header("user-agent")?.slice(0, 80);
	log.info(`webhook for routine "${routine.name}"${from ? ` (${from})` : ""}`);
	void dispatchRoutine(routine, {
		event: { what: `its webhook was called${from ? ` (by ${from})` : ""}`, detail: detail.trim() || undefined },
	}).catch((err: unknown) => log.warn(`webhook routine failed: ${String(err)}`));
	return c.json({ ok: true, routine: routine.name }, 202);
});
