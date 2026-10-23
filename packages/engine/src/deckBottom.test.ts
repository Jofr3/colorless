import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyChoice } from "./interpreter";
import { programFor } from "./registry";
import {
  DECK_BOTTOM_DECK,
  benchFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const SEED = 20260721;

const DENDRA = "sv02-179";
const SKWOVET = "sv01-151";

function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, the shape every Trainer suite here uses. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK_BOTTOM_DECK, p2: DECK_BOTTOM_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function withHand(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p1;
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, "p1", id, 1);
  return next;
}

/** p1's board: `activeId` Active, `benchIds` benched in order. */
function withBoard(state: GameState, activeId: string, benchIds: readonly string[]): GameState {
  let next = setActiveFromDeck(state, "p1", activeId);
  next = { ...next, players: { ...next.players, p1: { ...next.players.p1, bench: [] } } };
  for (const id of benchIds) next = benchFromDeck(next, "p1", id);
  return next;
}

/** Shrink p1's deck to its top `n` cards, the rest into the discard pile. The
    deck's LENGTH is what makes a short-draw reachable, and its bottom is where
    the payment lands, so several tests need to name both ends. */
function withDeckSize(state: GameState, n: number): GameState {
  const side = state.players.p1;
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.slice(0, n),
        discard: [...side.discard, ...side.deck.slice(n)],
      },
    },
  };
}

describe("the registry rows", () => {
  it("resolves a program for every authored id, reprints included", () => {
    for (const id of ["sv02-179", "sv02-250", "sv02-266"]) {
      expect(programFor(id)?.trainer?.[0]).toEqual({
        op: "payFromHand",
        count: 1,
        to: "deckBottom",
        // §9.2 — the payment is filed so the printed "if you do" can read it.
        recordAs: "paid",
      });
    }
    for (const id of ["sv01-151", "sv01-222"]) {
      expect(programFor(id)?.abilities?.[0]?.name).toBe("Nest Stash");
    }
  });
});

describe("Dendra — the payment that goes UNDER THE DECK", () => {
  it("parks on an exact 1-card pick whose destination is the DECK, not the discard", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Dendra + three DISTINGUISHABLE others, so the pick is a real question.
    state = withHand(state, [DENDRA, "fix-item", "fix-grass-energy", "fix-water-energy"]);
    const { state: parked, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.dest).toBe("deckBottom");
    // The whole printed sentence, "if you do" included (§9.2): the note now
    // carries what the ANSWER buys, read off the recordGate behind this op.
    expect(prompt.note).toBe(
      "Put a card from your hand on the bottom of your deck. If you do, draw cards until you have 5 cards in your hand.",
    );
    expect(prompt.candidates).toHaveLength(3);
    // The payment parks BEFORE the draw it buys — the printed sentence order.
    expect(types(events)).not.toContain("HAND_COST_PAID");
    expect(types(events)).not.toContain("CARDS_DRAWN");
  });

  it("puts the paid card at the very BOTTOM and draws to 5 — the order is observable", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, "fix-item", "fix-grass-energy", "fix-water-energy"]);
    const before = census(state, "p1");
    const deckBefore = [...state.players.p1.deck];
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = prompt.candidates[0] as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [paid] },
    });
    // PAID FIRST, THEN DRAWN: the hand was 3 after the play, 2 after the payment,
    // so the draw is THREE — paying afterwards would have drawn two and ended at
    // 4. That off-by-one is the whole reason the cost is the program's first op.
    const cost = findEvent(events, "HAND_COST_PAID");
    expect(cost?.uids).toEqual([paid]);
    expect(cost?.to).toBe("deckBottom");
    // The PAYER — the field a per-seat event filter keys on beside `to`, and the
    // one no assertion in the repo had ever read.
    expect(cost?.seat).toBe("p1");
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(types(events).indexOf("HAND_COST_PAID")).toBeLessThan(
      types(events).indexOf("CARDS_DRAWN"),
    );
    expect(done.players.p1.hand).toHaveLength(5);
    expect(done.players.p1.hand).not.toContain(paid);
    // UNDER the deck: last position, and the deck's own order above it untouched
    // (three cards came off the top, nothing was shuffled).
    expect(done.players.p1.deck.at(-1)).toBe(paid);
    expect(done.players.p1.deck.slice(0, -1)).toEqual(deckBefore.slice(3));
    // It is NOT in the discard pile — the destination is the whole point.
    expect(done.players.p1.discard).not.toContain(paid);
    expect(done.phase.kind).toBe("turn:action");
    expect(census(done, "p1")).toEqual(before);
  });

  it("the played Dendra itself is in the DISCARD, never on the bottom of the deck", () => {
    // playTrainer discards the Supporter up front; only the PAYMENT goes under
    // the deck. A card that put itself there would come back around.
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, "fix-item", "fix-grass-energy"]);
    const dendraUid = handUid(state, "p1", DENDRA);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: dendraUid,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.candidates).not.toContain(dendraUid);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
    });
    expect(done.players.p1.discard).toContain(dendraUid);
    expect(done.players.p1.deck).not.toContain(dendraUid);
  });

  it("asks nothing when the payable hand is all copies — the collapse, at this destination too", () => {
    // Three interchangeable fix-items collapse to one candidate, so there is no
    // decision left and the whole card resolves in ONE reduction.
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, "fix-item", "fix-item", "fix-item"]);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    expect(done.phase.kind).toBe("turn:action");
    const cost = findEvent(events, "HAND_COST_PAID");
    expect(cost?.uids).toHaveLength(1);
    expect(cost?.to).toBe("deckBottom");
    expect(done.players.p1.hand).toHaveLength(5);
  });

  it("draws NOTHING when paying still leaves 5 or more — drawUntilHandSize never trims", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [
      DENDRA,
      "fix-item",
      "fix-item",
      "fix-item",
      "fix-item",
      "fix-item",
      "fix-item",
    ]);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    expect(types(events)).toContain("HAND_COST_PAID");
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(done.players.p1.hand).toHaveLength(5);
  });

  it("can draw the paid card straight back when the deck is shallower than the draw", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, "fix-grass-energy", "fix-water-energy"]);
    state = withDeckSize(state, 2);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = prompt.candidates[0] as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [paid] },
    });
    // Hand was 2 after the play, 1 after paying; the draw wants 4 and the deck
    // holds 3 (2 + the payment), so it short-draws the lot, payment included.
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(done.players.p1.deck).toHaveLength(0);
    expect(done.players.p1.hand).toContain(paid);
    expect(done.players.p1.hand).toHaveLength(4);
  });

  it("REFUSES the play on a hand of nothing else — the printed parenthetical, verbatim", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA]);
    const uid = handUid(state, "p1", DENDRA);
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "PLAY_CONDITION_NOT_MET");
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
    if (result.ok) throw new Error("unreachable");
    // The message speaks the card's own VERB — "put … on the bottom of your
    // deck", never "discard", which is the whole point of `to` reaching the
    // rejection and not just the apply.
    expect(result.error.message).toContain(
      "put another card from your hand on the bottom of your deck",
    );
    // Nothing was committed — the Supporter is still in hand and the allowance
    // unspent, so the turn is exactly where it was.
    expect(state.players.p1.hand).toContain(uid);
    expect(state.allowances.supporterPlayed).toBe(false);
  });

  it("is a SUPPORTER — one per turn, and the second copy is refused", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, DENDRA, "fix-item", "fix-item"]);
    const first = handUid(state, "p1", DENDRA);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid: first });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the payment to park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const item = prompt.candidates.find((uid) => parked.cardIdByUid[uid] === "fix-item");
    if (item === undefined) throw new Error("expected an item on offer");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [item] },
    });
    expect(done.allowances.supporterPlayed).toBe(true);
    const second = done.players.p1.hand.find((u) => done.cardIdByUid[u] === DENDRA);
    if (second === undefined) throw new Error("expected the second Dendra still in hand");
    expectErr(done, { type: "playTrainer", seat: "p1", uid: second }, "SUPPORTER_ALREADY_PLAYED");
  });

  it("plays on a hand of exactly Dendra + one card — the gate's boundary", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [DENDRA, "fix-item"]);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", DENDRA),
    });
    // One candidate = no question: paid inline, then drawn to 5.
    expect(done.phase.kind).toBe("turn:action");
    expect(findEvent(events, "HAND_COST_PAID")?.to).toBe("deckBottom");
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(5);
    expect(done.players.p1.hand).toHaveLength(5);
  });
});

describe("the deckBottom apply's wire guards", () => {
  it("never conjures a card into the deck from outside the hand", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy"]);
    const before = census(state, "p1");
    const deckCard = state.players.p1.deck[0] as string;
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 1, to: "deckBottom" },
      { kind: "cards", uids: [deckCard] },
      { seat: "p1" },
      {},
      events,
    );
    expect(events).toHaveLength(0);
    expect(next).toBe(state); // nothing paid → the same state object
    expect(census(next, "p1")).toEqual(before);
  });

  it("pays a repeated uid ONCE — never twice onto the bottom", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy"]);
    const before = census(state, "p1");
    const uid = handUid(state, "p1", "fix-item");
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 2, to: "deckBottom" },
      { kind: "cards", uids: [uid, uid] },
      { seat: "p1" },
      {},
      events,
    );
    expect(findEvent(events, "HAND_COST_PAID")?.uids).toEqual([uid]);
    expect(next.players.p1.deck.filter((u) => u === uid)).toHaveLength(1);
    expect(next.players.p1.deck.at(-1)).toBe(uid);
    expect(census(next, "p1")).toEqual(before);
  });

  it("ignores a choice of the wrong KIND rather than paying something", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy"]);
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 1, to: "deckBottom" },
      { kind: "pokemonMulti", refs: [] },
      { seat: "p1" },
      {},
      events,
    );
    expect(next).toBe(state);
    expect(events).toHaveLength(0);
  });

  it("keeps the PICKED order when several cards are paid at once", () => {
    // No printed card pays more than one to this destination yet, so the order is
    // ours to define: the pick, which needs no rng and reads back exactly.
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy", "fix-water-energy"]);
    const first = handUid(state, "p1", "fix-water-energy");
    const second = handUid(state, "p1", "fix-item");
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 2, to: "deckBottom" },
      { kind: "cards", uids: [first, second] },
      { seat: "p1" },
      {},
      events,
    );
    expect(next.players.p1.deck.slice(-2)).toEqual([first, second]);
    expect(next.players.p1.hand).toEqual([handUid(state, "p1", "fix-grass-energy")]);
  });
});

describe("Skwovet 'Nest Stash' — the same destination, the WHOLE hand", () => {
  /** Skwovet Active with `handIds` in hand, on p1's open turn. */
  function skwovetBoard(handIds: readonly string[]): GameState {
    let state = board(SEED);
    state = withBoard(state, SKWOVET, []);
    return withHand(state, handIds);
  }

  const NEST_STASH = {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "Nest Stash",
  } as const;

  it("puts the hand under the deck and draws 1 — the deck's order above it survives", () => {
    const state = skwovetBoard(["fix-item", "fix-grass-energy", "fix-water-energy"]);
    const before = census(state, "p1");
    const deckBefore = [...state.players.p1.deck];
    const { state: done, events } = mustApply(state, NEST_STASH);
    expect(findEvent(events, "HAND_TO_BOTTOM_OF_DECK")?.count).toBe(3);
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
    // The card drawn is the deck's ORIGINAL top card: the hand went underneath,
    // so nothing about the next draws changed. (That is `toBottom`'s entire
    // reason for existing, and it is what separates this from Youngster.)
    expect(done.players.p1.hand).toEqual([deckBefore[0]]);
    expect(done.players.p1.deck).toHaveLength(deckBefore.length + 2);
    expect(done.players.p1.deck.slice(0, deckBefore.length - 1)).toEqual(deckBefore.slice(1));
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
    expect(census(done, "p1")).toEqual(before);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("draws NOTHING off an empty hand — the printed 'if you put any cards … in this way'", () => {
    const state = skwovetBoard([]);
    const { state: done, events } = mustApply(state, NEST_STASH);
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(done.players.p1.hand).toHaveLength(0);
    expectErr(done, NEST_STASH, "ABILITY_ALREADY_USED");
  });

  it("is once per turn per Pokémon — and a SECOND Skwovet has its own allowance", () => {
    let state = skwovetBoard(["fix-item", "fix-grass-energy"]);
    state = benchFromDeck(state, "p1", SKWOVET);
    const { state: once } = mustApply(state, NEST_STASH);
    expectErr(once, NEST_STASH, "ABILITY_ALREADY_USED");
    // The benched copy is a different Pokémon, so its own "once during your turn"
    // is untouched — and it works from the BENCH (activeOnly: false, as printed).
    const { state: twice, events } = mustApply(once, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Nest Stash",
    });
    expect(findEvent(events, "HAND_TO_BOTTOM_OF_DECK")?.count).toBe(1); // the card just drawn
    expect(twice.players.p1.hand).toHaveLength(1);
  });

  it("works on a Skwovet PLAYED from hand, not just one placed by surgery", () => {
    // Every other test here puts Skwovet in play by test surgery, which never
    // reads the fixture's stage or HP. Playing it to the Bench does: a Basic is
    // what `playBasicToBench` requires, and the card is a 60 HP Basic.
    let state = board(SEED);
    state = withBoard(state, "fix-attacker", []);
    state = withHand(state, [SKWOVET, "fix-item", "fix-grass-energy"]);
    const uid = handUid(state, "p1", SKWOVET);
    const played = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    expect(played.players.p1.bench).toHaveLength(1);
    const { state: done, events } = mustApply(played, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Nest Stash",
    });
    // The hand it puts under the deck is the one AFTER the Skwovet left it.
    expect(findEvent(events, "HAND_TO_BOTTOM_OF_DECK")?.count).toBe(2);
    expect(done.players.p1.hand).toHaveLength(1);
  });

  it("never touches the OPPONENT's hand — `who: 'you'`, unlike Iono", () => {
    const state = skwovetBoard(["fix-item", "fix-grass-energy"]);
    const p2Hand = [...state.players.p2.hand];
    const p2Deck = [...state.players.p2.deck];
    const { state: done, events } = mustApply(state, NEST_STASH);
    expect(done.players.p2.hand).toEqual(p2Hand);
    expect(done.players.p2.deck).toEqual(p2Deck);
    expect(events.filter((e) => e.type === "HAND_TO_BOTTOM_OF_DECK")).toHaveLength(1);
  });
});
