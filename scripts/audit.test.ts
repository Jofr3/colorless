import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditArgs, IGNORE_FILE, parseIgnoreList, staleEntries } from "./audit";
import { repoPath } from "./lib/repo";

describe("the shared audit ignore list", () => {
  it("parses dated, explained entries and skips comments and blank lines", () => {
    const text = [
      "# header",
      "",
      "GHSA-4w7w-66w2-5vf9 2026-11-10 no fix in hono yet; the route is not mounted",
      "  1234567 2026-10-01 numeric advisory id",
    ].join("\n");
    expect(parseIgnoreList(text)).toEqual([
      {
        id: "GHSA-4w7w-66w2-5vf9",
        added: "2026-11-10",
        reason: "no fix in hono yet; the route is not mounted",
      },
      { id: "1234567", added: "2026-10-01", reason: "numeric advisory id" },
    ]);
  });

  it("refuses an undated, unexplained or misdated entry", () => {
    expect(() => parseIgnoreList("GHSA-4w7w-66w2-5vf9")).toThrow(/:1: expected/);
    expect(() => parseIgnoreList("GHSA-4w7w-66w2-5vf9 2026-11-10")).toThrow(/expected/);
    expect(() => parseIgnoreList("# ok\nGHSA-4w7w-66w2-5vf9 no-date reason")).toThrow(/:2:/);
    expect(() => parseIgnoreList("GHSA-4w7w-66w2-5vf9 2026-02-30 reason")).toThrow(/expected/);
    expect(() => parseIgnoreList("GHSA-nope 2026-11-10 reason")).toThrow(/expected/);
  });

  it("passes every entry to bun audit as an --ignore, after CI's own flags", () => {
    expect(auditArgs([])).toEqual(["audit", "--prod", "--audit-level=moderate"]);
    expect(
      auditArgs([
        { id: "GHSA-4w7w-66w2-5vf9", added: "2026-11-10", reason: "r" },
        { id: "1234567", added: "2026-11-10", reason: "r" },
      ]),
    ).toEqual([
      "audit",
      "--prod",
      "--audit-level=moderate",
      "--ignore=GHSA-4w7w-66w2-5vf9",
      "--ignore=1234567",
    ]);
  });

  it("flags entries older than 30 days for review", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const entry = (added: string) => ({ id: "1", added, reason: "r" });
    expect(staleEntries([entry("2026-10-12"), entry("2026-10-10")], now)).toEqual([
      entry("2026-10-10"),
    ]);
  });

  it("is the file CI's audit step reads, and it parses", () => {
    const ci = readFileSync(repoPath(".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("run: bun scripts/audit.ts");
    expect(() => parseIgnoreList(readFileSync(repoPath(IGNORE_FILE), "utf8"))).not.toThrow();
  });
});
