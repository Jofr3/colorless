import { type LogCue, logCueSchema, type SeatLogEntry } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { cuesFromEvents } from "./cues";
import type { GameEvent, GameState, Seat } from "./index";
import { formatElapsed, logFromEvents, redactGame } from "./index";
import {
  ABILITY_DECK,
  ALWAYS_ON_REDUCTION_DECK,
  FIXTURE_POOL,
  LISIAS_APPEAL_DECK,
  REVEAL_BOTTOM_DECK,
  mustCreate,
  walkGame,
} from "./testFixtures";

const NAMES = { p1: "One", p2: "Two" };
const SEATS: Seat[] = ["p1", "p2"];
const textOf = (entry: SeatLogEntry) =>
  entry.kind === "action" ? entry.segments.map((s) => s.text).join("") : "";

/** Every card id a viewer can see in play or in a discard pile. */
function publicIds(state: GameState, viewer: Seat): Set<string> {
  const board = redactGame(state, viewer).board;
  return new Set(
    [board.you, board.opponent].flatMap((side) => [
      ...(side.active === null ? [] : [side.active.id]),
      ...side.bench.map((c) => c.id),
      ...side.discard.map((c) => c.id),
    ]),
  );
}

describe("cuesFromEvents", () => {
  it("maps shuffles, Knock Outs and in-game coins, and nothing else", () => {
    const events: GameEvent[] = [
      { type: "SHUFFLE", seat: "p1" },
      { type: "HAND_SHUFFLED_INTO_DECK", seat: "p2", count: 4 },
      { type: "HAND_TO_BOTTOM_OF_DECK", seat: "p2", count: 4 },
      { type: "KNOCKED_OUT", seat: "p2", uid: "p2#7", discarded: [] },
      { type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" },
      { type: "TRAINER_FLIP_LOCK_CHECK", seat: "p2", uid: "p2#3", result: "tails" },
      { type: "COIN_FLIP", result: "heads", winner: "p1" },
    ];
    expect(cuesFromEvents(events)).toEqual([
      { kind: "shuffle", seat: "p1", zone: "deck" },
      { kind: "shuffle", seat: "p2", zone: "hand" },
      { kind: "knockOut", seat: "p2", uid: "p2#7" },
      { kind: "coin", seat: "p1", face: "heads" },
      { kind: "coin", seat: "p2", face: "tails" },
    ]);
  });
});

describe("log cues reveal nothing their row hides", () => {
  it.each([
    ["ability", ABILITY_DECK],
    ["always-on reduction", ALWAYS_ON_REDUCTION_DECK],
    ["Lisia's Appeal", LISIAS_APPEAL_DECK],
    ["reveal bottom", REVEAL_BOTTOM_DECK],
  ])("on every accepted action of a seeded %s walk", (_name, deck) => {
    const reached = new Set<LogCue["kind"]>();
    const leaks: string[] = [];
    walkGame(mustCreate(7, { p1: deck, p2: deck }, FIXTURE_POOL).state, 11, () => {}, {
      onStep: (before, action, events, after) => {
        const entries = logFromEvents(events, {
          names: NAMES,
          state: after,
          elapsed: formatElapsed(0),
        });
        for (const entry of entries) {
          if (entry.kind !== "action" || entry.cues === undefined) continue;
          for (const cue of entry.cues) {
            reached.add(cue.kind);
            const at = `${action.type} turn ${before.turn}: ${JSON.stringify(cue)}`;
            if (JSON.stringify(logCueSchema.parse(cue)) !== JSON.stringify(cue))
              leaks.push(`${at} carries a field the schema does not`);
            if (cue.kind === "coin") {
              if (!textOf(entry).includes(cue.face)) leaks.push(`${at} face not on its row`);
            } else if (entry.who !== cue.seat) leaks.push(`${at} filed under ${entry.who}`);
            if (cue.kind !== "knockOut") continue;
            for (const viewer of SEATS)
              if (!publicIds(before, viewer).has(cue.uid) && !publicIds(after, viewer).has(cue.uid))
                leaks.push(`${at} hidden from ${viewer}`);
          }
        }
      },
    });
    expect(leaks).toEqual([]);
    expect([...reached].sort()).toEqual(["coin", "knockOut", "shuffle"]);
  });
});
