import { mkdir, readlink, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Provider } from "@sekai/shared";
import { acpEnv } from "./process.ts";

export const CODEX_JOB_MODE = "permission-profile:sekai-job";

/** A clean Codex config with just the subscription's sign-in. Its native commands get no files or network;
 * it calls the scoped workspace server for work instead. Never import the owner's plugins, hooks or servers. */
export async function codexJobProvider(provider: Provider, control: string): Promise<Provider> {
	const env = acpEnv(provider);
	const home = join(control, "codex");
	await mkdir(home, { recursive: true, mode: 0o700 });
	const auth = resolve(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"), "auth.json");
	const link = join(home, "auth.json");
	const old = await readlink(link).catch(() => null);
	if (old !== auth) {
		if (old) throw new Error("The subscription’s sign-in folder changed. Start a new job.");
		await symlink(auth, link);
	}
	const config = {
		default_permissions: "sekai-job",
		permissions: { "sekai-job": { filesystem: { ":root": "deny" }, network: { enabled: false } } },
		approval_policy: "never",
		web_search: "disabled",
		shell_environment_policy: { inherit: "none" },
		features: {
			shell_tool: false,
			unified_exec: false,
			apply_patch_freeform: false,
			view_image: false,
			apps: false,
			plugins: false,
			hooks: false,
			browser_use: false,
			computer_use: false,
			multi_agent: false,
			js_repl: false,
			request_permissions: false,
		},
	};
	return {
		...provider,
		env: {
			...provider.env,
			CODEX_HOME: home,
			CODEX_CONFIG: JSON.stringify(config),
			INITIAL_AGENT_MODE: CODEX_JOB_MODE,
		},
	};
}
