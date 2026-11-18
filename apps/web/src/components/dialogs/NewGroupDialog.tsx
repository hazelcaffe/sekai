import { AgentAvatar, api, cn, useAgents } from "@sekai/client";
import { Button, Dialog, Field, Input, Textarea } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useUi } from "../../stores/ui.ts";

const MAX_MEMBERS = 6;

/** New group chat: pick 2–6 bots in the To: field, then name it and say what it's for. */
export function NewGroupDialog() {
	const open = useUi((s) => s.newGroupOpen);
	const setOpen = useUi((s) => s.setNewGroupOpen);
	const navigate = useNavigate();
	const { data: agents = [] } = useAgents();
	const [selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [title, setTitle] = useState("");
	const [purpose, setPurpose] = useState("");

	useEffect(() => {
		if (open) {
			setSelected([]);
			setQuery("");
			setTitle("");
			setPurpose("");
		}
	}, [open]);

	const create = useMutation({
		mutationFn: () =>
			api.conversations.create({
				kind: "group",
				memberIds: selected,
				title: title.trim() || undefined,
				settings: { purpose: purpose.trim() },
			}),
		onSuccess: (c) => {
			setOpen(false);
			useUi.getState().setSidebarOpen(false);
			navigate(`/c/${c.id}`);
		},
	});

	const toggle = (id: string) =>
		setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_MEMBERS ? [...s, id] : s));
	const matches = agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

	return (
		<Dialog
			open={open}
			onOpenChange={setOpen}
			title="New group chat"
			description="Bots in a group share the conversation, hand work to each other with @mentions, and keep their own memory."
			footer={
				<>
					<Button variant="secondary" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={selected.length < 2 || create.isPending}
						onClick={() => create.mutate()}
					>
						Create group
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-5">
				<Field label="To" hint={`Pick 2–${MAX_MEMBERS} bots.`}>
					<div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-1.5">
						{selected.map((id) => {
							const a = agents.find((x) => x.id === id);
							if (!a) return null;
							return (
								<span
									key={id}
									className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-1 pl-0.5 text-[13px]"
								>
									<AgentAvatar avatar={a.avatar} size={20} />
									{a.name}
									<button
										type="button"
										aria-label={`Remove ${a.name}`}
										onClick={() => toggle(id)}
										className="rounded-full p-0.5 hover:bg-surface-3"
									>
										<X className="size-3" />
									</button>
								</span>
							);
						})}
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={selected.length ? "" : "Search bots"}
							className="h-8 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-fg-subtle"
						/>
					</div>
				</Field>
				<div className="-mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
					{matches.map((a) => {
						const on = selected.includes(a.id);
						return (
							<button
								key={a.id}
								type="button"
								onClick={() => toggle(a.id)}
								className={cn(
									"flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors coarse:py-2.5",
									on ? "bg-surface-2" : "hover:bg-surface-2/60",
								)}
							>
								<AgentAvatar avatar={a.avatar} size={32} />
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{a.name}</div>
									<div className="truncate text-xs text-fg-subtle">
										{a.label || a.job || "General assistant"}
									</div>
								</div>
								<span
									className={cn(
										"flex size-5 items-center justify-center rounded-full border",
										on
											? "border-primary bg-primary text-primary-foreground"
											: "border-border-strong",
									)}
								>
									{on && <Check className="size-3" />}
								</span>
							</button>
						);
					})}
				</div>
				<Field label="Name (optional)">
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Launch team"
						maxLength={200}
					/>
				</Field>
				<Field
					label="What's this group for? (optional)"
					hint="Every member sees this. Say who owns which step."
				>
					<Textarea
						value={purpose}
						onChange={(e) => setPurpose(e.target.value)}
						placeholder="Plan the v2 launch. Ada researches, Bo writes, Cy reviews."
						className="min-h-20"
					/>
				</Field>
			</div>
		</Dialog>
	);
}
