import { AgentAvatar, api, useAgentMap, useCredentialRequests } from "@sekai/client";
import type { CredentialRequest } from "@sekai/shared";
import { Button, Dialog, Field, Input, Switch } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Lock } from "lucide-react";
import { useId, useState } from "react";

/** One sign-in request: what you type goes straight into the bot's browser, never to the bot itself. */
function LoginForm({ request, onDone }: { request: CredentialRequest; onDone: () => void }) {
	const agents = useAgentMap();
	const agent = agents.get(request.agentId);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [otp, setOtp] = useState("");
	const [remember, setRemember] = useState(false);
	const rememberId = useId();
	const answer = useMutation({
		mutationFn: (cancel: boolean) =>
			api.credentials.answer(request.id, cancel ? { cancel: true } : { username, password, otp, remember }),
		onSuccess: onDone,
	});
	const wants = (f: CredentialRequest["fields"][number]) => request.fields.includes(f);
	const ready =
		(!wants("username") || username.trim()) && (!wants("password") || password) && (!wants("otp") || otp.trim());

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (ready) answer.mutate(false);
			}}
		>
			<div className="flex items-start gap-3 rounded-2xl bg-surface-2/60 p-3">
				{agent && <AgentAvatar avatar={agent.avatar} size={36} state="waiting" />}
				<div className="min-w-0 text-[13px] leading-5">
					<div>
						<span className="font-semibold">{agent?.name ?? "A bot"}</span> wants to sign in to{" "}
						<span className="font-semibold">{request.site}</span>
					</div>
					<div className="text-fg-muted">{request.reason}</div>
					{request.hasSaved && (
						<div className="mt-1 text-xs text-fg-subtle">The saved login didn't work.</div>
					)}
				</div>
			</div>
			{wants("username") && (
				<Field label="Username or email">
					<Input
						autoFocus
						autoComplete="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
					/>
				</Field>
			)}
			{wants("password") && (
				<Field label="Password">
					<Input
						autoFocus={!wants("username")}
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
			)}
			{wants("otp") && (
				<Field label="One-time code" hint="From your authenticator app, text message or email.">
					<Input
						autoFocus={!wants("username") && !wants("password")}
						inputMode="numeric"
						autoComplete="one-time-code"
						value={otp}
						onChange={(e) => setOtp(e.target.value)}
						className="font-mono tracking-widest"
					/>
				</Field>
			)}
			{wants("password") && request.canRemember && (
				<label htmlFor={rememberId} className="flex cursor-pointer items-center gap-3 text-[13px]">
					<span className="flex-1">
						<span className="block font-medium">Remember for {agent?.name ?? "this bot"}</span>
						<span className="block text-xs text-fg-subtle">
							Kept encrypted on your Sekai server, so it can sign in to {request.site} again without
							asking.
						</span>
					</span>
					<Switch id={rememberId} checked={remember} onCheckedChange={setRemember} label="Remember" />
				</label>
			)}
			<p className="flex items-center gap-1.5 text-xs text-fg-subtle">
				<Lock className="size-3.5" /> Typed straight into the page. {agent?.name ?? "The bot"} never sees it.
			</p>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="secondary"
					onClick={() => answer.mutate(true)}
					disabled={answer.isPending}
				>
					Don't sign in
				</Button>
				<Button type="submit" variant="primary" disabled={!ready || answer.isPending}>
					<KeyRound /> Sign in
				</Button>
			</div>
		</form>
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
			size="sm"
		>
			{request && <LoginForm key={request.id} request={request} onDone={() => void refetch()} />}
		</Dialog>
	);
}

export { LoginForm };
