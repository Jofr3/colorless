import { describe, expect, it } from "vitest";
import { duplicateIds } from "./precheck";

describe("duplicateIds", () => {
  it("names each id more than one row carries, once", () => {
    const rows = ["a", "b", "a", "c", "a", "c"].map((id) => ({ id }));
    expect(duplicateIds(rows)).toEqual(["a", "c"]);
  });

  it("names none when every id is distinct", () => {
    expect(duplicateIds([{ id: "a" }, { id: "b" }])).toEqual([]);
  });
});
