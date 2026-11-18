import type { AdvisorPart, Message, MessagePart, ToolPart } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { recordActivity } from "../services/activity.ts";
import { updateMessage } from "../services/messages.ts";

const PERSIST_INTERVAL_MS = 800;

/**
 * Owns the parts of one streaming assistant message. Text arrives as deltas (broadcast immediately),
 * structural changes as whole parts. The database copy is refreshed at most every PERSIST_INTERVAL_MS.
 */
export class MessageWriter {
	readonly parts: MessagePart[];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;

	constructor(readonly message: Message) {
		this.parts = structuredClone(message.parts);
	}

	get id(): string {
		return this.message.id;
	}

	private emitPart(index: number): void {
		const part = this.parts[index];
		if (!part) return;
		bus.emit({
			type: "message.part",
			conversationId: this.message.conversationId,
			messageId: this.message.id,
			index,
			part,
		});
		this.schedulePersist();
	}

	private emitDelta(index: number, delta: string): void {
		bus.emit({
			type: "message.delta",
			conversationId: this.message.conversationId,
			messageId: this.message.id,
			index,
			delta,
		});
		this.schedulePersist();
	}

	private schedulePersist(): void {
		this.dirty = true;
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.persist();
		}, PERSIST_INTERVAL_MS);
	}

	private async persist(): Promise<void> {
		if (!this.dirty) return;
		this.dirty = false;
		await updateMessage(this.message.id, { parts: this.parts }, { emit: false });
	}

	addPart(part: MessagePart): number {
		this.parts.push(part);
		const index = this.parts.length - 1;
		this.emitPart(index);
		return index;
	}

	setPart(index: number, part: MessagePart): void {
		this.parts[index] = part;
		this.emitPart(index);
	}

	appendText(delta: string): void {
		if (!delta) return;
		const last = this.parts.at(-1);
		this.closeReasoning();
		if (last?.type === "text") {
			last.text += delta;
			this.emitDelta(this.parts.length - 1, delta);
		} else {
			this.addPart({ type: "text", text: delta });
		}
	}

	appendReasoning(delta: string): void {
		if (!delta) return;
		const last = this.parts.at(-1);
		if (last?.type === "reasoning" && last.endedAt === undefined) {
			last.text += delta;
			this.emitDelta(this.parts.length - 1, delta);
		} else {
			this.addPart({ type: "reasoning", text: delta, startedAt: Date.now() });
		}
	}

	/** Marks the open reasoning block as finished so the UI can show "Thought for Ns". */
	closeReasoning(): void {
		const last = this.parts.at(-1);
		if (last?.type === "reasoning" && last.endedAt === undefined) {
			last.endedAt = Date.now();
			this.emitPart(this.parts.length - 1);
		}
	}

	addAdvisor(part: Omit<AdvisorPart, "type">): number {
		return this.addPart({ type: "advisor", ...part });
	}

	appendAdvisor(index: number, delta: string): void {
		const part = this.parts[index];
		if (part?.type !== "advisor" || !delta) return;
		part.text += delta;
		this.emitDelta(index, delta);
	}

	updateAdvisor(index: number, patch: Partial<AdvisorPart>): void {
		const part = this.parts[index];
		if (part?.type !== "advisor") return;
		this.setPart(index, { ...part, ...patch });
	}

	addTool(part: Omit<ToolPart, "type">): number {
		this.closeReasoning();
		const index = this.addPart({ type: "tool", ...part });
		this.logTool({ type: "tool", ...part });
		return index;
	}

	updateTool(id: string, patch: Partial<ToolPart>): void {
		const index = this.parts.findIndex((p) => p.type === "tool" && p.id === id);
		const part = this.parts[index];
		if (part?.type !== "tool") return;
		const next = { ...part, ...patch };
		this.setPart(index, next);
		this.logTool(next);
	}

	/** Tool calls already in the activity log (each goes in once, when it ends). */
	private logged = new Set<string>();

	private logTool(part: ToolPart): void {
		if (this.logged.has(part.id) || (part.status !== "done" && part.status !== "error" && part.status !== "denied"))
			return;
		this.logged.add(part.id);
		recordActivity(this.message, part);
	}

	/**
	 * Blanks text and reasoning written from this part on (a refused attempt) so neither you nor the next model
	 * sees the refusal. Tool calls that already ran stay.
	 */
	discardFrom(index: number): void {
		for (let i = index; i < this.parts.length; i++) {
			const p = this.parts[i];
			if (p?.type === "text" && p.text) this.setPart(i, { ...p, text: "" });
			else if (p?.type === "reasoning" && p.text)
				this.setPart(i, { ...p, text: "", endedAt: p.endedAt ?? Date.now() });
		}
	}

	notice(level: "info" | "warning" | "error", text: string): void {
		this.addPart({ type: "notice", level, text });
	}

	/** Text produced so far, for previews, handoff parsing and reflection. */
	text(): string {
		return this.parts
			.filter((p) => p.type === "text")
			.map((p) => (p.type === "text" ? p.text : ""))
			.join("")
			.trim();
	}

	async finish(patch: Parameters<typeof updateMessage>[1]): Promise<Message> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.closeReasoning();
		// Tools left mid-flight (cancel/crash) shouldn't look like they're still running.
		for (const p of this.parts) {
			if (
				p.type === "tool" &&
				(p.status === "running" || p.status === "pending" || p.status === "awaiting_approval")
			) {
				p.status = "error";
				p.error = p.error ?? "Interrupted";
				p.endedAt = Date.now();
				this.logTool(p);
			}
			if (p.type === "advisor" && p.status === "running") p.status = "error";
		}
		return updateMessage(this.message.id, { ...patch, parts: this.parts });
	}
}
