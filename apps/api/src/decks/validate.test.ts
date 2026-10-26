import { describe, expect, it } from "vitest";
import { unknownIds } from "./validate";

describe("unknownIds", () => {
  it("returns the ids missing from the known set, in request order", () => {
    expect(unknownIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("returns [] when everything is known", () => {
    expect(unknownIds(["a", "b"], ["b", "a", "extra"])).toEqual([]);
  });

  it("reports each missing id once", () => {
    expect(unknownIds(["a", "a", "b"], ["b"])).toEqual(["a"]);
  });
});
