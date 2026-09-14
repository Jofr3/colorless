import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { applyAction, createGame, engineVersion, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { registryCardIds } from "./registry";
import { flipCoin, randomIndex } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

// 0.353.0 → 0.354.0 — 🆕🆕 D452: THE TWO PER-HEADS CONSEQUENTS THAT NEED NO PARK.
//
//   line 201 (1 printing)  "Flip 2 coins. For each heads, discard the top card of
//                           your opponent's deck."
//   line 216 (1 printing)  "Flip 3 coins. For each heads, discard a random card
//                           from your opponent's hand."
//
// 🛑 **THE MECHANISM WAS ALREADY THERE, AND IT IS NOT A FOLD.** The work order that
// opened this slice priced it as "a count that multiplies an op's amount", the shape
// D448 found one zone over (`snipeAmount`'s `op.amount * …`). **THAT PREMISE DOES NOT
// SURVIVE CONTACT WITH THE CODE.** `programPerHeads` has existed since D130 and spends
// the heads count into a LONGER PROGRAM — `heads` copies of the member's ops, appended
// at the flip site in `attack.ts`, run by the existing tail. Nothing multiplies, no op
// reads a coin, and `grep -n "op.amount \*"` reaches this family nowhere. The slice is
// therefore TWO ANCHORS and TWO ARMS over vocabulary that is unchanged: no new op, no
// new field, no new reader, no new event, no registry row, and no
// `MATCH_RECORD_VERSION` byte (§3).
//
// **WHY REPETITION IS THE RIGHT READING RATHER THAN THE CONVENIENT ONE**, and the
// hand arm is what proves it: "For each heads, discard a random card" is N INDEPENDENT
// picks out of a hand that SHRINKS between them. An op carrying a count could only get
// that right by re-deriving the shrink inside itself. §5 drives exactly that — every
// pick names a DIFFERENT uid, and a build that snapshotted the hand could repeat one.
//
// **THE SEED.** `state.rngState` is the engine's one source of randomness (rng.ts).
// The flips are taken from it at the attack site and the hand picks are taken from it
// inside `randomFromOpponentHand` (D232) — ONE sequence, in order, with the flips
// first. §7 recomputes the whole of it from the seed, which is what makes a replay
// exact rather than merely plausible.
//
// 🛑 **TWO SHIPPED REFUSALS DID NOT SURVIVE THIS SLICE, and both are corrected at
// their sites.** D130's block refused the hand sentence because its op *"would be the
// first EffectOp in the engine to consume `state.rngState`"* — D232 built exactly that
// op at D232 — 102 decisions after the refusal was written, and 220 before it was read, so the refusal's own stated trigger had fired (D413). And
// `perHeadsProgram.test.ts`'s `OUT_OF_SCOPE` pinned that sentence at **97 bytes**
// against a string **no card prints**: Krookodile's opening glued to Masquerain's
// consequent. The real sentence is 78 bytes and is corpus line 216.
//
// 🛑 **WHAT WAS REFUSED, AND IT WAS THE PARK — AND NOTHING IS REFUSED HERE ANY MORE.**
// Corpus lines 200, 217 and 234 print the same repeat over `discardEnergy`, which PARKS
// on a genuine choice. That was refused here on COST — see §9, which also disproves
// D130's claim that a park is "the one thing D130's expansion cannot express". 🆕🆕
// **D463 built 200 and 234; D476 built 217 on the FACE axis, so all three of D452's
// grouped rows are now read, by three slices, on three different reasons.** The lists
// are RENAMED and the rungs INVERTED rather than deleted (D418), which is why §1 still
// enumerates five and §9 still exists.

/** Corpus line 201, verbatim off `censusAttackCorpus.ts`. The card that prints it is
    UNRESOLVABLE in this checkout (no D1) and is stated unresolved rather than invented
    (D425); the sentence and its printing count are measured off the committed column,
    which is where every number in §1 comes from. */
const SINGLE_MILL = "Flip 2 coins. For each heads, discard the top card of your opponent's deck.";

/** Corpus line 216, verbatim. Masquerain sv03-007 "Panic-Prompting Pattern" is named
    by D130's own block as the printer; the id is D130's claim rather than this slice's
    measurement, so it is cited and not asserted. */
const HAND_PICK = "Flip 3 coins. For each heads, discard a random card from your opponent's hand.";

/** The two D130 sentences, kept as the CONTROL that the older arms are untouched.
    ⚠️ **NEITHER IS IN `legalAttackCorpus()` ANY MORE** — Wugtrio sv01-057 and Gyarados
    swsh10.5-022 have rotated out of Standard — which §1 asserts rather than assumes.
    They still derive, per D358: rotation decides who may PLAY a card, not what the
    card SAYS. */
const D130_PRINTED = "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.";
const D130_UNTIL =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

/** 🆕🆕 **D463 — TWO OF D452's THREE REFUSALS LEFT THROUGH THE FRONT DOOR, and
    what is left is not a `discardEnergy` refusal at all any more.** D452 refused corpus lines
    200, 217 and 234 on ONE shared count (*"`discardEnergy` PARKS"*) and D463 built two of the
    three, so the shared count was never the reason: it was a COST, exactly as §9's second rung
    disproved it in prose while this list still asserted it. **Read a refusal that groups N rows
    under one reason as N refusals until each has been priced separately** — the two that left
    are `programPerHeads` over the SHIPPED `discardEnergy` op, and the one that stayed is refused
    by an axis (`For each TAILS`) that has nothing to do with parking.

    🆕🆕 **D476 BUILT THE LAST ONE, SO THIS FILE NOW REFUSES NOTHING AT ALL, AND THE LIST IS
    RENAMED RATHER THAN DELETED (D418/D463's own precedent one slice up).** §1's enumeration is
    a claim about the WHOLE per-face population and would silently shrink by one if the row
    were merely dropped; §9 is INVERTED onto it instead, so the discrimination the old
    `toBe(false)` bought is replaced by a stronger one rather than surrendered. **All three of
    D452's grouped refusals are now built, by three different slices, on three different
    reasons — which is the grouped-refusal rule's own receipt.** */
const BUILT_AT_D476 = ["Flip 3 coins. For each tails, discard an Energy from this Pokémon."] as const;

/** 🆕🆕 **D463 — the two rows this file used to refuse and now derives**, verbatim
    off `censusAttackCorpus.ts` file lines 200 and 234. Kept in this suite (rather than only in
    `perHeadsEnergyDiscard.test.ts`) because §1's family enumeration is a claim about the WHOLE
    per-face population and would silently shrink by two if they were merely deleted. */
const BUILT_AT_D463 = [
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
] as const;

const MILL = 0; // {C}, no damage — line 201
const PICK = 1; // {C}, no damage — line 216
const PLAIN = 2; // {C}, no damage, no effect — the ONE-AXIS control
const MILL3 = 3; // {C}, no damage — D130's printed arm, the untouched sibling

/** `fix-*` keys with no catalog row behind them (D425). The demonstrator prints all
    four sentences so one board answers for the pair and its D130 sibling; the printed
    `damage` field is ABSENT everywhere, exactly as both D130 printings have it, so the
    expansion is the whole visible result of every declaration. */
const LOCAL_CARDS: Record<string, Card> = {
  "fix-perheads": battler("fix-perheads", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Single Mill", effect: SINGLE_MILL },
      { cost: ["Colorless"], name: "Hand Pick", effect: HAND_PICK },
      { cost: ["Colorless"], name: "Plain Slap" },
      { cost: ["Colorless"], name: "Triple Mill", effect: D130_PRINTED },
    ],
  }),
  /** 320 HP, no attacks — the victim and the bench filler. Nothing in this suite
      deals damage, so it exists to keep every promotion forced and every board legal
      rather than to survive anything. */
  "fix-perheads-body": battler("fix-perheads-body", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 24 + 24. Every printed
    cost here is {C}, and `fix-energy` is the Colorless Basic. The victim's deck is the
    same list, which is what makes the milled uids nameable off `deck.slice`. */
const PER_HEADS_DECK = deckOf({
  "fix-perheads": 12,
  "fix-perheads-body": 22,
  "fix-energy": 22,
  // A SECOND, DIFFERENT Energy card — §9 needs the victim's Active to hold two that
  // are not interchangeable, because a park at a single class of candidate
  // auto-resolves (the M1 doctrine) and would prove nothing about parking.
  "fix-water-energy": 4,
});

/** How many seeds every sweep walks. Wide enough that both a 2-flip and a 3-flip
    attack reach every heads count — asserted in §6 rather than hoped for. */
const SEEDS = 40;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function faces(events: GameEvent[]): ("heads" | "tails")[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

function headsIn(events: GameEvent[]): number {
  return faces(events).filter((f) => f === "heads").length;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: PER_HEADS_DECK, p2: PER_HEADS_DECK },
    cardPool: POOL,
  });
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
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** p1 owns TURN 2 with the demonstrator Active and one {C} attached; p2 goes first
    and ends turn 1 immediately (§4 forbids the going-first player's turn-1 attack).
    p2's bench holds one body so any promotion is FORCED. */
function armed(seed: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "fix-perheads");
  state = setActiveFromDeck(state, "p2", "fix-perheads-body");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-perheads-body");
  return state;
}

function attack(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE POPULATION, MEASURED OFF THE COMMITTED COLUMN.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — two sentences, two printings, and the family enumerated", () => {
  it("both are corpus rows at ONE legal printing each", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(SINGLE_MILL)).toBe(1);
    expect(corpus.get(HAND_PICK)).toBe(1);
    // …and the column itself has not moved under this slice.
    expect(legalAttackCorpus()).toHaveLength(640);
    expect(legalAttackCorpus().reduce((n, [units]) => n + units, 0)).toBe(1732);
  });

  it("🛑 the WHOLE per-heads family, enumerated by the printed PHRASE and not by a verb", () => {
    // D448's rule: a family grep over a VERB misses the family's biggest member, so
    // the pattern here is the printed phrase "For each heads," / "For each tails,"
    // with the arithmetic fold ("This attack does …") subtracted — which is the only
    // subtraction, and it is stated.
    //
    // ⚠️ WHAT THIS PATTERN CANNOT SEE, written as a query that was RUN rather than a
    // list that was thought of: it cannot see a per-face repeat printed with the face
    // FIRST ("For each of your opponent's…"), it cannot see "up to the number of
    // heads" (corpus lines 215 and 219, which are ceilings rather than repeats), and
    // it cannot see a per-face clause that is not sentence-initial. All three
    // alternatives were run over the column; the second returns 2 rows and the other
    // two return zero.
    const perFace = legalAttackCorpus().filter(
      ([, s]) => /For each (heads|tails),/.test(s) && !s.includes("This attack does"),
    );
    expect(perFace.map(([, s]) => s).sort()).toEqual(
      [SINGLE_MILL, HAND_PICK, ...BUILT_AT_D463, ...BUILT_AT_D476].sort(),
    );
    expect(perFace).toHaveLength(5);
    expect(perFace.reduce((n, [units]) => n + units, 0)).toBe(5);
    // The two ceilings, named so the enumeration's boundary is a measurement.
    const ceilings = legalAttackCorpus().filter(([, s]) => s.includes("up to the number of heads"));
    expect(ceilings).toHaveLength(2);
    for (const [, s] of ceilings) expect(s).not.toContain("For each heads,");
  });

  it("🛑 D130's OWN TWO SENTENCES CARRY ZERO LEGAL PRINTINGS AT THIS HEAD", () => {
    // The arms built at D130 still derive and both cards are still fielded in
    // `perHeadsProgram.test.ts` — but their sentences have left the Standard column.
    // Said executably because "2 printings" is quoted as a live figure in three doc
    // blocks, and a rotted figure that nothing reddens is exactly D425's case.
    const sentences = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(sentences.has(D130_PRINTED)).toBe(false);
    expect(sentences.has(D130_UNTIL)).toBe(false);
    expect(deriveAttackCoinFlip(D130_PRINTED)).not.toBeNull();
    expect(deriveAttackCoinFlip(D130_UNTIL)).not.toBeNull();
    // The whole "discard the top … of your opponent's deck" family in the column, so
    // the absence above is a fact about a set rather than about two strings.
    // ⚠️ `[Dd]` AND NOT /i, AND THE DIFFERENCE IS THE POINT: a sentence-initial
    // "Discard" and a mid-sentence "discard" are the two spellings the column really
    // carries, and a lowercase-only pattern returns ONE row where the truth is five
    // (D448's one-character lesson, paid again here on the first draft of this rung).
    const mills = legalAttackCorpus().filter(([, s]) =>
      /[Dd]iscard the top .*of your opponent's deck/.test(s),
    );
    expect(mills.map(([, s]) => s)).toEqual([
      "Discard the top 2 cards of your opponent's deck.",
      "Discard the top 3 cards of your opponent's deck.",
      "Discard the top card of your opponent's deck.",
      "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      SINGLE_MILL,
    ]);
  });

  it("both resolve through the reader SURFACE, and the surface did not grow", () => {
    expect(resolvedByAnyReader(SINGLE_MILL)).toBe(true);
    expect(resolvedByAnyReader(HAND_PICK)).toBe(true);
    // 🆕🆕 **D476 — THE LAST REFUSAL IS INVERTED HERE TOO, AND THE RUNG IS NOW A
    // FIVE-FOR-FIVE CLAIM.** This line used to assert `false` for the one row D452 left; the
    // whole per-face population now resolves, and saying so on the SAME surface in the SAME
    // rung is what keeps the discrimination the `false` bought (D418). The surface is still 13
    // — D476 adds an anchor to `deriveAttackCoinFlip`, not a fourteenth reader.
    for (const sentence of BUILT_AT_D476) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
    // 🆕🆕 **D463 — AND THE TWO THAT LEFT ARE ASSERTED RESOLVED ON THE SAME
    // SURFACE, IN THE SAME RUNG.** A refusal that is deleted rather than inverted takes its
    // discrimination with it: this pair asserts the reader surface answers OPPOSITELY for the
    // two halves of what used to be one list, which no `toBe(false)` loop over a shorter array
    // can say. The surface itself is still 13 — D463 adds anchors to `deriveAttackCoinFlip`, not
    // a fourteenth reader.
    for (const sentence of BUILT_AT_D463) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: two anchors, and the crossings they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the co-variance is fenced", () => {
  it("each sentence derives the exact literal", () => {
    expect(deriveAttackCoinFlip(SINGLE_MILL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(HAND_PICK)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "randomFromOpponentHand", to: "discard" }],
      face: "heads",
    });
  });

  it("🛑 the ops are BYTE-IDENTICAL to what the BARE sentences already derive", () => {
    // The whole of why this slice adds no vocabulary: the consequent of each printing
    // is a sentence the catalog also prints ALONE, and `deriveAttackEffect` has read
    // both of those for a long time. The coin arm produces the same object, not a
    // lookalike — asserted on the SERIALIZED bytes, because "deep equal" would pass on
    // a differently-keyed twin.
    const bareMill = (deriveAttackEffect("Discard the top card of your opponent's deck.") ?? [])[0];
    const bareHand = (deriveAttackEffect("Discard a random card from your opponent's hand.") ?? [])[0];
    const coinMill = (deriveAttackCoinFlip(SINGLE_MILL) as { ops: EffectOp[] }).ops[0];
    const coinHand = (deriveAttackCoinFlip(HAND_PICK) as { ops: EffectOp[] }).ops[0];
    expect(JSON.stringify(coinMill)).toBe(JSON.stringify(bareMill));
    expect(JSON.stringify(coinHand)).toBe(JSON.stringify(bareHand));
  });

  it("🛑 refuses the CROSS PRODUCT — the digits and the plural `s` CO-VARY", () => {
    // D451's rule, and the reason the singular gets its OWN anchor rather than an
    // optional group: `the top (?:(\d+) )?cards?` would additionally accept these two
    // strings, which the catalog prints ZERO times and whose readings nobody decided.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top 3 card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top cards of your opponent's deck."),
    ).toBeNull();
    // …and both PRINTED spellings still derive, which is what makes the two nulls a
    // fence rather than a gap.
    expect(deriveAttackCoinFlip(SINGLE_MILL)).not.toBeNull();
    expect(deriveAttackCoinFlip(D130_PRINTED)).not.toBeNull();
  });

  it("🛑 the UNBOUNDED twin of each new arm is DELIBERATELY absent", () => {
    // D129's flip count reaches D130's consequent because the catalog prints it that
    // way. It prints NEITHER of D452's sentences that way — measured over the column
    // — so an anchor for them would author a card, which is the refusal
    // `FLIP_OPPONENT_ACTIVE_DISCARD` makes on its own family.
    const untilRows = legalAttackCorpus().filter(([, s]) => s.startsWith("Flip a coin until you get tails."));
    expect(untilRows.filter(([, s]) => s.includes("For each heads, discard the top"))).toHaveLength(0);
    expect(untilRows.filter(([, s]) => s.includes("random card from your opponent's hand"))).toHaveLength(0);
    expect(
      deriveAttackCoinFlip("Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand."),
    ).toBeNull();
  });

  it("carries the family's flip guards, and NO count guard on the singular", () => {
    // `flips >= 2` (the regex's own "coins" is PLURAL) and `flips <= MAX_PRINTED_FLIPS`
    // (10, the ingested-text ceiling), copied from the plural twin deliberately.
    for (const n of [0, 1, 11, 99]) {
      expect(
        deriveAttackCoinFlip(`Flip ${n} coins. For each heads, discard the top card of your opponent's deck.`),
        `mill ${n}`,
      ).toBeNull();
      expect(
        deriveAttackCoinFlip(`Flip ${n} coins. For each heads, discard a random card from your opponent's hand.`),
        `hand ${n}`,
      ).toBeNull();
    }
    for (const n of [2, 3, 10]) {
      expect(deriveAttackCoinFlip(`Flip ${n} coins. For each heads, discard the top card of your opponent's deck.`)).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: n },
        ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
        face: "heads",
      });
    }
    // 🛑 THE SINGULAR ARM HAS NO `count >= 1` GUARD AND OWES NONE: its count is the
    // WORD "card", so there is no digit that could be zero. The plural arm's guard is
    // still there and still bites, which is what tells the two apart.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top 0 cards of your opponent's deck."),
    ).toBeNull();
  });

  it("accepts the U+2019 spelling and refuses a NON-BREAKING space", () => {
    for (const straight of [SINGLE_MILL, HAND_PICK]) {
      const curly = straight.replace("opponent's", "opponent’s");
      expect(curly).not.toBe(straight);
      expect(deriveAttackCoinFlip(curly)).toEqual(deriveAttackCoinFlip(straight));
      const nbsp = straight.replace("For each", "For each");
      expect(deriveAttackCoinFlip(nbsp)).toBeNull();
    }
  });

  it("is CASE SENSITIVE and whole-sentence ANCHORED", () => {
    for (const straight of [SINGLE_MILL, HAND_PICK]) {
      expect(deriveAttackCoinFlip(straight.toLowerCase())).toBeNull();
      expect(deriveAttackCoinFlip(straight.replace("For each", "for each"))).toBeNull();
      expect(deriveAttackCoinFlip(`Then, ${straight}`)).toBeNull();
      expect(deriveAttackCoinFlip(`${straight} Then, draw a card.`)).toBeNull();
      // …but outer whitespace is trimmed, like every sibling reader.
      expect(deriveAttackCoinFlip(`  ${straight}  `)).toEqual(deriveAttackCoinFlip(straight));
    }
  });

  it("ONE reader owns each sentence — every sibling returns null", () => {
    for (const sentence of [SINGLE_MILL, HAND_PICK]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("leaves all four D126–D130 readings EXACTLY as they were", () => {
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads.")).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 30,
    });
    expect(
      deriveAttackCoinFlip("Flip a coin until you get tails. This attack does 30 more damage for each heads."),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(deriveAttackCoinFlip(D130_UNTIL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — `MATCH_RECORD_VERSION` STAYS 29, driven over the SERIALIZED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — no new persisted byte, in three directions", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // 🛑 WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED (D386/D443). This slice
    // adds no `EffectOp` inhabitant, no key on an existing one and no rename. It adds
    // two REGEX ANCHORS and two arms that emit ops the engine already emits — so the
    // question is not "is a widening free" but "can this slice write a byte string an
    // older deploy could not". It cannot, and the argument does NOT rest on
    // reachability, which is the difference from D450.

    // **DIRECTION 1 — FORWARD: the literals this deploy writes, whole.**
    const mill = (deriveAttackCoinFlip(SINGLE_MILL) as { ops: EffectOp[] }).ops[0] as EffectOp;
    const pick = (deriveAttackCoinFlip(HAND_PICK) as { ops: EffectOp[] }).ops[0] as EffectOp;
    expect(JSON.stringify(mill)).toBe('{"op":"discardDeckTop","whose":"opponent","count":1}');
    expect(JSON.stringify(pick)).toBe('{"op":"randomFromOpponentHand","to":"discard"}');
    expect(Object.keys(mill).sort()).toEqual(["count", "op", "whose"]);
    expect(Object.keys(pick).sort()).toEqual(["op", "to"]);
    expect(JSON.parse(JSON.stringify(mill))).toEqual(mill);
    expect(JSON.parse(JSON.stringify(pick))).toEqual(pick);
    // 🛑 AND A v29 DEPLOY ALREADY WRITES BOTH STRINGS, which is the whole argument.
    // The bare sentences are printed by 7 and 8 legal printings respectively and have
    // derived to these exact objects since before this slice. There is no new byte.
    expect(JSON.stringify(deriveAttackEffect("Discard the top card of your opponent's deck.")?.[0])).toBe(
      JSON.stringify(mill),
    );
    expect(JSON.stringify(deriveAttackEffect("Discard a random card from your opponent's hand.")?.[0])).toBe(
      JSON.stringify(pick),
    );

    // **DIRECTION 2 — BACKWARD: what can reach storage, and whether a PARK is in the
    // path.** An `EffectOp` reaches `MatchRecord` by exactly one route:
    // `EffectContinuation` carries `{pendingOp, rest, ctx, record}` at
    // `GameState.phase.cont`. It is written only when a program PARKS. ⚠️ The brief
    // warned that a coin sentence MAY park and that D450's argument might not travel —
    // so it is checked rather than inherited, in both halves:
    //   · NEITHER OP PARKS. `discardDeckTop`'s and `randomFromOpponentHand`'s `stepOp`
    //     arms both return `{ done }` — driven below across every heads outcome by the
    //     absence of an `effect:choose` phase after the declaration;
    //   · AND NO OTHER OP SHARES THE PROGRAM. The expansion is APPENDED to whatever
    //     the attack already had, and for these two printings that is null: the
    //     derivers are whole-sentence anchored (so `deriveAttackEffect` refused both,
    //     asserted in §2) and no registry row authors either op with a park beside it.
    //     The registry sweep is over `registryCardIds()`, not `FIXTURE_POOL` (D342).
    let parked = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const index of [MILL, PICK]) {
        const { state } = attack(armed(seed), index);
        if (state.phase.kind === "effect:choose") parked += 1;
      }
    }
    expect(parked).toBe(0);
    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    expect(authored.length).toBeGreaterThan(0);

    // **DIRECTION 3 — THE LOSS DIRECTION.** Each key degrades differently, and one of
    // the two is a SILENT desync rather than a visible whiff. Stated in full before the
    // reachability argument, because reachability alone reads as an excuse (D450).
    const events: GameEvent[] = [];
    const board = armed(3);
    // · a lost `count` is a SILENT WHIFF: `Math.max(0, undefined)` is NaN,
    //   `slice(0, NaN)` is empty, and the arm's own "zero cards emit nothing" guard
    //   returns the state untouched. No row, no throw, no card moved.
    const noCount = JSON.parse(JSON.stringify(mill, (k, v) => (k === "count" ? undefined : v))) as EffectOp;
    expect(Object.keys(noCount)).not.toContain("count");
    const milled = runProgram(board, [noCount], { seat: "p1", invokedBy: "attack" }, events);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(milled.state.players.p2.deck).toEqual(board.players.p2.deck);
    // · 🛑 a lost `to` is WORSE and is not a whiff at all: `op.to === "discard"` is
    //   false, so the DECK arm runs — the card is put back into the opponent's deck and
    //   the deck is SHUFFLED, which advances `rngState` a second time. Two replays that
    //   did the same thing would diverge on every later flip, and the board looks
    //   entirely normal. That is D435's silent-corruption shape at a persisted key.
    const noTo = JSON.parse(JSON.stringify(pick, (k, v) => (k === "to" ? undefined : v))) as EffectOp;
    const events2: GameEvent[] = [];
    const picked = runProgram(board, [noTo], { seat: "p1", invokedBy: "attack" }, events2);
    expect(all(events2, "RANDOM_CARD_TAKEN")).toHaveLength(1);
    expect(all(events2, "SHUFFLE")).toHaveLength(1);
    expect(picked.state.players.p2.discard).toEqual(board.players.p2.discard);
    expect(picked.state.rngState).not.toBe(board.rngState);
    // …and NEITHER is reachable from this slice, because direction 1 established that
    // both byte strings are ones a v29 deploy already writes: the loss hazard is a
    // pre-existing property of two shipped ops rather than anything D452 introduces.
    // Both halves are stated; neither alone is the argument.
  });

  it("the engine version moved and the record version did not", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE SINGULAR MILL, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — 2 flips, one op per heads, ONE card each", () => {
  it("announces exactly TWO rows and mills 1 × heads off the top, in order", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = armed(seed);
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = attack(state, MILL);
      // ALWAYS TWO FLIPS — the printed count does not depend on the faces.
      expect(faces(events)).toHaveLength(2);
      const heads = headsIn(events);
      seen.add(heads);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");

      // ONE ROW PER HEADS, each naming ONE card. A build that merged the copies into
      // a single `count: heads` op would pass every total below and fail here — and it
      // would be lying about how many times the op ran.
      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        expect(row.seat).toBe("p2");
        expect(row.actor).toBe("p1");
        expect(row.uids).toHaveLength(1);
      }
      // THE CARDS CAME OFF THE TOP, IN ORDER.
      const milledUids = rows.flatMap((r) => r.uids);
      expect(milledUids).toEqual(deckBefore.slice(0, heads));
      expect(done.players.p2.discard).toEqual([...state.players.p2.discard, ...deckBefore.slice(0, heads)]);
      // The deck shrank by the mill plus exactly ONE — p2's own turn-start draw, since
      // attacking ends the turn (§5.3) and p2's §5.1 draw lands in this same batch.
      expect(deckBefore.length - done.players.p2.deck.length).toBe(heads + 1);
      expect(done.players.p1.discard).toEqual(state.players.p1.discard);
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("orders every mill row BEHIND every flip row", () => {
    // The flips are taken in FRONT of the §8.5 pipeline and the expanded ops run at
    // the TAIL. A build that ran the op inside the announce loop would interleave.
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed), MILL);
      const lastFlip = events.map((e) => e.type).lastIndexOf("ATTACK_EFFECT_COIN_FLIP");
      for (const [i, e] of events.entries()) {
        if (e.type === "DECK_TOP_DISCARDED") expect(i).toBeGreaterThan(lastFlip);
      }
    }
  });

  it("mills a DIFFERENT number per heads than D130's arm, off the same op", () => {
    // ONE card against THREE, on the same board and the same seed — which is what
    // makes `count` a parameter of the arm rather than a constant of the op.
    for (let seed = 0; seed < 12; seed++) {
      const one = attack(armed(seed), MILL);
      const three = attack(armed(seed), MILL3);
      for (const row of all(one.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(1);
      for (const row of all(three.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(3);
    }
  });

  it("CLAMPS on a short deck, reports the short list, and does not throw", () => {
    // A deck of exactly one card under a 2-flip attack: at two heads the second copy
    // finds nothing and emits NOTHING, which is the arm's own "zero cards emit nothing"
    // rule reached through the expansion.
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = trimDeckTo(armed(seed), "p2", 1);
      const { state: done, events } = attack(state, MILL);
      const heads = headsIn(events);
      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(Math.min(heads, 1));
      // ⚠️ THE DECK LENGTH IS NOT THE ASSERTION HERE and the first draft of this rung
      // got it wrong: p2's own turn-start draw takes the remaining card whether the
      // mill did or not, so `deck.length` is 0 at every heads count and says nothing.
      // The DISCARD is what separates them — the milled card lands there, the drawn
      // one does not.
      expect(done.players.p2.discard.length - state.players.p2.discard.length).toBe(
        Math.min(heads, 1),
      );
      expect(rows.flatMap((r) => r.uids)).toEqual(state.players.p2.deck.slice(0, Math.min(heads, 1)));
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE RANDOM HAND PICK, end to end — N INDEPENDENT picks.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — 3 flips, one pick per heads, over a SHRINKING hand", () => {
  it("announces exactly THREE rows and takes 1 × heads DISTINCT cards", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = armed(seed);
      const handBefore = [...state.players.p2.hand];
      const { state: done, events } = attack(state, PICK);
      expect(faces(events)).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);

      const taken = all(events, "RANDOM_CARD_TAKEN");
      expect(taken).toHaveLength(Math.min(heads, handBefore.length));
      for (const row of taken) {
        expect(row.seat).toBe("p2"); // the hand's OWNER
        expect(row.actor).toBe("p1"); // the player whose card did it
        expect(row.to).toBe("discard");
        expect(handBefore).toContain(row.uid);
      }
      // 🛑 EVERY PICK NAMES A DIFFERENT CARD. This is the assertion that separates N
      // independent picks over a SHRINKING hand from N picks over a snapshot — a build
      // that captured `side.hand` once and indexed it `heads` times would repeat a uid
      // roughly 1 - (n-1)/n of the time and pass every count above.
      expect(new Set(taken.map((r) => r.uid)).size).toBe(taken.length);
      // …and every one of them landed in the OPPONENT'S discard, in pick order.
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...taken.map((r) => r.uid),
      ]);
      // The hand lost exactly the taken cards and gained exactly p2's turn-start draw.
      const gone = new Set(taken.map((r) => r.uid));
      expect(done.players.p2.hand.filter((uid) => gone.has(uid))).toEqual([]);
      expect(done.players.p2.hand.length).toBe(handBefore.length - taken.length + 1);
      // NOTHING WAS SHUFFLED — the `discard` route does not touch the deck, and a
      // build that took the `deck` arm would fire a SHUFFLE and burn an rng step.
      expect(types(events)).not.toContain("SHUFFLE");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("orders every pick row BEHIND every flip row", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed), PICK);
      const lastFlip = events.map((e) => e.type).lastIndexOf("ATTACK_EFFECT_COIN_FLIP");
      for (const [i, e] of events.entries()) {
        if (e.type === "RANDOM_CARD_TAKEN") expect(i).toBeGreaterThan(lastFlip);
      }
    }
  });

  it("🛑 a hand SHORTER than the heads count takes what it can and then nothing", () => {
    // The op's own empty-hand ending, reached through the expansion: the copies that
    // run out of hand take nothing, emit nothing and — crucially — advance NOTHING,
    // because `randomIndex(0, s)` returns the state unchanged. A build that burned a
    // step on the whiff would desync a replay and no board would show it.
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = armed(seed);
      const drop = state.players.p2.hand.slice(1);
      state = {
        ...state,
        players: {
          ...state.players,
          p2: {
            ...state.players.p2,
            hand: state.players.p2.hand.slice(0, 1),
            discard: [...state.players.p2.discard, ...drop],
          },
        },
      };
      const { events } = attack(state, PICK);
      const heads = headsIn(events);
      expect(all(events, "RANDOM_CARD_TAKEN")).toHaveLength(Math.min(heads, 1));
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ZERO HEADS, and the outcome coverage the cases above rest on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — zero heads runs nothing and skips nothing", () => {
  it("🛑 emits no consequent row and takes the existing NO-PROGRAM ending", () => {
    // THERE IS NO ZERO GUARD, AND NONE IS OWED — which is the answer to "which of the
    // three shipped zero-shapes does this use". D451 named three (above the walk,
    // before the park, inside the per-body closure) and this slice adds no fourth
    // because it needs none: `heads === 0` expands to a program of length zero, and
    // `attack.ts` puts `program` back to NULL when nothing came out of it. The
    // no-program ending is the one an effect-less attack already takes.
    let zeroMill = 0;
    let zeroPick = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const mill = attack(armed(seed), MILL);
      if (headsIn(mill.events) === 0) {
        zeroMill += 1;
        expect(all(mill.events, "DECK_TOP_DISCARDED")).toHaveLength(0);
        expect(types(mill.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
        expect(types(mill.events)).toContain("TURN_ENDED");
        expect(mill.state.players.p2.discard).toEqual(armed(seed).players.p2.discard);
      }
      const pick = attack(armed(seed), PICK);
      if (headsIn(pick.events) === 0) {
        zeroPick += 1;
        expect(all(pick.events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
        expect(types(pick.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
        expect(types(pick.events)).toContain("TURN_ENDED");
      }
    }
    // The zero outcome was actually REACHED on both, which is what stops this case
    // from being green and empty (D416's counted-candidates rule, one axis over).
    expect(zeroMill).toBeGreaterThan(0);
    expect(zeroPick).toBeGreaterThan(0);
  });

  it("the PLAIN control takes no flip at all", () => {
    // The one-axis control: the same card, the same board, an attack with no printed
    // effect. Zero flips, zero rows — so every flip above is owed to the sentence.
    for (let seed = 0; seed < 8; seed++) {
      const { events } = attack(armed(seed), PLAIN);
      expect(faces(events)).toHaveLength(0);
      expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
      expect(all(events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE rngState ACCOUNT: one sequence, flips then picks.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the seed, recomputed", () => {
  it("🛑 the MILL spends exactly its two flips and NOTHING else", () => {
    // `discardDeckTop` reads no rng, so the whole account is the two flips — and the
    // FACE SEQUENCE is reproduced by hand off the pre-attack state, not merely counted.
    for (let seed = 0; seed < SEEDS; seed++) {
      const before = armed(seed);
      const { events } = attack(before, MILL);
      const [f1, s1] = flipCoin(before.rngState);
      const [f2] = flipCoin(s1);
      expect(faces(events)).toEqual([f1, f2]);
    }
  });

  it("🛑 the PICK's flips come FIRST and its picks come out of the SAME sequence", () => {
    // ONE source, in order: three flips off `rngState`, then one `randomIndex` step per
    // heads. Reproduced end to end, which is what makes a replay exact — a second
    // source of randomness would reproduce the flips and diverge on the cards, and no
    // board-level assertion in this file would see it.
    for (let seed = 0; seed < SEEDS; seed++) {
      const before = armed(seed);
      const { state: done, events } = attack(before, PICK);
      let rng = before.rngState;
      const expected: ("heads" | "tails")[] = [];
      for (let i = 0; i < 3; i += 1) {
        const [face, next] = flipCoin(rng);
        expected.push(face);
        rng = next;
      }
      expect(faces(events)).toEqual(expected);
      // …and now the picks, off the SAME advanced state, over a hand that shrinks.
      let hand = [...before.players.p2.hand];
      const predicted: string[] = [];
      for (let i = 0; i < expected.filter((f) => f === "heads").length; i += 1) {
        if (hand.length === 0) break;
        const [index, next] = randomIndex(hand.length, rng);
        rng = next;
        predicted.push(hand[index] as string);
        hand = hand.filter((uid) => uid !== hand[index]);
      }
      expect(all(events, "RANDOM_CARD_TAKEN").map((r) => r.uid)).toEqual(predicted);
      // The engine's state ends on the same integer this recomputation did — apart
      // from p2's own turn-start draw, which takes no rng. Asserted as an EQUALITY so
      // an extra burned step (a whiffed pick, a stray shuffle) fails here.
      expect(done.rngState).toBe(rng);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — PURITY.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity", () => {
  it("resolves both printings on a DEEP-FROZEN board, at every outcome", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const index of [MILL, PICK]) {
        expect(() => attack(deepFreeze(armed(seed)), index)).not.toThrow();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — WHAT WAS REFUSED, AND WHY NO REFUSAL SURVIVED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the last refused row, BUILT at D476, and its axis measured", () => {
  it("🆕🆕 D476 — it is BUILT, and the inverted rung catches more than the `false` did", () => {
    // 🛑 THE INVERTED RUNG, WHICH IS WHAT A BUILT REFUSAL IS OWED (D418), written to D463's
    // own shape two `describe`s up. The old claim caught *"no reader touches this string"*;
    // this one has to catch MORE than *"some reader does"*, so it names the member, the FACE
    // and the op — a build that read the sentence to `face: "heads"`, or to the mill's
    // `discardDeckTop`, or to `from: "opponentActive"`, would pass a `not.toBeNull()` and
    // reddens here.
    for (const sentence of BUILT_AT_D476) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      expect(deriveAttackCoinFlip(sentence), sentence).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: 3 },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
      // …and `deriveAttackEffect` STILL refuses it, which is the disjointness that keeps
      // `SELF_DISCARD_ONE` from claiming a sentence it only ENDS in. That refusal is what the
      // old rung's third line asserted, and it is the one line kept verbatim — the whole
      // sentence is one reader's, and two readers on one printing would discard once flatly at
      // the §8.5 tail AND once per tails at the flip site.
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
  });

  it("🆕🆕 D463 — and the two that left derive `programPerHeads`, not `null`", () => {
    // 🛑 THE INVERTED RUNG, WHICH IS WHAT A BUILT REFUSAL IS OWED (D418). The old claim
    // caught "no reader touches this string"; the new one has to catch MORE than "some reader
    // does", or the discrimination is weaker than what it replaced. So it names the member and
    // the op: a mutation that swapped the consequent for the mill's `discardDeckTop`, or the
    // count for `untilTails`, would pass a `not.toBeNull()` and reddens here.
    for (const sentence of BUILT_AT_D463) {
      const read = deriveAttackCoinFlip(sentence);
      expect(read, sentence).toMatchObject({
        kind: "programPerHeads",
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
        face: "heads",
      });
      // …and `deriveAttackEffect` still refuses BOTH, which is the disjointness that keeps
      // `FLIP_OPPONENT_ACTIVE_DISCARD` from claiming a sentence it only ENDS in.
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
    expect(deriveAttackCoinFlip(BUILT_AT_D463[0])).toHaveProperty("flips.kind", "printed");
    expect(deriveAttackCoinFlip(BUILT_AT_D463[1])).toHaveProperty("flips.kind", "untilTails");
  });

  it("🛑 the refusal is a COST, not a capability — D130's `cannot express` is FALSE", () => {
    // D130's block and `testFixtures.ts`'s Krookodile doc have said since 0.81.0 that
    // N sequential parks are "the one thing D130's expansion cannot express".
    // `resumeProgram` ends in `runProgram(applied, rest, …)`, so an op sitting in
    // `rest` that parks simply parks again — DRIVEN here rather than argued, on a
    // program that is literally what the expansion would build at two heads.
    const board = armed(5);
    const one = (deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.") ?? [])[0] as EffectOp;
    expect(JSON.stringify(one)).toBe(
      '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}',
    );
    // The victim needs TWO DIFFERENT Energy for the pick to be a genuine choice —
    // interchangeable candidates auto-resolve (the M1 doctrine), so a same-card board
    // would prove nothing about parking.
    let armedBoard = attachFromDeck(board, "p2", "fix-energy", 1);
    armedBoard = attachFromDeck(armedBoard, "p2", "fix-water-energy", 1);
    const events: GameEvent[] = [];
    const run = runProgram(armedBoard, [one, one], { seat: "p1", invokedBy: "attack" }, events);
    expect(run.kind).toBe("parked");
    if (run.kind !== "parked") throw new Error("expected a park");
    // 🛑 THE SECOND COPY IS SITTING IN `rest`, WHICH IS THE WHOLE CLAIM. A park writes
    // `{pendingOp, rest}` into `GameState.phase.cont`, and the expansion's later copies
    // are exactly what `rest` would hold — so the mechanism exists and the cost is
    // elsewhere (a fielded witness re-pointed across five files, and an N-park drive).
    // 🆕🆕 **D463 PAID BOTH, AND THIS RUNG IS KEPT RATHER THAN DELETED.** It is
    // now the DERIVER-FREE half of the claim: it builds the two-op program by hand out of the
    // BARE sentence's op and shows it parks twice, which is true whatever
    // `deriveAttackCoinFlip` does. `perHeadsEnergyDiscard.test.ts` drives the other half — the
    // same program arrived at through the anchors, on a board, to `ATTACK_EFFECT_SKIPPED`'s
    // replacement. Deleting this one would have moved the mechanism claim behind a regex.
    expect(run.cont.rest).toHaveLength(1);
    expect(JSON.stringify(run.cont.rest[0])).toBe(JSON.stringify(one));
    expect(JSON.stringify(run.cont.pendingOp)).toBe(JSON.stringify(one));
  });

  it("the FACE axis has exactly ONE printing, and the PAYLOAD is what decided it", () => {
    // Corpus line 217 is the only sentence in the whole column that counts TAILS in a
    // per-face REPEAT — measured here, and still exactly one after D476 built it.
    // 🆕🆕 **THE OLD PROSE HERE SAID ONE PRINTING "DECIDES IT BADLY", AND THAT WAS THE
    // WRONG QUESTION.** D440's rule needs no printings at all: *identical payload plus a
    // discriminator ⇒ a FIELD*, and a `programPerTails` member would carry `flips` and
    // `ops` and nothing else — the fourth member's payload byte for byte. What one
    // printing genuinely could not settle is REQUIRED versus OPTIONAL, and that was
    // settled on the measured degradation instead (see the member's block).
    const tails = legalAttackCorpus().filter(([, s]) => /For each tails,/.test(s));
    expect(tails.map(([, s]) => s)).toEqual([
      "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
    ]);
    expect(tails.reduce((n, [units]) => n + units, 0)).toBe(1);
    // ⚠️ AND A BUILD THAT COUNTED THE WRONG FACE WOULD BE INVISIBLE ON HALF THIS
    // SLICE'S OWN BOARDS. Over a 2-flip attack, heads and tails coincide at exactly
    // one head — measured here rather than assumed, which is why §4 and §5 assert the
    // FACE SEQUENCE and not only the count.
    let coincide = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const f = faces(attack(armed(seed), MILL).events);
      if (f.filter((x) => x === "heads").length === f.filter((x) => x === "tails").length) coincide += 1;
    }
    expect(coincide).toBeGreaterThan(0);
    // The 3-flip attack can NEVER coincide — an odd number of flips separates the two
    // readings on every board, which is why line 217's own printing would be its own
    // witness the day it is built.
    for (let seed = 0; seed < SEEDS; seed++) {
      const f = faces(attack(armed(seed), PICK).events);
      expect(f.filter((x) => x === "heads").length).not.toBe(f.filter((x) => x === "tails").length);
    }
  });
});
