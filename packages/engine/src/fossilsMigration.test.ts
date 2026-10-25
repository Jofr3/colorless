import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, applyAction, createGame } from "./index";
import { firstP1Turn, migrateStored, mustMigrate, storedAt, storedPoolIds } from "./testFixtures";

const BODY = "fossil-body";
const JAW = "me03-068";
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Fossil Body",
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
  attacks: [{ cost: [], name: "Tap", damage: String(HIT) }],
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

const DECK = [...Array.from({ length: 56 }, () => BODY), JAW, JAW, JAW, JAW];

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6370): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const p1Turn = (state: GameState) => firstP1Turn(state, BODY);

describe("fossils: the version gate", () => {
  it("a v45 state is migrated with no pool ids", () => {
    expect(storedPoolIds(storedAt(45, fresh()))).toEqual([]);
  });

  it("v40 and v51 are not migrated; a v45 state missing its players is not migrated", () => {
    const old = storedAt(45, fresh());
    for (const version of [40, 51]) {
      expect(storedPoolIds({ ...old, version })).toBeNull();
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("fossils: what the migration writes", () => {
  it("v45: nothing — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = storedAt(45, board);
    const migrated = mustMigrate(old, { [JAW]: { ...JAW_CARD, name: "stale" } as Card });
    expect(migrated).toEqual(board);
    expect(migrated.cardPool[JAW]).toBe(old.state.cardPool[JAW]);
    expect(migrated).toEqual(old.state);
  });

  it("a live v45 lock is not re-nulled: the lock-key step does not run on a v45 state", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: {
          ...board.players.p2,
          active: { ...active, attackTwoFlipLockTurn: board.turn, benchedTurn: 1 },
        },
      },
      handPlayLockedTurn: {
        ...board.handPlayLockedTurn,
        p1: { ...board.handPlayLockedTurn.p1, Stadium: board.turn },
      },
    };
    const migrated = mustMigrate(storedAt(45, live));
    expect(migrated.players.p1.trainerFlipLockTurn).toBe(board.turn);
    expect(migrated.players.p2.active?.attackTwoFlipLockTurn).toBe(board.turn);
    expect(migrated.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.handPlayLockedTurn.p1.Stadium).toBe(board.turn);
  });

  it("v44: the lock keys; v43, v42 and v41: the earlier steps too", () => {
    for (const version of [44, 43, 42, 41] as const) {
      const migrated = mustMigrate(storedAt(version, fresh()), { [JAW]: JAW_CARD });
      expect(migrated.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the state it was given", () => {
    const old = storedAt(45, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("fossils: on a board, the migrated v45 state plays a `me` fossil", () => {
  it("an Antique Jaw Fossil in a v45 hand is benched as a 60-HP body after the migration", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const jaw =
      side.deck.find((u) => board.cardIdByUid[u] === JAW) ??
      side.hand.find((u) => board.cardIdByUid[u] === JAW);
    if (jaw === undefined) throw new Error("no Antique Jaw Fossil");
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: side.deck.filter((u) => u !== jaw),
          hand: [...side.hand.filter((u) => u !== jaw), jaw],
        },
      },
    };
    const migrated = mustMigrate(storedAt(45, board));
    const played = applyAction(migrated, { type: "playTrainer", seat: "p1", uid: jaw });
    if (!played.ok) throw new Error(played.error.code);
    const benched = played.state.players.p1.bench.find((b) => b.stack[0] === jaw);
    expect(benched?.stack).toEqual([jaw]);
    expect(played.state.players.p1.hand).not.toContain(jaw);
  });

  it("the migrated state attacks, and the hit lands", () => {
    const migrated = mustMigrate(storedAt(45, p1Turn(fresh())));
    const hit = applyAction(migrated, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
  });
});
