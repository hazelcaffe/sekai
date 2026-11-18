import { api, cn, pluralize, timeAgo, useAuth } from "@sekai/client";
import {
	ApiError,
	type EmailConfig,
	type ManagedUser,
	type Role,
	USERNAME_PATTERN,
	type UserCredentials,
	type UserUpdate,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	Field,
	Input,
	type MenuEntry,
	Section,
	Select,
	SettingsPanel,
	Skeleton,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Copy,
	Fingerprint,
	KeyRound,
	Link2,
	LogIn,
	LogOut,
	Mail,
	MessageSquareText,
	MoreHorizontal,
	Pencil,
	Power,
	PowerOff,
	Search,
	ShieldAlert,
	ShieldOff,
	Smartphone,
	Trash2,
	TriangleAlert,
	UserPlus,
	UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const USERS = ["admin", "users"] as const;
const ROLES = ["admin", "roles"] as const;
const SSO = ["admin", "sso"] as const;
const EMAIL = ["admin", "email"] as const;

const PHONE = /^\+[1-9]\d{6,14}$/;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An admin action's error as a toast. A cancelled "Confirm it's you" says nothing: that dialog already asked. */
export function adminError(err: unknown): void {
	if (err instanceof ApiError && err.code === "reauth_required") return;
	toast.error(err instanceof Error ? err.message : String(err));
}

/** The last value that wasn't null, so a closing dialog keeps its content while it animates away. */
export function useLastNonNull<T>(value: T | null): T | null {
	const [last, setLast] = useState(value);
	if (value !== null && value !== last) setLast(value);
	return value ?? last;
}

/** A value to copy (a temporary password, a link, a redirect URL), with its own copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted py-1.5 pr-1.5 pl-3">
			<code className="min-w-0 flex-1 truncate font-mono text-[13px] select-all" title={value}>
				{value}
			</code>
			<Button
				size="xs"
				variant="secondary"
				aria-label={copied ? "Copied" : `Copy ${label}`}
				className="coarse:h-9"
				onClick={() => {
					navigator.clipboard.writeText(value).then(
						() => setCopied(true),
						() => toast.error("Couldn't copy it. Select it and copy it by hand."),
					);
				}}
			>
				{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
}

/** "ana.lima" from "Ána Lima": a username suggestion (they can change it). */
function usernameFrom(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ".")
		.replace(/[^a-z0-9._-]+/g, "")
		.replace(/^[._-]+/, "")
		.slice(0, 39);
}

const emailReady = (c: EmailConfig | undefined) => Boolean(c?.enabled && c.host && c.from);

function useRoles() {
	return useQuery({ queryKey: ROLES, queryFn: api.admin.roles });
}

function roleOptions(roles: Role[]) {
	return roles.map((r) => ({
		value: r.id,
		label: r.name,
		description: r.builtin === "admin" ? "Everything, no limits" : r.description || undefined,
	}));
}

const owesMfa = (u: ManagedUser, role: Role | undefined) =>
	Boolean(role?.requireMfa) && !u.mfa.totp && !u.mfa.email && !u.mfa.sms && u.mfa.passkeys === 0;

// ---------------------------------------------------------------- shown once: a temporary password or a link

type Shown = { creds: UserCredentials; reason: "new" | "reset" };

function CredentialsDialog({ shown: open, onClose }: { shown: Shown | null; onClose: () => void }) {
	const shown = useLastNonNull(open);
	const creds = shown?.creds;
	const user = creds?.user;
	const first = user?.name.split(" ")[0] ?? "";
	const reset = shown?.reason === "reset";
	const message =
		creds?.temporaryPassword && user
			? `Sign in to Sekai at ${location.origin}\nUsername: ${user.username}\nTemporary password: ${creds.temporaryPassword}\nYou'll choose your own password when you sign in.`
			: null;
	return (
		<Dialog
			open={open !== null}
			onOpenChange={(o) => !o && onClose()}
			icon={creds?.temporaryPassword ? <KeyRound /> : <Link2 />}
			title={
				creds?.temporaryPassword
					? reset
						? `${first}'s new temporary password`
						: `${first}'s account is ready`
					: reset
						? `${first}'s reset link`
						: `${first}'s invite link`
			}
			description={
				creds?.temporaryPassword
					? "Send them these. They choose their own password when they sign in."
					: reset
						? "They choose a new password with it. It works once, for an hour."
						: "They choose their password with it. It works once, for 7 days."
			}
			footer={
				<>
					{message && (
						<Button
							variant="secondary"
							onClick={() =>
								navigator.clipboard.writeText(message).then(
									() => toast.success("Copied, ready to send", { duration: 1500 }),
									() => toast.error("Couldn't copy it. Select it and copy it by hand."),
								)
							}
						>
							<Copy /> Copy both
						</Button>
					)}
					<Button variant="primary" onClick={onClose}>
						Done
					</Button>
				</>
			}
		>
			{creds && user && (
				<div className="flex flex-col gap-4">
					{creds.emailed && (
						<Callout tone="success" icon={<Mail />}>
							Sekai emailed it to {user.email}. You can also send it yourself.
						</Callout>
					)}
					<Callout tone="warning" icon={<TriangleAlert />}>
						Copy it now: it won't be shown again.
					</Callout>
					{creds.temporaryPassword ? (
						<>
							<Field label="Username">
								<CopyField value={user.username} label="username" />
							</Field>
							<Field label="Temporary password" hint={`They sign in at ${location.origin}.`}>
								<CopyField value={creds.temporaryPassword} label="temporary password" />
							</Field>
						</>
					) : (
						creds.inviteUrl && (
							<Field label={reset ? "Reset link" : "Invite link"}>
								<CopyField value={creds.inviteUrl} label="link" />
							</Field>
						)
					)}
				</div>
			)}
		</Dialog>
	);
}

// ---------------------------------------------------------------- adding someone

type FirstSignIn = "temporary" | "invite" | "none";

function OptionCard({
	selected,
	onSelect,
	title,
	description,
	icon,
}: {
	selected: boolean;
	onSelect: () => void;
	title: string;
	description: ReactNode;
	icon: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: rich choice cards; ARIA radios on buttons are valid
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			onClick={onSelect}
			className={cn(
				"flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 [&>svg]:mt-0.5 [&>svg]:size-[18px] [&>svg]:shrink-0",
				selected
					? "border-brand/50 bg-brand/6 [&>svg]:text-brand-ink"
					: "border-border hover:bg-surface-2/60 [&>svg]:text-fg-subtle",
			)}
		>
			{icon}
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium">{title}</span>
				<span className="mt-0.5 block text-xs leading-5 text-fg-subtle">{description}</span>
			</span>
			<span
				aria-hidden
				className={cn(
					"mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
					selected ? "border-brand bg-brand text-brand-foreground" : "border-input",
				)}
			>
				{selected && <Check className="size-3" />}
			</span>
		</button>
	);
}

function AddPersonDialog({
	open,
	onOpenChange,
	roles,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	roles: Role[];
	onCreated: (creds: UserCredentials) => void;
}) {
	const qc = useQueryClient();
	const { data: emailConfig } = useQuery({ queryKey: EMAIL, queryFn: api.admin.email, enabled: open });
	const { data: sso = [] } = useQuery({ queryKey: SSO, queryFn: api.admin.sso, enabled: open });
	const memberRole = roles.find((r) => r.builtin === "member") ?? roles.find((r) => r.builtin !== "admin");
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [usernameEdited, setUsernameEdited] = useState(false);
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [roleId, setRoleId] = useState("");
	const [how, setHow] = useState<FirstSignIn>("temporary");
	useEffect(() => {
		if (!open) return;
		setName("");
		setUsername("");
		setUsernameEdited(false);
		setEmail("");
		setPhone("");
		setHow("temporary");
	}, [open]);
	const role = roleId || memberRole?.id || "";
	const handle = usernameEdited ? username : usernameFrom(name);
	const emailBad = email.trim() !== "" && !EMAIL_LIKE.test(email.trim());
	const phoneBad = phone.trim() !== "" && !PHONE.test(phone.trim().replace(/[\s()-]/g, ""));
	const handleBad = (usernameEdited || name.trim().length > 1) && !USERNAME_PATTERN.test(handle);
	const ready = name.trim() && USERNAME_PATTERN.test(handle) && !emailBad && !phoneBad && role;
	const ssoOn = sso.some((p) => p.enabled);
	const emailsInvite = emailReady(emailConfig) && email.trim() !== "" && !emailBad;

	const create = useMutation({
		mutationFn: () =>
			api.admin.createUser({
				name: name.trim(),
				username: handle,
				email: email.trim() || null,
				phone: phone.trim().replace(/[\s()-]/g, "") || null,
				roleId: role,
				password: how,
			}),
		onSuccess: (creds) => {
			void qc.invalidateQueries({ queryKey: USERS });
			void qc.invalidateQueries({ queryKey: ROLES });
			onOpenChange(false);
			if (creds.temporaryPassword || creds.inviteUrl) onCreated(creds);
			else toast.success(`Added ${creds.user.name}`, { description: "They sign in with single sign-on." });
		},
		onError: adminError,
	});

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			icon={<UserPlus />}
			title="Add someone"
			description="They get their own bots, chats and memory. Their role decides what they can do."
			footer={
				<>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
						{create.isPending && <Spinner className="text-primary-foreground" />} Add
					</Button>
				</>
			}
		>
			<form
				className="grid gap-4 sm:grid-cols-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready && !create.isPending) create.mutate();
				}}
			>
				<Field label="Name" hint="What their bots call them.">
					<Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Lima" />
				</Field>
				<Field
					label="Username"
					error={handleBad ? "2 to 39 letters, digits, dots, dashes or underscores" : null}
					hint="They sign in with it."
				>
					<Input
						value={handle}
						onChange={(e) => {
							setUsername(e.target.value.toLowerCase());
							setUsernameEdited(true);
						}}
						placeholder="ana"
						autoCapitalize="none"
						autoComplete="off"
						spellCheck={false}
					/>
				</Field>
				<Field
					label="Email"
					hint="Optional. For invites, codes and password resets."
					error={emailBad ? "That doesn't look like an email address" : null}
				>
					<Input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="ana@example.com"
						autoComplete="off"
					/>
				</Field>
				<Field
					label="Phone"
					hint="Optional. With the country code, for text codes."
					error={phoneBad ? "Use the country code, like +15551234567" : null}
				>
					<Input
						type="tel"
						inputMode="tel"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						placeholder="+15551234567"
						autoComplete="off"
					/>
				</Field>
				<Field label="Role" className="sm:col-span-2">
					<Select
						value={role}
						onValueChange={setRoleId}
						options={roleOptions(roles)}
						placeholder="Pick a role"
					/>
				</Field>
				<div className="flex flex-col gap-2 sm:col-span-2">
					<div className="text-sm font-medium">How they sign in first</div>
					<div role="radiogroup" aria-label="How they sign in first" className="flex flex-col gap-2">
						<OptionCard
							selected={how === "temporary"}
							onSelect={() => setHow("temporary")}
							icon={<KeyRound />}
							title="Temporary password"
							description="You send it to them. They choose their own when they sign in."
						/>
						<OptionCard
							selected={how === "invite"}
							onSelect={() => setHow("invite")}
							icon={<Link2 />}
							title="Invite link"
							description={
								emailsInvite
									? "A one-time link to choose their password, valid for 7 days. Sekai emails it to them."
									: "A one-time link to choose their password, valid for 7 days. You send it to them."
							}
						/>
						<OptionCard
							selected={how === "none"}
							onSelect={() => setHow("none")}
							icon={<LogIn />}
							title="Single sign-on only"
							description="No password: they sign in with Google, GitHub, Discord or your own provider."
						/>
					</div>
					{how === "none" && !ssoOn && (
						<Callout tone="warning" icon={<TriangleAlert />}>
							Single sign-on isn't set up yet. Add a provider in Sign-in options, or they can't get in.
						</Callout>
					)}
					{how === "none" && ssoOn && !email.trim() && (
						<p className="text-xs leading-5 text-fg-subtle">
							Add their email so their sign-in finds this account (or they link it later).
						</p>
					)}
				</div>
				<button type="submit" hidden />
			</form>
		</Dialog>
	);
}

// ---------------------------------------------------------------- editing someone

function EditPersonDialog({
	user: editing,
	roles,
	onClose,
}: {
	user: ManagedUser | null;
	roles: Role[];
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const user = useLastNonNull(editing);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [roleId, setRoleId] = useState("");
	useEffect(() => {
		if (!editing) return;
		setName(editing.name);
		setEmail(editing.email ?? "");
		setPhone(editing.phone ?? "");
		setRoleId(editing.roleId);
	}, [editing]);
	const cleanPhone = phone.trim().replace(/[\s()-]/g, "");
	const emailBad = email.trim() !== "" && !EMAIL_LIKE.test(email.trim());
	const phoneBad = cleanPhone !== "" && !PHONE.test(cleanPhone);
	const patch: UserUpdate = {};
	if (user) {
		if (name.trim() !== user.name) patch.name = name.trim();
		if ((email.trim() || null) !== user.email) patch.email = email.trim() || null;
		if ((cleanPhone || null) !== user.phone) patch.phone = cleanPhone || null;
		if (roleId !== user.roleId) patch.roleId = roleId;
	}
	const dirty = Object.keys(patch).length > 0;
	const save = useMutation({
		mutationFn: () => api.admin.updateUser(user?.id ?? "", patch),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: USERS });
			void qc.invalidateQueries({ queryKey: ROLES });
			toast.success("Saved", { duration: 1200 });
			onClose();
		},
		onError: adminError,
	});
	const ready = dirty && name.trim() && !emailBad && !phoneBad && !save.isPending;
	return (
		<Dialog
			open={editing !== null}
			onOpenChange={(o) => !o && onClose()}
			icon={<Pencil />}
			title={`Edit ${user?.name ?? ""}`}
			description={user ? `@${user.username}` : undefined}
			footer={
				<>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!ready} onClick={() => save.mutate()}>
						{save.isPending && <Spinner className="text-primary-foreground" />} Save
					</Button>
				</>
			}
		>
			<form
				className="grid gap-4 sm:grid-cols-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) save.mutate();
				}}
			>
				<Field label="Name" className="sm:col-span-2">
					<Input value={name} onChange={(e) => setName(e.target.value)} />
				</Field>
				<Field label="Email" error={emailBad ? "That doesn't look like an email address" : null}>
					<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="None" />
				</Field>
				<Field label="Phone" error={phoneBad ? "Use the country code, like +15551234567" : null}>
					<Input
						type="tel"
						inputMode="tel"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						placeholder="None"
					/>
				</Field>
				<Field label="Role" className="sm:col-span-2">
					<Select value={roleId} onValueChange={setRoleId} options={roleOptions(roles)} />
				</Field>
				<button type="submit" hidden />
			</form>
		</Dialog>
	);
}

// ---------------------------------------------------------------- one person

type Ask = "temporary" | "link" | "mfa" | "signout" | "off" | "delete";

function TwoFactorBadges({ u, role }: { u: ManagedUser; role: Role | undefined }) {
	const chips: { key: string; icon: ReactNode; label: string }[] = [];
	if (u.mfa.totp) chips.push({ key: "totp", icon: <Smartphone />, label: "Authenticator app" });
	if (u.mfa.email) chips.push({ key: "email", icon: <Mail />, label: "Email codes" });
	if (u.mfa.sms) chips.push({ key: "sms", icon: <MessageSquareText />, label: "Text codes" });
	if (u.mfa.passkeys > 0) {
		chips.push({ key: "passkeys", icon: <Fingerprint />, label: pluralize(u.mfa.passkeys, "passkey") });
	}
	for (const i of u.identities) chips.push({ key: i.providerId, icon: <LogIn />, label: i.providerName });
	const owes = owesMfa(u, role);
	if (!chips.length && !owes) return null;
	return (
		<div className="mt-1.5 flex flex-wrap gap-1">
			{owes && (
				<Badge tone="warning">
					<ShieldAlert /> Needs two-factor
				</Badge>
			)}
			{chips.map((c) => (
				<Badge key={c.key}>
					{c.icon} {c.label}
				</Badge>
			))}
		</div>
	);
}

function PersonRow({
	u,
	role,
	me,
	onEdit,
	onShow,
}: {
	u: ManagedUser;
	role: Role | undefined;
	me: boolean;
	onEdit: () => void;
	onShow: (shown: Shown) => void;
}) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const { data: emailConfig } = useQuery({ queryKey: EMAIL, queryFn: api.admin.email, staleTime: 60_000 });
	const [ask, setAsk] = useState<Ask | null>(null);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: USERS });
		void qc.invalidateQueries({ queryKey: ROLES });
	};
	const first = u.name.split(" ")[0] ?? u.name;
	const setDisabled = useMutation({
		mutationFn: (disabled: boolean) => api.admin.updateUser(u.id, { disabled }),
		onSuccess: (next) => {
			refresh();
			toast.success(next.disabled ? `${first} is turned off` : `${first} can sign in again`);
		},
		onError: adminError,
	});
	const resetPassword = useMutation({
		mutationFn: (how: "temporary" | "link") => api.admin.resetPassword(u.id, how),
		onSuccess: (creds) => {
			refresh();
			onShow({ creds, reason: "reset" });
		},
		onError: adminError,
	});
	const resetMfa = useMutation({
		mutationFn: () => api.admin.resetMfa(u.id),
		onSuccess: () => {
			refresh();
			toast.success(`${first} sets up two-factor sign-in again`);
		},
		onError: adminError,
	});
	const signOut = useMutation({
		mutationFn: () => api.admin.signOutUser(u.id),
		onSuccess: () => toast.success(`${first} is signed out everywhere`),
		onError: adminError,
	});
	const remove = useMutation({
		mutationFn: () => api.admin.deleteUser(u.id),
		onSuccess: () => {
			refresh();
			toast.success(`Deleted ${u.name}'s account`);
		},
		onError: adminError,
	});
	const busy =
		setDisabled.isPending || resetPassword.isPending || resetMfa.isPending || signOut.isPending || remove.isPending;
	const hasMfa = u.mfa.totp || u.mfa.email || u.mfa.sms || u.mfa.recoveryCodes > 0;
	const emailsLink = Boolean(u.email) && emailReady(emailConfig);

	const entries: MenuEntry[] = [
		{ label: "Edit", icon: <Pencil />, onSelect: onEdit },
		me && { label: "Your account", icon: <UserRound />, onSelect: () => navigate("/account") },
		"-",
		!me && { label: "New temporary password", icon: <KeyRound />, onSelect: () => setAsk("temporary") },
		!me && { label: "Make a reset link", icon: <Link2 />, onSelect: () => setAsk("link") },
		!me && hasMfa && { label: "Reset two-factor", icon: <ShieldOff />, onSelect: () => setAsk("mfa") },
		!me && { label: "Sign out everywhere", icon: <LogOut />, onSelect: () => setAsk("signout") },
		"-",
		!me &&
			(u.disabled
				? { label: "Turn on", icon: <Power />, onSelect: () => setDisabled.mutate(false) }
				: { label: "Turn off", icon: <PowerOff />, onSelect: () => setAsk("off") }),
		!me && { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setAsk("delete") },
	];

	const asks: Record<
		Ask,
		{ title: string; description: string; confirm: string; danger?: boolean; run: () => void }
	> = {
		temporary: {
			title: `Give ${first} a new temporary password?`,
			description:
				"Their password stops working and they're signed out everywhere. They choose a new one when they sign in.",
			confirm: "Make one",
			run: () => resetPassword.mutate("temporary"),
		},
		link: {
			title: `Make a reset link for ${first}?`,
			description: `They're signed out everywhere and choose a new password with the link (it works once, for an hour). ${
				emailsLink ? `Sekai emails it to ${u.email}.` : "You send it to them."
			}`,
			confirm: "Make a link",
			run: () => resetPassword.mutate("link"),
		},
		mfa: {
			title: `Reset ${first}'s two-factor sign-in?`,
			description:
				"Their authenticator app, email and text codes and recovery codes are removed, and they're signed out everywhere. Passkeys stay. For when they lost their phone.",
			confirm: "Reset",
			danger: true,
			run: () => resetMfa.mutate(),
		},
		signout: {
			title: `Sign ${first} out everywhere?`,
			description: "Every browser and app they're signed in on. Their API tokens keep working.",
			confirm: "Sign out",
			run: () => signOut.mutate(),
		},
		off: {
			title: `Turn off ${first}'s account?`,
			description:
				"They're signed out everywhere and can't sign in. Their bots and routines stop too. Nothing is deleted: turn it back on any time.",
			confirm: "Turn off",
			danger: true,
			run: () => setDisabled.mutate(true),
		},
		delete: {
			title: `Delete ${u.name}'s account?`,
			description:
				"This deletes their bots, chats, memory and files for good. It can't be undone. To just keep them out, turn the account off instead.",
			confirm: "Delete account",
			danger: true,
			run: () => remove.mutate(),
		},
	};
	const lastAsk = useLastNonNull(ask);
	const current = lastAsk ? asks[lastAsk] : null;

	return (
		<div className={cn("flex items-start gap-3 px-4 py-3", u.disabled && "bg-surface-2/40")}>
			<span
				aria-hidden
				className={cn(
					"mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
					u.disabled ? "bg-muted text-fg-subtle" : "bg-brand/14 text-brand-ink",
				)}
			>
				{u.name.slice(0, 1).toUpperCase()}
			</span>
			<button
				type="button"
				onClick={onEdit}
				className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<span className={cn("truncate text-sm font-medium", u.disabled && "text-fg-muted")}>{u.name}</span>
					{me && <Badge tone="brand">You</Badge>}
					{role && <Badge tone={role.builtin === "admin" ? "info" : "neutral"}>{role.name}</Badge>}
					{u.disabled && <Badge tone="danger">Turned off</Badge>}
					{u.mustChangePassword && !u.disabled && <Badge tone="warning">Temporary password</Badge>}
				</div>
				<div className="truncate text-xs text-fg-subtle">
					@{u.username}
					{u.email ? ` · ${u.email}` : ""} ·{" "}
					{u.lastLoginAt ? `signed in ${timeAgo(u.lastLoginAt)}` : "never signed in"}
				</div>
				<TwoFactorBadges u={u} role={role} />
			</button>
			<div className="flex shrink-0 items-center">
				{busy && <Spinner className="mr-1" />}
				<DropdownMenu>
					<DropdownTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label={`More for ${u.name}`}>
							<MoreHorizontal />
						</Button>
					</DropdownTrigger>
					<DropdownContent>
						<DropdownEntries entries={entries} />
					</DropdownContent>
				</DropdownMenu>
			</div>
			<Confirm
				open={ask !== null}
				onOpenChange={(o) => !o && setAsk(null)}
				title={current?.title ?? ""}
				description={current?.description}
				confirmLabel={current?.confirm}
				danger={current?.danger}
				onConfirm={() => current?.run()}
			/>
		</div>
	);
}

// ---------------------------------------------------------------- the page

function PeopleBody({ adding, setAdding }: { adding: boolean; setAdding: (open: boolean) => void }) {
	const { data: auth } = useAuth();
	const users = useQuery({ queryKey: USERS, queryFn: api.admin.users });
	const roles = useRoles();
	const [editing, setEditing] = useState<ManagedUser | null>(null);
	const [shown, setShown] = useState<Shown | null>(null);
	const [query, setQuery] = useState("");
	const roleBy = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
	const list = users.data ?? [];
	const q = query.trim().toLowerCase();
	const visible = q
		? list.filter((u) =>
				`${u.name} ${u.username} ${u.email ?? ""} ${roleBy.get(u.roleId)?.name ?? ""}`
					.toLowerCase()
					.includes(q),
			)
		: list;
	const off = list.filter((u) => u.disabled).length;

	return (
		<>
			<Section
				title="Everyone here"
				description={
					users.data
						? `${pluralize(list.length, "person", "people")}${off ? `, ${off} turned off` : ""}. There's no sign-up page: you add people here.`
						: undefined
				}
			>
				{list.length > 6 && (
					<label className="flex h-10 items-center gap-2 rounded-xl bg-surface-2/70 px-3 text-sm focus-within:bg-surface-2 coarse:h-11">
						<Search className="size-4 shrink-0 text-fg-subtle" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Find someone"
							aria-label="Find someone"
							className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
						/>
					</label>
				)}
				{users.isLoading ? (
					<div className="flex flex-col gap-2">
						<Skeleton className="h-16 rounded-2xl" />
						<Skeleton className="h-16 rounded-2xl" />
					</div>
				) : users.error ? (
					<Callout tone="danger" icon={<TriangleAlert />}>
						{users.error.message}
					</Callout>
				) : visible.length === 0 ? (
					<p className="px-1 text-[13px] text-fg-subtle">Nobody matches “{query.trim()}”.</p>
				) : (
					<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
						{visible.map((u) => (
							<PersonRow
								key={u.id}
								u={u}
								role={roleBy.get(u.roleId)}
								me={u.id === auth?.user?.id}
								onEdit={() => setEditing(u)}
								onShow={setShown}
							/>
						))}
					</div>
				)}
			</Section>
			<AddPersonDialog
				open={adding}
				onOpenChange={setAdding}
				roles={roles.data ?? []}
				onCreated={(creds) => setShown({ creds, reason: "new" })}
			/>
			<EditPersonDialog user={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />
			<CredentialsDialog shown={shown} onClose={() => setShown(null)} />
		</>
	);
}

export function PeoplePanel() {
	const [adding, setAdding] = useState(false);
	return (
		<SettingsPanel
			value="people"
			title="People"
			description="Everyone who can use this Sekai. Each person has their own bots, chats and memory, and their role decides what they can do."
			action={
				<Button variant="primary" onClick={() => setAdding(true)}>
					<UserPlus /> Add someone
				</Button>
			}
		>
			<PeopleBody adding={adding} setAdding={setAdding} />
		</SettingsPanel>
	);
}
