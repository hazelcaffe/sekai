import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.SEKAI_API ?? `http://127.0.0.1:${process.env.SEKAI_PORT ?? 7420}`;

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query", "sonner"] },
	server: {
		// Listen on all interfaces so phones and tablets on the LAN/Tailscale can open the dev server.
		host: true,
		port: 5173,
		proxy: {
			"/api": { target: apiTarget, changeOrigin: false },
			// The admin app's dev server (bun run dev:admin), so both apps share this origin and its sign-in.
			"/admin": { target: "http://127.0.0.1:5174", changeOrigin: false, ws: true },
		},
	},
	preview: { host: true, port: 4173, proxy: { "/api": { target: apiTarget } } },
	build: {
		outDir: "dist",
		sourcemap: true,
		chunkSizeWarningLimit: 2000,
	},
});
