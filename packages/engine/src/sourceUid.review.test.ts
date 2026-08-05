import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectPrompt, PokemonRef } from "./interpreter";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  SOURCE_UID_DECK,
  activeUid,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice `EffectContext.sourceUid` — the ADVERSARIAL companion to
// sourceUid.test.ts. That file pins the headline (a benched Pawmot feeds
// ITSELF); this one pins the resolutions a wrong `sourceRef` would get right on
// every board that file builds:
//
//   • "this Pokémon" is the board TOP, not stack membership — a source EVOLVED
//     OVER is a different Pokémon, and a lookup that scanned whole stacks (or
//     matched the stack's BASE card) passes every un-evolved board;
//   • the ref carries the source's REAL bench index — every board in the main
//     suite benches Pawmot at index 0, where `index` and a hard-coded 0 agree;
//   • the offer's one row is honest about WHICH prints back it — both Basic {L}
//     ids must actually sit in the deck for "the collapse crosses ids" to be a
//     tested claim rather than a comment;
//   • the degenerate decks (empty, all-{L}) whiff/settle without touching D14.

const SEED = 20260722;

const PAWMOT = "sv01-076";
const PLAIN_BODY = "fix-basic-1";
const L_ENERGY = "fix-lightning-energy";
const L_ENERGY_ALT = "fix-lightning-energy-alt";

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

const ELECTROGENESIS = programFor(PAWMOT)?.abilities?.[0]?.program;
if (ELECTROGENESIS === undefined) throw new Error("Pawmot's program is not authored");

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every uid the seat holds anywhere, sorted (the conservation read). */
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

/** P1's board rebuilt from nothing (sourceUid.test.ts's `withBoard`, verbatim):
    legal-shaped — every uid stays in exactly one zone. */
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

/** The deck's uids of a given catalog id. */
function deckUids(state: GameState, cardId: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === cardId);
}

describe("'this Pokémon' is the board TOP, not the stack", () => {
  it("a source EVOLVED OVER whiffs — the buried uid is a different Pokémon now", () => {
    // Surgery: push a deck card on top of the benched Pawmot's stack, so the
    // Pawmot uid is still IN PLAY (stack membership) but no longer the TOP. A
    // sourceRef that scanned whole stacks — or matched the stack's BASE card —
    // still finds it and attaches; the top-uid rule whiffs into the shuffle.
    // Unreachable through actions today (nothing evolves from Pawmot, and the
    // park admits only resolveEffect), so driven through runProgram like the
    // main suite's empty-source pair.
    const base = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const pawmotUid = benchTopUid(base, "p1", 0);
    const side = base.players.p1;
    const cover = side.deck[0] as string;
    const pawmot = side.bench[0];
    if (pawmot === undefined) throw new Error("expected Pawmot on the bench");
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...side,
          deck: side.deck.slice(1),
          bench: [{ ...pawmot, stack: [...pawmot.stack, cover] }],
        },
      },
    };
    const before = census(state, "p1");
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), ELECTROGENESIS, { seat: "p1", sourceUid: pawmotUid }, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(events)).toContain("SHUFFLE");
    if (result.kind !== "done") throw new Error("expected done");
    expect(census(result.state, "p1")).toEqual(before);
  });
});

describe("'this Pokémon' is the board TOP — the ACTIVE arm", () => {
  it("an ACTIVE whose stack merely CONTAINS the source whiffs too", () => {
    // The bench test above leaves the Active arm untested: a lookup that
    // matched the ACTIVE by stack membership passes every board there. Same
    // surgery, Active spot — Pawmot evolved over while in the Active.
    const base = withBoard(board(), PAWMOT, []);
    const pawmotUid = activeUid(base, "p1");
    const side = base.players.p1;
    const cover = side.deck[0] as string;
    const active = side.active;
    if (active === null) throw new Error("expected an Active");
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...side,
          deck: side.deck.slice(1),
          active: { ...active, stack: [...active.stack, cover] },
        },
      },
    };
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), ELECTROGENESIS, { seat: "p1", sourceUid: pawmotUid }, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(events)).toContain("SHUFFLE");
  });
});

describe("the source ref carries the REAL bench index", () => {
  it("Pawmot at bench 1 is offered as bench 1 — and slot 0 is not a legal landing", () => {
    // Every board in the main suite benches Pawmot at index 0, where the true
    // index and a hard-coded 0 agree. This one puts a plain body in front.
    const state = withBoard(board(), PLAIN_BODY, [PLAIN_BODY, PAWMOT]);
    const { state: parked } = useElectrogenesis(state, 1);
    const prompt = promptOf(parked);
    expect(prompt.targets).toEqual([bench(1)]);
    const card = prompt.candidates[0] as string;
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [{ uid: card, to: bench(0) }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    const done = attach(parked, [{ uid: card, to: bench(1) }]);
    const p1 = done.state.players.p1;
    expect(p1.bench[1]?.energy).toEqual([card]);
    expect(p1.bench[0]?.energy).toEqual([]);
    expect(p1.active?.energy).toEqual([]);
  });

  it("TWO Pawmots: the SECOND one's use targets the second, and the first still has its turn", () => {
    // A lookup that matched by catalog ID instead of uid returns the FIRST
    // Pawmot on every one-Pawmot board — this is the board that tells them
    // apart. And §9's once-per-turn is per POKÉMON (usedKey is uid-scoped):
    // spending B's use leaves A's intact.
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT, PAWMOT]);
    const { state: parked } = useElectrogenesis(state, 1);
    const prompt = promptOf(parked);
    expect(prompt.targets).toEqual([bench(1)]);
    const done = attach(parked, [{ uid: prompt.candidates[0] as string, to: bench(1) }]);
    const p1 = done.state.players.p1;
    expect(p1.bench[1]?.energy).toHaveLength(1);
    expect(p1.bench[0]?.energy).toEqual([]);
    const { state: again } = useElectrogenesis(done.state, 0);
    expect(promptOf(again).targets).toEqual([bench(0)]);
  });
});

describe("the offer — what actually backs its one row", () => {
  it("BOTH Basic {L} prints sit in the deck when the collapse offers one row", () => {
    // The main suite's collapse test asserts one row over "ten Basic {L} under
    // two catalog ids" — a claim about the DECK it never checks. Pin it: with
    // this seed both prints are really there, so one row IS a cross-id collapse.
    const state = withBoard(board(), PAWMOT, []);
    expect(deckUids(state, L_ENERGY).length).toBeGreaterThan(0);
    expect(deckUids(state, L_ENERGY_ALT).length).toBeGreaterThan(0);
    const { state: parked } = useElectrogenesis(state, "active");
    expect(promptOf(parked).candidates).toHaveLength(1);
  });

  it("rejects a deck {L} the collapse did NOT offer, mutating nothing", () => {
    // The candidate set — not the filter — is the authority: a second copy of
    // the same print matches `basicEnergy`+Lightning and still is not offered.
    const state = withBoard(board(), PAWMOT, []);
    const { state: parked } = useElectrogenesis(state, "active");
    const prompt = promptOf(parked);
    const offered = prompt.candidates[0] as string;
    const unoffered = [...deckUids(parked, L_ENERGY), ...deckUids(parked, L_ENERGY_ALT)].find(
      (uid) => uid !== offered,
    );
    if (unoffered === undefined) throw new Error("expected a second {L} in the deck");
    expectErr(
      deepFreeze(parked),
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [{ uid: unoffered, to: ACTIVE }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects two assignments over the printed ONE, and a wrong-kind answer", () => {
    const state = withBoard(board(), PAWMOT, []);
    const { state: parked } = useElectrogenesis(state, "active");
    const card = promptOf(parked).candidates[0] as string;
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: card, to: ACTIVE },
            { uid: card, to: ACTIVE },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [card] } },
      "BAD_EFFECT_CHOICE",
    );
  });
});

describe("the plural toSelf note — the branch no shipped card reaches", () => {
  it("a max above one says 'up to N … cards … them', still to this Pokémon", () => {
    // `toSelf` ships only at max 1 (Pawmot), so the plural wording is reachable
    // only from here — the attachFromDeck suite's own pattern for unshipped
    // note branches.
    const state = withBoard(board(), PAWMOT, []);
    const program: EffectOp[] = [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ];
    const result = runProgram(state, program, { seat: "p1", sourceUid: activeUid(state, "p1") }, []);
    if (result.kind !== "parked") throw new Error("expected a park");
    expect(result.prompt.note).toBe(
      "Search your deck for up to 2 Basic Lightning Energy cards and attach them to this Pokémon.",
    );
  });
});

describe("degenerate decks — D14 holds at both edges", () => {
  it("an EMPTY deck: the use is legal, whiffs into the printed shuffle, spends the stamp", () => {
    const base = withBoard(board(), PAWMOT, []);
    const side = base.players.p1;
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...side, deck: [], discard: [...side.discard, ...side.deck] },
      },
    };
    const before = census(state, "p1");
    const { state: done, events } = useElectrogenesis(deepFreeze(state), "active");
    expect(done.phase.kind).toBe("turn:action");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(types(events)).toContain("SHUFFLE");
    expect(census(done, "p1")).toEqual(before);
    expectErr(
      done,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Electrogenesis" },
      "ABILITY_ALREADY_USED",
    );
  });

  it("a deck of ONLY {L}: still one row, max 1, and every card conserved", () => {
    const base = withBoard(board(), PAWMOT, []);
    const side = base.players.p1;
    const isL = (uid: string) =>
      side.deck.includes(uid) &&
      (base.cardIdByUid[uid] === L_ENERGY || base.cardIdByUid[uid] === L_ENERGY_ALT);
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...side,
          deck: side.deck.filter(isL),
          discard: [...side.discard, ...side.deck.filter((uid) => !isL(uid))],
        },
      },
    };
    const before = census(state, "p1");
    const { state: parked } = useElectrogenesis(deepFreeze(state), "active");
    const prompt = promptOf(parked);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.max).toBe(1);
    const done = attach(deepFreeze(parked), [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(done.state.players.p1.active?.energy).toEqual([prompt.candidates[0]]);
    expect(census(done.state, "p1")).toEqual(before);
  });

  it("the revived park resolves the DECLINE identically too", () => {
    // sourceUid.test.ts round-trips the attach; the decline shares the resume
    // path but exercises the empty-assignments arm on the revived object.
    const state = withBoard(board(), PLAIN_BODY, [PAWMOT]);
    const { state: parked } = useElectrogenesis(state, 0);
    const wire = JSON.parse(JSON.stringify(parked)) as GameState;
    const direct = attach(parked, []);
    const viaWire = attach(wire, []);
    expect(viaWire.state).toEqual(direct.state);
    expect(viaWire.events).toEqual(direct.events);
    expect(types(direct.events)).toContain("SHUFFLE");
  });
});
