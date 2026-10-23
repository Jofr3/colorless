import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  ATTACH_DECK,
  activeUid,
  benchFromDeck,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

/** Setup then open P1's turn 2 (P2 first + pass) — P1's first unrestricted turn. */
function attachBoard(seed: number): GameState {
  const state = driveSetup(seed, { p1: ATTACH_DECK, p2: ATTACH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function answerEnergyPick(state: GameState): { state: GameState; events: GameEvent[] } {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards")
    return { state, events: [] };
  expect(phase.prompt).toMatchObject({ dest: "attach", min: 1, max: 1 });
  const water = phase.prompt.candidates.find((u) => state.cardIdByUid[u] === "fix-water-energy");
  const uid = water ?? (phase.prompt.candidates[0] as string);
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [uid] },
  });
}

function useAttach(
  state: GameState,
  abilityName: string,
  ref: PokemonRef,
): { state: GameState; uid: string | undefined } {
  const first = mustApply(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName,
  });
  if (first.state.phase.kind !== "effect:choose") {
    return { state: first.state, uid: findEvent(first.events, "ENERGY_ATTACHED")?.uid }; // forced
  }
  const atTarget =
    first.state.phase.prompt.kind === "choosePokemon"
      ? mustApply(first.state, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref },
        })
      : first;
  const res = answerEnergyPick(atTarget.state);
  const events = [...atTarget.events, ...res.events];
  return { state: res.state, uid: findEvent(events, "ENERGY_ATTACHED")?.uid };
}

describe("attachEnergyFrom — the §6 energy-acceleration op", () => {
  it("Quaquaval attaches a Basic Energy from hand, parking on the target choice", () => {
    let state = attachBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-054"); // Quaquaval Active (+ setup body benched)
    state = benchFromDeck(state, "p1", "fix-basic-1"); // ≥2 targets → a real choice
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    const quaqUid = activeUid(state, "p1");

    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Energy Carnival",
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("choosePokemon");

    const targeted = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: ACTIVE_REF },
    });
    const { state: done, events } = answerEnergyPick(targeted.state);
    const attached = findEvent(events, "ENERGY_ATTACHED");
    expect(attached).toMatchObject({ seat: "p1" });
    const uid = attached?.uid;
    if (uid === undefined) throw new Error("no ENERGY_ATTACHED");
    // The Energy left hand and rode onto the chosen Pokémon (the Active).
    expect(done.players.p1.hand).not.toContain(uid);
    expect(done.players.p1.active?.energy).toContain(uid);
    expect(activeUid(done, "p1")).toBe(quaqUid); // the attach did not disturb the stack top
    expect(done.phase.kind).toBe("turn:action");
  });

  it("can attach to a BENCHED Pokémon (the chosen target, not just the Active)", () => {
    let state = attachBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-054");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    // Attach to the last bench slot (the displaced setup body / the added one).
    const benchIndex = state.players.p1.bench.length - 1;
    const { state: done, uid } = useAttach(state, "Energy Carnival", {
      seat: "p1",
      spot: { spot: "bench", index: benchIndex },
    });
    if (uid === undefined) throw new Error("no ENERGY_ATTACHED");
    expect(done.players.p1.bench[benchIndex]?.energy).toContain(uid);
    expect(done.players.p1.active?.energy ?? []).not.toContain(uid);
  });

  it("Baxcalibur's Super Cold attaches a Basic {W} and is REPEATABLE (oncePerTurn:false)", () => {
    let state = attachBoard(2);
    state = setActiveFromDeck(state, "p1", "sv02-060"); // Baxcalibur Active
    state = handToDeck(state, "p1", "fix-energy"); // clear stray Colorless so {W} is unambiguous
    state = handFromDeck(state, "p1", "fix-water-energy", 2);
    const s1 = useAttach(state, "Super Cold", ACTIVE_REF).state;
    expect(s1.players.p1.active?.energy.length).toBe(1);
    // A SECOND use the same turn is allowed (repeatable) — mustApply throws if rejected.
    const s2 = useAttach(s1, "Super Cold", ACTIVE_REF).state;
    expect(s2.players.p1.active?.energy.length).toBe(2);
  });

  it("Quaquaval (once/turn) rejects a second use in the same turn", () => {
    let state = attachBoard(3);
    state = setActiveFromDeck(state, "p1", "sv01-054");
    state = handFromDeck(state, "p1", "fix-water-energy", 2);
    const s1 = useAttach(state, "Energy Carnival", ACTIVE_REF).state;
    expectErr(
      s1,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "active" },
        abilityName: "Energy Carnival",
      },
      "ABILITY_ALREADY_USED",
    );
  });

  it("attaches a Basic Energy from the DISCARD pile (fix-attacher, type-filtered)", () => {
    let state = attachBoard(4);
    state = setActiveFromDeck(state, "p1", "fix-attacher");
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1); // a Fire Basic in discard
    const energyUid = state.players.p1.discard.find(
      (u) => state.cardIdByUid[u] === "fix-fire-energy",
    );
    if (energyUid === undefined) throw new Error("no fix-fire-energy in discard");
    const { state: done } = useAttach(state, "Recharge", ACTIVE_REF);
    // Moved OUT of the discard, onto the Active.
    expect(done.players.p1.discard).not.toContain(energyUid);
    expect(done.players.p1.active?.energy).toContain(energyUid);
  });

  it("rejects the Ability when the source holds no matching Energy (type filter → whiff)", () => {
    let state = attachBoard(5);
    state = setActiveFromDeck(state, "p1", "sv02-060"); // Baxcalibur needs a Basic {W}
    state = handToDeck(state, "p1", "fix-water-energy"); // remove every {W} from hand
    state = handFromDeck(state, "p1", "fix-fire-energy", 1); // a NON-{W} Basic is present...
    // ...but Super Cold needs {W} specifically → no legal attach → reject.
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Super Cold" },
      "NO_LEGAL_TARGET",
    );
  });

  it("wire-safety — an attach target that is not one of your own Pokémon is rejected", () => {
    let state = attachBoard(1);
    state = setActiveFromDeck(state, "p1", "sv01-054");
    state = benchFromDeck(state, "p1", "fix-basic-1"); // ≥2 targets → it parks
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    const parked = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Energy Carnival",
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("never mutates the input state (frozen board survives an attach)", () => {
    let state = attachBoard(2);
    state = setActiveFromDeck(state, "p1", "sv01-054");
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    expect(() =>
      applyAction(deepFreeze(state), {
        type: "useAbility",
        seat: "p1",
        target: { spot: "active" },
        abilityName: "Energy Carnival",
      }),
    ).not.toThrow();
  });
});
