import { version } from "./package.json";

export type ExtensionTarget = "chromium" | "firefox" | "safari";

/** Deliberately no always-on host access or remotely callable content/background bridge. */
export function extensionManifest(target: ExtensionTarget) {
	return {
		manifest_version: 3,
		name: "Sekai",
		version,
		description: "Chat with your Sekai bots and share only the browser tabs you choose.",
		permissions: ["storage", "tabs", "scripting", "activeTab", ...(target === "chromium" ? ["sidePanel"] : [])],
		optional_host_permissions: ["http://*/*", "https://*/*"],
		icons: { "192": "icon.png" },
		incognito: "not_allowed",
		options_ui: { page: "panel.html", open_in_tab: true },
		content_security_policy: {
			extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
		},
		...(target === "chromium"
			? {
					minimum_chrome_version: "116",
					background: { service_worker: "background.js", type: "module" },
					side_panel: { default_path: "panel.html" },
					action: { default_title: "Open Sekai" },
				}
			: target === "firefox"
				? {
						background: { scripts: ["background.js"] },
						sidebar_action: { default_panel: "panel.html", default_title: "Sekai" },
						action: { default_title: "Open Sekai" },
						browser_specific_settings: {
							gecko: { id: "browser@sekai.local", strict_min_version: "128.0" },
						},
					}
				: {
						action: { default_title: "Open Sekai", default_popup: "panel.html" },
					}),
	};
}
