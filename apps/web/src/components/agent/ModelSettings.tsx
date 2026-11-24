import { BrandTile, ModelRefPicker, presetBrand, settingsUrl, useAccess, useModels, useSettings } from "@sekai/client";
import {
	type Agent,
	type AgentModels,
	type ModelRef,
	STRATEGY_LABELS,
	STRATEGY_TYPES,
	type StrategyType,
} from "@sekai/shared";
import {
	Button,
	Callout,
	Field,
	Fold,
	IconButton,
	Input,
	Link,
	SaveState,
	Section,
	SectionNesting,
	Select,
	useAutosave,
} from "@sekai/ui";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";

type Part = "model" | "limits" | "strategy" | "other";

/** The bot's models, edited on screen and saved as you change them (one write at a time). */
function useModelsSave(agent: Agent) {
	const update = useAgentUpdate(agent);
	const state = useAutosave((models: AgentModels) => update({ models }));
	const [models, setModels] = useState(agent.models);
	const [seen, setSeen] = useState(JSON.stringify(agent.models));
	const [part, setPart] = useState<Part>("model");
	const server = JSON.stringify(agent.models);
	// Follows the saved copy (live updates, other devices) except while a change is on its way.
	if (server !== seen && state.status !== "saving") {
		setSeen(server);
		setModels(agent.models);
	}
	const change = (from: Part, patch: Partial<AgentModels>) => {
		const next = { ...models, ...patch };
		setPart(from);
		setModels(next);
		state.save(next);
	};
	/** Beside a section's title, when that's where the last change was made. */
	const saveState = (p: Part) => (part === p && state.status !== "idle" ? <SaveState state={state} /> : undefined);
	return { models, change, saveState };
}

/** A whole number that saves when you leave the field (or press Enter), and says what's wrong if it can't. */
function NumberField({
	label,
	hint,
	value,
	min,
	max,
	placeholder,
	onSave,
}: {
	label: string;
	hint: string;
	value: number | null;
	min: number;
	max?: number;
	placeholder?: string;
	/** null: the field was emptied (only allowed when `placeholder` says what happens then). */
	onSave: (v: number | null) => void;
}) {
	const [text, setText] = useState(value == null ? "" : String(value));
	const [seen, setSeen] = useState(value);
	const [error, setError] = useState<string | null>(null);
	if (value !== seen) {
		setSeen(value);
		setText(value == null ? "" : String(value));
	}
	const range = max ? `a whole number from ${min} to ${max}` : `a whole number, ${min} or more`;
	const commit = () => {
		const t = text.trim();
		if (!t) {
			if (placeholder) {
				setError(null);
				if (value !== null) onSave(null);
			} else setError(`Use ${range}.`);
			return;
		}
		const n = Number(t);
		if (!Number.isInteger(n) || n < min || (max && n > max)) {
			setError(`Use ${range}.`);
			return;
		}
		setError(null);
		if (n !== value) onSave(n);
	};
	return (
		<Field label={label} hint={hint} error={error}>
			<Input
				type="number"
				inputMode="numeric"
				min={min}
				max={max}
				placeholder={placeholder}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => e.key === "Enter" && commit()}
			/>
		</Field>
	);
}

/** What the bot thinks with, how many steps and tokens it may use, and (under Advanced) how models combine. */
export function ModelSettings({ agent }: { agent: Agent }) {
	const { data: settings } = useSettings();
	const { can } = useAccess();
	const { data: models } = useModels();
	const { models: m, change, saveState } = useModelsSave(agent);
	const fallbackRef: ModelRef = settings?.defaultFastModel ?? m.primary;
	const byos = models?.find((x) => x.id === m.primary.model)?.byos;
	const modelName = (id: string | undefined) => (id ? (models?.find((x) => x.id === id)?.name ?? id) : "…");
	const isByos = m.primary.model.startsWith("prv_");
	/** Planner and council run gateway models in front of the primary; a subscription bot can't be steered that way. */
	const unavailable = (t: StrategyType) => isByos && (t === "planner" || t === "council");

	const setStrategy = (type: StrategyType) => {
		switch (type) {
			case "single":
				return change("strategy", { strategy: { type } });
			case "planner":
				return change("strategy", {
					strategy: {
						type,
						planner:
							m.strategy.type === "planner"
								? m.strategy.planner
								: { model: "claude-opus-5-5", thinking: "high" },
					},
				});
			case "council":
				return change("strategy", {
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
				return change("strategy", {
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
		if (m.strategy.type === "council") change("strategy", { strategy: { type: "council", advisors: next } });
		if (m.strategy.type === "fallback") change("strategy", { strategy: { type: "fallback", fallbacks: next } });
	};

	return (
		<>
			<Section
				title="Model"
				description="What it thinks with. You can also switch it from the chat's message box."
				saveState={saveState("model")}
			>
				<ModelRefPicker value={m.primary} allowByos onChange={(v) => v && change("model", { primary: v })} />
				{isByos && (
					<Callout
						tone={byos ? "info" : "warning"}
						icon={
							byos && presetBrand(byos.preset) ? (
								<BrandTile brand={presetBrand(byos.preset)} size={20} />
							) : (
								<KeyRound />
							)
						}
						action={
							can("subscriptions") && (
								<Button variant="secondary" size="sm" asChild>
									<Link href={settingsUrl("subscriptions")}>Manage subscriptions</Link>
								</Button>
							)
						}
					>
						{byos
							? `Replies come from ${byos.providerTitle}, with your own subscription.`
							: "This subscription was removed. Pick another model."}
					</Callout>
				)}
				{isByos && byos && (
					<Fold variant="link" title="Learn more">
						It works in its own folder on this computer and uses Sekai's tools (memory, notes, routines,
						team) through your approval settings. Titles, memory, routing and approval reviews still use the
						background model under Advanced.
					</Fold>
				)}
			</Section>

			<Section title="Limits" description="How much it may do in one reply." saveState={saveState("limits")}>
				<div className="grid gap-4 xs:grid-cols-2">
					<NumberField
						label="Most steps per reply"
						hint="It keeps going until it's done. This only stops a reply that runs away."
						value={m.maxSteps}
						min={1}
						max={1000}
						onSave={(v) => v != null && change("limits", { maxSteps: v })}
					/>
					<NumberField
						label="Reply length"
						hint="In tokens. Empty uses the model's own limit."
						value={m.maxOutputTokens}
						min={256}
						placeholder="Model's default"
						onSave={(maxOutputTokens) => change("limits", { maxOutputTokens })}
					/>
				</div>
			</Section>

			<Fold
				title="Advanced"
				summary={`Background model ${modelName(m.fast?.model ?? settings?.defaultFastModel.model)}`}
			>
				<SectionNesting>
					<Section
						title="Combine models"
						description="How several models work together on each reply."
						saveState={saveState("strategy")}
					>
						<Select
							label="Combine models"
							value={m.strategy.type}
							onValueChange={(t) => setStrategy(t as StrategyType)}
							options={STRATEGY_TYPES.map((t) => ({
								value: t,
								label: STRATEGY_LABELS[t].title,
								disabled: unavailable(t),
								description: unavailable(t)
									? "Not available with a subscription model: other models can't steer it."
									: t === "fallback" && isByos
										? "If the subscription fails before doing anything, a gateway model takes over."
										: STRATEGY_LABELS[t].description,
							}))}
						/>
						{m.strategy.type !== "single" && (
							<p className="text-small text-fg-subtle">{STRATEGY_LABELS[m.strategy.type].description}</p>
						)}
						{m.strategy.type === "planner" && (
							<Field label="Planner model">
								<ModelRefPicker
									value={m.strategy.planner}
									onChange={(v) =>
										v && change("strategy", { strategy: { type: "planner", planner: v } })
									}
								/>
							</Field>
						)}
						{(m.strategy.type === "council" || m.strategy.type === "fallback") && (
							<div className="flex flex-col gap-3">
								<div className="text-body font-medium">
									{m.strategy.type === "council" ? "Advisors" : "Fallbacks, in order"}
								</div>
								{list.map((ref, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: the same model may appear twice; position is the identity
									<div key={`${ref.model}-${i}`} className="flex items-start gap-2">
										<span className="mt-2.5 w-5 shrink-0 text-center text-caption text-fg-subtle">
											{i + 1}
										</span>
										<ModelRefPicker
											value={ref}
											onChange={(v) => v && setList(list.map((x, j) => (j === i ? v : x)))}
											className="min-w-0 flex-1"
										/>
										<IconButton
											variant="ghost"
											size="icon"
											label={`Remove model ${i + 1}`}
											disabled={list.length <= 1}
											onClick={() => setList(list.filter((_, j) => j !== i))}
										>
											<Trash2 />
										</IconButton>
									</div>
								))}
								{list.length < 4 && (
									<Button
										variant="secondary"
										size="sm"
										className="self-start"
										onClick={() => setList([...list, fallbackRef])}
									>
										<Plus /> Add a model
									</Button>
								)}
							</div>
						)}
					</Section>
					<Section title="Other models" saveState={saveState("other")}>
						<Field
							label="Background model"
							hint="Titles, memory, group routing, summaries and approval reviews."
						>
							<ModelRefPicker
								value={m.fast}
								onChange={(fast) => change("other", { fast })}
								allowNone={`App default (${settings?.defaultFastModel.model ?? "…"})`}
							/>
						</Field>
						<Field label="Vision model" hint="Looks at images when the main model can't.">
							<ModelRefPicker
								value={m.vision}
								onChange={(vision) => change("other", { vision })}
								allowNone="None"
							/>
						</Field>
					</Section>
				</SectionNesting>
			</Fold>
		</>
	);
}
