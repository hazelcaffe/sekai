import { ApiError } from "@sekai/shared";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { haptic } from "./mobile.ts";

export const queryClient: QueryClient = new QueryClient({
	// Signed out elsewhere (or the session expired): re-check, which brings back the sign-in screen.
	queryCache: new QueryCache({
		onError: (err, query) => {
			if (err instanceof ApiError && err.status === 401 && query.queryKey[0] !== "auth") {
				void queryClient.invalidateQueries({ queryKey: qk.auth });
			}
		},
	}),
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
			refetchOnWindowFocus: false,
		},
		mutations: {
			onError: (err) => {
				haptic("error");
				toast.error(err instanceof Error ? err.message : String(err));
			},
		},
	},
});

export const qk = {
	jobs: ["jobs"] as const,
	job: (id: string) => ["job", id] as const,
	auth: ["auth"] as const,
	sessions: ["auth", "sessions"] as const,
	passkeys: ["auth", "passkeys"] as const,
	apiTokens: ["auth", "tokens"] as const,
	info: ["info"] as const,
	appDownloads: ["appDownloads"] as const,
	models: ["models"] as const,
	settings: ["settings"] as const,
	agents: ["agents"] as const,
	conversations: ["conversations"] as const,
	messages: (conversationId: string) => ["messages", conversationId] as const,
	memories: (agentId: string) => ["memories", agentId] as const,
	sharedMemories: ["memories", "shared"] as const,
	notes: (agentId: string) => ["notes", agentId] as const,
	routines: (agentId?: string) => ["routines", agentId ?? "all"] as const,
	routineRuns: (routineId: string) => ["routineRuns", routineId] as const,
	skills: ["skills"] as const,
	mcp: ["mcp"] as const,
	approvals: ["approvals"] as const,
	channels: (agentId?: string) => ["channels", agentId ?? "all"] as const,
	channelBindings: (channelId: string) => ["channelBindings", channelId] as const,
	channelLinks: ["channelBindings", "all"] as const,
	signalStatus: ["signal", "status"] as const,
	signalAccount: (channelId: string) => ["signal", "account", channelId] as const,
	voiceSettings: ["voice", "settings"] as const,
	voiceModels: ["voice", "models"] as const,
	voices: (model: string, cap: string, q: string) => ["voice", "voices", model, cap, q] as const,
	customVoices: ["voice", "custom"] as const,
	agentVoice: (agentId: string) => ["voice", "agent", agentId] as const,
	pairings: ["pairings"] as const,
	emailAccount: (id: string) => ["emailAccount", id] as const,
	emailRecent: (id: string) => ["emailRecent", id] as const,
	emailSenders: ["emailSenders"] as const,
	emailOptions: ["emailOptions"] as const,
	mailcow: ["mailcow"] as const,
	machines: (agentId?: string) => ["machines", agentId ?? "all"] as const,
	checkpoints: (machineId: string) => ["checkpoints", machineId] as const,
	machinePorts: (machineId: string) => ["machinePorts", machineId] as const,
	machineMembers: (machineId: string) => ["machineMembers", machineId] as const,
	seats: (agentId: string) => ["seats", agentId] as const,
	sharedBrowsers: (agentId?: string) => ["sharedBrowsers", agentId ?? "all"] as const,
	documents: ["documents"] as const,
	credentials: ["credentials"] as const,
	savedLogins: (agentId?: string) => ["savedLogins", agentId ?? "all"] as const,
	providers: ["providers"] as const,
	apiProviders: ["apiProviders"] as const,
	webEngine: ["web"] as const,
	embeddingModels: ["embeddingModels"] as const,
	runs: (agentId?: string) => ["runs", agentId ?? "all"] as const,
	context: (agentId: string, conversationId?: string) => ["context", agentId, conversationId ?? "main"] as const,
	agentTools: (agentId: string, conversationId?: string) =>
		["agentTools", agentId, conversationId ?? "main"] as const,
};
