import { AgentAvatar, api, BrandGlyph, formatTokens } from "@sekai/client";
import type { ModelPrice, UsageReport } from "@sekai/shared";
import {
	Badge,
	Button,
	errorMessage,
	Field,
	FormGroup,
	Input,
	List,
	Row,
	Section,
	useFormValues,
	useIsPhone,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { calls, money, TRIGGER_LABEL, tokensOf } from "./format.ts";
import { type Names, seriesColor } from "./series.ts";
import { Meter, percent } from "./ui.tsx";

const FIRST = 8;

const colorIn = (ids: string[], id: string) => {
	const i = ids.indexOf(id);
	return i >= 0 ? seriesColor(i, id) : "var(--usage-other)";
};

function ShowMoreRow({ total, all, onToggle }: { total: number; all: boolean; onToggle: () => void }) {
	if (total <= FIRST) return null;
	return (
		<button
			type="button"
			onClick={onToggle}
			className="w-full border-t border-border px-4 py-2.5 text-left text-body font-medium text-brand-ink transition-colors duration-fast hover:bg-surface-2 coarse:py-3"
		>
			{all ? "Show fewer" : `Show all ${total}`}
		</button>
	);
}

export function BotList({ r, names }: { r: UsageReport; names: Names }) {
	const phone = useIsPhone();
	const [all, setAll] = useState(false);
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byAgent.map(tokensOf));
	const ids = r.topAgents.map((a) => a.id);
	const showCost = r.totals.cost !== null;
	const shown = all ? r.byAgent : r.byAgent.slice(0, FIRST);

	return (
		<Section title="By bot" description="Replies and background work for each bot.">
			{r.byAgent.length === 0 ? (
				<List label="Usage by bot">
					<Row title="No bot usage yet" subtitle="Tokens appear here once bots answer." />
				</List>
			) : phone ? (
				<List label="Usage by bot">
					{shown.map((a) => {
						const avatar = names.avatar(a.agentId);
						const tok = tokensOf(a);
						return (
							<Row
								key={a.agentId ?? "none"}
								leading={
									avatar ? (
										<AgentAvatar avatar={avatar} size={32} />
									) : (
										<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
											{a.name.slice(0, 1).toUpperCase()}
										</span>
									)
								}
								title={a.name}
								subtitle={`${percent(tok, total)}% of total · ${calls(a.calls)}`}
								value={
									<span className="tabular-nums">
										{formatTokens(tok)}
										{a.cost !== null ? ` · ${money(a.cost)}` : ""}
									</span>
								}
							>
								<Meter
									value={tok}
									max={max}
									color={colorIn(ids, a.agentId ?? "none")}
									className="mt-1.5"
								/>
							</Row>
						);
					})}
					<ShowMoreRow total={r.byAgent.length} all={all} onToggle={() => setAll((v) => !v)} />
				</List>
			) : (
				<div className="overflow-hidden rounded-lg border border-border bg-surface">
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-border bg-surface-2/40 text-caption font-medium text-fg-subtle">
								<th className="py-2.5 pr-3 pl-4 font-medium">Bot</th>
								<th className="w-36 px-3 py-2.5 font-medium">Share</th>
								<th className="px-3 py-2.5 text-right font-medium">Calls</th>
								<th className="px-3 py-2.5 text-right font-medium">Tokens</th>
								{showCost && <th className="py-2.5 pr-4 pl-3 text-right font-medium">Cost</th>}
							</tr>
						</thead>
						<tbody>
							{shown.map((a) => {
								const avatar = names.avatar(a.agentId);
								const tok = tokensOf(a);
								const share = percent(tok, total);
								return (
									<tr key={a.agentId ?? "none"} className="border-t border-border first:border-t-0">
										<td className="py-3 pr-3 pl-4">
											<div className="flex items-center gap-3">
												{avatar ? (
													<AgentAvatar avatar={avatar} size={28} />
												) : (
													<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
														{a.name.slice(0, 1).toUpperCase()}
													</span>
												)}
												<span className="truncate text-body font-medium text-fg">{a.name}</span>
											</div>
										</td>
										<td className="px-3 py-3">
											<div className="flex items-center gap-2.5">
												<Meter
													value={tok}
													max={max}
													color={colorIn(ids, a.agentId ?? "none")}
													className="flex-1"
												/>
												<span className="w-9 text-right text-caption text-fg-subtle tabular-nums">
													{share}%
												</span>
											</div>
										</td>
										<td className="px-3 py-3 text-right text-small text-fg-muted tabular-nums">
											{a.calls.toLocaleString()}
										</td>
										<td className="px-3 py-3 text-right text-body font-medium text-fg tabular-nums">
											{formatTokens(tok)}
										</td>
										{showCost && (
											<td className="py-3 pr-4 pl-3 text-right text-body text-fg-muted tabular-nums">
												{a.cost !== null ? money(a.cost) : "—"}
											</td>
										)}
									</tr>
								);
							})}
						</tbody>
					</table>
					<ShowMoreRow total={r.byAgent.length} all={all} onToggle={() => setAll((v) => !v)} />
				</div>
			)}
		</Section>
	);
}

function parsePrice(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const n = Number(trimmed);
	return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null;
}

/** Admins set a model's price in a FormGroup (DESIGN.md "Usage: prices are edited in Usage → By model"). */
function PriceEditor({ model, price, onDone }: { model: string; price: ModelPrice | null; onDone: () => void }) {
	const qc = useQueryClient();
	const form = useFormValues({
		input: price ? String(price.input) : "",
		output: price ? String(price.output) : "",
	});

	const clear = useMutation({
		mutationFn: () => api.usage.setPrice(model, null),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["usage"] });
			onDone();
		},
		onError: (e) => toast.error(errorMessage(e)),
	});

	const submit = async () => {
		const input = parsePrice(form.values.input);
		const output = parsePrice(form.values.output);
		if (input === null || output === null) {
			throw new Error("Enter dollar amounts from 0 to 10,000 for both input and output tokens.");
		}
		await api.usage.setPrice(model, { input, output });
		void qc.invalidateQueries({ queryKey: ["usage"] });
		form.reset({ input: String(input), output: String(output) });
		onDone();
	};

	return (
		<div className="border-t border-border bg-surface-2/35 px-4 py-4">
			<FormGroup
				dirty={form.dirty}
				submitLabel="Save price"
				onSubmit={submit}
				onCancel={() => {
					form.reset();
					onDone();
				}}
				extra={
					price ? (
						<Button variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
							Clear price
						</Button>
					) : undefined
				}
			>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Field label="Input ($ per 1M tokens)">
						<Input
							inputMode="decimal"
							value={form.values.input}
							onChange={(e) => form.set("input", e.target.value)}
							placeholder="e.g. 3.00"
						/>
					</Field>
					<Field label="Output ($ per 1M tokens)">
						<Input
							inputMode="decimal"
							value={form.values.output}
							onChange={(e) => form.set("output", e.target.value)}
							placeholder="e.g. 15.00"
						/>
					</Field>
				</div>
			</FormGroup>
		</div>
	);
}

export function ModelList({ r, names, canPrice }: { r: UsageReport; names: Names; canPrice: boolean }) {
	const phone = useIsPhone();
	const [all, setAll] = useState(false);
	const [editingModel, setEditingModel] = useState<string | null>(null);
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byModel.map(tokensOf));
	const shown = all ? r.byModel : r.byModel.slice(0, FIRST);

	return (
		<Section
			title="By model"
			description={
				canPrice
					? "Set prices per million tokens to estimate costs."
					: "Estimated from the prices your admin set."
			}
		>
			{r.byModel.length === 0 ? (
				<List label="Usage by model">
					<Row title="No model usage yet" subtitle="Models used in replies and routines appear here." />
				</List>
			) : phone ? (
				<List label="Usage by model">
					{shown.map((m) => {
						const brand = names.brand(m.model);
						const name = names.model(m.model);
						const tok = tokensOf(m);
						const editing = editingModel === m.model;
						return (
							<div key={m.model} className="not-first:border-t not-first:border-border">
								<Row
									leading={
										<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
											{brand ? (
												<BrandGlyph brand={brand} size={16} />
											) : (
												<span className="text-caption font-semibold">AI</span>
											)}
										</span>
									}
									title={name}
									subtitle={
										<span className="tabular-nums">
											{formatTokens(tok)} tokens · {calls(m.calls)} ·{" "}
											{m.price
												? `${money(m.cost ?? 0)} ($${m.price.input}/$${m.price.output})`
												: "No price"}
										</span>
									}
									trailing={
										canPrice ? (
											<Button
												variant="ghost"
												size="sm"
												aria-label={`Set the price for ${name}`}
												onClick={() => setEditingModel(editing ? null : m.model)}
											>
												<Pencil /> Price
											</Button>
										) : undefined
									}
								>
									<Meter
										value={tok}
										max={max}
										color={colorIn(r.topModels, m.model)}
										className="mt-1.5"
									/>
								</Row>
								{canPrice && editing && (
									<PriceEditor model={m.model} price={m.price} onDone={() => setEditingModel(null)} />
								)}
							</div>
						);
					})}
					<ShowMoreRow total={r.byModel.length} all={all} onToggle={() => setAll((v) => !v)} />
				</List>
			) : (
				<div className="overflow-hidden rounded-lg border border-border bg-surface">
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-border bg-surface-2/40 text-caption font-medium text-fg-subtle">
								<th className="py-2.5 pr-3 pl-4 font-medium">Model</th>
								<th className="px-3 py-2.5 font-medium">Input / output</th>
								<th className="px-3 py-2.5 text-right font-medium">Calls</th>
								<th className="px-3 py-2.5 text-right font-medium">Tokens</th>
								<th className="py-2.5 pr-4 pl-3 text-right font-medium">Cost</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((m) => {
								const brand = names.brand(m.model);
								const name = names.model(m.model);
								const tok = tokensOf(m);
								const editing = editingModel === m.model;
								return (
									<Fragment key={m.model}>
										<tr className="border-t border-border first:border-t-0">
											<td className="py-3 pr-3 pl-4">
												<div className="flex items-center gap-3">
													<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
														{brand ? (
															<BrandGlyph brand={brand} size={15} />
														) : (
															<span className="text-caption font-semibold">AI</span>
														)}
													</span>
													<div className="min-w-0 flex-1">
														<div className="truncate text-body font-medium text-fg">
															{name}
														</div>
														<Meter
															value={tok}
															max={max}
															color={colorIn(r.topModels, m.model)}
															className="mt-1.5 max-w-44"
														/>
													</div>
												</div>
											</td>
											<td className="px-3 py-3 text-small text-fg-muted tabular-nums">
												{formatTokens(m.inputTokens)} in · {formatTokens(m.outputTokens)} out
												<span className="text-fg-subtle"> · {percent(tok, total)}%</span>
											</td>
											<td className="px-3 py-3 text-right text-small text-fg-muted tabular-nums">
												{m.calls.toLocaleString()}
											</td>
											<td className="px-3 py-3 text-right text-body font-medium text-fg tabular-nums">
												{formatTokens(tok)}
											</td>
											<td className="py-3 pr-4 pl-3 text-right whitespace-nowrap">
												<div className="inline-flex items-center justify-end gap-2 tabular-nums">
													{m.price ? (
														<span className="text-body text-fg">
															{money(m.cost ?? 0)}{" "}
															<span className="text-caption text-fg-subtle">
																(${m.price.input}/${m.price.output})
															</span>
														</span>
													) : (
														<span className="text-small text-fg-subtle">No price</span>
													)}
													{canPrice && (
														<Button
															variant="ghost"
															size="xs"
															aria-label={`Set the price for ${name}`}
															onClick={() => setEditingModel(editing ? null : m.model)}
														>
															<Pencil /> Price
														</Button>
													)}
												</div>
											</td>
										</tr>
										{canPrice && editing && (
											<tr>
												<td colSpan={5} className="p-0">
													<PriceEditor
														model={m.model}
														price={m.price}
														onDone={() => setEditingModel(null)}
													/>
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
					<ShowMoreRow total={r.byModel.length} all={all} onToggle={() => setAll((v) => !v)} />
				</div>
			)}
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

/** Everyone's view: per person, and selecting one filters the report to theirs. */
export function PeopleList({
	r,
	selfId,
	onPick,
}: {
	r: UsageReport;
	selfId: string | null;
	onPick: (userId: string) => void;
}) {
	const phone = useIsPhone();
	const [all, setAll] = useState(false);
	const total = tokensOf(r.totals);
	const max = Math.max(0, ...r.byUser.map(tokensOf));
	const showCost = r.totals.cost !== null;
	const shown = all ? r.byUser : r.byUser.slice(0, FIRST);

	return (
		<Section title="By person" description="Pick someone to view just their usage.">
			{r.byUser.length === 0 ? (
				<List label="Usage by person">
					<Row title="Nobody yet" subtitle="Each person's usage appears here once their bots answer." />
				</List>
			) : phone ? (
				<List label="Usage by person">
					{shown.map((u) => {
						const tok = tokensOf(u);
						const id = u.userId;
						return (
							<Row
								key={id ?? "none"}
								leading={
									<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
										{initials(u.name)}
									</span>
								}
								title={id === selfId ? `${u.name} (you)` : u.name}
								subtitle={`${percent(tok, total)}% of total · ${calls(u.calls)}`}
								badge={
									u.role ? (
										<Badge tone={u.role.toLowerCase() === "admin" ? "brand" : "neutral"}>
											{u.role}
										</Badge>
									) : undefined
								}
								value={
									<span className="tabular-nums">
										{formatTokens(tok)}
										{u.cost !== null ? ` · ${money(u.cost)}` : ""}
									</span>
								}
								onClick={id ? () => onPick(id) : undefined}
								chevron={Boolean(id)}
							>
								<Meter value={tok} max={max} color="var(--brand)" className="mt-1.5" />
							</Row>
						);
					})}
					<ShowMoreRow total={r.byUser.length} all={all} onToggle={() => setAll((v) => !v)} />
				</List>
			) : (
				<div className="overflow-hidden rounded-lg border border-border bg-surface">
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-border bg-surface-2/40 text-caption font-medium text-fg-subtle">
								<th className="py-2.5 pr-3 pl-4 font-medium">Person</th>
								<th className="w-36 px-3 py-2.5 font-medium">Share</th>
								<th className="px-3 py-2.5 text-right font-medium">Calls</th>
								<th className="px-3 py-2.5 text-right font-medium">Tokens</th>
								{showCost && <th className="px-3 py-2.5 text-right font-medium">Cost</th>}
								<th className="w-8 py-2.5 pr-4" aria-hidden />
							</tr>
						</thead>
						<tbody>
							{shown.map((u) => {
								const tok = tokensOf(u);
								const id = u.userId;
								const displayName = id === selfId ? `${u.name} (you)` : u.name;
								return (
									<tr
										key={id ?? "none"}
										onClick={id ? () => onPick(id) : undefined}
										className={
											id
												? "cursor-pointer border-t border-border transition-colors duration-fast first:border-t-0 hover:bg-surface-2/50"
												: "border-t border-border first:border-t-0"
										}
									>
										<td className="py-3 pr-3 pl-4">
											<div className="flex items-center gap-3">
												<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold text-fg-muted">
													{initials(u.name)}
												</span>
												{id ? (
													<button
														type="button"
														aria-label={`Show ${u.name}'s usage`}
														onClick={(ev) => {
															ev.stopPropagation();
															onPick(id);
														}}
														className="truncate text-left text-body font-medium text-fg outline-none focus-visible:underline"
													>
														{displayName}
													</button>
												) : (
													<span className="truncate text-body font-medium text-fg">
														{displayName}
													</span>
												)}
												{u.role && (
													<Badge
														tone={u.role.toLowerCase() === "admin" ? "brand" : "neutral"}
													>
														{u.role}
													</Badge>
												)}
											</div>
										</td>
										<td className="px-3 py-3">
											<div className="flex items-center gap-2.5">
												<Meter value={tok} max={max} color="var(--brand)" className="flex-1" />
												<span className="w-9 text-right text-caption text-fg-subtle tabular-nums">
													{percent(tok, total)}%
												</span>
											</div>
										</td>
										<td className="px-3 py-3 text-right text-small text-fg-muted tabular-nums">
											{u.calls.toLocaleString()}
										</td>
										<td className="px-3 py-3 text-right text-body font-medium text-fg tabular-nums">
											{formatTokens(tok)}
										</td>
										{showCost && (
											<td className="px-3 py-3 text-right text-body text-fg-muted tabular-nums">
												{u.cost !== null ? money(u.cost) : "—"}
											</td>
										)}
										<td className="py-3 pr-4 text-right">
											{id && (
												<ChevronRight aria-hidden className="inline size-4 text-fg-subtle" />
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					<ShowMoreRow total={r.byUser.length} all={all} onToggle={() => setAll((v) => !v)} />
				</div>
			)}
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
						className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-small"
					>
						{TRIGGER_LABEL[t.trigger] ?? t.trigger}
						<span className="font-semibold text-fg tabular-nums">{t.count.toLocaleString()}</span>
					</span>
				))}
				{r.runs.error > 0 && (
					<span className="inline-flex items-center gap-2 rounded-full border border-danger/25 bg-danger-soft px-3 py-1.5 text-small text-danger-ink">
						Failed <span className="font-semibold tabular-nums">{r.runs.error.toLocaleString()}</span>
					</span>
				)}
				{r.runs.cancelled > 0 && (
					<span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-small text-fg-muted">
						Stopped <span className="font-semibold tabular-nums">{r.runs.cancelled.toLocaleString()}</span>
					</span>
				)}
			</div>
		</Section>
	);
}
