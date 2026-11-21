import { api } from "@sekai/client";
import { type Agent, CHANNEL_DEFINITIONS, type ChannelType } from "@sekai/shared";
import {
	Callout,
	Field,
	FormGroup,
	Input,
	Page,
	type PageBack,
	PasswordInput,
	Section,
	Segmented,
	useFormValues,
} from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { saveForm, useAfterSave } from "../../lib/forms.ts";
import { SlackSetup } from "./SlackSetup.tsx";

/** The steps to follow on the platform, numbered, with a link to its own docs. */
function Steps({ type }: { type: ChannelType }) {
	const def = CHANNEL_DEFINITIONS[type];
	return (
		<Section title="Set it up">
			<ol className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-body">
				{def.setup.map((step, i) => (
					<li key={step} className="flex gap-3">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold">
							{i + 1}
						</span>
						<span className="min-w-0 pt-px">{step}</span>
					</li>
				))}
			</ol>
			<a
				href={def.docsUrl}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1 self-start text-small font-medium text-brand-ink hover:underline"
			>
				Official docs <ExternalLink className="size-4" />
			</a>
		</Section>
	);
}

/**
 * Connecting a Discord bot or normal account, or a Slack app: the steps on the platform, then its tokens. Connect
 * is the one button; on success it opens the new account's page.
 */
export function ConnectChannel({
	agent,
	platform,
	back,
	onConnected,
}: {
	agent: Agent;
	platform: "discord" | "slack";
	back: PageBack;
	onConnected: (channelId: string) => void;
}) {
	const qc = useQueryClient();
	const after = useAfterSave();
	const [kind, setKind] = useState<"discord" | "discord-user">("discord");
	const type: ChannelType = platform === "slack" ? "slack" : kind;
	const def = CHANNEL_DEFINITIONS[type];
	const form = useFormValues<{ values: Record<string, string>; owner: string }>({ values: {}, owner: "" });
	const { values, owner } = form.values;
	const ready = def.fields.every((f) => !f.required || values[f.key]?.trim());
	const title = platform === "slack" ? "Connect Slack" : "Connect Discord";

	return (
		<Page back={back} title={title} description={`Connect it so you can message ${agent.name} there.`}>
			{platform === "discord" && (
				<Section title="What to connect">
					<Segmented
						label="What to connect"
						value={kind}
						onValueChange={(k) => {
							setKind(k);
							form.reset({ values: {}, owner: form.values.owner });
						}}
						options={[
							{ value: "discord", label: "A bot" },
							{ value: "discord-user", label: "A normal account" },
						]}
					/>
					<p className="text-small text-fg-muted">
						{kind === "discord"
							? "A bot application: slash commands, buttons for approvals, and it works in servers."
							: "An account you made for it, not a bot application. It can join group chats and servers like a person."}
					</p>
				</Section>
			)}
			{type === "discord-user" && (
				<Callout tone="warning" icon={<ShieldAlert />}>
					Discord doesn't allow normal accounts to be used like this, so it could be limited. Use an account
					made for the bot, never your own.
				</Callout>
			)}
			{type === "slack" && <SlackSetup agent={agent} />}
			<Steps type={type} />
			<Section title="Connect">
				<FormGroup
					dirty={Object.values(values).some(Boolean) || Boolean(owner)}
					disabled={!ready}
					submitLabel="Connect"
					onCancel={() => form.reset()}
					onSubmit={() =>
						// New tokens ask "Confirm it's you" first; closing that leaves the form as it was.
						saveForm(async () => {
							const secrets: Record<string, string> = {};
							const config: Record<string, string> = {};
							for (const f of def.fields)
								(f.secret ? secrets : config)[f.key] = (values[f.key] ?? "").trim();
							const created = await api.channels.create({
								agentId: agent.id,
								type,
								secrets,
								config,
								allowFrom: owner.trim() ? [owner.trim()] : [],
							});
							void qc.invalidateQueries({ queryKey: ["channels"] });
							void qc.invalidateQueries({ queryKey: ["agentTools"] });
							form.reset();
							after(() => onConnected(created.id));
						})
					}
				>
					{def.fields.map((f) => (
						<Field key={f.key} label={f.label} hint={f.hint}>
							{f.secret ? (
								<PasswordInput
									autoComplete="off"
									value={values[f.key] ?? ""}
									onChange={(e) => form.set("values", { ...values, [f.key]: e.target.value })}
									placeholder={f.placeholder}
									className="font-mono"
								/>
							) : (
								<Input
									autoComplete="off"
									value={values[f.key] ?? ""}
									onChange={(e) => form.set("values", { ...values, [f.key]: e.target.value })}
									placeholder={f.placeholder}
									className="font-mono"
								/>
							)}
						</Field>
					))}
					<Field label="Your ID" optional hint={`${def.idHint}. Leave it empty to pair by messaging it.`}>
						<Input
							value={owner}
							onChange={(e) => form.set("owner", e.target.value)}
							placeholder="e.g. 8271 0394 1156"
							className="font-mono"
						/>
					</Field>
				</FormGroup>
			</Section>
		</Page>
	);
}
