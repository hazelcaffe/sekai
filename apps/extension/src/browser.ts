export interface BrowserTab {
	id?: number;
	windowId: number;
	url?: string;
	title?: string;
	active: boolean;
	incognito: boolean;
}

/** The Promise-based MV3 subset implemented by current Chromium, Firefox and Safari. */
export interface BrowserApi {
	runtime: { getURL(path: string): string };
	storage: {
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(values: Record<string, unknown>): Promise<void>;
			remove(key: string): Promise<void>;
			setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
		};
	};
	permissions: {
		request(input: { origins: string[] }): Promise<boolean>;
		contains(input: { origins: string[] }): Promise<boolean>;
	};
	tabs: {
		query(input: { active?: boolean; currentWindow?: boolean; windowId?: number }): Promise<BrowserTab[]>;
		get(tabId: number): Promise<BrowserTab>;
		create(input: { url: string; active?: boolean }): Promise<BrowserTab>;
		update(tabId: number, input: { url?: string; active?: boolean }): Promise<BrowserTab>;
		remove(tabId: number): Promise<void>;
		reload(tabId: number): Promise<void>;
		goBack(tabId: number): Promise<void>;
		goForward(tabId: number): Promise<void>;
		captureVisibleTab(windowId: number, options: { format: "jpeg"; quality: number }): Promise<string>;
	};
	scripting: {
		executeScript<A, R>(input: {
			target: { tabId: number };
			func: (arg: A) => R;
			args: [A];
		}): Promise<{ result?: R }[]>;
	};
	windows: { create(input: { url: string; type: "popup"; width: number; height: number }): Promise<unknown> };
	sidePanel?: { setPanelBehavior(input: { openPanelOnActionClick: boolean }): Promise<void> };
	sidebarAction?: { toggle(): Promise<void> };
	action: { onClicked: { addListener(fn: () => void): void } };
}

export const browser =
	(globalThis as unknown as { browser?: BrowserApi; chrome: BrowserApi }).browser ??
	(globalThis as unknown as { chrome: BrowserApi }).chrome;

export function permissionOrigin(url: URL): string {
	return `${url.protocol}//${url.hostname}/*`;
}
