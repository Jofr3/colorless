// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NO_CONDITIONS } from "../types";
import type {
  BattleConditions,
  BattleState,
  CardBackTone,
  CardModel,
  PlayerBoard,
  PlayerId,
} from "../types";
import { PlayerSide } from "./PlayerSide";

afterEach(cleanup);

const card = (id: string, battle?: BattleState): CardModel => ({
  id,
  name: id,
  cardId: id,
  type: "pokemon",
  ...(battle === undefined ? {} : { battle }),
});

/** The board shape the game projection produces: battle ON the models. */
const player: PlayerBoard = {
  hand: [],
  active: card("active-1", { damage: 30, hp: 120, conditions: NO_CONDITIONS }),
  bench: [
    card("bench-1", { damage: 50, hp: null, conditions: NO_CONDITIONS }),
    card("bench-2", { damage: 0, hp: 60, conditions: NO_CONDITIONS }),
  ],
  prizesRemaining: 6,
  faceUpPrizes: [], // 🆕🆕🆕 D551 — REQUIRED on PlayerBoard; no prize is face up on this board
};

/** The mock-shaped board: plain models, no battle anywhere. */
const barePlayer: PlayerBoard = {
  hand: [],
  active: card("active-1"),
  bench: [card("bench-1"), card("bench-2")],
  prizesRemaining: 6,
  faceUpPrizes: [], // 🆕🆕🆕 D551 — REQUIRED on PlayerBoard; no prize is face up on this board
};

const renderSide = (board: PlayerBoard) =>
  render(<PlayerSide owner="you" side="bottom" player={board} benchLimit={5} />).container;

const chipsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-damage-dice]"));

const statusStacksOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-status-chips]"));

const statusChipsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-status-chip]"));

/** The stacking-context walk both badge kinds must survive: nothing between
    the badge and the playmat section may form a lower stacking context
    (element backdrop-filter or a positioned inline z-index — both trapped
    the z-[61] chip under the z-60 Pixi canvas before). */
function expectNoStackingContextAncestors(container: HTMLElement, element: HTMLElement) {
  for (let node = element.parentElement; node && node !== container; node = node.parentElement) {
    const backdropTokens = Array.from(node.classList).filter((token) =>
      token.startsWith("backdrop-"),
    );
    expect(backdropTokens).toEqual([]);
    expect(node.style.zIndex).toBe("");
  }
}

describe("damage dice", () => {
  it.each<[PlayerId, PlayerId, CardBackTone]>([
    ["you", "you", "blue"],
    ["opponent", "you", "red"],
    ["you", "opponent", "red"],
    ["opponent", "opponent", "blue"],
  ])("colors %s's Active and Bench dice with %s as Player 1", (owner, blueBackPlayer, tone) => {
    const { container, rerender } = render(
      <PlayerSide
        owner={owner}
        blueBackPlayer={blueBackPlayer}
        side="bottom"
        player={player}
        benchLimit={5}
      />,
    );
    const expectTone = () => {
      const dice = [...container.querySelectorAll<HTMLElement>(".damage-die")];
      expect(dice.map((die) => die.dataset.tone)).toEqual([tone, tone]);
    };
    expectTone();
    rerender(
      <PlayerSide
        owner={owner}
        blueBackPlayer={blueBackPlayer}
        side="top"
        player={player}
        benchLimit={5}
      />,
    );
    expectTone();
  });

  it("renders dice on each damaged in-play Pokémon, none at zero damage", () => {
    const chips = chipsOf(renderSide(player));
    expect(chips.map((chip) => chip.querySelector<HTMLElement>(".damage-die")?.dataset.value)).toEqual(["3", "5"]);
    expect(chips.map((chip) => chip.dataset.damageTotal)).toEqual(["30", "50"]);
  });

  it.each<[number, number[]]>([
    [10, [1]],
    [60, [6]],
    [80, [6, 2]],
    [130, [6, 6, 1]],
    [250, [6, 6, 6, 6, 1]],
  ])("represents %i damage with dice showing %j", (damage, values) => {
    const container = renderSide({
      ...player,
      active: card("active-1", { damage, hp: 1000, conditions: NO_CONDITIONS }),
      bench: [],
    });
    const dice = [...container.querySelectorAll<HTMLElement>(".damage-die")];
    expect(dice.map((die) => Number(die.dataset.value))).toEqual(values);
    expect(dice.reduce((sum, die) => sum + Number(die.dataset.damageValue), 0)).toBe(damage);
    for (const die of dice) {
      const face = die.querySelector(`[data-face="${die.dataset.value}"]`);
      expect(face?.querySelectorAll(".tabletop-die-pip")).toHaveLength(Number(die.dataset.value));
      expect(die.querySelector(".tabletop-die-cube")?.getAttribute("style")).toContain("animation: none");
    }
  });

  it("renders no chips when battle is absent (mock board)", () => {
    expect(chipsOf(renderSide(barePlayer))).toEqual([]);
  });

  it("keeps every chip free of stacking-context ancestors", () => {
    const container = renderSide(player);
    const chips = chipsOf(container);
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expectNoStackingContextAncestors(container, chip);
    }
  });

  // The bench drop zones keep their paint-order z-index (earlier slots must
  // hit-test above later ones where collapsed attachments overlap), with no
  // battle-dependent lift — and the badges live beside them, never inside.
  it("leaves bench drop-zone z-order identical with and without battle", () => {
    for (const board of [player, barePlayer]) {
      const container = renderSide(board);
      const slots = Array.from(
        container.querySelectorAll<HTMLElement>('[data-card-zone="bench"][data-card-index]'),
      );
      expect(slots.map((slot) => slot.style.zIndex)).toEqual(["2", "1"]);
      for (const slot of slots) {
        expect(slot.querySelector("[data-damage-dice]")).toBeNull();
        expect(slot.querySelector("[data-status-chips]")).toBeNull();
      }
      cleanup();
    }
  });
});

const conditioned = (conditions: BattleConditions): PlayerBoard => ({
  hand: [],
  active: card("active-1", { damage: 0, hp: 120, conditions }),
  bench: [],
  prizesRemaining: 6,
  faceUpPrizes: [], // 🆕🆕🆕 D551 — REQUIRED on PlayerBoard; no prize is face up on this board
});

describe("status markers", () => {
  it.each<[BattleConditions, string[]]>([
    [{ ...NO_CONDITIONS, rotation: "asleep" }, ["SLP"]],
    [{ ...NO_CONDITIONS, rotation: "paralyzed" }, ["PAR"]],
    [{ ...NO_CONDITIONS, rotation: "confused" }, ["CNF"]],
    [{ ...NO_CONDITIONS, burned: true }, ["BRN"]],
    // Default poison (10 per Checkup) stays a bare PSN…
    [{ ...NO_CONDITIONS, poisonDamage: 10 }, ["PSN"]],
    // …raised poison spells the amount out.
    [{ ...NO_CONDITIONS, poisonDamage: 20 }, ["PSN 20"]],
  ])("renders %j as %j", (conditions, labels) => {
    const chips = statusChipsOf(renderSide(conditioned(conditions)));
    expect(chips.map((chip) => chip.textContent)).toEqual(labels);
  });

  it("stacks coexisting conditions in one marker column (rotation, PSN, BRN)", () => {
    const container = renderSide(
      conditioned({ rotation: "confused", poisonDamage: 20, burned: true, confusionDamage: 30 }),
    );
    expect(statusStacksOf(container)).toHaveLength(1);
    expect(statusChipsOf(container).map((chip) => chip.textContent)).toEqual([
      "CNF",
      "PSN 20",
      "BRN",
    ]);
  });

  it("renders no markers when nothing afflicts the Pokémon", () => {
    expect(statusStacksOf(renderSide(player))).toEqual([]);
    cleanup();
    expect(statusStacksOf(renderSide(barePlayer))).toEqual([]);
  });

  // The projection never produces benched conditions (retreat clears them,
  // §11/§12) but the component stays generic — no active-only special case.
  it("renders bench markers through the same generic path", () => {
    const board: PlayerBoard = {
      hand: [],
      active: null,
      bench: [
        card("bench-1", { damage: 0, hp: 60, conditions: { ...NO_CONDITIONS, burned: true } }),
      ],
      prizesRemaining: 6,
      faceUpPrizes: [], // 🆕🆕🆕 D551 — REQUIRED on PlayerBoard; no prize is face up on this board
    };
    expect(statusChipsOf(renderSide(board)).map((chip) => chip.textContent)).toEqual(["BRN"]);
  });

  // Same clearance rule as the damage chips: the marker stack is the z-[61]
  // element (its chips ride inside it), so IT must stay free of
  // stacking-context ancestors.
  it("keeps the marker stack free of stacking-context ancestors", () => {
    const container = renderSide(conditioned({ ...NO_CONDITIONS, rotation: "asleep" }));
    const stacks = statusStacksOf(container);
    expect(stacks).toHaveLength(1);
    for (const stack of stacks) {
      expectNoStackingContextAncestors(container, stack);
    }
  });
});
