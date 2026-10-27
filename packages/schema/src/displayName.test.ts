import { describe, expect, it } from "vitest";
import { displayNameField } from "./auth/requests";
import { cleanDisplayName, DISPLAY_NAME_MAX } from "./displayName";
import { helloMessageSchema } from "./lobby/wire";

const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);

describe("the display-name rule", () => {
  it("folds compatibility forms, collapses whitespace and trims, on a write", () => {
    expect(displayNameField.parse(`  Ｍｉｓｔｙ ${IDEOGRAPHIC_SPACE} Water\n`)).toBe("Misty Water");
    expect(displayNameField.parse("Ash 🔥")).toBe("Ash 🔥");
  });

  it("refuses a control or format character on a write, and a name past the bound", () => {
    for (const name of [`Ash${RLO}`, `A${ZWSP}sh`, "Ash\tKetchum", "   ", "x".repeat(65)]) {
      expect(displayNameField.safeParse(name).success, JSON.stringify(name)).toBe(false);
    }
    // The bound applies after collapsing, so spaced-out padding does not count against it.
    expect(displayNameField.parse(`${"x".repeat(32)}     ${"y".repeat(31)}`)).toHaveLength(64);
  });

  it("strips instead of refusing where a name is only read or announced, then clips", () => {
    expect(cleanDisplayName(`  A${RLO}sh\n\nKetchum  `)).toBe("AshKetchum");
    expect(cleanDisplayName("Ash   Ketchum")).toBe("Ash Ketchum");
    expect(cleanDisplayName(ZWSP)).toBe("");
    expect(cleanDisplayName("n".repeat(100))).toBe("n".repeat(DISPLAY_NAME_MAX));
    // A clip never leaves half a surrogate pair.
    expect(cleanDisplayName(`${"n".repeat(63)}🔥`)).toBe("n".repeat(63));
  });

  it("is the lobby hello's rule too", () => {
    const hello = helloMessageSchema.parse({
      kind: "hello",
      from: "seat",
      name: ` Ｂrock${RLO}   the Rock `,
    });
    expect(hello.name).toBe("Brock the Rock");
  });
});
