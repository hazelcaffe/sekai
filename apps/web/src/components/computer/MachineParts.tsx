import { api } from "@sekai/client";
import type { Machine, MachineAccess, MachineMember } from "@sekai/shared";
import { Badge, Button, IconButton } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Download, Eye, Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Pieces of a machine's card, shared by a bot's own machine and its seat on another bot's. */

export function StatusBadge({ m }: { m: Machine }) {
	const tone =
		m.status === "running"
			? "success"
			: m.status === "error"
				? "danger"
				: m.status === "stopped"
					? "neutral"
					: "info";
	const label = {
		creating: "Setting up",
		provisioning: "Setting up",
		running: "Running",
		stopped: "Off",
		error: "Problem",
		deleting: "Deleting",
	}[m.status];
	return <Badge tone={tone}>{label}</Badge>;
}

export function MemberBadge({ member }: { member: MachineMember }) {
	if (!member.available) return <Badge tone="warning">No longer shared</Badge>;
	const tone =
		member.status === "ready"
			? "success"
			: member.status === "error"
				? "danger"
				: member.status === "removing"
					? "neutral"
					: "info";
	const label = { adding: "Setting up", ready: "Ready", error: "Problem", removing: "Removing" }[member.status];
	return <Badge tone={tone}>{label}</Badge>;
}

export function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-center gap-2 py-1 text-[13px]">
			<span className="w-20 shrink-0 truncate text-fg-subtle">{label}</span>
			<code className="min-w-0 flex-1 truncate font-mono text-[12px]">{secret ? "••••••••••" : value}</code>
			<IconButton
				label={done ? "Copied" : "Copy"}
				size="icon-sm"
				onClick={async () => {
					await navigator.clipboard.writeText(value);
					setDone(true);
					setTimeout(() => setDone(false), 1200);
				}}
			>
				{done ? <Check /> : <Copy />}
			</IconButton>
		</div>
	);
}

/**
 * The live screen: a fresh screenshot every couple of seconds while the panel is open. agentId: a bot with a
 * seat on the computer (its own screen there).
 */
export function ScreenPreview({
	machine,
	agentId,
	onTakeover,
}: {
	machine: Machine;
	agentId?: string;
	onTakeover: () => void;
}) {
	const [src, setSrc] = useState(() => api.machines.screenUrl(machine.id, agentId));
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setSrc(api.machines.screenUrl(machine.id, agentId));
		const t = setInterval(() => {
			if (document.visibilityState === "visible") setSrc(api.machines.screenUrl(machine.id, agentId));
		}, 2500);
		return () => clearInterval(t);
	}, [machine.id, agentId]);
	return (
		<button
			type="button"
			onClick={onTakeover}
			className="group relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-black"
			aria-label="Take over"
		>
			{!failed && (
				<img
					src={src}
					alt={`${machine.name}'s screen`}
					className="size-full object-contain"
					onError={() => setFailed(true)}
					onLoad={() => setFailed(false)}
				/>
			)}
			{failed && (
				<span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
					The screen isn't available right now
				</span>
			)}
			<span className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100">
				<Maximize2 className="size-3.5" /> Take over
			</span>
		</button>
	);
}

/** How to get in: addresses, and (after "Confirm it's you") passwords and the key. seat: a member bot's own account. */
export function Access({ machine, seat }: { machine: Machine; seat?: MachineMember }) {
	const [access, setAccess] = useState<MachineAccess | null>(null);
	const reveal = useMutation({
		mutationFn: () => api.machines.access(machine.id, seat?.agentId),
		onSuccess: setAccess,
	});
	const host = machine.addresses.tailscale ?? machine.addresses.lan;
	const username = seat?.username ?? machine.username;
	const vnc = seat ? seat.vncPort : machine.ports.vnc;
	const download = () => {
		if (!access) return;
		const blob = new Blob([access.privateKey], { type: "text/plain" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${machine.hostname}-${username}-key`;
		a.click();
		// Some browsers cancel a download whose URL is revoked right away.
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	};
	return (
		<div className="flex flex-col">
			{host && (
				<CopyRow
					label="SSH"
					value={`ssh ${username}@${host}${machine.ports.ssh !== 22 ? ` -p ${machine.ports.ssh}` : ""}`}
				/>
			)}
			{host && vnc && <CopyRow label="VNC" value={`${host}:${vnc}`} />}
			{host && machine.ports.rdp && <CopyRow label="RDP" value={`${host}:${machine.ports.rdp}`} />}
			{machine.addresses.tailscale && machine.addresses.lan && (
				<CopyRow label="LAN" value={machine.addresses.lan} />
			)}
			{access ? (
				<>
					{access.userPassword && <CopyRow label={access.username} value={access.userPassword} />}
					{access.rootPassword && <CopyRow label="root" value={access.rootPassword} />}
					{access.vncPassword && <CopyRow label="VNC pass" value={access.vncPassword} />}
					<div className="mt-1 flex gap-2">
						<Button variant="ghost" size="sm" onClick={download}>
							<Download /> SSH key
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setAccess(null)}>
							<X /> Hide
						</Button>
					</div>
				</>
			) : (
				<Button
					variant="ghost"
					size="sm"
					className="mt-1 self-start"
					onClick={() => reveal.mutate()}
					disabled={reveal.isPending}
				>
					<Eye /> Passwords and key
				</Button>
			)}
		</div>
	);
}
