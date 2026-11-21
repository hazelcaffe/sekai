import { useAccess } from "@sekai/client";
import { Page, Tabs, TabsList, TabsTrigger } from "@sekai/ui";
import { useNavigate } from "react-router";
import { CodeIndexes } from "../../components/agent/CodeIndexes.tsx";
import { Memories } from "../../components/agent/Memories.tsx";
import { NotePage, Notes } from "../../components/agent/Notes.tsx";
import { useGoBack } from "../../lib/back.ts";
import { memoryView } from "../paths.ts";
import { botPath, ownsBot } from "../registry.tsx";
import type { BotSectionProps } from "../section.ts";

/**
 * What it remembers (yours of it, for a bot shared with you), what it knows about you, its notes and its code.
 * The address says which: /memory, /memory/notes, /memory/notes/:id (or "new") and /memory/code.
 */
export function MemorySection({ agent, back, rest }: BotSectionProps) {
	const own = ownsBot(agent);
	const { can } = useAccess();
	const navigate = useNavigate();
	const goBack = useGoBack();
	const notesPath = botPath(agent.id, "memory", "notes");
	const showCode = own && can("code");
	const where = memoryView(rest, showCode);

	if (where.tab === "note") {
		return (
			<NotePage
				agent={agent}
				noteId={where.id}
				back={{ label: "Notes", onClick: () => goBack(notesPath) }}
				goBack={() => navigate(notesPath, { replace: true })}
			/>
		);
	}
	const current = where.tab;
	return (
		<Page
			back={back}
			title="Memory"
			description={
				!own
					? `What ${agent.name} remembers about you, and your notes with it.`
					: showCode
						? `What ${agent.name} remembers, the notes it keeps and the code it knows.`
						: `What ${agent.name} remembers, and the notes it keeps.`
			}
		>
			<Tabs
				value={current}
				// Switching replaces the entry, so back leaves Memory instead of walking through the tabs.
				onValueChange={(v) =>
					navigate(botPath(agent.id, "memory", v === "memories" ? "" : v), { replace: true })
				}
			>
				<TabsList aria-label="Memory">
					<TabsTrigger value="memories">Memories</TabsTrigger>
					<TabsTrigger value="notes">Notes</TabsTrigger>
					{showCode && <TabsTrigger value="code">Code</TabsTrigger>}
				</TabsList>
			</Tabs>
			{current === "memories" && <Memories agent={agent} viewer={!own} />}
			{current === "notes" && <Notes agent={agent} />}
			{current === "code" && <CodeIndexes key={agent.id} agent={agent} />}
		</Page>
	);
}
