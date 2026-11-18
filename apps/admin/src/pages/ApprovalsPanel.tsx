import { cn, MODE_ICONS, useSettings } from "@sekai/client";
import { APPROVAL_MODE_INFO, APPROVAL_MODES } from "@sekai/shared";
import { Badge, EmptyState, Field, Input, Section, SettingsPanel, Spinner } from "@sekai/ui";
import { Check, Gauge, ListChecks, Timer, Trash2 } from "lucide-react";
import { useSaveSettings } from "../lib/settings.ts";

function ApprovalsBody() {
	const { data: settings } = useSettings();
	const save = useSaveSettings();
	if (!settings) return <Spinner />;
	const rules = Object.entries(settings.toolRules);
	return (
		<>
			<Section
				title="Default mode"
				icon={<Gauge />}
				description="Bots and chats can pick their own mode; rules always win."
			>
				<div role="radiogroup" aria-label="Approval mode" className="grid gap-2">
					{APPROVAL_MODES.map((m) => {
						const on = settings.approvalMode === m;
						return (
							// biome-ignore lint/a11y/useSemanticElements: rich choice cards; ARIA radios on buttons are valid
							<button
								key={m}
								type="button"
								role="radio"
								aria-checked={on}
								onClick={() => save.mutate({ approvalMode: m })}
								className={cn(
									"flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 [&_svg]:size-4",
									on
										? "border-brand/50 bg-brand/6 ring-[3px] ring-ring/10"
										: "border-border bg-card hover:bg-muted/60",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px]",
										m === "yolo"
											? "bg-destructive/10 text-destructive"
											: on
												? "bg-brand/14 text-brand-ink"
												: "bg-muted text-muted-foreground",
									)}
								>
									{MODE_ICONS[m]}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium">{APPROVAL_MODE_INFO[m].title}</span>
									<span className="block text-xs leading-5 text-fg-subtle">
										{APPROVAL_MODE_INFO[m].description}
									</span>
								</span>
								{on && <Check className="mt-1 text-brand-ink" />}
							</button>
						);
					})}
				</div>
			</Section>
			<Section
				title="Rules for every bot"
				icon={<ListChecks />}
				description="Made with “Always allow/block … for every bot” on approval cards."
			>
				{rules.length === 0 ? (
					<EmptyState
						icon={<ListChecks />}
						tone="neutral"
						title="No rules yet"
						description="When you answer an approval, you can turn your answer into a rule for every bot."
						className="rounded-2xl border border-dashed border-border py-8"
					/>
				) : (
					<div className="divide-y divide-border rounded-2xl border border-border bg-card">
						{rules.map(([key, value]) => (
							<div key={key} className="flex items-center gap-3 px-4 py-2.5">
								<code className="min-w-0 flex-1 truncate font-mono text-xs">
									{key.replace(/^category:/, "kind: ")}
								</code>
								<Badge tone={value === "allow" ? "success" : value === "off" ? "danger" : "warning"}>
									{value}
								</Badge>
								<button
									type="button"
									aria-label="Remove rule"
									onClick={() => {
										const next = { ...settings.toolRules };
										delete next[key];
										save.mutate({ toolRules: next });
									}}
									className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-destructive/10 hover:text-destructive"
								>
									<Trash2 className="size-3.5" />
								</button>
							</div>
						))}
					</div>
				)}
			</Section>
			<Section title="Unanswered requests" icon={<Timer />}>
				<Field label="Deny automatically after" hint="So unattended routines don't hang. 0 waits forever.">
					<div className="flex items-center gap-2 text-sm">
						<Input
							type="number"
							min={0}
							max={10080}
							defaultValue={settings.approvalTimeoutMinutes}
							onBlur={(e) => {
								// An emptied field keeps the setting (it doesn't silently become "wait forever").
								if (e.target.value.trim() === "") return;
								save.mutate({ approvalTimeoutMinutes: Number(e.target.value) || 0 });
							}}
							className="w-28"
						/>
						minutes
					</div>
				</Field>
			</Section>
		</>
	);
}

export function ApprovalsPanel() {
	return (
		<SettingsPanel
			value="approvals"
			title="Approvals"
			description="When bots must ask you before they act. You answer in Needs you, in the chat, or from a notification."
		>
			<ApprovalsBody />
		</SettingsPanel>
	);
}
