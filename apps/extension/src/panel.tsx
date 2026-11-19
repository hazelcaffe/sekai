import {
	type Conversation,
	createApiClient,
	type ExtensionChat,
	type ExtensionCommand,
	type ExtensionResult,
	type ExtensionSession,
	extensionWebUrl,
} from "@sekai/shared";
import { Button, Callout, Field, Input, Select, Textarea } from "@sekai/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type BrowserTab, browser, permissionOrigin } from "./browser.ts";
import { BrowserControl } from "./control.ts";
import "./style.css";

interface Config {
	server: string;
	token: string;
}
type Client = ReturnType<typeof createApiClient>;
const control = new BrowserControl();
const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

function apiFor(config: Config): Client {
	return createApiClient({
		baseUrl: config.server,
		getToken: () => config.token,
		// Never send the person's web session or forward a bearer token across a redirect.
		fetch: (url, init) =>
			fetch(url, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) }),
	});
}

function Panel() {
	const [config, setConfig] = useState<Config | null>(null);
	const [server, setServer] = useState("");
	const [token, setToken] = useState("");
	const [ready, setReady] = useState(false);
	const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
	const [agentId, setAgentId] = useState("");
	const [chats, setChats] = useState<Conversation[]>([]);
	const [chatId, setChatId] = useState("");
	const [data, setData] = useState<ExtensionChat>({ messages: [], approvals: [] });
	const [tabs, setTabs] = useState<BrowserTab[]>([]);
	const [shared, setShared] = useState<number[]>([]);
	const [session, setSession] = useState<ExtensionSession | null>(null);
	const [open, setOpen] = useState<ExtensionCommand | null>(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [activity, setActivity] = useState("No tabs shared");
	const currentSession = useRef<{ api: Client; session: ExtensionSession } | null>(null);
	const currentConfig = useRef(config);
	currentConfig.current = config;
	const shareVersion = useRef(0);
	const api = useMemo(() => (config ? apiFor(config) : null), [config]);
	const end = useRef<HTMLDivElement>(null);

	const stopSharing = useCallback(() => {
		shareVersion.current++;
		control.stop();
		setShared([]);
		setOpen(null);
		setSession(null);
		setActivity("No tabs shared");
		const active = currentSession.current;
		currentSession.current = null;
		if (active) void active.api.extension.disconnect(active.session.id).catch(() => {});
	}, []);

	useEffect(() => {
		void (async () => {
			await browser.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
			const { connection } = await browser.storage.local.get("connection");
			if (
				connection &&
				typeof connection === "object" &&
				"server" in connection &&
				"token" in connection &&
				typeof connection.server === "string" &&
				typeof connection.token === "string"
			) {
				setConfig({ server: connection.server, token: connection.token });
			}
		})()
			.catch((err) => setError(messageOf(err)))
			.finally(() => setReady(true));
		const scheme = matchMedia("(prefers-color-scheme: dark)");
		const theme = () => document.documentElement.classList.toggle("dark", scheme.matches);
		theme();
		scheme.addEventListener("change", theme);
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
		return () => {
			scheme.removeEventListener("change", theme);
			window.removeEventListener("pagehide", close);
		};
	}, []);

	useEffect(() => {
		if (!api) return;
		let cancelled = false;
		void api.extension
			.agents()
			.then((list) => {
				if (!cancelled) {
					setAgents(list);
					setAgentId(list[0]?.id ?? "");
				}
			})
			.catch((err) => {
				if (!cancelled) setError(messageOf(err));
			});
		return () => {
			cancelled = true;
		};
	}, [api]);

	useEffect(() => {
		setChats([]);
		setChatId("");
		setData({ messages: [], approvals: [] });
		if (!api || !agentId) return;
		let cancelled = false;
		void api.extension
			.chats(agentId)
			.then((list) => {
				if (!cancelled) {
					setChats(list);
					setChatId(list[0]?.id ?? "");
				}
			})
			.catch((err) => {
				if (!cancelled) setError(messageOf(err));
			});
		return () => {
			cancelled = true;
		};
	}, [api, agentId]);

	useEffect(() => {
		if (!api || !chatId) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				const next = await api.extension.chat(chatId);
				if (!cancelled) setData(next);
			} catch (err) {
				if (!cancelled) setError(messageOf(err));
			}
			if (!cancelled) timer = setTimeout(() => void refresh(), 1200);
		};
		void refresh();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, chatId]);

	useEffect(() => {
		if (data.messages.length) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [data.messages.length]);

	useEffect(() => {
		if (!api || !session) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const command = await api.extension.poll(session.id);
				if (cancelled) return;
				if (command) {
					setActivity(command.input.action);
					if (command.input.action === "open") setOpen(command);
					else {
						let result: ExtensionResult;
						try {
							result = await control.run(command, () => api.extension.check(session.id, command.id));
						} catch (err) {
							result = { commandId: command.id, error: messageOf(err) };
						}
						if (cancelled) return;
						await api.extension.result(session.id, result);
						setShared([...control.shared.keys()]);
					}
				}
			} catch (err) {
				if (!cancelled) {
					setError(`Sharing stopped: ${messageOf(err)}`);
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
	}, [api, session, stopSharing]);

	async function connect() {
		setBusy(true);
		setError("");
		try {
			const url = extensionWebUrl(server.trim());
			if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
				throw new Error("Use HTTPS, or HTTP on localhost for development.");
			if (url.pathname !== "/" || url.search || url.hash)
				throw new Error("Enter just the server address, without a path, query or fragment.");
			if (!token.trim()) throw new Error("Paste a browser token from Sekai → Settings → Browser extension.");
			if (!(await browser.permissions.request({ origins: [permissionOrigin(url)] })))
				throw new Error("Server access wasn't allowed.");
			const next = { server: url.origin, token: token.trim() };
			await apiFor(next).extension.agents();
			await browser.storage.local.set({ connection: next });
			setConfig(next);
			setToken("");
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	}

	async function refreshTabs() {
		setTabs(
			(await browser.tabs.query({})).filter(
				(tab) => tab.url && /^https?:/.test(tab.url) && !tab.incognito && tab.id !== undefined,
			),
		);
	}
	async function share(tab: BrowserTab) {
		if (!api || !chatId) return;
		const version = shareVersion.current;
		setBusy(true);
		setError("");
		try {
			await control.share(tab);
			if (version !== shareVersion.current) return;
			if (!currentSession.current) {
				const next = await api.extension.connect({ name: "Browser panel", agentId, conversationId: chatId });
				if (version !== shareVersion.current) {
					await api.extension.disconnect(next.id);
					return;
				}
				currentSession.current = { api, session: next };
				setSession(next);
			}
			setShared([...control.shared.keys()]);
			setActivity("Ready for your bot");
		} catch (err) {
			setError(messageOf(err));
			stopSharing();
		} finally {
			setBusy(false);
		}
	}
	async function newChat() {
		if (!api || !agentId) return;
		stopSharing();
		setBusy(true);
		try {
			const chat = await api.extension.createChat(agentId);
			setChats((old) => [chat, ...old]);
			setChatId(chat.id);
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	}
	async function send() {
		if (!api || !chatId || !text.trim()) return;
		setBusy(true);
		setError("");
		try {
			await api.extension.send(chatId, text.trim());
			setText("");
			setData(await api.extension.chat(chatId));
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	}
	async function answerOpen(allow: boolean) {
		if (!api || !session || !open) return;
		const command = open;
		setOpen(null);
		try {
			let result: ExtensionResult;
			try {
				result = allow
					? await control.run(command, () => api.extension.check(session.id, command.id), true)
					: { commandId: command.id, error: "The user declined opening a new tab." };
			} catch (err) {
				result = { commandId: command.id, error: messageOf(err) };
			}
			await api.extension.result(session.id, result);
			setShared([...control.shared.keys()]);
		} catch (err) {
			setError(messageOf(err));
		}
	}

	if (!ready) return <main className="p-5">Opening Sekai…</main>;
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
			<header className="flex items-center justify-between gap-2">
				<div>
					<h1 className="text-lg font-semibold">Sekai</h1>
					<p className="text-xs text-fg-muted">Your bots, right beside you.</p>
				</div>
				<Button
					size="sm"
					variant="ghost"
					onClick={() =>
						void browser.windows
							.create({
								url: browser.runtime.getURL("panel.html"),
								type: "popup",
								width: 420,
								height: 800,
							})
							.catch((err) => setError(messageOf(err)))
					}
				>
					Pop out
				</Button>
			</header>
			{!config ? (
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						void connect();
					}}
				>
					<Callout title="Connect your Sekai">
						Make a browser token in Sekai → Settings → Browser extension. No tabs are shared until you
						choose them.
					</Callout>
					<Field label="Server address">
						<Input
							value={server}
							onChange={(e) => setServer(e.target.value)}
							placeholder="https://sekai.example.com"
							type="url"
							required
						/>
					</Field>
					<Field label="Browser token">
						<Input
							value={token}
							onChange={(e) => setToken(e.target.value)}
							type="password"
							autoComplete="off"
							required
						/>
					</Field>
					<Button type="submit" disabled={busy}>
						{busy ? "Connecting…" : "Connect"}
					</Button>
					<p className="text-xs text-fg-subtle">
						The token stays in this profile's local extension storage, not browser sync. It can access your
						chats and approvals. Disconnect to remove it.
					</p>
				</form>
			) : (
				<>
					<div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
						<span className="truncate">{config.server.replace(/^https?:\/\//, "")}</span>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								stopSharing();
								void browser.storage.local.remove("connection");
								setConfig(null);
								setAgentId("");
								setChatId("");
								setAgents([]);
								setData({ messages: [], approvals: [] });
							}}
						>
							Disconnect
						</Button>
					</div>
					<Field label="Bot">
						<Select
							value={agentId}
							onValueChange={(id) => {
								stopSharing();
								setAgentId(id);
							}}
							options={agents.map((a) => ({ value: a.id, label: a.name }))}
							placeholder="Choose a bot"
						/>
					</Field>
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<Field label="Chat">
								<Select
									value={chatId}
									onValueChange={(id) => {
										stopSharing();
										setChatId(id);
										setData({ messages: [], approvals: [] });
									}}
									options={chats.map((c) => ({ value: c.id, label: c.title }))}
									placeholder="Start a browser chat"
								/>
							</Field>
						</div>
						<Button variant="secondary" disabled={busy || !agentId} onClick={() => void newChat()}>
							New
						</Button>
					</div>
					<section
						className="space-y-3 rounded-2xl border border-border bg-surface-2 p-3"
						aria-label="Browser sharing"
					>
						<div className="flex items-center justify-between gap-2">
							<div>
								<h2 className="text-sm font-semibold">
									{shared.length
										? `${shared.length} tab${shared.length === 1 ? "" : "s"} shared`
										: "Your tabs stay private"}
								</h2>
								<p className="text-xs text-fg-muted" role="status">
									{activity}
								</p>
							</div>
							{session && (
								<Button size="sm" variant="danger" onClick={stopSharing}>
									Stop sharing
								</Button>
							)}
						</div>
						<p className="text-xs text-fg-muted">
							Share only what this bot needs. Actions ask first. Changing sites requires sharing again.
							Closing this panel ends access.
						</p>
						<Button
							variant="secondary"
							size="sm"
							disabled={!chatId}
							onClick={() => void refreshTabs().catch((err) => setError(messageOf(err)))}
						>
							Choose tabs to share
						</Button>
						{tabs.map((tab) => (
							<div key={tab.id} className="flex items-center gap-2">
								<span className="min-w-0 flex-1 truncate text-xs" title={tab.url}>
									{tab.title || tab.url}
								</span>
								{shared.includes(tab.id ?? -1) ? (
									<Button
										size="sm"
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
										size="sm"
										variant="secondary"
										disabled={busy}
										onClick={() => void share(tab)}
									>
										Share
									</Button>
								)}
							</div>
						))}
					</section>
					{open && open.input.action === "open" && (
						<Callout title="Open and share a new tab?">
							<p className="break-all text-xs">{open.input.url}</p>
							<div className="mt-3 flex flex-wrap gap-2">
								<Button size="sm" onClick={() => void answerOpen(true)}>
									Open and share
								</Button>
								<Button size="sm" variant="secondary" onClick={() => void answerOpen(false)}>
									Decline
								</Button>
							</div>
						</Callout>
					)}
					<section className="min-h-24 flex-1 space-y-4" aria-label="Chat messages" aria-live="polite">
						{data.messages.length === 0 && (
							<p className="py-3 text-sm text-fg-muted">
								Ask your bot about a page, or share a tab and give it a task.
							</p>
						)}
						{data.messages.map((m) => (
							<article
								key={m.id}
								className={`rounded-2xl p-3 ${m.sender === "user" ? "bg-surface-2" : "border border-border"}`}
							>
								<h3 className="mb-1 text-xs font-medium text-fg-muted">
									{m.sender === "user"
										? "You"
										: (agents.find((a) => a.id === m.agentId)?.name ?? "Sekai")}
								</h3>
								<p className="whitespace-pre-wrap break-words text-sm">
									{m.parts
										.flatMap((p) => (p.type === "text" || p.type === "notice" ? [p.text] : []))
										.join("\n")}
								</p>
								{m.parts
									.filter((p) => p.type === "tool")
									.map((p) => (
										<p key={p.id} className="py-1 text-xs text-fg-muted">
											{p.title ?? p.name} · {p.status}
										</p>
									))}
								{m.error && <p className="text-sm text-danger">{m.error}</p>}
								{m.status === "streaming" && <p className="text-xs text-fg-subtle">Working…</p>}
							</article>
						))}
						<div ref={end} />
					</section>
					{data.approvals.map((a) => (
						<Callout key={a.toolCallId} title={a.toolName}>
							<p className="text-xs">{a.reason}</p>
							<pre className="my-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">
								{JSON.stringify(a.args, null, 2)}
							</pre>
							<div className="flex gap-2">
								{[true, false].map((allow) => (
									<Button
										key={String(allow)}
										size="sm"
										variant={allow ? "primary" : "secondary"}
										onClick={() =>
											void api?.extension
												.approve(chatId, a.toolCallId, allow)
												.catch((err) => setError(messageOf(err)))
										}
									>
										{allow ? "Allow once" : "Deny"}
									</Button>
								))}
							</div>
						</Callout>
					))}
					<form
						className="sticky bottom-0 space-y-2 border-t border-border bg-surface py-3"
						onSubmit={(e) => {
							e.preventDefault();
							void send();
						}}
					>
						<Textarea
							aria-label="Message your bot"
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Ask your bot…"
							rows={3}
							maxLength={30_000}
							disabled={!chatId}
						/>
						<div className="flex justify-between gap-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={!chatId}
								onClick={() => {
									stopSharing();
									void api?.extension.stop(chatId).catch((err) => setError(messageOf(err)));
								}}
							>
								Stop reply
							</Button>
							<Button type="submit" size="sm" disabled={busy || !chatId || !text.trim()}>
								Send
							</Button>
						</div>
					</form>
				</>
			)}
			{error && (
				<p role="alert" className="break-words text-sm text-danger">
					{error}
				</p>
			)}
			<footer className="text-[10px] text-fg-subtle">Character art © SEGA / © CP / © CFM</footer>
		</main>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing panel root.");
createRoot(root).render(<Panel />);
