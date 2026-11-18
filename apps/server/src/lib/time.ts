export function systemTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** "Saturday, November 14, 2026, 1:49 PM GMT-5" in the given zone. */
export function formatDateTime(ms: number, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(ms);
}

export function formatShort(ms: number, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(ms);
}

/** ISO 8601 with the zone's UTC offset, e.g. "2026-11-14T13:49:00-05:00". */
export function isoInZone(ms: number, timeZone: string): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		})
			.formatToParts(ms)
			.map((p) => [p.type, p.value]),
	);
	const local = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	const offsetMin = Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
	const sign = offsetMin >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

/**
 * Parses an agent-supplied time: ISO 8601 (with or without offset; without one it's read in `timeZone`),
 * or relative phrases like "in 20 minutes", "in 2 hours", "in 3 days".
 */
export function parseWhen(input: string, timeZone: string, now = Date.now()): number | null {
	const text = input.trim().toLowerCase();
	const rel = text.match(
		/^in\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/,
	);
	if (rel?.[1] && rel[2]) {
		const n = Number(rel[1]);
		const unit = rel[2][0];
		const mult =
			unit === "s"
				? 1000
				: unit === "m"
					? 60_000
					: unit === "h"
						? 3_600_000
						: unit === "d"
							? 86_400_000
							: 604_800_000;
		return now + Math.round(n * mult);
	}
	const iso = input.trim();
	if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
	const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(iso);
	if (hasZone) {
		const t = Date.parse(iso);
		return Number.isNaN(t) ? null : t;
	}
	// Local wall time in `timeZone`: guess as UTC, then correct by the zone's offset at that instant.
	const asUtc = Date.parse(`${iso.length === 10 ? `${iso}T09:00:00` : iso}Z`);
	if (Number.isNaN(asUtc)) return null;
	const offset = zoneOffsetMs(asUtc, timeZone);
	const guess = asUtc - offset;
	const corrected = asUtc - zoneOffsetMs(guess, timeZone);
	return corrected;
}

function zoneOffsetMs(ms: number, timeZone: string): number {
	const iso = isoInZone(ms, timeZone);
	const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
	if (!m) return 0;
	const sign = m[1] === "-" ? -1 : 1;
	return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}
