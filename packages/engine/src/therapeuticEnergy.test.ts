import { describe, expect, it } from "vitest";
import { disabledAbilityUids, passivesOf } from "./continuous";
import { applyAction, programFor } from "./index";
import type {
  CoinFace,
  GameEvent,
  GameState,
  PokemonRef,
  PokemonTarget,
  Seat,
  StatusName,
} from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  THERAPEUTIC_ENERGY_DECK,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";

const PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nThe Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

/** The three conditions the card NAMES, in printed order. Load-bearing twice: it
    is why `PassiveEffects.statusImmunity` had to widen into a list, and it is the
    whole content of both clauses. */
const NAMED: StatusName[] = ["asleep", "confused", "paralyzed"];

/** The two §12 conditions it does NOT name — the negative half of every claim
    below, and the reason "immune" is the wrong word for what this card prints. */
const UNNAMED: StatusName[] = ["burned", "poisoned"];

const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const ATTACKS = {
  hypnosis: { card: "fix-statuser", index: 0, energy: 0 }, // → Asleep
  confuseRay: { card: "fix-statuser", index: 1, energy: 0 }, // → Confused
  numbingBolt: { card: "fix-statuser", index: 2, energy: 0 }, // flip → Paralyzed, 10
  toxic: { card: "fix-statuser", index: 5, energy: 0 }, // → Poisoned
  hotBite: { card: "sv01-029", index: 0, energy: 1 }, // Scovillain {C} 20 → Burned
} as const;

type AttackKey = keyof typeof ATTACKS;

/** `by` opens, passes, and the OTHER seat plays turn 2 — so the attacking seat
    carries no §4 first-turn restriction. Both bodies are placed by surgery,
    because every clause on this card is read off the CURRENT board. */
function board(
  attack: AttackKey,
  defender: string,
  opts: { seed?: number; by?: Seat } = {},
): GameState {
  const by: Seat = opts.by ?? "p1";
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        opts.seed ?? SEED,
        { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKS[attack].card);
  if (ATTACKS[attack].energy > 0) state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, opener, defender);
  return state;
}

/** …with `count` Therapeutic Energy already on the DEFENDER, which is the board
    every immunity case below is asked on. */
function boardWithEnergy(attack: AttackKey, defender: string, count = 1, seed = SEED): GameState {
  const state = board(attack, defender, { seed });
  const opener = "p2";
  return attachFromDeck(state, opener, "sv02-193", count);
}

function swing(state: GameState, attack: AttackKey, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[attack].index });
}

/** A board where p2 is ON TURN with `card` as its Active. The RECOVERY half never
    attacks — it needs a body, a turn and a hand — so it wants a board named for
    what it is rather than for a declaration it will not make. */
function myTurnWith(card = "fix-bigbody"): GameState {
  return setActiveFromDeck(board("hypnosis", "fix-bigbody", { by: "p2" }), "p2", card);
}

/** Attach `cardId` from p2's hand onto its Active through the REAL §6.2 action. */
function attachFromHand(state: GameState, cardId: string, target: PokemonTarget) {
  const withCard = handFromDeck(state, "p2", cardId, 1);
  return mustApply(withCard, {
    type: "attachEnergy",
    seat: "p2",
    uid: handUid(withCard, "p2", cardId),
    target,
  });
}

const ACTIVE: PokemonTarget = { spot: "active" };

function nextFace(state: GameState): CoinFace {
  return flipCoin(state.rngState)[0];
}

function seedFlipping(want: CoinFace, defender: string, from = SEED): number {
  for (let seed = from; seed < from + 80; seed += 1) {
    if (nextFace(board("numbingBolt", defender, { seed })) === want) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + 80}) flips ${want}`);
}

function conditionsOf(state: GameState, seat: Seat) {
  return state.players[seat].active?.conditions;
}

function logRows(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function logLines(state: GameState, events: GameEvent[]): string[] {
  return logRows(state, events).map((row) => row.text);
}

/** The immunities/recoveries `passivesOf` reports for a seat's Active. */
function foldOf(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return passivesOf(state, active);
}

describe("THE CENSUS — re-derived over all three columns, and WIDENED", () => {
  it("holds D172's numbers exactly: 4 printings / 3 sentences for the IMMUNITY", () => {
    const immunityFamily = ["sv01-068", "sv01-099", "sv01-208", "sv02-193"];
    expect(immunityFamily).toHaveLength(4);
    const sentences = new Set([
      "This Pokémon can't be Burned.",
      "This Pokémon can't be Paralyzed.",
      "can't be affected by those Special Conditions",
    ]);
    expect(sentences.size).toBe(3);
    expect(FIXTURE_POOL["sv02-193"]?.effect).toBe(PRINTED);
    for (const id of ["sv01-068", "sv01-099", "sv01-208"]) {
      expect(FIXTURE_POOL[id]?.effect ?? "").toBe("");
    }
  });

  it("FINDS A FAMILY D172's SWEEP COULD NOT SEE — `recovers from`, 4 more printings", () => {
    expect(programFor("sv01-086")?.attack).toBeUndefined();
    expect(programFor("sv01-145")?.abilities?.[0]?.program).toEqual([{ op: "clearStatus" }]);
    // …and the one built HERE says "recovers from BEING <three names>", not "from
    // all", which is the difference the two mechanisms turn on — CONTINUOUS and
    // per-condition on this side, DISCRETE and total on theirs.
    expect(PRINTED).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(PRINTED).not.toContain("all Special Conditions");
  });

  it("swept FIXTURE_POOL as a SEPARATE population (D156), and it is 4 of 5 at D177", () => {
    const recovering = Object.entries(FIXTURE_POOL)
      .filter(([, card]) =>
        [...(card.abilities ?? []), ...(card.attacks ?? [])]
          .map((entry) => entry.effect ?? "")
          .concat(card.effect ?? "")
          .some((text) => text.includes("recovers from")),
      )
      .map(([id]) => id)
      .sort();
    expect(recovering).toEqual(["sv01-086", "sv01-228", "sv01-245", "sv02-193"]);
    expect(FIXTURE_POOL["sv01-145"]).toBeDefined();
    expect(programFor("sv01-145")?.abilities?.[0]?.name).toBe("Busybody Nurse");
  });
});

describe("the printed data — carried VERBATIM and PINNED BY ASSERTION", () => {
  it("carries both paragraphs off the D1, blank line included", () => {
    expect(FIXTURE_POOL["sv02-193"]).toMatchObject({
      name: "Therapeutic Energy",
      category: "Energy",
      energyType: "Special",
      effect: PRINTED,
    });
    expect(PRINTED.split("\n\n")).toHaveLength(2);
  });

  it("names EXACTLY three conditions, and 'those' is what makes both clauses equal", () => {
    const [, second] = PRINTED.split("\n\n");
    expect(second).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(second).toContain("can't be affected by those Special Conditions");
    for (const word of ["Asleep", "Confused", "Paralyzed"]) expect(second).toContain(word);
    for (const word of ["Burned", "Poisoned"]) expect(second).not.toContain(word);
  });

  it("names the rotation slot's three values, and the engine does NOT key on that", () => {
    expect(programFor("sv02-193")?.energy?.passive?.statusRecovery).toEqual(NAMED);
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toEqual(NAMED);
    // The witness that it is a LIST and not a slot: dropping one name changes the
    // answer, which a slot check could not express.
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED);
    expect(foldOf(state, "p2").statusImmunities).toHaveLength(3);
  });
});

describe("the registry row — the FIRST continuous Special Energy", () => {
  it("authors both clauses under `energy.passive`, and the cost half needs nothing new", () => {
    expect(programFor("sv02-193")?.energy).toEqual({
      provides: ["Colorless"],
      passive: { statusRecovery: NAMED, statusImmunities: NAMED },
    });
    // The first paragraph is Jet Energy's line for Jet Energy's reason — a bare
    // "{C} Energy" with no rider — so nothing in the §6.1 provision path moved.
    expect(programFor("sv02-190")?.energy?.provides).toEqual(["Colorless"]);
  });

  it("ENUMERATES every card in the pool with a continuous ENERGY surface — measured", () => {
    const withEnergyPassive = Object.keys(FIXTURE_POOL)
      .filter((id) => programFor(id)?.energy?.passive !== undefined)
      .sort();
    expect(withEnergyPassive).toEqual(["fix-legacy-energy", "fix-mist-energy", "sv02-193"]);
    expect(programFor("fix-legacy-energy")?.energy?.passive).toEqual({
      onKoPrizeReduction: { by: 1, oncePerGame: "Legacy Energy" },
    });
    // …and the two members write DISJOINT fields, which is what keeps the sweep a
    // measurement rather than a headcount: one is §12 status, one is the §8.5-
    // adjacent effect funnel, and neither carries the other's key.
    expect(programFor("fix-mist-energy")?.energy?.passive).toEqual({
      preventAttackEffects: true,
    });
    expect(programFor("sv02-193")?.energy?.passive?.preventAttackEffects).toBeUndefined();
    expect(programFor("fix-mist-energy")?.energy?.passive?.statusImmunities).toBeUndefined();
    // …and the two older Special Energies still carry NO continuous surface, which
    // is what makes "the interface gained a field, not a behaviour" checkable.
    expect(programFor("sv02-190")?.energy?.passive).toBeUndefined();
    expect(programFor("sv02-191")?.energy?.passive).toBeUndefined();
  });

  it("writes NEITHER clause onto `CardProgram.passive`, which is the Pokémon surface", () => {
    // The two surfaces are genuinely distinct, and the sweep in
    // statusImmunity.test.ts is narrow BECAUSE of this rather than by oversight.
    expect(programFor("sv02-193")?.passive).toBeUndefined();
    expect(programFor("sv01-099")?.energy).toBeUndefined();
  });
});

describe("the SCALAR WIDENED — the writers were counted again", () => {
  it("has THREE writers now, and the third one names three conditions", () => {
    const writers = [
      programFor("sv01-099")?.passive?.statusImmunities,
      programFor("sv01-068")?.passive?.statusImmunities,
      programFor("sv02-193")?.energy?.passive?.statusImmunities,
    ];
    expect(writers.map((w) => w?.length)).toEqual([1, 1, 3]);
  });

  it("keeps ONE shape across BOTH interfaces — the alternative was D131 drift", () => {
    for (const list of [
      programFor("sv01-099")?.passive?.statusImmunities,
      programFor("sv02-193")?.energy?.passive?.statusImmunities,
    ]) {
      expect(Array.isArray(list)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE THIRD SOURCE CLASS — the expensive edit, and its audit.
// ─────────────────────────────────────────────────────────────────────────────

describe("passivesOf's THIRD SOURCE CLASS — an attached ENERGY", () => {
  it("reports the Energy's three conditions off a body with no printed immunity", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED);
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
    // The control on the same board shape: the attacker holds no such Energy.
    expect(foldOf(state, "p1").statusImmunities).toEqual([]);
  });

  it("reports NOTHING for a BASIC energy on the same body — the source is the CARD", () => {
    // Without this the case above passes on a build that turned "has any energy
    // attached" into an immunity.
    let state = board("hypnosis", "fix-bigbody");
    state = attachFromDeck(state, "p2", "fix-energy", 3);
    expect(foldOf(state, "p2").statusImmunities).toEqual([]);
    expect(foldOf(state, "p2").statusRecovery).toEqual([]);
  });

  it("SUMS over two attached copies, and does NOT de-duplicate", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    expect(foldOf(state, "p2").statusImmunities).toHaveLength(6);
    expect(foldOf(state, "p2").statusRecovery).toHaveLength(6);
    // …and the behaviour is unchanged, which is the point of not de-duplicating.
    const { events } = swing(state, "hypnosis");
    expect(findAll(events, "STATUS_PREVENTED")).toHaveLength(1);
  });

  it("STACKS the two source classes and keeps them DISTINGUISHABLE, in fold order", () => {
    const state = boardWithEnergy("hypnosis", "sv01-068");
    expect(foldOf(state, "p2").statusImmunities).toEqual([
      "paralyzed",
      "asleep",
      "confused",
      "paralyzed",
    ]);
    // Only the ENERGY prints a recovery clause, so the recovery list has no
    // Pokémon contribution at all.
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
  });

  it("leaves EVERY OTHER FIELD of the fold at its zero — the audit's measurement", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    const fold = foldOf(state, "p2");
    expect(fold.damageReductionAfterWR).toBe(0);
    expect(fold.damageBonusBeforeWR).toBe(0);
    expect(fold.conditionalDamageBonusBeforeWR).toEqual([]);
    expect(fold.targetConditionalDamageBonusBeforeWR).toEqual([]);
    expect(fold.hpBonus).toBe(0);
    expect(fold.damageAttacker).toBe(0);
    expect(fold.damageAttackerOnKo).toBe(0);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
    expect(fold.suppressTargetEffectsOnAttack).toBe(false);
    expect(fold.survivesKoAtFullHp).toBe(false);
    expect(fold.survivesKoOnCoinFlip).toBeNull();
    expect(fold.cantAttackUnless).toEqual([]);
    expect(fold.attackTwiceIf).toEqual([]);
    expect(fold.koPrizeReductions).toEqual([]);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    expect(fold.preventDamageAndEffectsWhileBenched).toBe(false);
    expect(fold.preventDamageWhileBenched).toBe(false);
    expect(fold.preventDamageFromAttackerClasses).toEqual([]);
    expect(fold.preventDamageAtOrAbove).toBeUndefined();
    expect(fold.preventDamageOnCoinFlip).toEqual([]);
    expect(fold.preventTrainerEffects).toBe(false);
    expect(fold.preventSupporterEffects).toBe(false);
    expect(fold.preventAttackEffects).toBe(false);
    expect(Object.keys(fold).sort()).toEqual(
      [
        "attackFirstTurnExempt",
        "attackCostClauses",
        "attackTwiceIf",
        "cantAttackUnless",
        "conditionalDamageBonusBeforeWR",
        "damageAttacker",
        "damageAttackerFromAbility",
        "damageAttackerOnKo",
        "damageAttackerOnKoFromAbility",
        "damageBonusBeforeWR",
        "damageReductionAfterWR",
        "damageReductionsFromAttacker",
        "evolveEarlyExempt",
        "evolveAsNamed",
        "hpBonus",
        "koPrizeReductions",
        "preventDamageAndEffectsFromBanners",
        "preventDamageAndEffectsFromSpecialEnergy",
        "preventDamageAndEffectsWhileBenched",
        "preventDamageAtOrAbove",
        "preventDamageFromAttackerClasses",
        "preventDamageFromExV",
        "preventDamageFromHasAbility",
        "preventDamageFromTypes",
        "preventDamageOnCoinFlip",
        "preventDamageWhileBenched",
        "preventTrainerEffects",
        "preventSupporterEffects",
        "preventAbilityEffects",
        "preventAttackEffects",
        "statusImmunities",
        "statusRecovery",
        "suppressTargetEffectsOnAttack",
        "survivesKoAtFullHp",
        "survivesKoOnCoinFlip",
        "targetConditionalDamageBonusBeforeWR",
      ].sort(),
    );
  });

  it("does NOT let an Energy reach the fields read by their own board scans", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody", 2);
    expect(disabledAbilityUids(state).size).toBe(0);
  });
});

describe("§9 — an ENERGY IS NOT AN ABILITY, so the lock must NOT reach it", () => {
  /** Klefki "Mischievous Lock" as the attacker's ACTIVE: Basic Pokémon in play,
      BOTH sides, Klefki itself exempt by name. It reaches Pachirisu (a Basic). */
  function locked(defender: string, energies = 1): GameState {
    let state = boardWithEnergy("hypnosis", defender, energies);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return state;
  }

  it("kills the POKÉMON's immunity and spares the ENERGY's — IN THE SAME CALL", () => {
    const state = locked("sv01-068");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(foldOf(state, "p2").statusImmunities).toEqual(NAMED); // the Energy's three
    expect(foldOf(state, "p2").statusImmunities).not.toContain("burned");
    // Unlocked, the SAME board reports both sources — the delta is the Pokémon's
    // own "paralyzed" entries at the head of the list.
    const unlocked = boardWithEnergy("hypnosis", "sv01-068");
    expect(disabledAbilityUids(unlocked).has(activeUid(unlocked, "p2"))).toBe(false);
    expect(foldOf(unlocked, "p2").statusImmunities).toEqual([
      "paralyzed",
      "asleep",
      "confused",
      "paralyzed",
    ]);
  });

  it("keeps the RECOVERY under the lock too — it is the same source, the same verdict", () => {
    const state = locked("sv01-068");
    expect(foldOf(state, "p2").statusRecovery).toEqual(NAMED);
  });

  it("CANNOT be driven end to end either, and it is D172's COUNTING ARGUMENT again", () => {
    expect(programFor("sv01-096")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv02-127")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv05-078")?.passive?.disableAbilities).toMatchObject({
      requiresActive: true,
      targetZone: "active",
    });
    expect(programFor("sv08-107")?.passive?.disableAbilities).toMatchObject({
      sourceOnBench: true,
      targetZone: "bench",
    });
    expect(programFor("sv02-089")?.passive?.disableAbilities).toMatchObject({
      stage: "Basic",
      suffix: "V",
    });
    const klefkiAttacks = FIXTURE_POOL["sv01-096"]?.attacks ?? [];
    expect(klefkiAttacks).toHaveLength(1);
    expect(klefkiAttacks[0]?.effect ?? "").not.toMatch(/is now (Asleep|Confused|Paralyzed)/);
  });

  it("but the RULE is driven with the lock live where the read actually happens", () => {
    const state = locked("sv01-068");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    for (const status of NAMED) {
      expect(passivesOf(state, active).statusImmunities.includes(status)).toBe(true);
    }
  });

  it("and the Pokémon-side control still DIES under the lock, so the pair is real", () => {
    let state = board("numbingBolt", "sv01-068");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(foldOf(state, "p2").statusImmunities).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE IMMUNITY — all three named conditions, and the two it does not name.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE IMMUNITY — the three NAMED conditions are refused", () => {
  it("refuses ASLEEP, with a control on the identical declaration", () => {
    const immune = swing(boardWithEnergy("hypnosis", "fix-bigbody"), "hypnosis");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "asleep" });
    expect(types(immune.events)).not.toContain("STATUS_APPLIED");

    const control = swing(board("hypnosis", "fix-bigbody"), "hypnosis");
    expect(find(control.events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
    expect(types(control.events)).not.toContain("STATUS_PREVENTED");
    // …and the Checkup really did run on the control and NOT on the immune board,
    // which is the same fact stated where it cannot be mistaken for a coincidence.
    expect(findAll(control.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
    expect(findAll(immune.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
  });

  it("refuses CONFUSED, with a control on the identical declaration", () => {
    const immune = swing(boardWithEnergy("confuseRay", "fix-bigbody"), "confuseRay");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "confused" });

    const control = swing(board("confuseRay", "fix-bigbody"), "confuseRay");
    expect(conditionsOf(control.state, "p2")?.rotation).toBe("confused");
  });

  it("refuses PARALYZED behind its coin, with a control on the same seed", () => {
    const seed = seedFlipping("heads", "fix-bigbody");
    const immune = swing(
      attachFromDeck(board("numbingBolt", "fix-bigbody", { seed }), "p2", "sv02-193", 1),
      "numbingBolt",
    );
    expect(find(immune.events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(conditionsOf(immune.state, "p2")?.rotation).toBe("none");
    expect(find(immune.events, "STATUS_PREVENTED")).toMatchObject({ status: "paralyzed" });

    const control = swing(board("numbingBolt", "fix-bigbody", { seed }), "numbingBolt");
    expect(conditionsOf(control.state, "p2")?.rotation).toBe("paralyzed");
    // …and the two boards consumed the SAME number of rng steps, so an immune body
    // does not desynchronise every later flip in the match.
    expect(immune.state.rngState).toBe(control.state.rngState);
  });

  it("still takes BURNED — a condition this card does NOT name", () => {
    const { events } = swing(boardWithEnergy("hotBite", "fix-bigbody"), "hotBite");
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ status: "burned" });
    expect(findAll(events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(1);
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("still takes POISONED — the other unnamed condition", () => {
    const { state, events } = swing(boardWithEnergy("toxic", "fix-bigbody"), "toxic");
    expect((conditionsOf(state, "p2")?.poisonDamage ?? 0) > 0).toBe(true);
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ status: "poisoned" });
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("names exactly the printed three and neither of the other two", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    const immunities = foldOf(state, "p2").statusImmunities;
    for (const status of NAMED) expect(immunities).toContain(status);
    for (const status of UNNAMED) expect(immunities).not.toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RECOVERY — the mechanism with no precedent.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE RECOVERY — a condition already present, cleared by a continuous effect", () => {
  function paralyzedThenMyTurn(): { state: GameState; uid: string } {
    for (let seed = SEED; seed < SEED + 80; seed += 1) {
      let state = must(
        applyAction(
          driveSetup(
            seed,
            { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
            { first: "p1" },
          ),
          { type: "endTurn", seat: "p1" },
        ),
      );
      state = setActiveFromDeck(state, "p2", "fix-statuser");
      state = setActiveFromDeck(state, "p1", "fix-bigbody");
      if (nextFace(state) !== "heads") continue;
      const swung = mustApply(state, { type: "attack", seat: "p2", index: 2 });
      let next = swung.state;
      if (next.players.p1.active?.conditions.rotation !== "paralyzed") continue;
      if (next.phase.kind !== "turn:action" || next.phase.seat !== "p1") continue;
      next = handFromDeck(next, "p1", "sv02-193", 1);
      return { state: next, uid: handUid(next, "p1", "sv02-193") };
    }
    throw new Error("no seed produced a paralyzed p1 Active on its own turn");
  }

  it("RECOVERS a Paralysis the opponent applied LAST TURN — the printed use, end to end", () => {
    const { state, uid } = paralyzedThenMyTurn();
    expect(state.players.p1.active?.conditions.rotation).toBe("paralyzed");
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(done.state.players.p1.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p1",
      statuses: ["paralyzed"],
      reason: "recovered",
    });
    const order = types(done.events);
    expect(order.indexOf("ENERGY_ATTACHED")).toBeLessThan(order.indexOf("STATUS_CLEARED"));
  });

  it("un-immobilises it, which is the whole point of the card", () => {
    // The behavioural consequence, not just the flag: a Paralyzed Pokémon cannot
    // attack (§12), and after the attach this one can. Asserted through the real
    // action rather than through `isImmobilized`.
    const { state, uid } = paralyzedThenMyTurn();
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(false);
    let next = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    }).state;
    next = setActiveFromDeck(next, "p1", "fix-statuser");
    expect(applyAction(next, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("recovers ASLEEP and CONFUSED the same way", () => {
    for (const rotation of ["asleep", "confused"] as const) {
      let state = myTurnWith();
      state = setConditions(state, "p2", { rotation });
      state = handFromDeck(state, "p2", "sv02-193", 1);
      const done = mustApply(state, {
        type: "attachEnergy",
        seat: "p2",
        uid: handUid(state, "p2", "sv02-193"),
        target: { spot: "active" },
      });
      expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
      expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
        statuses: [rotation],
        reason: "recovered",
      });
    }
  });

  it("leaves BURN and POISON exactly where they were — the list is the list", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", {
      rotation: "asleep",
      burned: true,
      poisonDamage: 10,
      confusionDamage: 30,
    });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(done.state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      burned: true,
      poisonDamage: 10,
      confusionDamage: 30,
    });
    expect(find(done.events, "STATUS_CLEARED")?.statuses).toEqual(["asleep"]);
  });

  it("an IMMUNITY WITHOUT a RECOVERY clause clears NOTHING — the two fields are two rules", () => {
    let state = myTurnWith("sv01-068");
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    expect(foldOf(state, "p2").statusImmunities).toEqual(["paralyzed"]);
    expect(foldOf(state, "p2").statusRecovery).toEqual([]);
    const done = attachFromHand(state, "fix-energy", ACTIVE);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("says NOTHING when there is nothing to recover — no row on a clean body", () => {
    // A recovery that announced itself on every attach would make the log unreadable
    // and would make "did anything happen" unanswerable.
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("a BASIC energy attached to the same Paralyzed body recovers NOTHING", () => {
    // The control that makes every case above about the CARD rather than about the
    // act of attaching.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "fix-energy", 1);
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "fix-energy"),
      target: { spot: "active" },
    });
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(types(done.events)).not.toContain("STATUS_CLEARED");
  });

  it("does NOT bring the condition back when the Energy is discarded — it is a WRITE", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    const after = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    const active = after.players.p2.active;
    if (active === null) throw new Error("no Active");
    const stripped: GameState = {
      ...after,
      players: {
        ...after.players,
        p2: { ...after.players.p2, active: { ...active, energy: [] } },
      },
    };
    expect(foldOf(stripped, "p2").statusRecovery).toEqual([]);
    expect(foldOf(stripped, "p2").statusImmunities).toEqual([]);
    expect(stripped.players.p2.active?.conditions.rotation).toBe("none");
  });
});

describe("the recovery's FOUR pre-D562 CALL SITES (the FIFTH, `playStadium`, is stadiumsD562 §3), all driven off printed cards", () => {
  it("MOMENT 1 — the §6.2 manual attach (turn.ts)", () => {
    // Driven exhaustively above; asserted here as the seam rather than the rule, so
    // a build that moved the call out of `attachEnergy` fails in a case that names
    // the site.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "confused" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(find(done.events, "STATUS_CLEARED")?.reason).toBe("recovered");
  });

  it("MOMENT 2 — the completion of any effect PROGRAM (flow.ts settleProgram)", () => {
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = attachBenchFromDeck(state, "p2", 0, "sv02-193", 1);
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv03-193", 1);
    const energyUid = state.players.p2.bench[0]?.energy[0];
    if (energyUid === undefined) throw new Error("no energy on the bench body");
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv03-193"),
    }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const dest: PokemonRef = { seat: "p2", spot: { spot: "active" } };
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest }] },
    });
    expect(done.state.players.p2.active?.energy).toContain(energyUid);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["paralyzed"],
      reason: "recovered",
    });
  });

  it("MOMENT 3 — the §7.4 TOOL attach (cardplay.ts attachTool, D176)", () => {
    expect(programFor("sv01-174")?.passive).toBeUndefined();
    let state = myTurnWith();
    state = attachFromDeck(state, "p2", "sv02-193", 1);
    state = setConditions(state, "p2", { rotation: "confused" });
    state = handFromDeck(state, "p2", "sv01-174", 1);
    const done = mustApply(state, {
      type: "attachTool",
      seat: "p2",
      uid: handUid(state, "p2", "sv01-174"),
      target: ACTIVE,
    });
    expect(types(done.events)).toContain("TOOL_ATTACHED");
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
      reason: "recovered",
    });
  });

  it("MOMENT 4 — the completion of a betweenTurns program (triggers.ts, D176)", () => {
    const build = (withTrigger: boolean): GameState => {
      let state = myTurnWith();
      state = clearBench(state, "p2");
      if (withTrigger) state = benchFromDeck(state, "p2", "sv02-123");
      state = attachFromDeck(state, "p2", "sv02-193", 1);
      return setConditions(state, "p2", { rotation: "confused" });
    };
    const done = mustApply(build(true), { type: "endTurn", seat: "p2" });
    expect(types(done.events)).toContain("ABILITY_TRIGGERED");
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
      reason: "recovered",
    });
    const control = mustApply(build(false), { type: "endTurn", seat: "p2" });
    expect(types(control.events)).not.toContain("ABILITY_TRIGGERED");
    expect(control.state.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("runs AFTER Jet Energy's on-attach switch — and the ORDER IS UNOBSERVABLE, said not assumed", () => {
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setConditions(state, "p2", { rotation: "asleep" });
    state = handFromDeck(state, "p2", "sv02-190", 1);
    const done = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-190"),
      target: { spot: "bench", index: 0 },
    });
    expect(types(done.events)).toContain("POKEMON_SWITCHED");
    expect(findAll(done.events, "STATUS_CLEARED").map((e) => e.reason)).toEqual(["benched"]);
    // THE UNREACHABILITY, asserted over the pool: no card carries both clauses.
    const bothClauses = Object.keys(FIXTURE_POOL).filter((id) => {
      const energy = programFor(id)?.energy;
      return energy?.onAttach !== undefined && energy?.passive?.statusRecovery !== undefined;
    });
    expect(bothClauses).toEqual([]);
    const onAttachArms = Object.keys(FIXTURE_POOL)
      .map((id) => programFor(id)?.energy?.onAttach?.kind)
      .filter((kind) => kind !== undefined);
    expect([...new Set(onAttachArms)].sort()).toEqual(["draw", "switchIfBenched"]);
    expect(programFor("sv02-190")?.energy?.onAttach).toEqual({ kind: "switchIfBenched" });
    expect(programFor("sv08-191")?.energy?.onAttach).toEqual({ kind: "draw", count: 4 });
    expect(programFor("sv02-193")?.energy?.onAttach).toBeUndefined();
  });

  it("sweeps the ACTIVE only, and the bench premise is ASSERTED not assumed", () => {
    const { state } = paralyzedThenMyTurnShared();
    for (const seat of ["p1", "p2"] as const) {
      for (const pokemon of state.players[seat].bench) {
        expect(pokemon.conditions).toEqual({
          rotation: "none",
          poisonDamage: 0,
          burned: false,
          confusionDamage: 30,
        });
      }
    }
  });

  /** The legal paralysis board, shared with the recovery group above. */
  function paralyzedThenMyTurnShared(): { state: GameState } {
    for (let seed = SEED; seed < SEED + 80; seed += 1) {
      let state = must(
        applyAction(
          driveSetup(
            seed,
            { p1: THERAPEUTIC_ENERGY_DECK, p2: THERAPEUTIC_ENERGY_DECK },
            { first: "p1" },
          ),
          { type: "endTurn", seat: "p1" },
        ),
      );
      state = setActiveFromDeck(state, "p2", "fix-statuser");
      state = setActiveFromDeck(state, "p1", "fix-bigbody");
      if (nextFace(state) !== "heads") continue;
      const swung = mustApply(state, { type: "attack", seat: "p2", index: 2 });
      if (swung.state.players.p1.active?.conditions.rotation !== "paralyzed") continue;
      return { state: swung.state };
    }
    throw new Error("no seed produced a paralyzed p1 Active");
  }
});

describe("THE CHECKUP — D172's conclusion SURVIVES, its ARGUMENT NARROWS", () => {
  it("makes D172's unreachability claim FALSE — the immunity CAN arrive second now", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    const before = foldOf(state, "p2");
    expect(before.statusImmunities).toEqual([]); // no immunity yet…
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    // …and now there is one, on a body that was carrying the condition first.
    expect(foldOf(done.state, "p2").statusImmunities).toEqual(NAMED);
  });

  it("STILL needs no Checkup gate, because the RECOVERY closes the window", () => {
    for (const id of ["sv01-068", "sv01-099", "sv01-208"]) {
      expect(FIXTURE_POOL[id]?.category).toBe("Pokemon");
      expect(programFor(id)?.energy).toBeUndefined();
    }
    // Driven: attach, then end the turn through a full §13 — no tick, no flip, no
    // condition, and the Checkup sees a clean body because the attach cleaned it.
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "asleep" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    let next = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    const done = mustApply(next, { type: "endTurn", seat: "p2" });
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
    expect(done.state.players.p2.active?.conditions.rotation).toBe("none");
    // The non-vacuous control: the same board WITHOUT the attach takes its wake-up
    // flip, so the case above is about the Energy and not about the seed.
    next = state;
    const control = mustApply(next, { type: "endTurn", seat: "p2" });
    expect(findAll(control.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
  });

  it("keeps `applyStatus` the ONLY writer — this slice adds a CLEAR, never a write", () => {
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(types(done.events)).not.toContain("STATUS_APPLIED");
    expect(done.state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the row speaks the card's own verb", () => {
  it("renders the recovery as the printed word, with the subject resolved", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(logLines(done.state, done.events)).toContain("fix-bigbody recovered from Paralyzed");
  });

  it("is filed under the seat that OWNS the recovering Pokémon", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "asleep" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    expect(logRows(done.state, done.events).find((r) => r.text.includes("recovered"))?.who).toBe(
      "p2",
    );
  });

  it("keeps the REFUSAL's row distinct from the RECOVERY's — two clauses, two rows", () => {
    // The two halves of one printed sentence produce two different rows, which is
    // the shortest statement that they are two rules.
    const refused = swing(boardWithEnergy("hypnosis", "fix-bigbody"), "hypnosis");
    expect(logLines(refused.state, refused.events)).toContain("fix-bigbody can't be Asleep");
    expect(logLines(refused.state, refused.events).some((l) => l.includes("recovered"))).toBe(
      false,
    );
  });
});

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11, DERIVED", () => {
    const state = myTurnWith();
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    const active = done.state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active.conditions).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
    expect(Object.keys(active)).not.toContain("statusImmunities");
    expect(Object.keys(active)).not.toContain("statusRecovery");
  });

  it("GATES NO ACTION — the Energy pays costs and blocks nothing", () => {
    let state = board("hotBite", "fix-bigbody", { by: "p2" });
    state = attachFromDeck(state, "p2", "sv02-193", 1);
    const done = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(done.events, "ATTACK_DECLARED")).toBeDefined();
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
  });

  it("§11: NOTHING OWED — this slice adds no op at all", () => {
    const state = boardWithEnergy("hypnosis", "fix-bigbody");
    expect(state.players.p2.active?.attackBlock).toBeNull();
  });

  it("the §11 BLOCK still speaks FIRST — the applyStatus early-return audit, re-run", () => {
    expect(FIXTURE_POOL["sv02-193"]?.attacks ?? []).toEqual([]);
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      for (const attack of FIXTURE_POOL[id]?.attacks ?? []) {
        expect(attack.effect ?? "").not.toContain("prevent all damage");
      }
    }
  });

  it("MECHANISM DID NOT EXIST — the recovery is genuinely new, and that is measured", () => {
    let state = myTurnWith();
    state = setConditions(state, "p2", { rotation: "confused" });
    const done = attachFromHand(state, "sv02-193", ACTIVE);
    const cleared = find(done.events, "STATUS_CLEARED");
    expect(cleared?.reason).toBe("recovered");
    expect(["benched", "evolved", "wokeUp", "burnCured", "paralysisEnded"]).not.toContain(
      cleared?.reason,
    );
  });
});

describe("the boards stay legal", () => {
  it("keeps every uid in exactly one zone across an attach that recovers", () => {
    let state = myTurnWith();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    state = handFromDeck(state, "p2", "sv02-193", 1);
    const before = state;
    const after = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-193"),
      target: { spot: "active" },
    }).state;
    for (const seat of ["p1", "p2"] as const) {
      const count = (s: GameState): number => {
        const side = s.players[seat];
        return (
          side.deck.length +
          side.hand.length +
          side.discard.length +
          side.prizes.length +
          (side.active === null ? 0 : side.active.stack.length + side.active.energy.length) +
          side.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0)
        );
      };
      expect(count(after)).toBe(count(before));
    }
  });
});
