import { api, qk, timeAgo, useAccess, useEmailAccount } from "@sekai/client";
import type { Agent, EmailAccount } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	CopyField,
	EmptyState,
	ErrorState,
	Field,
	FormGroup,
	Input,
	List,
	Page,
	Row,
	Section,
	SkeletonRows,
	Textarea,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Inbox, Mail, MailPlus, RotateCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { botPath } from "../../bots/registry.tsx";
import type { BotSectionProps } from "../../bots/section.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";
import { CreateAddress, UseEmailAccount } from "./EmailConnect.tsx";

function Recent({ id }: { id: string }) {
	const mail = useQuery({ queryKey: qk.emailRecent(id), queryFn: () => api.email.recent(id) });
	return (
		<Section title="Recent mail">
			{mail.isPending ? (
				<SkeletonRows count={2} />
			) : mail.isError ? (
				<ErrorState error={mail.error} onRetry={() => void mail.refetch()} />
			) : !mail.data.length ? (
				<EmptyState
					size="sm"
					icon={<Inbox />}
					title="No mail yet."
					description="New messages will appear here."
				/>
			) : (
				<List>
					{mail.data.map((m) => (
						<Row
							key={m.id}
							icon={<Mail />}
							title={m.subject || "(No subject)"}
							subtitle={`${m.direction === "out" ? `To ${m.to.join(", ")}` : `From ${m.from || "unknown sender"}`} · ${timeAgo(m.at)}${m.sender === "unknown" || m.sender === "unverified" ? " · Inbox only" : ""}`}
							href={m.conversationId ? `/c/${m.conversationId}` : undefined}
						/>
					))}
				</List>
			)}
		</Section>
	);
}
const policy = (a: EmailAccount) => ({
	senders: a.allowFrom.join("\n"),
	signature: a.signature,
	dailyLimit: a.dailyLimit,
	notifyUnknown: a.notifyUnknown,
});
function Connected({ a, home }: { a: EmailAccount; home: string }) {
	const qc = useQueryClient();
	const f = useFormValues(policy(a));
	const v = f.values;
	const [removal, setRemoval] = useState<"disconnect" | "delete" | null>(null);
	const put = (next: EmailAccount) => qc.setQueryData(qk.emailAccount(a.agentId), next);
	const reconnect = useMutation({
		mutationFn: () => api.email.reconnect(a.agentId),
		onSuccess: put,
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: (del: boolean) => api.email.remove(a.agentId, del),
		onSuccess: () => qc.setQueryData(qk.emailAccount(a.agentId), null),
		onError: actionError,
	});
	const s = a.status;
	const problem =
		s.problem === "auth"
			? "Can't sign in"
			: s.problem === "full"
				? "Mailbox full"
				: s.problem
					? "Connection problem"
					: null;
	return (
		<>
			<Section
				title="Address"
				action={
					<Badge tone={problem ? "warning" : s.state === "connected" ? "success" : "neutral"}>
						{problem ??
							{ connected: "Connected", connecting: "Connecting…", off: "Off", error: "Not connected" }[
								s.state
							]}
					</Badge>
				}
			>
				<CopyField label="Email address" value={a.address} />
				{s.error && <Callout tone="warning">{s.error}</Callout>}
				{a.usage && (
					<p className="text-small text-fg-muted">
						{Math.ceil(a.usage.usedBytes / 1048576)} MB used
						{a.usage.quotaBytes ? ` of ${Math.round(a.usage.quotaBytes / 1048576)} MB` : ""}.
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="secondary" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
						<RotateCw />
						Reconnect
					</Button>
					{a.webmailUrl && (
						<a
							className="text-small text-brand-ink hover:underline"
							href={a.webmailUrl}
							target="_blank"
							rel="noreferrer"
						>
							Open webmail
						</a>
					)}
				</div>
				{a.kind === "account" && (
					<List>
						<Row title="Sign-in details" href={`${home}/connect`} />
					</List>
				)}
			</Section>
			<Section title="Who can email it" description="Only verified mail from these addresses can start a chat.">
				<FormGroup
					dirty={f.dirty}
					onCancel={() => f.reset()}
					onSubmit={() =>
						saveForm(async () => {
							const updated = await api.email.update(a.agentId, {
								allowFrom: v.senders.split(/[\s,;]+/).filter(Boolean),
								dailyLimit: v.dailyLimit,
								notifyUnknown: v.notifyUnknown,
								signature: v.signature,
							});
							put(updated);
							f.reset(policy(updated));
						})
					}
				>
					<Field
						label="Allowed addresses"
						hint="One per line. Choose people you trust with this bot's tools and memory."
					>
						<Textarea rows={3} value={v.senders} onChange={(e) => f.set("senders", e.target.value)} />
					</Field>
					<List>
						<ToggleRow
							title="Show new senders in Needs you"
							description="Other mail stays in the inbox without starting a chat."
							checked={v.notifyUnknown}
							onCheckedChange={(n) => f.set("notifyUnknown", n)}
						/>
					</List>
					<Field label="Signature" optional>
						<Textarea rows={2} value={v.signature} onChange={(e) => f.set("signature", e.target.value)} />
					</Field>
					<Field
						label="Daily send limit"
						hint={`${a.sentToday} sent in the last 24 hours, including replies.`}
					>
						<Input
							type="number"
							min={1}
							max={2000}
							value={v.dailyLimit || ""}
							onChange={(e) => f.set("dailyLimit", Number(e.target.value))}
						/>
					</Field>
				</FormGroup>
			</Section>
			<Recent id={a.agentId} />
			<Section title="Remove address">
				<List>
					<Row
						title="Disconnect"
						subtitle="Keep the mailbox and its messages."
						onClick={() => setRemoval("disconnect")}
					/>
					{a.kind === "mailcow" && (
						<Row
							danger
							title="Delete the mailbox too"
							subtitle="Permanently erase its mail on the server."
							onClick={() => setRemoval("delete")}
						/>
					)}
				</List>
			</Section>
			<Confirm
				open={removal !== null}
				onOpenChange={(open) => !open && setRemoval(null)}
				danger
				title={`${removal === "delete" ? "Delete" : "Disconnect"} ${a.address}?`}
				description={
					removal === "delete"
						? "This permanently deletes the mailbox and all its messages on mailcow. Existing Sekai chats are kept."
						: "The bot stops sending and receiving email. Its mailbox and existing chats are kept."
				}
				confirmLabel={removal === "delete" ? "Delete mailbox" : "Disconnect"}
				onConfirm={() => remove.mutate(removal === "delete")}
			/>
		</>
	);
}
export function EmailPage({ agent, page, back }: { agent: Agent; page: string; back: BotSectionProps["back"] }) {
	const account = useEmailAccount(agent.id);
	const opts = useQuery({ queryKey: qk.emailOptions, queryFn: api.email.options });
	const qc = useQueryClient();
	const navigate = useNavigate();
	const after = useAfterSave();
	const { can } = useAccess();
	const home = botPath(agent.id, "accounts", "email");
	const done = (a: EmailAccount) => {
		qc.setQueryData(qk.emailAccount(agent.id), a);
		after(() => navigate(home, { replace: true }));
	};
	const creating = page === "create" && !account.data;
	const connecting = page === "connect" && account.data?.kind !== "mailcow";
	const title = creating
		? "Create an address"
		: connecting
			? account.data
				? "Sign-in details"
				: "Use an email account"
			: "Email";
	return (
		<Page
			back={back}
			title={title}
			description={
				creating
					? `Make a mailbox for ${agent.name} on your mail server.`
					: connecting
						? "Connect the account's incoming and outgoing mail."
						: `${agent.name}'s address for sending and receiving mail.`
			}
		>
			{account.isPending || opts.isPending ? (
				<SkeletonRows count={3} />
			) : account.isError || opts.isError ? (
				<ErrorState
					error={account.error ?? opts.error}
					onRetry={() => {
						void opts.refetch();
						void account.refetch();
					}}
				/>
			) : connecting ? (
				<UseEmailAccount agent={agent} account={account.data} onSaved={done} />
			) : account.data ? (
				<Connected a={account.data} home={home} />
			) : creating && opts.data.mailcow.ready ? (
				<CreateAddress agent={agent} domains={opts.data.mailcow.domains} onSaved={done} />
			) : (
				<Section title="Give it an address">
					<List>
						<Row
							icon={<MailPlus />}
							title="Create an address"
							subtitle={
								opts.data.mailcow.ready
									? "Make a new mailbox on your mail server."
									: can("admin")
										? "Set up mailcow in Settings first."
										: "Ask an admin to connect a mail server first."
							}
							href={
								opts.data.mailcow.ready
									? `${home}/create`
									: can("admin")
										? "/settings/email"
										: undefined
							}
						/>
						<Row
							icon={<AtSign />}
							title="Use an email account"
							subtitle="Connect a mailbox you already have."
							href={`${home}/connect`}
						/>
					</List>
				</Section>
			)}
		</Page>
	);
}
