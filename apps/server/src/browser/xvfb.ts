import { type Subprocess, spawn } from "bun";
import { log } from "../lib/log.ts";

/**
 * One shared virtual display for the bots' server browsers, so the server can run a real, headed
 * browser (which looks like a person's browser, not a headless one) without a monitor. Started
 * lazily on the first server browser, restarted if it dies; nothing starts when no bot browses on
 * the server. No-ops off Linux (Windows and macOS bots already browse on their own computers).
 */

const DISPLAY = ":91";
let proc: Subprocess | null = null;
let ready: Promise<string | null> | null = null;

/** Whether this server can show a headed browser on a virtual display. */
export function xvfbAvailable(): boolean {
	return process.platform === "linux" && Bun.which("Xvfb") !== null;
}

async function waitForDisplay(): Promise<boolean> {
	for (let i = 0; i < 50; i++) {
		const probe = Bun.spawnSync(["xdpyinfo", "-display", DISPLAY], { stdout: "ignore", stderr: "ignore" });
		if (probe.exitCode === 0) return true;
		if (proc && proc.exitCode !== null) return false;
		await Bun.sleep(100);
	}
	return false;
}

/** The DISPLAY for server browsers, or null when a virtual display can't be had (browsers stay headless then). */
export async function xvfbDisplay(): Promise<string | null> {
	if (!xvfbAvailable()) return null;
	if (proc && proc.exitCode === null) return DISPLAY;
	if (!ready) {
		ready = (async () => {
			proc = spawn(["Xvfb", DISPLAY, "-screen", "0", "1366x900x24", "-nolisten", "tcp", "-noreset"], {
				stdout: "ignore",
				stderr: "ignore",
			});
			proc.exited.then(() => {
				proc = null;
				ready = null;
			});
			if (await waitForDisplay()) {
				log.info(`browser: virtual display on ${DISPLAY}`);
				return DISPLAY;
			}
			log.warn("browser: Xvfb didn't start; server browsers will run headless");
			stopXvfb();
			return null;
		})();
	}
	return ready;
}

export function stopXvfb(): void {
	try {
		proc?.kill();
	} catch {}
	proc = null;
	ready = null;
}
