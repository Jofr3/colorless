import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  chainMentions,
  describeError,
  errorChain,
  errorFields,
  errorFrames,
  MAX_FRAME_LENGTH,
  MAX_FRAMES,
  unhandledErrorFields,
} from "./errors";

const D1_UNIQUE = new Error("D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT");
const SECRET = "victim.person@example.com";

/** What drizzle throws for a failed single query: the params ride in the message. */
const failedQuery = (cause: Error) =>
  new DrizzleQueryError('insert into "users" ("email") values (?)', [SECRET], cause);

describe("errorChain", () => {
  it("walks `.cause` and stops at a loop", () => {
    const outer = new Error("outer", { cause: D1_UNIQUE });
    expect(errorChain(outer)).toEqual([outer, D1_UNIQUE]);
    const looped = new Error("a");
    looped.cause = looped;
    expect(errorChain(looped)).toEqual([looped]);
    expect(errorChain("text")).toEqual([]);
  });

  it("finds D1's text under drizzle's wrapper", () => {
    expect(failedQuery(D1_UNIQUE).message).not.toContain("UNIQUE");
    expect(chainMentions(failedQuery(D1_UNIQUE), /UNIQUE constraint failed/)).toBe(true);
    expect(chainMentions(new Error("other"), /UNIQUE constraint failed/)).toBe(false);
  });
});

describe("errorFields", () => {
  it("keeps names, the SQL and the quota flag, never the params", () => {
    const fields = errorFields(failedQuery(new Error("D1_ERROR: Exceeded maximum rows written")));
    expect(fields).toEqual({
      error: "DrizzleQueryError",
      cause: "Error",
      query: 'insert into "users" ("email") values (?)',
      quota: true,
    });
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });

  it("describes any other error by its name alone", () => {
    expect(errorFields(new TypeError(`cannot read ${SECRET}`))).toEqual({
      error: "TypeError",
      cause: undefined,
      query: undefined,
      quota: false,
    });
    expect(errorFields("thrown string")).toEqual({ error: "string" });
  });
});

/** An error whose stack is `stack`, as a runtime would have written it at the throw. */
function withStack(error: Error, stack: string): Error {
  error.stack = stack;
  return error;
}

describe("errorFrames", () => {
  it("keeps the stack's `at` frames, innermost first, without the message", () => {
    const error = withStack(
      new TypeError(`cannot read ${SECRET}`),
      `TypeError: cannot read ${SECRET}\n    at readCache (index.js:1:200)\n    at async fetch (index.js:9:30)`,
    );
    expect(errorFrames(error)).toBe(
      "at readCache (index.js:1:200)\nat async fetch (index.js:9:30)",
    );
  });

  it("never takes a frame-shaped line from a failed query's params", () => {
    const query = new DrizzleQueryError(
      'update "decks" set "name" = ?',
      [`x\n    at ${SECRET}`],
      D1_UNIQUE,
    );
    withStack(query, `Error: ${query.message}\n    at saveDeck (index.js:4:10)`);
    expect(errorFrames(query)).toBe("at saveDeck (index.js:4:10)");
  });

  it("gives none when the stack no longer holds the message", () => {
    const rewritten = withStack(new Error("a\nparams: b"), "Error: other\n    at f (index.js:1:1)");
    expect(errorFrames(rewritten)).toBeUndefined();
    expect(errorFrames(withStack(new Error("no frames"), "Error: no frames"))).toBeUndefined();
    expect(errorFrames("thrown string")).toBeUndefined();
  });

  it("bounds the frames' count and length", () => {
    const deep = Array.from({ length: 20 }, (_, i) => `    at f${i} (${"x".repeat(400)}:1:1)`);
    const frames = errorFrames(withStack(new Error("deep"), ["Error: deep", ...deep].join("\n")));
    const lines = frames?.split("\n") ?? [];
    expect(lines).toHaveLength(MAX_FRAMES);
    expect(lines[0]).toMatch(/^at f0 /);
    expect(Math.max(...lines.map((line) => line.length))).toBe(MAX_FRAME_LENGTH);
  });

  it("reads a real stack", () => {
    const frames = errorFrames(new RangeError(`bad ${SECRET}`)) ?? "";
    expect(frames.split("\n").every((line) => line.startsWith("at "))).toBe(true);
    expect(frames).not.toContain(SECRET);
  });
});

describe("unhandledErrorFields", () => {
  it("adds the frames to errorFields", () => {
    const error = withStack(new TypeError("x"), "TypeError: x\n    at handler (index.js:2:3)");
    expect(unhandledErrorFields(error)).toEqual({
      ...errorFields(error),
      frames: "at handler (index.js:2:3)",
    });
  });
});

describe("describeError", () => {
  it("names a failed query and its cause, without the message", () => {
    expect(describeError(failedQuery(D1_UNIQUE))).toBe("DrizzleQueryError < Error");
  });

  it("keeps an ordinary error's message, clipped", () => {
    expect(describeError(new Error("no entropy"))).toBe("Error: no entropy");
    expect(describeError(new Error("x".repeat(500)))).toHaveLength(200);
  });
});
