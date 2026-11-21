/**
 * bun run dev: starts Postgres (Docker), the API server (watch mode) and the web app's Vite dev server together. Open
 * the web app's address.
 *   --no-db   skip `docker compose up -d db`
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const colors = { db: "\x1b[35m", api: "\x1b[36m", web: "\x1b[33m" } as const;
const reset = "\x1b[0m";

function prefix(name: keyof typeof colors, stream: ReadableStream<Uint8Array>): void {
	const decoder = new TextDecoder();
	let buffer = "";
	void (async () => {
		for await (const chunk of stream) {
			buffer += decoder.decode(chunk, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) process.stdout.write(`${colors[name]}${name.padEnd(3)}${reset} │ ${line}\n`);
		}
	})();
}

// The service (bun run service:install) already serves port 7420 against the same database: two servers would
// both run routines, answer Discord and push notifications.
const service = Bun.spawnSync(["systemctl", "--user", "is-active", "--quiet", "sekai"]);
if (service.exitCode === 0) {
	console.error(
		"Sekai is running as a service. Stop it first (systemctl --user stop sekai), and start it again when you're done (systemctl --user start sekai).",
	);
	process.exit(1);
}

if (!args.has("--no-db")) {
	const db = Bun.spawn(["docker", "compose", "up", "-d", "db", "--wait"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	prefix("db", db.stdout);
	prefix("db", db.stderr);
	if ((await db.exited) !== 0) {
		console.error(
			"Couldn't start Postgres with Docker. Start it yourself, or pass --no-db if DATABASE_URL points elsewhere.",
		);
		process.exit(1);
	}
}

const procs = [
	{ name: "api" as const, cmd: ["bun", "--watch", "run", "src/index.ts"], cwd: join(root, "apps/server") },
	{ name: "web" as const, cmd: ["bunx", "--bun", "vite"], cwd: join(root, "apps/web") },
].map(({ name, cmd, cwd }) => {
	const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "1" } });
	prefix(name, p.stdout);
	prefix(name, p.stderr);
	return p;
});

const stop = () => {
	for (const p of procs) p.kill();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
