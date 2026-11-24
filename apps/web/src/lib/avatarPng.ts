import type { Agent } from "@sekai/shared";

/**
 * A bot's avatar as the app draws it (its picture, or its emoji on its colour), exported whole as a 512px PNG: for
 * apps that take a picture file (a Slack app's icon, a Signal profile). `element` holds the rendered AgentAvatar.
 * `circle`: the app shows it in a circle (Signal), so a Colorful Stage icon is made smaller, on its colour, to fit
 * inside the circle whole (that art is only ever resized, never cropped).
 */
export async function avatarPng(element: HTMLElement, agent: Agent, opts: { circle?: boolean } = {}): Promise<Blob> {
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
		// Resized to fit, never cropped.
		const inCircle = opts.circle && agent.avatar.kind === "gallery";
		const box = inCircle ? 512 / Math.SQRT2 : 512;
		if (inCircle && agent.avatar.kind === "gallery") {
			ctx.fillStyle = agent.avatar.color || "#ffffff";
			ctx.fillRect(0, 0, 512, 512);
		}
		const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
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
	return blob;
}

/** A picture as a data URL (what the server takes for a profile picture). */
export function blobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Your browser couldn't read the picture."));
		reader.readAsDataURL(blob);
	});
}

/** Saves a file the browser made (a download). */
export function downloadBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
