import { AgentAvatar, api, useAgents } from "@sekai/client";
import { Button, Callout, Dialog, errorMessage, List, Row } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useUi } from "../../stores/ui.ts";

/** New chat: pick one of your bots (or one shared with you) and start a fresh chat with it. */
export function NewChatDialog() {
	const open = useUi((s) => s.newChatOpen);
	const setOpen = useUi((s) => s.setNewChatOpen);
	const { data: agents = [] } = useAgents();
	const navigate = useNavigate();
	const start = useMutation({
		mutationFn: (agentId: string) => api.conversations.create({ kind: "direct", agentId }),
		onSuccess: (c) => {
			setOpen(false);
			useUi.getState().setSidebarOpen(false);
			navigate(`/c/${c.id}`);
		},
		// Said here, beside the bots, so you can try again or pick another.
		onError: () => {},
	});
	const { reset } = start;
	useEffect(() => {
		if (open) reset();
	}, [open, reset]);
	const failedWith = start.isError ? agents.find((a) => a.id === start.variables) : undefined;
	const bots = [...agents].sort(
		(a, b) =>
			Number(b.isPrimary) - Number(a.isPrimary) ||
			Number(a.hidden) - Number(b.hidden) ||
			a.sortOrder - b.sortOrder,
	);
	return (
		<Dialog open={open} onOpenChange={setOpen} title="New chat" description="Who's it with?" size="sm">
			{start.isError && (
				<Callout
					tone="danger"
					icon={<CircleAlert />}
					className="mb-3"
					action={
						<Button variant="secondary" size="sm" onClick={() => start.mutate(start.variables)}>
							Try again
						</Button>
					}
				>
					Couldn't start a chat{failedWith ? ` with ${failedWith.name}` : ""}. {errorMessage(start.error)}
				</Callout>
			)}
			<List className="max-h-[60dvh] overflow-y-auto">
				{bots.map((a) => (
					<Row
						key={a.id}
						leading={<AgentAvatar avatar={a.avatar} size={32} />}
						title={a.name}
						subtitle={a.sharedBy ? `Shared by ${a.sharedBy}` : a.label || undefined}
						disabled={start.isPending}
						onClick={() => start.mutate(a.id)}
					/>
				))}
			</List>
		</Dialog>
	);
}
