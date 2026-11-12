import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction } from "./index";
import { redactGame } from "./redact";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import { programFor } from "./registry";
import { battler, deckOf, typedEnergy, must, driveSetup, programmedCardIds } from "./testFixtures";

const ARCHALUDON = "sv08-130";
const ARCHALUDON_IDS = ["sv08-130", "sv08-224", "sv08-241"] as const;
const DURALUDON = "sv08-129";
const MAGNETON = "sv08-059";
const MAGNETON_IDS = ["svp-153", "svp-159", "sv08-059"] as const;
const KORAIDON_IDS = ["sv01-125", "sv01-231", "sv01-247", "sv01-254"] as const;
const POWERGLASS_IDS = ["sv06.5-063", "sv06.5-097"] as const;

const ASSEMBLE_ALLOY_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during " +
  "your turn, you may attach up to 2 Basic {M} Energy cards from your discard " +
  "pile to your {M} Pokémon in any way you like.";
const OVERVOLT_TEXT =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your " +
  "discard pile to your {L} Pokémon in any way you like. If you use this " +
  "Ability, this Pokémon is Knocked Out.";

/** A SECOND {M} body carrying no Ability — a destination and never a source, so a
    two-candidate board is not secretly two Archaludon. */
const METAL_B = "fix-d358-metal-b";
/** A NON-{M} body: excluded by `targetType` and by nothing else, which is what
    makes a candidate-count assertion mean the rider rather than the board size. */
const WATER_BODY = "fix-d358-water";
const ENERGY_M = "fix-d358-energy-metal";
const ENERGY_W = "fix-d358-energy-water";

const LOCAL_CARDS: Record<string, Card> = Object.fromEntries([
  ...ARCHALUDON_IDS.map((id) => [
    id,
    battler(id, {
      name: "Archaludon ex",
      stage: "Stage1",
      evolveFrom: "Duraludon",
      hp: 300,
      retreat: 2,
      types: ["Metal"],
      weaknesses: [{ type: "Fire", value: "×2" }],
      abilities: [{ type: "Ability", name: "Assemble Alloy", effect: ASSEMBLE_ALLOY_TEXT }],
      attacks: [{ cost: ["Metal", "Metal", "Metal"], name: "Metal Defender", damage: 220 }],
    }),
  ]),
  ...MAGNETON_IDS.map((id) => [
    id,
    battler(id, {
      name: "Magneton",
      stage: "Stage1",
      evolveFrom: "Magnemite",
      hp: 100,
      retreat: 1,
      types: ["Lightning"],
      weaknesses: [{ type: "Fighting", value: "×2" }],
      abilities: [{ type: "Ability", name: "Overvolt Discharge", effect: OVERVOLT_TEXT }],
      attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Ball", damage: 40 }],
    }),
  ]),
  [
    DURALUDON,
    battler(DURALUDON, {
      name: "Duraludon",
      hp: 130,
      retreat: 2,
      types: ["Metal"],
      weaknesses: [{ type: "Fire", value: "×2" }],
      attacks: [{ cost: ["Metal", "Metal"], name: "Confront", damage: 50 }],
    }),
  ],
  [
    METAL_B,
    battler(METAL_B, {
      name: "D358 Metal B",
      hp: 120,
      retreat: 1,
      types: ["Metal"],
      attacks: [{ cost: ["Metal"], name: "Tap", damage: 10 }],
    }),
  ],
  [
    WATER_BODY,
    battler(WATER_BODY, {
      name: "D358 Water",
      hp: 120,
      retreat: 1,
      types: ["Water"],
      attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
    }),
  ],
  [ENERGY_M, typedEnergy(ENERGY_M, "Metal")],
  [ENERGY_W, typedEnergy(ENERGY_W, "Water")],
]) as Record<string, Card>;

const POOL: Record<string, Card> = LOCAL_CARDS;

const DECK = deckOf({
  [DURALUDON]: 8,
  [ARCHALUDON]: 4,
  [MAGNETON]: 4,
  [METAL_B]: 6,
  [WATER_BODY]: 6,
  [ENERGY_M]: 16,
  [ENERGY_W]: 16,
});

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

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
}

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

function board(spec: {
  activeId: string;
  bench?: readonly string[];
  pile?: readonly string[];
  inHand?: readonly string[];
  turn?: number;
}): { state: GameState; handUids: string[] } {
  const base = passTo(localSetup(7), spec.turn ?? 3);
  const side = base.players.p1;
  const deck = [...side.deck];
  const take = (cardId: string): string => {
    const index = deck.findIndex((uid) => idOf(base, uid) === cardId);
    if (index < 0) throw new Error(`deck has no ${cardId}`);
    return deck.splice(index, 1)[0] as string;
  };
  const activeUid = take(spec.activeId);
  const benchUids = (spec.bench ?? []).map(take);
  const pileUids = (spec.pile ?? []).map(take);
  const handUids = (spec.inHand ?? []).map(take);

  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });

  const state: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: {
        ...side,
        deck: [...deck, ...side.bench.flatMap((b) => b.stack), ...blank.stack],
        hand: handUids,
        discard: [...side.discard, ...pileUids],
        active: body(activeUid),
        bench: benchUids.map(body),
      },
    },
  };
  return { state, handUids };
}

function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (body?.energy ?? []).map((uid) => idOf(state, uid));
}

function asMandatory(state: GameState): GameState {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const phase = state.phase;
  if (phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const { upTo: _dropped, ...mandatory } = phase.prompt;
  return { ...state, phase: { ...phase, prompt: mandatory } };
}

/** Answer the parked `choosePokemon` with a ref. Asserts the park shape on the way
    through, so a case that stopped parking fails HERE and not by quietly landing
    a different number of cards. */
function pick(state: GameState, ref: PokemonRef) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

/** Answer the parked `choosePokemon` with NOTHING — the printed "up to N" decline,
    and the whole point of this file. The wire shape is the `pokemon` choice with
    its `ref` left off; there is no second `kind`. */
function decline(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return step(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
}

function attachOpsIn(node: unknown): Extract<EffectOp, { op: "attachEnergyFrom" }>[] {
  const into: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n !== null && typeof n === "object") {
      const rec = n as Record<string, unknown>;
      if (rec.op === "attachEnergyFrom") {
        into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
      }
      for (const value of Object.values(rec)) walk(value);
    }
  };
  walk(node);
  return into;
}

function attachOpsByCardId(): Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]> {
  const found = new Map<string, Extract<EffectOp, { op: "attachEnergyFrom" }>[]>();
  const walk = (node: unknown, into: Extract<EffectOp, { op: "attachEnergyFrom" }>[]): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, into);
      return;
    }
    if (node !== null && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (rec.op === "attachEnergyFrom") {
        into.push(rec as unknown as Extract<EffectOp, { op: "attachEnergyFrom" }>);
      }
      for (const value of Object.values(rec)) walk(value, into);
    }
  };
  for (const id of programmedCardIds()) {
    const ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] = [];
    walk(programFor(id), ops);
    if (ops.length > 0) found.set(id, ops);
  }
  return found;
}

describe("D358 §1 — which printings carry the decline, walked off the registry", () => {
  it("the declinable set is EXACTLY Archaludon ex ×3, Magneton ×3, Koraidon ex ×4 and Powerglass ×2, by id", () => {
    const declinable = [...attachOpsByCardId()]
      .filter(([id, ops]) => !id.startsWith("fix-") && ops.some((op) => op.declinable === true))
      .map(([id]) => id)
      .sort();
    expect(declinable).toEqual(
      [
        ...ARCHALUDON_IDS,
        ...MAGNETON_IDS,
        ...KORAIDON_IDS,
        ...POWERGLASS_IDS,
        "me01-038",
        "me01-141",
        "sv04.5-245",
        "svp-029",
      ].sort(),
    );
    // The two halves of the set, kept apart on purpose: the printed-legal six this
    // engine can be played with today, and the four rotated ones that print the
    // same sentence and are reachable through `programFor` all the same.
    expect([...ARCHALUDON_IDS, ...MAGNETON_IDS]).toHaveLength(6);
    expect(KORAIDON_IDS).toHaveLength(4);
    expect(programFor("fix-assemblealloy")).toBe(programFor(ARCHALUDON));
  });

  it("EVERY op of a declinable row carries it — the flag is per OP, not per card", () => {
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS, ...KORAIDON_IDS]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops.length, id).toBeGreaterThan(1);
      expect(
        ops.every((op) => op.declinable === true),
        id,
      ).toBe(true);
    }
  });

  it("the REFUSED families carry no flag, and that is the rules call in code", () => {
    const REFUSED = [
      "svp-116",
      "sv06-033",
      "sv06-173", // Infernape ×3 — "a {R}, a {F}, or 1 of each"
      "sv09-085",
      "sv09-166", // Lycanroc ×2 — count: 2, toSelf
      "sv06.5-025",
      "sv08.5-054", // Bloodmoon Ursaluna ×2 — count: 2, toSelf
      "sv10-039",
      "sv10-209",
      "sv10-230",
      "sv10-239", // Ethan's Ho-Oh ex ×4 — count: 2, benchOnly
    ];
    const ops = attachOpsByCardId();
    for (const id of REFUSED) {
      expect(ops.get(id), `${id} must still be an attachEnergyFrom row`).toBeDefined();
      expect(
        (ops.get(id) ?? []).some((op) => op.declinable === true),
        id,
      ).toBe(false);
    }
    // …and the `count` families are refused for the reason stated, not by accident:
    // every one of the eight carries a `count`, which is the field that pins the
    // batch to ONE body and therefore the field a decline cannot subdivide.
    for (const id of REFUSED.slice(3)) {
      expect(
        (ops.get(id) ?? []).every((op) => op.count !== undefined),
        id,
      ).toBe(true);
    }
    // Infernape's are `count`-FREE — its refusal is the missing empty arm, a
    // different reason, and the two must not be readable as one.
    for (const id of REFUSED.slice(0, 3)) {
      expect(
        (ops.get(id) ?? []).every((op) => op.count === undefined),
        id,
      ).toBe(true);
    }
  });

  it("`declinable` and `count` never co-occur on any authored op", () => {
    for (const [id, ops] of attachOpsByCardId()) {
      for (const op of ops) {
        expect(op.declinable === true && op.count !== undefined, id).toBe(false);
      }
    }
  });
});

// ── 2. THE PRINTED ANSWER SET, DRIVEN END TO END ─────────────────────────────

describe("D358 §2 — Archaludon ex's printed {0, 1, 2}, all three reachable", () => {
  /** Evolve p1's Active Duraludon into Archaludon ex, firing the `onEvolve`
      trigger. Two {M} bodies are in play, so each of the two ops parks. */
  function evolveOnTwoMetalBoard(pile: readonly string[] = [ENERGY_M, ENERGY_M]) {
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile,
      inHand: [ARCHALUDON],
    });
    const evolveUid = built.handUids[0] as string;
    return step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: evolveUid,
      target: { spot: "active" },
    });
  }

  it("TWO — the pre-D358 behaviour, still reachable and still the default", () => {
    const first = evolveOnTwoMetalBoard();
    expect(first.state.phase.kind).toBe("effect:choose");
    const second = pick(first.state, ACTIVE);
    const done = pick(second.state, benchRef(0));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([ENERGY_M]);
  });

  it("ONE — the printed middle answer, UNREACHABLE before this slice", () => {
    const first = evolveOnTwoMetalBoard();
    const second = pick(first.state, ACTIVE);
    expect(second.state.phase.kind).toBe("effect:choose");
    const done = decline(second.state);
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([]);
    // The declined card is STILL IN THE PILE — a decline moves nothing, which is
    // the claim `answerOp`'s arm makes and the one a "discard it instead"
    // implementation would fail.
    expect(
      done.state.players.p1.discard.filter((u) => idOf(done.state, u) === ENERGY_M),
    ).toHaveLength(1);
  });

  it("ZERO — declining BOTH is the printed 'up to', and the trigger's `optional` is not the only route to it", () => {
    const first = evolveOnTwoMetalBoard();
    const second = decline(first.state);
    const done = decline(second.state);
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(done.state, ACTIVE)).toEqual([]);
    expect(energyIdsOn(done.state, benchRef(0))).toEqual([]);
    expect(
      done.state.players.p1.discard.filter((u) => idOf(done.state, u) === ENERGY_M),
    ).toHaveLength(2);
  });

  it("a decline emits NO attach event — nothing moved, so nothing is announced", () => {
    const first = evolveOnTwoMetalBoard();
    const declined = decline(first.state);
    expect(declined.events.map((e: GameEvent) => e.type)).not.toContain("ENERGY_ATTACHED");
  });

  it("the DECLINE is not a whiff: the pile is full and the op still had a candidate", () => {
    // The two endings produce the same board and must not be confused — a whiff is
    // `firstAttachableEnergy === undefined` BEFORE the park, a decline is an answer
    // AFTER it. Driven by asserting the park existed at all.
    const first = evolveOnTwoMetalBoard();
    if (first.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = first.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.upTo).toBe(1);
  });
});

describe("D358 §3 — a declinable pick over ONE candidate still ASKS", () => {
  it("the M1 no-choice rule does NOT apply to a declinable pick", () => {
    const built = board({
      activeId: DURALUDON,
      bench: [WATER_BODY],
      pile: [ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    expect(evolved.state.phase.kind).toBe("effect:choose");
    if (evolved.state.phase.kind !== "effect:choose") throw new Error("no park");
    const prompt = evolved.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.candidates[0]).toEqual(ACTIVE);
    // …and BOTH answers are live over that one candidate.
    expect(energyIdsOn(pick(evolved.state, ACTIVE).state, ACTIVE)).toEqual([ENERGY_M]);
    expect(energyIdsOn(decline(evolved.state).state, ACTIVE)).toEqual([]);
  });

  it("the ZERO-candidate arm is UNTOUCHED — a whiff still asks nobody", () => {
    // An empty pile has nothing to attach, so the op no-ops before the park. A
    // decline and a whiff reach the same board by different roads, and only this
    // case can tell the roads apart: there is no `effect:choose` to answer.
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_W],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    expect(evolved.state.phase.kind).toBe("turn:action");
    expect(energyIdsOn(evolved.state, ACTIVE)).toEqual([]);
  });
});

// ── 4. THE WIRE ─────────────────────────────────────────────────────────────

describe("D358 §4 — the validator, the redaction, and the refuted map-prompt road", () => {
  it("a MANDATORY choosePokemon REFUSES the decline, with its own message", () => {
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_M, ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    if (evolved.state.phase.kind !== "effect:choose") throw new Error("no park");
    // Rewrite the parked prompt to a MANDATORY one — the same board, the same op,
    // one field away. This is the only shape that isolates the validator: every
    // real mandatory park in the pool is produced by a DIFFERENT op.
    const refused = applyAction(asMandatory(evolved.state), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("a mandatory park accepted a decline");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(refused.error.message).toContain("cannot be declined");
  });

  it("a ref that is not a candidate is still refused on a DECLINABLE prompt", () => {
    // The decline widened the answer shape; it must not have widened the offer.
    const built = board({
      activeId: DURALUDON,
      bench: [WATER_BODY],
      pile: [ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    const refused = applyAction(evolved.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("the park accepted a non-candidate");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("the REDACTED prompt carries `declinable`, and a mandatory one carries no key", () => {
    const built = board({
      activeId: DURALUDON,
      bench: [METAL_B],
      pile: [ENERGY_M, ENERGY_M],
      inHand: [ARCHALUDON],
    });
    const evolved = step(built.state, {
      type: "evolve",
      seat: "p1",
      uid: built.handUids[0] as string,
      target: { spot: "active" },
    });
    const view = redactGame(evolved.state, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const wire = view.phase.prompt;
    if (wire === null || wire.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(wire.upTo).toBe(1);

    const plainView = redactGame(asMandatory(evolved.state), "p1");
    if (plainView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const plain = plainView.phase.prompt;
    if (plain === null || plain.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(Object.keys(plain).sort()).toEqual(["candidates", "kind", "note"]);
  });

  it("refutation (b): NO attach op reads the DISCARD PILE into the map prompt", () => {
    const mapProducers = new Set(["attachFromTop", "attachFromDeck", "attachFromHand"]);
    const walk = (node: unknown, out: string[]): void => {
      if (Array.isArray(node)) {
        for (const n of node) walk(n, out);
        return;
      }
      if (node !== null && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        if (typeof rec.op === "string" && mapProducers.has(rec.op)) {
          out.push(`${rec.op}:${String(rec.source ?? "-")}`);
        }
        for (const value of Object.values(rec)) walk(value, out);
      }
    };
    const seen: string[] = [];
    for (const id of programmedCardIds()) walk(programFor(id), seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.includes("discard"))).toEqual([]);
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS]) {
      expect(
        (attachOpsByCardId().get(id) ?? []).every((op) => op.source === "discard"),
        id,
      ).toBe(true);
    }
  });
});

// ── 5. THE REFUSALS, DRIVEN AS LIVE CONTROLS ────────────────────────────────

describe("D358 §5 — the refused families still behave exactly as they did", () => {
  it("Magneton's THREE ops give {0, 1, 2, 3} — the second bought family, end to end", () => {
    // Driven on a TWO-{L}-body board would need a second {L} fixture; the point
    // here is the COUNT axis, so one body and three ops is the sharper case: three
    // parks, and stopping after the first is a printed answer.
    const built = board({ activeId: MAGNETON, pile: [ENERGY_M, ENERGY_M, ENERGY_M] });
    const used = step(built.state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Overvolt Discharge",
    });
    expect(used.state.phase.kind).toBe("effect:choose");
    const one = pick(used.state, ACTIVE);
    expect(one.state.phase.kind).toBe("effect:choose");
    const stopped = decline(one.state);
    expect(energyIdsOn(stopped.state, ACTIVE)).toHaveLength(1);
  });

  it("Infernape is UNTOUCHED — no flag, so both halves still resolve (the §9.1 refusal)", () => {
    for (const id of ["svp-116", "sv06-033", "sv06-173"]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops, id).toHaveLength(2);
      expect(
        ops.every((op) => op.declinable === undefined),
        id,
      ).toBe(true);
    }
  });

  it("the three `count: 2` families are UNTOUCHED — the quantity axis was not bought", () => {
    for (const id of ["sv09-085", "sv06.5-025", "sv10-039"]) {
      const ops = attachOpsByCardId().get(id) ?? [];
      expect(ops, id).toHaveLength(1);
      expect(ops[0]?.count, id).toBe(2);
      expect(ops[0]?.declinable, id).toBeUndefined();
    }
  });
});

// ── 6. THE POOL AND THE REGISTRY, ASSERTED BY ID ────────────────────────────

describe("D358 §6 — the ids this slice rests on are real, and the registry holds them", () => {
  it("all six bought printings resolve to exactly TWO program objects, by identity", () => {
    expect(programFor(ARCHALUDON_IDS[0])).toBe(programFor(ARCHALUDON_IDS[1]));
    expect(programFor(ARCHALUDON_IDS[0])).toBe(programFor(ARCHALUDON_IDS[2]));
    expect(programFor(MAGNETON_IDS[0])).toBe(programFor(MAGNETON_IDS[1]));
    expect(programFor(MAGNETON_IDS[0])).toBe(programFor(MAGNETON_IDS[2]));
    expect(programFor(ARCHALUDON_IDS[0])).not.toBe(programFor(MAGNETON_IDS[0]));
  });

  it("ZERO registry keys were added — this slice moves no census figure", () => {
    // The flag is a FIELD on two existing program objects, so `raw.length`,
    // `nonAttackRegistryIds()` and every `BUILT.*` line stand still. The claim is
    // asserted from the side that can go red: both families were already keyed.
    const keys = new Set(programmedCardIds());
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS]) expect(keys.has(id), id).toBe(true);
  });

  it("the local pool carries every id this file seats, and none reaches FIXTURE_POOL", () => {
    for (const id of [...ARCHALUDON_IDS, ...MAGNETON_IDS, DURALUDON, METAL_B, WATER_BODY]) {
      expect(POOL[id], id).toBeDefined();
    }
    for (const id of Object.keys(POOL)) {
      if (id.startsWith("fix-")) expect(id.startsWith("fix-d358-"), id).toBe(true);
    }
  });
});

describe("D360 §7 — no `anyWay` spread in EITHER producer is still an exact N", () => {
  /** Every op the DERIVER emits for a Standard-legal attack sentence, with the
      sentence that produced it — the surface `programmedCardIds()` cannot see. */
  function derivedSpreads(): {
    text: string;
    ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[];
  }[] {
    const out: { text: string; ops: Extract<EffectOp, { op: "attachEnergyFrom" }>[] }[] = [];
    for (const [, text] of legalAttackCorpus()) {
      const ops = attachOpsIn(deriveAttackEffect(text));
      if (ops.length > 1) out.push({ text, ops });
    }
    return out;
  }

  it('the DERIVER\'s spreads are EXACTLY four sentences ( D532: the CROSS-SEAT one joined — corpus FILE LINE 70, three ops carrying `whose: "opponent"`), and all four are hedged', () => {
    const spreads = derivedSpreads();
    expect(spreads.map((s) => s.text).sort()).toEqual(
      [
        "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
        "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.",
        "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
        "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      ].sort(),
    );
    const printings = legalAttackCorpus()
      .filter(([, text]) => spreads.some((s) => s.text === text))
      .reduce((n, [count]) => n + count, 0);
    expect(printings).toBe(5);
  });

  it("EVERY hedged spread op carries the flag, in BOTH producers, and no other op does", () => {
    for (const { text, ops } of derivedSpreads()) {
      expect(text, text).toContain("up to");
      for (const op of ops) expect(op.declinable, text).toBe(true);
    }
    let unhedged = 0;
    let hedgedOntoOneBody = 0;
    for (const [, text] of legalAttackCorpus()) {
      const ops = attachOpsIn(deriveAttackEffect(text));
      if (ops.length !== 1) continue;
      const op = ops[0];
      expect(op?.declinable, text).toBeUndefined();
      if (text.includes("up to")) {
        expect(op?.count, text).toBeGreaterThan(1); // the hedge became the ceiling
        hedgedOntoOneBody++;
      } else {
        expect(op?.count, text).toBeUndefined();
        unhedged++;
      }
    }
    expect(hedgedOntoOneBody).toBeGreaterThan(0);
    expect(unhedged).toBeGreaterThan(0);
  });

  it("D528 — the THIRD producer: a coin member's `ops` carries ONE declinable spread op that the FOLD repeats — the flag is on the op, H copies of it are the distribution, and this reader's corpus walk above cannot see it (the sentence is `deriveAttackCoinFlip`'s)", () => {
    const ceilinged = legalAttackCorpus().filter(([, text]) => {
      const coin = deriveAttackCoinFlip(text);
      return (
        coin?.kind === "programPerHeads" && coin.ops.some((op) => op.op === "attachEnergyFrom")
      );
    });
    expect(ceilinged.map(([, text]) => text)).toEqual([
      "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
    ]);
    for (const [, text] of ceilinged) {
      const coin = deriveAttackCoinFlip(text);
      if (coin?.kind !== "programPerHeads") throw new Error("not programPerHeads");
      expect(text).toContain("in any way you like");
      expect(coin.ops).toHaveLength(1); // ONE op in the member; the fold makes the copies
      const ops = attachOpsIn(coin.ops);
      expect(ops).toHaveLength(1);
      expect(ops[0]?.declinable).toBe(true);
      expect(ops[0]?.count).toBeUndefined();
      // …and this reader's walk does NOT see it: the sentence is null on `deriveAttackEffect`.
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("the REGISTRY half: every multi-op `anyWay` program is flagged, the `atLeastOne` pairs (Infernape, Magmortar) excepted", () => {
    const AT_LEAST_ONE = ["svp-116", "sv06-033", "sv06-173", "me06-021", "me06-107"];
    for (const [id, ops] of attachOpsByCardId()) {
      if (ops.length <= 1) continue;
      expect(
        ops.every((op) => op.declinable === true),
        id,
      ).toBe(!AT_LEAST_ONE.includes(id));
    }
    for (const [id, ops] of attachOpsByCardId()) {
      if ((POWERGLASS_IDS as readonly string[]).includes(id)) {
        expect(ops, id).toEqual([
          { op: "attachEnergyFrom", source: "discard", toSelf: true, declinable: true },
        ]);
        continue;
      }
      if (ops.some((op) => op.declinable === true)) expect(ops.length, id).toBeGreaterThan(1);
    }
  });
});
