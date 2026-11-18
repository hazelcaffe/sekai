/**
 * Builds the desktop app for this platform (or the ones you pass: --win --linux --mac) and copies the result to
 * your Sekai server's data folder, where installed apps find it and update themselves.
 *
 *   bun run --cwd apps/desktop publish:local            # this platform
 *   SEKAI_DATA_DIR=/path/to/data bun run … --win        # another server's data folder, Windows build
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const dataDir = resolve(process.env.SEKAI_DATA_DIR ?? join(root, "..", "..", "data"));
const out = join(dataDir, "desktop-releases");
const platforms = process.argv.slice(2).filter((a) => ["--win", "--linux", "--mac"].includes(a));

const build = Bun.spawn(["bun", "run", "scripts/build.ts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if ((await build.exited) !== 0) process.exit(1);
const pack = Bun.spawn(
	["bunx", "electron-builder", "--config", "electron-builder.yml", "--publish", "never", ...platforms],
	{
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	},
);
if ((await pack.exited) !== 0) process.exit(1);

mkdirSync(out, { recursive: true });
const release = join(root, "release");
let n = 0;
for (const f of readdirSync(release)) {
	if (/^latest.*\.yml$|\.(exe|dmg|zip|AppImage|deb|blockmap)$/.test(f)) {
		copyFileSync(join(release, f), join(out, f));
		n++;
	}
}
console.info(
	existsSync(out)
		? `copied ${n} files to ${out}: installed Sekai apps will update on their next check`
		: "nothing copied",
);
