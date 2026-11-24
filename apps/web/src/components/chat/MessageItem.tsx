import {
	AgentAvatar,
	api,
	assetUrl,
	ChatImage,
	cn,
	copyText,
	formatBytes,
	formatTokens,
	Markdown,
	shortTime,
	useAccess,
	useReadAloud,
} from "@sekai/client";
import { type Agent, type AudioPart, channelTitle, type Message, messageText, type ToolPart } from "@sekai/shared";
import {
	Confirm,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	Fold,
	IconButton,
	type MenuEntry,
	Spinner,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowRightLeft,
	AudioLines,
	Bell,
	Check,
	Clock,
	Copy,
	Eraser,
	FileText,
	FlaskConical,
	ListChecks,
	MessageCircleQuestion,
	MoreHorizontal,
	Reply,
	RotateCcw,
	Square,
	Sunrise,
	Trash2,
	Volume2,
} from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import { useLongPress } from "../../lib/hooks.ts";
import { ChatJob } from "../../pages/JobPage.tsx";
import { useAgentPresence } from "../../stores/ui.ts";
import { AdvisorBlock, NoticeLine, ReasoningBlock, ToolCard } from "./Parts.tsx";
import { RetryButton, VersionSwitcher } from "./RetryControls.tsx";
import { VoiceNote } from "./VoiceNote.tsx";

function isQuietTool(part: Message["parts"][number] | undefined): part is ToolPart {
	return part?.type === "tool" && part.status !== "awaiting_approval";
}

function imageSource(source?: string) {
	try {
		const url = new URL(source ?? "");
		return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
	} catch {
		return undefined;
	}
}

function Attachments({ message, align }: { message: Message; align: "start" | "end" }) {
	if (message.attachments.length === 0) return null;
	const images = message.attachments.filter((a) => a.kind === "image");
	const files = message.attachments.filter((a) => a.kind !== "image");
	return (
		<div
			className={cn("mb-2 flex min-w-0 max-w-full flex-col gap-2", align === "end" ? "items-end" : "items-start")}
		>
			{images.length > 0 && (
				<div className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
					{images.map((a) => (
						<a key={a.id} href={assetUrl(a.url)} target="_blank" rel="noreferrer">
							<img
								src={assetUrl(a.url)}
								alt={a.name}
								className="max-h-72 max-w-full rounded-lg border border-border object-contain"
								loading="lazy"
							/>
						</a>
					))}
				</div>
			)}
			{files.map((a) => (
				<a
					key={a.id}
					href={assetUrl(a.url)}
					target="_blank"
					rel="noreferrer"
					className="flex max-w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-body hover:bg-surface-2"
				>
					<FileText className="size-5 shrink-0 text-fg-subtle" />
					<span className="min-w-0">
						<span className="block truncate font-medium">{a.name}</span>
						<span className="block text-small text-fg-subtle">{formatBytes(a.size)}</span>
					</span>
				</a>
			))}
		</div>
	);
}

function TriggerBadge({ message, agents }: { message: Message; agents: Map<string, Agent> }) {
	const t = message.meta.trigger;
	const base = "inline-flex items-center gap-1 text-caption font-medium text-fg-subtle [&_svg]:size-4";
	if (message.meta.call?.kind === "speech")
		return (
			<span className={base}>
				<AudioLines /> Said on a call{message.meta.call.via === "discord" ? " (Discord)" : ""}
			</span>
		);
	if (t === "routine")
		return (
			<span className={base}>
				<Clock /> Routine
			</span>
		);
	if (t === "test")
		return (
			<span className={base}>
				<FlaskConical /> Test run
			</span>
		);
	if (t === "reminder")
		return (
			<span className={base}>
				<Bell /> Reminder
			</span>
		);
	if (t === "checkup")
		return (
			<span className={base}>
				<ListChecks /> Memory check-up
			</span>
		);
	if (t === "digest")
		return (
			<span className={base}>
				<Sunrise /> Morning digest
			</span>
		);
	if (t === "ask")
		return (
			<span className={base}>
				<MessageCircleQuestion /> Question
			</span>
		);
	if (t === "handoff" && message.meta.fromAgentId) {
		const from = agents.get(message.meta.fromAgentId);
		return (
			<span className={base}>
				<ArrowRightLeft /> Handoff{from && message.agentId === from.id ? "" : from ? ` from ${from.name}` : ""}
			</span>
		);
	}
	return null;
}

function CopyButton({ text }: { text: string }) {
	const [done, setDone] = useState(false);
	return (
		<IconButton
			label={done ? "Copied" : "Copy"}
			size="icon-sm"
			className="coarse:size-11"
			onClick={async () => {
				await copyText(text);
				setDone(true);
				setTimeout(() => setDone(false), 1400);
			}}
		>
			{done ? <Check /> : <Copy />}
		</IconButton>
	);
}

/** Plays the reply in its bot's voice (Settings → Voice, or the bot's own). */
function ReadAloudButton({ messageId }: { messageId: string }) {
	const { state, toggle } = useReadAloud(messageId, () => toast.error("Couldn't read this aloud. Try again."));
	return (
		<IconButton
			label={state === "idle" ? "Read aloud" : "Stop reading"}
			size="icon-sm"
			onClick={toggle}
			className={cn("coarse:size-11", state !== "idle" && "text-brand-ink")}
		>
			{state === "loading" ? (
				<Spinner />
			) : state === "playing" ? (
				<Square className="fill-current" />
			) : (
				<Volume2 />
			)}
		</IconButton>
	);
}

export const MessageItem = memo(function MessageItem({
	message,
	agents,
	isGroup,
	showHeader,
	isLastAgentMessage,
	onReply,
	replyTarget,
}: {
	message: Message;
	agents: Map<string, Agent>;
	isGroup: boolean;
	showHeader: boolean;
	isLastAgentMessage: boolean;
	onReply?: (m: Message) => void;
	replyTarget?: Message | null;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirm, setConfirm] = useState<"delete" | "retry" | null>(null);
	const canVoice = useAccess().can("voice");
	const longPress = useLongPress(() => setMenuOpen(true));
	const text = messageText(message);
	const del = useMutation({ mutationFn: () => api.messages.delete(message.id) });
	const retry = useMutation({ mutationFn: (wipe: boolean) => api.messages.retry(message.id, { wipe }) });
	const streaming = message.status === "streaming";
	const entries: MenuEntry[] = [
		Boolean(text) && { label: "Copy text", icon: <Copy />, onSelect: () => void copyText(text) },
		isGroup &&
			onReply &&
			message.sender === "agent" && { label: "Reply", icon: <Reply />, onSelect: () => onReply(message) },
		message.sender === "agent" &&
			!streaming && { label: "Try again", icon: <RotateCcw />, onSelect: () => retry.mutate(false) },
		message.sender === "agent" &&
			!streaming && {
				label: "Erase and try again",
				icon: <Eraser />,
				danger: true,
				onSelect: () => setConfirm("retry"),
			},
		{ label: "Delete message", icon: <Trash2 />, danger: true, onSelect: () => setConfirm("delete") },
	];
	const menu = (
		<>
			<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<DropdownTrigger asChild>
					<IconButton label="Message actions" size="icon-sm" className="coarse:size-11">
						<MoreHorizontal />
					</IconButton>
				</DropdownTrigger>
				<DropdownContent title="Message actions" align={message.sender === "user" ? "end" : "start"}>
					<DropdownEntries entries={entries} />
				</DropdownContent>
			</DropdownMenu>
			<Confirm
				open={Boolean(confirm)}
				onOpenChange={(open) => !open && setConfirm(null)}
				title={confirm === "retry" ? "Erase this answer?" : "Delete this message?"}
				description={
					confirm === "retry"
						? "This answer will be removed before the bot tries again."
						: "This message will be removed from the chat and cannot be restored."
				}
				confirmLabel={confirm === "retry" ? "Erase and retry" : "Delete"}
				danger
				onConfirm={() => (confirm === "retry" ? retry.mutate(true) : del.mutate())}
			/>
		</>
	);

	const replyQuote = replyTarget ? (
		<div className="mb-1 max-w-full truncate border-l-2 border-border-strong pl-2 text-small text-fg-subtle">
			{replyTarget.agentId ? `${agents.get(replyTarget.agentId)?.name ?? "Bot"}: ` : ""}
			{messageText(replyTarget).slice(0, 140)}
		</div>
	) : null;

	const voice = message.parts.find((p): p is AudioPart => p.type === "audio");
	if (message.sender === "system" && message.meta.jobId) return <ChatJob id={message.meta.jobId} />;
	if (message.sender === "user") {
		const via = message.meta.channel
			? `via ${channelTitle(message.meta.channel.type)}${message.meta.channel.isGroup ? ` · ${message.meta.channel.chatName ?? "group"}` : ""}`
			: null;
		return (
			<div className="group flex flex-col items-end px-4 pt-4 pb-1 md:px-6" {...longPress}>
				{replyQuote}
				<Attachments message={message} align="end" />
				{voice && <VoiceNote part={voice} className="mb-1 bg-surface-2" />}
				{text && voice ? (
					<p className="max-w-[min(85%,520px)] px-2 text-right text-small text-fg-subtle">{text}</p>
				) : null}
				{text && !voice && (
					<div className="flex max-w-[min(90%,40rem)] items-center justify-end gap-2">
						{message.meta.call && (
							<AudioLines className="size-4 shrink-0 text-fg-subtle" aria-label="On a call" />
						)}
						<div className="min-w-0 rounded-xl bg-surface-2 px-4 py-2.5 text-message whitespace-pre-wrap [overflow-wrap:anywhere]">
							{text}
						</div>
					</div>
				)}
				<div className="flex items-center gap-1 text-fg-subtle fine:opacity-0 fine:group-hover:opacity-100 fine:focus-within:opacity-100">
					<span className="text-caption">
						{shortTime(message.createdAt)}
						{via ? ` · ${via}` : ""}
						{message.meta.call
							? message.meta.call.kind === "task"
								? " · asked on a call"
								: " · said on a call"
							: ""}
					</span>
					{menu}
				</div>
			</div>
		);
	}

	const agent = message.agentId ? agents.get(message.agentId) : undefined;
	const name = agent?.name ?? (message.sender === "system" ? "Sekai" : "Former bot");
	const showActions = !streaming;
	const empty = message.parts.length === 0;

	const meta = [
		shortTime(message.createdAt),
		message.model,
		message.usage ? `${formatTokens(message.usage.inputTokens + message.usage.outputTokens)} tokens` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div
			className={cn("group relative flex gap-2 px-4 md:gap-3 md:px-6", showHeader ? "pt-3 pb-1" : "py-0.5")}
			{...longPress}
		>
			<div className="w-8 shrink-0 pt-0.5">
				{showHeader &&
					agent &&
					(streaming ? (
						<LiveAvatar agent={agent} conversationId={message.conversationId} />
					) : (
						<AgentAvatar avatar={agent.avatar} size={32} />
					))}
			</div>
			<div className="min-w-0 flex-1">
				{(showHeader && (isGroup || message.meta.trigger === "handoff")) ||
				message.meta.trigger ||
				message.meta.call?.kind === "speech" ? (
					<div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
						{showHeader && (isGroup || message.meta.trigger === "handoff") && (
							<span className="text-body font-semibold">{name}</span>
						)}
						<TriggerBadge message={message} agents={agents} />
					</div>
				) : null}
				{replyQuote}
				<Attachments message={message} align="start" />
				{empty && streaming && (
					<div className="flex h-7 items-center gap-1" role="status" aria-label="Thinking">
						<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
						<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
						<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
					</div>
				)}
				{message.parts.map((part, i, parts) => {
					// Parts are append-only, so their index is a stable identity.
					switch (part.type) {
						case "text":
							return part.text ? (
								<Markdown
									// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
									key={i}
									text={part.text}
									className="[overflow-wrap:anywhere] [&_pre]:[overflow-wrap:normal] [&_table]:my-0 [&_table]:min-w-min [&_table_:is(th,td)]:max-md:px-2"
								/>
							) : null;
						case "reasoning":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return part.text ? <ReasoningBlock key={i} part={part} streaming={streaming} /> : null;
						case "tool": {
							if (isQuietTool(part)) {
								if (isQuietTool(parts[i - 1])) return null;
								const tools = [part];
								for (let index = i + 1; isQuietTool(parts[index]); index++) {
									const next = parts[index];
									if (isQuietTool(next)) tools.push(next);
								}
								if (tools.length > 1) {
									const live = tools.some(
										(tool) => tool.status === "pending" || tool.status === "running",
									);
									const blocked = tools.filter(
										(tool) => tool.status === "denied" || tool.status === "error",
									).length;
									return (
										<Fold
											key={part.id}
											title={
												live
													? `Working · ${tools.length} actions`
													: `${tools.length} actions${blocked ? ` · ${blocked} didn't finish` : ""}`
											}
											variant="link"
										>
											{tools.map((tool) => (
												<ToolCard
													key={tool.id}
													part={tool}
													conversationId={message.conversationId}
													agentId={message.agentId}
												/>
											))}
										</Fold>
									);
								}
							}
							return (
								<ToolCard
									key={part.id}
									part={part}
									conversationId={message.conversationId}
									agentId={message.agentId}
								/>
							);
						}
						case "advisor":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <AdvisorBlock key={i} part={part} />;
						case "notice":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <NoticeLine key={i} part={part} />;
						case "audio":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <VoiceNote key={i} part={part} className="my-1.5 bg-surface-2" />;
						case "image": {
							const source = imageSource(part.source);
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
								<figure key={i} className="my-2">
									<ChatImage src={part.url} alt={part.alt || part.name || "Image"} className="my-0" />
									{(part.alt || source) && (
										<figcaption className="mt-1.5 max-w-xl text-small text-fg-subtle [overflow-wrap:anywhere]">
											{part.alt}
											{part.alt && source ? " · " : ""}
											{source && (
												<a
													href={source.href}
													target="_blank"
													rel="noreferrer noopener"
													className="hover:text-fg hover:underline"
												>
													{source.hostname}
												</a>
											)}
										</figcaption>
									)}
								</figure>
							);
						}
					}
					return null;
				})}
				{message.status === "cancelled" && <div className="mt-1 text-small text-fg-subtle">Stopped</div>}
				{showActions && (
					<div
						className={cn(
							"mt-1 -ml-1.5 flex min-w-0 flex-wrap items-center gap-0.5 text-fg-subtle",
							!isLastAgentMessage &&
								"fine:opacity-0 fine:group-hover:opacity-100 fine:focus-within:opacity-100",
						)}
					>
						{text && <CopyButton text={text} />}
						{text && canVoice && message.sender === "agent" && <ReadAloudButton messageId={message.id} />}
						{message.sender === "agent" && <RetryButton message={message} />}
						{menu}
						<VersionSwitcher message={message} />
						<span className="ml-1.5 min-w-0 truncate text-caption max-md:hidden">{meta}</span>
					</div>
				)}
			</div>
		</div>
	);
});

/** The avatar of a bot that's writing right now: its motion shows thinking, working or waiting. */
function LiveAvatar({ agent, conversationId }: { agent: Agent; conversationId: string }) {
	const presence = useAgentPresence(agent.id, conversationId);
	return (
		<AgentAvatar
			avatar={agent.avatar}
			size={32}
			state={presence.state === "idle" ? "thinking" : presence.state}
			title={presence.label ?? undefined}
		/>
	);
}

export function TypingRow({ agent, label }: { agent: Agent; label: string }) {
	return (
		<div className="flex items-center gap-3 px-4 py-2 md:px-6">
			<AgentAvatar avatar={agent.avatar} size={32} state="thinking" />
			<div className="flex items-center gap-2 text-small text-fg-subtle">
				<span className="flex items-center gap-1">
					<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
					<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
					<span className="typing-dot size-1.5 rounded-full bg-fg-subtle" />
				</span>
				<span>{label}</span>
			</div>
		</div>
	);
}
