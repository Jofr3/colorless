import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  basicEnergy,
  deckOf,
  itemTrainer,
} from "./testFixtures";
import { makeInPlay } from "./types";

// 0.401.0 → 0.402.0 — 🆕🆕🆕 D515: THE THIRD MEMBER OF D473's FAMILY, AND THE BLOCKER
// WAS THE DESCRIBER RATHER THAN THE ANCHOR.
//
// ── THE PRINTED SENTENCE ─────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 103 — "Discard a card from your hand. If you
//     do, your opponent discards a card from their hand."          **1 printing**
//
// 🛑 **D473 MEASURED THIS ROW, NAMED ITS BLOCKER IN WRITING, AND LEFT IT — AND THE
// BLOCKER IT NAMED WAS THE RIGHT ONE.** `HAND_COST_THEN_DRAW`'s doc block records
// D472's whole-corpus measurement: widening that anchor's consequent to `(.+)` claims
// exactly this row and no other, *"whose consequent is a different op that
// `describeBranch` has no phrase for, so the park's caption would silently degrade to
// the bare cost while the sentence read as claimed."* §5 DRIVES that degradation on a
// hand-built program instead of quoting it — D446's rule, a predicted SHAPE is not the
// measurement that predicted it — and the measured caption of the ungated payment and
// of the un-described gate are **the same bytes**, which is why the loss is silent.
//
// 🛑 **SO THE WHOLE PRICE IS ONE ANCHOR, ONE ARM AND ONE `describeBranch` CASE.** The
// three ops were all shipped and all composed before: `payFromHand` (the only op that
// removes a CHOSEN card from the controller's own hand), `recordGate` (§9.2's
// op-result branch, Miriam/Dendra/Kofu since D148) and `opponentDiscardsFromHand`,
// which `deriveAttackEffect`'s own OPPONENT-CHOOSES arm has produced since D426 and
// D486's gated increment produces under a `conditionGate`. **ZERO** new `EffectOp`
// members, op FIELDS, op VALUES, prompts, prompt fields, choice kinds, events, error
// codes, `BoardCondition`/`CardFilter` members, clause-table rows, registry rows,
// `packages/schema` bytes, `redact.ts` bytes or `FIXTURE_POOL` ids. The reader surface
// stays 13.
//
// ── 🛑 THE BOARD IS THE ONE THING THAT IS GENUINELY NEW ──────────────────────
// This is a derived ATTACK program that can park TWICE, for TWO DIFFERENT SEATS, with
// the second park behind a §9.2 gate on the first one's filing: the controller picks
// which card to pay, and then — only if they paid — the OPPONENT picks which card to
// discard, because `opponentDiscardsFromHand` sets `decider: owner`. §4 measures that
// the column contains exactly ONE such program (this one) rather than claiming a
// FIRST (D452: a refusal that names a first has an expiry date), and drives both
// parks end to end.
//
// ── WHY THE CONSEQUENT'S COUNT IS SPELLED OUT AND NOT CAPTURED ───────────────
// The sibling anchor captures `(\d+)` because the column prints 2 and 3 on one
// skeleton. Here the GATED form is printed once, at "a card" — §1 measures the
// alternation `(a card|\d+ cards)` over all 640 rows and it claims the identical 1
// sentence / 1 printing, so the capture would buy nothing and ship a group no printing
// can falsify (D231). ⚠️ **THAT IS A NARROWING, AND THE LATTICE PRICES IT**: the COUNT
// axis moves from 0 of 8 to 1 of 8 in the flip table across this slice (D513), so the
// slice owes one *"printed zero times"* measurement and §1 pays it.
//
// ── THE LATTICE, BOTH SIDES AND BOTH PREDICATES (D489/D503/D505) ─────────────
// OPENER × GATE × CONSEQUENT × COUNT, 16 distinct strings, run over the RESIDUE
// PREDICATE (`resolvedByAnyReader` + `REGISTRY_ATTACKS` + both splitters) and over the
// readers alone:
//
//   builds()      PRE  0/1 · 1/4 · 2/6 · 2/4 · 1/1 = 6/16   flips  6 · 6 · 2 · 0
//                 POST 1/1 · 1/4 · 2/6 · 2/4 · 1/1 = 7/16   flips  7 · 7 · 1 · 1
//   readers only  PRE  0/1 · 1/4 · 1/6 · 0/4 · 0/1 = 2/16   flips  2 · 2 · 2 · 0
//                 POST 1/1 · 1/4 · 1/6 · 0/4 · 0/1 = 3/16   flips  3 · 3 · 1 · 1
//
// 🛑 THE TWO READINGS DISAGREE AT **4 OF 16 POINTS** — D503's finding, paying out
// again: every one of the four is an OPENER-substituted, gate-less point that
// `splitAttackTrailingClause` composes out of a claimed head and a claimed tail, and
// the arm this slice writes touches none of them. The subtraction is keyed on the
// derived VALUE and not on the anchor (D505): the arm claims **exactly one** of the 16
// points, asserted in both directions in §1.
//
// 🆕 AND THE SHAPE CHANGES ACROSS THE SLICE IN BOTH DIRECTIONS AT ONCE (D513/D514).
// CONSEQ moves 2 → 1 (the widening retires a cell) while COUNT moves 0 → 1 (the
// narrowing creates one). No axis is DEGENERATE — all 16 points are distinct strings,
// asserted — and no axis is inert either.

/** THE SENTENCE, byte for byte off `legalAttackCorpus()` — §1 asserts that. */
const GATED_DISCARD =
  "Discard a card from your hand. If you do, your opponent discards a card from their hand.";

/** The two rows the same anchor family already claims (D473, file lines 101/102) and
    the two STANDALONE opponent-hand discards D426 claims (file lines 614/615). They
    are the positive controls: the mechanism on both ends of this sentence already
    shipped, and §1 drives that rather than asserting it in a comment. */
const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";
const BARE_ONE = "Your opponent discards a card from their hand.";
const BARE_TWO = "Your opponent discards 2 cards from their hand.";

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not by the one reader it is about.
    ⚠️ SPLICED BEFORE THE LAST ENTRY RATHER THAN APPENDED where it ever grows, D419's
    rule — mutant `find` strings quote an array's last entries plus its closing `];`. */
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
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The PROGRAM, spelled once so no case can pass against a hand-copied literal that
    has drifted from what this file means by it. */
const program = (discarded: number): EffectOp[] => [
  { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
  { op: "recordGate", slot: "paid", then: [{ op: "opponentDiscardsFromHand", count: discarded }] },
];

describe("D515 §1 — the sentence, measured live over the legal column", () => {
  it("🛑 the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    // D417/D419's guard: a hand-kept copy of a module-derived surface cannot go red,
    // it can only go quiet, so the DIFF and the COUNT are pinned separately.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("the row is really in the column, ONCE, at ONE printing — and so are its four controls", () => {
    // The attribution control (D183/D456): without it every rung below could be green
    // against a paraphrase no card prints.
    for (const [text, printings] of [
      [GATED_DISCARD, 1],
      [DRAW2, 1],
      [DRAW3, 1],
      [BARE_ONE, 2],
      [BARE_TWO, 4],
    ] as const) {
      const rows = legalAttackCorpus().filter(([, s]) => s === text);
      expect([rows.length, units(rows)], text).toEqual([1, printings]);
    }
  });

  it("🛑 the ANCHOR's whole reach is 1 sentence / 1 printing, measured", () => {
    const anchored = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards a card from their hand\.$/.test(
        s,
      ),
    );
    expect([anchored.length, units(anchored)]).toEqual([1, 1]);
    expect(anchored.map(([, s]) => s)).toEqual([GATED_DISCARD]);
  });

  it("🛑 CAPTURING THE COUNT would claim the IDENTICAL row, so the group is pure RISK", () => {
    // D472's rule, run rather than described, and it is the OPPOSITE answer from the
    // sibling anchor's: there the column prints two counts on one skeleton and the
    // capture is warranted (D121); here it prints one, so a group would be a token no
    // printing can falsify (D231's unkillable singleton).
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards (?:a card|\d+ cards) from their hand\.$/.test(
        s,
      ),
    );
    expect([wide.length, units(wide)]).toEqual([1, 1]);
    expect(wide.map(([, s]) => s)).toEqual([GATED_DISCARD]);
  });

  it("🛑 THE *PRINTED ZERO TIMES* MEASUREMENT THE FLIP TABLE OWES — the gated PLURAL", () => {
    // 🛑 D513/D514's rule, paid rather than argued. This slice NARROWS: it spells the
    // consequent's count out instead of capturing it, and the lattice records the price
    // as the COUNT axis moving from 0 of 8 to 1 of 8. An axis that flips anywhere is a
    // LITERAL the anchor carries, and every such literal owes the measurement below.
    // ⚠️ Unlike D514's, this axis is INSIDE the axis set, so the instrument prices it
    // directly and the measurement is a confirmation rather than a substitute.
    const gatedPlural = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards \d+ cards from their hand\.$/.test(
        s,
      ),
    );
    expect(gatedPlural).toEqual([]);
    // …and the plural is not UNEXPRESSIBLE, only unprinted HERE: the STANDALONE form
    // prints it four times and D426's arm reads it. Without this half the rung above
    // would read as "the engine cannot do two", which is false.
    expect(deriveAttackEffect(BARE_TWO)).toEqual([{ op: "opponentDiscardsFromHand", count: 2 }]);
  });

  it("🛑 `deriveAttackEffect` is its ONLY reader — the other TWELVE refuse it", () => {
    expect(deriveAttackEffect(GATED_DISCARD)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(GATED_DISCARD), read.name).toBeNull();
    }
    // …and no splitter composes it either, so the whole-sentence anchor is the only
    // route in and the RAW and RESIDUE summands move together (D444/D457).
    expect(splitAttackGateClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackRequirementClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackCancelClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackTrailingClause(GATED_DISCARD)).toBeNull();
  });

  it("🛑 NEITHER HALF IS READ ALONE — the whole-sentence anchor is WARRANTED", () => {
    // D489's lattice at weight 1, in the form the splitter cares about: the trailing
    // splitter needs the HEAD claimed by some reader and the TAIL by
    // `deriveAttackEffect`, and this sentence supplies neither. That is why the row
    // was in `OPAQUE` and not in a `COMPOUND-*` class, and it is the reason the anchor
    // welds both ends rather than composing.
    expect(resolvedByAnyReader("Discard a card from your hand.")).toBe(false);
    expect(
      resolvedByAnyReader("If you do, your opponent discards a card from their hand."),
    ).toBe(false);
    // …the positive control, so "refuses everything" is excluded: capitalise the
    // consequent and drop the gate and D426's arm takes it whole.
    expect(resolvedByAnyReader(BARE_ONE)).toBe(true);
  });

  it("🛑 THE LATTICE: 16 DISTINCT points, and this arm claims EXACTLY ONE of them", () => {
    // D505's subtraction rule — key the rider on the derived VALUE, never on the
    // anchor — plus its converse, or the subtraction is circular. The axes are
    // OPENER × GATE × CONSEQUENT × COUNT and every point is spelled from a BUILT
    // spelling (D489), so no point is refused merely for not being a sentence.
    const OPENER = ["Discard a card from your hand.", "Draw 2 cards."] as const;
    const consequent = (op: 0 | 1, count: 0 | 1): string =>
      op === 0
        ? count === 0
          ? "your opponent discards a card from their hand"
          : "your opponent discards 2 cards from their hand"
        : count === 0
          ? "draw 1 cards"
          : "draw 2 cards";
    const points: string[] = [];
    for (const a of [0, 1] as const) {
      for (const g of [0, 1] as const) {
        for (const c of [0, 1] as const) {
          for (const n of [0, 1] as const) {
            const tail = consequent(c, n);
            points.push(
              g === 0
                ? `${OPENER[a]} If you do, ${tail}.`
                : `${OPENER[a]} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`,
            );
          }
        }
      }
    }
    // 🛑 NO DEGENERATE AXIS (D491): the bit set and the point set are the same size,
    // so the table is 2⁴ and not a smaller one reported repeatedly.
    expect(points).toHaveLength(16);
    expect(new Set(points).size).toBe(16);
    // THE RIDER: the derived value this arm produces, not the regex that produces it.
    const mine = points.filter((s) => {
      const derived = deriveAttackEffect(s);
      if (derived === null || derived.length !== 2) return false;
      const [cost, gate] = derived;
      if (cost?.op !== "payFromHand" || gate?.op !== "recordGate") return false;
      return gate.then.length === 1 && gate.then[0]?.op === "opponentDiscardsFromHand";
    });
    expect(mine).toEqual([GATED_DISCARD]);
    // …and the converse: the three OTHER points the readers claim are the sibling
    // anchor's, unmoved by this slice. Readers-only reads 3 of 16 after, 2 before.
    expect(points.filter((s) => resolvedByAnyReader(s)).sort()).toEqual(
      [GATED_DISCARD, DRAW2, "Discard a card from your hand. If you do, draw 1 cards."].sort(),
    );
    // 🛑 D503's DIVERGENCE, DRIVEN: four points build under the residue predicate and
    // under NO reader, every one of them through `splitAttackTrailingClause`, and this
    // slice touches none. A readers-only lattice would have reported a different shape.
    const splitOnly = points.filter(
      (s) => !resolvedByAnyReader(s) && splitAttackTrailingClause(s) !== null,
    );
    expect(splitOnly.sort()).toEqual(
      [
        "Draw 2 cards. Your opponent discards a card from their hand.",
        "Draw 2 cards. Your opponent discards 2 cards from their hand.",
        "Draw 2 cards. Draw 1 cards.",
        "Draw 2 cards. Draw 2 cards.",
      ].sort(),
    );
  });
});

describe("D515 §2 — the program, and every refusal pinned on ONE printed byte", () => {
  it("derives THREE SHIPPED OPS in printed order, with the printed article as the count", () => {
    expect(deriveAttackEffect(GATED_DISCARD)).toEqual(program(1));
    // …and it is NOT the sibling's program, so the pair of anchors really discriminate
    // rather than one of them shadowing the other (D404's rule at a sibling pair).
    expect(deriveAttackEffect(GATED_DISCARD)).not.toEqual(deriveAttackEffect(DRAW2));
  });

  it("🛑 the GATE's slot is the PAYMENT's slot — the two halves cannot drift apart", () => {
    // The single fact the sentence turns on, asserted as an IDENTITY rather than as two
    // literals, so a slice that renames the slot moves them together or reddens.
    const [cost, gate] = deriveAttackEffect(GATED_DISCARD) as EffectOp[];
    expect(cost?.op === "payFromHand" ? cost.recordAs : undefined).toBe("paid");
    expect(gate?.op === "recordGate" ? gate.slot : undefined).toBe("paid");
    expect(gate?.op === "recordGate" ? gate.slot : "gate").toBe(
      cost?.op === "payFromHand" ? cost.recordAs : "cost",
    );
    // …and the gate carries NO `otherwise` and NO `contains`: the printed sentence has
    // no "if you don't" branch and asks nothing about where the card LANDED.
    expect(gate?.op === "recordGate" ? gate.otherwise : "x").toBeUndefined();
    expect(gate?.op === "recordGate" ? gate.contains : "x").toBeUndefined();
  });

  it("🛑 each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    // D399/D427's rule. THE POSITIVE CONTROL FIRST, so "refuses everything" is excluded.
    expect(deriveAttackEffect(GATED_DISCARD)).not.toBeNull();
    for (const text of [
      // …the CONDITION alone: "If you can't" is D417's CANCEL clause, a different seam.
      "Discard a card from your hand. If you can't, your opponent discards a card from their hand.",
      // …the CONSEQUENT'S COUNT alone — the axis the lattice prices at 1 of 8.
      "Discard a card from your hand. If you do, your opponent discards 2 cards from their hand.",
      // …the COST'S QUANTIFIER alone: a plural payment is a different price.
      "Discard 2 cards from your hand. If you do, your opponent discards a card from their hand.",
      // …the COST'S NOUN alone: a filtered cost is not this arm's unfiltered payment.
      "Discard a Basic {G} Energy card from your hand. If you do, your opponent discards a card from their hand.",
      // …the CONSEQUENT'S ZONE alone: the deck is not the hand.
      "Discard a card from your hand. If you do, your opponent discards a card from their deck.",
      // …the CONSEQUENT'S SEAT alone: the print names the OTHER hand.
      "Discard a card from your hand. If you do, you discard a card from your hand.",
      // …the JOINER alone: "and" is not the §9.2 gate, and a build that read it as one
      // would make the opponent discard off a payment that never happened.
      "Discard a card from your hand and your opponent discards a card from their hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    for (const text of [
      `Draw a card. ${GATED_DISCARD}`,
      `${GATED_DISCARD} Then, shuffle your deck.`,
      GATED_DISCARD.toLowerCase(),
      GATED_DISCARD.toUpperCase(),
      GATED_DISCARD.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local `cardPool` (D414/D452), so no `FIXTURE_POOL` id is added
// and `opponentResistanceBonus.test.ts`'s id ladder takes a ZERO term.
// ─────────────────────────────────────────────────────────────────────────────

const SWAPPER = "d515-swapper";
const WALL = "d515-wall";
const ENERGY = "d515-energy";
const ITEM = "d515-item";

const LOCAL_CARDS: Record<string, Card> = {
  [SWAPPER]: battler(SWAPPER, {
    name: "D515 Swapper",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Trade Down", effect: GATED_DISCARD, damage: 30 }],
  }),
  // 330 HP so the flat 30 can never Knock Out, and no KO sweep can land between the
  // payment and the opponent's discard and re-order the events this file reads.
  [WALL]: battler(WALL, {
    name: "D515 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: basicEnergy(ENERGY),
  [ITEM]: itemTrainer(ITEM),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [SWAPPER]: 8, [WALL]: 8, [ENERGY]: 20, [ITEM]: 24 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function mustStep(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

/** Setup driven against the LOCAL pool (D275's idiom). */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY: put `cardId` from the deck into the named spot. */
function place(state: GameState, s: Seat, cardId: string, spot: "active" | "bench"): GameState {
  const side = state.players[s];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in ${s}'s deck`);
  const body = makeInPlay(uid, state.turn);
  const deck = side.deck.filter((u) => u !== uid);
  return {
    ...state,
    players: {
      ...state.players,
      [s]:
        spot === "active"
          ? { ...side, deck, active: body }
          : { ...side, deck, bench: [...side.bench, body] },
    },
  };
}

/** Attach one Energy from the deck onto the seat's Active — the printed {C} cost. */
function fund(state: GameState, s: Seat): GameState {
  const side = state.players[s];
  const active = side.active;
  if (active === null) throw new Error("no active to fund");
  const uid = side.deck.find((u) => state.cardIdByUid[u] === ENERGY);
  if (uid === undefined) throw new Error("no energy in deck");
  return {
    ...state,
    players: {
      ...state.players,
      [s]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, energy: [...active.energy, uid] },
      },
    },
  };
}

/** Set `seat`'s hand to exactly these card ids, one uid each, and return the rest to
    the deck.

    🛑 **THE IDS ARE NAMED RATHER THAN COUNTED, AND THE REASON IS `payFromHand`'s
    INTERCHANGEABLE COLLAPSE (D464).** `handCostCandidates` keeps at most `count`
    copies of each `cardIdentity`, so a three-card hand of three copies of one card
    offers ONE candidate and `parkOrForce` resolves it inline — a board built by
    counting cards off the deck bottom would silently test the FORCED path while
    reading as the parked one (D416's rule: count the candidates your boards actually
    offer). Naming distinct ids is what makes the park a park. */
function handOfIds(state: GameState, seat: Seat, cardIds: readonly string[]): GameState {
  const side = state.players[seat];
  let rest = [...side.deck, ...side.hand];
  const taken: string[] = [];
  for (const id of cardIds) {
    const uid = rest.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${id} not available for ${seat}`);
    taken.push(uid);
    rest = rest.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand: taken, deck: rest } } };
}

/** A three-card hand of three DIFFERENT card ids — the smallest board on which both
    of this program's parks are real decisions. */
const THREE = [ENERGY, ITEM, WALL] as const;

/** P1 on turn:action with the Swapper Active, funded, P2 behind the 330 HP wall. */
function fielded(seed: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustStep(state, { type: "endTurn", seat: "p2" }).state;
  state = place(state, "p1", SWAPPER, "active");
  state = fund(state, "p1");
  return place(state, "p2", WALL, "active");
}

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Hand sizes for both seats, which is the pair every wrong reading shows up in. */
const hands = (state: GameState): [p1: number, p2: number] => [
  state.players.p1.hand.length,
  state.players.p2.hand.length,
];

describe("D515 §3 — the BOARD: two parks, two seats, and the gate between them", () => {
  it("🛑 the CONTROLLER parks first, and the caption is the whole printed sentence", () => {
    // D473's §5 rung, one consequent over — and unlike there, the caption is only the
    // printed sentence because this slice added the `describeBranch` case. §5 drives
    // the other side of that.
    const parked = mustStep(
      handOfIds(handOfIds(fielded(8), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.note).toBe(GATED_DISCARD);
    expect([phase.prompt.min, phase.prompt.max]).toEqual([1, 1]);
    expect(phase.prompt.dest).toBe("discard");
    // …and the CONTROLLER answers it. `answerer` is ABSENT for a controller-answered
    // park (it is the field `opponentDiscardsFromHand` sets and this op does not), so
    // its absence is the assertion rather than a value — which is also what keeps this
    // phase serializing byte-identically to every pre-D52 park.
    expect(phase.seat).toBe("p1");
    expect(phase.answerer).toBeUndefined();
  });

  it("🛑🛑 answering it hands the SECOND park to the OPPONENT, and the gate is why", () => {
    const parked = mustStep(
      handOfIds(handOfIds(fielded(12), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const first = parked.phase;
    if (first.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (first.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = first.prompt.candidates[0] as string;
    const next = mustStep(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [paid] },
    }).state;
    const second = next.phase;
    if (second.kind !== "effect:choose") throw new Error("expected a SECOND effect:choose");
    if (second.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // 🛑 THE SEAT FLIPS, and `seat` does NOT — it still names the program's controller.
    // `opponentDiscardsFromHand` sets `decider: owner`, and that one field is what keeps
    // the opponent's hidden hand out of the controller's prompt and the choice out of
    // the controller's hands.
    expect(second.seat).toBe("p1");
    expect(second.answerer).toBe("p2");
    expect(second.prompt.note).toBe("Discard a card from your hand.");
    expect([second.prompt.min, second.prompt.max]).toEqual([1, 1]);
    expect([...second.prompt.candidates].sort()).toEqual([...next.players.p2.hand].sort());
    // …the controller has already paid and the opponent has not, so mid-program the two
    // seats really are in different states.
    expect(hands(next)).toEqual([2, 3]);
    expect([next.players.p1.discard.length, next.players.p2.discard.length]).toEqual([1, 0]);
    // …and the controller may NOT answer the opponent's prompt. The `answerer` gate is
    // the whole of that refusal, so it is driven rather than inferred from the field.
    const stolen = applyAction(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [second.prompt.candidates[0] as string] },
    });
    expect(stolen.ok).toBe(false);
    // …now the OPPONENT answers and both discard piles hold exactly one card.
    const settled = mustStep(next, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [second.prompt.candidates[0] as string] },
    }).state;
    expect([settled.players.p1.discard.length, settled.players.p2.discard.length]).toEqual([1, 1]);
  });

  it("🛑 AN EMPTY HAND BUYS NOTHING — the gate, not a cancel, is what makes this honest", () => {
    // `attack.ts` never calls `handCostUnmet`, so an attack-borne `payFromHand` pays
    // what it finds. The sentence prints no cancel; the §9.2 gate is the whole of the
    // answer, and this is the board that shows it: nothing paid, nothing bought.
    //
    // ⚠️ THE DISCARD PILES ARE THE READING, NOT THE HANDS (D491). A settled attack ENDS
    // THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] inside the same action, so the defender's turn-start draw lands before
    // this state is observed and p2's HAND comes back one HIGHER than it went in.
    const empty = mustStep(handOfIds(handOfIds(fielded(13), "p1", []), "p2", THREE), attack).state;
    expect(empty.phase.kind).not.toBe("effect:choose");
    expect([empty.players.p1.discard.length, empty.players.p2.discard.length]).toEqual([0, 0]);
    expect(hands(empty)).toEqual([0, 4]);
    // …the CONTROL, one axis away: a hand of ONE is FORCED rather than parked (the M1
    // doctrine) and the opponent DOES lose a card — so the rung above is about the
    // EMPTY hand and not about the absence of a park.
    const forced = mustStep(
      handOfIds(handOfIds(fielded(13), "p1", [ENERGY]), "p2", [ITEM]),
      attack,
    ).state;
    expect(forced.phase.kind).not.toBe("effect:choose");
    expect([forced.players.p1.discard.length, forced.players.p2.discard.length]).toEqual([1, 1]);
  });

  it("🛑 an OPPONENT with an empty hand is a silent whiff, and the payment still happens", () => {
    // §8.6's "do as much as you can" at the far end of the program: `take === 0` is a
    // no-op with no event and no park. The card was still paid — which is the printed
    // order, and the reason the gate reads the PAYMENT rather than the discard.
    const settled = mustStep(
      handOfIds(handOfIds(fielded(14), "p1", [ENERGY]), "p2", []),
      attack,
    ).state;
    expect(settled.phase.kind).not.toBe("effect:choose");
    expect(settled.players.p1.discard).toHaveLength(1);
    expect(settled.players.p2.discard).toHaveLength(0);
  });
});

describe("D515 §4 — what the column now holds, measured rather than claimed", () => {
  /** Run `ops` for p1 and settle every park by paying the FIRST candidates offered. */
  function settle(state: GameState, ops: EffectOp[]): GameState {
    let result = runProgram(state, ops, { seat: "p1" }, []);
    while (result.kind === "parked") {
      const prompt = result.prompt;
      if (prompt.kind !== "chooseCards") throw new Error(`unexpected park: ${prompt.kind}`);
      result = resumeProgram(
        result.state,
        result.cont,
        { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
        [],
      );
    }
    return result.state;
  }

  it("🛑 EXACTLY ONE derived attack program parks for BOTH SEATS behind a §9.2 gate", () => {
    // D452/D443's rule: do not claim a FIRST, measure the CLASS. The predicate is
    // structural — a `recordGate` whose branch holds an op the interpreter hands to the
    // other seat — so a second such row has to be classified here rather than inheriting
    // this sentence's argument.
    const crossSeatGated = legalAttackCorpus().filter(([, text]) => {
      const derived = deriveAttackEffect(text);
      if (derived === null) return false;
      return derived.some(
        (op) =>
          op.op === "recordGate" &&
          op.then.some((inner) => inner.op === "opponentDiscardsFromHand"),
      );
    });
    expect(crossSeatGated.map(([, s]) => s)).toEqual([GATED_DISCARD]);
    expect(units(crossSeatGated)).toBe(1);
  });

  it("🛑 the OTHER two members of the family are UNMOVED — this anchor claims neither", () => {
    // D404's wrong-arm trap, asked of a sibling pair that shares nine printed words.
    expect(deriveAttackEffect(DRAW2)).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ]);
    expect(deriveAttackEffect(DRAW3)).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 3 }] },
    ]);
  });

  it("🛑 the PROGRAM and the SENTENCE agree on the board — the real interpreter, not a shape", () => {
    // The derived program run end to end against the hand-written one: if the anchor
    // ever derived a different program this diverges on cards moved rather than on JSON.
    const board = handOfIds(handOfIds(fielded(15), "p1", THREE), "p2", THREE);
    const viaSentence = settle(board, deriveAttackEffect(GATED_DISCARD) as EffectOp[]);
    const viaProgram = settle(board, program(1));
    expect(hands(viaSentence)).toEqual([2, 2]);
    expect(hands(viaSentence)).toEqual(hands(viaProgram));
    // …and the WRONG reading — the gate dropped — is a DIFFERENT board on the one
    // input that separates them: an empty controller hand still costs the opponent.
    const emptyHanded = handOfIds(handOfIds(fielded(15), "p1", []), "p2", THREE);
    const gated = settle(emptyHanded, program(1));
    const ungated = settle(emptyHanded, [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    expect(hands(gated)).toEqual([0, 3]);
    expect(hands(ungated)).toEqual([0, 2]);
    expect(hands(gated)).not.toEqual(hands(ungated));
  });
});

describe("D515 §5 — THE DESCRIBER, which is the blocker D473 named, driven BOTH WAYS", () => {
  it("🛑🛑 an UNDESCRIBED gate branch degrades the caption to the BARE COST, byte for byte", () => {
    // 🛑 THIS IS THE DEFECT THE SLICE PAYS FOR, DEMONSTRATED ON A LIVE BOARD. Put an op
    // `describeBranch` has no phrase for inside the gate and `withConsequence` returns
    // the prompt unchanged — so the player is asked to discard a card and told NOTHING
    // about what it buys. The two captions below are the same bytes, which is why the
    // loss is silent and why a census would have recorded the row built.
    const board = handOfIds(handOfIds(fielded(16), "p1", THREE), "p2", THREE);
    const noteOf = (ops: EffectOp[]): string => {
      const result = runProgram(board, ops, { seat: "p1" }, []);
      if (result.kind !== "parked") throw new Error("expected a park");
      if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
      return result.prompt.note;
    };
    const bare = [{ op: "payFromHand", count: 1, to: "discard", recordAs: "paid" }] as EffectOp[];
    const undescribed = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // `revealOpponentHand` is a shipped op with no `describeBranch` case — the exact
      // position `opponentDiscardsFromHand` was in before this slice.
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "revealOpponentHand" }] },
    ] as EffectOp[];
    expect(noteOf(undescribed)).toBe(noteOf(bare));
    expect(noteOf(undescribed)).toBe("Discard a card from your hand.");
    // …and THE ARM THIS SLICE ADDS is what separates them. Same gate, same slot, same
    // payment — one op different, and the caption becomes the printed sentence.
    expect(noteOf(program(1))).toBe(GATED_DISCARD);
    expect(noteOf(program(1))).not.toBe(noteOf(bare));
  });

  it("🛑 the PLURAL branch is unreachable from any printing and is DRIVEN anyway", () => {
    // D455's correction to three false "recorded as an equivalent mutant" claims in
    // `interpreter.ts`: a line nothing executes is not covered by saying so. §1 measures
    // that no printing composes a gated plural; this drives the branch from a hand-built
    // program, so the ternary is a tested line rather than a declared survivor.
    const board = handOfIds(handOfIds(fielded(17), "p1", THREE), "p2", THREE);
    const result = runProgram(board, program(2), { seat: "p1" }, []);
    if (result.kind !== "parked") throw new Error("expected a park");
    if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(result.prompt.note).toBe(
      "Discard a card from your hand. If you do, your opponent discards 2 cards from their hand.",
    );
    // …and it really is a different string from the singular's, so the ternary has two
    // live answers rather than one written twice.
    expect(result.prompt.note).not.toBe(GATED_DISCARD);
  });
});

describe("D515 §6 — `MATCH_RECORD_VERSION` stays 30, and the argument is DRIVEN", () => {
  it("🛑 the SERIALIZED ALPHABET: every byte this arm can write, a v30 deploy could write", () => {
    // 🛑 D452/D462/D463's SHAPE, and it is the true one here — say which (D463: pick the
    // argument shape that is true, not the one you used last). No new op, no new op
    // FIELD and no new op VALUE: `payFromHand{count,to,recordAs}` has shipped since
    // Dendra, `recordGate{slot,then}` since Miriam, and `opponentDiscardsFromHand{count}`
    // since D426 — which also means this is NOT D125's absent-key question (no key was
    // added) and NOT D359's widening question (no field changed type). What is new is a
    // COMPOSITION of shipped ops, and `recordGate.then` is typed `EffectOp[]`: it could
    // already hold this member on the day v30 was written.
    const emitted = JSON.stringify(deriveAttackEffect(GATED_DISCARD));
    expect(emitted).toBe(
      '[{"op":"payFromHand","count":1,"to":"discard","recordAs":"paid"},{"op":"recordGate","slot":"paid","then":[{"op":"opponentDiscardsFromHand","count":1}]}]',
    );
    // …REACHABILITY IS FALSE HERE AND SAYING SO IS THE POINT (D463): the payment parks,
    // so the continuation really is persisted. Driven rather than argued.
    const parked = mustStep(
      handOfIds(handOfIds(fielded(18), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(JSON.parse(JSON.stringify(phase.cont.pendingOp))).toEqual(program(1)[0]);
    expect(JSON.parse(JSON.stringify(phase.cont.rest))).toEqual([program(1)[1]]);
  });

  it("🛑 the LOSS direction, driven: a truncated `rest` degrades into a DIFFERENT board", () => {
    // D458/D463's rule — when the slice parks, the loss direction stops being a
    // formality. A record whose `rest` was dropped resumes as a bare payment: the
    // controller's card is discarded and the OPPONENT keeps their hand, which is an
    // observably different board from the one this deploy writes.
    const parked = mustStep(
      handOfIds(handOfIds(fielded(19), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const chosen = parked.players.p1.hand[0] as string;
    const whole = mustStep(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    }).state;
    const truncated: GameState = {
      ...parked,
      phase: { ...phase, cont: { ...phase.cont, rest: [] } },
    };
    const lost = mustStep(truncated, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    }).state;
    // The whole record hands the SECOND park to p2; the truncated one ends the effect.
    // The whole record hands the SECOND park to p2; the truncated one ends the effect,
    // the attack, and the turn — so p2 never discards and their hand comes back HIGHER
    // by the turn-start draw (D491).
    expect(whole.phase.kind).toBe("effect:choose");
    expect(whole.phase.kind === "effect:choose" ? whole.phase.answerer : undefined).toBe("p2");
    expect(lost.phase.kind).not.toBe("effect:choose");
    expect([lost.players.p1.discard.length, lost.players.p2.discard.length]).toEqual([1, 0]);
    expect(hands(lost)).toEqual([2, 4]);
  });

  it("engineVersion is 0.479.0 and the bump is owed for BEHAVIOUR", () => {
    // D471's rule: the bump is owed because `packages/engine` changed behaviour — an
    // anchor, an arm and a `describeBranch` case — and not because a slice happened.
    expect(engineVersion).toBe("0.479.0");
  });
});
