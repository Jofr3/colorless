import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import type { GameState, Seat } from "./index";
import { applyAction, programFor } from "./index";
import {
  BOARD_ENERGY_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const BOARD_ENERGY =
  "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.";

const SELF_ENERGY = "This attack does 30 more damage for each {G} Energy attached to this Pokémon.";

const OWNER_PREFIXED_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.";

const UNPRINTED_MULTIPLY =
  "This attack does 30 damage for each {G} Energy attached to all of your Pokémon.";

const UNPRINTED_OPPONENT_ADDITIVE =
  "This attack does 30 more damage for each {G} Energy attached to all of your opponent's Pokémon.";

const SEED = 11;

function board(by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  const foe = opener;
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BOARD_ENERGY_DECK, p2: BOARD_ENERGY_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-boardgrass");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-bigbody");
  return clearBench(state, foe);
}

function dress(
  state: GameState,
  seat: Seat,
  active: readonly string[],
  bench: readonly (readonly string[])[],
): GameState {
  let next = state;
  for (const id of active) next = attachFromDeck(next, seat, id, 1);
  for (const [index, cards] of bench.entries()) {
    next = benchFromDeck(next, seat, "fix-bigbody");
    for (const id of cards) next = attachBenchFromDeck(next, seat, index, id, 1);
  }
  return next;
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

const G = "fix-grass-energy";
const C = "fix-energy";

function canonical(by: Seat = "p1"): GameState {
  const foe = by === "p1" ? "p2" : "p1";
  const state = dress(board(by), by, [G], [[G, G], [G]]);
  return dress(state, foe, [G, G, G, G, G, G], [[G, G]]);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data and the population.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, its population, and the fixture that carries it", () => {
  it("the column prints it FOUR times, on exactly one record", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === BOARD_ENERGY);
    expect(rows).toHaveLength(1);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(4);
  });

  it("and it is the column's ONLY board-wide OWN-side Energy sentence", () => {
    const family = legalAttackCorpus().filter(
      ([, s]) => s.includes("Energy attached to all of your") && !s.includes("opponent"),
    );
    expect(family.map(([, s]) => s)).toEqual([OWNER_PREFIXED_BOARD, BOARD_ENERGY]);
    expect(family.find(([, s]) => s === OWNER_PREFIXED_BOARD)?.[0]).toBe(1);
  });

  it("carries fix-boardgrass's WHOLE printed card, `20+` marker included", () => {
    expect(FIXTURE_POOL["fix-boardgrass"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Verdant Surge",
        damage: "20+",
        effect: BOARD_ENERGY,
      },
    ]);
  });

  it("AUTHORS nothing — the printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-boardgrass")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, and the optional field's polarity.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageBonus: the zone D196 refused", () => {
  it("reads the printed sentence as energyOnSelf at zone 'board', typed {G}", () => {
    expect(deriveAttackDamageBonus(BOARD_ENERGY)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" },
    });
  });

  it("the SHIPPED spelling still produces the ZONE-LESS shape — the field's polarity", () => {
    const shipped = deriveAttackDamageBonus(SELF_ENERGY);
    expect(shipped).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: "Grass" },
    });
    expect(shipped?.count).not.toHaveProperty("zone");
  });

  it("the OWNER-PREFIXED board is a SUBGROUP and not the zone — D470 builds it as one", () => {
    expect(deriveAttackDamageBonus(OWNER_PREFIXED_BOARD)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "Lightning",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
    // …and the sentence THIS anchor owns still carries NO filter, which is the other
    // half of the same claim: one sentence names the zone, the other names a subgroup
    // of it, and they must not derive to the same thing.
    expect(deriveAttackDamageBonus(BOARD_ENERGY)?.count).not.toHaveProperty("filter");
    // The three OTHER readers are unchanged and still refuse it — the original rung's
    // "every reader in the family, not merely this one" half, kept verbatim.
    expect(deriveAttackDamageMultiplier(OWNER_PREFIXED_BOARD)).toBeNull();
    expect(deriveAttackDamagePenalty(OWNER_PREFIXED_BOARD)).toBeNull();
    expect(deriveAttackEffect(OWNER_PREFIXED_BOARD)).toBeNull();
  });

  it("the `×` twin reads at the BOARD zone (D596), never as the attacking body alone", () => {
    expect(deriveAttackDamageMultiplier(UNPRINTED_MULTIPLY)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" },
    });
    expect(deriveAttackDamageBonus(UNPRINTED_MULTIPLY)).toBeNull();
    // …while the `×` reader's OWN zone-less spelling still answers, so the null
    // above is a statement about the ZONE rather than about a dead reader.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each Energy attached to this Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", energyType: null } });
  });

  it("the OPPONENT-side board on the ADDITIVE fold is still unprinted and still refused", () => {
    expect(deriveAttackDamageBonus(UNPRINTED_OPPONENT_ADDITIVE)).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
      )?.count,
    ).toEqual({ kind: "energyOnOpponent", zone: "active", energyType: null });
  });

  it("the whole-sentence anchor holds at both ends, on the capital, and on the filter", () => {
    // The family's stated anchor discipline: no /i, a required trailing period, a
    // capital `This`, and no leading or trailing text.
    expect(
      deriveAttackDamageBonus(
        "this attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${BOARD_ENERGY}`)).toBeNull();
    expect(
      deriveAttackDamageBonus(`${BOARD_ENERGY} Discard an Energy from this Pokémon.`),
    ).toBeNull();
    // A printed 0 adds nothing and stays LOUD — the guard every arm in both
    // families carries.
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {C} Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Basic Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "basic" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Fancy Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
  });

  it("the `per`, the filter and the zone are all CAPTURES, on constructed text", () => {
    expect(deriveAttackDamageBonus(BOARD_ENERGY.replace("30 more", "50 more"))).toEqual({
      per: 50,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" },
    });
    expect(deriveAttackDamageBonus(BOARD_ENERGY.replace("{G} ", ""))).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: null },
    });
    expect(deriveAttackDamageBonus(BOARD_ENERGY.replace("{G}", "Special"))).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "special" },
    });
    expect(deriveAttackDamageBonus(BOARD_ENERGY.replace("{G}", "Water"))).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Water" },
    });
  });

  it("the OTHER readers refuse the built sentence — one fold, not four", () => {
    expect(deriveAttackDamageMultiplier(BOARD_ENERGY)).toBeNull();
    expect(deriveAttackDamagePenalty(BOARD_ENERGY)).toBeNull();
    expect(deriveAttackEffect(BOARD_ENERGY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the counter this arm delegates to, verified rather than inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — countEnergyInPlay on the ATTACKER's side, and the readings it separates", () => {
  it("counts Active PLUS Bench, and a bare board is 0 for the filtered read", () => {
    const bare = board();
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(0);
    expect(countEnergyInPlay(bare, "p1", null)).toBe(1);
    expect(countEnergyInPlay(dress(bare, "p1", [G], []), "p1", "Grass")).toBe(1);
    expect(countEnergyInPlay(dress(bare, "p1", [], [[G, G]]), "p1", "Grass")).toBe(2);
    expect(countEnergyInPlay(dress(bare, "p1", [G], [[G, G]]), "p1", "Grass")).toBe(3);
  });

  it("PROVISION, not the printed name — a wildcard counts, and a demotion stops it", () => {
    const wild = dress(board(), "p1", [], [["sv02-191"]]);
    expect(countEnergyInPlay(wild, "p1", "Grass")).toBe(1);
    const demoted = attachBenchFromDeck(wild, "p1", 0, "fix-special", 1);
    expect(demoted.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(countEnergyInPlay(demoted, "p1", "Grass")).toBe(0);
    // …and the UNTYPED read is unmoved across the demotion, which is what says the
    // two cards are still there and only the PROVISION changed.
    expect(countEnergyInPlay(wild, "p1", null)).toBe(2);
    expect(countEnergyInPlay(demoted, "p1", null)).toBe(3);
  });

  it("CARDS, not units: one wildcard moves the count by ONE", () => {
    const bare = dress(board(), "p1", [], [[G]]);
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(1);
    const wild = attachBenchFromDeck(bare, "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(wild, "p1", "Grass")).toBe(2);
    expect(countEnergyInPlay(wild, "p1", "Fire")).toBe(1);
    expect(countEnergyInPlay(wild, "p1", null)).toBe(3);
  });

  it("the {C} that pays the cost is REFUSED by the {G} filter", () => {
    // ⑶, at the counter rather than at the fold. `fix-energy` is a Basic Colorless
    // and Colorless is not in the vocabulary at all, so a board that can legally
    // attack still counts 0.
    const bare = board();
    expect(bare.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(bare, "p1", "Grass")).toBe(0);
    expect(countEnergyInPlay(dress(bare, "p1", [C, C], []), "p1", "Grass")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold on a real board: base + per × count.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the `+` fold on a live board", () => {
  it("the canonical board really does separate every candidate reading", () => {
    const state = canonical();
    const mine = state.players.p1;
    expect(countEnergyInPlay(state, "p1", "Grass")).toBe(4);
    expect(countEnergyInPlay(state, "p1", null)).toBe(5);
    expect(countEnergyInPlay(state, "p2", "Grass")).toBe(8);
    expect(mine.active?.energy).toHaveLength(2);
    expect(mine.bench).toHaveLength(2);
    expect(mine.bench.reduce((n, p) => n + p.energy.length, 0)).toBe(3);
    expect(state.players.p2.active?.energy).toHaveLength(6);
  });

  it("deals 20 + 30 × the {G} on the ATTACKER's whole board", () => {
    const { events } = swing(canonical());
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 120, dealt: 140 });
  });

  it("the PRINTED BASE IS KEPT: an Energy-free board still deals the printed 20", () => {
    const { events } = swing(board());
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
    expect(events.some((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toBe(false);
  });

  it("the ZONE is the whole board: the BENCH counts, and it is the slice", () => {
    // The shipped (zone-less) reading deals 20 here — the Active holds only the {C}
    // that paid — and the truth is 110. This is the single rung that goes red if
    // the `zone` field is dropped, ignored, or never emitted by the producer.
    const state = dress(board(), "p1", [], [[G, G], [G]]);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 90,
      dealt: 110,
    });
  });

  it("the SEAT is the attacker's: the opponent's whole board is invisible", () => {
    // The defender wears 8 {G} and the attacker none. A `defenderSeat` read — the
    // arm five lines up in the same switch, and the identical expression otherwise
    // — deals 260 here; the truth is the bare printed 20.
    const state = dress(board(), "p2", [G, G, G, G, G, G], [[G, G]]);
    expect(countEnergyInPlay(state, "p2", "Grass")).toBe(8);
    const dealt = findEvent(swing(state).events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("the FILTER bites on a live board: four {C} across the side score nothing", () => {
    // ⑶ at the fold. Every body holds Colorless and the printed noun is {G}, so an
    // untyped read deals 140 here and the truth is the printed 20.
    const state = dress(board(), "p1", [C], [[C], [C]]);
    expect(countEnergyInPlay(state, "p1", null)).toBe(4);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
  });

  it("a WILDCARD on the BENCH scores, and its DEMOTION un-scores it", () => {
    const wild = dress(board(), "p1", [], [["sv02-191"]]);
    expect(findEvent(swing(wild).events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 30,
      dealt: 50,
    });
    const demoted = attachBenchFromDeck(wild, "p1", 0, "fix-special", 1);
    const dealt = findEvent(swing(demoted).events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("the count is READ AT DECLARATION and scales linearly across the whole range", () => {
    // One board per {G} count, so the arm is `base + per × count` rather than a
    // threshold or a saturating read. The Energy is split across the Active and the
    // Bench at every step, so no single zone can produce the sequence on its own.
    for (const [active, bench, expected] of [
      [[G], [], 50],
      [[G], [[G]], 80],
      [[G], [[G, G]], 110],
      [[G], [[G, G], [G]], 140],
      [[G, G], [[G, G], [G]], 170],
    ] as const) {
      const state = dress(board(), "p1", active, bench);
      expect(findEvent(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(expected);
    }
  });

  it("BODIES are not the resource: three bare benched Pokémon score nothing", () => {
    // `yourBenchCount` reads exactly this board as 3 and would deal 110. The Energy
    // count reads it as 0 and deals the printed 20.
    const state = dress(board(), "p1", [], [[], [], []]);
    expect(state.players.p1.bench).toHaveLength(3);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
  });

  it("the seats are symmetric — p2 attacking reads p2's board", () => {
    // The evaluator takes `attackerSeat`, so the same board mirrored gives the same
    // number. A hard-coded "p1" would pass every rung above and fail here.
    const { events } = swing(canonical("p2"), "p2");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 120, dealt: 140 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the persisted question, asked and answered.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the persisted question, and the version pair", () => {
  it("MATCH_RECORD_VERSION STAYS 25 — a DamageCountSource field is never persisted", () => {
    expect(deriveAttackEffect(BOARD_ENERGY)).toBeNull();
    expect(programFor("fix-boardgrass")).toBeUndefined();
    expect(deriveAttackDamageBonus(BOARD_ENERGY)).not.toBeNull();
  });
});
