import type {
	AgentShare,
	ManagedUser,
	Person,
	Role,
	RoleInput,
	RoleUpdate,
	ShareTarget,
	UserCreate,
	UserCredentials,
	UserUpdate,
} from "./access.ts";
import type { ActivityEntry, ActivityQuery } from "./activity.ts";
import type { Agent, AgentContext, AgentCreate, AgentUpdate } from "./agent.ts";
import type {
	AccountPatch,
	ApiTokenCreate,
	ApiTokenInfo,
	AuthStatus,
	AuthUser,
	CreatedApiToken,
	EmailConfig,
	LinkedIdentity,
	LoginInput,
	MfaMethod,
	MfaStatus,
	PasskeyInfo,
	PasswordChange,
	SessionInfo,
	SetupInput,
	SignInResult,
	SmsConfig,
	SsoProvider,
	SsoProviderInput,
	TicketInfo,
	TotpSetup,
} from "./auth.ts";
import type { Avatar } from "./avatar.ts";
import type { BackupConfigUpdate, BackupInfo, BackupStatus } from "./backup.ts";
import type { BotImportResult } from "./bot-file.ts";
import type {
	ChannelBinding,
	ChannelBindingUpdate,
	ChannelCreate,
	ChannelPairing,
	ChannelUpdate,
	ChannelWithStatus,
} from "./channel.ts";
import type { CodeIndex, CodeSearchHit } from "./code-index.ts";
import type { CompareEvent, CompareRequest } from "./compare.ts";
import type { Conversation, ConversationCreate, ConversationUpdate, MessageSearchHit } from "./conversation.ts";
import type { DigestConfigUpdate, DigestStatus } from "./digest.ts";
import type { CallRing } from "./events.ts";
import type { HealthReport } from "./health.ts";
import type {
	AccessGrant,
	Host,
	HostAccountResult,
	HostCreate,
	HostStatus,
	HostUpdate,
	HostWithStatus,
	MasterKey,
	TailnetDevice,
	TailscaleApiInput,
	TailscaleOverview,
} from "./hosts.ts";
import type { IgAccount, IgConnect, IgUpdate } from "./instagram.ts";
import type { LibraryDocument, LibraryHit } from "./library.ts";
import type {
	Checkpoint,
	CheckpointList,
	CredentialAnswer,
	CredentialRequest,
	Machine,
	MachineAccess,
	MachineCreate,
	MachineUpdate,
	SavedLogin,
} from "./machine.ts";
import type { McpServerCreate, McpServerStatus, McpServerUpdate, McpServerWithStatus } from "./mcp.ts";
import type {
	Memory,
	MemoryCheckupResult,
	MemoryCreate,
	MemoryUpdate,
	Note,
	NoteCreate,
	NoteUpdate,
} from "./memory.ts";
import type { Message, MessageRetry, MessageSend, MessageSendResult } from "./message.ts";
import type { MobilePushClientConfig, MobilePushSettings, MobilePushStatus, MobilePushToken } from "./mobile.ts";
import type {
	ApiModel,
	ApiProviderCreate,
	ApiProviderUpdate,
	ApiProviderWithStatus,
	EmbeddingModelInfo,
} from "./model-provider.ts";
import type { ModelInfo } from "./models.ts";
import type { ProviderCreate, ProviderUpdate, ProviderWithStatus } from "./provider.ts";
import type {
	Routine,
	RoutineCreate,
	RoutineRun,
	RoutineUpdate,
	SchedulePreview,
	SchedulePreviewRequest,
} from "./routine.ts";
import type { ApprovalDecision, PendingApproval, Run } from "./run.ts";
import type { ModelPrice, ServerInfo, Settings, SettingsUpdate, UsageReport, UsageScope } from "./settings.ts";
import type { Skill, SkillCreate, SkillUpdate } from "./skill.ts";
import type { TtAccount, TtConnect, TtUpdate } from "./tiktok.ts";
import type { Upload } from "./upload.ts";
import type {
	CustomVoice,
	VoiceCandidate,
	VoiceCap,
	VoiceInfo,
	VoiceModelInfo,
	VoiceSettings,
	VoiceSettingsUpdate,
} from "./voice.ts";
import type { XAccount, XConnect, XUpdate } from "./x.ts";

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly details?: unknown,
		/** What went wrong, for the app to act on: "reauth_required", "restricted", "limit_reached"… */
		readonly code?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export interface ApiClientOptions {
	/** Server origin, e.g. "http://127.0.0.1:7420". Empty string means same origin. */
	baseUrl: string;
	getToken?: () => string | null | undefined;
	fetch?: typeof fetch;
	/**
	 * The server wants you to confirm it's you before a sensitive change: show the dialog and resolve true once
	 * you did (the request is then sent again), false if you cancelled.
	 */
	onReauth?: () => Promise<boolean>;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v !== undefined && v !== null) params.set(k, String(v));
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

/** Typed client for the Sekai HTTP API. Used by the web app and the desktop shell. */
export function createApiClient(options: ApiClientOptions) {
	const doFetch = options.fetch ?? fetch.bind(globalThis);
	let base = options.baseUrl;
	while (base.endsWith("/")) base = base.slice(0, -1);

	function headers(json: boolean): Record<string, string> {
		const h: Record<string, string> = {};
		if (json) h["content-type"] = "application/json";
		const token = options.getToken?.();
		if (token) h.authorization = `Bearer ${token}`;
		return h;
	}

	async function request<T>(
		method: string,
		path: string,
		body?: unknown,
		query?: Query,
		retried = false,
	): Promise<T> {
		const res = await doFetch(`${base}/api${path}${qs(query)}`, {
			method,
			headers: headers(body !== undefined),
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		// A proxy's HTML error page (502, 413…) isn't JSON: still an ApiError with the status, not a parse error.
		let data: unknown = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			if (res.ok) throw new ApiError(res.status, "The server sent something Sekai couldn't read");
			data = { error: `${res.status} ${res.statusText}` };
		}
		if (!res.ok) {
			const err = data as { error?: string; details?: unknown; code?: string } | null;
			if (err?.code === "reauth_required" && !retried && options.onReauth && (await options.onReauth())) {
				return request<T>(method, path, body, query, true);
			}
			throw new ApiError(res.status, err?.error ?? `${res.status} ${res.statusText}`, err?.details, err?.code);
		}
		return data as T;
	}

	/** A WebSocket URL on the server (same origin unless the app points at another server). */
	function wsUrl(path: string, query: Record<string, string> = {}): string {
		const here = (globalThis as { location?: { origin: string } }).location?.origin ?? "";
		const origin = base || here;
		const token = options.getToken?.();
		const q = new URLSearchParams({ ...query, ...(token ? { token } : {}) }).toString();
		return `${origin.replace(/^http/, "ws")}${path}${q ? `?${q}` : ""}`;
	}

	/** Raw 24 kHz PCM of text read out (a stream: start playing before it's done). */
	async function speech(path: string, init: RequestInit = {}): Promise<Response> {
		const res = await doFetch(`${base}/api${path}`, {
			...init,
			headers: { ...headers(Boolean(init.body)), ...(init.headers as Record<string, string> | undefined) },
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			let message = `${res.status} ${res.statusText}`;
			try {
				message = (JSON.parse(text) as { error?: string }).error ?? message;
			} catch {}
			throw new ApiError(res.status, message);
		}
		return res;
	}

	const get = <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query);
	const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
	const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
	const del = <T = { ok: true }>(path: string, query?: Query) => request<T>("DELETE", path, undefined, query);

	return {
		baseUrl: base,
		url: (path: string) => `${base}${path}`,
		eventsUrl: () => {
			const token = options.getToken?.();
			return `${base}/api/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
		},

		info: () => get<ServerInfo>("/info"),

		voice: {
			/** WebSocket for dictation: send 24 kHz mono 16-bit PCM, get the words back. In a chat, its bot's model. */
			dictateUrl: (conversationId?: string | null) =>
				wsUrl("/api/voice/dictate", conversationId ? { conversation: conversationId } : {}),
			/** WebSocket for a call with the bot of a chat (ring: answering the bot's call). */
			callUrl: (conversationId: string, ring?: string | null) =>
				wsUrl(`/api/voice/call/${conversationId}`, ring ? { ring } : {}),
			rings: () => get<CallRing[]>("/voice/rings"),
			/** Voices you made: from a description (pick one of a few), or from a recording. */
			custom: {
				list: () => get<CustomVoice[]>("/voice/custom"),
				design: (body: { providerId: string; description: string; text?: string; language?: string }) =>
					post<{ candidates: VoiceCandidate[] }>("/voice/custom/design", body),
				keep: (candidateId: string, name: string) =>
					post<CustomVoice>("/voice/custom/keep", { candidateId, name }),
				clone: async (input: { providerId: string; name: string; audio: Blob; consent: boolean }) => {
					const form = new FormData();
					form.set("providerId", input.providerId);
					form.set("name", input.name);
					form.set("consent", String(input.consent));
					form.set("audio", input.audio, "recording.wav");
					const res = await doFetch(`${base}/api/voice/custom/clone`, {
						method: "POST",
						headers: headers(false),
						body: form,
					});
					const data = (await res.json().catch(() => null)) as (CustomVoice & { error?: string }) | null;
					if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
					return data as CustomVoice;
				},
				rename: (voiceId: string, name: string) =>
					patch<CustomVoice>(`/voice/custom/${encodeURIComponent(voiceId)}`, { name }),
				delete: (voiceId: string) => del(`/voice/custom/${encodeURIComponent(voiceId)}`),
			},
			/** Sends a voice message (a recording) in a chat; it's written down for the bot. */
			sendVoiceMessage: async (conversationId: string, audio: Blob, replyToId?: string | null) => {
				const form = new FormData();
				form.set("conversationId", conversationId);
				form.set("audio", audio, "voice.wav");
				if (replyToId) form.set("replyToId", replyToId);
				const res = await doFetch(`${base}/api/voice/messages`, {
					method: "POST",
					headers: headers(false),
					body: form,
				});
				const data = (await res.json().catch(() => null)) as (MessageSendResult & { error?: string }) | null;
				if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
				return data as MessageSendResult;
			},
			declineRing: (id: string) => post<{ ok: boolean }>(`/voice/rings/${id}/decline`),
			settings: () => get<VoiceSettings>("/voice/settings"),
			updateSettings: (body: VoiceSettingsUpdate) => patch<VoiceSettings>("/voice/settings", body),
			/** A bot's voice with the defaults filled in. */
			forAgent: (agentId: string) => get<VoiceSettings>(`/voice/agents/${agentId}`),
			models: () => get<VoiceModelInfo[]>("/voice/models"),
			voices: (model: string, cap: VoiceCap, q = "") => get<VoiceInfo[]>("/voice/voices", { model, cap, q }),
			/** A short sample of a voice (audio file). */
			previewUrl: (o: { model: string; voice: string; cap: VoiceCap; name?: string }) =>
				`${base}/api/voice/preview?${new URLSearchParams({ model: o.model, voice: o.voice, cap: o.cap, name: o.name ?? "" })}`,
			/** A message read out in its bot's voice. */
			messageSpeech: (messageId: string, signal?: AbortSignal) =>
				speech(`/voice/messages/${messageId}/speech`, { signal }),
			speak: (body: { text: string; agentId?: string | null }, signal?: AbortSignal) =>
				speech("/voice/speak", { method: "POST", body: JSON.stringify(body), signal }),
		},

		code: {
			list: (agentId?: string) => get<CodeIndex[]>("/code", agentId ? { agentId } : undefined),
			create: (body: { machineId: string; root: string; name?: string }) => post<CodeIndex>("/code", body),
			refresh: (id: string) => post<CodeIndex>(`/code/${id}/refresh`),
			search: (id: string, query: string, limit?: number) =>
				post<CodeSearchHit[]>(`/code/${id}/search`, { query, limit }),
			delete: (id: string) => del(`/code/${id}`),
		},

		push: {
			key: () => get<{ publicKey: string }>("/push/key"),
			subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
				post<{ devices: number }>("/push/subscriptions", sub),
			unsubscribe: (endpoint: string) => post<{ ok: boolean }>("/push/unsubscribe", { endpoint }),
			test: () => post<{ sent: number }>("/push/test"),
			/** The phone apps: what they need to turn push on, and this phone's push address. */
			mobile: () => get<MobilePushClientConfig>("/push/mobile"),
			addDevice: (token: MobilePushToken) => post<{ devices: number }>("/push/devices", token),
			removeDevice: (token: string) => post<{ ok: boolean }>("/push/devices/remove", { token }),
		},

		tailscale: {
			overview: () => get<TailscaleOverview>("/tailscale"),
			setApi: (body: TailscaleApiInput) => request<TailscaleOverview>("PUT", "/tailscale/api", body),
			clearApi: () => del("/tailscale/api"),
			setHttps: (on: boolean) => post<TailscaleOverview["https"]>("/tailscale/https", { on }),
			setByIp: (on: boolean) => post<TailscaleOverview["byIp"]>("/tailscale/by-ip", { on }),
			renewAuthKey: () => post<TailscaleOverview>("/tailscale/auth-key"),
			setDefaultUser: (user: string) => request<TailscaleOverview>("PUT", "/tailscale/default-user", { user }),
		},

		hosts: {
			list: () => get<HostWithStatus[]>("/hosts"),
			create: (body: HostCreate) => post<HostWithStatus>("/hosts", body),
			update: (id: string, body: HostUpdate) => patch<Host>(`/hosts/${id}`, body),
			delete: (id: string) => del(`/hosts/${id}`),
			check: (id: string) => post<HostStatus>(`/hosts/${id}/check`),
			masterKey: () => get<MasterKey>("/hosts/master-key"),
			rotateMasterKey: () => post<MasterKey>("/hosts/master-key/rotate"),
			tailnet: () =>
				get<{ devices: TailnetDevice[]; error: string | null; self: string | null; via: "api" | "cli" }>(
					"/hosts/tailnet",
				),
			grants: () => get<AccessGrant[]>("/hosts/grants"),
			grant: (agentId: string, target: string, account?: string) =>
				post<unknown>("/hosts/grants", { agentId, target, account }),
			addAccount: (id: string, account: string) => post<HostAccountResult>(`/hosts/${id}/accounts`, { account }),
			removeAccount: (id: string, account: string) => del(`/hosts/${id}/accounts/${encodeURIComponent(account)}`),
			revoke: (grantId: string) => del(`/hosts/grants/${grantId}`),
		},

		x: {
			get: (agentId: string) => get<XAccount | null>(`/x/${agentId}`),
			connect: (agentId: string, body: XConnect) => request<XAccount>("PUT", `/x/${agentId}`, body),
			update: (agentId: string, body: XUpdate) => patch<XAccount>(`/x/${agentId}`, body),
			disconnect: (agentId: string) => del(`/x/${agentId}`),
		},

		instagram: {
			get: (agentId: string) => get<IgAccount | null>(`/instagram/${agentId}`),
			connect: (agentId: string, body: IgConnect) => request<IgAccount>("PUT", `/instagram/${agentId}`, body),
			update: (agentId: string, body: IgUpdate) => patch<IgAccount>(`/instagram/${agentId}`, body),
			disconnect: (agentId: string) => del(`/instagram/${agentId}`),
		},

		tiktok: {
			get: (agentId: string) => get<TtAccount | null>(`/tiktok/${agentId}`),
			connect: (agentId: string, body: TtConnect) => request<TtAccount>("PUT", `/tiktok/${agentId}`, body),
			update: (agentId: string, body: TtUpdate) => patch<TtAccount>(`/tiktok/${agentId}`, body),
			disconnect: (agentId: string) => del(`/tiktok/${agentId}`),
		},

		apiProviders: {
			list: () => get<ApiProviderWithStatus[]>("/api-providers"),
			create: (body: ApiProviderCreate) => post<ApiProviderWithStatus>("/api-providers", body),
			update: (id: string, body: ApiProviderUpdate) => patch<ApiProviderWithStatus>(`/api-providers/${id}`, body),
			delete: (id: string) => del(`/api-providers/${id}`),
			check: (id: string) => post<ApiProviderWithStatus>(`/api-providers/${id}/check`),
			/** id: a saved provider being edited (its stored key is used while the key field shows the masked one). */
			test: (body: ApiProviderCreate & { id?: string }) =>
				post<{ ok: boolean; error: string | null; models: ApiModel[] }>("/api-providers/test", body),
			embeddingModels: () => get<EmbeddingModelInfo[]>("/api-providers/embedding-models"),
		},

		auth: {
			status: () => get<AuthStatus>("/auth/status"),
			setup: (body: SetupInput) => post<SignInResult>("/auth/setup", body),
			login: (body: LoginInput) => post<SignInResult>("/auth/login", body),
			/** The second step: send a code by email or text, then check a code (or a recovery code). */
			mfaChallenge: () =>
				get<{ methods: MfaMethod[]; hints: { email?: string; sms?: string } }>("/auth/mfa/challenge"),
			mfaSend: (method: "email" | "sms") => post<{ ok: true }>("/auth/mfa/send", { method }),
			mfaVerify: (method: MfaMethod, code: string) => post<SignInResult>("/auth/mfa/verify", { method, code }),
			/** Where the browser goes to sign in with a provider (or, signed in, link it). */
			ssoStartUrl: (providerId: string, opts: { redirect?: string; link?: boolean } = {}) =>
				`${base}/api/auth/sso/${encodeURIComponent(providerId)}/start${qs({ redirect: opts.redirect, link: opts.link ? 1 : undefined })}`,
			forgot: (email: string) => post<{ ok: true }>("/auth/forgot", { email }),
			ticket: (kind: "invite" | "reset", token: string) =>
				get<TicketInfo>(`/auth/ticket/${kind}/${encodeURIComponent(token)}`),
			acceptTicket: (kind: "invite" | "reset", token: string, password: string) =>
				post<SignInResult>(`/auth/ticket/${kind}/${encodeURIComponent(token)}`, { password }),
			/** Proving it's you again before a sensitive change (password, or a code). */
			reauth: (body: { password?: string; method?: MfaMethod; code?: string }) =>
				post<{ ok: true }>("/auth/reauth", body),
			reauthSend: (method: "email" | "sms") => post<{ ok: true }>("/auth/reauth/send", { method }),
			/** Resolves once you proved it's you recently (asking with the "Confirm it's you" dialog if needed). */
			ensureRecent: () => get<{ ok: true }>("/auth/recent"),
			mfa: () => get<MfaStatus>("/auth/mfa"),
			totpSetup: () => post<TotpSetup>("/auth/mfa/totp/setup"),
			totpConfirm: (code: string) => post<{ recoveryCodes?: string[] }>("/auth/mfa/totp/confirm", { code }),
			codeFactorSetup: (kind: "email" | "sms") => post<{ hint: string }>(`/auth/mfa/${kind}/setup`),
			codeFactorConfirm: (kind: "email" | "sms", code: string) =>
				post<{ recoveryCodes?: string[] }>(`/auth/mfa/${kind}/confirm`, { code }),
			removeFactor: (kind: "totp" | "email" | "sms") => del(`/auth/mfa/${kind}`),
			newRecoveryCodes: () => post<{ codes: string[] }>("/auth/mfa/recovery-codes"),
			identities: () => get<LinkedIdentity[]>("/auth/identities"),
			unlinkIdentity: (id: string) => del(`/auth/identities/${id}`),
			logout: () => post<{ ok: true }>("/auth/logout"),
			updateAccount: (body: AccountPatch) => patch<AuthUser>("/auth/account", body),
			changePassword: (body: PasswordChange) => post<{ ok: true }>("/auth/password", body),
			sessions: () => get<SessionInfo[]>("/auth/sessions"),
			revokeSession: (id: string) => del(`/auth/sessions/${id}`),
			revokeOtherSessions: () => post<{ ok: true }>("/auth/sessions/revoke-others"),
			passkeys: () => get<PasskeyInfo[]>("/auth/passkeys"),
			/** WebAuthn options as JSON (hand them to @simplewebauthn/browser). */
			passkeyRegisterOptions: () =>
				post<{ challengeId: string; options: Record<string, unknown> }>("/auth/passkeys/register/options"),
			passkeyRegisterVerify: (body: { challengeId: string; response: unknown; name?: string }) =>
				post<PasskeyInfo>("/auth/passkeys/register/verify", body),
			renamePasskey: (id: string, name: string) => patch<{ ok: true }>(`/auth/passkeys/${id}`, { name }),
			deletePasskey: (id: string) => del(`/auth/passkeys/${id}`),
			passkeyLoginOptions: () =>
				post<{ challengeId: string; options: Record<string, unknown> }>("/auth/passkeys/login/options"),
			passkeyLoginVerify: (body: { challengeId: string; response: unknown; reauth?: boolean }) =>
				post<SignInResult>("/auth/passkeys/login/verify", body),
			tokens: () => get<ApiTokenInfo[]>("/auth/tokens"),
			createToken: (body: ApiTokenCreate) => post<CreatedApiToken>("/auth/tokens", body),
			/** A token for this computer's desktop app to lend the computer to bots (replaces its previous one). */
			desktopToken: (computerName: string) => post<CreatedApiToken>("/auth/tokens/desktop", { computerName }),
			revokeToken: (id: string) => del(`/auth/tokens/${id}`),
		},

		machines: {
			list: (query?: { agentId?: string }) => get<Machine[]>("/machines", query),
			get: (id: string) => get<Machine>(`/machines/${id}`),
			create: (body: MachineCreate) => post<Machine>("/machines", body),
			update: (id: string, body: MachineUpdate) => patch<Machine>(`/machines/${id}`, body),
			delete: (id: string) => del(`/machines/${id}`),
			start: (id: string) => post<Machine>(`/machines/${id}/start`),
			stop: (id: string) => post<Machine>(`/machines/${id}/stop`),
			restart: (id: string) => post<Machine>(`/machines/${id}/restart`),
			/** You're using the computer (VNC in the app): the bot waits until you hand it back. */
			takeover: (id: string, active: boolean) => post<{ ok: true }>(`/machines/${id}/takeover`, { active }),
			/** WebSocket URL for the app's VNC viewer. */
			vncUrl: (id: string) => {
				const token = options.getToken?.();
				const here = (globalThis as { location?: { origin: string } }).location?.origin ?? "";
				const origin = base || here;
				return `${origin.replace(/^http/, "ws")}/api/machines/${id}/vnc${token ? `?token=${encodeURIComponent(token)}` : ""}`;
			},
			/** Machines added over SSH: try connecting again. */
			retry: (id: string) => post<Machine>(`/machines/${id}/retry`),
			/** Usernames, passwords and the bot's SSH key. */
			access: (id: string) => get<MachineAccess>(`/machines/${id}/access`),
			/** Snapshots of a bot's computer or devbox, newest first. */
			checkpoints: {
				list: (id: string) => get<CheckpointList>(`/machines/${id}/checkpoints`),
				create: (id: string, label = "") => post<Checkpoint>(`/machines/${id}/checkpoints`, { label }),
				/** Rolls back (everything since is lost); a running machine starts again. */
				restore: (id: string, name: string) =>
					post<{ ok: true }>(`/machines/${id}/checkpoints/${encodeURIComponent(name)}/restore`),
				delete: (id: string, name: string) => del(`/machines/${id}/checkpoints/${encodeURIComponent(name)}`),
			},
			/** A fresh PNG of the computer's screen (add a cache-busting query). */
			screenUrl: (id: string) => {
				const token = options.getToken?.();
				return `${base}/api/machines/${id}/screen?t=${Date.now()}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
			},
			testProxmox: () =>
				post<{
					ok: boolean;
					version: string | null;
					error: string | null;
					nodes: string[];
					storages: string[];
				}>("/machines/proxmox/test"),
		},

		credentials: {
			pending: () => get<CredentialRequest[]>("/credentials/requests"),
			answer: (id: string, body: CredentialAnswer) => post<{ ok: true }>(`/credentials/requests/${id}`, body),
			saved: (query?: { agentId?: string }) => get<SavedLogin[]>("/credentials/saved", query),
			forget: (id: string) => del(`/credentials/saved/${id}`),
		},
		models: (refresh = false) => get<ModelInfo[]>("/models", { refresh: refresh || undefined }),

		settings: {
			get: () => get<Settings>("/settings"),
			update: (body: SettingsUpdate) => patch<Settings>("/settings", body),
			testGateway: (body: { gatewayUrl?: string; gatewayApiKey?: string }) =>
				post<{ ok: boolean; error: string | null; models: number }>("/settings/test-gateway", body),
		},

		agents: {
			list: () => get<Agent[]>("/agents"),
			get: (id: string) => get<Agent>(`/agents/${id}`),
			create: (body: AgentCreate) => post<Agent>("/agents", body),
			update: (id: string, body: AgentUpdate) => patch<Agent>(`/agents/${id}`, body),
			delete: (id: string) => del(`/agents/${id}`),
			duplicate: (id: string) => post<Agent>(`/agents/${id}/duplicate`),
			/** A link that downloads the bot as a file (with its memory and notes when asked). */
			exportUrl: (id: string, opts: { memory?: boolean; notes?: boolean } = {}) => {
				const token = options.getToken?.();
				return `${base}/api/agents/${id}/export${qs({ memory: opts.memory ? 1 : undefined, notes: opts.notes ? 1 : undefined, ...(token ? { token } : {}) })}`;
			},
			/** A new bot from an exported file (its routines come in paused). */
			import: (file: unknown) => post<BotImportResult>("/agents/import", file),
			context: (id: string, conversationId?: string) =>
				get<AgentContext>(`/agents/${id}/context`, { conversationId }),
			directConversation: (id: string) => get<Conversation>(`/agents/${id}/conversation`),
			generateAvatar: (id: string, prompt: string) => post<Avatar>(`/agents/${id}/avatar/generate`, { prompt }),
			reorder: (ids: string[]) => post<{ ok: true }>("/agents/reorder", { ids }),
			/** Who else may chat with it. */
			shares: (id: string) => get<AgentShare[]>(`/agents/${id}/shares`),
			share: (id: string, target: ShareTarget) => post<AgentShare[]>(`/agents/${id}/shares`, target),
			unshare: (id: string, shareId: string) => del<AgentShare[]>(`/agents/${id}/shares/${shareId}`),
		},

		/** Other people here, by name (to share bots with). */
		people: () => get<Person[]>("/people"),

		/** Admins: people, roles, and how they sign in. */
		admin: {
			users: () => get<ManagedUser[]>("/admin/users"),
			createUser: (body: UserCreate) => post<UserCredentials>("/admin/users", body),
			updateUser: (id: string, body: UserUpdate) => patch<ManagedUser>(`/admin/users/${id}`, body),
			resetPassword: (id: string, how: "temporary" | "link") =>
				post<UserCredentials>(`/admin/users/${id}/reset-password`, { how }),
			resetMfa: (id: string) => post<ManagedUser>(`/admin/users/${id}/reset-mfa`),
			signOutUser: (id: string) => post<{ ok: true }>(`/admin/users/${id}/sign-out`),
			deleteUser: (id: string) => del(`/admin/users/${id}`),
			roles: () => get<Role[]>("/admin/roles"),
			createRole: (body: RoleInput) => post<Role>("/admin/roles", body),
			updateRole: (id: string, body: RoleUpdate) => patch<Role>(`/admin/roles/${id}`, body),
			deleteRole: (id: string) => del(`/admin/roles/${id}`),
			sso: () => get<SsoProvider[]>("/admin/sso"),
			createSso: (body: SsoProviderInput) => post<SsoProvider>("/admin/sso", body),
			updateSso: (id: string, body: Partial<SsoProviderInput>) => patch<SsoProvider>(`/admin/sso/${id}`, body),
			deleteSso: (id: string) => del(`/admin/sso/${id}`),
			email: () => get<EmailConfig>("/admin/email"),
			saveEmail: (body: Partial<EmailConfig>) => request<EmailConfig>("PUT", "/admin/email", body),
			testEmail: (to: string) => post<{ ok: true }>("/admin/email/test", { to }),
			sms: () => get<SmsConfig>("/admin/sms"),
			saveSms: (body: Partial<SmsConfig>) => request<SmsConfig>("PUT", "/admin/sms", body),
			testSms: (to: string) => post<{ ok: true }>("/admin/sms/test", { to }),
			mobile: () => get<MobilePushStatus>("/admin/mobile"),
			saveMobile: (body: Partial<MobilePushSettings>) => request<MobilePushStatus>("PUT", "/admin/mobile", body),
		},

		conversations: {
			list: (query?: { agentId?: string; kind?: "direct" | "group"; archived?: boolean }) =>
				get<Conversation[]>("/conversations", query),
			get: (id: string) => get<Conversation>(`/conversations/${id}`),
			create: (body: ConversationCreate) => post<Conversation>("/conversations", body),
			update: (id: string, body: ConversationUpdate) => patch<Conversation>(`/conversations/${id}`, body),
			delete: (id: string) => del(`/conversations/${id}`),
			reset: (id: string) => post<Conversation>(`/conversations/${id}/reset`),
			compact: (id: string) => post<Conversation>(`/conversations/${id}/compact`),
			clearSummary: (id: string) => post<Conversation>(`/conversations/${id}/clear-summary`),
			messages: (id: string, query?: { before?: number; limit?: number }) =>
				get<Message[]>(`/conversations/${id}/messages`, query),
			send: (id: string, body: MessageSend) => post<MessageSendResult>(`/conversations/${id}/messages`, body),
			stop: (id: string) => post<{ cancelled: number }>(`/conversations/${id}/stop`),
		},

		messages: {
			delete: (id: string) => del(`/messages/${id}`),
			retry: (id: string, body: MessageRetry = {}) => post<{ ok: true }>(`/messages/${id}/retry`, body),
			setVersion: (id: string, version: number) => post<Message>(`/messages/${id}/version`, { version }),
		},

		runs: {
			list: (query?: { agentId?: string; status?: string; limit?: number }) => get<Run[]>("/runs", query),
			cancel: (id: string) => post<{ ok: true }>(`/runs/${id}/cancel`),
		},

		usage: {
			/** scope: "me", or (admins) "all" or someone's id. */
			report: (days = 30, scope: UsageScope = "me") => get<UsageReport>("/usage", { days, scope }),
			/** A link that downloads the same numbers as CSV. */
			exportUrl: (days = 30, scope: UsageScope = "me") => {
				const token = options.getToken?.();
				return `${base}/api/usage/export${qs({ days, scope, ...(token ? { token } : {}) })}`;
			},
			/** price null clears it. */
			setPrice: (model: string, price: ModelPrice | null) =>
				request<Record<string, ModelPrice>>("PUT", "/usage/prices", { model, price }),
		},

		search: {
			/** Every chat's messages: all words must match, the last as a prefix. */
			messages: (q: string, limit?: number) =>
				get<MessageSearchHit[]>("/search/messages", { q, ...(limit ? { limit } : {}) }),
		},

		approvals: {
			list: () => get<PendingApproval[]>("/approvals"),
			decide: (toolCallId: string, body: ApprovalDecision) =>
				post<{ ok: true }>(`/approvals/${encodeURIComponent(toolCallId)}`, body),
		},

		memories: {
			list: (query?: { agentId?: string; shared?: boolean; scope?: "agent" | "all" }) =>
				get<Memory[]>("/memories", query),
			/** How often bots check what they remember (and when next). */
			checkups: () =>
				get<{ schedule: "weekly" | "monthly" | "off"; nextAt: number | null }>("/memories/checkups"),
			setCheckups: (schedule: "weekly" | "monthly" | "off") =>
				request<{ schedule: "weekly" | "monthly" | "off"; nextAt: number | null }>(
					"PUT",
					"/memories/checkups",
					{
						schedule,
					},
				),
			/** One bot checks its memory now (it posts in its chat if it changed something or has questions). */
			checkup: (agentId: string) => post<MemoryCheckupResult>("/memories/checkups/run", { agentId }),
			create: (body: MemoryCreate) => post<Memory>("/memories", body),
			update: (id: string, body: MemoryUpdate) => patch<Memory>(`/memories/${id}`, body),
			delete: (id: string) => del(`/memories/${id}`),
			clear: (query: { agentId?: string; shared?: boolean; kind?: string }) =>
				del<{ deleted: number }>("/memories", query),
		},

		notes: {
			list: (agentId: string) => get<Note[]>("/notes", { agentId }),
			create: (body: NoteCreate) => post<Note>("/notes", body),
			update: (id: string, body: NoteUpdate) => patch<Note>(`/notes/${id}`, body),
			delete: (id: string) => del(`/notes/${id}`),
		},

		routines: {
			list: (query?: { agentId?: string }) => get<Routine[]>("/routines", query),
			get: (id: string) => get<Routine>(`/routines/${id}`),
			create: (body: RoutineCreate) => post<Routine>("/routines", body),
			update: (id: string, body: RoutineUpdate) => patch<Routine>(`/routines/${id}`, body),
			delete: (id: string) => del(`/routines/${id}`),
			test: (id: string) => post<{ ok: true }>(`/routines/${id}/test`),
			runs: (id: string) => get<RoutineRun[]>(`/routines/${id}/runs`),
			preview: (body: SchedulePreviewRequest) => post<SchedulePreview>("/routines/preview", body),
		},

		skills: {
			list: () => get<Skill[]>("/skills"),
			get: (id: string) => get<Skill>(`/skills/${id}`),
			create: (body: SkillCreate) => post<Skill>("/skills", body),
			update: (id: string, body: SkillUpdate) => patch<Skill>(`/skills/${id}`, body),
			delete: (id: string) => del(`/skills/${id}`),
			import: (markdown: string) => post<Skill>("/skills/import", { markdown }),
			exportUrl: (id: string) => `${base}/api/skills/${id}/export`,
		},

		mcp: {
			list: () => get<McpServerWithStatus[]>("/mcp"),
			create: (body: McpServerCreate) => post<McpServerWithStatus>("/mcp", body),
			update: (id: string, body: McpServerUpdate) => patch<McpServerWithStatus>(`/mcp/${id}`, body),
			delete: (id: string) => del(`/mcp/${id}`),
			connect: (id: string) => post<McpServerStatus>(`/mcp/${id}/connect`),
			disconnect: (id: string) => post<McpServerStatus>(`/mcp/${id}/disconnect`),
			/** Where to send you to sign in (null: already signed in). pasteBack: paste the address you land on. */
			signIn: (id: string, opts: { loopback?: boolean } = {}) =>
				post<{ url: string | null; pasteBack: boolean }>(`/mcp/${id}/sign-in`, opts),
			signOut: (id: string) => post<{ ok: true }>(`/mcp/${id}/sign-out`),
			finishSignIn: (url: string) => post<{ serverId: string }>("/mcp/oauth/finish", { url }),
			iconUrl: (domain: string) => `${base}/api/mcp/icons/${encodeURIComponent(domain)}`,
		},

		providers: {
			list: () => get<ProviderWithStatus[]>("/providers"),
			create: (body: ProviderCreate) => post<ProviderWithStatus>("/providers", body),
			update: (id: string, body: ProviderUpdate) => patch<ProviderWithStatus>(`/providers/${id}`, body),
			delete: (id: string) => del(`/providers/${id}`),
			check: (id: string) => post<ProviderWithStatus>(`/providers/${id}/check`),
			authenticate: (id: string, methodId: string) =>
				post<ProviderWithStatus>(`/providers/${id}/authenticate`, { methodId }),
		},

		channels: {
			list: (query?: { agentId?: string }) => get<ChannelWithStatus[]>("/channels", query),
			create: (body: ChannelCreate) => post<ChannelWithStatus>("/channels", body),
			update: (id: string, body: ChannelUpdate) => patch<ChannelWithStatus>(`/channels/${id}`, body),
			delete: (id: string) => del(`/channels/${id}`),
			restart: (id: string) => post<ChannelWithStatus>(`/channels/${id}/restart`),
			bindings: (id: string) => get<ChannelBinding[]>(`/channels/${id}/bindings`),
			/** Every chat linked on every platform. */
			links: () => get<ChannelBinding[]>("/channels/links"),
			unlink: (bindingId: string) => del(`/channels/bindings/${bindingId}`),
			updateBinding: (bindingId: string, body: ChannelBindingUpdate) =>
				patch<ChannelBinding>(`/channels/bindings/${bindingId}`, body),
			pairings: () => get<ChannelPairing[]>("/channels/pairings"),
			decidePairing: (code: string, approve: boolean) =>
				post<{ ok: true }>(`/channels/pairings/${encodeURIComponent(code)}`, { approve }),
		},

		/**
		 * Sends one prompt to several models and calls `onEvent` as their answers stream in. Resolves when all are
		 * done (abort with `signal` to stop).
		 */
		compare: async (req: CompareRequest, onEvent: (ev: CompareEvent) => void, signal?: AbortSignal) => {
			const res = await doFetch(`${base}/api/compare`, {
				method: "POST",
				headers: headers(true),
				body: JSON.stringify(req),
				signal,
			});
			if (!res.ok || !res.body) {
				const data = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
			}
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				let at = buffer.indexOf("\n\n");
				while (at !== -1) {
					const chunk = buffer.slice(0, at);
					buffer = buffer.slice(at + 2);
					const data = chunk
						.split("\n")
						.filter((l) => l.startsWith("data:"))
						.map((l) => l.slice(5).trimStart())
						.join("\n");
					if (data) onEvent(JSON.parse(data) as CompareEvent);
					at = buffer.indexOf("\n\n");
				}
			}
		},

		digest: {
			status: () => get<DigestStatus>("/digest"),
			configure: (body: DigestConfigUpdate) => patch<DigestStatus>("/digest", body),
			/** Sends one now, even on a quiet day. */
			send: () => post<{ sent: boolean }>("/digest/send"),
		},

		/** Disk space, database size, backups and Proxmox storage, with anything that needs you. */
		health: (refresh = false) => get<HealthReport>("/health/report", refresh ? { refresh: 1 } : undefined),

		activity: {
			/** What bots did, newest first; pass the last entry's `at` as `before` for more. */
			list: (q: ActivityQuery = {}) => get<ActivityEntry[]>("/activity", { ...q }),
			/** A link that downloads the filtered log. */
			exportUrl: (q: ActivityQuery, format: "csv" | "jsonl") => {
				const token = options.getToken?.();
				return `${base}/api/activity/export${qs({ ...q, format, ...(token ? { token } : {}) })}`;
			},
		},

		documents: {
			list: () => get<LibraryDocument[]>("/documents"),
			/** Adds a file (one per call; a folder's files with the folder's name as collection). */
			upload: async (file: File | Blob, collection = ""): Promise<LibraryDocument> => {
				const form = new FormData();
				form.set("file", file, file instanceof File ? file.name : "document");
				if (collection) form.set("collection", collection);
				const res = await doFetch(`${base}/api/documents`, {
					method: "POST",
					headers: headers(false),
					body: form,
				});
				const data = (await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))) as
					| LibraryDocument
					| { error?: string };
				if (!res.ok) throw new ApiError(res.status, ("error" in data && data.error) || "Upload failed");
				return data as LibraryDocument;
			},
			search: (q: string, limit?: number) =>
				get<LibraryHit[]>("/documents/search", { q, ...(limit ? { limit } : {}) }),
			rename: (id: string, title: string) => patch<LibraryDocument>(`/documents/${id}`, { title }),
			reindex: (id: string) => post<LibraryDocument>(`/documents/${id}/reindex`),
			delete: (id: string) => del(`/documents/${id}`),
		},

		backups: {
			status: () => get<BackupStatus>("/backups"),
			configure: (body: BackupConfigUpdate) => patch<BackupStatus>("/backups/config", body),
			/** Makes one now (takes a while with many uploads). */
			create: () => post<BackupInfo>("/backups"),
			delete: (name: string) => del(`/backups/${encodeURIComponent(name)}`),
			/** Restored the next time Sekai starts (after backing up what's there now). */
			restore: (name: string) => post<BackupStatus>(`/backups/${encodeURIComponent(name)}/restore`),
			cancelRestore: () => del<BackupStatus>("/backups/restore"),
			/** A link that downloads the backup (it holds every secret: keep it safe). */
			downloadUrl: (name: string) => {
				const token = options.getToken?.();
				return `${base}/api/backups/${encodeURIComponent(name)}/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;
			},
			/** Adds a backup made elsewhere (a sekai-….tar.gz), to restore from. */
			upload: async (file: File | Blob): Promise<BackupInfo> => {
				const form = new FormData();
				form.set("file", file, file instanceof File ? file.name : "backup.tar.gz");
				const res = await doFetch(`${base}/api/backups/upload`, {
					method: "POST",
					headers: headers(false),
					body: form,
				});
				const data = (await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))) as
					| BackupInfo
					| { error?: string };
				if (!res.ok) throw new ApiError(res.status, ("error" in data && data.error) || "Upload failed");
				return data as BackupInfo;
			},
		},

		uploads: {
			create: async (file: File | Blob, name?: string): Promise<Upload> => {
				const form = new FormData();
				form.set("file", file, name ?? (file instanceof File ? file.name : "upload"));
				const res = await doFetch(`${base}/api/uploads`, {
					method: "POST",
					headers: headers(false),
					body: form,
				});
				const data = (await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))) as
					| Upload
					| { error?: string };
				if (!res.ok) throw new ApiError(res.status, ("error" in data && data.error) || "Upload failed");
				return data as Upload;
			},
		},
	};
}

export type ApiClient = ReturnType<typeof createApiClient>;
