import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
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
  POKEMON_TYPES,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter } from "./effects";
import { engineVersion, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction } from "./index";
import { countOwnerPokemonInPlay, countPokemonInPlay } from "./interpreter";
import { matchesFilter, topCardOf } from "./cards";
import {
  FIXTURE_POOL,
  IN_PLAY_BODIES_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.340.0 → 0.341.0 — 🆕🆕 D439: DAMAGE SCALED BY THE BODIES YOU HAVE IN PLAY,
// FILTERED BY THE PRINTED NOUN.
//
//   "This attack does 20 damage for each of your Pokémon in play."            1
//   "This attack does 20 damage for each of your Basic Pokémon in play."      1
//   "This attack does 30 damage for each of your Team Rocket's Pokémon in play."  2
//   "This attack does 30 damage for each of your {G} Pokémon in play."        2
//   "This attack does 40 more damage for each of your Evolution Pokémon in play." 2
//                                          — 5 sentences / 8 LEGAL printings
//
// THE FIFTEENTH `DamageCountSource`, AND THE FIRST WHOSE PAYLOAD IS A `CardFilter`.
// It is also the first BODY count in this union that reads the ACTIVE SPOT: the
// three that came before it (`yourBenchCount`, `opponentBenchCount`,
// `bothSidesBenchCount`) all read the printed word "Benched" and deliberately skip
// it, and this one reads the printed words "in play", which §4 defines as the
// Active plus the Bench.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
// The build has FIVE ways to be wrong and every one of them is a real neighbouring
// arm rather than a straw:
//
//   ⑴ THE ZONE. `benchBodies` sits three `case`s up in the same `switch` and is
//      what a slice reaching for the structurally nearest neighbour would call.
//      §3's canonical board fields ONE Active and FIVE Benched on the attacker's
//      side, and in `FILTERS` order (any / Basic / Team Rocket's / {G} / Evolution)
//      the truth is **6 / 2 / 1 / 3 / 4** while a Bench-only walk reads
//      **5 / 2 / 0 / 3 / 3**. ⚠️ **IT IS RIGHT ON TWO OF THE FIVE** — `basicPokemon`
//      and `typedPokemon`, because the Active is neither a Basic nor Grass — which
//      is exactly why the board is driven on all five filters rather than on one.
//   ⑵ THE SEAT. The printed word is "YOUR", and the attack damages the opponent,
//      so the seats are opposite ends of one swing. The defender's side is shaped
//      to answer **5 / 3 / 2 / 1 / 2** against the attacker's **6 / 2 / 1 / 3 / 4**,
//      so a side inversion moves every one of the five.
//   ⑶ THE FILTER. Five nouns, five `CardFilter` members, and the board gives five
//      DIFFERENT counts — so a build that read the wrong member is a different
//      number in every rung rather than a coincidence in one.
//   ⑷ THE FOLD. Four of the five sentences carry no "more" and land on the
//      MULTIPLY fold, where the printed base is DROPPED; the fifth carries "more"
//      and keeps it. §4 drives a board that matches NOTHING and asserts no
//      `DAMAGE_DEALT` at all on the `×` fold — a build that kept the base would
//      deal 30 there and be green everywhere else in this file.
//   ⑸ THE VOCABULARY. Two sentences reach the anchors and are DELIBERATELY LEFT
//      LOUD, for two different reasons — see §2.
//
// ⚠️ **THE ZONE WALK IS `countOwnerPokemonInPlay`'s, GENERALISED IN PLACE.** D242
// already answered *"how many of your <noun> Pokémon are in play"* for a
// `BoardCondition`; a second walk would have made "in play" a question with two
// implementations, and — because `D242-count-skips-the-active-spot` quotes that
// function's first line verbatim — a byte-identical copy would also have broken a
// shipped mutant row into a `2×` ERROR without anybody touching it (D416/D437).
// So the old function is now a two-line adapter over `countPokemonInPlay`, and §3
// drives BOTH names on ONE board to pin that they cannot disagree.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes, off `legalAttackCorpus()` — the committed `legal_standard = 1`
// attack column. `Pokémon` carries the real é (U+00E9) in every slot and the
// possessive in the owner sentence is U+0027, checked rather than remembered
// (D421's byte, and the reason this comment names it).
// ─────────────────────────────────────────────────────────────────────────────
const ANY_BODIES = "This attack does 20 damage for each of your Pokémon in play.";
const BASIC_BODIES = "This attack does 20 damage for each of your Basic Pokémon in play.";
const TR_BODIES = "This attack does 30 damage for each of your Team Rocket's Pokémon in play.";
const GRASS_BODIES = "This attack does 30 damage for each of your {G} Pokémon in play.";
const EVOLUTION_BODIES = "This attack does 40 more damage for each of your Evolution Pokémon in play.";

/** The five, in fixture-attack order. */
const CLAIMED = [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES, EVOLUTION_BODIES] as const;

/** 🛑 THE TWO SENTENCES THE ANCHORS REACH AND THE VOCABULARY REFUSED, AND THEY WERE
    REFUSED FOR TWO DIFFERENT REASONS. Both are real catalog rows.
    🆕🆕 **D466 — ONE OF THE TWO HAS NOW LEFT, WHICH IS WHAT THE TWO REASONS PREDICTED.**
    `STAGE1_BODIES` is BUILT (`censusAttackCorpus.ts` file line 586, 1 legal printing) and
    the constant is KEPT under its own name because §1's family enumeration and §2's
    named-owner rung both still need the bytes; `ANCIENT_BODIES` has not moved and cannot,
    for the reason recorded at its refusal. */
const ANCIENT_BODIES = "This attack does 30 damage for each of your Ancient Pokémon in play.";
const STAGE1_BODIES = "This attack does 40 damage for each of your Stage 1 Pokémon in play.";
/** 🆕🆕 D466 — the OTHER printed stage row, and it is a DIFFERENT ANCHOR, a DIFFERENT
    FOLD and a DIFFERENT ZONE from every constant above: `censusAttackCorpus.ts` **file
    line 589**, **2 legal printings**, the ONLY row in the whole column whose noun is
    scoped by a trailing *"on your Bench."* (measured — `grep "on your Bench"` over the
    corpus returns nine rows, eight of them `^If …, this attack does N more damage\.$`
    antecedents the clause table already reads).
    The bytes are taken from the corpus rather than retyped (D183/D456) — §8's first rung
    asserts exactly that. */
const BENCH_STAGE2 = "This attack does 40 more damage for each Stage 2 Pokémon on your Bench.";

/** 🛑 THE OPPONENT-SIDE ROWS — real printings, refused by the `(?!opponent)`
    lookahead before the vocabulary is ever consulted. */
const FOE_EX_BODIES = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";
const FOE_EX_V_BODIES =
  "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.";

/** 🛑 THE COMPOUND — the family's one, and it does NOT compose. */
const DRIFLOON_COMPOUND =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** 🛑 THE MID-SENTENCE NOUN — 3 sentences / 6 printings, the largest countable
    record in this family and the one this slice does NOT take. Its noun is not a
    prefix noun (" in play" sits in the MIDDLE), so it cannot ride these anchors at
    all, and it needs a `CardFilter` member reading `attacksOf`. */
const ROUND_BODIES = "This attack does 20 damage for each of your Pokémon in play that has the Round attack.";

/** The BENCHED twin of this member's noun — a real printing, already built as
    `yourBenchCount` (D282). It is the whole of ⑴ above stated as printed text:
    the same verb, the same fold, one word different, and a different number on
    every board with an Active. */
const BENCHED_BODIES = "This attack does 20 damage for each of your Benched Pokémon.";

/** One seed for the whole suite. Nothing here flips a coin and every Active and
    every Benched body is placed by surgery, so a seed table would describe a
    shuffle rather than a rule. */
const SEED = 1;

/** The five filters, in the same order as `CLAIMED`. */
const FILTERS: readonly CardFilter[] = [
  { kind: "anyPokemon" },
  { kind: "basicPokemon" },
  { kind: "ownerPokemon", owner: "Team Rocket" },
  { kind: "typedPokemon", pokemonType: "Grass" },
  { kind: "evolutionPokemon" },
];

/** 🆕 D466 — printings, summed. The house `units` helper, local because this suite
    had no census rung until §8 and did not need one. */
function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active`);
  return body;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both Actives are placed by surgery and BOTH Benches are
    cleared to nothing: every number this suite reads is a POPULATION, so a body
    the setup shuffle happened to place would move the answer silently. One {C} is
    attached to pay the printed cost of all five attacks. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: IN_PLAY_BODIES_DECK, p2: IN_PLAY_BODIES_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-inplaybodies");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function benched(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

/** 🛑 **THE CANONICAL BOARD, AND THE FIVE FILTERS ANSWER FIVE DIFFERENT NUMBERS.**

      attacker's side                          defender's side
        Active  fix-inplaybodies (TR, Dark, Stage 1)   fix-titan (Colorless Basic)
        Bench   fix-grass-stage1 ×2                     fix-tr-stage1 ×2
                fix-stage1                              fix-grass-basic
                fix-benchfiller                         fix-benchfiller
                fix-grass-basic

    In `FILTERS` / attack-index order — any, Basic, Team Rocket's, {G}, Evolution:

      anyPokemon       6   ×20 → 120        (opponent 5)
      basicPokemon     2   ×20 →  40        (opponent 3)
      ownerPokemon     1   ×30 →  30        (opponent 2)
      typedPokemon{G}  3   ×30 →  90        (opponent 1)
      evolutionPokemon 4   40 + 4×40 → 200  (opponent 2)

    Every wrong answer is a different number from every other wrong answer, on one
    setup: a Bench-only walk reads **5 / 2 / 0 / 3 / 3**, a seat inversion reads
    **5 / 3 / 2 / 1 / 2**, and a wrong filter reads one of the other four rows. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = benched(bare(by), by, [
    "fix-grass-stage1",
    "fix-grass-stage1",
    "fix-stage1",
    "fix-benchfiller",
    "fix-grass-basic",
  ]);
  state = benched(state, foe, [
    "fix-tr-stage1",
    "fix-tr-stage1",
    "fix-grass-basic",
    "fix-benchfiller",
  ]);
  return state;
}

/** 🆕🆕 D446 — **THE ROUND BOARD.** The canonical board is left EXACTLY as it was
    (every number in §3-§5 is a population figure and a body added there would move
    all five silently), so the two new members get boards of their own.

      attacker's side                        defender's side
        Active  fix-inplaybodies ("Round")     fix-titan   (no attacks)
        Bench   fix-roundbody ×2               fix-roundbody
                fix-attacker-ex ("Bite")       fix-benchfiller
                fix-benchfiller

    `attackNamePokemon { attack: "Round" }` answers **3** on the attacker's side and
    **1** on the defender's, and every wrong build reads a different number on this
    one board:
      • a BENCH-ONLY walk (D439's `benchBodies`, three cases up in the evaluator)
        drops the Active and reads **2**;
      • a SEAT INVERSION reads **1**;
      • `attacksOf(card).length > 0` instead of the NAME counts `fix-attacker-ex`
        and reads **4**;
      • an unfiltered `anyPokemon` reads **5**.
    Five distinguishable answers, one setup. */
function roundBoard(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, [
    "fix-roundbody",
    "fix-roundbody",
    "fix-attacker-ex",
    "fix-benchfiller",
  ]);
  return benched(state, foe, ["fix-roundbody", "fix-benchfiller"]);
}

/** 🆕🆕 D446 — **THE RULE-BOX BOARD.**

      attacker's side                        defender's side
        Active  fix-inplaybodies               fix-titan        (no suffix)
        Bench   fix-attacker-ex  ("Fixmon ex")  fix-attacker-ex ×2
                fix-benchfiller                fix-pokemon-v    ("Fixmon V")
                                               fix-pokemon-vmax ("Fixmon VMAX")
                                               fix-benchfiller

    `suffixPokemon { suffix: "ex" }` answers **2** on the defender's side and **1**
    on the attacker's; the `anyOf` pair answers **3** and **1**. The wrong builds:
      • a SEAT INVERSION reads 1 for both attacks, collapsing the pair's difference;
      • `hasRuleBox` (or `isExOrV` on the BARE-ex row) counts the VMAX and reads
        **3** where the bare noun means 2 — which is the whole reason the member is
        an equality on `pokemonSuffixOf` rather than either wider neighbour;
      • an `every` reading of `anyOf` (D245's shipped mutant) reads **0**, because no
        body is both an ex and a V.
    ⚠️ The defender's Active is deliberately NOT a rule box, so a build that read
    only the Active Spot reads 0 and a build that skipped it reads the same as the
    right one — which is why §7 drives the Bench figures against the pair rather
    than against a single number. */
/** 🆕🆕 D466 — **THE STAGE BOARDS.** TWO of them, for D446's stated reason: the canonical
    board is left EXACTLY as it was (every number in §3-§5 is a population figure and a
    body added there would move all five silently), and the two printed stage rows ask
    questions at two different ZONES, so one board cannot answer both without a
    coincidence.

    ⚠️ **AND THE CANONICAL BOARD COULD NOT HAVE ANSWERED EITHER, WHICH IS THE CONFOUND
    THIS PAIR EXISTS TO BREAK.** Every Evolution on it is a Stage 1 (`fix-grass-stage1`,
    `fix-stage1`, the Active `fix-inplaybodies`), so `stagePokemon{Stage1}` and
    `evolutionPokemon` both answer **4** there — the two members would be
    indistinguishable and the rung would pass on the wrong filter.

    ── `stage1Board` — file line 586, the `×` fold, ZONE = in play ──────────────────

      attacker's side                          defender's side
        Active  fix-inplaybodies (Stage 1)       fix-titan  (Basic)
        Bench   fix-stage2body                   fix-grass-stage1 ×2
                fix-grass-stage1 ×2              (nothing else)
                fix-stage1
                fix-benchfiller

    `stagePokemon{Stage1}` in play answers **4** on the attacker's side, and every wrong
    build reads a different number on this ONE board:
      • a BENCH-ONLY walk drops the Active and reads **3**;
      • `stagePokemon{Stage2}` — the OTHER ordinal — reads **1**;
      • `evolutionPokemon` — the neighbouring member, and the one a build reaching for
        the nearest thing would use — reads **5**;
      • `anyPokemon` reads **6**;
      • a SEAT INVERSION reads **2**.
    Six distinguishable answers, one setup, and ×40 makes them 160 / 120 / 40 / 200 /
    240 / 80.

    ⚠️ **NO ID IS ASKED FOR MORE THAN TWICE PER SEAT, AND THAT IS A CONSTRAINT RATHER
    THAN A STYLE.** `benchFromDeck` pulls from the seat's DECK, and setup has already
    moved 7 cards to hand and 6 to prizes before any surgery runs — so a board that
    wanted 4 of a 4-copy id threw *"p2 deck has no fix-stage1"* at SEED 1. Every board
    above it in this file asks for at most 2, and this pair now does too.

    ── `stage2Board` — file line 589, the `+` fold, ZONE = your Bench ───────────────

      attacker's side                          defender's side
        Active  fix-stage2body  (Stage 2)        fix-titan  (Basic)
        Bench   fix-stage2body                   fix-grass-stage1 ×2
                fix-stage1 ×2                    fix-benchfiller ×2
                fix-grass-stage1
                fix-benchfiller

    `yourBenchCount{stagePokemon Stage2}` answers **1**, and:
      • an "IN PLAY" walk counts the Active — which IS a Stage 2, deliberately — and
        reads **2**;
      • `stagePokemon{Stage1}` over the same Bench reads **3**;
      • `evolutionPokemon` reads **4**;
      • the UNFILTERED `yourBenchCount` (i.e. the optional field ignored) reads **5**;
      • a SEAT INVERSION reads **0**.
    Six distinguishable answers again. ⚠️ **THE SEAT CONTROL IS A ZERO AND THAT IS SAID
    OUT LOUD RATHER THAN GLOSSED**: the defender's Bench holds no Stage 2, so a seat
    inversion lands the printed base ALONE (40). It is distinguishable — the additive
    fold KEEPS its base, so a `DAMAGE_DEALT` of 40 is still filed — and §8 also drives
    the whole board from the OTHER CHAIR, where the same inversion reads 1 instead of 0.
    A defender count of 1..5 was checked and every value collides with one of the five
    wrong builds above; 0 is the only free number on a five-slot Bench. */
function stage1Board(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, [
    "fix-stage2body",
    "fix-grass-stage1",
    "fix-grass-stage1",
    "fix-stage1",
    "fix-benchfiller",
  ]);
  return benched(state, foe, ["fix-grass-stage1", "fix-grass-stage1"]);
}

/** The Stage 2 board — see `stage1Board`'s block. The Active is REPLACED rather than
    left as `bare()` put it, because the sentence is printed on `fix-stage2body` and
    `attack()` reads the sentence off the attacking card. */
function stage2Board(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  // ⚠️ `setActiveFromDeck` DISPLACES the sitting Active onto the Bench rather than
  // discarding it, so the `clearBench` is not tidiness — without it `bare()`'s
  // `fix-inplaybodies` occupies a Bench slot, the five below overflow to six and the
  // helper throws. The Energy is re-attached because `bare()` attached it to the body
  // that just left the Active Spot.
  let state = setActiveFromDeck(bare(by), by, "fix-stage2body");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = benched(state, by, [
    "fix-stage2body",
    "fix-stage1",
    "fix-stage1",
    "fix-grass-stage1",
    "fix-benchfiller",
  ]);
  return benched(state, foe, [
    "fix-grass-stage1",
    "fix-grass-stage1",
    "fix-benchfiller",
    "fix-benchfiller",
  ]);
}

function ruleBoxBoard(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, ["fix-attacker-ex", "fix-benchfiller"]);
  return benched(state, foe, [
    "fix-attacker-ex",
    "fix-attacker-ex",
    "fix-pokemon-v",
    "fix-pokemon-vmax",
    "fix-benchfiller",
  ]);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, the population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the five printed sentences, their population, and the fixture", () => {
  it("the column prints the five on five records, 8 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1, 1, 1]);
    expect(rows.map((r) => r.reduce((sum, [n]) => sum + n, 0))).toEqual([1, 1, 2, 2, 2]);
    expect(rows.flat().reduce((sum, [n]) => sum + n, 0)).toBe(8);
  });

  it("🛑 the WHOLE 'for each of your … in play' family, printed whole and classified", () => {
    // ⚠️ **THE ENUMERATION IS THE UNRELIABLE PART** (D424/D428), so this rung takes
    // the LOOSEST plausible shape — every corpus row containing "for each of your"
    // and ending " in play." — and asserts the WHOLE list rather than a count. It
    // cannot be truncated on either axis, because a missing row is a `toEqual`
    // failure naming the row.
    const family = legalAttackCorpus()
      .filter(([, s]) => s.includes("for each of your") && s.endsWith(" in play."))
      .map(([, s]) => s)
      .sort();
    expect(family).toEqual(
      [
        ANY_BODIES,
        BASIC_BODIES,
        ANCIENT_BODIES,
        TR_BODIES,
        GRASS_BODIES,
        STAGE1_BODIES,
        EVOLUTION_BODIES,
        FOE_EX_BODIES,
        FOE_EX_V_BODIES,
      ].sort(),
    );
    // …so the family is NINE sentences, of which D439/D446 claimed FIVE. The other
    // four were the two data/vocabulary refusals and the two opponent-side rows.
    expect(family).toHaveLength(9);
    // 🆕🆕 **D466 — SIX OF THE NINE ARE CLAIMED NOW, AND THE LIST ITSELF DID NOT MOVE.**
    // `STAGE1_BODIES` is still a member of this population — the anchor always reached
    // it — and what changed is the VOCABULARY behind it, which is exactly why the
    // classification is asserted separately from the enumeration. The partition is
    // re-derived live rather than decremented, so a reader that widened past its noun
    // moves the CLAIMED half and this rung names which row.
    const claimedNow = family.filter((s) => resolvedByAnyReader(s)).sort();
    expect(claimedNow).toEqual(
      [
        ANY_BODIES,
        BASIC_BODIES,
        TR_BODIES,
        GRASS_BODIES,
        EVOLUTION_BODIES,
        STAGE1_BODIES,
        FOE_EX_BODIES,
        FOE_EX_V_BODIES,
      ].sort(),
    );
    // 🛑 **EIGHT OF THE NINE, AND THE TWO FOE ROWS ARE IN THE CLAIMED HALF — WHICH THE
    // FIRST DRAFT OF THIS RUNG GOT WRONG.** They are refused by the `(?!opponent)`
    // lookahead on the ATTACKER's two anchors and claimed by `IN_PLAY_FOE_BODY_MULTIPLY`
    // in the `×` reader (D446), so "refused by an anchor" and "unclaimed" are different
    // propositions and this population answers the second. ⚠️ **ONE is still LOUD, by
    // name**: ANCIENT, which is DATA-blocked forever.
    expect(family.filter((s) => !resolvedByAnyReader(s))).toEqual([ANCIENT_BODIES]);
  });

  it("carries fix-inplaybodies's nine printed attacks, `×` and `+` markers included", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode). ⚠️ THE TRAILING MARKERS ARE LOAD-BEARING: `×` is what tells attack.ts
    // to DROP the printed base and `+` is what tells it to keep it, and four of
    // these five sentences land on the `×` fold.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["20×", ANY_BODIES],
      ["20×", BASIC_BODIES],
      ["30×", TR_BODIES],
      ["30×", GRASS_BODIES],
      ["40+", EVOLUTION_BODIES],
      // 🆕🆕 D446 — the three this slice adds, all on the `×` fold, which is the
      // whole census: the column prints the "more" form of neither new noun.
      ["20×", ROUND_BODIES],
      ["60×", FOE_EX_BODIES],
      ["60×", FOE_EX_V_BODIES],
      // 🆕🆕 D466 — the ninth, on the `×` fold, and the fold is a MEASUREMENT: the
      // column prints file line 586 with no "more" and prints the additive form of
      // this noun ZERO times (D435 — not incrementing is also a measurement).
      ["40×", STAGE1_BODIES],
    ]);
    // 🆕🆕 D446 — THE HOLDER'S OWN SIXTH ATTACK IS NAMED "Round", WHICH IS WHAT
    // MAKES THE ACTIVE SPOT'S PARTICIPATION OBSERVABLE FROM THIS ONE CARD (§7), and
    // it is the print rather than a trick: the real Round attacks count Pokémon
    // that have the Round attack, the attacker included.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => a.name)).toEqual([
      "Full House",
      "Rookie Rush",
      "Syndicate Strike",
      "Verdant Tally",
      "Lineage Press",
      "Round",
      "Rule Breaker",
      "Class Action",
      "Second Rung",
    ]);
    // 🆕🆕 D466 — and the STAGE-2 holder, whose own stage is the load-bearing field:
    // it is the ATTACKER of file line 589 AND a body that satisfies the printed noun,
    // which is what makes the "in play" misread (Active + Bench) a DIFFERENT number
    // from the printed Bench-only one on §8's board.
    expect(FIXTURE_POOL["fix-stage2body"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["fix-stage2body"]?.evolveFrom).toBe("fix-stage1");
    expect(FIXTURE_POOL["fix-stage2body"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["40+", BENCH_STAGE2],
    ]);
    // …and the holder of file line 586 is ITSELF a Stage 1, which is the same trick
    // one zone over: the Active participates in an "in play" count and does not
    // participate in a Bench one.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.stage).toBe("Stage1");
    // …and the bodies the two new filters are read against carry exactly the fields
    // the filters read and nothing else — a rule-box marker in the NAME
    // (`pokemonSuffixOf`) and an attack NAME (`attacksOf`).
    expect(FIXTURE_POOL["fix-roundbody"]?.attacks?.map((a) => a.name)).toEqual(["Round"]);
    expect(FIXTURE_POOL["fix-attacker-ex"]?.name).toBe("Fixmon ex");
    expect(FIXTURE_POOL["fix-pokemon-v"]?.name).toBe("Fixmon V");
    expect(FIXTURE_POOL["fix-pokemon-vmax"]?.name).toBe("Fixmon VMAX");
    // 🛑 THE TWO NEGATIVES OF `attackNamePokemon`, AND THEY ARE DIFFERENT NEGATIVES:
    // the filler has NO attacks and is false through the empty list, `fix-attacker-ex`
    // has two and is false through the NAME — which is the one a build reading
    // `attacksOf(card).length > 0` gets wrong.
    expect(FIXTURE_POOL["fix-benchfiller"]?.attacks).toBeNull();
    expect(FIXTURE_POOL["fix-attacker-ex"]?.attacks?.map((a) => a.name)).toEqual([
      "Bite",
      "Spread Shot",
    ]);
    // The prefixed NAME is the load-bearing field for the owner filter, and it is a
    // SECOND prefixed body distinct from `fix-tr-stage1`.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.name).toBe("Team Rocket's Fixmon");
    expect(FIXTURE_POOL["fix-tr-stage1"]?.name).toBe("Team Rocket's Persian");
  });

  it("AUTHORS nothing — every printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-inplaybodies")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the readers, the vocabulary, and the near misses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the two anchors and the `inPlayBodyFilter` vocabulary", () => {
  it("reads each printed noun as the `CardFilter` member that already spelled it", () => {
    expect(deriveAttackDamageMultiplier(ANY_BODIES)).toEqual({
      per: 20,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "anyPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(BASIC_BODIES)).toEqual({
      per: 20,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "basicPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(TR_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "ownerPokemon", owner: "Team Rocket" },
      },
    });
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    // …and the ONE sentence on the additive fold, which is the one that carries
    // "more". The adjective picks the fold, exactly as it does for the Bench trio.
    expect(deriveAttackDamageBonus(EVOLUTION_BODIES)).toEqual({
      per: 40,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "evolutionPokemon" } },
    });
  });

  it("🛑 the FOLD is the adjective and nothing else — each sentence reaches ONE reader", () => {
    // Turns red the moment somebody gives the other fold a matching arm "for
    // symmetry", which would author four cards the catalog does not print.
    for (const text of [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamagePenalty(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackDamageMultiplier(EVOLUTION_BODIES)).toBeNull();
    expect(deriveAttackDamagePenalty(EVOLUTION_BODIES)).toBeNull();
    expect(deriveAttackEffect(EVOLUTION_BODIES)).toBeNull();
  });

  it("🛑 the ONE remaining LOUD sentence is refused by the VOCABULARY, not by the anchor", () => {
    // ⚠️ **TWO REFUSALS, TWO REASONS, AND THE DISTINCTION WAS THE POINT — AND D466 IS
    // WHAT PROVED THE DISTINCTION WAS REAL.**
    //   • `Ancient` is DATA-BLOCKED and permanently so — the banner is in no
    //     catalog column and no tcgdex field, and a name-keyed species table is
    //     refused at `PREVENT_DAMAGE_FROM_CLASS`'s own site because the banner is a
    //     per-PRINTING fact. Nothing in effects.ts can ever be the fix.
    //   • `Stage 1` was merely UNBUILT: *"`isBasicPokemon` and `evolveFromOf` both
    //     exist, but no `CardFilter` member reads a printed stage ORDINAL"* — and
    //     ✅ **D466 WROTE THAT MEMBER** (`stagePokemon`), so this row LEFT the loud
    //     path while its neighbour did not move an inch. The two-reason split is kept
    //     as the record of a prediction that came true.
    // Only `Ancient` must stay on the loud ATTACK_EFFECT_SKIPPED path.
    for (const text of [ANCIENT_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    // 🆕🆕 **D466 — AND THE ROW THAT LEFT IS PINNED ON THE OTHER SIDE OF THE SAME
    // PREDICATE** (D444/D447: record the transition rather than quietly shrinking).
    expect(deriveAttackDamageMultiplier(STAGE1_BODIES)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "stagePokemon", stage: "Stage1" },
      },
    });
    // ⚠️ **AND THE ADMISSION THAT MAKES THE REFUSAL MEAN SOMETHING** (D424): the
    // anchors really do reach both strings, so what refuses them is the map. The
    // near-miss differs from `ANCIENT_BODIES` on exactly ONE axis — the noun —
    // and is claimed.
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).not.toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Evolution Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "evolutionPokemon" } },
    });
  });

  it("🛑 the `(?!opponent)` lookahead keeps the ATTACKER's anchor off the foe's rows", () => {
    // 🛑 **D407's DEFECT, REACHED FROM THE CAPTURE SIDE.** `for each of your ` is
    // also the head of "for each of your opponent's …", so without the lookahead
    // the noun would capture as `opponent's Pokémon ex` and the sentence would be
    // scored off the ATTACKER's board.
    //
    // 🆕🆕 **D446 — AND THE DAY D439 NAMED HAS ARRIVED, WHICH PROMOTES THIS GUARD
    // FROM PROSPECTIVE TO LIVE.** D439 wrote here that *"today the vocabulary would
    // refuse that noun anyway; the lookahead is what stops the refusal turning into
    // a WRONG CARD the day a rule-box `CardFilter` member lands."* That member has
    // landed. The two printed rows are still not the sharpest witness — their noun
    // (`opponent's Pokémon ex`) misses `inPlayBodyFilter` on every branch, so a
    // lookahead-free build would fall THROUGH the attacker arm and reach the foe
    // anchor anyway — but a noun the map DOES hold no longer does, and that
    // sentence is the one below.
    for (const text of [FOE_EX_BODIES, FOE_EX_V_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toEqual({
        per: 60,
        count: {
          kind: "pokemonInPlay",
          seat: "opponent",
          filter:
            text === FOE_EX_BODIES
              ? { kind: "suffixPokemon", suffix: "ex" }
              : {
                  kind: "anyOf",
                  filters: [
                    { kind: "suffixPokemon", suffix: "ex" },
                    { kind: "suffixPokemon", suffix: "V" },
                  ],
                },
        },
      });
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    // 🛑 **THE WITNESS THAT MAKES THE LOOKAHEAD OBSERVABLE, and it is CONSTRUCTED
    // and labelled so** (D440's posture — a reader is a function of TEXT, so a rung
    // over text the column does not print is a claim about the READER, and that is
    // exactly what is needed when no printed row can separate two builds).
    // `opponent's Pokémon` DOES resolve through `IN_PLAY_OWNER_NOUN`
    // (`^(.+)['’]s Pokémon$`, owner = "opponent"), so a build without the lookahead
    // returns a NON-NULL reading here — `{ seat: "you", ownerPokemon "opponent" }`,
    // scoring the opponent's sentence off the attacker's board against a subgroup
    // no card is in, i.e. 0 forever. With the lookahead the attacker arm cannot
    // match and the foe anchor reads it correctly.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each of your opponent's Pokémon in play.",
      ),
    ).toEqual({
      per: 60,
      count: { kind: "pokemonInPlay", seat: "opponent", filter: { kind: "anyPokemon" } },
    });
    // ⚠️ **THE ONE-AXIS CONTROL, AND IT IS NOW AN ADMITTED TWIN RATHER THAN A
    // SECOND REFUSAL.** The same sentence with `opponent's ` deleted and NOTHING
    // else changed is a constructed string (the column prints no own-side
    // "Pokémon ex" count, measured over all 640 rows) — and it is CLAIMED, on the
    // attacker's seat, because `IN_PLAY_BODY_NOUNS` is shared whole between the two
    // anchors (D159). So the pair separates the two anchors on exactly the seat
    // token and on nothing else: same noun, same filter, different `seat`.
    expect(
      deriveAttackDamageMultiplier("This attack does 60 damage for each of your Pokémon ex in play."),
    ).toEqual({
      per: 60,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "suffixPokemon", suffix: "ex" } },
    });
    // …and the same edit on a noun the map has held since D439 reads the same way,
    // which is what makes "one vocabulary, two seats" a testable claim rather than
    // a description.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's {G} Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "opponent",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    // 🛑 **THE STRING THE LOOKAHEAD ACTUALLY SAVES US FROM, AND IT IS THE OWNER
    // PATTERN THAT MAKES IT DANGEROUS.** `IN_PLAY_OWNER_NOUN` captures its owner
    // rather than listing it — deliberately, so a sixth prefix printing needs no
    // code — which means the noun `opponent's Team Rocket's Pokémon` RESOLVES,
    // to `{ kind: "ownerPokemon", owner: "opponent's Team Rocket" }`, scored off the
    // ATTACKER's board against a subgroup no card is in. 🆕🆕 **D446 — THE OWNER
    // HERE IS DOUBLED WHERE D439's WITNESS WAS BARE, AND THAT IS THE REPAIR RATHER
    // THAN A FLOURISH.** D439's witness was `opponent's Pokémon`, asserted null;
    // that string is now CLAIMED by the foe anchor (correctly, as the opponent's
    // `anyPokemon`), so re-pointing it to `.not.toBeNull()` would have produced a
    // true assertion that is true under the lookahead-free build as well — D418's
    // disarmed-tripwire shape exactly. This subject still HAS the old property:
    // with the lookahead it reads the opponent's `Team Rocket's` subgroup, and
    // without it the attacker's `opponent's Team Rocket's` one, so the two builds
    // disagree and the rung can still go red. ⚠️ CONSTRUCTED, and labelled so.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's Team Rocket's Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "opponent",
        filter: { kind: "ownerPokemon", owner: "Team Rocket" },
      },
    });
  });

  it("🛑 the `[^.]+` capture cannot cross a sentence break — the COMPOUND stays whole", () => {
    // A greedy `(.+)` would let the anchor span the break on any compound that
    // happens to end in a period, which is the anchor-swallows-a-compound defect
    // D207 paid for three times. A class that cannot match `.` cannot do it.
    expect(deriveAttackDamageMultiplier(DRIFLOON_COMPOUND)).toBeNull();
    expect(deriveAttackDamageBonus(DRIFLOON_COMPOUND)).toBeNull();
    // The constructed two-sentence form built out of a noun the map DOES hold —
    // one axis from `GRASS_BODIES`, which is claimed.
    expect(deriveAttackDamageMultiplier(`${GRASS_BODIES} ${GRASS_BODIES}`)).toBeNull();
    // 🛑 **AND THE COMPOUND THAT A GREEDY `(.+)` WOULD ACTUALLY CLAIM.** The owner
    // pattern's own open-endedness is again what makes the swallow dangerous: with
    // `.+` the capture spans the sentence break and ends on `…'s Pokémon`, so
    // `IN_PLAY_OWNER_NOUN` matches and the engine authors a filter whose `owner` is
    // half a printed card. ⚠️ CONSTRUCTED, and labelled so — but the SHAPE is real:
    // the family's one printed compound (`DRIFLOON_COMPOUND`) is two sentences of
    // exactly this form, and it is only its parenthetical third part that keeps it
    // off this pattern today.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Pokémon in play. Discard 2 of your Team Rocket's Pokémon in play.",
      ),
    ).toBeNull();
  });

  it("🛑 the COMPOUND does not COMPOSE either, and the reason is its TAIL", () => {
    // D426's mechanism at the three-way end, measured rather than assumed:
    // `COMPOUND_CLAUSE_BREAK` splits this row into THREE parts, so the tail is the
    // parenthetical W/R reminder — which `deriveAttackEffect` refuses. That is the
    // FIRST guard `splitAttackTrailingClause` applies, so the head is never even
    // consulted and claiming the head buys ZERO census printings.
    expect(splitAttackTrailingClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(splitAttackGateClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(deriveAttackEffect("(Don't apply Weakness and Resistance for Benched Pokémon.)")).toBeNull();
    // …and the row is therefore STILL unresolved at this head, which is the honest
    // statement of what this slice did and did not buy.
    expect(resolvedByAnyReader(DRIFLOON_COMPOUND)).toBe(false);
  });

  it("🛑 the MID-SENTENCE noun rides its OWN anchor — the Round family, and its zone twin", () => {
    // 3 sentences / 6 printings, the largest countable record this family's residue
    // held. 🆕🆕 **D446 — D439 REFUSED IT AND THIS SLICE TAKES IT**, and the refusal
    // was right about its own measurement: the " in play" sits in the MIDDLE of the
    // noun phrase, so the trailing ` in play\.$` cannot match it and it needed its
    // OWN anchor AND a `CardFilter` member reading `attacksOf`. Both were paid.
    //
    // ⚠️ **THE OLD RUNG WAS `resolvedByAnyReader(ROUND_BODIES) === false` — A
    // THIRTEEN-WAY NEGATIVE — AND IT IS NOT REPLACED BY ITS `=== true`** (D438, the
    // shape that produced D436's GAP). What replaces it is the NAMED owner plus the
    // twelve kept refusals, which is strictly stronger in both directions.
    for (const per of [20, 40, 70]) {
      const text = `This attack does ${per} damage for each of your Pokémon in play that has the Round attack.`;
      expect(deriveAttackDamageMultiplier(text)).toEqual({
        per,
        count: {
          kind: "pokemonInPlay",
          seat: "you",
          filter: { kind: "attackNamePokemon", attack: "Round" },
        },
      });
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    const round = legalAttackCorpus().filter(
      ([, s]) => s.includes("in play that has the Round attack"),
    );
    expect(round).toHaveLength(3);
    expect(round.reduce((sum, [n]) => sum + n, 0)).toBe(6);
    // …and all three are the CORPUS rows, not three strings this rung built: the
    // constructed loop above and the census below name the same set.
    expect(round.map(([, text]) => deriveAttackDamageMultiplier(text)?.per).sort()).toEqual([
      20, 40, 70,
    ]);
    // 🛑 **THE NEW SUBJECT FOR THE OLD DISCRIMINATION (D444), AND IT IS A REAL
    // PRINTING RATHER THAN A CONSTRUCTED NEAR-MISS.** *"This attack does 20 damage
    // for each Pokémon in your discard pile that has the United Wings attack."*
    // (1 legal) differs from the Round rows on exactly ONE axis — the ZONE — and it
    // is STILL unclaimed by every reader, because the discard-pile anchors end at
    // `discard pile\.$` and its noun is split around the zone phrase. Its filter is
    // now spellable (`attackNamePokemon` is exactly what D440 said it needed), so it
    // is blocked ONCE where it used to be blocked twice, and this rung is what
    // reddens the day somebody widens that anchor.
    const unitedWings =
      "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";
    expect(legalAttackCorpus().filter(([, text]) => text === unitedWings)).toHaveLength(1);
    expect(resolvedByAnyReader(unitedWings)).toBe(false);
    expect(deriveAttackDamageMultiplier(unitedWings)).toBeNull();
    expect(deriveAttackDamageBonus(unitedWings)).toBeNull();
  });

  it("the whole-sentence anchor holds at both ends and on the leading capital", () => {
    // The family's stated anchor discipline: no /i, a required trailing period, a
    // capital `This`, and no leading or trailing text. Each of these would be
    // admitted by a search-style pattern, and each differs from `GRASS_BODIES` on
    // exactly ONE axis.
    expect(
      deriveAttackDamageMultiplier("this attack does 30 damage for each of your {G} Pokémon in play."),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your {G} Pokémon in play"),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${GRASS_BODIES}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(`${GRASS_BODIES} Discard an Energy from this Pokémon.`),
    ).toBeNull();
    // A printed 0 does nothing and stays LOUD — the guard every arm in both
    // families carries, and it is a SEPARATE guard from the vocabulary: this string
    // has a noun the map holds, so only `per >= 1` can be refusing it.
    expect(
      deriveAttackDamageMultiplier("This attack does 0 damage for each of your {G} Pokémon in play."),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("This attack does 0 more damage for each of your Evolution Pokémon in play."),
    ).toBeNull();
    // …and the capture really is a capture, driven on CONSTRUCTED text that is
    // labelled as constructed rather than presented as a card (D121).
    expect(
      deriveAttackDamageMultiplier("This attack does 70 damage for each of your {G} Pokémon in play."),
    ).toEqual({
      per: 70,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "typedPokemon", pokemonType: "Grass" } },
    });
  });

  it("🆕🆕 the SAME anchor discipline on both new anchors — a `$` each, driven", () => {
    // 🛑 **THIS RUNG EXISTS BECAUSE A MUTANT SURVIVED**, which is the honest reason
    // and the one worth writing down: `D446-foe-anchor-loses-its-terminator` was
    // authored, probed, and came back SURVIVED — a real gap in the suite, not a
    // wrong tally (D439's rule: a surviving mutant is a claim about your prose as
    // often as about your tests). The rung above drives the `$` on D439's anchor
    // and nothing drove it on either of D446's. ⚠️ **AND THE `[^.]+` CAPTURE IS
    // WHAT MAKES THE `$` THE ONLY THING REFUSING**: a class that cannot cross a `.`
    // stops the noun at the sentence break by itself, so without the terminator the
    // pattern is a clean PREFIX match and the tail is silently unread — the card
    // scores, the compound's second clause never runs, and nothing is loud.
    for (const head of [FOE_EX_BODIES, ROUND_BODIES]) {
      expect(deriveAttackDamageMultiplier(head)).not.toBeNull();
      // …the SAME string with a second sentence appended, one axis apart.
      expect(
        deriveAttackDamageMultiplier(`${head} Discard an Energy from this Pokémon.`),
      ).toBeNull();
      // …and the other three discipline axes, each one axis from the head.
      expect(deriveAttackDamageMultiplier(head.replace("This", "this"))).toBeNull();
      expect(deriveAttackDamageMultiplier(head.slice(0, -1))).toBeNull();
      expect(deriveAttackDamageMultiplier(`Flip a coin. ${head}`)).toBeNull();
      // …and the printed-zero guard, which is a SEPARATE guard from the anchor:
      // these strings carry a noun both readers hold, so only `per >= 1` refuses.
      expect(deriveAttackDamageMultiplier(head.replace(/does \d+ damage/, "does 0 damage"))).toBeNull();
    }
  });

  it("🛑 the vocabulary's three branches are PAIRWISE DISJOINT, over the whole of it", () => {
    // ⚠️ **THIS RUNG REPLACES A CLAIM THAT WAS FALSE WHEN WRITTEN, AND THE THING
    // THAT CAUGHT IT WAS A MUTANT SURVIVING.** `inPlayBodyFilter`'s doc block first
    // said the branch ORDER was behaviour — that a TYPE-first order would send
    // "Team Rocket's Pokémon" to null, because `^(.+) Pokémon$` matches it. It does
    // match it and it does NOT swallow it: the typed arm returns only when
    // `CLAUSE_POKEMON_TYPES` resolves the token, so an unresolved one falls THROUGH.
    // `D439-vocabulary-order-loses-the-owner` is kept as a declared `equivalent`
    // survivor, and THIS is the property the declaration rests on — measured over
    // the whole vocabulary rather than argued, so it goes RED the day the sets
    // overlap and the survivor's reason stops being true.
    const OWNER_SHAPE = /['\u2019]s Pokémon$/;
    for (const type of POKEMON_TYPES) {
      // No Pokémon type name ends in a possessive, in EITHER notation…
      expect(OWNER_SHAPE.test(`${type} Pokémon`)).toBe(false);
      // …and every one of them really does reach the typed reading, which is what
      // stops this being a vacuous assertion about strings nobody parses.
      expect(
        deriveAttackDamageMultiplier(`This attack does 10 damage for each of your ${type} Pokémon in play.`),
      ).toEqual({
        per: 10,
        count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "typedPokemon", pokemonType: type } },
      });
    }
    // …and the three EXACT nouns carry no apostrophe either, so they cannot reach
    // the owner branch on any ordering.
    for (const noun of ["Pokémon", "Basic Pokémon", "Evolution Pokémon"]) {
      expect(OWNER_SHAPE.test(noun)).toBe(false);
    }
    expect(deriveAttackDamageMultiplier(TR_BODIES)).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "ownerPokemon", owner: "Team Rocket" } },
    });
    // The owner is CAPTURED, not listed — a second prefix is admitted the day it is
    // ingested and this file never learns a card name. Constructed, and labelled so.
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your Ethan's Pokémon in play."),
    ).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "ownerPokemon", owner: "Ethan" } },
    });
    // …and the SPELLED-OUT type notation resolves through the same shared map, so a
    // token meaning Grass in one clause of this file means Grass in every other.
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your Grass Pokémon in play."),
    ).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "typedPokemon", pokemonType: "Grass" } },
    });
  });

  it("🛑 the BENCHED twin is a DIFFERENT sentence with a DIFFERENT member", () => {
    // ⑴ stated as printed text: one word apart, and `yourBenchCount` has served it
    // since D282. If this slice's anchor ever widened onto it, the Active Spot
    // would start counting toward a sentence that says "Benched".
    expect(deriveAttackDamageMultiplier(BENCHED_BODIES)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("🛑 the sentences are claimed by EXACTLY the two readers named, and refused by the rest", () => {
    // ⚠️ **A NAMED CLAIM PLUS ELEVEN KEPT REFUSALS, AND NOT `resolvedByAnyReader === true`**
    // (D438, and the shape that produced D436's GAP): a bare `=== true` is a claim
    // about NO reader, and it stays green under any mistaken widening. This asserts
    // WHICH reader owns each sentence AND that every other reader still says no.
    const OTHERS = [
      deriveAttackEffect,
      deriveAttackDamagePenalty,
      deriveAttackDamageSuppression,
      deriveAttackCoinFlip,
      deriveAttackRequirement,
      deriveAttackCancelRequirement,
      deriveAttackPreDamage,
      deriveAttackBonusConsequent,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackDiscardScaledBoost,
    ] as const;
    for (const text of [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    expect(deriveAttackDamageBonus(EVOLUTION_BODIES)).not.toBeNull();
    expect(deriveAttackDamageMultiplier(EVOLUTION_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(EVOLUTION_BODIES)).toBeNull();
    expect(resolvedByAnyReader(EVOLUTION_BODIES)).toBe(true);
    // 🆕🆕 **D446 — THE TWO FOE ROWS AND THE THREE ROUND ROWS JOIN THE CLAIMED
    // SIDE, ON THE SAME READER AND WITH THE SAME ELEVEN REFUSALS KEPT.** They are
    // added to the loop above's shape rather than merely deleted from the one
    // below, which is the whole of D438's rule: the discrimination the negative
    // provided is preserved by naming the owner, not by relaxing the claim.
    for (const text of [FOE_EX_BODIES, FOE_EX_V_BODIES, ROUND_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    // 🆕🆕 **D466 — `STAGE1_BODIES` JOINS THE CLAIMED SIDE, ON THE `×` READER AND WITH
    // THE SAME ELEVEN REFUSALS KEPT**, which is D438's rule applied for the second time
    // in this `it`: the negative is not relaxed, it is replaced by a NAMED owner plus
    // the eleven-way refusal it always carried.
    expect(deriveAttackDamageMultiplier(STAGE1_BODIES)).not.toBeNull();
    expect(deriveAttackDamageBonus(STAGE1_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(STAGE1_BODIES)).toBeNull();
    expect(resolvedByAnyReader(STAGE1_BODIES)).toBe(true);
    // …and the ONE the family still leaves behind is refused by EVERY reader,
    // which is the thirteen-way negative kept rather than replaced. ⚠️ **IT IS
    // ALSO THE CONTROL THAT KEEPS THE LOOPS ABOVE HONEST** (D424: every "X is
    // refused" owes a neighbouring "Y is admitted", and the converse holds too —
    // a suite in which every corpus row is claimed proves nothing about the
    // vocabulary). `Ancient` is DATA-BLOCKED (the banner is in no catalog column,
    // so nothing in `effects.ts` can be the fix), and D461's rule is why it is the
    // right survivor to lean on: a DATA-blocked witness cannot be casually built by
    // a successor, where a mechanism-blocked one can — as this very rung just found
    // out.
    //
    // 🛑🛑 **D466 — THE REASON D446 GAVE FOR NOT COLLECTING `Stage 1` WAS FALSE WHEN IT
    // WAS WRITTEN, AND THE MEASUREMENT BESIDE IT WAS RIGHT.** The paragraph that used to
    // stand here said *"a stage ORDINAL is not a persisted field either — `Card.stage` is
    // a free-text column and the engine's own `isBasicPokemon` / `evolveFromOf` read it as
    // a BINARY. Spelling 'Stage 1' would mean a third reading of that column."* Every
    // clause of that is wrong: `Card.stage` IS a persisted column with a CLOSED
    // vocabulary (`Basic | Stage1 | Stage2 | VSTAR | VMAX`, queried at D262), and
    // `cards.ts` had ALREADY been reading it as the ordinal for 59 decisions —
    // `isStage2Pokemon` since **D262** and `isStage1Pokemon` since **D387**, both of them
    // shipped before D446 and both cited by `interpreter.ts`'s `opponentActiveIsStage1` /
    // `opponentActiveIsStage2` arms. So D466's member is not a third reading of anything;
    // it is the FIRST reading reused at a second address. ⚠️ **WHAT D446 GOT RIGHT WAS THE
    // PRICE — "the row is ONE printing"** — which is a fact about the pool and is still
    // true; what it got wrong was the reason, and the two are recorded separately here
    // because a refusal that survives on a false reason is the expensive kind (D442).
    expect(deriveAttackDamageMultiplier(ANCIENT_BODIES)).toBeNull();
    expect(deriveAttackDamageBonus(ANCIENT_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(ANCIENT_BODIES)).toBeNull();
    expect(resolvedByAnyReader(ANCIENT_BODIES)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real board: the zone, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countPokemonInPlay`: Active + Bench, seat-relative, filtered", () => {
  it("🛑 the canonical board answers 6 / 2 / 4 / 3 / 1 on the attacker's side", () => {
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([6, 2, 1, 3, 4]);
  });

  it("🛑 and 5 / 3 / 2 / 1 / 2 on the defender's — every one of the five moves", () => {
    // The seat rung. No pair of these lists shares a value at the same index, so a
    // build reading the wrong board is wrong on ALL FIVE rather than on one.
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([5, 3, 2, 1, 2]);
  });

  it("🛑 'in play' is ACTIVE + BENCH — the Active contributes, and is FILTERED", () => {
    // The zone rung, driven from both ends.
    //   • The attacker's Active is an Evolution, owner-prefixed, Darkness and NOT a
    //     Basic, so it contributes to `anyPokemon`, `ownerPokemon` and
    //     `evolutionPokemon` and NOT to `basicPokemon` or `typedPokemon` — a
    //     Bench-only build is RIGHT about two of the five, which is exactly why one
    //     filter would not have shown it.
    const state = canonical();
    const benchOnly = (f: CardFilter) =>
      state.players.p1.bench.filter((b) => countPokemonInPlay({ ...state, players: { ...state.players, p1: { ...state.players.p1, active: b, bench: [] } } }, "p1", f) === 1).length;
    expect(FILTERS.map(benchOnly)).toEqual([5, 2, 0, 3, 3]);
    //   • so the Active's own contribution, filter by filter, is the difference:
    const BENCH_ONLY = [5, 2, 0, 3, 3] as const;
    expect(
      FILTERS.map((f, i) => countPokemonInPlay(state, "p1", f) - (BENCH_ONLY[i] ?? -1)),
    ).toEqual([1, 0, 1, 0, 1]);
  });

  it("🛑 the NULL-ACTIVE board answers with the Bench and does not throw", () => {
    // A seat whose Active Spot is empty is a real mid-resolution board (§8.1, before
    // the promotion is answered), and the walk must survive it. Driven on the
    // function rather than through `attack()`, because the ATTACKER's own Active can
    // never be null at declaration — the gate required it.
    const state = canonical();
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(FILTERS.map((f) => countPokemonInPlay(empty, "p1", f))).toEqual([5, 2, 0, 3, 3]);
    // …and an EMPTY SIDE is 0 rather than a throw, on every filter.
    const barren: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null, bench: [] } },
    };
    expect(FILTERS.map((f) => countPokemonInPlay(barren, "p1", f))).toEqual([0, 0, 0, 0, 0]);
  });

  it("🛑 the GENERALISED walk and D242's adapter cannot disagree", () => {
    // The two names, one walk. This is what a second copy of the loop would have
    // broken, and it goes red the day somebody re-inlines one of them.
    const state = canonical();
    for (const seat of ["p1", "p2"] as const) {
      expect(countOwnerPokemonInPlay(state, seat, "Team Rocket")).toBe(
        countPokemonInPlay(state, seat, { kind: "ownerPokemon", owner: "Team Rocket" }),
      );
    }
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p2", "Team Rocket")).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the count actually scaling damage.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: five attacks, five numbers, one board", () => {
  it("🛑 the canonical board deals 120 / 40 / 30 / 90 / 200", () => {
    const state = canonical();
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("🛑 the MULTIPLY fold DROPS the printed base and the ADDITIVE one KEEPS it", () => {
    // The four `×` sentences have `base: 0` in the event even though the card prints
    // `20×` / `30×`; the one `+` sentence carries its printed 40. A build that got
    // the fold wrong would be off by the base on every board, including the ones
    // above — but only this rung says WHICH half of the number is which.
    const state = canonical();
    const rows = [0, 1, 2, 3, 4].map((i) => find(swing(state, i).events, "DAMAGE_DEALT"));
    expect(rows.map((r) => r?.base)).toEqual([0, 0, 0, 0, 40]);
    expect(rows.map((r) => r?.scaled)).toEqual([120, 40, 30, 90, 160]);
  });

  it("🛑 the ACTIVE ALONE still scores — the Bench-only build reads ZERO here", () => {
    // ⑴'s killing board: the attacker's Bench is empty, so the only countable body
    // is the one in the Active Spot. Three of the five filters match it, and a walk
    // that skipped the Active deals NO DAMAGE AT ALL on those three.
    const state = bare();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([1, 0, 1, 0, 1]);
    expect(dealt(state, 0)).toBe(20);
    expect(dealt(state, 2)).toBe(30);
    expect(dealt(state, 4)).toBe(80);
    // …and the two it does NOT match are the printed floor, below.
    expect(find(swing(state, 1).events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(swing(state, 3).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("🛑 the BENCH ALONE still scores — the count is not the Active's alone either", () => {
    // The mirror of the rung above: five Benched bodies and an Active that matches
    // only `anyPokemon`/`ownerPokemon`/`evolutionPokemon`. `basicPokemon` and
    // `typedPokemon` therefore score off the BENCH exclusively, so an Active-only
    // walk deals nothing on those two and the pair pins the union.
    const state = canonical();
    expect(dealt(state, 1)).toBe(40);
    expect(dealt(state, 3)).toBe(90);
  });

  it("🛑 THE PRINTED FLOOR — a board matching NOTHING files no DAMAGE_DEALT at all", () => {
    // On the `×` fold the base is dropped, so a zero count is zero damage and the
    // engine files no damage row. That is rules-correct and it is the case a build
    // that kept the base would fail: it would deal 20 here.
    const state = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(countPokemonInPlay(state, "p1", { kind: "typedPokemon", pokemonType: "Grass" })).toBe(0);
    const after = swing(state, 3);
    expect(find(after.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(activeOf(after.state, "p2").damage).toBe(0);
    // ⚠️ AND THE ATTACK REALLY RAN — the declaration is on the stream, so this is a
    // zero rather than a refusal.
    expect(find(after.events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("🛑 the ADDITIVE fold KEEPS its base — and its zero is UNREACHABLE, stated", () => {
    // The other half of the floor, and the one that tells the two folds apart.
    // ⚠️ **A ZERO EVOLUTION COUNT IS NOT REACHABLE THROUGH `attack()` ON THIS
    // BOARD, AND THAT IS SAID RATHER THAN FAKED**: the holder is itself an
    // Evolution and it is the Active Spot the attack is declared from, so the count
    // it reads can never be 0. The smallest reachable value is 1, and the base is
    // exactly what separates the additive 40 + 40 from a multiply 40 × 1.
    const state = bare();
    expect(countPokemonInPlay(state, "p1", { kind: "evolutionPokemon" })).toBe(1);
    expect(dealt(state, 4)).toBe(80);
    const row = find(swing(state, 4).events, "DAMAGE_DEALT");
    expect([row?.base, row?.scaled]).toEqual([40, 40]);
    // …and the zero IS driven, on the function, off a board with no Evolution in
    // play at all — which is what proves the arm floors rather than throws.
    const barren: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null, bench: [] } },
    };
    expect(countPokemonInPlay(barren, "p1", { kind: "evolutionPokemon" })).toBe(0);
  });

  it("no ATTACK_EFFECT_SKIPPED is filed, in either direction", () => {
    // The claimed sentences never reach the loud path…
    const state = canonical();
    for (const i of [0, 1, 2, 3, 4]) {
      const after = swing(state, i);
      expect(after.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
      expect(after.events.filter((e) => e.type === "ATTACK_DECLARED")).toHaveLength(1);
    }
    // …and the counter is not vacuous — the same board on the ZERO-count board files
    // none either, which is the case a build that treated 0 as "unreadable" would
    // fail. ⚠️ THIS IS NOT AN ATTRIBUTION CONTROL AND IS STATED AS THE PARTIAL IT IS
    // (D433): this 60 fields no card printing an unread sentence, so nothing here
    // proves the skip channel could fire at all. Its witnesses live in the suites
    // that own an unread printing.
    const floor = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(swing(floor, 3).events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the same five numbers from the other chair", () => {
  it("🛑 p2 attacking reads p2's board, and it is a DIFFERENT board", () => {
    // The seat rung driven through `attack()` rather than through the helper: the
    // canonical shapes are mirrored, so p2 swinging reads 6 / 2 / 4 / 3 / 1 off its
    // own side while p1's side holds 5 / 3 / 2 / 1 / 2.
    const state = canonical("p2");
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([6, 2, 1, 3, 4]);
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([5, 3, 2, 1, 2]);
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i, "p2"))).toEqual([120, 40, 30, 90, 200]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — persistence, purity, and the census this row moves.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `MATCH_RECORD_VERSION` STAYS 29, driven at all THREE addresses", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
  // this package; what is driven HERE is the engine-side fact it is about — whether
  // anything this slice produces reaches a persisted board.

  it("🛑 DIRECTION 1 — a v29 record round-trips and STILL scores all five counts", () => {
    const record = JSON.parse(JSON.stringify(canonical())) as GameState;
    expect([0, 1, 2, 3, 4].map((i) => dealt(record, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("🛑 DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    // `DamageCountSource` is a PARSE-TIME type: derived from card text and consumed
    // in the same tick by `scaledAttackDamage`. No op carries one, no field stores
    // one, no event names one. Driven as a property of the SERIALIZED bytes rather
    // than reasoned from the type's name (D427: choosing a carrier does not duck
    // persistence, so the record is what answers).
    const before = canonical();
    const after = swing(before, 0).state;
    const wire = JSON.stringify(after);
    // 🆕🆕 D446 — the member's NAME changed (`yourPokemonInPlay` → `pokemonInPlay`),
    // so this rung's subject moved with it. **BOTH SPELLINGS ARE ASSERTED ABSENT**:
    // the new one because it is what a leak would say today, the old one because a
    // rung naming only the current spelling stops discriminating the moment somebody
    // reverts it. And a rename is exactly the change that would have owed a
    // `MATCH_RECORD_VERSION` bump had this type reached a persisted byte — it does
    // not, and this line is where that is measured rather than reasoned.
    expect(wire).not.toContain("pokemonInPlay");
    expect(wire).not.toContain("yourPokemonInPlay");
    expect(wire).not.toContain("anyPokemon");
    // 🆕🆕 D446 — and neither new `CardFilter` member reaches the wire either.
    expect(wire).not.toContain("suffixPokemon");
    expect(wire).not.toContain("attackNamePokemon");
    expect(wire).not.toContain("ownerPokemon");
    // …and no body gained a key: the attacker's key set equals the untouched
    // defender's and equals its own from before the swing, which is the shape a new
    // `InPlayPokemon` field would break.
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("🛑 DIRECTION 3 — the `CardFilter` WIDENING, over the bytes, at its own address", () => {
    // 🆕🆕 **D446 — THE SLICE HAS THREE SHAPE CHANGES AND THEY DO NOT SHARE AN
    // ADDRESS (D443), SO THE VERSION QUESTION IS ASKED THREE TIMES.**
    //   · `DamageCountSource.pokemonInPlay` — RENAMED and gains a REQUIRED `seat`.
    //     A parse-time type: no `EffectOp` carries one, no `GameState` field stores
    //     one, no `GameEvent` names one. NOT PERSISTED — Directions 1 and 2 above.
    //   · `CountSeat` — a TYPE ALIAS. There is no runtime value and no byte.
    //   · **`CardFilter` gains two members, and THAT one IS at a persisted address**:
    //     `searchDeck.filter`, `discardPileRetrieval.filter`, `chooseCards.filter`
    //     and six more op fields carry one, and an op rides
    //     `state.phase.cont.pendingOp`, which is inside `MatchRecord.state`. D442's
    //     rule pointed the other way — *a shape that is NOT persisted must not be
    //     priced as though it were* — and this is the half where the address is real.
    //
    // 🛑 **AND IT IS D333's CASE, WHICH IS WHY IT COSTS NOTHING: A UNION THAT GAINS
    // AN INHABITANT.** *"A WIDENING is free; a GENERALISATION is not"* — no v29 byte
    // string can hold `suffixPokemon` or `attackNamePokemon` (no producer puts either
    // into an op; §7's sweep drives that over the whole derived column), and every
    // pre-existing inhabitant reads EXACTLY as it read before, because the two new
    // arms are two new `case`s in two switches and two new entries in one `Set`.
    //
    // ⚠️ **THE ENUMERATION IS COMPILE-ENFORCED RATHER THAN HAND-KEPT** (D424: prefer
    // a refusal the model re-derives). `Record<CardFilter["kind"], CardFilter>` does
    // not compile with a member missing, so this list cannot fall behind the union
    // the way a literal array would — and the count beside it is what catches a
    // member being DELETED from the union and from the list together (D417's rule:
    // pin the diff AND the count).
    const EVERY_KIND: Record<CardFilter["kind"], CardFilter> = {
      basicPokemon: { kind: "basicPokemon" },
      anyPokemon: { kind: "anyPokemon" },
      evolutionPokemon: { kind: "evolutionPokemon" },
      stagePokemon: { kind: "stagePokemon", stage: "Stage2" },
      typedPokemon: { kind: "typedPokemon", pokemonType: "Grass" },
      anyOf: {
        kind: "anyOf",
        filters: [
          { kind: "suffixPokemon", suffix: "ex" },
          { kind: "suffixPokemon", suffix: "V" },
        ],
      },
      ownerPokemon: { kind: "ownerPokemon", owner: "Team Rocket" },
      abilityPokemon: { kind: "abilityPokemon" },
      attackNamePokemon: { kind: "attackNamePokemon", attack: "Round" },
      suffixPokemon: { kind: "suffixPokemon", suffix: "ex" },
      toolCard: { kind: "toolCard" },
      basicEnergy: { kind: "basicEnergy" },
      byName: { kind: "byName", name: "Fixmon ex" },
      supporter: { kind: "supporter" },
      item: { kind: "item" },
      stadium: { kind: "stadium" },
      trainerCard: { kind: "trainerCard" },
      anyCard: { kind: "anyCard" },
      pokemonOrBasicEnergy: { kind: "pokemonOrBasicEnergy" },
      anyEnergy: { kind: "anyEnergy" },
      specialEnergy: { kind: "specialEnergy" },
      providesEnergy: { kind: "providesEnergy", energyType: "Grass" },
    };
    // **NINETEEN BEFORE D446, TWENTY-ONE AFTER, TWENTY-TWO AFTER D466.** The count is
    // the second half of the guard: a diff alone stays green when a member is dropped
    // from the union and from this list in one edit.
    // 🆕🆕 **D466 — AND THIS `Record` IS THE ALPHABET GATE, WHICH WAS OBSERVED RATHER
    // THAN ASSUMED**: adding `stagePokemon` to the union made `tsc -b` fail HERE, with
    // `TS2741: Property 'stagePokemon' is missing`, before any test ran. That is the
    // whole reason the enumeration is compile-enforced instead of hand-kept (D424) —
    // a new `CardFilter` member cannot reach the bytes without passing this line.
    expect(Object.keys(EVERY_KIND)).toHaveLength(22);
    // 🛑 **THE BYTES.** Each filter is written out and read back the way
    // `MatchRecord.state` is, and `matchesFilter` must give the IDENTICAL answer over
    // a cast that spans every category the catalog has — a Pokémon with a rule box
    // and attacks, a plain Pokémon with none, a Trainer and an Energy. A widening
    // that changed what an old member MEANT would move one of these cells.
    // 🆕🆕 D466 — the CAST gains `fix-stage2body`, which is what keeps the sweep
    // non-vacuous for the new member: without an actual Stage 2 in the cast,
    // `stagePokemon` would answer false to all five and be indistinguishable from a
    // member that answered false to everything (D424's anti-vacuity rule, applied to
    // the byte sweep rather than to a reader).
    const CAST = [
      "fix-attacker-ex",
      "fix-roundbody",
      "fix-benchfiller",
      "fix-item",
      "fix-energy",
      "fix-stage2body",
    ];
    for (const [kind, filter] of Object.entries(EVERY_KIND)) {
      const readBack = JSON.parse(JSON.stringify(filter)) as CardFilter;
      expect(readBack).toEqual(filter);
      for (const id of CAST) {
        expect([kind, id, matchesFilter(FIXTURE_POOL[id], readBack)]).toEqual([
          kind,
          id,
          matchesFilter(FIXTURE_POOL[id], filter),
        ]);
      }
    }
    // …and the control that keeps the sweep above from being vacuous (D424): the
    // cast really does separate the members, so a `matchesFilter` that answered a
    // constant would not survive this line.
    const answers = Object.values(EVERY_KIND).map((f) =>
      CAST.filter((id) => matchesFilter(FIXTURE_POOL[id], f)).length,
    );
    expect(new Set(answers).size).toBeGreaterThan(1);
    expect(matchesFilter(FIXTURE_POOL["fix-attacker-ex"], EVERY_KIND.suffixPokemon)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-roundbody"], EVERY_KIND.suffixPokemon)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-roundbody"], EVERY_KIND.attackNamePokemon)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-attacker-ex"], EVERY_KIND.attackNamePokemon)).toBe(false);
    // 🆕🆕 D466 — the new member's positive and its THREE different negatives, each a
    // different reason to be false: a Stage 1 (the other ordinal), a Basic (the wrong
    // end of the chain) and a Trainer (not a Pokémon at all, refused inside the
    // delegated helper rather than by a guard beside it).
    expect(matchesFilter(FIXTURE_POOL["fix-stage2body"], EVERY_KIND.stagePokemon)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], EVERY_KIND.stagePokemon)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-benchfiller"], EVERY_KIND.stagePokemon)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-item"], EVERY_KIND.stagePokemon)).toBe(false);
    // …and the NEIGHBOUR the member must not be: `evolutionPokemon` admits the Stage 1
    // that `stagePokemon{Stage2}` refuses, on the same card, in the same run.
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], EVERY_KIND.evolutionPokemon)).toBe(true);
    expect(
      matchesFilter(FIXTURE_POOL["fix-stage2body"], { kind: "stagePokemon", stage: "Stage1" }),
    ).toBe(false);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const benchBefore = frozen.players.p1.bench.length;
    const after = swing(frozen, 0);
    // The count is a READ: the bodies it walked are all still there afterwards, on
    // the new board as well as on the frozen one, and only the defender moved.
    expect(frozen.players.p1.bench).toHaveLength(benchBefore);
    expect(after.state.players.p1.bench).toHaveLength(benchBefore);
    expect(activeOf(frozen, "p1").energy).toHaveLength(1);
    expect(activeOf(after.state, "p1").energy).toHaveLength(1);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(120);
  });

  it("🛑 the OPPONENT-SIDE reading is a `seat` FIELD — D439's falsifier, FIRED", () => {
    // 🆕🆕🆕 **D446 — THIS RUNG WENT RED, BY DESIGN, AND IT IS RE-POINTED ONTO A
    // SHAPE RATHER THAN ONTO A BOOLEAN.** D439 wrote it as the executable falsifier
    // for *"no `side` field"*: *"the three opponent-side printings this family holds
    // are refused for their FILTER — no `CardFilter` member reads a rule-box class —
    // and not for their side. The day one does, these rows become buildable and this
    // member gains an `opponentPokemonInPlay` sibling; this rung goes RED then and
    // not before."* `CardFilter.suffixPokemon` reads `pokemonSuffixOf`, so the day
    // arrived and the rung fired.
    //
    // 🛑 **THE MEASUREMENT WAS RIGHT AND THE PREDICTED SHAPE WAS NOT**, which is why
    // this rung asserts the SHAPE and not `resolvedByAnyReader === true` (D438: the
    // positive form of a thirteen-way negative is a claim about no reader at all).
    // There is NO `opponentPokemonInPlay` sibling — D440 re-derived this union's rule
    // one slice after D439 wrote the prediction, and *identical payload ⇒ one member
    // with the discriminator as a FIELD*. So what is pinned is: the population is
    // still exactly these two rows, they are claimed by the reader NAMED here, they
    // read the OPPONENT's seat, and the union carries no seat-named sibling.
    const foeSide = legalAttackCorpus().filter(
      ([, s]) => s.includes("for each of your opponent's") && s.endsWith(" in play."),
    );
    expect(foeSide.map(([, s]) => s).sort()).toEqual([FOE_EX_BODIES, FOE_EX_V_BODIES].sort());
    expect(foeSide.reduce((sum, [n]) => sum + n, 0)).toBe(3);
    for (const [, text] of foeSide) {
      const reading = deriveAttackDamageMultiplier(text);
      expect(reading?.count.kind).toBe("pokemonInPlay");
      // …and the SEAT is the field, read off the printed noun phrase.
      expect(reading?.count).toMatchObject({ seat: "opponent" });
    }
    // 🛑 **AND THE SIBLING'S ABSENCE IS PINNED FROM THE MODULE, NOT FROM PROSE.** A
    // `kind` this union does not carry cannot appear on any reading of any corpus
    // row, so the sweep below is what would redden if somebody added the sibling
    // beside the field — the two spellings of one fact D159 forbids.
    // ⚠️ **`Set<string>` AND NOT `Set<DamageCountSource["kind"]>`, AND THE REASON IS
    // THE FINDING**: with the narrow element type, `kinds.has("opponentPokemonInPlay")`
    // does not COMPILE — the union has no such member, so `tsc` refuses the argument.
    // That is D424's *prefer a refusal the model re-derives* arriving at a rung: the
    // strongest form of "there is no sibling" is already enforced by the type, and
    // this widened sweep is the RUNTIME half, which catches the other direction (a
    // sibling added to the union AND produced by a reader).
    const kinds = new Set<string>(
      legalAttackCorpus()
        .map(([, text]) => deriveAttackDamageMultiplier(text)?.count.kind as string | undefined)
        .filter((k): k is string => k !== undefined),
    );
    expect(kinds.has("pokemonInPlay")).toBe(true);
    expect(kinds.has("opponentPokemonInPlay")).toBe(false);
    expect(kinds.has("yourPokemonInPlay")).toBe(false);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕 §7 (D446) — the two new `CardFilter` members on real boards, and the SEAT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `attackNamePokemon` and `suffixPokemon`: the predicate, the zone, the seat", () => {
  it("🛑 `attackNamePokemon` reads the NAME — 3 attacker bodies, 1 defender body", () => {
    const state = roundBoard();
    const round: CardFilter = { kind: "attackNamePokemon", attack: "Round" };
    // ACTIVE + BENCH, §4's "in play": the attacker's Active is the holder itself and
    // its sixth attack IS called Round, so a Bench-only walk reads 2 and this reads
    // 3. The two are different numbers on ONE board, which is D439's own reason for
    // driving the zone rather than arguing it.
    expect(countPokemonInPlay(state, "p1", round)).toBe(3);
    expect(countPokemonInPlay(state, "p2", round)).toBe(1);
    // 🛑 THE TWO NEGATIVES, SEPARATED. `fix-attacker-ex` sits on the attacker's Bench
    // and HAS attacks — a build reading "has any attack" reads 5 here, and the
    // unfiltered noun reads 5 too, so the sharp figure is the one in between.
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" })).toBe(5);
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Bite" })).toBe(1);
    // …and a name nothing prints is a genuine ZERO rather than a data gap, which is
    // the property that made a CAPTURE safe here where D440 refused one.
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Rounds" })).toBe(0);
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "round" })).toBe(0);
    // 🛑 **EQUALITY AND NOT A SUBSTRING, DRIVEN FROM BOTH SIDES.** "Rounds" is longer
    // than the printed name and "Roun" is a PREFIX of it, so a `.includes` or a
    // `.startsWith` reading answers 3 on one of these two where the printed equality
    // answers 0 on both — and `"round"` catches the case-insensitive reading. Three
    // near-misses, each differing from "Round" on exactly ONE axis (D427).
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Roun" })).toBe(0);
  });

  it("🛑 `suffixPokemon` is an EQUALITY — the VMAX is a rule box and is NOT counted", () => {
    const state = ruleBoxBoard();
    const ex: CardFilter = { kind: "suffixPokemon", suffix: "ex" };
    const v: CardFilter = { kind: "suffixPokemon", suffix: "V" };
    const pair: CardFilter = { kind: "anyOf", filters: [ex, v] };
    expect(countPokemonInPlay(state, "p2", ex)).toBe(2);
    expect(countPokemonInPlay(state, "p2", v)).toBe(1);
    expect(countPokemonInPlay(state, "p2", pair)).toBe(3);
    // 🛑 THE VMAX IS THE CONTROL AND IT IS WHY THE MEMBER IS NOT `hasRuleBox` AND THE
    // BARE-EX ROW IS NOT `isExOrV`: it has a rule box, it is neither an ex nor a V,
    // and it is counted by NEITHER filter. A `hasRuleBox` build reads 4 for the pair
    // and 4 for the bare ex; an `isExOrV` build reads 3 for the bare ex.
    expect(countPokemonInPlay(state, "p2", { kind: "suffixPokemon", suffix: "VMAX" })).toBe(1);
    expect(countPokemonInPlay(state, "p2", { kind: "anyPokemon" })).toBe(6);
    // …and the attacker's side answers 1 for all three, which is what makes the seat
    // the only thing separating this member's two printed sentences from a build
    // that reads the wrong board.
    expect([ex, v, pair].map((f) => countPokemonInPlay(state, "p1", f))).toEqual([1, 0, 1]);
  });

  it("🛑 the FOLD: three attacks, three numbers, on the boards that separate them", () => {
    // Attack 5 is Round (20×), 6 is the bare ex (60×), 7 is the ex-and-V pair (60×).
    expect(dealt(roundBoard(), 5)).toBe(60);
    expect(dealt(ruleBoxBoard(), 6)).toBe(120);
    expect(dealt(ruleBoxBoard(), 7)).toBe(180);
    // 🛑 **THE SEAT INVERSION, OFF ONE BOARD RATHER THAN OFF A MIRROR** (D445): a
    // build reading `attackerSeat` for the two opponent-side rows scores 60 and 60
    // here — the same number twice, because the attacker's Bench holds one ex and no
    // V — where the printed reading scores 120 and 180. And the Round row, whose
    // seat IS the attacker's, is the control that the seat is read off the MEMBER
    // rather than hard-coded either way: it scores 60 (3 bodies) where a
    // defender-seat build scores 20.
    const rb = ruleBoxBoard();
    expect(countPokemonInPlay(rb, "p1", { kind: "suffixPokemon", suffix: "ex" }) * 60).toBe(60);
    expect(
      countPokemonInPlay(roundBoard(), "p2", { kind: "attackNamePokemon", attack: "Round" }) * 20,
    ).toBe(20);
  });

  it("🛑 the same three numbers from the other chair", () => {
    // The fold is seat-RELATIVE, not hard-wired to p1 — the mirror claim, which is a
    // different claim from the inversion above and needs its own rung (D445).
    expect(dealt(roundBoard("p2"), 5, "p2")).toBe(60);
    expect(dealt(ruleBoxBoard("p2"), 6, "p2")).toBe(120);
    expect(dealt(ruleBoxBoard("p2"), 7, "p2")).toBe(180);
  });

  it("🛑 `retrieveNoun`: `attackNamePokemon` is still unrenderable, `suffixPokemon` is NOT", () => {
    // 🆕🆕🆕 **D483 — HALF OF THIS RUNG'S CLAIM IS FALSE AT HEAD, AND THE RUNG IS THE
    // THING THAT SAID SO.** The paragraph below is kept verbatim (D178); what expired is
    // its scope. `damageChosen` gained an optional `filter: CardFilter` for the printed
    // BENCHED-SNIPE class (*"…to 1 of your opponent's Benched Pokémon ex."*), so
    // `suffixPokemon` — and the `anyOf` of two of them — is now carried by a DERIVED op,
    // rendered by `snipeNote` into a live prompt heading, and asserted byte for byte in
    // `classNarrowedBenchSnipe.test.ts` §4. **`attackNamePokemon` is untouched and its
    // half of the claim still holds**, which is why the rung is SPLIT rather than
    // deleted: an "X is absent" that has half expired is a rung that has stopped
    // discriminating, and D424's control rule cuts both ways.
    //
    // ⚠️ **AND THE INTERESTING PART IS THAT NOTHING ELSE COULD HAVE CAUGHT IT.** D446
    // wrote *"no op carries this filter today"* into three doc blocks; the only reason
    // the sentence did not simply rot is that ONE of the three was an executable rung
    // (D465/D212's rule at the address where it pays). This is the second consecutive
    // slice caught by a predecessor's refusal witness rather than by its own author.
    // ⚠️ **THE ANSWER TO "IS A WRONG CAPTION A TEST FAILURE OR INVISIBLE" IS
    // INVISIBLE, AND IT IS MEASURED HERE RATHER THAN ASSERTED.** Every caller of
    // `retrieveNoun` reads an `op.filter`; the only producer of these two members is
    // `deriveAttackDamageMultiplier`, which builds a `DamageCountSource` and never an
    // op. So the two new arms are reachability arms — `abilityPokemon`'s own posture
    // since D285 — owed by the exhaustive switch and by the fact that a REGISTRY
    // author can hand-write either filter into an op tomorrow.
    //
    // The function is not exported, so what is driven is the property that makes the
    // arms unreachable: no op in the whole derived attack column carries either
    // member. `deriveAttackEffect` is the only reader that produces ops.
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    const wire = JSON.stringify(ops);
    expect(wire).not.toContain("attackNamePokemon");
    // 🆕🆕🆕 D483 — the OTHER member is now carried, on exactly TWO derived ops, and the
    // count is pinned rather than the mere presence: a `.toContain` alone would stay
    // green under an anchor that widened past its two printed rows.
    const suffixCarriers = legalAttackCorpus().filter(([, text]) =>
      JSON.stringify(deriveAttackEffect(text) ?? []).includes("suffixPokemon"),
    );
    expect(suffixCarriers).toHaveLength(2);
    expect(suffixCarriers.reduce((n, [units]) => n + units, 0)).toBe(2);
    expect(wire).toContain("suffixPokemon");
    // …and the control: this sweep DOES see the filters ops really carry, so it is
    // not vacuous (D424 — every "X is absent" owes a "Y is present" on the same axis).
    expect(ops.length).toBeGreaterThan(0);
    expect(wire).toContain("kind");
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕 §8 (D466) — the PRINTED EVOLUTION-STAGE ORDINAL as a `CardFilter`: the two
// printed rows, the two zones, the two folds, and the seat.
//
// *"This attack does 40 damage for each of your Stage 1 Pokémon in play."*   1 legal
//                                          — `censusAttackCorpus.ts` FILE LINE 586
// *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* 2 legal
//                                          — `censusAttackCorpus.ts` FILE LINE 589
//
// ⚠️ ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (the surface stands
// still at 13), prompts, events, error codes, registry rows, `packages/schema` bytes
// or `redact.ts` bytes. NOT zero, said out loud: ONE new `CardFilter` member
// (`stagePokemon`), ONE new optional FIELD on the shipped `DamageCountSource` member
// `yourBenchCount`, ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`), TWO new
// `IN_PLAY_BODY_NOUNS` rows, ONE new FIXTURE id (`fix-stage2body`) and ONE new attack
// on `fix-inplaybodies`.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `stagePokemon`: the printed ordinal, at two zones and two folds", () => {
  it("both rows are REAL corpus rows at their measured printing counts", () => {
    // D183/D456: the specimen is the printed bytes, taken off the committed column,
    // never retyped — and the printing counts are asserted off the corpus too, because
    // a byte pin on an invented string is green by construction (D452).
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(STAGE1_BODIES)).toBe(1);
    expect(rows.get(BENCH_STAGE2)).toBe(2);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3, AND BOTH ARE READ
    // HERE RATHER THAN INFERRED FROM EACH OTHER** (D451/D461/D465: measure each site).
    expect([2, (rows.get(STAGE1_BODIES) ?? 0) + (rows.get(BENCH_STAGE2) ?? 0)]).toEqual([2, 3]);
  });

  it("🛑 the WHOLE printed `Stage` vocabulary of the column, enumerated, not counted", () => {
    // ⚠️ **THE ENUMERATION IS THE UNRELIABLE PART** (D424/D428), so this takes the
    // LOOSEST plausible shape — every corpus row containing the bare word "Stage" — and
    // asserts the WHOLE list. It is what makes "two rows reach a body-count noun, and
    // there is no third" a measurement instead of a claim, and it is why the vocabulary
    // has TWO map rows rather than a `^Stage ([12]) Pokémon$` capture over five values.
    const stageRows = legalAttackCorpus()
      .filter(([, s]) => s.includes("Stage"))
      .map(([, s]) => s)
      .sort();
    expect(stageRows).toEqual(
      [
        "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
        "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.",
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
        "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
        STAGE1_BODIES,
        BENCH_STAGE2,
        "You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand.",
      ].sort(),
    );
    // …and the column prints NO "VSTAR Pokémon" / "VMAX Pokémon" noun at all, which is
    // the other half of the two-values decision (D446's own rule: arms no sentence
    // drives are not written). ⚠️ This pattern cannot see a stage word spelled any
    // other way — "Stage2" without the space, or a lowercase "stage" — and both were
    // checked by the same sweep returning the same seven rows.
    expect(legalAttackCorpus().some(([, s]) => /VSTAR Pokémon|VMAX Pokémon/.test(s))).toBe(false);
  });

  it("🛑 the two sentences derive to the two values, and each is ONE axis from a refusal", () => {
    expect(deriveAttackDamageMultiplier(STAGE1_BODIES)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "stagePokemon", stage: "Stage1" },
      },
    });
    expect(deriveAttackDamageBonus(BENCH_STAGE2)).toEqual({
      per: 40,
      count: { kind: "yourBenchCount", filter: { kind: "stagePokemon", stage: "Stage2" } },
    });
    // 🛑 **THE ORDINAL IS READ AND NOT DEFAULTED** — the two printed values land on the
    // two members, and the crossed forms (which the column prints nowhere but the
    // vocabulary now spells, deliberately: see `IN_PLAY_BODY_NOUNS`) prove the noun is
    // what decides, not the anchor.
    expect(
      deriveAttackDamageMultiplier("This attack does 40 damage for each of your Stage 2 Pokémon in play."),
    ).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "stagePokemon", stage: "Stage2" },
      },
    });
    expect(
      deriveAttackDamageBonus("This attack does 40 more damage for each Stage 1 Pokémon on your Bench."),
    ).toEqual({
      per: 40,
      count: { kind: "yourBenchCount", filter: { kind: "stagePokemon", stage: "Stage1" } },
    });
    // 🛑 **THE FILTER IS OPTIONAL AND ITS ABSENCE IS THE SHIPPED OBJECT, BYTE FOR
    // BYTE.** This is the whole of the widening claim and it is driven rather than
    // argued: D282's ten printings still derive an object with NO `filter` key at all,
    // so a v29 record's bytes still mean what they meant.
    const unfiltered = deriveAttackDamageBonus(
      "This attack does 20 more damage for each of your Benched Pokémon.",
    );
    expect(unfiltered).toEqual({ per: 20, count: { kind: "yourBenchCount" } });
    expect(JSON.stringify(unfiltered)).toBe('{"per":20,"count":{"kind":"yourBenchCount"}}');
    expect(Object.hasOwn((unfiltered as { count: object }).count, "filter")).toBe(false);
  });

  it("🛑 the VOCABULARY refuses on the BENCH anchor exactly as it does on the `in play` one", () => {
    // ⚠️ **ONE AXIS EACH** (D427). Each of these differs from a claimed sentence by
    // exactly one thing, and the thing is named.
    // …the NOUN, and it is the DATA-blocked banner rather than an invented word, so
    // this refusal cannot be casually built away by a successor (D461).
    expect(
      deriveAttackDamageBonus("This attack does 40 more damage for each Ancient Pokémon on your Bench."),
    ).toBeNull();
    // …the printed ZERO, which is a SEPARATE guard from the vocabulary: the noun here
    // is one the map holds, so only `per >= 1` can be doing the refusing.
    expect(
      deriveAttackDamageBonus("This attack does 0 more damage for each Stage 2 Pokémon on your Bench."),
    ).toBeNull();
    // …the leading CAPITAL, and the prefix ENDS A SENTENCE so the lowercase `t` is the
    // only thing that moved (D452's finding: a leading-text near-miss that also
    // lowercases tests neither axis).
    expect(deriveAttackDamageBonus(BENCH_STAGE2.replace("This", "this"))).toBeNull();
    // …the trailing PERIOD.
    expect(deriveAttackDamageBonus(BENCH_STAGE2.slice(0, -1))).toBeNull();
    // …a LEADING clause, which the `^` refuses.
    expect(deriveAttackDamageBonus(`Flip a coin. ${BENCH_STAGE2}`)).toBeNull();
    // …and the ADMISSION that makes all five mean something (D424): the near-miss one
    // axis from the Ancient row is claimed.
    expect(
      deriveAttackDamageBonus("This attack does 40 more damage for each Basic Pokémon on your Bench."),
    ).toEqual({ per: 40, count: { kind: "yourBenchCount", filter: { kind: "basicPokemon" } } });
  });

  it("🛑 the new anchor claims exactly ONE corpus row, and no shipped anchor loses one", () => {
    // The disjointness claim, driven over the whole column rather than argued from the
    // patterns (D439's own rule, and the one D439's doc block got WRONG about order).
    const hits = legalAttackCorpus().filter(([, s]) => / on your Bench\.$/.test(s));
    expect(hits.map(([, s]) => s)).toEqual([BENCH_STAGE2]);
    // …and the five shipped Bench sentences still land on their own members, unfiltered.
    expect(deriveAttackDamageBonus("This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).")).toEqual(
      { per: 20, count: { kind: "bothSidesBenchCount" } },
    );
    expect(deriveAttackDamageBonus("This attack does 20 more damage for each of your opponent's Benched Pokémon.")).toEqual(
      { per: 20, count: { kind: "opponentBenchCount" } },
    );
    expect(deriveAttackDamageMultiplier("This attack does 20 damage for each of your Benched Pokémon.")).toEqual(
      { per: 20, count: { kind: "yourBenchCount" } },
    );
    expect(deriveAttackDamageMultiplier("This attack does 20 damage for each damage counter on all of your Benched Pokémon.")).toEqual(
      { per: 20, count: { kind: "damageCountersOnYourBench" } },
    );
    // 🛑 **AND BOTH NEW SENTENCES ARE CLAIMED BY EXACTLY ONE READER EACH.** A named
    // owner plus the refusals, never `resolvedByAnyReader === true` alone (D438).
    expect(deriveAttackDamageBonus(STAGE1_BODIES)).toBeNull();
    expect(deriveAttackDamageMultiplier(BENCH_STAGE2)).toBeNull();
    expect(resolvedByAnyReader(STAGE1_BODIES)).toBe(true);
    expect(resolvedByAnyReader(BENCH_STAGE2)).toBe(true);
  });

  it("🛑 the STAGE-1 board answers 4 in play, and every wrong build reads another number", () => {
    const state = stage1Board();
    const S1: CardFilter = { kind: "stagePokemon", stage: "Stage1" };
    const S2: CardFilter = { kind: "stagePokemon", stage: "Stage2" };
    expect(countPokemonInPlay(state, "p1", S1)).toBe(4);
    // the five wrong answers, each a different number on this ONE board
    expect(countPokemonInPlay(state, "p1", S2)).toBe(1);
    expect(countPokemonInPlay(state, "p1", { kind: "evolutionPokemon" })).toBe(5);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" })).toBe(6);
    expect(countPokemonInPlay(state, "p2", S1)).toBe(2);
    // …and the BENCH-ONLY walk, which is the one the printed word "in play" excludes.
    expect(state.players.p1.bench.filter((p) => matchesFilter(topCardOf(state, p), S1))).toHaveLength(3);
  });

  it("🛑 the STAGE-1 fold: 160 dealt, and the printed base is DROPPED", () => {
    // `40×` — the multiply marker. 4 × 40 = 160, and a build that kept the printed base
    // would deal 200 here — which is `evolutionPokemon`'s wrong answer times forty, so
    // the two are told apart by §8's count rung above and not by this number alone.
    expect(dealt(stage1Board(), 8)).toBe(160);
    // 🛑 **THE MIRROR IS THE SAME NUMBER AND THAT IS THE CLAIM** — §5's shape, verbatim.
    // `stage1Board("p2")` builds the identical board with the seats swapped, so a
    // seat-RELATIVE count answers 160 from either chair and a p1-hard-coded one answers
    // the DEFENDER's 2 × 40 = 80 when p2 swings. The asymmetric half of the seat claim
    // is the count rung above, where p1 reads 4 and p2 reads 2 on ONE board.
    expect(dealt(stage1Board("p2"), 8, "p2")).toBe(160);
  });

  it("🛑 the STAGE-2 board answers 1 on the BENCH and 2 in play — the zone, exposed", () => {
    const state = stage2Board();
    const S2: CardFilter = { kind: "stagePokemon", stage: "Stage2" };
    const benchS2 = state.players.p1.bench.filter((p) => matchesFilter(topCardOf(state, p), S2));
    expect(benchS2).toHaveLength(1);
    // 🛑 **THE ACTIVE IS A STAGE 2, WHICH IS THE WHOLE FIXTURE**: the "in play" walk —
    // the wrong build three `case`s away in the same evaluator — reads ONE MORE.
    expect(countPokemonInPlay(state, "p1", S2)).toBe(2);
    // the rest of the wrong answers, all different, all on this one board
    expect(
      state.players.p1.bench.filter((p) =>
        matchesFilter(topCardOf(state, p), { kind: "stagePokemon", stage: "Stage1" }),
      ),
    ).toHaveLength(3);
    // (fix-stage1 ×2 + fix-grass-stage1 — three Stage 1 bodies, two of them different
    // ids, so a build that counted by ID rather than by stage reads 2 and not 3.)
    expect(
      state.players.p1.bench.filter((p) =>
        matchesFilter(topCardOf(state, p), { kind: "evolutionPokemon" }),
      ),
    ).toHaveLength(4);
    expect(state.players.p1.bench).toHaveLength(5);
    expect(
      state.players.p2.bench.filter((p) => matchesFilter(topCardOf(state, p), S2)),
    ).toHaveLength(0);
  });

  it("🛑 the STAGE-2 fold: 80 dealt, the printed base KEPT, and the seat control is a ZERO", () => {
    // `40+` — the additive marker. 40 + 1 × 40 = 80. An "in play" walk deals 120, an
    // unfiltered Bench count deals 240, the Stage 1 reading deals 160 and the Evolution
    // reading deals 200 — five wrong numbers, none of them 80.
    expect(dealt(stage2Board(), 0)).toBe(80);
    // 🛑 **THE SEAT INVERSION READS 0 AND WOULD LAND THE BASE ALONE** — 40, still a
    // `DAMAGE_DEALT` because the additive fold keeps its base, so the control is a
    // number and not a silence. Said out loud rather than glossed: a zero control is
    // weaker than a nonzero one, which is why BOTH halves of the seat claim are driven
    // — the mirror here, and the asymmetric count in the board rung above (p1's Bench
    // holds 1 Stage 2, p2's holds 0).
    // 🛑 **THE MIRROR IS THE SAME NUMBER**: `stage2Board("p2")` is the identical board
    // with the seats swapped, so a seat-RELATIVE count answers 80 from either chair and
    // a p1-hard-coded one answers 40 when p2 swings.
    expect(dealt(stage2Board("p2"), 0, "p2")).toBe(80);
  });

  it("🛑 no ATTACK_EFFECT_SKIPPED is filed for either row, in either direction", () => {
    for (const [state, index, seat] of [
      [stage1Board(), 8, "p1"],
      [stage2Board(), 0, "p1"],
    ] as const) {
      const { events } = mustApply(state, { type: "attack", seat, index });
      expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      expect(find(events, "DAMAGE_DEALT")).toBeDefined();
    }
    // …and the control: the LOUD row still files one, so the assertion above is not a
    // claim that this engine never files the event (D424).
    expect(resolvedByAnyReader(ANCIENT_BODIES)).toBe(false);
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — the `DamageCountSource` half, three directions", () => {
    // 🛑 **THIS HALF IS NOT AT A PERSISTED ADDRESS AND IS NOT PRICED AS THOUGH IT WERE**
    // (D442). `DamageCountSource` is a PARSE-TIME type: derived from card text and
    // consumed in the same tick by `attack.ts`'s module-private `scaledAttackDamage`.
    // No `EffectOp` carries one, no `GameState` field stores one, no `GameEvent` names
    // one — so the optional `filter` cannot reach `MatchRecord.state` at all.
    //
    // DIRECTION 1 — the OLD spelling is untouched: a filter-less `yourBenchCount` is
    // still exactly what the shipped sentences derive (driven three rungs up).
    // DIRECTION 2 — NEITHER spelling is on the wire. Both are asserted absent, the old
    // as well as the new, because a rung naming only the new one stops discriminating
    // the moment somebody reverts (D446's rule at this address).
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    const wire = JSON.stringify(ops);
    expect(wire).not.toContain("yourBenchCount");
    expect(wire).not.toContain("stagePokemon");
    expect(ops.length).toBeGreaterThan(0);
    // DIRECTION 3 — the LOSS. A `{ kind: "yourBenchCount", filter }` that is written out
    // and read back WITHOUT its `filter` key degrades to the shipped unfiltered member,
    // which is a benign soft landing rather than a `NaN` (D435's discriminator) and is
    // exactly what a pre-D466 writer meant by those bytes. It is also DETECTABLE: the
    // number moves on any board that holds a body the filter would exclude — 5 instead
    // of 1 on §8's stage board — so the loss is loud where it matters and silent
    // nowhere.
    const full = deriveAttackDamageBonus(BENCH_STAGE2);
    // ⚠️ **THE KEY IS DROPPED AT SERIALISATION AND NOT SET TO `undefined`.** A
    // `filter: undefined` property is INDISTINGUISHABLE from an absent one under
    // `toEqual`, so an assignment would have modelled nothing; a replacer that omits
    // the key produces the byte string a pre-D466 writer would actually have written.
    // (`delete` is the obvious spelling and `biome`'s `lint/performance/noDelete`
    // refuses it — the first thing this slice's `bun run check` went red on, and a
    // reminder that a lint rule is part of the contract, not a style note.)
    const wireBytes = JSON.stringify(full, (key, value) => (key === "filter" ? undefined : value));
    expect(wireBytes).toBe('{"per":40,"count":{"kind":"yourBenchCount"}}');
    const lossy = JSON.parse(wireBytes) as { per: number; count: { kind: string } };
    expect(lossy).toEqual({ per: 40, count: { kind: "yourBenchCount" } });
    expect(Object.hasOwn(lossy.count, "filter")).toBe(false);
    const board = stage2Board();
    const S2: CardFilter = { kind: "stagePokemon", stage: "Stage2" };
    expect(board.players.p1.bench.filter((p) => matchesFilter(topCardOf(board, p), S2))).toHaveLength(1);
    expect(board.players.p1.bench).toHaveLength(5);
  });

  it("🛑 `retrieveNoun` owes the new member a phrase too, and NO board can render one", () => {
    // `attackNamePokemon`'s and `suffixPokemon`'s posture, verbatim, one member over:
    // the only producer of `stagePokemon` is `inPlayBodyFilter`, which feeds a
    // `DamageCountSource` and never an op, so the arm is owed by the exhaustive switch
    // and by the fact that a REGISTRY author can hand-write the filter tomorrow. What
    // is driven is the PROPERTY that makes it unreachable, not a caption nothing emits.
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    expect(JSON.stringify(ops)).not.toContain("stagePokemon");
  });

  it("🛑 the census steps by exactly TWO sentences and THREE printings, attributably", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== STAGE1_BODIES && s !== BENCH_STAGE2);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([2, 3]);
  });
});
