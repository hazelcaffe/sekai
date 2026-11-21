import { api, qk, useAgentMap, useMachines, useSettings } from "@sekai/client";
import type { MachineSettings, Settings } from "@sekai/shared";
import {
	Button,
	Callout,
	EmptyState,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Page,
	Row,
	SaveState,
	Section,
	Segmented,
	SkeletonRows,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Laptop, Monitor, Network, Server, SlidersHorizontal } from "lucide-react";
import { LoadProblem } from "../../components/computer/LoadProblem.tsx";
import { StatusBadge } from "../../components/computer/MachineParts.tsx";
import { hasComputerServer } from "../../components/computer/NewComputer.tsx";
import { SpecsFields, validSpecs } from "../../components/computer/Specs.tsx";
import { useComputerSave } from "../../components/computer/useComputerSave.ts";
import { useGoBack } from "../../lib/back.ts";
import type { SettingsSectionProps } from "../section.ts";

/** The API takes the whole machine group. Keep the latest values outside this editor. */
export function useSaveMachines() {
	const qc = useQueryClient();
	return async (patch: Partial<MachineSettings>) => {
		const current = await api.settings.get();
		const next = await api.settings.update({ machines: { ...current.machines, ...patch } });
		qc.setQueryData(qk.settings, next);
		return next.machines;
	};
}

function Inventory() {
	const query = useMachines();
	const bots = useAgentMap();
	if (query.isError) return <LoadProblem what="computers" retry={query.refetch} />;
	if (!query.data) return <SkeletonRows count={4} />;
	if (!query.data.length)
		return (
			<EmptyState
				icon={<Monitor />}
				title="No computers yet"
				description="Give a bot a computer from its Computer settings."
			/>
		);
	return (
		<List>
			{query.data.map((m) => (
				<Row
					key={m.id}
					icon={m.kind === "device" ? <Laptop /> : m.kind === "devbox" ? <Box /> : <Monitor />}
					title={m.name}
					subtitle={[
						bots.get(m.agentId)?.name,
						m.kind === "device" ? "Lent device" : m.kind === "devbox" ? "Devbox" : "Computer",
						`${m.specs.cores} cores`,
						`${m.specs.memoryMb / 1024} GB`,
					]
						.filter(Boolean)
						.join(" · ")}
					href={`/bots/${m.agentId}/computer${m.kind === "computer" ? "" : m.kind === "devbox" ? "/devboxes" : "/devices"}`}
					badge={<StatusBadge m={m} />}
				/>
			))}
		</List>
	);
}

function Connection({ saved }: { saved: MachineSettings["proxmox"] }) {
	const f = useFormValues(saved);
	const p = f.values;
	const save = useSaveMachines();
	const test = useMutation({ mutationFn: api.machines.testProxmox, onError: () => {} });
	return (
		<FormGroup
			dirty={f.dirty}
			onCancel={() => f.reset()}
			onSubmit={async () => {
				try {
					f.reset((await save({ proxmox: p })).proxmox);
					test.reset();
				} catch {
					throw new Error("Couldn’t save the connection. Check the address and credentials, then try again.");
				}
			}}
			extra={
				<Button
					type="button"
					variant="secondary"
					loading={test.isPending}
					disabled={!saved.url || f.dirty}
					onClick={() => test.mutate()}
				>
					Test connection
				</Button>
			}
		>
			<Field label="Proxmox address">
				<Input
					value={p.url}
					onChange={(e) => f.set("url", e.target.value)}
					placeholder="https://server.example:8006"
				/>
			</Field>
			<Field label="Server node">
				<Input value={p.node} onChange={(e) => f.set("node", e.target.value)} placeholder="pve" />
			</Field>
			<Field label="API token ID" hint="In Proxmox, open Datacenter → Permissions → API Tokens.">
				<Input
					value={p.tokenId}
					onChange={(e) => f.set("tokenId", e.target.value)}
					placeholder="sekai@pve!bots"
				/>
			</Field>
			<Field label="Token secret">
				<Input
					type="password"
					autoComplete="off"
					value={p.tokenSecret}
					onChange={(e) => f.set("tokenSecret", e.target.value)}
				/>
			</Field>
			<Fold title="Advanced" summary="Storage, network and certificate">
				<Field label="Disk storage">
					<Input value={p.storage} onChange={(e) => f.set("storage", e.target.value)} />
				</Field>
				<Field label="Image storage" hint="Allow ISO images, container templates and imports here.">
					<Input value={p.imageStorage} onChange={(e) => f.set("imageStorage", e.target.value)} />
				</Field>
				<Field label="Network bridge">
					<Input value={p.bridge} onChange={(e) => f.set("bridge", e.target.value)} />
				</Field>
				<Field label="First computer ID">
					<Input
						type="number"
						min={100}
						value={p.vmidStart}
						onChange={(e) => f.set("vmidStart", Number(e.target.value))}
					/>
				</Field>
				<ToggleRow
					title="Accept a self-signed certificate"
					checked={p.insecureTls}
					onCheckedChange={(v) => f.set("insecureTls", v)}
				/>
			</Fold>
			{!f.dirty && test.data?.ok && (
				<p role="status" className="text-small text-success-ink">
					Connected to Proxmox {test.data.version}. Nodes: {test.data.nodes.join(", ")}.
					{test.data.storages.length > 0 && ` Storage: ${test.data.storages.join(", ")}.`}
				</p>
			)}
			{!f.dirty && (test.isError || test.data?.ok === false) && (
				<Callout tone="warning" title="Couldn’t reach Proxmox">
					Check the server address and token, then test the connection again.
				</Callout>
			)}
		</FormGroup>
	);
}

function Defaults({ settings: m }: { settings: MachineSettings }) {
	const save = useSaveMachines();
	const defaults = (s: MachineSettings) => ({
		computerSpecs: s.computerSpecs,
		devboxSpecs: s.devboxSpecs,
		computerBackend: s.computerBackend,
		devboxBackend: s.devboxBackend,
		agentRequests: s.agentRequests,
		devboxTtlHours: s.devboxTtlHours,
		maxDevboxesPerAgent: s.maxDevboxesPerAgent,
	});
	const f = useFormValues(defaults(m));
	const values = f.values;
	return (
		<FormGroup
			dirty={f.dirty}
			disabled={
				!validSpecs(values.computerSpecs) ||
				!validSpecs(values.devboxSpecs) ||
				values.devboxTtlHours < 0.25 ||
				values.devboxTtlHours > 720 ||
				values.maxDevboxesPerAgent < 0 ||
				values.maxDevboxesPerAgent > 20
			}
			onCancel={() => f.reset()}
			onSubmit={async () => f.reset(defaults(await save(values)))}
		>
			<Section title="Computers">
				<SpecsFields
					value={values.computerSpecs}
					change={(v) => f.set("computerSpecs", v)}
					variableMemory={values.computerBackend === "vm"}
				/>
			</Section>
			<Section title="Devboxes">
				<SpecsFields value={values.devboxSpecs} change={(v) => f.set("devboxSpecs", v)} />
			</Section>
			<List>
				<ToggleRow
					title="Create without asking"
					description="Bots may create or resize a computer without asking you first."
					checked={values.agentRequests === "allow"}
					onCheckedChange={(v) => f.set("agentRequests", v ? "allow" : "ask")}
				/>
			</List>
			<Fold title="Advanced" summary="Computer types and devbox limits">
				{(
					[
						["computerBackend", "Computer type"],
						["devboxBackend", "Devbox type"],
					] as const
				).map(([key, label]) => (
					<Field key={key} label={label}>
						<Segmented
							label={label}
							value={values[key]}
							onValueChange={(v) => f.set(key, v)}
							options={[
								{ value: "vm", label: "Virtual machine" },
								{ value: "lxc", label: "Container" },
							]}
						/>
					</Field>
				))}
				<Field label="Delete devboxes after (hours)">
					<Input
						type="number"
						min={0.25}
						max={720}
						step={0.25}
						value={values.devboxTtlHours}
						onChange={(e) => f.set("devboxTtlHours", +e.target.value)}
					/>
				</Field>
				<Field label="Devboxes per bot">
					<Input
						type="number"
						min={0}
						max={20}
						value={values.maxDevboxesPerAgent}
						onChange={(e) => f.set("maxDevboxesPerAgent", +e.target.value)}
					/>
				</Field>
			</Fold>
		</FormGroup>
	);
}

function ScreenControl({ settings: m }: { settings: MachineSettings }) {
	const save = useSaveMachines();
	const relay = useComputerSave((screenRelay: boolean) => save({ screenRelay }));
	return (
		<Fold title="Advanced" summary="Screen control">
			<Section title="Screen control" saveState={<SaveState state={relay} />}>
				<List>
					<ToggleRow
						title="Faster screen control"
						description="Try a faster way for bots to see, click and type on their computers."
						checked={m.screenRelay}
						onCheckedChange={relay.save}
					/>
				</List>
				<Fold title="Learn more" variant="link">
					<p className="text-small text-fg-muted">
						Sekai installs the experimental screen-relay helper in the background. It uses the usual
						controls until the helper is ready, if it fails, or on screens wider than 1600 pixels.
					</p>
				</Fold>
			</Section>
		</Fold>
	);
}

function Overview({ settings }: { settings: Settings }) {
	return (
		<>
			<Section title="Inventory">
				<Inventory />
			</Section>
			<Section title="Setup">
				<List>
					<Row
						icon={<Server />}
						title="Computer server"
						subtitle={
							hasComputerServer(settings.machines)
								? settings.machines.proxmox.node
								: "Connect a server to create computers for bots"
						}
						href="/settings/computers/connection"
					/>
					<Row
						icon={<SlidersHorizontal />}
						title="Computer defaults"
						subtitle="Size and limits for new computers"
						href="/settings/computers/defaults"
					/>
					<Row
						icon={<Network />}
						title="Network & devices"
						subtitle="Your network and the devices you lend"
						href="/settings/network"
					/>
				</List>
			</Section>
			<ScreenControl settings={settings.machines} />
		</>
	);
}

export function ComputersSection({ back, rest }: SettingsSectionProps) {
	const goBack = useGoBack();
	const q = useSettings();
	const sub = rest === "connection" || rest === "defaults";
	return (
		<Page
			key={rest}
			title={rest === "connection" ? "Computer server" : rest === "defaults" ? "Computer defaults" : "Computers"}
			back={sub ? { label: "Computers", onClick: () => goBack("/settings/computers") } : back}
			description={
				rest === "connection"
					? "Connect the Proxmox server that will run your bots’ computers."
					: rest === "defaults"
						? "Choose what bots get when they create a computer or devbox."
						: "See the computers and devboxes your bots can use."
			}
		>
			{q.isError ? (
				<LoadProblem what="computer settings" retry={q.refetch} />
			) : !q.data ? (
				<SkeletonRows />
			) : rest === "connection" ? (
				<Connection saved={q.data.machines.proxmox} />
			) : rest === "defaults" ? (
				<Defaults settings={q.data.machines} />
			) : (
				<Overview settings={q.data} />
			)}
		</Page>
	);
}
