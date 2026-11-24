import { JobMessage } from "@sekai/shared";
import { Hono } from "hono";
import { getJob, listJobs, sendJob, stopJob } from "../jobs/index.ts";
import { body, ok } from "./util.ts";

export const jobRoutes = new Hono()
	.get("/", async (c) => c.json(await listJobs()))
	.get("/:id", async (c) => c.json(await getJob(c.req.param("id"))))
	.post("/:id/send", async (c) => {
		const a = await body(c, JobMessage);
		await sendJob(c.req.param("id"), a.message);
		return c.json(ok);
	})
	.post("/:id/stop", async (c) => {
		await stopJob(c.req.param("id"));
		return c.json(ok);
	});
