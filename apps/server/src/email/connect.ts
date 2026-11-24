import type { EmailProblem, EmailServer } from "@sekai/shared";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { errorMessage } from "../lib/errors.ts";
import { mailServerIp } from "../lib/net.ts";

/** Signing in to a mailbox: IMAP to read (and wait for) mail, SMTP to send it. */

export interface Credentials {
	imap: EmailServer;
	smtp: EmailServer;
	username: string;
	password: string;
	configured?: boolean;
}

export async function imapClient(c: Credentials, opts: { idle?: boolean } = {}): Promise<ImapFlow> {
	return new ImapFlow({
		host: await mailServerIp(c.imap.host, c.configured),
		servername: c.imap.host,
		port: c.imap.port,
		secure: c.imap.security === "tls",
		doSTARTTLS: c.imap.security === "starttls" ? true : undefined,
		auth: { user: c.username, pass: c.password },
		logger: false,
		clientInfo: { name: "Sekai" },
		disableAutoIdle: !opts.idle,
		connectionTimeout: 20_000,
		greetingTimeout: 15_000,
		socketTimeout: opts.idle ? 30 * 60_000 : 120_000,
		// Servers without IDLE are asked now and then whether anything arrived.
		missingIdleCommand: "STATUS",
	});
}

export async function smtpTransport(c: Credentials) {
	return nodemailer.createTransport({
		host: await mailServerIp(c.smtp.host, c.configured),
		tls: { servername: c.smtp.host },
		port: c.smtp.port,
		secure: c.smtp.security === "tls",
		requireTLS: c.smtp.security === "starttls",
		auth: { user: c.username, pass: c.password },
		connectionTimeout: 20_000,
		greetingTimeout: 15_000,
		socketTimeout: 60_000,
	});
}

/** Opens a short IMAP session, runs fn, and signs out (for tools and checks, apart from the inbox watcher). */
export async function withImap<T>(c: Credentials, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
	const client = await imapClient(c);
	client.on("error", () => {});
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.logout().catch(() => client.close());
	}
}

/** What went wrong signing in or sending, in words, and what kind of problem it is. */
export function describeMailError(
	err: unknown,
	what: "IMAP" | "SMTP" = "IMAP",
): {
	problem: EmailProblem;
	message: string;
} {
	const e = err as {
		authenticationFailed?: boolean;
		code?: string;
		responseCode?: number;
		serverResponseCode?: string;
		responseText?: string;
		response?: string;
	};
	const text = `${errorMessage(err)} ${e.responseText ?? ""} ${e.response ?? ""} ${e.serverResponseCode ?? ""}`;
	const server = what === "IMAP" ? "the incoming (IMAP) server" : "the outgoing (SMTP) server";
	if (
		e.authenticationFailed ||
		e.code === "EAUTH" ||
		/AUTHENTICATIONFAILED|authentication failed|invalid credentials|login failed|535|534|username and password not accepted/i.test(
			text,
		)
	)
		return {
			problem: "auth",
			message: `Couldn't sign in to ${server}: the username or password isn't right (some providers need an app password).`,
		};
	if (/OVERQUOTA|quota exceeded|mailbox (is )?full|552 /i.test(text))
		return { problem: "full", message: "The mailbox is full. Delete some mail or give it more space." };
	if (
		/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text) ||
		e.code === "ENOTFOUND" ||
		e.code === "EDNS" ||
		e.code === "EAI_AGAIN"
	)
		return { problem: "network", message: `Couldn't find ${server}. Check its name.` };
	if (
		/ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|timed? ?out|socket hang up|closed unexpectedly/i.test(text) ||
		e.code === "ECONNECTION" ||
		e.code === "ETIMEDOUT" ||
		e.code === "ESOCKET"
	)
		return {
			problem: "network",
			message: `Couldn't reach ${server}. Check its name and port, or try again later.`,
		};
	if (/certificate|self[- ]signed|SSL|TLS|wrong version number/i.test(text))
		return {
			problem: "network",
			message: `${server[0]?.toUpperCase()}${server.slice(1)} didn't set up a secure connection. Check the port and encryption.`,
		};
	return { problem: "other", message: `${what}: ${errorMessage(err).slice(0, 200)}` };
}

/** Signs in to both servers without sending or changing anything. */
export async function testCredentials(c: Credentials): Promise<{
	imap: { ok: boolean; error: string | null };
	smtp: { ok: boolean; error: string | null };
}> {
	const imap = withImap(c, async (client) => {
		await client.status("INBOX", { messages: true });
	}).then(
		() => ({ ok: true, error: null }),
		(err: unknown) => ({ ok: false, error: describeMailError(err, "IMAP").message }),
	);
	const smtp = smtpTransport(c)
		.then(async (transport) => {
			try {
				await transport.verify();
			} finally {
				transport.close();
			}
		})
		.then(
			() => ({ ok: true, error: null }),
			(err: unknown) => ({ ok: false, error: describeMailError(err, "SMTP").message }),
		);
	const [i, s] = await Promise.all([imap, smtp]);
	return { imap: i, smtp: s };
}
