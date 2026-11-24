import type { ImapFlow, SearchObject } from "imapflow";
import { withImap } from "./connect.ts";
import { judgeSender } from "./inbound.ts";
import { type ParsedEmail, parseEmail } from "./parse.ts";
import { credentialsOf, type StoredAccount } from "./store.ts";

/** A bot's mailbox for its tools: list and search folders, read a message, mark, archive or delete. */

export interface MailRef {
	folder: string;
	uid: number;
}

/** "INBOX:42" (or "Archive:7") ⇄ a folder and UID. */
export const refId = (r: MailRef) => `${r.folder}:${r.uid}`;

export function parseRef(id: string): MailRef | null {
	const at = id.lastIndexOf(":");
	const uid = Number(id.slice(at + 1));
	if (at <= 0 || !Number.isInteger(uid) || uid <= 0) return null;
	return { folder: id.slice(0, at), uid };
}

export interface MailSummary {
	id: string;
	from: string;
	fromName: string;
	to: string[];
	subject: string;
	date: string | null;
	unread: boolean;
	flagged: boolean;
	/** On the bot's list of people it answers (not yet checked for spoofing: email_read does that). */
	fromAllowed: boolean;
	messageId: string | null;
}

export interface SearchQuery {
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	text?: string;
	since?: string;
	before?: string;
	unread?: boolean;
	flagged?: boolean;
	limit?: number;
}

/** The folder with this special use (\Archive, \Trash, \Junk, \Sent), or one named like it. */
async function specialFolder(client: ImapFlow, use: string, names: RegExp): Promise<string | null> {
	const boxes = await client.list();
	return (boxes.find((b) => b.specialUse === use) ?? boxes.find((b) => names.test(b.name)))?.path ?? null;
}

export async function folders(account: StoredAccount): Promise<string[]> {
	return withImap(credentialsOf(account), async (client) => (await client.list()).map((b) => b.path));
}

/** Messages in a folder matching the query, newest first. */
export async function searchMail(account: StoredAccount, q: SearchQuery): Promise<MailSummary[]> {
	const folder = q.folder || "INBOX";
	const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
	const allowed = new Set(account.allowFrom.map((a) => a.toLowerCase()));
	return withImap(credentialsOf(account), async (client) => {
		const lock = await client.getMailboxLock(folder, { readOnly: true });
		try {
			const criteria: SearchObject = {};
			if (q.from) criteria.from = q.from;
			if (q.to) criteria.to = q.to;
			if (q.subject) criteria.subject = q.subject;
			if (q.text) criteria.text = q.text;
			if (q.since) criteria.since = new Date(q.since);
			if (q.before) criteria.before = new Date(q.before);
			if (q.unread !== undefined) criteria.seen = !q.unread;
			if (q.flagged !== undefined) criteria.flagged = q.flagged;
			if (!Object.keys(criteria).length) criteria.all = true;
			const found = await client.search(criteria, { uid: true });
			const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a).slice(0, limit);
			if (!uids.length) return [];
			const out: MailSummary[] = [];
			for await (const m of client.fetch(
				uids.join(","),
				{ envelope: true, flags: true, uid: true },
				{ uid: true },
			)) {
				const from = m.envelope?.from?.[0];
				const address = (from?.address ?? "").toLowerCase();
				out.push({
					id: refId({ folder, uid: m.uid }),
					from: address,
					fromName: from?.name ?? "",
					to: (m.envelope?.to ?? []).map((t) => (t.address ?? "").toLowerCase()).filter(Boolean),
					subject: m.envelope?.subject ?? "",
					date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
					unread: !m.flags?.has("\\Seen"),
					flagged: Boolean(m.flags?.has("\\Flagged")),
					fromAllowed: allowed.has(address),
					messageId: m.envelope?.messageId?.replace(/^<|>$/g, "") ?? null,
				});
			}
			return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
		} finally {
			lock.release();
		}
	});
}

export interface ReadMail {
	ref: MailRef;
	raw: Uint8Array;
	mail: ParsedEmail;
	/** On the list and vouched for: it's from someone the bot answers. */
	trusted: boolean;
	verifiedReason: string;
}

/** One message, by folder:uid or by its Message-ID (searched in the inbox, then everywhere). */
export async function readMail(
	account: StoredAccount,
	id: string,
	opts: { markSeen?: boolean } = {},
): Promise<ReadMail | null> {
	const found = await withImap(credentialsOf(account), async (client) => {
		let ref = parseRef(id);
		if (!ref) {
			const messageId = id.replace(/^<|>$/g, "").trim();
			if (!messageId.includes("@")) return null;
			const boxes = ["INBOX", ...(await client.list()).map((b) => b.path).filter((p) => p !== "INBOX")];
			for (const box of boxes.slice(0, 12)) {
				const lock = await client.getMailboxLock(box, { readOnly: true });
				try {
					const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
					const uid = Array.isArray(uids) ? uids[0] : undefined;
					if (uid) {
						ref = { folder: box, uid };
						break;
					}
				} finally {
					lock.release();
				}
			}
			if (!ref) return null;
		}
		const lock = await client.getMailboxLock(ref.folder, { readOnly: !opts.markSeen });
		try {
			const meta = await client.fetchOne(String(ref.uid), { size: true }, { uid: true });
			if (!meta) return null;
			if ((meta.size ?? Infinity) > 40 * 1024 * 1024)
				throw new Error("This message is over 40 MB. Open it in a mail app instead.");
			const msg = await client.fetchOne(String(ref.uid), { source: true }, { uid: true });
			if (msg === false || !msg.source) return null;
			if (opts.markSeen) await client.messageFlagsAdd(String(ref.uid), ["\\Seen"], { uid: true });
			return { ref, raw: new Uint8Array(msg.source) };
		} finally {
			lock.release();
		}
	});
	if (!found) return null;
	const mail = await parseEmail(found.raw);
	const verdict = await judgeSender(account, found.raw, mail);
	const from = mail.from?.address ?? "";
	const trusted = !mail.automated && verdict.verified && account.allowFrom.some((a) => a.toLowerCase() === from);
	return { ...found, mail, trusted, verifiedReason: verdict.reason };
}

export type MarkAction = "read" | "unread" | "flag" | "unflag" | "archive" | "delete" | "junk";

/** Marks, moves or deletes messages (deleting moves them to the trash, like a mail app). */
export async function markMail(account: StoredAccount, ids: string[], action: MarkAction): Promise<number> {
	const refs = ids.map(parseRef).filter((r): r is MailRef => Boolean(r));
	const byFolder = new Map<string, number[]>();
	for (const r of refs) byFolder.set(r.folder, [...(byFolder.get(r.folder) ?? []), r.uid]);
	return withImap(credentialsOf(account), async (client) => {
		let done = 0;
		const target =
			action === "archive"
				? ((await specialFolder(client, "\\Archive", /^archive$/i)) ??
					(await client.mailboxCreate("Archive").then((r) => r.path)))
				: action === "delete"
					? await specialFolder(client, "\\Trash", /^(trash|deleted( items| messages)?|bin)$/i)
					: action === "junk"
						? await specialFolder(client, "\\Junk", /^(junk|spam)$/i)
						: null;
		for (const [folder, uids] of byFolder) {
			const lock = await client.getMailboxLock(folder);
			try {
				const range = uids.join(",");
				if (action === "read") await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
				else if (action === "unread") await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
				else if (action === "flag") await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
				else if (action === "unflag") await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
				else if (target && target !== folder) await client.messageMove(range, target, { uid: true });
				else if (action === "delete") await client.messageDelete(range, { uid: true });
				done += uids.length;
			} finally {
				lock.release();
			}
		}
		return done;
	});
}
