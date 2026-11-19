import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { version } from "./package.json";

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Use an X.Y.Z extension version before packaging.");

const out = join(import.meta.dir, "release");
await mkdir(out, { recursive: true });
const hashes: string[] = [];
for (const target of ["chromium", "firefox", "safari"]) {
	const dir = join(import.meta.dir, "dist", target);
	const manifest = (await Bun.file(join(dir, "manifest.json")).json()) as { version: string };
	if (manifest.version !== version) throw new Error("Rebuild the extension: manifest and package versions differ.");
	const name = `sekai-${target}${target === "safari" ? "-webextension-source" : ""}-${version}.zip`;
	const files: Record<string, Uint8Array> = {};
	const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true }));
	for (const path of paths.sort()) files[path] = await Bun.file(join(dir, path)).bytes();
	files["INSTALL.md"] = await Bun.file(join(import.meta.dir, "RELEASE.md")).bytes();
	files.LICENSE = await Bun.file(join(import.meta.dir, "../../LICENSE")).bytes();
	await Bun.write(join(out, name), zipSync(files, { level: 9, mtime: new Date("2020-01-01T00:00:00Z") }));
	hashes.push(
		`${createHash("sha256")
			.update(await Bun.file(join(out, name)).bytes())
			.digest("hex")}  ${name}`,
	);
}
const nativeName = `sekai-safari-macos-unsigned-${version}.zip`;
const native = Bun.file(join(out, nativeName));
if (await native.exists())
	hashes.push(
		`${createHash("sha256")
			.update(await native.bytes())
			.digest("hex")}  ${nativeName}`,
	);
await Bun.write(join(out, "SHA256SUMS.txt"), `${hashes.join("\n")}\n`);
