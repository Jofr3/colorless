import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  HAND_REFRESH_DECK,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setPrizes,
} from "./testFixtures";

// M5 op-slice: handRefresh — the Iono/Judge hand-refresh Supporter family: put
// your hand back into your deck, then draw. Five real cards land on it, verified
// end to end through playTrainer:
//   • Youngster (sv01-198) — shuffle hand into deck, draw 5 (self only);
//   • Judge (sv01-176) — EACH player shuffles hand into deck, draws 4 (both);
//   • Brassius (sv03-187) — shuffle hand into deck, draw (hand size + 1);
//   • Katy (sv01-177) — shuffle hand into deck, draw 8, YOUR TURN ENDS;
//   • Iono (sv02-185) — EACH player's hand to the BOTTOM (deck order survives),
//     each draws their own remaining Prize count, and only if a hand moved.
// The op is fully automatic (never parks). `who: "both"` (Judge, Iono) reaches
// the OPPONENT's hand/deck — count-only events keep every card hidden.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (so a Supporter is legal, §4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_REFRESH_DECK, p2: HAND_REFRESH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Every uid held anywhere on `seat`'s side, sorted — a card is only ever MOVED
    between zones, never created or destroyed, so this multiset is invariant. */
function seatUids(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

function handCount(state: GameState, seat: Seat): number {
  return state.players[seat].hand.length;
}

/** TEST SURGERY: leave `keep` alone in `seat`'s hand, parking the rest in its
    discard — no uid leaves the game, so the state stays legal-shaped. */
function handOnly(state: GameState, seat: Seat, keep: string[]): GameState {
  const side = state.players[seat];
  const rest = side.hand.filter((u) => !keep.includes(u));
  const updated = { ...side, hand: keep, discard: [...side.discard, ...rest] };
  return { ...state, players: { ...state.players, [seat]: updated } };
}


describe("M5 op-slice — handRefresh (the hand-refresh Supporter family)", () => {
  it("registry resolves a program for each authored id (incl. the Katy/Iono reprints)", () => {
    const ids = ["sv01-198", "sv01-176", "sv03-187", "sv01-177", "sv01-237"];
    for (const id of [...ids, "sv02-185", "sv02-254", "sv02-269"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  // ── Youngster — self only, fixed draw 5 ──────────────────────────────────
  it("Youngster shuffles your hand into your deck and draws exactly 5 (self only)", () => {
    let state = board(1);
    state = handFromDeck(state, "p1", "sv01-198", 1);
    const uid = handUid(state, "p1", "sv01-198");
    const handBefore = handCount(state, "p1");
    const p1Before = seatUids(state, "p1");
    const p2Before = seatUids(state, "p2");

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(handCount(after, "p1")).toBe(5);
    expect(after.players.p1.discard).toContain(uid); // Youngster to the discard
    // Card conservation: the same multiset of uids on each side afterwards.
    expect(seatUids(after, "p1")).toEqual(p1Before);
    expect(seatUids(after, "p2")).toEqual(p2Before);
    // p2 is entirely untouched (self only).
    expect(after.players.p2).toEqual(state.players.p2);

    const shuffled = findAll(events, "HAND_SHUFFLED_INTO_DECK");
    expect(shuffled).toHaveLength(1);
    expect(shuffled[0]).toMatchObject({ seat: "p1", count: handBefore - 1 });
    const drawn = findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ seat: "p1", uids: expect.any(Array) });
    expect(drawn[0]?.uids).toHaveLength(5);
  });

  it("HAND_SHUFFLED_INTO_DECK is COUNT-ONLY — it names no card (hidden hand)", () => {
    let state = board(2);
    state = handFromDeck(state, "p1", "sv01-198", 1);
    const uid = handUid(state, "p1", "sv01-198");
    const { events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const shuffled = find(events, "HAND_SHUFFLED_INTO_DECK");
    expect(shuffled).toBeDefined();
    // The event carries a count, never the shuffled uids.
    expect(shuffled && "uids" in shuffled).toBe(false);
    expect(typeof shuffled?.count).toBe("number");
  });

  // ── Judge — BOTH players, fixed draw 4 ───────────────────────────────────
  it("Judge refreshes BOTH players' hands to 4 and conserves cards on each side", () => {
    let state = board(3);
    state = handFromDeck(state, "p1", "sv01-176", 1);
    const uid = handUid(state, "p1", "sv01-176");
    const p1HandBefore = handCount(state, "p1");
    const p2HandBefore = handCount(state, "p2");
    const p1Before = seatUids(state, "p1");
    const p2Before = seatUids(state, "p2");

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(handCount(after, "p1")).toBe(4);
    expect(handCount(after, "p2")).toBe(4);
    expect(seatUids(after, "p1")).toEqual(p1Before); // no card created/destroyed
    expect(seatUids(after, "p2")).toEqual(p2Before);

    const shuffled = findAll(events, "HAND_SHUFFLED_INTO_DECK");
    expect(shuffled.map((e) => e.seat)).toEqual(["p1", "p2"]); // controller first
    expect(shuffled[0]).toMatchObject({ seat: "p1", count: p1HandBefore - 1 });
    expect(shuffled[1]).toMatchObject({ seat: "p2", count: p2HandBefore });
    // Both sides' shuffle events stay count-only (the opponent's hand is hidden
    // from the controller — the first op to touch the opponent's hand/deck).
    for (const e of shuffled) expect("uids" in e).toBe(false);

    const drawn = findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
    expect(drawn.map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(drawn[0]?.uids).toHaveLength(4);
    expect(drawn[1]?.uids).toHaveLength(4);
  });

  // ── Brassius — self, draw (hand size + 1) ────────────────────────────────
  it("Brassius draws the pre-shuffle hand size + 1 (net +1, returns hand to its pre-play size)", () => {
    let state = board(4);
    state = handFromDeck(state, "p1", "sv03-187", 1);
    const uid = handUid(state, "p1", "sv03-187");
    const handBefore = handCount(state, "p1"); // includes Brassius

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // Discard Brassius (hand → handBefore-1), shuffle those in, draw (handBefore-1)+1
    // → the hand returns to handBefore.
    expect(handCount(after, "p1")).toBe(handBefore);
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({ count: handBefore - 1 });
    const drawn = findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
    expect(drawn[0]?.uids).toHaveLength(handBefore);
  });

  // ── Katy — self, draw 8, YOUR TURN ENDS ──────────────────────────────────
  it("Katy draws 8 and ENDS your turn (the trainerEndsTurn fold)", () => {
    let state = board(5);
    state = handFromDeck(state, "p1", "sv01-177", 1);
    const uid = handUid(state, "p1", "sv01-177");

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // The refresh drew 8 before the turn ended (the effect ran to completion).
    const drawnByP1 = findAll(events, "CARDS_DRAWN").filter(
      (e) => e.reason === "effect" && e.seat === "p1",
    );
    expect(drawnByP1[0]?.uids).toHaveLength(8);
    // Then the turn ends: control folds to P2's turn (past the Checkup), exactly
    // like Koraidon's endsTurn — not back to P1's turn:action.
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(find(events, "TURN_STARTED")).toBeDefined();
  });

  // ── Iono — BOTH players' hands to the BOTTOM, draw their Prize count ─────
  it("Iono puts BOTH hands on the bottom and leaves each deck's ORDER intact", () => {
    let state = board(9);
    state = handFromDeck(state, "p1", "sv02-185", 1);
    const uid = handUid(state, "p1", "sv02-185");
    const p1Hand = state.players.p1.hand.filter((u) => u !== uid);
    const p2Hand = [...state.players.p2.hand];
    const p1Deck = [...state.players.p1.deck];
    const p2Deck = [...state.players.p2.deck];
    const p1Prizes = state.players.p1.prizes.length;
    const p2Prizes = state.players.p2.prizes.length;

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // THE point of Iono over Judge: no deck is shuffled, so each player draws
    // EXACTLY the cards that were already on top, in order…
    expect(after.players.p1.hand).toEqual(p1Deck.slice(0, p1Prizes));
    expect(after.players.p2.hand).toEqual(p2Deck.slice(0, p2Prizes));
    // …the undrawn remainder keeps its order, and the old hand sits UNDER it
    // (order randomized by the shuffle, membership exact).
    const deckSurvived = (seat: Seat, before: string[], hand: string[], drawn: number) => {
      const kept = before.length - drawn;
      expect(after.players[seat].deck.slice(0, kept)).toEqual(before.slice(drawn));
      expect(after.players[seat].deck.slice(kept).sort()).toEqual([...hand].sort());
    };
    deckSurvived("p1", p1Deck, p1Hand, p1Prizes);
    deckSurvived("p2", p2Deck, p2Hand, p2Prizes);
    // "Each player SHUFFLES their hand and puts it on the bottom": the bottomed
    // cards are not in hand order — the only thing stopping a player who watched
    // that hand from knowing the deck's tail exactly (the deck itself is NOT
    // shuffled here, so nothing else hides it).
    expect(after.players.p1.deck.slice(p1Deck.length - p1Prizes)).not.toEqual(p1Hand);
    expect(after.players.p2.deck.slice(p2Deck.length - p2Prizes)).not.toEqual(p2Hand);
    expect(after.rngState).not.toBe(state.rngState); // two hand shuffles were drawn

    // The placement event is the bottom one, controller first — never the
    // shuffle-into-deck one (a different, publicly different fact).
    const bottomed = findAll(events, "HAND_TO_BOTTOM_OF_DECK");
    expect(bottomed.map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(bottomed[0]).toMatchObject({ count: p1Hand.length });
    expect(bottomed[1]).toMatchObject({ count: p2Hand.length });
    for (const e of bottomed) expect("uids" in e).toBe(false); // count-only
    expect(findAll(events, "HAND_SHUFFLED_INTO_DECK")).toHaveLength(0);
    expect(findAll(events, "SHUFFLE")).toHaveLength(0);
  });

  it("Iono draws each player their OWN remaining Prize count (the behind player draws more)", () => {
    let state = board(10);
    state = handFromDeck(state, "p1", "sv02-185", 1);
    state = setPrizes(state, "p1", 2); // p1 is ahead: 2 Prizes left → draws 2
    state = setPrizes(state, "p2", 5); // p2 is behind: 5 Prizes left → draws 5
    const uid = handUid(state, "p1", "sv02-185");
    const p1Before = seatUids(state, "p1");
    const p2Before = seatUids(state, "p2");

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(handCount(after, "p1")).toBe(2);
    expect(handCount(after, "p2")).toBe(5);
    expect(seatUids(after, "p1")).toEqual(p1Before); // card conservation, both sides
    expect(seatUids(after, "p2")).toEqual(p2Before);
    const drawn = findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
    expect(drawn.map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(drawn[0]?.uids).toHaveLength(2);
    expect(drawn[1]?.uids).toHaveLength(5);
  });

  it("Iono's every-hand-moved gate: with BOTH hands empty nobody draws", () => {
    let state = board(11);
    state = handFromDeck(state, "p1", "sv02-185", 1);
    const uid = handUid(state, "p1", "sv02-185");
    state = handOnly(state, "p1", [uid]); // Iono alone — discarded before the op
    state = handOnly(state, "p2", []);

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // "If either player put any cards on the bottom of their deck in this way" —
    // neither did, so the draw clause never happens for EITHER player.
    expect(findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect")).toHaveLength(0);
    expect(handCount(after, "p1")).toBe(0);
    expect(handCount(after, "p2")).toBe(0);
    expect(after.players.p1.deck).toEqual(state.players.p1.deck); // decks untouched
    expect(after.players.p2.deck).toEqual(state.players.p2.deck);
    // Nothing was there to randomize, so no randomness was consumed either — the
    // whole play is a true no-op (rng.ts shuffles a length ≤ 1 input for free).
    expect(after.rngState).toBe(state.rngState);
    // The placement still happened (0 cards) for both — an honest, non-leaky count.
    expect(findAll(events, "HAND_TO_BOTTOM_OF_DECK").map((e) => e.count)).toEqual([0, 0]);
  });

  it("Iono's gate opens on EITHER player — an empty-handed controller still draws", () => {
    let state = board(12);
    state = handFromDeck(state, "p1", "sv02-185", 1);
    const uid = handUid(state, "p1", "sv02-185");
    state = handOnly(state, "p1", [uid]); // only p2 will move cards
    const p2Prizes = state.players.p2.prizes.length;

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const drawn = findAll(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
    expect(drawn.map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(handCount(after, "p1")).toBe(state.players.p1.prizes.length);
    expect(handCount(after, "p2")).toBe(p2Prizes);
  });

  it("Iono short-draws a deck shallower than the Prize count — and does NOT deck out", () => {
    let state = board(14);
    state = handFromDeck(state, "p1", "sv02-185", 1);
    const uid = handUid(state, "p1", "sv02-185");
    // Surgery: p1 keeps 2 cards in hand and a 1-card deck, so the bottomed hand is
    // the ONLY thing left to draw from — 3 cards against 6 Prizes.
    const side = state.players.p1;
    const keep = side.hand.filter((u) => u !== uid).slice(0, 2);
    state = handOnly(state, "p1", [uid, ...keep]);
    const p1 = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...p1, deck: p1.deck.slice(0, 1), discard: [...p1.discard, ...p1.deck.slice(1)] },
      },
    };
    const p1Before = seatUids(state, "p1");

    const { state: after } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // The 1-card deck + the 2 bottomed cards are all that can be drawn (§14.3
    // deck-out is a turn-START rule, so an empty deck here is legal, not a loss).
    expect(handCount(after, "p1")).toBe(3);
    expect(after.players.p1.deck).toHaveLength(0);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(seatUids(after, "p1")).toEqual(p1Before);
  });

  it("Iono is deterministic and pure (both hands bottomed off one frozen state)", () => {
    const run = (): GameState => {
      let state = board(13);
      state = handFromDeck(state, "p1", "sv02-185", 1);
      const uid = handUid(state, "p1", "sv02-185");
      deepFreeze(state);
      return mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    };
    const a = run();
    const b = run();
    expect(a.players.p1.deck).toEqual(b.players.p1.deck);
    expect(a.players.p2.deck).toEqual(b.players.p2.deck);
    expect(a.players.p1.hand).toEqual(b.players.p1.hand);
    expect(a.players.p2.hand).toEqual(b.players.p2.hand);
  });

  // ── Edges ────────────────────────────────────────────────────────────────
  it("plays from an empty hand and short-draws a shallow deck (Youngster, deck of 2)", () => {
    let state = board(6);
    state = handFromDeck(state, "p1", "sv01-198", 1);
    const uid = handUid(state, "p1", "sv01-198");
    // Surgery: leave ONLY Youngster in hand and a 2-card deck; park every other
    // card in the discard so no uid leaves the game (a legal-shaped state).
    const side = state.players.p1;
    const others = side.hand.filter((u) => u !== uid);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          hand: [uid],
          deck: side.deck.slice(0, 2),
          discard: [...side.discard, ...others, ...side.deck.slice(2)],
        },
      },
    };

    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    // Hand emptied (Youngster discarded), so count 0; the 2-card deck yields only
    // a 2-card short-draw (§14.3 deck-out is a turn-START rule, not here).
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({ count: 0 });
    expect(handCount(after, "p1")).toBe(2);
    expect(after.players.p1.deck).toHaveLength(0);
  });

  // ── Purity + determinism ─────────────────────────────────────────────────
  it("is pure — running against a deep-frozen state does not mutate it", () => {
    let state = board(7);
    state = handFromDeck(state, "p1", "sv01-198", 1);
    const uid = handUid(state, "p1", "sv01-198");
    deepFreeze(state);
    const { state: after } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(handCount(after, "p1")).toBe(5); // ran to completion, no throw
  });

  it("is deterministic — same seed reshuffles+draws identically for BOTH players (Judge)", () => {
    const run = (): GameState => {
      let state = board(8);
      state = handFromDeck(state, "p1", "sv01-176", 1);
      const uid = handUid(state, "p1", "sv01-176");
      return mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    };
    const a = run();
    const b = run();
    expect(a.players.p1.hand).toEqual(b.players.p1.hand);
    expect(a.players.p1.deck).toEqual(b.players.p1.deck);
    expect(a.players.p2.hand).toEqual(b.players.p2.hand);
    expect(a.players.p2.deck).toEqual(b.players.p2.deck);
  });
});
