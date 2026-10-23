import type { Card } from "@colorless/schema";
import { redactedGameSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, redactGame } from "./index";
import type { GameState } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  trainerCard,
  must,
  mustApply as run,
  patchSide,
  driveSetup,
} from "./testFixtures";

const TYME = "sv08-190";
const TYME_2 = "sv08.5-143";
const PIKA = "d577y-pika";
const BIG = "d577y-big";
const FOSSIL = "sv07-129";
const FILLER = "d577y-filler";

const LOCAL_CARDS: Record<string, Card> = {
  [TYME]: { ...trainerCard(TYME, "Supporter", "Tyme"), name: "Tyme" },
  [TYME_2]: { ...trainerCard(TYME_2, "Supporter", "Tyme"), name: "Tyme" },
  [PIKA]: battler(PIKA, { name: "D577 Pika", hp: 70, types: ["Lightning"] }),
  [BIG]: battler(BIG, { name: "D577 Big", hp: 230, types: ["Colorless"] }),
  [FOSSIL]: {
    ...trainerCard(FOSSIL, "Item", "Play this card as if it were a 60-HP Basic {C} Pokémon."),
    name: "Antique Cover Fossil",
    hp: null,
    abilities: null,
  },
  [FILLER]: battler(FILLER, {
    name: "D577 Filler",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [TYME]: 2,
  [TYME_2]: 1,
  [PIKA]: 2,
  [BIG]: 2,
  [FOSSIL]: 1,
  [FILLER]: 20,
  "fix-energy": 32,
});

function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** p1's turn 2 with p1's hand EXACTLY `hand` (ids, pulled from the deck or the prizes), and
    optionally p2's deck cut to `oppDeck` cards. */
function table(hand: readonly string[], oppDeck?: number): GameState {
  let state = opened(5779);
  const p1 = state.players.p1;
  state = patchSide(state, "p1", { hand: [], deck: [...p1.deck, ...p1.hand] });
  for (const id of hand) {
    const side = state.players.p1;
    const is = (u: string) => state.cardIdByUid[u] === id;
    const inDeck = side.deck.find(is);
    if (inDeck !== undefined) {
      state = patchSide(state, "p1", {
        deck: side.deck.filter((u) => u !== inDeck),
        hand: [...side.hand, inDeck],
      });
      continue;
    }
    const prized = side.prizes.find(is);
    const swap = side.deck.find((u) => !is(u));
    if (prized === undefined || swap === undefined) throw new Error(`p1 has no more ${id}`);
    state = patchSide(state, "p1", {
      prizes: side.prizes.map((u) => (u === prized ? swap : u)),
      deck: side.deck.filter((u) => u !== swap),
      hand: [...side.hand, prized],
    });
  }
  if (oppDeck !== undefined) {
    const p2 = state.players.p2;
    state = patchSide(state, "p2", {
      deck: p2.deck.slice(0, oppDeck),
      discard: [...p2.discard, ...p2.deck.slice(oppDeck)],
    });
  }
  return state;
}

const uidOf = (state: GameState, id: string): string => {
  const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`p1 hand has no ${id}`);
  return uid;
};

const ctxOf = (state: GameState): LogContext => ({
  names: { p1: "Ember", p2: "Tide" },
  state,
  elapsed: formatElapsed(0),
});

describe("D577 Tyme §1 — the registry row", () => {
  it("both printings share ONE program: one op, draw 4", () => {
    expect(programFor(TYME)).toEqual({ trainer: [{ op: "opponentGuessesHp", draw: 4 }] });
    expect(programFor(TYME_2)).toBe(programFor(TYME));
  });
});

describe("D577 Tyme §2 — what can be named (R-TY1)", () => {
  it("a hand with no Pokémon refuses the play — an Antique Fossil in hand is an Item there", () => {
    const state = table([TYME, FOSSIL, "fix-energy"]);
    const refused = applyAction(state, {
      type: "playTrainer",
      seat: "p1",
      uid: uidOf(state, TYME),
    });
    expect(refused.ok ? null : refused.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("ONE Pokémon in hand: named at once (forced), the guess parks on the OPPONENT", () => {
    const state = table([TYME, PIKA, FOSSIL]);
    const played = run(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, TYME) });
    expect(played.state.phase.kind).toBe("effect:choose");
    if (played.state.phase.kind !== "effect:choose") return;
    expect(played.state.phase.seat).toBe("p1");
    expect(played.state.phase.answerer).toBe("p2");
    expect(played.state.phase.prompt).toEqual({
      kind: "guessHp",
      name: "D577 Pika",
      note: "Guess the HP of your opponent's D577 Pika.",
    });
    expect(played.events.find((e) => e.type === "POKEMON_NAMED")).toEqual({
      type: "POKEMON_NAMED",
      seat: "p1",
      name: "D577 Pika",
    });
  });

  it("TWO Pokémon in hand: the controller names one — `chooseCards` with the 'name' dest, exactly 1", () => {
    const state = table([TYME, PIKA, BIG]);
    const played = run(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, TYME) }).state;
    if (played.phase.kind !== "effect:choose") throw new Error("not parked");
    expect(played.phase.answerer).toBeUndefined();
    expect(played.phase.prompt).toEqual({
      kind: "chooseCards",
      candidates: [uidOf(state, PIKA), uidOf(state, BIG)],
      min: 1,
      max: 1,
      dest: "name",
      note: "Name a Pokémon in your hand — your opponent guesses its HP.",
    });
    const named = run(played, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uidOf(state, BIG)] },
    }).state;
    if (named.phase.kind !== "effect:choose") throw new Error("not parked");
    expect(named.phase.prompt).toEqual({
      kind: "guessHp",
      name: "D577 Big",
      note: "Guess the HP of your opponent's D577 Big.",
    });
    expect(named.phase.answerer).toBe("p2");
    expect(named.players.p1.hand).toContain(uidOf(state, BIG));
  });
});

describe("D577 Tyme §3 — the guess and the draw (R-TY2)", () => {
  function parked(oppDeck?: number): { state: GameState; pika: string; handBefore: number } {
    const state = table([TYME, PIKA], oppDeck);
    const pika = uidOf(state, PIKA);
    const played = run(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, TYME) }).state;
    return { state: played, pika, handBefore: played.players.p1.hand.length };
  }

  it("RIGHT (70): the opponent draws 4; the named card is back in (never left) the hand", () => {
    const { state, pika, handBefore } = parked();
    const p2Hand = state.players.p2.hand.length;
    const guessed = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: 70 },
    });
    expect(guessed.state.players.p2.hand.length).toBe(p2Hand + 4);
    expect(guessed.state.players.p1.hand.length).toBe(handBefore);
    expect(guessed.state.players.p1.hand).toContain(pika);
    expect(guessed.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(guessed.events.find((e) => e.type === "HP_GUESSED")).toEqual({
      type: "HP_GUESSED",
      seat: "p1",
      uid: pika,
      guess: 70,
      hp: 70,
      right: true,
      drawer: "p2",
    });
  });

  it("WRONG (60): the controller draws 4, the opponent draws nothing", () => {
    const { state, handBefore } = parked();
    const p2Hand = state.players.p2.hand.length;
    const guessed = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: 60 },
    }).state;
    expect(guessed.players.p1.hand.length).toBe(handBefore + 4);
    expect(guessed.players.p2.hand.length).toBe(p2Hand);
  });

  it("an OVER-guess (80 against 70) is wrong too — exact equality, not a threshold", () => {
    const { state, handBefore } = parked();
    const guessed = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: 80 },
    }).state;
    expect(guessed.players.p1.hand.length).toBe(handBefore + 4);
  });

  it("a THIN deck draws what it has — no loss, no refusal", () => {
    const { state } = parked(2);
    const p2Hand = state.players.p2.hand.length;
    const guessed = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: 70 },
    }).state;
    expect(guessed.players.p2.hand.length).toBe(p2Hand + 2);
    expect(guessed.players.p2.deck).toEqual([]);
    expect(guessed.phase.kind).toBe("turn:action");
  });

  it("refuses a guess that is not a whole number ≥ 0, and refuses the CONTROLLER answering", () => {
    const { state } = parked();
    for (const hp of [59.5, -10, Number.NaN]) {
      const refused = applyAction(state, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "hpGuess", hp },
      });
      expect(refused.ok ? null : refused.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    const asString = applyAction(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: "70" as unknown as number },
    });
    expect(asString.ok).toBe(false);
    const wrongSeat = applyAction(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "hpGuess", hp: 70 },
    });
    expect(wrongSeat.ok).toBe(false);
  });
});

describe("D577 Tyme §4 — the wire: the name only, to the opponent only (R-TY3)", () => {
  it("the guesser's frame carries { guessHp, name, note } and no uid or HP; the controller's carries no prompt", () => {
    const state = table([TYME, PIKA]);
    const pika = uidOf(state, PIKA);
    const parkedState = run(state, {
      type: "playTrainer",
      seat: "p1",
      uid: uidOf(state, TYME),
    }).state;
    const forP2 = redactGame(parkedState, "p2");
    expect(redactedGameSchema.parse(forP2)).toEqual(forP2);
    expect(forP2.phase).toEqual({
      kind: "effect:choose",
      prompt: {
        kind: "guessHp",
        name: "D577 Pika",
        note: "Guess the HP of your opponent's D577 Pika.",
      },
    });
    expect(JSON.stringify(forP2)).not.toContain(pika);
    expect(redactGame(parkedState, "p1").phase).toEqual({ kind: "effect:choose", prompt: null });
  });

  it("the log names the card, never its HP, until the reveal", () => {
    const state = table([TYME, PIKA]);
    const played = run(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, TYME) });
    const named = logFromEvents(played.events, ctxOf(played.state));
    expect(JSON.stringify(named)).toContain("D577 Pika");
    expect(JSON.stringify(named)).not.toContain("70");
    const guessed = run(played.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "hpGuess", hp: 60 },
    });
    const reveal = logFromEvents(guessed.events, ctxOf(guessed.state));
    expect(JSON.stringify(reveal)).toContain("(70 HP) — the guess 60 was ");
  });
});
