import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, CountSeat } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { countPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  IN_PLAY_NAME_FRAGMENT_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.398.0 → 0.399.0 — 🆕🆕🆕 D512: DAMAGE SCALED BY A COUNT OF BODIES IN PLAY ON
// **BOTH SIDES OF THE TABLE**, NARROWED BY TWO PRINTED NAME FRAGMENTS.
//
//   "This attack does 40 damage for each Pokémon in play that has "Koffing" or
//    "Weezing" in its name (both yours and your opponent's)."
//                                          — 1 sentence / 2 LEGAL printings
//                                            (`censusAttackCorpus.ts` FILE LINE 583)
//
// 🛑 THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST — D510's LESSON — AND THIS
// TIME THEY ALL REFUSE IT AT THE PATTERN. That slice found its row had matched
// `DISCARD_PILE_COUNT_MULTIPLY` since D440 and was blocked one step later, which
// turned "new machine" into "new name". The same check here answers the other way:
// all four in-play anchors require the literal `for each of your `, and this
// sentence's head is SEATLESS (*"for each Pokémon in play"*) with the side named by
// the trailing parenthetical. §2 drives that rather than asserting it.
//
// 🛑 IT NEEDED **TWO** THINGS AND THE RESUME POINT SAID ONE. `:583` was described as
// "half-built — the predicate ships". It was not: D510 built `supporterNameContaining`
// only, and a POKÉMON-headed fragment member did not exist. So this slice pays for a
// `CardFilter` member (`pokemonNameContaining`) AND a `DamageCountSource` member
// (`bothSidesPokemonInPlay`) — the second of which is the FIRST both-sides count in
// this union to carry a `CardFilter` at all.
//
// 🛑 AND IT OVERTURNS A REFUSAL WHOSE STATED FALSIFIER DOES NOT FIRE — WHICH IS THE
// FINDING, NOT THE BUILD. `pileByNameFragment.test.ts` §4 refused `:583` and pinned
// the refusal with *"The day `CountSeat` gains a third member, this rung goes RED"*,
// spelled as `const SEAT_VALUES: readonly CountSeat[] = ["you", "opponent"]` plus a
// `toHaveLength(2)`. **Measured at this head: widening `CountSeat` to three values
// leaves `tsc -b` at exit 0 and that suite at 20 of 20 GREEN.** A `readonly T[]` of
// two literals still typechecks when `T` gains an inhabitant. The rung is REPAIRED
// here — into a `Record<CountSeat, Seat>`, the compile-enforced idiom D446 already
// uses for `CardFilter["kind"]` — and not deleted (D178/D418/D438).
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   §1 the PRINTED POPULATION — one record, two legal printings, the delimiters
//      measured as bytes, and the four absences the anchor's literals owe.
//   §2 the RESOLVER — the sentence is claimed by exactly ONE of thirteen readers, at
//      the VALUE and not merely at a boolean; the four shipped in-play anchors are
//      driven to null against it; each near-miss differs on exactly ONE axis.
//   §3 the BOARD — nine wrong builds, nine different numbers, one board.
//   §4 the CENSUS — the residue step, the lattice both ways, and the version.

/** The printed sentence, byte for byte off `censusAttackCorpus.ts` FILE LINE 583. */
const PRINTED =
  'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).';

/** D446's row — the nearest BUILT point of this sentence's lattice, and the only one
    that built before this slice. It differs from `PRINTED` on TWO axes at once (the
    PREDICATE and the SEAT SCOPE), which is why it is the lattice's warrant rather than
    a near-miss (D427). */
const ROUND_TWIN =
  "This attack does 40 damage for each of your Pokémon in play that has the Round attack.";

const KOFFING = "Koffing";
const WEEZING = "Weezing";

/** The twelve readers this sentence must NOT reach, so §2 can assert a NAMED owner
    plus twelve kept refusals rather than a bare `resolvedByAnyReader` (D438: a
    negative over a disjunction is a claim about every disjunct; its positive
    replacement is a claim about none of them). */
const OTHERS = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
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

const NAMED: CardFilter = {
  kind: "anyOf",
  filters: [
    { kind: "pokemonNameContaining", fragment: KOFFING },
    { kind: "pokemonNameContaining", fragment: WEEZING },
  ],
};
const KOFFING_ONLY: CardFilter = { kind: "pokemonNameContaining", fragment: KOFFING };
const WEEZING_ONLY: CardFilter = { kind: "pokemonNameContaining", fragment: WEEZING };
const ANY_POKEMON: CardFilter = { kind: "anyPokemon" };

/** One seed for the whole suite. Nothing here flips a coin and every body on either
    board is placed by surgery, so a seed table would describe a shuffle rather than a
    rule. */
const SEED = 1;

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

/** Every body IN PLAY on a seat, as CARDS — the population `countPokemonInPlay` walks,
    written out here so the readings `CardFilter` cannot spell (a PREFIX read, and the
    `.every` reading of the printed `or`) are taken over the SAME bodies the arm counts,
    one predicate apart. D508's control shape at this member's address. */
function bodiesOf(state: GameState, seat: Seat) {
  const side = state.players[seat];
  const uids = [
    ...(side.active === null ? [] : [side.active.stack[0] ?? ""]),
    ...side.bench.map((b) => b.stack[0] ?? ""),
  ];
  return uids.map((uid) => FIXTURE_POOL[state.cardIdByUid[uid] ?? ""]);
}

function bothSides(state: GameState, filter: CardFilter): number {
  return countPokemonInPlay(state, "p1", filter) + countPokemonInPlay(state, "p2", filter);
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared, so
    every number this suite reads is a POPULATION the test put there. One {C} is
    attached to pay the one printed cost. **NO BODY ON THIS BOARD CARRIES EITHER
    FRAGMENT** — the holder's name is `battler`'s default and the defending Active is
    `fix-titan` — which is the board §3 drives for the printed zero. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: IN_PLAY_NAME_FRAGMENT_DECK, p2: IN_PLAY_NAME_FRAGMENT_DECK },
        { first: foe },
      ),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-inplaynames");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

/** 🛑 **THE CANONICAL BOARD — NINE WRONG BUILDS, NINE DIFFERENT NUMBERS.**

      attacker IN PLAY (5 bodies)          defender IN PLAY (4 bodies)
        Active fix-inplaynames  —            Active fix-weezingwall   "Weezing"
        Bench  fix-darkkoffing  K            Bench  fix-darkkoffing   K
               fix-galarweezing W                   fix-galarweezing  W
               fix-galarweezing W                   fix-galarweezing  W
               fix-benchfiller  —

    At the printed 40 per body: the print **280**; your side alone 120; the
    defender's side alone 160; both Benches 240; `anyPokemon` 360; `startsWith` 40;
    the `or` read as AND 0; "Koffing" alone 80; "Weezing" alone 200.

    🛑 **THE MATCHING ACTIVE IS ON THE DEFENDER'S SIDE ON PURPOSE.** It is what makes
    the Bench-only build (240) a different number from the print (280) rather than the
    same one, and putting it on the ATTACKER's side would have meant naming the HOLDER
    after a fragment — which retires the zero board for the whole suite. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = benchFromDeck(state, by, "fix-darkkoffing");
  state = benchFromDeck(state, by, "fix-galarweezing");
  state = benchFromDeck(state, by, "fix-galarweezing");
  state = benchFromDeck(state, by, "fix-benchfiller");
  state = setActiveFromDeck(state, foe, "fix-weezingwall");
  state = clearBench(state, foe);
  state = benchFromDeck(state, foe, "fix-darkkoffing");
  state = benchFromDeck(state, foe, "fix-galarweezing");
  return benchFromDeck(state, foe, "fix-galarweezing");
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

function dealt(state: GameState, seat: Seat = "p1"): number | undefined {
  return find(swing(state, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the fixtures", () => {
  it("the column prints it on exactly ONE record, for exactly TWO legal printings", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows.map(([, s]) => s)).toEqual([PRINTED]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // …and the DEPARTURE and the SIZE are asserted separately, so a rung that only
    // checked the total could not tell "the row landed" from "a reader broke".
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 the printed delimiters are ASCII U+0022 and the possessive U+0027, MEASURED", () => {
    // D421's byte / D440's habit: the pattern spells `"` and `['’]`, so the corpus is
    // asked what it actually carries rather than read visually. All three rows that
    // print `… in its name` are checked, not only this one, because the anchor's
    // quote class is shared doctrine across the family.
    const named = legalAttackCorpus().filter(([, s]) => s.includes(" in its name"));
    expect(named).toHaveLength(3);
    for (const [, s] of named) {
      const quoted = [...s].map((_, i) => i).filter((i) => s.codePointAt(i) === 0x22);
      expect([s, quoted.length % 2]).toEqual([s, 0]);
      expect([s, quoted.length]).not.toEqual([s, 0]);
    }
    const row = named.find(([, s]) => s === PRINTED)?.[1] ?? "";
    expect([...row].map((_, i) => i).filter((i) => row.codePointAt(i) === 0x22)).toEqual([
      61, 69, 74, 82,
    ]);
    // the ONE apostrophe, in `opponent's` inside the printed parenthetical.
    const apostrophes = [...row].filter((c) => c === "'" || c === "’");
    expect(apostrophes).toEqual(["'"]);
    // …and `Pokémon` carries the real é, so the pattern's literal must too.
    expect(row.includes("Pokémon")).toBe(true);
  });

  it("🛑 the four literals in the anchor each owe a PRINTED-ZERO measurement (D508)", () => {
    // Every axis of §4's lattice FLIPS, so by D508's reading of a flip table none of
    // them is free to spell — each is a literal that narrows what the pattern claims,
    // and each therefore owes a count of what it excludes. All four are ZERO.
    const corpus = legalAttackCorpus();
    const count = (re: RegExp) => corpus.filter(([, s]) => re.test(s)).length;
    // the FOLD literal (`damage`, not `more damage`), over this exact shape.
    expect(count(/^This attack does \d+ more damage for each Pokémon in play that has "/)).toBe(0);
    // …and over the both-sides in-play noun at ANY width, which is the wider claim.
    expect(count(/more damage for each .* in play.*both yours and your opponent/)).toBe(0);
    // the HEAD-NOUN literal (`Pokémon`, not `Basic Pokémon` / `Evolution Pokémon` / …).
    expect(count(/for each (?:of your )?[A-Z][^.]* Pokémon in play that has /)).toBe(0);
    // the ARITY literal — exactly TWO quoted fragments. A one-fragment form of this
    // shape is printed nowhere, so a list parser would be an arm no sentence drives.
    expect(count(/for each Pokémon in play that has "[^"]+" in its name/)).toBe(0);
    // the SEAT literal — the parenthetical, not an `of your` head.
    expect(count(/for each of your Pokémon in play that has "/)).toBe(0);
  });

  it("🛑 the holder carries the printed sentence verbatim, with the `×` marker", () => {
    const holder = FIXTURE_POOL["fix-inplaynames"];
    expect(holder?.attacks?.[0]?.effect).toBe(PRINTED);
    // the MULTIPLY fold: the printed base is DROPPED, which is what makes a zero count
    // a missing DAMAGE_DEALT row rather than a 40.
    expect(holder?.attacks?.[0]?.damage).toBe("40×");
    // 🛑 …and the holder's own NAME carries NEITHER fragment, which is what keeps the
    // zero board reachable. A holder named after a fragment would count itself on every
    // board the attack can be used from and retire the `×` fold's printed floor.
    expect(holder?.name.includes(KOFFING)).toBe(false);
    expect(holder?.name.includes(WEEZING)).toBe(false);
  });

  it("🛑 the five name fixtures answer FIVE DIFFERENT SUBSETS of the two fragments", () => {
    const subsets = (id: string) => [
      matchesFilter(FIXTURE_POOL[id], KOFFING_ONLY),
      matchesFilter(FIXTURE_POOL[id], WEEZING_ONLY),
      FIXTURE_POOL[id]?.name.startsWith(KOFFING) || FIXTURE_POOL[id]?.name.startsWith(WEEZING),
    ];
    // the PREFIX positive: the only body whose name STARTS with a fragment.
    expect(subsets("fix-weezingwall")).toEqual([false, true, true]);
    // the SAME fragment at a NON-ZERO offset — the `includes`/`startsWith` separator.
    expect(subsets("fix-galarweezing")).toEqual([false, true, false]);
    // the OTHER fragment — what makes the printed `or` an axis.
    expect(subsets("fix-darkkoffing")).toEqual([true, false, false]);
    // NEITHER fragment — the filter control.
    expect(subsets("fix-benchfiller")).toEqual([false, false, false]);
    // an ITEM carrying a fragment — the HEAD-NOUN control, and the only card in the
    // pool on which the member's category conjunct is observable at all.
    expect(matchesFilter(FIXTURE_POOL["fix-weezingcanister"], WEEZING_ONLY)).toBe(false);
    expect(FIXTURE_POOL["fix-weezingcanister"]?.name.includes(WEEZING)).toBe(true);
    expect(FIXTURE_POOL["fix-weezingcanister"]?.category).toBe("Trainer");
    // …and no body carries BOTH, which is what makes the `.every` reading a LOUD zero.
    for (const id of ["fix-weezingwall", "fix-galarweezing", "fix-darkkoffing"]) {
      expect([
        id,
        matchesFilter(FIXTURE_POOL[id], KOFFING_ONLY) &&
          matchesFilter(FIXTURE_POOL[id], WEEZING_ONLY),
      ]).toEqual([id, false]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the resolver, its owner, and the axes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the resolver, its owner, and the live axes", () => {
  it("🛑 the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the VALUE", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 40,
      count: { kind: "bothSidesPokemonInPlay", filter: NAMED },
    });
    // D438: the negative is spelled over every disjunct rather than as one `!resolved`.
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
  });

  it("🛑 the FOUR shipped in-play anchors all refuse it, and they refuse it for ONE reason", () => {
    // D510's lesson, run and reported whichever way it came out: the row is NOT blocked
    // one step past a shipped anchor, it is blocked AT the pattern. Every in-play anchor
    // requires the literal `for each of your `, and this head is SEATLESS.
    expect(PRINTED.includes("for each of your ")).toBe(false);
    expect(PRINTED.includes("for each Pokémon in play")).toBe(true);
    // Driven through the readers rather than by re-spelling the four patterns here — a
    // copy of a regex is a second answer to one question (D159), and the readers are
    // what the census actually consults.
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
    // …and the CONTROL that keeps that null from being vacuous: the same reader answers
    // a value for the sentence one axis away, so the refusal is the SENTENCE's and not
    // the reader's (D424).
    expect(deriveAttackDamageMultiplier(ROUND_TWIN)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "attackNamePokemon", attack: "Round" },
      },
    });
  });

  it("🛑 no splitter composes on it, before OR after this slice", () => {
    // D505's precondition for the lattice below: a splitter dimension can only diverge
    // on a sentence with a leading `If …,` clause or ≥2 depth-0 segments. This sentence
    // has ONE depth-0 segment — the printed parenthetical is INLINE — so both splitters
    // are null and the readers-only and residue-predicate readings coincide.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    // …and BOTH controls, because a splitter that answered null to everything would
    // pass the two lines above without saying anything (D424). Each is a printed row
    // the corresponding splitter actually claims at this head.
    expect(
      splitAttackTrailingClause(
        "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).not.toBeNull();
    expect(
      splitAttackGateClause(
        "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
      ),
    ).not.toBeNull();
  });

  it("🛑 each near-miss differs on exactly ONE axis, and each is refused", () => {
    // D427: a near-miss that differs on two axes proves nothing about either. Five
    // axes, one token each, every one of them a LITERAL in the new pattern.
    const AXES: [string, string][] = [
      ["FOLD", PRINTED.replace("does 40 damage", "does 40 more damage")],
      ["HEAD NOUN", PRINTED.replace("each Pokémon in play", "each Basic Pokémon in play")],
      ["ARITY", PRINTED.replace(' or "Weezing"', "")],
      [
        "SEAT",
        PRINTED.replace("each Pokémon in play", "each of your Pokémon in play").replace(
          " (both yours and your opponent's)",
          "",
        ),
      ],
      ["ZONE", PRINTED.replace(" in play ", " in your discard pile ")],
    ];
    for (const [axis, text] of AXES) {
      expect([axis, text === PRINTED]).toEqual([axis, false]);
      expect([axis, resolvedByAnyReader(text)]).toEqual([axis, false]);
    }
    // …and the printed row itself, so the five nulls above are not a reader that
    // answers null to everything shaped like this (D424).
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 an EMPTY quoted span is refused, on EITHER capture", () => {
    // The member's own stated invariant — *"an EMPTY fragment would match every Pokémon
    // and the producer cannot emit one"* — driven on constructed text rather than left
    // to prose. `String.includes("")` is TRUE for every string, so an admitted empty
    // fragment would silently turn the printed narrowing into a bare `anyPokemon` count.
    //
    // ⚠️ **IT IS GUARDED TWICE AND THE REDUNDANCY IS DECLARED RATHER THAN TRIMMED** (see
    // the arm's own block): the pattern's `([^"]+)` cannot match empty AND the arm tests
    // both captures, so NO single-line mutation can redden this rung. It is an assertion
    // about the invariant, not a tripwire, and it says so.
    const empty = (first: string, second: string) =>
      `This attack does 40 damage for each Pokémon in play that has "${first}" or "${second}" in its name (both yours and your opponent's).`;
    expect(deriveAttackDamageMultiplier(empty("", WEEZING))).toBeNull();
    expect(deriveAttackDamageMultiplier(empty(KOFFING, ""))).toBeNull();
    expect(deriveAttackDamageMultiplier(empty("", ""))).toBeNull();
    // …and the control, so the three nulls are the EMPTINESS and not the template
    // (D424): the same builder at the printed fragments IS the printed sentence.
    expect(empty(KOFFING, WEEZING)).toBe(PRINTED);
    expect(deriveAttackDamageMultiplier(empty(KOFFING, WEEZING))).not.toBeNull();
  });

  it("🛑 the printed `or` is `anyOf` and the two fragments are ORDERED as printed", () => {
    const derived = deriveAttackDamageMultiplier(PRINTED);
    const filter = derived?.count.kind === "bothSidesPokemonInPlay" ? derived.count.filter : null;
    expect(filter).toEqual(NAMED);
    // The ORDER is the print's, left to right — a build that swapped the captures would
    // answer the same number on every board and be invisible at the board, so it is
    // pinned at the value where it IS visible (D509: assert the thing, not a proxy).
    expect(filter?.kind === "anyOf" ? filter.filters.map((f) => JSON.stringify(f)) : []).toEqual([
      JSON.stringify(KOFFING_ONLY),
      JSON.stringify(WEEZING_ONLY),
    ]);
  });

  it("🛑 the derived value survives the `MatchRecord` round trip byte for byte", () => {
    // D442's shape question asked at the VALUE: `DamageCountSource` is a PARSE-TIME
    // type, so this is not a persistence claim — it is the check that the new members
    // are plain data with no class, symbol or function in them, which is what makes
    // D333's "a union that gains an inhabitant is free" true of them.
    const derived = deriveAttackDamageMultiplier(PRINTED);
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the canonical board and the nine separated wrong builds.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the canonical board and the nine separated wrong builds", () => {
  it("the printed swing deals 40 × 7 = 280", () => {
    expect(dealt(canonical())).toBe(280);
  });

  it("🛑 the eight wrong builds read eight OTHER numbers on the SAME board", () => {
    const state = canonical();
    // the print, read through the walk the arm itself performs.
    expect(bothSides(state, NAMED)).toBe(7);
    // ⑴ + ⑵ the SEAT halves. Both are wrong and they are wrong differently: one counts
    // the attacker's board, one the defender's, and the print is their SUM.
    expect(countPokemonInPlay(state, "p1", NAMED)).toBe(3);
    expect(countPokemonInPlay(state, "p2", NAMED)).toBe(4);
    // ⑶ the FILTER dropped: `anyPokemon` over both sides.
    expect(bothSides(state, ANY_POKEMON)).toBe(9);
    // ⑷ + ⑸ ONE DISJUNCT ONLY — what makes the printed `or` an axis rather than a
    // decoration. Neither equals the print and neither equals the other.
    expect(bothSides(state, KOFFING_ONLY)).toBe(2);
    expect(bothSides(state, WEEZING_ONLY)).toBe(5);
    // ⑹ the ZONE narrowed to the two BENCHES — the `benchBodies` walk three `case`s up
    // in `attack.ts`'s own switch, which deliberately skips the Active Spot.
    const benchOnly = (["p1", "p2"] as const)
      .flatMap((seat) => state.players[seat].bench)
      .map((b) => FIXTURE_POOL[state.cardIdByUid[b.stack[0] ?? ""] ?? ""])
      .filter((c) => matchesFilter(c, NAMED)).length;
    expect(benchOnly).toBe(6);
    // ⑺ + ⑻ the two readings `CardFilter` cannot spell, taken over the SAME bodies the
    // arm walks, one predicate apart: a PREFIX read, and the `.every` reading of `or`.
    const cards = [...bodiesOf(state, "p1"), ...bodiesOf(state, "p2")];
    expect(cards).toHaveLength(9);
    expect(
      cards.filter((c) => (c?.name.startsWith(KOFFING) || c?.name.startsWith(WEEZING)) ?? false),
    ).toHaveLength(1);
    expect(
      cards.filter((c) => matchesFilter(c, KOFFING_ONLY) && matchesFilter(c, WEEZING_ONLY)),
    ).toHaveLength(0);
    // NINE DISTINCT counts, asserted as a set so a board edit that collapsed two of
    // them cannot pass by coincidence.
    const counts = [7, 3, 4, 9, 2, 5, 6, 1, 0];
    expect(new Set(counts).size).toBe(counts.length);
    // At 40 per body that is 280 / 120 / 160 / 360 / 80 / 200 / 240 / 40 / —, and only
    // the PRINT is dealt, so the defending Active only has to survive 280.
    expect(FIXTURE_POOL["fix-weezingwall"]?.hp ?? 0).toBeGreaterThan(280);
    expect(activeOf(swing(state).state, "p2").damage).toBe(280);
  });

  it("🛑 the ACTIVE SPOT is inside the count, and that is the whole of ⑹", () => {
    // §4 defines "in play" as the Active PLUS the Bench. The defender's Active carries a
    // fragment, so the in-play walk and the Bench-only walk answer 7 and 6 on ONE board
    // rather than the same number by luck — the mistake `fix-stage2body` exists to
    // expose one zone over.
    const state = canonical();
    expect(matchesFilter(FIXTURE_POOL["fix-weezingwall"], NAMED)).toBe(true);
    expect(activeOf(state, "p2").stack.length).toBeGreaterThan(0);
    expect(countPokemonInPlay(state, "p2", NAMED)).toBe(4);
    expect(
      state.players.p2.bench.filter((b) =>
        matchesFilter(FIXTURE_POOL[state.cardIdByUid[b.stack[0] ?? ""] ?? ""], NAMED),
      ),
    ).toHaveLength(3);
    // …and the ATTACKER's Active is OUTSIDE it, so the two seats are separated by the
    // board and not only by the arithmetic.
    expect(matchesFilter(FIXTURE_POOL["fix-inplaynames"], NAMED)).toBe(false);
  });

  it("🛑 the OTHER seat swings the same 280 — the count is CONTROLLER-SYMMETRIC", () => {
    // A both-sides count is the one member in this family for which the seats are
    // interchangeable BY CONSTRUCTION, so the mirror is a different claim from
    // `cardsInDiscardPile`'s: there, the mirror proves the seat is read off the member;
    // here it proves the SUM does not secretly prefer `p1`. The mirror puts 3 matching
    // bodies on p2 and 4 on p1 — the reverse of the canonical board — so a build that
    // returned only `attackerSeat` deals 120 here and 120 there, and one that returned
    // only `defenderSeat` deals 160 both times; only the SUM deals 280 twice.
    const mirror = canonical("p2");
    expect(countPokemonInPlay(mirror, "p2", NAMED)).toBe(3);
    expect(countPokemonInPlay(mirror, "p1", NAMED)).toBe(4);
    expect(dealt(mirror, "p2")).toBe(280);
    expect(dealt(canonical(), "p1")).toBe(280);
  });

  it("a board with no fragment anywhere is a LOUD ZERO, and the `×` fold drops the base", () => {
    // No DAMAGE_DEALT row at all — the printed floor of a `×` sentence with a zero
    // count, and the rung that says the 280 above came from the COUNT and not from a
    // base. A base-keeping build would deal 40 here and 320 there.
    expect(bothSides(bare(), NAMED)).toBe(0);
    expect(dealt(bare())).toBeUndefined();
    expect(activeOf(swing(bare()).state, "p2").damage).toBe(0);
    // …and the ADMITTED control on the same walk, so the zero is not passing because
    // `countPokemonInPlay` answers zero to everything (D424).
    expect(bothSides(bare(), ANY_POKEMON)).toBe(2);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const after = swing(frozen);
    expect(frozen.players.p1.bench).toHaveLength(4);
    expect(frozen.players.p2.bench).toHaveLength(3);
    expect(after.state.players.p2.bench).toHaveLength(3);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(280);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census step, the lattice, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the census step this slice is", () => {
  it("🛑 the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(
      ([, s]) => deriveAttackDamageMultiplier(s)?.count.kind === "bothSidesPokemonInPlay",
    );
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // …and the whole-corpus delta equals the slice (D439): no OTHER sentence changed
    // its answer, because the only new pattern is whole-sentence anchored on bytes no
    // other row carries.
    const byNewFilter = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackDamageMultiplier(s) ?? {}).includes("pokemonNameContaining"),
    );
    expect(byNewFilter.map(([, s]) => s)).toEqual([PRINTED]);
  });

  it("🛑 the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503)", () => {
    // FOUR binary axes — NOUN × PREDICATE × SEAT × FOLD — and a lattice run in the
    // build's own commit is not the lattice, so the PRE-state is derived by SUBTRACTING
    // what this slice's members claim rather than by remembering it.
    const NOUNS = ["Pokémon", "Basic Pokémon"];
    const PREDS = ['has "Koffing" or "Weezing" in its name', "has the Round attack"];
    const FOLDS = ["", "more "];
    const point = (m: number) => {
      const both = ((m >> 2) & 1) === 0;
      return `This attack does 40 ${FOLDS[(m >> 3) & 1]}damage for each ${both ? "" : "of your "}${NOUNS[m & 1]} in play that ${PREDS[(m >> 1) & 1]}${both ? " (both yours and your opponent's)" : ""}.`;
    };
    const points = Array.from({ length: 16 }, (_, i) => point(i));
    expect(new Set(points).size).toBe(16);
    expect(points[0]).toBe(PRINTED);
    expect(points[6]).toBe(ROUND_TWIN);

    // ⓐ the READERS-ONLY reading.
    const built = points.filter((s) => resolvedByAnyReader(s));
    expect(built.sort()).toEqual([PRINTED, ROUND_TWIN].sort());
    // ⓑ the RESIDUE-PREDICATE reading — `builds()`'s other three arms. Both splitters
    // are null at EVERY point (32 checks) and no point is a REGISTRY sentence, so the
    // two readings are provably identical here rather than identical by luck.
    for (const s of points) {
      expect([s, splitAttackGateClause(s)]).toEqual([s, null]);
      expect([s, splitAttackTrailingClause(s)]).toEqual([s, null]);
    }
    // ⓒ the PRE-state: subtract the points this slice's members claim.
    const claims = (s: string) =>
      JSON.stringify(deriveAttackDamageMultiplier(s) ?? {}).includes("bothSidesPokemonInPlay");
    const before = points.filter((s) => resolvedByAnyReader(s) && !claims(s));
    expect(before).toEqual([ROUND_TWIN]);
    // **ONE of 16 before, TWO of 16 after** — and the new anchor claims exactly ONE
    // point, which is this lattice's SHAPE and the thing that distinguishes it from
    // D510's. There, the shipped anchor pair already varied SEAT and FOLD, so the new
    // NAME claimed four points at once; here every axis is a LITERAL in the pattern, so
    // the claim is a singleton. **The eleventh shape on record.**
    expect([before.length, built.length]).toEqual([1, 2]);
    // …and the two built points sit at Hamming distance TWO, so no lattice EDGE joins
    // them and every flipping edge below belongs to exactly one of them.
    expect(
      (6)
        .toString(2)
        .split("")
        .filter((c) => c === "1").length,
    ).toBe(2);

    // 🛑 THE FLIP TABLE, READ AS A PRICE (D508). Each axis has 8 parallel edges.
    const flips = [0, 1, 2, 3].map((ax) => {
      let n = 0;
      for (let m = 0; m < 16; m++) {
        if ((m >> ax) & 1) continue;
        if (resolvedByAnyReader(point(m)) !== resolvedByAnyReader(point(m | (1 << ax)))) n++;
      }
      return n;
    });
    // ZERO inert axes and ZERO free axes: every axis flips, at 1/8 before and 2/8 after
    // (one edge per built point per axis). So all four literals owe a printed-zero
    // measurement, and §1 pays all four.
    expect(flips).toEqual([2, 2, 2, 2]);
    // …and the measurement those prices buy: the BUILT set and the PRINTED set of this
    // lattice are the SAME two points. The other fourteen are printed ZERO times, so no
    // axis is refusing a sentence the column actually carries.
    const printed = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(points.filter((s) => printed.has(s)).sort()).toEqual([PRINTED, ROUND_TWIN].sort());
    expect(points.filter((s) => printed.has(s))).toEqual(built);
  });

  it("🛑 `CountSeat` STAYS at two values, and the rung that says so is COMPILE-ENFORCED", () => {
    // 🛑 **THIS IS D510's RUNG, REPAIRED RATHER THAN RE-POINTED, BECAUSE IT COULD NOT GO
    // RED.** `pileByNameFragment.test.ts` §4 pinned the refusal of `:583` with
    // `const SEAT_VALUES: readonly CountSeat[] = ["you", "opponent"]` and
    // `toHaveLength(2)`, and claimed *"the day `CountSeat` gains a third member, this
    // rung goes RED"*. It does not: a `readonly T[]` holding two literals still
    // typechecks when `T` gains an inhabitant, and the length is a property of the
    // literal. **Measured at this head — `CountSeat` widened to three values, `tsc -b`
    // exit 0, that suite 20 of 20 GREEN.**
    //
    // A `Record` keyed on the union is the shape that CANNOT compile with a value
    // missing — D446's own idiom for `CardFilter["kind"]`, one file over — so this is
    // the same claim with a falsifier that fires. The day `CountSeat` gains a third
    // value, `tsc -b` fails HERE, before any test runs.
    const SEATS: Record<CountSeat, Seat> = { you: "p1", opponent: "p2" };
    expect(Object.keys(SEATS).sort()).toEqual(["opponent", "you"]);
    // …and the reason the widening is refused rather than merely unneeded: `attack.ts`
    // resolves the seat with a BINARY ternary, so a third value would be read as the
    // OPPONENT with no complaint. A MEMBER is caught by that file's total `switch`
    // (D447) — which is what this slice shipped, and what the two older both-sides
    // counts already were.
    const state = canonical();
    expect(deriveAttackDamageMultiplier(ROUND_TWIN)?.count).toEqual({
      kind: "pokemonInPlay",
      seat: "you",
      filter: { kind: "attackNamePokemon", attack: "Round" },
    });
    expect(countPokemonInPlay(state, "p1", NAMED) + countPokemonInPlay(state, "p2", NAMED)).toBe(
      bothSides(state, NAMED),
    );
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});
