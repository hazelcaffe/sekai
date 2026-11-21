import { VOICE_CAPS, type VoiceCap } from "@sekai/shared";
import { Hono } from "hono";
import { z } from "zod";
import { can, requirePermission } from "../auth/actor.ts";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { activeRings, declineRing } from "../outreach/calls.ts";
import { listVoiceModels, listVoices } from "../voice/catalog.ts";
import {
	cloneVoice,
	deleteCustomVoice,
	designVoice,
	listCustomVoices,
	renameCustomVoice,
	saveDesignedVoice,
} from "../voice/custom.ts";
import { voicePreview } from "../voice/preview.ts";
import { messageSpeech, SPEECH_HEADERS, speechStream } from "../voice/read-aloud.ts";
import { updateVoiceSettings, voiceFor, voiceSettings } from "../voice/settings.ts";
import { body, ok, readJson } from "./util.ts";

const capOf = (v: string | undefined): VoiceCap => (VOICE_CAPS.includes(v as VoiceCap) ? (v as VoiceCap) : "tts");

/** Voice: models and voices from every service, defaults, previews, and reading messages aloud. */
export const voiceRoutes = new Hono()
	// Using voice (calls, read-aloud, voice messages, making voices) is a role feature; its setup is an admin's.
	.use("*", async (c, next) => {
		const read = c.req.method === "GET";
		// Every app checks for incoming calls when it connects; nobody calls someone whose role has no voice.
		if (read && c.req.path.endsWith("/rings") && !can("voice")) return c.json([]);
		if (!(read && c.req.path.endsWith("/settings"))) requirePermission("voice");
		return next();
	})
	.get("/settings", async (c) => c.json(await voiceSettings()))
	.patch("/settings", async (c) => {
		requirePermission("admin");
		return c.json(await updateVoiceSettings(await readJson(c)));
	})
	/** A bot's voice with the defaults filled in. */
	.get("/agents/:id", async (c) => c.json(await voiceFor(c.req.param("id"))))
	.get("/models", async (c) => c.json(await listVoiceModels()))
	.get("/voices", async (c) => {
		const model = c.req.query("model") ?? "";
		try {
			return c.json(await listVoices(model, c.req.query("q") ?? ""));
		} catch (err) {
			return c.json({ error: errorMessage(err) }, 502);
		}
	})
	.get("/preview", async (c) => {
		const { file, type } = await voicePreview({
			model: c.req.query("model") ?? "",
			voice: c.req.query("voice") ?? "",
			cap: capOf(c.req.query("cap")),
			name: c.req.query("name") ?? "",
		});
		return new Response(Bun.file(file), {
			headers: { "content-type": type, "cache-control": "private, max-age=86400" },
		});
	})
	.get("/messages/:id/speech", async (c) => {
		const stream = await messageSpeech(c.req.param("id"), c.req.raw.signal);
		return new Response(stream, { headers: SPEECH_HEADERS });
	})
	/** Your voice message in a chat: kept as audio, written down for the bot, and answered (in voice). */
	.post("/messages", async (c) => {
		const form = await c.req.formData();
		const conversationId = String(form.get("conversationId") ?? "");
		const file = form.get("audio");
		if (!(file instanceof File)) throw badRequest("No recording");
		const replyToId = form.get("replyToId");
		const { requireConversation } = await import("../services/conversations.ts");
		await requireConversation(conversationId);
		const { prepareVoiceMessage, conversationAgent } = await import("../voice/voice-messages.ts");
		const { part, text } = await prepareVoiceMessage(
			await conversationAgent(conversationId),
			new Uint8Array(await file.arrayBuffer()),
		);
		const { sendUserMessage } = await import("../agent/runtime.ts");
		const { updateMessage } = await import("../services/messages.ts");
		const sent = await sendUserMessage(conversationId, {
			text: text || "(voice message)",
			attachmentIds: [],
			replyToId: typeof replyToId === "string" && replyToId ? replyToId : null,
		});
		const message = await updateMessage(sent.message.id, { parts: [part, ...sent.message.parts] });
		return c.json({ ...sent, message }, 201);
	})
	/** Voices you made (Fish Audio and ElevenLabs). */
	.get("/custom", async (c) => c.json(await listCustomVoices()))
	/** A few voices from a description, to hear and keep one. */
	.post("/custom/design", async (c) => {
		const b = await body(
			c,
			z.object({
				providerId: z.string().min(1),
				description: z.string().min(1).max(2000),
				text: z.string().max(1000).optional(),
				language: z.string().max(20).optional(),
			}),
		);
		return c.json(await designVoice(b));
	})
	.post("/custom/keep", async (c) => {
		const b = await body(c, z.object({ candidateId: z.string().min(1), name: z.string().min(1).max(60) }));
		return c.json(await saveDesignedVoice(b), 201);
	})
	/** A voice from a recording (WAV or Ogg Opus), with your word that it may be used. */
	.post("/custom/clone", async (c) => {
		const form = await c.req.formData();
		const file = form.get("audio");
		if (!(file instanceof File)) throw badRequest("No recording");
		const { recordingToPcm } = await import("../voice/voice-messages.ts");
		let pcm: Uint8Array;
		try {
			pcm = recordingToPcm(new Uint8Array(await file.arrayBuffer()));
		} catch {
			throw badRequest("Use a WAV or Ogg recording (or record one here)");
		}
		const { transcribe } = await import("../voice/listen.ts");
		const { voiceSettings } = await import("../voice/settings.ts");
		const v = await voiceSettings();
		const voice = await cloneVoice({
			providerId: String(form.get("providerId") ?? ""),
			name: String(form.get("name") ?? ""),
			consent: form.get("consent") === "true",
			pcm,
			transcribe: (p) => transcribe({ model: v.sttModel, pcm: p, language: v.language }),
		});
		return c.json(voice, 201);
	})
	.patch("/custom/:id", async (c) => {
		const b = await body(c, z.object({ name: z.string().min(1).max(60) }));
		return c.json(await renameCustomVoice(c.req.param("id"), b.name));
	})
	.delete("/custom/:id", async (c) => {
		await deleteCustomVoice(c.req.param("id"));
		return c.json(ok);
	})
	/** Bots calling you right now. */
	.get("/rings", async (c) => c.json(await activeRings()))
	.post("/rings/:id/decline", async (c) => c.json({ ok: await declineRing(c.req.param("id")) }))
	.post("/speak", async (c) => {
		const body = (await readJson(c)) as { text?: string; agentId?: string | null };
		const stream = await speechStream({
			text: String(body.text ?? "").slice(0, 20_000),
			agentId: body.agentId ?? null,
			signal: c.req.raw.signal,
		});
		return new Response(stream, { headers: SPEECH_HEADERS });
	});
