import { useAccess, useMachines, useSeats, useSharedBrowsers } from "@sekai/client";
import type { Agent, Machine } from "@sekai/shared";
import { Button, EmptyState, IconButton, Link, Row, Section, Select, Skeleton } from "@sekai/ui";
import { Maximize2, Monitor, Settings2, X } from "lucide-react";
import { useState } from "react";
import { LoadProblem } from "./LoadProblem.tsx";
import { ScreenPreview, StatusBadge } from "./MachineParts.tsx";
import { Seats, SharedBrowsers } from "./Sharing.tsx";
import { availableScreens } from "./screens.ts";
import { VncView } from "./VncView.tsx";

function LiveScreen({ machine, bot }: { machine: Machine; bot?: string }) {
	const [takeover, setTakeover] = useState(false);
	return (
		<>
			<Row title={machine.name} badge={<StatusBadge m={machine} />} />
			{machine.status === "running" ? (
				<>
					{!takeover && <ScreenPreview machine={machine} agentId={bot} />}
					<Button variant="primary" onClick={() => setTakeover(true)}>
						<Maximize2 /> Take over
					</Button>
					{takeover && <VncView machine={machine} agentId={bot} open onOpenChange={setTakeover} />}
				</>
			) : (
				<EmptyState
					size="sm"
					icon={<Monitor />}
					title={machine.status === "stopped" ? "The computer is off" : "The screen isn’t ready"}
					description="Its screen appears here when the computer is running."
				/>
			)}
		</>
	);
}

/** One screen to watch (a choice when there are several), with Take over. */
function Screens({ screens }: { screens: ReturnType<typeof availableScreens> }) {
	const [selected, setSelected] = useState("");
	const current = screens.find((s) => s.machine.id === selected) ?? screens[0];
	if (!current) return null;
	return (
		<>
			{screens.length > 1 && (
				<Select
					label="Screen to watch"
					value={current.machine.id}
					options={screens.map((s) => ({ value: s.machine.id, label: s.machine.name }))}
					onValueChange={setSelected}
				/>
			)}
			<LiveScreen
				key={`${current.machine.id}/${current.bot ?? ""}`}
				machine={current.machine}
				bot={current.bot}
			/>
		</>
	);
}

function OwnedScreens({ agent }: { agent: Agent }) {
	const machines = useMachines(agent.id);
	const seats = useSeats(agent.id);
	if (machines.isError || seats.isError)
		return (
			<LoadProblem
				what="screens"
				retry={() => {
					void machines.refetch();
					void seats.refetch();
				}}
			/>
		);
	if (!machines.data || !seats.data) return <Skeleton className="aspect-video w-full rounded-lg" />;
	const screens = availableScreens(agent, machines.data, seats.data);
	const settings = (
		<Button variant="ghost" asChild>
			<Link href={`/bots/${agent.id}/computer`}>
				<Settings2 /> Computer settings
			</Link>
		</Button>
	);
	if (!screens.length)
		return (
			<EmptyState
				size="sm"
				icon={<Monitor />}
				title="No screen yet"
				description={`Give ${agent.name} a computer to watch it work here.`}
				action={settings}
			/>
		);
	return (
		<Section>
			<Screens screens={screens} />
			{settings}
		</Section>
	);
}

/**
 * A bot someone shared with you: what you lend it (your computers it has an account on, your browsers it may use)
 * and, when one of those computers is running, its screen there. Its owner's own computer never shows.
 */
function YourSharedAccess({ agent }: { agent: Agent }) {
	const { can } = useAccess();
	const seats = useSeats(agent.id);
	const browsers = useSharedBrowsers(agent.id);
	if (seats.isError) return <LoadProblem what="shared computers" retry={() => void seats.refetch()} />;
	if (!seats.data) return <Skeleton className="aspect-video w-full rounded-lg" />;
	const screens = availableScreens(agent, [], seats.data);
	const lendsComputers = can("computers") || seats.data.length > 0;
	const lendsBrowsers = can("browser") || Boolean(browsers.data?.length);
	return (
		<div className="flex flex-col gap-6">
			<p className="text-small text-fg-muted">
				Only what you share with {agent.name} is here. {agent.name}’s own computer stays private to{" "}
				{agent.sharedBy}.
			</p>
			{screens.length > 0 && (
				<Section title="Live screen">
					<Screens screens={screens} />
				</Section>
			)}
			{lendsComputers && <Seats agent={agent} />}
			{lendsBrowsers && <SharedBrowsers agent={agent} />}
			{!lendsComputers && !lendsBrowsers && (
				<EmptyState
					size="sm"
					icon={<Monitor />}
					title="Nothing shared"
					description="Your role doesn’t include lending computers or browsers to bots."
				/>
			)}
		</div>
	);
}

/** The panel beside the chat only watches the screen; taking over opens a separate full-screen session. */
export function ComputerPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
	return (
		<div className="flex h-full min-h-0 flex-col pt-safe">
			<header className="flex items-center justify-between gap-2 px-4 py-3">
				<h2 className="text-heading font-semibold">{agent.sharedBy ? "Your shared access" : "Live screen"}</h2>
				<IconButton label={agent.sharedBy ? "Close" : "Close live screen"} onClick={onClose}>
					<X />
				</IconButton>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-safe-6">
				{agent.sharedBy ? (
					<YourSharedAccess key={agent.id} agent={agent} />
				) : (
					<OwnedScreens key={agent.id} agent={agent} />
				)}
			</div>
		</div>
	);
}
