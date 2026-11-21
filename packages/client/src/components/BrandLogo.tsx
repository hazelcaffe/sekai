import type { ReactNode } from "react";
import { cn } from "../utils.ts";
import { type Brand, LOGOS } from "./logos.ts";

/** Subscription (BYOS) presets → their product's mark. */
const PRESET_BRANDS: Record<string, Brand> = {
	codex: "codex",
	claude: "claude-code",
	grok: "grok",
	opencode: "opencode",
	pi: "pi",
	devin: "devin",
	antigravity: "antigravity",
	muse: "muse",
};

/** Single sign-on providers → their mark. */
export function ssoBrand(kind: string): Brand | null {
	return kind === "google" || kind === "github" || kind === "discord" ? kind : null;
}

/** API provider presets and model makers (the gateway's provider names) → their mark. */
const VENDOR_BRANDS: Record<string, Brand> = {
	openai: "openai",
	anthropic: "anthropic",
	google: "gemini",
	gemini: "gemini",
	openrouter: "openrouter",
	xai: "xai",
	groq: "groq",
	mistral: "mistral",
	deepseek: "deepseek",
	together: "together",
	ollama: "ollama",
	lmstudio: "lmstudio",
	elevenlabs: "elevenlabs",
	fishaudio: "fishaudio",
	meta: "meta",
	moonshot: "moonshot",
	moonshotai: "moonshot",
	zai: "zai",
	qwen: "qwen",
	nvidia: "nvidia",
};

export function presetBrand(preset: string | null | undefined): Brand | null {
	return (preset && PRESET_BRANDS[preset]) || null;
}

export function vendorBrand(id: string | null | undefined): Brand | null {
	return (id && VENDOR_BRANDS[id.toLowerCase()]) || null;
}

/** Just the mark, at the size of the text around it (or `size`). Single-colour marks follow the text colour. */
export function BrandGlyph({ brand, size, className }: { brand: Brand; size?: number; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("inline-flex shrink-0 [&>svg]:size-full", !size && "size-[1em]", className)}
			style={size ? { width: size, height: size } : undefined}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: our own bundled SVG markup, nothing from users
			dangerouslySetInnerHTML={{ __html: LOGOS[brand] }}
		/>
	);
}

/**
 * A brand's mark on a rounded tile, like an app icon: white in light mode, raised in dark mode, so colour marks
 * and single-colour ones both read. Without a known brand it shows `fallback` (an icon or letters).
 */
export function BrandTile({
	brand,
	size = 36,
	fallback,
	className,
}: {
	brand: Brand | null;
	size?: number;
	fallback?: ReactNode;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-flex shrink-0 items-center justify-center border border-border bg-paper text-paper-ink dark:bg-surface-2 dark:text-fg",
				size >= 32 ? "rounded-lg" : "rounded-md",
				className,
			)}
			style={{ width: size, height: size }}
		>
			{brand ? <BrandGlyph brand={brand} size={Math.round(size * 0.6)} /> : fallback}
		</span>
	);
}
