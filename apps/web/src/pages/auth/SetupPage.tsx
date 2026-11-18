import { api, passkeysSupported, registerPasskey } from "@sekai/client";
import { type AuthStatus, PASSWORD_MIN, USERNAME_PATTERN } from "@sekai/shared";
import { Button, Callout, CodeInput, Field, Input, PasswordInput, Spinner } from "@sekai/ui";
import { CircleAlert, Fingerprint, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout.tsx";
import type { SignedIn } from "./SignInPage.tsx";

function usernameFrom(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "")
		.slice(0, 39);
}

/** First run: create the first account (an admin), then (where it works) offer a passkey. */
export function SetupPage({ status, onDone }: { status: AuthStatus; onDone: (result: SignedIn) => void }) {
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [usernameEdited, setUsernameEdited] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState<SignedIn | null>(null);
	const offerPasskey = passkeysSupported(status.passkeysAvailable);

	const handle = usernameEdited ? username : usernameFrom(name);
	const handleOk = USERNAME_PATTERN.test(handle);
	const ready =
		name.trim() && handleOk && password.length >= PASSWORD_MIN && (!status.setupCodeRequired || code.length === 6);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await api.auth.setup({
				name: name.trim(),
				username: handle,
				email: email.trim() || null,
				password,
				code: status.setupCodeRequired ? code : undefined,
			});
			if (result.status !== "signed_in") return;
			if (offerPasskey) setCreated(result);
			else onDone(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (created) return <PasskeyOffer name={created.user.name} onDone={() => onDone(created)} />;

	return (
		<AuthLayout
			title="Welcome to Sekai"
			subtitle="Create the first account. You'll be its admin: you add the other people who use it."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) void submit();
				}}
			>
				{status.setupCodeRequired && (
					<Field
						label="Setup code"
						hint="It's in the server's log when Sekai starts (docker compose logs app, or the terminal running it). It proves you're the one who runs this server."
					>
						<CodeInput value={code} onChange={setCode} autoFocus />
					</Field>
				)}
				<Field label="Your name" hint="What your bots call you.">
					<Input
						autoFocus={!status.setupCodeRequired}
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoComplete="name"
						placeholder="Sam"
					/>
				</Field>
				<Field
					label="Username"
					error={handle && !handleOk ? "2-39 characters: letters, digits, dots, dashes or underscores" : null}
				>
					<Input
						value={handle}
						onChange={(e) => {
							setUsernameEdited(true);
							setUsername(e.target.value.toLowerCase());
						}}
						autoComplete="username"
						autoCapitalize="none"
						spellCheck={false}
					/>
				</Field>
				<Field label="Email" hint="Optional. You can sign in with it instead of your username.">
					<Input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
						placeholder="you@example.com"
					/>
				</Field>
				<Field label="Password" hint={`At least ${PASSWORD_MIN} characters. A few words together works well.`}>
					<PasswordInput
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="new-password"
					/>
				</Field>
				{error && (
					<Callout tone="danger" icon={<CircleAlert />}>
						{error}
					</Callout>
				)}
				<Button type="submit" variant="primary" size="lg" className="mt-1 w-full" disabled={!ready || busy}>
					{busy && <Spinner className="text-primary-foreground" />}
					Create account
				</Button>
			</form>
		</AuthLayout>
	);
}

function PasskeyOffer({ name, onDone }: { name: string; onDone: () => void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const add = async () => {
		setBusy(true);
		setError(null);
		try {
			await registerPasskey();
			onDone();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== "Cancelled") setError(message);
			setBusy(false);
		}
	};
	return (
		<AuthLayout
			title={`You're in, ${name.split(" ")[0]}`}
			subtitle="Add a passkey to sign in with Face ID, Touch ID, Windows Hello or your password manager. No password to type."
		>
			<div className="flex flex-col gap-3">
				<div className="mb-2 flex items-start gap-3 rounded-2xl bg-brand/8 px-4 py-3 text-[13px] leading-5">
					<ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-ink" />
					<span className="text-muted-foreground">
						Passkeys can't be phished or reused. Your password keeps working too.
					</span>
				</div>
				{error && (
					<Callout tone="danger" icon={<CircleAlert />}>
						{error}
					</Callout>
				)}
				<Button variant="primary" size="lg" className="w-full" onClick={() => void add()} disabled={busy}>
					{busy ? <Spinner className="text-primary-foreground" /> : <Fingerprint />}
					Add a passkey
				</Button>
				<Button variant="ghost" size="lg" className="w-full" onClick={onDone} disabled={busy}>
					Not now
				</Button>
			</div>
		</AuthLayout>
	);
}
