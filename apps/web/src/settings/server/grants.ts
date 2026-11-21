/**
 * Who let a bot onto a device, in people's words, from a grant's `grantedBy`: "user" (given in Settings) and an
 * approved request are you; the approvals rules by their names; another bot as itself. Older grants stored the
 * mode's name ("yolo", "YOLO mode", "approved (auto mode)"), so those read the same.
 */
export function grantedByWords(by: string): string {
	const s = by.trim();
	if (/^(user|the user|manual|you)$/i.test(s)) return "you";
	if (/yolo|don't ask/i.test(s)) return "the Don't ask rule";
	if (/^(auto|the reviewer|reviewer)$|auto mode/i.test(s)) return "the reviewer";
	if (/^(primary|the primary bot)$/i.test(s)) return "the primary bot";
	const bot = s.match(/^(.+?) \(primary bot\)$/);
	if (bot?.[1]) return `${bot[1]}, the primary bot`;
	return s || "you";
}
