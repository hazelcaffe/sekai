import type { PageBack } from "@sekai/ui";

/** What every Settings section gets from the layout (src/settings/registry.tsx lists the sections). */
export interface SettingsSectionProps {
	/** Back to the list of sections (shown on phones, where the list is a step back). Give it to your <Page>. */
	back: PageBack;
	/** The rest of the address after the section's own (a sub-page, like a person's id), or "". */
	rest: string;
	/** The person may open this section but not change it: show it read only. */
	readOnly: boolean;
}
