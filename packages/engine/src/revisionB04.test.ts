import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
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
  trainerCard,
  must,
  effectPrompt,
} from "./testFixtures";

const RARE_CANDY_TEXT =
  "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.";
const SWITCH_TEXT = "Switch your Active Pokémon with 1 of your Benched Pokémon.";
const ULTRA_BALL_TEXT =
  "You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const SHOVEL_TEXT = "Discard the top 2 cards of your deck.";

const RARE_CANDY_IDS = ["sv01-191", "sv04.5-089"] as const;
const SWITCH_IDS = ["sv01-194", "sv03.5-206", "mfb-34", "30th-127"] as const;
const ULTRA_BALL_IDS = ["sv01-196", "sv04.5-091", "30th-128"] as const;
const POKE_PAD_IDS = ["me02.5-198", "30th-126"] as const;
const SHOVEL = "me03-074";
const TEXTLESS = new Set(["30th-126", "30th-127", "30th-128"]);

const ABRA = "b04-abra";
const KADABRA = "b04-kadabra";
const ALAKAZAM = "b04-alakazam";
const EX = "b04-ex";
const FILLER = "b04-filler";

const mon = (id: string, name: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    ...extra,
  });
const item = (id: string, name: string, text: string): Card => {
  const face = { ...trainerCard(id, "Item", text), name };
  return TEXTLESS.has(id) ? { ...face, effect: null } : face;
};

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(RARE_CANDY_IDS.map((id) => [id, item(id, "Rare Candy", RARE_CANDY_TEXT)])),
  ...Object.fromEntries(SWITCH_IDS.map((id) => [id, item(id, "Switch", SWITCH_TEXT)])),
  ...Object.fromEntries(ULTRA_BALL_IDS.map((id) => [id, item(id, "Ultra Ball", ULTRA_BALL_TEXT)])),
  ...Object.fromEntries(
    POKE_PAD_IDS.map((id) => [
      id,
      item(
        id,
        "Poké Pad",
        "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
      ),
    ]),
  ),
  [SHOVEL]: item(SHOVEL, "Hole-Digging Shovel", SHOVEL_TEXT),
  [ABRA]: mon(ABRA, "B04 Abra"),
  [KADABRA]: mon(KADABRA, "B04 Kadabra", { stage: "Stage1", evolveFrom: "B04 Abra" }),
  [ALAKAZAM]: mon(ALAKAZAM, "B04 Alakazam", { stage: "Stage2", evolveFrom: "B04 Kadabra" }),
  [EX]: mon(EX, "B04 Pikachu ex"), // a Rule Box by its name (Poké Pad must not offer it)
  [FILLER]: mon(FILLER, "B04 Filler", { hp: 400 }),
};

/** The deck both seats run. The Stage 1 is in it only when `withStage1` — §3's whole question. */
function deck(withStage1: boolean): string[] {
  return deckOf({
    ...Object.fromEntries(
      [...RARE_CANDY_IDS, ...SWITCH_IDS, ...ULTRA_BALL_IDS, ...POKE_PAD_IDS, SHOVEL].map((id) => [
        id,
        1,
      ]),
    ),
    [ABRA]: 4,
    ...(withStage1 ? { [KADABRA]: 1 } : {}),
    [ALAKAZAM]: 2,
    [EX]: 2,
    [FILLER]: 10,
    "fix-energy": withStage1 ? 29 : 30, // 60 cards
  });
}

/** Setup with P1 first, then P1's SECOND turn (turn 3 — Rare Candy's "first turn" ban is past).
    `pool` is the engine `cardPool`; its keys beyond the decks' ids are what §3 varies. */
function p1Turn(pool: Record<string, Card>, withStage1 = true): GameState {
  const created = createGame({
    seed: 404,
    decks: { p1: deck(withStage1), p2: deck(withStage1) },
    cardPool: pool,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => pool[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 3) throw new Error(`expected turn 3, got ${state.turn}`);
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: {
          ...side,
          hand: [],
          discard: [],
          prizes,
          deck: pile.filter((u) => !prizes.includes(u)),
        },
      },
    };
  }
  return state;
}

/** P1's Active is a Filler and the Bench is `bench` (benched on an earlier turn); P2 a Filler. */
function board(
  bench: readonly string[],
  pool: Record<string, Card> = POOL,
  withStage1 = true,
): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(pool, withStage1), "p1", FILLER), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  // Every body counts as put into play before this turn (Rare Candy's "put into play this turn").
  const p1 = state.players.p1;
  const earlier = (b: NonNullable<typeof p1.active>) => ({ ...b, turnPlayed: 1 });
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...p1, active: p1.active && earlier(p1.active), bench: p1.bench.map(earlier) },
    },
  };
}

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];
const handOf = (state: GameState, id: string) =>
  state.players.p1.hand.find((u) => idOf(state, u) === id) as string;

function play(
  state: GameState,
  id: string,
): { state: GameState; events: GameEvent[]; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = handOf(next, id);
  return { ...mustApply(next, { type: "playTrainer", seat: "p1", uid }), uid };
}
const answer = (choice: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice }) as GameAction;

describe("B04 §1/§2 — every Standard-legal printing of Rare Candy, Switch, Ultra Ball and Poké Pad runs its twin's program", () => {
  it("each printing resolves to the SAME program object as its authored twin", () => {
    for (const ids of [RARE_CANDY_IDS, SWITCH_IDS, ULTRA_BALL_IDS, POKE_PAD_IDS]) {
      const twin = programFor(ids[0]);
      expect(twin, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(twin);
    }
  });

  it.each(["sv04.5-089"])("Rare Candy %s evolves a Basic in play straight to its Stage 2", (id) => {
    let state = board([ABRA]);
    state = handFromDeck(handFromDeck(state, "p1", id, 1), "p1", ALAKAZAM, 1);
    const abra = state.players.p1.bench[0]?.stack[0];
    const candy = handOf(state, id);
    const zam = handOf(state, ALAKAZAM);
    const { state: done } = mustApply(state, {
      type: "rareCandy",
      seat: "p1",
      uid: candy,
      target: { spot: "bench", index: 0 },
      evolutionUid: zam,
    });
    expect(done.players.p1.bench[0]?.stack).toEqual([abra, zam]);
    expect(done.players.p1.discard).toEqual([candy]);
  });

  it.each(["sv03.5-206", "mfb-34", "30th-127"])(
    "Switch %s: the Active and the chosen Benched Pokémon trade places",
    (id) => {
      const state = board([ABRA, EX]);
      const active = state.players.p1.active?.stack[0];
      const ex = state.players.p1.bench[1]?.stack[0];
      const parked = play(state, id).state;
      expect(effectPrompt(parked)).toMatchObject({ kind: "choosePokemon" });
      const done = mustApply(
        parked,
        answer({ kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } }),
      ).state;
      expect(done.phase.kind).toBe("turn:action");
      expect(done.players.p1.active?.stack[0]).toBe(ex);
      expect(done.players.p1.bench.map((b) => b.stack[0])).toContain(active);
      expect(done.players.p1.discard.map((u) => idOf(done, u))).toEqual([id]);
    },
  );

  it.each(["sv04.5-091", "30th-128"])(
    "Ultra Ball %s: discard 2 other cards, then a Pokémon from the deck to the hand",
    (id) => {
      // Exactly 2 other cards in the hand: the cost is the whole hand, so it is paid with no prompt.
      const state = play(handFromDeck(board([]), "p1", "fix-energy", 2), id).state;
      expect(state.players.p1.hand).toEqual([]);
      const search = effectPrompt(state);
      if (search.kind !== "chooseCards")
        throw new Error(`expected chooseCards, got ${search.kind}`);
      expect(search).toMatchObject({ min: 0, max: 1 });
      const pick = search.candidates.find((u) => idOf(state, u) === EX) as string;
      const done = mustApply(state, answer({ kind: "cards", uids: [pick] })).state;
      expect(done.phase.kind).toBe("turn:action");
      expect(done.players.p1.hand).toEqual([pick]);
      expect(done.players.p1.discard.map((u) => idOf(done, u)).sort()).toEqual(
        [id, "fix-energy", "fix-energy"].sort(),
      );
    },
  );

  it("Poké Pad 30th-126: a Pokémon without a Rule Box from the deck to the hand (an ex is not offered)", () => {
    const parked = play(board([]), "30th-126").state;
    const search = effectPrompt(parked);
    if (search.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${search.kind}`);
    const offered = new Set(search.candidates.map((u) => idOf(parked, u)));
    expect(offered.has(EX)).toBe(false);
    expect(offered.has(ABRA)).toBe(true);
    const pick = search.candidates.find((u) => idOf(parked, u) === ABRA) as string;
    const done = mustApply(parked, answer({ kind: "cards", uids: [pick] })).state;
    expect(done.players.p1.hand).toEqual([pick]);
  });
});

describe("B04 §3 — Rare Candy with no copy of the Stage 1 in either deck (DEFERRED: the pool builders)", () => {
  /** P1 benches Abra (played on an earlier turn) and holds Rare Candy + Alakazam; nobody runs a
      Kadabra. The Kadabra face IS in the pool handed to `createGame`. */
  function noStage1Board() {
    let state = board([ABRA], POOL, false);
    state = handFromDeck(handFromDeck(state, "p1", "sv01-191", 1), "p1", ALAKAZAM, 1);
    const action: GameAction = {
      type: "rareCandy",
      seat: "p1",
      uid: handOf(state, "sv01-191"),
      target: { spot: "bench", index: 0 },
      evolutionUid: handOf(state, ALAKAZAM),
    };
    return { state, action };
  }

  it("KNOWN GAP: createGame keeps only the decks' ids, so Alakazam cannot be linked to Abra and the play is refused", () => {
    const { state, action } = noStage1Board();
    // The caller's pool held the Kadabra face; the match's pool does not (setup.ts prunes to the decks).
    expect(POOL[KADABRA]?.stage).toBe("Stage1");
    expect(state.cardPool[KADABRA]).toBeUndefined();
    const result = applyAction(state, action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RARE_CANDY_NO_STAGE2");
  });

  it("the link is a POOL fact only: the Stage 1 face in the match pool, in no zone, makes the same play legal", () => {
    const { state: bare, action } = noStage1Board();
    const state: GameState = {
      ...bare,
      cardPool: { ...bare.cardPool, [KADABRA]: POOL[KADABRA] as Card },
    };
    // No uid anywhere in the match is a Kadabra: the face is in the pool and nowhere else.
    expect(Object.values(state.cardIdByUid)).not.toContain(KADABRA);
    const done = mustApply(state, action).state;
    expect(done.players.p1.bench[0]?.stack.map((u) => idOf(done, u))).toEqual([ABRA, ALAKAZAM]);
  });
});

describe("B04 §4 — Hole-Digging Shovel: an empty deck refuses the Item", () => {
  /** P1's deck is exactly `left` cards (the rest moved to the discard, so they are out of reach). */
  function withDeck(left: number): GameState {
    const state = board([]);
    const side = state.players.p1;
    const shovel = side.deck.find((u) => idOf(state, u) === SHOVEL) as string;
    const rest = side.deck.filter((u) => u !== shovel);
    return {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, hand: [shovel], deck: rest.slice(0, left), discard: rest.slice(left) },
      },
    };
  }
  const playShovel = (state: GameState) =>
    applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: state.players.p1.hand[0] as string,
    });

  it("deck = 0: refused NO_LEGAL_TARGET, the Shovel stays in the hand", () => {
    const state = withDeck(0);
    const result = playShovel(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("deck = 1: played, the one card is discarded (as many as there are)", () => {
    const state = withDeck(1);
    const top = state.players.p1.deck[0];
    const result = playShovel(state);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.players.p1.deck).toEqual([]);
    expect(result.state.players.p1.discard).toContain(top);
    expect(result.state.players.p1.discard).toContain(state.players.p1.hand[0]);
  });

  it("deck = 5: the top 2 are discarded, 3 remain", () => {
    const state = withDeck(5);
    const top2 = state.players.p1.deck.slice(0, 2);
    const result = playShovel(state);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.players.p1.deck).toEqual(state.players.p1.deck.slice(2));
    for (const u of top2) expect(result.state.players.p1.discard).toContain(u);
  });
});
