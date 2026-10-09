import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote, runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  toDeckTop,
  trainerCard,
  trimDeckTo,
} from "./testFixtures";

// ── 🆕🆕🆕 D617 — WP24b: FIVE MORE WP24 SUPPORTERS ──
//
// 11 `me` Supporter printings / 5 printed texts, on five NEW objects (registry.ts D617 block):
// Pokémon Center Lady (`healChosen.recoverHealed`), AZ's Tranquility (`healChosen.targetRecorded`
// behind Scramble Switch's demoted-body filing, with `switchActive.demotedAsMoved`, R-AZT1), Grimsley's Move (shipped `lookAtTopN` + D611's
// `notYourFirstTurn`), Gwynn (`drawCards.per` member `recorded`) and Naveen (`payFromHand.cap: "any"`
// + `yourDeckNotEmpty`). Texts measured on the LOCAL D1, 2026-10-09, `legal_standard = 1` on every
// row; driven on the real ids in a LOCAL `cardPool` (D275). Gladion's Final Battle, Acerola's
// Mischief and Roxie's Performance stay unkeyed (each changes persisted side state — WP24c).

const LADY = "me01-123";
const AZ = "me04-076";
const GRIMSLEY = "me02-090";
const GWYNN = "me05-078";
const NAVEEN = "me03-079";

/** [me ids, card name, printed text] — LOCAL D1 `cards.effect`, byte for byte. */
const TEXTS: readonly (readonly [readonly string[], string, string])[] = [
  [
    [LADY],
    "Pokémon Center Lady",
    "Heal 60 damage from 1 of your Pokémon, and it recovers from all Special Conditions.",
  ],
  [
    [AZ, "me04-106", "me04-120"],
    "AZ's Tranquility",
    "Switch your Active Pokémon with 1 of your Benched Pokémon. If you moved a Pokémon ex to your Bench in this way, heal 80 damage from that Pokémon.",
  ],
  [
    [GRIMSLEY, "me02-120"],
    "Grimsley's Move",
    "Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck. You can't use this card during your first turn.",
  ],
  [
    [GWYNN, "me05-109", "me05-119"],
    "Gwynn",
    "Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
  ],
  [
    [NAVEEN, "me03-112"],
    "Naveen",
    "Draw cards until you have 5 cards in your hand. Before drawing cards, you may discard any number of cards from your hand. (If you can't draw any cards in this way, you can't use this card.)",
  ],
];

/** The WP24 printings still unkeyed after this slice (persisted side state — WP24c). */
const NOT_KEYED: Readonly<Record<string, readonly string[]>> = {
  "Gladion's Final Battle": ["me05-077", "me05-108", "me05-118"],
  "Acerola's Mischief": ["me01-113", "me01-165", "me01-183", "me02.5-180"],
  "Roxie's Performance": ["me04-081", "me04-112", "me04-121"],
};

const ME_IDS = TEXTS.flatMap(([ids]) => ids);

describe("D617 §1 — the faces: 11 `me` printings / 5 texts, one object per text", () => {
  it("5 texts / 11 printings, every printing of a text on ONE object, distinct across texts", () => {
    expect(ME_IDS).toHaveLength(11);
    expect(new Set(ME_IDS).size).toBe(11);
    const objects = new Set<unknown>();
    for (const [ids] of TEXTS) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      objects.add(program);
    }
    expect(objects.size).toBe(5);
  });

  it("the other 10 WP24 printings (3 texts) stay unkeyed", () => {
    const ids = Object.values(NOT_KEYED).flat();
    expect(ids).toHaveLength(10);
    for (const id of ids) expect(programFor(id), id).toBeUndefined();
  });
});

describe("D617 §2 — the registry programs, field for field", () => {
  it("Pokémon Center Lady = `healChosen` 60 with `recoverHealed`", () => {
    expect(programFor(LADY)).toEqual({ trainer: [{ op: "healChosen", amount: 60, recoverHealed: true }] });
  });

  it("AZ's Tranquility = Scramble Switch's demoted filing, the gate, and the pinned ex heal", () => {
    expect(programFor(AZ)?.trainer?.[0]).toEqual({ ...programFor("sv08-186")?.trainer?.[0], demotedAsMoved: true });
    expect(programFor(AZ)).toEqual({
      trainer: [
        { op: "switchActive", recordAs: "moved", recordDemoted: true, demotedAsMoved: true },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [
            { op: "healChosen", amount: 80, targetRecorded: "moved", filter: { kind: "suffixPokemon", suffix: "ex" } },
          ],
        },
      ],
    });
  });

  it("Grimsley's Move = the top-7 look onto the Bench, the rest under the deck, not on your first turn", () => {
    expect(programFor(GRIMSLEY)).toEqual({
      trainer: [
        {
          op: "lookAtTopN",
          n: 7,
          filter: { kind: "typedPokemon", pokemonType: "Darkness" },
          max: 1,
          dest: "bench",
          restTo: "shuffledBottom",
        },
      ],
      trainerPlayableIf: { kind: "notYourFirstTurn" },
    });
  });

  it("Gwynn = the declinable non-Rule-Box discard (cap 2), then 3 per filed card", () => {
    expect(programFor(GWYNN)).toEqual({
      trainer: [
        {
          op: "payFromHand",
          count: "any",
          cap: 2,
          to: "discard",
          filter: { kind: "anyPokemon", noRuleBox: true },
          recordAs: "discarded",
        },
        { op: "drawCards", count: 3, per: { kind: "recorded", slot: "discarded" } },
      ],
    });
  });

  it("Naveen = the uncapped declinable discard, draw to 5, behind a non-empty deck", () => {
    expect(programFor(NAVEEN)).toEqual({
      trainer: [
        { op: "payFromHand", count: "any", cap: "any", to: "discard" },
        { op: "drawUntilHandSize", size: 5 },
      ],
      trainerPlayableIf: { kind: "yourDeckNotEmpty" },
    });
  });
});

// ── ON A BOARD ──

const PLAIN = "d617-plain"; // a Basic {C}, no Rule Box
const DARK = "d617-dark"; // a Basic {D}
const DARK_S1 = "d617-dark-s1"; // a Stage 1 {D}
const BRUTE = "d617-brute"; // "D617 Brute ex", a Basic Pokémon ex
const MEGA = "d617-mega"; // "Mega D617 ex", a Mega Evolution Pokémon ex (shaped as a Basic for the board)
const VICTIM = "d617-victim";
const FILLER = "d617-filler";
const ITEM = "d617-item";
/** Palafin `sv06-060` ("Zero to Hero") and Palafin ex `sv06-061`, on their real ids (R-AZT1). */
const PALAFIN = "sv06-060";
const PALAFIN_EX = "sv06-061";
const ZERO_TO_HERO =
  "Once during your turn, when this Pokémon moves from the Active Spot to the Bench, you may search your deck for a Palafin ex and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.";

const body = (id: string, name: string, types: string[], extra: Partial<Card> = {}): Card =>
  battler(id, { name, hp: 300, types, attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }], ...extra });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    TEXTS.flatMap(([ids, name, text]) => ids.map((id) => [id, { ...trainerCard(id, "Supporter", text), name }])),
  ),
  [PLAIN]: body(PLAIN, "D617 Plain", ["Colorless"]),
  [DARK]: body(DARK, "D617 Dark", ["Darkness"]),
  [DARK_S1]: body(DARK_S1, "D617 Dark Two", ["Darkness"], { stage: "Stage1", evolveFrom: "D617 Dark" }),
  [BRUTE]: body(BRUTE, "D617 Brute ex", ["Colorless"]),
  [MEGA]: body(MEGA, "Mega D617 ex", ["Colorless"]),
  [VICTIM]: battler(VICTIM, { name: "D617 Victim", hp: 300 }),
  [FILLER]: battler(FILLER, { name: "D617 Filler", hp: 300 }),
  [ITEM]: { ...trainerCard(ITEM, "Item", "Draw a card."), name: "D617 Item" },
  [PALAFIN]: battler(PALAFIN, {
    name: "Palafin",
    stage: "Stage1",
    evolveFrom: "Finizen",
    types: ["Water"],
    hp: 100,
    abilities: [{ type: "Ability", name: "Zero to Hero", effect: ZERO_TO_HERO }],
  }),
  [PALAFIN_EX]: battler(PALAFIN_EX, {
    name: "Palafin ex",
    stage: "Stage1",
    evolveFrom: "Finizen",
    types: ["Water"],
    hp: 340,
    abilities: [
      {
        type: "Ability",
        name: "Hero's Spirit",
        effect: "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability.",
      },
    ],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [LADY]: 1,
  [AZ]: 1,
  [GRIMSLEY]: 1,
  [GWYNN]: 1,
  [NAVEEN]: 1,
  [PLAIN]: 6,
  [DARK]: 3,
  [DARK_S1]: 3,
  [BRUTE]: 3,
  [MEGA]: 2,
  [VICTIM]: 2,
  [FILLER]: 6,
  [ITEM]: 4,
  [PALAFIN]: 1,
  [PALAFIN_EX]: 1,
  "fix-fire-energy": 18,
  "fix-energy": 6, // the prize row
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Hands and prize rows reset: every hand back into the deck, the six `fix-energy` the prize row. */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => next.cardIdByUid[u] === "fix-energy");
    next = {
      ...next,
      players: { ...next.players, [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) } },
    };
  }
  return next;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed: turn 2). */
function p1First(): GameState {
  const created = createGame({ seed: 6177, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  return reset(state);
}

/** P1's SECOND turn (turn 4), hands reset again. */
function p1Later(): GameState {
  let state = must(applyAction(p1First(), { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 4) throw new Error(`expected turn 4, got ${state.turn}`);
  return reset(state);
}

/** P1: `active` Active and exactly `bench` benched; P2: the Victim Active and a Filler benched. */
function board(active: string, bench: readonly string[], base: GameState = p1First()): GameState {
  let state = clearBench(setActiveFromDeck(base, "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", VICTIM), "p2");
  return benchFromDeck(state, "p2", FILLER);
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
const ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const bench = (index: number) => ({ seat: "p1", spot: { spot: "bench", index } }) as const;
const pickRef = (ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } }) as GameAction;
const pickCards = (uids: readonly string[]): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } }) as GameAction;
/** A parked state revived from JSON, the way a `MatchRecord` stores it. */
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

describe("D617 §3 — Pokémon Center Lady: heal 60, and the healed Pokémon recovers from all Special Conditions", () => {
  const sick = (state: GameState) => setConditions(state, "p1", { rotation: "asleep", poisonDamage: 10, burned: true });

  it("the Active picked: 60 healed and every condition cleared (ONE `STATUS_CLEARED`, three conditions)", () => {
    let state = sick(setDamage(board(PLAIN, [FILLER]), "p1", 100));
    state = setBenchDamage(state, "p1", 0, 50);
    const parked = play(state, LADY).state;
    expect(prompt(parked).kind).toBe("choosePokemon");
    expect(prompt(parked).note).toBe("Heal which of your Pokémon? It also recovers from all Special Conditions.");
    const { state: done, events } = mustApply(parked, pickRef(ACTIVE));
    expect(done.players.p1.active?.damage).toBe(40);
    expect(done.players.p1.active?.conditions).toMatchObject({ rotation: "none", poisonDamage: 0, burned: false });
    expect(all(events, "STATUS_CLEARED")).toEqual([
      expect.objectContaining({ seat: "p1", statuses: ["asleep", "poisoned", "burned"], reason: "recovered" }),
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
  });

  it("a Benched pick: that body is healed and the Active keeps its conditions", () => {
    let state = sick(setDamage(board(PLAIN, [FILLER]), "p1", 100));
    state = setBenchDamage(state, "p1", 0, 50);
    const { state: done, events } = mustApply(play(state, LADY).state, pickRef(bench(0)));
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.active?.damage).toBe(100);
    expect(done.players.p1.active?.conditions.burned).toBe(true);
    expect(all(events, "STATUS_CLEARED")).toEqual([]);
  });

  it("a lone Active is FORCED: healed and recovered with no prompt", () => {
    const state = sick(setDamage(board(PLAIN, []), "p1", 30));
    const { state: done } = play(state, LADY);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.players.p1.active?.conditions).toMatchObject({ rotation: "none", poisonDamage: 0, burned: false });
  });

  it("the recovery does not wait on the heal: an UNDAMAGED Active still recovers", () => {
    const state = sick(board(PLAIN, []));
    const { state: done, events } = play(state, LADY);
    expect(all(events, "HEALED")).toEqual([]);
    expect(done.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("the parked pick survives a JSON round trip and still recovers", () => {
    let state = sick(setDamage(board(PLAIN, [FILLER]), "p1", 100));
    state = setBenchDamage(state, "p1", 0, 50);
    const { state: done } = mustApply(revived(play(state, LADY).state), pickRef(ACTIVE));
    expect(done.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(done.players.p1.active?.damage).toBe(40);
  });
});

describe("D617 §4 — AZ's Tranquility: switch, then heal 80 from the demoted body if it is a Pokémon ex", () => {
  it("an ex Active switched out (one Benched body, forced): the demoted ex is healed 80", () => {
    const state = setDamage(board(BRUTE, [PLAIN]), "p1", 120);
    const { state: done, events } = play(state, AZ);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(PLAIN);
    expect(done.cardIdByUid[done.players.p1.bench[0]?.stack.at(-1) ?? ""]).toBe(BRUTE);
    expect(done.players.p1.bench[0]?.damage).toBe(40);
    expect(all(events, "HEALED")).toEqual([expect.objectContaining({ seat: "p1", amount: 80 })]);
  });

  it("a non-ex Active switched out: nothing is healed", () => {
    const state = setDamage(board(PLAIN, [BRUTE]), "p1", 120);
    const { state: done, events } = play(state, AZ);
    expect(done.cardIdByUid[done.players.p1.bench[0]?.stack.at(-1) ?? ""]).toBe(PLAIN);
    expect(done.players.p1.bench[0]?.damage).toBe(120);
    expect(all(events, "HEALED")).toEqual([]);
  });

  it("the NEW Active is never healed, even when it is the damaged ex", () => {
    let state = board(PLAIN, [BRUTE]);
    state = setBenchDamage(state, "p1", 0, 120);
    const { state: done, events } = play(state, AZ);
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(BRUTE);
    expect(done.players.p1.active?.damage).toBe(120);
    expect(all(events, "HEALED")).toEqual([]);
  });

  it("a Mega Evolution Pokémon ex is a Pokémon ex: healed 80 (clamped to its damage)", () => {
    const state = setDamage(board(MEGA, [PLAIN]), "p1", 50);
    const { state: done } = play(state, AZ);
    expect(done.cardIdByUid[done.players.p1.bench[0]?.stack.at(-1) ?? ""]).toBe(MEGA);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });

  it("two Benched bodies park the switch; the answer (after a JSON round trip) heals the demoted ex only", () => {
    let state = setDamage(board(BRUTE, [PLAIN, MEGA]), "p1", 120);
    state = setBenchDamage(state, "p1", 1, 100);
    const parked = play(state, AZ).state;
    expect(prompt(parked).kind).toBe("choosePokemon");
    const { state: done } = mustApply(revived(parked), pickRef(bench(1)));
    expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(MEGA);
    expect(done.players.p1.active?.damage).toBe(100);
    const demoted = done.players.p1.bench.find((p) => done.cardIdByUid[p.stack.at(-1) ?? ""] === BRUTE);
    expect(demoted?.damage).toBe(40);
  });

  it("an empty Bench refuses the play (no legal switch)", () => {
    expect(refusal(board(BRUTE, []), AZ)).toBe("NO_LEGAL_TARGET");
  });

  it("R-AZT1 (UNRULED): a non-ex Palafin moved to the Bench and swapped by Zero to Hero for Palafin ex is NOT healed", () => {
    const state = setDamage(board(PALAFIN, [PLAIN]), "p1", 30);
    expect(state.players.p1.deck.some((u) => state.cardIdByUid[u] === PALAFIN_EX)).toBe(true);
    const { state: done, events } = play(state, AZ);
    expect(all(events, "POKEMON_SWAPPED_FROM_DECK")).toHaveLength(1);
    expect(done.cardIdByUid[done.players.p1.bench[0]?.stack.at(-1) ?? ""]).toBe(PALAFIN_EX);
    expect(done.players.p1.bench[0]?.damage).toBe(30);
    expect(all(events, "HEALED")).toEqual([]);
  });
});

describe("D617 §5 — Grimsley's Move: top 7, a {D} Pokémon onto the Bench, the rest under the deck", () => {
  it("refused during your first turn (the going-second seat's turn 2)", () => {
    expect(refusal(board(PLAIN, []), GRIMSLEY)).toBe("PLAY_CONDITION_NOT_MET");
  });

  it("on a later turn: only a Basic {D} is offered; the taken one is benched and the other six go under the deck", () => {
    let state = board(PLAIN, [], p1Later());
    state = toDeckTop(state, "p1", ITEM, 2);
    state = toDeckTop(state, "p1", DARK_S1, 1);
    state = toDeckTop(state, "p1", PLAIN, 1);
    state = toDeckTop(state, "p1", DARK, 2);
    state = toDeckTop(state, "p1", GRIMSLEY, 1);
    const { state: next, uid } = staged(state, GRIMSLEY);
    const top7 = next.players.p1.deck.slice(0, 7);
    const below = next.players.p1.deck.slice(7);
    const parked = mustApply(next, { type: "playTrainer", seat: "p1", uid }).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(idsOf(parked, p.candidates)).toEqual([DARK, DARK]);
    expect(p.max).toBe(1);
    const taken = p.candidates[0] as string;
    const done = mustApply(parked, pickCards([taken])).state;
    expect(done.players.p1.bench.map((b) => b.stack.at(-1))).toEqual([taken]);
    expect(done.players.p1.deck.slice(0, below.length)).toEqual(below);
    expect([...done.players.p1.deck.slice(below.length)].sort()).toEqual(top7.filter((u) => u !== taken).sort());
  });

  it("no {D} Pokémon in the top 7: nothing benched, all 7 still go under the deck", () => {
    let state = board(PLAIN, [], p1Later());
    state = toDeckTop(state, "p1", ITEM, 4);
    state = toDeckTop(state, "p1", PLAIN, 3);
    const { state: next, uid } = staged(state, GRIMSLEY);
    const top7 = next.players.p1.deck.slice(0, 7);
    const done = mustApply(next, { type: "playTrainer", seat: "p1", uid }).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench).toEqual([]);
    expect([...done.players.p1.deck.slice(-7)].sort()).toEqual([...top7].sort());
  });
});

describe("D617 §6 — Gwynn: discard up to 2 non-Rule-Box Pokémon, draw 3 per card discarded", () => {
  function gwynnBoard(hand: Readonly<Record<string, number>>): GameState {
    let state = board(PLAIN, []);
    for (const [id, n] of Object.entries(hand)) state = handFromDeck(state, "p1", id, n);
    return state;
  }
  const handIds = (state: GameState) => idsOf(state, state.players.p1.hand);

  it("only non-Rule-Box Pokémon are offered, up to 2; discarding 2 draws 6", () => {
    const state = gwynnBoard({ [PLAIN]: 1, [DARK]: 1, [BRUTE]: 1, [ITEM]: 1 });
    const parked = play(state, GWYNN).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(idsOf(parked, p.candidates).sort()).toEqual([DARK, PLAIN].sort());
    expect([p.min, p.max]).toEqual([0, 2]);
    const deckTop = parked.players.p1.deck.slice(0, 6);
    const done = mustApply(parked, pickCards(p.candidates)).state;
    expect(done.players.p1.hand.slice(-6)).toEqual(deckTop);
    expect(handIds(done)).toHaveLength(2 + 6);
    expect(idsOf(done, done.players.p1.discard)).toEqual(expect.arrayContaining([PLAIN, DARK, GWYNN]));
  });

  it("discarding 1 draws 3; declining draws 0 (after a JSON round trip)", () => {
    const state = gwynnBoard({ [PLAIN]: 2 });
    const parked = play(state, GWYNN).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(mustApply(revived(parked), pickCards([p.candidates[0] as string])).state.players.p1.hand).toHaveLength(1 + 3);
    expect(mustApply(revived(parked), pickCards([])).state.players.p1.hand).toHaveLength(2);
  });

  it("R-GW1 (UNRULED): a hand with no non-Rule-Box Pokémon still plays — it discards and draws nothing", () => {
    const state = gwynnBoard({ [BRUTE]: 1, [ITEM]: 1 });
    const { state: done, events } = play(state, GWYNN);
    expect(done.phase.kind).toBe("turn:action");
    expect(handIds(done).sort()).toEqual([BRUTE, ITEM].sort());
    expect(all(events, "CARDS_DRAWN")).toEqual([]);
  });

  it("a short deck draws what it holds", () => {
    const { state: ready, uid } = staged(gwynnBoard({ [PLAIN]: 2 }), GWYNN);
    const parked = mustApply(trimDeckTo(ready, "p1", 4), { type: "playTrainer", seat: "p1", uid }).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    const done = mustApply(parked, pickCards(p.candidates)).state;
    expect(done.players.p1.deck).toEqual([]);
    expect(done.players.p1.hand).toHaveLength(4);
  });
});

describe("D617 §7 — Naveen: discard any number first, then draw until 5", () => {
  function naveenBoard(cards: number): GameState {
    let state = board(PLAIN, []);
    if (cards > 0) state = handFromDeck(state, "p1", ITEM, Math.min(cards, 4));
    if (cards > 4) state = handFromDeck(state, "p1", FILLER, cards - 4);
    return state;
  }

  it("an empty hand after the play: no prompt, 5 drawn", () => {
    const { state: done } = play(naveenBoard(0), NAVEEN);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toHaveLength(5);
  });

  it("the discard is uncapped: every card is offered and the whole hand may go; 3 kept of 4 → 1 discarded, 2 drawn", () => {
    const parked = play(naveenBoard(4), NAVEEN).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p.candidates).toHaveLength(4);
    expect([p.min, p.max]).toEqual([0, 4]);
    expect(p.note).toBe("Discard any number of cards from your hand.");
    const all4 = mustApply(revived(parked), pickCards(p.candidates)).state;
    expect(all4.players.p1.hand).toHaveLength(5);
    expect(idsOf(all4, all4.players.p1.discard).filter((id) => id === ITEM)).toHaveLength(4);
    const one = mustApply(parked, pickCards([p.candidates[0] as string])).state;
    expect(one.players.p1.hand).toHaveLength(5);
  });

  it("R-NV2 (UNRULED): a hand of 6 may keep every card — it draws 0", () => {
    const parked = play(naveenBoard(6), NAVEEN).state;
    const done = mustApply(parked, pickCards([])).state;
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("R-NV1 (UNRULED): an EMPTY deck refuses the play; one card in the deck allows it", () => {
    const base = naveenBoard(2);
    const { state: staged0, uid } = staged(base, NAVEEN);
    const empty = trimDeckTo(staged0, "p1", 0);
    const refused = applyAction(empty, { type: "playTrainer", seat: "p1", uid });
    expect(refused.ok ? "applied" : refused.error.code).toBe("PLAY_CONDITION_NOT_MET");
    if (!refused.ok) expect(refused.error.message).toBe("Naveen can only be used if you have at least 1 card in your deck");
    const one = trimDeckTo(staged0, "p1", 1);
    expect(applyAction(one, { type: "playTrainer", seat: "p1", uid }).ok).toBe(true);
  });
});

describe("D617 §8 — the new pieces off a board", () => {
  it("`yourDeckNotEmpty`: true with a card, false on an empty deck; its note", () => {
    const state = board(PLAIN, []);
    expect(conditionHolds(state, "p1", { kind: "yourDeckNotEmpty" })).toBe(true);
    expect(conditionHolds(trimDeckTo(state, "p1", 0), "p1", { kind: "yourDeckNotEmpty" })).toBe(false);
    expect(conditionNote({ kind: "yourDeckNotEmpty" })).toBe("you have at least 1 card in your deck");
  });

  it("`describeBranch` is silent on the `recorded` member (a gate branch holding it gets no caption)", () => {
    const gated = (per: Extract<EffectOp, { op: "drawCards" }>["per"]): EffectOp[] => [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "drawCards", count: 1, per }],
      },
    ];
    const noteOf = (program: EffectOp[]): string => {
      let state = board(PLAIN, []);
      state = handFromDeck(handFromDeck(state, "p1", ITEM, 1), "p1", "fix-fire-energy", 1);
      const result = runProgram(state, program, { seat: "p1" }, []);
      if (result.kind !== "parked") throw new Error("expected a park");
      return result.prompt.note;
    };
    expect(noteOf(gated({ kind: "recorded", slot: "paid" }))).toBe("Discard a card from your hand.");
    expect(noteOf(gated({ kind: "opponentBenchCount" }))).toBe(
      "Discard a card from your hand. If you do, draw a card for each of your opponent's Benched Pokémon.",
    );
  });

  it("`targetRecorded` with nothing filed offers nothing: a top-level pinned heal is a silent no-op", () => {
    // A top-level recorded heal (no producer authors one): the empty record heals nothing.
    const state = setDamage(board(BRUTE, [PLAIN]), "p1", 100);
    const result = runProgram(
      state,
      [{ op: "healChosen", amount: 80, targetRecorded: "moved" }],
      { seat: "p1" },
      [],
    );
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.active?.damage).toBe(100);
  });
});

describe("D617 §9 — the ids and the version", () => {
  it("no D617 Trainer or body reached `FIXTURE_POOL`; every keyed id is a `me` id", () => {
    for (const id of Object.keys(LOCAL)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    for (const id of ME_IDS) expect(/^me/.test(id), id).toBe(true);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.503.0");
  });
});
