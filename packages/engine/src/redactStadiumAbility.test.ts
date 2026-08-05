import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { applyAction, programFor } from "./index";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  STADIUM_ABILITY_DECK,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  trainerCard,
} from "./testFixtures";
import type { GameState, Seat } from "./types";

// D210 — the §7.3 SHARED STADIUM's activated ability, projected onto the online
// wire (`turn:action.stadiumAbility`) so the online HUD can offer it at all.
//
// D102 shipped the action (`useStadiumAbility`, cardplay.ts) with no wire surface
// on either half, and D209 established what that cost: Levincia sv09-150 /
// sv10-244 and Spikemuth Gym sv10-169 are Standard-legal (regulation I), are in
// the registry, and reach real online matches because deck load applies no format
// gate — so a player could put one in play, watch it sit there, and never be
// offered its printed effect. A FIDELITY gap, not a soft-lock (both programs park
// on `chooseCards`, dialoged since 2b-iii-c).
//
// This file pins the FOLD, and it pins it against `applyAction` rather than
// against a restatement of `applyAction`'s terms. A projection that merely
// type-checks is the failure mode here: the whole value of `redactedStadiumAbilityOf`
// is that the button and the engine gate cannot disagree, and the only way to
// check that is to ask both.
//
// The four realistic wrong implementations, and where each one dies:
//   (a) offering the Stadium to BOTH seats — "the actor alone" below, driven from
//       BOTH sides of the table so a hard-coded seat dies too;
//   (b) reading the once-per-turn state from the wrong place — "greys once used",
//       plus the re-arm case, which a per-seat misreading gets wrong;
//   (c) dropping the `programPlayable` term — NOT killable against the printed
//       pool, and this file says so out loud rather than shipping a guard that
//       cannot fail (D200/D204/D205's mistake, three times this session). The
//       vacuity is PINNED instead: see the last block.
//   (d) dispatching without the seat — a client-side mutant, killed in
//       `src/features/online/components/OnlineHud.stadiumAbility.dom.test.tsx`.

const BOTH = { p1: STADIUM_ABILITY_DECK, p2: STADIUM_ABILITY_DECK };

/** Setup, then open P1's turn 2 (P2 went first and passed) — no §4 restrictions.
    Borrowed verbatim from `stadiumAbility.test.ts`, which drives the same action
    from the engine side. */
function p1Turn2(seed = 1): GameState {
  return must(applyAction(driveSetup(seed, BOTH, { first: "p2" }), { type: "endTurn", seat: "p2" }));
}

/** Put a Stadium into `seat`'s hand and PLAY it — the real `playTrainer` drag the
    online client already supports, not surgery, so the state under test is one a
    live match actually reaches. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  return must(applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) }));
}

/** The acting seat's offer, or null — the thing the online HUD renders. */
function offerFor(state: GameState, viewer: Seat, spectating = false) {
  const phase = redactGame(state, viewer, spectating).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.stadiumAbility;
}

describe("redactGame — the §7.3 Stadium activation offer, to the ACTOR ALONE", () => {
  it("offers it to the seat whose turn it is and withholds it from the other — from BOTH sides", () => {
    const p1Turn = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196")); // Town Store
    expect(offerFor(p1Turn, "p1")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    // RED IF the `viewerSeat !== turnSeat` guard is dropped — mutant (a). The
    // opponent would get a live button for an action `turnGate` answers WRONG_SEAT.
    expect(offerFor(p1Turn, "p2")).toBeNull();

    // …and again with the seats swapped, so a fold that hard-coded "p1" (or read
    // `state.stadium.owner` instead of the turn) cannot pass. The Stadium is still
    // P1's card here — ownership is NOT the discriminant, the turn is.
    const p2Turn = deepFreeze(must(applyAction(p1Turn, { type: "endTurn", seat: "p1" })));
    expect(p2Turn.stadium?.owner).toBe("p1");
    expect(offerFor(p2Turn, "p2")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    expect(offerFor(p2Turn, "p1")).toBeNull();
  });

  it("withholds the AFFORDANCE, not the card — which is why the leak test is about the offer", () => {
    const state = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196"));
    const opponentView = redactGame(state, "p2");
    // The Stadium card itself is PUBLIC to both viewers (§7.3, board.stadium) and
    // always was. So a "does p2's snapshot mention Town Store" test would be
    // VACUOUSLY GREEN — it would pass whether or not the offer leaked. This
    // asserts the card IS there precisely so the null above means what it says.
    expect(opponentView.board.stadium?.name).toBe("Town Store");
    expect(opponentView.phase.kind).toBe("turn:action");
    if (opponentView.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(opponentView.phase.stadiumAbility).toBeNull();
  });

  it("withholds it from a SPECTATOR watching either side (3c-vii)", () => {
    const state = deepFreeze(withStadium(p1Turn2(1), "p1", "sv03-196"));
    // The one `actor = null` gate in redactPhase is what does this — the reason a
    // new affordance on this arm is withheld by DEFAULT rather than by remembering
    // to. RED IF this fold reads `phase.seat` itself instead of the `turnSeat`
    // parameter that gate nulls.
    expect(offerFor(state, "p1", true)).toBeNull();
    expect(offerFor(state, "p2", true)).toBeNull();
  });

  it("renders NO row for a board with no Stadium, and none for a CONTINUOUS-only one", () => {
    const bare = deepFreeze(p1Turn2(1));
    expect(bare.stadium).toBeNull();
    expect(offerFor(bare, "p1")).toBeNull();
    // Beach Court is a real Stadium with a real printed effect and NO activated
    // ability — `programFor(id).stadium.ability` is undefined. RED IF the fold
    // offers a row for any Stadium in play, which would put a button in front of a
    // player for a card that prints none.
    const beachCourt = deepFreeze(withStadium(p1Turn2(1), "p1", "sv01-167"));
    expect(beachCourt.stadium).not.toBeNull();
    expect(programFor("sv01-167")?.stadium?.ability).toBeUndefined();
    expect(offerFor(beachCourt, "p1")).toBeNull();
  });
});

describe("redactGame — the once-per-turn greying, and the re-arm", () => {
  /** Activate Town Store and answer its `chooseCards` park, landing back on
      turn:action with the allowance spent. */
  function activateTownStore(state: GameState): GameState {
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    return must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
      }),
    );
  }

  it("greys the row once the turn's activation is spent — and the reason stays null (self-evident)", () => {
    const done = deepFreeze(activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196")));
    expect(done.phase.kind).toBe("turn:action");
    expect(done.allowances.stadiumAbilityUsed).toBe(true);
    // RED IF the `allowances.stadiumAbilityUsed` term is dropped — mutant (b). The
    // HUD would light a row the engine answers STADIUM_ABILITY_ALREADY_USED, which
    // is the class of bug `redactedAttacksOf`'s ⚠️ blocks exist for.
    expect(offerFor(done, "p1")).toEqual({
      label: "Town Store",
      disabled: true,
      // Matching the Ability/Trainer rows: null when the disable is self-evident
      // (already used this turn). RED IF someone invents a string here — the row's
      // tooltip contract is shared across the three folds.
      reason: null,
    });
  });

  it("RE-ARMS for the opponent's own turn — the printed 'once during EACH player's turn'", () => {
    const done = activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196"));
    const p2Turn = deepFreeze(must(applyAction(done, { type: "endTurn", seat: "p1" })));
    expect(p2Turn.allowances.stadiumAbilityUsed).toBe(false);
    // RED IF the fold ever grew per-seat bookkeeping for a flag that has none:
    // `TurnAllowances` is ONE object that resets at the turn boundary, so P2's
    // fresh turn re-offers the SAME shared Stadium, undimmed. A fold that cached
    // "p1 used it" would grey this.
    expect(offerFor(p2Turn, "p2")).toEqual({
      label: "Town Store",
      disabled: false,
      reason: null,
    });
    expect(offerFor(p2Turn, "p1")).toBeNull();
  });

  it("keeps the mid-effect `chooseCards` park DIALOGED, to the activator alone", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv03-196");
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(parked.phase.kind).toBe("effect:choose");
    const activator = redactGame(parked, "p1").phase;
    const opponent = redactGame(parked, "p2").phase;
    if (activator.kind !== "effect:choose" || opponent.kind !== "effect:choose") {
      throw new Error("expected effect:choose on both views");
    }
    // The fidelity claim D209 made about this action ("it parks on chooseCards,
    // which is dialoged") re-checked at the point it now matters — a button that
    // parks a client with no prompt is D157's soft-lock. RED IF the park ever
    // stops reaching the answerer.
    expect(activator.prompt?.kind).toBe("chooseCards");
    // …and the deck cards the search REVEALED stay off the opponent's wire, the
    // answerer gate this park depends on.
    expect(opponent.prompt).toBeNull();
  });
});

describe("redactGame — the offer AGREES WITH THE ENGINE GATE, state for state", () => {
  it("is pressable EXACTLY when `applyAction` would accept the press", () => {
    const townStore = withStadium(p1Turn2(1), "p1", "sv03-196");
    const { state: parkedThenDone } = mustApply(townStore, {
      type: "useStadiumAbility",
      seat: "p1",
    });
    if (parkedThenDone.phase.kind !== "effect:choose") throw new Error("expected the search park");
    const prompt = parkedThenDone.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const spent = must(
      applyAction(parkedThenDone, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
      }),
    );

    const cases: { name: string; state: GameState; actor: Seat }[] = [
      { name: "no Stadium in play", state: p1Turn2(1), actor: "p1" },
      { name: "a continuous-only Stadium", state: withStadium(p1Turn2(1), "p1", "sv01-167"), actor: "p1" },
      { name: "an activated Stadium, unused", state: townStore, actor: "p1" },
      { name: "an activated Stadium, already used", state: spent, actor: "p1" },
      { name: "Artazon, unused", state: withStadium(p1Turn2(2), "p1", "sv02-171"), actor: "p1" },
      { name: "Mesagoza, unused", state: withStadium(p1Turn2(3), "p1", "sv01-178"), actor: "p1" },
      { name: "the OPPONENT's turn", state: must(applyAction(townStore, { type: "endTurn", seat: "p1" })), actor: "p2" },
    ];
    // The biconditional, per case: a lit button ⟺ the engine accepts. Every term
    // of the fold (a Stadium in play, that Stadium having an ability, the
    // once-per-turn flag) is a way to break this, and it cannot be satisfied by
    // restating the fold — the right-hand side runs `cardplay.ts` for real.
    const pressable: string[] = [];
    const accepted: string[] = [];
    for (const { name, state, actor } of cases) {
      const offer = offerFor(state, actor);
      if (offer !== null && !offer.disabled) pressable.push(name);
      if (applyAction(state, { type: "useStadiumAbility", seat: actor }).ok) accepted.push(name);
    }
    expect(pressable).toEqual(accepted);
    // A POSITIVE CONTROL on the sweep itself: it must contain both answers, or
    // "equal" is agreement between two empty lists (the vacuous guard again).
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThan(cases.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A STANDARD-LEGAL driver, end to end — the card the gap was actually about.
//
// Levincia is not in FIXTURE_POOL and is deliberately not added to it: that pool's
// real-id rows are swept against the live catalog, and this file makes no claim
// about the printing beyond its id and its Stadium-ness (which is all the registry
// keys on). The row is local and minimal on purpose.

const LEVINCIA: Card = {
  ...trainerCard("sv09-150", "Stadium", "Once during each player's turn…"),
  name: "Levincia",
  regulationMark: "I",
};

/** TEST SURGERY: Levincia in the shared zone plus `lightning` Basic {L} Energy in
    `owner`'s discard — the zone its `discardPileRetrieval` reads. Surgery rather
    than a drag because the card has no FIXTURE_POOL row to deal into a deck; the
    engine reads the pool off the STATE, so adding it here is the whole change. */
function withLevincia(state: GameState, owner: Seat, lightning: number): GameState {
  const stadiumUid = "levincia-stadium";
  const energyUids = Array.from({ length: lightning }, (_, i) => `levincia-energy-${i}`);
  return {
    ...state,
    // `createGame` stores only the DECKS' cards in `state.cardPool`, so both the
    // Stadium and the Basic {L} Energy it retrieves have to be added here.
    cardPool: {
      ...state.cardPool,
      [LEVINCIA.id]: LEVINCIA,
      "fix-lightning-energy": FIXTURE_POOL["fix-lightning-energy"] as Card,
    },
    cardIdByUid: {
      ...state.cardIdByUid,
      [stadiumUid]: LEVINCIA.id,
      ...Object.fromEntries(energyUids.map((uid) => [uid, "fix-lightning-energy"])),
    },
    stadium: { uid: stadiumUid, owner },
    players: {
      ...state.players,
      [owner]: {
        ...state.players[owner],
        discard: [...state.players[owner].discard, ...energyUids],
      },
    },
  };
}

describe("redactGame — Levincia sv09-150, the Standard-legal driver (D209's finding)", () => {
  it("offers it to the acting seat, withholds it from the opponent, and the press resolves", () => {
    const state = withLevincia(p1Turn2(1), "p1", 2);
    expect(offerFor(state, "p1")).toEqual({ label: "Levincia", disabled: false, reason: null });
    expect(offerFor(state, "p2")).toBeNull();

    // The press the online client can now make — end to end through the engine.
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the retrieval park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("hand");
    expect(prompt.candidates).toHaveLength(2);
    // And the park is dialoged for the answerer alone — the online client's
    // chooseCards dialog (2b-iii-c) renders exactly this.
    const answererPhase = redactGame(parked, "p1").phase;
    if (answererPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(answererPhase.prompt?.kind).toBe("chooseCards");

    const done = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [...prompt.candidates] },
      }),
    );
    expect(done.phase.kind).toBe("turn:action");
    // Both Energy moved discard → hand, and the row is now greyed for the turn.
    expect(done.players.p1.discard).not.toContain("levincia-energy-0");
    expect(done.players.p1.hand).toContain("levincia-energy-0");
    expect(offerFor(done, "p1")).toEqual({ label: "Levincia", disabled: true, reason: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE `programPlayable` TERM, AND THE HONEST ADMISSION ABOUT IT.

describe("the `programPlayable` term in the fold is correct and, today, UNREACHABLE", () => {
  /** Every printed Stadium ability the registry implements — D209's census, kept
      as a literal because `REGISTRY` is not exported and this list is the claim. */
  const STADIUM_ABILITY_IDS = [
    "sv02-171", // Artazon
    "sv03-229", // Artazon (reprint)
    "sv01-178", // Mesagoza
    "sv03-196", // Town Store
    "sv09-150", // Levincia
    "sv10-244", // Levincia (reprint)
    "sv10-169", // Spikemuth Gym
  ];

  it("the census is real — every id above carries an ability, and the fixture pool holds no OTHERS", () => {
    for (const id of STADIUM_ABILITY_IDS) {
      expect(programFor(id)?.stadium?.ability).toBeDefined();
    }
    // RED the day an eighth printing lands in FIXTURE_POOL without joining the
    // list above — which is how this block stops silently under-scanning.
    const inPool = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.stadium?.ability !== undefined,
    );
    expect(inPool.sort()).toEqual(["sv01-178", "sv02-171", "sv03-196"]);
  });

  it("NO printed Stadium program can whiff-gate — so no test over the pool can kill this term", () => {
    // The most adverse board `programPlayable` has gates for: nothing in either
    // deck, discard or hand, no opponent Bench, no Energy anywhere. If ANY of the
    // seven programs contained a `gust` / `switchActive` / `moveEnergy` /
    // `discardEnergy` / `attachEnergyFrom` / `bottomFromOpponentHand` /
    // `damageChosen` op, this state would make it false.
    const base = p1Turn2(1);
    const stripped: GameState = {
      ...base,
      players: {
        p1: { ...base.players.p1, deck: [], hand: [], discard: [], bench: [] },
        p2: { ...base.players.p2, deck: [], hand: [], discard: [], bench: [] },
      },
    };
    for (const id of STADIUM_ABILITY_IDS) {
      const ability = programFor(id)?.stadium?.ability;
      if (ability === undefined) throw new Error(`${id} has no stadium ability`);
      // ⚠️ THIS IS THE ADMISSION, PINNED. Every printed Stadium ability searches a
      // deck or retrieves from a discard, and `programPlayable` gates NEITHER (see
      // cardplay.ts — "a deck search is always playable enough"). So the term
      // `!programPlayable(...)` in `redactedStadiumAbilityOf` cannot currently
      // return true, mutant (c) SURVIVES against the real pool, and no assertion
      // in this file pretends otherwise.
      expect(programPlayable(stripped, ability.program, "p1")).toBe(true);
    }
    // The control that makes the loop above mean something: this state DOES make
    // `programPlayable` false for a gated op, so "true" is a fact about these
    // programs and not about this state.
    expect(programPlayable(stripped, [{ op: "gust" }], "p1")).toBe(false);
  });
});
