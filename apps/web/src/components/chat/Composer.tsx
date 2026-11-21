import {
	AgentAvatar,
	api,
	ComposerModelPill,
	cn,
	haptic,
	useAccess,
	useDictation,
	useSettings,
	useVoiceRecorder,
} from "@sekai/client";
import { type Agent, type Conversation, type ModelRef, messageText, type Upload } from "@sekai/shared";
import {
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	IconButton,
	Skeleton,
	Spinner,
} from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import {
	ArrowUp,
	AudioWaveform,
	Check,
	FileText,
	FolderOpen,
	Mic,
	Paperclip,
	Plus,
	RotateCcw,
	Shield,
	Square,
	X,
} from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAutosize, useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";
import { LevelBars } from "../voice/LevelBars.tsx";
import { approvalSummary, ChatApprovals } from "./ChatApprovals.tsx";

interface PendingFile {
	key: string;
	file: File;
	upload: Upload | null;
	error: string | null;
	preview: string | null;
}

/** The text after an "@" right before the caret, if the user is typing a mention. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
	const before = text.slice(0, caret);
	const m = before.match(/(^|\s)@([\w.-]{0,30})$/);
	if (!m) return null;
	return { start: caret - (m[2]?.length ?? 0) - 1, query: m[2] ?? "" };
}

export function Composer({
	conversation,
	agent,
	members,
	busy,
	onUpdateAgentModel,
}: {
	conversation: Conversation;
	/** The bot in a direct chat; null in groups. */
	agent: Agent | null;
	members: Agent[];
	busy: boolean;
	onUpdateAgentModel: (ref: ModelRef) => void;
}) {
	const { touch, phone } = useLayout();
	const canVoice = useAccess().can("voice");
	const { data: settings } = useSettings();
	const [approvalsOpen, setApprovalsOpen] = useState(false);
	const [files, setFiles] = useState<PendingFile[]>([]);
	const previews = useRef(new Set<string>());
	useEffect(() => {
		const urls = previews.current;
		return () => {
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, []);
	const text = useUi((s) => s.drafts[conversation.id] ?? "");
	const setDraft = useUi((s) => s.setDraft);
	const replyTo = useUi((s) => s.replyTo[conversation.id] ?? null);
	const setReplyTo = useUi((s) => s.setReplyTo);
	const setText = (value: string) => setDraft(conversation.id, value);
	const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const ref = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const folderInput = useRef<HTMLInputElement>(null);
	useAutosize(ref, text, phone ? 180 : 280);

	// Dictation: what you say goes after whatever was already typed.
	const typedBefore = useRef("");
	const dictation = useDictation((spoken) => {
		const before = typedBefore.current;
		setText(spoken ? `${before}${before && !/\s$/.test(before) ? " " : ""}${spoken}` : before);
	}, conversation.id);
	const dictating = dictation.state !== "idle";
	useEffect(() => {
		if (!dictation.error) return;
		toast.error(dictation.error);
		dictation.clearError();
	}, [dictation.error, dictation.clearError]);
	// Voice messages: recorded here, written down on the server, answered in voice.
	const recorder = useVoiceRecorder();
	const recording = recorder.state !== "idle";
	const [sendingVoice, setSendingVoice] = useState(false);
	useEffect(() => {
		if (!recorder.error) return;
		toast.error(recorder.error);
		recorder.clearError();
	}, [recorder.error, recorder.clearError]);
	const sendVoice = async () => {
		const blob = recorder.stop();
		if (!blob) {
			toast("That was too short to send");
			return;
		}
		setSendingVoice(true);
		try {
			await api.voice.sendVoiceMessage(conversation.id, blob, replyTo?.id ?? null);
			setReplyTo(conversation.id, null);
		} catch {
			toast.error("Couldn't send the voice message. Try again.");
		} finally {
			setSendingVoice(false);
		}
	};
	const startDictation = () => {
		typedBefore.current = text;
		void dictation.start();
	};

	// Switching chats loads that chat's draft.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the conversation changes
	useEffect(() => {
		if (!touch) ref.current?.focus();
	}, [conversation.id]);

	useEffect(() => {
		if (replyTo && !touch) ref.current?.focus();
	}, [replyTo, touch]);

	const isGroup = conversation.kind === "group";
	const mentionMatches = useMemo(() => {
		if (!mention || !isGroup) return [];
		const q = mention.query.toLowerCase();
		const list = members.filter((m) => m.name.toLowerCase().startsWith(q) || m.name.toLowerCase().includes(q));
		return "everyone".startsWith(q) ? [...list, null] : list;
	}, [mention, members, isGroup]);

	const send = useMutation({
		mutationFn: (body: { text: string; attachmentIds: string[]; replyToId: string | null; chatId: string }) =>
			api.conversations.send(body.chatId, {
				text: body.text,
				attachmentIds: body.attachmentIds,
				replyToId: body.replyToId,
			}),
		onError: () => {
			haptic("error");
		},
		onSuccess: (_, body) => {
			if ((useUi.getState().drafts[body.chatId] ?? "") === body.text) setDraft(body.chatId, "");
			for (const file of files) removeFile(file);
			setReplyTo(body.chatId, null);
			setMention(null);
		},
	});
	const stop = useMutation({ mutationFn: () => api.conversations.stop(conversation.id) });

	const uploading = files.some((f) => !f.upload && !f.error);
	const canSend =
		(text.trim().length > 0 || files.some((f) => f.upload)) && !uploading && !files.some((f) => f.error);

	const submit = () => {
		if (dictating) dictation.cancel();
		if (!canSend || send.isPending) return;
		const attachmentIds = files.flatMap((f) => (f.upload ? [f.upload.id] : []));
		send.mutate({ text, attachmentIds, replyToId: replyTo?.id ?? null, chatId: conversation.id });
		haptic("light");
		if (touch) ref.current?.blur();
	};

	const insertMention = (name: string) => {
		if (!mention) return;
		const before = text.slice(0, mention.start);
		const after = text.slice(ref.current?.selectionStart ?? text.length);
		const next = `${before}@${name} ${after}`;
		setText(next);
		setMention(null);
		requestAnimationFrame(() => {
			const pos = before.length + name.length + 2;
			ref.current?.setSelectionRange(pos, pos);
			ref.current?.focus();
		});
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (mention && mentionMatches.length > 0) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const d = e.key === "ArrowDown" ? 1 : -1;
				setMentionIndex((i) => (i + d + mentionMatches.length) % mentionMatches.length);
				return;
			}
			if (!e.shiftKey && (e.key === "Enter" || e.key === "Tab")) {
				e.preventDefault();
				const pick = mentionMatches[mentionIndex];
				insertMention(pick ? pick.name : "everyone");
				return;
			}
			if (e.key === "Escape") {
				setMention(null);
				return;
			}
		}
		if (e.altKey && e.shiftKey && e.code === "KeyA") {
			e.preventDefault();
			setApprovalsOpen(true);
			return;
		}
		// Enter sends on keyboards; on touch screens Enter is a newline and the button sends.
		if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
			e.preventDefault();
			submit();
		}
		if (e.key === "Escape" && replyTo) setReplyTo(conversation.id, null);
	};

	const uploadFile = (item: PendingFile) => {
		setFiles((f) => f.map((x) => (x.key === item.key ? { ...x, error: null } : x)));
		void api.uploads
			.create(item.file)
			.then((upload) => setFiles((f) => f.map((x) => (x.key === item.key ? { ...x, upload } : x))))
			.catch(() => setFiles((f) => f.map((x) => (x.key === item.key ? { ...x, error: "Upload failed" } : x))));
	};
	const removeFile = (item: PendingFile) => {
		if (item.preview) {
			URL.revokeObjectURL(item.preview);
			previews.current.delete(item.preview);
		}
		setFiles((f) => f.filter((x) => x.key !== item.key));
	};
	const addFiles = (list: FileList | File[]) => {
		if (send.isPending) return;
		const arr = Array.from(list).slice(0, Math.max(0, 10 - files.length));
		if (arr.length < list.length) toast("You can attach up to 10 files per message.");
		const items: PendingFile[] = arr.map((file) => ({
			key: `${file.name}-${file.size}-${Math.random()}`,
			file,
			upload: null,
			error: null,
			preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
		}));
		setFiles((f) => [...f, ...items]);
		for (const item of items) {
			if (item.preview) previews.current.add(item.preview);
			uploadFile(item);
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const pasted = Array.from(e.clipboardData.files);
		if (pasted.length > 0) {
			e.preventDefault();
			addFiles(pasted);
		}
	};

	const placeholder = isGroup ? `Message ${conversation.title}` : agent ? `Message ${agent.name}` : "Message";

	return (
		<div className="relative mx-auto w-full max-w-3xl px-4 pb-safe-3 md:px-6 md:pb-5">
			{mention && mentionMatches.length > 0 && (
				<div className="absolute right-3 bottom-full left-3 z-sticky mb-2 overflow-hidden rounded-lg border border-border bg-surface p-1.5 shadow-soft md:right-6 md:left-6">
					{mentionMatches.map((m, i) => (
						<button
							key={m?.id ?? "everyone"}
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => insertMention(m ? m.name : "everyone")}
							className={cn(
								"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body coarse:py-3",
								i === mentionIndex ? "bg-surface-2" : "hover:bg-surface-2/60",
							)}
						>
							{m ? (
								<AgentAvatar avatar={m.avatar} size={24} />
							) : (
								<span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-small">
									@
								</span>
							)}
							<span className="font-medium">{m ? m.name : "everyone"}</span>
							<span className="truncate text-small text-fg-subtle">
								{m ? m.label : "All members reply"}
							</span>
						</button>
					))}
				</div>
			)}

			<div
				className="rounded-xl border border-border bg-surface transition-colors focus-within:border-border-strong"
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
				}}
			>
				{replyTo && (
					<div className="flex items-center gap-2 border-b border-border px-4 py-2 text-body">
						<span className="text-fg-subtle">Replying to</span>
						<span className="font-medium">
							{members.find((m) => m.id === replyTo.agentId)?.name ?? "message"}
						</span>
						<span className="min-w-0 flex-1 truncate text-fg-subtle">
							{messageText(replyTo).slice(0, 120)}
						</span>
						<IconButton label="Cancel reply" onClick={() => setReplyTo(conversation.id, null)}>
							<X />
						</IconButton>
					</div>
				)}
				{files.length > 0 && (
					<div className="flex gap-2 overflow-x-auto px-3 pt-3 scrollbar-none">
						{files.map((f) => (
							<div key={f.key} className="relative shrink-0">
								{f.preview ? (
									<img
										src={f.preview}
										alt={f.file.name}
										className={cn(
											"size-16 rounded-md border border-border object-cover",
											!f.upload && "opacity-60",
										)}
									/>
								) : (
									<div className="flex h-16 w-44 items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
										<FileText className="size-5 shrink-0 text-fg-subtle" />
										<span className="truncate text-small">{f.file.name}</span>
									</div>
								)}
								{!f.upload && !f.error && (
									<Skeleton className="absolute inset-x-2 bottom-2 h-1" aria-label="Uploading" />
								)}
								{f.error && (
									<span className="absolute inset-x-0 bottom-0 truncate rounded-b-lg bg-danger px-1 text-caption text-danger-foreground">
										{f.error}
									</span>
								)}
								<div className="absolute right-0 top-0 flex">
									{f.error && (
										<IconButton
											label={`Retry ${f.file.name}`}
											className="bg-surface-raised"
											onClick={() => uploadFile(f)}
										>
											<RotateCcw />
										</IconButton>
									)}
									<IconButton
										label={`Remove ${f.file.name}`}
										disabled={send.isPending}
										className="bg-surface-raised"
										onClick={() => removeFile(f)}
									>
										<X />
									</IconButton>
								</div>
							</div>
						))}
					</div>
				)}
				<textarea
					ref={ref}
					value={text}
					rows={1}
					placeholder={placeholder}
					aria-label={placeholder}
					readOnly={send.isPending}
					onChange={(e) => {
						setText(e.target.value);
						const m = mentionQuery(e.target.value, e.target.selectionStart);
						setMention(m);
						setMentionIndex(0);
					}}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					enterKeyHint={touch ? "enter" : "send"}
					className="block max-h-72 w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-message outline-none placeholder:text-fg-subtle"
				/>
				{send.isError && (
					<p className="px-4 py-1 text-small text-danger-ink" role="alert">
						Couldn't send your message. Try sending it again.
					</p>
				)}
				<div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5 xs:gap-1 xs:px-2">
					<input
						ref={fileInput}
						type="file"
						multiple
						className="hidden"
						onChange={(e) => {
							if (e.target.files) addFiles(e.target.files);
							e.target.value = "";
						}}
					/>
					{!touch && (
						<input
							ref={folderInput}
							type="file"
							multiple
							{...{ webkitdirectory: "" }}
							className="hidden"
							onChange={(e) => {
								if (e.target.files) addFiles(e.target.files);
								e.target.value = "";
							}}
						/>
					)}
					<DropdownMenu>
						<DropdownTrigger asChild>
							<IconButton variant="ghost" size="icon" pill label="Add">
								<Plus />
							</IconButton>
						</DropdownTrigger>
						<DropdownContent align="start" side="top" title="Message options" className="w-72">
							<DropdownEntries
								entries={[
									{
										label: "Attach files or photos",
										icon: <Paperclip />,
										onSelect: () => fileInput.current?.click(),
										disabled: send.isPending,
									},
									!touch && {
										label: "Attach a folder",
										icon: <FolderOpen />,
										onSelect: () => folderInput.current?.click(),
										disabled: send.isPending,
									},
									"-",
									{
										label: (
											<>
												<span className="block">Approvals</span>
												<span className="block whitespace-normal text-small text-fg-subtle">
													{approvalSummary(conversation, agent, settings?.approvalMode)}
												</span>
											</>
										),
										icon: <Shield />,
										onSelect: () => setApprovalsOpen(true),
									},
								]}
							/>
						</DropdownContent>
					</DropdownMenu>
					{agent && !agent.sharedBy && !recording && !dictating && !sendingVoice && (
						<ComposerModelPill agent={agent} onChange={onUpdateAgentModel} />
					)}
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{recording || sendingVoice ? (
							<div className="flex h-9 items-center gap-2 rounded-full bg-danger-soft pr-1 pl-3 text-danger-ink coarse:h-11">
								{sendingVoice ? (
									<Spinner className="text-danger-ink" />
								) : (
									<span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
								)}
								<RecordingClock startedAt={recorder.startedAt} />
								{recorder.state === "recording" && <LevelBars level={recorder.level} />}
								<IconButton
									label="Discard"
									size="icon-sm"
									variant="ghost"
									className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
									disabled={sendingVoice}
									onClick={recorder.cancel}
								>
									<X />
								</IconButton>
								<IconButton
									label="Send voice message"
									size="icon-sm"
									variant="primary"
									className="rounded-full"
									disabled={sendingVoice || recorder.state !== "recording"}
									onClick={() => void sendVoice()}
								>
									<ArrowUp />
								</IconButton>
							</div>
						) : dictating ? (
							<div className="flex h-9 items-center gap-1 rounded-full bg-danger-soft pr-1 pl-3 text-danger-ink coarse:h-11">
								{dictation.state === "listening" ? (
									<LevelBars level={dictation.level} className="mr-1" />
								) : (
									<Spinner className="mr-1 text-danger-ink" />
								)}
								<span className="hidden text-small font-medium xs:inline">
									{dictation.state === "starting"
										? "Starting…"
										: dictation.state === "finishing"
											? "Writing it down…"
											: dictation.speaking
												? "Listening…"
												: "Speak now"}
								</span>
								<IconButton
									label="Stop dictating"
									size="icon-sm"
									variant="ghost"
									className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
									disabled={dictation.state === "finishing"}
									onClick={dictation.stop}
								>
									<Check />
								</IconButton>
							</div>
						) : (
							canVoice && (
								<>
									<IconButton label="Dictate" pill onClick={startDictation}>
										<Mic />
									</IconButton>
									<IconButton
										label="Record a voice message"
										pill
										onClick={() => void recorder.start()}
									>
										<AudioWaveform />
									</IconButton>
								</>
							)
						)}
						{recording || sendingVoice ? null : busy && !canSend ? (
							<IconButton variant="primary" size="icon" pill label="Stop" onClick={() => stop.mutate()}>
								<Square className="fill-current" />
							</IconButton>
						) : (
							<IconButton
								variant="primary"
								size="icon"
								pill
								label="Send"
								disabled={!canSend}
								loading={send.isPending}
								onClick={submit}
							>
								<ArrowUp />
							</IconButton>
						)}
					</div>
				</div>
			</div>
			<Dialog open={approvalsOpen} onOpenChange={setApprovalsOpen} title="Chat approvals" size="sm">
				<ChatApprovals conversation={conversation} agent={agent} onDone={() => setApprovalsOpen(false)} />
			</Dialog>
		</div>
	);
}

function RecordingClock({ startedAt }: { startedAt: number | null }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, []);
	const s = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
	return (
		<span className="min-w-9 text-caption font-medium tabular-nums">
			{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
		</span>
	);
}
