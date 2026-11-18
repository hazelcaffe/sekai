import { BotFile, type BotImportResult, type Schedule } from "@sekai/shared";
import { APP_VERSION } from "../config.ts";
import { badRequest, parse } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { createAgent, listAgents, requireAgent } from "./agents.ts";
import { createMemory, createNote, listMemories, listNotes } from "./memories.ts";
import { createRoutine, listRoutines, updateRoutine } from "./routines.ts";
import { createSkill, listSkills } from "./skills.ts";
import { readUploadBase64, saveUpload } from "./uploads.ts";

/** A webhook's address is a secret of this Sekai: the imported routine gets a new one. */
function portable(schedule: Schedule): Schedule {
	if (schedule.type === "event" && schedule.event.kind === "webhook")
		return { type: "event", event: { kind: "webhook" } };
	return schedule;
}

/** A bot as a file: profile, models, tools, skills, apps and routines; memory and notes if asked. */
export async function exportBot(agentId: string, opts: { memory?: boolean; notes?: boolean } = {}): Promise<BotFile> {
	const agent = await requireAgent(agentId);
	const skills = (await listSkills()).filter((s) => agent.skillIds.includes(s.id));
	const { listServers } = await import("../mcp/manager.ts");
	const servers = await listServers();
	let avatarImage: BotFile["bot"]["avatarImage"];
	if (agent.avatar.kind === "image") {
		const id = agent.avatar.url.match(/\/api\/uploads\/(upl_[A-Za-z0-9]+)/)?.[1];
		if (id) avatarImage = await readUploadBase64(id).catch(() => undefined);
	}
	return {
		format: "sekai-bot",
		version: 1,
		exportedAt: Date.now(),
		app: APP_VERSION,
		bot: {
			name: agent.name,
			label: agent.label,
			job: agent.job,
			personality: agent.personality,
			instructions: agent.instructions,
			avatar: agent.avatar,
			...(avatarImage ? { avatarImage } : {}),
			models: agent.models,
			capabilities: agent.capabilities,
		},
		skills: skills.map((s) =>
			s.builtin
				? { name: s.name, title: s.title, description: "", instructions: "", builtin: true }
				: {
						name: s.name,
						title: s.title,
						description: s.description,
						instructions: s.instructions,
						builtin: false,
					},
		),
		apps: agent.mcp.flatMap((b) => {
			const server = servers.find((s) => s.id === b.serverId);
			return server ? [{ name: server.name, tools: b.tools }] : [];
		}),
		routines: (await listRoutines({ agentId })).map((r) => ({
			name: r.name,
			instruction: r.instruction,
			action: r.action,
			schedule: portable(r.schedule),
			timezone: r.timezone,
		})),
		memories: opts.memory
			? (await listMemories({ agentId })).map((m) => ({ kind: m.kind, content: m.content, pinned: m.pinned }))
			: [],
		notes: opts.notes
			? (await listNotes(agentId)).map((n) => ({ title: n.title, content: n.content, pinned: n.pinned }))
			: [],
	};
}

/** A name nobody uses yet: "nene", else "nene (2)"… */
async function freeName(name: string): Promise<string> {
	const taken = new Set((await listAgents()).map((a) => a.name.toLowerCase()));
	if (!taken.has(name.toLowerCase())) return name;
	for (let i = 2; ; i++) {
		const next = `${name.slice(0, 54)} (${i})`;
		if (!taken.has(next.toLowerCase())) return next;
	}
}

/** Makes a new bot from a file. Its routines come in paused, so nothing runs before you've looked. */
export async function importBot(input: unknown): Promise<BotImportResult> {
	const raw = input as { format?: unknown; version?: unknown } | null;
	if (!raw || typeof raw !== "object" || (raw.format !== "sekai-bot" && raw.format !== "feesh-bot"))
		throw badRequest("That isn't a Sekai bot file.");
	if (typeof raw.version === "number" && raw.version > 1) {
		throw badRequest("This bot file was made by a newer version of Sekai. Update Sekai first.");
	}
	const file = parse(BotFile, input);
	const b = file.bot;

	// Skills: built-in ones by name; others reused when one with the same name says the same, else added.
	const existing = await listSkills();
	const skillIds: string[] = [];
	let added = 0;
	let reused = 0;
	for (const s of file.skills) {
		const same = existing.find((x) => x.name === s.name);
		if (s.builtin) {
			if (same) skillIds.push(same.id);
			continue;
		}
		if (same && same.instructions === s.instructions) {
			skillIds.push(same.id);
			reused++;
			continue;
		}
		let name = s.name;
		for (let i = 2; existing.some((x) => x.name === name); i++) name = `${s.name.slice(0, 70)}-${i}`;
		const created = await createSkill({
			name,
			title: s.title || s.name,
			description: s.description || s.title || s.name,
			instructions: s.instructions,
		});
		existing.push(created);
		skillIds.push(created.id);
		added++;
	}

	const { listServers } = await import("../mcp/manager.ts");
	const servers = await listServers();
	const mcp: { serverId: string; tools: string[] | null }[] = [];
	const missingApps: string[] = [];
	for (const app of file.apps) {
		const server = servers.find((s) => s.name.toLowerCase() === app.name.toLowerCase());
		if (server) mcp.push({ serverId: server.id, tools: app.tools });
		else missingApps.push(app.name);
	}

	let avatar = b.avatar;
	if (b.avatarImage) {
		const ext = b.avatarImage.mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
		const upload = await saveUpload(
			Buffer.from(b.avatarImage.base64, "base64"),
			`avatar.${ext}`,
			b.avatarImage.mime,
		);
		avatar = { kind: "image", url: upload.url };
	} else if (avatar?.kind === "image" && !/^https?:\/\//.test(avatar.url)) {
		// A picture that lived on the other Sekai and didn't come along: a character instead.
		avatar = undefined;
	}

	const agent = await createAgent({
		name: await freeName(b.name),
		label: b.label,
		job: b.job,
		personality: b.personality,
		instructions: b.instructions,
		avatar,
		models: b.models,
		capabilities: b.capabilities,
		skillIds,
		mcp,
		isPrimary: false,
	});

	let routines = 0;
	for (const r of file.routines) {
		try {
			const created = await createRoutine({
				agentId: agent.id,
				conversationId: null,
				name: r.name,
				instruction: r.instruction,
				action: r.action,
				// Never the file's webhook address: this routine gets its own.
				schedule: portable(r.schedule),
				timezone: r.timezone,
				enabled: false,
			});
			if (created.enabled) await updateRoutine(created.id, { enabled: false });
			routines++;
		} catch (err) {
			// A one-off whose time has passed, say.
			log.info(`import: skipped routine "${r.name}": ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	for (const m of file.memories)
		await createMemory({ agentId: agent.id, kind: m.kind, content: m.content, pinned: m.pinned });
	for (const n of file.notes)
		await createNote({ agentId: agent.id, title: n.title, content: n.content, pinned: n.pinned });
	log.info(`imported bot ${agent.name} (${skillIds.length} skills, ${routines} routines)`);
	return {
		agentId: agent.id,
		name: agent.name,
		skills: { added, reused },
		routines,
		memories: file.memories.length,
		notes: file.notes.length,
		missingApps,
	};
}
