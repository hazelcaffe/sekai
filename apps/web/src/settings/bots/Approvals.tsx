import { api, cn, MODE_ICONS, qk, useAccess, useSettings } from "@sekai/client";
import { APPROVAL_MODE_INFO, APPROVAL_MODES, type ApprovalMode, type ToolPermission } from "@sekai/shared";
import {
	Badge,
	Confirm,
	EmptyState,
	ErrorState,
	Field,
	FormGroup,
	IconButton,
	Input,
	List,
	Page,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ListChecks, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SettingsSectionProps } from "../section.ts";
import { formatRuleKey, useSettingsAutosave } from "./common.tsx";

const RULE_BADGE: Record<ToolPermission, { tone: "success" | "warning" | "danger"; label: string }> = {
	allow: { tone: "success", label: "Always allow" },
	ask: { tone: "warning", label: "Always ask" },
	off: { tone: "danger", label: "Always block" },
};

const COVERS = { kind: "All tools of this kind", app: "All tools from this app", tool: undefined } as const;

function DefaultRuleSection({ savedMode }: { savedMode: ApprovalMode }) {
	const qc = useQueryClient();
	const form = useFormValues({ approvalMode: savedMode });
	const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const moveTo = (index: number) => {
		const nextIndex = (index + APPROVAL_MODES.length) % APPROVAL_MODES.length;
		const mode = APPROVAL_MODES[nextIndex];
		if (!mode) return;
		form.set("approvalMode", mode);
		radioRefs.current[nextIndex]?.focus();
	};

	return (
		<Section title="Default rule" description="Bots and chats can override this. Specific rules always win.">
			<FormGroup
				dirty={form.dirty}
				submitLabel="Save"
				onCancel={() => form.reset()}
				onSubmit={async () => {
					const next = await api.settings.update({ approvalMode: form.values.approvalMode });
					qc.setQueryData(qk.settings, next);
					form.reset({ approvalMode: next.approvalMode });
				}}
			>
				<div
					role="radiogroup"
					aria-label="Default approvals rule"
					className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
				>
					{APPROVAL_MODES.map((m, i) => {
						const on = form.values.approvalMode === m;
						const copy = APPROVAL_MODE_INFO[m];
						return (
							// biome-ignore lint/a11y/useSemanticElements: rich choice rows; ARIA radios on buttons are standard
							<button
								key={m}
								ref={(el) => {
									radioRefs.current[i] = el;
								}}
								type="button"
								role="radio"
								aria-checked={on}
								tabIndex={on ? 0 : -1}
								onClick={() => form.set("approvalMode", m)}
								onKeyDown={(e) => {
									if (e.key === "ArrowDown" || e.key === "ArrowRight") {
										e.preventDefault();
										moveTo(i + 1);
									} else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
										e.preventDefault();
										moveTo(i - 1);
									} else if (e.key === "Home") {
										e.preventDefault();
										moveTo(0);
									} else if (e.key === "End") {
										e.preventDefault();
										moveTo(APPROVAL_MODES.length - 1);
									}
								}}
								className={cn(
									"flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-fast coarse:py-3.5 [&_svg]:size-4",
									on ? "bg-brand-soft/45" : "hover:bg-surface-2/60",
								)}
							>
								<span
									aria-hidden
									className={cn(
										"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
										m === "yolo"
											? "bg-danger-soft text-danger-ink"
											: on
												? "bg-brand-soft text-brand-ink"
												: "bg-surface-2 text-fg-muted",
									)}
								>
									{MODE_ICONS[m]}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-body font-medium text-fg">{copy.title}</span>
									<span className="mt-0.5 block text-small text-fg-muted">{copy.description}</span>
								</span>
								<span className="mt-1 flex size-5 shrink-0 items-center justify-center">
									{on && <Check aria-hidden className="size-4 text-brand-ink" />}
								</span>
							</button>
						);
					})}
				</div>
			</FormGroup>
		</Section>
	);
}

function RulesSection({ toolRules }: { toolRules: Record<string, ToolPermission> }) {
	const qc = useQueryClient();
	const [removing, setRemoving] = useState<string | null>(null);
	const remove = useMutation({
		mutationFn: async (key: string) => {
			const next = { ...toolRules };
			delete next[key];
			return api.settings.update({ toolRules: next });
		},
		onSuccess: (next) => {
			qc.setQueryData(qk.settings, next);
			setRemoving(null);
		},
	});
	const rules = Object.entries(toolRules);
	const removingInfo = removing ? formatRuleKey(removing) : null;

	return (
		<Section
			title="Rules for every bot"
			description="Added when you pick “Always allow” or “Always block” on a request."
		>
			{rules.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<ListChecks />}
					title="No rules yet"
					className="rounded-lg border border-dashed border-border"
				/>
			) : (
				<List label="Rules for every bot">
					{rules.map(([key, value]) => {
						const info = formatRuleKey(key);
						const badge = RULE_BADGE[value];
						return (
							<Row
								key={key}
								title={
									info.covers === "tool" ? (
										<code className="font-mono">{info.label}</code>
									) : (
										info.label
									)
								}
								subtitle={COVERS[info.covers]}
								badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
								trailing={
									<IconButton
										variant="ghost"
										size="icon-sm"
										label={`Remove the rule for ${info.label}`}
										onClick={() => setRemoving(key)}
									>
										<Trash2 />
									</IconButton>
								}
							/>
						);
					})}
				</List>
			)}
			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Remove the rule for ${removingInfo?.label ?? ""}?`}
				description="Your default approvals rule will apply to these actions again."
				confirmLabel="Remove"
				danger
				onConfirm={() => removing && remove.mutate(removing)}
			/>
		</Section>
	);
}

function TimeoutSection({ minutes, isAdmin }: { minutes: number; isAdmin: boolean }) {
	const autosave = useSettingsAutosave();
	const [draft, setDraft] = useState(String(minutes));

	useEffect(() => {
		setDraft(String(minutes));
	}, [minutes]);

	const commit = () => {
		const trimmed = draft.trim();
		// An emptied field keeps the saved value instead of silently becoming "wait forever".
		if (!trimmed) {
			setDraft(String(minutes));
			return;
		}
		const n = Math.min(10080, Math.max(0, Math.round(Number(trimmed) || 0)));
		setDraft(String(n));
		if (n !== minutes) autosave.save({ approvalTimeoutMinutes: n });
	};

	if (!isAdmin) {
		return (
			<Section title="Unanswered requests">
				<List label="Unanswered requests">
					<Row
						title="Deny automatically after"
						subtitle="Only admins can change this."
						value={minutes === 0 ? "Never" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`}
					/>
				</List>
			</Section>
		);
	}

	return (
		<Section
			title="Unanswered requests"
			description="Keep unattended routines from waiting forever."
			saveState={<SaveState state={autosave} />}
		>
			<Field label="Deny automatically after" hint="Use 0 to wait until you answer.">
				<div className="flex items-center gap-2 text-body text-fg-muted">
					<Input
						type="number"
						min={0}
						max={10080}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.currentTarget.blur();
							}
						}}
						className="w-28 tabular-nums"
					/>
					<span>minutes</span>
				</div>
			</Field>
		</Section>
	);
}

function ApprovalsBody() {
	const { data: settings, isLoading, isError, error, refetch } = useSettings();
	const { admin } = useAccess();

	if (isLoading) {
		return (
			<div className="flex flex-col gap-8">
				<SkeletonRows count={5} />
				<SkeletonRows count={2} leading={false} />
			</div>
		);
	}
	if (isError || !settings) {
		return <ErrorState title="Approvals didn't load" error={error} onRetry={() => void refetch()} />;
	}

	return (
		<>
			<DefaultRuleSection savedMode={settings.approvalMode} />
			<RulesSection toolRules={settings.toolRules} />
			<TimeoutSection minutes={settings.approvalTimeoutMinutes} isAdmin={admin} />
		</>
	);
}

export function ApprovalsSection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="Approvals" description="When bots must ask you before they act.">
			<ApprovalsBody />
		</Page>
	);
}
