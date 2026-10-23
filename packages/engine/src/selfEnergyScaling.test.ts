import { describe, expect, it } from "vitest";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
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
} from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_DECK,
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

const POWER_DRAW = "This attack does 50 more damage for each Energy attached to this Pokémon.";
const FLARE_DRAW = "This attack does 80 more damage for each {R} Energy attached to this Pokémon.";
const OVERFLOW = "This attack does 30 damage for each Energy attached to this Pokémon.";
const BASIC_DRAW = "This attack does 40 damage for each Basic Energy attached to this Pokémon.";
const SPECIAL_DRAW =
  "This attack does 70 damage for each Special Energy card attached to this Pokémon.";
const ATTACH_THEN_DRAW =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
/** Entei sv03-030 "Blaze Ball" — the real card that used to be the unsimulated-"+"
    witness and is now this member's only REAL-CARD positive case. */
const BLAZE_BALL = "This attack does 20 more damage for each {R} Energy attached to this Pokémon.";

const TWIN_SURGE =
  "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
const TWIN_BLAST = "This attack does 30 damage for each Energy attached to both Active Pokémon.";
const TWIN_FLIP =
  "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.";

/** Pachirisu sv01-068 "Everyone Discharge" — the RE-HOMED unsimulated-"+" witness,
    and its two halves taken apart. */
const EVERYONE_DISCHARGE =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
const EVERYONE_DISCHARGE_COUNT_HALF =
  "This attack does 20 more damage for each of your Benched {L} Pokémon.";
const EVERYONE_DISCHARGE_SUPPRESS_HALF = "This attack's damage isn't affected by Weakness.";

const SNIPE_SCALE =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const COIN_PER_ENERGY =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";

const SEED = 5;

/** The attack indices, keyed by name so no case addresses a fold by number. */
const SELF = { power: 0, flare: 1, overflow: 2, basic: 3, special: 4 } as const;
const TWIN = { surge: 0, blast: 1, flip: 2 } as const;
const OPP = { drain: 0, siphon: 1, field: 2, flare: 3 } as const;
const BENCH = { herd: 0, crowd: 1, flank: 2 } as const;

function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: SELF_ENERGY_DECK, p2: SELF_ENERGY_DECK }, { first: opener }),
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

function dealt(events: GameEvent[]): number | null {
  return findEvent(events, "DAMAGE_DEALT")?.dealt ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixture pool — a SEPARATE population, swept BEFORE anything was written.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, and this time it was NOT empty", () => {
  it("FOUND EXACTLY ONE REUSE, AND IT IS THE LOAD-BEARING NEGATIVE (sv03-030)", () => {
    const mine = new Set(["fix-selfenergy", "fix-bothactives"]);
    const sentences = [
      POWER_DRAW,
      FLARE_DRAW,
      OVERFLOW,
      BASIC_DRAW,
      ATTACH_THEN_DRAW,
      BLAZE_BALL,
      TWIN_SURGE,
      TWIN_BLAST,
      TWIN_FLIP,
    ];
    const carriers = Object.entries(FIXTURE_POOL).filter(
      ([id, card]) =>
        !mine.has(id) && (card.attacks ?? []).some((a) => sentences.includes(a.effect ?? "")),
    );
    expect(carriers.map(([id]) => id)).toEqual(["sv03-030", "fix-tideattach"]);
    expect(FIXTURE_POOL["sv03-030"]?.attacks?.[0]?.effect).toBe(BLAZE_BALL);
    // The BOTH-ACTIVES member found the empty pool the other five slices did: no
    // fixture printed any of its three sentences before this one.
    const twins = [TWIN_SURGE, TWIN_BLAST, TWIN_FLIP];
    const twinCarriers = Object.entries(FIXTURE_POOL).filter(
      ([id, card]) =>
        !mine.has(id) && (card.attacks ?? []).some((a) => twins.includes(a.effect ?? "")),
    );
    expect(twinCarriers.map(([id]) => id)).toEqual([]);
  });

  it("carries `fix-selfenergy`'s WHOLE attack list, indices and printed markers", () => {
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Power Draw", effect: POWER_DRAW, damage: "30+" },
      { cost: ["Colorless"], name: "Flare Draw", effect: FLARE_DRAW, damage: "40+" },
      { cost: ["Colorless"], name: "Overflow", effect: OVERFLOW, damage: "30×" },
      { cost: ["Colorless"], name: "Basic Draw", effect: BASIC_DRAW, damage: "40×" },
      { cost: ["Colorless"], name: "Special Draw", effect: SPECIAL_DRAW, damage: "70×" },
    ]);
    // Fire, because the ordering witness needs a ×2-Fire defender.
    expect(FIXTURE_POOL["fix-selfenergy"]?.types).toEqual(["Fire"]);
  });

  it("carries `fix-bothactives`' WHOLE attack list — one member and TWO refusals", () => {
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Twin Surge", effect: TWIN_SURGE, damage: "30+" },
      { cost: ["Colorless"], name: "Twin Blast", effect: TWIN_BLAST, damage: "30×" },
      { cost: ["Colorless"], name: "Twin Flip", effect: TWIN_FLIP, damage: "60×" },
    ]);
    expect(FIXTURE_POOL["fix-bothactives"]?.types).toEqual(["Fire"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The RE-HOMING — the assertion set that had to move before either member landed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the unsimulated-'+' witness, re-homed off Entei onto Pachirisu", () => {
  it("Entei's sentence changed SIGN: the reader that refused it now answers it", () => {
    // The half that used to be a null. `energyOnSelf` reads Blaze Ball with the
    // TYPE FILTER resolved — `Fire`, not `null` — so the member is not merely
    // matching the sentence but reading the `{R}` inside it.
    expect(deriveAttackDamageBonus(BLAZE_BALL)).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(BLAZE_BALL)).toBeNull();
  });

  it("Pachirisu's printing stays unread — and BOTH reasons are driven separately", () => {
    expect(deriveAttackDamageSuppression(EVERYONE_DISCHARGE)).toBeNull();
    expect(deriveAttackDamageSuppression(EVERYONE_DISCHARGE_SUPPRESS_HALF)).toBeNull();
    expect(
      deriveAttackDamageSuppression(
        "This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual({ weakness: true, resistance: true });
    expect(deriveAttackDamageBonus(EVERYONE_DISCHARGE_COUNT_HALF)).toEqual({
      per: 20,
      count: {
        kind: "yourBenchCount",
        filter: { kind: "typedPokemon", pokemonType: "Lightning" },
      },
    });
    expect(deriveAttackDamageMultiplier(EVERYONE_DISCHARGE_COUNT_HALF)).toBeNull();
    const readers = [
      deriveAttackDamageBonus,
      deriveAttackDamageMultiplier,
      deriveAttackDamagePenalty,
      deriveAttackEffect,
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDamageSuppression,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackRequirement,
      deriveAttackPreDamage,
      deriveAttackCopy,
      deriveAttackCoinFlip,
    ];
    expect(readers.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
    expect(resolvedByAnyReader(EVERYONE_DISCHARGE), EVERYONE_DISCHARGE).toBe(false);
    for (const read of readers) {
      expect(read(EVERYONE_DISCHARGE), read.name).toBeNull();
    }
    expect(FIXTURE_POOL["sv01-068"]?.attacks?.[0]?.effect).toBe(EVERYONE_DISCHARGE);
    expect(FIXTURE_POOL["sv01-208"]?.attacks?.[0]?.effect).toBe(EVERYONE_DISCHARGE);
    expect(FIXTURE_POOL["sv01-068"]?.attacks?.[0]?.damage).toBe("10+");
  });

  it("the re-homed witness is TRIPLY protected — any one reason alone suffices", () => {
    expect(EVERYONE_DISCHARGE.startsWith(EVERYONE_DISCHARGE_COUNT_HALF)).toBe(true);
    expect(EVERYONE_DISCHARGE).not.toBe(EVERYONE_DISCHARGE_COUNT_HALF);
    expect(BLAZE_BALL.split(". ").length).toBe(1);
    expect(EVERYONE_DISCHARGE.split(". ").length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The readers.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageBonus / …Multiplier — the two new members", () => {
  it("reads the ATTACKER's own Energy on BOTH folds, typed and untyped", () => {
    expect(deriveAttackDamageBonus(POWER_DRAW)).toEqual({
      per: 50,
      count: { kind: "energyOnSelf", energyType: null },
    });
    expect(deriveAttackDamageBonus(FLARE_DRAW)).toEqual({
      per: 80,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(OVERFLOW)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: null },
    });
    // The `per` is CAPTURED, not hard-coded — three different amounts on one
    // sentence shape, which is what makes every damage assertion below a claim
    // about the capture.
    expect(deriveAttackDamageBonus(POWER_DRAW.replace("50 more", "10 more"))?.per).toBe(10);
    expect(deriveAttackDamageMultiplier(OVERFLOW.replace("30 damage", "50 damage"))?.per).toBe(50);
  });

  it("tells 'no filter' from 'a filter I could not read' — `null` vs LOUD", () => {
    expect(deriveAttackDamageMultiplier(OVERFLOW)?.count).toEqual({
      kind: "energyOnSelf",
      energyType: null,
    });
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    // `{C}` is deliberately absent from the token table — Colorless is the
    // conservative provision fallback for unauthored Special Energy, so a `{C}`
    // clause would quietly match cards nobody meant.
    expect(
      deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each {C} Energy")),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each Fancy Energy")),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each Special Energy")),
    ).toEqual({ per: 50, count: { kind: "energyOnSelf", energyType: "special" } });
    expect(deriveAttackDamageBonus(FLARE_DRAW.replace("{R}", "Water"))).toEqual({
      per: 80,
      count: { kind: "energyOnSelf", energyType: "Water" },
    });
  });

  it("reads BOTH Actives on the additive fold only", () => {
    expect(deriveAttackDamageBonus(TWIN_SURGE)).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
    expect(deriveAttackDamageMultiplier(TWIN_SURGE)).toBeNull();
  });

  it("PINS THE ABSENCE: `bothActivesEnergyCount` is ADD-only by LEGALITY", () => {
    expect(deriveAttackDamageMultiplier(TWIN_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(TWIN_BLAST)).toBeNull();
    expect(
      deriveAttackDamagePenalty(TWIN_SURGE.replace(" more damage", " less damage")),
    ).toBeNull();
    // The twin is a real string the fixture prints, not one this test constructed.
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[TWIN.blast]?.effect).toBe(TWIN_BLAST);
  });

  it("PINS THE ABSENCE: no TYPE FILTER on the both-Actives sentence", () => {
    expect(
      deriveAttackDamageBonus(TWIN_SURGE.replace("each Energy", "each {R} Energy")),
    ).toBeNull();
    expect(deriveAttackDamageBonus(TWIN_SURGE)?.count).toEqual({
      kind: "bothActivesEnergyCount",
    });
  });

  it("refuses the near-misses by the anchors alone — leading text, lowercase, no period", () => {
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
      expect(read(`Flip a coin. If heads, ${sentence.toLowerCase()}`)).toBeNull();
      expect(read(sentence.replace(/^This/, "this"))).toBeNull();
      expect(read(sentence.slice(0, -1))).toBeNull();
      expect(read(`${sentence} Then, shuffle your deck.`)).toBeNull();
    }
  });

  it("the greedy `(.+)` cannot swallow a leading sentence into the type token", () => {
    expect(deriveAttackDamageMultiplier(`Draw a card. ${OVERFLOW}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Draw a card. ${POWER_DRAW}`)).toBeNull();
    expect(deriveAttackDamageMultiplier(ATTACH_THEN_DRAW)).toBeNull();
    expect(deriveAttackDamageBonus(ATTACH_THEN_DRAW)).toBeNull();
    expect(ATTACH_THEN_DRAW.split(". ").length).toBe(2);
    expect(deriveAttackDiscardScaledBoost(ATTACH_THEN_DRAW)).toEqual({
      kind: "selfHandAttach",
      per: 30,
      energyType: "Water",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The evaluator, on boards where every member gives a DIFFERENT number.
// ─────────────────────────────────────────────────────────────────────────────

function mirrorBoard(attacker: string): GameState {
  let state = board(attacker, "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
  state = attachFromDeck(state, "p1", "fix-water-energy", 1);
  state = attachFromDeck(state, "p2", "fix-water-energy", 5);
  state = withBench(state, "p2", 1);
  state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", 2);
  state = withBench(state, "p1", 5);
  return attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
}

describe("scaledAttackDamage — the MIRROR board, where all seven answers differ", () => {
  it("counts the ATTACKER's own Energy, untyped: 3 × 50 onto a printed 30", () => {
    expect(dealt(swing(mirrorBoard("fix-selfenergy"), SELF.power).events)).toBe(30 + 3 * 50);
  });

  it("counts the ATTACKER's own {R} Energy only: 2, not the 3 it holds", () => {
    expect(dealt(swing(mirrorBoard("fix-selfenergy"), SELF.flare).events)).toBe(40 + 2 * 80);
  });

  it("counts BOTH Actives: 3 mine + 5 theirs = 8 × 30 onto a printed 30", () => {
    expect(dealt(swing(mirrorBoard("fix-bothactives"), TWIN.surge).events)).toBe(30 + 8 * 30);
  });

  it("the MIRROR: D193's four opponent-side answers on the SAME board", () => {
    const opp = mirrorBoard("fix-oppenergy");
    expect(dealt(swing(opp, OPP.drain).events)).toBe(30 + 5 * 30); // active zone: 5
    expect(dealt(swing(opp, OPP.siphon).events)).toBe(5 * 20); // active zone, × fold
    expect(dealt(swing(opp, OPP.field).events)).toBe(7 * 60); // board zone: 5 + 2
    const bodies = mirrorBoard("fix-benchcount");
    expect(dealt(swing(bodies, BENCH.crowd).events)).toBe(20 + 1 * 20); // their Bench: 1 BODY
    expect(dealt(swing(bodies, BENCH.herd).events)).toBe(20 + 6 * 20); // both Benches: 5 + 1
  });

  it("counts ONE BODY, not the attacker's side — 3 and 2, never 4 and 3", () => {
    const state = mirrorBoard("fix-selfenergy");
    expect(state.players.p1.active?.energy).toHaveLength(3);
    expect(state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 3 * 50);
    expect(dealt(swing(state, SELF.power).events)).not.toBe(30 + 4 * 50);
    expect(dealt(swing(state, SELF.flare).events)).toBe(40 + 2 * 80);
    expect(dealt(swing(state, SELF.flare).events)).not.toBe(40 + 3 * 80);
  });

  it("counts CARDS, not units — and delegates rather than re-deriving", () => {
    const state = mirrorBoard("fix-selfenergy");
    expect(state.players.p1.active?.energy).toHaveLength(3);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 3 * 50);
  });

  it("an attacker holding ONLY its cost still counts it — 1, never 0", () => {
    // The degenerate end. The Energy that PAYS is attached, so it COUNTS; a member
    // that subtracted the cost would give 0 here and a plausible-looking one.
    let state = board("fix-selfenergy", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 1 * 50);
    // …and with the defender bare, BOTH Actives is that same 1.
    let twin = board("fix-bothactives", "fix-titan");
    twin = attachFromDeck(twin, "p1", "fix-energy", 1);
    expect(dealt(swing(twin, TWIN.surge).events)).toBe(30 + 1 * 30);
  });

  it("the `×` fold DROPS the printed base — 3 × 30 is 90, not 120", () => {
    const state = mirrorBoard("fix-selfenergy");
    const row = findEvent(swing(state, SELF.overflow).events, "DAMAGE_DEALT");
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.overflow]?.damage).toBe("30×");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(90);
    expect(row?.dealt).toBe(90);
  });

  it("D500 — the CATEGORY filter FOLDS on a real board, and this board cannot prove it right", () => {
    const state = mirrorBoard("fix-selfenergy");
    const { events } = swing(state, SELF.basic);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(120);
    expect(row?.dealt).toBe(120);
    expect(row?.dealt).not.toBe(40);
  });

  it("the printed refusal on `fix-bothactives` stays LOUD on a real board — and D475's does NOT", () => {
    const state = mirrorBoard("fix-bothactives");
    expect(findEvent(swing(state, TWIN.blast).events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Twin Blast",
    });
    const flipped = swing(state, TWIN.flip);
    expect(findEvent(flipped.events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(flipped.events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(8);
  });
});

describe("the FOLD's position in §8.5 — pre-W/R, witnessed and pinned", () => {
  it("the ADDITIVE fold runs BEFORE Weakness: (30 + 50) × 2 = 160, not 30 × 2 + 50", () => {
    let state = board("fix-selfenergy", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    const row = findEvent(swing(state, SELF.power).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.scaled).toBe(50);
    expect(row?.dealt).toBe(160);
    expect(row?.dealt).not.toBe(110);
  });

  it("BOTH Actives folds pre-W/R too: (30 + 2 × 30) × 2 = 180, not 30 × 2 + 60", () => {
    // The same witness on the member whose count spans the table — and here the
    // DEFENDER contributes to the very number that is then doubled by its own
    // Weakness, which is a shape no other member in this family has.
    let state = board("fix-bothactives", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = attachFromDeck(state, "p2", "fix-water-energy", 1);
    const row = findEvent(swing(state, TWIN.surge).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.scaled).toBe(60);
    expect(row?.dealt).toBe(180);
    expect(row?.dealt).not.toBe(120);
  });

  it("PINS THE ABSENCE: the `×` fold has ONE term, so NO ordering witness exists", () => {
    let state = board("fix-selfenergy", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    const row = findEvent(swing(state, SELF.overflow).events, "DAMAGE_DEALT");
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.overflow]?.damage).toBe("30×");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(60);
    expect(row?.dealt).toBe(120); // × 2 Weakness, applied to the one term
  });

  it("PINS THE ABSENCE: 'the DECLARATION snapshot' is unobservable for ENERGY", () => {
    const before = mirrorBoard("fix-selfenergy");
    const after = swing(before, SELF.power).state;
    expect(after.players.p1.active?.energy).toEqual(before.players.p1.active?.energy);
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
    }
  });

  it("PINS THE ABSENCE: no BUILT sentence here can mutate the resource it counts", () => {
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(sentence.split(". ").length).toBe(1);
    }
    expect(deriveAttackDamageMultiplier(ATTACH_THEN_DRAW)).toBeNull();
    expect(ATTACH_THEN_DRAW).toContain("Before doing damage, you may attach");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rows this family does NOT own.
// ─────────────────────────────────────────────────────────────────────────────

describe("the EXCLUSIONS — neighbourhoods that route elsewhere or stay loud", () => {
  it("the SNIPE scales (3 legal) stay on `damageChosen`, never on this fold", () => {
    // A CHOSEN target sits between the amount and the "for each", so `(\d+) damage
    // for each` never lines up. Both readers refuse, both spellings.
    for (const per of [20, 30]) {
      const text = SNIPE_SCALE.replace("does 20 damage", `does ${per} damage`);
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    // …and its typed sibling, which is the same shape with a spelled-out filter.
    expect(
      deriveAttackDamageMultiplier(SNIPE_SCALE.replace("each Energy", "each Grass Energy")),
    ).toBeNull();
  });

  it("D128's coin family keeps BOTH of its self-side and both-Actives rows", () => {
    expect(deriveAttackCoinFlip(COIN_PER_ENERGY)).not.toBeNull();
    expect(deriveAttackDamageBonus(COIN_PER_ENERGY)).toBeNull();
    expect(deriveAttackDamageMultiplier(COIN_PER_ENERGY)).toBeNull();
    expect(deriveAttackCoinFlip(TWIN_FLIP)).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 60,
    });
    expect(deriveAttackCoinFlip(TWIN_FLIP)).not.toEqual(deriveAttackCoinFlip(COIN_PER_ENERGY));
    expect(deriveAttackDamageBonus(TWIN_FLIP)).toBeNull();
    expect(deriveAttackDamageMultiplier(TWIN_FLIP)).toBeNull();
  });

  it("the ABILITY row that names this noun places COUNTERS and is refused", () => {
    const ability =
      "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon for each {M} Energy attached to this Pokémon.";
    expect(deriveAttackDamageBonus(ability)).toBeNull();
    expect(deriveAttackDamageMultiplier(ability)).toBeNull();
  });

  it("the D193 members did not widen — their sentences still answer only their own", () => {
    // The other direction of the mirror, at the reader rather than the evaluator:
    // `energyOnSelf` must not have loosened the opponent-side patterns into
    // answering the self-side noun, and vice versa.
    const oppActive =
      "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.";
    expect(deriveAttackDamageBonus(oppActive)?.count).toEqual({
      kind: "energyOnOpponent",
      zone: "active",
      energyType: null,
    });
    expect(deriveAttackDamageBonus(POWER_DRAW)?.count).toEqual({
      kind: "energyOnSelf",
      energyType: null,
    });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 60, count: { kind: "energyOnSelf", zone: "board", energyType: null } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      )?.count,
    ).toEqual({ kind: "energyOnSelf", zone: "board", energyType: "Grass" });
  });
});

function specialBoard(): GameState {
  let state = board("fix-selfenergy", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-special", 2);
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  return attachFromDeck(state, "p1", "fix-water-energy", 1);
}

describe("D459 — the `Energy card` spelling, on the `×` fold only", () => {
  it("the printed sentence resolves, and the `Special` filter survives the widening", () => {
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW)).toEqual({
      per: 70,
      count: { kind: "energyOnSelf", energyType: "special" },
    });
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.special]?.effect).toBe(SPECIAL_DRAW);
  });

  it("D500 — THE MINIMAL PAIR RESOLVED: two card CATEGORIES, one vocabulary", () => {
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.replace("Energy", "Energy card"))).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    expect(deriveAttackDamageBonus(BASIC_DRAW)).toBeNull();
  });

  it("PINS THE ABSENCE: the ADDITIVE twin is NOT widened, and the column is why", () => {
    const additive = SPECIAL_DRAW.replace(" damage", " more damage");
    expect(deriveAttackDamageBonus(additive)).toBeNull();
    expect(deriveAttackDamageMultiplier(additive)).toBeNull();
    // The board-wide tail is not widened either — one spelling, one fold.
    expect(
      deriveAttackDamageMultiplier(
        SPECIAL_DRAW.replace("attached to this Pokémon", "attached to all of your Pokémon"),
      ),
    ).toBeNull();
  });

  it("the optional group is a SPELLING, so the ` card`-less form still reads the same", () => {
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW.replace("Energy card", "Energy"))).toEqual({
      per: 70,
      count: { kind: "energyOnSelf", energyType: "special" },
    });
    expect(deriveAttackDamageMultiplier(OVERFLOW.replace("Energy", "Energy card"))).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: null },
    });
  });

  it("refuses the near-misses by the anchor alone — leading text, lowercase, no period", () => {
    const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
    expect(read(`Flip a coin. If heads, ${SPECIAL_DRAW.toLowerCase()}`)).toBeNull();
    expect(read(SPECIAL_DRAW.replace(/^This/, "this"))).toBeNull();
    expect(read(SPECIAL_DRAW.slice(0, -1))).toBeNull();
    expect(read(`${SPECIAL_DRAW} Then, shuffle your deck.`)).toBeNull();
    expect(read(SPECIAL_DRAW.replace("Energy card", "Energy cards"))).toBeNull();
    expect(read(SPECIAL_DRAW.replace("Energy card", "Energy Tool"))).toBeNull();
  });

  it("counts SPECIALS on a real board — 2 × 70 = 140, never 280, 70 or 0", () => {
    // The four numbers a wrong reading gives on this identical board: 280 if the
    // filter were dropped, 70 if it counted `{R}` or `{W}`, 0 if it counted a
    // category it cannot resolve. Only one of them is 140.
    const row = findEvent(swing(specialBoard(), SELF.special).events, "DAMAGE_DEALT");
    expect(row?.scaled).toBe(140);
    expect(row?.dealt).toBe(140);
    // The `×` fold drops the printed base, exactly as index 2's does.
    expect(row?.base).toBe(0);
    expect(row?.dealt).not.toBe(280);
    expect(row?.dealt).not.toBe(70);
  });

  it("D500 — THE MINIMAL PAIR ON ONE BOARD: both fold, and they COMPLEMENT", () => {
    const state = specialBoard();
    const basic = swing(state, SELF.basic).events;
    expect(findEvent(basic, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(basic, "DAMAGE_DEALT")?.scaled).toBe(80);
    const special = swing(state, SELF.special).events;
    expect(findEvent(special, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(special, "DAMAGE_DEALT")?.scaled).toBe(140);
    expect(findEvent(swing(state, SELF.overflow).events, "DAMAGE_DEALT")?.scaled).toBe(4 * 30);
  });

  it("the census sees it: the sentence LEAVES the residue by the READER arm", () => {
    expect(resolvedByAnyReader(SPECIAL_DRAW)).toBe(true);
    expect(resolvedByAnyReader(BASIC_DRAW)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The record shape, derived rather than inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the record-shape derivation, made rather than inherited", () => {
  it("`MATCH_RECORD_VERSION` STAYS 12 — and here is the derivation, not the habit", () => {
    expect(deriveAttackDamageBonus(TWIN_SURGE)).not.toBeNull();
    expect(deriveAttackEffect(TWIN_SURGE)).toBeNull(); // no op, so nothing can park
    expect(deriveAttackEffect(POWER_DRAW)).toBeNull();
    expect(deriveAttackEffect(OVERFLOW)).toBeNull();
  });

  it("D459 — `MATCH_RECORD_VERSION` STAYS 29, and this is the STRONGEST form of the argument", () => {
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW)).not.toBeNull();
    expect(deriveAttackEffect(SPECIAL_DRAW)).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Special Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "special" } });
  });
});
