import { createSign } from "node:crypto";
import type { ServiceAccount } from "./settings.ts";

/**
 * Firebase Cloud Messaging (HTTP v1) for the Android app: an OAuth token from the service account (a signed JWT,
 * cached for most of its hour), then one request per phone. Messages carry data only, so the app always decides
 * how to show them (Approve / Deny buttons, skipping them while it's in front).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

let cached: { email: string; token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
	if (cached && cached.email === sa.clientEmail && cached.until > Date.now()) return cached.token;
	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
		JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
	)}`;
	const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.privateKey);
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: `${unsigned}.${b64url(signature)}`,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	const body = (await res.json().catch(() => ({}))) as {
		access_token?: string;
		expires_in?: number;
		error_description?: string;
	};
	if (!res.ok || !body.access_token) {
		throw new Error(`Google didn't accept the service account key (${body.error_description ?? res.status})`);
	}
	cached = {
		email: sa.clientEmail,
		token: body.access_token,
		until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000,
	};
	return body.access_token;
}

/** "sent", "gone" (the app was uninstalled or the token replaced: forget it), or throws. */
export async function sendFcm(
	sa: ServiceAccount,
	token: string,
	data: Record<string, string>,
	opts: { ttlSeconds: number; collapseKey?: string },
): Promise<"sent" | "gone"> {
	const res = await fetch(
		`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/messages:send`,
		{
			method: "POST",
			headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
			body: JSON.stringify({
				message: {
					token,
					data,
					// High priority wakes the phone; every one of these ends in a notification people see.
					android: {
						priority: "high",
						ttl: `${opts.ttlSeconds}s`,
						...(opts.collapseKey ? { collapse_key: opts.collapseKey.slice(0, 100) } : {}),
					},
				},
			}),
			signal: AbortSignal.timeout(15_000),
		},
	);
	if (res.ok) return "sent";
	const body = (await res.json().catch(() => ({}))) as {
		error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
	};
	const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
	if (res.status === 404 || code === "UNREGISTERED") return "gone";
	if (res.status === 401) cached = null;
	throw new Error(`Firebase said ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}`);
}

export function resetFcmForTests(): void {
	cached = null;
}
