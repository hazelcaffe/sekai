import {
	type LinkedIdentity,
	type SsoButton,
	type SsoKind,
	type SsoProvider,
	SsoProviderInput,
	type SsoProviderInput as SsoProviderInputT,
} from "@sekai/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db, schema } from "../db/index.ts";
import { badRequest, errorMessage, HttpError, notFound, parse } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { MASKED } from "../services/messaging.ts";
import { randomSecret } from "./request.ts";
import { consumeTicket, createTicket } from "./tickets.ts";

type ProviderRow = typeof schema.authProviders.$inferSelect;

/** Where each kind signs in. Google and OpenID Connect are found through their discovery document. */
const OAUTH: Record<"github" | "discord", { authorize: string; token: string; scopes: string }> = {
	github: {
		authorize: "https://github.com/login/oauth/authorize",
		token: "https://github.com/login/oauth/access_token",
		scopes: "read:user user:email",
	},
	discord: {
		authorize: "https://discord.com/oauth2/authorize",
		token: "https://discord.com/api/oauth2/token",
		scopes: "identify email",
	},
};
const ISSUERS: Partial<Record<SsoKind, string>> = { google: "https://accounts.google.com" };

export function callbackUrl(publicUrl: string, providerId: string): string {
	return `${publicUrl.replace(/\/+$/, "")}/api/auth/sso/${providerId}/callback`;
}

// ---------------------------------------------------------------- providers (admin)

async function toProvider(r: ProviderRow, publicUrl: string, linked: number): Promise<SsoProvider> {
	return {
		id: r.id,
		kind: r.kind,
		name: r.name,
		enabled: r.enabled,
		clientId: r.clientId,
		clientSecret: r.clientSecret ? MASKED : "",
		issuer: r.issuer,
		scopes: r.scopes ?? "",
		linkByEmail: r.linkByEmail,
		callbackUrl: callbackUrl(publicUrl, r.id),
		linked,
		createdAt: r.createdAt,
	};
}

export async function listProviders(publicUrl: string): Promise<SsoProvider[]> {
	const rows = await db.select().from(schema.authProviders).orderBy(asc(schema.authProviders.createdAt));
	const counts = await db
		.select({ providerId: schema.userIdentities.providerId, n: count() })
		.from(schema.userIdentities)
		.groupBy(schema.userIdentities.providerId);
	const by = new Map(counts.map((c) => [c.providerId, Number(c.n)]));
	return Promise.all(rows.map((r) => toProvider(r, publicUrl, by.get(r.id) ?? 0)));
}

export async function ssoButtons(): Promise<SsoButton[]> {
	const rows = await db
		.select({ id: schema.authProviders.id, kind: schema.authProviders.kind, name: schema.authProviders.name })
		.from(schema.authProviders)
		.where(eq(schema.authProviders.enabled, true))
		.orderBy(asc(schema.authProviders.createdAt));
	return rows;
}

async function requireProvider(id: string): Promise<ProviderRow> {
	const [r] = await db.select().from(schema.authProviders).where(eq(schema.authProviders.id, id));
	if (!r) throw notFound("Sign-in provider");
	return r;
}

function checkKind(data: { kind: SsoKind; issuer: string | null }): void {
	if (data.kind === "oidc" && !data.issuer) throw badRequest("OpenID Connect needs the provider's issuer URL");
}

export async function createProvider(input: SsoProviderInputT, publicUrl: string): Promise<SsoProvider> {
	const data = parse(SsoProviderInput, input);
	checkKind(data);
	if (data.kind === "oidc" && data.issuer) await discover(data.issuer);
	const now = Date.now();
	const row: ProviderRow = {
		id: newId("sso", 12),
		kind: data.kind,
		name: data.name,
		enabled: data.enabled,
		clientId: data.clientId,
		clientSecret: seal(data.clientSecret),
		issuer: data.kind === "oidc" ? data.issuer : null,
		scopes: data.scopes || null,
		linkByEmail: data.linkByEmail,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.authProviders).values(row);
	return toProvider(row, publicUrl, 0);
}

export async function updateProvider(id: string, input: unknown, publicUrl: string): Promise<SsoProvider> {
	const current = await requireProvider(id);
	const merged = parse(SsoProviderInput, {
		kind: current.kind,
		name: current.name,
		enabled: current.enabled,
		clientId: current.clientId,
		clientSecret: MASKED,
		issuer: current.issuer,
		scopes: current.scopes ?? "",
		linkByEmail: current.linkByEmail,
		...(input as object),
	});
	checkKind(merged);
	if (merged.kind === "oidc" && merged.issuer && merged.issuer !== current.issuer) await discover(merged.issuer);
	await db
		.update(schema.authProviders)
		.set({
			kind: merged.kind,
			name: merged.name,
			enabled: merged.enabled,
			clientId: merged.clientId,
			clientSecret: merged.clientSecret === MASKED ? current.clientSecret : seal(merged.clientSecret),
			issuer: merged.kind === "oidc" ? merged.issuer : null,
			scopes: merged.scopes || null,
			linkByEmail: merged.linkByEmail,
			updatedAt: Date.now(),
		})
		.where(eq(schema.authProviders.id, id));
	return (await listProviders(publicUrl)).find((p) => p.id === id) as SsoProvider;
}

/** Deletes a provider; accounts linked through it sign in another way. */
export async function deleteProvider(id: string): Promise<void> {
	await requireProvider(id);
	await db.delete(schema.authProviders).where(eq(schema.authProviders.id, id));
}

// ---------------------------------------------------------------- OpenID Connect discovery

interface Discovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
	jwks_uri: string;
	token_endpoint_auth_methods_supported?: string[];
}

const discovered = new Map<string, { at: number; doc: Discovery }>();
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function discover(issuer: string): Promise<Discovery> {
	const key = issuer.replace(/\/+$/, "");
	const hit = discovered.get(key);
	if (hit && Date.now() - hit.at < 3_600_000) return hit.doc;
	let doc: Discovery;
	try {
		const res = await fetch(`${key}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`it answered ${res.status}`);
		doc = (await res.json()) as Discovery;
	} catch (err) {
		throw badRequest(
			`Couldn't read ${key}/.well-known/openid-configuration (${errorMessage(err)}). Check the issuer URL.`,
		);
	}
	if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
		throw badRequest("That issuer's discovery document is missing its endpoints");
	}
	discovered.set(key, { at: Date.now(), doc });
	return doc;
}

function jwksFor(uri: string) {
	let set = jwks.get(uri);
	if (!set) {
		set = createRemoteJWKSet(new URL(uri), { timeoutDuration: 15_000 });
		jwks.set(uri, set);
	}
	return set;
}

async function endpoints(
	p: ProviderRow,
): Promise<{ authorize: string; token: string; scopes: string; oidc: Discovery | null }> {
	if (p.kind === "github" || p.kind === "discord") return { ...OAUTH[p.kind], oidc: null };
	const issuer = p.kind === "oidc" ? p.issuer : ISSUERS[p.kind];
	if (!issuer) throw badRequest("This provider has no issuer");
	const doc = await discover(issuer);
	return {
		authorize: doc.authorization_endpoint,
		token: doc.token_endpoint,
		scopes: "openid email profile",
		oidc: doc,
	};
}

// ---------------------------------------------------------------- the round trip

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

/** Where to send the browser to sign in with a provider (or link it to the signed-in account). */
export async function startSso(
	providerId: string,
	opts: { publicUrl: string; redirect: string; linkUserId?: string | null },
): Promise<string> {
	const p = await requireProvider(providerId);
	if (!p.enabled) throw badRequest("That sign-in option is turned off");
	const ep = await endpoints(p);
	const verifier = randomSecret(64);
	const challenge = base64url(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
	);
	const nonce = randomSecret(32);
	const redirectUri = callbackUrl(opts.publicUrl, providerId);
	const t = await createTicket("sso", {
		data: {
			providerId,
			verifier,
			nonce,
			redirect: opts.redirect,
			redirectUri,
			linkUserId: opts.linkUserId ?? null,
		},
	});
	const scopes = [ep.scopes, p.scopes ?? ""].join(" ").split(/\s+/).filter(Boolean);
	const url = new URL(ep.authorize);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", p.clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", [...new Set(scopes)].join(" "));
	url.searchParams.set("state", t.token);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	if (ep.oidc) url.searchParams.set("nonce", nonce);
	if (p.kind === "google") url.searchParams.set("prompt", "select_account");
	return url.toString();
}

export interface SsoIdentity {
	subject: string;
	email: string | null;
	emailVerified: boolean;
	name: string | null;
}

async function json<T>(res: Response, what: string): Promise<T> {
	const text = await res.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`${what} didn't answer with JSON (${res.status})`);
	}
	if (!res.ok) {
		const e = data as { error_description?: string; error?: string; message?: string };
		throw new Error(`${what}: ${e.error_description ?? e.error ?? e.message ?? res.status}`);
	}
	return data as T;
}

/** Finishes a round trip: the code exchanged, the identity checked. Returns it with what the start remembered. */
export async function finishSso(
	providerId: string,
	query: { code?: string; state?: string; error?: string; error_description?: string },
): Promise<{ identity: SsoIdentity; redirect: string; linkUserId: string | null; providerName: string }> {
	const ticket = await consumeTicket("sso", query.state);
	const data = (ticket?.data ?? {}) as {
		providerId?: string;
		verifier?: string;
		nonce?: string;
		redirect?: string;
		redirectUri?: string;
		linkUserId?: string | null;
	};
	if (!ticket || data.providerId !== providerId || !data.verifier || !data.redirectUri) {
		throw new HttpError(400, "That sign-in link expired or was already used. Try again.");
	}
	if (query.error) throw new HttpError(400, `The provider said no: ${query.error_description ?? query.error}`);
	if (!query.code) throw new HttpError(400, "The provider didn't send a code back");
	const p = await requireProvider(providerId);
	const ep = await endpoints(p);
	const secret = unseal(p.clientSecret);
	const form = new URLSearchParams({
		grant_type: "authorization_code",
		code: query.code,
		redirect_uri: data.redirectUri,
		code_verifier: data.verifier,
	});
	const headers: Record<string, string> = {
		"content-type": "application/x-www-form-urlencoded",
		accept: "application/json",
	};
	const basicOnly =
		ep.oidc?.token_endpoint_auth_methods_supported &&
		!ep.oidc.token_endpoint_auth_methods_supported.includes("client_secret_post");
	if (basicOnly) {
		headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(p.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
	} else {
		form.set("client_id", p.clientId);
		form.set("client_secret", secret);
	}
	try {
		const token = await json<{ access_token?: string; id_token?: string }>(
			await fetch(ep.token, { method: "POST", headers, body: form, signal: AbortSignal.timeout(20_000) }),
			"The provider's token endpoint",
		);
		const identity = await identityFrom(p, ep, token, data.nonce ?? "");
		return {
			identity,
			redirect: data.redirect || "/",
			linkUserId: data.linkUserId ?? null,
			providerName: p.name,
		};
	} catch (err) {
		if (err instanceof HttpError) throw err;
		log.warn(`sign-in with ${p.name} failed: ${errorMessage(err)}`);
		throw new HttpError(400, `Signing in with ${p.name} didn't work: ${errorMessage(err).slice(0, 200)}`);
	}
}

async function identityFrom(
	p: ProviderRow,
	ep: Awaited<ReturnType<typeof endpoints>>,
	token: { access_token?: string; id_token?: string },
	nonce: string,
): Promise<SsoIdentity> {
	if (ep.oidc) {
		if (!token.id_token) throw new Error("The provider sent no ID token");
		const { payload } = await jwtVerify(token.id_token, jwksFor(ep.oidc.jwks_uri), {
			issuer: ep.oidc.issuer,
			audience: p.clientId,
		});
		if (payload.nonce !== nonce) throw new Error("The ID token is for another sign-in");
		const claims = payload as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
		if (!claims.sub) throw new Error("The ID token has no subject");
		let email = claims.email ?? null;
		let verified = claims.email_verified === true || claims.email_verified === "true";
		// Some providers keep the email in userinfo only.
		if (!email && ep.oidc.userinfo_endpoint && token.access_token) {
			const info = await json<{ email?: string; email_verified?: boolean }>(
				await fetch(ep.oidc.userinfo_endpoint, {
					headers: { authorization: `Bearer ${token.access_token}` },
					signal: AbortSignal.timeout(15_000),
				}),
				"userinfo",
			);
			email = info.email ?? null;
			verified = info.email_verified === true;
		}
		return {
			subject: claims.sub,
			email: email?.toLowerCase() ?? null,
			emailVerified: verified,
			name: claims.name ?? null,
		};
	}
	if (!token.access_token) throw new Error("The provider sent no access token");
	const auth = { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "Sekai" };
	if (p.kind === "github") {
		const u = await json<{ id: number; login: string; name?: string }>(
			await fetch("https://api.github.com/user", { headers: auth, signal: AbortSignal.timeout(15_000) }),
			"GitHub",
		);
		const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>(
			await fetch("https://api.github.com/user/emails", { headers: auth, signal: AbortSignal.timeout(15_000) }),
			"GitHub emails",
		).catch(() => []);
		const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
		return {
			subject: String(u.id),
			email: primary?.email.toLowerCase() ?? null,
			emailVerified: Boolean(primary),
			name: u.name || u.login,
		};
	}
	const u = await json<{ id: string; username: string; global_name?: string; email?: string; verified?: boolean }>(
		await fetch("https://discord.com/api/users/@me", { headers: auth, signal: AbortSignal.timeout(15_000) }),
		"Discord",
	);
	return {
		subject: u.id,
		email: u.email?.toLowerCase() ?? null,
		emailVerified: u.verified === true,
		name: u.global_name || u.username,
	};
}

/**
 * The Sekai account an identity signs in to: the one it's linked to; or, linking from Account, the signed-in one;
 * or (when the provider allows it) the one with the same verified email, linked from then on. Nobody gets a new
 * account this way: admins make accounts.
 */
export async function accountFor(
	providerId: string,
	identity: SsoIdentity,
	linkUserId: string | null,
): Promise<string> {
	const [existing] = await db
		.select()
		.from(schema.userIdentities)
		.where(
			and(eq(schema.userIdentities.providerId, providerId), eq(schema.userIdentities.subject, identity.subject)),
		);
	if (existing) {
		if (linkUserId && existing.userId !== linkUserId) {
			throw new HttpError(409, "That account is already linked to someone else here.");
		}
		await db
			.update(schema.userIdentities)
			.set({ lastUsedAt: Date.now(), email: identity.email })
			.where(eq(schema.userIdentities.id, existing.id));
		return existing.userId;
	}
	let userId = linkUserId;
	if (!userId) {
		const p = await requireProvider(providerId);
		if (p.linkByEmail && identity.email && identity.emailVerified) {
			const [u] = await db
				.select({ id: schema.users.id })
				.from(schema.users)
				.where(eq(schema.users.email, identity.email));
			userId = u?.id ?? null;
		}
	}
	if (!userId) {
		throw new HttpError(403, "There's no Sekai account for that sign-in. Ask an admin to make one for you.");
	}
	await db.insert(schema.userIdentities).values({
		id: newId("idn", 16),
		userId,
		providerId,
		subject: identity.subject,
		email: identity.email,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
	});
	log.info(`linked a ${providerId} sign-in to ${userId}`);
	return userId;
}

export async function listIdentities(userId: string): Promise<LinkedIdentity[]> {
	const rows = await db
		.select({ i: schema.userIdentities, p: schema.authProviders })
		.from(schema.userIdentities)
		.innerJoin(schema.authProviders, eq(schema.authProviders.id, schema.userIdentities.providerId))
		.where(eq(schema.userIdentities.userId, userId));
	return rows.map(({ i, p }) => ({
		id: i.id,
		providerId: p.id,
		providerName: p.name,
		kind: p.kind,
		email: i.email,
		createdAt: i.createdAt,
		lastUsedAt: i.lastUsedAt,
	}));
}

export async function unlinkIdentity(userId: string, id: string): Promise<void> {
	await db
		.delete(schema.userIdentities)
		.where(and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.id, id)));
}

/** The redirect path after signing in: only a path on this site (never another site). */
export function safeRedirect(path: unknown): string {
	if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\"))
		return "/";
	return path.slice(0, 500);
}
