import {
	DEFAULT_COMPUTER_SPECS,
	DEFAULT_DEVBOX_SPECS,
	type MachineSettings,
	type Settings,
	type SettingsUpdate,
	SettingsUpdate as SettingsUpdateSchema,
} from "@sekai/shared";
import { eq } from "drizzle-orm";
import { currentActor, requirePermission } from "../auth/actor.ts";
import { config } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, parse } from "../lib/errors.ts";
import { isValidTimezone, systemTimezone } from "../lib/time.ts";
import { getPrefs, updatePrefs } from "./prefs.ts";

/** Settings that are each person's own (kept in user_prefs; the server's values are the defaults). */
const PERSONAL = new Set<keyof Settings>(["timezone", "userName", "approvalMode", "toolRules"]);

const KEY = "app";

export function defaultSettings(): Settings {
	return {
		gatewayUrl: config.gateway.url,
		gatewayApiKey: config.gateway.apiKey,
		timezone: "auto",
		userName: "",
		defaultModel: { model: "claude-sonnet-5-5", thinking: "default" },
		defaultFastModel: { model: "claude-haiku-5-5", thinking: "default" },
		contextMessageLimit: 80,
		compactionThreshold: 0.6,
		approvalMode: "auto",
		toolRules: {},
		approvalTimeoutMinutes: 30,
		refusalRetry: { enabled: true, models: [] },
		machines: defaultMachineSettings(),
	};
}

function defaultMachineSettings(): MachineSettings {
	return {
		proxmox: {
			url: process.env.PROXMOX_URL ?? "",
			tokenId: process.env.PROXMOX_TOKEN_ID ?? "",
			tokenSecret: process.env.PROXMOX_TOKEN_SECRET ?? "",
			node: process.env.PROXMOX_NODE ?? "",
			storage: process.env.PROXMOX_STORAGE ?? "local-lvm",
			imageStorage: process.env.PROXMOX_IMAGE_STORAGE ?? "local",
			bridge: process.env.PROXMOX_BRIDGE ?? "vmbr0",
			vmidStart: Number(process.env.PROXMOX_VMID_START ?? 7000),
			insecureTls: process.env.PROXMOX_INSECURE_TLS !== "0",
		},
		tailscaleAuthKey: process.env.TAILSCALE_AUTH_KEY ?? "",
		computerSpecs: DEFAULT_COMPUTER_SPECS,
		devboxSpecs: DEFAULT_DEVBOX_SPECS,
		computerBackend: "vm",
		devboxBackend: "lxc",
		devboxTtlHours: 24,
		maxDevboxesPerAgent: 3,
		agentRequests: "ask",
		screenRelay: false,
	};
}

const isMasked = (s: string) => !s || s.includes("…") || s === "••••";

let overrides: Partial<Settings> | null = null;

async function loadOverrides(): Promise<Partial<Settings>> {
	if (overrides) return overrides;
	const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, KEY) });
	overrides = (row?.value as Partial<Settings> | undefined) ?? {};
	return overrides;
}

/**
 * Effective settings with secrets in clear. Server-side only. The personal ones (name, time zone, approval mode,
 * tool rules) are those of the person Sekai is acting for.
 */
export async function getSettings(): Promise<Settings> {
	const s = await serverSettings();
	const actor = currentActor();
	if (!actor) return s;
	const p = await getPrefs(actor.userId);
	return {
		...s,
		userName: p.name,
		timezone: p.timezone,
		approvalMode: p.approvalMode ?? s.approvalMode,
		toolRules: { ...s.toolRules, ...p.toolRules },
	};
}

/** The server's own settings (no one's personal ones). */
export async function serverSettings(): Promise<Settings> {
	return withDefaults(defaultSettings(), await loadOverrides());
}

/** Saved settings over the defaults. Saved before a field existed (a machine backend, say): the default fills it in. */
export function withDefaults(base: Settings, o: Partial<Settings>): Settings {
	const merged = { ...base, ...o };
	merged.machines = {
		...base.machines,
		...o.machines,
		proxmox: { ...base.machines.proxmox, ...o.machines?.proxmox },
	};
	if (!merged.gatewayUrl) merged.gatewayUrl = config.gateway.url;
	if (!merged.gatewayApiKey) merged.gatewayApiKey = config.gateway.apiKey;
	return merged;
}

export function maskSecret(secret: string): string {
	if (!secret) return "";
	return secret.length <= 12 ? "••••" : `${secret.slice(0, 8)}…${secret.slice(-4)}`;
}

/**
 * Settings safe to send to clients. People who aren't admins don't see how the server is wired up. The default
 * models are the ones new bots would get (models on offer stand in for defaults that aren't).
 */
export async function getPublicSettings(): Promise<Settings> {
	const { availableModels, defaultModels } = await import("../agent/models.ts");
	const settings = await getSettings();
	const { primary, fast } = await defaultModels(settings, await availableModels(4000));
	const s = { ...settings, defaultModel: primary, defaultFastModel: fast };
	const actor = currentActor();
	if (actor && !actor.admin) {
		return {
			...s,
			gatewayUrl: "",
			gatewayApiKey: "",
			machines: {
				...s.machines,
				proxmox: { ...s.machines.proxmox, url: "", tokenId: "", tokenSecret: "", node: "" },
				tailscaleAuthKey: "",
			},
		};
	}
	return {
		...s,
		gatewayApiKey: maskSecret(s.gatewayApiKey),
		machines: {
			...s.machines,
			proxmox: { ...s.machines.proxmox, tokenSecret: maskSecret(s.machines.proxmox.tokenSecret) },
			tailscaleAuthKey: maskSecret(s.machines.tailscaleAuthKey),
		},
	};
}

/**
 * Saves settings: the personal ones to the acting person's own, the rest (admins only) to the server's. Sekai
 * itself (no actor, as in tests and scripts) writes everything to the server's.
 */
export async function updateSettings(input: SettingsUpdate): Promise<Settings> {
	const patch = parse(SettingsUpdateSchema, input);
	const actor = currentActor();
	if (actor) {
		if (patch.timezone !== undefined && patch.timezone !== "auto" && !isValidTimezone(patch.timezone)) {
			throw badRequest(`Unknown time zone: ${patch.timezone}`);
		}
		if (patch.userName !== undefined) {
			const name = patch.userName.trim().slice(0, 80);
			if (name) {
				await db
					.update(schema.users)
					.set({ name, updatedAt: Date.now() })
					.where(eq(schema.users.id, actor.userId));
			}
		}
		await updatePrefs(actor.userId, {
			timezone: patch.timezone,
			approvalMode: patch.approvalMode,
			toolRules: patch.toolRules,
		});
		const server = Object.fromEntries(
			Object.entries(patch).filter(([k, v]) => v !== undefined && !PERSONAL.has(k as keyof Settings)),
		) as SettingsUpdate;
		if (!Object.keys(server).length) {
			bus.emit({ type: "settings.changed" });
			return getPublicSettings();
		}
		requirePermission("admin");
		return saveServerSettings(server);
	}
	return saveServerSettings(patch);
}

async function saveServerSettings(patch: SettingsUpdate): Promise<Settings> {
	const current = await loadOverrides();
	const next: Partial<Settings> = { ...current };
	for (const [k, v] of Object.entries(patch) as [keyof Settings, Settings[keyof Settings]][]) {
		if (v === undefined) continue;
		if (k === "gatewayApiKey") {
			const s = String(v);
			// Clients only ever see the masked key; sending it back unchanged must not overwrite the real one.
			if (!s || s.includes("…") || s === "••••") continue;
		}
		if (k === "timezone" && v !== "auto" && !isValidTimezone(String(v))) {
			throw badRequest(`Unknown time zone: ${String(v)}`);
		}
		if (k === "machines") {
			// Secrets come back masked: keep the stored ones unless new ones were sent.
			const current = (await getSettings()).machines;
			const m = v as MachineSettings;
			(next as Record<string, unknown>)[k] = {
				...m,
				proxmox: {
					...m.proxmox,
					url: m.proxmox.url.trim().replace(/\/+$/, ""),
					tokenSecret: isMasked(m.proxmox.tokenSecret)
						? current.proxmox.tokenSecret
						: m.proxmox.tokenSecret.trim(),
				},
				tailscaleAuthKey: isMasked(m.tailscaleAuthKey) ? current.tailscaleAuthKey : m.tailscaleAuthKey.trim(),
			};
			continue;
		}
		if (k === "gatewayUrl") {
			const url = String(v).trim().replace(/\/+$/, "");
			(next as Record<string, unknown>)[k] = url;
			continue;
		}
		(next as Record<string, unknown>)[k] = v;
	}
	await db
		.insert(schema.settings)
		.values({ key: KEY, value: next })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
	overrides = next;
	bus.emit({ type: "settings.changed" }, { to: "everyone" });
	return getPublicSettings();
}

export async function effectiveTimezone(tz?: string | null): Promise<string> {
	if (tz && tz !== "auto" && isValidTimezone(tz)) return tz;
	const s = await getSettings();
	if (s.timezone !== "auto" && isValidTimezone(s.timezone)) return s.timezone;
	return systemTimezone();
}
