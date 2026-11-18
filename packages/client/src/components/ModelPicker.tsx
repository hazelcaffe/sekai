import {
	type Agent,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalMode,
	type ApprovalModeSetting,
	type ModelInfo,
	type ModelRef,
	THINKING_LABELS,
	type ThinkingSetting,
} from "@sekai/shared";
import { Popover, PopoverClose, Spinner } from "@sekai/ui";
import {
	Check,
	ChevronDown,
	Crown,
	Eye,
	KeyRound,
	Search,
	Shield,
	ShieldCheck,
	ShieldOff,
	ShieldQuestion,
	Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { adminUrl } from "../api.ts";
import { useModels } from "../data.ts";
import { cn, formatTokens, providerLabel } from "../utils.ts";
import { BrandGlyph, presetBrand, vendorBrand } from "./BrandLogo.tsx";
import type { Brand } from "./logos.ts";

export function shortModelName(info: ModelInfo | undefined, id: string): string {
	if (info?.byos) return info.name;
	if (id.startsWith("prv_")) return "Removed subscription";
	return (info?.name ?? id).replace(/^Claude /, "").replace(/^Gemini /, "Gemini ");
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
					className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
				/>
			</div>
			{isLoading && (
				<div className="flex justify-center py-6">
					<Spinner />
				</div>
			)}
			{error && <div className="px-3 py-4 text-sm text-danger">{error.message}</div>}
			<div className="max-h-[min(46dvh,380px)] overflow-y-auto py-1 scrollbar-thin">
				{groups.map(([key, group]) => (
					<div key={key} className="py-1">
						<div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-fg-subtle">
							{group.brand ? (
								<BrandGlyph brand={group.brand} size={13} />
							) : (
								group.byos && <KeyRound className="size-3" />
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
										"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2 coarse:py-3",
										m.id === value && "bg-surface-2",
									)}
								>
									<span className="min-w-0 flex-1 truncate">
										{m.byos
											? shortModelName(m, m.id).replace(`${m.byos.providerTitle} · `, "")
											: shortModelName(m, m.id)}
									</span>
									{m.vision && (
										<Eye className="size-3.5 shrink-0 text-fg-subtle" aria-label="Vision" />
									)}
									{m.thinkingLevels.length > 0 && (
										<Zap className="size-3.5 shrink-0 text-fg-subtle" aria-label="Reasoning" />
									)}
									<span className="w-12 shrink-0 text-right text-[11px] text-fg-subtle">
										{m.byos ? "plan" : formatTokens(m.contextWindow)}
									</span>
									{m.id === value && <Check className="size-4 shrink-0" />}
								</button>
							</PopoverClose>
						))}
					</div>
				))}
				{allowByos && !query && (
					<PopoverClose asChild>
						<a
							href={adminUrl("subscriptions")}
							className="mx-1.5 mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
						>
							<KeyRound className="size-3.5" />
							{hasByos ? "Manage your subscriptions" : "Use your own subscription (Codex, Claude, Grok…)"}
						</a>
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
						className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3.5 text-left text-sm hover:border-border-strong coarse:h-11"
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
							className="mx-1.5 mb-1 flex w-[calc(100%-12px)] items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
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

const SHORT_THINKING: Partial<Record<ThinkingSetting, string>> = { xhigh: "X-High", minimal: "Min" };

/** Thinking levels in one row of equal buttons (never wraps). */
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
	const compact = options.length > 5;
	return (
		<div
			role="radiogroup"
			aria-label="Thinking"
			className={cn("grid gap-0.5 rounded-xl bg-surface-2 p-0.5", className)}
			style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
		>
			{options.map((o) => {
				const on = o.value === value;
				return (
					// biome-ignore lint/a11y/useSemanticElements: a segmented control
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={on}
						title={o.label}
						onClick={() => onChange(o.value)}
						className={cn(
							"h-8 min-w-0 truncate rounded-[10px] px-1 font-medium transition-[background-color,color,box-shadow] duration-150 coarse:h-10",
							compact ? "text-[12px]" : "text-[13px]",
							on ? "bg-card text-fg shadow-sm" : "text-fg-muted hover:text-fg",
						)}
					>
						{(compact && SHORT_THINKING[o.value]) || o.label}
					</button>
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
					className="flex h-8 min-w-0 shrink items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg coarse:h-10"
				>
					<span className="truncate">{shortModelName(info, ref.model)}</span>
					{ref.thinking !== "default" && (
						<span className="hidden shrink-0 text-fg-subtle xs:inline">
							· {THINKING_LABELS[ref.thinking]}
						</span>
					)}
					{agent.models.strategy.type !== "single" && (
						<span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-fg-muted">
							{agent.models.strategy.type}
						</span>
					)}
					<ChevronDown className="size-3.5 shrink-0" />
				</button>
			}
		>
			{options.length > 1 && (
				<div className="border-b border-border px-2.5 pb-2.5">
					<div className="mb-1.5 px-0.5 text-xs font-medium text-fg-subtle">Thinking</div>
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

/** Composer pill for this chat's approval mode (Shift+Tab cycles it from the composer). */
export function ApprovalModePill({
	value,
	effective,
	inherited,
	onChange,
}: {
	value: ApprovalModeSetting;
	effective: ApprovalMode;
	inherited: ApprovalMode;
	onChange: (v: ApprovalModeSetting) => void;
}) {
	const info = APPROVAL_MODE_INFO[effective];
	return (
		<Popover
			side="top"
			align="start"
			className="w-[min(340px,calc(100vw-24px))]"
			trigger={
				<button
					type="button"
					title="Approval mode (Shift+Tab to cycle)"
					className={cn(
						"flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium hover:bg-surface-2 coarse:h-10 [&_svg]:size-3.5",
						effective === "yolo"
							? "text-danger"
							: effective === "readonly"
								? "text-info"
								: "text-fg-muted hover:text-fg",
					)}
				>
					{MODE_ICONS[effective]}
					{/* The everyday default stays a quiet icon; anything else says what it is. */}
					{(value !== "inherit" || effective !== "auto") && (
						<span className="hidden xs:inline">{info.short}</span>
					)}
				</button>
			}
		>
			<div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-fg-subtle">Approvals in this chat</div>
			<PopoverClose asChild>
				<button
					type="button"
					onClick={() => onChange("inherit")}
					className={cn(
						"flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-surface-2",
						value === "inherit" && "bg-surface-2",
					)}
				>
					<Shield className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
					<span className="min-w-0 flex-1">
						<span className="block text-sm font-medium">
							Default ({APPROVAL_MODE_INFO[inherited].short})
						</span>
						<span className="block text-xs leading-5 text-fg-subtle">Use the bot's or app's setting.</span>
					</span>
					{value === "inherit" && <Check className="size-4" />}
				</button>
			</PopoverClose>
			{APPROVAL_MODES.map((m) => (
				<PopoverClose asChild key={m}>
					<button
						type="button"
						onClick={() => onChange(m)}
						className={cn(
							"flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-surface-2 [&_svg]:size-4",
							value === m && "bg-surface-2",
						)}
					>
						<span className={cn("mt-0.5 shrink-0", m === "yolo" ? "text-danger" : "text-fg-subtle")}>
							{MODE_ICONS[m]}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-sm font-medium">{APPROVAL_MODE_INFO[m].title}</span>
							<span className="block text-xs leading-5 text-fg-subtle">
								{APPROVAL_MODE_INFO[m].description}
							</span>
						</span>
						{value === m && <Check className="size-4" />}
					</button>
				</PopoverClose>
			))}
		</Popover>
	);
}
