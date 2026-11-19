import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { guardedFetch, reachOf } from "../../lib/net.ts";
import { driverFor } from "../../machines/drivers.ts";
import { machinesForBot } from "../../machines/seats.ts";
import { getUploadRow, saveUpload } from "../../services/uploads.ts";
import { machineTarget, onMachine, peek, riskOn } from "./targets.ts";
import { defineTool, ToolError, ToolOutput } from "./types.ts";

const MAX_BYTES = 15 * 1024 * 1024;

const EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/avif": "avif",
};

function mimeFromName(name: string): string | null {
	const ext = name.toLowerCase().split(".").pop() ?? "";
	return (
		{
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			webp: "image/webp",
			svg: "image/svg+xml",
			avif: "image/avif",
		}[ext] ?? null
	);
}

/** Pictures in the reply come from the internet, never this server or your own network (admin pages, metadata…). */
async function assertPublic(url: URL): Promise<void> {
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new ToolError("Only http(s) links can be attached.");
	if ((await reachOf(url)) !== "public")
		throw new ToolError("That address is on this server or your own network; attach a public image instead.");
}

async function fromUrl(
	raw: string,
	signal: AbortSignal,
): Promise<{ data: Uint8Array; mime: string; name: string; source: string }> {
	// Screenshots and files already in this chat.
	const local = raw.match(/\/api\/uploads\/([\w-]+)/);
	if (local?.[1]) {
		const row = await getUploadRow(local[1]).catch(() => null);
		if (!row) throw new ToolError("That image isn't in Sekai any more.");
		if (!row.mime.startsWith("image/")) throw new ToolError("That file isn't an image.");
		return {
			data: new Uint8Array(await Bun.file(row.path).arrayBuffer()),
			mime: row.mime,
			name: row.name,
			source: "",
		};
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ToolError("That isn't a valid link.");
	}
	await assertPublic(url);
	// Every redirect is checked too (a public link mustn't bounce to the server's own network).
	const res = await guardedFetch(url, {
		headers: { "user-agent": "Mozilla/5.0 (compatible; SekaiAgent/0.1)", accept: "image/*,*/*;q=0.5" },
		signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
	}).catch((err: unknown) => {
		throw new ToolError(`Couldn't download it: ${errorMessage(err)}`);
	});
	if (!res.ok) throw new ToolError(`Couldn't download it: ${res.status} ${res.statusText}`);
	const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	const name = decodeURIComponent(url.pathname.split("/").pop() || "image");
	const mime = type.startsWith("image/") ? type : mimeFromName(name);
	if (!mime) {
		throw new ToolError(
			`That link is a ${type || "page"}, not an image. Open the page and attach the picture's own address (or take a screenshot and attach that).`,
		);
	}
	const data = new Uint8Array(await res.arrayBuffer());
	if (data.length > MAX_BYTES) throw new ToolError("That image is larger than 15 MB.");
	return { data, mime, name, source: url.toString() };
}

export const mediaTools = [
	defineTool({
		name: "attach_image",
		description:
			"Show the user an image in your reply: a picture from the web (its direct link, or a page's image link you found), a screenshot you took earlier in this reply (screenshot: true for the latest, or its /api/uploads/… link), or an image file on your computer, a devbox, or the user's computer (path + machine). Use it whenever the user asks you to send, show or share an image or screenshot. The image appears where you call it; mention it in your text naturally, don't paste its link.",
		category: "media",
		parameters: z.object({
			url: z.string().max(4000).optional().describe("Direct link to the image, or an /api/uploads/… link"),
			screenshot: z.boolean().optional().describe("Attach the latest screenshot you took in this reply"),
			path: z.string().max(1000).optional().describe("An image file on a machine"),
			machine: onMachine,
			caption: z.string().max(300).optional().describe("Short description for people who can't see it"),
		}),
		risk: "read",
		title: (a) =>
			a.screenshot
				? "Attached the screenshot"
				: a.path
					? `Attached ${a.path.split("/").pop()}`
					: "Attached an image",
		riskFor: async (args, ctx) => (args.path ? riskOn(await peek(ctx, args.machine, false), "read") : "read"),
		async execute(args, ctx) {
			const sources = [args.url, args.screenshot, args.path].filter(Boolean).length;
			if (sources !== 1) throw new ToolError("Give exactly one of url, screenshot or path.");
			let picked: { data: Uint8Array; mime: string; name: string; source: string };
			if (args.screenshot) {
				const last = ctx.recentImages?.().at(-1);
				if (!last)
					throw new ToolError(
						"You haven't taken a screenshot in this reply yet. Take one first, then attach it.",
					);
				picked = await fromUrl(last, ctx.signal);
			} else if (args.path) {
				const all = await machinesForBot(ctx.agent.id);
				if (!all.length)
					throw new ToolError("You don't have a computer, devbox or lent computer to read files from.");
				const m = await machineTarget(ctx, args.machine);
				const mime = mimeFromName(args.path);
				if (!mime)
					throw new ToolError("That file doesn't look like an image (png, jpg, gif, webp, svg or avif).");
				const driver = await driverFor(m, ctx.agent.id);
				const quoted = `'${args.path.replace(/'/g, `'\\''`)}'`;
				let r = await driver.exec(`base64 < ${quoted} | tr -d '\\n'`, {
					timeoutMs: 60_000,
					signal: ctx.signal,
				});
				if (r.code !== 0 && m.kind === "device") {
					// Windows: PowerShell instead of base64.
					const ps = args.path.replace(/'/g, "''");
					r = await driver.exec(`[Convert]::ToBase64String([IO.File]::ReadAllBytes('${ps}'))`, {
						timeoutMs: 60_000,
						signal: ctx.signal,
					});
				}
				if (r.code !== 0) throw new ToolError(r.stderr.trim().slice(0, 300) || "Couldn't read that file.");
				const data = Buffer.from(r.stdout.trim(), "base64");
				if (data.length === 0) throw new ToolError("That file is empty.");
				if (data.length > MAX_BYTES) throw new ToolError("That image is larger than 15 MB.");
				picked = { data, mime, name: args.path.split(/[\\/]/).pop() ?? "image", source: "" };
			} else {
				picked = await fromUrl(args.url ?? "", ctx.signal);
			}
			const ext = EXT[picked.mime] ?? "img";
			const name = /\.\w{2,5}$/.test(picked.name) ? picked.name : `${picked.name}.${ext}`;
			const saved = await saveUpload(picked.data, name, picked.mime);
			const alt = args.caption?.trim() || "";
			return new ToolOutput(
				`Attached ${name} (${Math.round(picked.data.length / 1024)} KB). The user can see it in your reply now.`,
				[],
				[{ url: saved.url, alt, name, source: picked.source || undefined }],
			);
		},
	}),
];
