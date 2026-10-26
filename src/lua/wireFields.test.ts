import { describe, expect, it } from "vitest";
import { type RowKind, WIRE_ROWS, wireColumn, wireRow } from "./wireFields";

describe("Lua wire fields", () => {
  it("encodes a record in declared order behind its tag", () => {
    const row = wireRow(WIRE_ROWS.library.deck, {
      illegal: 1,
      tint: 20,
      count: 60,
      name: "Fire Rush",
      id: "d1",
    });
    expect(row).toEqual(["D", "d1", "Fire Rush", 60, 20, 1]);
    expect(row[wireColumn(WIRE_ROWS.library.deck, "illegal")]).toBe(1);
  });

  it("names the tag of a kind that has several, and an untagged header starts at column 0", () => {
    const footer = wireRow(
      WIRE_ROWS.sim.option,
      {
        token: "7",
        label: "Done",
        colour: "blue",
        disabled: false,
        selected: false,
        cardId: "",
        uid: "",
        dimmed: false,
      },
      "F",
    );
    expect(footer[0]).toBe("F");
    expect(footer[wireColumn(WIRE_ROWS.sim.option, "label")]).toBe("Done");
    expect(wireColumn(WIRE_ROWS.builder.header, "revision")).toBe(0);
  });

  it("gives every field of a kind its own column", () => {
    for (const kinds of Object.values(WIRE_ROWS))
      for (const [kind, spec] of Object.entries(kinds as Record<string, RowKind>))
        expect(new Set(spec.fields).size, kind).toBe(spec.fields.length);
  });
});
