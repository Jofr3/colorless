import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

// packages/schema has no Node types, so the jitless module's test lives here.

/** Counts `new Function(...)` calls while the schema package loads and parses, in a fresh
    process: the setting is realm-wide, so it must not leak into suites sharing this worker. */
function functionCalls(first: string): number {
  const script = `
    let calls = 0;
    const Real = Function;
    Function = new Proxy(Real, { construct: (target, args) => { calls++; return Reflect.construct(target, args); } });
    ${first}
    const { z } = await import("zod");
    z.object({ a: z.string() }).parse({ a: "x" });
    await import("./index.ts");
    console.log(calls);
  `;
  const run = spawnSync("bun", ["--eval", script], {
    cwd: repoPath("packages/schema/src"),
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(run.stderr);
  return Number(run.stdout.trim());
}

describe("@colorless/schema/jitless", () => {
  it("stops zod's eval probe, which the page's CSP reports on every load", () => {
    expect(functionCalls("")).toBeGreaterThan(0);
    expect(functionCalls('await import("./jitless.ts");')).toBe(0);
  });

  it("is the page entry's first import, ahead of every schema", () => {
    const entry = readFileSync(repoPath("src/lua/bridge.ts"), "utf8");
    const first = entry.match(/^import\s.*$/m)?.[0];
    expect(first).toBe('import "@colorless/schema/jitless";');
  });
});
