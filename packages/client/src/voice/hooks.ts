import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { type Mic, Player, startMic } from "./audio.ts";

// ---------------------------------------------------------------- dictation

export type DictationState = "idle" | "starting" | "listening" | "finishing";

/**
 * Speak instead of typing. While you talk, onText gets everything said so far (finished sentences plus the
 * one in progress); it settles on the final words when you stop.
 */
export function useDictation(onText: (text: string) => void, conversationId?: string | null) {
	const [state, setState] = useState<DictationState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [speaking, setSpeaking] = useState(false);
	const mic = useRef<Mic | null>(null);
	const ws = useRef<WebSocket | null>(null);
	const finals = useRef<{ id: string; text: string }[]>([]);
	const partial = useRef<{ id: string; text: string } | null>(null);
	const onTextRef = useRef(onText);
	onTextRef.current = onText;

	const publish = useCallback(() => {
		const parts = finals.current.map((f) => f.text);
		if (partial.current?.text) parts.push(partial.current.text);
		onTextRef.current(parts.filter(Boolean).join(" "));
	}, []);

	const cleanup = useCallback(() => {
		mic.current?.stop();
		mic.current = null;
		const s = ws.current;
		ws.current = null;
		if (s && s.readyState <= 1) s.close();
		setState("idle");
		setSpeaking(false);
	}, []);

	const start = useCallback(async () => {
		if (ws.current) return;
		setError(null);
		setState("starting");
		finals.current = [];
		partial.current = null;
		const socket = new WebSocket(api.voice.dictateUrl(conversationId));
		socket.binaryType = "arraybuffer";
		ws.current = socket;
		// The mic starts with the click; what you say before the server is ready waits here.
		let ready = false;
		const early: ArrayBuffer[] = [];
		startMic((pcm) => {
			if (ready && socket.readyState === 1) socket.send(pcm);
			else if (early.length < 250) early.push(pcm);
		})
			.then((m) => {
				if (ws.current !== socket) return m.stop();
				mic.current = m;
				setState((st) => (st === "starting" ? "listening" : st));
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
				cleanup();
			});
		socket.onmessage = (e) => {
			if (typeof e.data !== "string") return;
			const ev = JSON.parse(e.data) as {
				type: string;
				itemId?: string;
				text?: string;
				on?: boolean;
				message?: string;
			};
			if (ev.type === "ready") {
				ready = true;
				for (const chunk of early.splice(0)) socket.send(chunk);
			} else if (ev.type === "speech") setSpeaking(Boolean(ev.on));
			else if (ev.type === "partial" && ev.itemId) {
				partial.current = { id: ev.itemId, text: ev.text ?? "" };
				publish();
			} else if (ev.type === "final" && ev.itemId) {
				if (partial.current?.id === ev.itemId) partial.current = null;
				if (ev.text) finals.current.push({ id: ev.itemId, text: ev.text });
				publish();
			} else if (ev.type === "error") setError(ev.message ?? "Dictation failed");
			else if (ev.type === "done") cleanup();
		};
		socket.onclose = (e) => {
			if (ws.current === socket) {
				// The server's own message (sent just before it closed) says more than this.
				if (e.code !== 1000 && e.code !== 1005)
					setError(
						(was) =>
							was ?? (e.reason || "Couldn't reach dictation. Check the voice setup in Admin → Voice."),
					);
				cleanup();
			}
		};
	}, [cleanup, publish, conversationId]);

	const stop = useCallback(() => {
		const socket = ws.current;
		if (!socket) return;
		mic.current?.stop();
		mic.current = null;
		setState("finishing");
		setSpeaking(false);
		if (socket.readyState === 1) socket.send(JSON.stringify({ type: "stop" }));
		else cleanup();
	}, [cleanup]);

	const level = useCallback(() => mic.current?.level() ?? 0, []);

	useEffect(() => cleanup, [cleanup]);
	return { state, error, speaking, start, stop, cancel: cleanup, level, clearError: () => setError(null) };
}

// ---------------------------------------------------------------- calls

export type CallStatus = "connecting" | "listening" | "thinking" | "speaking" | "working" | "ended";

export interface CallLine {
	id: string;
	who: "you" | "bot";
	text: string;
	final: boolean;
}

/** A voice call with the bot of a chat (ring: answering the bot's call to you). */
export function useCall(conversationId: string | null, ring?: string | null) {
	const [status, setStatus] = useState<CallStatus>("ended");
	const [label, setLabel] = useState<string | null>(null);
	const [lines, setLines] = useState<CallLine[]>([]);
	const [muted, setMuted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** No microphone (or it's blocked): the call goes on, and you type. */
	const [micError, setMicError] = useState<string | null>(null);
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const ws = useRef<WebSocket | null>(null);
	const mic = useRef<Mic | null>(null);
	const player = useRef<Player | null>(null);
	const mutedRef = useRef(false);

	const teardown = useCallback(() => {
		mic.current?.stop();
		mic.current = null;
		player.current?.close();
		player.current = null;
		const s = ws.current;
		ws.current = null;
		if (s && s.readyState <= 1) s.close(1000);
		setStatus("ended");
		setStartedAt(null);
	}, []);

	const upsert = useCallback((line: CallLine) => {
		setLines((all) => {
			const i = all.findIndex((l) => l.id === line.id && l.who === line.who);
			if (i < 0) return [...all, line].slice(-30);
			const next = [...all];
			next[i] = line;
			return next;
		});
	}, []);

	const start = useCallback(async () => {
		if (!conversationId || ws.current) return;
		setError(null);
		setMicError(null);
		setLines([]);
		setMuted(false);
		mutedRef.current = false;
		setStatus("connecting");
		setLabel(null);
		const p = new Player();
		player.current = p;
		// Must happen in the click that started the call, or the browser keeps the speaker muted.
		await p.resume();
		const socket = new WebSocket(api.voice.callUrl(conversationId, ring));
		socket.binaryType = "arraybuffer";
		ws.current = socket;
		let ready = false;
		const early: ArrayBuffer[] = [];
		startMic((pcm) => {
			if (mutedRef.current) return;
			if (ready && socket.readyState === 1) socket.send(pcm);
			else if (early.length < 250) early.push(pcm);
		})
			.then((m) => {
				if (ws.current !== socket) return m.stop();
				mic.current = m;
			})
			.catch((err: unknown) => {
				// Keep calling: you can type, and the bot still answers out loud.
				setMicError(err instanceof Error ? err.message : String(err));
			});
		socket.onmessage = (e) => {
			if (typeof e.data !== "string") {
				player.current?.play(e.data as ArrayBuffer);
				return;
			}
			const ev = JSON.parse(e.data) as {
				type: string;
				state?: CallStatus;
				label?: string;
				itemId?: string;
				text?: string;
				final?: boolean;
				message?: string;
				reason?: string;
			};
			switch (ev.type) {
				case "ready":
					setStartedAt(Date.now());
					ready = true;
					for (const chunk of early.splice(0)) socket.send(chunk);
					break;
				case "state":
					if (ev.state) setStatus(ev.state);
					setLabel(ev.label ?? null);
					break;
				case "audio":
					if (ev.itemId) player.current?.startItem(ev.itemId);
					break;
				case "interrupt": {
					const heard = player.current?.interrupt();
					if (heard && socket.readyState === 1) socket.send(JSON.stringify({ type: "played", ...heard }));
					break;
				}
				case "you":
				case "bot":
					if (ev.itemId)
						upsert({ id: ev.itemId, who: ev.type, text: ev.text ?? "", final: Boolean(ev.final) });
					break;
				case "error":
					setError(ev.message ?? "Something went wrong on the call");
					break;
				case "ended":
					// Let the goodbye play out.
					setTimeout(teardown, 1200);
					break;
			}
		};
		socket.onclose = (e) => {
			if (ws.current !== socket) return;
			if (e.code !== 1000 && e.code !== 1005) {
				setError((was) => was ?? (e.reason || "The call dropped. Check the voice setup in Admin → Voice."));
			}
			teardown();
		};
	}, [conversationId, ring, teardown, upsert]);

	const hangUp = useCallback(() => {
		const s = ws.current;
		if (s?.readyState === 1) s.send(JSON.stringify({ type: "hangup" }));
		teardown();
	}, [teardown]);

	const toggleMute = useCallback(() => {
		const next = !mutedRef.current;
		mutedRef.current = next;
		setMuted(next);
		const s = ws.current;
		if (s?.readyState === 1) s.send(JSON.stringify({ type: "mute", on: next }));
	}, []);

	/** Type instead of talking: the bot hears it and answers out loud. */
	const sendText = useCallback((text: string) => {
		const s = ws.current;
		const line = text.trim();
		if (!line || s?.readyState !== 1) return false;
		player.current?.interrupt();
		s.send(JSON.stringify({ type: "say", text: line }));
		return true;
	}, []);

	const levels = useCallback(
		() => ({ you: mutedRef.current ? 0 : (mic.current?.level() ?? 0), bot: player.current?.level() ?? 0 }),
		[],
	);

	useEffect(() => teardown, [teardown]);
	return {
		status,
		label,
		lines,
		muted,
		error,
		micError,
		startedAt,
		start,
		hangUp,
		toggleMute,
		sendText,
		levels,
		active: status !== "ended",
	};
}

// ---------------------------------------------------------------- reading aloud

type ReadAloud = { messageId: string; phase: "loading" | "playing" } | null;

let reading: ReadAloud = null;
let readAbort: AbortController | null = null;
let readPlayer: Player | null = null;
let readError: ((message: string) => void) | null = null;
const readListeners = new Set<() => void>();
const setReading = (r: ReadAloud) => {
	reading = r;
	for (const l of readListeners) l();
};

function stopReading(): void {
	readAbort?.abort();
	readAbort = null;
	readPlayer?.close();
	readPlayer = null;
	setReading(null);
}

/** Plays a message in its bot's voice, streaming (it starts before the whole thing is made). */
async function readAloud(messageId: string): Promise<void> {
	if (reading?.messageId === messageId) return stopReading();
	stopReading();
	const abort = new AbortController();
	const player = new Player();
	readAbort = abort;
	readPlayer = player;
	setReading({ messageId, phase: "loading" });
	try {
		// In the click: browsers only start audio from a user action.
		await player.resume();
		const res = await api.voice.messageSpeech(messageId, abort.signal);
		const reader = res.body?.getReader();
		if (!reader) throw new Error("No audio came back");
		let carry: number | null = null;
		for (;;) {
			const { done, value } = await reader.read();
			if (done || abort.signal.aborted) break;
			let bytes = value;
			if (carry !== null) {
				const merged = new Uint8Array(bytes.length + 1);
				merged[0] = carry;
				merged.set(bytes, 1);
				bytes = merged;
				carry = null;
			}
			if (bytes.length % 2) {
				carry = bytes[bytes.length - 1] ?? 0;
				bytes = bytes.subarray(0, bytes.length - 1);
			}
			if (!bytes.length) continue;
			player.play(bytes.slice().buffer);
			if (reading?.phase === "loading") setReading({ messageId, phase: "playing" });
		}
		// Wait for the last words to play.
		while (!abort.signal.aborted && player.playing) await new Promise((r) => setTimeout(r, 150));
		if (readPlayer === player) stopReading();
	} catch (err) {
		if (abort.signal.aborted) return;
		stopReading();
		readError?.(err instanceof Error ? err.message : String(err));
	}
}

/** Read-aloud state for one message, and a toggle (one message plays at a time, app-wide). */
export function useReadAloud(messageId: string, onError?: (message: string) => void) {
	const state = useSyncExternalStore(
		(l) => {
			readListeners.add(l);
			return () => readListeners.delete(l);
		},
		() => (reading?.messageId === messageId ? reading.phase : "idle"),
	);
	const toggle = useCallback(() => {
		readError = onError ?? null;
		void readAloud(messageId);
	}, [messageId, onError]);
	return { state, toggle, stop: stopReading };
}

// ---------------------------------------------------------------- voice messages

/** 16-bit mono PCM to a WAV file. */
export function pcmToWavBlob(chunks: ArrayBuffer[], rate = 24_000): Blob {
	const size = chunks.reduce((n, c) => n + c.byteLength, 0);
	const header = new DataView(new ArrayBuffer(44));
	const w = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) header.setUint8(at + i, s.charCodeAt(i));
	};
	w(0, "RIFF");
	header.setUint32(4, 36 + size, true);
	w(8, "WAVE");
	w(12, "fmt ");
	header.setUint32(16, 16, true);
	header.setUint16(20, 1, true);
	header.setUint16(22, 1, true);
	header.setUint32(24, rate, true);
	header.setUint32(28, rate * 2, true);
	header.setUint16(32, 2, true);
	header.setUint16(34, 16, true);
	w(36, "data");
	header.setUint32(40, size, true);
	return new Blob([header.buffer, ...chunks], { type: "audio/wav" });
}

/** Records a voice message from the microphone. stop() gives the recording (WAV), cancel() drops it. */
export function useVoiceRecorder() {
	const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
	const [error, setError] = useState<string | null>(null);
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const mic = useRef<Mic | null>(null);
	const chunks = useRef<ArrayBuffer[]>([]);
	/** Bumped by every start and cancel: a start still waiting for permission after a cancel is dropped. */
	const attempt = useRef(0);

	const start = useCallback(async () => {
		if (mic.current) return;
		const mine = ++attempt.current;
		setError(null);
		setState("starting");
		chunks.current = [];
		try {
			const m = await startMic((pcm) => chunks.current.push(pcm));
			if (mine !== attempt.current) {
				m.stop();
				return;
			}
			mic.current = m;
			setStartedAt(Date.now());
			setState("recording");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("idle");
		}
	}, []);
	const finish = useCallback(() => {
		attempt.current++;
		mic.current?.stop();
		mic.current = null;
		setState("idle");
		setStartedAt(null);
	}, []);
	const stop = useCallback((): Blob | null => {
		finish();
		const recorded = chunks.current;
		chunks.current = [];
		const bytes = recorded.reduce((n, c) => n + c.byteLength, 0);
		return bytes > 24_000 ? pcmToWavBlob(recorded) : null;
	}, [finish]);
	const cancel = useCallback(() => {
		finish();
		chunks.current = [];
	}, [finish]);
	const level = useCallback(() => mic.current?.level() ?? 0, []);
	useEffect(() => cancel, [cancel]);
	return { state, error, startedAt, start, stop, cancel, level, clearError: () => setError(null) };
}
