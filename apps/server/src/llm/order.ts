import type { ModelInfo } from "@sekai/shared";

/**
 * The version in a model's name ("GPT-6.2 Astra" → [6, 2], "Qwen3 32B" → [3]). Sizes ("27B") and longer numbers
 * ("Grok 420", dates like 2507) aren't versions.
 */
export function modelVersion(name: string): number[] {
	const match = /(?<!\d)(\d{1,2}(?:\.\d+)*)(?![\d.]|[bB]\b)/.exec(name);
	return match?.[1] ? match[1].split(".").map(Number) : [];
}

function compareVersions(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0) return (a.length === 0 ? 1 : 0) - (b.length === 0 ? 1 : 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (b[i] ?? 0) - (a[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

/**
 * Each provider's models newest first, providers in the order they first appear. Gateways add new models at the end
 * of their list, which buried them at the bottom of the picker and left them out of chat apps' short model menus.
 * Models of the same version keep their listed order.
 */
export function newestFirst(models: ModelInfo[]): ModelInfo[] {
	const groups = new Map<string, ModelInfo[]>();
	for (const m of models) {
		const key = m.api ? `api:${m.api.providerId}` : m.provider;
		const group = groups.get(key);
		if (group) group.push(m);
		else groups.set(key, [m]);
	}
	return [...groups.values()].flatMap((group) =>
		group
			.map((m) => ({ m, v: modelVersion(m.name) }))
			.sort((a, b) => compareVersions(a.v, b.v))
			.map(({ m }) => m),
	);
}
