/** A short preview is often cut mid-markup by the server. Keep the words, not the formatting. */
export function chatPreview(text: string | null | undefined): string {
	return (text ?? "")
		.replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/gm, "")
		.replace(/!?\[([^\]\n]+)\]\([^)\n]*(?:\)|$)/g, "$1")
		.replace(/^\s*(?:```|~~~)[\w+-]*\s*$/gm, "")
		.replace(/\$\$[\s\S]*?(?:\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)/g, " [formula] ")
		.replace(/\\\((.*?)\\\)|(?<![\w\\$])\$(?!\s)([^$\n]+?)\$(?![\w$])/g, (match, parens, dollars) => {
			const math = parens ?? dollars;
			return math.includes("\\") ? "[formula]" : /^\d/.test(math) ? match : math;
		})
		.replace(/(\*{1,3}|_{1,3}|~~)(?=\S)(.*?\S)\1/g, "$2")
		.replace(/`+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
