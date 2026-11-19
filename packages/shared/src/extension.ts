import { z } from "zod";
import type { Message } from "./message.ts";
import type { PendingApproval } from "./run.ts";

const tabId = z.number().int().nonnegative();
const page = { tabId, pageId: z.string().min(1).max(80) };
const target = { ...page, ref: z.string().regex(/^e\d+$/) };

/** No arbitrary JavaScript, cookies, network requests, files or browser settings cross this bridge. */
export const ExtensionAction = z.discriminatedUnion("action", [
	z.object({ action: z.literal("tabs") }),
	z.object({ action: z.literal("snapshot"), tabId }),
	z.object({ action: z.literal("screenshot"), tabId }),
	z.object({ action: z.literal("click"), ...target }),
	z.object({ action: z.literal("type"), ...target, text: z.string().max(20_000) }),
	z.object({ action: z.literal("select"), ...target, value: z.string().max(2000) }),
	z.object({
		action: z.literal("press"),
		...target,
		key: z.enum(["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"]),
	}),
	z.object({
		action: z.literal("scroll"),
		...page,
		direction: z.enum(["up", "down"]),
		pixels: z.number().int().min(1).max(3000),
	}),
	z.object({ action: z.literal("navigate"), ...page, url: z.string().url().max(4000) }),
	z.object({ action: z.literal("back"), ...page }),
	z.object({ action: z.literal("forward"), ...page }),
	z.object({ action: z.literal("reload"), ...page }),
	z.object({ action: z.literal("open"), url: z.string().url().max(4000) }),
	z.object({ action: z.literal("close"), ...page }),
]);
export type ExtensionAction = z.infer<typeof ExtensionAction>;

export const ExtensionConnect = z.object({
	agentId: z.string().min(1).max(80),
	conversationId: z.string().min(1).max(80),
	name: z.string().trim().min(1).max(80),
});
export type ExtensionConnect = z.infer<typeof ExtensionConnect>;

export interface ExtensionSession {
	id: string;
	agentId: string;
	conversationId: string;
	name: string;
}

export interface ExtensionCommand {
	id: string;
	input: ExtensionAction;
	expiresAt: number;
}

export const ExtensionResult = z.object({
	commandId: z.string().min(1).max(80),
	result: z.string().max(40_000).optional(),
	error: z.string().max(1000).optional(),
	/** Only a screenshot command may return this. */
	image: z.string().max(4_000_000).optional(),
});
export type ExtensionResult = z.infer<typeof ExtensionResult>;

export interface ExtensionChat {
	messages: Message[];
	approvals: PendingApproval[];
}

/** Browser profiles have sign-ins: never let a page redirect this bridge into a privileged scheme. */
export function extensionWebUrl(value: string): URL {
	const url = new URL(value);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
		throw new Error("Only web addresses without embedded passwords can be opened.");
	}
	return url;
}

/** Extension origins need CORS but never permission to send Sekai's sign-in cookies. */
export function isExtensionOrigin(origin: string): boolean {
	return /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36}|safari-web-extension:\/\/[a-zA-Z0-9-]+)$/.test(
		origin,
	);
}
