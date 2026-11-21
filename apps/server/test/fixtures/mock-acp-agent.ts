/**
 * A scripted ACP agent for end-to-end tests. Speaks ACP over stdio like codex-acp or gemini --acp, and
 * exercises everything Sekai supports: streamed text and thoughts, plans, config options (model, thought
 * level), its own tool calls with permission requests, and calls into the Sekai tools bridge over MCP.
 *
 * Prompt keywords: "save memory: <text>" calls memory_save through the bridge; "run command" asks
 * permission to run a shell command. MOCK_ACP_AUTH=required makes session/new demand sign-in.
 */
import {
	agent,
	ndJsonStream,
	PROTOCOL_VERSION,
	RequestError,
	type SessionConfigOption,
	type SessionUpdate,
} from "@agentclientprotocol/sdk";

interface Session {
	mcpUrl: string | null;
	model: string;
	thought: string;
	cancelled: boolean;
	turns: number;
}

const sessions = new Map<string, Session>();
let nextId = 1;

function configOptions(s: Session): SessionConfigOption[] {
	return [
		{
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: s.model,
			options: [
				{ value: "mock-fast", name: "Mock Fast" },
				{ value: "mock-smart", name: "Mock Smart" },
			],
		},
		{
			id: "reasoning",
			name: "Reasoning",
			category: "thought_level",
			type: "select",
			currentValue: s.thought,
			options: [
				{ value: "low", name: "Low" },
				{ value: "medium", name: "Medium" },
				{ value: "high", name: "High" },
			],
		},
	];
}

let rpc = 0;
async function mcp(url: string, method: string, params: unknown): Promise<unknown> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
		body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method, params }),
	});
	const type = res.headers.get("content-type") ?? "";
	const text = await res.text();
	const body = type.includes("text/event-stream")
		? JSON.parse(
				text
					.split("\n")
					.filter((l) => l.startsWith("data:"))
					.map((l) => l.slice(5))
					.join(""),
			)
		: JSON.parse(text);
	if (body.error) throw new Error(body.error.message);
	return body.result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const app = agent({ name: "mock-acp" })
	.onRequest("initialize", () => ({
		protocolVersion: PROTOCOL_VERSION,
		agentCapabilities: {
			loadSession: false,
			promptCapabilities: { image: true, embeddedContext: false },
			mcpCapabilities: { http: true },
		},
		agentInfo: { name: "mock-acp", title: "Mock ACP", version: "1.0.0" },
		authMethods: [{ id: "mock-login", name: "Mock login", description: "Pretends to sign in" }],
	}))
	.onRequest("authenticate", () => ({}))
	.onRequest("session/new", ({ params }) => {
		if (process.env.MOCK_ACP_AUTH === "required") throw RequestError.authRequired();
		if (process.env.MOCK_ACP_ONE_CHAT === "1") {
			if (params.mcpServers.length) throw RequestError.invalidParams(undefined, "Expected no MCP servers");
			sessions.clear();
		}
		const sessionId = `mock-${nextId++}`;
		const http = params.mcpServers.find((m) => "type" in m && m.type === "http");
		const s: Session = {
			mcpUrl: http && "url" in http ? http.url : null,
			model: "mock-fast",
			thought: "medium",
			cancelled: false,
			turns: 0,
		};
		sessions.set(sessionId, s);
		return { sessionId, configOptions: configOptions(s) };
	})
	.onRequest("session/set_config_option", ({ params }) => {
		const s = sessions.get(params.sessionId);
		if (!s) throw RequestError.invalidParams(undefined, "unknown session");
		const value = "value" in params ? String(params.value) : "";
		if (params.configId === "model") s.model = value;
		if (params.configId === "reasoning") s.thought = value;
		return { configOptions: configOptions(s) };
	})
	.onNotification("session/cancel", ({ params }) => {
		const s = sessions.get(params.sessionId);
		if (s) s.cancelled = true;
	})
	.onRequest("session/prompt", async ({ params, client }) => {
		const s = sessions.get(params.sessionId);
		if (!s) throw RequestError.invalidParams(undefined, "unknown session");
		s.cancelled = false;
		s.turns++;
		const sessionId = params.sessionId;
		const text = params.prompt.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
		const images = params.prompt.filter((b) => b.type === "image").length;
		const update = (u: SessionUpdate) => client.notify("session/update", { sessionId, update: u });

		await update({
			sessionUpdate: "agent_thought_chunk",
			content: { type: "text", text: "Reading the request. " },
		});
		await update({
			sessionUpdate: "plan",
			entries: [
				{ content: "Understand the request", priority: "high", status: "completed" },
				{ content: "Do the work", priority: "high", status: "in_progress" },
			],
		});

		const notes: string[] = [];
		const memory = text.match(/save memory: ([^\n]+)/i)?.[1];
		if (memory && s.mcpUrl) {
			await mcp(s.mcpUrl, "initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "mock", version: "1" },
			});
			const list = (await mcp(s.mcpUrl, "tools/list", {})) as { tools: { name: string }[] };
			notes.push(`bridge tools: ${list.tools.length}`);
			await update({
				sessionUpdate: "tool_call",
				toolCallId: "mcp-1",
				title: "sekai/memory_save",
				kind: "other",
				status: "in_progress",
				rawInput: { server: "sekai", tool: "memory_save" },
			});
			const r = (await mcp(s.mcpUrl, "tools/call", {
				name: "memory_save",
				arguments: { kind: "fact", content: memory },
			})) as { content: { text: string }[]; isError?: boolean };
			await update({
				sessionUpdate: "tool_call_update",
				toolCallId: "mcp-1",
				status: r.isError ? "failed" : "completed",
			});
			notes.push(`memory_save: ${r.isError ? "error" : "ok"} (${r.content[0]?.text.slice(0, 60)})`);
		}

		if (/run command/i.test(text)) {
			await update({
				sessionUpdate: "tool_call",
				toolCallId: "sh-1",
				title: "Run `ls -la`",
				kind: "execute",
				status: "pending",
				rawInput: { command: "ls -la" },
			});
			const answer = await client.request("session/request_permission", {
				sessionId,
				toolCall: {
					toolCallId: "sh-1",
					title: "Run `ls -la`",
					kind: "execute",
					rawInput: { command: "ls -la" },
				},
				options: [
					{ optionId: "yes", name: "Allow", kind: "allow_once" },
					{ optionId: "no", name: "Reject", kind: "reject_once" },
				],
			});
			const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes";
			await update({
				sessionUpdate: "tool_call_update",
				toolCallId: "sh-1",
				status: allowed ? "completed" : "failed",
				content: [
					{ type: "content", content: { type: "text", text: allowed ? "README.md\ninbox" : "not allowed" } },
				],
			});
			notes.push(`command: ${allowed ? "ran" : "denied"}`);
		}

		if (/slow/i.test(text)) {
			for (let i = 0; i < 50 && !s.cancelled; i++) await sleep(100);
			if (s.cancelled) return { stopReason: "cancelled" };
		}

		const facts = [
			`model=${s.model}`,
			`thought=${s.thought}`,
			`turn=${s.turns}`,
			`instructions=${text.includes("<sekai_instructions>") ? "full" : text.includes("<sekai_situation>") ? "situation" : "none"}`,
			`history=${text.includes("<conversation_so_far>") ? "seeded" : text.includes("<since_your_last_reply>") ? "delta" : "none"}`,
			`images=${images}`,
			...notes,
		];
		const reply = `Mock reply. ${facts.join(", ")}. Last line: ${text.trim().split("\n").at(-1)}`;
		for (const word of reply.split(/(?<= )/)) {
			if (s.cancelled) return { stopReason: "cancelled" };
			await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: word } });
		}
		await update({
			sessionUpdate: "plan",
			entries: [
				{ content: "Understand the request", priority: "high", status: "completed" },
				{ content: "Do the work", priority: "high", status: "completed" },
			],
		});
		return { stopReason: "end_turn" };
	});

const stdout = new WritableStream<Uint8Array>({
	write(chunk) {
		process.stdout.write(chunk);
	},
});
app.connect(ndJsonStream(stdout, Bun.stdin.stream()));
