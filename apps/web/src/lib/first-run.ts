/**
 * Where "/" goes for someone with no bots yet: the first-bot welcome (`/welcome`) for people who may make bots and
 * haven't skipped it, else the app itself, with its "No bots yet" empty state (bots shared with them show up there).
 */
export function firstRunTarget(p: { bots: number; canMakeBots: boolean; skipped: boolean }): "welcome" | "app" {
	return p.bots === 0 && p.canMakeBots && !p.skipped ? "welcome" : "app";
}
