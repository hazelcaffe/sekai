import { api, ModelRefPicker, useInfo, useSettings } from "@sekai/client";
import type { Settings } from "@sekai/shared";
import { Button, Callout, Field, Input, Section, SettingsPanel, Spinner, ToggleRow } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Network, Plus, RefreshCw, Repeat, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSaveSettings } from "../lib/settings.ts";
import { ApiProviders } from "./ApiProviders.tsx";

/** When a model refuses or a safety filter stops it, another model answers and the refusal is left out. */
function RefusalRetry({ settings, onChange }: { settings: Settings; onChange: (v: Settings["refusalRetry"]) => void }) {
	const r = settings.refusalRetry;
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<ToggleRow
				title="Try another model when one refuses"
				description="If a model declines a task or a safety filter stops it, another model answers instead. The refusal is left out, so the next model never sees it."
				checked={r.enabled}
				onCheckedChange={(enabled) => onChange({ ...r, enabled })}
			/>
			{r.enabled && (
				<div className="flex flex-col gap-2 border-t border-border pt-3">
					<div className="text-xs text-fg-subtle">
						{r.models.length
							? "Tried in this order:"
							: "Sekai tries your default model, then one from each other provider. Or choose your own:"}
					</div>
					{r.models.map((m, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: the same model may appear twice; position is the identity
						<div key={`${m.model}-${i}`} className="flex items-start gap-2">
							<span className="mt-2.5 w-5 shrink-0 text-center text-xs font-medium text-fg-subtle">
								{i + 1}
							</span>
							<ModelRefPicker
								value={m}
								className="flex-1"
								onChange={(v) =>
									v && onChange({ ...r, models: r.models.map((x, j) => (j === i ? v : x)) })
								}
							/>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Remove"
								onClick={() => onChange({ ...r, models: r.models.filter((_, j) => j !== i) })}
							>
								<Trash2 />
							</Button>
						</div>
					))}
					{r.models.length < 4 && (
						<Button
							variant="secondary"
							size="sm"
							className="self-start"
							onClick={() => onChange({ ...r, models: [...r.models, settings.defaultModel] })}
						>
							<Plus /> Add a model
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

function Gateway({ settings }: { settings: Settings }) {
	const { data: info, refetch, isFetching } = useInfo();
	const save = useSaveSettings();
	const [url, setUrl] = useState(settings.gatewayUrl);
	const [key, setKey] = useState(settings.gatewayApiKey);
	useEffect(() => {
		setUrl(settings.gatewayUrl);
		setKey(settings.gatewayApiKey);
	}, [settings.gatewayUrl, settings.gatewayApiKey]);
	const test = useMutation({
		mutationFn: () => api.settings.testGateway({ gatewayUrl: url, gatewayApiKey: key }),
		onSuccess: (r) => (r.ok ? toast.success(`Connected: ${r.models} models`) : toast.error(r.error ?? "Failed")),
	});
	const changed = url !== settings.gatewayUrl || key !== settings.gatewayApiKey;

	return (
		<Section
			title="Model gateway"
			icon={<Network />}
			description="Any OpenAI-compatible endpoint: LiteLLM, OpenRouter, Ollama, vLLM… Sekai lists its models and calls them there."
		>
			{info && (
				<Callout
					tone={info.gateway.ok ? "success" : "danger"}
					icon={info.gateway.ok ? <CircleCheck /> : <CircleAlert />}
					title={info.gateway.ok ? `Connected · ${info.gateway.models} models` : "Not connected"}
					action={
						<Button variant="ghost" size="xs" onClick={() => void refetch()} disabled={isFetching}>
							<RefreshCw className={isFetching ? "animate-spin" : undefined} /> Check
						</Button>
					}
				>
					<span className="font-mono">{info.gateway.url}</span>
					{!info.gateway.ok && info.gateway.error && <span className="block">{info.gateway.error}</span>}
				</Callout>
			)}
			<Field label="Base URL" hint="An OpenAI-compatible address ending in /v1, like http://127.0.0.1:4000/v1">
				<Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[13px]" />
			</Field>
			<Field label="API key" hint="Shown masked. Paste a new key to replace it.">
				<Input
					value={key}
					onChange={(e) => setKey(e.target.value)}
					className="font-mono text-[13px]"
					type="password"
					autoComplete="off"
				/>
			</Field>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
					{test.isPending && <Spinner />} Test connection
				</Button>
				<Button
					variant="primary"
					disabled={!changed || save.isPending}
					onClick={() =>
						save.mutate(
							{ gatewayUrl: url, ...(key !== settings.gatewayApiKey ? { gatewayApiKey: key } : {}) },
							{ onSuccess: () => void refetch() },
						)
					}
				>
					Save
				</Button>
			</div>
		</Section>
	);
}

function ModelsBody() {
	const { data: settings } = useSettings();
	const save = useSaveSettings();
	if (!settings) return <Spinner />;
	return (
		<>
			<Section
				title="Defaults for new bots"
				icon={<Sparkles />}
				description="Each bot can swap or combine models in its Model tab."
			>
				<Field label="Default model">
					<ModelRefPicker
						value={settings.defaultModel}
						onChange={(v) => v && save.mutate({ defaultModel: v })}
					/>
				</Field>
				<Field label="Background model" hint="Titles, memory, routing, summaries and auto-approval reviews.">
					<ModelRefPicker
						value={settings.defaultFastModel}
						onChange={(v) => v && save.mutate({ defaultFastModel: v })}
					/>
				</Field>
			</Section>
			<Section title="Refusals" icon={<Repeat />}>
				<RefusalRetry settings={settings} onChange={(refusalRetry) => save.mutate({ refusalRetry })} />
			</Section>
			<Gateway settings={settings} />
			<ApiProviders />
		</>
	);
}

export function ModelsPanel() {
	return (
		<SettingsPanel
			value="models"
			title="Models"
			description="What your bots think with. Sekai reaches models through your gateway, or through your own subscriptions."
		>
			<ModelsBody />
		</SettingsPanel>
	);
}
