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

const HERD_CHARGE =
  "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).";
const CROWD_CRUSH = "This attack does 20 more damage for each of your opponent's Benched Pokémon.";
const FLANK_RUSH = "This attack does 30 damage for each of your opponent's Benched Pokémon.";
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
const SPECIAL_SCAN =
  "This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon.";

/** `fix-benchcount`'s index 3 — the SPREAD that names the same zone with the same
    preposition, and is not a scaling clause at all. */
const HERD_STOMP =
  "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

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

function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(driveSetup(SEED, { p1: BENCH_BODY_DECK, p2: BENCH_BODY_DECK }, { first: opener }), {
      type: "endTurn",
      seat: opener,
    }),
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

function dealt(events: GameEvent[]): number | null {
  return find(events, "DAMAGE_DEALT")?.dealt ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures — a SEPARATE population, swept before anything was written.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, then authored", () => {
  it("HELD NOTHING TO REUSE: no fixture printed any of these seven sentences", () => {
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

  it("D425 — `fix-benchcount` index 3 was DECLARED-UNSIMULATED and is SIMULATED now", () => {
    expect(deriveAttackEffect(HERD_STOMP)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 20 },
    ]);
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
    expect(deriveAttackDamageBonus(ROUT)).toEqual({
      per: 30,
      count: { kind: "opponentBenchCount" },
    });
  });

  it("KEEPS its five older count sources — no arm was stranded", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each damage counter on this Pokémon.",
      ),
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
      deriveAttackDamageBonus(
        "If this Pokémon has a Pokémon Tool attached, this attack does 30 more damage.",
      ),
    ).toMatchObject({ per: 30, count: { kind: "boardCondition" } });
  });

  it('CANNOT PRODUCE `zone: "board"` — the additive board spelling is UNPRINTED', () => {
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
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Water Energy attached to all of your opponent's Pokémon.",
      ),
    ).toEqual({ per: 60, count: { kind: "energyOnOpponent", zone: "board", energyType: "Water" } });
  });

  it("TELLS 'no filter' APART FROM 'a filter I could not read' — the second stays LOUD", () => {
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
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Basic Energy attached to all of your opponent's Pokémon.",
      ),
    ).toEqual({ per: 60, count: { kind: "energyOnOpponent", zone: "board", energyType: "basic" } });
  });

  it("KEEPS its four older count sources — no arm was stranded", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each damage counter on this Pokémon.",
      ),
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

  it("IS DISJOINT FROM THE `damage counter` BENCH PATTERN, IN BOTH DIRECTIONS", () => {
    const counters =
      "This attack does 10 damage for each damage counter on all of your Benched Pokémon.";
    expect(deriveAttackDamageMultiplier(counters)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench" },
    });
    expect(deriveAttackDamageBonus(counters)).toBeNull();
    for (const mine of [FLANK_RUSH, CROWD_CRUSH, HERD_CHARGE]) {
      expect(mine).not.toContain("damage counter");
    }
  });

  it("PINS THE ABSENCE: `bothSidesBenchCount` has NO multiply or subtract twin", () => {
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

  it("THE MIRROR WITNESS: the SAME board reads 1, not 4, for the opponent-only count", () => {
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

  it("THE MIRROR WITNESS: the board zone reads 5, the active zone 2, on ONE board", () => {
    const state = energyBoard(2, 3);
    expect(dealt(swing(state, ENERGY.siphon).events)).toBe(40); // 2 × 20
    expect(dealt(swing(state, ENERGY.field).events)).toBe(300); // 5 × 60
  });

  it("`board` is a SUPERSET of `active`, not the Bench alone (§6.3 'in play')", () => {
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
    const state = energyBoard(1, 1);
    expect(dealt(swing(state, ENERGY.siphon).events)).toBe(20);
    expect(dealt(swing(state, ENERGY.field).events)).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordering — one real witness, and the absences that CANNOT have one.
// ─────────────────────────────────────────────────────────────────────────────

describe("the §8.5 fold order", () => {
  it("AN ORDERING WITNESS THAT DOES NOT COMMUTE: `scaled` lands BEFORE Weakness", () => {
    let state = board("fix-benchcount", "fix-pokemon-v-weak");
    state = withBench(state, "p2", 3);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { events } = swing(state, BENCH.crowd);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(60);
    expect(find(events, "DAMAGE_DEALT")?.weakness).not.toBeNull();
    expect(dealt(events)).toBe(160);
  });

  it("PINS THE ABSENCE: the `×` fold has ONE term, so NO ordering witness can exist", () => {
    let state = board("fix-benchcount", "fix-pokemon-v-weak");
    state = withBench(state, "p2", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const row = find(swing(state, BENCH.flank).events, "DAMAGE_DEALT");
    expect(FIXTURE_POOL["fix-benchcount"]?.attacks?.[BENCH.flank]?.damage).toBe("30×");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(60); // 2 × 30, the WHOLE damage
    expect(row?.dealt).toBe(120); // × 2 Weakness, applied to the one term
  });

  it("PINS THE ABSENCE: no sentence here can mutate the resource it counts", () => {
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

  it("THE ABSENCE WAS CLOSED (D196): the BOTH-ACTIVES zone is built, and its × twin is not", () => {
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
  it("`MATCH_RECORD_VERSION` STAYS 12 — and here is the derivation, not the habit", () => {
    expect(deriveAttackDamageBonus(HERD_CHARGE)).not.toBeNull();
    expect(deriveAttackEffect(HERD_CHARGE)).toBeNull(); // no op, so nothing can park
    expect(deriveAttackEffect(FLANK_RUSH)).toBeNull();
    expect(deriveAttackEffect(FIELD_SCAN)).toBeNull();
  });
});

describe("the two RETIRED traps — measured to 0 legal, and not built", () => {
  it("the `extra Metal Energy` CAP mechanism is 0 legal — no cap exists in the engine", () => {
    const capped =
      "This attack does 60 more damage for each extra Metal Energy attached to this Pokémon (in addition to this attack's cost). You can't add more than 120 damage in this way.";
    expect(deriveAttackDamageBonus(capped)).toBeNull();
    expect(deriveAttackDamageMultiplier(capped)).toBeNull();
  });

  it("the SPELLED-OUT energy words are 0 legal — the arms stay, and are not load-bearing", () => {
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
