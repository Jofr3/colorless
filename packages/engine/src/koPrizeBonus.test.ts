import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { seatKoPrizeBonuses } from "./continuous";
import { applyAction, deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  must,
  driveSetup,
} from "./testFixtures";

const TOGEKISS = "sv08-072";
const HYDREIGON = "sv10.5w-067";
const HYDREIGON_R1 = "sv10.5w-161";
const HYDREIGON_R2 = "sv10.5w-169";

const TING_LU = "sv02-127";
/** Glimmora `sv02-126` "Shattering Crystal" — the on-KO Prize GUARD, 30 HP so one
    flat hit Knocks it Out. §8's prohibition witness. */
const GLIMMORA = "sv02-126";
const KOPRIZE = "fix-koprize";
/** Pecharunt ex — `fix-koprize`'s printed board condition, verbatim. */
const PECHARUNT = "sv06.5-039";
/** `fix-sniper` — Spread Shot, 30 to the Active AND 20 to each Benched Pokémon.
    The only way to reach a BENCH Knock Out from an attack, and therefore the only
    way to drive `koSpot`'s refusal at all. */
const SNIPER = "fix-sniper";

/** This suite's neutral attacker: 100 flat for one {C}, no Ability of its own, so
    every bonus below is the SOURCE's sentence and never the attacker's. */
const FLAT_HITTER = "fix-flat-hitter";
/** The victim, a BASIC on exactly 100 HP — Greedy Eater's `koTarget`, and one
    Prize, so `1 → 2` is the whole arithmetic. */
const VICTIM_BASIC = "fix-victim-basic";
/** The `koTarget` CONTROL: identical in every field the scan reads EXCEPT the
    stage. Without it a build that dropped `koTarget` entirely would be green on
    every board in this file. */
const VICTIM_EVO = "fix-victim-evo";
/** A 20-HP BASIC bench sitter — what Spread Shot's 20 Knocks Out, and the body
    both `koSpot` cases are decided on. */
const BENCH_VICTIM = "fix-bench-victim";
/** A 200-HP Active that SURVIVES Spread Shot's 30, so a snipe board produces a
    BENCH KO and nothing else. */
const TANK = "fix-tank";

const FLAT_HIT = { cost: ["Colorless"], name: "Flat Hit", damage: 100 };
/** Spread Shot's printed sentence, byte-identical to `fix-sniper`'s, so the
    deriver recognises it and Hydreigon ex can reach a Bench KO with its OWN
    attack — which is what `byThisPokemonsAttack` demands. */
const SPREAD = {
  cost: ["Colorless"],
  name: "Spread Shot",
  damage: 30,
  effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
};

const LOCAL_CARDS: Record<string, Card> = {
  [TOGEKISS]: battler(TOGEKISS, {
    name: "Togekiss",
    hp: 140,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage2",
    evolveFrom: "Togetic",
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Speed Wing", damage: 140 }],
    abilities: [
      {
        type: "Ability",
        name: "Wonder Kiss",
        effect:
          "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more Prize card. The effect of Wonder Kiss doesn't stack.",
      },
    ],
  }),
  [HYDREIGON]: hydreigon(HYDREIGON),
  [HYDREIGON_R1]: hydreigon(HYDREIGON_R1),
  [HYDREIGON_R2]: hydreigon(HYDREIGON_R2),
  [FLAT_HITTER]: battler(FLAT_HITTER, { name: "Flat Hitter", hp: 200, attacks: [FLAT_HIT] }),
  [VICTIM_BASIC]: battler(VICTIM_BASIC, { name: "Plain Victim", hp: 100 }),
  [VICTIM_EVO]: battler(VICTIM_EVO, {
    name: "Plain Victim Evolved",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Plain Victim",
  }),
  [BENCH_VICTIM]: battler(BENCH_VICTIM, { name: "Bench Sitter", hp: 20 }),
  [TANK]: battler(TANK, { name: "Tanky", hp: 200 }),
};

function hydreigon(id: string): Card {
  return battler(id, {
    name: "Hydreigon ex",
    hp: 330,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Zweilous",
    attacks: [
      {
        cost: ["Darkness", "Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Dark Bite",
        damage: 200,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
      { ...FLAT_HIT },
      { ...SPREAD },
    ],
    abilities: [
      {
        type: "Ability",
        name: "Greedy Eater",
        effect:
          "If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card.",
      },
    ],
  });
}

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const BONUS_DECK = deckOf({
  [TOGEKISS]: 4,
  [HYDREIGON]: 3,
  [HYDREIGON_R1]: 3,
  [HYDREIGON_R2]: 3,
  [FLAT_HITTER]: 3,
  [VICTIM_BASIC]: 3,
  [VICTIM_EVO]: 3,
  [BENCH_VICTIM]: 3,
  [TANK]: 3,
  [TING_LU]: 3,
  [GLIMMORA]: 3,
  [KOPRIZE]: 3,
  [PECHARUNT]: 3,
  [SNIPER]: 3,
  "fix-basic-1": 5,
  "fix-energy": 12,
});

const SEEDS = [7301, 7307, 7313, 7319, 7331] as const;

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: BONUS_DECK, p2: BONUS_DECK }, { pool: POOL, first: "p2" });
}

function board(
  seed: number,
  opts: {
    attacker?: string;
    p2Bench?: readonly string[];
    victim?: string;
    p1Bench?: readonly string[];
    victimDamage?: number;
    p2BenchDamage?: readonly (number | undefined)[];
    energy?: number;
  } = {},
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", opts.victim ?? VICTIM_BASIC), "p1");
  for (const id of opts.p1Bench ?? []) state = benchFromDeck(state, "p1", id);
  if ((opts.p1Bench ?? []).length === 0) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.attacker ?? FLAT_HITTER), "p2");
  for (const [i, id] of (opts.p2Bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", id);
    const damage = opts.p2BenchDamage?.[i];
    if (damage !== undefined) state = setBenchDamage(state, "p2", i, damage);
  }
  if ((opts.p2Bench ?? []).length === 0) state = benchFromDeck(state, "p2", "fix-basic-1");
  if (opts.victimDamage !== undefined) state = setDamage(state, "p1", opts.victimDamage);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p2" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return attachFromDeck(state, "p2", "fix-energy", opts.energy ?? 1);
}

/** The events of one real attack declaration by P2. */
function fire(state: GameState, index = 0): { events: GameEvent[]; state: GameState } {
  const result = applyAction(state, { type: "attack", seat: "p2", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { events: result.events, state: result.state };
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function prizesOwed(before: GameState, after: GameState, events: GameEvent[]): number {
  if (after.phase.kind === "ko:takePrizes") return after.phase.count;
  const owed = all(events, "PRIZES_OWED")[0];
  if (owed !== undefined) return owed.count;
  return before.players.p2.prizes.length - after.players.p2.prizes.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE TWO REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §1 — the two registry rows", () => {
  it("Wonder Kiss authors FOUR riders and deliberately not the fifth", () => {
    expect(programFor(TOGEKISS)?.passive).toEqual({
      koPrizeBonus: {
        ability: "Wonder Kiss",
        amount: 1,
        koSpot: "active",
        coinFlip: true,
        noStack: true,
      },
    });
    // It has NO `koTarget`: the printed noun is "your opponent's Active Pokémon"
    // with no card class at all, and a filter here would silently narrow a
    // sentence that narrows only the SPOT.
    expect(programFor(TOGEKISS)?.passive?.koPrizeBonus?.koTarget).toBeUndefined();
    expect(programFor(TOGEKISS)?.passive?.koPrizeBonus?.byThisPokemonsAttack).toBeUndefined();
    expect(programFor(TOGEKISS)?.triggered).toBeUndefined();
    expect(programFor(TOGEKISS)?.abilities).toBeUndefined();
    expect(programFor(TOGEKISS)?.attack).toBeUndefined();
  });

  it("Greedy Eater authors the OTHER two, and all THREE printings share ONE object", () => {
    for (const id of [HYDREIGON, HYDREIGON_R1, HYDREIGON_R2]) {
      expect(programFor(id)?.passive?.koPrizeBonus).toEqual({
        ability: "Greedy Eater",
        amount: 1,
        koTarget: { kind: "basicPokemon" },
        byThisPokemonsAttack: true,
      });
    }
    // The reprints are the SAME program object, not copies.
    expect(programFor(HYDREIGON)).toBe(programFor(HYDREIGON_R1));
    expect(programFor(HYDREIGON)).toBe(programFor(HYDREIGON_R2));
    // No flip, no cap, no spot clause — each one a printed absence, and each one
    // is what §3–§5 measure Wonder Kiss's presence against.
    const bonus = programFor(HYDREIGON)?.passive?.koPrizeBonus;
    expect(bonus?.coinFlip).toBeUndefined();
    expect(bonus?.noStack).toBeUndefined();
    expect(bonus?.koSpot).toBeUndefined();
  });

  it("the *doesn't stack* row's OTHER Abilities are each on a DIFFERENT seam — and ONE IS STILL UNBUILT", () => {
    expect(programFor("sv07-119")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("svp-136")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("sv10-086")?.passive?.seatDamageReductionAfterWR?.noStack).toBe(
      "Stone Palace",
    );
    expect(programFor("sv09-117")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe(
      "Extra Helpings",
    );
    expect(programFor("svp-184")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
    expect(programFor("sv09-037")?.passive?.seatHpBonus?.ability).toBe("Vibrant Dance");
    for (const id of ["sv07-119", "svp-136", "sv10-086", "sv09-117", "svp-184", "sv09-037"]) {
      expect(programFor(id)?.passive?.koPrizeBonus, id).toBeUndefined();
    }
  });

  it("no OTHER card in the registry carries the new field — the population is these four", () => {
    const holders = [TOGEKISS, HYDREIGON, HYDREIGON_R1, HYDREIGON_R2];
    for (const id of holders) expect(programFor(id)?.passive?.koPrizeBonus).toBeDefined();
    expect(programFor(GLIMMORA)?.triggered?.[0]?.onKoPrizeGuard).toBe("coinFlipPrevent");
    expect(programFor(GLIMMORA)?.passive?.koPrizeBonus).toBeUndefined();
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction).toBeDefined();
    expect(programFor("sv06.5-037")?.passive?.koPrizeBonus).toBeUndefined();
  });

  it("both sentences are ABILITIES and neither derives as an attack effect", () => {
    // They live on `abilities_json`. Feeding them to the attack deriver must stay
    // null — the column-blindness this family keeps tripping over, made a test.
    const wonderKiss = LOCAL_CARDS[TOGEKISS]?.abilities?.[0]?.effect ?? "";
    const greedyEater = LOCAL_CARDS[HYDREIGON]?.abilities?.[0]?.effect ?? "";
    expect(deriveAttackEffect(wonderKiss)).toBeNull();
    expect(deriveAttackEffect(greedyEater)).toBeNull();
    // And the printed strings differ on every clause the field encodes.
    expect(wonderKiss).toContain("Active Pokémon is Knocked Out");
    expect(wonderKiss).toContain("flip a coin");
    expect(wonderKiss).toContain("doesn't stack");
    expect(greedyEater).toContain("Basic Pokémon is Knocked Out");
    expect(greedyEater).toContain("an attack used by this Pokémon");
    expect(greedyEater).not.toContain("flip a coin");
    expect(greedyEater).not.toContain("doesn't stack");
    expect(greedyEater).not.toContain("Active");
    expect(wonderKiss).not.toContain("Basic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SCAN, read directly — the board questions, with no rng in them.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §2 — `seatKoPrizeBonuses`, the board half", () => {
  it("finds a benched Togekiss for an ACTIVE KO and refuses it for a BENCH KO", () => {
    const state = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    const victim = POOL[VICTIM_BASIC];
    expect(seatKoPrizeBonuses(state, "p2", victim, true, undefined)).toHaveLength(1);
    expect(seatKoPrizeBonuses(state, "p2", victim, false, undefined)).toEqual([]);
  });

  it("finds Hydreigon ex ONLY when the holder's own uid is the attacker's", () => {
    const state = board(SEEDS[0], { attacker: HYDREIGON, victim: VICTIM_BASIC });
    const attackerUid = state.players.p2.active?.stack.at(-1);
    if (attackerUid === undefined) throw new Error("p2 has no Active");
    const victim = POOL[VICTIM_BASIC];
    expect(seatKoPrizeBonuses(state, "p2", victim, true, attackerUid)).toHaveLength(1);
    // The Checkup / mid-turn shape: no attacker at all.
    expect(seatKoPrizeBonuses(state, "p2", victim, true, undefined)).toEqual([]);
    expect(seatKoPrizeBonuses(state, "p2", victim, true, "some-other-uid")).toEqual([]);
  });

  it("Greedy Eater refuses an EVOLUTION corpse and an unreadable one", () => {
    const state = board(SEEDS[0], { attacker: HYDREIGON });
    const attackerUid = state.players.p2.active?.stack.at(-1);
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_EVO], true, attackerUid)).toEqual([]);
    // `undefined` fails every filter — `matchesFilter`'s conservative direction,
    // and the reason an unreadable corpse pays no bonus rather than every bonus.
    expect(seatKoPrizeBonuses(state, "p2", undefined, true, attackerUid)).toEqual([]);
    // …but Wonder Kiss, which has NO `koTarget`, pays for the very same corpse.
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p2", POOL[VICTIM_EVO], true, undefined)).toHaveLength(1);
    expect(seatKoPrizeBonuses(kiss, "p2", undefined, true, undefined)).toHaveLength(1);
  });

  it("TWO Togekiss yield ONE entry; two Hydreigon ex would yield two — but cannot", () => {
    const two = board(SEEDS[0], { p2Bench: [TOGEKISS, TOGEKISS] });
    expect(seatKoPrizeBonuses(two, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
    const three = board(SEEDS[0], { p2Bench: [TOGEKISS, TOGEKISS, TOGEKISS] });
    expect(seatKoPrizeBonuses(three, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
    const pair = board(SEEDS[0], { attacker: HYDREIGON, p2Bench: [HYDREIGON_R1] });
    const attackerUid = pair.players.p2.active?.stack.at(-1);
    expect(seatKoPrizeBonuses(pair, "p2", POOL[VICTIM_BASIC], true, attackerUid)).toHaveLength(1);
    // …and the entry belongs to the ATTACKER, not to the bench copy.
    expect(seatKoPrizeBonuses(pair, "p2", POOL[VICTIM_BASIC], true, attackerUid)[0]?.uid).toBe(
      attackerUid,
    );
  });

  it("a board with no source at all is EMPTY, on either side", () => {
    const state = board(SEEDS[0]);
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    expect(seatKoPrizeBonuses(state, "p1", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p1", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WONDER KISS, DRIVEN ON A REAL ATTACK — the coin, and both of its faces.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §3 — Wonder Kiss on a real KO", () => {
  /** Every seed's outcome for the same board: the flip's face and what was owed. */
  function run(seed: number, bench: readonly string[] = [TOGEKISS]) {
    const before = board(seed, { p2Bench: bench });
    const { events, state } = fire(before);
    const flips = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
    return {
      owed: prizesOwed(before, state, events),
      flips,
      bonuses: all(events, "PRIZE_BONUS"),
      triggers: all(events, "ABILITY_TRIGGERED").filter((e) => e.ability === "Wonder Kiss"),
    };
  }

  it("BOTH faces occur across the seed set — the claim below is not vacuous", () => {
    const faces = new Set(SEEDS.map((seed) => run(seed).flips[0]?.result));
    expect(faces).toEqual(new Set(["heads", "tails"]));
  });

  it("heads takes ONE more Prize, tails takes none, and the flip always happens", () => {
    for (const seed of SEEDS) {
      const { owed, flips, bonuses, triggers } = run(seed);
      // The Ability announced itself and flipped exactly once, whatever the face —
      // the flip HAPPENED and moved the rng, so hiding it on tails would leave the
      // next coin in the game unexplainable.
      expect(triggers, `seed ${seed}`).toHaveLength(1);
      expect(flips, `seed ${seed}`).toHaveLength(1);
      const heads = flips[0]?.result === "heads";
      expect(owed, `seed ${seed}`).toBe(heads ? 2 : 1);
      expect(bonuses, `seed ${seed}`).toHaveLength(heads ? 1 : 0);
      if (heads) {
        expect(bonuses[0]?.by).toBe(1);
        expect(bonuses[0]?.count).toBe(2);
        expect(bonuses[0]?.seat).toBe("p1");
      }
    }
  });

  it("the CONTROL: the same board without a Togekiss owes ONE and flips nothing", () => {
    for (const seed of SEEDS) {
      const { owed, flips, bonuses, triggers } = run(seed, ["fix-basic-1"]);
      expect(owed, `seed ${seed}`).toBe(1);
      expect(flips, `seed ${seed}`).toHaveLength(0);
      expect(bonuses, `seed ${seed}`).toHaveLength(0);
      expect(triggers, `seed ${seed}`).toHaveLength(0);
    }
  });

  it("the ORDER: ABILITY_TRIGGERED, then the flip, then PRIZE_BONUS", () => {
    // A log that announced the prize before the coin would be describing a
    // consequence before its cause, and the events are what a client renders.
    const seed = SEEDS.find((s) => {
      const before = board(s, { p2Bench: [TOGEKISS] });
      return all(fire(before).events, "PRIZE_BONUS").length === 1;
    });
    if (seed === undefined) throw new Error("no heads seed in the set");
    const { events } = fire(board(seed, { p2Bench: [TOGEKISS] }));
    const kinds = events
      .filter(
        (e) =>
          e.type === "ABILITY_TRIGGERED" ||
          e.type === "ABILITY_COIN_FLIP" ||
          e.type === "PRIZE_BONUS",
      )
      .map((e) => e.type);
    expect(kinds).toEqual(["ABILITY_TRIGGERED", "ABILITY_COIN_FLIP", "PRIZE_BONUS"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `koSpot` — the clause that is only visible on a BENCH Knock Out.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §4 — the ACTIVE clause, driven on a Bench KO", () => {
  it("a sniped BENCH Knock Out pays Wonder Kiss NOTHING, and the Active board does", () => {
    for (const seed of SEEDS) {
      // Spread Shot: 30 to the 200-HP Active (survives) and 20 to the 20-HP bench
      // sitter (dies). The only KO in the batch is a BENCH one.
      const before = board(seed, {
        attacker: SNIPER,
        p2Bench: [TOGEKISS],
        victim: TANK,
        p1Bench: [BENCH_VICTIM],
      });
      const { events, state } = fire(before);
      expect(state.players.p1.active?.damage, `seed ${seed}`).toBe(30);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
      expect(
        all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss"),
        `seed ${seed}`,
      ).toHaveLength(0);
    }
  });

  it("GREEDY EATER pays for that very same Bench KO — it has no spot clause", () => {
    for (const seed of SEEDS) {
      // Hydreigon ex attacks with its OWN Spread Shot (index 2), so both of its
      // clauses hold: the corpse is a Basic and the kill came from this body.
      const before = board(seed, {
        attacker: HYDREIGON,
        victim: TANK,
        p1Bench: [BENCH_VICTIM],
      });
      const { events, state } = fire(before, 2);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      const bonuses = all(events, "PRIZE_BONUS");
      expect(bonuses, `seed ${seed}`).toHaveLength(1);
      expect(bonuses[0]?.by).toBe(1);
      expect(all(events, "ABILITY_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GREEDY EATER's two clauses, each refused on its own board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §5 — Greedy Eater on a real KO", () => {
  it("a BASIC Active Knocked Out by Hydreigon's own attack takes 2", () => {
    for (const seed of SEEDS) {
      const before = board(seed, { attacker: HYDREIGON, victim: VICTIM_BASIC });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      expect(all(events, "PRIZE_BONUS")[0]?.by, `seed ${seed}`).toBe(1);
      expect(
        all(events, "ABILITY_TRIGGERED").filter((e) => e.ability === "Greedy Eater"),
        `seed ${seed}`,
      ).toHaveLength(1);
    }
  });

  it("the `koTarget` CONTROL: an EVOLUTION Active on the same board takes 1", () => {
    for (const seed of SEEDS) {
      const before = board(seed, { attacker: HYDREIGON, victim: VICTIM_EVO });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("the `byThisPokemonsAttack` CONTROL: a BENCHED Hydreigon ex pays nothing", () => {
    for (const seed of SEEDS) {
      const before = board(seed, {
        attacker: FLAT_HITTER,
        p2Bench: [HYDREIGON],
        victim: VICTIM_BASIC,
      });
      const { events, state } = fire(before);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("both reprints behave identically to the base printing", () => {
    for (const id of [HYDREIGON_R1, HYDREIGON_R2]) {
      const before = board(SEEDS[0], { attacker: id, victim: VICTIM_BASIC });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), id).toBe(2);
      expect(all(events, "PRIZE_BONUS"), id).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. §9 — the Ability lock, and its OWN rider as the control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §6 — the §9 lock reaches this aura", () => {
  it("a DAMAGED Togekiss under Ting-Lu ex's Cursed Land pays NOTHING", () => {
    for (const seed of SEEDS) {
      const before = board(seed, {
        victim: TING_LU,
        victimDamage: 140,
        p2Bench: [TOGEKISS],
        p2BenchDamage: [10],
      });
      const { events, state } = fire(before);
      // Ting-Lu ex has a Rule Box, so the face value is TWO, not one.
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
      expect(all(events, "ABILITY_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("the CONTROL is the lock's own rider: an UNDAMAGED Togekiss still pays", () => {
    const results = SEEDS.map((seed) => {
      const before = board(seed, { victim: TING_LU, victimDamage: 140, p2Bench: [TOGEKISS] });
      const { events, state } = fire(before);
      return { owed: prizesOwed(before, state, events), events };
    });
    // Every seed flipped — the aura is live — and heads paid a third Prize.
    for (const [i, r] of results.entries()) {
      expect(all(r.events, "ABILITY_COIN_FLIP"), `seed ${SEEDS[i]}`).toHaveLength(1);
      const heads = all(r.events, "ABILITY_COIN_FLIP")[0]?.result === "heads";
      expect(r.owed, `seed ${SEEDS[i]}`).toBe(heads ? 3 : 2);
    }
  });

  it("Hydreigon ex is EXEMPT from Cursed Land — *except for Pokémon ex*", () => {
    for (const seed of SEEDS) {
      // Same lock, same damage, and the source is an `ex`: the print's own
      // exception, and the reason this pair is not two spellings of one negative.
      const before = board(seed, {
        attacker: HYDREIGON,
        victim: TING_LU,
        victimDamage: 130,
        p1Bench: [BENCH_VICTIM],
      });
      const attackerUid = before.players.p2.active?.stack.at(-1);
      expect(
        seatKoPrizeBonuses(before, "p2", POOL[BENCH_VICTIM], false, attackerUid),
        `seed ${seed}`,
      ).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE OTHER TWO KO ROUTES — the grep said they exist; these say what they do.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §7 — the Checkup route, where neither clause can hold", () => {
  it("a Checkup KO pays NEITHER card — no attacker seat, no attacker uid", () => {
    // The Checkup sweep omits both threaded arguments, so Greedy Eater is refused
    // outright; Wonder Kiss's clauses do not mention an attack at all, and the
    // scan's answer is the same for the reason the SCAN can be asked directly.
    const state = board(SEEDS[0], { attacker: HYDREIGON, p2Bench: [HYDREIGON_R1] });
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE COMPOSITION WITH THE SEAM'S EXISTING MEMBERS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §8 — a prohibition is not a clamped reduction", () => {
  it("a Glimmora-PREVENTED Prize takes no bonus AND draws no Wonder Kiss flip", () => {
    // Glimmora is 30 HP, so the flat 100 Knocks it Out; its own guard flips first.
    // On HEADS the prize is DENIED — "your opponent can't take any Prize cards for
    // it" is a prohibition, and a later permission does not overturn it.
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const before = board(seed, { victim: GLIMMORA, p2Bench: [TOGEKISS] });
      const { events, state } = fire(before);
      const guard = all(events, "ABILITY_COIN_FLIP").find(
        (e) => e.ability === "Shattering Crystal",
      );
      if (guard === undefined) throw new Error(`no guard flip at seed ${seed}`);
      seen.add(guard.result);
      const kissFlips = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
      if (guard.result === "heads") {
        expect(all(events, "PRIZE_PREVENTED"), `seed ${seed}`).toHaveLength(1);
        expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
        expect(kissFlips, `seed ${seed}`).toHaveLength(0);
      } else {
        expect(kissFlips, `seed ${seed}`).toHaveLength(1);
        const owed = prizesOwed(before, state, events);
        expect(owed, `seed ${seed}`).toBe(kissFlips[0]?.result === "heads" ? 2 : 1);
      }
    }
    // Both faces of the GUARD occur, so neither branch above is vacuous.
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("a reduction CLAMPED to zero still takes the bonus — 1 − 2 → 0, then +1", () => {
    for (const seed of SEEDS) {
      const before = board(seed, {
        victim: KOPRIZE,
        p1Bench: [PECHARUNT],
        p2Bench: [TOGEKISS],
      });
      const { events, state } = fire(before);
      expect(all(events, "PRIZE_REDUCED")[0]?.count, `seed ${seed}`).toBe(0);
      const kiss = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
      expect(kiss, `seed ${seed}`).toHaveLength(1);
      const heads = kiss[0]?.result === "heads";
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(heads ? 1 : 0);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(heads ? 1 : 0);
    }
  });
});
