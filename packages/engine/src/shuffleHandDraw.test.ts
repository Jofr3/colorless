import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import { engineVersion } from "./index";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  HAND_DRAW_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

// 0.376.0 → 0.377.0 — 🆕🆕 D479: THE ATTACK-SIDE HAND REFRESH.
//
// *"Shuffle your hand into your deck. Then, draw 6 cards."* — `censusAttackCorpus.ts`
// **FILE LINE 486**, **1 sentence / 1 legal printing**, claimed WHOLE by
// `deriveAttackEffect` arm 44b through ONE new anchor (`SHUFFLE_HAND_DRAW`) and ONE new
// arm returning `[{ op: "handRefresh", who: "you", draw: { kind: "fixed", count } }]`.
//
// 🛑 **THE REPO ALREADY KNEW THE ANSWER AND HAD WRITTEN IT DOWN.** D404 built the
// sentence one verb over (*"Discard your hand and draw 6 cards."*, 7 printings) and its
// own doc block names THIS row as its near-miss with the correct diagnosis: *"the same
// zone emptied by a DIFFERENT verb into a DIFFERENT pile, **which is `handRefresh` and
// not `discardHand`**"*. `discardHandDraw.test.ts` then fielded it as a `toBeNull`
// witness for 75 decisions with the comment *"it is a whole slice of its own
// (`handRefresh` with `toBottom` absent)"*. That price was right and this slice is it
// being paid — both of those rungs are RE-POINTED here rather than deleted (D444/D447).
//
// ⚠️ **ZERO NEW MECHANISM, MEASURED IN §7 RATHER THAN ASSERTED.** No new `EffectOp`
// member, op FIELD, op VALUE, reader (surface still 13), prompt, choice, event, error
// code, registry row, `FIXTURE_POOL` id, `interpreter.ts` byte, `redact.ts` byte or
// `packages/schema` byte. `handRefresh { who: "you", draw: { kind: "fixed", count } }`
// is Youngster `sv01-198`'s hand-authored trainer program at a second address, and §2
// reads this arm AGAINST that row rather than against a re-typed expectation.
//
// 🛑 **WHAT THIS FILE IS ACTUALLY ABOUT IS *WHICH PILE*, AND A COUNT CANNOT SEE IT.**
// Arm 44's program and this one both leave a six-card hand and both fire `CARDS_DRAWN`
// with six uids. They differ in where the OLD hand went — the discard there, the DECK
// here — and in whether the deck was reshuffled. §4 reads UIDS across all four zones,
// which is the only instrument that can tell them apart; §3's `not.toEqual` says the
// same thing at the reader.
//
// ⚠️ **THE DEMONSTRATOR IS NOT A NEW FIXTURE (D414/D425).** `fix-handdraw` is D404's
// body and already prints the SIBLING sentence as its whole attack; the boards below
// re-text attack 0 on a per-board `cardPool` CLONE, so `FIXTURE_POOL` is byte-unchanged
// and every `ids.length` ladder takes a ZERO term. The STRING is the corpus row byte
// for byte (§1); nothing else about the body is transcription.

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not merely by the one reader it is about
    (D382). Kept in `discardHandDraw.test.ts`'s order and guarded against the MODULE in
    §7, D419's rule — a hand-kept copy that nothing compares to the module can sit short
    of it indefinitely. */
const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

/** THE SENTENCE THIS SLICE BUYS, byte for byte from `legalAttackCorpus()`. */
const PRINTED = "Shuffle your hand into your deck. Then, draw 6 cards.";

/** 🛑 **THE REAL NEAR-MISS, AND IT IS THE VERY NEXT CORPUS LINE** (487, 1 printing) —
    the identical head, a DERIVED count. `HandRefreshDraw` has four members and NOT ONE
    of them counts the OPPONENT's hand: `fixed` is a constant, `handPlus` reads the
    drawing seat's own pre-move hand, `prizeCount` its own Prizes, `perSeat` picks one
    of a printed PAIR by seat. So this row needs a FIFTH member and stays LOUD, and that
    refusal is this anchor's own falsifier rather than a constructed one (D399). */
const DERIVED_COUNT = "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.";

/** D404's sentence — the SIBLING, and the reason §3's sharpest rung is a `not.toEqual`
    rather than a `toBeNull`: both anchors are `^…$` and a string cannot begin two ways,
    so the disjointness is STRUCTURAL (D467's first preference) and carries no guard. */
const SIBLING = "Discard your hand and draw 6 cards.";

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const program = (count: number) => [
  { op: "handRefresh", who: "you", draw: { kind: "fixed", count } },
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at ONE printing, and so is its near-miss", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    // D456's: derive the specimen from `legalAttackCorpus()` where you can.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(DERIVED_COUNT)).toBe(1);
    expect(rows.get(SIBLING)).toBe(7);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, which D478's did
    // NOT (1 vs 2) — so every census term this slice writes is the same number, and a
    // pass that carried D478's habit of reading the two apart would still be right here
    // for the wrong reason. Stated so the next slice does not inherit the coincidence
    // (D451/D461/D464).
    expect([1, units(legalAttackCorpus().filter(([, s]) => s === PRINTED))]).toEqual([1, 1]);
    // The é is U+00E9-free here and the apostrophe in the near-miss is ASCII U+0027,
    // measured with `codePointAt` rather than by eye (D421/D440).
    expect(PRINTED.includes("é")).toBe(false);
    expect(DERIVED_COUNT.includes("opponent's")).toBe(true);
    expect(DERIVED_COUNT.includes("opponent’s")).toBe(false);
    expect(DERIVED_COUNT.codePointAt(DERIVED_COUNT.indexOf("'"))).toBe(0x0027);
  });

  it("🛑 the column prints ONE count for this skeleton, and it is 6", () => {
    // The measurement behind the CAPTURE, stated as a number rather than left implied
    // (D400). A literal `6` in the anchor could never go red off THIS column — which is
    // exactly why the argument for capturing comes from the OTHER column (§2).
    const family = legalAttackCorpus().filter(([, s]) =>
      /^Shuffle your hand into your deck\. Then, draw /.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([DERIVED_COUNT, PRINTED].sort());
    expect(units(family)).toBe(2);
  });

  it("🆕🆕 D479 — the sentence is now RESOLVED, and by exactly one reader", () => {
    // The transition this slice is, asserted off the MODULE surface rather than off the
    // hand-kept list above (D419) — so no edit to `READERS` can move it.
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(program(6));
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and its near-miss is still refused by ALL THIRTEEN. This is the pair that makes
    // the rung above a claim about the ANCHOR and not about the corpus: one sentence in
    // and one out, differing on the count alone.
    expect(resolvedByAnyReader(DERIVED_COUNT)).toBe(false);
    for (const read of READERS) expect(read(DERIVED_COUNT), read.name).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, and why the count is CAPTURED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §2 — the program, read against the TRAINER column's hand-authored rows", () => {
  it("🛑 the count is a printed PARAMETER, and `registry.ts` is the evidence", () => {
    // D404's argument at a second address. The attack column prints 6 alone (§1), so the
    // corpus cannot justify a capture on its own; the trainer column can. Youngster
    // `sv01-198` carries 5 and Katy `sv01-177` carries 8, both hand-authored years
    // before this arm existed — so the arm is read AGAINST those rows rather than against
    // a re-typed expectation. One sentence, two producers, and they must agree byte for
    // byte or one of them is wrong.
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 5 cards.")).toEqual(
      programFor("sv01-198")?.trainer,
    );
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 8 cards.")).toEqual(
      programFor("sv01-177")?.trainer,
    );
    // …and the two really are DIFFERENT programs, so the pair above is not one assertion
    // written twice.
    expect(programFor("sv01-198")?.trainer).not.toEqual(programFor("sv01-177")?.trainer);
    // 🛑 KATY'S ROW ALSO CARRIES `trainerEndsTurn: true`, and the printed reason is a
    // THIRD sentence this arm never sees ("Your turn ends."). The equality above is on
    // the `trainer` PROGRAM alone, which is the half this arm derives; asserting the
    // whole `CardProgram` would have failed for a reason that is not about this slice.
    expect(programFor("sv01-177")?.trainerEndsTurn).toBe(true);
    expect(programFor("sv01-198")?.trainerEndsTurn).toBeUndefined();
  });

  it("a printed 0 stays LOUD, and 1 does not", () => {
    // The `>= 1` guard every counted arm in `effects.ts` carries. A "draw 0 cards." is a
    // deck reshuffle wearing a draw's sentence, and belongs on the ATTACK_EFFECT_SKIPPED
    // path where a census can see it.
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 1 cards.")).toEqual(
      program(1),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("🛑 the VERB refuses BOTH WAYS, and that is the disjointness stated as behaviour", () => {
    // D399's rule: the POSITIVE control first, or a near-miss the anchor refuses for
    // some OTHER reason proves nothing about the byte you meant to test.
    expect(deriveAttackEffect(PRINTED)).toEqual(program(6));
    // 🛑 THE SHARPEST RUNG IN THE FILE, AND IT IS NOT A `toBeNull`. Both sentences now
    // BUILD, so "the other anchor refuses mine" can only be said as "it derives to
    // something else". A widened `DISCARD_HAND_DRAW` that floated on "draw 6 cards"
    // would claim this string and this pair is what reddens.
    expect(deriveAttackEffect(SIBLING)).not.toEqual(program(6));
    expect(deriveAttackEffect(SIBLING)).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 6 },
    ]);
    // …and neither anchor can reach the other's string at all, because a string cannot
    // begin two ways and both are `^…$`. STRUCTURAL disjointness (D467's first
    // preference): no guard, nothing to rot, and the ORDER of the two arms is therefore
    // legibility rather than behaviour — pinned from the other side by an
    // ORDER-PERMUTATION mutant declared `equivalent` (D439's shape).
    expect(PRINTED.startsWith("Shuffle ")).toBe(true);
    expect(SIBLING.startsWith("Discard ")).toBe(true);
  });

  it("🛑 the COUNT, the SEAT, the DESTINATION and the JOIN refuse INDEPENDENTLY", () => {
    // …the COUNT alone, and it is the REAL printing rather than a construction: corpus
    // line 487 needs a fifth `HandRefreshDraw` member.
    expect(deriveAttackEffect(DERIVED_COUNT)).toBeNull();
    // …the SEAT alone: the printed subject is "your", and `who: "opponent"` /
    // `who: "both"` are the op's other two values. Neither spelling is printed in the
    // attack column, and admitting either would empty a hand this sentence never names.
    expect(
      deriveAttackEffect("Shuffle your opponent's hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Each player shuffles their hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    // 🛑 …AND THE POSSESSIVE ITSELF, BOTH OF THEM, because a widened `(?:your|their)`
    // would leave the ARM emitting `who: "you"` on a sentence naming the other seat —
    // a read that is wrong about WHOSE ZONE IT NAMES and that no positive board can
    // reveal, since on the printed string the two spellings are the same seat
    // (`RETURN_BENCHED`/`DAMAGE_SUPPRESSION`'s seat-widening shape, D467).
    expect(
      deriveAttackEffect("Shuffle their hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Shuffle your hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    // …the DESTINATION alone: `toBottom` is Iono's placement and a DIFFERENT program
    // (the deck's order survives). The sentence that prints it is a Supporter's, not an
    // attack's, and this arm must not answer it.
    expect(
      deriveAttackEffect("Shuffle your hand and put it on the bottom of your deck. Then, draw 6 cards."),
    ).toBeNull();
    // …the JOIN alone: the printed two-sentence form with ". Then, " is what this anchor
    // reads. The one-sentence "and" spelling is nobody's printing here.
    expect(deriveAttackEffect("Shuffle your hand into your deck and draw 6 cards.")).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} If you do, this attack does 60 more damage.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "Shuffle your hand into your deck. Then, draw 6 cards",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. One fixture, re-texted on a per-board `cardPool` clone (D414).
// ─────────────────────────────────────────────────────────────────────────────

/** Re-text `fix-handdraw`'s ONE printed attack on a board's OWN `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by every suite in this package
    and D412 reddened three of D409's boards by widening a shared one. This mutates a
    per-board clone, so nothing outside the calling `it` can see it, and the slice adds
    **no `FIXTURE_POOL` id**. */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-handdraw"];
  if (card === undefined) throw new Error("no fix-handdraw in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-handdraw has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-handdraw": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so their
    first turn carries no §4 attack restriction. P1 fields `fix-handdraw` holding one
    `fix-energy` (the printed {C} cost); P2's Active is a 200 HP body the flat 30 never
    Knocks Out, so no §8.1 KO tail can land between the shuffle and the draw. */
function fielded(seed: number, effect: string = PRINTED): GameState {
  const opened = mustApply(
    driveSetup(seed, { p1: HAND_DRAW_DECK, p2: HAND_DRAW_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(opened, "p1", "fix-handdraw");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return withEffect(state, effect);
}

/** Every card id `HAND_DRAW_DECK` prints, so "empty the hand" is a statement about the
    deck list rather than about one seed's draw. */
const DECK_IDS = ["fix-handdraw", "fix-bigbody", "fix-item", "fix-energy"] as const;

/** TEST SURGERY, composed from the shipped helper: return P1's whole hand to the bottom
    of their deck. */
function emptyHand(state: GameState): GameState {
  let next = state;
  for (const id of DECK_IDS) next = handToDeck(next, "p1", id);
  return next;
}

const sorted = (uids: readonly string[]) => [...uids].sort();

describe("D479 §4 — WHICH PILE, read off UIDS because a count cannot see it", () => {
  it("🛑 the old hand ends in the DECK and NOT in the discard — the whole difference from arm 44", () => {
    // THE RUNG THIS WHOLE SLICE EXISTS FOR. Under `discardHand` + `drawCards` every op
    // still runs, the hand still ends at six and `CARDS_DRAWN` still carries six uids —
    // so every count-based assertion is green under the wrong program. What separates
    // them is WHERE THE OLD HAND WENT, and these two sets are disjoint by construction.
    const state = fielded(1);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const oldDiscard = [...before.discard];
    expect(oldHand.length).toBeGreaterThan(0);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    // 🛑 THE DISCARD PILE IS BYTE-UNCHANGED. Under arm 44's program every card of
    // `oldHand` would be sitting in it, and `HAND_DISCARDED` would name them.
    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(done.players.p1.discard).toEqual(oldDiscard);
    for (const uid of oldHand) expect(done.players.p1.discard).not.toContain(uid);
    // …and every one of them is in the deck OR back in the hand (the shuffle can deal a
    // card straight back), which is exactly "it went into the deck and then six came
    // off it".
    for (const uid of oldHand) {
      expect([...done.players.p1.deck, ...done.players.p1.hand]).toContain(uid);
    }
    // 🛑 CONSERVATION: hand ∪ deck is the same multiset before and after. Nothing was
    // created, nothing leaked to a third zone.
    expect(sorted([...done.players.p1.hand, ...done.players.p1.deck])).toEqual(
      sorted([...oldHand, ...oldDeck]),
    );
    expect(done.players.p1.hand).toHaveLength(6);
    expect(done.players.p1.deck).toHaveLength(oldHand.length + oldDeck.length - 6);
  });

  it("🛑 the EVENT is the shuffle's and not the discard's, and it is COUNT-ONLY", () => {
    // `handRefresh` emits HAND_SHUFFLED_INTO_DECK (a count, because a hand's cards are
    // hidden) and never HAND_DISCARDED. Arm 44's program emits the opposite pair, so
    // this is the same claim as §4.1 read off the wire instead of off the board — the
    // half a client and a replay actually see.
    const state = fielded(2);
    const handCount = state.players.p1.hand.length;
    const { events } = mustApply(state, attack);
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({ seat: "p1", count: handCount });
    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(types(events)).not.toContain("HAND_TO_BOTTOM_OF_DECK");
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ seat: "p1", reason: "effect" });
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(6);
  });

  it("the op runs at the attack's TAIL, after the damage, and the printed BASE is KEPT", () => {
    // An `EffectOp` runs after §8.5 and before `finishAttack`'s Knock Out sweep, so the
    // printed 30 lands FIRST and the program follows it. `programDamage` is
    // `program?.some(step => step.op === "damageDefender")`, FALSE here, so the printed
    // number survives the whole pipeline — a reading that ever claimed the base would
    // silently delete a 30-damage attack.
    const state = fielded(3);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "HAND_SHUFFLED_INTO_DECK",
      "CARDS_DRAWN",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("🛑 neither half of `ATTACK_EFFECT_SKIPPED` fires, and nothing parks", () => {
    // `effectSimulated`'s FIRST disjunct is `program !== null`, so a new
    // `deriveAttackEffect` arm answers the effect half by construction and this slice
    // adds NO term to any of `attack.ts`'s three disjunction chains. `handRefresh` never
    // parks (interpreter.ts: "Fully automatic — no decision"), so there is one action and
    // one event list — stated rather than relied on (D403).
    const state = fielded(4);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toContain("ATTACK_DECLARED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

describe("D479 §5 — the SEAT: `who: \"you\"` is the printed subject, not a default", () => {
  it("🛑 the OPPONENT's hand, deck and discard are BYTE-UNCHANGED", () => {
    // The rung that kills `who: "both"` and `who: "opponent"`, the two nearest wrong
    // VALUES of the one field this arm writes. Both are shipped and authored
    // (Judge/Iono, Gothitelle), so neither is a construction — and on a ONE-SEAT board
    // all three read identically, which is why this is asserted on the seat that is NOT
    // attacking (D463's pair rule).
    const state = fielded(5);
    const before = state.players.p2;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const oldDiscard = [...before.discard];
    expect(oldHand.length).toBeGreaterThan(0);
    const { state: done, events } = mustApply(state, attack);
    // 🛑 ASSERTED AS *STILL IN HAND*, NOT AS AN EQUALITY, AND THE REASON IS A REAL EVENT
    // RATHER THAN A TOLERANCE. The attack ends P1's turn, so P2's turn STARTS inside this
    // same event list and P2 draws one card for it — an equality here would go red for
    // §5.3's draw and not for anything this slice does. Under `who: "both"` or
    // `who: "opponent"` every uid below would be in P2's DECK instead, which no
    // start-of-turn draw can imitate.
    for (const uid of oldHand) expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand).toHaveLength(oldHand.length + 1);
    // …and P2's deck lost exactly that ONE card off its TOP and was never reshuffled:
    // the tail is byte-identical, which a shuffle could not leave.
    expect(done.players.p2.deck).toEqual(oldDeck.slice(1));
    expect(done.players.p2.discard).toEqual(oldDiscard);
    // …and no event names the other seat, which is the wire's half of the same claim.
    // (The trailing TURN_STARTED draw is P2's start-of-turn draw and is not this op's —
    // it is filtered by `reason`, so the assertion cannot be satisfied by absence of
    // events in general.)
    expect(
      events.filter((e) => e.type === "HAND_SHUFFLED_INTO_DECK" && e.seat === "p2"),
    ).toHaveLength(0);
    expect(
      events.filter((e) => e.type === "CARDS_DRAWN" && e.seat === "p2" && e.reason === "effect"),
    ).toHaveLength(0);
  });
});

describe("D479 §6 — the falsifiers, driven rather than argued", () => {
  it("FALSIFIER 1 — an EMPTY hand still reshuffles and still draws SIX", () => {
    // `onlyIfAnyMoved` is ABSENT on this program (it is Iono's rider), so the draw is
    // unconditional. The deck is reordered even from an empty hand — interpreter.ts says
    // so in as many words — which is why "nothing happened" is the wrong reading of an
    // empty hand here and a `toHaveLength(0)` on the drawn list would be wrong.
    const state = emptyHand(fielded(6));
    expect(state.players.p1.hand).toEqual([]);
    const oldDeck = [...state.players.p1.deck];
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({ seat: "p1", count: 0 });
    expect(done.players.p1.hand).toHaveLength(6);
    expect(sorted([...done.players.p1.hand, ...done.players.p1.deck])).toEqual(sorted(oldDeck));
  });

  it("FALSIFIER 2 — a SHORT pile draws what is there and costs no rule", () => {
    // `drawToHand` SLICES, so a six-card draw off a four-card pile files FOUR and stops.
    // Running the deck dry does NOT end the game here: §14.3's deck-out is checked at
    // the DRAW in `flow.ts startTurn`, so the loss stays owed to P1's next turn. That is
    // `ATTACK_DRAW`'s stated reading of its own short draw, inherited rather than
    // re-decided.
    // ⚠️ THE ORDER OF THE TWO SURGERIES IS LOAD-BEARING: `emptyHand` puts the hand UNDER
    // the deck, so trimming FIRST would leave a pile of 4 + hand. Empty, then trim.
    const state = trimDeckTo(emptyHand(fielded(7)), "p1", 4);
    expect(state.players.p1.hand).toEqual([]);
    const pile = [...state.players.p1.deck];
    expect(pile).toHaveLength(4);
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(sorted(done.players.p1.hand)).toEqual(sorted(pile));
    expect(done.players.p1.deck).toEqual([]);
    // §14.3's deck-out is checked at the DRAW, not here — so the board is NOT over.
    expect(done.phase.kind).not.toBe("gameOver");
  });

  it("🛑 ZERO-MATCH BOARD — the near-miss on the SAME body is SILENT, and loudly so", () => {
    // THE CONTROL THAT SEPARATES THIS ARM FROM SILENCE-FOR-ANOTHER-REASON. The board,
    // the fixture, the cost, the seat and the damage are identical to §4's; only the
    // printed STRING differs, and it differs on the count alone (corpus line 487). So a
    // green §4 plus a green rung here cannot both be explained by the board.
    const state = fielded(8, DERIVED_COUNT);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const { state: done, events } = mustApply(state, attack);
    // The damage still lands — the attack RESOLVED; it is the EFFECT that is unread.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // …and the engine says so out loud rather than resolving quietly.
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("HAND_SHUFFLED_INTO_DECK");
    expect(types(events)).not.toContain("HAND_DISCARDED");
    // Every zone is where it was.
    expect(done.players.p1.hand).toEqual(oldHand);
    expect(done.players.p1.deck).toEqual(oldDeck);
  });
});

describe("D479 §7 — what this slice did NOT buy, measured", () => {
  it("the hand-kept READERS list IS the module's reader surface, still THIRTEEN", () => {
    // D419's guard: a hand-kept copy that nothing compares to the module can sit short
    // of it indefinitely. The COUNT is pinned separately from the diff, because a diff
    // alone stays green when a slice deletes a reader from the module and from this list
    // in the same commit.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    // D414/D452: the slice adds ZERO fixture ids, so every `ids.length` ladder takes a
    // ZERO term. `fix-handdraw` still prints D404's sentence in the SHARED pool, and the
    // whole attack list is asserted rather than index 0 alone (D437: truncating an
    // enumeration by WIDTH is truncating).
    expect(FIXTURE_POOL["fix-handdraw"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Hand Refresh", damage: "30", effect: SIBLING },
    ]);
  });

  it("🛑 the ENGINE version moved and `MATCH_RECORD_VERSION` did not, and both are argued", () => {
    // The engine bump is behaviour: a printed sentence that resolved to nothing now
    // resolves to a program. `MATCH_RECORD_VERSION` is UNCHANGED on BOTH of D463's
    // tests, and neither is inherited:
    //   • the SERIALIZED ALPHABET does not grow — this arm adds no `EffectOp` member, no
    //     op FIELD and no op VALUE. `handRefresh`, `who: "you"` and
    //     `draw: { kind: "fixed" }` are all authored in `registry.ts` today, so nothing
    //     new can appear in a persisted program;
    //   • REACHABILITY (D450) — the op NEVER PARKS, so no `phase.cont.pendingOp` or
    //     `rest` can hold it and no saved match can contain a shape an older deploy
    //     could not read. `interpreter.ts`'s case returns `{ done: … }` and nothing else.
    expect(engineVersion).toBe("0.400.0");
  });
});
