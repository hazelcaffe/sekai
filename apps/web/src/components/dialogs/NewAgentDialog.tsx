import { AgentAvatar, api, useAccess } from "@sekai/client";
import { Button, Dialog, Field, Input, Textarea } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOpenAgent } from "../../lib/navigation.ts";
import { useUi } from "../../stores/ui.ts";
import { freshLook, NewBotLook } from "../avatar/AvatarEditor.tsx";

/** "Create New Bot": name and look, plus an optional job. Everything else is editable later. */
export function NewAgentDialog() {
	const open = useUi((s) => s.newAgentOpen);
	const setOpen = useUi((s) => s.setNewAgentOpen);
	const openAgent = useOpenAgent();
	const [name, setName] = useState("");
	const [label, setLabel] = useState("");
	const [job, setJob] = useState("");
	const [avatar, setAvatar] = useState(freshLook);
	const [lookKey, setLookKey] = useState(0);

	useEffect(() => {
		if (open) {
			setName("");
			setLabel("");
			setJob("");
			setAvatar(freshLook());
			setLookKey((k) => k + 1);
		}
	}, [open]);

	const create = useMutation({
		mutationFn: () => api.agents.create({ name: name.trim(), label: label.trim(), job: job.trim(), avatar }),
		onSuccess: (agent) => {
			setOpen(false);
			void openAgent(agent.id);
		},
	});
	const { can, access } = useAccess();

	if (access && !can("bots")) {
		return (
			<Dialog
				open={open}
				onOpenChange={setOpen}
				size="sm"
				title="Making bots isn't part of your role"
				description="You can chat with the bots shared with you. Ask an admin if you'd like your own."
				footer={
					<Button variant="primary" onClick={() => setOpen(false)}>
						OK
					</Button>
				}
			>
				{null}
			</Dialog>
		);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={setOpen}
			title="Create a new bot"
			description="Give it a name and a look. Tell it its job in the first message, or below."
			footer={
				<>
					<Button variant="secondary" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!name.trim() || create.isPending}
						onClick={() => create.mutate()}
					>
						Create
					</Button>
				</>
			}
		>
			<form
				className="flex flex-col gap-5"
				onSubmit={(e) => {
					e.preventDefault();
					if (name.trim()) create.mutate();
				}}
			>
				<div className="flex items-center gap-4">
					<AgentAvatar avatar={avatar} size={72} />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Input
							autoFocus
							placeholder="Name"
							value={name}
							maxLength={60}
							onChange={(e) => setName(e.target.value)}
						/>
						<Input
							placeholder="Label (optional), e.g. Research lead"
							value={label}
							maxLength={80}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
				</div>
				<NewBotLook key={lookKey} value={avatar} onChange={setAvatar} />
				<Field
					label="Job (optional)"
					hint="What it owns and what “done” looks like. You can refine it any time."
				>
					<Textarea
						value={job}
						onChange={(e) => setJob(e.target.value)}
						placeholder="Keeps my inbox triaged and drafts replies for anything that needs me."
						className="min-h-20"
					/>
				</Field>
				<button type="submit" hidden />
			</form>
		</Dialog>
	);
}
