import { type WebEngineSettings as Settings, WebEngineSettings, WebEngineSettingsUpdate } from "@sekai/shared";
import { badRequest, parse } from "../lib/errors.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { readKey, writeKey } from "../services/kv.ts";

/** How Sekai reaches Firecrawl Local (kv key "web"). The Firecrawl key and the engine's token are sealed. */

const KEY = "web";
const MASK = "••••••••";

let cache: Settings | null = null;

const open = (value: string): string => {
	if (!value.startsWith("v1:")) return value;
	try {
		return unseal(value);
	} catch {
		return "";
	}
};

/** The settings with secrets in clear. Server-side only. */
export async function webSettings(): Promise<Settings> {
	if (cache) return cache;
	const raw = (await readKey(KEY)) as Partial<Settings> | undefined;
	const parsed = WebEngineSettings.parse(raw ?? {});
	cache = { ...parsed, apiKey: open(parsed.apiKey), token: open(parsed.token) };
	return cache;
}

/** What the app sees: the key and token masked, so they're never sent back out. */
export function publicWebSettings(s: Settings): Settings {
	const mask = (v: string) => (v ? `${MASK}${v.slice(-4)}` : "");
	return { ...s, apiKey: mask(s.apiKey), token: mask(s.token) };
}

/** A masked value coming back from the app means "keep the stored one". */
const kept = (next: string | undefined, stored: string): string | undefined => (next?.startsWith(MASK) ? stored : next);

export function checkWebUrl(url: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw badRequest(`"${url}" isn't an address. It looks like http://192.168.1.9:3002.`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw badRequest("Use an http:// address.");
	return parsed;
}

/** Saves the settings (secrets sealed) and returns them in clear. */
export async function saveWebSettings(input: unknown): Promise<Settings> {
	const patch = parse(WebEngineSettingsUpdate, input);
	const current = await webSettings();
	const next = WebEngineSettings.parse({
		...current,
		...patch,
		apiKey: kept(patch.apiKey, current.apiKey) ?? current.apiKey,
		token: kept(patch.token, current.token) ?? current.token,
	});
	next.url = next.url.trim().replace(/\/+$/, "");
	// "Somewhere else" can be picked before the address is typed in (the status asks for it meanwhile).
	if (next.url) checkWebUrl(next.url);
	await writeKey(KEY, {
		...next,
		apiKey: next.apiKey ? seal(next.apiKey) : "",
		token: next.token ? seal(next.token) : "",
	});
	cache = next;
	return next;
}

/** For tests. */
export function resetWebSettings(): void {
	cache = null;
}
