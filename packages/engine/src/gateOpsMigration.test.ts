import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type EffectOp, type GameState, applyAction, createGame } from "./index";
import { type StoredState, firstP1Turn, migrateStored, mustMigrate } from "./testFixtures";

const BODY = "gate-body";
const ASKER = "gate-asker";
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Gate Body",
  category: "Pokemon",
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: 900,
  stage: "Basic",
  evolveFrom: null,
  types: ["Colorless"],
  retreat: 0,
  abilities: null,
  attacks: [{ cost: [], name: "Tap", damage: "10" }],
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legalStandard: true,
  legalExpanded: true,
  printKey: null,
  legalStandardEffective: null,
  legalExpandedEffective: null,
  imageUrl: null,
  suffix: null,
} as unknown as Card;
const ASKER_CARD: Card = {
  ...BODY_CARD,
  id: ASKER,
  name: "Gate Asker",
  attacks: [{ cost: [], name: "Ask", damage: "", effect: "You may draw 3 cards." }],
} as unknown as Card;

const DECK = [...Array.from({ length: 56 }, () => BODY), ASKER, ASKER, ASKER, ASKER];

const GATES = new Set(["coinFlipGate", "conditionGate", "recordGate", "optional"]);

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

function fresh(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [ASKER]: ASKER_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** p1's first turn with an Asker as its Active. */
function p1Turn(seed: number): GameState {
  const state = firstP1Turn(fresh(seed), BODY);
  const side = state.players.p1;
  const asker = [...side.deck, ...side.hand].find((u) => state.cardIdByUid[u] === ASKER);
  if (asker === undefined || side.active === null) throw new Error("no Asker");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: [...side.deck.filter((u) => u !== asker), ...side.active.stack],
        hand: side.hand.filter((u) => u !== asker),
        active: { ...side.active, stack: [asker] },
      },
    },
  };
}

const NO_ENERGY = { kind: "noEnergyOnYourPokemon" } as const;

/**
 * The Asker's confirm, parked, with its yes arm replaced by a coin gate inside a condition gate and
 * one more gate left in the continuation's rest.
 */
function parkedWithNestedGates(seed: number): GameState {
  const parked = must(p1Turn(seed), { type: "attack", seat: "p1", index: 0 });
  const phase = parked.phase;
  if (phase.kind !== "effect:choose" || phase.cont.pendingOp.op !== "optional") {
    throw new Error("expected the confirm to park");
  }
  const coin: EffectOp = {
    op: "coinFlipGate",
    ops: [{ op: "drawCards", count: 3 }],
    otherwise: [{ op: "drawCards", count: 1 }],
  };
  const cond: EffectOp = { op: "conditionGate", cond: NO_ENERGY, ops: [coin] };
  const tail: EffectOp = {
    op: "conditionGate",
    cond: { kind: "stadiumInPlay" },
    ops: [],
    otherwise: [{ op: "drawCards", count: 1 }],
  };
  return {
    ...parked,
    phase: {
      ...phase,
      cont: {
        ...phase.cont,
        pendingOp: { ...phase.cont.pendingOp, ops: [cond] },
        rest: [tail, ...phase.cont.rest],
      },
    },
  };
}

/** The bytes a v49 deploy wrote for `value`: every gate's `ops` spelled `then`, in place. */
function asV49(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asV49);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  const gate = typeof object.op === "string" && GATES.has(object.op);
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      gate && key === "ops" ? "then" : key,
      asV49(item),
    ]),
  );
}

function v49(state: GameState): StoredState {
  return { version: 49, state: asV49(state) as GameState };
}

describe("gate ops `then` → `ops`: the version gate", () => {
  it("a v49 state is migrated; a newer one is not", () => {
    const old = v49(parkedWithNestedGates(4901));
    expect(migrateStored(old)).not.toBeNull();
    expect(migrateStored({ ...old, version: 51 })).toBeNull();
  });
});

describe("gate ops `then` → `ops`: what the migration writes", () => {
  it("renames every nested gate in a parked continuation, byte for byte and key order kept", () => {
    const current = parkedWithNestedGates(4902);
    const old = v49(current);
    expect(JSON.stringify(old.state)).toContain('"then":');
    const out = mustMigrate(old);
    expect(JSON.stringify(out)).toBe(JSON.stringify(current));
    expect(JSON.stringify(out)).not.toContain('"then":');
  });

  it("every older migratable version gets the rename too", () => {
    const current = parkedWithNestedGates(4903);
    for (const version of [42, 44, 48]) {
      const out = mustMigrate({ ...v49(current), version });
      expect(out.phase).toEqual(current.phase);
    }
  });

  it("leaves a `then` key alone on an object that is not a gate op", () => {
    const current = parkedWithNestedGates(4904);
    const old = v49(current);
    // Parsed, as the stored bytes would be: a `then` key with no gate `op` beside it.
    const extras = JSON.parse(
      '{"plain":{"then":[{"op":"drawCards","count":1}]},' +
        '"notGate":{"op":"drawCards","count":1,"then":[{"op":"drawCards","count":2}]},' +
        '"tagged":{"kind":"optional","then":[]}}',
    ) as Record<string, unknown>;
    const card = { ...old.state.cardPool[BODY], ...extras } as unknown as Card;
    const withExtras = {
      ...old,
      state: { ...old.state, cardPool: { ...old.state.cardPool, [BODY]: card } },
    };
    const out = mustMigrate(withExtras);
    expect(out.cardPool[BODY]).toBe(card);
    expect(JSON.stringify(out.phase)).toBe(JSON.stringify(current.phase));
  });

  it("copies only what it renames and does not touch the state it was given", () => {
    const old = v49(parkedWithNestedGates(4905));
    const before = JSON.stringify(old);
    const out = mustMigrate(old);
    expect(JSON.stringify(old)).toBe(before);
    expect(out.cardPool).toBe(old.state.cardPool);
    expect(out.players).toBe(old.state.players);
    expect(out.phase).not.toBe(old.state.phase);
  });

  it("a v49 state without a gate comes back as the same object", () => {
    const old = v49(p1Turn(4906));
    expect(mustMigrate(old)).toBe(old.state);
  });
});

describe("gate ops `then` → `ops`: the migrated state plays on", () => {
  it("answering the confirm runs both nested gates and the tail exactly as on a fresh state", () => {
    const heads = new Set<number>();
    for (const seed of [4910, 4911, 4912, 4913, 4914, 4915, 4916, 4917]) {
      const current = parkedWithNestedGates(seed);
      const reread = JSON.parse(JSON.stringify(mustMigrate(v49(current)))) as GameState;
      const yes = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } };
      const fromMigrated = applyAction(reread, yes as Parameters<typeof applyAction>[1]);
      const fromCurrent = applyAction(current, yes as Parameters<typeof applyAction>[1]);
      if (!fromMigrated.ok || !fromCurrent.ok) throw new Error("confirm rejected");
      expect(fromMigrated.state).toEqual(fromCurrent.state);
      expect(fromMigrated.events).toEqual(fromCurrent.events);
      const drawn = fromMigrated.state.players.p1.hand.length - current.players.p1.hand.length;
      expect([4, 2]).toContain(drawn);
      heads.add(drawn);
    }
    expect(heads).toEqual(new Set([4, 2]));
  });

  it("the unmigrated v49 bytes cannot be resumed by this engine", () => {
    const old = v49(parkedWithNestedGates(4920));
    const yes = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } };
    expect(() => applyAction(old.state, yes as Parameters<typeof applyAction>[1])).toThrow();
  });
});
