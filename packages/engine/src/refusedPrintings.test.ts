import { describe, expect, it } from "vitest";
import { programFor } from "./registry";
import {
  excerptNamesId,
  REFUSED_PRINTINGS,
  RESOLVED_REFUSALS,
  type RefusedPrinting,
} from "./refusedPrintings";

// D480 — THE BUILD-STATE GUARD, AND THE FALSIFICATION THAT BOUGHT IT.
//
// 🛑 WHAT THIS SLICE FOUND, STATED FIRST. D480's work order asked for "two
// hand-authored `registry.ts` rows and nothing else" — Unfair Stamp `sv06-165` and
// Team Rocket's Archer `sv10-170`/`-223`. **Both had already shipped**, at D271 and
// D326, 208 and 153 decisions before the work order was written. The price was not
// wrong in its expensive clause (the failure mode six of the last eight slices hit);
// it was wrong in its CHEAP clause, and the true price was ZERO.
//
// The chain that carried the false claim is worth naming, because every link in it
// was written by a slice that was being careful:
//
//   • **D270** refused the two cards for a play gate *"no `BoardCondition` spells and
//     `GameState` carries no datum for"*. TRUE when written.
//   • **D271** built the datum, the condition member AND Unfair Stamp — and left
//     D270's paragraph standing in two files. It corrected the copy in
//     `censusAtHead.test.ts` (*"the union held 23 members at D270, not five"*) and
//     not the copies in `registry.ts` and `effects.ts`.
//   • **D326** built Team Rocket's Archer, and left the same two paragraphs standing.
//   • **D479** ran a refusal audit, opened `BoardCondition`, `GameState` and
//     `playableIf`, correctly falsified the EXPRESSIBILITY clause — and then wrote
//     *"the two cards … are still unbuilt … for want of a registry row"*, which it
//     took from the paragraph it was falsifying rather than from the id table.
//   • **D480** was commissioned to build them.
//
// ⚠️ **THE GENERAL SHAPE: A REFUSAL CARRIES TWO CLAIMS AND THEY HAVE DIFFERENT
// ORACLES.** *"This cannot be expressed"* is settled by opening a declaration, and
// D479's method is exactly right about it. *"This is not built"* is settled by
// `programFor`, and nothing in this repo was checking it. Three prose rules had been
// written about it — D321's `git grep <id>`, D330's *"check whether the piece has
// shipped before pricing it"*, D343's *"D330's lesson at its second site"* — and the
// fourth occurrence still happened.
//
// 🛑 SO WHAT GOES RED HERE, and every case is an edit somebody will really make
// (D200 → D214: a check whose author cannot name the edit that breaks it is vacuous):
//
//   (1) build a printing listed in `REFUSED_PRINTINGS` and leave its row → §2 fails
//       BY ID, and the row hands you the doc block to correct;
//   (2) delete a `RESOLVED_REFUSALS` correction stamp, or revert the doc block to the
//       state in which the refusal stood alone → §3's citation case fails BY ID;
//   (3) un-build one of D271's/D326's rows → §3's build case fails BY ID;
//   (4) empty either table to make the other pass → §5's non-vacuity cases fail;
//   (5) mistype an id, or move a cited doc block without moving its claim → §4 fails,
//       naming the file and the excerpt that no longer occurs exactly once;
//   (6) weaken `excerptNamesId` to a constant → §4's negative control fails.

/** The nine non-changelog engine modules, as text — the files a `cite` may name.
    A GLOB rather than `node:fs` for `progressLog.test.ts`'s reason, restated: this
    package has no `"types": ["node"]` in its tsconfig (it runs in a Worker and in
    the browser), and widening that to read one file would put Node globals in scope
    for the whole engine. Vite resolves the pattern relative to THIS file.

    ⚠️ **`index.ts` IS NOT IN THE PATTERN, AND THAT IS THE POINT OF THE PATTERN.** It
    is the engine's version changelog; a `0.249.0` block describing a 0.249.0 head is
    history, not a live claim, and a guard that reddened on it would be reporting its
    own scope error. The module's doc block records the measurement: nine modules give
    27 build-state windows, adding `index.ts` gives 44, and all 17 of the extra are
    historical. */
const SOURCES: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./{attack,cardplay,continuous,effects,flow,interpreter,redact,registry,types}.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** `packages/engine/src/effects.ts` → the globbed text. Repo-relative in the table
    (so a row reads the way a `mutants.ts` row does) and file-relative in the glob. */
function source(repoPath: string): string {
  const prefix = "packages/engine/src/";
  expect(repoPath.startsWith(prefix), `${repoPath} is outside the scanned module set`).toBe(true);
  const text = SOURCES[`./${repoPath.slice(prefix.length)}`];
  if (text === undefined) {
    throw new Error(
      `${repoPath} is not one of the scanned modules — keys: ${Object.keys(SOURCES).sort().join(", ")}`,
    );
  }
  return text;
}

/** True at every line index that is inside a comment — block or line. Written out
    because the repo's doc-block style has NO leading `*` on continuation lines
    (`registry.ts`'s `const UNFAIR_STAMP` block is four spaces and prose), so the
    cheap "does the line start with `//` or `*`" test answers FALSE on most of this
    file's own citations. That cheap test is exactly what D480's first draft used,
    and it passed the two line-comment citations while refusing the seven that live
    in doc blocks.

    ⚠️ AND THE SECOND DRAFT BROKE THE FILE BY QUOTING A BLOCK-COMMENT TERMINATOR IN
    THIS VERY PARAGRAPH, which is worth leaving as a note: the terminator ends the
    comment wherever it appears, so prose ABOUT comment syntax cannot spell it. The
    mask below has to handle exactly that on the files it reads. */
function commentMask(lines: readonly string[]): readonly boolean[] {
  const mask: boolean[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (inBlock) {
      mask.push(true);
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    const open = line.indexOf("/*");
    const lineComment = line.indexOf("//");
    if (open !== -1 && (lineComment === -1 || open < lineComment)) {
      mask.push(true);
      if (line.indexOf("*/", open + 2) === -1) inBlock = true;
      continue;
    }
    mask.push(lineComment !== -1);
  }
  return mask;
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

const ALL_CITED: readonly { readonly file: string; readonly excerpt: string; readonly id: string }[] =
  [
    ...REFUSED_PRINTINGS.map((r) => ({ file: r.cite.file, excerpt: r.cite.excerpt, id: r.id })),
    ...RESOLVED_REFUSALS.map((r) => ({ file: r.cite.file, excerpt: r.cite.excerpt, id: r.id })),
  ];

// ── 1. The finding, DRIVEN rather than asserted in prose ─────────────────────

describe("D480 — the three printings the work order priced as unbuilt", () => {
  it("🛑 all three SHIP, and the price of D479's row was ZERO registry rows", () => {
    // The whole of D480's original work order, read off the registry rather than
    // off a doc block. This is the assertion the work order itself needed.
    expect(programFor("sv06-165")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
    });
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    // The alternate art is the SAME program object, as a reprint must be.
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("the two cards are kept APART by the one number that separates them", () => {
    // Not a restatement of the case above: it is the rung that would have caught a
    // build which reused Unfair Stamp's program for Archer's id. The controller's
    // hand is 5 either way, so only the OPPONENT's count tells them apart, and the
    // gates differ only by the `owner` prefix.
    const stamp = programFor("sv06-165");
    const archer = programFor("sv10-170");
    expect(stamp).not.toEqual(archer);
    expect(stamp?.trainerPlayableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
    expect(archer?.trainerPlayableIf).toEqual({
      kind: "yourPokemonKoedOnOpponentsLastTurn",
      owner: "Team Rocket",
    });
  });

  it("the fixture demonstrators ship too — three of them, not two", () => {
    // `fix-unfairstamp` (D271), then `fix-stamp` and `fix-archer` (D326, on ONE
    // board so a swap cannot hide). A work order claiming these cards need
    // authoring is claiming these five ids do not resolve.
    for (const id of ["fix-unfairstamp", "fix-stamp", "fix-archer"]) {
      expect(programFor(id), id).toBeDefined();
    }
  });
});

// ── 2. THE GUARD, forward — every refused printing is still refused ──────────

describe("REFUSED_PRINTINGS — the build-state claim, as a command", () => {
  it("🛑 no declared-refused printing has a registry program", () => {
    // (1) in the header. The day one of these is built, THIS is the line that
    // reddens, and it names the id — which is the whole difference between this
    // and the three prose rules that preceded it.
    const built = REFUSED_PRINTINGS.filter((r) => programFor(r.id) !== undefined);
    expect(
      built.map((r) => `${r.id} (${r.card}, ${r.surface}) — refused by ${r.since}`),
      "these printings are BUILT and their refusals are stale: correct the cited doc block, then delete the row",
    ).toEqual([]);
  });

  it("every row names a surface `programFor` is an oracle for — never an attack", () => {
    // D204's per-surface rule, kept live: *"All four N's Zoroark ex printings ALREADY
    // carry a program (their 'Trade' Ability); it is the ATTACK that is unbuilt. A
    // whole-id flag reads that card as built."* The type already excludes `"attack"`;
    // this is the rung that fails if somebody widens the union to admit it.
    const surfaces: readonly RefusedPrinting["surface"][] = [
      "trainer",
      "tool",
      "ability",
      "passive",
      "specialEnergy",
    ];
    for (const row of REFUSED_PRINTINGS) {
      expect(surfaces, `${row.id} names a surface programFor cannot answer for`).toContain(
        row.surface,
      );
    }
  });
});

// ── 3. THE GUARD, reverse — the falsified refusals stay falsified ────────────

describe("RESOLVED_REFUSALS — the correction, as a command", () => {
  it("🛑 every printing D480 found already built is STILL built", () => {
    const missing = RESOLVED_REFUSALS.filter((r) => programFor(r.id) === undefined);
    expect(
      missing.map((r) => `${r.id} (${r.card}) — built by ${r.builtBy}`),
      "a printing D480 recorded as built has lost its registry program",
    ).toEqual([]);
  });

  it("🛑 every dated correction is still in the file it corrects", () => {
    // (2) in the header, and it is the half a `git revert` of the doc-block edit
    // would otherwise take silently: the refusal would stand alone again, green.
    for (const row of RESOLVED_REFUSALS) {
      expect(
        occurrences(source(row.cite.file), row.cite.excerpt),
        `${row.id}: the D480 correction stamp is gone from ${row.cite.file}`,
      ).toBe(1);
    }
  });

  it("names both the decision that BUILT it and the decision that REFUSED it", () => {
    // D479's own distinction: a refusal that was false when written, one that
    // rotted, and one whose reason alone changed are three different findings, and
    // only a row carrying both ends can say which it is.
    for (const row of RESOLVED_REFUSALS) {
      expect(row.builtBy, row.id).toMatch(/^D\d+$/);
      expect(row.refusedBy, row.id).toContain("D");
      expect(row.refusedBy, row.id).not.toBe(row.builtBy);
    }
  });
});

// ── 4. The citations are REAL — the anti-fiction rung ────────────────────────

describe("the citations", () => {
  it("every cited excerpt occurs EXACTLY ONCE in the module it names", () => {
    // (5) in the header. A line number rots silently, a unique string rots loudly —
    // `mutants.ts`'s rule, and the reason `cite` is prose and not a location. Zero
    // means the doc block moved without its claim; two or more means the excerpt is
    // not a fact about one site.
    for (const cited of ALL_CITED) {
      expect(
        occurrences(source(cited.file), cited.excerpt),
        `${cited.id}: ${cited.file} contains this excerpt an unexpected number of times`,
      ).toBe(1);
    }
  });

  it("every cited excerpt is inside a COMMENT, not code", () => {
    // A claim about the build state belongs in a doc block. An excerpt that has
    // drifted onto a line of code is quoting something that was never the claim.
    for (const cited of ALL_CITED) {
      const lines = source(cited.file).split("\n");
      const at = lines.findIndex((line) => line.includes(cited.excerpt));
      expect(at, `${cited.id}: the excerpt is not on any single line of ${cited.file}`).toBeGreaterThan(-1);
      expect(
        commentMask(lines)[at],
        `${cited.id}: ${cited.file}:${at + 1} is CODE, not a doc block — the claim is not where the row says it is`,
      ).toBe(true);
    }
  });

  it("…and the comment mask is not vacuous — it refuses a line of real code", () => {
    // Without this the case above passes on a mask that returns `true` for
    // everything, which is the same defect one measurement earlier. `registry.ts`'s
    // `const UNFAIR_STAMP` declaration is the code line D480 is about, and its own
    // doc block is the comment line directly above it.
    const lines = source("packages/engine/src/registry.ts").split("\n");
    const mask = commentMask(lines);
    const decl = lines.findIndex((line) => line.startsWith("const UNFAIR_STAMP: CardProgram = {"));
    expect(decl, "the declaration D480 is about has moved").toBeGreaterThan(-1);
    expect(mask[decl], "a declaration read as a comment").toBe(false);
    expect(mask.filter(Boolean).length).toBeGreaterThan(0);
    expect(mask.filter((m) => !m).length).toBeGreaterThan(0);
  });

  it("🛑 every REFUSED row's excerpt actually names its id — whole or as a suffix", () => {
    // Limit 2 in the module's header, and D204's vacuous guard: *"SIX OF TEN FLAGGED
    // ROWS CARRY IDS BELONGING TO OTHER CARDS … Every COUNT was right, which is why
    // nothing caught it."* This engine has no catalog to check an id against, so what
    // it checks instead is that the id and the prose agree — a transposed id cannot be
    // typed here without also being typed into the doc block it claims to quote.
    for (const row of REFUSED_PRINTINGS) {
      expect(
        excerptNamesId(row.cite.excerpt, row.id),
        `${row.id} is not named by the excerpt it cites in ${row.cite.file}`,
      ).toBe(true);
    }
  });

  it("…and the predicate REFUSES an id the excerpt does not name", () => {
    // (6) in the header — the negative control, without which the case above passes
    // on `return true`. `sv99-999` shares neither set nor number with anything cited.
    for (const row of REFUSED_PRINTINGS) {
      expect(excerptNamesId(row.cite.excerpt, "sv99-999"), row.id).toBe(false);
    }
    // And the SUFFIX half is load-bearing rather than decorative: THREE of the nine
    // rows are cited by prose that never spells the id whole, so a build that reduced
    // this to `excerpt.includes(id)` would fail them. Driven, not claimed — and the
    // number is MEASURED here rather than asserted in the module's prose, because a
    // count nothing recomputes is the defect this whole file exists about.
    const suffixOnly = REFUSED_PRINTINGS.filter((r) => !r.cite.excerpt.includes(r.id));
    expect(suffixOnly.map((r) => r.id)).toEqual(["sv07-163", "sv07-171", "sv10.5w-107"]);
    // …and each of those IS matched by the split reading.
    for (const row of suffixOnly) expect(excerptNamesId(row.cite.excerpt, row.id), row.id).toBe(true);
  });

  it("the split reading does not admit a NEIGHBOURING printing of the same set", () => {
    // The risk the suffix rule buys: `sv07-132/-163/-171` names three printings, and
    // a fourth id in the same set must NOT match off the set alone. `-199` is not in
    // the excerpt, so the number half refuses it.
    const briar = REFUSED_PRINTINGS.find((r) => r.id === "sv07-163");
    expect(briar).toBeDefined();
    if (briar === undefined) throw new Error("unreachable");
    expect(excerptNamesId(briar.cite.excerpt, "sv07-199")).toBe(false);
    // …while the three that ARE printed there all match, so the refusal is not
    // accidentally narrow either. Both directions, this repo's standing rule.
    for (const id of ["sv07-132", "sv07-163", "sv07-171"]) {
      expect(excerptNamesId(briar.cite.excerpt, id), id).toBe(true);
    }
  });
});

// ── 5. Non-vacuity and the attribution controls ──────────────────────────────

describe("the guard cannot pass by being empty or by being unwired", () => {
  it("both tables are non-empty and their ids are unique", () => {
    // (4) in the header. §2 is trivially green on an empty table and §3 is trivially
    // green on an empty one; the two guard each other only if neither can be emptied
    // without a red line.
    expect(REFUSED_PRINTINGS.length).toBeGreaterThanOrEqual(9);
    expect(RESOLVED_REFUSALS.length).toBe(3);
    const refusedIds = REFUSED_PRINTINGS.map((r) => r.id);
    const resolvedIds = RESOLVED_REFUSALS.map((r) => r.id);
    expect(new Set(refusedIds).size).toBe(refusedIds.length);
    expect(new Set(resolvedIds).size).toBe(resolvedIds.length);
    // And the two tables are DISJOINT — a printing cannot be refused and resolved.
    expect(refusedIds.filter((id) => resolvedIds.includes(id))).toEqual([]);
  });

  it("🛑 the oracle is wired — it returns BOTH answers over this file's own ids", () => {
    // The D214 shape, and the one that matters most here: §2 would be green on a
    // broken `programFor` import that returned `undefined` for everything, and it
    // would be green for exactly the wrong reason. So the same call is driven to a
    // DEFINED answer on the same run, on the ids this slice is about.
    expect(programFor("sv06-165")).toBeDefined();
    expect(programFor("sv06-164")).toBeUndefined();
    // Sharper still: the two are neighbouring printings in the SAME set, one built
    // and one refused, so a `programFor` keyed on anything coarser than the id fails
    // here rather than passing quietly.
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv06-164")).toBe(true);
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv06-165")).toBe(false);
  });

  it("the refused set really is drawn from live doc blocks, not invented", () => {
    // Every cited file is one of the nine scanned modules, and between them the rows
    // cite more than one module — a table sourced from a single doc block would be a
    // claim about that block rather than about the repo.
    const files = new Set(ALL_CITED.map((c) => c.file));
    expect(files.size).toBeGreaterThanOrEqual(2);
    for (const file of files) expect(source(file).length).toBeGreaterThan(0);
    expect(Object.keys(SOURCES).length, "the scanned module set changed size").toBe(9);
  });

  it("every row carries a reason and a decision, so the list is a record and not an allowlist", () => {
    // D471: a class defined NEGATIVELY describes the instrument. A bare id list would
    // be a suppression file; a row that must state WHY and SINCE is a finding.
    for (const row of REFUSED_PRINTINGS) {
      expect(row.why.length, row.id).toBeGreaterThan(80);
      expect(row.since, row.id).toMatch(/^D\d+$/);
      expect(row.card.length, row.id).toBeGreaterThan(0);
    }
  });
});
