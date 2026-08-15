#!/usr/bin/env python3
"""D343 docs close-out — the four ritual sites, applied by str.index boundaries.

D317's range-replace (`## NEXT (resume point)` -> `\n## Status by workstream`,
2,014 lines and 38 archived resume points deleted, green on both sides) is why
this script uses NO regex with re.S and NO span that reaches past the FIRST
`\n### Prior resume point (`.

Run with --dry-run first. It prints every boundary, every line delta and the
archive count on both sides, and writes nothing.
"""

import sys

PATH = "docs/progress.md"
DRY = "--dry-run" in sys.argv

SWEEP = {
    "corpus": "985",
    "killed": "KILLED_N",
    "known": "KNOWN_N",
    "gaps": "GAPS_N",
    "stale": "STALE_N",
    "errors": "ERRORS_N",
}

# ── 1. header stamp ──────────────────────────────────────────────────────────
STAMP = (
    "**Last updated:** 2026-08-15 — build session #283 (**P3-M5 — D343, *KOFU'S "
    "PRINTED \"IN ANY ORDER\": `reorderTop` LEARNS THE DECK'S BOTTOM, AND THE ROW "
    "THE WORK ORDER PRICED HAD ALREADY SHIPPED.*** Engine **0.248.0 → 0.249.0**, "
    "ONE bump over FOUR sites; `MATCH_RECORD_VERSION` **STAYS 20** — a new "
    "OPTIONAL op field (`reorderTop.from`) and a new OPTIONAL event field "
    "(`DECK_TOP_REORDERED.end`) are registry-side program vocabulary and a "
    "rendered log row, and neither is a persisted shape. 🛑 **KOFU `sv07-138`/"
    "`sv07-165` WAS ALREADY BUILT AT `5827be3`** — `registry.ts` held `const "
    "KOFU`, wired at both printings and `fix-kofu`, with a doc block, a "
    "demonstrator and two driven tests. D341's resume point priced a row that had "
    "shipped, which is **D330's lesson at its second site**. What was NOT built "
    "was the *printed* **\"in any order\"**, and the program dropped it silently: "
    "`payFromHand{count:2,to:\"deckBottom\"}` then a `recordGate` and a draw. "
    "**THE TELL WAS IN THE EXISTING TEST AND IT IS D342's SHAPE EXACTLY** — "
    "`legalNonAttackPrograms.test.ts` asserted the payment landed with "
    "`expect([...tail].sort()).toEqual([...picks].sort())`, an assertion about a "
    "**SET** where the print demands a **SEQUENCE**, the sibling of D342's "
    "\"a FIELD instead of a BOARD\". **BUILT: a WINDOW FORK, not a CHANNEL** — "
    "`reorderTop { n: 2, from: \"bottom\" }` placed inside the existing "
    "`recordGate{slot:\"paid\"}` ahead of the draw. After "
    "`payFromHand{to:\"deckBottom\"}` the two paid cards ARE the deck's last two "
    "**by construction**, so D342's \"the channel is the board\" trick is GENERAL "
    "and only its READER was not: `reorderTop` could not address that end. "
    "**TWO CHEAPER OPTIONS WERE REFUSED FROM SOURCE, not from taste** — (c) "
    "letting the `chooseCards` answer's ARRAY ORDER be the ordering, refused "
    "because `index.ts`'s D341 doctrine states *\"the validator is free to treat "
    "the array as a set\"* AND because `payFromHand` AUTO-RESOLVES when "
    "`candidates.length <= op.count`, so on the commonest Kofu board **no prompt "
    "is shown at all** and the printed clause is not merely unspecified but "
    "ABSENT; and (b) a prompt over the HAND that both SELECTS and SEQUENCES, "
    "refused because it is a NEW PROMPT KIND and re-pays D341's whole bill. 🛑🛑 "
    "**AND THE ERRAND WAS THE THIRD INSTANCE OF ONE DEFECT IN THREE SLICES**: "
    "`revealClause`'s DISCOVERED census swept `Object.keys(FIXTURE_POOL)` — a "
    "SAMPLE that happened to be lying around — where its loop body calls "
    "`programFor(id)` and `searchOps(id)` and touches no card text at all. "
    "Repointed at `registryCardIds()` ∪ the pool: **`swept.size` 27 → 103, "
    "`classified.size` 39 → 44**, and the gap was **FIVE distinct programs over "
    "THIRTEEN real catalog ids**, every one of them ALREADY BUILT and none of "
    "them ever tabled — *including Ciphermaniac's Codebreaking, authored by the "
    "IMMEDIATELY PRECEDING SLICE, through which this sweep stayed green.* **A "
    "DISCOVERED CENSUS THAT CANNOT SEE THE CATALOG DOES NOT FAIL — IT AGREES "
    "WITH YOU.** D341 repaired `preventBlock` §11, D342 repaired `programWalk`, "
    "and this is the auditor whose entire job was to be TOTAL. ⚠️ **NOT ONE "
    "`BUILT.*` COLUMN MOVED AND THAT IS THE SLICE'S UNUSUAL FEATURE** — Kofu was "
    "already counted, so `BUILT.attack` 1198 (1169 raw / 16 registry / 13 split), "
    "`.ability` 252, `.trainer` 108, `.specialEnergy` 8, `built` 1566, residue "
    "817, `unbuiltAttack` 534, `raw.length` 675, `nonAttackRegistryIds` 531, "
    "`units` 2383, `TRAINER_TERMS` 57 and `DROPPED` 2 all stand still, MEASURED "
    "at this head rather than assumed. `bun run check` **352 files / 7,215 "
    "tests**; mutation corpus **977 → 985**.)"
)

# ── 2. status row ────────────────────────────────────────────────────────────
ROW = (
    "| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (latest: **P3-M5 — "
    "D343, KOFU'S PRINTED \"IN ANY ORDER\": `reorderTop` LEARNS THE DECK'S "
    "BOTTOM.** Engine **0.248.0 → 0.249.0**, `MATCH_RECORD_VERSION` **20, "
    "unchanged** — the op field `reorderTop.from` and the event field "
    "`DECK_TOP_REORDERED.end` are both OPTIONAL and absent on every existing "
    "construction site. The row Kofu `sv07-138`/`sv07-165` was ALREADY BUILT; "
    "what shipped is the printed ordering the program dropped, as a WINDOW FORK "
    "on an existing op rather than a new channel or a new prompt kind. Plus the "
    "third repair in three slices of one defect — an auditor sweeping a FIXTURE "
    "SAMPLE instead of the CATALOG: `revealClause`'s `swept.size` 27 → 103, "
    "`classified.size` 39 → 44, five already-built programs over thirteen catalog "
    "ids that no reveal table had ever named.) |"
)

def main():
    src = open(PATH, encoding="utf-8").read()
    before_lines = src.count("\n") + 1
    before_arch = src.count("\n### Prior resume point (")
    print(f"BEFORE: {before_lines} lines, {before_arch} archives, {len(src)} bytes")

    out = src

    # (1) header stamp — the FIRST occurrence of the live spelling, in the
    #     opening block. Located by index, replaced to end-of-line only.
    i = out.index("**Last updated:** ")
    if out[:i].count("\n") + 1 >= 11:
        raise SystemExit("header stamp is not in the page's first ten lines")
    j = out.index("\n", i)
    print(f"  stamp: line {out[:i].count(chr(10)) + 1}, replacing {j - i} chars")
    out = out[:i] + STAMP + out[j:]

    # (2) status row — the live `| simulator | P3 |` row, one line.
    i = out.index("\n| simulator | P3 |") + 1
    j = out.index("\n", i)
    print(f"  status row: line {out[:i].count(chr(10)) + 1}, replacing {j - i} chars")
    out = out[:i] + ROW + out[j:]

    # (3) session log — INSERT #283 directly after the `## Session log` heading's
    #     blank line and BEFORE #282. Insertion only; nothing is replaced.
    anchor = "\n### 2026-08-15 — build session #282 "
    i = out.index(anchor) + 1
    entry = open("scratchpad/entry-283.md", encoding="utf-8").read().rstrip("\n") + "\n\n"
    print(f"  session log: inserting {entry.count(chr(10))} lines before #282 at line {out[:i].count(chr(10)) + 1}")
    out = out[:i] + entry + out[i:]

    # (4) resume point — replace ONLY from `\n## NEXT (resume point)` to the
    #     FIRST `\n### Prior resume point (`. NOT to `## Status by workstream`:
    #     that span holds every archive and is exactly what D317 deleted.
    start = out.index("\n## NEXT (resume point)")
    end = out.index("\n### Prior resume point (")
    if end <= start:
        raise SystemExit("archives are not after the live resume point")
    live = open("scratchpad/resume-343.md", encoding="utf-8").read().rstrip("\n")
    print(f"  resume point: replacing lines {out[:start].count(chr(10)) + 2}..{out[:end].count(chr(10)) + 1} "
          f"({out[start:end].count(chr(10))} lines) with {live.count(chr(10)) + 1} lines")
    if "THE NEXT CONCRETE ACTION" not in live:
        raise SystemExit("the new resume point does not name THE NEXT CONCRETE ACTION")
    if live.count("\n") + 1 <= 50:
        raise SystemExit("the new resume point is <= 50 lines")
    if "### Prior resume point (" in live:
        raise SystemExit("the new resume point contains an archive heading")
    out = out[:start] + "\n" + live + "\n" + out[end:]

    after_lines = out.count("\n") + 1
    after_arch = out.count("\n### Prior resume point (")
    print(f"AFTER:  {after_lines} lines, {after_arch} archives, {len(out)} bytes")
    print(f"DELTA:  {after_lines - before_lines:+d} lines, {after_arch - before_arch:+d} archives")
    if after_arch != 38:
        raise SystemExit(f"ARCHIVE COUNT MOVED: {before_arch} -> {after_arch}")
    if after_lines < before_lines - 50:
        raise SystemExit("the page shrank by more than 50 lines — refusing")

    # the span the guard measures must still be > 1500 lines
    s = out.index("\n## NEXT (resume point)")
    e = out.index("\n## Status by workstream")
    print(f"CHECK:  resume-point span = {out[s:e].count(chr(10)) + 1} lines (guard wants > 1500)")

    if DRY:
        print("DRY RUN — nothing written")
        return
    open(PATH, "w", encoding="utf-8").write(out)
    print("WRITTEN")

main()
