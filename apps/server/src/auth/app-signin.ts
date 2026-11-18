import { createHash } from "node:crypto";
import type { SessionRestriction } from "@sekai/shared";
import { badRequest, HttpError } from "../lib/errors.ts";
import { safeEqual } from "./request.ts";
import { consumeTicket, createTicket, findTicket } from "./tickets.ts";

/**
 * Signing in to the phone apps through the system browser, where passkeys and Google sign-in work (they don't in
 * an app's web view). The app opens /api/auth/app/start with a PKCE challenge; the person signs in there as usual;
 * the browser hands the app a short-lived code (sekai://signed-in?code=…); the app's web view trades it, with the
 * verifier only the app knows, for a session of its own. A code taken by another app on the phone is useless
 * without the verifier.
 */

export const APP_COOKIE = "sekai_app_signin";
export const APP_FINISH = "/api/auth/app/finish";
const CODE_MS = 2 * 60_000;

export interface AppSignIn {
	challenge: string;
	/** The browser was signed in already, so the person confirms before it's handed over. */
	hadSession: boolean;
}

/** Starts a sign-in for the app; the token goes in a cookie in that browser. */
export async function startAppSignIn(challenge: string, hadSession: boolean): Promise<string> {
	if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw badRequest("Open this from the Sekai app.");
	const { token } = await createTicket("app", { data: { challenge, hadSession } satisfies AppSignIn });
	return token;
}

export async function appSignIn(token: string | null): Promise<AppSignIn | null> {
	const t = await findTicket("app", token);
	return t ? (t.data as unknown as AppSignIn) : null;
}

/** The browser's sign-in, handed over as a one-time code for the app (the browser stays signed in). */
export async function issueAppCode(
	token: string | null,
	userId: string,
	restriction: SessionRestriction | null,
): Promise<string> {
	const t = await consumeTicket("app", token);
	if (!t) throw new HttpError(400, "That sign-in expired. Go back to the Sekai app and try again.");
	const { challenge } = t.data as unknown as AppSignIn;
	const code = await createTicket("app_code", { userId, data: { challenge, restriction }, ttlMs: CODE_MS });
	return code.token;
}

/** Trades a code and its verifier for whom it signs in. */
export async function redeemAppCode(
	code: string,
	verifier: string,
): Promise<{ userId: string; restriction: SessionRestriction | null }> {
	const t = await consumeTicket("app_code", code);
	if (!t?.userId) throw new HttpError(400, "That sign-in expired. Try again.");
	const { challenge, restriction } = t.data as { challenge: string; restriction: SessionRestriction | null };
	const expected = createHash("sha256").update(verifier).digest("base64url");
	if (!verifier || !safeEqual(expected, challenge)) throw new HttpError(400, "That sign-in didn't match. Try again.");
	return { userId: t.userId, restriction: restriction ?? null };
}

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/**
 * The small pages the browser shows along the way, in Sekai's colors. `open` is the app link to follow (now, and
 * as a button in case the browser wants a tap first); `form` posts back to confirm.
 */
export function appPage(opts: {
	title: string;
	text: string;
	open?: string;
	form?: { action: string; button: string; cancel: string };
}): string {
	const open = opts.open ? escapeHtml(opts.open) : null;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${open ? `<meta http-equiv="refresh" content="0;url=${open}">` : ""}
<title>${escapeHtml(opts.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--surface:#eef6f5;--fg:#0b1716;--muted:#4c5f5d;--accent:#33ccbb;--accent-fg:#03302b}
@media (prefers-color-scheme:dark){:root{--bg:#0d0a10;--surface:#15111a;--fg:#efe9f4;--muted:#a99fb4;--accent:#9b54ad;--accent-fg:#fff}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Roboto,sans-serif;padding:24px}
main{width:min(380px,100%);display:flex;flex-direction:column;gap:16px;text-align:center}
img{width:72px;height:72px;margin:0 auto}
h1{margin:0;font-size:22px}
p{margin:0;color:var(--muted)}
a.button,button{display:flex;align-items:center;justify-content:center;width:100%;height:50px;border:0;border-radius:14px;background:var(--accent);color:var(--accent-fg);font:600 16px system-ui,-apple-system,Roboto,sans-serif;text-decoration:none;cursor:pointer}
a.secondary{background:var(--surface);color:var(--fg)}
form{display:flex;flex-direction:column;gap:10px;margin:0}
</style>
</head>
<body>
<main>
<img src="/icon-192.png" alt="">
<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.text)}</p>
${open ? `<a class="button" href="${open}">Open Sekai</a>` : ""}
${
	opts.form
		? `<form method="post" action="${escapeHtml(opts.form.action)}"><button type="submit">${escapeHtml(opts.form.button)}</button><a class="button secondary" href="sekai://signed-in?error=cancelled">${escapeHtml(opts.form.cancel)}</a></form>`
		: ""
}
</main>
</body>
</html>`;
}
