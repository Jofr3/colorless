import { describe, expect, it } from "vitest";
import { applyAction, conditionHolds, conditionNote, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  BOARD_CONDITION_DECK,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setBenchDamage,
  setPrizes,
  types,
} from "./testFixtures";

// M5 op-slice: board conditions — ONE `BoardCondition` vocabulary with two
// consumers, so a printed "if <board condition>" reads the same whether it gates
// the PLAY or a step inside the program:
//   • CardProgram.trainerPlayableIf — the printed "You can use this card only if …"
//     legality gate, checked before the card leaves hand (Fighting Au Lait);
//   • the `conditionGate` op — a mid-program branch spliced by runProgram like
//     coinFlipGate, one-armed (Falkner) or with an `otherwise` (Grusha's
//     "instead").
// Every condition reads only PUBLIC state, so a gate emits no event and the HUD
// may evaluate one client-side. Three real cards land, verified end to end
// through playTrainer, plus fix-condgate (a FIXTURE proving a branch can park).

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so a Supporter is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Every uid held anywhere on `seat`'s side, sorted — cards only ever MOVE
    between zones, so this multiset is invariant across a play. */
function seatUids(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

function handCount(state: GameState, seat: Seat): number {
  return state.players[seat].hand.length;
}

/** TEST SURGERY: leave `keep` alone in `seat`'s hand, parking the rest in its
    discard — no uid leaves the game, so the state stays legal-shaped. */
function handOnly(state: GameState, seat: Seat, keep: string[]): GameState {
  const side = state.players[seat];
  const rest = side.hand.filter((u) => !keep.includes(u));
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: keep, discard: [...side.discard, ...rest] },
    },
  };
}

/** TEST SURGERY: attach one of `seat`'s deck Energy onto their Active, or onto a
    benched Pokémon by index — the state Grusha's condition reads. */
function attachEnergy(state: GameState, seat: Seat, spot: "active" | number): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy");
  if (uid === undefined) throw new Error(`${seat} deck has no fix-energy`);
  const deck = side.deck.filter((u) => u !== uid);
  const put = (p: NonNullable<GameState["players"]["p1"]["active"]>) => ({
    ...p,
    energy: [...p.energy, uid],
  });
  if (spot === "active") {
    if (side.active === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: { ...state.players, [seat]: { ...side, deck, active: put(side.active) } },
    };
  }
  if (side.bench[spot] === undefined) throw new Error(`${seat} has no benched Pokémon at ${spot}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck, bench: side.bench.map((p, i) => (i === spot ? put(p) : p)) },
    },
  };
}

/** Put a Beach Court into `seat`'s hand and play it — the Stadium zone then
    carries `owner: seat`, which is what Falkner's condition reads. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "sv01-167", 1);
  const uid = handUid(withCard, seat, "sv01-167");
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

/** Put `cardId` in P1's hand and play it, returning the state + events. */
function play(state: GameState, cardId: string): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const uid = handUid(withCard, "p1", cardId);
  return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
}

describe("M5 op-slice — conditionHolds (the shared BoardCondition evaluator)", () => {
  it("morePrizesThanOpponent is STRICT — equal counts do not satisfy it", () => {
    const state = board(11);
    // Both seats open on 6 prizes, so the condition is false for BOTH players.
    expect(state.players.p1.prizes.length).toBe(state.players.p2.prizes.length);
    expect(conditionHolds(state, "p1", { kind: "morePrizesThanOpponent" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "morePrizesThanOpponent" })).toBe(false);
  });

  it("morePrizesThanOpponent is true only for the player BEHIND on prizes taken", () => {
    // P2 has taken prizes (4 left); P1 still has 6 — P1 is behind, so it holds
    // for P1 and not for P2. The condition is asymmetric by construction.
    const state = setPrizes(board(11), "p2", 4);
    expect(conditionHolds(state, "p1", { kind: "morePrizesThanOpponent" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "morePrizesThanOpponent" })).toBe(false);
  });

  it("yourStadiumInPlay reads OWNERSHIP, not presence — the opponent's does not count", () => {
    const empty = board(11);
    expect(empty.stadium).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "yourStadiumInPlay" })).toBe(false);

    const mine = playStadium(empty, "p1");
    expect(mine.stadium?.owner).toBe("p1");
    expect(conditionHolds(mine, "p1", { kind: "yourStadiumInPlay" })).toBe(true);
    // The SAME card sitting in the SAME shared zone is not "yours" for p2.
    expect(conditionHolds(mine, "p2", { kind: "yourStadiumInPlay" })).toBe(false);
  });

  it("noEnergyOnYourPokemon covers the BENCH too, and ignores the opponent's board", () => {
    const clean = benchFromDeck(board(11), "p1", "fix-basic-1");
    expect(conditionHolds(clean, "p1", { kind: "noEnergyOnYourPokemon" })).toBe(true);

    // The opponent's Energy is irrelevant — the condition is about YOUR Pokémon.
    const oppEnergy = attachEnergy(clean, "p2", "active");
    expect(conditionHolds(oppEnergy, "p1", { kind: "noEnergyOnYourPokemon" })).toBe(true);

    // One Energy anywhere on YOUR side breaks it — Active OR Bench.
    expect(conditionHolds(attachEnergy(clean, "p1", "active"), "p1", { kind: "noEnergyOnYourPokemon" })).toBe(false);
    expect(conditionHolds(attachEnergy(clean, "p1", 0), "p1", { kind: "noEnergyOnYourPokemon" })).toBe(false);
  });
});

describe("M5 op-slice — Fighting Au Lait (the printed trainerPlayableIf gate)", () => {
  it("is REJECTED when the prize counts are equal, and the play costs nothing", () => {
    const state = handFromDeck(board(12), "p1", "sv02-181", 1);
    const uid = handUid(state, "p1", "sv02-181");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "PLAY_CONDITION_NOT_MET");
    // The gate runs BEFORE the card leaves hand: a rejected play is a total
    // no-op, so the card is still there to play once the board swings.
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
    expect(result.ok).toBe(false);
    expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.discard).not.toContain(uid);
  });

  it("is rejected when the player is AHEAD on prizes taken (fewer remaining)", () => {
    // P1 has taken 2 prizes (4 left) vs P2's 6 — P1 is ahead, so the gate shuts.
    const state = handFromDeck(setPrizes(board(12), "p1", 4), "p1", "sv02-181", 1);
    const uid = handUid(state, "p1", "sv02-181");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "PLAY_CONDITION_NOT_MET");
  });

  it("plays once P1 is BEHIND on prizes, and heals 60 from the chosen Pokémon", () => {
    let state = benchFromDeck(setPrizes(board(12), "p2", 3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 90);
    const before = seatUids(handFromDeck(state, "p1", "sv02-181", 1), "p1");

    const played = play(state, "sv02-181");
    // Two Pokémon in play → healChosen PARKS on the target choice.
    expect(played.state.phase.kind).toBe("effect:choose");
    const resolved = mustApply(played.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(resolved.state.players.p1.bench[0]?.damage).toBe(30);
    expect(find(resolved.events, "HEALED")?.amount).toBe(60);
    // The played card moved hand → discard; nothing was created or destroyed.
    expect(seatUids(resolved.state, "p1")).toEqual(before);
  });

  it("caps at the damage present (a 30-damage Pokémon heals 30, not 60)", () => {
    let state = benchFromDeck(setPrizes(board(12), "p2", 3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 30);
    const played = play(state, "sv02-181");
    const resolved = mustApply(played.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(resolved.state.players.p1.bench[0]?.damage).toBe(0);
    expect(find(resolved.events, "HEALED")?.amount).toBe(30);
  });
});

describe("M5 op-slice — Falkner (a one-armed conditionGate)", () => {
  it("draws exactly 2 with no Stadium in play", () => {
    const state = board(13);
    expect(state.stadium).toBeNull();
    const before = handCount(state, "p1");
    const played = play(state, "sv02-180");
    // +1 for the Falkner put into hand, −1 for playing it, +2 drawn.
    expect(handCount(played.state, "p1")).toBe(before + 2);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("draws 2 MORE (4 total, as two separate draws) when YOUR Stadium is in play", () => {
    const state = playStadium(board(13), "p1");
    const before = handCount(state, "p1");
    const played = play(state, "sv02-180");
    expect(handCount(played.state, "p1")).toBe(before + 4);
    // Two drawCards ops, not one merged count — the log reads as the card does.
    const draws = findAll(played.events, "CARDS_DRAWN");
    expect(draws.map((d) => d.uids.length)).toEqual([2, 2]);
  });

  it("does NOT get the bonus off the OPPONENT's Stadium (the ownership reading)", () => {
    // The zone is occupied, but by P2's card — "if YOU have a Stadium in play".
    // P2 goes first, so it plays the Beach Court on its own turn 1, then passes.
    const p2Turn = driveSetup(13, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK }, { first: "p2" });
    const state = playStadium(p2Turn, "p2");
    expect(state.stadium?.owner).toBe("p2");
    const p1Turn = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const before = handCount(p1Turn, "p1");
    const played = play(p1Turn, "sv02-180");
    expect(handCount(played.state, "p1")).toBe(before + 2);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("emits NO event for the gate itself — a public condition is not news", () => {
    const played = play(playStadium(board(13), "p1"), "sv02-180");
    // Only the play and the two draws; nothing announcing the branch taken (and
    // in particular no coin-flip row, which the sibling gate would emit).
    expect(types(played.events)).toEqual(["TRAINER_PLAYED", "CARDS_DRAWN", "CARDS_DRAWN"]);
  });
});

describe("M5 op-slice — Grusha (the conditionGate `otherwise` arm)", () => {
  it("draws until 7 in hand when NO Energy is on your board", () => {
    const state = handOnly(board(14), "p1", []);
    const played = play(state, "sv02-184");
    // The Grusha itself is put in hand then discarded on play, so the draw runs
    // against an EMPTY hand: 7 cards drawn, hand size exactly 7.
    expect(handCount(played.state, "p1")).toBe(7);
    expect(find(played.events, "CARDS_DRAWN")?.uids).toHaveLength(7);
  });

  it("draws until 5 instead when ANY of your Pokémon has Energy — Active or Bench", () => {
    const base = benchFromDeck(handOnly(board(14), "p1", []), "p1", "fix-basic-1");
    for (const spot of ["active", 0] as const) {
      const played = play(attachEnergy(base, "p1", spot), "sv02-184");
      expect(handCount(played.state, "p1")).toBe(5);
      expect(find(played.events, "CARDS_DRAWN")?.uids).toHaveLength(5);
    }
  });

  it("takes the 5-arm only — the always-then / always-otherwise mutants both die", () => {
    // NB this does NOT prove "exactly one arm ran": `drawUntilHandSize 7` then
    // `5` is indistinguishable from `7` alone, so a run-BOTH mutant is equivalent
    // here. What it pins is that the CONDITION is consulted at all — a gate hard-
    // wired to `then` lands on 7, one hard-wired to `otherwise` lands on 5 when
    // the 7-arm test above expects 7. The ordered-splice claims are pinned by
    // fix-gateorder below, where the two arms draw distinguishable counts.
    const state = attachEnergy(handOnly(board(14), "p1", []), "p1", "active");
    const played = play(state, "sv02-184");
    expect(handCount(played.state, "p1")).toBe(5);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("is unaffected by the OPPONENT's Energy (still the 7-draw arm)", () => {
    const state = attachEnergy(handOnly(board(14), "p1", []), "p2", "active");
    const played = play(state, "sv02-184");
    expect(handCount(played.state, "p1")).toBe(7);
  });

  it("draws NOTHING — and emits no draw row — when the hand is already at size", () => {
    // A hand of 6 (5 kept + the Grusha put in) is above the 5 target once Grusha
    // is discarded: drawUntilHandSize no-ops at count ≤ 0 rather than logging a
    // misleading "drew 0 cards".
    const state = attachEnergy(board(14), "p1", "active");
    const kept = state.players.p1.hand.slice(0, 5);
    const played = play(handOnly(state, "p1", kept), "sv02-184");
    expect(handCount(played.state, "p1")).toBe(5);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(0);
  });

  it("never TRIMS a hand already ABOVE the target — it draws, it does not set", () => {
    // "Draw cards until you have 5" with 8 in hand draws nothing and discards
    // nothing. Only the hand-EXACTLY-at-target case was pinned before, so a
    // refactor reading the op as "set the hand size" passed the suite.
    const state = attachEnergy(board(14), "p1", "active"); // → the draw-to-5 arm
    const withCard = handFromDeck(state, "p1", "sv02-184", 1);
    const uid = handUid(withCard, "p1", "sv02-184");
    // Every card BESIDES the Grusha, which is discarded up front — the hand it
    // resolves against must be strictly above the 5 target for this to bite.
    const others = withCard.players.p1.hand.filter((u) => u !== uid);
    expect(others.length).toBeGreaterThan(5);
    const primed = handOnly(withCard, "p1", [uid, ...others]);
    const deckBefore = primed.players.p1.deck;
    const discardBefore = primed.players.p1.discard.length;

    const played = mustApply(primed, { type: "playTrainer", seat: "p1", uid });
    expect(handCount(played.state, "p1")).toBe(others.length);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(0);
    expect(played.state.players.p1.deck).toEqual(deckBefore);
    // Only the played Grusha reached the discard — no hand card was trimmed into it.
    expect(played.state.players.p1.discard).toHaveLength(discardBefore + 1);
  });

  it("SHORT-DRAWS on a shallow deck without decking the player out (§14.3)", () => {
    // Two cards left in the deck against a draw-to-7: take both and stop. The
    // deck-out check is a turn-START rule, so an empty deck here is not a loss.
    const withCard = handFromDeck(board(14), "p1", "sv02-184", 1);
    const uid = handUid(withCard, "p1", "sv02-184");
    let state = handOnly(withCard, "p1", [uid]);
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: side.deck.slice(0, 2), discard: [...side.discard, ...side.deck.slice(2)] },
      },
    };
    const played = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(handCount(played.state, "p1")).toBe(2);
    expect(played.state.players.p1.deck).toHaveLength(0);
    expect(played.state.phase.kind).not.toBe("game:over");
  });
});

describe("M5 op-slice — the gate mechanism itself", () => {
  it("an op INSIDE a branch still PARKS — both arms (fix-condgate)", () => {
    // `then` (P1 behind on prizes) → healChosen parks on the target choice.
    const behind = benchFromDeck(setPrizes(board(15), "p2", 3), "p1", "fix-basic-1");
    const healArm = play(behind, "fix-condgate");
    expect(healArm.state.phase.kind).toBe("effect:choose");

    // `otherwise` (prizes level) → gust parks on the opponent's Bench choice.
    const level = benchFromDeck(benchFromDeck(board(15), "p2", "fix-basic-1"), "p2", "fix-basic-1");
    const gustArm = play(level, "fix-condgate");
    expect(gustArm.state.phase.kind).toBe("effect:choose");
    const resolved = mustApply(gustArm.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    expect(find(resolved.events, "POKEMON_SWITCHED")).toBeDefined();
  });

  it("evaluates AS OF the gate, splices the arm to the FRONT, and keeps the tail", () => {
    // fix-gateorder: [attach an Energy, gate(noEnergyOnYourPokemon){then: draw 3,
    // otherwise: draw 1 + draw 4}, draw 2]. The leading attach BREAKS the
    // condition, so the correct run is the otherwise arm, in order, then the
    // trailing draw — one ordered assertion, three distinct mutants killed:
    //   • gate read against the program's ENTRY state → [3, 2]
    //   • arm pushed to the BACK of the queue → [2, 1, 4]
    //   • the queue tail dropped by the splice → [1, 4]
    let state = handOnly(board(18), "p1", []);
    state = handFromDeck(state, "p1", "fix-energy", 1); // the attach source
    const before = handCount(state, "p1");
    const played = play(state, "fix-gateorder");

    expect(findAll(played.events, "CARDS_DRAWN").map((d) => d.uids.length)).toEqual([1, 4, 2]);
    expect(find(played.events, "ENERGY_ATTACHED")).toBeDefined();
    // Hand: the energy left it for the Active, the Item left it for the discard.
    expect(handCount(played.state, "p1")).toBe(before - 1 + 7);
    expect(state.players.p1.active?.energy ?? []).toHaveLength(0);
    expect(played.state.players.p1.active?.energy).toHaveLength(1);
  });

  it("checks a gated SUPPORTER before burning the §7.2 allowance", () => {
    // Every real gated card is an Item, so only this fixture pins the ordering:
    // a rejected gate must leave the one-Supporter-per-turn allowance untouched.
    const state = handFromDeck(board(18), "p1", "fix-gatedsup", 1); // prizes level → shut
    const uid = handUid(state, "p1", "fix-gatedsup");
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
    if (result.ok) throw new Error("expected the gate to reject");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    // Assert on the RESULT, not the (immutable) input: the rejection carries no
    // state at all, so nothing was spent — and a real Supporter still plays.
    expect("state" in result).toBe(false);
    expect(state.allowances.supporterPlayed).toBe(false);
    const real = handFromDeck(state, "p1", "sv02-184", 1);
    expect(applyAction(real, { type: "playTrainer", seat: "p1", uid: handUid(real, "p1", "sv02-184") }).ok).toBe(true);
  });

  it("names the unmet condition in the reject message (the HUD tooltip copy)", () => {
    // `conditionNote` is player-facing on both paths — the engine's reject pill
    // and the greyed HUD row's tooltip — and nothing else asserts its wording.
    const state = handFromDeck(board(18), "p1", "sv02-181", 1);
    const uid = handUid(state, "p1", "sv02-181");
    const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
    if (result.ok) throw new Error("expected the gate to reject");
    // The fixture card's name IS its id, so the real message reads
    // "Fighting Au Lait can only be used if …" against the live catalog.
    expect(result.error.message).toBe(
      "sv02-181 can only be used if you have more Prize cards remaining than your opponent",
    );
    // The other two arms are unreachable from a card today (neither is a play
    // gate), so pin them directly or a typo ships unseen.
    expect(conditionNote({ kind: "yourStadiumInPlay" })).toBe("you have a Stadium in play");
    expect(conditionNote({ kind: "noEnergyOnYourPokemon" })).toBe(
      "none of your Pokémon have any Energy attached",
    );
  });

  it("every program is PURE — a frozen state is never mutated", () => {
    for (const cardId of ["sv02-180", "sv02-184"]) {
      const state = deepFreeze(playStadium(board(16), "p1"));
      expect(() => play(state, cardId)).not.toThrow();
    }
    const gated = deepFreeze(benchFromDeck(setPrizes(board(16), "p2", 3), "p1", "fix-basic-1"));
    expect(() => play(gated, "sv02-181")).not.toThrow();
  });

  it("conserves cards — a play only MOVES uids between zones", () => {
    for (const cardId of ["sv02-180", "sv02-184"]) {
      const state = playStadium(board(17), "p1");
      const withCard = handFromDeck(state, "p1", cardId, 1);
      const before = seatUids(withCard, "p1");
      const uid = handUid(withCard, "p1", cardId);
      const after = must(applyAction(withCard, { type: "playTrainer", seat: "p1", uid }));
      expect(seatUids(after, "p1")).toEqual(before);
    }
  });

  it("authors all six real ids, reprints included", () => {
    // Fighting Au Lait has a single print; Falkner two, Grusha three.
    expect(programFor("sv02-181")?.trainerPlayableIf).toEqual({ kind: "morePrizesThanOpponent" });
    expect(programFor("sv02-180")).toBe(programFor("sv02-251"));
    expect(programFor("sv02-184")).toBe(programFor("sv02-253"));
    expect(programFor("sv02-184")).toBe(programFor("sv02-268"));
    // Only the gated card carries a play gate — the other two are always legal.
    expect(programFor("sv02-180")?.trainerPlayableIf).toBeUndefined();
    expect(programFor("sv02-184")?.trainerPlayableIf).toBeUndefined();
  });
});
