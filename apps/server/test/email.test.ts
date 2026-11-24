import { describe, expect, test } from "bun:test";
import { mailboxName, replySubject } from "@sekai/shared";
import { discoverServers, parseAutoconfig } from "../src/email/autoconfig.ts";
import { composeEmail } from "../src/email/compose.ts";
import { MailcowClient } from "../src/email/mailcow.ts";
import { parseEmail, replyReferences, stripQuoted, threadKeys } from "../src/email/parse.ts";
import { buildMessage } from "../src/email/send.ts";
import { receivingResults, senderVerdict } from "../src/email/verify.ts";

describe("who may start work by email", () => {
	const trusted = ["mx.example.org"];
	const verdict = (authResults: string[], from: string | null = "owner@example.net") =>
		senderVerdict({ from, authResults, trustedServers: trusted, localSignature: false });
	test("a receiving server's verdict must concern this From domain", () => {
		const report = (r: string) => [`mx.example.org (rspamd);\r\n\t${r}`];
		expect(verdict(report("dmarc=pass (p=QUARANTINE) header.from=example.net")).by).toBe("dmarc");
		expect(verdict(report("spf=pass smtp.mailfrom=bounce@example.net")).by).toBe("spf");
		expect(verdict(report("dkim=pass (2048-bit key) header.d=example.net header.s=dkim")).by).toBe("dkim");
		for (const r of [
			"dmarc=pass header.from=other.test",
			"dmarc=pass",
			"spf=pass smtp.helo=example.net",
			"dkim=pass header.d=other.test",
			"dmarc=fail header.from=example.net; dkim=pass header.d=example.net",
			"auth=pass smtp.auth=owner@example.net",
		])
			expect(verdict(report(r)).verified).toBe(false);
		expect(verdict([]).verified).toBe(false);
		expect(verdict(report("spf=pass smtp.mailfrom=example.net"), null).verified).toBe(false);
	});
	test("a report below the receiving hop, or from a namesake, cannot vouch for a sender", () => {
		const r = { key: "authentication-results", value: "mx.example.org; dmarc=pass header.from=example.net" };
		const hop = { key: "received", value: "from relay.example.net by mx.example.org with ESMTPS" };
		expect(verdict(receivingResults([r, hop], trusted)).verified).toBe(true);
		expect(verdict(receivingResults([hop, r], trusted)).verified).toBe(false);
		expect(verdict(receivingResults([r], trusted)).verified).toBe(false);
		expect(verdict([r.value.replace("mx.", "unrelated.mx.")]).verified).toBe(false);
	});
});

test("MIME: readable multipart mail, real image type, From ambiguity and reply headers", async () => {
	const raw = await buildMessage(
		{ address: "m@example.org", name: "Mizuki", signature: "M" },
		{
			to: ["k@example.org"],
			bcc: ["hidden@example.org"],
			subject: "Re: Notes",
			markdown: "New notes",
			inReplyTo: "old@example.org",
			references: ["root@example.org", "old@example.org"],
			files: [{ name: "scan.webp", mime: "image/webp", data: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10) }],
		},
		"new@example.org",
	);
	const m = await parseEmail(raw);
	expect(m.files[0]?.mime).toBe("image/png");
	expect(m.text).toContain("New notes");
	expect(m.html).toContain("New notes");
	expect(raw.toString()).not.toContain("hidden@example.org");
	expect(threadKeys(m)).toEqual(["old@example.org", "root@example.org"]);
	expect(replyReferences(m)).toEqual(["root@example.org", "old@example.org", "new@example.org"]);
	expect(replySubject(m.subject)).toBe(m.subject);
	for (const from of ["From: k@example.org, m@example.org", "From: k@example.org\r\nFrom: m@example.org"])
		expect((await parseEmail(`${from}\r\n\r\nHello`)).from).toBeNull();
	const html = await parseEmail(
		"From: no-reply@example.org\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Meet at <b>eight</b>.</p>",
	);
	expect(html.text).toContain("Meet at eight.");
	expect(html.automated).toBe(true);
});

test("formatted mail has plain text, no active HTML or remote pictures, and a short quote", () => {
	const { text, html } = composeEmail(
		"**Notes** [here](https://example.org)\n\n`<img src=x>`\n\n![tracking](https://example.net/pixel)",
		{
			signature: "M & K",
			quote: { from: "Hazel", date: null, text: Array.from({ length: 40 }, (_, i) => `old ${i}`).join("\n") },
		},
	);
	expect(html).toContain("<strong>Notes</strong>");
	expect(html).not.toContain("<img");
	expect(text).toContain("here (https://example.org)");
	expect(html).not.toContain("old 39");
	expect(text).toContain("-- \nM & K");
	expect(stripQuoted("Yes.\n\nOn Tuesday, K wrote:\n> Can you? ")).toBe("Yes.");
	expect(mailboxName(" Éna / Shinonome ")).toBe("ena.shinonome");
});

test("mailcow wire contract and write errors even on status 200", async () => {
	const calls: { path: string; body: unknown }[] = [];
	let status = 200;
	let reply: unknown = [{ type: "success", msg: ["mailbox_added", "m@example.org"] }];
	const c = new MailcowClient("mail.example.org", "fixture", {
		fetch: async (input, init) => {
			expect(new Headers(init?.headers).get("X-API-Key")).toBe("fixture");
			calls.push({
				path: new URL(String(input)).pathname,
				body: init?.body ? JSON.parse(String(init.body)) : null,
			});
			return Response.json(reply, { status });
		},
	});
	await c.createMailbox({ localPart: "m", domain: "example.org", name: "Mizuki", password: "fake", quotaMb: 32 });
	expect(calls[0]).toMatchObject({
		path: "/api/v1/add/mailbox",
		body: { local_part: "m", domain: "example.org", password2: "fake", active: 1, quota: 32 },
	});
	await c.updateMailbox("m@example.org", { password: "next", quotaMb: 64, name: "M" });
	expect(calls.at(-1)?.body).toEqual({
		items: ["m@example.org"],
		attr: { password: "next", password2: "next", quota: 64, name: "M" },
	});
	reply = [{ type: "danger", msg: ["object_exists", "m@example.org"] }];
	await expect(c.deleteMailbox("m@example.org")).rejects.toThrow("already taken");
	reply = [{ domain_name: "example.org", active: "1", def_new_mailbox_quota: 1048576 }];
	expect((await c.domains())[0]).toMatchObject({ name: "example.org", active: true, defaultQuotaMb: 1 });
	status = 403;
	reply = { msg: "read/write access denied" };
	expect(await c.canWrite()).toBe(false);
});

test("autoconfig chooses encrypted password sign-ins and fills templates; otherwise try SRV", async () => {
	const server = (kind: string, type: string, host: string, socket: string) =>
		`<${kind}Server type="${type}"><hostname>${host}</hostname><socketType>${socket}</socketType><username>%EMAILLOCALPART%</username></${kind}Server>`;
	const xml =
		server("incoming", "imap", "unsafe.example.org", "plain") +
		server("incoming", "imap", "imap.%EMAILDOMAIN%", "SSL") +
		server("outgoing", "smtp", "smtp.%EMAILDOMAIN%", "STARTTLS");
	expect(parseAutoconfig(xml, "m@example.org")).toMatchObject({
		imap: { host: "imap.example.org", port: 993, username: "m" },
		smtp: { port: 587, security: "starttls" },
	});
	const guess = await discoverServers("m@example.org", {
		fetchText: async () => null,
		mx: async () => [],
		srv: async (name) =>
			name.startsWith("_imaps") || name.startsWith("_submission.")
				? [{ name: "mail.example.org.", priority: 0, port: name.startsWith("_imaps") ? 993 : 587 }]
				: [],
	});
	expect(guess).toMatchObject({
		source: "dns",
		imap: { host: "mail.example.org" },
		smtp: { port: 587, security: "starttls" },
	});
});
