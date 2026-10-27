import * as z from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("colorless-api"),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** GET /health/db: whether one D1 read worked and, when it did, how many migrations the database
    has applied, to compare with the files in apps/api/drizzle/. */
export const dbHealthResponseSchema = z.union([
  z.object({ ok: z.literal(true), migrations: z.number().int().min(0) }),
  z.object({ ok: z.literal(false) }),
]);

export type DbHealthResponse = z.infer<typeof dbHealthResponseSchema>;
