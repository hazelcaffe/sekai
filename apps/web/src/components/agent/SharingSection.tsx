import { api, useAccess } from "@sekai/client";
import type { Agent, AgentShare, ShareTarget } from "@sekai/shared";
import { Button, Section, Select, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, UserRound, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const ICON = { user: <UserRound />, role: <Users />, everyone: <Globe /> } as const;

/**
 * Who else may chat with the bot. They talk to it in their own chats, and it keeps a separate memory of each
 * person; its computer, accounts, apps and your chats stay yours.
 */
export function SharingSection({ agent }: { agent: Agent }) {
	const { can, admin } = useAccess();
	const qc = useQueryClient();
	const key = ["agentShares", agent.id];
	const shares = useQuery({ queryKey: key, queryFn: () => api.agents.shares(agent.id), enabled: can("share") });
	const people = useQuery({ queryKey: ["people"], queryFn: api.people, enabled: can("share") });
	const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles, enabled: admin });
	const [pick, setPick] = useState("");
	const set = (list: AgentShare[]) => qc.setQueryData(key, list);
	const add = useMutation({
		mutationFn: (target: ShareTarget) => api.agents.share(agent.id, target),
		onSuccess: (list) => {
			set(list);
			setPick("");
		},
		onError: (err) => toast.error(err.message),
	});
	const remove = useMutation({
		mutationFn: (id: string) => api.agents.unshare(agent.id, id),
		onSuccess: set,
		onError: (err) => toast.error(err.message),
	});
	if (!can("share")) return null;

	const taken = new Set(shares.data?.map((s) => `${s.kind}:${s.targetId ?? ""}`));
	const options = [
		...(admin && !taken.has("everyone:") ? [{ value: "everyone:", label: "Everyone here" }] : []),
		...(roles.data ?? [])
			.filter((r) => !taken.has(`role:${r.id}`))
			.map((r) => ({ value: `role:${r.id}`, label: `Everyone with ${r.name}` })),
		...(people.data ?? [])
			.filter((p) => !taken.has(`user:${p.id}`))
			.map((p) => ({ value: `user:${p.id}`, label: `${p.name} (${p.username})` })),
	];
	const share = () => {
		const [kind, id = ""] = pick.split(":");
		if (kind === "everyone") add.mutate({ kind: "everyone" });
		else if (kind === "role") add.mutate({ kind: "role", roleId: id });
		else if (kind === "user") add.mutate({ kind: "user", userId: id });
	};

	return (
		<Section
			title="Sharing"
			description="People you share it with chat with it in their own chats, and it remembers each of them separately. Your chats, its computer, accounts and apps stay yours."
		>
			{shares.isLoading ? (
				<Spinner />
			) : shares.data?.length ? (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{shares.data.map((s) => (
						<div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-muted [&_svg]:size-4">
								{ICON[s.kind]}
							</span>
							<span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Stop sharing with ${s.name}`}
								disabled={remove.isPending}
								onClick={() => remove.mutate(s.id)}
							>
								<X />
							</Button>
						</div>
					))}
				</div>
			) : (
				<p className="px-1 text-[13px] text-fg-subtle">Only you can chat with {agent.name}.</p>
			)}
			{options.length > 0 ? (
				<div className="flex gap-2">
					<Select
						value={pick}
						onValueChange={setPick}
						options={options}
						placeholder="Share with…"
						className="min-w-0 flex-1"
					/>
					<Button variant="secondary" disabled={!pick || add.isPending} onClick={share}>
						{add.isPending && <Spinner />} Share
					</Button>
				</div>
			) : (
				!people.isLoading &&
				!shares.data?.length && (
					<p className="px-1 text-[13px] text-fg-subtle">There's no one else here to share with yet.</p>
				)
			)}
		</Section>
	);
}
