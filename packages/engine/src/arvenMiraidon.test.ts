import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameAction, GameState } from "./index";
import {
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  finishOpeningSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
  types,
} from "./testFixtures";

// Printed text verified against tcgdex and the Pokémon card database.
const ARVEN_IDS = ["sv01-166", "sv01-235", "sv01-249", "sv03-186", "sv04.5-235"];
const MIRAIDON_IDS = ["sv01-081", "sv01-227", "sv01-244", "sv01-253", "sv04.5-243", "svp-028"];
const ARVEN_TEXT =
  "Search your deck for an Item card and a Pokémon Tool card, reveal them, and put them into your hand. Then, shuffle your deck.";
const TANDEM_TEXT =
  "Once during your turn, you may search your deck for up to 2 Basic {L} Pokémon and put them onto your Bench. Then, shuffle your deck.";
const FILLER = "arven-miraidon-filler";
const LIGHTNING = "arven-miraidon-lightning";
const EVOLUTION = "arven-miraidon-evolution";
const ITEM = "arven-miraidon-item";
const TOOL = "arven-miraidon-tool";
const ENERGY = "arven-miraidon-energy";

function pool(arven: string, miraidon: string): Record<string, Card> {
  return {
    [arven]: {
      ...trainerCard(arven, "Supporter", ARVEN_TEXT),
      name: "Arven",
      legal: { standard: false, expanded: true },
    },
    [miraidon]: battler(miraidon, {
      name: "Miraidon ex",
      hp: 220,
      types: ["Lightning"],
      retreat: 1,
      legal: { standard: false, expanded: true },
      abilities: [{ type: "Ability", name: "Tandem Unit", effect: TANDEM_TEXT }],
      attacks: [
        {
          name: "Photon Blaster",
          cost: ["Lightning", "Lightning", "Colorless"],
          damage: 220,
          effect: "During your next turn, this Pokémon can't attack.",
        },
      ],
    }),
    [FILLER]: battler(FILLER, { hp: 1000, types: ["Colorless"] }),
    [LIGHTNING]: battler(LIGHTNING, { types: ["Lightning"] }),
    [EVOLUTION]: battler(EVOLUTION, {
      stage: "Stage1",
      evolveFrom: LIGHTNING,
      types: ["Lightning"],
    }),
    [ITEM]: trainerCard(ITEM, "Item", ""),
    [TOOL]: trainerCard(TOOL, "Tool", ""),
    [ENERGY]: typedEnergy(ENERGY, "Lightning"),
  };
}

function board(arven = ARVEN_IDS[0] as string, miraidon = MIRAIDON_IDS[0] as string): GameState {
  const deck = deckOf({
    [FILLER]: 24,
    [LIGHTNING]: 6,
    [EVOLUTION]: 4,
    [arven]: 4,
    [miraidon]: 4,
    [ITEM]: 4,
    [TOOL]: 4,
    [ENERGY]: 10,
  });
  const created = createGame({
    seed: 581,
    decks: { p1: deck, p2: deck },
    cardPool: pool(arven, miraidon),
  });
  if (!created.ok) throw new Error(created.error.code);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = mustApply(state, {
    type: "chooseFirstPlayer",
    seat: state.phase.coinWinner,
    first: "p2",
  }).state;
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("no undecided seat");
    state = mustApply(state, { type: "setupDrawExtra", seat, count: 0 }).state;
  }
  state = finishOpeningSetup(state).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", FILLER);
  state = setActiveFromDeck(state, "p2", FILLER);
  return clearBench(state, "p1");
}

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards")
    throw new Error("expected card search");
  return state.phase.prompt;
}

const answer = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });
const use = (index = 0): GameAction => ({
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index },
  abilityName: "Tandem Unit",
});
const idOf = (state: GameState, uid: string) => state.cardIdByUid[uid];

function playArven(state: GameState, id = ARVEN_IDS[0] as string) {
  const ready = handFromDeck(state, "p1", id, 1);
  return mustApply(ready, { type: "playTrainer", seat: "p1", uid: handUid(ready, "p1", id) });
}

function strip(state: GameState, ids: string[]): GameState {
  const side = state.players.p1;
  const gone = side.deck.filter((u) => ids.includes(idOf(state, u) ?? ""));
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => !gone.includes(u)),
        discard: [...side.discard, ...gone],
      },
    },
  };
}

describe("Arven", () => {
  for (const id of ARVEN_IDS) {
    it(`${id}: searches, reveals one Item and one Tool, and shuffles`, () => {
      const parked = playArven(board(id), id).state;
      const offer = prompt(parked);
      expect(offer.note).toBe(
        "Search your deck for an Item card and a Pokémon Tool card into your hand.",
      );
      expect(offer.max).toBe(2);
      expect(offer.candidates.every((u) => [ITEM, TOOL].includes(idOf(parked, u) ?? ""))).toBe(
        true,
      );
      const picks = [ITEM, TOOL].map(
        (id) => offer.candidates.find((u) => idOf(parked, u) === id) as string,
      );
      const { state, events } = answer(parked, picks);
      for (const uid of picks) {
        expect(state.players.p1.hand).toContain(uid);
        expect(state.players.p1.deck).not.toContain(uid);
      }
      expect(events).toContainEqual({
        type: "DECK_SEARCHED",
        seat: "p1",
        dest: "hand",
        uids: picks,
        reveal: true,
      });
      expect(types(events)).toEqual(["DECK_SEARCHED", "SHUFFLE"]);
      const second = handFromDeck(state, "p1", id, 1);
      expectErr(
        second,
        { type: "playTrainer", seat: "p1", uid: handUid(second, "p1", id) },
        "SUPPORTER_ALREADY_PLAYED",
      );
    });
  }

  for (const id of [ITEM, TOOL]) {
    it(`rejects two cards of the same kind (${id})`, () => {
      const parked = playArven(board()).state;
      const picks = prompt(parked)
        .candidates.filter((u) => idOf(parked, u) === id)
        .slice(0, 2);
      expect(picks).toHaveLength(2);
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: picks } },
        "BAD_EFFECT_CHOICE",
      );
    });

    it(`can take just ${id} when the other kind is absent`, () => {
      const parked = playArven(strip(board(), [id === ITEM ? TOOL : ITEM])).state;
      const pick = prompt(parked).candidates[0] as string;
      expect(idOf(parked, pick)).toBe(id);
      expect(answer(parked, [pick]).state.players.p1.hand).toContain(pick);
    });
  }

  it("can decline both cards and still shuffle", () => {
    const parked = playArven(board()).state;
    const { state, events } = answer(parked, []);
    expect(state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("plays and shuffles with neither kind in the deck", () => {
    const { state, events } = playArven(strip(board(), [ITEM, TOOL]));
    expect(state.phase.kind).toBe("turn:action");
    expect(types(events)).toContain("SHUFFLE");
  });
});

describe("Miraidon ex", () => {
  for (const id of MIRAIDON_IDS) {
    it(`${id}: Tandem Unit benches only Basic Lightning Pokémon, then shuffles`, () => {
      const before = benchFromDeck(board(undefined, id), "p1", id);
      const parked = mustApply(before, use()).state;
      const offer = prompt(parked);
      expect(offer.note).toBe(
        "Search your deck for up to 2 Basic Lightning Pokémon onto your Bench.",
      );
      expect(offer.max).toBe(2);
      const expected = before.players.p1.deck.filter((u) =>
        [id, LIGHTNING].includes(idOf(before, u) ?? ""),
      );
      expect(offer.candidates).toEqual(expected);
      expect(expected.length).toBeGreaterThan(2);
      const picks = [id, LIGHTNING].map(
        (id) => offer.candidates.find((u) => idOf(parked, u) === id) as string,
      );
      const { state, events } = answer(parked, picks);
      expect(state.players.p1.bench.slice(1).map((p) => p.stack[0])).toEqual(picks);
      for (const uid of picks) expect(state.players.p1.deck).not.toContain(uid);
      expect(types(events)).toContain("SHUFFLE");
      expectErr(state, use(), "ABILITY_ALREADY_USED");
      // A Miraidon just found by the first copy has its own use this turn.
      expect(mustApply(state, use(1)).state.phase.kind).toBe("effect:choose");
    });
  }

  it("works from the Active and resets on the next turn, including after declining", () => {
    let state = setActiveFromDeck(board(), "p1", MIRAIDON_IDS[0] as string);
    const action: GameAction = {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Tandem Unit",
    };
    state = answer(mustApply(state, action).state, []).state;
    expectErr(state, action, "ABILITY_ALREADY_USED");
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(mustApply(state, action).state.phase.kind).toBe("effect:choose");
  });

  it("clamps to one open Bench slot and rejects a second pick", () => {
    let state = benchFromDeck(board(), "p1", MIRAIDON_IDS[0] as string);
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p1", FILLER);
    const parked = mustApply(state, use()).state;
    expect(prompt(parked).max).toBe(1);
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: prompt(parked).candidates.slice(0, 2) },
      },
      "BAD_EFFECT_CHOICE",
    );
    expect(
      answer(parked, prompt(parked).candidates.slice(0, 1)).state.players.p1.bench,
    ).toHaveLength(5);
  });

  it("shuffles without a prompt on a full Bench or a deck with no matching Pokémon", () => {
    let full = benchFromDeck(board(), "p1", MIRAIDON_IDS[0] as string);
    for (let i = 0; i < 4; i++) full = benchFromDeck(full, "p1", FILLER);
    const miss = strip(benchFromDeck(board(), "p1", MIRAIDON_IDS[0] as string), [
      MIRAIDON_IDS[0] as string,
      LIGHTNING,
    ]);
    for (const before of [full, miss]) {
      const { state, events } = mustApply(before, use());
      expect(state.phase.kind).toBe("turn:action");
      expect(types(events)).toEqual(["ABILITY_USED", "SHUFFLE"]);
      expectErr(state, use(), "ABILITY_ALREADY_USED");
    }
  });

  it("Photon Blaster deals 220 and prevents attacking on the next turn", () => {
    let state = setActiveFromDeck(board(), "p1", MIRAIDON_IDS[0] as string);
    state = attachFromDeck(state, "p1", ENERGY, 3);
    const attacked = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p2.active?.damage).toBe(220);
    state = mustApply(attacked.state, { type: "endTurn", seat: "p2" }).state;
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "ATTACK_PREVENTED");
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("shares programs only among matching printings", () => {
    for (const id of ARVEN_IDS) expect(programFor(id)).toBe(programFor(ARVEN_IDS[0] as string));
    for (const id of MIRAIDON_IDS)
      expect(programFor(id)).toBe(programFor(MIRAIDON_IDS[0] as string));
    expect(programFor("sv03-079")?.abilities?.some((a) => a.name === "Tandem Unit")).not.toBe(true);
    expect(programFor("sv05-122")?.abilities?.some((a) => a.name === "Tandem Unit")).not.toBe(true);
  });
});
