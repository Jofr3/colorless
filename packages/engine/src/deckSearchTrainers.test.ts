import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { isAceSpec } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
  typedEnergy,
  types,
  must,
} from "./testFixtures";

const HILDA_TEXT =
  "Search your deck for an Evolution Pokémon and an Energy card, reveal them, and put them into your hand. Then, shuffle your deck.";
const COLRESS_TEXT =
  "Search your deck for a Stadium card and an Energy card, reveal them, and put them into your hand. Then, shuffle your deck.";
const CYRANO_TEXT =
  "Search your deck for up to 3 Pokémon ex, reveal them, and put them into your hand. Then, shuffle your deck.";
const AROMA_TEXT =
  "Search your deck for up to 3 Stage 1 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
const TRANSCEIVER_TEXT =
  'Search your deck for a Supporter card that has "Team Rocket" in its name, reveal it, and put it into your hand. Then, shuffle your deck.';
const ESP_TEXT =
  "Search your deck for any number of Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.";
const TROLLEY_TEXT =
  "Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const BOXED_TEXT =
  "Search your deck for up to 2 Item cards, reveal them, and put them into your hand. Then, shuffle your deck. Your turn ends.";
const CASSIOPEIA_TEXT =
  "You can use this card only when it is the last card in your hand.\n\nSearch your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

const HILDA = ["sv10.5w-084", "sv10.5w-164", "sv10.5w-171"] as const;
const COLRESS = ["sv06.5-057", "sv06.5-087"] as const;
const CYRANO = ["sv08-170", "sv08-230"] as const;
const AROMA = ["sv06-152"] as const;
const TRANSCEIVER = ["sv10-178"] as const;
const ESP = ["sv08-176"] as const;
const TROLLEY = ["sv08-185"] as const;
const BOXED = ["sv05-143"] as const;
const CASSIOPEIA = ["sv06.5-056", "sv06.5-086", "sv06.5-094"] as const;

const FILLER = "d554-filler";
const STAGE1 = "d554-stage1";
const STAGE2 = "d554-stage2";
const EX = "d554-ex";
const V = "d554-v";
const FIRE = "d554-fire";
const WATER = "d554-water";
const SPECIAL = "d554-special";
const STADIUM = "d554-stadium";
const ITEM = "d554-item";
const TOOL = "d554-tool";
const SUPPORTER = "d554-supporter";
const TR_SUPPORTER = "fix-trsupporter"; // "Team Rocket's Ambition" — a Supporter, the positive
const TR_GRUNT = "fix-trgrunt"; // "Grunt of Team Rocket" — the fragment at a non-zero offset
const TR_ITEM = "fix-trtransceiver"; // "Team Rocket's Transceiver" — an ITEM, the head-noun control

function printed(id: string, name: string, trainerType: string, effect: string, ace = false): Card {
  return {
    ...trainerCard(id, trainerType, effect),
    name,
    ...(ace ? { rarity: "ACE SPEC Rare" } : {}),
  };
}

function printings(
  ids: readonly string[],
  name: string,
  trainerType: string,
  effect: string,
  ace = false,
): Record<string, Card> {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType, effect, ace)]));
}

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(HILDA, "Hilda", "Supporter", HILDA_TEXT),
  ...printings(COLRESS, "Colress's Tenacity", "Supporter", COLRESS_TEXT),
  ...printings(CYRANO, "Cyrano", "Supporter", CYRANO_TEXT),
  ...printings(AROMA, "Hyper Aroma", "Item", AROMA_TEXT, true),
  ...printings(TRANSCEIVER, "Team Rocket's Transceiver", "Item", TRANSCEIVER_TEXT),
  ...printings(ESP, "Energy Search Pro", "Item", ESP_TEXT, true),
  ...printings(TROLLEY, "Precious Trolley", "Item", TROLLEY_TEXT, true),
  ...printings(BOXED, "Boxed Order", "Item", BOXED_TEXT),
  ...printings(CASSIOPEIA, "Cassiopeia", "Supporter", CASSIOPEIA_TEXT),
  [FILLER]: battler(FILLER, {
    name: "D554 Filler",
    hp: 200,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [STAGE1]: battler(STAGE1, { name: "D554 Stage One", stage: "Stage1", evolveFrom: "D554 Filler" }),
  [STAGE2]: battler(STAGE2, {
    name: "D554 Stage Two",
    stage: "Stage2",
    evolveFrom: "D554 Stage One",
  }),
  [EX]: battler(EX, { name: "D554 Beast ex" }),
  [V]: battler(V, { name: "D554 Hero V" }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
  [SPECIAL]: specialEnergy(SPECIAL, "D554 Special Energy"),
  [STADIUM]: printed(STADIUM, "D554 Stadium", "Stadium", "A D554 Stadium."),
  [ITEM]: printed(ITEM, "D554 Item", "Item", "A D554 Item."),
  [TOOL]: printed(TOOL, "D554 Tool", "Tool", "A D554 Tool."),
  [SUPPORTER]: printed(SUPPORTER, "D554 Supporter", "Supporter", "A D554 Supporter."),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [HILDA[0]]: 1,
  [COLRESS[0]]: 1,
  [CYRANO[0]]: 1,
  [AROMA[0]]: 1,
  [TRANSCEIVER[0]]: 1,
  [ESP[0]]: 1,
  [TROLLEY[0]]: 1,
  [BOXED[0]]: 1,
  [CASSIOPEIA[0]]: 1,
  [FILLER]: 16,
  [STAGE1]: 3,
  [STAGE2]: 3,
  [EX]: 3,
  [V]: 2,
  [FIRE]: 4,
  [WATER]: 4,
  [SPECIAL]: 2,
  [STADIUM]: 2,
  [ITEM]: 2,
  [TOOL]: 2,
  [SUPPORTER]: 2,
  [TR_SUPPORTER]: 2,
  [TR_GRUNT]: 2,
  [TR_ITEM]: 2,
});

const isBasic = (id: string) => POOL[id]?.category === "Pokemon" && POOL[id]?.stage === "Basic";

/** p1 on its own (unrestricted) turn 2 — p2 went first and passed — with a FILLER
    Active and an EMPTY Bench. */
function board(seed = 5540): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => isBasic(state.cardIdByUid[h] ?? ""));
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", FILLER);
  return clearBench(state, "p1");
}

/** p1's hand holds a copy of `id` — dealt, pulled from the deck, or (when the one copy
    was prized) SWAPPED out of the Prizes for a deck card, so every zone keeps its size
    and every uid stays in exactly one zone. */
function holding(state: GameState, id: string): { state: GameState; uid: string } {
  const side = state.players.p1;
  const dealt = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (dealt !== undefined) return { state, uid: dealt };
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) {
    const next = handFromDeck(state, "p1", id, 1);
    const uid = next.players.p1.hand.find((u) => next.cardIdByUid[u] === id) as string;
    return { state: next, uid };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[0];
  if (prized === undefined || swap === undefined)
    throw new Error(`no ${id} anywhere in p1's deck or Prizes`);
  const next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        prizes: side.prizes.map((u) => (u === prized ? swap : u)),
        deck: side.deck.slice(1),
        hand: [...side.hand, prized],
      },
    },
  };
  return { state: next, uid: prized };
}

/** TEST SURGERY — p1's hand is exactly `keep`; the rest goes to the discard. */
function handOnly(state: GameState, keep: readonly string[]): GameState {
  const side = state.players.p1;
  const rest = side.hand.filter((u) => !keep.includes(u));
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: [...keep], discard: [...side.discard, ...rest] },
    },
  };
}

/** TEST SURGERY — every card of p1's DECK that `drop` names goes to the discard. */
function stripDeck(state: GameState, drop: (id: string) => boolean): GameState {
  const side = state.players.p1;
  const gone = new Set(side.deck.filter((u) => drop(state.cardIdByUid[u] ?? "")));
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => !gone.has(u)),
        discard: [...side.discard, ...gone],
      },
    },
  };
}

/** Play `id` from p1's hand; `prep` runs AFTER the card is in hand (so a deck strip
    cannot take it) and is handed its uid. Returns the pre-play board too. */
function play(
  id: string,
  prep: (s: GameState, uid: string) => GameState = (s) => s,
  seed?: number,
) {
  const held = holding(board(seed), id);
  const before = prep(held.state, held.uid);
  const result = mustApply(before, { type: "playTrainer", seat: "p1", uid: held.uid });
  return { before, uid: held.uid, ...result };
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return prompt;
}

function resolve(uids: readonly string[]): GameAction {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } };
}

function deckUids(state: GameState, match: (id: string) => boolean): string[] {
  return state.players.p1.deck.filter((u) => match(state.cardIdByUid[u] ?? ""));
}

function pickOf(state: GameState, id: string, n = 1): string[] {
  const got = parkOf(state)
    .candidates.filter((u) => state.cardIdByUid[u] === id)
    .slice(0, n);
  if (got.length < n) throw new Error(`fewer than ${n} ${id} on offer`);
  return got;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const ctx = (state: GameState): LogContext => ({
  names: { p1: "Ember", p2: "Tide" },
  state,
  elapsed: formatElapsed(0),
});

function searchRow(state: GameState, events: GameEvent[]): string {
  const row = logFromEvents(events, ctx(state)).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("searched their deck")),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

const sorted = (xs: readonly string[]) => [...xs].sort();

const PRINTS: readonly {
  name: string;
  ids: readonly string[];
  text: string;
  trainerType: "Item" | "Supporter";
  keys: readonly string[];
  program: unknown;
  caption: string;
}[] = [
  {
    name: "Hilda",
    ids: HILDA,
    text: HILDA_TEXT,
    trainerType: "Supporter",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "evolutionPokemon" },
          dest: "hand",
          max: 1,
          reveal: true,
          also: [{ filter: { kind: "anyEnergy" }, max: 1 }],
        },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for an Evolution Pokémon and an Energy card into your hand.",
  },
  {
    name: "Colress's Tenacity",
    ids: COLRESS,
    text: COLRESS_TEXT,
    trainerType: "Supporter",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "stadium" },
          dest: "hand",
          max: 1,
          reveal: true,
          also: [{ filter: { kind: "anyEnergy" }, max: 1 }],
        },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for a Stadium card and an Energy card into your hand.",
  },
  {
    name: "Cyrano",
    ids: CYRANO,
    text: CYRANO_TEXT,
    trainerType: "Supporter",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "suffixPokemon", suffix: "ex" },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for up to 3 Pokémon ex into your hand.",
  },
  {
    name: "Hyper Aroma",
    ids: AROMA,
    text: AROMA_TEXT,
    trainerType: "Item",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "stagePokemon", stage: "Stage1" },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for up to 3 Stage 1 Pokémon into your hand.",
  },
  {
    name: "Team Rocket's Transceiver",
    ids: TRANSCEIVER,
    text: TRANSCEIVER_TEXT,
    trainerType: "Item",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "supporterNameContaining", fragment: "Team Rocket" },
          dest: "hand",
          max: 1,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
    caption:
      'Search your deck for a Supporter card that has "Team Rocket" in its name into your hand.',
  },
  {
    name: "Energy Search Pro",
    ids: ESP,
    text: ESP_TEXT,
    trainerType: "Item",
    keys: ["trainer"],
    program: {
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "basicEnergy" },
          dest: "hand",
          max: "any",
          reveal: true,
          distinctEnergyTypes: true,
        },
        { op: "shuffleDeck" },
      ],
    },
    caption:
      "Search your deck for any number of Basic Energy cards of different types into your hand.",
  },
  {
    name: "Precious Trolley",
    ids: TROLLEY,
    text: TROLLEY_TEXT,
    trainerType: "Item",
    keys: ["trainer"],
    program: {
      trainer: [
        { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: "any" },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for any number of Basic Pokémon onto your Bench.",
  },
  {
    name: "Boxed Order",
    ids: BOXED,
    text: BOXED_TEXT,
    trainerType: "Item",
    keys: ["trainer", "trainerEndsTurn"],
    program: {
      trainer: [
        { op: "searchDeck", filter: { kind: "item" }, dest: "hand", max: 2, reveal: true },
        { op: "shuffleDeck" },
      ],
      trainerEndsTurn: true,
    },
    caption: "Search your deck for up to 2 Item cards into your hand.",
  },
  {
    name: "Cassiopeia",
    ids: CASSIOPEIA,
    text: CASSIOPEIA_TEXT,
    trainerType: "Supporter",
    keys: ["trainer", "trainerPlayableIf"],
    program: {
      trainerPlayableIf: { kind: "yourHandExactly", count: 1 },
      trainer: [
        { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 2 },
        { op: "shuffleDeck" },
      ],
    },
    caption: "Search your deck for up to 2 cards into your hand.",
  },
];

/** Cassiopeia needs a one-card hand; every other card plays on the dealt hand. */
const prepFor = (name: string) => (s: GameState, uid: string) =>
  name === "Cassiopeia" ? handOnly(s, [uid]) : s;

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §1 — the print, and the registry rows that map it", () => {
  for (const p of PRINTS) {
    it(`${p.name}: pinned by toEqual, keys ${p.keys.join(" + ")}, every printing on ONE object, the shuffle last`, () => {
      const program = programFor(p.ids[0] as string);
      expect(program).toEqual(p.program);
      expect(Object.keys(program ?? {}).sort()).toEqual([...p.keys].sort());
      for (const id of p.ids) {
        expect(programFor(id)).toBe(program);
        expect(POOL[id]?.name).toBe(p.name);
        expect(POOL[id]?.trainerType).toBe(p.trainerType);
        expect(POOL[id]?.effect).toBe(p.text);
      }
      expect(program?.trainer?.[program.trainer.length - 1]).toEqual({ op: "shuffleDeck" });
      expect(p.text).toContain("Then, shuffle your deck.");
    });
  }

  it("nine DISTINCT objects on fifteen ids, and none is a shipped search's (D199)", () => {
    const ids = PRINTS.flatMap((p) => p.ids);
    expect(ids).toHaveLength(15);
    const objects = new Set(PRINTS.map((p) => programFor(p.ids[0] as string)));
    expect(objects.size).toBe(9);
    // Larry's Skill (the `also` shape), Nest Ball (the bench search), Katy (the other
    // trainerEndsTurn) and Proton are not reused.
    for (const shipped of ["sv08.5-115", "sv01-181", "sv01-177", "sv10-176"]) {
      expect(objects.has(programFor(shipped))).toBe(false);
    }
  });

  it("trainerEndsTurn ONLY on Boxed Order, trainerPlayableIf ONLY on Cassiopeia", () => {
    for (const p of PRINTS) {
      const program = programFor(p.ids[0] as string);
      expect(program?.trainerEndsTurn === true, p.name).toBe(p.name === "Boxed Order");
      expect(program?.trainerPlayableIf !== undefined, p.name).toBe(p.name === "Cassiopeia");
    }
    expect(BOXED_TEXT.endsWith("Your turn ends.")).toBe(true);
    expect(
      CASSIOPEIA_TEXT.startsWith(
        "You can use this card only when it is the last card in your hand.",
      ),
    ).toBe(true);
  });

  it("`reveal` is set exactly where the print says reveal — never on Trolley (bench) or Cassiopeia", () => {
    for (const p of PRINTS) {
      const op = programFor(p.ids[0] as string)?.trainer?.[0];
      const reveal = op?.op === "searchDeck" ? op.reveal : undefined;
      expect(reveal === true, p.name).toBe(/reveal (it|them)/.test(p.text));
    }
  });

  it("ACE SPEC is card DATA, not program: the three ACE SPECs carry the rarity and no program key for it", () => {
    for (const id of [AROMA[0], ESP[0], TROLLEY[0]]) {
      expect(isAceSpec(POOL[id])).toBe(true);
      expect(Object.keys(programFor(id) ?? {})).toEqual(["trainer"]);
    }
    for (const id of [HILDA[0], BOXED[0], CASSIOPEIA[0], TRANSCEIVER[0]])
      expect(isAceSpec(POOL[id])).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §2 — the captions, byte for byte (measured)", () => {
  for (const p of PRINTS) {
    it(`${p.name} captions "${p.caption}"`, () => {
      const { state } = play(p.ids[0] as string, prepFor(p.name));
      expect(parkOf(state).note).toBe(p.caption);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §3 — Hilda and Colress's Tenacity: one of each noun, declinable", () => {
  it("Hilda offers every Evolution and every Energy (Special included), capped 1 + 1, total 2, floor 0", () => {
    const { state, before } = play(HILDA[0]);
    const prompt = parkOf(state);
    const evo = deckUids(before, (id) => id === STAGE1 || id === STAGE2);
    const energy = deckUids(before, (id) => id === FIRE || id === WATER || id === SPECIAL);
    expect(sorted(prompt.candidates)).toEqual(sorted([...evo, ...energy]));
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(2);
    expect(prompt.caps?.map((c) => [sorted(c.uids), c.max])).toEqual([
      [sorted(evo), 1],
      [sorted(energy), 1],
    ]);
    expect(prompt.candidates.some((u) => state.cardIdByUid[u] === SPECIAL)).toBe(true);
    expect(prompt.candidates.some((u) => state.cardIdByUid[u] === FILLER)).toBe(false);
  });

  it("Hilda: an Evolution + an Energy land in hand, revealed, then the deck shuffles", () => {
    const { state } = play(HILDA[0]);
    const picks = [...pickOf(state, STAGE2), ...pickOf(state, SPECIAL)];
    const { state: after, events } = mustApply(state, resolve(picks));
    for (const u of picks) expect(after.players.p1.hand).toContain(u);
    expect(find(events, "DECK_SEARCHED")).toEqual({
      type: "DECK_SEARCHED",
      seat: "p1",
      dest: "hand",
      uids: picks,
      reveal: true,
    });
    const order = types(events);
    expect(order.indexOf("SHUFFLE")).toBeGreaterThan(order.indexOf("DECK_SEARCHED"));
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("Hilda refuses TWO Energy and TWO Evolutions — the caps are per noun, not a flat 2", () => {
    const { state } = play(HILDA[0]);
    expectErr(
      state,
      resolve([...pickOf(state, FIRE), ...pickOf(state, WATER)]),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      state,
      resolve([...pickOf(state, STAGE1), ...pickOf(state, STAGE2)]),
      "BAD_EFFECT_CHOICE",
    );
  });

  it("Hilda is DECLINABLE (Larry's Skill's precedent): one noun alone, or none, and the shuffle still runs", () => {
    const { state } = play(HILDA[0]);
    const one = mustApply(state, resolve(pickOf(state, STAGE1)));
    expect(one.state.phase.kind).toBe("turn:action");
    const none = mustApply(state, resolve([]));
    expect(none.state.players.p1.hand).toEqual(state.players.p1.hand);
    expect(find(none.events, "SHUFFLE")?.seat).toBe("p1");
  });

  it("Colress's Tenacity offers Stadiums and Energy — never a Tool, an Item or a Pokémon", () => {
    const { state, before } = play(COLRESS[0]);
    const prompt = parkOf(state);
    const stadiums = deckUids(before, (id) => id === STADIUM);
    const energy = deckUids(before, (id) => id === FIRE || id === WATER || id === SPECIAL);
    expect(sorted(prompt.candidates)).toEqual(sorted([...stadiums, ...energy]));
    for (const near of [TOOL, ITEM, FILLER]) {
      const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === near) as string;
      expect(uid, near).toBeDefined();
      expect(prompt.candidates).not.toContain(uid);
      expectErr(state, resolve([uid]), "BAD_EFFECT_CHOICE");
    }
    expect(prompt.caps?.map((c) => c.max)).toEqual([1, 1]);
    expectErr(
      state,
      resolve([...pickOf(state, FIRE), ...pickOf(state, SPECIAL)]),
      "BAD_EFFECT_CHOICE",
    );
    const done = mustApply(state, resolve([...pickOf(state, STADIUM), ...pickOf(state, WATER)]));
    expect(find(done.events, "DECK_SEARCHED")?.reveal).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §4 — Cyrano and Hyper Aroma: the narrowed Pokémon nouns", () => {
  it("Cyrano offers ONLY Pokémon ex — not a Pokémon V, not a plain Pokémon", () => {
    const { state, before } = play(CYRANO[0]);
    const prompt = parkOf(state);
    expect(sorted(prompt.candidates)).toEqual(sorted(deckUids(before, (id) => id === EX)));
    expect(prompt.max).toBe(3);
    for (const near of [V, FILLER, STAGE1]) {
      const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === near) as string;
      expectErr(state, resolve([uid]), "BAD_EFFECT_CHOICE");
    }
    const picks = prompt.candidates.slice(0, 3);
    expect(picks.length).toBeGreaterThan(1);
    const { state: after } = mustApply(state, resolve(picks));
    for (const u of picks) expect(after.players.p1.hand).toContain(u);
  });

  it("Hyper Aroma offers ONLY Stage 1 Pokémon — a Basic and a Stage 2 are not offered", () => {
    const { state, before } = play(AROMA[0]);
    const prompt = parkOf(state);
    expect(sorted(prompt.candidates)).toEqual(sorted(deckUids(before, (id) => id === STAGE1)));
    expect(prompt.max).toBe(3);
    for (const near of [FILLER, STAGE2, EX]) {
      const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === near) as string;
      expect(prompt.candidates).not.toContain(uid);
      expectErr(state, resolve([uid]), "BAD_EFFECT_CHOICE");
    }
    const picks = prompt.candidates.slice(0, 3);
    expect(picks.length).toBeGreaterThan(1);
    const { events } = mustApply(state, resolve(picks));
    expect(find(events, "DECK_SEARCHED")?.uids).toEqual(picks);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §5 — Team Rocket's Transceiver: the Supporter head noun AND the fragment", () => {
  it("offers both Team Rocket SUPPORTERS (prefix and mid-name) and nothing else", () => {
    const { state, before } = play(TRANSCEIVER[0]);
    const prompt = parkOf(state);
    expect(sorted(prompt.candidates)).toEqual(
      sorted(deckUids(before, (id) => id === TR_SUPPORTER || id === TR_GRUNT)),
    );
    expect(prompt.max).toBe(1);
  });

  it("a Team Rocket's ITEM and a non-Team-Rocket Supporter are refused", () => {
    const { state } = play(TRANSCEIVER[0]);
    for (const near of [TR_ITEM, SUPPORTER]) {
      const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === near) as string;
      expect(uid, near).toBeDefined();
      expect(parkOf(state).candidates).not.toContain(uid);
      expectErr(state, resolve([uid]), "BAD_EFFECT_CHOICE");
    }
    expect(FIXTURE_POOL[TR_ITEM]?.name).toBe("Team Rocket's Transceiver");
    expect(programFor(TR_ITEM)).toBeUndefined();
  });

  it("the pick lands in hand, revealed — one card only", () => {
    const { state } = play(TRANSCEIVER[0]);
    expectErr(
      state,
      resolve([...pickOf(state, TR_SUPPORTER), ...pickOf(state, TR_GRUNT)]),
      "BAD_EFFECT_CHOICE",
    );
    const pick = pickOf(state, TR_GRUNT);
    const { state: after, events } = mustApply(state, resolve(pick));
    expect(after.players.p1.hand).toContain(pick[0]);
    expect(searchRow(after, events)).toBe(
      "searched their deck — revealed Grunt of Team Rocket and put it in hand",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §6 — Energy Search Pro: any number, one per type", () => {
  it("offers every Basic Energy (never the Special), one cap of 1 per type, and prompt.max is the BASIC COUNT (measured)", () => {
    const { state, before } = play(ESP[0]);
    const prompt = parkOf(state);
    const fire = deckUids(before, (id) => id === FIRE);
    const water = deckUids(before, (id) => id === WATER);
    expect(sorted(prompt.candidates)).toEqual(sorted([...fire, ...water]));
    expect(prompt.max).toBe(fire.length + water.length);
    expect(prompt.max).toBeGreaterThan(2);
    // One cell per TYPE the deck holds (the cells follow deck order), each capped at 1.
    expect(prompt.caps).toHaveLength(2);
    const capSets = (prompt.caps ?? []).map((c) => sorted(c.uids));
    expect(capSets).toContainEqual(sorted(fire));
    expect(capSets).toContainEqual(sorted(water));
    expect((prompt.caps ?? []).every((c) => c.max === 1)).toBe(true);
  });

  it("one Fire + one Water is legal; two Fire is BAD_EFFECT_CHOICE", () => {
    const { state } = play(ESP[0]);
    expectErr(state, resolve(pickOf(state, FIRE, 2)), "BAD_EFFECT_CHOICE");
    const picks = [...pickOf(state, FIRE), ...pickOf(state, WATER)];
    const { state: after, events } = mustApply(state, resolve(picks));
    for (const u of picks) expect(after.players.p1.hand).toContain(u);
    expect(find(events, "DECK_SEARCHED")?.reveal).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §7 — Precious Trolley: any number of Basics, clamped to the Bench", () => {
  it("offers every Basic Pokémon and clamps max to the empty Bench's 5", () => {
    const { state, before } = play(TROLLEY[0]);
    const prompt = parkOf(state);
    expect(sorted(prompt.candidates)).toEqual(sorted(deckUids(before, isBasic)));
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(5);
  });

  it("with 3 benched, max is the 2 spaces left; the picks enter the Bench and the row names no reveal", () => {
    const prep = (s: GameState) =>
      benchFromDeck(benchFromDeck(benchFromDeck(s, "p1", FILLER), "p1", FILLER), "p1", FILLER);
    const { state } = play(TROLLEY[0], prep);
    expect(parkOf(state).max).toBe(2);
    expectErr(
      state,
      resolve([...pickOf(state, FILLER, 2), ...pickOf(state, EX)]),
      "BAD_EFFECT_CHOICE",
    );
    const picks = [...pickOf(state, EX), ...pickOf(state, V)];
    const { state: after, events } = mustApply(state, resolve(picks));
    expect(after.players.p1.bench).toHaveLength(5);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.dest).toBe("bench");
    expect(searched !== undefined && "reveal" in searched).toBe(false);
  });

  it("on a FULL Bench it is still PLAYABLE, parks nothing, and the shuffle runs (Nest Ball doctrine)", () => {
    const prep = (s: GameState) => {
      let out = s;
      for (let i = 0; i < 5; i++) out = benchFromDeck(out, "p1", FILLER);
      return out;
    };
    const { state, events, uid } = play(TROLLEY[0], prep);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(types(events)).toEqual(["TRAINER_PLAYED", "SHUFFLE"]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.bench).toHaveLength(5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §8 — Boxed Order: the first trainerEndsTurn program that PARKS", () => {
  it("parks with endsTurn carried on the phase, offering Items only (never a Tool)", () => {
    const { state, before } = play(BOXED[0]);
    expect(state.phase.kind === "effect:choose" && state.phase.endsTurn).toBe(true);
    const prompt = parkOf(state);
    const items = deckUids(before, (id) => POOL[id]?.trainerType === "Item");
    expect(sorted(prompt.candidates)).toEqual(sorted(items));
    const tool = state.players.p1.deck.find((u) => state.cardIdByUid[u] === TOOL) as string;
    expect(prompt.candidates).not.toContain(tool);
    expect(prompt.max).toBe(2);
  });

  it("an ANSWER lands the Items in hand and then the turn ENDS", () => {
    const { state } = play(BOXED[0]);
    const picks = [...pickOf(state, ITEM), ...pickOf(state, TR_ITEM)];
    const { state: after, events } = mustApply(state, resolve(picks));
    for (const u of picks) expect(after.players.p1.hand).toContain(u);
    expect(find(events, "DECK_SEARCHED")?.reveal).toBe(true);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(find(events, "TURN_STARTED")?.seat).toBe("p2");
    const order = types(events);
    expect(order.indexOf("SHUFFLE")).toBeLessThan(order.indexOf("TURN_STARTED"));
  });

  it("a DECLINE (0 picks) still ends the turn", () => {
    const { state } = play(BOXED[0]);
    const { state: after, events } = mustApply(state, resolve([]));
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(find(events, "SHUFFLE")?.seat).toBe("p1");
  });

  it("a deck with NO Item never parks — and the turn still ends", () => {
    const prep = (s: GameState) => stripDeck(s, (id) => POOL[id]?.trainerType === "Item");
    const { state, events } = play(BOXED[0], prep);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(find(events, "DECK_SEARCHED")).toBeUndefined();
    expect(find(events, "EFFECT_PENDING")).toBeUndefined();
    expect(find(events, "TURN_STARTED")?.seat).toBe("p2");
  });

  it("a SERIALIZED park round-trips with endsTurn, and the resumed answer still ends the turn", () => {
    const { state } = play(BOXED[0]);
    const wire = JSON.parse(JSON.stringify(state)) as GameState;
    expect(wire).toEqual(state);
    expect(wire.phase.kind === "effect:choose" && wire.phase.endsTurn).toBe(true);
    const { state: after } = mustApply(wire, resolve(pickOf(wire, ITEM)));
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    // …and the flag is what does it: the same park without it returns to p1.
    if (wire.phase.kind !== "effect:choose") throw new Error("expected a park");
    const { endsTurn: _dropped, ...rest } = wire.phase;
    const stripped = { ...wire, phase: rest } as GameState;
    expect(mustApply(stripped, resolve([])).state.phase).toEqual({
      kind: "turn:action",
      seat: "p1",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §9 — Cassiopeia: only as the last card in hand, and the row stays a count", () => {
  it("a hand of EXACTLY 1 (Cassiopeia itself) plays and parks on up to 2 of ANY card", () => {
    const { state, before } = play(CASSIOPEIA[0], prepFor("Cassiopeia"));
    expect(before.players.p1.hand).toHaveLength(1);
    const prompt = parkOf(state);
    expect(prompt.max).toBe(2);
    expect(sorted(prompt.candidates)).toEqual(sorted(before.players.p1.deck));
  });

  it("a hand of 2 is refused PLAY_CONDITION_NOT_MET with the singular pill, and costs nothing", () => {
    const held = holding(board(), CASSIOPEIA[0]);
    const other = held.state.players.p1.hand.find((u) => u !== held.uid) as string;
    const two = handOnly(held.state, [held.uid, other]);
    const result = applyAction(two, { type: "playTrainer", seat: "p1", uid: held.uid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    expect(result.error.message).toBe(
      "Cassiopeia can only be used if you have exactly 1 card in your hand",
    );
    expect(two.players.p1.hand).toContain(held.uid);
    expect(two.allowances.supporterPlayed).toBe(false);
  });

  it("DECK_SEARCHED carries the picks but NO reveal, and the log row is a COUNT with no names", () => {
    const { state } = play(CASSIOPEIA[0], prepFor("Cassiopeia"));
    const picks = [...pickOf(state, EX), ...pickOf(state, SPECIAL)];
    const { state: after, events } = mustApply(state, resolve(picks));
    expect(after.players.p1.hand).toEqual(picks);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched).toEqual({ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: picks });
    const row = searchRow(after, events);
    expect(row).toBe("searched their deck — put 2 cards in hand");
    expect(row).not.toContain("D554 Beast ex");
    expect(find(events, "SHUFFLE")?.seat).toBe("p1");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D554 §10 — the Supporter-per-turn and the Item paths, as today", () => {
  it("a second Supporter the same turn is refused (Hilda, then Cyrano)", () => {
    const { state } = play(HILDA[0]);
    const done = mustApply(state, resolve([])).state;
    const held = holding(done, CYRANO[0]);
    expectErr(
      held.state,
      { type: "playTrainer", seat: "p1", uid: held.uid },
      "SUPPORTER_ALREADY_PLAYED",
    );
  });

  it("the Supporter lock is checked BEFORE Cassiopeia's gate (after a Supporter, even a 1-card hand is refused for §7.2)", () => {
    const { state } = play(COLRESS[0]);
    const done = mustApply(state, resolve([])).state;
    const held = holding(done, CASSIOPEIA[0]);
    expectErr(
      handOnly(held.state, [held.uid]),
      { type: "playTrainer", seat: "p1", uid: held.uid },
      "SUPPORTER_ALREADY_PLAYED",
    );
  });

  it("Items stack in one turn: Hyper Aroma, then the Transceiver, then Energy Search Pro", () => {
    let state = board();
    for (const id of [AROMA[0], TRANSCEIVER[0], ESP[0]]) {
      const held = holding(state, id);
      const parked = mustApply(held.state, {
        type: "playTrainer",
        seat: "p1",
        uid: held.uid,
      }).state;
      state = mustApply(parked, resolve([])).state;
      expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    }
    expect(state.allowances.supporterPlayed).toBe(false);
  });
});
