import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.SEKAI_API ?? `http://127.0.0.1:${process.env.SEKAI_PORT ?? 7420}`;

// The admin app lives at /admin on the Sekai server. In development the web app's dev server forwards /admin here.
export default defineConfig({
	base: "/admin/",
	plugins: [react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query", "sonner"] },
	server: {
		host: true,
		port: 5174,
		strictPort: true,
		proxy: { "/api": { target: apiTarget, changeOrigin: false } },
	},
	preview: { host: true, port: 4174, proxy: { "/api": { target: apiTarget } } },
	build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 2000 },
});
