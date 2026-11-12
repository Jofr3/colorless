import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { hasRuleBox, isExOrV, pokemonSuffixOf, prizeValueOf } from "./cards";
import { applyAction } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  deckOf,
  driveSetup,
  must,
  mustApply,
  setDamage,
} from "./testFixtures";

/** The Expanded-legal Pokémon whose names carry an older Rule Box, as the catalog stores them. */
const GENESECT_EX = battler("30th-c-004", { name: "Genesect EX", hp: 170, types: ["Grass"] });
const RAYQUAZA_EX = battler("30th-c-016", { name: "Rayquaza EX", hp: 170, types: ["Dragon"] });
const M_GARDEVOIR_EX = battler("30th-c-023", { name: "M Gardevoir EX", hp: 210, types: ["Fairy"] });
const PIKACHU_ZEKROM_GX = battler("30th-c-008", {
  name: "Pikachu & Zekrom GX",
  hp: 240,
  types: ["Lightning"],
});
const BUZZWOLE_GX = battler("30th-c-013", { name: "Buzzwole GX", hp: 190, types: ["Fighting"] });
const LEGEND_TOP = battler("30th-c-019", {
  name: "Darkrai & Cresselia LEGEND",
  hp: 150,
  types: ["Darkness", "Psychic"],
});
const LEGEND_BOTTOM = { ...LEGEND_TOP, id: "30th-c-020" };
const GRENINJA_BREAK = battler("30th-c-009", {
  name: "Greninja BREAK",
  stage: "BREAK",
  hp: 170,
  types: ["Water"],
});
const CROBAT_G = battler("30th-c-011", { name: "Crobat G", hp: 80, types: ["Psychic"] });
/** Not a TAG TEAM: no GX suffix. */
const TERAPAGOS_FRIENDS = battler("svp-500", { name: "Terapagos & Friends", hp: 90 });

describe("older Rule Boxes: Prize count and Rule Box read from the name (COR-P0E)", () => {
  it("a Pokémon-EX, an M Pokémon-EX included, is a 2-Prize Rule Box with its own EX suffix", () => {
    for (const card of [GENESECT_EX, RAYQUAZA_EX, M_GARDEVOIR_EX]) {
      expect(pokemonSuffixOf(card), card.id).toBe("EX");
      expect(hasRuleBox(card), card.id).toBe(true);
      expect(prizeValueOf(card), card.id).toBe(2);
      // A Pokémon-EX is not a Pokémon ex: "Pokémon ex" readers leave it out.
      expect(isExOrV(card), card.id).toBe(false);
    }
  });

  it("a TAG TEAM gives 3 Prizes; a plain GX gives 2, and a name with & but no GX is no TAG TEAM", () => {
    expect(prizeValueOf(PIKACHU_ZEKROM_GX)).toBe(3);
    expect(prizeValueOf(BUZZWOLE_GX)).toBe(2);
    expect(prizeValueOf(TERAPAGOS_FRIENDS)).toBe(1);
    expect(hasRuleBox(TERAPAGOS_FRIENDS)).toBe(false);
  });

  it("each LEGEND half is a 2-Prize Rule Box with no suffix", () => {
    for (const card of [LEGEND_TOP, LEGEND_BOTTOM]) {
      expect(pokemonSuffixOf(card), card.id).toBeNull();
      expect(hasRuleBox(card), card.id).toBe(true);
      expect(prizeValueOf(card), card.id).toBe(2);
    }
  });

  it("a BREAK has a Rule Box and gives 1 Prize; a Pokémon SP is read as a plain Pokémon", () => {
    expect(hasRuleBox(GRENINJA_BREAK)).toBe(true);
    expect(prizeValueOf(GRENINJA_BREAK)).toBe(1);
    expect(hasRuleBox(CROBAT_G)).toBe(false);
    expect(prizeValueOf(CROBAT_G)).toBe(1);
  });
});

/** p1's fix-attacker (Bite, 30) against `defender`, damaged to one Bite from its Knock Out, with a
    second copy benched so the Knock Out owes a Prize pick rather than ending the game. */
function lethalBite(defender: Card): { state: GameState; events: string[] } {
  const pool = { ...FIXTURE_POOL, [defender.id]: defender };
  let state = driveSetup(
    11,
    {
      p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 }),
      p2: deckOf({ [defender.id]: 40, "fix-water-energy": 20 }),
    },
    {
      pool,
      first: "p1",
      active: { p1: "fix-attacker", p2: defender.id },
      bench: { p2: [defender.id] },
    },
  );
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setDamage(state, "p2", (defender.hp ?? 0) - 30);
  const done = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  return { state: done.state, events: done.events.map((event) => event.type) };
}

describe("older Rule Boxes in play: the Knock Out owes the printed Prizes (COR-P0E)", () => {
  it("Knocking Out Genesect EX owes 2 Prizes", () => {
    const { state, events } = lethalBite(GENESECT_EX);
    expect(events).toContain("KNOCKED_OUT");
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
  });

  it("Knocking Out Pikachu & Zekrom GX owes 3 Prizes", () => {
    const { state } = lethalBite(PIKACHU_ZEKROM_GX);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 3 });
  });
});
