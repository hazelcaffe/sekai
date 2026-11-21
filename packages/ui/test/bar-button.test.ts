import { expect, test } from "bun:test";
import { createElement } from "react";
import { splitLabel } from "../src/shadcn/button.tsx";

const Icon = () => null;

test("a bar button keeps its icon and turns its words into its name", () => {
	const parts = splitLabel([createElement(Icon, { key: "i" }), " Add someone"]);
	expect(parts.icon).toHaveLength(1);
	expect(parts.text).toBe("Add someone");
});

test("words alone stay words; markup isn't mistaken for an icon", () => {
	expect(splitLabel("Done")).toEqual({ icon: [], text: "Done" });
	expect(splitLabel([createElement("span", { key: "s" }, "Edit"), false, null]).icon).toHaveLength(0);
	expect(splitLabel(createElement("svg")).icon).toHaveLength(1);
});
