import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { settleProgram } from "./flow";
import { type GameEvent, type GameState, createGame } from "./index";
import { runProgram } from "./interpreter";
import { GAME_STATE_VERSION } from "./persist";
import { completeSetup } from "./testFixtures";
import { freshAllowances, makeInPlay } from "./types";

// A persisted state is read back as-is only when its version matches, so any change to its shape
// must come with a version bump. This pins a key-and-type skeleton of that shape, together with the
// version it was taken at, in `persistShape.snap`.

const STALE = `the persisted state shape or GAME_STATE_VERSION no longer matches persistShape.snap. A shape change needs a version bump in persist.ts (with a migration step if old states can be carried forward); then rewrite the snapshot with "bunx vitest run packages/engine/src/persistShape.test.ts -u"`;

/** Maps keyed by uid or card id: their keys vary with the decks, only their values have a shape. */
const KEYED_BY_ID = new Set(["cardIdByUid", "cardPool"]);

function uniqueShapes(values: readonly unknown[]): unknown[] {
  const byText = new Map(values.map((value) => [JSON.stringify(value), value]));
  return [...byText.keys()].sort().map((text) => byText.get(text));
}

/** Sorted keys and `typeof` leaves; array elements and id-keyed map values merged to their distinct shapes. */
function skeleton(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return uniqueShapes(value.map(skeleton));
  if (typeof value !== "object") return typeof value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    out[key] =
      KEYED_BY_ID.has(key) && entry !== null && typeof entry === "object"
        ? { "<id>": uniqueShapes(Object.values(entry).map(skeleton)) }
        : skeleton(entry);
  }
  return out;
}

function basicCard(id: string): Card {
  return {
    id,
    setId: "test",
    localId: "1",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: 60,
    stage: "Basic",
    evolveFrom: null,
    types: ["Colorless"],
    retreat: 1,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

function freshGame(): GameState {
  const deck = Array.from({ length: 60 }, () => "basic");
  const started = createGame({
    seed: 3,
    decks: { p1: [...deck], p2: [...deck] },
    cardPool: { basic: basicCard("basic") },
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

/** A program parked mid-way, with a recorded slot and ops still queued behind the question. */
function parkedGame(inTurn: GameState): GameState {
  const events: GameEvent[] = [];
  const run = runProgram(
    inTurn,
    [
      { op: "drawCards", count: 1, recordAs: "moved" },
      { op: "optional", note: "You may draw a card.", ops: [{ op: "drawCards", count: 1 }] },
      { op: "shuffleDeck" },
    ],
    { seat: "p1" },
    {},
    events,
  );
  const settled = settleProgram(run, "p1", {}, events);
  if (!settled.ok) throw new Error(settled.error.message);
  return settled.state;
}

function persistedShape(): unknown {
  const game = freshGame();
  const inTurn = completeSetup(game);
  const parked = parkedGame(inTurn);
  if (parked.phase.kind !== "effect:choose") throw new Error("the program did not park");
  return skeleton({
    game,
    side: inTurn.players.p1,
    inPlay: makeInPlay("uid", 1),
    allowances: freshAllowances(),
    parked: parked.phase,
  });
}

describe("the persisted shape is pinned to GAME_STATE_VERSION", () => {
  it("matches the snapshot taken at this version", async () => {
    const pinned = JSON.stringify(
      { version: GAME_STATE_VERSION, shape: persistedShape() },
      null,
      2,
    );
    await expect(`${pinned}\n`, STALE).toMatchFileSnapshot("./persistShape.snap");
  });

  it("the skeleton sees a renamed key, a changed leaf type and a new array element shape", () => {
    expect(skeleton({ b: 1, a: [null, "x", "y"] })).toEqual({ a: ["null", "string"], b: "number" });
    expect(skeleton({ a: 1 })).not.toEqual(skeleton({ b: 1 }));
    expect(skeleton({ a: 1 })).not.toEqual(skeleton({ a: "1" }));
    expect(skeleton({ a: [{ x: 1 }] })).not.toEqual(skeleton({ a: [{ x: 1 }, { x: 1, y: 2 }] }));
    expect(skeleton({ cardIdByUid: { "p1-1": "a", "p2-9": "b" } })).toEqual({
      cardIdByUid: { "<id>": ["string"] },
    });
  });
});
