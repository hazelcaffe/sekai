import type { Note } from "@sekai/shared";

/** The first words of a note, without its Markdown marks (and without its own title line), for a list row. */
export function snippet(n: Pick<Note, "title" | "content">): string {
	const lines = n.content
		.split("\n")
		.map((l) =>
			l
				.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, "")
				.replace(/[*_`]/g, "")
				.trim(),
		)
		.filter(Boolean);
	if (lines[0]?.toLowerCase() === n.title.trim().toLowerCase()) lines.shift();
	return lines.join(" · ").slice(0, 140);
}
