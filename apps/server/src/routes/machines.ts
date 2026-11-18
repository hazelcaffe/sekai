import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { requirePermission } from "../auth/actor.ts";
import { requireRecentAuth } from "../auth/routes.ts";
import {
	answerCredentialRequest,
	deleteSavedLogin,
	listCredentialRequests,
	listSavedLogins,
} from "../browser/credentials.ts";
import { errorMessage } from "../lib/errors.ts";
import {
	createMachine,
	deleteCheckpoint,
	deleteMachine,
	desktopOf,
	listCheckpoints,
	listMachines,
	machineAccess,
	makeCheckpoint,
	powerMachine,
	requireMachine,
	restoreCheckpoint,
	retryMachine,
	setTakeover,
	testProxmox,
	updateMachine,
} from "../machines/manager.ts";
import { body, ok, readJson } from "./util.ts";

/** Every route about one machine checks it's one of your bots' first (anyone else's is "not found"). */
const ownMachine: MiddlewareHandler = async (c, next) => {
	const id = c.req.param("id") ?? "";
	if (id !== "proxmox") await requireMachine(id);
	return next();
};

export const machineRoutes = new Hono()
	.use("/:id/*", ownMachine)
	.get("/", async (c) => c.json(await listMachines({ agentId: c.req.query("agentId") || undefined })))
	.post("/", async (c) => c.json(await createMachine((await readJson(c)) as never, "user"), 201))
	.post("/proxmox/test", async (c) => {
		requirePermission("admin");
		return c.json(await testProxmox());
	})
	.get("/:id", async (c) => c.json(await requireMachine(c.req.param("id"))))
	.patch("/:id", async (c) => c.json(await updateMachine(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteMachine(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/start", async (c) => c.json(await powerMachine(c.req.param("id"), "start")))
	.post("/:id/stop", async (c) => c.json(await powerMachine(c.req.param("id"), "stop")))
	.post("/:id/restart", async (c) => c.json(await powerMachine(c.req.param("id"), "restart")))
	.post("/:id/retry", async (c) => c.json(await retryMachine(c.req.param("id"))))
	// You're using the computer: the bot waits until you hand it back.
	.post("/:id/takeover", async (c) => {
		const { active } = (await readJson(c)) as { active?: boolean };
		await requireMachine(c.req.param("id"));
		setTakeover(c.req.param("id"), Boolean(active));
		return c.json(ok);
	})
	// Passwords: confirm it's you first (when you last did so a while ago).
	.get("/:id/access", async (c) => {
		requireRecentAuth(c);
		return c.json(await machineAccess(c.req.param("id")));
	})
	// Checkpoints: snapshots of a bot's computer or devbox to roll back to.
	.get("/:id/checkpoints", async (c) => c.json(await listCheckpoints(c.req.param("id"))))
	.post("/:id/checkpoints", async (c) => {
		const { label } = await body(c, z.object({ label: z.string().max(200).default("") }));
		return c.json(await makeCheckpoint(c.req.param("id"), label || "Saved by you"), 201);
	})
	.post("/:id/checkpoints/:name/restore", async (c) => {
		await restoreCheckpoint(c.req.param("id"), c.req.param("name"));
		return c.json(ok);
	})
	.delete("/:id/checkpoints/:name", async (c) => {
		await deleteCheckpoint(c.req.param("id"), c.req.param("name"));
		return c.json(ok);
	})
	// A live look at the computer's screen, for the preview in the app.
	.get("/:id/screen", async (c) => {
		const m = await requireMachine(c.req.param("id"));
		if ((m.kind !== "computer" && m.kind !== "device") || m.status !== "running")
			return c.json({ error: "The computer isn't running" }, 409);
		try {
			const shot = await (await desktopOf(m)).screenshot();
			return new Response(shot.png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
		} catch (err) {
			return c.json({ error: errorMessage(err) }, 502);
		}
	});

export const credentialRoutes = new Hono()
	.get("/requests", (c) => c.json(listCredentialRequests()))
	.post("/requests/:id", async (c) => {
		await answerCredentialRequest(c.req.param("id"), (await readJson(c)) as never);
		return c.json(ok);
	})
	.get("/saved", async (c) => c.json(await listSavedLogins(c.req.query("agentId") || undefined)))
	.delete("/saved/:id", async (c) => {
		await deleteSavedLogin(c.req.param("id"));
		return c.json(ok);
	});
