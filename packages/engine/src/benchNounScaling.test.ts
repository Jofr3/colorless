import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
// 🆕 D493 — the MODULE, so §10's eleven-way refusal is derived from the surface
// rather than from a hand-kept list (D418/D419: a short list makes a claim NARROWER,
// not false, and nothing ever reddens).
import * as effectsModule from "./effects";
import { matchesFilter, topCardOf } from "./cards";
import {
  POKEMON_TYPE_BY_CODE,
  POKEMON_TYPES,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import {
  BENCH_NOUN_DECK,
  FIXTURE_POOL,
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

// 0.365.0 → 0.366.0 — 🆕🆕 D467: THE ATTACKER'S OWN BENCH, NARROWED BY A PRINTED
// NOUN, ON BOTH OF ITS COUNTING AXES.
//
//   "This attack does 20 damage for each damage counter on all of your Benched
//    {F} Pokémon."                   2 legal — `censusAttackCorpus.ts` FILE LINE 544
//   "This attack does 80 more damage for each of your Benched Charjabug."
//                                    1 legal — `censusAttackCorpus.ts` FILE LINE 622
//                                          — 2 sentences / 3 legal printings
//
// ⚠️ ZERO new `EffectOp` members, op FIELDS, op VALUES, `CardFilter` members,
// readers (the surface stands still at 13), prompts, events, error codes, registry
// rows, `packages/schema` bytes or `redact.ts` bytes. NOT zero, said out loud: TWO
// new anchors (`BENCH_COUNTER_FILTERED_MULTIPLY`, `YOUR_BENCHED_NOUN_SCALE`), ONE
// new OPTIONAL field on the shipped `DamageCountSource` member
// `damageCountersOnYourBench` (`filter?: CardFilter`), ONE new `IN_PLAY_BODY_NOUNS`
// row (`Charjabug` → `byName` — the map's FIRST card-name key), ONE new FIXTURE id
// (`fix-benchnoun`) and ONE new deck (`BENCH_NOUN_DECK`).
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN ─────────────────────────────────────────
//
// The build has six ways to be wrong and each is a real neighbouring arm:
//
//  1. the ANCHORS could swallow the SHIPPED bare-noun sentences. The counter pair
//     is disjoint BY STRUCTURE (`([^.]+ Pokémon)` demands a space the bare noun
//     cannot spend); the body pair is disjoint only by a `(?!Pokémon\.)`
//     LOOKAHEAD, which is why that arm is placed AHEAD of the one it narrows —
//     §4 drives both directions.
//  2. the READER could emit the SHIPPED filter-less member, which no census figure
//     can see: `resolvedByAnyReader` is true either way. §2 asserts the derived
//     OBJECT, not the fact of derivation.
//  3. the EVALUATOR could drop the filter on the floor. §7 folds 140 where the
//     unfiltered walk folds 380.
//  4. the VOCABULARY could DEFAULT instead of staying loud. §3 keeps
//     "Ancient Pokémon" null at both new anchors.
//  5. the two axes could be crossed — BODIES counted where COUNTERS are printed.
//     §6's board answers 7 counters and 2 bodies on one Bench.
//  6. the ZONE could widen to "in play". §6's attacker is FIGHTING and carries 9
//     counters, so an in-play walk reads 16 where the Bench walk reads 7.
// ─────────────────────────────────────────────────────────────────────────────

/** The two printed rows, transcribed off the committed column and asserted against
    it in §1 (D183/D456: the specimen is the printed bytes, never retyped). */
const BENCH_F_COUNTERS =
  "This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon.";
const BENCH_CHARJABUG = "This attack does 80 more damage for each of your Benched Charjabug.";

/** The two SHIPPED sentences the two new anchors must not take. */
const BENCH_BARE_COUNTERS =
  "This attack does 20 damage for each damage counter on all of your Benched Pokémon.";
const BENCH_BARE_BODIES_SCALE = "This attack does 20 more damage for each of your Benched Pokémon.";
const BENCH_BARE_BODIES_MULTIPLY = "This attack does 20 damage for each of your Benched Pokémon.";

/** 🛑 THE NEGATIVE CONTROL, AND IT IS A REAL CORPUS ROW RATHER THAN AN INVENTION —
    `censusAttackCorpus.ts` FILE LINE 529, 1 legal printing. Its HEAD builds as of
    D467 and the PRINTED SENTENCE still does not; §10 drives both remaining
    blockers. */
const CYNTHIA_HEAD =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon.";
const CYNTHIA_TAIL = "This attack's damage isn't affected by Weakness.";
const CYNTHIA_PRINTED = `${CYNTHIA_HEAD} ${CYNTHIA_TAIL}`;

const SEED = 1;
const FIGHTING: CardFilter = { kind: "typedPokemon", pokemonType: "Fighting" };
const CHARJABUG: CardFilter = { kind: "byName", name: "Charjabug" };
const DUSKULL: CardFilter = { kind: "byName", name: "Duskull" };

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active`);
  return body;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared:
    every number here is a POPULATION figure, so a body the setup shuffle happened
    to seat would move the answer silently. One {C} pays both printed costs. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BENCH_NOUN_DECK, p2: BENCH_NOUN_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-benchnoun");
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

/** 🛑 **THE COUNTER BOARD — FILE LINE 544, `×` FOLD, ZONE = your Bench, RESOURCE =
    damage counters.**

      attacker's side                              defender's side
        Active  fix-benchnoun  {F}, 9 counters       fix-titan (340 HP, no attacks)
        Bench   fix-fighting-1  {F}, 3 counters      fix-fighting-1  1 counter
                fix-fighting-1  {F}, 4 counters      fix-benchfiller 5 counters
                fix-benchfiller       5 counters
                fix-benchfiller       1 counter
                fix-charjabug         6 counters

    `damageCountersOnYourBench{typedPokemon Fighting}` answers **7**, and every wrong
    build reads a different number on this ONE board:
      • the UNFILTERED walk (the optional field ignored) reads **19**;
      • an "IN PLAY" walk counts the Active — which IS Fighting, deliberately, and
        carries 9 — and reads **16**;
      • the other new filter, `byName {Charjabug}`, reads **6**;
      • counting BODIES instead of COUNTERS, filtered, reads **2**;
      • counting BODIES unfiltered reads **5**;
      • a SEAT INVERSION reads **1**.
    Seven distinguishable answers on one setup, and ×20 makes them
    140 / 380 / 320 / 120 / 40 / 100 / 20.

    ⚠️ **NO ID IS ASKED FOR MORE THAN TWICE PER SEAT** — `benchFromDeck` pulls from
    the seat's DECK and setup has already moved 7 cards to hand and 6 to prizes
    (`stage1Board`'s recorded constraint, inherited rather than re-discovered). */
function counterBoard(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = setDamage(bare(by), by, 90);
  state = benched(state, by, [
    "fix-fighting-1",
    "fix-fighting-1",
    "fix-benchfiller",
    "fix-benchfiller",
    "fix-charjabug",
  ]);
  state = setBenchDamage(state, by, 0, 30);
  state = setBenchDamage(state, by, 1, 40);
  state = setBenchDamage(state, by, 2, 50);
  state = setBenchDamage(state, by, 3, 10);
  state = setBenchDamage(state, by, 4, 60);
  state = benched(state, foe, ["fix-fighting-1", "fix-benchfiller"]);
  state = setBenchDamage(state, foe, 0, 10);
  state = setBenchDamage(state, foe, 1, 50);
  return state;
}

/** 🛑 **THE NAMED BOARD — FILE LINE 622, `+` FOLD, ZONE = your Bench, RESOURCE =
    bodies.**

      attacker's side                              defender's side
        Active  fix-benchnoun                        fix-titan
        Bench   fix-charjabug   ("Charjabug", St.1)   fix-charjabug
                fix-charjabug   ("Charjabug", St.1)   fix-stage1
                fix-stage1      (Evolution, NOT one)  fix-duskull
                fix-stage1      (Evolution, NOT one)
                fix-duskull     ("Duskull", Basic)

    `yourBenchCount{byName Charjabug}` answers **2**, and the wrong builds read:
      • the UNFILTERED walk reads **5**;
      • `evolutionPokemon` — the member a build reaching for the nearest thing would
        use — reads **4**, and it reads 4 ONLY because two of the Evolutions are not
        Charjabugs. That is the whole reason `fix-stage1` is in this deck: with a
        Bench whose only Evolutions were the two targets, `evolutionPokemon` and
        `byName` would both answer 2 and the rung would pass on the wrong filter;
      • `stagePokemon{Stage1}` reads **4** for the same reason;
      • `byName {Duskull}` — the other named body — reads **1**;
      • `basicPokemon` reads **1**;
      • a SEAT INVERSION reads **1**.
    With `80+` those are 240 / 480 / 400 / 400 / 160 / 160 / 160.

    ⚠️ **THREE OF THE WRONG BUILDS LAND THE SAME NUMBER (160) AND THAT IS SAID OUT
    LOUD RATHER THAN GLOSSED**: the fold cannot tell them apart, so §8 drives the
    COUNTS separately from the fold — a fold rung alone would be a weaker claim than
    it looks.

    ⚠️ **AND THE ZONE CANNOT BE EXPOSED ON THIS BOARD, WHICH IS A PROPERTY OF THE
    CARD RATHER THAN AN OVERSIGHT.** The sentence is printed on `fix-benchnoun`, so
    the Active Spot holds the attacker and not a Charjabug; an "in play" walk reads
    the same 2 the Bench walk reads. The zone axis is carried by the COUNTER board,
    whose attacker is Fighting on purpose. */
function namedBoard(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  const state = benched(bare(by), by, [
    "fix-charjabug",
    "fix-charjabug",
    "fix-stage1",
    "fix-stage1",
    "fix-duskull",
  ]);
  return benched(state, foe, ["fix-charjabug", "fix-stage1", "fix-duskull"]);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

/** The BENCH walk this slice's two members describe, written once here so the
    §6/§8 count rungs read the same population the engine reads. */
function benchCounters(state: GameState, seat: Seat, filter?: CardFilter): number {
  return state.players[seat].bench.reduce(
    (total, p) =>
      total +
      (filter === undefined || matchesFilter(topCardOf(state, p), filter)
        ? Math.floor(p.damage / 10)
        : 0),
    0,
  );
}

function benchBodies(state: GameState, seat: Seat, filter?: CardFilter): number {
  return state.players[seat].bench.filter(
    (p) => filter === undefined || matchesFilter(topCardOf(state, p), filter),
  ).length;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the two printed rows, their printing counts, and the fixture", () => {
  it("both rows are REAL corpus rows at their measured printing counts", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(BENCH_F_COUNTERS)).toBe(2);
    expect(rows.get(BENCH_CHARJABUG)).toBe(1);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3, AND BOTH ARE
    // READ HERE RATHER THAN INFERRED FROM EACH OTHER** (D451/D461/D466).
    expect([2, (rows.get(BENCH_F_COUNTERS) ?? 0) + (rows.get(BENCH_CHARJABUG) ?? 0)]).toEqual([
      2, 3,
    ]);
    // …and the negative control is a corpus row too, at ONE printing.
    expect(rows.get(CYNTHIA_PRINTED)).toBe(1);
  });

  it("🛑 the WHOLE printed `Benched ⟨token⟩` vocabulary of the column, enumerated", () => {
    // ⚠️ **THE ENUMERATION IS THE UNRELIABLE PART** (D424/D428), so this takes the
    // LOOSEST plausible shape — every token the column ever prints immediately after
    // the word "Benched" — and asserts the WHOLE multiset. It is what turns "the
    // slot after `Benched` is not a name slot" from a claim into a measurement, and
    // it is why `Charjabug` is a LITERAL map row rather than a `(.+)` → `byName`
    // template (D118/D440).
    const slot = new Map<string, number>();
    for (const [, text] of legalAttackCorpus()) {
      for (const m of text.matchAll(/Benched (\S+)/g)) {
        const token = m[1] ?? "";
        slot.set(token, (slot.get(token) ?? 0) + 1);
      }
    }
    expect([...slot.entries()].sort()).toEqual(
      [
        ["Ancient", 2],
        ["Basic", 1],
        ["Charjabug.", 1],
        ["Cubone", 1],
        ["Cynthia's", 1],
        ["N's", 1],
        ["Pokémon", 33],
        ["Pokémon,", 4],
        ["Pokémon.", 46],
        ["Pokémon.)", 43],
        ["Team", 1],
        ["{F}", 1],
        ["{L}", 1],
      ].sort(),
    );
    // 🛑 **AND THE SENTENCE-FINAL SLOT — the one `YOUR_BENCHED_NOUN_SCALE` reads —
    // TAKES EXACTLY TWO VALUES**, which is that anchor's whole safety argument: the
    // lookahead removes one of them and the map is asked exactly one question.
    // ⚠️ **`Pokémon.)` IS A THIRD TERMINATED FORM AND IT IS NOT SENTENCE-FINAL** —
    // it is the *"(Don't apply Weakness and Resistance for Benched Pokémon.)"* rider,
    // 43 rows, and the anchor's `\.$` cannot reach it because the string ends in a
    // paren. ⚠️ **THE FIRST MEASUREMENT OF THIS SLOT WAS WRONG AND THE ERROR WAS THE
    // INSTRUMENT**: `grep -oP "Benched [^ .]+\."` reported ONE key at 89, because
    // `[^ .]+` stops before the period and the pattern then matches the rider's
    // prefix too — so two distinct printed forms were summed into one. The rung
    // below is the corrected reading, taken with a tokeniser rather than a grep.
    expect(slot.get("Pokémon.")).toBe(46);
    expect(slot.get("Pokémon.)")).toBe(43);
    expect(slot.get("Charjabug.")).toBe(1);
    expect((slot.get("Pokémon.") ?? 0) + (slot.get("Pokémon.)") ?? 0)).toBe(89);
    // ⚠️ This pattern cannot see a Bench noun spelled without the word "Benched"
    // ("on your Bench", D466's anchor) and it cannot see a token split across a
    // line; both were checked by the same sweep returning the same twelve keys.
  });

  it("the fixture carries the two printed sentences BYTE FOR BYTE", () => {
    const card = FIXTURE_POOL["fix-benchnoun"];
    expect(card?.attacks?.map((a) => a.effect)).toEqual([BENCH_F_COUNTERS, BENCH_CHARJABUG]);
    expect(card?.attacks?.map((a) => a.damage)).toEqual(["20×", "80+"]);
    // 🛑 The attacker is FIGHTING on purpose — it is what makes the ZONE axis
    // readable on the counter board (see `counterBoard`'s block).
    expect(card?.types).toEqual(["Fighting"]);
    expect(engineVersion).toBe("0.400.0");
  });
});

describe("§2 — the two sentences derive the two values, and the field is OPTIONAL", () => {
  it("🛑 each printed sentence derives its own filtered member", () => {
    expect(deriveAttackDamageMultiplier(BENCH_F_COUNTERS)).toEqual({
      per: 20,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "typedPokemon", pokemonType: "Fighting" },
      },
    });
    expect(deriveAttackDamageBonus(BENCH_CHARJABUG)).toEqual({
      per: 80,
      count: { kind: "yourBenchCount", filter: { kind: "byName", name: "Charjabug" } },
    });
  });

  it("🛑 the FOLD is the adjective and nothing else — each sentence reaches ONE reader", () => {
    // Turns red the moment somebody gives the other fold a matching arm "for
    // symmetry", which would author two cards the catalog does not print (D435: the
    // empty cell is a measurement, and §4 measures it).
    expect(deriveAttackDamageBonus(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackDamagePenalty(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackEffect(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackDamageMultiplier(BENCH_CHARJABUG)).toBeNull();
    expect(deriveAttackDamagePenalty(BENCH_CHARJABUG)).toBeNull();
    expect(deriveAttackEffect(BENCH_CHARJABUG)).toBeNull();
    // …and each is claimed, by a NAMED owner rather than by `resolvedByAnyReader`
    // alone (D438).
    expect(resolvedByAnyReader(BENCH_F_COUNTERS)).toBe(true);
    expect(resolvedByAnyReader(BENCH_CHARJABUG)).toBe(true);
  });

  it("🛑 the absence of `filter` is the SHIPPED object, BYTE FOR BYTE", () => {
    // This is the whole of the widening claim and it is driven rather than argued:
    // a v29 record's bytes still mean what they meant, because the shipped spellings
    // still derive an object with NO `filter` key at all.
    const counters = deriveAttackDamageMultiplier(BENCH_BARE_COUNTERS);
    expect(counters).toEqual({ per: 20, count: { kind: "damageCountersOnYourBench" } });
    expect(JSON.stringify(counters)).toBe(
      '{"per":20,"count":{"kind":"damageCountersOnYourBench"}}',
    );
    expect(Object.hasOwn((counters as { count: object }).count, "filter")).toBe(false);
    const bodies = deriveAttackDamageBonus(BENCH_BARE_BODIES_SCALE);
    expect(bodies).toEqual({ per: 20, count: { kind: "yourBenchCount" } });
    expect(JSON.stringify(bodies)).toBe('{"per":20,"count":{"kind":"yourBenchCount"}}');
    expect(Object.hasOwn((bodies as { count: object }).count, "filter")).toBe(false);
  });
});

describe("§3 — the VOCABULARY refuses, and the ANCHOR does not", () => {
  it("🛑 the two new anchors reach the LOUD nouns and the map is what says no", () => {
    // ⚠️ **ONE AXIS EACH** (D427), and the noun is the DATA-blocked banner rather
    // than an invented word, so this refusal cannot be casually built away (D461).
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Ancient Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("This attack does 80 more damage for each of your Benched Ancient."),
    ).toBeNull();
    // …the printed ZERO, a SEPARATE guard from the vocabulary: both nouns here are
    // ones the map HOLDS, so only `per >= 1` can be doing the refusing.
    expect(deriveAttackDamageMultiplier(BENCH_F_COUNTERS.replace("does 20", "does 0"))).toBeNull();
    expect(deriveAttackDamageBonus(BENCH_CHARJABUG.replace("does 80", "does 0"))).toBeNull();
    // …the trailing PERIOD.
    expect(deriveAttackDamageMultiplier(BENCH_F_COUNTERS.slice(0, -1))).toBeNull();
    expect(deriveAttackDamageBonus(BENCH_CHARJABUG.slice(0, -1))).toBeNull();
    // …the leading CAPITAL. The prefix below ENDS A SENTENCE, so the lowercase `t`
    // is the only axis that moved (D452's finding).
    expect(deriveAttackDamageMultiplier(BENCH_F_COUNTERS.replace("This", "this"))).toBeNull();
    expect(deriveAttackDamageBonus(BENCH_CHARJABUG.replace("This", "this"))).toBeNull();
    // …and a LEADING clause, which the `^` refuses.
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${BENCH_F_COUNTERS}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${BENCH_CHARJABUG}`)).toBeNull();
    // …and the ADMISSION that makes all of them mean something (D424): the
    // near-misses one axis away are CLAIMED, so the anchors really do reach these
    // strings and it is the map that refuses.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Basic Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnYourBench", filter: { kind: "basicPokemon" } } });
    expect(
      deriveAttackDamageBonus("This attack does 80 more damage for each of your Benched Duskull."),
    ).toBeNull();
  });

  it("🛑 the OWNER-prefixed Bench noun resolves for free, and it is a CORPUS row", () => {
    // The counter anchor hands its whole noun to `inPlayBodyFilter`, so
    // `IN_PLAY_OWNER_NOUN` answers "Cynthia's Pokémon" with no row of its own —
    // which is the shape that makes file line 529's HEAD build (§10).
    expect(deriveAttackDamageMultiplier(CYNTHIA_HEAD)).toEqual({
      per: 10,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
      },
    });
  });
});

describe("§4 — DISJOINTNESS, driven over the whole column", () => {
  it("🛑 each new anchor claims exactly its own corpus rows, and takes none", () => {
    const counterRows = legalAttackCorpus().filter(([, s]) =>
      /^This attack does \d+ damage for each damage counter on all of your Benched .+ Pokémon\.$/.test(
        s,
      ),
    );
    expect(counterRows.map(([, s]) => s)).toEqual([BENCH_F_COUNTERS]);
    const namedRows = legalAttackCorpus().filter(([, s]) =>
      /^This attack does \d+ more damage for each of your Benched (?!Pokémon\.).+\.$/.test(s),
    );
    expect(namedRows.map(([, s]) => s)).toEqual([BENCH_CHARJABUG]);
  });

  it("🛑 all four SHIPPED Bench sentences still land on their own members, unfiltered", () => {
    expect(deriveAttackDamageMultiplier(BENCH_BARE_COUNTERS)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnYourBench" },
    });
    expect(deriveAttackDamageBonus(BENCH_BARE_BODIES_SCALE)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
    expect(deriveAttackDamageMultiplier(BENCH_BARE_BODIES_MULTIPLY)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your opponent's Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "opponentBenchCount" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
      ),
    ).toEqual({ per: 20, count: { kind: "bothSidesBenchCount" } });
  });

  it("🛑 the EMPTY CELLS are measured, not assumed (D435)", () => {
    // The counter axis prints NO additive spelling, and the body axis prints NO
    // filtered `×` spelling. Both are asserted over the column so that "we did not
    // build it" stays a measurement.
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /more damage for each damage counter on all of your Benched/.test(s),
      ),
    ).toEqual([]);
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /^This attack does \d+ damage for each of your Benched (?!Pokémon\.).+\.$/.test(s),
      ),
    ).toEqual([]);
    // …and the whole of `damage counter on all of` is THREE rows, two of them this
    // slice's subject and one the opponent's whole board on the other fold.
    expect(
      legalAttackCorpus()
        .filter(([, s]) => s.includes("damage counter on all of"))
        .map(([, s]) => s)
        .sort(),
    ).toEqual(
      [
        BENCH_F_COUNTERS,
        CYNTHIA_PRINTED,
        "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.",
      ].sort(),
    );
  });
});

describe("§5 — the `inPlayBodyFilter` vocabulary, DERIVED rather than transcribed", () => {
  it("🛑 the vocabulary is 8 exact keys + 11 names + 11 codes = 30, and none is possessive", () => {
    // 🆕🆕 **D467 — THIS COUNT LIVED IN TWO FILES AND ROTTED IN BOTH.**
    // `inPlayBodyFilter`'s doc block said *"25 nouns — the 3 exact keys"* from D439
    // until D467, which was already wrong at D446 and wronger at D466; D466 fixed
    // the COPY of that sentence inside `D439-vocabulary-order-loses-the-owner`'s
    // declared `reason` and left the original standing. A figure that lives in two
    // places rots in two places and reddens in neither — so it is DERIVED here,
    // through the reader, and the next key to land moves this rung instead of
    // silently disagreeing with a comment.
    const EXACT = [
      "Pokémon",
      "Basic Pokémon",
      "Evolution Pokémon",
      "Pokémon ex",
      "Pokémon ex and Pokémon V",
      "Stage 1 Pokémon",
      "Stage 2 Pokémon",
      "Charjabug",
    ];
    const OWNER_SHAPE = /['’]s Pokémon$/;
    for (const noun of EXACT) {
      // every exact key really does reach a reading — this is what stops the list
      // being a vacuous assertion about strings nobody parses…
      expect(
        deriveAttackDamageMultiplier(
          `This attack does 10 damage for each of your ${noun} in play.`,
        ),
      ).not.toBeNull();
      // …and none of them carries an apostrophe, which is the whole of what
      // `D439-vocabulary-order-loses-the-owner`'s declared reason needs.
      expect(OWNER_SHAPE.test(noun)).toBe(false);
    }
    const CODES = Object.keys(POKEMON_TYPE_BY_CODE).map((c) => `{${c}}`);
    expect(CODES).toHaveLength(POKEMON_TYPES.length);
    for (const token of [...POKEMON_TYPES, ...CODES]) {
      expect(OWNER_SHAPE.test(`${token} Pokémon`)).toBe(false);
      expect(
        deriveAttackDamageMultiplier(
          `This attack does 10 damage for each of your ${token} Pokémon in play.`,
        ),
      ).not.toBeNull();
    }
    expect(EXACT.length + POKEMON_TYPES.length + CODES.length).toBe(30);
  });

  it("🛑 the `Charjabug` row is reachable from the OTHER anchors too, and that is DELIBERATE", () => {
    // D466's stated consequence one ordinal up, verbatim: a reader is a function of
    // TEXT, and a noun the column does not print simply never arrives. Asserted so
    // the widening is a decision on the record rather than a surprise.
    expect(
      deriveAttackDamageMultiplier("This attack does 10 damage for each of your Charjabug in play."),
    ).toEqual({
      per: 10,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "byName", name: "Charjabug" } },
    });
    // 🛑 **AND THE COLUMN PRINTS `Charjabug` TWICE, NOT ONCE — THE WHOLE LIST, NOT A
    // COUNT** (D424/D428). File line 477 is D230's deck search, which has resolved
    // `byName {Charjabug}` since 0.2x — so this slice does not teach the engine the
    // NAME, it teaches ONE MORE VOCABULARY to spell it, and the two readings of that
    // name cannot drift because there is only one `byName` arm (D159).
    expect(
      legalAttackCorpus()
        .filter(([, s]) => s.includes("Charjabug"))
        .map(([, s]) => s)
        .sort(),
    ).toEqual(
      [
        "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.",
        BENCH_CHARJABUG,
      ].sort(),
    );
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "byName", name: "Charjabug" }, dest: "bench", max: 3 },
      { op: "shuffleDeck" },
    ]);
  });
});

describe("§6 — the COUNTER board: the resource, the zone, the seat", () => {
  it("🛑 seven distinguishable answers on ONE board", () => {
    const state = counterBoard();
    expect(benchCounters(state, "p1", FIGHTING)).toBe(7);
    expect(benchCounters(state, "p1")).toBe(19);
    expect(benchCounters(state, "p1", CHARJABUG)).toBe(6);
    expect(benchBodies(state, "p1", FIGHTING)).toBe(2);
    expect(benchBodies(state, "p1")).toBe(5);
    expect(benchCounters(state, "p2", FIGHTING)).toBe(1);
    // 🛑 **THE ZONE**: the Active is FIGHTING and carries 9 counters, so an "in play"
    // walk reads 16 where the printed word "Benched" reads 7.
    expect(activeOf(state, "p1").damage).toBe(90);
    expect(matchesFilter(topCardOf(state, activeOf(state, "p1")), FIGHTING)).toBe(true);
    expect(benchCounters(state, "p1", FIGHTING) + Math.floor(activeOf(state, "p1").damage / 10)).toBe(16);
  });
});

describe("§7 — the COUNTER fold: 140, and the printed base is DROPPED", () => {
  it("🛑 the swing deals 140", () => {
    // `20×` — the multiply marker: 7 × 20 = 140, and a build that kept the printed
    // base would deal 160.
    expect(dealt(counterBoard(), 0)).toBe(140);
  });

  it("🛑 the MIRROR is the same number, which is the seat-relative claim", () => {
    // `counterBoard("p2")` builds the identical board with the seats swapped, so a
    // seat-RELATIVE count answers 140 from either chair and a p1-hard-coded one
    // answers the DEFENDER's 1 × 20 = 20 when p2 swings.
    expect(dealt(counterBoard("p2"), 0, "p2")).toBe(140);
  });
});

describe("§8 — the NAMED board and fold: 2 bodies, 240 dealt", () => {
  it("🛑 the counts: 2, and every wrong build reads another number", () => {
    const state = namedBoard();
    expect(benchBodies(state, "p1", CHARJABUG)).toBe(2);
    expect(benchBodies(state, "p1")).toBe(5);
    expect(benchBodies(state, "p1", { kind: "evolutionPokemon" })).toBe(4);
    expect(benchBodies(state, "p1", { kind: "stagePokemon", stage: "Stage1" })).toBe(4);
    expect(benchBodies(state, "p1", DUSKULL)).toBe(1);
    expect(benchBodies(state, "p1", { kind: "basicPokemon" })).toBe(1);
    expect(benchBodies(state, "p2", CHARJABUG)).toBe(1);
    // 🛑 **`byName` IS AN EXACT EQUALITY ON `Card.name`, AND THE PAIR IS WHAT MAKES
    // THAT FALSIFIABLE** (D230/D237): a build matching on STAGE instead of NAME reads
    // 4, and a build emitting `anyPokemon` reads 5.
    expect(topCardOf(state, state.players.p1.bench[0] as InPlayPokemon)?.name).toBe("Charjabug");
    expect(topCardOf(state, state.players.p1.bench[4] as InPlayPokemon)?.name).toBe("Duskull");
  });

  it("🛑 the swing deals 240 — the base is KEPT, because the fold is additive", () => {
    expect(dealt(namedBoard(), 1)).toBe(240);
    expect(dealt(namedBoard("p2"), 1, "p2")).toBe(240);
  });
});

describe("§9 — `MATCH_RECORD_VERSION` STAYS 29, driven in THREE directions", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
  // this package; what is driven HERE is the engine-side fact it is about.
  //
  // 🛑 **THE SHAPE IS THE SERIALIZED ALPHABET (D462), AND IT IS ONE ADDRESS AND NOT
  // TWO.** D466 needed two because it added a `CardFilter` MEMBER, and `CardFilter`
  // is persisted (nine `EffectOp` fields carry one and an op rides
  // `state.phase.cont.pendingOp`). **D467 ADDS NO `CardFilter` MEMBER** — it reuses
  // `typedPokemon` and `byName`, both of which a v29 record could already hold — so
  // the only shape change is one OPTIONAL field on `DamageCountSource`, which is a
  // PARSE-TIME type derived from card text and consumed in the same tick by
  // `scaledAttackDamage`. No op carries one, no field stores one, no event names
  // one. Reachability is NOT the argument here (nothing parks) and "nothing optional
  // added" is FALSE (a field was added) — the alphabet is the shape that is true.

  it("🛑 DIRECTION 1 — a v29 record round-trips and STILL scores both numbers", () => {
    const counters = JSON.parse(JSON.stringify(counterBoard())) as GameState;
    expect(dealt(counters, 0)).toBe(140);
    const named = JSON.parse(JSON.stringify(namedBoard())) as GameState;
    expect(dealt(named, 1)).toBe(240);
  });

  it("🛑 DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    const before = counterBoard();
    const wire = JSON.stringify(swing(before, 0).state);
    expect(wire).not.toContain("damageCountersOnYourBench");
    expect(wire).not.toContain("yourBenchCount");
    expect(wire).not.toContain("typedPokemon");
    expect(wire).not.toContain("byName");
    // ⚠️ **AND NOT THE NAME ITSELF, WHICH WAS TRIED AND IS WRONG**: `GameState`
    // embeds `cardPool`, so the string "Charjabug" is in the bytes as a card NAME
    // and as printed effect TEXT before this slice and after it. The subject of this
    // rung is the DERIVED READING, not the catalog — a rung that asserted the name
    // absent would be asserting something false about a byte the record has always
    // carried.
    // …and no body gained a key: the attacker's key set equals the untouched
    // defender's and equals its own from before the swing.
    const after = swing(before, 0).state;
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("🛑 DIRECTION 3 — the LOSS, and it is TOTAL and harmless", () => {
    // The loss direction asks what a record written by the PREVIOUS deploy does
    // here. A v29 record carries no `filter` byte anywhere — Direction 2 measures
    // that — because the field never reaches storage; the reading is re-derived from
    // the card's printed TEXT on every swing. So the "lost" value is not degraded,
    // it is RECOMPUTED, and the board that comes back scores the same number.
    //
    // Driven rather than argued: strip every key the slice could conceivably have
    // added by round-tripping through JSON, then swing.
    const roundTripped = JSON.parse(JSON.stringify(counterBoard())) as GameState;
    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(counterBoard()));
    expect(dealt(roundTripped, 0)).toBe(140);
    // …and the SHIPPED spellings are byte-identical across the same round trip,
    // which is what "no byte a v29 record can hold after the slice that it could not
    // hold before it" means at the reader end.
    expect(JSON.stringify(deriveAttackDamageMultiplier(BENCH_BARE_COUNTERS))).toBe(
      '{"per":20,"count":{"kind":"damageCountersOnYourBench"}}',
    );
    expect(JSON.stringify(deriveAttackDamageBonus(BENCH_BARE_BODIES_SCALE))).toBe(
      '{"per":20,"count":{"kind":"yourBenchCount"}}',
    );
  });
});

describe("§10 — corpus file line 529: BUILT at D493, and what its TWO blockers became", () => {
  // 🆕🆕🆕 **D493 — THIS SECTION WAS THIS FILE'S NEGATIVE CONTROL FROM D467 UNTIL NOW,
  // AND IT IS RE-POINTED RATHER THAN DELETED (D438/D444/D447).** D467 removed the
  // first of the row's three blockers (the printed owner noun) and wrote the other
  // two down as executable rungs; D493 pays both. What is kept below is every
  // discrimination the old rungs provided, each moved onto a subject that STILL has
  // the property the rung was written for — because a `toBeNull` that is re-pointed
  // onto its own newly-built subject is true under the mistaken build and under the
  // real one alike (D418/D438), which is the shape that disarms tripwires.
  it("🛑 the printed sentence is now RESOLVED, and by exactly TWO readers", () => {
    // D438's shape: NAME the owners by VALUE and keep the other eleven refusals
    // beside them. A bare `resolvedByAnyReader(...) === true` would be satisfied by
    // any careless widening of any of the thirteen.
    expect(deriveAttackDamageMultiplier(CYNTHIA_PRINTED)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench", filter: { kind: "ownerPokemon", owner: "Cynthia" } },
    });
    expect(deriveAttackDamageSuppression(CYNTHIA_PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(CYNTHIA_PRINTED)).toBe(true);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackDamageMultiplier" || name === "deriveAttackDamageSuppression") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(CYNTHIA_PRINTED) ?? null, name).toBeNull();
    }
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 …and the COMPOUND's fold is the HEAD's fold, by construction rather than by agreement", () => {
    // The two anchors are separate literals, so the one thing that can go wrong is
    // that they drift and the compound scores a different number from its own head.
    // ⚠️ PINNED AS A POPULATION CLAIM AND NOT ON THIS SPECIMEN (D423): over the WHOLE
    // 640-row column, every sentence this reader claims whose FIRST clause it also
    // claims must derive the identical fold from both.
    expect(deriveAttackDamageMultiplier(CYNTHIA_PRINTED)).toEqual(
      deriveAttackDamageMultiplier(CYNTHIA_HEAD),
    );
    let compared = 0;
    for (const [, text] of legalAttackCorpus()) {
      const whole = deriveAttackDamageMultiplier(text);
      if (whole === null) continue;
      const firstClause = `${text.split(". ")[0] ?? ""}.`;
      if (firstClause === text) continue;
      const head = deriveAttackDamageMultiplier(firstClause);
      if (head === null) continue;
      compared += 1;
      expect(whole, text).toEqual(head);
    }
    // The count is pinned separately from the comparison, because a comparison over
    // an empty set passes (D417: pin the diff AND the count).
    expect(compared).toBe(1);
  });

  it("🛑 BLOCKER 1 SURVIVES: `DAMAGE_SUPPRESSION` still has no WEAKNESS-ONLY arm", () => {
    // `AttackDamageSuppression.weakness` is a field with THREE readers in attack.ts
    // and no pattern arm that sets it alone: the four printed alternatives are
    // W+R+effects, W+R, R, and effects. So the tail of file line 529 does not build
    // even on its own, and this is checked at the reader rather than inherited from
    // attack.ts's deferral comment (D440/D466: check the reason, not only the price).
    //
    // 🆕🆕🆕 **D493 — THIS RUNG IS UNCHANGED AND STILL TRUE, AND THAT IS THE FINDING
    // RATHER THAN AN OVERSIGHT.** D493 built file line 529 WITHOUT widening this
    // vocabulary: the compound has its own anchor and `DAMAGE_SUPPRESSION` is
    // BYTE-UNCHANGED. The reason is a measurement — the legal column prints
    // *"This attack's damage isn't affected by Weakness."* as a STANDALONE sentence
    // ZERO times (it occurs only as the tail of file lines 337 and 529), so a
    // standalone arm would be vocabulary with no printing behind it, and three
    // shipped `toBeNull` rungs across three files rest on this refusal
    // (`damageSuppression.test.ts`, here, and `selfEnergyScaling.test.ts`'s REASON 3,
    // one of the three independent reasons Pachirisu's fixture printing stays
    // unread). ⚠️ **THE FALSIFIER, EXECUTABLE**: the day the column prints that
    // sentence alone, the first assertion below is what has to change.
    expect(
      legalAttackCorpus().filter(([, t]) => t === CYNTHIA_TAIL),
    ).toEqual([]);
    expect(deriveAttackDamageSuppression(CYNTHIA_TAIL)).toBeNull();
    expect(deriveAttackDamageSuppression("This attack's damage isn't affected by Resistance.")).toEqual(
      { resistance: true },
    );
    expect(
      deriveAttackDamageSuppression("This attack's damage isn't affected by Weakness or Resistance."),
    ).toEqual({ weakness: true, resistance: true });
  });

  it("🛑 BLOCKER 2 — RE-POINTED, because this row now passes it for a DIFFERENT reason", () => {
    // 🆕🆕🆕 **D493 — THE RUNG BELOW WOULD STILL BE GREEN ON `CYNTHIA_PRINTED`, AND IT
    // WOULD NO LONGER MEAN WHAT ITS TITLE SAYS (D486).** Before this slice the
    // splitter refused that string at its TAIL TEST (`deriveAttackEffect(tail) ===
    // null`). It now refuses at the SHADOW REFUSAL one line EARLIER, because a string
    // some reader claims whole never reaches composition at all. Two different
    // refusals, one unmoved verdict — exactly D426's mechanism, and the reason a
    // green rung is not evidence about its stated claim.
    //
    // **So the old discrimination is moved to a subject that STILL HAS THE PROPERTY**
    // (D444), and there is one in the pool: Pachirisu `sv01-068`/`-208` "Everyone
    // Discharge" (3 catalog / 0 legal, `FIXTURE_POOL`), whose HEAD builds through
    // `deriveAttackDamageBonus` and whose TAIL is the same Weakness-only suppression
    // clause. No reader claims it whole, so the shadow refusal does NOT fire and the
    // TAIL TEST is the only thing between it and a composition — which is the claim
    // this rung was written to make.
    const poolRider =
      "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
    expect(resolvedByAnyReader(poolRider)).toBe(false);
    expect(deriveAttackDamageBonus("This attack does 20 more damage for each of your Benched {L} Pokémon.")).not.toBeNull();
    expect(deriveAttackEffect("This attack's damage isn't affected by Weakness.")).toBeNull();
    expect(splitAttackTrailingClause(poolRider)).toBeNull();
    // …and the ORIGINAL subject, kept with its new reason stated, so the transition
    // is recorded rather than lost (D467: a rung that quietly shrinks loses it).
    expect(splitAttackTrailingClause(CYNTHIA_PRINTED)).toBeNull();
    expect(splitAttackGateClause(CYNTHIA_PRINTED)).toBeNull();
    expect(deriveAttackEffect(CYNTHIA_TAIL)).toBeNull();
  });
});
