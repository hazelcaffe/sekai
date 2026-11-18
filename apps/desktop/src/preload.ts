import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

/**
 * The only bridge between the web app and the desktop shell. Everything goes through a small set of IPC
 * channels; the renderer never gets Node.js or Electron APIs.
 */
const serverUrl = ipcRenderer.sendSync("sekai:server-url-sync") as string;
const version = ipcRenderer.sendSync("sekai:version-sync") as string;

contextBridge.exposeInMainWorld("sekaiDesktop", {
	platform: process.platform,
	version,
	serverUrl,
	notify: (title: string, body: string, data: { conversationId?: string | null }) =>
		ipcRenderer.send("sekai:notify", {
			title: String(title),
			body: String(body),
			conversationId: data?.conversationId ?? null,
		}),
	setBadge: (count: number) => ipcRenderer.send("sekai:badge", Number(count) || 0),
	onNavigate: (callback: (path: string) => void) => {
		const listener = (_e: IpcRendererEvent, path: string) => callback(path);
		ipcRenderer.on("sekai:navigate", listener);
		return () => ipcRenderer.removeListener("sekai:navigate", listener);
	},
	openSettings: () => ipcRenderer.send("sekai:open-connect"),
	/** Lending this computer to bots. Widening access asks you in a native dialog the page can't answer. */
	localComputer: {
		get: () => ipcRenderer.invoke("sekai:local-get"),
		set: (patch: unknown, token: string | null | undefined, names: Record<string, string>) =>
			ipcRenderer.invoke("sekai:local-set", patch, token, names),
		onChange: (callback: (info: unknown) => void) => {
			const listener = (_e: IpcRendererEvent, info: unknown) => callback(info);
			ipcRenderer.on("sekai:local-status", listener);
			return () => ipcRenderer.removeListener("sekai:local-status", listener);
		},
	},
});

/** Only the bundled connect screen (a file:// page) can switch servers; the server's own pages can't. */
if (location.protocol === "file:") {
	contextBridge.exposeInMainWorld("sekaiConnect", {
		getServerUrl: () => serverUrl,
		connect: (url: string) =>
			ipcRenderer.invoke("sekai:connect", String(url)) as Promise<{ ok: boolean; error?: string }>,
	});
}
