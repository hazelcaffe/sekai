import {
	AgentAvatar,
	api,
	useAccess,
	useAgents,
	useMachineMembers,
	useMachines,
	useSeats,
	useSharedBrowsers,
} from "@sekai/client";
import type { Agent, Machine, MachineMember, MachineSeat, SharedBrowser, SignInMode } from "@sekai/shared";
import {
	Badge,
	Button,
	Checkbox,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	FormGroup,
	IconButton,
	Input,
	List,
	Row,
	SaveState,
	Section,
	Segmented,
	Select,
	SkeletonRows,
	Spinner,
	ToggleRow,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Globe, Pencil, Plus, RotateCw, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadProblem } from "./LoadProblem.tsx";
import { Access, MemberBadge } from "./MachineParts.tsx";
import { useComputerSave } from "./useComputerSave.ts";

/** Sharing: other bots on a bot's computer or devbox (each in its own seat), and browsers several bots use. */

const fail = () => toast.error("Couldn’t update sharing. Check the connection and try again.");

const VIEWERS_HINT =
	"Your own bots here may use it when people you've shared them with chat with them. Bots others shared with you never do.";

function BotLine({ agent, name, sharedBy }: { agent?: Agent; name: string; sharedBy: string | null }) {
	return (
		<span className="flex min-w-0 items-center gap-2.5">
			{agent ? (
				<AgentAvatar avatar={agent.avatar} size={28} />
			) : (
				<span className="size-7 shrink-0 rounded-full bg-surface-2" />
			)}
			<span className="min-w-0">
				<span className="block truncate text-body font-medium">{name}</span>
				{sharedBy && (
					<span className="block truncate text-small text-fg-subtle">Shared with you by {sharedBy}</span>
				)}
			</span>
		</span>
	);
}

/** Bots you can add: yours, and the ones shared with you (they say whose). */
function botOptions(agents: Agent[], exclude: Set<string>) {
	return agents
		.filter((a) => !exclude.has(a.id))
		.map((a) => ({
			value: a.id,
			label: a.name,
			description: a.sharedBy ? `Shared with you by ${a.sharedBy}` : undefined,
		}));
}

/** "Share with other bots" on the owner's machine card: who's on it, adding and removing them, the viewers switch. */
export function ShareMachine({ machine }: { machine: Machine }) {
	const membership = useMachineMembers(machine.id);
	const bots = useAgents();
	const members = membership.data ?? [];
	const agents = bots.data ?? [];
	const { can } = useAccess();
	const [pick, setPick] = useState("");
	const [removing, setRemoving] = useState<MachineMember | null>(null);
	const add = useMutation({
		mutationFn: (agentId: string) => api.machines.members.add(machine.id, { agentId }),
		onSuccess: () => setPick(""),
		onError: fail,
	});
	const remove = useMutation({
		mutationFn: (id: string) => api.machines.members.remove(machine.id, id),
		onError: fail,
	});
	const retry = useMutation({
		mutationFn: (id: string) => api.machines.members.retry(machine.id, id),
		onError: fail,
	});
	const viewers = useComputerSave((on: boolean) => api.machines.update(machine.id, { shareWithViewers: on }));
	const computer = machine.kind === "computer";
	const running = machine.status === "running";
	const options = botOptions(agents, new Set([machine.agentId, ...members.map((m) => m.agentId)]));
	const byId = new Map(agents.map((a) => [a.id, a]));
	if (membership.isError || bots.isError)
		return (
			<LoadProblem
				what="sharing"
				retry={() => {
					void bots.refetch();
					void membership.refetch();
				}}
			/>
		);
	if (!membership.data || !bots.data) return <SkeletonRows />;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-start gap-2.5">
				<Users className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
				<span className="min-w-0 flex-1">
					<span className="block text-small text-fg-subtle">
						Each gets its own account{computer ? ", screen and Chrome" : ""} here, and works on it in your
						chats.
					</span>
				</span>
			</div>
			{members.length > 0 && (
				<div className="flex flex-col divide-y divide-border">
					{members.map((m) => (
						<div key={m.id} className="flex flex-col gap-1 py-2">
							<div className="flex items-center gap-2">
								<span className="min-w-0 flex-1">
									<BotLine agent={byId.get(m.agentId)} name={m.agentName} sharedBy={m.sharedBy} />
								</span>
								<MemberBadge member={m} />
								{m.status === "error" && (
									<IconButton
										size="icon-sm"
										label="Try again"
										disabled={retry.isPending || !running}
										onClick={() => retry.mutate(m.id)}
									>
										<RotateCw />
									</IconButton>
								)}
								<IconButton
									size="icon-sm"
									label={`Remove ${m.agentName}`}
									disabled={m.status === "removing" || remove.isPending}
									onClick={() => setRemoving(m)}
								>
									<Trash2 />
								</IconButton>
							</div>
							<span className="flex items-center gap-1.5 pl-[38px] text-small text-fg-subtle">
								{(m.status === "adding" || m.status === "removing") && <Spinner />}
								<span className="min-w-0 break-words">
									{m.status === "ready"
										? `Account ${m.username}${m.display !== null ? ` · screen :${m.display}` : ""}`
										: m.status === "error"
											? "Couldn’t set up this account. Try again when the computer is running."
											: m.status === "adding"
												? "Adding the account…"
												: "Removing the account…"}
								</span>
							</span>
						</div>
					))}
				</div>
			)}
			{can("computers") && options.length > 0 && (
				<div className="flex gap-2">
					<Select
						label="Bot to add"
						value={pick}
						onValueChange={setPick}
						options={options}
						placeholder="Add a bot"
						size="sm"
						className="min-w-0 flex-1"
						disabled={!running || add.isPending}
					/>
					<Button
						variant="secondary"
						size="sm"
						disabled={!pick || !running || add.isPending}
						onClick={() => add.mutate(pick)}
					>
						{add.isPending ? <Spinner /> : <Plus />} Add
					</Button>
				</div>
			)}
			{!running && (
				<p className="text-small text-fg-subtle">Turn it on to add bots: their accounts are made on it.</p>
			)}
			{!can("computers") && (
				<p className="text-small text-fg-muted">Your role doesn’t allow adding bots to a computer.</p>
			)}
			<ToggleRow
				title="Also for people these bots are shared with"
				description={VIEWERS_HINT}
				checked={machine.shareWithViewers}
				onCheckedChange={viewers.save}
				disabled={viewers.status === "saving"}
			/>
			<SaveState state={viewers} />
			{members.length > 0 && (
				<p className="flex items-start gap-1.5 text-small text-fg-subtle">
					<AlertTriangle className="mt-0.5 size-4 shrink-0" />
					Turning it off, resizing it or going back to a checkpoint affects every bot on it.
				</p>
			)}
			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Remove ${removing?.agentName ?? "this bot"}?`}
				description={`Its account on ${machine.name} goes, with its home folder${computer ? ", screen and Chrome profile" : ""}.`}
				confirmLabel="Remove"
				danger
				onConfirm={() => removing && remove.mutate(removing.id)}
			/>
		</div>
	);
}

/** A bot's own seat on one of your machines: its screen, takeover and passwords there. */
function SeatCard({ seat }: { seat: MachineSeat }) {
	const { machine: m, member } = seat;
	const [removing, setRemoving] = useState(false);
	const remove = useMutation({ mutationFn: () => api.machines.members.remove(m.id, member.id), onError: fail });
	const retry = useMutation({ mutationFn: () => api.machines.members.retry(m.id, member.id), onError: fail });
	const computer = m.kind === "computer";
	const running = m.status === "running";
	const ready = running && member.status === "ready";
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border p-3">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate text-body font-medium">{m.name}</span>
						{running ? <MemberBadge member={member} /> : <Badge>Off</Badge>}
					</span>
					<span className="block truncate text-small text-fg-subtle">
						{m.name.includes(seat.ownerBot)
							? ""
							: `${seat.ownerBot}'s ${computer ? "computer" : "devbox"} · `}
						Its own account {member.username}
						{member.display !== null ? ` · screen :${member.display}` : ""}
					</span>
				</span>
			</div>
			{(member.status === "adding" || member.status === "removing") && (
				<div className="flex items-center gap-3 rounded-lg bg-surface-2/60 px-3.5 py-3 text-body">
					<Spinner />
					<span className="min-w-0 flex-1 text-small text-fg-subtle">{member.statusDetail ?? "…"}</span>
				</div>
			)}
			{member.status === "error" && (
				<div className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/[0.06] px-3.5 py-3 text-body">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-ink" />
					<span className="min-w-0 flex-1">
						Couldn’t set up this account. Turn on the computer and try again.
					</span>
				</div>
			)}
			{!member.available && (
				<p className="text-small text-fg-subtle">
					Its owner stopped sharing it with you, so it can't use {m.name} until they share it again.
				</p>
			)}
			{ready && <Access machine={m} seat={member} />}
			<div className="flex flex-wrap gap-1.5">
				{member.status === "error" && running && (
					<Button variant="secondary" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
						<RotateCw /> Try again
					</Button>
				)}
				<Button
					variant="danger-ghost"
					size="sm"
					onClick={() => setRemoving(true)}
					disabled={member.status === "removing" || remove.isPending}
				>
					<Trash2 /> Remove from {m.name}
				</Button>
			</div>
			<p className="text-small text-fg-subtle">
				Turning it on and off, its size and checkpoints are in {seat.ownerBot}'s Computer section.
			</p>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${member.agentName} from ${m.name}?`}
				description={`Its account there goes, with its home folder${computer ? ", screen and Chrome profile" : ""}.`}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}

/** Your computers and devboxes this bot has a seat on. */
export function Seats({ agent }: { agent: Agent }) {
	const { data: seats, isError, refetch } = useSeats(agent.id);
	if (isError) return <LoadProblem what="shared computers" retry={refetch} />;
	if (!seats) return <SkeletonRows />;
	if (!seats.length)
		return (
			<EmptyState
				size="sm"
				icon={<Users />}
				title="No shared computers"
				description={`Choose Share with bots on another computer to give ${agent.name} an account.`}
			/>
		);
	return (
		<Section
			title="Shared with it"
			description={`Other bots' computers and devboxes ${agent.name} works on, in its own account.`}
		>
			{seats.map((s) => (
				<SeatCard key={s.member.id} seat={s} />
			))}
		</Section>
	);
}

function browserLine(b: SharedBrowser): string {
	const where = b.machineName ? `On ${b.machineName}` : "On the server";
	const signIns = b.signIns === "shared" ? "shared sign-ins" : "separate sign-ins";
	return `${where} · ${signIns}`;
}

/** Making or changing a shared browser: name, where it runs, sign-ins, bots and the viewers switch. */
function BrowserDialog({
	open,
	onOpenChange,
	browser,
	agent,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	browser: SharedBrowser | null;
	agent: Agent;
}) {
	const { data: agents = [] } = useAgents();
	const { data: machines = [] } = useMachines();
	const [name, setName] = useState(browser?.name ?? "");
	const [where, setWhere] = useState(browser?.machineId ?? "server");
	const [signIns, setSignIns] = useState<SignInMode>(browser?.signIns ?? "shared");
	const [bots, setBots] = useState<string[]>(browser?.members.map((m) => m.agentId) ?? [agent.id]);
	const [viewers, setViewers] = useState(browser?.shareWithViewers ?? false);
	const computers = machines.filter((m) => m.kind === "computer" && m.provider !== "local");
	const save = useMutation({
		mutationFn: () => {
			const body = {
				name: name.trim(),
				machineId: where === "server" ? null : where,
				signIns,
				shareWithViewers: viewers,
				agentIds: bots,
			};
			return browser ? api.sharedBrowsers.update(browser.id, body) : api.sharedBrowsers.create(body);
		},
		onSuccess: () => onOpenChange(false),
		onError: fail,
	});
	const choices = agents.filter((a) => !a.hidden || bots.includes(a.id));
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={browser ? `Change ${browser.name}` : "New shared browser"}
			description="One browser several bots use, each in its own tabs."
		>
			<FormGroup
				dirty={
					name !== (browser?.name ?? "") ||
					where !== (browser?.machineId ?? "server") ||
					signIns !== (browser?.signIns ?? "shared") ||
					viewers !== (browser?.shareWithViewers ?? false) ||
					JSON.stringify(bots) !== JSON.stringify(browser?.members.map((m) => m.agentId) ?? [agent.id])
				}
				onCancel={() => onOpenChange(false)}
				disabled={!name.trim() || !bots.length}
				submitLabel={browser ? "Save" : "Create browser"}
				onSubmit={async () => {
					try {
						await save.mutateAsync();
					} catch {
						throw new Error("Couldn’t save this browser. Check the name and try again.");
					}
				}}
			>
				<Field label="Name" hint="Bots pick it by this name.">
					<Input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Team browser"
						maxLength={60}
					/>
				</Field>
				<Field
					label="Where it runs"
					hint={
						where === "server"
							? "A browser on your Sekai server."
							: "Chrome on that computer's own screen: you can watch it there."
					}
				>
					<Select
						value={where}
						onValueChange={setWhere}
						options={[
							{ value: "server", label: "On the Sekai server" },
							...computers.map((m) => ({ value: m.id, label: m.name })),
						]}
					/>
				</Field>
				<Field
					label="Sign-ins"
					hint={
						signIns === "shared"
							? "One profile for all: a site one bot signs in to is signed in for the others."
							: "Each bot gets its own profile in it, with its own sign-ins."
					}
				>
					<Segmented
						value={signIns}
						onValueChange={setSignIns}
						size="sm"
						className="self-start"
						options={[
							{ value: "shared", label: "Shared" },
							{ value: "separate", label: "Separate" },
						]}
					/>
				</Field>
				<Field label="Bots">
					<div className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border px-3 py-1.5 scrollbar-thin">
						{choices.map((a) => (
							<Checkbox
								key={a.id}
								checked={bots.includes(a.id)}
								onCheckedChange={(on) =>
									setBots((list) => (on ? [...list, a.id] : list.filter((x) => x !== a.id)))
								}
								label={a.name}
								description={a.sharedBy ? `Shared with you by ${a.sharedBy}` : undefined}
							/>
						))}
					</div>
				</Field>
				<ToggleRow
					title="Also for people these bots are shared with"
					description={VIEWERS_HINT}
					checked={viewers}
					onCheckedChange={setViewers}
				/>
			</FormGroup>
		</Dialog>
	);
}

/** Shared browsers this bot is in, and making new ones. */
export function SharedBrowsers({ agent }: { agent: Agent }) {
	const { data: browsers, isError, refetch } = useSharedBrowsers(agent.id);
	const { can } = useAccess();
	const [editing, setEditing] = useState<SharedBrowser | "new" | null>(null);
	const [deleting, setDeleting] = useState<SharedBrowser | null>(null);
	const remove = useMutation({ mutationFn: (id: string) => api.sharedBrowsers.delete(id), onError: fail });
	if (isError) return <LoadProblem what="shared browsers" retry={refetch} />;
	if (!browsers) return <SkeletonRows />;
	return (
		<Section
			title="Available browsers"
			action={
				can("browser") && (
					<Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
						<Plus /> New browser
					</Button>
				)
			}
		>
			{browsers.length === 0 && (
				<p className="text-small text-fg-subtle">
					{can("browser") ? "No shared browsers yet." : "Your role doesn’t allow creating shared browsers."}
				</p>
			)}
			{browsers.length > 0 && (
				<List>
					{browsers.map((b) => (
						<Row
							key={b.id}
							icon={<Globe />}
							title={b.name}
							onClick={() => setEditing(b)}
							subtitle={browserLine(b)}
							menuLabel={`Options for ${b.name}`}
							menu={[
								{ label: "Edit browser", icon: <Pencil />, onSelect: () => setEditing(b) },
								{ label: "Delete browser", danger: true, onSelect: () => setDeleting(b) },
							]}
						>
							<p className="text-small text-fg-subtle">
								{b.members
									.map((m) => `${m.agentName}${m.available ? "" : " (no longer shared)"}`)
									.join(", ")}
								{b.shareWithViewers && " · shared chats too"}
							</p>
						</Row>
					))}
				</List>
			)}
			{editing && (
				<BrowserDialog
					key={editing === "new" ? "new" : editing.id}
					open
					onOpenChange={(o) => !o && setEditing(null)}
					browser={editing === "new" ? null : editing}
					agent={agent}
				/>
			)}
			<Confirm
				open={deleting !== null}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Delete ${deleting?.name ?? "this browser"}?`}
				description="Its bots stop using it, and the sign-ins in it are deleted."
				confirmLabel="Delete"
				danger
				onConfirm={() => deleting && remove.mutate(deleting.id)}
			/>
		</Section>
	);
}
