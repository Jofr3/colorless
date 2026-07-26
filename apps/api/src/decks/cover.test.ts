import { describe, expect, it } from "vitest";
import { type CoverCandidate, pickCoverCardId } from "./cover";

// The rule that decides a deck's face (P5-3). Kept pure precisely so it can be
// argued with here rather than buried in SQL.

const card = (partial: Partial<CoverCandidate> & { cardId: string }): CoverCandidate => ({
  count: 1,
  category: "Pokemon",
  hp: 60,
  hasImage: true,
  ...partial,
});

describe("pickCoverCardId", () => {
  it("picks the biggest Pokémon — the deck's payoff, not its fetchers", () => {
    // The case that rules out ranking by COUNT: the 4-of Basic is not the deck.
    expect(
      pickCoverCardId([
        card({ cardId: "fuecoco", hp: 70, count: 4 }),
        card({ cardId: "skeledirge", hp: 170, count: 3 }),
      ]),
    ).toBe("skeledirge");
  });

  it("keeps a Basic ex over a Stage 2 tech line", () => {
    // And the case that rules out ranking by STAGE: HP gets this right without
    // having to order the stage vocabulary at all.
    expect(
      pickCoverCardId([
        card({ cardId: "chien-pao-ex", hp: 220, count: 3 }),
        card({ cardId: "some-stage-2", hp: 150, count: 1 }),
      ]),
    ).toBe("chien-pao-ex");
  });

  it("breaks an HP tie on copies, then on card id", () => {
    expect(
      pickCoverCardId([
        card({ cardId: "b", hp: 120, count: 1 }),
        card({ cardId: "a", hp: 120, count: 2 }),
      ]),
    ).toBe("a");
    // Same body, same copies: the id decides, so one deck always shows one face.
    const tied = [card({ cardId: "b", hp: 120 }), card({ cardId: "a", hp: 120 })];
    expect(pickCoverCardId(tied)).toBe("a");
    expect(pickCoverCardId([...tied].reverse())).toBe("a");
  });

  it("never fronts a deck with a Trainer or an Energy", () => {
    expect(
      pickCoverCardId([
        card({ cardId: "boss", category: "Trainer", hp: null, count: 4 }),
        card({ cardId: "water", category: "Energy", hp: null, count: 12 }),
        card({ cardId: "sneasel", hp: 70, count: 1 }),
      ]),
    ).toBe("sneasel");
  });

  it("skips a Pokémon with no scan rather than rendering a blank card", () => {
    expect(
      pickCoverCardId([
        card({ cardId: "unscanned", hp: 330, hasImage: false }),
        card({ cardId: "scanned", hp: 60 }),
      ]),
    ).toBe("scanned");
  });

  it("gives an empty or Pokémon-less deck no cover at all", () => {
    // The caller falls back to the card back — which is also exactly right for a
    // deck you have only just created.
    expect(pickCoverCardId([])).toBeNull();
    expect(pickCoverCardId([card({ cardId: "ball", category: "Trainer", hp: null })])).toBeNull();
  });
});
