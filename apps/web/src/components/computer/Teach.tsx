import { api, cn } from "@sekai/client";
import {
	type Machine,
	pickFrames,
	type SkillDraft,
	TEACH_MAX_MS,
	type TeachKey,
	TeachRecorder,
	type TeachStepInput,
} from "@sekai/shared";
import { Button, Confirm, Dialog, Field, IconButton, Input, Spinner, Textarea } from "@sekai/ui";
import {
	ArrowDownUp,
	EyeOff,
	GraduationCap,
	Keyboard,
	Lock,
	MousePointerClick,
	Move,
	TextCursorInput,
	X,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Teaching a bot by doing it once, in the takeover view: while you're in control, what you do on its screen is
 * recorded (a frame of the screen at each click, with the click marked), you check the steps, a model writes them
 * up as a skill, and you review it before it's saved for the bot. Text typed into a password field isn't kept.
 */

type Typed = Extract<TeachStepInput, { kind: "type" } | { kind: "secret" }>;

/** The screen as it is now: a JPEG at most 1024 wide, with a ring where you clicked (screen pixels). */
function frameOf(canvas: HTMLCanvasElement, mark?: { x: number; y: number }): Promise<string | undefined> {
	const { width, height } = canvas;
	if (!width || !height) return Promise.resolve(undefined);
	const s = Math.min(1, 1024 / width);
	const snap = document.createElement("canvas");
	snap.width = Math.round(width * s);
	snap.height = Math.round(height * s);
	const ctx = snap.getContext("2d");
	if (!ctx) return Promise.resolve(undefined);
	// Copied now, before the click changes anything; encoding waits.
	ctx.drawImage(canvas, 0, 0, snap.width, snap.height);
	if (mark) {
		// The danger colour, as the canvas needs a resolved value.
		const danger = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim() || "red";
		ctx.lineWidth = 3;
		ctx.strokeStyle = danger;
		ctx.beginPath();
		ctx.arc(mark.x * s, mark.y * s, 16, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = danger;
		ctx.beginPath();
		ctx.arc(mark.x * s, mark.y * s, 3, 0, Math.PI * 2);
		ctx.fill();
	}
	return new Promise((resolve) =>
		snap.toBlob(
			(blob) => {
				if (!blob) return resolve(undefined);
				const reader = new FileReader();
				reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
				reader.onerror = () => resolve(undefined);
				reader.readAsDataURL(blob);
			},
			"image/jpeg",
			0.72,
		),
	);
}

/** Where a pointer event lands on the computer's screen, in its own pixels (whatever the view's scale). */
function screenPoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
	const r = canvas.getBoundingClientRect();
	if (!r.width || !r.height) return null;
	const x = ((e.clientX - r.left) * canvas.width) / r.width;
	const y = ((e.clientY - r.top) * canvas.height) / r.height;
	if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
	return { x: Math.round(x), y: Math.round(y) };
}

const BUTTONS = ["left", "middle", "right"] as const;

const canvasIn = (screen: RefObject<HTMLDivElement | null>) => screen.current?.querySelector("canvas") ?? null;

/** The step recorded at `at` now (a drag replaces the click it started as). */
const stepAt = (recorder: RefObject<TeachRecorder | null>, at: number) =>
	recorder.current?.steps.find((s) => s.at === at);

export interface Teaching {
	phase: "idle" | "setup" | "recording" | "review" | "drafting" | "skill";
	goal: string;
	startedAt: number | null;
	count: number;
	/** Opens "What will you show it?". */
	begin(): void;
	start(goal: string): void;
	/** Done: the steps go to review. */
	stop(): void;
	discard(): void;
	/** The toolbar's keys and paste, which don't come through the keyboard. */
	press(combo: string): void;
	text(text: string, pasted?: boolean): void;
	key(k: TeachKey): void;
}

export function useTeach({
	machine,
	agentId,
	screen,
	focusScreen,
}: {
	machine: Machine;
	agentId?: string;
	screen: RefObject<HTMLDivElement | null>;
	/** Gives the computer's screen the keyboard again. */
	focusScreen: () => void;
}) {
	const [phase, setPhase] = useState<Teaching["phase"]>("idle");
	const [goal, setGoal] = useState("");
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const [count, setCount] = useState(0);
	const [steps, setSteps] = useState<TeachStepInput[]>([]);
	const [finalImage, setFinalImage] = useState<string | undefined>();
	const [screenSize, setScreenSize] = useState({ width: 1280, height: 800 });
	const [draft, setDraft] = useState<SkillDraft | null>(null);
	const recorder = useRef<TeachRecorder | null>(null);
	const lastWindow = useRef<string | null>(null);
	const asking = useRef<Promise<string | null> | null>(null);
	const started = useRef(0);
	const recording = phase === "recording";

	const now = () => Date.now() - started.current;
	const bump = () => setCount(recorder.current?.steps.length ?? 0);

	/** The active window for a step (one question at a time; later steps reuse the answer in flight). */
	const windowFor = useCallback(
		(step: { at: number; window?: string | null }) => {
			step.window = lastWindow.current;
			asking.current ??= api.machines.teach
				.context(machine.id, { agentId })
				.then((c) => {
					lastWindow.current = c.window;
					return c.window;
				})
				.catch(() => lastWindow.current)
				.finally(() => {
					asking.current = null;
				});
			void asking.current.then((w) => {
				const current = stepAt(recorder, step.at);
				if (current) current.window = w;
			});
		},
		[machine.id, agentId],
	);

	/** A typed run started: if it's going into a password field, its text is dropped (and never sent). */
	const checkField = useCallback(
		(run: Typed) => {
			run.window = lastWindow.current;
			void api.machines.teach
				.context(machine.id, { agentId, focus: true })
				.then((c) => {
					lastWindow.current = c.window ?? lastWindow.current;
					const r = recorder.current;
					const current = r?.steps.find((s) => s.at === run.at && (s.kind === "type" || s.kind === "secret"));
					if (!r || !current || (current.kind !== "type" && current.kind !== "secret")) return;
					if (c.focused?.password) r.hide(current, c.focused.name);
					else if (c.focused?.name) current.field = c.focused.name;
					current.window = c.window;
				})
				.catch(() => {});
		},
		[machine.id, agentId],
	);

	const stop = useCallback(() => {
		const r = recorder.current;
		const c = canvasIn(screen);
		if (!r) return;
		if (c) {
			setScreenSize({ width: c.width, height: c.height });
			void frameOf(c).then(setFinalImage);
		}
		// Frames are still being encoded for the last clicks: give them a moment.
		setTimeout(() => {
			setSteps([...r.finish()]);
			setPhase("review");
		}, 250);
	}, [screen]);
	const stopRef = useRef(stop);
	stopRef.current = stop;

	// While recording: what you do on the screen (capturing, so the computer still gets every event).
	useEffect(() => {
		const el = screen.current;
		if (!recording || !el) return;
		const at = () => Date.now() - started.current;
		const changed = () => setCount(recorder.current?.steps.length ?? 0);
		const down = (e: PointerEvent) => {
			const c = canvasIn(screen);
			const p = c && screenPoint(c, e);
			const r = recorder.current;
			if (!c || !p || !r) return;
			const step = r.pointerDown(p.x, p.y, BUTTONS[e.button] ?? "left", at());
			if (step) {
				void frameOf(c, p).then((img) => {
					const current = stepAt(recorder, step.at);
					if (current?.kind === "click" || current?.kind === "drag") current.image = img;
				});
				windowFor(step);
			}
			changed();
		};
		const up = (e: PointerEvent) => {
			const c = canvasIn(screen);
			const p = c && screenPoint(c, e);
			if (p) recorder.current?.pointerUp(p.x, p.y);
			changed();
		};
		const wheel = (e: WheelEvent) => {
			const c = canvasIn(screen);
			const p = c && screenPoint(c, e);
			if (!p || (!e.deltaX && !e.deltaY)) return;
			const dir =
				Math.abs(e.deltaY) >= Math.abs(e.deltaX)
					? e.deltaY > 0
						? "down"
						: "up"
					: e.deltaX > 0
						? "right"
						: "left";
			recorder.current?.wheel(p.x, p.y, dir, at());
			changed();
		};
		const key = (e: KeyboardEvent) => {
			if (e.isComposing) return;
			const run = recorder.current?.key(
				{ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey },
				at(),
			);
			if (run) checkField(run);
			changed();
		};
		el.addEventListener("pointerdown", down, true);
		el.addEventListener("pointerup", up, true);
		el.addEventListener("wheel", wheel, { capture: true, passive: true });
		el.addEventListener("keydown", key, true);
		const limit = setTimeout(() => {
			toast(`Recording stopped after ${TEACH_MAX_MS / 60_000} minutes`);
			stopRef.current();
		}, TEACH_MAX_MS);
		return () => {
			el.removeEventListener("pointerdown", down, true);
			el.removeEventListener("pointerup", up, true);
			el.removeEventListener("wheel", wheel, true);
			el.removeEventListener("keydown", key, true);
			clearTimeout(limit);
		};
	}, [recording, screen, windowFor, checkField]);

	const reset = () => {
		recorder.current = null;
		setPhase("idle");
		setGoal("");
		setStartedAt(null);
		setCount(0);
		setSteps([]);
		setFinalImage(undefined);
		setDraft(null);
	};

	const teaching: Teaching = {
		phase,
		goal,
		startedAt,
		count,
		begin: () => setPhase("setup"),
		start: (g) => {
			recorder.current = new TeachRecorder();
			started.current = Date.now();
			lastWindow.current = null;
			setGoal(g.trim());
			setStartedAt(Date.now());
			setCount(0);
			setPhase("recording");
			// The dialog gives focus back to the button that opened it as it closes: the screen takes it after that.
			setTimeout(focusScreen, 350);
		},
		stop,
		discard: reset,
		press: (combo) => {
			if (!recording) return;
			recorder.current?.press(combo, now());
			bump();
		},
		text: (text, pasted = false) => {
			if (!recording) return;
			const run = recorder.current?.text(text, now(), pasted);
			if (run) checkField(run);
			bump();
		},
		key: (k) => {
			if (!recording) return;
			recorder.current?.key(k, now());
			bump();
		},
	};

	return {
		teaching,
		dialogs: {
			machine,
			agentId,
			phase,
			setPhase,
			goal,
			steps,
			setSteps,
			finalImage,
			screenSize,
			draft,
			setDraft,
			reset,
			resume: () => {
				setPhase("recording");
				setTimeout(focusScreen, 350);
			},
			start: teaching.start,
		},
	};
}

type DialogsState = ReturnType<typeof useTeach>["dialogs"];

function stepLine(s: TeachStepInput): string {
	const where = s.window ? ` in ${s.window}` : "";
	switch (s.kind) {
		case "click":
			return `${s.double ? "Double-clicked" : s.button === "right" ? "Right-clicked" : "Clicked"}${where}`;
		case "drag":
			return `Dragged${where}`;
		case "scroll":
			return `Scrolled ${s.direction}${s.amount > 1 ? ` ×${s.amount}` : ""}${where}`;
		case "type":
			return `${s.pasted ? "Pasted" : "Typed"} “${s.text.length > 80 ? `${s.text.slice(0, 80)}…` : s.text}”${s.field ? ` into ${s.field}` : ""}`;
		case "secret":
			return `Typed private text${s.field ? ` into ${s.field}` : ""} (not kept)`;
		case "key":
			return `Pressed ${s.combo}`;
	}
}

const ICONS = {
	click: MousePointerClick,
	drag: Move,
	scroll: ArrowDownUp,
	type: TextCursorInput,
	secret: Lock,
	key: Keyboard,
} as const;

/** The teaching dialogs: what you'll show, the steps it recorded, and the skill a model wrote from them. */
export function TeachDialogs({ state, botName }: { state: DialogsState; botName: string }) {
	const { machine, agentId, phase, setPhase, goal, steps, setSteps, finalImage, screenSize, draft, setDraft } = state;
	const [goalText, setGoalText] = useState("");
	const [notes, setNotes] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [discard, setDiscard] = useState(false);

	useEffect(() => {
		if (phase === "setup") {
			setGoalText("");
			setNotes("");
		}
		if (phase === "recording" || phase === "setup") setError(null);
	}, [phase]);

	const write = async () => {
		setError(null);
		setPhase("drafting");
		const keep = pickFrames(steps);
		try {
			const result = await api.machines.teach.draft(machine.id, {
				agentId,
				goal,
				notes,
				screen: screenSize,
				steps: steps.map((s, i) =>
					(s.kind === "click" || s.kind === "drag") && !keep.has(i) ? { ...s, image: undefined } : s,
				),
				finalImage,
			});
			setDraft(result);
			setPhase("skill");
		} catch {
			setError("Couldn’t write the skill. Your steps are still here; try writing it again.");
			setPhase("review");
		}
	};

	const save = async () => {
		if (!draft) return;
		setSaving(true);
		try {
			const skill = await api.machines.teach.save(machine.id, {
				agentId,
				name: draft.name,
				title: draft.title,
				description: draft.description,
				instructions: draft.instructions,
			});
			toast.success(`${botName} learned “${skill.title}”`, {
				description: "It's in its skills now, and it loads it when you ask for this.",
			});
			state.reset();
			setNotes("");
		} catch {
			setError("Couldn’t save the skill. Check the title and instructions, then try again.");
		} finally {
			setSaving(false);
		}
	};

	const hide = (i: number) =>
		setSteps(
			steps.map((s, j) =>
				j === i && s.kind === "type" ? { kind: "secret", at: s.at, window: s.window, field: s.field } : s,
			),
		);
	const drop = (i: number) => setSteps(steps.filter((_, j) => j !== i));

	return (
		<>
			<Dialog
				open={phase === "setup"}
				onOpenChange={(o) => !o && state.reset()}
				icon={<GraduationCap />}
				title={`Show ${botName} how`}
				description={`Record the task once, then review what ${botName} will learn.`}
				footer={
					<>
						<Button variant="ghost" onClick={state.reset}>
							Cancel
						</Button>
						<Button variant="primary" disabled={!goalText.trim()} onClick={() => state.start(goalText)}>
							Start recording
						</Button>
					</>
				}
			>
				<Field label="What will you show it?">
					<Input
						autoFocus
						value={goalText}
						maxLength={500}
						onChange={(e) => setGoalText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && goalText.trim()) state.start(goalText);
						}}
						placeholder="e.g. Download this month's invoice from the billing site"
					/>
				</Field>
				<p className="text-small text-fg-muted">
					Check the recording for private details before sending it to the model.
				</p>
			</Dialog>

			<Dialog
				open={phase === "review" || phase === "drafting"}
				onOpenChange={(o) => !o && phase !== "drafting" && setDiscard(true)}
				size="lg"
				icon={<GraduationCap />}
				title="Review recording"
				description="Hide private text and drop unwanted steps before sending the recording to the model."
				footer={
					<>
						<Button variant="ghost" onClick={() => setDiscard(true)} disabled={phase === "drafting"}>
							Discard
						</Button>
						<Button variant="secondary" onClick={state.resume} disabled={phase === "drafting"}>
							Keep recording
						</Button>
						<Button
							variant="primary"
							onClick={() => void write()}
							disabled={phase === "drafting" || steps.length === 0}
						>
							{phase === "drafting" ? <Spinner /> : <GraduationCap />}
							{phase === "drafting" ? "Writing it up…" : "Write the skill"}
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-3">
					<p className="break-words text-small text-fg-muted">
						{goal} · {steps.length} {steps.length === 1 ? "step" : "steps"}
					</p>
					{steps.length === 0 ? (
						<p className="text-small text-fg-subtle">
							Nothing was recorded. Keep recording and do the task.
						</p>
					) : (
						<ol className="flex max-h-[45vh] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
							{steps.map((s, i) => {
								const Icon = ICONS[s.kind];
								const image = s.kind === "click" || s.kind === "drag" ? s.image : undefined;
								return (
									// biome-ignore lint/suspicious/noArrayIndexKey: steps have no ids and don't reorder
									<li key={i} className="flex items-center gap-2.5 px-3 py-2">
										<span className="w-5 shrink-0 text-right text-caption tabular-nums text-fg-subtle">
											{i + 1}
										</span>
										<Icon className="size-4 shrink-0 text-fg-muted" />
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-body",
												s.kind === "secret" && "text-fg-subtle",
											)}
										>
											{stepLine(s)}
										</span>
										{image && (
											<img
												src={image}
												alt=""
												className="h-9 w-14 shrink-0 rounded-sm object-cover ring-1 ring-border"
											/>
										)}
										{s.kind === "type" && (
											<IconButton size="icon-sm" label="Hide this text" onClick={() => hide(i)}>
												<EyeOff />
											</IconButton>
										)}
										<IconButton size="icon-sm" label="Drop this step" onClick={() => drop(i)}>
											<X />
										</IconButton>
									</li>
								);
							})}
						</ol>
					)}
					<Field label="Extra notes" optional>
						<Textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							maxLength={4000}
							rows={2}
							placeholder="e.g. Always pick last month. Ask me before paying anything."
						/>
					</Field>
					{error && <p className="text-body text-danger-ink">{error}</p>}
				</div>
			</Dialog>

			<Dialog
				open={phase === "skill" && draft !== null}
				onOpenChange={(o) => !o && !saving && setDiscard(true)}
				size="lg"
				icon={<GraduationCap />}
				title="Review the skill"
				description={`Check the instructions from ${draft?.model ?? "the model"} before saving them for ${botName}.`}
				footer={
					<>
						<Button variant="ghost" onClick={() => setDiscard(true)} disabled={saving}>
							Discard
						</Button>
						<Button variant="secondary" onClick={() => setPhase("review")} disabled={saving}>
							Back to the steps
						</Button>
						<Button
							variant="primary"
							onClick={() => void save()}
							disabled={
								saving ||
								!draft?.title.trim() ||
								!draft?.description.trim() ||
								!draft.instructions.trim()
							}
						>
							{saving ? <Spinner /> : null} Save for {botName}
						</Button>
					</>
				}
			>
				{draft && (
					<div className="flex flex-col gap-3">
						<Field label="Title">
							<Input
								value={draft.title}
								maxLength={120}
								onChange={(e) => setDraft({ ...draft, title: e.target.value })}
							/>
						</Field>
						<Field label="When to use it" hint={`${botName} reads this to decide when to load the skill.`}>
							<Textarea
								value={draft.description}
								maxLength={1000}
								rows={2}
								onChange={(e) => setDraft({ ...draft, description: e.target.value })}
							/>
						</Field>
						<Field label="Steps">
							<Textarea
								value={draft.instructions}
								rows={14}
								className="font-mono text-small"
								onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
							/>
						</Field>
						{error && <p className="text-body text-danger-ink">{error}</p>}
					</div>
				)}
			</Dialog>
			<Confirm
				open={discard}
				onOpenChange={setDiscard}
				title="Discard this recording?"
				description="The recorded steps and any skill draft will be lost."
				confirmLabel="Discard"
				danger
				onConfirm={state.reset}
			/>
		</>
	);
}
