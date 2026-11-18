import { messageText } from "@sekai/shared";
import { actorFor, can, runAs } from "../auth/actor.ts";
import { agentOwner } from "../events/scope.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { createConversation, getConversation } from "../services/conversations.ts";
import { readKey, writeKey } from "../services/kv.ts";
import { createMessage, listMessages, updateMessage } from "../services/messages.ts";
import { dropClient, setLastMention, storedAccount, xAgents, xClient } from "./accounts.ts";

const POLL_MS = 60_000;
const MAX_REPLY = 280;

interface MentionTweet {
	id: string;
	text?: string;
	user?: { id?: string; username?: string } | null;
	retweeting?: unknown;
	tombstone?: boolean;
}

/** Post ids are 64-bit numbers: compare them as such. */
const newer = (a: string, b: string | null) => !b || BigInt(a) > BigInt(b);

/**
 * Whether a mention may be answered: only people you allowed, checked by account id (handles can change), never
 * the bot itself, never reposts. This is the only gate: the model never sees anyone else's mentions.
 */
export function mayAnswer(t: MentionTweet, account: { userId: string; allowIds: string[] }): boolean {
	const author = t.user?.id ? String(t.user.id) : "";
	if (!author || author === account.userId) return false;
	if (t.tombstone || t.retweeting) return false;
	return account.allowIds.includes(author);
}

/** The @mentions at the start (the bot, and others in the thread) are dropped from what you wrote. */
export function mentionText(text: string): string {
	return text.replace(/^(\s*@\w{1,15})+\s*/, "").trim();
}

/** A reply that fits in one post: cut at a sentence end where possible. */
export function fitPost(text: string, max = MAX_REPLY): string {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	const cut = t.slice(0, max - 1);
	const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
	return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/** One chat per bot and person for mentions on X. */
async function chatFor(agentId: string, handle: string): Promise<string> {
	const k = `x.chat.${agentId}.${handle.toLowerCase()}`;
	const id = (await readKey(k)) as string | undefined;
	if (id && (await getConversation(id))) return id;
	const c = await createConversation({ kind: "direct", agentId, title: `X: @${handle}` });
	await writeKey(k, c.id);
	return c.id;
}

async function answer(agentId: string, tweet: MentionTweet, handle: string): Promise<void> {
	const { client } = await xClient(agentId);
	const author = tweet.user?.username ?? "someone";
	const conversationId = await chatFor(agentId, author);
	const question = mentionText(tweet.text ?? "") || "(just mentioned you)";
	const { enqueueRun, waitForRun } = await import("../agent/runtime.ts");
	const message = await createMessage({
		conversationId,
		sender: "user",
		parts: [{ type: "text", text: question }],
		meta: { trigger: "user", x: { postId: tweet.id, author } },
	});
	const run = await enqueueRun({
		agentId,
		conversationId,
		trigger: "user",
		sourceMessageId: message.id,
		rootMessageId: message.id,
	});
	const done = await waitForRun(run.id);
	if (done?.status !== "done") {
		log.warn(`x: no answer for @${author}'s mention (${done?.status ?? "gone"})`);
		return;
	}
	const reply = (await listMessages(conversationId, { after: message.createdAt })).find(
		(m) => m.runId === run.id && m.sender === "agent",
	);
	const text = reply ? fitPost(messageText(reply)) : "";
	if (!text) return;
	const res = (await client.tweets.create(text, { replyTo: tweet.id })) as {
		id?: string;
		errors?: { message?: string }[];
	};
	if (!res?.id) throw new Error(`X didn't post the reply: ${res?.errors?.[0]?.message ?? "no reason given"}`);
	if (reply) await updateMessage(reply.id, { meta: { ...reply.meta, x: { postId: res.id, author: handle } } });
	log.info(`x: answered @${author} (${tweet.id} → ${res.id})`);
}

async function poll(agentId: string): Promise<void> {
	const account = await storedAccount(agentId);
	if (!account?.answerMentions) return;
	const { client } = await xClient(agentId);
	const page = await client.notifications.timeline({ timeline_type: "Mentions", count: 40 });
	const seen = new Map<string, MentionTweet>();
	for (const t of [...page.tweets, ...page.notifications.flatMap((n) => n.tweets)] as MentionTweet[]) {
		if (t?.id) seen.set(String(t.id), t);
	}
	// Post ids are numeric strings; anything else is skipped rather than failing every poll.
	const tweets = [...seen.values()]
		.filter((t) => /^\d+$/.test(String(t.id)))
		.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
	const newest = tweets.at(-1)?.id ?? null;
	// First look: start from now, older mentions aren't answered.
	if (account.lastMentionId === null) {
		if (newest) await setLastMention(agentId, newest);
		else await setLastMention(agentId, "0");
		return;
	}
	for (const t of tweets) {
		if (!newer(t.id, account.lastMentionId)) continue;
		await setLastMention(agentId, t.id);
		account.lastMentionId = t.id;
		if (!mayAnswer(t, account)) {
			log.debug(`x: ignoring a mention from @${t.user?.username ?? "?"} (not allowed)`);
			continue;
		}
		// Not awaited: a reply waiting for an approval must not hold up checking every bot's mentions.
		// (Replies in one chat still go in order: runs queue per conversation.)
		void answer(agentId, t, account.handle).catch((err: unknown) =>
			log.warn(`x: couldn't answer @${t.user?.username}: ${errorMessage(err)}`),
		);
	}
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Bots whose X account was signed out, and when to check it again. */
const signedOut = new Map<string, number>();
const SIGNED_OUT_RETRY_MS = 30 * 60_000;

/** A new sign-in: check mentions again right away. */
export function clearSignedOut(agentId: string): void {
	signedOut.delete(agentId);
}
let busy = false;

async function tick(): Promise<void> {
	if (busy) return;
	busy = true;
	try {
		for (const agentId of await xAgents()) {
			// Signed out by X: try again now and then (a new auth_token clears this), not every minute.
			const wait = signedOut.get(agentId);
			if (wait && Date.now() < wait) continue;
			// As the bot's owner (their chats, their limits); not when their account is off or their role can't.
			const ownerId = await agentOwner(agentId);
			const actor = ownerId ? await actorFor(ownerId).catch(() => null) : null;
			if (!actor || !can("channels", actor)) continue;
			await runAs(actor, () => poll(agentId))
				.then(() => signedOut.delete(agentId))
				.catch((err: unknown) => {
					const e = err as { status?: number };
					const m = errorMessage(err);
					if (e.status === 401 || /auth|denied|log in|logged out|didn't accept|suspend|locked/i.test(m)) {
						dropClient(agentId, m);
						if (!signedOut.has(agentId))
							log.warn(
								`x: signed out of X (${m}); checking again every ${SIGNED_OUT_RETRY_MS / 60_000} minutes`,
							);
						signedOut.set(agentId, Date.now() + SIGNED_OUT_RETRY_MS);
						return;
					}
					log.warn(`x: checking mentions failed: ${m}`);
				});
		}
	} finally {
		busy = false;
	}
}

/** Checks every bot's X mentions once a minute. */
export function startXMentions(): void {
	if (timer) return;
	timer = setInterval(() => void tick(), POLL_MS);
	setTimeout(() => void tick(), 15_000);
}

export function stopXMentions(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
