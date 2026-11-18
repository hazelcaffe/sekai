import { THEMES, type ThemeChoice, type ThemeInfo, themeInfo } from "@sekai/ui";
import { Check } from "lucide-react";
import { cn } from "../utils.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";

/** A little picture of a theme: its background, a message in its color, and the group's character. */
function Preview({ theme, className }: { theme: ThemeInfo; className?: string }) {
	const dark = theme.mode === "dark";
	return (
		<span
			className={cn("relative flex items-end gap-2 overflow-hidden p-2.5", className)}
			style={{ background: theme.background }}
		>
			<AgentAvatar avatar={{ kind: "gallery", id: theme.icon, color: theme.brand }} size={30} />
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span
					className="h-2 w-3/4 rounded-full"
					style={{ background: dark ? "rgb(255 255 255 / 0.14)" : "rgb(0 0 0 / 0.08)" }}
				/>
				<span className="h-2 w-1/2 self-end rounded-full" style={{ background: theme.brand }} />
			</span>
		</span>
	);
}

/** Sekai's themes: Automatic (Virtual Singers by day, Nightcord at 25:00 at night) and the six groups. */
export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
	const card = (selected: boolean) =>
		cn(
			"group relative flex flex-col overflow-hidden rounded-2xl border bg-card text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/40",
			selected ? "border-brand ring-2 ring-brand/30" : "border-border hover:border-border-strong",
		);
	const label = (title: string, detail: string, selected: boolean) => (
		<span className="flex items-center gap-2 px-3 py-2">
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13px] font-medium">{title}</span>
				<span className="block truncate text-xs text-fg-subtle">{detail}</span>
			</span>
			{selected && <Check className="size-4 shrink-0 text-brand-ink" />}
		</span>
	);
	return (
		<fieldset className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-label="Theme">
			<button
				type="button"
				aria-pressed={value === "auto"}
				onClick={() => onChange("auto")}
				className={card(value === "auto")}
			>
				<span className="flex h-16">
					<Preview theme={themeInfo("vs")} className="w-1/2" />
					<Preview theme={themeInfo("n25")} className="w-1/2" />
				</span>
				{label("Automatic", "Follows your device", value === "auto")}
			</button>
			{THEMES.map((t) => (
				<button
					key={t.id}
					type="button"
					aria-pressed={value === t.id}
					onClick={() => onChange(t.id)}
					className={card(value === t.id)}
				>
					<Preview theme={t} className="h-16" />
					{label(t.name, t.mode === "light" ? "Light" : "Dark", value === t.id)}
				</button>
			))}
		</fieldset>
	);
}
