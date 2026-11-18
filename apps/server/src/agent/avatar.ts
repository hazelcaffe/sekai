import type { Agent, Avatar } from "@sekai/shared";
import { badRequest } from "../lib/errors.ts";
import { truncate } from "../lib/text.ts";
import { chat } from "../llm/gateway.ts";
import { getSettings } from "../services/settings.ts";
import { saveUpload } from "../services/uploads.ts";
import { availableModels, gatewayModel, resolveModel } from "./models.ts";

/** Strips anything active from model-written SVG. It's also only ever rendered via <img>, which can't run scripts. */
export function sanitizeSvg(raw: string): string {
	const match = raw.match(/<svg[\s\S]*<\/svg>/i);
	if (!match) throw badRequest("The model didn't return an SVG");
	let svg = match[0];
	svg = svg.replace(/<(script|foreignObject|iframe|object|embed|audio|video)[\s\S]*?<\/\1\s*>/gi, "");
	svg = svg.replace(/<(script|foreignObject|iframe|object|embed)[^>]*\/>/gi, "");
	svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
	svg = svg.replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?!#)[^"']*\1/gi, "");
	svg = svg.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none");
	if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
	return svg;
}

/** "Generate" tab: the agent's own model draws its avatar as SVG from a short description. */
export async function generateAvatar(agent: Agent | null, prompt: string): Promise<Avatar> {
	const description = prompt.trim();
	if (!description) throw badRequest("Describe the avatar first");
	const settings = await getSettings();
	const model = gatewayModel(agent?.models.primary) ?? resolveModel(settings.defaultModel, await availableModels());
	const result = await chat({
		model: model.model,
		thinking: "low",
		maxTokens: 12_000,
		messages: [
			{
				role: "system",
				content:
					'You are an illustrator who draws app avatars as clean SVG. Output a single <svg> element and nothing else: viewBox="0 0 256 256", flat vector style, a friendly character or emblem centered on a softly colored full-bleed background (a circle or rounded square filling the canvas), bold simple shapes that read at 32px, at most 3–5 colors, no text, no external references, no scripts, no filters heavier than a soft shadow. Keep it under 6 KB.',
			},
			{
				role: "user",
				content: `Avatar for an AI agent${agent ? ` named "${agent.name}"${agent.label ? ` (${agent.label})` : ""}` : ""}: ${truncate(description, 1000)}`,
			},
		],
	});
	const svg = sanitizeSvg(result.text);
	const upload = await saveUpload(svg, `${agent?.name ?? "avatar"}.svg`, "image/svg+xml");
	return { kind: "image", url: upload.url };
}
