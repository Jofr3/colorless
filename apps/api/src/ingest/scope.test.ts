import { describe, expect, it } from "vitest";
import { CATALOG_SCOPE, ingestScope } from "./scope";

describe("ingestScope", () => {
  it("fetches the whole catalog when neither flag is given", () => {
    expect(ingestScope({})).toEqual({
      scope: { series: ["sv", "me"], sets: ["swsh10.5"] },
    });
    expect(ingestScope({})).toEqual({ scope: CATALOG_SCOPE });
  });

  it("fetches one serie for --serie", () => {
    expect(ingestScope({ serie: "me" })).toEqual({ scope: { series: ["me"], sets: [] } });
  });

  it("fetches the listed sets for --sets, trimmed and without empty entries", () => {
    expect(ingestScope({ sets: " sv01, sve,," })).toEqual({
      scope: { series: [], sets: ["sv01", "sve"] },
    });
  });

  it("refuses both flags, an empty --sets and an id tcgdex cannot have", () => {
    expect(ingestScope({ serie: "sv", sets: "sv01" })).toEqual({
      error: "pass either --sets or --serie, not both",
    });
    expect(ingestScope({ sets: " , " })).toEqual({ error: "--sets names no set" });
    expect(ingestScope({ serie: "../sv" })).toEqual({ error: 'not a tcgdex id: "../sv"' });
    expect(ingestScope({ sets: "sv01,a/b" })).toEqual({ error: 'not a tcgdex id: "a/b"' });
  });
});
