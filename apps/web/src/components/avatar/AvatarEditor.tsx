import { AgentAvatar, api, cn } from "@sekai/client";
import {
	AVATAR_COLOR_NAMES,
	AVATAR_COLORS,
	AVATAR_FACES,
	AVATAR_SHAPES,
	type Avatar,
	type AvatarFace,
	type AvatarShape,
	GALLERY,
	GALLERY_CREDIT,
	GALLERY_PAGE,
	GALLERY_UNITS,
	galleryIcon,
	galleryShortName,
	randomAvatar,
} from "@sekai/shared";
import { Button, Input, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tooltip } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ImageUp, Shapes, Smile, Sparkles, Upload, Users, Wand2 } from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";

type CharacterAvatar = Extract<Avatar, { kind: "character" }>;
type GalleryAvatar = Extract<Avatar, { kind: "gallery" }>;

export function galleryAvatar(id: string): GalleryAvatar | null {
	const icon = galleryIcon(id);
	return icon ? { kind: "gallery", id: icon.id, color: icon.color.toLowerCase() } : null;
}

/** Where the character icons come from (the media kit asks for them to be credited and left as they are). */
export function GalleryCredit() {
	return (
		<p className="text-caption text-fg-subtle">
			Icons from the{" "}
			<a
				href={GALLERY_PAGE}
				target="_blank"
				rel="noreferrer"
				className="underline underline-offset-2 hover:text-fg"
			>
				HATSUNE MIKU: COLORFUL STAGE! media kit
			</a>
			. {GALLERY_CREDIT}
		</p>
	);
}

/** Character icons, by unit. */
export function GalleryPicker({
	value,
	onChange,
	compact,
}: {
	value: string | null;
	onChange: (a: GalleryAvatar) => void;
	compact?: boolean;
}) {
	const current = value ? galleryIcon(value) : undefined;
	const [unit, setUnit] = useState(current?.unit ?? "vs");
	const icons = GALLERY.filter((g) => g.unit === unit);
	const size = compact ? 52 : 60;
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Units">
				{GALLERY_UNITS.map((u) => (
					<button
						key={u.id}
						type="button"
						role="tab"
						aria-selected={u.id === unit}
						onClick={() => setUnit(u.id)}
						className={cn(
							"shrink-0 rounded-full px-3 py-1.5 text-caption font-medium whitespace-nowrap transition-colors coarse:py-2",
							u.id === unit
								? "bg-primary text-primary-foreground"
								: "bg-surface-2 text-fg-muted hover:text-fg",
						)}
					>
						{u.name}
					</button>
				))}
			</div>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-2">
				{icons.map((g) => {
					const on = g.id === value;
					return (
						<button
							key={g.id}
							type="button"
							onClick={() => {
								const a = galleryAvatar(g.id);
								if (a) onChange(a);
							}}
							aria-label={g.name}
							aria-pressed={on}
							className={cn(
								"group flex flex-col items-center gap-1 rounded-lg border p-1.5 pb-1 transition-[background-color,border-color,box-shadow] duration-150",
								on
									? "border-transparent bg-surface-2 ring-2"
									: "border-transparent hover:bg-surface-2/70",
							)}
							style={on ? ({ "--tw-ring-color": g.color } as CSSProperties) : undefined}
						>
							<span className="transition-transform duration-200 ease-spring group-hover:-translate-y-0.5 group-active:scale-95">
								<AgentAvatar avatar={{ kind: "gallery", id: g.id, color: g.color }} size={size} />
							</span>
							<span className="max-w-full truncate text-caption text-fg-muted">
								{galleryShortName(g)}
							</span>
						</button>
					);
				})}
			</div>
			<GalleryCredit />
		</div>
	);
}

const DEFAULT_CHARACTER: CharacterAvatar = {
	kind: "character",
	shape: "blob",
	color: AVATAR_COLORS.iris,
	face: "happy",
};
const EMOJI_SUGGESTIONS = [
	"🐟",
	"🦊",
	"🐙",
	"🦉",
	"🐝",
	"🤖",
	"🧠",
	"📚",
	"🛰️",
	"🎨",
	"🧪",
	"💼",
	"🌱",
	"⚡",
	"🔭",
	"🎧",
];

export function CharacterPicker({
	value,
	onChange,
	compact,
}: {
	value: CharacterAvatar;
	onChange: (a: CharacterAvatar) => void;
	compact?: boolean;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div>
				<div className="mb-2 text-caption font-medium text-fg-subtle">Shape</div>
				<div className="grid grid-cols-5 gap-2">
					{AVATAR_SHAPES.map((shape: AvatarShape) => (
						<Tooltip key={shape} content={shape}>
							<button
								type="button"
								onClick={() => onChange({ ...value, shape })}
								aria-label={shape}
								className={cn(
									"flex aspect-square items-center justify-center rounded-lg border transition-colors",
									value.shape === shape
										? "border-fg/40 bg-surface-2"
										: "border-border hover:bg-surface-2",
								)}
							>
								<AgentAvatar avatar={{ ...value, shape }} size={compact ? 30 : 36} />
							</button>
						</Tooltip>
					))}
				</div>
			</div>
			<div>
				<div className="mb-2 text-caption font-medium text-fg-subtle">Color</div>
				<div className="flex flex-wrap gap-2">
					{AVATAR_COLOR_NAMES.map((name) => {
						const color = AVATAR_COLORS[name];
						return (
							<button
								key={name}
								type="button"
								aria-label={name}
								onClick={() => onChange({ ...value, color })}
								className={cn(
									"size-8 rounded-full ring-offset-2 ring-offset-surface transition-transform coarse:size-10",
									value.color === color ? "ring-2 ring-fg/60" : "hover:scale-110",
								)}
								style={{ background: color }}
							/>
						);
					})}
				</div>
			</div>
			{!compact && (
				<div>
					<div className="mb-2 text-caption font-medium text-fg-subtle">Face</div>
					<div className="flex flex-wrap gap-2">
						{AVATAR_FACES.map((face: AvatarFace) => (
							<button
								key={face}
								type="button"
								onClick={() => onChange({ ...value, face })}
								className={cn(
									"flex flex-col items-center gap-1 rounded-lg border px-2.5 py-2 text-caption capitalize transition-colors",
									value.face === face
										? "border-fg/40 bg-surface-2"
										: "border-border hover:bg-surface-2",
								)}
							>
								<AgentAvatar avatar={{ ...value, face }} size={28} />
								{face}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

/** Full avatar editor: Characters (the gallery) / Draw / Emoji / Generate / Upload. */
export function AvatarEditor({
	value,
	onSave,
	agentId,
	agentName,
}: {
	value: Avatar;
	onSave: (avatar: Avatar) => void;
	agentId?: string;
	agentName?: string;
}) {
	const [tab, setTab] = useState<string>(value.kind === "image" ? "upload" : value.kind);
	const [gallery, setGallery] = useState<GalleryAvatar | null>(value.kind === "gallery" ? value : null);
	const [character, setCharacter] = useState<CharacterAvatar>(value.kind === "character" ? value : DEFAULT_CHARACTER);
	const [emoji, setEmoji] = useState(value.kind === "emoji" ? value.emoji : "🐟");
	const [emojiColor, setEmojiColor] = useState(value.kind === "emoji" ? value.color : AVATAR_COLORS.sky);
	const [prompt, setPrompt] = useState("");
	const [image, setImage] = useState<Avatar | null>(value.kind === "image" ? value : null);
	const fileRef = useRef<HTMLInputElement>(null);

	const generate = useMutation({
		mutationFn: () =>
			agentId ? api.agents.generateAvatar(agentId, prompt) : Promise.reject(new Error("Create the bot first")),
		onSuccess: (a) => setImage(a),
	});
	const upload = useMutation({
		mutationFn: (file: File) => api.uploads.create(file),
		onSuccess: (u) => setImage({ kind: "image", url: u.url }),
	});

	const preview: Avatar =
		tab === "gallery"
			? (gallery ?? value)
			: tab === "character"
				? character
				: tab === "emoji"
					? { kind: "emoji", emoji: emoji || "🐟", color: emojiColor }
					: (image ?? character);

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col items-center gap-2 pt-1">
				<AgentAvatar avatar={preview} size={104} working={generate.isPending} />
				{agentName && <div className="text-body font-medium">{agentName}</div>}
			</div>
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList variant="pill" className="mx-auto">
					<TabsTrigger value="gallery" aria-label="Characters">
						<Users />
						<span className="max-xs:hidden">Characters</span>
					</TabsTrigger>
					<TabsTrigger value="character" aria-label="Draw">
						<Shapes />
						<span className="max-xs:hidden">Draw</span>
					</TabsTrigger>
					<TabsTrigger value="emoji" aria-label="Emoji">
						<Smile />
						<span className="max-xs:hidden">Emoji</span>
					</TabsTrigger>
					<TabsTrigger value="generate" aria-label="Generate">
						<Wand2 />
						<span className="max-xs:hidden">Generate</span>
					</TabsTrigger>
					<TabsTrigger value="upload" aria-label="Upload">
						<Upload />
						<span className="max-xs:hidden">Upload</span>
					</TabsTrigger>
				</TabsList>
				<TabsContent value="gallery" className="pt-4">
					<GalleryPicker value={gallery?.id ?? null} onChange={setGallery} />
				</TabsContent>
				<TabsContent value="character" className="pt-4">
					<CharacterPicker value={character} onChange={setCharacter} />
				</TabsContent>
				<TabsContent value="emoji" className="flex flex-col gap-4 pt-4">
					<div className="flex flex-wrap gap-2">
						{EMOJI_SUGGESTIONS.map((e) => (
							<button
								key={e}
								type="button"
								onClick={() => setEmoji(e)}
								className={cn(
									"flex size-10 items-center justify-center rounded-md text-title transition-colors",
									emoji === e ? "bg-surface-3" : "hover:bg-surface-2",
								)}
							>
								{e}
							</button>
						))}
					</div>
					<Input
						value={emoji}
						onChange={(e) => setEmoji(e.target.value.slice(0, 8))}
						placeholder="Or type any emoji"
					/>
					<div className="flex flex-wrap gap-2">
						{AVATAR_COLOR_NAMES.map((name) => (
							<button
								key={name}
								type="button"
								aria-label={name}
								onClick={() => setEmojiColor(AVATAR_COLORS[name])}
								className={cn(
									"size-8 rounded-full ring-offset-2 ring-offset-surface",
									emojiColor === AVATAR_COLORS[name] && "ring-2 ring-fg/60",
								)}
								style={{ background: AVATAR_COLORS[name] }}
							/>
						))}
					</div>
				</TabsContent>
				<TabsContent value="generate" className="flex flex-col gap-3 pt-4">
					<Textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="A tiny astronaut cat with a teal helmet"
						className="min-h-20"
					/>
					<Button
						variant="secondary"
						onClick={() => generate.mutate()}
						disabled={!prompt.trim() || generate.isPending || !agentId}
					>
						{generate.isPending ? <Spinner /> : <Wand2 />}
						{generate.isPending ? "Drawing…" : "Generate"}
					</Button>
					<p className="text-small text-fg-subtle">
						<Sparkles className="mr-1 inline size-4" />
						The bot's own model draws the picture as an SVG.
					</p>
				</TabsContent>
				<TabsContent value="upload" className="flex flex-col gap-3 pt-4">
					<input
						ref={fileRef}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						className="hidden"
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) upload.mutate(f);
							e.target.value = "";
						}}
					/>
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							const f = e.dataTransfer.files[0];
							if (f?.type.startsWith("image/")) upload.mutate(f);
						}}
						className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-8 text-body text-fg-muted hover:bg-surface-2/60"
					>
						{upload.isPending ? <Spinner /> : <ImageUp className="size-6" />}
						Drop an image or browse (max 25 MB)
					</button>
				</TabsContent>
			</Tabs>
			<Button
				variant="primary"
				onClick={() => onSave(preview)}
				disabled={((tab === "generate" || tab === "upload") && !image) || (tab === "gallery" && !gallery)}
			>
				Use this picture
			</Button>
		</div>
	);
}

export type { CharacterAvatar, GalleryAvatar };
export { DEFAULT_CHARACTER };

/** The look for a new bot: a character icon, or draw your own (shape and color). */
export function NewBotLook({
	value,
	onChange,
}: {
	value: GalleryAvatar | CharacterAvatar;
	onChange: (a: GalleryAvatar | CharacterAvatar) => void;
}) {
	const [mode, setMode] = useState<"gallery" | "character">(value.kind);
	const [drawn, setDrawn] = useState<CharacterAvatar>(value.kind === "character" ? value : DEFAULT_CHARACTER);
	const [picked, setPicked] = useState<GalleryAvatar | null>(value.kind === "gallery" ? value : null);
	return (
		<div className="flex flex-col gap-3">
			<Tabs
				value={mode}
				onValueChange={(m) => {
					const next = m as "gallery" | "character";
					setMode(next);
					if (next === "character") onChange(drawn);
					else if (picked) onChange(picked);
				}}
			>
				<TabsList variant="pill">
					<TabsTrigger value="gallery">
						<Users /> Characters
					</TabsTrigger>
					<TabsTrigger value="character">
						<Shapes /> Draw your own
					</TabsTrigger>
				</TabsList>
				<TabsContent value="gallery" className="pt-3">
					<GalleryPicker
						value={picked?.id ?? null}
						compact
						onChange={(a) => {
							setPicked(a);
							onChange(a);
						}}
					/>
				</TabsContent>
				<TabsContent value="character" className="pt-3">
					<CharacterPicker
						value={drawn}
						compact
						onChange={(a) => {
							setDrawn(a);
							onChange(a);
						}}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}

/** A random look for a new bot: a character icon. */
export function freshLook(): GalleryAvatar | CharacterAvatar {
	const a = randomAvatar();
	if (a.kind === "gallery" || a.kind === "character") return a;
	return DEFAULT_CHARACTER;
}
