import type { Routine, Schedule } from "@sekai/shared";
import { z } from "zod";
import { isoInZone, isValidTimezone, parseWhen } from "../../lib/time.ts";
import { describeSchedule } from "../../scheduler/schedule.ts";
import { createRoutine, deleteRoutine, getRoutine, listRoutines, updateRoutine } from "../../services/routines.ts";
import { effectiveTimezone } from "../../services/settings.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

// Flat parameters (instead of a union) keep the schema friendly to every provider.
const scheduleParams = {
	schedule_type: z.enum(["cron", "interval", "once"]),
	cron: z.string().optional().describe("For cron: 5-field expression, e.g. '0 8 * * 1-5'"),
	every_minutes: z.number().int().min(1).optional().describe("For interval"),
	at: z
		.string()
		.optional()
		.describe("For once: ISO 8601 time (user's zone if no offset) or relative like 'in 20 minutes'"),
};

function toSchedule(
	args: { schedule_type: "cron" | "interval" | "once"; cron?: string; every_minutes?: number; at?: string },
	tz: string,
): Schedule {
	switch (args.schedule_type) {
		case "cron":
			if (!args.cron) throw new ToolError("cron is required for schedule_type 'cron'");
			return { type: "cron", expr: args.cron };
		case "interval":
			if (!args.every_minutes) throw new ToolError("every_minutes is required for schedule_type 'interval'");
			return { type: "interval", minutes: args.every_minutes };
		case "once": {
			const at = args.at ? parseWhen(args.at, tz) : null;
			if (at === null)
				throw new ToolError(`Couldn't read the time "${args.at ?? ""}". Use ISO 8601 or "in N minutes".`);
			return { type: "once", at };
		}
	}
}

async function describe(r: Routine) {
	const tz = await effectiveTimezone(r.timezone);
	return {
		id: r.id,
		name: r.name,
		action: r.action,
		enabled: r.enabled,
		schedule: describeSchedule(r.schedule, tz),
		timezone: tz,
		next_run: r.nextRunAt ? isoInZone(r.nextRunAt, tz) : null,
		last_run: r.lastRunAt ? isoInZone(r.lastRunAt, tz) : null,
		last_status: r.lastStatus,
		instruction: r.instruction,
	};
}

async function ownRoutine(id: string, ctx: ToolContext): Promise<Routine> {
	const r = await getRoutine(id);
	if (!r || r.agentId !== ctx.agent.id) throw new ToolError(`No routine with id ${id}`);
	return r;
}

function zoneArg(tz: string | undefined, ctx: ToolContext): string {
	if (!tz) return "auto";
	if (!isValidTimezone(tz)) throw new ToolError(`Unknown time zone "${tz}"`);
	return tz === ctx.timezone ? "auto" : tz;
}

export const routineTools = [
	defineTool({
		name: "routine_list",
		category: "routines",
		description: "List your routines and pending reminders with schedules and next run times.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Checked routines",
		async execute(_args, ctx) {
			return Promise.all((await listRoutines({ agentId: ctx.agent.id })).map(describe));
		},
	}),
	defineTool({
		name: "reminder_create",
		category: "routines",
		description:
			"Set a one-off reminder. By default the text is posted to the user as-is at that time (no model call). Set run=true to have yourself do work at that time instead (the text becomes your instruction).",
		parameters: z.object({
			text: z.string().min(1).max(4000).describe("What to remind the user of, written to them"),
			at: z.string().describe("ISO 8601 time (user's zone if no offset) or relative like 'in 20 minutes'"),
			run: z.boolean().optional(),
			timezone: z.string().optional(),
		}),
		risk: "write",
		title: () => "Set a reminder",
		async execute(args, ctx) {
			const tz = args.timezone && isValidTimezone(args.timezone) ? args.timezone : ctx.timezone;
			const at = parseWhen(args.at, tz);
			if (at === null)
				throw new ToolError(`Couldn't read the time "${args.at}". Use ISO 8601 or "in N minutes".`);
			if (at < Date.now() - 30_000) throw new ToolError("That time is in the past.");
			const r = await createRoutine(
				{
					agentId: ctx.agent.id,
					conversationId: ctx.conversation.id,
					name: args.text.slice(0, 80),
					instruction: args.text,
					action: args.run ? "run" : "notify",
					schedule: { type: "once", at },
					timezone: zoneArg(args.timezone, ctx),
				},
				"agent",
			);
			return describe(r);
		},
	}),
	defineTool({
		name: "routine_create",
		category: "routines",
		description:
			"Create a recurring routine you will run on a schedule. action 'run' (default): you get the instruction and work on it, posting the result here. action 'notify': the instruction is posted as a reminder without a model call. Write a self-contained instruction (goal, inputs, output format, what to do if data is missing). Results go to this conversation.",
		parameters: z.object({
			name: z.string().min(1).max(120),
			instruction: z.string().min(1).max(20_000),
			action: z.enum(["run", "notify"]).optional(),
			...scheduleParams,
			timezone: z.string().optional().describe("IANA zone; defaults to the user's"),
		}),
		risk: "write",
		title: (a) => `Created routine “${a.name}”`,
		async execute(args, ctx) {
			const tz = args.timezone && isValidTimezone(args.timezone) ? args.timezone : ctx.timezone;
			const r = await createRoutine(
				{
					agentId: ctx.agent.id,
					conversationId: ctx.conversation.id,
					name: args.name,
					instruction: args.instruction,
					action: args.action ?? "run",
					schedule: toSchedule(args, tz),
					timezone: zoneArg(args.timezone, ctx),
				},
				"agent",
			);
			return describe(r);
		},
	}),
	defineTool({
		name: "routine_update",
		category: "routines",
		description:
			"Change one of your routines: rename, rewrite the instruction, change the schedule (pass schedule_type and its field), or pause/resume with enabled.",
		parameters: z.object({
			id: z.string(),
			name: z.string().min(1).max(120).optional(),
			instruction: z.string().min(1).max(20_000).optional(),
			action: z.enum(["run", "notify"]).optional(),
			enabled: z.boolean().optional(),
			schedule_type: scheduleParams.schedule_type.optional(),
			cron: scheduleParams.cron,
			every_minutes: scheduleParams.every_minutes,
			at: scheduleParams.at,
			timezone: z.string().optional(),
		}),
		risk: "write",
		title: (a) =>
			a.enabled === false ? "Paused a routine" : a.enabled === true ? "Resumed a routine" : "Updated a routine",
		async execute(args, ctx) {
			const current = await ownRoutine(args.id, ctx);
			const tz = await effectiveTimezone(args.timezone ?? current.timezone);
			const r = await updateRoutine(args.id, {
				name: args.name,
				instruction: args.instruction,
				action: args.action,
				enabled: args.enabled,
				schedule: args.schedule_type
					? toSchedule({ ...args, schedule_type: args.schedule_type }, tz)
					: undefined,
				timezone: args.timezone ? zoneArg(args.timezone, ctx) : undefined,
			});
			return describe(r);
		},
	}),
	defineTool({
		name: "routine_delete",
		category: "routines",
		description: "Delete one of your routines or reminders permanently. Prefer pausing unless asked to delete.",
		parameters: z.object({ id: z.string() }),
		risk: "destructive",
		title: () => "Deleted a routine",
		async execute(args, ctx) {
			const r = await ownRoutine(args.id, ctx);
			await deleteRoutine(r.id);
			return { deleted: r.name };
		},
	}),
	defineTool({
		name: "routine_run_now",
		category: "routines",
		description:
			"Trigger one of your routines immediately as a test. It performs real work, and the result is posted in the routine's conversation shortly after this turn.",
		parameters: z.object({ id: z.string() }),
		risk: "write",
		title: () => "Started a test run",
		async execute(args, ctx) {
			const r = await ownRoutine(args.id, ctx);
			const { dispatchRoutine } = await import("../../scheduler/runner.ts");
			void dispatchRoutine(r, { test: true });
			return { started: true, routine: r.name, note: "The result will appear after your current reply." };
		},
	}),
];
