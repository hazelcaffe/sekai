import { ExtensionAction, extensionWebUrl } from "@sekai/shared";
import { z } from "zod";
import { currentActor } from "../../auth/actor.ts";
import { extensionBroker } from "../../browser/extension.ts";
import { errorMessage } from "../../lib/errors.ts";
import { defineTool, ToolError, ToolOutput } from "./types.ts";

export const extensionTools = [
	defineTool({
		name: "extension_browsers",
		category: "browser",
		description:
			"List the user's real browser panels shared with you in this chat. Load the browser-extension skill before controlling one. These are NOT your separate browser_open sessions.",
		parameters: z.object({}),
		risk: "read",
		title: () => "Looked for shared browsers",
		available: (agent) => {
			const actor = currentActor();
			return Boolean(
				actor && actor.userId === agent.userId && extensionBroker.list(actor.userId, agent.id).length,
			);
		},
		async execute(_args, ctx) {
			const actor = currentActor();
			if (!actor || actor.userId !== ctx.agent.userId) throw new ToolError("No browser is shared with you.");
			return extensionBroker.list(actor.userId, ctx.agent.id, ctx.conversation.id);
		},
	}),
	defineTool({
		name: "extension_browser",
		category: "browser",
		description:
			"Control the user's actual signed-in browser through the Sekai extension. Only explicitly shared tabs are accessible. Get connectionId from extension_browsers; action tabs lists shared tab IDs, snapshot gives pageId and element refs. Always use fresh pageId/refs and explicit tabId. Screenshot is the visible viewport only. Never guess refs or use this for passwords. Mutations always ask the user, even when the approvals rule is “Don't ask”.",
		parameters: z.object({ connectionId: z.string().min(1).max(80), input: ExtensionAction }),
		risk: "external",
		riskFor: (args) => (["tabs", "snapshot", "screenshot"].includes(args.input.action) ? "read" : "external"),
		askFirst: (args) =>
			["tabs", "snapshot", "screenshot", "scroll"].includes(args.input.action)
				? null
				: "This acts in your own signed-in browser. Check the tab and action before allowing it.",
		title: (args) => `Used your browser: ${args.input.action}`,
		available: (agent) => {
			const actor = currentActor();
			return Boolean(
				actor && actor.userId === agent.userId && extensionBroker.list(actor.userId, agent.id).length,
			);
		},
		async execute(args, ctx) {
			const actor = currentActor();
			if (!actor || actor.userId !== ctx.agent.userId) throw new ToolError("No browser is shared with you.");
			try {
				if ("url" in args.input) extensionWebUrl(args.input.url);
				const result = await extensionBroker.command(
					actor.userId,
					ctx.agent.id,
					ctx.conversation.id,
					args.connectionId,
					args.input,
					ctx.signal,
				);
				if (result.error) throw new Error(result.error);
				if (result.image) {
					if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result.image))
						throw new Error("The browser sent an invalid screenshot.");
					return new ToolOutput(result.result ?? "Screenshot of the shared tab.", [
						{
							mime: "image/jpeg",
							data: new Uint8Array(Buffer.from(result.image.split(",")[1] ?? "", "base64")),
						},
					]);
				}
				return result.result ?? "Done. Take a fresh snapshot before the next action.";
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
] as const;
