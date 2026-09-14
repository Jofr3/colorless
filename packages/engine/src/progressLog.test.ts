import { describe, expect, it } from "vitest";

// D318 — THE PROSE GUARD. `docs/progress.md` IS THE MOST-TRUSTED TEXT IN THIS
// REPO AND ALMOST NONE OF IT IS EXECUTABLE.
//
// Three separate failures inside two slices, all one mechanism:
//
//   • D316's docs commit is titled "the header stamp, the status row, session
//     #256 and a REWRITTEN resume point" and added ZERO `###` headings. The page
//     went straight from #255 to #257, the commit message asserted otherwise, and
//     NOTHING WENT RED. D317 reconstructed the entry from D316's header stamp and
//     its four commit messages — a repair, not a guard.
//   • The gap scan D317 then ran by hand found TWO MORE: #219 and #220, missing
//     since 2026-08-08 and unnoticed for 38 sessions.
//   • D317's own docs commit range-deleted **2,014 lines** — the 38
//     `### Prior resume point (… kept for continuity)` archives — because a
//     scratchpad script sliced from `## NEXT (resume point)` to
//     `\n## Status by workstream` and replaced the lot. `bun run check` WAS GREEN
//     WITH THEM GONE AND GREEN WITH THEM BACK. It was caught by reading `git
//     commit`'s own insertion/deletion line, which is not a guard either.
//
// 🛑 SO WHAT GOES RED HERE, STATED FIRST (D200 → D214's rule — a check whose
// author cannot name the edit that breaks it is vacuous):
//
//   (1) bump the header stamp and forget the log entry → the equality fails;
//   (2) append an entry and forget the header stamp → the same equality fails;
//   (3) skip a session number → the GAP SCAN fails BY NAME, and the only way to
//       satisfy it is to write the entry or to DECLARE the hole in the page's own
//       prose with a reason and a pointer at `decisions.md`;
//   (4) declare a hole that is no longer a hole → the same assertion fails from
//       the other side (total in both directions, this repo's standing rule);
//   (5) bump the header stamp and forget the status row → the slice-id case fails;
//   (6) range-replace the resume point and take the archives with it → the
//       ARCHIVE case fails, naming the count it expected.
//
// ⚠️ AND THE ONE THING THIS FILE DELIBERATELY DOES NOT DO: it does not check that
// an entry is TRUE, only that it EXISTS, is numbered consistently and sits where
// the header says it does. A fabricated entry passes. That is the honest limit of
// a structural guard over prose, and naming it is what stops the next reader
// treating a green run as "the page is right".

/** The docs the guard reads, as text. A GLOB rather than `node:fs` for
    `catalogManifest.test.ts`'s reason, restated: this package has no `"types":
    ["node"]` in its tsconfig (it runs in a Worker and in the browser), and
    widening that to read one file would put Node globals in scope for the whole
    engine. Vite resolves the pattern relative to THIS file, so `../../../docs`
    is the repo's `docs/`. */
const DOCS: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("../../../docs/*.md", { query: "?raw", import: "default", eager: true });

function doc(name: string): string {
  const text = DOCS[`../../../docs/${name}`];
  if (text === undefined) {
    throw new Error(`docs/${name} is not readable from the glob — keys: ${Object.keys(DOCS).join(", ")}`);
  }
  return text;
}

const PROGRESS = doc("progress.md");
const DECISIONS = doc("decisions.md");

/** `**Last updated:** 2026-08-10 — build session #257 (**P3-M5 — D317, …` — the
    stamp at the top of the page, and the ONLY one: every superseded stamp below
    it is spelled `**Last updated (was):**`, which this pattern does not match. */
const HEADER_STAMP = /^\*\*Last updated:\*\* (\d{4}-\d{2}-\d{2}) — build session #(\d+) \(/m;

/** `### 2026-08-10 — build session #257 (P3-M5 — D317, …)` — a session-log
    heading. Transcribed off the page rather than inferred: the em dash is U+2014,
    the date is ISO, and the parenthetical always opens with the workstream. */
const LOG_HEADING = /^### (\d{4}-\d{2}-\d{2}) — build session #(\d+) \((.*)$/gm;

/** `### Prior resume point (P5-3 — deck cover art, kept for continuity)` — the
    archived resume points D317's range-replace deleted. */
const ARCHIVE_HEADING = /^### Prior resume point \(/gm;

/** The page's own declaration of a hole in its numbering, written at #221:
    *"⚠️ **THE LOG BELOW SKIPS #219 AND #220.** … Recorded rather than
    back-filled, because a missing entry that nobody notices is how a log stops
    being one."* — the exemption lives in the PROSE, not in this file. */
const GAP_DECLARATION = /\*\*THE LOG BELOW SKIPS ([^*]+?)\.\*\*/;

interface Entry {
  date: string;
  n: number;
  rest: string;
}

const entries: Entry[] = [...PROGRESS.matchAll(LOG_HEADING)].map((m) => ({
  date: m[1] ?? "",
  n: Number(m[2]),
  rest: m[3] ?? "",
}));

/** The slice id a heading names — `D317` out of `(P3-M5 — D317, …)`. Two
    headings on the page name a PAIR (`D294 + D295`), so the FIRST is taken and
    the case below says so. */
function sliceIdOf(rest: string): string | null {
  return /\bD(\d{2,4})\b/.exec(rest)?.[0] ?? null;
}

describe("docs/progress.md — the header stamp and the session log agree (D318)", () => {
  it("reads a real page, not an empty string the assertions below would all pass on", () => {
    // Anti-vacuity, first and explicitly: every case in this file is satisfied by
    // an empty document, which is exactly the shape a range-replace leaves behind.
    expect(PROGRESS.length).toBeGreaterThan(100_000);
    expect(PROGRESS.split("\n").length).toBeGreaterThan(10_000);
    expect(entries.length).toBeGreaterThan(30);
    expect(DECISIONS.length).toBeGreaterThan(10_000);
  });

  it("(1)+(2) the header stamp and the NEWEST log entry name the same session, on the same date", () => {
    const stamp = HEADER_STAMP.exec(PROGRESS);
    expect(stamp, "no `**Last updated:** … build session #N (` line at the top of the page").not.toBeNull();
    // ⚠️ MEASURED, NOT ASSUMED: `**Last updated:**` occurs FOUR times on this page.
    // Three stamps (#195, #196, #200) were never converted to the `**Last updated
    // (was):**` spelling when they were superseded, so the LIVE one is the first
    // occurrence and nothing but its position says so. Pinned to the page's first
    // ten lines, which is where the ritual writes it.
    const stampLine = PROGRESS.slice(0, stamp?.index ?? 0).split("\n").length;
    expect(stampLine, "the live header stamp has drifted out of the page's opening block").toBeLessThan(11);
    const newest = entries[0];
    expect(newest, "no `### … build session #N (` heading in the page at all").toBeDefined();
    expect(
      Number(stamp?.[2]),
      `the header stamp says build session #${stamp?.[2]} and the newest log entry says #${newest?.n} — one of the two was not written`,
    ).toBe(newest?.n);
    expect(
      stamp?.[1],
      `the header stamp is dated ${stamp?.[1]} and entry #${newest?.n} is dated ${newest?.date}`,
    ).toBe(newest?.date);
  });

  it("(3) the log is strictly DESCENDING with no duplicates — the order the page is written in", () => {
    // Separate from the gap scan on purpose. A REPEATED number and a number out of
    // order are different defects from a missing one, and folding all three into
    // one assertion would report the wrong thing for two of them.
    const numbers = entries.map((e) => e.n);
    expect([...new Set(numbers)].length, `duplicate session numbers: ${numbers.join(", ")}`).toBe(
      numbers.length,
    );
    expect(numbers, "the session log is not in descending order").toEqual(
      [...numbers].sort((a, b) => b - a),
    );
  });

  it("(3)+(4) every GAP in the numbering is DECLARED IN THE PAGE'S OWN PROSE, and every declaration is a real gap", () => {
    // 🛑 THE CLAUSE THAT WOULD HAVE FAILED AT D316 BY NAME, and the one that finds
    // #219/#220 today. An equality between the header and the newest entry (above)
    // catches the session that forgets to write its own entry and says NOTHING
    // about a hole three sessions back.
    //
    // ⚠️ AND THE EXEMPTION IS NOT AN ALLOWLIST IN THIS FILE. `#219`/`#220` are
    // admitted because the PAGE declares them, in the note attached to entry #221
    // — which means the test cannot be satisfied by editing the test. Deleting the
    // declaration from the page fails here; backfilling the entries WITHOUT
    // deleting the declaration fails here too.
    const numbers = entries.map((e) => e.n);
    const newest = numbers[0] ?? 0;
    const oldest = numbers[numbers.length - 1] ?? 0;
    const present = new Set(numbers);
    const missing: number[] = [];
    for (let n = oldest; n <= newest; n++) if (!present.has(n)) missing.push(n);

    const declaration = GAP_DECLARATION.exec(PROGRESS);
    expect(
      declaration,
      `the log skips ${JSON.stringify(missing)} and the page declares nothing — write the entries, or write the declaration`,
    ).not.toBeNull();
    const declared = [...(declaration?.[1] ?? "").matchAll(/#(\d+)/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);

    expect(
      missing,
      `the log's holes are ${JSON.stringify(missing)} and the page declares ${JSON.stringify(declared)}`,
    ).toEqual(declared);
    // The declaration is not a bare suppression: it carries the REASON and it
    // points at where the record actually lives (conventions.md's rule for a
    // declared mutant survivor, applied to prose).
    const paragraph = PROGRESS.slice(
      declaration?.index ?? 0,
      (declaration?.index ?? 0) + 600,
    );
    // ⚠️ WHITESPACE-NORMALISED, AND THE REASON IS THE FIRST THING THIS GUARD
    // TAUGHT ITS OWN AUTHOR: the page is HARD-WRAPPED at ~80 columns, so the
    // sentence being looked for is spelled `Recorded rather than\nback-filled`
    // and a naive `toContain` fails on a page that says exactly the right thing.
    // Every prose assertion below the heading level runs over the flattened text.
    const flat = paragraph.replace(/\s+/g, " ");
    expect(flat, "the gap declaration must say WHY it was not back-filled").toContain(
      "Recorded rather than back-filled",
    );
    // …and every slice it names must actually have its record in `decisions.md`,
    // which is the sentence the declaration makes. A pointer nobody follows is the
    // defect this whole file exists against.
    const named = [...paragraph.matchAll(/\*\*(D\d{2,4})\*\*/g)].map((m) => m[1] ?? "");
    expect(named.length, "the declaration names no slice whose record could be checked").toBeGreaterThan(0);
    for (const id of named) {
      expect(DECISIONS, `the gap declaration points at ${id} and decisions.md has no such row`).toContain(
        `| **${id}** |`,
      );
    }
    // …and the declaration sits INSIDE the log it is about, not in the resume
    // point where it would be rewritten away every session.
    const logStart = PROGRESS.indexOf("\n## Session log");
    expect(logStart).toBeGreaterThan(0);
    expect(
      declaration?.index ?? 0,
      "the gap declaration must live in the session log, not above it",
    ).toBeGreaterThan(logStart);
  });

  it("(5) the live `simulator` status row names the same slice as the newest entry", () => {
    // D287 shipped without moving this row and it named D286 for two slices; D284
    // did the same one row up. The page RECORDS both episodes in strikethrough
    // and neither was caught by anything.
    const newest = entries[0];
    const slice = sliceIdOf(newest?.rest ?? "");
    expect(slice, `entry #${newest?.n} names no D-number: ${newest?.rest}`).not.toBeNull();
    const row = /^\| simulator \| P3 \|.*$/m.exec(PROGRESS);
    expect(row, "no live `| simulator | P3 |` row in the status table").not.toBeNull();
    expect(
      row?.[0],
      `the status table's live simulator row does not name ${slice} — the newest session-log entry is #${newest?.n} (${slice})`,
    ).toContain(`${slice}`);
    // …and the header stamp names it too, which is the third site the ritual
    // touches and the one D316 got right while missing the entry.
    const stampLine = /^\*\*Last updated:\*\* .*$/m.exec(PROGRESS)?.[0] ?? "";
    expect(stampLine, `the header stamp does not name ${slice}`).toContain(`${slice}`);
  });

  it("names a slice id for EVERY entry — the sweep read a real population", () => {
    // Anti-vacuity for the case above: if headings stopped carrying a D-number,
    // `sliceIdOf` would return null for the newest one and that case would fail —
    // but only for the newest one. This says the format holds for all of them.
    const unnamed = entries.filter((e) => sliceIdOf(e.rest) === null).map((e) => e.n);
    expect(unnamed, "session-log headings that name no D-number").toEqual([]);
  });
});

describe("docs/progress.md — the archived resume points are still there (D318)", () => {
  // 🛑 D317's THIRD FAILURE, AND THE ONE NOTHING COULD SEE. A scratchpad script
  // replaced the span from `## NEXT (resume point)` to `\n## Status by workstream`
  // — which is NOT the resume point: it also holds every archived one. The commit
  // went out at "547 insertions, 2336 deletions" and `check` was green on both
  // sides of it.
  //
  // ⚠️ EXACT AND NOT A FLOOR, for `OMISSION_BUDGET`'s stated reason: a ratchet
  // that is never re-tightened re-opens. Archiving a 39th resume point is a
  // deliberate act and must be a two-site edit a reviewer sees; deleting one is
  // the failure this exists for.
  // 🆕🆕 D369 — **38 → 39, AND THIS IS THE "SAY SO AND RAISE THE NUMBER" BRANCH OF
  // THE MESSAGE BELOW, EXERCISED FOR THE FIRST TIME.** D369 demoted D368's live
  // resume point under `### Prior resume point (P3-M5 — D368, …)` rather than
  // overwriting it, which is what `docs/README.md`'s resume protocol asks for and
  // what the sixty slices between D308 and D368 had quietly stopped doing — every
  // one of them replaced the live section in place, which is why this count sat at
  // 38 for so long. The guard fired on the very first slice to archive again, which
  // is the ratchet working in the UP direction rather than the DOWN one.
  // 🆕🆕 D370 — **39 → 40**, the SECOND consecutive slice to take the "say so and
  // raise the number" branch, and the first time it has been taken twice running.
  // D370 demoted D369's live resume point under `### Prior resume point (P3-M5 —
  // D369, …)` rather than overwriting it, which is what `docs/README.md`'s resume
  // protocol asks for. **THE RATCHET IS ONLY A RATCHET IF THE UP DIRECTION IS ALSO
  // A DELIBERATE TWO-SITE EDIT**, and this is the second slice to prove it is.
  // 🆕🆕 D371 — **40 → 41**, the THIRD consecutive slice to take the "say so and
  // raise the number" branch. D371 demoted D370's live resume point under
  // `### Prior resume point (P3-M5 — D370, …)` rather than overwriting it. Three in
  // a row is the point at which the UP direction stops being an event and becomes
  // the habit the protocol asks for — and the guard still costs a deliberate
  // two-site edit each time, which is exactly what keeps it a ratchet rather than a
  // number that drifts.
  // 🆕🆕 D372 — **41 → 42**, the FOURTH consecutive slice to take the "say so and
  // raise the number" branch. D372 demoted D371's live resume point under
  // `### Prior resume point (P3-M5 — D371, …)` rather than overwriting it.
  // ⚠️ AND THIS SLICE IS THE ONE THAT NEARLY DIDN'T: the archive heading was written
  // and the demoted BODY was not, because the rewrite replaced everything between
  // `## NEXT (resume point)` and the first `### Prior resume point (` — which is
  // exactly the range-replace shape this guard's DOWN direction exists for. The
  // count above did not catch it (the heading was there, so 42 was correct); the
  // LINE-COUNT floor below is what would have, and in the event the seam was spotted
  // by reading the file. **A COUNT OF HEADINGS IS NOT A COUNT OF ARCHIVES**, which is
  // why the span-size assertion sits underneath it and is not decoration.
  // 🆕🆕 D373 — 42 → **43**, RAISED DELIBERATELY, which is the UP branch of the message
  // below. D373 demoted D372's live resume point under `### Prior resume point (P3-M5 —
  // D372, …)` and the demoted BODY was carried across with it — the seam was re-read
  // after the edit and the D372 body confirmed present, which is the check D372's own
  // comment above asks for by name.
  // 🆕🆕 D374 — 43 → **44**, RAISED DELIBERATELY, which is the UP branch of the message
  // below. D374 demoted D373's live resume point under `### Prior resume point (P3-M5 —
  // D373, …)` and the demoted BODY was carried across with it — the range was captured
  // FIRST and re-emitted after the new section rather than overwritten, and the seam was
  // re-read after the edit with D373's body confirmed present, which is the check D372's
  // own comment above asks for by name.
  // 🆕🆕 D375 — 44 → **45**, RAISED DELIBERATELY, which is the UP branch of the message
  // below. D375 demoted D374's live resume point under `### Prior resume point (P3-M5 —
  // D374, …)` and the demoted BODY was carried across with it — the section was captured
  // FIRST and re-emitted after the new one rather than overwritten, and the seam was
  // re-read after the edit with D374's body confirmed present, which is the check D372's
  // own comment above asks for by name.
  // 🆕🆕 D376 — 45 → **46**, RAISED DELIBERATELY, the UP branch again. D376 demoted
  // D375's live resume point under `### Prior resume point (P3-M5 — D375, …)` and the
  // demoted BODY was carried across with it; the seam was re-read after the edit with
  // D375's body confirmed present.
  // 🛑 AND THIS RAISE WAS OWED BY D376's OWN DOCS COMMIT AND WAS NOT MADE THERE, WHICH
  // IS THE FIRST TIME THIS LOOP SHIPPED A RED `HEAD`. The slice reported `bun run check`
  // GREEN — 383 files / 7,950 tests — but this suite reddens only AFTER the docs commit
  // lands, and the second run that would have caught it was reported rather than made.
  // The whole-corpus sweep is what surfaced it: the 8 D318 rows anchored on this page
  // came back **ERROR — baseline is RED before mutating**, which is the harness refusing
  // to score a mutant whose control is already failing. A GREEN FIGURE THAT WAS NOT
  // MEASURED IS A CLAIM, AND THIS ONE WAS WRONG.
  // 🆕🆕 D377 — 46 → **47**, RAISED DELIBERATELY, the UP branch again, AND RAISED IN THE
  // SAME COMMIT THAT DEMOTED THE RESUME POINT — which is the half D376 left owed and paid
  // for with a red `HEAD`. D377 demoted D376's live resume point under `### Prior resume
  // point (P3-M5 — D376, …)` and the demoted BODY was carried across with it: the section
  // was captured FIRST and re-emitted after the new one rather than overwritten, and the
  // seam was re-read after the edit with D376's body confirmed present.
  // ✅ AND `bun run check` WAS RUN AGAIN AFTER THE DOCS COMMIT AND THE EXIT CODE READ, which
  // is the other half of the same discipline. This suite reddens ONLY after that commit
  // lands, so the pre-docs run cannot see it and a figure quoted from the pre-docs run is a
  // claim about a tree that no longer exists.
  // 🆕🆕 D378 — 47 → **48**, RAISED DELIBERATELY, which is the UP branch of the message
  // below. D378 demoted D377's live resume point under `### Prior resume point (P3-M5 —
  // D377, …)` and the demoted BODY was carried across with it — the range was captured
  // FIRST and re-emitted after the new section rather than overwritten, and the seam was
  // re-read after the edit with D377's body confirmed present (17,625 characters, its
  // opening line quoted back), which is the check D372's own comment above asks for by
  // name. ⚠️ AND THE RAISE IS IN THE SAME COMMIT AS THE DEMOTION, which is the half D376
  // forgot and paid for with a RED `HEAD` under a green claim.
  //
  // 🆕🆕 D379 — 48 -> 49, ARCHIVED DELIBERATELY AND SAID SO, exactly as the failure
  // message asks. D379 demoted D378's live resume point under `### Prior resume point
  // (P3-M5 — D378, …)`, carried the demoted BODY across with it (the range was captured
  // FIRST and re-emitted after the new section rather than overwritten), and re-read the
  // seam after the edit with D378's body confirmed present — its opening line quoted
  // back. **THE RAISE IS IN THE SAME COMMIT AS THE DEMOTION**, for the fourth slice
  // running.
  //
  // 🆕🆕 D380 — 49 -> 50, ARCHIVED DELIBERATELY AND SAID SO. D380 demoted D379's live
  // resume point under `### Prior resume point (P3-M5 — D379, …)` and carried the demoted
  // BODY across with it — the range was captured FIRST (225 lines) and re-emitted after
  // the new section rather than overwritten — then re-read the seam and confirmed BOTH
  // archive headings in order, D379's at the new boundary and D378's still beneath it with
  // its own body intact. **THE RAISE IS IN THE SAME COMMIT AS THE DEMOTION**, for the
  // FIFTH slice running.
  //
  // 🆕🆕 D381 — 50 -> 51, ARCHIVED DELIBERATELY AND SAID SO. D381 demoted D380's live
  // resume point under `### Prior resume point (P3-M5 — D380, …)` and carried the demoted
  // BODY across with it — the range was captured FIRST (216 lines) and re-emitted after
  // the new section rather than overwritten — then re-read the seam and confirmed BOTH
  // archive headings in order, D380's at the new boundary with its own opening line
  // quoted back and D379's still beneath it. **THE RAISE IS IN THE SAME COMMIT AS THE
  // DEMOTION**, for the SIXTH slice running.
  //
  // 🆕🆕 D382 — 51 -> 52, ARCHIVED DELIBERATELY AND SAID SO. D382 demoted D381's live
  // resume point under `### Prior resume point (P3-M5 — D381, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index, and re-emitted after
  // the new section rather than overwritten — then re-read the seam and confirmed BOTH
  // archive headings in order, D381's at the new boundary with its own opening line and
  // its own closing line quoted back, and D380's still beneath it. **THE RAISE IS IN THE
  // SAME COMMIT AS THE DEMOTION**, for the SEVENTH slice running.
  // 🆕🆕 D383 — 52 -> 53, ARCHIVED DELIBERATELY AND SAID SO. D383 demoted D382's live
  // resume point under `### Prior resume point (P3-M5 — D382, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index (the span from the
  // `## NEXT (resume point)` heading to D381's archive heading), and re-emitted after the
  // new section rather than overwritten — then re-read the seam and confirmed BOTH archive
  // headings in order, D382's at the new boundary with its own opening line quoted back and
  // D381's still beneath it. **THE RAISE IS IN THE SAME COMMIT AS THE DEMOTION**, for the
  // EIGHTH slice running.
  // 🆕🆕 D384 — 53 -> 54, ARCHIVED DELIBERATELY AND SAID SO. D384 demoted D383's live
  // resume point under `### Prior resume point (P3-M5 — D383, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index (the span from the
  // `## NEXT (resume point)` heading to D382's archive heading, 201 lines), and re-emitted
  // after the new section rather than overwritten — then re-read the seam and confirmed
  // BOTH archive headings in order, D383's at the new boundary with its own opening line
  // quoted back and D382's still beneath it. **THE RAISE IS IN THE SAME COMMIT AS THE
  // DEMOTION**, for the NINTH slice running.
  // 🆕🆕 D385 — 54 -> 55, ARCHIVED DELIBERATELY AND SAID SO. D385 demoted D384's live
  // resume point under `### Prior resume point (P3-M5 — D384, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index (the span from the
  // `## NEXT (resume point)` heading to D383's archive heading, 228 lines), and re-emitted
  // after the new section rather than overwritten — then re-read the seam and confirmed
  // BOTH archive headings in order, D384's at the new boundary with its own opening line
  // AND its own closing line quoted back, and D383's still beneath it. **THE RAISE IS IN
  // THE SAME COMMIT AS THE DEMOTION**, for the TENTH slice running.
  // 🆕🆕 D386 — 55 -> 56, ARCHIVED DELIBERATELY AND SAID SO. D386 demoted D385's live
  // resume point under `### Prior resume point (P3-M5 — D385, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index (the span from the
  // `## NEXT (resume point)` heading to D384's archive heading, 287 lines), and re-emitted
  // after the new section rather than overwritten — then re-read the seam and confirmed
  // BOTH archive headings in order, D385's at the new boundary with its own opening line
  // AND its own closing line quoted back, and D384's still beneath it. **THE RAISE IS IN
  // THE SAME COMMIT AS THE DEMOTION**, for the ELEVENTH slice running.
  // 🆕🆕 D387 — 56 -> 57, ARCHIVED DELIBERATELY AND SAID SO. D387 demoted D386's live
  // resume point under `### Prior resume point (P3-M5 — D386, …)` and carried the demoted
  // BODY across with it — the live body was captured FIRST, by index (the span from the
  // resume-point heading to D385's archive heading, 257 lines), and re-emitted after the
  // new section rather than overwritten — then re-read the seam and confirmed BOTH archive
  // headings in order, D386's at the new boundary with its own opening line AND its own
  // closing line quoted back, and D385's still beneath it. **THE RAISE IS IN THE SAME
  // COMMIT AS THE DEMOTION**, for the TWELFTH slice running.
  // 🆕🆕 D388 — 57 -> 58, ARCHIVED DELIBERATELY: this commit demotes D387's resume
  // point under its own `### Prior resume point (` heading, so the UP branch of the
  // message below is the one that applies. The demoted body was captured BY INDEX
  // before the rewrite (259 lines) and re-emitted whole, and the seam was re-read
  // afterwards with both headings present in order — D372's range-replace defect is
  // the thing this number exists to report, and it reports it only if the number is
  // raised in the SAME commit as the demotion (D376 shipped a red HEAD by omitting it).
  // 🆕🆕 D389 — 58 -> **59**, RAISED IN THE SAME COMMIT THAT DEMOTES D388's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D388's body
  // was captured BY INDEX before the rewrite — 197 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D388)" and closing "— and D388 also RAISED the ratchet 57 -> 58
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed (D372's range-replace ate a body while this ratchet stayed
  // green, because the heading count is not the body count).
  // 🆕🆕 D390 — 59 -> **60**, RAISED IN THE SAME COMMIT THAT DEMOTES D389's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D389's body
  // was captured BY INDEX before the rewrite — 190 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D389)" and closing "— and D389 also RAISED the ratchet 58 -> 59
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with BOTH headings confirmed present in order (D372's
  // range-replace ate a body while this ratchet stayed green, because a count of HEADINGS is
  // not a count of ARCHIVES).
  // 🆕🆕 D392 — 61 -> **62**, RAISED IN THE SAME COMMIT THAT DEMOTES D391's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D391's body
  // was captured BY INDEX before the rewrite — 208 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D391)" and closing "— and D391 also RAISED the ratchet 60 -> 61
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with BOTH headings confirmed present in order.
  // 🆕🆕 D394 — 63 -> **64**, RAISED IN THE SAME COMMIT THAT DEMOTES D393's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D393's body
  // was captured BY INDEX before the rewrite — 227 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D393)" and closing "— and D393 also RAISED the ratchet 62 -> 63
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with BOTH headings confirmed present in order.
  // 🆕🆕 D395 — 64 -> **65**, RAISED IN THE SAME COMMIT THAT DEMOTES D394's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D394's body
  // was captured BY INDEX before the rewrite — 208 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D394)" and closing "— and D394 also RAISED the ratchet 63 -> 64
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with BOTH headings confirmed present in order.
  // 🆕🆕 D399 — 68 -> **69**, RAISED IN THE SAME COMMIT THAT DEMOTES D398's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D398's body
  // was captured BY INDEX before the rewrite — 197 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-23, after D398)" and closing on its sweep paragraph, "— The log path and
  // PID are in this slice's return message. Do not poll it and arm no waiters." — re-emitted
  // under its own archive heading, and the SEAM was re-read afterwards rather than assumed,
  // with BOTH headings confirmed present in order.
  // 🆕🆕 D398 — 67 -> **68**, RAISED IN THE SAME COMMIT THAT DEMOTES D397's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D397's body
  // was captured BY INDEX before the rewrite — 212 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D397)" and closing on its sweep paragraph, "— and the amendment
  // is written where the next slice will read it rather than only here." — re-emitted under its
  // own archive heading, and the SEAM was re-read afterwards rather than assumed, with BOTH
  // headings confirmed present in order.
  // 🆕🆕 D397 — 66 -> **67**, RAISED IN THE SAME COMMIT THAT DEMOTES D396's RESUME POINT
  // 🆕🆕 D396 — 65 -> **66**, RAISED IN THE SAME COMMIT THAT DEMOTES D395's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D395's body
  // was captured BY INDEX before the rewrite — 213 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-22, after D395)" and closing "— and D395 also RAISED the ratchet 64 -> 65
  // in the same commit." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with BOTH headings confirmed present in order.
  // 🆕🆕 D400 — 69 -> **70**, RAISED IN THE SAME COMMIT THAT DEMOTES D399's RESUME POINT
  // (the guard's UP branch: archived deliberately, say so and raise the number). D399's body
  // was captured BY INDEX before the rewrite — 247 lines, opening "THE NEXT CONCRETE ACTION
  // (written 2026-08-23, after D399)" and closing on the paragraph that ends "…over all 1,379
  // rows after the rewrite as well." — re-emitted under its own archive heading, and the SEAM
  // was re-read afterwards rather than assumed, with BOTH headings confirmed present in order.
  // 🆕🆕 D402 — 71 -> **72**, RAISED IN THE SAME COMMIT THAT DEMOTED D401's RESUME
  // POINT. The guard's UP branch, taken deliberately: one archive was added because one
  // resume point was archived. D376 shipped a red `HEAD` by making the demotion and not
  // this edit, so the two belong in one commit and always will.
  // 🆕🆕 D405 — 74 -> **75**, RAISED IN THE SAME COMMIT THAT DEMOTED D404's RESUME
  // POINT. The guard's UP branch, taken deliberately, for the FIFTH slice running. D404's
  // body was captured BY INDEX before the rewrite — 213 lines, opening "THE NEXT CONCRETE
  // ACTION (written 2026-08-23, after D404)" and closing on the paragraph that ends
  // "…re-anchored and re-probed 8/8, and the rule is now in the standing brief." —
  // re-emitted under its own archive heading, and the SEAM was re-read afterwards rather
  // than assumed, with both headings confirmed present and their bodies in order.
  // 🆕🆕 D404 — 73 -> **74**, RAISED IN THE SAME COMMIT THAT DEMOTED D403's RESUME
  // POINT. The guard's UP branch, taken deliberately, for the fourth slice running. D403's
  // body was captured BY INDEX before the rewrite — 204 lines, opening "THE NEXT CONCRETE
  // ACTION (written 2026-08-23, after D403)" and closing on the paragraph that ends
  // "…Split-aware residue is **238 / 400**, not 243 / 413." — re-emitted under its own
  // archive heading, and the SEAM was re-read afterwards rather than assumed, with both
  // headings confirmed present and in order.
  // 🆕🆕 D403 — 72 -> **73**, RAISED IN THE SAME COMMIT THAT DEMOTED D402's RESUME
  // POINT. The guard's UP branch, taken deliberately, for the third slice running. D402's
  // body was captured BY INDEX before the rewrite — 239 lines, opening "THE NEXT CONCRETE
  // ACTION (written 2026-08-23, after D402)" and closing on the paragraph that ends
  // "…re-run over all 1,395 rows after the rewrite as well." — re-emitted under its own
  // archive heading, and the SEAM was re-read afterwards rather than assumed, with both
  // headings confirmed present and in order.
  // 🆕🆕 D406 — 75 -> **76**, RAISED IN THE SAME COMMIT THAT DEMOTED D405's RESUME
  // POINT. The guard's UP branch, taken deliberately, for the sixth slice running.
  // D405's body was captured BY INDEX before the rewrite — 221 lines, opening "THE NEXT
  // CONCRETE ACTION (written 2026-08-23, after D405)" and closing on the paragraph that
  // ends "…caught by grepping `mutants.ts` before the commit rather than by a red
  // sweep." — re-emitted under its own archive heading, and the SEAM was re-read
  // afterwards rather than assumed, with both headings confirmed present and in order.
  // 🆕🆕 D407 — 76 -> **77**, RAISED IN THE SAME COMMIT THAT DEMOTED D406's RESUME
  // POINT. The guard's UP branch, taken deliberately, for the seventh slice running.
  // D406's body was captured BY INDEX before the rewrite — 261 lines, opening "THE NEXT
  // CONCRETE ACTION (written 2026-08-23, after D406)" and closing on the paragraph that
  // ends "…THE DOCS' REASONS ROT FASTER THAN THEIR VERDICTS, AND FOUR IN ONE SLICE IS
  // THE clearest measurement of that yet." — re-emitted under its own archive heading,
  // and the SEAM was re-read afterwards rather than assumed, with both headings confirmed
  // present and in order.
  // 🆕🆕 D408 — 77 -> **78**, RAISED DELIBERATELY AND IN THE SAME COMMIT THAT DEMOTED
  //    D407's resume point, which is the UP branch this guard's own message asks to be
  //    told about. D407's body was captured BY INDEX before the rewrite (272 lines) and
  //    re-emitted under its own archive heading, because a range-replace up to the FIRST
  //    `### Prior resume point (` drops the demoted BODY while this heading count stays
  //    green (D372 paid exactly that).
  // 🆕🆕 D409 — 78 -> **79**, RAISED DELIBERATELY AND IN THE SAME COMMIT THAT DEMOTED
  //    D408's resume point. D408's body was captured BY INDEX before the rewrite
  //    (257 lines, opening "### ▶ THE NEXT CONCRETE ACTION (written 2026-08-24, after
  //    D408)") and re-emitted under its own archive heading, and the seam was READ
  //    BACK afterwards to confirm the demoted body is still there — D372's rule.
  // 🆕🆕 D410 — 79 → **80**, the UP branch: D410 demoted D409's live resume point under
  // `### Prior resume point (P3-M5 — D409, …)` and carried the demoted BODY across with it —
  // 238 lines, captured BEFORE the rewrite and re-emitted after it, with the seam re-read
  // afterwards. ⚠️ THIS SLICE WAS FINISHED BY HAND after its build agent died mid-edit on an
  // API error, so the raise is the coordinating session's rather than the builder's — and it
  // rides in the same commit as the demotion for D376's reason, which is the only reason that
  // has ever mattered here.
  // 🆕🆕 D411 — 80 -> 81, ARCHIVED DELIBERATELY AND SAID SO. D411 demoted D410's live
  // resume point under `### Prior resume point (P3-M5 — D410, …)` and wrote its own in
  // its place. ⚠️ THE SLICE TOUCHES NO ENGINE FILE — it is `scripts/mutation/run.ts`
  // plus a guard — so this literal and the two stamps are the whole of its footprint
  // inside `packages/engine`, and the raise rides in the same commit as the demotion.
  // 🆕🆕 D412 — 81 -> 82, ARCHIVED DELIBERATELY AND SAID SO. D412 demoted D411's live
  // resume point under `### Prior resume point (P3-M5 — D411, …)` and wrote its own in
  // its place, in the same commit as the demotion.
  // 🆕🆕 D413 — 82 -> 83, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D412's live resume point.
  // 🆕🆕 D414 — 83 -> 84, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D413's live resume point.
  // 🆕🆕 D415 — 84 -> 85, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D414's live resume point.
  // 🆕🆕 D416 — 85 -> 86, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D415's live resume point.
  // 🆕🆕 D417 — 86 -> 87, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D416's live resume point.
  // 🆕🆕 D418 — 87 -> 88, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D417's live resume point.
  // 🆕🆕 D419 — 88 -> 89, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D418's live resume point.
  // 🆕🆕 D439 — 108 -> 109, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D438's resume point.
  // 🆕🆕 D438 — 107 -> 108, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D437's resume point.
  // 🆕🆕 D437 — 106 -> 107, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D436's resume point.
  // 🆕🆕 D436 — 105 -> 106, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D435's resume point.
  // 🆕🆕 D435 — 104 -> 105, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D434's resume point.
  // 🆕🆕 D434 — 103 -> 104, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D433's resume point.
  // 🆕🆕 D433 — 102 -> 103, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D432's resume point.
  // 🆕🆕 D432 — 101 -> 102, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D431's resume point.
  // 🆕🆕 D431 — 100 -> 101, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D430's resume point.
  // 🆕🆕 D430 — 99 -> 100, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D429's resume point. THE HUNDREDTH ARCHIVED RESUME POINT.
  // 🆕🆕 D429 — 98 -> 99, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D428's resume point.
  // 🆕🆕 D428 — 97 -> 98, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D427's resume point.
  // 🆕🆕 D427 — 96 -> 97, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D426's resume point.
  // 🆕🆕 D426 — 95 -> 96, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D425's resume point.
  // 🆕🆕 D425 — 94 -> 95, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D424's resume point.
  // 🆕🆕 D424 — 93 -> 94, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D423's resume point.
  // 🆕🆕 D423 — 92 -> 93, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D422's resume point.
  // 🆕🆕 D422 — 91 -> 92, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D421's resume point.
  // 🆕🆕 D421 — 90 -> 91, ARCHIVED DELIBERATELY AND SAID SO, in the same commit that demotes
  //    D420's resume point. The two-site edit is what keeps this a ratchet.
  // 🆕🆕 D420 — 89 -> 90, ARCHIVED DELIBERATELY AND SAID SO, in the same commit as
  // the demotion of D419's live resume point.
  const ARCHIVES = 183; // 🆕 D513 — the D512 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one. The slice found the capability it was told to invent already shipped at D332 under another name; the ratchet counts RITUALS, so discovering a machine moves it exactly as far as building one.
  // 🆕 D466 — the D465 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D465 — the D464 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D464 — the D463 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D463 — the D462 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D462 — the D461 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D461 — the D460 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. 🆕 D460 — the D459 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. // 🆕 D459 — the D458 resume point was demoted to a `### Prior resume point (` block in the same edit that wrote the new one. // 🆕 D458 — the D457 resume point was demoted to a `### Prior resume point (` block, in the same edit that wrote the new one; the new block was INSERTED ABOVE the demoted heading rather than the span being range-replaced (D372's lost body came from a range-replace), and both headings were re-read in order afterwards. // 🆕 D457 — the D456 resume point was demoted to a `### Prior resume point (` block, in the same edit that wrote the new one; the demoted BODY was carried across UNTOUCHED (the new block was INSERTED above it rather than the span being range-replaced, which is the shape D372's lost body came from), and the seam was re-read afterwards with both headings confirmed present in order. // 🆕 D456 — the D455 resume point was demoted to a `### Prior resume point (` block, in the same edit that wrote the new one. // 🆕 D455 — the D454 resume point was demoted to a `### Prior resume point (` block, in the same commit that writes the new live one. // 🆕 D454 — the D453 resume point was demoted to a `### Prior resume point (` block, in the same commit that writes the new live one. // 🆕 D453 — the D452 resume point was demoted to a `### Prior resume point (` block, in the same commit that writes the new live one. // 🆕 D452 — the D451 resume point was demoted to a `### Prior resume point (` block, in the same commit that writes the new live one. // 🆕 D451 — the D450 resume point was demoted to a `### Prior resume point (` block, in the same commit that writes the new live one. // 🆕 D450 — the D449 resume point was demoted to a `### Prior resume point (` block. // 🆕 D449 — the D448 resume point was demoted to a `### Prior resume point (` block. // 🆕 D448 — the D447 resume point was demoted to a `### Prior resume point (` block. // 🆕 D447 — the D446 resume point was demoted to a `### Prior resume point (` block. // 🆕 D446 — the D445 resume point was demoted to a `### Prior resume point (` block.

  // 🆕 D454 — THE TITLE USED TO SPELL A LITERAL **109** WHILE `ARCHIVES` READ 123, AND HAD
  // BEEN WRONG BY FOURTEEN SINCE the ratchet passed it. A test NAME is prose, so nothing
  // asserts it and nothing could go red; D417's repair is the one that applies — derive the
  // figure from the constant instead of keeping a second copy of it.
  it(`the page still holds all ${ARCHIVES} archived resume points, and they still live in the span a range-replace targets`, () => {
    const all = [...PROGRESS.matchAll(ARCHIVE_HEADING)];
    expect(
      all.length,
      `the page holds ${all.length} '### Prior resume point (' blocks, not ${ARCHIVES}. DOWN means a range-replace ate them (D317, 2,014 lines); UP means one was archived deliberately — say so and raise the number.`,
    ).toBe(ARCHIVES);

    const spanStart = PROGRESS.indexOf("\n## NEXT (resume point)");
    const spanEnd = PROGRESS.indexOf("\n## Status by workstream");
    expect(spanStart).toBeGreaterThan(0);
    expect(spanEnd).toBeGreaterThan(spanStart);
    const inSpan = all.filter((m) => (m.index ?? 0) > spanStart && (m.index ?? 0) < spanEnd);
    // The whole point: this is the span the offending script sliced, so the
    // archives being INSIDE it is what makes the deletion possible — and what
    // makes the count above the thing that reports it.
    expect(inSpan.length, "the archives moved out of the resume-point span").toBe(ARCHIVES);
    // A span that has stopped being big is the same defect one measurement earlier:
    // 38 one-line stubs would satisfy the count and not the page.
    const spanLines = PROGRESS.slice(spanStart, spanEnd).split("\n").length;
    expect(
      spanLines,
      `the resume-point span is ${spanLines} lines — D317's range-replace took it from ~2,470 to ~460`,
    ).toBeGreaterThan(1_500);
  });

  it("the live resume point is the FIRST thing in that span, ahead of every archive", () => {
    // The other half of the same edit: a script that appends its new resume point
    // AFTER the archives leaves the page green and unreadable.
    const spanStart = PROGRESS.indexOf("\n## NEXT (resume point)");
    const firstArchive = PROGRESS.indexOf("\n### Prior resume point (");
    expect(firstArchive).toBeGreaterThan(spanStart);
    const live = PROGRESS.slice(spanStart, firstArchive);
    expect(live, "the live resume point must name the next concrete action").toContain(
      "THE NEXT CONCRETE ACTION",
    );
    expect(live.split("\n").length).toBeGreaterThan(50);
  });
});
