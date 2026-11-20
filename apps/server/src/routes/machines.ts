import { MachinePortShare, type TeachContext, TeachDraftInput, TeachSave } from "@sekai/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { draftSkill, saveTaughtSkill } from "../agent/teach.ts";
import { requirePermission } from "../auth/actor.ts";
import { requireRecentAuth } from "../auth/routes.ts";
import {
	answerCredentialRequest,
	deleteSavedLogin,
	listCredentialRequests,
	listSavedLogins,
} from "../browser/credentials.ts";
import { errorMessage } from "../lib/errors.ts";
import { Desktop } from "../machines/desktop.ts";
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
import { machinePorts, shareMachinePort } from "../machines/ports.ts";
import { addMember, listMembers, listSeats, removeMember, requireSeat, retryMember } from "../machines/seats.ts";
import { requireOwnedAgent } from "../services/agents.ts";
import { body, ok, readJson } from "./util.ts";

/** Every route about one machine checks it's one of your bots' first (anyone else's is "not found"). */
const ownMachine: MiddlewareHandler = async (c, next) => {
	const id = c.req.param("id") ?? "";
	if (id !== "proxmox" && id !== "seats") await requireMachine(id);
	return next();
};

/**
 * Whose screen or account a request is about: the machine's own bot (none given), or a bot with a seat on it.
 * Returns that bot's id once the seat is checked.
 */
async function seatBot(machineId: string, agentId: string | undefined | null): Promise<string> {
	const m = await requireMachine(machineId);
	if (!agentId || agentId === m.agentId) return m.agentId;
	await requireSeat(m.id, agentId);
	return agentId;
}

export const machineRoutes = new Hono()
	.use("/:id/*", ownMachine)
	.get("/", async (c) => c.json(await listMachines({ agentId: c.req.query("agentId") || undefined })))
	// Your machines this bot has a seat on (another bot's computer or devbox shared with it).
	.get("/seats", async (c) => c.json(await listSeats(c.req.query("agentId") ?? "")))
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
	// You're using the computer (or a member bot's own screen on it): that bot waits until you hand it back.
	.post("/:id/takeover", async (c) => {
		const { active, agentId } = await body(
			c,
			z.object({ active: z.boolean().default(false), agentId: z.string().optional() }),
		);
		const who = await seatBot(c.req.param("id"), agentId);
		setTakeover(c.req.param("id"), who, active);
		return c.json(ok);
	})
	// Passwords: confirm it's you first (when you last did so a while ago).
	.get("/:id/access", async (c) => {
		requireRecentAuth(c);
		const who = await seatBot(c.req.param("id"), c.req.query("agent"));
		return c.json(await machineAccess(c.req.param("id"), who));
	})
	// Other bots sharing it, each in its own account (and screen, on a computer).
	.get("/:id/members", async (c) => c.json(await listMembers(c.req.param("id"))))
	.post("/:id/members", async (c) => c.json(await addMember(c.req.param("id"), await readJson(c)), 201))
	.post("/:id/members/:memberId/retry", async (c) =>
		c.json(await retryMember(c.req.param("id"), c.req.param("memberId"))),
	)
	.delete("/:id/members/:memberId", async (c) => {
		await removeMember(c.req.param("id"), c.req.param("memberId"));
		return c.json(ok);
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
	// Web apps running there, with their links on your tailnet; sharing one over HTTPS (tailscale serve).
	.get("/:id/ports", async (c) => c.json(await machinePorts(await requireMachine(c.req.param("id")))))
	.post("/:id/ports", async (c) => {
		const { port, https } = await body(c, MachinePortShare);
		return c.json(await shareMachinePort(await requireMachine(c.req.param("id")), port, https));
	})
	// Teaching a bot by doing it once, from the takeover view: what's on screen at a step (the active window, and
	// whether the focused field is a password, so its text is never kept), the skill a model writes, and saving it.
	.get("/:id/teach/context", async (c) => {
		const m = await requireMachine(c.req.param("id"));
		const who = await seatBot(m.id, c.req.query("agent"));
		if (m.kind !== "computer" || m.status !== "running")
			return c.json({ error: "The computer isn't running" }, 409);
		const desktop = await desktopOf(m, who);
		const [win, focused] = await Promise.all([
			desktop.windows().catch(() => null),
			c.req.query("focus") === "1" && desktop instanceof Desktop ? desktop.focused().catch(() => null) : null,
		]);
		const active = win?.activeWindow ?? null;
		const context: TeachContext = {
			window: active,
			app: win?.windows.find((w) => w.title === active)?.app ?? null,
			focused: focused ? { role: focused.role, name: focused.name, password: focused.password } : null,
		};
		return c.json(context);
	})
	.post("/:id/teach", async (c) => {
		const input = await body(c, TeachDraftInput);
		const agent = await requireOwnedAgent(await seatBot(c.req.param("id"), input.agentId));
		return c.json(await draftSkill(agent, input));
	})
	.post("/:id/teach/save", async (c) => {
		const input = await body(c, TeachSave);
		const agent = await requireOwnedAgent(await seatBot(c.req.param("id"), input.agentId));
		return c.json(await saveTaughtSkill(agent, input), 201);
	})
	// A live look at the computer's screen (or a member bot's own screen on it), for the preview in the app.
	.get("/:id/screen", async (c) => {
		const m = await requireMachine(c.req.param("id"));
		const who = await seatBot(m.id, c.req.query("agent"));
		if ((m.kind !== "computer" && m.kind !== "device") || m.status !== "running")
			return c.json({ error: "The computer isn't running" }, 409);
		try {
			const shot = await (await desktopOf(m, who)).screenshot();
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
