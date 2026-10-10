import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  handFromDeck,
  itemTrainer,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D624 — WP31c: THE REST OF THE `me` DECK / HAND / DISCARD / ENERGY MISC ────────────────────────────
//
// 5 attack sentences / 7 `me` printings newly reader-built (effects.ts arm 6e-sexies). Every id and text off
// the LOCAL D1, 2026-10-09, `legal_standard = 1`; every other text on the 7 cards was already built, so all 7
// are finished.
//
//   Tail Generator ×2  — `attachFromDiscard`, `max: "opponentEnergyInPlay"` (NEW value), {L} hosts.
//   Hand Trim          — `randomFromOpponentHand` `to: "discard"` with `untilHandSize` (NEW key).
//   Select a Snack ×2  — Explorer's Guidance's `lookAtTopN` (exact, the rest discarded), revealed (R-SAS1).
//   Send Flowers       — `attachFromDeck` `anyEnergy` onto 1 Benched {G} body, then the shuffle.
//   Chirp              — `searchDeck` over the NEW `CardFilter` member `pokemonWithResistance`, revealed.
//
// Dropped and named (§1): Elemental Blast, Pleasing Present and Skill Thief ×2.

const TAIL_GENERATOR =
  "Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.";
const HAND_TRIM = "Discard random cards from your opponent's hand until they have 5 cards in their hand.";
const SELECT_A_SNACK = "Discard the top 3 cards of your deck and put 1 of them into your hand.";
const SEND_FLOWERS =
  "Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.";
const CHIRP =
  "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [TAIL_GENERATOR, ["me03-029", "me03-093"]],
  [HAND_TRIM, ["me03-067"]],
  [SELECT_A_SNACK, ["30th-061", "30th-135"]],
  [SEND_FLOWERS, ["me03-003"]],
  [CHIRP, ["me03-066"]],
];

/** Dropped and named: [text, ids, the vocabulary it needs beyond this brief]. */
const DROPPED: readonly (readonly [string, readonly string[], string])[] = [
  [
    "Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.",
    ["30th-121"],
    "a matched multi-type discard: three sequential typed discards let a wildcard Energy fill one slot and dodge another",
  ],
  [
    "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.",
    ["me04-018"],
    "an attach park answered by the opponent, then the controller",
  ],
  [
    "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.",
    ["me05-054", "me05-092"],
    "a copy source over the opponent's whole board plus a hand gate",
  ],
];

describe("D624 §1 — the texts", () => {
  it("5 sentences / 7 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(7);
  });

  it("the dropped texts stay unbuilt: 3 texts / 4 printings, named", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, ids] of DROPPED) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(resolvedByAnyReader(text), text).toBe(false);
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(DROPPED.flatMap(([, ids]) => ids)).toHaveLength(4);
  });
});

describe("D624 §2 — the readings", () => {
  it("Tail Generator: the discard attach at the opponent's Energy count, typed on both ends", () => {
    expect(deriveAttackEffect(TAIL_GENERATOR)).toEqual([
      {
        op: "attachFromDiscard",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: "opponentEnergyInPlay",
        targetType: "Lightning",
      },
    ]);
    expect(deriveAttackEffect(TAIL_GENERATOR.replace("Basic {L}", "Basic {R}"))?.[0]).toMatchObject({
      filter: { kind: "basicEnergy", energyType: "Fire" },
      targetType: "Lightning",
    });
    expect(deriveAttackEffect(TAIL_GENERATOR.replace("your {L} Pokémon", "your {W} Pokémon"))?.[0]).toMatchObject({
      filter: { kind: "basicEnergy", energyType: "Lightning" },
      targetType: "Water",
    });
    expect(deriveAttackEffect(TAIL_GENERATOR.replace("Basic {L}", "Basic {X}"))).toBeNull();
    expect(deriveAttackEffect(TAIL_GENERATOR.replace("your {L} Pokémon", "your {X} Pokémon"))).toBeNull();
    expect(deriveAttackEffect(TAIL_GENERATOR.replace("opponent's", "opponent’s"))).toHaveLength(1);
    expect(deriveAttackEffect(`${TAIL_GENERATOR} Draw a card.`)).toBeNull();
  });

  it("Hand Trim: the random discard down to the printed hand size", () => {
    expect(deriveAttackEffect(HAND_TRIM)).toEqual([{ op: "randomFromOpponentHand", to: "discard", untilHandSize: 5 }]);
    expect(deriveAttackEffect(HAND_TRIM.replace("have 5", "have 3"))?.[0]).toMatchObject({ untilHandSize: 3 });
    expect(deriveAttackEffect(HAND_TRIM.replace("have 5", "have 0"))).toBeNull();
    expect(deriveAttackEffect(HAND_TRIM.replace("opponent's", "opponent’s"))).toHaveLength(1);
    expect(deriveAttackEffect(`${HAND_TRIM} Draw a card.`)).toBeNull();
    // The one-card sentence keeps its shipped reading.
    expect(deriveAttackEffect("Discard a random card from your opponent's hand.")).toEqual([
      { op: "randomFromOpponentHand", to: "discard" },
    ]);
  });

  it("Select a Snack: Explorer's Guidance's program over the top 3, the kept card revealed", () => {
    expect(deriveAttackEffect(SELECT_A_SNACK)).toEqual([
      { op: "lookAtTopN", n: 3, filter: { kind: "anyCard" }, max: 1, exact: true, reveal: true, restTo: "discard" },
    ]);
    expect(deriveAttackEffect(SELECT_A_SNACK.replace("top 3", "top 5"))?.[0]).toMatchObject({ n: 5 });
    expect(deriveAttackEffect(SELECT_A_SNACK.replace("top 3", "top 1"))).toBeNull();
    expect(deriveAttackEffect(SELECT_A_SNACK.replace("top 3", "top 11"))).toBeNull();
    expect(deriveAttackEffect(`${SELECT_A_SNACK} Draw a card.`)).toBeNull();
  });

  it("Send Flowers: any Energy card onto 1 Benched typed body, then the shuffle", () => {
    expect(deriveAttackEffect(SEND_FLOWERS)).toEqual([
      { op: "attachFromDeck", filter: { kind: "anyEnergy" }, max: 1, benchOnly: true, targetType: "Grass" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(SEND_FLOWERS.replace("{G}", "{W}"))?.[0]).toMatchObject({ targetType: "Water" });
    expect(deriveAttackEffect(SEND_FLOWERS.replace("{G}", "{X}"))).toBeNull();
    expect(deriveAttackEffect(`${SEND_FLOWERS} Draw a card.`)).toBeNull();
  });

  it("Chirp: a revealed hand search over the Resistance filter", () => {
    expect(deriveAttackEffect(CHIRP)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "pokemonWithResistance", type: "Fighting" },
        dest: "hand",
        max: 2,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(CHIRP.replace("{F}", "{R}"))?.[0]).toMatchObject({
      filter: { kind: "pokemonWithResistance", type: "Fire" },
    });
    expect(deriveAttackEffect(CHIRP.replace("{F}", "{X}"))).toBeNull();
    expect(deriveAttackEffect(CHIRP.replace("up to 2", "up to 0"))).toBeNull();
    expect(deriveAttackEffect(CHIRP.replace("up to 2", "up to 11"))).toBeNull();
    expect(deriveAttackEffect(`${CHIRP} Draw a card.`)).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d624-filler";
const BASIC = "d624-basic";
const LIGHT = "d624-lightning-mon";
const GRASS = "d624-grass-mon";
const RESIST_F = "d624-resist-fighting";
const RESIST_G = "d624-resist-grass";
const ITEM = "d624-item";
const SPECIAL = "d624-special";
const L = "d624-lightning";
const R = "d624-fire";
const G = "d624-grass";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 1, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const FIGHTING_RESISTANCE: Card["resistances"] = [{ type: "Fighting", value: "-30" }];

const LOCAL: Record<string, Card> = {
  "me03-029": mon("me03-029", "Dedenne", 70, "Lightning", [
    { cost: ["Lightning"], name: "Tail Generator", effect: TAIL_GENERATOR },
    {
      cost: ["Lightning", "Colorless"],
      name: "Thunder Shock",
      damage: 30,
      effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
    },
  ]),
  "me03-067": mon("me03-067", "Furfrou", 90, "Colorless", [
    { cost: ["Colorless"], name: "Hand Trim", effect: HAND_TRIM },
    { cost: ["Colorless"], name: "Headbutt", damage: 30 },
  ]),
  "30th-061": mon("30th-061", "Morpeko", 70, "Lightning", [
    { cost: ["Colorless"], name: "Select a Snack", effect: SELECT_A_SNACK },
    { cost: ["Lightning"], name: "Slap", damage: 30 },
  ]),
  "me03-003": mon("me03-003", "Shaymin", 70, "Grass", [
    { cost: ["Grass"], name: "Send Flowers", effect: SEND_FLOWERS },
    { cost: ["Grass"], name: "Leaf Step", damage: 30 },
  ]),
  "me03-066": mon(
    "me03-066",
    "Fletchling",
    60,
    "Colorless",
    [
      { cost: ["Colorless"], name: "Chirp", effect: CHIRP },
      { cost: ["Colorless", "Colorless"], name: "Peck", damage: 20 },
    ],
    { resistances: FIGHTING_RESISTANCE },
  ),
  [FILLER]: mon(FILLER, "D624 Filler", 400, "Colorless", TAP),
  [BASIC]: mon(BASIC, "D624 Basic", 60, "Colorless", TAP),
  [LIGHT]: mon(LIGHT, "D624 Lightning", 90, "Lightning", TAP),
  [GRASS]: mon(GRASS, "D624 Grass", 70, "Grass", TAP),
  [RESIST_F]: mon(RESIST_F, "D624 Resists Fighting", 80, "Colorless", TAP, { resistances: FIGHTING_RESISTANCE }),
  [RESIST_G]: mon(RESIST_G, "D624 Resists Grass", 80, "Colorless", TAP, {
    resistances: [{ type: "Grass", value: "-30" }],
  }),
  [ITEM]: itemTrainer(ITEM),
  [SPECIAL]: specialEnergy(SPECIAL, "D624 Special Energy"),
  [L]: typedEnergy(L, "Lightning"),
  [R]: typedEnergy(R, "Fire"),
  [G]: typedEnergy(G, "Grass"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me03-029": 1,
  "me03-067": 1,
  "30th-061": 1,
  "me03-003": 1,
  "me03-066": 1,
  [FILLER]: 11,
  [BASIC]: 4,
  [LIGHT]: 2,
  [GRASS]: 2,
  [RESIST_F]: 3,
  [RESIST_G]: 2,
  [ITEM]: 9,
  [SPECIAL]: 2,
  [L]: 8,
  [R]: 4,
  [G]: 4,
  "fix-energy": 4,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER && id !== ITEM), "fix-energy"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6242, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a Filler / Item deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` and `ownBench`; P2's Active is `defender` with `bench`. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  bench: readonly string[] = [],
  ownBench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const sorted = (xs: readonly (string | undefined)[]) => [...xs].sort();
const resolve = (state: GameState, choice: unknown) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice } as GameAction);

function promptOf<K extends string>(state: GameState, kind: K) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== kind) {
    throw new Error(`expected a ${kind} park, got ${state.phase.kind}`);
  }
  return state.phase.prompt as Extract<typeof state.phase.prompt, { kind: K }>;
}
const spotOf = (ref: { seat: Seat; spot: { spot: string; index?: number } }) =>
  `${ref.seat}:${ref.spot.spot}${ref.spot.index === undefined ? "" : ref.spot.index}`;

describe("D624 §3 — Tail Generator: Basic {L} Energy from the discard pile, up to the opponent's Energy count", () => {
  function board(): GameState {
    let state = table("me03-029", [[L, 1]], FILLER, [BASIC], [LIGHT, FILLER]);
    state = attachFromDeck(state, "p2", "fix-energy", 2);
    state = attachBenchFromDeck(state, "p2", 0, SPECIAL, 1);
    state = discardFromDeck(discardFromDeck(state, "p1", L, 4), "p1", R, 1);
    return state;
  }

  it("3 Energy on the opponent's board (2 on the Active, 1 Special on the Bench): up to 3, onto {L} bodies only", () => {
    const parked = mustApply(board(), attack(0)).state;
    const prompt = promptOf(parked, "attachCards");
    expect(prompt.max).toBe(3);
    expect(sorted(ids(parked, prompt.candidates))).toEqual([L, L, L]);
    expect(prompt.targets.map(spotOf)).toEqual(["p1:active", "p1:bench0"]);
    expect(prompt.note).toBe(
      "Choose up to 3 Basic Lightning Energy cards from your discard pile (the amount of Energy attached to all of your opponent's Pokémon) and attach them to your Lightning Pokémon in any way you like.",
    );
    const [a, b, c] = prompt.candidates;
    const result = resolve(parked, {
      kind: "attachCards",
      assignments: [
        { uid: a, to: { seat: "p1", spot: { spot: "active" } } },
        { uid: b, to: { seat: "p1", spot: { spot: "active" } } },
        { uid: c, to: { seat: "p1", spot: { spot: "bench", index: 0 } } },
      ],
    });
    expect(ids(result.state, result.state.players.p1.active?.energy ?? [])).toEqual([L, L, L]);
    expect(ids(result.state, result.state.players.p1.bench[0]?.energy ?? [])).toEqual([L]);
    expect(result.state.players.p1.bench[1]?.energy).toEqual([]);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([L, R]);
  });

  it("the ceiling follows the opponent's board: 1 Energy there is a cap of 1", () => {
    let state = table("me03-029", [[L, 1]], FILLER, [], [LIGHT]);
    state = discardFromDeck(attachFromDeck(state, "p2", "fix-energy", 1), "p1", L, 4);
    const prompt = promptOf(mustApply(state, attack(0)).state, "attachCards");
    expect(prompt.max).toBe(1);
    expect(prompt.candidates).toHaveLength(1);
  });

  it("no Energy on the opponent's board: nothing is offered and nothing moves", () => {
    const state = discardFromDeck(table("me03-029", [[L, 1]], FILLER, [], [LIGHT]), "p1", L, 4);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([L, L, L, L]);
  });

  it("a declined answer stands: \"up to\"", () => {
    const parked = mustApply(board(), attack(0)).state;
    const result = resolve(parked, { kind: "attachCards", assignments: [] });
    expect(result.state.players.p1.active?.energy).toHaveLength(1);
    expect(ids(result.state, result.state.players.p1.discard).filter((id) => id === L)).toHaveLength(4);
  });
});

describe("D624 §4 — Hand Trim: random cards off the opponent's hand until they have 5", () => {
  it("a hand of 8 loses exactly 3, each a RANDOM_CARD_TAKEN row into p2's discard pile", () => {
    let state = table("me03-067", [["fix-energy", 1]]);
    state = handFromDeck(handFromDeck(state, "p2", ITEM, 4), "p2", FILLER, 4);
    const before = state.players.p2.hand;
    const result = mustApply(state, attack(0));
    const taken = of(result.events, "RANDOM_CARD_TAKEN");
    expect(taken).toHaveLength(3);
    expect(new Set(taken.map((e) => e.uid)).size).toBe(3);
    for (const e of taken) {
      expect([e.seat, e.actor, e.to]).toEqual(["p2", "p1", "discard"]);
      expect(before).toContain(e.uid);
      expect(result.state.players.p2.discard).toContain(e.uid);
    }
    // p2 then draws for its turn: 5 kept + 1 drawn.
    expect(before.filter((u) => result.state.players.p2.hand.includes(u))).toHaveLength(5);
    expect(result.state.players.p2.hand).toHaveLength(6);
  });

  it("a hand of 5 or fewer takes nothing and spends no rng", () => {
    for (const held of [5, 2, 0]) {
      let state = table("me03-067", [["fix-energy", 1]]);
      state = handFromDeck(state, "p2", ITEM, held);
      const result = mustApply(state, attack(0));
      expect(of(result.events, "RANDOM_CARD_TAKEN"), String(held)).toEqual([]);
      expect(result.state.players.p2.discard).toEqual([]);
      expect(result.state.rngState).toEqual(state.rngState);
    }
  });

  it("a hand of 6 loses exactly 1", () => {
    const state = handFromDeck(table("me03-067", [["fix-energy", 1]]), "p2", ITEM, 6);
    expect(of(mustApply(state, attack(0)).events, "RANDOM_CARD_TAKEN")).toHaveLength(1);
  });
});

describe("D624 §5 — Select a Snack: the top 3, 1 into the hand, the other 2 discarded", () => {
  it("all 3 are offered and exactly 1 is taken; the other 2 land in the discard pile", () => {
    const state = table("30th-061", [["fix-energy", 1]]);
    const top = state.players.p1.deck.slice(0, 3);
    const parked = mustApply(state, attack(0)).state;
    const prompt = promptOf(parked, "chooseCards");
    expect(prompt.candidates).toEqual(top);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    const kept = top[1] as string;
    const result = resolve(parked, { kind: "cards", uids: [kept] });
    expect(result.state.players.p1.hand).toEqual([kept]);
    expect(result.state.players.p1.discard).toEqual([top[0], top[2]]);
    expect(of(result.events, "DECK_TOP_DISCARDED").map((e) => e.uids)).toEqual([[top[0], top[2]]]);
    expect(result.state.players.p1.deck.slice(0, 3)).not.toContain(kept);
    expect(result.state.players.p1.deck).toHaveLength(state.players.p1.deck.length - 3);
  });
  it("the caption is Explorer's Guidance's shared `lookNote`, and the log names the kept card (R-SAS1)", () => {
    const state = table("30th-061", [["fix-energy", 1]]);
    const top = state.players.p1.deck.slice(0, 3);
    const parked = mustApply(state, attack(0)).state;
    // The caption does not say the other 2 are discarded, exactly as for Explorer's Guidance (the
    // shared `lookNote` never captions `restTo`); the DECK_TOP_DISCARDED row below says it instead.
    expect(promptOf(parked, "chooseCards").note).toBe(
      "Look at the top 3 cards of your deck and put a card into your hand.",
    );
    const kept = top[1] as string;
    const result = resolve(parked, { kind: "cards", uids: [kept] });
    expect(of(result.events, "DECK_TOP_REVEALED").map((e) => [e.uids, e.reveal])).toEqual([[[kept], true]]);
  });

  it("taking nothing is refused: the printed \"put 1 of them\" is mandatory", () => {
    const parked = mustApply(table("30th-061", [["fix-energy", 1]]), attack(0)).state;
    const refused = applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } });
    expect(refused.ok).toBe(false);
  });
});

describe("D624 §6 — Send Flowers: any Energy card onto 1 Benched {G} Pokémon", () => {
  it("only the Benched Grass body is a target (not the Grass Active); a Special Energy is offered", () => {
    const state = table("me03-003", [[G, 1]], FILLER, [], [FILLER, GRASS]);
    const parked = mustApply(state, attack(0)).state;
    const prompt = promptOf(parked, "attachCards");
    expect(prompt.targets.map(spotOf)).toEqual(["p1:bench1"]);
    expect(prompt.max).toBe(1);
    const offered = new Set(ids(parked, prompt.candidates));
    expect(offered).toEqual(new Set([SPECIAL, L, R, G, "fix-energy"]));
    const special = prompt.candidates.find((u) => parked.cardIdByUid[u] === SPECIAL) as string;
    const result = resolve(parked, {
      kind: "attachCards",
      assignments: [{ uid: special, to: { seat: "p1", spot: { spot: "bench", index: 1 } } }],
    });
    expect(ids(result.state, result.state.players.p1.bench[1]?.energy ?? [])).toEqual([SPECIAL]);
    expect(result.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("no Benched Grass body: nothing is attached, and the deck is still shuffled", () => {
    const state = table("me03-003", [[G, 1]], FILLER, [], [FILLER]);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });
});

describe("D624 §7 — Chirp: up to 2 Pokémon with {F} Resistance, revealed into the hand", () => {
  it("only the Fighting-resistant Pokémon are offered, at most 2", () => {
    const state = table("me03-066", [["fix-energy", 1]]);
    const parked = mustApply(state, attack(0)).state;
    const prompt = promptOf(parked, "chooseCards");
    expect(sorted(ids(parked, prompt.candidates))).toEqual([RESIST_F, RESIST_F, RESIST_F]);
    expect(prompt.max).toBe(2);
    expect(prompt.note).toContain("Pokémon with Fighting Resistance");
    const result = resolve(parked, { kind: "cards", uids: prompt.candidates.slice(0, 2) });
    expect(ids(result.state, result.state.players.p1.hand)).toEqual([RESIST_F, RESIST_F]);
    expect(of(result.events, "DECK_SEARCHED")[0]?.reveal).toBe(true);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("the filter reads the printed Resistance type on a Pokémon, and a Trainer never matches", () => {
    const filter = { kind: "pokemonWithResistance", type: "Fighting" } as const;
    expect(matchesFilter(POOL[RESIST_F] as Card, filter)).toBe(true);
    expect(matchesFilter(POOL[RESIST_G] as Card, filter)).toBe(false);
    expect(matchesFilter(POOL[RESIST_G] as Card, { ...filter, type: "Grass" })).toBe(true);
    expect(matchesFilter(POOL[FILLER] as Card, filter)).toBe(false);
    expect(matchesFilter({ ...(POOL[ITEM] as Card), resistances: FIGHTING_RESISTANCE }, filter)).toBe(false);
  });
});

describe("D624 §8 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.514.0");
  });
});
