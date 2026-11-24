import { api, timeAgo } from "@sekai/client";
import type { ChannelWithStatus } from "@sekai/shared";
import { StatusDot, type StatusTone } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import type { SocialPlatform } from "../../bots/paths.ts";

export type { SocialPlatform };

export interface AccountState {
	tone: StatusTone;
	/** What the dot means, for screen readers. */
	label: string;
	text: string;
}

/** A line with a status dot: how an account is doing, in a Row's subtitle. */
export function StatusLine({ state }: { state: AccountState }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<StatusDot tone={state.tone} label={state.label} size="sm" />
			<span>{state.text}</span>
		</span>
	);
}

/** How one account on Discord, Slack or Signal is doing. */
export function channelState(c: ChannelWithStatus): AccountState {
	const s = c.status;
	if (!c.enabled) return { tone: "neutral", label: "Off", text: "Off" };
	if (s.state === "connected") {
		return {
			tone: "success",
			label: "Connected",
			text: s.connectedAt ? `Connected ${timeAgo(s.connectedAt)}` : "Connected",
		};
	}
	if (s.state === "starting") return { tone: "neutral", label: "Connecting", text: "Connecting…" };
	if (s.state === "error" && signedOutOf(c)) return { tone: "danger", label: "Signed out", text: "Signed out" };
	if (s.state === "error") return { tone: "danger", label: "Problem", text: "Can't connect" };
	return { tone: "neutral", label: "Stopped", text: "Stopped" };
}

/** A Signal account Signal signed out (its link was removed on the phone, or its number went elsewhere). */
export function signedOutOf(c: ChannelWithStatus): boolean {
	return c.type === "signal" && c.status.state === "error" && /signed this account out/i.test(c.status.error ?? "");
}

/** All of a platform's accounts in one line: "Nori · Connected", "Not connected"… */
export function platformState(list: ChannelWithStatus[]): AccountState {
	if (list.length === 0) return { tone: "neutral", label: "Not connected", text: "Not connected" };
	const live = list.filter((c) => c.enabled && c.status.state === "connected");
	if (live.length) {
		const names = live.map((c) => c.status.botName ?? "Connected").join(", ");
		return {
			tone: "success",
			label: "Connected",
			text: live.length === 1 ? `${names} · Connected` : `${live.length} connected`,
		};
	}
	const trouble = list.find((c) => c.enabled && c.status.state === "error");
	if (trouble && signedOutOf(trouble)) return { tone: "danger", label: "Signed out", text: "Signed out" };
	if (trouble) return { tone: "danger", label: "Problem", text: "Can't connect" };
	return { tone: "neutral", label: "Off", text: "Off" };
}

/** The bot's X, Instagram or TikTok account, if it has one. */
export function useSocialAccount(platform: SocialPlatform, agentId: string) {
	return useQuery({ queryKey: [platform, agentId], queryFn: () => api[platform].get(agentId) });
}

export function socialState(a: { handle: string; error: string | null } | null | undefined): AccountState {
	if (!a) return { tone: "neutral", label: "Not connected", text: "Not connected" };
	return a.error
		? { tone: "warning", label: "Signed out", text: `@${a.handle} · Signed out` }
		: { tone: "success", label: "Signed in", text: `@${a.handle} · Signed in` };
}

/** The pairing requests waiting on these accounts (they're answered in Needs you). */
export function pairingsFor<T extends { channelId: string }>(pairings: T[], channels: { id: string }[]): T[] {
	const ids = new Set(channels.map((c) => c.id));
	return pairings.filter((p) => ids.has(p.channelId));
}
