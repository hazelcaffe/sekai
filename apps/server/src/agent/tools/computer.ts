import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { type DesktopControl, formatTree, type UiElement } from "../../machines/desktop.ts";
import { desktopOf } from "../../machines/manager.ts";
import { anyDesktop, askOn, desktopTarget, onDesktop, peek, riskOn } from "./targets.ts";
import { defineTool, type ToolContext, ToolError, ToolOutput } from "./types.ts";

/**
 * Using a desktop: the bot's own Linux computer, or the user's computer (Windows, macOS or Linux) when they
 * lend it through the desktop app. Screenshots, the accessibility tree (elements with ids and boxes), and
 * mouse and keyboard. Coordinates are in screenshot pixels. Each action returns a fresh screenshot so the
 * bot sees what happened.
 */

async function desktop(ctx: ToolContext, on?: string): Promise<{ d: DesktopControl; key: string; where: string }> {
	const m = await desktopTarget(ctx, on);
	const where = m.kind === "device" ? `${m.name} (the user's computer)` : m.name;
	return { d: await desktopOf(m), key: `${ctx.agent.id}:${m.id}`, where };
}

/** The latest accessibility tree per bot and machine, so element ids can be clicked without fetching it again. */
const trees = new Map<string, { elements: UiElement[]; scale: number; at: number }>();

async function elementBox(key: string, id: string): Promise<{ x: number; y: number }> {
	const t = trees.get(key);
	const e = t?.elements.find((x) => x.id === id);
	if (!t || !e)
		throw new ToolError(`Element ${id} isn't in your latest computer_ui tree for this screen; look again.`);
	if (!e.box) throw new ToolError(`Element ${id} has no position on screen.`);
	const [x, y, w, h] = e.box;
	return { x: (x + w / 2) / t.scale, y: (y + h / 2) / t.scale };
}

/** A screenshot after an action, plus where things stand. */
async function look(d: DesktopControl, note: string): Promise<ToolOutput> {
	await d.waitIdle(2).catch(() => {});
	const [shot, wins] = await Promise.all([d.screenshot(), d.windows().catch(() => null)]);
	const lines = [
		note,
		`Screen: ${shot.width}x${shot.height} (screenshot pixels). Active window: ${wins?.activeWindow ?? "none"}`,
	];
	if (wins?.windows.length) lines.push(`Windows: ${wins.windows.map((w) => `${w.title} [${w.id}]`).join("; ")}`);
	return new ToolOutput(lines.join("\n"), [{ mime: "image/png", data: shot.png }]);
}

async function attempt<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof ToolError) throw err;
		throw new ToolError(errorMessage(err).slice(0, 600));
	}
}

const point = { x: z.number().min(0).optional(), y: z.number().min(0).optional() };

/** Every computer_ tool: offered when the bot has a screen to use, and weighed by whose screen it is. */
const computerTool = <S extends z.ZodType>(
	def: Omit<Parameters<typeof defineTool<S>>[0], "category" | "available" | "riskFor" | "askFirst">,
) =>
	defineTool<S>({
		...def,
		category: "computer",
		available: (agent) => anyDesktop(agent.id),
		riskFor: async (args, ctx) => riskOn(await peek(ctx, (args as { on?: string }).on, true), def.risk),
		askFirst: async (args, ctx) => askOn(await peek(ctx, (args as { on?: string }).on, true), def.risk),
	});

export const computerTools = [
	computerTool({
		name: "computer_screenshot",
		description:
			"See a screen: your own computer's (Debian with XFCE) by default, or the user's computer with on: \"device\" when they lent it to you through the Sekai desktop app. Coordinates in the other computer_ tools are in this screenshot's pixels.",
		parameters: z.object({ on: onDesktop }),
		risk: "read",
		title: () => "Looked at the screen",
		async execute(args, ctx) {
			const { d, where } = await desktop(ctx, args.on);
			return attempt(() => look(d, `The screen of ${where}:`));
		},
	}),
	computerTool({
		name: "computer_ui",
		description:
			"Read the screen's accessibility tree: buttons, menus, fields and text with ids and positions. Faster and more exact than reading pixels; click an element by its id. Pass an app name to see only that app.",
		parameters: z.object({
			on: onDesktop,
			app: z.string().optional().describe("Only this app, e.g. mousepad, Thunar, google-chrome"),
			all: z.boolean().optional().describe("Include containers and decoration too"),
		}),
		risk: "read",
		title: (a) => (a.app ? `Read ${a.app}'s controls` : "Read the screen's controls"),
		async execute(args, ctx) {
			const { d, key } = await desktop(ctx, args.on);
			return attempt(async () => {
				const [tree, scale] = await Promise.all([d.tree(args.app, args.all), d.scale()]);
				trees.set(key, { elements: tree.elements, scale, at: Date.now() });
				return formatTree(tree, scale);
			});
		},
	}),
	computerTool({
		name: "computer_click",
		description:
			"Click at a point (x, y in screenshot pixels) or on an element from computer_ui (element id). action: run an element's own action instead of clicking (e.g. press, toggle).",
		parameters: z.object({
			on: onDesktop,
			...point,
			element: z.string().optional().describe("An element id from computer_ui, e.g. 0.11.0.0.0.0.0"),
			action: z.string().optional(),
			button: z.enum(["left", "middle", "right"]).optional(),
			double: z.boolean().optional(),
			description: z.string().max(120).describe("What you're clicking, in a few words (shown to the user)"),
		}),
		risk: "write",
		title: (a) => `Clicked ${a.description.replace(/^(double[- ])?click(ed)?\s+(on\s+|in\s+)?/i, "")}`,
		async execute(args, ctx) {
			const { d, key } = await desktop(ctx, args.on);
			return attempt(async () => {
				if (args.element && args.action) {
					await d.act(args.element, args.action);
					return look(d, `Did "${args.action}" on ${args.description}.`);
				}
				const at = args.element ? await elementBox(key, args.element) : { x: args.x, y: args.y };
				if (at.x === undefined || at.y === undefined) throw new ToolError("Give x and y, or an element id.");
				await d.click(at.x, at.y, args.button ?? "left", args.double ? 2 : 1);
				return look(d, `Clicked ${args.description} at (${Math.round(at.x)}, ${Math.round(at.y)}).`);
			});
		},
	}),
	computerTool({
		name: "computer_type",
		description:
			"Type text where the keyboard focus is (click a field first, or pass its element id). Use computer_key for shortcuts and Enter.",
		parameters: z.object({ on: onDesktop, text: z.string().min(1).max(20_000), element: z.string().optional() }),
		risk: "write",
		title: (a) => `Typed “${a.text.length > 40 ? `${a.text.slice(0, 40)}…` : a.text}”`,
		async execute(args, ctx) {
			const { d, key } = await desktop(ctx, args.on);
			return attempt(async () => {
				if (args.element) {
					await d.focusElement(args.element).catch(async () => {
						const at = await elementBox(key, args.element ?? "");
						await d.click(at.x, at.y);
					});
				}
				await d.type(args.text);
				return look(d, `Typed ${args.text.length} characters.`);
			});
		},
	}),
	computerTool({
		name: "computer_key",
		description:
			"Press keys or shortcuts, in order: Return, Escape, Tab, ctrl+l, ctrl+shift+t, alt+F4, super, Page_Down…",
		parameters: z.object({ on: onDesktop, keys: z.array(z.string().min(1)).min(1).max(20) }),
		risk: "write",
		title: (a) => `Pressed ${a.keys.join(", ")}`,
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				await d.key(...args.keys);
				return look(d, `Pressed ${args.keys.join(", ")}.`);
			});
		},
	}),
	computerTool({
		name: "computer_scroll",
		description: "Scroll at a point (x, y in screenshot pixels).",
		parameters: z.object({
			on: onDesktop,
			x: z.number().min(0),
			y: z.number().min(0),
			direction: z.enum(["up", "down", "left", "right"]),
			amount: z.number().int().min(1).max(30).default(5),
		}),
		risk: "read",
		title: (a) => `Scrolled ${a.direction}`,
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				await d.scroll(args.x, args.y, args.direction, args.amount);
				return look(d, `Scrolled ${args.direction}.`);
			});
		},
	}),
	computerTool({
		name: "computer_drag",
		description:
			"Drag from one point to another (screenshot pixels): moving windows, selecting text, drag and drop.",
		parameters: z.object({
			on: onDesktop,
			fromX: z.number().min(0),
			fromY: z.number().min(0),
			toX: z.number().min(0),
			toY: z.number().min(0),
			description: z.string().max(120),
		}),
		risk: "write",
		title: (a) => `Dragged ${a.description}`,
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				await d.drag(args.fromX, args.fromY, args.toX, args.toY);
				return look(d, `Dragged ${args.description}.`);
			});
		},
	}),
	computerTool({
		name: "computer_open",
		description:
			"Start an app: on your computer google-chrome, mousepad (text editor), xfce4-terminal, thunar (files), ristretto (images), or any command. On the user's computer, an app name or path (Windows: notepad, msedge; macOS: TextEdit, Safari).",
		parameters: z.object({ on: onDesktop, command: z.string().min(1).max(500) }),
		risk: "write",
		title: (a) => `Opened ${a.command.split(" ")[0]}`,
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				await d.open(args.command);
				return look(d, `Started ${args.command}.`);
			});
		},
	}),
	computerTool({
		name: "computer_windows",
		description: "List open windows, or bring one to the front by its id.",
		parameters: z.object({
			on: onDesktop,
			activate: z.string().optional().describe("Window id to bring to the front"),
		}),
		risk: "read",
		title: (a) => (a.activate ? "Switched windows" : "Looked at the windows"),
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				if (args.activate) {
					await d.activate(args.activate);
					return look(d, "Switched windows.");
				}
				const w = await d.windows();
				const scale = await d.scale();
				return [
					`Active: ${w.activeWindow ?? "none"}`,
					...w.windows.map(
						(x) =>
							`[${x.id}] ${x.app}: ${x.title} at (${Math.round(x.x / scale)},${Math.round(x.y / scale)} ${Math.round(x.width / scale)}x${Math.round(x.height / scale)})`,
					),
				].join("\n");
			});
		},
	}),
	computerTool({
		name: "computer_clipboard",
		description: "Read the clipboard, or put text on it (then paste with ctrl+v).",
		parameters: z.object({ on: onDesktop, text: z.string().max(100_000).optional() }),
		risk: "write",
		title: (a) => (a.text === undefined ? "Read the clipboard" : "Copied to the clipboard"),
		async execute(args, ctx) {
			const { d } = await desktop(ctx, args.on);
			return attempt(async () => {
				if (args.text === undefined) return (await d.readClipboard()) || "(the clipboard is empty)";
				await d.writeClipboard(args.text);
				return "Copied.";
			});
		},
	}),
];
