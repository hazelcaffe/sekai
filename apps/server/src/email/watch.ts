import type { ImapFlow } from "imapflow";
import { actorFor, can, runAs } from "../auth/actor.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { describeMailError, imapClient } from "./connect.ts";
import { receive } from "./inbound.ts";
import { mailcowClient } from "./settings.ts";
import { clearStatus, credentialsOf, enabledAccountIds, setStatus, storedAccount, updateAccountRow } from "./store.ts";

/**
 * One IMAP connection per bot with an address, waiting on its inbox (IDLE, or asking every few minutes where the
 * server has no IDLE). It reconnects with a growing pause, and waits much longer after a wrong password.
 */

const MAX_SIZE = 40 * 1024 * 1024;
const POLL_MS = 2 * 60_000;
const FULL_CHECK_MS = 30 * 60_000;
const MAX_PER_PASS = 50;

class Watcher {
	private client: ImapFlow | null = null;
	private stopped = false;
	private attempts = 0;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	private quota: ReturnType<typeof setInterval> | null = null;
	private chain: Promise<void> = Promise.resolve();

	constructor(readonly agentId: string) {}

	start(): void {
		void this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		if (this.poll) clearInterval(this.poll);
		if (this.quota) clearInterval(this.quota);
		const c = this.client;
		this.client = null;
		await c?.logout().catch(() => c.close());
		await this.chain;
	}

	/** Runs as the bot's owner (their chats, their limits); nothing when their account is off or their role can't. */
	private async asOwner<T>(fn: () => Promise<T>): Promise<T | null> {
		const ownerId = await agentOwner(this.agentId);
		const actor = ownerId ? await actorFor(ownerId).catch(() => null) : null;
		if (!actor || !can("channels", actor)) return null;
		return runAs(actor, fn);
	}

	private async connect(): Promise<void> {
		if (this.stopped) return;
		const account = await storedAccount(this.agentId);
		if (!account?.enabled) {
			setStatus(this.agentId, { state: "off", problem: null, error: null, live: false });
			return;
		}
		setStatus(this.agentId, { state: "connecting" });
		const client = await this.asOwner(() => imapClient(credentialsOf(account), { idle: true })).catch((err) => {
			this.closed(err);
			return null;
		});
		if (!client || this.stopped) return;
		client.on("error", (err: unknown) => log.warn(`email: ${account.address}: ${errorMessage(err)}`));
		client.on("close", () => {
			if (this.client === client) this.closed(null);
		});
		try {
			await client.connect();
			await client.mailboxOpen("INBOX");
		} catch (err) {
			await client.logout().catch(() => client.close());
			this.closed(err);
			return;
		}
		if (this.stopped) {
			await client.logout().catch(() => client.close());
			return;
		}
		this.client = client;
		this.attempts = 0;
		setStatus(this.agentId, {
			state: "connected",
			problem: null,
			error: null,
			live: client.capabilities.has("IDLE"),
		});
		log.info(
			`email: watching ${account.address}${client.capabilities.has("IDLE") ? "" : " (checking every 2 minutes)"}`,
		);
		client.on("exists", () => this.check());
		this.poll = setInterval(() => this.check(), POLL_MS);
		this.check();
		if (account.kind === "mailcow") {
			const check = () => void this.checkFull().catch(() => {});
			this.quota = setInterval(check, FULL_CHECK_MS);
			check();
		}
	}

	private closed(err: unknown): void {
		if (this.quota) clearInterval(this.quota);
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
		this.client = null;
		if (this.stopped) return;
		const { problem, message } = err
			? describeMailError(err, "IMAP")
			: { problem: "network" as const, message: "The connection to the mail server dropped." };
		this.attempts++;
		// A wrong password won't fix itself: try again in half an hour (or when it's saved again).
		const delay =
			problem === "auth" ? 30 * 60_000 : Math.min(15_000 * 2 ** Math.min(this.attempts - 1, 6), 15 * 60_000);
		setStatus(this.agentId, {
			state: problem === "auth" || this.attempts > 2 ? "error" : "connecting",
			problem,
			error: message,
		});
		if (this.attempts === 1 || problem === "auth") log.warn(`email: ${this.agentId}: ${message}`);
		this.retry = setTimeout(() => void this.connect(), delay);
	}

	/** New mail since the last one seen (one pass at a time). */
	private check(): void {
		this.chain = this.chain
			.then(() => this.asOwner(() => this.fetchNew()))
			.then(() => undefined)
			.catch((err: unknown) => log.warn(`email: checking ${this.agentId}'s inbox failed: ${errorMessage(err)}`));
	}

	private async fetchNew(): Promise<void> {
		const client = this.client;
		const account = await storedAccount(this.agentId);
		if (!client || !account || this.stopped) return;
		const box = client.mailbox;
		if (!box) return;
		const validity = String(box.uidValidity);
		// The first time (or after the server renumbered the folder): start from now, not the whole backlog.
		if (account.sync.uidValidity !== validity) {
			await updateAccountRow(this.agentId, { sync: { uidValidity: validity, lastUid: Number(box.uidNext) - 1 } });
			return;
		}
		let last = account.sync.lastUid;
		const found = await client.search({ uid: `${last + 1}:*` }, { uid: true });
		const uids = (Array.isArray(found) ? found : []).filter((u) => u > last).sort((a, b) => a - b);
		for (const uid of uids.slice(0, MAX_PER_PASS)) {
			if (this.stopped || this.client !== client) return;
			const meta = await client.fetchOne(String(uid), { size: true }, { uid: true });
			if (meta && (meta.size ?? 0) <= MAX_SIZE) {
				const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
				if (msg !== false && msg.source) {
					const fresh = await storedAccount(this.agentId);
					if (!fresh?.enabled || fresh.createdAt !== account.createdAt || this.stopped) return;
					await receive(fresh, {
						raw: new Uint8Array(msg.source),
						folder: "INBOX",
						uid,
						markSeen: async () => {
							await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
						},
					}).catch((err: unknown) =>
						log.warn(`email: message ${uid} in ${account.address}: ${errorMessage(err)}`),
					);
				}
			} else if (meta) log.warn(`email: skipped a message over 40 MB in ${account.address}`);
			last = uid;
			await updateAccountRow(this.agentId, { sync: { uidValidity: validity, lastUid: last } });
		}
		if (uids.length > MAX_PER_PASS) this.check();
	}

	/** A mailcow mailbox that's full says so on its page (mail bounces until there's room). */
	private async checkFull(): Promise<void> {
		if (!this.stopped && this.client) {
			const account = await storedAccount(this.agentId);
			if (account?.kind !== "mailcow") return;
			const mailcow = await mailcowClient();
			const box =
				mailcow && mailcow.base === account.mailcowUrl
					? await mailcow.getMailbox(account.address).catch(() => null)
					: null;
			if (box && box.quotaBytes > 0) {
				const full = box.usedBytes >= box.quotaBytes * 0.98;
				setStatus(
					this.agentId,
					full ? { problem: "full", error: "The mailbox is full." } : { problem: null, error: null },
				);
			}
		}
	}
}

const watchers = new Map<string, Watcher>();

/** (Re)starts a bot's inbox watcher with its saved account (after connecting, or new sign-in details). */
export async function restartWatcher(agentId: string): Promise<void> {
	await stopWatcher(agentId);
	const w = new Watcher(agentId);
	watchers.set(agentId, w);
	w.start();
}

export async function stopWatcher(agentId: string, opts: { forget?: boolean } = {}): Promise<void> {
	const w = watchers.get(agentId);
	watchers.delete(agentId);
	await w?.stop();
	if (opts.forget) clearStatus(agentId);
	else setStatus(agentId, { state: "off", live: false });
}

/** Starts watching every bot's inbox (at startup). */
export async function startEmail(): Promise<void> {
	for (const agentId of await enabledAccountIds()) void restartWatcher(agentId);
}

export async function stopEmail(): Promise<void> {
	await Promise.all([...watchers.keys()].map((id) => stopWatcher(id)));
}
