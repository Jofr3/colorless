import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { evolveFromOf } from "./cards";
import { applyAction, programFor } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  JACQ_DECK,
  deckOf,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  types,
} from "./testFixtures";

// M5 long-tail: the `evolutionPokemon` CardFilter (the searcher whose narrowing is
// exactly one new filter kind, the D102 vocabulary-extension pattern). One real
// card lands on it, verified end to end:
//   • Jacq (sv01-175 / -236 / -250, Supporter) — "Search your deck for up to 2
//     Evolution Pokémon, reveal them, and put them into your hand. Then, shuffle
//     your deck."
// It reuses the Flamigo search-to-hand shape (searchDeck dest:hand max:2 +
// shuffleDeck); the only new thing is the predicate `evolveFromOf(card) !== null`
// — the exact complement of `basicPokemon` inside `anyPokemon`.

/** The card behind a uid (deck/hand cards for candidate classification). */
function cardOf(state: GameState, uid: string): Card {
  const id = state.cardIdByUid[uid];
  const card = id === undefined ? undefined : state.cardPool[id];
  if (card === undefined) throw new Error(`no card for uid ${uid}`);
  return card;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (the coverage-suite board shape). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: JACQ_DECK, p2: JACQ_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

describe("M5 long-tail — the evolutionPokemon CardFilter (Jacq)", () => {
  it("registry resolves a program for each authored Jacq id", () => {
    for (const id of ["sv01-175", "sv01-236", "sv01-250"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("evolveFromOf — the predicate is the exact complement of a Basic", () => {
    const isEvolution = (id: string): boolean => evolveFromOf(FIXTURE_POOL[id] as Card) !== null;
    // Non-null (an Evolution): a Stage 1 / Stage 2 card.
    expect(isEvolution("fix-stage1")).toBe(true);
    expect(isEvolution("fix-stage2")).toBe(true);
    // Null: a Basic Pokémon, a non-Pokémon (Energy), and a Trainer (Jacq itself).
    expect(isEvolution("fix-basic-1")).toBe(false);
    expect(isEvolution("fix-energy")).toBe(false);
    expect(isEvolution("sv01-175")).toBe(false);
  });

  it("Jacq parks and offers ONLY the deck's Evolution Pokémon (no Basics, no Energy)", () => {
    let state = board(1);
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.max).toBe(2);
    // The searchNote captions the new filter through retrieveNoun (plural, no
    // article — "Evolution Pokémon" like "Pokémon").
    expect(parked.phase.prompt.note).toBe(
      "Search your deck for up to 2 Evolution Pokémon into your hand.",
    );

    const candidates = parked.phase.prompt.candidates;
    expect(candidates.length).toBeGreaterThan(0);
    // Every candidate is an Evolution Pokémon…
    for (const c of candidates) {
      expect(evolveFromOf(cardOf(parked, c))).not.toBeNull();
    }
    // …and a Basic still sitting in the deck is NOT offered.
    const basicInDeck = parked.players.p1.deck.find((u) => cardOf(parked, u).id === "fix-basic-1");
    expect(basicInDeck).toBeDefined();
    expect(candidates).not.toContain(basicInDeck);
  });

  it("takes up to 2 into the hand, removes them from the deck, then shuffles", () => {
    let state = board(2);
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");

    const picks = parked.phase.prompt.candidates.slice(0, 2);
    expect(picks.length).toBe(2);
    const handBefore = parked.players.p1.hand.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picks },
    });

    expect(done.phase.kind).toBe("turn:action");
    // The two picks moved deck → hand…
    expect(done.players.p1.hand).toContain(picks[0]);
    expect(done.players.p1.hand).toContain(picks[1]);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.players.p1.deck).not.toContain(picks[0]);
    expect(done.players.p1.deck).not.toContain(picks[1]);
    // …and the trailing shuffleDeck op fired.
    expect(types(events)).toContain("SHUFFLE");
  });

  it("respects max — Jacq offers max 2, so picking 3 is rejected", () => {
    let state = board(3);
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");

    const three = parked.phase.prompt.candidates.slice(0, 3);
    expect(three.length).toBe(3);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: three } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("declining (take none) when candidates exist moves nothing but STILL shuffles", () => {
    let state = board(4);
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const wasCandidate = parked.phase.prompt.candidates[0];

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.deck).toContain(wasCandidate); // the candidate stays in the deck
    expect(types(events)).toContain("SHUFFLE"); // the trailing shuffleDeck still fires
  });

  it("no Evolution Pokémon in the deck — a no-op that never parks, but STILL plays + shuffles (no whiff gate)", () => {
    // A Jacq deck with only Basics/Energy: the filter finds nothing.
    const noEvo = deckOf({ "fix-basic-1": 40, "sv01-175": 4, "fix-energy": 16 });
    let state = driveSetup(5, { p1: noEvo, p2: noEvo }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(after.phase.kind).toBe("turn:action"); // never parks…
    expect(types(events)).not.toContain("EFFECT_PENDING"); // …no choice offered…
    expect(types(events)).toContain("SHUFFLE"); // …but the Supporter is still spent + shuffles.
  });

  it("never mutates the input state — both the play AND the reveal move (frozen boards)", () => {
    let state = board(1);
    state = handFromDeck(state, "p1", "sv01-175", 1);
    const uid = handUid(state, "p1", "sv01-175");
    // 1. The play up to the park.
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
    // 2. The RESOLVE — the deck → hand mutation; freezing proves it copies.
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const pick = parked.phase.prompt.candidates.slice(0, 2);
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: pick },
      }),
    ).not.toThrow();
  });
});
