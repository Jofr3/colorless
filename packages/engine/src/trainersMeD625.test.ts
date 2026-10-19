import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  setPrizes,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D625 — T1: THE REST OF THE `me` TRAINERS ──
//
// 13 `me` printings / 7 printed texts on seven NEW objects (registry.ts D625 block): Special Red Card
// (`handRefresh` opponent, behind `opponentPrizesRemaining`), Jumbo Ice Cream (`heal` behind
// `yourActiveEnergyAtLeast 3`), Dark Bell (two `conditionGate`s with an empty `then`), Wally's
// Compassion (`healChosen.energyToHandFromHealed`), Blowtorch (the NEW `chooseOneOffered`), Great
// Haul Net (two deck retrievals, one shuffle) and Strange Timepiece (`devolveChosen` on the own side).
// Texts measured on the LOCAL D1, 2026-10-09, `legal_standard = 1` on every row; driven on the real
// ids in a LOCAL `cardPool` (D275). Readings R-SRC1, R-JIC1, R-DB1, R-WC1, R-BT1, R-GHN1, R-ST1 (all
// ⚠️ UNRULED).

const RED_CARD = "me04-082";
const ICE_CREAM = "me02-091";
const DARK_BELL = "me05-075";
const WALLY = "me01-132";
const BLOWTORCH = "me02-086";
const HAUL_NET = "me04-078";
const TIMEPIECE = "me01-128";

/** [me ids, card name, trainer type, printed text] — LOCAL D1 `cards.effect`, byte for byte. */
const TEXTS: readonly (readonly [readonly string[], string, string, string])[] = [
  [
    [RED_CARD, "me04-113"],
    "Special Red Card",
    "Item",
    "You can use this card only if your opponent has 3 or fewer Prize cards remaining.\n\nYour opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards.",
  ],
  [
    [ICE_CREAM, "me04-109"],
    "Jumbo Ice Cream",
    "Item",
    "Heal 80 damage from your Active Pokémon that has 3 or more Energy attached.",
  ],
  [[DARK_BELL, "me05-106"], "Dark Bell", "Item", "Both Active non-{D} Pokémon are now Confused."],
  [
    [WALLY, "me01-176", "me01-186"],
    "Wally's Compassion",
    "Supporter",
    "Heal all damage from 1 of your Mega Evolution Pokémon ex. If you healed any damage in this way, put all Energy attached to that Pokémon into your hand.",
  ],
  [
    [BLOWTORCH, "me02-117"],
    "Blowtorch",
    "Item",
    "You can use this card only if you discard a Basic {R} Energy card from your hand.\n\nDiscard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium in play.",
  ],
  [
    [HAUL_NET],
    "Great Haul Net",
    "Item",
    "Choose 1 or both:\n• Shuffle up to 3 {W} Pokémon from your discard pile into your deck.\n• Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.",
  ],
  [
    [TIMEPIECE],
    "Strange Timepiece",
    "Item",
    "Devolve 1 of your evolved {P} Pokémon by putting any number of Evolution cards on it into your hand. (That Pokémon can't evolve this turn.)",
  ],
];

const ME_IDS = TEXTS.flatMap(([ids]) => ids);

describe("D625 §1 — the faces: 13 `me` printings / 7 texts, one object per text", () => {
  it("7 texts / 13 printings, every printing of a text on ONE object, distinct across texts", () => {
    expect(ME_IDS).toHaveLength(13);
    expect(new Set(ME_IDS).size).toBe(13);
    const objects = new Set<unknown>();
    for (const [ids] of TEXTS) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      objects.add(program);
    }
    expect(objects.size).toBe(7);
  });

  it("the programs, field for field", () => {
    expect(programFor(RED_CARD)).toEqual({
      trainer: [
        { op: "handRefresh", who: "opponent", toBottom: true, draw: { kind: "fixed", count: 3 }, onlyIfAnyMoved: true },
      ],
      trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
    });
    expect(programFor(ICE_CREAM)).toEqual({
      trainer: [{ op: "heal", target: "self", amount: 80 }],
      trainerPlayableIf: { kind: "yourActiveEnergyAtLeast", count: 3 },
    });
    expect(programFor(DARK_BELL)).toEqual({
      trainer: [
        {
          op: "conditionGate",
          cond: { kind: "opponentActiveHasType", type: "Darkness" },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [],
          otherwise: [{ op: "applyStatus", target: "defender", status: "confused" }],
        },
        {
          op: "conditionGate",
          cond: { kind: "yourActiveHasType", type: "Darkness" },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [],
          otherwise: [{ op: "applyStatus", target: "self", status: "confused" }],
        },
      ],
    });
    expect(programFor(WALLY)).toEqual({
      trainer: [
        { op: "healChosen", amount: "all", filter: { kind: "megaEvolutionEx" }, energyToHandFromHealed: true },
      ],
    });
    expect(programFor(BLOWTORCH)?.trainer?.[0]).toEqual({
      op: "payFromHand",
      count: 1,
      to: "discard",
      filter: { kind: "basicEnergy", energyType: "Fire" },
    });
    expect(programFor(BLOWTORCH)?.trainer?.[1]).toMatchObject({
      op: "chooseOneOffered",
      branches: [
        { op: "discardTools", count: 1 },
        { op: "discardEnergy", from: "opponentChosen", filter: { kind: "specialEnergy" } },
        { op: "discardStadium" },
      ],
      labels: ["Discard a Pokémon Tool", "Discard a Special Energy", "Discard the Stadium"],
    });
    expect(programFor(HAUL_NET)).toEqual({
      trainer: [
        { op: "discardPileRetrieval", filter: { kind: "typedPokemon", pokemonType: "Water" }, dest: "deck", max: 3 },
        { op: "discardPileRetrieval", filter: { kind: "basicEnergy", energyType: "Water" }, dest: "deck", max: 3 },
        { op: "shuffleDeck" },
      ],
    });
    expect(programFor(TIMEPIECE)).toEqual({
      trainer: [{ op: "devolveChosen", whose: "self", pokemonType: "Psychic", depth: "any" }],
    });
  });
});

// ── ON A BOARD ──

const PLAIN = "d625-plain"; // a Basic {C}
const DARK = "d625-dark"; // a Basic {D}
const DUAL = "d625-dual"; // a Basic {D}{P}
const MEGA = "d625-mega"; // "Mega D625 ex", a Mega Evolution Pokémon ex (a Basic for the board)
const PLAIN_EX = "d625-ex"; // "D625 Brute ex", not a Mega
const PSY = "d625-psy"; // a Basic {P}
const PSY_S1 = "d625-psy-s1"; // a Stage 1 {P} from PSY
const PSY_S2 = "d625-psy-s2"; // a Stage 2 {P} from PSY_S1
const GRASS_S1 = "d625-grass-s1"; // a Stage 1 {G} from PLAIN
const WATER_MON = "d625-water"; // a Basic {W}
const SPECIAL = "d625-special"; // a plain Special Energy
const FILLER = "d625-filler";

const body = (id: string, name: string, types: string[], extra: Partial<Card> = {}): Card =>
  battler(id, { name, hp: 300, types, attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }], ...extra });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    TEXTS.flatMap(([ids, name, type, text]) => ids.map((id) => [id, { ...trainerCard(id, type, text), name }])),
  ),
  [PLAIN]: body(PLAIN, "D625 Plain", ["Colorless"]),
  [DARK]: body(DARK, "D625 Dark", ["Darkness"]),
  [DUAL]: body(DUAL, "D625 Dual", ["Darkness", "Psychic"]),
  [MEGA]: body(MEGA, "Mega D625 ex", ["Colorless"]),
  [PLAIN_EX]: body(PLAIN_EX, "D625 Brute ex", ["Colorless"]),
  [PSY]: body(PSY, "D625 Psy", ["Psychic"], { hp: 70 }),
  [PSY_S1]: body(PSY_S1, "D625 Psy Two", ["Psychic"], { stage: "Stage1", evolveFrom: "D625 Psy", hp: 100 }),
  [PSY_S2]: body(PSY_S2, "D625 Psy Three", ["Psychic"], { stage: "Stage2", evolveFrom: "D625 Psy Two", hp: 160 }),
  [GRASS_S1]: body(GRASS_S1, "D625 Grass Two", ["Grass"], { stage: "Stage1", evolveFrom: "D625 Plain" }),
  [WATER_MON]: body(WATER_MON, "D625 Water", ["Water"]),
  [SPECIAL]: specialEnergy(SPECIAL, "D625 Special Energy", "This card provides {C} Energy."),
  [FILLER]: battler(FILLER, { name: "D625 Filler", hp: 300 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [RED_CARD]: 1,
  [ICE_CREAM]: 1,
  [DARK_BELL]: 1,
  [WALLY]: 1,
  [BLOWTORCH]: 1,
  [HAUL_NET]: 1,
  [TIMEPIECE]: 1,
  [PLAIN]: 4,
  [DARK]: 2,
  [DUAL]: 1,
  [MEGA]: 2,
  [PLAIN_EX]: 1,
  [PSY]: 3,
  [PSY_S1]: 3,
  [PSY_S2]: 2,
  [GRASS_S1]: 1,
  [WATER_MON]: 4,
  [SPECIAL]: 2,
  [FILLER]: 3,
  "fix-tool": 2,
  "fix-stadium": 1,
  "fix-water-energy": 4,
  "fix-fire-energy": 4,
  "fix-energy": 14,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Hands and prize rows reset: every hand back into the deck, six `fix-energy` the prize row. */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => next.cardIdByUid[u] === "fix-energy").slice(0, 6);
    next = {
      ...next,
      players: { ...next.players, [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) } },
    };
  }
  return next;
}

/** Setup, P2 first, then P1's SECOND turn (turn 4), hands reset. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6255, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(reset(state), { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 4) throw new Error(`expected turn 4, got ${state.turn}`);
  return reset(state);
}

/** P1: `active` Active and exactly `bench` benched; P2: `foe` Active and a Filler benched. */
function board(active: string, bench: readonly string[] = [], foe: string = PLAIN): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", foe), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

/** Put `id` from `seat`'s deck on top of the Active's stack (a test evolution, `turnPlayed` kept). */
function stackOnActive(state: GameState, seat: "p1" | "p2", id: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id) as string;
  const active = side.active;
  if (active === null || uid === undefined) throw new Error("no Active or no card");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), active: { ...active, stack: [...active.stack, uid] } },
    },
  };
}

function stackOnBench(state: GameState, index: number, id: string): GameState {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id) as string;
  const target = side.bench[index];
  if (target === undefined || uid === undefined) throw new Error("no benched body or no card");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((b, i) => (i === index ? { ...b, stack: [...b.stack, uid] } : b)),
      },
    },
  };
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
function staged(state: GameState, id: string): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  return { state: next, uid: next.players.p1.hand.find((u) => next.cardIdByUid[u] === id) as string };
}
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const { state: next, uid } = staged(state, id);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid });
}
function refusal(state: GameState, id: string): string {
  const { state: next, uid } = staged(state, id);
  const result = applyAction(next, { type: "playTrainer", seat: "p1", uid });
  return result.ok ? "applied" : result.error.code;
}
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const bench = (index: number) => ({ seat: "p1", spot: { spot: "bench", index } }) as const;
const pickRef = (ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } }) as GameAction;
const pickCards = (uids: readonly string[]): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } }) as GameAction;
const confirm = (yes: boolean): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } }) as GameAction;
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const withStadium = (state: GameState, owner: "p1" | "p2"): GameState => {
  const side = state.players[owner];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === "fix-stadium") as string;
  return {
    ...state,
    players: { ...state.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    stadium: { uid, owner },
  };
};

describe("D625 §2 — Special Red Card: the opponent's hand under their deck, then 3 (R-SRC1)", () => {
  it("is refused while the opponent has 4 or more Prize cards remaining", () => {
    expect(refusal(setPrizes(board(PLAIN), "p2", 4), RED_CARD)).toBe("PLAY_CONDITION_NOT_MET");
  });

  it("at 3 remaining: the hand goes under the deck in some order, the deck's own order intact, and they draw 3", () => {
    const start = handFromDeck(setPrizes(board(PLAIN), "p2", 3), "p2", "fix-energy", 0);
    const withHand = handFromDeck(handFromDeck(start, "p2", FILLER, 2), "p2", PLAIN, 2);
    const hand = withHand.players.p2.hand;
    const deckBefore = withHand.players.p2.deck;
    const { state } = play(withHand, RED_CARD);
    const p2 = state.players.p2;
    expect(p2.hand).toEqual(deckBefore.slice(0, 3));
    expect(p2.deck.slice(0, deckBefore.length - 3)).toEqual(deckBefore.slice(3));
    expect([...p2.deck.slice(-4)].sort()).toEqual([...hand].sort());
    // Only the opponent's hand: the controller draws nothing.
    expect(state.players.p1.hand).toEqual([]);
  });

  it("R-SRC1: an empty opponent hand moves nothing and draws 0; the Item is still played", () => {
    const start = setPrizes(board(PLAIN), "p2", 2);
    expect(start.players.p2.hand).toEqual([]);
    const { state } = play(start, RED_CARD);
    expect(state.players.p2.hand).toEqual([]);
    expect(state.players.p2.deck).toEqual(start.players.p2.deck);
    expect(idsOf(state, state.players.p1.discard)).toContain(RED_CARD);
  });
});

describe("D625 §3 — Jumbo Ice Cream: heal 80 from an Active with 3 or more Energy (R-JIC1)", () => {
  it("is refused on an Active with 2 Energy", () => {
    expect(refusal(attachFromDeck(setDamage(board(PLAIN), "p1", 100), "p1", "fix-energy", 2), ICE_CREAM)).toBe(
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("heals 80 from the Active at 3 Energy, and not from a damaged Benched body", () => {
    let start = attachFromDeck(setDamage(board(PLAIN, [DARK]), "p1", 100), "p1", "fix-energy", 3);
    start = setBenchDamage(start, "p1", 0, 50);
    const { state } = play(start, ICE_CREAM);
    expect(state.players.p1.active?.damage).toBe(20);
    expect(state.players.p1.bench[0]?.damage).toBe(50);
  });

  it("R-JIC1: an undamaged Active with 3 Energy may take it and heals 0", () => {
    const { state } = play(attachFromDeck(board(PLAIN), "p1", "fix-energy", 3), ICE_CREAM);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(idsOf(state, state.players.p1.discard)).toContain(ICE_CREAM);
  });
});

describe("D625 §4 — Dark Bell: both Active non-{D} Pokémon are now Confused (R-DB1)", () => {
  it("both non-{D}: both Actives are Confused, the controller's own included", () => {
    const { state } = play(board(PLAIN, [], PLAIN), DARK_BELL);
    expect(state.players.p1.active?.conditions.rotation).toBe("confused");
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("a {D} Active is spared on either side", () => {
    const foeDark = play(board(PLAIN, [], DARK), DARK_BELL).state;
    expect(foeDark.players.p2.active?.conditions.rotation).toBe("none");
    expect(foeDark.players.p1.active?.conditions.rotation).toBe("confused");
    const ownDark = play(board(DARK, [], PLAIN), DARK_BELL).state;
    expect(ownDark.players.p1.active?.conditions.rotation).toBe("none");
    expect(ownDark.players.p2.active?.conditions.rotation).toBe("confused");
  });

  it("R-DB1: a dual-type {D}{P} body is spared; with both Actives {D} the Item is still played and does nothing", () => {
    const { state } = play(board(DUAL, [], DARK), DARK_BELL);
    expect(state.players.p1.active?.conditions.rotation).toBe("none");
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    expect(idsOf(state, state.players.p1.discard)).toContain(DARK_BELL);
  });
});

describe("D625 §5 — Wally's Compassion: heal all from a Mega ex; if it healed, its Energy to hand (R-WC1)", () => {
  it("is refused with no Mega Evolution Pokémon ex in play (a plain ex is not one)", () => {
    expect(refusal(board(PLAIN_EX, [PLAIN]), WALLY)).toBe("NO_LEGAL_TARGET");
  });

  it("a damaged Mega ex Active: all damage healed, every Energy (Special included) into the hand", () => {
    let start = setDamage(board(MEGA, [PLAIN]), "p1", 120);
    start = attachFromDeck(attachFromDeck(start, "p1", "fix-fire-energy", 2), "p1", SPECIAL, 1);
    const energy = start.players.p1.active?.energy ?? [];
    const { state } = play(start, WALLY);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.active?.energy).toEqual([]);
    expect([...state.players.p1.hand].filter((u) => energy.includes(u)).sort()).toEqual([...energy].sort());
  });

  it("R-WC1: an undamaged Mega ex is healed of nothing and keeps its Energy", () => {
    const start = attachFromDeck(board(MEGA), "p1", "fix-fire-energy", 2);
    const { state } = play(start, WALLY);
    expect(state.players.p1.active?.energy).toEqual(start.players.p1.active?.energy);
  });

  it("two Mega ex park the pick (the prompt names the rider); the picked damaged one's Energy moves, the other keeps its own", () => {
    let start = setBenchDamage(setDamage(board(MEGA, [MEGA]), "p1", 30), "p1", 0, 60);
    start = attachBenchFromDeck(attachFromDeck(start, "p1", "fix-energy", 1), "p1", 0, "fix-fire-energy", 2);
    const parked = play(start, WALLY).state;
    expect(prompt(parked)).toMatchObject({ kind: "choosePokemon" });
    expect(String((prompt(parked) as { note?: string }).note)).toContain("all its Energy goes into your hand");
    const done = must(applyAction(revived(parked), pickRef(bench(0))));
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[0]?.energy).toEqual([]);
    expect(done.players.p1.active?.damage).toBe(30);
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("D625 §6 — Blowtorch: a Basic {R} paid, then 1 of the targeted branches (R-BT1)", () => {
  it("is refused without a Basic {R} Energy in hand (a Basic {W} does not pay)", () => {
    expect(refusal(withStadium(handFromDeck(board(PLAIN), "p1", "fix-water-energy", 1), "p2"), BLOWTORCH)).toBe(
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("is refused when no branch has a target (no opposing Tool or Special Energy, no Stadium)", () => {
    expect(refusal(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 1), BLOWTORCH)).toBe("NO_LEGAL_TARGET");
  });

  it("one offered branch runs as forced: the Stadium in play (the controller's own counts) is discarded", () => {
    const start = withStadium(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 1), "p1");
    const { state } = play(start, BLOWTORCH);
    expect(state.stadium).toBeNull();
    expect(idsOf(state, state.players.p1.discard)).toEqual(expect.arrayContaining(["fix-fire-energy", "fix-stadium"]));
  });

  it("the Basic {R} payment is fungible, so two in hand pay one without a question (no park before the branches)", () => {
    const start = withStadium(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 2), "p2");
    const { state } = play(start, BLOWTORCH);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(idsOf(state, state.players.p1.hand)).toEqual(["fix-fire-energy"]);
    expect(state.stadium).toBeNull();
  });

  it("all three offered: the labelled chain asks Tool vs the rest, then Special Energy vs the Stadium", () => {
    let start = withStadium(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 1), "p2");
    start = attachToolFromDeck(start, "p2", "active", "fix-tool");
    start = attachBenchFromDeck(start, "p2", 0, SPECIAL, 1);
    const first = play(start, BLOWTORCH).state;
    expect(prompt(first)).toMatchObject({
      kind: "confirm",
      labels: { yes: "Discard a Pokémon Tool", no: "Discard a Special Energy or Discard the Stadium" },
    });
    const second = must(applyAction(revived(first), confirm(false)));
    expect(prompt(second)).toMatchObject({
      kind: "confirm",
      labels: { yes: "Discard a Special Energy", no: "Discard the Stadium" },
    });
    const done = must(applyAction(second, confirm(true)));
    expect(done.players.p2.bench[0]?.energy).toEqual([]);
    expect(done.stadium).not.toBeNull();
    expect(done.players.p2.active?.tools).toHaveLength(1);
  });

  it("a branch with no target is not offered: Tool and Stadium only, one question", () => {
    let start = withStadium(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 1), "p2");
    start = attachToolFromDeck(start, "p2", "active", "fix-tool");
    const first = play(start, BLOWTORCH).state;
    expect(prompt(first)).toMatchObject({ labels: { yes: "Discard a Pokémon Tool", no: "Discard the Stadium" } });
    const done = must(applyAction(first, confirm(false)));
    expect(done.stadium).toBeNull();
    expect(done.players.p2.active?.tools).toHaveLength(1);
  });

  it("the Tool branch is D543's declinable pick, so it CAN resolve to 0 (a named deviation from the mandatory print)", () => {
    const start = attachToolFromDeck(handFromDeck(board(PLAIN), "p1", "fix-fire-energy", 1), "p2", "active", "fix-tool");
    const parked = play(start, BLOWTORCH).state;
    expect(prompt(parked)).toMatchObject({ kind: "discardTools" });
    const done = must(
      applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "discardTools", uids: [] } } as GameAction),
    );
    expect(done.players.p2.active?.tools).toHaveLength(1);
    expect(idsOf(done, done.players.p1.discard)).toContain("fix-fire-energy");
  });
});

describe("D625 §7 — Great Haul Net: up to 3 {W} Pokémon and up to 3 Basic {W} Energy, then ONE shuffle (R-GHN1)", () => {
  it("both bullets answered in order, one SHUFFLE", () => {
    let start = discardFromDeck(board(PLAIN), "p1", WATER_MON, 2);
    start = discardFromDeck(discardFromDeck(start, "p1", "fix-water-energy", 2), "p1", DARK, 1);
    const pile = start.players.p1.discard;
    const mons = pile.filter((u) => start.cardIdByUid[u] === WATER_MON);
    const energy = pile.filter((u) => start.cardIdByUid[u] === "fix-water-energy");
    const first = play(start, HAUL_NET);
    expect(prompt(first.state)).toMatchObject({ kind: "chooseCards", min: 0, max: 3 });
    const second = mustApply(first.state, pickCards(mons));
    expect(prompt(second.state)).toMatchObject({ kind: "chooseCards", min: 0, max: 3 });
    const done = mustApply(second.state, pickCards(energy.slice(0, 1)));
    expect(idsOf(done.state, done.state.players.p1.discard).sort()).toEqual([DARK, "fix-water-energy", HAUL_NET].sort());
    expect(all([...first.events, ...second.events, ...done.events], "SHUFFLE")).toHaveLength(1);
  });

  it("R-GHN1: choosing only the second bullet is answering 0 on the first", () => {
    const start = discardFromDeck(discardFromDeck(board(PLAIN), "p1", WATER_MON, 1), "p1", "fix-water-energy", 1);
    const first = play(start, HAUL_NET).state;
    const second = must(applyAction(first, pickCards([])));
    const energy = second.players.p1.discard.filter((u) => second.cardIdByUid[u] === "fix-water-energy");
    const done = must(applyAction(second, pickCards(energy)));
    expect(idsOf(done, done.players.p1.discard).sort()).toEqual([HAUL_NET, WATER_MON].sort());
  });

  it("R-GHN1: an empty discard pile still plays it (Pal Pad's precedent) — it only shuffles", () => {
    const { state, events } = play(board(PLAIN), HAUL_NET);
    expect(idsOf(state, state.players.p1.discard)).toEqual([HAUL_NET]);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
  });
});

describe("D625 §8 — Strange Timepiece: devolve your evolved {P} Pokémon; it can't evolve this turn (R-ST1)", () => {
  it("is refused with no evolved {P} body (a {P} Basic and an evolved {G} body are not offered)", () => {
    const start = stackOnBench(board(PSY, [PLAIN]), 0, GRASS_S1);
    expect(refusal(start, TIMEPIECE)).toBe("NO_LEGAL_TARGET");
  });

  it("a Stage 1 {P} Active: forced; the Stage 1 goes to the hand and can't evolve it again this turn", () => {
    const start = stackOnActive(board(PSY), "p1", PSY_S1);
    const s1 = start.players.p1.active?.stack[1] as string;
    const { state, events } = play(start, TIMEPIECE);
    expect(state.players.p1.active?.stack).toHaveLength(1);
    expect(state.players.p1.hand).toContain(s1);
    expect(state.players.p1.active?.turnPlayed).toBe(state.turn);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    const again = applyAction(state, { type: "evolve", seat: "p1", uid: s1, target: { spot: "active" } });
    expect(again.ok ? "applied" : again.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("the control: the same un-devolved Basic evolves on this turn", () => {
    const start = handFromDeck(board(PSY), "p1", PSY_S1, 1);
    const uid = start.players.p1.hand[0] as string;
    expect(applyAction(start, { type: "evolve", seat: "p1", uid, target: { spot: "active" } }).ok).toBe(true);
  });

  it("a Stage 2: the depth question (1 or 2); 2 puts both Evolution cards into the hand", () => {
    const start = stackOnActive(stackOnActive(board(PSY), "p1", PSY_S1), "p1", PSY_S2);
    const [, s1, s2] = start.players.p1.active?.stack ?? [];
    const parked = play(start, TIMEPIECE).state;
    expect(prompt(parked)).toMatchObject({
      kind: "confirm",
      labels: { yes: "1 Evolution card", no: "2 Evolution cards" },
    });
    const done = must(applyAction(revived(parked), confirm(false)));
    expect(done.players.p1.active?.stack).toHaveLength(1);
    expect(done.players.p1.hand).toEqual(expect.arrayContaining([s1, s2]));
    expect(done.players.p1.active?.turnPlayed).toBe(done.turn);
  });

  it("a Stage 2 answering 1: only the Stage 2 goes, the body is a Stage 1 that can't evolve this turn", () => {
    const start = stackOnActive(stackOnActive(board(PSY), "p1", PSY_S1), "p1", PSY_S2);
    const s2 = start.players.p1.active?.stack[2] as string;
    const done = must(applyAction(play(start, TIMEPIECE).state, confirm(true)));
    expect(done.players.p1.active?.stack).toHaveLength(2);
    const again = applyAction(done, { type: "evolve", seat: "p1", uid: s2, target: { spot: "active" } });
    expect(again.ok ? "applied" : again.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("two evolved {P} bodies park the pick; the Benched one is devolved, the Active untouched", () => {
    const start = stackOnBench(stackOnActive(board(PSY, [PSY]), "p1", PSY_S1), 0, PSY_S1);
    const parked = play(start, TIMEPIECE).state;
    expect(prompt(parked)).toMatchObject({ kind: "choosePokemon" });
    const done = must(applyAction(revived(parked), pickRef(bench(0))));
    expect(done.players.p1.bench[0]?.stack).toHaveLength(1);
    expect(done.players.p1.bench[0]?.turnPlayed).toBe(done.turn);
    expect(done.players.p1.active?.stack).toHaveLength(2);
    expect(done.players.p1.active?.turnPlayed).toBe(0);
  });
});

describe("D625 §9 — the version", () => {
  it("is built at engine 0.554.0", () => {
    expect(engineVersion).toBe("0.554.0");
  });
});
