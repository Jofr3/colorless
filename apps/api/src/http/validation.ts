// Request validation with one 400 shape for every route:
// `{ "error": "invalid body" | "invalid query", "issues": ["path: message", …] }`.

import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { routePath } from "hono/route";
import type { z } from "zod";
import { logEventThrottled } from "./log";

type Target = "json" | "query";

const LABEL: Record<Target, "body" | "query"> = { json: "body", query: "query" };

/** Issues one 400 lists at most: a body of many bad entries would otherwise answer with a line
    for each of them. */
export const MAX_REPORTED_ISSUES = 20;

/** Issue paths one `invalid_request` log line names at most. */
export const MAX_LOGGED_PATHS = 5;

/** The 400 for a failed parse. zValidator surfaces the zod-core error type. */
export function invalidRequest(c: Context, target: Target, error: z.core.$ZodError) {
  const label = LABEL[target];
  const pathOf = (issue: z.core.$ZodIssue) => issue.path.map(String).join(".") || label;
  const issues = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${pathOf(issue)}: ${issue.message}`);
  // Paths only: they are the schema's own keys and list indexes, while a message can quote what
  // the caller sent (a duplicate card id). Throttled, as a broken client would fail every request.
  logEventThrottled("http", "invalid_request", {
    route: routePath(c, -1),
    target: label,
    issues: error.issues.length,
    paths: error.issues.slice(0, MAX_LOGGED_PATHS).map(pathOf).join(","),
  });
  return c.json({ error: `invalid ${label}`, issues }, 400);
}

/** zValidator with the shared 400 hook. */
export const validate = <T extends Target, Schema extends z.ZodType>(target: T, schema: Schema) =>
  zValidator(target, schema, (result, c) =>
    result.success ? undefined : invalidRequest(c, target, result.error),
  );
