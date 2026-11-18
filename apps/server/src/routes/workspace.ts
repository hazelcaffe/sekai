import { type MemoryKind, MemoryKind as MemoryKindSchema, SchedulePreviewRequest } from "@sekai/shared";
import { Hono } from "hono";
import { z } from "zod";
import { checkupMemory, checkupStatus, setCheckupSchedule } from "../agent/checkup.ts";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { dispatchRoutine } from "../scheduler/runner.ts";
import { previewSchedule } from "../scheduler/schedule.ts";
import { requireAgent } from "../services/agents.ts";
import {
	clearMemories,
	createMemory,
	createNote,
	deleteMemory,
	deleteNote,
	listMemories,
	listNotes,
	updateMemory,
	updateNote,
} from "../services/memories.ts";
import {
	createRoutine,
	deleteRoutine,
	listRoutineRuns,
	listRoutines,
	requireRoutine,
	updateRoutine,
} from "../services/routines.ts";
import { effectiveTimezone } from "../services/settings.ts";
import { body, ok, queryBool, readJson } from "./util.ts";

function kindParam(value: string | undefined): MemoryKind | undefined {
	if (!value) return undefined;
	const r = MemoryKindSchema.safeParse(value);
	if (!r.success) throw badRequest(`Unknown memory kind: ${value}`);
	return r.data;
}

export const memoryRoutes = new Hono()
	.get("/", async (c) => {
		const agentId = c.req.query("agentId") || undefined;
		const shared = queryBool(c.req.query("shared"));
		const scope = c.req.query("scope");
		return c.json(
			await listMemories({
				agentId,
				sharedOnly: shared === true,
				includeShared: scope === "all",
				kind: kindParam(c.req.query("kind")),
				query: c.req.query("q") || undefined,
			}),
		);
	})
	.post("/", async (c) => c.json(await createMemory((await readJson(c)) as never, "user"), 201))
	// Check-ups: how often, and one bot's now.
	.get("/checkups", async (c) => c.json(await checkupStatus()))
	.put("/checkups", async (c) => {
		const { schedule } = await body(c, z.object({ schedule: z.enum(["weekly", "monthly", "off"]) }));
		return c.json(await setCheckupSchedule(schedule));
	})
	.post("/checkups/run", async (c) => {
		const { agentId } = await body(c, z.object({ agentId: z.string().min(1) }));
		return c.json(await checkupMemory(await requireAgent(agentId)));
	})
	.patch("/:id", async (c) => c.json(await updateMemory(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteMemory(c.req.param("id"));
		return c.json(ok);
	})
	.delete("/", async (c) => {
		const agentId = c.req.query("agentId") || undefined;
		const shared = queryBool(c.req.query("shared"));
		if (!agentId && !shared) throw badRequest("Pass agentId or shared=1");
		const deleted = await clearMemories({ agentId, shared, kind: kindParam(c.req.query("kind")) });
		return c.json({ deleted });
	});

export const noteRoutes = new Hono()
	.get("/", async (c) => {
		const agentId = c.req.query("agentId");
		if (!agentId) throw badRequest("agentId is required");
		return c.json(await listNotes(agentId));
	})
	.post("/", async (c) => c.json(await createNote((await readJson(c)) as never, "user"), 201))
	.patch("/:id", async (c) => c.json(await updateNote(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteNote(c.req.param("id"));
		return c.json(ok);
	});

export const routineRoutes = new Hono()
	.get("/", async (c) => c.json(await listRoutines({ agentId: c.req.query("agentId") || undefined })))
	.post("/", async (c) => c.json(await createRoutine((await readJson(c)) as never, "user"), 201))
	.post("/preview", async (c) => {
		const req = await body(c, SchedulePreviewRequest);
		return c.json(previewSchedule(req.schedule, await effectiveTimezone(req.timezone)));
	})
	.get("/:id", async (c) => c.json(await requireRoutine(c.req.param("id"))))
	.patch("/:id", async (c) => c.json(await updateRoutine(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteRoutine(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/test", async (c) => {
		const routine = await requireRoutine(c.req.param("id"));
		void dispatchRoutine(routine, { test: true }).catch((err: unknown) =>
			log.warn(`routine test ${routine.id} failed: ${errorMessage(err)}`),
		);
		return c.json(ok);
	})
	.get("/:id/runs", async (c) => {
		await requireRoutine(c.req.param("id"));
		return c.json(await listRoutineRuns(c.req.param("id")));
	});
