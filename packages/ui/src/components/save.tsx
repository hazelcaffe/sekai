import { Check } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../shadcn/button.tsx";
import { Spinner } from "./misc.tsx";
import { Confirm } from "./overlay.tsx";
import { errorMessage } from "./states.tsx";

/*
 * Saving, two kinds and nothing else (DESIGN.md "Saving"):
 * - Simple values save themselves: useAutosave + SaveState next to the section title.
 * - Everything else is a FormGroup with an explicit Save (Connect, Test) and Cancel; leaving with unsaved changes
 *   asks first (useUnsavedChanges, LeaveConfirm).
 * No floating "unsaved changes" bars, no "Saved" toasts.
 */

// ---------------------------------------------------------------- unsaved changes

const dirtyForms = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => {
	for (const l of listeners) l();
};

function onBeforeUnload(e: BeforeUnloadEvent) {
	if (!dirtyForms.size) return;
	e.preventDefault();
	// Older browsers want a returnValue to show their "Leave site?" prompt.
	e.returnValue = "";
}

/** Registers unsaved changes while `dirty`: the browser asks before closing the tab, and hasUnsavedChanges() says so. */
export function useUnsavedChanges(dirty: boolean): void {
	const id = useId();
	useEffect(() => {
		if (!dirty) return;
		dirtyForms.add(id);
		if (dirtyForms.size === 1) window.addEventListener("beforeunload", onBeforeUnload);
		notify();
		return () => {
			dirtyForms.delete(id);
			if (dirtyForms.size === 0) window.removeEventListener("beforeunload", onBeforeUnload);
			notify();
		};
	}, [dirty, id]);
}

/** Whether any form on screen has unsaved changes (for a router's blocker, or closing a panel). */
export function hasUnsavedChanges(): boolean {
	return dirtyForms.size > 0;
}

/** hasUnsavedChanges(), live. */
export function useHasUnsavedChanges(): boolean {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => dirtyForms.size > 0,
		() => false,
	);
}

/**
 * "Leave without saving?": the app shows it when its router blocks a navigation because hasUnsavedChanges() (with
 * react-router: useBlocker(hasUnsavedChanges), then open = blocker.state === "blocked").
 */
export function LeaveConfirm({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
	return (
		<Confirm
			open={open}
			onOpenChange={(o) => {
				if (!o) onStay();
			}}
			title="Leave without saving?"
			description="Your changes on this page haven't been saved and will be lost."
			cancelLabel="Keep editing"
			confirmLabel="Leave"
			danger
			onConfirm={onLeave}
		/>
	);
}

// ---------------------------------------------------------------- explicit saving: FormGroup

/**
 * A form's values, and whether they differ from what's saved. When `saved` changes (the server's copy, after a save
 * or a live update) and nothing's been edited, the form follows it.
 */
export function useFormValues<T extends object>(saved: T) {
	const savedKey = JSON.stringify(saved);
	const [values, setValues] = useState<T>(saved);
	const [base, setBase] = useState(savedKey);
	const dirty = JSON.stringify(values) !== base;
	if (savedKey !== base && !dirty) {
		// Render-time sync (React's recommended way to reset state from props).
		setBase(savedKey);
		setValues(saved);
	}
	return {
		values,
		dirty,
		/** Changes one value. */
		set: <K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value })),
		setValues,
		/** Back to what's saved (Cancel), or to new saved values. */
		reset: (next: T = saved) => {
			setBase(JSON.stringify(next));
			setValues(next);
		},
	};
}

export interface FormGroupProps {
	children: ReactNode;
	/** Something changed: Save is enabled and leaving asks first. */
	dirty: boolean;
	/** Saves. A rejected promise shows its error under the fields and keeps what was typed. */
	onSubmit: () => unknown;
	/** Puts the saved values back. Cancel shows while there are changes. */
	onCancel?: () => void;
	/** The button's word: "Save", "Connect", "Add"… */
	submitLabel?: string;
	/** More actions beside Save (a "Test" button). */
	extra?: ReactNode;
	/** An error from outside (for example a test that failed). */
	error?: string | null;
	/** Save allowed even without changes (a first "Connect"). */
	submitWhenClean?: boolean;
	disabled?: boolean;
	className?: string;
}

/**
 * Settings that need an explicit button: credentials, connections, policies, longer text. One Save (or Connect…)
 * at the bottom, enabled when something changed, with Cancel. Leaving with unsaved changes asks first.
 */
export function FormGroup({
	children,
	dirty,
	onSubmit,
	onCancel,
	submitLabel = "Save",
	extra,
	error: outsideError,
	submitWhenClean,
	disabled,
	className,
}: FormGroupProps) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	useUnsavedChanges(dirty);
	useEffect(() => {
		// Back to what's saved (Cancel, or the changes undone by hand): a failed save's error no longer applies.
		if (dirty) setSaved(false);
		else setError(null);
	}, [dirty]);
	useEffect(() => {
		if (!saved) return;
		const t = setTimeout(() => setSaved(false), 2500);
		return () => clearTimeout(t);
	}, [saved]);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (saving || disabled || (!dirty && !submitWhenClean)) return;
		setSaving(true);
		setError(null);
		try {
			await onSubmit();
			setSaved(true);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setSaving(false);
		}
	};
	const shown = outsideError ?? error;
	return (
		<form data-slot="form-group" onSubmit={submit} className={cn("flex flex-col gap-4", className)} noValidate>
			{children}
			{shown && (
				<p role="alert" className="text-small text-danger-ink">
					{shown}
				</p>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2">
				<span role="status" className="mr-auto text-small text-fg-subtle">
					{saved && !dirty ? "Saved" : ""}
				</span>
				{extra}
				{onCancel && dirty && (
					<Button
						variant="ghost"
						onClick={() => {
							setError(null);
							onCancel();
						}}
						disabled={saving}
					>
						Cancel
					</Button>
				)}
				<Button
					type="submit"
					variant="primary"
					loading={saving}
					disabled={disabled || (!dirty && !submitWhenClean)}
				>
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}

// ---------------------------------------------------------------- saving by itself: useAutosave and SaveState

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface Autosave<T> {
	status: SaveStatus;
	error: unknown;
	/** Saves a value. One write at a time: while one is on its way, only the latest value waits for it. */
	save: (value: T) => void;
	/** Sends the value that failed again. */
	retry: () => void;
}

/**
 * Simple values that save themselves (switches, selects, a name on blur or Enter): writes one at a time, says
 * "Saving…" then "Saved" (SaveState), and on failure keeps the value and offers Try again. The caller keeps its own
 * input state, so nothing typed is lost.
 */
export function useAutosave<T>(
	write: (value: T) => Promise<unknown>,
	{ savedFor = 2000 }: { savedFor?: number } = {},
): Autosave<T> {
	const [status, setStatus] = useState<SaveStatus>("idle");
	const [error, setError] = useState<unknown>(null);
	const writeRef = useRef(write);
	writeRef.current = write;
	const busy = useRef(false);
	const pending = useRef<{ value: T } | null>(null);
	const failed = useRef<{ value: T } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const alive = useRef(true);
	useEffect(() => {
		// Set again on mount: StrictMode mounts, unmounts and mounts again, which would leave it false.
		alive.current = true;
		return () => {
			alive.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);

	const run = useCallback(
		async (value: T) => {
			busy.current = true;
			if (timer.current) clearTimeout(timer.current);
			setStatus("saving");
			setError(null);
			try {
				await writeRef.current(value);
				failed.current = null;
				if (!alive.current) return;
				if (!pending.current) {
					setStatus("saved");
					timer.current = setTimeout(() => setStatus("idle"), savedFor);
				}
			} catch (err) {
				failed.current = { value };
				if (!alive.current) return;
				if (!pending.current) {
					setStatus("error");
					setError(err);
				}
			} finally {
				busy.current = false;
				const next = pending.current;
				pending.current = null;
				if (next) void run(next.value);
			}
		},
		[savedFor],
	);

	const save = useCallback(
		(value: T) => {
			if (busy.current) pending.current = { value };
			else void run(value);
		},
		[run],
	);
	const retry = useCallback(() => {
		const f = failed.current;
		if (f) save(f.value);
	}, [save]);
	return { status, error, save, retry };
}

/**
 * "Saving…", "Saved", or what went wrong with Try again; next to a section's title (Section's `saveState`).
 * Announced to screen readers without moving focus.
 */
export function SaveState({
	state,
	className,
}: {
	state: Pick<Autosave<unknown>, "status" | "error" | "retry">;
	className?: string;
}) {
	const { status, error, retry } = state;
	return (
		<span
			role="status"
			data-slot="save-state"
			className={cn("inline-flex min-h-5 items-center gap-1.5 text-small font-normal", className)}
		>
			{status === "saving" && (
				<>
					<Spinner />
					<span className="text-fg-subtle">Saving…</span>
				</>
			)}
			{status === "saved" && (
				<>
					<Check aria-hidden className="size-4 text-success-ink" />
					<span className="text-fg-subtle">Saved</span>
				</>
			)}
			{status === "error" && (
				<>
					<span className="text-danger-ink">Couldn't save. {errorMessage(error)}</span>
					<button
						type="button"
						onClick={retry}
						className="font-medium text-brand-ink underline-offset-2 hover:underline"
					>
						Try again
					</button>
				</>
			)}
		</span>
	);
}
