import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "../lib/utils.ts";
import { IconButton } from "./button.tsx";

/** Copies text; on plain http (no clipboard API) it falls back to the old way. */
export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.append(area);
	area.select();
	try {
		if (!document.execCommand("copy")) throw new Error("Copying isn't allowed here.");
	} finally {
		area.remove();
	}
}

export interface CopyFieldProps {
	value: string;
	/** What's copied, when it isn't exactly what's shown (a key shown in groups of four). */
	copyValue?: string;
	/** What it is, in words ("redirect URL", "install command"): names the copy button ("Copy redirect URL"). */
	label: string;
	/** Show the label before the value, for a few values together (a computer's addresses and passwords). */
	showLabel?: boolean;
	/** Dots instead of the value (copying still copies it). */
	secret?: boolean;
	/** Long values (commands, keys) wrap instead of being cut short. */
	multiline?: boolean;
	className?: string;
}

/**
 * A value to copy (a link, a token, a command, an address, a password): the value in a quiet box and a copy button
 * that turns into a check for a moment. If the browser won't copy, it says so and the value stays selectable.
 */
export function CopyField({ value, copyValue, label, showLabel, secret, multiline, className }: CopyFieldProps) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<div
			data-slot="copy-field"
			className={cn(
				"flex min-w-0 gap-2 rounded-lg bg-surface-2 py-1 pr-1 pl-3",
				multiline ? "items-start" : "items-center",
				className,
			)}
		>
			{showLabel && (
				<span className={cn("w-20 shrink-0 truncate text-small text-fg-subtle", multiline && "py-1.5")}>
					{label}
				</span>
			)}
			<code
				className={cn(
					// contain-inline-size: a long value never widens the grid or column it sits in.
					"min-w-0 flex-1 font-mono text-small text-fg select-all contain-inline-size",
					multiline ? "py-1.5 break-all whitespace-pre-wrap" : "truncate",
				)}
			>
				{secret ? "••••••••••" : value}
			</code>
			<IconButton
				label={copied ? "Copied" : `Copy ${label}`}
				size="icon-sm"
				className="shrink-0"
				onClick={() => {
					copyText(copyValue ?? value).then(
						() => setCopied(true),
						() => toast.error("Couldn't copy it. Select it and copy it by hand."),
					);
				}}
			>
				{copied ? <Check className="text-success-ink" /> : <Copy />}
			</IconButton>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</div>
	);
}
