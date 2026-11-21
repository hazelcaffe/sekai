import { AgentAvatar, api, desktop, type LocalComputerInfo, useAgents } from "@sekai/client";
import type { LocalComputerSettings } from "@sekai/shared";
import { Badge, Callout, Field, Fold, Input, List, Row, SaveState, Section, SkeletonRows, ToggleRow } from "@sekai/ui";
import { Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadProblem } from "./LoadProblem.tsx";
import { useComputerSave } from "./useComputerSave.ts";

const stateNames = {
	off: "Not lent",
	connecting: "Connecting",
	online: "Ready",
	offline: "Offline",
	problem: "Needs attention",
};
const systems: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
const bridge = desktop?.localComputer;

function Lending({ info, setInfo }: { info: LocalComputerInfo; setInfo: (i: LocalComputerInfo) => void }) {
	const agents = useAgents();
	const [folder, setFolder] = useState(info.settings.workdir);
	const [notice, setNotice] = useState("");
	const { settings: s, status } = info;
	const save = useComputerSave(async (patch: Partial<LocalComputerSettings>) => {
		if (!bridge) throw new Error("Open this page in the desktop app and try again.");
		const names = Object.fromEntries((agents.data ?? []).map((a) => [a.id, a.name]));
		// Keep the scoped token and native confirmation on every path that widens local access.
		const needsToken = (patch.enabled ?? s.enabled) && (patch.enabled === true || info.hasToken === false);
		try {
			const token = needsToken ? (await api.auth.desktopToken(info.computerName)).token : undefined;
			const next = await bridge.set(patch, token, names);
			setInfo(next);
			if (patch.workdir) setFolder(next.settings.workdir);
			setNotice(next.cancelled ? "Nothing changed. You declined the request on this computer." : "");
		} catch {
			throw new Error("Check this computer’s connection to Sekai and try again.");
		}
	});
	const busy = save.status === "saving";
	const visible = (agents.data ?? []).filter((a) => !a.sharedBy && (!a.hidden || s.agentIds.includes(a.id)));
	return (
		<>
			<List>
				<Row
					icon={<Laptop />}
					title={info.computerName}
					subtitle={
						status.activeAgent
							? `${status.activeAgent} is working here`
							: (systems[info.platform] ?? info.platform)
					}
					badge={
						<Badge
							tone={
								status.state === "online"
									? "success"
									: status.state === "problem" || status.state === "offline"
										? "warning"
										: "neutral"
							}
						>
							{stateNames[status.state]}
						</Badge>
					}
				/>
			</List>
			{status.message && s.enabled && (
				<Callout tone="warning" title="Check this computer">
					{/^(Allow Sekai under System Settings|Bots can't use a Wayland|This is a Wayland session|Install (python3|xdotool|imagemagick)|There's no graphical session)/.test(
						status.message,
					)
						? status.message
						: status.state === "problem"
							? "Restart the desktop app and check its permission to see and control the screen."
							: "Check the desktop app’s server address and make sure Sekai is running."}
				</Callout>
			)}
			<Section title="Lending" saveState={notice ? undefined : <SaveState state={save} />}>
				<List>
					<ToggleRow
						title="Lend this computer"
						description="The bots you choose can use your screen and files as you."
						checked={s.enabled}
						disabled={busy}
						onCheckedChange={(enabled) => {
							setNotice("");
							save.save({ enabled });
						}}
					/>
					<ToggleRow
						title="Approve every action"
						description="Each click, command and file change waits for your approval."
						checked={s.askEachAction}
						disabled={busy}
						onCheckedChange={(askEachAction) => {
							setNotice("");
							save.save({ askEachAction });
						}}
					/>
				</List>
				{notice && (
					<p role="status" className="text-small text-fg-muted">
						{notice}
					</p>
				)}
				<p className="text-small text-fg-muted">
					{info.stopShortcut
						? `Press ${info.stopShortcut} anywhere to stop your bots.`
						: "Use the Sekai tray menu to stop your bots."}
				</p>
			</Section>
			<Section
				title="Allowed bots"
				description="Giving a bot more access asks for confirmation on this computer."
			>
				{agents.isError ? (
					<LoadProblem what="bots" retry={agents.refetch} />
				) : !agents.data ? (
					<SkeletonRows />
				) : visible.length ? (
					<List>
						{visible.map((a) => (
							<ToggleRow
								key={a.id}
								title={a.name}
								leading={<AgentAvatar avatar={a.avatar} size={28} />}
								checked={s.agentIds.includes(a.id)}
								disabled={busy}
								onCheckedChange={(on) => {
									setNotice("");
									save.save({
										agentIds: on ? [...s.agentIds, a.id] : s.agentIds.filter((id) => id !== a.id),
									});
								}}
							/>
						))}
					</List>
				) : (
					<p className="text-small text-fg-muted">You don’t have any bots to lend it to yet.</p>
				)}
			</Section>
			<Fold title="Advanced" summary="Starting folder">
				<Field
					label="Start commands in"
					hint="This is a starting folder, not a limit on the files a bot can reach."
				>
					<Input
						value={folder}
						disabled={busy}
						onChange={(e) => setFolder(e.target.value)}
						onBlur={() => {
							if (folder.trim() && folder.trim() !== s.workdir) {
								setNotice("");
								save.save({ workdir: folder.trim() });
							} else setFolder(s.workdir);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
						}}
					/>
				</Field>
			</Fold>
		</>
	);
}

export function ThisComputerSettings() {
	const [info, setInfo] = useState<LocalComputerInfo | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a retry asks the desktop app for fresh settings
	useEffect(() => {
		if (!bridge) return;
		let watching = true;
		setFailed(false);
		void bridge
			.get()
			.then((i) => {
				if (watching) setInfo(i);
			})
			.catch(() => {
				if (watching) setFailed(true);
			});
		const unsubscribe = bridge.onChange(setInfo);
		return () => {
			watching = false;
			unsubscribe();
		};
	}, [attempt]);
	if (!bridge)
		return <Callout title="Desktop app needed">Update the Sekai desktop app to lend this computer.</Callout>;
	if (failed) return <LoadProblem what="desktop settings" retry={() => setAttempt((n) => n + 1)} />;
	return info ? <Lending info={info} setInfo={setInfo} /> : <SkeletonRows count={4} />;
}
