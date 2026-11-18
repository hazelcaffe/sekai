import type { Channel } from "@sekai/shared";
import { z } from "zod";
import { type BrowserSession, browserFor, describePage, settle } from "../../browser/engine.ts";
import { status as channelStatus } from "../../channels/state.ts";
import { db } from "../../db/index.ts";
import { errorMessage } from "../../lib/errors.ts";
import { log } from "../../lib/log.ts";
import { unseal } from "../../lib/secrets.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

const API = "https://discord.com/api/v10";

/** The bot's personal Discord account channel and its token (unsealed), wherever it's stored. */
async function accountOf(agentId: string): Promise<{ channel: Channel; token: string } | null> {
	const channel =
		(await db.query.channels.findFirst({
			where: (t, { and, eq: eq2 }) => and(eq2(t.agentId, agentId), eq2(t.type, "discord-user")),
		})) ?? null;
	const raw = channel?.secrets.userToken?.trim();
	if (!channel || !raw) return null;
	let token = raw;
	if (raw.startsWith("v1:")) {
		try {
			token = unseal(raw);
		} catch {
			throw new ToolError(
				"The Discord account token couldn't be decrypted; paste it again in the bot's Accounts.",
			);
		}
	}
	return { channel, token };
}

const hasAccount = async (agent: { id: string }) => Boolean(await accountOf(agent.id).catch(() => null));

async function requireAccount(ctx: ToolContext): Promise<{ channel: Channel; token: string }> {
	const account = await accountOf(ctx.agent.id);
	if (!account) throw new ToolError("You don't have a Discord account; the user adds one under Accounts.");
	const s = channelStatus(account.channel.id);
	if (s.state !== "connected") {
		throw new ToolError(
			`Your Discord account isn't connected${s.error ? ` (${s.error})` : ""}. Tell the user to check it under Accounts.`,
		);
	}
	return account;
}

// The init script that signs Discord in as the account in the bot's own browser. It runs before any page
// script, so the app boots already signed in; the token never touches a visible input or the page's console.
// Init scripts run in every page and frame of the browser, so it does nothing outside discord.com: any other site
// the bot opens must never see the token.
function signInScript(token: string): string {
	return `(() => {
		const isDiscord = (win) => {
			try {
				// origin, not location: a blank iframe Discord makes inherits discord.com's origin.
				const o = win.origin;
				const h = o && o !== "null" ? new URL(o).hostname : win.location.hostname;
				return h === "discord.com" || h.endsWith(".discord.com");
			} catch {
				return false;
			}
		};
		if (!isDiscord(window)) return;
		const apply = (win) => {
			try {
				const w = win;
				if (!isDiscord(w) || w.__sekaiToken) return;
				w.__sekaiToken = ${JSON.stringify(token)};
				const desc = Object.getOwnPropertyDescriptor(w, "token");
				if (!desc || desc.configurable) {
					Object.defineProperty(w, "token", { get: () => w.__sekaiToken, set: () => {}, configurable: true });
				}
			} catch {}
		};
		apply(window);
		try {
			const o = window.HTMLIFrameElement.prototype.contentWindow;
			Object.defineProperty(window.HTMLIFrameElement.prototype, "contentWindow", {
				get() { const w = o.get.call(this); if (w) apply(w); return w; },
				configurable: true,
			});
		} catch {}
	})();`;
}

function ensureHook(s: BrowserSession, token: string): void {
	const anyS = s.context as unknown as { __sekaiDiscordToken?: string };
	if (anyS.__sekaiDiscordToken === token) return;
	s.context
		.addInitScript(signInScript(token))
		.then(() => {
			anyS.__sekaiDiscordToken = token;
		})
		.catch((err: unknown) => log.warn(`discord account hook: ${errorMessage(err)}`));
}

async function discordSession(
	ctx: ToolContext,
	on?: string,
): Promise<{ s: BrowserSession; account: { channel: Channel; token: string } }> {
	const account = await accountOf(ctx.agent.id);
	if (!account) throw new ToolError("You don't have a Discord account; the user adds one under Accounts.");
	const s = await browserFor(ctx.agent.id, on);
	ensureHook(s, account.token);
	return { s, account };
}

/** A page on discord.com itself (not a look-alike address that merely contains the name). */
function isDiscordPage(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host === "discord.com" || host.endsWith(".discord.com");
	} catch {
		return false;
	}
}

// The account token in the live page, if Discord rotated it (after a captcha/verify the app holds a fresh one).
async function pageToken(s: BrowserSession): Promise<string | null> {
	for (const page of s.context.pages()) {
		if (!isDiscordPage(page.url())) continue;
		const t = await page
			.evaluate(`(() => { try { return window.__sekaiToken ?? null; } catch { return null; } })()`)
			.catch(() => null);
		if (typeof t === "string" && t.length > 20) return t;
	}
	return null;
}

/**
 * If Discord rotated the account's token (a captcha/verify in the app invalidates the old one), take the fresh one
 * the page is holding and store it, so the gateway and REST keep working. Returns true when it changed.
 */
async function adoptFreshToken(s: BrowserSession, account: { channel: Channel; token: string }): Promise<boolean> {
	const fresh = await pageToken(s);
	if (!fresh || fresh === account.token) return false;
	const { updateChannel } = await import("../../channels/manager.ts");
	await updateChannel(account.channel.id, { secrets: { userToken: fresh } });
	account.token = fresh;
	log.info(`discord account ${account.channel.id}: adopted a rotated token`);
	return true;
}

async function openDiscordApp(s: BrowserSession, page: string): Promise<string> {
	const url = `https://discord.com/channels/${page}`;
	const current = s.page.url();
	if (current.startsWith("https://discord.com/channels/") && !current.endsWith("/channels/@me")) {
		await s.page.evaluate(`window.location.href = ${JSON.stringify(url)}`);
	} else {
		await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
	}
	await s.page.waitForTimeout(1200);
	if (s.page.url().includes("/login")) {
		// The sign-in hook only applies to documents created after it was added: reload once.
		await s.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
		await s.page.waitForTimeout(1500);
	}
	await settle(s.page);
	const note =
		`You're signed in to Discord as your account, in your browser (${s.label}) — ` +
		"say if you can't see it. Click servers, channels and people like a person would; your profile is bottom-left. " +
		"If a captcha or check appears, solve it with browser_click / browser_screenshot (tick the box); that's why this is a real browser.";
	return `${note}\n${await describePage(s)}`;
}

// ---------------------------------------------------------------- REST (as the account)

/** A REST call as the account (plain token, no Bot prefix). Throws with Discord's own message when it has one. */
async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			authorization: token,
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
	if (res.status === 204) return undefined as T;
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) {
		const msg = data?.message ?? res.statusText;
		const err = new Error(msg) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return data as T;
}

interface ApiGuild {
	id: string;
	name: string;
	member_count?: number;
	approximate_member_count?: number;
	description?: string | null;
	owner?: boolean;
	permissions?: string;
}
interface ApiGuildChannel {
	id: string;
	type: number;
	name?: string;
	topic?: string | null;
	parent_id?: string | null;
}
interface ApiMember {
	user?: { id: string; username: string; global_name?: string | null; bot?: boolean };
	nick?: string | null;
	roles?: string[];
}
interface ApiMessage {
	id: string;
	content?: string;
	timestamp?: string;
	author?: { id: string; username: string; global_name?: string | null; bot?: boolean };
}
interface ApiDm {
	id: string;
	type: number;
	name?: string | null;
	recipients?: { id: string; username: string; global_name?: string | null }[];
}

/** "Gaming Lounge" or "#general" → the matching guild/channel id, else null. */
function norm(s: string): string {
	return s.trim().toLowerCase().replace(/^#/, "");
}

async function guildsOf(token: string): Promise<ApiGuild[]> {
	return api<ApiGuild[]>(token, "GET", "/users/@me/guilds?with_counts=true").catch(() => []);
}

async function resolveGuild(token: string, ref: string): Promise<ApiGuild> {
	const guilds = await guildsOf(token);
	const byId = guilds.find((g) => g.id === ref.trim());
	if (byId) return byId;
	const want = norm(ref);
	const byName = guilds.find((g) => norm(g.name) === want);
	if (byName) return byName;
	throw new ToolError(
		`Your account isn't in a server called "${ref}". Servers it's in: ${
			guilds
				.map((g) => g.name)
				.slice(0, 20)
				.join(", ") || "none"
		}. To join one, use discord action join_server with an invite.`,
	);
}

async function resolveChannel(token: string, guildId: string, ref: string): Promise<ApiGuildChannel> {
	const channels = await api<ApiGuildChannel[]>(token, "GET", `/guilds/${guildId}/channels`);
	const byId = channels.find((c) => c.id === ref.trim());
	if (byId) return byId;
	const want = norm(ref);
	const text = channels.filter((c) => c.type === 0 || c.type === 5 || c.type === 15);
	const byName = text.find((c) => norm(c.name ?? "") === want);
	if (byName) return byName;
	throw new ToolError(
		`No text channel "${ref}" in that server. Text channels: ${text
			.map((c) => `#${c.name}`)
			.slice(0, 25)
			.join(", ")}.`,
	);
}

/** A DM/group-chat id from a chat name or the person's username, listing what there is on failure. */
async function resolveChat(token: string, ref: string): Promise<string> {
	const dms = await api<ApiDm[]>(token, "GET", "/users/@me/channels").catch(() => [] as ApiDm[]);
	const want = norm(ref).replace(/^@/, "");
	const hit = dms.find(
		(c) =>
			(c.type === 3 && norm(c.name ?? "") === want) ||
			(c.type === 1 &&
				c.recipients?.some((r) => norm(r.username) === want || norm(r.global_name ?? "") === want)),
	);
	if (hit) return hit.id;
	throw new ToolError(
		`Your account has no chat "${ref}". Chats it has: ${dms
			.map((c) => (c.type === 3 ? (c.name ?? "group chat") : `@${c.recipients?.[0]?.username ?? "?"}`))
			.slice(0, 15)
			.join(", ")}. For someone new, use discord action open_dm with their user id.`,
	);
}

const serverRef = z.string().describe("The server's name, or its id");
const channelRef = z.string().optional().describe("The channel's name or id (default: the first text channel)");

export const discordUserTools = [
	defineTool({
		name: "browser_account",
		category: "browser",
		description:
			"Open your own Discord account in your browser, signed in as it, for anything interactive: joining a server from an invite (solving the captcha if one appears), changing the account's profile, voice channels, or reading a server by clicking around. For reading and sending without a browser, use the discord tool.",
		parameters: z.object({
			page: z
				.string()
				.optional()
				.describe(
					'Where to go: "@me" (your DMs, the default), "guildId/channelId" (a server channel), or "@me/channelId" (a DM)',
				),
			on: z
				.string()
				.optional()
				.describe(
					'Where to browse: "computer" (Chrome on your computer), "device" (a browser on the user\'s computer, if they lent it to you) or "server". Default: where your browser already is.',
				),
		}),
		risk: "external",
		available: hasAccount,
		title: () => "Opened Discord as their account",
		async execute(args, ctx) {
			const { s, account } = await discordSession(ctx, args.on);
			const page = (args.page ?? "@me").replace(/^\/+|\/+$/g, "") || "@me";
			const out = await openDiscordApp(s, page);
			await adoptFreshToken(s, account);
			return out;
		},
	}),

	defineTool({
		name: "discord",
		category: "contact",
		description:
			"Use your own Discord account (read and act as it). servers: list its servers. server_info: a server's channels and member count. members: who's in a server. history: recent messages in a channel or chat. send: message a server channel, group chat or DM. open_dm: open a DM with someone by user id. react: react to a message. profile: change the account's display name or bio. join_server: join by invite (opens the browser — solves the check there). Anything interactive (profile picture, voice, captcha) → browser_account.",
		parameters: z.object({
			action: z.enum([
				"servers",
				"server_info",
				"members",
				"history",
				"send",
				"open_dm",
				"react",
				"profile",
				"join_server",
			]),
			server: serverRef.optional(),
			channel: channelRef,
			chat: z.string().optional().describe("A group chat name, or a person's username for a DM"),
			chatId: z.string().optional().describe("A DM/group/server channel id, when you have it"),
			user: z.string().optional().describe("A Discord user id (for open_dm)"),
			text: z.string().optional().describe("send: the message"),
			messageId: z.string().optional().describe("react/history: the message (id)"),
			emoji: z.string().optional().describe("react: the emoji"),
			name: z.string().optional().describe("profile: a new display name"),
			bio: z.string().optional().describe("profile: a new bio (about me)"),
			invite: z.string().optional().describe("join_server: an invite link or code"),
			limit: z.number().int().min(1).max(50).optional().describe("history/members: how many (default 25)"),
			on: z.string().optional().describe('join_server: where to browse ("computer", "device", "server")'),
		}),
		risk: "external",
		available: hasAccount,
		title: (a) =>
			({
				servers: "Listed Discord servers",
				server_info: "Looked at a server",
				members: "Listed server members",
				history: "Read messages",
				send: `Messaged ${a.chat ?? a.channel ?? "a chat"} on Discord`,
				open_dm: "Opened a DM",
				react: "Reacted on Discord",
				profile: "Changed the Discord profile",
				join_server: "Joined a Discord server",
			})[a.action],
		async execute(args, ctx) {
			const { token } = await requireAccount(ctx);

			switch (args.action) {
				case "servers": {
					const guilds = await guildsOf(token);
					if (!guilds.length) return "Your account isn't in any server yet.";
					return guilds
						.map(
							(g) =>
								`${g.name} (${g.id})${g.approximate_member_count ? ` · ~${g.approximate_member_count} people` : ""}`,
						)
						.join("\n");
				}

				case "server_info": {
					const guild = await resolveGuild(token, args.server ?? "");
					const channels = await api<ApiGuildChannel[]>(token, "GET", `/guilds/${guild.id}/channels`).catch(
						() => [],
					);
					const text = channels.filter((c) => c.type === 0 || c.type === 5).map((c) => `#${c.name}`);
					const voice = channels.filter((c) => c.type === 2 || c.type === 13).map((c) => c.name);
					return [
						`${guild.name} (${guild.id})${guild.description ? ` — ${guild.description}` : ""}`,
						`Text channels: ${text.slice(0, 40).join(", ") || "none you can see"}`,
						`Voice channels: ${voice.slice(0, 20).join(", ") || "none"}`,
					].join("\n");
				}

				case "members": {
					const guild = await resolveGuild(token, args.server ?? "");
					const members = await api<ApiMember[]>(
						token,
						"GET",
						`/guilds/${guild.id}/members?limit=${args.limit ?? 25}`,
					).catch((err: unknown) => {
						throw new ToolError(`Couldn't list members: ${errorMessage(err)}`);
					});
					if (!members.length) return "No members (or no access).";
					return members
						.map(
							(m) =>
								`${m.nick ?? m.user?.global_name ?? m.user?.username ?? "?"} (@${m.user?.username ?? "?"})${m.user?.bot ? " · bot" : ""}`,
						)
						.join("\n");
				}

				case "history": {
					let channelId = args.chatId?.trim() ?? "";
					if (!channelId && args.server) {
						const guild = await resolveGuild(token, args.server);
						channelId = (await resolveChannel(token, guild.id, args.channel ?? "")).id;
					} else if (!channelId && args.chat) {
						channelId = await resolveChat(token, args.chat);
					}
					if (!channelId) throw new ToolError("Say where: a server (+ channel), a chat, or a channel id.");
					const limit = args.limit ?? 25;
					const msgs = await api<ApiMessage[]>(
						token,
						"GET",
						`/channels/${channelId}/messages?limit=${limit}${args.messageId ? `&around=${args.messageId}` : ""}`,
					).catch((err: unknown) => {
						throw new ToolError(`Couldn't read: ${errorMessage(err)}`);
					});
					if (!msgs.length) return "No messages.";
					return msgs
						.reverse()
						.map(
							(m) =>
								`${m.author?.global_name ?? m.author?.username ?? "?"}: ${(m.content ?? "").slice(0, 400)}`,
						)
						.join("\n");
				}

				case "send": {
					const text = args.text?.trim();
					if (!text) throw new ToolError("send needs text.");
					let channelId = args.chatId?.trim() ?? "";
					if (!channelId && args.server) {
						const guild = await resolveGuild(token, args.server);
						channelId = (await resolveChannel(token, guild.id, args.channel ?? "")).id;
					} else if (!channelId && args.chat) {
						channelId = await resolveChat(token, args.chat);
					}
					if (!channelId) throw new ToolError("Say where: a server (+ channel), a chat, or a channel id.");
					await api(token, "POST", `/channels/${channelId}/messages`, {
						content: text.slice(0, 1900),
						allowed_mentions: { parse: [] },
					}).catch((err: unknown) => {
						throw new ToolError(`Discord didn't send it: ${errorMessage(err)}`);
					});
					return "Sent as your account.";
				}

				case "open_dm": {
					const userId = (args.user ?? "").trim();
					if (!/^\d{15,25}$/.test(userId))
						throw new ToolError("open_dm needs the person's Discord user id (the numbers).");
					const ch = await api<ApiDm>(token, "POST", "/users/@me/channels", { recipient_id: userId }).catch(
						(err: unknown) => {
							throw new ToolError(`Couldn't open the DM: ${errorMessage(err)}`);
						},
					);
					const who = ch.recipients?.[0];
					return `DM open with @${who?.username ?? userId} (channel ${ch.id}). Send with discord action send chatId ${ch.id}.`;
				}

				case "react": {
					if (!args.chatId || !args.messageId || !args.emoji) {
						throw new ToolError("react needs chatId, messageId and emoji.");
					}
					await api(
						token,
						"PUT",
						`/channels/${args.chatId}/messages/${args.messageId}/reactions/${encodeURIComponent(args.emoji)}/@me`,
					).catch((err: unknown) => {
						throw new ToolError(`Couldn't react: ${errorMessage(err)}`);
					});
					return "Reacted.";
				}

				case "profile": {
					const body: Record<string, string> = {};
					if (args.name) body.global_name = args.name;
					if (args.bio !== undefined) body.bio = args.bio;
					if (!Object.keys(body).length) throw new ToolError("profile needs a new name and/or bio.");
					await api(token, "PATCH", "/users/@me", body).catch((err: unknown) => {
						throw new ToolError(`Couldn't update the profile: ${errorMessage(err)}`);
					});
					return "Profile updated.";
				}

				case "join_server": {
					const raw = (args.invite ?? "").trim();
					const code = raw.match(/(?:discord\.gg\/|discord\.com\/invite\/)?([\w-]+)\/?$/i)?.[1];
					if (!code) throw new ToolError("join_server needs an invite link or code.");
					// Joins hit a captcha on the API, so this is done in the browser (a real signed-in session).
					const { s, account } = await discordSession(ctx, args.on);
					await s.page.goto(`https://discord.com/invite/${code}`, {
						waitUntil: "domcontentloaded",
						timeout: 60_000,
					});
					await s.page.waitForTimeout(1200);
					if (s.page.url().includes("/login")) {
						await s.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
						await s.page.waitForTimeout(1500);
					}
					await settle(s.page);
					const accept = s.page.getByRole("button", { name: /accept invite|join|continue/i }).first();
					if (await accept.count().catch(() => 0)) {
						await accept.click().catch(() => {});
						await settle(s.page);
					}
					const rotated = await adoptFreshToken(s, account);
					return (
						"Opened the invite as your account and accepted if a Join/Accept button was there. " +
						"If a captcha or check is up, solve it with browser_click / browser_screenshot" +
						(s.where === "computer"
							? ", or tell the user — they can take over your computer and tick it themselves"
							: "") +
						". Current page:\n" +
						(await describePage(s)) +
						(rotated ? "\n\n(The account's token rotated after the check; I stored the new one.)" : "")
					);
				}
			}
		},
	}),
];
