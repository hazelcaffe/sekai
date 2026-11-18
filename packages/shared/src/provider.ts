import { z } from "zod";

/**
 * BYOS (bring your own subscription): run an agent CLI you've installed and signed in to yourself (Codex,
 * Claude Code, Grok Build, Gemini CLI, Devin, Antigravity, Muse Code, or any ACP agent) as a bot's brain.
 * Sekai never handles your subscription credentials: the CLI keeps its own sign-in.
 */
export const PROVIDER_KINDS = ["acp", "claude-sdk"] as const;
export const ProviderKind = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const PROVIDER_PRESET_IDS = [
	"codex",
	"claude",
	"grok",
	"gemini",
	"devin",
	"antigravity",
	"muse",
	"custom",
] as const;
export const ProviderPresetId = z.enum(PROVIDER_PRESET_IDS);
export type ProviderPresetId = z.infer<typeof ProviderPresetId>;

export interface ProviderPreset {
	id: ProviderPresetId;
	kind: ProviderKind;
	title: string;
	vendor: string;
	description: string;
	/** Executable and arguments. For claude-sdk, command optionally points at a Claude Code binary. */
	command: string;
	args: string[];
	env: Record<string, string>;
	/** How to sign in, on the machine that runs the Sekai server. */
	signIn: string;
	docsUrl: string;
	/** Models to offer when the agent doesn't report its own. */
	models: { id: string; name: string }[];
}

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
	codex: {
		id: "codex",
		kind: "acp",
		title: "Codex",
		vendor: "OpenAI · ChatGPT",
		description: "Your ChatGPT plan through the Codex agent (ACP adapter).",
		command: "npx",
		args: ["-y", "@agentclientprotocol/codex-acp@latest"],
		env: {},
		signIn: "Install the Codex CLI and run `codex login` (Sign in with ChatGPT), or set OPENAI_API_KEY below.",
		docsUrl: "https://github.com/agentclientprotocol/codex-acp",
		models: [],
	},
	claude: {
		id: "claude",
		kind: "claude-sdk",
		title: "Claude",
		vendor: "Anthropic",
		description: "Claude through the Claude Agent SDK, using the Claude Code setup on this machine.",
		command: "",
		args: [],
		env: {},
		signIn: "Install Claude Code and sign in (`claude auth login`), or set ANTHROPIC_API_KEY below. Anthropic's terms don't allow third-party apps to offer claude.ai login; Sekai doesn't, it only drives the Claude Code you set up yourself. Prefer an API key if anyone else uses this Sekai.",
		docsUrl: "https://code.claude.com/docs/en/agent-sdk/overview",
		models: [
			{ id: "opus", name: "Claude Opus (latest)" },
			{ id: "sonnet", name: "Claude Sonnet (latest)" },
			{ id: "haiku", name: "Claude Haiku (latest)" },
		],
	},
	grok: {
		id: "grok",
		kind: "acp",
		title: "Grok Build",
		vendor: "xAI",
		description: "Your Grok plan through the official Grok Build CLI.",
		command: "npx",
		args: ["-y", "@xai-official/grok@latest", "agent", "stdio"],
		env: {},
		signIn: "Run `grok login` (or `grok login --device-auth` on a headless machine).",
		docsUrl: "https://x.ai/cli",
		models: [],
	},
	gemini: {
		id: "gemini",
		kind: "acp",
		title: "Gemini CLI",
		vendor: "Google",
		description: "Your Google account or Gemini plan through the official Gemini CLI.",
		command: "npx",
		args: ["-y", "@google/gemini-cli@latest", "--acp"],
		env: {},
		signIn: "Run `gemini` once and choose Sign in with Google, or set GEMINI_API_KEY below.",
		docsUrl: "https://geminicli.com",
		models: [],
	},
	devin: {
		id: "devin",
		kind: "acp",
		title: "Devin",
		vendor: "Cognition",
		description: "Your Devin plan through the Devin CLI's ACP mode.",
		command: "devin",
		args: ["acp"],
		env: {},
		signIn: "Install the Devin CLI (docs.devin.ai/cli) and sign in with it first.",
		docsUrl: "https://docs.devin.ai/cli",
		models: [],
	},
	antigravity: {
		id: "antigravity",
		kind: "acp",
		title: "Antigravity",
		vendor: "Google",
		description: "Google Antigravity's agent through its ACP server.",
		command: "agy_acp_server.par",
		args: [],
		env: {},
		signIn: "Download the Antigravity ACP server for your platform, set its path above, and sign in with Google when asked.",
		docsUrl: "https://antigravity.google/docs/ide/extensions",
		models: [],
	},
	muse: {
		id: "muse",
		kind: "acp",
		title: "Muse Code",
		vendor: "Meta",
		description: "Meta's Muse Code agent (built for Muse Spark).",
		command: "muse",
		args: ["acp"],
		env: { MUSE_EXPERIMENTAL_ACP: "on" },
		signIn: "Install Muse Code and run `muse login`.",
		docsUrl: "https://dev.meta.ai/docs/muse-code",
		models: [],
	},
	custom: {
		id: "custom",
		kind: "acp",
		title: "Custom ACP agent",
		vendor: "Any",
		description: "Any agent that speaks the Agent Client Protocol over stdio.",
		command: "",
		args: [],
		env: {},
		signIn: "Follow the agent's own sign-in instructions.",
		docsUrl: "https://agentclientprotocol.com/get-started/registry",
		models: [],
	},
};

export const Provider = z.object({
	id: z.string(),
	preset: ProviderPresetId,
	kind: ProviderKind,
	title: z.string(),
	enabled: z.boolean(),
	command: z.string(),
	args: z.array(z.string()),
	/** Environment for the agent process (API keys, base URLs). Values are masked when read back. */
	env: z.record(z.string(), z.string()),
	/** Extra model IDs to offer, for agents that don't list them. */
	extraModels: z.array(z.string()),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Provider = z.infer<typeof Provider>;

export const ProviderCreate = z.object({
	preset: ProviderPresetId,
	title: z.string().trim().max(80).optional(),
	enabled: z.boolean().default(true),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).default({}),
	extraModels: z.array(z.string().trim().min(1)).default([]),
});
export type ProviderCreate = z.input<typeof ProviderCreate>;

export const ProviderUpdate = z
	.object({
		title: z.string().trim().min(1).max(80),
		enabled: z.boolean(),
		command: z.string(),
		args: z.array(z.string()),
		env: z.record(z.string(), z.string()),
		extraModels: z.array(z.string().trim().min(1)),
	})
	.partial();
export type ProviderUpdate = z.input<typeof ProviderUpdate>;

export interface ProviderModel {
	/** The provider's own model value. */
	id: string;
	name: string;
	description: string | null;
}

export interface ProviderStatus {
	providerId: string;
	state: "unchecked" | "checking" | "ready" | "auth_required" | "error";
	error: string | null;
	agentName: string | null;
	agentVersion: string | null;
	models: ProviderModel[];
	/** Reasoning levels the agent offers (ACP thought_level option or Claude effort). */
	thinking: string[];
	/** Sign-in methods the agent advertises (ACP). "terminal" methods must be run in a terminal by you. */
	authMethods: { id: string; name: string; description: string | null; terminal: string | null }[];
	/** Who the agent is signed in as, when it says (Claude: email or key source). */
	account: string | null;
	/** Whether the agent accepts images in prompts. */
	vision: boolean;
	checkedAt: number | null;
}

export type ProviderWithStatus = Provider & { status: ProviderStatus };

/** Model IDs for BYOS providers look like "prv_abc123::gpt-5.3-codex" (or just "prv_abc123" for the default). */
export const BYOS_SEPARATOR = "::";

export function parseByosModel(model: string): { providerId: string; model: string | null } | null {
	if (!model.startsWith("prv_")) return null;
	const at = model.indexOf(BYOS_SEPARATOR);
	return at < 0
		? { providerId: model, model: null }
		: { providerId: model.slice(0, at), model: model.slice(at + BYOS_SEPARATOR.length) || null };
}

export function byosModelId(providerId: string, model: string | null): string {
	return model ? `${providerId}${BYOS_SEPARATOR}${model}` : providerId;
}

export function isByosModel(model: string): boolean {
	return model.startsWith("prv_");
}
