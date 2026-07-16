// Pure-logic suite (node env): real games driven through the engine's public
// API + its test fixtures, projected for each seat. The engine package does
// not export testFixtures (test-only by design), hence the relative import.

import { describe, expect, it } from "vitest";
import type { GameState } from "@luminous/engine";
import { topUid } from "@luminous/engine";
import {
  ALL_BASIC_DECK,
  FIXTURE_POOL,
  MIXED_DECK,
  attachFromDeck,
  deckOf,
  driveSetup,
  handUid,
  mustApply,
  mustCreate,
  setPrizes,
} from "../../../packages/engine/src/testFixtures";
import { cardImageUrl } from "../../lib/api";
import { HIDDEN_CARD_ID, HIDDEN_CARD_NAME, projectGameState } from "./projection";

// Seed borrowed from the engine's turn.test.ts: MIXED decks, no mulligans,
// and p1's post-setup hand holds >=2 energy, an item and a Stage1.
const SEED = 170;
const DECKS = { p1: MIXED_DECK, p2: MIXED_DECK };

/** p1 first; both actives fix-basic-1; p1 benches one fix-basic-0. */
function turnOneState(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-0"] },
  });
}

// KO drivers, mirroring the engine's attack.test.ts: seed 11 gives no
// mulligans for these decks and p2's opening hand holds the bench copies.
const KO_SEED = 11;
const ATTACKER_DECK = deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 });

function defenderDeck(id: string): string[] {
  return deckOf({ [id]: 40, "fix-water-energy": 20 });
}

/** p1's fix-attacker (one Fire attached) vs `bench`+1 copies of p2's
    `defenderId`, on p1's turn 3 — past the §4 first-turn attack ban, ready
    to Bite (attack 0: Colorless, 30 damage). */
function matchup(defenderId: string, bench: number): GameState {
  let state = driveSetup(
    KO_SEED,
    { p1: ATTACKER_DECK, p2: defenderDeck(defenderId) },
    {
      first: "p1",
      active: { p1: "fix-attacker", p2: defenderId },
      bench: { p2: Array.from({ length: bench }, () => defenderId) },
    },
  );
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return state;
}

/** Bite fix-weak (60 HP, ×2 Fire → exact KO): with 6 prizes up the pick
    always parks, so the returned state sits on ko:takePrizes (p1, 1). */
function parkedOnPrizes(bench: number): GameState {
  return mustApply(matchup("fix-weak", bench), { type: "attack", seat: "p1", index: 0 }).state;
}

/** A real prize-out win: one prize from victory, then the KOing Bite — the
    forced last pick auto-resolves straight into gameOver. */
function wonGame(): GameState {
  const state = setPrizes(matchup("fix-weak", 1), "p1", 1);
  return mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
}

/** The fixture pool ships image: null; this swaps in the canonical base path
    (`/assets/cards/{id}`) so URL construction is exercised. GameState is a
    plain value and the projection is pure, so the swap is legitimate. */
function withImages(state: GameState): GameState {
  const cardPool = Object.fromEntries(
    Object.entries(state.cardPool).map(([id, card]) => [
      id,
      { ...card, image: `/assets/cards/${id}` },
    ]),
  );
  return { ...state, cardPool };
}

/** Whole-value JSON sweep against a pre-stringified projection: does any
    *exact* string equal to `value` appear anywhere? (JSON.stringify quotes
    the probe, so "p1#1" never matches "p1#12".) The projection is
    stringified ONCE per viewer — this sweep probes dozens of uids. */
function sweepContains(projectionJson: string, value: string): boolean {
  return projectionJson.includes(JSON.stringify(value));
}

describe("projectGameState — zones", () => {
  it("projects every zone for the p1 viewer", () => {
    const state = turnOneState();
    const projection = projectGameState(state, "p1");

    // Own hand: face-up, uid-keyed, in engine order, resolved via the pool.
    const p1Hand = state.players.p1.hand;
    expect(projection.board.you.hand.map((card) => card.id)).toEqual(p1Hand);
    for (const model of projection.board.you.hand) {
      const cardId = state.cardIdByUid[model.id];
      expect(model.cardId).toBe(cardId);
      expect(model.name).toBe(cardId === undefined ? "" : FIXTURE_POOL[cardId]?.name);
    }

    // Opponent hand: right count, zero identity.
    expect(projection.board.opponent.hand).toHaveLength(state.players.p2.hand.length);

    // Board Pokémon are public for BOTH sides.
    expect(projection.board.you.active?.cardId).toBe("fix-basic-1");
    expect(projection.board.opponent.active?.cardId).toBe("fix-basic-1");
    expect(projection.board.you.bench.map((card) => card.cardId)).toEqual(["fix-basic-0"]);
    expect(projection.board.opponent.bench).toEqual([]);

    // Prizes as counts, decks as counts, discards public (empty so far).
    expect(projection.board.you.prizesRemaining).toBe(6);
    expect(projection.board.opponent.prizesRemaining).toBe(6);
    expect(projection.piles.you.deckCount).toBe(state.players.p1.deck.length);
    expect(projection.piles.opponent.deckCount).toBe(state.players.p2.deck.length);
    expect(projection.piles.you.discard).toEqual([]);
    expect(projection.piles.opponent.discard).toEqual([]);

    // No stadium zone in the engine yet.
    expect(projection.board.stadium).toBeNull();

    expect(projection.turn).toBe(1);
    expect(projection.activePlayer).toBe("you"); // p1 went first, p1 is viewing
    expect(projection.waitingOn).toBe("you"); // in turn:action they coincide
    expect(projection.pendingDecision).toBeNull();
    expect(projection.outcome).toBeNull();
  });

  it("mirrors the same state for the p2 viewer", () => {
    const state = turnOneState();
    const projection = projectGameState(state, "p2");

    // "you" is now p2: their own hand is the face-up one.
    expect(projection.board.you.hand.map((card) => card.id)).toEqual(state.players.p2.hand);
    expect(projection.board.opponent.hand).toHaveLength(state.players.p1.hand.length);

    // p1's board seen from across the table.
    expect(projection.board.opponent.bench.map((card) => card.cardId)).toEqual(["fix-basic-0"]);
    expect(projection.piles.opponent.deckCount).toBe(state.players.p1.deck.length);
    expect(projection.activePlayer).toBe("opponent"); // p1's turn, p2 viewing
    expect(projection.waitingOn).toBe("opponent");
  });

  it("projects a game still in setup without an active player", () => {
    const { state } = mustCreate(SEED, DECKS);
    const projection = projectGameState(state, "p1");
    expect(projection.turn).toBe(0);
    expect(projection.activePlayer).toBeNull(); // nobody owns a turn yet...
    // ...but the coin winner owes the first-player choice.
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
    expect(projection.waitingOn).toBe(state.phase.coinWinner === "p1" ? "you" : "opponent");
    expect(projection.pendingDecision).toBeNull();
    expect(projection.board.you.active).toBeNull();
    expect(projection.board.you.hand).toHaveLength(state.players.p1.hand.length);
  });
});

describe("projectGameState — hidden information", () => {
  it("leaks no opponent-hand or prize uid anywhere in the projection", () => {
    // Swept across the phases that populate every projection field: plain
    // turn play, a parked KO interrupt (pendingDecision) and a finished game
    // (outcome) — pendingDecision/outcome/pokemon must stay as clean as the
    // board.
    for (const state of [turnOneState(), parkedOnPrizes(1), wonGame()]) {
      for (const viewer of ["p1", "p2"] as const) {
        const json = JSON.stringify(projectGameState(state, viewer));
        const opponent = viewer === "p1" ? "p2" : "p1";
        for (const uid of state.players[opponent].hand) {
          expect(sweepContains(json, uid)).toBe(false);
        }
        // Prizes are face-down for BOTH players — the viewer's own included.
        for (const seat of ["p1", "p2"] as const) {
          for (const uid of state.players[seat].prizes) {
            expect(sweepContains(json, uid)).toBe(false);
          }
        }
      }
    }
  });

  it("renders the opponent hand as anonymous positional backs", () => {
    const projection = projectGameState(turnOneState(), "p1");
    for (const [index, model] of projection.board.opponent.hand.entries()) {
      expect(model.id).toBe(`opponent-hand-${index}`);
      expect(model.cardId).toBe(HIDDEN_CARD_ID);
      expect(model.name).toBe(HIDDEN_CARD_NAME);
      expect(model.imageUrl).toBeUndefined();
      expect(model.attached).toBeUndefined();
    }
  });
});

describe("projectGameState — image URLs", () => {
  it("builds art URLs through cardImageUrl when the card has a scan", () => {
    const projection = projectGameState(withImages(turnOneState()), "p1");
    const model = projection.board.you.hand[0];
    if (model === undefined) throw new Error("expected a hand card");
    expect(model.imageUrl).toBe(cardImageUrl(model.cardId, "high"));
    expect(model.imageUrl).toMatch(new RegExp(`/assets/cards/${model.cardId}/high\\.webp$`));
    expect(projection.board.you.active?.imageUrl).toBe(cardImageUrl("fix-basic-1", "high"));
  });

  it("leaves imageUrl undefined when the card has no scan (image: null)", () => {
    const projection = projectGameState(turnOneState(), "p1");
    for (const model of [...projection.board.you.hand, projection.board.you.active]) {
      expect(model?.imageUrl).toBeUndefined();
    }
  });
});

describe("projectGameState — uid stability across states", () => {
  it("keeps an energy card's identity as it moves hand → attached", () => {
    const state = turnOneState();
    const uid = handUid(state, "p1", "fix-energy");
    const before = projectGameState(state, "p1");
    expect(before.board.you.hand.some((card) => card.id === uid)).toBe(true);

    const { state: next } = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    const after = projectGameState(next, "p1");
    expect(after.board.you.hand.some((card) => card.id === uid)).toBe(false);
    expect(after.board.you.active?.attached?.energies.map((card) => card.id)).toEqual([uid]);
    expect(after.board.you.active?.attached?.energies[0]?.cardId).toBe("fix-energy");

    // From the other side of the table the SAME uid surfaces out of what was
    // an anonymous hand back — the card became public on attach.
    const opponentView = projectGameState(next, "p2");
    expect(opponentView.board.opponent.active?.attached?.energies.map((c) => c.id)).toEqual([uid]);
  });

  it("keeps a Basic's identity as it moves hand → bench", () => {
    const state = driveSetup(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    const uid = handUid(state, "p1", "fix-basic-1");
    const { state: next } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    const after = projectGameState(next, "p1");
    expect(after.board.you.bench.at(-1)?.id).toBe(uid);
  });

  it("keeps identities through a retreat, and surfaces the discarded energy", () => {
    let state = turnOneState();
    const energy = handUid(state, "p1", "fix-energy");
    state = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: energy,
      target: { spot: "active" },
    }).state;

    const before = projectGameState(state, "p1");
    const retreaterId = before.board.you.active?.id;
    const promotedId = before.board.you.bench[0]?.id;
    if (retreaterId === undefined || promotedId === undefined) throw new Error("bad board");

    state = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [energy],
      promoteBenchIndex: 0,
    }).state;
    const after = projectGameState(state, "p1");

    // Same two objects, swapped zones — the ids carry the identity across.
    expect(after.board.you.active?.id).toBe(promotedId);
    expect(after.board.you.bench.at(-1)?.id).toBe(retreaterId);
    // The retreat cost is public knowledge: it lands face-up in the discard.
    expect(after.piles.you.discard.map((card) => card.id)).toContain(energy);
    expect(after.piles.you.discard.find((card) => card.id === energy)?.cardId).toBe("fix-energy");
  });
});

describe("projectGameState — phase-derived fields", () => {
  it("parks on ko:takePrizes: the turn owner is also the seat waited on", () => {
    const state = parkedOnPrizes(1);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });

    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBe("you"); // turn 3 is still p1's turn
    expect(mine.waitingOn).toBe("you"); // and p1 owes the prize pick
    expect(mine.pendingDecision).toEqual({ kind: "takePrizes", count: 1 });
    expect(mine.outcome).toBeNull();

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBe("opponent");
    expect(theirs.waitingOn).toBe("opponent");
    expect(theirs.pendingDecision).toEqual({ kind: "takePrizes", count: 1 });
  });

  it("parks on ko:promote: the KO'd seat is waited on MID-opponent-turn", () => {
    // Two benched defenders make the promotion a real choice, so after the
    // prize pick the game parks on p2's decision — inside p1's turn. This is
    // exactly the state where a turn-parity guess names the wrong seat.
    const parked = parkedOnPrizes(2);
    const state = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(state.phase).toEqual({ kind: "ko:promote", seat: "p2" });

    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBe("you"); // still p1's turn...
    expect(mine.waitingOn).toBe("opponent"); // ...but p2 must act
    expect(mine.pendingDecision).toEqual({ kind: "promote" });

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBe("opponent");
    expect(theirs.waitingOn).toBe("you");
    expect(theirs.pendingDecision).toEqual({ kind: "promote" });
  });

  it("maps a win to each viewer and clears the acting fields", () => {
    const state = wonGame();
    expect(state.phase.kind).toBe("gameOver");

    const mine = projectGameState(state, "p1");
    expect(mine.outcome).toEqual({ result: "win", winner: "you", reason: "prizesTaken" });
    expect(mine.activePlayer).toBeNull();
    expect(mine.waitingOn).toBeNull();
    expect(mine.pendingDecision).toBeNull();

    const theirs = projectGameState(state, "p2");
    expect(theirs.outcome).toEqual({ result: "win", winner: "opponent", reason: "prizesTaken" });
    expect(theirs.activePlayer).toBeNull();
  });

  it("maps a tie's per-seat reasons to each viewer", () => {
    // Unreachable through M2 actions (see the engine's attack.test.ts) — the
    // crafted phase is how the engine's own suite pins the tie shape too.
    const over: GameState = {
      ...turnOneState(),
      phase: {
        kind: "gameOver",
        outcome: { result: "tie", reasons: { p1: "prizesTaken", p2: "noPokemon" } },
      },
    };
    expect(projectGameState(over, "p1").outcome).toEqual({
      result: "tie",
      reasons: { you: "prizesTaken", opponent: "noPokemon" },
    });
    expect(projectGameState(over, "p2").outcome).toEqual({
      result: "tie",
      reasons: { you: "noPokemon", opponent: "prizesTaken" },
    });
  });
});

describe("projectGameState — damage and HP", () => {
  it("covers every in-play Pokémon with damage taken and printed HP", () => {
    // A Bite into the 120 HP wall: 30 damage, no KO, play moves on to p2.
    const before = matchup("fix-wall", 1);
    const defender = before.players.p2.active;
    const attacker = before.players.p1.active;
    if (defender === null || attacker === null) throw new Error("bad board");
    const defenderUid = topUid(defender);
    const attackerUid = topUid(attacker);
    if (defenderUid === undefined || attackerUid === undefined) throw new Error("empty stacks");
    const state = mustApply(before, { type: "attack", seat: "p1", index: 0 }).state;

    for (const viewer of ["p1", "p2"] as const) {
      const projection = projectGameState(state, viewer);
      // Damage is public info — identical from both sides of the table; hp
      // is the printed max from the pool card.
      expect(projection.pokemon[defenderUid]).toEqual({ damage: 30, hp: 120 });
      expect(projection.pokemon[attackerUid]).toEqual({ damage: 0, hp: 120 });
      // The record covers exactly the in-play uids: actives + benches, both
      // sides — and nothing else (no hand/deck/prize keys).
      const inPlay = [state.players.p1, state.players.p2].flatMap((side) =>
        [side.active, ...side.bench].flatMap((pokemon) =>
          pokemon === null ? [] : [topUid(pokemon) ?? "?"],
        ),
      );
      expect(Object.keys(projection.pokemon).sort()).toEqual([...inPlay].sort());
    }
  });
});

describe("projectGameState — bench totality", () => {
  it("holds an (engine-impossible) empty bench stack as an index-stable placeholder", () => {
    const state = turnOneState();
    const side = state.players.p1;
    const real = side.bench[0];
    if (real === undefined) throw new Error("expected a benched Pokémon");
    const realUid = topUid(real);
    if (realUid === undefined) throw new Error("expected a stacked Pokémon");
    // Slot 0 empty, slot 1 real: a compacting projection would move the real
    // Pokémon to index 0 and desync every index-addressed action.
    const crafted: GameState = {
      ...state,
      players: { ...state.players, p1: { ...side, bench: [{ ...real, stack: [] }, real] } },
    };
    const projection = projectGameState(crafted, "p1");
    expect(projection.board.you.bench).toHaveLength(2);
    expect(projection.board.you.bench[0]).toEqual({
      id: "p1-bench-0-empty",
      cardId: "empty",
      name: "Empty slot",
      type: "trainer",
    });
    expect(projection.board.you.bench[1]?.id).toBe(realUid);
    // The placeholder has no uid to key, so it is the one in-play entry
    // without a status row; the real Pokémon keeps its own.
    expect(projection.pokemon[realUid]).toEqual({ damage: 0, hp: 60 });
    expect(Object.keys(projection.pokemon)).not.toContain("p1-bench-0-empty");
  });
});
