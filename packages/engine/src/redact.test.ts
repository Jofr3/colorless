// Pure-logic suite (node env): real games driven through the engine's public
// API + its test fixtures, REDACTED for each seat. redactGame is the
// authoritative server-side hidden-information filter (P4) — these tests pin its
// contract card-for-card and, above all, that no opponent-private card ever
// crosses into a viewer's snapshot.

import { describe, expect, it } from "vitest";
import { EMPTY_CARD_ID, HIDDEN_CARD_ID, HIDDEN_CARD_NAME, type RedactedGame } from "@luminous/schema";
import { redactGame } from "./redact";
import {
  MIXED_DECK,
  driveSetup,
  handUid,
  mustApply,
  mustCreate,
  setConditions,
  setDamage,
  setPrizes,
} from "./testFixtures";
import type { GameState, Seat } from "./types";

// Seed borrowed from turn.test.ts: MIXED decks, no mulligans; p1's post-setup
// hand holds >=2 energy, an item and a Stage1.
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

/** setup:place with p1 fully placed (active + one bench) AND ready, p2 not yet
    placed — the hot-seat handoff moment the setup redaction protects: p1's
    placements are still face-down on the table as the board flips to p2. */
function placedNotRevealed(): GameState {
  let state = mustCreate(SEED, DECKS).state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = mustApply(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" })
    .state;
  if (state.phase.kind !== "setup:place") throw new Error("expected setup:place");
  state = mustApply(state, {
    type: "setupPlaceActive",
    seat: "p1",
    uid: handUid(state, "p1", "fix-basic-1"),
  }).state;
  state = mustApply(state, {
    type: "setupPlaceBench",
    seat: "p1",
    uid: handUid(state, "p1", "fix-basic-0"),
  }).state;
  return mustApply(state, { type: "setupReady", seat: "p1" }).state;
}

/** Every engine uid a seat holds PRIVATELY (hand, deck, prizes, in-play stacks
    + attachments). None of these may appear in the OTHER seat's snapshot while
    they are private — the discard (public) is deliberately excluded. */
function privateUids(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((pokemon) =>
    pokemon === null ? [] : [...pokemon.stack, ...pokemon.energy, ...pokemon.tools],
  );
  return [...side.hand, ...side.deck, ...side.prizes, ...inPlay];
}

/** Every `id` string anywhere in a redacted snapshot (the animation identity of
    each rendered card). Public cards key off the engine uid; hidden ones off a
    positional id — so this set is exactly what a client could correlate. */
function allIds(game: RedactedGame): string[] {
  const ids: string[] = [];
  const card = (c: { id: string; attached?: { tools: { id: string }[]; energies: { id: string }[] } }) => {
    ids.push(c.id);
    if (c.attached) {
      for (const t of c.attached.tools) ids.push(t.id);
      for (const e of c.attached.energies) ids.push(e.id);
    }
  };
  if (game.board.stadium) card(game.board.stadium);
  for (const side of [game.board.you, game.board.opponent]) {
    for (const c of side.hand) card(c);
    if (side.active) card(side.active);
    for (const c of side.bench) card(c);
    for (const c of side.discard) card(c);
  }
  return ids;
}

describe("redactGame — the viewer's own side", () => {
  it("shows the viewer's whole hand face-up, keyed by uid", () => {
    const state = turnOneState();
    const game = redactGame(state, "p1");
    expect(game.seat).toBe("p1");
    expect(game.board.you.hand).toHaveLength(state.players.p1.hand.length);
    expect(game.board.you.hand.map((c) => c.id)).toEqual(state.players.p1.hand);
    for (const c of game.board.you.hand) {
      expect(c.cardId).not.toBe(HIDDEN_CARD_ID);
      expect(c.name).not.toBe(HIDDEN_CARD_NAME);
    }
  });

  it("shows the viewer's active with its battle row (damage / max HP / conditions)", () => {
    let state = turnOneState();
    state = setDamage(state, "p1", 30);
    state = setConditions(state, "p1", { rotation: "asleep", poisonDamage: 20, burned: true });
    const game = redactGame(state, "p1");
    const active = game.board.you.active;
    if (active === null) throw new Error("expected an active");
    expect(active.battle).toEqual({
      damage: 30,
      hp: expect.any(Number),
      conditions: { rotation: "asleep", poisonDamage: 20, burned: true },
    });
    // The conditions object is a COPY, never an alias into state.
    expect(active.battle?.conditions).not.toBe(state.players.p1.active?.conditions);
  });
});

describe("redactGame — the opponent's side is redacted", () => {
  it("gives the opponent's hand as a count of anonymous backs (no uid, no id)", () => {
    const state = turnOneState();
    const game = redactGame(state, "p1");
    const oppHand = game.board.opponent.hand;
    expect(oppHand).toHaveLength(state.players.p2.hand.length);
    oppHand.forEach((card, index) => {
      expect(card.cardId).toBe(HIDDEN_CARD_ID);
      expect(card.name).toBe(HIDDEN_CARD_NAME);
      expect(card.id).toBe(`opponent-hand-${index}`);
      // The positional id is NOT the engine uid it stands for.
      expect(state.players.p2.hand).not.toContain(card.id);
    });
  });

  it("gives BOTH prize piles and decks as counts only", () => {
    let state = turnOneState();
    state = setPrizes(state, "p2", 4);
    const game = redactGame(state, "p1");
    expect(game.board.you.prizesRemaining).toBe(state.players.p1.prizes.length);
    expect(game.board.opponent.prizesRemaining).toBe(4);
    expect(game.board.you.deckCount).toBe(state.players.p1.deck.length);
    expect(game.board.opponent.deckCount).toBe(state.players.p2.deck.length);
    // Nowhere in the snapshot is a prize/deck uid or card id exposed.
    const ids = new Set(allIds(game));
    for (const uid of [...state.players.p2.prizes, ...state.players.p2.deck]) {
      expect(ids.has(uid)).toBe(false);
    }
  });

  it("shows the opponent's in-play Pokémon face-up ONCE setup is over", () => {
    const state = turnOneState();
    const game = redactGame(state, "p1");
    const oppActive = game.board.opponent.active;
    if (oppActive === null) throw new Error("expected opponent active");
    // Public: real uid, real identity, a battle row.
    expect(oppActive.cardId).not.toBe(HIDDEN_CARD_ID);
    expect(oppActive.id).toBe(state.players.p2.active?.stack.at(-1));
    expect(oppActive.battle).not.toBeUndefined();
  });
});

describe("redactGame — the setup hidden-information barrier", () => {
  it("redacts the opponent's face-down placements to backs with NO battle row", () => {
    const state = placedNotRevealed();
    const game = redactGame(state, "p2"); // p2 is about to place; p1's board is face-down
    const oppActive = game.board.opponent.active;
    if (oppActive === null) throw new Error("expected opponent active");
    expect(oppActive.cardId).toBe(HIDDEN_CARD_ID);
    expect(oppActive.id).toBe("opponent-active-hidden");
    expect(oppActive.battle).toBeUndefined(); // a battle row would leak the printed HP
    expect(oppActive.attached).toBeUndefined();
    expect(game.board.opponent.bench).toEqual([
      expect.objectContaining({ cardId: HIDDEN_CARD_ID, id: "opponent-bench-0-hidden" }),
    ]);
  });

  it("LEAKS NOTHING: no p1-private uid reaches the p2 viewer during setup", () => {
    const state = placedNotRevealed();
    const game = redactGame(state, "p2");
    const leaked = new Set(allIds(game));
    for (const uid of privateUids(state, "p1")) {
      expect(leaked.has(uid)).toBe(false);
    }
    // The viewer's OWN placements are not yet made here, but its own hand IS
    // face-up — sanity that redaction is asymmetric, not blanket.
    expect(game.board.you.hand.map((c) => c.id)).toEqual(state.players.p2.hand);
  });
});

describe("redactGame — public zones + attachments", () => {
  it("shows a discard pile fully and publicly, in order", () => {
    // Surgery: move two deck cards into p1's discard (a public, ordered pile).
    const base = turnOneState();
    const deck = base.players.p1.deck;
    const a = deck[0];
    const b = deck[1];
    if (a === undefined || b === undefined) throw new Error("deck too small");
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1, discard: [a, b], deck: deck.slice(2) },
      },
    };
    const game = redactGame(state, "p1");
    expect(game.board.you.discard.map((c) => c.id)).toEqual([a, b]);
    // The opponent sees it too (discard is public for both), still by uid.
    expect(redactGame(state, "p2").board.opponent.discard.map((c) => c.id)).toEqual([a, b]);
    for (const c of game.board.you.discard) expect(c.cardId).not.toBe(HIDDEN_CARD_ID);
  });

  it("carries attached energy on an in-play Pokémon, keyed by uid", () => {
    // Surgery: attach a deck card as energy onto p1's active.
    const base = turnOneState();
    const active = base.players.p1.active;
    if (active === null) throw new Error("expected active");
    const energyUid = base.players.p1.deck[0];
    if (energyUid === undefined) throw new Error("deck too small");
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          active: { ...active, energy: [...active.energy, energyUid] },
          deck: base.players.p1.deck.slice(1),
        },
      },
    };
    const game = redactGame(state, "p1");
    expect(game.board.you.active?.attached?.energies.map((e) => e.id)).toContain(energyUid);
  });
});

describe("redactGame — phase-derived view (viewer-relative)", () => {
  it("maps the turn owner and who-must-act into you/opponent", () => {
    const state = turnOneState(); // p1's turn:action
    expect(redactGame(state, "p1")).toMatchObject({ activePlayer: "you", waitingOn: "you" });
    expect(redactGame(state, "p2")).toMatchObject({ activePlayer: "opponent", waitingOn: "opponent" });
  });

  it("has no turn owner during setup, but names who must act", () => {
    const state = placedNotRevealed(); // setup:place, p2 owes the decision
    const p2 = redactGame(state, "p2");
    expect(p2.activePlayer).toBeNull();
    expect(p2.waitingOn).toBe("you");
    expect(redactGame(state, "p1").waitingOn).toBe("opponent");
  });

  it("surfaces the outcome, seat-mapped, once the game is over", () => {
    // Force a gameOver by decking p2 out is heavy; assert the mapping shape via
    // a synthetic gameOver phase over a real board.
    const base = turnOneState();
    const state: GameState = {
      ...base,
      phase: { kind: "gameOver", outcome: { result: "win", winner: "p1", reason: "prizesTaken" } },
    };
    expect(redactGame(state, "p1").outcome).toEqual({
      result: "win",
      winner: "you",
      reason: "prizesTaken",
    });
    expect(redactGame(state, "p2").outcome).toEqual({
      result: "win",
      winner: "opponent",
      reason: "prizesTaken",
    });
  });
});

describe("redactGame — purity", () => {
  it("never mutates the input state and is deterministic per seat", () => {
    const state = turnOneState();
    const before = JSON.stringify(state);
    const a = redactGame(state, "p1");
    const b = redactGame(state, "p1");
    expect(JSON.stringify(state)).toBe(before);
    expect(a).toEqual(b);
  });
});

// The `empty` sentinel only appears for an engine-impossible empty in-play
// stack; it never occurs in a real driven game, so it is asserted structurally
// via the constant rather than a fixture.
it("uses the shared empty-slot sentinel", () => {
  expect(EMPTY_CARD_ID).toBe("empty");
});
