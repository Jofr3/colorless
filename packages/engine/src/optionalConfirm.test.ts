import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { EffectChoice, GameEvent, GameState } from "./index";
import type { EffectOp } from "./effects";
import type { EffectContext } from "./interpreter";
import { resumeProgram, runProgram } from "./interpreter";
import { programPlayable } from "./cardplay";
import { settleProgram } from "./flow";
import { redactGame } from "./redact";
import { benchFromDeck, driveSetup, expectErr, mustApply, roundTrip } from "./testFixtures";

/** The sentence a producer will print. Held once so every assertion below reads
    the SAME string the prompt is supposed to carry verbatim — the note is the
    printed text, not a rendering of the wrapped ops. */
const SENTENCE = "You may draw cards until you have 6 cards in your hand.";

const CTX: EffectContext = { seat: "p1" };

/** A board with P1 on turn, and P1's hand emptied into their deck so every draw
    count in this file is exact rather than seed-dependent. */
function board(): GameState {
  const state = mustApply(driveSetup(20260804, undefined, { first: "p1" }), {
    type: "endTurn",
    seat: "p1",
  }).state;
  const p2 = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  const side = p2.players.p1;
  return {
    ...p2,
    players: { ...p2.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
}

const DRAW_UNTIL_6: EffectOp = { op: "drawUntilHandSize", size: 6 };
const DRAW_1: EffectOp = { op: "drawCards", count: 1 };

function wrapped(note: string, ops: EffectOp[]): EffectOp[] {
  return [{ op: "optional", note, then: ops }];
}

/** The ordering program: "you may draw until 6", then an unconditional draw. */
function orderingProgram(): EffectOp[] {
  return [...wrapped(SENTENCE, [DRAW_UNTIL_6]), DRAW_1];
}

function handSize(state: GameState): number {
  return state.players.p1.hand.length;
}

describe("the `optional` op parks a `confirm`", () => {
  it("parks with the printed sentence, no candidates and NO decider (the controller answers)", () => {
    const events: GameEvent[] = [];
    const result = runProgram(board(), orderingProgram(), CTX, events);
    if (result.kind !== "parked") throw new Error("expected the confirm park");
    // The whole prompt: a kind and the printed sentence. No `count` (the
    // mayDraw sibling's field is meaningless on a generic confirm), no
    // candidates (the decision IS the content).
    expect(result.prompt).toEqual({ kind: "confirm", note: SENTENCE });
    expect(result.decider).toBeUndefined();
    // Nothing has run yet — the wrapped op is still in `pendingOp.then`, not in
    // `rest`, and no card has moved.
    expect(handSize(result.state)).toBe(0);
    expect(events).toEqual([]);
    expect(result.cont.pendingOp).toEqual(orderingProgram()[0]);
    expect(result.cont.rest).toEqual([DRAW_1]);
  });

  it("ALWAYS parks — there is no no-choice shortcut, because the two answers differ", () => {
    const state = board();
    const full = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const events: GameEvent[] = [];
    const result = runProgram(
      full,
      [{ op: "optional", note: SENTENCE, then: [{ op: "drawUntilHandSize", size: 0 }] }],
      CTX,
      events,
    );
    expect(result.kind).toBe("parked");
  });
});

describe("the answer — accept splices, DECLINE runs nothing", () => {
  it("YES runs the wrapped ops and then the rest", () => {
    const events: GameEvent[] = [];
    const parked = runProgram(board(), orderingProgram(), CTX, events);
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const done = resumeProgram(parked.state, parked.cont, { kind: "confirm", yes: true }, events);
    if (done.kind !== "done") throw new Error("expected the program to finish");
    // Drew to 6, then the unconditional 1.
    expect(handSize(done.state)).toBe(7);
  });

  it("NO runs the wrapped ops NOT AT ALL — and still runs the rest", () => {
    const events: GameEvent[] = [];
    const parked = runProgram(board(), orderingProgram(), CTX, events);
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const done = resumeProgram(parked.state, parked.cont, { kind: "confirm", yes: false }, events);
    if (done.kind !== "done") throw new Error("expected the program to finish");
    // ONE card: the op after the gate. A decline declines the BRANCH, not the
    // sentence's remainder — the printed "you may draw … " on a card that also
    // says something else does not cancel the something else.
    expect(handSize(done.state)).toBe(1);
    // And the branch left NO trace: the only event is the unconditional draw's.
    expect(events.filter((e) => e.type === "CARDS_DRAWN")).toHaveLength(1);
  });

  it("THE SPLICE IS A PREPEND: `then` runs BEFORE `rest`, not after", () => {
    const events: GameEvent[] = [];
    const parked = runProgram(board(), orderingProgram(), CTX, events);
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const done = resumeProgram(parked.state, parked.cont, { kind: "confirm", yes: true }, events);
    if (done.kind !== "done") throw new Error("expected the program to finish");
    expect(handSize(done.state)).toBe(7);
    expect(handSize(done.state)).not.toBe(6);
  });

  it("a WRONG-SHAPED answer reaching the interpreter splices nothing", () => {
    const events: GameEvent[] = [];
    const parked = runProgram(board(), orderingProgram(), CTX, events);
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const done = resumeProgram(
      parked.state,
      parked.cont,
      { kind: "mayDraw", draw: true } as EffectChoice,
      events,
    );
    if (done.kind !== "done") throw new Error("expected the program to finish");
    expect(handSize(done.state)).toBe(1);
  });
});

describe("composition — the gate nests like the other three", () => {
  it("an op INSIDE `then` can itself park", () => {
    const events: GameEvent[] = [];
    // TWO Benched bodies, so the wrapped `switchActive` is a real choice rather
    // than parkOrForce's auto-take.
    let bench = board();
    while (bench.players.p1.bench.length < 2) {
      bench = benchFromDeck(bench, "p1", "fix-basic-1");
    }
    const parked = runProgram(
      bench,
      [{ op: "optional", note: "You may switch.", then: [{ op: "switchActive" }] }],
      CTX,
      events,
    );
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const resumed = resumeProgram(
      parked.state,
      parked.cont,
      { kind: "confirm", yes: true },
      events,
    );
    // The spliced op parks in its turn — the branch enters the same work queue
    // every gate's branch enters, so parking through it needs no new machinery.
    if (resumed.kind !== "parked") throw new Error("expected the switch park");
    expect(resumed.prompt.kind).toBe("choosePokemon");
  });

  it("an `optional` INSIDE a coinFlipGate's branch parks only on the winning face", () => {
    // Gate inside gate: the coin splices `then` into the queue, and the optional
    // parks from there. Both faces are exercised by running the same program on
    // two rng states and asserting the two outcomes are the pair (parked, done).
    const kinds = new Set<string>();
    for (const rngState of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const events: GameEvent[] = [];
      const result = runProgram(
        { ...board(), rngState },
        [
          {
            op: "coinFlipGate",
            then: [{ op: "optional", note: SENTENCE, then: [DRAW_UNTIL_6] }],
          },
        ],
        CTX,
        events,
      );
      kinds.add(result.kind);
    }
    expect([...kinds].sort()).toEqual(["done", "parked"]);
  });

  it("programPlayable does NOT descend into `then` — declining is a printed outcome", () => {
    const state = board();
    const bare: EffectOp[] = [{ op: "gust" }];
    const emptyBench: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    expect(programPlayable(emptyBench, bare, "p1")).toBe(false);
    expect(programPlayable(emptyBench, wrapped("You may.", bare), "p1")).toBe(true);
  });
});

describe("what this op deliberately does NOT touch", () => {
  it("withConsequence leaves the note alone — `optional` files nothing under a slot", () => {
    const events: GameEvent[] = [];
    const result = runProgram(
      board(),
      [
        { op: "optional", note: SENTENCE, then: [DRAW_UNTIL_6] },
        { op: "recordGate", slot: "moved", then: [DRAW_1] },
      ],
      CTX,
      events,
    );
    if (result.kind !== "parked") throw new Error("expected the confirm park");
    expect(result.prompt.note).toBe(SENTENCE);
  });

  it("the §9.2 record survives the confirm park and the gate behind it still reads it", () => {
    const events: GameEvent[] = [];
    const result = runProgram(
      board(),
      [
        { op: "optional", note: SENTENCE, then: [DRAW_UNTIL_6] },
        { op: "recordGate", slot: "moved", then: [DRAW_1] },
      ],
      CTX,
      events,
      { moved: ["seeded-uid"] },
    );
    if (result.kind !== "parked") throw new Error("expected the confirm park");
    expect(result.cont.record).toEqual({ moved: ["seeded-uid"] });
    const done = resumeProgram(result.state, result.cont, { kind: "confirm", yes: false }, events);
    if (done.kind !== "done") throw new Error("expected the program to finish");
    // Declined the "may", but the gate behind it still fired off the seeded
    // record: the decline is scoped to its own branch and nothing else.
    expect(handSize(done.state)).toBe(1);
  });
});

/** The parked ApplyResult a real action would produce — settleProgram builds the
    phase, so this drives the same code path a Trainer/attack park would. */
function parkedState(): GameState {
  const events: GameEvent[] = [];
  const result = runProgram(board(), orderingProgram(), CTX, events);
  const settled = settleProgram(result, "p1", events);
  if (!settled.ok) throw new Error("expected the park to settle");
  return settled.state;
}

describe("the phase, the wire check and the seat gate", () => {
  it("settles into an effect:choose with NO answerer — the controller owns it", () => {
    const events: GameEvent[] = [];
    const result = runProgram(board(), orderingProgram(), CTX, events);
    const settled = settleProgram(result, "p1", events);
    if (!settled.ok) throw new Error("expected the park to settle");
    if (settled.state.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(settled.state.phase.seat).toBe("p1");
    expect(settled.state.phase.answerer).toBeUndefined();
    expect(settled.events.some((e) => e.type === "EFFECT_PENDING" && e.seat === "p1")).toBe(true);
  });

  it("accepts a real boolean and REFUSES every truthy impostor", () => {
    const parked = parkedState();
    // The P4 wire rule: a client's "yes" / 1 / null is not consent to run an op
    // branch. Same check as mayDraw's, and the stake is higher — consent here
    // runs a whole program branch rather than moving a known number of cards.
    for (const yes of ["yes", 1, 0, null, undefined, {}] as const) {
      expectErr(
        parked,
        {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "confirm", yes } as unknown as { kind: "confirm"; yes: boolean },
        },
        "BAD_EFFECT_CHOICE",
      );
    }
    // The wrong choice kind entirely, including the OTHER yes/no.
    for (const choice of [
      { kind: "mayDraw", draw: true },
      { kind: "cards", uids: [] },
      { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } } },
    ] as EffectChoice[]) {
      expectErr(parked, { type: "resolveEffect", seat: "p1", choice }, "BAD_EFFECT_CHOICE");
    }
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(done.players.p1.hand).toHaveLength(7);
  });

  it("the OPPONENT cannot answer the controller's printed 'you may'", () => {
    expectErr(
      parkedState(),
      { type: "resolveEffect", seat: "p2", choice: { kind: "confirm", yes: true } },
      "WRONG_SEAT",
    );
  });

  it("a DECLINE through the real action leaves the board alone and folds the turn back", () => {
    const { state: done } = mustApply(parkedState(), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.players.p1.hand).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("survives a JSON round-trip — the park is plain data (D14), so v12 records stay readable", () => {
    const thawed = roundTrip(parkedState());
    if (thawed.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(thawed.phase.prompt).toEqual({ kind: "confirm", note: SENTENCE });
    const { state: done } = mustApply(thawed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(done.players.p1.hand).toHaveLength(7);
  });
});

describe("the wire", () => {
  it("redacts to the sentence alone, and reaches the ANSWERER only", () => {
    const parked = parkedState();
    expect(redactGame(parked, "p1").phase).toMatchObject({
      kind: "effect:choose",
      prompt: { kind: "confirm", note: SENTENCE },
    });
    const theirs = redactGame(parked, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });
});

describe("RE-POINTED at D202 — the pins that were written to go red, and did", () => {
  const ANCHORS = [
    {
      text: "You may draw cards until you have 6 cards in your hand.",
      inner: "Draw cards until you have 6 cards in your hand.",
      legalPrintings: 10,
    },
    { text: "You may draw 5 cards.", inner: "Draw 5 cards.", legalPrintings: 2 },
  ] as const;

  for (const { text, inner } of ANCHORS) {
    it(`derives ${JSON.stringify(text)} — through the OPTIONAL wrapper, not bare`, () => {
      const derived = deriveAttackEffect(text);
      // The wrapper, not the inner op: exactly one op, and it is the gate.
      expect(derived).toHaveLength(1);
      const op = derived?.[0];
      expect(op?.op).toBe("optional");
      // The note is the printed sentence VERBATIM — the whole string the regex
      // consumed, not a rebuild of it, because both HUDs render it as the
      // dialog's only prose.
      expect(op?.op === "optional" ? op.note : undefined).toBe(text);
      expect(op?.op === "optional" ? op.then : undefined).toEqual(deriveAttackEffect(inner));
    });
  }

  it("the BARE forms still derive UNWRAPPED — the wrapper reaches neither", () => {
    expect(deriveAttackEffect("Draw cards until you have 6 cards in your hand.")).toEqual([
      { op: "drawUntilHandSize", size: 6 },
    ]);
    expect(deriveAttackEffect("Draw 5 cards.")).toEqual([{ op: "drawCards", count: 5 }]);
  });

  it("the engine STILL produces no `optional` op where no card prints one", () => {
    const state = board();
    const result = applyAction(state, { type: "endTurn", seat: "p1" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state).includes('"optional"')).toBe(false);
  });
});
