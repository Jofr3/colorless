import { describe, expect, it } from "vitest";
import {
  fileInfoOf,
  judgeRow,
  type RowVerdict,
  type VerdictCache,
  verdictCacheOf,
} from "./binding-gate";

const HEAD = "export function f(a: number): number {";
const BODY = `${HEAD}\n  return a;\n}\n`;
const BOUND = `${BODY}export const g = (n: number): number => n;\n`;
const UNBOUND = `${BODY}export const k = (n: number): number => n;\n`;
const READS_F = `${BODY}export const use = (): number => f(1);\n`;
const READS_Q = `${BODY}export const use = (): number => q(1);\n`;
const RETURN = "  return a;";
const CALL_G = "  return g(a);";
const RENAME = "export function f2(a: number): number {";
const POISON: RowVerdict = { flagged: ["poison"], introduces: true };

function judge(text: string, find: string, replace: string, cache?: VerdictCache) {
  const fi = fileInfoOf("target.ts", text);
  if (fi === null) throw new Error("not a code file");
  return judgeRow(fi, find, replace, cache);
}

/** A cache whose every stored verdict is POISON, keyed as one cold run of the row keyed it. */
function poisoned(text: string, find: string, replace: string): VerdictCache {
  const cold = verdictCacheOf("stamp");
  judge(text, find, replace, cold);
  return verdictCacheOf("stamp", new Map([...cold.used.keys()].map((key) => [key, POISON])));
}

describe("judgeRow's verdict cache", () => {
  it("gives the same verdict warm as cold", () => {
    for (const [text, find, replace] of [
      [BOUND, RETURN, CALL_G],
      [UNBOUND, RETURN, CALL_G],
      [READS_F, HEAD, RENAME],
    ] as const) {
      const cold = verdictCacheOf("stamp");
      const first = judge(text, find, replace, cold);
      const warm = verdictCacheOf("stamp", cold.used);
      expect(judge(text, find, replace, warm)).toEqual(first);
      expect(judge(text, find, replace, warm)).toEqual(judge(text, find, replace));
      expect([...warm.used.keys()]).toEqual([...cold.used.keys()]);
    }
  });

  it("answers an unchanged row from the cache", () => {
    expect(judge(BOUND, RETURN, CALL_G, poisoned(BOUND, RETURN, CALL_G))).toEqual(POISON);
  });

  it("misses once the rest of the file stops binding a name, the region unchanged", () => {
    expect(judge(UNBOUND, RETURN, CALL_G, poisoned(BOUND, RETURN, CALL_G))).toEqual({
      flagged: ["g"],
      introduces: true,
    });
  });

  it("misses once the rest of the file starts reading a name the region declares", () => {
    expect(judge(READS_F, HEAD, RENAME, poisoned(READS_Q, HEAD, RENAME))).toEqual({
      flagged: ["f"],
      introduces: false,
    });
  });

  it("misses once the replacement changes", () => {
    expect(judge(BOUND, RETURN, "  return h(a);", poisoned(BOUND, RETURN, CALL_G))).toEqual({
      flagged: ["h"],
      introduces: true,
    });
  });
});
