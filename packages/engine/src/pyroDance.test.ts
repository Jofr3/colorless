import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, typedEnergy, must, firstBasicInHand } from "./testFixtures";

const INFERNAPE = "sv06-033";
const INFERNAPE_IDS = ["svp-116", "sv06-033", "sv06-173"] as const;
const X_BOOT = "sv10-145";
const KORAIDON = "sv01-125";
const ARCHALUDON = "sv08-130";

const PYRO_TEXT =
  "Once during your turn, you may attach a Basic {R} Energy card, a Basic {F} " +
  "Energy card, or 1 of each from your hand to your Pokémon in any way you like.";

const FIRE = "d351-fire-energy";
const FIGHTING = "d351-fighting-energy";
const WATER = "d351-water-energy";
const BUDDY = "d351-buddy";
const FIGHTER = "d351-fighter";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries(
  INFERNAPE_IDS.map((id) => [
    id,
    battler(id, {
      name: "Infernape",
      stage: "Stage2",
      evolveFrom: "Monferno",
      hp: 160,
      retreat: 2,
      types: ["Fire"],
      abilities: [{ type: "Ability", name: "Pyro Dance", effect: PYRO_TEXT }],
    }),
  ]),
);
LOCAL_CARDS[BUDDY] = battler(BUDDY, { name: "D351 Buddy", hp: 70 });
LOCAL_CARDS[FIGHTER] = battler(FIGHTER, { name: "D351 Fighter", hp: 70, types: ["Fighting"] });
LOCAL_CARDS[FIRE] = typedEnergy(FIRE, "Fire");
LOCAL_CARDS[FIGHTING] = typedEnergy(FIGHTING, "Fighting");
LOCAL_CARDS[WATER] = typedEnergy(WATER, "Water");

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [INFERNAPE]: 4,
  [INFERNAPE_IDS[0]]: 2,
  [INFERNAPE_IDS[2]]: 2,
  [BUDDY]: 16,
  [FIGHTER]: 4,
  [FIRE]: 12,
  [FIGHTING]: 12,
  [WATER]: 8,
});

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_REF: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

function board(
  hand: readonly string[],
  opts: { id?: string; bench?: string; discard?: readonly string[] } = {},
): GameState {
  const id = opts.id ?? INFERNAPE;
  const state = localSetup(4);
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const take = (cardId: string, from: string[]): string => {
    const uid = from.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    from.splice(from.indexOf(uid), 1);
    return uid;
  };
  const rest = [...pool];
  const activeUid = take(id, rest);
  const benchUid = take(opts.bench ?? BUDDY, rest);
  const handUids = hand.map((cardId) => take(cardId, rest));
  const discardUids = (opts.discard ?? []).map((cardId) => take(cardId, rest));
  const returned = side.active === null ? [] : side.active.stack;
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: handUids,
        discard: [...side.discard, ...discardUids],
        deck: [...rest, ...returned, ...side.bench.flatMap((b) => b.stack)],
        active: body(activeUid),
        bench: [body(benchUid)],
      },
    },
  };
}

function usePyro(state: GameState): { state: GameState; events: GameEvent[] } {
  const first = apply(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "Pyro Dance",
  });
  return { state: first.state, events: [...first.events] };
}

function resolve(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  const res = apply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
  return { state: res.state, events: [...res.events] };
}

function attachedTypes(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === null || body === undefined) throw new Error("no body");
  return body.energy.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?");
}

const pyroProgram = (): readonly EffectOp[] => {
  const program = programFor(INFERNAPE)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Pyro Dance has no program");
  return program;
};

describe("D351 §1 — the registry row is TWO ops, and the shape is the print", () => {
  it("all three printings share ONE program object", () => {
    const object = programFor(INFERNAPE_IDS[0]);
    expect(object).toBeDefined();
    for (const id of INFERNAPE_IDS) expect(programFor(id)).toBe(object);
  });

  it("the program is exactly two attachEnergyFrom ops, {R} then {F}, from the HAND", () => {
    expect(pyroProgram()).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fire",
        recordAs: "moved",
        atLeastOne: true,
      },
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fighting",
        recordAs: "moved",
        atLeastOne: true,
      },
    ]);
  });

  it("…and it carries NO cap, NO target rider and NO `anyEnergy` — asserted by KEY SET", () => {
    for (const op of pyroProgram()) {
      expect(Object.keys(op).sort()).toEqual([
        "atLeastOne",
        "energyType",
        "op",
        "recordAs",
        "source",
      ]);
    }
  });

  it("the registry entry carries NO `attack` key — the `BUILT.attack` summand cannot move", () => {
    for (const id of INFERNAPE_IDS) {
      expect(Object.keys(programFor(id) ?? {}).sort()).toEqual(["abilities"]);
    }
  });

  it("the sentence is an ABILITY, so no attack reader can see it", () => {
    expect(deriveAttackEffect(PYRO_TEXT)).toBeNull();
  });
});

describe("D351 §2 — the census, pinned as the negatives it actually is", () => {
  it("THE OTHER PRINTING OF THE SAME CLAUSE IS NOW BUILT — the refusal is SPENT", () => {
    expect(programFor(X_BOOT)).toBeDefined();
  });

  it("row 12's fourth id is BUILT — this negative is SPENT, and row 12 is CLOSED", () => {
    expect(programFor("sv09-107")).toBeDefined();
  });
});

describe("D351 §3 — the gate: the defect, and the two controls that hid it", () => {
  it("A HAND WITH ONLY THE SECOND TYPE IS PLAYABLE — the defect, driven", () => {
    const state = board([FIGHTING]);
    expect(programPlayable(state, pyroProgram(), "p1")).toBe(true);
  });

  it("…and so is a hand with only the FIRST type — the mirror", () => {
    const state = board([FIRE]);
    expect(programPlayable(state, pyroProgram(), "p1")).toBe(true);
  });

  it("…and so is a hand with both", () => {
    expect(programPlayable(board([FIRE, FIGHTING]), pyroProgram(), "p1")).toBe(true);
  });

  it("…but a hand with NEITHER is REFUSED — the relaxation is not a removal", () => {
    // The `or` still refuses when EVERY alternative whiffs, which is ruling/284 at
    // the unit the ruling names. Without this case the change would be
    // indistinguishable from deleting the gate.
    expect(programPlayable(board([WATER, WATER]), pyroProgram(), "p1")).toBe(false);
    expect(programPlayable(board([]), pyroProgram(), "p1")).toBe(false);
  });

  it("CONTROL — the HOMOGENEOUS two-op producer is unmoved (Koraidon 'Dino Cry')", () => {
    const koraidon = programFor(KORAIDON)?.abilities?.[0]?.program;
    if (koraidon === undefined) throw new Error("Dino Cry has no program");
    const attaches = koraidon.filter((op) => op.op === "attachEnergyFrom");
    expect(attaches).toHaveLength(2);
    expect(attaches[0]).toEqual(attaches[1]);
    // A {F} body on the Bench and Basic {F} Energy in the discard → playable.
    expect(
      programPlayable(board([], { bench: FIGHTER, discard: [FIGHTING] }), koraidon, "p1"),
    ).toBe(true);
    expect(programPlayable(board([], { bench: FIGHTER }), koraidon, "p1")).toBe(false);
    // …and with the pile stocked but NO {F} body in play → refused on the target
    // rider, which is the gate's OTHER conjunct surviving the move out of the loop.
    expect(programPlayable(board([], { discard: [FIGHTING] }), koraidon, "p1")).toBe(false);
  });

  it("CONTROL — the other two-op row is a TRIGGER and never reaches this gate", () => {
    const program = programFor(ARCHALUDON);
    expect(Object.keys(program ?? {}).sort()).toEqual(["triggered"]);
    expect(program?.triggered?.[0]?.program).toHaveLength(2);
  });

  it("CONTROL — a single-op attach program is bit-for-bit unchanged by the relaxation", () => {
    const teal = programFor("sv06-025")?.abilities?.[0]?.program;
    if (teal === undefined) throw new Error("Teal Dance has no program");
    expect(teal.filter((op) => op.op === "attachEnergyFrom")).toHaveLength(1);
    expect(programPlayable(board([]), teal, "p1")).toBe(false);
  });

  it("CONTROL — a program with NO attach at all is untouched (the arity guard)", () => {
    // `.every` on an empty list is `true`, so without the `length === 0` guard this
    // predicate would refuse every program in the registry. Driven, not reasoned.
    expect(programPlayable(board([]), [{ op: "drawCards", count: 1 }], "p1")).toBe(true);
  });
});

describe("D351 §4 — the three printed outcomes, driven end to end", () => {
  it("one of each: two parks, two bodies, one {R} and one {F}", () => {
    let state = board([FIRE, FIGHTING]);
    const used = usePyro(state);
    expect(used.state.phase.kind).toBe("effect:choose");
    const first = resolve(used.state, ACTIVE_REF);
    expect(first.state.phase.kind).toBe("effect:choose");
    const second = resolve(first.state, BENCH_REF);
    state = second.state;
    expect(state.phase.kind).toBe("turn:action");
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
    expect(attachedTypes(state, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(state.players.p1.hand).toHaveLength(0);
  });

  it("one of each, BOTH onto the same body — the other end of 'any way you like'", () => {
    let state = board([FIRE, FIGHTING]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy", "Fighting Energy"]);
  });

  it("{F} alone: ONE park, and the {R} half is a silent no-op", () => {
    let state = board([FIGHTING]);
    const used = usePyro(state);
    expect(used.state.phase.kind).toBe("effect:choose");
    state = resolve(used.state, BENCH_REF).state;
    expect(state.phase.kind).toBe("turn:action");
    expect(attachedTypes(state, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(attachedTypes(state, ACTIVE_REF)).toEqual([]);
  });

  it("{R} alone: the mirror, and it lands on the Active", () => {
    let state = board([FIRE]);
    state = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
  });

  it("the printed 'Basic' holds — a hand of Special-less {W} attaches nothing", () => {
    // `anyEnergy` is absent, so only Basic Energy of the named type is reachable;
    // a Water Basic matches neither op. The Ability is refused rather than used
    // for nothing, which is the gate's REMAINING half working.
    const state = board([WATER]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pyro Dance",
    });
    expect(result.ok).toBe(false);
  });

  it("more than one {R} in hand attaches exactly ONE — the printed article", () => {
    let state = board([FIRE, FIRE, FIRE]);
    state = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(attachedTypes(state, ACTIVE_REF)).toEqual(["Fire Energy"]);
    expect(state.players.p1.hand).toHaveLength(2);
  });
});

describe("D351 §5 — 'you may' and 'once during your turn'", () => {
  it("B12 — AFTER {R} LANDS, THE {F} PARK IS DECLINABLE: the printed '{R}' answer, reached", () => {
    const state = board([FIRE, FIGHTING]);
    const afterFirst = resolve(usePyro(state).state, ACTIVE_REF).state;
    expect(afterFirst.phase.kind).toBe("effect:choose");
    const wrongKind = applyAction(afterFirst, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(wrongKind.ok).toBe(false);
    if (wrongKind.ok) throw new Error("the park accepted a cards answer");
    expect(wrongKind.error.code).toBe("BAD_EFFECT_CHOICE");
    const declined = must(
      applyAction(afterFirst, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } }),
    );
    expect(declined.phase.kind).toBe("turn:action");
    expect(attachedTypes(declined, ACTIVE_REF)).toEqual(["Fire Energy"]);
    expect(attachedTypes(declined, BENCH_REF)).toEqual([]);
    expect(declined.players.p1.hand).toHaveLength(1);
    // …and taking it is still the "1 of each" answer.
    const both = resolve(afterFirst, BENCH_REF).state;
    expect(both.phase.kind).toBe("turn:action");
    expect(attachedTypes(both, BENCH_REF)).toEqual(["Fighting Energy"]);
    expect(both.players.p1.hand).toHaveLength(0);
  });

  it("the Ability is once per turn", () => {
    let state = board([FIRE, FIGHTING]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    const again = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Pyro Dance",
    });
    expect(again.ok).toBe(false);
  });

  it("it is NOT Active-only — a BENCHED Infernape may use it", () => {
    // The print carries no Active clause, so `activeOnly: false`. Driven by moving
    // the body rather than by reading the flag back.
    const seeded = board([FIRE]);
    const active = seeded.players.p1.active;
    const bench = seeded.players.p1.bench[0];
    if (active === null || bench === undefined) throw new Error("no board");
    const swapped: GameState = {
      ...seeded,
      players: {
        ...seeded.players,
        p1: { ...seeded.players.p1, active: bench, bench: [active] },
      },
    };
    const used = apply(swapped, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Pyro Dance",
    });
    expect(used.state.phase.kind).toBe("effect:choose");
  });
});

describe("D351 §6 — an Energy attachment, not the turn's manual one", () => {
  it("the manual attach-per-turn allowance is untouched by either op", () => {
    // §6.3: the once-a-turn hand attach is a TURN allowance; an effect-driven
    // attach is not it. Two Energy leave the hand and the allowance is still there.
    let state = board([FIRE, FIGHTING, FIRE]);
    state = resolve(resolve(usePyro(state).state, ACTIVE_REF).state, ACTIVE_REF).state;
    const manual = state.players.p1.hand.find(
      (u) => POOL[state.cardIdByUid[u] ?? ""]?.category === "Energy",
    );
    if (manual === undefined) throw new Error("no Energy left in hand");
    const done = apply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: manual,
      target: { spot: "active" },
    });
    expect(attachedTypes(done.state, ACTIVE_REF)).toHaveLength(3);
  });
});

describe("D351 §7 — the pool and the registry, asserted by id", () => {
  it("NOTHING this slice defines reached `FIXTURE_POOL`", () => {
    for (const id of [...INFERNAPE_IDS, BUDDY, FIRE, FIGHTING, WATER]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the THREE ids are CONTIGUOUS registry keys, in printed order — permanent", () => {
    const raw = registryCardIds();
    const first = raw.indexOf(INFERNAPE_IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(raw.slice(first, first + 3)).toEqual([...INFERNAPE_IDS]);
  });

  it("all THREE real ids are registry keys, and the synthetic bodies are not", () => {
    const keys = new Set(registryCardIds());
    for (const id of INFERNAPE_IDS) expect(keys.has(id), id).toBe(true);
    for (const id of [BUDDY, FIRE, FIGHTING, WATER]) expect(keys.has(id), id).toBe(false);
  });
});
