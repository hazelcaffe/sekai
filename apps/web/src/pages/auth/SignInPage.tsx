import {
	api,
	BrandGlyph,
	cancelPasskeyPrompt,
	mobile,
	passkeyAutofill,
	passkeysSupported,
	signInWithPasskey,
	ssoBrand,
} from "@sekai/client";
import type { AuthStatus, MfaMethod, SignInResult } from "@sekai/shared";
import { Button, Callout, Field, Input, PasswordInput, Spinner } from "@sekai/ui";
import { CircleAlert, Fingerprint, Globe, KeyRound, MailCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AuthLayout, OrDivider } from "./AuthLayout.tsx";
import { MfaStep } from "./MfaStep.tsx";

export type SignedIn = Extract<SignInResult, { status: "signed_in" }>;
type Challenge = { methods: MfaMethod[]; hints: { email?: string; sms?: string } };

/** What single sign-on left in the address (an error, or "your second step is waiting"); then it's cleared. */
function takeSsoParams(): { error: string | null; mfa: boolean } {
	const q = new URLSearchParams(location.search);
	const error = q.get("sso_error");
	const mfa = q.get("mfa") === "1";
	if (error || mfa) {
		q.delete("sso_error");
		q.delete("mfa");
		const rest = q.toString();
		history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}`);
	}
	return { error, mfa };
}

export function SignInPage({ status, onSignedIn }: { status: AuthStatus; onSignedIn: (result: SignedIn) => void }) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
	const [challenge, setChallenge] = useState<Challenge | null>(null);
	const [forgot, setForgot] = useState(false);
	// In the phone app, passkeys and single sign-on happen in the system browser (they don't work in app views).
	const passkeys = passkeysSupported(status.passkeysAvailable);

	const handle = useCallback(
		(result: SignInResult) => {
			if (result.status === "mfa") setChallenge({ methods: result.methods, hints: result.hints });
			else onSignedIn(result);
		},
		[onSignedIn],
	);

	// Back from single sign-on: show its error, or the second step it's waiting for.
	useEffect(() => {
		const sso = takeSsoParams();
		if (sso.error) setError(sso.error);
		if (sso.mfa) {
			void api.auth
				.mfaChallenge()
				.then(setChallenge)
				.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
		}
	}, []);

	// Saved passkeys show up in the username field's suggestions, no button needed.
	useEffect(() => {
		if (!passkeys || challenge || forgot) return;
		void passkeyAutofill().then((result) => result && handle(result));
		return () => cancelPasskeyPrompt();
	}, [passkeys, handle, challenge, forgot]);

	const withPassword = async () => {
		setBusy("password");
		setError(null);
		try {
			handle(await api.auth.login({ username, password }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const withPasskey = async () => {
		setBusy("passkey");
		setError(null);
		try {
			handle(await signInWithPasskey());
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== "Cancelled") setError(message);
			void passkeyAutofill().then((result) => result && handle(result));
		} finally {
			setBusy(null);
		}
	};

	const viaBrowser = async (provider: string | null) => {
		setError(null);
		try {
			await mobile?.signInWithBrowser({ provider });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	if (challenge) {
		return (
			<AuthLayout title="One more step" subtitle="Your account has two-factor sign-in.">
				<MfaStep
					methods={challenge.methods}
					hints={challenge.hints}
					onSignedIn={onSignedIn}
					onBack={() => {
						setChallenge(null);
						setPassword("");
					}}
				/>
			</AuthLayout>
		);
	}

	if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />;

	const showPasskey = passkeys && status.hasPasskeys;
	const showBrowser = Boolean(mobile);
	return (
		<AuthLayout
			title="Welcome back"
			subtitle="Sign in to Sekai to pick up where your bots left off."
			footer={
				status.passwordReset ? undefined : (
					<>
						Forgot your password? Ask an admin to reset it. Admins can run{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-foreground">
							bun run reset-password
						</code>{" "}
						on the server.
					</>
				)
			}
		>
			{(showPasskey || showBrowser || status.sso.length > 0) && (
				<>
					<div className="flex flex-col gap-2.5">
						{showBrowser && (
							<Button
								variant={status.hasPasskeys ? "primary" : "secondary"}
								size="lg"
								className="w-full"
								onClick={() => void viaBrowser(null)}
								disabled={busy !== null}
							>
								{status.hasPasskeys ? <Fingerprint /> : <Globe />}
								{status.hasPasskeys ? "Sign in with a passkey" : "Sign in with your browser"}
							</Button>
						)}
						{showPasskey && (
							<Button
								variant="primary"
								size="lg"
								className="w-full"
								onClick={() => void withPasskey()}
								disabled={busy !== null}
							>
								{busy === "passkey" ? <Spinner className="text-primary-foreground" /> : <Fingerprint />}
								Sign in with a passkey
							</Button>
						)}
						{status.sso.map((p) => {
							const brand = ssoBrand(p.kind);
							return (
								<Button
									key={p.id}
									variant="secondary"
									size="lg"
									className="w-full"
									onClick={() => {
										if (mobile) {
											void viaBrowser(p.id);
											return;
										}
										const next = new URLSearchParams(location.search).get("next");
										location.assign(api.auth.ssoStartUrl(p.id, { redirect: next ?? "/" }));
									}}
								>
									{brand ? <BrandGlyph brand={brand} size={18} /> : <KeyRound />}
									Continue with {p.name}
								</Button>
							);
						})}
					</div>
					<OrDivider />
				</>
			)}
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					void withPassword();
				}}
			>
				<Field label="Username or email">
					<Input
						autoFocus={!showPasskey && !showBrowser && status.sso.length === 0}
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						autoComplete={passkeys ? "username webauthn" : "username"}
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
					/>
				</Field>
				<Field
					label="Password"
					action={
						status.passwordReset ? (
							<button
								type="button"
								className="text-xs font-medium text-brand-ink hover:underline coarse:py-1"
								onClick={() => setForgot(true)}
							>
								Forgot it?
							</button>
						) : undefined
					}
				>
					<PasswordInput
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
					/>
				</Field>
				{error && (
					<Callout tone="danger" icon={<CircleAlert />}>
						{error}
					</Callout>
				)}
				<Button
					type="submit"
					variant={
						showPasskey || status.sso.length || (showBrowser && status.hasPasskeys)
							? "secondary"
							: "primary"
					}
					size="lg"
					className="mt-1 w-full"
					disabled={!username.trim() || !password || busy !== null}
				>
					{busy === "password" && <Spinner />}
					Sign in
				</Button>
			</form>
		</AuthLayout>
	);
}

/** "Forgot your password?": a link by email (the same answer whether or not the email has an account). */
function ForgotPassword({ onBack }: { onBack: () => void }) {
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const send = async () => {
		setBusy(true);
		setError(null);
		try {
			await api.auth.forgot(email.trim());
			setSent(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
			{sent ? (
				<div className="flex flex-col items-center gap-3 text-center">
					<MailCheck className="size-8 text-brand-ink" />
					<p className="text-sm text-fg-muted">
						If there's an account with that email, a link is on its way. It works once, for an hour.
					</p>
					<Button variant="secondary" className="w-full" onClick={onBack}>
						Back to sign in
					</Button>
				</div>
			) : (
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (email.includes("@") && !busy) void send();
					}}
				>
					<Field label="Email">
						<Input
							autoFocus
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							autoComplete="email"
						/>
					</Field>
					{error && (
						<Callout tone="danger" icon={<CircleAlert />}>
							{error}
						</Callout>
					)}
					<Button type="submit" variant="primary" size="lg" disabled={!email.includes("@") || busy}>
						{busy && <Spinner className="text-primary-foreground" />}
						Send the link
					</Button>
					<Button variant="ghost" onClick={onBack}>
						Back to sign in
					</Button>
				</form>
			)}
		</AuthLayout>
	);
}
