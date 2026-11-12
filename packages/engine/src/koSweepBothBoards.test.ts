import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp } from "./continuous";
import { advance, isLethallyDamaged } from "./flow";
import type { GameState, InPlayPokemon } from "./index";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  freshAllowances,
  makeInPlay,
  mustApply,
  mustCreate,
  types,
} from "./testFixtures";

const SHELLOS = "sv08-046";
const GASTRODON = "sv08-107";
const LOTAD = "sv09-035";
const LOMBRE = "sv09-036";
const LUDICOLO = "sv09-037";

const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [SHELLOS]: battler(SHELLOS, { name: "Shellos", hp: 80, types: ["Water"] }),
  [GASTRODON]: battler(GASTRODON, {
    name: "Gastrodon",
    stage: "Stage1",
    evolveFrom: "Shellos",
    hp: 130,
    retreat: 3,
    types: ["Fighting"],
    abilities: [
      {
        type: "Ability",
        name: "Sticky Bind",
        effect:
          "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities.",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Mud Shot", damage: 80 }],
  }),
  [LOTAD]: battler(LOTAD, { name: "Lotad", hp: 60, types: ["Grass"] }),
  [LOMBRE]: battler(LOMBRE, { name: "Lombre", stage: "Stage1", evolveFrom: "Lotad", hp: 90 }),
  [LUDICOLO]: battler(LUDICOLO, {
    name: "Ludicolo",
    stage: "Stage2",
    evolveFrom: "Lombre",
    hp: 140,
    retreat: 2,
    types: ["Water"],
    abilities: [
      {
        type: "Ability",
        name: "Vibrant Dance",
        effect:
          "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
      },
    ],
    attacks: [{ cost: ["Water", "Water", "Colorless"], name: "Hydro Splash", damage: 130 }],
  }),
};

/**
 * p1's turn 5. p2's Active Lotad (60 HP) carries 80 damage and is alive only under its benched
 * Ludicolo's Vibrant Dance (+40). p1 has a Shellos and `p1Active` in play and a Gastrodon in hand.
 */
function board(p1Active: "shellos" | "gastrodon"): GameState {
  const created = mustCreate(
    1,
    {
      p1: deckOf({ [SHELLOS]: 4, [GASTRODON]: 4, "fix-energy": 52 }),
      p2: deckOf({ [LOTAD]: 4, [LOMBRE]: 4, [LUDICOLO]: 4, "fix-energy": 48 }),
    },
    POOL,
  ).state;
  const uids = (seat: "p1" | "p2", id: string) =>
    Object.entries(created.cardIdByUid)
      .filter(([uid, card]) => uid.startsWith(seat) && card === id)
      .map(([uid]) => uid);
  const [shellos, secondShellos] = uids("p1", SHELLOS) as [string, string];
  const [gastrodon, secondGastrodon] = uids("p1", GASTRODON) as [string, string];
  const lotad = uids("p2", LOTAD)[0] as string;
  const lombre = uids("p2", LOMBRE)[0] as string;
  const ludicolo = uids("p2", LUDICOLO)[0] as string;
  const placed = new Set([
    shellos,
    secondShellos,
    gastrodon,
    secondGastrodon,
    lotad,
    lombre,
    ludicolo,
  ]);
  const rest = (seat: "p1" | "p2") =>
    Object.keys(created.cardIdByUid).filter((uid) => uid.startsWith(seat) && !placed.has(uid));
  const [p1Rest, p2Rest] = [rest("p1"), rest("p2")];
  const active: InPlayPokemon =
    p1Active === "shellos"
      ? makeInPlay(secondShellos, 1)
      : { ...makeInPlay(secondShellos, 1), stack: [secondShellos, secondGastrodon] };
  return {
    ...created,
    turn: 5,
    firstPlayer: "p1",
    phase: { kind: "turn:action", seat: "p1" },
    allowances: freshAllowances(),
    pending: [],
    players: {
      p1: {
        ...created.players.p1,
        deck: p1Rest.slice(6),
        prizes: p1Rest.slice(0, 6),
        hand: [gastrodon],
        active,
        bench: [makeInPlay(shellos, 1)],
      },
      p2: {
        ...created.players.p2,
        deck: p2Rest.slice(6),
        prizes: p2Rest.slice(0, 6),
        hand: [],
        active: { ...makeInPlay(lotad, 2), damage: 80 },
        bench: [{ ...makeInPlay(lombre, 2), stack: [lombre, ludicolo] }],
      },
    },
  };
}

describe("§8.1: an action that makes the OPPONENT's body lethal Knocks it Out at once (COR-P0E)", () => {
  it("the board starts with Lotad alive only under Vibrant Dance", () => {
    const state = board("shellos");
    const lotad = state.players.p2.active as InPlayPokemon;
    expect(effectiveMaxHp(state, lotad)).toBe(100);
    expect(isLethallyDamaged(state, lotad)).toBe(false);
  });

  it("evolving into Gastrodon turns Vibrant Dance off and Knocks Out p2's Lotad in the same action", () => {
    const state = board("shellos");
    const gastrodon = state.players.p1.hand[0] as string;
    const { state: after, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: gastrodon,
      target: { spot: "bench", index: 0 },
    });
    expect(types(events)).toEqual(["POKEMON_EVOLVED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(events.find((event) => event.type === "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("retreating Gastrodon onto the Bench turns Sticky Bind on and Knocks Out p2's Lotad", () => {
    const state = board("gastrodon");
    const deck = state.players.p1.deck;
    const energy = deck.filter((uid) => state.cardIdByUid[uid] === "fix-energy").slice(0, 3);
    const withEnergy: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...(state.players.p1.active as InPlayPokemon), energy },
          deck: deck.filter((uid) => !energy.includes(uid)),
        },
      },
    };
    const { state: after, events } = mustApply(withEnergy, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [...energy],
      promoteBenchIndex: 0,
    });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(events.find((event) => event.type === "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("§14: a promotion with the game already won ends the game, no pick left open (COR-P0E)", () => {
  it("a promote stage whose opponent has no Pokémon in play finishes the game", () => {
    const state = board("shellos");
    const p1 = state.players.p1;
    const decided: GameState = {
      ...state,
      pending: [{ kind: "promote", seat: "p1" }],
      players: {
        ...state.players,
        p1: {
          ...p1,
          active: null,
          bench: [p1.bench[0] as InPlayPokemon, p1.active as InPlayPokemon],
        },
        p2: { ...state.players.p2, active: null, bench: [] },
      },
    };
    const result = advance(decided, []);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "noPokemon" },
    });
    expect(types(result.events)).toEqual(["GAME_OVER"]);
  });
});
