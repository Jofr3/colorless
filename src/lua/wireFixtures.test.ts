// The Lua tests parse these files as the snapshots TypeScript publishes, so
// each must match what the real emitters produce today.
//
//   bunx vitest run src/lua/wireFixtures.test.ts -u

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CardBrief, createSnapshot, makePlayer, publicSeatId } from "@colorless/schema";
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
import type { PlayableDeck } from "../game/sandboxDecks";
import { LobbyClient } from "../online/lobbyClient";
import { fakeLobbyChannel, testSeatId } from "../test/fakeLobbyChannel";
import { json, stubFetch } from "../test/fetchStub";
import { USER } from "../test/fixtures";
import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSandbox } from "./sandbox";
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

const memoryStorage = () => {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
};
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

const deck = (id: string, name: string, cardCount: number, tint: number): Deck => ({
  id,
  name,
  format: null,
  folderId: null,
  cardCount,
  tint,
  coverCardId: null,
  position: 0,
  updated: "2026-10-01T00:00:00.000Z",
});

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
    builder.entries.set("sv01-999", 3);
    builder.pending = new Set(["sv01-999"]);
    builder.emit();
    await pin("builder_pending_snapshot.txt", published.at(-1) ?? "");
  });

  it("the online lobby", async () => {
    vi.useFakeTimers();
    const published: string[] = [];
    let channel: ReturnType<typeof fakeLobbyChannel> | undefined;
    const online = new LuaOnline(
      (raw) => published.push(raw),
      () => {},
      {
        user: () => USER,
        client: (opts) => {
          channel = fakeLobbyChannel();
          return new LobbyClient(opts, { channel: channel.channel });
        },
      },
    );
    online.session("authenticated", USER.id);
    await online.command("open");
    await online.command("join\tABCD");
    const staked = JSON.parse(sessionStorage.getItem("online.identity.ABCD") ?? "{}");
    const me = {
      ...makePlayer(publicSeatId(staked.secret), "Ash"),
      hasDeck: true,
      deckName: "Zap",
    };
    channel?.push({
      kind: "state",
      snapshot: {
        ...createSnapshot("ABCD", { ...makePlayer(testSeatId("h"), "Misty"), ready: true }),
        phase: "selecting",
        guest: me,
      },
    });
    const playable = (d: Deck, formatName: string, standard: boolean): PlayableDeck => ({
      ...d,
      online: standard,
      formatName,
      standard,
      expanded: true,
    });
    online.decks = [
      playable(deck("d1", "Zap", 60, 90), "Standard", true),
      playable(deck("d2", "Relic", 60, 30), "Expanded", false),
    ];
    online.deckPhase = "ready";
    online.emit();
    await pin("online_snapshot.txt", published.at(-1) ?? "");
    online.halt();
  });

  it("the sandbox chooser", async () => {
    const published: string[] = [];
    const sandbox = new LuaSandbox(
      (raw) => published.push(raw),
      async () => () => {},
    );
    sandbox.decks = [deck("d1", "Fire Rush", 60, 20), deck("d2", "Water Wall", 42, 200)];
    sandbox.selected = ["d1", "d2"];
    sandbox.phase = "ready";
    sandbox.emit();
    await pin("sandbox_snapshot.txt", published.at(-1) ?? "");
  });

  it("the account", async () => {
    const published: string[] = [];
    stubFetch({ "GET /auth/me": () => json({ ...USER, namePrompt: true }) });
    await new LuaAccount((raw) => published.push(raw)).refresh();
    await pin("account_snapshot.txt", published.at(-1) ?? "");
  });
});
