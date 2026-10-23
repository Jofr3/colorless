import { describe, expect, it } from "vitest";
import { attackCostAt } from "./attack";
import { effectiveAttackCost, passivesOf, selfAttackCostDiscount } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, conditionNote, programFor, redactGame } from "./index";
import { attackBarredByAbility, conditionHolds, countOwnerPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  ROW14_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "./testFixtures";

const POWER_SAVER_TEXT =
  "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.";
const SEASONED_SKILL_TEXT =
  "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.";

const SEED = 91;

function board(): GameState {
  let state = driveSetup(SEED, { p1: ROW14_DECK, p2: ROW14_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

/** P1's Active is the gate holder; `benched` further prefixed bodies beside it. */
function gated(benched: number): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p1", "fix-powersaver"), "p1");
  for (let i = 0; i < benched; i++) state = benchFromDeck(state, "p1", "fix-tr-body");
  return state;
}

/** "Your opponent has taken N Prizes" — their pile is 6 − N (`takenPrizes`). */
function opponentTook(state: GameState, seat: Seat, taken: number): GameState {
  return setPrizes(state, seat, 6 - taken);
}

const POWER_SAVER_COND = {
  kind: "yourOwnerPokemonInPlayAtLeast",
  owner: "Team Rocket",
  count: 4,
} as const;

describe("D242 — the twelve registry rows", () => {
  const POWER_SAVER_IDS = ["svp-205", "svp-216", "sv10-081", "sv10-213", "sv10-231", "sv10-240"];
  const SEASONED_IDS = ["svp-177", "sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168"];

  it("authors all SIX Power Saver printings as one passive gate and NOTHING else", () => {
    for (const id of POWER_SAVER_IDS) {
      expect(programFor(id)).toEqual({ passive: { cantAttackUnless: POWER_SAVER_COND } });
      expect(programFor(id)?.attack).toBeUndefined();
      // …and it is not an ACTIVATED ability, which is the classification the whole
      // channel argument rests on. A `abilities` entry would put it in
      // `redactedAbilitiesOf`'s list and give the player a button to press.
      expect(programFor(id)?.abilities).toBeUndefined();
    }
    // All six share ONE object (D8's reprint rule), and it is not the sibling's.
    expect(new Set(POWER_SAVER_IDS.map((id) => programFor(id))).size).toBe(1);
    expect(programFor("svp-205")).not.toBe(programFor("svp-177"));
  });

  it("authors all SIX Seasoned Skill printings as D218's discount, at rate 1", () => {
    for (const id of SEASONED_IDS) {
      expect(programFor(id)).toEqual({
        passive: { attackCostDiscountPerOpponentPrize: 1, attackCostDiscountAttack: "Blood Moon" },
      });
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(new Set(SEASONED_IDS.map((id) => programFor(id))).size).toBe(1);
    expect(programFor("svp-177")?.passive?.attackCostDiscountPerOpponentPrize).toBe(
      programFor("swsh10.5-011")?.passive?.attackCostDiscountPerOpponentPrize,
    );
    expect(programFor("swsh10.5-011")?.passive?.attackCostDiscountAttack).toBeUndefined();
    expect(programFor("svp-177")).not.toBe(programFor("swsh10.5-011"));
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-powersaver"]?.abilities?.[0]?.effect).toBe(POWER_SAVER_TEXT);
    expect(FIXTURE_POOL["fix-seasoned"]?.abilities?.[0]?.effect).toBe(SEASONED_SKILL_TEXT);
    // The NAMES are the load-bearing field for the gate holder, and the two near
    // misses are named so that the prefix arm can go red for the right reason.
    expect(FIXTURE_POOL["fix-powersaver"]?.name).toBe("Team Rocket's Mewtwo");
    expect(FIXTURE_POOL["fix-tr-body"]?.name).toBe("Team Rocket's Meowth");
    expect(FIXTURE_POOL["fix-tr-energy"]?.name).toBe("Team Rocket's Energy");
    expect(FIXTURE_POOL["fix-not-tr-body"]?.name).toBe("Rival of Team Rocket's Meowth");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE COUNT — `countOwnerPokemonInPlay`, and the near-miss table.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — counting an owner-prefixed subgroup IN PLAY", () => {
  it("counts the holder ITSELF — the printed words are '4 or more', not '4 other'", () => {
    expect(countOwnerPokemonInPlay(gated(0), "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(gated(3), "p1", "Team Rocket")).toBe(4);
  });

  it("counts the ACTIVE SPOT and the BENCH — 'in play' is both", () => {
    let state = clearBench(board(), "p1");
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p1", "fix-tr-body");
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(3);
  });

  it("is SEAT-RELATIVE — the opponent's prefixed bodies are invisible", () => {
    let state = gated(0);
    state = setActiveFromDeck(state, "p2", "fix-powersaver");
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p2", "fix-tr-body");
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p2", "Team Rocket")).toBe(4);
  });

  it("NEAR MISS — a prefixed SPECIAL ENERGY attached to a prefixed body counts ZERO", () => {
    let state = gated(0);
    state = attachFromDeck(state, "p1", "fix-tr-energy", 3);
    expect(activeOf(state, "p1").energy.length).toBe(3);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
  });

  it("NEAR MISS — a name that CONTAINS the prefix without STARTING with it counts ZERO", () => {
    let state = gated(0);
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p1", "fix-not-tr-body");
    expect(state.players.p1.bench.length).toBe(3);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
  });

  it("NEAR MISS — the prefix is EXACT-CASE, so a lowercased owner counts ZERO", () => {
    // The `owner` string is compared exactly (`hasRuleBox`'s "Radiant " read, one
    // field over). This is the arm's own contract restated from the caller side.
    expect(countOwnerPokemonInPlay(gated(3), "p1", "team rocket")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CONDITION — one union member, one evaluator arm, one note arm.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — `yourOwnerPokemonInPlayAtLeast`", () => {
  it("is a FLOOR and not a set — 4 or more, so 5 holds too", () => {
    expect(conditionHolds(gated(2), "p1", POWER_SAVER_COND)).toBe(false);
    expect(conditionHolds(gated(3), "p1", POWER_SAVER_COND)).toBe(true);
    expect(conditionHolds(gated(4), "p1", POWER_SAVER_COND)).toBe(true);
  });

  it("round-trips to the printed clause through `conditionNote`", () => {
    expect(conditionNote(POWER_SAVER_COND)).toBe(
      "you have 4 or more Team Rocket's Pokémon in play",
    );
    // The fragment is a SUBSTRING of the printed sentence, apostrophe and all —
    // the family's second full round trip, and the check that the owner string
    // carries its own possessive rather than the renderer adding one.
    expect(POWER_SAVER_TEXT).toContain(conditionNote(POWER_SAVER_COND));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE GATE — `attackBarredByAbility`, the §9 channel, and the §8 refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — Power Saver, the always-on attack gate", () => {
  it("`passivesOf` COLLECTS the condition raw and unevaluated", () => {
    // The split this field exists under: the fold has no seat, so it collects and
    // the read site evaluates — `damageBonusBeforeWRIf`'s shape verbatim.
    expect(passivesOf(gated(0), activeOf(gated(0), "p1")).cantAttackUnless).toEqual([
      POWER_SAVER_COND,
    ]);
    // A body with no such passive collects an EMPTY list, not undefined — the
    // control that stops `?? []` hiding a wiring break at every read site.
    const plain = board();
    expect(passivesOf(plain, activeOf(plain, "p1")).cantAttackUnless).toEqual([]);
  });

  it("returns the UNMET condition below the floor, and undefined at or above it", () => {
    expect(attackBarredByAbility(gated(2), "p1", activeOf(gated(2), "p1"))).toEqual(
      POWER_SAVER_COND,
    );
    expect(attackBarredByAbility(gated(3), "p1", activeOf(gated(3), "p1"))).toBeUndefined();
    const plain = board();
    expect(attackBarredByAbility(plain, "p1", activeOf(plain, "p1"))).toBeUndefined();
  });

  it("§8 REFUSES the declaration, names the printed clause, and spends NOTHING", () => {
    const state = gated(2);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the gate to refuse");
    expect(result.error.code).toBe("ATTACK_PREVENTED");
    expect(result.error.message).toContain("you have 4 or more Team Rocket's Pokémon in play");
    // A REJECTION, not an ATTACK_FAILED: the turn does not end and nothing moved.
    expect(state.phase.kind).toBe("turn:action");
  });

  it("§8 refuses EVERY attack index, not just index 0 — it is a fact about the BODY", () => {
    const state = gated(2);
    for (const index of [0, 1]) {
      const result = applyAction(state, { type: "attack", seat: "p1", index });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ATTACK_PREVENTED");
    }
  });

  it("…and the SAME board one prefixed body later lets the attack through", () => {
    // The non-vacuous half. Energy attached so the cost is met and the ONLY thing
    // that changed between the two boards is the count.
    let state = gated(3);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(true);
  });

  it("it sits BEFORE the index check — a bogus index on a gated body reports the GATE", () => {
    const result = applyAction(gated(2), { type: "attack", seat: "p1", index: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_PREVENTED");
  });

  it("a §9 ABILITY-LOCK SILENCES the gate — the whole channel argument, driven", () => {
    let state = gated(0);
    expect(attackBarredByAbility(state, "p1", activeOf(state, "p1"))).toEqual(POWER_SAVER_COND);
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(attackBarredByAbility(state, "p1", activeOf(state, "p1"))).toBeUndefined();
    // …and the §8 gate agrees, which is the point of reading through one function.
    const withEnergy = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(applyAction(withEnergy, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("greys EVERY attack row on the WIRE projection, and un-greys them together", () => {
    // Read site 2. `banned` rather than `barred`, so both rows move as one.
    const barredView = redactGame(attachFromDeck(gated(2), "p1", "fix-energy", 2), "p1");
    const barredPhase = barredView.phase;
    if (barredPhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(barredPhase.attacks.length).toBe(2);
    expect(barredPhase.attacks.every((a) => !a.playable)).toBe(true);
    // The non-vacuous control: the cost was payable all along, so the ONLY reason
    // both rows are dead is the gate — and one more prefixed body revives index 0.
    const openView = redactGame(attachFromDeck(gated(3), "p1", "fix-energy", 2), "p1");
    const openPhase = openView.phase;
    if (openPhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(openPhase.attacks[0]?.playable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SEASONED SKILL — zero engine code, and the assumption that makes it true.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — Seasoned Skill, the six printings that cost nothing", () => {
  it("takes one {C} off Blood Moon per Prize the opponent has taken", () => {
    let state = setActiveFromDeck(board(), "p1", "fix-seasoned");
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"), "Blood Moon")).toBe(0);
    state = opponentTook(state, "p2", 2);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"), "Blood Moon")).toBe(2);
    expect(
      effectiveAttackCost(
        state,
        activeOf(state, "p1"),
        ["Colorless", "Colorless", "Colorless"],
        "Blood Moon",
      ),
    ).toEqual(["Colorless"]);
    expect(attackCostAt(state, "p1", activeOf(state, "p1"), 0, [])).toEqual(["Colorless"]);
  });

  it("B17 — the FLAGGED ASSUMPTION is retired: the discount does NOT reach the SECOND attack", () => {
    let state = setActiveFromDeck(board(), "p1", "fix-seasoned");
    state = opponentTook(state, "p2", 1);
    expect(attackCostAt(state, "p1", activeOf(state, "p1"), 1, [])).toEqual([
      "Colorless",
      "Colorless",
    ]);
    expect(
      effectiveAttackCost(state, activeOf(state, "p1"), ["Colorless", "Colorless"], "Rough Swing"),
    ).toEqual(["Colorless", "Colorless"]);
    expect(attackCostAt(state, "p1", activeOf(state, "p1"), 0, [])).toEqual([
      "Colorless",
      "Colorless",
    ]);
  });

  it("is §9-suppressible and BENCH-INERT, like every other printed-Ability passive", () => {
    // Same channel as Power Saver, so the same two structural facts hold. A
    // BENCHED holder's passive never reaches the Active's cost seam.
    let state = clearBench(board(), "p1");
    state = benchFromDeck(state, "p1", "fix-seasoned");
    state = opponentTook(state, "p2", 3);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"), "Blood Moon")).toBe(0);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("no benched body");
    expect(selfAttackCostDiscount(state, benched, "Blood Moon")).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE TWO PROGRAMS DO NOT REACH EACH OTHER.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — the two rows are disjoint mechanisms on one seam", () => {
  it("the gate does not discount, and the discount does not gate", () => {
    const gate = gated(0);
    expect(selfAttackCostDiscount(gate, activeOf(gate, "p1"))).toBe(0);
    const discount = setActiveFromDeck(board(), "p1", "fix-seasoned");
    expect(attackBarredByAbility(discount, "p1", activeOf(discount, "p1"))).toBeUndefined();
  });

  it("a gated body's Energy is untouched by the refusal", () => {
    // The §8 gate rejects before anything is spent, which is what makes
    // ATTACK_PREVENTED the right code — checked on the board rather than asserted.
    const state = attachBenchFromDeck(
      benchFromDeck(gated(0), "p1", "fix-tr-body"),
      "p1",
      0,
      "fix-energy",
      1,
    );
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    expect(state.players.p1.bench[0]?.energy.length).toBe(1);
  });
});
