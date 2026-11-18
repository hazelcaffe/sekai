import { sign } from "node:crypto";
import { type ClientHttp2Session, connect } from "node:http2";

/**
 * Apple Push Notification service for the iOS app: HTTP/2 with a token signed by the .p8 key (ES256, made again
 * every 40 minutes; Apple wants it newer than an hour and not remade more than every 20). Development builds
 * use Apple's sandbox servers.
 */

export interface ApnsKey {
	key: string;
	keyId: string;
	teamId: string;
	bundleId: string;
}

export type ApnsEnvironment = "sandbox" | "production";

const HOSTS: Record<ApnsEnvironment, string> = {
	sandbox: "https://api.sandbox.push.apple.com",
	production: "https://api.push.apple.com",
};

let jwt: { id: string; token: string; until: number } | null = null;

function providerToken(k: ApnsKey): string {
	const id = `${k.teamId}:${k.keyId}`;
	if (jwt && jwt.id === id && jwt.until > Date.now()) return jwt.token;
	const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
	const unsigned = `${b64({ alg: "ES256", kid: k.keyId })}.${b64({ iss: k.teamId, iat: Math.floor(Date.now() / 1000) })}`;
	const signature = sign("sha256", Buffer.from(unsigned), { key: k.key, dsaEncoding: "ieee-p1363" });
	jwt = { id, token: `${unsigned}.${signature.toString("base64url")}`, until: Date.now() + 40 * 60_000 };
	return jwt.token;
}

const sessions = new Map<ApnsEnvironment, ClientHttp2Session>();

function session(env: ApnsEnvironment): ClientHttp2Session {
	const open = sessions.get(env);
	if (open && !open.closed && !open.destroyed) return open;
	const s = connect(HOSTS[env]);
	s.on("error", () => sessions.delete(env));
	s.on("close", () => sessions.delete(env));
	// An idle connection doesn't keep the server running or stay open forever.
	s.setTimeout(5 * 60_000, () => s.close());
	s.unref();
	sessions.set(env, s);
	return s;
}

/**
 * "sent"; "gone" (the app was removed, or the token isn't valid any more: forget it); "wrong_environment"
 * (a development token sent to production or the other way round); or throws.
 */
export function sendApns(
	k: ApnsKey,
	env: ApnsEnvironment,
	token: string,
	payload: Record<string, unknown>,
	opts: { ttlSeconds: number; collapseId?: string; urgent?: boolean },
): Promise<"sent" | "gone" | "wrong_environment"> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {
			":method": "POST",
			":path": `/3/device/${token}`,
			authorization: `bearer ${providerToken(k)}`,
			"apns-topic": k.bundleId,
			"apns-push-type": "alert",
			"apns-priority": opts.urgent === false ? "5" : "10",
			"apns-expiration": String(Math.floor(Date.now() / 1000) + opts.ttlSeconds),
			"content-type": "application/json",
		};
		if (opts.collapseId) headers["apns-collapse-id"] = Buffer.from(opts.collapseId).subarray(0, 64).toString();
		let req: ReturnType<ClientHttp2Session["request"]>;
		try {
			req = session(env).request(headers);
		} catch (err) {
			sessions.delete(env);
			reject(err);
			return;
		}
		let status = 0;
		let body = "";
		req.setTimeout(15_000, () => req.close());
		req.on("response", (h) => {
			status = Number(h[":status"]);
		});
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => {
			body += chunk;
		});
		req.on("error", reject);
		req.on("close", () => {
			if (status === 200) return resolve("sent");
			let reason = "";
			try {
				reason = (JSON.parse(body) as { reason?: string }).reason ?? "";
			} catch {}
			if (status === 410 || reason === "Unregistered") return resolve("gone");
			if (reason === "BadDeviceToken") return resolve("wrong_environment");
			if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") jwt = null;
			reject(new Error(`Apple said ${status || "nothing"}${reason ? `: ${reason}` : ""}`));
		});
		req.end(JSON.stringify(payload));
	});
}
