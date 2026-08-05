import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  GARDEVOIR_DECK,
  activeUid,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// M5 op-slice — the attachEnergyFrom RIDERS, authoring the marquee Gardevoir ex
// "Psychic Embrace": "As often as you like during your turn, you may attach a
// Basic {P} Energy card from your discard pile to 1 of your {P} Pokémon. If you
// attached Energy in this way, put 2 damage counters on that Pokémon. You can't
// use this Ability on a Pokémon that would be Knocked Out." → the three riders on
// the base attach op: targetType (only {P} Pokémon), bonusCounters (20 = 2), and
// notIfKO (exclude any target the counters would Knock Out); repeatable.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const EMBRACE = { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Psychic Embrace" } as const;

function gardBoard(seed: number): GameState {
  const state = driveSetup(seed, { p1: GARDEVOIR_DECK, p2: GARDEVOIR_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state; // P1 turn 2
}

/** Use Psychic Embrace, then (if it parked on the target choice) attach to `ref`. */
function useEmbrace(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  const first = mustApply(state, EMBRACE);
  if (first.state.phase.kind !== "effect:choose") return first; // forced (a single target)
  return mustApply(first.state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

describe("Gardevoir ex — Psychic Embrace (the attachEnergyFrom riders)", () => {
  it("attaches a {P} from discard AND puts 2 damage counters on the target, repeatable", () => {
    let state = gardBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-086"); // Gardevoir ex Active (its own {P} target)
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 2);
    const gardUid = activeUid(state, "p1");

    const r1 = useEmbrace(state, ACTIVE_REF);
    expect(r1.state.players.p1.active?.energy.length).toBe(1);
    expect(r1.state.players.p1.active?.damage).toBe(20); // the 2 counters
    expect(find(r1.events, "ENERGY_ATTACHED")).toMatchObject({ seat: "p1" });
    expect(find(r1.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      uid: gardUid,
      amount: 20,
      source: "ability",
    });
    // "As often as you like" — a SECOND use the same turn is allowed.
    const r2 = useEmbrace(r1.state, ACTIVE_REF);
    expect(r2.state.players.p1.active?.energy.length).toBe(2);
    expect(r2.state.players.p1.active?.damage).toBe(40);
  });

  it("attaches only the {P} energy, skipping other Basic energy in the discard", () => {
    let state = gardBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-086");
    state = discardFromDeck(state, "p1", "fix-energy", 1); // a Colorless (non-{P}) basic first
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 1); // the {P}
    const psychicUid = state.players.p1.discard.find((u) => state.cardIdByUid[u] === "fix-psychic-energy");
    const colorlessUid = state.players.p1.discard.find((u) => state.cardIdByUid[u] === "fix-energy");
    const { state: done } = useEmbrace(state, ACTIVE_REF);
    expect(done.players.p1.active?.energy).toContain(psychicUid);
    expect(done.players.p1.discard).not.toContain(psychicUid);
    expect(done.players.p1.discard).toContain(colorlessUid); // the non-{P} stayed put
  });

  it("targets ONLY the controller's {P} Pokémon (a non-{P} Pokémon is not a candidate)", () => {
    let state = gardBoard(2);
    state = setActiveFromDeck(state, "p1", "sv01-086"); // Gardevoir Active ({P}); setup body → bench[0] (non-{P})
    state = benchFromDeck(state, "p1", "fix-psychic-1"); // bench[1] is a {P} target
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 1);
    const parked = mustApply(state, EMBRACE).state;
    expect(parked.phase.kind).toBe("effect:choose"); // 2 {P} targets → a real choice
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const cands = parked.phase.prompt.candidates;
    // Gardevoir (Active) + fix-psychic-1 (bench[1]) — NOT the non-{P} fix-basic-1 (bench[0]).
    expect(cands).toHaveLength(2);
    expect(cands.some((c) => c.spot.spot === "bench" && c.spot.index === 0)).toBe(false);
  });

  it("notIfKO — a {P} Pokémon the 2 counters would Knock Out is excluded from the targets", () => {
    let state = gardBoard(3);
    state = setActiveFromDeck(state, "p1", "sv01-086"); // Gardevoir Active
    state = benchFromDeck(state, "p1", "fix-psychic-1"); // bench[1], a 60-HP {P}
    const nearDead = benchTopUid(state, "p1", 1);
    state = setBenchDamage(state, "p1", 1, 50); // 50 + 20 counters = 70 ≥ 60 → would be KO'd
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 1);
    // Only Gardevoir is eligible now (the near-dead {P} is excluded) → FORCED, no park.
    const { state: done } = useEmbrace(state, ACTIVE_REF);
    expect(done.phase.kind).toBe("turn:action");
    // The near-dead {P} got neither the energy nor the counters (still 50, no energy).
    const bench1 = done.players.p1.bench[1];
    expect(bench1 && activeUidMatches(bench1, nearDead)).toBe(true);
    expect(bench1?.damage).toBe(50);
    expect(bench1?.energy.length).toBe(0);
    // Gardevoir took the attach + counters instead.
    expect(done.players.p1.active?.energy.length).toBe(1);
    expect(done.players.p1.active?.damage).toBe(20);
  });

  it("rejects the Ability when the discard holds no {P} Energy (can only whiff)", () => {
    let state = gardBoard(4);
    state = setActiveFromDeck(state, "p1", "sv01-086"); // discard is empty → no {P} source
    expectErr(state, EMBRACE, "NO_LEGAL_TARGET");
  });

  it("never mutates the input state (frozen board survives Psychic Embrace)", () => {
    let state = gardBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-086");
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(() => applyAction(deepFreeze(state), EMBRACE)).not.toThrow();
  });
});

/** The bench Pokémon's stack-top uid is `uid` (guards the notIfKO test's slot). */
function activeUidMatches(pokemon: { stack: string[] }, uid: string): boolean {
  return pokemon.stack[pokemon.stack.length - 1] === uid;
}
