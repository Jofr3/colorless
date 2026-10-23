import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { firstTurnAttackBanned, passivesOf } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor, redactGame } from "./index";
import { isFirstTurnOf } from "./types";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  battler,
  setActiveFromDeck,
  typedEnergy,
  must,
  firstBasicInHand,
} from "./testFixtures";

const DEBUT_PERFORMANCE_TEXT =
  "If you go first, this Pokémon can use attacks during your first turn.";

/** The attack's printed text — carried so the fixture is the card, and so the
    REFUSAL above is visible to anyone reading the fixture rather than the note. */
const ECHOED_VOICE_TEXT =
  "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).";

const DEBUT_IDS = ["sv10.5b-044", "sv10.5b-159", "sv10.5b-167"] as const;

function meloetta(id: string): Card {
  return battler(id, {
    name: "Meloetta ex",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Debut Performance", effect: DEBUT_PERFORMANCE_TEXT }],
    attacks: [{ cost: ["Psychic"], name: "Echoed Voice", damage: 30, effect: ECHOED_VOICE_TEXT }],
  });
}

const UNLICENSED = "fix-unlicensed";

const LOCAL_CARDS: Record<string, Card> = {
  "sv10.5b-044": meloetta("sv10.5b-044"),
  "sv10.5b-159": meloetta("sv10.5b-159"),
  "sv10.5b-167": meloetta("sv10.5b-167"),
  [UNLICENSED]: battler(UNLICENSED, {
    name: "Unlicensed Singer",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Psychic"], name: "Echoed Voice", damage: 30 }],
  }),
  "fix-psy-energy": typedEnergy("fix-psy-energy", "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DEBUT_DECK = deckOf({
  "sv10.5b-044": 4,
  "sv10.5b-159": 4,
  "sv10.5b-167": 4,
  [UNLICENSED]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-psy-energy": 20,
  "fix-energy": 18,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DEBUT_DECK, p2: DEBUT_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return attachFromDeck(state, seat, "fix-psy-energy", 1);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

const SEEDS = [7, 23, 41, 66, 90] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Meloetta ex — the three printings as registry data", () => {
  it("all THREE ids resolve to ONE program that is the licence and nothing else", () => {
    for (const id of DEBUT_IDS) {
      expect(programFor(id), id).toEqual({ passive: { attackFirstTurnExempt: true } });
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
    // All three share ONE object (D8's reprint rule).
    expect(new Set(DEBUT_IDS.map((id) => programFor(id))).size).toBe(1);
  });

  it("the fixtures carry the printed bytes VERBATIM, and the REFUSED attack too", () => {
    for (const id of DEBUT_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(DEBUT_PERFORMANCE_TEXT);
      expect(POOL[id]?.name, id).toBe("Meloetta ex");
      expect(POOL[id]?.hp, id).toBe(200);
      expect(POOL[id]?.retreat, id).toBe(1);
      expect(POOL[id]?.stage, id).toBe("Basic");
      expect(POOL[id]?.types, id).toEqual(["Psychic"]);
      expect(POOL[id]?.attacks?.length, id).toBe(1);
      expect(POOL[id]?.attacks?.[0]?.effect, id).toBe(ECHOED_VOICE_TEXT);
    }
    expect(POOL[UNLICENSED]?.abilities ?? []).toEqual([]);
    expect(POOL[UNLICENSED]?.attacks?.[0]?.cost).toEqual(POOL["sv10.5b-044"]?.attacks?.[0]?.cost);
    expect(POOL[UNLICENSED]?.types).toEqual(POOL["sv10.5b-044"]?.types);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The fold — `passivesOf`, and the §9 channel it rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — `attackFirstTurnExempt` in the passivesOf fold", () => {
  it("is TRUE for a licensed body and FALSE for one without — the attribution control", () => {
    const licensed = board(SEEDS[0], "p1", "p1", "sv10.5b-044");
    expect(passivesOf(licensed, activeOf(licensed, "p1")).attackFirstTurnExempt).toBe(true);
    const plain = board(SEEDS[0], "p1", "p1", UNLICENSED);
    expect(passivesOf(plain, activeOf(plain, "p1")).attackFirstTurnExempt).toBe(false);
  });

  it("a BOOLEAN and not a list — two licensed sources say the same thing", () => {
    const licensed = board(SEEDS[1], "p2", "p2", "sv10.5b-159");
    expect(typeof passivesOf(licensed, activeOf(licensed, "p2")).attackFirstTurnExempt).toBe(
      "boolean",
    );
  });
});

describe("D277 — `firstTurnAttackBanned`, the extracted §4 read", () => {
  it("bans an unlicensed body on turn 1 and licenses the Meloetta — under BOTH assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      const plain = board(SEEDS[0], first, first, UNLICENSED);
      expect(plain.turn, `${first}`).toBe(1);
      expect(firstTurnAttackBanned(plain, activeOf(plain, first), 0), `${first}`).toBe(true);
      const licensed = board(SEEDS[0], first, first, "sv10.5b-044");
      expect(firstTurnAttackBanned(licensed, activeOf(licensed, first), 0), `${first}`).toBe(false);
    }
  });

  it("IS NOT `isFirstTurnOf` — turn 2 is the going-SECOND seat's first turn and is FREE", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const turn2 = passTurns(board(SEEDS[2], first, second, UNLICENSED), 1);
      expect(turn2.turn, `${first}`).toBe(2);
      // The wrong reader says the ban applies…
      expect(isFirstTurnOf(turn2, second), `${first}`).toBe(true);
      // …and the right one says it does not, on an UNLICENSED body so the licence
      // cannot be what is doing the work.
      expect(firstTurnAttackBanned(turn2, activeOf(turn2, second), 0), `${first}`).toBe(false);
    }
  });

  it("is FALSE for every body from turn 2 onward — the licence changes nothing there", () => {
    for (const activeId of [UNLICENSED, "sv10.5b-167"]) {
      let state = board(SEEDS[3], "p1", "p1", activeId);
      for (let turn = 2; turn <= 6; turn += 1) {
        state = passTurns(state, 1);
        expect(state.turn, `${activeId}@${turn}`).toBe(turn);
        const seat = state.phase.kind === "turn:action" ? state.phase.seat : "p1";
        expect(firstTurnAttackBanned(state, activeOf(state, seat), 0), `${activeId}@${turn}`).toBe(
          false,
        );
      }
    }
  });

  it("takes NO seat — it is a fact about the turn number and about the body", () => {
    let state = board(SEEDS[4], "p1", "p1", UNLICENSED);
    state = setActiveFromDeck(state, "p2", UNLICENSED);
    expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0)).toBe(true);
    expect(firstTurnAttackBanned(state, activeOf(state, "p2"), 0)).toBe(true);
    const licensed = setActiveFromDeck(state, "p2", "sv10.5b-044");
    expect(firstTurnAttackBanned(licensed, activeOf(licensed, "p2"), 0)).toBe(false);
    expect(firstTurnAttackBanned(licensed, activeOf(licensed, "p1"), 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The §8 gate — DRIVEN, both directions, every seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — the §4 ban and its licence, driven through `attack`", () => {
  it("REFUSES an unlicensed turn-1 attack with FIRST_TURN_ATTACK and spends nothing", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, UNLICENSED);
        const result = applyAction(state, { type: "attack", seat: first, index: 0 });
        expect(result.ok, `${seed}/${first}`).toBe(false);
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error.code, `${seed}/${first}`).toBe("FIRST_TURN_ATTACK");
      }
    }
  });

  it("ALLOWS the licensed turn-1 attack, and the damage really lands", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const second = first === "p1" ? "p2" : "p1";
        const state = board(seed, first, first, "sv10.5b-044");
        const before = activeOf(state, second).damage;
        const result = applyAction(state, { type: "attack", seat: first, index: 0 });
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        expect(activeOf(result.state, second).damage, `${seed}/${first}`).toBeGreaterThan(before);
      }
    }
  });

  it("the licence is spent on TURN 1 ONLY — it is not a general attack permit", () => {
    const state = passTurns(board(SEEDS[0], "p1", "p1", "sv10.5b-159"), 2);
    expect(state.turn).toBe(3);
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS THE §4 BAN BACK", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[1], first, first, "sv10.5b-167");
      // The control FIRST: without the lock the same board is licensed.
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(false);
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(true);
      const result = applyAction(state, { type: "attack", seat: first, index: 0 });
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_ATTACK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The OTHER TWO READ SITES — the projections that must not drift.
// ─────────────────────────────────────────────────────────────────────────────

describe("D277 — the three payability projections of ONE rule", () => {
  it("`redactedAttacksOf` greys the unlicensed turn-1 row and un-greys the licensed one", () => {
    for (const first of ["p1", "p2"] as const) {
      const plain = redactGame(board(SEEDS[2], first, first, UNLICENSED), first);
      const plainPhase = plain.phase;
      if (plainPhase.kind !== "turn:action")
        throw new Error(`expected turn:action, got ${plainPhase.kind}`);
      expect(plainPhase.attacks.length, `${first}`).toBe(1);
      expect(
        plainPhase.attacks.every((a) => !a.playable),
        `${first}`,
      ).toBe(true);
      const licensed = redactGame(board(SEEDS[2], first, first, "sv10.5b-044"), first);
      const licensedPhase = licensed.phase;
      if (licensedPhase.kind !== "turn:action") throw new Error("expected turn:action");
      expect(licensedPhase.attacks[0]?.playable, `${first}`).toBe(true);
    }
  });

  it("and it agrees with `attack` on EVERY seed — the two sites read one function", () => {
    for (const seed of SEEDS) {
      for (const activeId of [UNLICENSED, "sv10.5b-044", "sv10.5b-159", "sv10.5b-167"]) {
        const state = board(seed, "p1", "p1", activeId);
        const view = redactGame(state, "p1");
        const phase = view.phase;
        if (phase.kind !== "turn:action") throw new Error("expected turn:action");
        const offered = phase.attacks[0]?.playable === true;
        const accepted = applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok;
        expect(offered, `${seed}/${activeId}`).toBe(accepted);
      }
    }
  });
});
