// Shared plumbing for guard scripts: failing, reporting and reading the environment.

import { readFileSync } from "node:fs";
import { STATIC_STEPS } from "../check";
import { repoPath } from "./repo";

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** A guard's verdict. `lines[0]` is the one-line summary on the green path. */
export type Report = { ok: boolean; lines: string[] };

/**
 * Runs a guard as a command: prints its failure lines and exits 1, or prints its summary. Report
 * functions themselves never exit, so `precheck.ts` can import and combine them.
 */
export function runReport(name: string, report: () => Report, options?: { timed?: boolean }): void {
  const t0 = performance.now();
  const result = report();
  if (!result.ok) {
    for (const line of result.lines) console.error(line);
    process.exit(1);
  }
  const elapsed = options?.timed ? ` · ${(performance.now() - t0).toFixed(0)}ms` : "";
  console.log(`${name}: OK — ${result.lines[0] ?? ""}${elapsed}.`);
}

/** The lines for at most `max` items, then a line counting the rest. */
export function linesWithOverflow<T>(
  items: readonly T[],
  max: number,
  render: (item: T) => string[],
  more: (hidden: number) => string,
): string[] {
  const lines = items.slice(0, max).flatMap(render);
  if (items.length > max) lines.push(more(items.length - max));
  return lines;
}

/** An integer from the environment, or `fallback` when unset; anything else is an error. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value))
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  return value;
}

/** A plain JSON object, as opposed to an array, `null` or a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses JSON and checks its shape, naming `label` when either step fails. */
export function parseJson<T>(
  text: string,
  label: string,
  guard: (value: unknown) => value is T,
): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${String(error)})`);
  }
  if (!guard(value)) throw new Error(`${label}: unexpected JSON shape`);
  return value;
}

/**
 * The problem when `site` no longer calls `call`. A gate nothing runs is indistinguishable from one
 * that passes, so each gate checks it is still wired in.
 */
export function wiringProblems(gate: string, site: string, call: string): string[] {
  if (readFileSync(repoPath(site), "utf8").includes(call)) return [];
  return [
    `${gate}: FAIL — \`${site}\` does not call \`${call}\`.`,
    "This gate would then run only when someone runs it by hand, which is never.",
    "Re-add the call (NOT by deleting this rung).",
  ];
}

const STATIC_CALL = "bun scripts/check.ts --static";

/**
 * The `check` script with every `bun run <name>` it calls and every `scripts/check.ts --static`
 * expanded in place, so a guard can see whether `check` still runs it.
 */
export function expandedCheckScript(): string {
  const pkg = parseJson(
    readFileSync(repoPath("package.json"), "utf8"),
    "package.json",
    (v): v is { scripts?: Record<string, unknown> } =>
      isRecord(v) && (v.scripts === undefined || isRecord(v.scripts)),
  );
  const scripts = pkg.scripts ?? {};
  const expand = (name: string, seen: Set<string>): string => {
    const script = scripts[name];
    if (typeof script !== "string" || seen.has(name)) return "";
    seen.add(name);
    return script
      .replace(/bun run ([\w:-]+)/g, (call, inner: string) =>
        inner in scripts ? expand(inner, seen) : call,
      )
      .replaceAll(STATIC_CALL, STATIC_STEPS.map((step) => `'${step}'`).join(" "));
  };
  return expand("check", new Set());
}
