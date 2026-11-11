import { describe, expect, it } from "vitest";
import {
  commentGuardReport,
  commentsOf,
  hashComments,
  luaComments,
  scriptComments,
} from "./comment-guard";

const report = (path: string, text: string) => commentGuardReport([{ path, text }]);
const hits = (path: string, text: string) =>
  report(path, text)
    .lines.filter((line) => line.startsWith("  "))
    .map((line) => line.trim());

describe("comment-guard", () => {
  it.each([
    ["a decision number", "// The reprint shares one object (D190b).", "decision number"],
    ["a numbered user decision", "// Never blocking (decision 1b).", "decision number"],
    ["an audit phase", "// Its throw is a code defect (OBS-P2).", "audit phase"],
    ["a follow-up id", "// The lobby grows as a layer (UI-FU2).", "audit phase"],
    ["an audit finding", "// A generated handle (security audit AU3).", "audit finding"],
    ["an X finding", "// Register is capped per address (AUX1).", "audit finding"],
    ["a finding named by its audit", "// A pinned toolchain (audit ZZ4).", "audit finding"],
    ["a card revision", "// Off the attacker since card revision B21.", "card revision"],
    ["a bare card revision", "// The face text is catalog debt (B04).", "card revision"],
    ["a program phase", "// The stored pin (P5-6).", "program phase"],
    ["a program sub-phase", "// Give up the game (P4 3c-ii).", "program phase"],
    ["a program increment", "// A failed resolution (P4 increment 3).", "program phase"],
    ["a program task", "// The filter vocabularies (P2 task 10).", "program phase"],
    ["a numbered phase", "// Phase 0 baselines.", "program phase"],
    ["a milestone", "// The M1 no-choice rule.", "milestone"],
    ["a dated check", "// (verified vs the local catalog 2026-07-20).", "date"],
    ["a line number", "// The holder of file line 586 is a Stage 1.", "line number"],
    [
      "an upper-case line number",
      "/** index 0 — FILE LINES 294 and 295 verbatim. */",
      "line number",
    ],
    [
      "a file and line",
      "// It cannot be answered with a repeat (cardplay.ts:1419).",
      "line number",
    ],
    ["a Lua file and line", "// The overlay draws first (overlay.lua:12).", "line number"],
    ["a bare line reference", "// {C}, 10 — the installer (:171)", "line number"],
    [
      "a quoted bare line reference",
      "/** The `:76` installer, plus a plain attack. */",
      "line number",
    ],
    ["a leading bare line reference", "// :343", "line number"],
  ])("fails %s", (_label, comment, form) => {
    expect(hits("packages/engine/src/a.ts", `const a = 1;\n${comment}\n`)).toEqual([
      `packages/engine/src/a.ts:2: (${form}) ${comment}`,
    ]);
  });

  it("passes the database, the bucket, seats, hashes, set codes, rule sections and versions", () => {
    const text = [
      "// A D1 outage is a degradation, not a defect; R2 keeps the scans.",
      "// P1's Active is the gate holder; the turn is P2's.",
      "// PBKDF2 of HMAC-SHA256(pepper, password), UTF-8 encoded.",
      "// Judge (sv01-176; sv04.5-228), the SV01–03 pool, §3.6 and §8.1.",
      "// A v50 state keeps its number; ES2022 and V8, Q1 2027.",
      "// m1 is a local; M10 is not a milestone; a phase 2 turns later.",
    ].join("\n");
    expect(report("apps/api/src/a.ts", text)).toEqual({
      ok: true,
      lines: ["1 files' comments carry no id, date or line number"],
    });
  });

  it("passes clock times, ratios, object literals and Balatro-source citations", () => {
    const text = [
      '// Elapsed 65s reads "+01:05"; reads reset at 00:00 UTC.',
      "// The 8:11 scans, about 5:1 contrast, ({x:0.5, y:0.2}); one line per row.",
      "-- Balatro Card:start_dissolve (card.lua:2130), at line 2130 of Balatro's card.lua.",
    ];
    expect(report("a.ts", text.slice(0, 2).join("\n")).ok).toBe(true);
    expect(report("frontend/lua/ui/a.lua", text[2] ?? "").ok).toBe(true);
    expect(hits("frontend/lua/ui/a.lua", "-- Card:start_dissolve (card.lua:2130)")).toEqual([
      "frontend/lua/ui/a.lua:1: (line number) -- Card:start_dissolve (card.lua:2130)",
    ]);
  });

  it("still fails an id on a line that cites Balatro", () => {
    expect(hits("a.lua", "-- Balatro's card.lua:2130 (D190)")).toEqual([
      "a.lua:1: (decision number) -- Balatro's card.lua:2130 (D190)",
    ]);
  });

  it("reads comments only: strings, templates, regexes and test titles are data", () => {
    const text = [
      'it("D570 §6 — the second declaration re-reads the licence", () => {});',
      "const id = 'DOC-P0-guard-no-span-join';",
      // A template literal with an object in one substitution and a template in the next.
      "const t = `a $" + "{ { k: 1 }.k } // D123 $" + "{`inner // OBS-P1`} tail // AU3`;",
      "const r = /a\\/*D123 */;",
      "const q = /'/.test(x) ? 1 : 2; // ok",
      'const at = "effects.ts:5438 (:171) line 214";',
    ].join("\n");
    expect(report("scripts/a.test.ts", text).ok).toBe(true);
  });

  it("names the line of each hit inside a block comment", () => {
    const text = "/**\n * The program.\n * Off the local D1 (2026-10-08).\n */\nconst a = 1;\n";
    expect(hits("a.ts", text)).toEqual(["a.ts:3: (date) * Off the local D1 (2026-10-08)."]);
  });

  it("reads a division as a division, so the comment after it is still read", () => {
    expect(hits("a.ts", "const half = total / 2; // (AU3)\n")).toEqual([
      "a.ts:1: (audit finding) // (AU3)",
    ]);
    expect(scriptComments("x = a\n/ b / c; // D12")).toEqual([{ line: 2, text: "// D12" }]);
  });

  it("reads Lua comments and skips Lua strings", () => {
    const text = [
      "local a = '-- D123' .. \"-- AU3\" -- the reason (audit PG14)",
      "local b = [[ -- OBS-P1 ]] .. [==[ ]] -- D45 ]==]",
      "--[[ A long comment",
      "   that names M5. ]]",
      "--[==[ level two ]] still (B04) ]==]",
    ].join("\n");
    expect(hits("frontend/lua/ui/a.lua", text)).toEqual([
      "frontend/lua/ui/a.lua:1: (audit finding) -- the reason (audit PG14)",
      "frontend/lua/ui/a.lua:4: (milestone) that names M5. ]]",
      "frontend/lua/ui/a.lua:5: (card revision) --[==[ level two ]] still (B04) ]==]",
    ]);
    expect(luaComments("x = 1 -- one\ny = 2")).toEqual([{ line: 1, text: "-- one" }]);
  });

  it("reads YAML comments: a # that starts the line or follows a space, outside quotes", () => {
    const text = [
      "# Never blocking (decision 1b).",
      "on: push # the job (dependency audit PRC1)",
      'key: "a # D123"',
      "url: a#D123",
      "run: echo '# OBS-P1'",
    ].join("\n");
    expect(hits(".github/workflows/ci.yml", text)).toEqual([
      ".github/workflows/ci.yml:1: (decision number) # Never blocking (decision 1b).",
      ".github/workflows/ci.yml:2: (audit finding) # the job (dependency audit PRC1)",
    ]);
    expect(hashComments("a: 1 # x")).toEqual([{ line: 1, text: "# x" }]);
  });

  it("picks the reader by extension", () => {
    const text = "-- a\n# b\n// c\n";
    expect(commentsOf("a.lua", text).map((c) => c.text)).toEqual(["-- a"]);
    expect(commentsOf("a.yml", text).map((c) => c.text)).toEqual(["# b"]);
    expect(commentsOf("a.mjs", text).map((c) => c.text)).toEqual(["// c"]);
  });

  it("says how to fix a failure", () => {
    const result = report("a.ts", "// (D203)\n");
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe(
      "comment-guard: FAIL — 1 comment line(s) carry an id, a date or a line number:",
    );
    expect(result.lines.at(-2)).toContain("Keep the reason and drop the id");
  });
});
