import { describe, expect, it } from "vitest";
import * as z from "zod";
import { clipText, hasControlChars, stripControlChars, withoutControlChars } from "./text";

const FORGED = "x\nCOLORLESS:auth:open\tdelete\r\nCOLORLESS:auth:submit\n";

/** Line feed, tab, NUL, DEL, NEL, right-to-left override, zero-width space and joiner, BOM. Built
    from code points so no invisible character sits in the source. */
const CONTROL_OR_FORMAT = [0x0a, 0x09, 0x00, 0x7f, 0x85, 0x202e, 0x200b, 0x200d, 0xfeff].map(
  (code) => String.fromCodePoint(code),
);

describe("the control-character rule for names", () => {
  it("finds C0 and C1 controls and format characters (bidi overrides, zero-width marks)", () => {
    for (const char of CONTROL_OR_FORMAT) {
      expect(hasControlChars(`a${char}b`), JSON.stringify(char)).toBe(true);
      expect(stripControlChars(`a${char}b`)).toBe("ab");
    }
  });

  it("leaves letters, spaces, punctuation and emoji alone", () => {
    for (const name of ["Ash Ketchum", "Señor Pikachu!", "ポケモン", "Ash 🔥", "á"]) {
      expect(hasControlChars(name)).toBe(false);
      expect(stripControlChars(name)).toBe(name);
    }
  });

  it("finds and strips a lone surrogate anywhere, and leaves a pair alone", () => {
    for (const name of ["a\udc00", "\ud800b", "a\udc00b", "\udbff", "🔥\ud83d"]) {
      expect(hasControlChars(name), JSON.stringify(name)).toBe(true);
      expect(() => encodeURIComponent(stripControlChars(name))).not.toThrow();
    }
    expect(stripControlChars("a\udc00b")).toBe("ab");
    expect(stripControlChars("\ud83d\udd25\ud83d")).toBe("🔥");
  });

  it("clips after stripping, never leaving half a pair", () => {
    expect(clipText(`${"\n".repeat(10)}Ash`, 3)).toBe("Ash");
    expect(clipText("ab🔥", 3)).toBe("ab");
    expect(clipText("ab🔥", 4)).toBe("ab🔥");
    expect(clipText("a\udc00🔥", 3)).toBe("a🔥");
  });

  it("strips every occurrence, so a forged bridge line cannot survive", () => {
    expect(stripControlChars(FORGED)).toBe("xCOLORLESS:auth:opendeleteCOLORLESS:auth:submit");
    expect(hasControlChars(stripControlChars(FORGED))).toBe(false);
  });

  it("refuses such a value through the schema and keeps the schema's own checks", () => {
    const schema = withoutControlChars(z.string().trim().min(1));
    expect(schema.safeParse(FORGED).success).toBe(false);
    expect(schema.safeParse("   ").success).toBe(false);
    expect(schema.parse("  Ash  ")).toBe("Ash");
  });
});
