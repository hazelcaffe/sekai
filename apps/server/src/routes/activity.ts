import type { ActivityEntry, ActivityQuery } from "@sekai/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { exportActivity, listActivity } from "../services/activity.ts";
import { listAgents } from "../services/agents.ts";
import { queryInt } from "./util.ts";

const STATUS = new Set(["done", "error", "denied"]);
const RISK = new Set(["read", "write", "external", "destructive"]);
const BY = new Set(["rule", "mode", "reviewer", "primary", "user", "timeout"]);

function queryOf(c: Context): ActivityQuery {
	const p = (k: string) => c.req.query(k) || undefined;
	const status = p("status");
	const risk = p("risk");
	const decidedBy = p("decidedBy");
	return {
		q: p("q")?.slice(0, 200),
		scope: p("scope"),
		agentId: p("agentId"),
		status: status && STATUS.has(status) ? (status as ActivityEntry["status"]) : undefined,
		risk: risk && RISK.has(risk) ? (risk as ActivityQuery["risk"]) : undefined,
		decidedBy: decidedBy && BY.has(decidedBy) ? (decidedBy as ActivityQuery["decidedBy"]) : undefined,
		before: queryInt(p("before"), 0) || undefined,
		limit: queryInt(p("limit"), 50),
	};
}

export const activityRoutes = new Hono()
	.get("/", async (c) => c.json(await listActivity(queryOf(c))))
	.get("/export", async (c) => {
		const format = c.req.query("format") === "jsonl" ? "jsonl" : "csv";
		const names = new Map((await listAgents()).map((a) => [a.id, a.name]));
		const body = await exportActivity(queryOf(c), format, names);
		const day = new Date().toISOString().slice(0, 10);
		return new Response(body, {
			headers: {
				"content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
				"content-disposition": `attachment; filename="sekai-activity-${day}.${format}"`,
				"cache-control": "no-store",
			},
		});
	});
