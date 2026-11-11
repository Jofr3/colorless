import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveAttackCost, stadiumEffectsOf } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { redactGame } from "./redact";
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
  setBenchDamage,
  setDamage,
  trainerCard,
  must,
  effectPrompt,
  ensureInDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PRISM_TEXT =
  "Once during each player's turn, that player may discard 2 cards from their hand in order to draw a card.";
const SURF_TEXT =
  "Once during each player's turn, that player may switch their Active {W} Pokémon with 1 of their Benched {W} Pokémon.";
const MINE_TEXT =
  "Attacks used by each Tera Pokémon in play (both yours and your opponent's) cost {C} more.";
const LUMIOSE_TEXT =
  "Once during each player's turn, that player may search their deck for a Basic Pokémon and put it onto their Bench. Then, that player shuffles their deck. If a player searches their deck in this way, their turn ends.";
const FANFARE_TEXT =
  "Once during each player's turn, that player may heal 10 damage from each of their Pokémon. If a player healed any damage in this way, their turn ends.";

const PRISM = ["me04-080", "me04-111"] as const;
const SURF = ["me01-129", "me04-114"] as const;
const MINE = "me02.5-197";
const LUMIOSE = ["me03-077", "me03-111"] as const;
const FANFARE = ["mep-028", "mep-120"] as const;

const TEXTS: readonly (readonly [string, readonly string[], string])[] = [
  ["Prism Tower", PRISM, PRISM_TEXT],
  ["Surfing Beach", SURF, SURF_TEXT],
  ["Nighttime Mine", [MINE], MINE_TEXT],
  ["Lumiose City", LUMIOSE, LUMIOSE_TEXT],
  ["Celebratory Fanfare", FANFARE, FANFARE_TEXT],
];

const FILLER = "d606-filler";
const WATER = "d606-water";
const WATER_B = "d606-water-b";
const TERA = "sv08-057";
const ITEM_A = "d606-item-a";
const ITEM_B = "d606-item-b";
const ZAP = { name: "Zap", cost: ["Colorless", "Colorless"], damage: "30", effect: "" };

const stadiumCard = (id: string, name: string, effect: string): Card => ({
  ...trainerCard(id, "Stadium", effect),
  name,
});
const itemCard = (id: string, name: string): Card => ({
  ...trainerCard(id, "Item", "A test Item."),
  name,
});

const LOCAL_CARDS: Record<string, Card> = {
  [PRISM[0]]: stadiumCard(PRISM[0], "Prism Tower", PRISM_TEXT),
  [SURF[0]]: stadiumCard(SURF[0], "Surfing Beach", SURF_TEXT),
  [MINE]: stadiumCard(MINE, "Nighttime Mine", MINE_TEXT),
  [LUMIOSE[0]]: stadiumCard(LUMIOSE[0], "Lumiose City", LUMIOSE_TEXT),
  [FANFARE[0]]: stadiumCard(FANFARE[0], "Celebratory Fanfare", FANFARE_TEXT),
  [FILLER]: battler(FILLER, { name: "D606 Filler", hp: 300, types: ["Colorless"] }),
  [WATER]: battler(WATER, { name: "D606 Water", hp: 300, types: ["Water"] }),
  [WATER_B]: battler(WATER_B, { name: "D606 Water B", hp: 300, types: ["Water"] }),
  [TERA]: battler(TERA, { name: "Pikachu ex", hp: 200, attacks: [ZAP] }),
  [ITEM_A]: itemCard(ITEM_A, "D606 Item A"),
  [ITEM_B]: itemCard(ITEM_B, "D606 Item B"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [PRISM[0]]: 2,
  [SURF[0]]: 2,
  [MINE]: 1,
  [LUMIOSE[0]]: 2,
  [FANFARE[0]]: 2,
  [FILLER]: 16,
  [WATER]: 6,
  [WATER_B]: 4,
  [TERA]: 4,
  [ITEM_A]: 6,
  [ITEM_B]: 6,
  "fix-energy": 9,
});

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** p1's turn 2: `active` for p1 and `oppActive` for p2, each Bench exactly the listed bodies. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  seed = 6061,
): GameState {
  let state = opened(seed);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  return state;
}

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids`. */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id}`);
    deck = deck.filter((u) => u !== uid);
    hand.push(uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

const use = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "useStadiumAbility", seat });
const refusal = (state: GameState) => {
  const result = applyAction(state, { type: "useStadiumAbility", seat: "p1" });
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};
const cards = (uids: readonly string[]): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "cards", uids: [...uids] },
});
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const offer = (state: GameState) => {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.stadiumAbility;
};

describe("D606 §1 — the programs: five objects over 9 printings", () => {
  it("every printing of a text is on ONE object, five objects in all", () => {
    expect(TEXTS.flatMap(([, ids]) => ids)).toHaveLength(9);
    for (const [name, ids] of TEXTS)
      for (const id of ids) {
        expect(programFor(id), `${name} ${id}`).toBeDefined();
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
      }
    expect(new Set(TEXTS.map(([, ids]) => programFor(ids[0] as string))).size).toBe(5);
  });

  it("Prism Tower: the hand cost of 2 to the discard, then draw 1", () => {
    expect(programFor(PRISM[0])?.stadium).toEqual({
      ability: {
        label: "Prism Tower",
        program: [
          { op: "payFromHand", count: 2, to: "discard" },
          { op: "drawCards", count: 1 },
        ],
      },
    });
    expect(programFor(PRISM[0])?.stadium?.ability?.program).toEqual(
      programFor("sv10-155")?.abilities?.[0]?.program,
    );
  });

  it("Surfing Beach: the {W} Active gate and the {W} Bench end", () => {
    expect(programFor(SURF[0])?.stadium).toEqual({
      ability: {
        label: "Surfing Beach",
        playableIf: { kind: "yourActiveHasType", type: "Water" },
        program: [{ op: "switchActive", targetType: "Water" }],
      },
    });
  });

  it("Nighttime Mine: League HQ's {C} surcharge on the Tera banner", () => {
    expect(programFor(MINE)?.stadium).toEqual({
      attackCostSurcharge: { amount: 1, attacker: { kind: "bannerPokemon", banner: "Tera" } },
    });
    expect(programFor("sv03-192")?.stadium).toEqual({ basicAttackCostSurcharge: 1 });
  });

  it("Lumiose City: Artazon's search without the Rule Box narrowing, and the use ends the turn", () => {
    const ability = programFor(LUMIOSE[0])?.stadium?.ability;
    expect(ability).toEqual({
      label: "Lumiose City",
      program: [
        { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
        { op: "shuffleDeck" },
      ],
      endsTurn: "always",
    });
    expect(programFor("sv02-171")?.stadium?.ability?.endsTurn).toBeUndefined();
  });

  it("Celebratory Fanfare: Community Center's heal without its gate, the turn ending only if any healed", () => {
    expect(programFor(FANFARE[0])?.stadium?.ability).toEqual({
      label: "Celebratory Fanfare",
      program: [{ op: "healEach", amount: 10 }],
      endsTurn: "ifHealed",
    });
    expect(programFor("sv06-146")?.stadium?.ability?.program).toEqual([
      { op: "healEach", amount: 10 },
    ]);
  });

  it("the last three dropped Stadiums are keyed: Dizzying Valley, Risky Ruins and Ange Floette carry a `stadium` program (D642)", () => {
    for (const id of [
      "me02-088", // Dizzying Valley
      "me01-127", // Risky Ruins
      "me04-075", // Ange Floette
    ])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
  });
});

describe("D606 §2 — Prism Tower: discard 2 from the hand, draw 1", () => {
  it("three cards in hand: the pick of exactly 2 parks, both go to the discard, one card is drawn", () => {
    const board = setHand(stadium(table(FILLER), PRISM[0]), "p1", [ITEM_A, ITEM_B, ITEM_A]);
    const { state: parked } = use(board);
    const p = effectPrompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 2, max: 2 });
    const [a, b, c] = board.players.p1.hand as [string, string, string];
    const top = board.players.p1.deck[0] as string;
    const { state, events } = mustApply(parked, cards([a, b]));
    expect(of(events, "HAND_COST_PAID")).toEqual([
      { type: "HAND_COST_PAID", seat: "p1", uids: [a, b], to: "discard" },
    ]);
    expect(state.players.p1.discard.slice(-2)).toEqual([a, b]);
    expect(state.players.p1.hand).toEqual([c, top]);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(state.allowances.stadiumAbilityUsed).toBe(true);
    expectErr(state, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_ALREADY_USED");
  });

  it("one card in hand is REFUSED (R-AN's hand cost) on the engine and on the wire, and the use is not spent", () => {
    const short = setHand(stadium(table(FILLER), PRISM[0]), "p1", [ITEM_A]);
    expect(refusal(short)).toMatchObject({
      code: "PLAY_CONDITION_NOT_MET",
      message: "Prism Tower can only be used if you discard 2 cards from your hand (§7.3)",
    });
    expect(offer(short)).toEqual({
      label: "Prism Tower",
      disabled: true,
      reason: "Only if you discard 2 cards from your hand",
    });
    const stocked = setHand(short, "p1", [ITEM_A, ITEM_B]);
    expect(offer(stocked)).toEqual({ label: "Prism Tower", disabled: false, reason: null });
    const { state } = use(stocked);
    expect(state.players.p1.hand).toHaveLength(1);
  });
});

describe("D606 §3 — Surfing Beach: the Active {W} switches with a Benched {W}", () => {
  it("one Benched {W} beside a non-{W}: no prompt, the {W} comes up, the old Active goes to the Bench", () => {
    const board = stadium(table(WATER, [FILLER, WATER_B]), SURF[0]);
    const before = board.players.p1;
    const { state } = use(board);
    expect(idOf(state, state.players.p1.active?.stack[0])).toBe(WATER_B);
    expect(state.players.p1.bench.map((b) => idOf(state, b.stack[0]))).toEqual([FILLER, WATER]);
    expect(state.players.p1.active?.stack).toEqual(before.bench[1]?.stack);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("two Benched {W}: the pick parks over those two only", () => {
    const board = stadium(table(WATER, [WATER_B, FILLER, WATER]), SURF[0]);
    const { state: parked } = use(board);
    const p = effectPrompt(parked);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 0 } },
      { seat: "p1", spot: { spot: "bench", index: 2 } },
    ]);
  });

  it("a non-{W} Active is REFUSED by the printed gate, on the engine and on the wire", () => {
    const board = stadium(table(FILLER, [WATER]), SURF[0]);
    expect(refusal(board)).toMatchObject({
      code: "PLAY_CONDITION_NOT_MET",
      message: "Surfing Beach can only be used if your Active Pokémon is a Water Pokémon (§7.3)",
    });
    expect(offer(board)).toEqual({
      label: "Surfing Beach",
      disabled: true,
      reason: "Only if your Active Pokémon is a Water Pokémon",
    });
  });

  it("a {W} Active with no Benched {W}: NO_LEGAL_TARGET — the FIRST printed Stadium program `programPlayable` refuses, and the wire greys it", () => {
    const board = stadium(table(WATER, [FILLER]), SURF[0]);
    expect(refusal(board).code).toBe("NO_LEGAL_TARGET");
    expect(offer(board)).toEqual({
      label: "Surfing Beach",
      disabled: true,
      reason: "No legal target",
    });
    expect(board.allowances.stadiumAbilityUsed).toBe(false);
  });
});

describe("D606 §4 — Nighttime Mine: each Tera Pokémon's attacks cost {C} more, both sides", () => {
  const mined = (seedBoard: GameState) => stadium(seedBoard, MINE, "p2");

  it("the Tera attacker's cost gains one {C}, on EITHER seat; a non-Tera body and an empty zone are unmoved", () => {
    const board = mined(table(TERA, [FILLER], TERA));
    expect(stadiumEffectsOf(board)?.attackCostSurcharge?.amount).toBe(1);
    const p1 = board.players.p1;
    const p2 = board.players.p2;
    const three = ["Colorless", "Colorless", "Colorless"];
    expect(
      effectiveAttackCost(board, p1.active as NonNullable<typeof p1.active>, ZAP.cost),
    ).toEqual(three);
    expect(
      effectiveAttackCost(board, p2.active as NonNullable<typeof p2.active>, ZAP.cost),
    ).toEqual(three);
    expect(
      effectiveAttackCost(board, p1.bench[0] as NonNullable<(typeof p1.bench)[0]>, ZAP.cost),
    ).toBe(ZAP.cost);
    const bare = table(TERA);
    const active = bare.players.p1.active as NonNullable<typeof bare.players.p1.active>;
    expect(effectiveAttackCost(bare, active, ZAP.cost)).toBe(ZAP.cost);
  });

  it("on a real attack: two Energy pay Zap without the Mine and are refused under it", () => {
    const paid = attachFromDeck(table(TERA), "p1", "fix-energy", 2);
    expect(applyAction(paid, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
    const refused = applyAction(mined(paid), { type: "attack", seat: "p1", index: 0 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("ATTACK_COST_UNMET");
  });
});

describe("D606 §5 — Lumiose City: a Basic from the deck to the Bench, and the turn ends (R-LC1)", () => {
  it("the search parks with `phase.endsTurn`, the answer benches the Basic, shuffles, and passes the turn", () => {
    const board = stadium(table(FILLER), LUMIOSE[0]);
    const { state: parked, events: opened } = use(board);
    expect(of(opened, "STADIUM_ABILITY_ACTIVATED")).toHaveLength(1);
    expect(parked.phase.kind === "effect:choose" && parked.phase.endsTurn).toBe(true);
    const p = effectPrompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p.max).toBe(1);
    const pick = p.candidates.find((u) => idOf(parked, u) === WATER) as string;
    const { state, events } = mustApply(parked, cards([pick]));
    expect(state.players.p1.bench.map((b) => b.stack[0])).toEqual([pick]);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("R-LC1 — a search that takes nothing still ends the turn (the use IS the search)", () => {
    const { state: parked } = use(stadium(table(FILLER), LUMIOSE[0]));
    const { state } = mustApply(parked, cards([]));
    expect(state.players.p1.bench).toEqual([]);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("a parked Lumiose City round-trips through JSON and still ends the turn", () => {
    const { state: parked } = use(stadium(table(FILLER), LUMIOSE[0]));
    const revived = roundTrip(parked);
    expect(revived).toEqual(parked);
    expect(mustApply(revived, cards([])).state).toEqual(mustApply(parked, cards([])).state);
  });

  it("the opponent may use it on their own turn, off their own allowance, and it ends THEIR turn", () => {
    const { state: parked } = use(stadium(table(FILLER), LUMIOSE[0]));
    const p2Turn = mustApply(parked, cards([])).state;
    expect(p2Turn.allowances.stadiumAbilityUsed).toBe(false);
    const { state: theirs } = use(p2Turn, "p2");
    const answered = mustApply(theirs, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [] },
    });
    expect(answered.state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });
});

describe("D606 §6 — Celebratory Fanfare: heal 10 from each; if any healed, the turn ends (R-CF1)", () => {
  it("a damaged board heals 10 from each damaged body of the ACTOR's, and the turn passes", () => {
    let board = stadium(table(FILLER, [FILLER, WATER], WATER), FANFARE[0]);
    board = setBenchDamage(setDamage(setDamage(board, "p1", 30), "p2", 40), "p1", 1, 10);
    const { state, events } = use(board);
    expect(of(events, "HEALED").map((e) => [e.seat, e.amount])).toEqual([
      ["p1", 10],
      ["p1", 10],
    ]);
    expect(state.players.p2.active?.damage).toBe(40);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("R-CF1 — nothing of the actor's damaged: the use is spent, nothing heals, and the turn CONTINUES", () => {
    const board = setDamage(stadium(table(FILLER, [WATER], WATER), FANFARE[0]), "p2", 40);
    const { state, events } = use(board);
    expect(of(events, "HEALED")).toEqual([]);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(state.allowances.stadiumAbilityUsed).toBe(true);
    expect(state.players.p2.active?.damage).toBe(40);
  });

  it("Community Center is the ungated twin's control: the same program, its gate, and no turn end", () => {
    const fanfare = programFor(FANFARE[0])?.stadium?.ability;
    const center = programFor("sv06-146")?.stadium?.ability;
    expect(fanfare?.program).toEqual(center?.program);
    expect(center?.endsTurn).toBeUndefined();
    expect(center?.playableIf).toEqual({ kind: "youPlayedSupporterThisTurn" });
    expect(fanfare?.playableIf).toBeUndefined();
  });
});
