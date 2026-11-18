import {
	type Agent,
	type Skill,
	SkillCreate,
	type SkillCreate as SkillCreateInput,
	SkillName,
	SkillUpdate,
	type SkillUpdate as SkillUpdateInput,
} from "@sekai/shared";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { BUILTIN_SKILLS } from "../agent/builtin-skills.ts";
import { currentActor, requirePermission } from "../auth/actor.ts";
import { db, schema } from "../db/index.ts";
import { bus } from "../events/bus.ts";
import { badRequest, HttpError, notFound, parse } from "../lib/errors.ts";
import { ID } from "../lib/ids.ts";
import { slugify } from "../lib/text.ts";
import { isMine, newOwner } from "./visibility.ts";

/**
 * Skills are each person's own, plus the built-in ones everyone has (only admins change those). A bot shared with
 * you brings the skills its owner gave it.
 */

/** Built-in skills and the acting person's own (everyone's for Sekai itself). */
function visible(userId = currentActor()?.userId) {
	return userId ? or(isNull(schema.skills.userId), eq(schema.skills.userId, userId)) : undefined;
}

export async function listSkills(): Promise<Skill[]> {
	return db
		.select()
		.from(schema.skills)
		.where(visible())
		.orderBy(asc(schema.skills.builtin), asc(schema.skills.title));
}

export async function getSkill(id: string): Promise<Skill | null> {
	const row = await db.query.skills.findFirst({ where: eq(schema.skills.id, id) });
	return row && (row.userId === null || isMine(row.userId)) ? row : null;
}

/** Your skill with this name, else the built-in one. */
export async function getSkillByName(name: string, userId = currentActor()?.userId): Promise<Skill | null> {
	const rows = await db
		.select()
		.from(schema.skills)
		.where(and(eq(schema.skills.name, name.trim().toLowerCase()), visible(userId)));
	return rows.find((r) => r.userId !== null) ?? rows[0] ?? null;
}

/** Changing a built-in skill (turning it on or off for everyone) is an admin's job. */
function requireEditable(skill: Skill): void {
	if (skill.userId === null) requirePermission("admin");
	else if (!isMine(skill.userId)) throw notFound("Skill");
}

export async function requireSkill(id: string): Promise<Skill> {
	const s = await getSkill(id);
	if (!s) throw notFound("Skill");
	return s;
}

export async function createSkill(input: SkillCreateInput, createdBy: Skill["createdBy"] = "user"): Promise<Skill> {
	const data = parse(SkillCreate, input);
	const userId = newOwner();
	const clash = await getSkillByName(data.name, userId);
	if (clash && clash.userId === userId) throw new HttpError(409, `A skill named "${data.name}" already exists`);
	const now = Date.now();
	const row: Skill = { id: ID.skill(), userId, ...data, builtin: false, createdBy, createdAt: now, updatedAt: now };
	await db.insert(schema.skills).values(row);
	bus.emit({ type: "skill.changed" });
	return row;
}

export async function updateSkill(id: string, input: SkillUpdateInput): Promise<Skill> {
	const patch = parse(SkillUpdate, input);
	const current = await requireSkill(id);
	requireEditable(current);
	if (current.builtin && (patch.name || patch.instructions !== undefined || patch.description)) {
		throw badRequest(
			"Built-in skills can only be enabled, disabled or shared. Duplicate it to change the content.",
		);
	}
	if (patch.name && patch.name !== current.name) {
		const clash = await getSkillByName(patch.name, current.userId ?? undefined);
		if (clash && clash.userId === current.userId)
			throw new HttpError(409, `A skill named "${patch.name}" already exists`);
	}
	await db
		.update(schema.skills)
		.set({ ...patch, updatedAt: Date.now() })
		.where(eq(schema.skills.id, id));
	bus.emit({ type: "skill.changed" }, current.userId === null ? { to: "everyone" } : {});
	return requireSkill(id);
}

export async function deleteSkill(id: string): Promise<void> {
	const skill = await requireSkill(id);
	if (skill.builtin) throw badRequest("Built-in skills can't be deleted; disable it instead.");
	requireEditable(skill);
	await db.delete(schema.skills).where(eq(schema.skills.id, id));
	// Drop dangling references from agents.
	const agents = await db
		.select()
		.from(schema.agents)
		.where(eq(schema.agents.userId, skill.userId ?? ""));
	for (const a of agents) {
		if (!a.skillIds.includes(id)) continue;
		await db
			.update(schema.agents)
			.set({ skillIds: a.skillIds.filter((s) => s !== id) })
			.where(eq(schema.agents.id, a.id));
	}
	bus.emit({ type: "skill.changed" });
}

/**
 * Skills an agent can load: the enabled ones for every bot (built in, or the chat owner's own), plus the ones its
 * owner gave it.
 */
export async function skillsForAgent(agent: Pick<Agent, "skillIds" | "userId">): Promise<Skill[]> {
	const me = currentActor()?.userId ?? agent.userId;
	const rows = await db
		.select()
		.from(schema.skills)
		.where(or(isNull(schema.skills.userId), eq(schema.skills.userId, me), eq(schema.skills.userId, agent.userId)))
		.orderBy(asc(schema.skills.builtin), asc(schema.skills.title));
	return rows.filter(
		(s) =>
			s.enabled &&
			((s.shared && (s.userId === null || s.userId === me)) ||
				(agent.skillIds.includes(s.id) && (s.userId === null || s.userId === agent.userId))),
	);
}

/** Inserts or refreshes the skills that ship with Sekai, keeping the user's enabled/shared choices. */
export async function seedBuiltinSkills(): Promise<void> {
	const now = Date.now();
	for (const def of BUILTIN_SKILLS) {
		const [existing] = await db
			.select()
			.from(schema.skills)
			.where(and(eq(schema.skills.name, def.name), isNull(schema.skills.userId)));
		if (existing) {
			await db
				.update(schema.skills)
				.set({ title: def.title, description: def.description, instructions: def.instructions, builtin: true })
				.where(eq(schema.skills.id, existing.id));
			continue;
		}
		await db.insert(schema.skills).values({
			id: ID.skill(),
			userId: null,
			name: def.name,
			title: def.title,
			description: def.description,
			instructions: def.instructions,
			builtin: true,
			enabled: true,
			shared: true,
			createdBy: "system",
			createdAt: now,
			updatedAt: now,
		});
	}
}

// ---------------------------------------------------------------- SKILL.md

/** Parses a SKILL.md (YAML-ish frontmatter with name/description/title, then a Markdown body). */
export function parseSkillMarkdown(markdown: string): SkillCreateInput {
	const text = markdown.replace(/^\uFEFF/, "");
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	const meta: Record<string, string> = {};
	let body = text;
	if (fm?.[1] !== undefined) {
		body = fm[2] ?? "";
		for (const line of fm[1].split(/\r?\n/)) {
			const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
			if (!m?.[1]) continue;
			let value = (m[2] ?? "").trim();
			if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
			meta[m[1].toLowerCase()] = value;
		}
	}
	const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	const title = meta.title || heading || meta.name || "Imported skill";
	const name = SkillName.safeParse(meta.name).success ? (meta.name as string) : slugify(meta.name || title, 63);
	const description =
		meta.description ||
		body
			.trim()
			.split(/\n\s*\n/)[0]
			?.slice(0, 300) ||
		title;
	return { name, title, description, instructions: body.trim() };
}

export function skillToMarkdown(skill: Skill): string {
	const esc = (s: string) => (/[:#"']/.test(s) ? JSON.stringify(s) : s);
	return `---\nname: ${skill.name}\ntitle: ${esc(skill.title)}\ndescription: ${esc(skill.description)}\n---\n\n${skill.instructions.trim()}\n`;
}
