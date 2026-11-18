import { api, cn } from "@sekai/client";
import { type Agent, cleanHandle } from "@sekai/shared";
import { Badge, Button, Callout, Confirm, Field, Input, Section, Spinner, Switch } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** X's mark, in the same tile shape as the other app icons. */
export function XIcon({ size = 34, className }: { size?: number; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center rounded-[28%] bg-foreground text-background",
				className,
			)}
			style={{ width: size, height: size }}
		>
			<svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden>
				<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
			</svg>
		</span>
	);
}

const key = (agentId: string) => ["x", agentId] as const;

/** Give a bot an X account: it posts when you ask, and answers your @mentions (only yours). */
export function XTab({ agent }: { agent: Agent }) {
	const qc = useQueryClient();
	const { data: account, isLoading } = useQuery({ queryKey: key(agent.id), queryFn: () => api.x.get(agent.id) });
	const [token, setToken] = useState("");
	const [handles, setHandles] = useState("");
	const [answer, setAnswer] = useState(true);
	const [removing, setRemoving] = useState(false);
	useEffect(() => {
		if (account) {
			setHandles(account.allowFrom.map((h) => `@${h}`).join(", "));
			setAnswer(account.answerMentions);
		}
	}, [account]);
	const list = () =>
		handles
			.split(/[\s,]+/)
			.map(cleanHandle)
			.filter(Boolean);
	const refresh = (a: unknown) => {
		qc.setQueryData(key(agent.id), a);
		void qc.invalidateQueries({ queryKey: ["agentTools"] });
	};
	const connect = useMutation({
		mutationFn: () =>
			api.x.connect(agent.id, { authToken: token.trim(), answerMentions: answer, allowFrom: list() }),
		onSuccess: (a) => {
			refresh(a);
			setToken("");
			toast.success(`${agent.name} is signed in as @${a.handle}`);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const update = useMutation({
		mutationFn: (patch: Parameters<typeof api.x.update>[1]) => api.x.update(agent.id, patch),
		onSuccess: refresh,
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const remove = useMutation({ mutationFn: () => api.x.disconnect(agent.id), onSuccess: () => refresh(null) });

	if (isLoading) return <Spinner />;
	if (!account) {
		return (
			<div className="flex flex-col gap-5">
				<div className="flex items-start gap-3">
					<XIcon size={40} />
					<p className="text-[13px] leading-5 text-fg-muted">
						Give {agent.name} an X account: it posts, replies, searches and reads when you ask, and answers
						when you @mention it there. Use an account made for the bot.
					</p>
				</div>
				<Field
					label="auth_token"
					hint="In a browser signed in to the bot's account: x.com → DevTools (F12) → Application → Cookies → https://x.com → auth_token. It's the whole login, so keep it secret. Stored encrypted."
				>
					<Input
						type="password"
						autoComplete="off"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						className="font-mono text-[13px]"
					/>
				</Field>
				<Field
					label="Answer mentions from"
					hint="Your handle. Mentions from anyone else are ignored (checked by account, before the bot sees them)."
				>
					<Input value={handles} onChange={(e) => setHandles(e.target.value)} placeholder="@yourhandle" />
				</Field>
				<Callout icon={<ShieldCheck />}>
					Automating an X account goes against X's rules, so the account could get locked. Sekai acts like a
					normal web session and only does what you ask.
				</Callout>
				<Button
					variant="primary"
					disabled={token.trim().length < 20 || connect.isPending}
					onClick={() => connect.mutate()}
				>
					{connect.isPending ? <Spinner className="text-primary-foreground" /> : <KeyRound />} Sign in
				</Button>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<XIcon size={40} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold">{account.name}</div>
					<a
						href={`https://x.com/${account.handle}`}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-[13px] text-fg-subtle hover:text-fg"
					>
						@{account.handle} <ExternalLink className="size-3" />
					</a>
				</div>
				<Badge tone={account.error ? "danger" : "success"}>{account.error ? "Signed out" : "Signed in"}</Badge>
			</div>
			{account.error && (
				<Callout icon={<KeyRound />} title="X signed it out">
					{account.error} Paste a fresh auth_token below.
				</Callout>
			)}
			<Section
				title="Mentions"
				description={`When someone you allow posts “@${account.handle} …”, ${agent.name} answers there.`}
			>
				<div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3.5">
					<div>
						<div className="text-sm font-medium">Answer mentions</div>
						<div className="text-xs text-fg-subtle">Checked about once a minute.</div>
					</div>
					<Switch
						checked={account.answerMentions}
						label="Answer mentions"
						onCheckedChange={(on) => update.mutate({ answerMentions: on })}
					/>
				</div>
				<Field label="Only from" hint="Everyone else is ignored, checked by account id.">
					<div className="flex gap-2">
						<Input value={handles} onChange={(e) => setHandles(e.target.value)} placeholder="@yourhandle" />
						<Button
							variant="secondary"
							disabled={update.isPending || list().join() === account.allowFrom.join()}
							onClick={() => update.mutate({ allowFrom: list() })}
						>
							Save
						</Button>
					</div>
				</Field>
				{account.allowFrom.length === 0 && account.answerMentions && (
					<p className="text-[13px] text-warning">Add your handle, or {agent.name} answers nobody.</p>
				)}
			</Section>
			<Section title="Sign-in">
				<Field label="New auth_token" hint="Only if X signed the bot out.">
					<div className="flex gap-2">
						<Input
							type="password"
							autoComplete="off"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							className="font-mono text-[13px]"
						/>
						<Button
							variant="secondary"
							disabled={token.trim().length < 20 || connect.isPending}
							onClick={() => connect.mutate()}
						>
							{connect.isPending ? <Spinner /> : "Update"}
						</Button>
					</div>
				</Field>
				<Button variant="danger-ghost" size="sm" className={cn("self-start")} onClick={() => setRemoving(true)}>
					<LogOut /> Remove the account
				</Button>
			</Section>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove @${account.handle} from ${agent.name}?`}
				description="The bot stops posting and answering on X. The token is deleted from Sekai."
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}
