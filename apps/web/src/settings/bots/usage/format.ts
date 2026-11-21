import type { UsageBucket, UsageReport, UsageTotals } from "@sekai/shared";

export type Range = "1" | "7" | "30" | "90" | "365";

export const RANGES: { value: Range; short: string; label: string; before: string }[] = [
	{ value: "1", short: "24h", label: "24 hours", before: "the 24 hours before" },
	{ value: "7", short: "7d", label: "7 days", before: "the week before" },
	{ value: "30", short: "30d", label: "30 days", before: "the 30 days before" },
	{ value: "90", short: "90d", label: "90 days", before: "the 90 days before" },
	{ value: "365", short: "1y", label: "1 year", before: "the year before" },
];

export const TRIGGER_LABEL: Record<string, string> = {
	user: "You, in Sekai",
	channel: "Discord & Slack",
	group: "Group chats",
	routine: "Routines",
	reminder: "Reminders",
	ask: "Bots asking bots",
	handoff: "Handoffs",
	test: "Routine tests",
	outreach: "Bots reaching you",
	retry: "Retries",
	regenerate: "Regenerated",
};

export const tokensOf = (t: UsageTotals) => t.inputTokens + t.outputTokens;

/** "2,531 calls". */
export const calls = (n: number) => `${n.toLocaleString()} ${n === 1 ? "call" : "calls"}`;

export function money(n: number): string {
	if (n > 0 && n < 0.01) return "<$0.01";
	const digits = n < 10 ? 2 : 0;
	return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Shorter, for an axis: "$0.80", "$12", "$1.5k". */
export function moneyTick(n: number): string {
	if (Number.isInteger(n) && n < 1000) return `$${n}`;
	if (n < 0.01) return `$${Number(n.toPrecision(2))}`;
	if (n < 10) return `$${n.toFixed(2)}`;
	if (n < 1000) return `$${Math.round(n)}`;
	return `$${Number((n / 1000).toFixed(1))}k`;
}

/** Tokens for an axis: "750k", "1.5M" (formatTokens' "1.00M" is too wide there). */
export function tokensTick(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${Number((n / 1000).toFixed(n < 10_000 ? 1 : 0))}k`;
	return `${Number((n / 1_000_000).toFixed(1))}M`;
}

export function seconds(s: number): string {
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${Math.round(s % 60)}s`;
}

/** The change from the period before, as a fraction; null when there's nothing to compare with. */
export function change(now: number, before: number): number | null {
	if (!before) return null;
	return (now - before) / before;
}

/** "2026-11-17" or "2026-11-17 14" as a Date whose UTC fields are that wall-clock time in the report's zone. */
function wall(key: string): Date {
	const [date = "", hour] = key.split(" ");
	const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d, hour ? Number(hour) : 0));
}

const utc = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...o, timeZone: "UTC" });
const HOUR = utc({ hour: "numeric" });
const DAY = utc({ month: "short", day: "numeric" });
const DAY_LONG = utc({ weekday: "long", month: "long", day: "numeric" });
const DAY_LONG_YEAR = utc({ weekday: "long", month: "long", day: "numeric", year: "numeric" });
const DAY_HOUR = utc({ weekday: "short", month: "short", day: "numeric" });
const WEEK = utc({ month: "long", day: "numeric", year: "numeric" });

export type Grain = "hour" | "day" | "week";

/** An axis label: "2 PM" (with the date at midnight), "Nov 17". */
export function tickLabel(key: string, grain: Grain): string {
	const d = wall(key);
	if (grain === "hour") return d.getUTCHours() === 0 ? DAY.format(d) : HOUR.format(d);
	return DAY.format(d);
}

/** A tooltip's title: "Tue, Nov 17, 2 PM – 3 PM", "Tuesday, November 17", "Week of November 10, 2026". */
export function longLabel(key: string, grain: Grain): string {
	const d = wall(key);
	if (grain === "hour") {
		const next = new Date(d.getTime() + 3_600_000);
		return `${DAY_HOUR.format(d)}, ${HOUR.format(d)} – ${HOUR.format(next)}`;
	}
	if (grain === "week") return `Week of ${WEEK.format(d)}`;
	return (d.getUTCFullYear() === new Date().getFullYear() ? DAY_LONG : DAY_LONG_YEAR).format(d);
}

/** "12 AM", "3 PM" (or "00", "15" where clocks are 24-hour). */
export const hourLabel = (h: number) => HOUR.format(new Date(Date.UTC(2026, 0, 5, h)));

/** Monday first, like the heatmap's rows. */
export const WEEKDAYS = Array.from({ length: 7 }, (_, i) => {
	const d = new Date(Date.UTC(2026, 0, 5 + i));
	return {
		short: utc({ weekday: "short" }).format(d),
		long: utc({ weekday: "long" }).format(d),
	};
});

export interface ChartRow {
	key: string;
	tokens: number;
	cost: number | null;
	reply: number;
	background: number;
	models: Record<string, number>;
	agents: Record<string, number>;
}

const add = (into: Record<string, number>, from: Record<string, number>) => {
	for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};

/** The report's bars, folded into weeks (starting Monday) when there are too many days to tell apart. */
export function chartRows(r: UsageReport): { grain: Grain; rows: ChartRow[] } {
	const one = (b: UsageBucket): ChartRow => ({
		key: b.key,
		tokens: tokensOf(b),
		cost: b.cost,
		reply: b.reply,
		background: b.background,
		models: { ...b.models },
		agents: { ...b.agents },
	});
	if (r.bucket === "hour" || r.buckets.length <= 120) {
		return { grain: r.bucket === "hour" ? "hour" : "day", rows: r.buckets.map(one) };
	}
	const weeks = new Map<string, ChartRow>();
	for (const b of r.buckets) {
		const d = wall(b.key);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		const key = d.toISOString().slice(0, 10);
		const w = weeks.get(key);
		if (!w) {
			weeks.set(key, { ...one(b), key });
			continue;
		}
		w.tokens += tokensOf(b);
		w.cost = w.cost === null && b.cost === null ? null : (w.cost ?? 0) + (b.cost ?? 0);
		w.reply += b.reply;
		w.background += b.background;
		add(w.models, b.models);
		add(w.agents, b.agents);
	}
	return { grain: "week", rows: [...weeks.values()] };
}

/** "claude-sonnet-5-5" → anthropic, for its logo. */
export function guessVendor(model: string): string | null {
	const id = model.toLowerCase();
	if (/claude/.test(id)) return "anthropic";
	if (/gpt|o\d|codex|whisper/.test(id)) return "openai";
	if (/gemini|gemma/.test(id)) return "google";
	if (/grok/.test(id)) return "xai";
	if (/deepseek/.test(id)) return "deepseek";
	if (/qwen/.test(id)) return "qwen";
	if (/kimi|moonshot/.test(id)) return "moonshot";
	if (/glm/.test(id)) return "zai";
	if (/nemotron|nvidia/.test(id)) return "nvidia";
	if (/mistral|codestral/.test(id)) return "mistral";
	return null;
}
