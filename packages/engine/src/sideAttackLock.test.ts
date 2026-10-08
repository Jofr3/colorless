import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { attackLocked, countAttachedEnergy, providedEnergy } from "./continuous";
import * as effectsModule from "./effects";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameState, InPlayPokemon, PlayerSide, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
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
import { type SideAttackLock, makeInPlay } from "./types";

// 0.433.0 → 0.434.0 — D549 (C), THE SIDE-WIDE ATTACK LOCK:
//
//   "During your next turn, your Pokémon can't attack. (This includes new Pokémon that
//    come into play.)"                                                   (file line 169)
//   "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't
//    attack. (This includes new Pokémon that come into play.)"          (file line 170)
//
// 2 sentences / 2 legal printings (leading count column 1 each) — SUBST-16 and OPAQUE at
// SUBMAX=12 before this slice. Claimed WHOLE by `deriveAttackEffect` through TWO new
// anchors (`SIDE_CANT_ATTACK_NEXT_TURN`, `OPPONENT_LOW_ENERGY_CANT_ATTACK`; the printed
// reminder REQUIRED) and ONE new op, `lockSideAttacks { whose, maxEnergy }`, writing
// ONE new REQUIRED `PlayerSide.sideAttackLock` read by `attackLocked` (continuous.ts) —
// so the §8 gate, `redactedAttacksOf` and GameHud refuse with ZERO bytes of their own.
//
// ⚠️ NO CATALOG, REGISTRY OR FIXTURE ID PRINTS EITHER SENTENCE ON THIS CHECKOUT, AND
// THAT WAS MEASURED (D425, `git grep`). Every board rides file-local DECLARED `d549-*`
// demonstrators in their OWN 60-card deck (D270); the real cards are UNMEASURED.
//
// Sections: §1 the derivation · §2 the installs · §3 the self window · §4 "new Pokémon
// that come into play" · §5 the Energy count, LIVE (R4) · §6 the merge (R6) · §7 no §11
// refusal (R5) · §8 the installer leaving play (R7) · §9 the projections · §10 the
// unplaceable body · §11 the log · §12 the v33 bytes and the v32 reject.

const S169 =
  "During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)";
const S170 =
  "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)";
const P169: readonly EffectOp[] = [{ op: "lockSideAttacks", whose: "self", maxEnergy: null }];
const P170: readonly EffectOp[] = [{ op: "lockSideAttacks", whose: "opponent", maxEnergy: 2 }];

const SEAL = 0; // {C}, 10 — :169, the installer's own side
const DRAIN = 1; // {C}, 10 — :170, the opponent's side
const JAB = 2; // {C}, 20 — a plain attack

const LOCKER_ATTACKS = [
  { cost: ["Colorless"], name: "Seal", damage: 10, effect: S169 },
  { cost: ["Colorless"], name: "Drain", damage: 10, effect: S170 },
  { cost: ["Colorless"], name: "Jab", damage: 20 },
];

const LOCAL_CARDS: Record<string, Card> = {
  "d549-locker": battler("d549-locker", {
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: LOCKER_ATTACKS,
  }),
  "d549-locker-evolved": battler("d549-locker-evolved", {
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "d549-locker",
    hp: 400,
    retreat: 1,
    attacks: LOCKER_ATTACKS,
  }),
  "d549-side-bench": battler("d549-side-bench", {
    types: ["Fighting"],
    hp: 300,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Poke", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d549-locker": 4,
  "d549-locker-evolved": 2,
  "d549-side-bench": 8,
  "fix-mist-energy": 2, // the §11 shield that does NOT refuse (R5)
  "fix-grassdouble": 2, // Special {G}{G} — ONE card, TWO units: R4's cards-vs-units board
  "fix-energy": 42,
});

/** `apps/api`'s `match.ts`, read as RAW source (the constant is pinned off the bytes,
    never retyped — the house idiom, `crescentPurge.test.ts`). */
const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["../../../apps/api/src/lobby/match.ts"], { query: "?raw", import: "default", eager: true });
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260951;

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

/** P1's turn 3. Both seats field a locker in the Active Spot (so either can install)
    with `p1Energy` / `p2Energy` Energy, and one benched body each. */
function ready(opts: { p1Energy?: number; p2Energy?: number } = {}): GameState {
  const { p1Energy = 1, p2Energy = 1 } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  for (const [seat, energy] of [
    ["p1", p1Energy],
    ["p2", p2Energy],
  ] as const) {
    state = setActiveFromDeck(state, seat, "d549-locker");
    state = clearBench(state, seat);
    state = attachFromDeck(state, seat, "fix-energy", energy);
    state = benchFromDeck(state, seat, "d549-side-bench");
  }
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

const refusal = (state: GameState, seat: Seat, index: number): string | null => {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
};

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

function withLock(state: GameState, seat: Seat, lock: SideAttackLock | null): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], sideAttackLock: lock } },
  };
}

function attachOne(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "fix-energy", 1);
  return mustApply(withCard, {
    type: "attachEnergy",
    seat,
    uid: handUid(withCard, seat, "fix-energy"),
    target: { spot: "active" },
  }).state;
}

/** Seal DECLARED by P1 on turn 3 — returns P1's own turn 5, THE self window. */
function sealed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, SEAL);
  if (find(events, "SIDE_ATTACKS_LOCKED") === undefined) throw new Error("Seal installed nothing");
  return { start, victim: state, window: pass(state, "p2"), events };
}

/** Drain DECLARED by P1 on turn 3 — returns P2's turn 4, THE opponent window. */
function drained(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, DRAIN);
  if (find(events, "SIDE_ATTACKS_LOCKED") === undefined) throw new Error("Drain installed nothing");
  return { start, window: state, events };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — two anchors claim the two rows WHOLE, and only them", () => {
  it("derives `lockSideAttacks` with the side and the Energy cap each row prints", () => {
    expect(deriveAttackEffect(S169)).toEqual(P169);
    expect(deriveAttackEffect(S170)).toEqual(P170);
  });

  it("the corpus rows derive off the committed bytes, and they are the ONLY such rows", () => {
    const hits = legalAttackCorpus().filter(([, text]) =>
      (deriveAttackEffect(text) ?? []).some((op) => op.op === "lockSideAttacks"),
    );
    expect(hits).toEqual([
      [1, S169],
      [1, S170],
    ]);
  });

  it("each is claimed by EXACTLY ONE of the 13 readers (`deriveAttackEffect`)", () => {
    for (const text of [S169, S170]) {
      expect(resolvedByAnyReader(text)).toBe(true);
      const claimants = attackReaderSurface().filter((name) => {
        const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
        return (read?.(text) ?? null) !== null;
      });
      expect(claimants, text).toEqual(["deriveAttackEffect"]);
    }
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("every apostrophe slot is U+0027 in the corpus, and every U+2019 twin derives the same op", () => {
    const slots = (text: string) => [...text].flatMap((c, i) => (c === "'" ? [i] : []));
    expect(slots(S169)).toEqual([39]);
    expect(slots(S170)).toEqual([20, 81]);
    expect(deriveAttackEffect(S169.replaceAll("'", "’"))).toEqual(P169);
    expect(deriveAttackEffect(S170.replaceAll("'", "’"))).toEqual(P170);
    // …and each slot ALONE (a mixed-apostrophe printing).
    expect(deriveAttackEffect(S170.replace("opponent's", "opponent’s"))).toEqual(P170);
    expect(deriveAttackEffect(S170.replace("can't", "can’t"))).toEqual(P170);
  });

  it("🛑 the printed reminder is REQUIRED: without it, neither sentence is claimed", () => {
    const bare169 = S169.replace(" (This includes new Pokémon that come into play.)", "");
    const bare170 = S170.replace(" (This includes new Pokémon that come into play.)", "");
    expect(deriveAttackEffect(bare169)).toBeNull();
    expect(deriveAttackEffect(bare170)).toBeNull();
    // …and the anchors are `^…$`: a sentence in front or behind is not either row.
    for (const text of [S169, S170]) {
      expect(deriveAttackEffect(`Draw a card. ${text}`), text).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`), text).toBeNull();
    }
  });

  it("refuses every single-axis near-miss, and reads another printed cap", () => {
    // "this Pokémon" is arm 24's SELF-lock, a different op — the side lock must not take it.
    expect(deriveAttackEffect(S169.replace("your Pokémon", "this Pokémon"))).toBeNull();
    expect(
      deriveAttackEffect(S169.replace("your next turn", "your opponent's next turn")),
    ).toBeNull();
    expect(deriveAttackEffect(S170.replace("or less", "or more"))).toBeNull();
    expect(
      deriveAttackEffect(S170.replace("your opponent's next turn", "your next turn")),
    ).toBeNull();
    expect(deriveAttackEffect(S170.replace("2 or less", "3 or less"))).toEqual([
      { op: "lockSideAttacks", whose: "opponent", maxEnergy: 3 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the installs.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the installs write ONE record on the named SIDE, with the side's next turn", () => {
  it(":169 stamps the INSTALLER's own side for T+2, with a row filed under P1", () => {
    const { start, victim, events } = sealed();
    expect(start.turn).toBe(3);
    expect(victim.players.p1.sideAttackLock).toStrictEqual({ turn: 5, maxEnergy: null });
    expect(victim.players.p2.sideAttackLock).toBeNull();
    expect(find(events, "SIDE_ATTACKS_LOCKED")).toEqual({
      type: "SIDE_ATTACKS_LOCKED",
      seat: "p1",
      maxEnergy: null,
    });
  });

  it(":170 stamps the OPPONENT's side for T+1, with a row filed under P2", () => {
    const { window, events } = drained();
    expect(window.turn).toBe(4);
    expect(window.players.p2.sideAttackLock).toStrictEqual({ turn: 4, maxEnergy: 2 });
    expect(window.players.p1.sideAttackLock).toBeNull();
    expect(find(events, "SIDE_ATTACKS_LOCKED")).toEqual({
      type: "SIDE_ATTACKS_LOCKED",
      seat: "p2",
      maxEnergy: 2,
    });
  });

  it("neither install touches any body, parks, or consumes rng", () => {
    const start = ready();
    const after = runAs(runAs(start, "p1", P169, []), "p1", P170, []);
    expect(after.rngState).toBe(start.rngState);
    expect(after.players.p1.active).toStrictEqual(start.players.p1.active);
    expect(after.players.p2.active).toStrictEqual(start.players.p2.active);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the self window.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — :169 refuses on T+2 only, and only the installer's side", () => {
  it("🛑 turn 5: every attack of P1's Active is REFUSED with ATTACK_PREVENTED", () => {
    const { window } = sealed();
    expect(window.turn).toBe(5);
    for (const index of [SEAL, DRAIN, JAB])
      expect(refusal(window, "p1", index)).toBe("ATTACK_PREVENTED");
    expect(attackLocked(window, body(window.players.p1.active))).toBe(true);
    expect(attackLocked(window, body(window.players.p1.bench[0]))).toBe(true);
  });

  it("turn 4 (the opponent's) is untouched: P2 attacks freely", () => {
    const { victim } = sealed();
    expect(victim.turn).toBe(4);
    expect(refusal(victim, "p2", JAB)).toBeNull();
  });

  it("turn 7: the stale record refuses nothing", () => {
    const later = pass(pass(sealed().window, "p1"), "p2");
    expect(later.turn).toBe(7);
    expect(later.players.p1.sideAttackLock).toStrictEqual({ turn: 5, maxEnergy: null });
    expect(refusal(later, "p1", JAB)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — "(This includes new Pokémon that come into play.)"
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — bodies that come into play AFTER the install are locked by construction", () => {
  it("a Basic benched on turn 5 is locked", () => {
    const { window } = sealed();
    const withCard = handFromDeck(window, "p1", "d549-side-bench", 1);
    const benched = mustApply(withCard, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(withCard, "p1", "d549-side-bench"),
    }).state;
    const fresh = body(benched.players.p1.bench.at(-1));
    expect(fresh.turnPlayed).toBe(5);
    expect(attackLocked(benched, fresh)).toBe(true);
  });

  it("🛑 a Bench-to-Active PROMOTION mid-turn (retreat) stays locked", () => {
    const { window } = sealed();
    const retreated = mustApply(window, {
      type: "retreat",
      seat: "p1",
      discardEnergy: body(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    }).state;
    expect(retreated.cardIdByUid[body(retreated.players.p1.active).stack[0] ?? ""]).toBe(
      "d549-side-bench",
    );
    const armed = attachOne(retreated, "p1");
    expect(refusal(armed, "p1", 0)).toBe("ATTACK_PREVENTED");
  });

  it("an EVOLUTION on turn 5 stays locked (the side, not the card, is the holder)", () => {
    const { window } = sealed();
    const withCard = handFromDeck(window, "p1", "d549-locker-evolved", 1);
    const evolved = mustApply(withCard, {
      type: "evolve",
      seat: "p1",
      uid: handUid(withCard, "p1", "d549-locker-evolved"),
      target: { spot: "active" },
    }).state;
    expect(refusal(evolved, "p1", JAB)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — :170's Energy count, LIVE (R4).
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — :170 counts Energy CARDS at each declaration", () => {
  it("1 and 2 attached are locked; a 3rd attached on the locked turn UNLOCKS the body", () => {
    expect(refusal(drained({ p2Energy: 1 }).window, "p2", JAB)).toBe("ATTACK_PREVENTED");
    const two = drained({ p2Energy: 2 }).window;
    expect(refusal(two, "p2", JAB)).toBe("ATTACK_PREVENTED");
    const three = attachOne(two, "p2");
    expect(body(three.players.p2.active).energy).toHaveLength(3);
    expect(refusal(three, "p2", JAB)).toBeNull();
  });

  it("a body that already had 3 is never locked (the cap is not a side-wide ban)", () => {
    expect(refusal(drained({ p2Energy: 3 }).window, "p2", JAB)).toBeNull();
  });

  it("🛑 a PROMOTED body with 0 Energy is locked (the reminder, on the capped form)", () => {
    const window = drained({ p2Energy: 2 }).window;
    const retreated = mustApply(window, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(window.players.p2.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    }).state;
    expect(body(retreated.players.p2.active).energy).toHaveLength(0);
    expect(attackLocked(retreated, body(retreated.players.p2.active))).toBe(true);
  });

  it("🛑 the count is CARDS: `countAttachedEnergy(…, null)`, not provided units (R4)", () => {
    // 🛑 THE DISCRIMINATING BOARD (the D549 review's finding 1): two basic `fix-energy`
    // cards are two cards AND two units, so a board of those alone answers the same under
    // either reading. ONE `fix-grassdouble` ({G}{G}, ONE Special card, TWO units) attached
    // on the LOCKED turn beside one basic makes TWO cards and THREE units: the cards
    // reading keeps the body locked ("2 or less Energy attached"), a units reading
    // (`providedEnergy(…).length`) would free it. `D549-side-lock-counts-units` is that
    // units reading, and this rung is what kills it.
    const window = drained({ p2Energy: 1 }).window;
    const withCard = handFromDeck(window, "p2", "fix-grassdouble", 1);
    const mixed = mustApply(withCard, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(withCard, "p2", "fix-grassdouble"),
      target: { spot: "active" },
    }).state;
    const active = body(mixed.players.p2.active);
    expect(active.energy).toHaveLength(2);
    expect(countAttachedEnergy(mixed, active, null)).toBe(2);
    expect(providedEnergy(mixed, active)).toHaveLength(3);
    expect(attackLocked(mixed, active)).toBe(true);
    expect(refusal(mixed, "p2", JAB)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the merge (R6).
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — same seat, same window: null dominates, else the larger cap", () => {
  it("🛑 PLAYED: P1's :169 (turn 3) then P2's :170 (turn 4) both land on P1 for turn 5 — P1 stays fully locked", () => {
    const { victim } = sealed({ p1Energy: 3, p2Energy: 1 });
    const { state, events } = attack(victim, DRAIN, "p2");
    // The second install said nothing new, so it filed no row.
    expect(find(events, "SIDE_ATTACKS_LOCKED")).toBeUndefined();
    expect(state.players.p1.sideAttackLock).toStrictEqual({ turn: 5, maxEnergy: null });
    // P1's 3-Energy Active would be FREE under `:170` alone — `null` must dominate.
    expect(body(state.players.p1.active).energy).toHaveLength(3);
    expect(refusal(state, "p1", JAB)).toBe("ATTACK_PREVENTED");
  });

  it("the other order (constructed): a capped record WIDENS to null, with a row", () => {
    const capped = withLock(ready(), "p1", { turn: 5, maxEnergy: 2 });
    const events: GameEvent[] = [];
    const after = runAs(capped, "p1", P169, events);
    expect(after.players.p1.sideAttackLock).toStrictEqual({ turn: 5, maxEnergy: null });
    expect(events).toEqual([{ type: "SIDE_ATTACKS_LOCKED", seat: "p1", maxEnergy: null }]);
  });

  it("two caps keep the LARGER (constructed): 3 then 2 stays 3 silently; 2 then 3 widens", () => {
    const three = withLock(ready(), "p2", { turn: 4, maxEnergy: 3 });
    const quiet: GameEvent[] = [];
    expect(runAs(three, "p1", P170, quiet).players.p2.sideAttackLock).toStrictEqual({
      turn: 4,
      maxEnergy: 3,
    });
    expect(quiet).toEqual([]);
    const two = withLock(ready(), "p2", { turn: 4, maxEnergy: 2 });
    const loud: GameEvent[] = [];
    const widened = runAs(
      two,
      "p1",
      [{ op: "lockSideAttacks", whose: "opponent", maxEnergy: 3 }],
      loud,
    );
    expect(widened.players.p2.sideAttackLock).toStrictEqual({ turn: 4, maxEnergy: 3 });
    expect(loud).toHaveLength(1);
  });

  it("a record for a DIFFERENT window is overwritten", () => {
    const stale = withLock(ready(), "p1", { turn: 1, maxEnergy: null });
    const events: GameEvent[] = [];
    const after = runAs(stale, "p1", P170, events);
    expect(after.players.p2.sideAttackLock).toStrictEqual({ turn: 4, maxEnergy: 2 });
    const overwritten = runAs(
      withLock(ready(), "p2", { turn: 2, maxEnergy: null }),
      "p1",
      P170,
      [],
    );
    expect(overwritten.players.p2.sideAttackLock).toStrictEqual({ turn: 4, maxEnergy: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — R5: no §11 refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — R5: a §11 shield on the Active does NOT refuse the side lock", () => {
  it("Mist Energy on P2's Active: the lock lands, and no refusal row is filed", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, DRAIN);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(state.players.p2.sideAttackLock).toStrictEqual({ turn: 4, maxEnergy: 2 });
    expect(refusal(state, "p2", JAB)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — R7: the lock survives its installer leaving play.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — R7: nothing about the installing body is read after the install", () => {
  it("P1's installer gone from play (constructed): P2 is still locked on turn 4", () => {
    const { window } = drained();
    const installer = body(window.players.p1.active);
    const gone: GameState = {
      ...window,
      players: {
        ...window.players,
        p1: {
          ...window.players.p1,
          active: body(window.players.p1.bench[0]),
          bench: window.players.p1.bench.slice(1),
          discard: [...window.players.p1.discard, ...installer.stack, ...installer.energy],
        },
      },
    };
    expect(refusal(gone, "p2", JAB)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the projections (redact.ts takes zero bytes).
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — `playable` is FALSE on every row under a live side lock", () => {
  it(":169 on turn 5: P1's panel greys every attack", () => {
    const phase = redactGame(sealed().window, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    expect(phase.attacks.map((a) => a.playable)).toEqual([false, false, false]);
  });

  it(":170 on turn 4: greyed at 2 Energy, lit again once a 3rd is attached", () => {
    const window = drained({ p2Energy: 2 }).window;
    const locked = redactGame(window, "p2").phase;
    if (locked.kind !== "turn:action") throw new Error("expected turn:action");
    expect(locked.attacks.map((a) => a.playable)).toEqual([false, false, false]);
    const lit = redactGame(attachOne(window, "p2"), "p2").phase;
    if (lit.kind !== "turn:action") throw new Error("expected turn:action");
    expect(lit.attacks.map((a) => a.playable)).toEqual([true, true, true]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the unplaceable body.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — a body on neither board answers NOT locked (`seatOfPokemon` → undefined)", () => {
  it("both sides locked, and a detached body is still not locked", () => {
    const both = withLock(withLock(ready(), "p1", { turn: 3, maxEnergy: null }), "p2", {
      turn: 3,
      maxEnergy: null,
    });
    expect(attackLocked(both, body(both.players.p1.active))).toBe(true);
    expect(attackLocked(both, makeInPlay("nowhere", 0))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — the log.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — the rows name the side, the cap and the reminder", () => {
  it(":169 renders under P1, :170 under P2 — 'next turn' true for each side", () => {
    const self = sealed();
    expect(render(self.events, self.victim)).toContainEqual({
      who: "p1",
      text: "Pokémon can't attack next turn — including Pokémon that come into play",
    });
    const opp = drained();
    expect(render(opp.events, opp.window)).toContainEqual({
      who: "p2",
      text: "Pokémon with 2 or less Energy attached can't attack next turn — including Pokémon that come into play",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — `MATCH_RECORD_VERSION` 32 → 33.
// ─────────────────────────────────────────────────────────────────────────────

describe("§12 — the v33 bytes round-trip, and a v32-shaped state THROWS (D549)", () => {
  it("🛑 v33: the record is in the serialized state, and a JSON round-trip still refuses", () => {
    const { window } = sealed();
    const bytes = JSON.stringify(window);
    expect(bytes.includes('"sideAttackLock":{"turn":5,"maxEnergy":null}')).toBe(true);
    expect(refusal(JSON.parse(bytes) as GameState, "p1", JAB)).toBe("ATTACK_PREVENTED");
  });

  it("🛑 v32-SHAPED sides (the key genuinely ABSENT): the declaration and the projection THROW", () => {
    const revived = JSON.parse(JSON.stringify(ready())) as GameState;
    for (const seat of ["p1", "p2"] as const) {
      const side = revived.players[seat] as Partial<PlayerSide>;
      // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT, which is what a v32 record looks like (D124).
      delete side.sideAttackLock;
    }
    // `undefined === null` is false, so the reader dereferences `.turn` of undefined on
    // EVERY declaration and on the turn player's EVERY projection — D326's throw.
    expect(() => applyAction(revived, { type: "attack", seat: "p1", index: JAB })).toThrow(
      TypeError,
    );
    expect(() => redactGame(revived, "p1")).toThrow(TypeError);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 42 (🆕🆕🆕 D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; this slice's bump was 32 → 33) — read off the raw source, not retyped", () => {
    expect(raw("/match.ts")).toContain("export const MATCH_RECORD_VERSION = 42;");
    expect(raw("/match.ts")).toContain("32 → 33 AT D549 — THE SIXTH POSITION");
  });

  it("the engine version stepped to 0.485.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.485.0");
    expect(manifest.version).toBe("0.485.0");
  });
});
