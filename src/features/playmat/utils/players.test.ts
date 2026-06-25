import { describe, expect, it } from "vitest";
import { cardBackToneFor, opponentOf } from "./players";

describe("opponentOf", () => {
  it("returns the other player", () => {
    expect(opponentOf("you")).toBe("opponent");
    expect(opponentOf("opponent")).toBe("you");
  });
});

describe("cardBackToneFor", () => {
  it("maps you→blue and opponent→red", () => {
    expect(cardBackToneFor("you")).toBe("blue");
    expect(cardBackToneFor("opponent")).toBe("red");
  });
});
