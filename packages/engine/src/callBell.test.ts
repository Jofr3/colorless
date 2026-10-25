import { describe, expect, it } from "vitest";
import type { BoardCondition } from "./effects";
import { cardOfUid } from "./cards";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  deckOf,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  walkProgram,
  programmedCardIds,
} from "./testFixtures";

const CALL_BELL_ID = "sv08-165";

const CALL_BELL_TEXT =
  "You can use this card only if you go second, and only during your first turn.\n\nSearch your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.";

/** The two printed conjuncts, as the registry authors them. */
const CALL_BELL_GATE: BoardCondition = {
  kind: "allOf",
  conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
};

const CALL_BELL_DECK = deckOf({
  "fix-callbell": 4,
  "sv01-172": 4, // Energy Search — the ungated Item, the CONTROL
  "sv01-180": 4, // Nemona — the Supporter the search is printed to find
  "fix-bigbody": 20,
  "fix-energy": 28,
});

const decks = { p1: CALL_BELL_DECK, p2: CALL_BELL_DECK };

/** Setup with `first` going first. Turn 1 is `first`'s own first turn. */
function turnOne(seed: number, first: Seat): GameState {
  return driveSetup(seed, decks, { first });
}

/** Walk the clock `n` turns from `state`, passing each time — fanCall.test.ts's
    `passTurns` idiom, because every claim this suite makes is per-SEAT and
    per-TURN and a one-turn board is vacuous on both. */
function passTurns(state: GameState, n: number): GameState {
  let next = state;
  for (let i = 0; i < n; i++) {
    const seat = next.turn % 2 === 1 ? next.firstPlayer : otherOf(next.firstPlayer);
    if (seat === null) throw new Error("no first player");
    next = mustApply(next, { type: "endTurn", seat }).state;
  }
  return next;
}

function otherOf(seat: Seat | null): Seat | null {
  return seat === null ? null : seat === "p1" ? "p2" : "p1";
}

function play(state: GameState, seat: Seat, uid: string) {
  return applyAction(state, { type: "playTrainer", seat, uid });
}

function wireRow(state: GameState, seat: Seat, cardId: string) {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.name === cardId);
}

describe("D280 — the registry row", () => {
  it("maps the ONE Standard-legal printing, plus the demonstrator, to ONE object", () => {
    const program = programFor(CALL_BELL_ID);
    expect(program, `${CALL_BELL_ID} has no program`).toBeDefined();
    expect(programFor("fix-callbell"), "the demonstrator is not Call Bell").toBe(program);
    const chill = programFor("sv08-166");
    expect(chill, "Chill Teaser Toy is BUILT at D295").toBeDefined();
    expect(chill, "…and it is NOT aliased to Call Bell").not.toBe(program);
    expect(chill?.trainer, "…its body is its own").not.toEqual(program?.trainer);
    expect(chill?.trainerPlayableIf).toEqual(program?.trainerPlayableIf);
  });

  it("authors BOTH printed sentences — the allOf gate and the search-then-shuffle", () => {
    const program = programFor(CALL_BELL_ID);
    expect(program?.trainerPlayableIf).toEqual(CALL_BELL_GATE);
    expect(program?.trainer).toEqual([
      { op: "searchDeck", filter: { kind: "supporter" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    expect(Object.keys(program ?? {}).sort()).toEqual(["trainer", "trainerPlayableIf"]);
  });

  it("carries the printed BYTES on the demonstrator, so the gate is checkable in-file", () => {
    expect(FIXTURE_POOL["fix-callbell"]?.effect).toBe(CALL_BELL_TEXT);
    expect(FIXTURE_POOL["fix-callbell"]?.trainerType).toBe("Item");
  });

  it("gives the allOf gate to the card that PRINTS it, and to nothing else", () => {
    // The population that may carry the combinator is the population that prints
    // a conjunction. Fighting Au Lait is the CONTROL: the other `trainerPlayableIf`
    // card, whose gate is a single bare member and must stay one.
    const gated = ["sv08-165", "fix-callbell"];
    for (const id of gated) {
      expect(programFor(id)?.trainerPlayableIf?.kind, id).toBe("allOf");
    }
    expect(programFor("sv02-181")?.trainerPlayableIf).toEqual({ kind: "morePrizesThanOpponent" });
    expect(
      programFor("sv01-172")?.trainerPlayableIf,
      "Energy Search prints no gate",
    ).toBeUndefined();
  });
});

describe("D280 — `youGoSecond` is a SEAT ASSIGNMENT, not a turn", () => {
  const COND: BoardCondition = { kind: "youGoSecond" };

  for (const first of ["p1", "p2"] as const) {
    it(`answers per SEAT and never per turn — ${first} goes first`, () => {
      let state = turnOne(7, first);
      const second = otherOf(first) as Seat;
      for (let turn = 1; turn <= 6; turn++) {
        expect(state.turn, "the clock walked").toBe(turn);
        // The going-SECOND seat: true on every single turn, first to last.
        expect(conditionHolds(state, second, COND), `${second}@${turn}`).toBe(true);
        // The going-FIRST seat: false on every single turn.
        expect(conditionHolds(state, first, COND), `${first}@${turn}`).toBe(false);
        state = passTurns(state, 1);
      }
    });
  }

  it("is FALSE for both seats before the flip is resolved — `firstPlayer` is null", () => {
    const preFlip = { ...turnOne(7, "p1"), firstPlayer: null } as GameState;
    expect(conditionHolds(preFlip, "p1", COND)).toBe(false);
    expect(conditionHolds(preFlip, "p2", COND)).toBe(false);
  });

  it("is NOT `yourFirstTurn`, and the two DISAGREE on half of 12 sampled boards", () => {
    // The measurement behind the doc block's claim, made rather than asserted.
    let state = turnOne(3, "p1");
    let agree = 0;
    let total = 0;
    for (let turn = 1; turn <= 6; turn++) {
      for (const seat of ["p1", "p2"] as const) {
        total++;
        const a = conditionHolds(state, seat, COND);
        const b = conditionHolds(state, seat, { kind: "yourFirstTurn" });
        if (a === b) agree++;
      }
      state = passTurns(state, 1);
    }
    expect(total).toBe(12);
    expect(agree).toBe(6);
  });
});

describe("D280 — `allOf` folds with EVERY, and both conjuncts are load-bearing", () => {
  it("is TRUE only on the going-second seat's own first turn — turn 2", () => {
    let state = turnOne(11, "p1");
    const results: string[] = [];
    for (let turn = 1; turn <= 5; turn++) {
      for (const seat of ["p1", "p2"] as const) {
        if (conditionHolds(state, seat, CALL_BELL_GATE)) results.push(`${seat}@${turn}`);
      }
      state = passTurns(state, 1);
    }
    expect(results).toEqual(["p2@2"]);
  });

  it("goes FALSE when EITHER conjunct alone would go true — the .some / dropped-conjunct catch", () => {
    const a = turnOne(11, "p1");
    expect(conditionHolds(a, "p1", { kind: "yourFirstTurn" })).toBe(true);
    expect(conditionHolds(a, "p1", { kind: "youGoSecond" })).toBe(false);
    expect(conditionHolds(a, "p1", CALL_BELL_GATE)).toBe(false);

    const b = passTurns(turnOne(11, "p1"), 3);
    expect(b.turn).toBe(4);
    expect(conditionHolds(b, "p2", { kind: "youGoSecond" })).toBe(true);
    expect(conditionHolds(b, "p2", { kind: "yourFirstTurn" })).toBe(false);
    expect(conditionHolds(b, "p2", CALL_BELL_GATE)).toBe(false);
  });

  it("folds an arity-3 conjunction, and one false member is enough to refuse it", () => {
    const state = passTurns(turnOne(11, "p2"), 1); // turn 2 — p1 goes second
    const three: BoardCondition = {
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }, { kind: "handSizesEqual" }],
    };
    const handsEqual = conditionHolds(state, "p1", { kind: "handSizesEqual" });
    expect(conditionHolds(state, "p1", three)).toBe(handsEqual);
    // …and with a member that is definitely false on this board, the whole thing is.
    expect(
      conditionHolds(state, "p1", {
        kind: "allOf",
        conditions: [
          { kind: "youGoSecond" },
          { kind: "yourFirstTurn" },
          { kind: "yourBenchDamaged" },
        ],
      }),
    ).toBe(false);
  });

  it("NESTS, because the type allows it and no reader flattens", () => {
    const state = passTurns(turnOne(11, "p2"), 1); // turn 2 — p1 goes second
    const nested: BoardCondition = {
      kind: "allOf",
      conditions: [
        { kind: "youGoSecond" },
        { kind: "allOf", conditions: [{ kind: "yourFirstTurn" }, { kind: "youGoSecond" }] },
      ],
    };
    expect(conditionHolds(state, "p1", nested)).toBe(true);
    expect(conditionHolds(state, "p2", nested)).toBe(false);
  });
});

describe("D280 — `conditionNote` joins the fragments, and the JOINED string is the assertion", () => {
  it("round-trips the leaf verbatim", () => {
    expect(conditionNote({ kind: "youGoSecond" })).toBe("you go second");
  });

  it("joins with ' and ' — the WHOLE sentence, not the two halves", () => {
    expect(conditionNote(CALL_BELL_GATE)).toBe("you go second and it is your first turn");
  });

  it("does NOT round-trip to the printed bytes, and that is recorded rather than hidden", () => {
    expect(CALL_BELL_TEXT.startsWith("You can use this card only if ")).toBe(true);
    expect(CALL_BELL_TEXT).not.toContain(conditionNote(CALL_BELL_GATE));
  });

  it("joins at arity 3 with the same word — no Oxford comma, and no printing asks for one", () => {
    expect(
      conditionNote({
        kind: "allOf",
        conditions: [
          { kind: "youGoSecond" },
          { kind: "yourFirstTurn" },
          { kind: "handSizesEqual" },
        ],
      }),
    ).toBe(
      "you go second and it is your first turn and you have the same number of cards in your hand as your opponent",
    );
  });
});

describe("D280 — Call Bell on a real board", () => {
  it("PLAYS on the going-second seat's first turn and fetches a Supporter", () => {
    const start = passTurns(turnOne(5, "p1"), 1); // turn 2 — p2's own first turn
    expect(start.turn).toBe(2);
    const armed = handFromDeck(start, "p2", "fix-callbell", 1);
    const uid = handUid(armed, "p2", "fix-callbell");
    const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
    expect(parked.phase.kind, "the search parks on a card choice").toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("no park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
    const names = new Set(prompt.candidates.map((u) => cardOfUid(parked, u)?.id ?? "?"));
    expect([...names]).toEqual(["sv01-180"]);
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
    }).state;
    expect(
      resolved.players.p2.hand.filter((u) => cardOfUid(resolved, u)?.id === "sv01-180"),
    ).toHaveLength(1);
  });

  it("is REFUSED on the going-first seat's first turn — with the JOINED note in the message", () => {
    const start = turnOne(5, "p1"); // turn 1 — p1's own first turn, p1 went first
    const armed = handFromDeck(start, "p1", "fix-callbell", 1);
    const uid = handUid(armed, "p1", "fix-callbell");
    const result = play(deepFreeze(armed), "p1", uid);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    // The reject NAMES the whole conjunction, which is the combinator's user-
    // visible payoff and the reason `conditionNote` needed an arm at all.
    expect(result.error.message).toBe(
      "fix-callbell can only be used if you go second and it is your first turn",
    );
  });

  it("is REFUSED on the going-second seat's LATER turns — the second conjunct alone", () => {
    const later = passTurns(turnOne(5, "p1"), 3); // turn 4 — p2's SECOND turn
    expect(later.turn).toBe(4);
    const armed = handFromDeck(later, "p2", "fix-callbell", 1);
    const uid = handUid(armed, "p2", "fix-callbell");
    const result = play(deepFreeze(armed), "p2", uid);
    expect(result.ok, "turn 4 is not p2's first turn").toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
  });

  it("the CONTROL Item plays on every one of those boards — the gate is the card's, not the turn's", () => {
    for (const [state, seat] of [
      [turnOne(5, "p1"), "p1"],
      [passTurns(turnOne(5, "p1"), 3), "p2"],
    ] as const) {
      const armed = handFromDeck(state, seat, "sv01-172", 1);
      const uid = handUid(armed, seat, "sv01-172");
      expect(play(deepFreeze(armed), seat, uid).ok, `Energy Search @${state.turn}`).toBe(true);
    }
  });

  it("lights the WIRE row only where the engine accepts it — the online HUD mirror", () => {
    // The same `redactGame` call lights the CONTROL on both boards, so this
    // cannot pass by the whole trainer list being disabled.
    const good = handFromDeck(passTurns(turnOne(5, "p1"), 1), "p2", "fix-callbell", 1);
    const goodWithControl = handFromDeck(good, "p2", "sv01-172", 1);
    expect(wireRow(goodWithControl, "p2", "fix-callbell")?.disabled).toBe(false);
    expect(wireRow(goodWithControl, "p2", "sv01-172")?.disabled).toBe(false);

    const bad = handFromDeck(turnOne(5, "p1"), "p1", "fix-callbell", 1);
    const badWithControl = handFromDeck(bad, "p1", "sv01-172", 1);
    expect(wireRow(badWithControl, "p1", "fix-callbell")?.disabled).toBe(true);
    expect(wireRow(badWithControl, "p1", "sv01-172")?.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `MATCH_RECORD_VERSION` — the question the handoff raised, DRIVEN BOTH WAYS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D280 — MATCH_RECORD_VERSION stays 14, and the reachability claim is MEASURED", () => {
  it("NO `conditionGate` in the whole registry carries an `allOf` — the persisted-op reachability sweep", () => {
    const gateConds: BoardCondition[] = [];
    let programsWalked = 0;
    for (const id of programmedCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked++;
      const ops = [
        ...walkProgram(program.trainer ?? []),
        ...Object.values(program.attack ?? {}).flatMap((ops) => walkProgram(ops)),
        ...(program.abilities ?? []).flatMap((a) => walkProgram(a.program)),
      ];
      for (const op of ops) if (op.op === "conditionGate") gateConds.push(op.cond);
    }
    expect(programsWalked).toBeGreaterThan(300);
    expect(gateConds.length).toBeGreaterThan(0);
    expect(gateConds.filter((c) => c.kind === "allOf")).toEqual([]);
    // …and the same for the ABILITY play gate, the other stored-adjacent seat.
    const abilityGates = programmedCardIds()
      .flatMap((id) => programFor(id)?.abilities ?? [])
      .map((a) => a.playableIf)
      .filter((c): c is BoardCondition => c !== undefined);
    expect(abilityGates.length).toBeGreaterThan(0);
    expect(
      programmedCardIds()
        .filter((id) => programFor(id)?.abilities?.some((a) => a.playableIf?.kind === "allOf"))
        .sort(),
    ).toEqual(
      [
        "mep-096",
        "30th-011",
        "30th-130",
        "mep-098",
        "30th-055",
        "30th-133",
        "mep-097",
        "30th-018",
        "30th-132",
        "me01-101",
      ].sort(),
    );
    expect(abilityGates.filter((c) => c.kind === "allOf")).toHaveLength(10);
  });

  it("a gated Call Bell writes exactly the keys the CONTROL Item writes — a DIFF with an ANCHOR", () => {
    const start = passTurns(turnOne(5, "p1"), 1); // turn 2 — p2's own first turn
    const viaGate = (() => {
      const armed = handFromDeck(start, "p2", "fix-callbell", 1);
      const uid = handUid(armed, "p2", "fix-callbell");
      const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("no park");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
      return mustApply(parked, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
      }).state;
    })();
    const viaControl = (() => {
      const armed = handFromDeck(start, "p2", "sv01-172", 1);
      const uid = handUid(armed, "p2", "sv01-172");
      const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("no park");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
      return mustApply(parked, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
      }).state;
    })();
    expect(Object.keys(viaGate).sort()).toEqual(Object.keys(viaControl).sort());
    expect(Object.keys(viaGate).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "recentAttackers",
      "rngState",
      "stadium",
      "turn",
    ]);
    expect(viaGate.phase.kind).toBe("turn:action");
    expect(viaGate.phase).not.toHaveProperty("cont");
  });
});
