import { describe, expect, it } from "vitest";
import { currentSymbol, enclosingSymbol } from "./symbol";

const SOURCE = `const A = 1;
export function spread(x: number) {
  return x - 10;
}
function snipe(x: number) {
  return x - 10;
}
export const REGISTRY: Record<string, number> = {
  "sv1-25": 1 + 2,
  plain: 3 + 4,
};
`;

const symbolAt = (fragment: string, from = 0) => {
  const at = SOURCE.indexOf(fragment, from);
  return enclosingSymbol("a.ts", SOURCE, at, at + fragment.length);
};

describe("enclosingSymbol", () => {
  it("names the top-level function around a fragment", () => {
    expect(symbolAt("return x - 10;")).toBe("spread");
    expect(symbolAt("return x - 10;", SOURCE.indexOf("snipe"))).toBe("snipe");
  });

  it("adds the object key inside a top-level object literal", () => {
    expect(symbolAt("1 + 2")).toBe("REGISTRY.sv1-25");
    expect(symbolAt("3 + 4")).toBe("REGISTRY.plain");
  });

  it("is undefined across declarations and outside TypeScript", () => {
    expect(symbolAt("const A = 1;\nexport function")).toBeUndefined();
    expect(enclosingSymbol("a.json", SOURCE, 0, 5)).toBeUndefined();
  });
});

describe("currentSymbol", () => {
  it("needs the find to occur exactly once", () => {
    expect(currentSymbol({ file: "a.ts", find: "return x - 10;" }, SOURCE)).toBeUndefined();
    expect(currentSymbol({ file: "a.ts", find: "x: number) {\n  return" }, SOURCE)).toBeUndefined();
    expect(currentSymbol({ file: "a.ts", find: "const A = 1;" }, SOURCE)).toBe("A");
  });
});
