import { api, dateTime, useAgents } from "@sekai/client";
import type { Agent, Routine, RoutineAction, Schedule, SchedulePreview } from "@sekai/shared";
import { Button, CopyField, Dialog, Field, Input, Segmented, Select, Textarea } from "@sekai/ui";
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
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<span className="text-small font-medium text-fg">What starts it</span>
				<Segmented<EventKind>
					label="What starts it"
					value={f.eventKind}
					onValueChange={(eventKind) => setF({ ...f, eventKind })}
					options={[
						{ value: "webhook", label: "A webhook is called" },
						{ value: "device", label: "A device changes" },
					]}
				/>
			</div>
			{f.eventKind === "webhook" ? (
				f.token ? (
					<Field
						label="Webhook address"
						hint="Anyone with this address can start the routine, so keep it private."
					>
						<CopyField label="webhook address" value={hookUrl(f.token)} />
					</Field>
				) : null
			) : (
				<div className="grid gap-4 xs:grid-cols-2">
					<Field label="Device">
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
						/>
					</Field>
					<Field label="When it">
						<Select
							value={f.change}
							onValueChange={(v) => setF({ ...f, change: v as Change })}
							options={[
								{ value: "offline", label: "goes offline" },
								{ value: "online", label: "comes back online" },
								{ value: "any", label: "goes offline or comes back" },
							]}
						/>
					</Field>
				</div>
			)}
		</div>
	);
}

/** Make a routine, or change one: what it's called, what it does, and when. */
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
			if (!schedule) throw new Error("Finish the schedule first.");
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
			size="lg"
			title={routine ? "Edit routine" : "New routine"}
			description="It runs on a schedule, or when something happens, and posts the result in the bot's chat."
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
						{routine ? "Save" : "Create routine"}
					</Button>
				</>
			}
		>
			<form
				className="flex flex-col gap-5"
				onSubmit={(e) => {
					e.preventDefault();
					if (valid && !save.isPending) save.mutate();
				}}
			>
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
						placeholder="e.g. Morning brief"
						maxLength={120}
					/>
				</Field>
				<div className="flex flex-col gap-1.5">
					<span className="text-small font-medium text-fg">What happens</span>
					<Segmented
						label="What happens"
						value={action}
						onValueChange={setAction}
						options={[
							{ value: "run", label: "Bot does the work" },
							{ value: "notify", label: "Just remind me" },
						]}
					/>
				</div>
				<Field
					label={action === "run" ? "Instruction" : "Reminder"}
					hint={
						action === "run"
							? "The goal, where to look, what to post, and what to do if something's missing."
							: "Posted as it is when it's time. No model is used."
					}
				>
					<Textarea
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						placeholder={
							action === "run"
								? "e.g. Run the daily-brief skill and post a 5-bullet brief here."
								: "e.g. Stand up and stretch!"
						}
					/>
				</Field>
				<div className="flex flex-col gap-4">
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
								{ value: "cron", label: "On a custom schedule" },
								{ value: "event", label: "When something happens" },
							]}
						/>
					</Field>
					{f.preset === "event" && <EventFields f={f} setF={setF} />}
					{(f.preset === "daily" || f.preset === "weekdays" || f.preset === "weekly") && (
						<div className="grid gap-4 xs:grid-cols-2">
							{f.preset === "weekly" && (
								<Field label="Day">
									<Select
										value={String(f.weekday)}
										onValueChange={(v) => setF({ ...f, weekday: Number(v) })}
										options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
									/>
								</Field>
							)}
							<Field label="At">
								<Input
									type="time"
									value={f.time}
									onChange={(e) => setF({ ...f, time: e.target.value })}
								/>
							</Field>
						</div>
					)}
					{(f.preset === "minutes" || f.preset === "hours") && (
						<Field label={f.preset === "hours" ? "Every how many hours" : "Every how many minutes"}>
							<Input
								type="number"
								min={1}
								value={f.every}
								onChange={(e) => setF({ ...f, every: Number(e.target.value) })}
								className="xs:w-40"
							/>
						</Field>
					)}
					{f.preset === "once" && (
						<Field label="On">
							<Input
								type="datetime-local"
								value={f.at}
								onChange={(e) => setF({ ...f, at: e.target.value })}
								className="xs:w-72"
							/>
						</Field>
					)}
					{f.preset === "cron" && (
						<Field
							label="Schedule"
							hint="Five fields: minute, hour, day, month, weekday. The preview below says it in words."
						>
							<Input
								value={f.cron}
								onChange={(e) => setF({ ...f, cron: e.target.value })}
								placeholder="0 8 * * 1-5"
								className="font-mono"
							/>
						</Field>
					)}
					<WhenPreview f={f} preview={preview.data} loading={preview.isLoading} timezone={browserTz} />
				</div>
			</form>
		</Dialog>
	);
}

/** In words: what the schedule means and when it runs next. */
function WhenPreview({
	f,
	preview,
	loading,
	timezone,
}: {
	f: ReturnType<typeof fromSchedule>;
	preview: SchedulePreview | undefined;
	loading: boolean;
	timezone: string;
}) {
	if (!preview) {
		return (
			<p className="text-small text-fg-subtle">
				{loading ? "Checking the schedule…" : "Set a schedule to see when it runs."}
			</p>
		);
	}
	if (!preview.valid) return <p className="text-small text-danger-ink">{preview.error}</p>;
	return (
		<div className="flex flex-col gap-0.5 text-small text-fg-muted" aria-live="polite">
			<span className="font-medium text-fg">{preview.description}</span>
			{f.preset === "event" ? (
				<span>
					{f.eventKind === "webhook"
						? "Its address appears once it's saved. What the sender posts goes along to the bot."
						: "Checked every minute; a change counts once it has lasted two checks."}
				</span>
			) : (
				<span>
					Next:{" "}
					{preview.nextRuns
						.slice(0, 3)
						.map((t) => dateTime(t))
						.join(" · ")}
					. Times are in {timezone}.
				</span>
			)}
		</div>
	);
}
