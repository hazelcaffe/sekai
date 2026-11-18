import {
	api,
	BrandGlyph,
	passkeysSupported,
	qk,
	registerPasskey,
	ssoBrand,
	TwoFactorSettings,
	timeAgo,
	useAuth,
} from "@sekai/client";
import { type AuthStatus, type AuthUser, PASSWORD_MIN, type PasskeyInfo } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	Input,
	PasswordInput,
	Section,
	SettingsPanel,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Fingerprint, Info, KeyRound, Link2, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function Profile({ user }: { user: AuthUser }) {
	const qc = useQueryClient();
	const [name, setName] = useState(user.name);
	const [username, setUsername] = useState(user.username);
	const [email, setEmail] = useState(user.email ?? "");
	const [phone, setPhone] = useState(user.phone ?? "");
	useEffect(() => {
		setName(user.name);
		setUsername(user.username);
		setEmail(user.email ?? "");
		setPhone(user.phone ?? "");
	}, [user]);
	const save = useMutation({
		mutationFn: () =>
			api.auth.updateAccount({
				name: name.trim(),
				username: username.trim(),
				...(email !== (user.email ?? "") ? { email: email.trim() || null } : {}),
				...(phone !== (user.phone ?? "") ? { phone: phone.replace(/[\s()-]/g, "") || null } : {}),
			}),
		onSuccess: (next) => {
			qc.setQueryData<AuthStatus>(qk.auth, (s) => (s ? { ...s, user: next } : s));
			void qc.invalidateQueries({ queryKey: qk.settings });
			toast.success("Saved", { duration: 1200 });
		},
		onError: (err) => toast.error(err.message),
	});
	const dirty =
		name !== user.name ||
		username !== user.username ||
		email !== (user.email ?? "") ||
		phone !== (user.phone ?? "");
	return (
		<Section title="Profile" icon={<UserRound />}>
			<div className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
				<Field label="Name" hint="What your bots call you.">
					<Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
				</Field>
				<Field label="Username">
					<Input
						value={username}
						onChange={(e) => setUsername(e.target.value.toLowerCase())}
						autoComplete="username"
						autoCapitalize="none"
						spellCheck={false}
					/>
				</Field>
				<Field label="Email" hint="Optional. You can sign in with it, and get codes and reset links there.">
					<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
				</Field>
				<Field label="Phone" hint="Optional, with its country code (+1…). For sign-in codes by text.">
					<Input
						type="tel"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						autoComplete="tel"
						placeholder="+15551234567"
					/>
				</Field>
				<div className="sm:col-span-2">
					<Button
						variant="primary"
						disabled={!dirty || !name.trim() || save.isPending}
						onClick={() => save.mutate()}
					>
						{save.isPending && <Spinner className="text-primary-foreground" />} Save
					</Button>
				</div>
			</div>
		</Section>
	);
}

function Password() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [again, setAgain] = useState("");
	const change = useMutation({
		mutationFn: () => api.auth.changePassword({ current, next }),
		onSuccess: () => {
			setCurrent("");
			setNext("");
			setAgain("");
			toast.success("Password changed. Other devices were signed out.");
		},
	});
	const mismatch = again.length > 0 && again !== next;
	return (
		<Section title="Password" icon={<KeyRound />} description="Changing it signs you out everywhere else.">
			<form
				className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2"
				onSubmit={(e) => {
					e.preventDefault();
					change.mutate();
				}}
			>
				<input type="text" autoComplete="username" className="hidden" readOnly value="" />
				<Field label="Current password" className="sm:col-span-2">
					<PasswordInput
						value={current}
						onChange={(e) => setCurrent(e.target.value)}
						autoComplete="current-password"
					/>
				</Field>
				<Field label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
					<PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
				</Field>
				<Field label="New password again" error={mismatch ? "These don't match" : null}>
					<PasswordInput
						value={again}
						onChange={(e) => setAgain(e.target.value)}
						autoComplete="new-password"
					/>
				</Field>
				<div className="sm:col-span-2">
					<Button
						type="submit"
						variant="secondary"
						disabled={!current || next.length < PASSWORD_MIN || next !== again || change.isPending}
					>
						{change.isPending && <Spinner />} Change password
					</Button>
				</div>
			</form>
		</Section>
	);
}

function PasskeyRow({ p, onRename, onDelete }: { p: PasskeyInfo; onRename: () => void; onDelete: () => void }) {
	const elsewhere = p.rpId !== location.hostname;
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand-ink">
				<Fingerprint className="size-[18px]" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="truncate text-sm font-medium">{p.name}</span>
					{p.backedUp && (
						<Badge tone="info">
							<Cloud /> Synced
						</Badge>
					)}
					{elsewhere && <Badge>{p.rpId}</Badge>}
				</div>
				<div className="truncate text-xs text-fg-subtle">
					Added {timeAgo(p.createdAt)} · {p.lastUsedAt ? `last used ${timeAgo(p.lastUsedAt)}` : "never used"}
				</div>
			</div>
			<Button variant="ghost" size="icon-sm" aria-label={`Rename ${p.name}`} onClick={onRename}>
				<Pencil />
			</Button>
			<Button variant="danger-ghost" size="icon-sm" aria-label={`Remove ${p.name}`} onClick={onDelete}>
				<Trash2 />
			</Button>
		</div>
	);
}

function Passkeys({ status }: { status: AuthStatus }) {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: qk.passkeys, queryFn: api.auth.passkeys });
	const [renaming, setRenaming] = useState<PasskeyInfo | null>(null);
	const [name, setName] = useState("");
	const [deleting, setDeleting] = useState<PasskeyInfo | null>(null);
	const supported = passkeysSupported(status.passkeysAvailable);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.passkeys });
		void qc.invalidateQueries({ queryKey: qk.auth, exact: true });
	};
	const add = useMutation({
		mutationFn: () => registerPasskey(),
		onSuccess: (p) => {
			refresh();
			toast.success(`Added “${p.name}”`);
		},
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
	});
	const remove = useMutation({ mutationFn: (id: string) => api.auth.deletePasskey(id), onSuccess: refresh });

	return (
		<Section
			title="Passkeys"
			icon={<Fingerprint />}
			description="Sign in with Face ID, Touch ID, Windows Hello, your phone or a password manager."
			action={
				supported && (
					<Button variant="secondary" size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
						{add.isPending ? <Spinner /> : <Plus />} Add a passkey
					</Button>
				)
			}
		>
			{!supported && (
				<Callout tone="info" icon={<Info />} title="Passkeys need a secure address">
					Open Sekai over https (for example with Tailscale Serve) or on localhost to add one. Passkeys work
					on the address they were made on.
				</Callout>
			)}
			{list.isLoading ? (
				<Spinner />
			) : !list.data?.length ? (
				<EmptyState
					icon={<Fingerprint />}
					title="No passkeys yet"
					description="They're faster than a password and can't be phished."
					className="rounded-2xl border border-dashed border-border py-8"
				/>
			) : (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{list.data.map((p) => (
						<PasskeyRow
							key={p.id}
							p={p}
							onRename={() => {
								setName(p.name);
								setRenaming(p);
							}}
							onDelete={() => setDeleting(p)}
						/>
					))}
				</div>
			)}
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
						<Button variant="primary" disabled={!name.trim()} onClick={() => rename.mutate()}>
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
				open={deleting !== null}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Remove “${deleting?.name}”?`}
				description="You won't be able to sign in with it any more. Also delete it from the device or password manager that holds it."
				confirmLabel="Remove"
				danger
				onConfirm={() => deleting && remove.mutate(deleting.id)}
			/>
		</Section>
	);
}

function TwoFactor() {
	return (
		<Section
			title="Two-factor sign-in"
			icon={<ShieldCheck />}
			description="After your password, a code from your phone or email. A stolen password alone isn't enough."
		>
			<TwoFactorSettings />
		</Section>
	);
}

/** Google, GitHub, Discord or your own sign-in provider, linked to this account. */
function LinkedAccounts({ status }: { status: AuthStatus }) {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: ["auth", "identities"], queryFn: api.auth.identities });
	const [unlinking, setUnlinking] = useState<string | null>(null);
	const unlink = useMutation({
		mutationFn: (id: string) => api.auth.unlinkIdentity(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["auth", "identities"] }),
		onError: (err) => toast.error(err.message),
	});
	// Back from linking: say so once, and tidy the address.
	useEffect(() => {
		const q = new URLSearchParams(location.search);
		const error = q.get("sso_error");
		if (q.get("sso_linked") === "1") toast.success("Linked", { duration: 1500 });
		if (error) toast.error(error);
		if (error || q.has("sso_linked")) history.replaceState(null, "", location.pathname);
	}, []);
	if (!status.sso.length && !list.data?.length) return null;
	const linked = new Set(list.data?.map((i) => i.providerId));
	return (
		<Section title="Linked sign-ins" icon={<Link2 />} description="Sign in to Sekai with these accounts too.">
			<div className="divide-y divide-border rounded-2xl border border-border bg-card">
				{list.data?.map((i) => {
					const brand = ssoBrand(i.kind);
					return (
						<div key={i.id} className="flex items-center gap-3 px-4 py-3">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 [&_svg]:size-4.5">
								{brand ? <BrandGlyph brand={brand} size={18} /> : <KeyRound />}
							</span>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-medium">{i.providerName}</div>
								<div className="truncate text-xs text-fg-subtle">
									{i.email ?? "Linked"} ·{" "}
									{i.lastUsedAt ? `last used ${timeAgo(i.lastUsedAt)}` : "not used yet"}
								</div>
							</div>
							<Button variant="ghost" size="sm" onClick={() => setUnlinking(i.id)}>
								Unlink
							</Button>
						</div>
					);
				})}
				{status.sso
					.filter((p) => !linked.has(p.id))
					.map((p) => {
						const brand = ssoBrand(p.kind);
						return (
							<div key={p.id} className="flex items-center gap-3 px-4 py-3">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 [&_svg]:size-4.5">
									{brand ? <BrandGlyph brand={brand} size={18} /> : <KeyRound />}
								</span>
								<div className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() =>
										location.assign(
											api.auth.ssoStartUrl(p.id, { link: true, redirect: "/admin/account" }),
										)
									}
								>
									Link
								</Button>
							</div>
						);
					})}
			</div>
			<Confirm
				open={unlinking !== null}
				onOpenChange={(o) => !o && setUnlinking(null)}
				title="Unlink this sign-in?"
				description="You won't be able to sign in with it any more (you can link it again)."
				confirmLabel="Unlink"
				danger
				onConfirm={() => unlinking && unlink.mutate(unlinking)}
			/>
		</Section>
	);
}

function AccountBody() {
	const { data: status } = useAuth();
	if (!status?.user) return <Spinner />;
	return (
		<>
			<Profile user={status.user} />
			<Passkeys status={status} />
			<TwoFactor />
			<LinkedAccounts status={status} />
			<Password />
		</>
	);
}

export function AccountPanel() {
	const { data: status } = useAuth();
	const role = status?.access?.roleName;
	return (
		<SettingsPanel
			value="account"
			title="Account"
			description={role ? `Your sign-in and profile. Your role here: ${role}.` : "Your sign-in and profile."}
		>
			<AccountBody />
		</SettingsPanel>
	);
}
