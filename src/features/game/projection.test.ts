// Pure-logic suite (node env): real games driven through the engine's public
// API + its test fixtures, projected for each seat. The engine package does
// not export testFixtures (test-only by design), hence the relative import.

import { describe, expect, it } from "vitest";
import type {
  EffectContinuation,
  EffectPrompt,
  GameState,
  PokemonRef,
  Seat,
} from "@luminous/engine";
import { redactGame, topUid } from "@luminous/engine";
import {
  ABILITY_DECK,
  ALL_BASIC_DECK,
  ATTACK_PARK_DECK,
  FIXTURE_POOL,
  MIXED_DECK,
  ONKO_DECK,
  RARE_CANDY_DECK,
  REVEAL_BOTTOM_DECK,
  SNIPE_DECK,
  STADIUM_TOOL_DECK,
  attachFromDeck,
  benchFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  mustCreate,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
} from "../../../packages/engine/src/testFixtures";
import { cardImageUrl } from "../../lib/api";
import {
  HIDDEN_CARD_ID,
  HIDDEN_CARD_NAME,
  projectGameState,
  projectionFromRedacted,
} from "./projection";

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

/** setup:place with p1 fully placed (active + one bench) AND ready, p2 not
    yet placed — exactly the hot-seat handoff moment the setup redaction
    protects: the board is about to flip to p2 with p1's placements still
    face-down on the table. */
function placedNotRevealed(): GameState {
  let state = mustCreate(SEED, DECKS).state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = mustApply(state, {
    type: "chooseFirstPlayer",
    seat: state.phase.coinWinner,
    first: "p1",
  }).state;
  // Seed 170 deals no mulligans, so placement opens immediately.
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

/** Every uid p1 has in play (stack cards included) — what must never leak to
    the p2 viewer while setup runs. */
function p1InPlayUids(state: GameState): string[] {
  const side = state.players.p1;
  return [side.active, ...side.bench].flatMap((pokemon) =>
    pokemon === null ? [] : [...pokemon.stack, ...pokemon.energy, ...pokemon.tools],
  );
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

/** The battle row every pristine in-play fixture Pokémon projects. */
function pristineBattle(hp: number) {
  return { damage: 0, hp, conditions: { rotation: "none", poisonDamage: 0, burned: false } };
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
    // Swept across the phases that populate every projection field: mid-
    // setup (face-down placements), plain turn play, a parked KO interrupt
    // (pendingDecision) and a finished game (outcome) — pendingDecision/
    // outcome/battle must stay as clean as the board.
    for (const state of [placedNotRevealed(), turnOneState(), parkedOnPrizes(1), wonGame()]) {
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

describe("projectGameState — setup redaction", () => {
  it("hides the opponent's placements as positional backs during setup:place", () => {
    // Images swapped in so a leak through imageUrl would be visible too.
    const state = withImages(placedNotRevealed());
    const projection = projectGameState(state, "p2");

    // p1's active and bench are on the table but STILL FACE-DOWN (§3 — the
    // engine emits SETUP_REVEALED only when both players ready): identity-
    // free backs whose full model equality also pins "no imageUrl, no
    // attached, no uid".
    expect(projection.board.opponent.active).toEqual({
      id: "opponent-active-hidden",
      cardId: HIDDEN_CARD_ID,
      name: HIDDEN_CARD_NAME,
      type: "trainer",
    });
    expect(projection.board.opponent.bench).toEqual([
      {
        id: "opponent-bench-0-hidden",
        cardId: HIDDEN_CARD_ID,
        name: HIDDEN_CARD_NAME,
        type: "trainer",
      },
    ]);

    // The full-model equalities above also pin that the backs carry NO
    // `battle` — a row would leak the printed HP of a face-down placement.

    // And no in-play uid of p1's escapes anywhere: board, battle or piles.
    const json = JSON.stringify(projection);
    const uids = p1InPlayUids(state);
    expect(uids.length).toBeGreaterThanOrEqual(2); // active + bench really placed
    for (const uid of uids) {
      expect(sweepContains(json, uid)).toBe(false);
    }
  });

  it("keeps the viewer's OWN placements face-up during setup:place", () => {
    const state = placedNotRevealed();
    const projection = projectGameState(state, "p1");

    // p1 placed these — they see them, full identity and battle included.
    expect(projection.board.you.active?.cardId).toBe("fix-basic-1");
    expect(projection.board.you.bench.map((card) => card.cardId)).toEqual(["fix-basic-0"]);
    expect(projection.board.you.active?.battle).toEqual(pristineBattle(60));
    expect(projection.board.you.bench[0]?.battle).toEqual(pristineBattle(60));
  });

  it("reveals the opponent's board under its real uids once turn:action begins", () => {
    let state = placedNotRevealed();
    state = mustApply(state, {
      type: "setupPlaceActive",
      seat: "p2",
      uid: handUid(state, "p2", "fix-basic-1"),
    }).state;
    state = mustApply(state, { type: "setupReady", seat: "p2" }).state;
    expect(state.phase.kind).toBe("turn:action"); // SETUP_REVEALED happened

    const projection = projectGameState(state, "p2");
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("expected p1 active");
    const p1ActiveUid = topUid(p1Active);
    if (p1ActiveUid === undefined) throw new Error("expected a stacked active");
    // Face-up now, keyed by the engine uid (the positional back re-keys away
    // — the reveal is a remount, the accepted animation trade).
    expect(projection.board.opponent.active?.id).toBe(p1ActiveUid);
    expect(projection.board.opponent.active?.cardId).toBe("fix-basic-1");
    // Battle state now rides on BOTH sides' in-play models again.
    expect(projection.board.opponent.active?.battle).toEqual(pristineBattle(60));
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

  it("passes an effect:choose multi-snipe prompt through unchanged (M4 slice 8)", () => {
    let state = driveSetup(
      4,
      { p1: SNIPE_DECK, p2: SNIPE_DECK },
      { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
    );
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 3 → parks (max 2)
    state = handFromDeck(state, "p1", "sv01-118", 1); // Hawlucha
    const uid = handUid(state, "p1", "sv01-118");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    // The controller both owns the turn and owes the decision — the snipe prompt
    // rides through the same effectChoose the search/heal prompts do.
    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBe("you");
    expect(mine.waitingOn).toBe("you");
    if (mine.pendingDecision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    const prompt = mine.pendingDecision.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // The floor and the decline ride through too — the dialog's entire behaviour
    // is read off these, so a projection that dropped either would silently turn
    // an exact pick back into an "up to".
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.declinable).toBe(true);
    expect(prompt.candidates).toHaveLength(3);
    expect(projectGameState(state, "p2").waitingOn).toBe("opponent");
  });

  it("keeps an on-KO effect:choose park (resumeTail) owned by the turn owner, not the KO'd player", () => {
    // P1 (second player, turn 2) attacks P2's fix-onko Active (30 HP) with Bite
    // 30 → KO. The fix-onko's on-KO Ability parks AFTER P1 takes the prize —
    // during P1's turn, on P2's (the KO'd, NON-turn player's) decision. The
    // projection must read the turn owner via koParkActiveSeat, not phase.seat.
    let state = driveSetup(9, { p1: ONKO_DECK, p2: ONKO_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → P1's turn 2
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "fix-onko");
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state; // parks ko:takePrizes p1
    state = mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(state.phase.seat).toBe("p2"); // the KO'd player owes it
    expect(state.phase.resumeTail).toBe(true);

    const mine = projectGameState(state, "p1"); // the attacker / turn owner
    expect(mine.activePlayer).toBe("you"); // still P1's turn...
    expect(mine.waitingOn).toBe("opponent"); // ...but P2 (KO'd) owes the on-KO decision
    if (mine.pendingDecision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    expect(mine.pendingDecision.prompt.kind).toBe("chooseCards");

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBe("opponent"); // P1 owns the turn (opponent, to p2)
    expect(theirs.waitingOn).toBe("you"); // p2 must act
  });

  it("keeps an ATTACK effect:choose park (resumeTail) owned by the attacker", () => {
    // The other resumeTail origin (M5): Paldean Tauros' Blaze Dash parks on
    // "Discard an Energy from this Pokémon" with only the attackEpilogue stage
    // queued — the turn tail is not seeded yet, so koParkActiveSeat has to count
    // attackEpilogue as in-turn or the board would show NO owner mid-attack.
    let state = driveSetup(
      3,
      { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → P1's turn 2
    state = setActiveFromDeck(state, "p1", "sv02-028");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;

    if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(state.phase.seat).toBe("p1");
    expect(state.phase.resumeTail).toBe(true);
    // D189 — the stage carries the ATTACKER's uid as well as its seat. Nothing in
    // this projection reads it (`koParkActiveSeat` keys on `kind` + `seat`), which
    // is exactly why it is asserted here: the shape moved under the web layer and
    // this is the one web case that pins the whole stage.
    const attacker = state.players.p1.active;
    expect(state.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: attacker === null ? undefined : topUid(attacker),
        // 🆕 D394 — and the printed ATTACK name, which rides the stage for the same
        // reason the uid does: `finishAttack` cannot re-derive it after a park.
        attack: "Blaze Dash",
      },
    ]);

    // Unlike the on-KO park above, the decider IS the turn owner here.
    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBe("you");
    expect(mine.waitingOn).toBe("you");
    expect(mine.pendingDecision?.kind).toBe("effectChoose");

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBe("opponent");
    expect(theirs.waitingOn).toBe("opponent");
  });

  it("routes an `answerer` park to the OTHER seat without moving the turn (M5 — Ortega)", () => {
    // The THIRD way the deciding seat and the turn owner come apart, and the
    // only one where they differ mid-play with no KO involved: the printed
    // "your opponent may draw a card" parks on the non-controller while the
    // controller's turn runs on. Unlike the two resumeTail cases above,
    // activeSeat must keep reading phase.seat — the turn did not move, and a
    // board that handed P2 the turn glow for answering a question would be
    // lying about whose turn it is.
    let state = driveSetup(
      20260722,
      { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → P1's turn 2
    state = handFromDeck(state, "p1", "sv03-190", 1); // Ortega
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv03-190"),
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
    const asked = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
    }).state;

    if (asked.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    expect(asked.phase.seat).toBe("p1"); // the controller, unchanged
    expect(asked.phase.answerer).toBe("p2"); // …but P2 answers
    expect(asked.phase.resumeTail).toBeUndefined(); // no KO tail involved

    const mine = projectGameState(asked, "p1");
    expect(mine.activePlayer).toBe("you"); // still P1's turn…
    expect(mine.waitingOn).toBe("opponent"); // …and P2 owes the answer

    const theirs = projectGameState(asked, "p2");
    expect(theirs.activePlayer).toBe("opponent");
    expect(theirs.waitingOn).toBe("you");
    if (theirs.pendingDecision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    expect(theirs.pendingDecision.prompt.kind).toBe("mayDraw");
  });

  /** A CHECKUP-origin park: p2's Active is lethally poisoned when p1 ends
      turn 3, so the KO fires from the Pokémon Checkup — parking BETWEEN
      turns (endTurn and checkup already drained; pending holds only the ko
      stages + startTurn), unlike parkedOnPrizes' attack-KO park, where the
      whole turn tail is still queued. Two benched defenders keep the later
      promotion a real (parking) choice. */
  function parkedAtCheckup(): GameState {
    let state = matchup("fix-weak", 2);
    state = setDamage(state, "p2", 50); // fix-weak prints 60 HP...
    state = setConditions(state, "p2", { poisonDamage: 10 }); // ...lethal at the tick
    return mustApply(state, { type: "endTurn", seat: "p1" }).state;
  }

  it("reports no turn owner while a checkup-origin KO parks between turns", () => {
    const state = parkedAtCheckup();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // The between-turns signature the projection keys on: no endTurn or
    // checkup stage remains behind the parked ko stages.
    expect(
      state.pending.some((stage) => stage.kind === "endTurn" || stage.kind === "checkup"),
    ).toBe(false);

    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBeNull(); // between turns nobody owns one...
    expect(mine.waitingOn).toBe("you"); // ...but p1 owes the prize pick
    expect(mine.pendingDecision).toEqual({ kind: "takePrizes", count: 1 });

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBeNull();
    expect(theirs.waitingOn).toBe("opponent");
  });

  it("keeps a MID-TURN KO park owned by the actor whose turn will resume", () => {
    // A mid-turn KO (evolve-below-HP; engine-tested in stadiumTool.test.ts)
    // parks ko:takePrizes for the OPPONENT with a resumeTurn stage queued
    // behind it — the actor's turn is still in progress. koParkActiveSeat must
    // treat resumeTurn as in-turn (unlike the between-turns checkup park) so
    // the board still shows an owner. Crafted like the tie test below; a real
    // evolve produces this exact pending shape.
    const base = turnOneState(); // turn 1 = p1's (firstPlayer), a real board
    const state: GameState = {
      ...base,
      phase: { kind: "ko:takePrizes", seat: "p2", count: 1 },
      pending: [
        { kind: "takePrizes", seat: "p2", count: 1 },
        { kind: "resumeTurn", seat: "p1" },
      ],
    };
    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBe("you"); // p1 still owns the turn...
    expect(mine.waitingOn).toBe("opponent"); // ...but p2 owes the prize pick
    expect(mine.pendingDecision).toEqual({ kind: "takePrizes", count: 1 });

    const theirs = projectGameState(state, "p2");
    expect(theirs.activePlayer).toBe("opponent");
    expect(theirs.waitingOn).toBe("you");
  });

  it("keeps the checkup-origin promote park turn-owner-free, then resumes into p2's turn", () => {
    const parked = parkedAtCheckup();
    const state = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(state.phase).toEqual({ kind: "ko:promote", seat: "p2" });

    const mine = projectGameState(state, "p1");
    expect(mine.activePlayer).toBeNull();
    expect(mine.waitingOn).toBe("opponent");
    expect(mine.pendingDecision).toEqual({ kind: "promote" });

    // The promotion resumes the queue's startTurn(p2): turn 4 is p2's, and
    // the owner comes back non-null.
    const resumed = mustApply(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
    const after = projectGameState(resumed, "p1");
    expect(after.turn).toBe(4);
    expect(after.activePlayer).toBe("opponent");
    expect(after.pendingDecision).toBeNull();
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

describe("projectGameState — battle state", () => {
  it("carries damage taken and printed HP on every in-play model, nothing else", () => {
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
      const p2Board = viewer === "p2" ? projection.board.you : projection.board.opponent;
      const p1Board = viewer === "p1" ? projection.board.you : projection.board.opponent;
      // Damage is public info — identical from both sides of the table; hp
      // is the printed max from the pool card.
      expect(p2Board.active?.id).toBe(defenderUid);
      expect(p2Board.active?.battle).toEqual({
        damage: 30,
        hp: 120,
        conditions: { rotation: "none", poisonDamage: 0, burned: false },
      });
      expect(p1Board.active?.battle).toEqual(pristineBattle(120));
      // Battle rides on exactly the in-play top cards: every active/bench
      // model has one; hand, discard and attached cards never do.
      for (const board of [projection.board.you, projection.board.opponent]) {
        for (const model of [board.active, ...board.bench]) {
          expect(model?.battle).toBeDefined();
          for (const attached of [
            ...(model?.attached?.tools ?? []),
            ...(model?.attached?.energies ?? []),
          ]) {
            expect(attached.battle).toBeUndefined();
          }
        }
        for (const model of board.hand) expect(model.battle).toBeUndefined();
      }
      for (const piles of [projection.piles.you, projection.piles.opponent]) {
        for (const model of piles.discard) expect(model.battle).toBeUndefined();
      }
    }
  });

  it("copies special conditions into battle.conditions — a copy, never an alias", () => {
    const conditioned = { rotation: "asleep", poisonDamage: 20, burned: true } as const;
    const state = setConditions(turnOneState(), "p1", conditioned);

    const mine = projectGameState(state, "p1");
    expect(mine.board.you.active?.battle?.conditions).toEqual(conditioned);
    // Conditions are table facts — the opponent sees the same ones.
    const theirs = projectGameState(state, "p2");
    expect(theirs.board.opponent.active?.battle?.conditions).toEqual(conditioned);

    // A consumer mutating the projection must never reach the engine state:
    // the projected object is a fresh copy, not the state's own reference.
    expect(mine.board.you.active?.battle?.conditions).not.toBe(state.players.p1.active?.conditions);
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
    // The placeholder is the one in-play model without battle state (the
    // full-model equality above pins the absence); the real Pokémon keeps
    // its own.
    expect(projection.board.you.bench[1]?.battle).toEqual(pristineBattle(60));
  });
});

describe("projectGameState — the persistent zones (M4 slice 3)", () => {
  /** p1 on turn 2 (p2 went first, passed) holding Beach Court + Bravery
      Charm via test surgery, on STADIUM_TOOL_DECK boards. */
  function stadiumToolState(): GameState {
    let state = driveSetup(
      SEED,
      { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-167", 1);
    return handFromDeck(state, "p1", "sv02-173", 1);
  }

  it("projects no stadium until one is played, then the same public card for BOTH viewers", () => {
    const state = stadiumToolState();
    expect(projectGameState(state, "p1").board.stadium).toBeNull();
    const uid = handUid(state, "p1", "sv01-167");
    const played = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    for (const seat of ["p1", "p2"] as const) {
      const stadium = projectGameState(played, seat).board.stadium;
      expect(stadium?.id).toBe(uid); // engine uid = animation identity
      expect(stadium?.cardId).toBe("sv01-167");
      expect(stadium?.type).toBe("stadium");
      expect(stadium?.name).toBe("Beach Court");
    }
  });

  it("battle.hp reads the CONTINUOUS max HP: Bravery Charm raises a Basic's by 50", () => {
    const state = stadiumToolState();
    const before = projectGameState(state, "p1").board.you.active?.battle?.hp;
    const charm = handUid(state, "p1", "sv02-173");
    const attached = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    }).state;
    const active = projectGameState(attached, "p1").board.you.active;
    expect(before).not.toBeNull();
    if (before == null) throw new Error("unreachable");
    expect(active?.battle?.hp).toBe(before + 50);
    // The Tool itself rides along as an attached face-up model.
    expect(active?.attached?.tools.map((tool) => tool.id)).toEqual([charm]);
  });
});

// The whole point of the P4 split: the server-side engine redactor (redactGame)
// + this client adapter (projectionFromRedacted) must reconstruct EXACTLY the
// board the local projectGameState produces. This equivalence is the guard
// against the two redactors drifting: the round-trip is byte-for-byte the local
// projection — same card models, image URLs, battle rows, hidden backs, piles
// and phase-derived fields — INCLUDING a `mayDraw` effect:choose park now that
// its redacted prompt crosses the wire answerer-only (2b-iii-a). The prompt
// kinds without an online dialog yet (chooseCards/attachCards/…) are still
// stripped to null, so a round-trip over one of THOSE parks would differ (the
// local projection keeps the full prompt) — this block stays scoped to states
// whose prompt round-trips.
describe("projectionFromRedacted — the wire round-trip equals the local projection", () => {
  it("reconstructs a turn:action board identically, for both viewers", () => {
    const state = turnOneState();
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(state, seat))).toEqual(
        projectGameState(state, seat),
      );
    }
  });

  it("reconstructs the setup barrier identically (opponent placements as backs)", () => {
    const state = placedNotRevealed();
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(state, seat))).toEqual(
        projectGameState(state, seat),
      );
    }
  });

  it("ignores the 3b ability/trainer lists — a populated turn:action still equals", () => {
    // Chien-Pao ex (Shivery Chill) as p1's Active makes the wire turn:action carry
    // a non-empty ability list; like attacks/retreat (2b-i/ii) it never enters the
    // playmat projection, so the round-trip still equals the local one for both
    // viewers (the guard against those action lists leaking into the board).
    let state = driveSetup(3, { p1: ABILITY_DECK, p2: ABILITY_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p1", "sv02-061");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → p1's turn 2
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.abilities.length).toBeGreaterThan(0); // else this proves nothing
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(state, seat))).toEqual(
        projectGameState(state, seat),
      );
    }
  });

  it("ignores the 3b-ii Rare Candy pairings — a populated turn:action still equals", () => {
    // A Rare Candy + a matching Stage 2 in p1's hand on their turn 3 makes the wire
    // turn:action carry a non-empty pairing list. Like the ability/trainer lists it
    // feeds a HUD dialog, never the playmat, so the round-trip must still equal the
    // local projection for both viewers.
    let state = driveSetup(
      4,
      { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
      { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
    );
    while (state.turn < 3) {
      if (state.phase.kind !== "turn:action") throw new Error("expected turn:action");
      state = mustApply(state, { type: "endTurn", seat: state.phase.seat }).state;
    }
    state = handFromDeck(state, "p1", "sv01-191", 1);
    state = handFromDeck(state, "p1", "fix-stage2", 1);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.rareCandy.length).toBeGreaterThan(0); // else this proves nothing
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(state, seat))).toEqual(
        projectGameState(state, seat),
      );
    }
  });

  it("reconstructs a mayDraw effect:choose park identically, for both viewers", () => {
    // Drive Ortega to its "your opponent may draw a card" park — the one effect
    // prompt now on the wire (2b-iii-a). The answerer is p2 (the non-controller),
    // so the round-trip must reproduce both phaseViewOf's decision for p2 AND its
    // withheld null for p1, plus the whole board.
    let state = driveSetup(
      20260722,
      { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → p1's turn 2
    state = handFromDeck(state, "p1", "sv03-190", 1); // Ortega
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv03-190"),
    }).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the chooseCards pick park");
    }
    const asked = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [parked.phase.prompt.candidates[0] as string] },
    }).state;
    if (asked.phase.kind !== "effect:choose" || asked.phase.prompt.kind !== "mayDraw") {
      throw new Error("expected the mayDraw park");
    }
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(asked, seat))).toEqual(
        projectGameState(asked, seat),
      );
    }
  });

  it("reconstructs the public-ref effect prompts for the ANSWERER's view (2b-iii-b)", () => {
    // choosePokemon / choosePokemonMulti / moveEnergy / discardEnergy are
    // CONTROLLER-answered, so redactedPromptOf is STRICTER than phaseViewOf (which
    // keeps the prompt for both viewers): the wire delivers it to the controller
    // (p1) alone. So the round-trip holds for the ANSWERER's view — synthesized
    // over a real board like redact.test.ts's effect-prompt cases, since driving
    // four real cards adds nothing the reconstruction pin needs. The opponent's
    // view is DELIBERATELY not equal (its prompt is withheld on the wire).
    const CONT: EffectContinuation = {
      pendingOp: { op: "opponentMayDraw", count: 1 },
      rest: [],
      ctx: { seat: "p1" },
    };
    const active = (seat: Seat): PokemonRef => ({ seat, spot: { spot: "active" } });
    const bench0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const prompts: EffectPrompt[] = [
      {
        kind: "choosePokemon",
        candidates: [active("p1"), active("p2")],
        note: "Choose a Pokémon.",
      },
      // 🆕🆕 D359 — **THE SAME KIND CARRYING `upTo`, AND IT IS HERE BECAUSE THIS
      // FILE IS THE SITE D358's PRICE DID NOT NAME.** That slice bought the
      // decline and counted the engine and the wire; `projection.ts` rebuilds this
      // prompt field by field on the way BACK and would have silently rebuilt a
      // park with a printed ceiling as a MANDATORY one — the dialog on the far
      // side offering neither the decline nor any middle quantity. Both shapes are
      // here on purpose, exactly as the `moveEnergy` pair below: the arm above
      // pins that a prompt WITHOUT the field round-trips to a byte-identical
      // object (no `upTo: undefined` on either side), and this one pins that a
      // prompt WITH it does not lose it. `toEqual` is what makes both directions
      // load-bearing.
      {
        kind: "choosePokemon",
        candidates: [active("p1"), active("p2")],
        upTo: 2,
        note: "Attach up to 2 Energy to which of your Pokémon?",
      },
      {
        kind: "choosePokemonMulti",
        candidates: [active("p2"), bench0],
        min: 2,
        max: 2,
        declinable: true,
        note: "Choose 2 Pokémon.",
      },
      {
        kind: "moveEnergy",
        movable: [{ uid: "e1", from: active("p1") }],
        destinations: [active("p1"), bench0],
        max: 1,
        note: "Move an Energy.",
      },
      // D226 — the SAME kind carrying `anySource` (N's Plan's printed plural).
      // Both shapes are here on purpose: the rider is OPTIONAL, so the arm above
      // pins that a prompt WITHOUT it still round-trips to a byte-identical object
      // (no `anySource: undefined` appearing on either side), and this one pins
      // that a prompt WITH it does not silently lose it — which would re-impose
      // the single-source coupling on the client while the server allowed the
      // wider answer. `toEqual` below is what makes both directions load-bearing.
      {
        kind: "moveEnergy",
        movable: [
          { uid: "e1", from: bench0 },
          { uid: "e2", from: { seat: "p1", spot: { spot: "bench", index: 1 } } },
        ],
        destinations: [active("p1")],
        max: 2,
        anySource: true,
        note: "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon.",
      },
      // 🆕 D441 — the SAME kind carrying `min` (Castform's printed "Move ALL
      // Energy"). Here for the rider's reason above, verbatim: the floor is
      // OPTIONAL, so the first arm pins that a prompt without it rebuilds
      // byte-identically and this one pins that a prompt with it does not lose it —
      // which would re-grant the client a decline the print refuses.
      {
        kind: "moveEnergy",
        movable: [
          { uid: "e1", from: active("p1") },
          { uid: "e2", from: active("p1") },
        ],
        destinations: [bench0],
        max: 2,
        min: 2,
        note: "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
      // 🆕🆕 D442 — the SAME kind carrying `anyDest` (Kilowattrel's printed "in any
      // way you like"). Here for the two riders' reason above, verbatim: it is
      // OPTIONAL, so the first arm pins that a prompt without it rebuilds
      // byte-identically and this one pins that a prompt with it does not lose it —
      // which would re-impose the single-DESTINATION coupling on the client and
      // render the coupled wizard for a spread the server accepts. Two benched
      // destinations, because a spread over one is not a spread.
      {
        kind: "moveEnergy",
        movable: [
          { uid: "e1", from: active("p1") },
          { uid: "e2", from: active("p1") },
        ],
        destinations: [bench0, { seat: "p1", spot: { spot: "bench", index: 1 } }],
        max: 2,
        min: 2,
        anyDest: true,
        note: "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
      },
      {
        kind: "discardEnergy",
        discardable: [{ uid: "e1", from: active("p2") }],
        scope: { kind: "total", count: 1 },
        note: "Discard an Energy.",
      },
      // D157 — `chooseAttack` joins this family and not the hidden-candidate one,
      // because its candidates are the printed attacks of a FACE-UP Active: public
      // to both players, so the redactor resolves nothing out of a private zone
      // and the answerer gate is a convenience rather than the barrier it is for a
      // deck search. It is nonetheless the ONE arm here that carries a
      // server-resolved LABEL, and that is a gap in the wire rather than a reveal:
      // an attack INDEX resolves against nothing the client holds (`RedactedCard`
      // has no attack rows, and `RedactedAttack[]` is the viewer's OWN Active
      // only). The round trip is therefore a rebuild, not a recovery.
      {
        kind: "chooseAttack",
        candidates: [
          { index: 0, name: "Bite" },
          { index: 1, name: "Flame" },
        ],
        note: "Choose 1 of fix-attacker's attacks — it can't use that attack next turn.",
      },
    ];
    for (const prompt of prompts) {
      const state: GameState = {
        ...turnOneState(),
        phase: { kind: "effect:choose", seat: "p1", prompt, cont: CONT },
      };
      // The controller (p1 — the answerer) round-trips exactly, prompt included.
      expect(projectionFromRedacted(redactGame(state, "p1"))).toEqual(
        projectGameState(state, "p1"),
      );
      // The opponent (p2) does NOT: the wire withholds the prompt (pendingDecision
      // null) where the local projection keeps it — the answerer gate, by design.
      expect(projectionFromRedacted(redactGame(state, "p2")).pendingDecision).toBeNull();
      expect(projectGameState(state, "p2").pendingDecision).not.toBeNull();
    }
  });

  it("reconstructs the hidden-candidate effect prompts for the ANSWERER's view (2b-iii-c)", () => {
    // chooseCards / attachCards carry a RedactedCard per candidate (the revealed
    // deck cards). The reconstruction recovers the engine uids from `c.id`, so the
    // answerer (controller) round-trip still equals the local projection exactly,
    // even though the wire shape (RedactedCard[]) differs from the engine's
    // (string[]). The searched deck uids are real p1 deck uids so the identities
    // resolve; the opponent view stays withheld (its prompt is null).
    const CONT: EffectContinuation = {
      pendingOp: { op: "opponentMayDraw", count: 1 },
      rest: [],
      ctx: { seat: "p1" },
    };
    const base = turnOneState();
    const deckUids = base.players.p1.deck.slice(0, 2);
    const active: PokemonRef = { seat: "p1", spot: { spot: "active" } };
    const bench0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const prompts: EffectPrompt[] = [
      { kind: "chooseCards", candidates: deckUids, min: 0, max: 1, dest: "hand", note: "Search." },
      // maxPerTarget present on one, absent on the other — both must round-trip.
      {
        kind: "attachCards",
        candidates: deckUids,
        targets: [active, bench0],
        max: 2,
        maxPerTarget: 1,
        note: "Attach.",
      },
      {
        kind: "attachCards",
        candidates: deckUids,
        targets: [active],
        max: 2,
        note: "Attach anywhere.",
      },
      // 🆕 D457 — the THIRD shape: `oneTarget` present, `maxPerTarget` absent. The
      // two keys are spread independently on both sides of the wire, so a mirror
      // that carried one and dropped the other round-trips for every prompt above
      // and fails here — which is the only place that difference is observable.
      {
        kind: "attachCards",
        candidates: deckUids,
        targets: [active, bench0],
        max: 2,
        oneTarget: true,
        note: "Attach them to 1 of your Pokémon.",
      },
    ];
    for (const prompt of prompts) {
      const state: GameState = {
        ...base,
        phase: { kind: "effect:choose", seat: "p1", prompt, cont: CONT },
      };
      expect(projectionFromRedacted(redactGame(state, "p1"))).toEqual(
        projectGameState(state, "p1"),
      );
      expect(projectionFromRedacted(redactGame(state, "p2")).pendingDecision).toBeNull();
      expect(projectGameState(state, "p2").pendingDecision).not.toBeNull();
    }
  });

  it("🆕🆕 D426 — an OPPONENT-ANSWERED hidden-candidate park round-trips for BOTH viewers", () => {
    // 🛑 **THE FIRST PROMPT IN THIS FILE THAT IS BOTH `answerer`-ROUTED AND
    // HIDDEN-CANDIDATE, AND THAT COMBINATION IS THE WHOLE CASE.** Every other
    // `chooseCards` park is CONTROLLER-answered, so `phaseViewOf` keeps the
    // decision for BOTH local viewers while the wire withholds it from one — the
    // asymmetry the two cases above assert on purpose. Here `phase.answerer` is
    // set, so the LOCAL projection withholds it too, and the wire round-trip is an
    // identity on BOTH sides for the first time.
    //
    // ⚠️ **WHAT WOULD BREAK IT IS A CONSUMER THAT DERIVES "WHOSE PROMPT IS THIS"
    // FROM THE ACTIVE SEAT** rather than reading `answerer` — D425's finding, one
    // field over. `projectionFromRedacted` never sees the phase's seats at all
    // (`waitingOn` arrives viewer-relative off `phaseViewOf`, server-side), and
    // this equality is what says so: an implementation that recomputed it from
    // `activePlayer` would hand the ATTACKER the dialog and disagree here.
    //
    // The candidates are P2's REAL hand uids, so a build that leaked them would
    // resolve real identities into P1's snapshot rather than failing to resolve.
    const CONT: EffectContinuation = {
      pendingOp: { op: "opponentDiscardsFromHand", count: 2 },
      rest: [],
      ctx: { seat: "p1" },
    };
    const base = turnOneState();
    const oppHand = base.players.p2.hand.slice(0, 3);
    expect(oppHand.length).toBe(3); // more than `min`, or the engine would not park
    const state: GameState = {
      ...base,
      phase: {
        kind: "effect:choose",
        seat: "p1",
        answerer: "p2",
        prompt: {
          kind: "chooseCards",
          candidates: oppHand,
          min: 2,
          max: 2,
          dest: "discard",
          note: "Discard 2 cards from your hand.",
        },
        cont: CONT,
      },
    };
    // BOTH viewers round-trip exactly — the answerer WITH the prompt, the actor
    // with the same withheld null on both surfaces.
    for (const seat of ["p1", "p2"] as const) {
      expect(projectionFromRedacted(redactGame(state, seat))).toEqual(
        projectGameState(state, seat),
      );
    }
    expect(projectGameState(state, "p1").pendingDecision).toBeNull();
    expect(projectGameState(state, "p2").pendingDecision?.kind).toBe("effectChoose");
    // …and the ACTOR's whole wire snapshot names none of the opponent's cards.
    // Quoted, because a uid like `p2#4` is a PREFIX of `p2#42`.
    const wire = JSON.stringify(redactGame(state, "p1"));
    for (const uid of oppHand) expect(wire, uid).not.toContain(`"${uid}"`);
  });
});
