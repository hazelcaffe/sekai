import type { MfaMethod, MfaStatus } from "@sekai/shared";
import { Button, Callout, Dialog, Field, Input, PasswordInput, Segmented, Spinner } from "@sekai/ui";
import { CircleAlert, Fingerprint, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, setReauthHandler } from "../api.ts";
import { passkeysSupported, signInWithPasskey } from "../passkeys.ts";

type Way = "password" | "totp" | "email" | "sms" | "passkey";

/**
 * "Confirm it's you": before sensitive changes (an email address, passwords of a bot's computer, admin changes),
 * the server asks for your password, a code or a passkey again if you last proved it a while ago. Mount once per app;
 * any API call that needs it waits for this dialog, then goes through.
 */
export function ReauthHost() {
	const [open, setOpen] = useState(false);
	const pending = useRef<((ok: boolean) => void) | null>(null);
	const [mfa, setMfa] = useState<MfaStatus | null>(null);
	const [way, setWay] = useState<Way>("password");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const passkeys = passkeysSupported(typeof location !== "undefined" && location.protocol === "https:");

	useEffect(() => {
		setReauthHandler(
			() =>
				new Promise<boolean>((resolve) => {
					pending.current?.(false);
					pending.current = resolve;
					setPassword("");
					setCode("");
					setSent(false);
					setError(null);
					setOpen(true);
					void api.auth
						.mfa()
						.then(setMfa)
						.catch(() => setMfa(null));
				}),
		);
		return () => setReauthHandler(null);
	}, []);

	const finish = (ok: boolean) => {
		pending.current?.(ok);
		pending.current = null;
		setOpen(false);
	};

	const ways: { value: Way; label: string }[] = [
		{ value: "password", label: "Password" },
		...(mfa?.totp ? [{ value: "totp" as const, label: "App code" }] : []),
		...(mfa?.email && mfa.emailAvailable ? [{ value: "email" as const, label: "Email code" }] : []),
		...(passkeys ? [{ value: "passkey" as const, label: "Passkey" }] : []),
	];

	const confirm = async () => {
		setBusy(true);
		setError(null);
		try {
			if (way === "passkey") await signInWithPasskey({ reauth: true });
			else if (way === "password") await api.auth.reauth({ password });
			else await api.auth.reauth({ method: way as MfaMethod, code });
			finish(true);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== "Cancelled") setError(message);
		} finally {
			setBusy(false);
		}
	};

	const sendCode = async () => {
		setBusy(true);
		setError(null);
		try {
			await api.auth.reauthSend("email");
			setSent(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const ready = way === "passkey" || (way === "password" ? password.length > 0 : code.trim().length >= 6);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => !o && finish(false)}
			size="sm"
			icon={<ShieldCheck />}
			title="Confirm it's you"
			description="This change needs you to prove it's you again. You won't be asked again for a while."
			footer={
				<>
					<Button variant="ghost" onClick={() => finish(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!ready || busy} onClick={() => void confirm()}>
						{busy && <Spinner className="text-primary-foreground" />}
						Confirm
					</Button>
				</>
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready && !busy) void confirm();
				}}
			>
				{ways.length > 1 && (
					<Segmented
						value={way}
						onValueChange={(v) => {
							setWay(v);
							setError(null);
						}}
						options={ways}
					/>
				)}
				{way === "password" && (
					<Field label="Your password">
						<PasswordInput
							autoFocus
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							autoComplete="current-password"
						/>
					</Field>
				)}
				{(way === "totp" || way === "email") && (
					<Field
						label={way === "totp" ? "Code from your authenticator app" : "Code from your email"}
						hint={way === "email" && !sent ? "Send yourself a code first." : undefined}
					>
						<div className="flex gap-2">
							<Input
								autoFocus
								inputMode="numeric"
								autoComplete="one-time-code"
								value={code}
								onChange={(e) => setCode(e.target.value)}
								className="tabular-nums"
							/>
							{way === "email" && (
								<Button variant="secondary" disabled={busy} onClick={() => void sendCode()}>
									{sent ? "Send again" : "Send code"}
								</Button>
							)}
						</div>
					</Field>
				)}
				{way === "passkey" && (
					<p className="flex items-center gap-2 text-sm text-fg-muted">
						<Fingerprint className="size-4 shrink-0" />
						Your device asks for your face, fingerprint or PIN.
					</p>
				)}
				{error && (
					<Callout tone="danger" icon={<CircleAlert />}>
						{error}
					</Callout>
				)}
			</form>
		</Dialog>
	);
}
