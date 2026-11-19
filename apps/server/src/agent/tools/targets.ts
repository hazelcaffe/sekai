import type { Machine, ToolRisk } from "@sekai/shared";
import { z } from "zod";
import { deviceSettings } from "../../machines/bridge.ts";
import { hasDesktop, pickMachine } from "../../machines/drivers.ts";
import { isTakenOver, touchMachine } from "../../machines/manager.ts";
import { type BotMachine, machinesForBot } from "../../machines/seats.ts";
import { type ToolContext, ToolError } from "./types.ts";

/**
 * Which machine a tool acts on: the bot's own computer, a devbox, another bot's machine shared with it (where it
 * works in its own seat), or the user's computer lent through the desktop app ("device"). Shared by the
 * computer_, machine and browser tools. Only the machines the bot may use in this run count (machinesForBot).
 */

export const onDesktop = z
	.string()
	.optional()
	.describe(
		'Whose screen: "computer" (yours, the default; else a shared computer you have a seat on), a shared computer\'s name, or "device" (the user\'s computer, if they lent it to you)',
	);

export const onMachine = z
	.string()
	.optional()
	.describe(
		'Which machine: "computer" (default), a devbox or shared machine by name, or "device" (the user\'s computer, if they lent it to you)',
	);

function label(m: Machine): string {
	return m.kind === "device" ? `the user's computer "${m.name}"` : m.name;
}

export const pick = pickMachine;

function unavailable(m: Machine): string {
	if (m.kind === "device") {
		return `${label(m)} is offline: the Sekai desktop app isn't connected there. Ask the user to open it.`;
	}
	return `${m.name} is ${m.status}${m.statusDetail ? ` (${m.statusDetail})` : ""}; it isn't ready.`;
}

/** A machine with a screen the bot can use now. Without `on`: its computer, else the only other screen. */
export async function desktopTarget(ctx: ToolContext, on?: string): Promise<BotMachine> {
	const all = await machinesForBot(ctx.agent.id);
	let m = pick(all, on);
	if (!m && !on) {
		const screens = all.filter(hasDesktop);
		if (screens.length === 1) m = screens[0] ?? null;
	}
	if (!m) {
		throw new ToolError(
			on
				? `You don't have a machine called "${on}" with a screen.`
				: "You don't have a computer with a screen right now.",
		);
	}
	if (m.kind === "devbox") throw new ToolError(`${m.name} is a devbox: it has no screen. Use run_command there.`);
	if (!hasDesktop(m)) throw new ToolError(unavailable(m));
	if (m.kind === "computer" && isTakenOver(m.id, ctx.agent.id)) {
		throw new ToolError(
			m.seat
				? `The user is using your screen on ${m.name} right now. Wait for them to hand it back, or ask them.`
				: "The user is using your computer right now. Wait for them to hand it back, or ask them.",
		);
	}
	void touchMachine(m.id);
	return m;
}

/** A machine for commands and files. Without `machine`: the computer, else the only machine there is. */
export async function machineTarget(ctx: ToolContext, ref?: string): Promise<BotMachine> {
	const all = await machinesForBot(ctx.agent.id);
	let m = pick(all, ref);
	if (!m && !ref) {
		// The user's computer is never the default when the bot has its own machines.
		const own = all.filter((x) => x.kind !== "device");
		const candidates = own.length ? own : all;
		if (candidates.length === 1) m = candidates[0] ?? null;
		else if (candidates.length > 1) throw new ToolError(`Say which machine: ${candidates.map(label).join(", ")}.`);
	}
	if (!m)
		throw new ToolError(ref ? `You don't have a machine called "${ref}".` : "You don't have a computer or devbox.");
	if (m.status !== "running") throw new ToolError(unavailable(m));
	void touchMachine(m.id);
	return m;
}

/** Without throwing: the machine a call would use, so approvals can weigh it (null if it can't be found). */
export async function peek(ctx: ToolContext, ref: string | undefined, desktop: boolean): Promise<Machine | null> {
	try {
		return desktop ? await desktopTarget(ctx, ref) : await machineTarget(ctx, ref);
	} catch {
		return null;
	}
}

/** Acting on the user's own computer counts as reaching outside Sekai. */
export function riskOn(m: Machine | null, base: ToolRisk): ToolRisk {
	if (m?.kind !== "device" || base === "read" || base === "destructive") return base;
	return "external";
}

/** The user asked to approve every action on their computer (a switch in the desktop app). */
export function askOn(m: Machine | null, risk: ToolRisk): string | null {
	if (m?.kind !== "device" || !m.remoteId || risk === "read") return null;
	return deviceSettings(m.remoteId)?.askEachAction ? `You asked to approve every action on ${m.name}.` : null;
}

/** Whether a bot has any screen to use in this run: a running computer (its own or shared), or a lent one online. */
export async function anyDesktop(agentId: string): Promise<boolean> {
	return (await machinesForBot(agentId)).some(hasDesktop);
}
