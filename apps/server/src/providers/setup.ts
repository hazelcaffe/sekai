import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	joinCommandLine,
	PROVIDER_PRESETS,
	type Provider,
	type ProviderSetup,
	type ProviderWithStatus,
	SIGN_IN_CLAUDE,
	SIGN_IN_TARGET,
} from "@sekai/shared";
import { badRequest } from "../lib/errors.ts";
import { providerDir, providerEnv, withTools } from "./process.ts";
import { checkSignInCommand, type PublicProvider, providerStatus, requireProvider } from "./store.ts";
import { inspectTool } from "./tools.ts";

/**
 * Works out what a subscription still needs to be set up (tools, sign-in command, isolated config folder) and
 * resolves the exact argv array that "Sign in" will run in the browser terminal — never through a shell.
 */

let cachedBundledClaude: string | null | undefined;

/** Finds the native `claude` executable shipped inside `@anthropic-ai/claude-agent-sdk`, if present. */
export function bundledClaudePath(): string | null {
	if (cachedBundledClaude !== undefined) return cachedBundledClaude;
	const binName = process.platform === "win32" ? "claude.exe" : "claude";
	const candidates =
		process.platform === "linux"
			? [
					`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
					`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl`,
				]
			: [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];
	try {
		const req = createRequire(import.meta.resolve("@anthropic-ai/claude-agent-sdk"));
		for (const pkg of candidates) {
			try {
				const pkgJson = req.resolve(`${pkg}/package.json`);
				const bin = join(dirname(pkgJson), binName);
				if (existsSync(bin)) {
					cachedBundledClaude = bin;
					return bin;
				}
			} catch {}
		}
	} catch {}
	cachedBundledClaude = null;
	return null;
}

export interface ResolvedSignIn {
	/** Exact argv array spawned directly with Bun.spawn (never a shell). */
	argv: string[];
	/** Extra env variables advertised by an ACP terminal auth method. */
	extraEnv: Record<string, string>;
	/** Human-readable command text shown in the UI. */
	display: string;
}

/**
 * Resolves the exact argv array to spawn for signing in a subscription:
 *   1. An advertised ACP "terminal" auth method (`methodId`)
 *   2. An admin-set custom `signInCommand`
 *   3. The preset's `signInCommand` (expanding `CLAUDE_CODE` and `TARGET`)
 * Always checked by `checkSignInCommand` so no shell or interpreter can be invoked.
 */
export function resolveSignInCommand(
	provider: Provider,
	opts: { methodId?: string; target?: string; requireTarget?: boolean } = {},
): ResolvedSignIn | null {
	const preset = PROVIDER_PRESETS[provider.preset];

	if (opts.methodId) {
		const status = providerStatus(provider.id);
		const method = status.authMethods.find((m) => m.id === opts.methodId && m.terminal);
		if (!method) throw badRequest("That sign-in method isn't available right now.");
		if (!provider.command) throw badRequest("Set the agent's command first.");
		const argv = checkSignInCommand([provider.command, ...(method.args ?? provider.args)]);
		return {
			argv,
			extraEnv: method.env ?? {},
			display: joinCommandLine(argv),
		};
	}

	if (provider.signInCommand.length > 0) {
		const argv = checkSignInCommand(provider.signInCommand);
		return {
			argv,
			extraEnv: {},
			display: joinCommandLine(argv),
		};
	}

	if (preset.signInCommand.length === 0) return null;

	const argv: string[] = [];
	const displayArgv: string[] = [];
	for (const part of preset.signInCommand) {
		if (part === SIGN_IN_CLAUDE) {
			const claudeBin =
				provider.command.trim() ||
				bundledClaudePath() ||
				Bun.which("claude", { PATH: withTools(process.env.PATH) }) ||
				"claude";
			argv.push(claudeBin);
			displayArgv.push(provider.command.trim() || "claude");
		} else if (part === SIGN_IN_TARGET) {
			const targets = preset.signInTargets ?? [];
			if (opts.target) {
				const ok = targets.some((t) => t.id === opts.target);
				if (!ok) throw badRequest(`"${opts.target}" isn't one of ${preset.title}'s sign-in providers.`);
				argv.push(opts.target);
				displayArgv.push(opts.target);
			} else if (opts.requireTarget) {
				throw badRequest(`Pick a provider to sign in to for ${preset.title} first.`);
			} else {
				argv.push("<provider>");
				displayArgv.push("<provider>");
			}
		} else {
			argv.push(part);
			displayArgv.push(part);
		}
	}

	checkSignInCommand(argv);
	return {
		argv,
		extraEnv: {},
		display: joinCommandLine(displayArgv),
	};
}

/** Checks whether the resolved sign-in executable can actually be launched on this server. */
export function findSignInExecutable(provider: Provider, program: string): string | null {
	if (program.includes("/") || program.includes("\\")) {
		return existsSync(program) ? program : null;
	}
	const envPath = withTools(provider.env.PATH ?? process.env.PATH);
	return Bun.which(program, { PATH: envPath }) ?? null;
}

/** Computes the live setup summary attached to every provider sent to the app. */
export async function providerSetup(
	provider: Provider,
	opts: { isAdmin: boolean; isSigningIn?: (id: string) => boolean },
): Promise<ProviderSetup> {
	const preset = PROVIDER_PRESETS[provider.preset];
	const envPath = provider.env.PATH ?? process.env.PATH;
	const tools = await Promise.all(
		preset.tools.map((t) => inspectTool(t.id, t.role, { isAdmin: opts.isAdmin, envPath })),
	);

	const status = providerStatus(provider.id);
	const terminalMethod = status.authMethods.find((m) => m.terminal);
	let signIn: string | null = null;
	let signInBlocked: string | null = null;

	try {
		const resolved = resolveSignInCommand(provider, { requireTarget: false });
		if (resolved) {
			signIn = resolved.display;
			const prog = resolved.argv[0] ?? "";
			const missingSigninTool = tools.find(
				(t) => !t.installed && (t.role === "signin" || prog === t.id || prog.endsWith(`/${t.id}`)),
			);
			const missingAnyTool = tools.find((t) => !t.installed);
			if (missingSigninTool) {
				signInBlocked = missingSigninTool.unavailable
					? missingSigninTool.unavailable
					: `Install ${missingSigninTool.title} first.`;
			} else if (!findSignInExecutable(provider, prog)) {
				signInBlocked = missingAnyTool
					? missingAnyTool.unavailable || `Install ${missingAnyTool.title} first.`
					: `"${prog}" isn't installed on this server yet.`;
			}
		} else if (terminalMethod?.terminal) {
			signIn = terminalMethod.terminal;
			if (provider.command && !findSignInExecutable(provider, provider.command)) {
				signInBlocked = `"${provider.command}" isn't installed on this server yet.`;
			}
		} else {
			signInBlocked =
				provider.preset === "custom"
					? "Set a sign-in command under Advanced to sign in from the browser."
					: "This subscription doesn't have an interactive sign-in command.";
		}
	} catch (err) {
		signInBlocked = err instanceof Error ? err.message : "Sign-in command isn't valid.";
	}

	return {
		tools,
		signIn,
		signInBlocked,
		folder: opts.isAdmin && provider.ownConfig ? providerDir(provider.id) : null,
		signingIn: opts.isSigningIn?.(provider.id) ?? false,
	};
}

/** Attaches `setup` to a `PublicProvider` to produce the full `ProviderWithStatus` sent to clients. */
export async function withSetup(
	pub: PublicProvider,
	opts: { isAdmin: boolean; isSigningIn?: (id: string) => boolean },
): Promise<ProviderWithStatus> {
	const full = requireProvider(pub.id);
	// Touch providerEnv only when starting processes; providerSetup does not create directories on GET.
	void providerEnv;
	return {
		...pub,
		setup: await providerSetup(full, opts),
	};
}
