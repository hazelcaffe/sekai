import { rm } from "node:fs/promises";
import {
	byosModelId,
	type ModelInfo,
	PROVIDER_PRESETS,
	type Provider,
	ProviderCreate,
	type ProviderCreate as ProviderCreateInput,
	type ProviderStatus,
	ProviderUpdate,
	type ProviderUpdate as ProviderUpdateInput,
	type ProviderWithStatus,
	parseByosModel,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "@sekai/shared";
import { eq, sql } from "drizzle-orm";
import { type Db, db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { maskSecret } from "../services/settings.ts";
import { providerDir } from "./process.ts";

/** In-memory copy of every provider, so the model catalog and labels can be read synchronously. */
let cache = new Map<string, Provider>();
const statuses = new Map<string, ProviderStatus>();
const listeners = new Set<(providerId: string, removed: boolean) => void>();

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|COOKIE)/i;

export function emptyStatus(providerId: string): ProviderStatus {
	return {
		providerId,
		state: "unchecked",
		error: null,
		agentName: null,
		agentVersion: null,
		models: [],
		thinking: [],
		authMethods: [],
		account: null,
		vision: false,
		checkedAt: null,
	};
}

export function providerStatus(id: string): ProviderStatus {
	return statuses.get(id) ?? emptyStatus(id);
}

/** Whether an environment variable's value is a secret (sealed at rest, masked for the app). */
export function isSecretEnv(key: string): boolean {
	return SECRET_KEY.test(key);
}

/** Secret values are sealed in the database; the rest stay readable. */
export function sealEnv(env: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).map(([k, v]) => [k, isSecretEnv(k) && v && !isSealed(v) ? seal(v) : v]),
	);
}

export function unsealEnv(env: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).map(([k, v]) => {
			if (!isSealed(v)) return [k, v];
			try {
				return [k, unseal(v)];
			} catch {
				// Sealed with another key (a restore without its secret.key): unusable, so blank rather than garbage.
				return [k, ""];
			}
		}),
	);
}

function isSealed(v: string): boolean {
	return /^v1:[A-Za-z0-9+/]+=*$/.test(v);
}

function rowToProvider(row: typeof schema.providers.$inferSelect): Provider {
	const { status: _status, ...rest } = row;
	return { ...rest, env: unsealEnv(rest.env) };
}

/** A provider as the app sees it, before its setup (setup.ts) is added: secret values masked. */
export type PublicProvider = Omit<ProviderWithStatus, "setup">;

function publicProvider(p: Provider): PublicProvider {
	const env = Object.fromEntries(Object.entries(p.env).map(([k, v]) => [k, isSecretEnv(k) ? maskSecret(v) : v]));
	return { ...p, env, status: providerStatus(p.id) };
}

function changed(id: string, removed = false): void {
	bus.emit({ type: "provider.changed", providerId: id });
	for (const fn of listeners) fn(id, removed);
}

/** Called when a provider's settings change or it's removed (running agent processes must restart). */
export function onProviderChange(fn: (providerId: string, removed: boolean) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Upgrade old subscriptions in place, including when a backup predates the removal of the preset. */
export function geminiSubscriptionMigration(database: Pick<Db, "update">) {
	const providers = schema.providers;
	return database.update(providers).set({ preset: "custom" }).where(sql`${providers.preset} = ${"gemini"}`);
}

export async function loadProviders(): Promise<void> {
	await geminiSubscriptionMigration(db);
	const rows = await db.select().from(schema.providers);
	cache = new Map(rows.map((r) => [r.id, rowToProvider(r)]));
	for (const r of rows) {
		// A check that was running when the server stopped never finished.
		const s = r.status ?? emptyStatus(r.id);
		statuses.set(r.id, s.state === "checking" ? { ...s, state: "unchecked" } : s);
		// API keys saved before they were sealed get sealed now.
		const sealed = sealEnv(r.env);
		if (JSON.stringify(sealed) !== JSON.stringify(r.env)) {
			await db.update(schema.providers).set({ env: sealed }).where(eq(schema.providers.id, r.id));
		}
	}
}

export function getProvider(id: string): Provider | null {
	return cache.get(id) ?? null;
}

export function requireProvider(id: string): Provider {
	const p = cache.get(id);
	if (!p) throw notFound("Subscription");
	return p;
}

export function listProviders(): PublicProvider[] {
	return [...cache.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicProvider);
}

export function publicProviderById(id: string): PublicProvider {
	return publicProvider(requireProvider(id));
}

export async function createProvider(input: ProviderCreateInput): Promise<PublicProvider> {
	const data = parse(ProviderCreate, input);
	const preset = PROVIDER_PRESETS[data.preset];
	const command = (data.command ?? preset.command).trim();
	if (preset.kind === "acp" && !command) throw badRequest("Enter the command that starts it");
	const now = Date.now();
	const provider: Provider = {
		id: newId("prv"),
		preset: data.preset,
		kind: preset.kind,
		title: data.title?.trim() || preset.title,
		enabled: data.enabled,
		command,
		args: data.args ?? preset.args,
		env: { ...preset.env, ...cleanEnv(data.env) },
		extraModels: data.extraModels,
		signInCommand: checkSignInCommand(data.signInCommand),
		ownConfig: data.ownConfig,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.providers).values({ ...provider, env: sealEnv(provider.env), status: null });
	cache.set(provider.id, provider);
	changed(provider.id);
	return publicProvider(provider);
}

/** Shells and launchers that would turn "Sign in" into a terminal for anything. */
const SHELLS =
	/^(ba|da|z|k|c|tc|fi|a|mk|yash|r|n|x)?sh$|^(pwsh|powershell|cmd|busybox|env|sudo|su|doas|script|tmux|screen|xterm|nohup|setsid|exec|eval|python[\d.]*|perl|ruby|node|bun|deno|php|lua|tclsh|wish|expect|socat|nc|ncat|telnet|ssh)(\.exe)?$/i;

/**
 * An admin's sign-in command: an argv run without a shell, so nothing in it is expanded. A shell or a script
 * interpreter as the program would make the browser's sign-in terminal a general one, so those are refused.
 */
export function checkSignInCommand(argv: string[]): string[] {
	if (argv.length === 0) return [];
	const [program = ""] = argv;
	if (argv.some((a) => a.includes("\0"))) throw badRequest("The sign-in command has a character it can't run.");
	const name = program.split(/[\\/]/).pop() ?? "";
	if (!name || name.startsWith("-")) throw badRequest("Start the sign-in command with the program to run.");
	if (SHELLS.test(name)) {
		throw badRequest(
			`The sign-in command can't be ${name}: it has to be the agent's own sign-in, not a shell or an interpreter.`,
		);
	}
	return argv;
}

function cleanEnv(env: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		const key = k.trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw badRequest(`"${k}" isn't a valid environment variable name`);
		out[key] = v;
	}
	return out;
}

export async function updateProvider(id: string, input: ProviderUpdateInput): Promise<PublicProvider> {
	const patch = parse(ProviderUpdate, input);
	const current = requireProvider(id);
	let env = current.env;
	if (patch.env) {
		// Secret values come back masked: keep the stored one unless a real new value was sent.
		env = {};
		for (const [k, v] of Object.entries(cleanEnv(patch.env))) {
			const masked = isSecretEnv(k) && (v === maskSecret(current.env[k] ?? "") || v === "••••");
			env[k] = masked ? (current.env[k] ?? "") : v;
		}
	}
	const next: Provider = {
		...current,
		...patch,
		command: patch.command?.trim() ?? current.command,
		signInCommand:
			patch.signInCommand !== undefined ? checkSignInCommand(patch.signInCommand) : current.signInCommand,
		env,
		updatedAt: Date.now(),
	};
	await db
		.update(schema.providers)
		.set({ ...next, env: sealEnv(next.env) })
		.where(eq(schema.providers.id, id));
	cache.set(id, next);
	changed(id);
	return publicProvider(next);
}

export async function deleteProvider(id: string): Promise<void> {
	requireProvider(id);
	await db.delete(schema.providers).where(eq(schema.providers.id, id));
	cache.delete(id);
	statuses.delete(id);
	// Remove this subscription's own sign-in folder if it had one (shared server credentials stay untouched).
	await rm(providerDir(id), { recursive: true, force: true }).catch(() => {});
	changed(id, true);
}

export async function setProviderStatus(id: string, patch: Partial<ProviderStatus>): Promise<ProviderStatus> {
	const next = { ...providerStatus(id), ...patch, providerId: id };
	statuses.set(id, next);
	if (cache.has(id)) {
		await db.update(schema.providers).set({ status: next }).where(eq(schema.providers.id, id));
		bus.emit({ type: "provider.changed", providerId: id });
	}
	return next;
}

// ---------------------------------------------------------------- models

function toThinking(levels: string[]): ThinkingLevel[] {
	return levels.filter((l): l is ThinkingLevel => (THINKING_LEVELS as readonly string[]).includes(l));
}

/** Models a provider offers: what its agent reported, the preset's list, and any you added. */
function modelsOf(p: Provider): { id: string; name: string }[] {
	const status = providerStatus(p.id);
	const reported = status.models.map((m) => ({ id: m.id, name: m.name }));
	const base = reported.length ? reported : PROVIDER_PRESETS[p.preset].models;
	const extra = p.extraModels.filter((id) => !base.some((m) => m.id === id)).map((id) => ({ id, name: id }));
	return [...base, ...extra];
}

/** Model-picker entries for every enabled provider: its default model first, then the ones it offers. */
export function providerModels(): ModelInfo[] {
	const out: ModelInfo[] = [];
	for (const p of cache.values()) {
		if (!p.enabled) continue;
		const status = providerStatus(p.id);
		const base = {
			provider: p.title,
			contextWindow: 200_000,
			maxOutputTokens: 32_000,
			thinkingLevels: toThinking(status.thinking),
			vision: status.vision,
			byos: { providerId: p.id, providerTitle: p.title, preset: p.preset },
		};
		out.push({ ...base, id: byosModelId(p.id, null), name: `${p.title} · Default model` });
		for (const m of modelsOf(p)) out.push({ ...base, id: byosModelId(p.id, m.id), name: `${p.title} · ${m.name}` });
	}
	return out;
}

export function providerModelInfo(id: string): ModelInfo | undefined {
	return parseByosModel(id) ? providerModels().find((m) => m.id === id) : undefined;
}

/** "Codex · gpt-5.3-codex" for subscription models; the id itself for gateway models. */
export function modelLabel(id: string): string {
	const byos = parseByosModel(id);
	if (!byos) return id;
	const p = cache.get(byos.providerId);
	if (!p) return "a removed subscription";
	const name = byos.model ? (modelsOf(p).find((m) => m.id === byos.model)?.name ?? byos.model) : "default model";
	return `${p.title} · ${name}`;
}
