import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { logFromEvents } from "./log";
import {
  DERIVED_LOOK_TOP_DECK,
  benchFromDeck,
  clearBench,
  driveSetup,
  attachFromDeck,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  types,
} from "./testFixtures";

// 0.156.0 → 0.157.0 — D241, LOOK AT THE TOP N: backlog row 11, and the slice
// that paid the `DECK_TOP_REVEALED` fidelity debt the page had been carrying
// since D224 named it.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT FOR THE EIGHTH ROW RUNNING, and this is
// the first of the eight where the row's own INHERITED figure was the thing
// under test rather than a fresh number. The row says `33 = 15 (7 sentences) · 5
// · 13`; the query returns 15 attack printings on 7 sentences, 3·3·3·2·2·1·1.
// The SQL is on `effects.ts`'s constants, beside the arms it produced.
//
// ⚠️ AND THE VERB WAS SWEPT WIDER THAN THE ROW (D239's rule, third slice
// running): `'*top card of your deck*'`, `'*top card of your opponent*'`,
// `'*[Rr]eveal*deck*'` and `'*top * cards of*'` with the row's own GLOB excluded
// return 32 further sentences and NOT ONE is this family. "Look at" and "Reveal"
// are different verbs selecting different ops, which is D232's noun-vs-verb rule
// holding from the other side.
//
// 🛑 THE PREDICTION, GRADED — **PART WRONG, SEVENTH SLICE RUNNING.** The resume
// point predicted: TWO anchors; 9 of the 15; at least ONE new op field; no
// `MATCH_RECORD_VERSION` bump; the count re-derives unchanged; and `redact.ts`
// NON-ZERO "for the first time in eight slices".
//   • 🛑 "TWO anchors" LOSES — there are **THREE**, and the third was free:
//     `attachFromTop` has run since M5 and Lapras ex's sentence needed a READER
//     and nothing else. The prediction reasoned about the two VERBS that write
//     somewhere ("put back in any order" vs "put/attach/discard what you find")
//     and both halves of that split were wrong: the reorder verb is the one this
//     slice CANNOT read, and the "what you find" half is three destinations, not
//     one.
//   • 🛑 "9 of the 15" LOSES by one, and in the good direction: **10**.
//   • ✅ "at least ONE new op field" — correct, and exactly one:
//     `lookAtTopN.dest`.
//   • ✅ "no `MATCH_RECORD_VERSION` bump" — correct, and the risk clause it
//     flagged (*"`lookAtTopN` already parks, so its continuation shape is the
//     risk"*) was the right thing to check: the park's `dest` was already a
//     five-member union, so no continuation shape changed at all.
//   • ✅ "the count re-derives unchanged at 15 on 7 sentences" — correct.
//   • 🛑 "`redact.ts` NON-ZERO" LOSES, and the loss is the interesting one. The
//     argument was that a deck-top look is a hidden-zone read D232's ruling did
//     not cover. Measured at **ZERO**: `redactedPromptOf` resolves candidate
//     identities to the ANSWERER ALONE, the prompt is redacted BY KIND, and its
//     `dest` union has spelled every value this slice needs since `payFromHand`.
//     **D232's precedent transfers to the deck top intact.** What did not
//     transfer was the LOG's coverage — see below — which is where the debt
//     actually was, and no read-site grep would have found it because the defect
//     was an event that was never PUSHED.
//
// 🛑🛑 THE FIDELITY DEBT, SETTLED, AND THE ANSWER IS "THE LOG — BUT IT WAS
// INCOMPLETE, NOT MIS-ROUTED." `coverage-backlog-legal.md` filed
// `lookAtTopN`/`DECK_TOP_REVEALED` as the twin of the printed-reveal debt, on the
// claim that taking this row would "ship a look the OPPONENT never sees". Priced
// three ways:
//   • the opponent's PROJECTION (`redact.ts`) — **no**. The looked-at cards were
//     never face-up to anybody but the looker and they go back under a shuffle,
//     so there is nothing for the other seat's board to hold. Putting them there
//     would be a leak, not a fix.
//   • the opponent's LOG — **yes, and it was already the channel**. D225 built
//     the `reveal` rider and its two renders.
//   • NEITHER — **no**, and this is what the debt was actually about: the row
//     only ever fired when cards MOVED. The whiff (nothing up there matched) and
//     the decline (looked, took none) emitted no event at all, so exactly the two
//     paths where a player converts a look into pure private knowledge were the
//     two the opponent could not see. **A look is a transfer of INFORMATION; the
//     move is only its consequence.**
// The event now fires on every path with `uids: []` on the empty ones, and
// `sv09-084`'s "You may discard that card" is the printing that makes it matter:
// its decline is a common, deliberate answer.
//
// ⚠️ FLAGGED AS AN ASSUMPTION RATHER THAN A RULING, with both sides recorded.
// FOR: §1's shuffle-the-rest exists precisely so the knowledge is spent, which is
// a claim about what the other player is entitled to know happened; and this
// engine already announces a milled card the opponent never chose to see
// (`DECK_TOP_DISCARDED`). AGAINST: no printed rule requires announcing a look
// that moved nothing, and a paper game announces it only because the physical act
// is visible. The other reading — fire only when cards move, i.e. what shipped
// before this slice — is installed as a MUTANT (`scripts/mutation/mutants.ts`),
// so choosing it back is a one-line change that turns this suite red by name.
//
// ⚠️ NO `actor` FIELD ON THE EVENT, and that was priced rather than skipped: its
// sibling `DECK_TOP_DISCARDED` carries one (D136/D153) because a mill reads one
// player's deck on another player's turn. Every `lookAtTopN` printing reads the
// controller's OWN deck, so `actor === seat` on every path and the field would
// have no observable meaning (D135). Row 11's opponent-deck sentences are exactly
// what would buy it, and they are the residue below.

/** One printed sentence, its program, and the printings measured for it. Both
    figures: `printings` over the whole remote catalog (3,786 rows / 20 sets),
    `legalPrintings` over the Standard pool (2,021 rows) — a count without a
    POPULATION and a LEGALITY is not a fact. */
interface Clause {
  readonly text: string;
  readonly program: readonly EffectOp[];
  readonly legalPrintings: number;
  readonly ids: readonly string[];
}

/** ⚠️ NAMED CONSTANTS RATHER THAN INDICES INTO `CLAUSES` — D237's rule:
    `noUncheckedIndexedAccess` makes every `CLAUSES[i]` optional unless the array
    is an `as const` TUPLE, and a tuple would make each `program` deeply readonly
    and therefore no longer an `EffectOp`. */
const BENCH_8: Clause = {
  text: "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
  program: [
    { op: "lookAtTopN", n: 8, filter: { kind: "anyPokemon" }, max: "any", dest: "bench" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 2,
  ids: ["sv05-072", "sv05-171"], // Reuniclus "Summoning Gate"
};
/** The SAME sentence at a different printed window — which is the whole reason
    the window is a capture and not a literal. Two cards, four printings, one arm. */
const BENCH_10: Clause = {
  text: "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
  program: [
    { op: "lookAtTopN", n: 10, filter: { kind: "anyPokemon" }, max: "any", dest: "bench" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 2,
  ids: ["sv08-142", "sv08-226"], // Tatsugiri ex "Cinnabar Lure"
};
/** `attachFromTop`, an op that has run since M5 — the arm buys a READER and
    nothing else. Its window of 20 is what forced `MAX_PRINTED_LOOK_WINDOW` to be
    its own constant rather than `MAX_PRINTED_ATTACH_COUNT`. */
const ATTACH_20: Clause = {
  text: "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
  program: [
    { op: "attachFromTop", n: 20, filter: { kind: "anyEnergy" }, max: "any" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 3,
  ids: ["svp-164", "sv07-032", "sv07-158"], // Lapras ex "Larimar Rain"
};
/** The one sentence in the family where the LOOK is the whole effect, and the
    reason the fidelity fix is not cosmetic. */
const DISCARD_TOP: Clause = {
  text: "Look at the top card of your deck. You may discard that card.",
  program: [{ op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" }],
  legalPrintings: 3,
  ids: ["sv09-084", "sv10.5w-016", "sv10.5w-101"], // Rockruff / Litwick ×2
};

const CLAUSES: readonly Clause[] = [BENCH_8, BENCH_10, ATTACH_20, DISCARD_TOP];

/** 🛑 THE **ONE** LEGAL PRINTING THIS FAMILY STILL DOES **NOT** READ, with the
    legal count and the reason. Pinned derived-to-null so the residue is a fact
    about the code rather than a note in a doc.

    🆕🆕 **D341 REMOVED FOUR OF THE FIVE — THE WHOLE ORDERED-ANSWER SHAPE.** This
    block used to read *"ONE MECHANISM, NOT FIVE, AND IT IS A PROMPT KIND… that is
    a bigger slice than this one"*, and it priced the slice exactly right: a new
    prompt kind, a new wire schema member, a new redact arm, a new projection arm
    and two dialogs is what `orderCards` cost. It also predicted the SECOND thing
    those printings buy — *"a `whose` fork and the event's `actor` field both
    arrive with those printings and not before"* — and both did, as
    `reorderTop.side` and `DECK_TOP_REORDERED.actor`. **A RESIDUE NOTE THAT NAMES
    THE MECHANISM AND ITS RIDERS IS A PRICE A LATER SLICE CAN SPEND**, and this one
    was spent unchanged four decisions later. See `derivedReorderTop.test.ts`.

    ⚠️ **WHAT IS LEFT IS ONE SENTENCE AND IT IS NOT AN ORDERING AT ALL** — the
    second seat's deck under a *"you may"* whose consequent is a SHUFFLE of a deck
    the actor does not own. `reorderTop.side` gave this family its first read of
    another seat's deck, so the zone is no longer the blocker; what still blocks it
    is the two-seat CONSENT (the actor asks, the owner shuffles), which is
    `opponentMayDraw`'s shape pointed at a deck rather than a hand. */
const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck.",
    1,
    "a look into the OPPONENT's deck under a 'you may', whose consequent is a shuffle of a deck the actor does not own — two seats in one sentence (Inkay sv06.5-033)",
  ],
] as const;

/** Constructed near misses, kept apart from `UNREAD` because they have no
    printing at all and would otherwise inflate its arithmetic. Each is a program
    a plausible build would emit and this one must refuse. */
const NEAR_MISSES: readonly (readonly [string, string])[] = [
  [
    "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck. Draw a card.",
    "a TRAILING CLAUSE — the terminal `$`, and the reason these patterns are literal to the last byte rather than a greedy `(.+)` that would backtrack past the period",
  ],
  [
    "Look at the top 0 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a printed 0 — the ingested-text floor every arm in this file carries, which would otherwise derive a window nobody looks at",
  ],
  [
    "Look at the top 99 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "past `MAX_PRINTED_LOOK_WINDOW` — one malformed third-party row must not size a prompt",
  ],
  // ⚠️⚠️ D240's SURVIVING MUTANT, RE-HOMED AS A CASE. `Number`'s grammar is wider
  // than it looks: `Number("4e1")` is 40, `Number("0x28")` is 40, `Number("4.5")`
  // is 4.5. Any capture that feeds `Number` owes a `\d+` AND a case proving it,
  // and these are that case at BOTH window ceilings.
  [
    "Look at the top 4e1 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "EXPONENTIAL notation — `Number('4e1')` is 40, so a `.+` capture here would size a 40-card window off a string no card prints",
  ],
  // 🛑 THE CASE THE MUTANT ASKED FOR, AND ITS FIRST RUN IS WHY IT EXISTS. The
  // greedy-capture mutant on THIS pattern SURVIVED its first run, because every
  // case above it lands outside `MAX_PRINTED_LOOK_WINDOW` or below the floor and
  // is therefore refused by the GUARD rather than by the capture class — a
  // refusal that would look identical on a build with no class at all. A
  // FRACTIONAL window is the one value that passes both guards, so it is the only
  // input that can tell the two builds apart. **A near-miss table can be full of
  // cases and still prove nothing about the layer it names.**
  [
    "Look at the top 4.5 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a FRACTIONAL window on the BENCH sentence — `Number('4.5')` is 4.5, which passes BOTH the floor and the ceiling, so this is the only case that distinguishes `\\d+` from `.+` here",
  ],
  [
    "Look at the top 0x14 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "HEXADECIMAL — `Number('0x14')` is 20, the exact printed window, so this is the mutant that would have looked correct",
  ],
  [
    "Look at the top 4.5 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "a FRACTIONAL window — `Number('4.5')` is 4.5, and `deck.slice(0, 4.5)` is a silent truncation nobody authored",
  ],
  // 🛑 THE SECOND CASE A SURVIVING MUTANT ASKED FOR. The dropped-`$` mutant on
  // the ATTACH pattern survived its first run too: the trailing-clause case above
  // is on the BENCH sentence only, and three anchors need three of it. **A
  // near-miss written for one arm proves nothing about its siblings** — which is
  // the same finding as the fractional window one axis over, arriving twice in
  // one slice.
  [
    "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck. Draw a card.",
    "a TRAILING CLAUSE on the ATTACH sentence — the terminal `$` is the ONLY thing refusing it, since the pattern is literal to its last byte and has no `[^.]` class to stop at the period",
  ],
  [
    "Look at the top card of your deck. You may discard that card. Draw a card.",
    "the same trailing clause on the DISCARD sentence, which is a `test` rather than an `exec` and therefore has no capture to backtrack — three anchors, three cases",
  ],
  [
    "Look at the top 8 cards of your deck. You may put any number of Supporter cards you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a NON-POKÉMON noun at the Bench destination — nothing downstream re-checks it (`searchDeck`'s precedent), so the printed word 'Pokémon' is welded into the pattern rather than captured",
  ],
  [
    "Look at the top 20 cards of your deck and attach any number of Basic Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "the printed word 'Basic' — a real narrowing this arm does not spell, and admitting it under `anyEnergy` would attach a Special Energy the sentence excludes",
  ],
  [
    "Look at the top card of your opponent's deck. You may discard that card.",
    "the OPPONENT's deck on the discard sentence — the op reads `ctx.seat`'s deck and nothing else, so a build that matched this would silently mill the wrong player",
  ],
];

// ── The board. `fix-trainerops` indices 55/56/57, appended by D241. ──
const SUMMONING_GATE = 55;
const LARIMAR_RAIN = 56;
const DIG_IT_UP = 57;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DERIVED_LOOK_TOP_DECK, p2: DERIVED_LOOK_TOP_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order. p2 is a plain body so nothing on the other side of the table
    can be reached by accident. */
function ready(seed: number, bench: readonly string[] = []): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a prompt is offering, sorted — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolveCards = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

const activeRef: PokemonRef = { seat: "p1", spot: { spot: "active" } };

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchors — four printed sentences, THREE arms", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 10 of the row's 15 legal printings here, 4 more at D341, 1 left", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one sentence would still pass every accept case above.
    expect(CLAUSES).toHaveLength(4);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(10);
    // 🆕 D341 — THE RESIDUE FELL 5 → **1** ON 3 → **1** SENTENCES. Four of the five
    // were the ordered answer this file's own residue note priced, and they are
    // read by `reorderTop` now (`derivedReorderTop.test.ts`, 4 legal on 2
    // sentences). What is left is one sentence and it is not an ordering.
    expect(UNREAD).toHaveLength(1);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 🛑 THE ROW'S TOTAL IS RE-ADDED FROM ITS PARTS, NOT DECREMENTED: this file's
    // 10 + D341's 4 + the 1 unread = 15 on 4 + 2 + 1 = 7 sentences — exactly what
    // the backlog row measured, and the same 15/7 the pre-D341 split summed to.
    const D341_PRINTINGS = 4;
    const D341_SENTENCES = 2;
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        D341_PRINTINGS +
        UNREAD.reduce((sum, [, legal]) => sum + legal, 0),
    ).toBe(15);
    expect(CLAUSES.length + D341_SENTENCES + UNREAD.length).toBe(7);
    // …and the four D341 sentences are no longer null, which is the other half of
    // the same claim: this rung must go red if that reader is ever removed.
    for (const text of [
      "Look at the top 4 cards of your deck and put them back in any order.",
      "Look at the top 5 cards of your opponent's deck and put them back in any order.",
    ]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
    }
  });

  it("each id named above is a REAL Standard-legal printing count, not a paraphrase", () => {
    // D183's rule: author and assert against the printed bytes. The ids are the
    // provenance of the counts, so a row whose id list and count disagree is a
    // census nobody ran.
    for (const clause of CLAUSES) {
      expect(clause.ids, clause.text).toHaveLength(clause.legalPrintings);
      expect(new Set(clause.ids).size).toBe(clause.ids.length);
    }
  });

  it("refuses every near miss — and each for its OWN reason", () => {
    for (const [text, why] of NEAR_MISSES) {
      expect(deriveAttackEffect(text), `${text} — ${why}`).toBeNull();
    }
  });

  it("the two window ceilings are DIFFERENT numbers, and the catalog is why", () => {
    // 🛑 The one place sharing `MAX_PRINTED_ATTACH_COUNT` would have been silently
    // wrong: Lapras ex's printed window is 20, twice that ceiling, so the three
    // printings would have derived to null and nobody would have been told why.
    expect(deriveAttackEffect(ATTACH_20.text)).not.toBeNull();
    expect(
      deriveAttackEffect(
        "Look at the top 30 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackEffect(
        "Look at the top 31 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      ),
    ).toBeNull();
  });

  it("the BENCH filter is welded to the printed noun, so the benchable guard has nothing to do", () => {
    // 🛑 D237's arm needs `BENCHABLE_RETRIEVAL_KINDS` because its noun comes out
    // of a TABLE. This one cannot: the pattern spells "Pokémon" literally, so the
    // only filter it can emit is `anyPokemon` — which is IN that set. Asserted
    // from the outside rather than left in a comment.
    for (const clause of [BENCH_8, BENCH_10]) {
      const [look] = deriveAttackEffect(clause.text) as EffectOp[];
      expect(look).toMatchObject({ op: "lookAtTopN", filter: { kind: "anyPokemon" } });
    }
  });

  it('🆕 D333 — "any number of" is the printed WORDS, and D241 spelled it as the window', () => {
    // 🛑 **THIS CASE USED TO ASSERT THE OPPOSITE, AND THE REVERSAL IS DELIBERATE.**
    // It was named *"'any number of' is the WINDOW, not a new union member"* and
    // pinned `max: 8` / `max: 10`. D241's reasoning held as far as it went — the
    // candidate set is a subset of the top `n`, so `max: n` is a bound that cannot
    // bind — but `lookNote` reads this SAME field and captions `max > 1` as
    // "up to N", so both printings told the player "put **up to 8** Pokémon onto
    // your Bench" over a sentence that prints no number anywhere. D244 made the
    // opposite call one op over for `moveEnergy` ("'any amount' is the PRINTED
    // words and is spelled rather than resolved to the clamp"), and this arm now
    // agrees with it. **A VALUE THAT IS EQUIVALENT AS A PREDICATE IS NOT
    // NECESSARILY EQUIVALENT AS A CAPTION.**
    const [look8] = deriveAttackEffect(BENCH_8.text) as EffectOp[];
    const [look10] = deriveAttackEffect(BENCH_10.text) as EffectOp[];
    expect(look8).toMatchObject({ n: 8, max: "any" });
    expect(look10).toMatchObject({ n: 10, max: "any" });
  });

  it("🆕 D333 — and it DRIVES: the prompt caps at the window's Pokémon, and says the printed words", () => {
    // ⚠️ THE OLD PIN COULD NOT SEE EITHER HALF OF THIS, WHICH IS WHY IT IS
    // REPLACED BY A DRIVER RATHER THAN RE-POINTED IN PLACE. It compared a field
    // against a literal and stopped; both consequences of the field live on a
    // parked prompt.
    let state = ready(9, ["fix-basic-1"]);
    // The board is WIDENED so the two readings can differ at all: 5 non-Pokémon
    // over 3 Pokémon inside the top 8, so `max: n` resolves to 8 and `"any"`
    // resolves to 3. On a window that is all Pokémon the two are equal and every
    // assertion below would pass with the change reverted — D331's vacuous-guard
    // rule, and this is the board narrow enough to catch it.
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-duskull", 3);
    const parked = attack(state, SUMMONING_GATE).state;
    // ⚠️ THE MUTANT THIS KILLS: resolving `"any"` against `top` (8) or against the
    // printed window rather than against the group's own matches. The prompt would
    // then count "0/8" over three rows and invite a pick that does not exist —
    // `attachFromTopOffer`'s stated reason for clamping, one op over.
    expect(cardsPrompt(parked).max).toBe(3);
    // ⚠️ AND THE CAPTION, which is the whole reason the member exists: the printed
    // sentence carries no number, so neither may the note.
    expect(cardsPrompt(parked).note).toBe(
      "Look at the top 8 cards of your deck and put any number of Pokémon onto your Bench.",
    );
    expect(cardsPrompt(parked).note).not.toContain("up to");
  });

  it("the DISCARD sentence carries NO trailing shuffle, and the absence is printed", () => {
    // A one-card window has no leftovers, so there is nothing to shuffle back —
    // and on the DECLINE a shuffle would scramble a top the player deliberately
    // kept, which is the opposite of what the card offers.
    expect(deriveAttackEffect(DISCARD_TOP.text)).toHaveLength(1);
    // …where both bench printings DO carry it, off their own printed clause.
    expect(deriveAttackEffect(BENCH_8.text)?.[1]).toEqual({ op: "shuffleDeck" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BOARD — the three arms driven end to end
// ─────────────────────────────────────────────────────────────────────────────

describe("Summoning Gate — the look that BENCHES", () => {
  it("offers only the Pokémon in the window and benches the picks", () => {
    let state = ready(1, ["fix-basic-1"]);
    // A mixed window: 3 Pokémon over 5 non-Pokémon, so a build that dropped the
    // filter would offer eight rows here instead of three.
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-duskull", 3);
    const window8 = state.players.p1.deck.slice(0, 8);
    const parked = attack(state, SUMMONING_GATE).state;

    expect(offered(parked)).toEqual(["fix-duskull", "fix-duskull", "fix-duskull"]);
    expect(cardsPrompt(parked).dest).toBe("bench");
    expect(cardsPrompt(parked).min).toBe(0); // the printed "You may"
    expect(cardsPrompt(parked).note).toContain("onto your Bench");

    const picks = window8.filter((uid) => state.cardIdByUid[uid] === "fix-duskull").slice(0, 2);
    const { state: done, events } = resolveCards(parked, picks);
    expect(done.phase.kind).toBe("turn:action");
    // The picks are IN PLAY, not in hand — the whole point of the new `dest`.
    expect(done.players.p1.bench.map((p) => done.cardIdByUid[p.stack[0] as string])).toEqual([
      "fix-basic-1",
      "fix-duskull",
      "fix-duskull",
    ]);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "bench",
      uids: picks,
    });
    expect(types(events)).toContain("SHUFFLE"); // the printed leftovers clause
  });

  it("CLAMPS to the remaining Bench space — the set removed from the deck is the set that lands", () => {
    // 🛑 The card-destruction shape `searchMove` was written against: four
    // eligible Pokémon in the window, ONE free Bench slot. A build that sliced
    // AFTER removing from the deck would strand three cards in neither zone.
    let state = ready(2, ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"]);
    state = toDeckTop(state, "p1", "fix-duskull", 4);
    const window8 = state.players.p1.deck.slice(0, 8);
    const picks = window8.filter((uid) => state.cardIdByUid[uid] === "fix-duskull");
    expect(picks).toHaveLength(4);

    const parked = attack(state, SUMMONING_GATE).state;
    const { state: done } = resolveCards(parked, picks);
    expect(done.players.p1.bench).toHaveLength(5); // §4's cap
    // Exactly ONE left the deck; the other three are still in it. Card
    // conservation, asserted card by card rather than by a total.
    const landed = picks.filter((uid) => !done.players.p1.deck.includes(uid));
    expect(landed).toHaveLength(1);
    for (const uid of picks) {
      const inDeck = done.players.p1.deck.includes(uid);
      const inPlay = done.players.p1.bench.some((p) => p.stack.includes(uid));
      expect(inDeck !== inPlay, uid).toBe(true); // in exactly one zone
    }
  });

  it("a window with no Pokémon never parks — but STILL announces the look", () => {
    let state = ready(3, ["fix-basic-1"]);
    state = toDeckTop(state, "p1", "fix-energy", 8);
    const { state: after, events } = attack(state, SUMMONING_GATE);
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "bench",
      uids: [],
    });
    expect(types(events)).toContain("SHUFFLE");
  });
});

describe("Larimar Rain — the look that ATTACHES (attachFromTop, an op since M5)", () => {
  it("offers Basic AND Special Energy from the top 20, and attaches where told", () => {
    let state = ready(4);
    // `anyEnergy`, never `basicEnergy`: a Special sits in the window beside a
    // Basic and a non-Energy, so all three readings are distinguishable here.
    state = toDeckTop(state, "p1", "fix-basic-1", 2);
    state = toDeckTop(state, "p1", "fix-special", 1);
    state = toDeckTop(state, "p1", "fix-energy", 1);
    const basic = state.players.p1.deck[0] as string;
    const special = state.players.p1.deck[1] as string;

    const parked = attack(state, LARIMAR_RAIN).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error(`expected an attachCards park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.candidates).toContain(basic);
    expect(parked.phase.prompt.candidates).toContain(special);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: basic, to: activeRef },
          { uid: special, to: activeRef },
        ],
      },
    });
    // One {C} was attached for the cost; these two land on top of it.
    expect(done.players.p1.active?.energy).toContain(basic);
    expect(done.players.p1.active?.energy).toContain(special);
    expect(types(events)).toContain("SHUFFLE"); // "Shuffle the other cards back"
    // ⚠️ NOT `discardRest`: the printed leftovers clause here is a SHUFFLE, and
    // Hydreigon's discard is the op's other printing. A build that shared one
    // field would have emptied 18 cards into the pile.
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
  });
});

describe("Dig It Up — the look that DISCARDS, and the decline that used to be silent", () => {
  it("puts the top card in the discard pile when taken", () => {
    let state = ready(5);
    state = toDeckTop(state, "p1", "fix-duskull", 1);
    const top = state.players.p1.deck[0] as string;
    const pileBefore = [...state.players.p1.discard];

    const parked = attack(state, DIG_IT_UP).state;
    expect(offered(parked)).toEqual(["fix-duskull"]); // `anyCard` — the window is one
    expect(cardsPrompt(parked).dest).toBe("discard");

    const { state: done, events } = resolveCards(parked, [top]);
    expect(done.players.p1.discard).toEqual([...pileBefore, top]);
    expect(done.players.p1.deck).not.toContain(top);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "discard",
      uids: [top],
    });
    // No trailing shuffle — the sentence prints none, and the deck order below
    // the looked-at card is exactly what it was.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("🛑 THE DECLINE IS ANNOUNCED — the fidelity fix, at the printing that needs it", () => {
    let state = ready(6);
    state = toDeckTop(state, "p1", "fix-duskull", 1);
    const top = state.players.p1.deck[0] as string;

    const parked = attack(state, DIG_IT_UP).state;
    const { state: done, events } = resolveCards(parked, []); // the printed "you may", declined

    expect(done.players.p1.deck[0]).toBe(top); // the card stayed, and stayed ON TOP
    // …and the opponent is told the look happened. Before D241 this emitted
    // NOTHING: the controller learned their top card for free and the log was
    // silent about it.
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "discard",
      uids: [],
    });
  });

  it("`anyCard` means ANY card — an Energy on top is offered exactly as a Pokémon is", () => {
    // The printed sentence names no noun ("that card"), so a build that guessed a
    // Pokémon filter would refuse the commonest top card in any deck.
    let state = ready(7);
    state = toDeckTop(state, "p1", "fix-energy", 1);
    expect(offered(attack(state, DIG_IT_UP).state)).toEqual(["fix-energy"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LOG — the channel the debt was actually about
// ─────────────────────────────────────────────────────────────────────────────

describe("log.ts — the row says WHERE, and says the empty look out loud", () => {
  const state = board(8);
  const uid = state.players.p1.deck[0] as string;
  const render = (event: GameEvent): string =>
    logFromEvents([event], { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:09" })
      .map((entry) =>
        entry.kind === "turn"
          ? `— turn ${entry.turn} —`
          : entry.segments.map((s) => s.text).join(""),
      )
      .join(" | ");

  it("distinguishes the three destinations rather than asserting 'in hand'", () => {
    // 🛑 D237's defect one op over, caught before it shipped: the arm used to
    // hard-code "in hand", so a benched look would have announced a card put in
    // hand and a discarded one the same.
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [uid] })).toContain("in hand");
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", dest: "bench", uids: [uid] })).toContain(
      "onto their Bench",
    );
    expect(
      render({ type: "DECK_TOP_REVEALED", seat: "p1", dest: "discard", uids: [uid] }),
    ).toContain("in the discard pile");
  });

  it("renders the EMPTY look — the row that did not exist before D241", () => {
    const text = render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [] });
    expect(text).toContain("looked at the top of their deck");
    expect(text).toContain("took nothing");
    // …and it names NOTHING, on either side of the `reveal` rider: a printed
    // reveal that took nothing revealed nothing, so the two renders are the same
    // sentence and the identity of the window never crosses.
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [], reveal: true })).toBe(text);
  });

  it("the reveal rider still names the cards, and now says where they went", () => {
    const text = render({
      type: "DECK_TOP_REVEALED",
      seat: "p1",
      dest: "bench",
      uids: [uid],
      reveal: true,
    });
    expect(text).toContain("revealed");
    expect(text).toContain("onto their Bench");
  });
});
