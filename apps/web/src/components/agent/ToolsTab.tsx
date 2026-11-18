import {
	AppIcon,
	AppStore,
	adminUrl,
	api,
	appOf,
	appState,
	cn,
	ManageApp,
	MODE_ICONS,
	useAgentTools,
	useMcpServers,
	useSettings,
	useSkills,
} from "@sekai/client";
import {
	type Agent,
	type AgentCapabilities,
	type AgentContextTool,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalModeSetting,
	type Conversation,
	type McpServerWithStatus,
	type ToolPermission,
} from "@sekai/shared";
import { Badge, Button, Dialog, Fold, Section, Select, Spinner, Switch, ToggleRow } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Blocks, ChevronRight, Plus, Sparkles } from "lucide-react";
import { useState } from "react";

const RISK_TONE = { read: "neutral", write: "info", external: "warning", destructive: "danger" } as const;

type RuleValue = ToolPermission | "default";

function RuleSelect({
	value,
	onChange,
	inherited,
}: {
	value: RuleValue;
	onChange: (v: RuleValue) => void;
	inherited?: string;
}) {
	return (
		<Select
			size="sm"
			value={value}
			onValueChange={(v) => onChange(v as RuleValue)}
			className="w-28 shrink-0"
			options={[
				{ value: "default", label: inherited ?? "By mode" },
				{ value: "allow", label: "Allow" },
				{ value: "ask", label: "Ask" },
				{ value: "off", label: "Off" },
			]}
		/>
	);
}

/** Apps (MCP) this bot can use: the ones every bot has, its own, and the store to add more. */
function AppsSection({
	agent,
	caps,
	setRule,
}: {
	agent: Agent;
	caps: AgentCapabilities;
	setRule: (key: string, v: RuleValue) => void;
}) {
	const { data: servers = [] } = useMcpServers();
	const { data: catalog } = useAgentTools(agent.id);
	const [store, setStore] = useState(false);
	const [managing, setManaging] = useState<McpServerWithStatus | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	const everyBot = servers.filter((s) => s.scope === "all");
	const others = servers.filter((s) => s.scope !== "all");

	const row = (s: McpServerWithStatus) => {
		const binding = agent.mcp.find((b) => b.serverId === s.id);
		const on = s.scope === "all" || Boolean(binding);
		const key = `category:mcp:${s.name}`;
		const rule = (caps.tools[key] as RuleValue | undefined) ?? "default";
		const tools = (catalog?.mcp ?? []).filter((t) => t.serverId === s.id);
		const st = appState(s);
		const { domain } = appOf(s);
		const expanded = openId === s.id && on && tools.length > 0;
		return (
			<div key={s.id} className="rounded-2xl border border-border bg-card">
				<div className="flex items-center gap-3 px-3 py-2.5">
					<button
						type="button"
						onClick={() => setManaging(s)}
						className="shrink-0"
						aria-label={`Manage ${s.title}`}
					>
						<AppIcon domain={domain} name={s.title} size={34} />
					</button>
					<button
						type="button"
						onClick={() => setOpenId(expanded ? null : s.id)}
						className="min-w-0 flex-1 text-left"
						disabled={!on || tools.length === 0}
					>
						<div className="flex items-center gap-1.5">
							<span className="truncate text-sm font-medium">{s.title}</span>
							{on && tools.length > 0 && (
								<ChevronRight
									className={cn(
										"size-3.5 shrink-0 text-fg-subtle transition-transform",
										expanded && "rotate-90",
									)}
								/>
							)}
						</div>
						<div
							className={cn(
								"truncate text-xs",
								st.tone === "warning" || st.tone === "danger" ? "text-warning" : "text-fg-subtle",
							)}
						>
							{st.tone === "success" ? `${tools.length || s.status.tools.length} tools` : st.label}
							{s.requireApproval && " · always asks"}
						</div>
					</button>
					{on && <RuleSelect value={rule} onChange={(v) => setRule(key, v)} />}
					{s.scope === "all" ? (
						// Every bot has it; "Off" in the rule turns it off for just this one.
						<Badge>All bots</Badge>
					) : (
						<Switch
							checked={on}
							label={`Give ${agent.name} ${s.title}`}
							onCheckedChange={(next) =>
								update.mutate({
									mcp: next
										? [...agent.mcp, { serverId: s.id, tools: null }]
										: agent.mcp.filter((b) => b.serverId !== s.id),
								})
							}
						/>
					)}
				</div>
				{expanded && (
					<div className="flex flex-col gap-1 border-t border-border px-3.5 py-2.5">
						{tools.map((t) => (
							<label key={t.name} className="flex items-center gap-2.5 py-1 text-xs">
								<input
									type="checkbox"
									checked={t.enabled}
									disabled={s.scope === "all" && !binding}
									onChange={(e) => {
										const all = tools.map((x) => x.originalName);
										const current = binding?.tools ?? all;
										const next = e.target.checked
											? [...new Set([...current, t.originalName])]
											: current.filter((n) => n !== t.originalName);
										const b = { serverId: s.id, tools: next.length === all.length ? null : next };
										update.mutate({
											mcp: binding
												? agent.mcp.map((x) => (x.serverId === s.id ? b : x))
												: [...agent.mcp, b],
										});
									}}
									className="size-4 accent-current"
								/>
								<span className="min-w-0 flex-1 truncate">{t.originalName}</span>
								<Badge tone={RISK_TONE[t.risk]}>{t.risk}</Badge>
							</label>
						))}
					</div>
				)}
			</div>
		);
	};

	return (
		<Section
			title="Apps"
			description={`Tools from connected apps (MCP). Rules work like the built-in ones.`}
			action={
				<Button variant="secondary" size="sm" onClick={() => setStore(true)}>
					<Plus /> Browse apps
				</Button>
			}
		>
			{servers.length === 0 ? (
				<button
					type="button"
					onClick={() => setStore(true)}
					className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong px-4 py-4 text-left text-sm text-fg-muted hover:bg-surface-2/50"
				>
					<Blocks className="size-5 shrink-0" />
					<span>
						<span className="block font-medium text-fg">Connect an app</span>
						Notion, GitHub, Gmail, Cloudflare, Linear and more.
					</span>
				</button>
			) : (
				<div className="flex flex-col gap-4">
					{everyBot.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<div className="text-xs font-medium text-fg-subtle">Every bot has these</div>
							{everyBot.map(row)}
						</div>
					)}
					{others.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<div className="text-xs font-medium text-fg-subtle">Turn on for {agent.name}</div>
							{others.map(row)}
						</div>
					)}
				</div>
			)}
			<Dialog
				open={store}
				onOpenChange={setStore}
				size="xl"
				title="App store"
				description={`New apps go to ${agent.name} unless you pick “Every bot”.`}
			>
				<AppStore
					agent={agent}
					onAdded={() => setStore(false)}
					onCustom={() => window.open(adminUrl("apps"), "_blank")}
				/>
			</Dialog>
			<ManageApp server={managing} onOpenChange={(o) => !o && setManaging(null)} />
		</Section>
	);
}

/** Approval mode, capabilities and per-tool rules: what this bot may do, and when it must ask. */
export function ToolsTab({ agent, conversation }: { agent: Agent; conversation: Conversation }) {
	const { data: catalog, isLoading } = useAgentTools(agent.id);
	const { data: settings } = useSettings();
	const [openCategory, setOpenCategory] = useState<string | null>(null);
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	const caps = agent.capabilities;
	const setCaps = (patch: Partial<AgentCapabilities>) => update.mutate({ capabilities: { ...caps, ...patch } });
	const setRule = (key: string, v: RuleValue) => {
		const tools = { ...caps.tools };
		if (v === "default") delete tools[key];
		else tools[key] = v;
		setCaps({ tools });
	};
	const globalMode = settings?.approvalMode ?? "auto";
	const chatMode = conversation.settings.approvalMode;
	const effective = caps.approvalMode === "inherit" ? globalMode : caps.approvalMode;

	const byCategory = new Map<string, AgentContextTool[]>();
	for (const t of catalog?.builtin ?? []) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
	const builtinNames = new Set((catalog?.builtin ?? []).map((t) => t.name));
	const ruleCount = Object.keys(caps.tools).filter(
		(k) => builtinNames.has(k) || (k.startsWith("category:") && !k.startsWith("category:mcp:")),
	).length;

	const modeLabel = (m: ApprovalModeSetting) => (
		<span className="flex items-center gap-2 [&_svg]:size-4">
			<span className={cn("shrink-0", m === "yolo" ? "text-danger" : "text-fg-subtle")}>
				{m === "inherit" ? MODE_ICONS[globalMode] : MODE_ICONS[m]}
			</span>
			{m === "inherit" ? `App default (${APPROVAL_MODE_INFO[globalMode].short})` : APPROVAL_MODE_INFO[m].title}
		</span>
	);

	return (
		<div className="flex flex-col gap-6">
			<Section title="Approvals" description="When this bot must ask you before acting.">
				<Select
					value={caps.approvalMode}
					onValueChange={(v) => setCaps({ approvalMode: v as ApprovalModeSetting })}
					options={(["inherit", ...APPROVAL_MODES] as ApprovalModeSetting[]).map((m) => ({
						value: m,
						label: modeLabel(m),
						description:
							m === "inherit"
								? "Follow Settings → Approvals in Admin."
								: APPROVAL_MODE_INFO[m].description,
					}))}
				/>
				<p className="-mt-1 text-xs leading-5 text-fg-subtle">
					{APPROVAL_MODE_INFO[effective].description}
					{chatMode !== "inherit" && (
						<>
							{" "}
							<span className="text-fg-muted">
								This chat uses {APPROVAL_MODE_INFO[chatMode].title} instead (set in the message box).
							</span>
						</>
					)}
				</p>
			</Section>

			<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
				<ToggleRow
					className="px-4 py-3"
					title="Web search"
					description="Searches through the gateway, with sources."
					checked={caps.webSearch}
					onCheckedChange={(webSearch) => setCaps({ webSearch })}
				/>
				<ToggleRow
					className="px-4 py-3"
					title="Learns as it goes"
					description="Saves lasting facts after each reply."
					checked={caps.autoLearn}
					onCheckedChange={(autoLearn) => setCaps({ autoLearn })}
				/>
			</div>

			<Fold
				title="Rules for tools"
				summary={
					ruleCount ? `${ruleCount} custom ${ruleCount === 1 ? "rule" : "rules"}` : "All follow approvals"
				}
				description="Allow, ask or turn off a kind of tool (or one tool). Rules win over the approval mode."
				defaultOpen={ruleCount > 0}
			>
				{isLoading ? (
					<Spinner />
				) : (
					<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
						{[...byCategory.entries()].map(([category, tools]) => {
							const key = `category:${category}`;
							const open = openCategory === category;
							const custom = tools.filter((t) => caps.tools[t.name]).length;
							return (
								<div key={category}>
									<div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
										<button
											type="button"
											aria-expanded={open}
											onClick={() => setOpenCategory(open ? null : category)}
											className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left"
										>
											<ChevronRight
												className={cn(
													"size-3.5 shrink-0 text-fg-subtle transition-transform",
													open && "rotate-90",
												)}
											/>
											<span className="truncate text-[13px] font-medium">
												{catalog?.categories[category] ?? category}
											</span>
											<span className="text-xs text-fg-subtle">
												{tools.length}
												{custom ? ` · ${custom} set` : ""}
											</span>
										</button>
										<RuleSelect
											value={(caps.tools[key] as RuleValue | undefined) ?? "default"}
											onChange={(v) => setRule(key, v)}
										/>
									</div>
									{open && (
										<div className="flex flex-col gap-1 px-2 pb-2">
											{tools.map((t) => (
												<div
													key={t.name}
													className="flex items-center gap-2 rounded-xl bg-surface-2/50 py-1 pr-1 pl-3"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-1.5">
															<code className="truncate font-mono text-xs">{t.name}</code>
															{t.risk !== "read" && (
																<Badge tone={RISK_TONE[t.risk]}>{t.risk}</Badge>
															)}
														</div>
														{t.rule && t.ruleSource !== "agent" && (
															<div className="text-[11px] text-fg-subtle">
																{t.ruleSource === "global" ? "Global" : "Chat"} rule:{" "}
																{t.rule}
															</div>
														)}
													</div>
													<RuleSelect
														value={
															(caps.tools[t.name] as RuleValue | undefined) ?? "default"
														}
														onChange={(v) => setRule(t.name, v)}
														inherited={caps.tools[key] ? "As kind" : "By mode"}
													/>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</Fold>
		</div>
	);
}

/** Apps (MCP) and skills (playbooks) this bot can use. */
export function AppsTab({ agent }: { agent: Agent }) {
	const { data: skills = [] } = useSkills();
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch),
	});
	const caps = agent.capabilities;
	const setRule = (key: string, v: RuleValue) => {
		const tools = { ...caps.tools };
		if (v === "default") delete tools[key];
		else tools[key] = v;
		update.mutate({ capabilities: { ...caps, tools } });
	};
	const enabled = skills.filter((s) => s.enabled);
	const shared = enabled.filter((s) => s.shared);
	const own = enabled.filter((s) => !s.shared);
	return (
		<div className="flex flex-col gap-6">
			<AppsSection agent={agent} caps={caps} setRule={setRule} />
			<Section
				title="Skills"
				description={`Playbooks ${agent.name} loads when a task calls for one.`}
				action={
					<a href={adminUrl("apps")} className="text-xs font-medium text-fg-muted hover:text-fg">
						Manage
					</a>
				}
			>
				<div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
					{[...own, ...shared].map((s) => {
						const checked = s.shared || agent.skillIds.includes(s.id);
						return (
							<label
								key={s.id}
								htmlFor={`skill-${s.id}`}
								title={s.description}
								className={cn(
									"flex items-center gap-3 px-3.5 py-2.5",
									!s.shared && "cursor-pointer hover:bg-surface-2/40",
								)}
							>
								<Sparkles className="size-4 shrink-0 text-fg-subtle" />
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13px] font-medium">{s.title}</div>
									<div className="truncate text-xs text-fg-subtle">{s.description}</div>
								</div>
								{s.shared ? (
									<Badge>All bots</Badge>
								) : (
									<Switch
										id={`skill-${s.id}`}
										checked={checked}
										onCheckedChange={(v) =>
											update.mutate({
												skillIds: v
													? [...agent.skillIds, s.id]
													: agent.skillIds.filter((id) => id !== s.id),
											})
										}
									/>
								)}
							</label>
						);
					})}
					{enabled.length === 0 && <p className="px-4 py-3 text-[13px] text-fg-subtle">No skills yet.</p>}
				</div>
			</Section>
		</div>
	);
}
