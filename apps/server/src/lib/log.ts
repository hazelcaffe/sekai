import { config } from "../config.ts";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function emit(level: Level, msg: string, extra?: unknown): void {
	if (LEVELS[level] < LEVELS[config.logLevel]) return;
	const time = new Date().toISOString().slice(11, 23);
	const line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}`;
	const args = extra === undefined ? [line] : [line, extra];
	if (level === "error") console.error(...args);
	else if (level === "warn") console.warn(...args);
	else console.info(...args);
}

export const log = {
	debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
	info: (msg: string, extra?: unknown) => emit("info", msg, extra),
	warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
	error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
