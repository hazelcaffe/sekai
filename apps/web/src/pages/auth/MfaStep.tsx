import { api, mobile, passkeySecondStep, passkeysSupported } from "@sekai/client";
import type { MfaChallenge, MfaMethod, SignInResult } from "@sekai/shared";
import { Button, Callout, Field, Input, Segmented, Spinner } from "@sekai/ui";
import { CircleAlert, Fingerprint, Globe, Info } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

const LABEL: Record<MfaMethod, string> = {
	totp: "App",
	email: "Email",
	sms: "Text",
	recovery: "Recovery code",
};

/** The one-line title of the step, for the page around it. */
export function mfaSubtitle(challenge: MfaChallenge): string {
	return challenge.passkeyRequired
		? "Your account needs your passkey to sign in."
		: "Your account has two-step sign-in.";
}

/** "sekai.example.com", "a.example and b.example", each a link to sign in there (except localhost). */
function Hosts({ hosts }: { hosts: string[] }) {
	const parts: ReactNode[] = [];
	hosts.forEach((h, i) => {
		if (i > 0) parts.push(i === hosts.length - 1 ? " or " : ", ");
		parts.push(
			h === "localhost" ? (
				<span key={h} className="font-medium">
					{h}
				</span>
			) : (
				<a
					key={h}
					href={`https://${h}/`}
					className="font-medium text-brand-ink underline-offset-2 hover:underline"
				>
					{h}
				</a>
			),
		);
	});
	return <>{parts}</>;
}

/**
 * The second step of signing in: your passkey (first, when one is for this address), a code from an authenticator
 * app, by email or text, or a recovery code. When the account requires a passkey, only the passkey or a recovery
 * code will do. Codes by email or text are sent when you pick that method.
 */
export function MfaStep({
	challenge,
	onSignedIn,
	onBack,
}: {
	challenge: MfaChallenge;
	onSignedIn: (result: Extract<SignInResult, { status: "signed_in" }>) => void;
	onBack: () => void;
}) {
	const { methods, hints, passkeyRequired: required } = challenge;
	// The server says one of their passkeys is for this address; the browser must be able to use it (the phone apps'
	// web views can't).
	const canPasskey = challenge.passkey && passkeysSupported(true);
	// With a passkey to use, codes wait behind a link.
	const [codes, setCodes] = useState(!canPasskey);
	const [method, setMethod] = useState<MfaMethod>(methods[0] ?? "recovery");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState<MfaMethod | null>(null);
	const [busy, setBusy] = useState<"code" | "passkey" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const fail = (err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== "Cancelled") setError(message);
		// Too many tries: the sign-in ended, start again.
		if (/sign in again|expired/i.test(message)) setTimeout(onBack, 1500);
	};

	const send = async (m: "email" | "sms") => {
		setBusy("code");
		setError(null);
		try {
			await api.auth.mfaSend(m);
			setSent(m);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	// Picking email or text (with the codes showing) sends a code right away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the method or the view changes
	useEffect(() => {
		if (codes && (method === "email" || method === "sms") && sent !== method) void send(method);
	}, [method, codes]);

	const verify = async () => {
		setBusy("code");
		setError(null);
		try {
			const result = await api.auth.mfaVerify(method, code);
			if (result.status === "signed_in") onSignedIn(result);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	const withPasskey = async () => {
		setBusy("passkey");
		setError(null);
		try {
			const result = await passkeySecondStep();
			if (result.status === "signed_in") onSignedIn(result);
		} catch (err) {
			fail(err);
		} finally {
			setBusy(null);
		}
	};

	const viaBrowser = async () => {
		setError(null);
		try {
			await mobile?.signInWithBrowser({ provider: null });
		} catch (err) {
			fail(err);
		}
	};

	const errorBox = error && (
		<Callout tone="danger" icon={<CircleAlert />}>
			{error}
		</Callout>
	);
	// In the phone app, "Continue in your browser" is the main way on.
	const codesSecondary = required && !canPasskey && Boolean(mobile);

	const prompt = !codes
		? "Your device asks for your face, fingerprint or PIN."
		: method === "totp"
			? "Enter the 6-digit code from your authenticator app."
			: method === "email"
				? `We sent a code to ${hints.email ?? "your email"}.`
				: method === "sms"
					? `We sent a code to ${hints.sms ?? "your phone"}.`
					: required
						? "Enter one of the recovery codes you saved. Each works once, in place of your passkey."
						: "Enter one of the recovery codes you saved. Each works once.";

	return (
		<div className="flex flex-col gap-4">
			<p className="text-body text-fg-muted">{prompt}</p>

			{required && !canPasskey && (
				<Callout tone="warning" icon={<Info />}>
					{mobile ? (
						"Passkeys don't work inside the app. Continue in your browser, or use a recovery code."
					) : challenge.passkey ? (
						"This browser can't use passkeys. Try another one, or use a recovery code."
					) : challenge.passkeyHosts.length ? (
						<>
							Your passkeys are for <Hosts hosts={challenge.passkeyHosts} />. Sign in there, or use a
							recovery code.
						</>
					) : (
						"You have no passkeys. Use a recovery code, or ask an admin to stop requiring one."
					)}
				</Callout>
			)}
			{codesSecondary && (
				<Button variant="primary" size="lg" className="w-full" onClick={() => void viaBrowser()}>
					<Globe /> Continue in your browser
				</Button>
			)}

			{canPasskey && !codes && (
				<>
					<Button
						variant="primary"
						size="lg"
						className="w-full"
						autoFocus
						disabled={busy !== null}
						onClick={() => void withPasskey()}
					>
						{busy === "passkey" ? <Spinner className="text-primary-foreground" /> : <Fingerprint />}
						Use your passkey
					</Button>
					<button
						type="button"
						className="self-center text-body text-brand-ink underline-offset-2 hover:underline coarse:py-2"
						onClick={() => {
							setCodes(true);
							setError(null);
						}}
					>
						{required ? "Lost your passkey? Use a recovery code" : "Use a code instead"}
					</button>
				</>
			)}

			{codes && (
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (code.trim() && !busy) void verify();
					}}
				>
					{methods.length > 1 && (
						<Segmented
							value={method}
							onValueChange={(m) => {
								setMethod(m);
								setCode("");
								setError(null);
							}}
							options={methods.map((m) => ({ value: m, label: LABEL[m] }))}
						/>
					)}
					<Field label={method === "recovery" ? "Recovery code" : "Code"}>
						<Input
							autoFocus
							value={code}
							onChange={(e) => setCode(e.target.value)}
							inputMode={method === "recovery" ? "text" : "numeric"}
							autoComplete="one-time-code"
							autoCapitalize="none"
							spellCheck={false}
							className="text-center text-heading tracking-[0.25em] tabular-nums"
						/>
					</Field>
					{(method === "email" || method === "sms") && sent === method && (
						<button
							type="button"
							className="self-start text-body text-brand-ink underline-offset-2 hover:underline coarse:py-2"
							onClick={() => void send(method)}
							disabled={busy !== null}
						>
							Send another code
						</button>
					)}
					{errorBox}
					<Button
						type="submit"
						variant={codesSecondary ? "secondary" : "primary"}
						size="lg"
						className="w-full"
						disabled={!code.trim() || busy !== null}
					>
						{busy === "code" && (
							<Spinner className={codesSecondary ? undefined : "text-primary-foreground"} />
						)}
						Continue
					</Button>
					{canPasskey && (
						<button
							type="button"
							className="self-center text-body text-brand-ink underline-offset-2 hover:underline coarse:py-2"
							onClick={() => {
								setCodes(false);
								setCode("");
								setError(null);
							}}
						>
							Use your passkey instead
						</button>
					)}
				</form>
			)}

			{!codes && errorBox}
			<Button variant="ghost" className="w-full" onClick={onBack}>
				Use another account
			</Button>
		</div>
	);
}
