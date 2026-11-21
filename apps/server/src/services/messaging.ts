import { createHmac } from "node:crypto";
import { EmailConfig, SmsConfig } from "@sekai/shared";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { guardedFetch } from "../lib/net.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { readKey, writeKey } from "./kv.ts";

/**
 * Email (SMTP) and text messages (Twilio, or a webhook for any other provider), for sign-in codes, invites and
 * password resets. Admins set them up; passwords and tokens are sealed at rest and masked when read back.
 */

const EMAIL_KEY = "auth.email";
const SMS_KEY = "auth.sms";
/** What a masked secret reads as: sending it back keeps the stored one. */
export const MASKED = "••••••••";

type Stored<T> = T & { sealed?: Record<string, string> };

async function read<T extends Record<string, unknown>>(
	key: string,
	schema: { parse(v: unknown): T },
	secrets: (keyof T)[],
) {
	const raw = ((await readKey(key)) as Stored<T> | undefined) ?? ({} as Stored<T>);
	const value = schema.parse(raw) as T;
	for (const k of secrets) {
		const sealed = raw.sealed?.[k as string];
		(value as Record<string, unknown>)[k as string] = sealed ? unseal(sealed) : "";
	}
	return value;
}

async function write<T extends Record<string, unknown>>(
	key: string,
	schema: { parse(v: unknown): T },
	input: unknown,
	secrets: (keyof T)[],
) {
	const current = await read(key, schema, secrets);
	const next = schema.parse({ ...current, ...(input as object) }) as T;
	const sealed: Record<string, string> = {};
	const plain: Record<string, unknown> = { ...next };
	for (const k of secrets) {
		const given = next[k] as unknown as string;
		const keep = given === MASKED ? (current[k] as unknown as string) : given;
		if (keep) sealed[k as string] = seal(keep);
		delete plain[k as string];
	}
	await writeKey(key, { ...plain, sealed });
	return read(key, schema, secrets);
}

function masked<T extends Record<string, unknown>>(value: T, secrets: (keyof T)[]): T {
	const out = { ...value };
	for (const k of secrets) if (out[k]) (out as Record<string, unknown>)[k as string] = MASKED;
	return out;
}

// ---------------------------------------------------------------- email

export const emailConfig = () => read(EMAIL_KEY, EmailConfig, ["password"]);
export const publicEmailConfig = async () => masked(await emailConfig(), ["password"]);
export const saveEmailConfig = async (input: unknown) =>
	masked(await write(EMAIL_KEY, EmailConfig, input, ["password"]), ["password"]);

export async function emailReady(): Promise<boolean> {
	const c = await emailConfig();
	return c.enabled && Boolean(c.host && c.from);
}

/** Sends an email (plain text, with a simple HTML copy). Throws a friendly error when it can't. */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
	const c = await emailConfig();
	if (!c.enabled || !c.host || !c.from)
		throw badRequest("Email isn't set up yet (Settings → Sign-in options → Email).");
	const nodemailer = await import("nodemailer");
	const transport = nodemailer.createTransport({
		host: c.host,
		port: c.port,
		secure: c.secure,
		requireTLS: !c.secure && c.port !== 25,
		auth: c.username ? { user: c.username, pass: c.password } : undefined,
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 30_000,
	});
	const html = `<div style="font:15px/1.6 system-ui,sans-serif;max-width:32em">${text
		.split("\n")
		.map((l) => escapeHtml(l))
		.join("<br>")}</div>`;
	try {
		await transport.sendMail({ from: c.from, to, subject, text, html });
	} catch (err) {
		log.warn(`email to ${to.replace(/^(.).*@/, "$1…@")} failed: ${errorMessage(err)}`);
		throw badRequest(`The email couldn't be sent: ${errorMessage(err).slice(0, 200)}`);
	}
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------- text messages

export const smsConfig = () => read(SMS_KEY, SmsConfig, ["authToken", "webhookSecret"]);
export const publicSmsConfig = async () => masked(await smsConfig(), ["authToken", "webhookSecret"]);
export const saveSmsConfig = async (input: unknown) =>
	masked(await write(SMS_KEY, SmsConfig, input, ["authToken", "webhookSecret"]), ["authToken", "webhookSecret"]);

export async function smsReady(): Promise<boolean> {
	const c = await smsConfig();
	if (!c.enabled) return false;
	return c.provider === "twilio" ? Boolean(c.accountSid && c.authToken && c.from) : Boolean(c.webhookUrl);
}

/** Sends a text message to a number with its country code (+15551234567). */
export async function sendSms(to: string, message: string): Promise<void> {
	const c = await smsConfig();
	if (!(await smsReady()))
		throw badRequest("Text messages aren't set up yet (Settings → Sign-in options → Text messages).");
	if (!/^\+[1-9]\d{6,14}$/.test(to)) throw badRequest("That phone number needs its country code (+1…)");
	try {
		if (c.provider === "twilio") {
			const form = new URLSearchParams({ To: to, Body: message });
			if (c.from.startsWith("MG")) form.set("MessagingServiceSid", c.from);
			else form.set("From", c.from);
			const res = await fetch(
				`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`,
				{
					method: "POST",
					headers: {
						authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,
						"content-type": "application/x-www-form-urlencoded",
					},
					body: form,
					signal: AbortSignal.timeout(20_000),
				},
			);
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(err.message ?? `Twilio answered ${res.status}`);
			}
			return;
		}
		const body = JSON.stringify({ to, message });
		const signature = createHmac("sha256", c.webhookSecret || "")
			.update(body)
			.digest("hex");
		// Your own network is allowed: a gateway like n8n or Home Assistant often lives there.
		const res = await guardedFetch(new URL(c.webhookUrl), {
			method: "POST",
			headers: { "content-type": "application/json", "x-sekai-signature": signature },
			body,
			allowPrivate: true,
			configured: true,
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) throw new Error(`The webhook answered ${res.status}`);
	} catch (err) {
		log.warn(`text to ${to.slice(0, 4)}… failed: ${errorMessage(err)}`);
		throw badRequest(`The text message couldn't be sent: ${errorMessage(err).slice(0, 200)}`);
	}
}

// ---------------------------------------------------------------- hiding addresses

/** h•••@example.com */
export function maskEmail(email: string): string {
	const [name = "", domain = ""] = email.split("@");
	return `${name.slice(0, 1)}•••@${domain}`;
}

/** +1 ••• ••• 4567 */
export function maskPhone(phone: string): string {
	return `${phone.slice(0, phone.length > 11 ? 3 : 2)} ••• ••• ${phone.slice(-4)}`;
}
