import { api } from "@sekai/client";
import type { Machine, MachineAccess, MachineMember } from "@sekai/shared";
import { Badge, Button, CopyField, Skeleton } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Download, Eye, MonitorOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

/**
 * The live screen: a fresh screenshot every couple of seconds while the panel is open. agentId: a bot with a
 * seat on the computer (its own screen there).
 */
export function ScreenPreview({ machine, agentId }: { machine: Machine; agentId?: string }) {
	const [src, setSrc] = useState(() => api.machines.screenUrl(machine.id, agentId));
	const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
	useEffect(() => {
		if (state !== "ready") return;
		const t = setInterval(() => {
			if (document.visibilityState === "visible") setSrc(api.machines.screenUrl(machine.id, agentId));
		}, 2500);
		return () => clearInterval(t);
	}, [machine.id, agentId, state]);
	return (
		<div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
			{state !== "failed" && (
				<img
					src={src}
					alt={`${machine.name}'s screen`}
					className="size-full bg-screen object-contain"
					onError={() => setState("failed")}
					onLoad={() => setState("ready")}
				/>
			)}
			{state === "loading" && <Skeleton className="absolute inset-0" />}
			{state === "failed" && (
				<div className="flex flex-col items-center gap-2 text-small text-fg-muted">
					<MonitorOff className="size-6" />
					Couldn’t reach the screen.
					<Button
						size="sm"
						variant="secondary"
						onClick={() => {
							setSrc(api.machines.screenUrl(machine.id, agentId));
							setState("loading");
						}}
					>
						Try again
					</Button>
				</div>
			)}
		</div>
	);
}

/** How to get in: addresses, and (after "Confirm it's you") passwords and the key. seat: a member bot's own account. */
export function Access({ machine, seat }: { machine: Machine; seat?: MachineMember }) {
	const [access, setAccess] = useState<MachineAccess | null>(null);
	const reveal = useMutation({
		mutationFn: () => api.machines.access(machine.id, seat?.agentId),
		onSuccess: setAccess,
		onError: () => toast.error("Couldn’t show the sign-in details. Confirm it’s you and try again."),
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
		<div className="flex flex-col gap-1.5">
			{host && (
				<CopyField
					showLabel
					label="SSH"
					value={`ssh ${username}@${host}${machine.ports.ssh !== 22 ? ` -p ${machine.ports.ssh}` : ""}`}
				/>
			)}
			{host && vnc && <CopyField showLabel label="VNC" value={`${host}:${vnc}`} />}
			{host && machine.ports.rdp && <CopyField showLabel label="RDP" value={`${host}:${machine.ports.rdp}`} />}
			{machine.addresses.tailscale && machine.addresses.lan && (
				<CopyField showLabel label="LAN" value={machine.addresses.lan} />
			)}
			{access ? (
				<>
					{access.userPassword && <CopyField showLabel label={access.username} value={access.userPassword} />}
					{access.rootPassword && <CopyField showLabel label="root" value={access.rootPassword} />}
					{access.vncPassword && <CopyField showLabel label="VNC pass" value={access.vncPassword} />}
					<div className="mt-1 flex gap-2">
						<Button variant="ghost" size="sm" onClick={download}>
							<Download /> Download SSH key
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
					<Eye /> Show passwords and key
				</Button>
			)}
		</div>
	);
}
