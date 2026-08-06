import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  LOOK_AT_TOP_DECK,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
  types,
} from "./testFixtures";

// M5 op-slice: lookAtTopN (§15.E) — the top-of-deck twin of searchDeck. Two real
// cards land on it, verified end to end:
//   • Great Ball (sv02-183) — look at the top 7, reveal a Pokémon → hand;
//   • Pokégear 3.0 (sv01-186) — look at the top 7, reveal a Supporter → hand.
// The candidates are ONLY the top-N matches (not the whole deck), then the
// trailing shuffleDeck op scrambles the looked-at cards back. Like searchDeck it
// is "up to" (declinable) and parks on the same chooseCards prompt.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The uid of the deck card at `index` (0 = top) in `seat`'s deck. */
function deckAt(state: GameState, seat: "p1" | "p2", index: number): string {
  const uid = state.players[seat].deck[index];
  if (uid === undefined) throw new Error(`${seat} deck has no card at index ${index}`);
  return uid;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (the coverage-suite board shape). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: LOOK_AT_TOP_DECK, p2: LOOK_AT_TOP_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

describe("M5 op-slice — lookAtTopN", () => {
  it("registry resolves a program for each authored id", () => {
    for (const id of ["sv02-183", "sv01-186"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("Great Ball parks on the top-7 Pokémon, then puts a pick in hand and shuffles", () => {
    let state = board(1);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    // Seed the top: bury a Pokémon under 7 fillers (so it is NOT in the window),
    // then put 2 Pokémon on top (prepend order = deepest first).
    state = toDeckTop(state, "p1", "fix-basic-2", 1); // the deep marker (below top 7)
    state = toDeckTop(state, "p1", "fix-energy", 7); // 7 non-Pokémon fillers
    state = toDeckTop(state, "p1", "fix-basic-1", 2); // 2 Pokémon on top
    const topA = deckAt(state, "p1", 0);
    const topB = deckAt(state, "p1", 1);
    const deepPoke = deckAt(state, "p1", 9); // fix-basic-2, past the top 7

    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.max).toBe(1);
    expect(parked.phase.prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon into your hand.",
    );
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.size).toBe(2); // the 2 Pokémon in the top 7…
    expect(candidates.has(topA)).toBe(true);
    expect(candidates.has(topB)).toBe(true);
    expect(candidates.has(deepPoke)).toBe(false); // …NOT the one past the window

    const handBefore = parked.players.p1.hand.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [topA] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ seat: "p1" });
    expect(find(events, "DECK_TOP_REVEALED")?.uids).toEqual([topA]);
    // The pick moved deck → hand; the other looked-at cards stay in the deck…
    expect(done.players.p1.hand).toContain(topA);
    expect(done.players.p1.hand.length).toBe(handBefore + 1);
    expect(done.players.p1.deck).not.toContain(topA);
    expect(done.players.p1.deck).toContain(topB);
    expect(done.players.p1.deck).toContain(deepPoke);
    // …and the trailing shuffleDeck op fired (the looked-at top is hidden again).
    expect(types(events)).toContain("SHUFFLE");
  });

  it("Pokégear 3.0 reveals only a Supporter from the top 7 (a Pokémon there is not a candidate)", () => {
    let state = board(2);
    state = handFromDeck(state, "p1", "sv01-186", 1);
    // Top 7: a Pokémon + energy fillers + a Supporter (Professor's Research). The
    // supporter filter must offer ONLY the Supporter.
    state = toDeckTop(state, "p1", "fix-energy", 4);
    state = toDeckTop(state, "p1", "fix-basic-1", 1); // a Pokémon — excluded
    state = toDeckTop(state, "p1", "sv01-189", 1); // Professor's Research (Supporter)
    const supporter = deckAt(state, "p1", 0);
    const pokemonInWindow = deckAt(state, "p1", 1);

    const uid = handUid(state, "p1", "sv01-186");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Supporter card into your hand.",
    );
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.has(supporter)).toBe(true);
    expect(candidates.has(pokemonInWindow)).toBe(false); // the Pokémon is not a Supporter

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [supporter] },
    });
    expect(find(events, "DECK_TOP_REVEALED")?.uids).toEqual([supporter]);
    expect(done.players.p1.hand).toContain(supporter);
    expect(done.players.p1.deck).toContain(pokemonInWindow);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("looks at EXACTLY the top 7 — a match at index 6 is a candidate, one at index 7 is not", () => {
    let state = board(3);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    // Build [energy×6, Pokémon@6, Pokémon@7, …]: the 7th card (index 6) is in the
    // window, the 8th (index 7) is just past it.
    state = toDeckTop(state, "p1", "fix-basic-2", 1); // will land at index 7
    state = toDeckTop(state, "p1", "fix-basic-1", 1); // will land at index 6
    state = toDeckTop(state, "p1", "fix-energy", 6); // fillers at indices 0..5
    const atSix = deckAt(state, "p1", 6);
    const atSeven = deckAt(state, "p1", 7);

    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.size).toBe(1); // exactly the index-6 Pokémon
    expect(candidates.has(atSix)).toBe(true);
    expect(candidates.has(atSeven)).toBe(false);

    // The wire guard: a match DEEPER than the window is not a candidate, so a
    // client trying to take it is rejected (validateChoice against candidates).
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [atSeven] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  // 🛑🛑 D241 — THE TWO CASES BELOW FLIPPED, AND THE FLIP IS THE SLICE'S POINT.
  // Both used to assert `not.toContain("DECK_TOP_REVEALED")` on the reasoning
  // that "nothing moved", and that reasoning is the fidelity defect
  // `coverage-backlog-legal.md` filed against this op: the WHIFF and the DECLINE
  // are exactly the two paths where a player reads the top of a deck and the
  // opponent is told nothing at all. A look transfers INFORMATION; the move is
  // only its consequence. The event now fires with `uids: []` on both, and
  // `log.ts` renders it "looked at the top of their deck — took nothing".
  //
  // ⚠️ WHAT WOULD TURN THESE RED (conventions.md): reverting `revealFromTop`'s
  // early `return state` or `stepOp`'s empty-window push. Both are installed as
  // mutants, and so is the OTHER READING of the question — a build that fires the
  // row only when cards actually move, which is what shipped before this slice.
  it("a top 7 with no matching card parks nowhere but STILL announces the look and shuffles", () => {
    let state = board(4);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    // Fill the whole window with non-Pokémon (energy) — Great Ball finds nothing.
    state = toDeckTop(state, "p1", "fix-energy", 7);
    const uid = handUid(state, "p1", "sv02-183");
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(after.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    // THE LOOK HAPPENED. Great Ball read seven cards its controller now knows;
    // the row is what tells the other seat so, and it names nothing.
    const looked = find(events, "DECK_TOP_REVEALED");
    expect(looked).toMatchObject({ seat: "p1", uids: [] });
    expect(looked?.dest).toBeUndefined(); // absent = the hand (D135), never `"hand"`
    // The looked-at cards are shuffled back regardless (the trailing shuffleDeck).
    expect(types(events)).toContain("SHUFFLE");
  });

  it("an EMPTY deck emits no look at all — announcing one that did not happen is the mirror defect", () => {
    let state = board(11);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    // The one board where nobody looked: there is no top to read.
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, deck: [] } } };
    const uid = handUid(state, "p1", "sv02-183");
    const { events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
  });

  it("declining (take none) when a candidate exists moves nothing but STILL shuffles", () => {
    let state = board(5);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    state = toDeckTop(state, "p1", "fix-basic-1", 2); // 2 Pokémon on top → it parks
    const topA = deckAt(state, "p1", 0);
    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose"); // a candidate exists → parks

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] }, // …but the player declines
    });
    expect(done.phase.kind).toBe("turn:action");
    // D241 — the DECLINE is announced too: the player saw the top 7 and chose to
    // leave it, which the opponent has to be able to read off the log.
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ seat: "p1", uids: [] });
    expect(types(events)).toContain("SHUFFLE"); // the trailing shuffleDeck still fires
    expect(done.players.p1.deck).toContain(topA); // the candidate stays in the deck
  });

  it("respects max — Great Ball offers max 1, so picking 2 is rejected", () => {
    let state = board(6);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    state = toDeckTop(state, "p1", "fix-basic-1", 2);
    const topA = deckAt(state, "p1", 0);
    const topB = deckAt(state, "p1", 1);
    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [topA, topB] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("never mutates the input state — both the play AND the reveal move (frozen boards)", () => {
    let state = board(8);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    state = toDeckTop(state, "p1", "fix-basic-1", 2);
    const uid = handUid(state, "p1", "sv02-183");
    // 1. The play up to the park (stepOp only reads the deck top).
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
    // 2. The RESOLVE — the path that runs revealFromTop, the deck→hand mutation;
    //    freezing the parked state proves it copies rather than splices.
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const pick = parked.phase.prompt.candidates.slice(0, 1);
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: pick },
      }),
    ).not.toThrow();
  });
});
