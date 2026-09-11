// Pure-logic suite (node env): real games driven through the engine's public
// API + its test fixtures, REDACTED for each seat. redactGame is the
// authoritative server-side hidden-information filter (P4) — these tests pin its
// contract card-for-card and, above all, that no opponent-private card ever
// crosses into a viewer's snapshot.

import { describe, expect, it } from "vitest";
import {
  EMPTY_CARD_ID,
  HIDDEN_CARD_ID,
  HIDDEN_CARD_NAME,
  type RedactedGame,
} from "@luminous/schema";
import { rareCandyOptions } from "./cardplay";
import type { EffectContinuation, EffectPrompt } from "./interpreter";
import { redactGame } from "./redact";
import {
  ABILITY_DECK,
  MIXED_DECK,
  RARE_CANDY_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  activeUid,
  attachFromDeck,
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
  state = mustApply(state, {
    type: "chooseFirstPlayer",
    seat: state.phase.coinWinner,
    first: "p1",
  }).state;
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
  const card = (c: {
    id: string;
    attached?: { tools: { id: string }[]; energies: { id: string }[] };
  }) => {
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
    state = setConditions(state, "p1", { rotation: "asleep", poisonDamage: 20, burned: true, confusionDamage: 30 });
    const game = redactGame(state, "p1");
    const active = game.board.you.active;
    if (active === null) throw new Error("expected an active");
    expect(active.battle).toEqual({
      damage: 30,
      hp: expect.any(Number),
      conditions: { rotation: "asleep", poisonDamage: 20, burned: true, confusionDamage: 30 },
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
    expect(redactGame(state, "p2")).toMatchObject({
      activePlayer: "opponent",
      waitingOn: "opponent",
    });
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

describe("redactGame — the redacted phase (the action-routing discriminant)", () => {
  it("carries turn:action while a turn runs (no attacks for an attackless Active)", () => {
    // turnOneState's Actives are fix-basic-1 — a body with no printed attacks and
    // retreat cost 1; p1's Active has no energy attached, so retreat can't be paid.
    expect(redactGame(turnOneState(), "p1").phase).toEqual({
      kind: "turn:action",
      attacks: [],
      retreat: { cost: 1, can: false },
      // fix-basic-1 has no ability; MIXED_DECK's fix-item is unauthored, so no
      // playable-trainer row either (a Tool/unauthored Trainer is never offered),
      // and no Rare Candy in that deck at all.
      abilities: [],
      trainers: [],
      rareCandy: [],
      // D210 — no Stadium is in play in this fixture, so the §7.3 offer is null.
      stadiumAbility: null,
    });
  });

  it("carries setup:place with VIEWER-RELATIVE ready flags", () => {
    const state = placedNotRevealed(); // p1 placed + ready, p2 not
    // From p1's view, "you" (p1) is ready; from p2's view, "opponent" (p1) is.
    expect(redactGame(state, "p1").phase).toEqual({
      kind: "setup:place",
      ready: { you: true, opponent: false },
    });
    expect(redactGame(state, "p2").phase).toEqual({
      kind: "setup:place",
      ready: { you: false, opponent: true },
    });
  });

  it("carries setup:chooseFirst at the game's start", () => {
    const fresh = mustCreate(SEED, DECKS).state;
    if (fresh.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    expect(redactGame(fresh, "p1").phase).toEqual({ kind: "setup:chooseFirst" });
  });

  it("mirrors a gameOver phase (details ride on `outcome`)", () => {
    const base = turnOneState();
    const state: GameState = {
      ...base,
      phase: { kind: "gameOver", outcome: { result: "win", winner: "p1", reason: "prizesTaken" } },
    };
    expect(redactGame(state, "p1").phase).toEqual({ kind: "gameOver" });
  });
});

// The online turn HUD (increment 2b-i) renders attack buttons off the redacted
// phase, so the redactor computes payability server-side over the full state the
// wire withholds. These pin that computation the way GameHud's TurnPanel does.
describe("redactGame — turn:action attack options (the online HUD's playability)", () => {
  const ATTACKER_DECK = deckOf({
    "fix-attacker": 30,
    "fix-fire-energy": 20,
    "fix-water-energy": 10,
  });
  const DEFENDER_DECK = deckOf({ "fix-wall": 40, "fix-water-energy": 20 });
  // Seed borrowed from attack.test.ts: no mulligans for this pair, both actives
  // in the opening hands.
  const ATTACK_SEED = 11;

  /** p1's fix-attacker Active with `fire` Fire energy attached; `advance` runs
      the two end-turns that carry play to p1's turn 3 (past the §4 ban). */
  function attackerBoard(fire: number, advance: boolean): GameState {
    let state = driveSetup(
      ATTACK_SEED,
      { p1: ATTACKER_DECK, p2: DEFENDER_DECK },
      { first: "p1", active: { p1: "fix-attacker", p2: "fix-wall" } },
    );
    if (fire > 0) state = attachFromDeck(state, "p1", "fix-fire-energy", fire);
    if (advance) {
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    }
    return state;
  }

  it("lists the Active's attacks with per-attack payability (§8.2)", () => {
    // One Fire energy on turn 3: the Colorless-cost attacks are payable, the
    // two-symbol Flame is not, the costless Yawn always is.
    const phase = redactGame(attackerBoard(1, true), "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks).toEqual([
      { index: 0, name: "Bite", cost: ["Colorless"], damage: "30", playable: true },
      { index: 1, name: "Flame", cost: ["Fire", "Colorless"], damage: "60", playable: false },
      { index: 2, name: "Yawn", cost: [], damage: null, playable: true },
      { index: 3, name: "Rage", cost: ["Colorless"], damage: "10+", playable: true },
      { index: 4, name: "Fury", cost: ["Colorless"], damage: null, playable: true },
      { index: 5, name: "Bounty", cost: ["Colorless"], damage: "40+", playable: true },
    ]);
  });

  it("gives the NON-acting viewer no attack list and no retreat (only the turn owner acts)", () => {
    // p1's turn 3; p2 sees the same turn:action phase but carries no attacks, a
    // null retreat and none of the 3b/3b-ii option lists.
    const phase = redactGame(attackerBoard(1, true), "p2").phase;
    expect(phase).toEqual({
      kind: "turn:action",
      attacks: [],
      retreat: null,
      abilities: [],
      trainers: [],
      rareCandy: [],
      // D210 — and no §7.3 Stadium offer either: it is the acting seat's alone,
      // exactly like `retreat`. (Null here for two independent reasons — the
      // viewer is not the actor AND no Stadium is in play — which is why the
      // discriminating version of this claim lives in
      // `redactStadiumAbility.test.ts`, with a Stadium actually on the board.)
      stadiumAbility: null,
    });
  });

  it("marks every attack unplayable on the §4 first turn, even a payable one", () => {
    // Turn 1 with a Fire energy already attached: Bite would be payable, but the
    // first-turn ban folds into `playable` for the whole list.
    const phase = redactGame(attackerBoard(1, false), "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks.every((a) => !a.playable)).toBe(true);
    // The turn counter confirms this is the going-first player's first turn.
    expect(redactGame(attackerBoard(1, false), "p1").turn).toBe(1);
  });

  it("marks every attack unplayable while the Active is immobilized (§12)", () => {
    const asleep = setConditions(attackerBoard(1, true), "p1", { rotation: "asleep" });
    const phase = redactGame(asleep, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks.every((a) => !a.playable)).toBe(true);
  });
});

// The online turn HUD (increment 2b-ii) also renders a retreat control off the
// redacted phase, so the redactor computes the cost + a `can` gate server-side
// over the full state the wire withholds. These pin it the way GameHud's
// TurnPanel computes `canRetreat`.
describe("redactGame — turn:action retreat option (the online HUD's retreat gate)", () => {
  /** turnOneState with `energy`-many deck cards moved onto p1's Active — the
      attach a fixture otherwise can't express (mirrors the attachment test above). */
  function withEnergy(state: GameState, energy: number): GameState {
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected active");
    const uids = state.players.p1.deck.slice(0, energy);
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, energy: [...active.energy, ...uids] },
          deck: state.players.p1.deck.slice(energy),
        },
      },
    };
  }

  function retreatOf(state: GameState) {
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    return phase.retreat;
  }

  it("is payable when enough energy is attached and the Bench is non-empty", () => {
    // fix-basic-1 costs 1; one attached energy + the fix-basic-0 Bench = payable.
    expect(retreatOf(withEnergy(turnOneState(), 1))).toEqual({ cost: 1, can: true });
  });

  it("is unpayable with too little attached energy", () => {
    // No energy on the Active — cost 1 can't be paid.
    expect(retreatOf(turnOneState())).toEqual({ cost: 1, can: false });
  });

  it("is blocked while the Active is immobilized (§12), even with the energy", () => {
    const asleep = setConditions(withEnergy(turnOneState(), 1), "p1", { rotation: "asleep" });
    expect(retreatOf(asleep)).toEqual({ cost: 1, can: false });
  });

  it("is blocked with an empty Bench (nothing to promote to)", () => {
    const base = withEnergy(turnOneState(), 1);
    const noBench: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, bench: [] } },
    };
    expect(retreatOf(noBench)).toEqual({ cost: 1, can: false });
  });

  it("is blocked once the player has already retreated this turn", () => {
    const base = withEnergy(turnOneState(), 1);
    const retreated: GameState = { ...base, allowances: { ...base.allowances, retreated: true } };
    expect(retreatOf(retreated)).toEqual({ cost: 1, can: false });
  });
});

// The online turn HUD (increment 3b) renders activated-Ability + non-Stadium
// Trainer buttons off the redacted phase, so the redactor folds each option's
// playability server-side over the full state the wire withholds (the own hand,
// prize counts, the Stadium owner) EXACTLY the way GameHud's usableAbilities /
// playableTrainers do — and emits them ONLY to the acting viewer.
describe("redactGame — turn:action ability options (increment 3b)", () => {
  /** p2 first → p1's turn 2, with Chien-Pao ex (its activated "Shivery Chill")
      surgically forced as p1's Active (the ABILITY_DECK's fixture ability card). */
  function abilityBoard(): GameState {
    let state = driveSetup(3, { p1: ABILITY_DECK, p2: ABILITY_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p1", "sv02-061");
    return mustApply(state, { type: "endTurn", seat: "p2" }).state;
  }

  it("lists the acting viewer's own activated abilities, playability folded", () => {
    const phase = redactGame(abilityBoard(), "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    // Shivery Chill (search up to 2 Basic {W} Energy → hand) has no hand cost and
    // always has a legal use, so it is enabled with no greying reason; the target
    // is the seatless PokemonTarget useAbility dispatches back.
    expect(phase.abilities).toEqual([
      {
        target: { spot: "active" },
        abilityName: "Shivery Chill",
        label: "Shivery Chill · Chien-Pao ex (Active)",
        disabled: false,
        reason: null,
      },
    ]);
  });

  it("gives the NON-acting viewer no ability list (only the turn owner acts)", () => {
    const phase = redactGame(abilityBoard(), "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    // The acting seat's own hand + board decide the list, so it must never cross
    // to the opponent — their view of the same turn:action carries none.
    expect(phase.abilities).toEqual([]);
  });

  it("greys an activeOnly ability sitting on the Bench (self-evident, no reason)", () => {
    // A second Chien-Pao ex benched: Shivery Chill is Active-only, so its Bench
    // copy is a disabled row with no tooltip (the §9 gate is self-evident). It
    // lands at Bench index 1 — setActiveFromDeck displaced the opening Active to
    // Bench 0 first.
    let state = driveSetup(3, { p1: ABILITY_DECK, p2: ABILITY_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p1", "sv02-061");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv02-061", 1);
    const benchUid = handUid(state, "p1", "sv02-061");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: benchUid }).state;
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.abilities).toContainEqual({
      target: { spot: "bench", index: 1 },
      abilityName: "Shivery Chill",
      label: "Shivery Chill · Chien-Pao ex (Bench 2)",
      disabled: true,
      reason: null,
    });
  });
});

/** p1 first, both Actives fix-basic-1, driven to p1's turn 3 — their first
    Rare-Candy-legal turn (§4/§7.1 bans it on their own first turn). `benchP1`
    adds evolvable benched copies (a second dialog option). */
function rareCandyBoard({ benchP1 = 0 }: { benchP1?: number } = {}): GameState {
  let state = driveSetup(
    4,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: Array.from({ length: benchP1 }, () => "fix-basic-1") },
    },
  );
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected phase ${state.phase.kind} while passing to turn 3`);
    }
    state = mustApply(state, { type: "endTurn", seat: state.phase.seat }).state;
  }
  return state;
}

/** Pull a Rare Candy + the fix-stage2 it places into p1's hand; returns
    [state, stage2Uid]. */
function rareCandyHand(state: GameState): [GameState, string] {
  let next = handFromDeck(state, "p1", "sv01-191", 1);
  next = handFromDeck(next, "p1", "fix-stage2", 1);
  return [next, handUid(next, "p1", "fix-stage2")];
}

// The non-Stadium Trainer half of increment 3b — the acting viewer's Item/
// Supporter hand cards, deduped, each with folded playability. Stadiums are
// excluded (the board drag); Rare Candy is included but FLAGGED (3b-ii), its row
// opening the dialog the next block's pairings feed.
describe("redactGame — turn:action trainer options (increment 3b)", () => {
  it("lists Item/Supporter hand cards with folded playability + greying reasons", () => {
    // p1's turn 2 (Supporters legal), p2 with no Bench: Professor's Research is a
    // clean enabled Supporter; Boss's Orders (gust an opponent Benched Pokémon)
    // whiffs into the empty Bench, so it greys with "No legal target".
    let state = driveSetup(1, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-189", 1);
    state = handFromDeck(state, "p1", "sv02-172", 1);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.trainers).toContainEqual({
      uid: handUid(state, "p1", "sv01-189"),
      name: "sv01-189",
      disabled: false,
      reason: null,
      rareCandy: false,
    });
    expect(phase.trainers).toContainEqual({
      uid: handUid(state, "p1", "sv02-172"),
      name: "sv02-172",
      disabled: true,
      reason: "No legal target",
      rareCandy: false,
    });
  });

  it("disables a Supporter on the §4 first turn (self-evident, no reason)", () => {
    // p1 goes first: turn 1 is p1's, so a Supporter is banned — a greyed row with
    // no tooltip (the §4 timing needs none).
    let state = driveSetup(1, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p1" });
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.trainers).toContainEqual({
      uid: handUid(state, "p1", "sv01-189"),
      name: "sv01-189",
      disabled: true,
      reason: null,
      rareCandy: false,
    });
  });

  it("dedupes to one row per distinct card even with copies in hand", () => {
    let state = driveSetup(1, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-189", 2); // two Professor's Research
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.trainers.filter((t) => t.name === "sv01-189")).toHaveLength(1);
  });

  it("gives the NON-acting viewer no trainer list (their hand never crosses here)", () => {
    let state = driveSetup(1, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.trainers).toEqual([]);
  });

  it("omits Stadiums — they play by the board drag, not a button", () => {
    // Beach Court is an authored Stadium; it must NOT appear in the wire trainer
    // list (the 2a moveToAction drag onto the shared slot drives it instead).
    let state = driveSetup(1, { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.trainers.some((t) => t.name === "sv01-167")).toBe(false);
  });

  it("flags Rare Candy — its row opens a dialog rather than playing on click", () => {
    const state = rareCandyHand(rareCandyBoard())[0];
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    // It IS offered (3b-ii — it was omitted while its dialog was deferred), lit,
    // and marked so the client opens the two-step dialog instead of playTrainer.
    expect(phase.trainers).toContainEqual({
      uid: handUid(state, "p1", "sv01-191"),
      name: "Rare Candy",
      disabled: false,
      reason: null,
      rareCandy: true,
    });
  });
});

// The Rare Candy pairings behind that flagged row (increment 3b-ii) — the wire
// mirror of the engine's own `rareCandyOptions`, folded server-side so the online
// dialog can never offer an illegal Basic/Stage-2 pair, and emitted to the acting
// viewer alone.
describe("redactGame — turn:action Rare Candy options (increment 3b-ii)", () => {
  it("lists a legal pairing: the Basic's spot + uid + the matching Stage 2 in hand", () => {
    const [state, stage2Uid] = rareCandyHand(rareCandyBoard());
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    const option = phase.rareCandy.find((o) => o.target.spot === "active");
    // The seatless target the `rareCandy` action dispatches back, the Basic's
    // display identity, and the Stage 2 that skips fix-stage1 (the fixture line
    // is fix-basic-1 → fix-stage1 → fix-stage2 — the bridge need only be in the
    // pool, which is exactly the chain check the client cannot run).
    expect(option?.basicUid).toBe(activeUid(state, "p1"));
    expect(option?.basicName).toBe("fix-basic-1");
    expect(option?.stage2).toContainEqual({ uid: stage2Uid, name: "fix-stage2" });
  });

  it("lists a benched Basic too, by index (the dialog's first pick)", () => {
    const [state] = rareCandyHand(rareCandyBoard({ benchP1: 1 }));
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    // Both the Active and the benched fix-basic-1 are evolvable, so the dialog
    // has a real Basic choice — the bench one addressed by its index.
    expect(phase.rareCandy.map((o) => o.target)).toEqual([
      { spot: "active" },
      { spot: "bench", index: 0 },
    ]);
  });

  it("offers nothing on the §4 first turn, and greys the row to match", () => {
    // p1 goes first, so turn 1 is theirs and Rare Candy is banned (§4/§7.1). The
    // engine's own `rareCandyOptions` returns [] there — so the wire list is empty
    // AND the row is disabled (with no tooltip: the timing is self-evident, the
    // local row's choice). An empty list behind a LIT row would be a dead dialog.
    const [state] = rareCandyHand(
      driveSetup(
        4,
        { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
        { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
      ),
    );
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.rareCandy).toEqual([]);
    expect(phase.trainers).toContainEqual({
      uid: handUid(state, "p1", "sv01-191"),
      name: "Rare Candy",
      disabled: true,
      reason: null,
      rareCandy: true,
    });
  });

  it("gives the NON-acting viewer no pairings (their own board + hand decide them)", () => {
    const [state] = rareCandyHand(rareCandyBoard());
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.rareCandy).toEqual([]);
  });

  it("copies the target rather than aliasing the engine's option (purity)", () => {
    const [state] = rareCandyHand(rareCandyBoard());
    const wire = redactGame(state, "p1").phase;
    if (wire.kind !== "turn:action") throw new Error("expected turn:action");
    const engineOption = rareCandyOptions(state, "p1")[0];
    expect(wire.rareCandy[0]?.target).toEqual(engineOption?.target);
    expect(wire.rareCandy[0]?.target).not.toBe(engineOption?.target);
  });
});

// The online effect:choose dialog (increment 2b-iii-a) reads the redacted prompt
// off the phase, which the redactor sends ONLY to the seat that must answer it —
// a prompt's candidates can be the controller's private deck cards, so the raw
// prompt must never reach the other viewer. These pin that answerer gate the way
// phaseViewOf withholds the local projection's decision.
describe("redactGame — the effect:choose prompt (answerer-only)", () => {
  // The redactor never reads `cont`, so a minimal (unrelated) continuation
  // stands in — this synthesizes the phase over a real board, like the gameOver
  // test above, rather than driving Ortega through the whole engine.
  const CONT: EffectContinuation = {
    pendingOp: { op: "opponentMayDraw", count: 1 },
    rest: [],
    ctx: { seat: "p1" },
  };

  /** p1 (controller) played the card; p2 must ANSWER the "may draw" (Ortega). */
  function mayDrawState(): GameState {
    const base = turnOneState();
    return {
      ...base,
      phase: {
        kind: "effect:choose",
        seat: "p1",
        answerer: "p2",
        prompt: { kind: "mayDraw", count: 1, note: "You may draw a card." },
        cont: CONT,
      },
    };
  }

  it("sends the mayDraw prompt to the answerer (the non-controller)", () => {
    const phase = redactGame(mayDrawState(), "p2").phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase.prompt).toEqual({ kind: "mayDraw", count: 1, note: "You may draw a card." });
  });

  it("withholds the prompt from the controller, who does not answer it", () => {
    const phase = redactGame(mayDrawState(), "p1").phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase.prompt).toBeNull();
  });

  /** A deck-search chooseCards park owed by p1 (the controller). */
  function deckSearchState(): { state: GameState; deckUids: string[] } {
    const base = turnOneState();
    const deckUids = base.players.p1.deck.slice(0, 2);
    return {
      deckUids,
      state: {
        ...base,
        phase: {
          kind: "effect:choose",
          seat: "p1",
          prompt: {
            kind: "chooseCards",
            candidates: deckUids,
            min: 0,
            max: 1,
            dest: "hand",
            note: "Search your deck.",
          },
          cont: CONT,
        },
      },
    };
  }

  it("REVEALS the deck-search candidate identities to the controller (2b-iii-c)", () => {
    // The controller (answerer) sees the searched cards face-up — full identity,
    // keyed by the engine uid the answer dispatches back — plus the bounds/dest.
    const { state, deckUids } = deckSearchState();
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "effect:choose" || phase.prompt?.kind !== "chooseCards") {
      throw new Error("expected a chooseCards prompt");
    }
    expect(phase.prompt.candidates.map((c) => c.id)).toEqual(deckUids);
    for (const card of phase.prompt.candidates) {
      expect(card.cardId).not.toBe(HIDDEN_CARD_ID);
      expect(card.name).not.toBe(HIDDEN_CARD_NAME);
    }
    expect(phase.prompt.min).toBe(0);
    expect(phase.prompt.max).toBe(1);
    expect(phase.prompt.dest).toBe("hand");
  });

  it("WITHHOLDS the deck search from the opponent — no deck uid crosses anywhere", () => {
    // The whole hidden-info barrier: the non-answerer's prompt is null, AND the
    // searched deck uids appear NOWHERE else in their snapshot (their view of both
    // decks is a count). This is the property the answerer gate exists to hold.
    const { state, deckUids } = deckSearchState();
    const game = redactGame(state, "p2");
    if (game.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(game.phase.prompt).toBeNull();
    const ids = new Set(allIds(game));
    for (const uid of deckUids) expect(ids.has(uid)).toBe(false);
  });

  it("REVEALS attachCards candidates to the controller and maps targets to refs", () => {
    const base = turnOneState();
    const deckUids = base.players.p1.deck.slice(0, 2);
    const targets: { seat: Seat; spot: { spot: "active" } | { spot: "bench"; index: number } }[] = [
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ];
    const state: GameState = {
      ...base,
      phase: {
        kind: "effect:choose",
        seat: "p1",
        prompt: {
          kind: "attachCards",
          candidates: deckUids,
          targets,
          max: 2,
          maxPerTarget: 1,
          note: "Attach the revealed Energy.",
        },
        cont: CONT,
      },
    };
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "effect:choose" || phase.prompt?.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    expect(phase.prompt.candidates.map((c) => c.id)).toEqual(deckUids);
    for (const card of phase.prompt.candidates) expect(card.cardId).not.toBe(HIDDEN_CARD_ID);
    expect(phase.prompt.targets).toEqual(targets);
    expect(phase.prompt.max).toBe(2);
    expect(phase.prompt.maxPerTarget).toBe(1);
    // Withheld from the opponent, with none of the candidate uids leaking.
    const opp = redactGame(state, "p2");
    if (opp.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(opp.phase.prompt).toBeNull();
    const oppIds = new Set(allIds(opp));
    for (const uid of deckUids) expect(oppIds.has(uid)).toBe(false);
    // 🆕 D457 — `oneTarget` is ABSENT on this prompt, and absence is asserted
    // rather than assumed: the key has exactly two inhabitants on the wire
    // (`true` and missing), so a mirror that wrote `false` would be spelling
    // "no constraint" a second way.
    expect(phase.prompt).not.toHaveProperty("oneTarget", true);
  });

  it("🆕 D457 — carries attachCards.oneTarget through to the controller, and only to them", () => {
    // The printed *"attach them to 1 of your Pokémon"*: the constraint is on the
    // ANSWER, so the client that composes the answer has to be told. Without this
    // mirror the online dialog offers a second body and the SERVER refuses the
    // result — a dialog contradicting its own validator, which is the failure the
    // `maxPerTarget` mirror above exists to prevent one key over.
    const base = turnOneState();
    const deckUids = base.players.p1.deck.slice(0, 2);
    const state: GameState = {
      ...base,
      phase: {
        kind: "effect:choose",
        seat: "p1",
        prompt: {
          kind: "attachCards",
          candidates: deckUids,
          targets: [
            { seat: "p1", spot: { spot: "active" } },
            { seat: "p1", spot: { spot: "bench", index: 0 } },
          ],
          max: 2,
          oneTarget: true,
          note: "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon.",
        },
        cont: CONT,
      },
    };
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "effect:choose" || phase.prompt?.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    expect(phase.prompt.oneTarget).toBe(true);
    // ⚠️ AND IT DOES NOT DRAG THE SIBLING KEY WITH IT — a mirror that wrote both
    // from one source would cap the batch at one CARD as well as one BODY, which
    // is `max: 1` and not what the card prints.
    expect(phase.prompt.maxPerTarget).toBeUndefined();
    // The opponent still sees nothing at all: a constraint is not a leak channel.
    const opp = redactGame(state, "p2");
    if (opp.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(opp.phase.prompt).toBeNull();
  });
});

// The online effect:choose dialogs (increment 2b-iii-b) render the PUBLIC-REF
// family — choosePokemon / choosePokemonMulti / moveEnergy / discardEnergy —
// whose candidates are in-play refs and attached-Energy uids already public on
// the board. The redactor passes them through as FRESH copies (no alias), still
// gated answerer-only. Unlike mayDraw these are CONTROLLER-answered, so the
// prompt reaches the controller (phase.seat) and is withheld from the opponent.
describe("redactGame — the public-ref effect prompts (answerer-only, 2b-iii-b)", () => {
  const CONT: EffectContinuation = {
    pendingOp: { op: "opponentMayDraw", count: 1 },
    rest: [],
    ctx: { seat: "p1" },
  };
  const P1_ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
  const P2_ACTIVE = { seat: "p2", spot: { spot: "active" } } as const;
  const P1_BENCH0 = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;

  /** turnOneState with a synthesized controller-answered effect:choose park
      (the redactor never reads `cont`, so a minimal one stands in). */
  function withPrompt(prompt: EffectPrompt): GameState {
    return { ...turnOneState(), phase: { kind: "effect:choose", seat: "p1", prompt, cont: CONT } };
  }
  function promptFor(prompt: EffectPrompt, seat: Seat) {
    const phase = redactGame(withPrompt(prompt), seat).phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return phase.prompt;
  }

  it("passes a choosePokemon prompt through to the controller, verbatim", () => {
    const prompt: EffectPrompt = {
      kind: "choosePokemon",
      candidates: [P1_ACTIVE, P2_ACTIVE],
      note: "Choose a Pokémon.",
    };
    expect(promptFor(prompt, "p1")).toEqual(prompt);
  });

  it("passes a choosePokemonMulti prompt through with its bounds + declinable", () => {
    const prompt: EffectPrompt = {
      kind: "choosePokemonMulti",
      candidates: [P2_ACTIVE, P1_BENCH0],
      min: 2,
      max: 2,
      declinable: true,
      note: "Choose 2 Pokémon.",
    };
    expect(promptFor(prompt, "p1")).toEqual(prompt);
  });

  it("passes a moveEnergy prompt through (movable pairs + destinations)", () => {
    const prompt: EffectPrompt = {
      kind: "moveEnergy",
      movable: [{ uid: "e1", from: P1_ACTIVE }],
      destinations: [P1_ACTIVE, P1_BENCH0],
      max: 1,
      note: "Move an Energy.",
    };
    expect(promptFor(prompt, "p1")).toEqual(prompt);
  });

  it("🆕 D441 — passes a moveEnergy prompt's FLOOR through, and its absence too", () => {
    // Both shapes, for `anySource`'s reason exactly: the field is OPTIONAL, so the
    // arm above pins that a prompt WITHOUT it round-trips byte-identically (no
    // `min: undefined` appearing on either side), and this one pins that a prompt
    // WITH it does not silently lose it — which would hand the online player a
    // "Move none" button on Castform's printed "Move all Energy" and let the wire
    // validator accept the empty answer. D358's defect on the other prompt.
    const prompt: EffectPrompt = {
      kind: "moveEnergy",
      movable: [
        { uid: "e1", from: P1_ACTIVE },
        { uid: "e2", from: P1_ACTIVE },
      ],
      destinations: [P1_BENCH0],
      max: 2,
      min: 2,
      note: "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
    };
    expect(promptFor(prompt, "p1")).toEqual(prompt);
  });

  it("passes a discardEnergy prompt through with its scope", () => {
    const prompt: EffectPrompt = {
      kind: "discardEnergy",
      discardable: [
        { uid: "e1", from: P2_ACTIVE },
        { uid: "e2", from: P2_ACTIVE },
      ],
      scope: { kind: "total", count: 1 },
      note: "Discard an Energy.",
    };
    expect(promptFor(prompt, "p1")).toEqual(prompt);
  });

  it("withholds a controller-answered prompt from the opponent (null on the wire)", () => {
    const prompt: EffectPrompt = {
      kind: "choosePokemon",
      candidates: [P1_ACTIVE, P2_ACTIVE],
      note: "Choose a Pokémon.",
    };
    // p1 is the controller/answerer; p2 (the non-answerer) gets null.
    expect(promptFor(prompt, "p1")).not.toBeNull();
    expect(promptFor(prompt, "p2")).toBeNull();
  });

  it("copies the refs/scope rather than aliasing the input prompt (purity)", () => {
    const prompt: EffectPrompt = {
      kind: "moveEnergy",
      movable: [{ uid: "e1", from: P1_ACTIVE }],
      destinations: [P1_BENCH0],
      max: 1,
      note: "Move an Energy.",
    };
    const redacted = promptFor(prompt, "p1");
    if (redacted === null || redacted.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // Structurally equal but not the SAME objects — a consumer mutating the
    // snapshot must not reach back into game state (the copyConditions contract).
    expect(redacted.movable[0]?.from).not.toBe(P1_ACTIVE);
    expect(redacted.destinations[0]).not.toBe(P1_BENCH0);
  });
});

describe("redactGame — the SPECTATOR view (3c-vii)", () => {
  it("hides BOTH hands — the threat is a player watching their own match", () => {
    // The whole point. A seated viewer sees one hand; a spectator sees none, so
    // opening a spectator view of a game you are playing tells you nothing your
    // own seat didn't already.
    const state = turnOneState();
    const game = redactGame(state, "p1", true);
    for (const side of [game.board.you, game.board.opponent]) {
      expect(side.hand.length).toBeGreaterThan(0);
      for (const c of side.hand) {
        expect(c.cardId).toBe(HIDDEN_CARD_ID);
        expect(c.name).toBe(HIDDEN_CARD_NAME);
      }
    }
    // Counts still cross — a hand SIZE is public at the table.
    expect(game.board.you.hand).toHaveLength(state.players.p1.hand.length);
    expect(game.board.opponent.hand).toHaveLength(state.players.p2.hand.length);
  });

  it("LEAKS NOTHING: no uid private to EITHER seat reaches a spectator", () => {
    // The seated tests assert this one-directionally; for a spectator it holds
    // BOTH ways, which is the invariant that makes the view safe to hand out.
    const state = placedNotRevealed();
    for (const side of ["p1", "p2"] as const) {
      const leaked = new Set(allIds(redactGame(state, side, true)));
      for (const seat of ["p1", "p2"] as const) {
        for (const uid of privateUids(state, seat)) {
          expect(leaked.has(uid)).toBe(false);
        }
      }
    }
  });

  it("hides the watched side's OWN setup placements too", () => {
    // A seated viewer sees their own face-down placements because they made
    // them. A spectator made none — and watching from p1's side must not reveal
    // what p1 just benched, or a player could spectate their opponent's side.
    const state = placedNotRevealed();
    const seated = redactGame(state, "p1");
    expect(seated.board.you.active?.cardId).not.toBe(HIDDEN_CARD_ID);
    const watching = redactGame(state, "p1", true);
    expect(watching.board.you.active?.cardId).toBe(HIDDEN_CARD_ID);
    expect(watching.board.you.bench.map((c) => c.cardId)).toEqual([HIDDEN_CARD_ID]);
  });

  it("reveals in-play normally once setup is over — a spectator watches a real board", () => {
    const state = turnOneState();
    const game = redactGame(state, "p1", true);
    expect(game.board.you.active?.cardId).not.toBe(HIDDEN_CARD_ID);
    expect(game.board.opponent.active?.cardId).not.toBe(HIDDEN_CARD_ID);
    // Public zones stay public.
    expect(game.board.you.prizesRemaining).toBe(state.players.p1.prizes.length);
    expect(game.board.you.deckCount).toBe(state.players.p1.deck.length);
  });

  it("withholds EVERY turn:action affordance, including on the actor's own side", () => {
    // The actor lists name cards in a HAND: leaking them would undo the hand
    // redaction above. One `actor = null` gate covers all five, so the next
    // affordance added is withheld by default.
    // A board with real affordances to withhold: p1 on turn 2 holding a
    // Supporter (the trainer-options fixture from 3b).
    let state = driveSetup(1, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const seated = redactGame(state, "p1");
    if (seated.phase.kind !== "turn:action") throw new Error("expected turn:action");
    // The trainer list is the sharpest witness: its rows ARE hand cards, named.
    expect(seated.phase.trainers.length).toBeGreaterThan(0);

    const watching = redactGame(state, "p1", true);
    if (watching.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(watching.phase).toEqual({
      kind: "turn:action",
      attacks: [],
      retreat: null,
      abilities: [],
      trainers: [],
      rareCandy: [],
      // D210 — the §7.3 Stadium offer rides the SAME `actor = null` spectator
      // gate, which is the point of that gate: an affordance added to this arm is
      // withheld by default rather than by someone remembering to withhold it.
      stadiumAbility: null,
    });
  });

  it("withholds the effect:choose prompt from the answerer's own side", () => {
    // A controller-answered park, built the way the 2b-iii-b block does (the
    // redactor never reads `cont`, so a minimal one stands in).
    const prompt: EffectPrompt = { kind: "mayDraw", count: 2, note: "Draw 2 cards?" };
    const cont: EffectContinuation = {
      pendingOp: { op: "opponentMayDraw", count: 1 },
      rest: [],
      ctx: { seat: "p1" },
    };
    const state: GameState = {
      ...turnOneState(),
      phase: { kind: "effect:choose", seat: "p1", prompt, cont },
    };
    const seated = redactGame(state, "p1");
    if (seated.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(seated.phase.prompt).not.toBeNull();

    const watching = redactGame(state, "p1", true);
    if (watching.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(watching.phase.prompt).toBeNull();
  });

  it("keeps the public phase view — a spectator can still follow the game", () => {
    // Withholding is about CARDS, not about who is to move: whose turn it is, the
    // turn number and the outcome are all public at the table.
    const state = turnOneState();
    const seated = redactGame(state, "p1");
    const watching = redactGame(state, "p1", true);
    expect(watching.turn).toBe(seated.turn);
    expect(watching.activePlayer).toBe(seated.activePlayer);
    expect(watching.waitingOn).toBe(seated.waitingOn);
    expect(watching.outcome).toEqual(seated.outcome);
    expect(watching.board.stadium).toEqual(seated.board.stadium);
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
