/** noVNC's RFB client (the parts Sekai uses). */
declare module "@novnc/novnc" {
	export default class RFB extends EventTarget {
		constructor(
			target: HTMLElement,
			url: string,
			options?: {
				credentials?: { password?: string; username?: string };
				wsProtocols?: string[];
				shared?: boolean;
			},
		);
		scaleViewport: boolean;
		resizeSession: boolean;
		viewOnly: boolean;
		focusOnClick: boolean;
		background: string;
		qualityLevel: number;
		compressionLevel: number;
		disconnect(): void;
		sendCtrlAltDel(): void;
		/** An X11 keysym; without down, a press and release. */
		sendKey(keysym: number, code: string | null, down?: boolean): void;
		clipViewport: boolean;
		blur(): void;
		sendCredentials(credentials: { password?: string }): void;
		focus(): void;
		clipboardPasteFrom(text: string): void;
	}
}
