import type {
	Access,
	Agent,
	AgentContextTool,
	Conversation,
	Machine,
	MachineMember,
	ModelInfo,
	Permission,
} from "@sekai/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { qk } from "./query.ts";

export const useInfo = () => useQuery({ queryKey: qk.info, queryFn: api.info, staleTime: 60_000 });
/** The desktop, phone and browser apps of this server's release, from GitHub (the server keeps them for an hour). */
export const useAppDownloads = (enabled = true) =>
	useQuery({ queryKey: qk.appDownloads, queryFn: api.apps.downloads, enabled, staleTime: 10 * 60_000, retry: 1 });
export const useModels = () =>
	useQuery({ queryKey: qk.models, queryFn: () => api.models(), staleTime: 5 * 60_000, retry: 1 });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings.get });

export const useAgents = () =>
	useQuery({ queryKey: qk.agents, queryFn: api.agents.list, staleTime: Number.POSITIVE_INFINITY });

export function useAgent(id: string | null | undefined): Agent | undefined {
	const { data } = useAgents();
	return id ? data?.find((a) => a.id === id) : undefined;
}

export function useAgentMap(): Map<string, Agent> {
	const { data } = useAgents();
	return new Map((data ?? []).map((a) => [a.id, a]));
}

export const useConversations = () =>
	useQuery({
		queryKey: qk.conversations,
		queryFn: () => api.conversations.list(),
		staleTime: Number.POSITIVE_INFINITY,
	});

export function useConversation(id: string | undefined) {
	const list = useConversations();
	const fromList = id ? list.data?.find((c) => c.id === id) : undefined;
	const single = useQuery({
		queryKey: ["conversation", id],
		queryFn: () => api.conversations.get(id ?? ""),
		enabled: Boolean(id) && !fromList && !list.isLoading,
	});
	return {
		data: (fromList ?? single.data) as Conversation | undefined,
		isLoading: list.isLoading || single.isLoading,
		error: single.error,
	};
}

export const useMessages = (conversationId: string | undefined) =>
	useQuery({
		queryKey: qk.messages(conversationId ?? ""),
		queryFn: () => api.conversations.messages(conversationId ?? "", { limit: 300 }),
		enabled: Boolean(conversationId),
		staleTime: Number.POSITIVE_INFINITY,
	});

export const useMemories = (agentId: string) =>
	useQuery({ queryKey: qk.memories(agentId), queryFn: () => api.memories.list({ agentId }) });
export const useSharedMemories = () =>
	useQuery({ queryKey: qk.sharedMemories, queryFn: () => api.memories.list({ shared: true }) });
export const useNotes = (agentId: string) =>
	useQuery({ queryKey: qk.notes(agentId), queryFn: () => api.notes.list(agentId) });
export const useRoutines = (agentId?: string) =>
	useQuery({ queryKey: qk.routines(agentId), queryFn: () => api.routines.list(agentId ? { agentId } : undefined) });
export const useRoutineRuns = (routineId: string | null) =>
	useQuery({
		queryKey: qk.routineRuns(routineId ?? ""),
		queryFn: () => api.routines.runs(routineId ?? ""),
		enabled: Boolean(routineId),
	});
export const useSkills = () => useQuery({ queryKey: qk.skills, queryFn: api.skills.list });
export const useMcpServers = () => useQuery({ queryKey: qk.mcp, queryFn: api.mcp.list });
export const useApprovals = () => useQuery({ queryKey: qk.approvals, queryFn: api.approvals.list });
export const useChannels = (agentId?: string) =>
	useQuery({ queryKey: qk.channels(agentId), queryFn: () => api.channels.list(agentId ? { agentId } : undefined) });
export const useChannelBindings = (channelId: string | null) =>
	useQuery({
		queryKey: qk.channelBindings(channelId ?? ""),
		queryFn: () => api.channels.bindings(channelId ?? ""),
		enabled: Boolean(channelId),
	});
export const usePairings = () => useQuery({ queryKey: qk.pairings, queryFn: api.channels.pairings });
export const useMachines = (agentId?: string) =>
	useQuery({ queryKey: qk.machines(agentId), queryFn: () => api.machines.list(agentId ? { agentId } : undefined) });
/** Other bots sharing one of your machines. */
export const useMachineMembers = (machineId: string, enabled = true) =>
	useQuery({ queryKey: qk.machineMembers(machineId), queryFn: () => api.machines.members.list(machineId), enabled });
/**
 * The bot's computer and devboxes other bots share, with those bots (for "deleting it deletes its computer, which
 * N other bots use"). Fetched only while `enabled`.
 */
export function useMachineUsers(
	agentId: string | null | undefined,
	enabled = true,
): { machine: Machine; members: MachineMember[] }[] {
	const { data: machines = [] } = useQuery({
		queryKey: qk.machines(agentId ?? ""),
		queryFn: () => api.machines.list({ agentId: agentId ?? "" }),
		enabled: enabled && Boolean(agentId),
	});
	const shareable = machines.filter((m) => m.kind !== "device");
	const lists = useQueries({
		queries: shareable.map((m) => ({
			queryKey: qk.machineMembers(m.id),
			queryFn: () => api.machines.members.list(m.id),
			enabled,
		})),
	});
	return shareable
		.map((machine, i) => ({ machine, members: lists[i]?.data ?? [] }))
		.filter((x) => x.members.length > 0);
}

/** "Deleting Ada deletes its computer, which 2 other bots use." (null when nobody else uses its machines). */
export function sharedMachinesNote(
	botName: string,
	users: { machine: Machine; members: MachineMember[] }[],
): string | null {
	if (users.length === 0) return null;
	const bots = new Set(users.flatMap((u) => u.members.map((m) => m.agentId))).size;
	const what =
		users.length === 1
			? users[0]?.machine.kind === "computer"
				? "its computer"
				: `its devbox ${users[0]?.machine.name}`
			: "its computer and devboxes";
	return `Deleting ${botName} deletes ${what}, which ${bots} other bot${bots === 1 ? "" : "s"} use${bots === 1 ? "s" : ""}.`;
}

/** Your machines this bot has a seat on. */
export const useSeats = (agentId: string, enabled = true) =>
	useQuery({ queryKey: qk.seats(agentId), queryFn: () => api.machines.seats(agentId), enabled });
/** Your shared browsers (with agentId: the ones that bot is in). */
export const useSharedBrowsers = (agentId?: string) =>
	useQuery({
		queryKey: qk.sharedBrowsers(agentId),
		queryFn: () => api.sharedBrowsers.list(agentId ? { agentId } : undefined),
	});
export const useDocuments = () => useQuery({ queryKey: qk.documents, queryFn: api.documents.list });
export const useCheckpoints = (machineId: string, enabled = true) =>
	useQuery({ queryKey: qk.checkpoints(machineId), queryFn: () => api.machines.checkpoints.list(machineId), enabled });
/** What's listening on a machine, checked again every few seconds while it's shown (a dev server comes and goes). */
export const useMachinePorts = (machineId: string, enabled = true) =>
	useQuery({
		queryKey: qk.machinePorts(machineId),
		queryFn: () => api.machines.ports(machineId),
		enabled,
		refetchInterval: 8000,
		retry: false,
	});
export const useCredentialRequests = () => useQuery({ queryKey: qk.credentials, queryFn: api.credentials.pending });
export const useSavedLogins = (agentId?: string) =>
	useQuery({
		queryKey: qk.savedLogins(agentId),
		queryFn: () => api.credentials.saved(agentId ? { agentId } : undefined),
	});
export const useProviders = () => useQuery({ queryKey: qk.providers, queryFn: api.providers.list });
export const useRuns = (agentId?: string) =>
	useQuery({ queryKey: qk.runs(agentId), queryFn: () => api.runs.list({ agentId, limit: 60 }) });
export const useAgentContext = (agentId: string, conversationId?: string) =>
	useQuery({
		queryKey: qk.context(agentId, conversationId),
		queryFn: () => api.agents.context(agentId, conversationId),
		staleTime: 10_000,
	});

export interface AgentToolCatalog {
	builtin: AgentContextTool[];
	mcp: (AgentContextTool & { serverId: string; serverTitle: string; originalName: string; enabled: boolean })[];
	categories: Record<string, string>;
}

export const useAgentTools = (agentId: string, conversationId?: string) =>
	useQuery({
		queryKey: qk.agentTools(agentId, conversationId),
		queryFn: async () => {
			const url = api.url(
				`/api/agents/${agentId}/tools${conversationId ? `?conversationId=${conversationId}` : ""}`,
			);
			const token = localStorage.getItem("sekai.token");
			const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
			if (!res.ok) throw new Error(`Failed to load tools (${res.status})`);
			return (await res.json()) as AgentToolCatalog;
		},
	});

export function modelInfo(models: ModelInfo[] | undefined, id: string): ModelInfo | undefined {
	return models?.find((m) => m.id === id);
}

/** Who's signed in, whether the server still needs setting up, and whether passkeys work here. */
export const useAuth = () =>
	useQuery({
		queryKey: qk.auth,
		queryFn: api.auth.status,
		staleTime: Number.POSITIVE_INFINITY,
		// Offline (the app opened from its saved copy): say so right away instead of waiting on retries.
		networkMode: "always",
		retry: (count) => navigator.onLine && count < 2,
	});

/**
 * What you may do here (your role): `can("bots")` and so on, for showing and hiding things. Admins can do
 * everything. The server checks every request either way.
 */
export function useAccess(): { access: Access | null; admin: boolean; can: (p: Permission) => boolean } {
	const access = useAuth().data?.access ?? null;
	return {
		access,
		admin: Boolean(access?.admin),
		can: (p) => Boolean(access && (access.admin || access.permissions.includes(p))),
	};
}

export const useApiProviders = () => useQuery({ queryKey: qk.apiProviders, queryFn: api.apiProviders.list });
export const useChannelLinks = () => useQuery({ queryKey: qk.channelLinks, queryFn: api.channels.links });
export const useVoiceSettings = () => useQuery({ queryKey: qk.voiceSettings, queryFn: api.voice.settings });
export const useVoiceModels = () =>
	useQuery({ queryKey: qk.voiceModels, queryFn: api.voice.models, staleTime: 60_000 });
export const useEmbeddingModels = () =>
	useQuery({ queryKey: qk.embeddingModels, queryFn: api.apiProviders.embeddingModels, staleTime: 5 * 60_000 });
/** Web reading: Firecrawl Local's state and settings (admins only). */
export const useWebEngine = (enabled = true) =>
	useQuery({ queryKey: qk.webEngine, queryFn: api.web.status, enabled, staleTime: 10_000 });
