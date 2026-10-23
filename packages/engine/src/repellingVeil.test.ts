import { describe, expect, it } from "vitest";
import { groupShieldedFromAttackEffects, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ATTACK_EFFECT_SHIELD_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const BITE = 0;
const YAWN = 4;
const CLUTCH = 5;

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function board(activeId: string, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: ATTACK_EFFECT_SHIELD_DECK, p2: ATTACK_EFFECT_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function lockedFromAcross(activeId: string, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: ATTACK_EFFECT_SHIELD_DECK, p2: ATTACK_EFFECT_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "sv01-096");
}

describe("Unaware / Repelling Veil — the registry data rows", () => {
  it("authors sv08-031 as a bare preventAttackEffects passive", () => {
    expect(programFor("sv08-031")?.passive).toEqual({ preventAttackEffects: true });
  });

  it("authors sv10-051 as a preventAttackEffectsForGroup carrying the printed noun phrase", () => {
    expect(programFor("sv10-051")?.passive).toEqual({
      preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
    });
  });

  it("keeps the two sentences on two fields — neither row carries the other's", () => {
    expect(programFor("sv08-031")?.passive?.preventAttackEffectsForGroup).toBeUndefined();
    expect(programFor("sv10-051")?.passive?.preventAttackEffects).toBeUndefined();
  });

  it("authors nothing on the neighbouring prevention rows", () => {
    for (const id of ["sv10.5b-023", "sv06-020", "sv05-024", "sv06.5-045", "sv07-076"]) {
      expect(programFor(id)?.passive?.preventAttackEffects, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventAttackEffectsForGroup, id).toBeUndefined();
    }
  });

  it("carries NO damage-half field on either row", () => {
    for (const id of ["sv08-031", "sv10-051"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
      expect(programFor(id)?.passive?.preventBenchDamageAndEffects, id).toBeUndefined();
    }
  });

  it("carries the printed sentence on both fixture demonstrators", () => {
    expect(FIXTURE_POOL["fix-unaware"]?.abilities?.[0]?.effect).toBe(
      "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    );
    expect(FIXTURE_POOL["fix-repellingveil"]?.abilities?.[0]?.effect).toBe(
      "Prevent all effects of attacks used by your opponent's Pokémon done to your Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is not an effect.)",
    );
  });

  it("names the group holder so it is a member of its own group", () => {
    expect(FIXTURE_POOL["fix-repellingveil"]?.name).toBe("Team Rocket's Fixicuno");
    expect(FIXTURE_POOL["fix-repellingveil"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-tr-stage1"]?.stage).toBe("Stage1");
  });
});

describe("Unaware — the HOLDER rule (a passivesOf fold)", () => {
  it("folds preventAttackEffects onto the holder and onto nobody else", () => {
    const state = board("fix-unaware", ["fix-bigbody"]);
    const holder = state.players.p2.active;
    const neighbour = state.players.p2.bench[0];
    if (holder === null || neighbour === undefined) throw new Error("board not set up");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
    expect(passivesOf(state, neighbour).preventAttackEffects).toBe(false);
  });

  it("refuses an attack's applyStatus with ONE announced refusal", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("refuses an attack's preventRetreat off the SAME gate", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  it("lets DAMAGE through in full — the printed parenthetical, on a real board", () => {
    const state = board("fix-unaware");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  it("answers identically from the BENCH — the sentence prints no zone clause", () => {
    const state = board("fix-bigbody", ["fix-unaware"]);
    const benched = state.players.p2.bench[0];
    if (benched === undefined) throw new Error("no benched holder");

    expect(idOf(state, benched.stack.at(-1))).toBe("fix-unaware");
    expect(passivesOf(state, benched).preventAttackEffects).toBe(true);
  });

  it("is silenced by an Ability lock from across the table", () => {
    const state = lockedFromAcross("fix-unaware");
    const holder = state.players.p2.active;
    if (holder === null) throw new Error("no active");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(false);
  });
});

describe("Repelling Veil — the TARGET-GROUP rule (a scan, not a fold)", () => {
  it("shields a group member the holder is NOT, from the bench", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("shields ITSELF — the source set contains the target set", () => {
    const state = board("fix-repellingveil");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("does NOT shield a Stage 1 Team Rocket's Pokémon", () => {
    const state = board("fix-tr-stage1", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  it("does NOT shield a body whose name merely CONTAINS the prefix", () => {
    const state = board("fix-not-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  it("does NOT shield a group member with no holder in play", () => {
    const state = board("fix-tr-body");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  it("lets DAMAGE through in full onto a shielded group member", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  // §9 PER SOURCE — the lock is on the HOLDER and not on the shielded body, which
  // is the direction that matters: the target here carries no Ability at all.
  it("is silenced by an Ability lock over the SOURCE", () => {
    const state = lockedFromAcross("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(false);
  });
});

describe("groupShieldedFromAttackEffects — the scan itself", () => {
  // SEAT-BLIND on purpose: the caller hands us one of a side's own entries and the
  // scan DERIVES the seat, which is what keeps the funnel's signature untouched.
  it("derives the seat rather than taking one", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(true);
  });

  it("never reaches across the table — the printed word is YOUR", () => {
    let state = board("fix-tr-body", ["fix-repellingveil"]);
    state = benchFromDeck(state, "p1", "fix-tr-body");
    const across = state.players.p1.bench.find(
      (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-tr-body",
    );
    if (across === undefined) throw new Error("no p1 group body");

    expect(groupShieldedFromAttackEffects(state, across)).toBe(false);
  });

  it("matches by TOP UID, so a rebuilt-by-value copy still answers TRUE", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, { ...target, damage: 10 })).toBe(true);
  });

  it("answers FALSE for a body that is not in play at all", () => {
    const state = board("fix-tr-body", ["fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, { ...target, stack: [] })).toBe(false);
  });

  it("finds a holder standing LAST on the bench, not just the first body", () => {
    const state = board("fix-tr-body", ["fix-bigbody", "fix-bigbody", "fix-repellingveil"]);
    const target = state.players.p2.active;
    if (target === null) throw new Error("no active");

    expect(groupShieldedFromAttackEffects(state, target)).toBe(true);
  });
});

describe("(Existing effects are not removed.) — the printed clause, DRIVEN", () => {
  it("does not retroactively clear a status installed before the shield came up", () => {
    let state = board("fix-tr-body");

    // 1. No holder anywhere — the Yawn lands.
    const first = mustApply(state, { type: "attack", seat: "p1", index: YAWN });
    expect(types(first.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(first.state.players.p2.active?.conditions.rotation).toBe("asleep");

    // 2. The shield comes up on the already-Asleep body's own side.
    state = benchFromDeck(first.state, "p2", "fix-repellingveil");
    expect(state.players.p2.active?.conditions.rotation).toBe("asleep");

    // 3. …and the gate is CLOSED from here on, which is the other half of the
    //    claim: the aura installs nothing and removes nothing, it only refuses.
    const shielded = state.players.p2.active;
    if (shielded === null) throw new Error("no active");
    expect(groupShieldedFromAttackEffects(state, shielded)).toBe(true);

    // 4. …driven, on the next turn's attack: the SAME funnel now refuses, and the
    //    Sleep that was already there is untouched by the refusal.
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const second = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(second.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(second.state.players.p2.active?.retreatBlocked).toBe(false);
  });
});
