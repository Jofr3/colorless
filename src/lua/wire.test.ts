import { describe, expect, it } from "vitest";
import { decodeFields, encodeFields, encodeRows, pixelText } from "./wire";

describe("Lua wire codec", () => {
  it("round-trips delimiters and unicode without allowing extra mailbox fields", () => {
    const values = ["name\twith\nlines", "Zoë % ", ""];
    expect(decodeFields(encodeFields(values))).toEqual(values);
  });
  it("rejects malformed percent-sequences instead of throwing", () => {
    expect(decodeFields("open\t%E0%A4%A")).toBeNull();
    expect(decodeFields("%")).toBeNull();
  });
  it("joins encoded rows with newlines", () => {
    expect(encodeRows([["a b", 1], ["c\nd"]])).toBe("a%20b\t1\nc%0Ad");
  });
  it("spells glyphs the pixel font lacks in ASCII", () => {
    expect(pixelText("A → B · C — D −1…")).toBe("A -> B, C - D -1...");
  });
});
