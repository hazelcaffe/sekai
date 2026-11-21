import {
	type Agent,
	type ApprovalMode,
	type ModelInfo,
	type ModelRef,
	THINKING_LABELS,
	type ThinkingSetting,
} from "@sekai/shared";
import { Link, Popover, PopoverClose, Spinner, Tooltip } from "@sekai/ui";
import {
	Check,
	ChevronDown,
	Crown,
	Eye,
	KeyRound,
	Search,
	ShieldCheck,
	ShieldOff,
	ShieldQuestion,
	Zap,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { settingsUrl } from "../api.ts";
import { useAccess, useModels } from "../data.ts";
import { cn, formatTokens, providerLabel } from "../utils.ts";
import { BrandGlyph, presetBrand, vendorBrand } from "./BrandLogo.tsx";
import type { Brand } from "./logos.ts";

export function shortModelName(info: ModelInfo | undefined, id: string): string {
	if (info?.byos) return info.name;
	if (id.startsWith("prv_")) return "Removed subscription";
	return (info?.name ?? id).replace(/^Claude /, "");
}

export function thinkingOptions(info: ModelInfo | undefined): { value: ThinkingSetting; label: string }[] {
	const levels = info?.thinkingLevels ?? [];
	return [
		{ value: "default" as ThinkingSetting, label: THINKING_LABELS.default },
		...levels.map((l) => ({ value: l, label: THINKING_LABELS[l] })),
	];
}

/**
 * Searchable model list grouped by provider. Subscription (BYOS) models only drive a bot's replies, so
 * they're offered only where allowByos is set (the bot's primary model).
 */
export function ModelList({
	value,
	onSelect,
	allowByos = false,
}: {
	value: string;
	onSelect: (id: string) => void;
	allowByos?: boolean;
}) {
	const { data: models, isLoading, error } = useModels();
	// Settings → Subscriptions opens for admins and people whose role may use subscriptions.
	const { can } = useAccess();
	const [query, setQuery] = useState("");
	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const map = new Map<string, { label: string; byos: boolean; brand: Brand | null; models: ModelInfo[] }>();
		for (const m of models ?? []) {
			if (m.byos && !allowByos) continue;
			if (q && !`${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(q)) continue;
			const key = m.byos ? `byos:${m.byos.providerId}` : m.api ? `api:${m.api.providerId}` : m.provider;
			const group = map.get(key) ?? {
				label: m.byos ? m.byos.providerTitle : m.api ? m.api.providerName : providerLabel(m.provider),
				byos: Boolean(m.byos),
				brand: m.byos ? presetBrand(m.byos.preset) : vendorBrand(m.provider),
				models: [],
			};
			group.models.push(m);
			map.set(key, group);
		}
		return [...map.entries()];
	}, [models, query, allowByos]);
	const hasByos = (models ?? []).some((m) => m.byos);

	return (
		<div className="flex flex-col">
			<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface px-2.5 pb-2">
				<Search className="size-4 text-fg-subtle" />
				<input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search models"
					className="h-8 flex-1 bg-transparent text-body outline-none placeholder:text-fg-subtle"
				/>
			</div>
			{isLoading && (
				<div className="flex justify-center py-6">
					<Spinner />
				</div>
			)}
			{error && <div className="px-3 py-4 text-body text-danger-ink">{error.message}</div>}
			<div className="max-h-[min(46dvh,380px)] overflow-y-auto py-1 scrollbar-thin">
				{groups.map(([key, group]) => (
					<div key={key} className="py-1">
						<div className="flex items-center gap-1.5 px-2.5 py-1 text-caption font-medium text-fg-subtle">
							{group.brand ? (
								<BrandGlyph brand={group.brand} size={13} />
							) : (
								group.byos && <KeyRound className="size-4" />
							)}
							{group.label}
							{group.byos && <span className="normal-case tracking-normal">· your subscription</span>}
						</div>
						{group.models.map((m) => (
							<PopoverClose asChild key={m.id}>
								<button
									type="button"
									onClick={() => onSelect(m.id)}
									className={cn(
										"flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body hover:bg-surface-2 coarse:py-3",
										m.id === value && "bg-surface-2",
									)}
								>
									<span className="min-w-0 flex-1 truncate">
										{m.byos
											? shortModelName(m, m.id).replace(`${m.byos.providerTitle} · `, "")
											: shortModelName(m, m.id)}
									</span>
									{m.vision && <Eye className="size-4 shrink-0 text-fg-subtle" aria-label="Vision" />}
									{m.thinkingLevels.length > 0 && (
										<Zap className="size-4 shrink-0 text-fg-subtle" aria-label="Reasoning" />
									)}
									<span className="w-12 shrink-0 text-right text-caption text-fg-subtle">
										{m.byos ? "plan" : formatTokens(m.contextWindow)}
									</span>
									{m.id === value && <Check className="size-4 shrink-0" />}
								</button>
							</PopoverClose>
						))}
					</div>
				))}
				{allowByos && !query && can("subscriptions") && (
					<PopoverClose asChild>
						<Link
							href={settingsUrl("subscriptions")}
							className="mx-1.5 mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-small text-fg-muted hover:bg-surface-2 hover:text-fg"
						>
							<KeyRound className="size-4" />
							{hasByos
								? "Manage your subscriptions"
								: "Use your own subscription (Codex, Claude, OpenCode, Pi…)"}
						</Link>
					</PopoverClose>
				)}
			</div>
		</div>
	);
}

/** A model + thinking-level control, used for every model slot (primary, fast, planner, advisors…). */
export function ModelRefPicker({
	value,
	onChange,
	allowNone,
	allowByos = false,
	placeholder = "Choose a model",
	className,
}: {
	value: ModelRef | null;
	onChange: (v: ModelRef | null) => void;
	allowNone?: string;
	/** Offer your subscriptions too (only for a bot's primary model). */
	allowByos?: boolean;
	placeholder?: string;
	className?: string;
}) {
	const { data: models } = useModels();
	const info = value ? models?.find((m) => m.id === value.model) : undefined;
	const options = thinkingOptions(info);
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<Popover
				align="start"
				className="w-[min(380px,calc(100vw-24px))] p-0 pt-2"
				trigger={
					<button
						type="button"
						className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3.5 text-left text-body hover:border-border-strong coarse:h-11"
					>
						<span className={cn("truncate", !value && "text-fg-subtle")}>
							{value ? shortModelName(info, value.model) : (allowNone ?? placeholder)}
						</span>
						<ChevronDown className="size-4 shrink-0 text-fg-subtle" />
					</button>
				}
			>
				{allowNone && (
					<PopoverClose asChild>
						<button
							type="button"
							onClick={() => onChange(null)}
							className="mx-1.5 mb-1 flex w-[calc(100%-12px)] items-center justify-between rounded-md px-2.5 py-2 text-left text-body hover:bg-surface-2"
						>
							{allowNone}
							{!value && <Check className="size-4" />}
						</button>
					</PopoverClose>
				)}
				<ModelList
					value={value?.model ?? ""}
					allowByos={allowByos}
					onSelect={(id) => {
						const next = models?.find((m) => m.id === id);
						const keep =
							value &&
							value.thinking !== "default" &&
							next?.thinkingLevels.includes(value.thinking as never);
						onChange({ model: id, thinking: keep ? value.thinking : "default" });
					}}
				/>
			</Popover>
			{value && options.length > 1 && (
				<ThinkingPicker
					value={value.thinking}
					options={options}
					onChange={(thinking) => onChange({ ...value, thinking })}
				/>
			)}
		</div>
	);
}

/** The levels' short words, the same everywhere, for pickers too narrow for the full ones. */
const SHORT_THINKING: Record<ThinkingSetting, string> = {
	default: "Auto",
	none: "Off",
	minimal: "Min",
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "X-High",
	max: "Max",
};

/** How a thinking picker words its levels: full words, short words, or short words a size smaller still. */
type ThinkingFit = "full" | "short" | "tiny";

/**
 * Thinking levels in one row of equal buttons, never wrapping. One rule wherever it's shown: every level says its
 * full word when all of them fit (measured, so it follows the width, the platform and the text size); otherwise
 * all use their short words (a size smaller, and smaller again if even those don't fit), with the full word as
 * their name and tooltip.
 */
export function ThinkingPicker({
	value,
	options,
	onChange,
	className,
}: {
	value: ThinkingSetting;
	options: { value: ThinkingSetting; label: string }[];
	onChange: (v: ThinkingSetting) => void;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<ThinkingFit>("full");
	// Each segment carries both words, hidden and at their own sizes, to measure against its room: what's shown
	// never changes the answer.
	const measure = useCallback(() => {
		const segments = [...(ref.current?.querySelectorAll<HTMLElement>("[data-thinking]") ?? [])];
		const fits = (word: "full" | "short") =>
			segments.every((b) => {
				const style = getComputedStyle(b);
				const room =
					b.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
				return (b.querySelector<HTMLElement>(`[data-measure=${word}]`)?.offsetWidth ?? 0) <= room + 0.5;
			});
		setFit(fits("full") ? "full" : fits("short") ? "short" : "tiny");
	}, []);
	useLayoutEffect(measure);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		void document.fonts?.ready.then(measure);
		return () => observer.disconnect();
	}, [measure]);
	const full = fit === "full";
	return (
		<div
			ref={ref}
			role="radiogroup"
			aria-label="Thinking"
			className={cn("grid gap-0.5 rounded-lg bg-surface-2 p-0.5", className)}
			style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
		>
			{options.map((o) => {
				const on = o.value === value;
				const button = (
					// biome-ignore lint/a11y/useSemanticElements: a segmented control
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={on}
						aria-label={full ? undefined : o.label}
						data-thinking
						onClick={() => onChange(o.value)}
						className={cn(
							"relative h-8 min-w-0 truncate rounded-md font-medium transition-[background-color,color,box-shadow] duration-150 coarse:h-10",
							full ? "px-1 text-body" : fit === "short" ? "px-0.5 text-small" : "px-0 text-caption",
							on ? "bg-surface text-fg shadow-soft" : "text-fg-muted hover:text-fg",
						)}
					>
						<span aria-hidden={full ? undefined : true}>{full ? o.label : SHORT_THINKING[o.value]}</span>
						<span data-measure="full" aria-hidden className="invisible absolute left-0 text-body">
							{o.label}
						</span>
						<span data-measure="short" aria-hidden className="invisible absolute left-0 text-small">
							{SHORT_THINKING[o.value]}
						</span>
					</button>
				);
				// Short words say the whole one on hover.
				return full ? (
					button
				) : (
					<Tooltip key={o.value} content={o.label}>
						{button}
					</Tooltip>
				);
			})}
		</div>
	);
}

/** Composer pill: swap the bot's model and thinking level in two taps. */
export function ComposerModelPill({ agent, onChange }: { agent: Agent; onChange: (ref: ModelRef) => void }) {
	const { data: models } = useModels();
	const ref = agent.models.primary;
	const info = models?.find((m) => m.id === ref.model);
	const options = thinkingOptions(info);
	return (
		<Popover
			side="top"
			align="start"
			className="w-[min(380px,calc(100vw-24px))] p-0 pt-2"
			trigger={
				<button
					type="button"
					aria-label={`${agent.name}'s model: ${shortModelName(info, ref.model)}`}
					className="flex h-8 min-w-0 shrink items-center gap-1 rounded-full px-2.5 text-small font-medium text-fg-muted hover:bg-surface-2 hover:text-fg coarse:h-11"
				>
					<span className="truncate">{shortModelName(info, ref.model)}</span>
					{ref.thinking !== "default" && (
						<span className="hidden shrink-0 text-fg-subtle xs:inline">
							· {THINKING_LABELS[ref.thinking]}
						</span>
					)}
					{agent.models.strategy.type !== "single" && (
						<span className="shrink-0 rounded-sm bg-surface-3 px-1 text-caption text-fg-muted">
							{agent.models.strategy.type}
						</span>
					)}
					<ChevronDown className="size-4 shrink-0" />
				</button>
			}
		>
			<div className="px-3 pb-2.5">
				<div className="text-body font-semibold">{agent.name}'s model</div>
				<p className="text-small text-fg-subtle">Changes apply to all chats with this bot.</p>
			</div>
			{options.length > 1 && (
				<div className="border-b border-border px-2.5 pb-2.5">
					<div className="mb-1.5 px-0.5 text-caption font-medium text-fg-subtle">Thinking</div>
					<ThinkingPicker
						value={ref.thinking}
						options={options}
						onChange={(thinking) => onChange({ ...ref, thinking })}
					/>
				</div>
			)}
			<div className="pt-2">
				<ModelList
					value={ref.model}
					allowByos
					onSelect={(id) => {
						const next = models?.find((m) => m.id === id);
						const keep = ref.thinking !== "default" && next?.thinkingLevels.includes(ref.thinking as never);
						onChange({ model: id, thinking: keep ? ref.thinking : "default" });
					}}
				/>
			</div>
		</Popover>
	);
}

export const MODE_ICONS: Record<ApprovalMode, ReactNode> = {
	readonly: <Eye />,
	manual: <ShieldQuestion />,
	auto: <ShieldCheck />,
	primary: <Crown />,
	yolo: <ShieldOff />,
};
