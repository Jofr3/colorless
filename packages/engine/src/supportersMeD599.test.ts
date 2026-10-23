import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { CATALOG_MANIFEST } from "./catalogManifest";
import type { EffectOp } from "./effects";
import { applyAction } from "./index";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  trainerCard,
  must,
  driveSetup,
} from "./testFixtures";

const ANTHEA = "me02.5-182";
const EMMA = "me04-077";

/** [me ids, card name, printed text]. */
const TEXTS: readonly (readonly [readonly string[], string, string])[] = [
  [
    [ANTHEA, "me02.5-254"],
    "Anthea & Concordia",
    "You can use this card only if you have N's Darmanitan, N's Zoroark ex, N's Vanilluxe, N's Klinklang, N's Reshiram, and N's Zekrom in play.\n\nDuring this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your N's Pokémon, take 3 more Prize cards.",
  ],
  [
    [EMMA, "me04-107"],
    "Emma",
    "Your opponent reveals their hand, and you draw a card for each Pokémon you find there.",
  ],
];

const NOT_KEYED: Readonly<Record<string, readonly string[]>> = {
  "AZ's Tranquility": ["me04-076", "me04-106", "me04-120"],
  "Gladion's Final Battle": ["me05-077", "me05-108", "me05-118"],
  "Grimsley's Move": ["me02-090", "me02-120"],
  Gwynn: ["me05-078", "me05-109", "me05-119"],
  Naveen: ["me03-079", "me03-112"],
  "Acerola's Mischief": ["me01-113", "me01-165", "me01-183", "me02.5-180"],
  "Roxie's Performance": ["me04-081", "me04-112", "me04-121"],
};

const ME_IDS = TEXTS.flatMap(([ids]) => ids);

describe("D599 §1 — the faces: 4 `me` printings / 2 texts, one object per text", () => {
  it("2 texts / 4 printings, every printing of a text on ONE object, distinct across texts", () => {
    expect(ME_IDS).toHaveLength(4);
    expect(new Set(ME_IDS).size).toBe(4);
    const objects = new Set<unknown>();
    for (const [ids] of TEXTS) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      objects.add(program);
    }
    expect(objects.size).toBe(2);
  });

  it("the other 20 WP24 printings (7 texts) ~~stay unkeyed~~ ( D617 (D539): WITHDRAWN — WP24b keys 9 of them: AZ's Tranquility, Grimsley's Move, Gwynn and Naveen; ~~Gladion's Final Battle, Acerola's Mischief and Roxie's Performance stay unkeyed~~ D621 (D539): WITHDRAWN — WP24c keys those three: all 20 are keyed)", () => {
    const ids = Object.values(NOT_KEYED).flat();
    expect(ids).toHaveLength(20);
    for (const id of ids) expect(programFor(id), id).toBeDefined();
  });
});

describe("D599 §2 — the registry: Briar's shape at 3; the reveal then the per-Pokémon draw", () => {
  it("Anthea & Concordia = Briar's empty program and card-level bonus, at 3 on N's Pokémon", () => {
    const briar = programFor("sv07-132");
    expect(programFor(ANTHEA)?.trainer).toEqual(briar?.trainer);
    expect(programFor(ANTHEA)?.supporterKoPrizeBonus).toEqual({
      amount: 3,
      attacker: { kind: "ownerPokemon", owner: "N" },
    });
    expect(Object.keys(programFor(ANTHEA) ?? {}).sort()).toEqual(
      ["supporterKoPrizeBonus", "trainer", "trainerPlayableIf"].sort(),
    );
  });

  it("the play gate is the six printed names, exact, under `allOf`", () => {
    expect(programFor(ANTHEA)?.trainerPlayableIf).toEqual({
      kind: "allOf",
      conditions: SIX.map((name) => ({ kind: "yourNamedPokemonInPlay", name })),
    });
  });

  it("Emma = `revealOpponentHand`, then one card per Pokémon card in the opponent's hand", () => {
    expect(programFor(EMMA)).toEqual({
      trainer: [
        { op: "revealOpponentHand" },
        {
          op: "drawCards",
          count: 1,
          per: { kind: "cardsInOpponentHand", filter: { kind: "anyPokemon" } },
        },
      ],
    });
  });
});

// ── ON A BOARD ──

const SIX = [
  "N's Darmanitan",
  "N's Zoroark ex",
  "N's Vanilluxe",
  "N's Klinklang",
  "N's Reshiram",
  "N's Zekrom",
] as const;
const nId = (name: string) => `d599-${name.replace(/[^A-Za-z]/g, "").toLowerCase()}`;
const N_ZEKROM = nId("N's Zekrom");
const N_ZORUA = "d599-nszorua"; // an N's Pokémon NOT among the six
const PLAIN = "d599-plain";
const VICTIM = "d599-victim";
const FILLER = "d599-filler";
const FOSSIL = "sv07-129";
const ITEM = "d599-item";

const hitter = (id: string, name: string): Card =>
  battler(id, {
    name,
    hp: 200,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 30 }],
  });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    TEXTS.flatMap(([ids, name, text]) =>
      ids.map((id) => [id, { ...trainerCard(id, "Supporter", text), name }]),
    ),
  ),
  ...Object.fromEntries(SIX.map((name) => [nId(name), hitter(nId(name), name)])),
  [N_ZORUA]: hitter(N_ZORUA, "N's Zorua"),
  [PLAIN]: hitter(PLAIN, "D599 Plain"),
  [VICTIM]: battler(VICTIM, { name: "D599 Victim", hp: 30 }),
  [FILLER]: battler(FILLER, { name: "D599 Filler", hp: 300 }),
  [FOSSIL]: {
    ...trainerCard(
      FOSSIL,
      "Item",
      "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.",
    ),
    name: "Antique Cover Fossil",
    hp: CATALOG_MANIFEST.trainerFaces[FOSSIL]?.hp ?? null,
    abilities: CATALOG_MANIFEST.trainerFaces[FOSSIL]?.abilities ?? null,
  },
  [ITEM]: { ...trainerCard(ITEM, "Item", "Draw a card."), name: "D599 Item" },
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [ANTHEA]: 1,
  [EMMA]: 1,
  ...Object.fromEntries(SIX.map((name) => [nId(name), 2])),
  [N_ZORUA]: 2,
  [PLAIN]: 3,
  [VICTIM]: 2,
  [FILLER]: 11,
  [FOSSIL]: 2,
  [ITEM]: 3,
  "fix-fire-energy": 17,
  "fix-energy": 6,
});

function p1Turn(): GameState {
  let state = driveSetup(5999, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy");
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return state;
}

/** P1: `active` Active and exactly `bench` benched; P2: the 30-HP Victim Active and a Filler benched. */
function board(active: string, bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", VICTIM), "p2");
  return benchFromDeck(state, "p2", FILLER);
}
/** All six named bodies in play: N's Zekrom Active, the other five benched. */
const allSix = () => board(N_ZEKROM, SIX.filter((n) => n !== "N's Zekrom").map(nId));

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
function staged(state: GameState, id: string): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  return {
    state: next,
    uid: next.players.p1.hand.find((u) => next.cardIdByUid[u] === id) as string,
  };
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
/** The Active (re)powered with one {C} and attacking with "Tap" (30) into the 30-HP Victim. */
function tap(state: GameState): { state: GameState; events: GameEvent[] } {
  return mustApply(attachFromDeck(state, "p1", "fix-fire-energy", 1), {
    type: "attack",
    seat: "p1",
    index: 0,
  });
}

describe("D599 §3 — Anthea & Concordia's play gate: all six named Pokémon in play", () => {
  it("playable with the six in play (the Active counts)", () => {
    const { events } = play(allSix(), ANTHEA);
    expect(all(events, "TRAINER_PLAYED")).toHaveLength(1);
  });

  it("refused when ANY one of the six is missing (each name is a conjunct)", () => {
    for (const missing of SIX) {
      const rest = SIX.filter((n) => n !== missing);
      const [head, ...tail] = rest;
      const state = board(nId(head as string), [...tail.map(nId), N_ZORUA]);
      expect(refusal(state, ANTHEA), missing).toBe("PLAY_CONDITION_NOT_MET");
    }
  });
});

describe("D599 §4 — Anthea & Concordia: +3 Prizes when an N's Pokémon's attack KOs the Active", () => {
  it("N's Zekrom Knocks Out the Active: ONE PRIZE_BONUS of 3, four Prizes taken", () => {
    const played = play(allSix(), ANTHEA).state;
    const { state, events } = tap(played);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([
      expect.objectContaining({ seat: "p2", by: 3, count: 4 }),
    ]);
    expect(all(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 4 }]);
    expect(state.players.p1.prizes).toHaveLength(6); // owed, then picked
  });

  it("without Anthea & Concordia played: the one Prize alone", () => {
    const { state, events } = tap(allSix());
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
    expect(all(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("any N's Pokémon, not only the six: N's Zorua's attack pays the +3", () => {
    let state = clearBench(play(allSix(), ANTHEA).state, "p1");
    state = setActiveFromDeck(state, "p1", N_ZORUA);
    const { events } = tap(state);
    expect(all(events, "PRIZE_BONUS")).toEqual([expect.objectContaining({ by: 3, count: 4 })]);
  });

  it("a non-N attacker pays nothing", () => {
    let state = clearBench(play(allSix(), ANTHEA).state, "p1");
    state = setActiveFromDeck(state, "p1", PLAIN);
    const { events } = tap(state);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
  });

  it("R-AC1 (UNRULED): the gate is read at play only — five of the six (the whole Bench) leaving play later in the turn keeps the +3", () => {
    const state = clearBench(play(allSix(), ANTHEA).state, "p1");
    expect(state.players.p1.bench).toEqual([]);
    const { events } = tap(state);
    expect(all(events, "PRIZE_BONUS")).toEqual([expect.objectContaining({ by: 3, count: 4 })]);
  });

  it("the bonus is capped by the Prizes left: at 3 remaining all 3 are taken and the game ends (+1 would leave 1)", () => {
    const played = setPrizes(play(allSix(), ANTHEA).state, "p1", 3);
    const { state } = tap(played);
    expect(state.players.p1.prizes).toEqual([]);
    expect(state.phase.kind).toBe("gameOver");
  });
});

describe("D599 §5 — Emma: the opponent reveals their hand; draw a card per Pokémon there", () => {
  function emmaBoard(oppHand: Readonly<Record<string, number>>): GameState {
    let state = board(PLAIN, []);
    for (const [id, n] of Object.entries(oppHand)) state = handFromDeck(state, "p2", id, n);
    return state;
  }

  it("two Pokémon among four cards: the whole hand is revealed, then 2 cards drawn", () => {
    const state = emmaBoard({ [FILLER]: 1, [VICTIM]: 1, [ITEM]: 1, "fix-fire-energy": 1 });
    const oppHand = [...state.players.p2.hand];
    const deckTop = state.players.p1.deck.slice(0, 3);
    const { state: done, events } = play(state, EMMA);
    expect(all(events, "HAND_REVEALED")).toEqual([
      expect.objectContaining({ seat: "p2", uids: oppHand }),
    ]);
    expect(done.players.p1.hand).toEqual(deckTop.slice(0, 2));
    expect(done.players.p2.hand).toEqual(oppHand);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("the count is the OPPONENT's hand: Pokémon in Emma's player's own hand do not count", () => {
    let state = emmaBoard({ [FILLER]: 1 });
    state = handFromDeck(state, "p1", PLAIN, 2);
    const own = state.players.p1.hand.length;
    const { state: done } = play(state, EMMA);
    expect(done.players.p1.hand).toHaveLength(own + 1);
  });

  it("R-EM2 (UNRULED): an Antique fossil (`sv07-129`) in that hand is an Item card and is not counted", () => {
    const { state: done } = play(emmaBoard({ [FOSSIL]: 2, [VICTIM]: 1 }), EMMA);
    expect(done.players.p1.hand).toHaveLength(1);
  });

  it("R-EM1 (UNRULED): an empty or Pokémon-less opponent hand still plays — it reveals and draws 0", () => {
    const empty = play(emmaBoard({}), EMMA);
    expect(all(empty.events, "HAND_REVEALED")).toEqual([
      expect.objectContaining({ seat: "p2", uids: [] }),
    ]);
    expect(empty.state.players.p1.hand).toEqual([]);
    expect(all(empty.events, "CARDS_DRAWN")).toEqual([]);
    const none = play(emmaBoard({ [ITEM]: 2 }), EMMA);
    expect(none.state.players.p1.hand).toEqual([]);
  });
});

describe("D599 §6 — the ids: real `me` ids in a LOCAL pool", () => {
  it("no D599 Trainer or body reached `FIXTURE_POOL`", () => {
    for (const id of Object.keys(LOCAL)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    expect(CATALOG_MANIFEST.trainerFaces[FOSSIL]?.hp).toBe(60);
    for (const id of ME_IDS) expect(/^me/.test(id), id).toBe(true);
  });
});

describe("D599 §7 — `describeBranch` is silent on the new member (a gate branch holding it gets no caption)", () => {
  const gated = (per: Extract<EffectOp, { op: "drawCards" }>["per"]): EffectOp[] => [
    { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
    {
      op: "recordGate",
      slot: "paid",
      then: [{ op: "drawCards", count: 1, per }],
    },
  ];
  const noteOf = (program: EffectOp[]): string => {
    let state = board(PLAIN, []);
    state = handFromDeck(handFromDeck(state, "p1", ITEM, 1), "p1", "fix-fire-energy", 1);
    const result = runProgram(state, program, { seat: "p1" }, {}, []);
    if (result.kind !== "parked") throw new Error("expected a park");
    return result.prompt.note;
  };

  it("`cardsInOpponentHand`: the payment's own words only; the D557 member is captioned", () => {
    expect(noteOf(gated({ kind: "cardsInOpponentHand", filter: { kind: "anyPokemon" } }))).toBe(
      "Discard a card from your hand.",
    );
    expect(noteOf(gated({ kind: "opponentBenchCount" }))).toBe(
      "Discard a card from your hand. If you do, draw a card for each of your opponent's Benched Pokémon.",
    );
  });
});
