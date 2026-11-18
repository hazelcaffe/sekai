import { api } from "@sekai/client";
import { PASSWORD_MIN, type SignInResult } from "@sekai/shared";
import { Button, Callout, Field, PasswordInput, Spinner } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout.tsx";
import { MfaStep } from "./MfaStep.tsx";
import type { SignedIn } from "./SignInPage.tsx";

/** /welcome/invite/:token and /welcome/reset/:token, if this is one. */
export function ticketFromPath(path = location.pathname): { kind: "invite" | "reset"; token: string } | null {
	const m = path.match(/^\/welcome\/(invite|reset)\/([A-Za-z0-9]{20,100})\/?$/);
	return m?.[1] && m[2] ? { kind: m[1] as "invite" | "reset", token: m[2] } : null;
}

/** An invite (choose your password, you're in) or a password reset link, from an admin or an email. */
export function TicketPage({
	kind,
	token,
	onSignedIn,
}: {
	kind: "invite" | "reset";
	token: string;
	onSignedIn: (result: SignedIn) => void;
}) {
	const info = useQuery({
		queryKey: ["ticket", kind, token],
		queryFn: () => api.auth.ticket(kind, token),
		retry: false,
	});
	const [password, setPassword] = useState("");
	const [again, setAgain] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mfa, setMfa] = useState<Extract<SignInResult, { status: "mfa" }> | null>(null);

	const done = (result: SignedIn) => {
		history.replaceState(null, "", "/");
		onSignedIn(result);
	};
	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await api.auth.acceptTicket(kind, token, password);
			if (result.status === "mfa") setMfa(result);
			else done(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (mfa) {
		return (
			<AuthLayout title="One more step" subtitle="Your account has two-factor sign-in.">
				<MfaStep
					methods={mfa.methods}
					hints={mfa.hints}
					onSignedIn={done}
					onBack={() => location.assign("/")}
				/>
			</AuthLayout>
		);
	}
	if (info.isLoading) {
		return (
			<div className="flex h-dvh items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}
	if (!info.data) {
		return (
			<AuthLayout title="This link doesn't work" subtitle="It expired or was already used.">
				<div className="flex flex-col gap-3">
					<p className="text-sm text-fg-muted">
						{kind === "invite"
							? "Ask the admin who invited you for a new link."
							: "Ask for a new one, or ask an admin to reset your password."}
					</p>
					<Button variant="secondary" onClick={() => location.assign("/")}>
						Go to sign in
					</Button>
				</div>
			</AuthLayout>
		);
	}
	const mismatch = again.length > 0 && again !== password;
	const ready = password.length >= PASSWORD_MIN && password === again;
	return (
		<AuthLayout
			title={kind === "invite" ? `Welcome, ${info.data.name.split(" ")[0]}` : "Choose a new password"}
			subtitle={
				kind === "invite"
					? `You have an account on Sekai. Your username is ${info.data.username}. Choose a password to start.`
					: `For ${info.data.username}. You'll be signed out everywhere else.`
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready && !busy) void submit();
				}}
			>
				<input type="text" name="username" value={info.data.username} autoComplete="username" hidden readOnly />
				<Field label="Password" hint={`At least ${PASSWORD_MIN} characters. A few words together works well.`}>
					<PasswordInput
						autoFocus
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="new-password"
					/>
				</Field>
				<Field label="Once more" error={mismatch ? "The two don't match yet" : null}>
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
					{kind === "invite" ? "Start using Sekai" : "Save and sign in"}
				</Button>
			</form>
		</AuthLayout>
	);
}
