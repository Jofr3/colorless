import { afterEach, describe, expect, it, vi } from "vitest";
import { envInt, flags, isRecord, linesWithOverflow, parseFlags, parseJson } from "./cli";

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

describe("parseFlags", () => {
  const spec = { booleans: ["--keep", "--gpu"], values: ["--runs"] };

  it("reads boolean flags and values", () => {
    const parsed = parseFlags(["--gpu", "--runs", "3"], spec);
    expect(parsed.problems).toEqual([]);
    expect([...parsed.given]).toEqual(["--gpu", "--runs"]);
    expect(parsed.values.get("--runs")).toBe("3");
  });

  it("refuses an unknown flag or a positional, so a typo cannot run the default configuration", () => {
    expect(parseFlags(["--firefx", "keep"], spec).problems).toEqual([
      "unknown flag `--firefx`",
      "unexpected argument `keep`",
    ]);
  });

  it("refuses a repeated flag and a value flag with no value", () => {
    expect(parseFlags(["--keep", "--keep"], spec).problems).toEqual([
      "`--keep` given more than once",
    ]);
    expect(parseFlags(["--runs"], spec).problems).toEqual(["`--runs` needs a value"]);
    expect(parseFlags(["--runs", "--gpu"], spec)).toMatchObject({
      problems: ["`--runs` needs a value"],
      given: new Set(["--runs", "--gpu"]),
    });
  });
});

describe("flags", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 with the problems and the usage line", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    expect(() =>
      flags("bun run e2e", ["--firefx"], { booleans: ["--firefox"], values: ["--runs"] }),
    ).toThrow("exit 1");
    expect(error).toHaveBeenCalledWith(
      "unknown flag `--firefx`\nusage: bun run e2e [--firefox] [--runs <value>]",
    );
  });

  it("returns what a well-formed command line set", () => {
    expect([...flags("x", ["--firefox"], { booleans: ["--firefox"] }).given]).toEqual([
      "--firefox",
    ]);
  });
});
