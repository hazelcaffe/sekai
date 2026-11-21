import { api, qk, queryClient, useAccess, useMachinePorts } from "@sekai/client";
import type { Machine, MachinePort } from "@sekai/shared";
import { Badge, Button, Confirm, IconButton, Link, SkeletonRows, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, Lock, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadProblem } from "./LoadProblem.tsx";

/** A link to open (in a new tab) or copy. */
function LinkRow({ url, icon }: { url: string; icon: React.ReactNode }) {
	const [done, setDone] = useState(false);
	return (
		<div className="flex items-center gap-2 text-body">
			<span className="shrink-0 text-fg-subtle [&_svg]:size-4">{icon}</span>
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="min-w-0 flex-1 truncate font-mono text-small text-info-ink underline-offset-2 hover:underline"
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
	canShare,
}: {
	machine: Machine;
	p: MachinePort;
	onShare: (https: boolean) => void;
	busy: boolean;
	canShare: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="flex items-center gap-2">
				<span className="font-mono text-body font-medium">:{p.port}</span>
				{p.process && <span className="truncate text-small text-fg-subtle">{p.process}</span>}
				{!p.running && <Badge>Not running</Badge>}
				<span className="flex-1" />
				<Button variant="ghost" size="sm" disabled={busy || !canShare} onClick={() => onShare(!p.httpsUrl)}>
					{busy ? <Spinner /> : p.httpsUrl ? <X /> : <Lock />}
					{p.httpsUrl ? "Stop HTTPS link" : "HTTPS link"}
				</Button>
			</div>
			{p.ipUrl && <LinkRow url={p.ipUrl} icon={<Globe />} />}
			{p.httpsUrl && <LinkRow url={p.httpsUrl} icon={<Lock />} />}
			{p.running && !p.ipUrl && !p.httpsUrl && (
				<p className="text-small text-fg-subtle">
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
	const { admin } = useAccess();
	const [stop, setStop] = useState<number | null>(null);
	const { data, isLoading, error, refetch } = useMachinePorts(machine.id, true);
	const share = useMutation({
		mutationFn: (p: { port: number; https: boolean }) => api.machines.sharePort(machine.id, p),
		onSuccess: (view) => queryClient.setQueryData(qk.machinePorts(machine.id), view),
		onError: () => toast.error("Couldn’t change the link. Check the computer’s network and try again."),
	});

	return (
		<div className="flex flex-col gap-3">
			{isLoading ? (
				<SkeletonRows count={2} />
			) : error ? (
				<LoadProblem what="web apps" retry={refetch} />
			) : data ? (
				<>
					{!data.tailscale && (
						<p className="text-small text-warning-ink">
							Only local links are available.{" "}
							{admin ? (
								<Link className="text-brand-ink underline" href="/settings/network/connection">
									Set up private links for new computers
								</Link>
							) : (
								"Ask an admin to set up private links for new computers."
							)}
						</p>
					)}
					{data.ports.length === 0 ? (
						<p className="py-1 text-small text-fg-subtle">
							Start a web app on this computer to see its link here.
						</p>
					) : (
						<div className="flex flex-col divide-y divide-border">
							{data.ports.map((p) => (
								<PortRow
									key={p.port}
									machine={machine}
									p={p}
									busy={share.isPending && share.variables?.port === p.port}
									canShare={Boolean(data.tailscale)}
									onShare={(https) =>
										https ? share.mutate({ port: p.port, https }) : setStop(p.port)
									}
								/>
							))}
						</div>
					)}
				</>
			) : null}
			<Confirm
				open={stop !== null}
				onOpenChange={(o) => !o && setStop(null)}
				title="Stop sharing this link?"
				description="The secure link will stop working. The web app stays on the computer."
				confirmLabel="Stop sharing"
				onConfirm={() => stop !== null && share.mutate({ port: stop, https: false })}
			/>
		</div>
	);
}
