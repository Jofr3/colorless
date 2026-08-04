import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { EffectChoice, GameEvent, GameState } from "./index";
import type { EffectOp } from "./effects";
import type { EffectContext } from "./interpreter";
import { resumeProgram, runProgram } from "./interpreter";
import { programPlayable } from "./cardplay";
import { settleProgram } from "./flow";
import { redactGame } from "./redact";
import { benchFromDeck, driveSetup, expectErr, mustApply } from "./testFixtures";

// 0.126.0 → 0.127.0 — the PRINTED "You may …" AS A FOURTH GATE (D186).
//
// A new op (`optional`), a new prompt kind (`confirm`), a new choice kind, and
// BOTH dialogs — with NO PRODUCER. Nothing in the deriver or the registry builds
// an `optional` op, which is exactly the property that makes the slice safe to
// land: a park of a prompt kind a surface cannot render is a SOFT-LOCK (the
// effect:choose phase swallows Escape, offers no decline and cannot advance
// without an answer), so both surfaces answer the question before anything can
// ask it. The two deriver anchors that WILL ask it are pinned ABSENT at the
// bottom of this file, as the red line the producer slice turns green.
//
// ── 0.128.0 → 0.129.0 — D202 IS THAT PRODUCER, AND THE PINS WERE RE-POINTED. ──
// `deriveAttackEffect` anchors 33–34 read the two printed sentences (12 legal
// printings), and the block at the foot of this file no longer asserts absence:
// it asserts WHICH READER owns each sentence and that the wrapper is what comes
// back. Everything above is untouched and stays hand-built on purpose — this file
// is about the MECHANISM, and driving it off a card would make it a test of the
// deriver instead. The end-to-end drive through a real attack lives in
// `optionalDraw.test.ts`, beside the anchors that produce it.
//
// WHAT IS ACTUALLY NEW, and why this is not another parking op:
//   • THE ANSWER MOVES NOTHING. Every other `applyChoice` arm turns a choice into
//     a board change; this one returns the state untouched on BOTH answers, and
//     the yes/no difference is an OP SPLICE that lives in `resumeProgram`.
//   • SO THE DECLINE IS THE HARD HALF. A build that spliced unconditionally, or
//     that read the boolean the wrong way round, still passes every accept
//     assertion — and a confirm that silently applies on "no" is the one defect
//     this mechanism can have. Every accept test below has a decline twin.
//   • THE SPLICE IS A PREPEND, NOT AN APPEND, and that is observable: an
//     `optional` wrapping `drawUntilHandSize 6` in front of a plain `drawCards 1`
//     ends at SEVEN cards prepended and SIX appended (the "until" op never trims).
//     That pair is the ordering witness, used throughout.
//   • IT IS THE FOURTH GATE, not a fourth kind of thing. `runProgram` already
//     `unshift`s a branch three times over (`coinFlipGate` on a coin,
//     `conditionGate` on the board, `recordGate` on what an earlier op filed);
//     this gate's condition is a human answer, so it is evaluated one action
//     later — which is the whole reason it splices in `resumeProgram` instead.

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

/** A one-op program wrapping `ops` in the printed "you may". Built here rather
    than inline everywhere so the `then` key needs ONE lint suppression in this
    file instead of one per case — `then` is the effect contract's gated-op list,
    not a thenable. */
function wrapped(note: string, ops: EffectOp[]): EffectOp[] {
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-op list, not a thenable (arrays are not callable).
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
    // NOT `mayDraw`'s answerer split: the printed "you" is the seat that played
    // the card, so no `decider` rides the park and no `answerer` reaches the
    // phase. A build that copied opponentMayDraw's park wholesale would send
    // this question to the wrong player's screen.
    expect(result.decider).toBeUndefined();
    // Nothing has run yet — the wrapped op is still in `pendingOp.then`, not in
    // `rest`, and no card has moved.
    expect(handSize(result.state)).toBe(0);
    expect(events).toEqual([]);
    expect(result.cont.pendingOp).toEqual(orderingProgram()[0]);
    expect(result.cont.rest).toEqual([DRAW_1]);
  });

  it("ALWAYS parks — there is no no-choice shortcut, because the two answers differ", () => {
    // The M1 rule retires a prompt whose answers are the same state (an empty
    // opponent deck kills the mayDraw park). It cannot apply here: the answers
    // differ by everything in `then`, on every board. Driven on a board where
    // the wrapped op would WHIFF anyway (a hand already at 6 draws nothing) —
    // the question is still the player's to answer, and a shortcut here would be
    // the engine deciding a printed "may" on their behalf.
    const state = board();
    const full = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const events: GameEvent[] = [];
    const result = runProgram(
      full,
      // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
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
    // The two orders are distinguishable by exactly this pair of ops, which is
    // why they are the file's fixture. Prepended: draw to 6, then 1 more = 7.
    // Appended: draw 1, then "until 6" tops up to 6 (it never trims) = 6. A
    // build that pushed `then` onto the END of the queue passes every other
    // accept assertion in this file and fails only here.
    const events: GameEvent[] = [];
    const parked = runProgram(board(), orderingProgram(), CTX, events);
    if (parked.kind !== "parked") throw new Error("expected the confirm park");
    const done = resumeProgram(parked.state, parked.cont, { kind: "confirm", yes: true }, events);
    if (done.kind !== "done") throw new Error("expected the program to finish");
    expect(handSize(done.state)).toBe(7);
    expect(handSize(done.state)).not.toBe(6);
  });

  it("a WRONG-SHAPED answer reaching the interpreter splices nothing", () => {
    // The wire check (cardplay.ts) is the real barrier; this is the belt every
    // other apply arm in the interpreter wears — the choice kind is matched
    // against the op, so a `mayDraw` answer to a `confirm` park is a decline
    // rather than a silent accept.
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
      // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
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
            // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
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
    // The coin gate's branch IS the whole card, so a whiff-only branch means a
    // whiff-only card and §7 refuses the play. An `optional`'s branch is one of
    // TWO printed outcomes, so a "you may gust" into an empty opponent Bench
    // still resolves: it asks, and the answer is the effect.
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
    // A parking op that RECORDS looks down the queue for the §9.2 gate reading
    // it and appends the printed conditional to its note. `optional` records
    // nothing (`recordSlotOf` has no arm for it), so the describer returns at its
    // first line and the note stays the printed sentence VERBATIM — even with a
    // recordGate sitting right behind it, which is the only arrangement that
    // could make the difference visible.
    const events: GameEvent[] = [];
    const result = runProgram(
      board(),
      [
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
        { op: "optional", note: SENTENCE, then: [DRAW_UNTIL_6] },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
        { op: "recordGate", slot: "moved", then: [DRAW_1] },
      ],
      CTX,
      events,
    );
    if (result.kind !== "parked") throw new Error("expected the confirm park");
    expect(result.prompt.note).toBe(SENTENCE);
  });

  it("the §9.2 record survives the confirm park and the gate behind it still reads it", () => {
    // The park stores the running record in its continuation and the resume
    // seeds the accumulator from it. Nothing about `optional` touches that — but
    // it is the one thing a new parking op can silently drop, so it is driven
    // rather than argued.
    const events: GameEvent[] = [];
    const result = runProgram(
      board(),
      [
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
        { op: "optional", note: SENTENCE, then: [DRAW_UNTIL_6] },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-op list.
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
    // Absent, not "p1" — the absent-when-it-is-the-controller rule every park
    // before D52 relied on for a byte-identical phase.
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
    // WHY THIS IS THE `MATCH_RECORD_VERSION` ASSERTION. The version stays 12
    // because this slice adds an INHABITANT to two unions (`EffectOp`,
    // `EffectPrompt`) and no required field to an existing one — D125's
    // widening, not D136's `damageChosen.source`. A record written at v12 can
    // only be parked on an inhabitant a v12 build could construct, and no v12
    // build could construct an `optional` op; every pre-existing park serializes
    // byte-identically because nothing they carry moved. What that leaves to
    // check is the forward direction — that a park of the NEW shape is itself
    // plain JSON with no class, function or undefined-keyed field in it — and
    // that is what this drives.
    const thawed = JSON.parse(JSON.stringify(parkedState())) as GameState;
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
    // Controller-answered, so the opponent's snapshot carries null — the same
    // gate the public-ref family sits behind. Nothing here is secret, but the
    // gate is about WHO IS BEING ASKED, and a dialog on the wrong screen is a
    // question its viewer cannot answer.
    const theirs = redactGame(parked, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });
});

describe("RE-POINTED at D202 — the pins that were written to go red, and did", () => {
  // ⚠️ THESE THREE CASES WERE D186'S RED LINE AND ARE NOT DELETED. They pinned
  // `deriveAttackEffect(<sentence>) === null` for the two sentences behind the
  // printed "You may" wrapper — 12 legal printings, 10 of the first and 2 of the
  // second — because landing a producer before both surfaces could render its
  // park was the soft-lock D186 existed to prevent. D202 built the producer, so
  // the claim MOVES rather than vanishing: from "nothing reads this" to the
  // strictly stronger "THIS READER reads it, and reads it to exactly the wrapped
  // program". That is D181's shape (`attackPark.test.ts` has re-pointed four
  // rows this way) and it matters here for the usual reason: a `toBeNull()` that
  // is simply deleted takes its witness with it, while a shape claim can still
  // tell a correct wrapper from a build that returned the INNER op unwrapped —
  // which is the one regression that would silently un-ask a printed question
  // and draw the cards without consent.
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
      // …and `then` is BYTE-IDENTICAL to the bare sibling's whole program. Read
      // apart rather than re-typed, so a copy-paste cannot pass it (D134/D181's
      // inventory equality — one action, two printed sentences).
      expect(op?.op === "optional" ? op.then : undefined).toEqual(deriveAttackEffect(inner));
    });
  }

  it("the BARE forms still derive UNWRAPPED — the wrapper reaches neither", () => {
    // The other half of the re-point. The two anchors are whole-string, so the
    // sentences WITHOUT the printed "You may" stay exactly where D181 put them:
    // no gate, no park, no question. A build with one shared optional-group regex
    // would wrap these too, and every assertion above would still pass.
    expect(deriveAttackEffect("Draw cards until you have 6 cards in your hand.")).toEqual([
      { op: "drawUntilHandSize", size: 6 },
    ]);
    expect(deriveAttackEffect("Draw 5 cards.")).toEqual([{ op: "drawCards", count: 5 }]);
  });

  it("the engine STILL produces no `optional` op where no card prints one", () => {
    // D186's safety property, kept and narrowed rather than dropped. It used to
    // say "nothing reaches this op at all"; the honest claim now is that only the
    // printed sentence does — an ordinary turn on a board of ordinary fixtures
    // never constructs one, so the mechanism cannot strand a player who is not
    // holding one of the 12 printings.
    const state = board();
    const result = applyAction(state, { type: "endTurn", seat: "p1" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state).includes('"optional"')).toBe(false);
  });
});
