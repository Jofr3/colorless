import { FORMATS } from "@colorless/engine";
import { DECK_FORMAT_IDS } from "@colorless/schema";
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

describe("DECK_FORMAT_IDS", () => {
  it("names exactly the formats the engine plays, so no written format falls back to Standard", () => {
    expect([...DECK_FORMAT_IDS]).toEqual(FORMATS.map((format) => format.id));
  });
});
