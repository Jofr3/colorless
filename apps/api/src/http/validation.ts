// Request validation with one 400 shape for every route:
// `{ "error": "invalid body" | "invalid query", "issues": ["path: message", …] }`.

import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { z } from "zod";

type Target = "json" | "query";

const LABEL: Record<Target, "body" | "query"> = { json: "body", query: "query" };

/** Issues one 400 lists at most: a body of many bad entries would otherwise answer with a line
    for each of them. */
export const MAX_REPORTED_ISSUES = 20;

/** The 400 for a failed parse. zValidator surfaces the zod-core error type. */
export function invalidRequest(c: Context, target: Target, error: z.core.$ZodError) {
  const label = LABEL[target];
  const issues = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.map(String).join(".") || label}: ${issue.message}`);
  return c.json({ error: `invalid ${label}`, issues }, 400);
}

/** zValidator with the shared 400 hook. */
export const validate = <T extends Target, Schema extends z.ZodType>(target: T, schema: Schema) =>
  zValidator(target, schema, (result, c) =>
    result.success ? undefined : invalidRequest(c, target, result.error),
  );
