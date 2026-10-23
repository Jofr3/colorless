import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  DRAYTON_WINDOW_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
} from "./testFixtures";

const DRAYTON_IDS = ["sv08-174", "sv08-232", "sv08-244", "sv08.5-172"] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so a Supporter is legal (§7.2). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DRAYTON_WINDOW_DECK, p2: DRAYTON_WINDOW_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-basic-2", 1); // index 8 — a Pokémon PAST the window
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 7 — a Trainer PAST the window
  next = toDeckTop(next, "p1", "fix-energy", 3); // indices 4-6 — neither kind
  next = toDeckTop(next, "p1", "fix-item", 1); // index 3 — Trainer #2
  next = toDeckTop(next, "p1", "sv01-189", 1); // index 2 — Trainer #1
  next = toDeckTop(next, "p1", "fix-basic-2", 1); // index 1 — Pokémon #2
  next = toDeckTop(next, "p1", "fix-basic-1", 1); // index 0 — Pokémon #1
  return next;
}

/** Play `id` out of p1's hand and return the parked chooseCards prompt with it. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked } = mustApply(seededState, { type: "playTrainer", seat: "p1", uid });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt };
}

describe("D332 — Drayton, the double-filter lookAtTopN window", () => {
  it("the registry resolves a program for every one of the four printings", () => {
    for (const id of DRAYTON_IDS) {
      expect(programFor(id), id).toBeDefined();
    }
    expect(programFor("fix-drayton")).toBeDefined();
  });

  it("the four printings share ONE program object — reprints, not four authorings", () => {
    const first = programFor("sv08-174");
    for (const id of DRAYTON_IDS) expect(programFor(id), id).toBe(first);
  });

  it("the demonstrator's program carries `also`, and Great Ball's does not", () => {
    // The attribution control, read off the registry before any board runs it:
    // Great Ball is this program with the field REMOVED, so every difference the
    // boards below observe is attributable to `also` and to nothing else.
    const drayton = programFor("fix-drayton")?.trainer?.[0];
    const greatBall = programFor("sv02-183")?.trainer?.[0];
    if (drayton?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (greatBall?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(drayton.n).toBe(greatBall.n);
    expect(drayton.filter).toEqual(greatBall.filter);
    expect(drayton.max).toBe(greatBall.max);
    expect(drayton.also).toEqual({ filter: { kind: "trainerCard" }, max: 1 });
    expect(greatBall.also).toBeUndefined();
  });

  it("the fixture pool prints the sentence this slice built", () => {
    expect(FIXTURE_POOL["fix-drayton"]?.effect).toContain("a Pokémon and a Trainer card");
    expect(FIXTURE_POOL["fix-drayton"]?.trainerType).toBe("Supporter");
  });

  it("offers the UNION of both filters out of the top 7, and nothing else", () => {
    const state = board(1);
    const window0 = [0, 1, 2, 3, 4, 5, 6].map((i) => deckAt(seeded(state), i));
    const { prompt } = play(state, "fix-drayton");

    const candidates = new Set(prompt.candidates);
    // Two Pokémon + two Trainers = 4 of the 7 looked-at cards…
    expect(candidates.size).toBe(4);
    for (const i of [0, 1, 2, 3]) expect(candidates.has(window0[i] as string), `${i}`).toBe(true);
    // …and the three that are NEITHER kind are refused, which is what proves the
    // union is a union of the two filters and not "the whole window".
    for (const i of [4, 5, 6]) expect(candidates.has(window0[i] as string), `${i}`).toBe(false);
  });

  it("does NOT reach past the window — a Trainer and a Pokémon at 7 and 8 are unreachable", () => {
    const state = board(2);
    const seededState = seeded(state);
    const deepTrainer = deckAt(seededState, 7);
    const deepPokemon = deckAt(seededState, 8);
    const { prompt } = play(state, "fix-drayton");

    // The boundary is observable from BOTH filters at once, which a single-filter
    // window check cannot show: `also` is scanned over the same `top`, so a
    // second filter reading the whole deck would surface here and only here.
    expect(prompt.candidates).not.toContain(deepTrainer);
    expect(prompt.candidates).not.toContain(deepPokemon);
  });

  it("caps each kind at 1 while the TOTAL is 2 — the printed conjunction", () => {
    const state = board(3);
    const { prompt } = play(state, "fix-drayton");
    const seededState = seeded(state);

    expect(prompt.max).toBe(2); // 1 + 1, the sum of the printed caps
    expect(prompt.min).toBe(0); // "you may" — declining is a legal answer
    expect(prompt.dest).toBe("hand");
    expect(prompt.caps).toHaveLength(2);

    const pokemon = [deckAt(seededState, 0), deckAt(seededState, 1)];
    const trainers = [deckAt(seededState, 2), deckAt(seededState, 3)];
    expect(prompt.caps?.[0]).toEqual({ uids: pokemon, max: 1 });
    expect(prompt.caps?.[1]).toEqual({ uids: trainers, max: 1 });
  });

  it("the caption prints the conjunction the card prints, not `anyOf`'s ' or '", () => {
    const state = board(4);
    const { prompt } = play(state, "fix-drayton");
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon and a Trainer card into your hand.",
    );
    // And it is not the disjunction the free candidate set would have produced.
    expect(prompt.note).not.toContain(" or ");
  });

  it("takes ONE of each — both land in hand, both are named in the reveal", () => {
    const state = board(5);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const pokemon = deckAt(seededState, 0);
    const trainer = deckAt(seededState, 2);
    const handBefore = parked.players.p1.hand.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pokemon, trainer] },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(pokemon);
    expect(done.players.p1.hand).toContain(trainer);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.players.p1.deck).not.toContain(pokemon);
    expect(done.players.p1.deck).not.toContain(trainer);
    // `reveal: true` is the printed "you may reveal", so both are named.
    const revealed = find(events, "DECK_TOP_REVEALED");
    expect(revealed?.reveal).toBe(true);
    expect(new Set(revealed?.uids)).toEqual(new Set([pokemon, trainer]));
  });

  it("REFUSES TWO POKÉMON — the answer the flat `max` alone would have allowed", () => {
    const state = board(6);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const [pokemonA, pokemonB] = [deckAt(seededState, 0), deckAt(seededState, 1)];

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [pokemonA, pokemonB] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("REFUSES TWO TRAINERS — the same defect on the OTHER cap", () => {
    // The mirror, and it is not redundant: a `caps` array built with both entries
    // pointing at the first filter's uids would refuse two Pokémon and admit two
    // Trainers, which is a defect the case above cannot see.
    const state = board(7);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const [trainerA, trainerB] = [deckAt(seededState, 2), deckAt(seededState, 3)];

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [trainerA, trainerB] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("still refuses a THIRD card and a card outside the window", () => {
    const state = board(8);
    const { parked } = play(state, "fix-drayton");
    const seededState = seeded(state);
    const pokemon = deckAt(seededState, 0);
    const trainer = deckAt(seededState, 2);
    const filler = deckAt(seededState, 4); // in the window, in neither filter

    // The flat total still bites (3 > 2)…
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [pokemon, trainer, deckAt(seededState, 1)] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and so does "was it offered", which `caps` must not have weakened.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [filler] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("EITHER HALF ALONE is a legal answer — the two 'you may's are independent", () => {
    const seededState = seeded(board(9));
    for (const [label, index] of [
      ["the Pokémon alone", 0],
      ["the Trainer alone", 2],
    ] as const) {
      const state = board(9);
      const { parked } = play(state, "fix-drayton");
      const only = deckAt(seededState, index);
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [only] },
      });
      expect(done.phase.kind, label).toBe("turn:action");
      expect(done.players.p1.hand, label).toContain(only);
    }
  });

  it("DECLINING takes nothing, still announces the look, and still shuffles", () => {
    const state = board(10);
    const { parked } = play(state, "fix-drayton");
    const deckBefore = parked.players.p1.deck.length;
    const handBefore = parked.players.p1.hand.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand.length).toBe(handBefore);
    expect(done.players.p1.deck.length).toBe(deckBefore);
    expect(find(events, "DECK_TOP_REVEALED")?.uids).toEqual([]);
    // The printed "Shuffle the other cards back" is the trailing op, and a
    // decline is not a whiff: it fires either way.
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("THE ATTRIBUTION CONTROL — Great Ball on the SAME seeded window caps at 1 and offers only Pokémon", () => {
    // Identical board, identical seeded top 7, the same op, no `also`. If this
    // prompt and Drayton's were the same, `also` would be doing nothing — which
    // is the vacuous-guard defect a one-of-each window would have hidden.
    const state = board(11);
    const { prompt } = play(state, "sv02-183");
    const seededState = seeded(state);

    expect(prompt.max).toBe(1);
    expect(prompt.caps).toBeUndefined(); // ABSENT, not an empty array
    expect(new Set(prompt.candidates)).toEqual(
      new Set([deckAt(seededState, 0), deckAt(seededState, 1)]),
    );
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put a Pokémon into your hand.",
    );
  });

  it("a window with no Trainer in it still offers the Pokémon — the halves whiff separately", () => {
    // `candidates.length === 0` is the op's only no-op guard, so a window that
    // satisfies ONE filter must still park. Built by seeding a top 7 of Pokémon
    // and fillers only.
    let state = handFromDeck(board(12), "p1", "fix-drayton", 1);
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-basic-1", 1);
    state = toDeckTop(state, "p1", "fix-basic-2", 1);
    const uid = handUid(state, "p1", "fix-drayton");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const prompt = parked.phase.prompt;
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.max).toBe(2);
    expect(prompt.caps?.[1]?.uids).toEqual([]);
  });
});
