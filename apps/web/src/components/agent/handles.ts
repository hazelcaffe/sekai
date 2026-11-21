/** "@a, @b" for the field. */
export const handlesText = (list: string[]): string => list.map((h) => `@${h}`).join(", ");

/** "@a, https://x.com/B c" → ["a", "b", "c"], with the platform's own way of cleaning a handle. */
export const parseHandles = (text: string, clean: (h: string) => string): string[] =>
	text
		.split(/[\s,]+/)
		.map(clean)
		.filter(Boolean);
