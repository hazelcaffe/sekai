import { z } from "zod";
import { errorMessage } from "../lib/errors.ts";
import { type WorkspaceTool, workspaceTools } from "./workspace.ts";

/** A per-session, loopback-only capability. A job doesn't inherit chat tools or secret-bearing MCP servers. */
export function workspaceBridge(call: (name: WorkspaceTool, args: Record<string, unknown>) => Promise<string>) {
	const token = crypto.randomUUID();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		maxRequestBodySize: 768 * 1024,
		async fetch(req) {
			if (new URL(req.url).pathname !== `/${token}` || req.headers.has("origin"))
				return new Response(null, { status: 404 });
			if (req.method !== "POST") return new Response(null, { status: 405 });
			const parsed = z
				.object({
					id: z.union([z.string(), z.number()]).nullish(),
					method: z.string(),
					params: z.object({ name: z.string().optional(), arguments: z.unknown().optional() }).optional(),
				})
				.safeParse(await req.json().catch(() => null));
			if (!parsed.success) return new Response("Invalid RPC request.", { status: 400 });
			const msg = parsed.data;
			if (msg.id == null) return new Response(null, { status: 202 });
			const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });
			switch (msg.method) {
				case "initialize":
					return reply({
						protocolVersion: "2025-03-26",
						capabilities: { tools: {} },
						serverInfo: { name: "workspace", version: "1" },
					});
				case "ping":
					return reply({});
				case "tools/list":
					return reply({
						tools: Object.entries(workspaceTools).map(([name, s]) => ({
							name,
							description: `${name.replaceAll("_", " ")} inside this job's folder only. Use relative paths.`,
							inputSchema: z.toJSONSchema(s),
						})),
					});
				case "tools/call":
					try {
						const { name, arguments: args } = msg.params ?? {};
						if (!name || !Object.hasOwn(workspaceTools, name)) throw new Error("Unknown workspace tool.");
						const text = await call(
							name as WorkspaceTool,
							workspaceTools[name as WorkspaceTool].parse(args),
						);
						return reply({ content: [{ type: "text", text }] });
					} catch (err) {
						return reply({ isError: true, content: [{ type: "text", text: errorMessage(err) }] });
					}
				default:
					return Response.json({
						jsonrpc: "2.0",
						id: msg.id,
						error: { code: -32601, message: "Unknown method" },
					});
			}
		},
	});
	return { url: `http://127.0.0.1:${server.port}/${token}`, close: () => server.stop(true) };
}
