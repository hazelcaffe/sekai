import { type Brand, presetBrand, useAgents, useModels, vendorBrand } from "@sekai/client";
import type { Avatar, UsageReport } from "@sekai/shared";
import { useMemo } from "react";
import { type ChartRow, guessVendor } from "./format.ts";

export type Stack = "model" | "agent";

/** One stacked band of the chart: a model or a bot (the rest fold into "other"). */
export interface Series {
	id: string;
	/** recharts reads dots in a dataKey as a path, and model ids have them: so s0, s1… */
	key: string;
	name: string;
	color: string;
	total: number;
}

/** Chart series colors from @sekai/ui (--series-1…8); "other" stays subtle grey. */
export const seriesColor = (index: number, id = "") =>
	id === "other" ? "var(--usage-other)" : `var(--series-${(index % 8) + 1})`;

export const REPLY = "var(--series-1)";
export const BACKGROUND = "var(--series-2)";

export interface Names {
	model: (id: string) => string;
	brand: (id: string) => Brand | null;
	avatar: (agentId: string | null) => Avatar | undefined;
}

/** Model names and logos (from the model list), and bots' avatars. */
export function useNames(): Names {
	const { data: models } = useModels();
	const { data: agents } = useAgents();
	return useMemo(() => {
		const info = (id: string) => models?.find((m) => m.id === id);
		return {
			model: (id) => (id === "other" ? "Other models" : (info(id)?.name ?? id.split("::").pop() ?? id)),
			brand: (id) => {
				const m = info(id);
				if (m?.byos) return presetBrand(m.byos.preset);
				if (id.includes("::")) return presetBrand(id.split("::")[0]);
				return vendorBrand(m?.provider) ?? vendorBrand(guessVendor(id));
			},
			avatar: (agentId) => (agentId ? agents?.find((a) => a.id === agentId)?.avatar : undefined),
		};
	}, [models, agents]);
}

/** What the main chart stacks, in the server's order (most used first), with each one's total. */
export function buildSeries(r: UsageReport, rows: ChartRow[], stack: Stack, names: Names): Series[] {
	const pick = (row: ChartRow) => (stack === "model" ? row.models : row.agents);
	const ids: { id: string; name: string }[] =
		stack === "model"
			? r.topModels.map((id) => ({ id, name: names.model(id) }))
			: r.topAgents.map((a) => ({ id: a.id, name: a.name }));
	if (rows.some((row) => pick(row).other)) {
		ids.push({ id: "other", name: stack === "model" ? "Other models" : "Other bots" });
	}
	return ids.map(({ id, name }, i) => ({
		id,
		key: `s${i}`,
		name,
		color: seriesColor(i, id),
		total: rows.reduce((n, row) => n + (pick(row)[id] ?? 0), 0),
	}));
}
