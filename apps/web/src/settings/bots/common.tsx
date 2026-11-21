import { api, qk } from "@sekai/client";
import { type SettingsUpdate, TOOL_CATEGORIES } from "@sekai/shared";
import { useAutosave } from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

/** Extracts the host from a URL without throwing on partial or malformed values. */
export function safeHost(url: string | null | undefined): string {
	if (!url) return "";
	try {
		return new URL(url).host;
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
}

/**
 * Autosave for partial updates (one key per control). useAutosave keeps only the latest waiting value, so changes
 * made while a save is on its way are merged into it instead of replacing it.
 */
export function usePatchAutosave<P extends object>(write: (patch: P) => Promise<unknown>) {
	const unsent = useRef<Partial<P>>({});
	const autosave = useAutosave(async (patch: P) => {
		await write(patch);
		const rest: Partial<P> = { ...unsent.current };
		for (const key of Object.keys(patch) as (keyof P)[]) if (rest[key] === patch[key]) delete rest[key];
		unsent.current = rest;
	});
	const { save: send } = autosave;
	const save = useCallback(
		(patch: P) => {
			unsent.current = { ...unsent.current, ...patch };
			send(unsent.current as P);
		},
		[send],
	);
	return { ...autosave, save };
}

/** Autosaves server or personal settings and keeps the query cache in step, without a toast. */
export function useSettingsAutosave() {
	const qc = useQueryClient();
	return usePatchAutosave(async (patch: SettingsUpdate) => {
		const next = await api.settings.update(patch);
		qc.setQueryData(qk.settings, next);
		return next;
	});
}

/**
 * Where to go back to after a form opened from elsewhere (`?return=/bots/…/tools`): a path inside this app, never
 * another site (no `//host`, `/\host`, schemes, spaces or control characters).
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const path = raw.trim();
	if (!/^\/[^/\\]/.test(path) || /[\\\s\p{Cc}]/u.test(path)) return null;
	try {
		const base = "https://sekai.invalid";
		const url = new URL(path, base);
		return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
	} catch {
		return null;
	}
}

/** Extracts the bot id when a return path points into `/bots/:agentId/…`. */
export function botIdFromPath(path: string | null | undefined): string | null {
	if (!path) return null;
	const match = /^\/bots\/([^/?#]+)/.exec(path);
	return match?.[1] ?? null;
}

/**
 * What a rule's key covers: a kind of tool (`category:memory` → Memory), every tool of an app (`category:mcp:github`
 * → github), or one tool, by its name (as a bot's Tools & access shows it).
 */
export function formatRuleKey(key: string): { label: string; covers: "kind" | "app" | "tool" } {
	if (key.startsWith("category:mcp:")) return { label: key.slice("category:mcp:".length), covers: "app" };
	if (key.startsWith("category:")) {
		const kind = key.slice("category:".length);
		return {
			label: (TOOL_CATEGORIES as Record<string, string>)[kind] ?? kind.replace(/[_-]+/g, " "),
			covers: "kind",
		};
	}
	return { label: key, covers: "tool" };
}
