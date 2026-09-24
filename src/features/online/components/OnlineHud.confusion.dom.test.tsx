// @vitest-environment jsdom
// D509 — THE ONLINE HUD'S §12 CONFUSION HINT, AND THE NUMBER IT PRINTS.
//
// The local `GameHud` has warned "attacking flips a coin" under its attack list
// for a long time; `OnlineHud` carried NO condition hint at all until D509, so
// the two HUDs answering the same board disagreed about whether the player is
// told that attacking costs a flip (D226/D412's two-read-sites defect, with the
// online half MISSING rather than wrong).
//
// ⚠️ CONFUSION ONLY, AND THE ASYMMETRY IS THE POINT. Asleep/Paralyzed are
// already carried here without prose — `redactedAttacksOf` folds
// `isImmobilized(active.conditions)` into `banned`, so the server ships every
// attack row `playable: false` and the buttons are grey. `isImmobilized` is
// `asleep || paralyzed`; Confusion blocks nothing, so there is no greyed button
// to carry it. §4 below is the control for that claim.
//
// 🛑 AND THE NUMBER IS THE WHOLE REASON D501 EXISTS. `GameHud` printed "tails:
// 30 damage to itself" off `rotation` alone until D501 raised the amount on the
// board — a FALSE claim at the one moment a player is deciding whether to
// attack. §2 drives `confusionDamage: 80` (the amount D501's own printing
// raises it to) precisely so a hard-coded literal cannot pass; §3 drives the
// rulebook default so the ordinary board is a control rather than an
// accidental match.
//
// WHAT TURNS EACH CASE RED (D200 → D214 — a check whose author cannot name the
// edit that breaks it is vacuous):
//   §1  deleting the `{battle !== undefined && …rotation === "confused" && (…)}`
//       block, or re-guarding it on anything that is false while Confused.
//   §2  replacing `{battle.conditions.confusionDamage}` with the literal `30`
//       (the pre-D501 build), or with `?? 30`-shaped prose off a dropped field.
//   §3  spelling the guard `!== "none"`, or reading `poisonDamage` in place of
//       `confusionDamage` (0 here, so §2's board alone would not separate them).
//   §4  widening the guard to `rotation !== "none"` — i.e. printing the flip
//       warning on an Asleep body that cannot attack at all.
//   §5  dropping the `battle !== undefined` conjunct: the render throws on a
//       hidden back rather than omitting the line.
//
// HONEST LIMIT. This is a test of ONE component against a hand-built
// `RedactedGame`. It proves what the panel renders for a given wire frame; it
// cannot prove the server ever PUTS a raised `confusionDamage` on the wire
// (that is `redact.ts` + `confusionDamage.test.ts`, engine-side), and jsdom has
// no layout, so "rendered" here means "in the DOM", never "visible".

import { cleanup, render, screen } from "@testing-library/react";
import type {
  RedactedAttack,
  RedactedConditions,
  RedactedGame,
  RedactedInPlay,
  RedactedPhase,
} from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const UPRIGHT: RedactedConditions = {
  rotation: "none",
  poisonDamage: 0,
  burned: false,
  confusionDamage: 30,
};

const ATTACKS: readonly RedactedAttack[] = [
  { index: 0, name: "Slash", cost: ["Colorless"], damage: "30", playable: true },
];

/** The viewer's Active, carrying the conditions under test. `battle` is left
    ABSENT entirely when `conditions` is null — the setup-phase hidden back
    (`hiddenInPlay` in redact.ts), which is the only shape the wire's optional
    `battle` really has and the case §5 needs. */
function inPlay(conditions: RedactedConditions | null): RedactedInPlay {
  const card: RedactedInPlay = {
    id: "sv03-121",
    cardId: "sv03-121",
    name: "Spiritomb",
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    attached: { tools: [], energies: [] },
  };
  if (conditions === null) return card;
  return { ...card, battle: { damage: 0, hp: 70, conditions } };
}

function game(active: RedactedInPlay): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    faceUpPrizes: [], // 🆕🆕🆕 D548 — REQUIRED on the wire side (D159); no prize is face up on this board
    deckCount: 53,
    discard: [],
  };
  const phase: RedactedPhase = {
    kind: "turn:action",
    attacks: [...ATTACKS],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
    stadiumAbility: null,
  };
  return {
    seat: "p1",
    turn: 3,
    phase,
    board: {
      stadium: null,
      you: { ...emptySide, active },
      opponent: emptySide,
    },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

function renderPanel(conditions: RedactedConditions | null) {
  render(
    <OnlineHud game={game(inPlay(conditions))} waitingOn="you" activePlaced onAction={vi.fn()} />,
  );
}

/** The hint's text, whitespace-normalised (JSX splits it across text nodes),
    or null when the panel printed no hint at all. */
const hint = (): string | null => {
  const node = screen.queryByText(/Confused: attacking flips a coin/);
  return node === null ? null : (node.textContent ?? "").replace(/\s+/g, " ").trim();
};

describe("§1 the hint exists at all", () => {
  it("prints the flip warning under the attack list while the Active is Confused", () => {
    renderPanel({ ...UPRIGHT, rotation: "confused" });
    expect(hint()).not.toBeNull();
    // ⚠️ AND THE ATTACK BUTTON IS STILL LIVE — this is the half that makes the
    // prose load-bearing rather than decorative. A Confused body may declare an
    // attack, so the panel offers the button and the hint is the ONLY thing
    // telling the player what pressing it risks.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Slash/ }).disabled).toBe(false);
  });
});

describe("§2 the number comes off the WIRE, not out of the source", () => {
  it("prints the RAISED amount when the board carries one", () => {
    renderPanel({ ...UPRIGHT, rotation: "confused", confusionDamage: 80 });
    expect(hint()).toBe(
      "Confused: attacking flips a coin — tails: 80 damage to itself, turn ends.",
    );
  });

  it("does not print the rulebook default on a raised board", () => {
    renderPanel({ ...UPRIGHT, rotation: "confused", confusionDamage: 80 });
    expect(hint()).not.toContain("30");
  });
});

describe("§3 the ordinary board is a CONTROL, not a coincidence", () => {
  it("prints 30 when 30 is what the wire carries", () => {
    // The two boards differ on ONE axis (D427), so the pair separates "reads the
    // field" from "prints a constant that happens to equal the default".
    renderPanel({ ...UPRIGHT, rotation: "confused" });
    expect(hint()).toBe(
      "Confused: attacking flips a coin — tails: 30 damage to itself, turn ends.",
    );
  });

  it("is not reading a neighbouring number off the same record", () => {
    // `poisonDamage` and `confusionDamage` are both numbers on `conditions`, and
    // §2's board leaves poison at 0 — so only a board where BOTH are non-default
    // and DIFFERENT can see a reader that grabbed the wrong one.
    renderPanel({ ...UPRIGHT, rotation: "confused", poisonDamage: 20, confusionDamage: 80 });
    expect(hint()).toBe(
      "Confused: attacking flips a coin — tails: 80 damage to itself, turn ends.",
    );
  });
});

describe("§4 it fires on CONFUSED alone — the immobilizing rotations are carried elsewhere", () => {
  it("prints nothing on an upright Active", () => {
    renderPanel(UPRIGHT);
    expect(hint()).toBeNull();
  });

  it.each(["asleep", "paralyzed"] as const)(
    "prints nothing while %s — `redactedAttacksOf` greys the buttons instead",
    (rotation) => {
      renderPanel({ ...UPRIGHT, rotation, confusionDamage: 80 });
      expect(hint()).toBeNull();
    },
  );

  it("prints nothing for Poison or Burn either", () => {
    renderPanel({ ...UPRIGHT, poisonDamage: 20, burned: true, confusionDamage: 80 });
    expect(hint()).toBeNull();
  });
});

describe("§5 the optional `battle` row", () => {
  it("renders the panel without throwing when the Active carries no battle row", () => {
    // `redactedInPlaySchema.battle` is OPTIONAL (a setup-phase hidden back has
    // none), so the guard's first conjunct is a totality requirement rather than
    // a fallback for a missing number — the number itself is REQUIRED once the
    // row is present, which is why the hint carries no `?? 30`.
    renderPanel(null);
    expect(hint()).toBeNull();
    expect(screen.getByRole("button", { name: /Slash/ })).toBeTruthy();
  });
});
