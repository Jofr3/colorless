import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { weaknessOf } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { installedWeaknessRetypeOf } from "./continuous";
import * as effects from "./effects";
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
import type { WeaknessRetype } from "./types";

// 0.435.0 → 0.436.0 — 🆕🆕🆕 D552 (the RIDER), THE WEAKNESS RETYPE:
//
//   "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The
//    amount of Weakness doesn't change.)"
//
// `censusAttackCorpus.ts` FILE LINE 629 (leading count column 1): 1 sentence / 1 legal
// printing — OPAQUE at SUBMAX=12 before this slice, carried as "the rider for the NEXT record
// bump" since D548 and taken WITH `:569`'s bump. Claimed WHOLE by `deriveAttackEffect` through
// ONE new zero-capture anchor (`DEFENDER_WEAKNESS_RETYPED`, TWO `['’]` slots) and ONE new arm
// (19f''') emitting ONE new op, `retypeDefenderWeakness { type: "Colorless" }` — D547's
// `exposeDefender` cloned for holder, stamp and guards. The installer writes
// `InPlayPokemon.weaknessRetype = { turn: T+2, type }` on the OPPONENT's Active; cards.ts
// `weaknessOf` keeps the printed AMOUNT and swaps the TYPE, at BOTH Weakness sites, AFTER
// their three null paths.
//
// RULINGS (docs/decisions.md D552, each with its reversal condition):
//   R1 — the window is the stamp T+2; the printed "Until the end of" also covers the rest of
//        the installing turn and the holder's own turn, where no Weakness step can reach the
//        body (§3 pins the dead turns).
//   R2 — ⚠️ UNRULED: a defender that prints NO Weakness stays not-weak (no amount to keep).
//   R3 — the three null paths win: a nulled Weakness stays null (§4).
//   R4 — on-target, so the main hit's `suppressTargetEffects` drops it and the PRINTED type
//        applies; the snipe's `ignoreWR` nulls Weakness outright (§4).
//   R5 — §10: retreat, a Switch, evolving, a forced switch and devolving each shed it; a
//        same-window re-install of the same type is silent; only the FIRST printed entry is
//        retyped (§5, §7).
//
// ⚠️ NO REAL CARD ID RESOLVES FOR THE SENTENCE ON THIS CHECKOUT (measured, `git grep`, D425:
// no `registry.ts` or `catalogManifest.ts` row prints it). Its only `testFixtures.ts` carrier
// is the DECLARED sweep fixture `fix-tideattach` (index 1), added by this slice for the
// `FIXTURE_POOL` sweeps and unused here (`fix-nowk` index 2 printed it at HEAD and was moved
// off it). Every board rides file-local DECLARED `d552-*` demonstrators in their own 60-card
// deck (D270). The real card is UNMEASURED.

const S629 =
  "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)";
const P629: readonly EffectOp[] = [{ op: "retypeDefenderWeakness", type: "Colorless" }];

const MARK = 0; // {C}, 10 — the installer (:629)
const STRIKE = 1; // {C}{C}, 50
const PICK_OFF = 2; // {C}, a chosen 30 onto any of the opponent's Pokémon (the snipe site)
const CLEAN = 3; // {C}{C}, 50, "isn't affected by Weakness or Resistance" (a null path)
const SHRED = 4; // {C}{C}, 50, "isn't affected by any effects on your opponent's Active Pokémon"

const LOCAL_CARDS: Record<string, Card> = {
  /** A {C} body: the retyped Weakness NAMES its type, so its hits are the ones that move. */
  "d552-marker": battler("d552-marker", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Mark", damage: 10, effect: S629 },
      { cost: ["Colorless", "Colorless"], name: "Strike", damage: 50 },
      {
        cost: ["Colorless"],
        name: "Pick Off",
        effect:
          "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Clean Strike",
        damage: 50,
        effect: "This attack's damage isn't affected by Weakness or Resistance.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Shred",
        damage: 50,
        effect: "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
      },
    ],
  }),
  /** A {R} body — the defender's PRINTED Weakness type. */
  "d552-ember": battler("d552-ember", {
    types: ["Fire"],
    hp: 300,
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Strike", damage: 50 }],
  }),
  /** ×2 {R}: the printed Weakness the retype re-points. */
  "d552-wall": battler("d552-wall", {
    types: ["Grass"],
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  "d552-wall-evolved": battler("d552-wall-evolved", {
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "d552-wall",
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  /** +20 {R}: an ADDITIVE printed amount, which "doesn't change". */
  "d552-plus-wall": battler("d552-plus-wall", {
    types: ["Grass"],
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "+20" }],
  }),
  /** No printed Weakness at all — R2's board. */
  "d552-no-weak": battler("d552-no-weak", { types: ["Grass"], hp: 900, retreat: 1 }),
  "d552-bench": battler("d552-bench", { types: ["Grass"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d552-marker": 4,
  "d552-ember": 2,
  "d552-wall": 4,
  "d552-wall-evolved": 2,
  "d552-plus-wall": 2,
  "d552-no-weak": 2,
  "d552-bench": 6,
  "sv01-194": 4, // Switch — the victim's own switch clear
  "fix-mist-energy": 2, // the §11 shield
  "fix-energy": 32,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260928;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
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

/** P1's turn 3: P1 fields the marker with two Energy; P2 fields `defender` with one
    Energy and `p2Bench` benched bodies. */
function ready(opts: { defender?: string; p2Bench?: number } = {}): GameState {
  const { defender = "d552-wall", p2Bench = 1 } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "d552-marker");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  for (let i = 0; i < p2Bench; i++) state = benchFromDeck(state, "p2", "d552-bench");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

/** `ready`, then Mark DECLARED on turn 3 — returns P2's turn 4 (the holder's turn). */
function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, MARK);
  if (find(events, "WEAKNESS_RETYPED") === undefined) throw new Error("Mark installed nothing");
  return { start, state, events };
}

/** The installer's own next turn — THE window (turn 5). */
const inWindow = (state: GameState): GameState => pass(state, "p2");

/** Swap P1's Active for a fresh `cardId` carrying two Energy (surgery, turn-neutral). */
function attackerAs(state: GameState, cardId: string): GameState {
  let next = setActiveFromDeck(state, "p1", cardId);
  next = attachFromDeck(next, "p1", "fix-energy", 2);
  return next;
}

function runAs(state: GameState, seat: Seat, program: readonly EffectOp[], events: GameEvent[]) {
  const result = runProgram(state, program, { seat, invokedBy: "attack" }, events);
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

const dealt = (events: GameEvent[]): number | undefined => find(events, "DAMAGE_DEALT")?.dealt;

type Reader = (text: string) => unknown;
function claimants(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, Reader | undefined>)[name];
    if (read === undefined) throw new Error(`reader surface names a missing export: ${name}`);
    return read(text) !== null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims the row WHOLE, and only it", () => {
  it("is a corpus row, ONCE, at ONE printing — and the ONLY row the anchor claims", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === S629);
    expect(rows.map(([n]) => n)).toEqual([1]);
    const claimed = legalAttackCorpus().filter(
      ([, s]) => (deriveAttackEffect(s) ?? []).some((op) => op.op === "retypeDefenderWeakness"),
    );
    expect(claimed.map(([, s]) => s)).toEqual([S629]);
  });

  it("🛑 derives to the ONE op, by value, and `deriveAttackEffect` is the only claimant", () => {
    expect(deriveAttackEffect(S629)).toEqual(P629);
    expect(claimants(S629)).toEqual(["deriveAttackEffect"]);
    expect(resolvedByAnyReader(S629)).toBe(true);
  });

  it("the apostrophes are U+0027 in the corpus, and the curly form reads on BOTH slots (D136/D137)", () => {
    expect([...S629].filter((c) => c === "'")).toHaveLength(2);
    const curly = S629.replaceAll("'", "’");
    expect(curly).not.toContain("'");
    expect(deriveAttackEffect(curly)).toEqual(P629);
  });

  it("WHOLE-SENTENCE: leading text, trailing text, case, the reminder and the period each refuse", () => {
    for (const text of [
      `Draw a card. ${S629}`,
      `${S629} Draw a card.`,
      S629.toLowerCase(),
      "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}.",
      S629.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("each near-miss differs on ONE axis and is refused — the positive control first", () => {
    expect(deriveAttackEffect(S629)).not.toBeNull();
    for (const text of [
      S629.replace("{C}", "{R}"), // the TYPE
      S629.replace("your next turn", "your opponent's next turn"), // the WINDOW
      S629.replace("the Defending Pokémon's", "this Pokémon's"), // the HOLDER
      S629.replace("Weakness is now", "Resistance is now"), // the STEP
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install writes `{ turn: T+2, type }` on the DEFENDER, and says so", () => {
  it("🛑 the record is on P2's Active, stamped T+2 = 5, and the attacker carries none", () => {
    const { state } = installed();
    expect(state.turn).toBe(4);
    expect(body(state.players.p2.active).weaknessRetype).toEqual({ turn: 5, type: "Colorless" });
    expect(body(state.players.p1.active).weaknessRetype).toBeNull();
  });

  it("WEAKNESS_RETYPED is filed under the HOLDER, and the row reads in its voice", () => {
    const { state, events } = installed();
    const row = find(events, "WEAKNESS_RETYPED");
    expect(row).toEqual({
      type: "WEAKNESS_RETYPED",
      seat: "p2",
      uid: activeUid(state, "p2"),
      weaknessType: "Colorless",
    });
    const rendered = render(events, state).find((r) => r.text.includes("Weakness is now"));
    expect(rendered).toEqual({
      who: "p2",
      text: "d552-wall's Weakness is now Colorless until the end of your opponent's next turn (the amount doesn't change)",
    });
  });

  it("the installing attack's own 10 is dealt at the PRINTED Weakness (the ORDER keeps it there: the program installs AFTER DAMAGE_DEALT)", () => {
    // attack.ts §8 step 4 runs the attack's own program AFTER the damage step, so the
    // retype is written after the hit is already dealt. This rung is blind to the STAMP
    // (a stamp of T or T+1 would still deal 10 here); §2's `{ turn: 5 }` rung and §3's
    // window rungs are the ones that pin the stamp.
    const { events } = installed();
    const types = events.map((e) => e.type);
    expect(types.indexOf("DAMAGE_DEALT")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("DAMAGE_DEALT")).toBeLessThan(types.indexOf("WEAKNESS_RETYPED"));
    expect(dealt(events)).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the window and the number.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — live on T+2 only, and it re-points the TYPE while keeping the AMOUNT", () => {
  it("🛑 T+2: a {C} attacker's 50 is ×2 → 100; a {R} attacker's 50 is NOT weak any more → 50", () => {
    const window = inWindow(installed().state);
    expect(window.turn).toBe(5);
    expect(dealt(attack(window, STRIKE).events)).toBe(100);
    expect(dealt(attack(attackerAs(window, "d552-ember"), 0).events)).toBe(50);
  });

  it("the reader answers on T+2 ONLY — null on T+4 (the stamp is a single turn)", () => {
    const window = inWindow(installed().state);
    const holder = body(window.players.p2.active);
    expect(installedWeaknessRetypeOf(window, holder)).toBe("Colorless");
    expect(installedWeaknessRetypeOf({ ...window, turn: 4 }, holder)).toBeNull();
    expect(installedWeaknessRetypeOf({ ...window, turn: 7 }, holder)).toBeNull();
  });

  it("T+4 (the installer's NEXT-next turn): back to the PRINTED type — {C} 50, {R} 100", () => {
    const after = pass(attack(inWindow(installed().state), STRIKE).state, "p2");
    expect(after.turn).toBe(7);
    expect(dealt(attack(after, STRIKE).events)).toBe(50);
    expect(dealt(attack(attackerAs(after, "d552-ember"), 0).events)).toBe(100);
  });

  it("🛑 'The amount of Weakness doesn't change': a printed +20 {R} becomes +20 {C} → 70, not ×2", () => {
    const window = inWindow(installed({ defender: "d552-plus-wall" }).state);
    expect(dealt(attack(window, STRIKE).events)).toBe(70);
  });

  it("⚠️ R2 (UNRULED): a defender that prints NO Weakness stays not-weak → 50", () => {
    const window = inWindow(installed({ defender: "d552-no-weak" }).state);
    expect(body(window.players.p2.active).weaknessRetype?.type).toBe("Colorless");
    expect(dealt(attack(window, STRIKE).events)).toBe(50);
  });

  it("cards.ts `weaknessOf` keeps the FIRST entry's value and swaps its type; absent/null = printed", () => {
    const attacker = LOCAL_CARDS["d552-marker"] as Card;
    const wall = LOCAL_CARDS["d552-wall"] as Card;
    expect(weaknessOf(attacker, wall)).toBeNull();
    expect(weaknessOf(attacker, wall, null)).toBeNull();
    expect(weaknessOf(attacker, wall, "Colorless")).toEqual({ op: "multiply", amount: 2 });
    const twoEntries = { ...wall, weaknesses: [...(wall.weaknesses ?? []), { type: "Colorless", value: "+30" }] };
    // ONLY the first printed entry is retyped (R5): its ×2 names {C}; the second is dropped.
    expect(weaknessOf(attacker, twoEntries, "Colorless")).toEqual({ op: "multiply", amount: 2 });
    expect(weaknessOf(LOCAL_CARDS["d552-ember"] as Card, wall, "Colorless")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the null paths, the suppression and the snipe site.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the three null paths win (R3), `suppressTargetEffects` drops it (R4), and the SNIPE site reads it", () => {
  it("🛑 R3: 'isn't affected by Weakness or Resistance' — the retyped ×2 is NOT applied → 50", () => {
    const window = inWindow(installed().state);
    expect(dealt(attack(window, CLEAN).events)).toBe(50);
  });

  it("🛑 R3: D432's installed no-Weakness bar on the same body (constructed) — null wins → 50", () => {
    const window = inWindow(installed().state);
    const holder = body(window.players.p2.active);
    const barred = {
      ...window,
      players: { ...window.players, p2: { ...window.players.p2, active: { ...holder, noWeaknessTurn: window.turn } } },
    };
    expect(dealt(attack(barred, STRIKE).events)).toBe(50);
  });

  it("🛑 R4: 'isn't affected by any effects on your opponent's Active Pokémon' — the PRINTED type applies → 50 from {C}", () => {
    const window = inWindow(installed().state);
    expect(dealt(attack(window, SHRED).events)).toBe(50);
  });

  it("🛑 THE SNIPE SITE (`snipeActive`), driven on its OWN board: a chosen 30 onto the Active is ×2 → 60", () => {
    const window = inWindow(installed().state);
    const parked = attack(window, PICK_OFF).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(dealt(done.events)).toBe(60);
  });

  it("the snipe site's printed-type control: the same 30 on T+4 is NOT weak → 30", () => {
    const after = pass(attack(inWindow(installed().state), STRIKE).state, "p2");
    const parked = attack(after, PICK_OFF).state;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(dealt(done.events)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §10 clears (R5).
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — retreat, a Switch, evolution, a forced switch and devolution each clear it (R5)", () => {
  function benchedRetyped(state: GameState, uid: string): InPlayPokemon {
    expect(state.players.p2.active?.stack.includes(uid)).toBe(false);
    const benched = state.players.p2.bench.find((p) => p.stack.includes(uid));
    expect(benched).toBeDefined();
    return body(benched);
  }

  it("RETREAT on turn 4 (played): the benched body carries nothing", () => {
    const victim = installed().state;
    const uid = activeUid(victim, "p2");
    const { state } = mustApply(victim, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(victim.players.p2.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(benchedRetyped(state, uid).weaknessRetype).toBeNull();
  });

  it("SWITCH on turn 4 (the victim's Item): the switched-out body carries nothing", () => {
    const at = installed().state;
    const victim = at.players.p2.hand.some((u) => at.cardIdByUid[u] === "sv01-194")
      ? at
      : handFromDeck(at, "p2", "sv01-194", 1);
    const uid = activeUid(victim, "p2");
    let state = mustApply(victim, { type: "playTrainer", seat: "p2", uid: handUid(victim, "p2", "sv01-194") }).state;
    if (state.phase.kind === "effect:choose") {
      state = must(
        applyAction(state, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(benchedRetyped(state, uid).weaknessRetype).toBeNull();
  });

  it("🛑 EVOLVE on turn 4 (played): the evolved card keeps its PRINTED type at T+2 — {C} 50", () => {
    const victim = handFromDeck(installed().state, "p2", "d552-wall-evolved", 1);
    const { state } = mustApply(victim, {
      type: "evolve",
      seat: "p2",
      uid: handUid(victim, "p2", "d552-wall-evolved"),
      target: { spot: "active" },
    });
    expect(body(state.players.p2.active).weaknessRetype).toBeNull();
    expect(dealt(attack(inWindow(state), STRIKE).events)).toBe(50);
  });

  it("FORCED switch (`switchInto` through a gust — constructed)", () => {
    const victim = installed().state;
    const uid = activeUid(victim, "p2");
    const state = runAs(victim, "p1", [{ op: "gust" }], []);
    expect(benchedRetyped(state, uid).weaknessRetype).toBeNull();
  });

  it("DEVOLVE (`devolvedBodyOf`) sheds it too", () => {
    let state = pass(ready(), "p1");
    state = handFromDeck(state, "p2", "d552-wall-evolved", 1);
    state = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "d552-wall-evolved"),
      target: { spot: "active" },
    }).state;
    state = pass(state, "p2");
    state = runAs(state, "p1", P629, []);
    expect(state.players.p2.active?.weaknessRetype?.type).toBe("Colorless");
    state = runAs(state, "p1", [{ op: "devolveEach" }], []);
    const devolved = body(state.players.p2.active);
    expect(state.cardIdByUid[devolved.stack.at(-1) ?? ""]).toBe("d552-wall");
    expect(devolved.weaknessRetype).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §11, and §7 — the merge.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a §11 shield refuses the install", () => {
  it("Mist Energy on the Defending Pokémon: refused, announced, nothing written", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, MARK);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(find(events, "WEAKNESS_RETYPED")).toBeUndefined();
    expect(body(state.players.p2.active).weaknessRetype).toBeNull();
  });
});

describe("§7 — a same-window re-install of the same type is silent; a different type replaces (constructed)", () => {
  it("the same type twice: ONE row, one record", () => {
    const start = ready();
    const events: GameEvent[] = [];
    const once = runAs(start, "p1", P629, events);
    const twice = runAs(once, "p1", P629, events);
    expect(events.filter((e) => e.type === "WEAKNESS_RETYPED")).toHaveLength(1);
    expect(body(twice.players.p2.active).weaknessRetype).toEqual({ turn: start.turn + 2, type: "Colorless" });
  });

  it("a different type REPLACES (no order on a type) and says so", () => {
    const start = ready();
    const events: GameEvent[] = [];
    const once = runAs(start, "p1", P629, events);
    const other = runAs(once, "p1", [{ op: "retypeDefenderWeakness", type: "Water" }], events);
    expect(events.filter((e) => e.type === "WEAKNESS_RETYPED")).toHaveLength(2);
    expect(body(other.players.p2.active).weaknessRetype).toEqual({ turn: start.turn + 2, type: "Water" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the v34 bytes and the v33 reject (D326/D124).
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the v34 bytes round-trip, and a v33-shaped body is why the version moved", () => {
  it("🛑 v34: the record is in the serialized state, and a JSON round-trip still pays", () => {
    const window = inWindow(installed().state);
    const bytes = JSON.stringify(window);
    expect(bytes.includes('"weaknessRetype":{"turn":5,"type":"Colorless"}')).toBe(true);
    const revived = JSON.parse(bytes) as GameState;
    expect(dealt(attack(revived, STRIKE).events)).toBe(100);
  });

  it("🛑 v33-SHAPED body (the key genuinely ABSENT): the first main hit THROWS (D326)", () => {
    const revived = JSON.parse(JSON.stringify(inWindow(installed().state))) as GameState;
    const target = body(revived.players.p2.active) as Partial<InPlayPokemon>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT, which is what a v33 record looks like (D124).
    delete target.weaknessRetype;
    expect("weaknessRetype" in target).toBe(false);
    // `undefined === null` is false, so the reader dereferences `.turn` of undefined — on
    // every main hit that reads target effects into ANY v33 body, retyped or not (a
    // `suppressTargetEffects` hit skips the reader and does not throw). Retiring the record (apps/api
    // match.ts, THE SEVENTH POSITION) is the only safe answer.
    expect(() => applyAction(revived, { type: "attack", seat: "p1", index: STRIKE })).toThrow(TypeError);
  });

  it("…and a ROLLBACK (v33) reading a v34 record DROPS the live retype: the {C} hit pays the printed 50", () => {
    // ⚠️ AN ILLUSTRATION of THE SEVENTH POSITION's D456 test, evaluated on the revived bytes:
    // a v33 `weaknessOf(attacker, defender)` has no third argument, so the retyped body is
    // hit at its PRINTED type — a live effect silently missing, NOT inert. The red-capable
    // proof in the engine is the mutant `D552-main-hit-retype-not-read`.
    const window = inWindow(installed().state);
    const revived = JSON.parse(JSON.stringify(window)) as GameState;
    const record = body(revived.players.p2.active).weaknessRetype as WeaknessRetype;
    expect(record).toEqual({ turn: 5, type: "Colorless" });
    const v33 = weaknessOf(LOCAL_CARDS["d552-marker"] as Card, LOCAL_CARDS["d552-wall"] as Card);
    expect(v33).toBeNull();
  });

  it("the engine version stepped to 0.497.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.497.0");
    expect(manifest.version).toBe("0.497.0");
  });
});
