import { AgentAvatar } from "@sekai/client";
import { type Agent, slackCommand, slackManifest } from "@sekai/shared";
import { Button, Fold } from "@sekai/ui";
import { Copy, Download, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** The same rendered avatar, exported whole to PNG; Slack doesn't offer an API to set an app icon. */
async function avatarPng(element: HTMLDivElement, agent: Agent): Promise<void> {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 512;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Your browser couldn't create the picture.");
	const picture = element.querySelector("img");
	const svg = element.querySelector("svg");
	if (picture || svg) {
		const image = new Image();
		image.crossOrigin = "anonymous";
		image.src =
			picture?.src ??
			`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg as SVGSVGElement))}`;
		await image.decode();
		const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
		const w = image.naturalWidth * scale;
		const h = image.naturalHeight * scale;
		ctx.drawImage(image, (512 - w) / 2, (512 - h) / 2, w, h);
	} else if (agent.avatar.kind === "emoji") {
		ctx.fillStyle = agent.avatar.color;
		ctx.beginPath();
		ctx.arc(256, 256, 256, 0, Math.PI * 2);
		ctx.fill();
		ctx.font = "280px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(agent.avatar.emoji, 256, 270);
	} else throw new Error("The picture hasn't loaded yet. Try again in a moment.");
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("Your browser couldn't save the picture.");
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${agent.name.replace(/[^\p{L}\p{N}-]/gu, "-")}-slack.png`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SlackSetup({ agent }: { agent: Agent }) {
	const manifest = JSON.stringify(slackManifest(agent), null, 2);
	const createUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(agent)))}`;
	const avatar = useRef<HTMLDivElement>(null);
	const [show, setShow] = useState(false);
	return (
		<div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
			<div className="flex items-center gap-3">
				<div ref={avatar}>
					<AgentAvatar avatar={agent.avatar} size={44} />
				</div>
				<div className="min-w-0">
					<p className="text-body font-medium">{agent.name}'s own Slack app</p>
					<p className="text-small text-fg-muted">Its own name, picture, mentions and DMs.</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button variant="primary" size="sm" asChild>
					<a href={createUrl} target="_blank" rel="noreferrer">
						<ExternalLink /> Create the app in Slack
					</a>
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={() =>
						void navigator.clipboard.writeText(manifest).then(
							() => toast.success("Manifest copied"),
							() => {
								setShow(true);
								toast.error("Couldn't copy it. Copy it from the manifest below.");
							},
						)
					}
				>
					<Copy /> Copy manifest
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => {
						if (avatar.current)
							void avatarPng(avatar.current, agent).catch((e: unknown) =>
								toast.error(e instanceof Error ? e.message : "Couldn't save the picture."),
							);
					}}
				>
					<Download /> Save its picture
				</Button>
			</div>
			{agent.avatar.kind === "gallery" && (
				<p className="text-caption text-fg-subtle">
					© SEGA / © Colorful Palette Inc. / © Crypton Future Media, INC. www.piapro.net
				</p>
			)}
			<Fold variant="link" title="About the app">
				<div className="flex flex-col gap-2">
					<p>
						Slack can't take the picture from Sekai: save it, then set it as the app icon (Basic information
						→ Display information). Its command is{" "}
						<code className="break-all text-fg">{slackCommand(agent)}</code>, followed by help, status, new,
						stop or model. In a thread, type <code className="text-fg">@{agent.name} /help</code>.
					</p>
					<button
						type="button"
						className="self-start text-small font-medium text-brand-ink hover:underline coarse:py-2"
						onClick={() => setShow(!show)}
					>
						{show ? "Hide the manifest" : "Show the manifest"}
					</button>
				</div>
			</Fold>
			{/* Outside the fold, so it's there to copy by hand when copying it didn't work. */}
			{show && (
				<pre className="max-h-64 max-w-full overflow-auto rounded-lg bg-surface-2 p-3 text-caption text-fg-muted">
					{manifest}
				</pre>
			)}
		</div>
	);
}
