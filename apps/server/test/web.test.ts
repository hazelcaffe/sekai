import { describe, expect, test } from "bun:test";
import { WebEngineSettings } from "@sekai/shared";
import { crawlText, pageText } from "../src/agent/tools/web.ts";
import { agentEnv } from "../src/providers/process.ts";
import {
	binaryCandidates,
	engineArgs,
	engineEnv,
	engineError,
	reachReason,
	type ScrapeResult,
	toScrapeResult,
} from "../src/web/engine.ts";
import { publicWebSettings } from "../src/web/settings.ts";

const settings = (patch: Partial<WebEngineSettings> = {}) => WebEngineSettings.parse(patch);

const page = (patch: Partial<ScrapeResult> = {}): ScrapeResult => ({
	url: "https://example.com/a",
	title: "A page",
	markdown: "Hello.",
	source: "local",
	blocked: false,
	warning: null,
	links: [],
	statusCode: 200,
	...patch,
});

describe("web engine settings", () => {
	test("off by default, and new fields are filled in for settings saved before them", () => {
		expect(settings().mode).toBe("off");
		// Port 0: Sekai picks a free one, so nothing else on the machine can take it.
		expect(settings({ mode: "here" })).toMatchObject({ port: 0, browser: "auto", cloud: "search", crawl: true });
	});

	test("the key and the token are masked for the app, with their last four characters", () => {
		const open = settings({ mode: "elsewhere", apiKey: "fc-abcdefghijkl", token: "secret-token" });
		const shown = publicWebSettings(open);
		expect(shown.apiKey).toBe("••••••••ijkl");
		expect(shown.token).toBe("••••••••oken");
		expect(shown.apiKey).not.toContain("abcdef");
		expect(publicWebSettings(settings()).apiKey).toBe("");
	});
});

describe("how the engine is started", () => {
	test("loopback only, the port that was picked and the browser setting; the token isn't on the command line", () => {
		const args = engineArgs(settings({ mode: "here", browser: "always" }), 3999);
		expect(args).toEqual(["serve", "--host", "127.0.0.1", "--port", "3999", "--browser", "always"]);
		// Never --allow-private: the engine itself refuses this server and your own network.
		expect(args).not.toContain("--allow-private");
		// Other users of the machine can read a command line, but not another user's environment.
		expect(args.join(" ")).not.toContain("tok");
		expect(engineEnv(settings({ mode: "here" }), "/data", null, "tok").FIRECRAWL_LOCAL_TOKEN).toBe("tok");
	});

	test("this machine's own Firecrawl settings never reach the engine", () => {
		const saved = { ...process.env };
		process.env.FIRECRAWL_LOCAL_ALLOW_PRIVATE = "1";
		process.env.FIRECRAWL_API_KEY = "fc-someone-elses";
		process.env.FIRECRAWL_API_URL = "https://elsewhere.example";
		try {
			const env = agentEnv(engineEnv(settings({ mode: "here" }), "/data", null, "tok"));
			expect(env.FIRECRAWL_LOCAL_ALLOW_PRIVATE).toBeUndefined();
			expect(env.FIRECRAWL_API_KEY).toBeUndefined();
			expect(env.FIRECRAWL_API_URL).toBeUndefined();
			expect(env.FIRECRAWL_LOCAL_TOKEN).toBe("tok");
		} finally {
			process.env = saved;
		}
	});

	test("its folder stays in Sekai's data, and the cloud setting and key are passed through", () => {
		const env = agentEnv(engineEnv(settings({ mode: "here", cloud: "off" }), "/data", null, "t"));
		expect(env.FIRECRAWL_CLOUD).toBe("off");
		expect(env.FIRECRAWL_LOCAL_HOME).toBe("/data/firecrawl");
		// A login made on this machine must not be picked up by surprise.
		expect(env.FIRECRAWL_CLI_CREDENTIALS).toBe("/data/firecrawl/credentials.json");
		expect(env.FIRECRAWL_API_KEY).toBeUndefined();
		expect(env.FIRECRAWL_CHROME_PATH).toBeUndefined();
		const withKey = engineEnv(settings({ cloud: "auto", apiKey: "fc-k" }), "/data", "/usr/bin/chromium", "t");
		expect(withKey).toMatchObject({ FIRECRAWL_API_KEY: "fc-k", FIRECRAWL_CHROME_PATH: "/usr/bin/chromium" });
	});

	test("the binary is looked for where cargo puts it", () => {
		expect(binaryCandidates("/home/x")).toContain("/home/x/.cargo/bin/firecrawl-local");
	});
});

describe("what comes back", () => {
	test("a Firecrawl document becomes a page, with the address it really came from", () => {
		const result = toScrapeResult(
			{
				markdown: "  # Title\n\nBody.  ",
				metadata: {
					title: " Example ",
					sourceURL: "https://example.com/asked",
					url: "https://example.com/real",
					statusCode: 200,
				},
				source: "firecrawl-cloud",
			},
			"https://example.com/asked",
		);
		expect(result).toMatchObject({
			url: "https://example.com/real",
			title: "Example",
			markdown: "# Title\n\nBody.",
			source: "firecrawl-cloud",
			blocked: false,
		});
		// Nothing at all: the requested address, no crash.
		expect(toScrapeResult({}, "https://x.example")).toMatchObject({ url: "https://x.example", source: "local" });
	});

	test("an error says what the engine said", () => {
		expect(engineError(502, { error: "example.com refused" })).toBe("example.com refused");
		expect(engineError(500, null)).toBe("the engine answered 500");
	});

	test("a machine that can't be reached is explained in plain words", () => {
		expect(reachReason("ECONNREFUSED: Unable to connect. Is the computer able to access the url?")).toBe(
			"nothing is listening there",
		);
		expect(reachReason("getaddrinfo ENOTFOUND engine.lan")).toBe("that name doesn't resolve");
		expect(reachReason("The operation timed out.")).toBe("it didn't answer in time");
		// Anything else is passed through: the engine's own messages are already plain.
		expect(reachReason("Missing or wrong token.")).toBe("Missing or wrong token.");
	});
});

describe("what the model reads", () => {
	test("a page comes with its title and address", () => {
		expect(pageText(page(), 100)).toBe("## A page\nhttps://example.com/a\n\nHello.");
		expect(pageText(page({ blocked: true, warning: "It wants a human." }), 100)).toContain("It wants a human.");
	});

	test("a crawl fits in a budget and says how many pages were left out", () => {
		const pages = Array.from({ length: 6 }, (_, i) =>
			page({ url: `https://example.com/${i}`, title: `Page ${i}`, markdown: "x".repeat(900) }),
		);
		const text = crawlText(pages, 2_000);
		expect(text).toContain("Page 0");
		expect(text).toContain("more pages left out");
		expect(text.length).toBeLessThan(3_000);
		expect(crawlText(pages.slice(0, 1), 10_000)).not.toContain("left out");
	});
});

describe("the engine's environment", () => {
	test("a third-party binary never sees Sekai's own secrets", () => {
		process.env.DATABASE_URL = "postgres://secret@db/sekai";
		process.env.GATEWAY_API_KEY = "gw-secret";
		const env = agentEnv(engineEnv(settings({ mode: "here", apiKey: "fc-k" }), "/data", null, "t"));
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.GATEWAY_API_KEY).toBeUndefined();
		expect(env.FIRECRAWL_API_KEY).toBe("fc-k");
		expect(env.PATH).toBeDefined();
	});
});
