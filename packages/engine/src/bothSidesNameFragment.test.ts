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
import { applyAction } from "./index";
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

const PRINTED =
  'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).';

const ROUND_TWIN =
  "This attack does 40 damage for each of your Pokémon in play that has the Round attack.";

const KOFFING = "Koffing";
const WEEZING = "Weezing";

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
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the printed delimiters are ASCII U+0022 and the possessive U+0027, MEASURED", () => {
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

  it("the four literals in the anchor each owe a PRINTED-ZERO measurement (D508)", () => {
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

  it("the holder carries the printed sentence verbatim, with the `×` marker", () => {
    const holder = FIXTURE_POOL["fix-inplaynames"];
    expect(holder?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(holder?.attacks?.[0]?.damage).toBe("40×");
    expect(holder?.name.includes(KOFFING)).toBe(false);
    expect(holder?.name.includes(WEEZING)).toBe(false);
  });

  it("the five name fixtures answer FIVE DIFFERENT SUBSETS of the two fragments", () => {
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
  it("the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the VALUE", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 40,
      count: { kind: "bothSidesPokemonInPlay", filter: NAMED },
    });
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
  });

  it("the FOUR shipped in-play anchors all refuse it, and they refuse it for ONE reason", () => {
    expect(PRINTED.includes("for each of your ")).toBe(false);
    expect(PRINTED.includes("for each Pokémon in play")).toBe(true);
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
    expect(deriveAttackDamageMultiplier(ROUND_TWIN)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "attackNamePokemon", attack: "Round" },
      },
    });
  });

  it("no splitter composes on it, before OR after this slice", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
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

  it("each near-miss differs on exactly ONE axis, and each is refused", () => {
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
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("an EMPTY quoted span is refused, on EITHER capture", () => {
    const empty = (first: string, second: string) =>
      `This attack does 40 damage for each Pokémon in play that has "${first}" or "${second}" in its name (both yours and your opponent's).`;
    expect(deriveAttackDamageMultiplier(empty("", WEEZING))).toBeNull();
    expect(deriveAttackDamageMultiplier(empty(KOFFING, ""))).toBeNull();
    expect(deriveAttackDamageMultiplier(empty("", ""))).toBeNull();
    expect(empty(KOFFING, WEEZING)).toBe(PRINTED);
    expect(deriveAttackDamageMultiplier(empty(KOFFING, WEEZING))).not.toBeNull();
  });

  it("the printed `or` is `anyOf` and the two fragments are ORDERED as printed", () => {
    const derived = deriveAttackDamageMultiplier(PRINTED);
    const filter = derived?.count.kind === "bothSidesPokemonInPlay" ? derived.count.filter : null;
    expect(filter).toEqual(NAMED);
    expect(filter?.kind === "anyOf" ? filter.filters.map((f) => JSON.stringify(f)) : []).toEqual([
      JSON.stringify(KOFFING_ONLY),
      JSON.stringify(WEEZING_ONLY),
    ]);
  });

  it("the derived value survives the `MatchRecord` round trip byte for byte", () => {
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

  it("the eight wrong builds read eight OTHER numbers on the SAME board", () => {
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

  it("the ACTIVE SPOT is inside the count, and that is the whole of ⑹", () => {
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

  it("the OTHER seat swings the same 280 — the count is CONTROLLER-SYMMETRIC", () => {
    const mirror = canonical("p2");
    expect(countPokemonInPlay(mirror, "p2", NAMED)).toBe(3);
    expect(countPokemonInPlay(mirror, "p1", NAMED)).toBe(4);
    expect(dealt(mirror, "p2")).toBe(280);
    expect(dealt(canonical(), "p1")).toBe(280);
  });

  it("a board with no fragment anywhere is a LOUD ZERO, and the `×` fold drops the base", () => {
    expect(bothSides(bare(), NAMED)).toBe(0);
    expect(dealt(bare())).toBeUndefined();
    expect(activeOf(swing(bare()).state, "p2").damage).toBe(0);
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

describe("§4 — the census step this slice is", () => {
  it("the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(
      ([, s]) => deriveAttackDamageMultiplier(s)?.count.kind === "bothSidesPokemonInPlay",
    );
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    const byNewFilter = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackDamageMultiplier(s) ?? {}).includes("pokemonNameContaining"),
    );
    expect(byNewFilter.map(([, s]) => s)).toEqual([PRINTED]);
  });

  it("the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503)", () => {
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
    const claims = (s: string) =>
      JSON.stringify(deriveAttackDamageMultiplier(s) ?? {}).includes("bothSidesPokemonInPlay");
    const before = points.filter((s) => resolvedByAnyReader(s) && !claims(s));
    expect(before).toEqual([ROUND_TWIN]);
    expect([before.length, built.length]).toEqual([1, 2]);
    // …and the two built points sit at Hamming distance TWO, so no lattice EDGE joins
    // them and every flipping edge below belongs to exactly one of them.
    expect(
      (6)
        .toString(2)
        .split("")
        .filter((c) => c === "1").length,
    ).toBe(2);

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

  it("`CountSeat` STAYS at two values, and the rung that says so is COMPILE-ENFORCED", () => {
    const SEATS: Record<CountSeat, Seat> = { you: "p1", opponent: "p2" };
    expect(Object.keys(SEATS).sort()).toEqual(["opponent", "you"]);
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
});
