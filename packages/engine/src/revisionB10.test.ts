import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { healLocked } from "./continuous";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── CARD REVISION, BATCH B10 (Abilities) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B10"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1
// `cards.abilities_json`, byte for byte below):
//   §1 Munkidori "Adrena-Brain" (`me02.5-099` / `sv06-095` / `sv06.5-072` / `sv08.5-044`) and §2 Team
//      Rocket's Orbeetle "Rocket Brain" (`sv10-089` / `sv10-198`) — under an opposing Yveltal
//      `30th-100` "Life-Locked" the SOURCE (the mover's Active) is heal-locked. Both movers took the
//      counters off through `healChosen`, which asks `healLocked` and returns the board unchanged,
//      and then placed the counters on the destination anyway: counters were CREATED, not moved.
//      R-LL1 (D631, ⚠️ UNRULED, not changed here) reads a move off a locked Active as not a heal —
//      `moveCountersFromBench` / `moveCountersBetweenOpponents` never asked the lock — and the two
//      own-board movers now follow it: the source loses exactly what the destination gains.

const ADRENA_BRAIN =
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";
const LIFE_LOCKED = "Your opponent's Active Pokémon can't be healed.";

/** Every Standard-legal Adrena-Brain / Rocket Brain printing on the local D1 (measured 2026-10-19). */
const MUNKIDORI = ["me02.5-099", "sv06-095", "sv06.5-072", "sv08.5-044"] as const;
const ORBEETLE = ["sv10-089", "sv10-198"] as const;
const YVELTAL = "30th-100";
const FILLER = "b10-filler";
const DARK = "b10-dark";

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    MUNKIDORI.map((id) => [
      id,
      battler(id, {
        name: "Munkidori",
        types: ["Psychic"],
        hp: 110,
        retreat: 1,
        abilities: [{ type: "Ability", name: "Adrena-Brain", effect: ADRENA_BRAIN }],
        attacks: [{ cost: ["Psychic", "Colorless"], name: "Mind Bend", damage: 60 }],
      }),
    ]),
  ),
  ...Object.fromEntries(
    ORBEETLE.map((id) => [
      id,
      battler(id, {
        name: "Team Rocket's Orbeetle",
        stage: "Stage2",
        evolveFrom: "Team Rocket's Dottler",
        types: ["Psychic"],
        hp: 130,
        retreat: 2,
        abilities: [{ type: "Ability", name: "Rocket Brain", effect: ROCKET_BRAIN }],
        attacks: [{ cost: ["Psychic", "Colorless", "Colorless"], name: "Psychic", damage: 40 }],
      }),
    ]),
  ),
  [YVELTAL]: battler(YVELTAL, {
    name: "Yveltal",
    hp: 120,
    types: ["Darkness"],
    retreat: 1,
    abilities: [{ type: "Ability", name: "Life-Locked", effect: LIFE_LOCKED }],
    attacks: [{ cost: ["Darkness", "Colorless", "Colorless"], name: "Dark Cutter", damage: 90 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "B10 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [DARK]: typedEnergy(DARK, "Darkness"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  ...Object.fromEntries(MUNKIDORI.map((id) => [id, 1])),
  ...Object.fromEntries(ORBEETLE.map((id) => [id, 1])),
  [YVELTAL]: 2,
  [FILLER]: 14,
  [DARK]: 6,
  "fix-energy": 32, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup with P1 first, then P1's SECOND turn (turn 3). Hands, prizes and discards back into the
    deck; six `fix-energy` make each prize row. */
function p1Turn(): GameState {
  const created = createGame({ seed: 1010, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }));
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 3) throw new Error(`expected turn 3, got ${state.turn}`);
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: { ...side, hand: [], discard: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return state;
}

type Spot = "active" | number;

function at(state: GameState, seat: Seat, spot: Spot = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}

function withBody(state: GameState, seat: Seat, spot: Spot, f: (p: InPlayPokemon) => InPlayPokemon): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(at(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — one deck copy of `id` attached as Energy to the body. */
function attachEnergy(state: GameState, seat: Seat, spot: Spot, id: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in ${seat}'s deck`);
  const moved = { ...state, players: { ...state.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
  return withBody(moved, seat, spot, (p) => ({ ...p, energy: [...p.energy, uid] }));
}

const damaged = (state: GameState, seat: Seat, spot: Spot, damage: number) =>
  withBody(state, seat, spot, (p) => ({ ...p, damage }));

/** P1: Active `active` carrying `own` damage, Bench [Filler]. P2: Active Filler, Bench [Yveltal] when
    `locked` (its Life-Locked holds P1's Active), [Filler] otherwise. */
function board(active: string, own: number, locked: boolean): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  state = benchFromDeck(state, "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  state = benchFromDeck(state, "p2", locked ? YVELTAL : FILLER);
  return damaged(state, "p1", "active", own);
}

const totalDamage = (state: GameState): number =>
  (["p1", "p2"] as const).reduce(
    (sum, seat) =>
      sum +
      [state.players[seat].active, ...state.players[seat].bench].reduce((s, p) => s + (p?.damage ?? 0), 0),
    0,
  );

const ACTIVE = { spot: "active" as const };
const use = (name: string): GameAction =>
  ({ type: "useAbility", seat: "p1", target: ACTIVE, abilityName: name }) as GameAction;
type Ref = { seat: Seat; spot: { spot: "active" } | { spot: "bench"; index: number } };
const pick = (ref: Ref, take?: number): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }) as GameAction;

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("B10 §1 — Adrena-Brain MOVES the counters off a Life-Locked Active (R-LL1)", () => {
  it("every printing runs the one Adrena-Brain program", () => {
    const first = programFor(MUNKIDORI[0]);
    expect(first?.abilities?.[0]?.name).toBe("Adrena-Brain");
    for (const id of MUNKIDORI) expect(programFor(id)).toBe(first);
  });

  for (const id of MUNKIDORI) {
    it(`${id}: "move up to 3 damage counters" — the source loses 30, the opponent's Active gains 30, the total is unchanged`, () => {
      const start = attachEnergy(board(id, 50, true), "p1", "active", DARK);
      // The lock is live on this board: the mover's Active is heal-locked by the benched Yveltal.
      expect(healLocked(start, at(start, "p1"))).toBe(true);
      const before = totalDamage(start);
      const parked = run(start, use("Adrena-Brain")).state;
      if (parked.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
      const { state, events } = run(parked, pick({ seat: "p2", spot: { spot: "active" } }, 3));
      expect(state.phase.kind).toBe("turn:action");
      expect(at(state, "p1").damage).toBe(20);
      expect(at(state, "p2").damage).toBe(30);
      expect(totalDamage(state)).toBe(before);
      expect(all(events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([30]);
      expect(all(events, "HEALED").map((e) => e.amount)).toEqual([30]);
    });
  }

  it("the unlocked control moves the same 30 (the lock changes nothing about a move)", () => {
    const start = attachEnergy(board(MUNKIDORI[1], 50, false), "p1", "active", DARK);
    expect(healLocked(start, at(start, "p1"))).toBe(false);
    const parked = run(start, use("Adrena-Brain")).state;
    const { state } = run(parked, pick({ seat: "p2", spot: { spot: "active" } }, 3));
    expect(at(state, "p1").damage).toBe(20);
    expect(at(state, "p2").damage).toBe(30);
  });
});

/** Drive Rocket Brain once, answering every parked question: the source is the Active, the
    destination P1's benched Filler. */
function rocketBrain(state: GameState): { state: GameState; events: GameEvent[] } {
  let step = run(state, use("Rocket Brain"));
  const events = [...step.events];
  for (let guard = 0; step.state.phase.kind === "effect:choose" && guard < 4; guard++) {
    const phase = step.state.phase;
    const prompt = phase.prompt as { kind: string; candidates?: Ref[] };
    const candidates = prompt.candidates ?? [];
    const choice =
      candidates.find((c) => c.seat === "p1" && c.spot.spot === "bench") ??
      candidates.find((c) => c.seat === "p1" && c.spot.spot === "active");
    if (choice === undefined) throw new Error(`unexpected prompt ${JSON.stringify(prompt)}`);
    step = run(step.state, pick(choice));
    events.push(...step.events);
  }
  return { state: step.state, events };
}

describe("B10 §2 — Rocket Brain MOVES the counter off a Life-Locked Active (R-LL1)", () => {
  it("both printings run the one Rocket Brain program", () => {
    expect(programFor(ORBEETLE[0])?.abilities?.[0]?.name).toBe("Rocket Brain");
    expect(programFor(ORBEETLE[1])).toBe(programFor(ORBEETLE[0]));
  });

  for (const id of ORBEETLE) {
    it(`${id}: "move 1 damage counter" — the Active loses 10, the benched Pokémon gains 10, the total is unchanged`, () => {
      const start = board(id, 40, true);
      expect(healLocked(start, at(start, "p1"))).toBe(true);
      const before = totalDamage(start);
      const { state, events } = rocketBrain(start);
      expect(state.phase.kind).toBe("turn:action");
      expect(at(state, "p1").damage).toBe(30);
      expect(at(state, "p1", 0).damage).toBe(10);
      expect(totalDamage(state)).toBe(before);
      expect(all(events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([10]);
      expect(all(events, "HEALED").map((e) => e.amount)).toEqual([10]);
    });
  }

  it("the unlocked control moves the same 10", () => {
    const start = board(ORBEETLE[0], 40, false);
    expect(healLocked(start, at(start, "p1"))).toBe(false);
    const { state } = rocketBrain(start);
    expect(at(state, "p1").damage).toBe(30);
    expect(at(state, "p1", 0).damage).toBe(10);
  });
});
