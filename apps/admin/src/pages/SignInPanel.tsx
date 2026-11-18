import { api, BrandTile, cn, pluralize, qk, ssoBrand, useAuth } from "@sekai/client";
import {
	type EmailConfig,
	type SmsConfig,
	SSO_KINDS,
	type SsoKind,
	type SsoProvider,
	type SsoProviderInput,
} from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	Field,
	IconButton,
	Input,
	PasswordInput,
	Section,
	Segmented,
	SettingsPanel,
	Skeleton,
	Spinner,
	Switch,
	ToggleRow,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, KeyRound, Mail, MessageSquareText, Pencil, Plus, Send, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminError, CopyField, useLastNonNull } from "./PeoplePanel.tsx";

const SSO = ["admin", "sso"] as const;
const EMAIL = ["admin", "email"] as const;
const SMS = ["admin", "sms"] as const;

/** What the server sends back for a saved secret (sending it back keeps it). */
const MASKED = "••••••••";

const KINDS: Record<SsoKind, { label: string; where: ReactNode }> = {
	google: {
		label: "Google",
		where: (
			<>
				In the Google Cloud console: APIs &amp; Services → Credentials → Create credentials → OAuth client ID,
				type Web application.
			</>
		),
	},
	github: {
		label: "GitHub",
		where: <>On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.</>,
	},
	discord: {
		label: "Discord",
		where: <>In the Discord Developer Portal: your application → OAuth2. Copy its client ID and secret.</>,
	},
	oidc: {
		label: "OpenID Connect",
		where: (
			<>
				Your own sign-in server, like Authentik, Keycloak or Authelia: make an OAuth2 / OpenID Connect app for
				Sekai (a confidential client).
			</>
		),
	},
};

function SsoMark({ kind, size = 36 }: { kind: SsoKind; size?: number }) {
	return <BrandTile brand={ssoBrand(kind)} size={size} fallback={<KeyRound className="size-[18px]" />} />;
}

// ---------------------------------------------------------------- single sign-on

type SsoDraft = {
	kind: SsoKind;
	name: string;
	enabled: boolean;
	clientId: string;
	/** Empty: keep the saved one. */
	clientSecret: string;
	issuer: string;
	scopes: string;
	linkByEmail: boolean;
};

const draftOf = (p: SsoProvider | null, kind: SsoKind = "google"): SsoDraft => ({
	kind: p?.kind ?? kind,
	name: p?.name ?? KINDS[kind].label,
	enabled: p?.enabled ?? true,
	clientId: p?.clientId ?? "",
	clientSecret: "",
	issuer: p?.issuer ?? "",
	scopes: p?.scopes ?? "",
	linkByEmail: p?.linkByEmail ?? true,
});

function SsoDialog({
	open,
	provider: given,
	onClose,
}: {
	open: boolean;
	/** null: adding one. */
	provider: SsoProvider | null;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	// After adding, the dialog shows the new provider (its redirect URL is the one more step).
	const [created, setCreated] = useState<SsoProvider | null>(null);
	const provider = given ?? created;
	const [draft, setDraft] = useState<SsoDraft>(() => draftOf(given));
	// biome-ignore lint/correctness/useExhaustiveDependencies: start over each time it opens (not on every refetch)
	useEffect(() => {
		if (!open) return;
		setCreated(null);
		setDraft(draftOf(given));
	}, [open, given?.id]);
	const set = (patch: Partial<SsoDraft>) => setDraft((d) => ({ ...d, ...patch }));
	const oidc = draft.kind === "oidc";
	const issuerBad = oidc && draft.issuer.trim() !== "" && !/^https?:\/\/\S+$/.test(draft.issuer.trim());
	const ready =
		draft.name.trim() &&
		draft.clientId.trim() &&
		(provider || draft.clientSecret.trim()) &&
		(!oidc || (draft.issuer.trim() && !issuerBad));

	const save = useMutation({
		mutationFn: () => {
			const body: SsoProviderInput = {
				kind: draft.kind,
				name: draft.name.trim(),
				enabled: draft.enabled,
				clientId: draft.clientId.trim(),
				clientSecret: draft.clientSecret.trim() || MASKED,
				issuer: oidc ? draft.issuer.trim() : null,
				scopes: draft.scopes.trim(),
				linkByEmail: draft.linkByEmail,
			};
			return provider ? api.admin.updateSso(provider.id, body) : api.admin.createSso(body);
		},
		onSuccess: (p) => {
			void qc.invalidateQueries({ queryKey: SSO });
			if (provider) {
				toast.success("Saved", { duration: 1200 });
				onClose();
			} else {
				setCreated(p);
				setDraft(draftOf(p));
			}
		},
		onError: adminError,
	});

	const justAdded = created !== null && !given;
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => !o && onClose()}
			icon={<KeyRound />}
			title={justAdded ? "One more step" : provider ? `Edit ${provider.name}` : "Add single sign-on"}
			description={
				justAdded
					? `Paste this redirect URL into your ${KINDS[draft.kind].label} app's settings, then ${draft.name} shows on the sign-in page.`
					: "People sign in with an account they already have. Sekai never makes accounts from a sign-in: add the person in People first."
			}
			footer={
				justAdded ? (
					<Button variant="primary" onClick={onClose}>
						Done
					</Button>
				) : (
					<>
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button variant="primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
							{save.isPending && <Spinner className="text-primary-foreground" />}{" "}
							{provider ? "Save" : "Add"}
						</Button>
					</>
				)
			}
		>
			{justAdded && created ? (
				<Field label="Redirect URL" hint="Also called the callback URL or authorized redirect URI.">
					<CopyField value={created.callbackUrl} label="redirect URL" />
				</Field>
			) : (
				<div className="flex flex-col gap-4">
					{!provider && (
						<div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2">
							{SSO_KINDS.map((k) => (
								// biome-ignore lint/a11y/useSemanticElements: choice cards with logos; ARIA radios on buttons are valid
								<button
									key={k}
									type="button"
									role="radio"
									aria-checked={draft.kind === k}
									onClick={() =>
										set({
											kind: k,
											name:
												!draft.name.trim() || draft.name === KINDS[draft.kind].label
													? KINDS[k].label
													: draft.name,
										})
									}
									className={cn(
										"flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 coarse:py-3",
										draft.kind === k
											? "border-brand/50 bg-brand/6 font-medium"
											: "border-border hover:bg-surface-2/60",
									)}
								>
									<SsoMark kind={k} size={28} />
									<span className="min-w-0 truncate">{KINDS[k].label}</span>
								</button>
							))}
						</div>
					)}
					<Callout tone="neutral" icon={<Info />}>
						{KINDS[draft.kind].where}
					</Callout>
					{provider && (
						<Field label="Redirect URL" hint="Paste this into the provider's app as the redirect URL.">
							<CopyField value={provider.callbackUrl} label="redirect URL" />
						</Field>
					)}
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name on the sign-in button" className="sm:col-span-2">
							<Input
								value={draft.name}
								onChange={(e) => set({ name: e.target.value })}
								placeholder={KINDS[draft.kind].label}
								maxLength={60}
							/>
						</Field>
						{oidc && (
							<Field
								label="Issuer URL"
								className="sm:col-span-2"
								error={issuerBad ? "Use the full address, starting with https://" : null}
								hint="Like https://auth.example.com/application/o/sekai/ (Authentik) or https://sso.example.com/realms/home (Keycloak)."
							>
								<Input
									type="url"
									value={draft.issuer}
									onChange={(e) => set({ issuer: e.target.value })}
									placeholder="https://auth.example.com/application/o/sekai/"
									autoCapitalize="none"
									spellCheck={false}
								/>
							</Field>
						)}
						<Field label="Client ID">
							<Input
								value={draft.clientId}
								onChange={(e) => set({ clientId: e.target.value })}
								autoCapitalize="none"
								autoComplete="off"
								spellCheck={false}
							/>
						</Field>
						<Field
							label="Client secret"
							hint={provider ? "Saved. Type a new one to replace it." : undefined}
						>
							<PasswordInput
								value={draft.clientSecret}
								onChange={(e) => set({ clientSecret: e.target.value })}
								placeholder={provider ? MASKED : undefined}
								autoComplete="new-password"
							/>
						</Field>
						<Field
							label="Extra scopes"
							className="sm:col-span-2"
							hint="Optional, separated by spaces. Sekai always asks for the ones it needs."
						>
							<Input
								value={draft.scopes}
								onChange={(e) => set({ scopes: e.target.value })}
								autoCapitalize="none"
								spellCheck={false}
							/>
						</Field>
					</div>
					<div className="divide-y divide-border rounded-2xl border border-border">
						<ToggleRow
							className="px-4 py-3"
							title="Match by email"
							description="Sign in people whose verified email matches their Sekai account. Off: they link it themselves in Account first."
							checked={draft.linkByEmail}
							onCheckedChange={(linkByEmail) => set({ linkByEmail })}
						/>
						<ToggleRow
							className="px-4 py-3"
							title="On the sign-in page"
							description="Turn it off to hide the button for a while without losing the setup."
							checked={draft.enabled}
							onCheckedChange={(enabled) => set({ enabled })}
						/>
					</div>
				</div>
			)}
		</Dialog>
	);
}

function SsoRow({ p, onEdit, onDelete }: { p: SsoProvider; onEdit: () => void; onDelete: () => void }) {
	const qc = useQueryClient();
	const toggle = useMutation({
		mutationFn: (enabled: boolean) => api.admin.updateSso(p.id, { enabled }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: SSO }),
		onError: adminError,
	});
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<SsoMark kind={p.kind} />
			<button
				type="button"
				onClick={onEdit}
				className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="truncate text-sm font-medium">{p.name}</span>
					{!p.enabled && <Badge>Hidden</Badge>}
				</div>
				<div className="truncate text-xs text-fg-subtle">
					{KINDS[p.kind].label} ·{" "}
					{p.linked ? `${pluralize(p.linked, "account")} linked` : "nobody linked yet"}
				</div>
			</button>
			<div className="flex shrink-0 items-center gap-1">
				<IconButton label={`Edit ${p.name}`} size="icon-sm" onClick={onEdit}>
					<Pencil />
				</IconButton>
				<IconButton label={`Remove ${p.name}`} size="icon-sm" variant="danger-ghost" onClick={onDelete}>
					<Trash2 />
				</IconButton>
				{toggle.isPending ? (
					<Spinner className="mx-2" />
				) : (
					<Switch
						checked={p.enabled}
						label={`Show ${p.name} on the sign-in page`}
						onCheckedChange={(on) => toggle.mutate(on)}
					/>
				)}
			</div>
		</div>
	);
}

function SingleSignOn() {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: SSO, queryFn: api.admin.sso });
	const [adding, setAdding] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const [removingId, setRemovingId] = useState<string | null>(null);
	const providers = list.data ?? [];
	const editing = useLastNonNull(providers.find((p) => p.id === editId) ?? null);
	const removing = useLastNonNull(providers.find((p) => p.id === removingId) ?? null);
	const remove = useMutation({
		mutationFn: (id: string) => api.admin.deleteSso(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: SSO }),
		onError: adminError,
	});
	return (
		<Section
			title="Single sign-on"
			description="Sign in with Google, GitHub, Discord or your own provider. Sekai never makes accounts from a sign-in: add the person in People first."
			action={
				<Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
					<Plus /> Add a provider
				</Button>
			}
		>
			{list.isLoading ? (
				<Skeleton className="h-16 rounded-2xl" />
			) : list.error ? (
				<Callout tone="danger" icon={<TriangleAlert />}>
					{list.error.message}
				</Callout>
			) : providers.length === 0 ? (
				<button
					type="button"
					onClick={() => setAdding(true)}
					className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-4 text-left transition-colors hover:bg-surface-2/50"
				>
					<span className="flex -space-x-2">
						{(["google", "github", "discord"] as const).map((k) => (
							<SsoMark key={k} kind={k} size={32} />
						))}
					</span>
					<span className="min-w-0">
						<span className="block text-sm font-medium">No providers yet</span>
						<span className="block text-xs text-fg-subtle">
							People sign in with a username and password (and passkeys).
						</span>
					</span>
				</button>
			) : (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{providers.map((p) => (
						<SsoRow key={p.id} p={p} onEdit={() => setEditId(p.id)} onDelete={() => setRemovingId(p.id)} />
					))}
				</div>
			)}
			<SsoDialog open={adding} provider={null} onClose={() => setAdding(false)} />
			<SsoDialog open={editId !== null} provider={editing} onClose={() => setEditId(null)} />
			<Confirm
				open={removingId !== null}
				onOpenChange={(o) => !o && setRemovingId(null)}
				title={`Remove ${removing?.name ?? "this provider"}?`}
				description={
					removing?.linked
						? `${pluralize(removing.linked, "person", "people")} can't sign in with it any more. Their accounts stay, with their other ways to sign in.`
						: "Its button leaves the sign-in page."
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => removing && remove.mutate(removing.id)}
			/>
		</Section>
	);
}

// ---------------------------------------------------------------- email and texts

/** A form over a saved config: changes stay a draft until saved, so live refreshes don't wipe what you type. */
function useConfigDraft<T extends object>(data: T | undefined) {
	const [draft, setDraft] = useState<Partial<T>>({});
	const value = { ...(data ?? {}), ...draft } as T;
	return {
		value,
		draft,
		dirty: Object.keys(draft).length > 0,
		set: (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch })),
		reset: () => setDraft({}),
	};
}

/** Secrets typed and then cleared again keep the saved one (an empty box means "unchanged" here). */
function withoutBlank<T extends object>(draft: Partial<T>, secrets: (keyof T)[]): Partial<T> {
	const out = { ...draft };
	for (const k of secrets) if (out[k] === "") delete out[k];
	return out;
}

function TestSend({
	label,
	placeholder,
	type,
	disabled,
	disabledHint,
	send,
}: {
	label: string;
	placeholder: string;
	type: "email" | "tel";
	disabled: boolean;
	disabledHint: string;
	send: (to: string) => Promise<unknown>;
}) {
	const [to, setTo] = useState("");
	const test = useMutation({
		mutationFn: () => send(to.trim()),
		onSuccess: () => toast.success("Sent. Check that it arrived."),
		onError: adminError,
	});
	return (
		<Field label={label} hint={disabled ? disabledHint : "Uses the saved settings."}>
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (to.trim() && !disabled) test.mutate();
				}}
			>
				<Input
					type={type}
					inputMode={type}
					value={to}
					onChange={(e) => setTo(e.target.value)}
					placeholder={placeholder}
					className="min-w-0 flex-1"
					autoComplete="off"
				/>
				<Button type="submit" variant="secondary" disabled={disabled || !to.trim() || test.isPending}>
					{test.isPending ? <Spinner /> : <Send />} Send a test
				</Button>
			</form>
		</Field>
	);
}

function SaveBar({
	dirty,
	pending,
	invalid,
	onSave,
	onReset,
}: {
	dirty: boolean;
	pending: boolean;
	invalid?: boolean;
	onSave: () => void;
	onReset: () => void;
}) {
	if (!dirty) return null;
	return (
		<div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
			<Button variant="ghost" onClick={onReset} disabled={pending}>
				Undo changes
			</Button>
			<Button variant="primary" onClick={onSave} disabled={pending || invalid}>
				{pending && <Spinner className="text-primary-foreground" />} Save
			</Button>
		</div>
	);
}

function EmailSection() {
	const qc = useQueryClient();
	const { data: auth } = useAuth();
	const query = useQuery({ queryKey: EMAIL, queryFn: api.admin.email });
	const form = useConfigDraft<EmailConfig>(query.data);
	const c = form.value;
	const save = useMutation({
		mutationFn: () => api.admin.saveEmail(withoutBlank(form.draft, ["password"])),
		onSuccess: (next) => {
			qc.setQueryData(EMAIL, next);
			void qc.invalidateQueries({ queryKey: qk.auth, exact: true });
			form.reset();
			toast.success("Saved", { duration: 1200 });
		},
		onError: adminError,
	});
	const saved = query.data;
	const ready = Boolean(saved?.enabled && saved.host && saved.from);
	const portBad = !Number.isInteger(c.port) || c.port < 1 || c.port > 65535;
	return (
		<Section
			title="Email"
			description="For sign-in codes, invite links and “Forgot your password?” links. Any SMTP server works: your email provider's, or a service like Resend, Postmark or Amazon SES."
		>
			{query.isLoading || !saved ? (
				<Skeleton className="h-48 rounded-2xl" />
			) : (
				<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
					<ToggleRow
						icon={<Mail />}
						title="Send email"
						description={
							ready
								? "On. Sekai sends from the address below."
								: "Off until it's on and has a server and a From address."
						}
						checked={c.enabled}
						onCheckedChange={(enabled) => form.set({ enabled })}
					/>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="SMTP server">
							<Input
								value={c.host}
								onChange={(e) => form.set({ host: e.target.value })}
								placeholder="smtp.example.com"
								autoCapitalize="none"
								spellCheck={false}
							/>
						</Field>
						<Field label="Port" error={portBad ? "A port from 1 to 65535" : null}>
							<Input
								type="number"
								inputMode="numeric"
								min={1}
								max={65535}
								value={Number.isNaN(c.port) ? "" : c.port}
								onChange={(e) =>
									form.set({ port: e.target.value === "" ? Number.NaN : Number(e.target.value) })
								}
							/>
						</Field>
						<Field label="Username">
							<Input
								value={c.username}
								onChange={(e) => form.set({ username: e.target.value })}
								autoCapitalize="none"
								autoComplete="off"
								spellCheck={false}
							/>
						</Field>
						<Field
							label="Password"
							hint={saved.password === MASKED ? "Saved. Type a new one to replace it." : undefined}
						>
							<PasswordInput
								value={form.draft.password ?? ""}
								onChange={(e) => form.set({ password: e.target.value })}
								placeholder={saved.password === MASKED ? MASKED : undefined}
								autoComplete="new-password"
							/>
						</Field>
						<Field
							label="From"
							className="sm:col-span-2"
							hint="Who emails come from. Use an address your server may send as."
						>
							<Input
								value={c.from}
								onChange={(e) => form.set({ from: e.target.value })}
								placeholder="Sekai <sekai@example.com>"
							/>
						</Field>
					</div>
					<ToggleRow
						title="TLS from the start"
						description="Usually port 465. Off: Sekai switches to TLS when the server offers it (STARTTLS, usually port 587)."
						checked={c.secure}
						onCheckedChange={(secure) =>
							form.set({
								secure,
								...(c.port === 465 || c.port === 587 ? { port: secure ? 465 : 587 } : {}),
							})
						}
					/>
					<SaveBar
						dirty={form.dirty}
						pending={save.isPending}
						invalid={portBad}
						onSave={() => save.mutate()}
						onReset={form.reset}
					/>
					<div className="border-t border-border pt-4">
						<TestSend
							label="Send a test email"
							type="email"
							placeholder="you@example.com"
							disabled={form.dirty || !ready}
							disabledHint={
								form.dirty ? "Save your changes first." : "Turn email on and fill in the server first."
							}
							send={api.admin.testEmail}
						/>
					</div>
				</div>
			)}
			{ready && auth && !auth.passwordReset && (
				<Callout tone="info" icon={<Info />}>
					“Forgot your password?” stays hidden until{" "}
					<code className="font-mono text-xs">SEKAI_PUBLIC_URL</code> is set on the server, so emailed links
					point to the right address.
				</Callout>
			)}
		</Section>
	);
}

function SmsSection() {
	const qc = useQueryClient();
	const query = useQuery({ queryKey: SMS, queryFn: api.admin.sms });
	const form = useConfigDraft<SmsConfig>(query.data);
	const c = form.value;
	const save = useMutation({
		mutationFn: () => api.admin.saveSms(withoutBlank(form.draft, ["authToken", "webhookSecret"])),
		onSuccess: (next) => {
			qc.setQueryData(SMS, next);
			form.reset();
			toast.success("Saved", { duration: 1200 });
		},
		onError: adminError,
	});
	const saved = query.data;
	const ready = Boolean(
		saved?.enabled &&
			(saved.provider === "twilio" ? saved.accountSid && saved.authToken && saved.from : saved.webhookUrl),
	);
	const twilio = c.provider === "twilio";
	return (
		<Section
			title="Text messages"
			description="For sign-in codes by text, for people who add their phone number. Use Twilio, or any other service through a webhook."
		>
			{query.isLoading || !saved ? (
				<Skeleton className="h-48 rounded-2xl" />
			) : (
				<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
					<ToggleRow
						icon={<MessageSquareText />}
						title="Send texts"
						description={ready ? "On." : "Off until it's on and set up below."}
						checked={c.enabled}
						onCheckedChange={(enabled) => form.set({ enabled })}
					/>
					<Segmented
						value={c.provider}
						onValueChange={(provider) => form.set({ provider })}
						options={[
							{ value: "twilio", label: "Twilio" },
							{ value: "webhook", label: "Webhook" },
						]}
						className="self-start"
					/>
					{twilio ? (
						<div className="grid gap-4 sm:grid-cols-2">
							<Field label="Account SID">
								<Input
									value={c.accountSid}
									onChange={(e) => form.set({ accountSid: e.target.value })}
									placeholder="AC…"
									autoCapitalize="none"
									autoComplete="off"
									spellCheck={false}
								/>
							</Field>
							<Field
								label="Auth token"
								hint={saved.authToken === MASKED ? "Saved. Type a new one to replace it." : undefined}
							>
								<PasswordInput
									value={form.draft.authToken ?? ""}
									onChange={(e) => form.set({ authToken: e.target.value })}
									placeholder={saved.authToken === MASKED ? MASKED : undefined}
									autoComplete="new-password"
								/>
							</Field>
							<Field
								label="From"
								className="sm:col-span-2"
								hint="A Twilio number with its country code, or a Messaging Service SID (MG…)."
							>
								<Input
									value={c.from}
									onChange={(e) => form.set({ from: e.target.value })}
									placeholder="+15551234567"
									autoCapitalize="none"
									spellCheck={false}
								/>
							</Field>
						</div>
					) : (
						<div className="grid gap-4 sm:grid-cols-2">
							<Field label="Webhook URL" className="sm:col-span-2">
								<Input
									type="url"
									value={c.webhookUrl}
									onChange={(e) => form.set({ webhookUrl: e.target.value })}
									placeholder="https://example.com/send-text"
									autoCapitalize="none"
									spellCheck={false}
								/>
							</Field>
							<Field
								label="Secret"
								className="sm:col-span-2"
								hint={
									saved.webhookSecret === MASKED
										? "Saved. Type a new one to replace it."
										: "Optional, but recommended: your service checks the signature with it."
								}
							>
								<PasswordInput
									value={form.draft.webhookSecret ?? ""}
									onChange={(e) => form.set({ webhookSecret: e.target.value })}
									placeholder={saved.webhookSecret === MASKED ? MASKED : undefined}
									autoComplete="new-password"
								/>
							</Field>
							<div className="rounded-xl bg-muted px-3.5 py-3 text-xs leading-5 text-fg-muted sm:col-span-2">
								Sekai POSTs{" "}
								<code className="font-mono">{'{"to": "+15551234567", "message": "…"}'}</code> as JSON,
								with an <code className="font-mono">X-Sekai-Signature</code> header: the hex HMAC-SHA256
								of the body, keyed with the secret.
							</div>
						</div>
					)}
					<SaveBar
						dirty={form.dirty}
						pending={save.isPending}
						onSave={() => save.mutate()}
						onReset={form.reset}
					/>
					<div className="border-t border-border pt-4">
						<TestSend
							label="Send a test text"
							type="tel"
							placeholder="+15551234567"
							disabled={form.dirty || !ready}
							disabledHint={
								form.dirty ? "Save your changes first." : "Turn texts on and fill them in first."
							}
							send={api.admin.testSms}
						/>
					</div>
				</div>
			)}
		</Section>
	);
}

export function SignInPanel() {
	return (
		<SettingsPanel
			value="signin"
			title="Sign-in options"
			description="Besides usernames, passwords and passkeys: single sign-on, and the email and texts that carry sign-in codes and invites."
		>
			<SingleSignOn />
			<EmailSection />
			<SmsSection />
		</SettingsPanel>
	);
}
