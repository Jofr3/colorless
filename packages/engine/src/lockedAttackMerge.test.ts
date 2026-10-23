import { describe, expect, it } from "vitest";
import { lockedAttackIndexes } from "./continuous";
import { applyAction, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  OPPONENT_ATTACK_LOCK_DECK,
  PER_ATTACK_LOCK_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const SEED = 13;

/** Skarmory sv03-142's two indices — the body that carries both bars. */
const SLASHING_STEEL = 1;
const PECK = 0;

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function render(
  events: GameEvent[],
  state: GameState,
  names: Record<Seat, string> = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

/** TEST SURGERY: write the list straight onto a seat's Active, for the cases the
    prune rule reaches and no line of play does (an entry stamped for a turn
    already played). Said so rather than skipped, per the family's standing rule. */
function setLocks(state: GameState, seat: Seat, locks: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: locks } } },
  };
}

function collision(names?: Record<Seat, string>): {
  state: GameState;
  log: { who: string; text: string }[];
} {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv03-142");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
  state = attachFromDeck(state, "p1", "fix-energy", 1);

  const self = mustApply(state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
  let p2 = setActiveFromDeck(self.state, "p2", "sv02-094");
  p2 = attachFromDeck(p2, "p2", "fix-psychic-energy", 1);
  p2 = attachFromDeck(p2, "p2", "fix-energy", 1);
  const parked = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
  if (parked.state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${parked.state.phase.kind}`);
  }
  const imposed = mustApply(parked.state, {
    type: "resolveEffect",
    seat: "p2",
    choice: { kind: "attack", index: PECK },
  });
  return {
    state: imposed.state,
    log: [
      ...render(self.events, self.state, names),
      ...render(parked.events, parked.state, names),
      ...render(imposed.events, imposed.state, names),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT: the played board, and what it used to do.
// ─────────────────────────────────────────────────────────────────────────────

describe("two writers, one body, one turn — the board /code-review found", () => {
  it("keeps BOTH bars and refuses BOTH indices", () => {
    const { state } = collision();
    expect(state.turn).toBe(4);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(must0(state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: SLASHING_STEEL },
      { turn: 4, attackIndex: PECK },
    ]);
    expect(refusal(state, "p1", PECK)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p1", SLASHING_STEEL)).toBe("ATTACK_PREVENTED");
    expect(lockedAttackIndexes(state, must0(state.players.p1.active))).toEqual([
      SLASHING_STEEL,
      PECK,
    ]);
  });

  it("…and the board is not simply dead — the CONTROL that keeps the case honest", () => {
    const { state } = collision();
    const free = setLocks(state, "p1", []);
    expect(refusal(free, "p1", PECK)).toBeNull();
    expect(refusal(free, "p1", SLASHING_STEEL)).toBeNull();
  });

  it("the two bars EXPIRE together and by arithmetic, with nothing clearing them", () => {
    // Both entries are stamped 4, so turn 6 answers nothing — and the records are
    // still on the body, which is this family's expiry rule (`attackLocked`'s)
    // unchanged by the list.
    const { state } = collision();
    let later = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(must0(later.players.p1.active).lockedAttacks).toHaveLength(2);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([]);
  });

  it("the SELF bar survives an opponent's bar naming the SAME index — idempotently", () => {
    let state = must(
      applyAction(
        driveSetup(
          SEED,
          { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p1", "sv03-142");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const self = mustApply(state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
    let p2 = setActiveFromDeck(self.state, "p2", "sv02-094");
    p2 = attachFromDeck(p2, "p2", "fix-psychic-energy", 1);
    p2 = attachFromDeck(p2, "p2", "fix-energy", 1);
    const parked = mustApply(p2, { type: "attack", seat: "p2", index: 0 });
    const same = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: SLASHING_STEEL },
    });
    expect(must0(same.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: SLASHING_STEEL },
    ]);
    expect(types(same.events)).not.toContain("ATTACK_LOCKED");
    expect(refusal(same.state, "p1", PECK)).toBeNull();
    expect(refusal(same.state, "p1", SLASHING_STEEL)).toBe("ATTACK_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MERGE RULE: three rules, one function, one place a mutation reaches it.
// ─────────────────────────────────────────────────────────────────────────────

describe("addLockedAttack — the ONE merge rule both writers share", () => {
  it("PRUNES entries whose turn is already behind, so the list cannot grow", () => {
    const { state } = collision();
    const stale = setLocks(state, "p1", [
      { turn: 2, attackIndex: PECK },
      { turn: 3, attackIndex: SLASHING_STEEL },
      { turn: 4, attackIndex: SLASHING_STEEL },
    ]);
    // P1 declares nothing here — the prune happens on the next WRITE, which is
    // P2's opponent-side bar on the turn after this one.
    // P2's Oranguru is still Active with its energy attached from the board above.
    const passed = must(applyAction(stale, { type: "endTurn", seat: "p1" }));
    expect(passed.turn).toBe(5);
    const parked = mustApply(passed, { type: "attack", seat: "p2", index: 0 });
    const written = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: PECK },
    });
    // Turn 5 was the writing turn, so `{ turn: 4 }` and everything older is gone
    // and the new `{ turn: 6 }` entry stands alone.
    expect(must0(written.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 6, attackIndex: PECK },
    ]);
  });

  it("keeps an entry stamped for a turn NOT YET REACHED — pruning is by the past only", () => {
    const { state } = collision();
    const mixed = setLocks(state, "p1", [
      { turn: 4, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
    // The turn-4 bar bites now and the turn-6 one does not…
    expect(lockedAttackIndexes(mixed, must0(mixed.players.p1.active))).toEqual([PECK]);
    // …and two turns on they have swapped, with nothing having written anything.
    let later = must(applyAction(mixed, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(6);
    expect(lockedAttackIndexes(later, must0(later.players.p1.active))).toEqual([SLASHING_STEEL]);
  });

  it("keeps an entry that is LIVE ON THE TURN OF THE WRITE — a PLAYED line, self-side", () => {
    let state = must(
      applyAction(
        driveSetup(
          SEED,
          { p1: PER_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p1", "sv03-142");
    state = setActiveFromDeck(state, "p2", "sv02-094");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-psychic-energy", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    // turn 2 (P1) — installs nothing at all.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // turn 3 (P2) — "Plotter's Command" parks, and P2 picks "Peck": `3 + 1 = 4`.
    const parked = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const imposed = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: PECK },
    });
    // turn 4 (P1) — ONE bar, live, and it is not the index P1 is about to use.
    expect(imposed.state.turn).toBe(4);
    expect(must0(imposed.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: PECK },
    ]);
    expect(lockedAttackIndexes(imposed.state, must0(imposed.state.players.p1.active))).toEqual([
      PECK,
    ]);
    const after = mustApply(imposed.state, { type: "attack", seat: "p1", index: SLASHING_STEEL });
    expect(after.state.turn).toBe(4);
    expect(after.state.phase.kind).toBe("ko:takePrizes");
    // The write KEPT the live entry and appended its own…
    expect(must0(after.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 4, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
    expect(lockedAttackIndexes(after.state, must0(after.state.players.p1.active))).toEqual([PECK]);
  });

  it("…and the OPPONENT-SIDE writer keeps it too — CONSTRUCTED, because parity bars the played line", () => {
    const { state } = collision();
    const surgery = setLocks(state, "p1", [{ turn: 5, attackIndex: PECK }]);
    const passed = must(applyAction(surgery, { type: "endTurn", seat: "p1" }));
    expect(passed.turn).toBe(5);
    // P2's Oranguru is still Active with its energy attached from `collision()`.
    const parked = mustApply(passed, { type: "attack", seat: "p2", index: 0 });
    const written = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "attack", index: SLASHING_STEEL },
    });
    // `now` is 5 and the entry is stamped 5, so it stays; the new bar is `5 + 1`.
    expect(must0(written.state.players.p1.active).lockedAttacks).toEqual([
      { turn: 5, attackIndex: PECK },
      { turn: 6, attackIndex: SLASHING_STEEL },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOTH PAYABILITY PROJECTIONS, under TWO live bars.
// ─────────────────────────────────────────────────────────────────────────────

describe("the projections mark EVERY barred index — the enumerating caller", () => {
  it("`redactedAttacksOf` greys both rows, and agrees with the §8 gate on both", () => {
    const { state } = collision();
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[PECK]?.name).toBe("Peck");
    expect(view.attacks[PECK]?.playable).toBe(false);
    expect(view.attacks[SLASHING_STEEL]?.name).toBe("Slashing Steel");
    expect(view.attacks[SLASHING_STEEL]?.playable).toBe(false);
    // …and the CONTROL: the same board with the list emptied offers both rows, so
    // "both false" cannot be passing because the panel was unpayable anyway.
    const free = redactGame(setLocks(state, "p1", []), "p1").phase;
    if (free.kind !== "turn:action") throw new Error("expected turn:action");
    for (const attack of free.attacks) expect(attack.playable, attack.name).toBe(true);
  });

  it("the OPPONENT's view still carries nothing — two bars leak no more than one", () => {
    const { state } = collision();
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE: two rows, rendered under both seats and READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log does not lie when two bars are live", () => {
  it("prints one row per install, each NAMING its own attack, both under the BARRED seat", () => {
    const { log } = collision();
    expect(log).toEqual([
      { who: "p1", text: "Skarmory used Slashing Steel" },
      { who: "p1", text: "dealt 120 damage to fix-titan" },
      { who: "p1", text: "Skarmory can't use Slashing Steel next turn" },
      { who: "p1", text: "ended their turn" },
      { who: "p2", text: "drew a card" },
      { who: "p2", text: "Oranguru used Plotter's Command" },
      { who: "p2", text: "dealt 30 damage to Skarmory" },
      { who: "p1", text: "Skarmory can't use Peck next turn" },
      { who: "p2", text: "ended their turn" },
      { who: "p1", text: "drew a card" },
    ]);
  });

  it("…and BOTH rows read identically with the seat NAMES swapped", () => {
    const straight = collision().log;
    const swapped = collision({ p1: "Tide", p2: "Ember" }).log;
    expect(swapped).toEqual(straight);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10: the clears shed the WHOLE list, with two bars live.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds every entry, never one of them", () => {
  it("EVOLVING inside the shared window frees BOTH attacks — a played line", () => {
    const { state } = collision();
    const held = handFromDeck(state, "p1", "fix-skarm-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-skarm-stage1"),
      target: { spot: "active" },
    });
    expect(must0(evolved.players.p1.active).lockedAttacks).toEqual([]);
    // …and the evolved body attacks on the same turn, which is §10's rule and not
    // a leniency.
    const { events } = mustApply(evolved, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("RETREATING inside the shared window sheds both — the holder's own route", () => {
    const { state } = collision();
    const active = must0(state.players.p1.active);
    const { state: retreated } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      // Skarmory's printed retreat is 1.
      discardEnergy: active.energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(retreated.players.p1.bench[0]?.lockedAttacks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The SWEEP this fix owes: the OTHER durated address record.
// ─────────────────────────────────────────────────────────────────────────────

describe("the writer sweep — what else could have this shape", () => {
  it("`boostedAttack` is SINGLE-WRITER, which is why it is not a list too", () => {
    const { state } = collision();
    expect(must0(state.players.p1.active).boostedAttack).toBeNull();
    expect(must0(state.players.p2.active).boostedAttack).toBeNull();
    // …and the list did move on the same body, so this is not passing because
    // nothing ran.
    expect(must0(state.players.p1.active).lockedAttacks).toHaveLength(2);
  });

  it("D148's `attackLockedTurn` is untouched — a different field, one writer, no address", () => {
    const { state } = collision();
    expect(must0(state.players.p1.active).attackLockedTurn).toBeNull();
    expect(must0(state.players.p1.active).lockedAttacks).toHaveLength(2);
  });
});
