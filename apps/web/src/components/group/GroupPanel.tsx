import { AgentAvatar, api, GroupAvatar, ModelRefPicker, useAgents } from "@sekai/client";
import {
	type Agent,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalModeSetting,
	type Conversation,
} from "@sekai/shared";
import { Button, Confirm, Field, IconButton, Input, Popover, PopoverClose, Section, Select, Textarea } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenAgent } from "../../lib/navigation.ts";

export function GroupPanel({
	conversation,
	members,
	onClose,
}: {
	conversation: Conversation;
	members: Agent[];
	onClose: () => void;
}) {
	const { data: agents = [] } = useAgents();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const [title, setTitle] = useState(conversation.title);
	const [purpose, setPurpose] = useState(conversation.settings.purpose);
	const [confirm, setConfirm] = useState(false);
	useEffect(() => {
		setTitle(conversation.title);
		setPurpose(conversation.settings.purpose);
	}, [conversation.title, conversation.settings.purpose]);

	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.conversations.update>[1]) =>
			api.conversations.update(conversation.id, patch),
	});
	const del = useMutation({
		mutationFn: () => api.conversations.delete(conversation.id),
		onSuccess: () => navigate("/"),
	});
	const s = conversation.settings;
	const candidates = agents.filter((a) => !conversation.memberIds.includes(a.id));

	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<GroupAvatar avatars={members.map((m) => m.avatar)} size={52} />
				<div className="min-w-0 flex-1 pt-1">
					<div className="truncate text-[17px] font-semibold tracking-tight">{conversation.title}</div>
					<div className="truncate text-[13px] text-fg-subtle">{members.length} bots</div>
				</div>
				<IconButton label="Close" onClick={onClose}>
					<X />
				</IconButton>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto border-t border-border p-4 pb-safe scrollbar-thin">
				<Section title="About">
					<Field label="Name">
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							onBlur={() =>
								title.trim() && title !== conversation.title && update.mutate({ title: title.trim() })
							}
						/>
					</Field>
					<Field label="Purpose" hint="Shown to every member. Say who owns which step.">
						<Textarea
							value={purpose}
							onChange={(e) => setPurpose(e.target.value)}
							onBlur={() => purpose !== s.purpose && update.mutate({ settings: { purpose } })}
							placeholder="Plan the launch. Ada researches, Bo drafts, Cy reviews."
						/>
					</Field>
				</Section>

				<Section
					title="Members"
					action={
						candidates.length > 0 &&
						conversation.memberIds.length < 8 && (
							<Popover
								align="end"
								trigger={
									<Button variant="secondary" size="xs">
										<Plus /> Add
									</Button>
								}
							>
								{candidates.map((a) => (
									<PopoverClose asChild key={a.id}>
										<button
											type="button"
											onClick={() =>
												update.mutate({ memberIds: [...conversation.memberIds, a.id] })
											}
											className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-2"
										>
											<AgentAvatar avatar={a.avatar} size={24} />
											{a.name}
										</button>
									</PopoverClose>
								))}
							</Popover>
						)
					}
				>
					<div className="flex flex-col gap-1">
						{members.map((m) => (
							<div
								key={m.id}
								className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2/50"
							>
								<button
									type="button"
									onClick={() => void openAgent(m.id)}
									className="flex min-w-0 flex-1 items-center gap-3 text-left"
								>
									<AgentAvatar avatar={m.avatar} size={32} />
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium">{m.name}</span>
										<span className="block truncate text-xs text-fg-subtle">
											{m.label || m.job || "General assistant"}
										</span>
									</span>
								</button>
								<IconButton
									label="Remove from group"
									size="icon-sm"
									disabled={members.length <= 2}
									onClick={() =>
										update.mutate({ memberIds: conversation.memberIds.filter((id) => id !== m.id) })
									}
								>
									<X />
								</IconButton>
							</div>
						))}
					</div>
				</Section>

				<Section
					title="How the group talks"
					description="Bots @mention each other to pass work. Every reply counts toward usage."
				>
					<Field
						label="Replies per message"
						hint="Maximum bot replies (including handoffs between bots) after each message you send."
					>
						<Input
							type="number"
							min={1}
							max={30}
							value={s.maxTurns}
							onChange={(e) => {
								const v = Number(e.target.value);
								if (v >= 1 && v <= 30) update.mutate({ settings: { maxTurns: v } });
							}}
						/>
					</Field>
					<Field label="Router model" hint="Picks who answers when nobody is @mentioned.">
						<ModelRefPicker
							value={s.routerModel}
							onChange={(routerModel) => update.mutate({ settings: { routerModel } })}
							allowNone="Default (background model)"
						/>
					</Field>
					<Field label="Approvals in this group">
						<Select
							value={s.approvalMode}
							onValueChange={(v) =>
								update.mutate({ settings: { approvalMode: v as ApprovalModeSetting } })
							}
							options={[
								{ value: "inherit", label: "Each bot's own setting" },
								...APPROVAL_MODES.map((m) => ({ value: m, label: APPROVAL_MODE_INFO[m].title })),
							]}
						/>
					</Field>
				</Section>

				<Section title="Manage">
					<Button variant="danger-ghost" size="sm" className="self-start" onClick={() => setConfirm(true)}>
						<Trash2 /> Delete group
					</Button>
				</Section>
			</div>
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title="Delete this group?"
				description="Its messages are deleted. The bots and their memory are kept."
				confirmLabel="Delete"
				danger
				onConfirm={() => del.mutate()}
			/>
		</div>
	);
}
