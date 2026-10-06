import { describe, expect, it } from "vitest";
import { redactGame } from "@luminous/engine";
import {
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  TRAINER_DECK,
} from "../../../packages/engine/src/testFixtures";
import { usableTrainerIdsForGame, usableTrainerIdsFromRedacted } from "./trainerUse";

function trainerTurn() {
  let state = driveSetup(170, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = handFromDeck(state, "p1", "sv01-181", 2);
  return handFromDeck(state, "p1", "sv01-189", 1);
}

describe("Trainer USE availability", () => {
  it("allows all duplicate copies using the server's deduplicated offers", () => {
    const state = trainerTurn();
    const before = JSON.stringify(state);
    const local = usableTrainerIdsForGame(state, "p1");
    const online = usableTrainerIdsFromRedacted(redactGame(state, "p1"));
    const items = state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === "sv01-181");
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const uid of items) {
      expect(local.has(uid)).toBe(true);
      expect(online.has(uid)).toBe(true);
    }
    expect(local.has(handUid(state, "p1", "sv01-189"))).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("blocks a spent Supporter allowance while keeping Items usable", () => {
    const initial = trainerTurn();
    const state = { ...initial, allowances: { ...initial.allowances, supporterPlayed: true } };
    const supporter = handUid(state, "p1", "sv01-189");
    const item = handUid(state, "p1", "sv01-181");
    for (const usable of [
      usableTrainerIdsForGame(state, "p1"),
      usableTrainerIdsFromRedacted(redactGame(state, "p1")),
    ]) {
      expect(usable.has(supporter)).toBe(false);
      expect(usable.has(item)).toBe(true);
    }
  });

  it("blocks first-turn Supporters and all Trainers for the other viewer", () => {
    const state = handFromDeck(
      driveSetup(170, { p1: TRAINER_DECK, p2: TRAINER_DECK }, { first: "p1" }),
      "p1",
      "sv01-189",
      1,
    );
    const supporter = handUid(state, "p1", "sv01-189");
    expect(usableTrainerIdsForGame(state, "p1").has(supporter)).toBe(false);
    expect(usableTrainerIdsFromRedacted(redactGame(state, "p1")).has(supporter)).toBe(false);
    expect(usableTrainerIdsForGame(state, "p2").size).toBe(0);
    expect(usableTrainerIdsFromRedacted(redactGame(state, "p2")).size).toBe(0);
  });
});
