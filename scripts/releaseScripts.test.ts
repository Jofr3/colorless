import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRecord } from "./lib/cli";
import { repoPath } from "./lib/repo";

// The release's gates live in apps/api/scripts/release-gate.ts, but a gate is only a gate while the
// package.json scripts run it: these pin the wiring.
const scripts = (file: string): Record<string, string> => {
  const manifest: unknown = JSON.parse(readFileSync(repoPath(file), "utf8"));
  const found = isRecord(manifest) && isRecord(manifest.scripts) ? manifest.scripts : {};
  return Object.fromEntries(
    Object.entries(found).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};
const root = scripts("package.json");
const api = scripts("apps/api/package.json");
const words = (script: string | undefined) => (script ?? "").split(/\s+/);

describe("the release scripts run their gates", () => {
  it("release:gate pins the commit first, then audits and prints CI before anything remote", () => {
    const gate = words(api["release:gate"]);
    expect(gate.slice(0, 4)).toEqual(["bun", "scripts/release-gate.ts", "pin", "clean-tree"]);
    for (const step of ["audit", "ci", "secrets", "bookmark", "versions", "print-keys"])
      expect(gate).toContain(step);
  });

  it("each deploy re-checks the tree and prints CI, and wrangler runs from release-gate", () => {
    expect(api.deploy).toBe(
      "bun scripts/release-gate.ts migrations clean-tree ci -- wrangler deploy --minify",
    );
    expect(root["deploy:web"]).toBe(
      "bun apps/api/scripts/release-gate.ts clean-tree web-dist ci -- wrangler deploy && bun apps/api/scripts/release-gate.ts web-health",
    );
    expect(root.deploy).toContain("bun run deploy:web");
  });

  it("release checks the new API, then deploys the web app, records the release, and aborts on any failure", () => {
    const steps = (root.release ?? "").split(" || ");
    expect(steps[1]).toBe("bun apps/api/scripts/release-gate.ts abort");
    expect(steps).toHaveLength(2);
    const chain = (steps[0] ?? "").split(" && ");
    expect(chain.slice(-4)).toEqual([
      "bun run api:deploy",
      "bun run --cwd apps/api release:health",
      "bun run deploy:web",
      "bun run --cwd apps/api release:finish",
    ]);
    expect(chain.indexOf("bun run --cwd apps/api release:gate")).toBeLessThan(
      chain.indexOf("bun run build"),
    );
    expect(api["release:health"]).toBe("bun scripts/release-gate.ts health");
    expect(api["release:finish"]).toBe("bun scripts/release-gate.ts finish");
  });

  it("the remote migration runs with the deploy token, since the ambient token is read-only", () => {
    expect(api["db:migrate:remote"]).toBe(
      "bun scripts/with-deploy-token.ts wrangler d1 migrations apply colorless --remote",
    );
  });
});
