import { describe, expect, it } from "vitest";
import type { Card } from "@luminous/schema";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { countAttachedEnergy, providedEnergy } from "./continuous";
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
  optionalCostBoostProgram,
} from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import { applyAction, createGame } from "./index";
import type { BoardCondition, EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D383 — THE PAYOFF UNION: D381's READING WIDENED AT ITS CONSEQUENT, AND THE
// LARGEST SINGLE SENTENCE LEFT ON THE ATTACK BACKLOG CLAIMED WITH IT.
//
// D381 read *"You may {cost}. If you do, {payoff}"* with the payoff fixed at *"this
// attack does {N} more damage."*. The catalog prints a SECOND payoff on the same
// skeleton, and it is not a bigger hit but an ADDITIONAL one:
//
//   Wellspring Mask Ogerpon ex `sv06-064` / `sv06-194` / `sv06-213` /
//   `sv08.5-027` / `sv08.5-152` "Torrential Pump" ({W}{C}{C}, flat `100`, index 1
//   of two — confirmed by id against tcgdex, which returns "Sob" at index 0)
//     "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do,
//      this attack also does 120 damage to 1 of your opponent's Benched Pokémon.
//      (Don't apply Weakness and Resistance for Benched Pokémon.)"
//     **5 legal printings**, one byte-identical sentence — the biggest single
//     record left behind this family at D382's head.
//
// ### THE THREE SHAPE QUESTIONS, ANSWERED FROM THE CATALOG BEFORE A LINE WAS WRITTEN
//
// 1. 🛑 **A WIDENED PAYOFF, NOT AN ELEVENTH READER — AND THE ANCHOR DECIDED IT.**
//    `OPTIONAL_COST_BOOST` (`^You may (.+)\. If you do, (.+)$`) ALREADY matches this
//    sentence whole; only the two half-tables refused it. A second reader would
//    therefore carry a byte-identical top-level anchor to the tenth, and every reader
//    in this engine is held to a disjointness proof drawn from its LEADING WORDS — so
//    the sums `attack.ts` folds would have had to become a precedence. **TWO READERS
//    CANNOT SHARE AN ANCHOR.** §2 drives the disjointness rather than asserting it.
// 2. 🛑 **THE PRINTED BASE DOES NOT MOVE INSIDE THE GATE, AND THAT IS THE WHOLE
//    STRUCTURAL DIFFERENCE FROM D381.** *"ALSO"* names a SECOND hit on a BENCHED body
//    the main §8.5 hit never touches, so the flat `100` lands in the pre-program
//    pipeline whatever the player answers and the program carries only
//    `[cost…, snipe]`. Both gates therefore have NO decline arm, where D381's have two
//    — D135's rule, and the exact inverse of that slice's finding. §4 pins the shape
//    and §5/§6 count `DAMAGE_DEALT` rows on all three answers.
// 3. 🛑 **THE ≥3-ENERGY MEMBER IS A NEW ONE, AND IT IS *NOT* `activeEnergyCountsEqual`
//    WIDENED.** Both count Energy on ONE body through the same `countAttachedEnergy`
//    call, but one measures a body against a printed CONSTANT and the other against
//    ANOTHER BODY; folding them needs an operator-and-comparand member, which is a
//    generalisation that would swallow a shipped nullary member on the way. The other
//    three Energy-counting members are each wrong on exactly one axis (§3 computes all
//    three BESIDE the new one, on boards where they disagree).
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN:**
//   • 🛑 **THE GATE'S FALSE ARM IS NOT REACHABLE FROM THE REAL PRINTING IN THIS POOL,
//     AND THAT IS SAID OUT LOUD RATHER THAN GLOSSED.** Torrential Pump costs {W}{C}{C}
//     — THREE units — and `countAttachedEnergy` counts CARDS, so the two come apart
//     only on a body holding a multi-unit Special; the two in this pool are Neo Upper
//     Energy (Stage 2 holders only) and Reversal Energy (Evolution, no Rule Box), and
//     Wellspring Mask Ogerpon ex is a Basic WITH one. So §6 drives the false arm from
//     OUTSIDE the population (D379's own technique, and §2's for the reader): a
//     synthetic printing differing on the ONE token the anchor CAPTURES. Removing the
//     gate would leave `discardEnergy`'s *"do as much as you can"* to shuffle TWO and
//     pay the whole printed 120;
//   • the deck destination could fall back to the DISCARD PILE and every "the Energy
//     left the body" assertion would stay green — §5 asserts the DECK grew and the
//     pile did not, and pairs it with the `SHUFFLE` row;
//   • the printed base could be dropped into the gate (D381's `scaledBase` term
//     copied verbatim) and every board would still deal 120 to the Bench — §5 and §6
//     assert the Defender's 100 on the YES, the NO and the refused gate alike;
//   • the whole reading could be dropped and the sentence would go back to the loud
//     `ATTACK_EFFECT_SKIPPED` path — §4 pins the program and §5 asserts its absence.
//
// WHAT SHIPS: **1 new `BoardCondition` member**, **1 new optional VALUE** on
// `discardEnergy.to` (and the same on `ENERGY_DISCARDED.to`), **1 cost row**, **1
// payoff row**, **1 assembler arm**, **1 fixture**. ZERO new readers, ops, events,
// prompts, choice kinds, registry rows or `packages/schema` bytes — so
// `MATCH_RECORD_VERSION` stays **22**: `discardEnergy` parks, but `to?: "hand"` →
// `to?: "hand" | "deck"` is a WIDENING and a v22 record's absent-or-`"hand"` key
// still means exactly what it meant (D335's discriminator; D352/D359 are renames).

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The TEN live readers, run as one — the same set `censusAtHead.test.ts` keeps.
    ⚠️ **THIS SLICE ADDS NO ELEVENTH**, which is the point of shape question 1: the
    array is unchanged and the census still moved by five printings. */
const READERS: readonly ((text: string) => unknown)[] = [
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
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const TORRENTIAL =
  "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** …and the ONE the family still owes, refused for a `PlayerState` field. */
const PRIZE_FLIP =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
/** D381's own sentence — the OTHER payoff, and this file's control at every seam
    where the two arms of one assembler have to be told apart. */
const CRUSHING_PRESS =
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.";

const FAMILY = /^You may .*If you do,/;

const TORRENT = "fix-torrent";
const BODY = "fix-bigbody";
const WATER = "fix-water-energy";
const COLORLESS = "fix-energy";
const NEO_UPPER = "fix-neo-upper-energy";
const NEO_STAGE2 = "fix-neo-stage2";

/** 🛑 THE SYNTHETIC PRINTING THE GATE'S FALSE ARM IS DRIVEN FROM, AND IT LIVES IN A
    LOCAL POOL ON PURPOSE (D275's idiom).

    It differs from `fix-torrent` on ONE token — the digit the cost anchor CAPTURES —
    and that is the whole design: a cost of FOUR against a printed attack cost of
    three units is a board on which the attack is legally declared and the offer
    cannot be paid, which is exactly the board the real printing cannot reach in this
    pool (see the vacuity note in the header). **A REFUSAL DRIVEN FROM INSIDE A
    SATURATED POPULATION IS NOT DRIVEN AT ALL** (D379), and this is that rule applied
    to a BOARD rather than to a reader. It is NOT in `FIXTURE_POOL`, because no card
    prints its sentence and a shared pool is a claim about the catalog. */
const FOUR = "fix-d383-four";
const FOUR_TEXT =
  "You may shuffle 4 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const LOCAL_CARDS: Record<string, Card> = {
  [FOUR]: battler(FOUR, {
    hp: 210,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Torrential Pump",
        damage: 100,
        effect: FOUR_TEXT,
      },
    ],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** `fix-bigbody` is 200 HP with no Weakness and no Resistance — the only arithmetic
    under which the printed 100 and the printed 120 are both readable unmodified, and
    both bodies survive so no KO tail interferes. Energy pays the printed symbols and
    nothing else. Neo Upper + its Stage 2 holder are §3's CARDS-versus-UNITS board. */
const DECK = deckOf({
  [TORRENT]: 4,
  [FOUR]: 4,
  [NEO_STAGE2]: 2,
  [NEO_UPPER]: 2,
  [WATER]: 6,
  [COLORLESS]: 10,
  [BODY]: 32,
});

/** THREE SEEDS (D270's rule). Nothing on this seam flips a coin — but the trailing
    `shuffleDeck` DOES spend `rngState`, so the boards are seeded rather than pinned. */
const SEEDS = [8101, 8117, 8133] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** Setup driven over the LOCAL pool, P2 going first. */
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

/** TEST SURGERY, the local twin of `attachFromDeck`: the shared helper takes ONE
    card id, and every board here needs a MIX (the printed cost is {W}{C}{C}). */
function fuel(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat} deck has ${uids.length} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

/** P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn, so the
    attack step is legal (§4). **THE TWO SEATS DIFFER IN THE FIXTURE BEFORE ANY
    ASSERTION IS MADE ABOUT EITHER** (D380's finding: a seat defect hides inside a
    symmetric board) — P1 always attacks, P2 always defends, and only P2 has a Bench
    this file controls. `colorless` is how many {C} ride beside the one {W}, so the
    Energy CARD count on the attacker is `1 + colorless`. */
function board(
  seed: number,
  opts: { attacker?: string; colorless?: number; bench?: number } = {},
): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", BODY);
  state = clearBench(state, "p2");
  for (let i = 0; i < (opts.bench ?? 1); i += 1) state = benchFromDeck(state, "p2", BODY);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker ?? TORRENT);
  state = clearBench(state, "p1");
  state = fuel(state, "p1", WATER, 1);
  return fuel(state, "p1", COLORLESS, opts.colorless ?? 2);
}

const attack = (state: GameState) => apply(state, { type: "attack", seat: "p1", index: 0 });
const say = (state: GameState, yes: boolean) =>
  apply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function findAll<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the price, MEASURED IN REFUSED SENTENCES, before and after", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the family's refused half goes 2 sentences / 7 printings → 1 / 2", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    expect([family.length, units(family)]).toEqual([7, 14]);
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    // AFTER: the face-up Prize alone, and its refusal is a `PlayerState` field.
    expect([refused.length, units(refused)]).toEqual([1, 2]);
    expect(refused.map(([, s]) => s)).toEqual([PRIZE_FLIP]);
    // BEFORE, re-derived rather than quoted: the payoff table's SECOND row is the
    // only thing this slice adds to the reader, so removing the sentence it claims
    // from the resolved set reproduces D382's head exactly.
    const before = family.filter(([, s]) => s === TORRENTIAL || !resolvedByAnyReader(s));
    expect([before.length, units(before)]).toEqual([2, 7]);
  });

  it("the sentence carries FIVE printings on ONE record, and the census is asked TWICE", () => {
    const rows = corpus().filter(([, s]) => s === TORRENTIAL);
    expect([rows.length, units(rows)]).toEqual([1, 5]);
    // 🛑 **ONCE WITH THE LITERAL SHORTENED TO THE PART A SPELLING CANNOT CHANGE**
    // (D310/D311's rule): every legal attack sentence naming an Energy shuffle onto
    // THIS Pokémon at all is this one, at any count and with any consequent.
    const anyCount = corpus().filter(([, s]) =>
      /shuffle \d+ Energy attached to this Pokémon into your deck/.test(s),
    );
    expect(anyCount.map(([, s]) => s)).toEqual([TORRENTIAL]);
    // …and once at the PAYOFF end, which is the half that was already built: the flat
    // benched-snipe clause is printed as a WHOLE sentence on **3 records / 17
    // printings**, all of them resolving through `deriveAttackEffect` and none of them
    // through this reader. **ONE PRINTED CLAUSE, TWO ANCHORS, ONE REGEX BODY** — so
    // this slice's payoff row costs no reading at all, only a leading lower-case `t`.
    const flat = corpus().filter(([, s]) =>
      /^This attack also does \d+ damage to 1 of your opponent's Benched Pokémon\.( |$)/.test(s),
    );
    expect([flat.length, units(flat)]).toEqual([3, 17]);
    for (const [, s] of flat) {
      expect(deriveAttackEffect(s), s).not.toBeNull();
      expect(deriveAttackOptionalCostBoost(s), s).toBeNull();
    }
  });
});

describe("§2 — both halves dispatched, and every refusal driven from OUTSIDE the population", () => {
  it("the printed sentence reads as a precondition, TWO cost ops and a dispatched payoff", () => {
    expect(deriveAttackOptionalCostBoost(TORRENTIAL)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: 3,
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "benchSnipe", amount: 120, count: 1 },
    });
  });

  it("🛑 the COST's digit is CAPTURED and the BODY, the ZONE and the VERB are anchored", () => {
    // Synthetic on purpose — no card prints any of these, which is the whole point of
    // driving a refusal from outside the population.
    const at = (cost: string) =>
      deriveAttackOptionalCostBoost(`You may ${cost}. If you do, this attack does 30 more damage.`);
    // The capture: a different digit is a different `count` AND a different gate.
    expect(at("shuffle 5 Energy attached to this Pokémon into your deck")).toMatchObject({
      cond: { kind: "yourActiveEnergyAtLeast", count: 5 },
      ops: [{ op: "discardEnergy", count: 5, to: "deck" }, { op: "shuffleDeck" }],
    });
    // …and a printed 0 charges nothing, which would make the gate vacuously true and
    // the confirm a free question. The guard every captured amount in effects.ts has.
    expect(at("shuffle 0 Energy attached to this Pokémon into your deck")).toBeNull();
    // The BODY: `yourActive` is the printed "this Pokémon" (§8), so the opponent's is
    // a different op and a different member and is refused rather than re-seated.
    expect(at("shuffle 3 Energy attached to your opponent's Active Pokémon into your deck")).toBeNull();
    // The ZONE: the pile is `discardEnergy`'s DEFAULT and would need no field at all,
    // which is exactly why an unanchored verb here would be free.
    expect(at("shuffle 3 Energy attached to this Pokémon into your discard pile")).toBeNull();
    // The VERB, spelled lowercase at its own anchor (D246 / D316): the sentence behind
    // "You may " lowercases it, and a `[Ss]` class would give up the whole-sentence
    // discipline in both directions.
    expect(at("Shuffle 3 Energy attached to this Pokémon into your deck")).toBeNull();
  });

  it("🛑 the PAYOFF's zone word is anchored, and the amount and count are CAPTURED", () => {
    const then = (payoff: string) =>
      deriveAttackOptionalCostBoost(`You may discard a Stadium in play. If you do, ${payoff}`);
    // The control: the SAME cost with the payoff this slice adds.
    expect(then("this attack also does 90 damage to 1 of your opponent's Benched Pokémon.")).toEqual(
      {
        cond: { kind: "stadiumInPlay" },
        ops: [{ op: "discardStadium" }],
        payoff: { kind: "benchSnipe", amount: 90, count: 1 },
      },
    );
    // "Pokémon" without "Benched" is `opponentAny` — a DIFFERENT op, where a hit on
    // the Active takes Weakness and Resistance (§8.5).
    expect(then("this attack also does 90 damage to 1 of your opponent's Pokémon.")).toBeNull();
    // "each of" is `spreadDamage`, not `damageChosen`.
    expect(
      then("this attack also does 90 damage to each of your opponent's Benched Pokémon."),
    ).toBeNull();
    // 🆕🆕 D399 — "2 of" IS a count this row spells now, and the change is not this
    // reader's: `ALSO_BENCHED_SNIPE_BODY` captured the arity so that ONE printed
    // clause keeps ONE reading, and this payoff shares that fragment on purpose. No
    // printing of THIS sentence carries a 2 (all 5 spell 1, pinned in §1), so no
    // board below moves — what moves is that the number comes off the sentence.
    expect(then("this attack also does 90 damage to 2 of your opponent's Benched Pokémon.")).toEqual(
      {
        cond: { kind: "stadiumInPlay" },
        ops: [{ op: "discardStadium" }],
        payoff: { kind: "benchSnipe", amount: 90, count: 2 },
      },
    );
    // …and a printed 0-COUNT is refused by the same `>= 1` guard the amount carries.
    expect(
      then("this attack also does 90 damage to 0 of your opponent's Benched Pokémon."),
    ).toBeNull();
    // A printed 0 buys nothing, on the second payoff exactly as on the first.
    expect(then("this attack also does 0 damage to 1 of your opponent's Benched Pokémon.")).toBeNull();
  });

  it("🛑 the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(TORRENTIAL), read.name).toBeNull();
    }
    // 🛑 AND THE ONE THAT COULD HAVE CLAIMED IT: `deriveAttackEffect`'s
    // `ALSO_BENCHED_SNIPE` reads this clause's OTHER spelling, and the two anchors
    // share a regex BODY — so the ONLY thing keeping the compound off the derived path
    // is the case of the leading word plus the `^…$` at both ends.
    expect(
      deriveAttackEffect(
        "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 120, count: 1, source: "attack", deals: true },
    ]);
    // A leading or trailing sentence denies the compound, as it denies D316's reader.
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${TORRENTIAL}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${TORRENTIAL} Draw a card.`)).toBeNull();
  });
});

describe("§3 — `yourActiveEnergyAtLeast`: CARDS on ONE body, and the three near misses", () => {
  const AT_LEAST = (count: number): BoardCondition => ({ kind: "yourActiveEnergyAtLeast", count });

  it("counts CARDS on the attacker's own body, and `>=` is a FLOOR", () => {
    for (const colorless of [0, 1, 2, 3]) {
      const state = board(SEEDS[0], { colorless });
      const cards = 1 + colorless;
      for (const want of [1, 2, 3, 4, 5]) {
        expect(conditionHolds(state, "p1", AT_LEAST(want)), `${cards} vs ${want}`).toBe(
          cards >= want,
        );
      }
    }
  });

  it("🛑 CARDS AND NOT UNITS — a multi-unit Special counts ONE", () => {
    // 🛑 THE BOARD THAT SEPARATES THE TWO READINGS, AND IT IS THE ONE THIS POOL CAN
    // BUILD: Neo Upper Energy provides TWO Energy at a time to a **Stage 2** holder.
    // Two cards, three units — so a `providedEnergy().length` reading would answer
    // TRUE at 3 and this member answers FALSE. `countAttachedEnergy(…, null)` is the
    // engine's one reading of "Energy attached" (D372 delegated to it for the same
    // reason), so the two cannot drift.
    let state = board(SEEDS[0], { colorless: 0 });
    state = setActiveFromDeck(state, "p1", NEO_STAGE2);
    state = fuel(state, "p1", NEO_UPPER, 1);
    state = fuel(state, "p1", WATER, 1);
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected P1's Active");
    expect(countAttachedEnergy(state, active, null)).toBe(2);
    // The ATTRIBUTION CONTROL: the units really are three on this board, so the
    // assertion below is about the reading and not about an empty holder.
    expect(providedEnergy(state, active)).toHaveLength(3);
    expect(conditionHolds(state, "p1", AT_LEAST(3))).toBe(false);
    expect(conditionHolds(state, "p1", AT_LEAST(2))).toBe(true);
  });

  it("🛑 FALSE with an empty Active Spot — an absent body is not a body holding zero", () => {
    const state = board(SEEDS[0]);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", AT_LEAST(1))).toBe(false);
    // …and at a count of 0 too, which is the branch a `>= count` with no null guard
    // would answer TRUE on: `0 >= 0` is true and there is no Pokémon.
    expect(conditionHolds(empty, "p1", AT_LEAST(0))).toBe(false);
  });

  it("🛑 the THREE near misses computed BESIDE it, on boards where they disagree", () => {
    // D362's test for "widen or add", run as data rather than argued. Each existing
    // Energy-counting member is wrong on exactly one axis, and each is answered here
    // on the SAME board so the difference is visible rather than described.
    let state = board(SEEDS[0], { colorless: 1 }); // {W} + {C} on the Active = 2 cards
    state = benchFromDeck(state, "p1", BODY);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected P1's Bench");
    const spare = state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === WATER)[0];
    if (spare === undefined) throw new Error("expected a spare {W} in the deck");
    const withBench: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          deck: state.players.p1.deck.filter((uid) => uid !== spare),
          bench: [{ ...benched, energy: [...benched.energy, spare] }],
        },
      },
    };
    // THE NEW MEMBER: the BODY, so the benched {C} is invisible — 2, not 3.
    expect(conditionHolds(withBench, "p1", AT_LEAST(3))).toBe(false);
    // ⚠️ THE SIDE-SCOPED SIBLING counts the BENCH too, so it answers TRUE at a count
    // the body cannot reach: one {W} on the Active plus one on the Bench. It is also
    // TYPED — `BasicEnergyType` has no `"Colorless"` member at all — so it could not
    // express this cost's untyped noun even with the zone narrowed.
    expect(
      conditionHolds(withBench, "p1", {
        kind: "yourEnergyInPlayAtLeast",
        energy: "Water",
        count: 2,
      }),
    ).toBe(true);
    // ⚠️ THE BODY-SCOPED SIBLING is unquantified: it says nothing about HOW MANY, so
    // it is TRUE on a body holding one and cannot express the printed cost at all.
    expect(
      conditionHolds(withBench, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Water" }),
    ).toBe(true);
    // ⚠️ AND THE CROSS-BODY SIBLING (D372) reads the SAME counter through the SAME
    // call and asks a different question: P2's Active holds none, so equality is
    // FALSE while this member is TRUE at 2. **ONE COUNTER, TWO COMPARANDS, TWO
    // MEMBERS** — the shape question this slice was handed.
    expect(conditionHolds(withBench, "p1", { kind: "activeEnergyCountsEqual" })).toBe(false);
    expect(conditionHolds(withBench, "p1", AT_LEAST(2))).toBe(true);
  });

  it("the note is a reject pill built from the parameter, and names the BODY", () => {
    expect(conditionNote(AT_LEAST(3))).toBe("your Active Pokémon has 3 or more Energy attached");
    expect(conditionNote(AT_LEAST(5))).toBe("your Active Pokémon has 5 or more Energy attached");
  });
});

describe("§4 — the program: ONE gate, ONE confirm, and NO decline arm on either", () => {
  const reading = () => {
    const parsed = deriveAttackOptionalCostBoost(TORRENTIAL);
    if (parsed === null) throw new Error("expected the reading");
    return parsed;
  };

  it("pins the assembly byte-for-byte: cost, shuffle, snipe — and the base stays OUT", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "optional",
            note: TORRENTIAL,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [
              {
                op: "discardEnergy",
                from: "yourActive",
                filter: { kind: "anyEnergy" },
                count: 3,
                to: "deck",
              },
              { op: "shuffleDeck" },
              {
                op: "damageChosen",
                target: "opponentBench",
                amount: 120,
                count: 1,
                source: "attack",
                deals: true,
              },
            ],
          },
        ],
      },
    ];
    expect(optionalCostBoostProgram(reading(), 100, TORRENTIAL)).toEqual(expected);
  });

  it("🛑 the base is IGNORED by this arm — every printed base assembles the same program", () => {
    // The structural claim of the slice, driven rather than asserted once: the payoff
    // is a SECOND hit, so the printed number never enters the program. D381's arm
    // varies with the base at four values; this one must not vary at all.
    const at = (base: number) => optionalCostBoostProgram(reading(), base, TORRENTIAL);
    for (const base of [0, 30, 100, 250]) expect(at(base)).toEqual(at(100));
    // …and the CONTROL that makes that mean something: the other payoff DOES vary.
    const press = deriveAttackOptionalCostBoost(CRUSHING_PRESS);
    if (press === null) throw new Error("expected D381's reading");
    expect(optionalCostBoostProgram(press, 30, CRUSHING_PRESS)).not.toEqual(
      optionalCostBoostProgram(press, 140, CRUSHING_PRESS),
    );
  });

  it("🛑 NEITHER gate carries an `otherwise`, which is the INVERSE of D381's shape", () => {
    const gate = optionalCostBoostProgram(reading(), 100, TORRENTIAL)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    expect(gate.otherwise).toBeUndefined();
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toBeUndefined();
    // ABSENT and not `[]` — D135's rule, and these programs are compared by VALUE.
    expect(Object.hasOwn(ask, "otherwise")).toBe(false);
    // The confirm's note is the WHOLE printed sentence: the player is agreeing to the
    // COST as much as to the damage.
    expect(ask.note).toBe(TORRENTIAL);
    // …and D381's arm, on the same assembler, carries BOTH — because ITS payoff
    // re-homes a printed base a decline must still deal.
    const press = deriveAttackOptionalCostBoost(CRUSHING_PRESS);
    if (press === null) throw new Error("expected D381's reading");
    const other = optionalCostBoostProgram(press, 140, CRUSHING_PRESS)[0];
    if (other === undefined || other.op !== "conditionGate") throw new Error("expected the gate");
    expect(other.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
  });
});

describe("§5 — the board: the Energy reaches the DECK, and the snipe is a SECOND hit", () => {
  it.each(SEEDS)("seed %i — YES: 3 Energy to the deck, a SHUFFLE, and 100 + 120", (seed) => {
    const before = board(seed, { bench: 1 });
    const attacker = before.players.p1.active;
    if (attacker === null) throw new Error("expected P1's Active");
    expect(attacker.energy).toHaveLength(3);
    const deckBefore = before.players.p1.deck.length;
    const pileBefore = before.players.p1.discard.length;

    const parked = attack(before);
    // 🛑 THE PRINTED BASE LANDS BEFORE THE PROGRAM AND IS NOT WAITING ON THE ANSWER.
    expect(find(parked.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 100, dealt: 100 });
    expect(types(parked.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(find(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: TORRENTIAL,
    });

    const done = say(parked.state, true);
    // 🛑 THE DECK, NOT THE PILE — the destination defect is invisible to every "the
    // Energy left the body" assertion, so both zones are read.
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.deck).toHaveLength(deckBefore + 3);
    expect(done.state.players.p1.discard).toHaveLength(pileBefore);
    for (const uid of attacker.energy) expect(done.state.players.p1.deck).toContain(uid);
    // …and the printed VERB, which is its own op: the deck was randomised in the open.
    expect(find(done.events, "SHUFFLE")?.seat).toBe("p1");
    const moved = find(done.events, "ENERGY_DISCARDED");
    expect(moved).toMatchObject({ seat: "p1", actor: "p1", to: "deck" });
    expect(moved?.uids).toHaveLength(3);
    // 🛑 THE SECOND HIT, ON A BENCHED BODY THE FIRST NEVER TOUCHED — and it is ATTACK
    // DAMAGE (`deals`), so `DAMAGE_DEALT` rather than `COUNTERS_PLACED`, with no
    // Weakness applied to a benched target (§8.5, the printed parenthetical).
    expect(types(done.events)).not.toContain("COUNTERS_PLACED");
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      weakness: null,
      dealt: 120,
    });
    expect(done.state.players.p2.active?.damage).toBe(100);
    expect(done.state.players.p2.bench[0]?.damage).toBe(120);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it.each(SEEDS)(
    "seed %i — 🛑 the SHUFFLE is SPENT: `rngState` advances on the yes and stands still on the no",
    (seed) => {
      // 🆕🆕 D455 — A REAL SUITE HOLE, FOUND BY A MUTANT AND CONFIRMED UNDER `--full`.
      // `shuffleDeck`'s implementation is four lines, the last of which threads the
      // advanced `rngState` back onto the state. Dropping that thread leaves the deck
      // genuinely shuffled and EVERY board assertion in this repo green — the cards
      // move, the SHUFFLE row is filed, the zones balance — while the generator never
      // advances, so the next shuffle in the match replays the same permutation and
      // the next coin flip repeats a face it has already produced. The whole suite
      // (449 files / 9,975 tests at D455's base) could not tell the two builds apart:
      // `D455-the-shuffle-never-advances-the-rng` SURVIVED a full-suite run.
      //
      // ⚠️ THE CONTROL IS THE HALF THAT MAKES THIS MEAN ANYTHING (D424). "rngState
      // moved" is satisfied by any action that touches the generator for any reason,
      // so the decline — which splices nothing, files no SHUFFLE, and is driven three
      // rungs down — must leave it EXACTLY where it was. One rung asserting movement
      // and one asserting stillness, on the same board and the same seed, is what
      // ties the movement to the printed *"Shuffle"* rather than to the turn.
      //
      // `D335-shuffle-is-spent-and-thrown-away` is this defect on a DIFFERENT
      // function (`lookAtTopN`'s shuffled-bottom leftovers, pinned by
      // reconDirective.test.ts). The op that every search program in the engine ends
      // with had no such rung anywhere.
      const parked = attack(board(seed, { bench: 1 }));
      expect(parked.state.phase.kind).toBe("effect:choose");

      const yes = say(parked.state, true);
      expect(types(yes.events)).toContain("SHUFFLE");
      expect(yes.state.rngState).not.toBe(parked.state.rngState);

      const no = say(parked.state, false);
      expect(types(no.events)).not.toContain("SHUFFLE");
      expect(no.state.rngState).toBe(parked.state.rngState);
    },
  );

  it.each(SEEDS)("seed %i — TWO hits and never one: the rows are 100 and 120", (seed) => {
    // 🛑 THE ROW COUNT IS THE OBSERVATION A DROPPED-OR-DOUBLED BASE MOVES. D381's
    // reader owns its printed number and emits ONE row; this one emits TWO, and a
    // `scaledBase` term that claimed the base for BOTH payoffs would silently delete
    // the 100 here while leaving every "the Bench took 120" assertion green.
    // ⚠️ THE ROWS ARE SPLIT ACROSS TWO ACTIONS, which is itself the claim: the base
    // is dealt by the DECLARATION and the snipe by the RESOLUTION, so a reading that
    // re-homed the base would move the 100 out of the first list and into the second.
    const parked = attack(board(seed, { bench: 1 }));
    expect(findAll(parked.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([100]);
    const done = say(parked.state, true);
    expect(findAll(done.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([120]);
  });

  it.each(SEEDS)("seed %i — NO: nothing moves, nothing is sniped, and the 100 still lands", (seed) => {
    const before = board(seed, { bench: 1 });
    const attacker = before.players.p1.active;
    if (attacker === null) throw new Error("expected P1's Active");
    const deckBefore = before.players.p1.deck.length;
    const parked = attack(before);
    expect(findAll(parked.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([100]);
    const done = say(parked.state, false);
    // 🛑 THE DEFECT `optional`'s own doc names: a confirm that silently applies on "no".
    expect(done.state.players.p1.active?.energy).toEqual(attacker.energy);
    expect(done.state.players.p1.deck).toHaveLength(deckBefore);
    expect(types(done.events)).not.toContain("SHUFFLE");
    expect(types(done.events)).not.toContain("ENERGY_DISCARDED");
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    // …and the rung a decline arm added "for symmetry" would redden on: the printed
    // base was dealt ONCE, by the pipeline before the park, and the DECLINE deals
    // nothing at all — where D381's decline deals the base a second time over.
    expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.state.players.p2.active?.damage).toBe(100);
  });

  it.each(SEEDS)("seed %i — an EMPTY opponent Bench: the offer is still asked, and whiffs", (seed) => {
    // The gate is about the COST's payability and says nothing about the payoff's
    // target, so a Bench of zero still parks the confirm — and a "yes" pays the cost
    // for nothing, which is what the printed sentence says. **NAMED RATHER THAN
    // FIXED**: `damageChosen`'s own whiff, one op over.
    const parked = attack(board(seed, { bench: 0 }));
    expect(parked.state.phase.kind).toBe("effect:choose");
    const done = say(parked.state, true);
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(types(done.events)).toContain("SHUFFLE");
    expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.state.players.p2.active?.damage).toBe(100);
  });
});

describe("§6 — the gate, and the TWO consecutive parks inside one confirm", () => {
  it.each(SEEDS)("seed %i — 🛑 an UNPAYABLE cost is never offered, and the 100 still lands", (seed) => {
    // 🛑 THE FALSE ARM, DRIVEN FROM OUTSIDE THE POPULATION (see the header). The
    // synthetic printing charges FOUR against a printed cost of three units, so the
    // attack is declared legally on three Energy cards and the offer cannot be paid.
    // Without the gate `optional` parks unconditionally and a "yes" shuffles THREE
    // ("do as much as you can" is `discardEnergy`'s rule for a MANDATORY discard) and
    // collects the whole printed 120.
    const before = board(seed, { attacker: FOUR, bench: 1 });
    expect(before.players.p1.active?.energy).toHaveLength(3);
    expect(conditionHolds(before, "p1", { kind: "yourActiveEnergyAtLeast", count: 4 })).toBe(false);
    const done = attack(before);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(types(done.events)).not.toContain("EFFECT_PENDING");
    expect(types(done.events)).not.toContain("ENERGY_DISCARDED");
    expect(types(done.events)).not.toContain("SHUFFLE");
    // 🛑 THE GATE REFUSES THE QUESTION, NEVER THE ATTACK — and here that is carried by
    // the ABSENT `otherwise` plus the base staying outside the program, not by a
    // decline arm. §4 pins the absence; this is what it means on a board.
    expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.state.players.p2.active?.damage).toBe(100);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    // …and the CONTROL: the same board, the same seed, the REAL printing — which
    // charges three and is offered.
    expect(attack(board(seed, { bench: 1 })).state.phase.kind).toBe("effect:choose");
  });

  it.each(SEEDS)("seed %i — 🛑 the cost PARKS on a 4-Energy body, then the snipe parks again", (seed) => {
    // 🛑 TWO CONSECUTIVE PARKS INSIDE ONE CONFIRM'S `then`, which no board in D381's
    // suite reaches: `runProgram` splices a gate's branch into the SAME work queue it
    // walks, so the second park's `rest` is simply what is left of that queue.
    const before = board(seed, { colorless: 3, bench: 2 });
    expect(before.players.p1.active?.energy).toHaveLength(4);
    const parked = attack(before);
    const afterYes = say(parked.state, true);

    if (afterYes.state.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const pick = afterYes.state.phase.prompt;
    if (pick.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    // 🛑 THE CAPTION NAMES THE DESTINATION AND THE PRINTED VERB. A prompt still
    // reading "Discard 3 Energy from this Pokémon." over a pick that SHUFFLES is
    // D295's caption defect one destination over: the board would be right and the one
    // screen telling the player what their pick does would be wrong.
    expect(pick.note).toBe("Shuffle 3 Energy attached to this Pokémon into your deck.");
    expect(pick.scope).toEqual({ kind: "total", count: 3 });
    // FOUR offers and not two: `interchangeableCandidates` keeps `count` copies per
    // class, and the printed count is 3 — so all three identical {C} survive beside
    // the {W}, because a pick of three could want all of them.
    expect(pick.discardable).toHaveLength(4);
    const chosen = before.players.p1.active?.energy.slice(0, 3) ?? [];
    const afterPick = apply(afterYes.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: chosen },
    });

    // …and then the SECOND park, on a Bench of two.
    if (afterPick.state.phase.kind !== "effect:choose") throw new Error("expected the snipe park");
    const snipe = afterPick.state.phase.prompt;
    if (snipe.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(snipe.max).toBe(1);
    expect(snipe.note).toContain("120 damage");
    const done = apply(afterPick.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [snipe.candidates[0] as PokemonRef] },
    });
    // ONE Energy stayed on the body — the printed 3, not "all".
    expect(done.state.players.p1.active?.energy).toHaveLength(1);
    expect(done.state.players.p2.bench[0]?.damage).toBe(120);
    expect(done.state.players.p2.bench[1]?.damage).toBe(0);
    expect(done.state.players.p2.active?.damage).toBe(100);
  });
});
