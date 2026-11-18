import { Hono } from "hono";
import {
	checkApiProvider,
	createApiProvider,
	deleteApiProvider,
	getApiProvider,
	listApiProviders,
	testApiProvider,
	updateApiProvider,
} from "../llm/api-providers.ts";
import { invalidateModels, listEmbeddingModels } from "../llm/catalog.ts";
import { ok, readJson } from "./util.ts";

/** OpenAI-, Anthropic- and Gemini-compatible model APIs you added. */
export const apiProviderRoutes = new Hono()
	.get("/", async (c) => c.json(await listApiProviders()))
	.post("/", async (c) => {
		const p = await createApiProvider(await readJson(c));
		invalidateModels();
		return c.json(p);
	})
	.post("/test", async (c) => c.json(await testApiProvider(await readJson(c))))
	.get("/embedding-models", async (c) => c.json(await listEmbeddingModels()))
	.get("/:id", async (c) => c.json(await getApiProvider(c.req.param("id"))))
	.patch("/:id", async (c) => {
		const p = await updateApiProvider(c.req.param("id"), await readJson(c));
		invalidateModels();
		return c.json(p);
	})
	.post("/:id/check", async (c) => {
		const p = await checkApiProvider(c.req.param("id"));
		invalidateModels();
		return c.json(p);
	})
	.delete("/:id", async (c) => {
		await deleteApiProvider(c.req.param("id"));
		invalidateModels();
		return c.json(ok);
	});
