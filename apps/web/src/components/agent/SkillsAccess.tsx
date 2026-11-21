import { settingsUrl, useAccess, useSkills } from "@sekai/client";
import type { Agent } from "@sekai/shared";
import {
	Button,
	EmptyState,
	ErrorState,
	Fold,
	Link,
	List,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	ToggleRow,
	useAutosave,
} from "@sekai/ui";
import { Sparkles } from "lucide-react";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";

/** The skills it may follow: switch each on or off for this bot (shared ones are on for every bot). */
export function SkillsAccess({ agent }: { agent: Agent }) {
	const skills = useSkills();
	const { can } = useAccess();
	const update = useAgentUpdate(agent);
	const save = useAutosave((skillIds: string[]) => update({ skillIds }));
	const enabled = (skills.data ?? []).filter((s) => s.enabled);
	const own = enabled.filter((s) => !s.shared);
	const shared = enabled.filter((s) => s.shared);
	const manage = can("apps") && (
		<Button variant="ghost" size="sm" asChild>
			<Link href={settingsUrl("apps")}>Manage skills</Link>
		</Button>
	);

	return (
		<Section
			title="Skills"
			description="Know-how it follows when a task calls for it."
			saveState={save.status !== "idle" ? <SaveState state={save} /> : undefined}
			action={enabled.length > 0 && manage}
		>
			{skills.isLoading ? (
				<SkeletonRows count={3} leading={false} />
			) : skills.isError ? (
				<ErrorState size="sm" error={skills.error} onRetry={() => void skills.refetch()} />
			) : enabled.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<Sparkles />}
					title="No skills yet"
					description="Skills are written in Settings → Apps & skills."
					action={manage || undefined}
				/>
			) : (
				<>
					{own.length > 0 && (
						<List label="Skills">
							{own.map((s) => (
								<ToggleRow
									key={s.id}
									title={s.title}
									description={<span className="line-clamp-2">{s.description}</span>}
									checked={agent.skillIds.includes(s.id)}
									onCheckedChange={(on) =>
										save.save(
											on ? [...agent.skillIds, s.id] : agent.skillIds.filter((id) => id !== s.id),
										)
									}
								/>
							))}
						</List>
					)}
					{shared.length > 0 && (
						<Fold
							variant="link"
							className="[&>div]:w-full"
							title={`${shared.length} ${shared.length === 1 ? "skill" : "skills"} every bot has`}
						>
							<List label="Skills every bot has" className="mt-1">
								{shared.map((s) => (
									<Row
										key={s.id}
										title={s.title}
										subtitle={<span className="line-clamp-2">{s.description}</span>}
									/>
								))}
							</List>
						</Fold>
					)}
				</>
			)}
		</Section>
	);
}
