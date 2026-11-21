import { createContext, type ReactNode, useContext } from "react";

/**
 * How settings pages are laid out: "compact" (the app's settings and panels) or "page" (full pages with a large
 * title and roomier sections, as Settings uses them).
 */
export type PageStyle = "compact" | "page";

const Ctx = createContext<PageStyle>("compact");

export function PageStyleProvider({ value, children }: { value: PageStyle; children: ReactNode }) {
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageStyle(): PageStyle {
	return useContext(Ctx);
}
