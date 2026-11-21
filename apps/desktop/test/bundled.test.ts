import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isBundledUrl } from "../src/bundled.ts";

const dist = "/opt/Sekai/resources/app.asar/dist";
const url = (path: string) => pathToFileURL(path).href;

describe("bundled screens", () => {
	test("the app's own connect and about screens", () => {
		expect(isBundledUrl(url(join(dist, "connect.html")), dist)).toBe(true);
		expect(isBundledUrl(`${url(join(dist, "about.html"))}#x`, dist)).toBe(true);
	});

	test("not other file:// pages, look-alikes or web pages", () => {
		for (const u of [
			url("/home/someone/Downloads/connect.html"),
			url(join(dist, "tokens.css")),
			url(join(dist, "../dist/../evil/connect.html")),
			url(`${dist}-evil/connect.html`),
			"file://evil.example/opt/Sekai/resources/app.asar/dist/connect.html",
			"https://sekai.example.com/connect.html",
			"data:text/html,<p>hi</p>",
			"",
			undefined,
		]) {
			expect(isBundledUrl(u, dist)).toBe(false);
		}
	});
});
