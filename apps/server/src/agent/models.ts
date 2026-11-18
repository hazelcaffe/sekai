import { type Agent, isByosModel, type ModelInfo, type ModelRef, type Settings } from "@sekai/shared";
import { listModels } from "../llm/catalog.ts";
import { modelAllowed } from "../services/limits.ts";

/** Subscription (BYOS) models only drive an agent's replies; anything sent to the gateway needs a gateway model. */
export function gatewayModel(ref: ModelRef | null | undefined): ModelRef | null {
	return ref && !isByosModel(ref.model) ? ref : null;
}

/**
 * The chat models on offer right now (the gateway's and your API providers', those the person may use), or null
 * when they can't be listed (the gateway is down, or took longer than timeoutMs).
 */
export async function availableModels(timeoutMs?: number): Promise<ModelInfo[] | null> {
	const listed = listModels()
		.then((all) => all.filter((m) => modelAllowed(m.id)))
		.catch(() => null);
	return timeoutMs === undefined ? listed : Promise.race([listed, Bun.sleep(timeoutMs).then(() => null)]);
}

/** Whether a model can be used. Subscription models aren't in the list, and when nothing is known, all are. */
function offered(ref: ModelRef, models: ModelInfo[] | null): boolean {
	return isByosModel(ref.model) || !models?.length || models.some((m) => m.id === ref.model);
}

function firstOffered(models: ModelInfo[] | null): ModelRef | null {
	const first = models?.[0];
	return first ? { model: first.id, thinking: "default" } : null;
}

/**
 * A default from Admin → Models as it can be used: itself when it's on offer, otherwise the first chat model that
 * is (a fresh install's defaults name models every gateway may not have). Kept as it is when nothing is known.
 */
export function resolveModel(ref: ModelRef, models: ModelInfo[] | null): ModelRef {
	return offered(ref, models) ? ref : (firstOffered(models) ?? ref);
}

/**
 * The models new bots start with: the defaults from Admin → Models, or models on offer when they aren't. The
 * background model falls back to the default model.
 */
export async function defaultModels(
	settings: Settings,
	models?: ModelInfo[] | null,
): Promise<{ primary: ModelRef; fast: ModelRef }> {
	const list = models === undefined ? await availableModels() : models;
	const primary = resolveModel(settings.defaultModel, list);
	const fast = gatewayModel(settings.defaultFastModel);
	return {
		primary,
		fast:
			(fast && offered(fast, list) ? fast : null) ??
			gatewayModel(primary) ??
			firstOffered(list) ??
			settings.defaultFastModel,
	};
}

/**
 * The model for background work (titles, memory, routing, compaction, reviews). Always a gateway model. A bot's own
 * choices are used as they are; the defaults only when they're on offer.
 */
export async function fastModelFor(agent: Pick<Agent, "models"> | null, settings: Settings): Promise<ModelRef> {
	const own = gatewayModel(agent?.models.fast);
	if (own) return own;
	// Cached for minutes; a gateway that doesn't answer mustn't hold up every reply.
	const models = await availableModels(5000);
	const usable = (ref: ModelRef): ModelRef | null => {
		const g = gatewayModel(ref);
		return g && offered(g, models) ? g : null;
	};
	return (
		usable(settings.defaultFastModel) ??
		gatewayModel(agent?.models.primary) ??
		usable(settings.defaultModel) ??
		// Everything above is a subscription model, or isn't on offer: background work still needs a gateway model.
		firstOffered(models) ??
		settings.defaultFastModel
	);
}
