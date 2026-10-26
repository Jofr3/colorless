import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { benchMatches, cardOfUid, hpOf, matchesFilter } from "./cards";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { deriveAttackDamageBonus } from "./effects";
import type { CardFilter } from "./effectTypes";
import type { GameEvent } from "./events";
import { FOSSIL_IDS, fossilPokemonCard } from "./fossils";
import { applyAction } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  must,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const QUARRY_TEXT =
  'Once during each player\'s turn, that player may search their deck for up to 2 Item cards that have "Antique" in their name and put them onto their Bench. Then, that player shuffles their deck.';
const BEATDOWN_TEXT =
  'This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name.';
const FOSSIL_RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";

const QUARRY = "me05-076";
const RELICANTH = "me05-017";
const COVER = "sv07-129";
const ROOT = "sv07-130";
const PLUME = "sv10.5w-079";
const JAW = "me03-068";
const LILEEP = "sv07-005";
const TYRANITAR = "sv09-095"; // "Daunting Gaze" — the opponent can't play Item cards from their hand
const NEST_BALL = "sv01-181";
const ANTIQUE_TOOL = "d635-antique-tool";
const FILLER = "d635-filler";
const WALL = "d635-wall";
const ENERGY = "fix-energy";

function fossilRow(id: string, name: string): Card {
  const face = CATALOG_MANIFEST.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return { ...trainerCard(id, "Item", FOSSIL_RULE), name, hp: face.hp, abilities: face.abilities };
}

const LOCAL_CARDS: Record<string, Card> = {
  [QUARRY]: { ...trainerCard(QUARRY, "Stadium", QUARRY_TEXT), name: "Fossil Quarry" },
  [RELICANTH]: battler(RELICANTH, {
    name: "Relicanth",
    types: ["Water"],
    hp: 100,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Fossil Beatdown", damage: "10+", effect: BEATDOWN_TEXT },
    ],
  }),
  [COVER]: fossilRow(COVER, "Antique Cover Fossil"),
  [ROOT]: fossilRow(ROOT, "Antique Root Fossil"),
  [PLUME]: fossilRow(PLUME, "Antique Plume Fossil"),
  [JAW]: fossilRow(JAW, "Antique Jaw Fossil"),
  [LILEEP]: battler(LILEEP, {
    name: "Lileep",
    stage: "Stage1",
    evolveFrom: "Antique Root Fossil",
    types: ["Grass"],
    hp: 100,
  }),
  [TYRANITAR]: battler(TYRANITAR, {
    name: "Tyranitar",
    types: ["Darkness"],
    hp: 900,
    abilities: [
      {
        type: "Ability",
        name: "Daunting Gaze",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.",
      },
    ],
  }),
  [ANTIQUE_TOOL]: {
    ...trainerCard(ANTIQUE_TOOL, "Tool", "A test Tool."),
    name: "Antique Test Tool",
  },
  [FILLER]: battler(FILLER, { name: "D635 Filler", hp: 300, types: ["Colorless"] }),
  [WALL]: battler(WALL, { name: "D635 Wall", hp: 900, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [QUARRY]: 1,
  [RELICANTH]: 2,
  [COVER]: 2,
  [ROOT]: 2,
  [PLUME]: 2,
  [JAW]: 2,
  [LILEEP]: 1,
  [TYRANITAR]: 1,
  [NEST_BALL]: 2,
  [ANTIQUE_TOOL]: 2,
  [FILLER]: 25,
  [WALL]: 4,
  [ENERGY]: 14,
});

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — both hands and every Prize back into the decks, so every card is searchable. */
function emptied(state: GameState): GameState {
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    players[seat] = {
      ...side,
      deck: [...side.deck, ...side.hand, ...side.prizes],
      hand: [],
      prizes: [],
    };
  }
  return { ...state, players };
}

/** p1's turn 2: `active` for p1 and `oppActive` for p2, each Bench exactly the listed bodies. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = WALL,
  oppBench: readonly string[] = [],
  seed = 6351,
): GameState {
  let state = emptied(opened(seed));
  state = setActiveFromDeck(state, "p1", active);
  state = setActiveFromDeck(state, "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of oppBench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** TEST SURGERY — Fossil Quarry into the shared Stadium zone, owned by `owner`. */
function quarry(state: GameState, owner: Seat = "p1"): GameState {
  const side = state.players[owner];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === QUARRY) as string;
  return {
    ...state,
    stadium: { uid, owner },
    players: { ...state.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

const use = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "useStadiumAbility", seat });
const cards = (uids: readonly string[], seat: Seat = "p1"): GameAction => ({
  type: "resolveEffect",
  seat,
  choice: { kind: "cards", uids: [...uids] },
});
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  const p = state.phase.prompt;
  if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
  return p;
}
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const ANTIQUE: CardFilter = { kind: "itemNameContaining", fragment: "Antique" };

describe("D635 §1 — the prints and the programs", () => {
  it("Fossil Quarry is one Stadium object: an up-to-2 Antique Item search onto the Bench, then the shuffle", () => {
    expect(programFor(QUARRY)).toEqual({
      stadium: {
        ability: {
          label: "Fossil Quarry",
          program: [
            { op: "searchDeck", filter: ANTIQUE, dest: "bench", max: 2 },
            { op: "shuffleDeck" },
          ],
        },
      },
    });
    // No turn end: Lumiose City's program without `endsTurn` (the print has no "their turn ends").
    expect(programFor(QUARRY)?.stadium?.ability?.endsTurn).toBeUndefined();
  });

  it("Fossil Beatdown is a reader row: the Bench count narrowed by the quoted fragment, no registry key", () => {
    expect(programFor(RELICANTH)).toBeUndefined();
    expect(deriveAttackDamageBonus(BEATDOWN_TEXT)).toEqual({
      per: 30,
      count: {
        kind: "yourBenchCount",
        filter: { kind: "pokemonNameContaining", fragment: "Antique" },
      },
    });
    // The Tauros key is untouched; an unprinted fragment stays unread.
    expect(deriveAttackDamageBonus(BEATDOWN_TEXT.replace("Antique", "Fossil"))).toBeNull();
  });

  it("the dropped fossils stay unbuilt: no program, no in-play face ( D637 (D539): WITHDRAWN — all four are built at D637: a program and an in-play face each)", () => {
    for (const id of [JAW, "me03-069", "me05-072", "me05-073"]) {
      expect(programFor(id)?.playAsPokemon, id).toBe(true);
      expect(FOSSIL_IDS.has(id), id).toBe(true);
    }
  });
});

describe("D635 §2 — `itemNameContaining` and the Bench gate", () => {
  it("matches an Item whose name holds the fragment, and no Tool, Pokémon or fragment-free Item", () => {
    expect(matchesFilter(POOL[COVER], ANTIQUE)).toBe(true);
    expect(matchesFilter(POOL[JAW], ANTIQUE)).toBe(true);
    expect(matchesFilter(POOL[NEST_BALL], ANTIQUE)).toBe(false);
    expect(matchesFilter(POOL[ANTIQUE_TOOL], ANTIQUE)).toBe(false);
    // A fossil's in-play face is a Pokémon, not an Item.
    expect(matchesFilter(fossilPokemonCard(POOL[COVER] as Card), ANTIQUE)).toBe(false);
    expect(matchesFilter(POOL[COVER], { kind: "itemNameContaining", fragment: "antique" })).toBe(
      false,
    );
  });

  it("a Trainer goes onto the Bench only with an in-play Pokémon face; Pokémon are read as before", () => {
    expect(benchMatches(POOL[COVER], ANTIQUE)).toBe(true);
    expect(benchMatches(POOL[JAW], ANTIQUE)).toBe(true);
    const faceLess: Card = {
      ...trainerCard("d635-face-less", "Item", "An Antique test Item."),
      name: "Antique Test Item",
    };
    expect(matchesFilter(faceLess, ANTIQUE)).toBe(true);
    expect(benchMatches(faceLess, ANTIQUE)).toBe(false);
    expect(benchMatches(POOL[NEST_BALL], { kind: "item" })).toBe(false);
    expect(benchMatches(POOL[FILLER], { kind: "anyPokemon" })).toBe(true);
    expect(benchMatches(POOL[LILEEP], { kind: "anyPokemon" })).toBe(false);
  });
});

describe("D635 §3 — Fossil Quarry on the board", () => {
  it("offers exactly the built Antique fossils in the deck, up to 2, and benches the picks as fossil bodies", () => {
    const board = quarry(table(FILLER));
    const { state: parked, events: opened } = use(board);
    expect(of(opened, "STADIUM_ABILITY_ACTIVATED")).toHaveLength(1);
    const p = prompt(parked);
    expect(p.max).toBe(2);
    expect(new Set(ids(parked, p.candidates))).toEqual(new Set([COVER, ROOT, PLUME, JAW]));
    expect(p.candidates).toHaveLength(8);
    expect(JSON.stringify(p)).toContain('Item cards that have \\"Antique\\" in their name');
    const picks = [
      p.candidates.find((u) => parked.cardIdByUid[u] === COVER),
      p.candidates.find((u) => parked.cardIdByUid[u] === PLUME),
    ] as string[];
    const { state, events } = mustApply(parked, cards(picks));
    expect(state.players.p1.bench.map((b) => b.stack)).toEqual(picks.map((u) => [u]));
    for (const uid of picks) {
      const face = cardOfUid(state, uid);
      expect(face?.category).toBe("Pokemon");
      expect(face && hpOf(face)).toBe(60);
      expect(state.players.p1.deck).not.toContain(uid);
    }
    expect(of(events, "DECK_SEARCHED")).toMatchObject([{ seat: "p1", dest: "bench", uids: picks }]);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
    // No turn end, and once per turn.
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expectErr(state, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_ALREADY_USED");
  });

  it("the Bench clamp: 4 benched bodies leave room for 1", () => {
    const { state: parked } = use(quarry(table(FILLER, [FILLER, FILLER, FILLER, FILLER])));
    expect(prompt(parked).max).toBe(1);
  });

  it("taking nothing benches nothing and still shuffles", () => {
    const { state: parked } = use(quarry(table(FILLER)));
    const { state, events } = mustApply(parked, cards([]));
    expect(state.players.p1.bench).toEqual([]);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("R-FQ1 — benching is not playing an Item: Daunting Gaze in the opposing Active does not refuse it", () => {
    const board = quarry(table(FILLER, [], TYRANITAR));
    const { state: parked } = use(board);
    const pick = prompt(parked).candidates[0] as string;
    const { state } = mustApply(parked, cards([pick]));
    expect(state.players.p1.bench.map((b) => b.stack[0])).toEqual([pick]);
  });

  it("the opponent uses it on their own turn and searches their own deck", () => {
    const { state: parked } = use(quarry(table(FILLER)));
    const p2Turn = mustApply(mustApply(parked, cards([])).state, {
      type: "endTurn",
      seat: "p1",
    }).state;
    const { state: theirs } = use(p2Turn, "p2");
    const p = prompt(theirs);
    for (const uid of p.candidates) expect(theirs.players.p2.deck).toContain(uid);
    expect(new Set(ids(theirs, p.candidates))).toEqual(new Set([COVER, ROOT, PLUME, JAW]));
  });

  it("a parked Fossil Quarry round-trips through JSON", () => {
    const { state: parked } = use(quarry(table(FILLER)));
    const revived = roundTrip(parked);
    expect(revived).toEqual(parked);
    const pick = [prompt(parked).candidates[0] as string];
    expect(mustApply(revived, cards(pick)).state).toEqual(mustApply(parked, cards(pick)).state);
  });
});

describe('D635 §4 — Relicanth "Fossil Beatdown": +30 per benched Antique', () => {
  const beat = (state: GameState) => {
    const charged = attachFromDeck(state, "p1", ENERGY, 1);
    const { state: after } = mustApply(charged, { type: "attack", seat: "p1", index: 0 });
    return after.players.p2.active?.damage ?? -1;
  };

  it("10 with no Antique benched, +30 for each benched fossil, a non-Antique body not counted", () => {
    expect(beat(table(RELICANTH, [FILLER]))).toBe(10);
    expect(beat(table(RELICANTH, [COVER]))).toBe(40);
    expect(beat(table(RELICANTH, [COVER, PLUME, FILLER, ROOT]))).toBe(100);
  });

  it("the attacker's Bench only: the opponent's benched fossils are not counted", () => {
    expect(beat(table(RELICANTH, [COVER], WALL, [ROOT, PLUME]))).toBe(40);
  });

  it("the TOP card is read: a fossil evolved into Lileep is not an Antique any more", () => {
    let state = table(RELICANTH, [ROOT, COVER]);
    const side = state.players.p1;
    const lileep = side.deck.find((u) => state.cardIdByUid[u] === LILEEP) as string;
    const [root, ...rest] = side.bench;
    if (root === undefined) throw new Error("no benched fossil");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          deck: side.deck.filter((u) => u !== lileep),
          bench: [{ ...root, stack: [...root.stack, lileep] }, ...rest],
        },
      },
    };
    expect(beat(state)).toBe(40);
  });
});
