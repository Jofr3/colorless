import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { seatDamageReduction } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, trainerCard } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D564 — JASMINE'S GAZE: THE SIDE-WIDE NEXT-TURN REDUCTION ──
//
//   Jasmine's Gaze  sv08-178 / -233 / -245  Supporter — "During your opponent's next turn, all of
//   your Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying
//   Weakness and Resistance). (This includes new Pokémon that come into play.)"
//
// ONE new op, `installSideDamageReductionNextTurn { amount: 30 }`, stamps the CONTROLLER's side
// with a REQUIRED `PlayerSide.sideDamageReduction { turn: state.turn + 1, amount }` (MRV 35 → 36,
// THE NINTH POSITION); continuous.ts `seatDamageReduction` pays it for the damaged side, after
// the own-side return and under `"all"` only. Readings R-JG1 (Feint Attack drops it), R-JG2
// (own-side hits unpaid), R-JG3 (side-level: new Pokémon covered, no §10 shed): decisions.md
// D564. Driven on the REAL ids on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270).

const JASMINE = ["sv08-178", "sv08-233", "sv08-245"] as const;
const FULL_METAL_LAB = "sv05-148";
const HARIYAMA = "sv02-113";
const FEINT = "fix-feint";
const STRIKER = "d564s-striker";
const WALL = "d564s-wall";
const WEAK = "d564s-weak";
const RESIST = "d564s-resist";
const METAL = "d564s-metal";

const JASMINE_TEXT =
  "During your opponent's next turn, all of your Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). (This includes new Pokémon that come into play.)";
const REDUCTION = 30;
const STRIKE = 90;

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    JASMINE.map((id) => [id, { ...trainerCard(id, "Supporter", JASMINE_TEXT), name: "Jasmine's Gaze" }]),
  ),
  [FULL_METAL_LAB]: {
    ...trainerCard(
      FULL_METAL_LAB,
      "Stadium",
      "{M} Pokémon (both yours and your opponent's) take 30 less damage from attacks from the opponent's Pokémon (after applying Weakness and Resistance).",
    ),
    name: "Full Metal Lab",
  },
  [STRIKER]: battler(STRIKER, {
    name: "D564 Striker",
    types: ["Fire"],
    hp: 900,
    attacks: [{ cost: [], name: "Strike", damage: STRIKE }],
  }),
  [WALL]: battler(WALL, { name: "D564 Wall", types: ["Colorless"], hp: 900, retreat: 0 }),
  [WEAK]: battler(WEAK, {
    name: "D564 Weak",
    types: ["Grass"],
    hp: 900,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  [RESIST]: battler(RESIST, {
    name: "D564 Resist",
    types: ["Water"],
    hp: 900,
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  [METAL]: battler(METAL, { name: "D564 Metal", types: ["Metal"], hp: 900 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [JASMINE[0]]: 2,
  [JASMINE[1]]: 1,
  [JASMINE[2]]: 1,
  [FULL_METAL_LAB]: 1,
  [HARIYAMA]: 1,
  [FEINT]: 1,
  [STRIKER]: 4,
  [WALL]: 30,
  [WEAK]: 2,
  [RESIST]: 2,
  [METAL]: 2,
  "fix-energy": 13,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out of
    the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
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

const bench = (state: GameState, seat: Seat, id: string) => benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** p1's turn 2: p1 `active` + `benched`, p2's Active the Striker (or `attacker`). */
function table(active: string = WALL, benched: readonly string[] = [], attacker: string = STRIKER): GameState {
  let state = opened(5642);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", attacker), "p2", attacker);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of benched) state = bench(state, "p1", id);
  return state;
}

/** p1 plays Jasmine's Gaze (`id`) from a hand of exactly that card. */
function gaze(board: GameState, id: string = JASMINE[0]) {
  const side = board.players.p1;
  const deck = [...side.deck, ...side.hand];
  const uid = deck.find((u) => board.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  const held: GameState = {
    ...board,
    players: { ...board.players, p1: { ...side, hand: [uid], deck: deck.filter((u) => u !== uid) } },
  };
  return run(held, { type: "playTrainer", seat: "p1", uid });
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

function body(p: InPlayPokemon | null | undefined): InPlayPokemon {
  if (p === null || p === undefined) throw new Error("no body");
  return p;
}

function find<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** p1 plays the Gaze and passes; returns p2's turn 3 — the window. */
function window(board: GameState = table()): GameState {
  return run(gaze(board).state, { type: "endTurn", seat: "p1" }).state;
}

const strike = (state: GameState) => run(state, { type: "attack", seat: "p2", index: 0 });
const dealt = (state: GameState) => find(strike(state).events, "DAMAGE_DEALT")?.dealt;

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the row", () => {
  it("all three printings share ONE object: one op, only a `trainer` key", () => {
    const first = programFor(JASMINE[0]);
    expect(first).toEqual({ trainer: [{ op: "installSideDamageReductionNextTurn", amount: REDUCTION }] });
    expect(Object.keys(first ?? {})).toEqual(["trainer"]);
    for (const id of JASMINE) expect(programFor(id)).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the install: a record on the PLAYER's side, stamped for the opponent's next turn", () => {
  it("🛑 the stamp is `state.turn + 1` (the opponent form's `+ 1`), on the INSTALLER's side only", () => {
    const board = table();
    expect(board.turn).toBe(2);
    expect(board.players.p1.sideDamageReduction).toBeNull();
    const { state, events } = gaze(board);
    expect(state.players.p1.sideDamageReduction).toEqual({ turn: 3, amount: REDUCTION });
    expect(state.players.p2.sideDamageReduction).toBeNull();
    expect(find(events, "SIDE_DAMAGE_REDUCTION_INSTALLED")).toEqual({
      type: "SIDE_DAMAGE_REDUCTION_INSTALLED",
      seat: "p1",
      amount: REDUCTION,
    });
  });

  it("every printing installs the same record", () => {
    for (const id of JASMINE) expect(gaze(table(), id).state.players.p1.sideDamageReduction).toEqual({ turn: 3, amount: 30 });
  });

  it("🛑 OVERWRITE, not sum: a second install replaces the record (one Supporter per turn — named at the type)", () => {
    const { state } = gaze(table());
    const events: GameEvent[] = [];
    const again = runProgram(state, [{ op: "installSideDamageReductionNextTurn", amount: 50 }], { seat: "p1" }, events);
    if (again.kind !== "done") throw new Error("expected done");
    expect(again.state.players.p1.sideDamageReduction).toEqual({ turn: 3, amount: 50 });
  });

  it("the log row reads under the installer and says whose turn", () => {
    const { state, events } = gaze(table());
    expect(render(events, state)).toContainEqual({
      who: "p1",
      text: "Pokémon take 30 less damage from attacks during the opponent's next turn (after Weakness and Resistance), including Pokémon that come into play",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the window is the OPPONENT's NEXT turn, and it expires on arithmetic", () => {
  it("🛑 p2's turn 3: a 90 hit on p1's Active deals 60", () => {
    expect(dealt(window())).toBe(STRIKE - REDUCTION);
  });

  it("…and the CONTROL: with no Gaze the same hit deals 90", () => {
    const passed = run(table(), { type: "endTurn", seat: "p1" }).state;
    expect(dealt(passed)).toBe(STRIKE);
  });

  it("🛑 NOT on the installer's own turn (turn 2), and NOT on the opponent's turn AFTER (turn 5)", () => {
    const { state } = gaze(table());
    expect(seatDamageReduction(state, body(state.players.p1.active), "all", "p2")).toBe(0);
    const turn3 = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(seatDamageReduction(turn3, body(turn3.players.p1.active), "all", "p2")).toBe(REDUCTION);
    const turn4 = strike(turn3).state; // p2 attacks, the turn ends
    expect(turn4.turn).toBe(4);
    const turn5 = run(turn4, { type: "endTurn", seat: "p1" }).state;
    expect(turn5.turn).toBe(5);
    // The record is still on the side — it is not cleared, it EXPIRED.
    expect(turn5.players.p1.sideDamageReduction).toEqual({ turn: 3, amount: REDUCTION });
    expect(dealt(turn5)).toBe(STRIKE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — R-JG3: a SIDE record — new Pokémon are covered, and switching sheds nothing", () => {
  it("🛑 a Pokémon benched AFTER the install is covered on the opponent's turn", () => {
    const { state } = gaze(table());
    const later = bench(state, "p1", WEAK);
    const turn3 = run(later, { type: "endTurn", seat: "p1" }).state;
    expect(seatDamageReduction(turn3, body(turn3.players.p1.bench[0]), "all", "p2")).toBe(REDUCTION);
  });

  it("🛑 a RETREAT after the install: the promoted body is covered end to end, and the retreated one still is", () => {
    const { state } = gaze(table(WALL, [WEAK]));
    const retreated = run(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }).state;
    const turn3 = run(retreated, { type: "endTurn", seat: "p1" }).state;
    expect(turn3.cardIdByUid[body(turn3.players.p1.active).stack[0] as string]).toBe(WEAK);
    expect(seatDamageReduction(turn3, body(turn3.players.p1.bench[0]), "all", "p2")).toBe(REDUCTION);
    // Weak ×2: 180 − 30.
    expect(dealt(turn3)).toBe(STRIKE * 2 - REDUCTION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — R-JG2: \"from your opponent's Pokémon\" — an own-side hit is never paid", () => {
  it("🛑 the same body, the same turn: the opponent's attack is reduced, p1's own is not", () => {
    const turn3 = window();
    const target = body(turn3.players.p1.active);
    expect(seatDamageReduction(turn3, target, "all", "p2")).toBe(REDUCTION);
    expect(seatDamageReduction(turn3, target, "all", "p1")).toBe(0);
  });

  it("the OPPONENT's side is not shielded by p1's Gaze", () => {
    const turn3 = window();
    expect(seatDamageReduction(turn3, body(turn3.players.p2.active), "all", "p1")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — it STACKS: with the in-play Stadium and with the side's Ability auras", () => {
  it("🛑 Full Metal Lab on a {M} body: 30 + 30 = 60, and 90 − 60 = 30 dealt", () => {
    const turn3 = window(stadium(table(METAL), FULL_METAL_LAB));
    expect(seatDamageReduction(turn3, body(turn3.players.p1.active), "all", "p2")).toBe(60);
    expect(dealt(turn3)).toBe(STRIKE - 60);
  });

  it("🛑 Hariyama's seat-wide aura on the Bench: 10 + 30 = 40", () => {
    const turn3 = window(table(WALL, [HARIYAMA]));
    expect(seatDamageReduction(turn3, body(turn3.players.p1.active), "all", "p2")).toBe(40);
    expect(dealt(turn3)).toBe(STRIKE - 40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — AFTER Weakness and Resistance", () => {
  it("🛑 a Fire hit on a body Weak to Fire: (90 × 2) − 30 = 150 (pre-W/R would be 120)", () => {
    expect(dealt(window(table(WEAK)))).toBe(STRIKE * 2 - REDUCTION);
  });

  it("a Fire hit on a body Resistant to Fire: 90 − 30 − 30 = 30", () => {
    expect(dealt(window(table(RESIST)))).toBe(STRIKE - 30 - REDUCTION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — R-JG1: Feint Attack's `\"othersOnly\"` DROPS it (an effect on the damaged Pokémon), where the Stadium stays", () => {
  it("🛑 under `\"othersOnly\"` the Gaze is 0, the benched Hariyama's aura stays, and the Stadium stays", () => {
    const turn3 = window(stadium(table(METAL, [HARIYAMA]), FULL_METAL_LAB));
    const target = body(turn3.players.p1.active);
    expect(seatDamageReduction(turn3, target, "all", "p2")).toBe(30 + 10 + 30);
    expect(seatDamageReduction(turn3, target, "othersOnly", "p2")).toBe(10 + 30);
  });

  it("🛑 end to end: Feint Attack's 50 on p1's shielded Active lands whole", () => {
    let turn3 = window(table(WALL, [], FEINT));
    const side = turn3.players.p2;
    const energy = side.deck.find((u) => turn3.cardIdByUid[u] === "fix-energy") as string;
    turn3 = {
      ...turn3,
      players: {
        ...turn3.players,
        p2: { ...side, deck: side.deck.filter((u) => u !== energy), active: { ...body(side.active), energy: [energy] } },
      },
    };
    // p1's Active is the ONE legal target, so the pick is forced and resolves in place.
    expect(seatDamageReduction(turn3, body(turn3.players.p1.active), "all", "p2")).toBe(REDUCTION);
    expect(find(strike(turn3).events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the bytes, and THE NINTH POSITION (`MATCH_RECORD_VERSION` 35 → 36)", () => {
  it("🛑 the side record round-trips through JSON and still pays", () => {
    const turn3 = window();
    expect(JSON.stringify(turn3.players.p1.sideDamageReduction)).toBe('{"turn":3,"amount":30}');
    expect(dealt(JSON.parse(JSON.stringify(turn3)) as GameState)).toBe(STRIKE - REDUCTION);
  });

  it("🛑 (i) A v35 ROLLBACK resuming a v36 record in the window drops the 30 — a played Supporter's effect silently gone, NOT inert", () => {
    const v36 = JSON.parse(JSON.stringify(window())) as GameState;
    const asRollbackReadsIt: GameState = {
      ...v36,
      players: { ...v36.players, p1: { ...v36.players.p1, sideDamageReduction: null } },
    };
    expect(dealt(asRollbackReadsIt)).toBe(STRIKE);
    expect(dealt(v36)).toBe(STRIKE - REDUCTION);
  });

  it("🛑 (ii) a v36 engine reading a v35 side (no key) THROWS on the opponent's first damaging hit — D326", () => {
    const turn3 = run(table(), { type: "endTurn", seat: "p1" }).state;
    const { sideDamageReduction: _dropped, ...v35Side } = turn3.players.p1;
    const v35 = { ...turn3, players: { ...turn3.players, p1: v35Side } } as unknown as GameState;
    expect(() => applyAction(v35, { type: "attack", seat: "p2", index: 0 })).toThrow(TypeError);
  });

  it("the engine is 0.499.0", () => {
    expect(engineVersion).toBe("0.499.0");
  });
});
