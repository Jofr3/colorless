// @vitest-environment jsdom
// M5 op-slice `attachFromDeck` on the WEB side. The op reuses the EXISTING
// attachCards prompt and emits only events the log already knows
// (ENERGY_ATTACHED, STATUS_APPLIED, SHUFFLE), so the claim under test is that
// the HUD needed exactly one change: the prompt's new `maxPerTarget`.
//
// That one field is load-bearing in three places, and each is a case below:
//
//   • a target that already has its one Energy must be REFUSED in the dialog,
//     not merely rejected on dispatch — Janine's is the first prompt where a
//     legal-looking pairing is illegal, and the engine's rejection surfaces as
//     the D19 error pill with no explanation of which pairing was wrong;
//   • a per-target cap can leave a picked card with NOWHERE legal to go, a dead
//     end whose exit (tap the card again) is invisible from a list of refused
//     rows — so the live region has to say it;
//   • it rides `promptKey`, because an assignment gathered under "in any way you
//     like" is not a legal answer to a one-apiece prompt.
//
// Plus the end-to-end read: Janine's whole play in the game log, in printed
// order, including the self-poison the §9.2 gate applies.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import {
  ATTACH_FROM_DECK_DECK,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { logFromEvents } from "@luminous/engine";
import type { SeatLogEntry } from "@luminous/schema";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const JANINE = "sv06.5-059";
const DARK_BODY = "fix-dark-1";
const SEED = 20260722;
const decks = { p1: ATTACH_FROM_DECK_DECK, p2: ATTACH_FROM_DECK_DECK };

/** Setup, then open P1's turn 2 (P2 first, then passes) — Supporters play. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1's board rebuilt from nothing (setup deals whatever Basic it likes, and
    this pool holds {D} bodies) — see the engine suite's own `withBoard`. */
function withBoard(state: GameState, activeId: string, benchIds: readonly string[]): GameState {
  const side = state.players.p1;
  const returned = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, active: null, bench: [], deck: [...side.deck, ...returned] },
    },
  };
  next = setActiveFromDeck(next, "p1", activeId);
  for (const id of benchIds) next = benchFromDeck(next, "p1", id);
  return next;
}

/** Janine played, parked on her attachCards prompt, with `benched` extra {D}
    bodies beside the {D} Active. */
function parkedJanine(benched: number): GameState {
  let state = withBoard(p1Turn2(SEED), DARK_BODY, Array<string>(benched).fill(DARK_BODY));
  state = handFromDeck(state, "p1", JANINE, 1);
  const played = mustApply(state, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(state, "p1", JANINE),
  }).state;
  if (played.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return played;
}

function hud(state: GameState, dispatch: (action: GameAction) => void) {
  return (
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />
  );
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void) {
  return render(hud(state, dispatch));
}

/** The candidate rows — two collapsed Basic {D}, sharing a name, told apart
    only by position (the honest situation: they are interchangeable cards). */
const cardRows = () => screen.getAllByRole("button", { name: /Darkness Energy/ });

/** Log rows as "<seat> <text>". The SEAT rides every row on purpose — this
    log has already shipped a row filed under the wrong seat once (D43,
    `ENERGY_DISCARDED`), and Janine's self-poison is the case that invites it:
    every other `STATUS_APPLIED` in the game lands on the OPPONENT's Pokémon, so
    "the status row belongs to the other player" is a rule that holds everywhere
    until this card. */
function texts(entries: SeatLogEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "turn"
      ? `— turn ${entry.turn} —`
      : `${entry.who} ${entry.segments.map((segment) => segment.text).join("")}`,
  );
}

describe("the one-apiece cap in the dialog", () => {
  it("refuses a Pokémon that already has one, rather than letting the engine reject it", () => {
    // Without this the pairing is buildable, Confirm dispatches it, and the
    // engine answers BAD_EFFECT_CHOICE — surfaced as the pill, which says
    // nothing about WHICH of the two pairings was the illegal one.
    const state = parkedJanine(1);
    renderHud(state, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    fireEvent.click(cardRows()[1] as HTMLElement);

    const full = screen.getByRole("button", { name: `${DARK_BODY} · Active — already has one` });
    expect(full.getAttribute("aria-disabled")).toBe("true");
    // The VISIBLE badge too, not only the accessible name — the rule this file's
    // sibling states about the card rows ("deleting both spans rendered blank
    // buttons and passed"): a sighted player reads the refusal off the badge, and
    // every other assertion here would still pass with it deleted.
    //
    // And it keeps the SPOT beside the state. This board is the reason: two
    // Pokémon named `fix-dark-1`, so a badge reading "has one" ALONE leaves the
    // visible list as "fix-dark-1 / has one" over "fix-dark-1 / Bench 1", and
    // which one is refused is then only resolvable by elimination.
    expect(full.textContent).toContain("Active · has one");
    expect(
      screen.getByRole("button", { name: `${DARK_BODY} · Bench 1` }).textContent,
    ).toContain("Bench 1");
    fireEvent.click(full);
    // Still waiting for a destination — the click did nothing, and the row that
    // CAN take it is still offered.
    expect(screen.getByRole("button", { name: `${DARK_BODY} · Bench 1` })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach 1" })).toBeTruthy();
  });

  it("lets the second card go to a DIFFERENT Pokémon, and the engine accepts it", () => {
    const state = parkedJanine(1);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    fireEvent.click(cardRows()[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Bench 1` }));
    fireEvent.click(screen.getByRole("button", { name: "Attach 2" }));

    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments.map((a) => a.to.spot.spot)).toEqual(["active", "bench"]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("shows a ONE-row, 0/1 offer when only one Pokémon is eligible", () => {
    // The engine clamps `max` by `targets × maxPerTarget`, so the board where
    // "up to 2" can only ever be 1 arrives here already honest: one row, "0/1".
    // The dialog must not invent the second card back — this is the assertion
    // that fails if the clamp is ever dropped and the dialog starts counting
    // "0/2" over a ceiling of one.
    const state = parkedJanine(0);
    renderHud(state, vi.fn());
    expect(cardRows()).toHaveLength(1);
    // One target ⇒ no "then where it goes" step is coming, and the tap below
    // attaches outright (a list of one is not a decision — the dialog's rule).
    expect(screen.getByText("Attaching 0/1. Pick a card to attach.")).toBeTruthy();
    fireEvent.click(cardRows()[0] as HTMLElement);
    // Both ways of being at the cap are true at once here (one card, one target),
    // and the specific sentence is the one that wins — "1/1" alone leaves the
    // player wondering where the printed second Energy went. Under a sole
    // target it NAMES the Pokémon that ran out of room.
    expect(
      screen.getByText(
        `Attaching 1/1. ${DARK_BODY} already has one — tap the attached card to take it back.`,
      ),
    ).toBeTruthy();
  });

  it("tapping the pending card again is the way back out", () => {
    // The only exit from a pending pick. A parked decision cannot be dismissed —
    // no decline, and Escape is swallowed — so the target list has to be
    // closeable from the card that opened it. Both new comments in the dialog
    // lean on this ("the way out (tap the card again)") and nothing pinned it:
    // a `setPending` that dropped its toggle-off would leave the list stuck open
    // with no visible way to change your mind about WHICH card to place.
    const state = parkedJanine(1);
    renderHud(state, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement);
    expect(screen.getByRole("button", { name: `${DARK_BODY} · Active` })).toBeTruthy();
    fireEvent.click(cardRows()[0] as HTMLElement);
    expect(screen.queryByRole("button", { name: `${DARK_BODY} · Active` })).toBeNull();
    expect(screen.getByText("Attaching 0/2. Pick a card, then where it goes.")).toBeTruthy();
    expect((cardRows()[0] as HTMLElement).getAttribute("aria-current")).toBeNull();
  });

  it("re-opens the offer when the attached card is released", () => {
    // The undo has to lift the refusal too, or the dialog is a one-way door.
    const state = parkedJanine(1);
    renderHud(state, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    expect((cardRows()[0] as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: `Darkness Energy → ${DARK_BODY} · Active` }),
    );
    expect(screen.getByText("Attaching 0/2. Pick a card, then where it goes.")).toBeTruthy();
    expect((cardRows()[0] as HTMLElement).getAttribute("aria-pressed")).toBe("false");
  });

  it("survives an UNCLAMPED offer without stranding the player (the belt)", () => {
    // No engine path produces this: `attachFromDeckOffer` clamps `max` by
    // `targets × maxPerTarget`, so "every target full" always coincides with the
    // count cap. The guard is kept anyway, for the reason this dialog already
    // keeps a dead-today filter on its dispatch — the failure mode if an offer
    // ever arrives unclamped is not a bad attach, it is a picked card facing a
    // list of rows that all refuse it with no visible way back. So the prompt is
    // forced past the clamp here and the dialog is required to stay coherent.
    const parked = parkedJanine(0);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    // A SECOND Basic {D} the clamp kept out of the offer — and not the one
    // already in it, or both rows would render the same uid and the "second row
    // is refused" assertion would be reading the first row's own assignment.
    const offered = new Set(parked.phase.prompt.candidates);
    const extra = parked.players.p1.deck.find(
      (uid) => !offered.has(uid) && parked.cardIdByUid[uid] === "fix-dark-energy",
    );
    expect(extra).toBeDefined();
    const unclamped: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        prompt: {
          ...parked.phase.prompt,
          max: 2,
          candidates: [...parked.phase.prompt.candidates, extra as string],
        },
      },
    };
    renderHud(unclamped, vi.fn());
    expect(cardRows()).toHaveLength(2);
    // Sole target ⇒ the tap attaches outright — which makes the unclamped
    // stranding SHORTER to reach, not impossible: the first attach fills the
    // only Pokémon while the count still reads 1/2.
    fireEvent.click(cardRows()[0] as HTMLElement);
    // 1 of 2 attached, but the only target is full — the second row is closed
    // off and the sentence says why, rather than reading "pick a card".
    expect(
      screen.getByText(
        `Attaching 1/2. ${DARK_BODY} already has one — tap the attached card to take it back.`,
      ),
    ).toBeTruthy();
    const second = cardRows()[1] as HTMLElement;
    expect(second.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(second);
    expect(screen.queryByRole("button", { name: `${DARK_BODY} · Active` })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach 1" })).toBeTruthy();
  });

  it("remounts when the SAME offer arrives one-apiece — the field rides promptKey", () => {
    // The third place the field is load-bearing, and the only one the header
    // above claimed without pinning. Two parks that differ ONLY in
    // `maxPerTarget` share every other half of the key — same cards, same
    // targets, same `max` — so a key that dropped it would carry picks gathered
    // under "in any way you like" (both Energy on ONE Pokémon) into a prompt
    // that refuses exactly that, with the dialog reading "Attach 2" and Confirm
    // dispatching an answer the engine rejects. The pill that surfaces the
    // rejection says nothing about which pairing was wrong, and the dispatch
    // filter beside it cannot help: both uids ARE still on offer.
    //
    // Both prompts are hand-built off one real park (the belt's technique) —
    // no catalog card pairs an "in any way you like" search with a one-apiece
    // one, and the key's job is not to depend on that.
    const parked = parkedJanine(1);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    const oneApiece = parked.phase.prompt;
    const anyWay: GameState = {
      ...parked,
      phase: { ...parked.phase, prompt: { ...oneApiece, maxPerTarget: undefined } },
    };
    const dispatch = vi.fn();
    const { rerender } = renderHud(anyWay, dispatch);
    // Both onto the Active — legal under "in any way you like", and the Active
    // row is still offered for the second card precisely because the cap is off.
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    fireEvent.click(cardRows()[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    expect(screen.getByRole("button", { name: "Attach 2" })).toBeTruthy();

    rerender(hud(parked, dispatch));
    expect(screen.getByRole("button", { name: "Attach none" })).toBeTruthy();
    expect(screen.queryByText(new RegExp(`→ ${DARK_BODY}`))).toBeNull();
    expect(screen.getByText("Attaching 0/2. Pick a card, then where it goes.")).toBeTruthy();
    // What the stale picks would have dispatched, and why it must not survive.
    const [first, second] = oneApiece.candidates;
    const stale = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: first as string, to: { seat: "p1", spot: { spot: "active" } } },
          { uid: second as string, to: { seat: "p1", spot: { spot: "active" } } },
        ],
      },
    });
    expect(stale.ok).toBe(false);
  });

  it("🆕 D457 — under `oneTarget` the SECOND body closes, and it is told the right reason", () => {
    // The dual rule at the dialog: `maxPerTarget` closes a body that already has
    // its share, `oneTarget` closes every body the batch is NOT going to. Both
    // ride one predicate, so this is the case that says the predicate reads the
    // right field — and the BADGE is the half a shared predicate would get wrong:
    // "already has one" over a Pokémon holding nothing is the dialog stating a
    // false fact about the board.
    //
    // Hand-built off one real park (the belt's technique, and the file's): no
    // catalog card in this pool prints the "1 of your Pokémon" search, and the
    // dialog's job is not to depend on that.
    const parked = parkedJanine(1);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    const oneOf: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        prompt: { ...parked.phase.prompt, maxPerTarget: undefined, oneTarget: true },
      },
    };
    const dispatch = vi.fn();
    renderHud(oneOf, dispatch);
    fireEvent.click(cardRows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: `${DARK_BODY} · Active` }));
    fireEvent.click(cardRows()[1] as HTMLElement);
    // The Bench body has taken NOTHING and is closed anyway — and says why.
    const elsewhere = screen.getByRole("button", {
      name: `${DARK_BODY} · Bench 1 — they all go on 1 Pokémon`,
    });
    expect(elsewhere.getAttribute("aria-disabled")).toBe("true");
    // …while the body the batch IS going to stays open for the second card.
    const chosen = screen.getByRole("button", { name: `${DARK_BODY} · Active` });
    expect(chosen.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(chosen);
    fireEvent.click(screen.getByRole("button", { name: "Attach 2" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    // 🛑 AND THE ENGINE AGREES — the dialog offered exactly what the validator
    // accepts, which is the whole property this rung exists for (a HUD that
    // merely greyed rows out could still compose a refused answer).
    expect(call.choice.assignments.map((a) => a.to.spot.spot)).toEqual(["active", "active"]);
    expect(applyAction(oneOf, call).ok).toBe(true);
  });
});

describe("the prompt the player actually reads", () => {
  it("renders the engine's note — the attach AND the poison it can buy", () => {
    const state = parkedJanine(1);
    renderHud(state, vi.fn());
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    const note = state.phase.prompt.note;
    // The §9.2 half is what the last slice's HIGH was about: a prompt that
    // described only its own op left the player forfeiting a clause silently.
    expect(note).toContain("If you attach one to your Active Pokémon, it is now Poisoned.");
    expect(screen.getByRole("heading", { name: note })).toBeTruthy();
  });

  it("offers only the {D} Pokémon as targets", () => {
    let state = withBoard(p1Turn2(SEED), DARK_BODY, [DARK_BODY, "fix-basic-1"]);
    state = handFromDeck(state, "p1", JANINE, 1);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", JANINE),
    }).state;
    renderHud(parked, vi.fn());
    fireEvent.click(cardRows()[0] as HTMLElement);
    expect(screen.getByRole("button", { name: `${DARK_BODY} · Active` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${DARK_BODY} · Bench 1` })).toBeTruthy();
    // The Colorless body is in play and is NOT offered.
    expect(screen.queryByRole("button", { name: "fix-basic-1 · Bench 2" })).toBeNull();
  });
});

describe("the log reads Janine's whole play, in printed order", () => {
  it("names both attaches, the shuffle and the self-poison", () => {
    const state = parkedJanine(1);
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    const [first, second] = state.phase.prompt.candidates;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: first as string, to: { seat: "p1", spot: { spot: "active" } } },
          { uid: second as string, to: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        ],
      },
    });
    const rows = texts(logFromEvents(done.events, { names: NAMES, state: done.state, elapsed: "+00:09" }));
    // The WHOLE batch, in order, seats included — "some row mentions Energy"
    // cannot tell one attach from two, and the card printed two.
    expect(rows).toEqual([
      `p1 attached Darkness Energy → ${DARK_BODY}`,
      `p1 attached Darkness Energy → ${DARK_BODY}`,
      "p1 shuffled their deck",
      `p1 ${DARK_BODY} is now Poisoned`,
    ]);
    // The poison is the LAST thing that happens — it is the card's last printed
    // sentence, and it is gated on the attaches above it. And it is filed under
    // the CONTROLLER: `who` is the owner of the poisoned Pokémon, which for every
    // other card in the game is the opponent and for this one is you.
    const poisonAt = rows.findIndex((row) => row.includes("Poisoned"));
    const attachAt = rows.findIndex((row) => row.includes("Darkness Energy"));
    expect(poisonAt).toBeGreaterThan(attachAt);
  });

  it("says nothing about poison when both Energy went to the Bench", () => {
    const state = parkedJanine(2);
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards prompt");
    }
    const [first, second] = state.phase.prompt.candidates;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: first as string, to: { seat: "p1", spot: { spot: "bench", index: 0 } } },
          { uid: second as string, to: { seat: "p1", spot: { spot: "bench", index: 1 } } },
        ],
      },
    });
    const rows = texts(logFromEvents(done.events, { names: NAMES, state: done.state, elapsed: "+00:09" }));
    // The positive half rides along: "no row says Poisoned" is also true of a log
    // that dropped the whole batch, so the two attaches and the shuffle have to
    // be asserted PRESENT for the absence to mean the gate declined.
    expect(rows).toEqual([
      `p1 attached Darkness Energy → ${DARK_BODY}`,
      `p1 attached Darkness Energy → ${DARK_BODY}`,
      "p1 shuffled their deck",
    ]);
  });
});

describe("the Trainer row", () => {
  it("is playable with no {D} Pokémon in play — the recorded, ungated call", () => {
    // Janine has no printed play gate, so the button must be LIT: the deck
    // shuffle always resolves (ruling/284). A HUD that greyed it out would be
    // making a rule the card does not print.
    let state = withBoard(p1Turn2(SEED), "fix-basic-1", []);
    state = handFromDeck(state, "p1", JANINE, 1);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const button = screen.getByRole("button", { name: JANINE }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("playTrainer");
    expect(applyAction(state, call).ok).toBe(true);
  });
});
