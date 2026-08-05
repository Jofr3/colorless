import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  DISCARD_RETRIEVAL_DECK,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  types,
} from "./testFixtures";

// M5 op-slice: discardPileRetrieval (§7.1 recovery Items) — the discard-pile
// mirror of searchDeck. Three real cards land on it, verified end to end:
//   • Energy Retrieval (sv01-171) — up to 2 Basic Energy from discard → hand;
//   • Pal Pad (sv01-182) — up to 2 Supporters from discard → deck (then shuffle);
//   • Super Rod (sv02-188) — up to 3 Pokémon/Basic Energy from discard → deck.
// Like searchDeck it is "up to" (declinable) and parks on the SAME chooseCards
// prompt; an empty match is a no-op, and any trailing shuffleDeck still fires.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** A uid of `cardId` sitting in `seat`'s discard pile (the first, when several). */
function discardUid(state: GameState, seat: "p1" | "p2", cardId: string): string {
  const uid = state.players[seat].discard.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId} in the discard pile`);
  return uid;
}

/** Every uid of `cardId` in `seat`'s discard pile. */
function discardUids(state: GameState, seat: "p1" | "p2", cardId: string): string[] {
  return state.players[seat].discard.filter((u) => state.cardIdByUid[u] === cardId);
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (the coverage-suite board shape). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_RETRIEVAL_DECK, p2: DISCARD_RETRIEVAL_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

describe("M5 op-slice — discardPileRetrieval", () => {
  it("registry resolves a program for each authored id (incl. the Super Rod reprint)", () => {
    for (const id of ["sv01-171", "sv01-182", "sv02-188", "sv02-276"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("Energy Retrieval parks on the discard's Basic Energy (max 2), then puts the picks in hand", () => {
    let state = board(1);
    // Seed the discard: 3 Basic Energy (only 2 may be taken) + a Pokémon + an
    // Item, both of which the basicEnergy filter must exclude.
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    state = discardFromDeck(state, "p1", "fix-energy", 1); // a third basic Energy
    state = discardFromDeck(state, "p1", "fix-basic-1", 1); // Pokémon — excluded
    state = discardFromDeck(state, "p1", "fix-item", 1); // Item — excluded
    const fire = discardUid(state, "p1", "fix-fire-energy");
    const water = discardUid(state, "p1", "fix-water-energy");
    const poke = discardUid(state, "p1", "fix-basic-1");
    const item = discardUid(state, "p1", "fix-item");

    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("chooseCards");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    // dest is "hand"; max is the op's 2 even though 3 candidates are eligible.
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.max).toBe(2);
    expect(parked.phase.prompt.note).toBe(
      "Put up to 2 Basic Energy cards from your discard pile into your hand.",
    );
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.size).toBe(3); // the 3 basic Energy — NOT the Pokémon/Item
    expect(candidates.has(fire)).toBe(true);
    expect(candidates.has(water)).toBe(true);
    expect(candidates.has(poke)).toBe(false);
    expect(candidates.has(item)).toBe(false);

    const handBefore = parked.players.p1.hand.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [fire, water] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(find(events, "DISCARD_RETRIEVED")).toMatchObject({ seat: "p1", dest: "hand" });
    expect(find(events, "DISCARD_RETRIEVED")?.uids).toHaveLength(2);
    // The two picks moved discard → hand; the excluded cards stay put.
    expect(done.players.p1.hand).toContain(fire);
    expect(done.players.p1.hand).toContain(water);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.players.p1.discard).not.toContain(fire);
    expect(done.players.p1.discard).not.toContain(water);
    expect(done.players.p1.discard).toContain(poke);
    expect(done.players.p1.discard).toContain(item);
    // Retrieval to hand does NOT shuffle (dest "hand", no trailing shuffleDeck).
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("Pal Pad moves the discard's Supporters into the deck, then shuffles", () => {
    let state = board(2);
    state = discardFromDeck(state, "p1", "sv01-189", 2); // 2 Professor's Research (Supporter)
    state = discardFromDeck(state, "p1", "fix-item", 1); // Item — excluded
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1); // Energy — excluded
    const supporters = discardUids(state, "p1", "sv01-189");
    const item = discardUid(state, "p1", "fix-item");

    state = handFromDeck(state, "p1", "sv01-182", 1);
    const uid = handUid(state, "p1", "sv01-182");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("deck");
    expect(parked.phase.prompt.note).toBe(
      "Shuffle up to 2 Supporter cards from your discard pile into your deck.",
    );
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.size).toBe(2); // only the 2 Supporters
    expect(candidates.has(supporters[0] as string)).toBe(true);
    expect(candidates.has(supporters[1] as string)).toBe(true);
    expect(candidates.has(item)).toBe(false);

    const deckBefore = parked.players.p1.deck.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: supporters },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(find(events, "DISCARD_RETRIEVED")).toMatchObject({ seat: "p1", dest: "deck" });
    // The Supporters are back in the deck (and out of the discard); the trailing
    // shuffleDeck op fired.
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.deck).toContain(supporters[0]);
    expect(done.players.p1.deck).toContain(supporters[1]);
    expect(done.players.p1.discard).not.toContain(supporters[0]);
    expect(done.players.p1.discard).not.toContain(supporters[1]);
    expect(done.players.p1.deck.length).toBe(deckBefore + 2);
    // The excluded Item stays in the discard.
    expect(done.players.p1.discard).toContain(item);
  });

  it("Super Rod retrieves a mix of Pokémon and Basic Energy into the deck, but never a Trainer", () => {
    let state = board(3);
    state = discardFromDeck(state, "p1", "fix-basic-1", 1); // Pokémon — eligible
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1); // Basic Energy — eligible
    state = discardFromDeck(state, "p1", "sv01-189", 1); // Supporter (Trainer) — excluded
    const poke = discardUid(state, "p1", "fix-basic-1");
    const energy = discardUid(state, "p1", "fix-fire-energy");
    const supporter = discardUid(state, "p1", "sv01-189");

    state = handFromDeck(state, "p1", "sv02-188", 1);
    const uid = handUid(state, "p1", "sv02-188");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.dest).toBe("deck");
    expect(parked.phase.prompt.max).toBe(3);
    expect(parked.phase.prompt.note).toBe(
      "Shuffle up to 3 Pokémon or Basic Energy cards from your discard pile into your deck.",
    );
    const candidates = new Set(parked.phase.prompt.candidates);
    expect(candidates.has(poke)).toBe(true);
    expect(candidates.has(energy)).toBe(true);
    expect(candidates.has(supporter)).toBe(false); // the Trainer is excluded

    const deckBefore = parked.players.p1.deck.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [poke, energy] },
    });
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.deck).toContain(poke);
    expect(done.players.p1.deck).toContain(energy);
    expect(done.players.p1.deck.length).toBe(deckBefore + 2);
    // The excluded Supporter is untouched.
    expect(done.players.p1.discard).toContain(supporter);
  });

  it("Super Rod's 'any combination' allows the degenerate ends — only Pokémon, or only Energy", () => {
    // Only-Pokémon: two Pokémon + one Energy in the discard, retrieve just the Pokémon.
    let state = board(9);
    state = discardFromDeck(state, "p1", "fix-basic-1", 2);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    const pokes = discardUids(state, "p1", "fix-basic-1");
    const leftoverEnergy = discardUid(state, "p1", "fix-fire-energy");
    state = handFromDeck(state, "p1", "sv02-188", 1);
    let uid = handUid(state, "p1", "sv02-188");
    const { state: parkedA } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parkedA.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const { state: onlyPoke } = mustApply(parkedA, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: pokes },
    });
    expect(onlyPoke.players.p1.deck).toContain(pokes[0]);
    expect(onlyPoke.players.p1.deck).toContain(pokes[1]);
    expect(onlyPoke.players.p1.discard).toContain(leftoverEnergy); // the unpicked Energy stays

    // Only-Energy: two Energy + one Pokémon, retrieve just the Energy.
    let state2 = board(10);
    state2 = discardFromDeck(state2, "p1", "fix-water-energy", 2);
    state2 = discardFromDeck(state2, "p1", "fix-basic-1", 1);
    const energies = discardUids(state2, "p1", "fix-water-energy");
    const leftoverPoke = discardUid(state2, "p1", "fix-basic-1");
    state2 = handFromDeck(state2, "p1", "sv02-188", 1);
    uid = handUid(state2, "p1", "sv02-188");
    const { state: parkedB } = mustApply(state2, { type: "playTrainer", seat: "p1", uid });
    if (parkedB.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const { state: onlyEnergy } = mustApply(parkedB, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: energies },
    });
    expect(onlyEnergy.players.p1.deck).toContain(energies[0]);
    expect(onlyEnergy.players.p1.deck).toContain(energies[1]);
    expect(onlyEnergy.players.p1.discard).toContain(leftoverPoke); // the unpicked Pokémon stays
  });

  it("Energy Retrieval with no Basic Energy in the discard is a no-op (never parks)", () => {
    let state = board(4);
    state = discardFromDeck(state, "p1", "fix-basic-1", 1); // only a Pokémon in the discard
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(after.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("DISCARD_RETRIEVED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    // Energy Retrieval has no trailing shuffle, so nothing scrambles either.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("Pal Pad with no Supporters in the discard still shuffles (the trailing shuffle, like a whiffed search)", () => {
    let state = board(5);
    state = discardFromDeck(state, "p1", "fix-item", 1); // a non-Supporter Trainer only
    state = handFromDeck(state, "p1", "sv01-182", 1);
    const uid = handUid(state, "p1", "sv01-182");
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    // No candidate → the retrieval is a no-op (no park, no DISCARD_RETRIEVED)…
    expect(after.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("DISCARD_RETRIEVED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    // …but the trailing shuffleDeck op STILL fires (the searchDeck convention).
    expect(types(events)).toContain("SHUFFLE");
  });

  it("declining Energy Retrieval (take none) moves nothing", () => {
    let state = board(6);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 2);
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("DISCARD_RETRIEVED");
    // Both Energy stay in the discard.
    expect(discardUids(done, "p1", "fix-fire-energy")).toHaveLength(2);
  });

  it("declining Pal Pad when candidates exist moves nothing but STILL shuffles (trailing op)", () => {
    let state = board(11);
    state = discardFromDeck(state, "p1", "sv01-189", 2); // 2 Supporters ARE available…
    state = handFromDeck(state, "p1", "sv01-182", 1);
    const uid = handUid(state, "p1", "sv01-182");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose"); // …so it parks (not a whiff)
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] }, // …but the player declines
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("DISCARD_RETRIEVED"); // nothing moved
    expect(types(events)).toContain("SHUFFLE"); // the trailing shuffleDeck still fires
    expect(discardUids(done, "p1", "sv01-189")).toHaveLength(2); // Supporters stay in the discard
  });

  it("rejects retrieving a discard card that is not a candidate (the wire guard)", () => {
    let state = board(7);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1); // the only candidate
    state = discardFromDeck(state, "p1", "fix-item", 1); // a non-candidate in the SAME pile
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const item = discardUid(parked, "p1", "fix-item");
    // The Item sits in the discard but is not a basicEnergy candidate → rejected.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [item] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("never mutates the input state — both the play AND the retrieval move (frozen boards)", () => {
    let state = board(8);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 2);
    state = handFromDeck(state, "p1", "sv01-171", 1);
    const uid = handUid(state, "p1", "sv01-171");
    // 1. The play up to the park (stepOp only reads the discard).
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
    // 2. The RESOLVE — this is the path that runs retrieveMove, the discard→hand
    //    mutation; freezing the parked state proves it copies rather than splices.
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const picks = parked.phase.prompt.candidates.slice(0, 2);
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: picks },
      }),
    ).not.toThrow();
  });
});
