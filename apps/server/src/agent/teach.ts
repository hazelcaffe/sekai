import {
	type Agent,
	type ModelRef,
	pickFrames,
	SKILL_NAME_RE,
	type Skill,
	type SkillDraft,
	type TeachDraftInput,
	TeachDraftInput as TeachDraftSchema,
	type TeachSave as TeachSaveInput,
	TeachSave as TeachSaveSchema,
	type TeachStep,
} from "@sekai/shared";
import type { z } from "zod";
import { badRequest, errorMessage, HttpError, parse } from "../lib/errors.ts";
import { extractJson } from "../lib/text.ts";
import { getModelInfo } from "../llm/catalog.ts";
import { chat } from "../llm/gateway.ts";
import type { ChatContentPart, ChatMessage } from "../llm/types.ts";
import { updateAgent } from "../services/agents.ts";
import { getSettings } from "../services/settings.ts";
import { createSkill } from "../services/skills.ts";
import { gatewayModel } from "./models.ts";

/** Teaching a bot by doing it once: a demonstration on its computer, written up as a skill by a model that can see. */

type Draft = z.output<typeof TeachDraftSchema>;

/** Screenshots the bot's computer_ tools take are at most this wide; steps are described in their pixels. */
const SHOT_WIDTH = 1280;

const at = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** One step in words, with coordinates in screenshot pixels (what the bot's computer_ tools use). */
export function describeStep(s: TeachStep, scale: number): string {
	const p = (x: number, y: number) => `(${Math.round(x / scale)}, ${Math.round(y / scale)})`;
	const where = s.window ? ` in "${s.window}"` : "";
	switch (s.kind) {
		case "click":
			return `${s.double ? "Double-clicked" : s.button === "right" ? "Right-clicked" : s.button === "middle" ? "Middle-clicked" : "Clicked"} at ${p(s.x, s.y)}${where}`;
		case "drag":
			return `Dragged from ${p(s.x, s.y)} to ${p(s.toX, s.toY)}${where}`;
		case "scroll":
			return `Scrolled ${s.direction} ${s.amount} notch${s.amount === 1 ? "" : "es"} at ${p(s.x, s.y)}${where}`;
		case "type":
			return `${s.pasted ? "Pasted" : "Typed"} ${JSON.stringify(s.text)}${s.field ? ` into "${s.field}"` : ""}${where}`;
		case "secret":
			return `Typed a password or other private text${s.field ? ` into "${s.field}"` : ""}${where} (hidden: never shown to you)`;
		case "key":
			return `Pressed ${s.combo}${where}`;
	}
}

export function teachMessages(input: Draft, botName: string): ChatMessage[] {
	const scale = input.screen.width > SHOT_WIDTH ? input.screen.width / SHOT_WIDTH : 1;
	const shot = { width: Math.round(input.screen.width / scale), height: Math.round(input.screen.height / scale) };
	const system = [
		`You turn a demonstration into a skill for ${botName}, an AI agent with its own Linux computer (Debian with the XFCE desktop and Google Chrome). The user just did a task on that computer to show the agent how: below are their actions in order, with the screen as it was at each click (a red ring marks where they clicked) and the screen when they finished.`,
		`Coordinates are in screenshot pixels (${shot.width}x${shot.height}), the same ones the agent's computer_ tools use.`,
		"",
		"Write a skill the agent can follow to do this task again on its own, reliably:",
		"- Describe each step by what it means, not by pixels: which app or website, which URL, the label of the button, menu item or field (read them off the screenshots), what to type. Give coordinates only where nothing else identifies the target.",
		"- Prefer the agent's sturdier tools: the browser_ tools for websites (open the URL, find things in a snapshot, click and fill by label), computer_ui to find elements in desktop apps, run_command for anything a terminal does better. computer_click at coordinates is the last resort.",
		"- Generalize. What the user typed or chose that will differ next time is an input: say where it comes from (asking the user, a note, memory, today's date). Keep what's clearly fixed (a URL, a menu path, a setting).",
		"- Private text was hidden from you. Where a password was typed, the agent signs in with its saved login, or asks the user through the browser's login prompt; it never asks for a password in chat.",
		"- Leave out false starts, mis-clicks and detours the user undid.",
		"- End with how to check it worked (what the screen shows when it's done), and what needs the user's OK first (sending, buying, deleting, publishing).",
		"",
		'Reply with JSON only: {"name": "a-lowercase-slug", "title": "A short title", "description": "Use when… (one or two sentences: when the agent should load this skill)", "instructions": "Markdown with these sections: ## When to use, ## Inputs, ## Steps (numbered), ## Check, ## Approval"}',
	].join("\n");

	const frames = pickFrames(input.steps);
	const content: ChatContentPart[] = [
		{
			type: "text",
			text: [
				`What the user showed: ${input.goal}`,
				...(input.notes ? [`What they added: ${input.notes}`] : []),
				`Their ${input.steps.length} action${input.steps.length === 1 ? "" : "s"} (minutes:seconds since they started):`,
			].join("\n"),
		},
	];
	input.steps.forEach((s, i) => {
		content.push({ type: "text", text: `${i + 1}. [${at(s.at)}] ${describeStep(s, scale)}` });
		const image = s.kind === "click" || s.kind === "drag" ? s.image : undefined;
		if (image && frames.has(i)) content.push({ type: "image_url", image_url: { url: image, detail: "high" } });
	});
	if (input.finalImage) {
		content.push({ type: "text", text: "The screen when they finished:" });
		content.push({ type: "image_url", image_url: { url: input.finalImage, detail: "high" } });
	}
	return [
		{ role: "system", content: system },
		{ role: "user", content },
	];
}

/** A slug for a skill's name from its title, when the model's isn't one. */
export function slug(text: string): string {
	const s = text
		.toLowerCase()
		.normalize("NFKD")
		// Accents come apart from their letters (ç is c and a cedilla): keep the letter.
		.replace(/\p{M}+/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return s || "taught-skill";
}

/** The model's reply as a draft; anything missing is filled in from the goal. */
export function parseDraft(text: string, goal: string): Omit<SkillDraft, "model"> {
	let raw: Record<string, unknown> = {};
	try {
		const parsed = extractJson(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
	} catch {}
	const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
	const title = (str(raw.title) || goal).slice(0, 120);
	const name = str(raw.name).toLowerCase();
	const instructions = str(raw.instructions) || (Object.keys(raw).length ? "" : text.trim());
	if (!instructions) throw new Error("The model didn't write any steps. Try again.");
	return {
		name: SKILL_NAME_RE.test(name) ? name : slug(title),
		title,
		description: (str(raw.description) || `Use when asked to ${goal.replace(/[.!]+$/, "").toLowerCase()}.`).slice(
			0,
			1000,
		),
		instructions: instructions.slice(0, 100_000),
	};
}

/** The first of the bot's models (then the server's) the gateway serves that can see images. */
async function visionModel(agent: Agent): Promise<ModelRef | null> {
	const settings = await getSettings();
	for (const ref of [
		agent.models.primary,
		agent.models.vision,
		settings.defaultModel,
		agent.models.fast,
		settings.defaultFastModel,
	]) {
		const r = gatewayModel(ref);
		if (r && (await getModelInfo(r.model))?.vision) return r;
	}
	return null;
}

/** Saves a reviewed draft as one of your skills, on for this bot (a taken name gets a number). */
export async function saveTaughtSkill(agent: Agent, input: TeachSaveInput): Promise<Skill> {
	const data = parse(TeachSaveSchema, input);
	const base = SKILL_NAME_RE.test(data.name) ? data.name : slug(data.name || data.title);
	let skill: Skill | null = null;
	for (let n = 1; !skill; n++) {
		const name = n === 1 ? base : `${base.slice(0, 60)}-${n}`;
		try {
			skill = await createSkill(
				{
					name,
					title: data.title,
					description: data.description,
					instructions: data.instructions,
					shared: false,
				},
				"user",
			);
		} catch (err) {
			if (!(err instanceof HttpError && err.status === 409) || n >= 50) throw err;
		}
	}
	await updateAgent(agent.id, { skillIds: [...new Set([...agent.skillIds, skill.id])] });
	return skill;
}

/** Writes a demonstration up as a skill draft (nothing is saved: you review it first). */
export async function draftSkill(agent: Agent, input: TeachDraftInput): Promise<SkillDraft> {
	const data = parse(TeachDraftSchema, input);
	const model = await visionModel(agent);
	if (!model) {
		throw badRequest(
			`None of ${agent.name}'s models can see images, so none can read the screen. Pick one that can in its Model & voice section (or set its vision model), then try again.`,
		);
	}
	try {
		const result = await chat({
			meter: { agentId: agent.id, purpose: "background" },
			model: model.model,
			thinking: model.thinking,
			maxTokens: 6000,
			messages: teachMessages(data, agent.name),
			signal: AbortSignal.timeout(180_000),
		});
		return { ...parseDraft(result.text, data.goal), model: model.model };
	} catch (err) {
		// Limits and model rules say so themselves.
		if (err instanceof HttpError) throw err;
		throw badRequest(`Couldn't write the skill: ${errorMessage(err)}`);
	}
}
