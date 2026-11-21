import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.SEKAI_EXTENSION_TARGET ?? "chromium";

export default defineConfig({
	base: "./",
	define: { "import.meta.env.SEKAI_EXTENSION_TARGET": JSON.stringify(target) },
	plugins: [react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom"] },
	build: {
		outDir: `dist/${target}`,
		sourcemap: false,
		rollupOptions: { input: "panel.html" },
	},
});
