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
	Button,
	Callout,
	Checkbox,
	Confirm,
	EmptyState,
	ErrorState,
	Field,
	FormGroup,
	Input,
	List,
	Page,
	Row,
	Section,
	SkeletonRows,
	Textarea,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Plus, Search, ShieldCheck, Trash2, UserCog, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useGoBack } from "../../lib/back.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { ROLES, USERS } from "./shared.tsx";

/** Every feature a role can turn on ("admin" is the Admin role's alone). */
const FEATURES = PERMISSIONS.filter((p): p is Exclude<Permission, "admin"> => p !== "admin");

type NumberLimit = Exclude<keyof RoleLimits, "models">;
const NUMBER_LIMITS: { key: NumberLimit; label: string; unit: string; decimals?: boolean; hint?: string }[] = [
	{ key: "maxBots", label: "Bots", unit: "bots", hint: "How many bots they can have." },
	{ key: "maxJobs", label: "Active coding jobs", unit: "jobs", hint: "Four at once by default, up to two per bot." },
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

function roleIcon(r: Role): ReactNode {
	if (r.builtin === "admin") return <Crown />;
	if (r.builtin === "member") return <UserRound />;
	return <UserCog />;
}

/** One line for the list: who has it, and whether it's limited. The page has the detail. */
function listLine(r: Role): string {
	const people = r.users ? pluralize(r.users, "person", "people") : "Nobody yet";
	if (r.builtin === "admin") return `${people} · Everything, no limits`;
	const n = r.permissions.filter((p) => p !== "admin").length;
	const l = r.limits;
	const limited =
		l.models !== null ||
		l.maxBots !== null ||
		l.maxJobs != null ||
		l.costPerMonth !== null ||
		l.tokensPerDay !== null ||
		l.tokensPerMonth !== null ||
		l.storageMb !== null;
	return `${people} · ${n} of ${FEATURES.length} features${limited ? " · limited" : ""}${r.requireMfa ? " · two-step" : ""}`;
}

/** "6 of 13 features · up to 3 bots · $20 a month" */
function summary(r: Role): string {
	if (r.builtin === "admin") return "Everything, no limits";
	const l = r.limits;
	const parts = [`${r.permissions.filter((p) => p !== "admin").length} of ${FEATURES.length} features`];
	if (l.models) parts.push(l.models.length === 1 ? "1 model" : `${l.models.length} models`);
	if (l.maxBots !== null) parts.push(`up to ${pluralize(l.maxBots, "bot")}`);
	if (l.maxJobs != null) parts.push(`up to ${pluralize(l.maxJobs, "active job")}`);
	if (l.costPerMonth !== null) parts.push(`$${l.costPerMonth} a month`);
	if (l.tokensPerDay !== null) parts.push(`${formatTokens(l.tokensPerDay)} tokens a day`);
	if (l.tokensPerMonth !== null) parts.push(`${formatTokens(l.tokensPerMonth)} tokens a month`);
	if (l.storageMb !== null) parts.push(`${l.storageMb.toLocaleString()} MB`);
	if (r.requireMfa) parts.push("two-step required");
	if (parts.length === 1) parts.push("no limits");
	return parts.join(" · ");
}

function ModelChecklist({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
	const { data: models = [], isLoading, error } = useModels();
	const [query, setQuery] = useState("");
	const list = models.filter((m) => !m.byos);
	const q = query.trim().toLowerCase();
	const shown = q ? list.filter((m) => `${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(q)) : list;
	const unknown = value.filter((id) => !list.some((m) => m.id === id));
	const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<div className="flex items-center gap-2 border-b border-border px-3">
				<Search className="size-4 shrink-0 text-fg-subtle" />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search models"
					aria-label="Search models"
					className="h-10 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-subtle coarse:h-11"
				/>
				<span className="shrink-0 text-caption text-fg-subtle tabular-nums">{value.length} picked</span>
			</div>
			<div className="max-h-64 overflow-y-auto p-1.5">
				{isLoading && <SkeletonRows count={3} leading={false} inset={false} />}
				{error && <p className="px-2 py-3 text-small text-danger-ink">{error.message}</p>}
				{!q &&
					unknown.map((id) => (
						<Checkbox
							key={id}
							checked
							onCheckedChange={(on) => toggle(id, on)}
							label={id}
							description="Not offered right now"
							className="rounded-md px-2 py-1.5 hover:bg-surface-2 coarse:py-2.5"
						/>
					))}
				{shown.map((m) => (
					<Checkbox
						key={m.id}
						checked={value.includes(m.id)}
						onCheckedChange={(on) => toggle(m.id, on)}
						label={m.name}
						description={m.api ? m.api.providerName : providerLabel(m.provider)}
						className="rounded-md px-2 py-1.5 hover:bg-surface-2 coarse:py-2.5"
					/>
				))}
				{!isLoading && shown.length === 0 && (
					<p className="px-2 py-3 text-small text-fg-subtle">
						{q ? "No model matches that." : "No models yet. Set them up in Models."}
					</p>
				)}
			</div>
		</div>
	);
}

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
		NUMBER_LIMITS.map((l) => [l.key, limits[l.key] == null ? "" : String(limits[l.key])]),
	) as Record<NumberLimit, string>;
	return {
		name: r?.name ?? "",
		description: r?.description ?? "",
		permissions: (base?.permissions ?? []).filter((p) => p !== "admin"),
		models: limits.models,
		numbers,
		requireMfa: r?.requireMfa ?? template?.requireMfa ?? false,
	};
}

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
		<Field label={label} hint={error ? undefined : help} error={error}>
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
				<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-small text-fg-subtle">
					{unit}
				</span>
			</div>
		</Field>
	);
}

function RoleEditor({
	editing,
	template,
	onDone,
}: {
	editing: Role | null;
	template: Role | undefined;
	onDone: () => void;
}) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const afterSave = useAfterSave();
	const form = useFormValues(draftOf(editing, template));
	const draft = form.values;
	const [deleting, setDeleting] = useState(false);
	const set = (patch: Partial<Draft>) => form.setValues((d) => ({ ...d, ...patch }));
	const admin = editing?.builtin === "admin";
	const parsed = NUMBER_LIMITS.map((l) => ({ key: l.key, ...parseLimit(draft.numbers[l.key], l.decimals) }));
	const limitsBad = parsed.some((p) => p.error);
	const noModels = draft.models !== null && draft.models.length === 0;
	const ready = Boolean(draft.name.trim() && (admin || (!limitsBad && !noModels)));
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ROLES });
		void qc.invalidateQueries({ queryKey: USERS });
	};
	const save = useMutation({
		mutationFn: () => {
			const bodyBase = {
				name: draft.name.trim(),
				description: draft.description.trim(),
				requireMfa: draft.requireMfa,
			};
			if (admin && editing) return api.admin.updateRole(editing.id, bodyBase);
			const limits = { ...EMPTY_LIMITS, models: draft.models };
			for (const p of parsed) limits[p.key] = p.value;
			const body: RoleInput = { ...bodyBase, permissions: draft.permissions, limits };
			return editing ? api.admin.updateRole(editing.id, body) : api.admin.createRole(body);
		},
		onSuccess: (r) => {
			// The new role's page finds it at once, before the list comes back.
			qc.setQueryData<Role[]>(ROLES, (list) => (list ? [...list.filter((x) => x.id !== r.id), r] : list));
			refresh();
			form.reset(draftOf(r, template));
			if (!editing) afterSave(() => navigate(sectionPath("roles", r.id), { replace: true }));
		},
		onError: () => {},
	});
	const remove = useMutation({
		mutationFn: () => api.admin.deleteRole(editing?.id ?? ""),
		onSuccess: () => {
			refresh();
			onDone();
		},
		onError: actionError,
	});
	const togglePermission = (p: Permission, on: boolean) =>
		set({ permissions: on ? [...draft.permissions, p] : draft.permissions.filter((x) => x !== p) });
	const allOn = FEATURES.every((p) => draft.permissions.includes(p));
	return (
		<>
			<FormGroup
				dirty={form.dirty}
				submitLabel={editing ? "Save" : "Create role"}
				disabled={!ready}
				onCancel={() => form.reset()}
				onSubmit={() => saveForm(save.mutateAsync)}
			>
				<Field label="Name">
					<Input
						autoFocus={!editing}
						value={draft.name}
						onChange={(e) => set({ name: e.target.value })}
						placeholder="e.g. Family"
						maxLength={60}
					/>
				</Field>
				<Field label="Description" optional hint="For you and other admins.">
					<Textarea
						value={draft.description}
						onChange={(e) => set({ description: e.target.value })}
						placeholder="e.g. Kids' accounts: chats and voice, a small budget."
						maxLength={300}
						rows={2}
					/>
				</Field>
				{admin ? (
					<Callout tone="info" icon={<Crown />} title="Everything, no limits">
						Server settings, people, roles and backups. An admin's features and limits can't be changed.
					</Callout>
				) : (
					<>
						<Section
							title="What they can do"
							description="Chatting is always on."
							action={
								<Button
									variant="ghost"
									size="sm"
									onClick={() => set({ permissions: allOn ? [] : [...FEATURES] })}
								>
									{allOn ? "Turn all off" : "Turn all on"}
								</Button>
							}
						>
							<List>
								{FEATURES.map((p) => {
									const info = PERMISSION_INFO[p];
									return (
										<ToggleRow
											key={p}
											title={info.label}
											description={`${info.description}${info.risky ? " Careful: only for people you trust." : ""}`}
											checked={draft.permissions.includes(p)}
											onCheckedChange={(on) => togglePermission(p, on)}
										/>
									);
								})}
							</List>
						</Section>
						<Section title="Limits" description="Leave a box empty for no limit.">
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
							<List>
								<ToggleRow
									title="Any model"
									description="Or pick the models they may use."
									checked={draft.models === null}
									onCheckedChange={(on) =>
										set({ models: on ? null : (editing?.limits.models ?? []) })
									}
								/>
							</List>
							{draft.models !== null && (
								<>
									<ModelChecklist value={draft.models} onChange={(models) => set({ models })} />
									{noModels && (
										<p className="text-small text-danger-ink">
											Pick at least one, or they can't chat.
										</p>
									)}
								</>
							)}
						</Section>
					</>
				)}
				<List>
					<ToggleRow
						title="Require two-step sign-in"
						description="They set up a second step before they can use Sekai."
						checked={draft.requireMfa}
						onCheckedChange={(requireMfa) => set({ requireMfa })}
					/>
				</List>
			</FormGroup>
			{editing && !editing.builtin && (
				<div className="pt-2">
					<Button variant="danger-ghost" onClick={() => setDeleting(true)}>
						<Trash2 /> Delete role
					</Button>
				</div>
			)}
			<Confirm
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete “${editing?.name}”?`}
				description={
					editing?.users
						? `Its ${pluralize(editing.users, "person", "people")} move to Member. Their bots, chats and memory stay.`
						: "Nobody has it, so nothing else changes."
				}
				confirmLabel="Delete role"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

function RolesList({ back }: { back: SettingsSectionProps["back"] }) {
	const navigate = useNavigate();
	const roles = useQuery({ queryKey: ROLES, queryFn: api.admin.roles });
	const list = roles.data ?? [];
	const builtin = list.filter((r) => r.builtin);
	const custom = list.filter((r) => !r.builtin);
	return (
		<Page
			back={back}
			title="Roles"
			description="What people can do, and how much."
			actions={
				<Button variant="primary" size="sm" onClick={() => navigate(sectionPath("roles", "new"))}>
					<Plus /> New role
				</Button>
			}
		>
			{roles.isLoading ? (
				<SkeletonRows count={3} />
			) : roles.isError ? (
				<ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
			) : (
				<>
					<Section title="Built in" description="New people are Members unless you pick another role.">
						<List>
							{builtin.map((r) => (
								<Row
									key={r.id}
									icon={roleIcon(r)}
									iconTone={r.builtin === "admin" ? "info" : "brand"}
									title={r.name}
									subtitle={listLine(r)}
									href={sectionPath("roles", r.id)}
								/>
							))}
						</List>
					</Section>
					<Section title="Your roles" description="For groups that need different features or limits.">
						{custom.length === 0 ? (
							<EmptyState
								size="sm"
								icon={<ShieldCheck />}
								title="No roles of your own yet."
								action={
									<Button variant="primary" onClick={() => navigate(sectionPath("roles", "new"))}>
										New role
									</Button>
								}
							/>
						) : (
							<List>
								{custom.map((r) => (
									<Row
										key={r.id}
										icon={roleIcon(r)}
										title={r.name}
										subtitle={listLine(r)}
										href={sectionPath("roles", r.id)}
									/>
								))}
							</List>
						)}
					</Section>
				</>
			)}
		</Page>
	);
}

function RolePage({ id }: { id: string }) {
	const goBack = useGoBack();
	const roles = useQuery({ queryKey: ROLES, queryFn: api.admin.roles });
	const back = { label: "Roles", onClick: () => goBack("/settings/roles") };
	if (roles.isLoading) {
		return (
			<Page back={back} title="Role">
				<SkeletonRows count={4} leading={false} />
			</Page>
		);
	}
	if (roles.isError) {
		return (
			<Page back={back} title="Role">
				<ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
			</Page>
		);
	}
	const list = roles.data ?? [];
	const member = list.find((r) => r.builtin === "member");
	if (id === "new") {
		return (
			<Page back={back} title="New role" description="It starts with Member's features.">
				<RoleEditor editing={null} template={member} onDone={() => goBack("/settings/roles")} />
			</Page>
		);
	}
	const role = list.find((r) => r.id === id);
	if (!role) {
		return (
			<Page back={back} title="Role">
				<EmptyState icon={<UserCog />} title="This role isn't here." />
			</Page>
		);
	}
	return (
		<Page back={back} title={role.name} description={summary(role)}>
			<RoleEditor key={role.id} editing={role} template={member} onDone={() => goBack("/settings/roles")} />
		</Page>
	);
}

export function RolesSection({ back, rest }: SettingsSectionProps) {
	if (rest) return <RolePage id={rest} />;
	return <RolesList back={back} />;
}
