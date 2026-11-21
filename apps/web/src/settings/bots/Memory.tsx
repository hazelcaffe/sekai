import { api, dateTime, qk, useSettings } from "@sekai/client";
import {
	ErrorState,
	Field,
	Fold,
	FormGroup,
	Input,
	Page,
	SaveState,
	Section,
	Segmented,
	SkeletonRows,
	useAutosave,
	useFormValues,
} from "@sekai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsSectionProps } from "../section.ts";

type CheckupSchedule = "weekly" | "monthly" | "off";

function Checkups() {
	const qc = useQueryClient();
	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: ["memoryCheckups"],
		queryFn: api.memories.checkups,
	});
	const autosave = useAutosave(async (schedule: CheckupSchedule) => {
		const next = await api.memories.setCheckups(schedule);
		qc.setQueryData(["memoryCheckups"], next);
		return next;
	});

	if (isLoading) return <SkeletonRows count={1} leading={false} />;
	if (isError || !data) {
		return <ErrorState size="sm" title="Check-ups didn't load" error={error} onRetry={() => void refetch()} />;
	}

	return (
		<Section
			title="Check-ups"
			description="Bots tidy duplicates and ask you about older facts that may have changed."
			saveState={<SaveState state={autosave} />}
		>
			<div className="flex flex-wrap items-center gap-3">
				<Segmented<CheckupSchedule>
					label="Check-up schedule"
					value={data.schedule}
					onValueChange={(schedule) => autosave.save(schedule)}
					options={[
						{ value: "weekly", label: "Every week" },
						{ value: "monthly", label: "Every month" },
						{ value: "off", label: "Off" },
					]}
				/>
				<span className="text-small text-fg-muted">
					{data.nextAt ? `Next: ${dateTime(data.nextAt)}` : "Only when you run one manually."}
				</span>
			</div>
			<Fold variant="link" title="Learn more">
				Pinned memories and facts you wrote yourself are never removed on their own — your bot asks about them
				in its chat. You can also run a check-up any time in a bot's Memory settings.
			</Fold>
		</Section>
	);
}

function ContextDefaults({
	contextMessageLimit,
	compactionThreshold,
}: {
	contextMessageLimit: number;
	compactionThreshold: number;
}) {
	const qc = useQueryClient();
	const saved = {
		limit: String(contextMessageLimit),
		percent: String(Math.round(compactionThreshold * 100)),
	};
	const form = useFormValues(saved);
	const summary = `${contextMessageLimit} messages · ${Math.round(compactionThreshold * 100)}%`;

	return (
		<Fold title="Advanced" summary={summary}>
			<Section title="Chat context" description="Older messages fold into a summary so long chats stay fast.">
				<FormGroup
					dirty={form.dirty}
					submitLabel="Save"
					onCancel={() => form.reset()}
					onSubmit={async () => {
						const limit = Number(form.values.limit);
						const percent = Number(form.values.percent);
						if (!Number.isFinite(limit) || limit < 4 || limit > 1000) {
							throw new Error("Messages kept word for word must be between 4 and 1000.");
						}
						if (!Number.isFinite(percent) || percent < 10 || percent > 95) {
							throw new Error("Summarize percentage must be between 10 and 95.");
						}
						const next = await api.settings.update({
							contextMessageLimit: Math.round(limit),
							compactionThreshold: Math.round(percent) / 100,
						});
						qc.setQueryData(qk.settings, next);
						form.reset({
							limit: String(next.contextMessageLimit),
							percent: String(Math.round(next.compactionThreshold * 100)),
						});
					}}
				>
					<div className="grid gap-4 xs:grid-cols-2">
						<Field label="Messages kept word for word" hint="The most recent ones, always sent as-is.">
							<Input
								type="number"
								min={4}
								max={1000}
								value={form.values.limit}
								onChange={(e) => form.set("limit", e.target.value)}
								className="tabular-nums"
							/>
						</Field>
						<Field
							label="Summarize at % of the context window"
							hint="Lower is cheaper; higher keeps more detail."
						>
							<Input
								type="number"
								min={10}
								max={95}
								value={form.values.percent}
								onChange={(e) => form.set("percent", e.target.value)}
								className="tabular-nums"
							/>
						</Field>
					</div>
				</FormGroup>
			</Section>
		</Fold>
	);
}

function MemoryBody() {
	const { data: settings, isLoading, isError, error, refetch } = useSettings();

	if (isLoading) {
		return (
			<div className="flex flex-col gap-8">
				<SkeletonRows count={1} leading={false} />
				<SkeletonRows count={2} leading={false} />
			</div>
		);
	}
	if (isError || !settings) {
		return <ErrorState title="Memory settings didn't load" error={error} onRetry={() => void refetch()} />;
	}

	return (
		<>
			<Checkups />
			<ContextDefaults
				contextMessageLimit={settings.contextMessageLimit}
				compactionThreshold={settings.compactionThreshold}
			/>
		</>
	);
}

export function MemorySection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="Memory" description="Automatic check-ups and how much chat history bots keep in mind.">
			<MemoryBody />
		</Page>
	);
}
