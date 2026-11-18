import { describe, expect, test } from "bun:test";
import { checkManifest, insertOrder } from "../src/backups/archive.ts";

describe("backups", () => {
	test("tables are restored after the ones they reference", () => {
		const order = insertOrder(
			["messages", "conversations", "agents", "routine_runs", "routines", "settings"],
			[
				{ child: "messages", parent: "conversations" },
				{ child: "conversations", parent: "agents" },
				{ child: "routines", parent: "agents" },
				{ child: "routines", parent: "conversations" },
				{ child: "routine_runs", parent: "routines" },
				{ child: "agents", parent: "agents" }, // a table referencing itself doesn't loop
				{ child: "notes", parent: "agents" }, // tables that aren't there are ignored
			],
		);
		expect(order).toHaveLength(6);
		const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
		before("agents", "conversations");
		before("conversations", "messages");
		before("conversations", "routines");
		before("routines", "routine_runs");
	});

	test("only Sekai backups this version can read get through", () => {
		expect(() => checkManifest({ hello: 1 })).toThrow("isn't a Sekai backup");
		expect(() => checkManifest({ format: "sekai-backup", version: 2, tables: {} })).toThrow("newer version");
		expect(() =>
			checkManifest({ format: "sekai-backup", version: 1, tables: { "users; drop": { columns: [] } } }),
		).toThrow("damaged");
		expect(
			checkManifest({ format: "sekai-backup", version: 1, tables: { users: { rows: 1, columns: ["id"] } } })
				.version,
		).toBe(1);
	});
});
