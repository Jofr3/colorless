import type { SeatLogEntry } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { usedTrainersForTurn } from "./usedTrainers";

const turn = (n: number): SeatLogEntry => ({ kind: "turn", turn: n });
const played = (id: string, name = "Pokégear"): SeatLogEntry => ({
  kind: "action",
  who: "p1",
  elapsed: "+00:01",
  segments: [{ text: `played ${name}` }],
  playedTrainer: { id, cardId: "x", name },
});
const attacked: SeatLogEntry = {
  kind: "action",
  who: "p2",
  elapsed: "+00:02",
  segments: [{ text: "attacked" }],
};

describe("usedTrainersForTurn", () => {
  const log = [
    played("p1#1"),
    turn(1),
    played("p1#2"),
    attacked,
    played("p1#3", "Ultra Ball"),
    turn(2),
    played("p2#7"),
  ];

  it("lists the Trainers played during that turn only, in play order", () => {
    expect(usedTrainersForTurn(log, 1)).toEqual(["p1#2", "p1#3"]);
    expect(usedTrainersForTurn(log, 2)).toEqual(["p2#7"]);
    expect(usedTrainersForTurn(log, 3)).toEqual([]);
  });

  it("lists nothing before the first turn, where setup rows sit", () => {
    expect(usedTrainersForTurn(log, 0)).toEqual([]);
  });
});
