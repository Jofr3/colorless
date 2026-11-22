import type { RedactedCard } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyTrayView, defaultTrayView } from "./simulatorTray";
import type { SimOption } from "./simulatorTypes";

function card(
  id: string,
  cardId: string,
  name: string,
  category: RedactedCard["category"] = "Pokemon",
  extra: Partial<RedactedCard> = {},
): RedactedCard {
  return {
    id,
    cardId,
    name,
    category,
    trainerType: category === "Trainer" ? (extra.trainerType ?? "Item") : null,
    ...(category === "Pokemon" ? { stage: extra.stage ?? "Basic" } : {}),
    hasImage: false,
    ...extra,
  };
}

function makeHarness(candidates: RedactedCard[], pool?: RedactedCard[], max = 2) {
  const view = defaultTrayView();
  const selected: string[] = [];
  let changes = 0;
  const energyTypes: Record<string, string> = { "energy-special": "Special" };
  const build = () => {
    const options: SimOption[] = candidates.map((c) => ({
      label: c.name,
      card: c,
      uid: c.id,
      selected: selected.includes(c.id),
      run: () => {
        const at = selected.indexOf(c.id);
        if (at >= 0) selected.splice(at, 1);
        else {
          if (selected.length >= max) selected.shift();
          selected.push(c.id);
        }
      },
    }));
    return applyTrayView(options, {
      view,
      pool,
      onChange: () => {
        changes++;
      },
      energyTypeOf: (id) => energyTypes[id],
    });
  };
  return { view, selected, build, changes: () => changes };
}

describe("simulatorTray", () => {
  it("hides Show all cards when no non-candidate pool cards exist", () => {
    const a = card("u1", "c1", "Dreepy");
    const h = makeHarness([a], [a]);
    const res = h.build();
    expect(res.header.map((b) => b.label)).toEqual(["Group cards", "Order: None"]);
  });

  it("toggles Show all cards to reveal non-matching pool cards as disabled in zone order", () => {
    const drakloak = card("u1", "c-drak", "Drakloak", "Pokemon", { stage: "Stage1" });
    const boss = card("u2", "c-boss", "Boss's Orders", "Trainer", { trainerType: "Supporter" });
    const dunsparce = card("u3", "c-duns", "Dunsparce", "Pokemon", { stage: "Basic" });
    const h = makeHarness([drakloak, dunsparce], [drakloak, boss, dunsparce]);

    let res = h.build();
    expect(res.header.map((b) => b.label)).toEqual([
      "Show all cards",
      "Group cards",
      "Order: None",
    ]);
    expect(res.header[0]?.selected).toBe(false);
    expect(res.header[0]?.colour).toBe("profile");
    expect(res.options.map((o) => o.uid)).toEqual(["u1", "u3"]);

    res.header[0]?.run();
    res = h.build();
    expect(h.changes()).toBe(1);
    expect(res.header[0]?.selected).toBe(true);
    expect(res.header[0]?.colour).toBe("green");
    expect(res.options.map((o) => [o.uid, !!o.disabled])).toEqual([
      ["u1", false],
      ["u2", true],
      ["u3", false],
    ]);
  });

  it("groups duplicates by cardId, expands when clicked to select more, and collapses on deselect", () => {
    const cards = [
      card("u1", "c-drak", "Drakloak", "Pokemon", { stage: "Stage1" }),
      card("u2", "c-duns", "Dunsparce"),
      card("u3", "c-duns", "Dunsparce"),
      card("u4", "c-budew", "Budew"),
      card("u5", "c-drak", "Drakloak", "Pokemon", { stage: "Stage1" }),
    ];
    const h = makeHarness(cards, undefined, 2);

    h.build().header[0]?.run(); // Group cards ON
    let res = h.build();
    expect(res.header[0]?.selected).toBe(true);
    expect(res.options.map((o) => [o.label, o.count ?? 1])).toEqual([
      ["Drakloak", 2],
      ["Dunsparce", 2],
      ["Budew", 1],
    ]);

    // Click Dunsparce group: selects first Dunsparce and expands the Dunsparce group in place.
    res.options[1]?.run();
    res = h.build();
    expect(res.options.map((o) => [o.uid, o.count ?? 1, !!o.selected])).toEqual([
      ["u1", 2, false],
      ["u2", 1, true],
      ["u3", 1, false],
      ["u4", 1, false],
    ]);

    // Select the second Dunsparce from the expanded group.
    res.options[2]?.run();
    res = h.build();
    expect(h.selected).toEqual(["u2", "u3"]);
    expect(res.options.map((o) => [o.uid, !!o.selected])).toEqual([
      ["u1", false],
      ["u2", true],
      ["u3", true],
      ["u4", false],
    ]);

    // Deselect both copies: Dunsparce collapses back into a counted stack.
    res.options[1]?.run();
    res = h.build();
    res.options[2]?.run();
    res = h.build();
    expect(res.options.map((o) => [o.label, o.count ?? 1])).toEqual([
      ["Drakloak", 2],
      ["Dunsparce", 2],
      ["Budew", 1],
    ]);
  });

  it("cycles Order by through None, Card type, Name and back to None", () => {
    const cards = [
      card("u1", "energy-special", "Neo Upper Energy", "Energy"),
      card("u2", "tr-stad", "Artazon", "Trainer", { trainerType: "Stadium" }),
      card("u3", "pk-s2", "Dragapult ex", "Pokemon", { stage: "Stage2" }),
      card("u4", "tr-item", "Buddy-Buddy Poffin", "Trainer", { trainerType: "Item" }),
      card("u5", "energy-basic", "Basic Fire Energy", "Energy"),
      card("u6", "pk-b", "Dreepy", "Pokemon", { stage: "Basic" }),
      card("u7", "tr-sup", "Arven", "Trainer", { trainerType: "Supporter" }),
      card("u8", "pk-s1", "Drakloak", "Pokemon", { stage: "Stage1" }),
      card("u9", "tr-tool", "Rescue Board", "Trainer", { trainerType: "Tool" }),
    ];
    const h = makeHarness(cards);

    // None: original order.
    let res = h.build();
    expect(res.header[1]?.label).toBe("Order: None");
    expect(res.header[1]?.colour).toBe("profile");
    expect(res.options.map((o) => o.uid)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
      "u6",
      "u7",
      "u8",
      "u9",
    ]);

    // Card type: Pokemon (Basic, Stage1, Stage2) -> Trainer (Supporter, Item, Tool, Stadium) -> Energy (Normal, Special).
    res.header[1]?.run();
    res = h.build();
    expect(res.header[1]?.label).toBe("Order: Card type");
    expect(res.header[1]?.colour).toBe("blue");
    expect(res.header[1]?.selected).toBeFalsy();
    expect(res.options.map((o) => o.label)).toEqual([
      "Dreepy",
      "Drakloak",
      "Dragapult ex",
      "Arven",
      "Buddy-Buddy Poffin",
      "Rescue Board",
      "Artazon",
      "Basic Fire Energy",
      "Neo Upper Energy",
    ]);

    // Name: alphabetical across all cards.
    res.header[1]?.run();
    res = h.build();
    expect(res.header[1]?.label).toBe("Order: Name");
    expect(res.header[1]?.colour).toBe("blue");
    expect(res.options.map((o) => o.label)).toEqual([
      "Artazon",
      "Arven",
      "Basic Fire Energy",
      "Buddy-Buddy Poffin",
      "Dragapult ex",
      "Drakloak",
      "Dreepy",
      "Neo Upper Energy",
      "Rescue Board",
    ]);

    // Back to None.
    res.header[1]?.run();
    res = h.build();
    expect(res.header[1]?.label).toBe("Order: None");
    expect(res.options.map((o) => o.uid)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
      "u6",
      "u7",
      "u8",
      "u9",
    ]);
  });

  it("keeps pool-only and host-distinct cards in separate groups when grouping", () => {
    const view = defaultTrayView();
    view.group = true;
    const e1 = card("e1", "fire", "Fire Energy", "Energy");
    const e2 = card("e2", "fire", "Fire Energy", "Energy");
    const e3 = card("e3", "fire", "Fire Energy", "Energy");
    const res = applyTrayView(
      [
        { label: "Fire Energy — Active", card: e1, uid: "e1", run: () => {} },
        { label: "Fire Energy — Active", card: e2, uid: "e2", run: () => {} },
        { label: "Fire Energy — Bench", card: e3, uid: "e3", run: () => {} },
      ],
      { view, onChange: () => {}, groupKeyOf: (o) => o.label },
    );
    expect(res.options.map((o) => [o.label, o.count ?? 1])).toEqual([
      ["Fire Energy — Active", 2],
      ["Fire Energy — Bench", 1],
    ]);
  });
});
