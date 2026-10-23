import { describe, expect, it } from "vitest";
import type { GameState } from "./index";
import { programFor } from "./registry";
import {
  BUG_CATCHING_DECK,
  FIXTURE_POOL,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
  findEvent,
} from "./testFixtures";

const BUG_CATCHING_IDS = ["sv06-143", "sv08.5-102"] as const;

/** The uid of the deck card at `index` (0 = top) in p1's deck. */
function deckAt(state: GameState, index: number): string {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`p1 deck has no card at index ${index}`);
  return uid;
}

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BUG_CATCHING_DECK, p2: BUG_CATCHING_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function seeded(state: GameState): GameState {
  let next = state;
  next = toDeckTop(next, "p1", "fix-grass-basic", 2); // 0,1 → end up at 0 and 7
  next = toDeckTop(next, "p1", "fix-item", 1);
  next = toDeckTop(next, "p1", "fix-special", 1);
  next = toDeckTop(next, "p1", "fix-energy", 1);
  next = toDeckTop(next, "p1", "fix-basic-1", 1);
  next = toDeckTop(next, "p1", "fix-grass-energy", 1);
  next = toDeckTop(next, "p1", "fix-grass-stage1", 1);
  // …and the SECOND {G} Pokémon back on top, which leaves its twin at index 7:
  // the window boundary and the two-of-a-kind board in one seeding.
  next = toDeckTop(next, "p1", "fix-grass-basic", 1);
  return next;
}

function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const seededState = seeded(withCard);
  const uid = handUid(seededState, "p1", id);
  const { state: parked } = mustApply(seededState, { type: "playTrainer", seat: "p1", uid });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { seededState, parked, prompt: parked.phase.prompt };
}

const idOf = (state: GameState, uid: string) => state.cardIdByUid[uid];

describe("D333 — Bug Catching Set, a flat cap over a two-member union", () => {
  it("the registry resolves a program for both printings AND for the demonstrator", () => {
    for (const id of BUG_CATCHING_IDS) expect(programFor(id), id).toBeDefined();
    expect(programFor("fix-bugcatchingset")).toBeDefined();
  });

  it("the two printings share ONE program object — reprints, not two authorings", () => {
    const first = programFor("sv06-143");
    for (const id of BUG_CATCHING_IDS) expect(programFor(id), id).toBe(first);
    expect(programFor("fix-bugcatchingset")).toBe(first);
  });

  it("the program is `anyOf` under a FLAT cap — and carries no `also`", () => {
    const op = programFor("fix-bugcatchingset")?.trainer?.[0];
    if (op?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    expect(op).toEqual({
      op: "lookAtTopN",
      n: 7,
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Grass" },
          { kind: "basicEnergy", energyType: "Grass" },
        ],
      },
      max: 2,
      reveal: true,
    });
    expect(op.also).toBeUndefined();
    expect(programFor("fix-bugcatchingset")?.trainer?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the fixture pool prints the sentence this slice built", () => {
    expect(FIXTURE_POOL["fix-bugcatchingset"]?.effect).toBe(
      "Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of {G} Pokémon and Basic {G} Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
    );
    expect(FIXTURE_POOL["fix-bugcatchingset"]?.trainerType).toBe("Item");
  });

  it("offers the two {G} Pokémon and the Basic {G} Energy — and nothing else", () => {
    const state = board(21);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    expect([...prompt.candidates].sort()).toEqual(
      [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)].sort(),
    );
    expect(prompt.candidates.length).toBeGreaterThan(0);
  });

  it("takes the STAGE 1 {G} Pokémon — the printed noun carries no stage word", () => {
    const state = board(22);
    const { seededState, prompt, parked } = play(state, "fix-bugcatchingset");
    const stage1 = deckAt(seededState, 1);
    expect(idOf(seededState, stage1)).toBe("fix-grass-stage1");
    expect(prompt.candidates).toContain(stage1);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [stage1] },
    });
    expect(done.players.p1.hand).toContain(stage1);
    expect(done.players.p1.deck).not.toContain(stage1);
  });

  it("refuses the COLORLESS Pokémon — the printed `{G}` on the first member", () => {
    const state = board(23);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const colorless = deckAt(seededState, 3);
    expect(idOf(seededState, colorless)).toBe("fix-basic-1");
    expect(prompt.candidates).not.toContain(colorless);
  });

  it("refuses the COLORLESS Basic Energy — the same `{G}` on the OTHER member", () => {
    const state = board(24);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const plainEnergy = deckAt(seededState, 4);
    expect(idOf(seededState, plainEnergy)).toBe("fix-energy");
    expect(prompt.candidates).not.toContain(plainEnergy);
  });

  it('refuses the SPECIAL Energy — the printed word "Basic"', () => {
    const state = board(25);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const special = deckAt(seededState, 5);
    expect(idOf(seededState, special)).toBe("fix-special");
    expect(prompt.candidates).not.toContain(special);
  });

  it('TWO {G} POKÉMON IS A LEGAL ANSWER — "in any combination", not "one of each"', () => {
    const state = board(26);
    const { seededState, parked, prompt } = play(state, "fix-bugcatchingset");
    const bothPokemon = [deckAt(seededState, 0), deckAt(seededState, 1)];
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0); // the printed "You may"
    expect(prompt).not.toHaveProperty("caps");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: bothPokemon },
    });
    for (const uid of bothPokemon) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    expect(findEvent(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      uids: bothPokemon,
      reveal: true,
    });
    expect(done.phase.kind).toBe("turn:action");
  });

  it('a THIRD admissible card is refused — the printed "up to 2"', () => {
    const state = board(27);
    const { seededState, parked } = play(state, "fix-bugcatchingset");
    const three = [deckAt(seededState, 0), deckAt(seededState, 1), deckAt(seededState, 2)];
    // The wire validator's flat total, driven rather than asserted about: three
    // cards are OFFERED and only two may be taken, so a build that dropped the cap
    // (or spelled `max: 7`, the window) is caught by a refusal and not by a count.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: three } },
      "BAD_EFFECT_CHOICE",
    );
    // …and the SAME three minus one applies, so the refusal is the CAP and not a
    // broken candidate set (the shape a bare rejection cannot distinguish).
    expect(
      mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: three.slice(0, 2) },
      }).state.phase.kind,
    ).toBe("turn:action");
  });

  it("a {G} Pokémon PAST the window is unreachable — `n: 7`", () => {
    const state = board(28);
    const { seededState, prompt } = play(state, "fix-bugcatchingset");
    const buried = deckAt(seededState, 7);
    expect(idOf(seededState, buried)).toBe("fix-grass-basic");
    expect(prompt.candidates).not.toContain(buried);
  });

  it('the caption joins with " or ", exactly as Lana\'s Aid has since D264', () => {
    const state = board(29);
    const { prompt } = play(state, "fix-bugcatchingset");
    expect(prompt.note).toBe(
      "Look at the top 7 cards of your deck and put up to 2 Grass Pokémon or Basic Grass Energy cards into your hand.",
    );
  });

  it("GREAT BALL ON THE SAME BOARD OFFERS THE COLORLESS POKÉMON — the control", () => {
    const state = board(30);
    const { seededState, prompt } = play(state, "sv02-183");
    expect(prompt.candidates).toContain(deckAt(seededState, 3)); // the Colorless Pokémon
    expect(prompt.candidates).not.toContain(deckAt(seededState, 2)); // …and NO Energy at all
    expect(prompt.max).toBe(1);
  });
});
