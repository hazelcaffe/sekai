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
	useReadAloud,
} from "@sekai/client";
import { type Agent, type AudioPart, channelTitle, type Message, messageText } from "@sekai/shared";
import {
	DropdownContent,
	DropdownItem,
	DropdownMenu,
	DropdownSeparator,
	DropdownTrigger,
	IconButton,
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
import { useAgentPresence } from "../../stores/ui.ts";
import { AdvisorBlock, NoticeLine, ReasoningBlock, ToolCard } from "./Parts.tsx";
import { RetryButton, VersionSwitcher } from "./RetryControls.tsx";
import { VoiceNote } from "./VoiceNote.tsx";

function Attachments({ message, align }: { message: Message; align: "start" | "end" }) {
	if (message.attachments.length === 0) return null;
	const images = message.attachments.filter((a) => a.kind === "image");
	const files = message.attachments.filter((a) => a.kind !== "image");
	return (
		<div className={cn("mb-1.5 flex flex-col gap-1.5", align === "end" ? "items-end" : "items-start")}>
			{images.length > 0 && (
				<div className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
					{images.map((a) => (
						<a key={a.id} href={assetUrl(a.url)} target="_blank" rel="noreferrer">
							<img
								src={assetUrl(a.url)}
								alt={a.name}
								className="max-h-60 max-w-[min(70vw,280px)] rounded-2xl border border-border object-cover"
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
					className="flex max-w-full items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
				>
					<FileText className="size-5 shrink-0 text-fg-subtle" />
					<span className="min-w-0">
						<span className="block truncate font-medium">{a.name}</span>
						<span className="block text-xs text-fg-subtle">{formatBytes(a.size)}</span>
					</span>
				</a>
			))}
		</div>
	);
}

function TriggerBadge({ message, agents }: { message: Message; agents: Map<string, Agent> }) {
	const t = message.meta.trigger;
	const base = "inline-flex items-center gap-1 text-[11px] font-medium text-fg-subtle [&_svg]:size-3";
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

/** Plays the reply in its bot's voice (Admin → Voice, or the bot's own). */
function ReadAloudButton({ messageId }: { messageId: string }) {
	const { state, toggle } = useReadAloud(messageId, (message) => toast.error(`Couldn't read it out: ${message}`));
	return (
		<IconButton
			label={state === "idle" ? "Read aloud" : "Stop reading"}
			size="icon-sm"
			onClick={toggle}
			className={cn(state !== "idle" && "text-brand-ink")}
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
	tint,
}: {
	message: Message;
	agents: Map<string, Agent>;
	isGroup: boolean;
	showHeader: boolean;
	isLastAgentMessage: boolean;
	onReply?: (m: Message) => void;
	replyTarget?: Message | null;
	/** Your messages take the bot's color. */
	tint?: string;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const longPress = useLongPress(() => setMenuOpen(true));
	const text = messageText(message);
	const del = useMutation({ mutationFn: () => api.messages.delete(message.id) });
	const retry = useMutation({ mutationFn: (wipe: boolean) => api.messages.retry(message.id, { wipe }) });
	const streaming = message.status === "streaming";

	const menu = (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownTrigger asChild>
				<span className="sr-only" />
			</DropdownTrigger>
			<DropdownContent align={message.sender === "user" ? "end" : "start"}>
				{text && (
					<DropdownItem icon={<Copy />} onSelect={() => void copyText(text)}>
						Copy text
					</DropdownItem>
				)}
				{isGroup && onReply && message.sender === "agent" && (
					<DropdownItem icon={<Reply />} onSelect={() => onReply(message)}>
						Reply
					</DropdownItem>
				)}
				{message.sender === "agent" && !streaming && (
					<>
						<DropdownItem icon={<RotateCcw />} onSelect={() => retry.mutate(false)}>
							Try again
						</DropdownItem>
						<DropdownItem icon={<Eraser />} onSelect={() => retry.mutate(true)}>
							Erase and try again
						</DropdownItem>
					</>
				)}
				<DropdownSeparator />
				<DropdownItem danger icon={<Trash2 />} onSelect={() => del.mutate()}>
					Delete
				</DropdownItem>
			</DropdownContent>
		</DropdownMenu>
	);

	const replyQuote = replyTarget ? (
		<div className="mb-1 max-w-full truncate border-l-2 border-border-strong pl-2 text-xs text-fg-subtle">
			{replyTarget.agentId ? `${agents.get(replyTarget.agentId)?.name ?? "Bot"}: ` : ""}
			{messageText(replyTarget).slice(0, 140)}
		</div>
	) : null;

	const voice = message.parts.find((p): p is AudioPart => p.type === "audio");
	if (message.sender === "user") {
		const via = message.meta.channel
			? `via ${channelTitle(message.meta.channel.type)}${message.meta.channel.isGroup ? ` · ${message.meta.channel.chatName ?? "group"}` : ""}`
			: null;
		return (
			<div className="group flex flex-col items-end px-4 pt-6 pb-3 md:px-6" {...longPress}>
				{replyQuote}
				<Attachments message={message} align="end" />
				{voice && <VoiceNote part={voice} tint={tint} className="mb-1 bg-surface-2" />}
				{text && voice ? (
					<p className="max-w-[min(85%,520px)] px-2 text-right text-[13px] leading-5 text-fg-subtle">
						{text}
					</p>
				) : null}
				{text && !voice && (
					<div className="flex max-w-full items-center justify-end gap-1">
						<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 coarse:hidden">
							<span className="px-1 text-[11px] whitespace-nowrap text-fg-subtle">
								{shortTime(message.createdAt)}
								{via ? ` · ${via}` : ""}
								{message.meta.call
									? message.meta.call.kind === "task"
										? " · asked on a call"
										: " · said on a call"
									: ""}
							</span>
							<CopyButton text={text} />
							<IconButton label="Delete" size="icon-sm" onClick={() => del.mutate()}>
								<Trash2 />
							</IconButton>
						</div>
						{message.meta.call && (
							<AudioLines className="size-4 shrink-0 text-fg-subtle" aria-label="On a call" />
						)}
						<div
							className="max-w-[min(85%,640px)] rounded-3xl bg-surface-2 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap break-words"
							style={
								tint ? { background: `color-mix(in oklab, ${tint} 26%, var(--surface-2))` } : undefined
							}
						>
							{text}
						</div>
					</div>
				)}
				{menu}
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
			className={cn("group relative flex gap-3 px-4 md:px-6", showHeader ? "pt-4 pb-1" : "py-0.5")}
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
			{showActions && !isLastAgentMessage && (
				<div className="absolute -top-3 right-4 z-10 flex items-center gap-0.5 rounded-xl border border-border bg-surface p-0.5 opacity-0 shadow-soft transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:right-6 coarse:hidden">
					<VersionSwitcher message={message} />
					{text && <CopyButton text={text} />}
					<RetryButton message={message} />
					{isGroup && onReply && (
						<IconButton label="Reply" size="icon-sm" onClick={() => onReply(message)}>
							<Reply />
						</IconButton>
					)}
					<IconButton label="Delete" size="icon-sm" onClick={() => del.mutate()}>
						<Trash2 />
					</IconButton>
					<span className="truncate px-1.5 text-[11px] text-fg-subtle">{meta}</span>
				</div>
			)}
			<div className="min-w-0 flex-1">
				{(showHeader && (isGroup || message.meta.trigger === "handoff")) ||
				message.meta.trigger ||
				message.meta.call?.kind === "speech" ? (
					<div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
						{showHeader && (isGroup || message.meta.trigger === "handoff") && (
							<span className="text-sm font-semibold">{name}</span>
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
				{message.parts.map((part, i) => {
					// Parts are append-only, so their index is a stable identity.
					switch (part.type) {
						case "text":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return part.text ? <Markdown key={i} text={part.text} /> : null;
						case "reasoning":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return part.text ? <ReasoningBlock key={i} part={part} streaming={streaming} /> : null;
						case "tool":
							return (
								<ToolCard
									key={part.id}
									part={part}
									conversationId={message.conversationId}
									agentId={message.agentId}
								/>
							);
						case "advisor":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <AdvisorBlock key={i} part={part} />;
						case "notice":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <NoticeLine key={i} part={part} />;
						case "audio":
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
							return <VoiceNote key={i} part={part} className="my-1.5 bg-surface-2" />;
						case "image":
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only
								<figure key={i} className="my-2">
									<ChatImage src={part.url} alt={part.alt || part.name || "Image"} className="my-0" />
									{(part.alt || part.source) && (
										<figcaption className="mt-1.5 max-w-xl truncate text-xs text-fg-subtle">
											{part.alt}
											{part.alt && part.source ? " · " : ""}
											{part.source && (
												<a
													href={part.source}
													target="_blank"
													rel="noreferrer noopener"
													className="hover:text-fg hover:underline"
												>
													{new URL(part.source).hostname}
												</a>
											)}
										</figcaption>
									)}
								</figure>
							);
					}
					return null;
				})}
				{message.status === "cancelled" && <div className="mt-1 text-[13px] text-fg-subtle">Stopped</div>}
				{showActions && isLastAgentMessage && (
					<div className="mt-1 -ml-1.5 flex h-7 items-center gap-0.5 text-fg-subtle">
						<VersionSwitcher message={message} />
						{text && <CopyButton text={text} />}
						{text && message.status !== "streaming" && <ReadAloudButton messageId={message.id} />}
						<RetryButton message={message} />
						{isGroup && onReply && (
							<IconButton label="Reply" size="icon-sm" onClick={() => onReply(message)}>
								<Reply />
							</IconButton>
						)}
						<IconButton
							label="Delete"
							size="icon-sm"
							onClick={() => del.mutate()}
							className="opacity-0 transition-opacity group-hover:opacity-100 coarse:hidden"
						>
							<Trash2 />
						</IconButton>
						<span className="ml-1.5 truncate text-[11px] opacity-0 transition-opacity group-hover:opacity-100 coarse:hidden">
							{meta}
						</span>
					</div>
				)}
				{menu}
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
			<div className="flex items-center gap-2 text-[13px] text-fg-subtle">
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
