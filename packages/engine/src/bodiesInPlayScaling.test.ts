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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { POKEMON_TYPES } from "./effectTypes";
import type { CardFilter } from "./effectTypes";
import { programFor } from "./index";
import type { GameState, Seat } from "./index";
import { applyAction } from "./index";
import { countOwnerPokemonInPlay, countPokemonInPlay } from "./boardCondition";
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
  activeOf,
  findEvent,
  roundTrip,
} from "./testFixtures";

const ANY_BODIES = "This attack does 20 damage for each of your Pokémon in play.";
const BASIC_BODIES = "This attack does 20 damage for each of your Basic Pokémon in play.";
const TR_BODIES = "This attack does 30 damage for each of your Team Rocket's Pokémon in play.";
const GRASS_BODIES = "This attack does 30 damage for each of your {G} Pokémon in play.";
const EVOLUTION_BODIES =
  "This attack does 40 more damage for each of your Evolution Pokémon in play.";

/** The five, in fixture-attack order. */
const CLAIMED = [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES, EVOLUTION_BODIES] as const;

const ANCIENT_BODIES = "This attack does 30 damage for each of your Ancient Pokémon in play.";
const FUTURE_BODIES = "This attack does 30 damage for each of your Future Pokémon in play.";
const STAGE1_BODIES = "This attack does 40 damage for each of your Stage 1 Pokémon in play.";
const BENCH_STAGE2 = "This attack does 40 more damage for each Stage 2 Pokémon on your Bench.";

const FOE_EX_BODIES = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";
const FOE_EX_V_BODIES =
  "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.";

const DRIFLOON_COMPOUND =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const DRIFLOON_FIRST_SENTENCE =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play.";

const ROUND_BODIES =
  "This attack does 20 damage for each of your Pokémon in play that has the Round attack.";

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

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

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
  return findEvent(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
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

  it("the WHOLE 'for each of your … in play' family, printed whole and classified", () => {
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
    expect(family).toHaveLength(9);
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
        ANCIENT_BODIES,
      ].sort(),
    );
    expect(family.filter((s) => !resolvedByAnyReader(s))).toEqual([]);
    expect(family.filter((s) => resolvedByAnyReader(s))).toContain(ANCIENT_BODIES);
  });

  it("carries fix-inplaybodies's nine printed attacks, `×` and `+` markers included", () => {
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["20×", ANY_BODIES],
      ["20×", BASIC_BODIES],
      ["30×", TR_BODIES],
      ["30×", GRASS_BODIES],
      ["40+", EVOLUTION_BODIES],
      ["20×", ROUND_BODIES],
      ["60×", FOE_EX_BODIES],
      ["60×", FOE_EX_V_BODIES],
      ["40×", STAGE1_BODIES],
    ]);
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

  it("the FOLD is the adjective and nothing else — each sentence reaches ONE reader", () => {
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

  it("the ONE remaining LOUD sentence is refused by the VOCABULARY, not by the anchor", () => {
    for (const text of [FUTURE_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    expect(deriveAttackDamageMultiplier(ANCIENT_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "bannerPokemon", banner: "Ancient" },
      },
    });
    expect(deriveAttackDamageMultiplier(STAGE1_BODIES)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "stagePokemon", stage: "Stage1" },
      },
    });
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

  it("the `(?!opponent)` lookahead keeps the ATTACKER's anchor off the foe's rows", () => {
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
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each of your opponent's Pokémon in play.",
      ),
    ).toEqual({
      per: 60,
      count: { kind: "pokemonInPlay", seat: "opponent", filter: { kind: "anyPokemon" } },
    });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each of your Pokémon ex in play.",
      ),
    ).toEqual({
      per: 60,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    });
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

  it("`IN_PLAY_BODY_MULTIPLY`'s `[^.]+` capture cannot cross a sentence break", () => {
    const IN_PLAY_BODY_MULTIPLY =
      /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) in play\.$/;
    expect(IN_PLAY_BODY_MULTIPLY.test(DRIFLOON_COMPOUND)).toBe(false);
    expect(IN_PLAY_BODY_MULTIPLY.test(DRIFLOON_FIRST_SENTENCE)).toBe(true);
    expect(
      /^This attack does (\d+) damage for each of your ((?!opponent).+) in play\.$/.test(
        `${DRIFLOON_COMPOUND} This attack does 10 damage for each of your Pokémon in play.`,
      ),
    ).toBe(true);
    expect(deriveAttackDamageBonus(DRIFLOON_COMPOUND)).toBeNull();
    // The constructed two-sentence form built out of a noun the map DOES hold —
    // one axis from `GRASS_BODIES`, which is claimed.
    expect(deriveAttackDamageMultiplier(`${GRASS_BODIES} ${GRASS_BODIES}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Pokémon in play. Discard 2 of your Team Rocket's Pokémon in play.",
      ),
    ).toBeNull();
  });

  it("the COMPOUND does not COMPOSE — the REFUSAL KEPT, and the row BUILT anyway", () => {
    expect(splitAttackTrailingClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(splitAttackGateClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(
      deriveAttackEffect("(Don't apply Weakness and Resistance for Benched Pokémon.)"),
    ).toBeNull();
    expect(resolvedByAnyReader(DRIFLOON_COMPOUND)).toBe(true);
  });

  it("the MID-SENTENCE noun rides its OWN anchor — the Round family, and its zone twin", () => {
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
    const round = legalAttackCorpus().filter(([, s]) =>
      s.includes("in play that has the Round attack"),
    );
    expect(round).toHaveLength(3);
    expect(round.reduce((sum, [n]) => sum + n, 0)).toBe(6);
    expect(round.map(([, text]) => deriveAttackDamageMultiplier(text)?.per).sort()).toEqual([
      20, 40, 70,
    ]);
    const unitedWings =
      "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";
    expect(legalAttackCorpus().filter(([, text]) => text === unitedWings)).toHaveLength(1);
    const pile = deriveAttackDamageMultiplier(unitedWings)?.count;
    const play = deriveAttackDamageMultiplier(ROUND_BODIES)?.count;
    expect(pile?.kind).toBe("cardsInDiscardPile");
    expect(play?.kind).toBe("pokemonInPlay");
    expect(pile !== undefined && "filter" in pile ? pile.filter : null).toEqual({
      kind: "attackNamePokemon",
      attack: "United Wings",
    });
    expect(play !== undefined && "filter" in play ? play.filter : null).toEqual({
      kind: "attackNamePokemon",
      attack: "Round",
    });
    // The ADDITIVE reader still refuses both — neither noun is printed with a "more".
    expect(deriveAttackDamageBonus(unitedWings)).toBeNull();
  });

  it("the whole-sentence anchor holds at both ends and on the leading capital", () => {
    expect(
      deriveAttackDamageMultiplier(
        "this attack does 30 damage for each of your {G} Pokémon in play.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your {G} Pokémon in play",
      ),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${GRASS_BODIES}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(`${GRASS_BODIES} Discard an Energy from this Pokémon.`),
    ).toBeNull();
    // A printed 0 does nothing and stays LOUD — the guard every arm in both
    // families carries, and it is a SEPARATE guard from the vocabulary: this string
    // has a noun the map holds, so only `per >= 1` can be refusing it.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 0 damage for each of your {G} Pokémon in play.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each of your Evolution Pokémon in play.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 70 damage for each of your {G} Pokémon in play.",
      ),
    ).toEqual({
      per: 70,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
  });

  it("the SAME anchor discipline on both new anchors — a `$` each, driven", () => {
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
      expect(
        deriveAttackDamageMultiplier(head.replace(/does \d+ damage/, "does 0 damage")),
      ).toBeNull();
    }
  });

  it("the vocabulary's three branches are PAIRWISE DISJOINT, over the whole of it", () => {
    const OWNER_SHAPE = /['\u2019]s Pokémon$/;
    for (const type of POKEMON_TYPES) {
      // No Pokémon type name ends in a possessive, in EITHER notation…
      expect(OWNER_SHAPE.test(`${type} Pokémon`)).toBe(false);
      // …and every one of them really does reach the typed reading, which is what
      // stops this being a vacuous assertion about strings nobody parses.
      expect(
        deriveAttackDamageMultiplier(
          `This attack does 10 damage for each of your ${type} Pokémon in play.`,
        ),
      ).toEqual({
        per: 10,
        count: {
          kind: "pokemonInPlay",
          seat: "you",
          filter: { kind: "typedPokemon", pokemonType: type },
        },
      });
    }
    // …and the three EXACT nouns carry no apostrophe either, so they cannot reach
    // the owner branch on any ordering.
    for (const noun of ["Pokémon", "Basic Pokémon", "Evolution Pokémon"]) {
      expect(OWNER_SHAPE.test(noun)).toBe(false);
    }
    expect(deriveAttackDamageMultiplier(TR_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "ownerPokemon", owner: "Team Rocket" },
      },
    });
    // The owner is CAPTURED, not listed — a second prefix is admitted the day it is
    // ingested and this file never learns a card name. Constructed, and labelled so.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Ethan's Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "ownerPokemon", owner: "Ethan" },
      },
    });
    // …and the SPELLED-OUT type notation resolves through the same shared map, so a
    // token meaning Grass in one clause of this file means Grass in every other.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Grass Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
  });

  it("the BENCHED twin is a DIFFERENT sentence with a DIFFERENT member", () => {
    expect(deriveAttackDamageMultiplier(BENCHED_BODIES)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("the sentences are claimed by EXACTLY the two readers named, and refused by the rest", () => {
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
    for (const text of [FOE_EX_BODIES, FOE_EX_V_BODIES, ROUND_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    expect(deriveAttackDamageMultiplier(STAGE1_BODIES)).not.toBeNull();
    expect(deriveAttackDamageBonus(STAGE1_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(STAGE1_BODIES)).toBeNull();
    expect(resolvedByAnyReader(STAGE1_BODIES)).toBe(true);
    expect(deriveAttackDamageMultiplier(FUTURE_BODIES)).toBeNull();
    expect(deriveAttackDamageBonus(FUTURE_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(FUTURE_BODIES)).toBeNull();
    expect(resolvedByAnyReader(FUTURE_BODIES)).toBe(false);
    expect(deriveAttackDamageMultiplier(ANCIENT_BODIES)).not.toBeNull();
    expect(deriveAttackDamageBonus(ANCIENT_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(ANCIENT_BODIES)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real board: the zone, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countPokemonInPlay`: Active + Bench, seat-relative, filtered", () => {
  it("the canonical board answers 6 / 2 / 4 / 3 / 1 on the attacker's side", () => {
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([6, 2, 1, 3, 4]);
  });

  it("and 5 / 3 / 2 / 1 / 2 on the defender's — every one of the five moves", () => {
    // The seat rung. No pair of these lists shares a value at the same index, so a
    // build reading the wrong board is wrong on ALL FIVE rather than on one.
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([5, 3, 2, 1, 2]);
  });

  it("'in play' is ACTIVE + BENCH — the Active contributes, and is FILTERED", () => {
    const state = canonical();
    const benchOnly = (f: CardFilter) =>
      state.players.p1.bench.filter(
        (b) =>
          countPokemonInPlay(
            {
              ...state,
              players: { ...state.players, p1: { ...state.players.p1, active: b, bench: [] } },
            },
            "p1",
            f,
          ) === 1,
      ).length;
    expect(FILTERS.map(benchOnly)).toEqual([5, 2, 0, 3, 3]);
    //   • so the Active's own contribution, filter by filter, is the difference:
    const BENCH_ONLY = [5, 2, 0, 3, 3] as const;
    expect(
      FILTERS.map((f, i) => countPokemonInPlay(state, "p1", f) - (BENCH_ONLY[i] ?? -1)),
    ).toEqual([1, 0, 1, 0, 1]);
  });

  it("the NULL-ACTIVE board answers with the Bench and does not throw", () => {
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

  it("the GENERALISED walk and D242's adapter cannot disagree", () => {
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
  it("the canonical board deals 120 / 40 / 30 / 90 / 200", () => {
    const state = canonical();
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("the MULTIPLY fold DROPS the printed base and the ADDITIVE one KEEPS it", () => {
    const state = canonical();
    const rows = [0, 1, 2, 3, 4].map((i) => findEvent(swing(state, i).events, "DAMAGE_DEALT"));
    expect(rows.map((r) => r?.base)).toEqual([0, 0, 0, 0, 40]);
    expect(rows.map((r) => r?.scaled)).toEqual([120, 40, 30, 90, 160]);
  });

  it("the ACTIVE ALONE still scores — the Bench-only build reads ZERO here", () => {
    // ⑴'s killing board: the attacker's Bench is empty, so the only countable body
    // is the one in the Active Spot. Three of the five filters match it, and a walk
    // that skipped the Active deals NO DAMAGE AT ALL on those three.
    const state = bare();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([1, 0, 1, 0, 1]);
    expect(dealt(state, 0)).toBe(20);
    expect(dealt(state, 2)).toBe(30);
    expect(dealt(state, 4)).toBe(80);
    // …and the two it does NOT match are the printed floor, below.
    expect(findEvent(swing(state, 1).events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(swing(state, 3).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("the BENCH ALONE still scores — the count is not the Active's alone either", () => {
    const state = canonical();
    expect(dealt(state, 1)).toBe(40);
    expect(dealt(state, 3)).toBe(90);
  });

  it("THE PRINTED FLOOR — a board matching NOTHING files no DAMAGE_DEALT at all", () => {
    const state = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(countPokemonInPlay(state, "p1", { kind: "typedPokemon", pokemonType: "Grass" })).toBe(0);
    const after = swing(state, 3);
    expect(findEvent(after.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(activeOf(after.state, "p2").damage).toBe(0);
    expect(findEvent(after.events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("the ADDITIVE fold KEEPS its base — and its zero is UNREACHABLE, stated", () => {
    const state = bare();
    expect(countPokemonInPlay(state, "p1", { kind: "evolutionPokemon" })).toBe(1);
    expect(dealt(state, 4)).toBe(80);
    const row = findEvent(swing(state, 4).events, "DAMAGE_DEALT");
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
    const floor = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(swing(floor, 3).events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(
      0,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the same five numbers from the other chair", () => {
  it("p2 attacking reads p2's board, and it is a DIFFERENT board", () => {
    // The seat rung driven through `attack()` rather than through the helper: the
    // canonical shapes are mirrored, so p2 swinging reads 6 / 2 / 4 / 3 / 1 off its
    // own side while p1's side holds 5 / 3 / 2 / 1 / 2.
    const state = canonical("p2");
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([6, 2, 1, 3, 4]);
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([5, 3, 2, 1, 2]);
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i, "p2"))).toEqual([120, 40, 30, 90, 200]);
  });
});

describe("§6 — `MATCH_RECORD_VERSION` STAYS 29, driven at all THREE addresses", () => {
  it("DIRECTION 1 — a v29 record round-trips and STILL scores all five counts", () => {
    const record = roundTrip(canonical());
    expect([0, 1, 2, 3, 4].map((i) => dealt(record, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    const before = canonical();
    const after = swing(before, 0).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("pokemonInPlay");
    expect(wire).not.toContain("yourPokemonInPlay");
    expect(wire).not.toContain("anyPokemon");
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

  it("DIRECTION 3 — the `CardFilter` WIDENING, over the bytes, at its own address", () => {
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
      pokemonNameContaining: { kind: "pokemonNameContaining", fragment: "Weezing" },
      suffixPokemon: { kind: "suffixPokemon", suffix: "ex" },
      megaEvolutionEx: { kind: "megaEvolutionEx" },
      bannerPokemon: { kind: "bannerPokemon", banner: "Tera" },
      bannerCard: { kind: "bannerCard", banner: "Ancient" },
      toolCard: { kind: "toolCard" },
      basicEnergy: { kind: "basicEnergy" },
      byName: { kind: "byName", name: "Fixmon ex" },
      supporter: { kind: "supporter" },
      supporterNameContaining: { kind: "supporterNameContaining", fragment: "Team Rocket" },
      toolNameContaining: { kind: "toolNameContaining", fragment: "Technical Machine" },
      itemNameContaining: { kind: "itemNameContaining", fragment: "Antique" },
      item: { kind: "item" },
      stadium: { kind: "stadium" },
      trainerCard: { kind: "trainerCard" },
      anyCard: { kind: "anyCard" },
      pokemonOrBasicEnergy: { kind: "pokemonOrBasicEnergy" },
      anyEnergy: { kind: "anyEnergy" },
      specialEnergy: { kind: "specialEnergy" },
      providesEnergy: { kind: "providesEnergy", energyType: "Grass" },
      pokemonWithResistance: { kind: "pokemonWithResistance", type: "Fighting" },
    };
    expect(Object.keys(EVERY_KIND)).toHaveLength(30);
    const CAST = [
      "fix-attacker-ex",
      "fix-roundbody",
      "fix-benchfiller",
      "fix-item",
      "fix-energy",
      "fix-stage2body",
      "fix-trsupporter",
      "fix-galarweezing",
      // …and the ITEM that carries the SAME fragment, which is the ONLY card in this
      // pool on which the member's category conjunct is observable at all: the one
      // producer walks bodies IN PLAY, and every one of those is already a Pokémon.
      "fix-weezingcanister",
    ];
    for (const [kind, filter] of Object.entries(EVERY_KIND)) {
      const readBack = roundTrip(filter);
      expect(readBack).toEqual(filter);
      for (const id of CAST) {
        expect([kind, id, matchesFilter(FIXTURE_POOL[id], readBack)]).toEqual([
          kind,
          id,
          matchesFilter(FIXTURE_POOL[id], filter),
        ]);
      }
    }
    const answers = Object.values(EVERY_KIND).map(
      (f) => CAST.filter((id) => matchesFilter(FIXTURE_POOL[id], f)).length,
    );
    expect(new Set(answers).size).toBeGreaterThan(1);
    expect(matchesFilter(FIXTURE_POOL["fix-attacker-ex"], EVERY_KIND.suffixPokemon)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-roundbody"], EVERY_KIND.suffixPokemon)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-roundbody"], EVERY_KIND.attackNamePokemon)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-attacker-ex"], EVERY_KIND.attackNamePokemon)).toBe(
      false,
    );
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
    expect(matchesFilter(FIXTURE_POOL["fix-trsupporter"], EVERY_KIND.supporterNameContaining)).toBe(
      true,
    );
    expect(
      matchesFilter(FIXTURE_POOL["fix-trtransceiver"], EVERY_KIND.supporterNameContaining),
    ).toBe(false);
    expect(
      matchesFilter(FIXTURE_POOL["fix-ethansadventure"], EVERY_KIND.supporterNameContaining),
    ).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-roundbody"], EVERY_KIND.supporterNameContaining)).toBe(
      false,
    );
    // …and the NEIGHBOURS it must not be, on the same three cards in the same run:
    // `supporter` admits the Supporter this member refuses, and `byName` — the EXACT
    // read — refuses the very card this member's fragment was taken from.
    expect(matchesFilter(FIXTURE_POOL["fix-ethansadventure"], EVERY_KIND.supporter)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-trtransceiver"], EVERY_KIND.item)).toBe(true);
    expect(
      matchesFilter(FIXTURE_POOL["fix-trsupporter"], { kind: "byName", name: "Team Rocket" }),
    ).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-galarweezing"], EVERY_KIND.pokemonNameContaining)).toBe(
      true,
    );
    expect(
      matchesFilter(FIXTURE_POOL["fix-weezingcanister"], EVERY_KIND.pokemonNameContaining),
    ).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-benchfiller"], EVERY_KIND.pokemonNameContaining)).toBe(
      false,
    );
    expect(matchesFilter(FIXTURE_POOL["fix-darkkoffing"], EVERY_KIND.pokemonNameContaining)).toBe(
      false,
    );
    expect(FIXTURE_POOL["fix-galarweezing"]?.name.startsWith("Weezing")).toBe(false);
    expect(FIXTURE_POOL["fix-galarweezing"]?.name.includes("Weezing")).toBe(true);
    expect(
      matchesFilter(FIXTURE_POOL["fix-galarweezing"], { kind: "byName", name: "Weezing" }),
    ).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-weezingcanister"], EVERY_KIND.item)).toBe(true);
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

  it("the OPPONENT-SIDE reading is a `seat` FIELD — D439's falsifier, FIRED", () => {
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
    const kinds = new Set<string>(
      legalAttackCorpus()
        .map(([, text]) => deriveAttackDamageMultiplier(text)?.count.kind as string | undefined)
        .filter((k): k is string => k !== undefined),
    );
    expect(kinds.has("pokemonInPlay")).toBe(true);
    expect(kinds.has("opponentPokemonInPlay")).toBe(false);
    expect(kinds.has("yourPokemonInPlay")).toBe(false);
  });
});

describe("§7 — `attackNamePokemon` and `suffixPokemon`: the predicate, the zone, the seat", () => {
  it("`attackNamePokemon` reads the NAME — 3 attacker bodies, 1 defender body", () => {
    const state = roundBoard();
    const round: CardFilter = { kind: "attackNamePokemon", attack: "Round" };
    expect(countPokemonInPlay(state, "p1", round)).toBe(3);
    expect(countPokemonInPlay(state, "p2", round)).toBe(1);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" })).toBe(5);
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Bite" })).toBe(1);
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Rounds" })).toBe(
      0,
    );
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "round" })).toBe(0);
    expect(countPokemonInPlay(state, "p1", { kind: "attackNamePokemon", attack: "Roun" })).toBe(0);
  });

  it("`suffixPokemon` is an EQUALITY — the VMAX is a rule box and is NOT counted", () => {
    const state = ruleBoxBoard();
    const ex: CardFilter = { kind: "suffixPokemon", suffix: "ex" };
    const v: CardFilter = { kind: "suffixPokemon", suffix: "V" };
    const pair: CardFilter = { kind: "anyOf", filters: [ex, v] };
    expect(countPokemonInPlay(state, "p2", ex)).toBe(2);
    expect(countPokemonInPlay(state, "p2", v)).toBe(1);
    expect(countPokemonInPlay(state, "p2", pair)).toBe(3);
    expect(countPokemonInPlay(state, "p2", { kind: "suffixPokemon", suffix: "VMAX" })).toBe(1);
    expect(countPokemonInPlay(state, "p2", { kind: "anyPokemon" })).toBe(6);
    // …and the attacker's side answers 1 for all three, which is what makes the seat
    // the only thing separating this member's two printed sentences from a build
    // that reads the wrong board.
    expect([ex, v, pair].map((f) => countPokemonInPlay(state, "p1", f))).toEqual([1, 0, 1]);
  });

  it("the FOLD: three attacks, three numbers, on the boards that separate them", () => {
    // Attack 5 is Round (20×), 6 is the bare ex (60×), 7 is the ex-and-V pair (60×).
    expect(dealt(roundBoard(), 5)).toBe(60);
    expect(dealt(ruleBoxBoard(), 6)).toBe(120);
    expect(dealt(ruleBoxBoard(), 7)).toBe(180);
    const rb = ruleBoxBoard();
    expect(countPokemonInPlay(rb, "p1", { kind: "suffixPokemon", suffix: "ex" }) * 60).toBe(60);
    expect(
      countPokemonInPlay(roundBoard(), "p2", { kind: "attackNamePokemon", attack: "Round" }) * 20,
    ).toBe(20);
  });

  it("the same three numbers from the other chair", () => {
    expect(dealt(roundBoard("p2"), 5, "p2")).toBe(60);
    expect(dealt(ruleBoxBoard("p2"), 6, "p2")).toBe(120);
    expect(dealt(ruleBoxBoard("p2"), 7, "p2")).toBe(180);
  });

  it("`retrieveNoun`: `attackNamePokemon` is still unrenderable, `suffixPokemon` is NOT", () => {
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    const wire = JSON.stringify(ops);
    expect(wire).not.toContain("attackNamePokemon");
    const suffixCarriers = legalAttackCorpus().filter(([, text]) =>
      JSON.stringify(deriveAttackEffect(text) ?? []).includes("suffixPokemon"),
    );
    expect(suffixCarriers).toHaveLength(4);
    expect(suffixCarriers.reduce((n, [units]) => n + units, 0)).toBe(6);
    expect(wire).toContain("suffixPokemon");
    expect(ops.length).toBeGreaterThan(0);
    expect(wire).toContain("kind");
  });
});

describe("§8 — `stagePokemon`: the printed ordinal, at two zones and two folds", () => {
  it("both rows are REAL corpus rows at their measured printing counts", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(STAGE1_BODIES)).toBe(1);
    expect(rows.get(BENCH_STAGE2)).toBe(2);
    expect([2, (rows.get(STAGE1_BODIES) ?? 0) + (rows.get(BENCH_STAGE2) ?? 0)]).toEqual([2, 3]);
  });

  it("the WHOLE printed `Stage` vocabulary of the column, enumerated, not counted", () => {
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
    expect(legalAttackCorpus().some(([, s]) => /VSTAR Pokémon|VMAX Pokémon/.test(s))).toBe(false);
  });

  it("the two sentences derive to the two values, and each is ONE axis from a refusal", () => {
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
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 40 damage for each of your Stage 2 Pokémon in play.",
      ),
    ).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "stagePokemon", stage: "Stage2" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 40 more damage for each Stage 1 Pokémon on your Bench.",
      ),
    ).toEqual({
      per: 40,
      count: { kind: "yourBenchCount", filter: { kind: "stagePokemon", stage: "Stage1" } },
    });
    const unfiltered = deriveAttackDamageBonus(
      "This attack does 20 more damage for each of your Benched Pokémon.",
    );
    expect(unfiltered).toEqual({ per: 20, count: { kind: "yourBenchCount" } });
    expect(JSON.stringify(unfiltered)).toBe('{"per":20,"count":{"kind":"yourBenchCount"}}');
    expect(Object.hasOwn((unfiltered as { count: object }).count, "filter")).toBe(false);
  });

  it("the VOCABULARY refuses on the BENCH anchor exactly as it does on the `in play` one", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 40 more damage for each Future Pokémon on your Bench.",
      ),
    ).toBeNull();
    // …the printed ZERO, which is a SEPARATE guard from the vocabulary: the noun here
    // is one the map holds, so only `per >= 1` can be doing the refusing.
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each Stage 2 Pokémon on your Bench.",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(BENCH_STAGE2.replace("This", "this"))).toBeNull();
    // …the trailing PERIOD.
    expect(deriveAttackDamageBonus(BENCH_STAGE2.slice(0, -1))).toBeNull();
    // …a LEADING clause, which the `^` refuses.
    expect(deriveAttackDamageBonus(`Flip a coin. ${BENCH_STAGE2}`)).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 40 more damage for each Basic Pokémon on your Bench.",
      ),
    ).toEqual({ per: 40, count: { kind: "yourBenchCount", filter: { kind: "basicPokemon" } } });
  });

  it("the new anchor claims exactly ONE corpus row, and no shipped anchor loses one", () => {
    const hits = legalAttackCorpus().filter(([, s]) => / on your Bench\.$/.test(s));
    expect(hits.map(([, s]) => s)).toEqual([BENCH_STAGE2]);
    // …and the five shipped Bench sentences still land on their own members, unfiltered.
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
      ),
    ).toEqual({ per: 20, count: { kind: "bothSidesBenchCount" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your opponent's Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "opponentBenchCount" } });
    expect(
      deriveAttackDamageMultiplier("This attack does 20 damage for each of your Benched Pokémon."),
    ).toEqual({ per: 20, count: { kind: "yourBenchCount" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnYourBench" } });
    expect(deriveAttackDamageBonus(STAGE1_BODIES)).toBeNull();
    expect(deriveAttackDamageMultiplier(BENCH_STAGE2)).toBeNull();
    expect(resolvedByAnyReader(STAGE1_BODIES)).toBe(true);
    expect(resolvedByAnyReader(BENCH_STAGE2)).toBe(true);
  });

  it("the STAGE-1 board answers 4 in play, and every wrong build reads another number", () => {
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
    expect(
      state.players.p1.bench.filter((p) => matchesFilter(topCardOf(state, p), S1)),
    ).toHaveLength(3);
  });

  it("the STAGE-1 fold: 160 dealt, and the printed base is DROPPED", () => {
    // `40×` — the multiply marker. 4 × 40 = 160, and a build that kept the printed base
    // would deal 200 here — which is `evolutionPokemon`'s wrong answer times forty, so
    // the two are told apart by §8's count rung above and not by this number alone.
    expect(dealt(stage1Board(), 8)).toBe(160);
    expect(dealt(stage1Board("p2"), 8, "p2")).toBe(160);
  });

  it("the STAGE-2 board answers 1 on the BENCH and 2 in play — the zone, exposed", () => {
    const state = stage2Board();
    const S2: CardFilter = { kind: "stagePokemon", stage: "Stage2" };
    const benchS2 = state.players.p1.bench.filter((p) => matchesFilter(topCardOf(state, p), S2));
    expect(benchS2).toHaveLength(1);
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

  it("the STAGE-2 fold: 80 dealt, the printed base KEPT, and the seat control is a ZERO", () => {
    // `40+` — the additive marker. 40 + 1 × 40 = 80. An "in play" walk deals 120, an
    // unfiltered Bench count deals 240, the Stage 1 reading deals 160 and the Evolution
    // reading deals 200 — five wrong numbers, none of them 80.
    expect(dealt(stage2Board(), 0)).toBe(80);
    expect(dealt(stage2Board("p2"), 0, "p2")).toBe(80);
  });

  it("no ATTACK_EFFECT_SKIPPED is filed for either row, in either direction", () => {
    for (const [state, index, seat] of [
      [stage1Board(), 8, "p1"],
      [stage2Board(), 0, "p1"],
    ] as const) {
      const { events } = mustApply(state, { type: "attack", seat, index });
      expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      expect(findEvent(events, "DAMAGE_DEALT")).toBeDefined();
    }
    expect(resolvedByAnyReader(FUTURE_BODIES)).toBe(false);
  });

  it("`MATCH_RECORD_VERSION` STAYS 29 — the `DamageCountSource` half, three directions", () => {
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    const wire = JSON.stringify(ops);
    expect(wire).not.toContain('"kind":"yourBenchCount"');
    expect(wire).not.toContain("stagePokemon");
    expect(wire).toContain('"max":"yourBenchCount"');
    expect(ops.length).toBeGreaterThan(0);
    const full = deriveAttackDamageBonus(BENCH_STAGE2);
    const wireBytes = JSON.stringify(full, (key, value) => (key === "filter" ? undefined : value));
    expect(wireBytes).toBe('{"per":40,"count":{"kind":"yourBenchCount"}}');
    const lossy = JSON.parse(wireBytes) as { per: number; count: { kind: string } };
    expect(lossy).toEqual({ per: 40, count: { kind: "yourBenchCount" } });
    expect(Object.hasOwn(lossy.count, "filter")).toBe(false);
    const board = stage2Board();
    const S2: CardFilter = { kind: "stagePokemon", stage: "Stage2" };
    expect(
      board.players.p1.bench.filter((p) => matchesFilter(topCardOf(board, p), S2)),
    ).toHaveLength(1);
    expect(board.players.p1.bench).toHaveLength(5);
  });

  it("`retrieveNoun` owes the new member a phrase too, and NO board can render one", () => {
    const ops = legalAttackCorpus().flatMap(([, text]) => deriveAttackEffect(text) ?? []);
    expect(JSON.stringify(ops)).not.toContain("stagePokemon");
  });

  it("the census steps by exactly TWO sentences and THREE printings, attributably", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== STAGE1_BODIES && s !== BENCH_STAGE2);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([2, 3]);
  });
});
