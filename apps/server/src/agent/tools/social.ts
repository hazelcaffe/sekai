import { z } from "zod";
import { type BrowserSession, browserFor, describePage, settle } from "../../browser/engine.ts";
import { errorMessage } from "../../lib/errors.ts";
import { log } from "../../lib/log.ts";
import { type SocialPlatform, socialSessionCookie, storedSocial } from "../../social/store.ts";
import { defineTool, type ToolContext, ToolError } from "./types.ts";

const HAS: Record<SocialPlatform, (agent: { id: string }) => Promise<boolean>> = {
	instagram: async (a) => Boolean(await storedSocial(a.id, "instagram")),
	tiktok: async (a) => Boolean(await storedSocial(a.id, "tiktok")),
};

const HOME: Record<SocialPlatform, string> = {
	instagram: "https://www.instagram.com/",
	tiktok: "https://www.tiktok.com/",
};
const DOMAIN: Record<SocialPlatform, string> = {
	instagram: ".instagram.com",
	tiktok: ".tiktok.com",
};
const TITLE: Record<SocialPlatform, string> = { instagram: "Instagram", tiktok: "TikTok" };

/** The bot's browser, with its account's cookies injected (kept fresh across opens). */
async function socialSession(ctx: ToolContext, platform: SocialPlatform, on?: string): Promise<BrowserSession> {
	const account = await storedSocial(ctx.agent.id, platform);
	if (!account) {
		throw new ToolError(`You don't have an ${TITLE[platform]} account; the user adds one under Accounts.`);
	}
	const s = await browserFor(ctx.agent.id, on);
	// Inject the session cookie every time: it expires, and the store holds the newest.
	const value = await socialSessionCookie(ctx.agent.id, platform);
	if (value) {
		const cookies = [
			{ name: "sessionid", value, domain: DOMAIN[platform], path: "/", httpOnly: true, secure: true },
		];
		if (platform === "instagram" && account.userId) {
			cookies.push({
				name: "ds_user_id",
				value: account.userId,
				domain: DOMAIN[platform],
				path: "/",
				httpOnly: true,
				secure: true,
			});
		}
		const anyS = s.context as unknown as { __sekaiSocial?: string };
		const marker = `${platform}:${value.slice(0, 12)}`;
		if (anyS.__sekaiSocial !== marker) {
			await s.context
				.addCookies(cookies)
				.then(() => {
					anyS.__sekaiSocial = marker;
				})
				.catch((err: unknown) => log.warn(`${platform} cookie injection: ${errorMessage(err)}`));
		}
	}
	return s;
}

async function openSocial(s: BrowserSession, platform: SocialPlatform, path: string): Promise<string> {
	const url = path.startsWith("http") ? path : `${HOME[platform]}${path.replace(/^\//, "")}`;
	const current = s.page.url();
	if (current.startsWith(HOME[platform]) && !/accounts\/login|\/login/.test(current)) {
		await s.page.evaluate(`window.location.href = ${JSON.stringify(url)}`);
	} else {
		await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
	}
	await s.page.waitForTimeout(1500);
	// Signed out? The cookie needs a reload to take on a fresh document.
	if (/\/login|accounts\/login/.test(s.page.url())) {
		await s.page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
		await s.page.waitForTimeout(1500);
	}
	await settle(s.page);
	const note =
		`You're signed in to ${TITLE[platform]} as your account, in your browser (${s.label}) — say if you can't see it. ` +
		"Click around like a person would. If it asks you to log in or verify, tell the user — " +
		"they can sign in on your computer, or give you the login with browser_login.";
	return `${note}\n${await describePage(s)}`;
}

// ---------------------------------------------------------------- Instagram web API (best-effort)

interface IgThread {
	thread_id: string;
	thread_title?: string;
	users?: { pk: number | string; username?: string; full_name?: string }[];
	items?: { item_id?: string; text?: string; user_id?: number | string }[];
}

async function igApi<T>(sessionId: string, path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`https://i.instagram.com/api/v1${path}`, {
		...init,
		headers: {
			cookie: `sessionid=${sessionId}`,
			"user-agent": "Instagram 219.0.0.12.117 Android",
			"x-ig-app-id": "936619743392459",
			...(init?.headers ?? {}),
		},
	});
	const data = (await res.json().catch(() => null)) as (T & { message?: string; status?: string }) | null;
	if (!res.ok) {
		const err = new Error(data?.message ?? res.statusText) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return data as T;
}

async function igUserId(sessionId: string, username: string): Promise<string> {
	const r = await igApi<{ user?: { pk?: number | string } }>(
		sessionId,
		`/users/web_profile_info/?username=${encodeURIComponent(username)}`,
	);
	const id = r?.user?.pk;
	if (!id) throw new ToolError(`No Instagram account @${username}.`);
	return String(id);
}

// The Instagram toolset. Reading/posting uses the web API when it answers; anything interactive
// (and TikTok, whose API signs requests) opens the account in the bot's signed-in browser.
export const socialTools = [
	defineTool({
		name: "browser_social",
		category: "browser",
		description:
			"Open your own Instagram or TikTok account in your browser, signed in as it. Use it for anything on that app: watch videos/reels, scroll your feed, post, reply to comments, change the profile, read and answer DMs — by clicking like a person. For Instagram DMs/posts without a browser, use instagram_dm / instagram_post.",
		parameters: z.object({
			platform: z.enum(["instagram", "tiktok"]),
			page: z
				.string()
				.optional()
				.describe("Where to go: a path like 'direct/inbox/', 'reels/', '@someone', or a full URL"),
			on: z
				.string()
				.optional()
				.describe(
					'Where to browse: "computer", "device", or "server". Default: where your browser already is.',
				),
		}),
		risk: "external",
		available: async (agent) => (await HAS.instagram(agent)) || (await HAS.tiktok(agent)),
		title: (a) => `Opened ${a.platform === "instagram" ? "Instagram" : "TikTok"} as their account`,
		async execute(args, ctx) {
			const s = await socialSession(ctx, args.platform, args.on);
			return openSocial(s, args.platform, args.page ?? "");
		},
	}),

	defineTool({
		name: "instagram_dm",
		category: "contact",
		description:
			"Read or send Instagram Direct messages as your account. inbox: recent threads. read: a thread's messages. send: message someone (user id, or username). Replies to DMs that arrive in Sekai are already sent as the account.",
		parameters: z.object({
			action: z.enum(["inbox", "read", "send"]),
			threadId: z.string().optional().describe("read: the thread id"),
			user: z.string().optional().describe("send: a username (@name) or user id"),
			text: z.string().optional().describe("send: the message"),
			limit: z.number().int().min(1).max(50).optional(),
		}),
		risk: "external",
		available: HAS.instagram,
		title: (a) =>
			({ inbox: "Read Instagram DMs", read: "Read an Instagram chat", send: "Sent an Instagram DM" })[a.action],
		async execute(args, ctx) {
			const account = await storedSocial(ctx.agent.id, "instagram");
			if (!account) throw new ToolError("You don't have an Instagram account; the user adds one under Accounts.");
			const sid = account.sessionId;
			try {
				if (args.action === "inbox") {
					const r = await igApi<{ threads?: IgThread[] }>(sid, `/direct_v2/inbox/?limit=${args.limit ?? 20}`);
					const threads = r.threads ?? [];
					if (!threads.length) return "No Instagram chats.";
					return threads
						.map((t) => {
							const last = t.items?.[0]?.text ?? "";
							return `${t.thread_title ?? t.users?.[0]?.username ?? "?"} (${t.thread_id})${last ? `: ${last.slice(0, 80)}` : ""}`;
						})
						.join("\n");
				}
				if (args.action === "read") {
					if (!args.threadId) throw new ToolError("read needs a threadId.");
					const r = await igApi<{ thread?: IgThread }>(
						sid,
						`/direct_v2/threads/${args.threadId}/?limit=${args.limit ?? 20}`,
					);
					const items = r.thread?.items ?? [];
					if (!items.length) return "No messages.";
					return items
						.slice()
						.reverse()
						.map(
							(m) =>
								`${String(m.user_id) === account.userId ? "You" : `@${r.thread?.users?.[0]?.username ?? m.user_id}`}: ${(m.text ?? "").slice(0, 300)}`,
						)
						.join("\n");
				}
				// send
				const text = args.text?.trim();
				if (!text) throw new ToolError("send needs text.");
				if (!args.user) throw new ToolError("send needs a username or user id.");
				const userId = /^\d+$/.test(args.user) ? args.user : await igUserId(sid, args.user.replace(/^@/, ""));
				await igApi(sid, "/direct_v2/threads/broadcast/text/", {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						recipient_users: `["${userId}"]`,
						action: "send_item",
						text: text.slice(0, 1000),
					}).toString(),
				});
				return `Sent to @${args.user.replace(/^@/, "")}.`;
			} catch (err) {
				const m = errorMessage(err);
				if (/login|401|403|checkpoint|challenge/i.test(m)) {
					throw new ToolError(
						`Instagram wouldn't do that with the saved session (${m}). Use browser_social to do it in your browser, or tell the user the session needs a fresh cookie.`,
					);
				}
				throw new ToolError(m.slice(0, 300));
			}
		},
	}),

	defineTool({
		name: "instagram_post",
		category: "contact",
		description:
			"Post a photo to your Instagram feed. The image must be a public https link or a file from this chat. For reels/videos/stories, use browser_social and post by clicking.",
		parameters: z.object({
			image: z.string().min(1).describe("An https image link, or a file from this chat"),
			caption: z.string().max(2200).optional(),
		}),
		risk: "external",
		available: HAS.instagram,
		title: () => "Posted on Instagram",
		async execute(args, ctx) {
			const account = await storedSocial(ctx.agent.id, "instagram");
			if (!account) throw new ToolError("You don't have an Instagram account; the user adds one under Accounts.");
			// The web API's upload flow is the fragile part; do it, and fall back to the browser on a refusal.
			let imageData: Uint8Array;
			if (/^https:\/\//.test(args.image)) {
				const res = await fetch(args.image, { signal: AbortSignal.timeout(30_000) });
				if (!res.ok) throw new ToolError(`Couldn't download the image (${res.status}).`);
				imageData = new Uint8Array(await res.arrayBuffer());
			} else {
				const local = args.image.match(/\/api\/uploads\/([\w-]+)/)?.[1];
				if (!local) throw new ToolError("The image must be an https link or a file from this chat.");
				const { getUploadRow } = await import("../../services/uploads.ts");
				const row = await getUploadRow(local).catch(() => null);
				if (!row) throw new ToolError("That file isn't here anymore.");
				imageData = new Uint8Array(await Bun.file(row.path).arrayBuffer());
			}
			const uploadId = String(Date.now());
			try {
				const res = await fetch(`https://i.instagram.com/rupload_igphoto/fb_uplink_${uploadId}`, {
					method: "POST",
					headers: {
						cookie: `sessionid=${account.sessionId}`,
						"x-ig-app-id": "936619743392459",
						"x-instagram-rupload-params": JSON.stringify({
							media_type: 1,
							upload_id: uploadId,
							upload_media_height: imageData.length % 1440 || 1080,
							upload_media_width: imageData.length % 1080 || 1080,
						}),
						"content-type": "application/octet-stream",
					},
					body: imageData,
				});
				const up = (await res.json().catch(() => null)) as { upload_id?: string; status?: string } | null;
				if (!res.ok || !up?.upload_id) throw new Error(up?.status ?? res.statusText);
				await igApi(account.sessionId, "/media/configure/", {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						upload_id: up.upload_id,
						caption: args.caption ?? "",
					}).toString(),
				});
				return "Posted to your Instagram feed.";
			} catch (err) {
				throw new ToolError(
					`Couldn't post with the API (${errorMessage(err)}). Use browser_social to post it by clicking instead.`,
				);
			}
		},
	}),
];
