/** Bundles the main and preload scripts to CommonJS for Electron, and copies static assets. */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await Bun.build({
	entrypoints: [join(root, "src/main.ts"), join(root, "src/preload.ts")],
	outdir: out,
	target: "node",
	format: "cjs",
	naming: "[name].cjs",
	external: ["electron"],
	sourcemap: "linked",
	minify: false,
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await cp(join(root, "src/connect.html"), join(out, "connect.html"));
await cp(join(root, "build/icon.png"), join(out, "icon.png"));
await cp(join(root, "build/tray.png"), join(out, "tray.png"));
console.info(`built ${result.outputs.length} files into dist/`);
