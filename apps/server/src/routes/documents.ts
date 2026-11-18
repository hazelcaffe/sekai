import { Hono } from "hono";
import { z } from "zod";
import { badRequest } from "../lib/errors.ts";
import {
	addDocument,
	deleteDocument,
	listDocuments,
	readDocument,
	reindexDocument,
	renameDocument,
	searchLibrary,
} from "../library/index.ts";
import { body, ok, queryInt } from "./util.ts";

/** The document library (/api/documents). */
export const documentRoutes = new Hono()
	.get("/", async (c) => c.json(await listDocuments()))
	// One file per request (a folder is sent file by file), with the folder's name as its collection.
	.post("/", async (c) => {
		const form = await c.req.formData();
		const file = form.get("file");
		if (!(file instanceof File)) throw badRequest("Send a multipart form with a 'file' field");
		const collection = form.get("collection");
		return c.json(await addDocument(file, typeof collection === "string" ? collection : ""), 201);
	})
	.get("/search", async (c) =>
		c.json(await searchLibrary(c.req.query("q") ?? "", { limit: queryInt(c.req.query("limit"), 8) })),
	)
	.get("/:id/read", async (c) =>
		c.json(
			await readDocument(c.req.param("id"), {
				chunk: queryInt(c.req.query("chunk")),
				page: queryInt(c.req.query("page")),
			}),
		),
	)
	.patch("/:id", async (c) => {
		const { title } = await body(c, z.object({ title: z.string().min(1).max(200) }));
		return c.json(await renameDocument(c.req.param("id"), title));
	})
	.post("/:id/reindex", async (c) => c.json(await reindexDocument(c.req.param("id"))))
	.delete("/:id", async (c) => {
		await deleteDocument(c.req.param("id"));
		return c.json(ok);
	});
