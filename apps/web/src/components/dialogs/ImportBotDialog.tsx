import { AgentAvatar, api, pluralize, useAccess } from "@sekai/client";
import { type BotFile, randomAvatar } from "@sekai/shared";
import { Button, Callout, Dialog, errorMessage, List, Row } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOpenAgent } from "../../lib/navigation.ts";
import { useUi } from "../../stores/ui.ts";
import { readBotFile } from "./read-bot-file.ts";

/** A new bot from an exported .sekai-bot.json: pick the file, see what's in it, import. */
export function ImportBotDialog() {
	const open = useUi((s) => s.importBotOpen);
	const setOpen = useUi((s) => s.setImportBotOpen);
	const openAgent = useOpenAgent();
	const qc = useQueryClient();
	const input = useRef<HTMLInputElement>(null);
	const { access, can } = useAccess();
	const [picked, setPicked] = useState<{ file: BotFile; raw: unknown } | null>(null);
	const file = picked?.file ?? null;
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setPicked(null);
			setError(null);
		}
	}, [open]);

	const pick = async (f: File) => {
		setError(null);
		const read = readBotFile(await f.text().catch(() => ""));
		if ("error" in read) {
			setPicked(null);
			setError(read.error);
		} else setPicked(read);
	};

	const run = useMutation({
		mutationFn: () => api.agents.import(picked?.raw),
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
		onError: (e) => setError(errorMessage(e)),
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

	// Importing makes a bot: only offered to people whose role lets them make bots.
	if (access && !can("bots")) return null;
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
					<Button variant="primary" disabled={!file} loading={run.isPending} onClick={() => run.mutate()}>
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
			<div className="flex flex-col gap-4">
				{file && avatar ? (
					<List label="The bot in the file">
						<Row
							leading={<AgentAvatar avatar={avatar} size={40} />}
							title={file.bot.name}
							subtitle={[file.bot.label, contents.length ? contents.join(", ") : "Just the profile"]
								.filter(Boolean)
								.join(" · ")}
							trailing={
								<Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
									Change
								</Button>
							}
						/>
					</List>
				) : (
					<button
						type="button"
						onClick={() => input.current?.click()}
						className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center transition-colors duration-fast hover:bg-surface-2"
					>
						<FileUp className="size-6 text-fg-subtle" />
						<span className="text-body font-medium">Choose a bot file</span>
						<span className="text-small text-fg-muted">
							A .sekai-bot.json. Nothing is added until you import it.
						</span>
					</button>
				)}
				{file && (
					<p className="text-small text-fg-muted">
						It comes in as a new bot, and its routines start paused. Chats, accounts and computers never
						travel in a bot file.
					</p>
				)}
				{error && (
					<Callout tone="danger" icon={<TriangleAlert />}>
						{error}
					</Callout>
				)}
			</div>
		</Dialog>
	);
}
