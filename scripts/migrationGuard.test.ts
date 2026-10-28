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

  it("fails a drop or rename the Worker still serving would read, but not a rebuild's own rename", () => {
    for (const sql of [
      "ALTER TABLE `decks` DROP COLUMN `folder_id`;",
      "ALTER TABLE `cards` RENAME COLUMN `suffix` TO `name_suffix`;",
      "ALTER TABLE cards RENAME suffix TO name_suffix;",
      "ALTER TABLE `folders` RENAME TO `deck_folders`;",
    ]) {
      const report = migrationGuardReport([{ name: "0013_contract.sql", sql }]);
      expect(report.ok, sql).toBe(false);
      expect(report.lines.join("\n")).toContain("CONTRACTS_REVIEWED");
    }
    const rebuild = migrationGuardReport([
      { name: "0013_rebuild.sql", sql: "ALTER TABLE `__new_decks` RENAME TO `decks`;" },
    ]);
    expect(rebuild.lines.join("\n")).not.toContain("CONTRACTS_REVIEWED");
  });
});
