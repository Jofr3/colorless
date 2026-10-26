// The Lua tests parse these files as the snapshots TypeScript publishes, so
// each must match what the real emitters produce today.
//
//   bunx vitest run src/lua/wireFixtures.test.ts -u

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardBrief } from "@colorless/schema";
import type { GameState } from "@colorless/engine";
import {
  attachFromDeck,
  attachToolFromDeck,
  driveSetup,
  patchSide,
  setActiveFromDeck,
  setDamage,
  STADIUM_TOOL_DECK,
  trainerCard,
} from "@colorless/engine/testing";
import { toBuilderCard } from "../decks/catalog";
import type { Deck } from "../decks/data";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaSimulator } from "./simulator";
import { WIRE_ROWS, wireColumn } from "./wireFields";

const SIM = WIRE_ROWS.sim;
const GAME_PHASE = wireColumn(SIM.header, "gamePhase");
const ZONE = wireColumn(SIM.card, "zone");

const pin = (name: string, raw: string) =>
  expect(`${raw}\n`).toMatchFileSnapshot(
    `../../frontend/lua/tests/fixtures/${name}`,
    "the Lua wire changed; regenerate with `bunx vitest run src/lua/wireFixtures.test.ts -u`",
  );

const parse = (raw: string) => raw.split("\n").map((r) => r.split("\t").map(decodeURIComponent));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const NEST_BALL = "nest-ball";

/** Turn 1, p1 to act: an armed Active under a Stadium, a damaged opponent, a
    Nest Ball in hand. */
function table(): GameState {
  let state = driveSetup(
    7,
    { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-attacker" } },
  );
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = attachToolFromDeck(state, "p1", "active", "fix-tool");
  state = setDamage(state, "p2", 40);
  const stadium = state.players.p2.deck.find((uid) => state.cardIdByUid[uid] === "sv01-167");
  if (!stadium) throw Error("Missing Beach Court");
  state = patchSide(state, "p2", { deck: state.players.p2.deck.filter((u) => u !== stadium) });
  state = { ...state, stadium: { uid: stadium, owner: "p2" } };
  state = {
    ...state,
    cardPool: {
      ...state.cardPool,
      "sv01-181": {
        ...trainerCard(
          "sv01-181",
          "Item",
          "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
        ),
        name: "Nest Ball",
      },
    },
    cardIdByUid: { ...state.cardIdByUid, [NEST_BALL]: "sv01-181" },
  };
  return patchSide(state, "p1", { hand: [...state.players.p1.hand, NEST_BALL] });
}

describe("Lua wire fixtures", () => {
  it("the simulator table and an effect prompt", async () => {
    const published: string[] = [];
    const sim = new LuaSimulator(
      (raw) => published.push(raw),
      () => {},
    );
    sim.open({
      state: table(),
      events: [],
      names: { p1: "Ash", p2: "Misty" },
      startedAt: 100,
    });
    const board = published.at(-1) ?? "";
    const rows = parse(board);
    expect(rows[0]?.[GAME_PHASE]).toBe("turn:action");
    const stadium = rows.find((r) => r[0] === "C" && r[ZONE] === "stadium");
    expect(stadium?.length).toBe(rows.find((r) => r[0] === "C" && r[ZONE] === "active")?.length);
    await pin("sim_snapshot.txt", board);

    const action = (field: (typeof SIM.cardAction.fields)[number]) =>
      wireColumn(SIM.cardAction, field);
    const play = rows.find(
      (r) => r[0] === "K" && r[action("uid")] === NEST_BALL && r[action("label")] === "Play",
    );
    sim.command(`invoke\t${sim.revision}\t${play?.[action("token")]}`);
    const prompt = published.at(-1) ?? "";
    expect(parse(prompt)[0]?.[GAME_PHASE]).toBe("effect:choose");
    await pin("sim_prompt.txt", prompt);
  });

  it("the deck library", async () => {
    const published: string[] = [];
    const library = new LuaLibrary(
      (raw) => published.push(raw),
      () => {},
    );
    const deck = (id: string, name: string, cardCount: number, tint: number): Deck => ({
      id,
      name,
      folderId: null,
      cardCount,
      tint,
      coverCardId: null,
      position: 0,
    });
    library.decks = [
      deck("d1", "Fire Rush", 60, 20),
      deck("d2", "Water Wall", 42, 200),
      deck("d3", "Zap Zone", 60, 90),
    ];
    library.legality = new Map([
      ["d1", true],
      ["d2", false],
    ]);
    library.phase = "ready";
    library.result = "ok";
    library.emit();
    await pin("library_snapshot.txt", published.at(-1) ?? "");
  });

  it("the deck builder", async () => {
    const published: string[] = [];
    const builder = new LuaBuilder(
      (raw) => published.push(raw),
      () => {},
    );
    const brief = (id: string, name: string, category: CardBrief["category"]): CardBrief => ({
      id,
      name,
      category,
      rarity: "Common",
      image: "art",
      setId: "sv1",
      localId: "12",
      types: category === "Pokemon" ? ["Lightning"] : [],
      hp: category === "Pokemon" ? 60 : null,
      regulationMark: "G",
      stage: category === "Pokemon" ? "Basic" : null,
      trainerType: category === "Trainer" ? "Item" : null,
      energyType: category === "Energy" ? "Normal" : null,
      legal: { standard: true, expanded: true },
    });
    const pikachu = toBuilderCard(brief("sv01-050", "Pikachu", "Pokemon"));
    const ball = toBuilderCard(brief("sv01-181", "Nest Ball", "Trainer"));
    builder.phase = "ready";
    builder.name = "Electric Dreams";
    builder.results = [pikachu, ball];
    builder.total = 2;
    builder.cards = new Map([
      [pikachu.cardId, pikachu],
      [ball.cardId, ball],
    ]);
    builder.entries = new Map([
      [pikachu.cardId, 4],
      [ball.cardId, 2],
    ]);
    builder.gaps = new Map([[pikachu.cardId, ["ability", "attack"]]]);
    builder.selected = pikachu.cardId;
    builder.emit();
    await pin("builder_snapshot.txt", published.at(-1) ?? "");
  });
});
