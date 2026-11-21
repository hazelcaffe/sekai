import type { Agent } from "@sekai/shared";
import type { PageBack } from "@sekai/ui";

/** What every section of a bot's page gets from the layout (src/bots/registry.tsx lists the sections). */
export interface BotSectionProps {
	agent: Agent;
	/** Back to the bot's list of sections (shown on phones). Give it to your <Page>. */
	back: PageBack;
	/** The rest of the address after the section's own (/bots/:id/accounts/x → "x"), or "". */
	rest: string;
	/** Someone else's bot, shared with you: you may look, not change (its setup is its owner's). */
	readOnly: boolean;
}
