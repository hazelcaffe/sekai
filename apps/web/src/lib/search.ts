const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A message the server found: below anything whose title matches, above loose matches. */
export const MESSAGE_SCORE = 25;

/**
 * How well something matches what's typed, by its title first: exact (100), the title starts with it (80), a word
 * of it does (60), it's inside the title (40); then by its other words (`extra`: keywords, a label, a description):
 * every typed word starts one (30) or is inside one (20); last, the letters in order in the title (5). 0: no match.
 */
export function matchScore(query: string, title: string, extra = ""): number {
	const q = norm(query);
	if (!q) return 0;
	const t = norm(title);
	if (t === q) return 100;
	if (t.startsWith(q)) return 80;
	const titleWords = wordsOf(t);
	if (titleWords.some((w) => w.startsWith(q))) return 60;
	if (t.includes(q)) return 40;
	const typed = wordsOf(q);
	if (!typed.length) return 0;
	const hay = `${t} ${norm(extra)}`;
	const hayWords = wordsOf(hay);
	if (typed.every((w) => hayWords.some((h) => h.startsWith(w)))) return 30;
	if (typed.every((w) => hay.includes(w))) return 20;
	if (typed.length === 1 && q.length >= 3) {
		let i = 0;
		for (const ch of t) if (ch === q[i]) i++;
		if (i === q.length) return 5;
	}
	return 0;
}

/** The items that match, best first (ties keep their order). */
export function ranked<T>(
	query: string,
	items: T[],
	fields: (item: T) => [string, string?],
): { item: T; score: number }[] {
	return items
		.map((item, i) => {
			const [title, extra] = fields(item);
			return { item, score: matchScore(query, title, extra), i };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map(({ item, score }) => ({ item, score }));
}
