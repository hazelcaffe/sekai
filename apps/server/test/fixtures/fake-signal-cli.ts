/**
 * A fake signal-cli daemon for tests: JSON-RPC at /api/v1/rpc and events by SSE at /api/v1/events (?account=…), as
 * `signal-cli daemon --http` serves them in multi-account mode. It records every call and can push events.
 */

export interface FakeGroup {
	id: string;
	name: string;
	isMember: boolean;
	members: { uuid: string; number?: string | null }[];
	pendingMembers: { uuid: string }[];
}

export interface FakeCall {
	method: string;
	params: Record<string, unknown>;
	/** What it answered (a send's timestamp…). */
	result?: unknown;
}

export function fakeSignalCli(accounts: { number: string | null; aci: string }[], opts: { port?: number } = {}) {
	const encoder = new TextEncoder();
	const state = {
		accounts,
		calls: [] as FakeCall[],
		groups: new Map<string, FakeGroup>(),
		attachments: new Map<string, Uint8Array>(),
		contacts: [] as { uuid: string; number?: string | null; name?: string; profile?: { givenName?: string } }[],
		identities: [] as { uuid: string; number?: string | null; trustLevel: string; addedTimestamp: number }[],
		/** Account → the open event streams for it. */
		streams: new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>(),
		/** Last-Event-ID headers clients sent when they connected. */
		resumedFrom: [] as (string | null)[],
		nextTimestamp: 1_800_000_000_000,
		eventId: 0,
		/** Errors to answer a method with once (code, message). */
		failNext: new Map<string, { code: number; message: string }>(),
	};
	const json = (x: unknown, status = 200) =>
		new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

	function result(method: string, params: Record<string, unknown>): unknown {
		switch (method) {
			case "version":
				return { version: "0.14.10" };
			case "listAccounts":
				return state.accounts.map((a) => ({ number: a.number, aci: a.aci }));
			case "listGroups": {
				const ids = params.groupId as string[] | undefined;
				return [...state.groups.values()].filter((g) => !ids || ids.includes(g.id));
			}
			case "listContacts":
				return state.contacts;
			case "listIdentities":
				return state.identities;
			case "send":
				return { timestamp: state.nextTimestamp++, results: [] };
			case "getAttachment": {
				const data = state.attachments.get(String(params.id));
				if (!data)
					throw Object.assign(new Error(`Could not find attachment with ID: ${params.id}`), { code: -1 });
				return { data: Buffer.from(data).toString("base64") };
			}
			case "updateGroup": {
				const g = state.groups.get(String(params.groupId));
				if (g) {
					const self = String(params.account);
					g.pendingMembers = g.pendingMembers.filter((m) => m.uuid !== self);
					g.members.push({ uuid: self });
					g.isMember = true;
				}
				return { timestamp: state.nextTimestamp++ };
			}
			case "quitGroup": {
				const g = state.groups.get(String(params.groupId));
				if (g) {
					g.isMember = false;
					g.pendingMembers = [];
				}
				return { timestamp: state.nextTimestamp++ };
			}
			case "sendTyping":
			case "sendReaction":
			case "remoteDelete":
			case "updateProfile":
			case "trust":
				return { timestamp: state.nextTimestamp++, results: [] };
			default:
				throw Object.assign(new Error("Method not implemented"), { code: -32601 });
		}
	}

	const server = Bun.serve({
		port: opts.port ?? 0,
		hostname: "127.0.0.1",
		idleTimeout: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/api/v1/check") return new Response(null, { status: 200 });
			if (url.pathname === "/api/v1/rpc" && req.method === "POST") {
				const body = (await req.json()) as { id: number; method: string; params?: Record<string, unknown> };
				const params = body.params ?? {};
				const call: FakeCall = { method: body.method, params };
				state.calls.push(call);
				const failing = state.failNext.get(body.method);
				if (failing) {
					state.failNext.delete(body.method);
					return json({ jsonrpc: "2.0", id: body.id, error: failing });
				}
				// Single-account methods need a known account (as signal-cli's multi-account mode does).
				const multi = new Set(["version", "listAccounts", "startLink", "finishLink", "register", "verify"]);
				if (!multi.has(body.method) && !state.accounts.some((a) => a.aci === params.account)) {
					return json({
						jsonrpc: "2.0",
						id: body.id,
						error: { code: -32602, message: "Specified account does not exist" },
					});
				}
				try {
					call.result = result(body.method, params);
					return json({ jsonrpc: "2.0", id: body.id, result: call.result });
				} catch (err) {
					const e = err as Error & { code?: number };
					return json({ jsonrpc: "2.0", id: body.id, error: { code: e.code ?? -1, message: e.message } });
				}
			}
			if (url.pathname === "/api/v1/events" && req.method === "GET") {
				const account = url.searchParams.get("account") ?? "";
				if (!state.accounts.some((a) => a.aci === account || a.number === account))
					return new Response(null, { status: 400 });
				state.resumedFrom.push(req.headers.get("last-event-id"));
				let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
				let keepAlive: ReturnType<typeof setInterval> | undefined;
				const stream = new ReadableStream<Uint8Array>({
					start(c) {
						controller = c;
						const set = state.streams.get(account) ?? new Set();
						set.add(c);
						state.streams.set(account, set);
						c.enqueue(encoder.encode(":\n"));
						keepAlive = setInterval(() => {
							try {
								c.enqueue(encoder.encode(":\n"));
							} catch {
								clearInterval(keepAlive);
							}
						}, 1_000);
					},
					cancel() {
						clearInterval(keepAlive);
						if (controller) state.streams.get(account)?.delete(controller);
					},
				});
				return new Response(stream, { headers: { "content-type": "text/event-stream" } });
			}
			return new Response("not found", { status: 404 });
		},
	});

	return {
		url: `http://127.0.0.1:${server.port}`,
		state,
		/** Sends an event to the account's open streams, as signal-cli does when a message arrives. */
		push(account: string, frame: Record<string, unknown>) {
			const id = `1700000000000-${++state.eventId}`;
			const data = encoder.encode(`id:${id}\nevent:receive\ndata:${JSON.stringify({ account, ...frame })}\n\n`);
			for (const c of state.streams.get(account) ?? []) c.enqueue(data);
		},
		/** Ends every open event stream (as a daemon restart would). */
		dropStreams() {
			for (const set of state.streams.values()) for (const c of set) c.close();
			state.streams.clear();
		},
		connected: (account: string) => (state.streams.get(account)?.size ?? 0) > 0,
		callsTo: (method: string) => state.calls.filter((c) => c.method === method),
		stop: () => server.stop(true),
	};
}

export type FakeSignalCli = ReturnType<typeof fakeSignalCli>;

/** An envelope as signal-cli sends one, from `from` (an ACI) with a name, at `timestamp`. */
export function envelope(
	from: { uuid: string; name: string; number?: string },
	timestamp: number,
	data: Record<string, unknown> | null,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		envelope: {
			source: from.number ?? from.uuid,
			sourceNumber: from.number ?? null,
			sourceUuid: from.uuid,
			sourceName: from.name,
			sourceDevice: 1,
			timestamp,
			serverReceivedTimestamp: timestamp + 5,
			serverDeliveredTimestamp: timestamp + 9,
			...(data ? { dataMessage: { timestamp, expiresInSeconds: 0, viewOnce: false, ...data } } : {}),
			...extra,
		},
	};
}
