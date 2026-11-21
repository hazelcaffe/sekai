import type { ModelInfo } from "@sekai/shared";

export { cn, copyText } from "@sekai/ui";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

export function timeAgo(ms: number, now = Date.now()): string {
	const diff = ms - now;
	const abs = Math.abs(diff);
	if (abs < 45_000) return diff > 0 ? "in a moment" : "just now";
	if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
	if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
	if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** 9:41 AM today, then Yesterday, a weekday within the week, and a date after that. */
export function shortTime(ms: number): string {
	const d = new Date(ms);
	const today = new Date();
	if (d.toDateString() === today.toDateString()) {
		return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	}
	const days = Math.round(
		(new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
	);
	if (days === 1) return "Yesterday";
	if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dateTime(ms: number, timeZone?: string): string {
	return new Date(ms).toLocaleString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone,
	});
}

export function dayLabel(ms: number): string {
	const d = new Date(ms);
	const today = new Date();
	const yesterday = new Date(Date.now() - 86_400_000);
	if (d.toDateString() === today.toDateString()) return "Today";
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
	});
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
	if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;
	return `${(n / 1024 ** 4).toFixed(1)} TB`;
}

export function modelName(models: ModelInfo[] | undefined, id: string): string {
	return models?.find((m) => m.id === id)?.name ?? id;
}

export const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	xai: "xAI",
	moonshotai: "Moonshot",
	zai: "Z.ai",
	deepseek: "DeepSeek",
	qwen: "Qwen",
	nvidia: "NVIDIA",
};

export function providerLabel(id: string): string {
	return PROVIDER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
	return `${n} ${n === 1 ? word : plural}`;
}
