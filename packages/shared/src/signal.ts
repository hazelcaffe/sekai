import { z } from "zod";
import type { Channel } from "./channel.ts";

/**
 * Signal accounts for bots, through signal-cli (https://github.com/AsamK/signal-cli): Signal has no bot API, so a bot
 * gets a real Signal account, either linked to a phone (like Signal Desktop) or registered to a number here. One
 * signal-cli daemon on the server runs every bot's account; its keys stay in Sekai's data folder.
 */

/** The signal-cli release Sekai installs and expects. */
export const SIGNAL_CLI_VERSION = "0.14.10";

/**
 * - off: nothing needs it (no bot has a Signal account yet)
 * - missing: signal-cli isn't installed on this server
 * - installing: Sekai is downloading and unpacking it
 * - starting: starting up
 * - ready: running; bots' accounts work
 * - error: it stopped or wouldn't start (see `error`); Sekai tries again by itself
 */
export type SignalEngineState = "off" | "missing" | "installing" | "starting" | "ready" | "error";

export interface SignalEngineStatus {
	state: SignalEngineState;
	error: string | null;
	/** signal-cli's version, once it runs. */
	version: string | null;
	/** A signal-cli Sekai can run is on this server. */
	installed: boolean;
	/** Sekai can install it here by itself (Linux on x86_64). */
	canInstall: boolean;
	/** On other servers: what to install by hand. */
	installNote: string | null;
	/** How far an install is, 0 to 1. */
	progress: number | null;
}

/** How the account came to Sekai: linked to Signal on a phone, or a number registered here. */
export type SignalMode = "linked" | "registered";

/** A Signal account's details, kept in its channel's config. */
export interface SignalAccountConfig {
	/** Signal's account id (ACI): how signal-cli knows the account. */
	account: string;
	/** Its phone number, when Signal shares it ("" for accounts without one). */
	number: string;
	mode: SignalMode;
	/** The profile name Sekai last set, if any. */
	profileName: string;
}

/** A Signal channel's account details, with defaults for missing ones. */
export function signalConfig(channel: Pick<Channel, "config">): SignalAccountConfig {
	const c = channel.config;
	return {
		account: c.account ?? "",
		number: c.number ?? "",
		mode: c.mode === "registered" ? "registered" : "linked",
		profileName: c.profileName ?? "",
	};
}

/** A phone number with its country code: +, then 7 to 15 digits (spaces, dashes and brackets are dropped). */
export function normalizePhone(input: string): string {
	return input.trim().replace(/[\s().-]/g, "");
}

export const PHONE_NUMBER = /^\+[1-9]\d{6,14}$/;

/** A link that opens a chat with a number in Signal. */
export function signalChatLink(number: string): string {
	return `https://signal.me/#p/${number}`;
}

/** Where Signal's registration captcha is solved. */
export const SIGNAL_CAPTCHA_URL = "https://signalcaptchas.org/registration/generate.html";

/** A picture for the profile: a data URL of a PNG or JPEG (the bot's avatar, drawn by the app). */
const Picture = z
	.string()
	.max(7_000_000)
	.regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "The picture must be a PNG or JPEG.");

const Phone = z
	.string()
	.transform(normalizePhone)
	.refine((v) => PHONE_NUMBER.test(v), "Give the number with its country code, like +1 555 010 0199.");

export const SignalLinkStart = z.object({
	agentId: z.string().min(1),
	/** Link again for this account (its link was removed on the phone): the same chats and settings carry on. */
	channelId: z.string().optional(),
});
export type SignalLinkStart = z.input<typeof SignalLinkStart>;

/**
 * - waiting: the code is showing; scan it on the phone
 * - linked: done; channelId is the new (or relinked) account
 * - expired: nobody scanned it in time (show a new one)
 * - failed: Signal or signal-cli said no (see `error`)
 */
export type SignalLinkState = "waiting" | "linked" | "expired" | "failed";

export interface SignalLink {
	id: string;
	/** The sgnl://linkdevice address the phone scans. */
	uri: string;
	/** The QR code of `uri`, as an SVG data URL. */
	qr: string;
	state: SignalLinkState;
	error: string | null;
	channelId: string | null;
	expiresAt: number;
}

export const SignalRegister = z.object({
	agentId: z.string().min(1),
	number: Phone,
	/** The signalcaptcha:// link from signalcaptchas.org. */
	captcha: z.string().trim().max(8000).optional(),
	/** A call instead of a text (Signal only offers it after a text was tried). */
	voice: z.boolean().default(false),
	channelId: z.string().optional(),
});
export type SignalRegister = z.input<typeof SignalRegister>;

export const SignalVerify = z.object({
	agentId: z.string().min(1),
	number: Phone,
	code: z
		.string()
		.transform((v) => v.replace(/[\s-]/g, ""))
		.refine((v) => /^\d{6}$/.test(v), "The code is six digits."),
	/** The registration lock PIN: needed when the number has one, and set for it when given. */
	pin: z.string().trim().max(64).optional(),
	/** The bot's picture for its profile. */
	avatar: Picture.optional(),
	channelId: z.string().optional(),
});
export type SignalVerify = z.input<typeof SignalVerify>;

export const SignalProfile = z.object({
	name: z.string().trim().min(1).max(80),
	avatar: Picture.optional(),
});
export type SignalProfile = z.input<typeof SignalProfile>;

/** Someone whose safety number changed: their messages don't arrive until it's trusted again. */
export interface SignalIdentityChange {
	/** Their Signal account id (ACI). */
	id: string;
	name: string | null;
	number: string | null;
	/** When Signal saw the new safety number. */
	at: number;
}

/** A Signal account's page: the account, names for the people it answers, and safety numbers that changed. */
export interface SignalAccountInfo {
	channelId: string;
	account: string;
	number: string | null;
	mode: SignalMode;
	profileName: string | null;
	/** Account id → their name on Signal, for the people it answers. */
	names: Record<string, string>;
	changed: SignalIdentityChange[];
	/** The account is still known to signal-cli (false after the link was removed on the phone). */
	present: boolean;
}
