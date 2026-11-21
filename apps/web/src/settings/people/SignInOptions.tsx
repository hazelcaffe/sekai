import { api, BrandTile, pluralize, qk, ssoBrand, useAuth } from "@sekai/client";
import {
	type EmailConfig,
	type SmsConfig,
	SSO_KINDS,
	type SsoKind,
	type SsoProvider,
	type SsoProviderInput,
} from "@sekai/shared";
import {
	Button,
	Callout,
	Confirm,
	CopyField,
	EmptyState,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Page,
	PasswordInput,
	Row,
	Section,
	Segmented,
	SkeletonRows,
	Switch,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, KeyRound, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useGoBack } from "../../lib/back.ts";
import { actionError, cancelledReauth, saveForm, useAfterSave } from "../../lib/forms.ts";
import { sectionPath } from "../registry.tsx";
import type { SettingsSectionProps } from "../section.ts";
import { EMAIL, SSO } from "./shared.tsx";

const SMS = ["admin", "sms"] as const;
const MASKED = "••••••••";

const KINDS: Record<SsoKind, { label: string; name: string; where: string }> = {
	google: {
		label: "Google",
		name: "Google",
		where: "In Google Cloud: APIs & Services → Credentials → OAuth client ID, type Web application.",
	},
	github: {
		label: "GitHub",
		name: "GitHub",
		where: "On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.",
	},
	discord: {
		label: "Discord",
		name: "Discord",
		where: "In the Discord Developer Portal: your application → OAuth2. Copy its client ID and secret.",
	},
	oidc: {
		label: "Your own provider",
		// Its button needs a real name (Authentik, Keycloak…): "Continue with Your own" wouldn't do.
		name: "",
		where: "An OpenID Connect server, like Authentik, Keycloak or Authelia. Make a confidential client for Sekai.",
	},
};

function SsoMark({ kind }: { kind: SsoKind }) {
	return <BrandTile brand={ssoBrand(kind)} size={32} fallback={<KeyRound className="size-4" />} />;
}

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
	name: p?.name ?? KINDS[kind].name,
	enabled: p?.enabled ?? true,
	clientId: p?.clientId ?? "",
	clientSecret: "",
	issuer: p?.issuer ?? "",
	scopes: p?.scopes ?? "",
	linkByEmail: p?.linkByEmail ?? true,
});

function ProviderPage({ id }: { id: string }) {
	const goBack = useGoBack();
	const navigate = useNavigate();
	const afterSave = useAfterSave();
	const qc = useQueryClient();
	const list = useQuery({ queryKey: SSO, queryFn: api.admin.sso });
	// Just added on this visit: the page stays, with its redirect URL as the one more step.
	const [created, setCreated] = useState<SsoProvider | null>(null);
	const [removing, setRemoving] = useState(false);
	const given = id === "new" ? null : (list.data?.find((p) => p.id === id) ?? null);
	const provider = given ?? created;
	const form = useFormValues(draftOf(provider));
	const draft = form.values;
	const set = (patch: Partial<SsoDraft>) => form.setValues((d) => ({ ...d, ...patch }));
	const oidc = draft.kind === "oidc";
	const issuerBad = oidc && draft.issuer.trim() !== "" && !/^https?:\/\/\S+$/.test(draft.issuer.trim());
	const ready = Boolean(
		draft.name.trim() &&
			draft.clientId.trim() &&
			(provider || draft.clientSecret.trim()) &&
			(!oidc || (draft.issuer.trim() && !issuerBad)),
	);
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
			qc.setQueryData<SsoProvider[]>(SSO, (l) => (l ? [...l.filter((x) => x.id !== p.id), p] : l));
			void qc.invalidateQueries({ queryKey: SSO });
			form.reset(draftOf(p));
			if (!provider) {
				setCreated(p);
				afterSave(() => navigate(sectionPath("sign-in-options", p.id), { replace: true }));
			}
		},
		onError: () => {},
	});
	const remove = useMutation({
		mutationFn: () => api.admin.deleteSso(provider?.id ?? ""),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: SSO });
			goBack("/settings/sign-in-options");
		},
		onError: actionError,
	});
	const back = { label: "Sign-in options", onClick: () => goBack("/settings/sign-in-options") };
	if (list.isLoading && id !== "new") {
		return (
			<Page back={back} title="Provider">
				<SkeletonRows count={3} leading={false} />
			</Page>
		);
	}
	if (list.isError && id !== "new") {
		return (
			<Page back={back} title="Provider">
				<ErrorState error={list.error} onRetry={() => void list.refetch()} />
			</Page>
		);
	}
	if (id !== "new" && !provider) {
		return (
			<Page back={back} title="Provider">
				<EmptyState icon={<KeyRound />} title="This provider isn't here." />
			</Page>
		);
	}
	const kind = KINDS[draft.kind];
	return (
		<Page
			back={back}
			title={provider ? provider.name : "Add a provider"}
			description="People sign in with an account they already have. Add them in People first."
		>
			{created && (
				<Callout
					tone="success"
					icon={<Info />}
					title="One more step"
					action={
						<Button variant="secondary" size="sm" onClick={back.onClick}>
							Done
						</Button>
					}
				>
					Paste the redirect URL below into the {kind.label} app. Then its button works on the sign-in page.
				</Callout>
			)}
			<FormGroup
				dirty={form.dirty}
				submitLabel={provider ? "Save" : "Add"}
				disabled={!ready}
				onCancel={() => form.reset()}
				onSubmit={() => saveForm(save.mutateAsync)}
			>
				{!provider && (
					<List label="Provider">
						{SSO_KINDS.map((k) => (
							<Row
								key={k}
								leading={<SsoMark kind={k} />}
								title={KINDS[k].label}
								selected={draft.kind === k}
								onClick={() =>
									set({
										kind: k,
										name:
											!draft.name.trim() || draft.name === KINDS[draft.kind].name
												? KINDS[k].name
												: draft.name,
									})
								}
							/>
						))}
					</List>
				)}
				{provider && (
					<Field label="Redirect URL" hint="Paste this into the provider's app.">
						<CopyField value={provider.callbackUrl} label="redirect URL" />
					</Field>
				)}
				<Fold title="Learn more" variant="link">
					{kind.where} The redirect URL is also called the callback URL.
				</Fold>
				<Field label="Name on the sign-in button">
					<Input
						value={draft.name}
						onChange={(e) => set({ name: e.target.value })}
						placeholder={kind.name ? kind.name : "e.g. Authentik"}
						maxLength={60}
					/>
				</Field>
				{oidc && (
					<Field
						label="Sign-in server"
						error={issuerBad ? "Start with https://" : null}
						hint="Its OpenID Connect address (the issuer URL)."
					>
						<Input
							type="url"
							value={draft.issuer}
							onChange={(e) => set({ issuer: e.target.value })}
							placeholder="e.g. https://auth.example.com/application/o/sekai/"
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
				)}
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Client ID">
						<Input
							value={draft.clientId}
							onChange={(e) => set({ clientId: e.target.value })}
							autoCapitalize="none"
							autoComplete="off"
							spellCheck={false}
						/>
					</Field>
					<Field label="Client secret" hint={provider ? "Saved. Type a new one to replace it." : undefined}>
						<PasswordInput
							value={draft.clientSecret}
							onChange={(e) => set({ clientSecret: e.target.value })}
							placeholder={provider ? MASKED : undefined}
							autoComplete="new-password"
						/>
					</Field>
				</div>
				<List>
					<ToggleRow
						title="Match by email"
						description="Sign in people whose verified email matches their account here."
						checked={draft.linkByEmail}
						onCheckedChange={(linkByEmail) => set({ linkByEmail })}
					/>
					<ToggleRow
						title="On the sign-in page"
						description="Turn it off to hide the button without losing the setup."
						checked={draft.enabled}
						onCheckedChange={(enabled) => set({ enabled })}
					/>
				</List>
				<Fold title="Advanced" summary={draft.scopes.trim() ? "Extra scopes" : undefined}>
					<Field
						label="Extra scopes"
						optional
						hint="Separated by spaces. Sekai always asks for the ones it needs."
					>
						<Input
							value={draft.scopes}
							onChange={(e) => set({ scopes: e.target.value })}
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
				</Fold>
			</FormGroup>
			{provider && (
				<div>
					<Button variant="danger-ghost" onClick={() => setRemoving(true)}>
						<Trash2 /> Remove provider
					</Button>
				</div>
			)}
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${provider?.name ?? "this provider"}?`}
				description={
					provider?.linked
						? `${pluralize(provider.linked, "person", "people")} can't sign in with it any more. Their accounts stay.`
						: "Its button leaves the sign-in page."
				}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</Page>
	);
}

function SingleSignOn() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const list = useQuery({ queryKey: SSO, queryFn: api.admin.sso });
	const providers = list.data ?? [];
	const toggle = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.admin.updateSso(id, { enabled }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: SSO }),
		onError: actionError,
	});
	const add = () => navigate(sectionPath("sign-in-options", "new"));
	return (
		<Section
			title="Single sign-on"
			description="Google, GitHub, Discord or your own provider."
			action={
				providers.length > 0 ? (
					<Button variant="secondary" size="sm" onClick={add}>
						<Plus /> Add
					</Button>
				) : undefined
			}
		>
			{list.isLoading ? (
				<SkeletonRows count={2} />
			) : list.isError ? (
				<ErrorState size="sm" error={list.error} onRetry={() => void list.refetch()} />
			) : providers.length === 0 ? (
				<EmptyState
					size="sm"
					icon={<KeyRound />}
					title="No providers yet."
					description="People sign in with a username and password."
					action={
						<Button variant="secondary" onClick={add}>
							Add a provider
						</Button>
					}
				/>
			) : (
				<List>
					{providers.map((p) => (
						<Row
							key={p.id}
							leading={<SsoMark kind={p.kind} />}
							title={p.name}
							subtitle={[
								KINDS[p.kind].label,
								p.linked ? `${pluralize(p.linked, "account")} linked` : "nobody linked yet",
								!p.enabled && "hidden",
							]
								.filter(Boolean)
								.join(" · ")}
							href={sectionPath("sign-in-options", p.id)}
							trailing={
								<Switch
									checked={p.enabled}
									label={`Show ${p.name} on the sign-in page`}
									disabled={toggle.isPending}
									onCheckedChange={(enabled) => toggle.mutate({ id: p.id, enabled })}
								/>
							}
						/>
					))}
				</List>
			)}
		</Section>
	);
}

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
	const [error, setError] = useState<string | null>(null);
	const test = useMutation({
		mutationFn: () => send(to.trim()),
		onSuccess: () => {
			setError(null);
			toast.success("Sent. Check that it arrived.");
		},
		onError: (err) => setError(cancelledReauth(err) ? null : errorMessage(err)),
	});
	return (
		<Field label={label} hint={disabled ? disabledHint : "Uses the saved settings."} error={error}>
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
				<Button type="submit" variant="secondary" disabled={disabled || !to.trim()} loading={test.isPending}>
					<Send /> Send a test
				</Button>
			</form>
		</Field>
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
		},
		onError: () => {},
	});
	const saved = query.data;
	const ready = Boolean(saved?.enabled && saved.host && saved.from);
	const portBad = !Number.isInteger(c.port) || c.port < 1 || c.port > 65535;
	const title = "Email";
	const description = "Sign-in codes, invite links and password resets.";
	if (!saved) {
		return (
			<Section title={title} description={description}>
				{query.isError ? (
					<ErrorState size="sm" error={query.error} onRetry={() => void query.refetch()} />
				) : (
					<SkeletonRows count={3} leading={false} />
				)}
			</Section>
		);
	}
	return (
		<Section title={title} description={description}>
			<FormGroup
				dirty={form.dirty}
				disabled={portBad}
				onCancel={form.reset}
				onSubmit={() => saveForm(save.mutateAsync)}
			>
				<List>
					<ToggleRow
						title="Send email"
						description={
							ready ? "On. Sekai sends from the address below." : "Needs a server and a From address."
						}
						checked={c.enabled}
						onCheckedChange={(enabled) => form.set({ enabled })}
					/>
				</List>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Server" hint="Your email provider's outgoing server.">
						<Input
							value={c.host}
							onChange={(e) => form.set({ host: e.target.value })}
							placeholder="smtp.example.com"
							autoCapitalize="none"
							spellCheck={false}
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
					<Field label="From" hint="An address this server may send as.">
						<Input
							value={c.from}
							onChange={(e) => form.set({ from: e.target.value })}
							placeholder="Sekai <sekai@example.com>"
						/>
					</Field>
				</div>
				<Fold title="Advanced" summary={c.secure ? "Encrypted from the start" : `Port ${c.port || "…"}`}>
					<div className="flex flex-col gap-4 pt-2">
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
						<List>
							<ToggleRow
								title="Encrypt from the start"
								description="Usually port 465. Off uses the server's own upgrade, usually port 587."
								checked={c.secure}
								onCheckedChange={(secure) =>
									form.set({
										secure,
										...(c.port === 465 || c.port === 587 ? { port: secure ? 465 : 587 } : {}),
									})
								}
							/>
						</List>
					</div>
				</Fold>
			</FormGroup>
			<TestSend
				label="Send a test email"
				type="email"
				placeholder="you@example.com"
				disabled={form.dirty || !ready}
				disabledHint={form.dirty ? "Save your changes first." : "Turn email on and fill in the server first."}
				send={api.admin.testEmail}
			/>
			{ready && auth && !auth.passwordReset && (
				<Callout tone="info" icon={<Info />}>
					Password reset links stay hidden until the server's public address is set, so emailed links point to
					the right place.
					<Fold title="Learn more" variant="link">
						Set <code className="font-mono">SEKAI_PUBLIC_URL</code> on the server.
					</Fold>
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
		},
		onError: () => {},
	});
	const saved = query.data;
	const ready = Boolean(
		saved?.enabled &&
			(saved.provider === "twilio" ? saved.accountSid && saved.authToken && saved.from : saved.webhookUrl),
	);
	const twilio = c.provider === "twilio";
	const title = "Text messages";
	const description = "Sign-in codes by text, for people who add a phone number.";
	if (!saved) {
		return (
			<Section title={title} description={description}>
				{query.isError ? (
					<ErrorState size="sm" error={query.error} onRetry={() => void query.refetch()} />
				) : (
					<SkeletonRows count={3} leading={false} />
				)}
			</Section>
		);
	}
	return (
		<Section title={title} description={description}>
			<FormGroup dirty={form.dirty} onCancel={form.reset} onSubmit={() => saveForm(save.mutateAsync)}>
				<List>
					<ToggleRow
						title="Send texts"
						description={ready ? "On." : "Off until it's set up below."}
						checked={c.enabled}
						onCheckedChange={(enabled) => form.set({ enabled })}
					/>
				</List>
				<Segmented
					value={c.provider}
					onValueChange={(provider) => form.set({ provider })}
					label="How texts are sent"
					options={[
						{ value: "twilio", label: "Twilio" },
						{ value: "webhook", label: "Your service" },
					]}
				/>
				{twilio ? (
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Account ID" hint="In Twilio this is the Account SID. It starts with AC.">
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
							label="Token"
							hint={
								saved.authToken === MASKED
									? "Saved. Type a new one to replace it."
									: "Twilio's auth token."
							}
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
							hint="A Twilio number, or a messaging service (MG…)."
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
					<Field label="Address" hint="Where Sekai sends each text.">
						<Input
							type="url"
							value={c.webhookUrl}
							onChange={(e) => form.set({ webhookUrl: e.target.value })}
							placeholder="https://example.com/send-text"
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
				)}
				{!twilio && (
					<Fold title="Advanced" summary={saved.webhookSecret === MASKED ? "Secret saved" : undefined}>
						<div className="flex flex-col gap-3 pt-2">
							<Field
								label="Secret"
								optional
								hint={
									saved.webhookSecret === MASKED
										? "Saved. Type a new one to replace it."
										: "Your service checks the signature with it."
								}
							>
								<PasswordInput
									value={form.draft.webhookSecret ?? ""}
									onChange={(e) => form.set({ webhookSecret: e.target.value })}
									placeholder={saved.webhookSecret === MASKED ? MASKED : undefined}
									autoComplete="new-password"
								/>
							</Field>
							<Fold title="Learn more" variant="link">
								Sekai sends <code className="font-mono">{`{"to", "message"}`}</code> as JSON, with an{" "}
								<code className="font-mono">X-Sekai-Signature</code> header: the hex HMAC-SHA256 of the
								body, keyed with the secret.
							</Fold>
						</div>
					</Fold>
				)}
			</FormGroup>
			<TestSend
				label="Send a test text"
				type="tel"
				placeholder="+15551234567"
				disabled={form.dirty || !ready}
				disabledHint={form.dirty ? "Save your changes first." : "Turn texts on and fill them in first."}
				send={api.admin.testSms}
			/>
		</Section>
	);
}

export function SignInOptionsSection({ back, rest }: SettingsSectionProps) {
	if (rest) return <ProviderPage id={rest} />;
	return (
		<Page back={back} title="Sign-in options" description="Besides a username, a password and a passkey.">
			<SingleSignOn />
			<EmailSection />
			<SmsSection />
		</Page>
	);
}
