import { describe, expect, it } from "vitest";
import {
  ageInDays,
  auditHeadline,
  COMPAT_MAX_AGE_DAYS,
  compatibilityDate,
  compatibilityReport,
  deprecations,
  githubRepo,
  lockPackages,
  satisfiesPin,
  specConflicts,
} from "./deps-check";

describe("deps-check lock packages", () => {
  it("lists each npm name@version once, skipping workspace links", () => {
    expect(
      lockPackages([
        { path: "esbuild", name: "esbuild", version: "0.28.1" },
        { path: "drizzle-kit/esbuild", name: "esbuild", version: "0.18.20" },
        { path: "vite/esbuild", name: "esbuild", version: "0.28.1" },
        { path: "@colorless/api", name: "@colorless/api", version: "workspace:apps/api" },
        { path: "hono", name: "hono", version: "4.13.13" },
      ]),
    ).toEqual([
      { name: "esbuild", version: "0.18.20" },
      { name: "esbuild", version: "0.28.1" },
      { name: "hono", version: "4.13.13" },
    ]);
  });
});

describe("deps-check deprecation scan", () => {
  const packages = [
    { name: "@esbuild-kit/core-utils", version: "3.3.2" },
    { name: "hono", version: "4.13.13" },
    { name: "gone", version: "1.0.0" },
    { name: "offline", version: "2.0.0" },
  ];
  const packuments = new Map([
    ["@esbuild-kit/core-utils", { versions: { "3.3.2": { deprecated: "Merged into tsx" } } }],
    ["hono", { versions: { "4.13.13": {}, "4.13.17": { deprecated: "" } } }],
    ["gone", { versions: { "1.0.1": {} } }],
    ["offline", undefined],
  ]);

  it("reports deprecated versions with the registry's message", () => {
    expect(deprecations(packages, packuments).deprecated).toEqual([
      { name: "@esbuild-kit/core-utils", version: "3.3.2", message: "Merged into tsx" },
    ]);
  });

  it("reports a locked version the registry no longer lists", () => {
    expect(deprecations(packages, packuments).missing).toEqual(["gone@1.0.0"]);
  });

  it("names a package it could not fetch instead of passing it as clean", () => {
    expect(deprecations(packages, packuments).unknown).toEqual(["offline"]);
  });
});

describe("deps-check spec conflicts", () => {
  it("flags a name declared twice with different specs, naming every declaration", () => {
    expect(
      specConflicts([
        {
          path: "package.json",
          manifest: { devDependencies: { wrangler: "^4.0.0", vite: "^8.0.9" } },
        },
        {
          path: "apps/api/package.json",
          manifest: {
            dependencies: { "@colorless/schema": "workspace:*" },
            devDependencies: { wrangler: "^4.109.0", vite: "^8.0.9" },
          },
        },
        { path: "packages/schema/package.json", manifest: { name: "@colorless/schema" } },
      ]),
    ).toEqual([
      {
        name: "wrangler",
        specs: [
          "package.json devDependencies: ^4.0.0",
          "apps/api/package.json devDependencies: ^4.109.0",
        ],
      },
    ]);
  });

  it("passes the same spec in two workspaces and workspace links", () => {
    expect(
      specConflicts([
        { path: "a", manifest: { dependencies: { zod: "^4.6.7", x: "workspace:*" } } },
        { path: "b", manifest: { dependencies: { zod: "^4.6.7", x: "workspace:^" } } },
      ]),
    ).toEqual([]);
  });
});

describe("deps-check compatibility_date", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("reads the date from a wrangler.jsonc text", () => {
    expect(compatibilityDate('{\n  // c\n  "compatibility_date": "2026-06-01",\n}')).toBe(
      "2026-06-01",
    );
    expect(compatibilityDate('{ "name": "x" }')).toBeUndefined();
  });

  it("counts whole days", () => {
    expect(ageInDays("2026-06-01", now)).toBe(161);
  });

  it("passes equal dates under the quarterly floor", () => {
    const report = compatibilityReport(
      [
        { path: "wrangler.jsonc", date: "2026-10-01" },
        { path: "apps/api/wrangler.jsonc", date: "2026-10-01" },
      ],
      now,
    );
    expect(report).toEqual({
      ok: true,
      lines: ["2026-10-01 in wrangler.jsonc and apps/api/wrangler.jsonc, 39 days old"],
    });
  });

  it("flags a date past the floor", () => {
    const date = new Date(now.getTime() - (COMPAT_MAX_AGE_DAYS + 1) * 86_400_000);
    const report = compatibilityReport([{ path: "w", date: date.toISOString().slice(0, 10) }], now);
    expect(report.ok).toBe(false);
    expect(report.lines[0]).toContain("due a move");
  });

  it("passes a date exactly at the floor", () => {
    const date = new Date(now.getTime() - COMPAT_MAX_AGE_DAYS * 86_400_000);
    expect(
      compatibilityReport([{ path: "w", date: date.toISOString().slice(0, 10) }], now).ok,
    ).toBe(true);
  });

  it("flags Workers that disagree, and a config with no date", () => {
    const split = compatibilityReport(
      [
        { path: "wrangler.jsonc", date: "2026-10-01" },
        { path: "apps/api/wrangler.jsonc", date: "2026-06-01" },
      ],
      now,
    );
    expect(split.ok).toBe(false);
    expect(split.lines[0]).toContain("disagree");
    expect(compatibilityReport([{ path: "w", date: undefined }], now).ok).toBe(false);
  });
});

describe("deps-check toolchain pins", () => {
  it("matches a version against a line or exact pin", () => {
    expect(satisfiesPin("22.23", "v22.23.4")).toBe(true);
    expect(satisfiesPin("1.4.2", "1.4.2")).toBe(true);
    expect(satisfiesPin("22.2", "v22.23.4")).toBe(false);
    expect(satisfiesPin("1.4.2", "1.4.20")).toBe(false);
    expect(satisfiesPin("22", "v24.1.0")).toBe(false);
  });
});

describe("deps-check advisory links", () => {
  it("normalises a packument's repository to its GitHub page", () => {
    expect(githubRepo({ type: "git", url: "git+https://github.com/honojs/hono.git" })).toBe(
      "https://github.com/honojs/hono",
    );
    expect(
      githubRepo({ url: "git+https://github.com/honojs/middleware.git", directory: "packages/x" }),
    ).toBe("https://github.com/honojs/middleware");
    expect(githubRepo("github:paulmillr/noble-ciphers")).toBe(
      "https://github.com/paulmillr/noble-ciphers",
    );
    expect(githubRepo("git@github.com:colinhacks/zod.git")).toBe(
      "https://github.com/colinhacks/zod",
    );
    expect(githubRepo("https://gitlab.com/a/b")).toBeUndefined();
    expect(githubRepo(undefined)).toBeUndefined();
  });

  it("takes bun audit's last summary line, without its timing", () => {
    expect(
      auditHeadline(
        "bun audit v1.4.2\n\nvite@8.0.10\n  moderate: x\n\n42 vulnerabilities (15 high, 23 moderate, 4 low)\n\n  bun audit fix  upgrade the vulnerable packages",
      ),
    ).toBe("42 vulnerabilities (15 high, 23 moderate, 4 low)");
    expect(auditHeadline("No vulnerabilities found (checked 5 packages) [274.00ms]")).toBe(
      "No vulnerabilities found (checked 5 packages)",
    );
  });
});
