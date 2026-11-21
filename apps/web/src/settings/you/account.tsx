/** Your account's parts, for Settings → Profile and Sign-in & security. */
import {
	api,
	BrandGlyph,
	passkeysSupported,
	qk,
	RecoveryCodes,
	registerPasskey,
	ssoBrand,
	TwoFactorSettings,
	timeAgo,
	useMfaStatus,
} from "@sekai/client";
import { type AuthStatus, type AuthUser, PASSWORD_MIN, type PasskeyInfo, USERNAME_PATTERN } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	FormGroup,
	Input,
	List,
	PasswordInput,
	Row,
	Section,
	SkeletonRows,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Info, KeyRound, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { actionError, saveForm } from "../../lib/forms.ts";

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

function identityOf(user: AuthUser) {
	return {
		name: user.name,
		username: user.username,
		email: user.email ?? "",
		phone: user.phone ?? "",
	};
}

/** Name, username, email and phone. They save together: a username change shouldn't happen on blur. */
export function Profile({ user }: { user: AuthUser }) {
	const qc = useQueryClient();
	const form = useFormValues(identityOf(user));
	const { name, username, email, phone } = form.values;
	const emailBad = email.trim() !== "" && !EMAIL_LIKE.test(email.trim());
	const phoneClean = phone.replace(/[\s()-]/g, "");
	const phoneBad = phone.trim() !== "" && !PHONE.test(phoneClean);
	const handleBad = username.trim() !== "" && !USERNAME_PATTERN.test(username.trim());
	return (
		<Section title="Name and contact" description="How your bots know you, and how you sign in.">
			<FormGroup
				dirty={form.dirty}
				disabled={!name.trim() || handleBad || emailBad || phoneBad}
				onCancel={() => form.reset()}
				onSubmit={() =>
					saveForm(async () => {
						const next = await api.auth.updateAccount({
							name: name.trim(),
							username: username.trim(),
							...(email !== (user.email ?? "") ? { email: email.trim() || null } : {}),
							...(phone !== (user.phone ?? "") ? { phone: phoneClean || null } : {}),
						});
						qc.setQueryData<AuthStatus>(qk.auth, (s) => (s ? { ...s, user: next } : s));
						void qc.invalidateQueries({ queryKey: qk.settings });
						form.reset(identityOf(next));
					})
				}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Name" hint="What your bots call you.">
						<Input value={name} onChange={(e) => form.set("name", e.target.value)} autoComplete="name" />
					</Field>
					<Field
						label="Username"
						error={handleBad ? "2 to 39 letters, digits, dots, dashes or underscores" : null}
					>
						<Input
							value={username}
							onChange={(e) => form.set("username", e.target.value.toLowerCase())}
							autoComplete="username"
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
					<Field
						label="Email"
						hint="Sign in with it, and get codes and reset links there."
						error={emailBad ? "That doesn't look like an email address" : null}
						optional
					>
						<Input
							type="email"
							value={email}
							onChange={(e) => form.set("email", e.target.value)}
							autoComplete="email"
							placeholder="e.g. you@example.com"
						/>
					</Field>
					<Field
						label="Phone"
						hint="With its country code, for sign-in codes by text."
						error={phoneBad ? "Use the country code, like +15551234567" : null}
						optional
					>
						<Input
							type="tel"
							value={phone}
							onChange={(e) => form.set("phone", e.target.value)}
							autoComplete="tel"
							placeholder="e.g. +15551234567"
						/>
					</Field>
				</div>
			</FormGroup>
		</Section>
	);
}

export function Password() {
	const form = useFormValues({ current: "", next: "", again: "" });
	const { current, next, again } = form.values;
	const mismatch = again.length > 0 && again !== next;
	const [signedOut, setSignedOut] = useState(false);
	return (
		<Section title="Password" description="Changing it signs you out everywhere else.">
			<FormGroup
				dirty={form.dirty}
				submitLabel="Change password"
				disabled={!current || next.length < PASSWORD_MIN || next !== again}
				onCancel={() => form.reset()}
				onSubmit={async () => {
					await api.auth.changePassword({ current, next });
					form.reset({ current: "", next: "", again: "" });
					setSignedOut(true);
				}}
			>
				<input type="text" autoComplete="username" className="hidden" readOnly value="" />
				<Field label="Current password">
					<PasswordInput
						value={current}
						onChange={(e) => form.set("current", e.target.value)}
						autoComplete="current-password"
					/>
				</Field>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
						<PasswordInput
							value={next}
							onChange={(e) => form.set("next", e.target.value)}
							autoComplete="new-password"
						/>
					</Field>
					<Field label="New password again" error={mismatch ? "These don't match" : null}>
						<PasswordInput
							value={again}
							onChange={(e) => form.set("again", e.target.value)}
							autoComplete="new-password"
						/>
					</Field>
				</div>
			</FormGroup>
			{signedOut && !form.dirty && (
				<Callout tone="success" icon={<KeyRound />}>
					Password changed. Other devices were signed out.
				</Callout>
			)}
		</Section>
	);
}

/** "Require a passkey to sign in": on needs a passkey; recovery codes stand in for a lost one. */
function RequirePasskey({ passkeys }: { passkeys: PasskeyInfo[] }) {
	const qc = useQueryClient();
	const mfa = useMfaStatus();
	const [asking, setAsking] = useState<boolean | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const on = Boolean(mfa.data?.passkeyRequired);
	const set = useMutation({
		mutationFn: (required: boolean) => api.auth.requirePasskey(required),
		onSuccess: (r) => {
			void qc.invalidateQueries({ queryKey: ["auth", "mfa"] });
			if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
		},
		onError: actionError,
	});
	const hosts = [...new Set(passkeys.map((p) => p.rpId))];
	const here = hosts.includes(location.hostname);
	return (
		<>
			<List>
				<ToggleRow
					title="Require a passkey to sign in"
					description={
						!passkeys.length && !on
							? "Add a passkey first. Then sign-ins need it, not just your password."
							: "Sign-ins need your passkey too, not just your password."
					}
					checked={on}
					disabled={!mfa.data || set.isPending || (!on && !passkeys.length)}
					onCheckedChange={setAsking}
				/>
			</List>
			{on && !here && hosts.length > 0 && (
				<Callout tone="warning" icon={<Info />}>
					Your passkeys are for {hosts.join(", ")}. Signing in on this address takes a recovery code.
				</Callout>
			)}
			<Confirm
				open={asking !== null}
				onOpenChange={(o) => !o && setAsking(null)}
				title={asking ? "Require your passkey to sign in?" : "Stop requiring your passkey?"}
				description={
					asking
						? "Signing in with your password, a linked account or a link will ask for your passkey too (codes from an app, email or text won't do). Signing in with the passkey itself stays one step. If you lose your passkeys, a recovery code signs you in once instead."
						: "Your password (and your two-step codes, if you have them) will be enough to sign in again."
				}
				confirmLabel={asking ? "Turn on" : "Turn off"}
				danger={asking === false}
				onConfirm={() => asking !== null && set.mutate(asking)}
			/>
			<RecoveryCodes codes={codes} lost="your passkeys" onDone={() => setCodes(null)} />
		</>
	);
}

export function Passkeys({ status }: { status: AuthStatus }) {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: qk.passkeys, queryFn: api.auth.passkeys });
	const mfa = useMfaStatus();
	const [renaming, setRenaming] = useState<PasskeyInfo | null>(null);
	const [name, setName] = useState("");
	const [deleting, setDeleting] = useState<PasskeyInfo | null>(null);
	// While sign-ins require a passkey, the last one stays (the server refuses too).
	const lastRequired = Boolean(mfa.data?.passkeyRequired) && (list.data?.length ?? 0) <= 1;
	const supported = passkeysSupported(status.passkeysAvailable);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.passkeys });
		void qc.invalidateQueries({ queryKey: qk.auth, exact: true });
	};
	const add = useMutation({
		mutationFn: () => registerPasskey(),
		onSuccess: refresh,
		onError: (err) => {
			if (err.message !== "Cancelled") toast.error(err.message);
		},
	});
	const rename = useMutation({
		mutationFn: () => api.auth.renamePasskey(renaming?.id ?? "", name),
		onSuccess: () => {
			setRenaming(null);
			refresh();
		},
		onError: actionError,
	});
	const remove = useMutation({
		mutationFn: (id: string) => api.auth.deletePasskey(id),
		onSuccess: refresh,
		onError: actionError,
	});
	const none = list.isSuccess && list.data.length === 0;

	return (
		<Section
			title="Passkeys"
			description="Sign in with your face, fingerprint, device or password manager."
			action={
				supported && !none ? (
					<Button variant="secondary" size="sm" onClick={() => add.mutate()} loading={add.isPending}>
						<Plus /> Add a passkey
					</Button>
				) : undefined
			}
		>
			{!supported && (
				<Callout tone="info" icon={<Info />} title="Passkeys need a secure address">
					Open Sekai over https, or on localhost, to add one. A passkey only works on the address it was made
					on.
				</Callout>
			)}
			{list.isLoading ? (
				<SkeletonRows count={2} />
			) : !list.data?.length ? (
				// Without a secure address the callout above already says how to get one.
				supported && (
					<EmptyState
						size="sm"
						icon={<Fingerprint />}
						title="No passkeys yet"
						description="Faster than a password, and they can't be phished."
						action={
							<Button variant="secondary" onClick={() => add.mutate()} loading={add.isPending}>
								Add a passkey
							</Button>
						}
					/>
				)
			) : (
				<List>
					{list.data.map((p) => {
						const elsewhere = p.rpId !== location.hostname;
						return (
							<Row
								key={p.id}
								icon={<Fingerprint />}
								iconTone="brand"
								title={p.name}
								subtitle={`For ${p.rpId} · added ${timeAgo(p.createdAt)} · ${
									p.lastUsedAt ? `last used ${timeAgo(p.lastUsedAt)}` : "never used"
								}`}
								badge={
									// Another address matters more: it won't sign you in here.
									elsewhere ? (
										<Badge>Another address</Badge>
									) : p.backedUp ? (
										<Badge tone="info">Synced</Badge>
									) : undefined
								}
								menu={[
									{
										label: "Rename",
										icon: <Pencil />,
										onSelect: () => {
											setName(p.name);
											setRenaming(p);
										},
									},
									{
										label: "Remove",
										icon: <Trash2 />,
										danger: true,
										onSelect: () => setDeleting(p),
									},
								]}
								menuLabel={`Actions for ${p.name}`}
							/>
						);
					})}
				</List>
			)}
			{list.data && <RequirePasskey passkeys={list.data} />}
			<Dialog
				open={renaming !== null}
				onOpenChange={(o) => !o && setRenaming(null)}
				title="Rename passkey"
				size="sm"
				footer={
					<>
						<Button variant="ghost" onClick={() => setRenaming(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!name.trim() || rename.isPending}
							onClick={() => rename.mutate()}
						>
							Save
						</Button>
					</>
				}
			>
				<Field label="Name">
					<Input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && name.trim() && rename.mutate()}
					/>
				</Field>
			</Dialog>
			<Confirm
				open={deleting !== null && !lastRequired}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Remove “${deleting?.name}”?`}
				description="You won't be able to sign in with it any more. Also delete it from the device or password manager that holds it."
				confirmLabel="Remove"
				danger
				onConfirm={() => deleting && remove.mutate(deleting.id)}
			/>
			<Dialog
				open={deleting !== null && lastRequired}
				onOpenChange={(o) => !o && setDeleting(null)}
				size="sm"
				icon={<Fingerprint />}
				title="This is your last passkey"
				footer={
					<Button variant="primary" onClick={() => setDeleting(null)}>
						OK
					</Button>
				}
			>
				<p className="text-body text-fg-muted">
					Your sign-ins require a passkey, so it stays. Add another passkey first, or turn off “Require a
					passkey to sign in”.
				</p>
			</Dialog>
		</Section>
	);
}

export function TwoFactor() {
	return (
		<Section title="Two-step" description="A code after your password, so a stolen password isn't enough.">
			<TwoFactorSettings />
		</Section>
	);
}

/** Google, GitHub, Discord or your own sign-in provider, linked to this account. */
export function LinkedAccounts({ status }: { status: AuthStatus }) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const list = useQuery({ queryKey: ["auth", "identities"], queryFn: api.auth.identities });
	const [unlinking, setUnlinking] = useState<string | null>(null);
	const unlink = useMutation({
		mutationFn: (id: string) => api.auth.unlinkIdentity(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["auth", "identities"] }),
		onError: actionError,
	});
	// Back from linking: say so once, and tidy the address.
	useEffect(() => {
		const q = new URLSearchParams(location.search);
		const error = q.get("sso_error");
		if (q.get("sso_linked") === "1") toast.success("Linked");
		if (error) toast.error(error);
		if (error || q.has("sso_linked")) navigate(location.pathname + location.hash, { replace: true });
	}, [navigate]);
	if (!status.sso.length && !list.data?.length) return null;
	if (list.isLoading) return <SkeletonRows count={2} />;
	const linked = new Set(list.data?.map((i) => i.providerId));
	const open = status.sso.filter((p) => !linked.has(p.id));
	return (
		<Section title="Linked sign-ins" description="Sign in with these accounts too.">
			<List>
				{list.data?.map((i) => {
					const brand = ssoBrand(i.kind);
					return (
						<Row
							key={i.id}
							leading={
								<span className="flex size-8 items-center justify-center">
									{brand ? <BrandGlyph brand={brand} size={18} /> : <KeyRound className="size-4" />}
								</span>
							}
							title={i.providerName}
							subtitle={`${i.email ?? "Linked"} · ${i.lastUsedAt ? `last used ${timeAgo(i.lastUsedAt)}` : "not used yet"}`}
							menu={[
								{
									label: "Unlink",
									icon: <Link2 />,
									danger: true,
									onSelect: () => setUnlinking(i.id),
								},
							]}
							menuLabel={`Actions for ${i.providerName}`}
						/>
					);
				})}
				{open.map((p) => {
					const brand = ssoBrand(p.kind);
					return (
						<Row
							key={p.id}
							leading={
								<span className="flex size-8 items-center justify-center">
									{brand ? <BrandGlyph brand={brand} size={18} /> : <KeyRound className="size-4" />}
								</span>
							}
							title={p.name}
							subtitle="Not linked yet"
							trailing={
								<Button
									variant="secondary"
									size="sm"
									onClick={() =>
										location.assign(
											api.auth.ssoStartUrl(p.id, {
												link: true,
												redirect: "/settings/sign-in-security",
											}),
										)
									}
								>
									Link
								</Button>
							}
						/>
					);
				})}
			</List>
			<Confirm
				open={unlinking !== null}
				onOpenChange={(o) => !o && setUnlinking(null)}
				title="Unlink this sign-in?"
				description="You won't be able to sign in with it any more. You can link it again."
				confirmLabel="Unlink"
				danger
				onConfirm={() => unlinking && unlink.mutate(unlinking)}
			/>
		</Section>
	);
}
