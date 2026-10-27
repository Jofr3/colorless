import { describe, expect, it } from "vitest";
import { migrationGuardReport } from "./migration-guard";

describe("migration-guard", () => {
  it("passes additive migrations", () => {
    const report = migrationGuardReport([
      { name: "0001_a.sql", sql: "ALTER TABLE `cards` ADD `suffix` text;" },
      { name: "0002_b.sql", sql: "CREATE INDEX `x` ON `decks` (`user_id`);\nDROP INDEX `y`;" },
    ]);
    expect(report.ok).toBe(true);
  });

  it("fails each part of a drizzle-kit table rebuild", () => {
    for (const sql of [
      "PRAGMA foreign_keys=OFF;",
      "DROP TABLE `decks`;",
      "ALTER TABLE `__new_decks` RENAME TO `decks`;",
    ]) {
      const report = migrationGuardReport([{ name: "0011_rebuild.sql", sql }]);
      expect(report.ok, sql).toBe(false);
      expect(report.lines.join("\n")).toContain("apps/api/drizzle/0011_rebuild.sql");
    }
  });
});
