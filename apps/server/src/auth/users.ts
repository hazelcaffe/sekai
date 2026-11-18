import {
	type ManagedUser,
	type Person,
	UserCreate,
	type UserCreate as UserCreateT,
	type UserCredentials,
	UserUpdate,
	type UserUpdate as UserUpdateT,
} from "@sekai/shared";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, HttpError, notFound, parse } from "../lib/errors.ts";
import { newId, randomChars } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { emailReady, sendEmail } from "../services/messaging.ts";
import { forgetPrefs } from "../services/prefs.ts";
import { activeAdminsExcept, isAdminRole } from "./roles.ts";
import { forgetCachedPrincipals, hashPassword, revokeEverything, setPassword, type UserRow } from "./service.ts";
import { createTicket, deleteUserTickets } from "./tickets.ts";

/** A temporary password: easy to read out or type (no look-alike characters), ~80 bits. */
function temporaryPassword(): string {
	const chars = randomChars("abcdefghjkmnpqrstuvwxyz23456789", 16);
	return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

async function manage(rows: UserRow[]): Promise<ManagedUser[]> {
	if (!rows.length) return [];
	const factors = await db
		.select({ userId: schema.mfaFactors.userId, kind: schema.mfaFactors.kind })
		.from(schema.mfaFactors)
		.where(isNotNull(schema.mfaFactors.confirmedAt));
	const passkeys = await db.select({ userId: schema.passkeys.userId }).from(schema.passkeys);
	const codes = await db
		.select({ userId: schema.recoveryCodes.userId })
		.from(schema.recoveryCodes)
		.where(isNull(schema.recoveryCodes.usedAt));
	const identities = await db
		.select({ i: schema.userIdentities, name: schema.authProviders.name })
		.from(schema.userIdentities)
		.innerJoin(schema.authProviders, eq(schema.authProviders.id, schema.userIdentities.providerId));
	return rows.map((u) => {
		const mine = factors.filter((f) => f.userId === u.id).map((f) => f.kind);
		return {
			id: u.id,
			username: u.username,
			name: u.name,
			email: u.email,
			phone: u.phone,
			roleId: u.roleId,
			disabled: Boolean(u.disabledAt),
			mustChangePassword: u.mustChangePassword,
			mfa: {
				totp: mine.includes("totp"),
				email: mine.includes("email"),
				sms: mine.includes("sms"),
				passkeys: passkeys.filter((p) => p.userId === u.id).length,
				recoveryCodes: codes.filter((c) => c.userId === u.id).length,
			},
			identities: identities
				.filter((x) => x.i.userId === u.id)
				.map((x) => ({ providerId: x.i.providerId, providerName: x.name, email: x.i.email })),
			lastLoginAt: u.lastLoginAt,
			createdAt: u.createdAt,
		};
	});
}

export async function listUsers(): Promise<ManagedUser[]> {
	return manage(await db.select().from(schema.users).orderBy(asc(schema.users.createdAt)));
}

async function requireUserRow(id: string): Promise<UserRow> {
	const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
	if (!u) throw notFound("Account");
	return u;
}

export async function getManagedUser(id: string): Promise<ManagedUser> {
	const [u] = await manage([await requireUserRow(id)]);
	if (!u) throw notFound("Account");
	return u;
}

/** Everyone else here, by name (for sharing bots). */
export async function listPeople(exceptUserId: string): Promise<Person[]> {
	const rows = await db
		.select({ id: schema.users.id, name: schema.users.name, username: schema.users.username })
		.from(schema.users)
		.where(and(ne(schema.users.id, exceptUserId), isNull(schema.users.disabledAt)))
		.orderBy(asc(schema.users.name));
	return rows;
}

async function requireRole(roleId: string): Promise<void> {
	const [r] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, roleId));
	if (!r) throw badRequest("That role doesn't exist");
}

function uniqueError(err: unknown): never {
	const s = String(err);
	if (/users_username_idx/.test(s)) throw new HttpError(409, "That username is taken");
	if (/users_email_idx/.test(s)) throw new HttpError(409, "Another account uses that email");
	throw err;
}

/** A sign-in link: an invite (set your password) or a password reset, by email when that's set up. */
async function linkFor(
	user: UserRow,
	kind: "invite" | "reset",
	publicUrl: string,
): Promise<{ url: string; emailed: boolean }> {
	await deleteUserTickets(user.id, kind);
	const t = await createTicket(kind, { userId: user.id });
	const url = `${publicUrl.replace(/\/+$/, "")}/welcome/${kind === "invite" ? "invite" : "reset"}/${t.token}`;
	let emailed = false;
	if (user.email && (await emailReady())) {
		const text =
			kind === "invite"
				? `Hi ${user.name},\n\nYou have an account on Sekai (${publicUrl}). Your username is ${user.username}.\n\nChoose your password here (the link works once, for 7 days):\n${url}`
				: `Hi ${user.name},\n\nSomeone asked to reset your Sekai password. If it was you, choose a new one here (the link works once, for an hour):\n${url}\n\nIf it wasn't, you can ignore this email.`;
		try {
			await sendEmail(user.email, kind === "invite" ? "Your Sekai account" : "Reset your Sekai password", text);
			emailed = true;
		} catch (err) {
			log.warn(`couldn't email the ${kind} link: ${String(err)}`);
		}
	}
	return { url, emailed };
}

export async function createUser(input: UserCreateT, publicUrl: string): Promise<UserCredentials> {
	const data = parse(UserCreate, input);
	await requireRole(data.roleId);
	const now = Date.now();
	const temp = data.password === "temporary" ? temporaryPassword() : null;
	const row: UserRow = {
		id: newId("usr"),
		username: data.username,
		name: data.name,
		email: data.email,
		phone: data.phone,
		roleId: data.roleId,
		passwordHash: temp ? await hashPassword(temp) : null,
		passwordChangedAt: now,
		mustChangePassword: Boolean(temp),
		disabledAt: null,
		lastLoginAt: null,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(schema.users).values(row).catch(uniqueError);
	log.info(`account created: ${row.username}`);
	bus.emit({ type: "settings.changed" }, { to: "admins" });
	const out: UserCredentials = { user: await getManagedUser(row.id) };
	if (temp) out.temporaryPassword = temp;
	if (data.password === "invite") {
		const link = await linkFor(row, "invite", publicUrl);
		out.inviteUrl = link.url;
		out.emailed = link.emailed;
	}
	return out;
}

export async function updateUser(id: string, input: UserUpdateT, actingUserId: string): Promise<ManagedUser> {
	const patch = parse(UserUpdate, input);
	const current = await requireUserRow(id);
	const wasAdmin = await isAdminRole(current.roleId);
	if (patch.roleId !== undefined) await requireRole(patch.roleId);
	const losesAdmin =
		wasAdmin && ((patch.roleId !== undefined && !(await isAdminRole(patch.roleId))) || patch.disabled === true);
	if (losesAdmin && (await activeAdminsExcept(id)) === 0) {
		throw badRequest("Sekai needs at least one admin. Make someone else an admin first.");
	}
	if (patch.disabled === true && id === actingUserId) throw badRequest("You can't turn off your own account.");
	const set: Partial<UserRow> = { updatedAt: Date.now() };
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.email !== undefined) set.email = patch.email;
	if (patch.phone !== undefined) set.phone = patch.phone;
	if (patch.roleId !== undefined) set.roleId = patch.roleId;
	if (patch.disabled !== undefined) set.disabledAt = patch.disabled ? (current.disabledAt ?? Date.now()) : null;
	await db.update(schema.users).set(set).where(eq(schema.users.id, id)).catch(uniqueError);
	forgetPrefs(id);
	// Turned off: signed out everywhere at once (its routines and bots stop acting too).
	if (patch.disabled === true) await revokeEverything(id, { tokens: true });
	forgetCachedPrincipals();
	bus.emit({ type: "settings.changed" }, { to: [id] });
	bus.emit({ type: "settings.changed" }, { to: "admins" });
	return getManagedUser(id);
}

/** A new temporary password or reset link, and every session signed out. */
export async function resetUserPassword(
	id: string,
	how: "temporary" | "link",
	publicUrl: string,
): Promise<UserCredentials> {
	const user = await requireUserRow(id);
	await revokeEverything(id, { tokens: false });
	if (how === "temporary") {
		const temp = temporaryPassword();
		await setPassword(id, temp, true);
		return { user: await getManagedUser(id), temporaryPassword: temp };
	}
	const link = await linkFor(user, "reset", publicUrl);
	return { user: await getManagedUser(id), inviteUrl: link.url, emailed: link.emailed };
}

/**
 * "Forgot your password?": a reset link by email. Unlike an admin's reset, nothing is signed out (whoever asked may
 * not be them); choosing the new password does that.
 */
export async function sendResetLink(id: string, publicUrl: string): Promise<void> {
	const user = await requireUserRow(id);
	if (!user.email) return;
	await linkFor(user, "reset", publicUrl);
}

/** Removes someone's two-factor methods and recovery codes (they lost their phone). They set them up again. */
export async function resetUserMfa(id: string): Promise<ManagedUser> {
	await requireUserRow(id);
	await db.delete(schema.mfaFactors).where(eq(schema.mfaFactors.userId, id));
	await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, id));
	await revokeEverything(id, { tokens: false });
	return getManagedUser(id);
}

/** Deletes an account and everything in its workspace (bots, chats, memory, files…). */
export async function deleteUser(id: string, actingUserId: string): Promise<void> {
	const user = await requireUserRow(id);
	if (id === actingUserId) throw badRequest("You can't delete your own account here.");
	if ((await isAdminRole(user.roleId)) && (await activeAdminsExcept(id)) === 0) {
		throw badRequest("Sekai needs at least one admin.");
	}
	// Bots first: deleting them stops their runs and frees their computers, keys and browsers. As Sekai itself
	// (a turned-off account can't act for itself).
	const { runAs } = await import("./actor.ts");
	const { deleteAgent } = await import("../services/agents.ts");
	const agents = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.userId, id));
	await runAs(null, async () => {
		for (const a of agents)
			await deleteAgent(a.id).catch((err: unknown) => log.warn(`deleting ${a.id}: ${String(err)}`));
	});
	await revokeEverything(id, { tokens: true });
	await db.delete(schema.users).where(eq(schema.users.id, id));
	log.info(`account deleted: ${user.username}`);
	forgetCachedPrincipals();
	bus.emit({ type: "settings.changed" }, { to: "admins" });
}
