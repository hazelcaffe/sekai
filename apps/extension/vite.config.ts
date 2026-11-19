import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom"] },
	build: {
		outDir: `dist/${process.env.SEKAI_EXTENSION_TARGET ?? "chromium"}`,
		sourcemap: false,
		rollupOptions: { input: "panel.html" },
	},
});
