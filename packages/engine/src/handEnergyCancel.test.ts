import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  attackCancelHeadRows,
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { BoardCondition, EffectOp } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D420 — §7.5 AT THE ATTACK SEAM: THE HAND-ENERGY COST AND ITS CANCEL, WHICH
// ARE ONE SLICE BECAUSE EITHER ONE ALONE IS WRONG.
//
//   *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
//    opponent's Active Pokémon. If you can't discard 6 cards in this way, this
//    attack does nothing."*                                       **2 printings**
//   *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2
//    cards in this way, this attack does nothing."*                **1 printing**
//   *"Discard a Basic {G} Energy card from your hand. If you can't, this attack
//    does nothing."*                                               **1 printing**
//
// — 3 sentences / 4 legal printings, ONE arm family, transcribed byte-for-byte off
// `censusAttackCorpus.ts` (lines 89, 95 and 96).
//
// 🛑 **THE HAZARD THAT ORDERS THE SLICE.** `payFromHand` inside an ATTACK program
// **pays what it can and refuses nothing** — interpreter.ts's own words at the op,
// *"A SHORT hand … pays what there is"* — and `handCostUnmet` has **no caller in
// attack.ts** (it is the two PLAY paths' gate and only theirs). So the COST WITHOUT
// THE CANCEL is a **FREE KNOCK OUT**: a hand of two Grass discards two and Knocks
// the opponent's Active out anyway, and it passes every "was the cost paid"
// assertion that could be written about it, because the cost WAS paid — just not in
// full. §3's SHORT-BY-ONE boards are the measurement, and the ABSENCE OF DAMAGE is
// what carries them.
//
// 🛑 **AND THE DECISION IS RECORDED WHERE `effects.ts` SAID ONE WAS OWED** (the
// `payFromHand` doc block: an attack-borne cost *"needs a decision"*): **at the
// attack seam an unpayable hand cost is a CANCEL, checked in front of §8.5, never
// inside the program.** §4 is the STRUCTURAL guard behind it — no derived attack
// program may carry a `payFromHand` unless the same printed sentence also yields a
// cancel requirement — and it closes the hazard for the NEXT hand-cost sentence
// rather than only for these four printings.
//
// 🆕🆕 **D473 WAS THAT NEXT SENTENCE, AND IT ARRIVED WITH A SECOND HONEST ANSWER.**
// *"Discard a card from your hand. If you do, draw {N} cards."* (file lines 101/102,
// 1 printing each) prints NO cancel and is still safe, because its whole consequent
// sits behind the §9.2 `recordGate` that reads the payment's own slot: an empty hand
// files an empty slot, `recordGateHolds` returns false, and nothing is bought. §4 now
// admits exactly that shape — `handCostIsSlotGated`, two ops, matching slot, no
// nested payment — and the paying population is **5 sentences / 6 printings**, split
// by WHICH escape each one takes. ⚠️ **THE GUARD DID NOT GET WEAKER**: every case
// D420 could catch, it still catches, because the exemption requires the purchase to
// be conditional on the payment. The one-axis near-misses in §4 are the proof, and
// `D473-arm-drops-the-record-gate` in `mutants.ts` is the receipt.
//
// ⚠️ **WHAT THIS SLICE IS NOT.** It is not `conditionGate` over the payment: a gate
// is a SECOND reading of the affordability question, free to disagree with the
// first, and it resolves at the program tail where the printed damage has already
// been dealt. D125's rule decides it — a derived shape is classified by WHERE IN
// RESOLUTION IT LANDS.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

// ── the printed sentences, verbatim off `censusAttackCorpus.ts` ───────────────

/** `censusAttackCorpus.ts` line **95**, 2 legal printings. */
const KO6 =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.";
/** Line **89**, 1 legal printing. */
const COST2 =
  "Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing.";
/** Line **96**, 1 legal printing — the ANAPHORIC member, and the printing D417
    named, refused and left LOUD by name. */
const COST1 = "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.";

const KO6_HEAD =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.";
const COST2_HEAD = "Discard 2 Basic {G} Energy cards from your hand.";
const COST1_HEAD = "Discard a Basic {G} Energy card from your hand.";

const NAMED_CLAUSE_6 = "If you can't discard 6 cards in this way, this attack does nothing.";
const NAMED_CLAUSE_2 = "If you can't discard 2 cards in this way, this attack does nothing.";
const BARE_CLAUSE = "If you can't, this attack does nothing.";

/** D417's own printing, unchanged by this slice — the CONTROL that says the
    widened anchor took nothing off the member that was already there. */
const ETERNATUS = "Discard a Stadium in play. If you can't, this attack does nothing.";

/** 🆕🆕 **D473 — the two rows that made §4's guard need a SECOND escape.** Corpus
    FILE LINES 101 and 102, 1 legal printing each. They carry a `payFromHand` and no
    cancel clause at all; what makes them honest is the §9.2 `recordGate` on the
    payment's own slot. Transcribed byte-for-byte off `censusAttackCorpus.ts`, and
    §4's partition rung asserts they are exactly the gated half. */
const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";

/** The `payFromHand` the three heads derive, spelled once. */
const pay = (count: number): EffectOp => ({
  op: "payFromHand",
  count,
  to: "discard",
  filter: { kind: "basicEnergy", energyType: "Grass" },
});
/** The `BoardCondition` the three cancels read, spelled once. */
const need = (count: number): BoardCondition => ({
  kind: "yourBasicEnergyInHandAtLeast",
  energy: "Grass",
  count,
});

// ── the local pool (FIXTURE_POOL untouched — D190's idiom, D275's `cardPool`) ──

/** 🛑 `fix-*` KEYS AND NOT THE REAL IDS. The printed EFFECT TEXT is the only thing
    under test and it is transcribed exactly; the scalars around it are a stand-in,
    which a real id would have to justify against `catalogManifest.ts` (D156).

    **EVERY ONE OF THE THREE PRINTS A FLAT 30 AND THE DEFENDER IS `fix-titan`
    (340 HP), WHICH IS THE SUITE'S SHARPEST STRUCTURAL CHOICE.** 30 is not lethal on
    340, so a `KNOCKED_OUT` on these boards can ONLY have come from the op — and 30
    is not zero, so the CANCEL boards assert the absence of a number that would
    otherwise be there. A demonstrator with no printed damage would make §3's cancel
    rungs vacuous (nothing to be absent) and a lethal one would make its KO rung
    ambiguous (two producers for one body). Both halves need the same 30.

    The printed cost is `{G}` and ONE `fix-grass-energy` is ATTACHED to pay it,
    which is a control rather than a convenience: the payment comes out of the HAND,
    so the attached copy must still be there afterwards. A `{C}` cost would have
    made "the right zone was read" unfalsifiable. */
const KO6_ID = "fix-d420-ko6";
const COST2_ID = "fix-d420-cost2";
const COST1_ID = "fix-d420-cost1";
/** ⚠️ THE ACCOUNTING GUARD ON A BOARD, and a CONSTRUCTED sentence rather than a
    printed one: the count **3** is not a row in `ATTACK_CANCEL_HEADS`, so the head
    is unmapped even though arm 6f would read it happily. Delete the guard in
    `splitAttackCancelClause` and this body starts cancelling on a condition no row
    ever answered — which is the widening's own worst case, since the widened
    anchor admits far more strings than the table carries. */
const UNMAPPED_ID = "fix-d420-unmapped";
const UNMAPPED_TEXT =
  "Discard 3 Basic {G} Energy cards from your hand. If you can't discard 3 cards in this way, this attack does nothing.";

const attacker = (id: string, name: string, effect: string): Card =>
  battler(id, {
    name,
    hp: 300,
    retreat: 2,
    types: ["Grass"],
    attacks: [{ cost: ["Grass"], name, damage: 30, effect }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [KO6_ID]: attacker(KO6_ID, "Sixfold Sacrifice", KO6),
  [COST2_ID]: attacker(COST2_ID, "Twofold Cost", COST2),
  [COST1_ID]: attacker(COST1_ID, "Onefold Cost", COST1),
  [UNMAPPED_ID]: attacker(UNMAPPED_ID, "Unmapped Count", UNMAPPED_TEXT),
};

const POOL: Record<string, Card> = deepFreeze({ ...FIXTURE_POOL, ...LOCAL_CARDS });

/** 4+4+4+4+4+16+24 = **60**. `fix-bigbody` is the dominant mulligan-free starter;
    `fix-titan` (340 HP, no attacks, no Rule Box) is the defender on every board.
    **16 `fix-grass-energy`** rather than 8: setup takes 7 to hand and 6 to Prizes
    before a case can reach the deck, and the widest board here needs 6 in hand plus
    1 attached — so the count is what keeps `handFromDeck` from throwing on an
    unlucky shuffle rather than a guess. */
const DECK = deckOf({
  [KO6_ID]: 4,
  [COST2_ID]: 4,
  [COST1_ID]: 4,
  [UNMAPPED_ID]: 4,
  "fix-titan": 4,
  "fix-grass-energy": 16,
  "fix-bigbody": 24,
});

/** THREE SEEDS (D270's rule). No coin is flipped anywhere on this seam — the gate
    is a board read and the payment is a deterministic zone move — so three is the
    family's default rather than five. */
const SEEDS = [5231, 5233, 5237] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `driveSetup`'s script against a LOCAL `cardPool` — that helper hard-codes
    `FIXTURE_POOL`, and D275's rule is that a slice's own bodies stay out of the
    shared pool. P2 goes first on every board, so P1's attack step opens on turn 2
    without a first-turn ban (§4 of the rules, not of this file). */
function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** Setup, then P1's turn 2 with `id` Active, its printed {G} paid by ONE ATTACHED
    `fix-grass-energy`, a 340 HP `fix-titan` opposite, both Benches cleared, and
    P1's hand holding EXACTLY `grass` Basic Grass Energy cards.

    🛑 THE HAND IS NORMALISED IN TWO STEPS AND NOT ONE: every Grass in hand goes
    back to the deck FIRST, then exactly `grass` come out of it. A bare
    `handFromDeck` would ADD to whatever the shuffle already dealt, so the boards
    would differ by seed in the one quantity every assertion in this file turns
    on. */
function board(seed: number, id: string, grass: number): GameState {
  let state = localSetup(seed);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
  state = handToDeck(state, "p1", "fix-grass-energy");
  if (grass > 0) state = handFromDeck(state, "p1", "fix-grass-energy", grass);
  return state;
}

const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const grassIn = (state: GameState, seat: Seat, zone: "hand" | "discard"): number =>
  state.players[seat][zone].filter((uid) => state.cardIdByUid[uid] === "fix-grass-energy").length;

/** The three printings, as a table: the printed sentence, its head, the body that
    prints it, the printed COUNT, and whether the head also Knocks Out. */
const CASES = [
  { name: "KO6", text: KO6, head: KO6_HEAD, id: KO6_ID, count: 6, kos: true },
  { name: "COST2", text: COST2, head: COST2_HEAD, id: COST2_ID, count: 2, kos: false },
  { name: "COST1", text: COST1, head: COST1_HEAD, id: COST1_ID, count: 1, kos: false },
] as const;

describe("§1 — the reader: three sentences, one member, and the anchors that bound it", () => {
  it("🛑 splits each printing and reads it to `yourBasicEnergyInHandAtLeast`", () => {
    // The POSITIVE fact (D125's polarity, unchanged): `attack.ts` cancels when it
    // does NOT hold, so the value is what the attack REQUIRES.
    expect(deriveAttackCancelRequirement(KO6)).toEqual(need(6));
    expect(deriveAttackCancelRequirement(COST2)).toEqual(need(2));
    expect(deriveAttackCancelRequirement(COST1)).toEqual(need(1));
    expect(splitAttackCancelClause(KO6)).toEqual({ head: KO6_HEAD, clause: NAMED_CLAUSE_6 });
    expect(splitAttackCancelClause(COST2)).toEqual({ head: COST2_HEAD, clause: NAMED_CLAUSE_2 });
    expect(splitAttackCancelClause(COST1)).toEqual({ head: COST1_HEAD, clause: BARE_CLAUSE });
    // The clause is a CAPTURE, not a reconstruction: the halves rejoin byte for byte.
    for (const { text, head } of CASES) {
      const split = splitAttackCancelClause(text);
      expect(`${head} ${split?.clause}`).toBe(text);
    }
  });

  it("🛑 derives each HEAD to a `payFromHand`, and the compound to TWO ops in printed order", () => {
    // Program EQUALITY rather than a non-null. An arm that emitted the Knock Out
    // BARE — dropping the payment — satisfies a non-null and Knocks Out for free,
    // which is this slice's whole hazard written as a shape.
    expect(deriveAttackEffect(COST1_HEAD)).toEqual([pay(1)]);
    expect(deriveAttackEffect(COST2_HEAD)).toEqual([pay(2)]);
    expect(deriveAttackEffect(KO6_HEAD)).toEqual([pay(6), { op: "knockOutDefender" }]);
    // 🛑 THE ORDER IS THE ASSERTION. The cost is paid BEFORE the body dies, which is
    // `payFromHand`'s own printed rule ("ORDER IS OBSERVABLE") and is observable on
    // §3's board: the six cards have left the hand when the §8.1 sweep runs.
    expect(deriveAttackEffect(KO6_HEAD)?.[0]).toEqual(pay(6));
  });

  it("🛑 the ENERGY comes from `ENERGY_TYPE_BY_CODE`, not from a bare string", () => {
    // D238's rule. `{G}` resolves to the schema's `"Grass"`; a code the map does not
    // carry is not even admitted by the anchor, so the refusal is the regex's.
    const derived = deriveAttackEffect(COST2_HEAD)?.[0];
    expect(derived).toMatchObject({ filter: { kind: "basicEnergy", energyType: "Grass" } });
    expect(deriveAttackEffect("Discard 2 Basic {Q} Energy cards from your hand.")).toBeNull();
    expect(deriveAttackEffect("Discard 2 Basic Grass Energy cards from your hand.")).toBeNull();
  });

  it("🛑 the ANCHORS: leading text, a missing period, lower case and a plural slip", () => {
    for (const { text, head } of CASES) {
      expect(splitAttackCancelClause(`${text} Then, draw a card.`)).toBeNull();
      expect(splitAttackCancelClause(text.slice(0, -1))).toBeNull();
      expect(splitAttackCancelClause(text.toLowerCase())).toBeNull();
      expect(splitAttackCancelClause(`Flip a coin. ${text}`)).toBeNull();
      expect(deriveAttackEffect(`Flip a coin. ${head}`)).toBeNull();
      expect(deriveAttackEffect(head.slice(0, -1))).toBeNull();
      expect(deriveAttackEffect(head.toLowerCase())).toBeNull();
      // Whitespace is trimmed, which is the one thing that is NOT an anchor.
      expect(splitAttackCancelClause(`  ${text}  `)).not.toBeNull();
    }
    // 🛑 THE NUMBER AND THE NOUN AGREE IN THE ANCHOR. "cards" is plural in the digit
    // branch and singular in the article branch, and the two are a CLOSED
    // alternation rather than an optional "s" — so neither slip derives.
    expect(deriveAttackEffect("Discard 2 Basic {G} Energy card from your hand.")).toBeNull();
    expect(deriveAttackEffect("Discard a Basic {G} Energy cards from your hand.")).toBeNull();
  });

  it("🛑 the APOSTROPHE CLASS is live on BOTH the clause and the compound head", () => {
    // D136/D137 — "can't" is a contraction and "opponent's" a possessive, and two
    // slices lost time to an anchor spelling only U+0027. The pool holds zero U+2019
    // today, so this guards a re-ingest rather than a live printing.
    const curly = KO6.replaceAll("can't", "can’t").replaceAll("opponent's", "opponent’s");
    expect(curly).not.toBe(KO6);
    // The CLAUSE folds through the anchor's own `['’]` class…
    expect(deriveAttackCancelRequirement(curly)).toEqual(need(6));
    // …and the HEAD's possessive folds through `literalClauseRow`'s U+2019 retry,
    // which is the first row in this table that fold has ever been live on (D417's
    // key spells no apostrophe at all and said so).
    expect(splitAttackCancelClause(curly)?.head).toBe(KO6_HEAD.replace("opponent's", "opponent’s"));
    expect(deriveAttackEffect(KO6_HEAD.replace("opponent's", "opponent’s"))).toEqual([
      pay(6),
      { op: "knockOutDefender" },
    ]);
  });

  it("🛑 the TABLE still refuses an unmapped head — the guard the widening leans on", () => {
    // The widened anchor admits FAR more strings than the table carries, so the
    // accounting guard is doing more work after this slice than before it. A count
    // the table does not carry is refused whole, even though arm 6f reads its head.
    expect(deriveAttackEffect("Discard 3 Basic {G} Energy cards from your hand.")).toEqual([
      pay(3),
    ]);
    expect(splitAttackCancelClause(UNMAPPED_TEXT)).toBeNull();
    expect(deriveAttackCancelRequirement(UNMAPPED_TEXT)).toBeNull();
    expect(deriveAttackEffect(UNMAPPED_TEXT)).toBeNull();
    // …and a head no reader claims at all, behind a named-referent clause.
    expect(
      splitAttackCancelClause(`Discard your hand. ${NAMED_CLAUSE_6}`),
    ).toBeNull();
  });

  it("🛑 the EXCLUSIONS are the anchor's shape, not a comment", () => {
    // *"If you can't discard any, …"* — its only head in the pool is the Pokémon
    // Tool sentence, priced and refused four times on the pre-damage seam. Admitting
    // it would buy a split whose head no reader claims: a census step with no
    // behaviour (D407's "built but dead").
    expect(
      splitAttackCancelClause(`${COST2_HEAD} If you can't discard any, this attack does nothing.`),
    ).toBeNull();
    // A non-numeric quantity, and the plural noun the alternation fixes.
    expect(
      splitAttackCancelClause(`${COST2_HEAD} If you can't discard two cards in this way, this attack does nothing.`),
    ).toBeNull();
    expect(
      splitAttackCancelClause(`${COST2_HEAD} If you can't discard 2 card in this way, this attack does nothing.`),
    ).toBeNull();
  });

  it("🛑 D417's printing is untouched, and the two requirement readers stay disjoint", () => {
    expect(deriveAttackCancelRequirement(ETERNATUS)).toEqual({ kind: "stadiumInPlay" });
    expect(splitAttackCancelClause(ETERNATUS)).toEqual({
      head: "Discard a Stadium in play.",
      clause: BARE_CLAUSE,
    });
    // The `^If`-leading reader refuses all three, which is what keeps `attack.ts`'s
    // `leadingRequirement ?? cancelRequirement` a JOIN rather than a precedence.
    for (const { text } of CASES) {
      expect(deriveAttackRequirement(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("🛑 the `\", and \"` JOIN is unreachable by the trailing splitter — the reason 6g is ONE arm", () => {
    // `splitAttackTrailingClause` breaks on a SENTENCE boundary; the compound's two
    // halves are joined by a comma inside one sentence. So the composition path
    // cannot hand the Knock Out to a second reader and the compound must be claimed
    // whole. Asserted rather than argued, because "we could have composed it" is the
    // cheaper-looking build.
    expect(splitAttackTrailingClause(KO6_HEAD)).toBeNull();
    expect(deriveAttackEffect("Knock Out your opponent's Active Pokémon.")).toBeNull();
    // …and the CONVERSE, so the boundary is doing the work rather than the shape:
    // spell the same two halves as two SENTENCES and the splitter takes it.
    const twoSentences = `${COST2_HEAD} Discard 3 Energy from this Pokémon.`;
    expect(splitAttackTrailingClause(twoSentences)).toEqual({
      head: COST2_HEAD,
      tail: "Discard 3 Energy from this Pokémon.",
    });
  });

  it("🛑 the MEMBER: `matchesFilter`'s predicate over the OWN hand, and its note", () => {
    // The note spells the printed NAME rather than the brace code (D118), and the
    // singular branch is a PRINTED case — the pool prints "a Basic {G} Energy card".
    expect(conditionNote(need(6))).toBe("you have at least 6 Basic Grass Energy cards in your hand");
    expect(conditionNote(need(1))).toBe("you have a Basic Grass Energy card in your hand");
    // …so it does NOT round-trip to the printed head, which is asserted rather than
    // left to be "fixed" by a successor: the table is keyed on an IMPERATIVE
    // sentence, this is a CONDITION clause, and the two are different sentences.
    expect(conditionNote(need(1))).not.toBe(COST1_HEAD);
  });
});

describe("§2 — the guard the widening owes: the row's DIGIT is the row's COUNT", () => {
  it("🛑🛑 over EVERY row of `ATTACK_CANCEL_HEADS`, the printed count and the value agree", () => {
    // 🛑 THE TABLE IS READ THROUGH `attackCancelHeadRows()` RATHER THAN TRANSCRIBED.
    // A copy here would be a second table free to drift from the first, which is the
    // defect this rung exists to prevent one level down.
    const rows = attackCancelHeadRows();
    expect(rows.length).toBe(4);
    // FORWARD — every value carrying a `count` has a key whose printed cardinality
    // is that same number, with the article "a" reading as 1.
    const counted = rows.filter(([, cond]) => "count" in cond);
    expect(counted.length).toBe(3);
    for (const [key, cond] of counted) {
      const printed = /^Discard (\d+|a) /.exec(key)?.[1];
      const value = printed === "a" ? 1 : Number(printed);
      expect([key, value]).toEqual([key, (cond as { count: number }).count]);
    }
    // CONVERSE — every key carrying a DIGIT has a value with a `count`, and every
    // digit in that key is that count. (A key that named two different numbers would
    // pass the forward leg on its first one.)
    for (const [key, cond] of rows) {
      const digits = key.match(/\d+/g) ?? [];
      if (digits.length === 0) continue;
      expect(["count" in cond, key]).toEqual([true, key]);
      expect([key, [...new Set(digits)]]).toEqual([
        key,
        [String((cond as { count: number }).count)],
      ]);
    }
    // 🛑 AND THE ROW WITHOUT A COUNT IS NAMED, so "3 of 4" is a partition rather
    // than an arithmetic coincidence: D417's Stadium row prints no cardinality and
    // its member carries none.
    expect(rows.filter(([, cond]) => !("count" in cond)).map(([key]) => key)).toEqual([
      "Discard a Stadium in play.",
    ]);
  });

  it("🛑 the CLAUSE's restated digit equals the requirement it produces, over the corpus", () => {
    // The widened anchor admits a clause that RESTATES the count, and the restatement
    // is the one thing that could disagree with the head. The table cannot see the
    // clause at all — it is keyed on the head — so this is the leg the table-shaped
    // guard above cannot cover, and it runs over the printed column rather than over
    // constructed strings.
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    let restated = 0;
    for (const [, s] of claimed) {
      const clause = splitAttackCancelClause(s)?.clause ?? "";
      const digit = /discard (\d+) cards in this way/.exec(clause)?.[1];
      if (digit === undefined) continue;
      restated += 1;
      const cond = deriveAttackCancelRequirement(s);
      expect([s, Number(digit)]).toEqual([s, (cond as { count: number }).count]);
    }
    // Non-vacuous: two of the four printings restate their count.
    expect(restated).toBe(2);
  });
});

describe("§3 — REAL BOARDS: the cancel fires, the payable case pays, and 30 is the proof", () => {
  it.each(
    SEEDS.flatMap((seed) => CASES.map((c) => [seed, c.name, c.id, c.count] as const)),
  )(
    "seed %i — %s SHORT BY ONE: the attack does NOTHING and the cost is NOT paid",
    (seed, _name, id, count) => {
      // 🛑 SHORT BY ONE AND NOT EMPTY, WHICH IS THE WHOLE POINT. An empty hand would
      // be cancelled by an engine that never learned to pay at all; a hand one card
      // short is a hand `payFromHand` WOULD HAPPILY DRAIN — it pays what there is —
      // so this board separates the cancel from the payment.
      const before = board(seed, id, count - 1);
      expect(grassIn(before, "p1", "hand")).toBe(count - 1);
      const uid = before.players.p1.active?.stack[0];
      if (uid === undefined) throw new Error("expected P1's Active");
      const discardBefore = before.players.p1.discard.length;

      const result = attack(before);
      const state = result.state;

      expect(find(result.events, "ATTACK_FAILED")).toEqual({
        type: "ATTACK_FAILED",
        seat: "p1",
        uid,
        reason: "requirement",
      });
      // 🛑🛑 **THE ABSENCE OF DAMAGE IS THE LOAD-BEARING ASSERTION.** A build that
      // gated the payment INSIDE the program would deal this attack's printed 30
      // first and then decline to pay, and would be green on every other line here.
      expect(types(result.events)).not.toContain("DAMAGE_DEALT");
      expect(types(result.events)).not.toContain("COUNTERS_PLACED");
      expect(types(result.events)).not.toContain("KNOCKED_OUT");
      expect(state.players.p2.active?.damage).toBe(0);
      // …and NOTHING WAS PAID: the short hand is intact, the discard did not grow.
      expect(types(result.events)).not.toContain("HAND_COST_PAID");
      expect(grassIn(state, "p1", "hand")).toBe(count - 1);
      expect(grassIn(state, "p1", "discard")).toBe(0);
      expect(state.players.p1.discard).toHaveLength(discardBefore);
      expect(state.phase.kind).not.toBe("effect:choose");
      // The sentence was SIMULATED — a cancelled attack is not a skipped effect.
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // 🛑 THE TURN STILL ENDS. A cancelled attack is an attack that was USED.
      expect(types(result.events)).toContain("TURN_ENDED");
      expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    },
  );

  it.each(
    SEEDS.flatMap((seed) => CASES.map((c) => [seed, c.name, c.id, c.count, c.kos] as const)),
  )(
    "seed %i — %s EXACTLY PAYABLE: the cost is paid out of the HAND and the head resolves",
    (seed, _name, id, count, kos) => {
      const before = board(seed, id, count);
      expect(grassIn(before, "p1", "hand")).toBe(count);
      // The attacker's printed {G} is paid by an ATTACHED copy — a different zone.
      expect(before.players.p1.active?.energy).toHaveLength(1);

      const result = attack(before);
      const state = result.state;

      expect(types(result.events)).not.toContain("ATTACK_FAILED");
      expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(30);
      // 🛑 THE PAYMENT IS EXACT AND IT COMES OUT OF THE HAND. `count` cards land in
      // the discard, the hand keeps none, and the ATTACHED copy is untouched — which
      // is what says the member and the op read the ZONE the sentence prints.
      expect(find(result.events, "HAND_COST_PAID")?.uids).toHaveLength(count);
      expect(find(result.events, "HAND_COST_PAID")?.to).toBe("discard");
      expect(grassIn(state, "p1", "hand")).toBe(0);
      expect(grassIn(state, "p1", "discard")).toBe(count);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      // The payment resolves INLINE — `count` interchangeable cards is no decision.
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // 🛑 THE KNOCK OUT COMES FROM THE OP AND NOT FROM THE DAMAGE — 30 on a 340 HP
      // body is not lethal, so the compound's `KNOCKED_OUT` has exactly one producer
      // and the two cost-only printings must produce none.
      expect(types(result.events).includes("KNOCKED_OUT")).toBe(kos);
      if (!kos) expect(state.players.p2.active?.damage).toBe(30);
      // …and the ORDER is the printed one: pay, then hit, then Knock Out.
      const order = types(result.events);
      expect(order.indexOf("HAND_COST_PAID")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
      if (kos) expect(order.indexOf("HAND_COST_PAID")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    },
  );

  it.each(SEEDS)(
    "seed %i — a SURPLUS hand pays exactly the printed count and asks nothing",
    (seed) => {
      // 8 in hand against a printed 6: `handCostCandidates` collapses interchangeable
      // copies to `count`, so there is no decision and the park is never reached.
      const result = attack(board(seed, KO6_ID, 8));
      expect(find(result.events, "HAND_COST_PAID")?.uids).toHaveLength(6);
      expect(grassIn(result.state, "p1", "hand")).toBe(2);
      expect(grassIn(result.state, "p1", "discard")).toBe(6);
      expect(result.state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).toContain("KNOCKED_OUT");
    },
  );

  it.each(SEEDS)("seed %i — the CONTROL: an UNMAPPED count stays LOUD and is NOT gated", (seed) => {
    // The accounting guard on a board. This body's head is one arm 6f reads, but its
    // COUNT is not a row — so no split fires, no requirement is read, the WHOLE
    // printed string is reported, nothing is paid, and the attack is NOT cancelled on
    // a hand that cannot afford it. Delete the guard and this rung reddens twice.
    const result = attack(board(seed, UNMAPPED_ID, 0));
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(types(result.events)).not.toContain("HAND_COST_PAID");
    expect(find(result.events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({ effect: UNMAPPED_TEXT });
    expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it.each(SEEDS)("seed %i — the MEMBER, read off the same board it gates", (seed) => {
    // `conditionHolds` on the real hand, both sides of the threshold — so the gate's
    // answer is a board fact rather than an inference from the events above.
    const short = board(seed, KO6_ID, 5);
    const exact = board(seed, KO6_ID, 6);
    expect(conditionHolds(short, "p1", need(6))).toBe(false);
    expect(conditionHolds(exact, "p1", need(6))).toBe(true);
    // 🛑 THE ATTACHED COPY DOES NOT COUNT, which is the zone claim in one line: both
    // boards carry one Grass ATTACHED, and the short one is still short.
    expect(short.players.p1.active?.energy).toHaveLength(1);
    // 🛑 AND IT IS THE VIEWER'S OWN HAND: P2 holds its own Grass and answers for
    // itself, so nothing here reads across the table.
    expect(conditionHolds(short, "p2", need(6))).toBe(false);
    // The wrong TYPE does not pay either — the printed noun is a card CLASS plus a
    // printed type, and `matchesFilter` is what enforces both.
    expect(conditionHolds(exact, "p1", { kind: "yourBasicEnergyInHandAtLeast", energy: "Fire", count: 1 })).toBe(false);
  });
});

describe("§4 — THE STRUCTURAL GUARD: a hand cost in an attack program owes a cancel", () => {
  /** `attack.ts`'s stripper chain, in the site's order, followed by the same
      composition it does — so this is the program the SEAM derives and not the
      program a single reader would. */
  function programOf(text: string): readonly EffectOp[] | null {
    const gated = splitAttackGateClause(text)?.body ?? text;
    const required = splitAttackRequirementClause(gated)?.body ?? gated;
    const uncancelled = splitAttackCancelClause(required)?.head ?? required;
    const compound = splitAttackTrailingClause(uncancelled);
    const head = compound === null ? uncancelled : compound.head;
    const derivedHead = head === "" ? null : deriveAttackEffect(head);
    const derivedTail = compound === null ? null : deriveAttackEffect(compound.tail);
    if (derivedTail === null) return derivedHead;
    return [...(derivedHead ?? []), ...derivedTail];
  }

  /** Does this program carry a `payFromHand` ANYWHERE — including inside a gate's
      `then`/`otherwise`? A top-level scan would be green the day someone wraps the
      payment in a `conditionGate`, which is precisely the build this guard exists
      to forbid. */
  function carriesHandCost(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(carriesHandCost);
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    if (record.op === "payFromHand") return true;
    return Object.values(record).some(carriesHandCost);
  }

  /** 🆕🆕 **D473 — THE SECOND WAY AN ATTACK-BORNE HAND COST CAN BE HONEST, AND IT IS
      A NARROW EXEMPTION RATHER THAN A RELAXATION.**

      D420's guard below forbids a `payFromHand` whose sentence prints no cancel,
      because the payment *"pays what there is"* and the effect it buys then resolves
      on a price the engine never collected. That reasoning is about what happens
      AFTER a SHORT payment — and it is only true when something after the payment
      runs regardless.

      D473's sentence (*"Discard a card from your hand. If you do, draw {N} cards."*,
      2 printings) prints no cancel and is nonetheless safe, because the ONLY thing
      after the payment is the §9.2 gate that reads the payment's own slot: an empty
      hand files an empty slot and `recordGateHolds` answers **false**, so the draw
      does not happen. Nothing is bought at all when nothing is paid.

      🛑 **THE PREDICATE IS AS TIGHT AS THE PRINTED SHAPE AND NOT ONE BYTE LOOSER**
      — exactly two ops, the gate's `slot` equal to the payment's `recordAs`, and no
      further payment nested inside the gate. Everything a future card might print
      that is merely *similar* (a bare op after the gate, a gate on a different slot,
      a payment with no `recordAs` at all) still lands in `offenders` and still
      forces a decision, which is what D420 built this guard to do. **A narrow
      exemption makes the claim narrower, never false** (D419/D434).

      ⚠️ **AND THE OLD DISCRIMINATION SURVIVES INTACT (D418's second half).** What
      D420's rung could catch is *"a derived attack program pays a hand cost and buys
      something anyway"*; this rung still catches every instance of that, because the
      exemption requires the purchase to be gated on the payment. `mutants.ts` carries
      the receipt: `D473-arm-drops-the-record-gate` deletes the gate from the arm and
      is KILLED **here**, not in D473's own suite. */
  function handCostIsSlotGated(program: readonly EffectOp[] | null): boolean {
    if (program === null || program.length !== 2) return false;
    const [cost, gate] = program;
    if (cost === undefined || gate === undefined) return false;
    if (cost.op !== "payFromHand" || cost.recordAs === undefined) return false;
    if (gate.op !== "recordGate" || gate.slot !== cost.recordAs) return false;
    // A payment nested inside the branch is a SECOND cost, and the gate says nothing
    // about it — `handCostUnmet`'s own "not compositional" scope note, one seam over.
    return !carriesHandCost(gate);
  }

  it("🛑🛑 NO derived attack program carries a `payFromHand` without a CANCEL or a SLOT GATE", () => {
    // 🛑 THE DECISION `effects.ts` SAID WAS OWED, AS A STRUCTURE RATHER THAN A
    // PARAGRAPH. `payFromHand` in an attack pays what it can and refuses nothing, and
    // `handCostUnmet` has no caller in `attack.ts` — so a hand cost with no cancel in
    // front of §8.5 is an effect bought at a price the engine never collects. This
    // walks the WHOLE legal attack column and forbids the shape.
    //
    // 🆕 D473 — the second escape, priced in `handCostIsSlotGated` above: a payment
    // whose whole consequent sits behind a `recordGate` on the slot it files buys
    // NOTHING when it pays nothing, so the hazard cannot arise.
    const offenders: string[] = [];
    for (const [n, text] of corpus()) {
      const program = programOf(text);
      if (!carriesHandCost(program)) continue;
      if (deriveAttackCancelRequirement(text) !== null) continue;
      if (handCostIsSlotGated(program)) continue;
      offenders.push(`(${n}) ${text}`);
    }
    // Named rather than summed: the day this fires the message is the sentence.
    expect(offenders).toEqual([]);
  });

  it("🛑 the guard is NOT VACUOUS — it is measured over 5 sentences / 6 printings, split by WHICH escape", () => {
    const paying = corpus().filter(([, text]) => carriesHandCost(programOf(text)));
    // 🆕 D473 +2 sentences / +2 printings — the two `If you do, draw {N} cards.` rows.
    expect([paying.length, units(paying)]).toEqual([5, 6]);
    expect(paying.map(([, s]) => s).sort()).toEqual([KO6, COST2, COST1, DRAW2, DRAW3].sort());
    // 🆕 D473 — SPLIT BY REASON rather than counted together (D463: a grouped claim
    // takes its reason from its cheapest member and its cost from its dearest). Each
    // paying sentence takes EXACTLY ONE of the two escapes, and the partition is
    // asserted in both directions so a sentence that took neither — or somehow both —
    // reddens here rather than in the offenders list alone.
    const cancelled = paying.filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    const gated = paying.filter(([, s]) => handCostIsSlotGated(programOf(s)));
    expect(cancelled.map(([, s]) => s).sort()).toEqual([KO6, COST2, COST1].sort());
    expect(gated.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
    expect(cancelled.length + gated.length).toBe(paying.length);
    for (const [, s] of cancelled) expect(handCostIsSlotGated(programOf(s)), s).toBe(false);
    for (const [, s] of gated) expect(deriveAttackCancelRequirement(s), s).toBeNull();
  });

  it("🛑 the SLOT GATE exemption is not a hole — four near-misses on one axis each are still offenders", () => {
    // D427's one-axis rule applied to a predicate rather than to a sentence: each of
    // these differs from the admitted shape in exactly ONE way, and each must be
    // refused, or the exemption would be the relaxation its doc block says it is not.
    const admitted = deriveAttackEffect(DRAW2);
    expect(handCostIsSlotGated(admitted)).toBe(true);
    // (a) the payment files nothing, so the gate can never hold — a silent whiff
    //     wearing a gated sentence's shape.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
      ]),
    ).toBe(false);
    // (b) the gate reads a DIFFERENT slot — it fires off some other op's filing, so
    //     the draw is not gated on this payment at all.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 2 }] },
      ]),
    ).toBe(false);
    // (c) an UNGATED op after the gate — the exact D420 hazard, bought free.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
        { op: "knockOutDefender" },
      ]),
    ).toBe(false);
    // (d) a SECOND payment nested in the branch — the gate answers for the first
    //     cost and says nothing whatever about the second.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        {
          op: "recordGate",
          slot: "paid",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [pay(6), { op: "knockOutDefender" }],
        },
      ]),
    ).toBe(false);
  });

  it("🛑 the DEEP walk really is deep — a wrapped payment is still found", () => {
    // The negative control for `carriesHandCost`. A top-level scan (the shape
    // `handCostUnmet` itself uses, and for its own stated reason) answers FALSE here,
    // so the guard would sail past the exact build it forbids.
    const wrapped: EffectOp[] = [
      {
        op: "conditionGate",
        cond: need(2),
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [pay(2)],
      },
    ];
    expect(carriesHandCost(wrapped)).toBe(true);
    expect(wrapped.some((op) => op.op === "payFromHand")).toBe(false);
    // …and it does not answer TRUE for everything, which is the other half.
    expect(carriesHandCost([{ op: "knockOutDefender" }])).toBe(false);
    expect(carriesHandCost(null)).toBe(false);
  });
});

describe("§5 — the whole legal column: what this slice claims, and what it does not", () => {
  it("🛑 the cancel reader claims 4 sentences / 5 printings, and names all four", () => {
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect([claimed.length, units(claimed)]).toEqual([4, 5]);
    expect(claimed.map(([, s]) => s).sort()).toEqual([ETERNATUS, KO6, COST2, COST1].sort());
  });

  it("🛑 the ANAPHORIC family is now claimed WHOLE, and the anti-saturation rung", () => {
    // D417 left one of the two anaphoric printings unclaimed and asserted it by name;
    // this slice takes it. The rung is kept and INVERTED rather than deleted, so
    // "the family is complete" is a measurement.
    const anaphoric = corpus().filter(([, s]) => s.endsWith(BARE_CLAUSE));
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    for (const [, s] of anaphoric) expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
    // 🛑 THE ANTI-SATURATION RUNG (D379's trap). A reader that answered everything
    // would satisfy every line above. Two near misses are asserted UNCLAIMED by name:
    // the Tool sentence's *"If you can't discard any"* shape and a count no row
    // carries.
    expect(deriveAttackCancelRequirement(UNMAPPED_TEXT)).toBeNull();
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null).length;
    expect(claimed).toBeLessThan(corpus().length);
  });

  it("🛑 the two requirement readers are STILL mutually exclusive over all 1,732 units", () => {
    const all = corpus();
    expect(all.length).toBe(640);
    expect(units(all)).toBe(1732);
    const both = all.filter(
      ([, s]) => deriveAttackRequirement(s) !== null && deriveAttackCancelRequirement(s) !== null,
    );
    expect([both.length, units(both)]).toEqual([0, 0]);
    // …and the leading reader is unmoved by the widening, which is the control that
    // says the two anchors did not start overlapping.
    const leading = all.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([leading.length, units(leading)]).toEqual([9, 18]);
  });
});
