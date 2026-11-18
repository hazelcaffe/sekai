import {
	AppStore,
	api,
	cn,
	InstalledApps,
	kvText,
	ManageApp,
	Markdown,
	parseKv,
	splitArgs,
	timeAgo,
	useAgents,
	useMcpServers,
	useSkills,
} from "@sekai/client";
import {
	type McpServerCreate,
	type McpServerWithStatus,
	type McpTransportInput,
	SKILL_NAME_RE,
	type Skill,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Card,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	Input,
	Segmented,
	SettingsPanel,
	Spinner,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	ToggleRow,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { Download, FileUp, Plug, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------- skills

function SkillDialog({
	skill,
	open,
	onOpenChange,
}: {
	skill: Skill | null;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const [form, setForm] = useState({ name: "", title: "", description: "", instructions: "", shared: false });
	const [preview, setPreview] = useState(false);
	useEffect(() => {
		if (open)
			setForm(
				skill
					? {
							name: skill.name,
							title: skill.title,
							description: skill.description,
							instructions: skill.instructions,
							shared: skill.shared,
						}
					: { name: "", title: "", description: "", instructions: "", shared: false },
			);
		setPreview(Boolean(skill?.builtin));
	}, [open, skill]);
	const readOnly = Boolean(skill?.builtin);
	const save = useMutation({
		mutationFn: () =>
			skill ? api.skills.update(skill.id, readOnly ? { shared: form.shared } : form) : api.skills.create(form),
		onSuccess: () => onOpenChange(false),
	});
	const nameOk = SKILL_NAME_RE.test(form.name);
	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={skill ? skill.title : "New skill"}
			description={
				readOnly
					? "Built-in skill. You can share it or turn it off."
					: "A reusable playbook any assigned bot can load by name."
			}
			size="lg"
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!readOnly && (!nameOk || !form.title.trim() || !form.description.trim())}
						onClick={() => save.mutate()}
					>
						Save
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{!readOnly && (
					<div className="grid gap-3 xs:grid-cols-2">
						<Field label="Title">
							<Input
								value={form.title}
								onChange={(e) =>
									setForm({
										...form,
										title: e.target.value,
										name: skill
											? form.name
											: e.target.value
													.toLowerCase()
													.replace(/[^a-z0-9]+/g, "-")
													.replace(/^-|-$/g, "")
													.slice(0, 63),
									})
								}
								placeholder="Weekly account health"
							/>
						</Field>
						<Field label="Name" error={form.name && !nameOk ? "lowercase-dashes only" : null}>
							<Input
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								className="font-mono"
								placeholder="weekly-account-health"
							/>
						</Field>
					</div>
				)}
				{!readOnly && (
					<Field
						label="When to use it"
						hint="Bots read this to decide whether to load the skill. Start with “Use when…”."
					>
						<Textarea
							value={form.description}
							onChange={(e) => setForm({ ...form, description: e.target.value })}
							className="min-h-16"
						/>
					</Field>
				)}
				<ToggleRow
					title="Share with every bot"
					description="Otherwise only bots you enable it for can use it."
					checked={form.shared}
					onCheckedChange={(shared) => setForm({ ...form, shared })}
				/>
				<div className="flex items-center justify-between">
					<span className="text-[13px] font-medium">Instructions</span>
					{!readOnly && (
						<Segmented
							value={preview ? "preview" : "edit"}
							onValueChange={(v) => setPreview(v === "preview")}
							options={[
								{ value: "edit", label: "Edit" },
								{ value: "preview", label: "Preview" },
							]}
						/>
					)}
				</div>
				{preview ? (
					<div className="rounded-2xl border border-border p-4">
						<Markdown text={form.instructions || "_Empty_"} className="text-sm" />
					</div>
				) : (
					<Textarea
						value={form.instructions}
						onChange={(e) => setForm({ ...form, instructions: e.target.value })}
						className="min-h-[36dvh] font-mono text-[13px]"
						placeholder={
							"## When to use\n## Inputs\n## Steps\n1. …\n## Validation\n## Output\n## Needs approval"
						}
					/>
				)}
			</div>
		</Dialog>
	);
}

function SkillsTab() {
	const { data: skills = [], isLoading } = useSkills();
	const { data: agents = [] } = useAgents();
	const [editing, setEditing] = useState<Skill | null | "new">(null);
	const [deleting, setDeleting] = useState<Skill | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const toggle = useMutation({ mutationFn: (s: Skill) => api.skills.update(s.id, { enabled: !s.enabled }) });
	const del = useMutation({ mutationFn: (s: Skill) => api.skills.delete(s.id) });
	const importSkill = useMutation({
		mutationFn: async (file: File) => api.skills.import(await file.text()),
		onSuccess: (s) => toast.success(`Imported “${s.title}”`),
	});

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-fg-muted">
					Skills are reusable playbooks. Bots load them by name; they can also write their own.
				</p>
				<div className="flex gap-2">
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
					<Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
						<FileUp /> Import SKILL.md
					</Button>
					<Button variant="primary" size="sm" onClick={() => setEditing("new")}>
						<Plus /> New skill
					</Button>
				</div>
			</div>
			{isLoading ? (
				<Spinner />
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{skills.map((s) => {
						const users = s.shared ? agents.length : agents.filter((a) => a.skillIds.includes(s.id)).length;
						return (
							<Card key={s.id} className={cn("flex flex-col gap-2 p-4", !s.enabled && "opacity-60")}>
								<div className="flex items-start gap-3">
									<Sparkles className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
									<button
										type="button"
										onClick={() => setEditing(s)}
										className="min-w-0 flex-1 text-left"
									>
										<div className="flex flex-wrap items-center gap-1.5">
											<span className="text-sm font-medium">{s.title}</span>
											{s.builtin && <Badge>built-in</Badge>}
											{s.createdBy === "agent" && <Badge tone="info">by a bot</Badge>}
										</div>
										<code className="text-[11px] text-fg-subtle">{s.name}</code>
									</button>
									<Switch
										checked={s.enabled}
										onCheckedChange={() => toggle.mutate(s)}
										label="Enabled"
									/>
								</div>
								<p className="line-clamp-3 text-xs leading-5 text-fg-muted">{s.description}</p>
								<div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-fg-subtle">
									{s.shared ? "All bots" : `${users} ${users === 1 ? "bot" : "bots"}`} · updated{" "}
									{timeAgo(s.updatedAt)}
									<span className="ml-auto flex gap-1">
										<a
											href={api.skills.exportUrl(s.id)}
											className="rounded-md p-1 hover:bg-surface-2 hover:text-fg"
											aria-label="Export"
										>
											<Download className="size-3.5" />
										</a>
										{!s.builtin && (
											<button
												type="button"
												onClick={() => setDeleting(s)}
												className="rounded-md p-1 hover:bg-surface-2 hover:text-danger"
												aria-label="Delete"
											>
												<Trash2 className="size-3.5" />
											</button>
										)}
									</span>
								</div>
							</Card>
						);
					})}
				</div>
			)}
			<SkillDialog
				skill={editing === "new" ? null : editing}
				open={editing !== null}
				onOpenChange={(o) => !o && setEditing(null)}
			/>
			<Confirm
				open={Boolean(deleting)}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Delete “${deleting?.title}”?`}
				confirmLabel="Delete"
				danger
				onConfirm={() => deleting && del.mutate(deleting)}
			/>
		</div>
	);
}

// ---------------------------------------------------------------- MCP

type Transport = "stdio" | "http" | "sse";

function McpDialog({
	server,
	open,
	onOpenChange,
}: {
	server: McpServerWithStatus | null;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const [type, setType] = useState<Transport>("stdio");
	const [title, setTitle] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [command, setCommand] = useState("");
	const [env, setEnv] = useState("");
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState("");
	const [requireApproval, setRequireApproval] = useState(false);

	useEffect(() => {
		if (!open) return;
		const t = server?.transport;
		setType(t?.type ?? "stdio");
		setTitle(server?.title ?? "");
		setName(server?.name ?? "");
		setDescription(server?.description ?? "");
		setCommand(
			t?.type === "stdio" ? [t.command, ...t.args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ") : "",
		);
		setEnv(t?.type === "stdio" ? kvText(t.env) : "");
		setUrl(t && t.type !== "stdio" ? t.url : "");
		setHeaders(t && t.type !== "stdio" ? kvText(t.headers) : "");
		setRequireApproval(server?.requireApproval ?? false);
	}, [open, server]);

	const transport = (): McpTransportInput => {
		if (type === "stdio") {
			const [cmd = "", ...args] = splitArgs(command);
			return { type, command: cmd, args, env: parseKv(env), cwd: null };
		}
		return { type, url: url.trim(), headers: parseKv(headers) };
	};

	const save = useMutation({
		mutationFn: () => {
			const body: McpServerCreate = {
				name,
				title: title.trim(),
				description,
				transport: transport(),
				requireApproval,
			};
			return server ? api.mcp.update(server.id, body) : api.mcp.create(body);
		},
		onSuccess: () => onOpenChange(false),
	});
	const valid =
		/^[a-z0-9][a-z0-9_-]{0,40}$/.test(name) &&
		title.trim() &&
		(type === "stdio" ? command.trim() : /^https?:\/\//.test(url));

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title={server ? `Edit ${server.title}` : "Add an MCP server"}
			description="Connect any Model Context Protocol server, then give its tools to bots from their Tools tab."
			footer={
				<>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
						{server ? "Save" : "Add server"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<Segmented
					value={type}
					onValueChange={setType}
					options={[
						{ value: "stdio", label: "Local command" },
						{ value: "http", label: "HTTP" },
						{ value: "sse", label: "SSE (legacy)" },
					]}
				/>
				<div className="grid gap-3 xs:grid-cols-2">
					<Field label="Title">
						<Input
							value={title}
							onChange={(e) => {
								setTitle(e.target.value);
								if (!server)
									setName(
										e.target.value
											.toLowerCase()
											.replace(/[^a-z0-9]+/g, "-")
											.replace(/^-|-$/g, "")
											.slice(0, 40),
									);
							}}
							placeholder="GitHub"
						/>
					</Field>
					<Field label="Name" hint="Prefix for its tools: mcp__name__tool">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="font-mono"
							placeholder="github"
						/>
					</Field>
				</div>
				{type === "stdio" ? (
					<>
						<Field label="Command" hint="Runs on the Sekai server.">
							<Input
								value={command}
								onChange={(e) => setCommand(e.target.value)}
								className="font-mono"
								placeholder="npx -y @modelcontextprotocol/server-github"
							/>
						</Field>
						<Field label="Environment" hint="One KEY=value per line. Stored on the server.">
							<Textarea
								value={env}
								onChange={(e) => setEnv(e.target.value)}
								className="min-h-16 font-mono text-[13px]"
								placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…"
							/>
						</Field>
					</>
				) : (
					<>
						<Field label="URL">
							<Input
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								className="font-mono"
								placeholder="https://mcp.example.com/mcp"
							/>
						</Field>
						<Field label="Headers" hint="One Header: value per line, e.g. Authorization: Bearer …">
							<Textarea
								value={headers}
								onChange={(e) => setHeaders(e.target.value)}
								className="min-h-16 font-mono text-[13px]"
							/>
						</Field>
					</>
				)}
				<Field label="Description (optional)">
					<Input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Repos, issues and pull requests"
					/>
				</Field>
				<ToggleRow
					title="Always ask before using its tools"
					description="Every call from this server waits for your approval, in every mode."
					checked={requireApproval}
					onCheckedChange={setRequireApproval}
				/>
			</div>
		</Dialog>
	);
}

function McpTab() {
	const [params, setParams] = useSearchParams();
	const [editing, setEditing] = useState<McpServerWithStatus | null | "new">(null);
	const [managing, setManaging] = useState<McpServerWithStatus | null>(null);
	const { data: servers = [] } = useMcpServers();

	// Back from an app's sign-in page.
	useEffect(() => {
		const ok = params.get("signed_in");
		const error = params.get("signin_error");
		if (!ok && !error) return;
		if (ok) {
			const s = servers.find((x) => x.id === ok);
			toast.success(`Signed in${s ? ` to ${s.title}` : ""}`);
		} else toast.error(`Sign-in didn't work: ${error}`);
		const next = new URLSearchParams(params);
		next.delete("signed_in");
		next.delete("signin_error");
		setParams(next, { replace: true });
	}, [params, setParams, servers]);

	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-3">
				<div>
					<h3 className="text-sm font-semibold">Your apps</h3>
					<p className="text-[13px] text-fg-subtle">
						Tools your bots can use. Click one to sign in, pick who can use it, or remove it.
					</p>
				</div>
				<InstalledApps
					onManage={setManaging}
					empty={
						<EmptyState
							icon={<Plug />}
							tone="neutral"
							title="No apps yet"
							description="Add one from the store below: Notion, GitHub, Google, Cloudflare and more."
							className="rounded-2xl border border-dashed border-border py-8"
						/>
					}
				/>
			</section>
			<section className="flex flex-col gap-3">
				<div>
					<h3 className="text-sm font-semibold">App store</h3>
					<p className="text-[13px] text-fg-subtle">
						Connect an app in a few clicks. Its tools go to every bot, or the ones you pick.
					</p>
				</div>
				<AppStore onCustom={() => setEditing("new")} onAdded={() => toast.success("Added")} />
			</section>
			<ManageApp
				server={managing}
				onOpenChange={(o) => !o && setManaging(null)}
				onEdit={(s) => {
					setManaging(null);
					setEditing(s);
				}}
			/>
			<McpDialog
				server={editing === "new" ? null : editing}
				open={editing !== null}
				onOpenChange={(o) => !o && setEditing(null)}
			/>
		</div>
	);
}

/** Skills (instructions bots load when relevant) and MCP servers (tools from other apps). */
export function AppsPanel() {
	return (
		<SettingsPanel
			value="apps"
			title="Apps & skills"
			description="Connect apps (MCP) and give bots know-how (skills)."
			className="max-w-4xl"
		>
			<AppsTabs />
		</SettingsPanel>
	);
}

function AppsTabs() {
	const [params, setParams] = useSearchParams();
	const tab = params.get("tab") === "skills" ? "skills" : "mcp";
	return (
		<Tabs value={tab} onValueChange={(t) => setParams(t === "mcp" ? {} : { tab: t }, { replace: true })}>
			<TabsList variant="pill" className="mb-6">
				<TabsTrigger value="mcp">
					<Plug /> Apps
				</TabsTrigger>
				<TabsTrigger value="skills">
					<Sparkles /> Skills
				</TabsTrigger>
			</TabsList>
			<TabsContent value="skills">
				<SkillsTab />
			</TabsContent>
			<TabsContent value="mcp">
				<McpTab />
			</TabsContent>
		</Tabs>
	);
}
