import { cn } from "@sekai/client";
import { Input, Spinner } from "@sekai/ui";
import { Search, X } from "lucide-react";

export interface SearchInputProps {
	value: string;
	onValueChange: (value: string) => void;
	/** Accessible label for screen readers. */
	label: string;
	placeholder?: string;
	loading?: boolean;
	className?: string;
}

/**
 * A search field with a leading search icon, an inline loading spinner while results update, and a touch-friendly
 * clear button whenever text is typed. Candidate for promotion to @sekai/ui.
 */
export function SearchInput({ value, onValueChange, label, placeholder, loading, className }: SearchInputProps) {
	const hasTrailing = Boolean(value || loading);
	return (
		<div className={cn("relative", className)}>
			<Search
				aria-hidden
				className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
			/>
			<Input
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				placeholder={placeholder}
				aria-label={label}
				className={cn("pl-9", hasTrailing && "pr-10")}
			/>
			{loading ? (
				<Spinner className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />
			) : value ? (
				<button
					type="button"
					onClick={() => onValueChange("")}
					aria-label="Clear search"
					className="absolute inset-y-0 right-1 my-auto flex size-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg coarse:size-10"
				>
					<X className="size-4" />
				</button>
			) : null}
		</div>
	);
}
