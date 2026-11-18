/**
 * Stdio ⇄ HTTP proxy for the Sekai tools bridge, for ACP agents that only support stdio MCP servers.
 * Usage: bun mcp-stdio.ts <bridge-url>. Reads newline-delimited JSON-RPC from stdin and forwards it.
 */
const url = process.argv[2];
if (!url) {
	process.stderr.write("usage: mcp-stdio.ts <bridge-url>\n");
	process.exit(2);
}

function write(message: unknown): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function forward(line: string): Promise<void> {
	let message: { id?: unknown };
	try {
		message = JSON.parse(line) as { id?: unknown };
	} catch {
		write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
		return;
	}
	try {
		const res = await fetch(url as string, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
			body: line,
		});
		if (res.status === 202 || message.id === undefined) return;
		if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
			let buffer = "";
			for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
				buffer += chunk;
				let end = buffer.indexOf("\n\n");
				while (end >= 0) {
					const data = buffer
						.slice(0, end)
						.split("\n")
						.filter((l) => l.startsWith("data:"))
						.map((l) => l.slice(5).trim())
						.join("");
					buffer = buffer.slice(end + 2);
					end = buffer.indexOf("\n\n");
					if (data) write(JSON.parse(data));
				}
			}
			return;
		}
		const body = await res.json();
		for (const m of Array.isArray(body) ? body : [body]) write(m);
	} catch (err) {
		if (message.id !== undefined) {
			write({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32603, message: `Sekai is unreachable: ${String(err)}` },
			});
		}
	}
}

let pending = "";
for await (const chunk of process.stdin) {
	pending += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
	let nl = pending.indexOf("\n");
	while (nl >= 0) {
		const line = pending.slice(0, nl).trim();
		pending = pending.slice(nl + 1);
		nl = pending.indexOf("\n");
		// Requests run concurrently: a tool waiting for approval mustn't block pings or other calls.
		if (line) void forward(line);
	}
}

export {};
