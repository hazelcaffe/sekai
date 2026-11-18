/** One KEY=value (or Header: value) per line. */
export function parseKv(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const i = line.search(/[=:]/);
		if (i <= 0) continue;
		const k = line.slice(0, i).trim();
		if (k) out[k] = line.slice(i + 1).trim();
	}
	return out;
}

export function kvText(r: Record<string, string>): string {
	return Object.entries(r)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
}

/** Splits a command line, keeping quoted segments together. */
export function splitArgs(s: string): string[] {
	return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ""));
}

export function joinArgs(args: string[]): string {
	return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}
