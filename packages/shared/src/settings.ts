import { z } from "zod";
import { ApprovalMode, ToolRules } from "./agent.ts";
import { MachineBackend, MachineSpecs } from "./machine.ts";
import { ModelRef } from "./models.ts";

/** Where bots' computers and devboxes are created. Secrets are masked when read back. */
export const MachineSettings = z.object({
	proxmox: z.object({
		/** e.g. https://192.168.0.10:8006 */
		url: z.string(),
		/** API token id: user@realm!name */
		tokenId: z.string(),
		tokenSecret: z.string(),
		node: z.string(),
		/** Disks for VMs and containers (e.g. local-lvm). */
		storage: z.string(),
		/** Holds the cloud image, container template and cloud-init seed ISOs (e.g. local). */
		imageStorage: z.string(),
		bridge: z.string(),
		/** New VMs and containers get the first free id from here. */
		vmidStart: z.number().int().min(100),
		/** Accept Proxmox's self-signed certificate. */
		insecureTls: z.boolean(),
	}),
	/** Reusable auth key from the Tailscale admin console; machines join your tailnet with it. */
	tailscaleAuthKey: z.string(),
	computerSpecs: MachineSpecs,
	devboxSpecs: MachineSpecs,
	/** What new computers and devboxes run as, unless asked otherwise (settings saved before these get the defaults). */
	computerBackend: MachineBackend.default("vm"),
	devboxBackend: MachineBackend.default("lxc"),
	devboxTtlHours: z
		.number()
		.min(0.25)
		.max(24 * 30),
	maxDevboxesPerAgent: z.number().int().min(0).max(20),
	/** ask: a bot asking for a computer (or a bigger one) waits for you. allow: it gets one right away. */
	agentRequests: z.enum(["ask", "allow"]),
});
export type MachineSettings = z.infer<typeof MachineSettings>;

export const Settings = z.object({
	/** OpenAI-compatible base URL of the model gateway (LiteLLM, OpenRouter, Ollama, vLLM…), ending in /v1. */
	gatewayUrl: z.string(),
	/** Masked when read back; send a new value to replace it, or "" to keep it. */
	gatewayApiKey: z.string(),
	/** IANA time zone used for routines and the agents' sense of time. "auto" uses the server's zone. */
	timezone: z.string(),
	/** What agents call you. */
	userName: z.string(),
	/** Defaults for new agents. */
	defaultModel: ModelRef,
	defaultFastModel: ModelRef,
	/** Messages kept verbatim before older ones are summarized. */
	contextMessageLimit: z.number().int().min(4).max(1000),
	/** Fraction of the model's context window that triggers compaction. */
	compactionThreshold: z.number().min(0.1).max(0.95),
	/** Default approval mode for every agent (agents and chats can override it). */
	approvalMode: ApprovalMode,
	/** Tool rules for every agent. Agent and chat rules take precedence. */
	toolRules: ToolRules,
	/** Unanswered approval requests are denied after this long. 0 waits forever. */
	approvalTimeoutMinutes: z.number().int().min(0).max(10_080),
	/**
	 * When a model declines a task or a safety filter stops it, another model answers instead and the refusal
	 * is left out of the conversation. models: who to try, in order; empty picks a model from another provider.
	 */
	refusalRetry: z.object({ enabled: z.boolean(), models: z.array(ModelRef).max(4) }),
	machines: MachineSettings,
});
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.input<typeof SettingsUpdate>;

export interface ServerInfo {
	name: string;
	version: string;
	gateway: { url: string; ok: boolean; error: string | null; models: number };
	timezone: string;
	dataDir: string;
	authRequired: boolean;
}

// ---------------------------------------------------------------- usage

/** What a model call was for: a bot's reply (with its tools and advisors), or background work (titles, memory…). */
export type UsagePurpose = "reply" | "background";

/** A price you set for a model, in US dollars per million tokens. */
export const ModelPrice = z.object({
	input: z.number().min(0).max(10_000),
	output: z.number().min(0).max(10_000),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export interface UsageTotals {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
	/** US dollars, for the models you set a price for; null when none has one. */
	cost: number | null;
}

/** Whose usage a report covers: yours, everyone's (admins), or one person's (admins). */
export type UsageScope = "me" | "all" | (string & {});

/** One bar of a usage chart: an hour or a day. */
export interface UsageBucket extends UsageTotals {
	/** "2026-11-17" or "2026-11-17 14" (in the report's time zone). */
	key: string;
	/** When it starts (ms). */
	start: number;
	reply: number;
	background: number;
	/** Tokens by model and by bot (the top ones; the rest under "other"). */
	models: Record<string, number>;
	agents: Record<string, number>;
	/** Cost by model, for the ones with a price. */
	costs: Record<string, number>;
}

export interface UsageReport {
	from: number;
	to: number;
	timezone: string;
	scope: { kind: "me" | "all" | "user"; userId: string | null; name: string };
	/** Bars are hours for a day or two, days otherwise. */
	bucket: "hour" | "day";
	buckets: UsageBucket[];
	/** The same length of time just before, to compare. */
	previous: UsageTotals;
	/** Tokens by weekday (0 = Monday) and hour, over the whole range. */
	heatmap: number[][];
	/** The models and bots the charts stack (most used first). */
	topModels: string[];
	topAgents: { id: string; name: string }[];
	/** Admins looking at everyone: per person. */
	byUser: (UsageTotals & { userId: string | null; name: string; role: string | null })[];
	/** Your role's limits and how much of them is used (null for admins and everyone's view). */
	limits: {
		tokensPerDay: number | null;
		tokensPerMonth: number | null;
		costPerMonth: number | null;
		tokensToday: number;
		tokensMonth: number;
		costMonth: number | null;
	} | null;
	totals: UsageTotals;
	/** One entry per day (in your time zone), oldest first, including days without use. */
	daily: (UsageTotals & { date: string; reply: number; background: number })[];
	byAgent: (UsageTotals & { agentId: string | null; name: string })[];
	byModel: (UsageTotals & { model: string; price: ModelPrice | null })[];
	byPurpose: (UsageTotals & { purpose: UsagePurpose })[];
	/** Replies and routines: how many, how they ended, how long they took. */
	runs: {
		total: number;
		done: number;
		error: number;
		cancelled: number;
		avgSeconds: number | null;
		byTrigger: { trigger: string; count: number }[];
	};
	prices: Record<string, ModelPrice>;
}
