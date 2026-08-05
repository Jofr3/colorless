import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyChoice } from "./interpreter";
import {
  HAND_COST_DECK,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: payFromHand — the printed hand COST, which PARKS.
//
// One mechanism under two printed wordings, and the wordings are not a style
// split. TRAINERS say "You can use this card only if you discard 2 OTHER cards
// from your hand" (Ultra Ball, Earthen Vessel's "ANOTHER card"); ABILITIES say
// "You must discard a card from your hand in order to use this Ability"
// (Tinkaton, Revavroom, Meowscarada ex, Radiant Blastoise) and never say
// "other" — because a Trainer sits in the very hand it pays out of and an
// Ability's card is on the board. That correlation is exact across the family,
// and it is why the gate excludes the played uid rather than the op carrying an
// `other` flag.
//
// Three claims the suite is built around:
//   1. IT IS A COST, so it is MANDATORY and exact — no decline, unlike every
//      other chooseCards park (which are all printed "up to").
//   2. IT IS PAID FIRST, and the order is observable: Revavroom pays, THEN draws
//      to a hand size that counts the payment.
//   3. IT VETOES THE PLAY when unpayable — the opposite call from attachFromTop
//      (D45), on the card's own printed authority rather than the engine's guess
//      that an op would whiff.

const SEED = 20260721;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every uid the seat holds anywhere, sorted — the card-conservation census. A
    cost MOVES cards hand → discard; it must never create or destroy one. */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (the coverage-suite board shape). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_COST_DECK, p2: HAND_COST_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild p1's HAND outright: every dealt card back into the deck, then exactly
    `ids` dealt off it. The whole family turns on hand SIZE and hand CONTENTS —
    the gate counts candidates, the prompt offers them — so a suite that let the
    setup deal whatever it drew would be asserting a different question per seed. */
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

const ULTRA_BALL = "sv01-196";
const EARTHEN_VESSEL = "sv06.5-096";
const REVAVROOM = "sv01-142";
const TINKATON = "sv02-105";
const RADIANT_BLASTOISE = "swsh10.5-018";
const MEOWSCARADA = "sv02-015";

describe("payFromHand — the printed cost PARKS, and it is mandatory", () => {
  it("Ultra Ball parks on an exact 2-card pick over the hand — min === max, no decline", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Ultra Ball + three DISTINGUISHABLE others, so the pick is a real question.
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy", "fix-special"]);
    const { state: parked, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // The COST's shape: exactly 2, into the DISCARD, and the note is the printed
    // instruction with no "other" — by now the Ultra Ball has already left hand,
    // so every card on offer IS another one.
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.dest).toBe("discard");
    expect(prompt.note).toBe("Discard 2 cards from your hand.");
    expect(prompt.candidates).toHaveLength(3);
    // The cost parks BEFORE the search it buys — no DECK_SEARCHED yet.
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).not.toContain("HAND_COST_PAID");
  });

  it("the played Ultra Ball is never a candidate to pay for itself", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy", "fix-special"]);
    const ballUid = handUid(state, "p1", ULTRA_BALL);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid: ballUid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.candidates).not.toContain(ballUid);
    // Not merely absent from the offer — it is already in the discard pile,
    // which is what makes the printed "other" automatic in the APPLY.
    expect(parked.players.p1.discard).toContain(ballUid);
    expect(parked.players.p1.hand).not.toContain(ballUid);
  });

  it("REJECTS a decline and a short pick — the one mandatory chooseCards park", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy", "fix-special"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const [a, b, c] = prompt.candidates as [string, string, string];
    // Empty — the decline every OTHER chooseCards consumer allows. Taking the
    // effect without paying is exactly what `min` exists to stop.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
    // One — short of the printed 2.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a] } },
      "BAD_EFFECT_CHOICE",
    );
    // Three — over the cap (the pre-existing max rule, re-pinned at min === max).
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, b, c] } },
      "BAD_EFFECT_CHOICE",
    );
    // The same uid twice is not two cards.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, a] } },
      "BAD_EFFECT_CHOICE",
    );
    // A card that was never offered (one still in the deck).
    const deckCard = parked.players.p1.deck[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, deckCard] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("pays the cost, THEN runs what it bought — one batch, printed order", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy", "fix-special"]);
    const before = census(state, "p1");
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = prompt.candidates.slice(0, 2);
    const { state: next, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    });
    const cost = find(events, "HAND_COST_PAID");
    expect(cost?.uids).toEqual(paid);
    for (const uid of paid) {
      expect(next.players.p1.hand).not.toContain(uid);
      expect(next.players.p1.discard).toContain(uid);
    }
    // The cost is announced BEFORE the search it bought — the printed sentence
    // order, and the reason the op is first in the program rather than a field.
    const order = types(events);
    expect(order.indexOf("HAND_COST_PAID")).toBeLessThan(order.indexOf("EFFECT_PENDING"));
    // Ultra Ball's own search parks next (the deck holds Pokémon), so the play
    // is not over — which is itself the proof that the cost did not consume it.
    expect(next.phase.kind).toBe("effect:choose");
    // Nothing created, nothing destroyed.
    expect(census(next, "p1")).toEqual(before);
  });

  it("auto-resolves with no prompt when the hand holds exactly the count", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Ultra Ball + exactly 2 others: the cost has no decision left in it.
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy"]);
    const others = [handUid(state, "p1", "fix-item"), handUid(state, "p1", "fix-grass-energy")];
    const { state: next, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual(others);
    expect(next.players.p1.hand.filter((u) => others.includes(u))).toHaveLength(0);
    // It went straight on to the search's own park — the cost asked nothing.
    if (next.phase.kind !== "effect:choose") throw new Error("expected the search to park");
    const prompt = next.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.min).toBe(0); // the SEARCH is the printed "up to" — declinable
    expect(prompt.dest).toBe("hand");
    // The SINGULAR search note, which this slice changed (searchNote now reads the
    // shared noun table) and which nothing else in the suite pins.
    expect(prompt.note).toBe("Search your deck for a Pokémon into your hand.");
  });

  it("collapses INTERCHANGEABLE copies, so identical cards ask nothing", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Ultra Ball + three identical Grass Energy. Discarding any two leaves the
    // same board, so the cost is not a question — cap `count` keeps 2 of the one
    // class, and an offer no bigger than the count resolves inline.
    state = withHand(state, [
      ULTRA_BALL,
      "fix-grass-energy",
      "fix-grass-energy",
      "fix-grass-energy",
    ]);
    const { state: next, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toHaveLength(2);
    // One Grass Energy is still in hand — the collapse decides WHAT IS ASKED, it
    // never decides how many are spent.
    expect(next.players.p1.hand).toHaveLength(1);
  });
});

describe("payFromHand — the play GATE is the card's own printed rule", () => {
  it("refuses Ultra Ball on a hand with only 1 OTHER card — the off-by-one", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Two cards in hand, but one of them IS the Ultra Ball: the printed "2 other
    // cards" is not met, though `hand.length` says 2. This is the whole reason
    // the gate excludes the played uid.
    state = withHand(state, [ULTRA_BALL, "fix-item"]);
    const ballUid = handUid(state, "p1", ULTRA_BALL);
    expectErr(
      state,
      { type: "playTrainer", seat: "p1", uid: ballUid },
      "PLAY_CONDITION_NOT_MET",
    );
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid: ballUid });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("2 other cards from your hand");
    // Refused costs NOTHING — asserted, not merely claimed: `applyAction` returns
    // the rejection and the caller keeps `state`, so the card is still in hand and
    // the discard never grew.
    expect(state.players.p1.hand).toContain(ballUid);
    expect(state.players.p1.discard).not.toContain(ballUid);
    expect(state.players.p1.hand).toHaveLength(2);
  });

  it("allows Ultra Ball at exactly 2 other cards — the boundary, both sides", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy"]);
    const { events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toHaveLength(2);
  });

  it("refuses Ultra Ball as the ONLY card in hand", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL]);
    expectErr(
      state,
      { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", ULTRA_BALL) },
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("Earthen Vessel is the same rule at count 1 — 'another card'", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    // Alone in hand → the printed "another card" cannot be paid.
    state = withHand(state, [EARTHEN_VESSEL]);
    const result = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", EARTHEN_VESSEL),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    // The SINGULAR reads as printed, not as "1 other cards".
    expect(result.error.message).toContain("another card from your hand");

    // One other card → payable, forced, and the Basic Energy search follows.
    let ok = board(SEED);
    ok = withBoard(ok, "fix-basic-1", []);
    ok = withHand(ok, [EARTHEN_VESSEL, "fix-item"]);
    const itemUid = handUid(ok, "p1", "fix-item");
    const { state: next, events } = mustApply(ok, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(ok, "p1", EARTHEN_VESSEL),
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([itemUid]);
    if (next.phase.kind !== "effect:choose") throw new Error("expected the search to park");
    const prompt = next.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // The PLURAL noun phrase, not a count prefixed onto an article — Earthen
    // Vessel is the first search for SEVERAL of something whose noun takes one.
    expect(prompt.note).toBe("Search your deck for up to 2 Basic Energy cards into your hand.");
  });
});

describe("payFromHand — the ABILITY wording, and the order it fixes", () => {
  it("Revavroom pays FIRST, so the draw counts the hand after the payment", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [REVAVROOM]);
    // Five in hand, exactly one of them an Energy → the cost is forced, and the
    // draw is to SIX. Paying first means 5 − 1 = 4 → draw 2. Paying afterwards
    // would draw 1 and leave 5. The final hand size is the whole witness.
    state = withHand(state, [
      "fix-item",
      "fix-item",
      "fix-basic-1",
      "fix-basic-1",
      "fix-grass-energy",
    ]);
    const energyUid = handUid(state, "p1", "fix-grass-energy");
    const { state: next, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Rumbling Engine",
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([energyUid]);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(2);
    expect(next.players.p1.hand).toHaveLength(6);
    expect(next.players.p1.discard).toContain(energyUid);
    // Order within the batch: ABILITY_USED, the payment, then the draw.
    const order = types(events);
    expect(order.indexOf("ABILITY_USED")).toBeLessThan(order.indexOf("HAND_COST_PAID"));
    expect(order.indexOf("HAND_COST_PAID")).toBeLessThan(order.indexOf("CARDS_DRAWN"));
  });

  it("Revavroom's anyEnergy takes a SPECIAL Energy and refuses a non-Energy", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [REVAVROOM]);
    // A Basic and a SPECIAL Energy are two distinguishable ways to pay, so this
    // is the family's first cost that genuinely asks; the Item is not a
    // candidate at all.
    state = withHand(state, ["fix-item", "fix-grass-energy", "fix-special"]);
    const itemUid = handUid(state, "p1", "fix-item");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Rumbling Engine",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.note).toBe("Discard an Energy card from your hand.");
    expect(prompt.min).toBe(1);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.candidates).not.toContain(itemUid);
    // Paying with the Special Energy is legal — the filter is `anyEnergy`.
    const specialUid = handUid(state, "p1", "fix-special");
    const { state: next } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [specialUid] },
    });
    expect(next.players.p1.discard).toContain(specialUid);
  });

  it("refuses Revavroom (ABILITY_COST_UNMET) with no Energy in hand", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [REVAVROOM]);
    state = withHand(state, ["fix-item", "fix-basic-1"]);
    expectErr(
      state,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Rumbling Engine",
      },
      "ABILITY_COST_UNMET",
    );
    // A hand with cards in it is not the same as a payable cost — the FILTER is
    // what refuses here, and the once-per-turn allowance is untouched by a
    // rejected use, so the Ability can still be used later this turn.
    let payable = board(SEED);
    payable = withBoard(payable, "fix-basic-1", [REVAVROOM]);
    payable = withHand(payable, ["fix-item", "fix-grass-energy"]);
    const { events } = mustApply(payable, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Rumbling Engine",
    });
    expect(find(events, "HAND_COST_PAID")).toBeDefined();
  });

  it("Tinkaton's UNFILTERED cost offers the whole hand, then draws 3", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [TINKATON]);
    state = withHand(state, ["fix-item", "fix-grass-energy", "fix-special"]);
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // No filter → every card in hand is a candidate, and the note says so with
    // no noun of its own ("a card"). This is the shape the pre-op AbilityCost
    // field could not express at all.
    expect(prompt.note).toBe("Discard a card from your hand.");
    expect(prompt.candidates).toHaveLength(3);
    const pick = prompt.candidates[0] as string;
    const { state: next, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    // 3 − 1 paid + 3 drawn.
    expect(next.players.p1.hand).toHaveLength(5);
    expect(next.phase.kind).toBe("turn:action");
  });

  it("refuses Tinkaton on an EMPTY hand, and forces it on a hand of one", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [TINKATON]);
    state = withHand(state, []);
    expectErr(
      state,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Gather Materials",
      },
      "ABILITY_COST_UNMET",
    );

    let one = board(SEED);
    one = withBoard(one, "fix-basic-1", [TINKATON]);
    one = withHand(one, ["fix-item"]);
    const only = handUid(one, "p1", "fix-item");
    const { state: next, events } = mustApply(one, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([only]);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(next.players.p1.hand).toHaveLength(3);
  });

  it("still honours the once-per-turn allowance (the cost changes nothing there)", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", [TINKATON]);
    // ONE card in hand → the first use is forced, so the play completes in one
    // action and lands back on turn:action for the second attempt.
    state = withHand(state, ["fix-item"]);
    const { state: used } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    expect(used.phase.kind).toBe("turn:action");
    // The hand is refilled by the draw, so the cost is payable again — only §9
    // stops a second use, and it is checked BEFORE the cost.
    expect(used.players.p1.hand.length).toBeGreaterThan(0);
    expectErr(
      used,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Gather Materials",
      },
      "ABILITY_ALREADY_USED",
    );
  });

  it("Radiant Blastoise proves the cost is DATA — Meowscarada, retyped", () => {
    let state = board(SEED);
    state = withBoard(state, RADIANT_BLASTOISE, []);
    state = benchFromDeck(state, "p2", "fix-basic-1"); // exactly 1 → the snipe is forced
    state = withHand(state, ["fix-water-energy", "fix-grass-energy"]);
    const waterUid = handUid(state, "p1", "fix-water-energy");
    const { state: next, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pump Shot",
    });
    // The {W} pays; the {G} beside it is a near-miss the typed filter refuses,
    // which is also why this asked nothing.
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([waterUid]);
    expect(next.players.p1.hand).toEqual([handUid(state, "p1", "fix-grass-energy")]);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(20);
  });

  it("refuses Radiant Blastoise holding only the WRONG basic type", () => {
    let state = board(SEED);
    state = withBoard(state, RADIANT_BLASTOISE, []);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = withHand(state, ["fix-grass-energy", "fix-grass-energy"]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pump Shot",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("ABILITY_COST_UNMET");
    expect(result.error.message).toContain("a Basic Water Energy card");
  });

  it("Meowscarada ex keeps its pre-migration behaviour: pays, never asks", () => {
    let state = board(SEED);
    state = withBoard(state, MEOWSCARADA, []);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    // THREE interchangeable Basic {G} — the fungible end of the op's range, and
    // the reason the old `AbilityCost` field could get away with "first match".
    state = withHand(state, ["fix-grass-energy", "fix-grass-energy", "fix-grass-energy"]);
    const { state: next, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "HAND_COST_PAID")?.uids).toHaveLength(1);
    expect(next.players.p1.hand).toHaveLength(2);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30);
  });

  it("checks NO_LEGAL_TARGET before the cost — the gate ORDER, actually pinned", () => {
    // Payable cost + no legal target → NO_LEGAL_TARGET. On its own this does NOT
    // pin the order (with the cost payable, either order gives the same code), so
    // the third case below is the one that does the work.
    let state = board(SEED);
    state = withBoard(state, MEOWSCARADA, []);
    state = withHand(state, ["fix-grass-energy"]);
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "NO_LEGAL_TARGET",
    );

    // Unpayable cost + a legal target → ABILITY_COST_UNMET. Also order-blind.
    let unpayable = board(SEED);
    unpayable = withBoard(unpayable, MEOWSCARADA, []);
    unpayable = benchFromDeck(unpayable, "p2", "fix-basic-1");
    unpayable = withHand(unpayable, ["fix-item"]);
    expectErr(
      unpayable,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "ABILITY_COST_UNMET",
    );

    // BOTH unmet — an empty opponent Bench AND no Basic {G} in hand. Only one
    // code can come back, so this is the case that fixes which gate runs first:
    // useAbility asks programPlayable BEFORE the cost, exactly as it did when the
    // cost was a handler field, so the migration changed no error the HUD sees.
    // (playTrainer orders the two the other way — printed rules, then whiff
    // heuristics — which is a deliberate difference, not a shared convention.)
    let neither = board(SEED);
    neither = withBoard(neither, MEOWSCARADA, []);
    neither = withHand(neither, ["fix-item"]);
    expectErr(
      neither,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "NO_LEGAL_TARGET",
    );
  });
});

describe("payFromHand — the apply's wire guards and purity", () => {
  it("skips a uid that is not in hand rather than conjuring one", () => {
    // Driven through applyChoice directly: validateChoice makes this unreachable
    // through the action API, which is exactly why the guard needs its own test —
    // without it a uid from anywhere would be appended to the discard pile,
    // DUPLICATING a card that is still sitting in the deck.
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy"]);
    const before = census(state, "p1");
    const deckCard = state.players.p1.deck[0] as string;
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 1, to: "discard" },
      { kind: "cards", uids: [deckCard] },
      { seat: "p1" },
      events,
    );
    expect(events).toHaveLength(0);
    expect(next).toBe(state); // nothing actually paid → the same state object
    expect(census(next, "p1")).toEqual(before);
  });

  it("pays a repeated uid ONCE — never twice into the discard pile", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, ["fix-item", "fix-grass-energy"]);
    const before = census(state, "p1");
    const uid = handUid(state, "p1", "fix-item");
    const events: GameEvent[] = [];
    const next = applyChoice(
      state,
      { op: "payFromHand", count: 2, to: "discard" },
      { kind: "cards", uids: [uid, uid] },
      { seat: "p1" },
      events,
    );
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([uid]);
    expect(next.players.p1.discard.filter((u) => u === uid)).toHaveLength(1);
    expect(census(next, "p1")).toEqual(before);
  });

  it("mutates nothing it was handed (deepFrozen input)", () => {
    let state = board(SEED);
    state = withBoard(state, "fix-basic-1", []);
    state = withHand(state, [ULTRA_BALL, "fix-item", "fix-grass-energy", "fix-special"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ULTRA_BALL),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = prompt.candidates.slice(0, 2);
    deepFreeze(parked);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    });
    expect(result.ok).toBe(true);
  });
});
