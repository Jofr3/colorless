// @vitest-environment jsdom
// 🆕🆕🆕 D543 PART 0 — THE `upTo` DISCARD SCOPE ON THE **ONLINE** DIALOG, AND THE
// FOUR SITES THAT WERE GREEN AND WRONG.
//
// 🛑 **THE WIRE COULD NOT CARRY THE SCOPE, SO NOTHING COULD SEE THE HOLE.**
// `DiscardScope` has had three members since D359 — `total`, `each` and the one
// DECLINABLE `upTo` — and `redactedDiscardScopeSchema` had TWO. `redactedScopeOf`
// was a two-arm ternary that collapsed every `upTo` into `{ kind: "each" }`, so a
// Chien-Pao ex "Hail Blade" park (*"You may discard any amount of {W} Energy…"*)
// or a Mewtwo VSTAR "Psy Purge" park (*"Discard up to 3…"*) reached this dialog as
// a MANDATORY one-per-Pokémon pick, and the server then refused whatever it sent.
//
// 🛑 **AND WHEN THE SCHEMA GAINED THE MEMBER, `tsc` NAMED EXACTLY TWO OF THE SIX
// SITES.** The two that read `scope.count` went red at once (`OnlineHud.tsx:1109`
// and `:1110`, MEASURED). The other four compiled perfectly and were wrong:
//   ① the `"each"` PRE-ANSWER seeded `picked` for every single-candidate group, so
//      a declinable park opened with rows already pressed;
//   ② `required` fell through to `groups.length`, so Confirm demanded one Energy
//      per host on a question whose legal answers START at zero;
//   ③ the CAPTION fell through to the `"each"` string — *"Pick one Energy from each
//      Pokémon"* over a prompt that asks for any amount;
//   ④ the per-row `refused` marker never fired, so the (`max`+1)th pick was
//      silently inert with no `aria-disabled` to announce it.
// **A `tsc` pass is a LOWER BOUND on the sites a union member touches**, which is
// the generalisation this file is the instrument for. Each rung below names its
// declared mutant.
//
// ⚠️ THE LOCAL HUD had every one of the four right since 0.47.0, so this is a PORT
// and not a design. The two HUDs must split the same way or the same prompt gets
// two different interactions on two screens (D412's third-read-site rule).

import type { RedactedCard, RedactedGame, RedactedInPlay } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  deckCount: 53,
  discard: [],
};

function card(id: string, name: string): RedactedCard {
  return { id, cardId: id, name, category: "Energy", trainerType: null, hasImage: false };
}

function body(id: string, name: string, energies: RedactedCard[]): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: {
      damage: 0,
      hp: 120,
      conditions: { rotation: "none", poisonDamage: 0, burned: false, confusionDamage: 30 },
    },
    attached: { tools: [], energies },
  };
}

const OPP_ACTIVE = { seat: "p2", spot: { spot: "active" } } as const;
const OPP_BENCH0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;

type Prompt = Extract<
  NonNullable<Extract<RedactedGame["phase"], { kind: "effect:choose" }>["prompt"]>,
  { kind: "discardEnergy" }
>;

/** ⚠️ **ONE ENERGY PER HOST, ON TWO HOSTS — AND THAT SHAPE IS THE WHOLE POINT.**
    It is exactly the board on which `"each"` PRE-ANSWERS both groups (each group
    holds a single candidate) and on which `required` would come out as 2. So a
    dialog that fell through to the `each` arm is indistinguishable from a correct
    one on any other board, and distinguishable from it on this one at four places
    at once. */
function upToGame(max: number): RedactedGame {
  const prompt: Prompt = {
    kind: "discardEnergy",
    discardable: [
      { uid: "e1", from: OPP_ACTIVE },
      { uid: "e2", from: OPP_BENCH0 },
    ],
    scope: { kind: "upTo", max },
    note: "You may discard any amount of Water Energy from your Pokémon.",
  };
  return {
    seat: "p1",
    turn: 3,
    phase: { kind: "effect:choose", prompt },
    board: {
      stadium: null,
      you: EMPTY_SIDE,
      opponent: {
        ...EMPTY_SIDE,
        active: body("oa", "Their Active", [card("e1", "Water Energy")]),
        bench: [body("ob", "Their Bench", [card("e2", "Fire Energy")])],
      },
    },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

describe("🛑 OnlineHud discardEnergy — the `upTo` scope D543 Part 0 made reachable", () => {
  it("🛑 ① NOTHING IS PRE-ANSWERED and ② CONFIRM IS ENABLED AT ZERO PICKS", () => {
    // `D543-online-ready-demands-full-cap` is the declared row for ②. Both halves
    // are asserted in one rung because they are one defect seen twice: the `each`
    // pre-answer would ALSO make Confirm read 2/2 and look enabled for the wrong
    // reason, so a rung that only checked `disabled` could pass on a pre-answered
    // dialog.
    render(
      <OnlineHud game={upToGame(2)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />,
    );
    for (const name of ["Water Energy", "Fire Energy"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Discard none" });
    expect(confirm.disabled).toBe(false);
  });

  it("🛑 ③ THE CAPTION DOES NOT READ THE `each` STRING", () => {
    // `D543-online-caption-says-each`. Asserted in BOTH directions — the right
    // sentence present and the wrong one absent — because a build that renders both
    // (or neither) is a different defect from one that renders the wrong one.
    render(
      <OnlineHud game={upToGame(2)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />,
    );
    expect(screen.getByText(/Pick any amount of Energy to discard \(0 selected\)\./)).toBeTruthy();
    expect(screen.queryByText(/Pick one Energy from each Pokémon/)).toBeNull();
    // …and the heading beside it is the engine's own caption, byte for byte, so a
    // label that contradicts the sentence above it cannot pass (D542's rule).
    expect(
      screen.getByText("You may discard any amount of Water Energy from your Pokémon."),
    ).toBeTruthy();
  });

  it("🛑 ④ THE (max+1)th PICK IS REFUSED, and the row SAYS SO", () => {
    // `D543-online-cap-not-enforced`. At `max: 1` the second row must go
    // `aria-disabled` and clicking it must change nothing — not "do nothing
    // silently", which is the state a user cannot read.
    render(
      <OnlineHud game={upToGame(1)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Water Energy" }));
    expect(screen.getByRole("button", { name: "Water Energy" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const second = screen.getByRole("button", { name: "Fire Energy" });
    expect(second.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Discard 1" })).toBeTruthy();
    // ⚠️ AND IT STAYS FOCUSABLE: the rows are how you read the offer, so dropping
    // them out of the tab order at the cap would hide half the board from a
    // keyboard user mid-decision (the local HUD's stated rule).
    expect((second as HTMLButtonElement).disabled).toBe(false);
  });

  it("🛑 THE DECLINE DISPATCHES `uids: []` — an answer, not a dead button", () => {
    // The half that matters on the wire: an empty answer must be SENT. A dialog
    // that dispatches nothing leaves the match parked forever, which is the
    // soft-lock this whole family of rungs exists to prevent.
    const onAction = vi.fn();
    render(<OnlineHud game={upToGame(2)} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard none" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
  });

  it("a partial pick dispatches exactly what was pressed, and the label counts it", () => {
    const onAction = vi.fn();
    render(<OnlineHud game={upToGame(2)} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Fire Energy" }));
    expect(screen.getByText(/\(1 selected\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard 1" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: ["e2"] },
    });
  });

  it("pressing a selected row CLEARS it — never a replace-at-1, since 0 is legal", () => {
    // The `total`/count-1 arm REPLACES the single pick; `upTo` must not, because
    // there is no mandatory pick to swap and clearing is how a player declines
    // after changing their mind.
    render(<OnlineHud game={upToGame(1)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    const first = screen.getByRole("button", { name: "Water Energy" });
    fireEvent.click(first);
    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Discard none" })).toBeTruthy();
  });

  it("⚠️ THE MANDATORY SCOPES ARE UNTOUCHED — the port did not over-correct", () => {
    // The other direction of the same defect: a fix that made everything declinable
    // would be just as green on the rungs above. `total` still gates Confirm to the
    // exact count and still pre-answers nothing.
    const game = upToGame(2);
    const mandatory: RedactedGame = {
      ...game,
      phase: {
        kind: "effect:choose",
        prompt: {
          kind: "discardEnergy",
          discardable: [
            { uid: "e1", from: OPP_ACTIVE },
            { uid: "e2", from: OPP_BENCH0 },
          ],
          scope: { kind: "total", count: 2 },
          note: "Discard 2 Energy.",
        },
      },
    };
    render(<OnlineHud game={mandatory} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /Discard 0\/2/ });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Pick 2 Energy to discard \(0\/2\)\./)).toBeTruthy();
  });

  it("⚠️ …and so is `each`, which is the value the BROKEN ternary happened to return", () => {
    // Without this rung a "fix" that mapped every scope to `upTo` would pass every
    // other assertion in this file. `each` still pre-answers its single-candidate
    // groups and still gates Confirm to one pick per host.
    const game = upToGame(2);
    const each: RedactedGame = {
      ...game,
      phase: {
        kind: "effect:choose",
        prompt: {
          kind: "discardEnergy",
          discardable: [
            { uid: "e1", from: OPP_ACTIVE },
            { uid: "e2", from: OPP_BENCH0 },
          ],
          scope: { kind: "each" },
          note: "Discard a Special Energy from each of your opponent's Pokémon.",
        },
      },
    };
    render(<OnlineHud game={each} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    expect(screen.getByText(/Pick one Energy from each Pokémon \(2\/2\)\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Water Energy" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
