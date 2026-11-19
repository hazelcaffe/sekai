import type { Agent, Machine } from "@sekai/shared";
import type { Page } from "playwright-core";
import { z } from "zod";
import { currentActor } from "../../auth/actor.ts";
import { requestLogin } from "../../browser/credentials.ts";
import {
	type BrowserSession,
	browserFor,
	browserWhere,
	closeCurrentBrowser,
	describePage,
	findInPage,
	newTab,
	serverBrowserPath,
	settle,
	tabsOf,
} from "../../browser/engine.ts";
import { browsersForBot } from "../../browser/shared.ts";
import { errorMessage } from "../../lib/errors.ts";
import { getMachine } from "../../machines/manager.ts";
import { getSettings } from "../../services/settings.ts";
import { anyDesktop, askOn, peek, riskOn } from "./targets.ts";
import { defineTool, type ToolContext, ToolError, ToolOutput } from "./types.ts";

const ref = z.string().min(1).describe("The element's ref from the latest snapshot, e.g. e12");
const element = z.string().min(1).max(120).describe("What the element is, in a few words (shown to the user)");

const on = z
	.string()
	.optional()
	.describe(
		'Where to browse: "computer" (Chrome on your computer), "device" (a browser on the user\'s computer, if they lent it to you), "server", or a shared browser by its name. Default: your own browser. The other browser_ tools act on the browser you opened last.',
	);

/** A browser to use in this run: its own (not for people it's shared with), a screen, or a shared browser. */
async function available(agent: Agent): Promise<boolean> {
	const actor = currentActor();
	if ((!actor || actor.userId === agent.userId) && serverBrowserPath()) return true;
	if (await anyDesktop(agent.id)) return true;
	return (await browsersForBot(agent.id)).length > 0;
}

/** The machine a browser call acts on (null: the server), so approvals can weigh it. */
async function browserMachine(ctx: ToolContext, where?: string): Promise<Machine | null> {
	if (where) return where.trim().toLowerCase() === "server" ? null : peek(ctx, where, true);
	const id = browserWhere(ctx.agent.id)?.machineId;
	return id ? getMachine(id) : null;
}

async function session(ctx: ToolContext, where?: string, open = false): Promise<BrowserSession> {
	try {
		return await browserFor(ctx.agent.id, where, { open });
	} catch (err) {
		throw new ToolError(`The browser isn't available: ${errorMessage(err)}`);
	}
}

/** Runs an action on the current page, lets it settle, and returns the page as the bot now sees it. */
async function act(
	ctx: ToolContext,
	fn: (page: Page, s: BrowserSession) => Promise<string | undefined>,
	where?: string,
	open = false,
): Promise<string> {
	const s = await session(ctx, where, open);
	if (s.dialog)
		throw new ToolError(
			`A ${s.dialog.type()} dialog is open ("${s.dialog.message().slice(0, 200)}"). Answer it with browser_dialog first.`,
		);
	let note: string | undefined;
	try {
		note = await fn(s.page, s);
	} catch (err) {
		const msg = errorMessage(err).split("\n")[0] ?? "";
		if (/not found|No element|resolve|ref/i.test(msg) && /ref|aria-ref|getByRef/i.test(msg)) {
			throw new ToolError(
				`That ref isn't on the page anymore. Take a fresh browser_snapshot and use its refs. (${msg})`,
			);
		}
		throw new ToolError(msg.slice(0, 500));
	}
	await settle(s.page);
	return `${note ? `${note}\n` : ""}${await describePage(s)}`;
}

/**
 * Web pages only: http(s) and about:blank. file:, chrome:, view-source:, data: and javascript: would let a page (or
 * a prompt injection) read the machine's files, including the server's secrets when the browser runs on it.
 */
function normalizeUrl(url: string): string {
	const u = url.trim();
	if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return `https://${u}`;
	if (/^(https?:|about:blank$)/i.test(u)) return u;
	throw new ToolError("Only web addresses (http or https) can be opened in the browser.");
}

/** github.com/acme/repo, without the scheme and query. */
function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname === "/" ? "" : u.pathname;
		const s = `${u.hostname.replace(/^www\./, "")}${path}`;
		return s.length > 60 ? `${s.slice(0, 59)}…` : s;
	} catch {
		return url.slice(0, 60);
	}
}

/** Every browser_ tool: browsing on the user's own computer counts as reaching outside Sekai. */
const browserTool = <S extends z.ZodType>(
	def: Omit<Parameters<typeof defineTool<S>>[0], "category" | "available" | "riskFor" | "askFirst">,
) =>
	defineTool<S>({
		...def,
		category: "browser",
		available: (agent) => available(agent),
		riskFor: async (args, ctx) => riskOn(await browserMachine(ctx, (args as { on?: string }).on), def.risk),
		askFirst: async (args, ctx) => askOn(await browserMachine(ctx, (args as { on?: string }).on), def.risk),
	});

/** A point near the target, not its exact center, the way a person clicks. */
function fuzzySteps(): number {
	return 6 + Math.floor(Math.random() * 6);
}

export const browserTools = [
	browserTool({
		name: "browser_open",
		description:
			"Open a web page in your browser and get its snapshot: the page's elements with refs ([ref=e12]) you can click and type into. Use for anything interactive (web apps, forms, sites that need a login); web_fetch is faster for just reading an article. The other browser_ tools act on the browser this opened.",
		parameters: z.object({
			url: z.string().min(1),
			newTab: z.boolean().optional().describe("Open it in a new tab instead of the current one"),
			on,
		}),
		risk: "read",
		title: (a) => `Opened ${shortUrl(normalizeUrl(a.url))}`,
		async execute(args, ctx) {
			return act(
				ctx,
				async (_page, s) => {
					if (args.newTab) await newTab(s);
					await s.page.goto(normalizeUrl(args.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
					return undefined;
				},
				args.on,
				true,
			);
		},
	}),
	browserTool({
		name: "browser_snapshot",
		description:
			"Look at the current page again: its elements and their refs. Refs from older snapshots may be stale.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Looked at the page",
		async execute(_args, ctx) {
			return describePage(await session(ctx));
		},
	}),
	browserTool({
		name: "browser_find",
		description:
			"Find where some text appears on a long page (lines of the snapshot around each match, with refs).",
		parameters: z.object({ text: z.string().min(1) }),
		risk: "read",
		title: (a) => `Looked for “${a.text}”`,
		async execute(args, ctx) {
			return findInPage(await session(ctx), args.text);
		},
	}),
	browserTool({
		name: "browser_click",
		description: "Click an element by its ref.",
		parameters: z.object({
			ref,
			element,
			double: z.boolean().optional(),
			button: z.enum(["left", "right", "middle"]).optional(),
			modifiers: z.array(z.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"])).optional(),
		}),
		risk: "write",
		title: (a) => `Clicked ${a.element}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				const target = page.getByRef(args.ref);
				const opts = {
					button: args.button,
					modifiers: args.modifiers,
					timeout: 10_000,
					// A real click moves the mouse over a few steps rather than teleporting.
					steps: fuzzySteps(),
				};
				if (args.double) await target.dblclick(opts);
				else await target.click(opts);
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_type",
		description:
			"Type into a text field by its ref (replaces what's there). slowly: type key by key, for fields that react to each keystroke (search-as-you-type, editors). submit: press Enter after.",
		parameters: z.object({
			ref,
			element,
			text: z.string(),
			submit: z.boolean().optional(),
			slowly: z.boolean().optional(),
		}),
		risk: "write",
		title: (a) => `Typed into ${a.element}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				const target = page.getByRef(args.ref);
				if (args.slowly) {
					await target.click({ timeout: 10_000, steps: fuzzySteps() });
					// Type like a person: not a metronome.
					for (const ch of args.text) {
						await page.keyboard.type(ch);
						await page.waitForTimeout(25 + Math.floor(Math.random() * 65));
					}
				} else {
					await target.fill(args.text, { timeout: 10_000 });
				}
				if (args.submit) await target.press("Enter");
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_fill_form",
		description: "Fill several fields at once: text boxes, check boxes, radio buttons, dropdowns and sliders.",
		parameters: z.object({
			fields: z
				.array(
					z.object({
						ref,
						element,
						type: z.enum(["textbox", "checkbox", "radio", "combobox", "slider"]),
						value: z
							.string()
							.describe("Text, the option to pick, a number for sliders, or true/false for check boxes"),
					}),
				)
				.min(1)
				.max(40),
		}),
		risk: "write",
		title: (a) => `Filled in ${a.fields.length} field${a.fields.length === 1 ? "" : "s"}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				for (const f of args.fields) {
					const target = page.getByRef(f.ref);
					if (f.type === "textbox" || f.type === "slider") await target.fill(f.value, { timeout: 10_000 });
					else if (f.type === "checkbox") await target.setChecked(f.value === "true", { timeout: 10_000 });
					else if (f.type === "radio") await target.check({ timeout: 10_000 });
					else
						await target
							.selectOption({ label: f.value }, { timeout: 10_000 })
							.catch(() => target.selectOption(f.value));
				}
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_select",
		description: "Pick options in a dropdown (<select>) by their labels or values.",
		parameters: z.object({ ref, element, values: z.array(z.string()).min(1) }),
		risk: "write",
		title: (a) => `Picked ${a.values.join(", ")} in ${a.element}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				await page.getByRef(args.ref).selectOption(args.values, { timeout: 10_000 });
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_hover",
		description: "Hover over an element (menus and tooltips that open on hover).",
		parameters: z.object({ ref, element }),
		risk: "read",
		title: (a) => `Hovered over ${a.element}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				await page.getByRef(args.ref).hover({ timeout: 10_000 });
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_press",
		description: "Press a key or shortcut in the page: Enter, Escape, Tab, ArrowDown, PageDown, Control+A, Meta+K…",
		parameters: z.object({ key: z.string().min(1) }),
		risk: "write",
		title: (a) => `Pressed ${a.key}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				await page.keyboard.press(args.key);
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_drag",
		description: "Drag one element onto another (kanban cards, sliders, file lists).",
		parameters: z.object({ fromRef: ref, fromElement: element, toRef: ref, toElement: element }),
		risk: "write",
		title: (a) => `Dragged ${a.fromElement} to ${a.toElement}`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				await page.getByRef(args.fromRef).dragTo(page.getByRef(args.toRef), { timeout: 10_000 });
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_back",
		description: "Go back to the previous page.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Went back",
		async execute(_args, ctx) {
			return act(ctx, async (page) => {
				await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_tabs",
		description: "List, open, switch between or close tabs.",
		parameters: z.object({
			action: z.enum(["list", "new", "select", "close"]),
			index: z.number().int().min(0).optional(),
			url: z.string().optional().describe("For new: the page to open"),
		}),
		risk: "read",
		title: (a) =>
			a.action === "list"
				? "Looked at the tabs"
				: a.action === "new"
					? "Opened a tab"
					: a.action === "select"
						? "Switched tabs"
						: "Closed a tab",
		async execute(args, ctx) {
			const s = await session(ctx);
			const tabs = tabsOf(s);
			if (args.action === "new") {
				await newTab(s);
				if (args.url)
					await s.page.goto(normalizeUrl(args.url), { waitUntil: "domcontentloaded", timeout: 45_000 });
			} else if (args.action === "select" || args.action === "close") {
				const tab = tabs[args.index ?? -1];
				if (!tab) throw new ToolError(`There's no tab ${args.index}. Tabs: 0 to ${tabs.length - 1}.`);
				if (args.action === "select") {
					s.page = tab;
					await tab.bringToFront();
				} else {
					await tab.close();
					s.page = tabsOf(s).at(-1) ?? (await newTab(s));
				}
			} else {
				const list = await Promise.all(
					tabs.map(
						async (t, i) =>
							`[${i}]${t === s.page ? " (current)" : ""} ${await t.title().catch(() => "")} | ${t.url()}`,
					),
				);
				return list.join("\n");
			}
			await settle(s.page);
			return describePage(s);
		},
	}),
	browserTool({
		name: "browser_wait",
		description: "Wait for text to appear or disappear on the page, or for some seconds (pages that load slowly).",
		parameters: z.object({
			text: z.string().optional(),
			textGone: z.string().optional(),
			seconds: z.number().min(0.5).max(60).optional(),
		}),
		risk: "read",
		title: (a) =>
			a.text
				? `Waited for “${a.text}”`
				: a.textGone
					? `Waited for “${a.textGone}” to go`
					: `Waited ${a.seconds ?? 2}s`,
		async execute(args, ctx) {
			return act(ctx, async (page) => {
				const timeout = (args.seconds ?? 30) * 1000;
				if (args.text) await page.getByText(args.text).first().waitFor({ state: "visible", timeout });
				else if (args.textGone)
					await page.getByText(args.textGone).first().waitFor({ state: "hidden", timeout });
				else await page.waitForTimeout(timeout);
				return undefined;
			});
		},
	}),
	browserTool({
		name: "browser_screenshot",
		description:
			"See the page as a picture (layouts, charts, images, canvas apps). Use the snapshot for finding things to click.",
		parameters: z.object({
			fullPage: z.boolean().optional(),
			ref: z.string().optional().describe("Just this element"),
		}),
		risk: "read",
		title: () => "Took a screenshot of the page",
		async execute(args, ctx) {
			const s = await session(ctx);
			const shot = args.ref
				? await s.page.getByRef(args.ref).screenshot({ type: "jpeg", quality: 75, timeout: 15_000 })
				: await s.page.screenshot({
						type: "jpeg",
						quality: 75,
						fullPage: args.fullPage ?? false,
						timeout: 15_000,
					});
			return new ToolOutput(`Screenshot of ${s.page.url()}`, [
				{ mime: "image/jpeg", data: new Uint8Array(shot) },
			]);
		},
	}),
	browserTool({
		name: "browser_dialog",
		description: "Answer an alert, confirm or prompt dialog the page opened.",
		parameters: z.object({ accept: z.boolean(), promptText: z.string().optional() }),
		risk: "write",
		title: (a) => (a.accept ? "Accepted a dialog" : "Dismissed a dialog"),
		async execute(args, ctx) {
			const s = await session(ctx);
			const d = s.dialog;
			if (!d) throw new ToolError("No dialog is open.");
			s.dialog = null;
			if (args.accept) await d.accept(args.promptText);
			else await d.dismiss();
			await settle(s.page);
			return describePage(s);
		},
	}),
	browserTool({
		name: "browser_evaluate",
		description:
			'Run JavaScript in the page and get the result back, e.g. "() => document.querySelectorAll(\'tr\').length". With a ref, the function gets that element: "(el) => el.value". Prefer the other tools for clicking and typing.',
		parameters: z.object({ function: z.string().min(1).max(20_000), ref: z.string().optional() }),
		risk: "external",
		title: () => "Ran a script on the page",
		async execute(args, ctx) {
			const s = await session(ctx);
			const result = args.ref
				? await s.page.getByRef(args.ref).evaluate(`(${args.function})`)
				: await s.page.evaluate(`(${args.function})()`);
			return typeof result === "string" ? result : (JSON.stringify(result, null, 2) ?? "undefined");
		},
	}),
	browserTool({
		name: "browser_login",
		description:
			"Sign in on the current page with a login from the user: Sekai asks them (or uses a login they let you save) and fills the fields itself, so you never see the password. Give the refs of the username and password fields (and the one-time code field if the page asks for one), plus the sign-in button. Never ask the user for passwords in chat; use this.",
		parameters: z.object({
			usernameRef: z
				.string()
				.optional()
				.describe("Username or email field (omit if the page only asks for a password)"),
			passwordRef: z.string().optional().describe("Password field (omit on a username-only step)"),
			otpRef: z.string().optional().describe("One-time code field, for two-step sign-in"),
			submitRef: z.string().optional().describe("The sign-in button; without it, Enter is pressed"),
			reason: z.string().min(1).max(300).describe("Why you need to sign in, shown to the user"),
			askAgain: z.boolean().optional().describe("The saved login didn't work: ask the user for a new one"),
		}),
		risk: "write",
		title: (a) => (a.otpRef && !a.passwordRef ? "Entered a sign-in code" : "Signed in"),
		async execute(args, ctx) {
			const s = await session(ctx);
			const fields = [
				...(args.usernameRef ? (["username"] as const) : []),
				...(args.passwordRef ? (["password"] as const) : []),
				...(args.otpRef ? (["otp"] as const) : []),
			];
			if (fields.length === 0) throw new ToolError("Give at least one field ref (username, password or code).");
			const settings = await getSettings();
			const login = await requestLogin({
				agentId: ctx.agent.id,
				conversationId: ctx.conversation.id,
				url: s.page.url(),
				reason: args.reason,
				fields: [...fields],
				ask: args.askAgain,
				timeoutMs: settings.approvalTimeoutMinutes * 60_000,
				signal: ctx.signal,
			});
			if (!login) {
				return "The user didn't give a login (cancelled or no answer). Don't try to sign in another way; tell them what you needed it for.";
			}
			const out = await act(ctx, async (page) => {
				if (args.usernameRef) await page.getByRef(args.usernameRef).fill(login.username, { timeout: 10_000 });
				if (args.passwordRef) await page.getByRef(args.passwordRef).fill(login.password, { timeout: 10_000 });
				if (args.otpRef) await page.getByRef(args.otpRef).fill(login.otp, { timeout: 10_000 });
				if (args.submitRef) await page.getByRef(args.submitRef).click({ timeout: 10_000 });
				else await page.keyboard.press("Enter");
				return login.saved
					? "Used the login the user saved for this site."
					: "Filled in the login the user gave.";
			});
			// Never echo secrets back, even if a page displays them.
			return [login.password, login.otp]
				.filter((x) => x.length >= 3)
				.reduce((t, secret) => t.split(secret).join("••••••"), out);
		},
	}),
	browserTool({
		name: "browser_close",
		description: "Close the browser you're using (it reopens on the next browser_open). Sign-ins are kept.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Closed the browser",
		async execute(_args, ctx) {
			await closeCurrentBrowser(ctx.agent.id);
			return "Closed.";
		},
	}),
];
