import { z } from "zod";
import { bus } from "../../events/bus.ts";
import { formatDateTime, isoInZone, isValidTimezone } from "../../lib/time.ts";
import { updateConversation } from "../../services/conversations.ts";
import { defineTool, ToolError } from "./types.ts";

export const systemTools = [
	defineTool({
		name: "notify_user",
		category: "system",
		description:
			"Send the user just a desktop/push notification (no message). Usually message_user is better: it also leaves the message where they'll read it.",
		parameters: z.object({
			title: z.string().min(1).max(120),
			body: z.string().max(1000),
		}),
		risk: "external",
		title: () => "Sent a notification",
		async execute(args, ctx) {
			bus.emit({
				type: "notification",
				title: args.title,
				body: args.body,
				agentId: ctx.agent.id,
				conversationId: ctx.conversation.id,
			});
			return { sent: true };
		},
	}),
	defineTool({
		name: "current_time",
		category: "system",
		description: "Get the current date and time, optionally in another IANA time zone.",
		parameters: z.object({ timezone: z.string().optional() }),
		risk: "read",
		title: () => "Checked the time",
		async execute(args, ctx) {
			const tz = args.timezone ?? ctx.timezone;
			if (!isValidTimezone(tz)) throw new ToolError(`Unknown time zone "${tz}"`);
			const now = Date.now();
			return { timezone: tz, iso: isoInZone(now, tz), readable: formatDateTime(now, tz) };
		},
	}),
	defineTool({
		name: "conversation_rename",
		category: "system",
		description: "Rename the current conversation (shown in the sidebar).",
		parameters: z.object({ title: z.string().min(1).max(120) }),
		risk: "write",
		title: (a) => `Renamed chat to “${a.title}”`,
		async execute(args, ctx) {
			await updateConversation(ctx.conversation.id, { title: args.title });
			return { renamed: true };
		},
	}),
];
