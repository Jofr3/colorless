import { describe, expect, it } from "vitest";
import { NO_CONDITIONS } from "../types";
import type {
  AttachedCards,
  BattleState,
  BoardState,
  CardModel,
  CardMoveRequest,
  CardPlacement,
  CardType,
  PlayerBoard,
  PlayerId,
} from "../types";
import { canPlace, moveCardOnBoard } from "./cardMovement";

// ---------------------------------------------------------------------------
// Fixture builders. The reducer is pure, so tests build plain boards and assert
// on the returned board (never the input). `me3-111` is the bench-expanding
// stadium catalog id (see constants.BENCH_EXPANDING_STADIUM_CARD_IDS).
// ---------------------------------------------------------------------------
function card(id: string, type: CardType, attached?: AttachedCards): CardModel {
  return { id, name: id, cardId: id, type, attached };
}
const poke = (id: string, attached?: AttachedCards) => card(id, "pokemon", attached);
const battlePoke = (id: string, battle: BattleState): CardModel => ({ ...poke(id), battle });
const tool = (id: string) => card(id, "tool");
const energy = (id: string) => card(id, "energy");
const attached = (tools: CardModel[] = [], energies: CardModel[] = []): AttachedCards => ({
  tools,
  energies,
});
const stadiumCard = (id: string, cardId = id): CardModel => ({
  id,
  name: id,
  cardId,
  type: "stadium",
});

function player(overrides: Partial<PlayerBoard> = {}): PlayerBoard {
  return { hand: [], active: null, bench: [], prizesRemaining: 6, ...overrides };
}

function makeBoard(
  opts: {
    stadium?: CardModel | null;
    you?: Partial<PlayerBoard>;
    opponent?: Partial<PlayerBoard>;
  } = {},
): BoardState {
  return {
    stadium: opts.stadium ?? null,
    you: player(opts.you),
    opponent: player(opts.opponent),
  };
}

// Placement builders.
const hand = (index?: number, owner: PlayerId = "you"): CardPlacement => ({
  owner,
  zone: "hand",
  index,
});
const bench = (index?: number, owner: PlayerId = "you"): CardPlacement => ({
  owner,
  zone: "bench",
  index,
});
const active = (owner: PlayerId = "you"): CardPlacement => ({ owner, zone: "active" });
const stadiumSlot = (): CardPlacement => ({ owner: "global", zone: "stadium" });

const fullBench = () => [poke("b1"), poke("b2"), poke("b3"), poke("b4"), poke("b5")];
const ids = (cards: CardModel[]) => cards.map((c) => c.id);

describe("moveCardOnBoard — hand → active", () => {
  it("places a Pokémon into an empty active slot", () => {
    const board = makeBoard({ you: { hand: [poke("p1")] } });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: active() });

    expect(result).not.toBe(board);
    expect(result.you.active?.id).toBe("p1");
    expect(result.you.hand).toHaveLength(0);
  });

  it("rejects playing onto an occupied active slot (returns the same board)", () => {
    const board = makeBoard({ you: { hand: [poke("p1")], active: poke("a1") } });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: active() });

    expect(result).toBe(board);
  });

  it("appends a Pokémon to the bench when no target index is given", () => {
    const board = makeBoard({ you: { hand: [poke("p1")], bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: bench() });

    expect(ids(result.you.bench)).toEqual(["b1", "p1"]);
  });
});

describe("moveCardOnBoard — bench ↔ active swap", () => {
  it("swaps the bench card into active and lands the old active at the freed bench index", () => {
    const board = makeBoard({ you: { active: poke("a1"), bench: [poke("b1"), poke("b2")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: active() });

    expect(result.you.active?.id).toBe("b1");
    expect(ids(result.you.bench)).toEqual(["a1", "b2"]);
    expect(result.you.bench).toHaveLength(2);
  });

  it("moves a bench card into an empty active slot, shrinking the bench", () => {
    const board = makeBoard({ you: { active: null, bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: active() });

    expect(result.you.active?.id).toBe("b1");
    expect(result.you.bench).toHaveLength(0);
  });
});

describe("moveCardOnBoard — active → bench (retreat)", () => {
  it("retreats the active Pokémon to the bench when there is room", () => {
    const board = makeBoard({ you: { active: poke("a1"), bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "a1", from: active(), to: bench() });

    expect(result.you.active).toBeNull();
    expect(ids(result.you.bench)).toEqual(["b1", "a1"]);
  });

  it("rejects retreat when the bench is full (returns the same board)", () => {
    const board = makeBoard({ you: { active: poke("a1"), bench: fullBench() } });
    const result = moveCardOnBoard(board, { cardId: "a1", from: active(), to: bench() });

    expect(result).toBe(board);
  });
});

describe("moveCardOnBoard — tool / energy attachment", () => {
  it("attaches a tool from hand onto a Pokémon", () => {
    const board = makeBoard({ you: { hand: [tool("t1")], active: poke("a1") } });
    const result = moveCardOnBoard(board, { cardId: "t1", from: hand(0), to: active() });

    expect(ids(result.you.active?.attached?.tools ?? [])).toEqual(["t1"]);
    expect(result.you.hand).toHaveLength(0);
  });

  it("rejects a second tool on a Pokémon that already has one", () => {
    const board = makeBoard({
      you: { hand: [tool("t2")], active: poke("a1", attached([tool("t1")])) },
    });
    const result = moveCardOnBoard(board, { cardId: "t2", from: hand(0), to: active() });

    expect(result).toBe(board);
  });

  it("stacks energies (multiple allowed)", () => {
    const board = makeBoard({
      you: { hand: [energy("e2")], active: poke("a1", attached([], [energy("e1")])) },
    });
    const result = moveCardOnBoard(board, { cardId: "e2", from: hand(0), to: active() });

    expect(ids(result.you.active?.attached?.energies ?? [])).toEqual(["e1", "e2"]);
  });

  it("attaches onto a benched Pokémon by index", () => {
    const board = makeBoard({ you: { hand: [energy("e1")], bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "e1", from: hand(0), to: bench(0) });

    expect(ids(result.you.bench[0]?.attached?.energies ?? [])).toEqual(["e1"]);
  });

  it("rejects attaching onto a non-Pokémon host", () => {
    const board = makeBoard({ you: { hand: [energy("e1")], active: card("x", "trainer") } });
    const result = moveCardOnBoard(board, { cardId: "e1", from: hand(0), to: active() });

    expect(result).toBe(board);
  });
});

describe("moveCardOnBoard — reordering", () => {
  it("reorders within the hand without changing its length", () => {
    const board = makeBoard({ you: { hand: [energy("e0"), poke("p1"), tool("t2")] } });
    const result = moveCardOnBoard(board, { cardId: "e0", from: hand(0), to: hand(2) });

    // An energy in the hand reorders like any other card — it is NOT attached.
    expect(ids(result.you.hand)).toEqual(["p1", "t2", "e0"]);
  });

  it("reorders within the bench", () => {
    const board = makeBoard({ you: { bench: [poke("b1"), poke("b2"), poke("b3")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: bench(2) });

    expect(ids(result.you.bench)).toEqual(["b2", "b3", "b1"]);
  });
});

describe("moveCardOnBoard — illegal moves are rejected", () => {
  it("rejects dragging a bench card into the hand", () => {
    const board = makeBoard({ you: { bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: hand() });

    expect(result).toBe(board);
  });

  it("rejects dragging the active card into the hand", () => {
    const board = makeBoard({ you: { active: poke("a1") } });
    const result = moveCardOnBoard(board, { cardId: "a1", from: active(), to: hand() });

    expect(result).toBe(board);
  });

  it("rejects moving a card to the opposing player's zone", () => {
    const board = makeBoard({ you: { hand: [poke("p1")] } });
    const result = moveCardOnBoard(board, {
      cardId: "p1",
      from: hand(0, "you"),
      to: active("opponent"),
    });

    expect(result).toBe(board);
  });

  it("treats a move onto the same placement as a no-op", () => {
    const board = makeBoard({ you: { bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: bench(0) });

    expect(result).toBe(board);
  });
});

describe("moveCardOnBoard — stadium slot", () => {
  it("plays a stadium card into the slot", () => {
    const board = makeBoard({ you: { hand: [stadiumCard("s1")] } });
    const result = moveCardOnBoard(board, { cardId: "s1", from: hand(0), to: stadiumSlot() });

    expect(result.stadium?.id).toBe("s1");
    expect(result.you.hand).toHaveLength(0);
  });

  it("replaces an existing stadium", () => {
    const board = makeBoard({ stadium: stadiumCard("old"), you: { hand: [stadiumCard("s1")] } });
    const result = moveCardOnBoard(board, { cardId: "s1", from: hand(0), to: stadiumSlot() });

    expect(result.stadium?.id).toBe("s1");
  });

  it("rejects a non-stadium card into the stadium slot", () => {
    const board = makeBoard({ you: { hand: [poke("p1")] } });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: stadiumSlot() });

    expect(result).toBe(board);
  });
});

describe("moveCardOnBoard — bench-expanding stadium", () => {
  it("rejects a 6th bench Pokémon at the default limit of 5", () => {
    const board = makeBoard({ you: { hand: [poke("p1")], bench: fullBench() } });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: bench() });

    expect(result).toBe(board);
  });

  it("allows a 6th bench Pokémon while a bench-expanding stadium is in play", () => {
    const board = makeBoard({
      stadium: stadiumCard("lumiose", "me3-111"),
      you: { hand: [poke("p1")], bench: fullBench() },
    });
    const result = moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: bench() });

    expect(result).not.toBe(board);
    expect(result.you.bench).toHaveLength(6);
  });
});

describe("moveCardOnBoard — robustness", () => {
  it("re-resolves a stale `from` placement via the card id", () => {
    // The drag reports a wrong source, but the card actually sits on the bench.
    const board = makeBoard({ you: { active: null, bench: [poke("b1")] } });
    const result = moveCardOnBoard(board, { cardId: "b1", from: hand(3), to: active() });

    expect(result.you.active?.id).toBe("b1");
    expect(result.you.bench).toHaveLength(0);
  });

  it("rejects a move whose cardId is not on the board", () => {
    const board = makeBoard({ you: { hand: [poke("p1")] } });
    const result = moveCardOnBoard(board, { cardId: "ghost", from: hand(0), to: active() });

    expect(result).toBe(board);
  });
});

describe("moveCardOnBoard — immutability", () => {
  it("never mutates the input board on an accepted move", () => {
    const board = makeBoard({ you: { hand: [poke("p1")], active: null } });
    const snapshot = structuredClone(board);

    moveCardOnBoard(board, { cardId: "p1", from: hand(0), to: active() });

    expect(board).toEqual(snapshot);
  });

  it("is idempotent across a repeated attach (StrictMode double-fire safety)", () => {
    // Calling the reducer twice on the SAME input must not double-append the
    // energy — cloneCard deep-copies so the source can't leak between calls.
    const board = makeBoard({ you: { hand: [energy("e1")], active: poke("a1") } });
    const req: CardMoveRequest = { cardId: "e1", from: hand(0), to: active() };

    const first = moveCardOnBoard(board, req);
    const second = moveCardOnBoard(board, req);

    expect(first.you.active?.attached?.energies).toHaveLength(1);
    expect(second.you.active?.attached?.energies).toHaveLength(1);
    expect(board.you.active?.attached).toBeUndefined();
  });
});

describe("moveCardOnBoard — battle state", () => {
  it("clones battle (and nested conditions) instead of sharing references across snapshots", () => {
    const board = makeBoard({
      you: {
        bench: [
          battlePoke("b1", { damage: 30, hp: 280, conditions: { ...NO_CONDITIONS } }),
          poke("b2"),
        ],
      },
    });
    // Bench reorder keeps battle intact, so the clone is comparable 1:1.
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: bench(1) });

    const moved = result.you.bench.find((c) => c.id === "b1");
    const sourceBattle = board.you.bench[0]?.battle;
    expect(moved?.battle).toEqual(sourceBattle);
    expect(moved?.battle).not.toBe(sourceBattle);
    expect(moved?.battle?.conditions).not.toBe(sourceBattle?.conditions);
  });

  it("keeps damage but cures conditions when the active retreats to the bench", () => {
    const board = makeBoard({
      you: {
        active: battlePoke("a1", {
          damage: 60,
          hp: 300,
          conditions: { rotation: "none", poisonDamage: 20, burned: false },
        }),
        bench: [poke("b1")],
      },
    });
    const result = moveCardOnBoard(board, { cardId: "a1", from: active(), to: bench() });

    const benched = result.you.bench.find((c) => c.id === "a1");
    expect(benched?.battle).toEqual({ damage: 60, hp: 300, conditions: NO_CONDITIONS });
    // Pure reducer: the input board's conditions stay untouched.
    expect(board.you.active?.battle?.conditions.poisonDamage).toBe(20);
  });

  it("cures the old active's conditions on a bench ↔ active swap too", () => {
    const board = makeBoard({
      you: {
        active: battlePoke("a1", {
          damage: 120,
          hp: 340,
          conditions: { rotation: "asleep", poisonDamage: 0, burned: true },
        }),
        bench: [poke("b1")],
      },
    });
    const result = moveCardOnBoard(board, { cardId: "b1", from: bench(0), to: active() });

    expect(result.you.active?.id).toBe("b1");
    const benched = result.you.bench.find((c) => c.id === "a1");
    expect(benched?.battle).toEqual({ damage: 120, hp: 340, conditions: NO_CONDITIONS });
  });
});

describe("canPlace", () => {
  it("is the gate moveCardOnBoard defends with — agrees on a legal move", () => {
    const board = makeBoard({ you: { hand: [poke("p1")] } });
    expect(canPlace(board, hand(0), active(), "pokemon")).toBe(true);
  });

  it("rejects the same illegal moves the reducer rejects", () => {
    const board = makeBoard({ you: { hand: [poke("p1")], active: poke("a1") } });
    expect(canPlace(board, hand(0), active(), "pokemon")).toBe(false);
  });

  it("rejects a stadium-source going anywhere but the stadium slot", () => {
    const board = makeBoard({ stadium: stadiumCard("s1") });
    expect(canPlace(board, stadiumSlot(), active(), "stadium")).toBe(false);
  });
});
