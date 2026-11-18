import { api, copyText, dateTime, useAgents } from "@sekai/client";
import type { Agent, Routine, RoutineAction, Schedule } from "@sekai/shared";
import { Button, Dialog, Field, Input, Segmented, Select, Spinner, Textarea } from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

type Preset = "daily" | "weekdays" | "weekly" | "minutes" | "hours" | "once" | "cron" | "event";
type EventKind = "webhook" | "device";
type Change = "offline" | "online" | "any";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toLocalInput(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Turns a stored schedule back into the builder's fields. */
function fromSchedule(s: Schedule | undefined) {
	const base = {
		preset: "daily" as Preset,
		time: "08:00",
		weekday: 1,
		every: 30,
		at: toLocalInput(Date.now() + 3_600_000),
		cron: "0 8 * * 1-5",
		eventKind: "webhook" as EventKind,
		deviceId: "" as string,
		deviceName: "",
		change: "offline" as Change,
		token: undefined as string | undefined,
	};
	if (!s) return base;
	if (s.type === "event") {
		return s.event.kind === "webhook"
			? { ...base, preset: "event" as Preset, eventKind: "webhook" as EventKind, token: s.event.token }
			: {
					...base,
					preset: "event" as Preset,
					eventKind: "device" as EventKind,
					deviceId: s.event.deviceId ?? "",
					deviceName: s.event.deviceName,
					change: s.event.change,
				};
	}
	if (s.type === "interval")
		return s.minutes % 60 === 0
			? { ...base, preset: "hours" as Preset, every: s.minutes / 60 }
			: { ...base, preset: "minutes" as Preset, every: s.minutes };
	if (s.type === "once") return { ...base, preset: "once" as Preset, at: toLocalInput(s.at) };
	const m = s.expr.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/);
	if (m?.[1] && m[2] && m[3]) {
		const time = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
		if (m[3] === "*") return { ...base, preset: "daily" as Preset, time };
		if (m[3] === "1-5") return { ...base, preset: "weekdays" as Preset, time };
		return { ...base, preset: "weekly" as Preset, time, weekday: Number(m[3]) };
	}
	return { ...base, preset: "cron" as Preset, cron: s.expr };
}

function buildSchedule(f: ReturnType<typeof fromSchedule>): Schedule | null {
	const [h, mi] = f.time.split(":").map(Number);
	switch (f.preset) {
		case "daily":
			return { type: "cron", expr: `${mi ?? 0} ${h ?? 8} * * *` };
		case "weekdays":
			return { type: "cron", expr: `${mi ?? 0} ${h ?? 8} * * 1-5` };
		case "weekly":
			return { type: "cron", expr: `${mi ?? 0} ${h ?? 8} * * ${f.weekday}` };
		case "minutes":
			return f.every >= 1 ? { type: "interval", minutes: f.every } : null;
		case "hours":
			return f.every >= 1 ? { type: "interval", minutes: f.every * 60 } : null;
		case "once": {
			const t = new Date(f.at).getTime();
			return Number.isNaN(t) ? null : { type: "once", at: t };
		}
		case "cron":
			return f.cron.trim() ? { type: "cron", expr: f.cron.trim() } : null;
		case "event":
			return f.eventKind === "webhook"
				? { type: "event", event: { kind: "webhook", ...(f.token ? { token: f.token } : {}) } }
				: {
						type: "event",
						event: {
							kind: "device",
							deviceId: f.deviceId || null,
							deviceName: f.deviceName,
							change: f.change,
						},
					};
	}
}

/** Where a webhook routine is called: this server's address (reachable from your tailnet). */
export function hookUrl(token: string): string {
	return `${location.origin}/api/hooks/${token}`;
}

function EventFields({
	f,
	setF,
}: {
	f: ReturnType<typeof fromSchedule>;
	setF: (f: ReturnType<typeof fromSchedule>) => void;
}) {
	const { data: tailnet } = useQuery({
		queryKey: ["hosts", "tailnet"],
		queryFn: api.hosts.tailnet,
		enabled: f.eventKind === "device",
		staleTime: 60_000,
	});
	const devices = (tailnet?.devices ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
	return (
		<div className="flex flex-col gap-3">
			<Segmented<EventKind>
				value={f.eventKind}
				onValueChange={(eventKind) => setF({ ...f, eventKind })}
				options={[
					{ value: "webhook", label: "A webhook is called" },
					{ value: "device", label: "A device changes" },
				]}
			/>
			{f.eventKind === "webhook" ? (
				f.token ? (
					<Field
						label="Webhook address"
						hint="POST to it from GitHub, Home Assistant, IFTTT, Zapier or a script. Anyone with the address can start this routine, so keep it private."
					>
						<CopyAddress value={hookUrl(f.token)} />
					</Field>
				) : null
			) : (
				<div className="flex flex-wrap gap-2">
					<Select
						value={f.deviceId || "any"}
						onValueChange={(v) => {
							const d = devices.find((x) => x.id === v);
							setF({ ...f, deviceId: v === "any" ? "" : v, deviceName: d?.name ?? "" });
						}}
						options={[
							{ value: "any", label: "Any device bots can use" },
							...devices.map((d) => ({ value: d.id, label: d.name })),
						]}
						className="min-w-48 flex-1"
					/>
					<Select
						value={f.change}
						onValueChange={(v) => setF({ ...f, change: v as Change })}
						options={[
							{ value: "offline", label: "goes offline" },
							{ value: "online", label: "comes back online" },
							{ value: "any", label: "goes offline or comes back" },
						]}
						className="min-w-48 flex-1"
					/>
				</div>
			)}
		</div>
	);
}

/** A read-only address with a copy button. */
export function CopyAddress({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-1.5">
			<code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
			<Button
				variant="ghost"
				size="xs"
				onClick={() => {
					void copyText(value).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1200);
					});
				}}
			>
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
}

export function RoutineDialog({
	open,
	onOpenChange,
	routine,
	agent,
	conversationId,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	routine?: Routine | null;
	/** Pre-selected owner; when absent the dialog lets you pick a bot. */
	agent?: Agent | null;
	conversationId?: string | null;
}) {
	const { data: agents = [] } = useAgents();
	const [agentId, setAgentId] = useState(agent?.id ?? routine?.agentId ?? agents[0]?.id ?? "");
	const [name, setName] = useState("");
	const [instruction, setInstruction] = useState("");
	const [action, setAction] = useState<RoutineAction>("run");
	const [f, setF] = useState(fromSchedule(undefined));
	const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	useEffect(() => {
		if (!open) return;
		setAgentId(agent?.id ?? routine?.agentId ?? agents[0]?.id ?? "");
		setName(routine?.name ?? "");
		setInstruction(routine?.instruction ?? "");
		setAction(routine?.action ?? "run");
		setF(fromSchedule(routine?.schedule));
	}, [open, routine, agent, agents]);

	const schedule = useMemo(() => buildSchedule(f), [f]);
	const preview = useQuery({
		queryKey: ["schedulePreview", schedule],
		queryFn: () => api.routines.preview({ schedule: schedule as Schedule }),
		enabled: open && Boolean(schedule),
		staleTime: 30_000,
	});

	const save = useMutation({
		mutationFn: () => {
			if (!schedule) throw new Error("Finish the schedule first");
			const body = { name: name.trim(), instruction: instruction.trim(), action, schedule };
			return routine
				? api.routines.update(routine.id, body)
				: api.routines.create({ ...body, agentId, conversationId: conversationId ?? null });
		},
		onSuccess: () => onOpenChange(false),
	});

	const valid = Boolean(name.trim() && instruction.trim() && schedule && agentId && preview.data?.valid !== false);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={routine ? "Edit routine" : "New routine"}
			description="Routines run on a schedule, or when something happens, and post the result in the bot's chat."
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
						{routine ? "Save" : "Create routine"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-5">
				{!agent && !routine && (
					<Field label="Bot">
						<Select
							value={agentId}
							onValueChange={setAgentId}
							options={agents.map((a) => ({ value: a.id, label: a.name }))}
						/>
					</Field>
				)}
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Morning brief"
						maxLength={120}
					/>
				</Field>
				<Field label="What happens">
					<Segmented
						value={action}
						onValueChange={setAction}
						options={[
							{ value: "run", label: "Bot does the work" },
							{ value: "notify", label: "Just remind me" },
						]}
					/>
				</Field>
				<Field
					label={action === "run" ? "Instruction" : "Reminder text"}
					hint={
						action === "run"
							? "Self-contained: the goal, where to look, the output format, and what to do if data is missing."
							: "Posted as-is when it fires. No model call."
					}
				>
					<Textarea
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						placeholder={
							action === "run"
								? "Run the daily-brief skill and post a 5-bullet brief here."
								: "Stand up and stretch!"
						}
					/>
				</Field>
				<Field label="When">
					<Select
						value={f.preset}
						onValueChange={(v) => setF({ ...f, preset: v as Preset })}
						options={[
							{ value: "daily", label: "Every day" },
							{ value: "weekdays", label: "Every weekday" },
							{ value: "weekly", label: "Every week" },
							{ value: "hours", label: "Every few hours" },
							{ value: "minutes", label: "Every few minutes" },
							{ value: "once", label: "Once" },
							{ value: "cron", label: "Custom (cron)" },
							{ value: "event", label: "When something happens" },
						]}
					/>
					{f.preset === "event" && <EventFields f={f} setF={setF} />}
					<div className="flex flex-wrap gap-2">
						{(f.preset === "daily" || f.preset === "weekdays" || f.preset === "weekly") && (
							<>
								{f.preset === "weekly" && (
									<Select
										value={String(f.weekday)}
										onValueChange={(v) => setF({ ...f, weekday: Number(v) })}
										options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
										className="w-40"
									/>
								)}
								<Input
									type="time"
									value={f.time}
									onChange={(e) => setF({ ...f, time: e.target.value })}
									className="w-36"
								/>
							</>
						)}
						{(f.preset === "minutes" || f.preset === "hours") && (
							<div className="flex items-center gap-2 text-sm">
								Every
								<Input
									type="number"
									min={1}
									value={f.every}
									onChange={(e) => setF({ ...f, every: Number(e.target.value) })}
									className="w-24"
								/>
								{f.preset === "hours" ? "hours" : "minutes"}
							</div>
						)}
						{f.preset === "once" && (
							<Input
								type="datetime-local"
								value={f.at}
								onChange={(e) => setF({ ...f, at: e.target.value })}
								className="w-full xs:w-64"
							/>
						)}
						{f.preset === "cron" && (
							<Input
								value={f.cron}
								onChange={(e) => setF({ ...f, cron: e.target.value })}
								placeholder="0 8 * * 1-5"
								className="font-mono"
							/>
						)}
					</div>
				</Field>
				<div className="rounded-2xl bg-surface-2/60 px-4 py-3 text-[13px]">
					{f.preset === "event" && preview.data?.valid ? (
						<>
							<div className="font-medium">{preview.data.description}</div>
							<div className="mt-1 text-xs text-fg-subtle">
								{f.eventKind === "webhook"
									? "Its address appears here once it's saved. What the sender posts comes along to the bot."
									: "Sekai checks your tailnet every minute; a change counts once it has lasted two checks."}
							</div>
						</>
					) : preview.isLoading ? (
						<Spinner />
					) : preview.data ? (
						preview.data.valid ? (
							<>
								<div className="font-medium">{preview.data.description}</div>
								<div className="mt-1 text-xs text-fg-subtle">
									Next:{" "}
									{preview.data.nextRuns
										.slice(0, 3)
										.map((t) => dateTime(t))
										.join(" · ")}
								</div>
								<div className="mt-1 text-[11px] text-fg-subtle">Times shown in {browserTz}.</div>
							</>
						) : (
							<div className="text-danger">{preview.data.error}</div>
						)
					) : (
						<span className="text-fg-subtle">Set a schedule to preview it.</span>
					)}
				</div>
			</div>
		</Dialog>
	);
}
