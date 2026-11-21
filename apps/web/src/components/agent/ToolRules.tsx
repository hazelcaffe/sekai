import { cn, useAgentTools } from "@sekai/client";
import type { Agent, AgentCapabilities, AgentContextTool } from "@sekai/shared";
import { ErrorState, Fold, List, Row, SaveState, SkeletonRows, useAutosave } from "@sekai/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";
import { RiskBadge } from "./RiskBadge.tsx";
import { RuleSelect, type RuleValue } from "./ToolRule.tsx";

/** What it may do: allow, ask or turn off a kind of tool, or one tool. Rules win over the approvals rule. */
export function ToolRules({ agent }: { agent: Agent }) {
	const tools = useAgentTools(agent.id);
	const update = useAgentUpdate(agent);
	const save = useAutosave((caps: AgentCapabilities) => update({ capabilities: caps }));
	const [open, setOpen] = useState<string | null>(null);
	const caps = agent.capabilities;
	const catalog = tools.data;
	const setRule = (key: string, v: RuleValue) => {
		const next = { ...caps.tools };
		if (v === "default") delete next[key];
		else next[key] = v;
		save.save({ ...caps, tools: next });
	};
	const byCategory = new Map<string, AgentContextTool[]>();
	for (const t of catalog?.builtin ?? []) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
	const names = new Set((catalog?.builtin ?? []).map((t) => t.name));
	const count = Object.keys(caps.tools).filter(
		(k) => names.has(k) || (k.startsWith("category:") && !k.startsWith("category:mcp:")),
	).length;

	return (
		<Fold
			title="What it may do"
			summary={count ? `${count} custom ${count === 1 ? "rule" : "rules"}` : "Everything follows approvals"}
			description="Allow, ask or turn off a kind of tool, or one tool. Rules win over the approvals rule."
			defaultOpen={count > 0}
		>
			{save.status !== "idle" && <SaveState state={save} />}
			{tools.isLoading ? (
				<SkeletonRows count={5} leading={false} />
			) : tools.isError ? (
				<ErrorState size="sm" error={tools.error} onRetry={() => void tools.refetch()} />
			) : (
				<List label="Kinds of tools">
					{[...byCategory.entries()].map(([category, list]) => {
						const key = `category:${category}`;
						const isOpen = open === category;
						const custom = list.filter((t) => caps.tools[t.name]).length;
						return (
							<Row
								key={category}
								wrap
								title={
									<span className="flex items-center gap-1.5">
										<ChevronRight
											aria-hidden
											className={cn(
												"size-4 shrink-0 text-fg-subtle transition-transform duration-fast",
												isOpen && "rotate-90",
											)}
										/>
										{catalog?.categories[category] ?? category}
									</span>
								}
								subtitle={`${list.length} ${list.length === 1 ? "tool" : "tools"}${custom ? ` · ${custom} with their own rule` : ""}`}
								onClick={() => setOpen(isOpen ? null : category)}
								trailing={
									<RuleSelect
										label={`Rule for ${catalog?.categories[category] ?? category}`}
										value={(caps.tools[key] as RuleValue | undefined) ?? "default"}
										onChange={(v) => setRule(key, v)}
									/>
								}
							>
								{isOpen && (
									<div className="relative z-10 mt-2 flex flex-col gap-1 pb-1">
										{list.map((t) => (
											<div
												key={t.name}
												className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-2 py-1 pr-1 pl-3"
											>
												<div className="min-w-0 flex-1 basis-40">
													<div className="flex flex-wrap items-center gap-1.5">
														<code className="font-mono text-small break-all">{t.name}</code>
														{t.risk !== "read" && <RiskBadge risk={t.risk} />}
													</div>
													{t.rule && t.ruleSource !== "agent" && (
														<div className="text-caption text-fg-muted">
															{t.ruleSource === "global" ? "Your default" : "This chat"}{" "}
															says {t.rule}
														</div>
													)}
												</div>
												<RuleSelect
													label={`Rule for ${t.name}`}
													value={(caps.tools[t.name] as RuleValue | undefined) ?? "default"}
													onChange={(v) => setRule(t.name, v)}
													inherited={caps.tools[key] ? "As its kind" : "By approvals"}
												/>
											</div>
										))}
									</div>
								)}
							</Row>
						);
					})}
				</List>
			)}
		</Fold>
	);
}
