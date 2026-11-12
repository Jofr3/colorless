import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { hasRuleBox, isMegaEvolutionPokemonEx, pokemonSuffixOf, prizeValueOf } from "./cards";
import type { GameState } from "./index";
import { programFor } from "./registry";
import { simulationGaps } from "./simulationGaps";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  deckOf,
  driveSetup,
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const TEPIG: Card = battler("mep-050", {
  name: "Tepig",
  hp: 80,
  types: ["Fire"],
  retreat: 2,
  attacks: [
    {
      cost: ["Fire", "Fire"],
      name: "Ember",
      effect: "Discard an Energy from this Pokémon.",
      damage: 40,
    },
  ],
  weaknesses: [{ type: "Water", value: "x2" }],
});

const MISTY: Card = {
  ...battler("30th-c-005"),
  name: "Misty",
  category: "Trainer",
  stage: null,
  hp: null,
  types: null,
  retreat: null,
  trainerType: null,
  effect:
    "Discard 2 of the other cards in your hand in order to play this card. If this turn's attack does damage to the Defending Pokémon (after applying Weakness and Resistance), and if the attacking Pokémon has missy in its name, the attack does 20 more damage to the Defending Pokémon.",
};

const WALL = "reg-wall";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [TEPIG.id]: TEPIG,
  [MISTY.id]: MISTY,
  [WALL]: battler(WALL, { name: "REG Wall", hp: 300, types: ["Colorless"] }),
};
const DECK = deckOf({
  [TEPIG.id]: 4,
  [MISTY.id]: 4,
  [WALL]: 8,
  "fix-fire-energy": 20,
  "fix-fire-energy-alt": 4,
  "fix-energy": 20,
});

function board(): GameState {
  let state = driveSetup(0x6e6, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", TEPIG.id);
  return setActiveFromDeck(state, "p2", WALL);
}

describe("2026-11-12 re-ingest: the changed rows the engine plays", () => {
  it("Tepig mep-050 Ember: 40 damage, then one Energy leaves Tepig", () => {
    expect(simulationGaps(TEPIG)).toEqual([]);
    const state = attachFromDeck(
      attachFromDeck(board(), "p1", "fix-fire-energy", 1),
      "p1",
      "fix-fire-energy-alt",
      1,
    );
    const energy = [...(state.players.p1.active?.energy ?? [])];
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(done.players.p2.active?.damage).toBe(40);
    const kept = done.players.p1.active?.energy ?? [];
    expect(kept).toHaveLength(1);
    expect(energy).toContain(kept[0]);
    expect(done.players.p1.discard).toEqual(energy.filter((u) => u !== kept[0]));
    expect(events.map((e) => e.type)).toContain("ENERGY_DISCARDED");
  });

  it("Tepig mep-050 cannot use Ember on one {R}", () => {
    const state = attachFromDeck(board(), "p1", "fix-fire-energy", 1);
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "ATTACK_COST_UNMET");
  });

  it("Misty 30th-c-005 has no Trainer type in the catalog: a gap, refused in play, kept in hand", () => {
    expect(programFor(MISTY.id)).toBeUndefined();
    expect(simulationGaps(MISTY)).toEqual(["trainer"]);
    const state = handFromDeck(board(), "p1", MISTY.id, 1);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === MISTY.id) as string;
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "TRAINER_TYPE_UNSUPPORTED");
    expect(state.players.p1.hand).toContain(uid);
  });

  it("the rule box is read from the name, so the catalog's ex / EX / missing suffix tag changes nothing", () => {
    const named = (id: string, name: string) => battler(id, { name });
    const megaDiancie = named("me02-041", "Mega Diancie ex");
    const me06Ex = named("me06-x", "Sample ex");
    expect([pokemonSuffixOf(megaDiancie), isMegaEvolutionPokemonEx(megaDiancie)]).toEqual([
      "ex",
      true,
    ]);
    expect(prizeValueOf(megaDiancie)).toBe(3);
    expect([pokemonSuffixOf(me06Ex), hasRuleBox(me06Ex), prizeValueOf(me06Ex)]).toEqual([
      "ex",
      true,
      2,
    ]);
    expect("suffix" in megaDiancie).toBe(false);
  });
});
