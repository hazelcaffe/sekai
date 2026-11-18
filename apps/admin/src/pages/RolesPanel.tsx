import { api, formatTokens, pluralize, providerLabel, useModels } from "@sekai/client";
import {
	PERMISSION_INFO,
	PERMISSIONS,
	type Permission,
	type Role,
	type RoleInput,
	type RoleLimits,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Checkbox,
	Confirm,
	Dialog,
	Field,
	IconTile,
	Input,
	Section,
	SettingsPanel,
	Skeleton,
	Spinner,
	Textarea,
	ToggleRow,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	Crown,
	Plus,
	Search,
	ShieldCheck,
	Trash2,
	TriangleAlert,
	UserCog,
	UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminError, useLastNonNull } from "./PeoplePanel.tsx";

const ROLES = ["admin", "roles"] as const;
const USERS = ["admin", "users"] as const;

/** Every feature a role can turn on ("admin" is the Admin role's alone: the server never grants it to others). */
const FEATURES = PERMISSIONS.filter((p): p is Exclude<Permission, "admin"> => p !== "admin");

type NumberLimit = Exclude<keyof RoleLimits, "models">;
const NUMBER_LIMITS: { key: NumberLimit; label: string; unit: string; decimals?: boolean; hint?: string }[] = [
	{ key: "maxBots", label: "Bots", unit: "bots", hint: "How many bots they can have." },
	{
		key: "costPerMonth",
		label: "Spending a month",
		unit: "USD",
		decimals: true,
		hint: "At the prices set in Usage.",
	},
	{ key: "tokensPerDay", label: "Tokens a day", unit: "tokens" },
	{ key: "tokensPerMonth", label: "Tokens a month", unit: "tokens" },
	{ key: "storageMb", label: "Storage", unit: "MB", hint: "Uploads and library documents together." },
];

const EMPTY_LIMITS: RoleLimits = {
	models: null,
	maxBots: null,
	tokensPerDay: null,
	tokensPerMonth: null,
	costPerMonth: null,
	storageMb: null,
};

function roleIcon(r: Role): { icon: ReactNode; tone: "info" | "brand" | "neutral" } {
	if (r.builtin === "admin") return { icon: <Crown />, tone: "info" };
	if (r.builtin === "member") return { icon: <UserRound />, tone: "brand" };
	return { icon: <UserCog />, tone: "neutral" };
}

/** "6 of 13 features · up to 3 bots · $20 a month" */
function summary(r: Role): string {
	if (r.builtin === "admin") return "Everything, no limits";
	const l = r.limits;
	const parts = [`${r.permissions.filter((p) => p !== "admin").length} of ${FEATURES.length} features`];
	if (l.models) parts.push(l.models.length === 1 ? "1 model" : `${l.models.length} models`);
	if (l.maxBots !== null) parts.push(`up to ${pluralize(l.maxBots, "bot")}`);
	if (l.costPerMonth !== null) parts.push(`$${l.costPerMonth} a month`);
	if (l.tokensPerDay !== null) parts.push(`${formatTokens(l.tokensPerDay)} tokens a day`);
	if (l.tokensPerMonth !== null) parts.push(`${formatTokens(l.tokensPerMonth)} tokens a month`);
	if (l.storageMb !== null) parts.push(`${l.storageMb.toLocaleString()} MB`);
	if (parts.length === 1) parts.push("no limits");
	return parts.join(" · ");
}

function RoleCard({ r, onOpen }: { r: Role; onOpen: () => void }) {
	const { icon, tone } = roleIcon(r);
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 text-left outline-none transition-colors hover:bg-surface-2/50 focus-visible:ring-[3px] focus-visible:ring-ring/30"
		>
			<div className="flex w-full items-start gap-3">
				<IconTile tone={tone}>{icon}</IconTile>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="truncate text-sm font-medium">{r.name}</span>
						{r.requireMfa && (
							<Badge tone="success">
								<ShieldCheck /> Two-factor
							</Badge>
						)}
					</div>
					<div className="text-xs text-fg-subtle">
						{r.users ? pluralize(r.users, "person", "people") : "Nobody yet"}
						{r.builtin ? " · comes with Sekai" : ""}
					</div>
				</div>
				<ChevronRight className="mt-2 size-4 shrink-0 text-fg-subtle transition-transform duration-200 group-hover:translate-x-0.5" />
			</div>
			{r.description && <p className="line-clamp-2 text-[13px] leading-5 text-fg-muted">{r.description}</p>}
			<p className="text-xs leading-5 text-fg-subtle">{summary(r)}</p>
		</button>
	);
}

// ---------------------------------------------------------------- models a role may use

function ModelChecklist({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const { data: models = [], isLoading, error } = useModels();
	const [query, setQuery] = useState("");
	// Subscription models run as the person's own agent CLI (the Subscriptions feature), not through these limits.
	const list = models.filter((m) => !m.byos);
	const q = query.trim().toLowerCase();
	const shown = q ? list.filter((m) => `${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(q)) : list;
	const unknown = value.filter((id) => !list.some((m) => m.id === id));
	const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
	return (
		<div className="overflow-hidden rounded-2xl border border-border">
			<div className="flex items-center gap-2 border-b border-border px-3">
				<Search className="size-4 shrink-0 text-fg-subtle" />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search models"
					aria-label="Search models"
					className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle coarse:h-11"
				/>
				<span className="shrink-0 text-xs text-fg-subtle tabular-nums">{value.length} picked</span>
			</div>
			<div className="max-h-64 overflow-y-auto p-1.5 scrollbar-thin">
				{isLoading && (
					<div className="flex justify-center py-4">
						<Spinner />
					</div>
				)}
				{error && <p className="px-2 py-3 text-[13px] text-danger">{error.message}</p>}
				{!q &&
					unknown.map((id) => (
						<Checkbox
							key={id}
							checked
							onCheckedChange={(on) => toggle(id, on)}
							label={id}
							description="Not offered right now"
							className="rounded-lg px-2 py-1.5 hover:bg-surface-2 coarse:py-2.5"
						/>
					))}
				{shown.map((m) => (
					<Checkbox
						key={m.id}
						checked={value.includes(m.id)}
						onCheckedChange={(on) => toggle(m.id, on)}
						label={m.name}
						description={m.api ? m.api.providerName : providerLabel(m.provider)}
						className="rounded-lg px-2 py-1.5 hover:bg-surface-2 coarse:py-2.5"
					/>
				))}
				{!isLoading && shown.length === 0 && (
					<p className="px-2 py-3 text-[13px] text-fg-subtle">
						{q ? `No model matches “${query.trim()}”.` : "No models yet. Set up the gateway in Models."}
					</p>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- the editor

type Draft = {
	name: string;
	description: string;
	permissions: Permission[];
	models: string[] | null;
	numbers: Record<NumberLimit, string>;
	requireMfa: boolean;
};

function draftOf(r: Role | null, template: Role | undefined): Draft {
	const base = r ?? template;
	const limits = base?.limits ?? EMPTY_LIMITS;
	const numbers = Object.fromEntries(
		NUMBER_LIMITS.map((l) => [l.key, limits[l.key] === null ? "" : String(limits[l.key])]),
	) as Record<NumberLimit, string>;
	return {
		name: r?.name ?? "",
		description: r?.description ?? "",
		permissions: (base?.permissions ?? []).filter((p) => p !== "admin"),
		models: limits.models,
		numbers,
		requireMfa: r?.requireMfa ?? false,
	};
}

/** A limit's text as a number (empty: no limit), or an error to show. */
function parseLimit(text: string, decimals?: boolean): { value: number | null; error: string | null } {
	const t = text.trim();
	if (!t) return { value: null, error: null };
	const n = Number(t);
	if (!Number.isFinite(n) || n < 0) return { value: null, error: "Use a number, 0 or more" };
	if (!decimals && !Number.isInteger(n)) return { value: null, error: "Use a whole number" };
	return { value: n, error: null };
}

function LimitField({
	label,
	unit,
	hint,
	decimals,
	value,
	onChange,
}: {
	label: string;
	unit: string;
	hint?: string;
	decimals?: boolean;
	value: string;
	onChange: (v: string) => void;
}) {
	const { value: n, error } = parseLimit(value, decimals);
	const help =
		n !== null && unit === "tokens" && n >= 1000 ? `${formatTokens(n)} tokens` : n === 0 ? "None at all" : hint;
	return (
		<Field label={label} hint={help} error={error}>
			<div className="relative">
				<Input
					type="number"
					inputMode={decimals ? "decimal" : "numeric"}
					min={0}
					step={decimals ? 0.01 : 1}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="No limit"
					className="pr-16"
				/>
				<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle">
					{unit}
				</span>
			</div>
		</Field>
	);
}

function Heading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
			<div className="min-w-0 flex-1 basis-56">
				<h3 className="text-sm font-semibold tracking-tight">{title}</h3>
				{description && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</p>}
			</div>
			{action}
		</div>
	);
}

function RoleDialog({
	open,
	editing: role,
	template,
	onClose,
}: {
	open: boolean;
	/** null: a new role. */
	editing: Role | null;
	/** What a new role starts from (Member). */
	template: Role | undefined;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const [draft, setDraft] = useState<Draft>(() => draftOf(role, template));
	const [deleting, setDeleting] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: start over each time it opens (not on every refetch)
	useEffect(() => {
		if (open) setDraft(draftOf(role, template));
	}, [open, role?.id]);
	const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
	const admin = role?.builtin === "admin";
	const parsed = NUMBER_LIMITS.map((l) => ({ key: l.key, ...parseLimit(draft.numbers[l.key], l.decimals) }));
	const limitsBad = parsed.some((p) => p.error);
	const noModels = draft.models !== null && draft.models.length === 0;
	const ready = draft.name.trim() && (admin || (!limitsBad && !noModels));
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ROLES });
		void qc.invalidateQueries({ queryKey: USERS });
	};

	const save = useMutation({
		mutationFn: () => {
			const base = {
				name: draft.name.trim(),
				description: draft.description.trim(),
				requireMfa: draft.requireMfa,
			};
			if (admin && role) return api.admin.updateRole(role.id, base);
			const limits = { ...EMPTY_LIMITS, models: draft.models };
			for (const p of parsed) limits[p.key] = p.value;
			const body: RoleInput = { ...base, permissions: draft.permissions, limits };
			return role ? api.admin.updateRole(role.id, body) : api.admin.createRole(body);
		},
		onSuccess: (r) => {
			refresh();
			toast.success(role ? "Saved" : `Made “${r.name}”`, { duration: 1500 });
			onClose();
		},
		onError: adminError,
	});
	const remove = useMutation({
		mutationFn: () => api.admin.deleteRole(role?.id ?? ""),
		onSuccess: () => {
			refresh();
			toast.success(`Deleted “${role?.name}”`);
			onClose();
		},
		onError: adminError,
	});

	const togglePermission = (p: Permission, on: boolean) =>
		set({ permissions: on ? [...draft.permissions, p] : draft.permissions.filter((x) => x !== p) });
	const allOn = FEATURES.every((p) => draft.permissions.includes(p));

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => !o && onClose()}
			size="lg"
			icon={role ? roleIcon(role).icon : <UserCog />}
			title={role ? `Edit ${role.name}` : "New role"}
			description={
				admin
					? "Admins can do everything here, with no limits."
					: "What people with this role can do, and how much."
			}
			footer={
				<>
					{role && !role.builtin && (
						<Button variant="danger-ghost" className="mr-auto" onClick={() => setDeleting(true)}>
							<Trash2 /> Delete
						</Button>
					)}
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
						{save.isPending && <Spinner className="text-primary-foreground" />}{" "}
						{role ? "Save" : "Make role"}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-7">
				<div className="grid gap-4">
					<Field label="Name">
						<Input
							autoFocus={!role}
							value={draft.name}
							onChange={(e) => set({ name: e.target.value })}
							placeholder="Family"
							maxLength={60}
						/>
					</Field>
					<Field label="Description" hint="Optional. For you and other admins.">
						<Textarea
							value={draft.description}
							onChange={(e) => set({ description: e.target.value })}
							placeholder="Kids' accounts: chats and voice, a small budget."
							maxLength={300}
							rows={2}
						/>
					</Field>
				</div>

				{admin ? (
					<Callout tone="info" icon={<Crown />} title="Everything, no limits">
						Server settings, people and roles, backups, every feature. Admins' features and limits can't be
						changed.
					</Callout>
				) : (
					<>
						<div className="flex flex-col gap-3">
							<Heading
								title="What they can do"
								description="Chatting is always on. Turn on the ones marked careful only for people you trust."
								action={
									<Button
										variant="ghost"
										size="sm"
										onClick={() => set({ permissions: allOn ? [] : [...FEATURES] })}
									>
										{allOn ? "Turn all off" : "Turn all on"}
									</Button>
								}
							/>
							<div className="divide-y divide-border rounded-2xl border border-border">
								{FEATURES.map((p) => {
									const info = PERMISSION_INFO[p];
									return (
										<ToggleRow
											key={p}
											className="px-4 py-3"
											title={
												<span className="inline-flex flex-wrap items-center gap-1.5">
													{info.label}
													{info.risky && (
														<Badge tone="warning">
															<TriangleAlert /> Careful
														</Badge>
													)}
												</span>
											}
											description={info.description}
											checked={draft.permissions.includes(p)}
											onCheckedChange={(on) => togglePermission(p, on)}
										/>
									);
								})}
							</div>
						</div>

						<div className="flex flex-col gap-3">
							<Heading title="Limits" description="Leave a box empty for no limit." />
							<div className="grid gap-4 sm:grid-cols-2">
								{NUMBER_LIMITS.map((l) => (
									<LimitField
										key={l.key}
										label={l.label}
										unit={l.unit}
										hint={l.hint}
										decimals={l.decimals}
										value={draft.numbers[l.key]}
										onChange={(v) => set({ numbers: { ...draft.numbers, [l.key]: v } })}
									/>
								))}
							</div>
							<div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
								<ToggleRow
									title="Any model"
									description="Or pick the models they may use."
									checked={draft.models === null}
									onCheckedChange={(on) => set({ models: on ? null : (role?.limits.models ?? []) })}
								/>
								{draft.models !== null && (
									<>
										<ModelChecklist value={draft.models} onChange={(models) => set({ models })} />
										{noModels && (
											<p className="text-xs text-destructive">
												Pick at least one, or they can't chat with their bots.
											</p>
										)}
									</>
								)}
							</div>
						</div>
					</>
				)}

				<div className="flex flex-col gap-3">
					<Heading title="Signing in" />
					<div className="rounded-2xl border border-border px-4 py-3">
						<ToggleRow
							title="Require two-factor sign-in"
							description="People with this role must set up two-factor sign-in (an authenticator app, email or text codes, or a passkey) before they can use Sekai."
							checked={draft.requireMfa}
							onCheckedChange={(requireMfa) => set({ requireMfa })}
						/>
					</div>
				</div>
			</div>
			<Confirm
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete “${role?.name}”?`}
				description={
					role?.users
						? `Its ${pluralize(role.users, "person", "people")} move to Member. Their bots, chats and memory stay.`
						: "Nobody has it, so nothing else changes."
				}
				confirmLabel="Delete role"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</Dialog>
	);
}

// ---------------------------------------------------------------- the page

function RolesBody({ creating, setCreating }: { creating: boolean; setCreating: (open: boolean) => void }) {
	const roles = useQuery({ queryKey: ROLES, queryFn: api.admin.roles });
	const [openId, setOpenId] = useState<string | null>(null);
	const list = roles.data ?? [];
	const open = useLastNonNull(list.find((r) => r.id === openId) ?? null);
	const member = list.find((r) => r.builtin === "member");
	const builtin = list.filter((r) => r.builtin);
	const custom = list.filter((r) => !r.builtin);
	return (
		<>
			{roles.isLoading ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<Skeleton className="h-32 rounded-2xl" />
					<Skeleton className="h-32 rounded-2xl" />
				</div>
			) : roles.error ? (
				<Callout tone="danger" icon={<TriangleAlert />}>
					{roles.error.message}
				</Callout>
			) : (
				<>
					<Section
						title="Built in"
						description="They come with Sekai. New people are Members unless you pick another role."
					>
						<div className="grid gap-3 sm:grid-cols-2">
							{builtin.map((r) => (
								<RoleCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
							))}
						</div>
					</Section>
					<Section
						title="Your roles"
						description="For groups that need different features or limits, like family, friends or kids."
					>
						{custom.length === 0 ? (
							<button
								type="button"
								onClick={() => setCreating(true)}
								className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-4 text-left text-sm text-fg-muted transition-colors hover:bg-surface-2/50 hover:text-fg"
							>
								<IconTile tone="neutral">
									<Plus />
								</IconTile>
								<span className="min-w-0">
									<span className="block font-medium text-fg">Make a role</span>
									<span className="block text-xs text-fg-subtle">
										It starts with Member's features.
									</span>
								</span>
							</button>
						) : (
							<div className="grid gap-3 sm:grid-cols-2">
								{custom.map((r) => (
									<RoleCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
								))}
							</div>
						)}
					</Section>
				</>
			)}
			<RoleDialog open={openId !== null} editing={open} template={member} onClose={() => setOpenId(null)} />
			<RoleDialog open={creating} editing={null} template={member} onClose={() => setCreating(false)} />
		</>
	);
}

export function RolesPanel() {
	const [creating, setCreating] = useState(false);
	return (
		<SettingsPanel
			value="roles"
			title="Roles"
			description="What people can do here and how much they can use. Everyone has one role; change it in People."
			action={
				<Button variant="secondary" onClick={() => setCreating(true)}>
					<Plus /> New role
				</Button>
			}
		>
			<RolesBody creating={creating} setCreating={setCreating} />
		</SettingsPanel>
	);
}
