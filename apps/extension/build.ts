import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type ExtensionTarget, extensionManifest } from "./manifests.ts";

for (const target of ["chromium", "firefox", "safari"] satisfies ExtensionTarget[]) {
	const build = Bun.spawn(["bun", "x", "--no-install", "vite", "build"], {
		cwd: import.meta.dir,
		env: { ...process.env, SEKAI_EXTENSION_TARGET: target },
		stdout: "inherit",
		stderr: "inherit",
	});
	if (await build.exited) throw new Error(`Couldn't build the ${target} panel.`);
	const dir = join(import.meta.dir, "dist", target);
	await mkdir(dir, { recursive: true });
	const background = await Bun.build({
		entrypoints: [join(import.meta.dir, "src/background.ts")],
		target: "browser",
		minify: true,
	});
	if (!background.success || !background.outputs[0]) throw new Error("Couldn't build the background script.");
	await Bun.write(join(dir, "background.js"), background.outputs[0]);
	await Bun.write(join(dir, "manifest.json"), `${JSON.stringify(extensionManifest(target), null, "\t")}\n`);
	await copyFile(join(import.meta.dir, "../web/public/icon-192.png"), join(dir, "icon.png"));
}
