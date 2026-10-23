import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath, repoSourceFiles } from "./repo";

describe("registerTestPrograms", () => {
  it("is called only by the vitest setup file", () => {
    const callers = repoSourceFiles(["ts", "tsx", "js", "mjs"])
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) =>
        /(?<!function )registerTestPrograms\(/.test(readFileSync(repoPath(file), "utf8")),
      );
    expect(callers).toEqual(["packages/engine/src/fixtures/vitestSetup.ts"]);
  });
});
