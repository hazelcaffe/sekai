import { adminUrl, api, BrandTile, ModelRefPicker, presetBrand, useModels, useSettings } from "@sekai/client";
import {
	type Agent,
	type AgentModels,
	type ModelRef,
	STRATEGY_LABELS,
	STRATEGY_TYPES,
	type StrategyType,
} from "@sekai/shared";
import { Button, Field, Fold, Input, Section, Select } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";

/** Set and swap models, thinking levels, and how several models combine for one reply. */
export function ModelTab({ agent }: { agent: Agent }) {
	const { data: settings } = useSettings();
	const { data: models } = useModels();
	const update = useMutation({ mutationFn: (models: AgentModels) => api.agents.update(agent.id, { models }) });
	const m = agent.models;
	const set = (patch: Partial<AgentModels>) => update.mutate({ ...m, ...patch });
	const fallbackRef: ModelRef = settings?.defaultFastModel ?? m.primary;
	const byos = models?.find((x) => x.id === m.primary.model)?.byos;
	const modelName = (id: string | undefined) => (id ? (models?.find((x) => x.id === id)?.name ?? id) : "…");
	const isByos = m.primary.model.startsWith("prv_");
	/** Planner and council run gateway models in front of the primary; a subscription agent can't be steered that way. */
	const unavailable = (t: StrategyType) => isByos && (t === "planner" || t === "council");

	const setStrategy = (type: StrategyType) => {
		switch (type) {
			case "single":
				return set({ strategy: { type } });
			case "planner":
				return set({
					strategy: {
						type,
						planner:
							m.strategy.type === "planner"
								? m.strategy.planner
								: { model: "claude-opus-5-5", thinking: "high" },
					},
				});
			case "council":
				return set({
					strategy: {
						type,
						advisors:
							m.strategy.type === "council"
								? m.strategy.advisors
								: [
										{ model: "gpt-6.1-sol", thinking: "default" },
										{ model: "gemini-4-argon", thinking: "default" },
									],
					},
				});
			case "fallback":
				return set({
					strategy: {
						type,
						fallbacks:
							m.strategy.type === "fallback"
								? m.strategy.fallbacks
								: [{ model: "gpt-6.1-sol", thinking: "default" }],
					},
				});
		}
	};

	const list =
		m.strategy.type === "council"
			? m.strategy.advisors
			: m.strategy.type === "fallback"
				? m.strategy.fallbacks
				: [];
	const setList = (next: ModelRef[]) => {
		if (m.strategy.type === "council") set({ strategy: { type: "council", advisors: next } });
		if (m.strategy.type === "fallback") set({ strategy: { type: "fallback", fallbacks: next } });
	};

	return (
		<div className="flex flex-col gap-7">
			<Section
				title="Primary model"
				description="Talks to you and uses tools. Also switchable from the composer."
			>
				<ModelRefPicker value={m.primary} allowByos onChange={(v) => v && set({ primary: v })} />
				{isByos && (
					<div className="flex gap-3 rounded-2xl bg-surface-2/60 p-3.5 text-xs leading-5 text-fg-muted">
						{byos && presetBrand(byos.preset) ? (
							<BrandTile brand={presetBrand(byos.preset)} size={28} />
						) : (
							<KeyRound className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
						)}
						<div>
							{byos ? (
								<>
									Replies come from <span className="font-medium text-fg">{byos.providerTitle}</span>{" "}
									with your own subscription.
								</>
							) : (
								"This subscription was removed. Pick another model."
							)}{" "}
							It works in its own folder on this computer and uses Sekai's tools (memory, notes, routines,
							team) through your approval settings. Titles, memory, routing and approval reviews still use
							the background model below.{" "}
							<a href={adminUrl("subscriptions")} className="font-medium text-info">
								Manage subscriptions
							</a>
						</div>
					</div>
				)}
			</Section>

			<Section title="Combine models" description="How models work together on each reply.">
				<Select
					value={m.strategy.type}
					onValueChange={(t) => setStrategy(t as StrategyType)}
					options={STRATEGY_TYPES.map((t) => ({
						value: t,
						label: STRATEGY_LABELS[t].title,
						disabled: unavailable(t),
						description: unavailable(t)
							? "Not available with a subscription model: it can't be steered by other models."
							: t === "fallback" && isByos
								? "If the subscription fails before doing anything (limit reached, signed out), a gateway model takes over."
								: STRATEGY_LABELS[t].description,
					}))}
				/>
				{m.strategy.type !== "single" && (
					<p className="-mt-1 text-xs leading-5 text-fg-subtle">
						{STRATEGY_LABELS[m.strategy.type].description}
					</p>
				)}
				{m.strategy.type === "planner" && (
					<Field label="Planner model">
						<ModelRefPicker
							value={m.strategy.planner}
							onChange={(v) => v && set({ strategy: { type: "planner", planner: v } })}
						/>
					</Field>
				)}
				{(m.strategy.type === "council" || m.strategy.type === "fallback") && (
					<div className="flex flex-col gap-3">
						<div className="text-[13px] font-medium">
							{m.strategy.type === "council" ? "Advisors" : "Fallback chain, in order"}
						</div>
						{list.map((ref, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the same model may appear twice; position is the identity
							<div key={`${ref.model}-${i}`} className="flex items-start gap-2">
								<span className="mt-2.5 w-5 shrink-0 text-center text-xs text-fg-subtle">{i + 1}</span>
								<ModelRefPicker
									value={ref}
									onChange={(v) => v && setList(list.map((x, j) => (j === i ? v : x)))}
									className="flex-1"
								/>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Remove"
									disabled={list.length <= 1}
									onClick={() => setList(list.filter((_, j) => j !== i))}
								>
									<Trash2 />
								</Button>
							</div>
						))}
						{list.length < 4 && (
							<Button
								variant="secondary"
								size="sm"
								className="self-start"
								onClick={() => setList([...list, fallbackRef])}
							>
								<Plus /> Add model
							</Button>
						)}
					</div>
				)}
			</Section>

			<Fold
				title="More"
				summary={`Background ${modelName(m.fast?.model ?? settings?.defaultFastModel.model)} · ${m.maxSteps} steps`}
			>
				<Field label="Background model" hint="Titles, memory, group routing, summaries and approval reviews.">
					<ModelRefPicker
						value={m.fast}
						onChange={(fast) => set({ fast })}
						allowNone={`App default (${settings?.defaultFastModel.model ?? "…"})`}
					/>
				</Field>
				<Field label="Vision model" hint="Looks at images when the primary model can't.">
					<ModelRefPicker value={m.vision} onChange={(vision) => set({ vision })} allowNone="None" />
				</Field>
				<div className="grid gap-3 xs:grid-cols-2">
					<Field label="Max steps per reply" hint="Model calls in one reply.">
						<Input
							type="number"
							min={1}
							max={100}
							value={m.maxSteps}
							onChange={(e) => {
								const v = Number(e.target.value);
								if (v >= 1 && v <= 100) set({ maxSteps: v });
							}}
						/>
					</Field>
					<Field label="Max output tokens" hint="Empty: the model's default.">
						<Input
							type="number"
							min={256}
							placeholder="Default"
							value={m.maxOutputTokens ?? ""}
							onChange={(e) => set({ maxOutputTokens: e.target.value ? Number(e.target.value) : null })}
						/>
					</Field>
				</div>
			</Fold>
		</div>
	);
}
