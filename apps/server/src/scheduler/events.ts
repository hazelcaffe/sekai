import type { Routine } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { listRoutines } from "../services/routines.ts";
import { dispatchRoutine } from "./runner.ts";

/**
 * Device events for routines: while any enabled routine waits for a tailnet device to go offline or come back,
 * the tailnet is checked every minute. A change counts once it has held for two checks in a row (a device that
 * blips for a few seconds doesn't set anything off).
 */

const POLL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
/** Last settled state per device id, and a change seen once that waits to be confirmed. */
const state = new Map<string, boolean>();
const pending = new Map<string, boolean>();

type DeviceRoutine = Routine & { schedule: { type: "event"; event: { kind: "device" } } };

function deviceRoutines(all: Routine[]): DeviceRoutine[] {
	return all.filter(
		(r): r is DeviceRoutine => r.enabled && r.schedule.type === "event" && r.schedule.event.kind === "device",
	);
}

/**
 * One check's worth of changes: compares devices with the settled state (and changes seen once before), updates
 * both, and returns the devices whose change has now held for two checks.
 */
export function settleChanges<D extends { id: string; online: boolean }>(
	devices: D[],
	settled: Map<string, boolean>,
	seenOnce: Map<string, boolean>,
): D[] {
	const changed: D[] = [];
	for (const d of devices) {
		const before = settled.get(d.id);
		if (before === undefined) {
			// First look: that's how it is now, not a change.
			settled.set(d.id, d.online);
			continue;
		}
		if (before === d.online) {
			seenOnce.delete(d.id);
			continue;
		}
		if (seenOnce.get(d.id) !== d.online) {
			seenOnce.set(d.id, d.online);
			continue;
		}
		seenOnce.delete(d.id);
		settled.set(d.id, d.online);
		changed.push(d);
	}
	return changed;
}

async function check(): Promise<void> {
	if (busy) return;
	busy = true;
	try {
		const routines = deviceRoutines(await listRoutines());
		if (!routines.length) {
			state.clear();
			pending.clear();
			return;
		}
		const { tailnetDevices } = await import("../machines/hosts.ts");
		const { devices } = await tailnetDevices();
		for (const d of settleChanges(devices, state, pending)) {
			const change = d.online ? "online" : "offline";
			const what = d.online ? `${d.name} came back online` : `${d.name} went offline`;
			log.info(`tailnet: ${what}`);
			for (const r of routines) {
				const e = r.schedule.event;
				if (e.change !== "any" && e.change !== change) continue;
				// A specific device, or (none chosen) any device bots can use.
				if (e.deviceId ? e.deviceId !== d.id : !d.hostId) continue;
				void dispatchRoutine(r, {
					event: { what, detail: `Device: ${d.name} (${d.os || "unknown OS"}, ${d.address})` },
				}).catch((err: unknown) => log.warn(`device routine failed: ${errorMessage(err)}`));
			}
		}
	} catch (err) {
		log.debug(`device watch: ${errorMessage(err)}`);
	} finally {
		busy = false;
	}
}

export function startEventWatch(): void {
	if (timer) return;
	timer = setInterval(() => void check(), POLL_MS);
	void check();
}

export function stopEventWatch(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
