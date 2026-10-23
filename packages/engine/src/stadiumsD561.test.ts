import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { stadiumPoisonExtraCounters } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
  must,
  effectPrompt,
} from "./testFixtures";

const ACADEMY = "sv06.5-054";
const JUNGLE = "sv05-156";
const PECHARUNT = "svp-129";

const ACADEMY_TEXT =
  "Once during each player's turn, that player may put a card from their hand on top of their deck.";
const JUNGLE_TEXT =
  "During Pokémon Checkup, put 2 more damage counters on each Poisoned non-{D} Pokémon (both yours and your opponent's).";
const TOXIC_TEXT =
  "As long as this Pokémon is in the Active Spot, put 5 more damage counters on your opponent's Poisoned Pokémon during Pokémon Checkup.";

const FILLER = "d561s-filler";
const DARK = "d561s-dark";
const DUAL = "d561s-dual";
const ITEM_A = "d561s-item-a";
const ITEM_B = "d561s-item-b";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

const LOCAL_CARDS: Record<string, Card> = {
  [ACADEMY]: printed(ACADEMY, "Academy at Night", "Stadium", ACADEMY_TEXT),
  [JUNGLE]: printed(JUNGLE, "Perilous Jungle", "Stadium", JUNGLE_TEXT),
  [PECHARUNT]: battler(PECHARUNT, {
    name: "Pecharunt",
    types: ["Darkness"],
    hp: 80,
    retreat: 1,
    abilities: [{ type: "Ability", name: "Toxic Subjugation", effect: TOXIC_TEXT }],
  }),
  [FILLER]: battler(FILLER, { name: "D561 Filler", hp: 300, types: ["Colorless"] }),
  [DARK]: battler(DARK, { name: "D561 Dark", hp: 300, types: ["Darkness"] }),
  [DUAL]: battler(DUAL, { name: "D561 Dual", hp: 300, types: ["Grass", "Darkness"] }),
  [ITEM_A]: printed(ITEM_A, "D561 Item A", "Item", "A test Item."),
  [ITEM_B]: printed(ITEM_B, "D561 Item B", "Item", "A test Item."),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [ACADEMY]: 2,
  [JUNGLE]: 2,
  [PECHARUNT]: 2,
  [FILLER]: 24,
  [DARK]: 4,
  [DUAL]: 4,
  [ITEM_A]: 6,
  [ITEM_B]: 6,
  "fix-stadium": 1,
  "fix-energy": 9,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
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
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

const seatActive = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);

/** p1's turn 2 with `active` for p1 and `oppActive` for p2, both Benches EMPTY. */
function table(active: string = FILLER, oppActive: string = FILLER, seed = 5611): GameState {
  let state = opened(seed);
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  return clearBench(state, "p2");
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

/** TEST SURGERY — `seat`'s Active is Poisoned (the condition's own 10). */
function poison(state: GameState, seat: Seat): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error("no Active");
  const conditions = { ...active.conditions, poisonDamage: 10 };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...state.players[seat], active: { ...active, conditions } },
    },
  };
}

/** TEST SURGERY — `seat`'s Active is Burned. */
function burn(state: GameState, seat: Seat): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error("no Active");
  const conditions = { ...active.conditions, burned: true };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...state.players[seat], active: { ...active, conditions } },
    },
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

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const cards = (uids: readonly string[], seat: Seat = "p1"): GameAction => ({
  type: "resolveEffect",
  seat,
  choice: { kind: "cards", uids: [...uids] },
});
function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}
const checkup = (board: GameState) => mustApply(board, { type: "endTurn", seat: "p1" });
const placed = (events: readonly GameEvent[]) =>
  all(events, "COUNTERS_PLACED").map((e) => [e.seat, e.amount, e.source]);

// ────────────────────────────────────────────────────────────────────────────
describe("D561 stadiums §1 — the prints, and the registry rows that map them", () => {
  it("Academy at Night: a Stadium ability of ONE printed hand cost to the deck TOP, only a `stadium` key", () => {
    const program = programFor(ACADEMY);
    expect(program).toEqual({
      stadium: {
        ability: {
          label: "Academy at Night",
          program: [{ op: "payFromHand", count: 1, to: "deckTop" }],
        },
      },
    });
    expect(Object.keys(program ?? {})).toEqual(["stadium"]);
    expect(POOL[ACADEMY]?.trainerType).toBe("Stadium");
  });

  it("Perilous Jungle: `poisonExtraCounters { 20, excludesType Darkness }`, only a `stadium` key", () => {
    const program = programFor(JUNGLE);
    expect(program).toEqual({
      stadium: { poisonExtraCounters: { amount: 20, excludesType: "Darkness" } },
    });
    expect(Object.keys(program ?? {})).toEqual(["stadium"]);
    expect(POOL[JUNGLE]?.trainerType).toBe("Stadium");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 stadiums §2 — Perilous Jungle: +20 on each Poisoned non-{D} Pokémon, summed into ONE row (R-PJ)", () => {
  it("an opposing Poisoned Active takes 10 + 20 on ONE `COUNTERS_PLACED { poison }` row", () => {
    const { state, events } = checkup(poison(stadium(table(), JUNGLE), "p2"));
    expect(state.players.p2.active?.damage).toBe(30);
    expect(placed(events)).toEqual([["p2", 30, "poison"]]);
  });

  it("\"both yours and your opponent's\" — the Stadium's OWNER's Poisoned Active takes it too", () => {
    const { state, events } = checkup(poison(poison(stadium(table(), JUNGLE, "p2"), "p1"), "p2"));
    expect(state.players.p1.active?.damage).toBe(30);
    expect(state.players.p2.active?.damage).toBe(30);
    expect(placed(events).map(([, amount]) => amount)).toEqual([30, 30]);
  });

  it("a {D} body is exempt — the condition's own 10 and nothing more", () => {
    const { state, events } = checkup(poison(stadium(table(FILLER, DARK), JUNGLE), "p2"));
    expect(state.players.p2.active?.damage).toBe(10);
    expect(placed(events)).toEqual([["p2", 10, "poison"]]);
  });

  it("a DUAL-type body carrying {D} is exempt too — the top card's `types` ARRAY is read", () => {
    const { state } = checkup(poison(stadium(table(FILLER, DUAL), JUNGLE), "p2"));
    expect(state.players.p2.active?.damage).toBe(10);
  });

  it("with NO Stadium, or a different one, the tick is the condition's own 10", () => {
    expect(checkup(poison(table(), "p2")).state.players.p2.active?.damage).toBe(10);
    expect(
      checkup(poison(stadium(table(), "fix-stadium"), "p2")).state.players.p2.active?.damage,
    ).toBe(10);
  });

  it("an UN-Poisoned body takes nothing, and a BURNED one takes the Burn's 20 alone", () => {
    expect(placed(checkup(stadium(table(), JUNGLE)).events)).toEqual([]);
    expect(placed(checkup(burn(stadium(table(), JUNGLE), "p2")).events)).toEqual([
      ["p2", 20, "burn"],
    ]);
  });

  it("R-PJ with Pecharunt — the SUMMED poison row (30) lands FIRST, then Toxic Subjugation's 50 (D556 R7's order)", () => {
    const { state, events } = checkup(poison(stadium(table(PECHARUNT), JUNGLE), "p2"));
    expect(state.players.p2.active?.damage).toBe(80);
    expect(placed(events)).toEqual([
      ["p2", 30, "poison"],
      ["p2", 50, "ability"],
    ]);
    const order = types(events as GameEvent[]);
    expect(order.indexOf("ABILITY_TRIGGERED")).toBeGreaterThan(order.indexOf("COUNTERS_PLACED"));
    expect(order.lastIndexOf("COUNTERS_PLACED")).toBeGreaterThan(
      order.indexOf("ABILITY_TRIGGERED"),
    );
  });

  it("the scan itself: 20 for a non-{D} top card, 0 for {D}, 0 without the Stadium", () => {
    const board = stadium(table(), JUNGLE);
    expect(stadiumPoisonExtraCounters(board, POOL[FILLER])).toBe(20);
    expect(stadiumPoisonExtraCounters(board, POOL[DARK])).toBe(0);
    expect(stadiumPoisonExtraCounters(board, POOL[DUAL])).toBe(0);
    expect(stadiumPoisonExtraCounters(table(), POOL[FILLER])).toBe(0);
  });

  it("the log renders the one summed row's amount (no new row kind)", () => {
    const { state, events } = checkup(poison(stadium(table(), JUNGLE), "p2"));
    const rows = render(events, state).map((r) => r.text);
    expect(rows.some((t) => t.includes("30"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D561 stadiums §3 — Academy at Night: a hand card on top of the deck, once per player's turn (R-AN)", () => {
  const activate = (board: GameState, seat: Seat = "p1") =>
    mustApply(board, { type: "useStadiumAbility", seat });

  it("two different cards in hand: the pick PARKS (mandatory 1), and the answer goes ON TOP of the deck", () => {
    const board = setHand(stadium(table(), ACADEMY), "p1", [ITEM_A, ITEM_B]);
    const { state: parked, events } = activate(board);
    const p = effectPrompt(parked);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p).toMatchObject({
      min: 1,
      max: 1,
      dest: "deckTop",
      note: "Put a card from your hand on top of your deck.",
    });
    expect(types(events as GameEvent[])[0]).toBe("STADIUM_ABILITY_ACTIVATED");
    const chosen = board.players.p1.hand[1] as string;
    const { state, events: paid } = mustApply(parked, cards([chosen]));
    expect(state.players.p1.deck[0]).toBe(chosen);
    expect(state.players.p1.hand).toEqual([board.players.p1.hand[0]]);
    expect(state.players.p1.deck).toHaveLength(board.players.p1.deck.length + 1);
    expect(all(paid, "HAND_COST_PAID")).toEqual([
      { type: "HAND_COST_PAID", seat: "p1", uids: [chosen], to: "deckTop" },
    ]);
    expect(render(paid, state).map((r) => r.text)).toContain(
      "put 1 card from their hand on top of their deck",
    );
    expect(state.phase.kind).toBe("turn:action");
  });

  it("ONE card in hand has no decision in it: it goes on top with no park (the M1 rule)", () => {
    const board = setHand(stadium(table(), ACADEMY), "p1", [ITEM_A]);
    const only = board.players.p1.hand[0] as string;
    const { state } = activate(board);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.deck[0]).toBe(only);
    expect(state.players.p1.hand).toEqual([]);
  });

  it("R-AN — an EMPTY hand is REFUSED (the printed cost is unpayable) and the turn's one use is NOT spent", () => {
    const board = setHand(stadium(table(), ACADEMY), "p1", []);
    expectErr(board, { type: "useStadiumAbility", seat: "p1" }, "PLAY_CONDITION_NOT_MET");
    const refused = applyAction(board, { type: "useStadiumAbility", seat: "p1" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toBe(
        "Academy at Night can only be used if you put a card from your hand on top of your deck (§7.3)",
      );
    }
    const stocked = setHand(board, "p1", [ITEM_A]);
    expect(stocked.allowances).toEqual(board.allowances);
    const { state } = activate(stocked);
    expect(state.allowances.stadiumAbilityUsed).toBe(true);
    expect(state.players.p1.deck[0]).toBe(stocked.players.p1.hand[0]);
  });

  it("R-AN on the WIRE — the actor's row greys on an EMPTY hand with the printed clause, and lights once a card is in hand", () => {
    const offer = (state: GameState) => {
      const phase = redactGame(state, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
      return phase.stadiumAbility;
    };
    const empty = setHand(stadium(table(), ACADEMY), "p1", []);
    expect(offer(empty)).toEqual({
      label: "Academy at Night",
      disabled: true,
      reason: "Only if you put a card from your hand on top of your deck",
    });
    expect(applyAction(empty, { type: "useStadiumAbility", seat: "p1" }).ok).toBe(false);
    const stocked = setHand(empty, "p1", [ITEM_A]);
    expect(offer(stocked)).toEqual({ label: "Academy at Night", disabled: false, reason: null });
    expect(applyAction(stocked, { type: "useStadiumAbility", seat: "p1" }).ok).toBe(true);
  });

  it("once during THIS player's turn — a second activation is refused; the OPPONENT may use it on theirs", () => {
    const board = setHand(stadium(table(), ACADEMY), "p1", [ITEM_A]);
    const { state: used } = activate(board);
    expectErr(used, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_ALREADY_USED");
    const theirs = setHand(mustApply(used, { type: "endTurn", seat: "p1" }).state, "p2", [ITEM_B]);
    const top = theirs.players.p2.hand[0] as string;
    const { state } = activate(theirs, "p2");
    expect(state.players.p2.deck[0]).toBe(top);
  });

  it("a parked Academy at Night round-trips through JSON and resumes identically", () => {
    const board = setHand(stadium(table(), ACADEMY), "p1", [ITEM_A, ITEM_B]);
    const { state: parked } = activate(board);
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    const answer = cards([board.players.p1.hand[0] as string]);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });
});
