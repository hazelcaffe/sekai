import { api, dateTime, useSettings } from "@sekai/client";
import { Field, Input, Section, Segmented, SettingsPanel, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { useSaveSettings } from "../lib/settings.ts";

function Checkups() {
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ["memoryCheckups"], queryFn: api.memories.checkups });
	const save = useMutation({
		mutationFn: api.memories.setCheckups,
		onSuccess: (d) => qc.setQueryData(["memoryCheckups"], d),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	if (!data) return null;
	return (
		<Section
			title="Check-ups"
			icon={<ListChecks />}
			description="Each bot reads what it remembers, merges memories that say the same thing, drops ones a newer memory replaced, and asks you about older facts that may have changed, in its chat. Pinned memories and ones you wrote are only ever asked about. Or run one from a bot's Brain tab."
		>
			<div className="flex flex-wrap items-center gap-3">
				<Segmented
					value={data.schedule}
					onValueChange={(schedule) => save.mutate(schedule)}
					options={[
						{ value: "weekly", label: "Every week" },
						{ value: "monthly", label: "Every month" },
						{ value: "off", label: "Off" },
					]}
				/>
				<span className="text-xs text-fg-subtle">
					{data.nextAt ? `Next: ${dateTime(data.nextAt)}` : "Only when you run one."}
				</span>
			</div>
		</Section>
	);
}

function MemoryBody() {
	const { data: settings } = useSettings();
	const save = useSaveSettings();
	if (!settings) return <Spinner />;
	return (
		<>
			<Checkups />
			<Section
				title="Context"
				icon={<Layers />}
				description="Older messages get folded into a summary so long chats stay fast and affordable."
			>
				<div className="grid gap-4 xs:grid-cols-2">
					<Field label="Messages kept word for word" hint="The most recent ones, always sent as they are.">
						<Input
							type="number"
							min={4}
							max={1000}
							defaultValue={settings.contextMessageLimit}
							onBlur={(e) =>
								e.target.value.trim() && save.mutate({ contextMessageLimit: Number(e.target.value) })
							}
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
							defaultValue={Math.round(settings.compactionThreshold * 100)}
							onBlur={(e) =>
								e.target.value.trim() &&
								save.mutate({ compactionThreshold: Number(e.target.value) / 100 })
							}
						/>
					</Field>
				</div>
			</Section>
		</>
	);
}

export function MemoryPanel() {
	return (
		<SettingsPanel
			value="memory"
			title="Memory"
			description="Each bot keeps its own memories and notes (see its Brain tab). Check-ups keep them tidy and true; context decides how much of a chat a bot sees at once."
		>
			<MemoryBody />
		</SettingsPanel>
	);
}
