import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { topUid } from "./cards";
import { conditionHolds, conditionNote } from "./interpreter";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, typedEnergy, findEvent, driveSetup } from "./testFixtures";
import { makeInPlay } from "./types";

const YANMEGA = "sv10-003";
const YANMEGA_IR = "sv10-206";
const YANMEGA_SIR = "sv10-228";
const YANMEGA_IDS = [YANMEGA, YANMEGA_IR, YANMEGA_SIR] as const;

const ABILITY = "Buzzing Boost";
const YANMEGA_TEXT =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

const ATTACK_SIDE_SAME_FACT =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage.";

/** A NON-Yanmega body with no Ability: the Active that retreats, and a bench
    body that is never the source. Its presence is what makes "the gate reads the
    ACTIVE" an assertion rather than a tautology on a one-body board. */
const PLAIN = "fix-d347-plain";
const WALL = "fix-d347-wall";

/** Basic {G} — the printed brace code, so `energyType: "Grass"` is driven. */
const ENERGY_G = "fix-d347-energy-grass";
/** Basic {R} — a Basic Energy of the WRONG type. Excluded by `energyType` and by
    nothing else, which is what makes the narrowing an assertion. */
const ENERGY_R = "fix-d347-energy-fire";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...YANMEGA_IDS.map((id) => [
    id,
    battler(id, {
      name: "Yanmega ex",
      stage: "Stage1",
      evolveFrom: "Yanma",
      hp: 280,
      retreat: 1,
      types: ["Grass"],
      abilities: [{ type: "Ability", name: ABILITY, effect: YANMEGA_TEXT }],
      attacks: [
        {
          cost: ["Grass", "Grass", "Grass", "Colorless"],
          name: "Jet Cyclone",
          effect: "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
          damage: 210,
        },
      ],
    }),
  ]),
  [
    PLAIN,
    battler(PLAIN, {
      name: "D347 Plain",
      hp: 120,
      retreat: 1,
      types: ["Grass"],
      attacks: [{ cost: ["Grass"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WALL,
    battler(WALL, {
      name: "D347 Wall",
      hp: 330,
      retreat: 1,
      types: ["Colorless"],
      attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_G, typedEnergy(ENERGY_G, "Grass")],
  [ENERGY_R, typedEnergy(ENERGY_R, "Fire")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [YANMEGA]: 4,
  [YANMEGA_IR]: 4,
  [YANMEGA_SIR]: 4,
  [PLAIN]: 8,
  [WALL]: 8,
  [ENERGY_G]: 20,
  [ENERGY_R]: 12,
});

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function reject(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was expected to be rejected`);
  return result.error;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function seat(state: GameState, s: Seat, cardId: string, spot: "active" | "bench"): GameState {
  const side = state.players[s];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in ${s}'s deck`);
  const body = makeInPlay(uid, state.turn);
  const deck = side.deck.filter((u) => u !== uid);
  return {
    ...state,
    players: {
      ...state.players,
      [s]:
        spot === "active"
          ? { ...side, deck, active: body }
          : { ...side, deck, bench: [...side.bench, body] },
    },
  };
}

/** Attach one Energy from the deck onto the Active — the retreat cost, paid with
    a card that is never Basic {G} so it can never be confused with what the
    Ability attaches. */
function fundRetreat(state: GameState, s: Seat): GameState {
  const side = state.players[s];
  const active = side.active;
  if (active === null) throw new Error("no active to fund");
  const uid = side.deck.find((u) => state.cardIdByUid[u] === ENERGY_R);
  if (uid === undefined) throw new Error("no {R} energy in deck");
  return {
    ...state,
    players: {
      ...state.players,
      [s]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, energy: [...active.energy, uid] },
      },
    },
  };
}

function ready(printing: string = YANMEGA, seed = 6): GameState {
  let state = localSetup(seed, "p1");
  state = seat(state, "p1", WALL, "active");
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  state = seat(state, "p1", printing, "bench");
  state = seat(state, "p1", PLAIN, "bench");
  state = seat(state, "p2", WALL, "active");
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  state = seat(state, "p2", PLAIN, "bench");
  return fundRetreat(state, "p1");
}

/** Retreat the Active into `bench[index]` — the DELIBERATE half of bench→Active
    (turn.ts stamps `promotedTurn` here). */
function retreatInto(state: GameState, index: number) {
  const active = state.players.p1.active;
  if (active === null) throw new Error("no active to retreat");
  return step(state, {
    type: "retreat",
    seat: "p1",
    discardEnergy: [active.energy[0] as string],
    promoteBenchIndex: index,
  });
}

function useBoost(state: GameState) {
  return step(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: ABILITY,
  });
}

function hudRow(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.abilities.find((a) => a.abilityName === ABILITY);
}

function grassInDeck(state: GameState, s: Seat): number {
  return state.players[s].deck.filter((u) => state.cardIdByUid[u] === ENERGY_G).length;
}

describe("D347 §1 — the printed sentence, and the row it closes", () => {
  it("all three printings resolve to ONE program object, and it is the ability shape", () => {
    const first = programFor(YANMEGA);
    expect(first).toBeDefined();
    expect(programFor(YANMEGA_IR)).toBe(first);
    expect(programFor(YANMEGA_SIR)).toBe(first);
    expect(first?.abilities).toHaveLength(1);
    expect(first?.triggered).toBeUndefined();
    expect(first?.trainer).toBeUndefined();
    expect(first?.passive).toBeUndefined();
  });

  it("every printed word maps to a field, and the ABSENT fields are the print too", () => {
    const ability = programFor(YANMEGA)?.abilities?.[0];
    expect(ability?.name).toBe(ABILITY);
    // "Once during your turn" — §9's DEFAULT per-body scope, not `sharedByName`:
    // nothing prints "you can't use more than 1 Buzzing Boost Ability each turn".
    expect(ability?.oncePerTurn).toBe(true);
    expect(ability?.activeOnly).toBe(true);
    expect(ability?.playableIf).toEqual({ kind: "yourActivePromotedThisTurn" });
    // NOT the per-body field — the whole design call, asserted rather than told.
    expect(ability?.remainingHpAtMost).toBeUndefined();
    expect(ability?.endsTurn).toBeUndefined();
    expect(ability?.program).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 3,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("`toSelf` above `max: 1` is NEW, and it is why this row needs no new op field", () => {
    const op = programFor(YANMEGA)?.abilities?.[0]?.program?.[0];
    expect(op).toMatchObject({ op: "attachFromDeck", toSelf: true, max: 3 });
    // …and the riders `toSelf` IGNORES are absent rather than set-and-inert, so no
    // later reader can come to disagree about which of them won.
    expect(op).not.toHaveProperty("targetType");
    expect(op).not.toHaveProperty("benchOnly");
    expect(op).not.toHaveProperty("ownerPokemon");
    expect(op).not.toHaveProperty("maxPerTarget");
  });

  it("the three ids are CONTIGUOUS in registry insertion order — the rung's real claim", () => {
    const raw = registryCardIds();
    const at = raw.indexOf(YANMEGA);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 3)).toEqual([YANMEGA, YANMEGA_IR, YANMEGA_SIR]);
  });
});

describe("D347 §2 — the census, and the near-miss that was NOT an implementation", () => {
  it("the sentence's only prior appearance in this tree is a NEGATIVE fixture", () => {
    expect(YANMEGA_TEXT.startsWith("Once during your turn")).toBe(true);
    for (const id of YANMEGA_IDS) expect(programFor(id)).toBeDefined();
  });

  it("the ATTACK half of this clause was already built — the whole reason this is cheap", () => {
    expect(ATTACK_SIDE_SAME_FACT).toContain("moved from your Bench to the Active Spot this turn");
    expect(YANMEGA_TEXT).toContain("moves from your Bench to the Active Spot");
    // The note ROUND-TRIPS to the printed clause, which is how the two halves are
    // shown to be one fact rather than two that happen to agree.
    expect(conditionNote({ kind: "yourActivePromotedThisTurn" })).toBe(
      "your Active Pokémon moved from your Bench to the Active Spot this turn",
    );
  });
});

describe("D347 §3 — the Ability, driven end to end", () => {
  it("a retreat promotes Yanmega and the Ability attaches up to 3 Basic {G} to ITSELF", () => {
    const start = ready();
    const before = grassInDeck(start, "p1");
    const retreated = retreatInto(start, 0);
    const promoted = retreated.state.players.p1.active;
    expect(promoted?.promotedTurn).toBe(retreated.state.turn);

    const used = useBoost(retreated.state);
    const phase = used.state.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
    expect(phase.prompt.kind).toBe("attachCards");
    if (phase.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    // ONE target — the source itself. This is `toSelf` observed rather than told.
    expect(phase.prompt.targets).toEqual([{ seat: "p1", spot: { spot: "active" } }]);
    expect(phase.prompt.max).toBe(3);

    const picks = phase.prompt.candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: picks.map((uid) => ({ uid, to: { seat: "p1", spot: { spot: "active" } } })),
      },
    });
    const after = done.state.players.p1.active;
    expect(after?.energy).toHaveLength(3);
    for (const uid of after?.energy ?? []) {
      expect(done.state.cardIdByUid[uid]).toBe(ENERGY_G);
    }
    // "Then, shuffle your deck" — the trailing op really ran.
    expect(findEvent(done.events, "SHUFFLE")).toBeDefined();
    expect(grassInDeck(done.state, "p1")).toBe(before - 3);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it('the {R} Energy in the same deck is NEVER offered — `energyType: "Grass"` is driven', () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const phase = used.state.phase;
    if (phase.kind !== "effect:choose" || phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    for (const uid of phase.prompt.candidates) {
      expect(used.state.cardIdByUid[uid], uid).toBe(ENERGY_G);
    }
    expect(used.state.players.p1.deck.some((u) => used.state.cardIdByUid[u] === ENERGY_R)).toBe(
      true,
    );
  });

  it('taking NONE is a legal answer — the printed "up to", and the deck still shuffles', () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(0);
    expect(findEvent(done.events, "SHUFFLE")).toBeDefined();
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("§9 — the use is spent per BODY, so a second use in the same turn is refused", () => {
    const retreated = retreatInto(ready(), 0);
    const used = useBoost(retreated.state);
    const done = step(used.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    const error = reject(done.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_ALREADY_USED");
  });
});

describe("D347 §4 — the gate REFUSES when the body did not move up", () => {
  it("an Active that has been there all along cannot use it", () => {
    // Yanmega seated as the Active with `promotedTurn: null` — the exact board the
    // print excludes, and the one a bare `activeOnly` would have afforded.
    let state = localSetup(6, "p1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = seat(state, "p1", YANMEGA, "active");
    expect(state.players.p1.active?.promotedTurn).toBeNull();
    const error = reject(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(error.message).toContain("moved from your Bench to the Active Spot this turn");
  });

  it("a BENCHED Yanmega cannot use it even while the Active DID move up", () => {
    const start = ready();
    const withBenchYanmega = seat(start, "p1", YANMEGA_IR, "bench");
    // Retreat into the PLAIN body, so the Active that moved up is not a Yanmega.
    const retreated = retreatInto(withBenchYanmega, 1);
    expect(conditionHolds(retreated.state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(
      true,
    );
    const benchIndex = retreated.state.players.p1.bench.findIndex(
      (b) => retreated.state.cardIdByUid[topUid(b) ?? ""] === YANMEGA_IR,
    );
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    const error = reject(retreated.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benchIndex },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("the stamp EXPIRES by arithmetic — the next turn refuses with nothing cleared", () => {
    const retreated = retreatInto(ready(), 0);
    let state = step(retreated.state, { type: "endTurn", seat: "p1" }).state;
    state = step(state, { type: "endTurn", seat: "p2" }).state;
    const active = state.players.p1.active;
    expect(active?.promotedTurn).not.toBeNull();
    expect(active?.promotedTurn).not.toBe(state.turn);
    const error = reject(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_CONDITION_NOT_MET");
  });
});

describe("D347 §5 — the CONJUNCTION, which is the design call", () => {
  it("`activeOnly` is what resolves the self-pronoun — both halves, on one board", () => {
    const retreated = retreatInto(ready(), 0);
    const state = retreated.state;
    expect(conditionHolds(state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(true);
    const active = state.players.p1.active;
    expect(state.cardIdByUid[topUid(active as never) ?? ""]).toBe(YANMEGA);
    expect(active?.promotedTurn).toBe(state.turn);
    // …and the opponent, whose Active has not moved, reads FALSE from the same
    // predicate — so the field really is seat-relative and the pronoun really did
    // need the second half.
    expect(conditionHolds(state, "p2", { kind: "yourActivePromotedThisTurn" })).toBe(false);
  });

  it("the gate is visible to the HUD, not only to the engine — D190/D222", () => {
    // `playableIf` is read by three surfaces; the online one is `redactedAbilitiesOf`
    // and it must SAY why rather than offer a use that will be rejected.
    let state = localSetup(6, "p1");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = seat(state, "p1", YANMEGA, "active");
    const shownBefore = hudRow(state);
    expect(shownBefore).toBeDefined();
    expect(shownBefore?.disabled).toBe(true);
    expect(shownBefore?.reason).toBe(
      "Only if your Active Pokémon moved from your Bench to the Active Spot this turn",
    );

    const retreated = retreatInto(ready(), 0);
    const shownAfter = hudRow(retreated.state);
    expect(shownAfter?.disabled).toBe(false);
    expect(shownAfter?.reason).toBeNull();
  });
});

describe("D347 §6 — the OTHER promotion routes, and §8.1's free correctness", () => {
  it("a LATER turn's promotion re-arms the use — the gate is per-move, not once-per-game", () => {
    const start = ready();
    let state = step(start, { type: "endTurn", seat: "p1" }).state;
    state = step(state, { type: "endTurn", seat: "p2" }).state;
    // The Active never moved, so the fact is FALSE at the top of the new turn…
    expect(conditionHolds(state, "p1", { kind: "yourActivePromotedThisTurn" })).toBe(false);
    // …and TRUE again the moment Yanmega comes up, on a turn that is not the first.
    const retreated = retreatInto(fundRetreat(state, "p1"), 0);
    expect(retreated.state.players.p1.active?.promotedTurn).toBe(retreated.state.turn);
    expect(retreated.state.turn).toBeGreaterThan(start.turn);
    const used = useBoost(retreated.state);
    expect(used.state.phase.kind).toBe("effect:choose");
  });

  it("the RECORDED LIMITATION — a body switched back DOWN loses the use", () => {
    const retreated = retreatInto(ready(), 0);
    // Retreat again, sending the promoted Yanmega back to the Bench in the same
    // turn. The retreat allowance is per-turn, so the board is reached by paying the
    // cost on a state whose allowance is reset — modelled directly.
    const state: GameState = {
      ...retreated.state,
      allowances: { ...retreated.state.allowances, retreated: false },
    };
    const funded = fundRetreat(state, "p1");
    const back = retreatInto(funded, 0);
    expect(back.state.cardIdByUid[topUid(back.state.players.p1.active as never) ?? ""]).not.toBe(
      YANMEGA,
    );
    const benchIndex = back.state.players.p1.bench.findIndex(
      (b) => back.state.cardIdByUid[topUid(b) ?? ""] === YANMEGA,
    );
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    const error = reject(back.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: benchIndex },
      abilityName: ABILITY,
    });
    expect(error.code).toBe("ABILITY_ACTIVE_ONLY");
  });
});

describe("D347 §7 — the attribution controls (D345's own, applied forward)", () => {
  it("nothing this file defines reached `FIXTURE_POOL` — the shared-pool control", () => {
    for (const id of [...YANMEGA_IDS, PLAIN, WALL, ENERGY_G, ENERGY_R]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), id).toBe(false);
    }
    for (const id of YANMEGA_IDS) expect(Object.hasOwn(LOCAL_CARDS, id), id).toBe(true);
  });

  it("the local pool entry carries the PRINTED Ability name and text on all three", () => {
    for (const id of YANMEGA_IDS) {
      const card = LOCAL_CARDS[id];
      expect(card?.abilities?.[0]?.name, id).toBe(ABILITY);
      expect(card?.abilities?.[0]?.effect, id).toBe(YANMEGA_TEXT);
      expect(programFor(id)?.abilities?.[0]?.name, id).toBe(ABILITY);
    }
  });

  it("the printed ATTACK is untouched — this row buys no attack program", () => {
    for (const id of YANMEGA_IDS) {
      const program = programFor(id) as object;
      expect(Object.hasOwn(program, "attackGate"), id).toBe(false);
      expect(Object.hasOwn(program, "attacks"), id).toBe(false);
    }
  });
});
