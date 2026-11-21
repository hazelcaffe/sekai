import { Hono } from "hono";
import { z } from "zod";
import { generateAvatar } from "../agent/avatar.ts";
import { buildAgentContext } from "../agent/context.ts";
import { galleryFile } from "../agent/gallery.ts";
import { ruleSets } from "../agent/permissions.ts";
import { CATEGORY_LABELS, describeTool, mcpRisk, mcpToolName, ruleCatalog } from "../agent/tools/index.ts";
import { getServer, globalServers, toolsFor } from "../mcp/manager.ts";
import {
	createAgent,
	deleteAgent,
	duplicateAgent,
	forViewer,
	listAgents,
	reorderAgents,
	requireAgent,
	requireOwnedAgent,
	updateAgent,
} from "../services/agents.ts";
import { exportBot, importBot } from "../services/bot-files.ts";
import { getConversation, getDirectConversation } from "../services/conversations.ts";
import { getSettings } from "../services/settings.ts";
import { addShare, listShares, removeShare } from "../services/shares.ts";
import { body, ok, readJson } from "./util.ts";

export const agentRoutes = new Hono()
	.get("/", async (c) => c.json((await listAgents()).map(forViewer)))
	.post("/", async (c) => c.json(await createAgent((await readJson(c)) as never), 201))
	.post("/reorder", async (c) => {
		const { ids } = await body(c, z.object({ ids: z.array(z.string()) }));
		await reorderAgents(ids);
		return c.json(ok);
	})
	.get("/:id", async (c) => c.json(forViewer(await requireAgent(c.req.param("id")))))
	.patch("/:id", async (c) => c.json(await updateAgent(c.req.param("id"), (await readJson(c)) as never)))
	.delete("/:id", async (c) => {
		await deleteAgent(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/duplicate", async (c) => c.json(await duplicateAgent(c.req.param("id")), 201))
	// A bot as a file (memory and notes only when asked), and a new bot from one.
	.get("/:id/export", async (c) => {
		await requireOwnedAgent(c.req.param("id"));
		const file = await exportBot(c.req.param("id"), {
			memory: c.req.query("memory") === "1",
			notes: c.req.query("notes") === "1",
		});
		const slug = file.bot.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "bot";
		return new Response(JSON.stringify(file, null, 2), {
			headers: {
				"content-type": "application/json; charset=utf-8",
				"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${slug}.sekai-bot.json`)}`,
				"cache-control": "no-store",
			},
		});
	})
	.post("/import", async (c) => c.json(await importBot(await readJson(c)), 201))
	.get("/:id/conversation", async (c) => {
		await requireAgent(c.req.param("id"));
		return c.json(await getDirectConversation(c.req.param("id")));
	})
	.get("/:id/context", async (c) => {
		const agent = await requireOwnedAgent(c.req.param("id"));
		return c.json(await buildAgentContext(agent, c.req.query("conversationId") || undefined));
	})
	/** Every tool this agent could have for its owner's role, with the rule that applies, for Tools & access. */
	.get("/:id/tools", async (c) => {
		const agent = await requireOwnedAgent(c.req.param("id"));
		const conversationId = c.req.query("conversationId");
		const conversation = conversationId ? await getConversation(conversationId) : null;
		const rules = ruleSets(agent, conversation, await getSettings());
		const mcp = [];
		const bindings = [...agent.mcp];
		for (const g of await globalServers()) {
			if (!bindings.some((b) => b.serverId === g.id)) bindings.push({ serverId: g.id, tools: null });
		}
		for (const binding of bindings) {
			const server = await getServer(binding.serverId);
			if (!server) continue;
			const tools = await toolsFor(server.id).catch(() => []);
			for (const t of tools) {
				mcp.push({
					...describeTool(
						{
							name: mcpToolName(server.name, t.name),
							description: t.description,
							source: "mcp",
							category: `mcp:${server.name}`,
							risk: mcpRisk(t),
						},
						rules,
					),
					serverId: server.id,
					serverTitle: server.title,
					originalName: t.name,
					enabled: !binding.tools || binding.tools.includes(t.name),
				});
			}
		}
		return c.json({ builtin: ruleCatalog(agent, rules), mcp, categories: CATEGORY_LABELS });
	})
	// Sharing: who else may chat with it.
	.get("/:id/shares", async (c) => c.json(await listShares(c.req.param("id"))))
	.post("/:id/shares", async (c) => c.json(await addShare(c.req.param("id"), await readJson(c)), 201))
	.delete("/:id/shares/:shareId", async (c) => c.json(await removeShare(c.req.param("id"), c.req.param("shareId"))))
	.post("/:id/avatar/generate", async (c) => {
		const agent = await requireOwnedAgent(c.req.param("id"));
		const { prompt } = await body(c, z.object({ prompt: z.string().min(1).max(1000) }));
		return c.json(await generateAvatar(agent, prompt));
	});

export const avatarRoutes = new Hono()
	.post("/generate", async (c) => {
		const { prompt } = await body(c, z.object({ prompt: z.string().min(1).max(1000) }));
		return c.json(await generateAvatar(null, prompt));
	})
	.get("/gallery/:id", async (c) => {
		const path = await galleryFile(c.req.param("id"));
		if (!path) return c.json({ error: "That icon isn't available right now" }, 404);
		return new Response(Bun.file(path), {
			headers: { "content-type": "image/png", "cache-control": "private, max-age=2592000, immutable" },
		});
	});
