import { z } from "zod";
import { patchOf } from "./patch.ts";

/**
 * Web reading: Firecrawl Local (https://github.com/firecrawl/firecrawl), one binary that turns pages into clean
 * Markdown, reads PDFs and Office files, follows links through a site and lists its pages. Sekai can run it
 * itself on this server, or use one that already runs somewhere else. Scraping stays on the machine; only
 * search (and, if you let it, a page this server is refused) goes to Firecrawl's cloud.
 */

export const WEB_ENGINE_MODES = ["off", "here", "elsewhere"] as const;
export type WebEngineMode = (typeof WEB_ENGINE_MODES)[number];

/** What may leave the machine: nothing, searches only, or searches plus pages this server can't load. */
export const WEB_CLOUD_MODES = ["off", "search", "auto"] as const;
export type WebCloudMode = (typeof WEB_CLOUD_MODES)[number];

export const WebEngineSettings = z.object({
	mode: z.enum(WEB_ENGINE_MODES).default("off"),
	/** "here": the loopback port Sekai starts it on. 0 (the default) means a free one Sekai picks. */
	port: z.number().int().min(0).max(65535).default(0),
	/** "elsewhere": where it answers, e.g. http://192.168.1.9:3002. */
	url: z.string().max(300).default(""),
	/** "elsewhere": the token it was started with (--token), when it has one. */
	token: z.string().max(400).default(""),
	/** When it may use this server's Chrome for pages that need JavaScript. */
	browser: z.enum(["auto", "never", "always"]).default("auto"),
	cloud: z.enum(WEB_CLOUD_MODES).default("search"),
	/** A Firecrawl key for the cloud part. Optional: search works without one, with low limits. */
	apiKey: z.string().max(400).default(""),
	/** Let bots follow links through a site and list its pages (web_crawl, web_map). */
	crawl: z.boolean().default(true),
});
export type WebEngineSettings = z.infer<typeof WebEngineSettings>;

export const WebEngineSettingsUpdate = patchOf(WebEngineSettings);
export type WebEngineSettingsUpdate = z.infer<typeof WebEngineSettingsUpdate>;

/**
 * - off: nobody turned it on
 * - missing: on, but Firecrawl Local isn't installed on this server
 * - installing: Sekai is installing it (cargo install firecrawl-local)
 * - starting: starting up, or being checked
 * - ready: answering; bots can use it
 * - error: it stopped or can't be reached (see `error`)
 */
export type WebEngineState = "off" | "missing" | "installing" | "starting" | "ready" | "error";

export interface WebEngineStatus {
	/** The saved settings, with the key and token masked. */
	settings: WebEngineSettings;
	state: WebEngineState;
	error: string | null;
	/** Where it's answering ("here": its loopback address). */
	url: string | null;
	/** Firecrawl Local's version, as the engine reports it. */
	version: string | null;
	/** The binary Sekai runs ("here"), or null when it isn't installed. */
	binary: string | null;
	/** Sekai can install it here (Rust's cargo is on this server). */
	canInstall: boolean;
	/** Search works (it goes to Firecrawl's cloud, so it needs `cloud` to be on). */
	search: boolean;
	/** Whether bots get web_crawl and web_map. */
	crawl: boolean;
	startedAt: number | null;
}

/**
 * "Set it up for me": a model installs Firecrawl Local on this server by running commands here (Rust, the build
 * tools it needs, then `cargo install firecrawl-local`), within limits Sekai checks itself, and turns it on.
 * - running: at work; done: it's installed and answering; failed: it couldn't; stopped: you stopped it.
 */
export type WebSetupState = "idle" | "running" | "done" | "failed" | "stopped";

export interface WebSetupStep {
	id: number;
	/** command: something it ran. note: what it said between commands. */
	kind: "command" | "note";
	/** Why it runs the command, or the note itself. */
	text: string;
	command: string | null;
	/** The end of what the command printed. */
	output: string;
	exitCode: number | null;
	running: boolean;
	/** Sekai didn't run it, and why. */
	refused: string | null;
	startedAt: number;
	finishedAt: number | null;
}

export interface WebSetup {
	state: WebSetupState;
	/** The model doing it. */
	model: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	steps: WebSetupStep[];
	/** Its last word: what it did, or why it couldn't. */
	summary: string | null;
}

/** What Admin's "Try a page" gets back. */
export interface WebEngineCheck {
	url: string;
	title: string;
	/** The first lines of the Markdown it made. */
	preview: string;
	/** "local" when this machine fetched it, "firecrawl-cloud" when the cloud did. */
	source: string;
	ms: number;
}
