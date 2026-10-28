import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, applyAction, createGame } from "./index";
import { firstP1Turn, migrateStored, mustMigrate, storedAt } from "./testFixtures";

const BODY = "redo-body";
const FLIPPER = "redo-flipper"; // {C}: "Flip a coin. If tails, this attack does nothing."
const BADGE = "me05-074";
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Redo Body",
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
const FLIPPER_CARD: Card = {
  ...BODY_CARD,
  id: FLIPPER,
  name: "Redo Flipper",
  attacks: [
    {
      cost: [],
      name: "Hyper Fang",
      damage: "30",
      effect: "Flip a coin. If tails, this attack does nothing.",
    },
  ],
} as unknown as Card;
const BADGE_CARD: Card = {
  ...BODY_CARD,
  id: BADGE,
  setId: "me05",
  localId: "074",
  name: "Backtrack Badge",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Tool",
  effect:
    "Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results of those coin flips and begin flipping those coins again.",
} as unknown as Card;
const JAW_CARD: Card = {
  ...BODY_CARD,
  id: JAW,
  setId: "me03",
  localId: "068",
  name: "Antique Jaw Fossil",
  category: "Trainer",
  hp: 60,
  stage: null,
  types: null,
  attacks: null,
  abilities: [
    {
      type: "Ability",
      name: "Intimidating Jaw",
      effect:
        "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance).",
    },
  ],
  trainerType: "Item",
  effect:
    "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.",
} as unknown as Card;

const DECK = [
  ...Array.from({ length: 50 }, () => BODY),
  FLIPPER,
  FLIPPER,
  BADGE,
  BADGE,
  BADGE,
  BADGE,
  JAW,
  JAW,
  JAW,
  JAW,
];

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6460): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [FLIPPER]: FLIPPER_CARD, [BADGE]: BADGE_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const p1Turn = (state: GameState) => firstP1Turn(state, BODY);

describe("coin redo: the version gate", () => {
  it("a v48 state is migrated", () => {
    expect(migrateStored(storedAt(48, fresh()))).not.toBeNull();
  });

  it("v40, the retired v41 and v51 are not migrated; a v48 state missing its players is not migrated", () => {
    const old = storedAt(48, fresh());
    for (const version of [40, 41, 51]) {
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("coin redo: what the migration writes", () => {
  it("v48: nothing — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = storedAt(48, board);
    const migrated = mustMigrate(old);
    expect(migrated).toEqual(board);
    expect(migrated.cardPool[BADGE]).toBe(old.state.cardPool[BADGE]);
    expect(migrated).toEqual(old.state);
  });

  it("a live lock is kept as written: no key is added, no earlier step runs", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: { ...board.players.p2, active: { ...active, benchedTurn: 1 } },
      },
    };
    const migrated = mustMigrate(storedAt(48, live));
    expect(migrated.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v47, v46 and v45: nothing too; v44: the lock keys; v43 and v42: the earlier steps too", () => {
    for (const version of [47, 46, 45] as const) {
      expect(mustMigrate(storedAt(version, fresh()))).toEqual(storedAt(version, fresh()).state);
    }
    for (const version of [44, 43, 42] as const) {
      const migrated = mustMigrate(storedAt(version, fresh()));
      expect(migrated.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the state it was given", () => {
    const old = storedAt(48, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("coin redo: on a board, the migrated v48 state plays Backtrack Badge", () => {
  it("a {C} Active wearing a Badge in a migrated v48 state parks the re-flip offer after its coin, and either answer resolves", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pick = (id: string) => {
      const uid = [...side.deck, ...side.hand].find((u) => board.cardIdByUid[u] === id);
      if (uid === undefined) throw new Error(`no ${id}`);
      return uid;
    };
    const flipper = pick(FLIPPER);
    const badge = pick(BADGE);
    if (side.active === null) throw new Error("no Active");
    const moved = [flipper, badge];
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: [...side.deck.filter((u) => !moved.includes(u)), ...side.active.stack],
          hand: side.hand.filter((u) => !moved.includes(u)),
          active: { ...side.active, stack: [flipper], tools: [badge] },
        },
      },
    };
    const migrated = mustMigrate(storedAt(48, board));
    const parked = applyAction(migrated, { type: "attack", seat: "p1", index: 0 });
    if (!parked.ok) throw new Error(parked.error.code);
    expect(parked.state.phase.kind).toBe("effect:choose");
    if (parked.state.phase.kind !== "effect:choose") return;
    expect(parked.state.phase.cont.pendingOp.op).toBe("reflipAttackCoins");
    // The park survives a JSON round trip, as storage holds it, and answers on the far side.
    const reread = JSON.parse(JSON.stringify(parked.state)) as GameState;
    for (const yes of [false, true]) {
      const answered = applyAction(reread, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes },
      });
      if (!answered.ok) throw new Error(answered.error.code);
      expect(answered.state.phase.kind).not.toBe("effect:choose");
      expect(answered.events.filter((e) => e.type === "COINS_REFLIPPED")).toHaveLength(yes ? 1 : 0);
    }
  });
});
