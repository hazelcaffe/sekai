import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LocalComputerSettings } from "@sekai/shared";
import { app, safeStorage } from "electron";

export interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}

export interface DesktopConfig {
	/** The Sekai server this app connects to. */
	serverUrl: string;
	/** Closing the window keeps Sekai running in the tray so notifications still arrive. */
	keepInTray: boolean;
	launchAtLogin: boolean;
	bounds: WindowBounds;
	/** Lending this computer to bots. Off until you turn it on here; the server can't change it. */
	localComputer: LocalComputerSettings;
	/** Identifies this computer to the server (stays the same across restarts). */
	deviceId: string;
	/** The server's API token, from the web app, so the app can connect on its own (encrypted when possible). */
	serverToken: string | null;
}

const DEFAULTS: DesktopConfig = {
	serverUrl: process.env.SEKAI_SERVER_URL ?? "http://127.0.0.1:7420",
	keepInTray: true,
	launchAtLogin: false,
	bounds: { width: 1280, height: 840, maximized: false },
	localComputer: { enabled: false, agentIds: [], workdir: homedir(), askEachAction: false },
	deviceId: "",
	serverToken: null,
};

function file(): string {
	return join(app.getPath("userData"), "desktop.json");
}

let cache: DesktopConfig | null = null;

export function loadConfig(): DesktopConfig {
	if (cache) return cache;
	try {
		const raw = existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Partial<DesktopConfig>) : {};
		cache = {
			...DEFAULTS,
			...raw,
			bounds: { ...DEFAULTS.bounds, ...raw.bounds },
			localComputer: { ...DEFAULTS.localComputer, ...raw.localComputer },
		};
	} catch {
		cache = { ...DEFAULTS };
	}
	if (!cache.deviceId) {
		cache.deviceId = randomUUID();
		saveConfig({ deviceId: cache.deviceId });
	}
	if (process.env.SEKAI_SERVER_URL) cache.serverUrl = process.env.SEKAI_SERVER_URL;
	return cache;
}

export function saveConfig(patch: Partial<DesktopConfig>): DesktopConfig {
	const next = { ...loadConfig(), ...patch };
	cache = next;
	mkdirSync(dirname(file()), { recursive: true });
	writeFileSync(file(), JSON.stringify(next, null, "\t"));
	return next;
}

export function normalizeServerUrl(input: string): string | null {
	const trimmed = input.trim().replace(/\/+$/, "");
	try {
		const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin;
	} catch {
		return null;
	}
}

/** Keeps the server token encrypted with the OS keychain when there is one (plain text otherwise). */
export function saveServerToken(token: string | null): void {
	if (!token) {
		saveConfig({ serverToken: null });
		return;
	}
	const sealed = safeStorage.isEncryptionAvailable()
		? `enc:${safeStorage.encryptString(token).toString("base64")}`
		: `raw:${token}`;
	saveConfig({ serverToken: sealed });
}

export function serverToken(): string | null {
	const stored = loadConfig().serverToken;
	if (!stored) return null;
	if (stored.startsWith("raw:")) return stored.slice(4);
	try {
		return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
	} catch {
		return null;
	}
}
