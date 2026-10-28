import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, applyAction, createGame } from "./index";
import { firstP1Turn, migrateStored, mustMigrate, storedAt } from "./testFixtures";

const BODY = "trim-body";
const ROTOM_ID = "me02-029";
const BAND = "sv01-197"; // Vitality Band
const CHARM = "sv02-173"; // Bravery Charm
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Trim Body",
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
const MULTI_ADAPTER_TEXT =
  'Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each.';
const ROTOM_CARD: Card = {
  ...BODY_CARD,
  id: ROTOM_ID,
  setId: "me02",
  localId: "029",
  name: "Rotom ex",
  hp: 190,
  types: ["Lightning"],
  retreat: 1,
  suffix: "EX",
  abilities: [{ type: "Ability", name: "Multi Adapter", effect: MULTI_ADAPTER_TEXT }],
  attacks: [
    {
      cost: ["Lightning", "Colorless"],
      name: "Thunderbolt",
      damage: "130",
      effect: "Discard all Energy from this Pokémon.",
    },
  ],
} as unknown as Card;
const tool = (id: string, name: string, effect: string): Card =>
  ({
    ...BODY_CARD,
    id,
    name,
    category: "Trainer",
    hp: null,
    stage: null,
    types: null,
    attacks: null,
    trainerType: "Tool",
    effect,
  }) as unknown as Card;
const BAND_CARD = tool(
  BAND,
  "Vitality Band",
  "The attacks of the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
);
const CHARM_CARD = tool(
  CHARM,
  "Bravery Charm",
  "The Basic Pokémon this card is attached to gets +50 HP.",
);
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
  ...Array.from({ length: 48 }, () => BODY),
  ROTOM_ID,
  ROTOM_ID,
  BAND,
  BAND,
  BAND,
  CHARM,
  CHARM,
  CHARM,
  JAW,
  JAW,
  JAW,
  JAW,
];

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6430): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: {
      [BODY]: BODY_CARD,
      [ROTOM_ID]: ROTOM_CARD,
      [BAND]: BAND_CARD,
      [CHARM]: CHARM_CARD,
      [JAW]: JAW_CARD,
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const p1Turn = (state: GameState) => firstP1Turn(state, BODY);

describe("tool trim: the version gate", () => {
  it("a v47 state is migrated", () => {
    expect(migrateStored(storedAt(47, fresh()))).not.toBeNull();
  });

  it("v40, the retired v41 and v51 are not migrated; a v47 state missing its players is not migrated", () => {
    const old = storedAt(47, fresh());
    for (const version of [40, 41, 51]) {
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("tool trim: what the migration writes", () => {
  it("v47: nothing — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = storedAt(47, board);
    const migrated = mustMigrate(old);
    expect(migrated).toEqual(board);
    expect(migrated.cardPool[ROTOM_ID]).toBe(old.state.cardPool[ROTOM_ID]);
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
    const migrated = mustMigrate(storedAt(47, live));
    expect(migrated.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v46 and v45: nothing too; v44: the lock keys; v43 and v42: the earlier steps too", () => {
    for (const version of [46, 45] as const) {
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
    const old = storedAt(47, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("tool trim: on a board, the migrated v47 state plays Multi Adapter", () => {
  it("a Rotom ex in the Active Spot of a migrated v47 state takes a second Tool", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pick = (id: string, not: readonly string[] = []) => {
      const uid = [...side.deck, ...side.hand].find(
        (u) => board.cardIdByUid[u] === id && !not.includes(u),
      );
      if (uid === undefined) throw new Error(`no ${id}`);
      return uid;
    };
    const rotom = pick(ROTOM_ID);
    const band = pick(BAND);
    const charm = pick(CHARM);
    if (side.active === null) throw new Error("no Active");
    const moved = [rotom, band, charm];
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: [...side.deck.filter((u) => !moved.includes(u)), ...side.active.stack],
          hand: [...side.hand.filter((u) => !moved.includes(u)), charm],
          active: { ...side.active, stack: [rotom], tools: [band] },
        },
      },
    };
    const migrated = mustMigrate(storedAt(47, board));
    const attached = applyAction(migrated, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    });
    if (!attached.ok) throw new Error(attached.error.code);
    expect(attached.state.players.p1.active?.tools).toEqual([band, charm]);
  });
});
