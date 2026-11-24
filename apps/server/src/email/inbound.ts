import { resolveMx } from "node:dns/promises";
import { type EmailSender, MAX_UPLOAD_BYTES, messageText, replySubject } from "@sekai/shared";
import { bus } from "../events/bus.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { getAgent } from "../services/agents.ts";
import { createConversation, getConversation } from "../services/conversations.ts";
import { createMessage, getMessage, updateMessage } from "../services/messages.ts";
import { getUploadRow, saveUpload, toAttachment, uploadIdFromUrl } from "../services/uploads.ts";
import { signedBy } from "./dkim.ts";
import { type ParsedEmail, parseEmail, replyReferences, snippetOf, stripQuoted, threadKeys } from "./parse.ts";
import { EmailSendError, type OutgoingFile, sendAsBot } from "./send.ts";
import {
	emitEmailChanged,
	type MailRow,
	mailByMessageId,
	recordMail,
	type StoredAccount,
	threadChat,
	updateMail,
} from "./store.ts";
import {
	domainOf,
	parseAuthResults,
	receivingResults,
	type SenderVerdict,
	senderVerdict,
	trustedServer,
} from "./verify.ts";

/**
 * A new email in a bot's inbox. Mail from someone on its list, vouched for by their own mail server (or signed by
 * their domain), starts or continues a chat and gets an email reply. Everything else stays in the inbox as
 * untrusted data, with a quiet note in Needs you when the owner wants one.
 */

const MAX_FILES = 10;

const trustCache = new Map<string, { servers: string[]; until: number }>();

/**
 * The mail servers whose verdict counts for this mailbox: the provider of its IMAP and SMTP servers, of mailcow,
 * and of its domain's MX hosts (the servers that receive its mail).
 */
export async function trustedServersFor(account: Pick<StoredAccount, "address" | "imap" | "smtp" | "mailcowUrl">) {
	const key = `${account.address}|${account.imap.host}`;
	const hit = trustCache.get(key);
	if (hit && hit.until > Date.now()) return hit.servers;
	const domain = account.address.split("@")[1] ?? "";
	const mx = await resolveMx(domain).then(
		(r) => r.map((m) => m.exchange.toLowerCase()),
		() => [] as string[],
	);
	const hosts = [account.imap.host, ...mx];
	// Google's receiving MX names vary; its verdicts identify themselves as mx.google.com.
	if (mx.some((h) => /\.(?:google\.com|googlemail\.com)$/.test(h))) hosts.push("mx.google.com");
	if (account.mailcowUrl) hosts.push(new URL(account.mailcowUrl).hostname);
	const servers = [...new Set(hosts)];
	if (trustCache.size > 1000) trustCache.clear();
	trustCache.set(key, { servers, until: Date.now() + 3_600_000 });
	return servers;
}

/** Whether this email's sender is who its From line says, as far as its servers (or its signature) vouch. */
export async function judgeSender(
	account: Pick<StoredAccount, "address" | "imap" | "smtp" | "mailcowUrl">,
	raw: Uint8Array,
	mail: ParsedEmail,
): Promise<SenderVerdict> {
	const trusted = await trustedServersFor(account);
	let authResults = receivingResults(mail.headers, trusted);
	const from = mail.fromCount === 1 ? mail.from?.address : null;
	const localMail = Boolean(from && account.mailcowUrl && domainOf(from) === domainOf(account.address));
	const top = mail.authResults[0];
	const report = top && trustedServer(parseAuthResults(top).authservId, trusted);
	// Some providers put their verdict below Received, where a header alone isn't proof. In
	// that case also check the signature on the bytes. A reported failure is never overridden.
	const signature = Boolean(
		from &&
			!authResults.length &&
			(localMail || report) &&
			mail.headers.some((h) => h.key === "dkim-signature") &&
			(await signedBy(raw, from).catch(() => false)),
	);
	if (!authResults.length && report && signature && top) authResults = [top];
	return senderVerdict({
		from: mail.fromCount === 1 ? (mail.from?.address ?? null) : null,
		authResults,
		trustedServers: trusted,
		localSignature: localMail && signature && !top,
	});
}

export interface Arrival {
	raw: Uint8Array;
	folder: string;
	uid: number;
	/** Marks it read in the mailbox (once the bot has taken it). */
	markSeen(): Promise<void>;
}

/** Takes in one new email. Runs as the bot's owner. */
export async function receive(account: StoredAccount, arrival: Arrival): Promise<void> {
	let mail: ParsedEmail;
	try {
		mail = await parseEmail(arrival.raw);
	} catch (err) {
		log.warn(`email: couldn't read a message in ${account.address}: ${errorMessage(err)}`);
		return;
	}
	if (await mailByMessageId(account.agentId, mail.messageId)) return;
	const from = mail.from?.address ?? "";
	const allowFrom = account.allowFrom.map((a) => a.toLowerCase());
	const verdict = await judgeSender(account, arrival.raw, mail);
	const sender: EmailSender =
		from && from === account.address.toLowerCase()
			? "self"
			: allowFrom.includes(from) && mail.fromCount === 1
				? verdict.verified
					? "allowed"
					: "unverified"
				: "unknown";
	const acts = sender === "allowed" && !mail.automated && account.enabled;
	const note = !acts && sender !== "self" && !mail.automated && account.notifyUnknown ? "waiting" : null;
	const row = await recordMail({
		agentId: account.agentId,
		direction: "in",
		messageId: mail.messageId,
		inReplyTo: mail.inReplyTo,
		references: mail.references,
		fromAddress: from,
		fromName: mail.from?.name ?? "",
		to: [...mail.to, ...mail.cc].map((p) => p.address),
		subject: mail.subject,
		snippet: snippetOf(stripQuoted(mail.text)),
		sender,
		verifiedBy: verdict.by,
		automated: mail.automated,
		conversationId: null,
		sekaiMessageId: null,
		folder: arrival.folder,
		uid: arrival.uid,
		attachments: mail.files.filter((f) => !f.inline).length,
		note,
		at: mail.date && mail.date < Date.now() + 86_400_000 ? mail.date : Date.now(),
	});
	log.info(
		`email: ${account.address} got mail from ${from || "(no sender)"}: ${sender}${mail.automated ? ", automatic" : ""} (${verdict.reason})`,
	);
	void emitEmailChanged(account.agentId);
	if (acts) await takeIn(account, mail, row, arrival);
}

/** Mail from someone it answers: into the thread's chat (or a new one), then the bot replies by email. */
async function takeIn(account: StoredAccount, mail: ParsedEmail, row: MailRow, arrival: Arrival): Promise<void> {
	const agent = await getAgent(account.agentId);
	if (!agent) return;
	let conversationId = await threadChat(account.agentId, threadKeys(mail));
	const peer = mail.from?.address ?? "";
	if (conversationId && (await getConversation(conversationId))?.settings.emailPeer !== peer) conversationId = null;
	const started = !conversationId;
	if (!conversationId) {
		const chat = await createConversation(
			{
				kind: "direct",
				agentId: account.agentId,
				title: `Email: ${mail.subject || "(no subject)"}`.slice(0, 200),
			},
			{ emailPeer: peer },
		);
		conversationId = chat.id;
	}
	const uploads = [];
	for (const f of mail.files.filter(
		(f) => !f.inline || (f.mime.startsWith("image/") && f.data.byteLength > 20_000),
	)) {
		if (uploads.length >= MAX_FILES) break;
		if (f.data.byteLength > MAX_UPLOAD_BYTES) continue;
		try {
			uploads.push(await saveUpload(f.data, f.name, f.mime));
		} catch (err) {
			log.warn(`email: an attachment wasn't kept: ${errorMessage(err)}`);
		}
	}
	const text = stripQuoted(mail.text) || (uploads.length ? "(attachments)" : "(empty email)");
	const message = await createMessage({
		conversationId,
		sender: "user",
		parts: [{ type: "text", text }],
		attachments: uploads.map(toAttachment),
		meta: {
			trigger: "email",
			email: {
				messageId: mail.messageId,
				from: mail.from?.address ?? "",
				fromName: mail.from?.name,
				subject: mail.subject,
			},
		},
	});
	await updateMail(row.id, { conversationId, startedChat: started, sekaiMessageId: message.id });
	await arrival.markSeen().catch(() => {});
	if (agent.status === "paused") {
		log.info(`email: ${agent.name} is paused, so the email waits in its chat`);
		return;
	}
	const { enqueueRun } = await import("../agent/runtime.ts");
	const run = await enqueueRun({
		agentId: account.agentId,
		conversationId,
		trigger: "email",
		sourceMessageId: message.id,
		rootMessageId: message.id,
	});
	void answer(account, mail, run.id, conversationId).catch((err: unknown) =>
		log.warn(`email: couldn't send ${agent.name}'s reply: ${errorMessage(err)}`),
	);
}

/** The bot's reply and its files, as an email in the same thread (to the sender only). */
async function answer(account: StoredAccount, mail: ParsedEmail, runId: string, conversationId: string): Promise<void> {
	const { waitForRun } = await import("../agent/runtime.ts");
	const done = await waitForRun(runId);
	if (done?.status !== "done" || !done.messageId) return;
	const reply = await getMessage(done.messageId);
	const text = reply ? messageText(reply) : "";
	if (!reply || !text.trim()) return;
	const files: OutgoingFile[] = [];
	const urls = [
		...reply.parts.flatMap((p) => (p.type === "image" ? [p.url] : [])),
		...reply.attachments.map((a) => a.url),
	];
	for (const url of [...new Set(urls)].slice(0, MAX_FILES)) {
		const id = uploadIdFromUrl(url);
		const upload = id ? await getUploadRow(id).catch(() => null) : null;
		if (!upload) continue;
		files.push({
			name: upload.name,
			mime: upload.mime,
			data: new Uint8Array(await Bun.file(upload.path).arrayBuffer()),
		});
	}
	const to = mail.from?.address;
	if (!to) return;
	try {
		const sent = await sendAsBot(
			account.agentId,
			{
				to: [to],
				subject: replySubject(mail.subject),
				markdown: text,
				autoReply: true,
				files,
				inReplyTo: mail.messageId,
				references: replyReferences(mail),
				quote: {
					from: mail.from?.name ? `${mail.from.name} <${to}>` : to,
					date: mail.date,
					text: stripQuoted(mail.text),
				},
			},
			{ conversationId, sekaiMessageId: reply.id, accountSince: account.createdAt },
		);
		await updateMessage(reply.id, {
			meta: {
				...reply.meta,
				email: { messageId: sent.messageId, from: account.address, subject: replySubject(mail.subject) },
			},
		});
	} catch (err) {
		const why = err instanceof EmailSendError ? err.message : errorMessage(err);
		const agent = await getAgent(account.agentId);
		bus.emit({
			type: "notification",
			title: `${agent?.name ?? "Your bot"} couldn't answer by email`,
			body: why,
			agentId: account.agentId,
			conversationId,
			url: `/c/${conversationId}`,
		});
		throw err;
	}
}
