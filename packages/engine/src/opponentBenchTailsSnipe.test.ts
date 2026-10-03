import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import { FIXTURE_POOL, basicEnergy, battler, deckOf } from "./testFixtures";
import { makeInPlay } from "./types";

// 0.434.0 → 0.435.0 — 🆕🆕🆕 D550: THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S
// BENCH COUNT, WITH WEAKNESS AND RESISTANCE SUPPRESSED.
//
// ── THE PRINTED SENTENCE ─────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 669 — "Your opponent flips a coin for each of their
//     Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each
//     tails. This attack's damage isn't affected by Weakness or Resistance."   **1 printing**
//
// ONE whole-sentence anchor (`ATTACK_OPPONENT_BENCH_TAILS`) read by TWO readers off the SAME
// `effect` string — the FOURTH use of D493's one-anchor-two-readers route (D493, D494,
// D539, D550), and the column's FIFTH dual-claimed sentence (`opponentHandScaling.test.ts`
// §2 pins all five by name):
//   · `deriveAttackCoinFlip` → `{ kind: "opponentPerTails", flips: { kind: "opponentBench" },
//     per: 80 }` — a NINTH `AttackCoinFlip` member over a SIXTH, NULLARY `AttackFlipCount`
//     member;
//   · `deriveAttackDamageSuppression` → `{ weakness: true, resistance: true }`, GATED on the
//     coin reader (D445).
//
// ── THE RULINGS (docs/decisions.md D550, each with its reversal condition) ────
//   R1 — the coin rows are filed under the FLIPPER, the OPPONENT (D547's precedent:
//        `ATTACK_FLIP_LOCK_CHECK` files "your opponent flips" under the seat that flips).
//   R2 — the count is the opponent's Benched bodies AT THE FLIP SITE, after the §8
//        flip-lock/Confusion checks; it cannot differ from a declaration-time count.
//   R3 — the printed marker is read as "80×": the printed base is DROPPED.
//   R4 — ONLY W/R is suppressed: the defender's own effects (D547's vulnerability) apply.
//   R5 — 0 benched = 0 flips, no rng step, no coin rows, no DAMAGE_DEALT; all heads = no
//        DAMAGE_DEALT. Neither files a 0-damage row.
//
// ⚠️ **THE REAL CARD IS UNMEASURED.** No id on this checkout resolves to the sentence
// (`registry.ts`, `catalogManifest.ts`, `testFixtures.ts` — measured by `git grep`), so the
// board half rides a FILE-LOCAL DECLARED `d550-*` demonstrator (D425) in its own 60-card deck
// (D270), with `damage: "80×"` — the R3 reading, declared rather than assumed.

/** THE SENTENCE, byte for byte off `legalAttackCorpus()` — §1 asserts that. */
const PRINTED =
  "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.";

/** The derived coin member, spelled once. */
const MEMBER = { kind: "opponentPerTails", flips: { kind: "opponentBench" }, per: 80 } as const;

/** Every reader `censusAtHead.test.ts` sweeps with. ⚠️ Spliced before the last entry if it
    ever grows (D419). */
const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the anchor, and the two readers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D550 §1 — the sentence, measured live over the legal column", () => {
  it("🛑 the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("is really in the column, ONCE, at ONE printing — and it is the only per-tails fold", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    const fold = legalAttackCorpus().filter(([, s]) => /for each tails/.test(s));
    expect(fold.map(([, s]) => s)).toEqual([PRINTED]);
    const flippedByTheOpponent = legalAttackCorpus().filter(([, s]) => /^Your opponent flips/.test(s));
    expect(flippedByTheOpponent.map(([, s]) => s)).toEqual([PRINTED]);
  });

  it("🛑 TWO readers own it, by VALUE — the coin reader and the suppression reader — and the other ELEVEN refuse", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(MEMBER);
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true, resistance: true });
    for (const read of READERS) {
      if (read === deriveAttackCoinFlip || read === deriveAttackDamageSuppression) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // …and no splitter composes it: the whole-sentence anchor is the only route in.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("the amount is CAPTURED, not pinned — a 30 derives a 30, in BOTH readers", () => {
    const thirty = PRINTED.replace("does 80 damage", "does 30 damage");
    expect(deriveAttackCoinFlip(thirty)).toEqual({ ...MEMBER, per: 30 });
    expect(deriveAttackDamageSuppression(thirty)).toEqual({ weakness: true, resistance: true });
  });

  it("🛑 a printed 0 stays LOUD in BOTH readers, and 1 does not — the `per >= 1` guard, and the gate that carries it", () => {
    // The coin arm's guard refuses the 0; the suppression arm is GATED on the coin reader
    // (D445), so a bare `.test()` there would claim the 0-damage sentence whole — this is
    // the rung that goes red on that.
    const zero = PRINTED.replace("does 80 damage", "does 0 damage");
    expect(deriveAttackCoinFlip(zero)).toBeNull();
    expect(deriveAttackDamageSuppression(zero)).toBeNull();
    expect(resolvedByAnyReader(zero)).toBe(false);
    const one = PRINTED.replace("does 80 damage", "does 1 damage");
    expect(deriveAttackCoinFlip(one)).toEqual({ ...MEMBER, per: 1 });
    expect(deriveAttackDamageSuppression(one)).toEqual({ weakness: true, resistance: true });
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    // D452's rule: the prefix ENDS a sentence, so only the anchor is varied.
    for (const text of [
      `This attack does 30 damage. ${PRINTED}`,
      `${PRINTED} Then, discard a card.`,
      PRINTED.toLowerCase(),
      PRINTED.slice(0, -1),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
      expect(deriveAttackDamageSuppression(text), text).toBeNull();
    }
  });

  it("each near-miss differs on ONE axis and each is refused for THAT axis — the positive control first", () => {
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    for (const text of [
      // …the FACE alone: no per-heads twin is printed.
      PRINTED.replace("for each tails", "for each heads"),
      // …the FLIPPER alone: an attacker-flipped per-tails fold is printed by zero rows.
      PRINTED.replace("Your opponent flips a coin for each of their Benched Pokémon.", "Flip a coin for each of your opponent's Benched Pokémon."),
      // …the COUNTED SIDE alone.
      PRINTED.replace("each of their Benched Pokémon", "each of your Benched Pokémon"),
      // …the SUPPRESSION alone: Resistance only is a different §8.5 step.
      PRINTED.replace("Weakness or Resistance", "Resistance"),
      // …the VICTIM alone.
      PRINTED.replace("to your opponent's Active Pokémon", "to 1 of your opponent's Benched Pokémon"),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
      expect(deriveAttackDamageSuppression(text), text).toBeNull();
    }
  });

  it("the curly apostrophe reads on all three slots (D136/D137)", () => {
    const curly = PRINTED.replaceAll("'", "’");
    expect(curly).not.toContain("'");
    expect(deriveAttackCoinFlip(curly)).toEqual(MEMBER);
    expect(deriveAttackDamageSuppression(curly)).toEqual({ weakness: true, resistance: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local `cardPool` (D414/D452), so no `FIXTURE_POOL` id is added.
// ─────────────────────────────────────────────────────────────────────────────

/** The declared demonstrator (D425): a {R} body printing the sentence, "80×". */
const SNIPER = "d550-sniper";
/** 900 HP and NO Weakness/Resistance: the plain target. */
const WALL = "d550-wall";
/** 900 HP, ×2 AND −30 to {R}: the target BOTH W and R would move (R4's other half). */
const WEAK_RESISTANT = "d550-weak-resistant";
const BODY = "d550-body";
const ENERGY = "d550-energy";

const TOLL_INDEX = 0;

const LOCAL_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D550 Sniper",
    hp: 200,
    retreat: 1,
    types: ["Fire"],
    attacks: [
      { cost: ["Colorless"], name: "Bench Toll", effect: PRINTED, damage: "80×" },
      { cost: ["Colorless"], name: "Ember Tap", damage: "50" },
    ],
  }),
  [WALL]: battler(WALL, { name: "D550 Wall", hp: 900, retreat: 1, types: ["Water"] }),
  [WEAK_RESISTANT]: battler(WEAK_RESISTANT, {
    name: "D550 Weak Resistant",
    hp: 900,
    retreat: 1,
    types: ["Water"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  [BODY]: battler(BODY, { name: "D550 Body", hp: 60, types: ["Water"] }),
  [ENERGY]: basicEnergy(ENERGY),
};

const CARD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** SIXTY cards (D270). The largest demand is 5 bodies on one Bench plus setup's draw. */
const LOCAL_DECK = deckOf({
  [SNIPER]: 6,
  [WALL]: 6,
  [WEAK_RESISTANT]: 6,
  [BODY]: 20,
  [ENERGY]: 22,
});

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function act(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const outcome = applyAction(state, action);
  if (!outcome.ok) {
    throw new Error(`${action.type} rejected: ${outcome.error.code}: ${outcome.error.message}`);
  }
  return { state: outcome.state, events: [...outcome.events] };
}

function firstBasic(state: GameState, side: Seat): string {
  const uid = state.players[side].hand.find((held) => {
    const card = CARD_POOL[state.cardIdByUid[held] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`${side} was dealt no Basic`);
  return uid;
}

/** Setup driven against the LOCAL pool, then P2's turn ended so P1 is on `turn:action`. */
function table(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: LOCAL_DECK, p2: LOCAL_DECK }, cardPool: CARD_POOL });
  if (!created.ok) throw new Error(`createGame: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = ok(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const pending = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !pending.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = ok(applyAction(state, { type: "setupDrawExtra", seat, count: pending.owed[seat] }));
  }
  for (const side of ["p1", "p2"] as const) {
    state = ok(applyAction(state, { type: "setupPlaceActive", seat: side, uid: firstBasic(state, side) }));
  }
  for (const side of ["p1", "p2"] as const) state = ok(applyAction(state, { type: "setupReady", seat: side }));
  return act(state, { type: "endTurn", seat: "p2" }).state;
}

/** Field `cardId` from the deck into the Active Spot with an EMPTY Bench behind it. */
function fieldAlone(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((held) => state.cardIdByUid[held] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), active: makeInPlay(uid, state.turn), bench: [] },
    },
  };
}

/** Put `count` `BODY`s from the seat's deck onto its Bench. */
function benchUp(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let placed = 0; placed < count; placed += 1) {
    const side = next.players[seat];
    const uid = side.deck.find((held) => next.cardIdByUid[held] === BODY);
    if (uid === undefined) throw new Error(`${seat}'s deck ran out of ${BODY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), bench: [...side.bench, makeInPlay(uid, next.turn)] },
      },
    };
  }
  return next;
}

/** One Energy from the deck onto the seat's Active — the Colorless cost. */
function fuel(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error(`${seat} has no Active`);
  const uid = side.deck.find((held) => state.cardIdByUid[held] === ENERGY);
  if (uid === undefined) throw new Error(`${seat}'s deck has no Energy`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), active: { ...active, energy: [...active.energy, uid] } },
    },
  };
}

/** THE BOARD: P1's sniper with `ownBench` bodies behind it, P2's `target` with `foeBench`.
    The two Bench sizes are chosen per case so that the CORRECT count (P2's Bench) differs
    from every wrong one: P1's Bench (the seat crossed), P2's Bench + Active (the
    `pokemonInPlay` reading), and a constant. */
function board(seed: number, ownBench: number, foeBench: number, target: string = WALL): GameState {
  let state = table(seed);
  state = fuel(benchUp(fieldAlone(state, "p1", SNIPER), "p1", ownBench), "p1");
  return benchUp(fieldAlone(state, "p2", target), "p2", foeBench);
}

const toll = { type: "attack", seat: "p1", index: TOLL_INDEX } as const;

function rowsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const kinds = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

function tailsOf(events: readonly GameEvent[]): number {
  return rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "tails").length;
}

/** `count` flips by hand off `rng`, in order, and the state they leave behind. */
function flipsByHand(rng: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let cursor = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [face, next] = flipCoin(cursor);
    faces.push(face);
    cursor = next;
  }
  return [faces, cursor];
}

function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:05" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** Swept seeds. With THREE flips heads ≠ tails on EVERY outcome (an odd count), so the
    "counts heads" and "rides the else" builds are wrong on every seed, not on some; the
    sweep's job is to reach all four tails counts, which each case ASSERTS it did. */
const SEEDS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the count, the flipper and the fold, PLAYED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D550 §2 — the opponent flips once per BENCHED body, and the damage is tails × 80", () => {
  it("🛑 flips EXACTLY as many times as the OPPONENT has Benched — never the attacker's Bench, never Active + Bench", () => {
    // Asymmetric benches, both ways round: 1 own / 3 foe and 4 own / 2 foe. The seat
    // crossed would answer 1 and 4; `pokemonInPlay` on the foe would answer 4 and 3; a
    // constant cannot answer both 3 and 2.
    for (const [own, foe] of [
      [1, 3],
      [4, 2],
    ] as const) {
      for (let seed = 0; seed < 6; seed += 1) {
        const { events } = act(board(seed, own, foe), toll);
        expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP"), `${own}/${foe} seed ${seed}`).toHaveLength(foe);
      }
    }
  });

  it("🛑 R1 — every coin row is filed under the OPPONENT, the seat that flips", () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const { events } = act(board(seed, 1, 3), toll);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(3);
      for (const flip of flips) expect(flip.seat, `seed ${seed}`).toBe("p2");
      // …while the attack itself is still P1's.
      expect(rowsOf(events, "ATTACK_DECLARED")[0]?.seat).toBe("p1");
    }
  });

  it("🛑 the damage is TAILS × 80 — not heads × 80, not every flip × 80, and never the printed base on top", () => {
    const seenTails = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { state: done, events } = act(board(seed, 1, 3), toll);
      const tails = tailsOf(events);
      const heads = 3 - tails;
      seenTails.add(tails);
      expect(heads, `seed ${seed}`).not.toBe(tails); // an odd count: always distinct
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(80 * tails);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).not.toBe(80 * heads);
      if (tails > 0) {
        expect(rowsOf(events, "DAMAGE_DEALT").map((e) => e.dealt), `seed ${seed}`).toEqual([80 * tails]);
        expect(done.players.p2.active?.damage ?? 0).not.toBe(80 * tails + 80); // R3: base dropped
      }
      if (tails < 3) expect(done.players.p2.active?.damage ?? 0).not.toBe(240); // not every flip
      expect(kinds(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(kinds(events)).toContain("TURN_ENDED");
    }
    expect([...seenTails].sort()).toEqual([0, 1, 2, 3]);
  });

  it("🛑 R5 — ALL HEADS files NO DAMAGE_DEALT (never a 0-damage row), and the flips were still taken", () => {
    const allHeads: number[] = [];
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = board(seed, 1, 3);
      const { state: done, events } = act(state, toll);
      if (tailsOf(events) !== 0) continue;
      allHeads.push(seed);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
      expect(rowsOf(events, "DAMAGE_DEALT")).toHaveLength(0);
      expect(done.players.p2.active?.damage ?? 0).toBe(0);
      expect(done.rngState).toBe(flipsByHand(state.rngState, 3)[1]);
    }
    expect(allHeads.length).toBeGreaterThan(0);
  });

  it("🛑 R5 — ZERO Benched takes NO flip, spends NO rng step, files NO DAMAGE_DEALT, and is not LOUD", () => {
    for (let seed = 0; seed < 6; seed += 1) {
      // The ATTACKER's Bench is full so a crossed seat would flip five times here.
      const state = board(seed, 5, 0);
      const before = state.rngState;
      const { state: done, events } = act(state, toll);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(done.rngState, `seed ${seed}`).toBe(before);
      expect(kinds(events)).toContain("ATTACK_DECLARED");
      expect(kinds(events)).toContain("TURN_ENDED");
      expect(kinds(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("the rngState advances EXACTLY n steps, and the faces are the stream's, in order", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = board(seed, 1, 3);
      const [faces, after] = flipsByHand(state.rngState, 3);
      const { state: done, events } = act(state, toll);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result), `seed ${seed}`).toEqual(faces);
      expect(done.rngState, `seed ${seed}`).toBe(after);
      expect(done.rngState, `seed ${seed}`).not.toBe(flipsByHand(state.rngState, 4)[1]);
      expect(done.rngState, `seed ${seed}`).not.toBe(flipsByHand(state.rngState, 1)[1]);
    }
  });

  it("🛑 R1 — the log RENDERS the coin rows under P2 (read, not reasoned about — D456)", () => {
    let seenTails = false;
    for (let seed = 0; seed < 6; seed += 1) {
      const { state, events } = act(board(seed, 1, 3), toll);
      const rows = rendered(state, events);
      const coinRows = rows.filter((r) => r.text.endsWith("for the effect"));
      expect(coinRows, `seed ${seed}`).toHaveLength(3);
      for (const row of coinRows) expect(row.who, `seed ${seed}`).toBe("p2");
      if (tailsOf(events) > 0) {
        seenTails = true;
        expect(rows).toContainEqual({ who: "p2", text: "flipped tails for the effect" });
      }
    }
    expect(seenTails).toBe(true);
  });

  it("leaves the card's OTHER attack alone — a flat 50, no flips, the base KEPT", () => {
    const { state: done, events } = act(board(0, 1, 3), { type: "attack", seat: "p1", index: 1 });
    expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.players.p2.active?.damage ?? 0).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the §8.5 step: W and R suppressed, the defender's own effects not (R4).
// ─────────────────────────────────────────────────────────────────────────────

describe("D550 §3 — Weakness AND Resistance are suppressed, and nothing else is", () => {
  it("🛑 a defender BOTH ×2 Weak and −30 Resistant to {R} takes EXACTLY tails × 80", () => {
    // Unsuppressed this board would read (80t × 2) − 30; Weakness alone suppressed would
    // read 80t − 30; Resistance alone, 160t. Each differs from 80t for every t ≥ 1.
    let seen = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { state: done, events } = act(board(seed, 1, 3, WEAK_RESISTANT), toll);
      const tails = tailsOf(events);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(80 * tails);
      if (tails === 0) continue;
      seen += 1;
      // …and the ROW says why: neither modifier was applied.
      const dealt = rowsOf(events, "DAMAGE_DEALT");
      expect(dealt.map((e) => [e.weakness, e.resistance]), `seed ${seed}`).toEqual([[null, null]]);
      expect(done.players.p2.active?.damage ?? 0).not.toBe(80 * tails - 30);
      expect(done.players.p2.active?.damage ?? 0).not.toBe(160 * tails);
      expect(done.players.p2.active?.damage ?? 0).not.toBe(160 * tails - 30);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("the CONTROL — the same body takes the card's flat 50 THROUGH W and R: (50 × 2) − 30 = 70", () => {
    // Proves the board's W/R are both live, so the rung above is not green by a dead
    // fixture: 70 is neither 50 (none), 20 (R only), nor 100 (W only).
    const { state: done } = act(board(0, 1, 3, WEAK_RESISTANT), { type: "attack", seat: "p1", index: 1 });
    expect(done.players.p2.active?.damage ?? 0).toBe(70);
  });

  it("🛑 R4 — a D547 vulnerability on the defender STILL adds its +50 after the (suppressed) W/R step", () => {
    let seen = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      let state = board(seed, 1, 3);
      const target = state.players.p2.active;
      if (target === null) throw new Error("no defender");
      state = {
        ...state,
        players: {
          ...state.players,
          p2: { ...state.players.p2, active: { ...target, damageVulnerability: { turn: state.turn, amount: 50 } } },
        },
      };
      const { state: done, events } = act(state, toll);
      const tails = tailsOf(events);
      // Zero tails: the fold is 0 and the §8.5 gate files nothing — the +50 has no hit to ride.
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(tails === 0 ? 0 : 80 * tails + 50);
      if (tails > 0) seen += 1;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — `MATCH_RECORD_VERSION` HOLDS at 33, and the version.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["../../../apps/api/src/lobby/match.ts"], { query: "?raw", import: "default", eager: true });

describe("D550 §4 — nothing new is persisted, so the record version holds", () => {
  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 33 (🆕🆕🆕 at THIS slice; 34 since D552; 35 since D556; 36 since D564; 37 since D570) — the member is spent into a NUMBER at the fold, the attack never parks, and the board round-trips BYTE-EQUAL", () => {
    const matchTs = Object.entries(RAW).find(([k]) => k.endsWith("/match.ts"))?.[1] ?? "";
    expect(matchTs).toContain("export const MATCH_RECORD_VERSION = 37;");
    expect(JSON.parse(JSON.stringify(MEMBER))).toEqual(MEMBER);
    for (const [own, foe] of [
      [1, 3],
      [5, 0],
    ] as const) {
      const { state: after } = act(board(0, own, foe), toll);
      expect(after.phase.kind).not.toBe("effect:choose");
      const bytes = JSON.stringify(after);
      const persisted = JSON.parse(bytes) as GameState;
      expect(persisted).toEqual(after);
      expect(JSON.stringify(persisted)).toBe(bytes);
      expect(bytes).not.toContain("opponentPerTails");
    }
  });

  it("🛑 the demonstrator is FILE-LOCAL and DECLARED — zero `FIXTURE_POOL` ids, a 60-card deck, the printed '80×'", () => {
    expect(Object.keys(LOCAL_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(LOCAL_DECK).toHaveLength(60);
    expect(LOCAL_CARDS[SNIPER]?.attacks?.[TOLL_INDEX]).toMatchObject({ effect: PRINTED, damage: "80×" });
  });

  it("engineVersion is 0.456.0 and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.456.0");
    expect(manifest.version).toBe("0.456.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
