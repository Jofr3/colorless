import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { chainMentions, describeError, errorChain, errorFields } from "./errors";

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

describe("describeError", () => {
  it("names a failed query and its cause, without the message", () => {
    expect(describeError(failedQuery(D1_UNIQUE))).toBe("DrizzleQueryError < Error");
  });

  it("keeps an ordinary error's message, clipped", () => {
    expect(describeError(new Error("no entropy"))).toBe("Error: no entropy");
    expect(describeError(new Error("x".repeat(500)))).toHaveLength(200);
  });
});
