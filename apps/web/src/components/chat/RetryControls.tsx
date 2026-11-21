import { api, ModelList } from "@sekai/client";
import type { Message } from "@sekai/shared";
import { Confirm, IconButton, Popover, PopoverClose, Switch } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useId, useState } from "react";

/**
 * Try again: same model or another one. By default the current answer stays as a previous version (the
 * new attempt never sees it); "Erase this answer" removes it from the chat and the bot's context for good.
 */
export function RetryButton({ message, onDone }: { message: Message; onDone?: () => void }) {
	const [wipe, setWipe] = useState(false);
	const [erase, setErase] = useState<{ model: string | null } | null>(null);
	const wipeId = useId();
	const retry = useMutation({
		mutationFn: ({ model, wipe }: { model: string | null; wipe: boolean }) =>
			api.messages.retry(message.id, { wipe, model: model ? { model, thinking: "default" } : null }),
		onSuccess: () => onDone?.(),
	});
	const run = (model: string | null) => (wipe ? setErase({ model }) : retry.mutate({ model, wipe: false }));
	return (
		<>
			<Popover
				side="top"
				align="start"
				className="w-[min(360px,calc(100vw-24px))] p-0"
				trigger={
					<IconButton label="Try again" size="icon-sm" disabled={retry.isPending} className="coarse:size-11">
						<RotateCcw />
					</IconButton>
				}
			>
				<div className="flex flex-col gap-1 p-1.5">
					<PopoverClose asChild>
						<button
							type="button"
							onClick={() => run(null)}
							className="flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-body hover:bg-surface-2"
						>
							<RotateCcw className="size-4 text-fg-muted" />
							<span className="flex-1">
								<span className="block font-medium">Try again</span>
								<span className="block text-small text-fg-subtle">Same model</span>
							</span>
						</button>
					</PopoverClose>
					<label
						htmlFor={wipeId}
						className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-surface-2/60"
					>
						<span className="min-w-0 flex-1">
							<span className="block text-body font-medium">Erase this answer</span>
							<span className="block text-small text-fg-subtle">
								{wipe ? "It's removed for good." : "Otherwise it stays as a previous version."}
							</span>
						</span>
						<Switch id={wipeId} checked={wipe} onCheckedChange={setWipe} label="Erase this answer" />
					</label>
				</div>
				<div className="border-t border-border pt-2">
					<div className="px-3 pb-1 text-caption font-medium text-fg-subtle">Or try another model</div>
					<ModelList value={message.model ?? ""} allowByos onSelect={run} />
				</div>
			</Popover>
			<Confirm
				open={Boolean(erase)}
				onOpenChange={(open) => !open && setErase(null)}
				danger
				title="Erase this answer?"
				description="This answer will be removed before the bot tries again."
				confirmLabel="Erase and retry"
				onConfirm={() => erase && retry.mutate({ model: erase.model, wipe: true })}
			/>
		</>
	);
}

/** ‹ 2 / 3 ›: switch between answers to the same turn. The one shown is what the bot sees from then on. */
export function VersionSwitcher({ message }: { message: Message }) {
	const versions = message.meta.versions ?? [];
	const streaming = message.status === "streaming";
	const total = Math.max(versions.length, (message.meta.version ?? 0) + (streaming ? 1 : 0));
	const current = message.meta.version ?? total - 1;
	const set = useMutation({ mutationFn: (v: number) => api.messages.setVersion(message.id, v) });
	if (total < 2) return null;
	const go = (v: number) => {
		if (v >= 0 && v < versions.length && !streaming) set.mutate(v);
	};
	return (
		<span className="flex items-center text-caption text-fg-subtle tabular-nums">
			<IconButton
				label="Previous answer"
				size="icon-sm"
				disabled={current <= 0 || streaming}
				onClick={() => go(current - 1)}
				className="coarse:size-11"
			>
				<ChevronLeft className="size-4" />
			</IconButton>
			{current + 1}/{total}
			<IconButton
				label="Next answer"
				size="icon-sm"
				disabled={current >= total - 1 || streaming}
				onClick={() => go(current + 1)}
				className="coarse:size-11"
			>
				<ChevronRight className="size-4" />
			</IconButton>
		</span>
	);
}
