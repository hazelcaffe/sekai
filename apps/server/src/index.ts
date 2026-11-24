import type { Server, ServerWebSocket } from "bun";
import { scheduleCheckups, stopCheckups } from "./agent/checkup.ts";
import { cancelAllRuns } from "./agent/runtime.ts";
import { createApp } from "./app.ts";
import { ensureSetupCode } from "./auth/service.ts";
import { restorePending, startBackups, stopBackups } from "./backups/index.ts";
import { initBrowsers, shutdownBrowsers } from "./browser/engine.ts";
import { stopXvfb } from "./browser/xvfb.ts";
import { initChannels, shutdownChannels } from "./channels/manager.ts";
import { leaveAllVoice } from "./channels/voice.ts";
import { resumeCodeIndexes, stopCodeIndexes } from "./code/indexer.ts";
import { APP_NAME, APP_VERSION, config } from "./config.ts";
import { closeDb, initDb } from "./db/index.ts";
import { startEmail, stopEmail } from "./email/watch.ts";
import { restoreJobs, shutdownJobs } from "./jobs/index.ts";
import { log } from "./lib/log.ts";
import { resumeLibrary } from "./library/index.ts";
import { type BridgeSocket, bridgeWebSocket, upgradeBridge } from "./machines/bridge.ts";
import { initMachines, shutdownMachines } from "./machines/manager.ts";
import { upgradeVnc, type VncSocket, vncWebSocket } from "./machines/vnc.ts";
import { connectAll, disconnectAll } from "./mcp/manager.ts";
import {
	initProviders,
	type SignInSocket,
	shutdownProviders,
	signInWebSocket,
	upgradeSignIn,
} from "./providers/index.ts";
import { startPush } from "./push.ts";
import { startEventWatch, stopEventWatch } from "./scheduler/events.ts";
import { startScheduler, stopScheduler } from "./scheduler/index.ts";
import { startDigest, stopDigest } from "./services/digest.ts";
import { startHealthWatch, stopHealthWatch } from "./services/health.ts";
import { startHousekeeping, stopHousekeeping } from "./services/housekeeping.ts";
import { failStreamingMessages } from "./services/messages.ts";
import { failActiveRuns } from "./services/runs.ts";
import { seedBuiltinSkills } from "./services/skills.ts";
import { stopSignalDaemon } from "./signal/engine.ts";
import { upgradeVoice, type VoiceSocket, voiceWebSocket } from "./voice/ws.ts";
import { startWebEngine, stopWebEngine } from "./web/engine.ts";
import { stopWebSetup } from "./web/setup.ts";
import { startXMentions, stopXMentions } from "./x/mentions.ts";

// A misbehaving library (or a dropped connection deep inside one) must never take the whole server down.
process.on("unhandledRejection", (reason) => log.error("unhandled rejection", reason));
process.on("uncaughtException", (err) => log.error("uncaught exception", err));

async function main(): Promise<void> {
	log.info(`${APP_NAME} ${APP_VERSION} starting`);
	await initDb();
	// A restore you asked for happens here, before anything reads the database or the keys.
	await restorePending();
	const [runs, messages] = await Promise.all([failActiveRuns(), failStreamingMessages()]);
	if (runs || messages) log.warn(`marked ${runs} interrupted runs and ${messages} messages from the last session`);
	await seedBuiltinSkills();
	await initProviders();

	const app = createApp();
	const server = Bun.serve<VncSocket | BridgeSocket | VoiceSocket | SignInSocket>({
		hostname: config.host,
		port: config.port,
		// SSE streams stay open indefinitely; keepalive pings are sent every 15s.
		idleTimeout: 0,
		maxRequestBodySize: 30 * 1024 * 1024,
		async fetch(req, srv) {
			// WebSockets: the desktop app lending your computer, takeover (VNC), voice calls, and subscription sign-in.
			if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
				const bridge = await upgradeBridge(req, srv as Server<BridgeSocket>);
				if (bridge !== null) return bridge;
				const vnc = await upgradeVnc(req, srv as Server<VncSocket>);
				if (vnc !== null) return vnc;
				const voice = await upgradeVoice(req, srv as Server<VoiceSocket>);
				if (voice !== null) return voice;
				const signIn = await upgradeSignIn(req, srv as Server<SignInSocket>);
				if (signIn !== null) return signIn;
			}
			return app.fetch(req, srv);
		},
		websocket: {
			// Screenshots from your computer arrive as one message.
			maxPayloadLength: 64 * 1024 * 1024,
			idleTimeout: 960,
			open(ws) {
				if (ws.data.kind === "vnc") void vncWebSocket.open(ws as ServerWebSocket<VncSocket>);
				else if (ws.data.kind === "voice") void voiceWebSocket.open(ws as ServerWebSocket<VoiceSocket>);
				else if (ws.data.kind === "signin") signInWebSocket.open(ws as ServerWebSocket<SignInSocket>);
			},
			message(ws, message) {
				if (ws.data.kind === "vnc") vncWebSocket.message(ws as ServerWebSocket<VncSocket>, message);
				else if (ws.data.kind === "voice") voiceWebSocket.message(ws as ServerWebSocket<VoiceSocket>, message);
				else if (ws.data.kind === "signin")
					signInWebSocket.message(ws as ServerWebSocket<SignInSocket>, message);
				else void bridgeWebSocket.message(ws as ServerWebSocket<BridgeSocket>, message);
			},
			close(ws) {
				if (ws.data.kind === "vnc") vncWebSocket.close(ws as ServerWebSocket<VncSocket>);
				else if (ws.data.kind === "voice") voiceWebSocket.close(ws as ServerWebSocket<VoiceSocket>);
				else if (ws.data.kind === "signin") signInWebSocket.close(ws as ServerWebSocket<SignInSocket>);
				else bridgeWebSocket.close(ws as ServerWebSocket<BridgeSocket>);
			},
		},
	});
	log.info(`listening on http://${server.hostname}:${server.port}`);
	log.info(
		config.gateway.url
			? `gateway ${config.gateway.url}${config.gateway.apiKey ? "" : " (no API key)"}`
			: "no model gateway set yet: add one in Settings → Models (or GATEWAY_URL)",
	);
	const shownHost = ["0.0.0.0", "::"].includes(server.hostname ?? "") ? "localhost" : server.hostname;
	await ensureSetupCode(`http://${shownHost}:${server.port}`);

	void connectAll();
	await initMachines();
	await restoreJobs();
	initBrowsers();
	await initChannels();
	await startScheduler();
	startEventWatch();
	void startBackups().catch(() => {});
	startHealthWatch();
	void startDigest().catch(() => {});
	void scheduleCheckups().catch(() => {});
	startHousekeeping();
	startXMentions();
	void startEmail().catch(() => {});
	startPush();
	void resumeCodeIndexes().catch(() => {});
	void resumeLibrary().catch(() => {});
	void startWebEngine();

	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		log.info(`${signal}: shutting down`);
		stopScheduler();
		stopEventWatch();
		stopBackups();
		stopHealthWatch();
		stopDigest();
		stopCheckups();
		stopHousekeeping();
		stopXMentions();
		await stopEmail();
		stopCodeIndexes();
		stopWebSetup();
		await stopWebEngine();
		cancelAllRuns();
		await shutdownJobs();
		leaveAllVoice();
		await shutdownChannels();
		await stopSignalDaemon();
		shutdownMachines();
		await shutdownBrowsers();
		stopXvfb();
		await shutdownProviders();
		// Close open connections too (the app's event stream would keep a plain stop() waiting forever).
		await server.stop(true);
		await disconnectAll();
		await closeDb();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
	log.error("fatal", err);
	process.exit(1);
});
