import type { ToolRisk } from "@sekai/shared";
import { Badge as UiBadge } from "@sekai/ui";

const TONE = { read: "neutral", write: "info", external: "warning", destructive: "danger" } as const;
const WORD = { read: "Reads", write: "Changes things", external: "Reaches out", destructive: "Deletes" } as const;

/** How much a tool can do, in a word: reads, changes things, reaches out, deletes. */
export function RiskBadge({ risk }: { risk: ToolRisk }) {
	return <UiBadge tone={TONE[risk]}>{WORD[risk]}</UiBadge>;
}
