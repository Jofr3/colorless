import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { EffectOp, EffectPrompt, GameState, PokemonRef } from "./index";
import { redactGame } from "./redact";
import {
  ATTACH_DECK,
  activeUid,
  benchFromDeck,
  clearBench,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handToDeck,
  mustApply,
  runProgram,
  setActiveFromDeck,
  settleProgram,
} from "./testFixtures";

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function board(): GameState {
  let state = driveSetup(1, { p1: ATTACH_DECK, p2: ATTACH_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "sv01-054");
  state = handToDeck(state, "p1", "fix-energy");
  state = handToDeck(state, "p1", "fix-water-energy");
  state = handToDeck(state, "p1", "fix-fire-energy");
  return state;
}

function run(state: GameState, program: EffectOp[]) {
  return runProgram(state, program, { seat: "p1", sourceUid: activeUid(state, "p1") }, {}, []);
}

function park(state: GameState, program: EffectOp[]): EffectPrompt {
  const result = run(state, program);
  if (result.kind !== "parked") throw new Error("expected a park");
  return result.prompt;
}

/** The parked program as a game phase, so `redactGame` and `resolveEffect` see it. */
function parked(state: GameState, program: EffectOp[]): GameState {
  const result = settleProgram(run(state, program), "p1", {}, []);
  if (!result.ok) throw new Error("expected a park");
  return result.state;
}

describe("the attach stage's wire fields", () => {
  it("an Energy attach's target park carries its whole public pile, and a mixed pick names the body", () => {
    let state = board();
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "fix-water-energy", 2);
    state = handFromDeck(state, "p1", "fix-fire-energy", 1);
    const pile = state.players.p1.hand.filter((uid) =>
      ["fix-water-energy", "fix-fire-energy"].includes(state.cardIdByUid[uid] ?? ""),
    );
    const op: EffectOp = { op: "attachEnergyFrom", source: "hand" };
    const prompt = park(state, [op]);
    expect(prompt).toMatchObject({ kind: "choosePokemon", attachPile: pile });
    const game = parked(state, [op]);
    const mine = redactGame(game, "p1").phase;
    if (mine.kind !== "effect:choose" || mine.prompt?.kind !== "choosePokemon")
      throw new Error("expected choosePokemon");
    expect(mine.prompt.attachPile?.map((c) => c.id)).toEqual(pile);
    expect(mine.prompt.attachPile?.[0]?.cardId).toBe("fix-water-energy");
    // The answer is unchanged, and the card question that follows names its body.
    const next = mustApply(game, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH0 },
    }).state;
    if (next.phase.kind !== "effect:choose") throw new Error("expected the card question");
    expect(next.phase.prompt).toMatchObject({
      kind: "chooseCards",
      dest: "attach",
      onto: BENCH0,
    });
    const wire = redactGame(next, "p1").phase;
    if (wire.kind !== "effect:choose" || wire.prompt?.kind !== "chooseCards")
      throw new Error("expected chooseCards");
    expect(wire.prompt.onto).toEqual(BENCH0);
  });

  it("an attach from the opponent's hand would carry no pile; a discard pile does", () => {
    let state = board();
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    expect(park(state, [{ op: "attachEnergyFrom", source: "discard" }])).toMatchObject({
      attachPile: state.players.p1.discard.filter(
        (uid) => state.cardIdByUid[uid] === "fix-water-energy",
      ),
    });
    let theirs = board();
    theirs = benchFromDeck(theirs, "p2", "fix-basic-1");
    theirs = handFromDeck(theirs, "p2", "fix-water-energy", 1);
    const prompt = park(theirs, [{ op: "attachEnergyFrom", source: "hand", whose: "opponent" }]);
    expect(prompt.kind).toBe("choosePokemon");
    expect("attachPile" in prompt).toBe(false);
  });

  it("a one-target mixed attach asks only the card question, naming that body", () => {
    let state = clearBench(board(), "p1");
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    state = handFromDeck(state, "p1", "fix-fire-energy", 1);
    expect(park(state, [{ op: "attachEnergyFrom", source: "hand" }])).toMatchObject({
      kind: "chooseCards",
      dest: "attach",
      onto: ACTIVE,
    });
  });

  it("the printed singular hand attach is marked mandatory; the plain one is not", () => {
    let state = board();
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "fix-water-energy", 2);
    const filter = { kind: "basicEnergy" } as const;
    expect(park(state, [{ op: "attachFromHand", filter, one: true, max: 1 }])).toMatchObject({
      kind: "attachCards",
      mandatory: true,
    });
    const plain = park(state, [{ op: "attachFromHand", filter }]);
    expect(plain.kind).toBe("attachCards");
    expect("mandatory" in plain).toBe(false);
    const game = parked(state, [{ op: "attachFromHand", filter, one: true, max: 1 }]);
    const wire = redactGame(game, "p1").phase;
    expect(wire.kind === "effect:choose" && wire.prompt).toMatchObject({
      mandatory: true,
    });
    expect(
      applyAction(game, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [] },
      }).ok,
    ).toBe(true);
  });

  it("a short spread from the discard names its pile", () => {
    let state = board();
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    const water = state.players.p1.discard.filter(
      (uid) => state.cardIdByUid[uid] === "fix-water-energy",
    );
    expect(
      park(state, [{ op: "attachEnergyFrom", source: "discard", toEach: true }]),
    ).toMatchObject({ kind: "choosePokemonMulti", max: 1, attachPile: water });
  });
});
