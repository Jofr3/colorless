import { describe, expect, it } from "vitest";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  BENCH_BODY_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.123.0 → 0.124.0 — THREE new `DamageCountSource` members (P3-M5 long tail,
// D193), the seventh, eighth and ninth:
//
//   `bothSidesBenchCount`  — bodies on BOTH Benches      (ADD only)
//   `opponentBenchCount`   — bodies on the DEFENDER's    (ADD **and** MULTIPLY)
//   `energyOnOpponent`     — Energy attached to the      (ADD active-zone only,
//                            opponent, over two zones     MULTIPLY both zones)
//                            and an optional type filter
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule), AND EVERY COUNT IS A
// RE-MEASUREMENT rather than an inheritance. The D1 (2026-08-04) holds 3,786 rows;
// **2,021 are Standard-legal** (`legal_standard = 1` ⇔ regulation mark H/I, plus
// unmarked Basic Energy). The six-set census population
// (`sv01`,`sv02`,`sv03`,`sv06.5`,`sve`,`swsh10.5`) is 978 rows of which only
// **127** are legal — so the six-set numbers this file's neighbours were built on
// describe a population that has almost entirely rotated out, and EVERY count
// below is stated against the LEGAL pool with the six-set figure beside it.
//
//   member                  legal   six-set   folds measured
//   bothSidesBenchCount       5        0      ADD only
//   opponentBenchCount        6        4      ADD (4) + MULTIPLY (2)
//   energyOnOpponent         17        3      ADD (8, active only) +
//                                             MULTIPLY (3 active, 6 board)
//
// ⚠️ THE THINGS THAT TURNED OUT WRONG, STATED FIRST BECAUSE THEY ARE THE POINT:
//
//   • **`opponentBenchCount`'s ADDITIVE fold is carried by the `20 more` printing,
//     NOT the `30 more` one every older comment in this file names.** D170's
//     BENCH_COUNTER_MULTIPLY block cites Oinkologne ex sv01-158/-234 "Maddening
//     Scent" and Tyranitar sv02-135/-222 "Rout" printing "This attack does 30 more
//     damage for each of your opponent's Benched Pokémon." — 9 printings and
//     **0 legal**. The legal additive printings all say `20 more` (5 printings,
//     4 legal). One `(\d+)` capture spans both, so the pattern is unaffected; the
//     PRICING was not, and a slice that had gone looking for "Rout" in the legal
//     pool would have found nothing and concluded the fold was unprinted.
//
//   • **`bothSidesBenchCount` is ADD-only by ABSENCE, not by rarity.** The pool
//     prints no no-adjective twin of its sentence in any text column — see the
//     pinned absence below. Reaching for one would have bought a dead pattern.
//
//   • **The `energyOnSelf` member this slice was scoped to build alongside these
//     three was DROPPED, and the reason is in `perEnergyFlip.test.ts` /
//     `scaledDamage.test.ts` / `log.test.ts` / `checkup.test.ts`.** Entei
//     sv03-030's "Blaze Ball" ("This attack does 20 more damage for each {R}
//     Energy attached to this Pokémon.") is this engine's canonical
//     UNSIMULATED-"+" witness and has been since 0.35.0. Building the self-side
//     member makes it simulated and turns **5 assertions across those 4 files**
//     red; re-homing the witness is a real and easy repair (see the replacement
//     candidate named in the pinned absence below) but it is not this slice's
//     to make. Measured, not guessed: the member was implemented, the suite run,
//     the failures counted, and the implementation reverted.

// ─────────────────────────────────────────────────────────────────────────────
// The printed sentences, transcribed char-for-char off the D1 rows. Every
// possessive is an ASCII 0x27 in the catalog today; the patterns carry the `['’]`
// class anyway (D137), and `Pokémon` carries a real U+00E9 everywhere.
// ─────────────────────────────────────────────────────────────────────────────

/** BOTH Benches, ADDITIVE — 5 printings, 5 legal, printed `20+` and `60+`. */
const HERD_CHARGE =
  "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).";
/** The opponent's Bench, ADDITIVE — 5 printings, 4 legal, printed `20+`. */
const CROWD_CRUSH = "This attack does 20 more damage for each of your opponent's Benched Pokémon.";
/** The opponent's Bench, MULTIPLY — 2 printings, 2 legal, printed `30×`. */
const FLANK_RUSH = "This attack does 30 damage for each of your opponent's Benched Pokémon.";
/** The ZERO-LEGAL additive spelling D170's block names (9 printings, 4 six-set) —
    carried so the `(\d+)` capture is driven on a REAL printed amount rather than
    on constructed text, and so the correction above is asserted rather than
    claimed. */
const ROUT = "This attack does 30 more damage for each of your opponent's Benched Pokémon.";
/** The opponent's ACTIVE, untyped — additive (8 legal across four amounts) and
    multiply (3 legal). */
const DRAIN_READ =
  "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.";
const SIPHON_BLAST =
  "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.";
/** ALL of the opponent's Pokémon — MULTIPLY only, untyped (3 legal) and `{R}`
    filtered (2 legal). */
const FIELD_SCAN =
  "This attack does 60 damage for each Energy attached to all of your opponent's Pokémon.";
const FLARE_SCAN =
  "This attack does 60 damage for each {R} Energy attached to all of your opponent's Pokémon.";
/** The `Special` filter on the board zone — 1 legal printing, and free: `Special`
    resolves through `CLAUSE_ENERGY_TOKENS` like every brace code. */
const SPECIAL_SCAN =
  "This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon.";

/** `fix-benchcount`'s index 3 — the SPREAD that names the same zone with the same
    preposition, and is not a scaling clause at all. */
const HERD_STOMP =
  "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** One seed for the whole suite: nothing here flips a coin, and every Active,
    Benched body and attached Energy is placed by surgery, so a seed table would
    describe a shuffle rather than a rule (D143's move, inherited by every scaling
    suite since). */
const SEED = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The attack indices, keyed by name so no case addresses a fold by number. */
const BENCH = { herd: 0, crowd: 1, flank: 2, stomp: 3 } as const;
const ENERGY = { drain: 0, siphon: 1, field: 2, flare: 3 } as const;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. BOTH Benches are cleared to nothing and both Actives
    placed by surgery: every number this suite measures is a POPULATION, so a body
    the setup shuffle happened to place would silently move the answer. */
function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BENCH_BODY_DECK, p2: BENCH_BODY_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** …with `count` `fix-titan`s standing on `seat`'s Bench. */
function withBench(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) next = benchFromDeck(next, seat, "fix-titan");
  return next;
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** The `dealt` on the one DAMAGE_DEALT row, or null when the attack dealt none. */
function dealt(events: GameEvent[]): number | null {
  return find(events, "DAMAGE_DEALT")?.dealt ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures — a SEPARATE population, swept before anything was written.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, then authored", () => {
  it("⚠️ HELD NOTHING TO REUSE: no fixture printed any of these seven sentences", () => {
    // D156's rule, and the reason it is asserted rather than remembered: three
    // slices running have found zero coverage where they expected reuse. This is
    // the sweep re-run as a test, so a later slice that adds one of these
    // sentences to another fixture learns it here rather than by a silent double
    // answer. `fix-benchcount` / `fix-oppenergy` are excluded because they ARE
    // this slice's authored bodies.
    const mine = new Set(["fix-benchcount", "fix-oppenergy"]);
    const sentences = [
      HERD_CHARGE,
      CROWD_CRUSH,
      FLANK_RUSH,
      ROUT,
      DRAIN_READ,
      SIPHON_BLAST,
      FIELD_SCAN,
      FLARE_SCAN,
      SPECIAL_SCAN,
    ];
    const carriers = Object.entries(FIXTURE_POOL).filter(
      ([id, card]) =>
        !mine.has(id) && (card.attacks ?? []).some((a) => sentences.includes(a.effect ?? "")),
    );
    expect(carriers.map(([id]) => id)).toEqual([]);
  });

  it("carries `fix-benchcount`'s WHOLE attack list, indices and printed markers", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and no later slice indexes into a short one. SYNTHETIC on purpose: the
    // manifest generator reads a `.wrangler` D1 that is absent from this container
    // (`SQLITE_CANTOPEN`), so `CATALOG_MANIFEST` cannot be regenerated and a
    // real-card fixture could not be diffed against its printing — `fix-*` bodies
    // are skipped by `catalogManifest.test.ts` by construction.
    expect(FIXTURE_POOL["fix-benchcount"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless"],
        name: "Herd Charge",
        effect: HERD_CHARGE,
        damage: "20+",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Crowd Crush",
        effect: CROWD_CRUSH,
        damage: "20+",
      },
      { cost: ["Colorless", "Colorless"], name: "Flank Rush", effect: FLANK_RUSH, damage: "30×" },
      { cost: ["Colorless", "Colorless"], name: "Herd Stomp", effect: HERD_STOMP, damage: 30 },
    ]);
    expect(FIXTURE_POOL["fix-benchcount"]?.types).toEqual(["Fire"]);
  });

  it("carries `fix-oppenergy`'s WHOLE attack list, indices and printed markers", () => {
    expect(FIXTURE_POOL["fix-oppenergy"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Drain Read", effect: DRAIN_READ, damage: "30+" },
      { cost: ["Colorless"], name: "Siphon Blast", effect: SIPHON_BLAST, damage: "20×" },
      { cost: ["Colorless"], name: "Field Scan", effect: FIELD_SCAN, damage: "60×" },
      { cost: ["Colorless"], name: "Flare Scan", effect: FLARE_SCAN, damage: "60×" },
    ]);
  });

  it("AUTHORS nothing — every printing here is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-benchcount")).toBeUndefined();
    expect(programFor("fix-oppenergy")).toBeUndefined();
  });

  it("🆕🆕 D425 — `fix-benchcount` index 3 was DECLARED-UNSIMULATED and is SIMULATED now", () => {
    // 🛑 **THE ADMISSION EXPIRED AT D425 AND THE RUNG IS RE-POINTED, NOT DELETED
    // (D418).** It read *"'Herd Stomp' names the attacker's own Bench with the same
    // preposition the three scaling sentences use and is a SPREAD, so no reader may
    // answer it"* — carried out loud on D169's convention. `SPREAD_EACH_BENCH` reads
    // the printed possessive as a capture now, so the sentence derives.
    //
    // ⚠️ **AND THE NEW CLAIM NAMES THE SIDE, WHICH `toBeNull()` COULD NOT.** A build
    // that answered `"opponentBench"` here would be reading a sentence with no
    // "opponent" in it onto the wrong board, and would pass every negative this
    // suite used to run. `D425-spread-side-flips` names this file among its killers.
    expect(deriveAttackEffect(HERD_STOMP)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 20 },
    ]);
    // ⚠️ **THE THREE SCALING READERS STILL REFUSE IT — the half of the old rung that
    // was never about D425.** This suite's subject counts BODIES on a zone; index 3
    // names the identical zone with the identical preposition and is a spread, so a
    // scaling reader claiming it would be reading the zone instead of the clause.
    expect(deriveAttackDamageBonus(HERD_STOMP)).toBeNull();
    expect(deriveAttackDamageMultiplier(HERD_STOMP)).toBeNull();
    expect(deriveAttackDamagePenalty(HERD_STOMP)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The readers — the fold is the ADJECTIVE, never the attack name or the amount.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageBonus — three body/Energy counts on the ADDITIVE fold", () => {
  it("reads both Benches, the opponent's Bench and the opponent's Active Energy", () => {
    expect(deriveAttackDamageBonus(HERD_CHARGE)).toEqual({
      per: 20,
      count: { kind: "bothSidesBenchCount" },
    });
    expect(deriveAttackDamageBonus(CROWD_CRUSH)).toEqual({
      per: 20,
      count: { kind: "opponentBenchCount" },
    });
    expect(deriveAttackDamageBonus(DRAIN_READ)).toEqual({
      per: 30,
      count: { kind: "energyOnOpponent", zone: "active", energyType: null },
    });
  });

  it("captures the amount — driven on the ZERO-LEGAL `30 more` printing, not constructed text", () => {
    // ⚠️ THIS IS THE CORRECTION, ASSERTED. "Rout"'s spelling is a real catalog
    // sentence (9 printings) that is 0-legal today; it exercises the `(\d+)` on a
    // printed amount rather than on text this file invented, and it pins that the
    // pattern is keyed on the SENTENCE and not on the legality of a printing.
    expect(deriveAttackDamageBonus(ROUT)).toEqual({
      per: 30,
      count: { kind: "opponentBenchCount" },
    });
  });

  it("KEEPS its five older count sources — no arm was stranded", () => {
    expect(
      deriveAttackDamageBonus("This attack does 10 more damage for each damage counter on this Pokémon."),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnSelf" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentActiveRetreatCost" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnOpponentActive" } });
    expect(
      deriveAttackDamageBonus("If this Pokémon has a Pokémon Tool attached, this attack does 30 more damage."),
    ).toMatchObject({ per: 30, count: { kind: "boardCondition" } });
  });

  it("⚠️ CANNOT PRODUCE `zone: \"board\"` — the additive board spelling is UNPRINTED", () => {
    // Not merely zero-legal: absent from every text column of the D1. The `zone`
    // field exists because the MULTIPLY reader varies it; this reader hard-codes
    // "active" rather than capturing a value it can never produce, and the next
    // author to see `zone` on the type needs to learn that here.
    expect(
      deriveAttackDamageBonus(
        "This attack does 60 more damage for each Energy attached to all of your opponent's Pokémon.",
      ),
    ).toBeNull();
  });
});

describe("deriveAttackDamageMultiplier — the same two resources on the `×` fold", () => {
  it("reads the opponent's Bench and both Energy zones", () => {
    expect(deriveAttackDamageMultiplier(FLANK_RUSH)).toEqual({
      per: 30,
      count: { kind: "opponentBenchCount" },
    });
    expect(deriveAttackDamageMultiplier(SIPHON_BLAST)).toEqual({
      per: 20,
      count: { kind: "energyOnOpponent", zone: "active", energyType: null },
    });
    expect(deriveAttackDamageMultiplier(FIELD_SCAN)).toEqual({
      per: 60,
      count: { kind: "energyOnOpponent", zone: "board", energyType: null },
    });
  });

  it("reads the TYPE FILTER, both notations, and `Special` for free", () => {
    expect(deriveAttackDamageMultiplier(FLARE_SCAN)).toEqual({
      per: 60,
      count: { kind: "energyOnOpponent", zone: "board", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(SPECIAL_SCAN)).toEqual({
      per: 40,
      count: { kind: "energyOnOpponent", zone: "board", energyType: "special" },
    });
    // The spelled-out notation is admitted by construction through D118's map —
    // and is **0 legal** in this pool (see the retired-trap section below), so
    // this is a reachability claim and not a coverage one.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Water Energy attached to all of your opponent's Pokémon.",
      ),
    ).toEqual({ per: 60, count: { kind: "energyOnOpponent", zone: "board", energyType: "Water" } });
  });

  it("⚠️ TELLS 'no filter' APART FROM 'a filter I could not read' — the second stays LOUD", () => {
    // The whole guard. Collapsing the two would make an unreadable token quietly
    // score the UNFILTERED total. `{C}` is deliberately absent from
    // ENERGY_TYPE_BY_CODE — it is the conservative provision fallback for every
    // unauthored Special Energy, so a `{C}` filter would quietly match cards nobody
    // meant.
    //
    // 🆕🆕 **D500 CORRECTED THE PARAGRAPH THAT USED TO STAND HERE, AND THE CORRECTION
    // IS THE INTERESTING PART.** It read: *"'Basic' is a card CATEGORY, not a type —
    // the pool prints 'for each Basic Energy attached to this Pokémon.' (1 legal) and
    // that sentence asks a question `countEnergyInPlay` does not answer."* The first
    // clause is true and the second was false in two ways at once. `countEnergyInPlay`
    // has answered a card-CATEGORY question since D159 — `"special"` is one, read off
    // `isSpecialEnergy` rather than through provision — so the category was never
    // outside its vocabulary; and the sentence it names does not reach
    // `countEnergyInPlay` at all, because *"attached to this Pokémon"* is the
    // ZONE-LESS path and delegates to `countAttachedEnergy`. A refusal names a
    // CARRIER, and this one named the wrong carrier AND was wrong about it (D457/D499).
    // The row cost one map entry.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each {C} Energy attached to all of your opponent's Pokémon.",
      ),
    ).toBeNull();
    // …and a bogus token, so the LOUD half does not rest on the one deliberately
    // omitted code.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Fancy Energy attached to all of your opponent's Pokémon.",
      ),
    ).toBeNull();
    // 🆕🆕 D500 — and `Basic` RESOLVES now, on this zone as on the self side.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Basic Energy attached to all of your opponent's Pokémon.",
      ),
    ).toEqual({ per: 60, count: { kind: "energyOnOpponent", zone: "board", energyType: "basic" } });
  });

  it("KEEPS its four older count sources — no arm was stranded", () => {
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each damage counter on this Pokémon."),
    ).toEqual({ per: 30, count: { kind: "damageCountersOnSelf" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 60, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 50, count: { kind: "opponentActiveRetreatCost" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnYourBench" } });
  });
});

describe("the FOLD is the printed adjective — driven in BOTH directions", () => {
  it("refuses each other's sentences, so no sentence gets two answers", () => {
    // A first-match-wins hazard here would be silent in exactly one direction,
    // which is why both are driven for every new sentence.
    for (const add of [HERD_CHARGE, CROWD_CRUSH, ROUT, DRAIN_READ]) {
      expect(deriveAttackDamageMultiplier(add)).toBeNull();
      expect(deriveAttackDamagePenalty(add)).toBeNull();
      expect(deriveAttackEffect(add)).toBeNull();
    }
    for (const mult of [FLANK_RUSH, SIPHON_BLAST, FIELD_SCAN, FLARE_SCAN, SPECIAL_SCAN]) {
      expect(deriveAttackDamageBonus(mult)).toBeNull();
      expect(deriveAttackDamagePenalty(mult)).toBeNull();
      expect(deriveAttackEffect(mult)).toBeNull();
    }
  });

  it("⚠️ IS DISJOINT FROM THE `damage counter` BENCH PATTERN, IN BOTH DIRECTIONS", () => {
    // D170's BENCH_COUNTER_MULTIPLY names a Bench too. It requires the literal
    // `damage counter on all of your` before its noun; these three have no "damage
    // counter" at all, and all four are `^…$`-anchored — so no side needs a
    // negative lookahead. Asserted rather than argued.
    const counters = "This attack does 10 damage for each damage counter on all of your Benched Pokémon.";
    expect(deriveAttackDamageMultiplier(counters)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench" },
    });
    expect(deriveAttackDamageBonus(counters)).toBeNull();
    for (const mine of [FLANK_RUSH, CROWD_CRUSH, HERD_CHARGE]) {
      expect(mine).not.toContain("damage counter");
    }
  });

  it("⚠️ PINS THE ABSENCE: `bothSidesBenchCount` has NO multiply or subtract twin", () => {
    // ADD-only by MEASUREMENT. The only other row in the pool carrying this
    // parenthetical beside a "for each" is "Shuffle your hand into your deck.
    // Then, draw a card for each Benched Pokémon (both yours and your opponent's)."
    // (1 printing, 0 legal) — a DRAW, not a damage clause. So these two spellings
    // are absences rather than unread printings, and building for them would have
    // bought a dead pattern.
    const bare = HERD_CHARGE.replace(" more damage", " damage");
    const less = HERD_CHARGE.replace(" more damage", " less damage");
    expect(deriveAttackDamageMultiplier(bare)).toBeNull();
    expect(deriveAttackDamageBonus(bare)).toBeNull();
    expect(deriveAttackDamagePenalty(less)).toBeNull();
  });

  it("refuses the near-misses by the anchors alone — leading text, lowercase, no period", () => {
    for (const sentence of [HERD_CHARGE, CROWD_CRUSH, FLANK_RUSH, FIELD_SCAN]) {
      const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
      expect(read(`Flip a coin. If heads, ${sentence.toLowerCase()}`)).toBeNull();
      expect(read(sentence.replace(/^This/, "this"))).toBeNull();
      expect(read(sentence.slice(0, -1))).toBeNull();
      expect(read(`${sentence} Then, shuffle your deck.`)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The evaluator, driven on real boards — and the MIRROR witnesses.
// ─────────────────────────────────────────────────────────────────────────────

describe("scaledAttackDamage — the body counts, on boards where the two sides DISAGREE", () => {
  it("counts BOTH Benches: 3 mine + 1 theirs = 4 × 20 onto a printed 20", () => {
    let state = board("fix-benchcount", "fix-titan");
    state = withBench(state, "p1", 3);
    state = withBench(state, "p2", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { events } = swing(state, BENCH.herd);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(80);
    expect(dealt(events)).toBe(100); // 20 printed + 80
  });

  it("⚠️ THE MIRROR WITNESS: the SAME board reads 1, not 4, for the opponent-only count", () => {
    // 2b mirrors 2a, so the two owe a board where they DISAGREE — otherwise a
    // reader that started answering both would collapse them and every symmetric
    // board would stay green. 3 mine / 1 theirs is that board: both-sides is 4,
    // opponent-only is 1, and the attacker-only reading a mutant would produce is
    // 3. All three numbers are distinct on one setup.
    let state = board("fix-benchcount", "fix-titan");
    state = withBench(state, "p1", 3);
    state = withBench(state, "p2", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { events } = swing(state, BENCH.crowd);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(20); // 1 × 20, NOT 4 × 20 and NOT 3 × 20
    expect(dealt(events)).toBe(40);
  });

  it("counts BODIES and never the counters on them", () => {
    // The mirror-image mistake of `damageCountersOnYourBench` one arm up: the same
    // zone walk asking a different question. A pristine Bench and a nearly-dead one
    // give the same number, and only the population moves it.
    let clean = board("fix-benchcount", "fix-titan");
    clean = withBench(clean, "p2", 2);
    clean = attachFromDeck(clean, "p1", "fix-energy", 2);
    const pristine = swing(clean, BENCH.crowd).events;

    let hurt = board("fix-benchcount", "fix-titan");
    hurt = withBench(hurt, "p2", 2);
    hurt = attachFromDeck(hurt, "p1", "fix-energy", 2);
    // Every benched body carries damage — a counter-reading mutant would jump.
    hurt = {
      ...hurt,
      players: {
        ...hurt.players,
        p2: {
          ...hurt.players.p2,
          bench: hurt.players.p2.bench.map((p) => ({ ...p, damage: 90 })),
        },
      },
    };
    expect(find(swing(hurt, BENCH.crowd).events, "DAMAGE_DEALT")?.scaled).toBe(40);
    expect(find(pristine, "DAMAGE_DEALT")?.scaled).toBe(40);
  });

  it("an EMPTY opponent Bench on the `×` fold deals nothing at all — the base is DROPPED", () => {
    // The observable half of the multiply fold: printed "30×" with a count of 0 is
    // 0 damage, and no DAMAGE_DEALT row exists to carry a 30 that never happened.
    let state = board("fix-benchcount", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { events } = swing(state, BENCH.flank);
    expect(dealt(events)).toBeNull();
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…and a populated one is `per × count` WHOLE: 4 × 30 = 120, never 30 + 120", () => {
    let state = board("fix-benchcount", "fix-titan");
    state = withBench(state, "p2", 4);
    state = withBench(state, "p1", 2); // the attacker's own Bench must not enter
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    expect(dealt(swing(state, BENCH.flank).events)).toBe(120);
  });
});

describe("scaledAttackDamage — the opponent's Energy, over two zones", () => {
  /** The attacker with one `{C}` to pay with, the defender's Active carrying
      `active` Energy and one benched body carrying `bench` of them. */
  function energyBoard(active: number, bench: number, fire = 0): GameState {
    let state = board("fix-oppenergy", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    if (active > 0) state = attachFromDeck(state, "p2", "fix-water-energy", active);
    state = withBench(state, "p2", 1);
    if (bench > 0) state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", bench);
    if (fire > 0) state = attachBenchFromDeck(state, "p2", 0, "fix-fire-energy", fire);
    return state;
  }

  it("the ACTIVE zone reads the DEFENDER's Active, additively: 2 × 30 onto a printed 30", () => {
    const { events } = swing(energyBoard(2, 3), ENERGY.drain);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(60);
    expect(dealt(events)).toBe(90);
  });

  it("⚠️ THE MIRROR WITNESS: the board zone reads 5, the active zone 2, on ONE board", () => {
    // The two zones must disagree or a reader that answered both would collapse
    // them. 2 on the defender's Active + 3 on its Bench: active = 2, board = 5,
    // and the ATTACKER's own single Energy (the number a `attacker`-drifted mutant
    // would report) is 1. Three distinct answers on one setup.
    const state = energyBoard(2, 3);
    expect(dealt(swing(state, ENERGY.siphon).events)).toBe(40); // 2 × 20
    expect(dealt(swing(state, ENERGY.field).events)).toBe(300); // 5 × 60
  });

  it("⚠️ `board` is a SUPERSET of `active`, not the Bench alone (§6.3 'in play')", () => {
    // The failure mode this pins is the plausible one: reading "all of your
    // opponent's Pokémon" as the Bench walk `damageCountersOnYourBench` performs.
    // With Energy ONLY on the Active, the Bench-only reading is 0 and the correct
    // one is 2.
    expect(dealt(swing(energyBoard(2, 0), ENERGY.field).events)).toBe(120);
    // …and with Energy only on the Bench, the active-zone reading is 0 damage at
    // all while the board reading is 3 × 60.
    expect(dealt(swing(energyBoard(0, 3), ENERGY.siphon).events)).toBeNull();
    expect(dealt(swing(energyBoard(0, 3), ENERGY.field).events)).toBe(180);
  });

  it("the TYPE FILTER is read, not ignored: {R} counts 2 of the 5 attached", () => {
    // 3 Water + 2 Fire on the defender's Bench. Unfiltered "Field Scan" sees 5,
    // "{R}"-filtered "Flare Scan" sees 2 — a filter dropped on the floor would make
    // the two identical, which is exactly the mistake worth catching.
    const state = energyBoard(0, 3, 2);
    expect(dealt(swing(state, ENERGY.field).events)).toBe(300);
    expect(dealt(swing(state, ENERGY.flare).events)).toBe(120);
  });

  it("counts CARDS through continuous.ts, not a second opinion (D159)", () => {
    // `countAttachedEnergy` / `countEnergyInPlay` are the engine's answers to "how
    // much Energy is attached" and both arms delegate. Nothing here re-derives
    // provision, so a Special that pays for two units is still ONE card and a
    // wildcard counts toward `{R}` for exactly as long as it does everywhere else.
    const state = energyBoard(1, 1);
    expect(dealt(swing(state, ENERGY.siphon).events)).toBe(20);
    expect(dealt(swing(state, ENERGY.field).events)).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordering — one real witness, and the absences that CANNOT have one.
// ─────────────────────────────────────────────────────────────────────────────

describe("the §8.5 fold order", () => {
  it("⚠️ AN ORDERING WITNESS THAT DOES NOT COMMUTE: `scaled` lands BEFORE Weakness", () => {
    // `fix-benchcount` is a Fire attacker and `fix-pokemon-v-weak` is ×2 Fire, so
    // the two orders are different numbers rather than the same one reached twice:
    //   pre-W/R   (20 + 3×20) × 2 = 160
    //   post-W/R   20 × 2 + 3×20  = 100
    // A subtractive term could never be a witness here (it commutes with the sum),
    // which is why the witness is the MULTIPLIER and not a debuff.
    let state = board("fix-benchcount", "fix-pokemon-v-weak");
    state = withBench(state, "p2", 3);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { events } = swing(state, BENCH.crowd);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(60);
    expect(find(events, "DAMAGE_DEALT")?.weakness).not.toBeNull();
    expect(dealt(events)).toBe(160);
  });

  it("⚠️ PINS THE ABSENCE: the `×` fold has ONE term, so NO ordering witness can exist", () => {
    // Where the multiply fold drops the printed base there is nothing for `scaled`
    // to be ordered against — `dealt` is `per × count` and then W/R, so every board
    // in the universe agrees with every other ordering of a one-term sum. This
    // asserts the ABSENCE (the base really is dropped, at a printed base that is
    // NOT zero) rather than writing a board that passes while claiming nothing.
    let state = board("fix-benchcount", "fix-pokemon-v-weak");
    state = withBench(state, "p2", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const row = find(swing(state, BENCH.flank).events, "DAMAGE_DEALT");
    expect(FIXTURE_POOL["fix-benchcount"]?.attacks?.[BENCH.flank]?.damage).toBe("30×");
    // ⚠️ AND THE ROW SAYS SO IN ITS OWN SHAPE, which is sharper than the arithmetic
    // and was measured rather than assumed: `base` is **0**, not the printed 30 and
    // not the folded 60, and the whole term sits in `scaled`. So the one-term claim
    // is visible in DAMAGE_DEALT itself — there is no second summand anywhere in
    // the row for an ordering to permute.
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(60); // 2 × 30, the WHOLE damage
    expect(row?.dealt).toBe(120); // × 2 Weakness, applied to the one term
  });

  it("⚠️ PINS THE ABSENCE: no sentence here can mutate the resource it counts", () => {
    // Every other member of this family owes "read at DECLARATION" a witness
    // because an attack's own damage can add the counters it scales on. These
    // three cannot: nothing in "Herd Charge", "Crowd Crush", "Flank Rush",
    // "Drain Read", "Siphon Blast", "Field Scan" or "Flare Scan" removes a body
    // from a Bench or an Energy from a Pokémon, and none of them is a
    // multi-sentence printing. So the claim is unobservable and is pinned as an
    // absence rather than dressed up as a passing board.
    for (const sentence of [HERD_CHARGE, CROWD_CRUSH, FLANK_RUSH, DRAIN_READ, FIELD_SCAN]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(sentence.split(". ").length).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rows this family does NOT own — asserted to stay on their existing paths.
// ─────────────────────────────────────────────────────────────────────────────

describe("the EXCLUSIONS — three neighbourhoods that route elsewhere", () => {
  it("the SNIPE scales (3 legal) stay on `damageChosen`, never on this fold", () => {
    // "…damage to 1 of your opponent's Pokémon for each Energy attached to this
    // Pokémon." names a CHOSEN target; the damage is placed by an op, not by the
    // pre-W/R base, and neither scaling reader may answer it.
    for (const per of [20, 30]) {
      const snipe = `This attack does ${per} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackDamageBonus(snipe)).toBeNull();
      expect(deriveAttackDamageMultiplier(snipe)).toBeNull();
      expect(deriveAttackDamagePenalty(snipe)).toBeNull();
    }
  });

  it("the coin family (D128) keeps `AttackFlipCount.attachedEnergy` — no reader took it", () => {
    const flip =
      "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";
    expect(deriveAttackDamageBonus(flip)).toBeNull();
    expect(deriveAttackDamageMultiplier(flip)).toBeNull();
    expect(deriveAttackDamagePenalty(flip)).toBeNull();
  });

  it("the counter-PLACEMENT scales (3 legal) are not a damage clause at all", () => {
    const place =
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";
    expect(deriveAttackDamageBonus(place)).toBeNull();
    expect(deriveAttackDamageMultiplier(place)).toBeNull();
  });

  it("✅ THE ABSENCE WAS CLOSED (D196): the BOTH-ACTIVES zone is built, and its × twin is not", () => {
    // ⚠️ THIS ASSERTION INVERTED IN 0.126.0, ON PURPOSE. D193 pinned this row as
    // "the largest thing this slice measured and did not build", named so the next
    // slice would price it instead of rediscovering it — and D196 did exactly that.
    // "This attack does 30 more damage for each Energy attached to both Active
    // Pokémon." (re-derived against the D1: 10 printings / **8 legal**, still
    // bigger than `bothSidesBenchCount` and `opponentBenchCount` put together) is
    // now `bothActivesEnergyCount`, a THIRD zone that spans the table and so could
    // never have been an `OpponentEnergyZone` value.
    //
    // The pin is kept rather than deleted, flipped to assert the part that is still
    // an ABSENCE: it is ADD-only, and by LEGALITY rather than by absence — the bare
    // twin IS printed (1 printing) and is **0 legal**, so `deriveAttackDamageMultiplier`
    // deliberately has no arm for it and it stays LOUD. That is the opposite answer
    // to `bothSidesBenchCount` two cases up, whose twin is not printed at all.
    const bothActives =
      "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
    expect(deriveAttackDamageBonus(bothActives)).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
    expect(deriveAttackDamageMultiplier(bothActives)).toBeNull();
    const bareTwin = "This attack does 30 damage for each Energy attached to both Active Pokémon.";
    expect(deriveAttackDamageMultiplier(bareTwin)).toBeNull();
    expect(deriveAttackDamageBonus(bareTwin)).toBeNull();
  });
});

describe("the record-shape derivation, made rather than inherited", () => {
  it("⚠️ `MATCH_RECORD_VERSION` STAYS 12 — and here is the derivation, not the habit", () => {
    // D189 moved it 11 → 12 because `PendingStage.attackEpilogue` gained a
    // REQUIRED field, and a parked program lives in `GameState.phase` — so a saved
    // record could carry the old shape. The rule that follows from that is about
    // what is STORED, and this slice stores nothing:
    //
    //   • `DamageCountSource` is a PARSE-TIME type. It is produced by
    //     `deriveAttackDamageBonus` / `deriveAttackDamageMultiplier` from the card
    //     TEXT at declaration and consumed by `scaledAttackDamage` in the same
    //     tick. It appears in no `GameState` field, no `PendingStage`, no
    //     `@luminous/schema` projection and no redaction — swept, and
    //     `scaledAttackDamage`'s switch is the repo's ONLY dispatch over it.
    //   • NO new `EffectOp` inhabitant, which is the case D189 says usually DOES
    //     owe a bump: an op can be parked mid-program inside `GameState.phase`,
    //     and a count source can never be.
    //   • `countEnergyInPlay`'s widened parameter is a REACHABILITY widening —
    //     D181's precedent, and it is a function signature rather than a record
    //     field in any case.
    //
    // A version-12 record replayed against this engine reads every field it
    // carries with the same meaning, so the gate must not reject it.
    expect(deriveAttackDamageBonus(HERD_CHARGE)).not.toBeNull();
    expect(deriveAttackEffect(HERD_CHARGE)).toBeNull(); // no op, so nothing can park
    expect(deriveAttackEffect(FLANK_RUSH)).toBeNull();
    expect(deriveAttackEffect(FIELD_SCAN)).toBeNull();
  });
});

describe("the two RETIRED traps — measured to 0 legal, and not built", () => {
  it("the `extra Metal Energy` CAP mechanism is 0 legal — no cap exists in the engine", () => {
    // 2 printings, 0 legal. The cap ("You can't add more than 120 damage in this
    // way.") is a second sentence AND a second mechanism; it is refused by the
    // anchors alone, which is the correct answer for a sentence nothing legal
    // prints. Asserting it here stops the trap being re-carried by the next slice.
    const capped =
      "This attack does 60 more damage for each extra Metal Energy attached to this Pokémon (in addition to this attack's cost). You can't add more than 120 damage in this way.";
    expect(deriveAttackDamageBonus(capped)).toBeNull();
    expect(deriveAttackDamageMultiplier(capped)).toBeNull();
  });

  it("the SPELLED-OUT energy words are 0 legal — the arms stay, and are not load-bearing", () => {
    // `Water Energy` / `Psychic Energy` / `Grass Energy` are 0 legal; the legal
    // pool is brace notation only. D118's dual-notation map is NOT deleted (it is
    // shared with the clause and coin families and costs this pattern nothing),
    // but nothing in the legal pool exercises it here — which is a fact worth
    // recording rather than a coverage claim worth making.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Psychic Energy attached to all of your opponent's Pokémon.",
      ),
    ).toEqual({
      per: 60,
      count: { kind: "energyOnOpponent", zone: "board", energyType: "Psychic" },
    });
  });
});
