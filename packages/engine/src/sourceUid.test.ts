import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectPrompt, PokemonRef } from "./interpreter";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  SOURCE_UID_DECK,
  activeUid,
  benchFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: `EffectContext.sourceUid` — the printed "this Pokémon". The
// context now names the Pokémon whose effect is running, set at every run site
// that knows it (useAbility, the trigger runners, the attacker) and ABSENT for
// a Trainer program. First reader: `attachFromDeck.toSelf`, which lands
//
//   • PAWMOT (sv01-076/-209) — "Electrogenesis": "Once during your turn, you
//     may search your deck for a Basic {L} Energy card and attach it to THIS
//     Pokémon. Then, shuffle your deck."
//
// The headline claim this file exists to pin: a BENCHED Pawmot feeds ITSELF.
// Every earlier attach target rule was seat-relative ("your Pokémon", "your
// Benched {L} Pokémon") — none could say "the one using the Ability", and a
// wrong implementation that fell back to the Active would look correct on
// every board where Pawmot IS the Active. The bench boards below are the ones
// that tell the two apart.

const SEED = 20260722;

const PAWMOT = "sv01-076";
const PAWMOT_ALT = "sv01-209";
const FLAMIGO = "sv02-170";
const NEST_BALL = "sv01-181";
const PLAIN_BODY = "fix-basic-1";
const L_ENERGY = "fix-lightning-energy";
const L_ENERGY_ALT = "fix-lightning-energy-alt";

const ELECTROGENESIS_NOTE =
  "Search your deck for a Basic Lightning Energy card and attach it to this Pokémon.";

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

/** Every uid the seat holds anywhere, sorted (the attachFromDeck suite's
    conservation read: a deck→board move is where a duplicate would hide). */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed). */
function board(seed: number = SEED): GameState {
  const state = driveSetup(seed, { p1: SOURCE_UID_DECK, p2: SOURCE_UID_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1's board rebuilt from nothing (the attachFromDeck suite's rule: setup
    places whatever Basic it deals, and WHICH Pokémon is where is this slice's
    whole subject). Legal-shaped: every uid stays in exactly one zone. */
function withBoard(state: GameState, activeId: string, benchIds: readonly string[]): GameState {
  const side = state.players.p1;
  const returned = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, active: null, bench: [], deck: [...side.deck, ...returned] },
    },
  };
  next = setActiveFromDeck(next, "p1", activeId);
  for (const id of benchIds) next = benchFromDeck(next, "p1", id);
  return next;
}

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") throw new Error("expected an attachCards prompt");
  return state.phase.prompt;
}

function useElectrogenesis(state: GameState, spot: "active" | number) {
  return mustApply(state, {
    type: "useAbility",
    seat: "p1",
    target: spot === "active" ? { spot: "active" } : { spot: "bench", index: spot },
    abilityName: "Electrogenesis",
  });
}

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

/** Strip every copy of both Basic {L} prints out of p1's deck — the whiff. */
function withoutLightning(state: GameState): GameState {
  const side = state.players.p1;
  const gone = side.deck.filter((uid) => {
    const id = state.cardIdByUid[uid];
    return id === L_ENERGY || id === L_ENERGY_ALT;
  });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((uid) => !gone.includes(uid)),
        discard: [...side.discard, ...gone],
      },
    },
  };
}

describe("the context carries the source — the mechanism", () => {
  it("useAbility parks with the Pokémon's own uid in the continuation", () => {
    const state = withBoard(board(), PAWMOT, []);
    const pawmotUid = activeUid(state, "p1");
    const { state: parked } = useElectrogenesis(state, "active");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The WHOLE context, not just the field: `{seat, sourceUid}` and nothing
    // else is what the continuation serializes (D14).
    expect(parked.phase.cont.ctx).toEqual({ seat: "p1", sourceUid: pawmotUid });
  });

  it("a board trigger parks with the PLAYED Pokémon's uid", () => {
    let state = board();
    state = handFromDeck(state, "p1", FLAMIGO, 1);
    const uid = handUid(state, "p1", FLAMIGO);
    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.ctx).toEqual({ seat: "p1", sourceUid: uid });
  });

  it("a Trainer parks with NO source — the field is not even present", () => {
    // Not merely `undefined`: a Trainer's context must carry NO `sourceUid`, the
    // same phase-shape promise the §9.2 record keeps by being absent when empty.
    //
    // 🆕 D259 — THE CONTEXT IS NO LONGER `{seat}` ALONE, AND THE TWO AXES ARE WHY
    // THIS ASSERTION STILL SAYS SOMETHING. `sourceUid` names WHICH BODY an effect
    // belongs to; a played Trainer has none, and that is this test's subject and is
    // unchanged. `invokedBy` names WHAT KIND OF THING is doing it, and a Trainer
    // very much has one — the printed type, because Rhyperior "Wide Wall" refuses
    // Supporters and lets Items through. Asserted as the WHOLE object (not a
    // `toMatchObject`) so a third field cannot appear here unnoticed, which is the
    // property this test existed for in the first place.
    let state = board();
    state = handFromDeck(state, "p1", NEST_BALL, 1);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", NEST_BALL),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.ctx).toEqual({ seat: "p1", invokedBy: "item" });
    expect(Object.hasOwn(parked.phase.cont.ctx, "sourceUid")).toBe(false);
  });
});

describe("Pawmot's Electrogenesis — the printed 'this Pokémon'", () => {
  it("a BENCHED Pawmot's offer targets exactly Pawmot — not the Active", () => {
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const before = census(state, "p1");
    const { state: parked, events } = useElectrogenesis(state, 0);
    expect(find(events, "ABILITY_USED")?.ability).toBe("Electrogenesis");
    const prompt = promptOf(parked);
    expect(prompt.targets).toEqual([bench(0)]);
    expect(prompt.note).toBe(ELECTROGENESIS_NOTE);
    expect(prompt.max).toBe(1);

    const done = attach(parked, [{ uid: prompt.candidates[0] as string, to: bench(0) }]);
    const attached = find(done.events, "ENERGY_ATTACHED");
    expect(attached?.target).toEqual({ spot: "bench", index: 0 });
    expect(attached?.seat).toBe("p1");
    const side = done.state.players.p1;
    expect(side.bench[0]?.energy).toEqual([prompt.candidates[0]]);
    expect(side.active?.energy).toEqual([]);
    // The attach comes OUT of the deck, then the printed shuffle — in order.
    expect(side.deck).not.toContain(prompt.candidates[0]);
    const kinds = types(done.events);
    expect(kinds.indexOf("ENERGY_ATTACHED")).toBeLessThan(kinds.indexOf("SHUFFLE"));
    expect(census(done.state, "p1")).toEqual(before);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("an Active Pawmot works too — the rule is the SOURCE, not a spot", () => {
    const state = withBoard(board(), PAWMOT, [PLAIN_BODY]);
    const { state: parked } = useElectrogenesis(state, "active");
    const prompt = promptOf(parked);
    expect(prompt.targets).toEqual([ACTIVE]);
    const done = attach(parked, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(done.state.players.p1.active?.energy).toEqual([prompt.candidates[0]]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
  });

  it("collapses the deck's two Basic {L} prints to ONE offered row", () => {
    // Ten Basic {L} under two catalog ids, a pick of one: a single row. The
    // collapse keys on provision (D42), so the id boundary does not survive it.
    const state = withBoard(board(), PAWMOT, []);
    const { state: parked } = useElectrogenesis(state, "active");
    const prompt = promptOf(parked);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.max).toBe(1);
  });

  it("declining still shuffles, and the once-per-turn is spent", () => {
    const state = withBoard(board(), PAWMOT, []);
    const { state: parked } = useElectrogenesis(state, "active");
    const done = attach(parked, []);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(done.events)).toContain("SHUFFLE");
    expect(done.state.phase.kind).toBe("turn:action");
    expectErr(
      done.state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Electrogenesis" },
      "ABILITY_ALREADY_USED",
    );
  });

  it("whiffs inline with no Basic {L} in the deck — shuffle runs, stamp spent", () => {
    // No `programPlayable` gate (the op's standing doctrine): the search may be
    // failed, so the use is legal and resolves to its printed shuffle.
    const state = withoutLightning(withBoard(board(), PAWMOT, []));
    const { state: done, events } = useElectrogenesis(state, "active");
    expect(done.phase.kind).toBe("turn:action");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(events)).toContain("SHUFFLE");
    expectErr(
      done,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Electrogenesis" },
      "ABILITY_ALREADY_USED",
    );
  });

  it("rejects an attach aimed anywhere but the offered source", () => {
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const { state: parked } = useElectrogenesis(state, 0);
    const prompt = promptOf(parked);
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [{ uid: prompt.candidates[0] as string, to: ACTIVE }],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("replays identically through a JSON round trip at the park — the source survives the wire", () => {
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const { state: parked } = useElectrogenesis(state, 0);
    const prompt = promptOf(parked);
    const wire = JSON.parse(JSON.stringify(parked)) as GameState;
    if (wire.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(wire.phase.cont.ctx.sourceUid).toBeDefined();
    const direct = attach(parked, [{ uid: prompt.candidates[0] as string, to: bench(0) }]);
    const viaWire = attach(wire, [{ uid: prompt.candidates[0] as string, to: bench(0) }]);
    expect(viaWire.state).toEqual(direct.state);
    expect(viaWire.events).toEqual(direct.events);
  });
});

describe("the empty sources — toSelf with nothing to point at", () => {
  const program = programFor(PAWMOT)?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Pawmot's program is not authored");

  it("a context with NO source whiffs rather than guessing a target", () => {
    // A benched Pawmot is IN PLAY here — what is missing is only the context's
    // pointer, so an implementation that fell back to "the controller's Active"
    // or to attachEnergyTargets would attach somewhere on this board and fail
    // this test. Unreachable through actions (every Ability path sets the
    // source); reachable by authoring `toSelf` onto a Trainer, which this
    // whiff makes a loud no-op instead of a wrong attach.
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const events: GameEvent[] = [];
    const result = runProgram(state, program, { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("a source that is not a board TOP whiffs the same way", () => {
    // The uid names a real card sitting in the deck — "this Pokémon" has left
    // the board (bounced, evolved over, Knocked Out), so there is no target.
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const inDeck = state.players.p1.deck[0] as string;
    const events: GameEvent[] = [];
    const result = runProgram(state, program, { seat: "p1", sourceUid: inDeck }, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
  });
});

describe("the catalog rows", () => {
  it("registers both prints, program and meta off the printed words", () => {
    for (const id of [PAWMOT, PAWMOT_ALT]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name).toBe("Electrogenesis");
      expect(ability?.oncePerTurn).toBe(true);
      // No "in the Active Spot" clause on the card — the Bench boards above are
      // the printed behaviour, not a convenience.
      expect(ability?.activeOnly).toBe(false);
      expect(ability?.program.map((op) => op.op)).toEqual(["attachFromDeck", "shuffleDeck"]);
      expect(ability?.program[0]).toMatchObject({
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 1,
        toSelf: true,
      });
    }
  });

  it("the fixture is the print — stage, line, stats and both text surfaces", () => {
    for (const id of [PAWMOT, PAWMOT_ALT]) {
      const card = FIXTURE_POOL[id];
      expect(card).toMatchObject({
        name: "Pawmot",
        hp: 130,
        stage: "Stage2",
        evolveFrom: "Pawmo",
        types: ["Lightning"],
        retreat: 0,
        weaknesses: [{ type: "Fighting", value: "×2" }],
      });
      expect(card?.abilities).toEqual([
        {
          type: "Ability",
          name: "Electrogenesis",
          effect:
            "Once during your turn, you may search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
        },
      ]);
      expect(card?.attacks).toEqual([
        {
          cost: ["Lightning", "Lightning", "Colorless"],
          name: "Electro Paws",
          damage: 230,
          effect: "Discard all Energy from this Pokémon.",
        },
      ]);
    }
  });

  it("the opponent is untouched by the whole play", () => {
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const before = census(state, "p2");
    const { state: parked } = useElectrogenesis(state, 0);
    const prompt = promptOf(parked);
    const done = attach(parked, [{ uid: prompt.candidates[0] as string, to: bench(0) }]);
    expect(census(done.state, "p2")).toEqual(before);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: {
        kind: "attachCards",
        assignments: [{ uid: prompt.candidates[0] as string, to: bench(0) }],
      },
    });
    expect(result.ok).toBe(false);
  });
});
