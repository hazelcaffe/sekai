import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
	type McpServer,
	McpServerCreate,
	type McpServerCreate as McpServerCreateInput,
	type McpServerStatus,
	McpServerUpdate,
	type McpServerUpdate as McpServerUpdateInput,
	type McpServerWithStatus,
	type McpToolInfo,
	type McpTransport,
} from "@sekai/shared";
import { and, asc, eq, or } from "drizzle-orm";
import { actorFor, currentActor, requirePermission } from "../auth/actor.ts";
import { APP_NAME, APP_VERSION } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { errorMessage, HttpError, notFound, parse } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { guardedFetch, reachOf } from "../lib/net.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { isMine, newOwner } from "../services/visibility.ts";
import { McpOAuthProvider, OAUTH_CALLBACK_PATH, type OAuthState, readOAuth, writeOAuth } from "./oauth.ts";

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 180_000;

interface Connection {
	client: Client | null;
	status: McpServerStatus;
	connecting: Promise<McpServerStatus> | null;
	stderr: string[];
}

const connections = new Map<string, Connection>();

function emptyStatus(serverId: string): McpServerStatus {
	return { serverId, state: "disconnected", error: null, authUrl: null, tools: [], connectedAt: null };
}

function conn(serverId: string): Connection {
	let c = connections.get(serverId);
	if (!c) {
		c = { client: null, status: emptyStatus(serverId), connecting: null, stderr: [] };
		connections.set(serverId, c);
	}
	return c;
}

function setStatus(serverId: string, patch: Partial<McpServerStatus>): McpServerStatus {
	const c = conn(serverId);
	c.status = { ...c.status, ...patch };
	bus.emit({ type: "mcp.changed", serverId });
	return c.status;
}

export function getStatus(serverId: string): McpServerStatus {
	return conn(serverId).status;
}

// ---------------------------------------------------------------- CRUD

type Row = typeof schema.mcpServers.$inferSelect;

// ---------------------------------------------------------------- secrets in transports

/** Header values and env values that look like credentials are sealed at rest and masked for the app. */
const SECRET_KEY = /auth|token|key|secret|pass|cookie|session|credential|bearer/i;
const MASK = "••••••••";

function secretEntries(t: McpTransport): Record<string, string> {
	return t.type === "stdio" ? t.env : t.headers;
}

/** Applies fn to every header value, and to env values with a credential-like name. */
function mapSecrets(t: McpTransport, fn: (key: string, value: string) => string): McpTransport {
	const next = Object.fromEntries(
		Object.entries(secretEntries(t)).map(([k, v]) => [k, t.type !== "stdio" || SECRET_KEY.test(k) ? fn(k, v) : v]),
	);
	return t.type === "stdio" ? { ...t, env: next } : { ...t, headers: next };
}

const sealTransport = (t: McpTransport) => mapSecrets(t, (_k, v) => (v.startsWith("v1:") ? v : seal(v)));
const openTransport = (t: McpTransport) =>
	mapSecrets(t, (_k, v) => {
		try {
			return v.startsWith("v1:") ? unseal(v) : v;
		} catch {
			return "";
		}
	});
const maskTransport = (t: McpTransport) => mapSecrets(t, (_k, v) => (v ? `${MASK}${v.slice(-4)}` : ""));

/** An update's transport, with masked values (sent back unchanged by the app) replaced by the stored ones. */
function mergeTransport(next: McpTransport, stored: McpTransport): McpTransport {
	const old = secretEntries(stored);
	return mapSecrets(next, (k, v) => (v.startsWith(MASK) && old[k] ? old[k] : v));
}

/** The server with its real credentials (for connecting). */
function toServer(row: Row): McpServer {
	const { oauth, ...rest } = row;
	const st = readOAuth(oauth);
	return {
		...rest,
		transport: openTransport(rest.transport),
		oauth: st ? { signedIn: Boolean(st.tokens?.access_token) } : null,
	};
}

/** What the app sees: credentials masked. */
export function publicServer<T extends McpServer>(s: T): T {
	return { ...s, transport: maskTransport(s.transport) };
}

/**
 * Apps are each person's own; an admin can let everyone's bots use one of theirs. Only admins add apps that run as
 * a program on this server (stdio), or that live on your own network.
 */
function visibleWhere(actor = currentActor()) {
	return actor ? or(eq(schema.mcpServers.userId, actor.userId), eq(schema.mcpServers.everyone, true)) : undefined;
}

/** Whether a person's bots may use a server: their own, or one shared with everyone. */
export function serverUsableBy(server: Pick<McpServer, "userId" | "everyone">, actor = currentActor()): boolean {
	return !actor || server.userId === actor.userId || server.everyone;
}

/** Throws unless the acting person may change this app (it's theirs). */
function requireOwnServer(server: Pick<McpServer, "userId" | "title">): void {
	if (!isMine(server.userId)) throw new HttpError(403, `${server.title} is an admin's app: only they can change it.`);
}

/** For routes about one app: it must be the acting person's own (an admin's shared app is theirs to change). */
export async function requireOwnServerById(id: string): Promise<void> {
	const row = await getRow(id);
	if (!row || !serverUsableBy(row)) throw notFound("App");
	requireOwnServer(row);
}

/** stdio servers run a program on this machine: admins only. Remote ones: the internet, unless you're an admin. */
async function checkTransport(t: McpTransport): Promise<void> {
	const actor = currentActor();
	if (!actor || actor.admin) return;
	if (t.type === "stdio") throw new HttpError(403, "Only admins can add apps that run as a program on the server.");
	const reach = await reachOf(new URL(t.url)).catch(() => "local" as const);
	if (reach !== "public") throw new HttpError(403, "Apps must be on the internet (not this server or its network).");
}

/**
 * fetch for a server's remote transport and sign-in. An admin's apps may be anywhere (one on this machine, say);
 * everyone else's are checked at every address they go to, redirects too (see guardedFetch).
 */
async function fetchFor(serverUserId: string): Promise<FetchLike> {
	const owner = await actorFor(serverUserId).catch(() => null);
	if (owner?.admin) return (url, init) => fetch(url, init);
	return (url, init) => guardedFetch(new URL(String(url)), { ...(init as RequestInit) });
}

export async function listServers(): Promise<McpServer[]> {
	return (await db.select().from(schema.mcpServers).where(visibleWhere()).orderBy(asc(schema.mcpServers.title))).map(
		toServer,
	);
}

async function getRow(id: string): Promise<Row | null> {
	return (await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, id) })) ?? null;
}

export async function listServersWithStatus(): Promise<McpServerWithStatus[]> {
	return (await listServers()).map((s) => publicServer({ ...s, status: getStatus(s.id) }));
}

export async function getServer(id: string): Promise<McpServer | null> {
	const row = await getRow(id);
	return row && serverUsableBy(row) ? toServer(row) : null;
}

async function requireServer(id: string): Promise<McpServer> {
	const s = await getServer(id);
	if (!s) throw notFound("MCP server");
	return s;
}

/** A free name for a new server: "github", then "github-2"… (names are unique per person). */
async function freeName(base: string, userId: string): Promise<string> {
	const taken = new Set(
		(
			await db
				.select({ name: schema.mcpServers.name })
				.from(schema.mcpServers)
				.where(eq(schema.mcpServers.userId, userId))
		).map((r) => r.name),
	);
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const name = `${base.slice(0, 37)}-${i}`;
		if (!taken.has(name)) return name;
	}
}

export async function createServer(input: McpServerCreateInput): Promise<McpServerWithStatus> {
	const { oauth, agentIds, ...data } = parse(McpServerCreate, input);
	requirePermission("apps");
	await checkTransport(data.transport);
	const userId = newOwner();
	if (data.everyone) requirePermission("admin");
	// From the app store, the same app can be added twice (two GitHub accounts): number the name.
	if (data.catalogId) data.name = await freeName(data.name, userId);
	const clash = await db.query.mcpServers.findFirst({
		where: and(eq(schema.mcpServers.name, data.name), eq(schema.mcpServers.userId, userId)),
	});
	if (clash) throw new HttpError(409, `An MCP server named "${data.name}" already exists`);
	if (oauth && data.transport.type === "stdio") throw new HttpError(400, "Sign-in only works for remote servers");
	const firstState: OAuthState | null = oauth
		? {
				...(oauth.clientId
					? {
							ownClient: true,
							client: {
								client_id: oauth.clientId,
								...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
							},
						}
					: {}),
				...(oauth.scope ? { scope: oauth.scope } : {}),
				...(Object.keys(oauth.params).length ? { params: oauth.params } : {}),
			}
		: null;
	const now = Date.now();
	const id = ID.mcp();
	await db.insert(schema.mcpServers).values({
		id,
		userId,
		...data,
		transport: sealTransport(data.transport),
		oauth: firstState ? seal(JSON.stringify(firstState)) : null,
		createdAt: now,
		updatedAt: now,
	});
	// "Only these bots": turn it on for them right away.
	if (data.scope === "agents" && agentIds.length) {
		for (const a of await db.select().from(schema.agents).where(eq(schema.agents.userId, userId))) {
			if (!agentIds.includes(a.id) || a.mcp.some((b) => b.serverId === id)) continue;
			await db
				.update(schema.agents)
				.set({ mcp: [...a.mcp, { serverId: id, tools: null }] })
				.where(eq(schema.agents.id, a.id));
			bus.emit({ type: "agent.updated", agent: await toAgentById(a.id) }, { to: [userId] });
		}
	}
	const server = await requireServer(id);
	bus.emit({ type: "mcp.changed", serverId: id });
	// Apps that sign in wait for you; the others connect now.
	if (server.enabled && !oauth) void connect(id).catch(() => {});
	else if (oauth) setStatus(id, { state: "needs_auth", error: null, authUrl: null });
	return publicServer({ ...server, status: getStatus(id) });
}

async function toAgentById(id: string) {
	const { getAgent } = await import("../services/agents.ts");
	const a = await getAgent(id);
	if (!a) throw notFound("Agent");
	return a;
}

export async function updateServer(id: string, input: McpServerUpdateInput): Promise<McpServerWithStatus> {
	const patch = parse(McpServerUpdate, input);
	const current = await requireServer(id);
	requireOwnServer(current);
	if (patch.transport) await checkTransport(patch.transport);
	if (patch.everyone !== undefined && patch.everyone !== current.everyone) requirePermission("admin");
	if (patch.name && patch.name !== current.name) {
		const clash = await db.query.mcpServers.findFirst({
			where: and(eq(schema.mcpServers.name, patch.name), eq(schema.mcpServers.userId, current.userId)),
		});
		if (clash) throw new HttpError(409, `An MCP server named "${patch.name}" already exists`);
	}
	const transport = patch.transport ? sealTransport(mergeTransport(patch.transport, current.transport)) : undefined;
	await db
		.update(schema.mcpServers)
		.set({ ...patch, ...(transport ? { transport } : {}), updatedAt: Date.now() })
		.where(eq(schema.mcpServers.id, id));
	const server = await requireServer(id);
	const reconnect = patch.transport !== undefined || patch.enabled !== undefined;
	if (patch.scope !== undefined) {
		// Bots' tool lists change: let the app refetch them.
		bus.emit({ type: "settings.changed" }, current.everyone ? { to: "everyone" } : {});
	}
	if (reconnect) {
		await disconnect(id);
		if (server.enabled) void connect(id).catch(() => {});
	}
	bus.emit({ type: "mcp.changed", serverId: id });
	return publicServer({ ...server, status: getStatus(id) });
}

export async function deleteServer(id: string): Promise<void> {
	requireOwnServer(await requireServer(id));
	await disconnect(id);
	await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
	connections.delete(id);
	const agents = await db.select().from(schema.agents);
	for (const a of agents) {
		if (!a.mcp.some((b) => b.serverId === id)) continue;
		await db
			.update(schema.agents)
			.set({ mcp: a.mcp.filter((b) => b.serverId !== id) })
			.where(eq(schema.agents.id, a.id));
	}
	bus.emit({ type: "mcp.changed", serverId: id });
}

// ---------------------------------------------------------------- connections

function makeTransport(
	server: McpServer,
	onStderr: (line: string) => void,
	authProvider: McpOAuthProvider | undefined,
	fetchImpl: FetchLike,
): Transport {
	const t = server.transport;
	switch (t.type) {
		case "stdio": {
			const transport = new StdioClientTransport({
				command: t.command,
				args: t.args,
				env: { ...getDefaultEnvironment(), ...t.env },
				cwd: t.cwd ?? undefined,
				stderr: "pipe",
			});
			transport.stderr?.on("data", (chunk: Buffer) => {
				for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) onStderr(line);
			});
			return transport;
		}
		case "http":
			return new StreamableHTTPClientTransport(new URL(t.url), {
				requestInit: { headers: t.headers },
				authProvider,
				fetch: fetchImpl,
			});
		case "sse":
			return new SSEClientTransport(new URL(t.url), {
				requestInit: { headers: t.headers },
				authProvider,
				fetch: fetchImpl,
			});
	}
}

async function fetchTools(client: Client): Promise<McpToolInfo[]> {
	const tools: McpToolInfo[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT_MS });
		for (const t of page.tools) {
			const a = t.annotations ?? {};
			tools.push({
				name: t.name,
				description: t.description ?? "",
				inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
				annotations: {
					title: a.title,
					readOnlyHint: a.readOnlyHint,
					destructiveHint: a.destructiveHint,
					openWorldHint: a.openWorldHint,
				},
			});
		}
		cursor = page.nextCursor;
	} while (cursor);
	return tools;
}

export async function connect(serverId: string): Promise<McpServerStatus> {
	const c = conn(serverId);
	if (c.status.state === "connected" && c.client) return c.status;
	if (c.connecting) return c.connecting;
	const attempt = (async () => {
		const row = await getRow(serverId);
		if (!row) throw notFound("MCP server");
		const server = toServer(row);
		const st = readOAuth(row.oauth);
		// Not signed in yet: nothing to try until you do.
		if (st && !st.tokens) {
			return setStatus(serverId, { state: "needs_auth", error: null, tools: [], connectedAt: null });
		}
		setStatus(serverId, { state: "connecting", error: null });
		c.stderr = [];
		const client = new Client({ name: APP_NAME.toLowerCase(), version: APP_VERSION }, { capabilities: {} });
		let authUrl: string | null = null;
		const provider = st
			? new McpOAuthProvider(serverId, st, (url) => {
					authUrl = url.toString();
				})
			: undefined;
		const transport = makeTransport(
			server,
			(line) => {
				c.stderr.push(line);
				if (c.stderr.length > 50) c.stderr.shift();
			},
			provider,
			await fetchFor(row.userId),
		);
		try {
			await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "Timed out connecting");
			const tools = await fetchTools(client);
			client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
				try {
					setStatus(serverId, { tools: await fetchTools(client) });
				} catch (err) {
					log.warn(`mcp ${server.name}: refreshing tools failed`, err);
				}
			});
			client.onclose = () => {
				if (conn(serverId).client === client) {
					conn(serverId).client = null;
					setStatus(serverId, { state: "disconnected", connectedAt: null });
				}
			};
			c.client = client;
			log.info(`mcp ${server.name}: connected (${tools.length} tools)`);
			return setStatus(serverId, { state: "connected", error: null, tools, connectedAt: Date.now() });
		} catch (err) {
			await client.close().catch(() => {});
			// The sign-in ran out (or was revoked) and couldn't be renewed: sign in again.
			if (
				err instanceof UnauthorizedError ||
				(st && /401|unauthori[sz]ed|invalid_token|invalid_grant/i.test(errorMessage(err)))
			) {
				log.info(`mcp ${server.name}: needs you to sign in`);
				return setStatus(serverId, { state: "needs_auth", error: null, authUrl, tools: [], connectedAt: null });
			}
			const tail = c.stderr.slice(-5).join("\n");
			const error = tail ? `${errorMessage(err)}\n${tail}` : errorMessage(err);
			log.warn(`mcp ${server.name}: connect failed: ${errorMessage(err)}`);
			return setStatus(serverId, { state: "error", error, tools: [], connectedAt: null });
		}
	})();
	// Cleared however it ends (an early "sign in first" too), so the next connect really tries again.
	const current: Promise<McpServerStatus> = attempt.finally(() => {
		if (c.connecting === current) c.connecting = null;
	});
	c.connecting = current;
	return current;
}

export async function disconnect(serverId: string): Promise<McpServerStatus> {
	const c = conn(serverId);
	const client = c.client;
	c.client = null;
	if (client) await client.close().catch(() => {});
	return setStatus(serverId, { state: "disconnected", error: null, connectedAt: null });
}

// ---------------------------------------------------------------- signing in (OAuth)

/**
 * Starts signing in to an app: registers Sekai with it (once per address you use Sekai at), and returns the
 * page to send you to. When you approve, the app sends the browser back to the callback.
 */
export async function startSignIn(serverId: string, origin: string): Promise<{ url: string | null }> {
	const row = await getRow(serverId);
	if (!row || !serverUsableBy(row)) throw notFound("MCP server");
	requireOwnServer(row);
	if (row.transport.type === "stdio") throw new HttpError(400, "Only remote servers sign in");
	const st: OAuthState = readOAuth(row.oauth) ?? {};
	const redirectUri = `${origin}${OAUTH_CALLBACK_PATH}`;
	// A different address means a different callback: register again (your own client keeps its id).
	if (st.redirectUri !== redirectUri) {
		if (!st.ownClient) st.client = undefined;
		st.redirectUri = redirectUri;
	}
	st.tokens = undefined;
	await writeOAuth(serverId, st);
	let url: string | null = null;
	const provider = new McpOAuthProvider(serverId, st, (u) => {
		url = u.toString();
	});
	try {
		const result = await auth(provider, {
			serverUrl: row.transport.url,
			scope: st.scope || undefined,
			fetchFn: await fetchFor(row.userId),
		});
		if (result === "AUTHORIZED") {
			void connect(serverId).catch(() => {});
			return { url: null };
		}
	} catch (err) {
		throw new HttpError(502, `Couldn't start signing in: ${errorMessage(err)}`);
	}
	setStatus(serverId, { state: "needs_auth", authUrl: url, error: null });
	return { url };
}

/** The app sent you back: trade the code for tokens and connect. Returns the server's id. */
export async function finishSignIn(state: string, code: string): Promise<string> {
	for (const row of await db.select().from(schema.mcpServers)) {
		const st = readOAuth(row.oauth);
		if (!st?.state || st.state !== state || row.transport.type === "stdio") continue;
		const provider = new McpOAuthProvider(row.id, st, () => {});
		const result = await auth(provider, {
			serverUrl: row.transport.url,
			authorizationCode: code,
			scope: st.scope || undefined,
			fetchFn: await fetchFor(row.userId),
		});
		if (result !== "AUTHORIZED") throw new HttpError(400, "The app didn't accept the sign-in");
		st.state = undefined;
		st.verifier = undefined;
		await writeOAuth(row.id, st);
		await disconnect(row.id);
		void connect(row.id).catch(() => {});
		bus.emit({ type: "mcp.changed", serverId: row.id });
		log.info(`mcp ${row.name}: signed in`);
		return row.id;
	}
	throw new HttpError(400, "That sign-in link expired. Start it again from Sekai.");
}

/** Forgets the sign-in (tokens and registration). */
export async function signOut(serverId: string): Promise<void> {
	const row = await getRow(serverId);
	if (!row?.oauth || !serverUsableBy(row)) return;
	requireOwnServer(row);
	const st = readOAuth(row.oauth) ?? {};
	// Keep your own client and the scopes; forget the sign-in.
	await writeOAuth(serverId, {
		ownClient: st.ownClient,
		client: st.ownClient ? st.client : undefined,
		scope: st.scope,
		params: st.params,
	});
	await disconnect(serverId);
	setStatus(serverId, { state: "needs_auth", authUrl: null });
}

/** Servers every bot of the acting person has (scope "all", theirs or shared with everyone), enabled. */
export async function globalServers(): Promise<McpServer[]> {
	return (await listServers()).filter((s) => s.enabled && s.scope === "all");
}

/** Connects every enabled server in the background at boot. */
export async function connectAll(): Promise<void> {
	for (const s of await listServers()) {
		if (s.enabled) void connect(s.id).catch(() => {});
	}
}

export async function disconnectAll(): Promise<void> {
	await Promise.all([...connections.keys()].map((id) => disconnect(id)));
}

/** Ensures a server is connected and returns its tools (used when building an agent's toolset). */
export async function toolsFor(serverId: string): Promise<McpToolInfo[]> {
	const server = await getServer(serverId);
	if (!server?.enabled) return [];
	const status = await connect(serverId);
	return status.state === "connected" ? status.tools : [];
}

interface ContentBlock {
	type: string;
	text?: string;
	mimeType?: string;
	resource?: { uri?: string; text?: string; mimeType?: string };
	uri?: string;
	name?: string;
}

export async function callTool(
	serverId: string,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
	await connect(serverId);
	const client = conn(serverId).client;
	if (!client) throw new Error(conn(serverId).status.error ?? "MCP server is not connected");
	const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
		signal,
		timeout: CALL_TIMEOUT_MS,
		resetTimeoutOnProgress: true,
	});
	const blocks = (Array.isArray(result.content) ? result.content : []) as ContentBlock[];
	const pieces = blocks.map((b) => {
		switch (b.type) {
			case "text":
				return b.text ?? "";
			case "image":
				return `[image ${b.mimeType ?? ""}]`;
			case "audio":
				return `[audio ${b.mimeType ?? ""}]`;
			case "resource":
				return b.resource?.text ?? `[resource ${b.resource?.uri ?? ""}]`;
			case "resource_link":
				return `[resource ${b.name ?? ""} ${b.uri ?? ""}]`;
			default:
				return JSON.stringify(b);
		}
	});
	if (pieces.length === 0 && result.structuredContent) pieces.push(JSON.stringify(result.structuredContent, null, 2));
	return { text: pieces.join("\n").trim() || "(no output)", isError: result.isError === true };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}
