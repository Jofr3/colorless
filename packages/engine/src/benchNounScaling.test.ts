import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import { matchesFilter, topCardOf } from "./cards";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { POKEMON_TYPE_BY_CODE } from "./deriver/vocabulary";
import { POKEMON_TYPES } from "./effectTypes";
import type { CardFilter } from "./effectTypes";
import { applyAction } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
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
  findEvent,
  activeOf,
  roundTrip,
} from "./testFixtures";

const BENCH_F_COUNTERS =
  "This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon.";
const BENCH_CHARJABUG = "This attack does 80 more damage for each of your Benched Charjabug.";

/** The two SHIPPED sentences the two new anchors must not take. */
const BENCH_BARE_COUNTERS =
  "This attack does 20 damage for each damage counter on all of your Benched Pokémon.";
const BENCH_BARE_BODIES_SCALE = "This attack does 20 more damage for each of your Benched Pokémon.";
const BENCH_BARE_BODIES_MULTIPLY = "This attack does 20 damage for each of your Benched Pokémon.";

const CYNTHIA_HEAD =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon.";
const CYNTHIA_TAIL = "This attack's damage isn't affected by Weakness.";
const CYNTHIA_PRINTED = `${CYNTHIA_HEAD} ${CYNTHIA_TAIL}`;

const SEED = 1;
const FIGHTING: CardFilter = { kind: "typedPokemon", pokemonType: "Fighting" };
const CHARJABUG: CardFilter = { kind: "byName", name: "Charjabug" };
const DUSKULL: CardFilter = { kind: "byName", name: "Duskull" };

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(driveSetup(SEED, { p1: BENCH_NOUN_DECK, p2: BENCH_NOUN_DECK }, { first: foe }), {
      type: "endTurn",
      seat: foe,
    }),
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
  return findEvent(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

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
    expect([2, (rows.get(BENCH_F_COUNTERS) ?? 0) + (rows.get(BENCH_CHARJABUG) ?? 0)]).toEqual([
      2, 3,
    ]);
    expect(rows.get(CYNTHIA_PRINTED)).toBe(1);
  });

  it("the WHOLE printed `Benched ⟨token⟩` vocabulary of the column, enumerated", () => {
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
    expect(slot.get("Pokémon.")).toBe(46);
    expect(slot.get("Pokémon.)")).toBe(43);
    expect(slot.get("Charjabug.")).toBe(1);
    expect((slot.get("Pokémon.") ?? 0) + (slot.get("Pokémon.)") ?? 0)).toBe(89);
  });

  it("the fixture carries the two printed sentences BYTE FOR BYTE", () => {
    const card = FIXTURE_POOL["fix-benchnoun"];
    expect(card?.attacks?.map((a) => a.effect)).toEqual([BENCH_F_COUNTERS, BENCH_CHARJABUG]);
    expect(card?.attacks?.map((a) => a.damage)).toEqual(["20×", "80+"]);
    expect(card?.types).toEqual(["Fighting"]);
  });
});

describe("§2 — the two sentences derive the two values, and the field is OPTIONAL", () => {
  it("each printed sentence derives its own filtered member", () => {
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

  it("the FOLD is the adjective and nothing else — each sentence reaches ONE reader", () => {
    expect(deriveAttackDamageBonus(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackDamagePenalty(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackEffect(BENCH_F_COUNTERS)).toBeNull();
    expect(deriveAttackDamageMultiplier(BENCH_CHARJABUG)).toBeNull();
    expect(deriveAttackDamagePenalty(BENCH_CHARJABUG)).toBeNull();
    expect(deriveAttackEffect(BENCH_CHARJABUG)).toBeNull();
    expect(resolvedByAnyReader(BENCH_F_COUNTERS)).toBe(true);
    expect(resolvedByAnyReader(BENCH_CHARJABUG)).toBe(true);
  });

  it("the absence of `filter` is the SHIPPED object, BYTE FOR BYTE", () => {
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
  it("the two new anchors reach the LOUD nouns and the map is what says no", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Future Pokémon.",
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
    expect(deriveAttackDamageMultiplier(BENCH_F_COUNTERS.replace("This", "this"))).toBeNull();
    expect(deriveAttackDamageBonus(BENCH_CHARJABUG.replace("This", "this"))).toBeNull();
    // …and a LEADING clause, which the `^` refuses.
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${BENCH_F_COUNTERS}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${BENCH_CHARJABUG}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Basic Pokémon.",
      ),
    ).toEqual({
      per: 20,
      count: { kind: "damageCountersOnYourBench", filter: { kind: "basicPokemon" } },
    });
    expect(
      deriveAttackDamageBonus("This attack does 80 more damage for each of your Benched Duskull."),
    ).toBeNull();
  });

  it("the OWNER-prefixed Bench noun resolves for free, and it is a CORPUS row", () => {
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
  it("each new anchor claims exactly its own corpus rows, and takes none", () => {
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

  it("all four SHIPPED Bench sentences still land on their own members, unfiltered", () => {
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

  it("the EMPTY CELLS are measured, not assumed (D435)", () => {
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
  it("the vocabulary is 10 exact keys + 11 names + 11 codes = 32, and none is possessive ( D607: 13 + 11 + 11 = 35; D623: 14 + 11 + 11 = 36; D635: 15 + 11 + 11 = 37)", () => {
    const EXACT = [
      "Pokémon",
      "Basic Pokémon",
      "Evolution Pokémon",
      "Pokémon ex",
      "Pokémon ex and Pokémon V",
      "Stage 1 Pokémon",
      "Stage 2 Pokémon",
      "Charjabug",
      "Drifloon and Drifblim",
      "Ancient Pokémon",
      "Beedrill and Beedrill ex",
      "Rattata",
      'Pokémon that has "Tauros" in its name',
      "Pikachu and Pikachu ex",
      'Pokémon that has "Antique" in its name',
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
    expect(EXACT.length + POKEMON_TYPES.length + CODES.length).toBe(37);
  });

  it("the `Charjabug` row is reachable from the OTHER anchors too, and that is DELIBERATE", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each of your Charjabug in play.",
      ),
    ).toEqual({
      per: 10,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "byName", name: "Charjabug" } },
    });
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
  it("seven distinguishable answers on ONE board", () => {
    const state = counterBoard();
    expect(benchCounters(state, "p1", FIGHTING)).toBe(7);
    expect(benchCounters(state, "p1")).toBe(19);
    expect(benchCounters(state, "p1", CHARJABUG)).toBe(6);
    expect(benchBodies(state, "p1", FIGHTING)).toBe(2);
    expect(benchBodies(state, "p1")).toBe(5);
    expect(benchCounters(state, "p2", FIGHTING)).toBe(1);
    expect(activeOf(state, "p1").damage).toBe(90);
    expect(matchesFilter(topCardOf(state, activeOf(state, "p1")), FIGHTING)).toBe(true);
    expect(
      benchCounters(state, "p1", FIGHTING) + Math.floor(activeOf(state, "p1").damage / 10),
    ).toBe(16);
  });
});

describe("§7 — the COUNTER fold: 140, and the printed base is DROPPED", () => {
  it("the swing deals 140", () => {
    // `20×` — the multiply marker: 7 × 20 = 140, and a build that kept the printed
    // base would deal 160.
    expect(dealt(counterBoard(), 0)).toBe(140);
  });

  it("the MIRROR is the same number, which is the seat-relative claim", () => {
    // `counterBoard("p2")` builds the identical board with the seats swapped, so a
    // seat-RELATIVE count answers 140 from either chair and a p1-hard-coded one
    // answers the DEFENDER's 1 × 20 = 20 when p2 swings.
    expect(dealt(counterBoard("p2"), 0, "p2")).toBe(140);
  });
});

describe("§8 — the NAMED board and fold: 2 bodies, 240 dealt", () => {
  it("the counts: 2, and every wrong build reads another number", () => {
    const state = namedBoard();
    expect(benchBodies(state, "p1", CHARJABUG)).toBe(2);
    expect(benchBodies(state, "p1")).toBe(5);
    expect(benchBodies(state, "p1", { kind: "evolutionPokemon" })).toBe(4);
    expect(benchBodies(state, "p1", { kind: "stagePokemon", stage: "Stage1" })).toBe(4);
    expect(benchBodies(state, "p1", DUSKULL)).toBe(1);
    expect(benchBodies(state, "p1", { kind: "basicPokemon" })).toBe(1);
    expect(benchBodies(state, "p2", CHARJABUG)).toBe(1);
    expect(topCardOf(state, state.players.p1.bench[0] as InPlayPokemon)?.name).toBe("Charjabug");
    expect(topCardOf(state, state.players.p1.bench[4] as InPlayPokemon)?.name).toBe("Duskull");
  });

  it("the swing deals 240 — the base is KEPT, because the fold is additive", () => {
    expect(dealt(namedBoard(), 1)).toBe(240);
    expect(dealt(namedBoard("p2"), 1, "p2")).toBe(240);
  });
});

describe("§9 — `MATCH_RECORD_VERSION` STAYS 29, driven in THREE directions", () => {
  it("DIRECTION 1 — a v29 record round-trips and STILL scores both numbers", () => {
    const counters = roundTrip(counterBoard());
    expect(dealt(counters, 0)).toBe(140);
    const named = roundTrip(namedBoard());
    expect(dealt(named, 1)).toBe(240);
  });

  it("DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    const before = counterBoard();
    const wire = JSON.stringify(swing(before, 0).state);
    expect(wire).not.toContain("damageCountersOnYourBench");
    expect(wire).not.toContain("yourBenchCount");
    expect(wire).not.toContain("typedPokemon");
    expect(wire).not.toContain("byName");
    const after = swing(before, 0).state;
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("DIRECTION 3 — the LOSS, and it is TOTAL and harmless", () => {
    const roundTripped = roundTrip(counterBoard());
    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(counterBoard()));
    expect(dealt(roundTripped, 0)).toBe(140);
    expect(JSON.stringify(deriveAttackDamageMultiplier(BENCH_BARE_COUNTERS))).toBe(
      '{"per":20,"count":{"kind":"damageCountersOnYourBench"}}',
    );
    expect(JSON.stringify(deriveAttackDamageBonus(BENCH_BARE_BODIES_SCALE))).toBe(
      '{"per":20,"count":{"kind":"yourBenchCount"}}',
    );
  });
});

describe("§10 — corpus file line 529: BUILT at D493, and what its TWO blockers became", () => {
  it("the printed sentence is now RESOLVED, and by exactly TWO readers", () => {
    expect(deriveAttackDamageMultiplier(CYNTHIA_PRINTED)).toEqual({
      per: 10,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
      },
    });
    expect(deriveAttackDamageSuppression(CYNTHIA_PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(CYNTHIA_PRINTED)).toBe(true);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackDamageMultiplier" || name === "deriveAttackDamageSuppression")
        continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(CYNTHIA_PRINTED) ?? null, name).toBeNull();
    }
  });

  it("…and the COMPOUND's fold is the HEAD's fold, by construction rather than by agreement", () => {
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
    expect(compared).toBe(2);
  });

  it("BLOCKER 1 SURVIVES: `DAMAGE_SUPPRESSION` still has no WEAKNESS-ONLY arm", () => {
    expect(legalAttackCorpus().filter(([, t]) => t === CYNTHIA_TAIL)).toEqual([]);
    expect(deriveAttackDamageSuppression(CYNTHIA_TAIL)).toBeNull();
    expect(
      deriveAttackDamageSuppression("This attack's damage isn't affected by Resistance."),
    ).toEqual({ resistance: true });
    expect(
      deriveAttackDamageSuppression(
        "This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual({ weakness: true, resistance: true });
  });

  it("BLOCKER 2 — RE-POINTED, because this row now passes it for a DIFFERENT reason", () => {
    const poolRider =
      "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
    expect(resolvedByAnyReader(poolRider)).toBe(false);
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your Benched {L} Pokémon.",
      ),
    ).not.toBeNull();
    expect(deriveAttackEffect("This attack's damage isn't affected by Weakness.")).toBeNull();
    expect(splitAttackTrailingClause(poolRider)).toBeNull();
    expect(splitAttackTrailingClause(CYNTHIA_PRINTED)).toBeNull();
    expect(splitAttackGateClause(CYNTHIA_PRINTED)).toBeNull();
    expect(deriveAttackEffect(CYNTHIA_TAIL)).toBeNull();
  });
});
