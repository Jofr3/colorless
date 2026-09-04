import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  BENCH_COUNTER_DECK,
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

// 0.114.0 → 0.115.0 — the BENCH-WIDE damage-counter count (P3-M5 long tail,
// D170), the SIXTH `DamageCountSource` and the first one that tallies over a ZONE
// rather than off a single body:
//
//   "This attack does 10 damage for each damage counter on all of your Benched
//    Pokémon."   (Tyranitar swsh10.5-043 "Raging Crash" idx 0, {C}{C}, "10×")
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule), AND THE COUNTS ARE
// MEASUREMENTS. The local D1 (2026-08-03, 978 rows / 6 sets) returns NINETEEN rows
// for `LIKE '%for each damage counter%'` across all three text columns — the whole
// neighbourhood — and exactly ONE of them for `%on all of your Benched%`: this
// card, this attack, this sentence. So the family is 1 printing / 1 sentence and it
// CLOSES here. `FIXTURE_POOL` is a different population that also fields synthetic
// `fix-*` bodies the catalog will never hold; swept for `swsh10.5-043` and for this
// sentence before the slice it returned ZERO rows, so the fixture is authored fresh
// and transcribed off the catalog row.
//
// ⚠️ ONE PRINTING MEANS THE `(\d+)` CAPTURE HAS NO SECOND WITNESS IN THE POOL, AND
// THAT IS SAID RATHER THAN HIDDEN. D121's second-printing warrant is met for this
// FAMILY by its three siblings (self-`more` at 7 printings, self-`less` at 5,
// self-bare at 2, opponent-`more` at 3), not by this member — so the capture is
// driven below on a rewritten amount that is explicitly labelled as constructed
// text, never as a card.
//
// ⚠️ THE PRICE IS FOUR EDITS, NOT TWO, AND THAT WAS RE-DERIVED RATHER THAN
// INHERITED. The remainder list priced this at "one regex + one evaluator arm" and
// was short by the READER ARM in `deriveAttackDamageMultiplier` (a regex with no
// arm is a dead pattern) and by the `DamageCountSource` MEMBER itself — the
// identical omission D168 found on the additive reader one slice earlier. What the
// pricing was right about is that NOTHING ELSE MOVES: `scaledAttackDamage` has
// taken `attackerSeat` since 0.66.0 for the `boardCondition` indicator, so reading
// the attacker's own Bench needed no new argument and no signature change; and it
// is the repo's ONLY exhaustive switch over the union (nothing in log.ts,
// redact.ts, phaseView.ts or `apps/web` dispatches on it), so a sixth member is one
// arm and not six.
//
// ⚠️ AND IT IS A COUNT SOURCE ON AN OLD FOLD — D168's answer, on the other seat.
// This family splits by FOLD (D167: `+` keeps the printed base, `×` drops it, `−`
// keeps it and subtracts). The sentence carries NO adjective, so its fold is the
// `×` one `deriveAttackDamageMultiplier` has performed since 0.35.0 and the only
// thing that varies is WHICH RESOURCE is tallied. D167 was a new fold on an old
// source; D168 a new source on an old (additive) fold; this is a new source on the
// MULTIPLY fold, which is the fourth corner of the same two-by-two.

/** The printed sentence, byte-for-byte off the local D1 row (2026-08-03, 978 rows
    / 6 sets). No apostrophe anywhere in it — the é in `Pokémon` is a real U+00E9.
    */
const RAGING_CRASH =
  "This attack does 10 damage for each damage counter on all of your Benched Pokémon.";
/** The SELF-side bare multiply twin (Drifloon sv01-089, Onix swsh10.5-036 — read
    since D167): the same fold and the same resource off the attacking ACTIVE, and
    the sentence whose only difference is the zone it names. */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
/** The self-side ADDITIVE twin, read since M2 (Paldean Tauros sv02-028). */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
/** The self-side SUBTRACTIVE twin (D163, Skeledirge ex / Cetitan). */
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
/** The OPPONENT-side additive count (D168, Dedenne sv01-095 / Espeon sv03-086) —
    the member this one is most easily confused with, because both were added two
    slices apart and both are "damage counters somewhere that is not the attacking
    Active". */
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
/** Tyranitar's OWN index-1 sentence — a self-SPREAD naming the very same zone on
    the very same card, and UNSIMULATED. Krookodile sv01-117 prints it at 30, so
    the gap is a family absence rather than a one-card omission. */
const EARTHQUAKE =
  "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The near-miss that names the OTHER seat's Bench and counts BODIES rather than
    counters — printed four times in the catalog (Oinkologne ex sv01-158/-234
    "Maddening Scent", Tyranitar sv02-135/-222 "Rout"), and unread. */
const ROUT = "This attack does 30 more damage for each of your opponent's Benched Pokémon.";
/** The "more" and "less" spellings of THIS count source. Printed NOWHERE — the D1
    sweep for `%on all of your Benched%` returns exactly one row and it is the bare
    form — so both are ABSENCES rather than unread printings, and they are pinned
    as such. */
const UNPRINTED_MORE =
  "This attack does 10 more damage for each damage counter on all of your Benched Pokémon.";
const UNPRINTED_LESS =
  "This attack does 10 less damage for each damage counter on all of your Benched Pokémon.";

/** One seed for the whole suite. Nothing this suite declares flips a coin, every
    Active is placed by surgery, and every Benched body is placed and damaged by
    surgery too — so a seed table would describe a shuffle rather than a rule
    (D143's move, D147/D163/D167/D168's inheritance). */
const SEED = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The two printed attacks, with the INDEX and the Energy each cost needs — read
    off the local D1 per printing (D144's rule). */
const ATTACKS = {
  crash: { index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Raging Crash" ({C}{C}, "10×")
  earthquake: {
    index: 1,
    energy: [
      { id: "fix-darkness-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Earthquake" ({D}{D}{C}{C}, 180) — the UNSIMULATED sibling
} as const;

type Which = keyof typeof ATTACKS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both Actives are placed by surgery and BOTH benches are
    cleared to nothing: this family's number is read off the ATTACKER's Bench, so
    every body on it has to be put there deliberately or the count is whatever the
    setup shuffle happened to place. */
function board(defender: string, which: Which = "crash", by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BENCH_COUNTER_DECK, p2: BENCH_COUNTER_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "swsh10.5-043");
  state = clearBench(state, by);
  for (const { id, count } of ATTACKS[which].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** …with one `fix-titan` per entry on the ATTACKER's Bench, carrying that many
    damage counters. `[2, 0, 5]` is three benched bodies at 20 / 0 / 50 damage. */
function withBench(state: GameState, counters: number[], by: Seat = "p1"): GameState {
  let next = state;
  for (const [index, count] of counters.entries()) {
    next = benchFromDeck(next, by, "fix-titan");
    next = setBenchDamage(next, by, index, count * 10);
  }
  return next;
}

/** The whole board in one call: Tyranitar Active, `counters` on the Bench behind
    it, `defender` across the table. */
function benched(
  defender: string,
  counters: number[],
  which: Which = "crash",
  by: Seat = "p1",
): GameState {
  return withBench(board(defender, which, by), counters, by);
}

function swing(state: GameState, which: Which = "crash", seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[which].index });
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: one catalog row, re-queried rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — one fresh fixture, whole", () => {
  it("carries Tyranitar swsh10.5-043's WHOLE printed card", () => {
    expect(FIXTURE_POOL["swsh10.5-043"]).toMatchObject({
      name: "Tyranitar",
      category: "Pokemon",
      stage: "Stage2",
      evolveFrom: "Pupitar",
      hp: 180,
      types: ["Darkness"],
      retreat: 3,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    // The WHOLE list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and so no later slice indexes into a short one. The printed damage
    // marker on index 0 is a trailing "×" — the marker this fold consumes, and the
    // one that tells attack.ts to DROP the printed base.
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless"],
        name: "Raging Crash",
        effect: RAGING_CRASH,
        damage: "10×",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Earthquake",
        effect: EARTHQUAKE,
        damage: 180,
      },
    ]);
    expect(FIXTURE_POOL["swsh10.5-043"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-043"]?.resistances ?? null).toBeNull();
  });

  it("AUTHORS nothing — the printing is read off the TEXT", () => {
    // The deriver is the whole mechanism: no registry row, no `attack` map entry,
    // no passive. A registry-authored program would win over the reader (D8), so
    // this is the claim that says the text path is the one being driven below.
    expect(programFor("swsh10.5-043")).toBeUndefined();
  });

  it("🆕🆕 D425 — index 1 was DECLARED-UNSIMULATED and is SIMULATED now, on the OWN side", () => {
    // 🛑 **THE ADMISSION THIS RUNG CARRIED HAS EXPIRED, AND IT IS RE-POINTED RATHER
    // THAN DELETED (D418's rule).** It read *"'Earthquake' is a self-SPREAD — 20 to
    // each of the attacker's OWN Benched Pokémon — and no regex in effects.ts
    // matches it"*, and carrying the sentence stated the gap out loud instead of
    // hiding it (D169's convention). D425 closed the gap: `SPREAD_EACH_BENCH` reads
    // the printed possessive as a CAPTURE, so this sentence derives to the same op
    // the opponent-side twin does with the side flipped.
    //
    // ⚠️ **AND THE RE-POINTED CLAIM IS STRICTLY STRONGER THAN "IS NULL", WHICH IS
    // THE HALF D418 SAYS TO CHECK.** `toBeNull()` could catch exactly one build (the
    // arm missing). `toEqual({target: "yourBench"})` catches that one AND the build
    // that reads the sentence onto the WRONG SIDE OF THE TABLE — the defect a reader
    // cannot see, since an `opponentBench` answer here derives, interprets, damages
    // a Bench and passes every shipped case. `D425-spread-side-flips` names this
    // file among its killers.
    expect(deriveAttackEffect(EARTHQUAKE)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 20 },
    ]);
    // ⚠️ **THE THREE SCALING READERS STILL REFUSE IT, AND THAT IS THE PART OF THE
    // OLD RUNG THAT WAS NEVER ABOUT D425.** This suite's subject is a `×` fold over
    // damage counters; the sibling names the identical ZONE ("your Bench") in the
    // identical card, so a scaling reader that claimed it would be reading the zone
    // rather than the clause. Unchanged, and unchanged is the point.
    expect(deriveAttackDamageBonus(EARTHQUAKE)).toBeNull();
    expect(deriveAttackDamageMultiplier(EARTHQUAKE)).toBeNull();
    expect(deriveAttackDamagePenalty(EARTHQUAKE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageMultiplier — a sixth count member on the SAME `×` fold", () => {
  it("reads the printed sentence as damageCountersOnYourBench", () => {
    expect(deriveAttackDamageMultiplier(RAGING_CRASH)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench" },
    });
  });

  it("captures the amount rather than hard-coding the one printed 10", () => {
    // ⚠️ CONSTRUCTED TEXT, LABELLED AS SUCH. The family has exactly one printing,
    // so there is no second card to span; this asserts the `(\d+)` is a capture and
    // nothing more, and it is deliberately NOT written as though a 40-per card
    // existed (D146's rule, read from the other side).
    expect(deriveAttackDamageMultiplier(RAGING_CRASH.replace(" 10 ", " 40 "))).toEqual({
      per: 40,
      count: { kind: "damageCountersOnYourBench" },
    });
  });

  it("KEEPS its three older count sources — no arm was stranded", () => {
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
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
  });

  it("⚠️ IS DISJOINT FROM EVERY OTHER `damage counter` PATTERN, IN BOTH DIRECTIONS", () => {
    // The claim the regex's doc block makes, asserted rather than argued. There are
    // now FOUR patterns in effects.ts carrying the words "damage counter"; all are
    // `^…$`-anchored and each ends in a different literal tail (`on this Pokémon.`,
    // `Active Pokémon.`, `on all of your Benched Pokémon.`), so no side needs a
    // negative lookahead. A first-match-wins hazard here would be silent in exactly
    // one direction, which is why BOTH are driven.
    //
    // this sentence must not reach the other readers…
    expect(deriveAttackDamageBonus(RAGING_CRASH)).toBeNull();
    expect(deriveAttackDamagePenalty(RAGING_CRASH)).toBeNull();
    expect(deriveAttackEffect(RAGING_CRASH)).toBeNull();
    // …and their sentences must not reach this member.
    expect(deriveAttackDamageMultiplier(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamageMultiplier(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
    // …and the readers that DO own those sentences still answer them, with the
    // members they always did — the half a shared-tail regex would break invisibly.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageBonus(SECOND_BITE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamagePenalty(BURNING_VOICE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("⚠️ AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    // attack.ts reads the three scaling families in sequence and guards each on its
    // predecessors having declined. That guard stays free only while the regexes
    // are disjoint, and this slice added a FOURTH "damage counter" sentence to the
    // file — so the sweep that proved it for D163/D167/D168 is re-run over the pool
    // as it now stands, with the new fixture in it.
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const text = attack.effect ?? "";
        const answers = [
          deriveAttackDamageBonus(text),
          deriveAttackDamageMultiplier(text),
          deriveAttackDamagePenalty(text),
        ].filter((x) => x !== null).length;
        expect(answers, `${id} ${attack.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 does nothing, so it must
    // stay LOUD rather than claim a simulated sentence that scores nothing.
    expect(deriveAttackDamageMultiplier(RAGING_CRASH.replace(" 10 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      RAGING_CRASH.replace("This", "this"),
      // no trailing period
      RAGING_CRASH.slice(0, -1),
      // leading text
      `Flip a coin. ${RAGING_CRASH}`,
      // trailing text
      `${RAGING_CRASH} Discard an Energy from this Pokémon.`,
      // a lookalike é would fall off the path silently
      RAGING_CRASH.replace("Pokémon", "Pokemon"),
      // the OTHER seat's Bench — printed four times (Oinkologne ex, Tyranitar
      // sv02-135/-222) and counting BODIES rather than counters
      ROUT,
      // this card's OWN index-1 spread, which names the identical zone
      EARTHQUAKE,
      // "all of" dropped: a real re-ingest could not produce it, but a hand-edited
      // fixture could, and the anchor is what refuses it
      RAGING_CRASH.replace("on all of your", "on your"),
    ]) {
      expect(deriveAttackDamageMultiplier(near)).toBeNull();
    }
  });

  it("⚠️ the `more` and `less` spellings of THIS source are ABSENCES, not unread printings", () => {
    // The D1 sweep for `%on all of your Benched%` returns ONE row and it is the bare
    // form, so neither adjectived twin exists anywhere in the pool — unlike the
    // SELF-side multiply twin (Drifloon, Onix), which was real, printed and unread
    // until D167. Pinned so that a slice which adds an arm because "it is one regex
    // away" is told here that it has no printing to serve.
    for (const text of [UNPRINTED_MORE, UNPRINTED_LESS]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamagePenalty(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The census, SWEPT out of the pool rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly ONE fixture attack, and it is the family", () => {
    // D145's move (inherited by every slice since): discover the producers by
    // deriving every attack in the pool, so a second printing added without a case
    // fails HERE.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a CATALOG row with no fixture is invisible to it, and it
    // reads ATTACK text only. The catalog side is crossed only by
    // `catalogManifest.test.ts`.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const scaling = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (scaling?.count.kind === "damageCountersOnYourBench") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    // 🆕🆕 **D467 — A SECOND PRODUCER, AND IT IS THE FILTERED ARM.** `fix-benchnoun`
    // carries `censusAttackCorpus.ts` file line 544 (*"…on all of your Benched {F}
    // Pokémon."*, 2 legal printings) and derives the SAME member with an optional
    // `filter` on it. The sweep is what caught the addition, which is exactly what
    // D145's move is for — a second printing added without a case fails HERE.
    //
    // 🛑 **AND THE ROW ABOVE IS NOW A ZERO-LEGAL SPELLING, MEASURED RATHER THAN
    // ASSUMED.** `BENCH_COUNTER_MULTIPLY`'s bare noun reaches **no printing at all**
    // in `legalAttackCorpus()` at this head — Tyranitar `swsh10.5-043` has rotated
    // out, D367's situation a third time — so this fixture is the only surviving
    // driver of the unfiltered path and the FILTERED arm is the only live one. The
    // anchor and the fixture are both KEPT, on D364's rule: they are keyed on
    // printed text, the reading is still correct, and a reprint restores it free.
    expect(found).toEqual([
      "swsh10.5-043[0] Raging Crash",
      "fix-benchnoun[0] Static Tally",
    ]);
    expect(
      legalAttackCorpus().filter(
        ([, text]) =>
          text ===
          "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual([]);
  });

  it("…and the SELF-side multiply producers are asserted beside them, unmoved", () => {
    // The two members share a READER, so the sharpest thing that can go wrong is one
    // list absorbing the other. A regex that started answering both sentences would
    // collapse these two sweeps into one, and no assertion on a single sentence can
    // see that.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const scaling = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (scaling?.count.kind === "damageCountersOnSelf") found.push(`${id}[${index}]`);
      }
    }
    expect(found.sort()).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold — MULTIPLY, so the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — `per × (counters on YOUR Bench)` is the WHOLE damage", () => {
  it("scores 10 per counter, summed over the WHOLE Bench", () => {
    // 20 / 0 / 50 on three benched bodies is 2 + 0 + 5 = 7 counters → 70. The
    // unequal slots are the point: `bench[0]` alone reads 20, `bench.length × per`
    // reads 30, and only the sum reads 70.
    const { events } = swing(benched("fix-titan", [2, 0, 5]));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 70, dealt: 70 });
  });

  it("⚠️ DROPS THE PRINTED `10×` BASE — the marker is the per-unit, not a floor", () => {
    // The whole difference between this fold and the additive one. A base that
    // leaked would make every number here 10 too high, and would make the ZERO
    // board below deal 10 instead of nothing at all.
    const row = find(swing(benched("fix-titan", [3])).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(0);
    expect(row?.dealt).toBe(30);
    // …and the printed card really does carry a base the fold had to drop.
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks?.[0]?.damage).toBe("10×");
  });

  it("scales LINEARLY, and the oracle is re-derived from the row's own fields", () => {
    // D147's move: re-derive the number the engine reported from the fields the row
    // carries rather than from the constants the test was written with.
    for (const counters of [1, 2, 4, 9]) {
      const row = find(swing(benched("fix-titan", [counters])).events, "DAMAGE_DEALT");
      if (row === undefined) throw new Error("no damage row");
      expect(row.scaled ?? 0, `${counters} counters`).toBe(10 * counters);
      expect(row.dealt, `${counters} counters`).toBe(row.base + (row.scaled ?? 0));
    }
  });

  it("sums a FULL five-slot Bench, and the total can Knock the defender Out", () => {
    // Five bodies at ten counters each is 50 counters → 500, past fix-titan's 340.
    // The `×` fold has no printed ceiling, which is the reason this deck's defender
    // is the largest body in the pool.
    const { state, events } = swing(benched("fix-titan", [10, 10, 10, 10, 10]));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 500, dealt: 500 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });

  it("floors each body's counters BEFORE summing", () => {
    // One counter = 10 HP (§12). Damage always lands in tens on a real board, but
    // the arm floors per body rather than over the sum, so a stray non-multiple
    // cannot round its way into a neighbour's slot: 25 and 25 is 2 + 2 = 4, not
    // 50 / 10 = 5.
    let state = board("fix-titan");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setBenchDamage(state, "p1", 0, 25);
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setBenchDamage(state, "p1", 1, 25);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ scaled: 40, dealt: 40 });
  });

  it("runs identically from the OTHER seat", () => {
    // Nothing in the arm is p1-shaped, and a hard-coded seat would look right on
    // exactly one of these two.
    const { events } = swing(benched("fix-titan", [2, 0, 5], "crash", "p2"), "crash", "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 70, dealt: 70 });
  });

  it("leaves index 1 ALONE — the sibling attack does not inherit the clause", () => {
    // "Earthquake" is a flat printed 180 whose own text the engine does not read. A
    // fold keyed on the CARD rather than on the declared attack's text would add 70
    // to it, or would drop its base to 0.
    const row = find(
      swing(benched("fix-titan", [2, 0, 5], "earthquake"), "earthquake").events,
      "DAMAGE_DEALT",
    );
    expect(row).toMatchObject({ base: 180, dealt: 180 });
    expect(row?.scaled).toBeUndefined();
  });

  it("🆕🆕 D425 — …and index 1 now does its OWN thing, which is the other half of the same claim", () => {
    // 🛑 **THIS RUNG WAS THE SKIPPED-SIBLING WITNESS AND ITS WITNESS IS GONE.** It
    // asserted `ATTACK_EFFECT_SKIPPED` on index 1 while index 0's text stopped being
    // flagged, so that *"the clause was read"* could not quietly mean *"the card was
    // recognised"*. D425 simulates index 1, so no skip is emitted for it any more.
    //
    // ⚠️ **RE-POINTED ONTO A CLAIM THAT STILL SEPARATES THE TWO INDICES, BECAUSE
    // "NO SKIP" ALONE WOULD NOT (D418).** *"Index 1 emits no skip"* is TRUE under a
    // card-keyed fold as well, so on its own it would drop exactly the
    // discrimination the old rung existed for. The pair asserted here cannot both
    // hold under a fold keyed on the CARD: index 1 keeps its FLAT printed 180 with
    // no `scaled` key (a card-keyed `10×` fold would rewrite it), and it puts its
    // own 20 on each of the attacker's THREE benched bodies (index 0 puts none).
    const { events } = swing(benched("fix-titan", [2, 0, 5], "earthquake"), "earthquake");
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const rows = events.filter((e) => e.type === "DAMAGE_DEALT");
    // The main hit on the DEFENDER's Active, flat and unscaled…
    expect(rows[0]).toMatchObject({ seat: "p2", base: 180, dealt: 180 });
    expect((rows[0] as { scaled?: number }).scaled).toBeUndefined();
    // …then one row per body on the ATTACKER's OWN Bench, 20 apiece.
    expect(rows.slice(1).map((r) => [r.seat, (r as { dealt: number }).dealt])).toEqual([
      ["p1", 20],
      ["p1", 20],
      ["p1", 20],
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE ZONE — this is the whole defect surface, so it is driven from every side.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ THE ZONE — YOUR Bench, and nothing else on either board", () => {
  it("a PRISTINE Bench scores 0, and no DAMAGE_DEALT is emitted at all", () => {
    // `scaledBase` and `scaledTotal` are both 0, so attack.ts's
    // `if (scaledBase + scaledTotal > 0)` skips the whole §8.5 pipeline. That is
    // rules-correct — the attack does 0 damage — and it is exactly how D167's
    // printings and Stoutland's retreat-0 board already behave.
    const { state, events } = swing(benched("fix-titan", [0, 0, 0]));
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    // …and the attack was still USED, so the turn passed to the opponent. This is
    // the half an early `return` would break, and the half a player would notice.
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("an EMPTY Bench scores 0 too — the same 0, for a different reason", () => {
    // A zone with nothing in it and a zone with nothing damaged in it are one
    // number here, and the arm reaches that answer by summing an empty list rather
    // than by a guard. Driven because a `bench[0]` implementation THROWS here where
    // it merely under-reads above.
    const state = board("fix-titan");
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: after, events } = swing(state);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("⚠️ COUNTERS ON THE ATTACKER'S OWN ACTIVE DO NOT COUNT", () => {
    // The nearest wrong member: `damageCountersOnSelf` reads the attacking Active
    // and this one must not. Tyranitar carries 90 damage — 9 counters, which would
    // score 90 — and its Bench is pristine.
    const state = setDamage(benched("fix-titan", [0, 0]), "p1", 90);
    const { events } = swing(state);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("⚠️ COUNTERS ON THE OPPONENT'S ACTIVE DO NOT COUNT EITHER", () => {
    // The other nearest wrong member, and the one D168 added two slices ago:
    // `damageCountersOnOpponentActive` reads the DEFENDING Active. It carries 70
    // damage here — 7 counters, 70 damage — and this attack must score nothing.
    const state = setDamage(benched("fix-titan", [0, 0]), "p2", 70);
    const { events } = swing(state);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("⚠️ COUNTERS ON THE OPPONENT'S BENCH DO NOT COUNT — the SEAT is load-bearing", () => {
    // The printed word is "YOUR Benched Pokémon", and the attack that reads it
    // damages the OPPONENT — so the count and the target sit at opposite ends of the
    // same swing, and an arm wired to `defenderSeat` would look correct on every
    // symmetric board. This one is not symmetric: the opponent's Bench carries 8
    // counters and the attacker's carries none.
    let state = benched("fix-titan", []);
    state = withBench(state, [4, 4], "p2");
    expect(find(swing(state).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("⚠️ THE SEPARATING BOARD — all four zones damaged, all four differently", () => {
    // The one case no single-zone assertion above can make, and the reason the
    // numbers are chosen to be pairwise distinguishable:
    //
    //   attacker's Active   9 counters →  90  (damageCountersOnSelf)
    //   attacker's Bench    3 counters →  30  ← the right answer
    //   defender's Active   5 counters →  50  (damageCountersOnOpponentActive)
    //   defender's Bench    7 counters →  70
    //
    // Every wrong zone, every pairwise sum (120 / 140 / 160 / 100 …) and the
    // whole-board total of 240 are distinct from 30 and from each other.
    let state = benched("fix-titan", [1, 2]);
    state = setDamage(state, "p1", 90);
    state = setDamage(state, "p2", 50);
    state = withBench(state, [3, 4], "p2");
    const row = find(swing(state).events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 30 });
    // The defender arrived with 50 damage already on it, so the row's `dealt` is 30
    // and the body ends on 80 — asserted so "30" cannot be read off a total.
    expect(row?.dealt).toBe(30);
  });

  it("…and the SAME board read from p2 gives the SAME 30, with the zones swapped", () => {
    // The mirror of the case above. If the arm read `defenderSeat`, one of these two
    // would score 70 and the other 30, and each on its own would look right.
    let state = benched("fix-titan", [1, 2], "crash", "p2");
    state = setDamage(state, "p2", 90);
    state = setDamage(state, "p1", 50);
    state = withBench(state, [3, 4], "p1");
    expect(find(swing(state, "crash", "p2").events, "DAMAGE_DEALT")).toMatchObject({
      base: 0,
      scaled: 30,
      dealt: 30,
    });
  });

  it("⚠️ READS THE COUNT AT DECLARATION — this attack cannot bootstrap its own bonus", () => {
    // The site every member of the family counts at. The damage this attack deals
    // lands on the DEFENDER, never on the attacker's own Bench, so the two readings
    // could only diverge through an effect that damaged the Bench mid-attack — but
    // the pin belongs here anyway, because the arm's `state` is `next` and a later
    // slice moving the fold after the pipeline would go red on the family that CAN
    // see it. Two swings at the same Bench score the same number.
    const first = swing(benched("fix-titan", [2, 0, 5]));
    expect(find(first.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    expect(first.state.players.p1.bench.map((p) => p.damage)).toEqual([20, 0, 50]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, and the honest limit of what this family can witness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8.5 — the fold happens BEFORE Weakness, and the dropped base is visible THROUGH it", () => {
  it("doubles the folded total, not the printed base", () => {
    // Tyranitar is a DARKNESS Pokémon into fix-darkness-weak (200 HP, ×2 Darkness)
    // at 6 counters:
    //   correct   (0 + 60) × 2 = 120
    //   base kept (10 + 60) × 2 = 140 — the leak, doubled and therefore louder
    // The Weakness is what turns a 10 HP mistake into a 20 HP one, which is the
    // only thing a multiply W/R can add to a single-term fold.
    const { state, events } = swing(benched("fix-darkness-weak", [3, 3]));
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 60, dealt: 120 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(state.players.p2.active?.damage).toBe(120);
  });

  it("⚠️ AND THE ×2 CANNOT WITNESS AN ORDER HERE, WHICH IS SAID RATHER THAN FUDGED", () => {
    // D168's transferable finding, applied in the negative. An ordering claim needs
    // a witness that does NOT COMMUTE — and with the printed base DROPPED this fold
    // has exactly ONE term, so `(0 + 60) × 2` and `0 × 2 + 60 × 2` are the same 120
    // by distribution, not by luck. There is no board in this family that separates
    // the two placements, and the suite says so instead of quietly claiming one.
    //
    // What the ×2 board above DOES witness is the base drop surviving a multiply,
    // which is a different claim and the one that is actually made.
    const scaled = 60;
    expect((0 + scaled) * 2).toBe(0 * 2 + scaled * 2);
    // …whereas the ADDITIVE family's base makes the same board non-commuting, which
    // is why D168 could drive an order and this slice cannot.
    expect((100 + scaled) * 2).not.toBe(100 * 2 + scaled);
  });

  it("a ZERO Bench against the ×2 body still deals nothing at all", () => {
    // The Weakness has nothing to double. A base that leaked would deal 20 here,
    // which is the loudest form the same defect can take.
    const { events } = swing(benched("fix-darkness-weak", [0, 0]));
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the existing `scaled` crumb off a `base 0`, under BOTH seats", () => {
  it("reads `· scaled +70` under the ATTACKER's name", () => {
    // NO NEW ARM: log.ts has rendered `scaled` since 0.35.0 and every member of the
    // `×` fold already reads as the WHOLE damage off a `base 0` (Pecharunt ex,
    // Annihilape, Stoutland, and D167's two). D159's "does the row you need already
    // exist?" check, answered YES for the fourth slice running.
    const { state, events } = swing(benched("fix-titan", [2, 0, 5]));
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 70 damage to fix-titan · scaled +70");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    const { state, events } = swing(benched("fix-titan", [2, 0, 5], "crash", "p2"), "crash", "p2");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 70 damage to fix-titan · scaled +70");
  });

  it("says nothing about damage at all when the Bench is pristine", () => {
    // Loudness is owed to UNREAD text (D140); a fold that scored nothing must not
    // print a crumb saying it did — and here there is no damage ROW to hang one on.
    const { state, events } = swing(benched("fix-titan", [0, 0]));
    expect(rendered(state, events).find((r) => r.text.startsWith("dealt "))).toBeUndefined();
  });

  it("⚠️ AND THE PRINTED TEXT STOPS BEING FLAGGED — on the scoring board AND the 0 one", () => {
    // Before this slice the sentence emitted ATTACK_EFFECT_SKIPPED carrying the whole
    // text AND the "×" damage marker. `scaling !== null` already covered both terms
    // of that guard, so attack.ts's flag logic took zero lines — a claim worth
    // driving, because a sixth count member that did NOT reach `scaling` would leave
    // the printing loudly flagged for text the engine now resolves. The 0 board is
    // the sharper of the two: the clause is SIMULATED even though it scored nothing,
    // which is the distinction D140 draws.
    for (const counters of [[2, 0, 5], [0, 0], []]) {
      const { events } = swing(benched("fix-titan", counters));
      expect(find(events, "ATTACK_EFFECT_SKIPPED"), `${counters}`).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 11", () => {
    // Neither park nor persist, and the answer is DERIVED rather than inherited from
    // D168: `DamageCountSource` is a PARSE-TIME type that lives in effects.ts and
    // never reaches `GameState`, so a new member of it cannot make a previously
    // stored record unreadable — which is exactly why it buys no bump where D165's
    // CHANGED `InPlayPokemon` field did. The reasoning transfers to this slice
    // unchanged because the shape of the change is identical: a union member, a
    // reader arm, an evaluator arm, and no stamp anywhere. Pinned as an ABSENCE
    // (D161's move), the only way a no-bump claim is checkable.
    // (`MATCH_RECORD_VERSION` itself lives in `apps/api/src/lobby/match.ts` and is
    // pinned by `match.test.ts`; the engine cannot import it, so the assertion this
    // side can make is the one that would FORCE the bump.)
    const active = board("fix-titan").players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackLockedTurn",
        "boostedAttack",
        "conditions",
        "damage",
        "damageReduction",
        "energy",
        // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
        // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
        // key, and what it asserts is that none of them was added HERE.
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
        // wrote nothing; the pin is on the HEAD's key set.
        "usedAttack",
      ].sort(),
    );
    // …and the BENCHED bodies this slice reads are the same 20-key shape: the count
    // source reads an EXISTING field off an EXISTING zone and stamps nothing.
    const bench = withBench(board("fix-titan"), [3]).players.p1.bench[0];
    if (bench === undefined) throw new Error("no benched body");
    expect(Object.keys(bench).sort()).toEqual(Object.keys(active).sort());
  });

  it("GATES NO ACTION — the attack is still offered on a board where it deals 0", () => {
    // D163's negative form, and the sharp case: a player would expect a refusal here
    // and must not get one. The clause says nothing about legality or cost, so
    // `redactedAttacksOf` must keep offering it with an empty Bench across the table
    // from a full-health defender.
    const state = board("fix-titan");
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Raging Crash", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
