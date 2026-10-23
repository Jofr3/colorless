import { describe, expect, it } from "vitest";
import { disabledAbilityUids, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import type { CoinFace, GameEvent, GameState, Seat, StatusName } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  STATUS_IMMUNITY_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
  findEvent,
} from "./testFixtures";

/** The three printed sentences, byte-for-byte off the local D1 rows. */
const WELL_BAKED_BODY =
  "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by attacks from your opponent's {R} Pokémon.";
const ELECTRICITY_POUCHES = "This Pokémon can't be Paralyzed.";
const THERAPEUTIC_ENERGY =
  "The Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

/** Pachirisu's own printed attack, carried on the fixture and read by nothing. */
const EVERYONE_DISCHARGE =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";

/** The base seed. Nothing in the Burn half of this family flips a coin; the
    Paralysis half has no choice (see `PARALYSIS NEEDS A COIN` below), and those
    cases pick their own seed off `flipCoin` rather than hoping. */
const SEED = 11;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const ATTACKS = {
  hotBite: { card: "sv01-029", index: 0, energy: 1 }, // Scovillain {C} 20 → Burned
  hypnosis: { card: "fix-statuser", index: 0, energy: 0 }, // → Asleep
  confuseRay: { card: "fix-statuser", index: 1, energy: 0 }, // → Confused
  numbingBolt: { card: "fix-statuser", index: 2, energy: 0 }, // flip → Paralyzed, 10
  toxic: { card: "fix-statuser", index: 5, energy: 0 }, // → Poisoned (20/checkup)
  landScoop: { card: "sv02-127", index: 0, energy: 3 }, // Ting-Lu ex {F}{F}{F} 150
} as const;

type AttackKey = keyof typeof ATTACKS;

function board(
  attack: AttackKey,
  defender: string,
  opts: { seed?: number; by?: Seat; energyId?: string } = {},
): GameState {
  const by: Seat = opts.by ?? "p1";
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        opts.seed ?? SEED,
        { p1: STATUS_IMMUNITY_DECK, p2: STATUS_IMMUNITY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKS[attack].card);
  if (ATTACKS[attack].energy > 0) {
    state = attachFromDeck(state, by, opts.energyId ?? "fix-energy", ATTACKS[attack].energy);
  }
  state = setActiveFromDeck(state, opener, defender);
  return state;
}

function swing(state: GameState, attack: AttackKey, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[attack].index });
}

/** The face `state` will produce on its NEXT flip — how every Paralysis case
    picks its seed. Read from `flipCoin` rather than from the events, so the board
    is chosen BEFORE the engine runs rather than filtered after it. */
function nextFace(state: GameState): CoinFace {
  return flipCoin(state.rngState)[0];
}

/** The first seed at or after `from` whose `board(...)` will flip `want`. Every
    other fact about the board is seed-independent (both bodies are placed by
    surgery), so this chooses the COIN and nothing else. */
function seedFlipping(want: CoinFace, defender: string, from = SEED): number {
  for (let seed = from; seed < from + 60; seed += 1) {
    if (nextFace(board("numbingBolt", defender, { seed })) === want) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + 60}) flips ${want}`);
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

describe("THE CENSUS — re-derived against 978 rows / 6 sets, not inherited", () => {
  it("is 4 printings over 3 sentences, and BOTH numbers were re-run", () => {
    const family: Record<string, string> = {
      "sv01-099": WELL_BAKED_BODY, // abilities_json — clause 1 of 2
      "sv01-068": ELECTRICITY_POUCHES, // abilities_json — the whole Ability
      "sv01-208": ELECTRICITY_POUCHES, // abilities_json — the reprint
      "sv02-193": THERAPEUTIC_ENERGY, // effect — a SPECIAL ENERGY
    };
    expect(Object.keys(family)).toHaveLength(4);
    expect(new Set(Object.values(family)).size).toBe(3);
    // Every one of them really is a REFUSAL and not an application or a read —
    // stated as a predicate over the strings rather than as a count anyone has to
    // trust, which is what makes the two false positives above checkable.
    for (const text of Object.values(family)) {
      expect(text).toMatch(/can't be (Burned|Paralyzed|affected by those Special Conditions)/);
    }
  });

  it("swept FIXTURE_POOL as a SEPARATE population — THREE of four at D172, FOUR at D174", () => {
    const withImmunityText = Object.entries(FIXTURE_POOL).filter(([, card]) =>
      [...(card.abilities ?? []), ...(card.attacks ?? [])]
        .map((entry) => entry.effect ?? "")
        .concat(card.effect ?? "")
        .some((text) =>
          /can't be (Burned|Paralyzed)|affected by those Special Conditions/.test(text),
        ),
    );
    expect(withImmunityText.map(([id]) => id).sort()).toEqual([
      "sv01-068",
      "sv01-099",
      "sv01-208",
      "sv02-193",
    ]);
    expect(FIXTURE_POOL["sv02-193"]?.effect).toContain("can't be affected by those");
    expect(FIXTURE_POOL["sv02-193"]?.abilities ?? []).toEqual([]);
    expect(FIXTURE_POOL["sv02-193"]?.attacks ?? []).toEqual([]);
  });

  it("CLOSES Therapeutic Energy sv02-193 — the pin D172 wrote as an ABSENCE", () => {
    expect(programFor("sv02-193")?.energy).toBeDefined();
    expect(THERAPEUTIC_ENERGY).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(THERAPEUTIC_ENERGY).toContain("can't be affected by those Special Conditions");
    // The pin that named the field before it existed, now naming it because it does.
    expect(passivesOfKeys()).toContain("statusRecovery");
  });
});

function passivesOfKeys(): string[] {
  const state = board("hotBite", "fix-bigbody");
  const active = state.players.p1.active;
  if (active === null) throw new Error("no Active");
  return Object.keys(passivesOf(state, active));
}

describe("the printed data — re-queried per printing, never recognized", () => {
  it("carries Pachirisu's NAME, Ability and attack VERBATIM on both printings", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]).toMatchObject({
        name: "Pachirisu",
        stage: "Basic",
        hp: 70,
        types: ["Lightning"],
        retreat: 1,
      });
      expect(FIXTURE_POOL[id]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
      expect(FIXTURE_POOL[id]?.abilities).toEqual([
        { type: "Ability", name: "Electricity Pouches", effect: ELECTRICITY_POUCHES },
      ]);
      expect(FIXTURE_POOL[id]?.attacks).toEqual([
        {
          cost: ["Lightning", "Colorless"],
          name: "Everyone Discharge",
          effect: EVERYONE_DISCHARGE,
          damage: "10+",
        },
      ]);
    }
  });

  it("keeps Pachirisu's TWO unread attack clauses LOUD on the fixture", () => {
    expect(EVERYONE_DISCHARGE).toContain("20 more damage for each of your Benched {L} Pokémon");
    expect(EVERYONE_DISCHARGE).toContain("isn't affected by Weakness");
    // And the deriver really does refuse the whole thing, so index 0 stays
    // unsimulated rather than silently deriving half of it.
    expect(deriveAttackEffect(EVERYONE_DISCHARGE)).toBeNull();
    expect(programFor("sv01-068")?.attack).toBeUndefined();
  });

  it("keeps Dachsbun's SECOND clause readable beside its first, on one string", () => {
    expect(FIXTURE_POOL["sv01-099"]?.abilities?.[0]?.effect).toBe(WELL_BAKED_BODY);
    expect(WELL_BAKED_BODY.indexOf("can't be Burned")).toBeLessThan(
      WELL_BAKED_BODY.indexOf("Prevent all damage"),
    );
  });
});

describe("the registry rows — three printings, two programs, two fields", () => {
  it("AUTHORS both Pachirisu printings on ONE shared program object", () => {
    expect(programFor("sv01-068")?.passive).toEqual({ statusImmunities: ["paralyzed"] });
    expect(programFor("sv01-208")?.passive).toBe(programFor("sv01-068")?.passive);
    // Nothing else on the card is authored: the Ability IS the whole program.
    expect(programFor("sv01-068")?.attack).toBeUndefined();
    expect(programFor("sv01-068")?.triggered).toBeUndefined();
    expect(programFor("sv01-068")?.abilities).toBeUndefined();
  });

  it("CLOSES Dachsbun — both printed clauses, two fields, one object", () => {
    expect(programFor("sv01-099")?.passive).toEqual({
      statusImmunities: ["burned"],
      preventDamageFromType: "Fire",
    });
  });

  it("keeps the two clauses on SEPARATE fields, because they are separate rules", () => {
    expect(programFor("sv01-068")?.passive?.preventDamageFromType).toBeUndefined();
    expect(programFor("sv03-078")?.passive?.statusImmunities).toBeUndefined();
    expect(programFor("sv03-078")?.passive).toEqual({ preventDamageFromType: "Lightning" });
  });

  it("registers NO other POKÉMON status immunity anywhere in the registry", () => {
    const immune = Object.keys(FIXTURE_POOL)
      .filter((id) => programFor(id)?.passive?.statusImmunities !== undefined)
      .sort();
    expect(immune).toEqual(["sv01-068", "sv01-099", "sv01-208"]);
    // …and the fourth really is invisible to it, which is the claim above made
    // checkable rather than asserted in prose.
    expect(programFor("sv02-193")?.passive).toBeUndefined();
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toEqual([
      "asleep",
      "confused",
      "paralyzed",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The aggregation: passivesOf, and the §9 gate it buys for free.
// ─────────────────────────────────────────────────────────────────────────────

describe("passivesOf — the aggregation, and why it is a LIST", () => {
  it("reports the holder's printed condition, and NOTHING for a body without one", () => {
    const state = board("hotBite", "sv01-099");
    const dachsbun = state.players.p2.active;
    const scovillain = state.players.p1.active;
    if (dachsbun === null || scovillain === null) throw new Error("no Active");
    expect(passivesOf(state, dachsbun).statusImmunities).toEqual(["burned"]);
    expect(passivesOf(state, scovillain).statusImmunities).toEqual([]);
  });

  it("reports Pachirisu's on BOTH printings, and it is the OTHER condition", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      const state = board("numbingBolt", id);
      const pachirisu = state.players.p2.active;
      if (pachirisu === null) throw new Error("no Active");
      expect(passivesOf(state, pachirisu).statusImmunities).toEqual(["paralyzed"]);
    }
  });

  it("leaves every OTHER field of the aggregation alone", () => {
    // The new key is additive: Dachsbun's own §8.5 prevention still reads the same
    // through the same call, which is the claim that the two clauses of one Ability
    // really are two independent readings of one object.
    const state = board("hotBite", "sv01-099");
    const dachsbun = state.players.p2.active;
    if (dachsbun === null) throw new Error("no Active");
    const passives = passivesOf(state, dachsbun);
    expect(passives.preventDamageFromTypes).toEqual(["Fire"]);
    expect(passives.damageReductionAfterWR).toBe(0);
    expect(passives.hpBonus).toBe(0);
  });
});

describe("§9 — the Ability lock, and an immunity that survived it would be a bug", () => {
  /** Klefki "Mischievous Lock" as `by`'s ACTIVE: Basic Pokémon in play, BOTH
      sides, Klefki itself exempt by name. It reaches Pachirisu (a Basic) and not
      Dachsbun (a Stage 1), which is the whole shape of the §9 story below. */
  function withKlefki(defender: string): GameState {
    let state = board("hotBite", defender);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return state;
  }

  it("SUPPRESSES Pachirisu's immunity under a live lock — with the lock PROVED live first", () => {
    const state = withKlefki("sv01-068");
    const pachirisu = state.players.p2.active;
    if (pachirisu === null) throw new Error("no Active");
    const uid = activeUid(state, "p2");
    expect(disabledAbilityUids(state).has(uid)).toBe(true);
    expect(passivesOf(state, pachirisu).statusImmunities).toEqual([]);
  });

  it("restores it the moment the lock's source leaves the Active Spot", () => {
    // The control, and the reason the case above is about the LOCK rather than
    // about the card: Mischievous Lock is Active-only, so promoting anything else
    // ends it and the immunity comes straight back.
    let state = withKlefki("sv01-068");
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    const pachirisu = state.players.p2.active;
    if (pachirisu === null) throw new Error("no Active");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(false);
    expect(passivesOf(state, pachirisu).statusImmunities).toEqual(["paralyzed"]);
  });

  it("SUPPRESSES Dachsbun's immunity under Ting-Lu ex, which reaches a Stage 1", () => {
    let state = board("landScoop", "sv01-099", { energyId: "fix-fighting-energy" });
    const side = state.players.p2;
    const active = side.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: { ...state.players, p2: { ...side, active: { ...active, damage: 10 } } },
    };
    const damaged = state.players.p2.active;
    if (damaged === null) throw new Error("no Active");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(passivesOf(state, damaged).statusImmunities).toEqual([]);
    // …and the §8.5 clause of the SAME Ability goes with it, which is the sharpest
    // available evidence that both fields ride one §9 gate rather than two.
    expect(passivesOf(state, damaged).preventDamageFromTypes).toEqual([]);
  });

  it("CANNOT be driven end to end, and the reason is STRUCTURAL — asserted, not skipped", () => {
    const locks = [
      "sv01-096",
      "sv02-127",
      "sv02-089",
      "sv05-078",
      "sv08.5-043",
      "svp-097",
      "sv08-107",
    ] as const;
    const activeOnly = locks.filter(
      (id) => programFor(id)?.passive?.disableAbilities?.requiresActive === true,
    );
    expect(activeOnly).toEqual(["sv01-096", "sv02-127", "sv05-078", "sv08.5-043", "svp-097"]);
    // Flutter Mane's lock reaches only the OPPOSING Active, so its holder is the
    // attacker, whose only printed attack "Hex Hurl" PLACES counters and applies no
    // condition — Klefki's answer.
    for (const id of ["sv05-078", "sv08.5-043", "svp-097"] as const) {
      expect(programFor(id)?.passive?.disableAbilities).toMatchObject({
        side: "opponent",
        targetZone: "active",
      });
    }
    expect(programFor("sv02-089")?.passive?.disableAbilities).toMatchObject({
      stage: "Basic",
      suffix: "V",
    });
    expect(programFor("sv08-107")?.passive?.disableAbilities).toMatchObject({
      stage: "Stage2",
      sourceOnBench: true,
      targetZone: "bench",
    });
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]?.name).not.toContain(" V");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rule: the immunity refusing an application, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("BURN — Dachsbun refuses it, and the control on the same swing does not", () => {
  it("refuses the Burn and emits STATUS_PREVENTED instead of STATUS_APPLIED", () => {
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(conditionsOf(state, "p2")?.burned).toBe(false);
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(findEvent(events, "STATUS_PREVENTED")).toEqual({
      type: "STATUS_PREVENTED",
      seat: "p2",
      uid: activeUid(state, "p2"),
      status: "burned",
    });
  });

  it("lands the same Burn on a body with no immunity — the control", () => {
    // Same attacker, same index, same energy, one card different. Without this the
    // case above passes on a build where Hot Bite never Burned anything.
    const { state, events } = swing(board("hotBite", "fix-bigbody"), "hotBite");
    expect(conditionsOf(state, "p2")?.burned).toBe(true);
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("still DEALS THE DAMAGE — the immunity is on the condition, not on the attack", () => {
    // Hot Bite prints 20 alongside its status clause. Dachsbun's §8.5 prevention
    // does not fire here (Scovillain is GRASS, not {R}), so the 20 lands in full
    // and the refusal is visible as exactly one missing condition.
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20, prevented: undefined });
    expect(state.players.p2.active?.damage).toBe(20);
  });

  it("refuses the Burn that arrives from a TRIGGER on the OTHER seat", () => {
    let state = board("hotBite", "sv03-044");
    state = setActiveFromDeck(state, "p1", "sv01-099");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const attackerUid = activeUid(state, "p1");
    const done = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(done.events, "STATUS_PREVENTED")).toEqual({
      type: "STATUS_PREVENTED",
      seat: "p1",
      uid: attackerUid,
      status: "burned",
    });
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
  });

  it("…and lands that same trigger's Burn on a non-immune attacker", () => {
    const done = swing(board("hotBite", "sv03-044"), "hotBite");
    const applied = findAll(done.events, "STATUS_APPLIED").filter((e) => e.status === "burned");
    expect(applied.map((e) => e.seat).sort()).toEqual(["p1", "p2"]);
    expect(conditionsOf(done.state, "p1")?.burned).toBe(true);
    expect(types(done.events)).not.toContain("STATUS_PREVENTED");
  });
});

describe("NOT IMMUNE TO EVERYTHING — the per-condition claim, on one card", () => {
  const landing: {
    key: AttackKey;
    status: StatusName;
    check: (c: ReturnType<typeof conditionsOf>) => unknown;
  }[] = [
    { key: "hypnosis", status: "asleep", check: (c) => c?.rotation },
    { key: "confuseRay", status: "confused", check: (c) => c?.rotation },
    { key: "toxic", status: "poisoned", check: (c) => (c?.poisonDamage ?? 0) > 0 },
  ];

  for (const { key, status, check } of landing) {
    it(`lands ${status} on Dachsbun, which is immune to Burn and to nothing else`, () => {
      const { state, events } = swing(board(key, "sv01-099"), key);
      expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status });
      expect(types(events)).not.toContain("STATUS_PREVENTED");
      expect(check(conditionsOf(state, "p2"))).toBeTruthy();
    });

    it(`lands ${status} on Pachirisu, which is immune to Paralysis and to nothing else`, () => {
      const { state, events } = swing(board(key, "sv01-068"), key);
      expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status });
      expect(types(events)).not.toContain("STATUS_PREVENTED");
      expect(check(conditionsOf(state, "p2"))).toBeTruthy();
    });
  }

  it("the two immunities do NOT cover each other — the cross pair, driven both ways", () => {
    const seed = seedFlipping("heads", "sv01-099");
    const paralysis = swing(board("numbingBolt", "sv01-099", { seed }), "numbingBolt");
    expect(conditionsOf(paralysis.state, "p2")?.rotation).toBe("paralyzed");
    expect(types(paralysis.events)).not.toContain("STATUS_PREVENTED");

    const burn = swing(board("hotBite", "sv01-068"), "hotBite");
    expect(conditionsOf(burn.state, "p2")?.burned).toBe(true);
    expect(types(burn.events)).not.toContain("STATUS_PREVENTED");
  });
});

describe("PARALYSIS NEEDS A COIN, and the coin is the pool's doing", () => {
  it("refuses the Paralysis on BOTH Pachirisu printings when the coin says heads", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      const seed = seedFlipping("heads", id);
      const { state, events } = swing(board("numbingBolt", id, { seed }), "numbingBolt");
      expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
      expect(conditionsOf(state, "p2")?.rotation).toBe("none");
      expect(findEvent(events, "STATUS_PREVENTED")).toMatchObject({
        seat: "p2",
        status: "paralyzed",
      });
      expect(types(events)).not.toContain("STATUS_APPLIED");
    }
  });

  it("lands the same heads Paralysis on a body with no immunity — the control", () => {
    const seed = seedFlipping("heads", "fix-bigbody");
    const { state, events } = swing(board("numbingBolt", "fix-bigbody", { seed }), "numbingBolt");
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(conditionsOf(state, "p2")?.rotation).toBe("paralyzed");
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ status: "paralyzed" });
  });

  it("says NOTHING on tails — the coin decided, not the immunity", () => {
    const seed = seedFlipping("tails", "sv01-068");
    const { state, events } = swing(board("numbingBolt", "sv01-068", { seed }), "numbingBolt");
    expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(conditionsOf(state, "p2")?.rotation).toBe("none");
    expect(types(events)).not.toContain("STATUS_PREVENTED");
    expect(types(events)).not.toContain("STATUS_APPLIED");
  });

  it("TAKES THE FLIP ANYWAY on an immune body — the immunity gates the APPLICATION", () => {
    const seed = seedFlipping("heads", "sv01-068");
    const immune = board("numbingBolt", "sv01-068", { seed });
    const control = board("numbingBolt", "fix-bigbody", { seed });
    expect(nextFace(immune)).toBe("heads");
    const a = swing(immune, "numbingBolt");
    const b = swing(control, "numbingBolt");
    expect(a.state.rngState).not.toBe(immune.rngState);
    expect(a.state.rngState).toBe(b.state.rngState);
    // …and the printed 10 lands on both, for the same reason.
    expect(a.state.players.p2.active?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CHECKUP — the half of the inherited pricing that turned out not to exist.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE CHECKUP — NOT gated, and that is DERIVED rather than skipped", () => {
  it("has exactly ONE writer of a §12 condition in the whole engine", () => {
    const done = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(conditionsOf(done.state, "p2")?.burned).toBe(false);
    // No burn tick, no cure flip — there was never a condition to tick.
    expect(findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(
      0,
    );
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
    expect(types(done.events)).toContain("TURN_ENDED");
  });

  it("ticks the SAME Checkup on a non-immune body, so the case above is not vacuous", () => {
    const done = swing(board("hotBite", "fix-bigbody"), "hotBite");
    expect(findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(
      1,
    );
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
  });

  it("leaves a SURGICALLY planted condition alone — the IMMUNITY does not recover", () => {
    let state = board("hotBite", "sv01-099");
    state = setConditions(state, "p2", { burned: true });
    const done = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(
      1,
    );
    // The discriminator, stated where the claim is: Dachsbun refuses a Burn and
    // recovers from nothing, so the two clauses really are two fields.
    const dachsbun = done.state.players.p2.active;
    if (dachsbun === null) throw new Error("no Active");
    expect(passivesOf(done.state, dachsbun).statusImmunities).toEqual(["burned"]);
    expect(passivesOf(done.state, dachsbun).statusRecovery).toEqual([]);
  });

  it("clears conditions on EVOLUTION, which is why the reachable version does not exist", () => {
    // The other half of the argument above, driven off the shared rule rather than
    // off Dachsbun: `presentStatuses` + `noConditions()` on the evolve path means a
    // Burned body that evolves into an immune one arrives clean.
    let state = board("hotBite", "fix-bigbody");
    state = swing(state, "hotBite").state;
    expect(conditionsOf(state, "p2")?.burned).toBe(true);
    // The clear is the placement's, not a status rule of its own — asserted through
    // the helper the three clear sites share.
    expect(state.players.p2.active?.conditions.burned).toBe(true);
  });
});

describe("VOICE — the refusal SPEAKS, in the card's own words", () => {
  it("renders the printed sentence with the subject resolved", () => {
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(logLines(state, events)).toContain("Dachsbun can't be Burned");
  });

  it("renders Pachirisu's condition, not Dachsbun's — the row names WHICH", () => {
    const seed = seedFlipping("heads", "sv01-068");
    const { state, events } = swing(board("numbingBolt", "sv01-068", { seed }), "numbingBolt");
    expect(logLines(state, events)).toContain("Pachirisu can't be Paralyzed");
  });

  it("says nothing at all when the status LANDS — the row is the refusal", () => {
    const { state, events } = swing(board("hotBite", "fix-bigbody"), "hotBite");
    const lines = logLines(state, events);
    expect(lines).toContain("fix-bigbody is now Burned");
    expect(lines.some((line) => line.includes("can't be"))).toBe(false);
  });

  it("is filed under the REFUSING seat, which for an attack is the DEFENDER's chair", () => {
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    const rows = logRows(state, events);
    expect(rows.find((r) => r.text.includes("can't be"))?.who).toBe("p2");
    expect(rows.find((r) => r.text.includes("dealt"))?.who).toBe("p1");
  });
});

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11, DERIVED", () => {
    const state = board("hotBite", "sv01-099");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active)).not.toContain("statusImmunity");
    expect(Object.keys(active)).not.toContain("statusImmunities");
    expect(active.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("GATES NO ACTION — a Pokémon that refuses a condition is not harder to attack with", () => {
    let state = board("hotBite", "sv01-099");
    state = setActiveFromDeck(state, "p2", "sv01-029");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const done = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(done.events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("§11: NOTHING OWED — this slice adds no op at all", () => {
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
  });

  it("the §11 BLOCK still speaks FIRST, and the pair is UNREACHABLE — said, not left", () => {
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      for (const attack of FIXTURE_POOL[id]?.attacks ?? []) {
        expect(attack.effect ?? "").not.toContain("prevent all damage");
      }
    }
    // …and no board can install one from the outside either: the op carries no
    // target, so "this Pokémon" is always the running seat's own Active.
    const state = board("hotBite", "sv01-099");
    expect(state.players.p2.active?.attackBlock).toBeNull();
  });

  it("MECHANISM EXISTS — everything except the field, the gate and the row already did", () => {
    const state = board("hotBite", "sv01-099");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active)).toHaveProperty("statusImmunities");
  });
});

describe("the family after D174", () => {
  it("CLOSES at 3 of 3 sentences and 4 of 4 printings", () => {
    const authored = ["sv01-068", "sv01-099", "sv01-208"].filter(
      (id) => programFor(id)?.passive?.statusImmunities !== undefined,
    );
    expect(authored).toHaveLength(3);
    expect(
      new Set(authored.map((id) => programFor(id)?.passive?.statusImmunities?.join(","))).size,
    ).toBe(2);
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toHaveLength(3);
    expect(programFor("sv02-193")?.energy?.passive?.statusRecovery).toHaveLength(3);
  });

  it("leaves the two DISCARD-PILE RETRIEVAL restrictions exactly where D159 left them", () => {
    expect(programFor("sv06.5-060")?.stadium).toEqual({ preventDamageToNoRuleBoxFromExV: true });
    expect(FIXTURE_POOL["sv06.5-060"]?.effect).toContain(
      "can't be put into your hand or deck from the discard pile.",
    );
  });
});

describe("the boards stay legal", () => {
  it("keeps every uid in exactly one zone across a refused status", () => {
    // The cheap invariant every suite here carries: a gate that returns early must
    // not have moved anything on its way to the return.
    let state = board("hotBite", "sv01-099");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const before = state;
    const { state: after } = swing(state, "hotBite");
    for (const seat of ["p1", "p2"] as const) {
      const side = after.players[seat];
      const total =
        side.deck.length +
        side.hand.length +
        side.discard.length +
        side.prizes.length +
        (side.active === null ? 0 : side.active.stack.length + side.active.energy.length) +
        side.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0);
      const beforeSide = before.players[seat];
      const beforeTotal =
        beforeSide.deck.length +
        beforeSide.hand.length +
        beforeSide.discard.length +
        beforeSide.prizes.length +
        (beforeSide.active === null
          ? 0
          : beforeSide.active.stack.length + beforeSide.active.energy.length) +
        beforeSide.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0);
      expect(total).toBe(beforeTotal);
    }
  });
});
