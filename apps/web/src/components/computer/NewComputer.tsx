import { api, useAccess } from "@sekai/client";
import type { Agent, MachineSettings } from "@sekai/shared";
import { Button, Callout, Field, Fold, FormGroup, Input, Link, Section, Segmented, useFormValues } from "@sekai/ui";
import { useState } from "react";
import { SpecsFields, validSpecs } from "./Specs.tsx";

export function hasComputerServer(m: MachineSettings & { configured?: boolean }) {
	return m.configured ?? Boolean(m.proxmox.url && m.proxmox.node && m.proxmox.tokenId);
}

function ExistingComputer({ agent, close }: { agent: Agent; close: () => void }) {
	const f = useFormValues({ host: "", username: "", port: "22" });
	const { host, username, port } = f.values;
	return (
		<FormGroup
			dirty={f.dirty}
			submitLabel="Connect"
			disabled={!host.trim() || !username.trim() || !Number.isInteger(+port) || +port < 1 || +port > 65535}
			onCancel={close}
			extra={
				!f.dirty && (
					<Button variant="ghost" onClick={close}>
						Cancel
					</Button>
				)
			}
			onSubmit={async () => {
				try {
					await api.machines.create({
						agentId: agent.id,
						kind: "computer",
						provider: "ssh",
						ssh: {
							host: host.trim(),
							username: username.trim(),
							port: +port,
							vncPort: 5900,
							rdpPort: 3389,
						},
					});
					f.reset();
					close();
				} catch {
					throw new Error("Couldn’t connect the computer. Check the address and account, then try again.");
				}
			}}
		>
			<Field label="Computer address" hint="Use the name or IP address of a Linux desktop that accepts SSH.">
				<Input value={host} onChange={(e) => f.set("host", e.target.value)} />
			</Field>
			<Field label="Account name">
				<Input value={username} onChange={(e) => f.set("username", e.target.value)} />
			</Field>
			<Field label="SSH port">
				<Input type="number" value={port} onChange={(e) => f.set("port", e.target.value)} />
			</Field>
		</FormGroup>
	);
}

export function NewComputer({
	agent,
	settings,
	devbox = false,
	done,
}: {
	agent: Agent;
	settings: MachineSettings;
	devbox?: boolean;
	done?: () => void;
}) {
	const { can, admin } = useAccess();
	const [existing, setExisting] = useState(false);
	const base = devbox ? settings.devboxSpecs : settings.computerSpecs;
	const f = useFormValues({
		specs: base,
		backend: devbox ? settings.devboxBackend : settings.computerBackend,
		name: "",
		hours: settings.devboxTtlHours,
	});
	const { backend, name, hours } = f.values;
	const specs = { ...f.values.specs, minMemoryMb: backend === "vm" && !devbox ? f.values.specs.minMemoryMb : 0 };
	const what = devbox ? "devbox" : "computer";
	if (!can("computers"))
		return <Callout title="Computer access">Ask an admin to allow computers for your role.</Callout>;
	return (
		<Section
			title={devbox ? "New devbox" : "A computer of its own"}
			description={
				devbox
					? "A temporary workspace for code, without a screen."
					: `Give ${agent.name} a desktop you can watch from your chat.`
			}
		>
			{existing ? (
				<ExistingComputer agent={agent} close={() => setExisting(false)} />
			) : (
				<>
					{hasComputerServer(settings) ? (
						<FormGroup
							dirty={f.dirty}
							submitWhenClean
							submitLabel={`Create ${what}`}
							onCancel={() => {
								f.reset();
								done?.();
							}}
							extra={
								done &&
								!f.dirty && (
									<Button variant="ghost" onClick={done}>
										Cancel
									</Button>
								)
							}
							disabled={!validSpecs(specs) || (devbox && (hours < 0.25 || hours > 720))}
							onSubmit={async () => {
								try {
									await api.machines.create({
										agentId: agent.id,
										kind: devbox ? "devbox" : "computer",
										specs,
										backend,
										name: name.trim() || undefined,
										ttlHours: devbox ? hours : undefined,
									});
									f.reset();
									done?.();
								} catch {
									throw new Error(
										`Couldn’t create the ${what}. Check the computer server and try again.`,
									);
								}
							}}
						>
							{devbox && (
								<Field label="Name" optional>
									<Input
										maxLength={60}
										value={name}
										onChange={(e) => f.set("name", e.target.value)}
									/>
								</Field>
							)}
							<Fold title="Advanced" summary="Size and setup">
								<Field label="Computer type">
									<Segmented
										label="Computer type"
										value={backend}
										onValueChange={(b) => f.set("backend", b)}
										options={[
											{ value: "vm", label: "Virtual machine" },
											{ value: "lxc", label: "Container" },
										]}
									/>
								</Field>
								<SpecsFields
									value={specs}
									variableMemory={!devbox && backend === "vm"}
									change={(s) => f.set("specs", s)}
								/>
								{devbox && (
									<Field label="Delete after (hours)">
										<Input
											type="number"
											min={0.25}
											max={720}
											step={0.25}
											value={hours}
											onChange={(e) => f.set("hours", Number(e.target.value))}
										/>
									</Field>
								)}
							</Fold>
						</FormGroup>
					) : (
						<Callout
							title="Computer server needed"
							action={
								admin && (
									<Button size="sm" variant="secondary" asChild>
										<Link href="/settings/computers/connection">Set up server</Link>
									</Button>
								)
							}
						>
							{admin
								? "Connect a server to create computers for your bots."
								: "Ask an admin to connect a computer server first."}
						</Callout>
					)}
					{!devbox && (
						<Button variant="ghost" className="self-start" onClick={() => setExisting(true)}>
							Use an existing computer
						</Button>
					)}
				</>
			)}
		</Section>
	);
}
