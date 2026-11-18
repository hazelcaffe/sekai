import { z } from "zod";

/**
 * A patch of an object schema: every key optional and none filled in. Zod's own .partial() still applies
 * .default() values to keys you leave out, so a patch like { voice } would reset everything else.
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
	const shape: Record<string, z.ZodType> = {};
	for (const [key, field] of Object.entries(schema.shape)) {
		let inner = field as z.ZodType;
		while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
		shape[key] = inner.optional();
	}
	return z.object(shape) as unknown as z.ZodObject<{
		[K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer I extends z.ZodType> ? I : S[K]>;
	}>;
}
