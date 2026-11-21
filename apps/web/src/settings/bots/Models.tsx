import { api, ModelRefPicker, pluralize, qk, useInfo, useSettings } from "@sekai/client";
import type { Settings } from "@sekai/shared";
import {
	Button,
	Callout,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	FormGroup,
	IconButton,
	Input,
	List,
	Page,
	PasswordInput,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	StatusDot,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Columns3, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { ApiProviders } from "./ApiProviders.tsx";
import { useSettingsAutosave } from "./common.tsx";

/** Fallback models when a model refuses or a safety filter stops it. */
function RefusalFallback({ settings }: { settings: Settings }) {
	const autosave = useSettingsAutosave();
	const r = settings.refusalRetry;
	const update = (refusalRetry: Settings["refusalRetry"]) => autosave.save({ refusalRetry });
	const summary = r.enabled ? (r.models.length ? `On · ${r.models.length} chosen` : "On · automatic") : "Off";

	return (
		<Fold title="Advanced" summary={`Refusal fallback: ${summary}`}>
			<Section
				title="Refusal fallback"
				description="Try another model if one declines or hits a safety filter."
				saveState={<SaveState state={autosave} />}
			>
				<List label="Refusal fallback">
					<ToggleRow
						title="Try another model when one refuses"
						description="The refusal is left out so the next model answers fresh."
						checked={r.enabled}
						onCheckedChange={(enabled) => update({ ...r, enabled })}
					/>
				</List>
				{r.enabled && (
					<div className="flex flex-col gap-2.5 pt-1">
						<p className="text-small text-fg-muted">
							{r.models.length
								? "Tried in order:"
								: "Sekai tries your default model, then one from each other provider, or choose your own:"}
						</p>
						{r.models.map((m, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the same model may appear twice; position is the identity
							<div key={`${m.model}-${i}`} className="flex items-start gap-2">
								<span className="mt-2.5 w-5 shrink-0 text-center text-caption font-medium tabular-nums text-fg-muted">
									{i + 1}
								</span>
								<ModelRefPicker
									value={m}
									className="flex-1"
									onChange={(v) =>
										v && update({ ...r, models: r.models.map((x, j) => (j === i ? v : x)) })
									}
								/>
								<IconButton
									variant="ghost"
									size="icon"
									label="Remove fallback model"
									onClick={() => update({ ...r, models: r.models.filter((_, j) => j !== i) })}
								>
									<Trash2 />
								</IconButton>
							</div>
						))}
						{r.models.length < 4 && (
							<Button
								variant="secondary"
								size="sm"
								className="self-start"
								onClick={() => update({ ...r, models: [...r.models, settings.defaultModel] })}
							>
								<Plus /> Add a model
							</Button>
						)}
					</div>
				)}
			</Section>
		</Fold>
	);
}

function GatewayConnection({ settings }: { settings: Settings }) {
	const qc = useQueryClient();
	const { data: info, refetch, isFetching } = useInfo();
	const form = useFormValues({
		gatewayUrl: settings.gatewayUrl,
		gatewayApiKey: settings.gatewayApiKey,
	});
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

	const test = useMutation({
		mutationFn: () =>
			api.settings.testGateway({
				gatewayUrl: form.values.gatewayUrl,
				gatewayApiKey: form.values.gatewayApiKey,
			}),
		onSuccess: (r) => {
			setTestResult(
				r.ok
					? { ok: true, message: `Connected · ${r.models} ${r.models === 1 ? "model" : "models"} available.` }
					: { ok: false, message: r.error || "Couldn't reach the model server. Check the address and key." },
			);
		},
		onError: (err) => {
			setTestResult({ ok: false, message: errorMessage(err) });
		},
	});

	const updateField = <K extends "gatewayUrl" | "gatewayApiKey">(key: K, value: string) => {
		setTestResult(null);
		form.set(key, value);
	};

	return (
		<Section
			title="Model server"
			description="Where Sekai gets its main list of models: any OpenAI-compatible server (LiteLLM, OpenRouter, Ollama, vLLM…)."
		>
			{info &&
				(info.gateway.ok ? (
					<List label="Model server status">
						<Row
							leading={<StatusDot tone="success" label="Connected" />}
							title="Connected"
							subtitle={`${pluralize(info.gateway.models, "model")} to choose from`}
							trailing={
								<Button variant="ghost" size="sm" loading={isFetching} onClick={() => void refetch()}>
									Check
								</Button>
							}
						/>
					</List>
				) : (
					<Callout
						tone="danger"
						icon={<CircleAlert />}
						title="Can't reach the model server"
						action={
							<Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
								Try again
							</Button>
						}
					>
						{info.gateway.error || "Check its address and key below, then try again."}
					</Callout>
				))}

			<FormGroup
				dirty={form.dirty}
				submitLabel="Save"
				onCancel={() => {
					setTestResult(null);
					form.reset();
				}}
				error={testResult && !testResult.ok ? testResult.message : null}
				extra={
					<Button
						variant="secondary"
						loading={test.isPending}
						disabled={!form.values.gatewayUrl.trim()}
						onClick={() => test.mutate()}
					>
						Test connection
					</Button>
				}
				onSubmit={async () => {
					setTestResult(null);
					const keyChanged = form.values.gatewayApiKey !== settings.gatewayApiKey;
					const next = await api.settings.update({
						gatewayUrl: form.values.gatewayUrl.trim(),
						...(keyChanged ? { gatewayApiKey: form.values.gatewayApiKey } : {}),
					});
					qc.setQueryData(qk.settings, next);
					void qc.invalidateQueries({ queryKey: qk.models });
					void qc.invalidateQueries({ queryKey: qk.embeddingModels });
					form.reset({ gatewayUrl: next.gatewayUrl, gatewayApiKey: next.gatewayApiKey });
					void refetch();
				}}
			>
				<Field label="Server address" hint="OpenAI-compatible gateway URL ending in /v1.">
					<Input
						value={form.values.gatewayUrl}
						onChange={(e) => updateField("gatewayUrl", e.target.value)}
						placeholder="http://127.0.0.1:4000/v1"
						className="font-mono"
					/>
				</Field>
				<Field label="API key" hint="Shown masked. Paste a new key to replace it.">
					<PasswordInput
						value={form.values.gatewayApiKey}
						onChange={(e) => updateField("gatewayApiKey", e.target.value)}
						className="font-mono"
						autoComplete="off"
					/>
				</Field>
				{testResult?.ok && (
					<p role="status" className="flex items-center gap-1.5 text-small text-success-ink">
						<CircleCheck aria-hidden className="size-4 shrink-0" />
						{testResult.message}
					</p>
				)}
			</FormGroup>
		</Section>
	);
}

function DefaultsSection({ settings }: { settings: Settings }) {
	const autosave = useSettingsAutosave();
	return (
		<Section
			title="Defaults for new bots"
			description="Each bot can pick its own models in Model & voice."
			saveState={<SaveState state={autosave} />}
		>
			<Field label="Default model">
				<ModelRefPicker
					value={settings.defaultModel}
					onChange={(v) => v && autosave.save({ defaultModel: v })}
				/>
			</Field>
			<Field label="Background model" hint="Used for titles, memory, summaries and automatic checks.">
				<ModelRefPicker
					value={settings.defaultFastModel}
					onChange={(v) => v && autosave.save({ defaultFastModel: v })}
				/>
			</Field>
		</Section>
	);
}

function ModelsBody() {
	const { data: settings, isLoading, isError, error, refetch } = useSettings();

	if (isLoading) {
		return (
			<div className="flex flex-col gap-8">
				<SkeletonRows count={2} leading={false} />
				<SkeletonRows count={3} />
			</div>
		);
	}
	if (isError || !settings) {
		return <ErrorState title="Models didn't load" error={error} onRetry={() => void refetch()} />;
	}

	return (
		<>
			<DefaultsSection settings={settings} />
			<List label="Tools">
				<Row
					icon={<Columns3 />}
					title="Compare models"
					subtitle="Send one prompt to up to four models side by side"
					href={sectionPath("compare")}
				/>
			</List>
			<GatewayConnection settings={settings} />
			<ApiProviders scope="models" />
			<RefusalFallback settings={settings} />
		</>
	);
}

export function ModelsSection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="Models" description="Default models and where Sekai gets them.">
			<ModelsBody />
		</Page>
	);
}
