import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("luminous-api"),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
