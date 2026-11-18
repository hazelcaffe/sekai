import type { ServerEvent, ServerInfo } from "@sekai/shared";
import { ApprovalDecision, RunStatus } from "@sekai/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { decideApproval, listPendingApprovals } from "../agent/approvals.ts";
import { cancelRun } from "../agent/runtime.ts";
import { requirePermission } from "../auth/actor.ts";
import { listPeople } from "../auth/users.ts";
import { APP_NAME, APP_VERSION, config } from "../config.ts";
import { bus } from "../events/bus.ts";
import { eventVisibleTo } from "../events/scope.ts";
import { badRequest, errorMessage, notFound } from "../lib/errors.ts";
import { invalidateModels, listModels } from "../llm/catalog.ts";
import { fetchModels, gatewayEndpoint } from "../llm/gateway.ts";
import { providerModels } from "../providers/store.ts";
import { healthReport } from "../services/health.ts";
import { modelAllowed } from "../services/limits.ts";
import { searchMessages } from "../services/messages.ts";
import { getRun, listRuns } from "../services/runs.ts";
import { effectiveTimezone, getPublicSettings, getSettings, updateSettings } from "../services/settings.ts";
import { getUploadRow, saveUpload } from "../services/uploads.ts";
import { setModelPrice, usageCsv, usageReport } from "../services/usage.ts";
import { isMine } from "../services/visibility.ts";
import { body, ok, queryBool, queryInt, readJson } from "./util.ts";

export const systemRoutes = new Hono()
	.get("/health", (c) => c.json({ ok: true, time: Date.now() }))
	.get("/info", async (c) => {
		const endpoint = await gatewayEndpoint();
		let gateway: ServerInfo["gateway"] = { url: endpoint.url, ok: false, error: null, models: 0 };
		try {
			const models = await listModels();
			gateway = { ...gateway, ok: true, models: models.length };
		} catch (err) {
			gateway = { ...gateway, error: errorMessage(err) };
		}
		const admin = c.get("actor").admin;
		const info: ServerInfo = {
			name: APP_NAME,
			version: APP_VERSION,
			// How the server is wired up is for admins.
			gateway: admin ? gateway : { ...gateway, url: "" },
			timezone: await effectiveTimezone(),
			dataDir: admin ? config.dataDir : "",
			authRequired: true,
		};
		return c.json(info);
	})
	.get("/models", async (c) => {
		// Your subscriptions (BYOS) come first: they're the ones you picked to bring. Only the models your role
		// includes.
		const byos = providerModels().filter((m) => modelAllowed(m.id));
		try {
			const all = await listModels(queryBool(c.req.query("refresh")) ?? false);
			return c.json([...byos, ...all.filter((m) => modelAllowed(m.id))]);
		} catch (err) {
			if (byos.length) return c.json(byos);
			return c.json({ error: `Couldn't load models from the gateway: ${errorMessage(err)}` }, 502);
		}
	})
	.get("/settings", async (c) => c.json(await getPublicSettings()))
	.patch("/settings", async (c) => {
		const before = await getSettings();
		const updated = await updateSettings((await readJson(c)) as never);
		const after = await getSettings();
		if (before.gatewayUrl !== after.gatewayUrl || before.gatewayApiKey !== after.gatewayApiKey) invalidateModels();
		return c.json(updated);
	})
	.post("/settings/test-gateway", async (c) => {
		requirePermission("admin");
		const input = await body(
			c,
			z.object({ gatewayUrl: z.string().optional(), gatewayApiKey: z.string().optional() }),
		);
		const current = await gatewayEndpoint();
		const key = input.gatewayApiKey && !input.gatewayApiKey.includes("…") ? input.gatewayApiKey : current.apiKey;
		try {
			const models = await fetchModels({
				url: (input.gatewayUrl || current.url).replace(/\/+$/, ""),
				apiKey: key,
			});
			return c.json({ ok: true, error: null, models: models.length });
		} catch (err) {
			return c.json({ ok: false, error: errorMessage(err), models: 0 });
		}
	})

	.get("/runs", async (c) => {
		const status = c.req.query("status");
		const statuses = status
			? status.split(",").map((s) => {
					const r = RunStatus.safeParse(s);
					if (!r.success) throw badRequest(`Unknown status ${s}`);
					return r.data;
				})
			: undefined;
		return c.json(
			await listRuns({
				agentId: c.req.query("agentId") || undefined,
				status: statuses,
				limit: queryInt(c.req.query("limit"), 100),
			}),
		);
	})
	.post("/runs/:id/cancel", async (c) => {
		const run = await getRun(c.req.param("id"));
		if (!run || !isMine(run.userId) || !(await cancelRun(run.id))) throw notFound("Active run");
		return c.json(ok);
	})

	.get("/approvals", (c) => c.json(listPendingApprovals()))
	// Other people here, by name (to share bots with).
	.get("/people", async (c) => {
		requirePermission("share");
		return c.json(await listPeople(c.get("actor").userId));
	})
	.get("/health/report", async (c) => {
		requirePermission("admin");
		return c.json(await healthReport(c.req.query("refresh") === "1"));
	})
	.get("/usage", async (c) =>
		c.json(await usageReport(queryInt(c.req.query("days"), 30) ?? 30, c.req.query("scope") || "me")),
	)
	.get("/usage/export", async (c) => {
		const csv = await usageCsv(queryInt(c.req.query("days"), 30) ?? 30, c.req.query("scope") || "me");
		const day = new Date().toISOString().slice(0, 10);
		return new Response(csv, {
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": `attachment; filename="sekai-usage-${day}.csv"`,
				"cache-control": "no-store",
			},
		});
	})
	.put("/usage/prices", async (c) => {
		requirePermission("admin");
		const b = await body(c, z.object({ model: z.string().min(1).max(200), price: z.unknown() }));
		return c.json(await setModelPrice(b.model, b.price ?? null));
	})
	.get("/search/messages", async (c) =>
		c.json(await searchMessages(c.req.query("q") ?? "", queryInt(c.req.query("limit"), 30))),
	)
	.post("/approvals/:toolCallId", async (c) => {
		const decision = await body(c, ApprovalDecision);
		if (!(await decideApproval(c.req.param("toolCallId"), decision))) throw notFound("Pending approval");
		return c.json(ok);
	})

	.post("/uploads", async (c) => {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) throw badRequest("Send a multipart form with a 'file' field");
		return c.json(await saveUpload(file, file.name, file.type || "application/octet-stream"), 201);
	})
	.get("/uploads/:id", async (c) => {
		const row = await getUploadRow(c.req.param("id"));
		const file = Bun.file(row.path);
		if (!(await file.exists())) throw notFound("Upload file");
		const headers: Record<string, string> = {
			"content-type": row.mime,
			"cache-control": "private, max-age=31536000, immutable",
			"content-disposition": `${row.kind === "image" ? "inline" : "attachment"}; filename="${encodeURIComponent(row.name)}"`,
			"x-content-type-options": "nosniff",
		};
		// Uploads are other people's content: nothing in them may run on Sekai's origin (an SVG, an HTML file…).
		headers["content-security-policy"] =
			"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
		return new Response(file, { headers });
	})

	.get("/events", (c) =>
		streamSSE(c, async (stream) => {
			const who = c.get("actor");
			const write = (event: ServerEvent) => stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {});
			const send = (event: ServerEvent) => void write(event);
			// Checked one after another, so events arrive in the order they happened (deltas especially).
			let queue: Promise<unknown> = Promise.resolve();
			const unsubscribe = bus.subscribe((event, audience) => {
				queue = queue
					.then(async () => {
						if (await eventVisibleTo(event, audience, who)) await write(event);
					})
					.catch(() => {});
			});
			send({ type: "hello", serverTime: Date.now() });
			const ping = setInterval(() => {
				void stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {});
			}, 15_000);
			await new Promise<void>((resolve) => stream.onAbort(resolve));
			clearInterval(ping);
			unsubscribe();
		}),
	);
