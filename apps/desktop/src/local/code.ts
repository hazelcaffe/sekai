import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { resolvePath } from "./exec.ts";

/**
 * Source files for Sekai's code index, read on this computer (the same rules as the server's scan.py):
 * git's file list when it's a repo, generated folders and binaries skipped, contents hashed so only
 * changes get re-indexed.
 */

const run = promisify(execFile);
const MAX_FILE = 400_000;
const MAX_FILES = 20_000;
const SKIP_DIRS = new Set(
	".git node_modules dist build out target vendor .venv venv __pycache__ .next .nuxt .svelte-kit .turbo .cache coverage .gradle .idea .vscode bower_components Pods .terraform .mypy_cache .pytest_cache .tox release".split(
		" ",
	),
);
const SKIP_EXT =
	/\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff|psd|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|o|a|obj|wasm|pyc|mp3|mp4|mov|wav|ogg|webm|woff2?|ttf|otf|eot|lock|map|db|sqlite|parquet|pkl|pt|onnx|npy|min\.js|min\.css)$/i;
const SKIP_NAMES = new Set(
	"package-lock.json yarn.lock pnpm-lock.yaml bun.lock bun.lockb Cargo.lock poetry.lock composer.lock go.sum".split(
		" ",
	),
);

async function listFiles(root: string): Promise<{ git: boolean; paths: string[] }> {
	try {
		const { stdout } = await run("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], {
			maxBuffer: 64 * 1024 * 1024,
			timeout: 60_000,
			windowsHide: true,
		});
		return { git: true, paths: stdout.split("\0").filter(Boolean) };
	} catch {
		const paths: string[] = [];
		const walk = async (dir: string) => {
			if (paths.length > MAX_FILES * 2) return;
			for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
				if (e.isDirectory()) {
					if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(join(dir, e.name));
				} else if (e.isFile()) {
					paths.push(relative(root, join(dir, e.name)).split(sep).join("/"));
				}
			}
		};
		await walk(root);
		return { git: false, paths };
	}
}

function isText(data: Buffer): boolean {
	const sample = data.subarray(0, 8192);
	if (sample.includes(0)) return false;
	if (sample.length === 0) return true;
	const lines = sample.toString("latin1").split("\n");
	return sample.length / Math.max(1, lines.length) < 400;
}

async function rootOf(path: string, workdir: string): Promise<string> {
	const root = await realpath(resolvePath(path, workdir)).catch(() => null);
	if (!root || !(await stat(root)).isDirectory()) throw new Error(`${path} isn't a folder`);
	return root;
}

export async function codeScan(path: string, workdir: string) {
	const root = await rootOf(path, workdir);
	const { git, paths } = await listFiles(root);
	const files: [string, number, string][] = [];
	let skipped = 0;
	for (const p of paths) {
		const parts = p.split("/");
		if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d)) || SKIP_NAMES.has(basename(p)) || SKIP_EXT.test(p)) {
			skipped++;
			continue;
		}
		const full = join(root, p);
		const info = await stat(full).catch(() => null);
		if (!info?.isFile()) continue;
		if (info.size === 0 || info.size > MAX_FILE) {
			skipped++;
			continue;
		}
		const data = await readFile(full).catch(() => null);
		if (!data) continue;
		if (!isText(data)) {
			skipped++;
			continue;
		}
		files.push([p, info.size, createHash("sha1").update(data).digest("hex")]);
		if (files.length >= MAX_FILES) break;
	}
	return { root, git, files, skipped };
}

export async function codeRead(path: string, paths: string[], workdir: string) {
	const root = await rootOf(path, workdir);
	const out: Record<string, string | null> = {};
	for (const p of paths) {
		const full = resolve(root, p);
		if (!full.startsWith(root + sep)) {
			out[p] = null;
			continue;
		}
		const data = await readFile(full).catch(() => null);
		out[p] = data ? data.subarray(0, MAX_FILE).toString("utf8") : null;
	}
	return out;
}
