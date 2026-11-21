import {
	AppStore,
	api,
	InstalledApps,
	kvText,
	ManageApp,
	Markdown,
	parseKv,
	pluralize,
	qk,
	splitArgs,
	useAccess,
	useAgents,
	useMcpServers,
	useSkills,
} from "@sekai/client";
import type { Agent, McpServerCreate, McpServerWithStatus, McpTransportInput, Skill } from "@sekai/shared";
import { MCP_NAME_RE, SKILL_NAME_RE } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	EmptyState,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Page,
	Row,
	Section,
	Segmented,
	SkeletonRows,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileUp, Pencil, Plug, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useGoBack } from "../../lib/back.ts";
import { useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { botIdFromPath, safeReturnPath } from "./common.tsx";

const slug = (text: string, max: number) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, max);

// ---------------------------------------------------------------- skill editor (sub-page)

function SkillEditor({
	skill,
	isAdmin,
	onClose,
	onSaved,
}: {
	skill: Skill | null;
	isAdmin: boolean;
	onClose: () => void;
	onSaved: () => void;
}) {
	const qc = useQueryClient();
	const builtin = Boolean(skill?.builtin);
	const canChangeBuiltin = !builtin || isAdmin;
	const [preview, setPreview] = useState(builtin);
	const leave = useAfterSave();
	const form = useFormValues({
		name: skill?.name ?? "",
		title: skill?.title ?? "",
		description: skill?.description ?? "",
		instructions: skill?.instructions ?? "",
		shared: skill?.shared ?? false,
	});
	const nameOk = SKILL_NAME_RE.test(form.values.name);
	const valid = builtin || Boolean(nameOk && form.values.title.trim() && form.values.description.trim());

	const exportSkill = () => {
		if (!skill) return;
		const a = document.createElement("a");
		a.href = api.skills.exportUrl(skill.id);
		a.download = `${skill.name}.md`;
		a.click();
	};

	return (
		<Page
			back={{ label: "Apps & skills", onClick: onClose }}
			title={skill ? skill.title : "New skill"}
			description={
				builtin ? "Built-in playbook included with Sekai." : "A reusable playbook bots can follow by name."
			}
			actions={
				skill ? (
					<Button variant="secondary" size="sm" onClick={exportSkill}>
						<Download /> Export
					</Button>
				) : undefined
			}
		>
			{builtin && !isAdmin && (
				<Callout icon={<Sparkles />}>
					Only admins can change built-in skills. You can read or export its instructions below.
				</Callout>
			)}

			{!canChangeBuiltin ? (
				<Section title="Instructions">
					<div className="rounded-lg border border-border bg-surface p-4">
						<Markdown text={form.values.instructions || "_Empty_"} className="text-message" />
					</div>
				</Section>
			) : (
				<FormGroup
					dirty={form.dirty}
					disabled={!valid}
					submitLabel={skill ? "Save" : "Create skill"}
					onCancel={() => {
						// Cancel means drop the changes: leave without asking about them.
						form.reset();
						leave(onClose);
					}}
					onSubmit={async () => {
						if (skill) {
							await api.skills.update(skill.id, builtin ? { shared: form.values.shared } : form.values);
						} else {
							await api.skills.create(form.values);
						}
						void qc.invalidateQueries({ queryKey: qk.skills });
						form.reset(form.values);
						onSaved();
					}}
				>
					{!builtin && (
						<>
							<Field label="Title">
								<Input
									value={form.values.title}
									onChange={(e) => {
										const title = e.target.value;
										form.setValues((v) => ({
											...v,
											title,
											name: skill ? v.name : slug(title, 63),
										}));
									}}
									placeholder="e.g. Weekly account health"
								/>
							</Field>

							<Field
								label="When to use it"
								hint="Bots read this to decide when to load the skill. Start with “Use when…”."
							>
								<Textarea
									value={form.values.description}
									onChange={(e) => form.set("description", e.target.value)}
									className="min-h-16"
								/>
							</Field>
						</>
					)}

					<List label="Sharing">
						<ToggleRow
							title="Share with every bot"
							description="Turn off to enable it only on specific bots."
							checked={form.values.shared}
							onCheckedChange={(shared) => form.set("shared", shared)}
						/>
					</List>

					<Section
						title="Instructions"
						action={
							!builtin && (
								<Segmented
									label="Editor view"
									value={preview ? "preview" : "edit"}
									onValueChange={(v) => setPreview(v === "preview")}
									options={[
										{ value: "edit", label: "Edit" },
										{ value: "preview", label: "Preview" },
									]}
								/>
							)
						}
					>
						{preview ? (
							<div className="rounded-lg border border-border bg-surface p-4">
								<Markdown text={form.values.instructions || "_Empty_"} className="text-message" />
							</div>
						) : (
							<Textarea
								aria-label="Skill instructions"
								value={form.values.instructions}
								onChange={(e) => form.set("instructions", e.target.value)}
								className="min-h-[38dvh] font-mono"
								placeholder={"## When to use\n## Steps\n1. …\n## Output\n## Needs approval"}
							/>
						)}
					</Section>

					{!builtin && (
						<Fold
							title="Advanced"
							defaultOpen={Boolean(form.values.name && !nameOk)}
							summary={form.values.name ? `Name: ${form.values.name}` : "Optional"}
						>
							<Field
								label="Name"
								hint="Lowercase letters, numbers and dashes only."
								error={
									form.values.name && !nameOk
										? "Use lowercase letters, digits and dashes only."
										: null
								}
							>
								<Input
									value={form.values.name}
									onChange={(e) => form.set("name", e.target.value)}
									className="font-mono"
									placeholder="weekly-account-health"
								/>
							</Field>
						</Fold>
					)}
				</FormGroup>
			)}
		</Page>
	);
}

// ---------------------------------------------------------------- skills list tab

function SkillsTab({ onEdit }: { onEdit: (skill: Skill | "new") => void }) {
	const { data: skills = [], isLoading, isError, error, refetch } = useSkills();
	const { data: agents = [] } = useAgents();
	const { admin } = useAccess();
	const qc = useQueryClient();
	const [deleting, setDeleting] = useState<Skill | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const toggle = useMutation({
		mutationFn: (s: Skill) => api.skills.update(s.id, { enabled: !s.enabled }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.skills }),
	});
	const del = useMutation({
		mutationFn: (s: Skill) => api.skills.delete(s.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: qk.skills }),
	});
	const importSkill = useMutation({
		mutationFn: async (file: File) => api.skills.import(await file.text()),
		onSuccess: (s) => {
			void qc.invalidateQueries({ queryKey: qk.skills });
			toast.success(`Imported “${s.title}”`);
		},
	});

	return (
		<Section
			title="Skills"
			description="Playbooks bots can follow by name, or write for themselves."
			action={
				<div className="flex flex-wrap gap-2">
					<input
						ref={fileRef}
						type="file"
						accept=".md,text/markdown"
						className="hidden"
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) importSkill.mutate(f);
							e.target.value = "";
						}}
					/>
					<Button
						variant="secondary"
						size="sm"
						loading={importSkill.isPending}
						onClick={() => fileRef.current?.click()}
					>
						<FileUp /> Import
					</Button>
					<Button variant="primary" size="sm" onClick={() => onEdit("new")}>
						<Plus /> New skill
					</Button>
				</div>
			}
		>
			{isLoading ? (
				<SkeletonRows count={4} />
			) : isError ? (
				<ErrorState size="sm" title="Skills didn't load" error={error} onRetry={() => void refetch()} />
			) : skills.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<Sparkles />}
					title="No skills yet"
					description="Create a playbook for your bots to follow, or import a SKILL.md file."
					action={
						<Button variant="primary" size="sm" onClick={() => onEdit("new")}>
							<Plus /> New skill
						</Button>
					}
					className="rounded-lg border border-dashed border-border"
				/>
			) : (
				<List label="Skills">
					{skills.map((s) => {
						const users = s.shared ? agents.length : agents.filter((a) => a.skillIds.includes(s.id)).length;
						const canEdit = !s.builtin || admin;
						return (
							<Row
								key={s.id}
								icon={<Sparkles />}
								title={s.title}
								subtitle={<span className="line-clamp-1">{s.description}</span>}
								onClick={() => onEdit(s)}
								trailing={
									canEdit ? (
										<Switch
											checked={s.enabled}
											onCheckedChange={() => toggle.mutate(s)}
											label={`Enable ${s.title}`}
										/>
									) : (
										<Badge>{s.enabled ? "On" : "Off"}</Badge>
									)
								}
								menuLabel={`Actions for ${s.title}`}
								menu={[
									{
										label: canEdit ? "Edit" : "View",
										icon: canEdit ? <Pencil /> : <Eye />,
										onSelect: () => onEdit(s),
									},
									{
										label: "Export",
										icon: <Download />,
										onSelect: () => {
											const a = document.createElement("a");
											a.href = api.skills.exportUrl(s.id);
											a.download = `${s.name}.md`;
											a.click();
										},
									},
									!s.builtin && "-",
									!s.builtin && {
										label: "Delete",
										icon: <Trash2 />,
										danger: true,
										onSelect: () => setDeleting(s),
									},
								]}
							>
								<div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-fg-subtle">
									<span>{s.shared ? "All bots" : pluralize(users, "bot")}</span>
									{s.builtin && <Badge>Built-in</Badge>}
									{s.createdBy === "agent" && <Badge tone="info">By a bot</Badge>}
								</div>
							</Row>
						);
					})}
				</List>
			)}

			<Confirm
				open={Boolean(deleting)}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Delete “${deleting?.title}”?`}
				description="Bots will no longer be able to load this skill. This can't be undone."
				confirmLabel="Delete"
				danger
				onConfirm={() => deleting && del.mutate(deleting)}
			/>
		</Section>
	);
}

// ---------------------------------------------------------------- custom app editor (sub-page)

type Transport = "stdio" | "http" | "sse";

function CustomAppEditor({
	server,
	isAdmin,
	returnBot,
	backLabel,
	onClose,
	onSaved,
}: {
	server: McpServerWithStatus | null;
	isAdmin: boolean;
	returnBot: { id: string; name: string } | null;
	backLabel: string;
	onClose: () => void;
	onSaved: () => void;
}) {
	const qc = useQueryClient();
	const t = server?.transport;
	const leave = useAfterSave();
	const form = useFormValues({
		type: (t?.type ?? "http") as Transport,
		title: server?.title ?? "",
		name: server?.name ?? "",
		description: server?.description ?? "",
		command:
			t?.type === "stdio" ? [t.command, ...t.args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ") : "",
		env: t?.type === "stdio" ? kvText(t.env) : "",
		url: t && t.type !== "stdio" ? t.url : "",
		headers: t && t.type !== "stdio" ? kvText(t.headers) : "",
		requireApproval: server?.requireApproval ?? false,
		scope: (returnBot ? "agents" : (server?.scope ?? "agents")) as "all" | "agents",
	});

	const nameOk = MCP_NAME_RE.test(form.values.name);
	const targetOk =
		form.values.type === "stdio"
			? Boolean(form.values.command.trim())
			: /^https?:\/\//.test(form.values.url.trim());
	const valid = Boolean(nameOk && form.values.title.trim() && targetOk);

	const transportOptions = isAdmin
		? [
				{ value: "http" as const, label: "Web (HTTP)" },
				{ value: "stdio" as const, label: "Command" },
				{ value: "sse" as const, label: "SSE" },
			]
		: [
				{ value: "http" as const, label: "Web (HTTP)" },
				{ value: "sse" as const, label: "SSE" },
			];

	const advancedSummary = [
		form.values.name ? `Prefix: ${form.values.name}` : null,
		form.values.type === "stdio"
			? form.values.env.trim()
				? "Environment set"
				: null
			: form.values.headers.trim()
				? "Headers set"
				: null,
	]
		.filter(Boolean)
		.join(" · ");

	const submitLabel = server
		? "Save"
		: form.values.scope === "all"
			? "Add for every bot"
			: returnBot
				? `Add for ${returnBot.name}`
				: "Add app";

	return (
		<Page
			back={{ label: backLabel, onClick: onClose }}
			title={server ? `Edit ${server.title}` : "Add a custom app"}
			description={
				isAdmin
					? "Connect an MCP server by its web address, or a command on this server."
					: "Connect an MCP server by its web address."
			}
		>
			<FormGroup
				dirty={form.dirty}
				disabled={!valid}
				submitLabel={submitLabel}
				onCancel={() => {
					form.reset();
					leave(onClose);
				}}
				extra={
					!form.dirty ? (
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
					) : undefined
				}
				onSubmit={async () => {
					const transport: McpTransportInput =
						form.values.type === "stdio"
							? (() => {
									const [cmd = "", ...args] = splitArgs(form.values.command);
									return {
										type: "stdio",
										command: cmd,
										args,
										env: parseKv(form.values.env),
										cwd: null,
									};
								})()
							: {
									type: form.values.type,
									url: form.values.url.trim(),
									headers: parseKv(form.values.headers),
								};
					const body: McpServerCreate = {
						name: form.values.name,
						title: form.values.title.trim(),
						description: form.values.description,
						transport,
						requireApproval: form.values.requireApproval,
						...(!server
							? {
									scope: form.values.scope,
									agentIds: form.values.scope === "agents" && returnBot ? [returnBot.id] : [],
								}
							: {}),
					};
					if (server) {
						await api.mcp.update(server.id, body);
					} else {
						await api.mcp.create(body);
					}
					void qc.invalidateQueries({ queryKey: qk.mcp });
					void qc.invalidateQueries({ queryKey: qk.agents });
					form.reset(form.values);
					onSaved();
				}}
			>
				<Field label="Connection type">
					<Segmented<Transport>
						label="Connection type"
						value={form.values.type}
						onValueChange={(type) => form.set("type", type)}
						options={transportOptions}
					/>
				</Field>

				<Field label="Title">
					<Input
						value={form.values.title}
						onChange={(e) => {
							const title = e.target.value;
							form.setValues((v) => ({
								...v,
								title,
								name: server ? v.name : slug(title, 40),
							}));
						}}
						placeholder="e.g. GitHub"
					/>
				</Field>

				{form.values.type === "stdio" ? (
					<Field label="Command" hint="Runs on the Sekai server.">
						<Input
							value={form.values.command}
							onChange={(e) => form.set("command", e.target.value)}
							className="font-mono"
							placeholder="npx -y @modelcontextprotocol/server-github"
						/>
					</Field>
				) : (
					<Field label="Server address (URL)" hint="Must start with http:// or https://.">
						<Input
							value={form.values.url}
							onChange={(e) => form.set("url", e.target.value)}
							className="font-mono"
							placeholder="https://mcp.example.com/mcp"
						/>
					</Field>
				)}

				{!server && (
					<Field label="Who can use it">
						<Segmented<"agents" | "all">
							label="Who can use it"
							value={form.values.scope}
							onValueChange={(scope) => form.set("scope", scope)}
							options={[
								{ value: "agents", label: returnBot ? `Just ${returnBot.name}` : "Only bots I choose" },
								{ value: "all", label: "Every bot" },
							]}
						/>
					</Field>
				)}

				<List label="Approvals">
					<ToggleRow
						title="Always ask before using its tools"
						description="Every call from this app waits for your approval, in every mode."
						checked={form.values.requireApproval}
						onCheckedChange={(requireApproval) => form.set("requireApproval", requireApproval)}
					/>
				</List>

				<Fold
					title="Advanced"
					defaultOpen={Boolean(form.values.name && !nameOk)}
					summary={advancedSummary || "Optional"}
				>
					<Field
						label="Tool prefix"
						hint="Used to name its tools: mcp__name__tool."
						error={
							form.values.name && !nameOk
								? "Use lowercase letters, digits, dashes and underscores only."
								: null
						}
					>
						<Input
							value={form.values.name}
							onChange={(e) => form.set("name", e.target.value)}
							className="font-mono"
							placeholder="github"
						/>
					</Field>

					{form.values.type === "stdio" ? (
						<Field label="Environment" optional hint="One KEY=value per line. Stored on the server.">
							<Textarea
								value={form.values.env}
								onChange={(e) => form.set("env", e.target.value)}
								className="min-h-16 font-mono"
								placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…"
							/>
						</Field>
					) : (
						<Field label="Headers" optional hint="One Header: value per line, e.g. Authorization: Bearer …">
							<Textarea
								value={form.values.headers}
								onChange={(e) => form.set("headers", e.target.value)}
								className="min-h-16 font-mono"
							/>
						</Field>
					)}

					<Field label="Description" optional>
						<Input
							value={form.values.description}
							onChange={(e) => form.set("description", e.target.value)}
							placeholder="e.g. Repos, issues and pull requests"
						/>
					</Field>
				</Fold>
			</FormGroup>
		</Page>
	);
}

// ---------------------------------------------------------------- apps list tab

function McpTab({
	onAddCustom,
	onEditCustom,
	returnBot,
	onReturn,
}: {
	onAddCustom: () => void;
	onEditCustom: (s: McpServerWithStatus) => void;
	returnBot: Agent | null;
	onReturn?: () => void;
}) {
	const [params, setParams] = useSearchParams();
	const [managing, setManaging] = useState<McpServerWithStatus | null>(null);
	const { data: servers = [], isLoading, isError, error, refetch } = useMcpServers();

	// Back from an app's sign-in page.
	useEffect(() => {
		const ok = params.get("signed_in");
		const signInErr = params.get("signin_error");
		if (!ok && !signInErr) return;
		if (ok) {
			const s = servers.find((x) => x.id === ok);
			toast.success(`Signed in${s ? ` to ${s.title}` : ""}`);
		} else toast.error(`Sign-in didn't work: ${signInErr}`);
		const next = new URLSearchParams(params);
		next.delete("signed_in");
		next.delete("signin_error");
		setParams(next, { replace: true });
	}, [params, setParams, servers]);

	return (
		<div className="flex flex-col gap-8">
			{returnBot && onReturn && (
				<Callout
					icon={<Plug />}
					action={
						<Button variant="secondary" size="sm" onClick={onReturn}>
							Back to {returnBot.name}
						</Button>
					}
				>
					Adding an app for {returnBot.name}.
				</Callout>
			)}

			<Section
				title="Connected apps"
				description="Open an app to sign in, pick which bots use it, or remove it."
				action={
					<Button variant="secondary" size="sm" onClick={onAddCustom}>
						<Plus /> Custom app
					</Button>
				}
			>
				{isLoading ? (
					<SkeletonRows count={2} />
				) : isError ? (
					<ErrorState
						size="sm"
						title="Connected apps didn't load"
						error={error}
						onRetry={() => void refetch()}
					/>
				) : (
					<InstalledApps
						onManage={setManaging}
						empty={
							<EmptyState
								size="sm"
								icon={<Plug />}
								title="No apps connected yet"
								description="Pick one from the store below, or add a custom app."
								className="rounded-lg border border-dashed border-border"
							/>
						}
					/>
				)}
			</Section>

			<Section title="App store" description="Connect popular apps in a few clicks.">
				<AppStore
					agent={returnBot ?? undefined}
					onCustom={onAddCustom}
					onAdded={() => {
						if (onReturn) onReturn();
					}}
				/>
			</Section>

			<ManageApp
				server={managing}
				onOpenChange={(o) => !o && setManaging(null)}
				onEdit={(s) => {
					setManaging(null);
					onEditCustom(s);
				}}
			/>
		</div>
	);
}

// ---------------------------------------------------------------- pages

const LIST = sectionPath("apps");
const SKILLS = `${LIST}?tab=skills`;

/** A custom app's settings: a new one (from here, or from a bot's Tools & access with `?return=`), or yours. */
function CustomAppPage({ id }: { id: string | null }) {
	const [params] = useSearchParams();
	const goBack = useGoBack();
	const afterSave = useAfterSave();
	const { admin } = useAccess();
	const { data: agents = [] } = useAgents();
	const servers = useMcpServers();
	const returnPath = id ? null : safeReturnPath(params.get("return"));
	const returnBotId = id ? null : params.get("bot") || botIdFromPath(returnPath);
	// Only your own bots: an app can't be turned on for a bot that's shared with you.
	const returnBot = agents.find((a) => a.id === returnBotId && !a.sharedBy) ?? null;
	const close = () => goBack(returnPath ?? LIST);
	const back = { label: "Apps & skills", onClick: close };

	if (id) {
		const server = servers.data?.find((x) => x.id === id);
		if (!server) {
			return (
				<Page back={back} title="App">
					{servers.isLoading ? (
						<SkeletonRows count={3} leading={false} />
					) : servers.isError ? (
						<ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
					) : (
						<EmptyState icon={<Plug />} title="This app isn't here." />
					)}
				</Page>
			);
		}
		return (
			<CustomAppEditor
				key={server.id}
				server={server}
				isAdmin={admin}
				returnBot={null}
				backLabel="Apps & skills"
				onClose={close}
				onSaved={() => afterSave(close)}
			/>
		);
	}
	return (
		<CustomAppEditor
			key={returnBot?.id ?? "new"}
			server={null}
			isAdmin={admin}
			returnBot={returnBot ? { id: returnBot.id, name: returnBot.name } : null}
			backLabel={returnPath && returnBot ? returnBot.name : "Apps & skills"}
			onClose={close}
			onSaved={() => afterSave(close)}
		/>
	);
}

function SkillPage({ id }: { id: string }) {
	const goBack = useGoBack();
	const afterSave = useAfterSave();
	const { admin } = useAccess();
	const skills = useSkills();
	const close = () => goBack(SKILLS);
	const skill = id === "new" ? null : skills.data?.find((x) => x.id === id);
	if (skill === undefined) {
		return (
			<Page back={{ label: "Apps & skills", onClick: close }} title="Skill">
				{skills.isLoading ? (
					<SkeletonRows count={3} leading={false} />
				) : skills.isError ? (
					<ErrorState error={skills.error} onRetry={() => void skills.refetch()} />
				) : (
					<EmptyState icon={<Sparkles />} title="This skill isn't here." />
				)}
			</Page>
		);
	}
	return (
		<SkillEditor
			key={skill?.id ?? "new"}
			skill={skill}
			isAdmin={admin}
			onClose={close}
			onSaved={() => afterSave(close)}
		/>
	);
}

function AppsHome({ back, skills }: SettingsSectionProps & { skills: boolean }) {
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const { data: agents = [] } = useAgents();
	const returnPath = safeReturnPath(params.get("return"));
	const returnBotId = params.get("bot") || botIdFromPath(returnPath);
	const returnBot = agents.find((a) => a.id === returnBotId && !a.sharedBy) ?? null;
	const tab = skills || params.get("tab") === "skills" ? "skills" : "mcp";

	return (
		<Page
			back={back}
			width="wide"
			title="Apps & skills"
			description="Connect apps and give bots reusable know-how."
		>
			<Tabs
				value={tab}
				onValueChange={(t) => {
					if (skills) {
						navigate(t === "skills" ? SKILLS : LIST, { replace: true });
						return;
					}
					const next = new URLSearchParams(params);
					if (t === "mcp") next.delete("tab");
					else next.set("tab", t);
					setParams(next, { replace: true });
				}}
			>
				<TabsList className="mb-6">
					<TabsTrigger value="mcp">Apps</TabsTrigger>
					<TabsTrigger value="skills">Skills</TabsTrigger>
				</TabsList>
				<TabsContent value="mcp">
					<McpTab
						onAddCustom={() =>
							navigate(
								`${sectionPath("apps", "custom")}${returnPath ? `?return=${encodeURIComponent(returnPath)}` : ""}`,
							)
						}
						onEditCustom={(s) => navigate(sectionPath("apps", s.id))}
						returnBot={returnPath ? returnBot : null}
						onReturn={returnPath ? () => navigate(returnPath) : undefined}
					/>
				</TabsContent>
				<TabsContent value="skills">
					<SkillsTab onEdit={(s) => navigate(sectionPath("apps", `skills/${s === "new" ? "new" : s.id}`))} />
				</TabsContent>
			</Tabs>
		</Page>
	);
}

/**
 * Connected apps and reusable skills for your bots: the two tabs, a custom app's settings (`/settings/apps/custom`
 * for a new one, `/settings/apps/<id>`), and a skill (`/settings/apps/skills/<id>` or `…/skills/new`).
 */
export function AppsSection(props: SettingsSectionProps) {
	const [params] = useSearchParams();
	const [first, second] = props.rest.split("/");
	if (first === "custom" || (!first && params.get("add") === "custom")) return <CustomAppPage id={null} />;
	if (first === "skills" && second) return <SkillPage key={second} id={second} />;
	if (first && first !== "skills") return <CustomAppPage key={first} id={first} />;
	return <AppsHome {...props} skills={first === "skills"} />;
}
