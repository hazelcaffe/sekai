/** Bundles the main and preload scripts to CommonJS for Electron, and generates/copies static assets. */
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extractDesktopTokensCss, extractWindowBackgrounds } from "./tokens.ts";

const root = join(import.meta.dir, "..");
const repoRoot = join(root, "../..");
const out = join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Extract the real @sekai/ui design tokens so Electron's own screens never drift or hand-copy hex values.
const uiStylesPath = join(repoRoot, "packages/ui/src/styles/index.css");
const uiStylesCss = await readFile(uiStylesPath, "utf8");
const windowBg = extractWindowBackgrounds(uiStylesCss);

// Bundle Inter Variable (latin + latin-ext) alongside tokens.css for crisp offline typography, from wherever the
// package manager put @sekai/ui's copy.
const fontDir = join(
	dirname(Bun.resolveSync("@fontsource-variable/inter/package.json", join(repoRoot, "packages/ui"))),
	"files",
);
const fontFaces: string[] = [];
const fontFiles: [string, string][] = [
	[
		"inter-latin-ext-wght-normal.woff2",
		"U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
	],
	[
		"inter-latin-wght-normal.woff2",
		"U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
	],
];
for (const [file, unicodeRange] of fontFiles) {
	const src = join(fontDir, file);
	if (!existsSync(src)) {
		console.warn(`Inter isn't at ${src}; the desktop screens fall back to the system font.`);
		continue;
	}
	await mkdir(join(out, "fonts"), { recursive: true });
	await cp(src, join(out, "fonts", file));
	fontFaces.push(
		`@font-face {\n\tfont-family: "Inter Variable";\n\tfont-style: normal;\n\tfont-display: swap;\n\tfont-weight: 100 900;\n\tsrc: url("./fonts/${file}") format("woff2-variations");\n\tunicode-range: ${unicodeRange};\n}`,
	);
}

const tokensCss = extractDesktopTokensCss(uiStylesCss, fontFaces.join("\n"));
await writeFile(join(out, "tokens.css"), tokensCss, "utf8");

const result = await Bun.build({
	entrypoints: [join(root, "src/main.ts"), join(root, "src/preload.ts")],
	outdir: out,
	target: "node",
	format: "cjs",
	naming: "[name].cjs",
	external: ["electron"],
	sourcemap: "linked",
	minify: false,
	define: {
		__SEKAI_BG_LIGHT__: JSON.stringify(windowBg.light),
		__SEKAI_BG_DARK__: JSON.stringify(windowBg.dark),
	},
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await cp(join(root, "src/connect.html"), join(out, "connect.html"));
await cp(join(root, "src/about.html"), join(out, "about.html"));
await cp(join(root, "build/icon.png"), join(out, "icon.png"));
await cp(join(root, "build/tray.png"), join(out, "tray.png"));
console.info(`built ${result.outputs.length} files into dist/ (plus tokens.css, connect.html, about.html)`);
