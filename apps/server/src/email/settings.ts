import {
	type EmailOptions,
	type MailcowCheck,
	MailcowCheckInput,
	type MailcowSettings,
	MailcowSettingsInput,
	MailcowSettingsUpdate,
} from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { badRequest, errorMessage, parse } from "../lib/errors.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { deleteKey, readKey, writeKey } from "../services/kv.ts";
import { MailcowClient, MailcowError, normalizeMailcowUrl } from "./mailcow.ts";

/**
 * The mailcow server bots get their addresses on (Settings → Bots → Email, admins): its address, a read-write API
 * key (sealed in kv "email.mailcow"), the domains bots may use and how big a new mailbox is.
 */

const KEY = "email.mailcow";
export const MASK = "••••••••";

type Stored = ReturnType<typeof MailcowSettingsInput.parse>;

export async function mailcowSettings(): Promise<Stored> {
	const raw = ((await readKey(KEY)) ?? {}) as Partial<Stored>;
	const parsed = MailcowSettingsInput.parse(raw);
	let apiKey = "";
	if (parsed.apiKey) {
		try {
			apiKey = unseal(parsed.apiKey);
		} catch {
			apiKey = "";
		}
	}
	return { ...parsed, apiKey };
}

export function publicMailcow(s: Stored): MailcowSettings {
	return {
		url: s.url,
		apiKey: s.apiKey ? MASK : "",
		domains: s.domains,
		defaultQuotaMb: s.defaultQuotaMb,
		configured: Boolean(s.url && s.apiKey),
	};
}

/** A key sent back masked (or not at all) keeps the stored one. */
const keptKey = (next: string | undefined, stored: string) =>
	next === undefined || next.startsWith(MASK) ? stored : next;

export const isNewKey = (apiKey: string | undefined) => Boolean(apiKey?.trim() && !apiKey.startsWith(MASK));

/** A client for the saved mailcow, or null when there's none. */
export async function mailcowClient(): Promise<MailcowClient | null> {
	const s = await mailcowSettings();
	return s.url && s.apiKey ? new MailcowClient(s.url, s.apiKey) : null;
}

/** Whether mailcow answers with these (or the saved) details, what it serves, and whether the key may write. */
export async function checkMailcow(input: unknown = {}): Promise<MailcowCheck> {
	const given = parse(MailcowCheckInput, input);
	const saved = await mailcowSettings();
	const url = given.url?.trim() || saved.url;
	const apiKey = keptKey(given.apiKey?.trim() || undefined, saved.apiKey);
	const empty = { readWrite: false, version: null, domains: [] };
	if (!url || !apiKey) return { ok: false, error: "Add mailcow's address and an API key first.", ...empty };
	let client: MailcowClient;
	try {
		client = new MailcowClient(url, apiKey);
	} catch {
		return { ok: false, error: `"${url}" isn't an address. It looks like https://mail.example.com.`, ...empty };
	}
	try {
		if (client.base !== saved.url && !isNewKey(given.apiKey))
			throw badRequest("Enter a new key for this server address.");
		const domains = await client.domains();
		const readWrite = await client.canWrite();
		const version = await client.version().catch(() => null);
		return {
			ok: true,
			error: readWrite
				? null
				: "This key is read-only, so Sekai can't make mailboxes. Make a read-write key in mailcow (System → Configuration → Access → API).",
			readWrite,
			version,
			domains: domains.map((d) => ({
				name: d.name,
				active: d.active,
				mailboxes: d.mailboxes,
				defaultQuotaMb: d.defaultQuotaMb,
				maxQuotaMb: d.maxQuotaMb,
			})),
		};
	} catch (err) {
		return { ok: false, error: err instanceof MailcowError ? err.message : errorMessage(err), ...empty };
	}
}

/** Saves the connection. A new key must work and be allowed to write; domains must be ones mailcow serves. */
export async function saveMailcowSettings(input: unknown): Promise<MailcowSettings> {
	const patch = parse(MailcowSettingsUpdate, input);
	const current = await mailcowSettings();
	const next = MailcowSettingsInput.parse({
		...current,
		...patch,
		url: patch.url !== undefined ? (patch.url.trim() ? normalizeMailcowUrl(patch.url) : "") : current.url,
		apiKey: keptKey(patch.apiKey, current.apiKey),
		domains: [...new Set(patch.domains ?? current.domains)],
	});
	const connectionChanged = next.url !== current.url || next.apiKey !== current.apiKey;
	if (next.url && next.url !== current.url && !isNewKey(patch.apiKey))
		throw badRequest("Enter a new key for this server address.");
	if (next.url && next.apiKey && (connectionChanged || patch.domains)) {
		const check = await checkMailcow({ url: next.url, apiKey: next.apiKey });
		if (!check.ok) throw badRequest(check.error ?? "mailcow didn't answer.");
		if (!check.readWrite)
			throw badRequest(
				"This mailcow key is read-only, so Sekai can't make mailboxes. Make a read-write key in mailcow (System → Configuration → Access → API).",
			);
		const served = new Set(check.domains.filter((d) => d.active).map((d) => d.name));
		const unknown = next.domains.filter((d) => !served.has(d));
		if (unknown.length) throw badRequest(`mailcow doesn't serve ${unknown.join(", ")}.`);
	}
	if (!next.url || !next.apiKey) next.domains = next.url || next.apiKey ? next.domains : [];
	await writeKey(KEY, { ...next, apiKey: next.apiKey ? seal(next.apiKey) : "" });
	bus.emit({ type: "settings.changed" });
	return publicMailcow(next);
}

export async function forgetMailcow(): Promise<void> {
	await deleteKey(KEY);
	bus.emit({ type: "settings.changed" });
}

/** What someone giving their bot an address can choose from (nothing secret). */
export async function emailOptions(): Promise<EmailOptions> {
	const s = await mailcowSettings();
	const ready = Boolean(s.url && s.apiKey && s.domains.length);
	return { mailcow: { ready, domains: ready ? s.domains : [] } };
}
