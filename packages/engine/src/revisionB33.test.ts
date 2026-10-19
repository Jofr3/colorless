import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  completeSetup,
  deckOf,
  discardFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ── CARD REVISION, BATCH B33 (Attacks) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B33"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1
// `cards.attacks_json`, byte for byte below):
//
//   Mudsdale `sv05-092` / `sv05-175` "Mud Stock" {F}: *"Attach a Basic {F} Energy card from your
//   discard pile to each of your Benched Pokémon."*
//
// THE BUG. The `toEach` fold (interpreter.ts `attachEnergyFrom`) walked `attachEnergyTargets` in Bench
// order and attached until the pile ran dry, so with fewer Basic {F} Energy in the discard pile than
// Benched Pokémon the FIRST Benched bodies were always fed and the player was never asked. "Each of"
// with a short pile is "do as much as you can", and WHICH Benched Pokémon get the cards is the
// player's decision: the op now parks a `choosePokemonMulti` with `min === max ===` the pile size
// over the Benched targets. A pile that covers every body still asks nothing.

const MUD_STOCK =
  "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.";
const HIGH_HORSEPOWER = "This Pokémon also does 40 damage to itself.";

const PRINTINGS = ["sv05-092", "sv05-175"] as const;
const F = "fix-fighting-energy";

const mudsdale = (id: string): Card =>
  battler(id, {
    name: "Mudsdale",
    hp: 150,
    types: ["Fighting"],
    weaknesses: [],
    resistances: [],
    attacks: [
      { cost: ["Fighting"], name: "Mud Stock", effect: MUD_STOCK },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "High Horsepower",
        effect: HIGH_HORSEPOWER,
        damage: 140,
      },
    ],
  });

const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  ...Object.fromEntries(PRINTINGS.map((id) => [id, mudsdale(id)])),
};

const deckFor = (holder: string) =>
  deckOf({ [holder]: 4, "fix-basic-1": 12, [F]: 14, "fix-energy": 30 });

/** P1's turn 3: `holder` Active with one {F} for its cost, three fix-basic-1 on the Bench, and
    `pile` Basic {F} Energy (plus two Colorless Basic Energy the print does not admit) in P1's
    discard pile. */
function board(holder: string, pile: number, benched = 3, seed = 7): GameState {
  const deck = deckFor(holder);
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") {
    throw new Error(`expected P1's turn, got ${state.phase.kind}`);
  }
  state = setActiveFromDeck(handToDeck(state, "p1", holder), "p1", holder);
  state = clearBench(state, "p1");
  for (let i = 0; i < benched; i += 1) {
    state = benchFromDeck(handToDeck(state, "p1", "fix-basic-1"), "p1", "fix-basic-1");
  }
  state = attachFromDeck(handToDeck(state, "p1", F), "p1", F, 1);
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, discard: [] } } };
  state = discardFromDeck(handToDeck(state, "p1", "fix-energy"), "p1", "fix-energy", 2);
  if (pile > 0) state = discardFromDeck(state, "p1", F, pile);
  return state;
}

const benchRef = (index: number) => ({ seat: "p1" as const, spot: { spot: "bench" as const, index } });
const benchEnergy = (state: GameState) => state.players.p1.bench.map((p) => p.energy.length);
const fInDiscard = (state: GameState) =>
  state.players.p1.discard.filter((uid) => state.cardIdByUid[uid] === F).length;

describe("B33 — Mud Stock: a short pile lets the player choose which Benched Pokémon are fed", () => {
  it.each(PRINTINGS)("%s: ONE {F} over THREE Benched Pokémon parks a pick of exactly 1", (id) => {
    const state = board(id, 1);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    if (parked.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.declinable).toBe(false);
    // The Benched targets only — "each of your BENCHED Pokémon"; the attacker is not offered.
    expect(prompt.candidates).toEqual([benchRef(0), benchRef(1), benchRef(2)]);

    // The player feeds the LAST Benched body — the one the old fold could never reach.
    const { state: done, events: fed } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(2)] },
    });
    const attached = fed.filter((e) => e.type === "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(benchEnergy(done)).toEqual([0, 0, 1]);
    const [onBody] = done.players.p1.bench[2]?.energy ?? [];
    expect(done.cardIdByUid[onBody ?? ""]).toBe(F);
    expect(fInDiscard(done)).toBe(0);
    // The Colorless Basic Energy the print does not admit stay in the pile.
    expect(done.players.p1.discard).toHaveLength(2);
    // The attacker keeps only its cost.
    expect(done.players.p1.active?.energy).toHaveLength(1);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it.each(PRINTINGS)("%s: TWO {F} over THREE Benched Pokémon parks a pick of exactly 2", (id) => {
    const state = board(id, 2);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
    expect([prompt.min, prompt.max]).toEqual([2, 2]);

    // Fewer than the pile is not "as much as you can" — refused.
    const short = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(1)] },
    });
    expect(short.ok).toBe(false);
    // The Active is not a Benched Pokémon — refused.
    const active = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p1", spot: { spot: "active" } }, benchRef(1)] },
    });
    expect(active.ok).toBe(false);

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(2)] },
    });
    expect(benchEnergy(done)).toEqual([1, 0, 1]);
    // Two DIFFERENT cards, one per chosen body.
    const fed = done.players.p1.bench.flatMap((p) => p.energy);
    expect(new Set(fed).size).toBe(2);
    expect(fInDiscard(done)).toBe(0);
  });

  it.each(PRINTINGS)("%s: a pile that covers every Benched Pokémon still asks nothing", (id) => {
    for (const pile of [3, 4]) {
      const state = board(id, pile);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      expect(done.phase.kind).not.toBe("effect:choose");
      expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(3);
      expect(benchEnergy(done)).toEqual([1, 1, 1]);
      expect(fInDiscard(done)).toBe(pile - 3);
    }
  });

  it.each(PRINTINGS)("%s: an empty {F} pile is a silent whiff", (id) => {
    const state = board(id, 0);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    expect(benchEnergy(done)).toEqual([0, 0, 0]);
    expect(done.players.p1.discard).toHaveLength(2);
  });
});

describe("B33 — the short-pile park's caption names the shortfall and the count", () => {
  it.each([
    [1, "Not enough Energy for all your Benched Pokémon — attach it to which one?"],
    [2, "Not enough Energy for all your Benched Pokémon — attach 1 each to which 2?"],
  ] as const)("%i {F} over three Benched Pokémon", (pile, note) => {
    const { state: parked } = mustApply(board("sv05-092", pile), { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${parked.phase.kind}`);
    expect(parked.phase.prompt.note).toBe(note);
  });
});
