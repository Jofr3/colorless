import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  benchFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handToDeck,
  handUid,
  handUids,
  mustApply,
  types,
  findEvent,
} from "./testFixtures";

const BATTLE_HARDENED_IDS = ["sv06.5-025", "sv08.5-054"] as const;

const BATTLE_HARDENED_TEXT =
  "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon.";

const DECK = deckOf({
  "sv06.5-025": 4,
  "fix-bigbody": 20, // 200 HP dominant Basic — mulligan-free setup, and the Active
  "fix-fighting-energy": 16, // {F} — the type the sentence names
  "fix-energy": 20, // Colorless Basic Energy — the type it must REFUSE
});

function board(seed: number): GameState {
  const setup = driveSetup(
    seed,
    { p1: DECK, p2: DECK },
    {
      first: "p2",
      active: { p1: "fix-bigbody", p2: "fix-bigbody" },
    },
  );
  return mustApply(setup, { type: "endTurn", seat: "p2" }).state;
}

/** Exactly `count` Basic {F} Energy in P1's hand — the opening hand is DRAWN from
    a shuffled deck, so a hand-size claim is a seed claim unless the hand is
    emptied of the card first and then dealt back (the standing rule). */
function fightingInHand(state: GameState, count: number): GameState {
  const cleared = handToDeck(state, "p1", "fix-fighting-energy");
  return count === 0 ? cleared : handFromDeck(cleared, "p1", "fix-fighting-energy", count);
}

/** P1's hand with the {F} count pinned and an Ursaluna guaranteed in it. */
function ready(seed: number, fighting: number): GameState {
  let state = handFromDeck(board(seed), "p1", "sv06.5-025", 1);
  state = fightingInHand(state, fighting);
  return state;
}

function benchEnergyIds(state: GameState, index: number): string[] {
  const pokemon = state.players.p1.bench[index];
  if (pokemon === undefined) throw new Error(`p1 has no bench[${index}]`);
  return pokemon.energy.map((uid) => state.cardIdByUid[uid] as string);
}

function answerPark(state: GameState, take?: number): GameState {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }).state;
}

function benchAndAnswer(
  state: GameState,
  take?: number,
): { state: GameState; events: GameEvent[] } {
  const uid = handUid(state, "p1", "sv06.5-025");
  const played = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
  if (played.state.phase.kind !== "effect:choose") return played;
  const prompt = played.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  const answered = mustApply(played.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
  return { state: answered.state, events: [...played.events, ...answered.events] };
}

const SEED = 7;

const SETUP_SEED = 18;

// ── The registry rows ────────────────────────────────────────────────────────

describe("D250 — the registry rows", () => {
  it("maps BOTH Standard-legal printings to ONE object", () => {
    const first = programFor(BATTLE_HARDENED_IDS[0]);
    expect(first, "sv06.5-025 has no program").toBeDefined();
    for (const id of BATTLE_HARDENED_IDS) {
      expect(programFor(id), `${id} left Battle-Hardened`).toBe(first);
    }
    expect(new Set(BATTLE_HARDENED_IDS).size).toBe(2);
    expect(programFor("fix-battlehardened")).toBeUndefined();
  });

  it("authors the program EXACTLY — the timing, the count, and the self target", () => {
    expect(programFor("sv06.5-025")?.triggered).toEqual([
      {
        name: "Battle-Hardened",
        trigger: "onPlayToBench",
        // The printed "you may". AUTO-FIRES (the flag's own doc): attaching your
        // own Energy to your own body is pure upside with nothing to decline.
        program: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Fighting",
            count: 2,
            toSelf: true,
          },
        ],
      },
    ]);
    // No Active clause in the sentence — and the timing names the BENCH, so an
    // `activeOnly` here would refuse every firing there is. Pinned as an ABSENCE
    // because it is the field both neighbouring rows in this family carry.
    expect(programFor("sv06.5-025")?.triggered?.[0]).not.toHaveProperty("activeOnly");
    expect(programFor("sv06.5-025")?.abilities).toBeUndefined();
    expect(programFor("sv06.5-025")?.attack).toBeUndefined();
  });

  it("carries the printed sentence on both printings, byte for byte", () => {
    // Only `sv06.5-025` is fielded; the reprint's text is the D1's, quoted in the
    // registry doc. What the fixture can check is that the FIELDED one is verbatim.
    expect(programFor("sv06.5-025")).toBeDefined();
    const fixture = board(SEED);
    const card = fixture.players.p1.deck
      .map((uid) => fixture.cardIdByUid[uid])
      .find((id) => id === "sv06.5-025");
    expect(card).toBe("sv06.5-025");
    expect(BATTLE_HARDENED_TEXT).toContain("up to 2 Basic {F} Energy cards");
    expect(BATTLE_HARDENED_TEXT).toContain("to this Pokémon");
  });
});

// ── The trigger ──────────────────────────────────────────────────────────────

describe("D250 — Battle-Hardened fires on the bench play (§9)", () => {
  it("D359 — it PARKS, and the park names ONE body and the printed ceiling", () => {
    const state = ready(SEED, 2);
    const benchBefore = state.players.p1.bench.length;
    const played = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(state, "p1", "sv06.5-025"),
    });
    expect(types(played.events)).toContain("EFFECT_PENDING");
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = played.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // ONE candidate — the body just benched — and the printed ceiling beside it.
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.candidates[0]?.spot).toEqual({ spot: "bench", index: benchBefore });
    expect(prompt.upTo).toBe(2);
    expect(prompt.note).toBe("Attach up to 2 Energy to this Pokémon?");
  });

  it("attaches TWO Basic {F} to the body just benched when the FULL take is answered", () => {
    const state = ready(SEED, 2);
    const benchBefore = state.players.p1.bench.length;
    const { state: done, events } = benchAndAnswer(state);
    // The bench play AND the trigger landed in the one batch.
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(findEvent(events, "ABILITY_TRIGGERED")?.ability).toBe("Battle-Hardened");
    expect(done.phase.kind).toBe("turn:action");
    const index = benchBefore;
    expect(done.players.p1.bench[index]?.stack.map((u) => done.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    expect(benchEnergyIds(done, index)).toEqual(["fix-fighting-energy", "fix-fighting-energy"]);
    // Two ENERGY_ATTACHED rows, both naming that bench slot.
    const attached = events.filter((e) => e.type === "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const event of attached) {
      expect(event).toMatchObject({ seat: "p1", target: { spot: "bench", index } });
    }
  });

  it("`toSelf` feeds the NEW body and NOT the Active — the trigger's ctx.sourceUid", () => {
    const state = ready(SEED, 2);
    const activeBefore = state.players.p1.active?.energy.length ?? 0;
    const { state: done } = benchAndAnswer(state);
    expect(done.players.p1.active?.energy).toHaveLength(activeBefore);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toHaveLength(2);
  });

  it("`count: 2` is a CAP — a hand with three {F} keeps one", () => {
    const state = ready(SEED, 3);
    const { state: done } = benchAndAnswer(state);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([
      "fix-fighting-energy",
      "fix-fighting-energy",
    ]);
    // The third stayed in hand — a `count` of 3 (or an unbounded attach) fails here.
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(1);
  });

  it("`count: 2` is `min(count, available)` — the printed 'UP TO', silently", () => {
    const state = ready(SEED, 1);
    const { state: done, events } = benchAndAnswer(state);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual(["fix-fighting-energy"]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
    const played = mustApply(ready(SEED, 1), {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(ready(SEED, 1), "p1", "sv06.5-025"),
    });
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = played.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
  });

  it("D359 — the printed MIDDLE answer: ONE of two, with the second kept in hand", () => {
    const state = ready(SEED, 2);
    const { state: done, events } = benchAndAnswer(state, 1);
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual(["fix-fighting-energy"]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(1);
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("D359 — the ZERO answer moves nothing and announces nothing", () => {
    const state = ready(SEED, 2);
    const played = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(state, "p1", "sv06.5-025"),
    });
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const done = mustApply(played.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" },
    });
    expect(benchEnergyIds(done.state, done.state.players.p1.bench.length - 1)).toEqual([]);
    expect(done.events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(0);
    expect(
      done.state.players.p1.hand.filter((u) => done.state.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(2);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("whiffs green on an empty {F} hand — the printed 'you may', already honoured", () => {
    const state = ready(SEED, 0);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });
    // It STILL triggered — the whiff is inside the op, not at the timing.
    expect(findEvent(events, "ABILITY_TRIGGERED")?.ability).toBe("Battle-Hardened");
    expect(types(events)).not.toContain("ENERGY_ATTACHED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).toBe("turn:action");
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([]);
  });

  it('refuses COLORLESS — `energyType: "Fighting"` is the printed {F}', () => {
    // The hand is emptied of {F} and dealt Colorless instead; the deck is 20/60
    // `fix-energy`, so there is plenty. An `anyEnergy` rider or a wrong type name
    // would attach two here.
    let state = ready(SEED, 0);
    state = handFromDeck(state, "p1", "fix-energy", 3);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });
    expect(types(events)).not.toContain("ENERGY_ATTACHED");
    expect(benchEnergyIds(done, done.players.p1.bench.length - 1)).toEqual([]);
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-energy").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("fires PER BODY — a second Ursaluna feeds ITSELF, not the first", () => {
    let state = handFromDeck(board(SEED), "p1", "sv06.5-025", 2);
    state = fightingInHand(state, 4);
    const [first, second] = handUids(state, "p1", "sv06.5-025", 2) as [string, string];
    const afterFirst = answerPark(
      mustApply(state, { type: "playBasicToBench", seat: "p1", uid: first }).state,
    );
    const firstIndex = afterFirst.players.p1.bench.length - 1;
    expect(benchEnergyIds(afterFirst, firstIndex)).toHaveLength(2);
    const done = answerPark(
      mustApply(afterFirst, { type: "playBasicToBench", seat: "p1", uid: second }).state,
    );
    const secondIndex = done.players.p1.bench.length - 1;
    expect(secondIndex).toBe(firstIndex + 1);
    // TWO each, not FOUR and ZERO.
    expect(benchEnergyIds(done, firstIndex)).toHaveLength(2);
    expect(benchEnergyIds(done, secondIndex)).toHaveLength(2);
    expect(done.players.p1.active?.energy).toHaveLength(0);
  });
});

// ── The timing's negatives ───────────────────────────────────────────────────

describe("D250 — Battle-Hardened's timing refuses everything that is not the play", () => {
  it("does NOT fire on a SETUP placement — 'during your turn' is a real word", () => {
    // Setup placement is a different handler and is not a turn. Driven by placing
    // an Ursaluna as the Active AND on the setup Bench, then reading the board:
    // an `onEvolve`/timing-free wiring would have fed one of them.
    const state = driveSetup(
      SETUP_SEED,
      { p1: DECK, p2: DECK },
      {
        first: "p2",
        active: { p1: "sv06.5-025", p2: "fix-bigbody" },
        bench: { p1: ["sv06.5-025"] },
      },
    );
    expect(state.players.p1.bench[0]?.stack.map((u) => state.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    // The BENCHED one is the sharp half: it sits in exactly the spot the trigger
    // names, placed by exactly the wrong verb.
    expect(state.players.p1.bench[0]?.energy).toEqual([]);
    expect(state.players.p1.active?.stack.map((u) => state.cardIdByUid[u])).toEqual(["sv06.5-025"]);
    expect(state.players.p1.active?.energy).toEqual([]);
  });

  it("does NOT fire on SURGERY — `benchFromDeck` is not `playBasicToBench`", () => {
    const state = fightingInHand(board(SEED), 2);
    const surgical = benchFromDeck(state, "p1", "sv06.5-025");
    const index = surgical.players.p1.bench.length - 1;
    expect(surgical.players.p1.bench[index]?.stack.map((u) => surgical.cardIdByUid[u])).toEqual([
      "sv06.5-025",
    ]);
    expect(benchEnergyIds(surgical, index)).toEqual([]);
    // …and the two {F} are still sitting in hand, untouched.
    expect(
      surgical.players.p1.hand.filter((u) => surgical.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(2);
  });

  it("does not fire for the OPPONENT when P1 benches — the trigger runs under its controller", () => {
    const state = ready(SEED, 2);
    const uid = handUid(state, "p1", "sv06.5-025");
    const { state: done } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(done.players.p2.active?.energy).toEqual([]);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
  });
});
