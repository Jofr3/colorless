import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { deriveAttackEffect } from "./effects";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  ROTO_STICK_DECK,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
} from "./testFixtures";

// D333 — ROTO-STICK `sv08.5-127`, THE UNBOUNDED LOOK, AND A PRICE THAT NAMED THE
// RESOLUTION WHILE THE COST SAT IN THE CAPTION.
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Look at the top 4 cards of your deck. You may reveal **any number of**
//    Supporter cards you find there and put them into your hand. Shuffle the
//    other cards back into your deck."
//   Item, **1 Standard-legal printing.**
//
// ── THE CENSUS, AT THREE WIDTHS AND OVER ALL THREE TEXT COLUMNS ─────────────
// Re-run against the remote D1 `luminous` at THIS head (2026-08-14) rather than
// inherited, with every per-column split re-added against its own total.
//
//   (a) `instr(<col>,'reveal any number of') > 0` — the printed CLAUSE:
//         `effect`          3 rows / 1 legal
//         `attacks_json`    0 rows / 0 legal
//         `abilities_json`  0 rows / 0 legal
//       TOTAL 3 rows / 1 legal.  3 + 0 + 0 = 3 ✅   1 + 0 + 0 = 1 ✅
//       🛑 **THE SENTENCE HAS THREE PRINTINGS AND THE ROW HAS ONE**, which is the
//       measurement worth keeping: the other two are Bill's Transfer
//       `sv03.5-156`/`-194` — *"Look at the top 8 cards of your deck. You may
//       reveal any number of **Pokémon** you find there and put them into your
//       hand."* — and both are `legal_standard = 0`. An arm transfers across
//       sets and a registry row does not (D187), so those two are what the
//       `"any"` member serves for free the day they rotate back, and they are
//       NOT counted in this slice's yield.
//
//   (b) `instr(<col>,'any number of') > 0` — the phrase, widened off the verb so
//       a different verb cannot hide behind it:
//         `effect`          8 rows /  4 legal
//         `attacks_json`   31 rows / 17 legal
//         `abilities_json` 10 rows /  5 legal
//       TOTAL 49 rows / 26 legal. 8 + 31 + 10 = 49 ✅  4 + 17 + 5 = 26 ✅
//       The attack and ability bulk is the ATTACH family (`attachFromTop`, whose
//       `max` has carried `"any"` since M5) and the two derived BENCH sentences
//       — which is exactly why this row is a widening and not an invention.
//
// ── WHAT THE RESUME POINT PRICED, AND THE CLAUSE THAT WAS FALSE ─────────────
// It read: *"It is `lookAtTopN` with `max: "any"`, and the op's `max` is typed
// `number`. `attachFromTop` **already carries `max: number | "any"`** … THE PRICE
// TO CHECK: `lookNote`'s *"up to N"* phrasing and `prompt.max`, which is a
// `number` on the wire — so the park must resolve it to a concrete cap the way
// `attachFromTopOffer` does. **That resolution is the whole row, and it is where
// the cost is.**"*
//
// ✅ **THE FIRST CLAUSE IS TRUE**: `attachFromTop.max` really is `number | "any"`,
//    and the vocabulary really did exist one op over.
//
// 🛑 **"THAT RESOLUTION IS THE WHOLE ROW" IS THE FALSE HALF.** Grepping every
//    reader of a `lookAtTopN` op's `max` returns **THREE SITES, ALL INSIDE ONE
//    `case` BLOCK** (`totalMax`, `caps[0].max`, the `lookNote` call), and the
//    clamp has THREE precedents in the same file: `attachFromTopOffer`, `moveCap`
//    — whose own doc already says *"the clamp is what keeps the PROMPT's `max` a
//    number — no wire shape moves for this"* — and `attachNote`, which spells the
//    string `"any number of"` **verbatim**. The resolution is four lines.
//
// 🛑 **AND THE HALF THE PRICE NEVER MENTIONED IS THE ONE THAT COSTS: THIS PHRASE
//    WAS ALREADY SPELLED, AS `max: n`, UNDER A PINNED TEST SAYING SO.** D241's
//    derived bench arm emits `max: n` for the identical printed words, and
//    `derivedLookAtTop.test.ts` carried a case literally named *"'any number of'
//    is the WINDOW, not a new union member"*. Its reasoning is sound about the
//    PREDICATE — the candidate set is a subset of the top `n`, so `max: n` is a
//    bound that cannot bind — and blind to the CAPTION: `lookNote` reads that same
//    field and prints *"up to 8"* over a sentence carrying no number at all. So
//    the row is not a missing resolution. It is a **REVERSAL of a pinned
//    decision**, forced by the words rather than by the predicate, and D244 made
//    the identical call one op over for `moveEnergy`'s *"any amount of"*.
//
// 🆕 **THE LESSON: A VALUE THAT IS EQUIVALENT AS A PREDICATE IS NOT NECESSARILY
//    EQUIVALENT AS A CAPTION.** Four sessions running the inherited price has been
//    false in exactly the clause that made the row cheap — D330's had already
//    shipped, D331's sharing was invented, D332's obstacle was the wrong half, and
//    this one names a cost that is four lines while the real one is a decision
//    already made the other way. **THE INSTRUMENT IS READING BOTH SIDES OF THE
//    SEAM, AND "BOTH SIDES" INCLUDES THE STRING THE PLAYER READS.**

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: ROTO_STICK_DECK, p2: ROTO_STICK_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** A seeded top: **two** Supporters over **two** non-Supporters inside the top 4,
    with a third Supporter buried at index 4 so the window boundary is observable.
    Pokégear's window is 7, so its own view reaches that buried one and this
    seeding drives both cards off ONE deck.

    🛑 **FEWER SUPPORTERS THAN CARDS IS THE WHOLE DESIGN.** `max: "any"` and
    `max: 4` are the same PREDICATE here — the candidates are a subset of the top 4
    either way — so a window of four Supporters makes every assertion in this file
    pass on both builds. Two over two is the narrowest board on which the resolved
    cap and the caption can disagree.

    ⚠️ **THE THREE SUPPORTERS ARE MOVED IN ONE CALL AND NOT THREE**, which is a
    real property of the helper rather than a style choice: `toDeckTop` takes the
    FIRST `count` copies in DECK ORDER, so a second single-copy call for the same
    id re-picks the copy the first call just put on top and the window ends up one
    card short. Asked for as a batch, then pushed down by the two cards that go
    above them. */
function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "sv01-189", 3); // three Supporters, indices 0-2…
  next = toDeckTop(next, "p1", "fix-energy", 1); // …pushed to 1-3 by a non-Trainer…
  next = toDeckTop(next, "p1", "fix-item", 1); // …and to 2-4 by an Item, so index 4 is buried
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

describe("D333 — Roto-Stick, the unbounded lookAtTopN window", () => {
  it("the registry resolves a program for the printing AND for the demonstrator", () => {
    // 🛑 D330's finding, kept as a standing check one more op over: a union member
    // can be wired at every site, type-check everywhere and have ZERO printed
    // consumers. `sv08.5-127` plus `fix-rotostick` are what stop `max: "any"` on
    // THIS op from being that — and the second half matters, because the pool the
    // boards below run on is `FIXTURE_POOL` and it holds no `sv08.5` row.
    expect(programFor("sv08.5-127")).toBeDefined();
    expect(programFor("fix-rotostick")).toBeDefined();
    expect(programFor("fix-rotostick")).toBe(programFor("sv08.5-127"));
  });

  it("the program is Pokégear's with the cap taken off — read off the registry", () => {
    // The attribution control, before any board runs: Pokégear 3.0 is this program
    // with the SAME filter under a NUMERIC cap, so every difference the boards
    // observe below is attributable to the `max` spelling and to nothing else.
    const roto = programFor("fix-rotostick")?.trainer?.[0];
    const pokegear = programFor("sv01-186")?.trainer?.[0];
    if (roto?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (pokegear?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(roto.filter).toEqual(pokegear.filter);
    expect(roto.reveal).toBe(pokegear.reveal);
    expect(roto.max).toBe("any");
    expect(pokegear.max).toBe(1);
    // The printed window, which differs from Pokégear's and is the other half of
    // "an arm transfers, a row does not": 4 is on the card.
    expect(roto.n).toBe(4);
    // ⚠️ NO `also`, said out loud. D332's field is the WRONG shape for this
    // sentence — one noun, one cap — and a row that grew one would cap the print.
    expect(roto.also).toBeUndefined();
    expect(programFor("fix-rotostick")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    // 🛑 D330's OTHER finding: a program can be reachable from the catalog and
    // still unreachable from the only pool the tests own. This is the line that
    // ties the demonstrator's printed bytes to the real card's.
    expect(FIXTURE_POOL["fix-rotostick"]?.effect).toBe(
      "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
    );
    expect(FIXTURE_POOL["fix-rotostick"]?.trainerType).toBe("Item");
  });

  it("offers the Supporters in the window and nothing else", () => {
    const state = board(11);
    const { seededState, prompt } = play(state, "fix-rotostick");
    expect([...prompt.candidates].sort()).toEqual(
      [deckAt(seededState, 2), deckAt(seededState, 3)].sort(),
    );
    // ⚠️ THE MUTANT THIS KILLS: widening `supporter` to `trainerCard` — the member
    // one registry row over, and the copy an author would actually make. Index 3
    // is an ITEM sitting inside the window, so a widened filter offers three rows.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 0));
    // …and the non-Trainer at index 1, which any Trainer filter would refuse.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 1));
  });

  it("🛑 the resolved cap is the SUPPORTERS in the window, not the window — `\"any\"`, not 4", () => {
    const state = board(12);
    const { prompt } = play(state, "fix-rotostick");
    // 🛑 **THIS IS THE CASE THE WHOLE BOARD WAS SHAPED FOR.** `max: "any"` and
    // `max: 4` are the same predicate over this window; they differ here and in
    // the caption below, and nowhere else a player can see. The mutant this kills
    // is resolving against `top.length` (4) or against `op.n` rather than against
    // the group's own matches — a prompt counting "0/4" over two rows, which is
    // `attachFromTopOffer`'s stated reason for clamping one op over.
    expect(prompt.max).toBe(2);
    // …and the printed "you may", which makes taking none a legal answer.
    expect(prompt.min).toBe(0);
    // ⚠️ AND NO `caps`: this sentence has one noun, so a per-kind cap would be a
    // wire field no printing here spells (D135 — absent, never `undefined`).
    expect(prompt).not.toHaveProperty("caps");
  });

  it("🛑 the caption prints the card's own words, and carries NO number", () => {
    const state = board(13);
    const { prompt } = play(state, "fix-rotostick");
    // 🛑 **THE HALF THE INHERITED PRICE NEVER NAMED.** D244's rule, applied to this
    // op for the first time: the printed words are spelled, never resolved to the
    // clamp. A build carrying `max: 4` produces "up to 4 Supporter cards" — a
    // number in front of a sentence that prints none — and a build resolving the
    // caption from the board produces "up to 2", which is worse, because it changes
    // with the shuffle.
    expect(prompt.note).toBe(
      "Look at the top 4 cards of your deck and put any number of Supporter cards into your hand.",
    );
    expect(prompt.note).not.toContain("up to");
  });

  it("takes ALL of them — the cap really does not bind", () => {
    const state = board(14);
    const { seededState, parked } = play(state, "fix-rotostick");
    const both = [deckAt(seededState, 2), deckAt(seededState, 3)];
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: both },
    });
    for (const uid of both) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    // The printed "reveal", forwarded onto the event exactly as Great Ball's is.
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      uids: both,
      reveal: true,
    });
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ the DECLINE is legal, and the look is still announced", () => {
    const state = board(15);
    const { parked } = play(state, "fix-rotostick");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    // D241's rule: the look is the announcement and the move is only its
    // consequence, so an empty take still emits the row.
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ seat: "p1", uids: [] });
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ a Supporter PAST the window is unreachable — `n: 4`, not Pokégear's 7", () => {
    const state = board(16);
    const { seededState, prompt } = play(state, "fix-rotostick");
    // ⚠️ THE MUTANT THIS KILLS: `n: 7` (Pokégear's window, the program this row was
    // modelled on). Index 4 is a Supporter, so a 7-card window offers three rows.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 4));
    expect(prompt.candidates).toHaveLength(2);
  });

  it("🛑 POKÉGEAR ON THE SAME BOARD CAPS AT 1 AND SAYS SO — the attribution control", () => {
    const state = board(17);
    const { seededState, prompt } = play(state, "sv01-186");
    // The SAME filter over the SAME seeded deck, differing in the `max` spelling
    // alone. Without this row, "the cap resolved to the candidate count" and "the
    // cap was 2 because 2 is what a numeric build would also have said here" are
    // indistinguishable — D214's rule for any check whose subject is shared.
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Supporter card into your hand.",
    );
    // …and its wider window really does see the buried Supporter this card cannot.
    expect(prompt.candidates).toContain(deckAt(seededState, 4));
  });

  it("⚠️ the two DERIVED bench sentences now spell the same phrase the same way", () => {
    // 🛑 THE POINT OF RE-POINTING D241's ARM RATHER THAN LEAVING IT: one op must
    // not carry two spellings of one printed phrase, or the next author copies the
    // wrong one. Asserted from the outside, on the DERIVER, so this file goes red
    // if a later slice re-points only one of the two.
    const derived = deriveAttackEffect(
      "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    );
    expect(derived?.[0]).toMatchObject({ op: "lookAtTopN", max: "any" });
    const roto = programFor("fix-rotostick")?.trainer?.[0];
    if (roto?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(roto.max).toBe(derived?.[0] && "max" in derived[0] ? derived[0].max : undefined);
  });
});
