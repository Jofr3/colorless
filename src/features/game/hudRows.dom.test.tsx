// @vitest-environment jsdom
// D214 — the reduced-motion guard on the two match HUDs' row buttons.
//
// D90 put `motion-reduce:transition-none` INTO the shared `glass.ts` constants
// so every glass control respects reduced motion from the CONSTANT rather than
// from each call site, and its write-up concluded "the reduced-motion story is
// now complete app-wide". It was not: the HUD row buttons were never glass
// constants, so D90's sweep never reached them, and every Ability / Trainer /
// Stadium / effect-picker / attack / prize / promote row on BOTH HUDs animated
// unconditionally. `src/index.css`'s global rule only neutralises `<body>` and
// `.route-view`; it never touches a component Tailwind utility.
//
// WHY THIS IS A DOM TEST AND NOT A SOURCE SCAN. D89/D90 both declined to write
// one ("className assertions are brittle"), and the cost of that was five years
// of nobody noticing these twelve strings. The failure mode a scan cannot catch
// is a call site that stops reading the constant — so this renders the REAL HUDs
// and reads the guard off the REAL class attribute of the REAL buttons.
//
// WHAT TURNS EACH ASSERTION RED (checked by actually making each change):
//   * deleting `motion-reduce:transition-none` from any `hudRows.ts` constant —
//     every case below fails, because the invariant is evaluated per element;
//   * a call site re-inlining `transition-all` instead of importing the constant
//     — that element appears in `transitional()` without a guard;
//   * a NEW unguarded transitional control added to either HUD — same;
//   * a panel silently rendering nothing (D213's trap, where a guard passed on a
//     board that had no section at all) — the `expect(...).toBe(n)` COUNT
//     assertions fail, because a vacuous `every()` over an empty list is exactly
//     the shape this file refuses to ship.
// The count assertions are the anti-vacuity half and the guard assertions are
// the substance half; neither alone would be a guard worth having.

import type { GameState, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import type { RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  STADIUM_ABILITY_DECK,
  driveSetup,
  handFromDeck,
  handUid,
  must,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { OnlineHud } from "../online/components/OnlineHud";
import { GameHud } from "./GameHud";
import * as hudRows from "./hudRows";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

/** A Tailwind `transition-*` utility that is NOT itself the guard. Mirrors the
    sweep that found this defect: the guard is `motion-reduce:transition-none`,
    so both the `motion-reduce:` prefix and the `-none` value are excluded. */
const TRANSITION = /(?:^|\s)transition-(?!none(?:\s|$))\S+/;
const GUARD = "motion-reduce:transition-none";

/** Every rendered element whose own class attribute animates. Read off the live
    DOM, so nothing in a comment or an unused constant can satisfy it. */
function transitional(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[class]")].filter((el) =>
    TRANSITION.test(el.className),
  );
}

/** The invariant, plus the element's own text so a failure names the control. */
function unguarded(): string[] {
  return transitional()
    .filter((el) => !el.className.includes(GUARD))
    .map((el) => `${el.tagName}[${el.textContent?.slice(0, 40) ?? ""}] :: ${el.className}`);
}

// ---------------------------------------------------------------- local HUD --

const NAMES = { p1: "Ember", p2: "Tide" } as const;

/** p1's turn 2 (p2 went first and passed) with a Stadium played from hand — the
    same opener `GameHud.stadiumAbility.dom.test.tsx` uses, so the §7.3 row, the
    attack rows and the Pass controls are all on screen at once. */
function localTurnWithStadium(): GameState {
  const opened = must(
    applyAction(driveSetup(1, { p1: STADIUM_ABILITY_DECK, p2: STADIUM_ABILITY_DECK }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  const withCard = handFromDeck(opened, "p1", "sv03-196", 1);
  return must(
    applyAction(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "sv03-196"),
    }),
  );
}

function renderLocal(state: GameState, viewerSeat: Seat = "p1") {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, viewerSeat)}
      viewerSeat={viewerSeat}
      names={NAMES}
      dispatch={() => {}}
      onPlayAgain={() => {}}
    />,
  );
}

describe("GameHud rows honour prefers-reduced-motion (D214)", () => {
  it("guards every animating control in the turn:action panel, Stadium row included", () => {
    renderLocal(localTurnWithStadium());

    // ANTI-VACUITY. The §7.3 row is the one D213 found unguarded; if the panel
    // renders without it (or without the panel), the count below collapses and
    // the `every`-style assertion would pass over nothing.
    expect(screen.getByRole("button", { name: "Town Store" })).toBeTruthy();
    const animating = transitional();
    expect(animating.length).toBeGreaterThanOrEqual(3);
    // At least one is a ROW (not just the glass Pass/accent buttons D90 already
    // covered) — RED if the rows stop animating at all, which would make the
    // guard assertion true for an uninteresting reason.
    expect(animating.some((el) => el.textContent === "Town Store")).toBe(true);

    expect(unguarded()).toEqual([]);
  });
});

// --------------------------------------------------------------- online HUD --

function inPlay(id: string, name: string): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
  };
}

function wireGame(phase: RedactedPhase, you: Partial<RedactedGame["board"]["you"]> = {}) {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  return {
    seat: "p1",
    turn: 3,
    phase,
    board: {
      stadium: null,
      you: { ...emptySide, ...you },
      opponent: { ...emptySide },
    },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  } satisfies RedactedGame;
}

function renderOnline(game: RedactedGame) {
  render(<OnlineHud game={game} waitingOn="you" activePlaced onAction={() => {}} />);
}

describe("OnlineHud rows honour prefers-reduced-motion (D214)", () => {
  it("guards the attack rows and the server-folded Stadium row", () => {
    renderOnline(
      wireGame(
        {
          kind: "turn:action",
          attacks: [
            { index: 0, name: "Cut", cost: ["Water"], damage: "10", playable: true },
            { index: 1, name: "Big Swing", cost: ["Water"], damage: "80", playable: false },
          ],
          retreat: null,
          abilities: [],
          trainers: [],
          rareCandy: [],
          stadiumAbility: { label: "Levincia", disabled: false, reason: null },
        },
        { active: inPlay("sneasel", "Sneasel") },
      ),
    );
    // ANTI-VACUITY: both attack rows and the Stadium row are on screen. RED if
    // the phase stops rendering rows — the exact way D213's first draft passed.
    expect(screen.getByRole("button", { name: /Cut/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Big Swing/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Levincia" })).toBeTruthy();
    expect(transitional().length).toBeGreaterThanOrEqual(3);

    expect(unguarded()).toEqual([]);
  });

  it("guards the ko:takePrizes prize tiles", () => {
    renderOnline(wireGame({ kind: "ko:takePrizes", count: 1 }, { prizesRemaining: 4 }));
    // ANTI-VACUITY: four face-down tiles, one per remaining prize. RED if the
    // picker renders none — then `unguarded()` would be trivially empty.
    const tiles = screen.getAllByRole("button", { name: /^Prize \d$/ });
    expect(tiles.length).toBe(4);
    expect(transitional().length).toBeGreaterThanOrEqual(4);
    expect(unguarded()).toEqual([]);
  });

  it("guards the ko:promote bench rows", () => {
    renderOnline(
      wireGame({ kind: "ko:promote" }, { bench: [inPlay("a", "Alpha"), inPlay("b", "Beta")] }),
    );
    // ANTI-VACUITY: PROMOTE_ROW is the one row with no conditional tint, so a
    // regression there is invisible unless the rows are proved present first.
    expect(screen.getByRole("button", { name: /Alpha/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Beta/ })).toBeTruthy();
    expect(transitional().length).toBeGreaterThanOrEqual(2);
    expect(unguarded()).toEqual([]);
  });
});

// -------------------------------------------------------------- the invariant --

describe("hudRows keeps D90's constant-level placement", () => {
  it("pairs every transitional export with the guard — by VALUE, not by source text", () => {
    // Reads the module's exported STRINGS, so the header comment (which names
    // both classes) cannot satisfy it — D210's near-miss, where a doc comment
    // alone made a source scan green.
    const strings: [string, string][] = Object.entries(hudRows as Record<string, unknown>).flatMap(
      (entry) => (typeof entry[1] === "string" ? [[entry[0], entry[1]] as const] : []),
    );
    // ANTI-VACUITY: RED if an export is renamed away or the module is emptied.
    expect(strings.length).toBe(12);
    const animating = strings.filter(([, value]) => TRANSITION.test(` ${value}`));
    expect(animating.map(([name]) => name).sort()).toEqual([
      "ATTACK_ROW_BASE",
      "PICK_ROW_BASE",
      "PICK_ROW_SPLIT_BASE",
      "PRIZE_CARD_BASE",
      "PROMOTE_ROW",
      "ROW_BUTTON_BASE",
    ]);
    // RED if the guard is dropped from any one of them.
    expect(animating.filter(([, value]) => !value.includes(GUARD))).toEqual([]);
  });
});
