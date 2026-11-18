import { errorMessage } from "../lib/errors.ts";
import { createListener, type Listener } from "./listen.ts";
import { voiceFor } from "./settings.ts";

/** What the browser hears back while you dictate. */
export type DictationEvent =
	| { type: "ready"; live: boolean }
	| { type: "speech"; on: boolean }
	| { type: "partial"; itemId: string; text: string }
	| { type: "final"; itemId: string; text: string }
	| { type: "done" }
	| { type: "error"; message: string };

/**
 * Speech to text in the message box, with the dictation model of the chat's bot (or the default). Streaming
 * services show words as you talk; the others write each sentence down after you pause.
 */
export class Dictation {
	private ears: Listener | null = null;
	private stopped = false;
	private finished = false;

	constructor(
		private readonly emit: (ev: DictationEvent) => void,
		private readonly agentId: string | null = null,
	) {}

	async start(): Promise<void> {
		const v = await voiceFor(this.agentId);
		if (this.finished) return;
		try {
			const ears = await createListener(
				(ev) => {
					if (ev.type === "partial" && ev.text === "…") return;
					this.emit(ev);
				},
				{ model: v.sttModel, language: v.language, silenceMs: 650 },
			);
			this.ears = ears;
			// Closed while connecting: drop the listener instead of leaving it open.
			if (this.finished) return void ears.close();
			await ears.start();
			if (this.finished) return void ears.close();
		} catch (err) {
			this.emit({ type: "error", message: errorMessage(err) });
			this.finish();
			return;
		}
		this.emit({ type: "ready", live: true });
	}

	audio(pcm: Uint8Array): void {
		if (!this.stopped) this.ears?.audio(pcm);
	}

	/** You pressed stop: write down whatever is left, then finish. */
	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		void (this.ears?.flush() ?? Promise.resolve()).finally(() => this.finish());
	}

	private finish(): void {
		if (this.finished) return;
		this.finished = true;
		this.emit({ type: "done" });
		this.ears?.close();
	}

	close(): void {
		this.stopped = true;
		this.finished = true;
		this.ears?.close();
	}
}
