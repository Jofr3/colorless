import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { deriveAttackEffect } from "./effects";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  ROTO_STICK_DECK,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
} from "./testFixtures";

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: ROTO_STICK_DECK, p2: ROTO_STICK_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "sv01-189", 3); // three Supporters, indices 0-2…
  next = toDeckTop(next, "p1", "fix-energy", 1); // …pushed to 1-3 by a non-Trainer…
  next = toDeckTop(next, "p1", "fix-item", 1); // …and to 2-4 by an Item, so index 4 is buried
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

describe("D333 — Roto-Stick, the unbounded lookAtTopN window", () => {
  it("the registry resolves a program for the printing AND for the demonstrator", () => {
    expect(programFor("sv08.5-127")).toBeDefined();
    expect(programFor("fix-rotostick")).toBeDefined();
    expect(programFor("fix-rotostick")).toBe(programFor("sv08.5-127"));
  });

  it("the program is Pokégear's with the cap taken off — read off the registry", () => {
    // The attribution control, before any board runs: Pokégear 3.0 is this program
    // with the SAME filter under a NUMERIC cap, so every difference the boards
    // observe below is attributable to the `max` spelling and to nothing else.
    const roto = programFor("fix-rotostick")?.trainer?.[0];
    const pokegear = programFor("sv01-186")?.trainer?.[0];
    if (roto?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (pokegear?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(roto.filter).toEqual(pokegear.filter);
    expect(roto.reveal).toBe(pokegear.reveal);
    expect(roto.max).toBe("any");
    expect(pokegear.max).toBe(1);
    expect(roto.n).toBe(4);
    expect(roto.also).toBeUndefined();
    expect(programFor("fix-rotostick")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    expect(FIXTURE_POOL["fix-rotostick"]?.effect).toBe(
      "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
    );
    expect(FIXTURE_POOL["fix-rotostick"]?.trainerType).toBe("Item");
  });

  it("offers the Supporters in the window and nothing else", () => {
    const state = board(11);
    const { seededState, prompt } = play(state, "fix-rotostick");
    expect([...prompt.candidates].sort()).toEqual(
      [deckAt(seededState, 2), deckAt(seededState, 3)].sort(),
    );
    expect(prompt.candidates).not.toContain(deckAt(seededState, 0));
    // …and the non-Trainer at index 1, which any Trainer filter would refuse.
    expect(prompt.candidates).not.toContain(deckAt(seededState, 1));
  });

  it('the resolved cap is the SUPPORTERS in the window, not the window — `"any"`, not 4', () => {
    const state = board(12);
    const { prompt } = play(state, "fix-rotostick");
    expect(prompt.max).toBe(2);
    // …and the printed "you may", which makes taking none a legal answer.
    expect(prompt.min).toBe(0);
    expect(prompt).not.toHaveProperty("caps");
  });

  it("the caption prints the card's own words, and carries NO number", () => {
    const state = board(13);
    const { prompt } = play(state, "fix-rotostick");
    expect(prompt.note).toBe(
      "Look at the top 4 cards of your deck and put any number of Supporter cards into your hand.",
    );
    expect(prompt.note).not.toContain("up to");
  });

  it("takes ALL of them — the cap really does not bind", () => {
    const state = board(14);
    const { seededState, parked } = play(state, "fix-rotostick");
    const both = [deckAt(seededState, 2), deckAt(seededState, 3)];
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: both },
    });
    for (const uid of both) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    // The printed "reveal", forwarded onto the event exactly as Great Ball's is.
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      uids: both,
      reveal: true,
    });
    expect(done.phase.kind).toBe("turn:action");
  });

  it("the DECLINE is legal, and the look is still announced", () => {
    const state = board(15);
    const { parked } = play(state, "fix-rotostick");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({ seat: "p1", uids: [] });
    expect(done.phase.kind).toBe("turn:action");
  });

  it("a Supporter PAST the window is unreachable — `n: 4`, not Pokégear's 7", () => {
    const state = board(16);
    const { seededState, prompt } = play(state, "fix-rotostick");
    expect(prompt.candidates).not.toContain(deckAt(seededState, 4));
    expect(prompt.candidates).toHaveLength(2);
  });

  it("POKÉGEAR ON THE SAME BOARD CAPS AT 1 AND SAYS SO — the attribution control", () => {
    const state = board(17);
    const { seededState, prompt } = play(state, "sv01-186");
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Supporter card into your hand.",
    );
    // …and its wider window really does see the buried Supporter this card cannot.
    expect(prompt.candidates).toContain(deckAt(seededState, 4));
  });

  it("the two DERIVED bench sentences now spell the same phrase the same way", () => {
    const derived = deriveAttackEffect(
      "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    );
    expect(derived?.[0]).toMatchObject({ op: "lookAtTopN", max: "any" });
    const roto = programFor("fix-rotostick")?.trainer?.[0];
    if (roto?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(roto.max).toBe(derived?.[0] && "max" in derived[0] ? derived[0].max : undefined);
  });
});
