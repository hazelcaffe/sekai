import { api } from "@sekai/client";
import {
	type Agent,
	cleanHandle,
	cleanIgHandle,
	cleanTtHandle,
	type IgAccount,
	type TtAccount,
	type XAccount,
} from "@sekai/shared";
import {
	Badge,
	Callout,
	Confirm,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	Input,
	List,
	Page,
	type PageBack,
	PasswordInput,
	Row,
	SaveState,
	Section,
	SkeletonRows,
	ToggleRow,
	useAutosave,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { AccountMark } from "./AccountMark.tsx";
import { type SocialPlatform, useSocialAccount } from "./accountStatus.tsx";
import { handlesText, parseHandles } from "./handles.ts";

type Account = XAccount | IgAccount | TtAccount;

interface Platform {
	title: string;
	/** The cookie (or token) that is the bot's whole login, and where to find it. */
	secret: string;
	minLength: number;
	where: string;
	profile: (handle: string) => string;
	clean: (h: string) => string;
	/** What it answers there: "mentions" or "DMs". */
	answers: "mentions" | "DMs";
	intro: (name: string) => string;
	risk: string;
	connect: (agentId: string, secret: string, answerMentions: boolean, allowFrom: string[]) => Promise<Account>;
	update: (agentId: string, patch: { answerMentions?: boolean; allowFrom?: string[] }) => Promise<Account>;
	disconnect: (agentId: string) => Promise<unknown>;
}

const PLATFORMS: Record<SocialPlatform, Platform> = {
	x: {
		title: "X",
		secret: "auth_token",
		minLength: 20,
		where: "In a browser signed in to the bot's account: x.com → DevTools (F12) → Application → Cookies → https://x.com → auth_token.",
		profile: (h) => `https://x.com/${h}`,
		clean: cleanHandle,
		answers: "mentions",
		intro: (name) =>
			`${name} posts, replies, searches and reads on X when you ask, and answers when you @mention it there.`,
		risk: "Automating an X account goes against X's rules, so the account could get locked. Sekai acts like a normal web session and only does what you ask.",
		connect: (id, authToken, answerMentions, allowFrom) =>
			api.x.connect(id, { authToken, answerMentions, allowFrom }),
		update: (id, patch) => api.x.update(id, patch),
		disconnect: (id) => api.x.disconnect(id),
	},
	instagram: {
		title: "Instagram",
		secret: "sessionid",
		minLength: 10,
		where: "In a browser signed in to the bot's account: instagram.com → DevTools (F12) → Application → Cookies → sessionid.",
		profile: (h) => `https://instagram.com/${h}`,
		clean: cleanIgHandle,
		answers: "DMs",
		intro: (name) =>
			`${name} messages you, answers DMs, and drives the app in its own browser (watch videos, post, scroll) when you ask.`,
		risk: "Automating an Instagram account goes against Instagram's rules, so the account could get limited. Sekai acts like a normal signed-in session and only does what you ask.",
		connect: (id, sessionId, answerMentions, allowFrom) =>
			api.instagram.connect(id, { sessionId, answerMentions, allowFrom }),
		update: (id, patch) => api.instagram.update(id, patch),
		disconnect: (id) => api.instagram.disconnect(id),
	},
	tiktok: {
		title: "TikTok",
		secret: "sessionid",
		minLength: 10,
		where: "In a browser signed in to the bot's account: www.tiktok.com → DevTools (F12) → Application → Cookies → sessionid.",
		profile: (h) => `https://www.tiktok.com/@${h}`,
		clean: cleanTtHandle,
		answers: "DMs",
		intro: (name) =>
			`${name} messages you, answers DMs, and drives the app in its own browser (watch videos, post, scroll) when you ask.`,
		risk: "Automating a TikTok account goes against TikTok's rules, so the account could get limited. Sekai acts like a normal signed-in session and only does what you ask.",
		connect: (id, sessionId, answerMentions, allowFrom) =>
			api.tiktok.connect(id, { sessionId, answerMentions, allowFrom }),
		update: (id, patch) => api.tiktok.update(id, patch),
		disconnect: (id) => api.tiktok.disconnect(id),
	},
};

/** Not connected yet: the bot's login, who it answers, and Sign in. */
function ConnectForm({ agent, platform }: { agent: Agent; platform: SocialPlatform }) {
	const p = PLATFORMS[platform];
	const qc = useQueryClient();
	const form = useFormValues({ secret: "", handles: "" });
	const { values } = form;
	return (
		<FormGroup
			dirty={Boolean(values.secret || values.handles)}
			disabled={values.secret.trim().length < p.minLength}
			submitLabel="Sign in"
			onCancel={() => form.reset()}
			onSubmit={async () => {
				const account = await p.connect(
					agent.id,
					values.secret.trim(),
					true,
					parseHandles(values.handles, p.clean),
				);
				qc.setQueryData([platform, agent.id], account);
				void qc.invalidateQueries({ queryKey: ["agentTools"] });
				form.reset();
			}}
		>
			<Field label={p.secret} hint="The bot's whole login, so keep it secret. It's stored encrypted.">
				<PasswordInput
					autoComplete="off"
					value={values.secret}
					onChange={(e) => form.set("secret", e.target.value)}
					className="font-mono"
				/>
			</Field>
			<Fold variant="link" title="Where do I find it?">
				{p.where}
			</Fold>
			<Field
				label={`Answer ${p.answers} from`}
				optional
				hint={`Your handle. ${p.answers === "DMs" ? "DMs" : "Mentions"} from anyone else are ignored, checked by account.`}
			>
				<Input
					value={values.handles}
					onChange={(e) => form.set("handles", e.target.value)}
					placeholder="e.g. @yourhandle"
				/>
			</Field>
			<Callout icon={<ShieldCheck />}>{p.risk}</Callout>
		</FormGroup>
	);
}

/** Connected: how it's doing, who it answers, a fresh login if it was signed out, and removing it. */
function Manage({ agent, platform, account }: { agent: Agent; platform: SocialPlatform; account: Account }) {
	const p = PLATFORMS[platform];
	const qc = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const key = [platform, agent.id];
	const put = (a: unknown) => {
		qc.setQueryData(key, a);
		void qc.invalidateQueries({ queryKey: ["agentTools"] });
	};
	const answer = useAutosave((on: boolean) => p.update(agent.id, { answerMentions: on }).then(put));
	const remove = useMutation({ mutationFn: () => p.disconnect(agent.id), onSuccess: () => put(null) });
	const only = useFormValues({ handles: handlesText(account.allowFrom) });
	const login = useFormValues({ secret: "" });
	const Noun = p.answers === "DMs" ? "DMs" : "mentions";

	return (
		<>
			{account.error && (
				<Callout tone="warning" icon={<KeyRound />} title={`${p.title} signed it out`}>
					{account.error} Paste a fresh {p.secret} below.
				</Callout>
			)}
			<Section
				title={p.answers === "DMs" ? "Direct messages" : "Mentions"}
				description={`When someone you allow ${p.answers === "DMs" ? `DMs @${account.handle}` : `posts “@${account.handle} …”`}, ${agent.name} answers there.`}
				saveState={answer.status !== "idle" ? <SaveState state={answer} /> : undefined}
			>
				<List label={p.answers === "DMs" ? "Direct messages" : "Mentions"}>
					<ToggleRow
						title={`Answer ${Noun}`}
						description={
							p.answers === "DMs" ? "Checked in its browser session." : "Checked about once a minute."
						}
						checked={account.answerMentions}
						onCheckedChange={(on) => answer.save(on)}
					/>
				</List>
				<FormGroup
					dirty={only.dirty}
					onCancel={() => only.reset()}
					onSubmit={async () => {
						const allowFrom = parseHandles(only.values.handles, p.clean);
						put(await p.update(agent.id, { allowFrom }));
						only.reset({ handles: handlesText(allowFrom) });
					}}
				>
					<Field label="Only from" hint="Everyone else is ignored, checked by account.">
						<Input
							value={only.values.handles}
							onChange={(e) => only.set("handles", e.target.value)}
							placeholder="e.g. @yourhandle"
						/>
					</Field>
					{account.allowFrom.length === 0 && account.answerMentions && !only.dirty && (
						<p className="text-small text-warning-ink">Add your handle, or {agent.name} answers nobody.</p>
					)}
				</FormGroup>
			</Section>
			<Section title="Sign-in" description={`Only needed if ${p.title} signed the bot out.`}>
				<FormGroup
					dirty={login.dirty}
					disabled={login.values.secret.trim().length < p.minLength}
					submitLabel="Update"
					onCancel={() => login.reset()}
					onSubmit={async () => {
						put(
							await p.connect(
								agent.id,
								login.values.secret.trim(),
								account.answerMentions,
								account.allowFrom,
							),
						);
						login.reset();
					}}
				>
					<Field label={`New ${p.secret}`}>
						<PasswordInput
							autoComplete="off"
							value={login.values.secret}
							onChange={(e) => login.set("secret", e.target.value)}
							className="font-mono"
						/>
					</Field>
					<Fold variant="link" title="Where do I find it?">
						{p.where}
					</Fold>
				</FormGroup>
			</Section>
			<List label="Remove">
				<Row
					icon={<Trash2 />}
					iconTone="danger"
					title="Remove the account"
					subtitle={`${agent.name} stops using it. Its login is deleted from Sekai.`}
					danger
					onClick={() => setRemoving(true)}
				/>
			</List>
			<Confirm
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove @${account.handle} from ${agent.name}?`}
				description={`${agent.name} stops using ${p.title}, and its login is deleted from Sekai.`}
				confirmLabel="Remove"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}

/** The bot's X, Instagram or TikTok account: connect it, or look after it. */
export function SocialAccount({ agent, platform, back }: { agent: Agent; platform: SocialPlatform; back: PageBack }) {
	const p = PLATFORMS[platform];
	const account = useSocialAccount(platform, agent.id);
	const data = account.data;
	return (
		<Page
			back={back}
			title={p.title}
			description={
				data ? (
					<a
						href={p.profile(data.handle)}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 hover:text-fg"
					>
						@{data.handle} <ExternalLink className="size-4" />
					</a>
				) : (
					p.intro(agent.name)
				)
			}
			actions={
				data ? (
					<Badge tone={data.error ? "warning" : "success"}>{data.error ? "Signed out" : "Signed in"}</Badge>
				) : undefined
			}
		>
			{account.isLoading ? (
				<SkeletonRows count={3} leading={false} />
			) : account.isError ? (
				<ErrorState error={account.error} onRetry={() => void account.refetch()} />
			) : data ? (
				<Manage agent={agent} platform={platform} account={data} />
			) : (
				<>
					<div className="flex items-center gap-3">
						<AccountMark platform={platform} size={40} />
						<p className="text-small text-fg-muted">Use an account made for the bot, not your own.</p>
					</div>
					<ConnectForm agent={agent} platform={platform} />
				</>
			)}
		</Page>
	);
}
