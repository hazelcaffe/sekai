import { Hono } from "hono";
import {
	addBackup,
	backupFile,
	backupStatus,
	cancelRestore,
	configureBackups,
	deleteBackup,
	makeBackup,
	requestRestore,
} from "../backups/index.ts";
import { badRequest } from "../lib/errors.ts";
import { ok, readJson } from "./util.ts";

export const backupRoutes = new Hono()
	.get("/", async (c) => c.json(await backupStatus()))
	.patch("/config", async (c) => c.json(await configureBackups(await readJson(c))))
	.post("/", async (c) => c.json(await makeBackup("manual"), 201))
	.post("/upload", async (c) => {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) throw badRequest("Send a multipart form with a 'file' field");
		return c.json(await addBackup(file), 201);
	})
	.delete("/restore", async (c) => c.json(await cancelRestore()))
	.post("/:name/restore", async (c) => c.json(await requestRestore(c.req.param("name"))))
	// It holds every secret Sekai keeps: only for you, never cached.
	.get("/:name/download", (c) => {
		const name = c.req.param("name");
		const file = Bun.file(backupFile(name));
		return new Response(file, {
			headers: {
				"content-type": "application/gzip",
				"content-length": String(file.size),
				"content-disposition": `attachment; filename="${name}"`,
				"cache-control": "no-store",
			},
		});
	})
	.delete("/:name", async (c) => {
		await deleteBackup(c.req.param("name"));
		return c.json(ok);
	});
