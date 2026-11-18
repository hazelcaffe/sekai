import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Encryption at rest for secrets Sekai keeps for you: bots' SSH keys, machine passwords and saved logins.
 * The key is SEKAI_SECRET_KEY, or a random one created once in the data folder (readable only by you).
 * Losing that file makes saved secrets unreadable, so back it up with the database.
 */

let key: Buffer | null = null;

function secretKey(): Buffer {
	if (key) return key;
	const fromEnv = process.env.SEKAI_SECRET_KEY?.trim();
	if (fromEnv) {
		key = createHash("sha256").update(fromEnv).digest();
		return key;
	}
	const file = join(config.dataDir, "secret.key");
	if (!existsSync(file)) {
		writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
		chmodSync(file, 0o600);
	}
	key = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
	if (key.length !== 32) throw new Error(`${file} must hold 32 bytes of hex`);
	return key;
}

/** Encrypts a string (AES-256-GCM). */
export function seal(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function unseal(sealed: string): string {
	if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format");
	const raw = Buffer.from(sealed.slice(3), "base64");
	const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(12, 28));
	return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sealJson(value: unknown): string {
	return seal(JSON.stringify(value));
}

export function unsealJson<T>(sealed: string): T {
	return JSON.parse(unseal(sealed)) as T;
}

/** A password that's easy to type into a VNC or sudo prompt: letters and digits, no look-alikes. */
export function randomPassword(length = 20): string {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	// Rejection sampling keeps every character equally likely.
	const limit = 256 - (256 % alphabet.length);
	let out = "";
	while (out.length < length) {
		for (const b of randomBytes(length * 2)) {
			if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
		}
	}
	return out;
}
