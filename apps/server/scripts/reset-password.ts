/**
 * Sets a new password for a Sekai account and signs it out everywhere. Run it on the server:
 *
 *   bun run reset-password                 the first admin's account; asks for the new password
 *   bun run reset-password <username>      someone else's
 *   SEKAI_NEW_PASSWORD=… bun run reset-password [username]
 *
 * With Docker: docker compose exec app bun run reset-password
 * Also turns the account back on if it was off, and, with --no-2fa, removes its two-factor sign-in (a lost phone)
 * and stops requiring a passkey to sign in (lost passkeys).
 */
import { PASSWORD_MIN } from "@sekai/shared";
import { asc, eq } from "drizzle-orm";
import { revokeEverything } from "../src/auth/service.ts";
import { closeDb, db, initDb, schema } from "../src/db/index.ts";

await initDb();
const args = process.argv.slice(2);
const no2fa = args.includes("--no-2fa");
const wanted = args.find((a) => !a.startsWith("--"))?.toLowerCase();
const rows = await db
	.select({ user: schema.users, builtin: schema.roles.builtin })
	.from(schema.users)
	.innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
	.orderBy(asc(schema.users.createdAt));
const account = wanted
	? rows.find((r) => r.user.username === wanted || r.user.email === wanted)?.user
	: (rows.find((r) => r.builtin === "admin") ?? rows[0])?.user;
if (!account) {
	console.log(
		rows.length
			? `There's no account "${wanted}". Accounts: ${rows.map((r) => r.user.username).join(", ")}`
			: "There's no account yet. Open Sekai in your browser to create it.",
	);
	await closeDb();
	process.exit(rows.length ? 1 : 0);
}
let password = process.env.SEKAI_NEW_PASSWORD ?? "";
if (!password) {
	console.log(`Resetting the password for ${account.username} (${account.name}).`);
	password = prompt(`New password (at least ${PASSWORD_MIN} characters):`) ?? "";
}
if (password.length < PASSWORD_MIN) {
	console.error(`The password needs at least ${PASSWORD_MIN} characters. Nothing changed.`);
	await closeDb();
	process.exit(1);
}
const now = Date.now();
await db
	.update(schema.users)
	.set({
		passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }),
		passwordChangedAt: now,
		mustChangePassword: false,
		disabledAt: null,
		updatedAt: now,
	})
	.where(eq(schema.users.id, account.id));
if (no2fa) {
	await db.delete(schema.mfaFactors).where(eq(schema.mfaFactors.userId, account.id));
	await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, account.id));
	await db.update(schema.users).set({ requirePasskey: false }).where(eq(schema.users.id, account.id));
}
await revokeEverything(account.id, { tokens: false });
console.log(
	`Done. Sign in as ${account.username} with the new password${no2fa ? " (two-factor sign-in and any required passkey removed)" : ""}; every device was signed out.`,
);
await closeDb();
