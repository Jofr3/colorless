import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { boostedAttackBase, boostedAttackDamage, everyAttackBoostOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import type { BoostedAttack } from "./types";

// 0.430.0 → 0.431.0 — D546, THE ALL-ATTACKS NEXT-TURN BUFF:
//
//   "During your next turn, attacks used by this Pokémon do 120 more damage to your
//    opponent's Active Pokémon (before applying Weakness and Resistance)."
//
// `censusAttackCorpus.ts` FILE LINE 148 (leading count column 1), and the SAME sentence
// at 100 behind "Both Active Pokémon are now Asleep." at FILE LINE 76 (count 1):
// **2 sentences / 2 legal printings**, both OPAQUE at SUBMAX=12 and UNEXPLAINED +
// CONTINUOUS at SUBMAX=4 before this slice. Claimed WHOLE by `deriveAttackEffect`
// through ONE new anchor (`SELF_EVERY_ATTACK_BOOST`, one `['’]` slot, the Sleep
// sentence an OPTIONAL prefix) and ONE new arm (24b'') emitting the SHIPPED
// `boostAttack` op with `attack: null` — ONE op, ONE installer, ONE record (D165).
// The record is D155's `BoostedAttack` with `attackIndex: null`, which the additive
// reader pays on EVERY index; `snipeActive` folds it too (`everyAttackBoostOf`).
//
// ⚠️ NO CATALOG, REGISTRY OR FIXTURE ID PRINTS EITHER SENTENCE ON THIS CHECKOUT, AND
// THAT WAS MEASURED (D425, `git grep`). Every board rides file-local DECLARED `d546-*`
// demonstrators in their OWN 60-card deck (D270). The real cards' attack lists,
// costs and damage are UNMEASURED — so whether either real card prints a snipe, a
// spread or a no-damage attack is not known; each is DEMONSTRATED here, not claimed.
//
// Sections: §1 the derivation · §2 the install and the record · §3 the window and
// every index · §4 what the buff does NOT reach, and the snipe fold · §5 the Sleep
// prefix (`:76`) · §6 §10 clears · §7 the merge and the refusals · §8 the log row ·
// §9 the serialized bytes and the rollback.

const S148 =
  "During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const SLEEP = "Both Active Pokémon are now Asleep.";
const S76 = `${SLEEP} During your next turn, attacks used by this Pokémon do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).`;
const P148: readonly EffectOp[] = [{ op: "boostAttack", attack: null, amount: 120 }];
const P76: readonly EffectOp[] = [
  { op: "applyStatus", target: "defender", status: "asleep" },
  { op: "applyStatus", target: "self", status: "asleep" },
  { op: "boostAttack", attack: null, amount: 100 },
];
/** The named additive neighbour (`:165`) and the base-set one (`:166`). */
const ECHOED_VOICE =
  "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).";
const HYPER_FANG = "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.";
/** `counterPut.test.ts`'s ABILITY witness — the same tail behind "Once during your
    turn, …", which the `^` and the capital "During your next turn" keep out. */
const ABILITY_WITNESS =
  "Once during your turn, you may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";

const REV_UP = 0; // {C}, 10 — the installer (:148)
const STRIKE = 1; // {C}{C}, 50
const SWIPE = 2; // {C}, 20
const REST = 3; // {C}, no damage — "Draw a card."
const PICK_OFF = 4; // {C}, no damage — a chosen 30 onto any of the opponent's Pokémon
const SPRAY = 5; // {C}, 10 + 20 on each of the opponent's Benched Pokémon
const BUFF = 120;

const ATTACKS = [
  { cost: ["Colorless"], name: "Rev Up", damage: 10, effect: S148 },
  { cost: ["Colorless", "Colorless"], name: "Strike", damage: 50 },
  { cost: ["Colorless"], name: "Swipe", damage: 20 },
  { cost: ["Colorless"], name: "Rest", effect: "Draw a card." },
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
] as Card["attacks"];

const LOCAL_CARDS: Record<string, Card> = {
  /** ONE body carrying the `:148` installer and five other attacks: two plain
      damage numbers (the EVERY-index claim needs two), a no-damage attack, a chosen
      snipe and a Bench spread. */
  "d546-buffer": battler("d546-buffer", { types: ["Colorless"], hp: 300, retreat: 1, attacks: ATTACKS }),
  /** Evolves from `d546-buffer` with the SAME attacks at the same indexes, so a record
      that survived evolution would pay the new card. */
  "d546-buffer-evolved": battler("d546-buffer-evolved", {
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "d546-buffer",
    hp: 300,
    retreat: 1,
    attacks: ATTACKS,
  }),
  /** The `:76` installer: the Sleep prefix plus the 100 buff, and two plain attacks. */
  "d546-lullaby": battler("d546-lullaby", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Lullaby", damage: 10, effect: S76 },
      { cost: ["Colorless", "Colorless"], name: "Strike", damage: 50 },
      { cost: ["Colorless"], name: "Swipe", damage: 20 },
    ],
  }),
  "d546-wall": battler("d546-wall", { types: ["Fighting"], hp: 900, retreat: 1 }),
  "d546-weak": battler("d546-weak", {
    types: ["Fighting"],
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  "d546-bench": battler("d546-bench", { types: ["Fighting"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d546-buffer": 4,
  "d546-buffer-evolved": 2,
  "d546-lullaby": 4,
  "d546-wall": 4,
  "d546-weak": 2,
  "d546-bench": 6,
  "sv02-172": 2, // Boss's Orders — the forced switch
  "fix-mist-energy": 2, // the §11 shield
  "fix-energy": 34,
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
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1's turn 3: P1 fields `attacker` with three Energy and one benched body, P2
    fields `defender` and, when asked, `p2Bench` benched bodies. */
function ready(
  opts: { attacker?: string; defender?: string; p2Bench?: number } = {},
): GameState {
  const { attacker = "d546-buffer", defender = "d546-wall", p2Bench = 0 } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  state = benchFromDeck(state, "p1", "d546-bench");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  for (let i = 0; i < p2Bench; i++) state = benchFromDeck(state, "p2", "d546-bench");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

/** `ready`, then Rev Up DECLARED — asserting the row landed. Returns P2's turn 4. */
function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, REV_UP);
  if (find(events, "ATTACK_BOOSTED") === undefined) throw new Error("Rev Up installed nothing");
  return { start, state, events };
}

/** The holder's own next turn — THE window (turn 5). */
const inWindow = (state: GameState): GameState => pass(state, "p2");

function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function withRawBoost(state: GameState, record: BoostedAttack | null): GameState {
  const active = body(state.players.p1.active);
  return {
    ...state,
    players: { ...state.players, p1: { ...state.players.p1, active: { ...active, boostedAttack: record } } },
  };
}

/** Every `boostAttack` op in a derived program. */
function boostOps(program: EffectOp[] | null): Extract<EffectOp, { op: "boostAttack" }>[] {
  return (program ?? []).filter(
    (op): op is Extract<EffectOp, { op: "boostAttack" }> => op.op === "boostAttack",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims both rows WHOLE, and only them", () => {
  it("`:148` derives ONE op: the shipped `boostAttack` with `attack: null`", () => {
    expect(deriveAttackEffect(S148)).toStrictEqual(P148);
  });

  it("`:76` derives the two Sleep ops in PRINTED order, DEFENDER first, then the buff", () => {
    expect(deriveAttackEffect(S76)).toStrictEqual(P76);
  });

  it("both corpus rows derive off the committed bytes, and are the ONLY null-address rows", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === S148 || text === S76);
    expect(rows).toEqual([
      [1, S76],
      [1, S148],
    ]);
    for (const [, text] of rows) expect(resolvedByAnyReader(text), text).toBe(true);
    const nullRows = legalAttackCorpus().filter(([, text]) =>
      boostOps(deriveAttackEffect(text)).some((op) => op.attack === null),
    );
    expect(nullRows.map(([, text]) => text)).toEqual([S76, S148]);
  });

  it("the ONE apostrophe slot ('opponent's') takes either spelling, on both rows", () => {
    expect(deriveAttackEffect(S148.replace("opponent's", "opponent’s"))).toStrictEqual(P148);
    expect(deriveAttackEffect(S76.replace("opponent's", "opponent’s"))).toStrictEqual(P76);
  });

  it("stays LOUD on a zero, and refuses every near-miss", () => {
    for (const text of [
      S148.replace("120", "0"),
      S76.replace("100", "0"),
      S148.slice(0, -1),
      `d${S148.slice(1)}`,
      `Xyzzy. ${S148}`,
      `${S148} Xyzzy.`,
      // The prefix alone is owned by NO anchor — and the prefix is not optional for
      // any OTHER leading sentence.
      SLEEP,
      S76.replace("Asleep", "Confused"),
      `${SLEEP}  ${S148}`,
      // No parenthetical; the Bench; the named possessive.
      "During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon.",
      "During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Benched Pokémon (before applying Weakness and Resistance).",
      "During your next turn, this Pokémon's attacks do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("is DISJOINT from the named, base-set and Ability neighbours in BOTH directions", () => {
    expect(deriveAttackEffect(ECHOED_VOICE)).toStrictEqual([
      { op: "boostAttack", attack: "Echoed Voice", amount: 80 },
    ]);
    expect(deriveAttackEffect(HYPER_FANG)).toStrictEqual([
      { op: "boostAttack", attack: "Hyper Fang", amount: 240, base: true },
    ]);
    expect(deriveAttackEffect(ABILITY_WITNESS)).toBeNull();
    // The two hybrids — each anchor's head with the other's tail.
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "During your next turn, attacks used by this Pokémon do 120 more damage (before applying Weakness and Resistance).",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install and the record.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install writes `{ turn: T+2, attackIndex: null, amount }`", () => {
  it("stamps the holder's own next turn, names NO attack on the row, writes no bar", () => {
    const { start, state, events } = installed();
    expect(start.turn).toBe(3);
    expect(find(events, "ATTACK_BOOSTED")).toStrictEqual({
      type: "ATTACK_BOOSTED",
      seat: "p1",
      uid: activeUid(start, "p1"),
      attack: null,
      amount: BUFF,
    });
    expect(state.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: null,
      amount: BUFF,
    });
    expect(state.players.p1.active?.lockedAttacks).toEqual([]);
  });

  it("never parks and consumes no rng", () => {
    const start = ready();
    const { state } = attack(start, REV_UP);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.rngState).toBe(start.rngState);
  });

  it("the row lands after the hit that installs it, and the install hit is unboosted", () => {
    const { events } = installed();
    const order = events.map((e) => e.type);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BOOSTED"));
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the window, on EVERY index.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — it pays every attack, in the holder's next turn only", () => {
  it("is not live on the opponent's turn in between (T+1)", () => {
    const { state } = installed();
    expect(state.turn).toBe(4);
    const holder = body(state.players.p1.active);
    for (const i of [REV_UP, STRIKE, SWIPE]) expect(boostedAttackDamage(state, holder, i)).toBe(0);
    expect(everyAttackBoostOf(state, holder)).toBe(0);
  });

  it("pays +120 on Strike AND on Swipe at T+2 — two different indexes, one record", () => {
    const window = inWindow(installed().state);
    expect(window.turn).toBe(5);
    const holder = body(window.players.p1.active);
    for (const i of [REV_UP, STRIKE, SWIPE, REST, PICK_OFF, SPRAY]) {
      expect(boostedAttackDamage(window, holder, i), `index ${i}`).toBe(BUFF);
    }
    const strike = find(attack(window, STRIKE).events, "DAMAGE_DEALT");
    expect(strike?.base).toBe(50);
    expect(strike?.bonus).toBe(BUFF);
    expect(strike?.dealt).toBe(50 + BUFF);
    const swipe = find(attack(window, SWIPE).events, "DAMAGE_DEALT");
    expect(swipe?.dealt).toBe(20 + BUFF);
  });

  it("the unboosted control does the printed numbers on the same board", () => {
    const start = ready();
    expect(find(attack(start, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(find(attack(start, SWIPE).events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("is not live at T+4 — the stamp stops answering, and the record is still there", () => {
    let later = inWindow(installed().state);
    later = pass(pass(later, "p1"), "p2");
    expect(later.turn).toBe(7);
    expect(later.players.p1.active?.boostedAttack?.attackIndex).toBeNull();
    expect(boostedAttackDamage(later, body(later.players.p1.active), STRIKE)).toBe(0);
    expect(find(attack(later, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("is PRE-W/R: (50 + 120) × 2 = 340 on a Weakness body, not 50 × 2 + 120", () => {
    const window = inWindow(installed({ defender: "d546-weak" }).state);
    const row = find(attack(window, STRIKE).events, "DAMAGE_DEALT");
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe((50 + BUFF) * 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — what it does NOT reach, and the one snipe site it does.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — no boost without damage or on the Bench; the Active snipe pays it", () => {
  it("a NO-DAMAGE attack gets no boost: no DAMAGE_DEALT row at all", () => {
    const window = inWindow(installed().state);
    const before = body(window.players.p2.active).damage;
    const { state, events } = attack(window, REST);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(body(state.players.p2.active).damage).toBe(before);
  });

  it("a Bench SPREAD is not boosted — the Active main hit is", () => {
    const window = inWindow(installed({ p2Bench: 2 }).state);
    const { state, events } = attack(window, SPRAY);
    const rows = all(events, "DAMAGE_DEALT");
    const onActive = rows.find((r) => r.uid === activeUid(window, "p2"));
    expect(onActive?.dealt).toBe(10 + BUFF);
    for (const benched of state.players.p2.bench) expect(benched.damage).toBe(20);
  });

  it("a chosen snipe onto the BENCH (`placeSnipe`) is not boosted", () => {
    const window = inWindow(installed({ p2Bench: 1 }).state);
    const parked = attack(window, PICK_OFF).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 0 } }] },
    });
    expect(body(done.state.players.p2.bench[0]).damage).toBe(30);
  });

  it("🛑 the SAME snipe landing on the ACTIVE (`snipeActive`) pays +120 — the D546 fold", () => {
    const window = inWindow(installed({ p2Bench: 1 }).state);
    const parked = attack(window, PICK_OFF).state;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    const row = find(done.events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.bonus).toBe(BUFF);
    expect(row?.dealt).toBe(30 + BUFF);
  });

  it("…and a NAMED boost is still NOT folded there (no attack index in `EffectContext`)", () => {
    let state = ready({ p2Bench: 1 });
    state = runOne(state, [{ op: "boostAttack", attack: "Pick Off", amount: 50 }], []);
    const window = inWindow(pass(state, "p1"));
    expect(everyAttackBoostOf(window, body(window.players.p1.active))).toBe(0);
    const parked = attack(window, PICK_OFF).state;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(find(done.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the Sleep prefix (`:76`): both Actives, and a buff the holder may sleep through.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — `:76`: both Actives fall Asleep, and the holder may sleep through its window", () => {
  /** Lullaby declared from a chosen rng cursor. The attack ENDS the turn, so the first
      Pokémon Checkup (both Actives flip, §13.3) runs inside this action; the cursor
      is set BEFORE it because Lullaby itself flips nothing. */
  function lulled(rngState?: number) {
    const start = ready({ attacker: "d546-lullaby" });
    const from = rngState === undefined ? start : { ...start, rngState };
    const { state, events } = attack(from, 0);
    return { start, state, events };
  }

  /** The first rng cursor at which BOTH Checkups (end of turn 3, end of turn 4) leave
      the holder in `rotation` at the start of its window, turn 5. */
  function throughCheckups(rotation: "asleep" | "none"): GameState {
    for (let rngState = 1; rngState < 400; rngState++) {
      const window = pass(lulled(rngState).state, "p2");
      if (body(window.players.p1.active).conditions.rotation === rotation) return window;
    }
    throw new Error(`no cursor leaves the holder ${rotation}`);
  }

  it("puts BOTH Actives to sleep — defender row first, then self — and installs the 100", () => {
    const { start, state, events } = lulled();
    const applied = all(events, "STATUS_APPLIED");
    expect(applied.map((e) => [e.seat, e.status])).toEqual([
      ["p2", "asleep"],
      ["p1", "asleep"],
    ]);
    const order = events.map((e) => e.type);
    expect(order.lastIndexOf("STATUS_APPLIED")).toBeLessThan(order.indexOf("ATTACK_BOOSTED"));
    // …and both are really on the board: the Checkup at the end of this turn flips
    // for BOTH Actives (two asleep flips), because both were Asleep when it ran.
    expect(
      all(events, "CHECKUP_COIN_FLIP")
        .filter((e) => e.status === "asleep")
        .map((e) => e.seat)
        .sort(),
    ).toEqual(["p1", "p2"]);
    expect(state.players.p1.active?.boostedAttack).toStrictEqual({
      turn: start.turn + 2,
      attackIndex: null,
      amount: 100,
    });
  });

  it("the holder FAILS both Checkup flips, cannot attack at T+2, and the buff LAPSES unused", () => {
    const window = throughCheckups("asleep");
    expect(window.turn).toBe(5);
    expect(boostedAttackDamage(window, body(window.players.p1.active), STRIKE)).toBe(100);
    const refused = applyAction(window, { type: "attack", seat: "p1", index: STRIKE });
    expect(refused.ok).toBe(false);
    // The window closes with nothing paid: two turns on, the stamp no longer answers.
    const later = pass(pass(window, "p1"), "p2");
    expect(later.turn).toBe(7);
    expect(boostedAttackDamage(later, body(later.players.p1.active), STRIKE)).toBe(0);
  });

  it("the holder WAKES and pays +100 on both of its damage attacks", () => {
    const window = throughCheckups("none");
    expect(window.turn).toBe(5);
    expect(find(attack(window, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + 100);
    expect(find(attack(window, SWIPE).events, "DAMAGE_DEALT")?.dealt).toBe(20 + 100);
  });

  it("§11: the opponent's shield refuses ONLY the defender half — the holder still sleeps, the buff installs", () => {
    const start = attachFromDeck(ready({ attacker: "d546-lullaby" }), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, 0);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(all(events, "STATUS_APPLIED").map((e) => [e.seat, e.status])).toEqual([["p1", "asleep"]]);
    // The Checkup flips for the holder alone — the defender never fell Asleep.
    expect(
      all(events, "CHECKUP_COIN_FLIP")
        .filter((e) => e.status === "asleep")
        .map((e) => e.seat),
    ).toEqual(["p1"]);
    expect(body(state.players.p2.active).conditions.rotation).toBe("none");
    expect(state.players.p1.active?.boostedAttack?.amount).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §10 sheds it: the clears the record already rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — retreat, a forced switch, evolution and devolution each clear it", () => {
  it("RETREATING inside the window sheds it", () => {
    const window = inWindow(installed().state);
    const { state } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      discardEnergy: body(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    const wasActive = state.players.p1.bench.at(-1);
    expect(state.cardIdByUid[wasActive?.stack[0] ?? ""]).toBe("d546-buffer");
    expect(wasActive?.boostedAttack ?? null).toBeNull();
  });

  it("a FORCED switch (Boss's Orders, the opponent's route) sheds it", () => {
    const state = handFromDeck(installed().state, "p2", "sv02-172", 1);
    const boostedUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    // The switch must actually HAPPEN — without this guard a Boss's Orders that
    // failed to gust would leave `benched` undefined and the rung vacuously green.
    expect(gusted.players.p1.active?.stack.includes(boostedUid)).toBe(false);
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(boostedUid));
    expect(benched).toBeDefined();
    expect(benched?.boostedAttack ?? null).toBeNull();
  });

  it("EVOLVING sheds it — the evolved card's Strike does its printed 50", () => {
    const window = inWindow(installed().state);
    const held = handFromDeck(window, "p1", "d546-buffer-evolved", 1);
    const { state } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "d546-buffer-evolved"),
      target: { spot: "active" },
    });
    expect(state.players.p1.active?.boostedAttack).toBeNull();
    expect(find(attack(state, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("DEVOLVING (the opponent's `devolveEach`) sheds it", () => {
    // Evolve on turn 5, install there, and devolve on the opponent's turn 6.
    let state = pass(pass(ready(), "p1"), "p2");
    const held = handFromDeck(state, "p1", "d546-buffer-evolved", 1);
    state = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "d546-buffer-evolved"),
      target: { spot: "active" },
    }).state;
    state = attack(state, REV_UP).state;
    expect(state.players.p1.active?.boostedAttack?.attackIndex).toBeNull();
    const result = runProgram(state, [{ op: "devolveEach" }], { seat: "p2", invokedBy: "attack" }, []);
    if (result.kind !== "done") throw new Error("devolveEach parked");
    const devolved = body(result.state.players.p1.active);
    expect(result.state.cardIdByUid[devolved.stack.at(-1) ?? ""]).toBe("d546-buffer");
    expect(devolved.boostedAttack).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the merge (constructed — unreachable off any printing) and the refusals.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — null is an ADDRESS: it merges with itself and replaces a named one", () => {
  const ALL = (amount: number): EffectOp => ({ op: "boostAttack", attack: null, amount });
  const NAMED: EffectOp = { op: "boostAttack", attack: "Strike", amount: 30 };

  it("null + null merges by max; a smaller or equal re-install is silent", () => {
    const loud: GameEvent[] = [];
    let s = runOne(ready(), [ALL(100)], loud);
    s = runOne(s, [ALL(120)], loud);
    expect(all(loud, "ATTACK_BOOSTED").map((e) => e.amount)).toEqual([100, 120]);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({ turn: 5, attackIndex: null, amount: 120 });
    const quiet: GameEvent[] = [];
    const again = runOne(s, [ALL(100)], quiet);
    expect(quiet).toEqual([]);
    expect(again).toBe(s);
  });

  it("named THEN null: the null address replaces the named record outright", () => {
    let s = runOne(ready(), [NAMED], []);
    s = runOne(s, [ALL(120)], []);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({ turn: 5, attackIndex: null, amount: 120 });
  });

  it("null THEN named: the named address replaces the all-attacks record outright", () => {
    let s = runOne(ready(), [ALL(120)], []);
    s = runOne(s, [NAMED], []);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({ turn: 5, attackIndex: STRIKE, amount: 30 });
  });

  it("a BAR and an all-attacks buff on one body: the barred attack is refused, the other pays +120", () => {
    // Constructed: a self-bar on Strike beside the buff. D157's OPPONENT-chosen bar
    // (stamped `turn + 1` from the opponent's turn) is the route by which the two can
    // be live together in play — types.ts `BoostedAttack` records the re-read.
    let s = runOne(ready(), [ALL(BUFF)], []);
    s = runOne(s, [{ op: "preventAttackUse", attack: "Strike" }], []);
    const window = inWindow(pass(s, "p1"));
    expect(applyAction(window, { type: "attack", seat: "p1", index: STRIKE }).ok).toBe(false);
    expect(find(attack(window, SWIPE).events, "DAMAGE_DEALT")?.dealt).toBe(20 + BUFF);
  });

  it("🛑 a constructed `{ attack: null, base: true }` is REFUSED whole — no record, no row", () => {
    const start = ready();
    const events: GameEvent[] = [];
    const after = runOne(start, [{ op: "boostAttack", attack: null, amount: 240, base: true }], events);
    expect(after).toBe(start);
    expect(events).toEqual([]);
  });

  it("`boostedAttackBase` answers null on every index of an all-attacks record", () => {
    const window = inWindow(installed().state);
    const holder = body(window.players.p1.active);
    for (const i of [REV_UP, STRIKE, SWIPE]) expect(boostedAttackBase(window, holder, i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the log row.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the row names no attack, under both seats, and never prints 'null'", () => {
  it("renders the install as \"'s attacks do 120 more damage next turn\"", () => {
    const { state, events } = installed();
    const rows = render(events, state);
    expect(rows).toContainEqual({ who: "p1", text: "d546-buffer's attacks do 120 more damage next turn" });
    expect(rows.some((r) => r.text.includes("null"))).toBe(false);
    const boosted = find(events, "ATTACK_BOOSTED");
    expect(render(boosted === undefined ? [] : [{ ...boosted, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "d546-buffer's attacks do 120 more damage next turn" },
    ]);
  });

  it("the NAMED and BASE-SET rows are unchanged — the branch keys on `attack === null` alone", () => {
    const { state, events } = installed();
    const uid = find(events, "ATTACK_BOOSTED")?.uid ?? "";
    expect(
      render([{ type: "ATTACK_BOOSTED", seat: "p1", uid, attack: "Strike", amount: 30 }], state),
    ).toEqual([{ who: "p1", text: "d546-buffer's Strike does 30 more damage next turn" }]);
    expect(
      render(
        [{ type: "ATTACK_BOOSTED", seat: "p1", uid, attack: "Strike", amount: 240, base: true }],
        state,
      ),
    ).toEqual([{ who: "p1", text: "d546-buffer's Strike's base damage is 240 next turn" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION` stays 30, driven over SERIALIZED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — `MATCH_RECORD_VERSION` STAYS 30: the null value round-trips, and a rollback reads it as inert", () => {
  it("🛑 the bytes this deploy writes round-trip and pay every index", () => {
    const window = inWindow(installed().state);
    const wire = JSON.stringify(window.players.p1.active?.boostedAttack);
    expect(wire).toBe(`{"turn":5,"attackIndex":null,"amount":${String(BUFF)}}`);
    const revived = withRawBoost(window, JSON.parse(wire) as BoostedAttack);
    expect(find(attack(revived, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + BUFF);
    expect(find(attack(revived, SWIPE).events, "DAMAGE_DEALT")?.dealt).toBe(20 + BUFF);
  });

  it("🛑 a v30 (numbered) record still means ONE attack", () => {
    const window = inWindow(installed().state);
    const v30 = JSON.parse(`{"turn":5,"attackIndex":${String(STRIKE)},"amount":30}`) as BoostedAttack;
    const legacy = withRawBoost(window, v30);
    expect(find(attack(legacy, STRIKE).events, "DAMAGE_DEALT")?.dealt).toBe(50 + 30);
    expect(find(attack(legacy, SWIPE).events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(everyAttackBoostOf(legacy, body(legacy.players.p1.active))).toBe(0);
  });

  it("ROLLBACK (an ILLUSTRATION, not a rung): the v30 reader's expression pays 0 on every index of a null record", () => {
    // ⚠️ WHAT THIS DOES AND DOES NOT PROVE. `v30Reader` below is a LOCAL COPY of the D155
    // compare a v30 deploy runs, evaluated against the revived bytes; no engine change can
    // turn it red (only the trailing `engineVersion` line can). It illustrates the D456
    // argument — the buff is LOST (inert), never mis-paid onto one attack — and nothing
    // more. The RED-CAPABLE proof is the mutant `D546-reader-pays-null-nowhere`, whose
    // replace is 8e2cdfe7's `boostedAttackDamage` line byte for byte: it puts the v30
    // expression INSIDE the engine, and the boards of §3 and §9 kill it because the engine then pays 0
    // on every index of a null record — which is exactly what a rollback deploy computes.
    const revived = JSON.parse(`{"turn":5,"attackIndex":null,"amount":${String(BUFF)}}`) as {
      turn: number;
      attackIndex: number | null;
      amount: number;
    };
    const v30Reader = (index: number, turn: number) =>
      revived.turn !== turn || revived.attackIndex !== index ? 0 : revived.amount;
    for (const i of [REV_UP, STRIKE, SWIPE, REST, PICK_OFF, SPRAY]) expect(v30Reader(i, 5)).toBe(0);
    // …and the version is a widening, not a bump.
    expect(engineVersion).toBe("0.433.0");
  });
});
