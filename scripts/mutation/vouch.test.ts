import { describe, expect, it } from "vitest";
import { vouchedKeys } from "./vouch";

const keyed = new Map([
  ["a", ["packages/engine/src/attack.test.ts"]],
  ["b", ["src/Missing.test.ts"]],
  ["c", ["src/missing.test.ts", "scripts/mutation/"]],
]);
const ran = ["packages/engine/src/attack.test.ts", "scripts/mutation/apply.test.ts"];

describe("vouchedKeys", () => {
  it("vouches a key once any of its filters matched a file that ran", () => {
    expect(vouchedKeys(keyed, true, ran)).toEqual(["a", "c"]);
  });

  it("does not vouch a key whose filters matched nothing", () => {
    expect(vouchedKeys(keyed, true, ran)).not.toContain("b");
    expect(vouchedKeys(keyed, true, [])).toEqual([]);
  });

  it("matches filters as a case-insensitive substring of the path", () => {
    expect(vouchedKeys(keyed, true, ["src/missing.TEST.ts"])).toEqual(["b", "c"]);
  });

  it("vouches nothing for a red run", () => {
    expect(vouchedKeys(keyed, false, ran)).toEqual([]);
  });
});
