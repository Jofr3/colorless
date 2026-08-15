#!/usr/bin/env python3
"""D345 close-out for docs/progress.md. Four edits, each anchored on an EXACT
literal and each asserted to occur exactly once. NO regex with re.S anywhere —
a past regex of that shape would have deleted 582 KB of this page.

Usage:  python3 scratchpad/D345-docs.py --dry-run   (prints a diff summary)
        python3 scratchpad/D345-docs.py --apply
"""
import sys, pathlib

SWEEP = {
    "corpus": "1012",
    "killed": "990",
    "survivors": "22",
    "gaps": "0",
    "stale": "0",
    "errors": "0",
    "seconds": "3,275.5",
}

P = pathlib.Path("docs/progress.md")
src = P.read_text()
orig_len = len(src)

def sub_once(s, old, new, label):
    n = s.count(old)
    assert n == 1, f"{label}: anchor occurs {n} times, expected 1"
    return s.replace(old, new, 1)

# ── 1. HEADER STAMP ────────────────────────────────────────────────────────
OLD_HEADER = "**Last updated:** 2026-08-15 — build session #284 (**P3-M5 — D344,"
NEW_HEADER = (
    "**Last updated:** 2026-08-15 — build session #285 (**P3-M5 — D345, *THE "
    "PRINTED SELF-KNOCK-OUT COST: AN ABILITY LEARNS TO SPEND THE BODY THAT PRINTS "
    "IT — AND THE ROW WAS FOUND BY RUNNING D344's METHOD, NOT BY SPENDING A PRICE.* "
    "Engine **0.250.0 → 0.251.0** over FIVE sites; `MATCH_RECORD_VERSION` **STAYS "
    "20** — `knockOutSelf` never parks (no `PendingStage` inhabitant), has no field "
    "(no persisted union gains a member) and is rendered through the existing "
    "`KNOCKED_OUT` event. **BUILT: Dusclops `sv06.5-019`/`-069`/`sv08.5-036` and "
    "Dusknoir `sv06.5-020`/`-070`/`sv08.5-037` \"Cursed Blast\" — 6 legal printings, "
    "2 sentences, 2 objects.** ✅ **THE METHOD, RUN IN ORDER:** largest live "
    "`censusAtHead` `ROWS` residue is row 9 (10 ids, read off the file) → census the "
    "CLAUSE its `abilityIds` are blocked on, over ALL THREE text columns on remote D1 "
    "`luminous`: `effect` **0** + `abilities_json` **9 printings / 9 legal / 3 "
    "sentences** + `attacks_json` **0** = **9 / 9 / 3** ✅, the only family this run "
    "has censused where `printings === legal` → and **the card the residue points at "
    "is the ONE THIRD of that family that owes a SECOND mechanism**, so it was "
    "REFUSED and re-priced instead of built. 🛑 **THE ROW FOUND A LIVE DEFECT IN A "
    "GATE, NOT ONLY A GAP IN A CATALOG**: `programPlayable`'s `damageChosen` arm read "
    "the opponent's BENCH LENGTH for an op whose `opponentAny` arm offers their "
    "ACTIVE — accidentally right for two hundred decisions because every registry "
    "producer was a Bench snipe and every `opponentAny` producer was an ATTACK, and "
    "attacks never reach that function (§8). ⚠️ **THE PREDICTION GRADE IS 31-14 AND "
    "TEN OF THE FOURTEEN ARE ONE DEFECT — the one the work order named.** *A figure "
    "named is not its rungs enumerated*: `BUILT.ability` carries EIGHT rungs and the "
    "prediction listed TWO. (Superseded, kept for continuity: build session #284, "
    "**P3-M5 — D344,"
)
src = sub_once(src, OLD_HEADER, NEW_HEADER, "header")

# ── 2. STATUS ROW — demote D344, add D345 above it ─────────────────────────
lines = src.split("\n")
idx = [i for i, l in enumerate(lines) if l.startswith("| simulator | P3 | ")]
assert len(idx) == 1, f"status row: found {len(idx)} live simulator rows"
i = idx[0]
demoted = lines[i].replace(
    "| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (latest:",
    "| ~~simulator~~ | ~~P3~~ | ~~(was D344)~~ 🚧 **M1–M3 + M4 done; M5 in progress** (was:",
    1,
)
assert demoted != lines[i], "status row: demotion anchor did not match"
NEW_ROW = (
    "| simulator | P3 | 🚧 **M1–M3 + M4 done; M5 in progress** (latest: **P3-M5 — "
    "D345, THE PRINTED SELF-KNOCK-OUT COST, AND A GATE THAT HAD BEEN ACCIDENTALLY "
    "RIGHT FOR TWO HUNDRED DECISIONS.** Engine **0.250.0 → 0.251.0** over FIVE sites "
    "(the fifth is not a version site at all — D275's mutation anchor); "
    "`MATCH_RECORD_VERSION` **STAYS 20**. **BUILT: Dusclops ×3 and Dusknoir ×3 "
    "\"Cursed Blast\"** — *\"Once during your turn, you may put 5 (13) damage counters "
    "on 1 of your opponent's Pokémon. **If you use this Ability, this Pokémon is "
    "Knocked Out.**\"* — **6 legal printings, 2 sentences, 2 objects**, ONE new "
    "field-free `EffectOp` (`knockOutSelf`), NO new event, NO new prompt kind, NO new "
    "`TriggerTiming`. ✅ **THE ROW WAS CHOSEN BY D344's METHOD RATHER THAN BY A "
    "HANDED-ON PRICE**, and the method's third step paid: the clause census over all "
    "three columns is **9 printings / 9 legal / 3 sentences**, and Magneton "
    "`svp-153`/`svp-159`/`sv08-059` — the card row 9's residue points at — is the one "
    "third that ALSO owes the *\"in any way you like\"* distribution. **Refused and "
    "re-priced, not built.** Also refused, each with its measurement: Glass Trumpet "
    "(2 legal, Tera has no supply-side datum), Reboot Pod (1, the Future banner), "
    "Powerglass (2, needs an `endOfTurn` `TriggerTiming` — the whole \"end of your "
    "turn\" family is 4 legal in `effect` and 2 of those are the TM self-discard "
    "tail). 🛑 **`programPlayable`'s `damageChosen` arm read the opponent's BENCH "
    "LENGTH for every `damageChosen`** — the `opponentBench` reading and only that "
    "one — so the first registry `opponentAny` row greyed out an Ability whose own op "
    "offers the opponent's Active. Fixed by sharing the op's funnel (`snipeTargets`), "
    "as the `gust` line beside it already does. `BUILT.ability` 252 → **258**, `built` "
    "**1573**, residue **810**, three-column sum **375**, `raw.length` **682**, "
    "`nonAttackRegistryIds` **538**, `ABILITY_D1_SHAPE` **258 / 117**, "
    "`ABILITY_D1_COLUMNS` **245 / 258** (258 − 245 = 13, the attack-gate identity "
    "closes), objects **106**, the (name, object) JOIN **119**, `LANDED` **53 / 107**; "
    "`BUILT.attack` **1198** stands still on all three summands, MEASURED. ⚠️ "
    "**Prediction 31-14, and TEN of the misses are one defect** — every rung keyed on "
    "a DECOMPOSITION of the figure the prediction named. `bun run check` **354 files "
    "/ 7,254 tests**, exit 0; sweep **{killed} killed · {survivors} known survivors · "
    "{gaps} GAPs · {stale} stale · {errors} errors** over a **{corpus}**-row corpus.) |"
).format(**SWEEP)
lines[i : i + 1] = [NEW_ROW, demoted]
src = "\n".join(lines)

# ── 3. SESSION LOG ENTRY ───────────────────────────────────────────────────
LOG_ANCHOR = "## Session log\n\n### 2026-08-15 — build session #284"
entry = pathlib.Path("scratchpad/D345-session-log.md").read_text().rstrip("\n")
src = sub_once(
    src,
    LOG_ANCHOR,
    "## Session log\n\n" + entry + "\n\n### 2026-08-15 — build session #284",
    "session log",
)

# ── 4. RESUME POINT — replace the span between two EXACT literals ──────────
START = "## NEXT (resume point)\n"
END = "\n### Prior resume point (P5-3 — deck cover art, kept for continuity)"
a = src.find(START)
b = src.find(END)
assert a != -1 and b != -1 and a < b, "resume point: boundary literals not found"
assert src.count(END) == 1, "resume point: END literal is not unique"
resume = pathlib.Path("scratchpad/D345-resume.md").read_text().rstrip("\n")
src = src[: a + len(START)] + "\n" + resume + src[b:]

if "--apply" in sys.argv:
    P.write_text(src)
    print(f"APPLIED. {orig_len} -> {len(src)} bytes ({len(src)-orig_len:+d})")
else:
    print(f"DRY RUN OK. {orig_len} -> {len(src)} bytes ({len(src)-orig_len:+d})")
    print("all four anchors matched exactly once; nothing written")
