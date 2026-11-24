import { z } from "zod";

/**
 * BYOS (bring your own subscription): run an agent CLI you've installed and signed in to yourself (Codex,
 * Claude Code, Grok Build, OpenCode, Pi, Devin, Antigravity, Muse Code, or any ACP agent) as a bot's model.
 * Sekai never handles your subscription credentials: the CLI keeps its own sign-in. Sekai can install the CLI into
 * its own tools folder and run the CLI's own sign-in in a terminal in the browser.
 */
export const PROVIDER_KINDS = ["acp", "claude-sdk"] as const;
export const ProviderKind = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const PROVIDER_PRESET_IDS = [
	"codex",
	"claude",
	"grok",
	"opencode",
	"pi",
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
	/**
	 * The sign-in command Sekai runs in a terminal in the browser (an argv, never through a shell). Empty when
	 * there's none. `CLAUDE_CODE` stands for the Claude Code that ships with Sekai (or the subscription's own
	 * executable); `TARGET` for one of `signInTargets`, picked when signing in.
	 */
	signInCommand: string[];
	/** What `TARGET` in the sign-in command can be (Pi signs in to one of its providers at a time). */
	signInTargets?: { id: string; name: string; account?: boolean }[];
	/** One line shown above the terminal: what to do in it. */
	signInHint?: string;
	/** Command-line tools it needs on this server, which Sekai can install (see PROVIDER_TOOLS). */
	tools: { id: ProviderToolId; role: "agent" | "signin" }[];
	/**
	 * Environment variables that point the CLI at a folder of its own (subfolders of the subscription's folder
	 * under `<data>/providers/<id>/`), so each subscription keeps its own sign-in.
	 */
	configDirs: Record<string, string>;
	docsUrl: string;
	/** Models to offer when the agent doesn't report its own. */
	models: { id: string; name: string }[];
}

export const PROVIDER_TOOL_IDS = [
	"codex-acp",
	"codex",
	"grok",
	"opencode",
	"pi",
	"pi-acp",
	"devin",
	"muse",
	"antigravity",
] as const;
export type ProviderToolId = (typeof PROVIDER_TOOL_IDS)[number];

/**
 * How Sekai installs a tool into its own tools folder (`<data>/tools`, first on agents' PATH): an npm package at a
 * known-good version ("latest" only where the CLI changes too fast to pin, with `unpinned` saying why), the
 * CLI's official installer (downloaded from `url` and run with bash, never piped from the network), or not at all.
 */
export type ToolInstall =
	| {
			kind: "npm";
			package: string;
			version: string;
			unpinned?: string;
			/** The Node.js it needs, when it runs on Node. */
			node?: string;
	  }
	| {
			kind: "script";
			url: string;
			/** Arguments for the installer (`VERSION` is replaced by the pinned version). */
			args: string[];
			version: string;
			unpinned?: string;
			/** Where the installer puts the binary, relative to its HOME. */
			binPath: string;
			/** Environment for the installer (`DIR` is replaced by the tool's own folder). */
			env: Record<string, string>;
	  }
	| { kind: "manual"; reason: string };

export interface ProviderTool {
	id: ProviderToolId;
	title: string;
	/** The executable's name on PATH. */
	bin: string;
	install: ToolInstall;
	docsUrl: string;
}

export const PROVIDER_TOOLS: Record<ProviderToolId, ProviderTool> = {
	"codex-acp": {
		id: "codex-acp",
		title: "Codex ACP adapter",
		bin: "codex-acp",
		install: { kind: "npm", package: "@agentclientprotocol/codex-acp", version: "2.10.0" },
		docsUrl: "https://github.com/agentclientprotocol/codex-acp",
	},
	codex: {
		id: "codex",
		title: "Codex CLI",
		bin: "codex",
		install: { kind: "npm", package: "@openai/codex", version: "0.171.0" },
		docsUrl: "https://developers.openai.com/codex/cli",
	},
	grok: {
		id: "grok",
		title: "Grok Build",
		bin: "grok",
		install: {
			kind: "npm",
			package: "@xai-official/grok",
			version: "latest",
			unpinned: "xAI ships Grok Build almost daily and its service expects a recent version.",
		},
		docsUrl: "https://x.ai/cli",
	},
	opencode: {
		id: "opencode",
		title: "OpenCode",
		bin: "opencode",
		install: {
			kind: "script",
			url: "https://opencode.ai/v2/install",
			args: ["--version", "VERSION", "--no-modify-path"],
			version: "2.4.1",
			binPath: ".opencode/bin/opencode",
			env: { HOME: "DIR" },
		},
		docsUrl: "https://opencode.ai/v2/docs/",
	},
	pi: {
		id: "pi",
		title: "Pi",
		bin: "pi",
		install: { kind: "npm", package: "@earendil-works/pi-coding-agent", version: "1.6.0", node: "22.19.0" },
		docsUrl: "https://docs.pi.dev/latest/",
	},
	"pi-acp": {
		id: "pi-acp",
		title: "Pi ACP adapter",
		bin: "pi-acp",
		install: { kind: "npm", package: "pi-acp", version: "0.0.35", node: "20.0.0" },
		docsUrl: "https://github.com/svkozak/pi-acp",
	},
	devin: {
		id: "devin",
		title: "Devin CLI",
		bin: "devin",
		install: {
			kind: "script",
			url: "https://cli.devin.ai/install.sh",
			args: [],
			version: "latest",
			unpinned: "Devin CLI's official installer installs the latest promoted release.",
			binPath: ".local/bin/devin",
			env: { HOME: "DIR", XDG_DATA_HOME: "DIR/share" },
		},
		docsUrl: "https://docs.devin.ai/cli",
	},
	muse: {
		id: "muse",
		title: "Muse Code",
		bin: "muse",
		install: {
			kind: "script",
			url: "https://dev.meta.ai/install.sh",
			args: [],
			version: "latest",
			unpinned: "Muse Code's official installer ships a self-updating launcher.",
			binPath: "bin/muse",
			env: { HOME: "DIR", MUSE_INSTALL_DIR: "DIR/bin", XDG_CONFIG_HOME: "DIR/config" },
		},
		docsUrl: "https://dev.meta.ai/docs/muse-code",
	},
	antigravity: {
		id: "antigravity",
		title: "Antigravity ACP server",
		bin: "agy_acp_server.par",
		install: {
			kind: "manual",
			reason: "Antigravity's ACP server is a manual download for your platform without a CLI installer. Download it from its docs and set its path under Advanced.",
		},
		docsUrl: "https://antigravity.google/docs/ide/extensions",
	},
};

/** Placeholders in a preset's sign-in command. */
export const SIGN_IN_CLAUDE = "CLAUDE_CODE";
export const SIGN_IN_TARGET = "TARGET";

/** Pi's providers (`pi auth login <provider>`, Pi 1.6): the ones with an account sign-in first. */
const PI_TARGETS: { id: string; name: string; account?: boolean }[] = [
	{ id: "anthropic", name: "Claude Pro or Max (Anthropic)", account: true },
	{ id: "openai-codex", name: "ChatGPT Plus or Pro (OpenAI Codex)", account: true },
	{ id: "github-copilot", name: "GitHub Copilot", account: true },
	...[
		["amazon-bedrock", "Amazon Bedrock"],
		["ant-ling", "Ant Ling"],
		["azure", "Azure OpenAI"],
		["baseten", "Baseten"],
		["cerebras", "Cerebras"],
		["cloudflare-ai-gateway", "Cloudflare AI Gateway"],
		["cloudflare-workers-ai", "Cloudflare Workers AI"],
		["deepseek", "DeepSeek"],
		["fireworks", "Fireworks"],
		["google", "Google Gemini"],
		["google-vertex", "Google Vertex AI"],
		["groq", "Groq"],
		["huggingface", "Hugging Face"],
		["kimi-coding", "Kimi For Coding"],
		["meta", "Meta"],
		["minimax", "MiniMax"],
		["minimax-cn", "MiniMax (China)"],
		["mistral", "Mistral"],
		["moonshotai", "Moonshot AI"],
		["moonshotai-cn", "Moonshot AI (China)"],
		["nvidia", "NVIDIA NIM"],
		["openai", "OpenAI (API key)"],
		["opencode", "OpenCode Zen"],
		["opencode-go", "OpenCode Go"],
		["openrouter", "OpenRouter"],
		["qwen-token-plan", "Qwen Token Plan"],
		["qwen-token-plan-cn", "Qwen Token Plan (China)"],
		["qwen-token-plan-individual", "Qwen Individual"],
		["qwen-token-plan-individual-cn", "Qwen Individual (China)"],
		["radius", "Radius"],
		["together", "Together AI"],
		["typesafe", "TypeSafe"],
		["vercel-ai-gateway", "Vercel AI Gateway"],
		["xai", "xAI"],
		["xiaomi", "Xiaomi MiMo"],
		["xiaomi-token-plan-ams", "Xiaomi MiMo Token Plan (Amsterdam)"],
		["xiaomi-token-plan-cn", "Xiaomi MiMo Token Plan (China)"],
		["xiaomi-token-plan-sgp", "Xiaomi MiMo Token Plan (Singapore)"],
		["zai", "ZAI Coding Plan"],
		["zai-coding-cn", "ZAI Coding Plan (China)"],
	].map(([id = "", name = ""]) => ({ id, name })),
];

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
	codex: {
		id: "codex",
		kind: "acp",
		title: "Codex",
		vendor: "OpenAI · ChatGPT",
		description: "Your ChatGPT plan through the Codex agent (ACP adapter).",
		command: "codex-acp",
		args: [],
		env: {},
		signIn: "Sign in with ChatGPT using a one-time code (`codex login --device-auth`), or set OPENAI_API_KEY under Advanced. If ChatGPT says device codes are off, turn on device code sign-in for Codex in ChatGPT's security settings first.",
		signInCommand: ["codex", "login", "--device-auth"],
		signInHint: "Open the sign-in page, sign in to ChatGPT and enter the code.",
		tools: [
			{ id: "codex-acp", role: "agent" },
			{ id: "codex", role: "signin" },
		],
		configDirs: { CODEX_HOME: "codex" },
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
		signIn: "Sign in with Claude Code's own sign-in (`claude auth login`) on this server, or set ANTHROPIC_API_KEY under Advanced. Anthropic's terms don't allow third-party apps to offer claude.ai login; Sekai doesn't, it only runs Claude Code's. Prefer an API key if anyone else uses this Sekai.",
		signInCommand: [SIGN_IN_CLAUDE, "auth", "login"],
		signInHint: "Open the sign-in page, sign in, then paste the code it shows here.",
		tools: [],
		configDirs: { CLAUDE_CONFIG_DIR: "claude" },
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
		command: "grok",
		args: ["agent", "stdio"],
		env: {},
		signIn: "Sign in with a one-time code (`grok login --device-auth`), or set XAI_API_KEY under Advanced.",
		signInCommand: ["grok", "login", "--device-auth"],
		signInHint: "Open the sign-in page, sign in to your xAI account and enter the code.",
		tools: [{ id: "grok", role: "agent" }],
		configDirs: { HOME: "home" },
		docsUrl: "https://x.ai/cli",
		models: [],
	},
	opencode: {
		id: "opencode",
		kind: "acp",
		title: "OpenCode",
		vendor: "Anomaly",
		description: "Use models from the providers you connect to OpenCode.",
		command: "opencode",
		args: ["acp"],
		env: {},
		signIn: "Connect a provider with OpenCode's own sign-in (`opencode auth login`). Sekai lists the models OpenCode offers. To change its default, set `model` in `opencode.json`.",
		signInCommand: ["opencode", "auth", "login"],
		signInHint: "Pick a provider with the arrow keys and Enter, then follow its steps.",
		tools: [{ id: "opencode", role: "agent" }],
		configDirs: {
			XDG_CONFIG_HOME: "config",
			XDG_DATA_HOME: "data",
			XDG_STATE_HOME: "state",
			XDG_CACHE_HOME: "cache",
		},
		docsUrl: "https://opencode.ai/v2/docs/",
		models: [],
	},
	pi: {
		id: "pi",
		kind: "acp",
		title: "Pi",
		vendor: "Earendil Works",
		description: "Use your Pi models for chat. Pi's tools and Sekai's tools aren't available through this preset.",
		command: "pi-acp",
		args: [],
		env: {},
		signIn: "Sign in to one of Pi's providers (`pi auth login <provider>`), with an account or an API key. Pi needs Node.js 22.19 or later. For a compatible endpoint, add it to Pi's `models.json`.",
		signInCommand: ["pi", "auth", "login", SIGN_IN_TARGET, "--no-browser"],
		signInTargets: PI_TARGETS,
		signInHint: "Follow Pi's steps: open the sign-in page, then enter or paste the code.",
		tools: [
			{ id: "pi-acp", role: "agent" },
			{ id: "pi", role: "agent" },
		],
		configDirs: { PI_CODING_AGENT_DIR: "pi" },
		docsUrl: "https://docs.pi.dev/latest/models",
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
		signIn: "Sign in with a manual token (`devin auth login --force-manual-token-flow`), or set WINDSURF_API_KEY under Advanced.",
		signInCommand: ["devin", "auth", "login", "--force-manual-token-flow"],
		signInHint: "Open the sign-in page, copy your token, and paste it here.",
		tools: [{ id: "devin", role: "agent" }],
		configDirs: { HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data" },
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
		signIn: "Download the Antigravity ACP server for your platform, set its path under Advanced, and sign in with Google when asked.",
		signInCommand: [],
		tools: [{ id: "antigravity", role: "agent" }],
		configDirs: { HOME: "home" },
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
		signIn: "Sign in with Muse Code (`muse login`), or set META_API_KEY under Advanced.",
		signInCommand: ["muse", "login"],
		signInHint: "Open the sign-in page and approve the session, or paste an API key.",
		tools: [{ id: "muse", role: "agent" }],
		configDirs: { HOME: "home", XDG_CONFIG_HOME: "config" },
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
		signIn: "Set its sign-in command under Advanced to sign in from here, or follow the agent's own instructions.",
		signInCommand: [],
		tools: [],
		configDirs: { HOME: "home" },
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
	/** The admin's own sign-in command (an argv), used instead of the preset's; empty for the preset's. */
	signInCommand: z.array(z.string()),
	/** Keeps its sign-in in its own folder (`<data>/providers/<id>/`) rather than the CLI's usual place. */
	ownConfig: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Provider = z.infer<typeof Provider>;

const SignInCommand = z.array(z.string().min(1).max(1000)).max(40);

export const ProviderCreate = z.object({
	preset: ProviderPresetId,
	title: z.string().trim().max(80).optional(),
	enabled: z.boolean().default(true),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).default({}),
	extraModels: z.array(z.string().trim().min(1)).default([]),
	signInCommand: SignInCommand.default([]),
	/** New subscriptions keep their sign-in in a folder of their own. */
	ownConfig: z.boolean().default(true),
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
		signInCommand: SignInCommand,
		ownConfig: z.boolean(),
	})
	.partial();
export type ProviderUpdate = z.input<typeof ProviderUpdate>;

/**
 * Splits a command line into an argv the way a shell would quote it, but without one: single quotes keep
 * everything, double quotes and backslashes escape, nothing is expanded ($HOME, *, ~, `…`, ; and | stay
 * literal text). Returns null when a quote is left open.
 */
export function splitCommandLine(line: string): string[] | null {
	const out: string[] = [];
	let cur = "";
	let started = false;
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] as string;
		if (quote === "'") {
			if (ch === "'") quote = null;
			else cur += ch;
		} else if (quote === '"') {
			if (ch === '"') quote = null;
			else if (ch === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1] as string)) cur += line[++i];
			else cur += ch;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
			started = true;
		} else if (ch === "\\" && i + 1 < line.length) {
			cur += line[++i];
			started = true;
		} else if (/\s/.test(ch)) {
			if (started) out.push(cur);
			cur = "";
			started = false;
		} else {
			cur += ch;
			started = true;
		}
	}
	if (quote) return null;
	if (started) out.push(cur);
	return out;
}

/** An argv as one command line that splitCommandLine reads back the same. */
export function joinCommandLine(argv: string[]): string {
	return argv.map((a) => (a && /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

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
	/**
	 * Sign-in methods the agent advertises (ACP). "terminal" methods run the agent's own command with `args`
	 * (and `env`) in a terminal: Sekai opens that in the browser.
	 */
	authMethods: {
		id: string;
		name: string;
		description: string | null;
		terminal: string | null;
		args?: string[];
		env?: Record<string, string>;
	}[];
	/** Who the agent is signed in as, when it says (Claude: email or key source). */
	account: string | null;
	/** Whether the agent accepts images in prompts. */
	vision: boolean;
	checkedAt: number | null;
}

/** A tool a subscription needs, as it is on this server. */
export interface ProviderToolState {
	id: ProviderToolId;
	title: string;
	/** Runs the agent, or only signs in. */
	role: "agent" | "signin";
	/** Where it is (admins only), or null when it isn't on this server. */
	path: string | null;
	installed: boolean;
	/** Installed by Sekai into its tools folder, so Sekai can update it. */
	managed: boolean;
	version: string | null;
	/** The version Sekai installs: pinned, or "latest" for tools that change too fast to pin. */
	wanted: string | null;
	/** Why it isn't pinned, when it isn't. */
	unpinned: string | null;
	/** Sekai's copy is older than the version it installs (always offered for "latest"). */
	updateAvailable: boolean;
	/** Why Sekai can't install it here, when it can't. */
	unavailable: string | null;
	/** An install or update that's running or just ended. */
	job: ToolJob | null;
}

export interface ToolJob {
	state: "running" | "done" | "failed";
	/** What it's doing, or how it ended, in a few words. */
	step: string;
	error: string | null;
	version: string | null;
	startedAt: number;
	endedAt: number | null;
}

/** What setting a subscription up still needs, worked out by the server. */
export interface ProviderSetup {
	tools: ProviderToolState[];
	/** The command "Sign in" runs (shown as text), or null when there's none to run here. */
	signIn: string | null;
	/** Why "Sign in" can't run now (a tool to install first, no command…). */
	signInBlocked: string | null;
	/** Its own sign-in folder (admins only), when it has one. */
	folder: string | null;
	/** A sign-in is open in someone's browser right now. */
	signingIn: boolean;
}

export type ProviderWithStatus = Provider & { status: ProviderStatus; setup: ProviderSetup };

/** What POST /providers/:id/signin returns: a one-time ticket for the terminal's WebSocket. */
export interface SignInTicket {
	ticket: string;
	/** The command that runs, as text. */
	command: string;
	expiresAt: number;
}

/**
 * The sign-in terminal's WebSocket (`/api/providers/signin/<ticket>`): binary frames carry the terminal's bytes
 * both ways; text frames are these JSON messages.
 */
export type SignInServerMessage =
	| { type: "started"; command: string }
	/** A sign-in page it printed (the latest wins). */
	| { type: "link"; url: string }
	/** A one-time code it printed for you to enter on that page. */
	| { type: "code"; code: string }
	/** It's waiting for a code to be pasted back. */
	| { type: "paste" }
	| { type: "exit"; code: number | null; reason: "exited" | "timeout" | "error" | "closed"; message?: string };

export type SignInClientMessage = { type: "resize"; cols: number; rows: number } | { type: "input"; data: string };

/** How long a sign-in terminal may stay open. */
export const SIGN_IN_MAX_MS = 15 * 60_000;

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
