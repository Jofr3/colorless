import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  SPECIAL_ENERGY_SEAM_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const BITE = 0;
const YAWN = 4;
const CLUTCH = 5;

const MIST_PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nPrevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)";
const ENRICHING_PRINTED =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to a Pokémon, draw 4 cards.";

function drawEvents(events: GameEvent[]): Extract<GameEvent, { type: "CARDS_DRAWN" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => {
    return e.type === "CARDS_DRAWN";
  });
}

function board(activeId: string, energyId: string | null, bench: string[] = []): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", activeId);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  if (energyId !== null) state = attachFromDeck(state, "p2", energyId, 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function lockedBoard(): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-unaware");
  state = attachFromDeck(state, "p2", "fix-mist-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return setActiveFromDeck(state, "p1", "sv01-096");
}

function inHand(cardId: string): GameState {
  let state = driveSetup(
    1,
    { p1: SPECIAL_ENERGY_SEAM_DECK, p2: SPECIAL_ENERGY_SEAM_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  return handFromDeck(state, "p2", cardId, 1);
}

describe("Mist / Enriching Energy — the registry data rows", () => {
  it("authors sv05-161 as an EnergyProgram passive, not a Pokémon passive", () => {
    expect(programFor("sv05-161")?.energy).toEqual({
      provides: ["Colorless"],
      passive: { preventAttackEffects: true },
    });
    expect(programFor("sv05-161")?.passive).toBeUndefined();
  });

  it("authors sv08-191 as an EnergyProgram onAttach carrying the printed COUNT", () => {
    expect(programFor("sv08-191")?.energy).toEqual({
      provides: ["Colorless"],
      onAttach: { kind: "draw", count: 4 },
    });
  });

  it("keeps the two sentences on two fields — neither row carries the other's", () => {
    expect(programFor("sv05-161")?.energy?.onAttach).toBeUndefined();
    expect(programFor("sv08-191")?.energy?.passive).toBeUndefined();
  });

  it("carries NO damage-half field, and no GROUP field, on the Mist row", () => {
    const passive = programFor("sv05-161")?.energy?.passive;
    expect(passive?.preventDamageAndEffectsFromSpecialEnergy).toBeUndefined();
    expect(passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    expect(passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(passive?.preventAttackEffectsForGroup).toBeUndefined();
  });

  it("provisions {C} through the same field Jet and Spiky use", () => {
    for (const id of ["sv05-161", "sv08-191", "sv02-190", "sv09-159"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("authors NOTHING on the TWO remaining Special Energy sentences ( D577: ONE — `sv06-166` BUILT; D578: NONE — `sv10-182` BUILT)", () => {
    expect(programFor("sv06-166"), "sv06-166 is BUILT at D577").toBeDefined();
    expect(programFor("sv10-182"), "sv10-182 is BUILT at D578").toBeDefined();
    for (const id of [] as string[]) {
      expect(programFor(id), `${id} is counted UNBUILT`).toBeUndefined();
    }
    expect(programFor("sv05-162"), "sv05-162 is BUILT at D262").toBeDefined();
    expect(programFor("sv06-167"), "sv06-167 is BUILT at D298").toBeDefined();
  });

  it("carries the printed sentence on both fixture demonstrators", () => {
    expect(FIXTURE_POOL["fix-mist-energy"]?.effect).toBe(MIST_PRINTED);
    expect(FIXTURE_POOL["fix-enriching-energy"]?.effect).toBe(ENRICHING_PRINTED);
  });
});

describe("Mist Energy — the shield rides an ATTACHED ENERGY (a passivesOf fold)", () => {
  it("folds preventAttackEffects off the ENERGY onto its holder and nobody else", () => {
    const state = board("fix-bigbody", "fix-mist-energy", ["fix-titan"]);
    const holder = state.players.p2.active;
    const neighbour = state.players.p2.bench[0];
    if (holder === null || neighbour === undefined) throw new Error("board not set up");

    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
    expect(passivesOf(state, neighbour).preventAttackEffects).toBe(false);
  });

  it("is not granted by just any attached Special Energy", () => {
    const state = board("fix-bigbody", "fix-special");
    const holder = state.players.p2.active;
    if (holder === null) throw new Error("no active");

    expect(holder.energy).toHaveLength(1);
    expect(passivesOf(state, holder).preventAttackEffects).toBe(false);
  });

  it("refuses an attack's applyStatus with ONE announced refusal", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: YAWN });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("refuses an attack's preventRetreat off the SAME gate", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: CLUTCH });

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  it("lets DAMAGE through in full — the printed parenthetical, on a real board", () => {
    const state = board("fix-bigbody", "fix-mist-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: BITE });

    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });

  it("answers identically from the BENCH — the sentence prints no zone clause", () => {
    let state = board("fix-titan", null, ["fix-bigbody"]);
    state = attachBenchFromDeck(state, "p2", 0, "fix-mist-energy", 1);
    const benched = state.players.p2.bench[0];
    const active = state.players.p2.active;
    if (benched === undefined || active === null) throw new Error("board not set up");

    expect(passivesOf(state, benched).preventAttackEffects).toBe(true);
    // …and the Active, which holds none, is untouched — the fold is PER BODY.
    expect(passivesOf(state, active).preventAttackEffects).toBe(false);
  });

  it("does not remove an effect already installed — driven, not asserted", () => {
    const before = board("fix-bigbody", null);
    const asleep = mustApply(before, { type: "attack", seat: "p1", index: YAWN }).state;
    expect(asleep.players.p2.active?.conditions.rotation).toBe("asleep");

    const shielded = attachFromDeck(asleep, "p2", "fix-mist-energy", 1);
    expect(shielded.players.p2.active?.conditions.rotation).toBe("asleep");

    const holder = shielded.players.p2.active;
    if (holder === null) throw new Error("no active");
    expect(passivesOf(shielded, holder).preventAttackEffects).toBe(true);
  });
});

describe("§9 — the SAME fold field answers OPPOSITELY for an Ability and an Energy", () => {
  it("silences Skeledirge's Ability and leaves Mist Energy's shield standing", () => {
    const state = lockedBoard();
    const holder = state.players.p2.active;
    const skeledirge = state.players.p2.bench[0];
    if (holder === null || skeledirge === undefined) throw new Error("board not set up");

    expect(passivesOf(state, skeledirge).preventAttackEffects).toBe(false);
    expect(passivesOf(state, holder).preventAttackEffects).toBe(true);
  });

  it("proves the lock is LIVE — Skeledirge answers TRUE with Klefki gone", () => {
    const state = board("fix-bigbody", "fix-mist-energy", ["fix-unaware"]);
    const skeledirge = state.players.p2.bench[0];
    if (skeledirge === undefined) throw new Error("no benched Skeledirge");

    expect(passivesOf(state, skeledirge).preventAttackEffects).toBe(true);
  });
});

describe("Enriching Energy — the SECOND EnergyOnAttach arm", () => {
  it("draws 4 on an ACTIVE attach, and the hand nets +3", () => {
    const state = inHand("fix-enriching-energy");
    const uid = handUid(state, "p2", "fix-enriching-energy");
    const handBefore = state.players.p2.hand.length;
    const deckBefore = state.players.p2.deck.length;
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "active" },
    });

    const drawn = drawEvents(events);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.uids).toHaveLength(4);
    expect(drawn[0]?.reason).toBe("effect");
    expect(drawn[0]?.seat).toBe("p2");
    // one card LEFT the hand to become the attachment, four arrived.
    expect(done.players.p2.hand).toHaveLength(handBefore - 1 + 4);
    expect(done.players.p2.deck).toHaveLength(deckBefore - 4);
    expect(done.players.p2.active?.energy).toContain(uid);
  });

  it("draws 4 on a BENCH attach too, and switches NOTHING", () => {
    const state = inHand("fix-enriching-energy");
    const uid = handUid(state, "p2", "fix-enriching-energy");
    const activeBefore = state.players.p2.active?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(drawEvents(events)[0]?.uids).toHaveLength(4);
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
    expect(done.players.p2.active?.stack.at(-1)).toBe(activeBefore);
    expect(done.players.p2.bench[0]?.energy).toContain(uid);
  });

  it("leaves Jet Energy's arm alone — it switches and draws nothing", () => {
    const state = inHand("sv02-190");
    const uid = handUid(state, "p2", "sv02-190");
    deepFreeze(state);

    const { events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(types(events)).toContain("POKEMON_SWITCHED");
    expect(drawEvents(events)).toHaveLength(0);
  });

  it("fires no arm at all for an unauthored Special Energy", () => {
    const state = inHand("fix-special");
    const uid = handUid(state, "p2", "fix-special");

    const { events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "bench", index: 0 },
    });

    expect(drawEvents(events)).toHaveLength(0);
    expect(types(events)).not.toContain("POKEMON_SWITCHED");
  });

  it("draws nothing when the §6.2 allowance is already spent", () => {
    let state = inHand("fix-enriching-energy");
    state = handFromDeck(state, "p2", "fix-energy", 1);
    const first = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "fix-energy"),
      target: { spot: "active" },
    }).state;

    expectErr(
      first,
      {
        type: "attachEnergy",
        seat: "p2",
        uid: handUid(first, "p2", "fix-enriching-energy"),
        target: { spot: "active" },
      },
      "ENERGY_ALREADY_ATTACHED",
    );
  });
});
