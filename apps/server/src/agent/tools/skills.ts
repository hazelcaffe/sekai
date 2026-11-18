import { SKILL_NAME_RE } from "@sekai/shared";
import { z } from "zod";
import { getAgent, updateAgent } from "../../services/agents.ts";
import { createSkill, getSkillByName, skillsForAgent, updateSkill } from "../../services/skills.ts";
import { defineTool, ToolError } from "./types.ts";

export const skillTools = [
	defineTool({
		name: "skill_list",
		category: "skills",
		description: "List the skills you can load (name, title, when to use).",
		parameters: z.object({}),
		risk: "read",
		title: () => "Checked skills",
		async execute(_args, ctx) {
			return (await skillsForAgent(ctx.agent)).map((s) => ({
				name: s.name,
				title: s.title,
				description: s.description,
			}));
		},
	}),
	defineTool({
		name: "skill_load",
		category: "skills",
		description: "Load a skill's full instructions by name. Do this before doing a task a skill covers.",
		parameters: z.object({ name: z.string() }),
		risk: "read",
		title: (a) => `Loaded skill “${a.name}”`,
		async execute(args, ctx) {
			const available = await skillsForAgent(ctx.agent);
			const skill = available.find((s) => s.name === args.name.trim().toLowerCase());
			if (!skill) {
				throw new ToolError(
					`No skill named "${args.name}" is available to you. Available: ${available.map((s) => s.name).join(", ") || "none"}`,
				);
			}
			return `# ${skill.title}\n\n${skill.instructions}`;
		},
	}),
	defineTool({
		name: "skill_create",
		category: "skills",
		description:
			"Save a reusable method as a skill (enabled for you right away). Structure the instructions: when to use, inputs, steps, validation, output, what needs approval. description should start with 'Use when…'.",
		parameters: z.object({
			name: z.string().regex(SKILL_NAME_RE).describe("lowercase-dash slug"),
			title: z.string().min(1).max(120),
			description: z.string().min(1).max(1000),
			instructions: z.string().min(1).max(100_000),
			share_with_all_agents: z.boolean().optional(),
		}),
		risk: "write",
		title: (a) => `Created skill “${a.title}”`,
		async execute(args, ctx) {
			const skill = await createSkill(
				{
					name: args.name,
					title: args.title,
					description: args.description,
					instructions: args.instructions,
					shared: args.share_with_all_agents ?? false,
				},
				"agent",
			);
			// The bot as it is now (another skill may have been added earlier in this reply, or by you meanwhile).
			const current = (await getAgent(ctx.agent.id)) ?? ctx.agent;
			await updateAgent(ctx.agent.id, { skillIds: [...new Set([...current.skillIds, skill.id])] });
			return { created: true, name: skill.name, shared: skill.shared };
		},
	}),
	defineTool({
		name: "skill_update",
		category: "skills",
		description: "Improve one of your skills (not built-in ones). Only pass the fields that change.",
		parameters: z.object({
			name: z.string(),
			title: z.string().min(1).max(120).optional(),
			description: z.string().min(1).max(1000).optional(),
			instructions: z.string().min(1).max(100_000).optional(),
		}),
		risk: "write",
		title: (a) => `Updated skill “${a.name}”`,
		async execute(args, ctx) {
			const skill = await getSkillByName(args.name);
			const mine = skill && (skill.shared || ctx.agent.skillIds.includes(skill.id));
			if (!skill || !mine) throw new ToolError(`No skill named "${args.name}" is available to you`);
			if (skill.builtin) throw new ToolError("Built-in skills can't be edited. Create a new skill instead.");
			const updated = await updateSkill(skill.id, {
				title: args.title,
				description: args.description,
				instructions: args.instructions,
			});
			return { updated: true, name: updated.name };
		},
	}),
];
