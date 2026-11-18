import { AgentAvatar, api, cn, desktop, type LocalComputerInfo, useAgents } from "@sekai/client";
import type { LocalComputerSettings } from "@sekai/shared";
import { Button, Field, Input, ToggleRow } from "@sekai/ui";
import { AlertTriangle, Check, Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const STATE_TEXT: Record<LocalComputerInfo["status"]["state"], string> = {
	off: "Not lent",
	connecting: "Connecting to Sekai…",
	online: "Ready for your bots",
	offline: "Can't reach Sekai",
	problem: "Needs your attention",
};

const OS = { darwin: "macOS", win32: "Windows", linux: "Linux" } as Record<string, string>;

const bridge = desktop?.localComputer;

/** Lending the computer this desktop app runs on to bots. Only shown in the desktop app. */
export function ThisComputerSettings() {
	const { data: agents = [] } = useAgents();
	const [info, setInfo] = useState<LocalComputerInfo | null>(null);
	const [workdir, setWorkdir] = useState("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!bridge) return;
		void bridge.get().then((i) => {
			setInfo(i);
			setWorkdir(i.settings.workdir);
		});
		return bridge.onChange(setInfo);
	}, []);

	if (!bridge || !info) return null;

	const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
	const save = async (patch: Partial<LocalComputerSettings>) => {
		setSaving(true);
		try {
			// The app connects with its own token: a "bridge" token that can only lend this computer.
			const needsToken =
				(patch.enabled ?? info.settings.enabled) && (patch.enabled === true || info.hasToken === false);
			const token = needsToken ? (await api.auth.desktopToken(info.computerName)).token : undefined;
			const next = await bridge.set(patch, token, names);
			setInfo(next);
			setWorkdir(next.settings.workdir);
			if (next.cancelled) toast("Nothing changed: you didn't allow it on this computer.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};
	const s = info.settings;
	const st = info.status;
	const visible = agents.filter((a) => !a.hidden || s.agentIds.includes(a.id));

	return (
		<>
			<div className="flex items-center gap-3 rounded-2xl bg-surface-2/60 px-3.5 py-3">
				<Laptop className="size-5 shrink-0 text-fg-subtle" />
				<div className="min-w-0 flex-1 text-[13px]">
					<div className="truncate font-medium">
						{info.computerName}
						<span className="font-normal text-fg-subtle"> · {OS[info.platform] ?? info.platform}</span>
					</div>
					<div
						className={cn(
							"text-xs",
							st.state === "online"
								? "text-success"
								: st.state === "off"
									? "text-fg-subtle"
									: "text-warning",
						)}
					>
						{st.activeAgent ? `${st.activeAgent} is working here` : STATE_TEXT[st.state]}
					</div>
				</div>
				{st.state === "online" && <Check className="size-4 text-success" />}
			</div>
			{st.message && s.enabled && (
				<div className="flex gap-2.5 rounded-2xl border border-warning/40 bg-warning/[0.06] px-3.5 py-3 text-[13px]">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
					<span className="min-w-0 flex-1 break-words">{st.message}</span>
				</div>
			)}
			<ToggleRow
				title="Lend this computer to bots"
				description="The bots you pick can see the screen, use the mouse and keyboard, open apps, browse in a separate browser profile, run commands and edit files here, as you. A badge shows while one works."
				checked={s.enabled}
				disabled={saving}
				onCheckedChange={(enabled) => void save({ enabled })}
			/>
			<div className="flex flex-col gap-1.5">
				<div className="text-[13px] font-medium">Bots allowed here</div>
				{visible.length === 0 && <p className="text-xs text-fg-subtle">You have no bots yet.</p>}
				<div className="flex flex-col">
					{visible.map((a) => {
						const on = s.agentIds.includes(a.id);
						return (
							<label
								key={a.id}
								className="flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1.5 hover:bg-surface-2/50"
							>
								<AgentAvatar avatar={a.avatar} size={28} />
								<span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
								<input
									type="checkbox"
									className="size-4 accent-[var(--fg)]"
									checked={on}
									disabled={saving}
									onChange={() =>
										void save({
											agentIds: on
												? s.agentIds.filter((id) => id !== a.id)
												: [...s.agentIds, a.id],
										})
									}
								/>
							</label>
						);
					})}
				</div>
			</div>
			<Field
				label="Start commands in"
				hint="The folder bots work in by default. They can still reach the rest of your files."
			>
				<div className="flex gap-2">
					<Input
						value={workdir}
						onChange={(e) => setWorkdir(e.target.value)}
						className="font-mono text-[13px]"
					/>
					{workdir !== s.workdir && (
						<Button
							variant="secondary"
							disabled={saving || !workdir.trim()}
							onClick={() => void save({ workdir })}
						>
							Save
						</Button>
					)}
				</div>
			</Field>
			<ToggleRow
				title="Approve every action here"
				description="Each click, keystroke, command and file change on this computer waits for your OK, whatever the bot's approval mode."
				checked={s.askEachAction}
				disabled={saving}
				onCheckedChange={(askEachAction) => void save({ askEachAction })}
			/>
			<p className="text-xs leading-5 text-fg-subtle">
				{info.stopShortcut ? (
					<>
						Press <span className="font-mono text-fg-muted">{info.stopShortcut}</span> anywhere to stop the
						bots working here.
					</>
				) : (
					"Stop the bots working here from the Sekai tray menu."
				)}{" "}
				Giving a bot more access asks you to confirm on this computer.
			</p>
		</>
	);
}
