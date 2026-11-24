import { AgentAvatar, api, haptic, qk, useAccess, useSignalStatus } from "@sekai/client";
import {
	type Agent,
	normalizePhone,
	PHONE_NUMBER,
	SIGNAL_CAPTCHA_URL,
	type SignalEngineStatus,
	type SignalLink,
} from "@sekai/shared";
import {
	Button,
	Callout,
	CodeInput,
	Field,
	FormGroup,
	Input,
	Page,
	type PageBack,
	PasswordInput,
	Section,
	Segmented,
	SkeletonRows,
	StatusDot,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCw, ShieldAlert, Smartphone, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { avatarPng, blobDataUrl } from "../../lib/avatarPng.ts";
import { actionError, saveForm, useAfterSave } from "../../lib/forms.ts";

/** The bot's avatar as a PNG for its Signal profile (null when it can't be drawn: the profile keeps its picture). */
export async function profilePicture(element: HTMLElement | null, agent: Agent): Promise<string | undefined> {
	if (!element) return undefined;
	try {
		return await blobDataUrl(await avatarPng(element, agent, { circle: true }));
	} catch {
		return undefined;
	}
}

/** Numbered steps in one quiet box. */
export function StepList({ steps }: { steps: ReactNode[] }) {
	return (
		<ol className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-body">
			{steps.map((step, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the steps are fixed and in order
				<li key={i} className="flex gap-3">
					<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-semibold">
						{i + 1}
					</span>
					<span className="min-w-0 pt-px">{step}</span>
				</li>
			))}
		</ol>
	);
}

/**
 * signal-cli on this server, when it isn't ready: admins can install it (or are told what to install by hand), others
 * are told to ask an admin. Nothing when it's installed and fine.
 */
export function SignalEngineNotice({ status }: { status: SignalEngineStatus }) {
	const { admin } = useAccess();
	const qc = useQueryClient();
	const install = useMutation({
		mutationFn: api.signal.install,
		onSuccess: (next) => qc.setQueryData(qk.signalStatus, next),
		onError: actionError,
	});
	const restart = useMutation({
		mutationFn: api.signal.restart,
		onSuccess: (next) => qc.setQueryData(qk.signalStatus, next),
		onError: actionError,
	});
	if (status.state === "installing") {
		const pct = status.progress === null ? null : Math.round(status.progress * 100);
		return (
			<Callout tone="info" icon={<Download />} title="Installing Signal">
				Downloading signal-cli{pct === null ? "" : ` (${pct}%)`}. You can leave this page; it's ready in a
				minute or two.
			</Callout>
		);
	}
	if (!status.installed) {
		if (!admin)
			return (
				<Callout tone="info" icon={<ShieldAlert />} title="Signal isn't set up on this server">
					Ask an admin to set up Signal.
				</Callout>
			);
		return (
			<Callout
				tone="warning"
				icon={<Download />}
				title="Signal isn't set up on this server"
				action={
					status.canInstall ? (
						<Button variant="primary" loading={install.isPending} onClick={() => install.mutate()}>
							<Download /> Install it
						</Button>
					) : undefined
				}
			>
				{status.canInstall
					? `Sekai talks to Signal through signal-cli, an open-source Signal app for servers (a 120 MB download).${status.error && !/isn't set up/.test(status.error) ? ` Last try: ${status.error}` : ""}`
					: (status.installNote ?? status.error)}
			</Callout>
		);
	}
	if (status.state === "error") {
		return (
			<Callout
				tone="danger"
				icon={<TriangleAlert />}
				title="Signal isn't running on this server"
				action={
					admin ? (
						<Button
							variant="secondary"
							size="sm"
							loading={restart.isPending}
							onClick={() => restart.mutate()}
						>
							<RefreshCw /> Restart
						</Button>
					) : undefined
				}
			>
				{status.error ?? "It stopped. Sekai is trying again."}
			</Callout>
		);
	}
	return null;
}

/**
 * Linking signal-cli to Signal on a phone: a code to scan (it works for two minutes), then it's the bot's account.
 * With `channelId`, the same account links again (its link was removed on the phone) and keeps its chats.
 */
export function SignalLinkFlow({
	agent,
	channelId,
	onLinked,
}: {
	agent: Agent;
	channelId?: string;
	onLinked: (channelId: string) => void;
}) {
	const qc = useQueryClient();
	const [id, setId] = useState<string | null>(null);
	const start = useMutation({
		mutationFn: () => api.signal.startLink({ agentId: agent.id, channelId }),
		onSuccess: (link) => {
			qc.setQueryData(["signal", "link", link.id], link);
			setId(link.id);
		},
		onError: actionError,
	});
	const link = useQuery({
		queryKey: ["signal", "link", id ?? ""],
		queryFn: () => api.signal.link(id ?? ""),
		enabled: Boolean(id),
		refetchInterval: (q) => ((q.state.data as SignalLink | undefined)?.state === "waiting" ? 1500 : false),
	});
	const state = link.data?.state;
	const linkedTo = state === "linked" ? link.data?.channelId : null;
	const opened = useRef<string | null>(null);
	useEffect(() => {
		if (!linkedTo || opened.current === linkedTo) return;
		opened.current = linkedTo;
		haptic("success");
		void qc.invalidateQueries({ queryKey: ["channels"] });
		onLinked(linkedTo);
	}, [linkedTo, onLinked, qc]);
	const showing = state === "waiting" ? link.data : null;

	return (
		<Section
			title={channelId ? "Link it again" : "Link it to the phone"}
			description={
				channelId
					? "Its link was removed on the phone. Link it again and it carries on with its chats."
					: "Sekai becomes a linked device of that Signal account."
			}
		>
			<StepList
				steps={[
					"On the bot's phone, open Signal → Settings → Linked devices → Link new device.",
					"Scan the code here with it. The code works for two minutes.",
					channelId
						? "It carries on here, with the same chats and the same people it answers."
						: `Sekai opens the account's page. Then message ${agent.name} from your own Signal to pair with it.`,
				]}
			/>
			<div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center">
				<div className="flex size-56 shrink-0 items-center justify-center rounded-lg border border-border bg-paper p-2">
					{showing ? (
						<img src={showing.qr} alt="Code to scan in Signal on the phone" className="size-full" />
					) : (
						<Smartphone className="size-10 text-paper-ink opacity-40" aria-hidden />
					)}
				</div>
				<div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center sm:items-start sm:text-left">
					{showing ? (
						<span className="inline-flex items-center gap-2 text-body" role="status">
							<StatusDot tone="brand" label="Waiting" />
							Waiting for the phone to scan it…
						</span>
					) : state === "linked" ? (
						<span className="inline-flex items-center gap-2 text-body" role="status">
							<StatusDot tone="success" label="Linked" />
							Linked. Opening its page…
						</span>
					) : (
						<>
							{(state === "expired" || state === "failed") && (
								<p role="alert" className="text-small text-danger-ink">
									{link.data?.error ??
										(state === "expired" ? "The code expired." : "Signal didn't link it.")}
								</p>
							)}
							<p className="text-small text-fg-muted">
								The code lets that phone's Signal account sign Sekai in, so keep it to yourself.
							</p>
							<Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
								{state === "expired" || state === "failed" ? "Show a new code" : "Show the code"}
							</Button>
						</>
					)}
				</div>
			</div>
		</Section>
	);
}

/**
 * Registering a number here: a captcha (Signal asks for one), a code by text (or a call), then verify. The number
 * becomes the bot's own account, with its name and picture on Signal.
 */
export function SignalRegisterFlow({
	agent,
	channelId,
	number: presetNumber,
	onRegistered,
}: {
	agent: Agent;
	channelId?: string;
	number?: string;
	onRegistered: (channelId: string) => void;
}) {
	const after = useAfterSave();
	const avatar = useRef<HTMLDivElement>(null);
	const form = useFormValues({ number: presetNumber ?? "", captcha: "", code: "", pin: "" });
	const { values } = form;
	const [sent, setSent] = useState<"text" | "call" | null>(null);
	const [calling, setCalling] = useState(false);
	const number = normalizePhone(values.number);
	const validNumber = PHONE_NUMBER.test(number);

	const request = async (voice: boolean) => {
		await api.signal.register({
			agentId: agent.id,
			number,
			captcha: values.captcha.trim() || undefined,
			voice,
			channelId,
		});
		setSent(voice ? "call" : "text");
	};
	const call = async () => {
		setCalling(true);
		try {
			await request(true);
		} catch (err) {
			actionError(err);
		} finally {
			setCalling(false);
		}
	};

	if (!sent) {
		return (
			<Section
				title={channelId ? "Register it again" : "Register a number"}
				description={
					channelId
						? "Signal signed the number out here. Register it again and it carries on with its chats."
						: "Signal texts it a code, and the number becomes the bot's own."
				}
			>
				<FormGroup
					dirty={Boolean(values.number.trim())}
					disabled={!validNumber}
					submitLabel="Text me a code"
					onCancel={() => form.reset()}
					onSubmit={() => saveForm(() => request(false))}
				>
					<Field
						label="The bot's number"
						hint="With its country code. A number that can get a text or a call, and isn't on Signal elsewhere."
					>
						<Input
							type="tel"
							inputMode="tel"
							autoComplete="off"
							value={values.number}
							onChange={(e) => form.set("number", e.target.value)}
							placeholder="e.g. +1 555 010 0199"
						/>
					</Field>
					<Field
						label="Captcha"
						hint={
							<>
								Signal asks for one first.{" "}
								<a
									href={SIGNAL_CAPTCHA_URL}
									target="_blank"
									rel="noreferrer"
									className="font-medium text-brand-ink hover:underline"
								>
									Solve it here
								</a>
								, then copy the Open Signal link (right-click it, or touch and hold) and paste it.
							</>
						}
					>
						<Input
							autoComplete="off"
							value={values.captcha}
							onChange={(e) => form.set("captcha", e.target.value)}
							placeholder="signalcaptcha://…"
							className="font-mono"
						/>
					</Field>
				</FormGroup>
			</Section>
		);
	}

	return (
		<Section
			title="Enter the code"
			description={
				sent === "call"
					? `Signal is calling ${number} with a six-digit code.`
					: `Signal texted ${number} a six-digit code.`
			}
		>
			<FormGroup
				dirty={values.code.length === 6}
				submitLabel="Verify"
				onCancel={() => {
					form.set("code", "");
					setSent(null);
				}}
				extra={
					sent === "text" ? (
						<Button variant="ghost" loading={calling} onClick={() => void call()}>
							Call me instead
						</Button>
					) : undefined
				}
				onSubmit={() =>
					saveForm(async () => {
						const picture = await profilePicture(avatar.current, agent);
						const { channelId: id } = await api.signal.verify({
							agentId: agent.id,
							number,
							code: values.code,
							pin: values.pin.trim() || undefined,
							avatar: picture,
							channelId,
						});
						haptic("success");
						form.reset();
						after(() => onRegistered(id));
					})
				}
			>
				<Field label="Code">
					<CodeInput
						length={6}
						value={values.code}
						onChange={(v) => form.set("code", v.replace(/\D/g, ""))}
					/>
				</Field>
				<Field
					label="Registration lock PIN"
					optional
					hint="Signal asks for it if this number had one. A new one stops others from registering the bot's number."
				>
					<PasswordInput
						autoComplete="off"
						value={values.pin}
						onChange={(e) => form.set("pin", e.target.value)}
					/>
				</Field>
				<div className="flex items-center gap-3">
					<div ref={avatar} className="shrink-0">
						<AgentAvatar avatar={agent.avatar} size={36} />
					</div>
					<p className="text-small text-fg-muted">
						Its Signal profile gets {agent.name}'s name and picture.
						{agent.avatar.kind === "gallery" && (
							<span className="block text-caption text-fg-subtle">
								© SEGA / © Colorful Palette Inc. / © Crypton Future Media, INC. www.piapro.net
							</span>
						)}
					</p>
				</div>
			</FormGroup>
		</Section>
	);
}

/** Connecting a bot to Signal: link a phone made for it (recommended) or register a number, as steps. */
export function SignalConnect({
	agent,
	back,
	onConnected,
}: {
	agent: Agent;
	back: PageBack;
	onConnected: (channelId: string) => void;
}) {
	const status = useSignalStatus();
	const [way, setWay] = useState<"link" | "register">("link");
	const ready = status.data?.installed && status.data.state !== "installing";

	return (
		<Page back={back} title="Connect Signal" description={`Give ${agent.name} its own Signal account.`}>
			<Callout tone="warning" icon={<ShieldAlert />}>
				{agent.name} speaks as this Signal account: use a number made for the bot, never your own.
			</Callout>
			{status.isLoading ? (
				<SkeletonRows count={2} />
			) : status.data ? (
				<SignalEngineNotice status={status.data} />
			) : null}
			{ready && (
				<>
					<Section title="How to connect">
						<Segmented
							label="How to connect"
							value={way}
							onValueChange={setWay}
							options={[
								{ value: "link", label: "Link to a phone" },
								{ value: "register", label: "Register a number" },
							]}
						/>
						<p className="text-small text-fg-muted">
							{way === "link"
								? "Recommended. A phone made for the bot keeps its Signal; Sekai links to it, like Signal Desktop."
								: "No phone needed afterwards: a number that can get a text or a call becomes the bot's."}
						</p>
						<a
							href="https://github.com/AsamK/signal-cli"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 self-start text-small font-medium text-brand-ink hover:underline coarse:py-2"
						>
							About signal-cli <ExternalLink className="size-4" />
						</a>
					</Section>
					{way === "link" ? (
						<SignalLinkFlow agent={agent} onLinked={onConnected} />
					) : (
						<SignalRegisterFlow agent={agent} onRegistered={onConnected} />
					)}
				</>
			)}
		</Page>
	);
}
