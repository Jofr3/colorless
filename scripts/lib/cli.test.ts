import { afterEach, describe, expect, it, vi } from "vitest";
import { envInt, isRecord, linesWithOverflow, parseJson } from "./cli";

describe("envInt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back when the variable is unset or empty", () => {
    expect(envInt("CLI_TEST_INT", 4)).toBe(4);
    vi.stubEnv("CLI_TEST_INT", "");
    expect(envInt("CLI_TEST_INT", 4)).toBe(4);
  });

  it("reads an integer", () => {
    vi.stubEnv("CLI_TEST_INT", "7");
    expect(envInt("CLI_TEST_INT", 4)).toBe(7);
  });

  it("rejects anything that is not an integer", () => {
    for (const raw of ["abc", "2.5", "1e400"]) {
      vi.stubEnv("CLI_TEST_INT", raw);
      expect(() => envInt("CLI_TEST_INT", 4)).toThrow("CLI_TEST_INT must be an integer");
    }
  });
});

describe("parseJson", () => {
  const hasN = (v: unknown): v is { n: number } => isRecord(v) && typeof v.n === "number";

  it("returns a value of the guarded shape", () => {
    expect(parseJson('{"n": 3}', "sample", hasN)).toEqual({ n: 3 });
  });

  it("names the label when the text is not JSON", () => {
    expect(() => parseJson('{"n": 3', "sample", hasN)).toThrow("sample: not valid JSON");
  });

  it("names the label when the shape is wrong", () => {
    expect(() => parseJson('{"n": "3"}', "sample", hasN)).toThrow("sample: unexpected JSON shape");
    expect(() => parseJson("[1]", "sample", hasN)).toThrow("sample: unexpected JSON shape");
  });
});

describe("linesWithOverflow", () => {
  const render = (n: number) => [`item ${n}`];
  const more = (hidden: number) => `and ${hidden} more`;

  it("lists everything when within the cap", () => {
    expect(linesWithOverflow([1, 2], 2, render, more)).toEqual(["item 1", "item 2"]);
  });

  it("counts what the cap hides", () => {
    expect(linesWithOverflow([1, 2, 3, 4], 2, render, more)).toEqual([
      "item 1",
      "item 2",
      "and 2 more",
    ]);
  });
});
