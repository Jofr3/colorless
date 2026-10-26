import { redactGame } from "@colorless/engine";
import { driveSetup } from "@colorless/engine/testing";
import type { RedactedGame, SeatLogEntry } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { autoStepFor, eventsFromLog } from "./tableEvents";

const row = (who: "p1" | "p2" | "system", text: string, extra = {}): SeatLogEntry => ({
  kind: "action",
  who,
  elapsed: "+00:01",
  segments: [{ text }],
  ...extra,
});
const name = (seat: string) => (seat === "p1" ? "Ash" : "Brock");

describe("eventsFromLog", () => {
  it("reads Knock Outs, shuffles and coins off the rows' cues, not their wording", () => {
    const events = eventsFromLog(
      [
        row("p1", "played Pokégear", {
          playedTrainer: { id: "p1#9", cardId: "x", name: "Pokégear" },
        }),
        row("p1", "flipped heads", { cues: [{ kind: "coin", seat: "p1", face: "heads" }] }),
        row("system", "Checkup", { cues: [{ kind: "coin", seat: "p2", face: "tails" }] }),
        row("p2", "Pikachu was Knocked Out", {
          cues: [{ kind: "knockOut", seat: "p2", uid: "p2#4" }],
        }),
        row("p2", "reshuffled", { cues: [{ kind: "shuffle", seat: "p2", zone: "hand" }] }),
        row("p1", "shuffled their deck", { cues: [] }),
      ],
      name,
    );
    expect(events).toEqual({
      knockedOut: ["p2#4"],
      shuffled: ["p2"],
      coin: {
        title: "Pokégear",
        flips: [
          { result: "heads", player: "Ash", seat: "p1" },
          { result: "tails", player: "Brock", seat: "p2" },
        ],
      },
    });
  });

  it("titles a coin with no Trainer behind it plainly", () => {
    const events = eventsFromLog(
      [row("p2", "flipped", { cues: [{ kind: "coin", seat: "p2", face: "heads" }] })],
      name,
    );
    expect(events.coin?.title).toBe("Coin flip");
  });

  it("falls back to the wording only for rows written before cues", () => {
    const events = eventsFromLog(
      [
        row("p1", "Ash shuffled their deck"),
        row("p2", "shuffled their hand (3 cards) and put it on the bottom of their deck"),
        row("system", "shuffled their deck"),
        row("p2", "Pikachu was Knocked Out"),
      ],
      name,
    );
    expect(events).toEqual({ knockedOut: [], shuffled: ["p1"], coin: null });
  });
});

describe("autoStepFor", () => {
  const view = (edit: (v: RedactedGame) => void) => {
    const v = structuredClone(redactGame(driveSetup(7, undefined, { first: "p1" }), "p1"));
    edit(v);
    return v;
  };

  it("draws the owed mulligan cards and takes Prizes from the end of the row", () => {
    expect(
      autoStepFor(
        view((v) => {
          v.phase = { kind: "setup:drawExtra", owed: 2 };
          v.waitingOn = "you";
        }),
      ),
    ).toEqual({ type: "setupDrawExtra", seat: "p1", count: 2 });
    expect(
      autoStepFor(
        view((v) => {
          v.phase = { kind: "ko:takePrizes", count: 2 };
          v.waitingOn = "you";
        }),
      ),
    ).toEqual({ type: "takePrizes", seat: "p1", prizeIndices: [5, 4] });
  });

  it("takes nothing for the other seat, after the game, or in any other phase", () => {
    const prizes = { kind: "ko:takePrizes", count: 1 } as const;
    expect(
      autoStepFor(
        view((v) => {
          v.phase = prizes;
          v.waitingOn = "opponent";
        }),
      ),
    ).toBeNull();
    expect(
      autoStepFor(
        view((v) => {
          v.phase = prizes;
          v.waitingOn = "you";
          v.outcome = { result: "win", winner: "you", reason: "prizesTaken" };
        }),
      ),
    ).toBeNull();
    expect(
      autoStepFor(
        view((v) => {
          v.waitingOn = "you";
        }),
      ),
    ).toBeNull();
  });
});
