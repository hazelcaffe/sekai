import { type ExtensionCommand, type ExtensionResult, extensionWebUrl } from "@sekai/shared";
import { type BrowserTab, browser, permissionOrigin } from "./browser.ts";
import { pageCommand } from "./dom.ts";

export interface SharedTab {
	id: number;
	origin: string;
	title: string;
}

/** This allowlist lives only in this panel. The server cannot add tabs or widen its permissions. */
export class BrowserControl {
	readonly shared = new Map<number, SharedTab>();
	private generation = 0;

	stop(): void {
		this.generation++;
		this.shared.clear();
	}

	unshare(tabId: number): void {
		this.generation++;
		this.shared.delete(tabId);
	}

	async share(tab: BrowserTab): Promise<void> {
		if (tab.id === undefined || tab.incognito || !tab.url)
			throw new Error("Choose a normal web tab, not a private window.");
		const url = extensionWebUrl(tab.url);
		const generation = this.generation;
		if (!(await browser.permissions.request({ origins: [permissionOrigin(url)] })))
			throw new Error("Site access wasn't allowed.");
		if (generation !== this.generation) throw new Error("Sharing stopped.");
		const current = await browser.tabs.get(tab.id);
		if (generation !== this.generation) throw new Error("Sharing stopped.");
		if (!current.url || new URL(current.url).origin !== url.origin || current.incognito)
			throw new Error("The tab changed. Share it again.");
		this.shared.set(tab.id, { id: tab.id, origin: url.origin, title: current.title ?? url.hostname });
	}

	async run(
		command: ExtensionCommand,
		authorize: () => Promise<unknown>,
		confirmOpen = false,
	): Promise<ExtensionResult> {
		const input = command.input;
		const generation = this.generation;
		const check = () => {
			if (generation !== this.generation || !this.shared.size || Date.now() >= command.expiresAt)
				throw new Error("Sharing stopped or this command expired.");
			if ("tabId" in input && !this.shared.has(input.tabId)) throw new Error("That tab is no longer shared.");
		};
		check();
		// Opening asks for site permission before the first await, while the button's user gesture is live.
		if (input.action !== "open") {
			await authorize();
			check();
		}
		if (input.action === "tabs") {
			const tabs = [];
			for (const shared of this.shared.values()) {
				const tab = await browser.tabs.get(shared.id).catch(() => null);
				if (generation !== this.generation) throw new Error("Sharing stopped.");
				if (!tab?.url || tab.incognito || new URL(tab.url).origin !== shared.origin) {
					this.shared.delete(shared.id);
					continue;
				}
				tabs.push({ tabId: shared.id, title: tab.title, url: tab.url });
			}
			return { commandId: command.id, result: JSON.stringify(tabs) };
		}
		if (input.action === "open") {
			if (!confirmOpen) throw new Error("Opening and sharing a new tab needs confirmation in the extension.");
			const url = extensionWebUrl(input.url);
			// Called directly by the confirmation button, before losing its user gesture.
			if (!(await browser.permissions.request({ origins: [permissionOrigin(url)] })))
				throw new Error("Site access wasn't allowed.");
			await authorize();
			check();
			const tab = await browser.tabs.create({ url: url.href, active: true });
			check();
			if (tab.id === undefined) throw new Error("The new tab didn't open.");
			this.shared.set(tab.id, { id: tab.id, origin: url.origin, title: url.hostname });
			return {
				commandId: command.id,
				result: `Opened and shared tabId ${tab.id}. Wait for it to load, then snapshot it.`,
			};
		}
		const shared = this.shared.get(input.tabId);
		if (!shared) throw new Error("The user hasn't shared that tab.");
		const tab = await browser.tabs.get(input.tabId);
		if (tab.incognito || !tab.url || extensionWebUrl(tab.url).origin !== shared.origin) {
			this.shared.delete(input.tabId);
			throw new Error("The tab changed sites. The user must share it again.");
		}
		if (!(await browser.permissions.contains({ origins: [permissionOrigin(new URL(tab.url))] })))
			throw new Error("Site permission was removed. Share the tab again.");
		check();
		if (input.action === "screenshot") {
			// captureVisibleTab cannot target an inactive tab: never silently capture another one.
			const [active] = await browser.tabs.query({ active: true, windowId: tab.windowId });
			if (active?.id !== input.tabId) throw new Error("Select the shared tab before taking a screenshot.");
			const image = await browser.tabs
				.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 65 })
				.catch(() => {
					throw new Error(
						"To allow a screenshot, select the shared tab and click Sekai's toolbar icon there first (activeTab permission). Never grant all-sites access just for screenshots.",
					);
				});
			const after = await browser.tabs.query({ active: true, windowId: tab.windowId });
			check();
			if (after[0]?.id !== input.tabId || after[0]?.url !== tab.url)
				throw new Error("The active tab changed. Screenshot discarded.");
			return { commandId: command.id, result: `Visible screenshot of tab ${input.tabId}.`, image };
		}
		// Validate the pageId even for navigation, so a stale command never silently hits a different document.
		const [{ result } = {}] = await browser.scripting.executeScript({
			target: { tabId: input.tabId },
			func: pageCommand,
			args: [{ input, origin: shared.origin }],
		});
		check();
		if (!result) throw new Error("The page didn't return a result. Take a fresh snapshot before retrying.");
		if (result.error) throw new Error(result.error);
		if (input.action === "navigate") {
			const url = extensionWebUrl(input.url);
			if (url.origin !== shared.origin)
				throw new Error("A new site needs the user's permission. Use open, or ask them to share it.");
			await browser.tabs.update(input.tabId, { url: url.href });
		} else if (input.action === "back") await browser.tabs.goBack(input.tabId);
		else if (input.action === "forward") await browser.tabs.goForward(input.tabId);
		else if (input.action === "reload") await browser.tabs.reload(input.tabId);
		else if (input.action === "close") {
			await browser.tabs.remove(input.tabId);
			this.shared.delete(input.tabId);
		}
		return { commandId: command.id, result: result?.text ?? "Done. Take a fresh snapshot to check." };
	}
}
