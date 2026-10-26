import * as z from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("colorless-api"),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
