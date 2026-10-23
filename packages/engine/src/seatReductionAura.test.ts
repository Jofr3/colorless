import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { seatDamageReduction } from "./continuous";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  must,
  driveSetup,
} from "./testFixtures";

const CARBINK = "sv10-086";
const BOUFFALANT = "sv07-119";
const BOUFFALANT_REPRINT = "svp-136";
const HARIYAMA = "sv02-113";

/** A Steven's-prefixed teammate that prints NO Ability — so every "the aura paid
    it" line below is about the Carbink's sentence and not about its own. */
const STEVEN_ALLY = "fix-steven-ally";
/** The beneficiary CONTROL: identical in every field the scan reads EXCEPT the
    owner prefix. Without it, a build that dropped `beneficiary` entirely would be
    green on every board in this file. */
const PLAIN_ALLY = "fix-plain-ally";
/** A Basic {C} body — Curly Wall's beneficiary — and its STAGE control, a
    Stage 1 that is {C} and therefore outside the printed noun. */
const C_BASIC = "fix-c-basic";
const C_EVO = "fix-c-evo";
/** A Basic body that is NOT {C}: the TYPE control, the other half of
    `typedPokemon`'s two conjuncts. */
const M_BASIC = "fix-m-basic";
/** A body that is BOTH a Steven's Pokémon AND a Basic {C} Pokémon — the only way
    to put one defender inside BOTH beneficiary sets at once, which is what the
    two-different-caps board in §4 needs. */
const STEVEN_C_BASIC = "fix-steven-c-basic";
const WEAK_BASIC = "fix-weak-basic";
const HITTER = "fix-hitter";
const KLEFKI = "sv01-096";
const F_HITTER = "fix-f-hitter";

const FLAT = { name: "Flat Hit", cost: ["Colorless"], damage: 100 };

const LOCAL_CARDS: Record<string, Card> = {
  [CARBINK]: battler(CARBINK, {
    name: "Steven's Carbink",
    hp: 80,
    retreat: 2,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Stone Palace",
        effect:
          "As long as this Pokémon is on your Bench, all of your Steven's Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Stone Palace doesn't stack.",
      },
    ],
  }),
  [BOUFFALANT]: bouffalant(BOUFFALANT),
  [BOUFFALANT_REPRINT]: bouffalant(BOUFFALANT_REPRINT),
  [HARIYAMA]: battler(HARIYAMA, {
    name: "Hariyama",
    hp: 140,
    retreat: 3,
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Makuhita",
    abilities: [
      {
        type: "Ability",
        name: "Arm Thrust Practice",
        effect:
          "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
      },
    ],
  }),
  [STEVEN_ALLY]: battler(STEVEN_ALLY, { name: "Steven's Beldum", hp: 200, types: ["Metal"] }),
  [PLAIN_ALLY]: battler(PLAIN_ALLY, { name: "Beldum", hp: 200, types: ["Metal"] }),
  [C_BASIC]: battler(C_BASIC, { name: "Plain Bull", hp: 200, types: ["Colorless"] }),
  [C_EVO]: battler(C_EVO, {
    name: "Plain Bull Evolved",
    hp: 200,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Plain Bull",
  }),
  [M_BASIC]: battler(M_BASIC, { name: "Plain Steel", hp: 200, types: ["Metal"] }),
  [STEVEN_C_BASIC]: battler(STEVEN_C_BASIC, {
    name: "Steven's Bull",
    hp: 200,
    types: ["Colorless"],
  }),
  [WEAK_BASIC]: battler(WEAK_BASIC, {
    name: "Brittle Bull",
    hp: 300,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),
  [HITTER]: battler(HITTER, { name: "Flat Hitter", hp: 200, attacks: [FLAT] }),
  [F_HITTER]: battler(F_HITTER, {
    name: "Fighting Hitter",
    hp: 200,
    types: ["Fighting"],
    attacks: [{ ...FLAT }],
  }),
};

function bouffalant(id: string): Card {
  return battler(id, {
    name: "Bouffalant",
    hp: 100,
    retreat: 2,
    types: ["Colorless"],
    abilities: [
      {
        type: "Ability",
        name: "Curly Wall",
        effect:
          "As long as you have at least 1 other Bouffalant in play, all of your Basic {C} Pokémon take 60 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Curly Wall doesn't stack.",
      },
    ],
  });
}

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const AURA_DECK = deckOf({
  [CARBINK]: 4,
  [BOUFFALANT]: 3,
  [BOUFFALANT_REPRINT]: 4,
  [HARIYAMA]: 3,
  [STEVEN_ALLY]: 3,
  [PLAIN_ALLY]: 3,
  [C_BASIC]: 3,
  [C_EVO]: 3,
  [M_BASIC]: 3,
  [STEVEN_C_BASIC]: 3,
  [WEAK_BASIC]: 3,
  [KLEFKI]: 3,
  [HITTER]: 3,
  [F_HITTER]: 4,
  "fix-basic-1": 5,
  "fix-energy": 10,
});

const SEEDS = [7101, 7103, 7109] as const;

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: AURA_DECK, p2: AURA_DECK }, { pool: POOL, first: "p2" });
}

function board(
  seed: number,
  defender: string,
  p1Bench: readonly string[],
  attacker: string = HITTER,
  p1Active: string = defender,
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", p1Active), "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  if (p1Bench.length === 0) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = clearBench(setActiveFromDeck(state, "p2", attacker), "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p2" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return attachFromDeck(state, "p2", "fix-energy", 1);
}

/** The damage P1's Active actually TAKES, off a real declaration. Every attacker
    in this cast prints a flat 100, so the delta from 100 (or from 200 on the
    weakness board) IS the aura. */
function dealt(state: GameState): number {
  const hit = must(applyAction(state, { type: "attack", seat: "p2", index: 0 }));
  const damage = hit.players.p1.active?.damage;
  if (damage === undefined) throw new Error("p1 has no Active after the attack");
  return damage;
}

function events(state: GameState): GameEvent[] {
  const result = applyAction(state, { type: "attack", seat: "p2", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code}`);
  return result.events;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §1 — the three registry rows", () => {
  it("Stone Palace authors THREE riders and deliberately not the fourth", () => {
    expect(programFor(CARBINK)?.passive).toEqual({
      seatDamageReductionAfterWR: {
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Steven" },
        sourceOnBench: true,
        noStack: "Stone Palace",
      },
    });
    expect(programFor(CARBINK)?.passive?.damageReductionAfterWR).toBeUndefined();
    expect(programFor(CARBINK)?.abilities).toBeUndefined();
    expect(programFor(CARBINK)?.attack).toBeUndefined();
  });

  it("Curly Wall authors the OTHER three, and both printings share ONE object", () => {
    for (const id of [BOUFFALANT, BOUFFALANT_REPRINT]) {
      expect(programFor(id)?.passive?.seatDamageReductionAfterWR).toEqual({
        amount: 60,
        beneficiary: { kind: "typedPokemon", pokemonType: "Colorless", stage: "basic" },
        otherNamedInPlay: "Bouffalant",
        noStack: "Curly Wall",
      });
    }
    // The reprint is the SAME program object, not a copy — D190b's exact-map rule.
    expect(programFor(BOUFFALANT)).toBe(programFor(BOUFFALANT_REPRINT));
  });

  it("Hariyama is STILL the bare amount, which is what makes it a control", () => {
    expect(programFor(HARIYAMA)?.passive).toEqual({
      seatDamageReductionAfterWR: { amount: 10 },
    });
    const bare = programFor(HARIYAMA)?.passive?.seatDamageReductionAfterWR;
    expect(bare?.beneficiary).toBeUndefined();
    expect(bare?.sourceOnBench).toBeUndefined();
    expect(bare?.otherNamedInPlay).toBeUndefined();
    expect(bare?.noStack).toBeUndefined();
  });

  it("the OTHER four bench-source printings are still unbuilt HERE, and three are BUILT elsewhere", () => {
    expect(programFor("sv08-107")?.passive?.seatDamageReductionAfterWR).toBeUndefined();
    expect(programFor("sv08-107")?.passive?.disableAbilities).toEqual({
      side: "both",
      stage: "Stage2",
      sourceOnBench: true,
      targetZone: "bench",
    });
    expect(programFor("sv09-089")?.passive?.seatDamageReductionAfterWR).toBeUndefined();
    expect(programFor("sv09-089")?.passive?.ownActiveRetreatDiscount).toEqual({
      amount: 2,
      sourceOnBench: true,
    });
    expect(programFor(CARBINK)?.passive?.seatDamageReductionAfterWR?.sourceOnBench).toBe(true);
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy).toBeUndefined();
      expect(programFor(id)?.passive?.seatDamageReductionAfterWR).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. STONE PALACE — the source zone, the beneficiary, and the cap.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §2 — Stone Palace", () => {
  it.each(SEEDS)("a BENCHED Carbink shields a Steven's Active: 100 → 70 (seed %i)", (seed) => {
    expect(dealt(board(seed, STEVEN_ALLY, [CARBINK]))).toBe(70);
  });

  it.each(SEEDS)("…and the SAME board with no Carbink takes the full 100 (seed %i)", (seed) => {
    expect(dealt(board(seed, STEVEN_ALLY, ["fix-basic-1"]))).toBe(100);
  });

  it.each(SEEDS)("an ACTIVE Carbink shields NOBODY — the source-zone gate (seed %i)", (seed) => {
    const benchedSource = board(seed, STEVEN_ALLY, [CARBINK]);
    const shielded = benchedSource.players.p1.active;
    if (shielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(benchedSource, shielded, "all", "p2")).toBe(30);

    const activeSource = board(seed, STEVEN_ALLY, [STEVEN_ALLY], HITTER, CARBINK);
    const ally = activeSource.players.p1.bench[0];
    if (ally === undefined) throw new Error("expected a benched Steven's ally");
    expect(seatDamageReduction(activeSource, ally, "all", "p2")).toBe(0);
  });

  it.each(SEEDS)(
    "a NON-Steven's ally is not shielded — the beneficiary clause (seed %i)",
    (seed) => {
      // `fix-plain-ally` differs from `fix-steven-ally` in the NAME PREFIX and in
      // nothing else the scan reads. Without this line a build that dropped
      // `beneficiary` would be green on every other board in this section.
      expect(dealt(board(seed, PLAIN_ALLY, [CARBINK]))).toBe(100);
    },
  );

  it.each(SEEDS)("TWO benched Carbink still shield 30, not 60 — the cap (seed %i)", (seed) => {
    // "The effect of Stone Palace doesn't stack." A summing scan pays 60 here and
    // this is the only board in the file that can see the difference.
    expect(dealt(board(seed, STEVEN_ALLY, [CARBINK, CARBINK]))).toBe(70);
  });

  it("a benched Carbink shields ITSELF — self-inclusive, and `scope` is what splits it", () => {
    const state = board(SEEDS[0], STEVEN_ALLY, [CARBINK]);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected a benched Carbink");
    expect(seatDamageReduction(state, benched, "all", "p2")).toBe(30);
    expect(seatDamageReduction(state, benched, "othersOnly", "p2")).toBe(0);
    // …and a TEAMMATE keeps the shield under the same `ignoreWR` declaration,
    // which is the half that makes `scope` a per-BOARD answer and not a per-site
    // one.
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(state, active, "othersOnly", "p2")).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CURLY WALL — the self-excluding partner clause, and its cap.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §3 — Curly Wall", () => {
  it.each(SEEDS)("ONE Bouffalant in play pays NOTHING (seed %i)", (seed) => {
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT]))).toBe(100);
  });

  it.each(SEEDS)("TWO Bouffalant pay 60, not 120 — both riders at once (seed %i)", (seed) => {
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(40);
  });

  it.each(SEEDS)("…and the two printings are interchangeable in the pair (seed %i)", (seed) => {
    // Both ids print the same NAME, so the partner clause is satisfied by either
    // combination — a build that compared card IDS rather than printed names
    // would be green on the reprint pair above and red here.
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT_REPRINT, BOUFFALANT_REPRINT]))).toBe(40);
  });

  it.each(SEEDS)(
    "an EVOLUTION {C} body is not shielded — the `stage` conjunct (seed %i)",
    (seed) => {
      expect(dealt(board(seed, C_EVO, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(100);
    },
  );

  it.each(SEEDS)(
    "a Basic that is NOT {C} is not shielded — the type conjunct (seed %i)",
    (seed) => {
      expect(dealt(board(seed, M_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(100);
    },
  );

  it("a Bouffalant shields ITSELF once the partner is there — and neither one twice", () => {
    const state = board(SEEDS[0], C_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]);
    const first = state.players.p1.bench[0];
    if (first === undefined) throw new Error("expected a benched Bouffalant");
    expect(seatDamageReduction(state, first, "all", "p2")).toBe(60);
    expect(seatDamageReduction(state, first, "othersOnly", "p2")).toBe(60);
  });
});

describe("D321 §4 — the field", () => {
  it.each(SEEDS)("the reduction lands AFTER Weakness: 100 ×2 − 60 = 140 (seed %i)", (seed) => {
    // The printed "(after applying Weakness and Resistance)", and the only board
    // in this file where "before" and "after" give different answers: before
    // would be (100 − 60) × 2 = 80.
    expect(dealt(board(seed, WEAK_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT], F_HITTER))).toBe(140);
  });

  it.each(SEEDS)("the aura never crosses the seat boundary (seed %i)", (seed) => {
    // The Carbink is on the ATTACKER's bench and the defender is a Steven's
    // Pokémon on the other side. The scan returns for the side that HOLDS the
    // damaged body, so the far bench is not consulted at all.
    let state = board(seed, STEVEN_ALLY, ["fix-basic-1"]);
    state = benchFromDeck(state, "p2", CARBINK);
    expect(dealt(state)).toBe(100);
  });

  it("two DIFFERENT non-stacking auras on one board each pay once — 30 + 60 = 90", () => {
    const state = board(
      SEEDS[0],
      STEVEN_ALLY,
      [CARBINK, BOUFFALANT, BOUFFALANT_REPRINT],
      HITTER,
      STEVEN_C_BASIC,
    );
    expect(dealt(state)).toBe(10);
  });

  it.each(SEEDS)("a §9 Ability-lock silences the SOURCE and the aura stops (seed %i)", (seed) => {
    const state = board(seed, STEVEN_ALLY, [CARBINK]);
    const shielded = state.players.p1.active;
    if (shielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(state, shielded, "all", "p2")).toBe(30);
    const locked = setActiveFromDeck(state, "p2", KLEFKI);
    const stillShielded = locked.players.p1.active;
    if (stillShielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(locked, stillShielded, "all", "p2")).toBe(0);
  });

  it("B19 (was DEBT D558) — the ABILITY aura reads `attackerSeat`: an OWN-side hit is NOT shielded", () => {
    const state = board(SEEDS[0], STEVEN_ALLY, [CARBINK]);
    const shielded = state.players.p1.active;
    if (shielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(state, shielded, "all", "p1")).toBe(0);
    expect(seatDamageReduction(state, shielded, "all", "p2")).toBe(30);
  });

  it.each(SEEDS)(
    "the damage EVENT reports the reduced number, not the printed one (seed %i)",
    (seed) => {
      const dealtEvent = events(board(seed, STEVEN_ALLY, [CARBINK])).find(
        (e) => e.type === "DAMAGE_DEALT",
      );
      expect(dealtEvent?.type).toBe("DAMAGE_DEALT");
      if (dealtEvent?.type !== "DAMAGE_DEALT") throw new Error("expected DAMAGE_DEALT");
      expect(dealtEvent.base).toBe(100);
      expect(dealtEvent.dealt).toBe(70);
    },
  );
});
