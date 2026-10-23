import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, redactGame } from "./index";
import { moveEnergyPlayable } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  OPPONENT_ENERGY_MOVE_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  roundTrip,
} from "./testFixtures";
import type { Seat } from "./types";

const OPP_FREE = "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon.";
const OPP_ACTIVE_TO_BENCH =
  "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.";
const OWN_FREE_TWIN = "Move an Energy from 1 of your Pokémon to another of your Pokémon.";

const STATIC_FLICK = 66; // fix-trainerops — OPP_FREE
const DRAINING_SAP = 67; // fix-trainerops — OPP_ACTIVE_TO_BENCH
const SELF_TO_BENCH = 14;
const SEED = 0x5c43;
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function board({
  ownEnergy = 2,
  oppBench = 2,
  oppEnergy = 2,
  oppBenchEnergy = 1,
  mistOnBench,
  mistOnOppActive = false,
}: {
  ownEnergy?: number;
  oppBench?: number;
  oppEnergy?: number;
  oppBenchEnergy?: number;
  mistOnBench?: number;
  mistOnOppActive?: boolean;
} = {}): GameState {
  let state = mustApply(
    driveSetup(
      SEED,
      { p1: OPPONENT_ENERGY_MOVE_DECK, p2: OPPONENT_ENERGY_MOVE_DECK },
      { first: "p2" },
    ),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "fix-trainerops");
  if (ownEnergy > 0) state = attachFromDeck(state, "p1", "fix-energy", ownEnergy);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  if (oppEnergy > 0) state = attachFromDeck(state, "p2", "fix-energy", oppEnergy);
  if (oppBenchEnergy > 0 && oppBench > 0) {
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", oppBenchEnergy);
  }
  if (mistOnOppActive) state = attachFromDeck(state, "p2", "fix-mist-energy", 1);
  if (mistOnBench !== undefined) {
    state = attachBenchFromDeck(state, "p2", mistOnBench, "fix-mist-energy", 1);
  }
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** The parked moveEnergy prompt, narrowed — and it THROWS rather than returning
    undefined when nothing parked, so a whiffed build cannot read as an empty one. */
function parked(state: GameState): Extract<EffectPrompt, { kind: "moveEnergy" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const p2Active: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const p2Bench = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const p1Bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("§1 — the deriver: two anchors, two sentences, and the possessive that decides the board", () => {
  it("derives both to shipped routes with the seat rider — as PROGRAMS, not booleans", () => {
    expect(deriveAttackEffect(OPP_FREE)).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, side: "opponent" },
    ]);
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 1,
        route: "selfToBench",
        side: "opponent",
      },
    ]);
  });

  it("REFUSES the own-board twin, a swapped possessive, and a trailing clause", () => {
    expect(deriveAttackEffect(OWN_FREE_TWIN)).toBeNull();
    // The DESTINATION possessive is load-bearing too, and separately: a sentence
    // that opens on the opponent and closes on "your" is not printed, and claiming
    // it would build a cross-BOARD move `moveEndpoints` cannot express.
    expect(
      deriveAttackEffect(
        "Move an Energy from 1 of your opponent's Pokémon to another of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "You may move an Energy from your opponent's Active Pokémon to 1 of your Benched Pokémon.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect(`${OPP_FREE} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(`${OPP_ACTIVE_TO_BENCH} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(OPP_FREE)).not.toBeNull();
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH)).not.toBeNull();
  });

  it("the curled re-ingest derives the identical program (both apostrophes, both anchors)", () => {
    const [rawFree] = legalAttackCorpus().filter(([, text]) => text === OPP_FREE);
    const [rawSap] = legalAttackCorpus().filter(([, text]) => text === OPP_ACTIVE_TO_BENCH);
    expect(rawFree?.[1].codePointAt(38)).toBe(0x27);
    expect(rawSap?.[1].codePointAt(41)).toBe(0x27);
    expect(deriveAttackEffect(OPP_FREE.replace("'", "’"))).toEqual(deriveAttackEffect(OPP_FREE));
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH.replace("'", "’"))).toEqual(
      deriveAttackEffect(OPP_ACTIVE_TO_BENCH),
    );
  });

  it("the corpus prints these two sentences at 2 and 3 legal printings, and no others cross the table", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.find(([, text]) => text === OPP_FREE)?.[0]).toBe(2);
    expect(corpus.find(([, text]) => text === OPP_ACTIVE_TO_BENCH)?.[0]).toBe(3);
    const crossing = corpus
      .filter(([, text]) => /mov/i.test(text) && /opponent/.test(text))
      .map(([, text]) => text);
    expect(crossing.sort()).toEqual(
      [
        OPP_FREE,
        OPP_ACTIVE_TO_BENCH,
        "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
        "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
        "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
        "You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon.",
        "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
      ].sort(),
    );
  });

  it("NO reader emits `anyDest` and `side` together — the falsifier both spread dialogs cite", () => {
    const both = legalAttackCorpus()
      .flatMap(([, text]) => deriveAttackEffect(text) ?? [])
      .filter(
        (op): op is Extract<EffectOp, { op: "moveEnergy" }> =>
          op.op === "moveEnergy" && op.anyDest === true && op.side === "opponent",
      );
    expect(both).toEqual([]);
    // THE CONTROL: the sweep does see `moveEnergy` ops, and it sees each rider
    // alone — so the emptiness above is about the PAIR and not about the sweep.
    const movers = legalAttackCorpus()
      .flatMap(([, text]) => deriveAttackEffect(text) ?? [])
      .filter((op): op is Extract<EffectOp, { op: "moveEnergy" }> => op.op === "moveEnergy");
    expect(movers.filter((op) => op.anyDest === true).length).toBeGreaterThan(0);
    expect(movers.filter((op) => op.side === "opponent")).toHaveLength(2);
  });
});

describe("§2 — the park: the offer is on the other board, and nobody else is asked", () => {
  it("every offered source AND destination sits on p2, and p1's own board is offered nothing", () => {
    const prompt = parked(swing(board(), STATIC_FLICK).state);
    expect(prompt.movable.every((offer) => offer.from.seat === "p2")).toBe(true);
    expect(prompt.destinations.every((ref) => ref.seat === "p2")).toBe(true);
    // The free route's `needed: 2` is the printed "another", made structural: every
    // one of p2's in-play bodies is a destination, Active included.
    expect(prompt.destinations).toEqual([p2Active, p2Bench(0), p2Bench(1)]);
    // The sources span TWO bodies (p2's Active and their bench 0), which is what
    // makes "one shielded body drops out and the rest stay" observable in §4.
    expect(new Set(prompt.movable.map((offer) => offer.from.spot.spot)).size).toBe(2);
    const own = parked(swing(board(), SELF_TO_BENCH).state);
    expect(own.movable.every((offer) => offer.from.seat === "p1")).toBe(true);
    expect(own.destinations.every((ref) => ref.seat === "p1")).toBe(true);
  });

  it("`selfToBench` on the other board is their Active → their Bench", () => {
    const prompt = parked(swing(board(), DRAINING_SAP).state);
    expect(prompt.movable.map((offer) => offer.from)).toEqual([p2Active, p2Active]);
    expect(prompt.destinations).toEqual([p2Bench(0), p2Bench(1)]);
  });

  it("the caption is the printed sentence, and the coupled key set is unchanged", () => {
    expect(parked(swing(board(), STATIC_FLICK).state).note).toBe(OPP_FREE);
    expect(parked(swing(board(), DRAINING_SAP).state).note).toBe(
      "Move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    );
    expect(Object.keys(parked(swing(board(), STATIC_FLICK).state)).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "movable",
      "note",
    ]);
  });

  it("the CONTROLLER answers — no `decider`, no `answerer`, and that is §9.4's rule", () => {
    const state = swing(board(), STATIC_FLICK).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.answerer).toBeUndefined();
    expect(state.phase.seat).toBe("p1");
    const uid = parked(state).movable[0]?.uid as string;
    const pick = { kind: "moveEnergy" as const, picks: [{ uid, dest: p2Bench(1) }] };
    expectErr(state, { type: "resolveEffect", seat: "p2", choice: pick }, "WRONG_SEAT");
    expect(applyAction(state, { type: "resolveEffect", seat: "p1", choice: pick }).ok).toBe(true);
  });

  it("the printed 'You may' buys nothing — and neither op carries a floor", () => {
    expect(parked(swing(board(), STATIC_FLICK).state).min).toBeUndefined();
    expect(parked(swing(board(), DRAINING_SAP).state).min).toBeUndefined();
  });

  it("a whiff is silent: no movable Energy, and a bench too short for 'another'", () => {
    // The op's own no-op test, on the other board. An opponent holding no Energy
    // offers nothing; an opponent with ONE body in play has no distinct destination
    // for the free route's printed "another" (`needed: 2`).
    expect(
      swing(board({ oppEnergy: 0, oppBenchEnergy: 0 }), STATIC_FLICK).state.phase.kind,
    ).not.toBe("effect:choose");
    expect(swing(board({ oppBench: 0 }), STATIC_FLICK).state.phase.kind).not.toBe("effect:choose");
    // …and `selfToBench` whiffs on an EMPTY opponent bench for the mirrored reason.
    expect(swing(board({ oppBench: 0 }), DRAINING_SAP).state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§3 — the apply: the Energy moves on THEIR board and nothing of yours moves", () => {
  it("one pick, one row, and both boards are read", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const before = state.players.p1.active?.energy ?? [];
    const uid = parked(state).movable.find((offer) => offer.from.spot.spot === "active")
      ?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    // The Energy left p2's Active and landed on p2's bench 1.
    expect(done.state.players.p2.active?.energy).not.toContain(uid);
    expect(done.state.players.p2.bench[1]?.energy).toContain(uid);
    expect(done.state.players.p1.active?.energy).toEqual(before);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    const [row] = events(done.events, "ENERGY_MOVED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.from).toEqual({ spot: "active" });
    expect(row?.to).toEqual({ spot: "bench", index: 1 });
  });

  it("the wire belt: a destination on the ATTACKER's board is refused, not silently dropped", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const uid = parked(state).movable[0]?.uid as string;
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid, dest: p1Bench(0) }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // The printed "another": a pick may not land on the body it came off, and on
    // the other board that is the SAME per-pick rule rather than a new one.
    const fromActive = parked(state).movable.find((offer) => offer.from.spot.spot === "active")
      ?.uid as string;
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: fromActive, dest: p2Active }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the WHOLE legal answer goes through, so neither refusal passes on a
    // build that refuses everything.
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: fromActive, dest: p2Bench(0) }] },
      }).ok,
    ).toBe(true);
  });

  it("the decline moves nothing on either board", () => {
    const state = swing(board(), DRAINING_SAP).state;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.players.p2.active?.energy).toHaveLength(2);
    expect(done.state.players.p2.bench[0]?.energy).toHaveLength(1);
    expect(events(done.events, "ENERGY_MOVED")).toEqual([]);
  });
});

describe("§4 — §11: the shield this op had never been asked about", () => {
  it("a shielded DESTINATION drops out of the offer and files one prevention row", () => {
    const swung = swing(board({ mistOnBench: 1 }), STATIC_FLICK);
    expect(parked(swung.state).destinations).toEqual([p2Active, p2Bench(0)]);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(parked(swing(board(), STATIC_FLICK).state).destinations).toHaveLength(3);
    expect(events(swing(board(), STATIC_FLICK).events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });

  it("a shielded SOURCE drops its Energy from the offer too — the same body, both lists", () => {
    const swung = swing(board({ mistOnOppActive: true }), STATIC_FLICK);
    const prompt = parked(swung.state);
    expect(prompt.movable.every((offer) => offer.from.spot.spot === "bench")).toBe(true);
    expect(prompt.destinations).toEqual([p2Bench(0), p2Bench(1)]);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("a shielded opponent ACTIVE makes `selfToBench` a silent whiff", () => {
    const swung = swing(board({ mistOnOppActive: true }), DRAINING_SAP);
    expect(swung.state.phase.kind).not.toBe("effect:choose");
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(events(swung.events, "ENERGY_MOVED")).toEqual([]);
  });

  it("the OWN-board family still asks nobody — the gate is `seat !== ctx.seat`, not `moveEnergy`", () => {
    let own = board();
    own = attachFromDeck(own, "p1", "fix-mist-energy", 1);
    const swung = swing(own, SELF_TO_BENCH);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
    expect(parked(swung.state).movable.length).toBeGreaterThan(0);
  });
});

describe("§4b — the playability gate: the funnel and the offer answer about ONE board", () => {
  it("`moveEnergyPlayable` reads the OP's board, not the caller's", () => {
    const oppOnly = board({ ownEnergy: 0 });
    const crossing = {
      op: "moveEnergy",
      filter: { kind: "anyEnergy" },
      max: 1,
      side: "opponent",
    } as const;
    const ownBoard = { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1 } as const;
    // p1 holds NO Energy and p2 holds three across two bodies, so the two answers
    // are opposite on one board — which is what makes this a measurement and not a
    // tautology. A gate reading the caller's seat answers `false` for both.
    expect(moveEnergyPlayable(oppOnly, "p1", crossing)).toBe(true);
    expect(moveEnergyPlayable(oppOnly, "p1", ownBoard)).toBe(false);
    // …and the mirror, from p2's chair: the same two ops swap answers.
    expect(moveEnergyPlayable(oppOnly, "p2", crossing)).toBe(false);
    expect(moveEnergyPlayable(oppOnly, "p2", ownBoard)).toBe(true);
  });
});

describe("§5 — the log: the row reads from the ACTOR and names the OWNER's board", () => {
  const ctx = (state: GameState): LogContext => ({ names: NAMES, state, elapsed: "+00:07" });
  const texts = (state: GameState, all: GameEvent[]) =>
    logFromEvents(all, ctx(state)).flatMap((entry) =>
      entry.kind === "turn" ? [] : [entry.segments.map((segment) => segment.text).join("")],
    );
  const whoOf = (state: GameState, all: GameEvent[]) =>
    logFromEvents(all, ctx(state)).flatMap((entry) => (entry.kind === "turn" ? [] : [entry.who]));

  it("a cross-board move says WHOSE board, and the row belongs to the attacker", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const uid = parked(state).movable.find((offer) => offer.from.spot.spot === "active")
      ?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    const moved = events(done.events, "ENERGY_MOVED");
    const [line] = texts(done.state, moved);
    expect(line).toBe("moved 1 energy on Tide's board, from fix-bigbody to fix-basic-1");
    expect(whoOf(done.state, moved)).toEqual(["p1"]);
  });

  it("an own-board move renders BYTE-IDENTICALLY to the row it always rendered", () => {
    const state = swing(board(), SELF_TO_BENCH).state;
    const uid = parked(state).movable[0]?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p1Bench(0) }] },
    });
    const [line] = texts(done.state, events(done.events, "ENERGY_MOVED"));
    expect(line).toBe("moved 1 energy from fix-trainerops to fix-basic-1");
  });
});

describe("§6 — the wire: the prompt reaches the CONTROLLER, carrying the opponent's refs", () => {
  it("the answerer's snapshot carries p2's refs and uids; the other seat gets null", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const mine = redactGame(state, "p1");
    const wire = mine.phase.kind === "effect:choose" ? mine.phase.prompt : null;
    if (wire === null || wire.kind !== "moveEnergy") throw new Error("expected a wire prompt");
    expect(wire.destinations.every((ref) => ref.seat === "p2")).toBe(true);
    expect(wire.movable.every((offer) => offer.from.seat === "p2")).toBe(true);
    const theirs = redactGame(state, "p2");
    const oppBodies = [theirs.board.you.active, ...theirs.board.you.bench];
    const publicUids = new Set(
      oppBodies.flatMap((body) => body?.attached?.energies.map((card) => card.id) ?? []),
    );
    for (const offer of wire.movable) expect(publicUids.has(offer.uid)).toBe(true);
    // The prompt itself goes to the ANSWERER alone, and the answerer is the
    // controller — `redactedPromptOf`'s `phase.answerer ?? phase.seat`.
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "absent").toBeNull();
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 29", () => {
  it("a reconstructed v29 park still means the CONTROLLER's board, and a v30 one does not", () => {
    const live = swing(board(), STATIC_FLICK).state;

    const serialized: GameState = roundTrip(live);
    if (serialized.phase.kind !== "effect:choose") throw new Error("expected a serialized park");
    const pendingOp = serialized.phase.cont.pendingOp as Record<string, unknown>;
    expect(pendingOp.op).toBe("moveEnergy");
    expect(pendingOp.side).toBe("opponent"); // it IS in the bytes — the reason this is asked
    const { side: _rider, ...ownBoardOp } = pendingOp;
    const resumed: GameState = {
      ...serialized,
      phase: {
        ...serialized.phase,
        cont: { ...serialized.phase.cont, pendingOp: ownBoardOp as unknown as EffectOp },
      },
    };
    const uid = parked(resumed).movable[0]?.uid as string;
    const replayed = mustApply(resumed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    // Nothing moved: `moveEnergyApply` reads the OP's board, and a pick naming the
    // other seat is dropped. The opponent's board is exactly as it was.
    expect(replayed.state.players.p2.bench[1]?.energy).toEqual([]);
    expect(events(replayed.events, "ENERGY_MOVED")).toEqual([]);

    const withRider = mustApply(live, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    expect(withRider.state.players.p2.bench[1]?.energy).toEqual([uid]);
    expect(events(withRider.events, "ENERGY_MOVED")).toHaveLength(1);
  });
});
