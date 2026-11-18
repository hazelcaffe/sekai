import { z } from "zod";

/** What starts an event routine (instead of a time). */
export const RoutineEvent = z.discriminatedUnion("kind", [
	/**
	 * A request to the routine's own webhook address (GitHub, Home Assistant, IFTTT, Zapier, a script…). The server
	 * makes the token; what's sent comes along to the bot.
	 */
	z.object({ kind: z.literal("webhook"), token: z.string().max(80).optional() }),
	/** A device on your tailnet goes offline or comes back. deviceId null: any device bots can use. */
	z.object({
		kind: z.literal("device"),
		deviceId: z.string().max(100).nullable().default(null),
		deviceName: z.string().max(100).default(""),
		change: z.enum(["offline", "online", "any"]).default("offline"),
	}),
]);
export type RoutineEvent = z.infer<typeof RoutineEvent>;

export const Schedule = z.discriminatedUnion("type", [
	/** Standard 5-field cron (or 6 with seconds), evaluated in the routine's time zone. */
	z.object({ type: z.literal("cron"), expr: z.string().min(1).max(120) }),
	z.object({ type: z.literal("interval"), minutes: z.number().int().min(1).max(525_600) }),
	/** One-off, at an absolute time (ms since epoch). */
	z.object({ type: z.literal("once"), at: z.number().int() }),
	/** Whenever something happens: a webhook is called, a device goes offline… */
	z.object({ type: z.literal("event"), event: RoutineEvent }),
]);
export type Schedule = z.infer<typeof Schedule>;

/**
 * - run: the agent receives the instruction and works on it (tools, memory, everything).
 * - notify: the instruction is posted as-is as a reminder, without calling a model.
 */
export const RoutineAction = z.enum(["run", "notify"]);
export type RoutineAction = z.infer<typeof RoutineAction>;

export const RoutineStatus = z.enum(["running", "succeeded", "failed"]);
export type RoutineStatus = z.infer<typeof RoutineStatus>;

export const Routine = z.object({
	id: z.string(),
	/** Whose routine it is (it runs as them). */
	userId: z.string(),
	agentId: z.string(),
	/** Where results are posted. null means the agent's main chat. */
	conversationId: z.string().nullable(),
	name: z.string(),
	instruction: z.string(),
	action: RoutineAction,
	schedule: Schedule,
	/** IANA zone, or "auto" for the app setting. */
	timezone: z.string(),
	enabled: z.boolean(),
	createdBy: z.enum(["user", "agent"]),
	lastRunAt: z.number().nullable(),
	lastStatus: RoutineStatus.nullable(),
	nextRunAt: z.number().nullable(),
	runCount: z.number(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Routine = z.infer<typeof Routine>;

export const RoutineCreate = z.object({
	agentId: z.string().min(1),
	conversationId: z.string().nullable().default(null),
	name: z.string().trim().min(1).max(120),
	instruction: z.string().trim().min(1).max(20_000),
	action: RoutineAction.default("run"),
	schedule: Schedule,
	timezone: z.string().default("auto"),
	enabled: z.boolean().default(true),
});
export type RoutineCreate = z.input<typeof RoutineCreate>;

export const RoutineUpdate = z
	.object({
		conversationId: z.string().nullable(),
		name: z.string().trim().min(1).max(120),
		instruction: z.string().trim().min(1).max(20_000),
		action: RoutineAction,
		schedule: Schedule,
		timezone: z.string(),
		enabled: z.boolean(),
	})
	.partial();
export type RoutineUpdate = z.input<typeof RoutineUpdate>;

export const RoutineRun = z.object({
	id: z.string(),
	routineId: z.string(),
	conversationId: z.string().nullable(),
	messageId: z.string().nullable(),
	status: RoutineStatus,
	error: z.string().nullable(),
	startedAt: z.number(),
	finishedAt: z.number().nullable(),
});
export type RoutineRun = z.infer<typeof RoutineRun>;

export interface SchedulePreview {
	valid: boolean;
	error: string | null;
	description: string;
	nextRuns: number[];
}

export const SchedulePreviewRequest = z.object({ schedule: Schedule, timezone: z.string().default("auto") });
export type SchedulePreviewRequest = z.input<typeof SchedulePreviewRequest>;
