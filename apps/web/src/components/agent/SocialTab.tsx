import { api, cn } from "@sekai/client";
import type { Agent, IgAccount, TtAccount } from "@sekai/shared";
import { Badge, Button, Callout, Confirm, Field, Input, Section, Spinner, Switch } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Account = IgAccount & TtAccount;

const LOOK = {
	instagram: { title: "Instagram", domain: "instagram.com", cookie: "sessionid", color: "#E1306C" },
	tiktok: { title: "TikTok", domain: "www.tiktok.com", cookie: "sessionid", color: "#010101" },
} as const;

export function SocialIcon({
	platform,
	size = 34,
	className,
}: {
	platform: "instagram" | "tiktok";
	size?: number;
	className?: string;
}) {
	const l = LOOK[platform];
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center justify-center rounded-[28%] text-white", className)}
			style={{ width: size, height: size, background: l.color }}
		>
			{platform === "instagram" ? (
				<svg
					viewBox="0 0 24 24"
					width={size * 0.56}
					height={size * 0.56}
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden
				>
					<rect x="3" y="3" width="18" height="18" rx="5" />
					<circle cx="12" cy="12" r="4" />
					<circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
				</svg>
			) : (
				<svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden>
					<path d="M16.5 3c.4 2.3 1.9 3.7 4.2 3.9v3.1c-1.6 0-3-.5-4.2-1.3v6.6c0 3.5-2.6 6-6 6-3.3 0-5.8-2.4-5.8-5.6 0-3.4 3-5.9 6.6-5.5v3.2c-1.8-.4-3.4.7-3.4 2.4 0 1.5 1.2 2.5 2.6 2.5 1.6 0 2.8-1.2 2.8-3V3h3.4Z" />
				</svg>
			)}
		</span>
	);
}

interface SocialApi {
	get(agentId: string): Promise<Account | null>;
	connect(
		agentId: string,
		body: { sessionId: string; answerMentions: boolean; allowFrom: string[] },
	): Promise<Account>;
	update(agentId: string, body: { answerMentions?: boolean; allowFrom?: string[] }): Promise<Account>;
	disconnect(agentId: string): Promise<unknown>;
}

/** Give a bot an Instagram or TikTok account: it messages you and acts there, and drives the app in its browser. */
export function SocialTab({ agent, platform }: { agent: Agent; platform: "instagram" | "tiktok" }) {
	const l = LOOK[platform];
	const qc = useQueryClient();
	const key = [platform, agent.id] as const;
	const social = api[platform] as unknown as SocialApi;
	const { data: account, isLoading } = useQuery({ queryKey: key, queryFn: () => social.get(agent.id) });
	const [session, setSession] = useState("");
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
			.map((h) => h.replace(/^@/, "").trim().toLowerCase())
			.filter(Boolean);
	const refresh = (a: unknown) => {
		qc.setQueryData(key, a);
		void qc.invalidateQueries({ queryKey: ["agentTools"] });
	};
	const connect = useMutation({
		mutationFn: () =>
			social.connect(agent.id, { sessionId: session.trim(), answerMentions: answer, allowFrom: list() }),
		onSuccess: (a) => {
			refresh(a);
			setSession("");
			toast.success(`${agent.name} is signed in as @${a.handle}`);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const update = useMutation({
		mutationFn: (patch: { answerMentions?: boolean; allowFrom?: string[] }) => social.update(agent.id, patch),
		onSuccess: refresh,
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const remove = useMutation({ mutationFn: () => social.disconnect(agent.id), onSuccess: () => refresh(null) });

	if (isLoading) return <Spinner />;

	const cookieHint = (
		<>
			In a browser signed in to the bot's account: {l.domain} → DevTools (F12) → Application → Cookies →{" "}
			<strong>{l.cookie}</strong>. It's the whole login, so keep it secret. Stored encrypted.
		</>
	);

	if (!account) {
		return (
			<div className="flex flex-col gap-5">
				<div className="flex items-start gap-3">
					<SocialIcon platform={platform} size={40} />
					<p className="text-[13px] leading-5 text-fg-muted">
						Give {agent.name} an {l.title} account: it messages you, answers DMs, and drives the app in its
						own browser (watch videos, post, scroll) when you ask. Use an account made for the bot.
					</p>
				</div>
				<Field label={l.cookie} hint={cookieHint}>
					<Input
						type="password"
						autoComplete="off"
						value={session}
						onChange={(e) => setSession(e.target.value)}
						className="font-mono text-[13px]"
					/>
				</Field>
				<Field
					label="Answer DMs from"
					hint="Your handle. DMs from anyone else are ignored (checked by account, before the bot sees them)."
				>
					<Input value={handles} onChange={(e) => setHandles(e.target.value)} placeholder="@yourhandle" />
				</Field>
				<Callout icon={<ShieldAlert />}>
					Automating an {l.title} account goes against {l.title}'s rules, so the account could get limited.
					Sekai acts like a normal signed-in session and only does what you ask.
				</Callout>
				<Button
					variant="primary"
					disabled={session.trim().length < 10 || connect.isPending}
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
				<SocialIcon platform={platform} size={40} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold">{account.name}</div>
					<a
						href={
							platform === "instagram"
								? `https://instagram.com/${account.handle}`
								: `https://www.tiktok.com/@${account.handle}`
						}
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
				<Callout icon={<KeyRound />} title={`${l.title} signed it out`}>
					{account.error} Paste a fresh {l.cookie} below.
				</Callout>
			)}
			<Section
				title="Direct messages"
				description={`When someone you allow DMs @${account.handle}, ${agent.name} answers there.`}
			>
				<div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3.5">
					<div>
						<div className="text-sm font-medium">Answer DMs</div>
						<div className="text-xs text-fg-subtle">Checked in your browser session.</div>
					</div>
					<Switch
						checked={account.answerMentions}
						label="Answer DMs"
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
			</Section>
			<Section title="Sign-in">
				<Field label={`New ${l.cookie}`} hint={`Only if ${l.title} signed the bot out.`}>
					<div className="flex gap-2">
						<Input
							type="password"
							autoComplete="off"
							value={session}
							onChange={(e) => setSession(e.target.value)}
							className="font-mono text-[13px]"
						/>
						<Button
							variant="secondary"
							disabled={session.trim().length < 10 || connect.isPending}
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
				description={`The bot stops messaging and acting on ${l.title}. The session is deleted from Sekai.`}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</div>
	);
}
