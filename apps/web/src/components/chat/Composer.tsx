import {
	AgentAvatar,
	ApprovalModePill,
	api,
	ComposerModelPill,
	cn,
	useDictation,
	useVoiceRecorder,
} from "@sekai/client";
import {
	type Agent,
	APPROVAL_MODE_INFO,
	APPROVAL_MODES,
	type ApprovalMode,
	type ApprovalModeSetting,
	type Conversation,
	type ModelRef,
	messageText,
	type Upload,
} from "@sekai/shared";
import { Button, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, IconButton, Spinner } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, AudioWaveform, Check, FileText, Globe, Mic, Paperclip, Plus, Square, X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAutosize, useLayout } from "../../lib/hooks.ts";
import { useUi } from "../../stores/ui.ts";
import { LevelBars } from "../voice/LevelBars.tsx";

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
	inheritedMode,
	onUpdateAgentModel,
	onToggleWebSearch,
	files,
	setFiles,
}: {
	conversation: Conversation;
	/** The bot in a direct chat; null in groups. */
	agent: Agent | null;
	members: Agent[];
	busy: boolean;
	inheritedMode: ApprovalMode;
	onUpdateAgentModel: (ref: ModelRef) => void;
	onToggleWebSearch: () => void;
	files: PendingFile[];
	setFiles: (fn: (f: PendingFile[]) => PendingFile[]) => void;
}) {
	const { touch, phone } = useLayout();
	const draft = useUi((s) => s.drafts[conversation.id] ?? "");
	const setDraft = useUi((s) => s.setDraft);
	const replyTo = useUi((s) => s.replyTo[conversation.id] ?? null);
	const setReplyTo = useUi((s) => s.setReplyTo);
	const [text, setText] = useState(draft);
	const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const ref = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
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
		} catch (err) {
			toast.error(`Couldn't send the voice message: ${err instanceof Error ? err.message : String(err)}`);
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
		setText(useUi.getState().drafts[conversation.id] ?? "");
		if (!touch) ref.current?.focus();
	}, [conversation.id]);

	useEffect(() => {
		const t = setTimeout(() => setDraft(conversation.id, text), 300);
		return () => clearTimeout(t);
	}, [text, conversation.id, setDraft]);

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

	const mode = conversation.settings.approvalMode;
	const effectiveMode: ApprovalMode = mode === "inherit" ? inheritedMode : mode;
	const setMode = useMutation({
		mutationFn: (approvalMode: ApprovalModeSetting) =>
			api.conversations.update(conversation.id, { settings: { approvalMode } }),
	});

	const send = useMutation({
		mutationFn: (body: { text: string; attachmentIds: string[]; replyToId: string | null; chatId: string }) =>
			api.conversations.send(body.chatId, {
				text: body.text,
				attachmentIds: body.attachmentIds,
				replyToId: body.replyToId,
			}),
		onError: (err, body) => {
			// Back into that chat's draft (you may have switched chats since).
			if (body.chatId === conversation.id) setText(body.text);
			else setDraft(body.chatId, body.text);
			toast.error(err instanceof Error ? err.message : "Couldn't send");
		},
	});
	const stop = useMutation({ mutationFn: () => api.conversations.stop(conversation.id) });

	const uploading = files.some((f) => !f.upload && !f.error);
	const canSend = (text.trim().length > 0 || files.some((f) => f.upload)) && !uploading;

	const submit = () => {
		if (dictating) dictation.cancel();
		if (!canSend) return;
		const attachmentIds = files.flatMap((f) => (f.upload ? [f.upload.id] : []));
		send.mutate({ text, attachmentIds, replyToId: replyTo?.id ?? null, chatId: conversation.id });
		setText("");
		setDraft(conversation.id, "");
		setFiles(() => []);
		setReplyTo(conversation.id, null);
		setMention(null);
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
			if (e.key === "Enter" || e.key === "Tab") {
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
		if (e.key === "Tab" && e.shiftKey) {
			// Like coding agents: Shift+Tab cycles the approval mode.
			e.preventDefault();
			const order: ApprovalMode[] = [...APPROVAL_MODES];
			const next = order[(order.indexOf(effectiveMode) + 1) % order.length] ?? "auto";
			setMode.mutate(next);
			toast(`Approvals: ${APPROVAL_MODE_INFO[next].title}`, { duration: 1500 });
			return;
		}
		// Enter sends on keyboards; on touch screens Enter is a newline and the button sends.
		if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
			e.preventDefault();
			submit();
		}
		if (e.key === "Escape" && replyTo) setReplyTo(conversation.id, null);
	};

	const addFiles = (list: FileList | File[]) => {
		const arr = Array.from(list).slice(0, 10);
		const items: PendingFile[] = arr.map((file) => ({
			key: `${file.name}-${file.size}-${Math.random()}`,
			file,
			upload: null,
			error: null,
			preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
		}));
		setFiles((f) => [...f, ...items]);
		for (const item of items) {
			api.uploads
				.create(item.file)
				.then((upload) => setFiles((f) => f.map((x) => (x.key === item.key ? { ...x, upload } : x))))
				.catch((err: unknown) =>
					setFiles((f) =>
						f.map((x) =>
							x.key === item.key
								? { ...x, error: err instanceof Error ? err.message : "Upload failed" }
								: x,
						),
					),
				);
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
		<div className="relative mx-auto w-full max-w-3xl px-3 pb-3 md:px-6 md:pb-5 pb-safe">
			{mention && mentionMatches.length > 0 && (
				<div className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-soft md:right-6 md:left-6">
					{mentionMatches.map((m, i) => (
						<button
							key={m?.id ?? "everyone"}
							type="button"
							onMouseDown={(e) => {
								e.preventDefault();
								insertMention(m ? m.name : "everyone");
							}}
							className={cn(
								"flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm coarse:py-3",
								i === mentionIndex ? "bg-surface-2" : "hover:bg-surface-2/60",
							)}
						>
							{m ? (
								<AgentAvatar avatar={m.avatar} size={24} />
							) : (
								<span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-xs">
									@
								</span>
							)}
							<span className="font-medium">{m ? m.name : "everyone"}</span>
							<span className="truncate text-xs text-fg-subtle">{m ? m.label : "All members reply"}</span>
						</button>
					))}
				</div>
			)}

			<div
				className="rounded-[26px] border border-border bg-surface shadow-soft transition-colors focus-within:border-border-strong"
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
				}}
			>
				{replyTo && (
					<div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
						<span className="text-fg-subtle">Replying to</span>
						<span className="font-medium">
							{members.find((m) => m.id === replyTo.agentId)?.name ?? "message"}
						</span>
						<span className="min-w-0 flex-1 truncate text-fg-subtle">
							{messageText(replyTo).slice(0, 120)}
						</span>
						<button
							type="button"
							aria-label="Cancel reply"
							onClick={() => setReplyTo(conversation.id, null)}
							className="rounded-md p-1 hover:bg-surface-2"
						>
							<X className="size-3.5" />
						</button>
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
											"size-16 rounded-xl border border-border object-cover",
											!f.upload && "opacity-60",
										)}
									/>
								) : (
									<div className="flex h-16 w-44 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
										<FileText className="size-5 shrink-0 text-fg-subtle" />
										<span className="truncate text-xs">{f.file.name}</span>
									</div>
								)}
								{!f.upload && !f.error && (
									<span className="absolute inset-0 flex items-center justify-center">
										<Spinner />
									</span>
								)}
								{f.error && (
									<span className="absolute inset-x-0 bottom-0 truncate rounded-b-xl bg-danger px-1 text-[10px] text-white">
										{f.error}
									</span>
								)}
								<button
									type="button"
									aria-label="Remove"
									onClick={() => setFiles((list) => list.filter((x) => x.key !== f.key))}
									className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-bg"
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				)}
				<textarea
					ref={ref}
					value={text}
					rows={1}
					placeholder={placeholder}
					onChange={(e) => {
						setText(e.target.value);
						const m = mentionQuery(e.target.value, e.target.selectionStart);
						setMention(m);
						setMentionIndex(0);
					}}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					enterKeyHint={touch ? "enter" : "send"}
					className="block max-h-72 w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-[15px] leading-6 outline-none placeholder:text-fg-subtle coarse:text-base"
				/>
				<div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-2 xs:gap-1 xs:px-2">
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
					<DropdownMenu>
						<DropdownTrigger asChild>
							<Button variant="ghost" size="icon" pill aria-label="Add">
								<Plus />
							</Button>
						</DropdownTrigger>
						<DropdownContent align="start" side="top">
							<DropdownItem icon={<Paperclip />} onSelect={() => fileInput.current?.click()}>
								Attach files or photos
							</DropdownItem>
							{agent && (
								<DropdownItem icon={<Globe />} onSelect={onToggleWebSearch}>
									Web search: {agent.capabilities.webSearch ? "on" : "off"}
								</DropdownItem>
							)}
						</DropdownContent>
					</DropdownMenu>
					{agent && <ComposerModelPill agent={agent} onChange={onUpdateAgentModel} />}
					<ApprovalModePill
						value={mode}
						effective={effectiveMode}
						inherited={inheritedMode}
						onChange={(v) => setMode.mutate(v)}
					/>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{recording || sendingVoice ? (
							<div className="flex h-9 items-center gap-2 rounded-full bg-destructive/10 pr-1 pl-3 text-destructive coarse:h-11">
								{sendingVoice ? (
									<Spinner className="text-destructive" />
								) : (
									<span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
								)}
								<RecordingClock startedAt={recorder.startedAt} />
								{recorder.state === "recording" && <LevelBars level={recorder.level} />}
								<IconButton
									label="Discard"
									size="icon-sm"
									variant="ghost"
									className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
							<div className="flex h-9 items-center gap-1 rounded-full bg-destructive/10 pr-1 pl-3 text-destructive coarse:h-11">
								{dictation.state === "listening" ? (
									<LevelBars level={dictation.level} className="mr-1" />
								) : (
									<Spinner className="mr-1 text-destructive" />
								)}
								<span className="hidden text-xs font-medium xs:inline">
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
									className="text-destructive hover:bg-destructive/10 hover:text-destructive"
									disabled={dictation.state === "finishing"}
									onClick={dictation.stop}
								>
									<Check />
								</IconButton>
							</div>
						) : (
							<>
								<IconButton label="Dictate" pill onClick={startDictation}>
									<Mic />
								</IconButton>
								<IconButton label="Record a voice message" pill onClick={() => void recorder.start()}>
									<AudioWaveform />
								</IconButton>
							</>
						)}
						{busy && !canSend ? (
							<Button variant="primary" size="icon" pill aria-label="Stop" onClick={() => stop.mutate()}>
								<Square className="fill-current" />
							</Button>
						) : (
							<Button
								variant="brand"
								size="icon"
								pill
								aria-label="Send"
								disabled={!canSend}
								onClick={submit}
							>
								<ArrowUp />
							</Button>
						)}
					</div>
				</div>
			</div>
			{effectiveMode === "yolo" && (
				<p className="mt-2 text-center text-[11px] text-danger">
					YOLO: actions in this chat run without asking.
				</p>
			)}
		</div>
	);
}

export type { PendingFile };

function RecordingClock({ startedAt }: { startedAt: number | null }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, []);
	const s = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
	return (
		<span className="min-w-9 text-xs font-medium tabular-nums">
			{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
		</span>
	);
}
