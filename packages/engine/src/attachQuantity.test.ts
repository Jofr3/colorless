import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, createGame } from "./index";
import { applyChoice } from "./interpreter";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import {
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  setActiveFromDeck,
  typedEnergy,
  must,
} from "./testFixtures";

const ORICORIO = "sv08-026";
const ORICORIO_B = "sv08-089";
const BENCH_BODY = "fix-d359-bench";
const FIRE = "fix-d359-fire";
const WATER = "fix-d359-water";

const ENERGY_ASSIST =
  "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.";

/** Every catalog id whose BUILD carries an `attachEnergyFrom` with `count`, by
    the sentence that prints it. Re-derived, never inherited (see the header). */
const QUANTITY_IDS = {
  goldenFlame: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
  battleHardened: ["sv06.5-025", "sv08.5-054"],
  spikeClad: ["sv09-085", "sv09-166"],
  energyAssist: [ORICORIO, ORICORIO_B],
  regiCharge: ["sv10-101", "sv10-214"],
  returnCharge: ["sv08-068"],
} as const;

const POOL: Record<string, Card> = {
  [ORICORIO]: battler(ORICORIO, {
    name: "Oricorio",
    hp: 90,
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Fire"], name: "Energy Assist", effect: ENERGY_ASSIST },
      {
        cost: ["Fire"],
        name: "Fireworks",
        effect: "Discard an Energy from this Pokémon.",
        damage: 30,
      },
    ],
  }),
  [BENCH_BODY]: battler(BENCH_BODY, {
    name: "D359 Bench Body",
    hp: 120,
    retreat: 1,
    types: ["Water"],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
};

const DECK = deckOf({ [ORICORIO]: 4, [BENCH_BODY]: 16, [FIRE]: 20, [WATER]: 20 });

const ENERGY_ASSIST_IDX = 0;
const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function idOf(state: GameState, uid: string): string {
  return state.cardIdByUid[uid] ?? "";
}

function firstInHand(state: GameState, seat: "p1" | "p2", cardId: string): string {
  const uid = state.players[seat].hand.find((h) => idOf(state, h) === cardId);
  if (uid === undefined) throw new Error(`no ${cardId} in ${seat}'s hand`);
  return uid;
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
      applyAction(state, {
        type: "setupPlaceActive",
        seat,
        uid: firstInHand(state, seat, BENCH_BODY),
      }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** §4 bars the going-first player from attacking on turn 1, so every board here
    runs on turn 3 — cheaper to say than to leave as a `FIRST_TURN_ATTACK` a reader
    has to diagnose. */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function ready(
  seed: number,
  { bench = 2, pile = 2 }: { bench?: number; pile?: number } = {},
): GameState {
  let state = passTo(localSetup(seed), 3);
  state = setActiveFromDeck(state, "p1", ORICORIO);
  state = attachFromDeck(state, "p1", FIRE, 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < bench; i++) state = benchFromDeck(state, "p1", BENCH_BODY);
  state = discardFromDeck(state, "p1", WATER, pile);
  return state;
}

function attackWith(state: GameState) {
  return step(state, { type: "attack", seat: "p1", index: ENERGY_ASSIST_IDX });
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon")
    throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return prompt;
}

function energyOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (pokemon?.energy ?? []).map((uid) => idOf(state, uid));
}

function all<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every `attachEnergyFrom` op the REGISTRY authors, paired with the id that owns
    it — `attachDecline.test.ts`'s walker, kept separate rather than exported so
    the two files' claims cannot drift into one shared assumption. */
function registryAttachOps(): Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]> {
  const found = new Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]>();
  const walk = (node: unknown, into: Extract<EffectOp, { op: "attachEnergyFrom" }>[]): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, into);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.op === "attachEnergyFrom") {
      into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
    }
    for (const value of Object.values(rec)) walk(value, into);
  };
  for (const id of registryCardIds()) {
    const ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
    walk(programFor(id), ops);
    if (ops.length > 0) found.set(id, ops);
  }
  return found;
}

// ── 1. THE POPULATION, WALKED OFF **BOTH** PRODUCERS ─────────────────────────

describe("D359 §1 — the quantity population, over the registry AND the deriver", () => {
  it("the REGISTRY half is exactly ~~8~~ printings on 3 sentences, by id ( D582 (D539): *8* WITHDRAWN — 9 since the `me` alias Ethan's Ho-Oh ex `me02.5-026`; D587: 11 printings on 4 sentences since Philippe ×2; D588: 14 on 5 since Rosa's Encouragement ×3)", () => {
    const withCount = [...registryAttachOps()]
      .filter(([, ops]) => ops.some((op) => op.count !== undefined))
      .map(([id]) => id)
      .filter((id) => !id.startsWith("fix-"));
    expect(withCount.sort()).toEqual(
      [
        ...QUANTITY_IDS.goldenFlame,
        ...QUANTITY_IDS.battleHardened,
        ...QUANTITY_IDS.spikeClad,
        "me02.5-026",
        "me04-079",
        "me04-110",
        "me03-084",
        "me03-114",
        "me03-123",
      ].sort(),
    );
    expect(withCount).toHaveLength(14);
  });

  it("the DERIVER half is 5 more printings the registry cannot see", () => {
    for (const id of [
      ...QUANTITY_IDS.energyAssist,
      ...QUANTITY_IDS.regiCharge,
      ...QUANTITY_IDS.returnCharge,
    ]) {
      expect(programFor(id), `${id} must have NO registry program`).toBeUndefined();
    }
    const derived: Record<string, EffectOp[] | null> = {
      energyAssist: deriveAttackEffect(ENERGY_ASSIST),
      regiCharge: deriveAttackEffect(
        "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
      ),
      returnCharge: deriveAttackEffect(
        "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
      ),
    };
    expect(derived.energyAssist).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ]);
    expect(derived.regiCharge).toEqual([
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toSelf: true, count: 2 },
    ]);
    // Kilowattrel's is the same op behind a §9.2 gate — the hardest reachable site
    // for this axis, and the one that proves the ceiling is not a property of
    // being a program's FIRST op.
    expect(derived.returnCharge).toEqual([
      { op: "switchActive", recordAs: "moved" },
      {
        op: "recordGate",
        slot: "moved",
        then: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Lightning",
            toSelf: true,
            count: 2,
          },
        ],
      },
    ]);
  });

  it("13 printings on 6 sentences — the two halves reconcile rather than agree by luck", () => {
    const groups = Object.values(QUANTITY_IDS);
    expect(groups).toHaveLength(6);
    expect(groups.flat()).toHaveLength(13);
    expect(new Set(groups.flat()).size).toBe(13);
    // 8 registry + 5 deriver, and the split is by PRODUCER rather than by column:
    // three of the six are Abilities and three are attacks, and every attack one
    // is invisible to `programFor`.
    expect([
      ...QUANTITY_IDS.goldenFlame,
      ...QUANTITY_IDS.battleHardened,
      ...QUANTITY_IDS.spikeClad,
    ]).toHaveLength(8);
    expect([
      ...QUANTITY_IDS.energyAssist,
      ...QUANTITY_IDS.regiCharge,
      ...QUANTITY_IDS.returnCharge,
    ]).toHaveLength(5);
  });
});

// ── 2. THE PRINTED {0, 1, 2}, DRIVEN END TO END ──────────────────────────────

describe("D359 §2 — Oricorio's printed {0, 1, 2}, all three reachable", () => {
  it("the park carries the printed CEILING and every Benched body", () => {
    const parked = attackWith(ready(11));
    const prompt = parkOf(parked.state);
    expect(prompt.upTo).toBe(2);
    expect(prompt.candidates).toEqual([benchRef(0), benchRef(1)]);
    // The Active is NOT offered — the printed "Benched" is a live rider.
    expect(prompt.candidates).not.toContainEqual(ACTIVE);
    expect(prompt.note).toBe("Attach up to 2 Energy to which of your Benched Pokémon?");
  });

  it("TWO — the pre-D359 behaviour, still reachable and still what a bare ref means", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER, WATER]);
    expect(energyOn(done.state, benchRef(1))).toEqual([]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(
      0,
    );
  });

  it("ONE — the printed MIDDLE answer, UNREACHABLE before this slice", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0), take: 1 },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(1);
    // …and the second Energy is still in the pile. A build that read `op.count`
    // and ignored the answer passes every "something was attached" assertion and
    // fails exactly here.
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(
      1,
    );
  });

  it("ZERO — and on an ATTACK this answer had NO other route to it", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
    expect(energyOn(done.state, benchRef(1))).toEqual([]);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.state.players.p1.discard.filter((u) => idOf(done.state, u) === WATER)).toHaveLength(
      2,
    );
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("the batch still lands on ONE body — the quantity did not buy a SPLIT", () => {
    const parked = attackWith(ready(11));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(1) },
    });
    expect(energyOn(done.state, benchRef(1))).toEqual([WATER, WATER]);
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
  });

  it("`min(count, available)` still holds — a one-card pile attaches one, silently", () => {
    const parked = attackWith(ready(11, { pile: 1 }));
    const done = step(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(energyOn(done.state, benchRef(0))).toEqual([WATER]);
  });
});

// ── 3. THE VALIDATOR — every way a quantity can be wrong ─────────────────────

describe("D359 §3 — the validator is the only place the printed ceiling is enforced", () => {
  const reject = (
    state: GameState,
    choice: { kind: "pokemon"; ref?: PokemonRef; take?: number },
  ) => {
    const result = applyAction(state, { type: "resolveEffect", seat: "p1", choice });
    if (result.ok) throw new Error("expected the frame to be rejected");
    return result.error;
  };

  it("a take ABOVE the printed ceiling is refused — the one a crafted frame wants", () => {
    const parked = attackWith(ready(11)).state;
    const error = reject(parked, { kind: "pokemon", ref: benchRef(0), take: 3 });
    expect(error.code).toBe("BAD_EFFECT_CHOICE");
    expect(error.message).toBe("that is not a legal quantity");
  });

  it("a take of ZERO beside a named body is refused — the decline, spelled twice", () => {
    // Not a typo-catcher: the union already spells the decline as the ABSENT ref,
    // and a second spelling is how a §9.2 `recordGate` reading *"if you attached
    // Energy in this way"* gets handed a body with no uids.
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: benchRef(0), take: 0 }).message).toBe(
      "that is not a legal quantity",
    );
  });

  it("a NON-INTEGER take is refused — a wire number is not a whole one", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: benchRef(0), take: 1.5 }).message).toBe(
      "that is not a legal quantity",
    );
  });

  it("a take beside a DECLINE is refused — two answers in one frame", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", take: 1 }).message).toBe(
      "a declined choice takes nothing",
    );
  });

  it("a MANDATORY prompt refuses BOTH the decline and the quantity, separately", () => {
    const parked = attackWith(ready(11)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const phase = parked.phase;
    const prompt = parkOf(parked);
    const { upTo: _dropped, ...mandatory } = prompt;
    const asMandatory: GameState = { ...parked, phase: { ...phase, prompt: mandatory } };
    expect(reject(asMandatory, { kind: "pokemon" }).message).toBe("this choice cannot be declined");
    expect(reject(asMandatory, { kind: "pokemon", ref: benchRef(0), take: 1 }).message).toBe(
      "this choice takes no quantity",
    );
    // …and the ordinary answer to a mandatory prompt is still accepted.
    expect(
      applyAction(asMandatory, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: benchRef(0) },
      }).ok,
    ).toBe(true);
  });

  it("the APPLY clamps to the printed count too — the belt behind the validator", () => {
    const parked = attackWith(ready(11, { pile: 4 })).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const events: GameEvent[] = [];
    const after = applyChoice(
      parked,
      parked.phase.cont.pendingOp,
      { kind: "pokemon", ref: benchRef(0), take: 4 },
      parked.phase.cont.ctx,
      events,
    );
    expect(energyOn(after, benchRef(0))).toEqual([WATER, WATER]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
  });

  it("a ref that is not a candidate is still refused, quantity or no quantity", () => {
    const parked = attackWith(ready(11)).state;
    expect(reject(parked, { kind: "pokemon", ref: ACTIVE, take: 1 }).message).toBe(
      "that Pokémon is not a legal target",
    );
  });

  it("the FULL take may be spelled either way, and both land the same board", () => {
    const bare = step(attackWith(ready(11)).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    const spelled = step(attackWith(ready(11)).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0), take: 2 },
    });
    expect(energyOn(spelled.state, benchRef(0))).toEqual(energyOn(bare.state, benchRef(0)));
  });
});

// ── 4. THE WIRE, AND THE CEILING THAT MUST NOT BE CLAMPED ────────────────────

describe("D359 §4 — the redacted prompt, and the leak a clamp would have been", () => {
  it("the REDACTED prompt carries `upTo`, and a mandatory one carries no key at all", () => {
    const parked = attackWith(ready(11)).state;
    const view = redactGame(parked, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const wire = view.phase.prompt;
    if (wire === null || wire.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(wire.upTo).toBe(2);

    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const phase = parked.phase;
    const { upTo: _dropped, ...mandatory } = parkOf(parked);
    const plainView = redactGame({ ...parked, phase: { ...phase, prompt: mandatory } }, "p1");
    if (plainView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const plain = plainView.phase.prompt;
    if (plain === null || plain.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(Object.keys(plain).sort()).toEqual(["candidates", "kind", "note"]);
  });

  it("THE CEILING IS THE PRINTED NUMBER, AND `note` IS WHAT PROVES IT MUST BE", () => {
    for (const pile of [1, 2, 4]) {
      const parked = attackWith(ready(11, { pile })).state;
      const prompt = parkOf(parked);
      expect(prompt.upTo, `pile of ${pile}`).toBe(2);
      expect(prompt.note, `pile of ${pile}`).toContain("up to 2 Energy");
    }
  });

  it("the prompt reaches ONLY the answerer, which is why no field on it can leak", () => {
    const parked = attackWith(ready(11)).state;
    const opponent = redactGame(parked, "p2");
    if (opponent.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(opponent.phase.prompt).toBeNull();
  });
});

// ── 5. THE REFUTATIONS, RUN FROM SOURCE ON A BOARD ───────────────────────────

describe("D359 §5 — what this slice refused, driven rather than asserted", () => {
  it("refutation (a): `count > 1` COMES ONLY FROM A PRINTED 'up to N'", () => {
    expect(
      deriveAttackEffect(
        "Attach 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect("Attach 2 Basic {F} Energy cards from your discard pile to this Pokémon."),
    ).toBeNull();
    // …and the hedged form of the SAME sentence is read, with the count.
    const hedged = deriveAttackEffect(ENERGY_ASSIST);
    expect(hedged?.[0]).toMatchObject({ op: "attachEnergyFrom", count: 2 });
    // The unhedged SINGULAR is read too, and carries no count — so "no count" and
    // "a count" are the two printed readings and there is no third.
    const singular = deriveAttackEffect(
      "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
    );
    expect(singular?.[0]).not.toHaveProperty("count");
  });

  it("refutation (b): NO OP FIELD MOVED — `declinable` and `count` still never co-occur", () => {
    for (const [id, ops] of registryAttachOps()) {
      for (const op of ops) {
        expect(op.declinable === true && op.count !== undefined, id).toBe(false);
      }
    }
    for (const id of [
      ...QUANTITY_IDS.goldenFlame,
      ...QUANTITY_IDS.battleHardened,
      ...QUANTITY_IDS.spikeClad,
    ]) {
      const ops = registryAttachOps().get(id) ?? [];
      expect(ops, id).toHaveLength(1);
      expect(ops[0]?.count, id).toBe(2);
      expect(ops[0]?.declinable, id).toBeUndefined();
    }
  });

  it("refutation (c): the DISCARD-sourced batch parks a REF, never a MAP", () => {
    const parked = attackWith(ready(11)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    expect(parked.phase.prompt.kind).not.toBe("attachCards");
    // A map-shaped answer is refused outright — there is no route from this park
    // to a per-card destination.
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: parked.players.p1.discard[0] as string, to: benchRef(0) },
            { uid: parked.players.p1.discard[1] as string, to: benchRef(1) },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it("refutation (d): the answer set is EXACTLY 0..N — nothing unprinted is legal", () => {
    // The one thing a widened prompt member must never do. Every k in 0..2 lands a
    // board, and every k outside it is refused — so the capability bought is
    // precisely §9.1's *"one, two, or none, all legal"* and not a byte more.
    const landed = [0, 1, 2].map((k) => {
      const parked = attackWith(ready(11)).state;
      const choice =
        k === 0
          ? { kind: "pokemon" as const }
          : { kind: "pokemon" as const, ref: benchRef(0), take: k };
      return energyOn(
        step(parked, { type: "resolveEffect", seat: "p1", choice }).state,
        benchRef(0),
      ).length;
    });
    expect(landed).toEqual([0, 1, 2]);
    for (const bad of [-1, 0, 3, 99]) {
      const parked = attackWith(ready(11)).state;
      expect(
        applyAction(parked, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: benchRef(0), take: bad },
        }).ok,
        `take: ${bad}`,
      ).toBe(false);
    }
  });
});

// ── 6. THE POOL AND THE IDS ──────────────────────────────────────────────────

describe("D359 §6 — the ids this file rests on are real and locally seated", () => {
  it("the local pool carries the printing under test, and none of it reaches FIXTURE_POOL", () => {
    expect(POOL[ORICORIO]?.attacks?.[ENERGY_ASSIST_IDX]?.effect).toBe(ENERGY_ASSIST);
    expect(POOL[ORICORIO]?.attacks?.[ENERGY_ASSIST_IDX]?.name).toBe("Energy Assist");
    expect(QUANTITY_IDS.energyAssist).toEqual([ORICORIO, ORICORIO_B]);
    expect(Object.keys(POOL).sort()).toEqual([BENCH_BODY, FIRE, ORICORIO, WATER].sort());
  });

  it("ZERO registry keys were added — this slice moves no census figure", () => {
    expect(registryCardIds()).toHaveLength(1451);
    for (const id of Object.values(QUANTITY_IDS).flat()) {
      if (programFor(id) === undefined) continue;
      expect([
        ...QUANTITY_IDS.goldenFlame,
        ...QUANTITY_IDS.battleHardened,
        ...QUANTITY_IDS.spikeClad,
      ]).toContain(id);
    }
  });
});
