import {
	AppIcon,
	AppStore,
	appOf,
	appState,
	ManageApp,
	settingsUrl,
	useAccess,
	useAgentTools,
	useAuth,
	useMcpServers,
} from "@sekai/client";
import type { Agent, AgentUpdate, McpServerWithStatus } from "@sekai/shared";
import {
	type Autosave,
	Badge,
	Button,
	Checkbox,
	Dialog,
	EmptyState,
	ErrorState,
	List,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	Switch,
	ToggleRow,
	useAutosave,
} from "@sekai/ui";
import { Blocks, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { botPath } from "../../bots/registry.tsx";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";
import { RiskBadge } from "./RiskBadge.tsx";
import { RuleSelect, type RuleValue } from "./ToolRule.tsx";

/** How the app is doing, in plain words (and that it always asks, when it does). */
const appStatus = (s: McpServerWithStatus, tools: number) => {
	const st = appState(s);
	const text = !s.enabled
		? "Turned off in Apps & skills"
		: st.tone === "success"
			? `${tools || s.status.tools.length} tools`
			: s.status.state === "needs_auth"
				? "Needs sign-in"
				: s.status.state === "error"
					? "Can't connect"
					: st.label;
	return (
		<>
			<span className={st.tone === "warning" || st.tone === "danger" ? "text-warning-ink" : undefined}>
				{text}
			</span>
			{s.requireApproval && " · always asks"}
		</>
	);
};

/** One app for this bot: how it's used (a rule) and which of its tools it may use. */
function AppAccessDialog({
	agent,
	server,
	save,
	onClose,
	onManage,
}: {
	agent: Agent;
	server: McpServerWithStatus | null;
	save: Autosave<AgentUpdate>;
	onClose: () => void;
	onManage: (s: McpServerWithStatus) => void;
}) {
	const { data: catalog } = useAgentTools(agent.id);
	const me = useAuth().data?.user?.id;
	const caps = agent.capabilities;
	if (!server) return null;
	// An admin's app that every bot may use is theirs to change: others only choose how their bot uses it.
	const mine = server.userId === me;
	const binding = agent.mcp.find((b) => b.serverId === server.id);
	const everyBot = server.scope === "all";
	const on = everyBot || Boolean(binding);
	const key = `category:mcp:${server.name}`;
	const rule = (caps.tools[key] as RuleValue | undefined) ?? "default";
	const tools = (catalog?.mcp ?? []).filter((t) => t.serverId === server.id);
	const setRule = (v: RuleValue) => {
		const next = { ...caps.tools };
		if (v === "default") delete next[key];
		else next[key] = v;
		save.save({ capabilities: { ...caps, tools: next } });
	};
	const setTool = (original: string, enabled: boolean) => {
		const all = tools.map((x) => x.originalName);
		const current = binding?.tools ?? all;
		const next = enabled ? [...new Set([...current, original])] : current.filter((n) => n !== original);
		const b = { serverId: server.id, tools: next.length === all.length ? null : next };
		save.save({ mcp: binding ? agent.mcp.map((x) => (x.serverId === server.id ? b : x)) : [...agent.mcp, b] });
	};

	return (
		<Dialog
			open
			onOpenChange={(o) => !o && onClose()}
			title={server.title}
			description={`What ${agent.name} may do with it.`}
			footer={
				<>
					<span className="mr-auto self-center">{save.status !== "idle" && <SaveState state={save} />}</span>
					{mine && (
						<Button variant="secondary" onClick={() => onManage(server)}>
							Manage {server.title}
						</Button>
					)}
					<Button variant="primary" onClick={onClose}>
						Done
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-5">
				<List label={`${agent.name} and ${server.title}`}>
					{everyBot ? (
						<Row title="Every bot has it" subtitle="Set a rule below to change that for just this bot." />
					) : (
						<ToggleRow
							title={`Give ${agent.name} ${server.title}`}
							checked={on}
							onCheckedChange={(next) =>
								save.save({
									mcp: next
										? [...agent.mcp, { serverId: server.id, tools: null }]
										: agent.mcp.filter((b) => b.serverId !== server.id),
								})
							}
						/>
					)}
					{on && (
						<Row
							title="When it uses this app"
							trailing={<RuleSelect label="Rule for this app" value={rule} onChange={setRule} />}
						/>
					)}
				</List>
				{on && tools.length > 0 && (
					<div className="flex flex-col gap-2">
						<div className="px-1 text-caption font-medium text-fg-subtle">Tools it may use</div>
						<List label="Tools">
							{tools.map((t) => (
								<Row
									key={t.name}
									title={<span className="font-normal">{t.originalName}</span>}
									badge={<RiskBadge risk={t.risk} />}
									trailing={
										<Checkbox
											checked={t.enabled}
											disabled={everyBot && !binding}
											onCheckedChange={(v) => setTool(t.originalName, v)}
										/>
									}
								/>
							))}
						</List>
					</div>
				)}
			</div>
		</Dialog>
	);
}

/** Apps it may use: on or off for this bot, a rule and tool choices per app, and adding more from here. */
export function AppsAccess({ agent }: { agent: Agent }) {
	const servers = useMcpServers();
	const { can } = useAccess();
	const mayAdd = can("apps");
	const { data: catalog } = useAgentTools(agent.id);
	const update = useAgentUpdate(agent);
	const save = useAutosave((patch: AgentUpdate) => update(patch));
	const navigate = useNavigate();
	const [store, setStore] = useState(false);
	const [open, setOpen] = useState<string | null>(null);
	const [managing, setManaging] = useState<McpServerWithStatus | null>(null);
	const list = servers.data ?? [];
	const everyBot = list.filter((s) => s.scope === "all");
	const others = list.filter((s) => s.scope !== "all");
	const current = list.find((s) => s.id === open) ?? null;

	const row = (s: McpServerWithStatus) => {
		const on = s.scope === "all" || agent.mcp.some((b) => b.serverId === s.id);
		const { domain } = appOf(s);
		const tools = (catalog?.mcp ?? []).filter((t) => t.serverId === s.id).length;
		return (
			<Row
				key={s.id}
				leading={<AppIcon domain={domain} name={s.title} size={32} />}
				title={s.title}
				subtitle={appStatus(s, tools)}
				onClick={() => setOpen(s.id)}
				chevron
				trailing={
					s.scope === "all" ? (
						<Badge>All bots</Badge>
					) : (
						<Switch
							checked={on}
							label={`Give ${agent.name} ${s.title}`}
							onCheckedChange={(next) =>
								save.save({
									mcp: next
										? [...agent.mcp, { serverId: s.id, tools: null }]
										: agent.mcp.filter((b) => b.serverId !== s.id),
								})
							}
						/>
					)
				}
			/>
		);
	};

	return (
		<Section
			title="Apps"
			description="Tools from the apps you've connected."
			saveState={save.status !== "idle" && !open ? <SaveState state={save} /> : undefined}
			action={
				list.length > 0 &&
				mayAdd && (
					<Button variant="secondary" size="sm" onClick={() => setStore(true)}>
						<Plus /> Add an app
					</Button>
				)
			}
		>
			{servers.isLoading ? (
				<SkeletonRows count={2} />
			) : servers.isError ? (
				<ErrorState size="sm" error={servers.error} onRetry={() => void servers.refetch()} />
			) : list.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<Blocks />}
					title="No apps yet"
					description={
						mayAdd
							? "Connect Notion, GitHub, Gmail, Linear and more."
							: "Connecting apps isn't part of your role. Ask an admin if you'd like some."
					}
					action={
						mayAdd ? (
							<Button variant="secondary" onClick={() => setStore(true)}>
								<Plus /> Add an app
							</Button>
						) : undefined
					}
				/>
			) : (
				<div className="flex flex-col gap-4">
					{everyBot.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<div className="px-1 text-caption font-medium text-fg-subtle">Every bot has these</div>
							<List label="Apps every bot has">{everyBot.map(row)}</List>
						</div>
					)}
					{others.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<div className="px-1 text-caption font-medium text-fg-subtle">Turn on for {agent.name}</div>
							<List label={`Apps for ${agent.name}`}>{others.map(row)}</List>
						</div>
					)}
				</div>
			)}
			<AppAccessDialog
				agent={agent}
				server={current}
				save={save}
				onClose={() => setOpen(null)}
				onManage={(s) => {
					setOpen(null);
					setManaging(s);
				}}
			/>
			<Dialog
				open={store}
				onOpenChange={setStore}
				size="xl"
				title="Add an app"
				description={`It goes to ${agent.name}, unless you pick “Every bot” when you add it.`}
			>
				<AppStore
					agent={agent}
					onAdded={() => setStore(false)}
					onCustom={() => {
						setStore(false);
						// Settings → Apps & skills opens its form for a custom app and comes back here when it's saved.
						navigate(
							`${settingsUrl("apps")}?add=custom&return=${encodeURIComponent(botPath(agent.id, "tools"))}`,
						);
					}}
				/>
			</Dialog>
			<ManageApp server={managing} onOpenChange={(o) => !o && setManaging(null)} />
		</Section>
	);
}
