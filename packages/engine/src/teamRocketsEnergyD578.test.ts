import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { ANY_ENERGY, constrainedEnergyTypes, constrainedEnergyUnit, costMet } from "./cards";
import {
  countAttachedEnergy,
  energyMayBeAttachedTo,
  providedEnergy,
  providesEnergyType,
} from "./continuous";
import type { GameEvent } from "./events";
import { advance } from "./flow";
import { resumeProgram, runProgram } from "./interpreter";
import { applyAction } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  specialEnergy,
  typedEnergy,
  must,
  mustApply as run,
  patchSide,
  driveSetup,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const TR_ENERGY = "sv10-182";
const TR_TEXT =
  "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.";
const TR_MON = "d578r-tr-mon";
const TR_EVO = "d578r-tr-evo";
const DEFECTOR = "d578r-defector";
const PLAIN = "d578r-plain";
const FILLER = "d578r-filler";
const P = "d578r-psychic";
const R = "d578r-fire";

const PD = constrainedEnergyUnit(["Psychic", "Darkness"]);

const body = (id: string, extra: Partial<Card>): Card =>
  battler(id, {
    name: id,
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
    ...extra,
  });

const LOCAL_CARDS: Record<string, Card> = {
  [TR_ENERGY]: specialEnergy(TR_ENERGY, "Team Rocket's Energy", TR_TEXT),
  [TR_MON]: body(TR_MON, {
    name: "Team Rocket's Mewtwo",
    types: ["Psychic"],
    attacks: [{ cost: ["Psychic", "Darkness"], name: "Dark Psy", damage: 60 }],
  }),
  [TR_EVO]: body(TR_EVO, {
    name: "Team Rocket's Evo",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Mewtwo",
  }),
  [DEFECTOR]: body(DEFECTOR, {
    name: "D578 Defector",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Mewtwo",
  }),
  [PLAIN]: body(PLAIN, {
    name: "D578 Plain",
    attacks: [{ cost: ["Psychic", "Darkness"], name: "Dark Psy", damage: 60 }],
  }),
  [FILLER]: body(FILLER, { name: "D578 Filler", retreat: 1 }),
  [P]: typedEnergy(P, "Psychic"),
  [R]: typedEnergy(R, "Fire"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [TR_ENERGY]: 4,
  [TR_MON]: 3,
  [TR_EVO]: 1,
  [DEFECTOR]: 1,
  [PLAIN]: 3,
  [FILLER]: 24,
  [P]: 4,
  [R]: 4,
  "fix-energy": 16,
});

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: patchSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: patchSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  under?: readonly string[];
  energy?: readonly string[];
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s; `hand` ids pulled into p1's hand. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p2: Spot;
  hand?: readonly string[];
}): GameState {
  let state = opened(5784);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = patchSide(state, seat, {
      hand: [],
      active: null,
      bench: [],
      deck: [...side.deck, ...back],
    });
  }
  const take = (seat: Seat, id: string): string => {
    const pulled = pull(state, seat, id);
    state = pulled.state;
    return pulled.uid;
  };
  const build = (seat: Seat, spot: Spot): InPlayPokemon => {
    const stack = [...(spot.under ?? []), spot.id].map((id) => take(seat, id));
    const energy = (spot.energy ?? []).map((id) => take(seat, id));
    return { ...makeInPlay(stack[0] ?? "", 0), stack, energy };
  };
  const p1Active = build("p1", opts.p1);
  const p1Bench = (opts.p1Bench ?? []).map((s) => build("p1", s));
  const p2Active = build("p2", opts.p2);
  state = patchSide(state, "p1", { active: p1Active, bench: p1Bench });
  state = patchSide(state, "p2", { active: p2Active, bench: [] });
  const hand = (opts.hand ?? []).map((id) => take("p1", id));
  return patchSide(state, "p1", { hand });
}

const active = (state: GameState, seat: Seat = "p1"): InPlayPokemon =>
  state.players[seat].active as InPlayPokemon;

describe("D578 Team Rocket's Energy §1 — the registry row and the ONE constrained set", () => {
  it("provides TWO {P}/{D} constrained units, restricted to Team Rocket's Pokémon", () => {
    expect(programFor(TR_ENERGY)).toEqual({
      energy: { provides: [PD, PD], attachOnlyToOwner: "Team Rocket" },
    });
    expect(constrainedEnergyTypes(PD)).toEqual(["Darkness", "Psychic"]);
    expect(constrainedEnergyUnit(["Darkness", "Psychic"])).toBe(PD);
    expect(constrainedEnergyTypes("Psychic")).toBeNull();
    expect(constrainedEnergyTypes(ANY_ENERGY)).toBeNull();
  });

  it("exactly ONE constrained set exists registry-wide — `costMet`'s greedy is exact only for laminar sets", () => {
    const sets = new Set<string>();
    for (const id of registryCardIds()) {
      const energy = programFor(id)?.energy;
      const units = [
        ...(energy?.provides ?? []),
        ...(energy?.demoteWithOtherSpecial ?? []),
        ...(energy?.promoteOnHolderStage?.units ?? []),
      ];
      for (const unit of units) if (constrainedEnergyTypes(unit) !== null) sets.add(unit);
    }
    expect([...sets]).toEqual([PD]);
  });
});

describe("D578 Team Rocket's Energy §2 — `costMet`: '2 in any combination of {P} and {D}'", () => {
  const two = [PD, PD];
  it.each([
    [["Psychic", "Psychic"], true],
    [["Psychic", "Darkness"], true],
    [["Darkness", "Darkness"], true],
    [["Psychic", "Colorless"], true],
    [["Colorless", "Colorless"], true],
    [["Fire"], false],
    [["Psychic", "Psychic", "Psychic"], false],
    [["Psychic", "Fire"], false],
  ] as const)("cost %j against two {P}/{D} units → %s", (cost, met) => {
    expect(costMet(cost, two)).toBe(met);
  });

  it("the narrowest unit pays first: [{P}/{D}, Any] pays {P}{W} (the constrained unit takes {P}, the wildcard {W})", () => {
    expect(costMet(["Psychic", "Water"], [PD, ANY_ENERGY])).toBe(true);
    expect(costMet(["Water", "Fire"], [PD, ANY_ENERGY])).toBe(false);
  });

  it("concrete units pay their own type first: [{P}, {P}/{D}] pays {P}{D} and {P}{P}", () => {
    expect(costMet(["Psychic", "Darkness"], ["Psychic", PD])).toBe(true);
    expect(costMet(["Psychic", "Psychic"], ["Psychic", PD])).toBe(true);
    expect(costMet(["Darkness", "Darkness"], ["Psychic", PD])).toBe(false);
  });
});

describe("D578 Team Rocket's Energy §3 — provision on a Team Rocket's Pokémon (R-TRE2)", () => {
  it("is a {P} Energy and a {D} Energy, not a {R} one; 'for each {P} Energy attached' counts the CARD once", () => {
    const state = table({ p1: { id: TR_MON, energy: [TR_ENERGY] }, p2: { id: PLAIN } });
    const tr = active(state);
    const uid = tr.energy[0] ?? "";
    expect(providedEnergy(state, tr)).toEqual([PD, PD]);
    expect(providesEnergyType(state, tr, uid, "Psychic")).toBe(true);
    expect(providesEnergyType(state, tr, uid, "Darkness")).toBe(true);
    expect(providesEnergyType(state, tr, uid, "Fire")).toBe(false);
    expect(countAttachedEnergy(state, tr, "Psychic")).toBe(1);
    expect(countAttachedEnergy(state, tr, "Darkness")).toBe(1);
  });

  it("pays a {P}{D} attack on its own", () => {
    const state = table({ p1: { id: TR_MON, energy: [TR_ENERGY] }, p2: { id: PLAIN } });
    const events = run(state, { type: "attack", seat: "p1", index: 0 }).events;
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 60 });
  });
});

describe("D578 Team Rocket's Energy §4 — 'can only be attached to a Team Rocket's Pokémon'", () => {
  it("the hand attach onto a Team Rocket's Pokémon is accepted", () => {
    const state = table({ p1: { id: TR_MON }, p2: { id: PLAIN }, hand: [TR_ENERGY] });
    const uid = state.players.p1.hand[0] ?? "";
    const after = run(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    }).state;
    expect(active(after).energy).toEqual([uid]);
  });

  it("onto any other Pokémon it is REFUSED (BAD_TARGET), the card stays in hand and the allowance is NOT spent", () => {
    const state = table({
      p1: { id: PLAIN },
      p1Bench: [{ id: TR_MON }],
      p2: { id: PLAIN },
      hand: [TR_ENERGY, P],
    });
    const [trUid, pUid] = state.players.p1.hand;
    expect(
      rejected(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: trUid ?? "",
        target: { spot: "active" },
      }),
    ).toBe("BAD_TARGET");
    const after = run(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: pUid ?? "",
      target: { spot: "active" },
    }).state;
    expect(active(after).energy).toEqual([pUid]);
    expect(after.players.p1.hand).toEqual([trUid]);
  });

  it("onto the Benched Team Rocket's Pokémon it is accepted", () => {
    const state = table({
      p1: { id: PLAIN },
      p1Bench: [{ id: TR_MON }],
      p2: { id: PLAIN },
      hand: [TR_ENERGY],
    });
    const uid = state.players.p1.hand[0] ?? "";
    const after = run(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "bench", index: 0 },
    }).state;
    expect(after.players.p1.bench[0]?.energy).toEqual([uid]);
  });

  it("`energyMayBeAttachedTo`: false only for the restricted card off its owner; true for every other Energy", () => {
    const state = table({ p1: { id: PLAIN }, p1Bench: [{ id: TR_MON }], p2: { id: PLAIN } });
    expect(energyMayBeAttachedTo(state, POOL[TR_ENERGY], active(state))).toBe(false);
    expect(
      energyMayBeAttachedTo(state, POOL[TR_ENERGY], state.players.p1.bench[0] as InPlayPokemon),
    ).toBe(true);
    expect(energyMayBeAttachedTo(state, POOL[P], active(state))).toBe(true);
  });
});

describe("D578 Team Rocket's Energy §5 — 'If this card is attached to anything other than … discard this card' (R-TRE1)", () => {
  it("on a non-Team Rocket's body (a 0.461 record put it there — surgery here) it provides NOTHING, and the next `advance` discards it", () => {
    const state = table({ p1: { id: PLAIN, energy: [TR_ENERGY] }, p2: { id: PLAIN } });
    const uid = active(state).energy[0] ?? "";
    expect(providedEnergy(state, active(state))).toEqual([]);
    expect(rejected(state, { type: "attack", seat: "p1", index: 0 })).toBe("ATTACK_COST_UNMET");
    const { state: after, events } = run(state, { type: "endTurn", seat: "p1" });
    expect(after.players.p1.active?.energy).toEqual([]);
    expect(after.players.p1.discard).toContain(uid);
    expect(events[0]).toEqual({
      type: "ENERGY_DISCARDED",
      seat: "p1",
      actor: "p1",
      uids: [uid],
      from: { spot: "active" },
      host: active(state).stack[0],
    });
  });

  it("the holder is read by its TOP card: an evolved Team Rocket's Pokémon keeps it through the drain", () => {
    const state = table({
      p1: { id: TR_EVO, under: [TR_MON], energy: [TR_ENERGY] },
      p2: { id: PLAIN },
    });
    // The Stage 1 is a Team Rocket's Pokémon too, so the card stays.
    expect(energyMayBeAttachedTo(state, POOL[TR_ENERGY], active(state))).toBe(true);
    const after = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(after.players.p1.active?.energy).toHaveLength(1);
  });

  it("the sweep is the IDENTITY on a board without a misplaced card (`advance` hands the same object back)", () => {
    const state = table({ p1: { id: TR_MON, energy: [TR_ENERGY] }, p2: { id: PLAIN } });
    const result = advance({ ...state, pending: [] }, []);
    if (!result.ok) throw new Error("advance failed");
    expect(result.state.players).toBe(state.players);
    expect(result.events).toEqual([]);
  });

  it("both seats are swept: a card on the OPPONENT's non-Team Rocket's body is discarded into THEIR pile", () => {
    let state = table({ p1: { id: TR_MON }, p2: { id: PLAIN } });
    const pulled = pull(state, "p2", TR_ENERGY);
    state = patchSide(pulled.state, "p2", {
      active: { ...active(pulled.state, "p2"), energy: [pulled.uid] },
    });
    const after = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(after.players.p2.discard).toContain(pulled.uid);
    expect(after.players.p2.active?.energy).toEqual([]);
  });
});

describe("D578 Team Rocket's Energy §6 — R-TRE1 (RULED: fixed at the landing): it never REMAINS on a non-Team Rocket's body", () => {
  const discardHolding = (state: GameState): { state: GameState; uid: string } => {
    const pulled = pull(state, "p1", TR_ENERGY);
    return {
      uid: pulled.uid,
      state: patchSide(pulled.state, "p1", {
        discard: [...pulled.state.players.p1.discard, pulled.uid],
      }),
    };
  };

  it("an op inside a program that attaches it to one: discarded at THAT step, before the program's next op (`runProgram`)", () => {
    const { state, uid } = discardHolding(table({ p1: { id: PLAIN }, p2: { id: PLAIN } }));
    const events: GameEvent[] = [];
    // A forced attach (one identity, one body — Reboot Pod's inline path), straight through the
    // runner: no action wrapper and no `advance` behind it.
    const result = runProgram(
      state,
      [{ op: "attachFromDiscard", filter: { kind: "anyEnergy" }, max: 1, each: true }],
      { seat: "p1" },
      {},
      events,
    );
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(result.state.players.p1.discard).toContain(uid);
    expect(events.map((e) => e.type)).toEqual(["ENERGY_ATTACHED", "ENERGY_DISCARDED"]);
  });

  it("a PARKED attach answered onto one: discarded as the answer lands (`resumeProgram`)", () => {
    const { state, uid } = discardHolding(table({ p1: { id: PLAIN }, p2: { id: PLAIN } }));
    const events: GameEvent[] = [];
    const result = resumeProgram(
      state,
      {
        pendingOp: { op: "attachFromDiscard", filter: { kind: "anyEnergy" }, max: 1 },
        rest: [],
        ctx: { seat: "p1" },
      },
      { kind: "attachCards", assignments: [{ uid, to: { seat: "p1", spot: { spot: "active" } } }] },
      events,
    );
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(result.state.players.p1.discard).toContain(uid);
    expect(events.some((e) => e.type === "ENERGY_DISCARDED")).toBe(true);
  });

  it("a non-program route with no drain (an evolve onto a different owner): discarded before the action returns (`applyAction`)", () => {
    const table4 = table({
      p1: { id: TR_MON, energy: [TR_ENERGY] },
      p2: { id: PLAIN },
      hand: [DEFECTOR],
    });
    const state: GameState = { ...table4, turn: 4 };
    const energyUid = active(state).energy[0] ?? "";
    const evoUid = state.players.p1.hand[0] ?? "";
    const { state: after, events } = run(state, {
      type: "evolve",
      seat: "p1",
      uid: evoUid,
      target: { spot: "active" },
    });
    expect(active(after).stack).toContain(evoUid);
    expect(active(after).energy).toEqual([]);
    expect(after.players.p1.discard).toContain(energyUid);
    expect(after.phase.kind).toBe("turn:action");
    expect(events.at(-1)).toMatchObject({
      type: "ENERGY_DISCARDED",
      seat: "p1",
      uids: [energyUid],
    });
  });

  it("`advance` itself still sweeps (a 0.461-era record's first drain)", () => {
    const state = table({ p1: { id: PLAIN, energy: [TR_ENERGY] }, p2: { id: PLAIN } });
    const uid = active(state).energy[0] ?? "";
    const result = advance({ ...state, pending: [] }, []);
    if (!result.ok) throw new Error("advance failed");
    expect(result.state.players.p1.discard).toContain(uid);
    expect(result.state.players.p1.active?.energy).toEqual([]);
  });
});
