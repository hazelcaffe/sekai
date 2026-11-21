import { api, dateTime, useMachineMembers } from "@sekai/client";
import type { Machine } from "@sekai/shared";
import { Button, Callout, Confirm, CopyField, Dialog, FormGroup, List, Row, Section, useFormValues } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Globe, History, KeyRound, Monitor, Power, Scaling, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Checkpoints } from "./Checkpoints.tsx";
import { Access, StatusBadge } from "./MachineParts.tsx";
import { ShareMachine } from "./Sharing.tsx";
import { SpecsFields, specsLine, validSpecs } from "./Specs.tsx";
import { WebApps } from "./WebApps.tsx";

function Resize({ machine, close }: { machine: Machine; close: () => void }) {
	const f = useFormValues(machine.specs);
	const [confirm, setConfirm] = useState(false);
	const save = async () => {
		await api.machines.update(machine.id, { specs: f.values });
		close();
	};
	const restart =
		machine.status === "running" &&
		machine.backend === "vm" &&
		(machine.specs.cores !== f.values.cores || machine.specs.memoryMb !== f.values.memoryMb);
	return (
		<>
			<FormGroup
				dirty={f.dirty}
				disabled={!validSpecs(f.values, machine.specs.diskGb)}
				onCancel={close}
				onSubmit={async () => {
					if (restart) setConfirm(true);
					else await save();
				}}
			>
				<SpecsFields
					value={f.values}
					minDisk={machine.specs.diskGb}
					variableMemory={machine.kind === "computer" && machine.backend === "vm"}
					change={f.setValues}
				/>
				<p className="text-small text-fg-muted">Disks can grow but can’t shrink.</p>
			</FormGroup>
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title="Resize and restart?"
				description={`Work on ${machine.name} will pause while it restarts with its new size.`}
				confirmLabel="Resize and restart"
				onConfirm={() =>
					void save().catch(() =>
						toast.error("Couldn’t resize the computer. Check the server and try again."),
					)
				}
			/>
		</>
	);
}

const parts = {
	size: "Computer size",
	access: "Passwords and keys",
	apps: "Web apps",
	checkpoints: "Checkpoints",
	sharing: "Share with bots",
} as const;

/** Computer settings stay here; no screens, screenshots or remote sessions are mounted on this page. */
export function MachineSettings({ machine: m }: { machine: Machine }) {
	const [part, setPart] = useState<keyof typeof parts | null>(null);
	const [confirm, setConfirm] = useState<"restart" | "stop" | "delete" | null>(null);
	const members = useMachineMembers(m.id, m.provider !== "local");
	const op = useMutation({
		mutationFn: (action: "restart" | "stop" | "start" | "delete" | "retry") =>
			Promise.resolve(api.machines[action](m.id) as Promise<unknown>),
		onError: () => toast.error("Couldn’t change the computer. Check the connection and try again."),
	});
	const ready = m.status === "running" || m.status === "stopped";
	const managed = m.provider === "proxmox";
	const busy = ["creating", "provisioning", "deleting"].includes(m.status);
	const publicKey = m.statusDetail?.match(/ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+/)?.[0];
	return (
		<Section
			title={m.name}
			action={<StatusBadge m={m} />}
			description={m.expiresAt ? `Automatically deleted ${dateTime(m.expiresAt)}.` : undefined}
		>
			{m.status === "error" && (
				<Callout
					tone="warning"
					title="Computer needs attention"
					action={
						m.provider === "ssh" && (
							<Button
								size="sm"
								variant="secondary"
								loading={op.isPending}
								onClick={() => op.mutate("retry")}
							>
								Try again
							</Button>
						)
					}
				>
					{publicKey ? (
						<>
							Add the bot’s public key to the account on this computer.
							<CopyField multiline label="public key" value={publicKey} />
						</>
					) : managed ? (
						"Check the computer on its server before trying again."
					) : (
						"Check the address and account on this computer, then try again."
					)}
				</Callout>
			)}
			{busy && (
				<p role="status" className="text-small text-fg-muted">
					{m.status === "deleting"
						? "Removing the computer and its files…"
						: (m.statusDetail ?? "Getting the computer ready…")}
				</p>
			)}
			<List>
				<Row
					icon={<Scaling />}
					title="Size"
					subtitle={specsLine(m.specs)}
					onClick={managed && !busy ? () => setPart("size") : undefined}
					chevron={managed && !busy}
				/>
				{ready && (
					<Row icon={<KeyRound />} title="Passwords and keys" onClick={() => setPart("access")} chevron />
				)}
				{m.status === "running" && (
					<Row icon={<Globe />} title="Web apps" onClick={() => setPart("apps")} chevron />
				)}
				{managed && ready && (
					<Row icon={<History />} title="Checkpoints" onClick={() => setPart("checkpoints")} chevron />
				)}
				{ready && <Row icon={<Users />} title="Share with bots" onClick={() => setPart("sharing")} chevron />}
			</List>
			<div className="flex flex-wrap items-center gap-1">
				{managed && ready && (
					<Button
						size="sm"
						variant="secondary"
						disabled={op.isPending}
						onClick={() => (m.status === "running" ? setConfirm("stop") : op.mutate("start"))}
					>
						<Power />
						{m.status === "running" ? "Turn off" : "Turn on"}
					</Button>
				)}
				{managed && m.status === "running" && (
					<Button size="sm" variant="ghost" disabled={op.isPending} onClick={() => setConfirm("restart")}>
						Restart
					</Button>
				)}
				{m.status !== "deleting" && (
					<Button
						size="sm"
						variant="danger-ghost"
						className="ml-auto"
						disabled={op.isPending}
						onClick={() => setConfirm("delete")}
					>
						{managed ? "Delete" : "Remove"}
					</Button>
				)}
			</div>
			{part && (
				<Dialog
					open
					onOpenChange={(o) => !o && setPart(null)}
					title={parts[part]}
					description={m.name}
					icon={<Monitor />}
				>
					{part === "size" ? (
						<Resize machine={m} close={() => setPart(null)} />
					) : part === "access" ? (
						<Access machine={m} />
					) : part === "apps" ? (
						<WebApps machine={m} />
					) : part === "checkpoints" ? (
						<Checkpoints machine={m} />
					) : (
						<ShareMachine machine={m} />
					)}
				</Dialog>
			)}
			<Confirm
				open={Boolean(confirm)}
				onOpenChange={(o) => !o && setConfirm(null)}
				title={`${confirm === "delete" ? (managed ? "Delete" : "Remove") : confirm === "stop" ? "Turn off" : "Restart"} ${m.name}?`}
				description={
					confirm === "delete"
						? `${managed ? "The computer and all its files will be deleted. Chats and memories stay." : "Sekai disconnects this computer. Its files stay, except for accounts created for other bots."} ${members.data?.length ? `${members.data.length} other bots will lose access.` : "Any bots sharing it will lose access."}`
						: `Work on this computer will stop${confirm === "restart" ? " while it restarts" : " until you turn it back on"}, including work by other bots.`
				}
				confirmLabel={
					confirm === "delete" ? (managed ? "Delete" : "Remove") : confirm === "stop" ? "Turn off" : "Restart"
				}
				danger={confirm === "delete"}
				onConfirm={() => confirm && op.mutate(confirm)}
			/>
		</Section>
	);
}
