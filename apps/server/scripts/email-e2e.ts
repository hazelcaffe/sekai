/** Opt-in real mail round trip. Only the two randomly named test mailboxes can be addressed or deleted. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";

if (process.env.SEKAI_EMAIL_E2E !== "1") {
	console.log("Set SEKAI_EMAIL_E2E=1 to test with two temporary mailboxes.");
	process.exit(0);
}
// MAILCOW_URL, MAILCOW_API_KEY and MAILCOW_TEST_DOMAIN (a domain on that mailcow kept for tests, with DKIM signing).
const config = parseEnv(readFileSync(join(homedir(), ".config/sekai-e2e/mailcow.env"), "utf8"));
if (!config.MAILCOW_URL || !config.MAILCOW_API_KEY || !config.MAILCOW_TEST_DOMAIN)
	throw new Error("Set MAILCOW_URL, MAILCOW_API_KEY and MAILCOW_TEST_DOMAIN in ~/.config/sekai-e2e/mailcow.env.");
const url = new URL(config.MAILCOW_URL).origin;
if (!url.startsWith("https://")) throw new Error("MAILCOW_URL must be an https:// address.");
const domain = config.MAILCOW_TEST_DOMAIN.toLowerCase();
const random = () => randomBytes(10).toString("hex");
const box = `sekai-test-${random()}`;
const peer = `sekai-test-${random()}`;
const address = `${box}@${domain}`;
const sender = `${peer}@${domain}`;
const admin = new URL(process.env.DATABASE_URL ?? "postgres://feesh:feesh@127.0.0.1:5433/feesh");
assert.equal(admin.hostname, "127.0.0.1");
const sql = postgres(admin.href, { max: 1, onnotice: () => {} });
const name = `sekai_email_${random()}`;
await sql.unsafe(`create database ${name}`);
admin.pathname = `/${name}`;
process.env.DATABASE_URL = admin.href;
const dir = mkdtempSync(join(tmpdir(), "sekai-email-"));
process.env.SEKAI_DATA_DIR = dir;
process.env.SEKAI_LOG_LEVEL = "warn";
const model = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		if (new URL(req.url).pathname.endsWith("/models"))
			return Response.json({ data: [{ id: "claude-sonnet-5-5" }] });
		return new Response(
			`data: ${JSON.stringify({ choices: [{ delta: { content: "Round trip confirmed." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	},
});
process.env.GATEWAY_URL = `${model.url.origin}/v1`;
process.env.GATEWAY_API_KEY = "local-test";
const { MailcowClient } = await import("../src/email/mailcow.ts");
const mc = new MailcowClient(url, config.MAILCOW_API_KEY);
const created = new Set<string>();
async function until<T>(label: string, check: () => Promise<T | undefined | false | null>): Promise<T> {
	const end = Date.now() + 90_000;
	do {
		const result = await check();
		if (result) return result;
		await Bun.sleep(800);
	} while (Date.now() < end);
	throw new Error(`Timed out: ${label}`);
}
try {
	const { initDb, db } = await import("../src/db/index.ts");
	const { ensureSetupCode, setupCodeForTests, setup } = await import("../src/auth/service.ts");
	const { runAsUser } = await import("../src/auth/actor.ts");
	const { saveMailcowSettings } = await import("../src/email/settings.ts");
	const { createAgent } = await import("../src/services/agents.ts");
	const { createMailbox, updateAccount, recentMail } = await import("../src/email/accounts.ts");
	const { storedAccount, credentialsOf } = await import("../src/email/store.ts");
	const { withImap, smtpTransport, testCredentials } = await import("../src/email/connect.ts");
	const { parseEmail } = await import("../src/email/parse.ts");
	await initDb();
	await ensureSetupCode("http://localhost");
	const user = await setup({
		username: "email-test",
		name: "Hazel",
		password: random(),
		code: setupCodeForTests() ?? "",
	});
	await runAsUser(user.id, async () => {
		await saveMailcowSettings({ url, apiKey: config.MAILCOW_API_KEY, domains: [domain], defaultQuotaMb: 32 });
		const bot = await createAgent({ name: "Mizuki", capabilities: { autoLearn: false } });
		assert.equal(await mc.getMailbox(address), null);
		assert.equal(await mc.getMailbox(sender), null);
		// Register both fresh names before the network mutations, even if a response is lost.
		created.add(address);
		await createMailbox(bot.id, { localPart: box, domain });
		const password = `${random()}aA4!`;
		created.add(sender);
		await mc.createMailbox({ localPart: peer, domain, name: "Kanade", password, quotaMb: 32 });
		const account = await until("IMAP watcher initialized", async () => {
			const a = await storedAccount(bot.id);
			return a?.sync.uidValidity ? a : null;
		});
		const creds = { ...credentialsOf(account), username: sender, password };
		const test = await testCredentials(creds);
		assert.ok(test.imap.ok && test.smtp.ok, "Test must sign in to both servers");
		const smtp = await smtpTransport(creds);
		try {
			await smtp.sendMail({ from: sender, to: address, subject: "Stranger check", text: "Unsolicited hello" });
			const stranger = await until("unknown sender kept", async () =>
				(await recentMail(bot.id)).find((m) => m.subject === "Stranger check"),
			);
			assert.equal(stranger.sender, "unknown");
			assert.equal(stranger.conversationId, null);
			await updateAccount(bot.id, { allowFrom: [sender] });
			await withImap(credentialsOf(account), async (c) => {
				await c.append(
					"INBOX",
					Buffer.from(`From: ${sender}\r\nTo: ${address}\r\nSubject: Unsigned check\r\n\r\nUnverified hello`),
				);
			});
			const unsigned = await until("unsigned sender kept", async () =>
				(await recentMail(bot.id)).find((m) => m.subject === "Unsigned check"),
			);
			assert.equal(unsigned.sender, "unverified");
			assert.equal(unsigned.conversationId, null);
			assert.equal((await db.query.runs.findMany()).length, 0, "No run for either untrusted message");
			const id = `${random()}@${domain}`;
			await smtp.sendMail({
				from: sender,
				to: address,
				subject: "Thread check",
				text: "Please confirm delivery.",
				messageId: `<${id}>`,
				attachments: [{ filename: "note.txt", content: "Hello from Kanade." }],
			});
			const incoming = await until("allowed sender starts chat", async () => {
				const m = (await recentMail(bot.id)).find((m) => m.subject === "Thread check");
				if (m && m.sender !== "allowed") throw new Error(`Signed test message classified as ${m.sender}`);
				return m?.conversationId ? m : null;
			});
			assert.equal(incoming.sender, "allowed");
			assert.equal(incoming.attachments, 1);
			const reply = await withImap(creds, async (c) => {
				await c.mailboxOpen("INBOX");
				return until("SMTP reply delivered", async () => {
					const ids = await c.search({ header: { "in-reply-to": id } }, { uid: true });
					if (!Array.isArray(ids) || !ids[0]) return null;
					const msg = await c.fetchOne(String(ids[0]), { source: true }, { uid: true });
					return msg !== false && msg.source ? parseEmail(msg.source) : null;
				});
			});
			assert.equal(reply.subject, "Re: Thread check");
			assert.equal(reply.inReplyTo, id);
			assert.ok(reply.references.includes(id));
			assert.match(reply.text, /Round trip confirmed/);
			const signedBy = new RegExp(`\\bd=${domain.replaceAll(".", "\\.")}\\s*;`, "i");
			assert.ok(reply.headers.some((h) => h.key === "dkim-signature" && signedBy.test(h.value)));
			await smtp.sendMail({
				from: sender,
				to: address,
				subject: "Re: Thread check",
				text: "One more check.",
				inReplyTo: `<${reply.messageId}>`,
				references: [`<${id}>`, `<${reply.messageId}>`],
			});
			const continued = await until("follow-up joins the chat", async () =>
				(await recentMail(bot.id)).find(
					(m) => m.direction === "in" && m.conversationId && m.subject === "Re: Thread check",
				),
			);
			assert.equal(continued.conversationId, incoming.conversationId);
			await until(
				"follow-up answered",
				async () => (await recentMail(bot.id)).filter((m) => m.direction === "out").length === 2,
			);
			console.log(
				`PASS: IMAP + SMTP login, stranger and unsigned mail start no runs, attachment, threaded reply signed by ${domain}, follow-up in the same chat.`,
			);
		} finally {
			smtp.close();
		}
	});
} finally {
	try {
		await (await import("../src/email/watch.ts")).stopEmail();
	} finally {
		const cleanup = await Promise.allSettled(
			[...created].map(async (a) => {
				if (await mc.getMailbox(a)) await mc.deleteMailbox(a);
				assert.equal(await mc.getMailbox(a), null);
			}),
		);
		model.stop(true);
		await (await import("../src/db/index.ts")).closeDb();
		await sql.unsafe(`drop database ${name} with (force)`);
		await sql.end();
		rmSync(dir, { recursive: true, force: true });
		assert.ok(
			cleanup.every((r) => r.status === "fulfilled"),
			"Mailbox cleanup failed",
		);
		console.log("Cleanup confirmed: test mailboxes and scratch database removed.");
	}
}
