import { describe, expect, it } from "vitest";
import { decodeFields, encodeFields, encodeRows, pixelText } from "./wire";

/** `value` with each surrogate half that is not part of a pair as U+FFFD. */
function wellFormed(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    const next = value.charCodeAt(i + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += value.slice(i, i + 2);
      i++;
    } else out += unit >= 0xd800 && unit <= 0xdfff ? "\ufffd" : value[i];
  }
  return out;
}

describe("Lua wire codec", () => {
  it("round-trips delimiters and unicode without allowing extra mailbox fields", () => {
    const values = ["name\twith\nlines", "Zoë % ", ""];
    expect(decodeFields(encodeFields(values))).toEqual(values);
  });
  it("encodes any UTF-16 string, sending a lone surrogate as U+FFFD", () => {
    // Seeded strings of random code units, surrogate halves among them.
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed;
    };
    const units = [0x41, 0x09, 0x0a, 0x25, 0xe9, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xd83d, 0xdd25];
    for (let i = 0; i < 500; i++) {
      const value = String.fromCharCode(
        ...Array.from({ length: next() % 12 }, () => units[next() % units.length] ?? 0x41),
      );
      const decoded = decodeFields(encodeFields([value, "x"]));
      expect(decoded, JSON.stringify(value)).toEqual([wellFormed(value), "x"]);
    }
    expect(decodeFields(encodeFields(["Bro\udc00ck"]))).toEqual(["Bro\ufffdck"]);
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
