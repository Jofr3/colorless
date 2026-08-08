// @vitest-environment jsdom
// D289 — THE LOCAL HUD'S HALF OF THE IMPOSED HAND-PLAY BAR, driven from `src/`
// for the first time.
//
// 🛑 **WHAT THIS FILE IS FOR, AND WHY IT EXISTS FIVE SLICES LATE.**
// `playableTrainers` (GameHud.tsx) carries a `barred` term — D283 wrote it, D286
// measured that Rare Candy needs no term of its own beside it, D287 widened it to
// Stadiums and D288 mirrored the whole shape onto the wire. Every one of those
// five slices asserted the ENGINE half (`activeHandLock.test.ts`,
// `screamTail.test.ts`, `rareCandyBar.test.ts`, `stadiumBar.test.ts`,
// `stadiumWireMirror.test.ts`) and the WIRE half (`redactedTrainersOf`), and not
// one of them could assert the LOCAL HUD, because no `src/` suite had ever built
// a barred board. **THE TWO LISTS ARE WRITTEN TO BE TWINS AND ONLY ONE OF THEM
// HAD A SUITE.**
//
// ⚠️ **THE NEAR-MISS THAT COULD HAVE CLOSED THIS ROW FALSELY.**
// `GameHud.dom.test.tsx` already holds two `it`s NAMED *"disables ONLY the barred
// row"* and *"greys EVERY barred row"*. They are the **ATTACK** bar
// (`lockedAttackIndexes`, D154's per-attack self-lock) — a different term, a
// different funnel, a different projected field. A grep for the word `barred`
// answers "yes, covered"; a grep for `handPlayBarred` answers "nowhere in
// `src/`", which is the true one. **THE TWO QUESTIONS HAVE DIFFERENT ANSWERS AND
// ONLY ONE OF THEM IS THE ROW.**
//
// ⚠️ **A ONE-SOURCE SUITE IS VACUOUS HERE, AND THAT IS THE WHOLE POINT OF §3.**
// `handPlayBarred` (continuous.ts) ORs a CONTINUOUS source (an opposing Active's
// Ability — Tyranitar, Jellicent ex, Copperajah) with a STAMPED one
// (`GameState.handPlayLockedTurn`, written by an opponent's ATTACK). A HUD that
// called `stampedBarFor` instead is green on every §3 board below and red on
// nothing in §1/§2; a HUD that read only the passive is the mirror image. Both
// halves are driven, from boards on which the OTHER half is provably absent.
//
// ⚠️ **AND A TRAINER-CLASS SUITE IS VACUOUS ON THE CLASS.** Tyranitar bars Items,
// Scream Tail ex bars Supporters, Copperajah bars Stadiums; a build that
// collapsed the question to "is this seat barred at all" is green on every
// single-class board. §1.2, §4 and §5.2 each hold TWO rows of DIFFERENT classes in
// ONE render and require them to disagree.
//
// ⚠️ **THE CONTROL IS NOT OPTIONAL.** Every "the row greys" assertion below
// passes just as happily on a HUD that greyed the row for some other reason (the
// §7.5 hand cost, the §7 no-target judgement, a `programFor` miss). Each section
// pairs its barred board with the SAME board under a body that prints nothing,
// and requires the row to be LIT there.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows (copied from the engine
// suites that own them, so a divergence is visible in a diff rather than only in
// a failure).
// ─────────────────────────────────────────────────────────────────────────────

const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
const OCEANIC_CURSE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand.";
const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";

const TYRANITAR = "sv09-095"; // "Daunting Gaze" — Items
const JELLICENT = "sv10.5w-045"; // "Oceanic Curse" — Items + Tools
const COPPERAJAH = "sv06.5-042"; // "Massive Body" — Stadiums
/** The CONTROL body: a Basic with no Ability at all. Every "the bar bites"
    assertion below is green on a HUD that greyed the row for any other reason;
    this is what separates them. */
const PLAIN = "fix-plain-basic";

/** Potion — an Item with a board precondition every board below satisfies (a
    DAMAGED own Pokémon, set by `setDamage`), so a grey at its row can only ever
    be a RULE and never `programPlayable`'s no-target judgement. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter control. Tyranitar bars Items; a build
    that collapsed the class list to "any Trainer" greys this too. */
const SUPPORTER = "sv01-189";
/** Beach Court — a Stadium with a program, so it earns a row (D287's local half:
    this list DOES show Stadium rows, which is exactly why a barred one must not
    stay lit). */
const STADIUM = "sv01-167";
/** Vitality Band — a Pokémon TOOL. It has NO row in this list at all, which is a
    property of what the list SHOWS and not a term the list is missing; §2 pins
    that, because Jellicent ex's sentence names Tools and a reader could
    reasonably expect a greyed Tool row rather than none. */
const TOOL = "sv01-197";
const RARE_CANDY = "sv01-191";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom, and the
//    reason `catalogManifest.test.ts` stays green) ────────────────────────────

/** Tyranitar `sv09-095`, carrying the catalog's own HP/type/stage. The id is
    REAL, so `programFor(id)` resolves the shipped `DAUNTING_GAZE` row rather
    than a stand-in. ⚠️ NO ATTACKS — this suite never swings, and an attack would
    give every grey below a second possible explanation. */
function tyranitar(id: string): Card {
  return battler(id, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  });
}

/** Jellicent ex — the TWO-class printing. ⚠️ THE `ex` SUFFIX IS CARRIED BY THE
    NAME AND NOT BY A FIELD (`pokemonSuffixOf`, cards.ts). */
function jellicent(id: string): Card {
  return battler(id, {
    name: "Jellicent ex",
    hp: 280,
    retreat: 2,
    types: ["Water"],
    stage: "Stage1",
    abilities: [{ type: "Ability", name: "Oceanic Curse", effect: OCEANIC_CURSE_TEXT }],
  });
}

/** Copperajah `sv06.5-042` — the STADIUM printing (D287). */
function copperajah(id: string): Card {
  return battler(id, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [TYRANITAR]: tyranitar(TYRANITAR),
  [JELLICENT]: jellicent(JELLICENT),
  [COPPERAJAH]: copperajah(COPPERAJAH),
  [PLAIN]: battler(PLAIN, { name: "Plain Basic", hp: 200, retreat: 1, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own 60 (D270's rule: a seeded suite gets its own deck). ⚠️ ALL
    THREE BARRING IDS ARE IN IT — `setActiveFromDeck` pulls from the DECK, so a
    body named only in prose would be untestable on a board. `fix-bigbody` is the
    DOMINANT mulligan-free starter on both seats. */
const BAR_DECK = deckOf({
  [TYRANITAR]: 4,
  [JELLICENT]: 4,
  [COPPERAJAH]: 4,
  [PLAIN]: 2,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  [STADIUM]: 4,
  [TOOL]: 2,
  [RARE_CANDY]: 2,
  "fix-stage2": 4,
  // ⚠️ THE MIDDLE OF THE CHAIN IS IN THE DECK EVEN THOUGH NO BOARD EVER PLAYS IT.
  // `rareCandyOptions` resolves "which Basic does this Stage 2 sit above" by
  // scanning `state.cardPool`, and `createGame` PRUNES that pool to the slice the
  // two decks actually use — so a `fix-stage1` absent from the 60 makes §5's chain
  // unresolvable and greys Rare Candy for a reason that is not the bar. Measured:
  // without this row the §5 CONTROL is red and §5.1 is vacuously green.
  "fix-stage1": 2,
  "fix-basic-1": 4,
  "fix-bigbody": 16,
  "fix-energy": 4,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [7301, 7307, 7321, 7333] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** D275's `localSetup`, with the FIRST PLAYER as a PARAMETER — a one-seat board
    is vacuous on a per-seat fact, and "whose HAND is barred" is exactly one.
    ⚠️ `driveSetup` (testFixtures) cannot be reused: it calls `mustCreate`, which
    hard-wires `FIXTURE_POOL`, and every barring body in this file is a LOCAL
    card. This is the bridge D288's handoff priced, and it is 20 lines rather
    than a duplicated 200-line fixture. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: BAR_DECK, p2: BAR_DECK }, cardPool: POOL });
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

/** Advance the clock to `turn`, ending whichever seat is on the clock. */
function untilTurn(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") throw new Error(`unexpected phase ${next.phase.kind}`);
    next = mustApply(next, { type: "endTurn", seat: next.phase.seat }).state;
  }
  return next;
}

/** A board on which it is **P1's** turn, P2's Active is `opposing`, and P1 holds
    one Item / one Supporter / one Stadium. P1's Active is damaged so Potion's
    §7 no-target judgement can never be what greys the Item row. */
function board(seed: number, opposing: string, turn = 4): GameState {
  let state = untilTurn(localSetup(seed, "p2"), turn);
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") {
    throw new Error("expected p1 to be on the clock");
  }
  state = setActiveFromDeck(state, "p2", opposing);
  state = setDamage(state, "p1", 10);
  state = handFromDeck(state, "p1", ITEM, 1);
  state = handFromDeck(state, "p1", SUPPORTER, 1);
  state = handFromDeck(state, "p1", STADIUM, 1);
  return state;
}

function renderHud(state: GameState, seat: Seat = "p1") {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, seat)}
      viewerSeat={seat}
      names={NAMES}
      dispatch={vi.fn()}
      onPlayAgain={() => {}}
    />,
  );
}

/** The row's `disabled` bit. ⚠️ `getByRole` THROWS when the row is absent, which
    is the behaviour this helper wants: "no row at all" and "a greyed row" are
    two different findings and must never collapse into one. */
function rowDisabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §1 — the CONTINUOUS bar reaches the local Trainers list", () => {
  it("🛑 Tyranitar greys P1's ITEM row and leaves the SUPPORTER lit — one render, two classes", () => {
    for (const seed of SEEDS) {
      renderHud(board(seed, TYRANITAR));
      // The bar is per CLASS. A HUD that answered "is this seat barred at all"
      // greys both, and every single-class board in this file stays green on it.
      expect(rowDisabled(ITEM)).toBe(true);
      expect(rowDisabled(SUPPORTER)).toBe(false);
      cleanup();
    }
  });

  it("🛑 THE CONTROL — the same board under a body that prints NOTHING leaves both lit", () => {
    for (const seed of SEEDS) {
      renderHud(board(seed, PLAIN));
      expect(rowDisabled(ITEM)).toBe(false);
      expect(rowDisabled(SUPPORTER)).toBe(false);
      cleanup();
    }
  });

  it("the bar is read from the ACTIVE SPOT — a BENCHED Tyranitar greys nothing", () => {
    // The printed sentence opens "As long as this Pokémon is in the Active
    // Spot". A HUD reading the whole opposing board is green on §1.1 and wrong
    // here, and this is the only board that separates them.
    for (const seed of SEEDS) {
      let state = board(seed, PLAIN);
      state = benchFromDeck(state, "p2", TYRANITAR);
      renderHud(state);
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });

  it("the BARRING seat's own hand is untouched — the sentence says *your opponent*", () => {
    // ⚠️ THE PERSPECTIVE IS THE EASY ONE TO INVERT, and a build that asked about
    // the seat's OWN Active is green on nothing above but green here too unless
    // the barring body is on the VIEWER's side of the table.
    for (const seed of SEEDS) {
      let state = untilTurn(localSetup(seed, "p1"), 3);
      state = setActiveFromDeck(state, "p1", TYRANITAR);
      state = setDamage(state, "p1", 10);
      state = handFromDeck(state, "p1", ITEM, 1);
      renderHud(state);
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §2 — the TWO-class printing, and the class that has no row to grey", () => {
  it("Jellicent ex greys the Item row on the same funnel as the one-class printing", () => {
    for (const seed of SEEDS) {
      renderHud(board(seed, JELLICENT));
      expect(rowDisabled(ITEM)).toBe(true);
      expect(rowDisabled(SUPPORTER)).toBe(false);
      cleanup();
    }
  });

  it("🛑 a TOOL has NO row in this list at all — the absence is the answer, not a grey", () => {
    // Jellicent ex's sentence names Pokémon Tool cards, and `HandPlayClass`
    // carries `"Tool"` (D284) — so the reflex is to look for a greyed Tool row.
    // There is none: attaching a Tool is a board DRAG, never a Trainers-list
    // button, so the local HUD honours that half of the sentence by having
    // nothing to honour. `queryByRole` (not `getByRole`) because the assertion
    // IS the absence.
    let state = board(SEEDS[0], JELLICENT);
    state = handFromDeck(state, "p1", TOOL, 1);
    renderHud(state);
    expect(screen.queryByRole("button", { name: TOOL })).toBeNull();
    // …and the Item row on the SAME render is still greyed, so this test cannot
    // pass by the Trainers list having failed to render at all.
    expect(rowDisabled(ITEM)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §3 — the STAMPED half, on a board with NO barring Active", () => {
  // 🛑 `handPlayBarred` ORs a CONTINUOUS source with a STAMPED one
  // (`GameState.handPlayLockedTurn`, written by `preventHandPlay` off an
  // opponent's ATTACK). Every board in §1/§2 carries only the first. These
  // carry only the second, so a HUD wired to `continuous`'s passive scan alone
  // — or to `stampedBarFor` alone — is red in exactly one of the two sections.
  //
  // ⚠️ THE STAMP IS WRITTEN DIRECTLY rather than driven through an attack, and
  // that is deliberate: the field's own arithmetic (the writer records the turn
  // the bar APPLIES to; the reader is one `===`) is pinned SIX ways in
  // `activeHandLock.test.ts` / `screamTail.test.ts` off real declarations. What
  // has never been asserted anywhere is that THIS list consults it, and the
  // shortest board that says so is the one where nothing else could.
  function stamped(state: GameState, seat: Seat, klass: string, turn: number): GameState {
    return {
      ...state,
      handPlayLockedTurn: {
        ...state.handPlayLockedTurn,
        [seat]: { ...state.handPlayLockedTurn[seat], [klass]: turn },
      },
    };
  }

  it("🛑 a stamp for THIS turn greys the Item row with no barring body anywhere", () => {
    for (const seed of SEEDS) {
      const free = board(seed, PLAIN);
      renderHud(stamped(free, "p1", "Item", free.turn));
      expect(rowDisabled(ITEM)).toBe(true);
      expect(rowDisabled(SUPPORTER)).toBe(false);
      cleanup();
    }
  });

  it("a stamp for a DIFFERENT turn greys nothing — the window is one turn wide", () => {
    for (const seed of SEEDS) {
      const free = board(seed, PLAIN);
      renderHud(stamped(free, "p1", "Item", free.turn + 2));
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });

  it("🛑 a SUPPORTER stamp greys the Supporter and leaves the Item lit — the class rides through", () => {
    // Scream Tail ex's printing bars Supporters, and it is the only class that
    // separates a HUD passing `card.trainerType` through from one that hard-wired
    // `"Item"` — which every other board in this file would let pass.
    for (const seed of SEEDS) {
      const free = board(seed, PLAIN);
      renderHud(stamped(free, "p1", "Supporter", free.turn));
      expect(rowDisabled(SUPPORTER)).toBe(true);
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });

  it("the stamp is per SEAT — P2's stamp does not grey P1's rows", () => {
    for (const seed of SEEDS) {
      const free = board(seed, PLAIN);
      renderHud(stamped(free, "p2", "Item", free.turn));
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §4 — the STADIUM row (D287's local half, never driven from `src/`)", () => {
  it("🛑 Copperajah greys P1's STADIUM row — the afford-then-reject defect D287 closed", () => {
    // Before D287 this list EXCLUDED Stadiums from the `barred` term on the
    // ground that "nothing can bar a Stadium". Copperajah can. With the
    // exclusion restored, the row stays LIT, is clicked, and `playStadium`
    // refuses it — the defect the term exists to close, and the one nothing in
    // `src/` could report until this file.
    for (const seed of SEEDS) {
      renderHud(board(seed, COPPERAJAH));
      expect(rowDisabled("Beach Court")).toBe(true);
      cleanup();
    }
  });

  it("🛑 THE CONTROL — a plain Active leaves the SAME Stadium row lit", () => {
    for (const seed of SEEDS) {
      renderHud(board(seed, PLAIN));
      expect(rowDisabled("Beach Court")).toBe(false);
      cleanup();
    }
  });

  it("Copperajah greys ONLY the Stadium row — the Item and Supporter stay lit", () => {
    // The three printings partition the classes: a build that widened one
    // sentence to all of them is green on §1.1 and §4.1 and red here.
    for (const seed of SEEDS) {
      renderHud(board(seed, COPPERAJAH));
      expect(rowDisabled(ITEM)).toBe(false);
      expect(rowDisabled(SUPPORTER)).toBe(false);
      cleanup();
    }
  });

  it("and Tyranitar leaves the STADIUM row lit — the partition holds in both directions", () => {
    for (const seed of SEEDS) {
      renderHud(board(seed, TYRANITAR));
      expect(rowDisabled("Beach Court")).toBe(false);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §5 — RARE CANDY under the bar: the term that is NOT here", () => {
  it("🛑 a barred seat's Rare Candy row is greyed WITHOUT a `barred` term of its own", () => {
    // D286 MEASURED that a Rare Candy conjunct in `playableTrainers` cannot go
    // red: Rare Candy IS an Item played from hand, the bar is folded SEAT-WIDE
    // into `rareCandyOptions`, and `!rareCandyPlayable()` therefore already
    // greys the row. conventions.md forbids a line that cannot go red, so the
    // term was written, measured, and cut. **THAT DECISION HAS NEVER BEEN
    // ASSERTED FROM `src/`** — and it is exactly the kind of claim that reads as
    // an argument until a board runs it.
    let state = board(SEEDS[0], TYRANITAR, 6);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = setDamage(state, "p1", 10);
    state = handFromDeck(state, "p1", RARE_CANDY, 1);
    state = handFromDeck(state, "p1", "fix-stage2", 1);
    renderHud(state);
    expect(rowDisabled("Rare Candy")).toBe(true);
    // The Item row on the same render is greyed by the term that IS here; the
    // Supporter is lit. Both are asserted so this test cannot pass by the whole
    // list having gone dark.
    expect(rowDisabled(ITEM)).toBe(true);
    expect(rowDisabled(SUPPORTER)).toBe(false);
  });

  it("🛑 THE CONTROL — the same chain under a plain Active lights Rare Candy up", () => {
    // Without this the test above is green on a HUD that greys Rare Candy
    // always, which is the failure mode a "greyed" assertion cannot see.
    let state = board(SEEDS[0], PLAIN, 6);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = setDamage(state, "p1", 10);
    state = handFromDeck(state, "p1", RARE_CANDY, 1);
    state = handFromDeck(state, "p1", "fix-stage2", 1);
    renderHud(state);
    expect(rowDisabled("Rare Candy")).toBe(false);
    expect(rowDisabled(ITEM)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D289 §6 — the HUD and the ENGINE agree, which is the whole reason the term exists", () => {
  it("🛑 every row this list greys under a bar, the engine also REFUSES", () => {
    // A greyed row that the engine would have allowed is D223's defect (a dead
    // affordance nobody clicks, so nobody reports it); a LIT row the engine
    // refuses is the afford-then-reject defect. The only assertion that closes
    // both directions at once is the engine run beside the render, on the same
    // state, through the same action the button would have dispatched.
    for (const [opposing, cardId, label] of [
      [TYRANITAR, ITEM, ITEM],
      [COPPERAJAH, STADIUM, "Beach Court"],
    ] as const) {
      const state = board(SEEDS[0], opposing);
      const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === cardId);
      if (uid === undefined) throw new Error(`no ${cardId} in p1's hand`);
      renderHud(state);
      expect(rowDisabled(label)).toBe(true);
      cleanup();
      const attempt = applyAction(state, { type: "playTrainer", seat: "p1", uid });
      expect(attempt.ok).toBe(false);
    }
  });

  it("🛑 …and every row it LIGHTS, the engine accepts — the control in the other direction", () => {
    for (const [cardId, label] of [
      [ITEM, ITEM],
      [STADIUM, "Beach Court"],
    ] as const) {
      const state = board(SEEDS[0], PLAIN);
      const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === cardId);
      if (uid === undefined) throw new Error(`no ${cardId} in p1's hand`);
      renderHud(state);
      expect(rowDisabled(label)).toBe(false);
      cleanup();
      const attempt = applyAction(state, { type: "playTrainer", seat: "p1", uid });
      expect(attempt.ok).toBe(true);
    }
  });
});
