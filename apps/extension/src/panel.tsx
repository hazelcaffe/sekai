import {
	ApiError,
	type Conversation,
	createApiClient,
	type ExtensionAction,
	type ExtensionChat,
	type ExtensionCommand,
	type ExtensionResult,
	type ExtensionSession,
	extensionWebUrl,
} from "@sekai/shared";
import {
	applyThemeChoice,
	Button,
	Callout,
	Confirm,
	cn,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	ErrorBoundary,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	IconButton,
	Input,
	List,
	type MenuEntry,
	PasswordInput,
	parseThemeChoice,
	Row,
	SekaiMark,
	Select,
	SkeletonChat,
	StatusDot,
	type StatusTone,
	THEMES,
	type ThemeChoice,
	TooltipProvider,
} from "@sekai/ui";
import {
	ArrowUp,
	Bot,
	ChevronDown,
	ChevronUp,
	Ellipsis,
	ExternalLink,
	Globe,
	History,
	LogOut,
	MessageSquare,
	PictureInPicture2,
	RefreshCw,
	Settings,
	Square,
	SquarePen,
	WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type BrowserTab, browser, permissionOrigin } from "./browser.ts";
import { BrowserControl } from "./control.ts";
import { ApprovalCard, ErrorBanner, MessageView, OpenTabCard } from "./parts.tsx";
import "./style.css";

interface Config {
	server: string;
	token: string;
}
type Client = ReturnType<typeof createApiClient>;
const control = new BrowserControl();

const ACTION_LABEL: Record<ExtensionAction["action"], string> = {
	tabs: "checking shared tabs",
	snapshot: "reading a page",
	screenshot: "taking a screenshot",
	click: "clicking on a page",
	type: "typing on a page",
	select: "choosing an option",
	press: "pressing a key",
	scroll: "scrolling a page",
	navigate: "opening a link",
	back: "going back",
	forward: "going forward",
	reload: "reloading a page",
	open: "asking to open a tab",
	close: "closing a tab",
};

function apiFor(config: Config): Client {
	return createApiClient({
		baseUrl: config.server,
		getToken: () => config.token,
		// Never send the person's web session or forward a bearer token across a redirect.
		fetch: (url, init) =>
			fetch(url, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) }),
	});
}

function hostOf(raw?: string): string {
	if (!raw) return "";
	try {
		return new URL(raw).hostname;
	} catch {
		return raw;
	}
}

function sharedTabName(tabId: number): string | null {
	const tab = control.shared.get(tabId);
	return tab ? hostOf(tab.origin) : null;
}

function isAuthError(err: unknown): boolean {
	return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function friendlyError(err: unknown): string {
	if (err instanceof ApiError) {
		if (err.status === 401)
			return "Your browser token wasn't accepted. Make a new one in Sekai → Settings → Browser extension.";
		if (err.status === 403)
			return "Your account doesn't have permission to use the browser extension, or this token was revoked.";
		return err.message;
	}
	if (err instanceof DOMException && err.name === "TimeoutError") {
		return "Sekai took too long to answer. Check your connection and try again.";
	}
	return errorMessage(err);
}

function Panel() {
	const [config, setConfig] = useState<Config | null>(null);
	const [server, setServer] = useState("");
	const [token, setToken] = useState("");
	const [ready, setReady] = useState(false);
	const [theme, setTheme] = useState<ThemeChoice>("auto");

	const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
	const [loadingAgents, setLoadingAgents] = useState(false);
	const [agentId, setAgentId] = useState("");
	const [chats, setChats] = useState<Conversation[]>([]);
	const [chatId, setChatId] = useState("");
	const [loadingChat, setLoadingChat] = useState(false);
	const [data, setData] = useState<ExtensionChat>({ messages: [], approvals: [] });

	const [tabs, setTabs] = useState<BrowserTab[]>([]);
	const [tabsOpen, setTabsOpen] = useState(false);
	const [loadingTabs, setLoadingTabs] = useState(false);
	const [shared, setShared] = useState<number[]>([]);
	const [session, setSession] = useState<ExtensionSession | null>(null);
	const [openCmd, setOpenCmd] = useState<ExtensionCommand | null>(null);
	const [botAction, setBotAction] = useState<string | null>(null);

	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [sharingTabId, setSharingTabId] = useState<number | null>(null);
	const [decidingId, setDecidingId] = useState<string | null>(null);
	const [answeringOpen, setAnsweringOpen] = useState(false);

	const [error, setError] = useState("");
	const [authProblem, setAuthProblem] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [offline, setOffline] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [pollKey, setPollKey] = useState(0);

	const [chatsDialogOpen, setChatsDialogOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);

	const currentSession = useRef<{ api: Client; session: ExtensionSession } | null>(null);
	const currentConfig = useRef(config);
	currentConfig.current = config;
	const shareVersion = useRef(0);
	const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const api = useMemo(() => (config ? apiFor(config) : null), [config]);
	const end = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const activeAgent = useMemo(() => agents.find((a) => a.id === agentId), [agents, agentId]);
	const activeChat = useMemo(() => chats.find((c) => c.id === chatId), [chats, chatId]);
	const isStreaming = useMemo(() => data.messages.some((m) => m.status === "streaming"), [data.messages]);
	const needsYou = data.approvals.length > 0 || Boolean(openCmd);
	// Once the bot's chats have loaded: a bot without chats gets its first one on the first send or share.
	const canChat = Boolean(agentId) && !loadingChat;

	const clearActionTimer = useCallback(() => {
		if (actionTimer.current) {
			clearTimeout(actionTimer.current);
			actionTimer.current = null;
		}
	}, []);

	const stopSharing = useCallback(() => {
		shareVersion.current++;
		clearActionTimer();
		control.stop();
		setShared([]);
		setOpenCmd(null);
		setSession(null);
		setBotAction(null);
		const active = currentSession.current;
		currentSession.current = null;
		if (active) void active.api.extension.disconnect(active.session.id).catch(() => {});
	}, [clearActionTimer]);

	const disconnect = useCallback(
		(keepServer = true) => {
			stopSharing();
			if (keepServer && currentConfig.current?.server) setServer(currentConfig.current.server);
			void browser.storage.local.remove("connection");
			setConfig(null);
			setAgentId("");
			setChatId("");
			setAgents([]);
			setChats([]);
			setTabs([]);
			setTabsOpen(false);
			setData({ messages: [], approvals: [] });
			setAuthProblem(null);
			setLoadError(null);
			setOffline(false);
			setError("");
			setSettingsOpen(false);
			setConfirmDisconnect(false);
		},
		[stopSharing],
	);

	// Load the stored connection and theme, and end sharing when the panel closes.
	useEffect(() => {
		void (async () => {
			await browser.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
			const stored = await browser.storage.local.get("connection");
			const savedTheme = await browser.storage.local.get("theme");
			const choice = parseThemeChoice(savedTheme.theme);
			setTheme(choice);
			applyThemeChoice(choice);
			const connection = stored.connection;
			if (
				connection &&
				typeof connection === "object" &&
				"server" in connection &&
				"token" in connection &&
				typeof connection.server === "string" &&
				typeof connection.token === "string"
			) {
				setConfig({ server: connection.server, token: connection.token });
				setServer(connection.server);
			}
		})()
			.catch((err) => setError(friendlyError(err)))
			.finally(() => setReady(true));

		const close = () => {
			control.stop();
			const active = currentSession.current;
			const saved = currentConfig.current;
			if (active && saved)
				void fetch(`${saved.server}/api/extension/sessions/${active.session.id}`, {
					method: "DELETE",
					headers: { authorization: `Bearer ${saved.token}` },
					credentials: "omit",
					redirect: "error",
					keepalive: true,
				}).catch(() => {});
		};
		window.addEventListener("pagehide", close);
		return () => window.removeEventListener("pagehide", close);
	}, []);

	// Apply and save the theme; "System" follows the system's light or dark setting.
	useEffect(() => {
		if (!ready) return;
		applyThemeChoice(theme);
		void browser.storage.local.set({ theme }).catch(() => {});
		if (theme !== "auto") return;
		const scheme = matchMedia("(prefers-color-scheme: dark)");
		const sync = () => applyThemeChoice("auto");
		scheme.addEventListener("change", sync);
		return () => scheme.removeEventListener("change", sync);
	}, [theme, ready]);

	// Fetch agents when connected (reloadKey re-runs after Try again).
	useEffect(() => {
		if (!api || reloadKey < 0) return;
		let cancelled = false;
		setLoadingAgents(true);
		setAuthProblem(null);
		setLoadError(null);
		void api.extension
			.agents()
			.then((list) => {
				if (cancelled) return;
				setAgents(list);
				setOffline(false);
				setAgentId((prev) => (prev && list.some((a) => a.id === prev) ? prev : (list[0]?.id ?? "")));
			})
			.catch((err) => {
				if (cancelled) return;
				if (isAuthError(err)) {
					stopSharing();
					setAuthProblem(friendlyError(err));
				} else {
					setLoadError(friendlyError(err));
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingAgents(false);
			});
		return () => {
			cancelled = true;
		};
	}, [api, reloadKey, stopSharing]);

	// Fetch chats for the selected bot.
	useEffect(() => {
		setChats([]);
		setChatId("");
		setData({ messages: [], approvals: [] });
		if (!api || !agentId) return;
		let cancelled = false;
		setLoadingChat(true);
		void api.extension
			.chats(agentId)
			.then((list) => {
				if (cancelled) return;
				setOffline(false);
				setChats(list);
				setChatId(list[0]?.id ?? "");
			})
			.catch((err) => {
				if (cancelled) return;
				if (isAuthError(err)) {
					stopSharing();
					setAuthProblem(friendlyError(err));
				} else {
					setError(friendlyError(err));
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingChat(false);
			});
		return () => {
			cancelled = true;
		};
	}, [api, agentId, stopSharing]);

	// Poll the active chat for messages and approvals (pollKey forces an immediate retry).
	useEffect(() => {
		if (!api || !chatId || reloadKey < 0 || pollKey < 0) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				const next = await api.extension.chat(chatId);
				if (cancelled) return;
				setData(next);
				setOffline(false);
			} catch (err) {
				if (cancelled) return;
				if (isAuthError(err)) {
					stopSharing();
					setAuthProblem(friendlyError(err));
					return;
				}
				setOffline(true);
			}
			if (!cancelled) timer = setTimeout(() => void refresh(), 1200);
		};
		void refresh();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, chatId, reloadKey, pollKey, stopSharing]);

	// Collapse the tab picker when a new Needs-you request arrives so the request and composer stay unobstructed.
	const needsCount = data.approvals.length + (openCmd ? 1 : 0);
	useEffect(() => {
		if (needsCount > 0) setTabsOpen(false);
	}, [needsCount]);

	// Auto-scroll to newest message.
	useEffect(() => {
		if (data.messages.length) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [data.messages.length]);

	// Poll browser control commands while sharing.
	useEffect(() => {
		if (!api || !session) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const command = await api.extension.poll(session.id);
				if (cancelled) return;
				if (command) {
					clearActionTimer();
					setBotAction(ACTION_LABEL[command.input.action] ?? "working on a tab");
					if (command.input.action === "open") {
						setOpenCmd(command);
					} else {
						let result: ExtensionResult;
						try {
							result = await control.run(command, () => api.extension.check(session.id, command.id));
						} catch (err) {
							result = { commandId: command.id, error: friendlyError(err) };
						}
						if (cancelled) return;
						await api.extension.result(session.id, result);
						setShared([...control.shared.keys()]);
						actionTimer.current = setTimeout(() => setBotAction(null), 2500);
					}
				}
			} catch (err) {
				if (!cancelled) {
					if (isAuthError(err)) setAuthProblem(friendlyError(err));
					else setError(`Tab sharing stopped: ${friendlyError(err)}`);
					stopSharing();
				}
				return;
			}
			if (!cancelled) timer = setTimeout(() => void poll(), 750);
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, session, stopSharing, clearActionTimer]);

	async function connect() {
		setBusy(true);
		setError("");
		try {
			const trimmed = server.trim();
			const url = extensionWebUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
			if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
				throw new Error("Use HTTPS, or HTTP on localhost for local development.");
			if (url.pathname !== "/" || url.search || url.hash)
				throw new Error("Enter just the server address, without a path or query.");
			if (!token.trim()) throw new Error("Paste a browser token from Sekai → Settings → Browser extension.");
			if (!(await browser.permissions.request({ origins: [permissionOrigin(url)] })))
				throw new Error("Browser access to that server wasn't allowed.");
			const next = { server: url.origin, token: token.trim() };
			await apiFor(next).extension.agents();
			await browser.storage.local.set({ connection: next });
			setConfig(next);
			setServer(url.origin);
			setToken("");
			setAuthProblem(null);
			setLoadError(null);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setBusy(false);
		}
	}

	async function refreshTabs() {
		setLoadingTabs(true);
		setError("");
		try {
			const found = (await browser.tabs.query({})).filter(
				(tab) => tab.url && /^https?:/.test(tab.url) && !tab.incognito && tab.id !== undefined,
			);
			setTabs(found);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setLoadingTabs(false);
		}
	}

	function toggleTabsPicker() {
		const next = !tabsOpen;
		setTabsOpen(next);
		if (next) void refreshTabs();
	}

	/** A bot without chats gets one when you first send or share, not merely for opening the panel. */
	async function ensureChat(client: Client): Promise<string> {
		if (chatId) return chatId;
		const chat = await client.extension.createChat(agentId);
		setChats((old) => [chat, ...old]);
		setChatId(chat.id);
		return chat.id;
	}

	async function share(tab: BrowserTab) {
		if (!api || !agentId || tab.id === undefined) return;
		const version = shareVersion.current;
		setSharingTabId(tab.id);
		setError("");
		try {
			// First, while the click still counts as a user gesture: it asks for the site's permission.
			await control.share(tab);
			if (version !== shareVersion.current) return;
			if (!currentSession.current) {
				const conversationId = await ensureChat(api);
				if (version !== shareVersion.current) return;
				const next = await api.extension.connect({ name: "Browser panel", agentId, conversationId });
				if (version !== shareVersion.current) {
					await api.extension.disconnect(next.id);
					return;
				}
				currentSession.current = { api, session: next };
				setSession(next);
			}
			setShared([...control.shared.keys()]);
		} catch (err) {
			setError(friendlyError(err));
			// Without a session this tab's grant would quietly ride along with the next tab shared.
			if (!currentSession.current) stopSharing();
			else setShared([...control.shared.keys()]);
		} finally {
			setSharingTabId(null);
		}
	}

	async function newChat() {
		if (!api || !agentId) return;
		stopSharing();
		setBusy(true);
		setError("");
		try {
			const chat = await api.extension.createChat(agentId);
			setChats((old) => [chat, ...old]);
			setChatId(chat.id);
			setData({ messages: [], approvals: [] });
			setChatsDialogOpen(false);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setBusy(false);
		}
	}

	async function send() {
		if (!api || !canChat || !text.trim() || busy) return;
		const draft = text.trim();
		setBusy(true);
		setError("");
		try {
			const id = await ensureChat(api);
			await api.extension.send(id, draft);
			setText("");
			if (textareaRef.current) textareaRef.current.style.height = "";
			setData(await api.extension.chat(id));
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setBusy(false);
		}
	}

	async function stopReply() {
		if (!api || !chatId) return;
		stopSharing();
		try {
			await api.extension.stop(chatId);
			setData(await api.extension.chat(chatId));
		} catch (err) {
			setError(friendlyError(err));
		}
	}

	async function decideApproval(toolCallId: string, allow: boolean) {
		if (!api || !chatId) return;
		setDecidingId(toolCallId);
		setError("");
		try {
			await api.extension.approve(chatId, toolCallId, allow);
			setData(await api.extension.chat(chatId));
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setDecidingId(null);
		}
	}

	async function answerOpen(allow: boolean) {
		if (!api || !session || !openCmd) return;
		const command = openCmd;
		setAnsweringOpen(true);
		setOpenCmd(null);
		setBotAction(null);
		try {
			let result: ExtensionResult;
			try {
				result = allow
					? await control.run(command, () => api.extension.check(session.id, command.id), true)
					: { commandId: command.id, error: "The user declined opening a new tab." };
			} catch (err) {
				result = { commandId: command.id, error: friendlyError(err) };
			}
			await api.extension.result(session.id, result);
			setShared([...control.shared.keys()]);
			if (tabsOpen) void refreshTabs();
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setAnsweringOpen(false);
		}
	}

	function popOut() {
		void browser.windows
			.create({
				url: browser.runtime.getURL("panel.html"),
				type: "popup",
				width: 420,
				height: 800,
			})
			.catch((err) => setError(friendlyError(err)));
	}

	function openSekaiWeb() {
		if (!config) return;
		void browser.tabs.create({ url: config.server, active: true }).catch((err) => setError(friendlyError(err)));
	}

	// Overall live status dot for the header.
	const headerDot: { tone: StatusTone; label: string; pulse?: boolean } | null = needsYou
		? { tone: "warning", label: "Needs you" }
		: botAction || isStreaming
			? { tone: "brand", label: "Working", pulse: true }
			: shared.length > 0
				? { tone: "success", label: `${shared.length} tab${shared.length === 1 ? "" : "s"} shared` }
				: null;

	// What the bot does on a tab is said once, in the sharing strip below.
	const headerSubtitle = needsYou
		? "Needs you"
		: botAction || isStreaming
			? "Working…"
			: (activeChat?.title ?? "New chat");

	const moreMenu: MenuEntry[] = [
		{
			label: "Past chats",
			icon: <History />,
			disabled: chats.length === 0,
			onSelect: () => setChatsDialogOpen(true),
		},
		{
			label: "Pop out",
			icon: <PictureInPicture2 />,
			onSelect: popOut,
		},
		{
			label: "Open Sekai",
			icon: <ExternalLink />,
			onSelect: openSekaiWeb,
		},
		{
			label: "Settings",
			icon: <Settings />,
			onSelect: () => setSettingsOpen(true),
		},
		"-",
		{
			label: "Disconnect",
			icon: <LogOut />,
			danger: true,
			onSelect: () => setConfirmDisconnect(true),
		},
	];

	// ---------------------------------------------------------------- initial storage check
	if (!ready) {
		return (
			<div className="flex h-dvh flex-col bg-bg">
				<header className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
					<SekaiMark size={24} />
					<span className="text-body font-semibold text-fg">Sekai</span>
				</header>
				<div className="flex-1 overflow-hidden">
					<SkeletonChat />
				</div>
			</div>
		);
	}

	// ---------------------------------------------------------------- not connected: pairing screen
	if (!config) {
		return (
			<div className="flex min-h-dvh flex-col bg-bg-subtle">
				<div className="flex justify-end px-3 pt-2.5">
					<IconButton label="Pop out" size="icon-sm" onClick={popOut}>
						<PictureInPicture2 />
					</IconButton>
				</div>
				<main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-6">
					<div className="rounded-xl border border-border bg-surface p-5">
						<div className="mb-5 flex flex-col items-center text-center">
							<SekaiMark size={48} className="mb-3" />
							<h1 className="text-heading font-semibold text-fg">Connect to Sekai</h1>
							<p className="mt-1 text-small text-fg-muted">
								Chat with your bots and share only the tabs you choose.
							</p>
						</div>
						<form
							className="space-y-4"
							onSubmit={(e) => {
								e.preventDefault();
								void connect();
							}}
						>
							{error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
							<Field label="Server address">
								<Input
									value={server}
									onChange={(e) => setServer(e.target.value)}
									placeholder="https://sekai.example.com"
									type="url"
									autoComplete="url"
									spellCheck={false}
									required
								/>
							</Field>
							<Field label="Browser token" hint="Make one in Sekai → Settings → Browser extension.">
								<PasswordInput
									value={token}
									onChange={(e) => setToken(e.target.value)}
									placeholder="Paste your token"
									autoComplete="off"
									required
								/>
							</Field>
							<Button type="submit" variant="primary" className="w-full" loading={busy}>
								{busy ? "Connecting…" : "Connect"}
							</Button>
							<Fold title="Learn more" variant="link">
								<p>
									Your token stays in this browser profile (never synced). It can read your chats and
									answer approvals; Disconnect removes it. No tabs are shared until you pick them, and
									closing this panel ends access.
								</p>
							</Fold>
						</form>
					</div>
				</main>
				<footer className="px-4 py-3 text-center text-caption text-fg-subtle">
					Character art © SEGA / © CP / © CFM
				</footer>
			</div>
		);
	}

	// ---------------------------------------------------------------- expired or revoked token
	if (authProblem) {
		return (
			<div className="flex h-dvh flex-col bg-bg">
				<header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
					<div className="flex min-w-0 items-center gap-2">
						<SekaiMark size={24} />
						<span className="truncate text-body font-semibold text-fg">Sekai</span>
					</div>
					<IconButton label="Pop out" size="icon-sm" onClick={popOut}>
						<PictureInPicture2 />
					</IconButton>
				</header>
				<main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4">
					<ErrorState size="sm" title="This connection expired" description={authProblem} />
					<div className="flex flex-col gap-2 px-4">
						<Button variant="primary" className="w-full" onClick={() => disconnect(true)}>
							Reconnect
						</Button>
						<Button
							variant="secondary"
							className="w-full"
							onClick={() => {
								setAuthProblem(null);
								setReloadKey((k) => k + 1);
							}}
						>
							Try again
						</Button>
					</div>
				</main>
				<footer className="px-4 py-3 text-center text-caption text-fg-subtle">
					{hostOf(config.server)} · Character art © SEGA / © CP / © CFM
				</footer>
			</div>
		);
	}

	// ---------------------------------------------------------------- initial load failed (offline / server down)
	if (loadError && agents.length === 0) {
		return (
			<div className="flex h-dvh flex-col bg-bg">
				<header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
					<div className="flex min-w-0 items-center gap-2">
						<SekaiMark size={24} />
						<span className="truncate text-body font-semibold text-fg">Sekai</span>
					</div>
					<IconButton label="Pop out" size="icon-sm" onClick={popOut}>
						<PictureInPicture2 />
					</IconButton>
				</header>
				<main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4">
					<ErrorState
						size="sm"
						title="Couldn't load your bots"
						description={loadError}
						onRetry={() => setReloadKey((k) => k + 1)}
					/>
					<div className="flex justify-center">
						<Button variant="ghost" size="sm" onClick={() => disconnect(true)}>
							Change server
						</Button>
					</div>
				</main>
				<footer className="px-4 py-3 text-center text-caption text-fg-subtle">
					{hostOf(config.server)} · Character art © SEGA / © CP / © CFM
				</footer>
			</div>
		);
	}

	// ---------------------------------------------------------------- connected main panel
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-bg-subtle">
			<div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden bg-bg md:border-x md:border-border">
				{/* Header */}
				<header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<div className="relative shrink-0">
							<SekaiMark size={26} />
							{headerDot && (
								<span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-bg p-0.5">
									<StatusDot
										tone={headerDot.tone}
										label={headerDot.label}
										pulse={headerDot.pulse}
										size="sm"
									/>
								</span>
							)}
						</div>
						<div className="min-w-0 flex-1">
							{agents.length > 0 ? (
								<Select
									variant="plain"
									size="sm"
									label="Bot"
									value={agentId}
									onValueChange={(id) => {
										stopSharing();
										setAgentId(id);
									}}
									options={agents.map((a) => ({ value: a.id, label: a.name }))}
									placeholder="Choose a bot"
									className="-ml-2 h-6 max-w-full font-semibold text-fg"
								/>
							) : (
								<div className="text-body font-semibold text-fg">Sekai</div>
							)}
							<button
								type="button"
								disabled={chats.length === 0}
								onClick={() => setChatsDialogOpen(true)}
								className={cn(
									"block max-w-full truncate text-left text-caption transition-colors duration-fast",
									needsYou
										? "font-medium text-warning-ink"
										: botAction || isStreaming
											? "text-brand-ink"
											: "text-fg-muted hover:text-fg",
								)}
							>
								{headerSubtitle}
							</button>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-0.5">
						<IconButton
							label="New chat"
							size="icon-sm"
							disabled={busy || !agentId}
							onClick={() => void newChat()}
						>
							<SquarePen />
						</IconButton>
						<DropdownMenu>
							<DropdownTrigger asChild>
								<IconButton label="More" size="icon-sm">
									<Ellipsis />
								</IconButton>
							</DropdownTrigger>
							<DropdownContent title="More">
								<DropdownEntries entries={moreMenu} />
							</DropdownContent>
						</DropdownMenu>
					</div>
				</header>

				{/* Per-tab sharing strip */}
				{agents.length > 0 && (
					<section aria-label="Browser sharing" className="shrink-0 border-b border-border bg-surface">
						<div
							className={cn(
								"flex items-center justify-between gap-2 px-3 py-2",
								shared.length > 0 && "bg-surface-2/60",
							)}
						>
							<button
								type="button"
								disabled={!canChat}
								onClick={toggleTabsPicker}
								aria-expanded={tabsOpen}
								className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors duration-fast hover:text-fg disabled:opacity-50"
							>
								{shared.length > 0 ? (
									<StatusDot
										tone={botAction ? "brand" : "success"}
										pulse={Boolean(botAction)}
										label={botAction ? `Bot is ${botAction}` : "Tabs shared"}
									/>
								) : (
									<Globe aria-hidden className="size-4 shrink-0 text-fg-subtle" />
								)}
								<span className="min-w-0 truncate text-small font-medium text-fg">
									{botAction && activeAgent
										? `${activeAgent.name} is ${botAction}`
										: shared.length > 0
											? `${shared.length} tab${shared.length === 1 ? "" : "s"} shared`
											: "Your tabs stay private"}
								</span>
								{tabsOpen ? (
									<ChevronUp aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
								) : (
									<ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
								)}
							</button>
							<div className="flex shrink-0 items-center gap-1.5">
								{session ? (
									<Button size="xs" variant="danger-ghost" onClick={stopSharing}>
										Stop sharing
									</Button>
								) : (
									<Button
										size="xs"
										variant="secondary"
										disabled={!canChat}
										onClick={toggleTabsPicker}
									>
										Share tabs
									</Button>
								)}
							</div>
						</div>

						{tabsOpen && (
							<div className="max-h-48 space-y-2.5 overflow-y-auto border-t border-border bg-bg-subtle px-3 py-2.5">
								<div className="flex items-center justify-between gap-2">
									<span className="text-caption font-medium text-fg-muted">Open tabs</span>
									<IconButton
										label="Refresh tabs"
										size="icon-xs"
										disabled={loadingTabs}
										onClick={() => void refreshTabs()}
									>
										<RefreshCw className={cn(loadingTabs && "animate-spin")} />
									</IconButton>
								</div>
								{tabs.length === 0 ? (
									<EmptyState
										size="sm"
										className="py-4"
										title="No web tabs to share"
										description="Open a normal website tab (private windows and browser pages can't be shared)."
									/>
								) : (
									<List label="Open browser tabs">
										{tabs.map((tab) => {
											const isShared = tab.id !== undefined && shared.includes(tab.id);
											const host = hostOf(tab.url);
											const isSharingThis = sharingTabId === tab.id;
											return (
												<Row
													key={tab.id}
													leading={
														<StatusDot
															tone={isShared ? "success" : "neutral"}
															label={isShared ? "Shared" : "Private"}
															size="sm"
														/>
													}
													title={
														<span className="block truncate" data-tab-url={tab.url}>
															{tab.title || host}
														</span>
													}
													subtitle={
														<span className="block truncate">
															{host}
															{tab.active ? " · Current tab" : ""}
														</span>
													}
													trailing={
														isShared ? (
															<Button
																size="xs"
																variant="ghost"
																onClick={() => {
																	if (tab.id !== undefined) control.unshare(tab.id);
																	setShared([...control.shared.keys()]);
																	if (!control.shared.size) stopSharing();
																}}
															>
																Unshare
															</Button>
														) : (
															<Button
																size="xs"
																variant="secondary"
																loading={isSharingThis}
																disabled={sharingTabId !== null}
																onClick={() => void share(tab)}
															>
																Share
															</Button>
														)
													}
												/>
											);
										})}
									</List>
								)}
								<Fold title="Learn more" variant="link">
									<p>
										Share only what this bot needs. Passwords stay hidden, actions ask first,
										changing sites ends access, and closing this panel stops sharing.
									</p>
								</Fold>
							</div>
						)}
					</section>
				)}

				{/* Transient offline notice */}
				{offline && (
					<div className="shrink-0 border-b border-border px-3 py-2">
						<Callout
							tone="warning"
							icon={<WifiOff />}
							title="Offline"
							action={
								<Button size="xs" variant="secondary" onClick={() => setPollKey((k) => k + 1)}>
									Try again
								</Button>
							}
						>
							Couldn't reach {hostOf(config.server)}. Trying again…
						</Callout>
					</div>
				)}

				{/* Main chat area */}
				<main
					className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4"
					aria-label="Chat messages"
					aria-live="polite"
				>
					{loadingAgents || loadingChat ? (
						<SkeletonChat className="px-0 py-2" />
					) : agents.length === 0 ? (
						<EmptyState
							size="sm"
							icon={<Bot />}
							title="No bots yet"
							description="Create a bot in Sekai, then come back here to chat."
							action={
								<div className="flex items-center gap-2">
									<Button variant="primary" size="sm" onClick={openSekaiWeb}>
										Open Sekai
									</Button>
									<Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
										Refresh
									</Button>
								</div>
							}
						/>
					) : data.messages.length === 0 ? (
						<EmptyState
							size="sm"
							icon={<MessageSquare />}
							title={activeAgent ? `Ask ${activeAgent.name}` : "Start a chat"}
							description="Ask about a page, or share a tab and give your bot a task."
						/>
					) : (
						<div className="space-y-4">
							{data.messages.map((m) => (
								<MessageView
									key={m.id}
									message={m}
									botName={
										agents.find((a) => a.id === m.agentId)?.name ?? activeAgent?.name ?? "Sekai"
									}
								/>
							))}
							<div ref={end} />
						</div>
					)}
				</main>

				{/* Needs you dock + errors (always above composer, never buried) */}
				{(openCmd || data.approvals.length > 0 || error) && (
					<div className="max-h-[50dvh] shrink-0 space-y-2 overflow-y-auto border-t border-border bg-bg-subtle px-3 py-2.5">
						{openCmd && (
							<OpenTabCard
								command={openCmd}
								busy={answeringOpen}
								onAnswer={(allow) => void answerOpen(allow)}
							/>
						)}
						{data.approvals.map((a) => (
							<ApprovalCard
								key={a.toolCallId}
								approval={a}
								busy={decidingId === a.toolCallId}
								onDecide={(allow) => void decideApproval(a.toolCallId, allow)}
								tabName={sharedTabName}
							/>
						))}
						{error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
					</div>
				)}

				{/* Composer */}
				{agents.length > 0 && (
					<form
						className="shrink-0 border-t border-border bg-bg p-3"
						onSubmit={(e) => {
							e.preventDefault();
							void send();
						}}
					>
						<div className="rounded-xl border border-border bg-surface-2/60 transition-colors duration-fast focus-within:border-border-strong">
							<textarea
								ref={textareaRef}
								aria-label="Message your bot"
								value={text}
								onChange={(e) => {
									setText(e.target.value);
									e.target.style.height = "auto";
									e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
										e.preventDefault();
										void send();
									}
								}}
								placeholder={activeAgent ? `Message ${activeAgent.name}…` : "Message your bot…"}
								rows={2}
								maxLength={30_000}
								disabled={!canChat}
								className="block max-h-36 w-full resize-none bg-transparent px-3 pt-2.5 pb-1.5 text-body text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
							/>
							<div className="flex items-center justify-end gap-2 px-2 pb-2">
								<div className="flex items-center gap-1.5">
									{isStreaming && (
										<Button
											type="button"
											variant="secondary"
											size="xs"
											onClick={() => void stopReply()}
										>
											<Square aria-hidden className="size-3 fill-current" />
											Stop
										</Button>
									)}
									<Button
										type="submit"
										variant="primary"
										size="sm"
										pill
										loading={busy}
										disabled={!canChat || !text.trim()}
										aria-label="Send"
										className="h-8 px-3"
									>
										<ArrowUp aria-hidden className="size-4" />
										<span>Send</span>
									</Button>
								</div>
							</div>
						</div>
					</form>
				)}
			</div>

			{/* Past chats dialog */}
			<Dialog
				open={chatsDialogOpen}
				onOpenChange={setChatsDialogOpen}
				title="Past chats"
				description={activeAgent ? `Chats with ${activeAgent.name}.` : undefined}
				size="sm"
				footer={
					<Button variant="primary" size="sm" loading={busy} onClick={() => void newChat()}>
						New chat
					</Button>
				}
			>
				{chats.length === 0 ? (
					<EmptyState size="sm" title="No chats yet" />
				) : (
					<List label="Past chats">
						{chats.map((c) => (
							<Row
								key={c.id}
								title={c.title}
								selected={c.id === chatId}
								value={c.id === chatId ? "Current" : undefined}
								onClick={() => {
									if (c.id !== chatId) {
										stopSharing();
										setChatId(c.id);
										setData({ messages: [], approvals: [] });
									}
									setChatsDialogOpen(false);
								}}
							/>
						))}
					</List>
				)}
			</Dialog>

			{/* Settings */}
			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title="Settings" size="sm">
				<div className="space-y-4">
					<List label="Settings">
						<Row title="Server" subtitle={hostOf(config.server)} />
						<Row
							title="Appearance"
							trailing={
								<Select
									variant="plain"
									size="sm"
									label="Appearance"
									value={theme}
									onValueChange={(v) => setTheme(parseThemeChoice(v))}
									options={[
										{ value: "auto", label: "System" },
										...THEMES.map((t) => ({ value: t.id, label: t.name })),
									]}
									className="-mr-2"
								/>
							}
						/>
						<Row
							title="Disconnect"
							danger
							onClick={() => {
								setSettingsOpen(false);
								setConfirmDisconnect(true);
							}}
						/>
					</List>
					<p className="text-center text-caption text-fg-subtle">Character art © SEGA / © CP / © CFM</p>
				</div>
			</Dialog>

			{/* Disconnect confirmation */}
			<Confirm
				open={confirmDisconnect}
				onOpenChange={setConfirmDisconnect}
				title="Disconnect from Sekai?"
				description="Your browser token will be removed from this profile and any tab sharing will stop."
				confirmLabel="Disconnect"
				danger
				onConfirm={() => disconnect(true)}
			/>
		</div>
	);
}

if (import.meta.env.SEKAI_EXTENSION_TARGET === "safari") document.documentElement.dataset.target = "safari";
const root = document.getElementById("root");
if (!root) throw new Error("Missing panel root.");
createRoot(root).render(
	<ErrorBoundary>
		<TooltipProvider>
			<Panel />
		</TooltipProvider>
	</ErrorBoundary>,
);
