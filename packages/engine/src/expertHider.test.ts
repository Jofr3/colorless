import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { coinFlipShieldPrevents } from "./damageCalc";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { type CoinFace, flipCoin } from "./rng";
import {
  COIN_FLIP_SHIELD_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
  findEvents,
} from "./testFixtures";

const crush = { type: "attack", seat: "p1", index: 0 } as const; // 200 flat
const bigSpread = { type: "attack", seat: "p1", index: 3 } as const; // 30 + 200 to each bench
const yawn = { type: "attack", seat: "p1", index: 7 } as const; // Asleep — a pure effect op

const BOULDER_TOSS = 5; // 200 to 1 of your opponent's Pokémon
const SNEAK_BOULDER = 6; // 200 to 1, `ignoreWR` — the Feint Attack clause

const HIDER_TEXT =
  "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.";
const PHEROMONE_TEXT =
  "If this Pokémon has any {D} Energy attached and is damaged by an attack, flip a coin. If heads, prevent that damage.";

function stateForFaces(faces: readonly CoinFace[]): number {
  for (let s = 1; s < 100_000; s++) {
    let rng = s;
    let ok = true;
    for (const want of faces) {
      const [face, next] = flipCoin(rng);
      rng = next;
      if (face !== want) {
        ok = false;
        break;
      }
    }
    if (ok) return s;
  }
  throw new Error(`no rngState produces ${faces.join(",")}`);
}

const HEADS = stateForFaces(["heads"]);
const TAILS = stateForFaces(["tails"]);

function withRng(state: GameState, rngState: number): GameState {
  return { ...state, rngState };
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

function benchIndexOf(state: GameState, cardId: string): number {
  const i = state.players.p2.bench.findIndex((p) => cardIdAt(state, p) === cardId);
  if (i < 0) throw new Error(`no benched ${cardId}`);
  return i;
}

function holderActive(holderId: string): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** `holderActive`, with `count` copies of `energyId` attached to the HOLDER — the
    board Fezandipiti's printed conjunct is answered on, and the only difference
    between armed and unarmed is which Energy card that is. */
function holderActiveWith(holderId: string, energyId: string, count = 1): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p2", energyId, count);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE SECOND BOARD: the holder on P2's BENCH under a plain Active, with the
    no-Ability control beside it. The printed sentences carry NO zone clause, so
    this must answer exactly as `holderActive` does. */
function holderBenched(holderId: string): GameState {
  let state = driveSetup(
    1,
    { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", holderId);
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("the coin-flip shield — the registry data rows", () => {
  it("authors BOTH printed sentences, and the ids are the measured five", () => {
    for (const id of ["sv06-096", "sv06.5-073", "sv08.5-045"]) {
      expect(programFor(id)?.passive?.preventDamageOnCoinFlip, id).toEqual({
        ability: "Adrena-Pheromone",
        requiresEnergyType: "Darkness",
      });
    }
    for (const id of ["sv08-150", "sv08-213"]) {
      expect(programFor(id)?.passive?.preventDamageOnCoinFlip, id).toEqual({
        ability: "Expert Hider",
      });
    }
  });

  it("Kecleon's row does NOT carry the conjunct key at all", () => {
    expect(programFor("sv08-150")?.passive?.preventDamageOnCoinFlip).not.toHaveProperty(
      "requiresEnergyType",
    );
  });

  it("reprints share an object; the two SENTENCES do not", () => {
    expect(programFor("sv06.5-073")).toBe(programFor("sv06-096"));
    expect(programFor("sv08.5-045")).toBe(programFor("sv06-096"));
    expect(programFor("sv08-213")).toBe(programFor("sv08-150"));
    expect(programFor("sv08-150")).not.toBe(programFor("sv06-096"));
  });

  it("authors NO attack program on any of the five printings", () => {
    for (const id of ["sv06-096", "sv06.5-073", "sv08.5-045", "sv08-150", "sv08-213"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("has exactly TWO fixture demonstrators in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageOnCoinFlip !== undefined,
    );
    expect(holders).toEqual(["fix-experthider", "fix-adrenapheromone"]);
    expect(programFor("fix-experthider")).toBe(programFor("sv08-150"));
    expect(programFor("fix-adrenapheromone")).toBe(programFor("sv06-096"));
  });

  it("the demonstrators print the sentences verbatim", () => {
    expect(FIXTURE_POOL["fix-experthider"]?.abilities?.[0]?.effect).toBe(HIDER_TEXT);
    expect(FIXTURE_POOL["fix-adrenapheromone"]?.abilities?.[0]?.effect).toBe(PHEROMONE_TEXT);
  });

  it("every writer of the field is a POKÉMON — no Tool, no Energy", () => {
    const writers = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageOnCoinFlip !== undefined,
    );
    for (const id of writers) {
      expect(FIXTURE_POOL[id]?.category, id).toBe("Pokemon");
    }
  });
});

describe("the fold — `passivesOf.preventDamageOnCoinFlip`", () => {
  // The UNGATED sentence needs nothing: an entry is present on a bare board.
  it("Kecleon's shield is present unconditionally, and names its Ability", () => {
    const state = holderActive("fix-experthider");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    expect(passivesOf(state, active).preventDamageOnCoinFlip).toEqual([
      { ability: "Expert Hider" },
    ]);
  });

  it("Fezandipiti's shield needs a {D} — a Colorless does NOT arm it", () => {
    const armed = holderActiveWith("fix-adrenapheromone", "fix-dark-energy");
    const bare = holderActiveWith("fix-adrenapheromone", "fix-energy");
    const a = armed.players.p2.active;
    const b = bare.players.p2.active;
    if (a === null || b === null) throw new Error("no active");
    expect(passivesOf(armed, a).preventDamageOnCoinFlip).toEqual([{ ability: "Adrena-Pheromone" }]);
    expect(passivesOf(bare, b).preventDamageOnCoinFlip).toEqual([]);
  });

  // A body with no such Ability folds to the EMPTY list, which is what makes the
  // read sites pay one `.length === 0` over nothing on every ordinary board.
  it("a body with no shield folds to []", () => {
    const state = holderActive("fix-experthider");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("no titan");
    expect(passivesOf(state, titan).preventDamageOnCoinFlip).toEqual([]);
  });
});

describe("the funnel — `coinFlipShieldPrevents`", () => {
  it("draws NO coin for zero damage — the state is untouched", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, active, "p2", 0, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  it("draws no coin for a negative amount either", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, active, "p2", -10, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  // A body with no shield draws nothing, which is the ordinary case on every board
  // in the suite and the reason this funnel costs nothing where it does not apply.
  it("draws no coin for a body with no shield", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("no titan");
    const events: GameEvent[] = [];
    expect(coinFlipShieldPrevents(state, titan, "p2", 200, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });

  it("heads prevents, tails does not, and BOTH advance the state and emit a row", () => {
    const state = holderActive("fix-experthider");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no active");
    for (const [rng, face, prevented] of [
      [HEADS, "heads", true],
      [TAILS, "tails", false],
    ] as const) {
      const events: GameEvent[] = [];
      const [answer, next] = coinFlipShieldPrevents(withRng(state, rng), active, "p2", 200, events);
      expect(answer).toBe(prevented);
      expect(next).not.toBe(rng);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "ABILITY_COIN_FLIP",
        seat: "p2",
        ability: "Expert Hider",
        result: face,
      });
    }
  });
});

describe("read site 1/4 — attack.ts's main hit", () => {
  it("HEADS prevents the whole 200; the benched control takes it", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({
      ability: "Expert Hider",
      result: "heads",
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("TAILS lets the whole 200 through", () => {
    const state = withRng(holderActive("fix-experthider"), TAILS);
    const { state: done, events } = mustApply(state, crush);
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 200, prevented: undefined });
    expect(done.players.p2.active?.damage).toBe(200);
  });

  it("the no-Ability control takes the identical 200 and flips nothing", () => {
    const state = withRng(holderActive("fix-titan"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    expect(findEvents(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(200);
    expect(done.rngState).toBe(HEADS);
  });

  it("Fezandipiti flips only when a {D} is attached", () => {
    const armed = withRng(holderActiveWith("fix-adrenapheromone", "fix-dark-energy"), HEADS);
    const bare = withRng(holderActiveWith("fix-adrenapheromone", "fix-energy"), HEADS);
    const hit = mustApply(armed, crush);
    expect(findEvent(hit.events, "ABILITY_COIN_FLIP")).toMatchObject({
      ability: "Adrena-Pheromone",
      result: "heads",
    });
    expect(hit.state.players.p2.active?.damage).toBe(0);

    const through = mustApply(bare, crush);
    expect(findEvents(through.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(through.state.players.p2.active?.damage).toBe(200);
    expect(through.state.rngState).toBe(HEADS);
  });

  it("announces the flip BEFORE the DAMAGE_DEALT row", () => {
    const { events } = mustApply(withRng(holderActive("fix-experthider"), HEADS), crush);
    const flip = events.findIndex((e) => e.type === "ABILITY_COIN_FLIP");
    const dealt = events.findIndex((e) => e.type === "DAMAGE_DEALT");
    expect(flip).toBeGreaterThanOrEqual(0);
    expect(flip).toBeLessThan(dealt);
  });

  it("§9 — Klefki's lock silences the shield in the FOLD", () => {
    let state = holderActive("fix-experthider");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).preventDamageOnCoinFlip).toEqual([]);
  });

  // …and the lock reaches the DAMAGE and the RNG together, which is the pair that
  // makes the §9 claim a behaviour rather than a property read. Klefki's own
  // index-0 "Joust" is 10, not Crush — the attacker changed, so the number does.
  it("…and the damage then LANDS with NO coin drawn", () => {
    let state = holderActive("fix-experthider");
    state = setActiveFromDeck(state, "p1", "sv01-096");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = withRng(state, HEADS);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvents(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(10);
    expect(done.rngState).toBe(HEADS);
  });
});

describe("read site 2/4 — the spread", () => {
  // The holder benched: no zone clause, so this answers exactly as the Active does.
  it("HEADS shields a benched holder from the splash", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, bigSpread);
    expect(findEvents(events, "ABILITY_COIN_FLIP")).toHaveLength(1);
    expect(onBench(done, "fix-experthider")?.damage).toBe(0);
    expect(onBench(done, "fix-titan")?.damage).toBe(200);
  });

  it("a spread into THREE holders draws THREE coins, in order, from advancing state", () => {
    let state = driveSetup(
      1,
      { p1: COIN_FLIP_SHIELD_DECK, p2: COIN_FLIP_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = benchFromDeck(state, "p2", "fix-experthider");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-crusher");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = withRng(state, stateForFaces(["heads", "tails", "heads"]));

    const { state: done, events } = mustApply(state, bigSpread);
    expect(findEvents(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual([
      "heads",
      "tails",
      "heads",
    ]);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([0, 200, 0]);
    // …and the three rows name three DIFFERENT bodies, so a build that flipped once
    // and announced it three times cannot pass.
    expect(new Set(findEvents(events, "ABILITY_COIN_FLIP").map((e) => e.uid)).size).toBe(3);
  });
});

describe("read sites 3/4 and 4/4 — the two snipe arms", () => {
  it("placeSnipe: HEADS shields the benched pick", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "fix-experthider");
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "heads" });
    expect(onBench(done, "fix-experthider")?.damage).toBe(0);
  });

  it("placeSnipe: TAILS lets the 200 land on the benched pick", () => {
    const state = withRng(holderBenched("fix-experthider"), TAILS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "fix-experthider");
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(onBench(done, "fix-experthider")?.damage).toBe(200);
  });

  it("snipeActive: HEADS shields the Active pick", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "heads" });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("snipeActive: TAILS lets the 200 land on the Active pick", () => {
    const state = withRng(holderActive("fix-experthider"), TAILS);
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(findEvent(events, "ABILITY_COIN_FLIP")).toMatchObject({ result: "tails" });
    expect(done.players.p2.active?.damage).toBe(200);
  });

  it("`ignoreWR` nulls the shield AND draws no coin — both snipe arms", () => {
    for (const [board, read] of [
      [holderBenched("fix-experthider"), "fix-experthider"],
      [holderActive("fix-experthider"), "active"],
    ] as const) {
      const state = withRng(board, HEADS);
      const { state: done, events } = snipeAt(state, SNEAK_BOULDER, read);
      expect(findEvents(events, "ABILITY_COIN_FLIP")).toEqual([]);
      const body = read === "active" ? done.players.p2.active : onBench(done, read);
      expect(body?.damage).toBe(200);
      expect(done.rngState).toBe(HEADS);
    }
  });

  it("a placed COUNTER is not damage, so no shield and no coin", () => {
    const state = withRng(holderBenched("fix-experthider"), HEADS);
    const bench = state.players.p2.bench[benchIndexOf(state, "fix-experthider")];
    if (bench === undefined) throw new Error("no holder");
    const events: GameEvent[] = [];
    // The counter arm never reaches the funnel; asserting the funnel's own contract
    // for "no damage" is the reading, and the `!deals` branch is what carries it.
    expect(coinFlipShieldPrevents(state, bench, "p2", 0, events)).toEqual([false, HEADS]);
    expect(events).toEqual([]);
  });
});

describe("what this field deliberately does NOT reach", () => {
  it("an attack's EFFECT still lands on a holder (no effects half)", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { events } = mustApply(state, yawn);
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "asleep" });
  });

  // …and the effect-only attack draws NO coin, because it does no damage. The same
  // printed antecedent, read on the other half of the pipeline.
  it("an effect-only attack draws no SHIELD coin at all", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { events } = mustApply(state, yawn);
    expect(findEvents(events, "ABILITY_COIN_FLIP")).toEqual([]);
  });
});

describe("the record stays replayable — MATCH_RECORD_VERSION does NOT move", () => {
  it("the same board and the same action replay to identical events and state", () => {
    const state = deepFreeze(withRng(holderActive("fix-experthider"), HEADS));
    const a = mustApply(state, crush);
    const b = mustApply(state, crush);
    expect(b.events).toEqual(a.events);
    expect(b.state.rngState).toBe(a.state.rngState);
    expect(b.state.players.p2.active?.damage).toBe(a.state.players.p2.active?.damage);
  });

  // …and the flip really did consume a step, so the case above is not green because
  // nothing happened.
  it("a drawn coin ADVANCES the persisted rngState", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done } = mustApply(state, crush);
    expect(done.rngState).not.toBe(HEADS);
    expect(done.rngState).toBe(flipCoin(HEADS)[1]);
  });

  it("adds no GameState key — the shape is byte-identical", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done } = mustApply(state, crush);
    expect(Object.keys(done).sort()).toEqual(Object.keys(state).sort());
  });
});

describe("the log renders the flip with no new row type", () => {
  it("names the holder, the face and the Ability", () => {
    const state = withRng(holderActive("fix-experthider"), HEADS);
    const { state: done, events } = mustApply(state, crush);
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state: done,
      elapsed: "+00:07",
    };
    const rows = logFromEvents(events, ctx).map((entry) =>
      entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join(""),
    );
    expect(rows.some((r) => r.includes("flipped") && r.includes("heads"))).toBe(true);
    expect(rows.some((r) => r.includes("Expert Hider"))).toBe(true);
  });
});
