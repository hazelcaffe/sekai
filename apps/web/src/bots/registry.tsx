import type { Agent } from "@sekai/shared";
import { AtSign, Brain, CalendarClock, Monitor, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { type ComponentType, type LazyExoticComponent, lazy, type ReactNode } from "react";
import type { BotSectionProps } from "./section.ts";

/*
 * A bot's sections, in order, in one list: what each is called and the file that draws it. The bot's page
 * (/bots/:agentId/:section) reads this list for its rail, its phone list and its routes.
 */

export interface BotSectionDef {
	/** The address: /bots/:agentId/<id>. */
	id: string;
	title: string;
	icon: ReactNode;
	/**
	 * owner: only the bot's owner. anyone: also people it's shared with, who see it read only (Profile), or their own
	 * part of it (their memory and notes of it, their routines with it).
	 */
	who: "owner" | "anyone";
	/** People it's shared with only look here (they can't change the owner's setup). */
	viewerReadOnly?: boolean;
	component: LazyExoticComponent<ComponentType<BotSectionProps>>;
}

function load<K extends string>(
	file: () => Promise<Record<K, ComponentType<BotSectionProps>>>,
	name: K,
): LazyExoticComponent<ComponentType<BotSectionProps>> {
	return lazy(() => file().then((m) => ({ default: m[name] })));
}

export const BOT_SECTIONS: BotSectionDef[] = [
	{
		id: "profile",
		title: "Profile",
		icon: <UserRound />,
		who: "anyone",
		viewerReadOnly: true,
		component: load(() => import("./sections/Profile.tsx"), "ProfileSection"),
	},
	{
		id: "model",
		title: "Model & voice",
		icon: <Sparkles />,
		who: "owner",
		component: load(() => import("./sections/ModelVoice.tsx"), "ModelVoiceSection"),
	},
	{
		id: "memory",
		title: "Memory",
		icon: <Brain />,
		who: "anyone",
		component: load(() => import("./sections/Memory.tsx"), "MemorySection"),
	},
	{
		id: "tools",
		title: "Tools & access",
		icon: <ShieldCheck />,
		who: "owner",
		component: load(() => import("./sections/ToolsAccess.tsx"), "ToolsAccessSection"),
	},
	{
		id: "accounts",
		title: "Accounts",
		icon: <AtSign />,
		who: "owner",
		component: load(() => import("./sections/Accounts.tsx"), "AccountsSection"),
	},
	{
		id: "routines",
		title: "Routines",
		icon: <CalendarClock />,
		who: "anyone",
		component: load(() => import("./sections/Routines.tsx"), "RoutinesSection"),
	},
	{
		id: "computer",
		title: "Computer",
		icon: <Monitor />,
		who: "owner",
		component: load(() => import("./sections/Computer.tsx"), "ComputerSection"),
	},
];

/** Whether you own this bot (a bot shared with you has `sharedBy`, its owner's name). */
export function ownsBot(agent: Pick<Agent, "sharedBy">): boolean {
	return !agent.sharedBy;
}

/** The sections you see for this bot: all of them for your own, fewer for one shared with you. */
export function botSectionsFor(agent: Pick<Agent, "sharedBy">): BotSectionDef[] {
	const own = ownsBot(agent);
	return BOT_SECTIONS.filter((s) => own || s.who === "anyone");
}

export function botSection(agent: Pick<Agent, "sharedBy">, id: string): BotSectionDef | undefined {
	return botSectionsFor(agent).find((s) => s.id === id);
}

/** A bot's page, or one of its sections: /bots/:agentId/:section/:rest. */
export function botPath(agentId: string, section = "", rest = ""): string {
	return [`/bots/${agentId}`, section, rest].filter(Boolean).join("/");
}
