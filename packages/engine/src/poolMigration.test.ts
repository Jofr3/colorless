import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { blank } from "./fixtures/cards";
import { type GameState, applyAction, createGame, redactGame } from "./index";
import { GAME_STATE_VERSION } from "./persist";
import {
  type StoredState,
  firstP1Turn,
  migrateStored,
  mustMigrate,
  storedPoolIds,
} from "./testFixtures";

const TM = "sv08-188";
const FOSSIL = "sv07-129";
const BODY = "pool-body";

const FRESH_TM: Card = {
  ...blank,
  id: TM,
  setId: "sv08",
  localId: "188",
  name: "Technical Machine: Fluorite",
  category: "Trainer",
  attacks: [
    {
      cost: ["Grass", "Water", "Psychic"],
      name: "Fluorite",
      effect:
        "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon.",
    },
  ],
  trainerType: "Tool",
  effect:
    "The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard it at the end of your turn.",
};
const FRESH_FOSSIL: Card = {
  ...blank,
  id: FOSSIL,
  setId: "sv07",
  localId: "129",
  name: "Antique Cover Fossil",
  category: "Trainer",
  hp: 60,
  abilities: [
    {
      type: "Ability",
      name: "Protective Cover",
      effect:
        "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    },
  ],
  trainerType: "Item",
  effect:
    "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.",
};
const STALE_TM: Card = { ...FRESH_TM, hp: null, abilities: null, attacks: null };
const STALE_FOSSIL: Card = { ...FRESH_FOSSIL, hp: null, abilities: null, attacks: null };

const BODY_CARD: Card = {
  ...blank,
  id: BODY,
  name: "Pool Body",
  category: "Pokemon",
  hp: 900,
  stage: "Basic",
  types: ["Colorless"],
  retreat: 1,
  attacks: [{ cost: [], name: "Tap", damage: "10" }],
};

const DECK = [...Array.from({ length: 56 }, () => BODY), TM, TM, FOSSIL, FOSSIL];
const FRESH_POOL = { [TM]: FRESH_TM, [FOSSIL]: FRESH_FOSSIL, [BODY]: BODY_CARD };

function v41(seed = 5830): StoredState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [TM]: STALE_TM, [FOSSIL]: STALE_FOSSIL, [BODY]: BODY_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return { version: 41, state: created.state };
}

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/** p1's first turn with a TM attached to its Active. */
function tmOnActive(start: GameState): GameState {
  let state = firstP1Turn(start, BODY);
  const side = state.players.p1;
  const zone = (["hand", "deck", "prizes"] as const).find((z) =>
    side[z].some((u) => state.cardIdByUid[u] === TM),
  );
  if (zone === undefined) throw new Error("p1 has no TM");
  const tm = side[zone].find((u) => state.cardIdByUid[u] === TM) as string;
  const filler = side.deck.find((u) => u !== tm) as string;
  state = {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [...side.hand.filter((u) => u !== tm), tm],
        deck: side.deck.filter((u) => u !== tm && (zone !== "prizes" || u !== filler)),
        prizes: zone === "prizes" ? side.prizes.map((u) => (u === tm ? filler : u)) : side.prizes,
      },
    },
  };
  return must(state, { type: "attachTool", seat: "p1", uid: tm, target: { spot: "active" } });
}

function attackNames(state: GameState): string[] {
  const view = redactGame(state, "p1");
  if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
  return view.phase.attacks.map((a) => a.name);
}

describe("pool refresh: the version gate", () => {
  it("a v41 state needs its whole pool from the catalog and is migrated", () => {
    const old = v41();
    expect(storedPoolIds(old)?.sort()).toEqual([BODY, FOSSIL, TM].sort());
    expect(migrateStored(old, FRESH_POOL)).not.toBeNull();
  });

  it("v40, the current version and a newer one are not migrated; v42 to v49 need no pool", () => {
    const old = v41();
    for (const version of [40, GAME_STATE_VERSION, GAME_STATE_VERSION + 1]) {
      expect(storedPoolIds({ ...old, version })).toBeNull();
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    for (let version = 42; version <= 49; version++) {
      expect(storedPoolIds({ ...old, version })).toEqual([]);
      expect(migrateStored({ ...old, version })).not.toBeNull();
    }
    for (const raw of [null, undefined, 41, "x"]) {
      expect(storedPoolIds({ version: 41, state: raw })).toBeNull();
    }
  });

  it("a v41 state without a pool, players or phase is not migrated", () => {
    const old = v41();
    for (const key of ["cardPool", "players", "phase"]) {
      expect(migrateStored({ ...old, state: { ...old.state, [key]: null } })).toBeNull();
      expect(storedPoolIds({ ...old, state: { ...old.state, [key]: null } })).toBeNull();
    }
  });
});

describe("pool refresh: what the migration writes", () => {
  it("replaces each stale Trainer face with its catalog row, and nothing else", () => {
    const old = v41();
    const otherBody: Card = { ...BODY_CARD, hp: 10 };
    const migrated = mustMigrate(old, {
      [TM]: FRESH_TM,
      [FOSSIL]: FRESH_FOSSIL,
      [BODY]: otherBody,
    });
    expect(migrated.cardPool[TM]).toEqual(FRESH_TM);
    expect(migrated.cardPool[FOSSIL]).toEqual(FRESH_FOSSIL);
    // A Pokémon face is kept as persisted, whatever the catalog holds now.
    expect(migrated.cardPool[BODY]).toBe(old.state.cardPool[BODY]);
    const { cardPool: _a, ...restNew } = migrated;
    const { cardPool: _b, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
  });

  it("keeps the persisted face when the catalog has no row, or a row of another category", () => {
    const old = v41();
    const migrated = mustMigrate(old, { [FOSSIL]: { ...FRESH_FOSSIL, category: "Pokemon" } });
    expect(migrated.cardPool[TM]).toBe(old.state.cardPool[TM]);
    expect(migrated.cardPool[FOSSIL]).toBe(old.state.cardPool[FOSSIL]);
  });

  it("does not touch the state it was given", () => {
    const old = v41();
    const before = JSON.stringify(old);
    migrateStored(old, { [TM]: FRESH_TM });
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("pool refresh: on a board, the v41 state's TM grants its attack after the migration", () => {
  it("the stale pool offers no Fluorite; the migrated one offers it after the printed Tap", () => {
    const old = v41();
    expect(old.state.cardPool[TM]?.attacks).toBeNull();
    expect(attackNames(tmOnActive(old.state))).toEqual(["Tap"]);
    const migrated = mustMigrate(old, FRESH_POOL);
    expect(attackNames(tmOnActive(migrated))).toEqual(["Tap", "Fluorite"]);
  });
});
