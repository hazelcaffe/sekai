const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random, URL-safe id with a type prefix, e.g. "agt_4fK9…". 16 chars ≈ 95 bits. */
export function newId(prefix: string, length = 16): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = "";
	for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
	return `${prefix}_${out}`;
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
