import { api, useAccess } from "@sekai/client";
import type { Agent, AgentShare, Person, Role, ShareTarget } from "@sekai/shared";
import {
	Button,
	Confirm,
	Dialog,
	ErrorState,
	Field,
	IconButton,
	List,
	Row,
	Section,
	Select,
	SkeletonRows,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus, UserRound, Users, X } from "lucide-react";
import { useState } from "react";

const ICON = { user: <UserRound />, role: <Users />, everyone: <Globe /> } as const;
const KIND = { user: "Person", role: "Role", everyone: "Everyone" } as const;

/** What can be picked in "Share with": everyone (admins), roles (admins), and the other people here. */
function shareOptions(taken: Set<string>, admin: boolean, roles: Role[], people: Person[]) {
	return [
		...(admin && !taken.has("everyone:") ? [{ value: "everyone:", label: "Everyone here" }] : []),
		...roles
			.filter((r) => !taken.has(`role:${r.id}`))
			.map((r) => ({ value: `role:${r.id}`, label: `Everyone with ${r.name}` })),
		...people
			.filter((p) => !taken.has(`user:${p.id}`))
			.map((p) => ({ value: `user:${p.id}`, label: `${p.name} (${p.username})` })),
	];
}

function targetOf(pick: string): ShareTarget | null {
	const [kind, id = ""] = pick.split(":");
	if (kind === "everyone") return { kind: "everyone" };
	if (kind === "role") return { kind: "role", roleId: id };
	if (kind === "user") return { kind: "user", userId: id };
	return null;
}

/**
 * Who else may chat with the bot. They talk to it in their own chats, and it keeps a separate memory of each
 * person; its computer, accounts, apps and your chats stay yours. Hidden unless your role may share bots.
 */
export function Sharing({ agent }: { agent: Agent }) {
	const { can, admin } = useAccess();
	const qc = useQueryClient();
	const key = ["agentShares", agent.id];
	const allowed = can("share");
	const shares = useQuery({ queryKey: key, queryFn: () => api.agents.shares(agent.id), enabled: allowed });
	const people = useQuery({ queryKey: ["people"], queryFn: api.people, enabled: allowed });
	const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles, enabled: admin });
	const [adding, setAdding] = useState(false);
	const [pick, setPick] = useState("");
	const [stopping, setStopping] = useState<AgentShare | null>(null);
	const set = (list: AgentShare[]) => qc.setQueryData(key, list);
	const add = useMutation({
		mutationFn: (target: ShareTarget) => api.agents.share(agent.id, target),
		onSuccess: (list) => {
			set(list);
			setAdding(false);
		},
	});
	const remove = useMutation({ mutationFn: (id: string) => api.agents.unshare(agent.id, id), onSuccess: set });
	if (!allowed) return null;

	const taken = new Set(shares.data?.map((s) => `${s.kind}:${s.targetId ?? ""}`));
	const options = shareOptions(taken, admin, roles.data ?? [], people.data ?? []);
	const target = targetOf(pick);

	return (
		<Section title="Sharing" description="People you share it with chat in their own chats. Its setup stays yours.">
			{shares.isLoading || people.isLoading ? (
				<SkeletonRows count={2} />
			) : shares.isError ? (
				<ErrorState size="sm" error={shares.error} onRetry={() => void shares.refetch()} />
			) : (
				<List label={`Who ${agent.name} is shared with`}>
					{(shares.data ?? []).map((s) => (
						<Row
							key={s.id}
							icon={ICON[s.kind]}
							title={s.name}
							subtitle={KIND[s.kind]}
							trailing={
								<IconButton
									variant="ghost"
									size="icon-sm"
									label={`Stop sharing with ${s.name}`}
									onClick={() => setStopping(s)}
								>
									<X />
								</IconButton>
							}
						/>
					))}
					{options.length > 0 ? (
						<Row
							icon={<Plus />}
							title="Share with…"
							subtitle={shares.data?.length ? undefined : `Only you can chat with ${agent.name}.`}
							onClick={() => {
								setPick("");
								setAdding(true);
							}}
						/>
					) : (
						!shares.data?.length && (
							<Row
								title={`Only you can chat with ${agent.name}`}
								subtitle="No one else here to share with yet."
							/>
						)
					)}
				</List>
			)}
			<Dialog
				open={adding}
				onOpenChange={setAdding}
				size="sm"
				title={`Share ${agent.name}`}
				description="They chat with it in their own chats. They never see your chats, its computer or its accounts."
				footer={
					<>
						<Button variant="secondary" onClick={() => setAdding(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!target}
							loading={add.isPending}
							onClick={() => target && add.mutate(target)}
						>
							Share
						</Button>
					</>
				}
			>
				<Field label="Share with">
					<Select value={pick} onValueChange={setPick} options={options} placeholder="Pick someone" />
				</Field>
			</Dialog>
			<Confirm
				open={stopping !== null}
				onOpenChange={(o) => !o && setStopping(null)}
				title={`Stop sharing with ${stopping?.name ?? ""}?`}
				description={`They won't see ${agent.name} anymore. Their chats with it are kept if you share it again.`}
				confirmLabel="Stop sharing"
				danger
				onConfirm={() => stopping && remove.mutate(stopping.id)}
			/>
		</Section>
	);
}
