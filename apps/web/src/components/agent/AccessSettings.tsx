import { MODE_ICONS, useAccess, useSettings } from "@sekai/client";
import {
	type Agent,
	type AgentCapabilities,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalModeSetting,
	followRuleLabel,
} from "@sekai/shared";
import { List, Row, SaveState, Section, Select, ToggleRow, useAutosave } from "@sekai/ui";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";

/** Its approvals rule (when it must ask you first) and web search. */
export function AccessSettings({ agent }: { agent: Agent }) {
	const { data: settings } = useSettings();
	const { can } = useAccess();
	const update = useAgentUpdate(agent);
	const save = useAutosave((caps: AgentCapabilities) => update({ capabilities: caps }));
	const caps = agent.capabilities;
	const defaultRule = settings?.approvalMode ?? "auto";
	const effective = caps.approvalMode === "inherit" ? defaultRule : caps.approvalMode;
	const icon = (m: ApprovalModeSetting) => (
		<span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-fg-subtle">
			{MODE_ICONS[m === "inherit" ? defaultRule : m]}
			{m === "inherit" ? followRuleLabel(defaultRule) : APPROVAL_MODE_INFO[m].title}
		</span>
	);

	return (
		<Section
			title="Access"
			description="When it must ask you first, and what it may look up."
			saveState={save.status !== "idle" ? <SaveState state={save} /> : undefined}
		>
			<List label="Access">
				<Row
					wrap
					title="Approvals"
					subtitle={APPROVAL_MODE_INFO[effective].description}
					trailing={
						<Select
							label="Approvals"
							size="sm"
							className="w-full sm:w-72"
							value={caps.approvalMode}
							onValueChange={(v) => save.save({ ...caps, approvalMode: v as ApprovalModeSetting })}
							options={(["inherit", ...APPROVAL_MODES] as ApprovalModeSetting[]).map((m) => ({
								value: m,
								label: icon(m),
								description:
									m === "inherit"
										? "Whatever you chose in Settings → Approvals."
										: APPROVAL_MODE_INFO[m].description,
							}))}
						/>
					}
				/>
				<ToggleRow
					title="Web search"
					description={
						can("web")
							? "Lets it search the web and cite its sources."
							: "Your role doesn't include searching the web."
					}
					checked={caps.webSearch && can("web")}
					disabled={!can("web")}
					onCheckedChange={(webSearch) => save.save({ ...caps, webSearch })}
				/>
			</List>
		</Section>
	);
}
