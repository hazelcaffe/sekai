import { AgentAvatar, api, BrandGlyph, formatTokens } from "@sekai/client";
import type { ModelPrice, UsageReport } from "@sekai/shared";
import { Badge, Button, Input, Section } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { calls, money, TRIGGER_LABEL, tokensOf } from "./format.ts";
import { type Names, seriesColor } from "./series.ts";
import { Meter, percent } from "./ui.tsx";

const FIRST = 8;

/** A bordered list that shows the biggest few, then the rest on request. */
function List<T>({ items, render, empty }: { items: T[]; render: (item: T) => ReactNode; empty: string }) {
	const [all, setAll] = useState(false);
	const shown = all ? items : items.slice(0, FIRST);
	return (
		<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
			{items.length === 0 && <p className="px-4 py-3 text-[13px] text-fg-subtle">{empty}</p>}
			{shown.map(render)}
			{items.length > FIRST && (
				<button
					type="button"
					onClick={() => setAll(!all)}
					className="px-4 py-2.5 text-left text-[13px] font-medium text-fg-muted hover:bg-muted hover:text-fg coarse:py-3.5"
				>
					{all ? "Show fewer" : `Show all ${items.length}`}
				</button>
			)}
		</div>
	);
}

/** Name and numbers on one line, a bar for the share under them, and a quieter line below. */
function Row({
	icon,
	name,
	badge,
	numbers,
	value,
	max,
	color,
	below,
}: {
	icon: ReactNode;
	name: string;
	badge?: ReactNode;
	numbers: ReactNode;
	value: number;
	max: number;
	color: string;
	below?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-3">
			{icon}
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="truncate text-sm font-medium">{name}</span>
					{badge}
					<span className="ml-auto shrink-0 text-xs text-fg-muted tabular-nums">{numbers}</span>
				</div>
				<Meter value={value} max={max} color={color} className="mt-1.5" />
				{below && (
					<div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle tabular-nums">
						{below}
					</div>
				)}
			</div>
		</div>
	);
}

const colorIn = (ids: string[], id: string) => {
	const i = ids.indexOf(id);
	return i >= 0 ? seriesColor(i, id) : "var(--usage-other)";
};

export function BotList({ r, names }: { r: UsageReport; names: Names }) {
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byAgent.map(tokensOf));
	const ids = r.topAgents.map((a) => a.id);
	return (
		<Section title="By bot" description="Everything each bot used, replies and background work.">
			<List
				items={r.byAgent}
				empty="Nothing yet."
				render={(a) => {
					const avatar = names.avatar(a.agentId);
					return (
						<div key={a.agentId ?? "none"} className="px-4 py-3">
							<Row
								icon={
									avatar ? (
										<AgentAvatar avatar={avatar} size={32} />
									) : (
										<span className="size-8 shrink-0 rounded-full bg-muted" />
									)
								}
								name={a.name}
								numbers={
									<>
										{formatTokens(tokensOf(a))}
										{a.cost !== null ? ` · ${money(a.cost)}` : ""}
									</>
								}
								value={tokensOf(a)}
								max={max}
								color={colorIn(ids, a.agentId ?? "none")}
								below={
									<>
										<span>{percent(tokensOf(a), total)}% of all</span>
										<span>·</span>
										<span>{calls(a.calls)}</span>
									</>
								}
							/>
						</div>
					);
				}}
			/>
		</Section>
	);
}

function PriceEditor({ model, price, onDone }: { model: string; price: ModelPrice | null; onDone: () => void }) {
	const qc = useQueryClient();
	const [input, setInput] = useState(price ? String(price.input) : "");
	const [output, setOutput] = useState(price ? String(price.output) : "");
	const save = useMutation({
		mutationFn: (p: ModelPrice | null) => api.usage.setPrice(model, p),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["usage"] });
			onDone();
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const ok = (s: string) => s.trim() !== "" && !Number.isNaN(Number(s)) && Number(s) >= 0;
	const valid = ok(input) && ok(output);
	return (
		<form
			className="flex flex-wrap items-center gap-2 pt-2.5 pl-11 text-xs"
			onSubmit={(e) => {
				e.preventDefault();
				if (valid) save.mutate({ input: Number(input), output: Number(output) });
			}}
		>
			<span className="w-full text-fg-muted sm:w-auto">$ per million tokens:</span>
			<span className="flex items-center gap-1">
				in
				<Input
					autoFocus
					inputMode="decimal"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					className="h-7 w-20 text-xs coarse:h-9"
					aria-label="Input price"
				/>
			</span>
			<span className="flex items-center gap-1">
				out
				<Input
					inputMode="decimal"
					value={output}
					onChange={(e) => setOutput(e.target.value)}
					className="h-7 w-20 text-xs coarse:h-9"
					aria-label="Output price"
				/>
			</span>
			<span className="flex items-center gap-1">
				<Button type="submit" size="xs" variant="primary" disabled={!valid || save.isPending}>
					Save
				</Button>
				{price && (
					<Button type="button" size="xs" variant="ghost" onClick={() => save.mutate(null)}>
						Clear
					</Button>
				)}
				<Button type="button" size="xs" variant="ghost" onClick={onDone}>
					Cancel
				</Button>
			</span>
		</form>
	);
}

function ModelRow({
	m,
	max,
	total,
	color,
	names,
	canPrice,
}: {
	m: UsageReport["byModel"][number];
	max: number;
	total: number;
	color: string;
	names: Names;
	canPrice: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const brand = names.brand(m.model);
	const name = names.model(m.model);
	return (
		<div className="px-4 py-3">
			<Row
				icon={
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-fg-muted">
						{brand ? (
							<BrandGlyph brand={brand} size={16} />
						) : (
							<span className="text-[11px] font-semibold">AI</span>
						)}
					</span>
				}
				name={name}
				numbers={
					<>
						{formatTokens(tokensOf(m))} · {calls(m.calls)}
					</>
				}
				value={tokensOf(m)}
				max={max}
				color={color}
				below={
					<>
						<span>
							{formatTokens(m.inputTokens)} in · {formatTokens(m.outputTokens)} out ·{" "}
							{percent(tokensOf(m), total)}%
						</span>
						<span className="ml-auto">
							{m.price ? (
								<>
									{money(m.cost ?? 0)}{" "}
									<span className="text-fg-subtle">
										(${m.price.input} / ${m.price.output})
									</span>
								</>
							) : (
								"No price set"
							)}
						</span>
						{canPrice && !editing && (
							<button
								type="button"
								onClick={() => setEditing(true)}
								className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg coarse:py-1"
								aria-label={`Set the price for ${name}`}
							>
								<Pencil className="size-3" /> Price
							</button>
						)}
					</>
				}
			/>
			{editing && <PriceEditor model={m.model} price={m.price} onDone={() => setEditing(false)} />}
		</div>
	);
}

export function ModelList({ r, names, canPrice }: { r: UsageReport; names: Names; canPrice: boolean }) {
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byModel.map(tokensOf));
	return (
		<Section
			title="By model"
			description={
				canPrice
					? "Set a model's price (US dollars per million tokens) to see what it costs; Sekai doesn't know your gateway's prices."
					: "Costs use the prices your admin set."
			}
		>
			<List
				items={r.byModel}
				empty="Nothing yet."
				render={(m) => (
					<ModelRow
						key={m.model}
						m={m}
						max={max}
						total={total}
						color={colorIn(r.topModels, m.model)}
						names={names}
						canPrice={canPrice}
					/>
				)}
			/>
		</Section>
	);
}

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase())
		.join("") || "?";

/** Everyone's view: per person, and a tap shows just theirs. */
export function PeopleList({
	r,
	selfId,
	onPick,
}: {
	r: UsageReport;
	selfId: string | null;
	onPick: (userId: string) => void;
}) {
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byUser.map(tokensOf));
	return (
		<Section
			title="By person"
			description="What each person's chats and routines used. Pick one to see just theirs."
		>
			<List
				items={r.byUser}
				empty="Nobody yet."
				render={(u) => {
					const row = (
						<Row
							icon={
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-fg-muted">
									{initials(u.name)}
								</span>
							}
							name={u.userId === selfId ? `${u.name} (you)` : u.name}
							badge={
								u.role ? (
									<Badge tone={u.role.toLowerCase() === "admin" ? "accent" : "neutral"}>
										{u.role}
									</Badge>
								) : undefined
							}
							numbers={
								<>
									{formatTokens(tokensOf(u))}
									{u.cost !== null ? ` · ${money(u.cost)}` : ""}
								</>
							}
							value={tokensOf(u)}
							max={max}
							color="var(--brand)"
							below={
								<>
									<span>{percent(tokensOf(u), total)}% of all</span>
									<span>·</span>
									<span>{calls(u.calls)}</span>
								</>
							}
						/>
					);
					const id = u.userId;
					if (!id) {
						return (
							<div key="none" className="px-4 py-3">
								{row}
							</div>
						);
					}
					return (
						<button
							key={id}
							type="button"
							onClick={() => onPick(id)}
							className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/60"
							aria-label={`Show ${u.name}'s usage`}
						>
							{row}
							<ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
						</button>
					);
				}}
			/>
		</Section>
	);
}

/** What started replies and routine runs, and how many failed. */
export function Triggers({ r }: { r: UsageReport }) {
	if (r.runs.byTrigger.length === 0) return null;
	return (
		<Section title="What started replies" description="Replies and routine runs in this period.">
			<div className="flex flex-wrap gap-2">
				{r.runs.byTrigger.map((t) => (
					<span
						key={t.trigger}
						className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px]"
					>
						{TRIGGER_LABEL[t.trigger] ?? t.trigger}
						<span className="font-semibold tabular-nums">{t.count.toLocaleString()}</span>
					</span>
				))}
				{r.runs.error > 0 && (
					<span className="inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger/6 px-3 py-1.5 text-[13px] text-danger">
						Failed <span className="font-semibold tabular-nums">{r.runs.error.toLocaleString()}</span>
					</span>
				)}
				{r.runs.cancelled > 0 && (
					<span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-[13px] text-fg-muted">
						Stopped <span className="font-semibold tabular-nums">{r.runs.cancelled.toLocaleString()}</span>
					</span>
				)}
			</div>
		</Section>
	);
}
