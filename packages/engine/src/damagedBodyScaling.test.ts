import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
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
import type { CardFilter, DamageCountSource } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { countPokemonInPlay } from "./interpreter";
import manifest from "../package.json" with { type: "json" };
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  IN_PLAY_BODIES_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.405.0 → 0.406.0 — 🆕🆕🆕 D519: THE BODIES YOU HAVE IN PLAY THAT ARE ALREADY HURT,
// AND A COUNT NARROWED BY A **BOARD** FACT RATHER THAN BY A `CardFilter`.
//
// *"This attack does 50 damage for each of your Pokémon that has any damage counters on
// it."* — `censusAttackCorpus.ts` **FILE LINE 596**, **1 sentence / 1 legal printing**,
// claimed by `deriveAttackDamageMultiplier` through ONE new anchor
// (`IN_PLAY_DAMAGED_BODY_MULTIPLY`) and ONE new optional field on a SHIPPED member,
// deriving
// `{per:50, count:{kind:"pokemonInPlay", seat:"you", filter:{kind:"anyPokemon"}, damagedOnly:true}}`.
//
// 🛑 **THE REFUSAL THIS SLICE EVICTS WAS TYPE-SHAPED, AND ITS VERDICT WAS RIGHT WHILE ITS
// STATED CAUSE WAS NOT** (D479's third mode, and D503's fourth). D518 homed
// `scaledDamage.test.ts`'s *"count source with no reader at all"* witness here and argued
// *"this row needs a `CardFilter` inhabitant, not an anchor"*. **It needed neither a
// `CardFilter` inhabitant nor could it have had one**: `matchesFilter` is handed a `Card`
// off `topCardOf`, and a card carries no `damage` — the number lives on the
// `InPlayPokemon`. A `damagedBody` member of `CardFilter` would have been a question the
// matcher structurally cannot answer. What the row needed was a **rider on the COUNT**,
// where the walk over BODIES already happens. The witness is re-pointed rather than
// deleted (D444) and §2 asserts the correction from both sides.
//
// 🛑 **AND THE CORRECTION WAS ALREADY ON RECORD — 69 DECISIONS EARLY, GREEN THE WHOLE
// TIME, AND ONE FILE OVER FROM THE SLICE THAT CONTRADICTED IT.** `counterFold.test.ts`'s
// D450 header says in as many words that `matchesFilter` *"is handed a catalog card and
// never an `InPlayPokemon`"* and that **a board fact does not have to travel through
// `CardFilter` at all**, citing `damageChosen.damagedOnly` as the proof. Nothing reddened
// it and nothing could have — it is prose — and D518's corpus-wide sweep was keyed on the
// printed NOUN (`Special Condition`) rather than on the TYPE its refusal named. ⚠️ **The
// rule that finds this: grep the refusal's TYPE as well as its NOUN** (D516's rule (4),
// one axis wider). D519's sweep did, and all three carriers are corrected in place.
//
// 🛑 **THE COUNT TAKES THE SHIPPED PREDICATE'S OWN WALK — THE SAME CALL, NOT A SECOND
// DEFINITION** (D518's rule, fourth consecutive slice). `hasAnyDamageCounters`
// (interpreter.ts) is what decides `spreadDamage.damagedOnly` (D507),
// `counterEachAll.damagedOnly` and `damageChosen.damagedOnly` (D437); `countPokemonInPlay`
// now takes the same call. So *"this body is counted" ⟺ "this body is a candidate of the
// shipped op"* holds BY CONSTRUCTION, and §5 drives that biconditional body-by-body
// against the op the corpus prints one line up (`:526`, D507) rather than asserting it.
// **This is the FOURTH spelling of `damagedOnly` in this repo and the FIRST on a count:
// what D159 makes single is the WALK, never the union** (D516/D517/D518).
//
// ⚠️ **THE NOUN STAYS A CAPTURE, AND THAT IS THE ARCHITECTURAL CLAIM MADE EXECUTABLE.**
// The narrowing is not a filter, so the filter axis is FREE: the same arm reads
// *"…for each of your Basic Pokémon that has any damage counters on it."* through the
// shared `inPlayBodyFilter` map without a second anchor, a second member or an
// intersection combinator — which is exactly what an `allOf`-shaped reading of this
// sentence would have needed. §4's lattice measures that freedom as an INERT noun axis
// (0 of 8 flips, before and after) while the other three axes each flip at 4 of 8.
// ⚠️ Only the bare `Pokémon` head is PRINTED today (measured over all 640 rows); the map
// is shared because *"which bodies does this printed noun name"* is one question with one
// answer (D159), not because a second row is expected.
//
// ⚠️ **MULTIPLY ONLY, ATTACKER-SEAT ONLY, AND BOTH ZEROS ARE MEASURED.** The column
// prints the *"more"* form of this clause ZERO times and the opponent-seat form ZERO
// times, so neither an additive twin nor a foe anchor was written — D440's rule and D435's
// *not incrementing is also a measurement*. §1 pays both zeros.
//
// ⚠️ **THE CARRIER IS UNRESOLVED AND SAID SO (D425).** This checkout has no D1, so the one
// card printing this sentence cannot be named and is not invented. The STRING and the
// PRINTING COUNT are transcription, asserted off `legalAttackCorpus()` in §1; the bodies
// are `IN_PLAY_BODIES_DECK`'s shipped cast, re-texted on a per-board `cardPool` clone
// (D414) — **ZERO new `FIXTURE_POOL` ids, ZERO new decks and ZERO edits to either.**

/** Corpus FILE LINE 596, byte for byte. */
const PRINTED = "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

/** Corpus FILE LINE 526 (D507) — the shipped PREDICATE on the same printed clause, and the
    sentence §5 reads the biconditional against. Its program is TWO `spreadDamage` ops, both
    carrying the `damagedOnly` rider, and the attacker's own Bench is one of them. */
const SPREAD =
  "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** Corpus FILE LINE 414 — the WHOLE-BOARD predicate (Active plus Bench, the same zone this
    count reads) on the opposite seat, through `counterEachAll`'s own rider. */
const EACH_ALL = "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";

/** Corpus FILE LINE 528 (3 printings) — the CHOSEN-target spelling, `damageChosen`'s rider. */
const CHOSEN =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** Corpus FILE LINE 358 (3 printings; `:357` and `:359` print 100 and 80, 5 in all) — the
    same clause as a 0-or-1 INDICATOR on the DEFENDING Active, through `BoardCondition`.
    Read for its PROGRAM rather than its verdict (D514). */
const INDICATOR =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage.";

/** The two `in play` siblings this slice must not narrow — the anchors its own sits
    directly against. `:{SCALE}` is the additive one, which is why the new arm is on the
    multiply reader alone. */
const IN_PLAY_MULTIPLY = "This attack does 30 damage for each of your {G} Pokémon in play.";
const IN_PLAY_SCALE = "This attack does 40 more damage for each of your Evolution Pokémon in play.";
const IN_PLAY_FOE = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";

/** The ADDITIVE spelling of THIS row — printed ZERO times, which is why no additive anchor
    was written. Constructed, and labelled as such (D452). */
const UNPRINTED_ADDITIVE =
  "This attack does 50 more damage for each of your Pokémon that has any damage counters on it.";

/** The OPPONENT-seat spelling — printed ZERO times, which is why the `(?!opponent)`
    lookahead stays exactly as `IN_PLAY_BODY_MULTIPLY` spells it. Constructed. */
const UNPRINTED_FOE =
  "This attack does 50 damage for each of your opponent's Pokémon that has any damage counters on it.";

/** A NARROWED noun on the same clause — printed ZERO times, and it derives anyway, which is
    what says the filter axis is free rather than spelled. Constructed. */
const UNPRINTED_BASIC =
  "This attack does 50 damage for each of your Basic Pokémon that has any damage counters on it.";

/** THE DERIVED VALUE, spelled once so no case can pass against a hand-copied literal that
    has drifted from what this file means by it. */
const READING = {
  per: 50,
  count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "anyPokemon" }, damagedOnly: true },
} as const;

const READERS = [
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
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackRequirement,
];

const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const SEED = 1;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared: every
    number here is a POPULATION, so a body the setup shuffle happened to place would move
    the answer silently. One {C} pays the printed cost of every attack this fixture holds.
    `bodiesInPlayScaling.test.ts`'s `bare()`, verbatim in shape — the same deck, read and
    never edited. */
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

/** Re-text `fix-inplaybodies` attack 0 on THIS board's `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared and D412 reddened three boards of
    another slice by widening one. §6 pins the shared pool byte-unchanged. */
function withEffect(state: GameState, effect: string, index = INDEX): GameState {
  const card = state.cardPool["fix-inplaybodies"];
  if (card === undefined) throw new Error("no fix-inplaybodies in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-inplaybodies has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-inplaybodies": { ...card, attacks } } };
}

/** Index 0 is "Full House" — {C}, `damage: "20×"`, so the `×` fold DROPS the printed base
    and every HP observed here is the count's. */
const INDEX = 0;

const swing = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: INDEX });

/** 🛑 **THE CANONICAL BOARD, AND EVERY WRONG BUILD READS A DIFFERENT NUMBER ON IT.**

      attacker's side (p1)                             defender's side (p2)
        Active  fix-inplaybodies  Stage1/{D}/TR   dmg 20    fix-titan  340 HP, no attacks, clean
        Bench 0 fix-grass-stage1  Stage1/{G}      dmg 30    fix-benchfiller  dmg 10
        Bench 1 fix-grass-basic   Basic/{G}       dmg 10    fix-benchfiller  clean
        Bench 2 fix-benchfiller   Basic/{C}       clean
        Bench 3 fix-stage1        Stage1/{C}      clean
        Bench 4 fix-grass-basic   Basic/{G}       dmg 10

    Six bodies in play on the attacker's side, FOUR of them damaged, and the damaged four are
    deliberately NOT a class: an Evolution/TR Active, an Evolution Grass and two Basic Grass.
    So on this single board —

      anyPokemon        damaged 4 → 200     unnarrowed 6 → 300
      basicPokemon      damaged 2 → 100     unnarrowed 3 → 150
      evolutionPokemon  damaged 2 → 100     unnarrowed 3 → 150
      typedPokemon {G}  damaged 3 → 150     unnarrowed 3 → 150

    ⚠️ **FOUR DAMAGED AND TWO CLEAN, NOT THREE AND THREE, AND THE ASYMMETRY IS THE POINT.**
    On an evenly split board a build that INVERTED the predicate — counting the clean bodies
    instead of the hurt ones — deals exactly the same HP as the right one and every rung here
    passes. Here it deals 100 where the printed row deals 200. That is D427's
    differ-in-one-axis rule applied to the only axis a boolean has.

    Every other way to get it wrong lands somewhere else again: dropping the rider reads
    **300**, a Bench-only walk (`benchBodies`, three cases up in the evaluator) reads **150**,
    and a seat inversion reads the opponent's ONE damaged body and deals **50**. Five
    distinguishable answers on one setup. `fix-titan` has 340 HP and no attacks, so it
    survives even the unnarrowed 300 and no Knock Out can move a Prize or end the game behind
    an assertion. ⚠️ **Nothing on either side is within 40 HP of a Knock Out**, which is what
    lets §5 fire the D507 spread over this same board without changing the population.
    ⚠️ **AND THE `{G}` ROW IS THE ONE PLACE THE RIDER IS INERT** (3 and 3 — every Grass body
    is damaged), kept deliberately: a table where the narrowing always moves the number cannot
    tell *"the rider narrows"* from *"the rider subtracts a constant"*. */
function canonical(): GameState {
  let state = benched(bare(), "p1", [
    "fix-grass-stage1",
    "fix-grass-basic",
    "fix-benchfiller",
    "fix-stage1",
    "fix-grass-basic",
  ]);
  state = benched(state, "p2", ["fix-benchfiller", "fix-benchfiller"]);
  state = setDamage(state, "p1", 20);
  state = setBenchDamage(state, "p1", 0, 30);
  state = setBenchDamage(state, "p1", 1, 10);
  state = setBenchDamage(state, "p1", 4, 10);
  return setBenchDamage(state, "p2", 0, 10);
}

const dealt = (state: GameState, effect: string): number | undefined =>
  find(swing(withEffect(state, effect)).events, "DAMAGE_DEALT")?.dealt;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, measured live over the legal column.
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at ONE printing, and so is its whole family", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(SPREAD)).toBe(1);
    expect(rows.get(EACH_ALL)).toBe(1);
    expect(rows.get(CHOSEN)).toBe(3);
    expect(rows.get(INDICATOR)).toBe(3);
  });

  it("🛑 the `damage counters on it` family is TWELVE rows / 20 printings, enumerated not summarised", () => {
    // D428/D437: never truncate an enumeration. The survey pattern is published so its
    // edges are visible (D425), and it is deliberately looser than this slice's anchor.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("damage counters on it"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(20);
    // 🛑 TEN OF THE TWELVE BUILD AFTER THIS SLICE, AND THE TWO THAT DO NOT ARE NAMED so a
    // successor does not read this slice as having closed the family.
    // 🆕🆕🆕 **D520 — ELEVEN OF THE TWELVE (11 built / 1 unbuilt, 12 rows / 20 printings).**
    // `:601` is BUILT by arm 6-iii as three shipped ops — the Active predicate is the shipped
    // one-body `BoardCondition` `opponentActiveDamaged` in a `conditionGate` (NOT a rider on
    // the op, and NOT a third `spreadDamage.target`), then D507's two `damagedOnly` spreads;
    // *"except for this Pokémon"* is structural. The reason recorded below at D519 was right
    // that it is *"not a count"* and wrong about the rest. The list is RE-POINTED to `:316`
    // alone (D444), and `:601` is asserted from the other side beneath it.
    // 🆕🆕🆕 **D545 — TWELVE OF TWELVE ON THE CENSUS PREDICATE, AND THE BLOCKER NAMED BELOW
    // IS STRUCK.** `:316` is built on the GATE arm (`alternateCostIf`, a whole printed
    // clause, `body: ""`) and read by `attackCostAt` (attack.ts), a WRAPPER over
    // `effectiveAttackCost` — the seam's scalar `net` was never widened, which is why (b)
    // below was TRUE as a description of `effectiveAttackCost` and WRONG as a blocker:
    // the alternate multiset is chosen BESIDE that function, not inside it. The rung is
    // RE-KEYED to the census's four-arm predicate so the next family build reddens it; the
    // READER-only list below is kept, and still names `:316`, because it is still true.
    const censusBuilt = (s: string): boolean => {
      if (resolvedByAnyReader(s)) return true;
      const g = splitAttackGateClause(s);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
      return splitAttackTrailingClause(s) !== null;
    };
    expect(family.filter(([, s]) => !censusBuilt(s))).toEqual([]);
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s);
    expect(unbuilt).toEqual([
      // `:316` — a COST MODIFIER ("this attack can be used for {F}"). 🛑 **ITS BLOCKER IS
      // NOT "THERE IS NO COST MACHINE", WHICH IS WHAT THIS SLICE'S WORK ORDER SAID AND IS
      // FALSE.** `effectiveAttackCost` (continuous.ts, D169) ships, §8.2 CHARGES it, and
      // `redact.ts` publishes the result to the client as `effectiveCost`. What blocks
      // these two rows is narrower and worth naming: (a) that seam's sources are all
      // CONTINUOUS — a Stadium surcharge, an opposing aura and the holder's own discount —
      // and **no reader in the thirteen produces a cost modifier from an attack's own
      // text at all**; and (b) its arithmetic is a SCALAR `net` that appends or removes
      // `Colorless` symbols only, so it cannot express either printed row — `:324`
      // ("ignore ALL Energy in this attack's cost") waives TYPED symbols the discount loop
      // steps over, and `:316` ("can be used for {F}") is an ALTERNATE multiset rather
      // than a delta. **2 rows / 2 printings, and the gap is at the READER surface and in
      // the seam's shape, not in its absence.** 🆕🆕🆕 ~~(D545) *"the gap is … in the seam's
      // shape"* and *"no reader … produces a cost modifier from an attack's own text"* are
      // WITHDRAWN as blockers~~: both rows are built at D545 on the GATE arm, and the reader
      // is `attackCostAt`, a wrapper that leaves `effectiveAttackCost`'s shape as it was.
      // This entry stays because the list is now the READER-arm list, not the unbuilt one.
      // ⚠️ `:319` and `:320` (5 printings) merely
      // READ the cost through the shipped `extraEnergyUnitsBeyondCost` and are built —
      // reading a cost is not modifying one.
      "If this Pokémon has any damage counters on it, this attack can be used for {F}.",
      // `:601` — a BOTH-SIDES whole-board spread with an EXCEPT-SELF exclusion — WAS listed
      // here at D519 with the reason: "`spreadDamage.target` is `"opponentBench" |
      // `"yourBench"`: it has neither a both-sides inhabitant nor an Active, and nothing in
      // the op union spells "except for this Pokémon". Not a count, and not this slice." True
      // of the op, and the row never needed the op widened — D520 built it (see above).
    ]);
    expect(
      resolvedByAnyReader(
        "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
    expect(family.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(11);
  });

  it("🛑 BOTH zeros are MEASURED — no additive twin and no opponent-seat twin", () => {
    // D440's rule: an arm no sentence drives is not written. Swept over all 640 legal
    // sentences, so neither can be satisfied by looking at the one row this slice builds.
    const additive = legalAttackCorpus().filter(([, s]) =>
      /more damage for each of your [^.]+ that has any damage counters on it\./.test(s),
    );
    expect(additive).toEqual([]);
    const foe = legalAttackCorpus().filter(([, s]) =>
      /for each of your opponent['’]s [^.]+ that has any damage counters on it\./.test(s),
    );
    expect(foe).toEqual([]);
    // The two constructed near-misses are therefore constructed, and both are refused — by
    // the ANCHOR, which is the only thing between them and this member.
    expect(resolvedByAnyReader(UNPRINTED_ADDITIVE)).toBe(false);
    expect(resolvedByAnyReader(UNPRINTED_FOE)).toBe(false);
    // ⚠️ AND THE LOOKAHEAD IS WHAT REFUSES THE SECOND. Without `(?!opponent)` the foe
    // sentence would reach this arm and be scored off the ATTACKER's board — a silent
    // wrong answer rather than a loud unread one. Asserted through the value: the arm that
    // claims the printed row reads seat `"you"`, so there is no seat for the other string
    // to land on.
    expect(deriveAttackDamageMultiplier(PRINTED)?.count).toMatchObject({ seat: "you" });
  });

  it("🛑 the NOUN is a CAPTURE, so an UNPRINTED narrowing derives with no second anchor", () => {
    // The architectural claim, executable. `damagedOnly` is not a `CardFilter`, so the
    // filter axis is untouched by it: the shared `inPlayBodyFilter` map answers the noun
    // and the rider rides alongside. An `allOf`-shaped reading would have needed an
    // intersection combinator this union deliberately does not have.
    expect(deriveAttackDamageMultiplier(UNPRINTED_BASIC)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "basicPokemon" },
        damagedOnly: true,
      },
    });
    // …and a noun the shared map does NOT answer stays LOUD rather than deriving to a
    // wrong filter — the `filter !== null` guard, which is the vocabulary and not the
    // pattern. "Ancient" is in no persisted column at all (types.ts:146-149).
    // (🆕🆕🆕 D569 (D539): the map ANSWERS "Ancient Pokémon" now — `banners.ts`, an engine table; still in
    // no persisted column, TRUE — so the witness is the other Paradox banner, which it does not.)
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each of your Future Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
  });

  it("a printed ZERO is left LOUD, and the amount is CAPTURED rather than pinned at 50", () => {
    expect(
      deriveAttackDamageMultiplier(PRINTED.replace("does 50 damage", "does 0 damage")),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED.replace("50", "20"))).toEqual({
      ...READING,
      per: 20,
    });
  });

  it("the anchor is load-bearing at BOTH ends, and the capital `This` is half of it", () => {
    for (const text of [
      PRINTED.replace("This attack", "this attack"),
      PRINTED.slice(0, -1),
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Then, draw a card.`,
      // The clause is spelled into the pattern, not captured — so no near-miss of it
      // reaches the member.
      PRINTED.replace("any damage counters", "no damage counters"),
      PRINTED.replace("that has any damage counters on it", "in play"),
    ]) {
      const claimed = deriveAttackDamageMultiplier(text);
      expect(claimed === null || (claimed.count as { damagedOnly?: true }).damagedOnly !== true, text).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, the ARM, and the siblings it does NOT narrow (D514).
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §2 — the reading, the arm, and the anchors it sits against", () => {
  it("🆕🆕🆕 the sentence is RESOLVED, and by exactly ONE of the thirteen readers", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(READING);
    for (const read of READERS) {
      if (read === deriveAttackDamageMultiplier) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter is live on it, at either end. Six-for-six, run at every layer.
    for (const split of SPLITTERS) expect(split(PRINTED), split.name).toBeNull();
  });

  it("🛑 the three `in play` anchors derive BYTE FOR BYTE what they derived before", () => {
    // The slice WIDENS and never narrows. A new arm placed ahead of the wrong one is
    // exactly how a widening becomes a regression, and these three are the arms it sits
    // between.
    expect(deriveAttackDamageMultiplier(IN_PLAY_MULTIPLY)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    expect(deriveAttackDamageBonus(IN_PLAY_SCALE)).toEqual({
      per: 40,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "evolutionPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(IN_PLAY_FOE)).toEqual({
      per: 60,
      count: {
        kind: "pokemonInPlay",
        seat: "opponent",
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    });
    // 🛑 AND NONE OF THE THREE CARRIES THE RIDER — the field is OPTIONAL and absent means
    // the unnarrowed count, which is what makes "byte for byte" a property rather than a
    // hope. Asserted as key sets, because an extra `damagedOnly: undefined` would pass a
    // `toEqual` on the value and is still a different object.
    for (const sentence of [IN_PLAY_MULTIPLY, IN_PLAY_FOE]) {
      expect(Object.keys(deriveAttackDamageMultiplier(sentence)?.count ?? {}).sort()).toEqual([
        "filter",
        "kind",
        "seat",
      ]);
    }
  });

  it("🛑 the ANCHORS ARE DISJOINT OVER THE WHOLE COLUMN, so the order between them is FREE", () => {
    // D446's rule stated as a measurement rather than as an argument: one pattern requires
    // ` in play.` at end of string and the other ` that has any damage counters on it.`, so
    // no string can reach both. Swept over all 640 legal sentences AND over the three
    // constructed near-misses, and the two claimed sets are asserted DISJOINT and both
    // non-empty (D505's converse — a subtraction with an empty side is vacuous).
    const inPlay: string[] = [];
    const damaged: string[] = [];
    for (const [, s] of legalAttackCorpus()) {
      const v = deriveAttackDamageMultiplier(s);
      if (v === null || v.count.kind !== "pokemonInPlay") continue;
      if ((v.count as { damagedOnly?: true }).damagedOnly === true) damaged.push(s);
      else inPlay.push(s);
    }
    expect(damaged).toEqual([PRINTED]);
    expect(inPlay.length).toBeGreaterThan(0);
    expect(inPlay).not.toContain(PRINTED);
  });

  it("🛑 EVERY built row of this family lands on the READER arm (🆕 D545: every row but `:316`, which lands on the GATE arm) — the four-way split, per sentence", () => {
    // D514's rule: which ARM claims a sibling is what prices a row. ⚠️ ~~The GATE arm is a
    // CLOSED four-entry list of whole printed TIMING sentences (D517), so no `If …,` clause
    // of any other kind reaches it~~ — which is why `:358`'s leading gate clause is a READER
    // build and not a gate one. Asked per sentence rather than read off the totals.
    // 🆕🆕🆕 D545 — the struck clause is FALSE twice over: the list was already five entries
    // at D541, and D545 put two leading `If …,` COST clauses on it (rows 6 and 7 of
    // `ATTACK_GATE_CLAUSES`: `alternateCostIf` for `:316`, `costWaivedIf` for `:324`). So a
    // non-TIMING `If …,` clause DOES reach the gate arm now, when its whole printed text is a
    // row. `:358` is still a READER build because its text is not one of those rows.
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      // 🆕 D529 — widened with the census: a clause-only split (`body: ""`) is the gate arm.
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(SPREAD)).toBe("reader");
    expect(armOf(EACH_ALL)).toBe("reader");
    expect(armOf(CHOSEN)).toBe("reader");
    expect(armOf(INDICATOR)).toBe("reader");
    // 🆕🆕🆕 D545 — `"none"` → `"gate"`: `:316` is the sixth row of `ATTACK_GATE_CLAUSES`
    // (`alternateCostIf`), a WHOLE printed clause split with `body: ""` (D395's path).
    expect(armOf("If this Pokémon has any damage counters on it, this attack can be used for {F}.")).toBe(
      "gate",
    );
  });

  it("🛑 the INDICATOR's ceiling is `per`, which is why this row could not be spelled on it", () => {
    // The pricing argument, driven at the type. `boardCondition` is the 0-or-1 INDICATOR
    // (D115) — `conditionHolds(...) ? per : 0` — so its ceiling is `per` at every `per`,
    // while this sentence pays `per` per BODY and a board can carry six. §3 separates them
    // by 90 HP on one board.
    const indicator = deriveAttackDamageBonus(INDICATOR);
    expect(indicator?.count.kind).toBe("boardCondition");
    expect(Object.keys(indicator?.count ?? {}).sort()).toEqual(["cond", "kind"]);
    expect(deriveAttackDamageMultiplier(INDICATOR)).toBeNull();
  });

  it("🛑 the three SHIPPED op riders still derive, and this is the FOURTH spelling", () => {
    // The rider's name is not new; its HOME is. All three op-level spellings are asserted
    // live so "a fourth spelling" is a measurement rather than a story (D444/D516).
    expect(deriveAttackEffect(SPREAD)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 40, damagedOnly: true },
      { op: "spreadDamage", target: "opponentBench", amount: 40, damagedOnly: true },
    ]);
    expect(deriveAttackEffect(EACH_ALL)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        damagedOnly: true,
      },
    ]);
    const chosen = deriveAttackEffect(CHOSEN)?.[0] as { op: string; damagedOnly?: true } | undefined;
    expect(chosen?.op).toBe("damageChosen");
    expect(chosen?.damagedOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §3 — the fold on a board: the rider, the zone, the seat and the filter", () => {
  it("🆕🆕🆕 the printed row deals 50 × the DAMAGED bodies in play, and the unnarrowed twin 50 × all", () => {
    const state = canonical();
    expect(dealt(state, PRINTED)).toBe(200);
    // The same board, the same fold, the rider dropped: 6 bodies rather than 4. A build that
    // ignored `damagedOnly` reads this number, and it is 100 HP away.
    expect(dealt(state, "This attack does 50 damage for each of your Pokémon in play.")).toBe(300);
    // …and a build that INVERTED the predicate — counting the CLEAN bodies — reads 100 on
    // this board, which is why it is four-and-two rather than three-and-three.
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(4);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, false)).toBe(6);
  });

  it("🛑 the ACTIVE SPOT participates — a Bench-only walk reads 100 where this reads 150", () => {
    // §4 defines "in play" as the Active PLUS the Bench, and `benchBodies` (three cases up
    // in the evaluator, serving `yourBenchCount`) deliberately skips the Active. The
    // canonical board's damaged three include the Active, so the two nouns differ.
    const state = canonical();
    expect(state.players.p1.active?.damage).toBe(20);
    expect(dealt(state, PRINTED)).toBe(200);
    // Clear the Active's damage and nothing else: the count drops by exactly one body, to the
    // number a Bench-only walk would have read all along.
    expect(dealt(setDamage(state, "p1", 0), PRINTED)).toBe(150);
  });

  it("🛑 the SEAT is real — the opponent's damaged body is NOT counted", () => {
    // A p1-only rung cannot tell "reads the attacker's board" from "reads p2's". The
    // opponent has exactly ONE damaged body here, so a seat inversion deals 50.
    const state = canonical();
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(4);
    expect(countPokemonInPlay(state, "p2", { kind: "anyPokemon" }, true)).toBe(1);
    expect(dealt(state, PRINTED)).toBe(200);
    // …and damaging the opponent's whole board does not move the printed row at all.
    let loaded = state;
    for (let i = 0; i < loaded.players.p2.bench.length; i++) {
      loaded = setBenchDamage(loaded, "p2", i, 10);
    }
    loaded = setDamage(loaded, "p2", 10);
    expect(countPokemonInPlay(loaded, "p2", { kind: "anyPokemon" }, true)).toBe(3);
    expect(dealt(loaded, PRINTED)).toBe(200);
  });

  it("🛑 the FILTER axis and the RIDER axis are INDEPENDENT — the 2×4 table, on one board", () => {
    // The whole architectural claim as a measurement: the narrowing is orthogonal to the
    // noun, so every cell of filter × rider is a different population on ONE setup. A build
    // that folded the rider INTO the filter could not produce this table at all.
    const state = canonical();
    const TABLE: readonly (readonly [string, CardFilter, number, number])[] = [
      ["Pokémon", { kind: "anyPokemon" }, 4, 6],
      ["Basic Pokémon", { kind: "basicPokemon" }, 2, 3],
      ["Evolution Pokémon", { kind: "evolutionPokemon" }, 2, 3],
      // ⚠️ The one INERT cell: every Grass body on this board is damaged, so the narrowed and
      // unnarrowed counts agree at 3. Kept, because a table where the rider always moves the
      // number cannot tell narrowing from a constant subtraction.
      ["{G} Pokémon", { kind: "typedPokemon", pokemonType: "Grass" }, 3, 3],
    ];
    for (const [noun, filter, damagedCount, allCount] of TABLE) {
      expect(countPokemonInPlay(state, "p1", filter, true), `${noun} damaged`).toBe(damagedCount);
      expect(countPokemonInPlay(state, "p1", filter, false), `${noun} all`).toBe(allCount);
      // …and the printed-shape sentence for each noun deals exactly `50 ×` its cell.
      expect(
        dealt(state, `This attack does 50 damage for each of your ${noun} that has any damage counters on it.`),
        `${noun} dealt`,
      ).toBe(damagedCount * 50);
    }
    // ANTI-VACUITY: the table spans three distinct damaged counts and two distinct totals,
    // so it cannot be satisfied by a walk stuck on any one of them.
    expect([...new Set(TABLE.map(([, , d]) => d))].sort()).toEqual([2, 3, 4]);
    expect([...new Set(TABLE.map(([, , , a]) => a))].sort()).toEqual([3, 6]);
    // …and the INVERTED reading differs from the right one in EVERY row, which is the
    // property the four-and-two split buys.
    for (const [noun, , damagedCount, allCount] of TABLE) {
      expect(allCount - damagedCount, `${noun}: inverted`).not.toBe(damagedCount);
    }
  });

  it("🛑 a board with NO damaged body deals NOTHING — no `DAMAGE_DEALT` row at all", () => {
    // The `×` fold drops the printed base and attack.ts guards the §8.5 pipeline on
    // `scaledBase + scaledTotal > 0`, so the printed floor here is silence rather than a
    // zero-HP row. The board is the canonical one with its three damage values removed.
    let state = setDamage(canonical(), "p1", 0);
    state = setBenchDamage(state, "p1", 0, 0);
    state = setBenchDamage(state, "p1", 1, 0);
    state = setBenchDamage(state, "p1", 4, 0);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(0);
    const { events } = swing(withEffect(state, PRINTED));
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    // …and the attack RESOLVED: it is not on the loud unread path.
    expect(events.map((e) => e.type)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …while the unnarrowed twin on that very board still reads six bodies.
    expect(dealt(state, "This attack does 50 damage for each of your Pokémon in play.")).toBe(300);
  });

  it("🛑 the INDICATOR sibling on the same board is a CEILING, not a tally", () => {
    // `:358`'s 0-or-1 reading of the same printed clause, driven against this one. The
    // indicator reads the DEFENDING Active and pays `per` once; damaging the defender turns
    // it on and nothing about the attacker's six bodies changes it.
    const state = setBenchDamage(canonical(), "p2", 1, 10);
    const armed = setDamage(state, "p2", 10);
    expect(dealt(armed, INDICATOR)).toBe(60 + 20);
    expect(dealt(armed, PRINTED)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the 2⁴ lattice, on BOTH sides (D503/D505/D508).
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §4 — NARROWING × SEAT × NOUN × FOLD, 16 points, and the flip table", () => {
  const OWNER = ["your", "your opponent's"] as const;
  const NOUN = ["Pokémon", "Basic Pokémon"] as const;
  const TAIL = ["in play", "that has any damage counters on it"] as const;
  /** `n` 0 = the zone phrase, 1 = the BOARD narrowing; `s` 0 = the attacker, 1 = the
      opponent; `o` 0 = the bare head noun, 1 = a narrowed one; `f` 0 = multiply, 1 =
      additive. All sixteen are grammatical English printed somewhere in this shape — the
      four axes are the sentence's OWN variation, not invented vocabulary. */
  const text = (n: number, s: number, o: number, f: number): string =>
    `This attack does 50 ${f === 1 ? "more " : ""}damage for each of ${OWNER[s]} ${NOUN[o]} ${TAIL[n]}.`;
  const POINTS = [0, 1].flatMap((n) =>
    [0, 1].flatMap((s) =>
      [0, 1].flatMap((o) => [0, 1].map((f) => ({ key: [n, s, o, f], t: text(n, s, o, f) }))),
    ),
  );
  const lit = (t: string) => resolvedByAnyReader(t);
  /** D505's rule: subtract the build by its RIDER, not by its anchor — the anchor is
      module-private, and a successor who widens it across a point recorded as refused is
      caught by this rung rather than slipping past a name. */
  const claimedHere = (t: string): boolean => {
    const v = deriveAttackDamageMultiplier(t);
    return v !== null && (v.count as { damagedOnly?: true }).damagedOnly === true;
  };
  const before = (t: string) => lit(t) && !claimedHere(t);

  it("all 16 points are DISTINCT strings — the anti-degeneracy check (D491)", () => {
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
  });

  it("🛑 the BUILT set is 6/16 → 8/16, and the two new points are EXACTLY this arm's", () => {
    expect(POINTS.filter((p) => before(p.t)).map((p) => p.key.join("")).sort()).toEqual([
      "0000",
      "0001",
      "0010",
      "0011",
      "0100",
      "0110",
    ]);
    expect(POINTS.filter((p) => lit(p.t)).map((p) => p.key.join("")).sort()).toEqual([
      "0000",
      "0001",
      "0010",
      "0011",
      "0100",
      "0110",
      "1000",
      "1010",
    ]);
    // …and the converse assertion, without which the subtraction above is circular: the
    // claimed set is EXACTLY those two points, and `1000` is the printed row.
    expect(POINTS.filter((p) => claimedHere(p.t)).map((p) => p.key.join("")).sort()).toEqual([
      "1000",
      "1010",
    ]);
    expect(text(1, 0, 0, 0)).toBe(PRINTED);
    expect(text(1, 0, 1, 0)).toBe(UNPRINTED_BASIC);
  });

  it("🛑 the two predicates AGREE at every point, and both splitters are null at 16/16", () => {
    // D503's rule run — readers-only against the full residue predicate. Every point is a
    // single sentence with no timing clause and no trailing rider, so the registry and both
    // splitters have nothing to claim and the two readings cannot diverge.
    let gate = 0;
    let trailing = 0;
    for (const p of POINTS) {
      if (splitAttackGateClause(p.t) !== null) gate += 1;
      if (splitAttackTrailingClause(p.t) !== null) trailing += 1;
    }
    expect(gate).toBe(0);
    expect(trailing).toBe(0);
  });

  it("🛑 the flip table goes `6·2·0·2` → `4·4·0·4`, and the NOUN axis is INERT at both heads", () => {
    const flips = (pred: (t: string) => boolean) =>
      [0, 1, 2, 3].map((axis) => {
        let n = 0;
        for (const p of POINTS) {
          if (p.key[axis] === 1) continue;
          const q = POINTS.find((x) => x.key.every((v, i) => (i === axis ? v === 1 : v === p.key[i])));
          if (q !== undefined && pred(p.t) !== pred(q.t)) n += 1;
        }
        return n;
      });
    // NARROWING · SEAT · NOUN · FOLD, out of 8 pairs each.
    expect(flips(before)).toEqual([6, 2, 0, 2]);
    expect(flips(lit)).toEqual([4, 4, 0, 4]);
    // 🛑 **THE SHAPE**: the post table has THREE live axes each flipping at exactly HALF
    // and ONE INERT axis, and the built set is the radius-1 HAMMING BALL around the origin
    // on the three live axes, doubled by the inert one — `built ⟺ at most ONE of
    // {narrowing, opponent seat, additive} is set`. Asserted as the characterisation rather
    // than as the list, because the list alone does not say what the shape IS.
    for (const p of POINTS) {
      const live = (p.key[0] ?? 0) + (p.key[1] ?? 0) + (p.key[3] ?? 0);
      expect(lit(p.t), p.t).toBe(live <= 1);
    }
    // ⚠️ **INERT IS NOT DEGENERATE** (D505): the eight noun-pairs are eight distinct string
    // pairs that never move the verdict, and that inertness IS this slice's claim — the
    // rider is orthogonal to the filter, so the noun axis costs nothing on either side.
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
    // ⚠️ D513's phenomenon, SIXTH occurrence: the axis the build lit FELL (6 → 4) while the
    // two other live axes ROSE (2 → 4 each), each having gained a lit neighbour.
  });

  it("🛑 the BUILT set CONTAINS the PRINTED set — no literal refuses a printed row", () => {
    // Three of the sixteen points are printed at SOME amount; all three build, and one of
    // them is this slice's row.
    const corpus = legalAttackCorpus();
    const printed = POINTS.filter((p) => {
      const re = new RegExp(
        `^${p.t
          .split("50")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\d+")}$`,
      );
      return corpus.some(([, s]) => re.test(s));
    });
    expect(printed.map((p) => p.key.join("")).sort()).toEqual(["0000", "0010", "1000"]);
    for (const p of printed) expect(lit(p.t), p.t).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the INVARIANT: one walk, two folds.
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §5 — counted ⟺ a candidate of the SHIPPED op, by construction", () => {
  /** Which of p1's BENCH bodies the D507 spread actually damages — the shipped predicate's
      own answer, read off the board rather than off the type. The spread deals 40 and no
      body on the canonical board is within 40 HP of a Knock Out, so the bench indices are
      stable across the swing. */
  function spreadHits(state: GameState): boolean[] {
    const before = state.players.p1.bench.map((b) => b.damage);
    const after = swing(withEffect(state, SPREAD)).state.players.p1.bench.map((b) => b.damage);
    expect(after).toHaveLength(before.length);
    return after.map((d, i) => d > (before[i] ?? 0));
  }

  it("🛑 the biconditional holds body-by-body, on every damage pattern of a six-body board", () => {
    // The claim D159 buys here, SWEPT rather than asserted once. `spreadDamage.damagedOnly`
    // and this count both decide through `hasAnyDamageCounters`; if they could disagree on
    // any board that would be the finding, and they cannot.
    let bothOn = 0;
    let bothOff = 0;
    const PATTERNS: readonly (readonly [string, number, readonly number[]])[] = [
      ["clean", 0, [0, 0, 0, 0, 0]],
      ["active only", 20, [0, 0, 0, 0, 0]],
      ["bench only", 0, [30, 10, 0, 0, 10]],
      ["canonical", 20, [30, 10, 0, 0, 10]],
      ["alternating", 0, [10, 0, 10, 0, 10]],
      ["every body", 10, [10, 10, 10, 10, 10]],
    ];
    for (const [label, active, bench] of PATTERNS) {
      let state = setDamage(canonical(), "p1", active);
      for (let i = 0; i < bench.length; i++) state = setBenchDamage(state, "p1", i, bench[i] ?? 0);
      const hits = spreadHits(state);
      // Body by body: the shipped op's candidate set and the count's are the SAME set.
      for (let i = 0; i < hits.length; i++) {
        const counted = state.players.p1.bench[i]?.damage ?? 0;
        expect(hits[i], `${label} bench ${i}`).toBe(counted > 0);
        if (hits[i] === true) bothOn += 1;
        else bothOff += 1;
      }
      // …and the COUNT is exactly the hits plus the Active, which is the only body the
      // Bench-scoped op cannot see.
      const expected = hits.filter(Boolean).length + (active > 0 ? 1 : 0);
      expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true), label).toBe(expected);
      // …and `count >= 1` is exactly "some body satisfies the predicate".
      expect(
        countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true) >= 1,
        `${label}: count >= 1`,
      ).toBe(hits.some(Boolean) || active > 0);
      // …and the HP the printed sentence deals follows the count on every pattern.
      expect(dealt(state, PRINTED) ?? 0, `${label}: HP`).toBe(expected * 50);
    }
    // ANTI-VACUITY: the sweep visits BOTH sides of the biconditional many times over.
    expect(bothOn).toBeGreaterThan(0);
    expect(bothOff).toBeGreaterThan(0);
  });

  it("🛑 the rider narrows the WALK and not the FILTER — an undamaged body of the right class is dropped", () => {
    // The two refusals compose in one direction and are independent in the other. Bench 4
    // is a `fix-grass-basic`: same card, same filter answer as Bench 1, and the only thing
    // between them is the board fact.
    // Bench 2 is a `fix-benchfiller` and Bench 1 a `fix-grass-basic`: BOTH are Basic, the
    // filter answers YES to both, and the only thing between them is the board fact.
    const state = canonical();
    expect(state.players.p1.bench[1]?.damage).toBe(10);
    expect(state.players.p1.bench[2]?.damage).toBe(0);
    expect(countPokemonInPlay(state, "p1", { kind: "basicPokemon" }, false)).toBe(3);
    expect(countPokemonInPlay(state, "p1", { kind: "basicPokemon" }, true)).toBe(2);
    // Damage the clean one and the narrowed count rises to meet the unnarrowed one; the
    // filter never moved.
    const both = setBenchDamage(state, "p1", 2, 10);
    expect(countPokemonInPlay(both, "p1", { kind: "basicPokemon" }, true)).toBe(3);
    expect(countPokemonInPlay(both, "p1", { kind: "basicPokemon" }, false)).toBe(3);
  });

  it("🛑 an EMPTY Active Spot is counted as zero bodies rather than throwing", () => {
    // `countPokemonInPlay`'s own guarantee, and the rider must not change it: the walk's
    // `body === null` guard runs BEFORE the board test, so a seat whose Active Spot is empty
    // answers with its Bench at either value of the flag.
    const base = canonical();
    const empty: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, active: null } },
    };
    expect(countPokemonInPlay(empty, "p1", { kind: "anyPokemon" }, true)).toBe(3);
    expect(countPokemonInPlay(empty, "p1", { kind: "anyPokemon" }, false)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — `MATCH_RECORD_VERSION`, and what this slice did NOT buy.
// ─────────────────────────────────────────────────────────────────────────────

/** Every inhabitant of `DamageCountSource["kind"]`, as a TOTAL `Record` — D446's
    compile-enforced idiom. ⚠️ **A `readonly string[]` ANNOTATED with the union would NOT be
    a guard on it** (D512's finding). A 21st member makes this object fail to COMPILE. */
const COUNT_KINDS: Record<DamageCountSource["kind"], true> = {
  damageCountersOnSelf: true,
  opponentPrizesTaken: true,
  opponentActiveRetreatCost: true,
  boardCondition: true,
  damageCountersOnOpponentActive: true,
  specialConditionsOnOpponentActive: true,
  damageCountersOnYourBench: true,
  damageCountersOnOpponentBoard: true,
  bothSidesBenchCount: true,
  opponentBenchCount: true,
  yourBenchCount: true,
  energyOnOpponent: true,
  energyOnSelf: true,
  bothActivesEnergyCount: true,
  toolsOnYourBoard: true,
  extraEnergyUnitsBeyondCost: true,
  pokemonInPlay: true,
  bothSidesPokemonInPlay: true,
  cardsInDiscardPile: true,
  cardsInOpponentHand: true,
  // 🆕🆕🆕 D600 — WP14's `cardsInYourHand` (Galarian Meowth's fold, Alakazam's `damageActive.per`).
  cardsInYourHand: true,
  // 🆕🆕🆕 D607 — WP28a's three nullary members (Delphox, Bronzong, Sylveon ex folds).
  energyInPlayBothSides: true,
  toolsInPlayBothSides: true,
  basicEnergyTypesOnYourBoard: true,
  // 🆕🆕🆕 D620 — WP10's `yourPrizesTaken` (Incessant Onslaught, Cheerful Flame, Gobble Down).
  yourPrizesTaken: true,
  // 🆕🆕🆕 D623 — WP28b's three Bench-body members (Gourgeist ex, Armarouge, Igglybuff folds).
  damagedBenchedPokemon: true,
  benchedPokemonWithEnergy: true,
  benchedPokemonWithMaxHp: true,
};

describe("D519 §6 — `MATCH_RECORD_VERSION` HOLDS at 30: there is still no carrier", () => {
  it("🛑 the union is UNMOVED at TWENTY members — this slice bought a FIELD, not a member", () => {
    // 🆕🆕🆕 D600 (D539): "TWENTY" is the count at this slice, kept as written — 21 since WP14's
    // `cardsInYourHand`. 🆕🆕🆕 D607: 24 since WP28a's three. 🆕🆕🆕 D620: 25 since WP10's `yourPrizesTaken`. 🆕🆕🆕 D623: 28 since WP28b's three.
    expect(Object.keys(COUNT_KINDS)).toHaveLength(28);
    expect(COUNT_KINDS.pokemonInPlay).toBe(true);
  });

  it("🛑 NO op any producer in this repo emits carries a `DamageCountSource` — walked, not cited", () => {
    // [🆕🆕🆕 D600 (D539): "NO op any producer in this repo emits" is WITHDRAWN as a repo-wide
    // claim, kept as written — the walk below covers the legal `sv` attack column and the
    // registry's ATTACK programs only. `drawCards.per` (D557/D569/D599, Trainer programs; D557's
    // rides a parked `rest`) and D600's `damageActive.per` (`cardsInYourHand`, derived for the `me`
    // Alakazam "Powerful Hand") carry one outside it. The walked population is still carrier-free.]
    // 🛑 THE VERSION QUESTION, RE-DERIVED RATHER THAN INHERITED (D517's rule). D518 settled
    // it for a new MEMBER; this slice widens an EXISTING member's shape, which is the same
    // question about a different edit and is answered the same way — by walking every op
    // object every producer emits and asserting that no VALUE inside one is a
    // `DamageCountSource`. A damage fold emits no `EffectOp` at all, and
    // `scale?: DamageCountSource` — the field that WOULD create the carrier — stands refused
    // for the third time (D448/D449/D507). The day it lands and a producer sets it, this
    // goes RED and the next change to this union owes the bump.
    const programs: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const p = programFor(id);
      if (p?.attack !== undefined) programs.push(...Object.values(p.attack));
    }
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) programs.push(derived as EffectOp[]);
    }
    expect(programs.length).toBeGreaterThan(100);
    const carriers: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => visit(v, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== "object") return;
      const rec = node as Record<string, unknown>;
      const kind = rec.kind;
      if (typeof kind === "string" && kind in COUNT_KINDS && rec.op === undefined) {
        carriers.push(`${path}.kind = ${kind}`);
      }
      for (const [k, v] of Object.entries(rec)) visit(v, `${path}.${k}`);
    };
    programs.forEach((p, i) => visit(p, `program[${i}]`));
    expect(carriers).toEqual([]);
  });

  it("🛑 the `damagedOnly` RIDER reaches no PROMPT, which is why it owes no caption arm", () => {
    // 🛑 THE DESCRIBER QUESTION, SETTLED BY THE TYPE RATHER THAN BY READING (D515's defect
    // was a describer that dropped a clause SILENTLY). The three OP spellings of this rider
    // DO owe a caption — `snipeNote`'s `" that has any damage counters on it"` window — and
    // the caption is owed because those ops PROMPT. A damage fold prompts nothing: it emits
    // one `DAMAGE_DEALT` and no `choosePokemon` of any kind, so there is no heading that
    // could contradict its own validator.
    //
    // Driven rather than argued: the printed sentence's swing carries no prompt event and no
    // pending stage, while `damageChosen`'s spelling of the same rider does.
    const { events, state } = swing(withEffect(canonical(), PRINTED));
    expect(events.map((e) => e.type)).toEqual(
      events.map((e) => e.type).filter((t) => !t.startsWith("CHOICE")),
    );
    expect(state.phase.kind).not.toBe("effect:choose");
    // …and the CHOSEN sibling DOES park a prompt on a board of its own, so the contrast is
    // a measurement rather than the absence of a driver. ⚠️ It needs TWO surviving damaged
    // candidates: with one the op resolves without asking, and `fix-benchfiller` (60 HP)
    // would be Knocked Out by the printed 60 — which is why this board fields two
    // `fix-tr-stage1` (120 HP) instead of reusing the canonical one.
    let chosenBoard = benched(bare(), "p2", ["fix-tr-stage1", "fix-tr-stage1"]);
    chosenBoard = setBenchDamage(chosenBoard, "p2", 0, 10);
    chosenBoard = setBenchDamage(chosenBoard, "p2", 1, 10);
    const parked = mustApply(withEffect(chosenBoard, CHOSEN), {
      type: "attack",
      seat: "p1",
      index: INDEX,
    }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    // 🛑 AND THE PARKED CAPTION IS THE ONE `snipeNote`'s WINDOW WRITES — the clause this
    // slice's count reads is spelled out to the player HERE, by the op, and nowhere by the
    // fold. That is the whole difference between the two homes of one rider name.
    const prompt = parked.phase.kind === "effect:choose" ? parked.phase.prompt : undefined;
    expect(JSON.stringify(prompt)).toContain("that has any damage counters on it");
  });

  it("🛑 the reader SURFACE is unmoved at THIRTEEN, and the hand-kept list IS the module's", () => {
    // D419's guard. The COUNT is pinned separately from the diff, because a diff alone stays
    // green when a slice deletes a reader from the module and from this list at once.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("🛑 `FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    // D414/D452: ZERO new fixture ids, so every `ids.length` ladder takes a ZERO term. The
    // whole attack list is asserted rather than index 0 alone (D437: truncating an array is
    // a change a single-index read cannot see).
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => a.effect)).toEqual([
      "This attack does 20 damage for each of your Pokémon in play.",
      "This attack does 20 damage for each of your Basic Pokémon in play.",
      "This attack does 30 damage for each of your Team Rocket's Pokémon in play.",
      "This attack does 30 damage for each of your {G} Pokémon in play.",
      "This attack does 40 more damage for each of your Evolution Pokémon in play.",
      "This attack does 20 damage for each of your Pokémon in play that has the Round attack.",
      "This attack does 60 damage for each of your opponent's Pokémon ex in play.",
      "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.",
      "This attack does 40 damage for each of your Stage 1 Pokémon in play.",
    ]);
  });

  it("the engine version moved with the behaviour, and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.509.0");
    expect(manifest.version).toBe("0.509.0");
  });
});
