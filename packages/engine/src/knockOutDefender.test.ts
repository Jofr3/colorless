import { BASIC_ENERGY_TYPES, type Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  splitAttackCancelClause,
} from "./effects";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote, runProgram } from "./interpreter";
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
/** 🆕🆕 D415 — Haxorus `sv06.5-046` "Sharp Fang", 1 legal printing, verbatim off
    `censusAttackCorpus.ts`. THE FOURTH PRINTING OF THIS OP AND THE FIRST ONE D414
    LEFT BEHIND: arm `6a` (the Basic gate) with the `cond` swapped and nothing else,
    over one new `BoardCondition` member. §7 is its section. */
const SPECIAL_ENERGY_KO_TEXT =
  "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.";

/** The sentences of the same printed family that are STILL unbuilt at head,
    asserted `null` BY NAME in §1 — a witness that is only a comment cannot go red.
    Each needs a mechanism no slice has bought yet, and the list is kept EXACT
    rather than illustrative, because its whole job is to fail the day one of them
    starts deriving.

    🛑 **ONE MEMBER LEFT THIS LIST BECAUSE IT WAS BUILT, AND IT IS NAMED RATHER
    THAN QUIETLY DROPPED.** *"If your opponent's Active Pokémon has any Special
    Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing) stood
    here as `specialEnergy` under the reason *"a clause whose consequent is a Knock
    Out on a board this reader is not scoped to"*. **D415 built it** — a SEAT
    MIRROR of the shipped `yourActiveHasEnergyAttached` (same `energy` parameter,
    same `hasAttachedEnergy` predicate, one seat over) under D414's arm `6a` with
    the `cond` swapped and nothing else. Its rungs are §7 below, and the old refusal
    it also stood in — `energyClause.test.ts`'s Haxorus case — was RE-POINTED at
    the positive program in the same slice.

    ⚠️ **AND ONE MEMBER JOINED, WHICH NOTHING IN THIS REPO NAMED BEFORE D415.**
    `handEnergyKo` was a member of this exact printed family — a Knock Out with no
    damage, on a target the printed text NAMES — carried by no rung, no comment and
    no census note anywhere at head, which made the list a partial census reading as
    a total one.

    🛑🛑 **D420 CORRECTS TWO THINGS D415 WROTE HERE AND THEN BUILDS THE SENTENCE.**
    Both are left visible and marked as corrections (D178):

      1. **THE POINTER WAS STALE.** This block said the sentence stands at
         `censusAttackCorpus.ts` **line 93**. It stands at **line 95** — the corpus
         is sorted, so any record inserted above it moves the number, and a
         line-number citation is a pointer with no guard on it. The transcription
         itself is byte-exact and always was; only the address rotted.
      2. **"NEITHER HALF EXISTS IN THE EFFECT VOCABULARY TODAY" WENT STALE AT D417.**
         That slice shipped `splitAttackCancelClause` /
         `deriveAttackCancelRequirement` and `ATTACK_CANCEL_HEADS`, so the CANCEL
         half existed from D417 onward and this sentence went on claiming it did
         not. What remained true until D420 was the COST half (`payFromHand` at the
         attack seam) and the ROW that joins the two.

    🆕🆕 **D420 BUILT IT** — `payFromHand` under `knockOutDefender` (arm `6g`), one new
    `BoardCondition` member (`yourBasicEnergyInHandAtLeast`), three
    `ATTACK_CANCEL_HEADS` rows and a widened `ATTACK_CANCEL_TRAILING`. Its rungs are
    `handEnergyCancel.test.ts`; what is asserted HERE is only that it stopped being
    refused, and 🛑 **THE ASSERTION IS NOT `deriveAttackEffect(text) !== null`** —
    that reader is `^…$` anchored on the WHOLE printed string, cancel included, so it
    still answers `null` and a naive move to a "built" list would have been GREEN AND
    DEAD. The witness is MOVED rather than deleted (D415's rule) and it is moved to
    the seam that actually claims the sentence: the SPLIT, then the head.

    ⚠️ **AND THE LIST DOES NOT GO EMPTY, WHICH IS D418's LESSON APPLIED IN ADVANCE.**
    A zero-length `UNBUILT_TEXT` makes §1's loop vacuous — green forever, discriminating
    nothing. `delayedKo` is transcribed off the corpus (**line 113, 2 printings**) to
    take the vacated rung, and it is a member of this same printed family: a Knock Out
    with no damage on a target the printed text NAMES. */
const UNBUILT_TEXT = {
  /** 🆕🆕 D420 — the DELAYED Knock Out, and the family's last unbuilt member: *"Discard
      all Energy from this Pokémon. At the end of your opponent's next turn, the
      Defending Pokémon will be Knocked Out."* (**2 printings**). Refused for a reason
      unlike any of the four before it — not a park, not a hand cost, but a DOOM CLOCK:
      the Knock Out is scheduled for a turn boundary two seats away, so it needs a
      persisted per-body stamp and a §13.4-shaped sweep to read it, neither of which
      exists. `resolvedByAnyReader` refuses it too, so it is genuinely in the residue
      and not merely off this arm. */
  delayedKo:
    "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.",
} as const;

/** 🆕🆕 D420's sentence, MOVED here from `UNBUILT_TEXT` rather than deleted. Its head
    and its trailing cancel are asserted separately below, because the printed WHOLE
    is not what any reader claims. */
const BUILT_BY_D420 = {
  handEnergyKo:
    "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.",
  head: "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.",
} as const;

/** 🆕🆕 **D416 BUILT THE TWO PARK SENTENCES, AND THEY ARE NAMED HERE RATHER THAN
    QUIETLY DELETED FROM THE LIST ABOVE.** Both stood in `UNBUILT_TEXT` under the
    reason *"a PARK over a filtered candidate set"*; `knockOutChosen` is that park,
    with `target` REQUIRED because these two sentences disagree about scope in
    print — the coin's tails arm names the BENCH and the counter sentence names the
    whole opponent board. Their rungs are `knockOutChosen.test.ts`; what is asserted
    HERE is only that they stopped being refused, so this file's witness list stays
    a claim about the corpus rather than a stale comment. */
const BUILT_BY_D416 = {
  sixCounters: "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.",
  flipBasicPick:
    "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
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
  /** 🆕🆕 D415's DEMONSTRATOR, BUILT AS THE SAME CONTROL PAIR as `fix-kod` and for
      the same reason: idx 0 prints the D415 sentence and NO damage at all, so the
      §8.5 pipeline is never entered and the only thing that can make the defender
      lethal is the op; idx 1 is the ordinary 200-damage bite that proves any
      "nothing was Knocked Out" board could have lost that body if the engine had
      wanted to. Both cost {C}, so one `fix-energy` pays either and the two boards
      differ by the attack INDEX and nothing else. */
  "fix-kod-special": battler("fix-kod-special", {
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Sharp Fang", effect: SPECIAL_ENERGY_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
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

/** 🆕🆕 D415's OWN deck (D270's rule), 60 counted before the first run:
    4+4+4+18+18+6+6. **It is a SECOND deck rather than four rows added to
    `KO_DEFENDER_DECK`, and that is not fastidiousness**: §6's `WIDE_HEADS_SEEDS`
    is a nine-seed table MEASURED on that deck's shuffle, so a card added there
    moves the install flip and turns §6 red — the exact "a shared deck's
    composition is load-bearing for seeds nobody in this file can see" hazard the
    header block names. Nothing in §7 flips a coin, so this deck's own shuffle
    carries no table.
      • `sv02-190` Jet Energy — an AUTHORED Special, the positive by CLASS;
      • `fix-fire-energy` — a BASIC typed Energy, the negative control's Energy,
        and the one card that tells "has any Energy" from "has a Special";
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const SPECIAL_KO_DECK = deckOf({
  "fix-kod-special": 4,
  "fix-kod-victim": 4,
  "fix-titan": 4,
  "fix-bigbody": 18,
  "fix-energy": 18,
  "sv02-190": 6,
  "fix-fire-energy": 6,
});

const BASIC_BREAKER = 0;
const PLAIN_BITE = 1;
/** `fix-kod-special`'s two indices — the same 0/1 control pair, named apart so a
    §7 board cannot be read as a §2 one. */
const SHARP_FANG = 0;
const SPECIAL_PLAIN_BITE = 1;

/** D415's member, spelled once. `energy` is the parameter INHERITED from the self
    twin, and `"special"` is the only value the printed pool carries today. */
const OPPONENT_SPECIAL = {
  kind: "opponentActiveHasEnergyAttached",
  energy: "special",
} as const;

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

/** `deck` defaults to `KO_DEFENDER_DECK`, so every board §2–§6 drives is byte-for
    byte the one it drove before D415 — the parameter exists only so §7 can bring
    its own deck without moving §6's measured seed table. */
function localSetup(seed: number, first: Seat, deck: string[] = KO_DEFENDER_DECK): GameState {
  const created = createGame({
    seed,
    decks: { p1: deck, p2: deck },
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

  it("refuses the ONE sentence of the family that is STILL unbuilt — by name", () => {
    // 🆕🆕 D420 — the witness this rung carries is the DELAYED Knock Out, and it is a
    // RE-POINT rather than a deletion (D415's standing rule, and D418's warning that
    // a re-point which drops discrimination is worse than the stale rung it fixed).
    // What it needs is a persisted per-body doom stamp and a turn-boundary sweep to
    // read it — a mechanism unlike the park (D416), the gate (D415) and the hand
    // cost (D420). A half-built arm that resolved it to a bare `knockOutDefender`
    // would Knock the opponent's Active Out IMMEDIATELY, a whole turn early, and the
    // loud ATTACK_EFFECT_SKIPPED path is the correct behaviour — which is what this
    // pins.
    //
    // ⚠️ THE LIST IS NOT THE ONE D414 WROTE, NOR D415's, NOR D416's, and the churn is
    // the point of keeping it: `specialEnergy` left because D415 built it (§7),
    // `handEnergyKo` — a member of the same printed family no rung, comment or census
    // note in this repo named at all — joined in the same slice, D416 took BOTH park
    // sentences, and 🆕🆕 D420 built `handEnergyKo` and put `delayedKo` in its place.
    // Three, then three, then one, and one again. **A LIST THAT EMPTIES IS A LOOP
    // THAT ASSERTS NOTHING**, so a slice that clears the last member owes the corpus
    // a fresh transcription rather than a green run.
    expect(Object.keys(UNBUILT_TEXT).length).toBeGreaterThan(0);
    for (const [name, text] of Object.entries(UNBUILT_TEXT)) {
      expect(deriveAttackEffect(text), `${name} stopped being refused`).toBeNull();
    }
    // The sentences that LEFT, asserted positively in the same breath — so "they are
    // no longer refused" is a claim about built programs and not about deleted lines.
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT)).not.toBeNull();
    for (const [name, text] of Object.entries(BUILT_BY_D416)) {
      expect(deriveAttackEffect(text), `${name} is not built`).not.toBeNull();
    }
  });

  it("🆕🆕 D420's sentence is built THROUGH THE SPLIT, and the whole string is still refused", () => {
    // 🛑 THE SHAPE OF THIS RUNG IS THE CORRECTION. `deriveAttackEffect` is `^…$`
    // anchored on the string it is given, and the printed sentence ENDS in its cancel
    // — so the reader answers `null` on the whole printing and will go on answering
    // `null` forever. Moving `handEnergyKo` into a "built" list asserted the way
    // `BUILT_BY_D416` is would therefore have been GREEN AND DEAD: it would have
    // passed before D420 shipped a line.
    expect(deriveAttackEffect(BUILT_BY_D420.handEnergyKo)).toBeNull();
    // What actually claims it is the SEAM: `attack.ts` strips the trailing cancel
    // (answering it as a D125 requirement) and re-runs the readers over the HEAD.
    const split = splitAttackCancelClause(BUILT_BY_D420.handEnergyKo);
    expect(split?.head).toBe(BUILT_BY_D420.head);
    expect(deriveAttackCancelRequirement(BUILT_BY_D420.handEnergyKo)).toEqual({
      kind: "yourBasicEnergyInHandAtLeast",
      energy: "Grass",
      count: 6,
    });
    // …and the head is this op's fourth printed home: the COST first, then the Knock
    // Out, in printed order.
    expect(deriveAttackEffect(BUILT_BY_D420.head)).toEqual([
      {
        op: "payFromHand",
        count: 6,
        to: "discard",
        filter: { kind: "basicEnergy", energyType: "Grass" },
      },
      { op: "knockOutDefender" },
    ]);
    // 🛑 AND THE COST IS NOT OPTIONAL FURNITURE. Without it the printed sentence is a
    // free Knock Out, which is the hazard `handEnergyCancel.test.ts` drives on a
    // board; here it is pinned as the program's SHAPE, so an arm that dropped the
    // payment reddens in the file about the op as well as in the file about the cost.
    expect(deriveAttackEffect(BUILT_BY_D420.head)).not.toEqual([{ op: "knockOutDefender" }]);
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

// ─────────────────────────────────────────────────────────────────────────────
// §7 🆕🆕 D415 — THE SEAT MIRROR. Same op, same gate shape, ONE SEAT OVER.
//
//   "If your opponent's Active Pokémon has any Special Energy attached, it is
//    Knocked Out."  (Haxorus sv06.5-046, 1 legal printing)
//
// D414's arm `6a` with the `cond` SWAPPED AND NOTHING ELSE, over one new
// `BoardCondition` member — `opponentActiveHasEnergyAttached`, the seat mirror of
// D118's `yourActiveHasEnergyAttached`: same `energy` parameter, same
// `hasAttachedEnergy` predicate (by PROVISION, D118's rule — an Energy that can
// pay a `{R}` cost is exactly an Energy a `{R}` sentence reads), same
// false-on-an-empty-Active-Spot contract.
//
// 🛑 **THE ASSERTION WORTH THE SECTION IS THE SEAT, AND IT IS THE ONLY ONE HERE
// THAT NO OTHER SUITE COULD MAKE.** A member whose implementation dropped
// `otherSeat` — one call, and the arm above it in `conditionHolds` is the version
// WITHOUT it — passes every deriver rung, every note round trip, and even the
// positive board below (the boards a lazy suite would build attach the Special to
// the defender and leave the attacker bare, so both readings agree). §7.3 is the
// board where the two readings DISAGREE, and it exists for that mutant alone.
//
// ⚠️ The two damage readers still refuse this sentence — a Knock Out is not a
// damage bonus — and that half of `energyClause.test.ts`'s Haxorus rung was KEPT
// when D415 re-pointed its third assertion from `toBeNull()` to this program.
// ─────────────────────────────────────────────────────────────────────────────

/** TEST SURGERY: empty a seat's Active Spot, discarding the stack the way a Knock
    Out's aftermath leaves it. Local to this file for the reason `staleMarked` is:
    the only caller is the one contract rung below, and `testFixtures.ts` is a
    shared module. (`energyClause.test.ts` keeps its own copy for its own half of
    the family — the twin's empty-spot rung — which is the two suites asserting the
    same contract on two members rather than one suite reaching into the other.) */
function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
}

/** §7's board. P2 opens and passes; P1's Active is the D415 demonstrator holding
    the one {C} either of its attacks costs; P2's Active is the plain victim with
    two out-of-reach benched bodies (so the §8.1 promotion is a real PROMPT and the
    board has no second Knock Out in it).

    `theirs` attaches one card to the OPPONENT's Active, `mine` one to the
    ATTACKER's — and the pair is what makes the seat testable at all: every case
    below is one arrangement of which side is holding the Special. */
function armedSpecial(seed: number, opts: { theirs?: string; mine?: string } = {}): GameState {
  let state = must(
    applyAction(localSetup(seed, "p2", SPECIAL_KO_DECK), { type: "endTurn", seat: "p2" }),
  );
  state = setActiveFromDeck(state, "p1", "fix-kod-special");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  if (opts.mine !== undefined) state = attachFromDeck(state, "p1", opts.mine, 1);
  state = setActiveFromDeck(state, "p2", "fix-kod-victim");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-bigbody");
  if (opts.theirs !== undefined) state = attachFromDeck(state, "p2", opts.theirs, 1);
  return state;
}

describe("§7.1 D415's deriver — arm 6a with the `cond` swapped and nothing else", () => {
  it("derives the printed sentence to `conditionGate` over `knockOutDefender`", () => {
    // Program EQUALITY, not a non-null (D409's rule): an arm that emitted the op
    // BARE satisfies a non-null and Knocks Out every Active in the format — and
    // here it would do so off a sentence most boards can never satisfy, which is
    // the quietest possible way to be catastrophically wrong.
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasEnergyAttached", energy: "special" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("🛑 differs from D414's Basic gate in the `cond` and in NOTHING else", () => {
    // The family's checkable claim about this PAIR, asserted rather than left in a
    // comment: two printed sentences, one gate shape, one field apart. A second op,
    // a reordered program or a `then` that grew a step would break this while both
    // equality rungs above still passed on their own.
    const basic = deriveAttackEffect(BASIC_KO_TEXT);
    const special = deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT);
    for (const program of [basic, special]) {
      expect(program).toHaveLength(1);
      expect(program?.[0]).toMatchObject({
        op: "conditionGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      });
    }
    expect(basic?.[0]).toMatchObject({ cond: { kind: "opponentActiveIsBasic" } });
    expect(special?.[0]).toMatchObject({ cond: OPPONENT_SPECIAL });
    // …and they are not the SAME program, so "one field apart" is a difference and
    // not an alias.
    expect(special).not.toEqual(basic);
  });

  it("🛑 D202's family — both apostrophe spellings derive the SAME program", () => {
    // The `['’]` class was in this anchor from its first draft, unlike the two
    // D414 shipped with a bare `'` — so this rung is a REGRESSION pin rather than
    // a defect report. Asserted as an equality between the two spellings AND as a
    // non-null, because two nulls are also "the same".
    const curly = SPECIAL_ENERGY_KO_TEXT.replace(/'/g, "’");
    expect(curly).not.toBe(SPECIAL_ENERGY_KO_TEXT);
    expect(curly).toContain("opponent’s");
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT));
    expect(deriveAttackEffect(curly)).not.toBeNull();
  });

  it("is anchored end to end — leading text, a lost period and a lowercase opener", () => {
    // Three chances to forget a `^` or a `$`, and the failure mode of each is a
    // half-simulated attack rather than a loud one.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${SPECIAL_ENERGY_KO_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(`${SPECIAL_ENERGY_KO_TEXT} Draw a card.`)).toBeNull();
    // ⚠️ THE NEAR-MISS THAT IS NOT ABOUT ANCHORING: the SELF-scoped rewrite of the
    // same sentence. It is one subject apart and must not reach this arm, or a
    // card would Knock Out the wrong Active entirely — the mirror of the mutant
    // §7.3 drives, at the deriver instead of at the board.
    expect(
      deriveAttackEffect("If this Pokémon has any Special Energy attached, it is Knocked Out."),
    ).toBeNull();
  });

  it("keeps the local fixture's printed text verbatim — the sentence IS the wiring", () => {
    // A one-character drift does not throw on the deriver path: it drops the card
    // onto ATTACK_EFFECT_SKIPPED and every board in §7.2 stops Knocking anything
    // Out, with no other failure anywhere. ASCII apostrophe, a real é.
    expect(LOCAL_CARDS["fix-kod-special"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Sharp Fang",
      effect: SPECIAL_ENERGY_KO_TEXT,
    });
    expect(SPECIAL_ENERGY_KO_TEXT).toContain("opponent's");
    expect(SPECIAL_ENERGY_KO_TEXT).toContain("Pokémon");
    expect(SPECIAL_ENERGY_KO_TEXT).not.toContain("’");
  });
});

describe("§7.2 the member on a real board — the gate, both directions", () => {
  it("Knocks the opponent's Active Out when it holds a Special Energy", () => {
    const before = armedSpecial(20, { theirs: "sv02-190" });
    const victim = activeUid(before, "p2");
    // The Special really is on, and the member really does read it — stated before
    // the attack so a failing board below cannot be a fixture that never attached.
    expect(before.players.p2.active?.energy).toHaveLength(1);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(true);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    // No damage anywhere: this attack prints none, so `KNOCKED_OUT` is the only
    // honest row and W/R never enters the picture.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …and §8.1 runs whole, exactly as it does for D414's Basic gate.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(victim);
  });

  it("🛑 THE NEGATIVE CONTROL — a BASIC Energy on the same spot Knocks nothing Out", () => {
    // 🛑 WHAT MAKES IT A GATE RATHER THAN AN UNCONDITIONAL KNOCK OUT. Same seat,
    // same attacker, same attack, same bench, same NUMBER of attached Energy — the
    // only thing that differs from the case above is whether the attached card is a
    // Special. An arm that emitted the op bare, or a member that answered "is any
    // Energy attached", passes the case above and fails here.
    const before = armedSpecial(21, { theirs: "fix-fire-energy" });
    const survivor = activeUid(before, "p2");
    // The Energy IS attached and IS read — by the typed reading of the very same
    // member, on the very same board. Without this pair the case would pass against
    // a fixture whose attachment silently never happened.
    expect(before.players.p2.active?.energy).toHaveLength(1);
    expect(
      conditionHolds(before, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(false);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was then undone would still leave
    // 120 damage and a `koByEffect:` marker sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The attack RESOLVED — a gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
  });

  it("…and a BARE Active Spot with no Energy at all is refused too", () => {
    // "No Special" is a two-member set — a wrong-class Energy and no Energy — and
    // one member declining says nothing about the other.
    const before = armedSpecial(22);
    expect(before.players.p2.active?.energy).toEqual([]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
  });

  it("the ORDINARY attack kills the SAME body on the SAME board — the pair is live", () => {
    // ⚠️ WITHOUT THIS THE TWO REFUSALS ABOVE ARE AMBIGUOUS: "nothing was Knocked
    // Out" could mean the gate declined OR that this victim is somehow unkillable
    // on this board. Index 1 on the same card settles it, on the Basic-Energy board
    // that just refused.
    const before = armedSpecial(21, { theirs: "fix-fire-energy" });
    const victim = activeUid(before, "p2");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SPECIAL_PLAIN_BITE,
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("🛑 §7.3 THE SEAT — the member reads the OPPONENT's Active, never the viewer's", () => {
  it("🛑 a Special on MY OWN Active Knocks nothing Out — the `otherSeat` mutant's board", () => {
    // 🛑 THE CASE THIS SECTION EXISTS FOR. Every other rung in §7 passes against a
    // member that dropped `otherSeat` and read `state.players[seat].active` — the
    // arm directly above D415's in `conditionHolds` is literally that code. Here
    // the two readings DISAGREE: the ATTACKER holds the Jet Energy and the defender
    // holds a plain Fire, so a self-scoped read opens the gate and Knocks Out a body
    // the printed sentence never named.
    const before = armedSpecial(23, { mine: "sv02-190", theirs: "fix-fire-energy" });
    const survivor = activeUid(before, "p2");
    // The board really is the disagreeing one: MY Active holds a Special (plus the
    // {C} that pays the attack), THEIRS does not.
    expect(before.players.p1.active?.energy).toHaveLength(2);
    expect(
      conditionHolds(before, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(true);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(false);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // …and the attacker is not Knocked Out either, which is the OTHER way a
    // seat-confused build could read: the gate names a body, and no body on either
    // board was named here.
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.active?.markers).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the SAME board answers TRUE for the other seat — it is a mirror, not a constant", () => {
    // ⚠️ WITHOUT THIS THE CASE ABOVE IS SATISFIED BY A MEMBER THAT ALWAYS ANSWERS
    // FALSE. One board, two viewers: P1's opponent (P2) holds only a basic Fire, so
    // P1 reads false — and P2's opponent (P1) holds the Jet, so P2 reads true off
    // the identical state.
    const board = armedSpecial(23, { mine: "sv02-190", theirs: "fix-fire-energy" });
    expect(conditionHolds(board, "p1", OPPONENT_SPECIAL)).toBe(false);
    expect(conditionHolds(board, "p2", OPPONENT_SPECIAL)).toBe(true);
    // 🛑 AND THE MIRROR ITSELF, asserted as the equivalence that NAMES the member:
    // reading the opponent's Active from one seat is reading YOUR Active from the
    // other, on every board and both parameter shapes. This is the claim "it is the
    // seat mirror of `yourActiveHasEnergyAttached`" written as an assertion rather
    // than as a doc comment.
    for (const energy of ["special", "Fire"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const other = seat === "p1" ? "p2" : "p1";
        expect(
          conditionHolds(board, seat, { kind: "opponentActiveHasEnergyAttached", energy }),
        ).toBe(conditionHolds(board, other, { kind: "yourActiveHasEnergyAttached", energy }));
      }
    }
    // …and the two members really do disagree from a single seat, so the loop above
    // is not comparing a value with itself.
    expect(conditionHolds(board, "p1", OPPONENT_SPECIAL)).not.toBe(
      conditionHolds(board, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    );
  });

  it("is a PURE read on a frozen board, from both seats", () => {
    // `conditionHolds` is the single evaluator behind the attack fold, the play
    // gate and the HUD, and the HUD calls it on every render against state it does
    // not own. The provision path is the one worth freezing: `hasAttachedEnergy`
    // walks the host's whole attachment list on every read.
    const frozen = deepFreeze(armedSpecial(24, { mine: "sv02-190", theirs: "sv02-190" }));
    for (const seat of ["p1", "p2"] as const) {
      expect(() => conditionHolds(frozen, seat, OPPONENT_SPECIAL)).not.toThrow();
      expect(conditionHolds(frozen, seat, OPPONENT_SPECIAL)).toBe(true);
    }
  });
});

describe("§7.4 the contracts the member INHERITS from its self twin", () => {
  it("answers FALSE — not a throw — on an EMPTY Active Spot, both parameter shapes", () => {
    // 🛑 THE FAMILY'S STATED CONTRACT, and the seat mirror is the member that can
    // actually meet it in play: the live attack gate guarantees a DEFENDING Pokémon,
    // so no board reachable through `attack` presents an empty spot on either side —
    // but a HUD rendering between a Knock Out and the promote reads exactly this
    // board, from the seat whose OPPONENT has nothing in the spot.
    const armedBoard = armedSpecial(25, { theirs: "sv02-190" });
    expect(conditionHolds(armedBoard, "p1", OPPONENT_SPECIAL)).toBe(true); // …and it WAS true
    const empty = clearActive(armedBoard, "p2");
    expect(empty.players.p2.active).toBeNull();
    for (const energy of ["special", "Fire"] as const) {
      expect(() =>
        conditionHolds(empty, "p1", { kind: "opponentActiveHasEnergyAttached", energy }),
      ).not.toThrow();
      expect(conditionHolds(empty, "p1", { kind: "opponentActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
    // The VIEWER's own spot being empty is a different board and must not answer
    // for the opponent's — the null check is on the seat the member reads.
    const mineEmpty = clearActive(armedBoard, "p1");
    expect(mineEmpty.players.p1.active).toBeNull();
    expect(conditionHolds(mineEmpty, "p1", OPPONENT_SPECIAL)).toBe(true);
  });

  it("reads by PROVISION and by CLASS — a Basic is never a Special, whatever it pays", () => {
    // D118's rule, inherited verbatim: the typed reading asks what the card
    // PROVIDES (so it cannot drift from the §8.2 cost check) and the `"special"`
    // reading asks the CLASS (so an unauthored Special answers the same way). Jet
    // Energy provides {C} and nothing else, so no typed clause fires off it — which
    // is what keeps the two parameter shapes independent rather than two spellings
    // of one read.
    const jet = armedSpecial(26, { theirs: "sv02-190" });
    expect(conditionHolds(jet, "p1", OPPONENT_SPECIAL)).toBe(true);
    for (const energy of BASIC_ENERGY_TYPES) {
      expect(conditionHolds(jet, "p1", { kind: "opponentActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
    const fire = armedSpecial(27, { theirs: "fix-fire-energy" });
    expect(
      conditionHolds(fire, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(conditionHolds(fire, "p1", OPPONENT_SPECIAL)).toBe(false);
    // …and the wrong TYPE is as false as no Energy at all.
    expect(
      conditionHolds(fire, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Lightning" }),
    ).toBe(false);
  });
});

describe("§7.5 `conditionNote` — the pill a HUD renders, and the twin it must not echo", () => {
  it("round-trips both parameter shapes, and NEITHER drops the possessive", () => {
    // ⚠️ NO PRONOUN IS DROPPED HERE, WHICH IS THE DIFFERENCE FROM THE TWIN: the
    // self-scoped member's note re-voices a printed "this Pokémon" that D116's
    // clause table had already resolved; THIS sentence names the opponent's Active
    // in printed words, so the note is the printed phrase itself and the round trip
    // is exact. Nothing else in the suite would catch a typo — the HUD renders
    // these strings verbatim.
    expect(conditionNote(OPPONENT_SPECIAL)).toBe(
      "your opponent's Active Pokémon has a Special Energy attached",
    );
    expect(conditionNote({ kind: "opponentActiveHasEnergyAttached", energy: "Fire" })).toBe(
      "your opponent's Active Pokémon has Fire Energy attached",
    );
    // Built from the PARAMETER over the whole vocabulary, keyed off
    // `BASIC_ENERGY_TYPES` itself so a type added to the schema is covered by
    // construction rather than by a hand-maintained list. Prose, never "{R}": a
    // reject fragment is read by a human.
    for (const energy of BASIC_ENERGY_TYPES) {
      const note = conditionNote({ kind: "opponentActiveHasEnergyAttached", energy });
      expect(note).toBe(`your opponent's Active Pokémon has ${energy} Energy attached`);
      expect(note).not.toContain("{");
      expect(note).toContain("your opponent's");
    }
  });

  it("🛑 DIFFERS from the self twin's note on every parameter — the seat is visible", () => {
    // 🛑 THE HALF A COPY-PASTED ARM WOULD FAIL. Two members over one parameter, and
    // a `conditionNote` arm that fell through to the twin's string would tell a
    // player their OWN Active is the one holding the Special — the same confusion
    // as the `otherSeat` mutant, one layer up, and invisible to every board.
    for (const energy of ["special", ...BASIC_ENERGY_TYPES] as const) {
      const mine = conditionNote({ kind: "yourActiveHasEnergyAttached", energy });
      const theirs = conditionNote({ kind: "opponentActiveHasEnergyAttached", energy });
      expect(theirs).not.toBe(mine);
      // …and the difference is exactly the possessive, not a re-voicing: the twin's
      // note is this one's tail.
      expect(theirs).toBe(`your opponent's ${mine.slice("your ".length)}`);
      expect(mine).not.toContain("opponent");
    }
  });
});
