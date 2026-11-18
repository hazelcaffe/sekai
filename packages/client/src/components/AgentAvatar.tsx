import { type Avatar, type AvatarFace, type AvatarShape, galleryIcon, galleryShortName } from "@sekai/shared";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { assetUrl } from "../api.ts";
import { cn } from "../utils.ts";

/** What a bot is doing, shown by how its avatar moves. */
export type Presence = "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";

const INK = "#17171a";

function Shape({ shape, fill }: { shape: AvatarShape; fill: string }): ReactNode {
	switch (shape) {
		case "circle":
			return <circle cx="50" cy="50" r="44" fill={fill} />;
		case "squircle":
			return <path d="M50 6C86 6 94 14 94 50S86 94 50 94 6 86 6 50 14 6 50 6Z" fill={fill} />;
		case "blob":
			return (
				<path
					d="M54 6c21 1 37 15 39 35 3 22-7 42-26 50-20 8-45 3-57-14C-1 61 4 36 17 21 26 11 40 5 54 6Z"
					fill={fill}
				/>
			);
		case "flower":
			return (
				<g fill={fill}>
					{[0, 60, 120, 180, 240, 300].map((deg) => {
						const r = (deg * Math.PI) / 180;
						return <circle key={deg} cx={50 + Math.cos(r) * 25} cy={50 + Math.sin(r) * 25} r="20" />;
					})}
					<circle cx="50" cy="50" r="28" />
				</g>
			);
		case "star":
			return (
				<polygon
					points="50,9 61,36 90,38 67,56 75,85 50,69 25,85 33,56 10,38 39,36"
					fill={fill}
					stroke={fill}
					strokeWidth="12"
					strokeLinejoin="round"
				/>
			);
		case "cloud":
			return (
				<g fill={fill}>
					<circle cx="33" cy="58" r="23" />
					<circle cx="56" cy="44" r="28" />
					<circle cx="73" cy="62" r="20" />
					<rect x="14" y="58" width="74" height="26" rx="13" />
				</g>
			);
		case "ghost":
			return (
				<path
					d="M50 7C27 7 14 24 14 46v42l9-7 9 7 9-7 9 7 9-7 9 7 9-7 9 7V46C86 24 73 7 50 7Z"
					fill={fill}
					stroke={fill}
					strokeWidth="4"
					strokeLinejoin="round"
				/>
			);
		case "drop":
			return <path d="M50 5C50 5 17 41 17 62a33 33 0 0 0 66 0C83 41 50 5 50 5Z" fill={fill} />;
		case "bean":
			return <rect x="10" y="22" width="80" height="58" rx="29" fill={fill} transform="rotate(-16 50 50)" />;
		case "gem":
			return (
				<path
					d="M50 9 86 30v40L50 91 14 70V30Z"
					fill={fill}
					stroke={fill}
					strokeWidth="9"
					strokeLinejoin="round"
				/>
			);
	}
}

/** Eyes and mouth apart, so the eyes can blink. */
function Face({ face }: { face: AvatarFace }): ReactNode {
	const eye = (cx: number, r = 4.6, cy = 49) => <circle cx={cx} cy={cy} r={r} fill={INK} />;
	const closed = (cx: number) => (
		<path d={`M${cx - 5} 50q5-5 10 0`} stroke={INK} strokeWidth="3.4" fill="none" strokeLinecap="round" />
	);
	const smile = <path d="M41 60q9 8 18 0" stroke={INK} strokeWidth="3.4" fill="none" strokeLinecap="round" />;
	const cheeks = (
		<g fill="#ff6b8b" opacity="0.32">
			<ellipse cx="29" cy="59" rx="6" ry="3.6" />
			<ellipse cx="71" cy="59" rx="6" ry="3.6" />
		</g>
	);
	let eyes: ReactNode = null;
	let rest: ReactNode = null;
	switch (face) {
		case "none":
			return null;
		case "happy":
			eyes = (
				<>
					{eye(38)}
					{eye(62)}
				</>
			);
			rest = (
				<>
					{smile}
					{cheeks}
				</>
			);
			break;
		case "calm":
			eyes = (
				<>
					{closed(38)}
					{closed(62)}
				</>
			);
			rest = <path d="M44 60q6 4 12 0" stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />;
			break;
		case "wink":
			eyes = (
				<>
					{eye(38)}
					{closed(62)}
				</>
			);
			rest = (
				<>
					{smile}
					{cheeks}
				</>
			);
			break;
		case "curious":
			eyes = (
				<>
					{eye(38, 4.2)}
					{eye(62, 5.6, 47)}
				</>
			);
			rest = <circle cx="50" cy="62" r="3.2" fill={INK} />;
			break;
		case "sleepy":
			eyes = <path d="M33 50h10M57 50h10" stroke={INK} strokeWidth="3.4" strokeLinecap="round" fill="none" />;
			rest = <path d="M46 61h8" stroke={INK} strokeWidth="3.4" strokeLinecap="round" fill="none" />;
			break;
		case "focused":
			eyes = (
				<>
					<path d="M33 46h10v3a5 5 0 0 1-10 0Z" fill={INK} />
					<path d="M57 46h10v3a5 5 0 0 1-10 0Z" fill={INK} />
				</>
			);
			rest = <path d="M43 61h14" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />;
			break;
	}
	return (
		<g>
			<g className="avatar-eyes">{eyes}</g>
			{rest}
		</g>
	);
}

const BADGE: Partial<Record<Presence, string>> = {
	waiting: "bg-warning",
	blocked: "bg-danger",
	done: "bg-success",
};

/** A stable, per-avatar delay so a roster of bots doesn't blink in unison. */
function blinkDelay(seed: string): string {
	let h = 0;
	for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
	return `${(Math.abs(h) % 6000) / 1000}s`;
}

export function AgentAvatar({
	avatar,
	size = 36,
	working = false,
	state,
	alive = false,
	className,
	title,
}: {
	avatar: Avatar;
	size?: number;
	/** Shorthand for state="working". */
	working?: boolean;
	/** What the bot is doing; its motion shows it. */
	state?: Presence;
	/** Idle bots blink now and then (roster and header, not every message). */
	alive?: boolean;
	className?: string;
	title?: string;
}) {
	const id = useId().replace(/:/g, "");
	const presence: Presence = state ?? (working ? "working" : "idle");
	const box = cn(
		"relative inline-flex shrink-0 items-center justify-center",
		presence !== "idle" ? `avatar-${presence}` : alive && "avatar-alive",
		className,
	);
	const style = { width: size, height: size, "--blink-delay": blinkDelay(title ?? id) } as CSSProperties;
	const badge = BADGE[presence] ? (
		<span
			className={cn(
				"avatar-badge absolute right-0 bottom-0 rounded-full ring-2 ring-bg",
				BADGE[presence],
				presence === "waiting" && "avatar-badge-pulse",
			)}
			style={{ width: Math.max(7, size * 0.26), height: Math.max(7, size * 0.26) }}
			aria-hidden
		/>
	) : null;

	if (avatar.kind === "image") {
		// Pictures come from Sekai's uploads (or an http(s) or data: image): nothing else is put in an <img>.
		const safe = /^(\/|https?:|data:image\/)/.test(avatar.url);
		return (
			<span className={box} style={style} title={title}>
				<img
					src={safe ? assetUrl(avatar.url) : undefined}
					alt={title ?? ""}
					draggable={false}
					className="size-full rounded-full bg-surface-2 object-cover"
				/>
				{badge}
			</span>
		);
	}
	if (avatar.kind === "gallery") {
		return (
			<GalleryAvatar id={avatar.id} color={avatar.color} size={size} title={title} box={box} style={style}>
				{badge}
			</GalleryAvatar>
		);
	}
	if (avatar.kind === "emoji") {
		return (
			<span className={cn(box, "rounded-full")} style={{ ...style, background: avatar.color }} title={title}>
				<span style={{ fontSize: size * 0.55, lineHeight: 1 }} aria-hidden>
					{avatar.emoji}
				</span>
				{badge}
			</span>
		);
	}
	return (
		<span className={box} style={style} title={title}>
			<svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="overflow-visible">
				<defs>
					<radialGradient id={`s${id}`} cx="32%" cy="26%" r="75%">
						<stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
						<stop offset="55%" stopColor="#fff" stopOpacity="0.06" />
						<stop offset="100%" stopColor="#000" stopOpacity="0.08" />
					</radialGradient>
				</defs>
				<Shape shape={avatar.shape} fill={avatar.color} />
				<Shape shape={avatar.shape} fill={`url(#s${id})`} />
				<Face face={avatar.face} />
			</svg>
			{badge}
		</span>
	);
}

/**
 * A Colorful Stage icon, shown whole and unmodified (they're round portraits on a transparent background). If it
 * can't be loaded, a plain circle in the character's color with their initial stands in.
 */
function GalleryAvatar({
	id,
	color,
	size,
	title,
	box,
	style,
	children,
}: {
	id: string;
	color: string;
	size: number;
	title?: string;
	box: string;
	style: CSSProperties;
	children: ReactNode;
}) {
	const [failed, setFailed] = useState(false);
	const icon = galleryIcon(id);
	const name = icon ? galleryShortName(icon) : "?";
	return (
		<span className={cn(box, "avatar-gallery")} style={style} title={title}>
			{icon && !failed ? (
				<img
					src={assetUrl(`/api/avatars/gallery/${encodeURIComponent(id)}`)}
					alt={title ?? icon.name}
					width={size}
					height={size}
					draggable={false}
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
					className="size-full object-contain"
				/>
			) : (
				<span
					className="flex size-full items-center justify-center rounded-full font-semibold text-white"
					style={{ background: color, fontSize: size * 0.42 }}
					aria-hidden
				>
					{name.slice(0, 1)}
				</span>
			)}
			{children}
		</span>
	);
}

/** Overlapping avatars for group chats. */
export function AvatarStack({ avatars, size = 22, max = 3 }: { avatars: Avatar[]; size?: number; max?: number }) {
	const shown = avatars.slice(0, max);
	const extra = avatars.length - shown.length;
	return (
		<span className="inline-flex items-center">
			{shown.map((a, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: avatars have no stable id here
					key={i}
					className="rounded-full bg-bg ring-2 ring-bg"
					style={{ marginLeft: i === 0 ? 0 : -size * 0.35 }}
				>
					<AgentAvatar avatar={a} size={size} />
				</span>
			))}
			{extra > 0 && (
				<span
					className="flex items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-fg-muted ring-2 ring-bg"
					style={{ width: size, height: size, marginLeft: -size * 0.35 }}
				>
					+{extra}
				</span>
			)}
		</span>
	);
}

/** Group chat icon: two or three member avatars arranged in a circle. */
export function GroupAvatar({ avatars, size = 36 }: { avatars: Avatar[]; size?: number }) {
	const [a, b, c] = avatars;
	const small = Math.round(size * 0.62);
	return (
		<span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
			{a && (
				<span className="absolute top-0 left-0">
					<AgentAvatar avatar={a} size={small} />
				</span>
			)}
			{b && (
				<span className="absolute right-0 bottom-0 rounded-full ring-2 ring-bg">
					<AgentAvatar avatar={b} size={small} />
				</span>
			)}
			{c && !b && (
				<span className="absolute right-0 bottom-0">
					<AgentAvatar avatar={c} size={small} />
				</span>
			)}
		</span>
	);
}
