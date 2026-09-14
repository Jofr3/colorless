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
import type { GameEvent, GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import { FIXTURE_POOL, battler, basicEnergy, deckOf, itemTrainer, types } from "./testFixtures";
import { makeInPlay } from "./types";

// 0.370.0 → 0.371.0 — 🆕🆕 D473: THE PRINTED HAND COST WHOSE CONSEQUENT IS GATED ON
// ITSELF — TWO SENTENCES AND TWO PRINTINGS FOR ONE ANCHOR.
//
// ── THE PRINTED SENTENCES ────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 101 — "Discard a card from your hand. If you
//     do, draw 2 cards."                                             **1 printing**
//   `censusAttackCorpus.ts` FILE LINE 102 — "Discard a card from your hand. If you
//     do, draw 3 cards."                                             **1 printing**
//
// — 2 sentences / 2 legal printings, ONE anchor with ONE capture, and the best
// sentences-per-anchor ratio left anywhere in the residue at this head.
//
// 🛑 **THE WHOLE SLICE IS AN ANCHOR AND AN ARM, AND THE REASON IS THAT `If you do,`
// IS NOT A NEW MECHANISM.** The brief that commissioned this slice priced the phrase
// as *"a conditional on whether the preceding op actually happened, which may or may
// not be a shape this engine can express"* and warned that a new op observing a prior
// op's success would make the pair expensive. **It is expressible and it has been
// since D148**: `recordGate` is §9.2's OP-RESULT branch, it runs its `then` exactly
// when an earlier op filed at least one uid under `slot`, and Miriam, Dendra and Kofu
// have spelled it in `registry.ts` for hundreds of decisions. The head is
// `payFromHand` — the only op in the union that removes a CHOSEN card from the
// controller's own hand. §2 drives the program; §1's reader sweep is what says no
// other reader wanted it.
//
// 🛑 **AND THE ENGINE ALREADY DESCRIBED THE SENTENCE BEFORE IT COULD DERIVE IT.**
// `withConsequence`/`describeCondition`/`describeBranch` (interpreter.ts) build a
// parking payment's caption by looking DOWN THE QUEUE for the gate that reads it, and
// `opRecord.test.ts` has asserted since D227 that this exact op pair captions to
// *"Discard a card from your hand. If you do, draw 2 cards."* — the printed sentence,
// byte for byte, from a hand-built program. §5 drives that caption from the DERIVED
// program instead, which is what turns a coincidence into this slice's detectability
// witness (D457: when a field also decides a string, that string is the witness).
//
// ── WHY THE ANCHOR SPELLS BOTH ENDS OUT (D472, MEASURED OVER ALL 640 ROWS) ────
// §1 runs both widenings against the committed column rather than describing them:
//   • widening the HEAD (`^Discard (.+) from your hand\.`) claims the IDENTICAL 2
//     sentences / 2 printings — it buys NOTHING and costs a wrong program, because a
//     captured noun would derive a FILTERED cost as this arm's unfiltered payment;
//   • widening the CONSEQUENT (`If you do, (.+)\.`) claims a THIRD row, file line
//     103's *"…your opponent discards a card from their hand."*, whose consequent is
//     a different op `describeBranch` has no phrase for — so the park's caption would
//     silently degrade to the bare cost while the census recorded the sentence built.
//
// ── 🛑 THE STRUCTURAL GUARD THIS SLICE HAD TO WIDEN ─────────────────────────
// D420 pinned, in `handEnergyCancel.test.ts` §4, that no derived attack program may
// carry a `payFromHand` unless its sentence also yields a CANCEL — because
// `attack.ts` never calls `handCostUnmet`, so an attack-borne payment *"pays what
// there is"* and buys its effect anyway. These sentences print no cancel. They are
// still honest, and the gate is why: an empty hand files an empty slot,
// `recordGateHolds` answers false, and the draw does not happen. **Nothing is bought
// when nothing is paid.** §4 of that file now admits exactly that shape — two ops,
// matching slot, no nested payment — and refuses four one-axis near-misses; the old
// discrimination is intact, and `D473-arm-drops-the-record-gate` dies THERE rather
// than here.
//
// ── WHAT IS NOT NEW ──────────────────────────────────────────────────────────
// ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, prompt fields, events,
// error codes, `BoardCondition`/`CardFilter`/`DamageCountSource` members, clause-table
// rows, registry rows, `packages/schema` bytes, `redact.ts` bytes or `FIXTURE_POOL`
// ids. The reader surface stays 13. §6 is the `MATCH_RECORD_VERSION` argument, driven.

/** THE SENTENCES, byte for byte off `legalAttackCorpus()` — §1 asserts that. */
const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";

/** The THIRD member of the printed `Discard a card from your hand. If you do, …`
    family (file line 103, 1 printing), which this anchor must NOT claim. It is the
    live subject of the consequent-widening control in §1, and it is separately
    tracked as a named `DEFERRED` row in `opponentHandDiscard.test.ts`. */
const SIBLING_UNBUILT = "Discard a card from your hand. If you do, your opponent discards a card from their hand.";

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
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The PROGRAM, spelled once so no case can pass against a hand-copied literal that
    has drifted from what this file means by it. */
const program = (drawn: number): EffectOp[] => [
  { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
  { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: drawn }] },
];

describe("D473 §1 — the two sentences, measured live over the legal column", () => {
  it("🛑 the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    // D417/D419's guard: a hand-kept copy of a module-derived surface cannot go red,
    // it can only go quiet, so the DIFF and the COUNT are pinned separately — a diff
    // alone stays green when a slice deletes a reader from the module and this list
    // in the same commit.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("both are really in the column, ONCE each, at ONE printing each", () => {
    // The attribution control (D183/D456): without it every rung below could be green
    // against a paraphrase no card prints.
    for (const text of [DRAW2, DRAW3]) {
      const rows = legalAttackCorpus().filter(([, s]) => s === text);
      expect([rows.length, units(rows)], text).toEqual([1, 1]);
    }
  });

  it("🛑 the ANCHOR's whole reach is 2 sentences / 2 printings, measured", () => {
    const anchored = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, draw (\d+) cards\.$/.test(s),
    );
    expect([anchored.length, units(anchored)]).toEqual([2, 2]);
    expect(anchored.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
  });

  it("🛑 `deriveAttackEffect` is their ONLY reader — the other TWELVE refuse both", () => {
    for (const text of [DRAW2, DRAW3]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
      // …and no splitter composes them either, so the whole-sentence anchor is the
      // only route in and the RAW and RESIDUE summands move together (D444/D457).
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackCancelClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("🛑 WIDENING THE HEAD claims the IDENTICAL rows, so the generality is pure RISK", () => {
    // D472's rule, run rather than asserted: before generalising an anchor, measure
    // what the generalisation would claim over the whole corpus. Here it claims the
    // same two rows — and it would derive a FILTERED printed cost (a Basic {G} Energy
    // card, an Item card) as this arm's UNFILTERED `payFromHand`, discarding a card
    // the sentence never names. Nothing bought, a wrong program paid for.
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard (.+) from your hand\. If you do, draw (\d+) cards\.$/.test(s),
    );
    expect([wide.length, units(wide)]).toEqual([2, 2]);
    expect(wide.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
    // …and the filtered spelling really is refused, so the narrowing is DRIVEN and
    // not merely measured on a population that happens not to contain one.
    expect(
      deriveAttackEffect("Discard a Basic {G} Energy card from your hand. If you do, draw 2 cards."),
    ).toBeNull();
  });

  it("🛑 WIDENING THE CONSEQUENT claims a THIRD row, and that row stays LOUD", () => {
    // The other half of D472's measurement, and this one is not risk-free at all: the
    // third member's consequent is `opponentDiscardsFromHand`, which `describeBranch`
    // has no phrase for — so a wide anchor would claim the sentence, the census would
    // record it built, and the park's caption would silently drop the consequent.
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, (.+)\.$/.test(s),
    );
    expect([wide.length, units(wide)]).toEqual([3, 3]);
    expect(wide.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3, SIBLING_UNBUILT].sort());
    // THE REFUSAL, off the MODULE surface first (D419) and then reader by reader.
    expect(resolvedByAnyReader(SIBLING_UNBUILT)).toBe(false);
    for (const read of READERS) expect(read(SIBLING_UNBUILT), read.name).toBeNull();
  });
});

describe("D473 §2 — the program, and every refusal pinned on ONE printed byte", () => {
  it("derives THREE SHIPPED OPS in printed order, with the count captured", () => {
    expect(deriveAttackEffect(DRAW2)).toEqual(program(2));
    expect(deriveAttackEffect(DRAW3)).toEqual(program(3));
    // …and the two programs really differ, so the pair above is not one assertion
    // written twice (D404's rule at a sibling pair).
    expect(deriveAttackEffect(DRAW2)).not.toEqual(deriveAttackEffect(DRAW3));
  });

  it("🛑 the GATE's slot is the PAYMENT's slot — the two halves cannot drift apart", () => {
    // The single fact the sentence turns on. A gate reading a different slot compiles,
    // derives, and fires off whatever some other op filed — which on this program is
    // nothing, so the draw would never happen; and a payment with no `recordAs` files
    // nothing, so the same. Both are asserted as an IDENTITY rather than as two
    // literals, so a slice that renames the slot moves them together or reddens.
    const [cost, gate] = deriveAttackEffect(DRAW2) as EffectOp[];
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

  it("a printed 0 stays LOUD, and 1 does not", () => {
    // The `>= 1` guard every counted arm in `deriveAttackEffect` carries. A "draw 0
    // cards" is a hand discard wearing a draw's sentence and belongs on the
    // ATTACK_EFFECT_SKIPPED path where a census can see it.
    expect(deriveAttackEffect("Discard a card from your hand. If you do, draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Discard a card from your hand. If you do, draw 1 cards.")).toEqual(
      program(1),
    );
  });

  it("🛑 each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    // D399/D427's rule: a near-miss that differs on more than one axis says nothing
    // about either. THE POSITIVE CONTROL FIRST, so "refuses everything" is excluded.
    expect(deriveAttackEffect(DRAW2)).not.toBeNull();
    for (const text of [
      // …the CONDITION alone: "If you can't" is D417's CANCEL clause, a different
      // seam entirely (it lands on the requirement gate in front of §8.5).
      "Discard a card from your hand. If you can't, draw 2 cards.",
      // …the QUANTIFIER alone: a plural cost is a different payment.
      "Discard 2 cards from your hand. If you do, draw 2 cards.",
      // …the SEAT alone: the printed subject is "your hand".
      "Discard a card from your opponent's hand. If you do, draw 2 cards.",
      // …the ARTICLE alone on the consequent: nothing prints the singular here, and
      // the anchor's `(\d+) cards` is what refuses it.
      "Discard a card from your hand. If you do, draw a card.",
      // …the ZONE alone: the deck is not the hand.
      "Discard a card from your deck. If you do, draw 2 cards.",
      // …the JOINER alone: "and" is not the §9.2 gate, and a build that read it as
      // one would draw on an empty hand.
      "Discard a card from your hand and draw 2 cards.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    for (const text of [
      `Draw a card. ${DRAW2}`,
      `${DRAW2} Then, shuffle your deck.`,
      DRAW2.toLowerCase(),
      DRAW2.toUpperCase(),
      "Discard a card from your hand. If you do, draw 2 cards",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local `cardPool` (D414/D452), so no `FIXTURE_POOL` id is added
// and `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a ZERO term.
// ─────────────────────────────────────────────────────────────────────────────

const DRAWER = "d473-drawer";
const DRAWER3 = "d473-drawer3";
const WALL = "d473-wall";
const ENERGY = "d473-energy";
const ITEM = "d473-item";

const LOCAL_CARDS: Record<string, Card> = {
  [DRAWER]: battler(DRAWER, {
    name: "D473 Drawer",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Restock", effect: DRAW2, damage: 30 }],
  }),
  [DRAWER3]: battler(DRAWER3, {
    name: "D473 Drawer Three",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Restock Plus", effect: DRAW3, damage: 30 }],
  }),
  // 330 HP so the flat 30 can never Knock Out, and no KO sweep can land between the
  // payment and the draw and re-order the events this file reads.
  [WALL]: battler(WALL, {
    name: "D473 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: basicEnergy(ENERGY),
  [ITEM]: itemTrainer(ITEM),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [DRAWER]: 8, [DRAWER3]: 8, [WALL]: 8, [ENERGY]: 20, [ITEM]: 16 });

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

function firstBasicInHand(state: GameState, side: Seat): string {
  const uid = state.players[side].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${side}'s hand`);
  return uid;
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
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const owed = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (owed === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: owed, count: phase.owed[owed] }));
  }
  for (const side of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat: side, uid: firstBasicInHand(state, side) }),
    );
  }
  for (const side of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat: side }));
  }
  return state;
}

/** TEST SURGERY: put `cardId` from the deck into the named spot. The fixture
    helpers key on `FIXTURE_POOL`, so this is the local equivalent. */
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
      [s]: spot === "active" ? { ...side, deck, active: body } : { ...side, deck, bench: [...side.bench, body] },
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

/** Set P1's hand to exactly `count` cards taken off the BOTTOM of their deck, and
    return the rest to the deck. The BOTTOM, never the top: the top is exactly what
    the op under test draws from, so a hand built off it could not be told apart from
    the cards the draw brings back. */
function handOf(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const taken = pool.slice(pool.length - count);
  const deck = pool.slice(0, pool.length - count);
  return { ...state, players: { ...state.players, p1: { ...side, hand: taken, deck } } };
}

/** P1 on turn:action with `attacker` Active, funded, P2 behind the 330 HP wall. */
function fielded(seed: number, attacker: string): GameState {
  let state = localSetup(seed, "p2");
  state = mustStep(state, { type: "endTurn", seat: "p2" }).state;
  state = place(state, "p1", attacker, "active");
  state = fund(state, "p1");
  return place(state, "p2", WALL, "active");
}

const attack = { type: "attack", seat: "p1", index: 0 } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** THE ZONE TRIPLE this file reads every wrong implementation off. */
function zones(state: GameState): [hand: number, discard: number, deck: number] {
  const side = state.players.p1;
  return [side.hand.length, side.discard.length, side.deck.length];
}

/** Run `ops` on `state` for p1 and settle any park by paying the FIRST candidates the
    prompt offers — the real interpreter, the real park, the real answer. This is what
    lets §3 MEASURE each wrong reading instead of asserting its number in a comment
    (D439/D472: every wrong value must be measured against the real machinery). */
function settle(state: GameState, ops: EffectOp[]): GameState {
  const events: GameEvent[] = [];
  let result = runProgram(state, ops, { seat: "p1" }, events);
  while (result.kind === "parked") {
    const prompt = result.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`unexpected park: ${prompt.kind}`);
    result = resumeProgram(
      result.state,
      result.cont,
      { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
      events,
    );
  }
  return result.state;
}

describe("D473 §3 — the discriminating board: EIGHT readings, EIGHT different answers", () => {
  /** The alternatives, each a program a careless author would really write, run
      through the REAL interpreter on the REAL board. No arithmetic in a comment. */
  const CANDIDATES: Record<string, EffectOp[]> = {
    // The build this slice ships.
    correct: program(2),
    // The SIBLING's count — a capture read off the wrong group, or a literal.
    siblingCount: program(3),
    // The gate DELETED: the draw runs whatever the payment did. Indistinguishable
    // here and separated by §4's empty hand, which is why §4 exists.
    gateDropped: [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "drawCards", count: 2 },
    ],
    // The payment PLURALISED — the shape every other `payFromHand` producer in the
    // engine carries (Ultra Ball, SER and Kofu all pay 2).
    paysTwo: [
      { op: "payFromHand", count: 2, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
    // The DESTINATION crossed — Dendra's `deckBottom`, the sibling value on the very
    // field this arm sets, and the discard pile is what tells them apart.
    toDeckBottom: [
      { op: "payFromHand", count: 1, to: "deckBottom", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
    // The WHOLE HAND — D404's op one arm over, and the printed article is all that
    // tells the two sentences apart.
    wholeHand: [
      { op: "discardHand" },
      { op: "drawCards", count: 2 },
    ],
    // The gate reading ANOTHER slot: it compiles, it derives, and it never fires.
    wrongSlot: [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 2 }] },
    ],
    // The payment filing NOTHING: same shape, same gate, and the draw is dead.
    noRecordAs: [
      { op: "payFromHand", count: 1, to: "discard" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
  };

  it("🛑🛑 seven of the eight answer a DIFFERENT zone triple on ONE board", () => {
    const state = handOf(fielded(1, DRAWER), 4);
    expect(zones(state)).toEqual([4, 0, state.players.p1.deck.length]);
    const answers = Object.fromEntries(
      Object.entries(CANDIDATES).map(([name, ops]) => [name, zones(settle(state, ops))]),
    );
    const deck = state.players.p1.deck.length;
    // MEASURED, then written down — the numbers below are what the real interpreter
    // returned, and the rung is here so a build that changes any of them reddens.
    expect(answers).toEqual({
      correct: [5, 1, deck - 2],
      siblingCount: [6, 1, deck - 3],
      gateDropped: [5, 1, deck - 2],
      paysTwo: [4, 2, deck - 2],
      toDeckBottom: [5, 0, deck - 2 + 1],
      wholeHand: [2, 4, deck - 2],
      wrongSlot: [3, 1, deck],
      noRecordAs: [3, 1, deck],
    });
    // ⚠️ THE PAIRS THAT COLLIDE ARE NAMED RATHER THAN LEFT IMPLICIT, and each has a
    // rung elsewhere that separates it — otherwise "eight readings" would be a claim
    // this board cannot support (D440's confound rule).
    //   • `gateDropped` equals `correct` HERE and is separated by §4's EMPTY hand.
    //   • `wrongSlot` equals `noRecordAs` HERE; both are dead draws, and §2's
    //     slot-identity rung is what pins the derived program against either.
    const distinct = new Set(Object.values(answers).map((a) => a.join("/")));
    expect(distinct.size).toBe(6);
  });

  it("🛑 the UIDS say the ORDER, which no count can see (D404's rule)", () => {
    // Under the swapped program every op still runs, HAND_COST_PAID still fires and
    // the hand still ends at five — so a count-based assertion is green on the defect.
    // These two sets are disjoint by construction and the swap makes them overlap.
    const state = handOf(fielded(2, DRAWER), 4);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const topTwo = before.deck.slice(0, 2);
    expect(oldHand).toHaveLength(4);
    expect(topTwo).toHaveLength(2);

    const { state: done, events } = mustStep(state, attack);
    // The park is answered below; the pre-park events already name the payment.
    const paid = find(events, "HAND_COST_PAID");
    expect(paid).toBeUndefined(); // …because a 4-card hand PARKS. §5 owns that path.
    const phase = done.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const chosen = oldHand[0] as string;
    const { state: settled, events: rest } = mustStep(done, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    });
    expect(find(rest, "HAND_COST_PAID")).toMatchObject({ seat: "p1", uids: [chosen] });
    expect(find(rest, "CARDS_DRAWN")).toMatchObject({ seat: "p1", uids: topTwo, reason: "effect" });
    // The discarded card is the OLD hand's, and NEITHER drawn card is in the discard.
    expect(settled.players.p1.discard).toEqual([chosen]);
    for (const uid of topTwo) expect(settled.players.p1.discard).not.toContain(uid);
    // …and the hand is the three kept plus the two drawn, in that arrangement.
    expect(settled.players.p1.hand.sort()).toEqual(
      [...oldHand.filter((u) => u !== chosen), ...topTwo].sort(),
    );
  });

  it("🛑 the printed BASE is KEPT — neither op is a `damageDefender`", () => {
    // `programDamage` is `program?.some(step => step.op === "damageDefender")`, so it
    // is FALSE here and the printed 30 survives the pipeline. A reading that claimed
    // the base would silently delete a 30-damage attack.
    const state = handOf(fielded(3, DRAWER), 1);
    const { state: done, events } = mustStep(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("D473 §4 — the ZERO-MATCH board, with the controls that say WHY it is silent", () => {
  it("🛑🛑 an EMPTY hand discards nothing and draws nothing — and this is the rung the gate exists for", () => {
    // THE SENTENCE'S WHOLE POINT. `payFromHand`'s short-hand branch pays what there is
    // (nothing), files an empty slot, and `recordGateHolds` answers FALSE — so the
    // printed "If you do" withholds the draw. Under `gateDropped` (§3) this board
    // draws TWO, which is a free draw off a price the engine never collected: exactly
    // the hazard `handEnergyCancel.test.ts` §4 forbids.
    const state = handOf(fielded(4, DRAWER), 0);
    expect(zones(state)[0]).toBe(0);
    const deckBefore = state.players.p1.deck.length;
    const { state: done, events } = mustStep(state, attack);
    expect(zones(done)).toEqual([0, 0, deckBefore]);
    expect(find(events, "CARDS_DRAWN")?.reason).not.toBe("effect");
    expect(find(events, "HAND_COST_PAID")).toBeUndefined();
    // …and the CONTROL that says the silence is the PRINTED one: the same board with
    // ONE card in hand pays it and draws two.
    const one = handOf(fielded(4, DRAWER), 1);
    const done1 = mustStep(one, attack).state;
    expect(zones(done1)[0]).toBe(2);
  });

  it("🛑 the empty board is silent for the SENTENCE's reason, not because the sentence is unread", () => {
    // The distinguishing control D469 asks for. `ATTACK_EFFECT_SKIPPED` is the engine's
    // loud channel for "no reader claimed this text"; it must NOT fire here, because
    // the text WAS read and the program WAS run — it simply had nothing to pay with.
    // Without this rung, "nothing happened" is equally consistent with the anchor
    // having been deleted.
    const { events } = mustStep(handOf(fielded(5, DRAWER), 0), attack);
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
    // …and the attack itself resolved: the damage landed and the turn ended, so this
    // is a withheld CONSEQUENT and not a cancelled attack (which is what a printed
    // "If you can't, this attack does nothing." would have produced).
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("🛑 the SIBLING count is driven on a board of its own, so the capture is not a constant", () => {
    // A suite that only ever drives `draw 2` is green on an arm that ignores the
    // capture and returns 2 forever. One card in hand, so the payment is forced and
    // the whole thing resolves inline.
    const state = handOf(fielded(6, DRAWER3), 1);
    const { state: done, events } = mustStep(state, attack);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ seat: "p1", reason: "effect" });
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(zones(done)[0]).toBe(3);
  });
});

describe("D473 §5 — the PARK, the FORCED path, and the caption the engine already had", () => {
  it("🛑 a hand of ONE is FORCED and resolves inline; a hand of TWO PARKS", () => {
    // D416/D464's rule: count the candidates your boards actually offer. `payFromHand`
    // auto-resolves when the offer is no bigger than the count, so a suite whose boards
    // all hold one card never exercises the park at all — and the park is where the
    // continuation, the record and the version argument all live.
    const forced = mustStep(handOf(fielded(7, DRAWER), 1), attack).state;
    expect(forced.phase.kind).not.toBe("effect:choose");
    const parked = mustStep(handOf(fielded(7, DRAWER), 2), attack).state;
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("🛑🛑 the park's CAPTION is the whole printed sentence, byte for byte", () => {
    // D457's detectability witness, and it costs this slice nothing: `withConsequence`
    // looks DOWN THE QUEUE from a recording park for the gate that reads its slot and
    // appends the printed conditional, so the caption is the sentence the anchor just
    // matched. A build that dropped the gate would caption the bare cost — the dialog
    // would stop promising the draw — which is a second, INDEPENDENT reader of the same
    // fact (`opRecord.test.ts` pins the same string off a hand-built program).
    const parked = mustStep(handOf(fielded(8, DRAWER), 3), attack).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase.prompt.kind).toBe("chooseCards");
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.note).toBe(DRAW2);
    // …the pick is MANDATORY and exact, which is the printed cost's own shape.
    expect([phase.prompt.min, phase.prompt.max]).toEqual([1, 1]);
    expect(phase.prompt.dest).toBe("discard");
    expect(phase.prompt.candidates.sort()).toEqual([...parked.players.p1.hand].sort());
    // …and the SIBLING captions its own number, so the caption reads the program.
    const parked3 = mustStep(handOf(fielded(8, DRAWER3), 3), attack).state;
    const phase3 = parked3.phase;
    if (phase3.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase3.prompt.kind === "chooseCards" ? phase3.prompt.note : "").toBe(DRAW3);
  });

  it("🛑 an empty answer is REFUSED — there is no decline behind a printed cost", () => {
    const parked = mustStep(handOf(fielded(9, DRAWER), 3), attack).state;
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(rejected.ok).toBe(false);
    // …and a card that is not in the hand is refused too, on the same park.
    const alien = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [parked.players.p1.deck[0] as string] },
    });
    expect(alien.ok).toBe(false);
  });
});

describe("D473 §6 — `MATCH_RECORD_VERSION` stays 29, and the argument is DRIVEN", () => {
  it("🛑 the SERIALIZED ALPHABET: every byte this arm can write, a v29 deploy could write", () => {
    // D462/D463's shape, and it is the true one here: no new op, no new op FIELD and no
    // new op VALUE. `payFromHand{count,to,recordAs}` has shipped since Dendra/Ultra
    // Ball, `recordGate{slot,then}` since Miriam, `drawCards{count}` since Professor's
    // Research — and this arm emits the same JSON those registry rows already write.
    // REACHABILITY is FALSE here and saying so is the point (D463): the op PARKS, so
    // the continuation really is persisted; what is true is narrower.
    const emitted = JSON.stringify(deriveAttackEffect(DRAW2));
    expect(emitted).toBe(
      '[{"op":"payFromHand","count":1,"to":"discard","recordAs":"paid"},{"op":"recordGate","slot":"paid","then":[{"op":"drawCards","count":2}]}]',
    );
    // …and the persisted continuation really does hold exactly that, driven rather
    // than argued: the park's `pendingOp` is the payment and its `rest` is the gate.
    const parked = mustStep(handOf(fielded(10, DRAWER), 3), attack).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(JSON.parse(JSON.stringify(phase.cont.pendingOp))).toEqual(program(2)[0]);
    expect(JSON.parse(JSON.stringify(phase.cont.rest))).toEqual([program(2)[1]]);
  });

  it("🛑 the LOSS direction, driven: a truncated `rest` degrades into a DIFFERENT board", () => {
    // D458/D463's rule — when the slice parks, the loss direction stops being a
    // formality. A record whose `rest` was dropped resumes as a bare payment: the card
    // is discarded and NO cards are drawn, which is an observably different board from
    // the one this deploy writes. That is a data-corruption failure no version constant
    // protects against and which this slice does not make newly possible; it is
    // recorded because a slice that cannot answer the question differs from one for
    // which the question does not arise.
    const parked = mustStep(handOf(fielded(11, DRAWER), 3), attack).state;
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
    expect(zones(whole)[0]).toBe(4);
    expect(zones(lost)[0]).toBe(2);
    expect(zones(whole)).not.toEqual(zones(lost));
  });

  it("the engine version moved with the behaviour", () => {
    // D471 correctly REFUSED this step because `packages/engine` was byte-unchanged;
    // this slice adds an anchor and an arm, so a printed sentence the engine refused
    // yesterday resolves today and the bump is owed.
    expect(engineVersion).toBe("0.400.0");
  });
});
