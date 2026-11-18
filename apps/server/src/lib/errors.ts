import type { ZodType } from "zod";

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);

/** Validates input against a schema, throwing a 400 with readable issues. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
	const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
	throw badRequest(summary || "Invalid request", issues);
}

export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : JSON.stringify(err);
}

export function isAbortError(err: unknown): boolean {
	return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
