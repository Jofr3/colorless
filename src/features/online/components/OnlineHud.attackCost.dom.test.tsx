// @vitest-environment jsdom
// The ONLINE HUD's energy dots. This panel reads nothing but the redacted wire
// snapshot, so the fix that the local HUD gets for free (it recomputes
// `effectiveAttackCost` itself) has to ARRIVE here — as the optional
// `RedactedAttack.effectiveCost` sibling. `cost` still means the PRINTED cost;
// the renderer prefers `effectiveCost` when the server sent one.

import { cleanup, render, screen } from "@testing-library/react";
import type { RedactedAttack, RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const PRINTED = ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"];

function inPlay(id: string, name: string): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 160, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
  };
}

function game(attacks: RedactedAttack[]): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  const phase: RedactedPhase = {
    kind: "turn:action",
    attacks,
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
      you: { ...emptySide, active: inPlay("swsh10.5-011", "Radiant Charizard") },
      opponent: emptySide,
    },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

function renderPanel(attacks: RedactedAttack[]) {
  render(
    <OnlineHud
      game={game(attacks)}
      waitingOn="you"
      activePlaced
      onAction={vi.fn()}
    />,
  );
}

const dots = () => screen.getByLabelText(/^cost: /).getAttribute("aria-label");

describe("online turn panel — `effectiveCost ?? cost`", () => {
  it("falls back to the printed cost when the server sent no sibling", () => {
    renderPanel([
      { index: 0, name: "Combustion Blast", cost: PRINTED, damage: "250", playable: false },
    ]);
    expect(dots()).toBe("cost: Fire, Colorless, Colorless, Colorless, Colorless");
  });

  it("prefers the sibling when it arrives — the discounted cost is what is drawn", () => {
    // ⚠️ AND THE ROW IS `playable: true` WITH FEWER DOTS THAN THE PRINT, which is
    // the whole failure the field closes: `playable` is derived server-side from
    // exactly this array, and a panel drawing `cost` here would light a button up
    // beside a cost the player has not paid.
    renderPanel([
      {
        index: 0,
        name: "Combustion Blast",
        cost: PRINTED,
        effectiveCost: ["Fire", "Colorless", "Colorless"],
        damage: "250",
        playable: true,
      },
    ]);
    expect(dots()).toBe("cost: Fire, Colorless, Colorless");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Combustion Blast/ }).disabled).toBe(
      false,
    );
  });

  it("prefers it in the ADDING direction too", () => {
    renderPanel([
      {
        index: 0,
        name: "Echoed Voice",
        cost: ["Water", "Water"],
        effectiveCost: ["Water", "Water", "Colorless"],
        damage: "120",
        playable: false,
      },
    ]);
    expect(dots()).toBe("cost: Water, Water, Colorless");
  });
});
