import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programPlayable } from "./cardplay";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  expectErr,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.128.0 → 0.129.0 — D202, THE PRODUCER. Slice 2 of 2 of D186.
//
// D186 built the FOURTH GATE and deliberately shipped nothing that could open
// it: the `optional {note, then}` op, the `confirm` prompt kind, the choice kind,
// the wire check, the redact arm, the projection arm and BOTH dialogs — with no
// deriver anchor and no registry row. The missing producer WAS the safety
// property: a park of a prompt kind a surface cannot render is a soft-lock
// (`effect:choose` swallows Escape, offers no decline, cannot advance), so the
// surfaces answered the question before anything could ask it. Both can now
// (D201 also gave the online router its `never` floor). This file is the asking.
//
// TWO REGEXES AND TWO ARMS. No op, no prompt, no choice kind, no event, no error
// code, no park machinery, no dialog, no `apps/api` diff, no `@luminous/schema`
// diff. The two inner ops (`drawCards`, `drawUntilHandSize`) have run since M4
// and have been read off their UNWRAPPED sentences since D181; what was missing
// was a reader for the four printed words in front of them.
//
// ── THE CENSUS, RE-DERIVED ───────────────────────────────────────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1`), swept 2026-08-04 over
// `json_each(attacks_json)` + `json_extract(value,'$.effect')`. BOTH of D186's
// figures held EXACT — 10 and 2, all twelve Standard-legal:
//
//   "You may draw cards until you have 6 cards in your hand."  10 / 10 legal
//     Blissey ex sv06-134, sv06-201 ("Return", 180) · Lumineon sv07-036
//     ("Return", 20) · Cynthia's Garchomp ex sv10-104, -215, -232, -241 and
//     svp-204 ("Corkscrew Dive", 100) · Audino sv10.5b-074, -151 ("Return", 30)
//   "You may draw 5 cards."                                     2 /  2 legal
//     Cyclizar ex sv08-159, sv08-228 ("Zircon Road", 180)
//
// ⚠️ THE SWEEP WAS RUN CASE-SENSITIVELY AND THEN DELIBERATELY RUN AGAIN THE
// WRONG WAY. `GLOB '*[Yy]ou may draw*'` (case-sensitive) and
// `LIKE '%you may draw%'` (SQLite's `LIKE` is ASCII case-INSENSITIVE, the verb
// that cost D200 a census — 95 rows reported where the truth was 6) return THE
// SAME TWO ROWS. So no case variant of either sentence exists in the catalog, and
// that is a measurement rather than an assumption. Both sentences are pure ASCII
// (verified by `hex()` on the D1 rows): no apostrophe, no `é`, no U+2019 — so no
// character class and no fold is owed on either anchor, unlike the gust family.
//
// ⚠️ AND THE SWEEP'S NEGATIVE RESULT IS THE OTHER HALF OF THE WARRANT: those two
// ARE the whole "you may draw" attack column. There is no third sentence, no
// trailing-clause variant, and no "You may draw a card." singular — so the
// singular alternation `ATTACK_DRAW` carries (`(?:(\d+) cards|a card)`) is
// deliberately NOT copied onto the wrapper, because it would be a branch no
// printing can reach. `NEAR_MISSES` below is the surrounding real population.
//
// ── WHAT THE PLAYER READS ────────────────────────────────────────────────────
// The `note` is the MATCHED STRING — `effect`, the whole thing the `^…$` anchor
// just consumed — not a rebuilt template. Both HUDs render the note as the
// dialog's ONLY prose (`<h2>{prompt.note}</h2>` above a Yes and a No; the "You
// may" on `HudDialog`/`Dialog` is an `aria-label`, not visible text), so the
// printed sentence IS the question. Two consequences, both asserted below: the
// note is byte-identical to the catalog string by construction rather than by
// care, and this slice invents no wording for any card.
//
// ── ⚠️ THE DECLINE IS THE HALF THAT CAN BE SILENTLY WRONG ────────────────────
// A build that spliced unconditionally, or read the boolean backwards, passes
// every accept assertion in this file and every one in `optionalConfirm.test.ts`.
// And on the ATTACK path there is a second, sharper failure available that the
// hand-built suite cannot see: an attack is USED whether or not its optional
// rider fires, so a decline that dropped the queued `attackEpilogue` would end
// the game's turn nowhere — no §8.1 Knock Out sweep, no §5.3 turn end, a live
// board stuck on P1's turn with the damage already dealt. Every accept case here
// therefore has a decline twin, and the decline twins check the turn, the KO and
// the deck as hard as they check the hand.

/** The two sentences, with the op each wraps and the LEGAL printing count
    re-measured for this slice. Both populations that matter are the same here —
    every printing of both sentences is Standard-legal — which is why this table
    carries one count where `derivedDrawAndGust.test.ts` carries two. */
const CLAUSES = [
  {
    text: "You may draw cards until you have 6 cards in your hand.",
    bare: "Draw cards until you have 6 cards in your hand.",
    inner: { op: "drawUntilHandSize", size: 6 } as EffectOp,
    legalPrintings: 10,
  },
  {
    text: "You may draw 5 cards.",
    bare: "Draw 5 cards.",
    inner: { op: "drawCards", count: 5 } as EffectOp,
    legalPrintings: 2,
  },
] as const;

const UNTIL = 0;
const FIVE = 1;

/** The wrapped program a sentence must derive to. Built from the row rather than
    re-typed, so the table is the single statement of what each anchor owes. */
function wrapped(text: string, inner: EffectOp): EffectOp[] {
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-op list, not a thenable (arrays are not callable).
  return [{ op: "optional", note: text, then: [inner] }];
}

/** REAL rows from the same sweep that an over-wide anchor would eat, plus the two
    BARE forms these anchors must leave exactly where D181 put them. Every entry
    is a printed sentence from the remote D1's attack column (the counts are legal
    printings), kept as data because each is a live witness rather than an
    illustration. */
const NEAR_MISSES = [
  // ── The draw-until family, with something else in the sentence. ──
  /** The variable-size draw-until (Bronzor sv03-144 "Mirror Draw"). The count is
      not a number, so `(\d+)` refuses it — and it is a real future slice. Already
      a near-miss for the BARE anchor since D181; it is one for the wrapper too,
      and a build that made the count optional would take both. */
  "Draw cards until you have the same number of cards in your hand as your opponent.",
  /** A COMPOUND whose FIRST clause is a printed "You may …" and whose second is
      the bare draw-until — the exact shape a `^`-only build (no `$`) reads as its
      first clause and silently drops the rest of. It is also the one real
      sentence in the catalog that would make a greedy wrapper wrap the WRONG
      inner op. */
  "You may discard any number of cards from your hand until you have 4 or fewer. Draw cards until you have 5 cards in your hand.",
  // ── The plain-draw family, with something else in the sentence. ──
  /** A draw from the WRONG END of the deck (1 legal). `drawCards` takes from the
      top; this is `deckBottom`'s dimension. */
  "Draw 3 cards from the bottom of your deck.",
  /** ⚠️ 🆕🆕 **D473 — THE FOURTH ROW TO LEAVE `NEAR_MISSES`, AND ITS OLD NOTE WAS
      A CORRECT DESCRIPTION OF A BUILDABLE SENTENCE.** It read: *"A cost-gated draw
      (2 legal across two counts) — an 'If you do' consequent, not a 'you may'
      wrapper, and its condition is a discard rather than an answer."* Every clause
      of that is true and NONE of it is a blocker: the "If you do" is §9.2's
      `recordGate` (shipped D148), the discard is `payFromHand` (shipped), and the
      "2 legal across two counts" is D121's warrant for a captured `(\d+)` rather
      than an argument against one. It sat here for the whole run.

      🛑 **RE-POINTED, NOT DROPPED, AND ONTO A SHAPE RATHER THAN ONTO "IT DERIVES"**
      (D418's second half, D438's polarity rule) — see `BUILT_AT_D473` below. What
      this file owns about the sentence is that it is a GATE and not a WRAPPER, so
      that is what the replacement rung asserts, in both directions. */
  /** A draw for BOTH seats (1 legal). The printed subject is not "you". */
  "Each player draws 3 cards.",
  /** A "You may put …" whose consequent contains a draw, and whose "if you don't"
      branch is the one that draws — the inverted shape, and the only printing in
      the catalog where a decline does MORE than an accept. */
  "Look at the top card of your deck. You may put that card into your hand. If you don't, discard that card and draw a card.",
] as const;

/** ⚠️ 🆕🆕 **D422 — THE THIRD ROW TO LEAVE `NEAR_MISSES`, AND ITS OLD NOTE HAD BEEN
    NAMING ITS OWN EXPIRY CONDITION FOR ~195 DECISIONS.**

    It sat in the list above reading: *"D186's own remaining pin, and D189's: the
    self-switch behind the same wrapper (3 legal printings). **The MECHANISM now has
    a producer, so the reason this stays null has changed** — it is no longer 'there
    is no wrapper', it is 'this slice wrote two anchors and not a third'."*

    🛑 **THAT NOTE WAS CORRECT, IT WAS WRITTEN DOWN, AND NOTHING ACTED ON IT** —
    while `effects.ts` and `derivedDrawAndGust.test.ts` went on quoting a price
    (a new `declinable` prompt key + a decline answer + a `MATCH_RECORD_VERSION`
    bump) that this very row says is not the price. The true cost was ONE anchor and
    ONE arm. conventions.md's D413 rule in its sharpest form: *a refusal carries its
    own expiry date if it says what it is waiting for* — here the trigger had not
    merely fired, **a neighbouring slice had fired it and left a note saying so**.

    ⚠️ **THE ROW IS RE-POINTED, NOT DROPPED, AND ONTO A SHAPE RATHER THAN ONTO
    "IT DERIVES" (D418's second half).** A rung asserting only that the sentence now
    derives would be TRUE under the wrong-arm mutant — an anchor that returned the
    bare `switchActive` with the wrapper forgotten. What this file owns about the
    sentence is that it wraps through the SAME gate the two draw rows use, so that
    is what is asserted, built with `wrapped` rather than hand-copied. */
const BUILT_AT_D422 = "You may switch this Pokémon with 1 of your Benched Pokémon.";

/** ⚠️ D227 — THE ROW THAT LEFT THIS LIST BY BEING BUILT, AND IT IS THE FIRST
    THIRD-PARTY PRODUCER OF THE `optional` WRAPPER THIS FILE OWNS.
 *
 *  It sat in `NEAR_MISSES` above with the note *"an op the engine does not have at
 *  all"*, which was the truth and is now not. D227 added `opponentSwitchOut` and
 *  the wrapper reached it in ONE line — no change to `optional`, no change to the
 *  two draw anchors, no change to the confirm prompt. That is the whole claim
 *  D186 made for building the gate before it had a second body to wrap, so it is
 *  asserted here rather than in the new suite alone.
 *
 *  ⚠️ AND IT IS ALSO THE FIRST WRAP WHOSE INNER OP PARKS FOR THE **OTHER SEAT**,
 *  which is a genuinely new sequencing this file's two draw rows cannot exercise:
 *  the controller answers the `confirm`, and the opponent then answers the
 *  `choosePokemon` behind it. The ORDER is driven in
 *  `derivedOpponentSwitchOut.test.ts`; what belongs here is that the WRAPPER is
 *  unchanged and its shape is the same one the draws get. */
const WRAPPED_ELSEWHERE =
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";

/** ⚠️ 🆕🆕 **D404 — THE SECOND ROW TO LEAVE `NEAR_MISSES` BY BEING BUILT, AND IT LEFT
    THROUGH A DIFFERENT DOOR FROM D227's.**
 *
 *  It sat in the list above with the note *"Discard-then-draw (7 legal printings).
 *  Contains \"draw 6 cards.\" verbatim and is not a \"you may\" at all: the discard is
 *  mandatory"* — and the whole point of the entry was that the ANCHORS here must not
 *  eat it. They still must not, and that claim is now WORTH MORE rather than less: the
 *  sentence derives, so a rung asserting `null` would be the wrong assertion, while a
 *  rung asserting it derives to the WRAPPED shape would be flatly false.
 *
 *  🛑 **THE THING THIS FILE OWNS ABOUT IT IS THAT IT IS *NOT* WRAPPED.** D404's arm is a
 *  bare two-op program with no `optional` in front of it, because the printed sentence
 *  carries no offer. An anchor here that had grown an optional `(?:You may )?` group —
 *  the single-regex arrangement this file's own doc block argues against — would have
 *  had no way to tell this sentence's mandatory discard from a wrapped draw. So the
 *  entry is re-pointed rather than dropped: the assertion is that the program is the
 *  INNER shape and never the gated one.
 *
 *  ⚠️ AND IT IS STILL A NEAR-MISS FOR THE `^…$` CLAIM, which is why the trailing-clause
 *  case below still builds a witness out of it. */
const BUILT_AT_D404 = "Discard your hand and draw 6 cards.";

/** ⚠️ 🆕🆕 **D473 — THE FOURTH ROW TO LEAVE `NEAR_MISSES`, THROUGH THE SAME DOOR AS
    D404's AND FOR THE SHARPEST REASON YET.**
 *
 *  Its old note (kept verbatim in the list above) said the sentence is *"an 'If you
 *  do' consequent, not a 'you may' wrapper, and its condition is a discard rather
 *  than an answer."* That is a correct and complete description of the mechanism —
 *  and the mechanism has shipped the whole time. `recordGate` IS the printed *"If
 *  you do"* (§9.2, D148), `payFromHand` IS the discard, and D473's arm is those two
 *  plus a `drawCards` in printed order.
 *
 *  🛑 **WHAT THIS FILE OWNS ABOUT IT IS THE GATE/WRAPPER DISTINCTION, AND THAT IS
 *  WHAT IS ASSERTED — IN BOTH DIRECTIONS.** A rung saying only *"it derives now"*
 *  would be true under a build that wrapped it in `optional` instead, which is
 *  precisely the confusion this file exists to prevent: an `optional` gate asks the
 *  CONTROLLER a question, a `recordGate` asks the BOARD what an earlier op did, and
 *  on an empty hand the two give opposite answers (the wrapper would still offer the
 *  draw). So the replacement rung pins the `recordGate` shape by value, pins that no
 *  `optional` appears anywhere in the program, and keeps the refusal of the WRAPPED
 *  spelling that nobody prints.
 *
 *  ⚠️ TWO SENTENCES, ONE ANCHOR — the count is captured, so the sibling at `draw 3
 *  cards` is asserted beside it and the two must differ ONLY in that number. */
const BUILT_AT_D473 = "Discard a card from your hand. If you do, draw 2 cards.";
const BUILT_AT_D473_SIBLING = "Discard a card from your hand. If you do, draw 3 cards.";

describe("the two anchors — 12 legal printings, and the four words in front of the op", () => {
  it("derives each printed sentence to the WRAPPED program", () => {
    for (const { text, inner } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(wrapped(text, inner));
    }
  });

  it("adds up: 12 legal printings across 2 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one anchor would still pass every case above.
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(12);
    expect(CLAUSES[UNTIL].legalPrintings).toBe(10);
    expect(CLAUSES[FIVE].legalPrintings).toBe(2);
  });

  it("puts the WRAPPED program's `then` byte-identical to the BARE anchor's whole program", () => {
    // The family's checkable claim (D134's shape, D181's wording): there is ONE
    // action here, printed twice, and the "you may" is a gate in front of it.
    // Read the gate apart rather than re-typing the inner op, so a copy-paste
    // cannot pass it — and note this is the property a single shared regex with
    // an optional `(?:You may )?` group would have bought by construction. Four
    // separate whole-string anchors buy it by test instead, which is the trade
    // the anchors' block in effects.ts argues for (the printed `d` is lowercase
    // in one spelling and capital in the other).
    for (const { text, bare } of CLAUSES) {
      const gated = deriveAttackEffect(text);
      expect(gated, text).toHaveLength(1);
      const gate = gated?.[0];
      expect(gate?.op).toBe("optional");
      expect(gate?.op === "optional" ? gate.then : undefined).toEqual(deriveAttackEffect(bare));
    }
  });

  it("carries the printed sentence VERBATIM as the note — the string the player reads", () => {
    // The note is what both dialogs render as their only prose, so the assertion
    // is byte equality with the catalog string and not merely "a non-empty
    // note". A mutant that rebuilds the sentence from the captured number
    // (`You may draw ${n} cards.`) passes the first one and dies on the second,
    // which is why both are here rather than one.
    for (const { text } of CLAUSES) {
      const gate = deriveAttackEffect(text)?.[0];
      const note = gate?.op === "optional" ? gate.note : "";
      expect(note).toBe(text);
      // Pure ASCII, measured on the D1 rows with `hex()` before this line was
      // written: no apostrophe, no `é`, no U+2019. So neither anchor carries a
      // character class, and `clauseApostrophe.test.ts`'s census cannot move for
      // these two sentences no matter what fixtures print them.
      expect(/^[\x20-\x7e]+$/.test(note)).toBe(true);
      expect(note).not.toContain("'");
      expect(note).not.toContain("’");
    }
  });

  it("is PARAMETERISED on the count, unlike the two self-switch anchors", () => {
    // The opposite call from `ATTACK_SELF_SWITCH`'s literal `1 of`, and for that
    // anchor's reason in reverse: there a printed 2 would be a different OP (a
    // single-pick park cannot take two), here the number is the inner op's own
    // parameter and the Trainer path already prints others through the same ops.
    for (const n of [1, 2, 3, 6, 7]) {
      expect(deriveAttackEffect(`You may draw ${n} cards.`)).toEqual(
        wrapped(`You may draw ${n} cards.`, { op: "drawCards", count: n }),
      );
      expect(deriveAttackEffect(`You may draw cards until you have ${n} cards in your hand.`)).toEqual(
        wrapped(`You may draw cards until you have ${n} cards in your hand.`, {
          op: "drawUntilHandSize",
          size: n,
        }),
      );
    }
  });

  it("refuses a printed ZERO on both arms — the bare arms' guard, and it bites harder here", () => {
    // Unwrapped, a "Draw 0 cards." would file an effect that moves nothing.
    // WRAPPED, it would do something worse: park a real decision, take the
    // player's answer, and leave the identical board on both branches — exactly
    // the prompt the M1 no-choice rule exists to refuse. `drawUntilHandSize 0` is
    // worse still (the op NEVER TRIMS, so it is a no-op by construction).
    expect(deriveAttackEffect("You may draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("You may draw cards until you have 0 cards in your hand.")).toBeNull();
    // …and the bare forms agree, which is the point: the wrapper inherits the
    // guard rather than re-deciding it.
    expect(deriveAttackEffect("Draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Draw cards until you have 0 cards in your hand.")).toBeNull();
  });

  it("has NO ceiling on either count — the ops clamp against the deck", () => {
    // Matching every other arm of this reader: §14.3 deck-out is a turn-START
    // rule, so a malformed large count empties a deck and stops, which is a legal
    // board state. A ceiling here would be a rule this engine does not have.
    expect(deriveAttackEffect("You may draw 999 cards.")).toEqual(
      wrapped("You may draw 999 cards.", { op: "drawCards", count: 999 }),
    );
    expect(deriveAttackEffect("You may draw cards until you have 60 cards in your hand.")).toEqual(
      wrapped("You may draw cards until you have 60 cards in your hand.", {
        op: "drawUntilHandSize",
        size: 60,
      }),
    );
  });

  it("the two anchors are DISJOINT — neither reaches the other's sentence", () => {
    // "You may draw 5 cards." has a digit where "You may draw cards until …" has
    // the word `cards`, so neither pattern can reach the other's string. Stated
    // because a widened `(\d+)?` on either would silently make one of them dead
    // code, and the file's other cases would not notice.
    const untilProgram = deriveAttackEffect(CLAUSES[UNTIL].text)?.[0];
    const fiveProgram = deriveAttackEffect(CLAUSES[FIVE].text)?.[0];
    expect(untilProgram?.op === "optional" ? untilProgram.then : undefined).toEqual([
      { op: "drawUntilHandSize", size: 6 },
    ]);
    expect(fiveProgram?.op === "optional" ? fiveProgram.then : undefined).toEqual([
      { op: "drawCards", count: 5 },
    ]);
  });
});

describe("the near-misses — the population an over-wide anchor eats", () => {
  it("refuses every real sentence that CONTAINS a clause and means something else", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🆕🆕 D404's row is BUILT and deliberately NOT wrapped", () => {
    // See BUILT_AT_D404's block. The sentence prints no offer, so its program is the
    // two ops bare — and this file's claim about it has become the SHAPE rather than
    // the refusal. A shared anchor with an optional "You may " group would pass every
    // accept case in this file and could not express this at all.
    const built = deriveAttackEffect(BUILT_AT_D404);
    expect(built).toEqual([{ op: "discardHand" }, { op: "drawCards", count: 6 }]);
    expect(built?.some((op) => op.op === "optional")).toBe(false);
    // …and the WRAPPED spelling of it is nobody's sentence, so the anchors here must
    // still refuse it — which is the original entry's claim, kept.
    expect(deriveAttackEffect("You may discard your hand and draw 6 cards.")).toBeNull();
  });

  it("🆕🆕 D473's pair is BUILT as a §9.2 GATE and never as a `you may` WRAPPER", () => {
    // See BUILT_AT_D473's block. The replacement for the `toBeNull` this row used to
    // carry, and it is strictly stronger: it names the owner BY VALUE and keeps the
    // refusal the old rung supplied (D438 — re-point a negative by naming what now
    // owns it and keeping the refusals, never by flipping it to `.not.toBeNull()`).
    for (const [text, count] of [
      [BUILT_AT_D473, 2],
      [BUILT_AT_D473_SIBLING, 3],
    ] as const) {
      const built = deriveAttackEffect(text);
      expect(built, text).toEqual([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count }] },
      ]);
      // 🛑 THE HALF THE OLD `toBeNull` WAS REALLY ABOUT: no `optional` anywhere. A
      // wrapper would offer the draw on an EMPTY hand, where the printed sentence
      // gives nothing, so this is a behavioural claim and not a shape preference.
      const hasOptional = (value: unknown): boolean =>
        Array.isArray(value)
          ? value.some(hasOptional)
          : typeof value === "object" && value !== null
            ? (value as Record<string, unknown>).op === "optional" ||
              Object.values(value as Record<string, unknown>).some(hasOptional)
            : false;
      expect(hasOptional(built), text).toBe(false);
      // …and the WRAPPED spelling is nobody's sentence, so the anchors here must
      // still refuse it — the original entry's claim, kept.
      expect(deriveAttackEffect(`You may ${text.charAt(0).toLowerCase()}${text.slice(1)}`)).toBeNull();
    }
  });

  it("D227's third producer wraps through the SAME gate, byte for byte", () => {
    // See WRAPPED_ELSEWHERE's block. The assertion is deliberately built with
    // `wrapped` — the helper the two draw rows are asserted with — so "the same
    // shape" is a shared construction rather than a hand-copied literal that could
    // drift from what this file's own cases mean by it.
    expect(deriveAttackEffect(WRAPPED_ELSEWHERE)).toEqual(
      wrapped(WRAPPED_ELSEWHERE, { op: "opponentSwitchOut" }),
    );
    // …and the wrapper is the ONLY thing the prefix adds: the bare sentence is the
    // same string minus "You may " and a capital, and it derives to the inner op
    // ALONE. A shared anchor with an optional `(?:You may )?` group would pass the
    // line above and fail this one — the same pair the two draw families carry.
    const bare = "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
    expect(WRAPPED_ELSEWHERE).toBe(`You may s${bare.slice(1)}`);
    expect(deriveAttackEffect(bare)).toEqual([{ op: "opponentSwitchOut" }]);
  });

  it("🆕🆕 D422's row is BUILT, and it wraps through the SAME gate as the draws", () => {
    // See BUILT_AT_D422's block. Built with `wrapped` — the helper the two draw
    // rows and D227's row are asserted with — so "the same shape" is a shared
    // construction rather than a hand-copied literal that could drift from what
    // this file's own cases mean by it. This is now the gate's FOURTH producer.
    expect(deriveAttackEffect(BUILT_AT_D422)).toEqual(
      wrapped(BUILT_AT_D422, { op: "switchActive" }),
    );
    // …and the wrapper is the ONLY thing the prefix adds: the bare sentence is the
    // same string minus "You may " and a capital, and it derives to the inner op
    // ALONE. A shared anchor with an optional `(?:You may )?` group would pass the
    // line above and fail this one.
    const bare = "Switch this Pokémon with 1 of your Benched Pokémon.";
    expect(BUILT_AT_D422).toBe(`You may s${bare.slice(1)}`);
    expect(deriveAttackEffect(bare)).toEqual([{ op: "switchActive" }]);
    // 🛑 AND THE `optional` OP ITSELF IS UNTOUCHED BY THE FOURTH PRODUCER, which is
    // the claim D186 made when it built the gate before it had a second body to
    // wrap — asserted here rather than in the new suite alone, exactly as D227's
    // row is. Four producers, one shape.
    const four = [CLAUSES[UNTIL].text, CLAUSES[FIVE].text, WRAPPED_ELSEWHERE, BUILT_AT_D422];
    for (const text of four) {
      const program = deriveAttackEffect(text);
      expect(program, text).toHaveLength(1);
      const gate = program?.[0];
      expect(gate?.op, text).toBe("optional");
      // No `otherwise` on any of the four: a decline buys NOTHING on all of them,
      // which is what makes D316's arm still unreached from this file.
      expect(gate?.op === "optional" ? gate.otherwise : "unset", text).toBeUndefined();
      expect(gate?.op === "optional" ? gate.note : undefined, text).toBe(text);
    }
  });

  it("leaves the BARE forms on their existing (D181) path, UNWRAPPED", () => {
    // The sharpest near-miss pair in the slice, and the one a `toBeNull` could
    // not express: these two sentences DO derive, and they must derive to the
    // inner op with NO gate. A single shared anchor with an optional "You may "
    // group passes every accept case in this file and fails exactly here — and
    // in production it would park a question on a card that prints no question,
    // which is a soft-lock-shaped defect on the mandatory side.
    for (const { bare, inner } of CLAUSES) {
      expect(deriveAttackEffect(bare), bare).toEqual([inner]);
    }
    // …and so do the counts the catalog actually prints bare, which the wrapper
    // must not have disturbed.
    expect(deriveAttackEffect("Draw a card.")).toEqual([{ op: "drawCards", count: 1 }]);
    expect(deriveAttackEffect("Draw 2 cards.")).toEqual([{ op: "drawCards", count: 2 }]);
    expect(deriveAttackEffect("Draw cards until you have 7 cards in your hand.")).toEqual([
      { op: "drawUntilHandSize", size: 7 },
    ]);
  });

  it("refuses the anchors' own sentences with ANY text added on either side", () => {
    // The `^…$` claim, driven the way D52's review taught this repo to drive it:
    // dropping `^`, `$` or BOTH must fail something. ⚠️ AND THE LEADING HALF IS
    // CONSTRUCTED RATHER THAN QUOTED, WHICH IS WORTH SAYING. `NEAR_MISSES` above
    // is entirely real printed text, and every one of its entries carries its
    // clause at the START — because the catalog holds NO sentence with either of
    // these two anchors at the END (the sweep's negative result: the two printings
    // ARE the whole "you may draw" column, and both are the whole sentence). So
    // the two TRAILING witnesses below are built by bolting a real first clause
    // (Confounding Cologne's, and the printed compound's) in front of the real
    // anchor, with its capital `Y` intact. Measured, then: dropping `^` alone
    // survived the first mutant round on this file, and these are the cases
    // written to kill it — a lowercased variant does not, because the readers'
    // case commitment refuses it for a DIFFERENT reason and would leave the
    // anchoring claim passing for the wrong cause.
    for (const { text } of CLAUSES) {
      expect(
        deriveAttackEffect(`${text} This attack does 30 damage to the new Active Pokémon.`),
      ).toBeNull();
      expect(
        deriveAttackEffect(`Your opponent's Active Pokémon is now Confused. ${text}`),
      ).toBeNull();
      expect(
        deriveAttackEffect(
          `Discard your hand. ${text} Then, shuffle your deck.`,
        ),
      ).toBeNull();
      // Case is load-bearing too: the readers commit to it (no `/i` anywhere in
      // this reader), so the lowercase spelling of a sentence is not the
      // sentence.
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(text.toUpperCase())).toBeNull();
    }
    // The trailing period is required — the failure mode this repo names first,
    // because a regex written from a paraphrase matches no real card.
    expect(deriveAttackEffect("You may draw 5 cards")).toBeNull();
    expect(deriveAttackEffect("You may draw cards until you have 6 cards in your hand")).toBeNull();
  });

  it("still accepts surrounding WHITESPACE — the reader's one documented tolerance", () => {
    // `deriveAttackEffect` trims before matching, and the trim is the ONLY
    // liberty it takes. The note is the TRIMMED string, which is the sentence.
    expect(deriveAttackEffect(`  ${CLAUSES[FIVE].text}\n`)).toEqual(
      wrapped(CLAUSES[FIVE].text, CLAUSES[FIVE].inner),
    );
  });
});

// ── The demonstrator pool. Synthetic `fix-*` bodies declared HERE and not in
//    `testFixtures.ts` — D190/D199/D200's idiom and their reason: a fixture id
//    naming a real printing must appear in `catalogManifest.ts`, which is
//    generated off the LOCAL sqlite (`SQLITE_CANTOPEN` in this clone) and
//    measures a 978-row / 6-set catalog holding no `sv06`, `sv07`, `sv08`,
//    `sv10` or `sv10.5b` row at all — i.e. NONE of the twelve printings. So the
//    ids stay `fix-*` (the manifest's generator and checker both skip them) and
//    `FIXTURE_POOL` is untouched, which is also why `clauseApostrophe.test.ts`'s
//    census cannot move: it enumerates `FIXTURE_POOL` attacks, and nothing was
//    added there. ──

/** Audino `sv10.5b-074` "Return", printed row: one {C}, 30 damage, the
    draw-until sentence. The cost is written colourless because the printed one
    already is; nothing this slice reads is on the cost. */
const RETURN_BODY: Card = battler("fix-may-return", {
  hp: 100,
  attacks: [
    { name: "Return", cost: ["Colorless"], damage: 30, effect: CLAUSES[UNTIL].text },
    // A second attack with NO effect at all, so "the derived program is on the
    // attack the player declared" is checkable rather than assumed.
    { name: "Tackle", cost: ["Colorless"], damage: 10 },
  ],
});

/** Cyclizar ex `sv08-159` "Zircon Road", printed row: 180 damage and the draw-5
    sentence. ⚠️ THE COST IS FLATTENED TO THREE {C} where the print is {G}{F}{P}:
    the demonstrator needs the attack to be PAYABLE out of this pool's Energy, and
    the cost is the one field of the printed row this slice does not read. Stated
    rather than silent, because a fixture that quietly diverges from a print is
    exactly what `catalogManifest.test.ts` exists to catch on the ids it can. */
const ZIRCON_BODY: Card = battler("fix-may-zircon", {
  hp: 210,
  attacks: [
    {
      name: "Zircon Road",
      cost: ["Colorless", "Colorless", "Colorless"],
      damage: 180,
      effect: CLAUSES[FIVE].text,
    },
  ],
});

/** The BARE control: the same attack, same damage, with the printed "You may"
    stripped. It must run its draw with NO question at all — the negative
    demonstrator for the whole slice, driven through the real engine rather than
    through the deriver alone. */
const BARE_BODY: Card = battler("fix-bare-return", {
  hp: 100,
  attacks: [{ name: "Bare Return", cost: ["Colorless"], damage: 30, effect: CLAUSES[UNTIL].bare }],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-may-return": RETURN_BODY,
  "fix-may-zircon": ZIRCON_BODY,
  "fix-bare-return": BARE_BODY,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-may-return": 4,
  "fix-may-zircon": 4,
  "fix-bare-return": 4,
  "fix-victim": 4, // 30 HP — OHKO'd by Zircon Road, so the epilogue's KO sweep runs
  "fix-bigbody": 8, // 200 HP — survives, so the plain turn-end tail runs
  "fix-basic-1": 4,
  "fix-energy": 32,
});

/** `driveSetup` against the LOCAL pool (D190/D199/D200's helper verbatim — the
    shared one closes over `FIXTURE_POOL`). */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1 to move on turn 3 (past §4's going-first restrictions), with `attackerId`
    Active over an EMPTY Bench, `defenderId` opposite, three Energy attached and
    P1's HAND EMPTIED INTO THEIR DECK — so every draw count in this file is exact
    rather than seed-dependent, `optionalConfirm.test.ts`'s arrangement. */
function matchup(seed: number, attackerId: string, defenderId: string): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", attackerId), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", defenderId), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  const side = state.players.p1;
  return {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
}

function hand(state: GameState): number {
  return state.players.p1.hand.length;
}

function deck(state: GameState): readonly string[] {
  return state.players.p1.deck;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** How many cards P1 drew BECAUSE OF AN EFFECT in this batch — `undefined` when
    the branch never drew at all, which is the distinction the decline cases turn
    on. Reads `reason` as well as `seat`, because every resolve that ends the turn
    is followed by P2's own `turnStart` draw in the SAME event batch: a bare
    `find(events, "CARDS_DRAWN")` would see that one and report a decline as a
    draw. (`CARDS_DRAWN` is count-only over `uids` — there is no `count` field.) */
function effectDrawn(events: GameEvent[]): number | undefined {
  const drawn = events.find(
    (e) => e.type === "CARDS_DRAWN" && e.seat === "p1" && e.reason === "effect",
  );
  return drawn?.type === "CARDS_DRAWN" ? drawn.uids.length : undefined;
}

describe("end to end — a printed card asks, and the answer is the effect", () => {
  it("the attack PARKS a confirm carrying the printed sentence, after the damage", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    // §8 printed order: the damage lands FIRST, then the effect asks.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The whole prompt: a kind and the printed sentence, byte for byte off the
    // card. No candidates (the decision IS the content), no `count`.
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[UNTIL].text });
    // The CONTROLLER answers — no `answerer` beside the seat, unlike the
    // `opponentMayDraw` family. A build that copied that park's `decider` would
    // put the printed "you" on the other player's screen.
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBeUndefined();
    expect(parked.phase.resumeTail).toBe(true);
    // The epilogue is QUEUED, not run: the turn has not ended and no card moved.
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        // 🆕 D394 — the stage also names the ATTACK, off the same row, for the same
        // reason: `finishAttack` stamps `usedAttack` and cannot re-derive the name.
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(hand(parked)).toBe(0);
  });

  it("YES draws to the printed size, THEN runs the epilogue and ends the turn", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });

    // Drew from 0 to the printed 6 — the number off the card, not a constant.
    expect(effectDrawn(events)).toBe(6);
    // …and then P2's turn opened with their own start-of-turn draw, which is why
    // the event list is read rather than the final hand.
    expect(types(events)).toEqual(["CARDS_DRAWN", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(done.players.p1.hand).toHaveLength(6);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("⚠️ NO draws NOTHING — and the attack is still USED, so the turn still ends", () => {
    // THE CASE THE WHOLE SLICE TURNS ON. A decline declines the BRANCH, never the
    // attack: the damage is already dealt, the epilogue is already queued, and
    // §5.3 owes a turn end regardless. A build that dropped the epilogue on the
    // decline leaves a live board on a turn that can never end.
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const before = { hand: hand(parked), deck: [...deck(parked)] };
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });

    // NOTHING was drawn: not the hand, and not the deck it would have come from.
    // The deck is compared ELEMENT BY ELEMENT rather than by length, because a
    // draw-and-put-back would keep the length and move the order.
    expect(hand(done)).toBe(before.hand);
    expect(hand(done)).toBe(0);
    expect(deck(done)).toEqual(before.deck);
    // The branch left no trace in the log — the only draw is P2's turn-start one.
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(effectDrawn(events)).toBeUndefined();
    expect(find(events, "CARDS_DRAWN")?.seat).toBe("p2");
    // …and the attack was USED: the turn ended, the queue drained, P2 is up.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The damage the attack already did is still on the board — a decline is not
    // an undo of the attack.
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("the DECLINE does not consume the attack's other effects — the KO sweep still runs", () => {
    // Zircon Road's 180 is lethal to a 30 HP body, so the §8.1 Knock Out sweep is
    // real work sitting BEHIND the park. It must survive both answers, and the
    // decline is the one that can lose it.
    const state = matchup(12, "fix-may-zircon", "fix-victim");
    const { state: parked, events: attackEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    // Lethally damaged but NOT yet Knocked Out — the sweep is in the epilogue.
    expect(types(attackEvents)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.active).not.toBeNull();
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[FIVE].text });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    // No draw, and the KO the DAMAGE caused resolved anyway.
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(hand(done)).toBe(0);
    expect(types(events)[0]).toBe("KNOCKED_OUT");
    expect(types(events)).toContain("PRIZES_OWED");
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("the ACCEPT twin of the KO case — draw first, then the same sweep", () => {
    const state = matchup(12, "fix-may-zircon", "fix-victim");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    // The printed 5, off the card.
    expect(effectDrawn(events)).toBe(5);
    expect(hand(done)).toBe(5);
    // Draw, THEN the Knock Out — the spliced branch runs where the op sat, ahead
    // of the queued epilogue, not after it.
    expect(types(events).slice(0, 2)).toEqual(["CARDS_DRAWN", "KNOCKED_OUT"]);
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("the BARE printing on the same board asks NOTHING and draws immediately", () => {
    // The control. Same op, same size, same damage, same seat — and no park, no
    // prompt, no second action. This is what an over-wide anchor would break, and
    // it would break it INVISIBLY unless something drives the mandatory side.
    const state = matchup(11, "fix-bare-return", "fix-bigbody");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(effectDrawn(events)).toBe(6);
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("the SECOND attack on the same body carries no effect — the program follows the index", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("draws only up to the printed size — a hand already at 6 draws NOTHING on a YES", () => {
    // `drawUntilHandSize` NEVER TRIMS, so the accept branch on a full hand is a
    // legal no-op — and the question is STILL asked, because the M1 no-choice
    // rule retires a prompt whose answers are the same state and the engine may
    // not decide a printed "may" on the player's behalf by peeking at their hand.
    let state = matchup(13, "fix-may-return", "fix-bigbody");
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, hand: side.deck.slice(0, 6), deck: side.deck.slice(6) },
      },
    };
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm park");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(effectDrawn(events)).toBeUndefined();
    expect(hand(done)).toBe(6);
  });

  it("the attack is DECLARABLE — programPlayable does not descend into `then`", () => {
    // D186's third decided non-change, driven from the produced program rather
    // than a hand-built one: an `optional`'s branch is one of TWO printed
    // outcomes, so a card whose "you may" wraps a whiffable op still resolves.
    const state = matchup(13, "fix-may-return", "fix-bigbody");
    const program = deriveAttackEffect(CLAUSES[UNTIL].text) as EffectOp[];
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, deck: [] } },
    };
    expect(programPlayable(empty, program, "p1")).toBe(true);
  });
});

describe("the wire and the seat gate, on the DERIVED park", () => {
  function parked(): GameState {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    return mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
  }

  it("accepts a real boolean and REFUSES every truthy impostor", () => {
    const state = deepFreeze(parked());
    for (const yes of ["yes", 1, 0, null, undefined, {}] as const) {
      expectErr(
        state,
        {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "confirm", yes } as unknown as { kind: "confirm"; yes: boolean },
        },
        "BAD_EFFECT_CHOICE",
      );
    }
    // The other yes/no prompt's answer is not this one's — a `mayDraw` frame
    // aimed at a `confirm` park is refused rather than read as consent.
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "mayDraw", draw: true } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the OPPONENT cannot answer the controller's printed 'you may'", () => {
    expectErr(
      parked(),
      { type: "resolveEffect", seat: "p2", choice: { kind: "confirm", yes: true } },
      "WRONG_SEAT",
    );
  });

  it("redacts to the sentence alone, and reaches the ANSWERER only", () => {
    const state = parked();
    expect(redactGame(state, "p1").phase).toMatchObject({
      kind: "effect:choose",
      prompt: { kind: "confirm", note: CLAUSES[UNTIL].text },
    });
    const theirs = redactGame(state, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });

  it("MATCH_RECORD_VERSION stays 12 — and D186's SECOND leg has retired, so this is the check", () => {
    // ⚠️ DERIVED FRESHLY RATHER THAN INHERITED, because this slice is the first
    // that can actually CREATE an `optional` park and D186's argument had two
    // legs, one of which is now gone.
    //
    //   LEG 1, STILL STANDING: this slice adds no union inhabitant, no required
    //   field, no `GameState` field, no `EffectContinuation` shape, no prompt or
    //   choice kind, no event, no wire member and no `@luminous/schema` diff. It
    //   adds two REGEXES. What widened is which op values are REACHABLE from the
    //   deriver seam — D125's widening-not-a-missing-field distinction, and
    //   exactly the ground on which D181 derived four ops and stayed at 11 (see
    //   `apps/api/src/lobby/match.ts`, which states that precedent verbatim).
    //
    //   LEG 2, RETIRED: D186 also argued "no v12 build could construct an
    //   `optional` op, so no v12 record can be parked on one." That is FALSE from
    //   this commit onwards — a v12 record CAN now carry a `confirm` park. So the
    //   question has to be re-asked, and the answer is that D186's ordering is
    //   what makes it safe: the READER for this park shipped in v12 ALREADY, in
    //   the same version as the op. Every v12 build — including every one that
    //   predates this slice — has the `stepOp` arm, the `applyChoice` arm, the
    //   `resumeProgram` splice, the `validateChoice` arm, the redact arm, the
    //   projection arm and both dialogs. A record this build writes is therefore
    //   completely legible to a build that cannot produce it, which is precisely
    //   the property a version number exists to state.
    //
    // What is left to CHECK is that the produced park is the same plain-JSON
    // shape the v12 reader was built against, and that it survives the trip. That
    // is what this drives; `apps/api` is untouched and the derivation never
    // pointed there.
    const state = parked();
    const thawed = JSON.parse(JSON.stringify(state)) as GameState;
    if (thawed.phase.kind !== "effect:choose") throw new Error("expected the park");
    // Byte-identical to the hand-built park `optionalConfirm.test.ts` drives
    // against the D186 mechanism — same prompt, same op, no new field.
    expect(thawed.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[UNTIL].text });
    expect(thawed.phase.cont.pendingOp).toEqual({
      op: "optional",
      note: CLAUSES[UNTIL].text,
      // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
      then: [{ op: "drawUntilHandSize", size: 6 }],
    });
    const { state: done } = mustApply(thawed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(done.players.p1.hand).toHaveLength(6);
  });
});
