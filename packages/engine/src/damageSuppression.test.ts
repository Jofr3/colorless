import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
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
  splitAttackRequirementClause,
} from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  DAMAGE_SUPPRESSION_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

/** The four printed attack sentences, char-for-char off the D1 rows. */
const S_EFFECTS =
  "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.";
const S_RESISTANCE = "This attack's damage isn't affected by Resistance.";
const S_WR_EFFECTS =
  "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.";
const S_WR = "This attack's damage isn't affected by Weakness or Resistance.";
const WEAKNESS_ONLY_CLAUSE = "This attack's damage isn't affected by Weakness.";
/** The printed ABILITY, char-for-char (Walking Wake ex "Azure Seas"). */
const S_ABILITY =
  "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon.";

const DEFERRED_RIDERS = [
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
  "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.",
  "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
] as const;
const POOL_RIDER =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
const FEINT_ATTACK =
  "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.";

/** U+2019, spelled as an escape (clauseApostrophe.test.ts's idiom). */
const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

/** One seed: nothing here flips a coin and every body and Energy is placed by
    surgery, so a seed table would describe a shuffle rather than a rule. */
const SEED = 5;

const IDX = { effects: 0, resistance: 1, wrEffects: 2, wr: 3, control: 4 } as const;
/** The index-5 PROBE — the same clause on a printed `60+`, which no real card has. */
const PROBE = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function board(attacker: string, defender: string): GameState {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: DAMAGE_SUPPRESSION_DECK, p2: DAMAGE_SUPPRESSION_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** Put Neutralization Zone into the shared zone from `seat`'s hand — the OFF-TARGET
    prevention this clause must not reach (attackerFilter.test.ts's idiom). */
function withStadium(state: GameState, seat: Seat = "p1"): GameState {
  const next = handFromDeck(state, seat, "sv06.5-060", 1);
  return mustApply(next, {
    type: "playTrainer",
    seat,
    uid: handUid(next, seat, "sv06.5-060"),
  }).state;
}

function withInstalledDebuff(state: GameState, amount: number): GameState {
  const active = state.players.p1.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        active: { ...active, attackDamageDebuff: { turn: state.turn, amount } },
      },
    },
  };
}

function dealt(state: GameState, index: number): number | null {
  return find(swing(state, index).events, "DAMAGE_DEALT")?.dealt ?? null;
}

function row(state: GameState, index: number) {
  return find(swing(state, index).events, "DAMAGE_DEALT");
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixture pool — a SEPARATE population, swept before anything was authored.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, and it was NOT empty", () => {
  it("Bellibolt sv03-078/-201 already printed sentence #1, and now derives it", () => {
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(
        ([id, card]) =>
          id !== "fix-suppressor" &&
          (card.attacks ?? []).some((a) =>
            [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR].includes(a.effect ?? ""),
          ),
      )
      .map(([id]) => id);
    expect(carriers).toEqual(["sv03-078", "sv03-201"]);
    for (const id of ["sv03-078", "sv03-201"] as const) {
      const printed = FIXTURE_POOL[id]?.attacks?.[0];
      expect(printed?.name).toBe("Thunderous Edge");
      expect(deriveAttackDamageSuppression(printed?.effect ?? "")).toEqual({ targetEffects: true });
    }
  });

  it("…and the pool's OTHER carrier is a DEFERRED rider that stays unsimulated", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]?.attacks?.[0]?.effect).toBe(POOL_RIDER);
    }
    expect(deriveAttackDamageSuppression(POOL_RIDER)).toBeNull();
  });

  it("holds no fixture printing the ABILITY sentence except this slice's own", () => {
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(([, card]) => (card.abilities ?? []).some((a) => a.effect === S_ABILITY))
      .map(([id]) => id);
    expect(carriers).toEqual(["fix-azureseas"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageSuppression — four sentences, three booleans", () => {
  it("reads each printed sentence into exactly the booleans it names", () => {
    expect(deriveAttackDamageSuppression(S_EFFECTS)).toEqual({ targetEffects: true });
    expect(deriveAttackDamageSuppression(S_RESISTANCE)).toEqual({ resistance: true });
    expect(deriveAttackDamageSuppression(S_WR_EFFECTS)).toEqual({
      weakness: true,
      resistance: true,
      targetEffects: true,
    });
    expect(deriveAttackDamageSuppression(S_WR)).toEqual({ weakness: true, resistance: true });
  });

  it("the ALTERNATION ORDER is behaviour: the compound must beat its own prefix", () => {
    expect(deriveAttackDamageSuppression(S_WR_EFFECTS)?.targetEffects).toBe(true);
    expect(deriveAttackDamageSuppression(S_WR)?.targetEffects).toBeUndefined();
  });

  it("each of the three booleans is ABSENT rather than false when unnamed", () => {
    expect(Object.keys(deriveAttackDamageSuppression(S_RESISTANCE) ?? {})).toEqual(["resistance"]);
    expect(Object.keys(deriveAttackDamageSuppression(S_EFFECTS) ?? {})).toEqual(["targetEffects"]);
  });

  it("reads the U+2019 spelling IDENTICALLY on all four (D137's fold)", () => {
    for (const sentence of [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR]) {
      expect(deriveAttackDamageSuppression(curly(sentence))).toEqual(
        deriveAttackDamageSuppression(sentence),
      );
      expect(deriveAttackDamageSuppression(curly(sentence))).not.toBeNull();
    }
  });

  it("refuses a lowercased 'this', a missing period, and leading/trailing text", () => {
    expect(deriveAttackDamageSuppression(S_WR.replace("This", "this"))).toBeNull();
    expect(deriveAttackDamageSuppression(S_WR.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageSuppression(`Draw a card. ${S_WR}`)).toBeNull();
    expect(deriveAttackDamageSuppression(`${S_WR} Draw a card.`)).toBeNull();
    expect(legalAttackCorpus().filter(([, t]) => t === WEAKNESS_ONLY_CLAUSE)).toEqual([]);
    expect(
      legalAttackCorpus().filter(([, t]) => t.endsWith(` ${WEAKNESS_ONLY_CLAUSE}`)),
    ).toHaveLength(2);
    expect(deriveAttackDamageSuppression(WEAKNESS_ONLY_CLAUSE)).toBeNull();
  });

  it("`DAMAGE_SUPPRESSION` refuses every rider-on-compound, built or not", () => {
    for (const rider of [DEFERRED_RIDERS[0], POOL_RIDER]) {
      expect(deriveAttackDamageSuppression(rider), rider).toBeNull();
    }
    expect(splitAttackRequirementClause(DEFERRED_RIDERS[0])).toEqual({
      clause: "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.",
      body: S_WR,
    });
    expect(deriveAttackDamageSuppression(DEFERRED_RIDERS[2])).toEqual({ weakness: true });
    expect(deriveAttackDamageMultiplier(DEFERRED_RIDERS[2])).toEqual({
      per: 10,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
      },
    });
    expect(deriveAttackDamageSuppression(DEFERRED_RIDERS[1])).toEqual({ weakness: true });
    expect(deriveAttackDamageBonus(DEFERRED_RIDERS[1])).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 },
      },
    });
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackDamageBonus" || name === "deriveAttackDamageSuppression") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(DEFERRED_RIDERS[1]) ?? null, name).toBeNull();
    }
    expect(deriveAttackDamageSuppression(DEFERRED_RIDERS[3])).toEqual({
      weakness: true,
      resistance: true,
    });
    expect(deriveAttackCoinFlip(DEFERRED_RIDERS[3])).toEqual({
      kind: "opponentPerTails",
      flips: { kind: "opponentBench" },
      per: 80,
    });
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackCoinFlip" || name === "deriveAttackDamageSuppression") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(DEFERRED_RIDERS[3]) ?? null, name).toBeNull();
    }
    const notBuilt = DEFERRED_RIDERS.filter((rider) => !resolvedByAnyReader(rider));
    expect(notBuilt).toEqual([]);
  });

  it("is DISJOINT from all TWELVE sibling readers on all four sentences", () => {
    // The whole-sentence anchor is what makes "a card carries at most one" true,
    // and it is asserted rather than argued: no other reader may answer on this
    // text, and this reader may not answer on theirs.
    const others = [
      deriveAttackDamageBonus,
      deriveAttackDamageMultiplier,
      deriveAttackDamagePenalty,
      deriveAttackRequirement,
      deriveAttackEffect,
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackPreDamage,
      deriveAttackCopy,
      deriveAttackCoinFlip,
    ];
    expect([...others.map((read) => read.name), "deriveAttackDamageSuppression"].sort()).toEqual(
      attackReaderSurface(),
    );
    expect(attackReaderSurface()).toHaveLength(14);

    for (const sentence of [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR]) {
      for (const read of others) expect(read(sentence)).toBeNull();
    }
    for (const sentence of [
      "This attack does 20 more damage for each damage counter on this Pokémon.",
      "Your opponent's Active Pokémon is now Asleep.",
    ]) {
      expect(deriveAttackDamageSuppression(sentence)).toBeNull();
    }
  });

  it("does NOT read Feint Attack — that sentence stays on `damageChosen.ignoreWR`", () => {
    expect(deriveAttackDamageSuppression(FEINT_ATTACK)).toBeNull();
    expect(deriveAttackEffect(FEINT_ATTACK)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The registry — the ABILITY half's storage.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ability half — Walking Wake ex 'Azure Seas'", () => {
  it("fields all SIX Standard-legal printings, and nothing else carries the field", () => {
    for (const id of [
      "sv05-050",
      "sv05-189",
      "sv05-205",
      "sv05-215",
      "sv08.5-178",
      "svp-127",
    ] as const) {
      expect(programFor(id)?.passive).toEqual({ suppressTargetEffectsOnAttack: true });
    }
    expect(programFor("sv05-189")?.passive).toBe(programFor("sv05-050")?.passive);
    for (const id of ["sv05-050", "sv08.5-178", "svp-127"] as const) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });

  it("the synthetic demonstrator carries the printed sentence byte for byte", () => {
    expect(FIXTURE_POOL["fix-azureseas"]?.abilities).toEqual([
      { type: "Ability", name: "Azure Seas", effect: S_ABILITY },
    ]);
    // Its ONE attack prints NO effect — anything it suppresses came from the
    // Ability, because there is no attack text for a deriver to read.
    expect(FIXTURE_POOL["fix-azureseas"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Surge", damage: 60 },
    ]);
    expect(programFor("fix-azureseas")?.passive).toEqual({ suppressTargetEffectsOnAttack: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8.5, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8.5 — the ORDER witness, on one board and four sentences", () => {
  const wall = () => board("fix-suppressor", "fix-suppresswall");

  it("the control takes Weakness THEN the reduction — 90, not 60", () => {
    expect(dealt(wall(), IDX.control)).toBe(90);
    expect(row(wall(), IDX.control)).toMatchObject({
      base: 60,
      weakness: { op: "multiply", amount: 2 },
      reduction: 30,
    });
  });

  it("`targetEffects` alone removes the REDUCTION and leaves Weakness: 120", () => {
    expect(dealt(wall(), IDX.effects)).toBe(120);
    expect(row(wall(), IDX.effects)).toMatchObject({ weakness: { op: "multiply", amount: 2 } });
    expect(row(wall(), IDX.effects)?.reduction).toBeUndefined();
  });

  it("`weakness + resistance` removes Weakness and leaves the reduction: 30", () => {
    expect(dealt(wall(), IDX.wr)).toBe(30);
    expect(row(wall(), IDX.wr)).toMatchObject({ weakness: null, reduction: 30 });
  });

  it("all three removes both: the printed 60, unmodified", () => {
    expect(dealt(wall(), IDX.wrEffects)).toBe(60);
    expect(row(wall(), IDX.wrEffects)).toMatchObject({ weakness: null, resistance: null });
    expect(row(wall(), IDX.wrEffects)?.reduction).toBeUndefined();
  });

  it("…and the four numbers are DISTINCT, which is what makes each arm observable", () => {
    const state = wall();
    const numbers = [IDX.control, IDX.effects, IDX.wr, IDX.wrEffects].map((i) => dealt(state, i));
    expect(numbers).toEqual([90, 120, 30, 60]);
    expect(new Set(numbers).size).toBe(4);
  });

  it("`resistance` alone changes NOTHING here — the board has no Resistance", () => {
    // The negative that separates the three booleans: a Resistance suppression on
    // a body with no Resistance must leave Weakness and the reduction alone. A
    // build that folded Weakness and Resistance into one field reads 120 here.
    expect(dealt(wall(), IDX.resistance)).toBe(90);
  });
});

describe("§8.5 — Resistance, and the ordering witness that does NOT exist", () => {
  const rwall = () => board("fix-suppressor", "fix-resistwall");

  it("suppressing Resistance moves the number: 0 → 30 on a −30/−30 body", () => {
    // `fix-resistwall` is −30 Fire Resistance AND −30 after W/R, off a printed 60:
    // the control is 60 − 30 − 30 = 0, and removing the Resistance step leaves 30.
    expect(dealt(rwall(), IDX.control)).toBe(0);
    expect(dealt(rwall(), IDX.resistance)).toBe(30);
    expect(row(rwall(), IDX.resistance)).toMatchObject({ resistance: null, reduction: 30 });
  });

  it("PINNED ABSENCE: `suppressResistance` alone can NEVER witness an ORDER", () => {
    for (let x = 0; x <= 300; x += 10) {
      for (const a of [0, 30]) {
        for (const b of [0, 10, 20, 30, 100]) {
          expect(Math.max(0, Math.max(0, x - a) - b)).toBe(Math.max(0, Math.max(0, x - b) - a));
        }
      }
    }
    expect(FIXTURE_POOL["fix-weak-tough"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-weak-tough"]?.resistances).toEqual([{ type: "Fire", value: "-30" }]);
  });

  it("on the synthetic both-modifier body the three arms separate cleanly", () => {
    const wt = () => board("fix-suppressor", "fix-weak-tough");
    expect(dealt(wt(), IDX.control)).toBe(90);
    expect(dealt(wt(), IDX.resistance)).toBe(120);
    expect(dealt(wt(), IDX.wr)).toBe(60);
    expect(dealt(wt(), IDX.wrEffects)).toBe(60);
    // …and `targetEffects` reaches NEITHER: Weakness and Resistance are printed
    // card PROPERTIES, not "effects on" a Pokémon. This is the negative that keeps
    // the widest sentence from swallowing the other two.
    expect(dealt(wt(), IDX.effects)).toBe(90);
  });
});

describe("§8.5 — what 'any effects on your opponent's Active Pokémon' reaches", () => {
  it("the PRE-W/R aura whose source IS the opponent's Active (Entei 'Pressure')", () => {
    const entei = () => board("fix-suppressor", "sv03-030");
    expect(row(entei(), IDX.control)).toMatchObject({ dealt: 40, debuff: 20 });
    expect(dealt(entei(), IDX.effects)).toBe(60);
    expect(row(entei(), IDX.effects)?.debuff).toBeUndefined();
    // …and the sentence that does NOT name effects leaves the aura alone.
    expect(dealt(entei(), IDX.resistance)).toBe(40);
    expect(dealt(entei(), IDX.wr)).toBe(40);
    expect(dealt(entei(), IDX.wrEffects)).toBe(60);
  });

  it("an ON-TARGET PREVENTION (Dachsbun's {R} filter) — nulled, damage lands", () => {
    // The prevention arm: `preventDamageFromTypes` is a catalog aura on the damaged
    // body, so the clause reaches it and a Fire attacker gets through.
    const dachs = () => board("fix-suppressor", "sv01-099");
    expect(row(dachs(), IDX.control)).toMatchObject({ dealt: 0, prevented: true });
    expect(dealt(dachs(), IDX.effects)).toBe(60);
    expect(row(dachs(), IDX.effects)?.prevented).toBeUndefined();
    expect(dealt(dachs(), IDX.wrEffects)).toBe(60);
    // …and the two sentences that do NOT name effects leave the prevention up.
    expect(row(dachs(), IDX.resistance)).toMatchObject({ dealt: 0, prevented: true });
    expect(row(dachs(), IDX.wr)).toMatchObject({ dealt: 0, prevented: true });
  });

  it("the SEAT-WIDE aura SPLITS rather than nulls — D161's reading, inherited", () => {
    const self = () => board("fix-suppressor", "sv02-113");
    expect(row(self(), IDX.control)).toMatchObject({ dealt: 50, reduction: 10 });
    expect(dealt(self(), IDX.effects)).toBe(60);

    const teammate = () => benchFromDeck(board("fix-suppressor", "fix-bigbody"), "p2", "sv02-113");
    expect(row(teammate(), IDX.control)).toMatchObject({ dealt: 50, reduction: 10 });
    expect(row(teammate(), IDX.effects)).toMatchObject({ dealt: 50, reduction: 10 });
  });

  it("a STADIUM's prevention SURVIVES the clause — the OFF-TARGET half, driven", () => {
    const zone = withStadium(board("fix-azureseas", "fix-suppresswall"));
    expect(row(zone, 0)).toMatchObject({ dealt: 0, prevented: true });
    // …and the control on the same board, so the 0 is the Stadium and not the
    // suppression having gone missing: without the Stadium the same declaration
    // reads 120.
    expect(dealt(board("fix-azureseas", "fix-suppresswall"), 0)).toBe(120);
  });

  it("the ATTACKER's OWN installed pre-W/R debuff is NOT nulled", () => {
    const stamped = withInstalledDebuff(board("fix-suppressor", "fix-bigbody"), 20);
    expect(row(stamped, IDX.control)).toMatchObject({ dealt: 40, debuff: 20 });
    expect(row(stamped, IDX.effects)).toMatchObject({ dealt: 40, debuff: 20 });
    // …and on a board carrying BOTH sources the clause takes exactly one of them:
    // Entei's aura (source = the opponent's Active) goes, the stamp stays.
    const both = withInstalledDebuff(board("fix-suppressor", "sv03-030"), 20);
    expect(row(both, IDX.control)).toMatchObject({ dealt: 20, debuff: 40 });
    expect(row(both, IDX.effects)).toMatchObject({ dealt: 40, debuff: 20 });
  });

  it("the OFF-TARGET pair stays OUTSIDE the guard — D159's grouping, verbatim", () => {
    const plain = board("fix-suppressor", "fix-bigbody");
    for (const index of Object.values(IDX)) {
      expect(row(plain, index)?.prevented).toBeUndefined();
      expect(dealt(plain, index)).toBe(60);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shared read site.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ability half and the attack half SHARE the read site", () => {
  it("an empty-text attack from an 'Azure Seas' body reads the SAME numbers", () => {
    const pairs: [string, number][] = [
      ["fix-suppresswall", 120],
      ["sv03-030", 60],
      ["sv01-099", 60],
      ["sv02-113", 60],
      ["fix-weak-tough", 90],
      ["fix-resistwall", 30],
    ];
    for (const [defender, expected] of pairs) {
      expect(dealt(board("fix-azureseas", defender), 0), defender).toBe(expected);
      expect(dealt(board("fix-suppressor", defender), IDX.effects), defender).toBe(expected);
    }
  });

  it("…but NOT the storage: a §9 lock kills the ability half and not the attack half", () => {
    const locked = (attacker: string) =>
      benchFromDeck(board(attacker, "fix-suppresswall"), "p1", "sv02-089");
    expect(dealt(locked("fix-azureseas"), 0)).toBe(90);
    expect(dealt(locked("fix-suppressor"), IDX.effects)).toBe(120);
    // The control on the same locked board, so the 90 above is the lock and not
    // some other thing this board does.
    expect(dealt(locked("fix-suppressor"), IDX.control)).toBe(90);
  });

  it("the ability rides `passivesOf`, so it travels with the body and needs no stamp", () => {
    // Nothing is written to `InPlayPokemon`: the same fixture read twice on two
    // freshly built boards gives the same answer, and no state field carries it.
    const first = board("fix-azureseas", "fix-suppresswall");
    expect(dealt(first, 0)).toBe(120);
    expect(dealt(board("fix-azureseas", "fix-suppresswall"), 0)).toBe(120);
    expect(first.players.p1.active).not.toHaveProperty("suppressTargetEffectsOnAttack");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures, whole.
// ─────────────────────────────────────────────────────────────────────────────

describe("the authored fixtures", () => {
  it("carry `fix-suppressor`'s WHOLE attack list, indices and printed text", () => {
    expect(FIXTURE_POOL["fix-suppressor"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Shred", damage: 60, effect: S_EFFECTS },
      { cost: ["Colorless"], name: "Rock Hurl", damage: 60, effect: S_RESISTANCE },
      { cost: ["Colorless"], name: "Demolish", damage: 60, effect: S_WR_EFFECTS },
      { cost: ["Colorless"], name: "Yoga Kick", damage: 60, effect: S_WR },
      { cost: ["Colorless"], name: "Tackle", damage: 60 },
      { cost: ["Colorless"], name: "Probe Cut", damage: "60+", effect: S_RESISTANCE },
    ]);
    expect(FIXTURE_POOL["fix-suppressor"]?.types).toEqual(["Fire"]);
  });

  it("carry the two synthetic walls' modifiers and their registry rows", () => {
    expect(FIXTURE_POOL["fix-suppresswall"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-suppresswall"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-resistwall"]?.resistances).toEqual([{ type: "Fire", value: "-30" }]);
    expect(FIXTURE_POOL["fix-resistwall"]?.weaknesses).toBeNull();
    for (const id of ["fix-suppresswall", "fix-resistwall"] as const) {
      expect(programFor(id)?.passive).toEqual({ damageReductionAfterWR: 30 });
    }
  });

  it("the index-5 PROBE stays LOUD: the clause explains no `+` MODIFIER", () => {
    const skipped = find(
      swing(board("fix-suppressor", "fix-bigbody"), PROBE).events,
      "ATTACK_EFFECT_SKIPPED",
    );
    expect(skipped).toMatchObject({ attack: "Probe Cut", damageModifier: "+" });
    // …and the sentence is still READ: the Resistance suppression really fires on
    // the same declaration, so this is a modifier the shape cannot explain and not
    // a sentence it cannot parse.
    expect(dealt(board("fix-suppressor", "fix-resistwall"), PROBE)).toBe(30);
  });

  it("emit NO ATTACK_EFFECT_SKIPPED — all five declarations are simulated", () => {
    const state = board("fix-suppressor", "fix-suppresswall");
    for (const index of Object.values(IDX)) {
      expect(find(swing(state, index).events, "ATTACK_EFFECT_SKIPPED"), `${index}`).toBeUndefined();
    }
    expect(
      find(swing(board("fix-azureseas", "fix-suppresswall"), 0).events, "ATTACK_EFFECT_SKIPPED"),
    ).toBeUndefined();
  });
});
