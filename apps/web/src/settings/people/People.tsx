import { api, pluralize, timeAgo, useAuth } from "@sekai/client";
import type { EmailConfig, ManagedUser, Role, UserCredentials, UserUpdate } from "@sekai/shared";
import { USERNAME_PATTERN } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	CopyField,
	Dialog,
	EmptyState,
	ErrorState,
	Field,
	FormGroup,
	Input,
	Link,
	List,
	Page,
	Row,
	Section,
	Segmented,
	Select,
	SkeletonRows,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Fingerprint,
	KeyRound,
	Link2,
	LogOut,
	Mail,
	Power,
	PowerOff,
	ShieldOff,
	Trash2,
	TriangleAlert,
	UserPlus,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useGoBack } from "../../lib/back.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { EMAIL, EMAIL_LIKE, PHONE, ROLES, SSO, USERS, useLastNonNull, usernameFrom } from "./shared.tsx";

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

function Initial({ name, muted }: { name: string; muted?: boolean }) {
	return (
		<span
			aria-hidden
			className={`flex size-8 items-center justify-center rounded-full text-small font-semibold ${
				muted ? "bg-surface-2 text-fg-subtle" : "bg-brand-soft text-brand-ink"
			}`}
		>
			{name.slice(0, 1).toUpperCase()}
		</span>
	);
}

/** The one status worth a badge. The rest stays in the subtitle. */
function statusBadge(u: ManagedUser, role: Role | undefined, me: boolean) {
	if (u.disabled) return <Badge tone="danger">Turned off</Badge>;
	if (owesMfa(u, role)) return <Badge tone="warning">Needs two-step</Badge>;
	if (u.mfa.passkeyRequired) return <Badge tone="info">Passkey required</Badge>;
	if (u.mustChangePassword) return <Badge tone="warning">Temporary password</Badge>;
	if (me) return <Badge tone="brand">You</Badge>;
	return undefined;
}

function personSubtitle(u: ManagedUser, role: Role | undefined) {
	const signIn = u.lastLoginAt ? `signed in ${timeAgo(u.lastLoginAt)}` : "never signed in";
	return [role?.name, `@${u.username}`, signIn].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- shown once

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
									() => toast.success("Copied, ready to send"),
									() => toast.error("Couldn't copy it. Select it and copy it by hand."),
								)
							}
						>
							Copy both
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
						Copy it now. It won't be shown again.
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

// ---------------------------------------------------------------- the list

function PeopleList({ back }: { back: SettingsSectionProps["back"] }) {
	const { data: auth } = useAuth();
	const navigate = useNavigate();
	const users = useQuery({ queryKey: USERS, queryFn: api.admin.users });
	const roles = useRoles();
	const [query, setQuery] = useState("");
	const roleBy = new Map((roles.data ?? []).map((r) => [r.id, r]));
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
		<Page
			back={back}
			title="People"
			description={
				users.data
					? `${pluralize(list.length, "person", "people")}${off ? `, ${off} turned off` : ""}.`
					: "Everyone with an account here."
			}
			actions={
				<Button variant="primary" size="sm" onClick={() => navigate(sectionPath("people", "new"))}>
					<UserPlus /> Add someone
				</Button>
			}
		>
			{users.isLoading ? (
				<SkeletonRows count={4} />
			) : users.isError ? (
				<ErrorState error={users.error} onRetry={() => void users.refetch()} />
			) : (
				<>
					{list.length > 6 && (
						<Field label="Find someone">
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Name, username or email"
								aria-label="Find someone"
							/>
						</Field>
					)}
					{visible.length === 0 ? (
						<EmptyState
							icon={<UserRound />}
							title={q ? "Nobody matches that." : "No one else yet."}
							action={
								q ? undefined : (
									<Button variant="primary" onClick={() => navigate(sectionPath("people", "new"))}>
										Add someone
									</Button>
								)
							}
						/>
					) : (
						<List>
							{visible.map((u) => {
								const role = roleBy.get(u.roleId);
								const me = u.id === auth?.user?.id;
								return (
									<Row
										key={u.id}
										leading={<Initial name={u.name} muted={u.disabled} />}
										title={u.name}
										subtitle={personSubtitle(u, role)}
										badge={statusBadge(u, role, me)}
										href={sectionPath("people", u.id)}
									/>
								);
							})}
						</List>
					)}
				</>
			)}
		</Page>
	);
}

// ---------------------------------------------------------------- add someone

type FirstSignIn = "temporary" | "invite" | "none";

function AddPerson(_props: { back: SettingsSectionProps["back"] }) {
	const goBack = useGoBack();
	const afterSave = useAfterSave();
	const qc = useQueryClient();
	const roles = useRoles();
	const { data: emailConfig } = useQuery({ queryKey: EMAIL, queryFn: api.admin.email });
	const { data: sso = [] } = useQuery({ queryKey: SSO, queryFn: api.admin.sso });
	const memberRole =
		(roles.data ?? []).find((r) => r.builtin === "member") ?? roles.data?.find((r) => r.builtin !== "admin");
	const form = useFormValues({
		name: "",
		username: "",
		usernameEdited: false,
		email: "",
		phone: "",
		roleId: "",
		how: "temporary" as FirstSignIn,
	});
	const v = form.values;
	const role = v.roleId || memberRole?.id || "";
	const handle = v.usernameEdited ? v.username : usernameFrom(v.name);
	const emailBad = v.email.trim() !== "" && !EMAIL_LIKE.test(v.email.trim());
	const phoneBad = v.phone.trim() !== "" && !PHONE.test(v.phone.trim().replace(/[\s()-]/g, ""));
	const handleBad = (v.usernameEdited || v.name.trim().length > 1) && !USERNAME_PATTERN.test(handle);
	// Single sign-on only works when their first sign-in can find this account: a provider that matches verified
	// emails, and their email (the server checks the same).
	const ssoFinds = sso.some((p) => p.enabled && p.linkByEmail);
	const ssoReady = v.how !== "none" || (ssoFinds && v.email.trim() !== "" && !emailBad);
	const ready = Boolean(v.name.trim() && USERNAME_PATTERN.test(handle) && !emailBad && !phoneBad && role && ssoReady);
	const emailsInvite = emailReady(emailConfig) && v.email.trim() !== "" && !emailBad;
	const [shown, setShown] = useState<Shown | null>(null);
	const create = useMutation({
		mutationFn: () =>
			api.admin.createUser({
				name: v.name.trim(),
				username: handle,
				email: v.email.trim() || null,
				phone: v.phone.trim().replace(/[\s()-]/g, "") || null,
				roleId: role,
				password: v.how,
			}),
		onSuccess: (creds) => {
			void qc.invalidateQueries({ queryKey: USERS });
			void qc.invalidateQueries({ queryKey: ROLES });
			form.reset();
			if (creds.temporaryPassword || creds.inviteUrl) setShown({ creds, reason: "new" });
			else afterSave(() => goBack("/settings/people"));
		},
		onError: () => {},
	});
	const howHint =
		v.how === "temporary"
			? "You send them a temporary password. They choose their own when they sign in."
			: v.how === "invite"
				? emailsInvite
					? "A one-time link, valid for 7 days. Sekai emails it to them."
					: "A one-time link, valid for 7 days. You send it to them."
				: "No password. They sign in with Google, GitHub, Discord or your own provider.";
	return (
		<Page
			back={{ label: "People", onClick: () => goBack("/settings/people") }}
			title="Add someone"
			description="They get their own bots, chats and memory."
		>
			{roles.isLoading ? (
				<SkeletonRows count={3} leading={false} />
			) : (
				<FormGroup
					dirty={form.dirty}
					submitLabel="Add someone"
					disabled={!ready}
					onCancel={() => form.reset()}
					onSubmit={() => saveForm(create.mutateAsync)}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name" hint="What their bots call them.">
							<Input
								autoFocus
								value={v.name}
								onChange={(e) => form.set("name", e.target.value)}
								placeholder="e.g. Ana Lima"
							/>
						</Field>
						<Field
							label="Username"
							error={handleBad ? "2 to 39 letters, digits, dots, dashes or underscores" : null}
							hint="They sign in with it."
						>
							<Input
								value={handle}
								onChange={(e) => {
									form.setValues((cur) => ({
										...cur,
										username: e.target.value.toLowerCase(),
										usernameEdited: true,
									}));
								}}
								placeholder="e.g. ana"
								autoCapitalize="none"
								autoComplete="off"
								spellCheck={false}
							/>
						</Field>
						<Field
							label="Email"
							optional={v.how !== "none"}
							hint={
								v.how === "none"
									? "Their single sign-on finds this account by it."
									: "For invites, codes and password resets."
							}
							error={emailBad ? "That doesn't look like an email address" : null}
						>
							<Input
								type="email"
								value={v.email}
								onChange={(e) => form.set("email", e.target.value)}
								placeholder="e.g. ana@example.com"
								autoComplete="off"
							/>
						</Field>
						<Field
							label="Phone"
							optional
							hint="With the country code, for text codes."
							error={phoneBad ? "Use the country code, like +15551234567" : null}
						>
							<Input
								type="tel"
								inputMode="tel"
								value={v.phone}
								onChange={(e) => form.set("phone", e.target.value)}
								placeholder="e.g. +15551234567"
								autoComplete="off"
							/>
						</Field>
						<Field label="Role" className="sm:col-span-2">
							<Select
								value={role}
								onValueChange={(roleId) => form.set("roleId", roleId)}
								options={roleOptions(roles.data ?? [])}
								placeholder="Pick a role"
							/>
						</Field>
					</div>
					<Field label="How they sign in first" hint={howHint}>
						<Segmented
							value={v.how}
							onValueChange={(how) => form.set("how", how)}
							label="How they sign in first"
							options={[
								{ value: "temporary", label: "Password" },
								{ value: "invite", label: "Invite link" },
								{ value: "none", label: "Single sign-on" },
							]}
						/>
					</Field>
					{v.how === "none" && !ssoFinds && (
						<Callout
							tone="warning"
							icon={<TriangleAlert />}
							action={
								<Button variant="secondary" size="sm" onClick={() => form.set("how", "invite")}>
									Use an invite link
								</Button>
							}
						>
							Single sign-on can't find their account yet: it needs a provider that matches verified
							emails, in{" "}
							<Link
								href={sectionPath("sign-in-options")}
								className="font-medium text-brand-ink underline"
							>
								Sign-in options
							</Link>
							. Or invite them, and they can link single sign-on once they're in.
						</Callout>
					)}
				</FormGroup>
			)}
			<CredentialsDialog shown={shown} onClose={() => goBack("/settings/people")} />
		</Page>
	);
}

// ---------------------------------------------------------------- one person

type Ask = "temporary" | "link" | "mfa" | "passkey" | "signout" | "off" | "delete";

function PersonPage({ id }: { id: string; back: SettingsSectionProps["back"] }) {
	const goBack = useGoBack();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { data: auth } = useAuth();
	const users = useQuery({ queryKey: USERS, queryFn: api.admin.users });
	const roles = useRoles();
	const { data: emailConfig } = useQuery({ queryKey: EMAIL, queryFn: api.admin.email, staleTime: 60_000 });
	const user = users.data?.find((u) => u.id === id);
	const role = roles.data?.find((r) => r.id === user?.roleId);
	const me = user?.id === auth?.user?.id;
	const [ask, setAsk] = useState<Ask | null>(null);
	const [shown, setShown] = useState<Shown | null>(null);
	const saved = {
		name: user?.name ?? "",
		email: user?.email ?? "",
		phone: user?.phone ?? "",
		roleId: user?.roleId ?? "",
	};
	const form = useFormValues(saved);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: USERS });
		void qc.invalidateQueries({ queryKey: ROLES });
	};
	const cleanPhone = form.values.phone.trim().replace(/[\s()-]/g, "");
	const emailBad = form.values.email.trim() !== "" && !EMAIL_LIKE.test(form.values.email.trim());
	const phoneBad = cleanPhone !== "" && !PHONE.test(cleanPhone);
	const patch: UserUpdate = {};
	if (user) {
		if (form.values.name.trim() !== user.name) patch.name = form.values.name.trim();
		if ((form.values.email.trim() || null) !== user.email) patch.email = form.values.email.trim() || null;
		if ((cleanPhone || null) !== user.phone) patch.phone = cleanPhone || null;
		if (form.values.roleId !== user.roleId) patch.roleId = form.values.roleId;
	}
	const save = useMutation({
		mutationFn: () => api.admin.updateUser(user?.id ?? "", patch),
		onSuccess: (next) => {
			refresh();
			form.reset({
				name: next.name,
				email: next.email ?? "",
				phone: next.phone ?? "",
				roleId: next.roleId,
			});
		},
		onError: () => {},
	});
	const setDisabled = useMutation({
		mutationFn: (disabled: boolean) => api.admin.updateUser(id, { disabled }),
		onSuccess: refresh,
		onError: actionError,
	});
	const resetPassword = useMutation({
		mutationFn: (how: "temporary" | "link") => api.admin.resetPassword(id, how),
		onSuccess: (creds) => {
			refresh();
			setShown({ creds, reason: "reset" });
		},
		onError: actionError,
	});
	const resetMfa = useMutation({
		mutationFn: () => api.admin.resetMfa(id),
		onSuccess: refresh,
		onError: actionError,
	});
	const stopPasskey = useMutation({
		mutationFn: () => api.admin.stopRequiringPasskey(id),
		onSuccess: refresh,
		onError: actionError,
	});
	const signOut = useMutation({
		mutationFn: () => api.admin.signOutUser(id),
		onSuccess: () => toast.success("Signed out everywhere"),
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: () => api.admin.deleteUser(id),
		onSuccess: () => {
			refresh();
			navigate("/settings/people", { replace: true });
		},
		onError: actionError,
	});
	const lastAsk = useLastNonNull(ask);
	if (users.isLoading) {
		return (
			<Page back={{ label: "People", onClick: () => goBack("/settings/people") }} title="Person">
				<SkeletonRows count={4} />
			</Page>
		);
	}
	if (users.isError) {
		return (
			<Page back={{ label: "People", onClick: () => goBack("/settings/people") }} title="Person">
				<ErrorState error={users.error} onRetry={() => void users.refetch()} />
			</Page>
		);
	}
	if (!user) {
		return (
			<Page back={{ label: "People", onClick: () => goBack("/settings/people") }} title="Person">
				<EmptyState icon={<UserRound />} title="This person isn't here." />
			</Page>
		);
	}
	const first = user.name.split(" ")[0] ?? user.name;
	const hasMfa =
		user.mfa.totp || user.mfa.email || user.mfa.sms || user.mfa.recoveryCodes > 0 || user.mfa.passkeyRequired;
	const emailsLink = Boolean(user.email) && emailReady(emailConfig);
	const methods = [
		user.mfa.totp && "Authenticator app",
		user.mfa.email && "Email codes",
		user.mfa.sms && "Text codes",
		user.mfa.passkeys > 0 &&
			(user.mfa.passkeyRequired ? "Passkey required" : pluralize(user.mfa.passkeys, "passkey")),
		...user.identities.map((i) => i.providerName),
	].filter(Boolean);
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
				emailsLink ? `Sekai emails it to ${user.email}.` : "You send it to them."
			}`,
			confirm: "Make a link",
			run: () => resetPassword.mutate("link"),
		},
		mfa: {
			title: `Reset ${first}'s two-step sign-in?`,
			description: `Their authenticator app, email and text codes and recovery codes are removed${
				user.mfa.passkeyRequired ? ", sign-ins stop requiring a passkey," : ""
			} and they're signed out everywhere. Passkeys stay. For when they lost their phone.`,
			confirm: "Reset",
			danger: true,
			run: () => resetMfa.mutate(),
		},
		passkey: {
			title: `Let ${first} sign in without a passkey?`,
			description:
				"Their password (and their two-step codes, if they have any) will be enough to sign in again. For when they lost their passkeys and recovery codes. Their passkeys stay, and they can turn this back on themselves.",
			confirm: "Stop requiring it",
			danger: true,
			run: () => stopPasskey.mutate(),
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
			title: `Delete ${user.name}'s account?`,
			description:
				"This deletes their bots, chats, memory and files for good. It can't be undone. To just keep them out, turn the account off instead.",
			confirm: "Delete account",
			danger: true,
			run: () => remove.mutate(),
		},
	};
	const current = lastAsk ? asks[lastAsk] : null;
	return (
		<Page
			back={{ label: "People", onClick: () => goBack("/settings/people") }}
			title={user.name}
			description={personSubtitle(user, role)}
		>
			{user.disabled && (
				<Callout tone="warning" icon={<PowerOff />} title="Turned off">
					They can't sign in, and their bots and routines are stopped.
				</Callout>
			)}
			{owesMfa(user, role) && !user.disabled && (
				<Callout tone="warning" icon={<TriangleAlert />}>
					Their role asks for two-step sign-in, and they haven't set it up yet.
				</Callout>
			)}
			<Section title="Account">
				<FormGroup
					dirty={Object.keys(patch).length > 0}
					disabled={!form.values.name.trim() || emailBad || phoneBad}
					onCancel={() => form.reset()}
					onSubmit={() => saveForm(save.mutateAsync)}
				>
					<Field label="Name">
						<Input value={form.values.name} onChange={(e) => form.set("name", e.target.value)} />
					</Field>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							label="Email"
							error={emailBad ? "That doesn't look like an email address" : null}
							optional
						>
							<Input
								type="email"
								value={form.values.email}
								onChange={(e) => form.set("email", e.target.value)}
								placeholder="e.g. mika@example.com"
							/>
						</Field>
						<Field
							label="Phone"
							error={phoneBad ? "Use the country code, like +15551234567" : null}
							optional
						>
							<Input
								type="tel"
								inputMode="tel"
								value={form.values.phone}
								onChange={(e) => form.set("phone", e.target.value)}
								placeholder="e.g. +15551234567"
							/>
						</Field>
					</div>
					<Field label="Role">
						<Select
							value={form.values.roleId}
							onValueChange={(roleId) => form.set("roleId", roleId)}
							options={roleOptions(roles.data ?? [])}
						/>
					</Field>
				</FormGroup>
			</Section>
			{(methods.length > 0 || me) && (
				<Section title="Sign-in" description={methods.length ? methods.join(", ") : "Username and password."}>
					{me && (
						<List>
							<Row
								icon={<UserRound />}
								title="Profile"
								subtitle="Your name, username, email and phone."
								href={sectionPath("profile")}
							/>
							<Row
								icon={<KeyRound />}
								title="Sign-in & security"
								subtitle="Your password, passkeys and two-step."
								href={sectionPath("sign-in-security")}
							/>
						</List>
					)}
				</Section>
			)}
			{!me && (
				<Section title="Actions">
					<List>
						<Row icon={<KeyRound />} title="New temporary password" onClick={() => setAsk("temporary")} />
						<Row icon={<Link2 />} title="Make a reset link" onClick={() => setAsk("link")} />
						{hasMfa && <Row icon={<ShieldOff />} title="Reset two-step" onClick={() => setAsk("mfa")} />}
						{user.mfa.passkeyRequired && (
							<Row
								icon={<Fingerprint />}
								title="Stop requiring a passkey"
								onClick={() => setAsk("passkey")}
							/>
						)}
						<Row icon={<LogOut />} title="Sign out everywhere" onClick={() => setAsk("signout")} />
						{user.disabled ? (
							<Row icon={<Power />} title="Turn on" onClick={() => setDisabled.mutate(false)} />
						) : (
							<Row icon={<PowerOff />} title="Turn off" onClick={() => setAsk("off")} danger />
						)}
						<Row icon={<Trash2 />} title="Delete account" onClick={() => setAsk("delete")} danger />
					</List>
				</Section>
			)}
			<Confirm
				open={ask !== null}
				onOpenChange={(o) => !o && setAsk(null)}
				title={current?.title ?? ""}
				description={current?.description}
				confirmLabel={current?.confirm}
				danger={current?.danger}
				onConfirm={() => current?.run()}
			/>
			<CredentialsDialog shown={shown} onClose={() => setShown(null)} />
		</Page>
	);
}

export function PeopleSection({ back, rest }: SettingsSectionProps) {
	if (rest === "new") return <AddPerson back={back} />;
	if (rest) return <PersonPage id={rest} back={back} />;
	return <PeopleList back={back} />;
}
