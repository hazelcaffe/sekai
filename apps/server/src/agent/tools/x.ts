import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { getUploadRow } from "../../services/uploads.ts";
import { dropClient, xAccountOf, xClient } from "../../x/accounts.ts";
import { defineTool, ToolError } from "./types.ts";

/** A post id from an id or an x.com / twitter.com link. */
function postId(ref: string): string {
	const id = ref.match(/status(?:es)?\/(\d{5,25})/)?.[1] ?? ref.match(/^\d{5,25}$/)?.[0];
	if (!id) throw new ToolError(`“${ref}” isn't a post id or link`);
	return id;
}

const handleOf = (h: string) =>
	h
		.trim()
		.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
		.replace(/^@/, "")
		.replace(/[/?#].*$/, "");

interface TweetLike {
	id: string;
	text?: string;
	created_at?: string;
	user?: { id?: string; username?: string; name?: string } | null;
	stats?: Record<string, { count?: number } | number | undefined>;
	in_reply_to_status_id?: string | null;
	retweeting?: unknown;
	quoting?: TweetLike | null;
	media?: unknown[];
	tombstone?: boolean;
}

function stat(t: TweetLike, k: string): number | undefined {
	const v = t.stats?.[k];
	return typeof v === "number" ? v : v?.count;
}

/** A post, compact enough for a model to read. */
function show(raw: unknown) {
	const t = raw as TweetLike;
	if (t.tombstone) return { id: t.id, unavailable: true, text: t.text };
	const user = t.user?.username ?? "i";
	return {
		id: t.id,
		url: `https://x.com/${user}/status/${t.id}`,
		author: t.user ? `@${t.user.username} (${t.user.name})` : undefined,
		text: t.text,
		at: t.created_at,
		replying_to: t.in_reply_to_status_id ?? undefined,
		quoting: t.quoting ? { author: `@${t.quoting.user?.username}`, text: t.quoting.text } : undefined,
		repost: t.retweeting ? true : undefined,
		media: t.media?.length || undefined,
		likes: stat(t, "likes"),
		reposts: stat(t, "retweets"),
		replies: stat(t, "replies"),
	};
}

/** Runs an X call; an auth failure drops the session so the next call signs in again. */
async function withX<T>(
	agentId: string,
	fn: (client: Awaited<ReturnType<typeof xClient>>["client"]) => Promise<T>,
): Promise<T> {
	const { client } = await xClient(agentId);
	try {
		return await fn(client);
	} catch (err) {
		const m = errorMessage(err);
		const e = err as { status?: number; rateLimit?: { reset?: number } };
		if (e.status === 429) {
			const when = e.rateLimit?.reset ? new Date(e.rateLimit.reset * 1000).toLocaleTimeString() : "a few minutes";
			throw new ToolError(`X is rate limiting this account; try again after ${when}.`);
		}
		if (e.status === 401 || /auth|denied|suspend|locked/i.test(m)) dropClient(agentId, m);
		throw new ToolError(`X: ${m}`);
	}
}

/** The account's post came back (emusks returns X's raw reply when it doesn't). */
function created(res: unknown): TweetLike {
	const t = res as TweetLike & { errors?: { message?: string }[] };
	if (!t?.id) throw new ToolError(`X didn't post it: ${t?.errors?.[0]?.message ?? "no reason given"}`);
	return t;
}

const hasX = async (agent: { id: string }) => Boolean(await xAccountOf(agent.id));

async function imageData(ref: string): Promise<Uint8Array> {
	const local = ref.match(/\/api\/uploads\/([\w-]+)/)?.[1];
	if (local) {
		const row = await getUploadRow(local).catch(() => null);
		if (!row) throw new ToolError(`No file ${ref}`);
		return new Uint8Array(await Bun.file(row.path).arrayBuffer());
	}
	if (!/^https:\/\//.test(ref)) throw new ToolError("Images must be https links or files from this chat");
	const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new ToolError(`Couldn't download ${ref} (${res.status})`);
	return new Uint8Array(await res.arrayBuffer());
}

export const xTools = [
	defineTool({
		name: "x_post",
		category: "x",
		description:
			"Post on X from your account: a new post, a reply (reply_to) or a quote (quote). Up to 280 characters. images: up to 4 https links or screenshots/files from this chat. Only post what the user asked for.",
		parameters: z.object({
			text: z.string().min(1).max(280),
			reply_to: z.string().optional().describe("Post id or link to reply to"),
			quote: z.string().optional().describe("Post id or link to quote"),
			images: z.array(z.string()).max(4).optional(),
		}),
		risk: "external",
		available: hasX,
		title: (a) => (a.reply_to ? "Replied on X" : a.quote ? "Quoted a post on X" : "Posted on X"),
		async execute(args, ctx) {
			return withX(ctx.agent.id, async (x) => {
				const mediaIds: string[] = [];
				for (const ref of args.images ?? []) {
					const up = await x.media.create(await imageData(ref));
					mediaIds.push(String(up.media_id));
				}
				const t = created(
					await x.tweets.create(args.text, {
						...(args.reply_to ? { replyTo: postId(args.reply_to) } : {}),
						...(args.quote ? { quoteTweetId: postId(args.quote) } : {}),
						...(mediaIds.length ? { mediaIds } : {}),
					}),
				);
				return { posted: show(t) };
			});
		},
	}),
	defineTool({
		name: "x_delete",
		category: "x",
		description: "Delete one of your posts on X.",
		parameters: z.object({ post: z.string() }),
		risk: "destructive",
		available: hasX,
		title: () => "Deleted a post on X",
		async execute(args, ctx) {
			const id = postId(args.post);
			await withX(ctx.agent.id, (x) => x.tweets.remove(id));
			return { deleted: id };
		},
	}),
	defineTool({
		name: "x_react",
		category: "x",
		description: "Like, repost or bookmark a post on X (undo: true to take it back).",
		parameters: z.object({
			post: z.string(),
			action: z.enum(["like", "repost", "bookmark"]),
			undo: z.boolean().optional(),
		}),
		risk: "external",
		available: hasX,
		title: (a) =>
			`${a.undo ? "Undid" : a.action === "like" ? "Liked" : a.action === "repost" ? "Reposted" : "Bookmarked"} a post on X`,
		async execute(args, ctx) {
			const id = postId(args.post);
			await withX(ctx.agent.id, (x) => {
				if (args.action === "like") return args.undo ? x.tweets.unlike(id) : x.tweets.like(id);
				if (args.action === "repost") return args.undo ? x.tweets.unretweet(id) : x.tweets.retweet(id);
				return args.undo ? x.bookmarks.remove(id) : x.bookmarks.create(id);
			});
			return { done: true };
		},
	}),
	defineTool({
		name: "x_follow",
		category: "x",
		description: "Follow (or unfollow, undo: true) someone on X.",
		parameters: z.object({ handle: z.string(), undo: z.boolean().optional() }),
		risk: "external",
		available: hasX,
		title: (a) => `${a.undo ? "Unfollowed" : "Followed"} @${handleOf(a.handle)} on X`,
		async execute(args, ctx) {
			return withX(ctx.agent.id, async (x) => {
				const u = await x.users.getByUsername(handleOf(args.handle));
				if (!u?.id) throw new ToolError(`No account @${handleOf(args.handle)}`);
				await (args.undo ? x.users.unfollow(String(u.id)) : x.users.follow(String(u.id)));
				return { done: true };
			});
		},
	}),
	defineTool({
		name: "x_search",
		category: "x",
		description:
			"Search posts on X (supports X's operators: from:, to:, @, since:, filter:media, -word…). latest: newest first instead of top.",
		parameters: z.object({
			query: z.string().min(1),
			latest: z.boolean().optional(),
			count: z.number().int().min(1).max(40).optional(),
		}),
		risk: "read",
		available: hasX,
		title: (a) => `Searched X for “${a.query}”`,
		async execute(args, ctx) {
			return withX(ctx.agent.id, async (x) => {
				const opts = { count: args.count ?? 15 };
				const page = args.latest
					? await x.search.latest(args.query, opts)
					: await x.search.tweets(args.query, opts);
				return { posts: page.tweets.slice(0, args.count ?? 15).map(show) };
			});
		},
	}),
	defineTool({
		name: "x_read",
		category: "x",
		description: "Read a post on X and the replies under it.",
		parameters: z.object({ post: z.string() }),
		risk: "read",
		available: hasX,
		title: () => "Read a post on X",
		async execute(args, ctx) {
			const id = postId(args.post);
			return withX(ctx.agent.id, async (x) => {
				const thread = await x.tweets.detail(id).catch(() => null);
				if (thread?.tweets?.length) return { thread: thread.tweets.slice(0, 25).map(show) };
				return { post: show(await x.tweets.get(id)) };
			});
		},
	}),
	defineTool({
		name: "x_profile",
		category: "x",
		description: "Look up someone on X: their profile and recent posts.",
		parameters: z.object({ handle: z.string(), posts: z.number().int().min(0).max(30).optional() }),
		risk: "read",
		available: hasX,
		title: (a) => `Looked up @${handleOf(a.handle)} on X`,
		async execute(args, ctx) {
			return withX(ctx.agent.id, async (x) => {
				const u = (await x.users.getByUsername(handleOf(args.handle))) as unknown as {
					id?: string;
					username?: string;
					name?: string;
					description?: string;
					stats?: Record<string, { count?: number }>;
					verification?: unknown;
				};
				if (!u?.id) throw new ToolError(`No account @${handleOf(args.handle)}`);
				const n = args.posts ?? 10;
				const posts = n
					? ((await x.users.tweets(String(u.id), { count: n }).catch(() => null))?.tweets ?? [])
					: [];
				return {
					profile: {
						handle: `@${u.username}`,
						name: u.name,
						bio: u.description,
						followers: u.stats?.followers?.count,
						following: u.stats?.following?.count,
					},
					posts: posts.slice(0, n).map(show),
				};
			});
		},
	}),
	defineTool({
		name: "x_timeline",
		category: "x",
		description: "Your X feed: the home timeline, or posts that mention you.",
		parameters: z.object({
			which: z.enum(["home", "mentions"]),
			count: z.number().int().min(1).max(40).optional(),
		}),
		risk: "read",
		available: hasX,
		title: (a) => (a.which === "home" ? "Read the X feed" : "Checked mentions on X"),
		async execute(args, ctx) {
			return withX(ctx.agent.id, async (x) => {
				const n = args.count ?? 15;
				if (args.which === "home")
					return { posts: (await x.timelines.homeLatest({ count: n })).tweets.slice(0, n).map(show) };
				const page = await x.notifications.timeline({ timeline_type: "Mentions", count: n });
				const tweets = [...page.tweets, ...page.notifications.flatMap((m) => m.tweets)];
				return { mentions: tweets.slice(0, n).map(show) };
			});
		},
	}),
];
