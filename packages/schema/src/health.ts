import * as z from "zod";

/** GET /health. `version` is the running Worker version (the `CF_VERSION_METADATA` binding): its
    id, and its tag, which a release sets to the deployed commit's short sha (empty for a version
    deployed without `--tag`). Null where the binding is absent (unit tests). `release:health`
    waits until the tag is the commit it released. */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("colorless-api"),
  time: z.iso.datetime(),
  version: z.object({ id: z.string(), tag: z.string() }).nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** GET /health/db: whether one D1 read worked and, when it did, how many migrations the database
    has applied, to compare with the files in apps/api/drizzle/. */
export const dbHealthResponseSchema = z.union([
  z.object({ ok: z.literal(true), migrations: z.number().int().min(0) }),
  z.object({ ok: z.literal(false) }),
]);

export type DbHealthResponse = z.infer<typeof dbHealthResponseSchema>;
