import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { conditionHolds, conditionNote } from "./interpreter";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  trainerCard,
} from "./testFixtures";
import { koedDuringOpponentsLastTurn } from "./types";

const LOCAL_CARDS: Record<string, Card> = {
  "fix-unfairstamp": trainerCard(
    "fix-unfairstamp",
    "Item",
    "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.",
  ),
  "fix-hassel": trainerCard(
    "fix-hassel",
    "Supporter",
    "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nLook at the top 8 cards of your deck and put up to 3 of them into your hand. Shuffle the other cards back into your deck.",
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const KO_GATE_DECK = deckOf({
  "fix-unfairstamp": 4,
  "fix-hassel": 4,
  "fix-sniper": 6,
  "fix-victim": 6,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: KO_GATE_DECK, p2: KO_GATE_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

function sniperOnP2(seed: number, p1Bench: string[] = ["fix-basic-1"]): GameState {
  let state = localSetup(seed, "p1");
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = setActiveFromDeck(state, "p2", "fix-sniper");
  state = attachFromDeck(state, "p2", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p1", "fix-victim");
  state = clearBench(state, "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  return state;
}

/** Drain the KO decision stages (prizes, then the forced promotion) until the
    board is back in somebody's action phase or the game is over. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      const prizeIndices = Array.from({ length: count }, (_, i) => i);
      next = must(applyAction(next, { type: "takePrizes", seat, prizeIndices }));
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** Hand `cardId` to `seat`, restocking the deck from hand first so no surgery
    depends on which seed dealt what. */
function toHand(state: GameState, seat: Seat, cardId: string): GameState {
  return handFromDeck(handToDeck(state, seat, cardId), seat, cardId, 1);
}

function play(state: GameState, seat: Seat, cardId: string) {
  const next = toHand(state, seat, cardId);
  return applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) });
}

/** Pass the turn `count` times from whoever holds it, settling nothing (these
    boards have no §12 clause, so the Checkup is a no-op). */
function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function drawnBy(events: GameEvent[], seat: Seat): number {
  return events
    .filter((e): e is Extract<GameEvent, { type: "CARDS_DRAWN" }> => e.type === "CARDS_DRAWN")
    .filter((e) => e.seat === seat)
    .reduce((total, e) => total + e.uids.length, 0);
}

const SEEDS = [3, 11, 29, 47, 61] as const;

// ── 1. The field itself, before any card reads it ────────────────────────────

describe("GameState.lastKoTurn — the stamp", () => {
  it("starts NULL for both seats, and `null` rather than 0 is what makes turn 1 false", () => {
    const state = localSetup(3, "p1");
    expect(state.lastKoTurn).toEqual({ p1: null, p2: null });
    expect(state.turn).toBe(1);
    expect(koedDuringOpponentsLastTurn(state, "p1")).toBe(false);
    expect(koedDuringOpponentsLastTurn(state, "p2")).toBe(false);
  });

  it("an ACTIVE Knock Out stamps the LOSING seat with the CURRENT turn, and only that seat", () => {
    const state = sniperOnP2(3);
    expect(state.turn).toBe(2);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
    // BOTH seats in one breath: P1 lost the Pokémon, P2 merely scored the KO.
    // A build keyed on the attacker passes every one-sided read and fails here.
    expect(after.lastKoTurn).toEqual({ p1: 2, p2: null });
  });

  it("a BENCH Knock Out stamps too — the funnel's second branch, not just its first", () => {
    let state = sniperOnP2(11, ["fix-victim", "fix-basic-1"]);
    state = setBenchDamage(state, "p1", 0, 10);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const koed = events.filter((e) => e.type === "KNOCKED_OUT");
    expect(koed).toHaveLength(2);
    expect(after.lastKoTurn).toEqual({ p1: 2, p2: null });
  });

  it("a bench KO ALONE stamps — the branch driven with the Active surviving", () => {
    // The previous `it` KOs both spots at once, so the Active branch alone could
    // have produced the stamp. Here the Active is a 120 HP `fix-basic-1`-sized
    // body that shrugs off 30, and ONLY the benched body dies.
    let state = sniperOnP2(29, ["fix-victim", "fix-basic-1"]);
    state = setActiveFromDeck(state, "p1", "fix-sniper"); // 120 HP, survives the 30
    state = setBenchDamage(state, "p1", 0, 10);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const koed = events.filter((e) => e.type === "KNOCKED_OUT");
    expect(koed).toHaveLength(1);
    expect(after.players.p1.active).not.toBeNull();
    expect(after.lastKoTurn).toEqual({ p1: 2, p2: null });
  });

  it("the CHECKUP path stamps the turn that is ENDING, not the one about to start", () => {
    let state = sniperOnP2(47);
    state = setDamage(state, "p1", 20); // 30 HP victim, 10 to live
    state = setConditions(state, "p1", { poisonDamage: 10 });
    const { state: after } = mustApply(state, { type: "endTurn", seat: "p2" });
    const settled = settle(after);
    // The KO happened on turn 2 (P2's), and it is now turn 3 (P1's).
    expect(settled.lastKoTurn).toEqual({ p1: 2, p2: null });
    expect(settled.turn).toBe(3);
  });

  it("a LATER Knock Out moves the stamp forward rather than accumulating", () => {
    // The field is a stamp: the second KO overwrites the first. A tally would
    // read 2 here and a boolean would read the same thing on both turns, so this
    // is the assertion that pins WHICH shape landed.
    const first = settle(mustApply(sniperOnP2(61), { type: "attack", seat: "p2", index: 0 }).state);
    expect(first.lastKoTurn.p1).toBe(2);
    let state = passTurns(first, 2); // P1's turn 3, P2's turn 4 → P1 on turn 5
    expect(state.turn).toBe(5);
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = setActiveFromDeck(state, "p1", "fix-sniper");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // P2 now carries a turn-5 stamp; P1's turn-2 stamp is untouched, which is
    // what makes the two seats independent rather than one shared clock.
    expect(after.lastKoTurn).toEqual({ p1: 2, p2: 5 });
  });
});

// ── 2. The condition, and the rolling window ────────────────────────────────

describe("yourPokemonKoedOnOpponentsLastTurn — the 24th BoardCondition member", () => {
  const COND = { kind: "yourPokemonKoedOnOpponentsLastTurn" } as const;

  it("holds for the seat that LOST the Pokémon, on the very next turn, and for nobody else", () => {
    const state = settle(mustApply(sniperOnP2(3), { type: "attack", seat: "p2", index: 0 }).state);
    expect(state.turn).toBe(3); // P1's turn — the one after the KO
    // Both seats on the SAME state, in the same breath. P2 scored the Knock Out
    // and reads FALSE; that asymmetry is the whole content of the member.
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p2", COND)).toBe(false);
  });

  it("EXPIRES — two turns later the same board answers false for the same seat", () => {
    const koed = settle(mustApply(sniperOnP2(11), { type: "attack", seat: "p2", index: 0 }).state);
    expect(conditionHolds(koed, "p1", COND)).toBe(true);
    const later = passTurns(koed, 2); // P1 turn 3 → P2 turn 4 → P1 turn 5
    expect(later.turn).toBe(5);
    expect(later.lastKoTurn.p1).toBe(2); // the stamp is still THERE …
    expect(conditionHolds(later, "p1", COND)).toBe(false); // … and no longer matches
    expect(conditionHolds(later, "p2", COND)).toBe(false);
  });

  it("is FALSE on P2's own intervening turn — the window is the turn BEFORE, not any earlier one", () => {
    const koed = settle(mustApply(sniperOnP2(29), { type: "attack", seat: "p2", index: 0 }).state);
    const p2Turn = passTurns(koed, 1); // P1's turn 3 ends → P2 on turn 4
    expect(p2Turn.turn).toBe(4);
    // P1's stamp is 2 and `turn - 1` is 3, so even the seat that WAS hit reads
    // false here. A build comparing "is the stamp non-null" passes every test
    // above and fails this one.
    expect(conditionHolds(p2Turn, "p1", COND)).toBe(false);
    expect(conditionHolds(p2Turn, "p2", COND)).toBe(false);
  });

  it("round-trips the printed clause through conditionNote", () => {
    expect(conditionNote(COND)).toBe(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );
  });
});

// ── 3. The two cards ────────────────────────────────────────────────────────

describe("Unfair Stamp sv06-165 — the gate plus D270's perSeat draw", () => {
  it("is registered on its real id with the gate and the printed 5/2 pair", () => {
    expect(programFor("sv06-165")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
    });
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    // The alternate art is the SAME program object, as a reprint must be.
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("is REFUSED before the Knock Out and ACCEPTED after it, on one board", () => {
    // Same seed, same deck, same card, one difference: whether P1 lost a Pokémon
    // on P2's turn. A gate wired to a constant passes one of these two.
    const clean = passTurns(localSetup(3, "p1"), 2); // P1 turn 1 → P2 turn 2 → P1 turn 3
    expect(clean.turn).toBe(3);
    const refused = play(clean, "p1", "fix-unfairstamp");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected the play to be refused");
    expect(refused.error.code).toBe("PLAY_CONDITION_NOT_MET");
    expect(refused.error.message).toContain(
      "any of your Pokémon were Knocked Out during your opponent's last turn",
    );

    const koed = settle(mustApply(sniperOnP2(3), { type: "attack", seat: "p2", index: 0 }).state);
    expect(play(koed, "p1", "fix-unfairstamp").ok).toBe(true);
  });

  it("draws 5 to the controller and 2 to the opponent — both hands, one breath, every seed", () => {
    for (const seed of SEEDS) {
      const koed = settle(
        mustApply(sniperOnP2(seed), { type: "attack", seat: "p2", index: 0 }).state,
      );
      const before = { p1: koed.players.p1.hand.length, p2: koed.players.p2.hand.length };
      expect(before.p1).toBeGreaterThan(0);
      expect(before.p2).toBeGreaterThan(0);

      const result = play(koed, "p1", "fix-unfairstamp");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      // BOTH counts asserted together. The printed pair is asymmetric, so 5 and 2
      // each reach SOMEBODY under a swapped build; only the pairing distinguishes
      // them, and only reading both seats can see the pairing.
      expect({
        p1: result.state.players.p1.hand.length,
        p2: result.state.players.p2.hand.length,
      }).toEqual({ p1: 5, p2: 2 });
      expect(drawnBy(result.events, "p1")).toBe(5);
      expect(drawnBy(result.events, "p2")).toBe(2);
    }
  });

  it("is an ITEM, so it does not spend the §7.2 Supporter allowance", () => {
    const koed = settle(mustApply(sniperOnP2(47), { type: "attack", seat: "p2", index: 0 }).state);
    const result = play(koed, "p1", "fix-unfairstamp");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.allowances.supporterPlayed).toBe(false);
  });
});

describe("Hassel sv06-151/-205 — the SAME gate on a completely different second half", () => {
  it("is registered on both ids as one program: the gate plus lookAtTopN 8/3", () => {
    const expected = {
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      trainer: [
        { op: "lookAtTopN", n: 8, filter: { kind: "anyCard" }, max: 3 },
        { op: "shuffleDeck" },
      ],
    };
    expect(programFor("sv06-151")).toEqual(expected);
    expect(programFor("sv06-205")).toEqual(expected);
    expect(programFor("sv06-151")).toBe(programFor("sv06-205"));
  });

  it("is refused behind the same gate and parks on the top 8 once it opens", () => {
    const clean = passTurns(localSetup(11, "p1"), 2);
    const refused = play(clean, "p1", "fix-hassel");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected the play to be refused");
    expect(refused.error.code).toBe("PLAY_CONDITION_NOT_MET");

    const koed = settle(mustApply(sniperOnP2(11), { type: "attack", seat: "p2", index: 0 }).state);
    const result = play(koed, "p1", "fix-hassel");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.phase.kind).toBe("effect:choose");
    if (result.state.phase.kind !== "effect:choose") throw new Error("unreachable");
    const prompt = result.state.phase.prompt;
    expect(prompt.kind).toBe("chooseCards");
    if (prompt.kind !== "chooseCards") throw new Error("unreachable");
    expect(prompt.candidates).toHaveLength(8);
    expect(prompt.max).toBe(3);
  });
});

// ── 4. The record — driven, not asserted ────────────────────────────────────

describe("MATCH_RECORD_VERSION — the derivation, driven by a replay", () => {
  it("a PREVIOUS-DEPLOY state cannot replay this gate — the soft landing is not on offer", () => {
    const koed = settle(mustApply(sniperOnP2(3), { type: "attack", seat: "p2", index: 0 }).state);
    expect(play(koed, "p1", "fix-unfairstamp").ok).toBe(true);

    // The version-13 shape: the same board, minus the key that deploy never wrote.
    const legacy: Partial<GameState> = { ...koed };
    // biome-ignore lint/performance/noDelete: reproducing a persisted shape requires the key to be ABSENT, not undefined.
    delete legacy.lastKoTurn;
    expect("lastKoTurn" in legacy).toBe(false);

    expect(() => koedDuringOpponentsLastTurn(legacy as GameState, "p1")).toThrow();
    // …and end to end, through the real action the online client sends: the play
    // does not come back as a REJECTION the DO could relay, it comes back as an
    // exception. There is no reading of this record that reproduces the game.
    expect(() => play(legacy as GameState, "p1", "fix-unfairstamp")).toThrow();
  });

  it("the ONLY writer is knockOut, so a state that never saw a KO carries the sentinel forward", () => {
    // The complement of the replay above, and the reason `turn.ts` takes a
    // byte-zero diff: passing turns is not a write. Four turn boundaries, four
    // `freshAllowances()` calls, and the stamp never moves.
    const state = passTurns(localSetup(61, "p1"), 4);
    expect(state.turn).toBe(5);
    expect(state.lastKoTurn).toEqual({ p1: null, p2: null });
  });
});
