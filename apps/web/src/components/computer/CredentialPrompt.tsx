import { AgentAvatar, api, useAgentMap, useCredentialRequests } from "@sekai/client";
import type { CredentialRequest } from "@sekai/shared";
import { Button, Dialog, Field, FormGroup, Input, PasswordInput, ToggleRow } from "@sekai/ui";
import { KeyRound, Lock } from "lucide-react";
import { useState } from "react";

/** One sign-in request: what you type goes straight into the bot's browser, never to the bot itself. */
function LoginForm({ request, onDone }: { request: CredentialRequest; onDone: () => void }) {
	const agents = useAgentMap();
	const agent = agents.get(request.agentId);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [otp, setOtp] = useState("");
	const [remember, setRemember] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const answer = async (cancel: boolean) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await api.credentials.answer(request.id, cancel ? { cancel: true } : { username, password, otp, remember });
			onDone();
		} catch {
			setError(cancel ? "Couldn't decline the request. Try again." : "Couldn't send these details. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const wants = (f: CredentialRequest["fields"][number]) => request.fields.includes(f);
	const ready =
		(!wants("username") || username.trim()) && (!wants("password") || password) && (!wants("otp") || otp.trim());

	return (
		<FormGroup
			dirty={Boolean(username || password || otp || remember)}
			submitWhenClean
			disabled={!ready || busy}
			submitLabel="Sign in"
			error={error}
			onSubmit={() => answer(false)}
			extra={
				<Button type="button" variant="ghost" disabled={busy} onClick={() => void answer(true)}>
					Don't sign in
				</Button>
			}
		>
			<div className="flex items-start gap-3">
				{agent && <AgentAvatar avatar={agent.avatar} size={36} state="waiting" />}
				<div className="min-w-0 text-body">
					<div>
						<span className="font-semibold">{agent?.name ?? "A bot"}</span> wants to sign in to{" "}
						<span className="font-semibold">{request.site}</span>
					</div>
					<div className="mt-0.5 text-small text-fg-muted">{request.reason}</div>
					{request.hasSaved && (
						<div className="mt-1 text-small text-fg-subtle">The saved login didn't work.</div>
					)}
				</div>
			</div>
			{wants("username") && (
				<Field label="Username or email">
					<Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
				</Field>
			)}
			{wants("password") && (
				<Field label="Password">
					<PasswordInput
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
			)}
			{wants("otp") && (
				<Field label="One-time code" hint="From your authenticator app, text message or email.">
					<Input
						inputMode="numeric"
						autoComplete="one-time-code"
						value={otp}
						onChange={(e) => setOtp(e.target.value)}
						className="font-mono tracking-widest"
					/>
				</Field>
			)}
			{wants("password") && request.canRemember && (
				<ToggleRow
					title="Remember sign-in"
					description="Save it encrypted so this bot can sign in again."
					checked={remember}
					onCheckedChange={setRemember}
				/>
			)}
			<p className="flex items-center gap-1.5 text-small text-fg-subtle">
				<Lock className="size-4 shrink-0" /> Your details go straight into the page, not to the bot.
			</p>
		</FormGroup>
	);
}

/** Shows sign-in requests from bots as they come in, oldest first. */
export function CredentialPrompt() {
	const { data: requests = [], refetch } = useCredentialRequests();
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());
	const request = requests.find((r) => !dismissed.has(r.id));
	return (
		<Dialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				// Closing hides it here; it stays in Needs you until answered.
				if (!open && request) setDismissed((d) => new Set(d).add(request.id));
			}}
			title="Sign in"
			icon={<KeyRound />}
			size="sm"
		>
			{request && <LoginForm key={request.id} request={request} onDone={() => void refetch()} />}
		</Dialog>
	);
}

export { LoginForm };
