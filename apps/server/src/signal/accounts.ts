import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type Channel,
	type SignalAccountInfo,
	type SignalIdentityChange,
	type SignalLink,
	SignalLinkStart,
	type SignalLinkStart as SignalLinkStartInput,
	type SignalMode,
	SignalProfile,
	type SignalProfile as SignalProfileInput,
	SignalRegister,
	type SignalRegister as SignalRegisterInput,
	SignalVerify,
	type SignalVerify as SignalVerifyInput,
	signalConfig,
} from "@sekai/shared";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { type Actor, currentActor, requirePermission, runAs } from "../auth/actor.ts";
import { createChannel, requireOwnChannel, updateChannel } from "../channels/manager.ts";
import { running, setStatus } from "../channels/state.ts";
import { db, schema } from "../db/index.ts";
import { errorMessage, HttpError, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { requireOwnedAgent } from "../services/agents.ts";
import { releaseSignalDaemon, signalBinary, signalDir, useSignalDaemon } from "./engine.ts";
import { callRpc, RPC_RATE_LIMIT, SignalRpcError } from "./rpc.ts";

/**
 * Connecting a bot to Signal: linking signal-cli to Signal on a phone (a QR code to scan), or registering a number
 * here (captcha, a code by text or call, then verify). Also the account's profile, safety numbers that changed, and
 * removing it from signal-cli when the account is removed.
 */

/** Signal keeps a profile's given name to 26 characters. */
const PROFILE_NAME_MAX = 26;
/** finishLink waits up to two minutes for the phone; a bit more here for the request itself. */
const LINK_WAIT_MS = 150_000;
/** A code by text or call stays usable for a while; the daemon stays up for the verify step meanwhile. */
const REGISTER_HOLD_MS = 30 * 60_000;

interface LinkSession extends SignalLink {
	userId: string | null;
	agentId: string;
	replace: string | null;
	holder: string;
}

const links = new Map<string, LinkSession>();
const registrations = new Map<string, { holder: string; timer: ReturnType<typeof setTimeout> }>();

const publicLink = ({ userId: _u, agentId: _a, replace: _r, holder: _h, ...link }: LinkSession): SignalLink => link;

/** signal-cli needs to be running for any of this; a plain message when it can't. */
async function daemon(holder: string): Promise<string> {
	try {
		return await useSignalDaemon(holder);
	} catch (err) {
		releaseSignalDaemon(holder);
		throw new HttpError(503, errorMessage(err), {
			code: (err as { missing?: boolean }).missing ? "signal_missing" : "signal_down",
		});
	}
}

/** What Signal said, in words for the page (signal-cli's messages are meant for its command line). */
export function friendlySignalError(err: unknown): string {
	const msg = errorMessage(err);
	if (err instanceof SignalRpcError && err.code === RPC_RATE_LIMIT)
		return "Signal says to wait a while before trying again (too many attempts).";
	if (/Captcha required/i.test(msg))
		return "Signal wants a captcha first: solve it, copy the Open Signal link, paste it here and try again.";
	if (/Invalid captcha/i.test(msg)) return "Signal didn't accept that captcha. Solve a new one and paste its link.";
	if (/voice verification|before requesting voice/i.test(msg))
		return "Signal only calls after a text was tried: ask for a text first, wait a minute, then ask for a call.";
	if (/pin locked|registration lock|pin, tries remaining|locked with a pin/i.test(msg))
		return "This number has a registration lock PIN: enter it below and verify again.";
	if (/Invalid verification code|incorrect|verification failed/i.test(msg))
		return "That code didn't work. Check it, or ask for a new one.";
	if (/already exists/i.test(msg)) return "That Signal account is already connected here.";
	if (/Invalid phone number|NonNormalizedPhoneNumber|not a valid/i.test(msg))
		return "Signal didn't take that number. Give it with its country code, like +1 555 010 0199.";
	if (/timed? ?out/i.test(msg)) return "Signal didn't answer in time. Try again.";
	return msg.split("\n")[0]?.trim() || "Signal said no.";
}

/** Every Signal account on this server (everyone's): signal-cli's folder is shared, so one account fits one bot. */
async function signalChannels(): Promise<Channel[]> {
	return db.select().from(schema.channels).where(eq(schema.channels.type, "signal"));
}

async function requireFree(by: { account?: string; number?: string }, except: string | null): Promise<void> {
	for (const c of await signalChannels()) {
		if (c.id === except) continue;
		const cfg = signalConfig(c);
		if ((by.account && cfg.account === by.account) || (by.number && cfg.number === by.number))
			throw new HttpError(409, "That Signal account is already connected to a bot here.");
	}
}

/** The account a page acts on: one of the acting person's bots' Signal accounts. */
async function requireSignal(channelId: string): Promise<Channel> {
	const channel = await requireOwnChannel(channelId);
	if (channel.type !== "signal") throw notFound("Signal account");
	return channel;
}

/** Saves a linked or registered account as the bot's (or into the account it replaces), and starts it. */
async function saveAccount(input: {
	agentId: string;
	replace: string | null;
	account: string;
	number: string;
	mode: SignalMode;
	profileName?: string;
}): Promise<string> {
	await requireFree({ account: input.account }, input.replace);
	const config = {
		account: input.account.toLowerCase(),
		number: input.number,
		mode: input.mode,
		profileName: input.profileName ?? "",
	};
	if (input.replace) {
		const current = await requireSignal(input.replace);
		await updateChannel(current.id, {
			enabled: true,
			config: { ...config, profileName: input.profileName ?? signalConfig(current).profileName },
		});
		return current.id;
	}
	const created = await createChannel({ agentId: input.agentId, type: "signal", config, allowFrom: [] });
	return created.id;
}

// ---------------------------------------------------------------- linking to Signal on a phone

/** Shows a code to scan in Signal on the phone (Settings → Linked devices), and waits for it in the background. */
export async function startSignalLink(input: SignalLinkStartInput): Promise<SignalLink> {
	const data = parse(SignalLinkStart, input);
	requirePermission("channels");
	const agent = await requireOwnedAgent(data.agentId);
	if (data.channelId) {
		const current = await requireSignal(data.channelId);
		if (current.agentId !== agent.id) throw notFound("Signal account");
	}
	const actor = currentActor();
	const id = newId("sgl");
	const holder = `link:${id}`;
	const base = await daemon(holder);
	let uri: string;
	try {
		const r = await callRpc<{ deviceLinkUri?: string }>(base, "startLink", {}, { timeoutMs: 45_000 });
		uri = r.deviceLinkUri ?? "";
		if (!uri.startsWith("sgnl://linkdevice")) throw new Error("Signal didn't give a link address.");
	} catch (err) {
		releaseSignalDaemon(holder);
		throw new HttpError(502, friendlySignalError(err));
	}
	const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
	const session: LinkSession = {
		id,
		uri,
		qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
		state: "waiting",
		error: null,
		channelId: null,
		expiresAt: Date.now() + 120_000,
		userId: actor?.userId ?? null,
		agentId: agent.id,
		replace: data.channelId ?? null,
		holder,
	};
	links.set(id, session);
	// Old sessions go after a while (nobody needs a finished one for long).
	for (const [k, l] of links) if (l.expiresAt < Date.now() - 30 * 60_000) links.delete(k);
	void finishLink(session, base, actor);
	return publicLink(session);
}

async function finishLink(s: LinkSession, base: string, actor: Actor | null): Promise<void> {
	try {
		const r = await callRpc<{ number?: string | null; aci?: string | null }>(
			base,
			"finishLink",
			{ deviceLinkUri: s.uri, deviceName: "Sekai" },
			{ timeoutMs: LINK_WAIT_MS },
		);
		if (!r.aci) throw new Error("Signal didn't say which account it linked.");
		const aci = r.aci;
		const save = () =>
			saveAccount({
				agentId: s.agentId,
				replace: s.replace,
				account: aci,
				number: r.number ?? "",
				mode: "linked",
			});
		s.channelId = await runAs(actor, save);
		s.state = "linked";
		log.info("signal: linked an account to a phone");
	} catch (err) {
		const msg = errorMessage(err);
		if (/timed? ?out|didn't answer in time/i.test(msg)) {
			s.state = "expired";
			s.error = "Nobody scanned the code in time. Show a new one.";
		} else {
			s.state = "failed";
			s.error = err instanceof HttpError ? err.message : friendlySignalError(err);
			log.warn(`signal: linking failed: ${msg}`);
		}
	} finally {
		releaseSignalDaemon(s.holder);
	}
}

export function getSignalLink(id: string): SignalLink {
	const s = links.get(id);
	if (!s || s.userId !== (currentActor()?.userId ?? null)) throw notFound("Link");
	return publicLink(s);
}

// ---------------------------------------------------------------- registering a number here

const regKey = (number: string) => `${currentActor()?.userId ?? ""}:${number}`;

/** Asks Signal to text (or call) a code to the number. Signal needs a captcha first, almost always. */
export async function requestSignalCode(input: SignalRegisterInput): Promise<{ ok: true }> {
	const data = parse(SignalRegister, input);
	requirePermission("channels");
	const agent = await requireOwnedAgent(data.agentId);
	if (data.channelId) {
		const current = await requireSignal(data.channelId);
		if (current.agentId !== agent.id) throw notFound("Signal account");
	}
	await requireFree({ number: data.number }, data.channelId ?? null);
	const key = regKey(data.number);
	const holder = registrations.get(key)?.holder ?? `register:${newId("sgr")}`;
	const base = await daemon(holder);
	try {
		await callRpc(
			base,
			"register",
			{
				account: data.number,
				...(data.captcha ? { captcha: data.captcha } : {}),
				...(data.voice ? { voice: true } : {}),
				...(data.channelId ? { reregister: true } : {}),
			},
			{ timeoutMs: 90_000 },
		);
	} catch (err) {
		if (!registrations.has(key)) releaseSignalDaemon(holder);
		const message = friendlySignalError(err);
		throw new HttpError(400, message, { code: /captcha/i.test(message) ? "captcha" : "signal" });
	}
	const before = registrations.get(key);
	if (before) clearTimeout(before.timer);
	const timer = setTimeout(() => {
		registrations.delete(key);
		releaseSignalDaemon(holder);
	}, REGISTER_HOLD_MS);
	timer.unref?.();
	registrations.set(key, { holder, timer });
	return { ok: true };
}

/** Sets the account's name (and picture) on Signal. */
async function setProfile(base: string, account: string, name: string, avatar?: string): Promise<string> {
	const given = [...name.trim()].slice(0, PROFILE_NAME_MAX).join("");
	let file: string | null = null;
	if (avatar) {
		const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(avatar);
		if (m?.[2]) {
			const dir = join(signalDir(), "tmp");
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			file = join(dir, `${newId("avt")}.${m[1] === "png" ? "png" : "jpg"}`);
			await Bun.write(file, Buffer.from(m[2], "base64"), { mode: 0o600 });
		}
	}
	try {
		await callRpc(
			base,
			"updateProfile",
			{ account, givenName: given, familyName: "", ...(file ? { avatar: file } : {}) },
			{ timeoutMs: 60_000 },
		);
	} finally {
		if (file) await rm(file, { force: true }).catch(() => {});
	}
	return given;
}

/** Checks the code Signal sent; the number becomes the bot's account, with its name (and picture) on Signal. */
export async function verifySignalCode(input: SignalVerifyInput): Promise<{ channelId: string }> {
	const data = parse(SignalVerify, input);
	requirePermission("channels");
	const agent = await requireOwnedAgent(data.agentId);
	if (data.channelId) {
		const current = await requireSignal(data.channelId);
		if (current.agentId !== agent.id) throw notFound("Signal account");
	}
	await requireFree({ number: data.number }, data.channelId ?? null);
	const key = regKey(data.number);
	const holder = registrations.get(key)?.holder ?? `register:${newId("sgr")}`;
	const base = await daemon(holder);
	try {
		await callRpc(
			base,
			"verify",
			{ account: data.number, verificationCode: data.code, ...(data.pin ? { pin: data.pin } : {}) },
			{ timeoutMs: 90_000 },
		).catch((err: unknown) => {
			throw new HttpError(400, friendlySignalError(err));
		});
		const accounts = await callRpc<{ number?: string | null; aci?: string | null }[]>(base, "listAccounts");
		const aci = accounts.find((a) => a.number === data.number)?.aci;
		if (!aci) throw new HttpError(502, "Signal verified the number, but signal-cli didn't load it. Try again.");
		// A registration lock PIN stops anyone else from registering the bot's number.
		if (data.pin)
			await callRpc(base, "setPin", { account: aci, pin: data.pin }).catch((err: unknown) =>
				log.warn(`signal: couldn't set the registration lock PIN: ${errorMessage(err)}`),
			);
		const profileName = await setProfile(base, aci, agent.name, data.avatar).catch((err: unknown) => {
			log.warn(`signal: couldn't set the new account's profile: ${errorMessage(err)}`);
			return "";
		});
		const channelId = await saveAccount({
			agentId: agent.id,
			replace: data.channelId ?? null,
			account: aci,
			number: data.number,
			mode: "registered",
			profileName,
		});
		log.info("signal: registered a number for a bot");
		return { channelId };
	} finally {
		const pending = registrations.get(key);
		if (pending) clearTimeout(pending.timer);
		registrations.delete(key);
		releaseSignalDaemon(holder);
	}
}

// ---------------------------------------------------------------- an account's page

/** The account, names for the people it answers, and safety numbers that changed. */
export async function signalAccountInfo(channelId: string): Promise<SignalAccountInfo> {
	const channel = await requireSignal(channelId);
	const cfg = signalConfig(channel);
	const info: SignalAccountInfo = {
		channelId,
		account: cfg.account,
		number: cfg.number || null,
		mode: cfg.mode,
		profileName: cfg.profileName || null,
		names: {},
		changed: [],
		present: true,
	};
	const holder = `info:${newId("sgi")}`;
	let base: string;
	try {
		base = await useSignalDaemon(holder);
	} catch {
		// signal-cli isn't running: the page says so from its own status.
		releaseSignalDaemon(holder);
		return info;
	}
	try {
		const accounts = await callRpc<{ aci?: string | null }[]>(base, "listAccounts", {}, { timeoutMs: 20_000 });
		info.present = accounts.some((a) => a.aci?.toLowerCase() === cfg.account);
		if (!info.present) return info;
		const contacts = await callRpc<
			{
				uuid?: string | null;
				number?: string | null;
				name?: string | null;
				profile?: { givenName?: string | null; familyName?: string | null } | null;
			}[]
		>(base, "listContacts", { account: cfg.account, allRecipients: true }, { timeoutMs: 20_000 }).catch(() => []);
		const nameOf = new Map<string, string>();
		for (const c of contacts) {
			const id = c.uuid?.toLowerCase();
			const profile = [c.profile?.givenName, c.profile?.familyName].filter(Boolean).join(" ").trim();
			const name = c.name?.trim() || profile;
			if (id && name) nameOf.set(id, name);
		}
		for (const id of channel.allowFrom) {
			const name = nameOf.get(id.toLowerCase());
			if (name) info.names[id] = name;
		}
		const identities = await callRpc<
			{ uuid?: string | null; number?: string | null; trustLevel?: string; addedTimestamp?: number }[]
		>(base, "listIdentities", { account: cfg.account }, { timeoutMs: 20_000 }).catch(() => []);
		const changed: SignalIdentityChange[] = [];
		for (const i of identities) {
			const id = i.uuid?.toLowerCase();
			if (!id || i.trustLevel !== "UNTRUSTED") continue;
			changed.push({ id, name: nameOf.get(id) ?? null, number: i.number ?? null, at: i.addedTimestamp ?? 0 });
		}
		info.changed = changed.sort((a, b) => b.at - a.at);
		return info;
	} finally {
		releaseSignalDaemon(holder);
	}
}

/** Trusts someone's new safety number (after the owner checked it's really them): their messages come through. */
export async function trustSignalIdentity(channelId: string, id: string): Promise<void> {
	const channel = await requireSignal(channelId);
	const cfg = signalConfig(channel);
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Person");
	const holder = `trust:${newId("sgt")}`;
	const base = await daemon(holder);
	try {
		await callRpc(base, "trust", { account: cfg.account, recipient: id, trustAllKnownKeys: true });
		log.info("signal: a changed safety number was trusted from the account's page");
	} catch (err) {
		throw new HttpError(502, friendlySignalError(err));
	} finally {
		releaseSignalDaemon(holder);
	}
}

/** Gives the account the bot's name (and picture) on Signal. */
export async function setSignalProfile(channelId: string, input: SignalProfileInput): Promise<{ profileName: string }> {
	const channel = await requireSignal(channelId);
	const data = parse(SignalProfile, input);
	const cfg = signalConfig(channel);
	const holder = `profile:${newId("sgp")}`;
	const base = await daemon(holder);
	let profileName: string;
	try {
		profileName = await setProfile(base, cfg.account, data.name, data.avatar);
	} catch (err) {
		throw new HttpError(502, friendlySignalError(err));
	} finally {
		releaseSignalDaemon(holder);
	}
	// Saved without restarting the account (its name shows at once).
	const config = { ...channel.config, profileName };
	await db.update(schema.channels).set({ config, updatedAt: Date.now() }).where(eq(schema.channels.id, channel.id));
	const entry = running.get(channel.id);
	if (entry) entry.channel = { ...entry.channel, config };
	setStatus(channel.id, { botName: profileName });
	return { profileName };
}

/**
 * Takes a removed account out of signal-cli: a number registered here is unregistered first (Signal stops delivering
 * to it); an account linked to a phone only loses this linked device's data (the phone's account is never touched).
 */
export async function forgetSignalAccount(channel: Channel): Promise<void> {
	const cfg = signalConfig(channel);
	if (!cfg.account) return;
	if (!signalBinary()) {
		log.warn("signal: signal-cli isn't installed, so a removed account's data stays in its folder");
		return;
	}
	const holder = `forget:${channel.id}`;
	const base = await daemon(holder);
	try {
		if (cfg.mode === "registered") {
			await callRpc(base, "unregister", { account: cfg.account }, { timeoutMs: 60_000 }).catch((err: unknown) => {
				// Already signed out (it isn't loaded any more): nothing to unregister.
				if (!/does not exist|not registered/i.test(errorMessage(err))) throw err;
			});
		}
		await callRpc(
			base,
			"deleteLocalAccountData",
			{ account: cfg.account, ignoreRegistered: true },
			{ timeoutMs: 60_000 },
		).catch((err: unknown) => {
			if (!/does not exist|not found|Failed to load/i.test(errorMessage(err))) throw err;
		});
		log.info(`signal: removed a ${cfg.mode === "registered" ? "registered number" : "linked account"}`);
	} catch (err) {
		throw new HttpError(502, `Couldn't remove the account from Signal: ${friendlySignalError(err)} Try again.`);
	} finally {
		releaseSignalDaemon(holder);
	}
}
