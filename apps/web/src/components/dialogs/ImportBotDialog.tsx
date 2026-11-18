import { AgentAvatar, api, pluralize } from "@sekai/client";
import { type BotFile, randomAvatar } from "@sekai/shared";
import { Button, Callout, Dialog } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOpenAgent } from "../../lib/navigation.ts";
import { useUi } from "../../stores/ui.ts";

/** A new bot from an exported .sekai-bot.json: pick the file, see what's in it, import. */
export function ImportBotDialog() {
	const open = useUi((s) => s.importBotOpen);
	const setOpen = useUi((s) => s.setImportBotOpen);
	const openAgent = useOpenAgent();
	const qc = useQueryClient();
	const input = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<BotFile | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setFile(null);
			setError(null);
		}
	}, [open]);

	const pick = async (f: File) => {
		setError(null);
		try {
			const data = JSON.parse(await f.text()) as BotFile;
			if ((data?.format !== "sekai-bot" && data?.format !== "feesh-bot") || !data.bot?.name)
				throw new Error("not a bot");
			setFile(data);
		} catch {
			setFile(null);
			setError("That isn't a Sekai bot file (a .sekai-bot.json exported from a bot's profile).");
		}
	};

	const run = useMutation({
		mutationFn: () => api.agents.import(file),
		onSuccess: (r) => {
			setOpen(false);
			void qc.invalidateQueries({ queryKey: ["agents"] });
			void qc.invalidateQueries({ queryKey: ["skills"] });
			toast.success(
				`${r.name} is here${r.routines ? `. Its ${pluralize(r.routines, "routine")} start paused.` : "."}`,
			);
			if (r.missingApps.length) {
				toast.warning(`Apps it used that aren't set up here: ${r.missingApps.join(", ")}`);
			}
			void openAgent(r.agentId);
		},
		onError: (e) => setError(e instanceof Error ? e.message : String(e)),
	});

	const avatar = file
		? file.bot.avatarImage
			? ({
					kind: "image",
					url: `data:${file.bot.avatarImage.mime};base64,${file.bot.avatarImage.base64}`,
				} as const)
			: (file.bot.avatar ?? randomAvatar(file.bot.name))
		: null;
	const contents = file
		? [
				file.skills.length ? pluralize(file.skills.length, "skill") : null,
				file.routines.length ? pluralize(file.routines.length, "routine") : null,
				file.apps.length ? pluralize(file.apps.length, "app") : null,
				file.memories.length ? pluralize(file.memories.length, "memory", "memories") : null,
				file.notes.length ? pluralize(file.notes.length, "note") : null,
			].filter(Boolean)
		: [];

	return (
		<Dialog
			open={open}
			onOpenChange={setOpen}
			title="Import a bot"
			description="From a file exported on a bot's profile, here or on another Sekai."
			footer={
				<>
					<Button variant="secondary" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!file || run.isPending} onClick={() => run.mutate()}>
						Import
					</Button>
				</>
			}
		>
			<input
				ref={input}
				type="file"
				accept=".json,application/json"
				className="hidden"
				onChange={(e) => {
					const f = e.target.files?.[0];
					if (f) void pick(f);
					e.target.value = "";
				}}
			/>
			{file && avatar ? (
				<div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
					<AgentAvatar avatar={avatar} size={44} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold">{file.bot.name}</div>
						<div className="truncate text-xs text-fg-muted">{file.bot.label || "No label"}</div>
						<div className="truncate text-xs text-fg-subtle">
							{contents.length ? contents.join(" · ") : "Just the profile"}
						</div>
					</div>
					<Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
						Change
					</Button>
				</div>
			) : (
				<button
					type="button"
					onClick={() => input.current?.click()}
					className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center hover:bg-muted/50"
				>
					<FileUp className="size-6 text-fg-subtle" />
					<span className="text-sm font-medium">Choose a .sekai-bot.json file</span>
					<span className="text-xs text-fg-subtle">Nothing is added until you press Import.</span>
				</button>
			)}
			{file && (
				<p className="text-xs leading-5 text-fg-subtle">
					It comes in as a new bot. Routines start paused; apps it used connect again if you have one with the
					same name. Chats, accounts and computers never travel in a bot file.
				</p>
			)}
			{error && (
				<Callout tone="danger" icon={<TriangleAlert />}>
					{error}
				</Callout>
			)}
		</Dialog>
	);
}
