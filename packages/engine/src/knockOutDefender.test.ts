import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { conditionHolds, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";
import {
  koByEffectMarker,
  koedDuringOpponentsLastTurn,
  koedMarksOnOpponentsLastTurn,
} from "./types";

// 🆕🆕 D414 — §8.1, THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE.
//
//   "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."  (2)
//   "Both Active Pokémon are Knocked Out."                                      (1)
//   "This Pokémon does 100 damage to itself. Flip a coin. If heads, your
//    opponent's Active Pokémon is Knocked Out."                                 (1)
//
// — 3 sentences / 4 legal printings on ONE field-free `EffectOp`, and the half of
// it that is worth a suite is NOT the marking.
//
// 🛑 **THE MARKING IS THREE LINES. THE SLICE IS THE PREMISE IT FALSIFIES.** Until
// D414 a body could become lethal on the DEFENDER's board during an attack in
// exactly one way — by being damaged — and TWO SHIPPED MECHANISMS ARE BUILT ON
// THAT SENTENCE BEING TRUE:
//
//   1. `flow.ts`'s `byAttack` mark on `KnockOutMark`. Read by 4 built sentences /
//      6 printings of *"if any of your Pokémon were Knocked Out **by damage from
//      an attack** during your opponent's last turn"* (Iron Leaves `sv06-019`,
//      Revavroom `sv06-125`, Alolan Marowak `sv09-057`, Terrakion `sv10.5w-054`/
//      `-135`, Ethan's Pinsir `sv10-001`). Its old spelling was
//      `attackerSeat !== undefined` — PER BATCH — which is a faithful reading of
//      "by damage from an attack" only while an attack cannot doom a body without
//      damaging it. It is `byAttackFor`, PER BODY, since D414.
//   2. Vengeful Punch `sv03-197`'s recoil (`koRecoilOf`, same file), whose own
//      comment discharged its printed *"by damage"* **by PLACEMENT** rather than
//      by a flag: *"a body can only be lethal on the defender's board here because
//      this attack put it there"*. That sentence is now false, so the site asks.
//
// So `knockOutDefender` stamps `koByEffectMarker(state.turn)` — `koByEffect:<turn>`
// — into `InPlayPokemon.markers`, and BOTH sites read it. §3 and §4 below are the
// two mechanisms, each with the CONTROL that makes its assertion a claim about the
// marker rather than about a constant: an ordinary damage Knock Out on the SAME
// board, from the SAME attacker card, one attack index over.
//
// ⚠️ **FIXTURE_POOL IS UNTOUCHED — D190's local-pool idiom, D275's `cardPool`.**
// The demonstrator sentences are driven on `LOCAL_CARDS` + `KO_DEFENDER_DECK`,
// both private to this file, for the reason two consecutive slices were bitten by:
// `COMPOUND_COMPOSE_DECK` reddened three of D409's boards and `MULTI_COIN_FLIP_DECK`
// is swept over 24 seeds, so a shared deck's composition is load-bearing for seeds
// nobody in this file can see. A private pool also keeps `censusAtHead.test.ts`,
// `catalogManifest.test.ts` and `opponentResistanceBonus.test.ts`'s fixture chain
// still by construction rather than by luck.
//
// 🛑 **AND IT LEAVES ONE THING OWED, WHICH IS SAID HERE RATHER THAN LEFT TO BE
// REDISCOVERED.** `preventBlock.test.ts`'s `CLASSIFIED` table is TOTAL over
// `attackOpKinds()`, which sweeps `FIXTURE_POOL` plus D341's `OFF_POOL_ATTACK_TEXT`
// — so a printing driven on a LOCAL pool is invisible to it, exactly as D341's own
// comment says. `knockOutDefender` therefore carries no row and no probe in that
// table today. §6 below drives its §11 verdict on a REAL BOARD instead, but that
// is this file's assertion and not that sweep's, and the table stays blind until
// one of the three sentences is added to `OFF_POOL_ATTACK_TEXT` with its verdict
// (`blocked`) and its probe. Named, not fixed — that suite is not this slice's.

// ── the printed sentences, verbatim off `censusAttackCorpus.ts` ──────────────

/** 2 printings. The gate and the op, and `conditionGate` +
    `opponentActiveIsBasic` were both already shipped — this arm buys zero
    vocabulary beyond the op itself. */
const BASIC_KO_TEXT = "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.";
/** 1 printing. 🛑 A COMPOSITION OF TWO SHIPPED FIELD-FREE OPS IN PRINTED ORDER,
    which is the whole reason the op has no `target`: a REQUIRED field is what
    costs a `MATCH_RECORD_VERSION` bump the day it is renamed or widened. */
const BOTH_KO_TEXT = "Both Active Pokémon are Knocked Out.";
/** 1 printing. The self-damage is OUTSIDE the gate and FIRST, which is what the
    printed sentence order says: the holder pays whether or not the coin is heads. */
const COIN_KO_TEXT =
  "This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out.";

/** The three sentences of the same printed family this slice DELIBERATELY leaves
    unbuilt, asserted `null` BY NAME in §1. Each needs a PARK this slice does not
    build — *"Knock Out 1 of your opponent's …"* is a choice over a filtered
    candidate set — or a clause (`Special Energy attached`) whose consequent is a
    Knock Out on a board this reader is not scoped to. A witness that is only a
    comment cannot go red. */
const UNBUILT_TEXT = {
  sixCounters: "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.",
  flipBasicPick:
    "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
  specialEnergy:
    "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.",
} as const;

// ── the local pool (FIXTURE_POOL untouched — D190's idiom, D275's `cardPool`) ─

const LOCAL_CARDS: Record<string, Card> = {
  /** 🛑 THE DEMONSTRATOR, AND ITS TWO ATTACKS ARE THE SUITE'S CONTROL PAIR. Both
      cost {C}, so ONE `fix-energy` pays either and no board differs by so much as
      an attached card between the effect Knock Out and the damage Knock Out:

        idx 0 "Basic Breaker" — NO printed damage at all, so the §8.5 pipeline is
          never entered and the ONLY thing that can make the defender lethal is the
          op. A demonstrator that also hit would leave "was it the damage?"
          answerable two ways on every board in §3 and §4.
        idx 1 "Plain Bite" — 200 flat, no effect text. The ORDINARY attack Knock
          Out that every 🛑 case below is measured against.

      120 HP so Vengeful Punch's 40 leaves it standing (a dead attacker would take
      the recoil case into §14 and stop being about the recoil). */
  "fix-kod": battler("fix-kod", {
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Basic Breaker", effect: BASIC_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The victim: a BASIC, 120 HP, no attacks of its own. 120 < 200 so Plain Bite
      Knocks it Out in one hit, and > 0 so nothing else on either board can. */
  "fix-kod-victim": battler("fix-kod-victim", { hp: 120 }),
  /** ⚠️ THE NEGATIVE CONTROL, AND IT IS WHAT MAKES §2 A GATE RATHER THAN AN
      UNCONDITIONAL KNOCK OUT. Same HP as the Basic victim, same retreat, same
      (absent) attacks — the ONLY thing that differs is `stage`, so nothing else
      can be doing the work when the gate declines. */
  "fix-kod-stage1": battler("fix-kod-stage1", {
    hp: 120,
    stage: "Stage1",
    evolveFrom: "fix-kod-victim",
  }),
  /** …and the second non-Basic, because "not Basic" is a two-member set and one
      member passing says nothing about the other. */
  "fix-kod-stage2": battler("fix-kod-stage2", {
    hp: 120,
    stage: "Stage2",
    evolveFrom: "fix-kod-stage1",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270's rule), 60 counted before the first run:
    4+4+4+2+3+3+4+18+18. Every non-local entry earns its place:
      • `sv03-197` Vengeful Punch — THE printing whose recoil §4 is about, reused
        rather than re-fixtured so this suite and `vengefulPunch.test.ts` are
        arguing about the same card;
      • `sv03-004` Scyther — "Agility" ({C}, 10 + the WIDE §11 install), the only
        route in the pool to a live *"prevent all damage from and effects of
        attacks done to this Pokémon"* block, which §6 needs on the DEFENDER;
      • `fix-titan` — 340 HP, no attacks: a promote target, and a bench filler no
        attack in this deck can Knock Out, so a board has exactly the KOs it means;
      • `fix-bigbody` — 200 HP: the DOMINANT mulligan-free starter on both seats, so
        no case needs a seed search to get past setup;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const KO_DEFENDER_DECK = deckOf({
  "fix-kod": 4,
  "fix-kod-victim": 4,
  "fix-kod-stage1": 3,
  "fix-kod-stage2": 3,
  "sv03-197": 4,
  "sv03-004": 6,
  "fix-titan": 4,
  "fix-bigbody": 14,
  "fix-energy": 18,
});

const BASIC_BREAKER = 0;
const PLAIN_BITE = 1;

/** The revenge clause's own `BoardCondition`, spelled once. This is the reader
    behind four built sentences / six printings, and §3 drives it rather than only
    reading `lastKoMarks`, because the mark is a means and the gate is the end. */
const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: KO_DEFENDER_DECK, p2: KO_DEFENDER_DECK },
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
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. P1's
    Active is the demonstrator with the one {C} either of its attacks costs; P2's
    Active is `victim` with exactly TWO benched bodies, both of them past the reach
    of anything in this deck — so the board has no second Knock Out in it AND the
    §8.1 promotion is a real PROMPT rather than a forced auto-promotion (at one
    benched body the engine promotes without asking, and §2's "the promotion is
    prompted" claim would be vacuous). */
function armed(seed: number, victim = "fix-kod-victim", opts: { tool?: string } = {}): GameState {
  let state = must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-kod");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-bigbody");
  if (opts.tool !== undefined) state = attachToolFromDeck(state, "p2", "active", opts.tool);
  return state;
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion — and hand
    back the board on the seat-after turn. Mirrors `lastKoOwnerMark.test.ts`'s
    `settle`, so the two suites' post-KO boards are comparable. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** One whole board: P1 attacks with `index`, the KO settles, the turn passes to
    P2 — the arrangement every `byAttack` reader is consulted on. */
function struck(
  seed: number,
  index: number,
  opts: { tool?: string } = {},
): { before: GameState; after: GameState; events: GameEvent[] } {
  const before = armed(seed, "fix-kod-victim", opts);
  const { state, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after: settle(state), events };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVER. Three programs, asserted as exact equality, and three
//      REFUSALS asserted by name.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 the deriver — three sentences, four printings, one field-free op", () => {
  it("derives the Basic gate to `conditionGate` over `knockOutDefender`", () => {
    // Program EQUALITY rather than a non-null: an arm that emitted the op BARE —
    // dropping the gate — satisfies a non-null and unconditionally Knocks Out
    // every Active in the format, which is the loudest possible way to be wrong.
    expect(deriveAttackEffect(BASIC_KO_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("derives 'Both Active Pokémon are Knocked Out.' to TWO ops in printed order", () => {
    // 🛑 THE ORDER IS THE ASSERTION, NOT THE MEMBERSHIP. §8.1 resolves the batch in
    // one instant and `collectKnockOuts` collects both bodies before it applies
    // either, so this pair is the printed reading rather than a dodge — and the
    // Prize order that falls out (the attacker's ahead of the defender's) is §8.1's
    // own tie-break. A `toEqual` over the two-element array pins both facts; a
    // `toContain`-shaped check would pin neither.
    expect(deriveAttackEffect(BOTH_KO_TEXT)).toEqual([
      { op: "knockOutDefender" },
      { op: "knockOutSelf" },
    ]);
  });

  it("derives the self-damage-then-coin printing with the damage OUTSIDE the gate", () => {
    // ⚠️ THE 100 IS UNCONDITIONAL AND FIRST. Folding it into the gate's `then`
    // would resolve every board in this suite identically and would silently make
    // the holder's cost free on tails, which is the one thing the printed sentence
    // order forbids.
    expect(deriveAttackEffect(COIN_KO_TEXT)).toEqual([
      { op: "damageSelf", amount: 100 },
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("refuses the THREE sentences of the family this slice does not build — by name", () => {
    // Each needs something this slice deliberately did not buy: the first two need
    // a PARK over a filtered candidate set ("Knock Out 1 of your opponent's …"),
    // and the third's clause is opponent-scoped where the clause table's Special
    // Energy rows are self-scoped. A half-built arm that resolved any of these to
    // an op would silently Knock Out the WRONG body; the loud
    // ATTACK_EFFECT_SKIPPED path is the correct behaviour and this is what pins it.
    for (const [name, text] of Object.entries(UNBUILT_TEXT)) {
      expect(deriveAttackEffect(text), `${name} stopped being refused`).toBeNull();
    }
  });

  it("is anchored end to end — all three, both ends", () => {
    // Leading text, a missing period and a lowercase opener each keep the attack on
    // the loud path rather than half-simulating it. Run over all three sentences,
    // because three anchors are three chances to forget a `^` or a `$`.
    for (const text of [BASIC_KO_TEXT, BOTH_KO_TEXT, COIN_KO_TEXT]) {
      expect(deriveAttackEffect(`Flip a coin. If heads, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.replace(/\.$/, ""))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
    }
  });

  it("reads the printed self-damage rather than a constant, and refuses a printed 0", () => {
    // The 100 is `Number(match[1])`, so a scalar that moved must move the program.
    // The pool prints only 100 today; the other value is driven anyway, because a
    // hard-coded 100 passes every board in this file and this is the one place it
    // cannot hide.
    expect(deriveAttackEffect(COIN_KO_TEXT.replace("100", "60"))).toEqual([
      { op: "damageSelf", amount: 60 },
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    // …and the `amount >= 1` guard every self-damage arm carries: a printed 0 is
    // not a cost, and deriving it would ship a silent no-op in front of a real KO.
    expect(deriveAttackEffect(COIN_KO_TEXT.replace("100", "0"))).toBeNull();
  });

  it("🛑 D202's family — both apostrophe spellings derive the SAME program", () => {
    // 🛑 THIS CASE WAS WRITTEN AS ITS OWN INVERSE, AND THAT IS WHY IT IS HERE.
    // It first asserted `toBeNull()` on the typographic spellings, pinning a
    // MEASURED ASYMMETRY: `OPPONENT_ACTIVE_BASIC_KO` and `SELF_DAMAGE_THEN_COIN_KO`
    // spelled a bare `'` where every neighbouring possessive anchor in `effects.ts`
    // spells `['’]`. The pin carried instructions to invert rather than delete if
    // the anchors were widened — and they were, in the same slice, because the
    // asymmetry was a latent DEFECT and not a design: the catalog prints both forms,
    // so a punctuation-normalising re-ingest would have silently un-simulated three
    // printings, failing onto the loud path where nothing counts it.
    //
    // ⚠️ ASSERTED AS A PROGRAM EQUALITY AND NOT AS A NON-NULL, which is D409's rule:
    // an anchor that resolved the curly form to some OTHER program would satisfy a
    // non-null and still be wrong.
    for (const text of [BASIC_KO_TEXT, COIN_KO_TEXT]) {
      const curly = text.replace(/'/g, "’");
      expect(curly).not.toBe(text); // the substitution really happened
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(text));
      expect(deriveAttackEffect(curly)).not.toBeNull();
    }
    // The sibling family, on the SAME run, taking both — so this is a comparison
    // across two families rather than an assertion about one regex in isolation.
    expect(
      deriveAttackEffect("During your opponent’s next turn, the Defending Pokémon can’t retreat."),
    ).toEqual([{ op: "preventRetreat" }]);
    // `BOTH_KO_TEXT` carries no apostrophe at all, so it is unaffected either way —
    // named so the loop above is not read as covering it.
    expect(BOTH_KO_TEXT).not.toContain("'");
  });

  it("keeps the local fixture's printed text verbatim — the sentence IS the wiring", () => {
    // On the deriver path a one-character drift does not throw: it drops the card
    // onto ATTACK_EFFECT_SKIPPED with no other failure anywhere, so the bytes get
    // pinned. ASCII apostrophe, a real é.
    expect(LOCAL_CARDS["fix-kod"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Basic Breaker",
      effect: BASIC_KO_TEXT,
    });
    expect(BASIC_KO_TEXT).toContain("opponent's");
    expect(BASIC_KO_TEXT).toContain("Pokémon");
    expect(BASIC_KO_TEXT).not.toContain("’");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE KNOCK OUT ON A REAL BOARD, and the gate's negative half.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 the Knock Out — Prize, discard, KNOCKED_OUT, promotion", () => {
  it("Knocks Out the opponent's Basic Active and runs §8.1's whole sequence", () => {
    const before = armed(1);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    // The op is not damage and must not pretend to be: no DAMAGE_DEALT row, no
    // COUNTERS_PLACED row, no Weakness/Resistance anywhere. `KNOCKED_OUT` — fired
    // by `knockOut` a moment later — is the honest row and the only one.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    // The card stops being flagged loudly, which is the point of a deriver slice.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");

    // The Prize is PROMPTED rather than taken: a plain body is worth one.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const prized = must(applyAction(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(prized.players.p1.prizes).toHaveLength(5);
    // …then the promotion, on the LOSING seat.
    expect(prized.phase).toEqual({ kind: "ko:promote", seat: "p2" });
    const promoted = must(applyAction(prized, { type: "promote", seat: "p2", benchIndex: 0 }));

    // The whole stack is in the discard and the spot is refilled off the bench.
    expect(promoted.players.p2.discard).toContain(victim);
    expect(promoted.players.p2.active?.stack).not.toContain(victim);
    expect(promoted.players.p2.bench).toHaveLength(1);
    // …and the turn passed, so nothing here is mid-attack.
    expect(promoted.phase.kind).toBe("turn:action");
    expect(promoted.turn).toBe(before.turn + 1);
  });

  it("🛑 the GATE declines against a Stage 1 Active — nothing is Knocked Out", () => {
    // THE CASE THAT MAKES IT A GATE. Same attacker, same attack, same energy, same
    // bench; the ONLY difference from the case above is the victim's `stage`. An
    // arm that emitted `knockOutDefender` bare passes every assertion in the case
    // above and fails here.
    const before = armed(2, "fix-kod-stage1");
    const survivor = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was then undone would still leave
    // 120 damage sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The attack RESOLVED — the gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase.kind).toBe("turn:action");
    // …and the board went nowhere: no Prize moved on either seat.
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
  });

  it("…and against a Stage 2 Active too — 'not Basic' is a two-member set", () => {
    const before = armed(3, "fix-kod-stage2");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
  });

  it("the ORDINARY attack Knock Out on the same board still works — the pair is live", () => {
    // The control that stops §2 from being satisfiable by an attack that does
    // nothing at all: index 1 on the SAME card, same board, kills by damage.
    const before = armed(4);
    const victim = activeUid(before, "p2");
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("a Stage 1 Active dies to the ORDINARY attack — the gate is about the OP, not the body", () => {
    // ⚠️ WITHOUT THIS THE NEGATIVE CONTROL IS AMBIGUOUS. "Nothing happened against
    // a Stage 1" could mean the gate declined OR that this suite's Stage 1 fixture
    // is somehow unkillable on this board. Plain Bite settles it.
    const before = armed(5, "fix-kod-stage1");
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 🛑 HAZARD ONE — `byAttack`, and the six printings it protects.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §3 `byAttack` — a non-damage Knock Out is NOT 'by damage from an attack'", () => {
  it("marks the effect Knock Out `byAttack: false`", () => {
    const { before, after } = struck(6, BASIC_BREAKER);
    const marks = after.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    // The rest of the mark is unchanged — this is a narrowing of ONE field, not a
    // different record. The NAME is still the printed one, and the losing seat is
    // still the only one that records anything (a one-sided read is vacuous on a
    // per-seat history).
    expect(marks[0]?.name).toBe("fix-kod-victim");
    expect(after.lastKoMarks.p1).toEqual([]);
    // …and the window is genuinely OPEN, so "byAttack is false" is a statement
    // about the cause rather than about an empty list nobody can see.
    expect(after.lastKoTurn.p2).toBe(before.turn);
    expect(koedDuringOpponentsLastTurn(after, "p2")).toBe(true);
    expect(koedMarksOnOpponentsLastTurn(after, "p2")).toHaveLength(1);
  });

  it("🛑 THE CONTROL — an ordinary damage Knock Out on the SAME board is `byAttack: true`", () => {
    // ⚠️ WITHOUT THIS CASE THE ONE ABOVE IS SATISFIED BY HARD-CODING `false`, and
    // that mutant would pass a suite that only ever drove the new op. Same seed,
    // same deck, same attacker card, same victim, same bench — the attack INDEX is
    // the only thing that moves, so the two boards differ in the cause and in
    // nothing else.
    const { after } = struck(6, PLAIN_BITE);
    const marks = after.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(true);
    expect(marks[0]?.name).toBe("fix-kod-victim");
  });

  it("🛑 drives the READER — the revenge clause does not fire on an effect Knock Out", () => {
    // The six printings this protects: Iron Leaves / Revavroom / Alolan Marowak /
    // Terrakion ×2 / Ethan's Pinsir all print "by damage from an attack", and a
    // batch-level `byAttack` would have scored every one of them off a Knock Out
    // that dealt no damage at all.
    const effectKo = struck(7, BASIC_BREAKER).after;
    const damageKo = struck(7, PLAIN_BITE).after;

    // The BARE gate (D271's — "were Knocked Out during your opponent's last turn")
    // is TRUE on both, which is what makes the narrowed one a narrowing: the two
    // boards are identical to every reader that does not ask about the cause.
    for (const state of [effectKo, damageKo]) {
      expect(koedDuringOpponentsLastTurn(state, "p2")).toBe(true);
    }
    expect(conditionHolds(damageKo, "p2", BY_ATTACK)).toBe(true);
    expect(conditionHolds(effectKo, "p2", BY_ATTACK)).toBe(false);
    // Both seats, on both boards (D271's rule): the seat that SCORED the Knock Out
    // is never the seat the clause is about, and a build keyed on the wrong seat
    // reads back as "P1 may take the bonus" with no one-sided board noticing.
    expect(conditionHolds(damageKo, "p1", BY_ATTACK)).toBe(false);
    expect(conditionHolds(effectKo, "p1", BY_ATTACK)).toBe(false);
  });

  it("the mark is asked PER BODY — the old batch-level answer is not merely narrower", () => {
    // 🛑 THE SHARPEST BOARD IN §3, and the one a per-batch reading cannot get
    // right at any single value. `fix-kod-victim` here carries a STALE marker
    // (previous turn) and dies to DAMAGE: `byAttackFor` must answer TRUE, because
    // the marker it reads is `koByEffectMarker(state.turn)` and this one is not it.
    // A build that dropped the turn from the marker answers FALSE and silently
    // withholds a bonus six printings are owed.
    const before = armed(8);
    const stale = staleMarked(before, "p2", before.turn - 1);
    const { state } = mustApply(stale, { type: "attack", seat: "p1", index: PLAIN_BITE });
    const after = settle(state);
    expect(after.lastKoMarks.p2[0]?.byAttack).toBe(true);
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(true);
  });

  it("…and a CURRENT-turn marker on a damage Knock Out answers false — the marker decides", () => {
    // The other side of the same surgery, and it is what proves the case above is
    // reading the TURN rather than reading nothing: the identical board with the
    // marker stamped for THIS turn flips the answer, on a Knock Out whose visible
    // cause (a 200-damage hit) has not changed at all.
    const before = armed(9);
    const current = staleMarked(before, "p2", before.turn);
    const { state } = mustApply(current, { type: "attack", seat: "p1", index: PLAIN_BITE });
    const after = settle(state);
    expect(after.lastKoMarks.p2[0]?.byAttack).toBe(false);
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 🛑 HAZARD TWO — Vengeful Punch, whose "by damage" was discharged by
//      PLACEMENT and is now a question.
// ─────────────────────────────────────────────────────────────────────────────

/** Vengeful Punch `sv03-197` — 4 damage counters onto the Attacking Pokémon when
    the holder is Knocked Out BY DAMAGE from an attack. READ OFF THE REGISTRY ROW
    rather than restated, so a re-authored amount moves this suite's arithmetic
    instead of silently disagreeing with the card; the literal is pinned once, in
    the control case, where the number is the assertion. */
const PUNCH_HP = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;

describe("🛑 §4 Vengeful Punch — an effect Knock Out pays no recoil", () => {
  it("the holder Knocked Out by `knockOutDefender` deals NOTHING to the attacker", () => {
    // 🛑 `koRecoilOf`'s printed antecedent is *"if this Pokémon is Knocked Out by
    // damage from an attack from your opponent's Pokémon"*, and until D414 the "by
    // damage" half was true BY CONSTRUCTION at that line — the site's own comment
    // said so. This op is the first thing that can put a body in the lethal set
    // without damaging it.
    const before = armed(10, "fix-kod-victim", { tool: "sv03-197" });
    expect(before.players.p2.active?.tools).toHaveLength(1); // the Tool is really on
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(find(events, "KNOCKED_OUT")).toBeDefined(); // the KO really happened…
    expect(types(events)).not.toContain("COUNTERS_PLACED"); // …and paid nothing
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("🛑 THE CONTROL — the SAME holder Knocked Out by damage still pays its 40", () => {
    // ⚠️ WITHOUT THIS THE CASE ABOVE IS SATISFIED BY DELETING THE RECOIL, and by a
    // board where the Tool never attached. Same seed, same fixtures, same Tool,
    // same victim; the attack index is the only difference.
    const before = armed(10, "fix-kod-victim", { tool: "sv03-197" });
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });

    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1", // the seat that OWNS the damaged body — the ATTACKER's
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP);
    // …and the number itself, pinned ONCE so the constant above cannot quietly
    // become 0 (which would make every "paid nothing" case in this section pass).
    expect(PUNCH_HP).toBe(40);
  });

  it("a STALE marker does not excuse the recoil — the turn is read at this site too", () => {
    // The recoil's reader is `lethalByEffect(body, state.turn)`, a SECOND caller of
    // the same helper §3 exercises. Driving it here rather than trusting the shared
    // function is D141's own lesson: the two sites re-derived the same printed
    // clause once before and drifted.
    const board = armed(11, "fix-kod-victim", { tool: "sv03-197" });
    const before = staleMarked(board, "p2", board.turn - 1);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: PUNCH_HP });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP);
  });

  it("…and a CURRENT-turn marker suppresses it on the same damage hit", () => {
    // The inverse surgery, for the reason its §3 twin exists: without it the case
    // above passes against a site that reads no marker at all.
    const board = armed(12, "fix-kod-victim", { tool: "sv03-197" });
    const before = staleMarked(board, "p2", board.turn);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(state.players.p1.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE MARKER'S OWN RULES.
// ─────────────────────────────────────────────────────────────────────────────

/** TEST SURGERY: stamp `koByEffectMarker(turn)` onto `seat`'s Active, the way a
    denied or undone Knock Out would leave it. Local to this file — `markers` has
    no shared surgery helper and inventing one in `testFixtures.ts` would be a
    shared-module edit for one suite's benefit. */
function staleMarked(state: GameState, seat: Seat, turn: number): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...state.players[seat],
        active: { ...active, markers: [...active.markers, koByEffectMarker(turn)] },
      },
    },
  };
}

describe("§5 the marker — a turn STAMP, so a denied Knock Out cannot lie to the next one", () => {
  it("is `koByEffect:<turn>` and a different turn is a different string", () => {
    // The whole of the arithmetic, in one line, because the arithmetic IS the
    // expiry: there is no clear anywhere and no second place to forget one.
    expect(koByEffectMarker(0)).toBe("koByEffect:0");
    expect(koByEffectMarker(7)).toBe("koByEffect:7");
    expect(koByEffectMarker(7)).not.toBe(koByEffectMarker(8));
    // A `markers` VALUE and not a field — which is what keeps MATCH_RECORD_VERSION
    // at 26: `InPlayPokemon.markers` is already `string[]`, already initialised at
    // every constructor and already persisted, so adding a VALUE is a widening
    // where a new required field is a bump.
    //
    // ⚠️ AND IT IS THAT LIST'S FIRST INHABITANT. `markers` has been declared since
    // M3 ("Effect markers ('can't attack next turn', …)") with NO producer and NO
    // reader anywhere in the engine; `knockOutDefender` writes the first value and
    // `flow.ts lethalByEffect` is the first read. The `koByEffect:` prefix is
    // therefore a convention this slice ESTABLISHES rather than one it follows,
    // which is why it is pinned here — the second inhabitant will copy it.
    expect(koByEffectMarker(3).startsWith("koByEffect:")).toBe(true);
  });

  it("the op WRITES the current turn's stamp onto the defender, and is idempotent", () => {
    // 🛑 DRIVEN THROUGH `runProgram` RATHER THAN THROUGH AN ATTACK, and the reason
    // is observability rather than convenience: on a real attack the marked body is
    // discarded by §8.1 inside the same reduction, so there is no state in which a
    // test can read the marker it wrote. This is the same seam `preventBlock.test.ts`
    // drives its 40-odd op probes on.
    const board = armed(13);
    const events: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "knockOutDefender" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    const doomed = result.state.players.p2.active;
    expect(doomed?.markers).toEqual([koByEffectMarker(board.turn)]);
    // …and lethal against `effectiveMaxHp` AS IT STANDS, which is what hands the
    // body to §8.1's existing sweep rather than to a second KO implementation.
    expect(doomed?.damage).toBe(120);
    // ⚠️ IDEMPOTENT. A program that dooms an already-doomed body (the both-Actives
    // composition run twice, a re-entrant gate) re-computes the SAME string, so the
    // list does not grow — which is what keeps `markers` from being a log.
    const twice: GameEvent[] = [];
    const again = runProgram(
      result.state,
      [{ op: "knockOutDefender" }],
      { seat: "p1", invokedBy: "attack" },
      twice,
    );
    expect(again.state.players.p2.active?.markers).toEqual([koByEffectMarker(board.turn)]);
  });

  it("a STALE stamp does not suppress `byAttack` — asserted at both readers", () => {
    // Both read sites in one breath, on one surgery, because "the marker expires"
    // is a claim about the PAIR: two files re-deriving one printed clause is
    // exactly the D141 accident this stamp exists to prevent recurring.
    const before = armed(14, "fix-kod-victim", { tool: "sv03-197" });
    const stale = staleMarked(before, "p2", before.turn - 2);
    const { state } = mustApply(stale, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP); // `koRecoilOf` paid
    expect(settle(state).lastKoMarks.p2[0]?.byAttack).toBe(true); // `byAttackFor` marked
  });

  // ⚠️ THE BOARD THIS SECTION DOES NOT DRIVE, AND WHY — SAID RATHER THAN IMPLIED.
  // The printed motivation for the turn stamp is a Knock Out that is DENIED while
  // the body stays in play and stays lethally damaged, so a bare marker would sit
  // there and lie about the NEXT Knock Out. **NO SUCH BOARD IS REACHABLE IN THIS
  // ENGINE TODAY, AND THAT IS A MEASUREMENT.** Glimmora `sv02-126`'s "Shattering
  // Crystal" is the card the doc block names, and `flow.ts`'s own comment on
  // `planPrizes` says what it actually does: it **denies the PRIZE while the Knock
  // Out still happens for real** — so the body leaves play and takes its marker
  // with it. The other refusal, §11 (§6 below), is asked BEFORE the stamp is
  // written, so a refused Knock Out leaves NO marker rather than a stale one, which
  // §6 asserts on a real board.
  //
  // So the stamp is defensive against a position no printing can currently reach,
  // and what IS driven above is the arithmetic on a SURGICALLY placed marker —
  // both readers, both directions, both turns. That is the honest coverage: the
  // expiry is real and tested, the position that motivates it is not yet
  // constructible, and the day a printing denies a Knock Out in place, this comment
  // is the note that says the board was never driven.
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §11. The op ASKS, which `knockOutSelf` does not, and the difference is
//      the seat rather than an inconsistency.
// ─────────────────────────────────────────────────────────────────────────────

/** Seeds on which Scyther's "Agility" install flip comes up HEADS, measured over
    [1..24] on `KO_DEFENDER_DECK` — pinned by its own case below, so a deck edit
    that shifts the shuffle fails loudly instead of silently turning §6 vacuous.
    The install is the first coin this board draws and the surgeries consume no
    rng, so the list is a property of the seed and the deck alone. */
const WIDE_HEADS_SEEDS: readonly number[] = [2, 3, 6, 7, 16, 18, 20, 22, 23];

/** ⚠️ AND IT IS THE SAME LIST `preventBlock.test.ts` MEASURED ON ITS OWN DECK,
    which is a fact about the seam rather than a coincidence: the install flip is
    the FIRST coin either board draws after setup, and no surgery in either file
    consumes rng, so the face is a property of the seed alone. Named because a
    reader who noticed the coincidence would otherwise suspect a copied constant. */
const SHIELD_SEED = WIDE_HEADS_SEEDS[0] ?? 0;

/** P1 goes first and passes; P2 spends turn 2 installing the WIDE §11 block on
    its own Scyther; P1 attacks on turn 3. Throws on tails rather than trusting
    the seed table — a board that never installed anything would pass every
    "nothing was Knocked Out" assertion for the wrong reason. */
function installWide(seed: number): { state: GameState; events: GameEvent[] } {
  let state = must(applyAction(localSetup(seed, "p1"), { type: "endTurn", seat: "p1" }));
  // The setup Active is displaced onto the Bench by `setActiveFromDeck`, so the
  // Bench is emptied FIRST and rebuilt after — otherwise `clearBench` would send
  // the Scyther's own predecessor back to the deck at an unpredictable moment. A
  // copy dealt into the hand is returned to the deck rather than searched around,
  // which is why this deck carries six.
  state = clearBench(state, "p2");
  state = handToDeck(state, "p2", "sv03-004");
  state = setActiveFromDeck(state, "p2", "sv03-004");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  return mustApply(state, { type: "attack", seat: "p2", index: 0 });
}

function shielded(seed: number): GameState {
  const installed = installWide(seed);
  if (find(installed.events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`seed ${seed} did not install a wide block (tails?)`);
  }
  let next = clearBench(installed.state, "p2");
  next = benchFromDeck(next, "p2", "fix-titan");
  next = benchFromDeck(next, "p2", "fix-bigbody");
  next = setActiveFromDeck(next, "p1", "fix-kod");
  next = clearBench(next, "p1");
  next = benchFromDeck(next, "p1", "fix-titan");
  return attachFromDeck(next, "p1", "fix-energy", 1);
}

describe("§6 §11 — a 'prevent all effects of attacks done to this Pokémon' block refuses it", () => {
  it("the HEADS seed table is measured, not inherited", () => {
    const measured: number[] = [];
    for (let seed = 1; seed <= 24; seed += 1) {
      if (find(installWide(seed).events, "ATTACK_BLOCK_APPLIED") !== undefined) measured.push(seed);
    }
    expect(measured).toEqual([...WIDE_HEADS_SEEDS]);
    expect(WIDE_HEADS_SEEDS.length).toBeGreaterThan(0);
  });

  it("🛑 refuses the Knock Out, leaves the body ALIVE, and stamps NO marker", () => {
    // 🛑 THE OP ASKS §11 AND `knockOutSelf` DOES NOT, AND THAT IS A RULES CALL
    // RATHER THAN AN INCONSISTENCY: `knockOutSelf` kills its OWN host, which no
    // block on the opponent's body has any claim over. This one is an effect of an
    // attack done TO THE DEFENDING POKÉMON — the exact thing §11 refuses — so it
    // asks, exactly as `preventRetreat` and `preventAttack` do.
    const before = shielded(SHIELD_SEED);
    const survivor = activeUid(before, "p2");
    // Scyther is a BASIC, so the gate really does open — otherwise this case would
    // be measuring the gate rather than the block.
    expect(POOL["sv03-004"]?.stage).toBe("Basic");

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: survivor,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    // ⚠️ THE REFUSAL IS ASKED BEFORE THE STAMP IS WRITTEN, so a refused Knock Out
    // leaves NO marker rather than a stale one — which is the half of §5's
    // motivation that IS reachable, driven here.
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.active?.damage).toBe(0);
  });

  it("🛑 THE CONTROL — the SAME board with the block removed loses the Scyther", () => {
    // Without this the case above is satisfied by a build that cannot Knock Out a
    // Scyther at all (its 80 HP, its Grass type, its being the installer). The
    // block is surgically stripped and nothing else moves.
    const shieldedBoard = shielded(SHIELD_SEED);
    expect(shieldedBoard.players.p2.active?.attackBlock).not.toBeNull();
    const bare: GameState = {
      ...shieldedBoard,
      players: {
        ...shieldedBoard.players,
        p2: {
          ...shieldedBoard.players.p2,
          active:
            shieldedBoard.players.p2.active === null
              ? null
              : { ...shieldedBoard.players.p2.active, attackBlock: null },
        },
      },
    };
    const { events } = mustApply(bare, { type: "attack", seat: "p1", index: BASIC_BREAKER });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});
