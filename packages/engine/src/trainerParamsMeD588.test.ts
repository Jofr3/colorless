import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
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
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
  toDeckTop,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D588 — WP22: TRAINER PARAMETERS II ──
//
// 17 `me` Trainer printings / 8 printed texts, each a built program (or a derived sentence) at the
// printed parameter, plus ONE new rider (`AttachTargetRiders.stage2Only`, Rosa's Encouragement).
// Measured on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-07,
// `legal_standard = 1` on every row. No `me` row is a fixture, so the printed bytes are carried
// HERE. Driven on the real ids in a LOCAL `cardPool` (D275), so no `fix-*` key is owed. Pokémon
// Center Lady `me01-123` is NOT keyed (its "it recovers from all Special Conditions" needs a
// `healChosen` rider on the healed body — vocabulary beyond the brief); §12 pins it unbuilt.

const CANARI = "me02.5-185";
const LILLIE = "me01-119";
const MISTY = "me05-080";
const ROSA = "me03-084";
const GRUNT = "me05-081";
const WAITRESS = "me02.5-215";
const SHOVEL = "me03-074";
const GALETTE = "me03-078";
const CENTER_LADY = "me01-123";

/** [me ids, card name, trainer type, printed text]. */
const TEXTS: readonly (readonly [readonly string[], string, string, string])[] = [
  [
    [CANARI, "me02.5-257", "me02.5-291"],
    "Canari",
    "Supporter",
    "You can use this card only if you discard another card from your hand.\n\nSearch your deck for up to 4 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    [LILLIE, "me01-169", "me01-184", "me02.5-192"],
    "Lillie's Determination",
    "Supporter",
    "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead.",
  ],
  [
    [MISTY, "me05-111"],
    "Misty's Vitality",
    "Supporter",
    "Search your deck for up to 4 Basic {W} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. Your turn ends.",
  ],
  [
    [ROSA, "me03-114", "me03-123"],
    "Rosa's Encouragement",
    "Supporter",
    "You can use this card only if you have more Prize cards remaining than your opponent.\n\nAttach up to 2 Basic Energy cards from your discard pile to 1 of your Stage 2 Pokémon.",
  ],
  [
    [GRUNT, "me05-112"],
    "Rust Syndicate Grunt",
    "Supporter",
    "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nDiscard an Energy from 1 of your opponent's Pokémon.",
  ],
  [
    [WAITRESS],
    "Waitress",
    "Supporter",
    "Look at the top 6 cards of your deck and attach a Basic Energy card you find there to 1 of your Pokémon. Shuffle the other cards back into your deck.",
  ],
  [[SHOVEL], "Hole-Digging Shovel", "Item", "Discard the top 2 cards of your deck."],
  [
    [GALETTE],
    "Lumiose Galette",
    "Item",
    "Heal 20 damage and remove a Special Condition from your Active Pokémon.",
  ],
];

const ME_IDS = TEXTS.flatMap(([ids]) => ids);
const text = (id: string) => TEXTS.find(([ids]) => ids.includes(id))?.[3] ?? "";
const paragraph = (id: string, n: number) => text(id).split("\n\n")[n] ?? "";

describe("D588 §1 — the faces: 17 `me` printings / 8 texts, one object per text", () => {
  it("8 texts / 17 printings, no id twice, Pokémon Center Lady not among them", () => {
    expect(TEXTS).toHaveLength(8);
    expect(ME_IDS).toHaveLength(17);
    expect(new Set(ME_IDS).size).toBe(17);
    expect(ME_IDS).not.toContain(CENTER_LADY);
  });

  it("every printing of a text shares ONE object, distinct from every other text's", () => {
    const objects = new Set<unknown>();
    for (const [ids] of TEXTS) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      objects.add(program);
    }
    expect(objects.size).toBe(8);
  });

  it("the derived sentences: each program's effect IS what `deriveAttackEffect` reads off its print", () => {
    expect(programFor(CANARI)?.trainer?.slice(1)).toEqual(deriveAttackEffect(paragraph(CANARI, 1)));
    expect(programFor(MISTY)?.trainer).toEqual(
      deriveAttackEffect(text(MISTY).replace(" Your turn ends.", "")),
    );
    expect(programFor(SHOVEL)?.trainer).toEqual(deriveAttackEffect(text(SHOVEL)));
    // Oricorio "Energy Assist"'s untyped `count: 2` attach, with the NEW rider for "Stage 2".
    expect(programFor(ROSA)?.trainer).toEqual([
      {
        ...deriveAttackEffect(paragraph(ROSA, 1).replace("Stage 2 Pokémon", "Pokémon"))?.[0],
        stage2Only: true,
      },
    ]);
  });
});

describe("D588 §2 — the registry: each twin's op at the printed parameter", () => {
  it("Canari = Earthen Vessel's hand cost over a {L} Pokémon search at 4", () => {
    const vessel = programFor("sv06.5-096")?.trainer ?? [];
    expect(programFor(CANARI)?.trainer).toEqual([
      vessel[0],
      { ...vessel[1], filter: { kind: "typedPokemon", pokemonType: "Lightning" }, max: 4 },
      vessel[2],
    ]);
    expect(Object.keys(programFor(CANARI) ?? {})).toEqual(["trainer"]);
  });

  it("Lillie's Determination = Lacey's if/else on `yourPrizesRemaining` exactly 6, drawing 8 else 6", () => {
    const lacey = JSON.stringify(programFor("sv07-139")?.trainer);
    expect(JSON.stringify(programFor(LILLIE)?.trainer)).toBe(
      lacey
        .split('{"kind":"opponentPrizesRemaining","counts":[0,1,2,3]}')
        .join('{"kind":"yourPrizesRemaining","counts":[6]}')
        .split('"count":4')
        .join('"count":6'),
    );
  });

  it("Misty's Vitality ends the turn (Boxed Order's flag); Rosa and the Grunt carry their twins' play gates", () => {
    expect(programFor(MISTY)?.trainerEndsTurn).toBe(true);
    expect(programFor("sv05-143")?.trainerEndsTurn).toBe(true);
    expect(programFor(ROSA)?.trainerPlayableIf).toEqual(programFor("sv02-181")?.trainerPlayableIf);
    expect(programFor(ROSA)?.trainerPlayableIf).toEqual({ kind: "morePrizesThanOpponent" });
    expect(programFor(GRUNT)?.trainerPlayableIf).toEqual(programFor("sv06-151")?.trainerPlayableIf);
    expect(programFor(GRUNT)?.trainerPlayableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
  });

  it("the Grunt = Crushing Hammer's heads op without the coin", () => {
    const hammer = programFor("sv01-168")?.trainer?.[0] as { then: unknown[] };
    expect(programFor(GRUNT)?.trainer).toEqual(hammer.then);
  });

  it("Waitress = Electric Generator's look at 6 / 1, any Basic Energy, to any of your Pokémon", () => {
    const generator = programFor("sv01-170")?.trainer ?? [];
    const { targetType: _type, benchOnly: _bench, ...look } = generator[0] as {
      targetType?: string;
      benchOnly?: true;
    };
    expect(programFor(WAITRESS)?.trainer).toEqual([
      { ...look, n: 6, filter: { kind: "basicEnergy" }, max: 1 },
      generator[1],
    ]);
  });

  it("Lumiose Galette = Indeedee \"Obliging Heal\"'s program at 20", () => {
    const heal = programFor("sv08-093")?.triggered?.[0]?.program ?? [];
    expect(programFor(GALETTE)?.trainer).toEqual([{ ...heal[0], amount: 20 }, heal[1]]);
  });
});

// ── ON A BOARD ──

const MON_L = "d588-lightning";
const MON_L2 = "d588-lightning-stage1";
const MON_W = "d588-water";
const BASIC = "d588-basic";
const S1 = "d588-stage1";
const S2 = "d588-stage2";
const FILLER = "d588-filler";

const trainer = (id: string): Card => {
  const row = TEXTS.find(([ids]) => ids.includes(id));
  return { ...trainerCard(id, row?.[2] ?? "Item", row?.[3] ?? ""), name: row?.[1] ?? id };
};
const mon = (id: string, name: string, type: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 200,
    types: [type],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    ...extra,
  });

const PLAYED = [CANARI, LILLIE, MISTY, ROSA, GRUNT, WAITRESS, SHOVEL, GALETTE];
const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(PLAYED.map((id) => [id, trainer(id)])),
  [MON_L]: mon(MON_L, "D588 Lightning", "Lightning"),
  [MON_L2]: mon(MON_L2, "D588 Lightning Stage 1", "Lightning", {
    stage: "Stage1",
    evolveFrom: "D588 Lightning",
  }),
  [MON_W]: mon(MON_W, "D588 Water", "Water"),
  [BASIC]: mon(BASIC, "D588 Basic", "Colorless"),
  [S1]: mon(S1, "D588 Stage 1", "Colorless", { stage: "Stage1", evolveFrom: "D588 Basic" }),
  [S2]: mon(S2, "D588 Stage 2", "Colorless", { stage: "Stage2", evolveFrom: "D588 Stage 1" }),
  [FILLER]: mon(FILLER, "D588 Filler", "Colorless", { hp: 400 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  ...Object.fromEntries(PLAYED.map((id) => [id, 1])),
  [MON_L]: 3,
  [MON_L2]: 2,
  [MON_W]: 2,
  [BASIC]: 3,
  [S1]: 2,
  [S2]: 3,
  [FILLER]: 10,
  "fix-water-energy": 6,
  "fix-fire-energy": 9,
  "fix-psychic-energy": 6,
  "fix-energy": 6, // the prize row (p1Turn), so every card the boards pull stays in the deck
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own turn (P2 went first and passed); both hands emptied into the deck and the
    six `fix-energy` cards made each prize row. The surgery never depends on the deal. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5888, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
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

/** P1's Active is `active` and P1's Bench is exactly `bench`; P2's Active is a Filler, no Bench. */
function board(active: string, bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => idOf(state, u));

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function staged(state: GameState, id: string): { state: GameState; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  return { state: next, uid: next.players.p1.hand.find((u) => idOf(next, u) === id) as string };
}
/** `id` from P1's deck into the hand, then played. */
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const { state: next, uid } = staged(state, id);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid });
}
function refused(state: GameState, id: string, code: "NO_LEGAL_TARGET" | "PLAY_CONDITION_NOT_MET"): void {
  const { state: next, uid } = staged(state, id);
  expectErr(next, { type: "playTrainer", seat: "p1", uid }, code);
}

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const bench = (index: number, seat: Seat = "p1") => ({ seat, spot: { spot: "bench", index } }) as const;
const pick = (ref: unknown, take?: number): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }) as GameAction;
const cards = (uids: readonly string[]): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "cards", uids: [...uids] },
});
const assign = (pairs: readonly (readonly [string, unknown])[]): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments: pairs.map(([uid, to]) => ({ uid, to })) },
  }) as GameAction;

describe("D588 §3 — Canari: discard another card, then up to 4 {L} Pokémon from the deck", () => {
  it("asks for the hand cost first (never Canari itself), then offers {L} Pokémon of any stage at 4", () => {
    // Two DIFFERENT cards, so the cost is a decision (one card, or two copies, is paid inline).
    const withCost = handFromDeck(handFromDeck(board(FILLER, []), "p1", "fix-fire-energy", 1), "p1", "fix-water-energy", 1);
    const cost = withCost.players.p1.hand[0] as string;
    const { state: parked } = play(withCost, CANARI);
    const pay = prompt(parked);
    if (pay.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${pay.kind}`);
    expect(pay).toMatchObject({ min: 1, max: 1 });
    expect([...pay.candidates].sort()).toEqual([...withCost.players.p1.hand].sort());
    const searching = mustApply(parked, cards([cost])).state;
    expect(searching.players.p1.discard).toContain(cost);
    const p = prompt(searching);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 0, max: 4, dest: "hand" });
    expect(new Set(ids(searching, p.candidates))).toEqual(new Set([MON_L, MON_L2]));
    expect(p.candidates).toHaveLength(5);
    const take = p.candidates.slice(0, 4);
    const { state: done, events } = mustApply(searching, cards(take));
    for (const uid of take) expect(done.players.p1.hand).toContain(uid);
    expect(all(events, "DECK_SEARCHED")).toMatchObject([{ seat: "p1", dest: "hand", reveal: true }]);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("a hand with no other card refuses the Supporter", () => {
    const { state: next, uid } = staged(board(FILLER, []), CANARI);
    const result = applyAction(next, { type: "playTrainer", seat: "p1", uid });
    expect(result.ok ? "applied" : result.error.code).toBe("PLAY_CONDITION_NOT_MET");
  });
});

describe("D588 §4 — Lillie's Determination: refresh, 8 at exactly 6 Prizes remaining, else 6", () => {
  it("6 Prizes remaining draws 8; 5 draws 6; the hand is shuffled back first", () => {
    const six = handFromDeck(board(FILLER, []), "p1", "fix-fire-energy", 2);
    const { state: done, events } = play(six, LILLIE);
    expect(done.players.p1.prizes).toHaveLength(6);
    expect(done.players.p1.hand).toHaveLength(8);
    expect(all(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject([{ seat: "p1", count: 2 }]);
    const five = play(handFromDeck(setPrizes(board(FILLER, []), "p1", 5), "p1", "fix-fire-energy", 2), LILLIE).state;
    expect(five.players.p1.hand).toHaveLength(6);
  });
});

describe("D588 §5 — Misty's Vitality: up to 4 Basic {W} onto ONE body, then the turn ends", () => {
  it("offers Basic {W} Energy only at a ceiling of 4, all onto one body, and passes the turn", () => {
    const { state: parked } = play(board(MON_W, [BASIC]), MISTY);
    expect(parked.phase.kind === "effect:choose" && parked.phase.endsTurn).toBe(true);
    const p = prompt(parked);
    if (p.kind !== "attachCards") throw new Error(`expected attachCards, got ${p.kind}`);
    expect(p).toMatchObject({ max: 4, oneTarget: true });
    expect(new Set(ids(parked, p.candidates))).toEqual(new Set(["fix-water-energy"]));
    expect(p.targets).toEqual([ACTIVE, bench(0)]);
    const four = p.candidates.slice(0, 4);
    const { state: done, events } = mustApply(parked, assign(four.map((u) => [u, bench(0)])));
    expect(ids(done, done.players.p1.bench[0]?.energy ?? [])).toEqual(Array(4).fill("fix-water-energy"));
    expect(done.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("\"to 1 of your Pokémon\": a split over two bodies is refused", () => {
    const { state: parked } = play(board(MON_W, [BASIC]), MISTY);
    const p = prompt(parked);
    if (p.kind !== "attachCards") throw new Error(`expected attachCards, got ${p.kind}`);
    const [a, b] = p.candidates as [string, string];
    expect(applyAction(parked, assign([[a, ACTIVE], [b, bench(0)]])).ok).toBe(false);
  });
});

describe("D588 §6 — Rosa's Encouragement: behind on Prizes, up to 2 Basic Energy to 1 Stage 2", () => {
  function rosaBoard(): GameState {
    let state = board(BASIC, [S1, S2, FILLER]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 2);
    return setPrizes(state, "p2", 5);
  }

  it("offers the Stage 2 body only, captions the stage word, and puts up to 2 Basic Energy on it", () => {
    const parked = play(rosaBoard(), ROSA).state;
    const p = prompt(parked);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([bench(1)]);
    expect(p.upTo).toBe(2);
    expect(p.note).toBe("Attach up to 2 Energy to which of your Stage 2 Pokémon?");
    const done = mustApply(parked, pick(bench(1))).state;
    expect(done.players.p1.bench[1]?.energy).toHaveLength(2);
    expect(done.players.p1.discard.filter((u) => /energy/.test(idOf(done, u) ?? ""))).toHaveLength(1);
    const one = mustApply(parked, pick(bench(1), 1)).state;
    expect(one.players.p1.bench[1]?.energy).toHaveLength(1);
  });

  it("refused when not behind on Prizes, with no Stage 2 in play, and with no Basic Energy in the discard", () => {
    refused(setPrizes(rosaBoard(), "p1", 5), ROSA, "PLAY_CONDITION_NOT_MET"); // 5 against 5: not "more"
    let noStage2 = board(BASIC, [S1]);
    noStage2 = setPrizes(discardFromDeck(noStage2, "p1", "fix-fire-energy", 1), "p2", 5);
    refused(noStage2, ROSA, "NO_LEGAL_TARGET");
    refused(setPrizes(board(BASIC, [S2]), "p2", 5), ROSA, "NO_LEGAL_TARGET");
  });
});

describe("D588 §7 — Rust Syndicate Grunt: after a KO last turn, an Energy off 1 opponent body", () => {
  function gruntBoard(): GameState {
    let state = benchFromDeck(board(FILLER, []), "p2", BASIC);
    state = attachFromDeck(state, "p2", "fix-fire-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", 1);
    return { ...state, lastKoTurn: { ...state.lastKoTurn, p1: state.turn - 1 } };
  }

  it("offers the opponent's Energy on every body and discards the one picked", () => {
    const parked = play(gruntBoard(), GRUNT).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.answerer ?? "p1").toBe("p1");
    const p = parked.phase.prompt;
    if (p.kind !== "discardEnergy") throw new Error(`expected discardEnergy, got ${p.kind}`);
    expect(p.discardable.map((d) => [idOf(parked, d.uid), d.from])).toEqual([
      ["fix-fire-energy", { seat: "p2", spot: { spot: "active" } }],
      ["fix-water-energy", bench(0, "p2")],
    ]);
    const water = p.discardable[1]?.uid as string;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [water] },
    }).state;
    expect(done.players.p2.discard).toContain(water);
    expect(done.players.p2.bench[0]?.energy).toEqual([]);
    expect(done.players.p2.active?.energy).toHaveLength(1);
  });

  it("refused with no KO last turn, and on an Energy-less opponent board", () => {
    const state = gruntBoard();
    refused({ ...state, lastKoTurn: { ...state.lastKoTurn, p1: null } }, GRUNT, "PLAY_CONDITION_NOT_MET");
    const bare = board(FILLER, []);
    refused({ ...bare, lastKoTurn: { ...bare.lastKoTurn, p1: bare.turn - 1 } }, GRUNT, "NO_LEGAL_TARGET");
  });
});

describe("D588 §8 — Waitress: look at the top 6, attach a Basic Energy to 1 of your Pokémon", () => {
  it("offers only the Basic Energy in the top 6, at most 1, to any own body, then shuffles", () => {
    let state = board(BASIC, [S1]);
    state = toDeckTop(state, "p1", "fix-psychic-energy", 1); // the 7th card: outside the window
    state = toDeckTop(state, "p1", FILLER, 4);
    state = toDeckTop(state, "p1", "fix-fire-energy", 2);
    const window = state.players.p1.deck.slice(0, 6);
    const { state: parked } = play(state, WAITRESS);
    const p = prompt(parked);
    if (p.kind !== "attachCards") throw new Error(`expected attachCards, got ${p.kind}`);
    expect(p.max).toBe(1);
    expect(p.candidates).toEqual(window.filter((u) => idOf(state, u) === "fix-fire-energy"));
    expect(p.targets).toEqual([ACTIVE, bench(0)]);
    const { state: done, events } = mustApply(parked, assign([[p.candidates[0] as string, bench(0)]]));
    expect(ids(done, done.players.p1.bench[0]?.energy ?? [])).toEqual(["fix-fire-energy"]);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });
});

describe("D588 §9 — Hole-Digging Shovel: discard the top 2 cards of your deck", () => {
  it("the top 2, in deck order, into the discard; nothing parks", () => {
    const state = board(BASIC, []);
    const top = state.players.p1.deck.slice(0, 3);
    const { state: done } = play(state, SHOVEL);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.discard.slice(-2)).toEqual(top.slice(0, 2));
    expect(done.players.p1.deck[0]).toBe(top[2]);
  });
});

describe("D588 §10 — Lumiose Galette: heal 20 and remove a Special Condition from your Active", () => {
  it("heals 20 off the Active (not the Bench) and clears its one condition", () => {
    let state = setDamage(board(BASIC, [S1]), "p1", 50);
    state = setConditions(state, "p1", { burned: true });
    const done = play(state, GALETTE).state;
    expect(done.players.p1.active?.damage).toBe(30);
    expect(done.players.p1.active?.conditions.burned).toBe(false);
  });

  it("two conditions: the player picks which ONE comes off", () => {
    let state = setDamage(board(BASIC, []), "p1", 10);
    state = setConditions(state, "p1", { burned: true, poisonDamage: 10 });
    const parked = play(state, GALETTE).state;
    expect(parked.players.p1.active?.damage).toBe(0);
    const p = prompt(parked);
    expect(p.note).toBe("Your Active Pokémon recovers from a Special Condition. Which one?");
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    } as GameAction).state;
    const c = done.players.p1.active?.conditions;
    expect([c?.burned, (c?.poisonDamage ?? 0) > 0].filter(Boolean)).toHaveLength(1);
  });
});

describe("D588 §11 — `stage2Only` reads the printed stage word, not the chain depth", () => {
  it("a Stage 1 and a Basic are never offered; every Stage 2 on the board is", () => {
    let state = board(S2, [S1, S2, BASIC]);
    state = setPrizes(discardFromDeck(state, "p1", "fix-fire-energy", 2), "p2", 4);
    const p = prompt(play(state, ROSA).state);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([ACTIVE, bench(1)]);
  });
});

describe("D588 §12 — the ids: real `me` ids in a LOCAL pool; Pokémon Center Lady stays unbuilt", () => {
  it("no D588 Trainer or body reached `FIXTURE_POOL`, and `me01-123` has no program", () => {
    for (const id of Object.keys(LOCAL)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    for (const id of ME_IDS) expect(/^me/.test(id), id).toBe(true);
    expect(programFor(CENTER_LADY)).toBeUndefined();
  });
});
