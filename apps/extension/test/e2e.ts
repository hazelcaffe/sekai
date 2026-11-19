/** Run explicitly with a throwaway *_extension_test database. No scheduler, accounts or live models start. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createApiClient, type ExtensionAction } from "@sekai/shared";
import { type BrowserContext, chromium, firefox } from "playwright-core";
import { pageCommand } from "../src/dom.ts";

const database = process.env.SEKAI_EXTENSION_TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith("_extension_test")) {
	throw new Error(
		"Set SEKAI_EXTENSION_TEST_DATABASE_URL to a throwaway database whose name ends in _extension_test.",
	);
}
const artifactDir = process.env.SEKAI_EXTENSION_TEST_OUTPUT ?? "/tmp/opencode/sekai-extension-test";
await mkdir(artifactDir, { recursive: true });
const temp = await mkdtemp(join(artifactDir, "run-"));

// A deterministic, local model exercises sidebar chat without contacting anyone's real provider.
const model = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch: (req) => {
		if (new URL(req.url).pathname.endsWith("/models"))
			return Response.json({ data: [{ id: "extension-test", object: "model" }] });
		return new Response(
			`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello from the browser test." }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	},
});
Object.assign(process.env, {
	DATABASE_URL: database,
	SEKAI_DATA_DIR: join(temp, "data"),
	SEKAI_AUTH_TOKEN: "",
	SEKAI_PUBLIC_URL: "",
	SEKAI_LOG_LEVEL: "error",
	GATEWAY_URL: `http://127.0.0.1:${model.port}/v1`,
	GATEWAY_API_KEY: "",
});
const { initDb, closeDb, db, schema } = await import("../../server/src/db/index.ts");
const { createApp } = await import("../../server/src/app.ts");
const { ensureSetupCode, resetAuthCaches, setupCodeForTests } = await import("../../server/src/auth/service.ts");
const { actorFor, runAs } = await import("../../server/src/auth/actor.ts");
const { extensionBroker } = await import("../../server/src/browser/extension.ts");
const { extensionTools } = await import("../../server/src/agent/tools/extension.ts");
const { requestApproval } = await import("../../server/src/agent/approvals.ts");
const { ToolOutput } = await import("../../server/src/agent/tools/types.ts");
const { requireAgent } = await import("../../server/src/services/agents.ts");
const { seedBuiltinSkills } = await import("../../server/src/services/skills.ts");

await initDb();
await db.delete(schema.users);
resetAuthCaches();
await seedBuiltinSkills();
await ensureSetupCode("http://127.0.0.1");
const app = createApp();
const fixture = `<!doctype html><title>Extension test page</title><h1>Browser fixture</h1><form onsubmit="event.preventDefault();document.querySelector('#status').textContent='Submitted'"><label>Message <input aria-label="Message" value="original"></label><label>Password <input type="password" aria-label="Password" value="never-expose-this"></label><select aria-label="Color"><option>Teal</option><option>Blue</option></select><button type="button" onclick="document.querySelector('#status').textContent='Clicked'">Test button</button><button type="submit">Submit</button></form><p id="status">Ready</p><p hidden>hidden-secret</p><div style="height:2000px"></div>`;
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch: (req, srv) =>
		new URL(req.url).pathname === "/fixture"
			? new Response(fixture, { headers: { "content-type": "text/html" } })
			: app.fetch(req, srv),
});
const base = `http://127.0.0.1:${server.port}`;
let context: BrowserContext | undefined;
let cookie = "";
const api = createApiClient({
	baseUrl: base,
	fetch: async (url, init) => {
		const res = await fetch(url, {
			...init,
			headers: { ...init?.headers, origin: base, ...(cookie ? { cookie } : {}) },
		});
		const set = res.headers.getSetCookie().find((c) => c.startsWith("sekai_session="));
		if (set) cookie = set.split(";")[0] ?? "";
		return res;
	},
});

try {
	const setup = await api.auth.setup({
		username: "browser-test",
		name: "Browser tester",
		password: "only a scratch password",
		code: setupCodeForTests() ?? "",
	});
	assert.equal(setup.status, "signed_in");
	const bot = await api.agents.create({ name: "Browser test bot", models: { primary: { model: "extension-test" } } });
	const chat = await api.extension.createChat(bot.id);
	const token = await api.extension.createToken("Chromium test");
	const actor = await actorFor(bot.userId);
	const agent = await runAs(actor, () => requireAgent(bot.id));
	const tool = extensionTools[1];
	const ctx = {
		agent,
		conversation: chat,
		runId: "run_test",
		messageId: "msg_test",
		trigger: "user" as const,
		depth: 0,
		askChain: [],
		timezone: "UTC",
		approvalMode: "yolo" as const,
		signal: new AbortController().signal,
	};
	assert.ok(tool.askFirst?.({ connectionId: "test", input: { action: "open", url: base } }, ctx));
	assert.equal(tool.askFirst?.({ connectionId: "test", input: { action: "snapshot", tabId: 1 } }, ctx), null);

	const extensionPath = join(temp, "extension");
	await cp(join(import.meta.dir, "../dist/chromium"), extensionPath, { recursive: true });
	// Headless browsers cannot answer native permission prompts or click an extension's toolbar button.
	// Pregrant hosts in this disposable copy, including captureVisibleTab's alternative to activeTab.
	// Assert the shipped manifest has NO mandatory hosts; local tab/origin grants are tested unchanged.
	const manifest = await Bun.file(join(extensionPath, "manifest.json")).json();
	assert.equal(manifest.host_permissions, undefined);
	await Bun.write(
		join(extensionPath, "manifest.json"),
		JSON.stringify({ ...manifest, host_permissions: ["<all_urls>"] }),
	);
	context = await chromium.launchPersistentContext(join(temp, "profile"), {
		channel: "chromium",
		headless: true,
		args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		viewport: { width: 390, height: 844 },
	});
	const errors: string[] = [];
	context.on("page", (p) => p.on("pageerror", (err) => errors.push(err.message)));
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
	const id = new URL(worker.url()).host;
	const site = await context.newPage();
	await site.goto(`${base}/fixture`);
	const panel = await context.newPage();
	await panel.goto(`chrome-extension://${id}/panel.html`);
	await panel.getByLabel("Server address").fill(base);
	await panel.getByLabel("Browser token").fill(token.token);
	await panel.getByRole("button", { name: "Connect", exact: true }).click();
	await panel.getByRole("button", { name: "Choose tabs to share" }).click();
	await panel
		.getByTitle(`${base}/fixture`, { exact: true })
		.locator("..")
		.getByRole("button", { name: "Share", exact: true })
		.click();
	await panel.getByRole("button", { name: "Stop sharing", exact: true }).waitFor();
	const session = extensionBroker.list(bot.userId, bot.id, chat.id)[0];
	assert.ok(session);
	const call = (input: ExtensionAction) => runAs(actor, () => tool.execute({ connectionId: session.id, input }, ctx));
	const list = JSON.parse(String(await call({ action: "tabs" }))) as { tabId: number }[];
	assert.equal(list.length, 1);
	const tabId = list[0]?.tabId;
	assert.ok(tabId !== undefined);
	let snapshot = String(await call({ action: "snapshot", tabId }));
	assert.match(snapshot, /Browser fixture/);
	assert.ok(
		!snapshot.includes("never-expose-this") &&
			!snapshot.includes("hidden-secret") &&
			!snapshot.includes("original"),
	);
	await site.locator("body").evaluate((body) => {
		const textarea = document.createElement("textarea");
		textarea.setAttribute("aria-label", "Private draft");
		textarea.textContent = "private-draft-value";
		body.prepend(textarea);
		const card = document.createElement("input");
		card.setAttribute("autocomplete", "section-checkout cc-number");
		card.setAttribute("aria-label", "Payment");
		body.prepend(card);
	});
	assert.ok(!String(await call({ action: "snapshot", tabId })).includes("private-draft-value"));
	// Refresh after that snapshot: earlier page IDs and refs must now be invalid.
	const refreshed = String(await call({ action: "snapshot", tabId }));
	const paymentRef = refreshed.match(/\[ref=(e\d+)\] input Payment/)?.[1];
	const refreshedPageId = refreshed.match(/pageId: ([\w-]+)/)?.[1];
	assert.ok(paymentRef && refreshedPageId);
	await assert.rejects(
		() => call({ action: "type", tabId, pageId: refreshedPageId, ref: paymentRef, text: "no" }),
		/sensitive/,
	);
	// Restore the original fixture before exercising the original set of refs below.
	await site.reload();
	snapshot = String(await call({ action: "snapshot", tabId }));
	assert.equal(
		await site.evaluate(() => "__sekaiPage" in window),
		false,
		"snapshot refs must stay in the isolated world",
	);
	const pageId = snapshot.match(/pageId: ([\w-]+)/)?.[1];
	const ref = (label: string) => {
		const line = snapshot.split("\n").find((l) => l.startsWith("[ref=") && l.includes(label));
		const found = line?.match(/\[ref=(e\d+)\]/)?.[1];
		assert.ok(found, `Missing ref for ${label}`);
		return found;
	};
	assert.ok(pageId);
	await call({ action: "type", tabId, pageId, ref: ref("input Message"), text: "Typed through the extension" });
	assert.equal(await site.getByLabel("Message").inputValue(), "Typed through the extension");
	await call({ action: "select", tabId, pageId, ref: ref("select Color"), value: "Blue" });
	assert.equal(await site.getByLabel("Color").inputValue(), "Blue");
	await call({ action: "click", tabId, pageId, ref: ref("button Test button") });
	assert.equal(await site.locator("#status").textContent(), "Clicked");
	await assert.rejects(
		() => call({ action: "type", tabId, pageId, ref: ref("input Password"), text: "no" }),
		/sensitive/,
	);
	await assert.rejects(() => call({ action: "snapshot", tabId: tabId + 9999 }), /hasn't shared|no longer shared/);
	await assert.rejects(() => call({ action: "navigate", tabId, pageId, url: "https://example.com" }), /new site/);
	await site.bringToFront();
	const shot = await call({ action: "screenshot", tabId });
	assert.ok(shot instanceof ToolOutput && shot.images[0]?.mime === "image/jpeg");
	await panel.bringToFront();
	await panel.getByRole("textbox", { name: "Message your bot" }).fill("Say hello for the browser test.");
	await panel.getByRole("button", { name: "Send", exact: true }).click();
	await panel.getByText("Hello from the browser test.", { exact: true }).waitFor({ timeout: 30_000 });

	// The same approvals gate used by agents is decidable from this chat, once only.
	const approval = runAs(actor, () =>
		requestApproval(
			{
				toolCallId: "test-approval",
				runId: "run_test",
				agentId: bot.id,
				conversationId: chat.id,
				messageId: "msg_test",
				toolName: "extension_browser",
				title: "Test approval",
				category: "browser",
				risk: "external",
				args: { action: "click", tabId },
				reason: "Test browser action",
				alwaysAsk: true,
			},
			30_000,
			new AbortController().signal,
		),
	);
	await panel.getByRole("button", { name: "Allow once", exact: true }).click();
	assert.equal((await approval).approve, true);

	for (const width of [390, 1280]) {
		await panel.setViewportSize({ width, height: 844 });
		for (const colorScheme of ["light", "dark"] as const) {
			await panel.emulateMedia({ colorScheme });
			await panel.screenshot({
				path: join(artifactDir, `panel-${width}-${colorScheme}.png`),
				fullPage: true,
				animations: "disabled",
			});
			assert.ok(
				await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
				"panel must not overflow horizontally",
			);
		}
	}
	await call({ action: "navigate", tabId, pageId, url: `${base}/fixture?new-page` });
	await site.waitForURL("**/fixture?new-page");
	await assert.rejects(
		() => call({ action: "click", tabId, pageId, ref: ref("button Test button") }),
		/page changed/,
	);
	const opening = call({ action: "open", url: `${base}/fixture?opened` });
	await panel.getByRole("button", { name: "Open and share", exact: true }).click();
	assert.match(String(await opening), /Opened and shared/);
	await panel.getByRole("button", { name: "Stop sharing", exact: true }).click();
	await assert.rejects(() => call({ action: "tabs" }), /No browser/);
	assert.deepEqual(errors, []);

	// Check the actual web settings layout and mint/revoke flow, not a static mock.
	const web = await context.newPage();
	const [name = "", value = ""] = cookie.split("=");
	await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: "Lax" }]);
	await web.goto(`${base}/settings?tab=browser`);
	await web.getByRole("button", { name: "Make browser token", exact: true }).click();
	await web.getByText("Browser token (shown once)", { exact: true }).waitFor();
	for (const width of [390, 1280]) {
		await web.setViewportSize({ width, height: 844 });
		for (const dark of [false, true]) {
			await web.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
			await web.screenshot({
				path: join(artifactDir, `settings-${width}-${dark ? "dark" : "light"}.png`),
				fullPage: true,
				animations: "disabled",
			});
			assert.ok(
				await web.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
				"settings must not overflow horizontally",
			);
		}
	}
	await web.getByRole("button", { name: "Revoke token", exact: true }).click();
	await web.getByRole("button", { name: "Make browser token", exact: true }).waitFor();

	// Firefox's DOM implementation is checked too; Playwright cannot install Firefox WebExtensions.
	if (process.env.SEKAI_EXTENSION_TEST_FIREFOX === "1") {
		const ff = await firefox.launch();
		try {
			const page = await ff.newPage();
			await page.goto(`${base}/fixture`);
			const result = await page.evaluate(pageCommand, {
				input: { action: "snapshot" as const, tabId: 1 },
				origin: base,
			});
			assert.match(result.text, /Browser fixture/);
			const target = result.text.match(/\[ref=(e\d+)\] input Message/)?.[1];
			assert.ok(target);
			await page.evaluate(pageCommand, {
				input: {
					action: "type" as const,
					tabId: 1,
					pageId: result.pageId,
					ref: target,
					text: "Firefox DOM test",
				},
				origin: base,
			});
			assert.equal(await page.getByLabel("Message").inputValue(), "Firefox DOM test");
		} finally {
			await ff.close();
		}
	}
	console.info(`Browser extension end-to-end checks passed. Screenshots: ${artifactDir}`);
} finally {
	await context?.close();
	await db.delete(schema.users);
	server.stop(true);
	model.stop(true);
	await closeDb();
	await rm(temp, { recursive: true, force: true });
}
