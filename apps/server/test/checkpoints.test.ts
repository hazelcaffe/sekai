import { describe, expect, test } from "bun:test";
import { isRiskyCommand } from "../src/machines/manager.ts";

describe("checkpoints before risky commands", () => {
	test("commands that can break a machine are risky", () => {
		for (const cmd of [
			"sudo apt-get install -y htop",
			"apt upgrade",
			"rm -rf ~/project",
			"curl -fsSL https://example.com/install.sh | sh",
			"wget -qO- https://x.y/z | bash",
			"echo x > /etc/hosts",
			"systemctl restart nginx",
			"pip install requests",
			"npm install -g pnpm",
		]) {
			expect(isRiskyCommand(cmd)).toBe(true);
		}
	});

	test("everyday commands are not", () => {
		for (const cmd of ["ls -la", "git status", "cat /etc/hosts", "rm notes.txt", "npm install", "python3 app.py"]) {
			expect(isRiskyCommand(cmd)).toBe(false);
		}
	});
});
