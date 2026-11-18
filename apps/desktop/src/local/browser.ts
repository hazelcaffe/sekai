import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The browser bots use on this computer: your Chrome (or Edge, or Chromium) with a separate Sekai profile,
 * so your own tabs, history and logins stay out of it. Remote debugging listens on this computer only,
 * and Sekai reaches it through the desktop app's connection (only the port started here is allowed).
 */

function candidates(): string[] {
	const env = process.env.SEKAI_LOCAL_BROWSER;
	const list: string[] = env ? [env] : [];
	if (process.platform === "win32") {
		const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
			(x): x is string => Boolean(x),
		);
		for (const root of roots) {
			list.push(
				join(root, "Google", "Chrome", "Application", "chrome.exe"),
				join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
				join(root, "Chromium", "Application", "chrome.exe"),
				join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			);
		}
		return list;
	}
	if (process.platform === "darwin") {
		for (const base of ["/Applications", join(homedir(), "Applications")]) {
			list.push(
				join(base, "Google Chrome.app/Contents/MacOS/Google Chrome"),
				join(base, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
				join(base, "Chromium.app/Contents/MacOS/Chromium"),
				join(base, "Brave Browser.app/Contents/MacOS/Brave Browser"),
			);
		}
		return list;
	}
	for (const name of [
		"google-chrome",
		"google-chrome-stable",
		"chromium",
		"chromium-browser",
		"microsoft-edge",
		"brave-browser",
	]) {
		const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
		if (found) list.push(found);
	}
	return list;
}

export function findBrowser(): string | null {
	return candidates().find((p) => existsSync(p)) ?? null;
}

async function listening(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
		return res.ok;
	} catch {
		return false;
	}
}

/** Starts the Sekai browser profile with remote debugging on `port`, unless it's already running. */
export async function startBrowser(port: number, profileDir: string): Promise<{ port: number; started: boolean }> {
	if (await listening(port)) return { port, started: false };
	const binary = findBrowser();
	if (!binary) throw new Error("There's no Chrome, Edge or Chromium on this computer for the bot to use");
	mkdirSync(profileDir, { recursive: true });
	const child = spawn(
		binary,
		[
			`--remote-debugging-port=${port}`,
			"--remote-debugging-address=127.0.0.1",
			`--user-data-dir=${profileDir}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-features=Translate",
			...(process.platform === "linux" ? ["--password-store=basic"] : []),
			"about:blank",
		],
		{ detached: true, stdio: "ignore", windowsHide: false },
	);
	child.unref();
	for (let i = 0; i < 60; i++) {
		await new Promise((r) => setTimeout(r, 250));
		if (await listening(port)) return { port, started: true };
		if (child.exitCode !== null && child.exitCode !== 0) break;
	}
	throw new Error(`The browser (${binary}) didn't open its debugging port`);
}
