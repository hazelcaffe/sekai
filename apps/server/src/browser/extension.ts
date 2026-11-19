import type {
	ExtensionAction,
	ExtensionCommand,
	ExtensionConnect,
	ExtensionResult,
	ExtensionSession,
} from "@sekai/shared";
import { newId } from "../lib/ids.ts";

interface Pending {
	command: ExtensionCommand;
	delivered: boolean;
	started: boolean;
	finish: (result?: ExtensionResult, error?: string) => void;
}

interface Connection {
	info: ExtensionSession;
	userId: string;
	tokenId: string;
	seen: number;
	pending?: Pending;
}

export const EXTENSION_LEASE_MS = 12_000;

/** In-memory, short-lived grants. A server restart, closed panel or lost connection never restores control. */
export class ExtensionBroker {
	private connections = new Map<string, Connection>();

	private prune(): void {
		for (const [id, c] of this.connections) {
			if (Date.now() - c.seen > EXTENSION_LEASE_MS) this.remove(id);
		}
	}

	connect(userId: string, tokenId: string, input: ExtensionConnect): ExtensionSession {
		this.prune();
		if (this.connections.size >= 2000 || this.list(userId).length >= 10) {
			throw new Error("Too many browser panels are sharing. Stop sharing in another panel first.");
		}
		const info = { ...input, id: newId("ext") };
		this.connections.set(info.id, { info, userId, tokenId, seen: Date.now() });
		return info;
	}

	list(userId: string, agentId?: string, conversationId?: string): ExtensionSession[] {
		this.prune();
		return [...this.connections.values()]
			.filter(
				(c) =>
					c.userId === userId &&
					(!agentId || c.info.agentId === agentId) &&
					(!conversationId || c.info.conversationId === conversationId),
			)
			.map((c) => c.info);
	}

	private owned(userId: string, tokenId: string, id: string): Connection {
		this.prune();
		const c = this.connections.get(id);
		if (!c || c.userId !== userId || c.tokenId !== tokenId)
			throw new Error("Browser connection not found. Share a tab again.");
		return c;
	}

	poll(userId: string, tokenId: string, id: string): ExtensionCommand | null {
		const c = this.owned(userId, tokenId, id);
		c.seen = Date.now();
		if (!c.pending || c.pending.delivered) return null;
		c.pending.delivered = true;
		return c.pending.command;
	}

	complete(userId: string, tokenId: string, id: string, result: ExtensionResult): boolean {
		const c = this.owned(userId, tokenId, id);
		if (!c.pending?.delivered || c.pending.command.id !== result.commandId) return false;
		if (result.image && c.pending.command.input.action !== "screenshot") return false;
		c.pending.finish(result);
		return true;
	}

	claim(userId: string, tokenId: string, id: string, commandId: string): boolean {
		const pending = this.owned(userId, tokenId, id).pending;
		if (
			!pending?.delivered ||
			pending.started ||
			pending.command.id !== commandId ||
			pending.command.expiresAt <= Date.now()
		)
			return false;
		// Claim once, immediately before acting (including after a local new-tab confirmation).
		pending.started = true;
		return true;
	}

	disconnect(userId: string, tokenId: string, id: string): void {
		this.owned(userId, tokenId, id);
		this.remove(id);
	}

	private remove(id: string): void {
		const c = this.connections.get(id);
		c?.pending?.finish(undefined, "Browser sharing stopped. Don't retry actions without checking the page.");
		this.connections.delete(id);
	}

	async command(
		userId: string,
		agentId: string,
		conversationId: string,
		id: string,
		input: ExtensionAction,
		signal: AbortSignal,
	): Promise<ExtensionResult> {
		this.prune();
		const c = this.connections.get(id);
		if (!c || c.userId !== userId || c.info.agentId !== agentId || c.info.conversationId !== conversationId) {
			throw new Error(
				"No browser is shared with you in this chat. Ask the user to open the extension and share a tab here.",
			);
		}
		if (c.pending) throw new Error("Another browser action is running. Wait for its result first.");
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() =>
					finish(
						undefined,
						"The browser did not answer. Check the page before retrying: the action may have happened.",
					),
				30_000,
			);
			const abort = () => finish(undefined, "The browser action was cancelled. Check the page before retrying.");
			const finish = (result?: ExtensionResult, error?: string) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				c.pending = undefined;
				if (error) reject(new Error(error));
				else if (result) resolve(result);
			};
			c.pending = {
				command: { id: newId("exc"), input, expiresAt: Date.now() + 30_000 },
				delivered: false,
				started: false,
				finish,
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

export const extensionBroker = new ExtensionBroker();
