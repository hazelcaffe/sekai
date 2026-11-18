import { api } from "@sekai/client";
import type { MfaMethod, SignInResult } from "@sekai/shared";
import { Button, Callout, Field, Input, Segmented, Spinner } from "@sekai/ui";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

const LABEL: Record<MfaMethod, string> = {
	totp: "App",
	email: "Email",
	sms: "Text",
	recovery: "Recovery code",
};

/**
 * The second step of signing in: a code from an authenticator app, by email or text, or a recovery code.
 * Codes by email or text are sent when you pick that method.
 */
export function MfaStep({
	methods,
	hints,
	onSignedIn,
	onBack,
}: {
	methods: MfaMethod[];
	hints: { email?: string; sms?: string };
	onSignedIn: (result: Extract<SignInResult, { status: "signed_in" }>) => void;
	onBack: () => void;
}) {
	const [method, setMethod] = useState<MfaMethod>(methods[0] ?? "recovery");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState<MfaMethod | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const send = async (m: "email" | "sms") => {
		setBusy(true);
		setError(null);
		try {
			await api.auth.mfaSend(m);
			setSent(m);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	// Picking email or text sends a code right away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the method changes
	useEffect(() => {
		if ((method === "email" || method === "sms") && sent !== method) void send(method);
	}, [method]);

	const verify = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await api.auth.mfaVerify(method, code);
			if (result.status === "signed_in") onSignedIn(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			// Too many tries: the sign-in ended, start again.
			if (err instanceof Error && /sign in again|expired/i.test(err.message)) setTimeout(onBack, 1500);
		} finally {
			setBusy(false);
		}
	};

	const prompt =
		method === "totp"
			? "Enter the 6-digit code from your authenticator app."
			: method === "email"
				? `We sent a code to ${hints.email ?? "your email"}.`
				: method === "sms"
					? `We sent a code to ${hints.sms ?? "your phone"}.`
					: "Enter one of the recovery codes you saved. Each works once.";

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (code.trim() && !busy) void verify();
			}}
		>
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand-ink">
					<ShieldCheck className="size-5" />
				</span>
				<div>
					<div className="font-medium">Two-factor sign-in</div>
					<p className="text-sm text-fg-muted">{prompt}</p>
				</div>
			</div>
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
					className="text-center text-lg tracking-[0.25em] tabular-nums"
				/>
			</Field>
			{(method === "email" || method === "sms") && sent === method && (
				<button
					type="button"
					className="self-start text-sm text-brand-ink underline-offset-2 hover:underline coarse:py-2"
					onClick={() => void send(method)}
					disabled={busy}
				>
					Send another code
				</button>
			)}
			{error && (
				<Callout tone="danger" icon={<CircleAlert />}>
					{error}
				</Callout>
			)}
			<Button type="submit" variant="primary" size="lg" className="w-full" disabled={!code.trim() || busy}>
				{busy && <Spinner className="text-primary-foreground" />}
				Continue
			</Button>
			<Button variant="ghost" className="w-full" onClick={onBack}>
				Use another account
			</Button>
		</form>
	);
}
