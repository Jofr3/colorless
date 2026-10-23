import { describe, expect, it } from "vitest";
import { coinFlipsFromEvents } from "./coinFlips";

describe("coinFlipsFromEvents", () => {
  it("D636 — shows Quaking Fist's coin at a Trainer play (TRAINER_FLIP_LOCK_CHECK)", () => {
    expect(
      coinFlipsFromEvents(
        [{ type: "TRAINER_FLIP_LOCK_CHECK", seat: "p2", uid: "u1", result: "tails" }],
        {
          p1: "Ana",
          p2: "Bo",
        },
      ),
    ).toEqual([{ result: "tails", player: "Bo", seat: "p2" }]);
  });
});
