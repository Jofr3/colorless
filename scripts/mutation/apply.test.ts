import { describe, expect, it } from "vitest";
import { applyMutant } from "./apply";

describe("applyMutant", () => {
  it("replaces the occurrence of find", () => {
    expect(applyMutant("const x = 1;", "1", "2")).toBe("const x = 2;");
  });

  it("writes `$` sequences in the replacement literally", () => {
    for (const replace of ["$&", "$`", "$'", "$1", "$$"]) {
      expect(applyMutant("a/b/c", "b", replace)).toBe(`a/${replace}/c`);
    }
  });
});
