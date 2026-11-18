const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * `length` random characters from `alphabet`, each equally likely: bytes past the last whole multiple of the
 * alphabet's size are thrown away (a plain `byte % size` would favour the first characters).
 */
export function randomChars(alphabet: string, length: number): string {
	const limit = 256 - (256 % alphabet.length);
	let out = "";
	while (out.length < length) {
		for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
			if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
		}
	}
	return out;
}

/** Random, URL-safe id with a type prefix, e.g. "agt_4fK9…". 16 chars ≈ 95 bits. */
export function newId(prefix: string, length = 16): string {
	return `${prefix}_${randomChars(ALPHABET, length)}`;
}

export const ID = {
	agent: () => newId("agt"),
	conversation: () => newId("cnv"),
	message: () => newId("msg"),
	memory: () => newId("mem"),
	note: () => newId("note"),
	routine: () => newId("rtn"),
	routineRun: () => newId("rr"),
	run: () => newId("run"),
	skill: () => newId("skl"),
	mcp: () => newId("mcp"),
	upload: () => newId("upl", 22),
};
