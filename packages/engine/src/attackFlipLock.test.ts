import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus } from "./censusAttackCorpus";
import { attackFlipLocked, attackLocked } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { type CoinFace, flipCoin } from "./rng";
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

// 0.431.0 → 0.432.0 — D547 (A), THE FLIP-TO-ATTACK LOCK:
//
//   "During your opponent's next turn, if the Defending Pokémon tries to use an
//    attack, your opponent flips a coin. If tails, that attack doesn't happen."
//
// `censusAttackCorpus.ts` FILE LINE 176 (leading count column 2): ONE row, TWO
// sentences, 2 legal printings — OPAQUE at SUBMAX=12 before this slice. Claimed WHOLE
// by `deriveAttackEffect` through ONE new anchor (`DEFENDER_FLIP_ATTACK_LOCK`, two
// `['’]` slots, no capture) and ONE new arm (26e) emitting ONE new op,
// `flipLockAttack` — field-free, defender-only. The installer stamps
// `InPlayPokemon.attackFlipLockTurn = turn + 1`; `attack.ts` flips at the §8 step-3
// seam, BEFORE the Confusion flip — the official rulebook's "Full details of
// attacking" step B ("Apply any effects that might alter or cancel the attack",
// whose printed example is this sentence family) precedes step C, the Confusion
// check (docs/decisions.md D547 ruling 1).
//
// ⚠️ NO CATALOG, REGISTRY OR FIXTURE ID PRINTS THE SENTENCE ON THIS CHECKOUT, AND THAT
// WAS MEASURED (D425, `git grep`). Every board rides file-local DECLARED `d547-*`
// demonstrators in their OWN 60-card deck (D270). Which two real printings are legal
// is UNMEASURED; nothing here claims their attacks, costs or damage.
//
// Sections: §1 the derivation · §2 the install · §3 heads and tails · §4 the window ·
// §5 the rng is spent only while the lock is live · §6 the lock before Confusion · §7 the hard
// lock still refuses first · §8 the declaration stays LEGAL (redact) · §9 the four
// §10 clears · §10 §11 · §11 the log rows · §12 the v31 bytes and the v30 reject.

const S176 =
  "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.";
const P176: readonly EffectOp[] = [{ op: "flipLockAttack" }];

const APPLY = 0; // {C}, 10 — the installer (:176)
const JAB = 0; // the target's {C}, 30
const NAP = 1; // the target's {C}, no damage — "Draw a card."

const TARGET_ATTACKS = [
  { cost: ["Colorless"], name: "Jab", damage: 30 },
  { cost: ["Colorless"], name: "Nap", effect: "Draw a card." },
] as Card["attacks"];

const LOCAL_CARDS: Record<string, Card> = {
  /** The `:176` installer, plus a plain second attack. */
  "d547-locker": battler("d547-locker", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Apply", damage: 10, effect: S176 },
      { cost: ["Colorless", "Colorless"], name: "Strike", damage: 50 },
    ],
  }),
  /** The Defending Pokémon: one damage attack and one no-damage attack. */
  "d547-target": battler("d547-target", {
    types: ["Fighting"],
    hp: 900,
    retreat: 1,
    attacks: TARGET_ATTACKS,
  }),
  /** Evolves from `d547-target` with the same attacks — the evolve clear. */
  "d547-target-evolved": battler("d547-target-evolved", {
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "d547-target",
    hp: 900,
    retreat: 1,
    attacks: TARGET_ATTACKS,
  }),
  "d547-bench": battler("d547-bench", {
    types: ["Fighting"],
    hp: 300,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Poke", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d547-locker": 4,
  "d547-target": 4,
  "d547-target-evolved": 2,
  "d547-bench": 6,
  "sv01-194": 2, // Switch — the victim's own switch clear
  "fix-mist-energy": 2, // the §11 shield
  "fix-energy": 40,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260926;

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

/** P1's turn 3: P1 fields the locker with two Energy; P2 fields the target with two
    Energy and one benched body (the retreat/switch destination). */
function ready(): GameState {
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "d547-locker");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = benchFromDeck(state, "p1", "d547-bench");
  state = setActiveFromDeck(state, "p2", "d547-target");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p2", "fix-energy", 2);
  state = benchFromDeck(state, "p2", "d547-bench");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

/** `ready`, then Apply DECLARED on turn 3 — returns P2's turn 4, THE window. */
function installed() {
  const start = ready();
  const { state, events } = attack(start, APPLY);
  if (find(events, "ATTACK_LOCKED") === undefined) throw new Error("Apply installed nothing");
  return { start, state, events };
}

/** The first rng cursor whose next flips come up `faces`, in order. */
function withFaces(state: GameState, faces: readonly CoinFace[]): GameState {
  for (let cursor = 1; cursor < 10_000; cursor++) {
    let rng = cursor;
    let ok = true;
    for (const want of faces) {
      const [face, next] = flipCoin(rng);
      if (face !== want) {
        ok = false;
        break;
      }
      rng = next;
    }
    if (ok) return { ...state, rngState: cursor };
  }
  throw new Error(`no cursor yields ${faces.join(",")}`);
}

/** The rng cursor after `n` flips from `from`. */
function advanced(from: number, n: number): number {
  let rng = from;
  for (let i = 0; i < n; i++) rng = flipCoin(rng)[1];
  return rng;
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

function confused(state: GameState): GameState {
  const active = body(state.players.p2.active);
  return {
    ...state,
    players: {
      ...state.players,
      p2: {
        ...state.players.p2,
        active: { ...active, conditions: { ...active.conditions, rotation: "confused" } },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims the TWO-sentence row WHOLE, and only it", () => {
  it("derives ONE field-free op, `flipLockAttack`", () => {
    expect(deriveAttackEffect(S176)).toEqual(P176);
    const op = (deriveAttackEffect(S176) ?? [])[0] as Record<string, unknown>;
    expect(Object.keys(op)).toEqual(["op"]);
  });

  it("the corpus row derives off the committed bytes, and it is the ONLY flip-lock row", () => {
    const hits = legalAttackCorpus().filter(([, text]) =>
      (deriveAttackEffect(text) ?? []).some((op) => op.op === "flipLockAttack"),
    );
    expect(hits).toEqual([[2, S176]]);
  });

  it("BOTH `['’]` slots take either spelling (D136/D137)", () => {
    for (const a of ["'", "’"]) {
      for (const b of ["'", "’"]) {
        const text = S176.replace("opponent's", `opponent${a}s`).replace("doesn't", `doesn${b}t`);
        expect(deriveAttackEffect(text), `${a}/${b}`).toEqual(P176);
      }
    }
  });

  it("refuses every single-axis near-miss, and neither sentence alone derives it", () => {
    const misses = [
      S176.replace("tries to use an attack", "tries to attack"), // the local-D1 spelling
      S176.replace("your opponent's next turn", "your next turn"),
      S176.replace("If tails,", "If heads,"),
      S176.replace("the Defending Pokémon", "this Pokémon"),
      S176.replace("that attack doesn't happen.", "that attack does nothing."),
      "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin.",
      "If tails, that attack doesn't happen.",
    ];
    for (const text of misses) {
      expect((deriveAttackEffect(text) ?? []).some((op) => op.op === "flipLockAttack"), text).toBe(
        false,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install stamps the DEFENDER at T+1 and nothing else", () => {
  it("writes `attackFlipLockTurn: 4` on P2's Active and leaves `attackLockedTurn` null", () => {
    const { start, state, events } = installed();
    expect(start.turn).toBe(3);
    const target = body(state.players.p2.active);
    expect(target.attackFlipLockTurn).toBe(4);
    expect(target.attackLockedTurn).toBeNull();
    expect(state.players.p1.active?.attackFlipLockTurn).toBeNull();
    const row = find(events, "ATTACK_LOCKED");
    expect(row).toEqual({ type: "ATTACK_LOCKED", seat: "p2", uid: activeUid(start, "p2"), flip: true });
  });

  it("consumes NO rng at the install — the coin belongs to the declaration it gates", () => {
    const start = ready();
    const events: GameEvent[] = [];
    const after = runAs(start, "p1", P176, events);
    expect(after.rngState).toBe(start.rngState);
  });

  it("a same-turn re-install is SILENT (one row, one stamp)", () => {
    const start = ready();
    const first: GameEvent[] = [];
    const once = runAs(start, "p1", P176, first);
    const again: GameEvent[] = [];
    const twice = runAs(once, "p1", P176, again);
    expect(all(first, "ATTACK_LOCKED")).toHaveLength(1);
    expect(again).toEqual([]);
    expect(twice.players.p2.active?.attackFlipLockTurn).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — heads resolves; tails fails and ENDS the turn.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the locked player flips at the declaration", () => {
  it("HEADS: the attack resolves normally", () => {
    const window = withFaces(installed().state, ["heads"]);
    const { events } = attack(window, JAB, "p2");
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toMatchObject({ seat: "p2", result: "heads" });
    expect(find(events, "ATTACK_FAILED")).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("TAILS: the attack doesn't happen — no damage, no counters — and the turn ENDS", () => {
    const window = withFaces(installed().state, ["tails"]);
    const p1Damage = body(window.players.p1.active).damage;
    // Apply's own printed 10 already sits on the target from turn 3.
    const p2Damage = body(window.players.p2.active).damage;
    const { state, events } = attack(window, JAB, "p2");
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toMatchObject({ seat: "p2", result: "tails" });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ seat: "p2", reason: "flipLock" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "COUNTERS_PLACED")).toBeUndefined();
    expect(body(state.players.p1.active).damage).toBe(p1Damage);
    expect(body(state.players.p2.active).damage).toBe(p2Damage);
    // The turn ended: P1's turn 5 has started.
    expect(find(events, "TURN_ENDED")).toMatchObject({ turn: 4, seat: "p2" });
    expect(state.turn).toBe(5);
  });

  it("TAILS on a no-damage attack stops its EFFECT too (no card drawn)", () => {
    const window = withFaces(installed().state, ["tails"]);
    const handBefore = window.players.p2.hand.length;
    const { state, events } = attack(window, NAP, "p2");
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("flipLock");
    expect(all(events, "CARDS_DRAWN").filter((e) => e.seat === "p2")).toEqual([]);
    expect(state.players.p2.hand).toHaveLength(handBefore);
    expect(events.map((e) => e.type)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the window is ONE turn.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — live on T+1 only", () => {
  it("is not live on the installer's own turn, and has expired by T+3", () => {
    const { start, state } = installed();
    expect(attackFlipLocked(start, body(runAs(start, "p1", P176, []).players.p2.active))).toBe(false);
    expect(attackFlipLocked(state, body(state.players.p2.active))).toBe(true);
    const later = pass(pass(state, "p2"), "p1");
    expect(later.turn).toBe(6);
    const target = body(later.players.p2.active);
    expect(target.attackFlipLockTurn).toBe(4); // the record is still there…
    expect(attackFlipLocked(later, target)).toBe(false); // …and no longer answers
    const cursor = later.rngState;
    const { events } = attack(later, JAB, "p2");
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(cursor).toBe(later.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the rng is spent ONLY while the lock is live.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — no lock, no coin", () => {
  it("an UNLOCKED declaration leaves the rng cursor where it was", () => {
    const start = pass(ready(), "p1"); // P2's turn 4, nothing installed
    const { state, events } = attack(start, NAP, "p2");
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toBeUndefined();
    // Nap draws a card and flips nothing, and the turn-end Checkup flips nothing on
    // a board with no Special Condition, so the cursor is untouched end to end.
    expect(state.rngState).toBe(start.rngState);
  });

  it("a LOCKED declaration spends EXACTLY one flip", () => {
    const window = withFaces(installed().state, ["heads"]);
    const { state } = attack(window, NAP, "p2");
    expect(state.rngState).toBe(advanced(window.rngState, 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the LOCK flips BEFORE Confusion (the rulebook's step B before step C,
// docs/decisions.md D547 ruling 1).
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — stacked with Confusion, in the rulebook's order", () => {
  it("lock TAILS: fails as `flipLock`, the Confusion coin is NEVER flipped, NO counters", () => {
    const window = withFaces(confused(installed().state), ["tails"]);
    const { state, events } = attack(window, JAB, "p2");
    expect(events.map((e) => e.type).filter((t) => t.endsWith("_CHECK"))).toEqual([
      "ATTACK_FLIP_LOCK_CHECK",
    ]);
    expect(all(events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["flipLock"]);
    expect(find(events, "COUNTERS_PLACED")).toBeUndefined();
    // Only Apply's printed 10 from turn 3 — no Confusion self-hit landed.
    expect(body(state.players.p2.active).damage).toBe(body(window.players.p2.active).damage);
    // Exactly ONE coin was drawn — the lock's; the Confusion check was never reached.
    expect(state.rngState).toBe(advanced(window.rngState, 1));
  });

  it("lock HEADS then Confusion TAILS: fails as `confusion`, and the Confusion counters land", () => {
    const window = withFaces(confused(installed().state), ["heads", "tails"]);
    const { state, events } = attack(window, JAB, "p2");
    const order = events.map((e) => e.type);
    expect(order.indexOf("ATTACK_FLIP_LOCK_CHECK")).toBeLessThan(order.indexOf("CONFUSION_CHECK"));
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")?.result).toBe("heads");
    expect(find(events, "CONFUSION_CHECK")?.result).toBe("tails");
    expect(all(events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["confusion"]);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ source: "confusion", amount: 30 });
    expect(body(state.players.p2.active).damage).toBe(body(window.players.p2.active).damage + 30);
    expect(state.rngState).toBe(advanced(window.rngState, 2));
  });

  it("lock HEADS then Confusion HEADS: the attack resolves", () => {
    const window = withFaces(confused(installed().state), ["heads", "heads"]);
    const { events } = attack(window, JAB, "p2");
    expect(events.map((e) => e.type).filter((t) => t.endsWith("_CHECK"))).toEqual([
      "ATTACK_FLIP_LOCK_CHECK",
      "CONFUSION_CHECK",
    ]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(find(events, "ATTACK_FAILED")).toBeUndefined();
  });

  it("an UNLOCKED Confused body's rng sequence is byte-identical to before (one flip)", () => {
    const start = withFaces(confused(pass(ready(), "p1")), ["heads"]);
    const { events } = attack(start, JAB, "p2");
    expect(events.map((e) => e.type).filter((t) => t.endsWith("_CHECK"))).toEqual([
      "CONFUSION_CHECK",
    ]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — a HARD lock still refuses the declaration, first.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `attackLocked` still REJECTS, before any coin", () => {
  it("both locks live: ATTACK_PREVENTED, nothing spent, no coin", () => {
    const start = ready();
    const both = pass(
      runAs(start, "p1", [{ op: "preventAttack", target: "defender" }, ...P176], []),
      "p1",
    );
    const target = body(both.players.p2.active);
    expect(attackLocked(both, target)).toBe(true);
    expect(attackFlipLocked(both, target)).toBe(true);
    const refused = applyAction(both, { type: "attack", seat: "p2", index: JAB });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the declaration stays LEGAL: redact.ts reads `attackLocked`, not this.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `playable` stays TRUE while only the flip lock is live", () => {
  it("the victim's panel offers every payable attack, and the server takes it", () => {
    const window = installed().state;
    const phase = redactGame(window, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    expect(phase.attacks.map((a) => a.playable)).toEqual([true, true]);
    expect(applyAction(withFaces(window, ["heads"]), { type: "attack", seat: "p2", index: JAB }).ok).toBe(
      true,
    );
    expect(attackLocked(window, body(window.players.p2.active))).toBe(false);
  });

  it("…while a HARD lock on the same board greys them (the control)", () => {
    const hard = pass(runAs(ready(), "p1", [{ op: "preventAttack", target: "defender" }], []), "p1");
    const phase = redactGame(hard, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    expect(phase.attacks.map((a) => a.playable)).toEqual([false, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the four §10 clears, each the VICTIM's line on its own turn.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — retreat, a Switch, evolution and a forced switch each clear it", () => {
  function benchedLocked(state: GameState, lockedUid: string): InPlayPokemon {
    expect(state.players.p2.active?.stack.includes(lockedUid)).toBe(false);
    const benched = state.players.p2.bench.find((p) => p.stack.includes(lockedUid));
    expect(benched).toBeDefined();
    return body(benched);
  }

  it("RETREAT: the retreated body carries no lock", () => {
    const window = installed().state;
    const lockedUid = activeUid(window, "p2");
    const { state } = mustApply(window, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(window.players.p2.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(benchedLocked(state, lockedUid).attackFlipLockTurn).toBeNull();
  });

  it("SWITCH (the victim's Item): the switched-out body carries no lock", () => {
    const window = handFromDeck(installed().state, "p2", "sv01-194", 1);
    const lockedUid = activeUid(window, "p2");
    let state = mustApply(window, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(window, "p2", "sv01-194"),
    }).state;
    if (state.phase.kind === "effect:choose") {
      state = must(
        applyAction(state, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(benchedLocked(state, lockedUid).attackFlipLockTurn).toBeNull();
  });

  it("EVOLVE: the evolved card attacks with no coin", () => {
    const window = handFromDeck(installed().state, "p2", "d547-target-evolved", 1);
    const { state } = mustApply(window, {
      type: "evolve",
      seat: "p2",
      uid: handUid(window, "p2", "d547-target-evolved"),
      target: { spot: "active" },
    });
    expect(body(state.players.p2.active).attackFlipLockTurn).toBeNull();
    const { events } = attack(state, JAB, "p2");
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("FORCED switch (`switchInto` through a gust — constructed: no printed line reaches it inside the window)", () => {
    const window = installed().state;
    const lockedUid = activeUid(window, "p2");
    // ONE benched body, so `parkOrForce` forces the pick and the program completes.
    expect(window.players.p2.bench).toHaveLength(1);
    const state = runAs(window, "p1", [{ op: "gust" }], []);
    expect(benchedLocked(state, lockedUid).attackFlipLockTurn).toBeNull();
  });

  it("DEVOLVE (`devolvedBodyOf`) sheds it too", () => {
    const start = ready();
    const held = handFromDeck(pass(pass(start, "p1"), "p2"), "p2", "d547-target-evolved", 1);
    // Turn 5 is P1's; evolve P2's body on turn 6 instead, then lock it on turn 7.
    let state = pass(held, "p1");
    state = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "d547-target-evolved"),
      target: { spot: "active" },
    }).state;
    state = pass(state, "p2");
    state = runAs(state, "p1", P176, []);
    expect(state.players.p2.active?.attackFlipLockTurn).toBe(state.turn + 1);
    state = runAs(state, "p1", [{ op: "devolveEach" }], []);
    const devolved = body(state.players.p2.active);
    expect(state.cardIdByUid[devolved.stack.at(-1) ?? ""]).toBe("d547-target");
    expect(devolved.attackFlipLockTurn).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — §11: an effect of an attack done to the Defending Pokémon.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — a §11 shield refuses the install", () => {
  it("Mist Energy on the Defending Pokémon: refused, announced, nothing written", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, APPLY);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(find(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(body(state.players.p2.active).attackFlipLockTurn).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — the log rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — the rows say what this path keeps true (D421)", () => {
  it("the install row names the COIN, not a hard lock, under both seats", () => {
    const { state, events } = installed();
    const text = "d547-target must flip a coin to attack next turn — tails, the attack doesn't happen";
    expect(render(events, state)).toContainEqual({ who: "p2", text });
    expect(render(events, state).some((r) => r.text.includes("can't attack"))).toBe(false);
    const row = find(events, "ATTACK_LOCKED");
    expect(render(row === undefined ? [] : [{ ...row, seat: "p1" }], state)).toEqual([
      { who: "p1", text },
    ]);
  });

  it("the coin row and the EXPLICIT failure row (not the default 'condition' wording)", () => {
    const window = withFaces(installed().state, ["tails"]);
    const { state, events } = attack(window, JAB, "p2");
    const rows = render(events, state).map((r) => r.text);
    expect(rows).toContain("d547-target is under a flip lock — flip: tails");
    expect(rows).toContain("d547-target's attack didn't happen — the flip lock's coin was tails");
    expect(rows.some((r) => r.includes("condition was not met"))).toBe(false);
  });

  it("the plain lock's row is unchanged", () => {
    const { state, events } = installed();
    const uid = find(events, "ATTACK_LOCKED")?.uid ?? "";
    expect(render([{ type: "ATTACK_LOCKED", seat: "p2", uid }], state)).toEqual([
      { who: "p2", text: "d547-target can't attack next turn" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — `MATCH_RECORD_VERSION` 30 → 31.
// ─────────────────────────────────────────────────────────────────────────────

describe("§12 — the v31 bytes round-trip, and a v30-shaped body is why the version moved (🆕🆕🆕 D547's bump; the record is v32 since D548 and v33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570, 38 since D575, 39 since D576, 40 since D577, 41 since D579, 42 since D583, 43 since D621, 44 since D630, 45 since D636, 46 since D637, and still carries the field)", () => {
  const RAW: Record<string, string> = (
    import.meta as unknown as {
      glob(
        pattern: string | readonly string[],
        options: { query: "?raw"; import: "default"; eager: true },
      ): Record<string, string>;
    }
  ).glob(["../../../apps/api/src/lobby/match.ts"], { query: "?raw", import: "default", eager: true });
  const matchTs = Object.values(RAW)[0] ?? "";

  it("🛑 v31: the stamp is in the serialized state, and a JSON round-trip still flips", () => {
    const window = installed().state;
    const bytes = JSON.stringify(window);
    expect(bytes.includes('"attackFlipLockTurn":4')).toBe(true);
    const revived = withFaces(JSON.parse(bytes) as GameState, ["tails"]);
    expect(find(attack(revived, JAB, "p2").events, "ATTACK_FAILED")?.reason).toBe("flipLock");
  });

  it("🛑 v30-SHAPED body (the key genuinely ABSENT): the gate silently never flips", () => {
    const revived = JSON.parse(JSON.stringify(installed().state)) as GameState;
    const target = body(revived.players.p2.active) as Partial<InPlayPokemon>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT, which is what a v30 record looks like (D124).
    delete target.attackFlipLockTurn;
    expect("attackFlipLockTurn" in target).toBe(false);
    const legacy = withFaces(revived, ["tails"]);
    const { events } = attack(legacy, JAB, "p2");
    // The printed coin is silently gone — a plausible-looking wrong board, which is
    // why a v30 record is RETIRED rather than read (apps/api match.ts, D547).
    expect(find(events, "ATTACK_FLIP_LOCK_CHECK")).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 46 (🆕🆕🆕 D637 stepped it 45 → 46; D636 stepped it 44 → 45; D630 stepped it 43 → 44; D621 stepped it 42 → 43; D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; this slice's own bump was 30 → 31) — read off the raw source, not retyped", () => {
    expect(matchTs).toContain("export const MATCH_RECORD_VERSION = 46;");
  });

  it("the engine version stepped to 0.520.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.520.0");
    expect(manifest.version).toBe("0.520.0");
  });
});
