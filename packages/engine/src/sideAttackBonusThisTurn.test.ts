import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { disabledAbilityUids, sideAttackBonusThisTurn } from "./continuous";
import type { CardFilter, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D556 A — THE THIS-TURN SIDE-WIDE PRE-W/R BONUS (Black Belt's Training) ──
//
//   Black Belt's Training  sv08.5-096 / -097 / -098 / -099, sv09-143 / -144 / -145,
//                          svp-219 / -220 (Supporter, 9 legal)
//   "During this turn, attacks used by your Pokémon do 40 more damage to your
//    opponent's Active Pokémon ex (before applying Weakness and Resistance)."
//
// ONE new op, `boostSideAttacksThisTurn { amount, target }`, appending to a REQUIRED
// `TurnAllowances.sideAttackBonuses` (wiped by `freshAllowances()` at every
// `startTurn`), read by ONE helper (continuous.ts `sideAttackBonusThisTurn`) at BOTH
// pre-W/R sites — attack.ts's main hit and interpreter.ts `snipeActive` — seat-guarded
// to the turn's owner, matched on the DEFENDING card, immune to a §9 lock, reported
// inside `DAMAGE_DEALT.bonus`. `MATCH_RECORD_VERSION` 34 → 35 (THE EIGHTH POSITION).
// Real ids on a LOCAL `cardPool` (D275); the attacker and defenders are file-local
// DECLARED `d556-*` bodies in their OWN 60-card deck (D270). docs/decisions.md D556.
//
// Sections: §1 the print and the registry row · §2 the install · §3 the main hit ·
// §4 the snipe site, the Bench and no-damage attacks · §5 the side, not a body ·
// §6 expiry · §7 §9 immunity · §8 the seat guard and the sum · §9 the bytes and the
// eighth position · §10 the log row.

const BBT = [
  "sv08.5-096",
  "sv08.5-097",
  "sv08.5-098",
  "sv08.5-099",
  "sv09-143",
  "sv09-144",
  "sv09-145",
  "svp-219",
  "svp-220",
] as const;
const BBT_TEXT =
  "During this turn, attacks used by your Pokémon do 40 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).";
const EX: CardFilter = { kind: "suffixPokemon", suffix: "ex" };
const BONUS = 40;

const STRIKE = 0; // {C}, 50
const PICK_OFF = 1; // {C}, a chosen 30 onto any of the opponent's Pokémon
const SPRAY = 2; // {C}, 10 + 20 on each of the opponent's Benched Pokémon
const REST = 3; // {C}, no damage

const ATTACKS = [
  { cost: ["Colorless"], name: "Strike", damage: 50 },
  {
    cost: ["Colorless"],
    name: "Pick Off",
    effect:
      "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
  {
    cost: ["Colorless"],
    name: "Spray",
    damage: 10,
    effect:
      "This attack also does 20 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
  { cost: ["Colorless"], name: "Rest", effect: "Draw a card." },
] as Card["attacks"];

function supporter(id: string): Card {
  return { ...trainerCard(id, "Supporter", BBT_TEXT), name: "Black Belt's Training" };
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(BBT.map((id) => [id, supporter(id)])),
  /** The attacker: a plain hit, a chosen snipe, a Bench spread, a no-damage attack. */
  "d556-striker": battler("d556-striker", {
    name: "D556 Striker",
    types: ["Colorless"],
    hp: 300,
    retreat: 0,
    attacks: ATTACKS,
  }),
  /** A SECOND body, brought into play only AFTER the Supporter (§5). */
  "d556-relief": battler("d556-relief", {
    name: "D556 Relief",
    types: ["Colorless"],
    hp: 300,
    retreat: 0,
    attacks: [{ cost: ["Colorless"], name: "Strike", damage: 50 }],
  }),
  "d556-wall-ex": battler("d556-wall-ex", { name: "D556 Wall ex", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d556-wall": battler("d556-wall", { name: "D556 Wall", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d556-wall-v": battler("d556-wall-v", { name: "D556 Wall V", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d556-weak-ex": battler("d556-weak-ex", {
    name: "D556 Weak ex",
    types: ["Fighting"],
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  "d556-resist-ex": battler("d556-resist-ex", {
    name: "D556 Resist ex",
    types: ["Fighting"],
    hp: 900,
    retreat: 1,
    resistances: [{ type: "Colorless", value: "-30" }],
  }),
  "d556-bench-ex": battler("d556-bench-ex", { name: "D556 Bench ex", types: ["Fighting"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [BBT[0]]: 4,
  ...Object.fromEntries(BBT.slice(1).map((id) => [id, 1])),
  "d556-striker": 4,
  "d556-relief": 2,
  "d556-wall-ex": 4,
  "d556-wall": 2,
  "d556-wall-v": 2,
  "d556-weak-ex": 2,
  "d556-resist-ex": 2,
  "d556-bench-ex": 4,
  "sv02-127": 2, // Ting-Lu ex "Cursed Land" — the §9 lock (§7)
  "fix-energy": 24,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260925;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat }));
  return state;
}

/** TEST SURGERY — make sure one copy of `id` is in `seat`'s DECK: a copy in the hand
    goes back to the deck's bottom; a PRIZED copy is swapped for the deck's bottom card
    (the Prize row keeps its size). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const inHand = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (inHand !== undefined) {
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, hand: side.hand.filter((u) => u !== inHand), deck: [...side.deck, inHand] },
      },
    };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: [...side.deck.slice(0, -1), prized],
        prizes: side.prizes.map((u) => (u === prized ? swap : u)),
      },
    },
  };
}

/** TEST SURGERY — one copy of `id` moved into `seat`'s hand (through `ensureInDeck`). */
function pullToHand(state: GameState, seat: Seat, id: string): GameState {
  const ensured = ensureInDeck(state, seat, id);
  const side = ensured.players[seat];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    players: {
      ...ensured.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
    },
  };
}

const activeFrom = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
const benchFrom = (state: GameState, seat: Seat, id: string) =>
  benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** P1's turn 3: P1 fields `attacker` with two Energy, P2 fields `defender` and, when
    asked, `p2Bench` benched Pokémon ex; P1 holds a Black Belt's Training (`printing`). */
function ready(
  opts: { attacker?: string; defender?: string; p2Bench?: number; printing?: string } = {},
): GameState {
  const { attacker = "d556-striker", defender = "d556-wall-ex", p2Bench = 0, printing = BBT[0] } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = activeFrom(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = activeFrom(state, "p2", defender);
  state = clearBench(state, "p2");
  for (let i = 0; i < p2Bench; i++) state = benchFrom(state, "p2", "d556-bench-ex");
  return pullToHand(state, "p1", printing);
}

/** The Supporter PLAYED from P1's hand. */
function played(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const uid = start.players.p1.hand.find((u) => BBT.includes(start.cardIdByUid[u] as (typeof BBT)[number]));
  if (uid === undefined) throw new Error("no Black Belt's Training in hand");
  const { state, events } = mustApply(start, { type: "playTrainer", seat: "p1", uid });
  return { start, uid, state, events };
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState => must(applyAction(state, { type: "endTurn", seat }));

const pickActive = (parked: GameState) =>
  mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
  });

function runAs(state: GameState, seat: Seat, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat, invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

const cardOf = (id: string): Card => POOL[id] as Card;

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the print, and the registry row that maps it", () => {
  it("the program is ONE op, pinned by toEqual, and only a `trainer` key", () => {
    const program = programFor(BBT[0]);
    expect(program).toEqual({
      trainer: [{ op: "boostSideAttacksThisTurn", amount: BONUS, target: EX }],
    });
    expect(Object.keys(program ?? {})).toEqual(["trainer"]);
  });

  it("all nine printings share ONE object, and each is the printed Supporter", () => {
    const first = programFor(BBT[0]);
    for (const id of BBT) {
      expect(programFor(id), id).toBe(first);
      expect(POOL[id]?.name).toBe("Black Belt's Training");
      expect(POOL[id]?.trainerType).toBe("Supporter");
      expect(POOL[id]?.effect).toBe(BBT_TEXT);
    }
  });

  it("every printing plays and installs the same bonus", () => {
    for (const printing of BBT) {
      const { state } = played({ printing });
      expect(state.allowances.sideAttackBonuses, printing).toEqual([{ amount: BONUS, target: EX }]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the install: one entry on the bag, one row, no park, no rng", () => {
  it("files TRAINER_PLAYED then SIDE_ATTACKS_BOOSTED, and the bag holds `{ 40, ex }`", () => {
    const { start, uid, state, events } = played();
    expect(start.allowances.sideAttackBonuses).toEqual([]);
    expect(types(events)).toEqual(["TRAINER_PLAYED", "SIDE_ATTACKS_BOOSTED"]);
    expect(find(events, "SIDE_ATTACKS_BOOSTED")).toStrictEqual({
      type: "SIDE_ATTACKS_BOOSTED",
      seat: "p1",
      amount: BONUS,
      target: EX,
    });
    expect(state.allowances.sideAttackBonuses).toEqual([{ amount: BONUS, target: EX }]);
    expect(state.allowances.supporterPlayed).toBe(true);
    expect(state.players.p1.discard).toContain(uid);
  });

  it("never parks, consumes no rng, and touches no body", () => {
    const { start, state } = played();
    expect(state.phase.kind).toBe("turn:action");
    expect(state.rngState).toBe(start.rngState);
    expect(state.players.p1.active).toEqual(start.players.p1.active);
    expect(state.players.p2.active).toEqual(start.players.p2.active);
  });

  it("🛑 R1 — with NO ex Active it still PLAYS and installs; the bonus simply never matches", () => {
    const { state, events } = played({ defender: "d556-wall" });
    expect(find(events, "SIDE_ATTACKS_BOOSTED")).toBeDefined();
    expect(state.allowances.sideAttackBonuses).toHaveLength(1);
    const row = find(attack(state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(50);
    expect(row?.bonus).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the main hit: +40 on an Active ex, before Weakness and Resistance", () => {
  it("Strike does 50 + 40 = 90 to an Active ex, reported in `bonus`", () => {
    const row = find(attack(played().state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(50);
    expect(row?.bonus).toBe(BONUS);
    expect(row?.dealt).toBe(50 + BONUS);
  });

  it("the UNPLAYED control on the same board does the printed 50", () => {
    const row = find(attack(ready(), STRIKE).events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(50);
    expect(row?.bonus).toBeUndefined();
  });

  it("a non-ex Active gets 0 — and so does a Pokémon V (the print names ex alone)", () => {
    for (const defender of ["d556-wall", "d556-wall-v"]) {
      const row = find(attack(played({ defender }).state, STRIKE).events, "DAMAGE_DEALT");
      expect(row?.dealt, defender).toBe(50);
      expect(row?.bonus, defender).toBeUndefined();
    }
  });

  it("PRE-W/R: (50 + 40) × 2 = 180 on a Weakness ex, not 50 × 2 + 40", () => {
    const row = find(attack(played({ defender: "d556-weak-ex" }).state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe((50 + BONUS) * 2);
  });

  it("PRE-W/R: (50 + 40) − 30 = 60 on a Resistance ex, not 50 − 30 + 40", () => {
    const row = find(attack(played({ defender: "d556-resist-ex" }).state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(50 + BONUS - 30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the snipe site pays it; the Bench and a no-damage attack never do", () => {
  it("🛑 a chosen snipe landing on the ACTIVE ex (`snipeActive`) does 30 + 40 = 70", () => {
    const parked = attack(played({ p2Bench: 1 }).state, PICK_OFF).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const row = find(pickActive(parked).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.bonus).toBe(BONUS);
    expect(row?.dealt).toBe(30 + BONUS);
  });

  it("the same snipe onto a BENCHED ex (`placeSnipe`) is not boosted", () => {
    const parked = attack(played({ p2Bench: 1 }).state, PICK_OFF).state;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 0 } }] },
    });
    expect(body(done.state.players.p2.bench[0]).damage).toBe(30);
  });

  it("a Bench SPREAD is not boosted — the Active main hit of the same attack is", () => {
    const window = played({ p2Bench: 2 }).state;
    const { state, events } = attack(window, SPRAY);
    const onActive = all(events, "DAMAGE_DEALT").find((r) => r.uid === activeUid(window, "p2"));
    expect(onActive?.dealt).toBe(10 + BONUS);
    for (const benched of state.players.p2.bench) expect(benched.damage).toBe(20);
  });

  it("a NO-DAMAGE attack gets nothing — no DAMAGE_DEALT row at all (Vitality Band's rule)", () => {
    const window = played().state;
    const { state, events } = attack(window, REST);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(body(state.players.p2.active).damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — \"your Pokémon\" is the SIDE: a body brought in after the play gets it", () => {
  it("a Pokémon benched AFTER the play and switched in by a retreat hits for 90", () => {
    let state = played().state;
    state = benchFrom(state, "p1", "d556-relief");
    expect(state.allowances.sideAttackBonuses).toHaveLength(1);
    state = mustApply(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }).state;
    expect(state.cardIdByUid[activeUid(state, "p1")]).toBe("d556-relief");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const row = find(attack(state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(50 + BONUS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — \"during this turn\": the next `startTurn` wipes it", () => {
  it("the bag is EMPTY on the opponent's turn and on the player's next turn", () => {
    const after = pass(played().state, "p1");
    expect(after.turn).toBe(4);
    expect(after.allowances.sideAttackBonuses).toEqual([]);
    const back = pass(after, "p2");
    expect(back.turn).toBe(5);
    expect(back.allowances.sideAttackBonuses).toEqual([]);
  });

  it("🛑 the NEXT turn's Strike does the printed 50 — the bonus did not survive the boundary", () => {
    const back = pass(pass(played().state, "p1"), "p2");
    const row = find(attack(back, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(50);
    expect(row?.bonus).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — a §9 Ability lock does NOT reach it (a Trainer installation is not an Ability)", () => {
  it("under Ting-Lu ex's \"Cursed Land\" the attacker's Abilities are OFF, and Strike still does 90", () => {
    // Ting-Lu ex (an ex, so the bonus matches it) locks the Abilities of the
    // opponent's DAMAGED non-ex Pokémon: damage the attacker and it is in the set.
    const state = setDamage(played({ defender: "sv02-127" }).state, "p1", 10);
    expect(disabledAbilityUids(state).has(activeUid(state, "p1"))).toBe(true);
    const row = find(attack(state, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.bonus).toBe(BONUS);
    expect(row?.dealt).toBe(50 + BONUS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the seat guard, and sources SUMMED", () => {
  it("the helper pays the TURN'S OWNER and nobody else", () => {
    const state = played().state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(sideAttackBonusThisTurn(state, "p1", cardOf("d556-wall-ex"))).toBe(BONUS);
    expect(sideAttackBonusThisTurn(state, "p2", cardOf("d556-wall-ex"))).toBe(0);
    expect(sideAttackBonusThisTurn(state, "p1", cardOf("d556-wall"))).toBe(0);
    expect(sideAttackBonusThisTurn(state, "p1", undefined)).toBe(0);
  });

  it("🛑 a hit run for the OTHER seat mid-turn onto P1's Active ex is NOT paid P1's bonus", () => {
    // P1 has played the Supporter on its own turn; its Active is now an ex. A program
    // run for P2 (a counterattack-shaped hit through `snipeActive`) lands on it: the bag
    // is P1's, so P2's 30 stays 30. Unguarded, it would read 70.
    let state = played().state;
    state = activeFrom(state, "p1", "d556-bench-ex");
    const events: GameEvent[] = [];
    const after = runAs(state, "p2", [{ op: "damageNewActive", amount: 30 }], events);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(body(after.players.p1.active).damage).toBe(30);
  });

  it("two installs are SUMMED: 50 + 40 + 40 = 130, and a non-matching entry adds nothing", () => {
    let state = played().state;
    state = runAs(
      state,
      "p1",
      [
        { op: "boostSideAttacksThisTurn", amount: BONUS, target: EX },
        { op: "boostSideAttacksThisTurn", amount: 999, target: { kind: "suffixPokemon", suffix: "V" } },
      ],
      [],
    );
    expect(state.allowances.sideAttackBonuses).toHaveLength(3);
    expect(find(attack(state, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + BONUS + BONUS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the bytes, and THE EIGHTH POSITION (`MATCH_RECORD_VERSION` 34 → 35)", () => {
  it("🛑 the bag round-trips through JSON and still pays", () => {
    const state = played().state;
    const wire = JSON.stringify(state.allowances.sideAttackBonuses);
    expect(wire).toBe('[{"amount":40,"target":{"kind":"suffixPokemon","suffix":"ex"}}]');
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(find(attack(revived, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + BONUS);
  });

  it("🛑 (i) A v34 ROLLBACK reading a v35 record mid-turn drops the +40 — NOT inert, so the version is owed", () => {
    // A v34 engine never reads the key, which is exactly this engine with the bag's
    // entries gone: the Supporter is spent (in the discard, `supporterPlayed` true) and
    // its effect is silently missing for the rest of the turn.
    const v35 = JSON.parse(JSON.stringify(played().state)) as GameState;
    const asRollbackReadsIt: GameState = { ...v35, allowances: { ...v35.allowances, sideAttackBonuses: [] } };
    expect(asRollbackReadsIt.allowances.supporterPlayed).toBe(true);
    expect(find(attack(asRollbackReadsIt, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(find(attack(v35, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + BONUS);
  });

  it("🛑 (ii) A v35 engine reading a v34 bag (no key) THROWS on the turn owner's damaging attack and on the play — D326", () => {
    const start = ready();
    const { sideAttackBonuses: _dropped, ...v34Allowances } = start.allowances;
    const v34 = { ...start, allowances: v34Allowances } as unknown as GameState;
    expect(() => applyAction(v34, { type: "attack", seat: "p1", index: STRIKE })).toThrow(TypeError);
    const uid = v34.players.p1.hand.find((u) => v34.cardIdByUid[u] === BBT[0]) as string;
    expect(() => applyAction(v34, { type: "playTrainer", seat: "p1", uid })).toThrow(TypeError);
    // …and a NO-damage attack never reaches the reader, so it does not throw: the
    // degradation is scoped to damaging hits (and the next `startTurn` heals the bag).
    expect(applyAction(v34, { type: "attack", seat: "p1", index: REST }).ok).toBe(true);
  });

  it("the engine is 0.481.0", () => {
    expect(engineVersion).toBe("0.481.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — the log row", () => {
  it("renders under the installer, names the printed defender noun, and says \"this turn\"", () => {
    const { state, events } = played();
    expect(render(events, state)).toContainEqual({
      who: "p1",
      text: "Pokémon's attacks do 40 more damage to the opponent's Active Pokémon ex this turn (before Weakness and Resistance)",
    });
  });
});
