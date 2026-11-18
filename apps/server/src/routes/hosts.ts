import { Hono } from "hono";
import { z } from "zod";
import {
	addHostAccount,
	checkHost,
	createHost,
	deleteHost,
	grantAccess,
	listGrants,
	listHosts,
	masterKey,
	removeHostAccount,
	revokeGrant,
	rotateMasterKey,
	tailnetDevices,
	updateHost,
} from "../machines/hosts.ts";
import { body, ok, readJson } from "./util.ts";

/** Your servers and devices, Sekai's master SSH key, and which bots may use what. */
export const hostRoutes = new Hono()
	.get("/", async (c) => c.json(await listHosts()))
	.post("/", async (c) => c.json(await createHost(await readJson(c)), 201))
	.get("/master-key", async (c) => c.json(await masterKey()))
	.post("/master-key/rotate", async (c) => c.json(await rotateMasterKey()))
	.get("/tailnet", async (c) => c.json(await tailnetDevices()))
	.get("/grants", async (c) => c.json(await listGrants()))
	.post("/grants", async (c) => {
		const b = await body(
			c,
			z.object({ agentId: z.string().min(1), target: z.string().min(1), account: z.string().optional() }),
		);
		return c.json(await grantAccess(b.agentId, b.target, "user", "Given in Admin", b.account), 201);
	})
	.delete("/grants/:id", async (c) => {
		await revokeGrant(c.req.param("id"));
		return c.json(ok);
	})
	.patch("/:id", async (c) => c.json(await updateHost(c.req.param("id"), await readJson(c))))
	.delete("/:id", async (c) => {
		await deleteHost(c.req.param("id"));
		return c.json(ok);
	})
	.post("/:id/check", async (c) => c.json(await checkHost(c.req.param("id"))))
	.post("/:id/accounts", async (c) => {
		const b = await body(c, z.object({ account: z.string() }));
		return c.json(await addHostAccount(c.req.param("id"), b.account), 201);
	})
	.delete("/:id/accounts/:account", async (c) => {
		await removeHostAccount(c.req.param("id"), c.req.param("account"));
		return c.json(ok);
	});
