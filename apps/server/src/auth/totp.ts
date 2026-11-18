/**
 * Authenticator-app codes (TOTP, RFC 6238): HMAC-SHA1 over 30-second steps, 6 digits, the secret in base32.
 * Works with Google Authenticator, 1Password, Authy, Bitwarden, Aegis and the rest.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(text: string): Uint8Array {
	const clean = text.toUpperCase().replace(/[\s=-]/g, "");
	const out: number[] = [];
	let bits = 0;
	let value = 0;
	for (const ch of clean) {
		const i = ALPHABET.indexOf(ch);
		if (i < 0) throw new Error("Not a base32 secret");
		value = (value << 5) | i;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

/** A new secret: 20 random bytes (160 bits, what RFC 4226 recommends). */
export function newTotpSecret(): string {
	return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpAt(secret: string, step: number): Promise<string> {
	const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, [
		"sign",
	]);
	const counter = new Uint8Array(8);
	new DataView(counter.buffer).setBigUint64(0, BigInt(step));
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
	const offset = (mac[mac.length - 1] ?? 0) & 0xf;
	const bin =
		(((mac[offset] ?? 0) & 0x7f) << 24) |
		((mac[offset + 1] ?? 0) << 16) |
		((mac[offset + 2] ?? 0) << 8) |
		(mac[offset + 3] ?? 0);
	return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(now = Date.now()): number {
	return Math.floor(now / 1000 / STEP_SECONDS);
}

/**
 * The step a code matches (this one, or one before or after, for clocks a little off), or null. Codes from a step
 * already used (lastStep) are refused, so a code can't be used twice.
 */
export async function verifyTotp(
	secret: string,
	code: string,
	lastStep: number | null,
	now = Date.now(),
): Promise<number | null> {
	if (!/^\d{6}$/.test(code)) return null;
	const step = currentStep(now);
	for (const s of [step, step - 1, step + 1]) {
		if (lastStep !== null && s <= lastStep) continue;
		const expected = await totpAt(secret, s);
		if (timingSafeEqual(expected, code)) return s;
	}
	return null;
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** The link authenticator apps read from the QR code. */
export function totpUri(secret: string, account: string, issuer = "Sekai"): string {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const q = new URLSearchParams({
		secret,
		issuer,
		algorithm: "SHA1",
		digits: String(DIGITS),
		period: String(STEP_SECONDS),
	});
	return `otpauth://totp/${label}?${q}`;
}
