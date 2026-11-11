import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";
import { bunPinReport, lockCheckReport, runtimeVersions } from "./lock-check";

const entry = (path: string, spec: string) => `    "${path}": ["${spec}", "", {}, "sha512-x"],`;

const lock = (...entries: string[]) =>
  ["{", '  "lockfileVersion": 1,', '  "packages": {', ...entries, "  }", "}"].join("\n");

const single = [
  entry("miniflare", "miniflare@4.20260708.0"),
  entry("workerd", "workerd@1.20260708.1"),
  entry("@cloudflare/workerd-linux-64", "@cloudflare/workerd-linux-64@1.20260708.1"),
  entry("wrangler", "wrangler@4.109.0"),
];

describe("lock-check", () => {
  it("passes one miniflare and one workerd", () => {
    const report = lockCheckReport(lock(...single));
    expect(report.ok).toBe(true);
    expect(report.lines[0]).toBe("one miniflare (4.20260708.0) and one workerd (1.20260708.1)");
  });

  it("fails a nested wrangler/miniflare beside the pin, naming both", () => {
    const report = lockCheckReport(
      lock(...single, entry("wrangler/miniflare", "miniflare@5.20261019.2-beta")),
    );
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "miniflare: 4.20260708.0 (miniflare); 5.20261019.2-beta (wrangler/miniflare)",
    );
  });

  it("fails a second workerd platform binary", () => {
    const report = lockCheckReport(
      lock(
        ...single,
        entry("wrangler/@cloudflare/workerd-linux-64", "@cloudflare/workerd-linux-64@1.20261104.1"),
      ),
    );
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain("@cloudflare/workerd-linux-64:");
  });

  it("ignores other packages with more than one version", () => {
    const report = lockCheckReport(
      lock(
        ...single,
        entry("esbuild", "esbuild@0.28.1"),
        entry("drizzle-kit/esbuild", "esbuild@0.25.12"),
      ),
    );
    expect(report.ok).toBe(true);
  });

  it("fails when it can no longer read the lock", () => {
    expect(lockCheckReport(lock(entry("wrangler", "wrangler@4.109.0"))).ok).toBe(false);
  });

  it("reads the repository's bun.lock", () => {
    const found = runtimeVersions(readFileSync(repoPath("bun.lock"), "utf8"));
    expect(found.get("miniflare")?.size).toBe(1);
    expect(found.get("workerd")?.size).toBe(1);
  });
});

describe("lock-check's bun pins", () => {
  it("passes .bun-version and packageManager naming the bun that runs it", () => {
    expect(bunPinReport("1.4.2\n", "bun@1.4.2", "1.4.2")).toEqual({
      ok: true,
      lines: ["bun 1.4.2 pinned"],
    });
  });

  it.each([
    ["a different version", "bun@1.4.1"],
    ["another package manager", "npm@10.9.0"],
    ["no packageManager", undefined],
  ])("fails %s in packageManager", (_label, packageManager) => {
    const report = bunPinReport("1.4.2\n", packageManager, "1.4.2");
    expect(report.ok).toBe(false);
    expect(report.lines[0]).toContain(".bun-version pins bun 1.4.2");
  });

  it("only warns when the running bun differs from the pin", () => {
    const report = bunPinReport("1.4.2", "bun@1.4.2", "1.4.3");
    expect(report.ok).toBe(true);
    expect(report.warning).toBe(
      "lock-check: warning — running bun 1.4.3, but the repo pins 1.4.2 (.bun-version).",
    );
  });

  it("reads the repository's pins, which agree", () => {
    const manifest = JSON.parse(readFileSync(repoPath("package.json"), "utf8"));
    const pinned = readFileSync(repoPath(".bun-version"), "utf8");
    expect(bunPinReport(pinned, manifest.packageManager, pinned.trim()).ok).toBe(true);
  });
});
