// The Sekai app's bridge (window.sekaiMobile; typed in packages/client/src/mobile.ts). The app runs it at document
// start in the Sekai server's own pages, never in other sites, after replacing __SEKAI_APP__ with
// {"platform":"android"|"ios","version":"1.0.0","serverUrl":"https://…"}.
//
// Transport: on iOS, window.webkit.messageHandlers.sekai (postMessage returns a promise); on Android, the
// WebMessageListener object window.sekaiNative (replies and events come back as "message" events). Native → page
// events arrive as {event, data}; on iOS through window.__sekaiMobileReceive.
(() => {
	if (window.sekaiMobile) return;
	const app = __SEKAI_APP__;
	// Only the server's own pages (the app also checks every message's origin).
	if (location.origin !== new URL(app.serverUrl).origin) return;
	const ios = window.webkit?.messageHandlers?.sekai;
	const android = window.sekaiNative;
	if (!ios && !android) return;

	let seq = 0;
	const pending = new Map();
	const listeners = { navigate: new Set(), pushToken: new Set() };

	function call(method, args) {
		const message = { method, args: args ?? {} };
		if (ios) return ios.postMessage(message);
		return new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, { resolve, reject });
			android.postMessage(JSON.stringify({ id, ...message }));
		});
	}
	const send = (method, args) => {
		call(method, args).catch(() => {});
	};

	function receive(raw) {
		let msg;
		try {
			msg = typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch {
			return;
		}
		if (!msg || typeof msg !== "object") return;
		if (typeof msg.id === "number") {
			const p = pending.get(msg.id);
			if (!p) return;
			pending.delete(msg.id);
			if (msg.error) p.reject(new Error(String(msg.error)));
			else p.resolve(msg.result ?? null);
			return;
		}
		const set = listeners[msg.event];
		if (!set) return;
		for (const cb of set) {
			try {
				cb(msg.data);
			} catch {}
		}
	}
	if (android) android.addEventListener("message", (e) => receive(e.data));
	Object.defineProperty(window, "__sekaiMobileReceive", { value: receive });

	const on = (event) => (callback) => {
		listeners[event].add(callback);
		return () => listeners[event].delete(callback);
	};

	const api = {
		platform: app.platform,
		version: app.version,
		serverUrl: app.serverUrl,
		notify: (title, body, data) =>
			send("notify", {
				title: String(title ?? ""),
				body: String(body ?? ""),
				conversationId: data?.conversationId ?? null,
				approval: data?.approval ?? null,
			}),
		setBadge: (count) => send("setBadge", { count: Math.max(0, Number(count) || 0) }),
		onNavigate: on("navigate"),
		openSettings: () => send("openSettings"),
		openExternal: (url) => send("openExternal", { url: String(url) }),
		push: {
			register: (config) => call("push.register", { fcm: config?.fcm ?? null }),
			current: (config) => call("push.current", { fcm: config?.fcm ?? null }),
			unregister: () => call("push.unregister"),
			permission: () => call("push.permission"),
			requestPermission: () => call("push.requestPermission"),
			onToken: on("pushToken"),
		},
		signInWithBrowser: (options) => call("signInWithBrowser", { provider: options?.provider ?? null }),
	};
	Object.defineProperty(window, "sekaiMobile", { value: Object.freeze({ ...api, push: Object.freeze(api.push) }) });

	// The status bar follows the page's theme (its theme-color and dark class).
	let lastTheme = "";
	function reportTheme() {
		const meta = document.querySelector('meta[name="theme-color"]');
		const color = meta?.getAttribute("content") || "";
		const dark = document.documentElement.classList.contains("dark");
		const key = `${color}|${dark}`;
		if (!color || key === lastTheme) return;
		lastTheme = key;
		send("theme", { color, dark });
	}
	new MutationObserver(reportTheme).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class", "content"],
		subtree: true,
	});
	document.addEventListener("DOMContentLoaded", reportTheme);

	// Downloads made in the page (blob: and data: links, and same-site links marked download) go to the app,
	// which saves or shares them: web views can't save blob: links themselves.
	function wantsSave(a) {
		const href = a.href || "";
		if (href.startsWith("blob:") || href.startsWith("data:")) return true;
		if (!a.hasAttribute("download")) return false;
		try {
			return new URL(href).origin === location.origin;
		} catch {
			return false;
		}
	}
	async function save(a) {
		try {
			const res = await fetch(a.href, { credentials: "include" });
			if (!res.ok) throw new Error(String(res.status));
			const blob = await res.blob();
			const base64 = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});
			const fromUrl = decodeURIComponent((a.pathname || "").split("/").pop() || "");
			const name = a.getAttribute("download") || fromUrl || "download";
			await call("saveFile", { name, mime: blob.type || "application/octet-stream", base64 });
		} catch (err) {
			console.warn("Sekai couldn't save that file", err);
		}
	}
	document.addEventListener(
		"click",
		(e) => {
			const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
			if (!a || !wantsSave(a)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			void save(a);
		},
		true,
	);
	// Links made in code and clicked without being added to the page don't reach the listener above.
	const click = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function () {
		if (!this.isConnected && this.href && wantsSave(this)) {
			void save(this);
			return;
		}
		return click.call(this);
	};

	send("ready");
})();
