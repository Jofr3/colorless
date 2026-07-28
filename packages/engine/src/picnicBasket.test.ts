import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  PICNIC_BASKET_DECK,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setBenchDamage,
} from "./testFixtures";

// M5 single-op long-tail slice (D103): Picnic Basket (sv01-184, Item) — "Heal 30
// damage from each Pokémon (both yours and your opponent's)." A no-choice,
// no-target whole-TABLE heal, so the new `healEachAll` op never parks: it is the
// seat-blind twin of `healEach` (Garganacl), each heal clamped to the Pokémon's
// damage and emitting its own HEALED tagged with THAT Pokémon's own seat.

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    action phase, where an Item is legal. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: PICNIC_BASKET_DECK, p2: PICNIC_BASKET_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** TEST SURGERY: set the Active's damage directly (setBenchDamage's Active twin,
    seat-parameterized — a both-boards heal has to damage the opponent too). */
function setActiveDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...side.active, damage } } },
  };
}

/** The top uid of the Pokémon in a spot — fix-basic-1 stacks are single cards,
    so the top uid identifies the body a HEALED event should name. */
function topUidAt(
  state: GameState,
  seat: Seat,
  spot: "active" | number,
): string {
  const side = state.players[seat];
  const pokemon = spot === "active" ? side.active : side.bench[spot];
  if (pokemon == null) throw new Error(`${seat} has no Pokémon at ${spot}`);
  return pokemon.stack[pokemon.stack.length - 1] as string;
}

/** A 5-body table: P1 Active + 1 bench, P2 Active + 2 bench (one undamaged).
    fix-basic-1 is 60 HP, so every damage value below is sub-lethal — the state
    stays legal and the mid-turn KO sweep never fires. */
function fieldedBoard(seed: number): GameState {
  let state = board(seed);
  state = benchFromDeck(state, "p1", "fix-basic-1"); // p1 bench[0]
  state = benchFromDeck(state, "p2", "fix-basic-1"); // p2 bench[0]
  state = benchFromDeck(state, "p2", "fix-basic-1"); // p2 bench[1] — stays undamaged
  state = setActiveDamage(state, "p1", 50); // → heals 30 → 20
  state = setBenchDamage(state, "p1", 0, 30); // → heals 30 → 0
  state = setActiveDamage(state, "p2", 20); // → clamps to 20 → 0
  state = setBenchDamage(state, "p2", 0, 50); // → heals 30 → 20
  // p2 bench[1] left at 0 — an undamaged Pokémon heals 0 and emits nothing.
  return state;
}

describe("Picnic Basket — healEachAll (both boards)", () => {
  it("heals up to 30 from every damaged Pokémon on BOTH boards, each tagged with its own seat", () => {
    const state = fieldedBoard(3);
    const p1ActiveUid = topUidAt(state, "p1", "active");
    const p1BenchUid = topUidAt(state, "p1", 0);
    const p2ActiveUid = topUidAt(state, "p2", "active");
    const p2BenchUid = topUidAt(state, "p2", 0);
    const p2UndamagedUid = topUidAt(state, "p2", 1);

    const withCard = handFromDeck(state, "p1", "sv01-184", 1);
    const playedUid = handUid(withCard, "p1", "sv01-184");
    const { state: done, events } = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: playedUid,
    });

    const healed = findAll(events, "HEALED");
    // Four damaged Pokémon across both boards; the undamaged p2 bench[1] emits nothing.
    expect(healed).toHaveLength(4);
    // Each heal is clamped to min(30, damage): the p2 Active's 20 heals 20, the rest 30.
    expect(healed.map((h) => h.amount).sort((a, b) => a - b)).toEqual([20, 30, 30, 30]);
    // Own-seat tagging: the p2 events name p2's damaged bodies, never p1's.
    const uidsFor = (s: Seat) => healed.filter((h) => h.seat === s).map((h) => h.uid).sort();
    expect(uidsFor("p1")).toEqual([p1ActiveUid, p1BenchUid].sort());
    expect(uidsFor("p2")).toEqual([p2ActiveUid, p2BenchUid].sort());
    // The undamaged Pokémon is never named.
    expect(healed.some((h) => h.uid === p2UndamagedUid)).toBe(false);

    // Final damage: every board healed, clamped, undamaged untouched.
    expect(done.players.p1.active?.damage).toBe(20);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(done.players.p2.bench[1]?.damage).toBe(0);

    // The Item is spent (hand → discard) and the turn resumes.
    expect(done.players.p1.discard).toContain(playedUid);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("an undamaged whole board heals nothing but still spends the Item (the Potion no-whiff doctrine)", () => {
    let state = board(4);
    state = benchFromDeck(state, "p2", "fix-basic-1"); // both boards present, all at 0 damage
    const withCard = handFromDeck(state, "p1", "sv01-184", 1);
    const uid = handUid(withCard, "p1", "sv01-184");
    const { state: done, events } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });

    expect(findAll(events, "HEALED")).toHaveLength(0);
    // Legal to play with nothing damaged (healEachAll has no would-whiff gate) —
    // the Item is discarded and the turn continues.
    expect(done.players.p1.discard).toContain(uid);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("does not mutate the frozen prior state", () => {
    const state = fieldedBoard(3);
    const withCard = handFromDeck(state, "p1", "sv01-184", 1);
    const uid = handUid(withCard, "p1", "sv01-184");
    deepFreeze(withCard);
    expect(() =>
      applyAction(withCard, { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
  });
});
