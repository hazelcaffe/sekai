import { api, passkeysSupported, registerPasskey, TwoFactorSettings } from "@sekai/client";
import { type AuthStatus, PASSWORD_MIN } from "@sekai/shared";
import { Button, Callout, Field, PasswordInput, Spinner } from "@sekai/ui";
import { CircleAlert, Fingerprint } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout.tsx";

/**
 * Signed in, but a step first: choose your own password (an admin gave you a temporary one), or set up two-factor
 * sign-in (your role asks for it). onDone refreshes the sign-in status.
 */
export function RestrictedPage({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
	const signOut = () => void api.auth.logout().finally(() => location.assign("/"));
	if (status.restriction === "password") return <ChoosePassword onDone={onDone} onSignOut={signOut} />;
	return <SetUpTwoFactor status={status} onDone={onDone} onSignOut={signOut} />;
}

function ChoosePassword({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
	const [password, setPassword] = useState("");
	const [again, setAgain] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ready = password.length >= PASSWORD_MIN && password === again;
	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			await api.auth.changePassword({ current: "", next: password });
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<AuthLayout
			title="Choose your password"
			subtitle="You signed in with a temporary password. Pick your own: only you will know it."
			footer={
				<button type="button" className="hover:underline coarse:py-2" onClick={onSignOut}>
					Sign out
				</button>
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready && !busy) void save();
				}}
			>
				<Field
					label="New password"
					hint={`At least ${PASSWORD_MIN} characters. A few words together works well.`}
				>
					<PasswordInput
						autoFocus
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="new-password"
					/>
				</Field>
				<Field label="Once more" error={again && again !== password ? "The two don't match yet" : null}>
					<PasswordInput
						value={again}
						onChange={(e) => setAgain(e.target.value)}
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
					Save
				</Button>
			</form>
		</AuthLayout>
	);
}

function SetUpTwoFactor({
	status,
	onDone,
	onSignOut,
}: {
	status: AuthStatus;
	onDone: () => void;
	onSignOut: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const passkeys = passkeysSupported(status.passkeysAvailable);
	const addPasskey = async () => {
		setBusy(true);
		setError(null);
		try {
			await registerPasskey();
			onDone();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== "Cancelled") setError(message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<AuthLayout
			title="Set up two-factor sign-in"
			subtitle="Your role asks for a second step when you sign in, so a stolen password isn't enough."
			footer={
				<button type="button" className="hover:underline coarse:py-2" onClick={onSignOut}>
					Sign out
				</button>
			}
		>
			<div className="flex flex-col gap-4">
				{passkeys && (
					<>
						<Button
							variant="primary"
							size="lg"
							className="w-full"
							disabled={busy}
							onClick={() => void addPasskey()}
						>
							{busy ? <Spinner className="text-primary-foreground" /> : <Fingerprint />}
							Add a passkey
						</Button>
						<p className="-mt-2 text-center text-xs text-fg-subtle">
							Face ID, Touch ID, Windows Hello or your password manager. Or use one of these:
						</p>
					</>
				)}
				{error && (
					<Callout tone="danger" icon={<CircleAlert />}>
						{error}
					</Callout>
				)}
				<TwoFactorSettings
					onChange={(s) => {
						if (s.totp || s.email || s.sms) onDone();
					}}
				/>
			</div>
		</AuthLayout>
	);
}
