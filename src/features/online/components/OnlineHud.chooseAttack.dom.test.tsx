// @vitest-environment jsdom
// D201 — `chooseAttack` (D157's prompt kind) on the ONLINE surface, and the
// exhaustiveness floor that makes the class of bug impossible.
//
// THE DEFECT THIS FILE PINS WAS LIVE, not hypothetical. `chooseAttack` shipped
// with its schema arm, its redactor arm (`redactPrompt`), its projection arm and
// its LOCAL dialog — and no arm in `OnlineHud`'s `EffectChooseDialog`, whose
// switch had no declared return type. An online Medicham sv01-111 /
// Oranguru sv02-094 attack therefore parked an `effect:choose` whose prompt the
// server DID deliver (the redactor emits it to the controller, `attack` and
// `resolveEffect` are both on the DO's action allowlist) and the client rendered
// nothing at all — a phase with no decline that swallows Escape. The first
// describe drives the arm; the second pins the floor.
//
// Hand-built wire snapshots, like every sibling online test — the online client
// only ever holds a `RedactedGame`.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RedactedEffectPrompt, RedactedGame } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const NOTE = "Choose 1 of Medicham's attacks — it can't use that attack next turn.";

/** The redactor's own output shape for Medicham sv01-111: two printed attacks,
    resolved to `{index, name}` pairs because an index resolves against nothing
    the client holds. */
const MEDICHAM: Extract<RedactedEffectPrompt, { kind: "chooseAttack" }> = {
  kind: "chooseAttack",
  candidates: [
    { index: 0, name: "Acu-Punch-Ture" },
    { index: 1, name: "Kick Shot" },
  ],
  note: NOTE,
};

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  deckCount: 53,
  discard: [],
};

function promptGame(prompt: RedactedEffectPrompt | null): RedactedGame {
  return {
    seat: "p1",
    turn: 3,
    phase: { kind: "effect:choose", prompt },
    board: { stadium: null, you: EMPTY_SIDE, opponent: EMPTY_SIDE },
    activePlayer: "you",
    waitingOn: prompt === null ? "opponent" : "you",
    outcome: null,
  };
}

describe("OnlineHud — effect:choose chooseAttack (D157's kind, dialoged at D201)", () => {
  it("renders the printed sentence and one row per candidate ATTACK NAME", () => {
    render(
      <OnlineHud
        game={promptGame(MEDICHAM)}
        waitingOn="you"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(NOTE)).toBeTruthy();
    // The names come off the PROMPT, not the board: the wire publishes no attack
    // rows for the opponent's Active, and this board is empty on purpose to prove
    // the dialog never reaches for one.
    const labels = [...document.querySelectorAll("dialog button")].map((b) => b.textContent);
    expect(labels).toEqual(["Acu-Punch-Ture", "Kick Shot"]);
  });

  it("dispatches the picked INDEX — the answer's whole content", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={promptGame(MEDICHAM)}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kick Shot" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attack", index: 1 },
    });
  });

  it("picking IS the answer — no Confirm row and no decline (the prompt is mandatory)", () => {
    render(
      <OnlineHud
        game={promptGame(MEDICHAM)}
        waitingOn="you"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /confirm|decline|none/i })).toBeNull();
  });

  it("renders nothing for the viewer the prompt is withheld from", () => {
    // Controller-answered, so the opponent's snapshot carries a null prompt.
    const { container } = render(
      <OnlineHud
        game={promptGame(null)}
        waitingOn="opponent"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("the wire arm parses UNCHANGED — this fix needed no schema diff", () => {
    expect(redactedEffectPromptSchema.parse(MEDICHAM)).toEqual(MEDICHAM);
  });
});

/** ONE WELL-FORMED PROMPT PER WIRE KIND, keyed by the kind itself.
 *
 *  The `Record<RedactedEffectPrompt["kind"], …>` annotation is the first half of
 *  the coverage pin and it is a TYPE error: adding a kind to
 *  `redactedEffectPromptSchema` leaves this map missing a property, at the same
 *  build that `EffectChooseDialog`'s `never` floor fails. The test below is the
 *  second half — it renders every entry and asserts a dialog appears, which is
 *  what would have caught `chooseAttack` at D157 even with the old unfloored
 *  switch (that switch compiled fine; it just rendered `undefined`). */
const ONE_PER_KIND: Record<RedactedEffectPrompt["kind"], RedactedEffectPrompt> = {
  mayDraw: { kind: "mayDraw", count: 1, note: "You may draw a card." },
  confirm: { kind: "confirm", note: "You may discard a card." },
  // 🆕 D341 — TWO candidates, not one, and that is the pin rather than a
  // flourish: `orderCards` never parks with fewer than 2 (one ordering is not a
  // decision — the op resolves it inline), so a single-candidate entry here would
  // render a dialog the engine cannot produce.
  orderCards: {
    kind: "orderCards",
    candidates: [
      {
        id: "c1",
        cardId: "sv01-196",
        name: "Ultra Ball",
        category: "Trainer",
        trainerType: "Item",
        hasImage: false,
      },
      {
        id: "c2",
        cardId: "sv01-257",
        name: "Basic Lightning Energy",
        category: "Energy",
        trainerType: null,
        hasImage: false,
      },
    ],
    note: "Put these cards back on top of your deck in any order.",
  },
  choosePokemon: {
    kind: "choosePokemon",
    candidates: [{ seat: "p1", spot: { spot: "active" } }],
    note: "Choose a Pokémon.",
  },
  choosePokemonMulti: {
    kind: "choosePokemonMulti",
    candidates: [{ seat: "p1", spot: { spot: "active" } }],
    min: 1,
    max: 2,
    declinable: false,
    note: "Choose up to 2.",
  },
  moveEnergy: {
    kind: "moveEnergy",
    movable: [{ uid: "e1", from: { seat: "p1", spot: { spot: "active" } } }],
    destinations: [{ seat: "p1", spot: { spot: "bench", index: 0 } }],
    max: 1,
    note: "Move an Energy.",
  },
  discardEnergy: {
    kind: "discardEnergy",
    discardable: [{ uid: "e1", from: { seat: "p2", spot: { spot: "active" } } }],
    scope: { kind: "total", count: 1 },
    note: "Discard an Energy.",
  },
  chooseCards: {
    kind: "chooseCards",
    candidates: [
      {
        id: "c1",
        cardId: "sv01-196",
        name: "Ultra Ball",
        category: "Trainer",
        trainerType: "Item",
        hasImage: false,
      },
    ],
    min: 0,
    max: 1,
    dest: "hand",
    note: "Choose a card.",
  },
  attachCards: {
    kind: "attachCards",
    candidates: [
      {
        id: "e1",
        cardId: "sv01-257",
        name: "Basic Lightning Energy",
        category: "Energy",
        trainerType: null,
        hasImage: false,
      },
    ],
    targets: [{ seat: "p1", spot: { spot: "active" } }],
    max: 1,
    note: "Attach an Energy.",
  },
  chooseAttack: MEDICHAM,
};

describe("OnlineHud — EffectChooseDialog covers EVERY wire prompt kind", () => {
  /** The kinds the SCHEMA actually declares, read off the discriminated union
      rather than restated — a restated list is the thing that drifted. */
  const wireKinds = redactedEffectPromptSchema.options.map((option) => option.shape.kind.value);

  it("the fixture map and the wire union hold the same kinds, BOTH directions", () => {
    // Schema → fixtures catches a kind nobody dialoged (the D157 defect);
    // fixtures → schema catches a dialog arm for a kind that no longer exists.
    expect([...wireKinds].sort()).toEqual(Object.keys(ONE_PER_KIND).sort());
  });

  it.each(wireKinds)("renders a dialog for %s — a park with no dialog is a soft-lock", (kind) => {
    const prompt = ONE_PER_KIND[kind];
    // Every fixture is a legal wire payload, so a render failure here is the
    // client's fault and not the fixture's.
    expect(redactedEffectPromptSchema.parse(prompt)).toEqual(prompt);
    const { container } = render(
      <OnlineHud
        game={promptGame(prompt)}
        waitingOn="you"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(container.querySelector("dialog")).not.toBeNull();
  });
});
