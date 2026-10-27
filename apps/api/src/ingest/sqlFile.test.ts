import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sqlFilePath } from "./sqlFile";

const DIR = "/tmp/ingest-run";

describe("sqlFilePath", () => {
  it("numbers and names the file inside the run's directory", () => {
    expect(sqlFilePath(DIR, 0, "series")).toBe(join(DIR, "000-series.sql"));
    expect(sqlFilePath(DIR, 12, "set-sv06.5")).toBe(join(DIR, "012-set-sv06.5.sql"));
  });

  it("keeps a crafted label inside the directory", () => {
    for (const label of ["set-x/../../../../drizzle/9999_evil", "../escape", "a\\b", "x\ny"]) {
      const path = sqlFilePath(DIR, 1, label);
      expect(resolve(path, "..")).toBe(resolve(DIR));
      expect(path).not.toContain("/../");
    }
  });
});
