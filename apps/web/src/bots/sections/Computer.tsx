import { api, desktop, timeAgo, useAccess, useMachines, useSavedLogins, useSettings } from "@sekai/client";
import type { Agent, Machine } from "@sekai/shared";
import { Button, Confirm, EmptyState, Fold, Link, List, Page, Row, Section, SkeletonRows } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Box, Globe, KeyRound, Laptop, Plus, Users } from "lucide-react";
import { useState } from "react";
import { LoadProblem } from "../../components/computer/LoadProblem.tsx";
import { MachineSettings } from "../../components/computer/MachineSettings.tsx";
import { hasComputerServer, NewComputer } from "../../components/computer/NewComputer.tsx";
import { Seats, SharedBrowsers } from "../../components/computer/Sharing.tsx";
import { useGoBack } from "../../lib/back.ts";
import type { BotSectionProps } from "../section.ts";

function SavedSignIns({ agent }: { agent: Agent }) {
	const query = useSavedLogins(agent.id);
	const [id, setId] = useState("");
	const forget = useMutation({ mutationFn: api.credentials.forget, onSuccess: () => void query.refetch() });
	if (query.isError) return <LoadProblem what="saved sign-ins" retry={query.refetch} />;
	if (!query.data) return <SkeletonRows />;
	if (!query.data.length)
		return (
			<EmptyState
				icon={<KeyRound />}
				title="No saved sign-ins"
				description={`The sites you remember for ${agent.name} will appear here.`}
			/>
		);
	const selected = query.data.find((s) => s.id === id);
	return (
		<>
			<List>
				{query.data.map((s) => (
					<Row
						key={s.id}
						title={s.site}
						subtitle={[s.username, s.lastUsedAt && `Used ${timeAgo(s.lastUsedAt)}`]
							.filter(Boolean)
							.join(" · ")}
						menuLabel={`Options for ${s.site}`}
						menu={[{ label: "Forget sign-in", danger: true, onSelect: () => setId(s.id) }]}
					/>
				))}
			</List>
			<Confirm
				open={Boolean(id)}
				onOpenChange={(o) => !o && setId("")}
				title={`Forget ${selected?.site ?? "this sign-in"}?`}
				description={`${agent.name} will need you to sign in again next time.`}
				confirmLabel="Forget"
				danger
				onConfirm={() => forget.mutate(id)}
			/>
		</>
	);
}

function Devices({ agent, devices }: { agent: Agent; devices: Machine[] }) {
	const [id, setId] = useState("");
	const remove = useMutation({ mutationFn: api.machines.delete });
	const selected = devices.find((d) => d.id === id);
	return (
		<>
			{devices.length ? (
				<List>
					{devices.map((d) => (
						<Row
							key={d.id}
							icon={<Laptop />}
							title={d.name}
							subtitle={
								d.status === "running"
									? `Online · ${d.username}`
									: "Offline · Open Sekai on this device to reconnect."
							}
							menu={[{ label: "Stop lending", danger: true, onSelect: () => setId(d.id) }]}
						/>
					))}
				</List>
			) : (
				<EmptyState
					title="No devices lent"
					icon={<Laptop />}
					description={`Use Settings → This computer in the desktop app to lend a device to ${agent.name}.`}
				/>
			)}
			{desktop && (
				<Button variant="secondary" asChild>
					<Link href="/settings/this-computer">This computer</Link>
				</Button>
			)}
			<Confirm
				open={Boolean(id)}
				onOpenChange={(o) => !o && setId("")}
				title={`Stop lending ${selected?.name ?? "this device"}?`}
				description={`${agent.name} will lose access until you lend it again from the desktop app.`}
				danger
				confirmLabel="Stop lending"
				onConfirm={() => remove.mutate(id)}
			/>
		</>
	);
}

const sections = {
	browsers: "Shared browsers",
	sharing: "Shared computers",
	devices: "Your devices",
	passwords: "Saved sign-ins",
	devboxes: "Devboxes",
} as const;

export function ComputerSection({ agent, back, rest }: BotSectionProps) {
	const goBack = useGoBack();
	const { can } = useAccess();
	const machines = useMachines(agent.id);
	const settings = useSettings();
	const [adding, setAdding] = useState(false);
	const home = `/bots/${agent.id}/computer`;
	const sub = Object.hasOwn(sections, rest) ? (rest as keyof typeof sections) : null;
	const computer = machines.data?.find((m) => m.kind === "computer");
	const boxes = machines.data?.filter((m) => m.kind === "devbox") ?? [];
	const devices = machines.data?.filter((m) => m.kind === "device") ?? [];
	const setup = settings.data?.machines;
	return (
		<Page
			key={rest}
			title={sub ? sections[sub] : "Computer"}
			back={sub ? { label: "Computer", onClick: () => goBack(home) } : back}
		>
			{machines.isError || settings.isError ? (
				<LoadProblem
					what="computer settings"
					retry={() => {
						void machines.refetch();
						void settings.refetch();
					}}
				/>
			) : !machines.data || !setup ? (
				<SkeletonRows count={5} />
			) : sub === "sharing" ? (
				<Seats agent={agent} />
			) : sub === "browsers" ? (
				<SharedBrowsers agent={agent} />
			) : sub === "passwords" ? (
				<SavedSignIns agent={agent} />
			) : sub === "devices" ? (
				<Devices agent={agent} devices={devices} />
			) : sub === "devboxes" ? (
				<>
					{can("computers") &&
						hasComputerServer(setup) &&
						boxes.length < setup.maxDevboxesPerAgent &&
						(adding ? (
							<NewComputer agent={agent} settings={setup} devbox done={() => setAdding(false)} />
						) : (
							<Button className="self-start" onClick={() => setAdding(true)}>
								<Plus /> New devbox
							</Button>
						))}
					{boxes.map((m) => (
						<MachineSettings key={m.id} machine={m} />
					))}
					{!boxes.length && !adding && (
						<EmptyState
							size="sm"
							icon={<Box />}
							title="No devboxes yet"
							description="Devboxes are temporary computers for coding."
						/>
					)}
				</>
			) : (
				<>
					{computer ? (
						<MachineSettings key={computer.id} machine={computer} />
					) : (
						<NewComputer agent={agent} settings={setup} />
					)}
					<Section title="Shared access">
						<List>
							<Row
								icon={<Globe />}
								href={`${home}/browsers`}
								title="Shared browsers"
								subtitle="Sites your bots can use together"
							/>
							<Row
								icon={<Users />}
								href={`${home}/sharing`}
								title="Shared computers"
								subtitle={`Computers other bots share with ${agent.name}`}
							/>
							<Row
								icon={<Laptop />}
								href={`${home}/devices`}
								title="Your devices"
								subtitle="Computers you lend from the desktop app"
							/>
						</List>
					</Section>
					<Fold title="Advanced" summary="Devboxes and saved sign-ins">
						<List>
							{(boxes.length > 0 || (hasComputerServer(setup) && can("computers"))) && (
								<Row icon={<Box />} href={`${home}/devboxes`} title="Devboxes" />
							)}
							<Row icon={<KeyRound />} href={`${home}/passwords`} title="Saved sign-ins" />
						</List>
					</Fold>
				</>
			)}
		</Page>
	);
}
