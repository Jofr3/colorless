import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectChoice } from "./interpreter";
import { programPlayable } from "./cardplay";
import { runProgram, resumeProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  REVEAL_BOTTOM_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: `bottomFromOpponentHand` + `opponentMayDraw` — the reveal-and-
// bottom family, and the engine's first decision ANSWERED BY THE NON-CONTROLLER.
//
//   • ORTEGA (sv03-190/-219, Supporter) — "Your opponent reveals their hand, and
//     you choose a card you find there and put it on the bottom of their deck.
//     If you put a card on the bottom of your opponent's deck in this way, your
//     opponent may draw a card." The Miriam shape (a recording op + a plain
//     recordGate) with both halves on the OTHER side of the table: the pick
//     reads a zone the controller does not own, and the gated draw belongs to
//     the seat that did not make the play (phase.answerer).
//   • GREAVARD (sv01-105) "Underworld Stroll" — the DERIVED attack twin:
//     "Your opponent reveals their hand. Choose a Supporter card you find there
//     and put it on the bottom of their deck." Same op, Supporter filter, no
//     gate — and its plain second attack (Sharp Fang) is why the card-level
//     registry `attack` field could not have carried the program.
//
// What the suite pins beyond the happy paths: the reveal is TOTAL and emitted
// exactly once (at the park, never re-told by the resolve); the offer collapses
// per interchangeable class ACROSS catalog ids; a collapsed-out sibling uid is
// not answerable; the mayDraw park's answerer is enforced BOTH directions; a
// decline moves nothing, says nothing, and still spent the Supporter; and both
// parks survive a JSON round-trip (D14).

const SEED = 20260722;

const ORTEGA = "sv03-190";
const ORTEGA_ALT = "sv03-219";
const GREAVARD = "sv01-105";
const MIRIAM = "sv01-179";

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

/** Every uid the seat holds anywhere, sorted — the card-conservation census.
    This op moves a card between two zones of the seat that did NOT act, so the
    census that matters most here is the opponent's. */
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
  const state = driveSetup(seed, { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild `seat`'s HAND outright: every dealt card back into the deck, then
    exactly `ids` dealt off it. The opponent's hand is this suite's zone under
    test, so nearly every test names it card by card. */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** Shrink `seat`'s deck to its top `n` cards, the rest into the discard pile —
    the mayDraw no-question case needs an EMPTY opponent deck. */
function withDeckSize(state: GameState, seat: Seat, n: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.slice(0, n),
        discard: [...side.discard, ...side.deck.slice(n)],
      },
    },
  };
}

/** P1 holding one Ortega print, P2's hand set to `oppIds` — the suite's
    standard opening position. */
function ortegaBoard(oppIds: readonly string[], print: string = ORTEGA): GameState {
  let state = board(SEED);
  state = withHand(state, "p1", [print]);
  return withHand(state, "p2", oppIds);
}

describe("the registry rows and the derived twin", () => {
  it("resolves the same program for both Ortega prints", () => {
    for (const id of [ORTEGA, ORTEGA_ALT]) {
      expect(programFor(id)?.trainer).toEqual([
        { op: "bottomFromOpponentHand", recordAs: "moved" },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "opponentMayDraw", count: 1 }],
        },
      ]);
    }
  });

  it("derives Underworld Stroll's printed sentence, and nothing looser", () => {
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.",
      ),
    ).toEqual([{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }]);
    // The pattern BODY must not drift toward Ortega's Supporter form (registry-
    // authored: its second sentence gates a draw no attack prints) nor accept a
    // truncation that would silently widen the filter.
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck. If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
      ),
    ).toBeNull();
    // ⚠️ D232 — THIS LINE USED TO ASSERT `null` AND IT WAS A "THIS IS UNBUILT"
    // CONTROL WITH AN EXPIRY DATE NOBODY WROTE DOWN (D231's finding, one slice
    // later and one file over). The truncation it was guarding against is real —
    // a body that drifted to accept the first clause alone would widen Greavard's
    // filter to nothing — but "derives to null" stopped being the way to say so
    // the moment the bare sentence became a card this engine reads (7 legal
    // printings, `opponentHandFamily.test.ts`). Re-homed rather than deleted:
    // what the assertion is FOR is that the truncation does not reach THIS op,
    // and that is now said by naming the program it does reach.
    expect(deriveAttackEffect("Your opponent reveals their hand.")).toEqual([
      { op: "revealOpponentHand" },
    ]);
    // THE ANCHORS, pinned directly — attackDiscards.test.ts's rule, and the
    // whole safety argument for a whole-sentence deriver. Both strings CONTAIN
    // the printed sentence verbatim and add text on one side, so it is `^` and
    // `$` and nothing else that refuses them: drop either and the engine
    // silently implements half of a card it has never seen, which is exactly
    // what "anchored end to end" is supposed to make impossible.
    expect(
      deriveAttackEffect(
        "This attack does 30 damage. Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck. Then, draw 2 cards.",
      ),
    ).toBeNull();
  });
});

describe("Ortega — the reveal, the pick, and where the card lands", () => {
  it("reveals the WHOLE hand first, then parks a mandatory exact-1 pick over the collapsed offer", () => {
    // Two fix-item copies (one class), a Greavard and an energy — four cards,
    // three classes: the reveal names all four, the offer holds one per class.
    const state = ortegaBoard(["fix-item", "fix-item", GREAVARD, "fix-grass-energy"]);
    const oppHand = [...state.players.p2.hand];
    const { state: parked, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    // The story in printed order: the play, the reveal, then the question.
    expect(types(events)).toEqual(["TRAINER_PLAYED", "HAND_REVEALED", "EFFECT_PENDING"]);
    const revealed = find(events, "HAND_REVEALED");
    expect(revealed?.seat).toBe("p2");
    expect(revealed?.uids).toEqual(oppHand);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected an effect:choose park");
    expect(parked.phase.seat).toBe("p1");
    // The CONTROLLER answers the pick — no answerer is filed (the absent-when-
    // controller rule that keeps every pre-D52 park byte-identical).
    expect(parked.phase.answerer).toBeUndefined();
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.dest).toBe("deckBottom");
    // One representative per class, in hand order: the first fix-item, the
    // Greavard, the energy — and NOT the second fix-item.
    expect(prompt.candidates).toEqual([oppHand[0], oppHand[2], oppHand[3]]);
    // The prompt says what the answer buys (§9.2), in the card's own words.
    expect(prompt.note).toBe(
      "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck. If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
    );
  });

  it("bottoms the chosen card onto the OPPONENT's deck and parks the mayDraw for the OTHER seat", () => {
    const state = ortegaBoard(["fix-item", GREAVARD, "fix-grass-energy"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const picked = handUid(parked, "p2", GREAVARD);
    const preCensus = census(parked, "p2");
    const { state: asked, events } = mustApply(deepFreeze(parked), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    const bottomed = find(events, "CARD_TO_BOTTOM_OF_DECK");
    expect(bottomed).toEqual({ type: "CARD_TO_BOTTOM_OF_DECK", seat: "p2", uid: picked, actor: "p1" });
    // The card sits on the BOTTOM — the deck's last element, its order above
    // untouched — and left the hand; nothing was created or destroyed.
    expect(asked.players.p2.deck.at(-1)).toBe(picked);
    expect(asked.players.p2.hand).not.toContain(picked);
    expect(census(asked, "p2")).toEqual(preCensus);
    // The reveal is NOT re-told by the resolve.
    expect(find(events, "HAND_REVEALED")).toBeUndefined();
    // The gated draw parks for the OPPONENT: seat stays the controller (the
    // turn is still theirs), answerer names who may speak.
    if (asked.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    expect(asked.phase.seat).toBe("p1");
    expect(asked.phase.answerer).toBe("p2");
    const prompt = asked.phase.prompt;
    if (prompt.kind !== "mayDraw") throw new Error("expected a mayDraw prompt");
    expect(prompt.count).toBe(1);
    // The prompt speaks to its answerer — second person, across the table.
    expect(prompt.note).toBe("You may draw a card.");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p2");
  });

  it("enforces the answerer BOTH directions — p2 cannot pick, p1 cannot answer the may", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const picked = handUid(parked, "p2", GREAVARD);
    // The pick is the CONTROLLER's: the seat whose hand it is may not answer.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [picked] } },
      "WRONG_SEAT",
    );
    const { state: asked } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    // The may is the OPPONENT's: the controller cannot consent for them.
    expectErr(
      asked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "mayDraw", draw: true } },
      "WRONG_SEAT",
    );
  });

  it("draws off the OPPONENT's own deck top on yes, and returns the turn to the controller", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const { state: asked } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(parked, "p2", GREAVARD)] },
    });
    const topOfP2 = asked.players.p2.deck[0];
    const p1Hand = [...asked.players.p1.hand];
    const { state: drawn, events } = mustApply(deepFreeze(asked), {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: true },
    });
    const drew = find(events, "CARDS_DRAWN");
    expect(drew?.seat).toBe("p2");
    expect(drew?.reason).toBe("effect");
    expect(drew?.uids).toEqual([topOfP2]);
    expect(drawn.players.p2.hand).toContain(topOfP2);
    // The controller's zones never moved, and the turn is still theirs.
    expect(drawn.players.p1.hand).toEqual(p1Hand);
    expect(drawn.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("a decline moves nothing, says nothing, and the Supporter is still spent", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const { state: asked } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(parked, "p2", GREAVARD)] },
    });
    const { state: declined, events } = mustApply(deepFreeze(asked), {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: false },
    });
    // No event: no state moved, and the table saw the shrug.
    expect(events).toEqual([]);
    // Byte-identical zones and rng — the phase is the only change.
    expect(declined.players).toEqual(asked.players);
    expect(declined.rngState).toBe(asked.rngState);
    expect(declined.phase).toEqual({ kind: "turn:action", seat: "p1" });
    // §7.2 — the turn's one Supporter went on this, decline or not.
    expect(declined.allowances.supporterPlayed).toBe(true);
  });

  it("over an empty deck, the may offers back the VERY card just bottomed — and yes takes it", () => {
    // Ortega can never reach opponentMayDraw's empty-deck skip: the gate only
    // holds when a card WAS bottomed, and that card IS the opponent's deck
    // now. So the printed corner case is the fun one — bottom their last
    // playable card and they may draw it straight back.
    let state = ortegaBoard(["fix-item", GREAVARD]);
    state = withDeckSize(state, "p2", 0);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const picked = handUid(parked, "p2", GREAVARD);
    const { state: asked, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")?.uid).toBe(picked);
    expect(asked.players.p2.deck).toEqual([picked]);
    // A one-card deck is still a real question — the may parks.
    if (asked.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    expect(asked.phase.answerer).toBe("p2");
    const { state: drawn, events: resolved } = mustApply(asked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: true },
    });
    expect(find(resolved, "CARDS_DRAWN")?.uids).toEqual([picked]);
    expect(drawn.players.p2.hand).toContain(picked);
    expect(drawn.players.p2.deck).toEqual([]);
  });

  it("carries the printed COUNT through the prompt, the note and the draw", () => {
    // Ortega prints 1, so nothing in the live vocabulary exercises the number
    // at all — the prompt's `count`, mayDrawNote's plural arm and the draw
    // itself could each be hard-wired to 1 and no test would notice. Driven at
    // the op level, which is where the field's contract lives.
    const state = ortegaBoard(["fix-item"]);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "opponentMayDraw", count: 3 }], { seat: "p1" }, events);
    if (result.kind !== "parked") throw new Error("expected the may park");
    expect(result.decider).toBe("p2");
    const prompt = result.prompt;
    if (prompt.kind !== "mayDraw") throw new Error("expected a mayDraw prompt");
    expect(prompt.count).toBe(3);
    expect(prompt.note).toBe("You may draw 3 cards.");
    const top = state.players.p2.deck.slice(0, 3);
    const drawn = resumeProgram(state, result.cont, { kind: "mayDraw", draw: true }, events);
    if (drawn.kind !== "done") throw new Error("expected the program to finish");
    expect(find(events, "CARDS_DRAWN")?.uids).toEqual(top);
  });

  it("reads the op's OWN slot — a record filed under `paid` is not read as `moved`", () => {
    // `recordSlotOf` feeds the §9.2 describer; hard-wiring this op's slot would
    // attach the wrong consequence clause (or none) to a card authored on the
    // other slot. Ortega uses "moved", so only a differently-slotted program
    // can tell the two apart.
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "bottomFromOpponentHand", recordAs: "paid" },
        {
          op: "recordGate",
          slot: "paid",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "opponentMayDraw", count: 1 }],
        },
      ],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked") throw new Error("expected the pick park");
    // The consequence clause found the gate through the op's own slot.
    expect(result.prompt.note).toContain(
      "If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
    );
  });

  it("checks the SEAT before the choice — a wrong seat learns nothing about the prompt", () => {
    // Precedence, not merely rejection: both wrong-seat tests above send a
    // VALID choice, so swapping the two checks would still reject them. A
    // garbage choice from the wrong seat must come back WRONG_SEAT, or the
    // error message becomes an oracle the other player can query.
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p2", choice: { kind: "mayDraw", draw: true } },
      "WRONG_SEAT",
    );
  });

  it("never parks the may when the draw could not move a card — the op contract's own guard", () => {
    // Unreachable through Ortega (above: the gate's own bottomed card feeds
    // the deck), so the M1 no-question guard is pinned at the op level, the
    // contract the first non-bottoming consumer will lean on.
    let state = ortegaBoard(["fix-item"]);
    state = withDeckSize(state, "p2", 0);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "opponentMayDraw", count: 1 }], { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("an empty-deck may must not park");
    expect(events).toEqual([]);
  });

  it("auto-resolves a single-class hand — a forced pick is not a question", () => {
    // Three copies of one id: the collapse leaves one candidate, the pick is
    // forced, and the play lands bottoming + mayDraw park in ONE action.
    const state = ortegaBoard(["fix-item", "fix-item", "fix-item"]);
    const { state: asked, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    // The REVEAL STILL COMES FIRST on this path too. The park test pins the
    // order for the parking path; without this the auto-resolve path could
    // bottom a card before announcing the hand it came from, and the op's
    // "the reveal is its first act" claim would hold on one branch only.
    expect(types(events)).toEqual([
      "TRAINER_PLAYED",
      "HAND_REVEALED",
      "CARD_TO_BOTTOM_OF_DECK",
      "EFFECT_PENDING",
    ]);
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeDefined();
    expect(asked.players.p2.hand).toHaveLength(2);
    expect(asked.players.p2.deck.at(-1)).toBe(find(events, "CARD_TO_BOTTOM_OF_DECK")?.uid);
    if (asked.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    expect(asked.phase.prompt.kind).toBe("mayDraw");
    expect(asked.phase.answerer).toBe("p2");
  });

  it("collapses interchangeable Basic Energy ACROSS catalog ids — two prints, one candidate", () => {
    // Two prints of Basic {D} plus one distinguishable card: a hand of three
    // uids offers two candidates, keyed by what the Energy PROVIDES (the
    // attachFromDeck rule, aimed at a hand).
    const state = ortegaBoard(["fix-dark-energy", "fix-dark-energy-alt", "fix-item"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected an effect:choose park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
    expect(prompt.candidates).toHaveLength(2);
    // The collapsed-out sibling was never offered, so it is not an answer —
    // even though it sits in the very hand the prompt reads.
    const sibling = handUid(parked, "p2", "fix-dark-energy-alt");
    expect(prompt.candidates).not.toContain(sibling);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [sibling] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects Ortega into an EMPTY opponent hand — public-count whiff, nothing spent", () => {
    const state = ortegaBoard([]);
    const uid = handUid(state, "p1", ORTEGA);
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
    // Nothing left the hand and the turn's Supporter is still available.
    expect(state.players.p1.hand).toContain(uid);
    expect(state.allowances.supporterPlayed).toBe(false);
  });

  it("PLAYS into a hand of exactly ONE — the gate's other boundary", () => {
    // The gate is `length === 0`, and a suite that only ever plays into 0, 2 or
    // more pins half of it: `<= 1` would refuse the commonest late-game board
    // there is (an opponent holding one card), and refuse it as NO_LEGAL_TARGET
    // when the card resolves perfectly well.
    const state = ortegaBoard(["fix-item"]);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    // One candidate ⇒ forced ⇒ it resolves straight through to the may.
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeDefined();
    expect(done.players.p2.hand).toEqual([]);
  });

  it("the play gate reads the hand's LENGTH, never the op's FILTER", () => {
    // The ruling/284 line, and the promise `programPlayable`'s export rests on:
    // whether a non-empty HIDDEN hand holds a match is exactly what the game
    // state does not establish, so a filtered op into a matchless hand stays
    // playable and reveals. A gate that peeked would also leak — it would tell
    // the controller "no Supporter in there" before they played the card.
    const state = ortegaBoard(["fix-item", "fix-grass-energy"]);
    expect(
      programPlayable(state, [{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }], "p1"),
    ).toBe(true);
    // …and still refuses the empty hand, which IS public.
    const empty = ortegaBoard([]);
    expect(
      programPlayable(empty, [{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }], "p1"),
    ).toBe(false);
  });

  it("moves nothing for a uid that is no longer in the hand — no card is duplicated", () => {
    // The apply's wire-safety guard, and the one failure it prevents is the
    // worst kind: a crafted snapshot (a P4 client replaying an action against a
    // state whose hand has moved on) would otherwise APPEND to the deck a card
    // that is still sitting somewhere else — a duplicate that hides for the
    // rest of the game. Reachable exactly as resolveEffect's own PHASE_DESYNC
    // guard is.
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const picked = handUid(parked, "p2", GREAVARD);
    // The snapshot moves that very card to the discard, keeping the prompt.
    const p2 = parked.players.p2;
    const crafted: GameState = {
      ...parked,
      players: {
        ...parked.players,
        p2: {
          ...p2,
          hand: p2.hand.filter((uid) => uid !== picked),
          discard: [...p2.discard, picked],
        },
      },
    };
    const before = census(crafted, "p2");
    const { state: after, events } = mustApply(crafted, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    // Nothing moved, nothing was announced, and the census is intact.
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeUndefined();
    expect(after.players.p2.deck).toEqual(crafted.players.p2.deck);
    expect(after.players.p2.discard).toContain(picked);
    expect(census(after, "p2")).toEqual(before);
    // …and the §9.2 gate read the truth: nothing was bottomed, so no may parks.
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("files what MOVED, not what was picked — the gate cannot be fooled by a dropped uid", () => {
    // The sharp end of the test above, stated as the record contract: if the
    // apply filed `choice.uids` instead of the moved uids, the crafted snapshot
    // would bottom nothing yet still park the opponent's may — a decision
    // offered for an event that did not happen. Driven through the op directly
    // so the record itself is observable, not just its consequence.
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const ghost = "p2#ghost";
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "bottomFromOpponentHand", recordAs: "moved" },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "opponentMayDraw", count: 1 }],
        },
      ],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked") throw new Error("expected the pick park");
    const resumed = resumeProgram(state, result.cont, { kind: "cards", uids: [ghost] }, events);
    if (resumed.kind !== "done") throw new Error("a dropped uid must not park the may");
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeUndefined();
  });

  it("files an EMPTY record on a whiff — an honest no, not a missing key", () => {
    // `recordGateHolds` reads `record[slot] ?? []`, so the filing and the
    // absence agree on the gate's answer — which is why deleting the whiff's
    // `recordMoved([])` changes no behaviour today. What it DOES change is the
    // parked continuation's bytes, and that is the thing D14 replays, so the
    // record is asserted where it actually lives.
    const state = ortegaBoard(["fix-item", "fix-grass-energy"]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "bottomFromOpponentHand", filter: { kind: "supporter" }, recordAs: "moved" },
        // A parking op BEHIND the whiff, so the continuation is observable.
        { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      ],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked") throw new Error("expected the search park");
    expect(result.cont.record).toEqual({ moved: [] });
  });

  it("plays the reprint through its own id", () => {
    const state = ortegaBoard(["fix-item", GREAVARD], ORTEGA_ALT);
    const { state: parked, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA_ALT),
    });
    expect(find(events, "HAND_REVEALED")?.seat).toBe("p2");
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("wire-checks the pick and the may — hostile choices reject without moving a card", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const picked = handUid(parked, "p2", GREAVARD);
    const ownCard = parked.players.p1.hand[0];
    // Not offered (the controller's own card / nothing / two picks / the wrong
    // shape entirely).
    const hostile: EffectChoice[] = [
      { kind: "cards", uids: [ownCard as string] },
      { kind: "cards", uids: [] },
      { kind: "cards", uids: [picked, handUid(parked, "p2", "fix-item")] },
      { kind: "mayDraw", draw: true },
    ];
    for (const choice of hostile) {
      expectErr(parked, { type: "resolveEffect", seat: "p1", choice }, "BAD_EFFECT_CHOICE");
    }
    const { state: asked } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    // The may is a BOOLEAN, checked to be one — a truthy wire string is not
    // consent to draw.
    for (const draw of ["yes", 1, null, undefined] as const) {
      expectErr(
        asked,
        {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "mayDraw", draw } as unknown as { kind: "mayDraw"; draw: boolean },
        },
        "BAD_EFFECT_CHOICE",
      );
    }
    expectErr(
      asked,
      { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [picked] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("both parks survive a JSON round-trip — the answerer is plain data (D14)", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const thawedPick = JSON.parse(JSON.stringify(parked)) as GameState;
    const { state: asked } = mustApply(thawedPick, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(thawedPick, "p2", GREAVARD)] },
    });
    const thawedMay = JSON.parse(JSON.stringify(asked)) as GameState;
    if (thawedMay.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    expect(thawedMay.phase.answerer).toBe("p2");
    const { state: drawn } = mustApply(thawedMay, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: true },
    });
    expect(drawn.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("files [] on a filtered whiff, and the gate reads an honest no (§9.2)", () => {
    // No printed card gates a FILTERED reveal-and-bottom today (Greavard has no
    // gate; Ortega has no filter), so this is the op-contract check the first
    // such card will lean on, driven through runProgram directly.
    const state = ortegaBoard(["fix-item", "fix-grass-energy"]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "bottomFromOpponentHand", filter: { kind: "supporter" }, recordAs: "moved" },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "drawCards", count: 1 }],
        },
      ],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "done") throw new Error("a matchless filter must not park");
    // The reveal still happened (the printed first clause is unconditional);
    // the gate's branch did not (nothing was filed).
    expect(types(events)).toEqual(["HAND_REVEALED"]);
  });
});

describe("Greavard — Underworld Stroll, the derived attack twin", () => {
  /** P1 fields Greavard with its {C}{C} cost paid, P2's hand set to `oppIds`. */
  function strollBoard(oppIds: readonly string[]): GameState {
    let state = setActiveFromDeck(board(SEED), "p1", GREAVARD);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    return withHand(state, "p2", oppIds);
  }

  it("parks the Supporter-filtered pick mid-attack, and the resolve ends the turn", () => {
    // Two DISTINCT Supporter classes (Ortega + Miriam) beside two near-misses:
    // the reveal names all four, the offer names only the Supporters.
    const state = strollBoard([ORTEGA, MIRIAM, "fix-item", "fix-grass-energy"]);
    const oppHand = [...state.players.p2.hand];
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "HAND_REVEALED")?.uids).toEqual(oppHand);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected an effect:choose park");
    // Mid-TAIL: the attackEpilogue waits behind the pick (D42).
    expect(parked.phase.resumeTail).toBe(true);
    expect(parked.phase.answerer).toBeUndefined();
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
    expect(prompt.candidates).toEqual([
      handUid(parked, "p2", ORTEGA),
      handUid(parked, "p2", MIRIAM),
    ]);
    expect(prompt.note).toBe(
      "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.",
    );
    const picked = handUid(parked, "p2", MIRIAM);
    const { state: done, events: resolved } = mustApply(deepFreeze(parked), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    expect(find(resolved, "CARD_TO_BOTTOM_OF_DECK")?.uid).toBe(picked);
    expect(done.players.p2.deck.at(-1)).toBe(picked);
    // The epilogue drained: the attack ended P1's turn (§5.3).
    expect(find(resolved, "TURN_ENDED")).toBeDefined();
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("whiffs into a Supporter-less hand — the reveal still happens, the turn still ends", () => {
    const state = strollBoard(["fix-item", "fix-grass-energy", "fix-basic-1"]);
    const oppHand = [...state.players.p2.hand];
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "HAND_REVEALED")?.uids).toEqual(oppHand);
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeUndefined();
    expect(find(events, "TURN_ENDED")).toBeDefined();
    // The revealed hand is intact — the extra card is P2's own turn-start
    // draw, which rides the same reduction once the attack ends the turn.
    expect(done.players.p2.hand.slice(0, oppHand.length)).toEqual(oppHand);
    expect(done.players.p2.hand).toHaveLength(oppHand.length + 1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("auto-resolves a lone Supporter class — two copies of one print ask nothing", () => {
    const state = strollBoard([MIRIAM, MIRIAM, "fix-item"]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const bottomed = find(events, "CARD_TO_BOTTOM_OF_DECK");
    expect(bottomed).toBeDefined();
    expect(done.players.p2.deck.at(-1)).toBe(bottomed?.uid);
    // One Miriam went under; its copy stayed in hand (the fix-item and P2's
    // turn-start draw are the rest). No park happened.
    const miriams = done.players.p2.hand.filter((u) => done.cardIdByUid[u] === MIRIAM);
    expect(miriams).toHaveLength(1);
    expect(find(events, "TURN_ENDED")).toBeDefined();
  });

  it("attacks legally into an EMPTY hand — the reveal is honest about nothing", () => {
    // Attacks are not programPlayable-gated (§8.6 — an attack's effect may
    // whiff); the reveal event carries zero uids, the (0 cards) precedent.
    const state = strollBoard([]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "HAND_REVEALED")?.uids).toEqual([]);
    expect(find(events, "CARD_TO_BOTTOM_OF_DECK")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("Sharp Fang does NOT run the program — the derived effect rides only its own attack", () => {
    // The reason the twin derives from text at all: the registry `attack`
    // field is per-CARD, and Greavard's second attack must stay plain.
    let state = strollBoard([ORTEGA, MIRIAM]);
    // {P}{C}{C} — the two {C} from strollBoard plus a {P} provider.
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "HAND_REVEALED")).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.base).toBe(30);
  });

  it("emits ONE reveal per attack — the park did not double-tell it", () => {
    const state = strollBoard([ORTEGA, MIRIAM]);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findAll(events, "HAND_REVEALED")).toHaveLength(1);
    const { events: resolved } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(parked, "p2", ORTEGA)] },
    });
    expect(findAll(resolved, "HAND_REVEALED")).toHaveLength(0);
  });
});
