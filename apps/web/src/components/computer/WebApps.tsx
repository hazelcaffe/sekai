import { api, qk, queryClient, useMachinePorts } from "@sekai/client";
import type { Machine, MachinePort } from "@sekai/shared";
import { Badge, Button, IconButton, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, Lock, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** A link to open (in a new tab) or copy. */
function LinkRow({ url, icon }: { url: string; icon: React.ReactNode }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-center gap-2 text-[13px]">
			<span className="shrink-0 text-fg-subtle [&_svg]:size-3.5">{icon}</span>
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="min-w-0 flex-1 truncate font-mono text-[12px] text-info underline-offset-2 hover:underline"
			>
				{url}
			</a>
			<IconButton
				label={done ? "Copied" : "Copy link"}
				size="icon-sm"
				onClick={async () => {
					await navigator.clipboard.writeText(url);
					setDone(true);
					setTimeout(() => setDone(false), 1200);
				}}
			>
				{done ? <Check /> : <Copy />}
			</IconButton>
			<IconButton label="Open" size="icon-sm" asChild>
				<a href={url} target="_blank" rel="noreferrer">
					<ExternalLink />
				</a>
			</IconButton>
		</div>
	);
}

function PortRow({
	machine,
	p,
	onShare,
	busy,
}: {
	machine: Machine;
	p: MachinePort;
	onShare: (https: boolean) => void;
	busy: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="flex items-center gap-2">
				<span className="font-mono text-[13px] font-medium">:{p.port}</span>
				{p.process && <span className="truncate text-xs text-fg-subtle">{p.process}</span>}
				{!p.running && <Badge>Not running</Badge>}
				<span className="flex-1" />
				<Button variant="ghost" size="xs" disabled={busy} onClick={() => onShare(!p.httpsUrl)}>
					{busy ? <Spinner /> : p.httpsUrl ? <X /> : <Lock />}
					{p.httpsUrl ? "Stop HTTPS link" : "HTTPS link"}
				</Button>
			</div>
			{p.ipUrl && <LinkRow url={p.ipUrl} icon={<Globe />} />}
			{p.httpsUrl && <LinkRow url={p.httpsUrl} icon={<Lock />} />}
			{p.running && !p.ipUrl && !p.httpsUrl && (
				<p className="text-xs leading-5 text-fg-subtle">
					It only listens inside {machine.name} (on 127.0.0.1). Make an HTTPS link, or start it on 0.0.0.0.
				</p>
			)}
		</div>
	);
}

/**
 * Web apps running on a bot's computer or devbox, with their links on your tailnet (at its Tailscale IP and the
 * app's port, or over HTTPS at its tailnet name). Checked every few seconds while it's open.
 */
export function WebApps({ machine }: { machine: Machine }) {
	const [open, setOpen] = useState(false);
	const { data, isLoading, error } = useMachinePorts(machine.id, open);
	const share = useMutation({
		mutationFn: (p: { port: number; https: boolean }) => api.machines.sharePort(machine.id, p),
		onSuccess: (view) => queryClient.setQueryData(qk.machinePorts(machine.id), view),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});

	if (!open) {
		return (
			<Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
				<Globe /> Web apps
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-1 rounded-2xl bg-surface-2/60 p-3">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1">
					<span className="block text-[13px] font-medium">Web apps</span>
					<span className="block text-xs leading-5 text-fg-subtle">
						What's running on {machine.name}, with links that work on your tailnet, not the internet.
					</span>
				</span>
				<IconButton size="icon-sm" label="Close" onClick={() => setOpen(false)}>
					<X />
				</IconButton>
			</div>
			{isLoading ? (
				<div className="flex justify-center py-2">
					<Spinner />
				</div>
			) : error ? (
				<p className="text-xs text-danger">{error instanceof Error ? error.message : String(error)}</p>
			) : data ? (
				<>
					{!data.tailscale && (
						<p className="text-xs leading-5 text-warning">
							{machine.name} isn't on your tailnet, so its links use its home network address and there's
							no HTTPS link. Add a Tailscale auth key in Admin → Tailscale for new machines.
						</p>
					)}
					{data.ports.length === 0 ? (
						<p className="py-1 text-xs leading-5 text-fg-subtle">
							Nothing's running yet. Dev servers show up here once they start (on 0.0.0.0, e.g.{" "}
							<code className="font-mono">vite --host 0.0.0.0</code>).
						</p>
					) : (
						<div className="flex flex-col divide-y divide-border">
							{data.ports.map((p) => (
								<PortRow
									key={p.port}
									machine={machine}
									p={p}
									busy={share.isPending && share.variables?.port === p.port}
									onShare={(https) => share.mutate({ port: p.port, https })}
								/>
							))}
						</div>
					)}
				</>
			) : null}
		</div>
	);
}
