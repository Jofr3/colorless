import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  EXPLORERS_GUIDANCE_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
  trimDeckTo,
} from "./testFixtures";

// D334 — EXPLORER'S GUIDANCE `sv05-147`/`sv05-200`/`sv08.5-107`, THE MANDATORY
// TAKE AND THE LEFTOVERS THAT LEAVE THE DECK.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Look at the top 6 cards of your deck and put 2 of them into your hand.
//    **Discard the other cards.**"
//   Supporter, **3 Standard-legal printings on one byte-identical 95-char
//   `effect`**, and they are the whole population of the sentence.
//
// ── THE CENSUS, AT SEVERAL WIDTHS AND OVER ALL THREE TEXT COLUMNS ───────────
// Re-run against the remote D1 `luminous` at THIS head (2026-08-14) rather than
// inherited, and every per-column split re-added against its own total, because a
// split that does not sum is the cheapest census check there is.
//
//   (a) `instr(<col>,'Discard the other cards') > 0` — the LEFTOVERS clause:
//         `effect`          3 rows / 3 legal — the three Explorer's Guidance.
//         `attacks_json`    0 rows / 0 legal.
//         `abilities_json`  1 row  / 0 legal — Hydreigon `sv02-140` "Tri Howl",
//                           out of Standard and BUILT since M5 on
//                           `attachFromTop.restTo` (🆕 D352 — was `discardRest`).
//       TOTAL 4 rows / 3 legal.  3 + 0 + 1 = 4 ✅   3 + 0 + 0 = 3 ✅
//       Widening to `'Discard the other'` returns the SAME 4 rows, and the
//       lower-case `'discard the other'` and the variant `'Discard the rest'`
//       return 0 over all three columns. 🛑 **SO THIS ROW CLOSES THE PRINTED
//       POPULATION OF THE CLAUSE OUTRIGHT**: two ops, and after this slice both
//       of them carry the field.
//
//   (b) `instr(<col>,'of them into your hand') > 0` — the MANDATORY-TAKE arm,
//       widened off the leftovers so a different leftovers clause cannot hide:
//         `effect`         12 rows / 9 legal
//         `attacks_json`    0 rows / 0 legal
//         `abilities_json`  2 rows / 2 legal
//       TOTAL 14 rows / 11 legal. 12 + 0 + 2 = 14 ✅  9 + 0 + 2 = 11 ✅
//       Of those, Hassel `sv06-151`/`-205` print *"put **up to** 3 of them"* (2
//       legal, already BUILT) and Crispin `sv07-133`/`-164`/`sv08.5-105`/`-171`
//       print it on `searchDeck` (4 legal, a different op). **The residue is the
//       `exact` family**: these 3, Drakloak "Recon Directive" `sv06-129`/
//       `sv08.5-072` (2 legal, on `abilities_json`) and Rika `sv04-172`/`-241`/
//       `-258` (3 printings, all `legal_standard = 0`).
//       8 printings / 5 legal.  3 + 2 + 3 = 8 ✅   3 + 2 + 0 = 5 ✅
//
// 🛑 **SO THE `exact` ARM IS WORTH 8 PRINTINGS / 5 LEGAL WHERE THE REGISTRY ROW
//    IS 3** — D187's rule that an arm crosses sets and a row does not, and the
//    reason the field is a boolean rather than this card's number. What blocks the
//    other two families is the LEFTOVERS DESTINATION and never the take: Drakloak
//    puts them on the deck BOTTOM, Rika shuffles them there, and this op has a
//    field for neither. **The take is shared; the leftovers are not.**
//
// ── THE CLAUSE THE WORK ORDER FLAGGED, AND WHAT GREPPING IT RETURNED ────────
// The resume point said the un-grepped question was WHICH EVENT THE LEFTOVERS
// RIDE, warning that `DECK_TOP_DISCARDED`'s producers are enumerated by name and
// that "the two discards on one op may want two different events" — possibly
// meaning this was "not the right shape at all".
//
// ✅ **THE TWO DISCARDS DO WANT TWO EVENTS, AND THIS OP ALREADY HAD THE OTHER
//    ONE.** `effects.ts` refuses `DECK_TOP_DISCARDED` for `lookAtTopN`'s
//    `dest: "discard"` because *"here the discard IS the printed decision"*, and
//    the event's own doc says its cards are the ones that *"LEFT the deck without
//    anyone deciding about them"*. Leftovers are the definition of the second
//    clause. **So the sentence that refuses the event for one field is the
//    argument for it on the other** — the split is by whether a decision was made
//    about the card, never by where it ended up.
//
// 🛑 **AND THE COST WAS PROSE, NOT CODE.** No new event, no new event field, no
//    renderer arm (`actor === seat` on an own-deck look, so `log.ts`'s existing
//    active-voice branch was already right) and no `MATCH_RECORD_VERSION` move.
//    What it cost was SEVEN stale enumerations across four files: "TWO ops produce
//    this row" and "Three paths" (events.ts), "TWO push sites, THREE paths" and
//    "split 2–1 on agency" (log.ts), "that event's two producers" and "the SECOND
//    of the event's two push sites … two of its THREE paths" (effects.ts), and a
//    case named "all three real producer paths" (log.test.ts), which is repaired
//    with a FOURTH DRIVEN PATH rather than a re-worded title.
//
// ── THE OTHER INHERITED CLAUSE, AND IT IS FALSE FOR THE FIFTH SLICE RUNNING ─
// The price read: *"A MANDATORY take. … The PROMPT field already exists and
// already has a non-zero producer — `chooseCards.min` is required, and
// `interpreter.ts:1383` passes `min: take`. So the cost is a way for the OP to say
// it, not a wire field."*
//
// ⚠️ **THE CITED LINE IS A DIFFERENT PROMPT KIND.** `interpreter.ts:1383` is the
//    snipe's `choosePokemonMulti` park. The CLAIM survives on other evidence —
//    `payFromHand` passes `min: op.count` and `bottomFromOpponentHand` passes an
//    unridden `min: 1` — so the validator half really is free.
// 🛑 **BUT `lookNote` READS THE SAME NUMBER AND CAPTIONED IT "up to 2 cards"**,
//    over a sentence printing no *"up to"* at all. That is D333's own finding one
//    field over, on the very next field: **A VALUE THAT IS EQUIVALENT AS A
//    PREDICATE IS NOT NECESSARILY EQUIVALENT AS A CAPTION.** The price named the
//    validator and missed the string.
// 🛑 **AND THE FLOOR IS THE FIRST ON THIS PROMPT A SHORT ZONE CAN MAKE
//    UNANSWERABLE.** The other two producers are gated upstream on a hand that
//    holds the cards; a top-6 window on a 1-card deck offers ONE candidate against
//    a printed take of 2. `max` never needed a clamp — a ceiling above the
//    candidate count cannot bind — so this is a genuinely new obligation and it is
//    driven below.

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const deckAt = (state: GameState, index: number): string => {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`no card at deck index ${index}`);
  return uid;
};

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: EXPLORERS_GUIDANCE_DECK, p2: EXPLORERS_GUIDANCE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** A seeded top 6 of FOUR card classes: two Pokémon, two Energy, one Supporter,
    one Item — indices 0-5 in that order.

    🛑 **FOUR CLASSES IS THE FILTER'S ONLY WITNESS.** The print names no noun, so
    `anyCard` admits all six; on a window of six Pokémon that is byte-for-byte
    indistinguishable from Great Ball's `anyPokemon`, and every candidate assertion
    in this file would pass on the narrowed build.

    ⚠️ **EACH ID IS MOVED IN ONE CALL AND NOT SEVERAL.** `toDeckTop` takes the
    FIRST `count` copies in DECK ORDER, so a second single-copy call for the same
    id re-picks the copy the first call just put on top and the window comes out a
    card short. Asked for as batches, in reverse order, each pushed down by the one
    above it. */
function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-item", 1); // index 5
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 4
  next = toDeckTop(next, "p1", "fix-energy", 2); // indices 2-3
  next = toDeckTop(next, "p1", "fix-basic-1", 2); // indices 0-1
  return next;
}

/** Play `id` out of p1's hand onto the seeded window and return the parked
    chooseCards prompt with it. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked, events } = mustApply(seededState, {
    type: "playTrainer",
    seat: "p1",
    uid,
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { seededState, parked, prompt: parked.phase.prompt, events };
}

describe("D334 — Explorer's Guidance, the mandatory take and the discarded leftovers", () => {
  it("the registry resolves a program for all THREE printings AND for the demonstrator", () => {
    // 🛑 D330's finding, kept as a standing check one field over: a union member can
    // be wired at every site, type-check everywhere and have ZERO printed consumers.
    // These four keys are what stop `exact` and `lookAtTopN.restTo` from being
    // that — and the last one matters, because the pool the boards below run on is
    // `FIXTURE_POOL` and it holds no `sv05` row.
    for (const id of ["sv05-147", "sv05-200", "sv08.5-107", "fix-explorersguidance"]) {
      expect(programFor(id), id).toBeDefined();
    }
    // The three printings are REPRINTS, so they share ONE object, as `byObject`
    // asserts from the outside in censusAtHead.test.ts.
    expect(programFor("sv05-200")).toBe(programFor("sv05-147"));
    expect(programFor("sv08.5-107")).toBe(programFor("sv05-147"));
    expect(programFor("fix-explorersguidance")).toBe(programFor("sv05-147"));
  });

  it("the program is Great Ball's op with all four fields moved — read off the registry", () => {
    // The attribution control, before any board runs: Great Ball is the SAME op,
    // and naming every field that differs is what makes each board below
    // attributable to one of them rather than to "the two cards are different".
    const eg = programFor("fix-explorersguidance")?.trainer?.[0];
    const greatBall = programFor("sv02-183")?.trainer?.[0];
    if (eg?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (greatBall?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(eg.n).toBe(6);
    expect(eg.filter).toEqual({ kind: "anyCard" });
    expect(eg.max).toBe(2);
    expect(eg.exact).toBe(true);
    // 🆕 D335 — was `discardRest: true`; the boolean widened into a three-valued
    // axis when Drakloak and Rika printed the other two destinations, and this is
    // the SAME value under the new key rather than a re-reading of the card.
    expect(eg.restTo).toBe("discard");
    // ⚠️ NO `reveal`: the sentence prints no reveal at all (it is why this row sits
    // in revealClause.test.ts's NOT_REVEALING table). Absent, never `false` (D135).
    expect(eg.reveal).toBeUndefined();
    // ⚠️ AND NO `also`: one take, one cap.
    expect(eg.also).toBeUndefined();
    // Great Ball differs in every one of them.
    expect(greatBall.exact).toBeUndefined();
    expect(greatBall.restTo).toBeUndefined();
    expect(greatBall.filter).toEqual({ kind: "anyPokemon" });
    expect(greatBall.max).toBe(1);
  });

  it("🛑 there is NO trailing `shuffleDeck`, and the absence is PRINTED", () => {
    // 🛑 **THE MUTANT THIS KILLS IS THE COPY AN AUTHOR WOULD ACTUALLY MAKE.** Every
    // other `lookAtTopN` row in the registry — Great Ball, Pokégear, Hassel,
    // Drayton, Roto-Stick, Bug Catching Set — ends `{ op: "shuffleDeck" }`, because
    // every one of them prints "Shuffle the other cards back into your deck". Those
    // cards never left the deck. HERE THEY DO, so there is nothing on top left to
    // scramble and the sentence spells no shuffle. Asserted as the program's LENGTH
    // so an appended op cannot slip past a `[0]`-shaped check.
    expect(programFor("fix-explorersguidance")?.trainer).toHaveLength(1);
    expect(programFor("sv02-183")?.trainer).toHaveLength(2);
    expect(programFor("sv02-183")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    // 🛑 D330's OTHER finding: a program can be reachable from the catalog and still
    // unreachable from the only pool the tests own. This is the line that ties the
    // demonstrator's printed bytes to the real card's.
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).toBe(
      "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards.",
    );
    expect(FIXTURE_POOL["fix-explorersguidance"]?.trainerType).toBe("Supporter");
    // The printed sentence carries neither of the two words that would make it an
    // "up to", said out loud because the whole slice hangs off their absence.
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).not.toContain("up to");
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).not.toContain("you may");
  });

  it("offers EVERY card in the window — the print names no noun", () => {
    const state = board(11);
    const { seededState, prompt } = play(state, "fix-explorersguidance");
    const window = [0, 1, 2, 3, 4, 5].map((i) => deckAt(seededState, i));
    expect([...prompt.candidates].sort()).toEqual([...window].sort());
    // ⚠️ THE MUTANT THIS KILLS: narrowing `anyCard` to Great Ball's `anyPokemon`,
    // the filter one registry row over and the copy an author would make. Indices
    // 2-5 are two Energy, a Supporter and an Item, so a narrowed filter offers two
    // rows where the print offers six.
    expect(prompt.candidates).toHaveLength(6);
    // …and the card at index 6 is past the printed window.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 6));
  });

  it("🛑 the floor is the PRINTED TAKE, not zero — `min === max === 2`", () => {
    const state = board(12);
    const { prompt } = play(state, "fix-explorersguidance");
    // 🛑 **THE CASE THE WHOLE FIELD EXISTS FOR.** The park has hard-coded `min: 0`
    // since M5 under the comment "'up to' — taking none is a legal answer", which is
    // a claim about the PRINT that this sentence falsifies. The mutant this kills is
    // dropping `exact` from the registry row, which is silent everywhere else: the
    // candidates, the window, the discard and the events are all identical.
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt).not.toHaveProperty("caps");
  });

  it("🛑 the caption drops the 'up to' — the printed words, not the field's default", () => {
    const state = board(13);
    const { prompt } = play(state, "fix-explorersguidance");
    // 🛑 **THE HALF THE INHERITED PRICE NEVER NAMED, AND IT IS D333's LESSON ON THE
    // VERY NEXT FIELD.** `lookNote` reads the same `max` the validator does and
    // captions `max > 1` as "up to N": a build that shipped only the wire floor
    // would tell a player "put up to 2 cards into your hand" over a sentence that
    // gives them no choice about the 2. A FIELD THAT FEEDS BOTH A PREDICATE AND A
    // STRING OWES BOTH ARMS.
    expect(prompt.note).toBe("Look at the top 6 cards of your deck and put 2 cards into your hand.");
    expect(prompt.note).not.toContain("up to");
  });

  it("⚠️ a SHORT answer is refused by the wire validator, on both sides of the floor", () => {
    const state = board(14);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    // The decline every OTHER row on this op permits, refused here — and this is the
    // half of `exact` that a crafted frame reaches, so it has to be checked at the
    // validator and not only in the dialog.
    expectErr(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }, "BAD_EFFECT_CHOICE");
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [deckAt(seededState, 0)] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the CEILING still holds from the other side: three is not two either.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "cards",
          uids: [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 the take goes to hand and the OTHER FOUR go to the discard pile", () => {
    const state = board(15);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    const window = [0, 1, 2, 3, 4, 5].map((i) => deckAt(seededState, i));
    // Deliberately NOT the top two: the leftovers are `window \ picked`, so picking
    // out of the middle is what separates that from "the top 2" or "the bottom 4".
    const taken = [window[1] as string, window[4] as string];
    const leftovers = window.filter((uid) => !taken.includes(uid));
    const deckBefore = seededState.players.p1.deck.length;
    // Measured off the PARKED state and not the seeded one: playing a Supporter
    // discards it, so the pile has already gained the card that is asking the
    // question. The slice below is the leftovers and only the leftovers.
    const discardBefore = parked.players.p1.discard.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: taken },
    });
    for (const uid of taken) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.discard).not.toContain(uid);
    }
    // 🛑 IN DECK ORDER, TOP FIRST — the order the pile gains them (§2), and the
    // reason the leftovers are read off the WINDOW rather than off the pick list.
    expect(done.players.p1.discard.slice(discardBefore)).toEqual(leftovers);
    expect(find(events, "DECK_TOP_DISCARDED")).toEqual({
      type: "DECK_TOP_DISCARDED",
      seat: "p1",
      // 🛑 `actor === seat`: own deck, own action, so `log.ts`'s ACTIVE voice arm
      // renders this producer with no new case. The event's fourth path.
      actor: "p1",
      uids: leftovers,
    });
    // The whole window left the deck — six out, two to hand and four to the pile,
    // and nothing stranded in neither zone.
    expect(done.players.p1.deck).toHaveLength(deckBefore - 6);
    for (const uid of window) expect(done.players.p1.deck).not.toContain(uid);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("🛑 the LOOK row names only the TAKEN cards, and carries no `dest` and no `reveal`", () => {
    const state = board(16);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    const taken = [deckAt(seededState, 0), deckAt(seededState, 3)];
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: taken },
    });
    // 🛑 THE DIVISION OF LABOUR THE EVENT DOC STATES: the cards that WERE taken are
    // named by this op's own row, the ones that were not are named by
    // DECK_TOP_DISCARDED, and neither row repeats the other's cards.
    expect(find(events, "DECK_TOP_REVEALED")).toEqual({
      type: "DECK_TOP_REVEALED",
      seat: "p1",
      uids: taken,
    });
    // …and the LOOK precedes the DISCARD: the player saw the six before four of
    // them left.
    expect(types(events).indexOf("DECK_TOP_REVEALED")).toBeLessThan(
      types(events).indexOf("DECK_TOP_DISCARDED"),
    );
  });

  it("🛑 NOTHING SHUFFLES — the deck below the window keeps its exact order", () => {
    const state = board(17);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    // 🛑 **THE MUTANT THIS KILLS IS AN APPENDED `{ op: "shuffleDeck" }`**, which is
    // what six of the seven `lookAtTopN` registry rows carry and what a copy of any
    // of them would bring along. Read as the whole tail rather than as a spot check:
    // a shuffle that happened to fix one index is not a shuffle that did not happen.
    const tail = seededState.players.p1.deck.slice(6);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [deckAt(seededState, 0), deckAt(seededState, 1)] },
    });
    expect(done.players.p1.deck).toEqual(tail);
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("🛑 GREAT BALL ON THE SAME SEEDED BOARD DIFFERS IN ALL FOUR — the attribution control", () => {
    const state = board(18);
    const { seededState, parked, prompt } = play(state, "sv02-183");
    // The SAME op over the SAME seeded deck. Without this row, "the filter admits
    // everything", "the floor is the printed take", "the leftovers were discarded"
    // and "the tail was untouched" are each indistinguishable from a board that
    // simply never had another card in it — D214's rule for any check whose subject
    // is shared.
    expect(prompt.candidates).toEqual([deckAt(seededState, 0), deckAt(seededState, 1)]);
    expect(prompt.min).toBe(0); // the printed "you may"
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon into your hand.",
    );
    const tail = seededState.players.p1.deck.slice(1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [deckAt(seededState, 0)] },
    });
    // NO leftovers row — Great Ball has no `discardRest`, so the five it did not
    // take are still in the deck…
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    // …and its trailing `shuffleDeck` then scrambles them, which is exactly the
    // tail-order fact the case above proves this card does NOT have.
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.deck).not.toEqual(tail);
    expect([...done.players.p1.deck].sort()).toEqual([...tail].sort());
  });

  it("🛑 A SHORT DECK CLAMPS THE FLOOR — the one obligation `max` never had", () => {
    const state = board(19);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    // ONE card left under a printed window of six: the candidate set is smaller than
    // the printed take, and an unclamped `min: 2` here is a prompt with no legal
    // answer at all — the player can never leave the phase.
    const short = trimDeckTo(withCard, "p1", 1);
    const only = deckAt(short, 0);
    const uid = handUid(short, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(short, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.min).toBe(1);
    // ⚠️ THE CEILING IS NOT CLAMPED AND DOES NOT NEED TO BE: a `max` above the
    // candidate count cannot bind, which is precisely why `"any"` (D333) could be
    // resolved anywhere and this could not.
    expect(parked.phase.prompt.max).toBe(2);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [only] },
    });
    expect(done.players.p1.hand).toContain(only);
    // The whole window was taken, so there are no leftovers and the event that
    // "only fires with ≥1 card" does not fire.
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(done.players.p1.deck).toHaveLength(0);
  });

  it("⚠️ a window SHORTER than `n` still discards what is left of it", () => {
    const state = board(20);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const short = trimDeckTo(seeded(withCard), "p1", 3);
    const window = [0, 1, 2].map((i) => deckAt(short, i));
    const uid = handUid(short, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(short, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // Three candidates, a floor of two, and ONE leftover — the case that proves the
    // leftovers are the window minus the picks rather than a fixed `n - max`.
    expect(parked.phase.prompt.candidates).toHaveLength(3);
    expect(parked.phase.prompt.min).toBe(2);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[2] as string] },
    });
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toEqual([window[1]]);
    expect(done.players.p1.deck).toHaveLength(0);
  });

  it("⚠️ AN EMPTY DECK LOOKS AT NOTHING AND DISCARDS NOTHING — no row either way", () => {
    const state = board(21);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const empty = trimDeckTo(withCard, "p1", 0);
    const uid = handUid(empty, "p1", "fix-explorersguidance");
    const { state: done, events } = mustApply(empty, { type: "playTrainer", seat: "p1", uid });
    // D241's rule and its mirror: a look that happened is announced even when it
    // moved nothing, and a look that did NOT happen must not be. Nobody looked here,
    // so neither row may appear — and the `discardRest` path must not invent a
    // discard out of an empty window.
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(done.phase.kind).toBe("turn:action");
  });
});
