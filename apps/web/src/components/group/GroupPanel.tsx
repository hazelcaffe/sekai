import { AgentAvatar, api, ModelRefPicker, qk, useAgents } from "@sekai/client";
import { type Agent, type Conversation, MAX_GROUP_MEMBERS } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	Textarea,
	useAutosave,
	useFormValues,
	useUnsavedChanges,
} from "@sekai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenAgent } from "../../lib/navigation.ts";
import { ChatApprovals } from "../chat/ChatApprovals.tsx";

export function GroupPanel({ conversation, members }: { conversation: Conversation; members: Agent[] }) {
	const agents = useAgents();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const qc = useQueryClient();
	const [title, setTitle] = useState(conversation.title);
	const [addOpen, setAddOpen] = useState(false);
	const [confirm, setConfirm] = useState<Agent | "delete" | null>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<{ title: string; retry: () => void } | null>(null);
	const update = async (patch: Parameters<typeof api.conversations.update>[1]) => {
		const chat = await api.conversations.update(conversation.id, patch).catch(() => {
			throw new Error("Couldn't save the group. Try again.");
		});
		qc.setQueryData<Conversation[]>(qk.conversations, (list) => list?.map((c) => (c.id === chat.id ? chat : c)));
		return chat;
	};
	const settings = conversation.settings;
	const nameSave = useAutosave(async (next: string) => update({ title: next }));
	const purpose = useFormValues({ purpose: settings.purpose });
	const replies = useFormValues({ maxTurns: settings.maxTurns, routerModel: settings.routerModel });
	// The reply draft stays here when Advanced is folded; don't silently discard it on close.
	useUnsavedChanges(replies.dirty);
	useEffect(() => setTitle(conversation.title), [conversation.title]);
	const candidates = (agents.data ?? []).filter((a) => !conversation.memberIds.includes(a.id));

	const membership = async (action: "add" | "remove" | "delete", bot?: Agent) => {
		if (busy) return;
		setBusy(true);
		setFailure(null);
		try {
			if (action === "delete") {
				await api.conversations.delete(conversation.id);
				navigate("/", { replace: true });
			} else if (bot) {
				const ids = conversation.memberIds;
				await update({ memberIds: action === "add" ? [...ids, bot.id] : ids.filter((id) => id !== bot.id) });
				setAddOpen(false);
			}
		} catch {
			setFailure({
				title: action === "delete" ? "Couldn't delete the group" : "Couldn't update the members",
				retry: () => void membership(action, bot),
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Section title="About" saveState={<SaveState state={nameSave} />}>
				<Field label="Name">
					<Input
						value={title}
						maxLength={200}
						onChange={(e) => setTitle(e.target.value)}
						onBlur={() => {
							if (!title.trim()) setTitle(conversation.title);
							else if (title.trim() !== conversation.title) nameSave.save(title.trim());
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
						}}
					/>
				</Field>
				<FormGroup
					dirty={purpose.dirty}
					onCancel={() => purpose.reset()}
					onSubmit={async () => {
						const saved = await update({ settings: purpose.values });
						purpose.reset({ purpose: saved.settings.purpose });
					}}
				>
					<Field label="Purpose" optional>
						<Textarea
							maxLength={4000}
							value={purpose.values.purpose}
							onChange={(e) => purpose.set("purpose", e.target.value)}
							placeholder="e.g. Plan the next issue"
						/>
					</Field>
				</FormGroup>
			</Section>
			<Section
				title="Members"
				action={
					conversation.memberIds.length < MAX_GROUP_MEMBERS && (
						<Button
							variant="ghost"
							onClick={() => {
								setFailure(null);
								setAddOpen(true);
							}}
						>
							<Plus /> Add a bot
						</Button>
					)
				}
			>
				<List>
					{members.map((bot) => (
						<Row
							key={bot.id}
							leading={<AgentAvatar avatar={bot.avatar} size={32} />}
							title={bot.name}
							subtitle={bot.label || undefined}
							onClick={() => void openAgent(bot.id)}
							menuLabel={`More for ${bot.name}`}
							menu={[
								{
									label: "Remove from group",
									icon: <UserMinus />,
									danger: true,
									disabled: busy || conversation.memberIds.length <= 2,
									onSelect: () => setConfirm(bot),
								},
							]}
						/>
					))}
				</List>
				{failure && !addOpen && <ErrorState title={failure.title} size="sm" onRetry={failure.retry} />}
			</Section>
			<Fold title="Advanced">
				<div className="flex flex-col gap-6">
					<Section
						title="Replies"
						description="Bots count toward the limit even when they hand off to each other."
					>
						<FormGroup
							dirty={replies.dirty}
							disabled={
								!Number.isInteger(replies.values.maxTurns) ||
								replies.values.maxTurns < 1 ||
								replies.values.maxTurns > 30
							}
							onCancel={() => replies.reset()}
							onSubmit={async () => {
								const { settings: saved } = await update({ settings: replies.values });
								replies.reset({ maxTurns: saved.maxTurns, routerModel: saved.routerModel });
							}}
						>
							<Field label="Replies per message" hint="Choose a number from 1 to 30.">
								<Input
									type="number"
									min={1}
									max={30}
									value={replies.values.maxTurns || ""}
									onChange={(e) => replies.set("maxTurns", Number(e.target.value))}
								/>
							</Field>
							<Field label="Routing model" hint="Picks who answers when nobody is mentioned.">
								<ModelRefPicker
									value={replies.values.routerModel}
									onChange={(model) => replies.set("routerModel", model)}
									allowNone="Default model"
								/>
							</Field>
						</FormGroup>
					</Section>
					<Section title="Approvals">
						<ChatApprovals conversation={conversation} />
					</Section>
				</div>
			</Fold>
			<Button variant="danger-ghost" className="self-start" disabled={busy} onClick={() => setConfirm("delete")}>
				<Trash2 /> Delete group
			</Button>
			<Dialog open={addOpen} onOpenChange={setAddOpen} title="Add a bot" size="sm">
				{agents.isPending ? (
					<SkeletonRows count={3} leading />
				) : agents.isError ? (
					<ErrorState title="Couldn't load bots" onRetry={() => void agents.refetch()} />
				) : candidates.length ? (
					<List>
						{candidates.map((bot) => (
							<Row
								key={bot.id}
								title={bot.name}
								leading={<AgentAvatar avatar={bot.avatar} size={32} />}
								disabled={busy}
								onClick={() => void membership("add", bot)}
							/>
						))}
					</List>
				) : (
					<EmptyState title="Every available bot is already here." size="sm" />
				)}
				{failure && <ErrorState title={failure.title} size="sm" onRetry={failure.retry} />}
			</Dialog>
			<Confirm
				open={Boolean(confirm)}
				onOpenChange={(open) => !open && setConfirm(null)}
				danger
				title={confirm === "delete" ? "Delete this group?" : `Remove ${confirm?.name ?? "this bot"}?`}
				description={
					confirm === "delete"
						? "The messages will be deleted. The bots and their memory stay."
						: "This bot will no longer receive or reply to messages here."
				}
				confirmLabel={confirm === "delete" ? "Delete group" : "Remove"}
				onConfirm={() =>
					confirm === "delete" ? void membership("delete") : confirm && void membership("remove", confirm)
				}
			/>
		</>
	);
}
