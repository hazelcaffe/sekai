import { formatTokens } from "@sekai/client";
import { type ReactNode, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, BarStack, CartesianGrid, Line, Tooltip, XAxis, YAxis } from "recharts";
import { type ChartRow, type Grain, longLabel, money, moneyTick, tickLabel, tokensTick } from "./format.ts";
import { BACKGROUND, REPLY, type Series, type Stack } from "./series.ts";

/**
 * The recharts parts of Usage, loaded on their own so the rest of Admin doesn't carry the library. Colors and text
 * come from the theme's CSS variables, so the charts follow the theme and dark mode.
 */

const SYNC = "usage";
const TICK = { fill: "var(--fg-subtle)", fontSize: 11 };
const axis = { axisLine: false, tickLine: false, tick: TICK } as const;

type Datum = Record<string, number | string>;
type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> };

/** 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number): number {
	const pow = 10 ** Math.floor(Math.log10(raw));
	return ([1, 2, 2.5, 5].find((m) => m * pow >= raw * (1 - 1e-9)) ?? 10) * pow;
}

/** Round ticks from 0 past `max`: about `count` steps, or exactly `steps` (to line up with another axis). */
function ticksFor(max: number, { count = 4, steps }: { count?: number; steps?: number } = {}): number[] | undefined {
	if (!(max > 0)) return undefined;
	const step = niceStep(max / (steps ?? count));
	const n = steps ?? Math.ceil(max / step - 1e-9);
	return Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

const datumOf = (p: TipProps): Datum | null => {
	const d = p.active ? p.payload?.[0]?.payload : null;
	return d && typeof d === "object" ? (d as Datum) : null;
};
const num = (v: number | string | undefined) => (typeof v === "number" ? v : 0);

function Tip({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="min-w-44 max-w-64 rounded-xl border border-border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-pop">
			<div className="mb-1.5 font-medium">{title}</div>
			<div className="flex flex-col gap-1">{children}</div>
		</div>
	);
}

function TipRow({ color, label, value, strong }: { color?: string; label: string; value: string; strong?: boolean }) {
	return (
		<div className="flex items-center gap-2 tabular-nums">
			{color ? (
				<span className="size-2 shrink-0 rounded-[3px]" style={{ background: color }} />
			) : (
				<span className="size-2 shrink-0" />
			)}
			<span className={strong ? "font-medium" : "min-w-0 truncate text-fg-muted"}>{label}</span>
			<span className={strong ? "ml-auto pl-3 font-semibold" : "ml-auto pl-3"}>{value}</span>
		</div>
	);
}

/** Tokens per hour, day or week, stacked by model or bot, with what it cost on a second axis. */
export function TokensChart({
	rows,
	series,
	stack,
	grain,
	showCost,
	narrow,
	height = 260,
}: {
	rows: ChartRow[];
	/** The visible ones, bottom of the stack first. */
	series: Series[];
	stack: Stack;
	grain: Grain;
	showCost: boolean;
	narrow: boolean;
	height?: number;
}) {
	const data = useMemo(
		() =>
			rows.map((row) => {
				const values = stack === "model" ? row.models : row.agents;
				const d: Datum = { key: row.key, cost: row.cost ?? 0 };
				for (const s of series) d[s.key] = values[s.id] ?? 0;
				return d;
			}),
		[rows, series, stack],
	);
	// Our own round ticks (recharts' can land on 950k), the cost axis's lined up with the token axis's grid.
	const tokenTicks = ticksFor(Math.max(0, ...data.map((d) => series.reduce((n, s) => n + num(d[s.key]), 0))));
	const costTicks = ticksFor(Math.max(0, ...rows.map((r) => r.cost ?? 0)), {
		steps: tokenTicks ? tokenTicks.length - 1 : 4,
	});
	const many = rows.length > 60;
	return (
		<BarChart
			responsive
			style={{ width: "100%", height }}
			data={data}
			syncId={SYNC}
			margin={{ top: 8, right: showCost && !narrow ? 0 : 4, bottom: 0, left: 0 }}
			barCategoryGap={many ? 1 : "20%"}
		>
			<CartesianGrid vertical={false} stroke="var(--border)" />
			<XAxis
				dataKey="key"
				{...axis}
				tickFormatter={(k: string) => tickLabel(k, grain)}
				minTickGap={narrow ? 12 : 24}
				tickMargin={6}
			/>
			<YAxis
				yAxisId="tokens"
				{...axis}
				width={narrow ? 38 : 44}
				ticks={tokenTicks}
				domain={tokenTicks ? [0, tokenTicks.at(-1) ?? "auto"] : undefined}
				interval={0}
				tickFormatter={(v: number) => tokensTick(v)}
			/>
			{showCost && (
				<YAxis
					yAxisId="cost"
					orientation="right"
					{...axis}
					hide={narrow}
					width={44}
					ticks={costTicks}
					domain={costTicks ? [0, costTicks.at(-1) ?? "auto"] : undefined}
					interval={0}
					tickFormatter={(v: number) => moneyTick(v)}
				/>
			)}
			<Tooltip
				cursor={{ fill: "var(--muted)", stroke: "none" }}
				isAnimationActive={false}
				wrapperStyle={{ outline: "none", zIndex: 20 }}
				content={(p: TipProps) => {
					const d = datumOf(p);
					if (!d) return null;
					const shown = series.filter((s) => num(d[s.key]) > 0).reverse();
					const total = series.reduce((n, s) => n + num(d[s.key]), 0);
					return (
						<Tip title={longLabel(String(d.key), grain)}>
							{shown.map((s) => (
								<TipRow
									key={s.key}
									color={s.color}
									label={s.name}
									value={formatTokens(num(d[s.key]))}
								/>
							))}
							{shown.length === 0 && <span className="text-fg-subtle">Nothing used</span>}
							{shown.length > 1 && <TipRow label="Total" value={formatTokens(total)} strong />}
							{showCost && num(d.cost) > 0 && <TipRow label="Cost" value={money(num(d.cost))} strong />}
						</Tip>
					);
				}}
			/>
			<BarStack radius={[3, 3, 0, 0]}>
				{series.map((s) => (
					<Bar
						key={s.key}
						dataKey={s.key}
						name={s.name}
						yAxisId="tokens"
						fill={s.color}
						maxBarSize={36}
						animationDuration={500}
					/>
				))}
			</BarStack>
			{showCost && (
				<Line
					yAxisId="cost"
					dataKey="cost"
					name="Cost"
					type="monotone"
					stroke="var(--fg)"
					strokeWidth={1.5}
					strokeOpacity={0.75}
					dot={false}
					activeDot={{ r: 3.5, fill: "var(--fg)", stroke: "var(--card)", strokeWidth: 2 }}
					animationDuration={500}
				/>
			)}
		</BarChart>
	);
}

/** Replies and background work, stacked, on the same time axis (hovering one chart shows the other's point too). */
export function SplitChart({
	rows,
	grain,
	narrow,
	height = 150,
}: {
	rows: ChartRow[];
	grain: Grain;
	narrow: boolean;
	height?: number;
}) {
	const data = useMemo(() => rows.map((r) => ({ key: r.key, reply: r.reply, background: r.background })), [rows]);
	const ticks = ticksFor(Math.max(0, ...rows.map((r) => r.reply + r.background)), { count: 3 });
	return (
		<AreaChart
			responsive
			style={{ width: "100%", height }}
			data={data}
			syncId={SYNC}
			margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
		>
			<CartesianGrid vertical={false} stroke="var(--border)" />
			<XAxis
				dataKey="key"
				{...axis}
				tickFormatter={(k: string) => tickLabel(k, grain)}
				minTickGap={narrow ? 12 : 24}
				tickMargin={6}
			/>
			<YAxis
				{...axis}
				width={narrow ? 38 : 44}
				ticks={ticks}
				domain={ticks ? [0, ticks.at(-1) ?? "auto"] : undefined}
				interval={0}
				tickFormatter={(v: number) => tokensTick(v)}
			/>
			<Tooltip
				cursor={{ stroke: "var(--border-strong)" }}
				isAnimationActive={false}
				wrapperStyle={{ outline: "none", zIndex: 20 }}
				content={(p: TipProps) => {
					const d = datumOf(p);
					if (!d) return null;
					const reply = num(d.reply);
					const background = num(d.background);
					return (
						<Tip title={longLabel(String(d.key), grain)}>
							<TipRow color={REPLY} label="Replies" value={formatTokens(reply)} />
							<TipRow color={BACKGROUND} label="Background" value={formatTokens(background)} />
						</Tip>
					);
				}}
			/>
			<Area
				dataKey="background"
				name="Background"
				stackId="purpose"
				type="monotone"
				stroke={BACKGROUND}
				fill={BACKGROUND}
				fillOpacity={0.28}
				strokeWidth={1.5}
				animationDuration={500}
			/>
			<Area
				dataKey="reply"
				name="Replies"
				stackId="purpose"
				type="monotone"
				stroke={REPLY}
				fill={REPLY}
				fillOpacity={0.32}
				strokeWidth={1.5}
				animationDuration={500}
			/>
		</AreaChart>
	);
}
