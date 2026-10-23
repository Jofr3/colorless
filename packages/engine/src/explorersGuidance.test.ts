import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  EXPLORERS_GUIDANCE_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
  trimDeckTo,
  findEvent,
} from "./testFixtures";

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

const deckAt = (state: GameState, index: number): string => {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`no card at deck index ${index}`);
  return uid;
};

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: EXPLORERS_GUIDANCE_DECK, p2: EXPLORERS_GUIDANCE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-item", 1); // index 5
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 4
  next = toDeckTop(next, "p1", "fix-energy", 2); // indices 2-3
  next = toDeckTop(next, "p1", "fix-basic-1", 2); // indices 0-1
  return next;
}

/** Play `id` out of p1's hand onto the seeded window and return the parked
    chooseCards prompt with it. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked, events } = mustApply(seededState, {
    type: "playTrainer",
    seat: "p1",
    uid,
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { seededState, parked, prompt: parked.phase.prompt, events };
}

describe("D334 — Explorer's Guidance, the mandatory take and the discarded leftovers", () => {
  it("the registry resolves a program for all THREE printings AND for the demonstrator", () => {
    for (const id of ["sv05-147", "sv05-200", "sv08.5-107", "fix-explorersguidance"]) {
      expect(programFor(id), id).toBeDefined();
    }
    expect(programFor("sv05-200")).toBe(programFor("sv05-147"));
    expect(programFor("sv08.5-107")).toBe(programFor("sv05-147"));
    expect(programFor("fix-explorersguidance")).toBe(programFor("sv05-147"));
  });

  it("the program is Great Ball's op with all four fields moved — read off the registry", () => {
    // The attribution control, before any board runs: Great Ball is the SAME op,
    // and naming every field that differs is what makes each board below
    // attributable to one of them rather than to "the two cards are different".
    const eg = programFor("fix-explorersguidance")?.trainer?.[0];
    const greatBall = programFor("sv02-183")?.trainer?.[0];
    if (eg?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (greatBall?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(eg.n).toBe(6);
    expect(eg.filter).toEqual({ kind: "anyCard" });
    expect(eg.max).toBe(2);
    expect(eg.exact).toBe(true);
    expect(eg.restTo).toBe("discard");
    expect(eg.reveal).toBeUndefined();
    expect(eg.also).toBeUndefined();
    // Great Ball differs in every one of them.
    expect(greatBall.exact).toBeUndefined();
    expect(greatBall.restTo).toBeUndefined();
    expect(greatBall.filter).toEqual({ kind: "anyPokemon" });
    expect(greatBall.max).toBe(1);
  });

  it("there is NO trailing `shuffleDeck`, and the absence is PRINTED", () => {
    expect(programFor("fix-explorersguidance")?.trainer).toHaveLength(1);
    expect(programFor("sv02-183")?.trainer).toHaveLength(2);
    expect(programFor("sv02-183")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).toBe(
      "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards.",
    );
    expect(FIXTURE_POOL["fix-explorersguidance"]?.trainerType).toBe("Supporter");
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).not.toContain("up to");
    expect(FIXTURE_POOL["fix-explorersguidance"]?.effect).not.toContain("you may");
  });

  it("offers EVERY card in the window — the print names no noun", () => {
    const state = board(11);
    const { seededState, prompt } = play(state, "fix-explorersguidance");
    const window = [0, 1, 2, 3, 4, 5].map((i) => deckAt(seededState, i));
    expect([...prompt.candidates].sort()).toEqual([...window].sort());
    expect(prompt.candidates).toHaveLength(6);
    // …and the card at index 6 is past the printed window.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 6));
  });

  it("the floor is the PRINTED TAKE, not zero — `min === max === 2`", () => {
    const state = board(12);
    const { prompt } = play(state, "fix-explorersguidance");
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt).not.toHaveProperty("caps");
  });

  it("the caption drops the 'up to' — the printed words, not the field's default", () => {
    const state = board(13);
    const { prompt } = play(state, "fix-explorersguidance");
    expect(prompt.note).toBe(
      "Look at the top 6 cards of your deck and put 2 cards into your hand.",
    );
    expect(prompt.note).not.toContain("up to");
  });

  it("a SHORT answer is refused by the wire validator, on both sides of the floor", () => {
    const state = board(14);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [deckAt(seededState, 0)] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the CEILING still holds from the other side: three is not two either.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "cards",
          uids: [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the take goes to hand and the OTHER FOUR go to the discard pile", () => {
    const state = board(15);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    const window = [0, 1, 2, 3, 4, 5].map((i) => deckAt(seededState, i));
    // Deliberately NOT the top two: the leftovers are `window \ picked`, so picking
    // out of the middle is what separates that from "the top 2" or "the bottom 4".
    const taken = [window[1] as string, window[4] as string];
    const leftovers = window.filter((uid) => !taken.includes(uid));
    const deckBefore = seededState.players.p1.deck.length;
    const discardBefore = parked.players.p1.discard.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: taken },
    });
    for (const uid of taken) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.discard).not.toContain(uid);
    }
    expect(done.players.p1.discard.slice(discardBefore)).toEqual(leftovers);
    expect(findEvent(events, "DECK_TOP_DISCARDED")).toEqual({
      type: "DECK_TOP_DISCARDED",
      seat: "p1",
      actor: "p1",
      uids: leftovers,
    });
    // The whole window left the deck — six out, two to hand and four to the pile,
    // and nothing stranded in neither zone.
    expect(done.players.p1.deck).toHaveLength(deckBefore - 6);
    for (const uid of window) expect(done.players.p1.deck).not.toContain(uid);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("the LOOK row names only the TAKEN cards, and carries no `dest` and no `reveal`", () => {
    const state = board(16);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    const taken = [deckAt(seededState, 0), deckAt(seededState, 3)];
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: taken },
    });
    expect(findEvent(events, "DECK_TOP_REVEALED")).toEqual({
      type: "DECK_TOP_REVEALED",
      seat: "p1",
      uids: taken,
    });
    // …and the LOOK precedes the DISCARD: the player saw the six before four of
    // them left.
    expect(types(events).indexOf("DECK_TOP_REVEALED")).toBeLessThan(
      types(events).indexOf("DECK_TOP_DISCARDED"),
    );
  });

  it("NOTHING SHUFFLES — the deck below the window keeps its exact order", () => {
    const state = board(17);
    const { seededState, parked } = play(state, "fix-explorersguidance");
    const tail = seededState.players.p1.deck.slice(6);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [deckAt(seededState, 0), deckAt(seededState, 1)] },
    });
    expect(done.players.p1.deck).toEqual(tail);
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("GREAT BALL ON THE SAME SEEDED BOARD DIFFERS IN ALL FOUR — the attribution control", () => {
    const state = board(18);
    const { seededState, parked, prompt } = play(state, "sv02-183");
    expect(prompt.candidates).toEqual([deckAt(seededState, 0), deckAt(seededState, 1)]);
    expect(prompt.min).toBe(0); // the printed "you may"
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon into your hand.",
    );
    const tail = seededState.players.p1.deck.slice(1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [deckAt(seededState, 0)] },
    });
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    // …and its trailing `shuffleDeck` then scrambles them, which is exactly the
    // tail-order fact the case above proves this card does NOT have.
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.deck).not.toEqual(tail);
    expect([...done.players.p1.deck].sort()).toEqual([...tail].sort());
  });

  it("A SHORT DECK CLAMPS THE FLOOR — the one obligation `max` never had", () => {
    const state = board(19);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    // ONE card left under a printed window of six: the candidate set is smaller than
    // the printed take, and an unclamped `min: 2` here is a prompt with no legal
    // answer at all — the player can never leave the phase.
    const short = trimDeckTo(withCard, "p1", 1);
    const only = deckAt(short, 0);
    const uid = handUid(short, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(short, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.min).toBe(1);
    expect(parked.phase.prompt.max).toBe(2);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [only] },
    });
    expect(done.players.p1.hand).toContain(only);
    // The whole window was taken, so there are no leftovers and the event that
    // "only fires with ≥1 card" does not fire.
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(done.players.p1.deck).toHaveLength(0);
  });

  it("a window SHORTER than `n` still discards what is left of it", () => {
    const state = board(20);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const short = trimDeckTo(seeded(withCard), "p1", 3);
    const window = [0, 1, 2].map((i) => deckAt(short, i));
    const uid = handUid(short, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(short, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // Three candidates, a floor of two, and ONE leftover — the case that proves the
    // leftovers are the window minus the picks rather than a fixed `n - max`.
    expect(parked.phase.prompt.candidates).toHaveLength(3);
    expect(parked.phase.prompt.min).toBe(2);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[2] as string] },
    });
    expect(findEvent(events, "DECK_TOP_DISCARDED")?.uids).toEqual([window[1]]);
    expect(done.players.p1.deck).toHaveLength(0);
  });

  it("AN EMPTY DECK LOOKS AT NOTHING AND DISCARDS NOTHING — no row either way", () => {
    const state = board(21);
    const withCard = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const empty = trimDeckTo(withCard, "p1", 0);
    const uid = handUid(empty, "p1", "fix-explorersguidance");
    const { state: done, events } = mustApply(empty, { type: "playTrainer", seat: "p1", uid });
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(done.phase.kind).toBe("turn:action");
  });
});
