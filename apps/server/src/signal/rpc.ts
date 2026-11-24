/**
 * Talking to signal-cli's daemon over HTTP (`daemon --http`): JSON-RPC requests at /api/v1/rpc and incoming events
 * as Server-Sent Events at /api/v1/events. The daemon listens on this server's loopback only.
 */

/** A JSON-RPC error from signal-cli, with its code (-1 a mistake to fix, -3 network, -4 untrusted, -5 rate limit). */
export class SignalRpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
		this.name = "SignalRpcError";
	}
}

export const RPC_USER_ERROR = -1;
export const RPC_IO_ERROR = -3;
export const RPC_UNTRUSTED = -4;
export const RPC_RATE_LIMIT = -5;
export const RPC_INVALID_PARAMS = -32602;

let nextId = 1;

/** One JSON-RPC call. Throws SignalRpcError when signal-cli answers with an error, Error when it can't be reached. */
export async function callRpc<T>(
	base: string,
	method: string,
	params: Record<string, unknown> = {},
	opts: { timeoutMs?: number; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<T> {
	const request = opts.fetch ?? fetch;
	const signals = [AbortSignal.timeout(opts.timeoutMs ?? 60_000)];
	if (opts.signal) signals.push(opts.signal);
	const id = nextId++;
	let res: Response;
	try {
		res = await request(`${base}/api/v1/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
			signal: AbortSignal.any(signals),
		});
	} catch (err) {
		const timedOut = err instanceof Error && /timed? ?out|TimeoutError|aborted/i.test(`${err.name} ${err.message}`);
		throw new Error(timedOut ? "Signal didn't answer in time." : "Signal's helper on this server isn't answering.");
	}
	const text = await res.text();
	type Answer = { result?: T; error?: { code?: number; message?: string; data?: unknown } };
	let data: Answer | null = null;
	try {
		data = text ? (JSON.parse(text) as Answer) : null;
	} catch {
		data = null;
	}
	if (data?.error) {
		throw new SignalRpcError(data.error.code ?? 0, data.error.message ?? "Signal said no.", data.error.data);
	}
	if (!res.ok) throw new Error(`Signal's helper answered ${res.status}.`);
	return (data?.result ?? {}) as T;
}

export interface SseEvent {
	id: string | null;
	event: string;
	data: string;
}

/**
 * Reads a Server-Sent Events stream until it ends, calling `onEvent` for each event and `onActivity` for anything
 * that arrives (keep-alives too, so a quiet but healthy stream isn't mistaken for a dead one).
 */
export async function readSse(
	body: ReadableStream<Uint8Array>,
	onEvent: (e: SseEvent) => void | Promise<void>,
	onActivity: () => void = () => {},
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	let id: string | null = null;
	let event = "message";
	let data: string[] = [];
	const flush = async () => {
		if (data.length) await onEvent({ id, event, data: data.join("\n") });
		event = "message";
		data = [];
	};
	for await (const chunk of body) {
		onActivity();
		buffer += decoder.decode(chunk, { stream: true });
		let nl = buffer.indexOf("\n");
		while (nl !== -1) {
			const line = buffer.slice(0, nl).replace(/\r$/, "");
			buffer = buffer.slice(nl + 1);
			nl = buffer.indexOf("\n");
			if (line === "") {
				await flush();
				continue;
			}
			if (line.startsWith(":")) continue;
			const colon = line.indexOf(":");
			const field = colon === -1 ? line : line.slice(0, colon);
			const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
			if (field === "id") id = value;
			else if (field === "event") event = value;
			else if (field === "data") data.push(value);
		}
	}
	await flush();
}
