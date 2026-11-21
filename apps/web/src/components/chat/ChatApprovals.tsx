import { api, qk, useSettings } from "@sekai/client";
import {
	type Agent,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalMode,
	type ApprovalModeSetting,
	type Conversation,
	followRuleLabel,
} from "@sekai/shared";
import { Field, FormGroup, Select, useFormValues } from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";

/** The rule this chat follows and where it comes from: "Ask every time · Nori's rule", "Don't ask · This chat"… */
export function approvalSummary(conversation: Conversation, agent: Agent | null, fallback?: ApprovalMode): string {
	const rule = conversation.settings.approvalMode;
	if (rule !== "inherit") return `${APPROVAL_MODE_INFO[rule].title} · This chat`;
	if (conversation.kind === "group") return "Each bot's rule";
	const botRule = agent?.capabilities.approvalMode;
	if (botRule && botRule !== "inherit") return `${APPROVAL_MODE_INFO[botRule].title} · ${agent?.name}'s rule`;
	return fallback ? `${APPROVAL_MODE_INFO[fallback].title} · Your default` : "Your default";
}

export function ChatApprovals({
	conversation,
	agent = null,
	onDone,
}: {
	conversation: Conversation;
	agent?: Agent | null;
	onDone?: () => void;
}) {
	const { data: settings } = useSettings();
	const qc = useQueryClient();
	const form = useFormValues({ approvalMode: conversation.settings.approvalMode });
	const group = conversation.kind === "group";
	// Without a rule of its own, a chat follows its bot's rule, else your default.
	const botRule = agent?.capabilities.approvalMode;
	const inherited: ApprovalMode | null =
		botRule && botRule !== "inherit" ? botRule : (settings?.approvalMode ?? null);
	const follow = group
		? "Follow each bot's rule"
		: inherited
			? followRuleLabel(inherited, botRule && botRule !== "inherit" ? agent?.name : null)
			: "Follow your default";
	const mode = form.values.approvalMode === "inherit" ? inherited : form.values.approvalMode;
	return (
		<FormGroup
			dirty={form.dirty}
			onCancel={() => (onDone ? onDone() : form.reset())}
			onSubmit={async () => {
				const saved = await api.conversations.update(conversation.id, { settings: form.values }).catch(() => {
					throw new Error("Couldn't save this approvals rule. Try again.");
				});
				qc.setQueryData<Conversation[]>(qk.conversations, (list) =>
					list?.map((chat) => (chat.id === saved.id ? saved : chat)),
				);
				qc.setQueryData(["conversation", saved.id], saved);
				form.reset({ approvalMode: saved.settings.approvalMode });
				onDone?.();
			}}
		>
			<Field
				label="When to ask"
				hint={
					group && form.values.approvalMode === "inherit"
						? "Each bot follows its own rule, or your default."
						: mode
							? APPROVAL_MODE_INFO[mode].description
							: undefined
				}
			>
				<Select
					value={form.values.approvalMode}
					onValueChange={(value) => form.set("approvalMode", value as ApprovalModeSetting)}
					options={[
						{ value: "inherit", label: follow },
						...APPROVAL_MODES.map((value) => ({ value, label: APPROVAL_MODE_INFO[value].title })),
					]}
				/>
			</Field>
		</FormGroup>
	);
}
