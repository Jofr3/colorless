import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import { programFor, registryCardIds } from "./registry";

// 0.149.0 → 0.149.1 — D233, THE CENSUS RE-DERIVED AT HEAD: rows 9-16 of
// `coverage-backlog-legal.md`, and the first row on that page to ship WITH THE
// QUERY THAT PRODUCED IT.
//
// 🛑 WHY THIS FILE EXISTS AND WHY IT IS A TEST RATHER THAN A TABLE. Four rows
// running (D229 19→16, D230 22→25, D231 25→42, D232 35→31) carried a printing
// count NOBODY COULD REPRODUCE, and D232's diagnosis was the sharpest: its three
// PER-SENTENCE figures were each exactly right and their sum was 20, so its "35"
// was a total nobody derived. A number in a markdown cell has nothing behind it.
// **The counts below are the same numbers the page's new rows quote, and they are
// RE-COMPUTED here from the printed sentences every time the suite runs.**
//
// ⚠️ WHAT WOULD TURN THIS RED, said before it is trusted (conventions.md, "A guard
// must be able to go RED"):
//   • building ANY of the eight families — the moment a deriver arm resolves one
//     of these printed sentences, `refusedByEveryReader` fails on it BY NAME, and
//     the row's count in the doc is stale by exactly that sentence's printings;
//   • authoring ANY of the named non-attack ids — `programFor(id)` stops being
//     undefined and the ability/Trainer half of the row is stale;
//   • mistyping a sentence — the per-row arithmetic and the family-pattern rows
//     both fail, because each sentence must match its OWN family predicate and no
//     EARLIER one (that ORDER is what produced the D1 counts).
// The one thing it must NOT be is vacuously green because the readers are broken
// or mis-imported, so `DERIVABLE_CONTROL` drives a positive through the same
// seven functions first (D214's attribution control).
//
// ⚠️ PROVENANCE. Measured against the REMOTE Cloudflare D1 `luminous`
// (`database_id 735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-06**,
// `legal_standard = 1` — **2,021 rows / 18 sets**, **2,383 text units** — with
// `json_each` over `attacks_json` / `abilities_json` PLUS the bare `effect`
// column, GLOB (never LIKE) with a CASE CLASS on any leading verb, and **GROUPED
// BY SENTENCE**. The exact SQL for every number is in
// `docs/reference/coverage-backlog-legal.md` §"THE D233 RE-DERIVATION".
//
// ✅ THE METHOD REPRODUCES D187's HEADLINE EXACTLY, WHICH IS WHY THE NEW ONE IS
// BELIEVABLE. Re-run in a detached worktree at `02b839c` (the commit the page's
// old headline names), the same sweep returns **918 derived + 4 registry = 922
// built**, byte-for-byte the figure that page records; the round-trip triple is
// unchanged too (**640 distinct attack sentences / 1,732 printings / 60,467
// characters**). At HEAD it returns **1,023 + 4 = 1,027**.

/** The population, re-derived at HEAD. Every figure carries the query that
    produced it — the discipline this file exists to install.

    ```sql
    -- units per column (legal_standard = 1)
    SELECT (SELECT COUNT(*) FROM cards WHERE legal_standard=1) AS legal_rows,
           (SELECT COUNT(*) FROM cards c, json_each(c.attacks_json) j
              WHERE c.legal_standard=1
                AND json_extract(j.value,'$.effect') NOT IN ('')) AS atk_units,
           (SELECT COUNT(*) FROM cards c, json_each(c.abilities_json) j
              WHERE c.legal_standard=1
                AND json_extract(j.value,'$.effect') NOT IN ('')) AS abil_units,
           (SELECT COUNT(*) FROM cards WHERE legal_standard=1
                AND effect NOT IN ('')) AS eff_units;
    ```
    ⚠️ `eff_units` is **275 = 264 Trainer + 11 Special Energy**, split by
    `cards.category`. The denominators did not move from D187. */
const POPULATION = {
  legalRows: 2021,
  attackUnits: 1732,
  abilityUnits: 376,
  trainerUnits: 264,
  specialEnergyUnits: 11,
} as const;

/** The BUILT set at HEAD, by the D187 method run at HEAD.

    * **attack** = any of the seven exported derivers returning non-null for the
      exact printed string (**1,023**), plus the four legal ids carrying a
      registry `attack` program whose text no deriver reads (**+4**, driven by
      `registryAttacksAreNotDerivable` below).
    * **ability** = a registry `abilities`/`passive`/`triggered`/`stadium`/`energy`
      entry; **Trainer / Special Energy** = a registry
      `trainer`/`stadium`/`rareCandy`/`passive`/`triggered`/`energy` entry. There
      is still **no deriver for either**, so the whole non-attack figure is
      `programFor(id)`, joined against D1 by id. */
const BUILT = {
  // ⚠️⚠️ **1,113 AT D247** — THE DISCARD-PILE SPREAD (Mudsdale `sv05-092`/
  // `sv05-175` "Mud Stock", 2 legal printings on 1 sentence). ✅ **RE-DERIVED BY
  // THE FULL SWEEP RATHER THAN INCREMENTED BY HAND, AND THAT WAS THE STANDING
  // INSTRUCTION**: D247 proved its own delta by an argument about ONE diff rather
  // than by re-auditing the other six readers, and left "the next slice that
  // touches a reader should run the sweep" behind. This slice touches a reader
  // (the destination table `attachFromZoneProgram` consults), so the sweep ran:
  // the seven readers over all **640 distinct legal attack sentences (1,732
  // units)** at HEAD return **1,111 derived on 288 sentences**, +4 registry =
  // **1,115**. The delta is EXACTLY the 2 this slice's suite drives, on exactly
  // the 1 sentence it names (287 → 288), so it added nothing to the unexplained
  // residue below — the EIGHTH slice running to leave it untouched.
  // ⚠️⚠️ **1,109 AT D246** — the GATED ATTACH and the BARE NOUN: Kilowattrel ex
  // `sv08-068` "Return Charge" (1), Snorlax `sv06-136` "But First, Food" (1) and
  // Landorus `sv08-110` "Fist of Focus" (1, the printing NO backlog cell sent this
  // slice to and the WIDENED QUERY found). ✅ **RE-DERIVED BY THE SWEEP RATHER
  // THAN INCREMENTED BY HAND**, this constant's own provenance rule: the seven
  // readers run over all **640 distinct legal attack sentences (1,732 units)** at
  // HEAD return **1,105 derived on 286 sentences**, +4 registry = **1,109**. The
  // delta is EXACTLY the 3 this slice's suites drive, on exactly the 3 sentences
  // it names, so it added nothing to the unexplained residue below — the SEVENTH
  // slice running to leave it untouched.
  // ⚠️ **1,106 AT D241** — LOOK AT THE TOP N, backlog row 11 (10 legal printings
  // on 4 of the row's 7 sentences, THREE anchors, one new op field). ✅ **RE-DERIVED
  // BY THE SWEEP RATHER THAN INCREMENTED BY HAND**, which is this constant's own
  // provenance rule: the seven readers run over all **640 distinct legal attack
  // sentences (1,732 units)** at HEAD return **1,102 derived on 283 sentences**,
  // +4 registry = **1,106**. The delta is EXACTLY the 10 this slice's suite
  // drives, on exactly the 4 sentences it names, so it added nothing to the
  // unexplained residue below — the sixth slice running to leave it untouched.
  // ⚠️ **1,096 AT D240** — the DAMAGE CAP, backlog row 17's whole attack column
  // (3 legal printings on 2 sentences, ONE new anchor with a numeric capture and
  // a checked comparator). The row was CREATED by D239's measurement and is
  // EMPTIED by this one, so it never spends a slice inside `ROWS`.
  // ⚠️ **1,093 AT D239** — the widened ATTACKER CLASS, 7 of row 15's 9 on the
  // SAME anchor D146 wrote (one optional brace-coded group, no new regex). The
  // remaining 2 are `Ancient` and Miraidon's `Future`/target, both permanently
  // unreachable from any anchor.
  // ⚠️ 1,027 AT D233; 1,039 at D234 (12 of row 9's 17); 1,059 at D235 (20 of row
  // 10's 28); 1,068 at D236 (9 of row 12's 16, off the SAME anchor as D234 with
  // the source zone as a factory argument); 1,078 at D237 (10 of row 13's 16 on
  // ONE new anchor); **1,086 AT D238**, the printed BRACE CODE — 4 more of row
  // 13 plus 4 in the hand-search family, which has had no `ROWS` entry since
  // D231 took it.
  //
  // ✅ **RE-DERIVED BY THE SWEEP AT BOTH ENDS, NOT INCREMENTED BY HAND**, which
  // is what this constant's provenance rule asks for and what D238 actually did:
  // the seven readers were run over all 640 distinct legal attack sentences
  // (1,732 units) twice — once in a detached worktree at `163ba4e` and once at
  // HEAD. **1,074 + 4 = 1,078 there; 1,082 + 4 = 1,086 here**, on 271 → 276
  // distinct sentences. The delta is exactly the 8 legal printings this slice's
  // three suites drive, so it added NOTHING to the unexplained residue below —
  // the fifth slice running to leave it untouched.
  // ⚠️ **1,113 AT D247** — THE UNBOUNDED HAND ATTACH, backlog row 12's largest
  // sentence (4 legal printings on 1 sentence; ONE new op, ONE new anchor, ZERO
  // new prompt kinds and ZERO wire-schema fields).
  // ✅ **RE-DERIVED, NOT INCREMENTED — AND THE DERIVATION IS A DIFFERENT ONE FROM
  // THE LAST SIX, SAID OUT LOUD BECAUSE IT IS WEAKER IN ONE PLACE AND STRONGER IN
  // ANOTHER.** The 640-sentence / 1,732-unit sweep is the standing method. This
  // slice instead proves the delta EXACTLY, from two facts that together pin it:
  //   • the ONLY edit to any of the seven readers is ONE new arm that returns
  //     early on a match and is unreachable by any sentence an earlier arm claims
  //     (`HAND_ATTACH` demands a capital `Attach` at `^`, so "You may attach…"
  //     cannot reach it) — so the arm can only ADD resolutions, never re-attribute
  //     one, and the count cannot move DOWN;
  //   • the arm's reachable set over the legal pool is exactly
  //     `SELECT json_extract(a.value,'$.effect') s, COUNT(*) FROM cards c,
  //      json_each(c.attacks_json) a WHERE c.legal_standard = 1 AND s LIKE
  //      'You may attach any number of%from your hand%' GROUP BY s`
  //     (remote D1 `luminous`, 2026-08-06) = **1 sentence / 4 units**, and BOTH
  //     `censusAtHead` and `derivedHandAttach` asserted that sentence derived to
  //     NULL before this slice.
  // **1,109 + 4 = 1,113**, and the delta is exactly the 4 this slice's suite
  // drives. ⚠️ THE WEAKER PART, NAMED: this argument is about THIS diff, so it
  // does not re-audit the other six readers the way a full sweep does. The next
  // slice that touches a reader should run the sweep.
  // ⚠️⚠️ **D274 — 1115 UNCHANGED, AND FOR THE FIRST TIME THAT IS A MEASUREMENT
  // RATHER THAN A CLAIM.** Every paragraph above promises "re-derived by the sweep
  // rather than incremented by hand", and every one of them means A HUMAN RAN A
  // SWEEP ONCE, at authoring time, in a container that happened to reach D1. This
  // number was therefore unguarded for **twenty-eight consecutive slices** — the
  // readers could have been widened, narrowed or broken outright and the constant
  // would have stayed green, which is the same defect D273 closed for the three
  // NON-ATTACK columns and left standing here by name.
  // ✅ **THE SWEEP NOW RUNS ON EVERY `bun run check`.** `censusAttackCorpus.ts`
  // commits the population (the 640 distinct legal attack sentences with their
  // printing counts, straight off the D1 statement it quotes) and the D274 section
  // at the foot of this file RUNS the seven readers over it live: **1,111 derived
  // on 288 sentences**, plus the **4** printings of `REGISTRY_ATTACKS`'s three
  // distinct sentences — looked up in the same corpus and asserted REFUSED, so the
  // two halves are provably disjoint — for **1,115**.
  // ✅ **AND THE LIVE COUNT CONFIRMS THE RECORDED ONE TO THE DIGIT.** D273's part A
  // found no wrong number in the three columns it took live; D274 finds none here.
  // The figure D247 last re-derived by hand is the figure the machine now returns.
  // 🛑 **THE `+ 4` IS NO LONGER A LITERAL IN THE ADDITION** — it is
  // `REGISTRY_ATTACKS`'s own corpus units. A fifth registry-authored attack moves it
  // without anyone editing this comment.
  //
  // 🆕 🛑 **1,129 AT D282 — THE FIRST MOVE IN THIS COLUMN IN 35 SLICES, AND THE
  // ADDITION GAINS A THIRD SUMMAND RATHER THAN A BIGGER FIRST ONE.** Two
  // mechanisms landed and they move this number in two DIFFERENT ways, which is
  // exactly why the third term is named instead of folded in:
  //   • `DamageCountSource.yourBenchCount` (a twelfth member, both folds) widens
  //     two of the seven readers, so the LIVE sweep over the RAW corpus rises on
  //     its own: **288 → 290 sentences / 1,111 → 1,117 printings** (+2 sentences,
  //     +6 printings — "This attack does 20 {more }damage for each of your Benched
  //     Pokémon.", 3 legal apiece). That is the ordinary way this column moves.
  //   • `splitAttackGateClause` (effects.ts) does NOT widen any reader — every
  //     anchor is still `^…$` — so the sweep over the raw printed string cannot
  //     see it. It produces a DIFFERENT string, and attack.ts runs the readers
  //     over that string only where D281's `attackGate` already accounts for the
  //     clause it removed. **A PRINTING WHOSE WHOLE SENTENCE THE ENGINE NOW
  //     RESOLVES IS BUILT, AND A SWEEP THAT CANNOT SEE THE SPLIT WOULD UNDERCOUNT
  //     IT BY 8** — Terapagos ex ×7 and Volbeat `sv06-009` — so the split half is
  //     measured as its own term below, by the same method the `+ 4` uses: the
  //     sentence must be IN the corpus, REFUSED whole by all seven readers, and
  //     RESOLVED after the split. 1,117 + 4 + 8 = **1,129**.
  // ⚠️ **AND THE OTHER THREE GATE SENTENCES CONTRIBUTE ZERO, WHICH IS THE GUARD.**
  // Five of the corpus's 640 sentences carry a gate clause (13 printings); the
  // bodies behind Illumise `sv06-010`, Scream Tail ex `sv06-094`/`-197` and
  // Exeggcute `sv08-001`/`-192` are still refused by all seven readers, so the
  // split term is 8 and not 13. A split that "worked" by claiming a sentence it
  // cannot read would show here as 13.
  //
  // 🆕 🛑 **1,137 AT D283 — THE TURN-SCOPED IMPOSED HAND-PLAY LOCK, AND IT MOVES
  // BOTH OF THE OTHER TWO SUMMANDS AT ONCE, WHICH NO PREVIOUS SLICE HAS DONE.**
  // `EffectOp` `preventHandPlay` + `GameState.handPlayLockedTurn` reach **8 legal
  // printings on 3 printed sentences**, and the three sentences arrive by two
  // different routes:
  //   • the RAW sweep rises on its own for the SIX Item printings, because their
  //     sentences carry no gate clause and the new arms read them whole:
  //     **290 → 292 sentences / 1,117 → 1,123 printings** ("During your
  //     opponent's next turn, they can't play any Item cards from their hand.",
  //     3 legal — Budew `sv08.5-004`, Frillish `sv10.5w-044`/`-126`; and "Discard
  //     all Energy from this Pokémon. " + that sentence, 3 legal — Galvantula ex
  //     `sv07-051`/`-159`/`-168`).
  //   • the SPLIT term rises for the TWO Supporter printings: Scream Tail ex
  //     `sv06-094`/`-197` prints the bar BEHIND D281's gate clause, so the raw
  //     string stays REFUSED and D282's split is what hands the body to the new
  //     anchor. **8 → 10.** 1,123 + 4 + 10 = **1,137**.
  // ⚠️ **AND THE HANDOFF FORECAST THE RAW SWEEP WOULD STAND STILL, ON THE GROUND
  // THAT A RAW MOVE MEANS A READER WAS LOOSENED. IT MOVED, AND NO READER WAS
  // LOOSENED** — every one of the three new anchors is `^…$` and the +6 is six
  // printings of two sentences the handoff never priced, found by re-querying the
  // MECHANISM (a turn-scoped imposed play-lock) instead of the CARD. That is the
  // vocabulary-slice rule paying in the positive direction, and it is why the two
  // terms are measured separately rather than argued about.
  // ⚠️ **THE OTHER TWO GATE SENTENCES STILL CONTRIBUTE ZERO**: Illumise
  // `sv06-010` and Exeggcute `sv08-001`/`-192` remain refused after the split, so
  // the split term is 10 and not 13 — the same guard D282 installed, still live.
  // 🆕 **1,138 AT D285** — THE POKÉMON-SURFACE PLAY GATE, attack half: Bronzong
  // `sv05-069` "Evolution Jammer" (1 legal printing). ✅ **RE-DERIVED BY THE LIVE
  // SWEEP RATHER THAN INCREMENTED BY HAND** (the D274 section below runs the seven
  // readers over the committed corpus at every `bun run check`): raw **292 → 293
  // sentences / 1,123 → 1,124 printings**, +4 registry, +10 split = **1,138**.
  // ⚠️ **THE RAW SWEEP MOVED AND NO READER WAS LOOSENED**: the new anchor is
  // `^…$` and MUTUALLY EXCLUSIVE with `OPPONENT_CANT_PLAY` by construction (that
  // one captures a class word this sentence does not print, and this one carries a
  // trailing "to evolve their Pokémon" rider that one cannot), and the ledger
  // residue held at exactly 2 for the THIRTEENTH slice running.
  // ⚠️ **BOTH NON-REGISTRY COLUMNS MOVE BY EXACTLY ONE PRINTING EACH**, which no
  // slice in this run had done: the mechanism's other half is an ABILITY (Team
  // Rocket's Arbok `sv10-113`) and lands in `BUILT.ability` below. ONE mechanism,
  // TWO columns, and the census cannot see it as one.
  attack: 1138,
  // ⚠️ **100 AT D242** — backlog row 14's first two thirds: Team Rocket's "Power
  // Saver" (6) and Bloodmoon Ursaluna's "Seasoned Skill" (6). ✅ **RE-DERIVED BY
  // THE JOIN RATHER THAN INCREMENTED BY HAND**, this constant's own provenance
  // rule: `programFor(id)` run over all **376 legal ability units** returned by the
  // `json_each(abilities_json)` query at HEAD returns **100**, and the delta is
  // EXACTLY the 12 printings `abilityAttackGate.test.ts` names by id.
  // ⚠️ **AND IT IS THE FIRST MOVE IN THIS COLUMN SINCE D221**, which is why the
  // fraction below stands still while this number jumps: rows 9-16's `inRows` counts
  // ATTACK printings, and this slice bought none.
  // ⚠️ **107 AT D243** — backlog row 14-B(b), the SEAT-WIDE PRE-W/R DAMAGE AURA:
  // Serperior ex "Regal Cheer" (3), Cynthia's Roserade "Cheer On to Glory" (2) and
  // Hop's Snorlax "Extra Helpings" (2). ✅ **RE-DERIVED BY THE JOIN RATHER THAN
  // INCREMENTED BY HAND**: `programFor(id)` run over all **376 legal ability
  // units** returned by the `json_each(abilities_json)` query at HEAD returns
  // **107**, and the delta is EXACTLY the 7 printings `seatDamageAura.test.ts`
  // names by id. Second consecutive slice in this column.
  // ⚠️ **AND IT IS 7 OF 16, NOT 3 OF 9**: the row's own named half (the SIX
  // `Future` printings) is BLOCKED ON THE INGEST rather than on the engine — no
  // column classifies the Ancient/Future banner, re-verified at HEAD by
  // `SELECT suffix, COUNT(*) … GROUP BY 1` returning only NULL and `ex`.
  // ⚠️ **114 AT D244** — backlog row **14-R**, Iron Leaves ex's ON-BENCH SWITCH
  // (`svp-128`/`sv05-025`/`-186`/`-203`/`-213`/`sv08.5-176`, **6**) PLUS the
  // second printed sentence of the same op field, Meowscarada `sv09-018`
  // "Showtime" (**1**). ✅ **RE-DERIVED BY THE JOIN RATHER THAN INCREMENTED BY
  // HAND**: `programFor(id)` run over all **376 legal ability units** returned by
  // the `json_each(abilities_json)` query at HEAD returns **114**, and the delta
  // is EXACTLY the 7 printings `benchSwitchTrigger.test.ts` names by id.
  // **THIRD CONSECUTIVE SLICE IN THIS COLUMN**, which has never happened before.
  // ⚠️ **AND THE 7th IS THE PREDICTION'S LOSS, WRITTEN DOWN**: the resume point
  // predicted **113** because it counted the ROW. The row's six re-derive to the
  // digit (eleventh running); widening the SAME query from the row's ids to the
  // printed PRONOUN ("you may switch it with your Active Pokémon") returns SEVEN
  // legal printings on TWO sentences. 🆕 **A ROW IS A SET OF IDS AND A FIELD IS A
  // SET OF SENTENCES, AND THE SECOND IS THE ONE THAT PREDICTS THE COLUMN.**
  // ⚠️ **120 AT D245** — the aura family's three DEFERRED singles (backlog row
  // 14-B(b)-R: `CardFilter.anyOf`, `typedPokemon.stage: "evolution"`, and the
  // `seatDamageBonusBeforeWR.target` rider) plus the 3 printings of the OTHER
  // sentence that `stage: "evolution"` serves. ✅ **RE-DERIVED BY THE JOIN RATHER
  // THAN INCREMENTED BY HAND**: `programFor(id)` over all **376 legal ability
  // units** (`SELECT c.id FROM cards c, json_each(c.abilities_json) WHERE
  // c.legal_standard = 1`, remote D1 `luminous`, 2026-08-06) returns **120**, and
  // the delta is EXACTLY the 6 this slice's suites name by id.
  // **FOURTH CONSECUTIVE SLICE IN THIS COLUMN**, which has now never happened
  // before twice.
  // ⚠️ **AND THE 3 EXTRA ARE THE PREDICTION'S LOSS AGAIN, IN THE SAME DIRECTION
  // AND ON A DIFFERENT AXIS**: the resume point predicted **117** because it
  // counted the ROW's three ids. Widening `typedPokemon.stage`'s own query from
  // that row's one id to the printed IDIOM (`LIKE '%evolution {%'`) returns
  // **2 sentences / 4 printings**, and the second sentence (Genesect ex "Metallic
  // Signal", 3) is a DECK SEARCH rather than an aura — a different mechanism
  // demanding the same field value. 🆕 **THE WIDENED QUERY IS THE ROW'S, NOT THE
  // FIELD'S, UNTIL YOU RUN IT ON THE FIELD**: D244 widened from ids to a PRONOUN
  // and stayed inside one op; this one widened from ids to a FIELD VALUE and
  // crossed into a different op entirely.
  // ⚠️⚠️ **124 AT D249, AND THE FOUR-SLICE STANDSTILL IN THIS COLUMN IS OVER.**
  // Hydrapple ex "Ripening Charge" (`sv07-014`/`-156`/`-167`/`sv08.5-011`) — the
  // ability half of backlog row 12, ONE registry program, ZERO engine code.
  // ✅ **RE-DERIVED BY THE JOIN RATHER THAN INCREMENTED BY HAND**: `programFor(id)`
  // over all **376 legal ability units** (`SELECT c.id FROM cards c,
  // json_each(c.abilities_json) WHERE c.legal_standard = 1`, remote D1 `luminous`,
  // 2026-08-07 — the unit count is unchanged at 376) returns **124**, and the
  // delta is EXACTLY the 4 printings `ripeningCharge.test.ts` names by id.
  // ✅ **AND THE WIDENING FOUND NOTHING TO ADD, WHICH IS THE FIRST TIME IN FOUR
  // SLICES.** D244 widened to a pronoun and gained 1; D245 widened to a field
  // value and gained 3; D247 and D248 both widened as a CHECK. D249's widening
  // (`LIKE '%if you attached energy to a pok%in this way%'`, all three text
  // columns, GROUPED BY SENTENCE) returned two OTHER sentences and both were
  // false positives — the 8-printing Teal Dance group, BUILT since D221, and a
  // 3-printing DECK-search ATTACK with a status tail. 🆕 **A WIDENING THAT
  // RETURNS ONLY BUILT WORK AND OTHER COLUMNS IS A CONFIRMED ROW COUNT, AND IT
  // IS STILL WORTH THE QUERY** — it is the only thing that can tell a row whose
  // count is right from a row whose count is right by luck.
  // ⚠️⚠️ **126 AT D250, AND THE COLUMN MOVES TWICE RUNNING FOR THE FIRST TIME
  // SINCE D244/D245.** Bloodmoon Ursaluna "Battle-Hardened"
  // (`sv06.5-025`/`sv08.5-054`) — the TRIGGERED-attach third of backlog row 12's
  // ability half, ONE registry program, ZERO engine code, for the SECOND slice
  // running.
  // ✅ **RE-DERIVED BY THE SAME JOIN, NOT INCREMENTED**: `programFor(id)` over the
  // **376 legal ability units** (unchanged; re-run against remote D1 `luminous` on
  // 2026-08-07) returns **126**, and the delta is EXACTLY the 2 printings
  // `battleHardened.test.ts` names by id.
  // ⚠️ **AND THE WIDENING WAS NOISY AT ONE WIDTH AND NOT AT ANOTHER, WHICH IS THE
  // FINDING.** At the width the handoff prescribed (`%when you play this
  // pok%onto your bench%attach%`) it returns ONE other sentence (`sv06-132`, a
  // Pokémon-Tool deck search); dropped to the bare printed opening
  // (`%onto your bench%`) it returns SIX others, two of them already BUILT
  // (D244's Iron Leaves ex switch ×6, M4/D130's Durant ex discard ×3). 🆕 **SO
  // "WIDEN THE ROW'S QUERY" IS A LADDER, NOT A MOVE — the rung you stop on
  // decides whether you are measuring the MECHANISM or the IDIOM**, and a
  // prediction of "noisy" is gradeable against one rung and not the other. Both
  // are recorded rather than the flattering one.
  // ⚠️⚠️ **133 AT D252 — AND THE COLUMN HAS NOW MOVED ON FOUR CONSECUTIVE SLICES.**
  // Carracosta "Mighty Shell" (`sv10.5b-023`/`-107`) — the "prevent all damage
  // FROM AND EFFECTS OF attacks" rule, the half D251 measured and refused to build.
  // ✅ **RE-DERIVED BY THE SAME JOIN, NOT INCREMENTED**: `programFor(id)` over the
  // **376 legal ability units** (unchanged at 376; `SELECT COUNT(*), group_concat(
  // c.id) FROM cards c, json_each(c.abilities_json) a WHERE c.legal_standard = 1`,
  // remote D1 `luminous`, 2026-08-07) returns **133**, and the delta is EXACTLY the
  // 2 printings `mightyShell.test.ts` names by id.
  // ⚠️ **AND THE LADDER'S TOP RUNG NAMED A GROUP THIS SLICE COULD NOT TAKE, WHICH
  // IS THE USEFUL PART.** `%and effects of attacks%` over `abilities_json`, legal
  // only, GROUPED BY SENTENCE returns **9 printings on 4 sentences** — D251's
  // handoff figure to the digit. Of those 4, the biggest (3, `sv08-042`/`-217`/
  // `-237`, "…from your opponent's **Tera** Pokémon") is **UNBUILDABLE FOR D243's
  // REASON, CONFIRMED BY QUERY RATHER THAN ASSUMED**: `SELECT suffix, COUNT(*) FROM
  // cards WHERE legal_standard = 1 GROUP BY suffix` returns exactly two rows,
  // `null` (1,668) and `ex` (353). The Tera banner has no column, and Terapagos ex
  // reads `suffix = 'ex'` like every other ex. **So the "and effects of" family's
  // addressable size is 6, not 9**, and the remaining 4 (a Bench-ZONE-gated 3 and a
  // seat-wide 1) are a measured backlog row rather than this slice's sprawl.
  // ⚠️ 131 at D251; 124 at D249; 120 at D245–D248; 114 at D244; 107 at D243; 100 at
  // D242.
  // ⚠️⚠️ **137 AT D254** — Rabsca `sv05-024` "Spherical Shield", the SEAT-WIDE wide
  // prevention and the LAST printing of the "and effects of attacks" family.
  // ✅ **RE-DERIVED BY THE JOIN RATHER THAN INCREMENTED BY HAND**: `programFor(id)`
  // run over all **376 legal ability units** (`SELECT c.id FROM cards c,
  // json_each(c.abilities_json) a WHERE c.legal_standard = 1` on the remote D1
  // `luminous`, 2026-08-07) returns **137**.
  // 🛑 **AND THE SAME RUN SETTLED D253's ONE UNVERIFIED NUMBER: THE JOIN AT THE
  // PARENT COMMIT RETURNS EXACTLY 136.** D253 could not run it (403/7403 all
  // session) and INCREMENTED 133 → 136 from D252's transcribed row, flagging it in
  // four places rather than taking it quietly. The re-derivation agrees to the
  // digit, all three "Curious Tea Party" ids are in the joined set, and **the
  // re-derivation streak is RESUMED rather than broken** — an increment that later
  // measures true is still not a measurement, which is why the flag was worth
  // carrying for one commit.
  // ⚠️⚠️ **142 AT D255** — the ATTACKER'S PRINTED RULE-BOX CLASS: Sylveon
  // `sv08.5-040` + Crustle `sv10-012`/`-186` ("…from your opponent's Pokémon ex",
  // 3) and Farigiraf ex `sv05-108`/`-194` ("…from your opponent's **Basic** Pokémon
  // ex", 2). TWO printed sentences, ONE parameterised field.
  // ✅ **RE-DERIVED BY THE JOIN AT BOTH ENDS, SECOND SLICE RUNNING**: `programFor(id)`
  // over all **376 legal ability units** (unchanged at 376) returns **137** at the
  // parent commit and **142** here, so the +5 is a difference of two measurements
  // and not an increment.
  // 🛑 **AND THE CENSUS THIS ROW CAME OUT OF LOST ITS OWN PREDICTION IN THE
  // DIRECTION WORTH RECORDING.** The `%prevent all damage%` ladder was predicted to
  // return 25–40 ability printings on 12–20 sentences; it returns **22 on 9**. The
  // missing mass is real and is in a different COLUMN: `attacks_json` holds **34
  // printings on 9 sentences** of the DURATED §11 spelling ("During your opponent's
  // next turn, …"), which is `attackBlockOf` and has no reader on this field, and
  // the Trainer `effect` column holds **1** (Neutralization Zone `sv06.5-060`,
  // built at D159). 🆕 **A PHRASE CENSUS THAT DOES NOT NAME ITS COLUMN IS A CENSUS
  // OF THE PHRASE AND NOT OF THE MECHANISM** — the same fact that makes the
  // false-positive prediction right makes the size prediction wrong.
  // ⚠️ Of the 22, **11 were built coming in** (D251's 5, D253's 3, D252's 2, D254's
  // 1), this slice takes 5, and the residue is 6 on 3 sentences — 3 of which are
  // the permanently unbuildable TERA group. The two open rows are row 15's
  // remaining `abilityIds` and are measured into `coverage-backlog-legal.md`.
  // ⚠️⚠️ **144 AT D256** — the BENCH-WIDE Rule-Box prevention: Shaymin `sv10-010`/
  // `-185` "Flower Curtain", backlog row 15-A, 2 printings on ONE sentence.
  // ✅ **RE-DERIVED BY THE JOIN AT BOTH ENDS, THIRD SLICE RUNNING**: `programFor(id)`
  // over all **376 legal ability units** (unchanged at 376; the id list re-pulled
  // from the remote D1 `luminous` at this commit) returns **142** at the parent
  // commit and **144** here, so the +2 is a difference of two measurements.
  // ✅ **AND THE `%prevent all damage%` LADDER WAS RE-RUN RATHER THAN INHERITED**:
  // 22 printings on 9 sentences in `abilities_json`, UNCHANGED from D255, with this
  // row at 2 — and the narrow `%benched pok%rule box%` query returns the same two
  // ids, which is the difference between confirming a PHRASE and confirming a
  // POPULATION (D255's lesson, applied to its own successor).
  // ⚠️ The residue is now **4 printings on 2 sentences** — the 3-printing TERA group
  // (permanently unbuildable) and Drednaw `sv07-044` (row 15-B), which is also row
  // 15's whole remaining `abilityIds`.
  // ⚠️⚠️ **145 AT D257** — the DAMAGE-THRESHOLD prevention: Drednaw `sv07-044`
  // "Impervious Shell", backlog row 15-B, **1 printing on ONE sentence**, and the
  // LAST buildable member of the `%prevent all damage%` ability column.
  // ✅ **RE-DERIVED BY THE JOIN AT BOTH ENDS, FOURTH SLICE RUNNING**: `programFor(id)`
  // over all **376 legal ability units** (unchanged at 376) returns **144** at the
  // parent commit and **145** here, so the +1 is a difference of two measurements.
  // ✅ **AND THE LADDER WAS RE-RUN RATHER THAN INHERITED**, on ALL THREE text columns
  // reported separately (D255's lesson): `%prevent all damage%` is **ability 22/9,
  // attack 34/9, effect 1/1 — UNCHANGED**; and the row's own `%if that damage is%`
  // returns **ability 1/1** (this id), **attack 3/2** (BUILT at D240) and **effect
  // 0/0**. Swept wider on D239's rule, `%damage is%` minus that phrase returns 18
  // further sentences and EVERY ONE is a false positive.
  // ⚠️ The residue is now **3 printings on 1 sentence** — the TERA group alone, and
  // it is permanently unbuildable (D252's measured reason: the banner is in no
  // ingested column). **Row 15's `abilityIds` is EMPTY and the row is CLOSED.**
  // ⚠️⚠️ **150 AT D258** — the COIN-FLIP defensive Ability: Fezandipiti `sv06-096`/
  // `sv06.5-073`/`sv08.5-045` "Adrena-Pheromone" and Kecleon `sv08-150`/`sv08-213`
  // "Expert Hider", backlog row **15-C**, **5 printings on TWO sentences** — the
  // BIGGEST single step this column has taken since D255, and the row exists at all
  // only because D257 WIDENED THE VERB.
  // ✅ **RE-DERIVED BY THE JOIN AT BOTH ENDS, FIFTH SLICE RUNNING**: `programFor(id)`
  // over all **376 legal ability units** (unchanged at 376) returns **145** at the
  // parent commit `c577863` and **150** here, so the +5 is a difference of two
  // measurements and not an increment.
  // ✅ **AND THE LADDER WAS RE-RUN ON A NEW PHRASE, WHICH IS THE POINT.**
  // `%prevent that damage%` ∪ `%flip a coin%prevent%` over all three text columns
  // returns **ability 5/2 (these five), attack 21/3 (all DURATED §11, built D142),
  // effect 0/0**; a WIDER rung — `%prevent%` ∧ `%coin%` — returns the identical five
  // rows and nothing else, so this row has ZERO false positives at any width.
  // ⚠️ THREE MORE PRINTINGS carry Kecleon's sentence verbatim (`sv02-002`,
  // `sv02-003`, `swsh10.5-057`) and are `legal_standard = 0` — ROTATED OUT rather
  // than unbuildable, a different residue from D257's TERA group.
  // ⚠️ 145 at D257; 144 at D256; 142 at D255; 137 at D254; 136 at D253 (INCREMENTED,
  // since MEASURED); 133 at D252; 131 at D251; 124 at D249; 120 at D245–D248; 114 at
  // D244; 107 at D243; 100 at D242.
  // ⚠️⚠️ **155 AT D259** — the TRAINER-BORNE effect shield, backlog row 15-D
  // (Fraxure `sv06.5-045`/`-077` + Cetitan ex `sv10-065`/`-210`, 4 legal printings
  // on one sentence; Rhyperior `sv07-076`, 1 more on a second). ✅ **RE-DERIVED BY
  // THE 376-UNIT JOIN AT BOTH ENDS AND NOT INCREMENTED**: the join over the 376
  // legal ability units returns **150 at HEAD~1 and 155 at HEAD**, run twice
  // against the same id list with only `registry.ts` swapped. The delta is EXACTLY
  // the 5 this slice's suite drives, on exactly the 2 sentences it names.
  // ⚠️⚠️ **157 AT D260** — the ATTACK-BORNE EFFECTS-ONLY shield, backlog row 15-E
  // and the END of the buildable `%prevent%` ability seam (Skeledirge `sv08-031`
  // "Unaware", 1 legal printing; Team Rocket's Articuno `sv10-051` "Repelling
  // Veil", 1 more on a second sentence). ✅ **RE-DERIVED BY THE 376-UNIT JOIN AT
  // BOTH ENDS AND NOT INCREMENTED**: the join returns **155 at HEAD~1 and 157 at
  // HEAD**, run twice against the same id list with only `registry.ts` swapped
  // (`git checkout HEAD~1 -- packages/engine/src/registry.ts`). The delta is
  // EXACTLY the 2 this slice's suite drives, on exactly the 2 sentences it names.
  // ⚠️⚠️ **164 AT D263** — the ABILITY HALF of backlog row 9, attach from the
  // DISCARD PILE (Archaludon ex `sv08-130`/`-224`/`-241` "Assemble Alloy", 3
  // legal printings on one sentence; Team Rocket's Spidops `sv10-020`/`-187`
  // "Charging Up", 2 more on a second; Eelektrik `sv10.5b-031`/`-114`
  // "Dynamotor", 2 more on a third). ✅ **RE-DERIVED BY THE 376-UNIT JOIN AT BOTH
  // ENDS AND NOT INCREMENTED**: the join over the 376 legal ability units
  // (unchanged at 376; the id list re-pulled from remote D1 `luminous` on
  // 2026-08-07) answers **157 at HEAD and 164 in this tree**, run twice with only
  // `registry.ts` swapped. The delta is EXACTLY the 7 this slice's suite drives,
  // on exactly the 3 sentences it names. 🛑 AND THIS CONSTANT STILL DOES NOT
  // SELF-REDDEN — it is HAND-MAINTAINED, so the order is *measure → edit → red →
  // update*. What DID redden on its own is the row-9 sweep below, by NAME, which
  // is the guard that actually discriminates.
  // ⚠️⚠️ **164 / 57 AT D263** — D264 moved BOTH, and both were **RE-DERIVED BY
  // THE JOIN AT BOTH ENDS RATHER THAN INCREMENTED.** The 391 non-attack registry
  // ids (every key in `registry.ts` whose program carries an
  // `abilities`/`passive`/`triggered`/`stadium`/`energy`/`trainer`/`rareCandy`
  // surface, `fix-*` excluded) joined against remote D1 `luminous` on 2026-08-07
  // with `legal_standard = 1`, grouped by `cards.category`, answer **ability 166,
  // trainer 60, specialEnergy 5**. The deltas are EXACTLY the 2 + 3 this slice's
  // suite drives, on exactly the 2 sentences it names (Arven's Greedent
  // `sv10-159`/`-205`; Lana's Aid `sv06-155`/`-207`/`-219`), so nothing else in
  // the registry moved underneath them. 🛑 **NEITHER CONSTANT SELF-REDDENS — both
  // are HAND-MAINTAINED**, so the order is *measure → edit → red → update*, for
  // the fourth slice running. What DID redden on its own, again by NAME, is the
  // row-13 `authored` sweep below: it fires the moment a listed id gets a
  // program, before any constant here is touched.
  // ⚠️⚠️ **166 / 60 AT D264 — D265 MOVES BOTH, AND BOTH ARE RE-DERIVED BY THE
  // SAME JOIN AT BOTH ENDS RATHER THAN INCREMENTED.** The non-attack registry ids
  // (every key in `registry.ts` whose program carries an
  // `abilities`/`passive`/`triggered`/`stadium`/`energy`/`trainer`/`rareCandy`
  // surface, `fix-*` excluded) go **391 → 396**, joined against remote D1
  // `luminous` on 2026-08-07 with `legal_standard = 1` and grouped by
  // `cards.category`: **166 / 60 / 5** at the parent commit `21b62d7` and
  // **168 / 63 / 5** in this tree. The deltas are EXACTLY the 2 + 3 this slice's
  // suite drives, on exactly the 2 sentences it names (Alomomola `sv10.5b-024`/
  // `-108` "Gentle Fin"; Buddy-Buddy Poffin `sv05-144`/`sv06-223`/`sv08.5-101`),
  // so nothing else in the registry moved underneath them.
  // 🆕 **THE FIRST SLICE WHOSE ROW SPANS TWO OPS RATHER THAN TWO SURFACES**, which
  // is why one union rider moves two columns at once: `basicPokemon.maxHp` is read
  // by `searchDeck` on the Trainer side and by `discardPileRetrieval` on the
  // Ability side, and neither op gained a field.
  // 🛑 **NEITHER CONSTANT SELF-REDDENS — both are HAND-MAINTAINED**, so the order
  // is *measure → edit → red → update*, for the fifth slice running. What DID
  // redden on its own, again by NAME, is the row-13 `authored` sweep below.
  // 🛑🛑 **63 AT D265 — D266 MOVES THE TRAINER COLUMN TO 66, AND THE JOIN COULD
  // ONLY BE RUN AT ONE END. SAY SO RATHER THAN ROUNDING IT UP TO "MEASURED".**
  // The REGISTRY half ran at both ends exactly as the standing order asks: the
  // non-attack registry ids (every `registry.ts` key whose program carries an
  // `abilities`/`passive`/`triggered`/`stadium`/`energy`/`trainer`/`rareCandy`
  // surface, `fix-*` excluded) go **396 → 399**, measured by re-running
  // `programFor` over the extracted keys at the parent commit `abcc20a` and in
  // this tree, and the three added ids are EXACTLY `sv08-167` / `sv08-229` /
  // `sv08-243`. Nothing else in the registry moved underneath them.
  // 🛑 **THE CATALOG HALF COULD NOT BE RE-RUN AT ALL IN THIS CONTAINER.** The
  // remote D1 `luminous` answers `401 Authentication error` and the local
  // miniflare sqlite (`apps/api/.wrangler/…`) does not exist here, so the
  // `legal_standard = 1` / `GROUP BY cards.category` half of the join is
  // INHERITED, not measured. What carries the 63 → 66 is (a) the three ids being
  // one card and its two alternate-art reprints, (b) `legalNonAttackPrograms`'
  // own `legal: 3` for the sentence, which was measured against D1 when the
  // `DROPPED` row was written and is asserted against `ids.length` there, and
  // (c) Clemont's Quick Wit being a SUPPORTER — the `trainer` column, not the
  // `ability` one. ⚠️ **A LATER SLICE WITH CATALOG ACCESS SHOULD RE-DERIVE THIS
  // FIGURE BEFORE BUILDING ON IT.**
  // 🛑 **NEITHER CONSTANT SELF-REDDENS — both are HAND-MAINTAINED**, sixth slice
  // running, so the order is *measure → edit → red → update*.
  // ✅✅ **D267 RE-RAN THE HALF D266 COULD NOT, AND D266's INHERITED NUMBERS HELD
  // EXACTLY.** The remote D1 `luminous` answers again in this container, so the
  // BOTH-ENDS join was re-derived from scratch on 2026-08-07: the 399 non-attack
  // registry ids at the parent commit `34ebc20` (every `registry.ts` key whose
  // program carries an `abilities`/`passive`/`triggered`/`stadium`/`energy`/
  // `trainer`/`rareCandy` surface, `fix-*` excluded), joined with
  // `legal_standard = 1` and `GROUP BY cards.category`, answer **Pokemon 168 /
  // Trainer 66 / Energy 5** — the very figures D266 carried on a REGISTRY-half
  // join plus an argument. The 63 → 66 it could not measure is now MEASURED, and
  // the "a later slice with catalog access should re-derive this" debt is CLOSED.
  // ⚠️ **THE PROVENANCE PARAGRAPH ABOVE IS KEPT RATHER THAN OVERWRITTEN** — how a
  // claim was warranted at the time is the thing this repo keeps losing (D178).
  // 🆕 **D267 MOVES THE ABILITY COLUMN, 168 → 171** (Latias ex "Skyliner"
  // `sv08-076`/`-220`/`-239` — a Pokémon ABILITY, so the `ability` column and not
  // the `trainer` one D266 moved), **RE-DERIVED BY THE SAME JOIN AT BOTH ENDS
  // RATHER THAN INCREMENTED**: the non-attack registry ids go **399 → 402** and
  // the join answers **168 / 66 / 5** at `34ebc20` and **171 / 66 / 5** in this
  // tree. The delta is EXACTLY the 3 this slice's suite drives, on exactly the
  // one sentence it names, so nothing else in the registry moved underneath it.
  // 🛑 **STILL HAND-MAINTAINED, SEVENTH SLICE RUNNING** — *measure → edit → red →
  // update*. What DID redden on its own is the row-13 `authored` sweep below.
  // 🆕 **D268 MOVES IT AGAIN, 171 → 173** (Gothitelle "Distorted Future"
  // `svp-211`/`sv10.5w-043` — a Pokémon ABILITY, so this column and not the
  // `trainer` one), **RE-DERIVED BY THE SAME JOIN AT BOTH ENDS RATHER THAN
  // INCREMENTED**: the non-attack registry ids go **402 → 404** and the join
  // answers **171 / 66 / 5** at `bfbf855` and **173 / 66 / 5** in this tree
  // (remote D1 `luminous`, `legal_standard = 1 AND id IN (…) GROUP BY category`,
  // 2026-08-07). The delta is EXACTLY the 2 this slice's suite drives, on exactly
  // the one sentence it names. 🛑 **HAND-MAINTAINED FOR THE EIGHTH SLICE RUNNING.**
  // 🆕🆕 **D269 MOVES THE `trainer` COLUMN AND LEAVES `ability` ALONE, 66 → 69**
  // — `coinFlipGate.otherwise`, the printed *"If tails, …"*: Picnicker `svp-114`
  // (1) and Drasna `sv08-173`/`-231` (2), both SUPPORTERS. **RE-DERIVED BY THE
  // SAME JOIN AT BOTH ENDS RATHER THAN INCREMENTED**: the non-attack registry ids
  // go **404 → 407** (raw keys 514 → 519, the two `fix-*` demonstrators making up
  // the difference) and the join answers **173 / 66 / 5** at `c00cd70` and
  // **173 / 69 / 5** in this tree (remote D1 `luminous`,
  // `legal_standard = 1 AND id IN (…) GROUP BY category`, 2026-08-07). The delta
  // set was DIFFED rather than counted — `comm` over the two sorted id lists
  // returns exactly `svp-114`, `sv08-173`, `sv08-231` and nothing else — so
  // nothing in the registry moved underneath this slice. 🛑 **AND THIS IS WHY THE
  // ABILITY DECOMPOSITION BELOW GAINS NO TERM**: it decomposes `BUILT.ability`
  // ALONE, `ability` is unchanged at 173, and a twenty-eighth term would break
  // the very tie it exists to hold. Ten slices running had moved that column;
  // this one does not, and the streak breaking is the CORRECT outcome rather than
  // an omission. There is NO decomposition of the `trainer` column anywhere in
  // this file — checked by grep, not assumed — so the 69 is tied only by the
  // derived headline `built` below.
  // 🆕 D270 — **69 → 71, AND `BUILT.ability` STANDS STILL AT 173 FOR THE SECOND
  // SLICE RUNNING.** `HandRefreshDraw.perSeat`: Harlequin `sv10.5w-083`/`-163`,
  // ONE sentence on the SUPPORTER surface. The join ran at BOTH ends and the delta
  // was DIFFED rather than counted — 407 → **409** registry ids (raw keys 519 →
  // 522, the one `fix-*` demonstrator making up the difference), `comm` over the
  // two sorted lists returning exactly `sv10.5w-083` and `sv10.5w-163` and nothing
  // else, and the catalog half **173 / 69 / 5 → 173 / 71 / 5** (remote D1
  // `luminous`, 2026-08-07; both ids re-queried on their own and both are
  // `legal_standard = 1`, `category = Trainer`, `trainer_type = Supporter`).
  // 🛑 **AND THE `trainer` COLUMN STILL HAS NO DECOMPOSITION OF ITS OWN.** D269
  // grepped that and said so; D270 re-grepped it and it is still true, and it is
  // still the honest thing to record rather than to fix in passing: a term list
  // that must SUM to 71 is a claim about thirty slices of attribution, not about
  // this one, and inventing it inside a slice that can only measure its own 2
  // would put an unmeasured constant where a measurement belongs. The 71 is tied
  // by the derived `built` headline and by the non-attack decomposition below.
  // 🆕 D272 — **173 → 176, THE FIRST ABILITY-COLUMN MOVE IN FOUR SLICES**, and it
  // wants the TWENTY-EIGHTH term below. Fezandipiti ex `sv06.5-038`/`-084`/`-092`
  // "Flip the Script": ONE printed sentence, THREE printings, ONE byte-identical
  // `abilities_json`. ✅ **RE-DERIVED BY THE JOIN AT BOTH ENDS AND NOT
  // INCREMENTED**: 412 → **415** registry ids (`comm -13` over the two sorted
  // lists returns exactly `sv06.5-038`, `sv06.5-084` and `sv06.5-092`, and
  // `comm -23` returns NOTHING, so the delta is an addition and not a swap), and
  // the D1 `GROUP BY category` over the 415 at `legal_standard = 1` returns
  // Pokemon **176** / Trainer **74** / Energy **5**. ⚠️ Both census scans printed
  // their LAST raw key (`fix-experthider`, a `fix-*` id at the very end of the
  // table) as the upper-bound check D271's truncated regex made mandatory.
  // 🆕 D273 — **176 → 181, THE BIGGEST ABILITY STEP SINCE D263**, and the FIRST
  // bump in this file's history that a GUARD demanded rather than a human
  // remembered. Pecharunt ex `sv06.5-039`/`-085`/`-093`/`-095`/`sv08.5-163`
  // "Subjugating Chains": ONE printed sentence, FIVE printings, ONE byte-identical
  // `abilities_json`. ✅ **RE-DERIVED BY THE JOIN AND NOT INCREMENTED**: the five
  // ids were re-queried on their own (remote D1 `luminous`, 2026-08-07) and all
  // five are `legal_standard = 1`, `category = 'Pokemon'`, `types_json =
  // ["Darkness"]`, `name = 'Pecharunt ex'` — which is also the evidence behind the
  // `targetType`/`exceptNamed` riders, since a rider narrowing to a type the
  // catalog does not print would be an arm no board can reach. The pool goes
  // 415 → **420** and the partition below moves with it, id by id.
  // 🆕 D275 — **181 → 183.** Fan Rotom `sv07-118`/`sv08.5-085` "Fan Call": ONE
  // printed sentence, TWO printings, ONE byte-identical `abilities_json`, and the
  // LAST row on the `%You can't use more than 1%` name-lock sweep (that ladder's
  // ten legal printings are now 5 + 3 + 2, all built). ✅ **RE-DERIVED BY THE
  // PARTITION AND NOT INCREMENTED** — the guard below went red on the two new
  // registry rows before this number was touched, which is the whole point of
  // D273's shape: both ids were re-queried on their own (remote D1 `luminous`,
  // 2026-08-08) and both are `legal_standard = 1`, `category = 'Pokemon'`,
  // `types_json = ["Colorless"]`, `hp = 70`, `name = 'Fan Rotom'` — the evidence
  // behind the `pokemonType` on the filter. Pool 420 → **422**.
  // 🆕 D278 — **186 → 189**, Eevee "Boosted Evolution" `sv08-143`/`sv08.5-074`/
  // `svp-173`: ONE printed sentence, THREE printings, ONE byte-identical
  // `abilities_json`. ✅ **RE-DERIVED AT BOTH ENDS AND NOT INCREMENTED**: all
  // three ids were re-queried on their own (remote D1 `luminous`, 2026-08-08)
  // and all three answer `legal_standard = 1`, `category = 'Pokemon'` — which is
  // what puts them in `CENSUS_POKEMON_LEGAL` rather than in `CENSUS_NOT_LEGAL`,
  // and the partition guard below is what made that a decision rather than an
  // assumption (it named exactly these three as unclassified before this line
  // moved). Pool 422 → **425**.
  // 🆕 D281 — **193 → 206**, the biggest single step this column has ever taken,
  // and the ONLY reason it moves is the pool predicate: the 13 per-attack-index
  // gate printings carry a non-attack `CardProgram` key and no Ability at all.
  // ✅ **RE-DERIVED, NOT INCREMENTED** — all 13 ids were re-queried on their own
  // (remote D1 `luminous`, 2026-08-08, `GROUP BY category || ':' || legal_standard`)
  // and all 13 answer `Pokemon:1` in one bucket, which is what puts them in
  // `CENSUS_POKEMON_LEGAL`; the partition guard named exactly these 13 as
  // unclassified before this line moved. Pool 433 → **446**.
  // 🆕 **210 AT D284** — the CONTINUOUS BAR ON THE PLAY
  // (`PassiveEffects.preventOpponentHandPlay`): Tyranitar `sv09-095` "Daunting
  // Gaze" (1) and Jellicent ex `sv10.5w-045`/`-160`/`-168` "Oceanic Curse" (3).
  // ✅ **NOT INCREMENTED BY HAND — the partition guard below NAMED all four as
  // unclassified the moment the registry rows landed**, which is D273's whole
  // design working: this constant is now read off a measurement rather than
  // maintained ahead of one. ⚠️ **AND IT IS 4 OF A 7-PRINTING CENSUS**, the
  // vocabulary-slice rule in the SUBTRACTIVE direction — the other three sentences
  // reach a Stadium branch, a Pokémon-play surface and an ACE SPEC classifier
  // that this vocabulary has no spelling for, each named on the field itself.
  // ⚠️ FIRST MOVE IN THIS COLUMN SINCE D281, and `BUILT.attack` stands still at
  // 1137 for the inverse of D283's reason: every printing here is an ABILITY, so
  // this slice authors ZERO attack anchors and takes a PROSE-ONLY effects.ts diff
  // on the attack surface.
  // 🆕 **211 AT D285** — the same mechanism's ABILITY half: Team Rocket's Arbok
  // `sv10-113` "Potent Glare" (1 legal printing), the THIRTY-SEVENTH term of the
  // decomposition below. ⚠️ **THE POPULATION OF THE WHOLE POKÉMON-SURFACE BAR IS
  // 2 AND BOTH ARE BUILT** — re-measured against the remote D1 on 2026-08-08, so
  // this is the first row in the hand-play family to ship EXHAUSTIVE rather than
  // partial. SECOND consecutive move in this column, after eleven still slices.
  // 🆕 **212 AT D287** — the LAST Trainer-surface row of D284's 7-sentence census:
  // Copperajah `sv06.5-042` "Massive Body" (1 legal printing, and the only row in
  // the catalog at any legality), the THIRTY-EIGHTH term of the decomposition
  // below. ✅ **NOT INCREMENTED BY HAND — the partition guard NAMED `sv06.5-042`
  // as unclassified the moment the registry row landed**, and `raw.length` went
  // red at 568, BOTH observed before either line was touched. THIRD consecutive
  // move in this column. ⚠️ **`BUILT.attack` STANDS STILL AT 1138** for D284's
  // reason exactly: the printing is an ABILITY and no printed ATTACK can name a
  // Stadium bar at all (measured — `attacks_json` 0), so this slice authors ZERO
  // attack anchors. ⚠️ **AND D284's 7-ROW CENSUS IS NOW 6 BUILT / 1 REFUSED**,
  // with the survivor (Genesect `sv06.5-040`) refused on a RARITY axis that
  // `HandPlayClass` cannot reach at any width — the union is now EXACTLY
  // `Card.trainerType`, so there is no fifth member left to add.
  // 🆕 **215 AT D294 — THE CROSS-SEAT DESTINATION**: Mandibuzz `sv10.5w-064`/
  // `-145` "Look for Prey" (**2 legal printings on ONE byte-identical sentence**,
  // the whole legal population — remote D1 `luminous`, 2026-08-08). ✅ **THE
  // COLUMN DID NOT MOVE ON A CLAIM**: the partition above named exactly these two
  // ids as unclassified BEFORE this constant was touched, which is the order
  // D284's guard exists to force. ⚠️ **`BUILT.attack` DELIBERATELY STANDS STILL AT
  // 1138 AND THE SPLIT TERM AT 10**: the handoff forecast this row would move both
  // (Illumise `sv06-010`'s gate 10 → 11), and Illumise is REFUSED — its body needs
  // an op that unmakes an IN-PLAY body, which no op in this engine does. **The two
  // cards were grouped because they share the words "your opponent's" and for no
  // other reason.** ⚠️ **AND THE SAME MECHANISM'S ATTACK HALF IS ALSO REFUSED**
  // (Lickitung `sv05-124`/`-180`, on a COUNT), so unlike D285 this is ONE
  // mechanism moving exactly ONE column.
  ability: 215,
  // 🆕 D271 — **71 → 74, THE BIGGEST TRAINER STEP SINCE D267, AND `BUILT.ability`
  // STANDS STILL AT 173 FOR THE THIRD SLICE RUNNING** (so the per-sentence
  // ability decomposition below still wants no twenty-eighth term). The
  // last-turn-KO play gate `yourPokemonKoedOnOpponentsLastTurn`: Unfair Stamp
  // `sv06-165` (Item) 1 + Hassel `sv06-151`/`-205` (Supporter) 2 — ONE printed
  // sentence, THREE printings, TWO unrelated second halves. ✅ **RE-DERIVED BY
  // THE JOIN AT BOTH ENDS AND NOT INCREMENTED**: 409 → **412** registry ids
  // (`comm -13` over the two sorted lists returns exactly `sv06-151`, `sv06-165`
  // and `sv06-205` and nothing else), and the D1 `GROUP BY category` over the 412
  // at `legal_standard = 1` returns Pokemon **173** / Trainer **74** / Energy
  // **5**. Hand-maintained and therefore unable to self-redden — moved
  // measure → edit → update.
  // 🆕 D280 — **74 → 75, THE TRAINER COLUMN'S FIRST MOVE IN NINE SLICES** (D271
  // was the last; D272–D279 were five `ability` steps and three standstills), and
  // it is ONE printing: Call Bell `sv08-165` (Item), the `BoardCondition`
  // combinator's only consumer. 🛑 **THE ABILITY COLUMN STANDS STILL AT 193**, so
  // the per-sentence ability decomposition below wants **NO THIRTY-FOURTH TERM** —
  // a slice that moves the VOCABULARY need not move that list, and D279's handoff
  // predicted a 34th term on the assumption that it would. ✅ **FORCED RATHER
  // THAN REMEMBERED, THE FIFTH CONSECUTIVE SLICE**: the partition guard at the
  // foot of this file named exactly `sv08-165` as unclassified, and `raw.length`
  // went red at 549 (547 → 549: the printing plus its `fix-callbell`
  // demonstrator), BOTH observed before either line was touched. **TWO red places
  // in this file and THREE constants actually wrong** (`547`, `432` and the
  // trainer column's own size, the last reached only after `547` was fixed) —
  // plus a THIRD red place in a DIFFERENT file, `revealClause.test.ts`'s
  // `FIXTURE_POOL` search sweep, which no prior slice's forecast has ever named.
  // 🆕 D295 — **75 → 76, THE TRAINER COLUMN'S SECOND MOVE IN FIFTEEN SLICES**
  // (D280's Call Bell was the last), and it is ONE printing: Chill Teaser Toy
  // `sv08-166` (Item) — *"Put an Energy attached to 1 of your opponent's Pokémon
  // into their hand."* **THE `BoardCondition` COMBINATOR'S SECOND CONSUMER**, and
  // it needed no widening: the gate is Call Bell's `allOf[youGoSecond,
  // yourFirstTurn]` byte for byte, so the whole slice is the BODY.
  // 🛑 **`BUILT.ability` STANDS STILL AT 215 AND `BUILT.attack` AT 1138, AND THE
  // SPLIT TERM AT 10 FOR THE SECOND COMMIT RUNNING.** The handoff forecast this
  // slice would move the split term 10 → 11 through Illumise `sv06-010`; Illumise
  // is REFUSED (an op that unmakes an IN-PLAY body — see LOOK_FOR_PREY's doc and
  // lookForPrey.test.ts §7), so **THE PREDICTION'S PREMISE FAILED AND THE
  // CONTINGENCY WAS HONOURED**: the row that shipped is the one the vocabulary
  // reached. ⚠️ **AND THE "CROSS-SEAT ZONE" GROUPING WAS WRONG ABOUT THIS CARD** —
  // `discardEnergy` already resolves every zone it writes against the VICTIM, so
  // `to: "hand"` is a ZONE widening and crosses no seat at all.
  trainer: 76,
  // ⚠️⚠️ **4 AT D261** — the SPECIAL ENERGY column's two cheapest remaining rows
  // (Mist Energy `sv05-161`, the effects-only shield borne by an Energy; Enriching
  // Energy `sv08-191`, draw 4 on attach). ✅ **RE-DERIVED BY THE 11-UNIT JOIN AT
  // BOTH ENDS AND NOT INCREMENTED**: the join over the eleven legal ids returned by
  // `legal_standard=1 AND effect<>'' AND category='Energy'` (remote D1 `luminous`,
  // 2026-08-07) answers **2 at HEAD and 4 in this tree**, run twice with only
  // `registry.ts` swapped (`git checkout HEAD -- packages/engine/src/registry.ts`).
  // The delta is EXACTLY the 2 this slice's suite drives, on exactly the 2
  // sentences it names, and the built ids are `sv09-159`, `sv09-190`, `sv05-161`,
  // `sv08-191`. ⚠️ The population is **11 and not 8** because the census column
  // splits by `cards.category`: 8 Special Energy plus 3 BASIC energy carrying
  // effect text.
  // 🆕 D262 — **4 → 5, RE-DERIVED AT BOTH ENDS BY THE SAME 11-ID JOIN AND NOT
  // INCREMENTED.** `programFor` answered on 4 of the 11 at HEAD (`sv05-161`,
  // `sv08-191`, `sv09-159`, `sv09-190`) and on 5 after (`sv05-162` joins them),
  // with `registry.ts` swapped between the two runs. 🛑 AND THIS CONSTANT DID NOT
  // GO RED ON ITS OWN — it is HAND-MAINTAINED, exactly as D261's third loss
  // recorded, so the order is *measure → edit → red → update* and a slice that
  // skips the measurement sails past. The derived headline below is what actually
  // moves once this line does.
  specialEnergy: 5,
} as const;

/** A sentence the readers DO resolve — the attribution control. Without it,
    "every family sentence is refused" would pass just as happily on a broken
    import, which is the exact shape of vacuous guard D214 was written about. */
const DERIVABLE_CONTROL = "Draw a card.";

/** The seven exported readers, run as one. D187 ran six; `deriveAttackDamageSuppression`
    (D192) is the seventh and is part of the built set. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
];

function resolvedByAnyReader(text: string): boolean {
  return READERS.some((read) => read(text) !== null);
}

/** One backlog row. `attack` is the printed ATTACK-column sentences with their
    legal printing counts; `abilityIds` / `effectIds` are the UNBUILT ids in the
    other two columns (each one a card the reader can never reach — an Ability or
    a Trainer is a hand-authored registry row, forever).

    ⚠️ `pattern` is the JS translation of the row's D1 `GLOB`, and the ORDER of
    this array is the CASE chain that produced the counts: a sentence belongs to
    the FIRST family that claims it. Both facts are asserted below, because a row
    whose predicate cannot be re-run is exactly the defect this file closes. */
interface BacklogRow {
  readonly row: number;
  readonly name: string;
  readonly pattern: RegExp;
  readonly attack: readonly (readonly [number, string])[];
  readonly abilityIds: readonly string[];
  readonly effectIds: readonly string[];
}

/** ⚠️ IN CASE-CHAIN ORDER, NOT IN ROW ORDER — this is the order the D1 query's
    `CASE … WHEN` used, and re-ordering it silently re-assigns overlapping
    sentences. The doc's row numbers ride along in `row`. */
const ROWS: readonly BacklogRow[] = [
  {
    row: 10,
    name: "deck-search that ATTACHES (attachFromDeck)",
    pattern: /[Ss]earch your deck for.*Energy card.*attach/,
    // ⚠️⚠️ D235 TOOK THE ATTACK HALF OF THIS ROW AND THE COUNT MOVED **28 → 8**.
    // Twelve of the seventeen printed sentences (20 of the 28 legal printings)
    // are now read by ONE anchor plus one optional trailing group, and are gone
    // from this table by construction: the sweep above fails BY NAME on any
    // sentence a reader resolves.
    //
    // ⚠️ AND THIS ROW IS THE ONE WHOSE **WHOLE** COUNT RE-DERIVED, not just the
    // attack half — 28 · 4 · 1 came back 28 · 4 · 1, with the ability and Trainer
    // halves reproduced as (5 − `sv10-136`) and (5 − the four-printing Janine
    // sentence). Two rows running; D233's instruction has now paid twice.
    //
    // ⚠️ THE FIVE LEFT ARE FOUR DIFFERENT BLOCKERS and TWO OF THEM WERE NOT
    // PRICED BY THE ROW — see `derivedDeckSearchAttach.test.ts`'s `UNREAD`. The
    // row named a Future/Tera subgroup rider and an "of different types" filter;
    // it did not name the batch-onto-ONE-body gap (`attachFromDeck` has no
    // `attachEnergyFrom.count`) or the second printed noun.
    attack: [
      [
        2,
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      ],
      [
        2,
        "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
      ],
      [
        2,
        "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
      ],
      [
        1,
        "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
      ],
      [
        1,
        "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
      ],
    ],
    abilityIds: ["sv10-003", "sv10-145", "sv10-206", "sv10-228"],
    effectIds: ["sv10.5b-081"],
  },
  {
    row: 9,
    name: "attach from the DISCARD PILE (attachEnergyFrom, source side)",
    pattern: /[Aa]ttach.*Energy card.*from your.*discard pile/,
    // ⚠️⚠️ D234 TOOK THE ATTACK HALF OF THIS ROW AND THE COUNT MOVED **17 → 5**.
    // Eight of the twelve printed sentences (12 of the 17 legal printings) are
    // now read by ONE anchor and are gone from this table by construction: the
    // sweep above fails BY NAME on any sentence a reader resolves, so leaving
    // them here is not an option and forgetting to move the doc's number is the
    // only thing that can go quietly. The four left are FOUR DIFFERENT BLOCKERS,
    // not a widening of that anchor — see `derivedDiscardAttach.test.ts`'s
    // `UNREAD`, where each is pinned with the reason it is out of reach.
    //
    // ⚠️ THE ABILITY AND TRAINER IDS DID **NOT** MOVE, and that is the row's real
    // shape rather than an oversight: an Ability or a Trainer is a hand-authored
    // registry row forever, so an anchor buys none of them. 12 + 5 = the 17
    // non-attack printings this row still owes.
    // ⚠️ D246 — **5 → 4**, and this arm did not gain a line to do it. Landorus
    // `sv08-110`'s bare noun ("an Energy card") was the row's second entry; the
    // field that lifted it (`attachEnergyFrom.anyEnergy`) was built for the HAND
    // side and reached this zone because both share ONE clause. 🆕 **A WIDENED
    // NOUN TRANSFERS ACROSS EVERY ZONE THE FACTORY SERVES**, which is the converse
    // of D236's finding that a widened ZONE transfers the anchor and not the
    // family — and it is why a slice can move a row it never opened.
    // ⚠️ D248 — **4 → 2**, AND THIS ARM DID NOT GAIN A LINE TO DO IT EITHER.
    // Mudsdale's spread ("…to **each of** your Benched Pokémon", 2 legal) was the
    // row's first entry, and the anchor had been MATCHING it since D234: the
    // destination is a `([^.]+)` capture, so what was missing was a
    // `DISCARD_ATTACH_DESTINATIONS` KEY, not a regex. 🆕 **A ROW THAT LOOKS LIKE
    // A MISSING ARM CAN BE A MISSING MAP KEY** — and it is the SECOND consecutive
    // slice to move this row with the anchor byte-identical.
    attack: [
      [
        1,
        "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      ],
      [
        1,
        "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
      ],
    ],
    abilityIds: [
      // ⚠️⚠️ D263 TOOK THE ABILITY HALF AND THE LIST MOVED **12 → 5**, WHICH IS
      // THE FIRST TIME THIS ROW'S ABILITY IDS HAVE MOVED AT ALL. D234's note
      // above says "an Ability or a Trainer is a hand-authored registry row
      // forever, so an anchor buys none of them" — TRUE, and the point: these
      // came off by being AUTHORED, three registry objects and no engine line,
      // not by widening the attack anchor. 7 of the 12 in one slice:
      //   • Archaludon ex `sv08-130`/`-224`/`-241` "Assemble Alloy"  (3)
      //   • Team Rocket's Spidops `sv10-020`/`-187` "Charging Up"    (2)
      //   • Eelektrik `sv10.5b-031`/`-114` "Dynamotor"               (2)
      // 🛑 THE 5 THAT REMAIN ARE **TWO SENTENCES, TWO SEAMS**, priced against the
      // code rather than against the cell:
      //   • Magneton (3) — "If you use this Ability, this Pokémon is Knocked
      //     Out." NO op in this engine knocks out its own host; grepped.
      //   • Lycanroc (2) — "up to 2 **Spiky Energy** cards", a card named by
      //     NAME. `attachEnergyFrom` narrows by `energyType`/`anyEnergy` only,
      //     and D246 refused this op a `CardFilter` for a measured reason.
      "svp-153",
      "svp-159",
      "sv08-059",
      "sv09-085",
      "sv09-166",
    ],
    effectIds: ["sv05-158", "sv06.5-063", "sv06.5-097", "sv07-135", "sv08.5-110"],
  },
  {
    row: 11,
    name: "look at the top N (lookAtTopN)",
    pattern: /[Ll]ook at the top/,
    // ⚠️⚠️ D241 TOOK THE BULK OF THIS ROW AND THE COUNT MOVED **15 → 5**. The
    // census re-derived to the digit for the EIGHTH row running — the row's own
    // inherited figure of `15 (7 sentences)` is exactly what the query returned
    // (3·3·3·2·2·1·1) — and then three anchors read 10 of the 15, on 4 of the 7:
    //   • "…attach any number of Energy cards you find there…"  3  (attachFromTop)
    //   • "…You may put any number of Pokémon … onto your Bench." 4 (2 sentences)
    //   • "Look at the top card of your deck. You may discard that card." 3
    // 🛑 THE FIVE LEFT ARE ONE MECHANISM, NOT FIVE: an ORDERED answer ("put them
    // back in any order", 4) and a second seat's deck under a "you may" (1).
    // Every prompt this engine has answers with a SET, so the residue is a
    // measured backlog row rather than an approximation.
    attack: [
      [3, "Look at the top 5 cards of your opponent's deck and put them back in any order."],
      [1, "Look at the top 4 cards of your deck and put them back in any order."],
      [
        1,
        "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck.",
      ],
    ],
    abilityIds: ["svp-090", "sv05-114", "sv06-072", "sv06-129", "sv08.5-072"],
    effectIds: [
      "sv05-147",
      "sv05-200",
      "sv06-143",
      // 🆕 D271 REMOVED `sv06-151`/`sv06-205` (Hassel) FROM THIS LIST, AND THE
      // REASON IS NOT A `lookAtTopN` CHANGE. Its second half — *"Look at the top
      // 8 cards of your deck and put up to 3 of them into your hand. Shuffle the
      // other cards back into your deck."* — was expressible the day D241 landed
      // the op; what blocked it was its FIRST sentence, the play gate *"only if
      // any of your Pokémon were Knocked Out during your opponent's last turn"*.
      // So this row's residue was never 13 sentences of `lookAtTopN` work: 2 of
      // the 13 were waiting on a `GameState` field in a different row entirely.
      // ⚠️ THE LESSON FOR THIS TABLE: an id sits in an `effectIds` list under the
      // row its BIGGEST clause names, but the clause that actually blocks it can
      // belong to another row — so a row's count is an upper bound on its own
      // work, not a description of it.
      "sv08-171",
      "sv08-174",
      "sv08-232",
      "sv08-244",
      "sv08.5-102",
      "sv08.5-107",
      "sv08.5-127",
      "sv08.5-172",
    ],
  },
  {
    row: 13,
    name: "the discard pile into the hand or onto the Bench (discardPileRetrieval)",
    pattern: /[Pp]ut.*from your discard pile/,
    // ⚠️⚠️ D237 TOOK THE ATTACK HALF OF THIS ROW AND THE COUNT MOVED **16 → 6**.
    // Five of the eight printed sentences (10 of the 16 legal printings) are now
    // read by ONE anchor and are gone from this table by construction: the sweep
    // above fails BY NAME on any sentence a reader resolves.
    //
    // ⚠️ AND ITS WHOLE COUNT RE-DERIVED — 16 (8) · 4 · 3 came back 16 (8) · 4 ·
    // (8 − 5 authored). **FOUR ROWS RUNNING**; D233's instruction has now paid
    // four times, which is the strongest evidence on that page that the method
    // rather than the luck is what fixed the counts.
    //
    // ⚠️⚠️ **D238 TOOK THE BRACE CODE AND THE COUNT MOVED 6 → 2** — one sentence
    // and ONE blocker, the smallest residue any row on this page has ever had,
    // and it is not a noun at all. What is left belongs to a DIFFERENT READER
    // (`deriveAttackCoinFlip`) and to `attack.ts`'s unanswered per-heads FOLD
    // question, so no further work on this anchor can reach it. **The row's whole
    // count re-derived a SECOND time, by a second slice, unchanged.**
    attack: [
      [
        2,
        "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.",
      ],
    ],
    // ⚠️⚠️ **D264 TOOK THE ABILITY AND TRAINER HALVES AND THE NON-ATTACK RESIDUE
    // MOVED 7 → 2.** Both were swept for the first time (D237/D238 read the
    // ATTACK half only), and both fell to `CardFilter` RIDERS rather than to arms:
    // Arven's Greedent `sv10-159`/`-205` (`byName` + `cardNoun`, on D250's
    // `onEvolve` trigger) and Lana's Aid `sv06-155`/`-207`/`-219` (`anyOf` over
    // `anyPokemon.noRuleBox` + `basicEnergy`). **5 legal printings on 2 sentences
    // for ZERO new ops, ZERO new op fields and ZERO deriver arms.**
    //
    // 🛑 **THE ROW'S WHOLE COUNT RE-DERIVED A THIRD TIME, BY A THIRD SLICE — AND
    // THIS ONE WAS THE FIRST TO RE-DERIVE THE NON-ATTACK TERMS.** D237 called the
    // ability half "4 RAW" and the Trainer half "8 minus the 5 already authored";
    // re-measured at HEAD against remote D1 (2026-08-07, all three text columns,
    // `json_each`, grouped by `json_extract(value,'$.effect')`), the discard-pile
    // zone returns **ability 23 printings / 11 sentences, effect 23 / 16, attack
    // 52 / 30** — and of those, the row's own verb leaves exactly these seven
    // unbuilt ids. Both halves were exact.
    //
    // ⚠️⚠️ **D265 TOOK THE LAST SENTENCE AND THE NON-ATTACK RESIDUE IS NOW ZERO.**
    // D264 left this cell reading *"WHAT IS LEFT IS ONE SENTENCE AND ONE BLOCKER,
    // AND IT IS NOT A NOUN. Alomomola's 'a Basic Pokémon with 70 HP or less' needs
    // an HP-THRESHOLD rider — a CARD read of printed HP, which `CardFilter` has no
    // member for at any width."* That is exactly what shipped: `basicPokemon.maxHp`,
    // one optional rider, one `matchesFilter` conjunct, one `retrieveNoun` phrase.
    // **The row's whole count re-derived a FOURTH time, by a fourth slice, and the
    // non-attack half is EMPTY** — what remains of row 13 is the single ATTACK
    // sentence above, whose blocker is `deriveAttackCoinFlip`'s per-heads fold and
    // is unreachable from this anchor.
    // 🛑 **THE SAME RIDER PAID OUT IN A ROW THIS ONE DOES NOT OWN.** Buddy-Buddy
    // Poffin `sv05-144`/`sv06-223`/`sv08.5-101` (3 legal) prints the identical noun
    // on `searchDeck` — the DECK-search family, not this zone — so the rider's real
    // yield is 5 printings across TWO rows and TWO ops. A per-row count cannot see
    // that, which is the argument for pricing a VOCABULARY separately from a row.
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 16,
    name: 'copy an attack ("…and use it as this attack")',
    pattern: /use it as this attack/,
    attack: [
      [4, "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack."],
      [3, "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."],
      [
        3,
        "Reveal the top 10 cards of your opponent's deck. You may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the revealed cards into your opponent's deck.",
      ],
      [1, "Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack."],
      [
        1,
        "Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
      ],
      [
        1,
        "Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
      ],
    ],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 0,
    name: "evolve out of the DECK — NOT a backlog row, see the doc's blocked table",
    pattern: /deck for a card that evolves/,
    attack: [
      [
        4,
        "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.",
      ],
      [
        4,
        "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
      ],
      [
        2,
        "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
      ],
      [
        2,
        "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.",
      ],
      [
        1,
        "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.",
      ],
    ],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 15,
    name: "prevent all damage by ATTACKER CLASS (preventDamage.fromClass)",
    pattern: /[Pp]revent all damage.*by attacks from/,
    attack: [
      // ⚠️ D239 read the 7-printing Terapagos ex sentence that headed this list
      // ("…from Basic non-{C} Pokémon."), so it is GONE from here rather than
      // annotated — this array is the UNBUILT set. The two that remain are each
      // refused by a SUPPLY-SIDE ABSENCE and not by an unwritten arm.
      [
        1,
        "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.",
      ],
      [
        1,
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      ],
    ],
    // ⚠️⚠️ D255 TOOK FIVE OF THE EIGHT ABILITY IDS AND THE COUNT MOVED **8 → 3**.
    // Sylveon `sv08.5-040` + Crustle `sv10-012`/`-186` ("…from your opponent's
    // Pokémon ex", 3) and Farigiraf ex `sv05-108`/`-194` ("…from your opponent's
    // **Basic** Pokémon ex", 2) are GONE from here rather than annotated, because
    // this array is the UNBUILT set — D239's rule on the attack half of this same
    // row, applied to its ability half.
    // 🆕 **THE ROW'S NAME IS NOW HALF WRONG AND IS LEFT STANDING ON PURPOSE.**
    // "(preventDamage.fromClass)" names the §11 ATTACK op; the ability half of the
    // row is `PassiveEffects.preventDamageFromAttackerClasses`, a continuous aura
    // that shares the row's PATTERN and none of its mechanism. Renaming it would
    // make the diff against D233's original census unreadable, and the split is the
    // row's real finding: ONE printed phrase, TWO mechanisms, and the ladder that
    // separates them is transcribed in `preventedAttackerClass.test.ts`.
    // ⚠️⚠️ **D256 TAKES TWO OF THE THREE, AND THE ROW GOES 3 → 1.** `sv10-010`/`-185`
    // ("Flower Curtain") were the BENCH-WIDE target rule with a Rule-Box filter, and
    // they are now `benchShieldedFromDamage`'s third field — the scan's widening
    // predicted by this comment, built exactly as it was priced (a `hasRuleBox`
    // negation on the TARGET, no holder aura, no new read site).
    // ✅✅ **D257 TAKES THE LAST ONE AND THE ROW CLOSES — `abilityIds` IS EMPTY.**
    // `sv07-044` wanted a DAMAGE-THRESHOLD conjunct ("if that damage is 200 or
    // more" — the always-on twin of `AttackBlock.maxDamage`, inverted) and it is
    // now `passivesOf.preventDamageAtOrAbove`, a NUMBER folded with `Math.min` and
    // read at all four damage arms through `preventedByDamageThreshold`.
    // ⚠️ AN EMPTY LIST IS A WEAKER GUARD THAN A POPULATED ONE, AND THAT IS WORTH
    // SAYING RATHER THAN LEAVING TO BE NOTICED: this row can no longer go red by a
    // build landing, only by the census moving. What still guards the row is the
    // `attackIds` half above it and the decomposition below, whose D257 term names
    // this id explicitly. See `imperviousShell.test.ts`.
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 12,
    name: "attach from the HAND (attachEnergyFrom, hand side)",
    pattern: /ttach.*Energy card.*from your hand/,
    // ⚠️⚠️ D236 TOOK THE ATTACK HALF OF THIS ROW AND THE COUNT MOVED **16 → 7**.
    // Four of the eight printed sentences (9 of the 16 legal printings) now derive
    // off D234's anchor with the SOURCE ZONE as a factory argument, plus one new
    // op field for the heal tail. The four left are FOUR blockers and none of them
    // is a destination — see `derivedHandAttach.test.ts`, and the doc's residue
    // row. 🆕 The finding this row paid for is that **the ratio did NOT transfer
    // with the anchor**: the same shape read 12 of 17 one zone over and 9 of 16
    // here, because the hand side prints leading clauses and unbounded counts that
    // the discard side never prints.
    // ⚠️⚠️ D246 TOOK TWO MORE AND THE COUNT MOVED **7 → 5**. Both were single
    // legal printings and both `needs` cells were RIGHT — the first time on this
    // page that two cells in one slice named the right piece at the right grain.
    // Snorlax `sv06-136` wanted an `anyEnergy` rider and got one; Kilowattrel ex
    // `sv08-068` wanted nothing but its own arm, and its "EVERY OP IT NEEDS
    // EXISTS" survived being checked FIELD BY FIELD rather than by name.
    // 🆕 What is left of this row is now a SINGLE blocker — an UNBOUNDED count —
    // where it was four; the residue stopped being a list of unrelated gaps.
    // ⚠️⚠️ D247 TOOK THE ROW'S LARGEST SENTENCE AND THE COUNT MOVED **5 → 1**.
    // Alolan Exeggutor ex's *"You may attach **any number** of Basic Energy cards
    // from your hand to your Pokémon in any way you like."* (4 legal) is BUILT, by
    // a NEW OP (`attachFromHand`) rather than by a rider — the row's `needs` cell
    // had the blocker right (the unbounded count) and the remedy wrong (it said
    // "`attachFromTop.max` expresses it one op over"; the shape that was portable
    // was the compound `attachCards` PARK, and the axis was the source ZONE).
    // 🆕 What is left of this row is ONE printing and it is the two-mechanism
    // outlier — an unbounded count AND an ORDERING clause no reader can honour.
    // The row is one printing from empty and that printing is the expensive one.
    attack: [
      [
        1,
        "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.",
      ],
    ],
    // ⚠️⚠️ D249 TOOK THE ROW'S ABILITY HALF FOR THE FIRST TIME AND THE
    // NON-ATTACK COUNT MOVED **10 → 6**. Hydrapple ex "Ripening Charge"
    // (`sv07-014`/`-156`/`-167`/`sv08.5-011`, 4 legal) is BUILT, as ONE registry
    // program with ZERO engine code — the first time this page's four-times-wrong
    // "zero engine code" price has been quoted and PAID on the same row. The
    // sentence is Teal Dance's (D221) with two words changed: "to 1 of your
    // Pokémon" instead of "to this Pokémon" (so it PARKS where Teal Dance forces)
    // and a heal instead of a draw (so it rides `healTarget`, D236's field, whose
    // NUMBER arm had no consumer until now).
    // 🆕 The row's ATTACK half is unchanged at 1 — this is the first slice in
    // FIVE to move the ability column, and the attack column is a control here.
    // ⚠️⚠️ D250 TOOK THE ROW'S TRIGGERED ATTACH AND THE NON-ATTACK COUNT MOVED
    // **6 → 4**. Bloodmoon Ursaluna "Battle-Hardened" (`sv06.5-025`/`sv08.5-054`,
    // 2 legal) is BUILT, as ONE registry program with ZERO engine code — the
    // SECOND slice running to quote and pay that price on this row. Every field
    // it needs was left lying around by a different slice for a different card:
    // `onPlayToBench` (M4 slice 6), `attachEnergyFrom.count` (D205),
    // `attachEnergyFrom.toSelf` (D221) and `energyType`. The one thing that had
    // never been tried is `toSelf` on a BOARD-TRIGGER context — `runBoardTrigger`
    // already passes `sourceUid`, so it cost nothing.
    // 🆕 What is left of the row's ability half is TWO sentences: the 3-printing
    // Basic-{R}-or-{F}-or-one-of-each DISJUNCTION (`svp-116`/`sv06-033`/
    // `sv06-173` — a filter shape `attachFromHand` has no spelling for, plus a
    // cap D247's op deliberately has none of) and `sv09-107`'s *"whenever you
    // attach"*, which is a TRIGGER KIND `triggers.ts` does not have.
    abilityIds: ["svp-116", "sv06-033", "sv06-173", "sv09-107"],
    effectIds: [],
  },
];

/** Row 14 has NO attack-column half: it is a set of big reprint groups in the
    ABILITY column, each one registry program for six or seven legal printings.
    They are listed apart from `ROWS` precisely because no reader can ever reach
    them — the deriver-sweep half of this file does not apply.

    ⚠️⚠️ **THE TABLE GAINED A `built` COLUMN AT D242 AND FOUR ROWS, AND BOTH ARE
    THE SLICE'S MEASUREMENT RATHER THAN BOOKKEEPING.** The doc's cell says *"the
    ABILITY column's THREE BIGGEST reprint groups — three registry programs, six
    legal printings each"*. The count re-derives (18 on 3 sentences, the ninth row
    running); **the SUPERLATIVE does not**, and only re-running the `GROUP BY`
    WITHOUT the row's own ids in it could show that:
      • the biggest UNBUILT ability group is **SEVEN** (Festival Grounds), and the
        row does not mention it;
      • there are **FOUR** six-printing unbuilt groups, and the row names three.
    🆕 **A SUPERLATIVE IS A THIRD CLAIM, AFTER THE COUNT AND THE COMPOSITION.**
    The two groups the row missed are carried here so the claim cannot rot back
    into prose, and `row14Unbuilt` below is the number the doc's cell must match. */
/** D243 — the SEAT-WIDE PRE-W/R DAMAGE AURA family, by PRINTED IDIOM rather than
    by the two ids row 14-B(b) names. `[ids, built]`, ordered by printings.

    🛑 **THE ROW'S NAMED HALF IS THE ONE THAT CANNOT BE BUILT.** 14-B(b) is the
    six `Future` printings and calls the bare Serperior sentence its "cheapest
    entry point", expecting the Future version to become a RIDER on the aura once
    it exists. It cannot: the narrowing is a `CardFilter`, every member of which
    reads an INGESTED COLUMN, and the Ancient/Future banner appears in none
    (`SELECT suffix, COUNT(*) FROM cards WHERE legal_standard=1 GROUP BY 1` →
    NULL 1668 · ex 353, re-verified at HEAD by D243 rather than inherited from
    D146/D204/D205). 🆕 **A "CHEAPEST ENTRY POINT" IS A CLAIM ABOUT WHAT COMES
    AFTER IT, AND IT ROTS LIKE A COUNT OR A SUPERLATIVE DOES.**

    The three DEFERRED singles are measured, not guessed: `sv09-007` needs a
    DISJUNCTION of two `typedPokemon` filters, `sv08-021` needs `typedPokemon.stage`
    to admit `"evolution"` (it admits only `"basic"`), and `sv07-038` narrows the
    TARGET rather than the beneficiary — a different seam. All three are rows on
    `coverage-backlog-legal.md`. */
const AURA_FAMILY: readonly (readonly [readonly string[], "D243" | "D245" | null])[] = [
  // BLOCKED ON THE INGEST — "…your Future Pokémon, except any Iron Crown ex…"
  [["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"], null],
  // ✅ D243 — the BARE sentence, Serperior ex "Regal Cheer"
  [["sv10.5b-003", "sv10.5b-156", "sv10.5b-164"], "D243"],
  // ✅ D243 — Cynthia's Roserade "Cheer On to Glory"
  [["sv10-008", "sv10-184"], "D243"],
  // ✅ D243 — Hop's Snorlax "Extra Helpings" (the non-stacking one)
  [["svp-184", "sv09-117"], "D243"],
  // ✅ D245 — a type DISJUNCTION ("your {G} Pokémon and {R} Pokémon"), the
  //    `CardFilter.anyOf` combinator.
  [["sv09-007"], "D245"],
  // ✅ D245 — "your Evolution {R} Pokémon", `typedPokemon.stage: "evolution"`.
  [["sv08-021"], "D245"],
  // ✅ D245 — "to your opponent's Active EVOLUTION Pokémon", the `target` rider.
  //    ⚠️ THE ROW SAID THIS ONE NEEDED `damageBonusBeforeWRIfTarget` AND IT DOES
  //    NOT: that field is a `passivesOf(attacker)` FOLD, so its source and its
  //    beneficiary are one body. This sentence's source need not be attacking.
  [["sv07-038"], "D245"],
];

/** D245 — the `typedPokemon.stage: "evolution"` widening's OTHER sentence, and the
    reason this slice's ability delta is 6 rather than the backlog row's 3.

    Genesect ex "Metallic Signal" (`sv10.5b-067`/`-161`/`-169`) — "Once during your
    turn, you may search your deck for up to 2 Evolution {M} Pokémon, reveal them,
    and put them into your hand." It is NOT an aura and shares no seam with the
    table above; what it shares is the FIELD VALUE. Backlog row 14-B(b)-R names one
    printing needing `stage` to admit `"evolution"`; the printed IDIOM (`LIKE
    '%evolution {%'`, `json_each` over all three text columns, `legal_standard = 1`,
    remote D1 `luminous` 2026-08-06) returns **2 sentences / 4 printings**.
    **A ROW IS A SET OF IDS AND A FIELD IS A SET OF SENTENCES** — D244's lesson, and
    the second consecutive slice on which running the widened query changed the
    column delta. */
const TYPED_EVOLUTION_SEARCH: readonly string[] = ["sv10.5b-067", "sv10.5b-161", "sv10.5b-169"];

/** D249 — Hydrapple ex "Ripening Charge", the ability half of backlog row 12 and
    the FIFTH table in this file to move the ability column, which is what makes
    the decomposition below go RED rather than quiet.

    The four ids are the SENTENCE's, re-queried against the remote D1 `luminous` on
    2026-08-07 rather than carried from the row: `LIKE '%if you attached energy to
    a pok%in this way%'` swept across `json_each(abilities_json)`,
    `json_each(attacks_json)` and `effect`, `legal_standard = 1`, GROUPED BY
    SENTENCE. Exactly these four, and no others.

    ⚠️ **THE WIDENING'S TWO OTHER SENTENCES ARE FALSE POSITIVES AND ARE NAMED HERE
    RATHER THAN LEFT AS A CLAIM** — the standing rule is to widen and then name
    what the widening turns up: the 8-printing Teal Dance group (BUILT, D221, same
    clause with a `draw a card` tail and a `to this Pokémon` destination), and a
    3-printing ATTACK (`sv06.5-036`/`-082`/`-090`) that searches the DECK and ends
    in a status. Neither belongs to this field, and neither is countable here. */
const RIPENING_CHARGE_IDS: readonly string[] = ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"];

/** D250 — Bloodmoon Ursaluna "Battle-Hardened", the triggered-attach third of
    backlog row 12's ability half and the SIXTH table in this file to move the
    ability column, which is what makes the decomposition below go RED rather than
    quiet for the second slice running.

    The two ids are the SENTENCE's, re-queried against the remote D1 `luminous` on
    2026-08-07 rather than carried from the row: `LIKE '%when you play this
    pok%onto your bench%attach%'` swept across `json_each(abilities_json)`,
    `json_each(attacks_json)` and `effect`, `legal_standard = 1`, GROUPED BY
    SENTENCE. Exactly these two, and the ONLY other sentence at that width is
    `sv06-132` (*"…search your deck for a Pokémon Tool card and attach it to this
    Pokémon"*) — same timing, same destination phrase, a DECK search for a TOOL.

    ⚠️ **THE BARE-OPENING WIDENING IS RECORDED TOO, BECAUSE IT ANSWERS A DIFFERENT
    QUESTION AND THE HANDOFF'S PREDICTION WAS ABOUT THAT ONE.** `%onto your
    bench%` GROUPED BY SENTENCE returns six other `onPlayToBench` sentences —
    two BUILT (`BENCH_SWITCH_FAMILY`'s 6 at D244; Durant ex's 3 at M4/D130) and
    four unbuilt (a 2-printing heal-and-recover, a 2-printing Stadium discard,
    `sv05-085`'s search-and-discard, and `sv06-132`) — plus a long tail of
    deck-search ATTACKS that merely share the preposition ("…put them onto your
    Bench") and carry no trigger at all. Those are the false positives, named
    rather than counted. */
const BATTLE_HARDENED_IDS: readonly string[] = ["sv06.5-025", "sv08.5-054"];

/** D251's term — the ATTACKER-HAS-AN-ABILITY prevent (Cornerstone Mask Ogerpon ex
    "Cornerstone Stance"), FIVE legal printings on ONE sentence and the SEVENTH term
    of the decomposition below.

    ⚠️ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE NINETEENTH ROW RUNNING**, off a
    query run on the SHAPE rather than on the row's five ids:
    `GROUP BY lower(j.value ->> 'effect')` over `json_each(abilities_json)` with
    `legal_standard = 1` and `LIKE '%prevent all damage%'` (remote D1 `luminous`,
    2026-08-07) puts this sentence at the TOP of nine ability sentences with n = 5,
    and the five ids are the row's exactly.

    ⚠️ **THE WIDENING LADDER, BOTH RUNGS, AND THE NARROW ONE IS CLEAN.** At the
    printed KEY PHRASE (`%have an ability%`, all three text columns) the sweep
    returns EXACTLY this sentence — zero false positives, which is the first time a
    row's widening has returned nothing else at all. Dropped to the bare printed
    OPENING (`%prevent all damage%`, same three columns) it returns 19 sentences: the
    9 ability ones, 9 attack ones and 1 Trainer. The false positives at that rung are
    named rather than counted — every one of the 9 attack sentences is a "during your
    opponent's next turn" INSTALLATION (`attackBlockOf`, a different mechanism), the
    Trainer is a Rule-Box-gated seat aura, and FIVE of the 9 ability sentences carry
    "prevent all damage FROM AND EFFECTS OF attacks", a second rule this pipeline
    does not have.

    🛑 **AND THAT LAST FALSE POSITIVE IS THE ONE THE HANDOFF PREDICTED WOULD LAND.**
    `sv10.5b-023`/`-107` ("…that have any Special Energy attached", 2 printings) is
    the same axis one attribute over and was priced as "the twin that decides the
    field's shape" — but it carries the effects half, so it is not addable to this
    field at any shape. **A NEIGHBOUR ON THE SAME AXIS IS NOT A NEIGHBOUR ON THE SAME
    RULE, and the way to tell is to read the whole sentence rather than the clause
    that made it look like a sibling.** */
const CORNERSTONE_STANCE_IDS: readonly string[] = [
  "sv06-112",
  "sv06-199",
  "sv06-215",
  "sv08.5-058",
  "sv08.5-160",
];

/** D252's term — the ATTACKER-HAS-A-SPECIAL-ENERGY prevent on damage **AND
    EFFECTS** (Carracosta "Mighty Shell"), TWO legal printings on ONE sentence and
    the EIGHTH term of the decomposition below.

    ⚠️ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE TWENTIETH ROW RUNNING**, off the
    query the row is SHAPED by rather than off its two ids:
    `GROUP BY lower(json_extract(a.value,'$.effect'))` over
    `json_each(abilities_json)` with `legal_standard = 1` and
    `LIKE '%and effects of attacks%'` (remote D1 `luminous`, 2026-08-07) returns
    **9 printings on 4 sentences** — the figure D251's handoff carried, unchanged —
    and this row is the 2 with its two ids exactly.

    🛑 **AND THE ROW ABOVE IT IN THAT OUTPUT IS THE ONE THIS SLICE PROVED IT CANNOT
    TAKE.** `sv08-042`/`-217`/`-237` read "…from your opponent's **Tera** Pokémon",
    and the Tera banner is in NO ingested column: `SELECT suffix, COUNT(*) FROM
    cards WHERE legal_standard = 1 GROUP BY suffix` has exactly two values, `null`
    and `ex`. D243 found the same thing about Ancient/Future. **The check was run
    BEFORE the build rather than after, which is what the handoff asked for**, and
    it moves the family's addressable size from 9 to 6.

    ⚠️ **THE WIDENING LADDER, AND THE NARROW RUNG IS THE CLEAN ONE.** At the printed
    KEY PHRASE (`%special energy attached%`, all three text columns) the sweep
    returns this sentence plus Luminous Energy's own holder condition and two
    "…this attack does N more damage" riders — all three already BUILT, so zero
    unbuilt false positives. Dropped to `%and effects of attacks%` across all three
    columns it adds the ATTACK column's "during your opponent's next turn"
    INSTALLATIONS (`attackBlockOf`'s wide spelling, built at D142) and the
    effects-ONLY printings that carry the reminder "(Damage is not an effect.)".
    Those last are the SAME rule minus the damage half and are a backlog row, not a
    false positive. */
const MIGHTY_SHELL_IDS: readonly string[] = ["sv10.5b-023", "sv10.5b-107"];

/** D253's term — the BENCH-GATED wide prevent (Poltchageist / Sinistcha "Curious
    Tea Party"), THREE legal printings on ONE sentence and the NINTH term of the
    decomposition below.

    🛑 **THIS TERM WAS THE FIRST IN NINE NOT RE-DERIVED AT ITS OWN COMMIT, AND
    D254 RE-RAN IT.** D253 met `403 / code 7403` ("the given account is not valid
    or is not authorized to access this service") on every query, and the LOCAL
    sqlite `catalogManifest.ts` describes is the ROTATED six-set / 978-row
    population holding no `sv06` and no `sv10` row at all — so neither the row's
    own `GROUP BY` nor the 376-unit join behind `BUILT.ability` could be run, and
    the count was INCREMENTED 133 → 136 with the gap flagged in four places.

    ✅ **D1 ANSWERED AT D254 AND THE ROW MEASURES 3, EXACTLY AS TRANSCRIBED.** The
    same `GROUP BY lower(json_extract(a.value,'$.effect'))` over
    `json_each(abilities_json)` with `legal_standard = 1` and `LIKE '%and effects
    of attacks%'` returns **9 printings on 4 sentences** with this row as the **3**
    (`sv06-020`, `sv06-171`, `sv10-048`), and the 376-unit join returns **136** at
    D253's commit. **The re-derivation streak RESUMES here rather than counting
    D253 in it** — an increment that later measures true is still not a
    measurement, which is the whole reason the flag was worth carrying.

    ⚠️ **AND THE LIMITATION D253 NAMED SURVIVES THE GOOD NEWS: the tie cannot catch
    a bad census, only a bad arithmetic.** Had the row been wrong, both this term
    and `BUILT.ability` would have been wrong by the same amount and the
    decomposition below would still have gone green. That is why the re-run was a
    resume-point action rather than a footnote, and why it stays one.

    ✅ **THE LADDER'S LAST RUNG IS TAKEN AT D254.** `sv05-024` ("…done to your
    BENCHED Pokémon") is `SPHERICAL_SHIELD_IDS` below; the family closes at **6 of
    6 addressable** and the 3-printing TERA group stays UNBUILDABLE for D252's
    measured reason. ⚠️ Note the re-homing note this block used to carry called it
    "`benchShieldedByActive`'s shape" — HALF right, and D254 graded it: same TARGET
    clause, but NO source clause at all. See `SPHERICAL_SHIELD_IDS`. */
const CURIOUS_TEA_PARTY_IDS: readonly string[] = ["sv06-020", "sv06-171", "sv10-048"];

/** D254's term — the SEAT-WIDE wide prevent (Rabsca `sv05-024` "Spherical
    Shield"), **ONE** legal printing on ONE sentence, the TENTH term of the
    decomposition below and the LAST rung of the "and effects of attacks" ladder.

    ✅ **RE-DERIVED AT ITS OWN COMMIT.** The census above returns 9 printings on 4
    sentences and this row is the 1; the 376-unit join returns 137.
    **6 of 6 addressable printings of the family are now built** (2 at D252, 3 at
    D253, 1 here), with the 3-printing TERA group permanently out of reach.

    ⚠️ **AND THE HANDOFF'S SHAPE CALL WAS HALF WRONG, WHICH IS WORTH THE LINE
    BECAUSE THE HALF IT GOT WRONG IS THE HALF THAT COSTS.** D252/D253 re-homed this
    id as "`benchShieldedByActive`'s shape". It shares that scan's TARGET clause
    ("your Benched Pokémon") and NOTHING else: Thundurus prints "As long as this
    Pokémon is in the Active Spot" and Rabsca prints no source clause at all, so
    a BENCHED Rabsca grants the shield and — unlike every earlier member of the
    aura-scan family — **its source set CONTAINS its target set.** That is
    `seatDamageReduction`'s condition verbatim, and it is why the widened scan
    takes a `scope`. Settled by reading the printed string out of D1, which is
    D245's rule and the seventh consecutive slice it has paid on. */
const SPHERICAL_SHIELD_IDS: readonly string[] = ["sv05-024"];

/** D255's terms — the ATTACKER'S PRINTED RULE-BOX CLASS, and the FIRST slice in
    this table to add TWO terms at once, because the row it took is TWO printed
    sentences on ONE parameterised field. The ELEVENTH and TWELFTH terms of the
    decomposition below.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS.** The `%prevent all damage%` census
    (remote D1 `luminous`, `abilities_json`, `legal_standard = 1`, GROUPED BY
    SENTENCE, 2026-08-07) returns **22 printings on 9 sentences**, of which these
    two rows are the 3 and the 2; the 376-unit `programFor` join returns **137**
    before this slice and **142** after. Neither figure is an increment.

    🛑 **AND THE TWO ARRAYS ARE TWO PROGRAM OBJECTS, WHICH IS THE CLAIM THE SPLIT
    IS ACTUALLY MAKING.** A single 5-id term would have been arithmetically
    identical and would have hidden the only thing worth asserting here: the three
    ex-only printings must NOT carry the `stage` conjunct the two Farigiraf ex
    printings do. The `.not.toBe` below is the assertion no count can make. */
const PREVENT_FROM_EX_IDS: readonly string[] = ["sv08.5-040", "sv10-012", "sv10-186"];
const PREVENT_FROM_BASIC_EX_IDS: readonly string[] = ["sv05-108", "sv05-194"];

/** D256's term — the BENCH-WIDE Rule-Box prevention (Shaymin `sv10-010`/`-185`
    "Flower Curtain"), **2 legal printings on ONE sentence**, backlog row 15-A and
    the THIRTEENTH term of the decomposition below.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS, SECOND SLICE RUNNING.** The
    `%prevent all damage%` census (remote D1 `luminous`, `abilities_json`,
    `legal_standard = 1`, GROUPED BY SENTENCE, 2026-08-07) returns **22 printings on
    9 sentences, UNCHANGED from D255**, and the narrow `%benched pok%rule box%`
    query returns the same 2 ids — so the row's POPULATION is confirmed and not only
    its phrase. The 376-unit `programFor` join returns **142 before this slice and
    144 after**; neither figure is an increment.

    ⚠️ AFTER THIS SLICE THE FAMILY'S RESIDUE IS **4 printings on 2 sentences**: the
    3-printing TERA group (permanently unbuildable, D252's measured reason) and
    Drednaw `sv07-044` alone, which is backlog row 15-B and row 15's whole remaining
    `abilityIds`. **This is the last slice that can move row 15 without closing it.** */
const FLOWER_CURTAIN_IDS: readonly string[] = ["sv10-010", "sv10-185"];

/** D257's term — the DAMAGE-THRESHOLD prevention (Drednaw `sv07-044` "Impervious
    Shell"), **1 legal printing on ONE sentence**, backlog row 15-B and the
    FOURTEENTH term of the decomposition below.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS, THIRD SLICE RUNNING.** The
    `%prevent all damage%` census (remote D1 `luminous`, `legal_standard = 1`,
    GROUPED BY SENTENCE, 2026-08-07) returns **22 printings on 9 sentences in
    `abilities_json`, UNCHANGED from D255 and D256**, and the row's own
    `%if that damage is%` query returns **1 / 1** in that column — this id, alone,
    in every column and at every rung of the ladder. The 376-unit `programFor` join
    returns **144 before this slice and 145 after**; neither figure is an increment.

    🛑 **AND THIS TERM CLOSES ROW 15.** After it the `%prevent all damage%` ability
    column has **3 printings on 1 sentence** left and every one is the TERA group,
    which is permanently unbuildable (D252's measured reason: `Tera` is in NO
    ingested column — `SELECT suffix, COUNT(*) … GROUP BY suffix` returns only
    `null` and `ex`, and every `name`/`effect` hit for "Tera" is DEMAND, never
    SUPPLY). **The next slice in this family needs a NEW census, not a new row** —
    the coin-flip defensive Ability (5 legal printings on 2 sentences, measured at
    D257 and written into `coverage-backlog-legal.md` as row 15-C) is where it goes.

    A SINGLETON — one printed id, no reprint — so unlike D256's term there is no
    shared-object claim to make and none is asserted. */
const IMPERVIOUS_SHELL_IDS: readonly string[] = ["sv07-044"];

/** D258's FIRST term — the {D}-GATED coin-flip prevention (Fezandipiti
    "Adrena-Pheromone", `sv06-096`/`sv06.5-073`/`sv08.5-045`), **3 legal printings on
    ONE sentence**, and the FIFTEENTH term of the decomposition below.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS.** The 376-unit `programFor` join
    returns **145 before this slice and 150 after**; neither figure is an increment.
    The row's own census (remote D1 `luminous`, `legal_standard = 1`, GROUPED BY
    SENTENCE, all three text columns via `json_each`, 2026-08-07) returns **3** for
    this sentence and **2** for its antecedent-dropped twin below.

    🛑 **AND THIS ROW IS WHY A CLOSED BACKLOG ROW MUST NOT STAND IN FOR A GUARD.**
    Row 15's `abilityIds` is `[]` since D257 and cannot go red for a build landing;
    these two constants are what this slice gives the decomposition instead, and they
    go red the moment the arithmetic drifts OR an id here loses its program. */
const ADRENA_PHEROMONE_IDS: readonly string[] = ["sv06-096", "sv06.5-073", "sv08.5-045"];

/** D258's SECOND term — the UNGATED coin-flip prevention (Kecleon "Expert Hider",
    `sv08-150`/`sv08-213`), **2 legal printings on ONE sentence**, and the SIXTEENTH
    term of the decomposition below.

    A SECOND TERM AND NOT A RIDER ON THE ONE ABOVE, for D255's reason verbatim: the
    slice moves the column by TWO printed sentences, and a decomposition whose terms
    are SENTENCES rather than slices is the only shape under which "which printing
    moved the number" stays answerable. (`legalNonAttackPrograms.test.ts` asserts the
    two sentences do NOT share a program object, which is the same fact one file
    over.) */
const EXPERT_HIDER_IDS: readonly string[] = ["sv08-150", "sv08-213"];

/** D259's FIRST term — the TRAINER-borne HOLDER shield (Fraxure "Unnerve",
    Cetitan ex "Snow Camouflage"), **4 legal printings on ONE sentence** and the
    SEVENTEENTH term of the decomposition below. The largest single term this
    family has contributed since D251.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS.** The 376-unit `programFor` join
    returns **150 before this slice and 155 after**; neither figure is an
    increment, and the two runs differ only in which `registry.ts` is on disk. The
    row's own census (remote D1 `luminous`, `legal_standard = 1`, GROUPED BY
    SENTENCE, all three text columns via `json_each`, 2026-08-07) returns **4** for
    this sentence and **1** for the seat-wide spelling below, with the attack and
    effect columns returning ZERO for the same predicate. */
const UNNERVE_IDS: readonly string[] = ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210"];

/** D259's SECOND term — the SEAT-WIDE Supporter-only spelling (Rhyperior "Wide
    Wall", `sv07-076`), **1 legal printing** and the EIGHTEENTH term of the
    decomposition below.

    A SECOND TERM AND NOT A RIDER ON THE ONE ABOVE, for D258's reason verbatim: the
    slice moves the column by TWO printed sentences, and a decomposition whose terms
    are SENTENCES rather than slices is the only shape under which "which printing
    moved the number" stays answerable. 🆕 **AND HERE THE TWO TERMS ARE NOT EVEN THE
    SAME MECHANISM** — one is a `passivesOf` fold and the other a seat scan — which
    is the sharpest case yet for terms being sentences: a single term would have
    hidden a fold/scan split behind one number. */
const WIDE_WALL_IDS: readonly string[] = ["sv07-076"];

/** D284's FIRST term — the CONTINUOUS BAR ON THE PLAY, ONE-CLASS spelling
    (Tyranitar `sv09-095` "Daunting Gaze"), **1 legal printing** and the
    THIRTY-FIFTH term of the decomposition below.

    ⚠️ SPLIT FROM `OCEANIC_CURSE_IDS` FOR `UNNERVE_IDS`/`WIDE_WALL_IDS`'s REASON
    TWENTY LINES UP — they are two PRINTED SENTENCES, and a decomposition whose
    terms are sentences is the only shape under which "which printing moved the
    number" stays answerable. They share a `PassiveEffects` field and differ in
    the length of its array, which is precisely the difference a single merged
    term would hide. */
const DAUNTING_GAZE_IDS: readonly string[] = ["sv09-095"];

/** D284's SECOND term — the same bar with the class list at length TWO
    (Jellicent ex `sv10.5w-045`/`-160`/`-168` "Oceanic Curse"), **3 legal
    printings of ONE byte-identical sentence** and the THIRTY-SIXTH term below.
    The printing whose `"Tool"` half is the family's FOURTH read site
    (`cardplay.ts attachTool`), which Tyranitar's sentence needs none of. */
const OCEANIC_CURSE_IDS: readonly string[] = ["sv10.5w-045", "sv10.5w-160", "sv10.5w-168"];

/** D285's term — the CONTINUOUS BAR ON THE PLAY aimed at the POKÉMON SURFACE
    (Team Rocket's Arbok `sv10-113` "Potent Glare"), **1 legal printing** and the
    THIRTY-SEVENTH term of the decomposition below.

    ⚠️ SPLIT FROM THE TWO TERMS ABOVE ON THE SAME GROUND THEY ARE SPLIT FROM EACH
    OTHER — a THIRD printed sentence, and one that reaches a different
    `PassiveEffects` field entirely (`preventOpponentPokemonPlay`, whose value is
    an ACT list plus two `CardFilter` riders, not a `HandPlayClass` array). ⚠️
    **ITS ATTACK-SIDE TWIN IS NOT A TERM HERE AT ALL**: Bronzong `sv05-069` is the
    same mechanism at the same gate, and it is TEXT-DERIVED, so it lands in
    `BUILT.attack` and authors no registry row. One mechanism, two columns. */
const POTENT_GLARE_IDS: readonly string[] = ["sv10-113"];

/** 🆕 D287's term — the CONTINUOUS BAR ON THE PLAY at its FOURTH and LAST
    `Card.trainerType` (Copperajah `sv06.5-042` "Massive Body"), **1 legal
    printing and the only row in the catalog at any legality** (remote D1
    `luminous`, 2026-08-08: `instr(abilities_json,'play any Stadium')>0` returns
    exactly this id; attack and effect columns 0), and the THIRTY-EIGHTH term of
    the decomposition below.

    ⚠️ SPLIT FROM `DAUNTING_GAZE_IDS` AND `OCEANIC_CURSE_IDS` ON THE GROUND THEY
    ARE SPLIT FROM EACH OTHER — a THIRD printed sentence of the same field, and
    the one whose class list is neither `["Item"]` nor `["Item","Tool"]`. It is
    the only one of the three whose read site is `playStadium`, which is the
    difference a merged term would hide most completely: the other two are
    honoured entirely by gates that already existed at D283. */
const MASSIVE_BODY_IDS: readonly string[] = ["sv06.5-042"];

/** 🆕 D291's term — the RARITY axis of the same seat-wide bar (Genesect
    `sv06.5-040` "ACE Nullifier"), **1 legal printing and the ONLY row in the
    catalog whose printed text contains the words "ACE SPEC" at all** (remote D1
    `luminous`, 2026-08-08, all three text columns, NO legality filter: exactly
    this id), and the THIRTY-NINTH term of the decomposition below.

    🛑 **A SEPARATE TERM BECAUSE IT IS A SEPARATE FIELD**, which is the strongest
    version of the split this decomposition keeps making: the other four terms of
    D284's census (`DAUNTING_GAZE_IDS`, `OCEANIC_CURSE_IDS`, `MASSIVE_BODY_IDS`,
    `POTENT_GLARE_IDS`) all carry a CLASS vocabulary, and this one carries none —
    it asks about `Card.rarity`. A merged term would let a build satisfy the count
    while answering a different question, and the control below is written to say
    so by NAME. **THIS TERM CLOSES D284's SEVEN-SENTENCE CENSUS: 7 BUILT / 0
    REFUSED**, and it is the first slice since D284 opened it in which that block
    has no survivor to name. */
const ACE_NULLIFIER_IDS: readonly string[] = ["sv06.5-040"];

/** 🆕 **D294's TERM — THE CROSS-SEAT DESTINATION**: Mandibuzz `sv10.5w-064`/
    `-145` "Look for Prey", **2 legal printings on ONE byte-identical sentence**
    and the WHOLE legal population of it (remote D1 `luminous`, 2026-08-08,
    `GROUP BY lower(j.value ->> 'effect')` over `json_each(abilities_json)` at
    `legal_standard = 1` — the query returns these two ids and nothing else).

    🛑 **A SEPARATE TERM BECAUSE IT IS THE FIRST ONE ON THIS PAGE WHOSE FIELD IS AN
    OP FIELD RATHER THAN A `passive` FLAG OR A TABLE.** Every term since D284 is a
    `programFor(id)?.passive?.<bar>`; this one is an `abilities[].program[]` op
    with `dest: "bench"`, so the control below has to reach INTO the program to
    say what it is counting. A `toBeDefined()` on the ability alone would pass on
    any Mandibuzz row at all — including one that put the card on the bottom of
    the deck, which is the exact wrong answer this widening could produce.

    ✅ **THE PARTITION FIRED FIRST, FOR THE FIFTH SLICE RUNNING.** Both ids were
    registered, the suite was run, and the guard at the foot of this file went RED
    with `expected [ 'sv10.5w-064', 'sv10.5w-145' ] to deeply equal []` before any
    constant on this page was touched. */
const LOOK_FOR_PREY_IDS: readonly string[] = ["sv10.5w-064", "sv10.5w-145"];

/** D260's FIRST term — the ATTACK-BORNE EFFECTS-ONLY shield's HOLDER rule
    (Skeledirge `sv08-031` "Unaware"), **1 legal printing on ONE sentence** and the
    NINETEENTH term of the decomposition below.

    ✅ **RE-DERIVED AT THIS COMMIT, BOTH ENDS.** The 376-unit `programFor` join
    returns **155 before this slice and 157 after**; neither figure is an increment,
    and the two runs differ only in which `registry.ts` is on disk. The row's own
    census (remote D1 `luminous`, `legal_standard = 1`, GROUPED BY SENTENCE, all
    three text columns via `json_each`, 2026-08-07, THREE ladder rungs) returns
    **1** for this sentence and **1** for the target-group spelling below. */
const UNAWARE_IDS: readonly string[] = ["sv08-031"];

/** D260's SECOND term — the TARGET-GROUP spelling (Team Rocket's Articuno
    `sv10-051` "Repelling Veil"), **1 legal printing** and the TWENTIETH term of
    the decomposition below.

    A SECOND TERM AND NOT A RIDER, for D258's and D259's reason verbatim: the slice
    moves the column by TWO printed sentences, and terms that are SENTENCES rather
    than slices are the only shape under which "which printing moved the number"
    stays answerable. 🆕 **AND, LIKE D259's PAIR, THE TWO TERMS ARE NOT THE SAME
    MECHANISM** — one is a `passivesOf` fold and the other an own-board scan with a
    `CardFilter` — which is now the second consecutive slice where a single term
    would have hidden a fold/scan split behind one number. */
const REPELLING_VEIL_IDS: readonly string[] = ["sv10-051"];

/** 🆕 D263's THREE terms — the TWENTY-FIRST, -SECOND and -THIRD of the ability
    decomposition below, and the first entries in it that are not a §11 prevention
    of some kind. Backlog row 9's ABILITY half: attach from the DISCARD PILE.

    THREE TERMS AND NOT ONE, on the standing rule (D258/D259/D260 verbatim): they
    are THREE PRINTED SENTENCES, and a slice that later builds one of the two
    seam-blocked residue rows must be able to see which term it joins. Grouping
    them would hide exactly the arithmetic the decomposition exists to expose. */
const ASSEMBLE_ALLOY_IDS: readonly string[] = ["sv08-130", "sv08-224", "sv08-241"];
const CHARGING_UP_IDS: readonly string[] = ["sv10-020", "sv10-187"];
const DYNAMOTOR_IDS: readonly string[] = ["sv10.5b-031", "sv10.5b-114"];
/** D264 — Arven's Greedent's "Greedy Order", the TWENTY-FOURTH term. The ABILITY
    half of backlog row 13, and the only one of that row's four unbuilt ability
    ids a `CardFilter` rider could reach. */
const GREEDY_ORDER_IDS: readonly string[] = ["sv10-159", "sv10-205"];
/** 🆕 D265 — Alomomola's "Gentle Fin", the TWENTY-FIFTH term, and the one that
    EMPTIES backlog row 13's non-attack half. It is the ABILITY half of a row that
    also has a TRAINER half in a DIFFERENT backlog family (Buddy-Buddy Poffin, on
    `searchDeck`), so this term is deliberately NOT grouped with it: the two
    printings here are what moved `BUILT.ability`, and the three there are what
    moved `BUILT.trainer`. One vocabulary, two columns, two terms. */
const GENTLE_FIN_IDS: readonly string[] = ["sv10.5b-024", "sv10.5b-108"];
/** 🆕 D267 — Latias ex's "Skyliner", the TWENTY-SIXTH term. The STAGE refinement
    on `noRetreatCostAura`, and the first term in this decomposition that moves the
    column by widening a §11 CONTINUOUS AURA rather than by an activated Ability or
    a prevention: "Your Basic Pokémon in play have no Retreat Cost." ONE sentence,
    ONE optional field (`stage?: "Basic"`), ONE conjunct in `hasFreeRetreatAura`.
    ⚠️ It is deliberately NOT grouped with the two energy-gated printings of the
    same field (Clefable ex's Lunar Zone, Archaludon's Metal Bridge): those were
    counted into this column long before D242's baseline, and a term is a SENTENCE
    rather than a field. */
const SKYLINER_IDS: readonly string[] = ["sv08-076", "sv08-220", "sv08-239"];
/** 🆕 D268 — Gothitelle's "Distorted Future", the TWENTY-SEVENTH term. The THIRD
    `who` member on `handRefresh`: "Once during your turn, if this Pokémon is in
    the Active Spot, you may have your opponent shuffle their hand into their deck
    and draw 3 cards." ONE sentence, ONE union member, ONE ternary inside the op's
    existing seat funnel. ⚠️ It is deliberately NOT grouped with the `"you"` and
    `"both"` printings of the same op (Youngster, Judge, Brassius, Katy, Iono,
    Lacey, Skwovet): those were counted long before D242's baseline, and a term is
    a SENTENCE rather than a field. ⚠️ And these two are a PROMO plus a SET
    printing of one card, not the alternate-art pairs the last four terms were —
    which is why the group was found by GROUPING ON THE SENTENCE and would have
    been missed by grouping on the set. */
const DISTORTED_FUTURE_IDS: readonly string[] = ["svp-211", "sv10.5w-043"];
/** 🆕 D272 — Fezandipiti ex's "Flip the Script", the TWENTY-EIGHTH term, and the
    first to move `BUILT.ability` after THREE consecutive slices left it standing
    at 173. Three legal printings on one byte-identical `abilities_json`.

    🛑 **AND THE TERM CARRIES A FINDING ABOUT THIS WHOLE DECOMPOSITION.** D272 ran
    `bun run check` GREEN with the three registry rows already shipped and
    `BUILT.ability` still reading 173 — because nothing here DERIVES the column
    from the registry. `BUILT.ability` is a hand-maintained constant and this tie
    only checks that it equals the sum of the terms, so a slice that adds a
    registry ability and forgets BOTH numbers is silently green in both. **The tie
    guards the ARITHMETIC and the join guards the CENSUS — and NEITHER of them
    guards the BUMP.** Ten slices have written "this line went RED the moment
    `BUILT.ability` was bumped"; that is the honest description, and it means the
    bump is the one step with no guard behind it at all. */
const FLIP_THE_SCRIPT_IDS: readonly string[] = ["sv06.5-038", "sv06.5-084", "sv06.5-092"];
/** 🆕 D273 — Pecharunt ex's "Subjugating Chains", the TWENTY-NINTH term and the
    BIGGEST single-sentence ability group this decomposition has ever taken in one
    slice: **five** legal printings on one byte-identical `abilities_json`.

    ✅ **AND THE FINDING RECORDED ON THE TERM ABOVE IS CLOSED BY THIS SLICE.** D272
    left "the bump is the one step with no guard behind it at all"; the partition
    at the foot of this file is that guard, and it did its first real job HERE.
    These five ids were registered, the suite was run, and `censusAtHead.test.ts`
    went RED with the message `expected [ 'sv06.5-039', 'sv06.5-085', …(3) ] to
    deeply equal []` — **before** any constant on this page was touched. That is
    the first time in twelve slices that this column moved because the code moved,
    rather than because a human remembered to move it. */
const SUBJUGATING_CHAINS_IDS: readonly string[] = [
  "sv06.5-039",
  "sv06.5-085",
  "sv06.5-093",
  "sv06.5-095",
  "sv08.5-163",
];
/** 🆕 D275 — Fan Rotom's "Fan Call", the THIRTIETH term, and the row that
    COMPLETES the `%You can't use more than 1%` name-lock sweep: that ladder's ten
    legal printings are now 5 (Pecharunt ex, D273) + 3 (Fezandipiti ex, D272) + 2
    (here), with nothing left refused.

    ✅ **SECOND CONSECUTIVE SLICE WHERE THE PARTITION FIRED FIRST.** The two ids
    were registered, the suite was run, and the guard at the foot of this file went
    RED with `expected [ 'sv07-118', 'sv08.5-085' ] to deeply equal []` — before
    any constant on this page was touched. D272's "the bump is the one step with no
    guard behind it" is now two slices closed rather than one, which is what turns
    a fix into a property. */
const FAN_CALL_IDS: readonly string[] = ["sv07-118", "sv08.5-085"];

/** D277 — Meloetta ex "Debut Performance", the §4 ATTACK licence, and the THIRTY-
    FIRST term of the ability decomposition. Three legal printings on one printed
    sentence, one shared program object. ⚠️ **A `passive`, NOT an `abilities`
    entry** — the column counts both (see `BUILT`'s own definition), and the
    classification matters to the ENGINE (a continuous licence read at the §4 gate,
    silenced by a §9 Ability-lock) rather than to this arithmetic. */
const DEBUT_PERFORMANCE_IDS: readonly string[] = ["sv10.5b-044", "sv10.5b-159", "sv10.5b-167"];

/** D281 — the per-attack-index TIMING GATE (`CardProgram.attackGate`), the
    THIRTY-FOURTH term of the ability decomposition and by far its LARGEST: 13
    Standard-legal printings on 5 bodies and 3 printed shapes (7 BAN + 3 GATE +
    3 LICENCE).

    🛑 **NOT ONE OF THE THIRTEEN CARRIES AN ABILITY, WHICH MAKES THIS THE FIRST
    TERM IN THIS SUM THAT IS NOT ONE.** The column is "legal Pokémon ids with a
    non-attack registry surface", and `attackGate` is the eighth such surface —
    the printed sentence is ATTACK text whose BODY is still unbuilt on all 13.
    See the block beside these ids in `CENSUS_POKEMON_LEGAL`. */
const ATTACK_TIMING_GATE_IDS: readonly string[] = [
  "sv07-128", "sv07-170", "sv07-173", "sv08.5-092", "sv08.5-169", "sv08.5-180", "svp-165",
  "sv06-010", "sv06-094", "sv06-197", "sv06-009", "sv08-001", "sv08-192",
];

/** D278 — Eevee "Boosted Evolution" (`sv08-143`/`sv08.5-074`/`svp-173`), the
    §4/§10 EVOLVE licence and the THIRTY-SECOND term of the ability
    decomposition. THREE Standard-legal printings, ONE byte-identical
    `abilities_json`, ONE shared `CardProgram` object. The partner-gated
    The partner-gated Karrablast/Shelmet printings are the THIRTY-THIRD term
    below, not this one: the licensed FACT is identical but the ANTECEDENT is not,
    and terms that are SENTENCES rather than mechanisms are the only shape under
    which "which printing moved the number" stays answerable. See registry.ts
    `BOOSTED_EVOLUTION`. */
const BOOSTED_EVOLUTION_IDS: readonly string[] = ["sv08-143", "sv08.5-074", "svp-173"];

/** 🆕 D279 — Karrablast `sv10.5b-009`/`-094` and Shelmet `sv10.5w-008`/`-093`
    "Stimulated Evolution", the §4/§10 EVOLVE licence under a PARTNER gate, and
    the THIRTY-THIRD term of the ability decomposition. **FOUR Standard-legal
    printings on TWO sentences and TWO `CardProgram` objects** — each body names
    the OTHER, so the reprint idiom applies WITHIN each pair and must not be
    applied across them (asserted below).

    ⚠️ **ONE TERM, NOT TWO, EVEN THOUGH THERE ARE TWO SENTENCES.** The sentences
    differ only in the partner's name — the same Ability name, the same printed
    skeleton, the same mechanism, one parameter — so they are one printing family
    the way `MIGHTY_SHELL_IDS`'s two are. A term per sentence here would split a
    parameter, not a rule. */
const STIMULATED_EVOLUTION_IDS: readonly string[] = [
  "sv10.5b-009",
  "sv10.5b-094",
  "sv10.5w-008",
  "sv10.5w-093",
];

/** 🆕 D261's THREE terms — and they decompose a DIFFERENT COLUMN, which is the
    point. `BUILT.specialEnergy` has been a bare hand-maintained `2` since D239
    with NOTHING tied to it; the ability column has had a decomposition since D243
    precisely because a constant nobody ties to can move in silence. These three
    give the Special Energy column the same guard.

    The column census (remote D1 `luminous`, `legal_standard = 1`,
    `category='Energy' AND energy_type='Special'`, GROUPED BY `effect`, 2026-08-07)
    is **7 sentences / 8 printings**; the wider census constant `POPULATION.
    specialEnergyUnits` is **11**, because it splits by `cards.category` and picks
    up 3 BASIC energy carrying effect text. The residue this slice leaves is **4
    printings on 4 sentences** — `sv05-162` (a CONDITIONAL provision), `sv06-166`
    (a post-attack re-attach that needs to know WHY a card left), `sv06-167` (a
    prize hook plus a per-game latch) and `sv10-182` (an attach restriction plus a
    continuous self-discard) — each named with its blocker in
    `mistEnergy.test.ts`'s header rather than left as a silence. */
const SPIKY_ENERGY_IDS: readonly string[] = ["sv09-159", "sv09-190"];
/** D261's FIRST term — the effects-only shield borne by an ENERGY (Mist Energy
    `sv05-161`), **1 legal printing on ONE sentence**, and the row that costs ZERO
    engine lines: `preventAttackEffects` (D260) folded off the Energy source class
    (D174). */
const MIST_ENERGY_IDS: readonly string[] = ["sv05-161"];
/** D261's SECOND term — the SECOND `EnergyOnAttach` arm ever (Enriching Energy
    `sv08-191`), **1 legal printing on ONE sentence**. A SECOND TERM AND NOT A
    RIDER, for D258/D259/D260's reason verbatim, and here the split it protects is
    a fold key versus a union arm. */
const ENRICHING_ENERGY_IDS: readonly string[] = ["sv08-191"];
/** 🆕 D262's term — the column's CONDITIONAL provision (Neo Upper Energy
    `sv05-162`), **1 legal printing on ONE sentence**. THE DECOMPOSITION'S FOURTH
    TERM, and a term rather than a rider for D258–D261's reason verbatim: terms
    that are SENTENCES are the only shape under which "which printing moved the
    number" stays answerable. The split it protects here is a PROVISION RULE versus
    a fold key and a union arm — three different mechanisms behind one constant. */
const NEO_UPPER_ENERGY_IDS: readonly string[] = ["sv05-162"];

/** The ability column's value at the two commits whose tables still drive a term
    of the decomposition below. Named constants rather than magic numbers, because
    a second slice in the same column makes `BUILT.ability - <literal>` expire —
    which is exactly what happened to D243's tie at D244. */
const ABILITY_AT_D242 = 100;
const ABILITY_AT_D243 = 107;
/** D245 — and the D244 value, because `AURA_FAMILY`'s `built` column is now a
    DECISION rather than a boolean and each decision's share ties to its own step.
    That is D243's expired `BUILT.ability - 100` re-homed a second time: the tie
    used to be "this table's shipped count is the whole delta", which a second
    slice in the column falsified; it is now "this table's share PER DECISION is
    that decision's step", which no later slice can falsify because a row carries
    the decision that flipped it. */
const ABILITY_AT_D244 = 114;
/** D249 — and the D245 value, because `BUILT.ability - ABILITY_AT_D244` EXPIRED
    the moment this slice moved the column again. **THAT IS THE THIRD TIME THIS
    EXACT SHAPE HAS EXPIRED** (D243's `- 100` went at D244, D244's `- 107` went at
    D245, and D245's `- 114` goes here), and it is the SIXTH slice running to pay
    one line for the re-home rule. 🆕 **THE LESSON D245 STATED — "a tie anchored to
    HEAD expires every slice; a tie anchored to two NAMED COMMITS expires never" —
    WAS RIGHT AND WAS NOT APPLIED TO ITS OWN NEW TIE.** D245 re-homed the OLD tie
    to a named pair and then wrote its own replacement with `BUILT.ability` still
    on the left. The repair is the same one, applied to the last live instance:
    every step in this file is now a difference of two SNAPSHOTS. */
const ABILITY_AT_D245 = 120;

/** D244 — every Standard-legal printing of `switchActive.fromSource`, which is
    NOT the same set as backlog row 14-R. The row names six ids on ONE sentence;
    the op field is two sentences and seven printings. Both are shipped, and the
    table exists so the difference is driven rather than narrated.

    ⚠️ THE TWO ROTATED PRINTINGS ARE DELIBERATELY ABSENT. Minior `sv04-099`/`-201`
    ("Far-Flying Meteor") print the same pronoun clause behind a DIFFERENT
    antecedent (an attach, not a bench play) and are `legal_standard = 0` — a
    registry row is keyed by card id and legality is a hard filter on it (D180),
    so authoring them would serve zero Standard-legal printings. */
const BENCH_SWITCH_FAMILY: readonly (readonly [readonly string[], boolean])[] = [
  // ✅ D244 — RAPID_VERNIER, backlog row 14-R's whole ability column.
  [["svp-128", "sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176"], true],
  // ✅ D244 — SHOWTIME, the sentence the row never named (the widened query).
  [["sv09-018"], true],
];

const ROW_14_ABILITY_GROUPS: readonly (readonly [string, readonly string[], boolean])[] = [
  [
    "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.",
    ["svp-205", "svp-216", "sv10-081", "sv10-213", "sv10-231", "sv10-240"],
    true, // D242 — POWER_SAVER
  ],
  [
    "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.",
    ["svp-177", "sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168"],
    true, // D242 — SEASONED_SKILL
  ],
  [
    "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
    ["svp-128", "sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176"],
    // ✅ D244 — RAPID_VERNIER. The row was right that this is a MECHANISM rather
    // than a third registry object, and right about all three things it needed
    // (`switchActive.fromSource`, an unbounded `max`, a uid-pinned destination) —
    // the first `needs` column in six slices to re-derive without a loss.
    true,
  ],
  [
    // 🆕 D242 — THE GROUP THE ROW'S SUPERLATIVE MISSED, and the BIGGEST unbuilt
    // one in the whole ability column.
    "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.",
    ["sv06-018", "sv06-044", "sv06-089", "sv06-170", "sv08.5-010", "sv08.5-020", "sv08.5-021"],
    false,
  ],
  [
    // 🆕 D242 — the FOURTH six-printing group, silently dropped by the row's "three".
    "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"],
    false,
  ],
];

/** The four legal ids whose ATTACK is a registry program. D187's shortcut
    "built attack = derived attack" is FALSE because of exactly these — the "+4"
    in `BUILT.attack`. Index-precise: each authors index 0 only. */
const REGISTRY_ATTACKS: readonly (readonly [string, string])[] = [
  [
    "sv09-068",
    "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ],
  [
    "sv10-050",
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10-194",
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10-083",
    "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ],
];

/** The sentence D216 made derivable without any backlog row asking for it. Kept
    as a named constant so the claim below is driven, not asserted in prose. */
const UNCLAIMED_BY_ANY_ROW =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";

const printings = (row: BacklogRow) => row.attack.reduce((sum, [n]) => sum + n, 0);

describe("D233 — the derived census re-run at HEAD, and the numbers rows 9-16 quote", () => {
  it("the seven readers are wired — a control sentence DOES resolve", () => {
    // Without this, every assertion below would pass on a broken import.
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
    expect(deriveAttackEffect(DERIVABLE_CONTROL)).not.toBeNull();
  });

  it("every printed sentence in every backlog family is refused by ALL SEVEN readers", () => {
    const resolved: string[] = [];
    for (const row of ROWS) {
      for (const [, text] of row.attack) {
        if (resolvedByAnyReader(text)) resolved.push(`row ${row.row}: ${text}`);
      }
    }
    // 🛑 A non-empty list here is not a bug in this file — it means a family was
    // BUILT and the doc's count for it is stale by that sentence's printings.
    expect(resolved).toEqual([]);
  });

  it("each sentence matches its OWN family predicate and no EARLIER one", () => {
    // This is the CASE chain the D1 query used. Re-ordering `ROWS`, or widening a
    // pattern so it swallows a later family, changes the counts — so it must fail
    // loudly rather than quietly re-attribute printings.
    ROWS.forEach((row, index) => {
      for (const [, text] of row.attack) {
        expect(row.pattern.test(text), `row ${row.row} pattern misses: ${text}`).toBe(true);
        for (const earlier of ROWS.slice(0, index)) {
          expect(
            earlier.pattern.test(text),
            `row ${row.row}'s "${text}" is claimed earlier by row ${earlier.row}`,
          ).toBe(false);
        }
      }
    });
  });

  it("the sentences are DISTINCT within and across families", () => {
    const all = ROWS.flatMap((r) => r.attack.map(([, t]) => t));
    expect(new Set(all).size).toBe(all.length);
  });

  it("each row's ATTACK printings are the sum of its sentences", () => {
    const measured = Object.fromEntries(ROWS.map((r) => [r.name, printings(r)]));
    expect(measured).toEqual({
      // D235 — was 28; the anchor took 20.
      "deck-search that ATTACHES (attachFromDeck)": 8,
      // D234 — was 17; the anchor took 12. D246 — the bare noun took a 13th, for
      // free, off a field a sibling zone paid for. D248 — the SPREAD took two
      // more, off a MAP ROW rather than an arm, leaving the opponent's-pile
      // printing and the per-heads one: two mechanisms, not a remainder.
      "attach from the DISCARD PILE (attachEnergyFrom, source side)": 2,
      // D241 — was 15; three anchors took 10, leaving the ordered-answer residue.
      "look at the top N (lookAtTopN)": 5,
      // D237 — was 16; the new anchor took 10. D238 — the brace code took 4 more.
      // D265 — the HP-threshold rider took the last non-attack sentence, so this
      // 2 is now the ATTACK residue alone (the per-heads coin fold).
      "the discard pile into the hand or onto the Bench (discardPileRetrieval)": 2,
      'copy an attack ("…and use it as this attack")': 13,
      "evolve out of the DECK — NOT a backlog row, see the doc's blocked table": 13,
      // D239 — was 9; the widened anchor took 7 (all one card, Terapagos ex).
      "prevent all damage by ATTACKER CLASS (preventDamage.fromClass)": 2,
      // D236 — was 16; the mirrored anchor took 9. D246 — the bare noun and the
      // gated compound took 2 more, leaving only the unbounded-count residue.
      // D247 — the unbounded count took 4 of the remaining 5, by a NEW OP rather
      // than the rider the row's cell predicted. What is left is the ORDERING
      // clause alone.
      "attach from the HAND (attachEnergyFrom, hand side)": 1,
    });
  });

  it("every non-attack id these rows count as UNBUILT has no registry program", () => {
    const authored: string[] = [];
    for (const row of ROWS) {
      for (const id of [...row.abilityIds, ...row.effectIds]) {
        if (programFor(id) !== undefined) authored.push(`row ${row.row}: ${id}`);
      }
    }
    for (const [, ids, built] of ROW_14_ABILITY_GROUPS) {
      if (built) continue;
      for (const id of ids) if (programFor(id) !== undefined) authored.push(`row 14: ${id}`);
    }
    // ⚠️ "These ids are unbuilt" is nearly always true (conventions.md), so this
    // row is NOT the guard — it is the bookkeeping that goes red the day one of
    // them is authored and the doc's non-attack count needs decrementing. The
    // guard is the deriver sweep above, which drives real functions.
    expect(authored).toEqual([]);
  });

  it("row 14's own three groups are six printings each — the COUNT re-derives", () => {
    // 18 = 6 · 6 · 6 on three sentences, which is the cell's figure exactly and the
    // NINTH row running to survive re-derivation.
    expect(ROW_14_ABILITY_GROUPS.slice(0, 3).map(([, ids]) => ids.length)).toEqual([6, 6, 6]);
    const flat = ROW_14_ABILITY_GROUPS.flatMap(([, ids]) => ids);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("…and its SUPERLATIVE does not — a 7 sits above it and a fourth 6 beside it", () => {
    // 🛑 THE CLAIM THE ROW LOST, DRIVEN RATHER THAN NARRATED. Sorted by size, the
    // biggest unbuilt ability groups are 7, 6, 6 — and the 7 is not one of the
    // row's three at all.
    const unbuilt = ROW_14_ABILITY_GROUPS.filter(([, , built]) => !built).map(
      ([, ids]) => ids.length,
    );
    // ⚠️ D244 — WAS `[7, 6, 6]`, AND THE MIDDLE SIX IS GONE BECAUSE IT WAS BUILT,
    // not because the ranking moved. The superlative the row lost stays lost: the
    // biggest unbuilt ability group is STILL the 7 that was never one of its
    // three (Festival Grounds), and the surviving 6 is the `Future` aura that is
    // blocked on the INGEST rather than on the engine (D243).
    expect([...unbuilt].sort((a, b) => b - a)).toEqual([7, 6]);
    // Every id in a group marked BUILT really has a program, which is the other
    // half of the bookkeeping above and stops the flag being decorative.
    for (const [, ids, built] of ROW_14_ABILITY_GROUPS) {
      if (!built) continue;
      for (const id of ids) expect(programFor(id), `${id} is flagged built`).toBeDefined();
    }
    // D242 took 12 of the row's 18; 19 unbuilt ability printings remain across the
    // three groups above, and that is the number the doc's rows 14-R / 14-B carry.
    const row14Unbuilt = ROW_14_ABILITY_GROUPS.filter(([, , built]) => !built).reduce(
      (sum, [, ids]) => sum + ids.length,
      0,
    );
    // ⚠️ **13 AT D244, AND D243's LESSON IS CONTRADICTED BY ITS SUCCESSOR ON
    // PURPOSE.** D243 said "a slice can build a row's mechanism and move its count
    // by zero"; this one builds a row's mechanism and moves the count by exactly
    // the row's own six. Both are true, and the pair is the point: **the ranked
    // table is a snapshot, so a row's count only moves when the ids it names are
    // the ids the slice ships.** D243's six were never shippable; D244's six were
    // the whole row.
    //
    // ⚠️ **19 WAS UNCHANGED AT D243 AND THAT WAS THE RESULT, NOT AN OMISSION.** The
    // resume point instructed the next slice to "flip the flag" on the Future group
    // and move this number. It cannot be flipped: the sentence is blocked on the
    // INGEST (no column classifies the Ancient/Future banner), not on the engine, so
    // D243 built the aura MECHANISM and seven printings of it and left all six of
    // these unbuilt. 🆕 **A SLICE CAN BUILD A ROW'S MECHANISM AND MOVE ITS COUNT BY
    // ZERO**, which is a third way a backlog row and a build can disagree, after
    // D238's residue (build without a row) and D240's (a row born and died between
    // two snapshots).
    expect(row14Unbuilt).toBe(13);
  });

  it("D243 — the SEAT-WIDE PRE-W/R AURA family: 7 of 16, and the 6 that are blocked", () => {
    // 🛑 THE FAMILY ROW 14-B(b) NAMED TWO SENTENCES OF. The same `GROUP BY` over
    // `json_each(abilities_json)` with `legal_standard = 1`, widened from the row's
    // two ids to the printed IDIOM ("Attacks used by your … do N more damage to
    // your opponent's Active …"), returns SEVEN sentences and 16 printings — the
    // superlative lesson (D242) applied to a family rather than to a ranking.
    for (const [ids, built] of AURA_FAMILY) {
      for (const id of ids) {
        expect(programFor(id)?.passive?.seatDamageBonusBeforeWR !== undefined, id).toBe(
          built !== null,
        );
      }
    }
    const printings = AURA_FAMILY.reduce((sum, [ids]) => sum + ids.length, 0);
    const shippedIn = (decision: "D243" | "D245"): number =>
      AURA_FAMILY.filter(([, built]) => built === decision).reduce(
        (sum, [ids]) => sum + ids.length,
        0,
      );
    const shipped = shippedIn("D243") + shippedIn("D245");
    expect(printings).toBe(16);
    // ⚠️ **10 AT D245, AND THE 6 THAT STAY ARE STILL THE SAME 6.** D245 took the
    // three DEFERRED singles — one `CardFilter.anyOf` combinator, one
    // `typedPokemon.stage: "evolution"` value, one `target` rider — and the Future
    // group is untouched, because its blocker was never the engine.
    expect(shipped).toBe(10);
    expect(shippedIn("D243")).toBe(7);
    expect(shippedIn("D245")).toBe(3);
    // ⚠️ **THE TIE TO `BUILT.ability` WAS `BUILT.ability - 100` AND IT EXPIRED AT
    // D244, WHICH IS IT WORKING.** A second slice landing in the same column makes
    // "this table's shipped count IS the whole delta" false — so the tie is
    // RE-HOMED rather than deleted (the standing rule, now paid by four slices in
    // a row): it moves to the DECOMPOSITION in the headline arithmetic below,
    // where every column-moving table drives one term. What stays here is this
    // table's own share, spelled as the constant the decomposition consumes.
    expect(ABILITY_AT_D243 - ABILITY_AT_D242).toBe(shippedIn("D243"));
    // ⚠️ **D249 — THIS LINE READ `BUILT.ability - ABILITY_AT_D244` AND WENT RED,
    // WHICH IS IT WORKING FOR THE THIRD TIME.** A live constant on the left of a
    // subtraction ties the step to HEAD, so it breaks the next time the column
    // moves for ANY reason; the pair of named snapshots ties it to D245's own
    // step and cannot. Re-homed, not deleted — and the newly-added
    // `ABILITY_AT_D245` is what the decomposition below consumes.
    expect(ABILITY_AT_D245 - ABILITY_AT_D244).toBe(
      shippedIn("D245") + TYPED_EVOLUTION_SEARCH.length,
    );
  });

  it("D245 — the evolution-stage widening's SECOND sentence, which no backlog row names", () => {
    // 🛑 THE THIRD CONSECUTIVE SLICE ON WHICH WIDENING THE ROW'S QUERY FROM ITS
    // IDS TO THE PRINTED IDIOM MOVED THE COLUMN DELTA. Row 14-B(b)-R prices
    // `typedPokemon.stage` at ONE printing; the field serves FOUR.
    for (const id of TYPED_EVOLUTION_SEARCH) {
      const search = programFor(id)?.abilities?.[0]?.program?.[0];
      expect(search, id).toEqual({
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
        dest: "hand",
        max: 2,
        reveal: true,
      });
    }
  });

  it("D244 — the ON-BENCH SWITCH family: the row's 6, and the 7th the row never named", () => {
    // 🛑 THE ROW (14-R) IS A SET OF IDS; THE OP FIELD IS A SET OF SENTENCES. The
    // row's `GROUP BY` re-derives at 6 on 1 sentence — eleventh row running — and
    // WIDENING the same query from those ids to the printed PRONOUN ("you may
    // switch it with your Active Pokémon") returns 7 legal printings on 2. The
    // seventh is why `BUILT.ability` is 114 where the prediction said 113.
    for (const [ids, built] of BENCH_SWITCH_FAMILY) {
      for (const id of ids) {
        const uses = programFor(id);
        const switches =
          uses?.triggered?.[0]?.program !== undefined || uses?.abilities?.[0] !== undefined;
        expect(switches, id).toBe(built);
      }
    }
    const shipped = BENCH_SWITCH_FAMILY.filter(([, built]) => built).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    expect(shipped).toBe(7);
    // ⚠️ **`BUILT.ability - ABILITY_AT_D243` EXPIRED AT D245 AND IS RE-HOMED, NOT
    // DELETED** — the FIFTH slice running to pay one line for that rule, and the
    // second time this exact shape has expired (D243's `BUILT.ability - 100` went
    // first). A live constant on the left of a subtraction is a tie to HEAD, so it
    // breaks whenever the column moves again; a pair of NAMED SNAPSHOTS is a tie to
    // this table's own step and cannot. The lesson is now general enough to state:
    // 🆕 **A TIE ANCHORED TO `HEAD` EXPIRES EVERY SLICE; A TIE ANCHORED TO TWO
    // NAMED COMMITS EXPIRES NEVER.** `AURA_FAMILY`'s decision column above is the
    // same repair applied one table over.
    expect(ABILITY_AT_D244 - ABILITY_AT_D243).toBe(shipped);
  });

  it("the four registry-authored legal attacks are NOT derivable — the '+4' is real", () => {
    for (const [id, text] of REGISTRY_ATTACKS) {
      const program = programFor(id);
      expect(program?.attack?.[0], `${id} has no registry attack at index 0`).toBeDefined();
      expect(resolvedByAnyReader(text), `${id}'s text became derivable`).toBe(false);
    }
    // Index-precision matters: marking a whole id built instead of one index
    // inflated an intermediate result by 1 at D187 before it was caught.
    expect(programFor("sv09-068")?.attack?.[1]).toBeUndefined();
  });

  it("the headline arithmetic closes over all four columns", () => {
    const units =
      POPULATION.attackUnits +
      POPULATION.abilityUnits +
      POPULATION.trainerUnits +
      POPULATION.specialEnergyUnits;
    expect(units).toBe(2383);

    const built = BUILT.attack + BUILT.ability + BUILT.trainer + BUILT.specialEnergy;
    // D241 — 1,243 at D240, 1,240 at D239, 1,233 at D238, 1,225 at D237, 1,215 at
    // D236, 1,206 at D235, 1,186 at D234, 1,174 at D233; the deck-top look moved 10.
    // D243 — 1,265 at D242; the seat-wide pre-W/R aura moved 7 ABILITY printings.
    // D244 — 1,272 at D243; the on-bench switch moved 7 more ABILITY printings.
    // D245 — 1,279 at D244; the aura's three narrowings plus the typed Evolution
    // deck search moved 6 more ABILITY printings.
    // ⚠️ D246 — 1,285 at D245, and the column FLIPS BACK: this slice moves 3
    // ATTACK printings and ZERO in the other three, the first attack-only slice
    // since D241 and the end of a four-slice ability run.
    // ⚠️ D247 — 1,288 at D246; the unbounded hand attach moves 4 more ATTACK
    // printings and ZERO in the other three. SECOND consecutive attack-only
    // slice, and `BUILT.ability` stands still at 120 for the third.
    // ⚠️ D248 — 1,292 at D247; the discard-pile SPREAD moves 2 more ATTACK
    // printings and ZERO in the other three. THIRD consecutive attack-only slice,
    // and `BUILT.ability` stands still at 120 for the FOURTH — which is now long
    // enough to be a fact about where the cheap work is rather than a streak.
    // ⚠️⚠️ D249 — 1,294 at D248; the heal-on-attach Ability moves 4 ABILITY
    // printings and ZERO in the other three. **THE COLUMN FLIPS BACK after a
    // four-slice attack-only run**, and `BUILT.attack` STANDS STILL at 1115 —
    // a control rather than a figure, and it holds for the reason it was named:
    // this slice touched no reader, no anchor and no destination table, so the
    // seven-reader sweep cannot have moved. The one op field it consumes
    // (`healTarget`) has been in `effects.ts` since D236 with nothing calling it.
    // ⚠️⚠️ D250 — 1,298 at D249; the TRIGGERED attach moves 2 more ABILITY
    // printings and ZERO in the other three. **SECOND CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the FIFTH — a control
    // rather than a figure, and it holds for the reason it was named again: this
    // slice touched no reader, no anchor and no destination table. The two op
    // fields it consumes (`count`, D205; `toSelf`, D221) have both been in
    // `effects.ts` for slices with a different card's name on them.
    // ⚠️⚠️ D252 — 1,305 at D251; the "and effects of attacks" prevent moves 2 more
    // ABILITY printings and ZERO in the other three. **FOURTH CONSECUTIVE
    // ability-only slice**, and `BUILT.attack` STANDS STILL at 1115 for the
    // SEVENTH — the longest run this control has had, and it holds for the reason
    // it was named every time: this slice touched no reader, no anchor and no
    // destination table. ⚠️ It DID touch `interpreter.ts`, which the previous six
    // did not, and the control still holds — the edit is a §11 GATE, and no attack
    // sentence's derivability passes through one.
    // ⚠️⚠️ D253 — 1,307 at D252; the BENCH-GATED prevent moves 3 more ABILITY
    // printings and ZERO in the other three. **FIFTH CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the EIGHTH — the
    // longest run this control has had, and it holds for the reason it was named
    // every time: this slice touched no reader, no anchor and no destination
    // table. ⚠️ It touched `interpreter.ts` and `attack.ts` BOTH, which no slice in
    // the run had done, and the control still holds — every edit is a PREVENTION
    // DISJUNCT inside a `prevented` expression, and derivability is decided by the
    // seven text readers long before any board exists to prevent on.
    // ⚠️⚠️ D254 — 1,310 at D253; the SEAT-WIDE prevent moves 1 more ABILITY
    // printing and ZERO in the other three. **SIXTH CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the NINTH — the control
    // holds for its named reason a ninth time: no reader, no anchor, no
    // destination table. ⚠️ This slice touched `continuous.ts`, `interpreter.ts`
    // AND `attack.ts`, and every edit is either a PREVENTION DISJUNCT or a scan
    // those disjuncts call; derivability is decided by the seven text readers long
    // before any board exists to prevent on.
    // ✅ **AND D253's INCREMENTED TERM IS NOW MEASURED**: the join returns 136 at
    // that commit and 137 here, so this is the only term in the table that has
    // ever been inherited and it was inherited for exactly one commit.
    // ⚠️⚠️ D255 — 1,311 at D254; the ATTACKER-RULE-BOX-CLASS prevent moves 5 more
    // ABILITY printings and ZERO in the other three. **SEVENTH CONSECUTIVE
    // ability-only slice**, and `BUILT.attack` STANDS STILL at 1115 for the TENTH
    // — the control holds for its named reason a tenth time: no reader, no anchor,
    // no destination table. ⚠️ This slice touched `cards.ts`, `continuous.ts`,
    // `interpreter.ts` AND `attack.ts` — one file more than D254 — and every edit
    // is either a PREVENTION DISJUNCT or the pure card predicate those disjuncts
    // call. **`cards.ts` is the one file in that list a text reader DOES import**,
    // which is why the control was worth naming again rather than assumed: the
    // addition is a new exported function and no existing one moved, so no
    // sentence's derivability could change.
    // 🆕 **AND THIS IS THE FIRST SLICE IN THE RUN TO MOVE THE COLUMN BY MORE THAN
    // ONE SENTENCE** — 5 printings on TWO printed sentences, which is why the
    // decomposition below gains TWO terms rather than one.
    // ⚠️⚠️ D256 — 1,316 at D255; the BENCH-WIDE Rule-Box prevention moves 2 more
    // ABILITY printings and ZERO in the other three. **EIGHTH CONSECUTIVE
    // ability-only slice**, and `BUILT.attack` STANDS STILL at 1115 for the
    // ELEVENTH — the control holds for its named reason an eleventh time: no
    // reader, no anchor, no destination table. 🆕 **AND THIS IS THE FIRST SLICE IN
    // THE PREVENTION RUN WHOSE DIFF TOUCHES NEITHER `attack.ts` NOR
    // `interpreter.ts`** — every earlier member paid disjuncts at the damage arms
    // and this one widened the funnel they already call, so the control is not
    // merely unbroken here, it is unreachable. `cards.ts` is likewise untouched:
    // `hasRuleBox` was already exported and already read by D159's Stadium, so no
    // sentence's derivability could change even in principle.
    // ⚠️⚠️ D257 — 1,318 at D256; the DAMAGE-THRESHOLD prevention moves 1 more
    // ABILITY printing and ZERO in the other three. **NINTH CONSECUTIVE
    // ability-only slice**, and `BUILT.attack` STANDS STILL at 1115 for the
    // TWELFTH — the control holds for its named reason a twelfth time: no reader,
    // no anchor, no destination table. ⚠️ This slice touched `continuous.ts`,
    // `attack.ts` and `interpreter.ts` — one file MORE than D256 and one FEWER
    // than D255 — and the reason is the whole shape of the row: D256's rule had a
    // funnel to widen and this one does not, so its four disjuncts are the price a
    // holder aura pays at the four damage arms. `cards.ts` is UNTOUCHED (the gate
    // is a number, not a card read), which is the one file in that list a text
    // reader imports, so no sentence's derivability could change even in
    // principle. 🛑 **AND THIS SLICE CLOSES BACKLOG ROW 15**: the
    // `%prevent all damage%` ability column's residue is now 3 printings on 1
    // sentence, all of them the permanently unbuildable TERA group, so the next
    // ability slice in this family needs a NEW census rather than a new row.
    // ⚠️⚠️ D258 — 1,319 at D257; the COIN-FLIP prevention moves 5 more ABILITY
    // printings and ZERO in the other three. **TENTH CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the THIRTEENTH — the
    // control holds for its named reason a thirteenth time: no reader, no anchor,
    // no destination table. ⚠️ It matters MORE here than in the twelve before it,
    // because this row's verb is SHARED: the same `%prevent%` ∧ `%coin%` sweep
    // returns 21 ATTACK printings, every one of them the durated §11 spelling. They
    // are `attackBlockOf`'s and this row is `passivesOf`'s, and the join is the
    // proof rather than the argument. ⚠️ This slice touched `continuous.ts`,
    // `attack.ts` and `interpreter.ts` — D257's three files exactly — plus `rng.ts`
    // as a READER only (`flipCoin` is imported, not changed). `cards.ts` is
    // UNTOUCHED, which is the one file in that list a text reader imports, so no
    // sentence's derivability could change even in principle.
    // ⚠️⚠️ D259 — 1,324 at D258; the TRAINER-borne effect shield moves 5 ABILITY
    // printings and ZERO in the other three. **THIRD CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the FOURTEENTH — a
    // control rather than a figure, and it holds for the named reason once more:
    // the row's own three-rung census returns ZERO attack printings, so the verb is
    // not shared and no reader, anchor or destination table was touched.
    // ⚠️⚠️ D260 — 1,329 at D259; the ATTACK-BORNE EFFECTS-ONLY shield moves 2
    // ABILITY printings and ZERO in the other three. **FOURTH CONSECUTIVE
    // ability-only slice**, and `BUILT.attack` STANDS STILL at 1115 for the
    // FIFTEENTH. 🛑 **AND HERE THE CONTROL IS NOT VACUOUS, WHICH IS THE FIRST TIME
    // IN FOUR SLICES**: this row's WIDE ladder rung returns **17 ATTACK printings**
    // on 2 sentences — the durated §11 spelling, "during your opponent's next turn,
    // prevent all damage from and effects of attacks done to this Pokémon", BUILT
    // since D142. They are `attackBlockOf`'s and this row is `passivesOf`'s, and
    // the join is the proof rather than the argument. ⚠️ This slice touched
    // `continuous.ts`, `registry.ts` and `interpreter.ts` only; `cards.ts`,
    // `effects.ts` and `attack.ts` are UNTOUCHED, and `cards.ts` is the one a text
    // reader imports, so no sentence's derivability could change even in principle.
    // ⚠️⚠️ D261 — 1,331 at D260; the SPECIAL ENERGY column's two cheapest rows move
    // 2 SPECIAL ENERGY printings and ZERO in the other three. 🛑 **AND THIS IS THE
    // FIRST SLICE SINCE D239 TO MOVE THIS COLUMN AT ALL** — it ends a run of
    // sixteen consecutive slices in which `BUILT.specialEnergy` stood at 2, and it
    // ends the four-slice ability-only run above it. `BUILT.attack` STANDS STILL at
    // 1115 for the SIXTEENTH and `BUILT.ability` at 157: the controls hold for
    // their named reason, because this slice touched NO reader, NO anchor and NO
    // destination table. ⚠️ The engine diff is `registry.ts` and **one guarded line
    // in `turn.ts`**; `continuous.ts`, `interpreter.ts`, `attack.ts`, `cards.ts`,
    // `effects.ts` and `types.ts` are all UNTOUCHED — `cards.ts` is the one a text
    // reader imports, so no sentence's derivability could change even in principle.
    // 🆕 D262 — 1,333 at D261; the SPECIAL ENERGY column's CONDITIONAL provision
    // moves 1 SPECIAL ENERGY printing and ZERO in the other three. SECOND
    // consecutive slice in this column, and the first time since D239 that it has
    // moved twice running. `BUILT.attack` STANDS STILL at 1115 for the
    // SEVENTEENTH and `BUILT.ability` at 157 for the second: the controls hold for
    // their named reason, because this slice touched NO reader, NO anchor and NO
    // destination table. ⚠️ The engine diff is `registry.ts`, `continuous.ts`
    // (`unitsOf`'s signature + one arm) and `cards.ts` (`isStage2Pokemon`).
    // 🛑 `cards.ts` IS TOUCHED THIS TIME, AND IT IS THE ONE A TEXT READER IMPORTS
    // — so unlike D260 and D261 the "no sentence's derivability could change even
    // in principle" argument is NOT available here, and the claim is a measurement
    // instead: the change is a PURE ADDITION (`isStage2Pokemon`, a new exported
    // predicate with one caller in `continuous.ts`), no existing function in that
    // module was edited, and the full suite came back with exactly ONE red in 284
    // files — the residue enumeration this slice deliberately re-homed.
    // 🆕 D263 — 1,334 at D262; the ABILITY half of backlog row 9 moves **7 ABILITY
    // printings** and ZERO in the other three. `BUILT.attack` STANDS STILL at 1115
    // for the **EIGHTEENTH** consecutive slice and `BUILT.specialEnergy` at 5:
    // the controls hold for their named reason, because this slice touched NO
    // reader, NO anchor and NO destination table — the whole engine diff is
    // `registry.ts`, and `effects.ts`, `interpreter.ts`, `cards.ts`, `attack.ts`,
    // `continuous.ts`, `types.ts`, `turn.ts`, `redact.ts`, `log.ts` and `apps/api`
    // all take a **ZERO diff**. 🛑 **AND THE ATTACK CONTROL IS EMPHATICALLY NOT
    // VACUOUS HERE, WHICH IS WHAT MAKES IT WORTH ASSERTING**: this row's own
    // ladder returns **17 ATTACK printings on 12 sentences** sharing the verb, the
    // noun and the source zone, of which `DISCARD_ATTACH` already reads 15. They
    // are a DERIVER's and these three are the REGISTRY's, and the join is the
    // proof rather than the argument. ⚠️ 7 is also the largest single-slice move
    // this column has seen since D243.
    // 🆕 D264 — 1,341 at D263; backlog row 13's ABILITY and TRAINER halves move
    // **2 ABILITY + 3 TRAINER printings** and ZERO in the other two. FIRST slice
    // in a long while to move TWO non-attack columns at once, and it is the row's
    // shape rather than the slice's ambition: `discardPileRetrieval` is one op
    // whose printed sentence appears on both surfaces, so one ladder over one zone
    // surfaced an Ability and a Supporter together. `BUILT.attack` STANDS STILL at
    // 1115 for the **NINETEENTH** consecutive slice and `BUILT.specialEnergy` at 5
    // for the third. 🛑 **AND THAT ATTACK CONTROL IS NOT VACUOUS HERE EITHER, BUT
    // FOR A SHARPER REASON THAN D263's**: this slice DOES touch `cards.ts`
    // (`matchesFilter`'s `anyPokemon` arm) and `interpreter.ts` (`retrieveNoun`),
    // both of which a text reader imports — so the "could not change in principle"
    // argument is unavailable and the claim is a measurement. Both changes are
    // gated on an OPTIONAL rider that defaults absent (`noRuleBox`, `cardNoun`), no
    // existing arm was edited, and `HAND_SEARCH_NOUNS` — the table the attack-side
    // anchors dispatch on — deliberately gains NO row, because no ATTACK sentence
    // in the catalog prints either noun. `effects.ts`'s derivers, `attack.ts`,
    // `continuous.ts`, `turn.ts`, `redact.ts`, `log.ts` and `apps/api` all take a
    // ZERO diff.
    // 🆕 D265 — 1,346 at D264; the HP-THRESHOLD `CardFilter` rider moves **2
    // ABILITY + 3 TRAINER printings** and ZERO in the other two. 🛑 **THE FIRST
    // SLICE IN THIS SEQUENCE WHOSE ROW SPANS TWO OPS RATHER THAN TWO SURFACES**:
    // Alomomola "Gentle Fin" is `discardPileRetrieval` and Buddy-Buddy Poffin is
    // `searchDeck`, and what carries them both is ONE union rider
    // (`basicPokemon.maxHp`) read by `cards.ts matchesFilter` and `interpreter.ts
    // retrieveNoun`. `BUILT.attack` STANDS STILL at 1115 for the **TWENTIETH**
    // consecutive slice and `BUILT.specialEnergy` at 5 for the fourth. 🛑 **AND
    // THE ATTACK CONTROL IS A MEASUREMENT HERE, NOT AN ARGUMENT** — for D264's
    // reason repeated: this slice edits `cards.ts` and `interpreter.ts`, both of
    // which a text reader imports. The rider is OPTIONAL and defaults absent, no
    // existing arm was edited, no anchor was widened, and `HAND_SEARCH_NOUNS`
    // deliberately gains NO row because no ATTACK sentence in the legal pool
    // prints an HP threshold at all (the phrase's 15 legal printings are 9
    // ability/effect card reads and 6 board reads; **zero** are `attacks_json`).
    // `effects.ts`'s derivers, `attack.ts`, `continuous.ts`, `turn.ts`,
    // `redact.ts`, `log.ts` and `apps/api` all take a ZERO diff.
    // 🆕 D266 — 1,351 at D265; the TYPE GATE on `healEach` moves **3 TRAINER
    // printings** and ZERO in the other three (Clemont's Quick Wit `sv08-167` and
    // its two alternate-art reprints, ONE sentence, ONE surface — the narrowest
    // row in this sequence since D251). `BUILT.attack` STANDS STILL at 1115 for
    // the **TWENTY-FIRST** consecutive slice, `BUILT.ability` at 168 and
    // `BUILT.specialEnergy` at 5. 🛑 **AND THE ATTACK CONTROL IS AN ARGUMENT HERE
    // RATHER THAN A MEASUREMENT, WHICH IS THE WEAKER FORM AND IS SAID SO.** This
    // slice edits `interpreter.ts`, which a text reader imports — but the diff is
    // ONE optional op field (`healEach.pokemonType`, absent = the ungated
    // sentence) plus ONE conjunct inside `healEach`'s existing loop. No deriver
    // arm, no anchor, no regex and no clause table was touched: `effects.ts`'s
    // only diff is the union member's TYPE and its doc, and `cards.ts`,
    // `attack.ts`, `continuous.ts`, `turn.ts`, `redact.ts`, `log.ts` and
    // `apps/api` all take a ZERO diff. ⚠️ The catalog half of the trainer join
    // could not be re-run in this container — see `BUILT.trainer`'s own note.
    // 🆕 D267 — 1,354 at D266; the STAGE GATE on `noRetreatCostAura` moves **3
    // ABILITY printings** and ZERO in the other three (Latias ex "Skyliner"
    // `sv08-076` and its two alternate-art reprints, ONE sentence, ONE surface).
    // `BUILT.attack` STANDS STILL at 1115 for the **TWENTY-SECOND** consecutive
    // slice, `BUILT.trainer` at 66 and `BUILT.specialEnergy` at 5. ✅ **AND THE
    // JOIN D266 COULD ONLY RUN AT ONE END RAN AT BOTH ENDS HERE** — the catalog
    // is reachable again and 168 / 66 / 5 came back unchanged at `34ebc20`, so
    // the previous slice's inherited figure is retired in favour of a measured
    // one. 🛑 **THE ATTACK CONTROL IS A MEASUREMENT HERE RATHER THAN AN
    // ARGUMENT**, which is the stronger form: this slice does not touch
    // `interpreter.ts`, `effects.ts`, `attack.ts`, `cards.ts`, `turn.ts`,
    // `redact.ts`, `log.ts` or `apps/api` at all — the whole engine diff is ONE
    // optional field on an existing `passive` record plus ONE conjunct inside
    // `continuous.ts hasFreeRetreatAura`, a function no text reader imports.
    // 🆕 D268 — 1,357 at D267; `handRefresh.who: "opponent"` moves **2 ABILITY
    // printings** and ZERO in the other three (Gothitelle "Distorted Future"
    // `svp-211` and `sv10.5w-043`, ONE sentence, ONE surface — a PROMO and a SET
    // printing of the same card rather than an alternate-art pair). `BUILT.attack`
    // STANDS STILL at 1115 for the **TWENTY-THIRD** consecutive slice,
    // `BUILT.trainer` at 66 and `BUILT.specialEnergy` at 5, and the join ran at
    // BOTH ends (402 → 404 ids; 171 / 66 / 5 → 173 / 66 / 5). 🛑 **THE ATTACK
    // CONTROL IS A MEASUREMENT RATHER THAN AN ARGUMENT**: the engine diff is ONE
    // union member in `effects.ts` plus ONE ternary in `interpreter.ts`'s existing
    // `handRefresh` seat funnel, and `cards.ts`, `attack.ts`, `continuous.ts`,
    // `turn.ts`, `redact.ts`, `log.ts` and `apps/api` all take a ZERO diff.
    // 🆕 D269 — 1,359 at D268; `coinFlipGate.otherwise` moves **3 TRAINER
    // printings** and ZERO in the other three (Picnicker `svp-114`, Drasna
    // `sv08-173`/`-231` — 2 sentences, 1 surface). `BUILT.attack` STANDS STILL at
    // 1115 for the **TWENTY-FOURTH** consecutive slice, `BUILT.specialEnergy` at
    // 5, and 🛑 `BUILT.ability` STANDS STILL at 173 TOO — the first slice in
    // eleven not to move that column, which is why the decomposition below gains
    // no term. The join ran at BOTH ends (404 → 407 ids; 173 / 66 / 5 →
    // 173 / 69 / 5) and the delta was DIFFED, not counted. 🛑 **THE ATTACK
    // CONTROL IS A MEASUREMENT RATHER THAN AN ARGUMENT**: the engine diff is ONE
    // optional field in `effects.ts`, ONE `?? []` at `interpreter.ts`'s existing
    // gate splice and ONE `or` in `cardplay.ts`'s descent, and `cards.ts`,
    // `attack.ts`, `continuous.ts`, `turn.ts`, `redact.ts`, `log.ts` and
    // `apps/api` all take a ZERO diff — no text reader is touched, so no derived
    // attack sentence can have moved.
    // 🆕 D270 — 1,362 at D269; `HandRefreshDraw.perSeat` moves **2 TRAINER
    // printings** and ZERO in the other three (Harlequin `sv10.5w-083`/`-163` —
    // ONE sentence, 1 surface). `BUILT.attack` STANDS STILL at 1115 for the
    // **TWENTY-FIFTH** consecutive slice, `BUILT.specialEnergy` at 5, and
    // `BUILT.ability` at 173 for the SECOND slice running. The join ran at BOTH
    // ends (407 → 409 ids; 173 / 69 / 5 → 173 / 71 / 5) and the delta was DIFFED,
    // not counted. 🛑 **THE ATTACK CONTROL IS A MEASUREMENT RATHER THAN AN
    // ARGUMENT**: the engine diff is ONE union member in `effects.ts` and ONE
    // `case` plus ONE parameter in `interpreter.ts`'s existing per-seat draw
    // helper, and `cards.ts`, `attack.ts`, `continuous.ts`, `turn.ts`, `redact.ts`,
    // `log.ts`, `cardplay.ts` and `apps/api` all take a ZERO diff — no text reader
    // is touched, so no derived attack sentence can have moved.
    // 🆕 D271 — **1364 → 1367.** Three Trainer printings on ONE sentence; the
    // engine diff is ONE new `GameState` field (`lastKoTurn`), ONE union member in
    // `effects.ts`, ONE stamp in `flow.ts`'s `knockOut` and two `case`s in
    // `interpreter.ts`. `cards.ts`, `attack.ts`, `continuous.ts`, `turn.ts`,
    // `redact.ts`, `log.ts` and `cardplay.ts` all take a ZERO diff — no text
    // reader is touched, so no derived ATTACK sentence can have moved, and
    // `BUILT.attack` holds at 1115 for the twenty-sixth consecutive slice.
    // 🆕 D272 — **1367 → 1370.** Three POKÉMON printings on ONE sentence, so the
    // move is entirely in `BUILT.ability` (173 → 176) and `BUILT.attack` STANDS
    // STILL at 1115 for the **TWENTY-SEVENTH** consecutive slice. 🛑 **THE ATTACK
    // CONTROL IS A MEASUREMENT RATHER THAN AN ARGUMENT**: the engine diff is ONE
    // optional `AbilityProgram` field, ONE widened `AbilityProgram` field, ONE
    // reject code and ONE new gate in `useAbility`, and `effects.ts`,
    // `interpreter.ts`, `cards.ts`, `attack.ts`, `continuous.ts`, `turn.ts`,
    // `flow.ts`, `log.ts` and `apps/api` ALL take a ZERO diff — no text reader is
    // touched, so no derived attack sentence can have moved.
    // ⚠️⚠️ 🆕 **D273 — 1,370 at D272; Pecharunt ex's chained switch moves 5 ABILITY
    // printings and ZERO in the other three. SECOND CONSECUTIVE ability-only
    // slice**, and `BUILT.attack` STANDS STILL at 1115 for the **TWENTY-EIGHTH**.
    // 🛑 **THE ATTACK CONTROL IS A MEASUREMENT RATHER THAN AN ARGUMENT AGAIN, AND
    // THIS SLICE HAD TO WORK FOR IT.** The engine diff is TWO optional
    // `switchActive` fields, TWO small `interpreter.ts` helpers and ONE widened
    // prompt — and `effects.ts`'s diff is the OP UNION ONLY: not one of the seven
    // exported derivers, not one anchor, not one destination table. `cards.ts`,
    // `attack.ts`, `continuous.ts`, `turn.ts`, `flow.ts`, `log.ts`, `apps/api`,
    // `packages/schema` and `src/` all take a ZERO diff. No text reader is touched,
    // so no derived attack sentence can have moved.
    // 🆕 D275 — **1375 → 1377**, and `BUILT.attack` STANDS STILL at 1115 for the
    // **TWENTY-NINTH** slice. THE ATTACK CONTROL IS A MEASUREMENT AND NOT AN
    // ARGUMENT: the engine diff is ONE `BoardCondition` member, ONE optional
    // `CardFilter` property, ONE extracted `types.ts` reader (with its three
    // existing call sites re-pointed at it) and TWO `interpreter.ts` arms — and
    // `effects.ts`'s diff is the two UNIONS ONLY, not one of the seven exported
    // derivers, not one anchor, not one destination table. `cards.ts` moves, but
    // inside `matchesFilter`'s `typedPokemon` arm and nowhere a deriver reads.
    // `attack.ts`, `continuous.ts`, `flow.ts`, `log.ts`, `apps/api`,
    // `packages/schema` and `src/` all take a ZERO diff. **And this is no longer
    // an argument at all since D274: the corpus guard RE-RUNS the seven readers
    // over all 640 legal attack sentences on every `bun run check`, so 1115
    // standing still is a live measurement that would have gone red on its own.**
    // 🆕 D277 — **1377 → 1380**, and `BUILT.attack` STANDS STILL at 1115 for the
    // **THIRTIETH** slice. ⚠️ **AND THIS SLICE IS THE FIRST IN A WHILE WHOSE DIFF
    // TOUCHES `attack.ts` AND `continuous.ts`**, which the D275 note above lists
    // among the files that took a zero diff — so the control is worth restating
    // rather than inheriting. The engine diff is ONE `PassiveEffects` boolean, ONE
    // term in the `passivesOf` fold, ONE new `continuous.ts` predicate
    // (`firstTurnAttackBanned`) and THREE call sites re-pointed at it from a
    // literal `state.turn === 1` (`attack.ts`'s §8 gate, `redact.ts`'s `banned`,
    // GameHud). `effects.ts` takes a ZERO diff — not one of the seven exported
    // derivers, not one anchor, not one destination table, not one union — and
    // `cards.ts`, `turn.ts`, `flow.ts`, `log.ts`, `apps/api` and `packages/schema`
    // take one too. The 1115 is a live measurement either way (D274's corpus
    // guard re-runs the seven readers over all 640 legal attack sentences on every
    // `bun run check`), and it did not move.
    // 🆕 D278 — **1380 → 1383**, and `BUILT.attack` STANDS STILL at 1115 for the
    // **THIRTY-FIRST** slice. ⚠️ **THE CONTROL IS RESTATED RATHER THAN INHERITED
    // FOR THE SECOND SLICE RUNNING, BECAUSE THIS DIFF TOUCHES `turn.ts` — a file
    // BOTH notes above list among the zero-diff ones.** The engine diff is ONE
    // `PassiveEffects` boolean (`evolveEarlyExempt`), ONE zone-gated term in the
    // `passivesOf` fold, ONE new `continuous.ts` predicate (`evolveEarlyLicensed`)
    // and FIVE ban lines re-pointed at it across `turn.ts` (`evolve`) and
    // `cardplay.ts` (`rareCandy`, `rareCandyOptions`). `effects.ts` takes a ZERO
    // diff — not one of the seven exported derivers, not one anchor, not one
    // destination table, not one union — and `cards.ts`, `attack.ts`, `flow.ts`,
    // `log.ts`, `redact.ts`, `apps/api`, `packages/schema` and `src/` take one
    // too. **The evolve licence is a PLAY-LEGALITY rule and touches no damage or
    // text path at all**, which is why the attack column cannot have moved; and
    // the 1115 is a live measurement regardless (D274's corpus guard).
    // 🆕 D280 — **1387 → 1388**, `BUILT.attack` STANDS STILL at 1115 for the
    // **THIRTY-THIRD** slice, and the step is **+1**: the smallest this headline
    // has moved in the whole run of slices recorded above. ⚠️ **THE CONTROL IS
    // RESTATED RATHER THAN INHERITED FOR THE FOURTH SLICE RUNNING, AND THIS TIME
    // `effects.ts` IS *NOT* ZERO** — the diff adds TWO `BoardCondition` union
    // members (`youGoSecond`, `allOf`), which is the vocabulary and not a
    // deriver. Checked explicitly, because "effects.ts changed" is the sentence
    // that would make an attack-column standstill suspicious: not one of the
    // seven exported derivers, not one anchor, not one destination table and not
    // one CLAUSE TABLE row moved — `ATTACK_REQUIREMENT_CLAUSES`,
    // `CONDITIONAL_DAMAGE_CLAUSES` and every regex above them take a byte-zero
    // diff, so no printed attack SENTENCE resolves differently and the 1115
    // cannot have moved. `attack.ts`, `continuous.ts`, `turn.ts`, `flow.ts`,
    // `log.ts`, `redact.ts`, `cards.ts`, `apps/api`, `packages/schema` and `src/`
    // all take a zero diff too; the two files that move are `interpreter.ts`
    // (the two new `switch` arms) and `registry.ts` (one row). The 1115 is a live
    // measurement regardless (D274's corpus guard).
    // 🆕 D281 — **1388 → 1401**, `BUILT.attack` STANDS STILL at 1115 for the
    // **THIRTY-FOURTH** slice, and the step is **+13** — the largest in this run.
    // ⚠️ **THE CONTROL IS RESTATED RATHER THAN INHERITED FOR THE FIFTH SLICE
    // RUNNING, AND THE ATTACK-COLUMN STANDSTILL IS THE INTERESTING HALF HERE
    // BECAUSE ALL 13 PRINTINGS ARE ATTACKS.** `effects.ts` takes a BYTE-ZERO
    // diff this time — no new union member, no anchor, no clause-table row, and
    // none of the seven exported derivers is touched — so no printed attack
    // SENTENCE resolves differently and 1115 cannot have moved. That is the
    // honest reading of a GATE-ONLY slice: the 13 printings gain a legality gate
    // at the §8 seam and their five printed BODIES are still refused, each on a
    // mechanism named by id in `registry.ts`. **13 gates built, 0 bodies.**
    // The files that move are `registry.ts` (one type, one field, five rows),
    // `continuous.ts` (one widened predicate + one reader), `interpreter.ts`
    // (one reader + one note), `attack.ts`, `redact.ts`, `index.ts` and `src/`'s
    // GameHud — the three payability projections and their shared readers.
    // `turn.ts`, `flow.ts`, `log.ts`, `cards.ts`, `apps/api` and
    // `packages/schema` take a zero diff. The 1115 is a live measurement
    // regardless (D274's corpus guard).
    // 🆕 D282 — **1401 → 1415, AND THE WHOLE +14 IS IN `BUILT.attack`**, which
    // moves for the FIRST TIME IN THIRTY-FIVE SLICES (1115 → 1129). The inverse
    // of D281's shape, one slice later and on the same 13 printings: that slice
    // took a byte-zero `effects.ts` diff and moved only the non-attack pool; this
    // one takes a byte-zero REGISTRY diff — no new row, no new field, no new
    // program — and moves only the attack column. 🛑 **`BUILT.ability` STANDS
    // STILL AT 206 AND THAT IS NOT AN OVERSIGHT**: all 13 gated ids were already
    // in the non-attack pool at D281 (a gate-only row joins it), and this slice
    // authors no new registry surface at all, so the NEGATIVE pool predicate has
    // nothing new to catch. The +14 is 6 raw printings (`yourBenchCount` on both
    // folds) + 8 split printings (Terapagos ex ×7, Volbeat `sv06-009`).
    // 🆕 D283 — **1415 → 1423, AND THE WHOLE +8 IS IN `BUILT.attack` AGAIN**
    // (1129 → 1137), for the second slice running and by two routes at once (6
    // raw + 2 split — see `BUILT.attack`'s own block). 🛑 **`BUILT.ability`
    // STANDS STILL AT 206 FOR THE THIRD SLICE RUNNING AND THE REASON IS THE
    // OPPOSITE OF D281's**: this slice authors NO registry surface at all — the
    // eight printings are TEXT-keyed through the derivers, and Scream Tail ex's
    // existing row keeps its bare `attackGate` — so the non-attack pool cannot
    // move. `registry.ts` takes a PROSE-ONLY diff (one refusal re-derived into a
    // build note) and `packages/schema` takes a zero diff; `apps/api` moves for
    // `MATCH_RECORD_VERSION` alone.
    // 🆕 D284 — **1423 → 1427, AND THE WHOLE +4 IS IN `BUILT.ability`** (206 →
    // 210), which is D283's shape exactly INVERTED: every printing here is an
    // ABILITY, so `BUILT.attack` stands still at 1137 and the attack surface takes
    // a PROSE-ONLY diff (one stale refusal re-derived). ⚠️ **AND THE +4 IS NOT THE
    // FAMILY'S SIZE**: the census returned 7 legal printings and three are refused
    // by NAME on the field. `packages/schema` takes a zero diff and `apps/api`
    // does too — `MATCH_RECORD_VERSION` does NOT move, because the widened class
    // vocabulary (`HandPlayClass` + `"Tool"`) is deliberately NOT the persisted
    // record's key type (`StampedHandPlayClass`).
    // 🆕 D287 — **1429 → 1430, AND THE WHOLE +1 IS IN `BUILT.ability`** (211 →
    // 212), D284's shape at one printing: the row is an ABILITY, so `BUILT.attack`
    // stands still at 1138 and the attack surface takes a PROSE-ONLY diff. ⚠️ **AND
    // THE +1 IS NOT THE FAMILY'S SIZE, IT IS ITS REMAINDER** — D284's census
    // returned 7 legal printings and this is the SEVENTH-and-last Trainer-surface
    // one; the single survivor is refused on an axis this vocabulary cannot spell.
    // 🆕 D294 — 1,431 at D293; the cross-seat destination moves the ABILITY
    // column by 2 and no other. Re-derived off the live registry join, not
    // incremented: the partition named both ids while this line was still green.
    // 🆕 D295 — 1,433 at D294; the victim-zone destination moves the TRAINER
    // column by 1 and no other. Re-derived off the live registry join, not
    // incremented: the partition named `sv08-166` while this line was still green.
    expect(built).toBe(1434);
    // The UNBUILT remainder falls by exactly 2 (1,024 → 1,021 → 1,019), which is
    // the same 2 printings arriving from the other side of the same total.
    // 🆕 D272 — **1016 → 1013**, the mirror of `built` 1367 → 1370. Unlike
    // `BUILT.ability`, THIS number IS derived (`units` comes off the live catalog
    // join), which is why it reddened on its own the moment `built` moved and
    // `BUILT.ability` did not.
    // 🆕 D273 — **1013 → 1008**, the mirror of `built` 1370 → 1375. Still the
    // derived half: `units` comes off the live catalog join and this number has
    // never needed a hand bump. As of this slice it is no longer the ONLY derived
    // thing on the page — the partition at the foot of the file joined it.
    // 🆕 D275 — **1008 → 1006**, the mirror of `built` 1375 → 1377. Still the
    // derived half, and still the number that reddens without being asked.
    // 🆕 D277 — **1006 → 1003**, the mirror of `built` 1377 → 1380. Still the
    // derived half, and it reddened on its own the moment `BUILT.ability` moved.
    // 🆕 D278 — **1003 → 1000**, the mirror of `built` 1380 → 1383, and the
    // DERIVED half of the pair: it reddened on its own the moment `BUILT.ability`
    // moved (`units` comes off the live catalog join), which is what makes the
    // hand-maintained constant's edit checkable rather than self-confirming.
    // 🆕 D280 — **996 → 995**, the mirror of `built` 1387 → 1388, and the DERIVED
    // half of the pair for the fourth consecutive slice: it reddened on its own
    // the moment `BUILT.trainer` moved (`units` comes off the live catalog join),
    // which is what makes the hand-maintained constant's edit checkable rather
    // than self-confirming. ⚠️ **AND THIS SLICE IS THE FIRST TO WATCH IT REDDEN
    // OFF `BUILT.trainer` RATHER THAN `BUILT.ability`** — the tie is over the SUM
    // of all four columns, so it does not care which one moved, and that is worth
    // one line because five consecutive slices could have read it as an
    // ability-column instrument.
    // 🆕 D281 — **995 → 982**, the mirror of `built` 1388 → 1401, and the DERIVED
    // half of the pair for the fifth consecutive slice: it reddened on its own the
    // moment `BUILT.ability` moved (`units` comes off the live catalog join),
    // which is what makes the hand-maintained constant's edit checkable rather
    // than self-confirming.
    // 🆕 D282 — **982 → 968**, the mirror of `built` 1401 → 1415 and the first
    // time in 35 slices this remainder has fallen because of the ATTACK column.
    // 🆕 D283 — **968 → 960**, the mirror of `built` 1415 → 1423, and the SECOND
    // slice running in which this remainder falls because of the ATTACK column.
    // Derived off the live catalog join, so it reddens on its own.
    // 🆕 D284 — **960 → 956**, the mirror of `built` 1423 → 1427, and the first
    // time in three slices this remainder falls because of the ABILITY column.
    // Derived off the live catalog join, so it reddened on its own — but ⚠️ it did
    // NOT redden FIRST: the partition guard at the foot of the file named all four
    // ids while this line was still green, because `built` had not moved yet.
    // **THE ORDER THE GUARDS FIRE IN IS ITSELF INFORMATION** — the partition sees a
    // registry row, this tie sees a constant, and only the first can catch a row
    // that shipped without a census visit.
    // 🆕 D287 — **954 → 953**, the mirror of `built` 1429 → 1430 and the SECOND
    // consecutive slice in which this remainder falls because of the ABILITY column.
    // Derived off the live catalog join, so it reddens on its own — and it did NOT
    // redden first: the partition named `sv06.5-042` while this line was still
    // green, for D284's reason exactly.
    // 🆕 D294 — **952 → 950**, the mirror of `built` 1431 → 1433 and the THIRD
    // fall in this run caused by the ABILITY column. Derived off the live catalog
    // join, so it reddens on its own — and it did NOT redden first: the partition
    // named both Mandibuzz ids while this line was still green, for D284's reason.
    // 🆕 D295 — **950 → 949**, the mirror of `built` 1433 → 1434 and the DERIVED
    // half of the pair for the umpteenth slice: it reddened on its own the moment
    // `BUILT.trainer` moved, which is what makes the hand-maintained constant's
    // edit checkable rather than self-confirming.
    expect(units - built).toBe(949);

    // 🆕 D261 — **THE SPECIAL ENERGY COLUMN GETS ITS FIRST DECOMPOSITION**, the same
    // shape the ability column has carried since D243 and for the same reason: a
    // hand-maintained constant with no tie can move without anybody saying why. Two
    // terms because this slice moves the column by TWO printed sentences, and terms
    // that are SENTENCES rather than slices are the only shape under which "which
    // printing moved the number" stays answerable (D258/D259/D260's rule, applied to
    // a new column). ⚠️ AND, LIKE THOSE THREE PAIRS, THE TWO TERMS ARE NOT THE SAME
    // MECHANISM — one is a `passivesOf` fold key and the other an `EnergyOnAttach`
    // arm — so a single term would have hidden a fold/arm split behind one number.
    // 🆕 D262 — A FOURTH TERM, and the decomposition earning its keep one slice
    // after it was built: the constant above is hand-maintained and cannot redden
    // itself, so the only thing standing between "5" and a silent drift is a term
    // per sentence with the ids spelled out.
    expect(BUILT.specialEnergy).toBe(
      SPIKY_ENERGY_IDS.length +
        MIST_ENERGY_IDS.length +
        ENRICHING_ENERGY_IDS.length +
        NEO_UPPER_ENERGY_IDS.length,
    );
    for (const id of [
      ...SPIKY_ENERGY_IDS,
      ...MIST_ENERGY_IDS,
      ...ENRICHING_ENERGY_IDS,
      ...NEO_UPPER_ENERGY_IDS,
    ]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // ⚠️ AND SPIKY's TERM IS ONE OBJECT SHARED BY BOTH IDS — two printings of ONE
    // card, so a second object or a duplicated id would inflate the column while
    // leaving the arithmetic identical.
    expect(programFor("sv09-159")).toBe(programFor("sv09-190"));
    expect(new Set(SPIKY_ENERGY_IDS).size).toBe(SPIKY_ENERGY_IDS.length);

    // ⚠️ **THE DECOMPOSITION, WHICH IS WHERE D243's EXPIRED TIE WAS RE-HOMED.**
    // Every table in this file that moved the ability column drives one term, so
    // a table and the constant can never drift apart in silence — and adding a
    // fourth column-moving slice makes this line go RED rather than quiet, which
    // is the property `BUILT.ability - 100` lost the moment D244 landed.
    const auraShipped = AURA_FAMILY.filter(([, built]) => built !== null).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    const switchShipped = BENCH_SWITCH_FAMILY.filter(([, built]) => built).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    // ⚠️ **D245 ADDS THE FOURTH TERM AND THE DECOMPOSITION HELD, WHICH IS THE
    // RE-HOME PAYING OFF.** D243's tie was a literal (`BUILT.ability - 100`) and
    // went quiet the moment a second slice moved the column; this line went RED at
    // D245 and had a term added, which is what a tie is for.
    // ⚠️⚠️ **D249 ADDS THE FIFTH TERM, AND THIS IS THE FIRST TIME THE PROPERTY
    // HAS BEEN EXERCISED BY A SLICE THAT WAS TOLD IT WOULD BE.** D248's handoff
    // predicted this line would go RED rather than quiet the next time a table
    // moved the ability column, and it did — with `RIPENING_CHARGE_IDS` as the
    // new term. A decomposition that names every contributing table is the only
    // shape under which "the column moved and nobody said why" is impossible.
    // ⚠️⚠️ **D251 ADDS THE SEVENTH TERM — THREE CONSECUTIVE SLICES, EACH TOLD IT
    // WOULD BE.** 🆕 **AND D251 IS THE ONE THAT FOUND OUT HOW THE PROPERTY ACTUALLY
    // FIRES, WHICH IS NOT WHAT THREE HANDOFFS IN A ROW HAVE SAID.** `BUILT` is a
    // hand-authored MEASUREMENT table, not a runtime derivation — so authoring the
    // five registry rows left this line GREEN, and it went red only when the
    // measurement was bumped to the re-derived 131. **The tie catches "the constant
    // moved and nobody said why", NOT "the column moved and nobody noticed"** — a
    // slice that shipped programs and never re-ran the join would sail past it. The
    // guard against THAT is the re-derivation discipline itself, and this line is
    // its second half rather than its whole.
    // ⚠️⚠️ **D250 ADDED THE SIXTH TERM, AND THE PROPERTY HAD THEN FIRED ON TWO
    // CONSECUTIVE SLICES THAT WERE BOTH TOLD IT WOULD.** D249's handoff predicted
    // this line would go RED and want a sixth term; it did. A decomposition that
    // names every contributing table is the only shape under which "the column
    // moved and nobody said why" is impossible — and the two slices that
    // exercised it are the evidence that the shape survives being ROUTINE, which
    // a tie that only ever fires once cannot show.
    // ⚠️⚠️ **D252 ADDS THE EIGHTH TERM, AND THE PROPERTY HAS NOW FIRED ON THREE
    // CONSECUTIVE SLICES THAT WERE ALL TOLD IT WOULD.** D251's handoff predicted
    // this line would go RED and want an eighth term; it did, for the same reason
    // D249's and D250's did. **A decomposition whose every term is a NAMED ROW is
    // the only shape under which "the column moved and nobody said why" is
    // impossible, and three routine firings are better evidence of that than one
    // dramatic one.**
    // ⚠️⚠️ **D253 ADDS THE NINTH TERM — FOUR CONSECUTIVE SLICES — AND IT IS ALSO
    // THE SLICE THAT SHOWS THE TIE'S CEILING.** D251 established that this line
    // catches "the constant moved and nobody said why" and NOT "the column moved
    // and nobody noticed". D253 adds the other half: it also cannot catch "the
    // constant moved for a reason nobody could VERIFY". The remote D1 was
    // unreachable this session, so `BUILT.ability` was incremented from a
    // transcribed census row rather than re-derived by the join — and this line
    // ties green either way, because 133 + 3 = 136 is true whether or not the 3 is.
    // **So the decomposition guards the ARITHMETIC and the join guards the CENSUS,
    // and a slice that cannot run the join has one guard and not two.** Recorded
    // here rather than in a commit message because the next reader of this number
    // needs it more than the next reader of the log does.
    expect(BUILT.ability).toBe(
      ABILITY_AT_D242 +
        auraShipped +
        switchShipped +
        TYPED_EVOLUTION_SEARCH.length +
        RIPENING_CHARGE_IDS.length +
        BATTLE_HARDENED_IDS.length +
        CORNERSTONE_STANCE_IDS.length +
        MIGHTY_SHELL_IDS.length +
        CURIOUS_TEA_PARTY_IDS.length +
        SPHERICAL_SHIELD_IDS.length +
        PREVENT_FROM_EX_IDS.length +
        PREVENT_FROM_BASIC_EX_IDS.length +
        FLOWER_CURTAIN_IDS.length +
        IMPERVIOUS_SHELL_IDS.length +
        ADRENA_PHEROMONE_IDS.length +
        EXPERT_HIDER_IDS.length +
        UNNERVE_IDS.length +
        WIDE_WALL_IDS.length +
        UNAWARE_IDS.length +
        REPELLING_VEIL_IDS.length +
        // 🆕 D263 ADDS THE TWENTY-FIRST, -SECOND AND -THIRD TERMS — and it is the
        // FIRST slice to add THREE at once, which is the decomposition doing
        // exactly what D258 said it was for. This line went RED the moment
        // `BUILT.ability` was bumped to the re-derived 164 (never before it —
        // D251's finding, confirmed a sixth time: the tie guards the ARITHMETIC,
        // the join guards the CENSUS).
        ASSEMBLE_ALLOY_IDS.length +
        CHARGING_UP_IDS.length +
        DYNAMOTOR_IDS.length +
        // 🆕 D263's handoff predicted this line would go RED and want a
        // twenty-fourth term the next time a table moved the ability column, and
        // it did — for the seventh time, and never before `BUILT.ability` itself
        // was bumped to the re-derived 166. **The tie guards the ARITHMETIC; the
        // join guards the CENSUS.**
        GREEDY_ORDER_IDS.length +
        // 🆕 D265 ADDS THE TWENTY-FIFTH TERM. D264's handoff predicted this line
        // would go RED and want one the next time a table moved the ability
        // column, and it did — for the eighth time, and never before
        // `BUILT.ability` itself was bumped to the re-derived 168. **The tie
        // guards the ARITHMETIC; the join guards the CENSUS.**
        GENTLE_FIN_IDS.length +
        // 🆕 D267 ADDS THE TWENTY-SIXTH TERM. D266's handoff predicted this line
        // would go RED and want one the next time a table moved the ability
        // column, and it did — for the NINTH time, and never before
        // `BUILT.ability` itself was bumped to the re-derived 171. **The tie
        // guards the ARITHMETIC; the join guards the CENSUS** — and this is the
        // first slice since D252 that could run BOTH, because the catalog came
        // back. D253's ceiling note above is the case this slice is NOT.
        SKYLINER_IDS.length +
        // 🆕 D268 ADDS THE TWENTY-SEVENTH TERM. D267's handoff predicted this line
        // would go RED and want one the next time a table moved the ability
        // column, and it did — for the TENTH time, and never before
        // `BUILT.ability` itself was bumped to the re-derived 173. **The tie
        // guards the ARITHMETIC; the join guards the CENSUS.**
        DISTORTED_FUTURE_IDS.length +
        // 🆕 D272 ADDS THE TWENTY-EIGHTH TERM. D268's handoff predicted this line
        // would go RED and want one the next time a table moved the ability
        // column, and it did — for the ELEVENTH time, and never before
        // `BUILT.ability` itself was bumped to the re-derived 176. ⚠️ D272 ALSO
        // PREDICTED THIS AUDITOR WOULD REDDEN ON ITS OWN AND IT DID NOT: the
        // three registry rows shipped, the whole suite stayed green, and only the
        // hand bump moved it. See `FLIP_THE_SCRIPT_IDS` above — **the bump is the
        // one step in this decomposition with no guard behind it.**
        FLIP_THE_SCRIPT_IDS.length +
        // 🆕 D273 ADDS THE TWENTY-NINTH TERM — and for the FIRST time the line
        // above it went red BEFORE the hand bump rather than after. D272's handoff
        // predicted this line would redden the next time a table moved the ability
        // column; it did, for the TWELFTH time, but it was no longer the only
        // thing that did. The partition at the foot of this file named the five
        // ids on a tree where `BUILT.ability` still read 176.
        SUBJUGATING_CHAINS_IDS.length +
        // 🆕 D275 ADDS THE THIRTIETH TERM. D273's handoff predicted this line
        // would redden the next time a table moved the ability column; it did, for
        // the THIRTEENTH time — and for the SECOND consecutive slice it was not
        // the only thing that reddened, because the partition named the two ids
        // first. **The tie guards the ARITHMETIC, the join guards the CENSUS, and
        // since D273 the partition guards the BUMP.**
        FAN_CALL_IDS.length +
        // 🆕 D277 ADDS THE THIRTY-FIRST TERM. D275's handoff predicted this line
        // would redden the next time a table moved the ability column; it did, for
        // the FOURTEENTH time — and for the THIRD consecutive slice it was not the
        // only thing that reddened, because the partition named the three ids on a
        // tree where `BUILT.ability` still read 183. **The tie guards the
        // ARITHMETIC, the join guards the CENSUS, and since D273 the partition
        // guards the BUMP** — three guards, and this slice fired all three.
        DEBUT_PERFORMANCE_IDS.length +
        // 🆕 D278 ADDS THE THIRTY-SECOND TERM. D277's handoff predicted this line
        // would redden the next time a table moved the ability column; it did, for
        // the FIFTEENTH time — and for the FOURTH consecutive slice it was not the
        // only thing that reddened, because the partition named the three ids on a
        // tree where `BUILT.ability` still read 186. **The tie guards the
        // ARITHMETIC, the join guards the CENSUS, and since D273 the partition
        // guards the BUMP** — three guards, and this slice fired all three. ⚠️ AND
        // THE ORDER WAS OBSERVED RATHER THAN ASSUMED, WHICH D277 COULD NOT DO: on
        // the untouched tree the partition and the `540` fired FIRST, this tie
        // stayed GREEN (186 = 186), and it went red only once `BUILT.ability`
        // was bumped — D251's finding, confirmed a ninth time.
        BOOSTED_EVOLUTION_IDS.length +
        // 🆕 D279 ADDS THE THIRTY-THIRD TERM. D278's handoff predicted this line
        // would redden the next time a table moved the ability column; it did, for
        // the SIXTEENTH time — and for the FIFTH consecutive slice it was not the
        // only thing that reddened, because the partition named the four ids on a
        // tree where `BUILT.ability` still read 189. **The tie guards the
        // ARITHMETIC, the join guards the CENSUS, and since D273 the partition
        // guards the BUMP** — three guards, all three fired again. ⚠️ AND THE
        // ORDER WAS OBSERVED, NOT ASSUMED, FOR THE SECOND CONSECUTIVE SLICE: on
        // the untouched tree `censusAtHead.test.ts` went red in exactly **TWO**
        // places (`raw.length` 543 and the partition, which named exactly
        // `sv10.5b-009`/`-094`/`sv10.5w-008`/`-093`), this tie stayed GREEN
        // (189 = 189), and it moved only once `BUILT.ability` was bumped —
        // D251's finding, confirmed a tenth time, and D278's "N red ≠ N wrong"
        // distinction reproduced exactly (2 red, 6 constants wrong).
        STIMULATED_EVOLUTION_IDS.length +
        // 🆕 D281 ADDS THE THIRTY-FOURTH TERM, AND IT IS THE LARGEST EVER ADDED
        // (13). D280's handoff predicted this line would redden the next time a
        // table moved the ability column; it did, for the SEVENTEENTH time — and
        // for the SIXTH consecutive slice it was not the only thing that
        // reddened, because the partition named the 13 ids on a tree where
        // `BUILT.ability` still read 193. **The tie guards the ARITHMETIC, the
        // join guards the CENSUS, and since D273 the partition guards the BUMP.**
        // ⚠️ AND THE ORDER WAS OBSERVED, NOT ASSUMED, FOR THE THIRD CONSECUTIVE
        // SLICE: on the untouched tree `censusAtHead.test.ts` went red in exactly
        // **TWO** places (`raw.length` 549 and the partition, which named exactly
        // these 13), this tie stayed GREEN (193 = 193), and it moved only once
        // `BUILT.ability` was bumped — D251's finding, confirmed an eleventh
        // time. 🆕 **AND THE THIRD RED PLACE OUTSIDE THIS FILE WAS *NOT* A
        // `FIXTURE_POOL` SWEEP** (D280's was `revealClause.test.ts`): it was
        // `src/features/game/LocalMatch.dom.test.tsx`, reddened by the §4
        // footnote this slice had to make per-row. **No fixture was added
        // anywhere, so no fixture sweep could fire.**
        ATTACK_TIMING_GATE_IDS.length +
        // 🆕 D284 ADDS THE THIRTY-FIFTH AND THIRTY-SIXTH TERMS — two, because the
        // slice ships two printed SENTENCES (D259's `UNNERVE`/`WIDE_WALL` split,
        // applied to a family that prints the same field with a one-member and a
        // two-member class list). D281's handoff predicted this line would redden
        // the next time a table moved the ability column; it did, for the
        // EIGHTEENTH time — and for the SEVENTH consecutive slice it was not the
        // only thing that reddened, because the partition named the four ids on a
        // tree where `BUILT.ability` still read 206. **The tie guards the
        // ARITHMETIC, the join guards the CENSUS, and since D273 the partition
        // guards the BUMP.**
        // ⚠️ **THE ORDER WAS OBSERVED, NOT ASSUMED, FOR THE FOURTH CONSECUTIVE
        // SLICE, AND THE COUNT IS REPORTED AS MEASURED**: on the untouched tree
        // the WHOLE SUITE went red in exactly **TWO** places, both in this file
        // (`raw.length` 562 and the partition, which named exactly `sv09-095` /
        // `sv10.5w-045` / `-160` / `-168`), with **ZERO red outside it** — this
        // tie, the headline `built` and `BUILT.ability` all stayed GREEN, because
        // each is asserted THROUGH a constant no registry row can move. D278's
        // "N red ≠ N wrong" distinction reproduced again: **2 red, 5 constants
        // wrong** (`raw.length`, `nonAttackRegistryIds().length`, `BUILT.ability`,
        // `built`, `units - built`).
        DAUNTING_GAZE_IDS.length +
        OCEANIC_CURSE_IDS.length +
        // 🆕 D285 — the THIRTY-SEVENTH term, and the column's second consecutive
        // move (206 → 210 → 211). ⚠️ **THE ORDER WAS OBSERVED AGAIN AND THE COUNT
        // IS REPORTED AS MEASURED**: on the untouched tree the whole suite went
        // red in exactly **FOUR** places, TWO in this file's non-attack half
        // (`raw.length` 566 and the partition, which named exactly `sv10-113`) and
        // TWO in the D274 attack half (`292` sentences / `1,123` printings and the
        // `BUILT.attack` sum) — **which is the signal D284's forecast asked for**:
        // the attack half reddening means a TEXT READER moved, and it did, because
        // Bronzong is the same mechanism derived rather than authored.
        POTENT_GLARE_IDS.length +
        // 🆕 D287 — the THIRTY-EIGHTH term, and the column's THIRD consecutive move
        // (206 → 210 → 211 → 212). ⚠️ **THE ORDER WAS OBSERVED AGAIN AND THE COUNT
        // IS REPORTED AS MEASURED**: on the untouched tree the whole suite went red
        // in exactly **FOUR** places — TWO in this file's non-attack half
        // (`raw.length` 568 and the partition, which named exactly `sv06.5-042`)
        // and TWO OUTSIDE IT, `activeHandLock.test.ts` §1 and
        // `pokemonPlayLock.test.ts` §1, each asserting this id carries NO program.
        // 🛑 **THOSE TWO ARE NOT CENSUS DRIFT, THEY ARE THE REFUSAL BEING CASHED**
        // — D284 wrote them so that building this row would cost a deliberate edit
        // instead of a silent widening, and it did. **4 red places, 6 constants
        // wrong** (`raw.length`, `nonAttackRegistryIds().length`, `BUILT.ability`,
        // `built`, `units - built`, and this tie) — D278's "N red ≠ N wrong"
        // distinction reproduced for the third consecutive slice. ⚠️ **AND THE
        // ATTACK HALF STAYED GREEN**, which is the inverse of D285's signal: no
        // text reader moved, because no printed ATTACK can name a Stadium bar
        // (measured: `attacks_json` 0).
        MASSIVE_BODY_IDS.length +
        // 🆕 D291 — the THIRTY-NINTH term, and the column's FOURTH move in five
        // slices (206 → 210 → 211 → 212 → 213). ⚠️ **THE ORDER WAS OBSERVED AGAIN
        // AND THE COUNT IS REPORTED AS MEASURED**: on the untouched tree the whole
        // suite went red in exactly **THREE FILES / FOUR TESTS** — TWO in this
        // file's non-attack half (`raw.length` 569 and the partition, which named
        // exactly `sv06.5-040`) and TWO OUTSIDE IT, `activeHandLock.test.ts` §1 and
        // `pokemonPlayLock.test.ts` §1, each asserting this id carries NO program.
        // 🛑 **THOSE TWO ARE THE REFUSAL BEING CASHED FOR THE THIRD AND LAST TIME**
        // — D284 wrote three such assertions so that building each row would cost
        // a deliberate edit instead of a silent widening, and all three have now
        // fired (D285 Arbok, D287 Copperajah, D291 Genesect). **4 red places, 6
        // constants wrong** (`raw.length`, `nonAttackRegistryIds().length`,
        // `BUILT.ability`, `built`, `units - built`, and this tie) — D278's "N red
        // ≠ N wrong" distinction reproduced for the FIFTH consecutive slice, and
        // at exactly the ratio D290's handoff forecast. ⚠️ **AND THE ATTACK HALF
        // STAYED GREEN**: no printed attack in the catalog names ACE SPEC — the
        // whole catalog holds ONE row that names it, and it is an Ability.
        ACE_NULLIFIER_IDS.length +
        // 🆕 D294 — the FORTIETH term, and the column's FIFTH move in ten slices
        // (206 → 210 → 211 → 212 → 213 → 215). ⚠️ **THE ORDER WAS OBSERVED, NOT
        // ASSUMED, AND THE COUNT IS REPORTED AS MEASURED**: on the untouched tree
        // the whole 304-file suite went red in exactly **ONE FILE / TWO TESTS**,
        // both in this file's non-attack half (`raw.length` 572 and the partition,
        // which named exactly `sv10.5w-064` / `-145`), with **ZERO red outside
        // it** — no refusal was cashed anywhere, because no earlier slice had ever
        // written an assertion that these ids carry no program. **2 red places, 6
        // constants wrong** (`raw.length`, `nonAttackRegistryIds().length`,
        // `BUILT.ability`, `built`, `units - built`, and this tie), D278's
        // "N red ≠ N wrong" reproduced for the sixth consecutive slice.
        // ⚠️ **AND THE ATTACK HALF STAYED GREEN**, which is the load-bearing half
        // of the signal here: the handoff forecast this row would move
        // `BUILT.attack` and the split term 10 → 11 through Illumise `sv06-010`.
        // No text reader moved, because Illumise is REFUSED and the sentence this
        // slice builds is an ABILITY that no attack deriver can see.
        LOOK_FOR_PREY_IDS.length,
    );
    // The ATTRIBUTION CONTROL for the two new terms, in the shape the four lines
    // below use for `ATTACK_TIMING_GATE_IDS`: an id counted here must carry the
    // FIELD it is counted for, or the term is measuring the wrong thing.
    for (const id of [...DAUNTING_GAZE_IDS, ...OCEANIC_CURSE_IDS]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} is counted for a bar it does not carry`,
      ).toBeDefined();
    }
    // 🆕 D285's term carries a DIFFERENT field, and the control says so — an id
    // counted for the Pokémon-surface bar must not be passing on the Trainer one.
    for (const id of POTENT_GLARE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} is counted for a bar it does not carry`,
      ).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} must not be counted through the Trainer-surface field`,
      ).toBeUndefined();
    }
    // 🆕 D287's term shares D284's FIELD and not D285's, so it takes D284's control
    // shape — and the extra line is the one that says WHICH class, because a build
    // that widened every row's list to all four would pass a bare `toBeDefined()`.
    for (const id of MASSIVE_BODY_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} is counted for a bar it does not carry`,
      ).toEqual(["Stadium"]);
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} must not be counted through the Pokémon-surface field`,
      ).toBeUndefined();
    }
    // 🆕 D291's term carries a THIRD field, and its control is the sharpest of the
    // set because the failure it rules out is the one the whole slice was written
    // to avoid: a build that reached ACE SPEC by adding a fifth `HandPlayClass`
    // member would carry a class list here and pass any `toBeDefined()`.
    for (const id of ACE_NULLIFIER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentAceSpecPlayWhileToolAttached,
        `${id} is counted for a bar it does not carry`,
      ).toBe(true);
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} must not be counted through the CLASS field — ACE SPEC is a rarity`,
      ).toBeUndefined();
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} must not be counted through the Pokémon-surface field`,
      ).toBeUndefined();
    }
    // 🆕 D294's control reaches INTO the program, because its term is an OP FIELD
    // and not a `passive` flag. Three assertions, and the middle one is the point:
    // an id counted here must carry an ability whose program holds a
    // `bottomFromOpponentHand` **with `dest: "bench"`**. A row that shipped the
    // same card with the DEFAULT destination would put the opponent's Basic on the
    // bottom of their deck — a legal-looking program, a green `toBeDefined()`, and
    // the opposite of the printed sentence.
    for (const id of LOOK_FOR_PREY_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      const ops = programFor(id)?.abilities?.[0]?.program ?? [];
      expect(
        ops.some((op) => op.op === "bottomFromOpponentHand" && op.dest === "bench"),
        `${id} is counted for a cross-seat bench put it does not carry`,
      ).toBe(true);
      expect(
        programFor(id)?.passive,
        `${id} must not be counted through a passive bar — its term is an OP field`,
      ).toBeUndefined();
    }
    // ⚠️ AND THE FOUR TERMS ARE DISJOINT AND DIFFER IN THEIR CLASS LIST — the
    // whole reason they are four. A merged term would be green on every half of
    // a build that gave Tyranitar a Tool bar it does not print, or that let one
    // sentence's `["Stadium"]` leak onto the other two.
    expect(programFor("sv09-095")?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    expect(programFor("sv10.5w-045")?.passive?.preventOpponentHandPlay).toEqual(["Item", "Tool"]);
    expect(programFor("sv06.5-042")?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(new Set(ATTACK_TIMING_GATE_IDS).size).toBe(ATTACK_TIMING_GATE_IDS.length);
    for (const id of ATTACK_TIMING_GATE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(programFor(id)?.attackGate, `${id} is counted for a gate it does not carry`)
        .toBeDefined();
    }
    // 🛑 THE REPRINT IDIOM, APPLIED AND ALSO WITHHELD — the Karrablast/Shelmet
    // lesson four lines up, on a family that prints BOTH shapes. Terapagos ex's
    // seven printings share ONE program object (one byte-identical `attacks_json`,
    // measured). Illumise and Scream Tail ex print a BYTE-IDENTICAL gate clause
    // and are deliberately TWO objects: they are two cards agreeing on one
    // sentence, and a shared object would make a later divergence on either body
    // impossible to express. Volbeat and Exeggcute likewise.
    expect(programFor("svp-165")).toBe(programFor("sv07-128"));
    expect(programFor("sv06-197")).toBe(programFor("sv06-094"));
    expect(programFor("sv06-010")).not.toBe(programFor("sv06-094"));
    expect(programFor("sv06-009")).not.toBe(programFor("sv08-001"));
    expect(new Set(STIMULATED_EVOLUTION_IDS).size).toBe(STIMULATED_EVOLUTION_IDS.length);
    for (const id of STIMULATED_EVOLUTION_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // 🛑 AND THE FOUR DO **NOT** SHARE ONE PROGRAM, WHICH IS THE OPPOSITE OF THE
    // CLAIM THE TERM ABOVE MAKES ABOUT EEVEE'S THREE — because the catalog says
    // so. Karrablast's sentence names Shelmet and Shelmet's names Karrablast, so
    // the `abilities_json` is byte-identical WITHIN each pair and different
    // ACROSS them. Merging the pairs would hand each body its own name as its
    // gate, which reads TRUE off the holder and makes the licence unconditional —
    // the exact failure the reprint idiom is supposed to prevent, arriving by
    // applying the idiom one printing too far.
    expect(programFor("sv10.5b-094")).toBe(programFor("sv10.5b-009"));
    expect(programFor("sv10.5w-093")).toBe(programFor("sv10.5w-008"));
    expect(programFor("sv10.5w-008")).not.toBe(programFor("sv10.5b-009"));
    expect(new Set(BOOSTED_EVOLUTION_IDS).size).toBe(BOOSTED_EVOLUTION_IDS.length);
    for (const id of BOOSTED_EVOLUTION_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and all THREE ids share ONE program object, the reprint idiom — D277's
    // claim one term up, restated because it is the claim the term is really
    // making: three separate objects would hide a copy-paste divergence between
    // printings whose `abilities_json` the census proved byte-identical.
    expect(programFor("sv08.5-074")).toBe(programFor("sv08-143"));
    expect(programFor("svp-173")).toBe(programFor("sv08-143"));
    // ⚠️ AND THE TWO §4 LICENCES ARE NOT ONE PROGRAM. `attackFirstTurnExempt` and
    // `evolveEarlyExempt` are different fields lifting different bans, and an
    // engine that merged them would let Meloetta ex evolve on turn 1 and Eevee
    // attack on it. Pinned because the two rows are adjacent in registry.ts and
    // one shares-the-object edit away from exactly that.
    expect(programFor("sv08-143")).not.toBe(programFor("sv10.5b-044"));
    expect(new Set(DEBUT_PERFORMANCE_IDS).size).toBe(DEBUT_PERFORMANCE_IDS.length);
    for (const id of DEBUT_PERFORMANCE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and all THREE ids share ONE program object, the reprint idiom — the claim
    // the term is really making, since three objects would inflate this slice's
    // share of the column by nothing and would hide a copy-paste divergence.
    expect(programFor("sv10.5b-159")).toBe(programFor("sv10.5b-044"));
    expect(programFor("sv10.5b-167")).toBe(programFor("sv10.5b-044"));
    expect(new Set(FAN_CALL_IDS).size).toBe(FAN_CALL_IDS.length);
    for (const id of FAN_CALL_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and the two ids share ONE program object, the reprint idiom — the claim the
    // term is really making, since a second object would inflate this slice's
    // share of the column.
    expect(programFor("sv08.5-085")).toBe(programFor("sv07-118"));
    expect(new Set(SUBJUGATING_CHAINS_IDS).size).toBe(SUBJUGATING_CHAINS_IDS.length);
    for (const id of SUBJUGATING_CHAINS_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(new Set(FLIP_THE_SCRIPT_IDS).size).toBe(FLIP_THE_SCRIPT_IDS.length);
    for (const id of FLIP_THE_SCRIPT_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and all three ids share ONE program object, the reprint idiom — the claim
    // the term is really making, since a second object or a duplicated id would
    // inflate this slice's share of the column.
    expect(programFor("sv06.5-084")).toBe(programFor("sv06.5-038"));
    expect(programFor("sv06.5-092")).toBe(programFor("sv06.5-038"));
    expect(new Set(DISTORTED_FUTURE_IDS).size).toBe(DISTORTED_FUTURE_IDS.length);
    for (const id of DISTORTED_FUTURE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and the two ids share ONE program object, the reprint idiom — even though
    // this pair is a PROMO and a SET printing rather than an alternate-art pair.
    expect(programFor("sv10.5w-043")).toBe(programFor("svp-211"));
    expect(new Set(SKYLINER_IDS).size).toBe(SKYLINER_IDS.length);
    for (const id of SKYLINER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and the three ids share ONE program object, the reprint idiom.
    expect(programFor("sv08-220")).toBe(programFor("sv08-076"));
    expect(programFor("sv08-239")).toBe(programFor("sv08-076"));
    // …and D265's two ids share ONE program object, on the same claim.
    expect(programFor("sv10.5b-108")).toBe(programFor("sv10.5b-024"));
    expect(new Set(GENTLE_FIN_IDS).size).toBe(GENTLE_FIN_IDS.length);
    for (const id of GENTLE_FIN_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and both of D264's ids share ONE program object, which is the claim the
    // term is actually making: two printings of one card, so a second object or a
    // duplicated id would inflate this slice's share of the column.
    expect(programFor("sv10-205")).toBe(programFor("sv10-159"));
    expect(new Set(GREEDY_ORDER_IDS).size).toBe(GREEDY_ORDER_IDS.length);
    for (const id of GREEDY_ORDER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and every id in the new terms really is authored, which is what stops a
    // term from being a number that happens to fit.
    for (const id of [
      ...RIPENING_CHARGE_IDS,
      ...BATTLE_HARDENED_IDS,
      ...CORNERSTONE_STANCE_IDS,
      ...MIGHTY_SHELL_IDS,
      ...CURIOUS_TEA_PARTY_IDS,
      ...SPHERICAL_SHIELD_IDS,
      ...PREVENT_FROM_EX_IDS,
      ...PREVENT_FROM_BASIC_EX_IDS,
      ...FLOWER_CURTAIN_IDS,
      ...IMPERVIOUS_SHELL_IDS,
      ...ADRENA_PHEROMONE_IDS,
      ...EXPERT_HIDER_IDS,
      ...UNNERVE_IDS,
      ...WIDE_WALL_IDS,
      ...UNAWARE_IDS,
      ...REPELLING_VEIL_IDS,
    ]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // ⚠️ AND D256's TERM IS ONE OBJECT SHARED BY BOTH IDS — two printings of ONE
    // card, so a second object or a duplicated id would inflate this slice's share
    // of the column while leaving the arithmetic identical.
    expect(programFor("sv10-185")).toBe(programFor("sv10-010"));
    expect(new Set(FLOWER_CURTAIN_IDS).size).toBe(FLOWER_CURTAIN_IDS.length);
    // ⚠️ AND THE D250 TERM IS ONE OBJECT SHARED BY BOTH IDS, WHICH IS THE CLAIM
    // THE COUNT IS ACTUALLY MAKING — two printings, one program, so a duplicated
    // id or a second object would inflate the coverage this slice bought.
    expect(programFor("sv08.5-054")).toBe(programFor("sv06.5-025"));
    expect(new Set(BATTLE_HARDENED_IDS).size).toBe(BATTLE_HARDENED_IDS.length);
    // ⚠️ AND D251's TERM IS ONE OBJECT SHARED BY ALL FIVE IDS, the same claim at
    // five printings instead of two — five reprints of ONE card, so a second
    // object or a duplicated id would inflate this slice's share of the column.
    for (const id of CORNERSTONE_STANCE_IDS) {
      expect(programFor(id), id).toBe(programFor("sv06-112"));
    }
    expect(new Set(CORNERSTONE_STANCE_IDS).size).toBe(CORNERSTONE_STANCE_IDS.length);
    // ⚠️ AND D252's TERM IS ONE OBJECT SHARED BY BOTH IDS, the same claim at two
    // printings — a second object or a duplicated id would inflate this slice's
    // share of the column.
    for (const id of MIGHTY_SHELL_IDS) {
      expect(programFor(id), id).toBe(programFor("sv10.5b-023"));
    }
    expect(new Set(MIGHTY_SHELL_IDS).size).toBe(MIGHTY_SHELL_IDS.length);
    // 🛑 AND D253's TERM IS ONE OBJECT SHARED BY ALL THREE IDS — AND HERE THAT
    // CLAIM IS DOING MORE WORK THAN IT DID FOR THE FOUR TERMS ABOVE IT. Those were
    // reprints of a single card; these three are a LINE plus a reprint (Sinistcha
    // `sv10-048` evolves from Poltchageist `sv06-020`/`-171` and prints the same
    // sentence), so "one object" is asserting that the engine read ONE printed
    // string and not two that happen to match. ⚠️ AND IT IS THE ONLY PART OF THIS
    // TERM THAT COULD BE VERIFIED AT ALL AT THIS COMMIT, since the census behind
    // the 3 could not be re-run — the shape is checked locally even though the
    // count is inherited.
    for (const id of CURIOUS_TEA_PARTY_IDS) {
      expect(programFor(id), id).toBe(programFor("sv06-020"));
    }
    expect(new Set(CURIOUS_TEA_PARTY_IDS).size).toBe(CURIOUS_TEA_PARTY_IDS.length);
    // 🛑 AND D254's TERM IS THE FIRST SINGLETON IN THE TABLE — one printing, so the
    // "one object shared by N ids" claim above has nothing to say about it and the
    // ID-LEVEL claim is all there is. Asserted anyway, because the shape of the
    // check is what stops a later reprint from being appended without a second
    // object being reasoned about.
    expect(new Set(SPHERICAL_SHIELD_IDS).size).toBe(SPHERICAL_SHIELD_IDS.length);
    // 🛑 AND D255's TWO TERMS ARE TWO OBJECTS, WHICH IS THE FIRST TIME THIS BLOCK
    // ASSERTS A NON-SHARING. Every term above it says "N printings, ONE object";
    // these say that AND that the two sentences do not collapse into each other —
    // the three ex-only printings must not acquire the `stage` conjunct the two
    // Farigiraf ex printings print. A five-id single term would have been
    // arithmetically identical and could not have said it.
    for (const id of PREVENT_FROM_EX_IDS) {
      expect(programFor(id), id).toBe(programFor("sv08.5-040"));
    }
    for (const id of PREVENT_FROM_BASIC_EX_IDS) {
      expect(programFor(id), id).toBe(programFor("sv05-108"));
    }
    expect(programFor("sv08.5-040")).not.toBe(programFor("sv05-108"));
    expect(new Set([...PREVENT_FROM_EX_IDS, ...PREVENT_FROM_BASIC_EX_IDS]).size).toBe(
      PREVENT_FROM_EX_IDS.length + PREVENT_FROM_BASIC_EX_IDS.length,
    );

    // The non-attack half was the figure the page carried forward by hand from
    // D221 ("147 of 651, 22.6 %") and re-measured exactly right at D233 — the only
    // running total on that page that survived re-derivation. ⚠️ **D242 IS THE
    // FIRST SLICE TO MOVE IT: 147 → 159 (24.4 %)**, twelve ABILITY printings on two
    // registry programs, and the first non-attack yield since D221. ⚠️ **AND D243
    // MOVES IT AGAIN: 159 → 166 (24.4 % → 25.5 %)**, seven more ABILITY printings on
    // three registry programs — the first time this figure has moved in TWO
    // consecutive slices in its life.
    const nonAttackUnits =
      POPULATION.abilityUnits + POPULATION.trainerUnits + POPULATION.specialEnergyUnits;
    // ⚠️ **AND D244 MOVES IT A THIRD TIME: 166 → 173 (25.5 % → 26.6 %)** — the
    // first time this figure has moved in THREE consecutive slices, and the first
    // three-slice run this column has ever had.
    // ⚠️ **AND D245 MOVES IT A FOURTH TIME: 173 → 179 (26.6 % → 27.5 %)** — a
    // FOUR-slice run in a column that had not moved at all between D221 and D242.
    // ⚠️ **AND D249 MOVES IT A FIFTH TIME: 179 → 183 (27.5 % → 28.1 %)** — after
    // FOUR consecutive attack-only slices left it still. The interesting shape is
    // not the streak but its price: 179 → 183 cost ONE registry object and no
    // engine code, where the four attack slices in between each cost a field, an
    // op or a map key.
    // ⚠️⚠️ **AND D251 MOVES IT A SEVENTH TIME: 185 → 190 (28.4 % → 29.2 %)** — a
    // THREE-slice run, and the first of the three whose price was NOT "one registry
    // object and no engine code": this one cost a `PassiveEffects` field, a fold
    // line, a `cards.ts` predicate and FOUR read-site disjuncts. **The two-slice
    // free run was a fact about two sentences, not about the column.**
    // ⚠️⚠️ **AND D250 MOVED IT A SIXTH TIME: 183 → 185 (28.1 % → 28.4 %)** — the
    // first time this figure has moved in TWO consecutive slices since D244/D245,
    // and the price is the same price twice: ONE registry object, no engine code.
    // 🆕 **THAT IS NOW A FACT ABOUT THE POOL RATHER THAN A RUN OF LUCK.** Two
    // slices in a row have found a printed sentence whose every field was already
    // in `effects.ts`, put there by an earlier slice for an unrelated card. The
    // list of such sentences is discoverable BEFORE pricing: grep `effects.ts` for
    // fields documented as unconsumed or single-consumer, then query the catalog
    // for the phrase each one spells. D249 consumed `healTarget`'s number arm;
    // D250 crossed `count` (D205) with `toSelf` (D221) for the first time.
    // ⚠️⚠️ **AND D252 MOVES IT AN EIGHTH TIME: 190 → 192 (29.2 % → 29.5 %)** — a
    // FOUR-slice run, the longest this column has had, and the second in that run
    // whose price was engine code rather than "one registry object". D251 bought 5
    // printings for a field, a fold line, a `cards.ts` predicate and four read-site
    // disjuncts; this one bought 2 for a field, a fold line, a `continuous.ts`
    // predicate, four disjuncts AND one gate. 🆕 **THE PER-PRINTING PRICE WENT UP
    // AND THE RULE GOT WIDER, WHICH IS THE TRADE THIS TAIL NOW OFFERS**: the cheap
    // reprint-heavy sentences are being consumed, and what is left is smaller
    // groups on rules the engine does not yet have.
    // ⚠️⚠️ **AND D253 MOVES IT A NINTH TIME: 192 → 195 (29.5 % → 30.0 %)** — a
    // FIVE-slice run, and the column crosses 30 % of the non-attack pool for the
    // first time. 🆕 **THE PER-PRINTING PRICE WENT BACK DOWN, AND THE REASON IS
    // THE ONE THIS TAIL SHOULD BE SHOPPED BY FROM NOW ON.** D251 bought 5 for a
    // field + a fold line + a `cards.ts` predicate + FOUR read-site disjuncts;
    // D252 bought 2 for the same plus a fifth site; D253 bought 3 for a field, a
    // fold line, a `continuous.ts` predicate and five disjuncts that take NO
    // predicate call at all — **because its gate names the HOLDER and folded, and
    // an attacker gate cannot.** That is a cheaper shape than either predecessor
    // and it is discoverable BEFORE pricing: read the printed clause and ask which
    // BODY it is about. A clause about the holder is one fold line whatever the
    // read-site count is; a clause about the attacker is N predicate calls.
    // ⚠️⚠️ **AND D254 MOVES IT A TENTH TIME: 195 → 196 (30.0 % → 30.1 %)** — a
    // SIX-slice run. 🛑 **THE PER-PRINTING PRICE IS THE HIGHEST OF THE SIX, AND
    // THAT IS THE HONEST HEADLINE RATHER THAN THE STREAK.** One printing, for a
    // field, a widened `continuous.ts` scan, a new second scan, a REQUIRED new
    // parameter threaded through four existing call sites and one new disjunct.
    // ✅ **BUT THE READ SITES THEMSELVES COST NOTHING**, which is the other half
    // and the transferable one: `benchShieldedFromDamage` was already the SOLE
    // FUNNEL at all four damage arms, so the second sentence widened ONE function
    // instead of adding four disjuncts. **A row whose rule already has a funnel is
    // cheap at the sites and expensive in the funnel; a row whose rule does not is
    // the reverse.** That is the shape to price by, and it is visible before any
    // code is written — grep for a function that already answers this KIND of
    // question, which is D253's lesson pointed at cost instead of at placement.
    // ⚠️⚠️ **AND D255 MOVES IT AN ELEVENTH TIME: 196 → 201 (30.1 % → 30.9 %)** — a
    // SEVEN-slice run, and the biggest single step since D251's 5. ✅ **THE
    // PER-PRINTING PRICE IS THE LOWEST OF THE SEVEN**, and the reason is a shape
    // D254's note above names without having met: this row's rule has NO funnel, so
    // it paid four read-site disjuncts (the expensive half), and its gate is
    // PARAMETERISED, so the second sentence rode the first for ONE registry object.
    // 🆕 **PARAMETERISATION IS THE OTHER AXIS OF THAT TRADE, AND IT IS THE ONE THE
    // FUNNEL RULE DOES NOT COVER.** A funnel makes the SITES cheap; a record-valued
    // gate makes the NEXT SENTENCE cheap. This row had no funnel and got 5 printings
    // for one field because the two sentences differ by a key rather than by a rule
    // — which is visible in the printed strings before any code is written (they
    // differ by the single word "Basic ").
    // ⚠️⚠️ **AND D256 MOVES IT A TWELFTH TIME: 201 → 203 (30.9 % → 31.2 %)** — an
    // EIGHT-slice run. ✅ **AND THIS ROW IS THE FUNNEL SIDE OF D254's TRADE STATED
    // AS A PRICE RATHER THAN AS A PRINCIPLE.** D255 above had NO funnel and paid
    // four read-site disjuncts for 5 printings; this row's rule already had one
    // (`benchShieldedFromDamage`, sole funnel at all four damage arms since D159)
    // and paid **ZERO disjuncts, ZERO signature changes and ZERO new predicates**
    // for 2. 🆕 **THE TWO SLICES TOGETHER ARE THE CLEANEST READING OF THAT TRADE
    // THE PAGE HAS**: parameterisation makes the NEXT SENTENCE cheap (D255, 2
    // printings for one registry object) and a funnel makes the SITES cheap (D256,
    // 2 printings for one boolean and one conjunct). Both are visible in the
    // printed string plus one grep before any code is written — and the grep for
    // the second one is "does a function already answer this KIND of question",
    // which is D253's placement lesson pointed at cost.
    // ⚠️⚠️ **AND D257 MOVES IT A THIRTEENTH TIME: 203 → 204 (31.2 % → 31.3 %)** — a
    // NINE-slice run, and the smallest single step any of them has taken. 🛑 **A
    // SINGLETON IS WORTH TAKING WHEN IT CLOSES A ROW, AND THAT IS THE FINDING RATHER
    // THAN THE NUMBER.** One printing bought four read-site disjuncts, one new fold
    // key, three fixtures and a deck — by printings-per-edit the worst trade in this
    // whole run — and it is still the right slice, because it empties the
    // `%prevent all damage%` ability column of everything a build can reach. **The
    // value of the last row in a family is the family, not the row**: after this the
    // residue is 3 printings on 1 sentence and every one is the TERA group, so a
    // successor is forced to run a NEW census instead of grinding a measured page
    // that has nothing buildable left on it. 🆕 **AND THE FIRST TWO NUMBERS OF THAT
    // census are already measured** — the coin-flip defensive Ability, 5 legal
    // ability printings on 2 sentences, is row 15-C in `coverage-backlog-legal.md`.
    // ⚠️⚠️ **AND D258 MOVES IT A FOURTEENTH TIME: 204 → 209 (31.3 % → 32.1 %)** — a
    // TEN-slice run, and the LARGEST single step since D255. 🆕 **THE FINDING IS THE
    // METHOD, NOT THE CARD: A CENSUS IS BOUNDED BY ITS PHRASE, AND THE PHRASE IS A
    // CHOICE.** D257 closed a family that had been correctly re-measured four times
    // and reported a residue of 3 permanently unbuildable printings; a one-verb
    // widening — "prevent THAT damage" for "prevent ALL damage" — immediately
    // returned 5 more legal printings on 2 sentences that no rung of the old ladder
    // could ever have reached. **When a row closes, widen the VERB before declaring
    // the family finished** — and the yield here is five printings for the price of
    // one query, against the one printing D257's whole slice bought.
    expect(nonAttackUnits).toBe(651);
    // ⚠️⚠️ **AND D259 MOVES IT A FIFTEENTH TIME: 209 → 214 (32.1 % → 32.9 %)** — an
    // ELEVEN-slice run, and the same size step as D258's. 🆕 **THE FINDING IS AGAIN
    // THE METHOD: D258's completed `%prevent%` inventory is what made this row
    // buildable without a single exploratory query.** That slice ran the family's
    // widest phrase ONCE and wrote the whole 15-sentence table down; this slice
    // read the biggest remaining row straight off it, re-derived it, and built it.
    // **A completed inventory is worth more than the row that produced it** — the
    // residue is now 5 buildable printings on 3 sentences (2 ATTACK-borne
    // effects-only, 1 Supporter-adjacent), all of them named in the resume point.
    // ⚠️⚠️ **AND D260 MOVES IT A SIXTEENTH TIME: 214 → 216 (32.9 % → 33.2 %)** — a
    // TWELVE-slice run, and the SMALLEST step of the twelve, which is the point
    // rather than a disappointment: the row was chosen because it was CHEAP, not
    // because it was large, and it closes the seam. 🛑 **THE `%prevent%` ABILITY
    // INVENTORY IS NOW EXHAUSTED OF BUILDABLE WORK.** D258's 15-sentence / 34-
    // printing table stands at **31 on 14 BUILT**; the residue is **3 printings on
    // 1 sentence**, all of them the permanently unbuildable TERA group. 🆕 **SO THE
    // NEXT ABILITY SLICE IN THIS FAMILY NEEDS A NEW CENSUS AND NOT A NEW ROW** —
    // and this slice's own ladder already names where to point it: `sv05-161`, a
    // SPECIAL ENERGY printing the effects-only sentence about the body it is
    // attached to, which is the `effect` column and not this one.
    // ⚠️⚠️ **AND D261 MOVES IT A SEVENTEENTH TIME: 216 → 218 (33.2 % → 33.5 %)** —
    // a THIRTEEN-slice run. 🛑 **AND IT IS THE FIRST STEP IN THAT RUN THAT IS NOT
    // AN ABILITY STEP**: `BUILT.ability` stands still at 157 and the whole delta is
    // `BUILT.specialEnergy` 2 → 4, a column that had not moved since D239. The
    // pointer D260 left in the line directly above — `sv05-161`, "the `effect`
    // column and not this one" — is what this slice followed, which is the ladder
    // discipline paying out one slice later on a DIFFERENT COLUMN. 🆕 **AND THE
    // COLUMN IT LANDED IN IS NOW MEASURED END TO END**: 7 sentences / 8 printings
    // legal, 4 built, and the 4-printing residue named with its blocker each.
    // ⚠️⚠️ **AND D262 MOVES IT AN EIGHTEENTH TIME: 218 → 219 (33.5 % → 33.6 %)** —
    // a FOURTEEN-slice run, and the SECOND consecutive step that is not an ability
    // step. `BUILT.ability` stands still at 157 and the whole delta is
    // `BUILT.specialEnergy` 4 → 5. 🆕 **AND THE COLUMN IT LANDED IN IS DOWN TO
    // THREE**: 7 sentences / 8 printings legal, 5 built, and the 3-printing residue
    // still named with its blocker each in `mistEnergy.test.ts`.
    // ⚠️⚠️ **AND D263 MOVES IT A NINETEENTH TIME: 219 → 226 (33.6 % → 34.7 %)** —
    // a FIFTEEN-slice run, and the BIGGEST single step in it. 🛑 **THE RUN GOES
    // BACK TO BEING AN ABILITY STEP AFTER TWO SPECIAL-ENERGY ONES**:
    // `BUILT.specialEnergy` stands still at 5 (its column is CLOSED — three
    // residue printings, every one seam-blocked), `BUILT.trainer` at 57, and the
    // whole delta is `BUILT.ability` 157 → 164. 🆕 **AND THE POINTER D262 LEFT —
    // "run the `%discard%…%attach%` ladder across all three columns and let it
    // pick" — is what this slice followed**, which is the ladder discipline paying
    // out for the FIFTH consecutive slice, this time by measuring that rung 1 of
    // the prescribed ladder returns **ZERO** and rung 2 returns 38.
    // ⚠️⚠️ **AND D264 MOVES IT A TWENTIETH TIME: 226 → 231 (34.7 % → 35.5 %)** —
    // a SIXTEEN-slice run. 🛑 **AND IT IS THE FIRST STEP IN THAT RUN THAT MOVES
    // TWO COLUMNS AT ONCE**: `BUILT.ability` 164 → 166 AND `BUILT.trainer` 57 → 60,
    // with `BUILT.specialEnergy` still at 5. That is not ambition, it is the ROW's
    // shape — `discardPileRetrieval` is one op whose printed sentence appears on
    // both surfaces, so one ladder over one zone surfaced an Ability and a
    // Supporter together, and the two halves shared the one `CardFilter` widening
    // between them. 🆕 **AND THE POINTER D263 LEFT — "run the
    // `%put%from your discard pile%` ladder across all three columns and let the
    // measurement pick the row" — is what this slice followed**, the ladder
    // discipline paying out for the SIXTH consecutive slice. 🆕 **THIS TIME RUNG 1
    // WAS DELIBERATELY WIDENED BEFORE IT WAS RUN** (D263's rung 1 returned zero
    // because it guessed the word order): the bare zone phrase `%discard pile%`
    // returned **98 printings / 57 sentences**, `%from your discard pile%` 67 / 40,
    // and neither rung was empty.
    // ⚠️⚠️ **AND D265 MOVES IT A TWENTY-FIRST TIME: 231 → 236 (35.5 % → 36.3 %)**
    // — a SEVENTEEN-slice run, and the SECOND consecutive step to move two columns
    // at once: `BUILT.ability` 166 → 168 AND `BUILT.trainer` 60 → 63, with
    // `BUILT.specialEnergy` still at 5. 🛑 **BUT THE REASON IS NOT D264's, AND THE
    // DIFFERENCE IS THE FINDING.** D264's two halves shared an OP
    // (`discardPileRetrieval` printed on two surfaces); this slice's two halves
    // share a FILTER and nothing else — Buddy-Buddy Poffin is `searchDeck` over the
    // DECK, Gentle Fin is `discardPileRetrieval` over the DISCARD PILE, and they
    // sit in two different backlog families. **A VOCABULARY ITEM'S YIELD IS NOT
    // BOUNDED BY THE ROW THAT PROMPTED IT**, which is why a per-row count could
    // never have priced this one. 🆕 **AND THE POINTER D264 LEFT — "the
    // HP-threshold `CardFilter` rider, 5 printings on 2 sentences across 2 ops" —
    // is what this slice built, re-measured first**: the ladder
    // (`%HP or%` → `%HP or less%`, all three text columns, `legal_standard = 1`)
    // returns **18 rows / 15 legal on 6 sentences**, of which **9 / 4 are the CARD
    // read** and **6 / 2 the BOARD read** ("HP or less REMAINING" — Bianca's
    // Devotion and Ledian, unreachable from `matchesFilter` at any width). Both
    // rungs returned the same 18 rows, so the phrase has no wider spelling.
    // ⚠️⚠️ **AND D266 MOVES IT A TWENTY-SECOND TIME: 236 → 239 (36.3 % → 36.7 %)**
    // — an EIGHTEEN-slice run, and the FIRST step in three to move ONE column:
    // `BUILT.trainer` 63 → 66, with `BUILT.ability` at 168 and
    // `BUILT.specialEnergy` at 5. The row is one sentence on one surface
    // (Clemont's Quick Wit — *"Heal 60 damage from each of your {L} Pokémon."*),
    // and its price is ONE optional op field plus ONE conjunct inside an existing
    // loop. 🆕 **THE POINTER D265 LEFT WAS FOLLOWED AND ITS `needs` STRING WAS
    // RE-READ AGAINST THE CODE FIRST**, which is the rule three consecutive
    // slices have now found the hard way: the field really was absent, and the
    // string was right about the PIECE while silent about the ZONE (`Card.types`
    // is the datum of a CARD read and of a BOARD read alike, and this one is a
    // BOARD read).
    // 🛑 **AND THE LADDER COULD NOT BE RUN AT ALL THIS SLICE — SAY SO RATHER THAN
    // QUOTING AN INHERITED WIDER CENSUS AS IF IT WERE MEASURED.** The remote D1
    // `luminous` answers `401 Authentication error` in this container and the
    // local miniflare sqlite is absent, so the `%from each of your%` census D265
    // prescribed has **no measurement here**. What IS measured is the registry
    // half of the join at both ends (396 → 399 non-attack ids, the three added
    // being exactly this row's) — see `BUILT.trainer`'s note.
    // ✅✅ **D267 — 239 → 242, AND THIS IS THE SLICE THAT PAID D266's DEBT.** The
    // catalog is reachable again, so the join ran at BOTH ends from scratch: the
    // 399 non-attack registry ids at `34ebc20` answer **168 / 66 / 5** — D266's
    // inherited trainer 66 CONFIRMED — and the 402 in this tree answer
    // **171 / 66 / 5**. The row is Latias ex "Skyliner" (`sv08-076`/`-220`/
    // `-239`), one sentence on the ABILITY surface, priced at ONE optional
    // passive field plus ONE conjunct in an existing scan. 🆕 **AND THE LADDER
    // RAN THIS TIME.** Rung 0, the bare noun `%Retreat Cost%` over all three text
    // columns with `legal_standard = 1`, returns **24 printings**; rung 1
    // (`%no Retreat Cost%`) returns **11 on FIVE sentences** — Archaludon's
    // "Metal Bridge" (3, BUILT), this row (3), N's Castle (1, the owner-prefixed
    // Stadium `ownerPrefix.test.ts` already names), Rescue Board (3, a Tool with
    // a remaining-HP antecedent) and Ethan's Magcargo "Melt Away" (1, a SELF gate
    // conditioned on carrying no Energy — `hasFreeRetreatSelf`'s shape with a
    // different antecedent, NOT this field's). ⚠️ **SO THE RESIDUE ON THIS NOUN IS
    // 5 LEGAL PRINTINGS ON 3 SENTENCES**, and none of them is a stage variant.
    // ✅ **D268 — 242 → 244.** The row is Gothitelle "Distorted Future"
    // (`svp-211`/`sv10.5w-043`), one sentence on the ABILITY surface, priced at
    // ONE union member plus ONE ternary in an existing seat funnel. 🆕 **THE
    // LADDER RAN, AND IT RAN FROM THE BARE NOUN.** Rung 0, `%shuffle%` over all
    // three text columns at `legal_standard = 1`, returns **281 printings**; rung
    // 1 (`%hand into%deck%`) returns **16 on EIGHT sentences** — this row (2);
    // Lacey (5, `who: "you"` with a prize-gated branch, BUILT since D207); Drasna
    // (2, `"you"` + a coin-gated draw); Victini "Flippity Flap" (1, an ATTACK);
    // Mr. Mime "Mimic" (1, a draw counted off the opponent's hand size); Unfair
    // Stamp (1); Team Rocket's Archer (2); and Harlequin (2). ⚠️ **THE LAST THREE
    // ARE THE TRAP AND THEY LOOK EXACTLY LIKE THIS OP**: all print "Each player
    // shuffles their hand into their deck", which is `who: "both"` — and then
    // "you draw 5 cards, and your opponent draws 2/3 cards", which `HandRefreshDraw`
    // cannot express at any `who`, because it is ONE value for EVERY affected seat.
    // **So the residue on this noun is 5 legal printings on 3 sentences, and it is
    // a PER-SEAT DRAW rather than another seat member.** 🆕 **D270 BUILT THAT DRAW
    // AND TOOK 2 OF THE 5** (Harlequin, `HandRefreshDraw.perSeat`); the other 3 are
    // held back by a PLAY GATE reading a last-turn KO, which `GameState` does not
    // record — so the residue on this noun is now **3 on 2**. 🆕 **AND THE `both` ARM
    // THIS ROW NARROWS IS NOT ITSELF STANDARD-LEGAL** — every Judge, Iono,
    // Youngster and Brassius printing in the catalog is `legal_standard = 0`
    // (measured), so the precedent that made this row cheap is a REGISTRY one and
    // not a LEGAL one. Both facts are true; they are not the same fact.
    // 🆕 D269 — **244 → 247, AND ALL THREE ARE IN THE `trainer` TERM.**
    // `coinFlipGate.otherwise`: Picnicker `svp-114` (1) and Drasna
    // `sv08-173`/`-231` (2), two sentences on the SUPPORTER surface. 🛑 **THIS IS
    // THE FIRST SLICE IN ELEVEN WHERE `BUILT.ability` DOES NOT MOVE**, so the
    // per-sentence ability decomposition above gets NO twenty-eighth term — the
    // number it decomposes is unchanged at 173 and a new term would break the tie.
    // The `trainer` column has no decomposition of its own (grepped, not assumed),
    // so this sum and the derived `built` headline are the only two ties on the
    // 69. 🆕 **THE LADDER RAN, AND IT RAN FROM THE BARE NOUN.** Rung 0, `%coin%`
    // over all three text columns at `legal_standard = 1`, returns **236
    // printings** (19 of them non-attack); rung 1, `%If tails%`, returns **36**,
    // of which the NON-ATTACK share (`abilities_json` + `effect`) is **9 on SIX
    // sentences** — Picnicker (1) and Drasna (2) here, and SIX refused for a
    // SECOND missing piece: Lucian `sv06-157`/`-208` (a PER-SEAT flip inside one
    // sentence), Harlequin `sv10.5w-083`/`-163` (the per-seat DRAW D268 priced),
    // Team Rocket's Great Ball `sv10-175` (an Evolution/Basic `CardFilter` pair)
    // and Team Rocket's Venture Bomb `sv10-179`. ⚠️ **VENTURE BOMB WAS THE ONE
    // D268 SAID TO CHECK RATHER THAN ASSUME, AND IT IS NOT FREE**: its heads arm
    // is *"put 2 damage counters on 1 of your opponent's Pokémon"* — a CHOSEN
    // body — and the seven damage ops in the union name the Active
    // (`damageActive`), the whole opponent Bench (`spreadDamage`), self, or the
    // §8.5 defender. None of them takes a pick. **So the answer is 3 on 2, not
    // 4 on 3.**
    // 🆕 D270 — **247 → 249, AND BOTH ARE IN THE `trainer` TERM.**
    // `HandRefreshDraw.perSeat`: Harlequin `sv10.5w-083`/`-163` (2), one sentence
    // on the SUPPORTER surface. 🛑 **SECOND SLICE RUNNING WITH `BUILT.ability`
    // UNMOVED**, so the per-sentence ability decomposition above gets NO
    // twenty-eighth term for the second time.
    // 🆕 **THE LADDER RAN, AND IT RAN FROM THE BARE NOUN — AND THE BARE RUNG CAME
    // BACK AN ORDER OF MAGNITUDE SMALLER THAN D269 PREDICTED.** Rung 0, `%draw%`
    // over all three text columns at `legal_standard = 1`, returns **138
    // printings** (`effect` alone: **49**) — the work order predicted 300-600 and
    // was WRONG, because "draw" is a Trainer/Ability verb and the attack columns
    // that inflate `%coin%` and `%shuffle%` barely print it. Rung 1, `%opponent
    // draws%` over all three columns, returns **5 printings on 3 sentences** —
    // D269's `effect`-only figure re-run across `abilities_json` and
    // `attacks_json` too, and it did not move, so the 5-on-3 is now MEASURED on
    // the wide sweep rather than inherited from a narrow one.
    // ⚠️ **EXACTLY 2 OF THE 5 LAND HERE, AND THE OTHER 3 ARE DECLINED FOR A
    // REASON THAT IS NOT THIS FIELD.** Team Rocket's Archer `sv10-170`/`-223`
    // (5/3) and Unfair Stamp `sv06-165` (5/2) print this exact draw and are now
    // expressible on it — but both open *"You can use this card only if any of
    // your Pokémon were Knocked Out during your opponent's last turn"*, and
    // **`GameState` carries no last-turn-KO datum at all** (grepped in `types.ts`
    // rather than assumed: no `lastTurn`, no `knockedOutLast`, nothing). The five
    // `BoardCondition` kinds are `morePrizesThanOpponent`, `yourStadiumInPlay`,
    // `noEnergyOnYourPokemon`, `opponentActiveDamaged` and
    // `opponentActiveIsEvolution`. That is a STATE change plus a condition member
    // — two further mechanisms — so they are priced and declined, exactly as D268
    // and D269 declined their neighbours. **So the answer is 2 on 1, not 5 on 3.**
    // 🛑 **D271 CORRECTS THAT PARAGRAPH'S ONE INHERITED CLAIM.** "The five
    // `BoardCondition` kinds are …" was STALE when it was written: the union held
    // **23** members at D270, not five, and D271's is the **24th**. The count was
    // copied forward from the M5 board-condition slice and never re-measured —
    // which is exactly the failure mode the *"re-check inherited CLAIMS, not just
    // inherited counts"* rule exists for. Everything else in the paragraph held:
    // `GameState` really did carry no last-turn-KO datum, and it took a field.
    // 🆕 D271 — **249 → 252, ALL THREE IN THE `trainer` TERM.** The last-turn-KO
    // gate: Unfair Stamp `sv06-165` (1, Item) + Hassel `sv06-151`/`-205` (2,
    // Supporter). 🛑 **THIRD SLICE RUNNING WITH `BUILT.ability` UNMOVED.**
    // 🆕 D272 — **252 → 255, ALL THREE IN THE `ability` TERM**, the column's first
    // move since D268. Fezandipiti ex's "Flip the Script" (3 printings, 1
    // sentence): an `AbilityProgram` play gate reusing D271's own condition, plus
    // the cross-copy `oncePerTurn: "sharedByName"` name lock.
    // 🆕 D273 — **255 → 260, ALL FIVE IN THE `ability` TERM**, the column's second
    // consecutive move and its biggest since D263. Pecharunt ex's "Subjugating
    // Chains" (5 printings, 1 sentence): two candidate riders on `switchActive`,
    // D272's name lock reused verbatim, and a §9.2 poison tail that was already
    // built. ✅ **AND THIS IS THE FIRST TIME THIS LINE'S INPUT WAS FORCED RATHER
    // THAN REMEMBERED** — the partition at the foot of this file named the five
    // ids before `BUILT.ability` was touched.
    // 🆕 D275 — **260 → 262, BOTH IN THE `ability` TERM**, the column's THIRD
    // consecutive move. Fan Rotom's "Fan Call" (2 printings, 1 sentence): a
    // `BoardCondition` for the per-seat turn ORDINAL — DERIVED from `state.turn`
    // and `state.firstPlayer`, so no `GameState` field and no record version
    // question — plus D265's `maxHp` rider moving onto `typedPokemon`, and D272's
    // name lock reused verbatim for the third and last time. ✅ **SECOND
    // CONSECUTIVE SLICE WHOSE INPUT WAS FORCED RATHER THAN REMEMBERED.**
    // 🆕 D277 — **262 → 265, ALL THREE IN THE `ability` TERM**, the column's
    // FOURTH consecutive move. Meloetta ex's "Debut Performance" (3 printings,
    // 1 sentence): a `PassiveEffects` boolean LICENSING the body to attack on
    // turn 1, plus one `passivesOf` fold term and one extracted `continuous.ts`
    // predicate that three payability sites now share. ✅ **THIRD CONSECUTIVE
    // SLICE WHOSE INPUT WAS FORCED RATHER THAN REMEMBERED** — the partition named
    // `sv10.5b-044`/`-159`/`-167` before `BUILT.ability` was touched.
    // 🆕 D278 — **265 → 268, ALL THREE IN THE `ability` TERM**, the column's
    // FIFTH consecutive move and its FOURTH consecutive `ability`-only one.
    // Eevee's "Boosted Evolution" (3 printings, 1 sentence): a `PassiveEffects`
    // boolean LICENSING the body to evolve EARLY, one ZONE-GATED `passivesOf`
    // fold term, and one new `continuous.ts` predicate that FIVE ban lines now
    // share across two files. ✅ **FOURTH CONSECUTIVE SLICE WHOSE INPUT WAS
    // FORCED RATHER THAN REMEMBERED** — the partition named `sv08-143`/
    // `sv08.5-074`/`svp-173` before `BUILT.ability` was touched, and this slice
    // is the first that could WATCH that happen (D277's tree arrived with the
    // constants already moved, so its own version of this claim is recorded as
    // unmeasured).
    // 🆕 D280 — **272 → 273, THE ONE IN THE `trainer` TERM**, and the first
    // NON-`ability` step since D271. Call Bell `sv08-165` (1 printing, 1
    // sentence): the `BoardCondition` combinator `allOf` and the `youGoSecond`
    // leaf, both new vocabulary, on a body that is three existing ops. 🛑 **A
    // VOCABULARY SLICE DOES NOT HAVE TO MOVE THE ABILITY DECOMPOSITION** — five
    // consecutive slices moved it, D279's handoff forecast a sixth, and this one
    // moves the trainer term instead because the printing that needs the new
    // members happens to be an Item. ✅ **FIFTH CONSECUTIVE SLICE WHOSE INPUT WAS
    // FORCED RATHER THAN REMEMBERED** — the partition named `sv08-165` before
    // `BUILT.trainer` was touched.
    // 🆕 D281 — **273 → 286, A THIRTEEN-PRINTING STEP IN THE `ability` TERM AND
    // THE BIGGEST IN THIS RUN.** The per-attack-index timing gate: ONE
    // `CardProgram` field carrying THREE arms over TWO polarities, ZERO new
    // `BoardCondition` members (D280's `allOf` + `youGoSecond` is the condition on
    // 10 of the 13, authored unchanged), ZERO new `EffectOp`s and ZERO new
    // `GameState` fields. 🛑 **AND ALL 13 SHIP GATE-ONLY — 13 GATES BUILT, 0
    // BODIES** — so `BUILT.attack` does not move at all, which is the honest
    // reading of a slice whose printed sentences are attacks. ✅ **SIXTH
    // CONSECUTIVE SLICE WHOSE INPUT WAS FORCED RATHER THAN REMEMBERED** — the
    // partition named all 13 ids before `BUILT.ability` was touched.
    // 🆕 D284 — **286 → 290, A FOUR-PRINTING STEP IN THE `ability` TERM**, and the
    // narrowest possible vocabulary move: ONE `PassiveEffects` field carrying a
    // CLASS LIST, ONE widened `HandPlayClass`, ONE new `continuous.ts` scan and
    // ONE new read site (`attachTool`). ZERO new `EffectOp`s, ZERO new
    // `BoardCondition` members, ZERO new `GameState` fields — and therefore ZERO
    // `MATCH_RECORD_VERSION` movement, which is the whole shape of the slice.
    // 🛑 **AND THE STEP IS 4 WHERE THE CENSUS RETURNED 7** — a vocabulary slice
    // ships what its vocabulary reaches, and the three it does not are refused
    // with their missing mechanisms named on the field. ✅ **SEVENTH CONSECUTIVE
    // SLICE WHOSE INPUT WAS FORCED RATHER THAN REMEMBERED** — the partition named
    // all four ids before `BUILT.ability` was touched.
    // 🆕 D287 — **291 → 292, THE ONE IN THE `ability` TERM**, the column's THIRD
    // consecutive move (Copperajah `sv06.5-042`, 1 printing, 1 sentence).
    // 🆕 D294 — 293 → 295, the ABILITY column alone (Mandibuzz ×2).
    // 🆕 D295 — 295 → 296, the TRAINER column alone (Chill Teaser Toy `sv08-166`).
    expect(BUILT.ability + BUILT.trainer + BUILT.specialEnergy).toBe(296);

    // ⚠️ AND THE ATTACK HALF IS THE ONE THAT DID NOT. The slices since `02b839c`
    // claim 169 attack printings between them (D227 13, D228 8, D229 13, D230 20,
    // D231 28, D232 21, D234 12, D235 20, D236 9, D237 10, D238 8, **D239 7**);
    // the sweep measures 171. The
    // extra 2 are ONE sentence no row claimed — "Move all damage counters from 1
    // of your Benched Pokémon to 1 of your opponent's Pokémon.", which D216's
    // `moveCountersChosen` made derivable as a side effect. A slice can move
    // printings it never counted.
    //
    // ⚠️ THE GAP IS STILL EXACTLY 2, WHICH IS THE USEFUL PART, AND **EIGHTH
    // SLICE RUNNING**. D241's own 10 is checked from both ends: the sweep at HEAD
    // returns 1,102 + 4 where the pre-slice build returned 1,092 + 4, and the 10
    // are exactly the printings `derivedLookAtTop.test.ts` names by id.
    // ⚠️ D247 — 187 → 191, and the gap holds at 2 for the NINTH slice running.
    // ⚠️ D248 — 191 → 193, and the gap holds at 2 for the TENTH.
    // 🆕 D282 — 193 → 207, the first move in this ledger since D248, and **THE
    // GAP HOLDS AT EXACTLY 2 FOR THE ELEVENTH SLICE RUNNING** (207 measured,
    // 205 claimed). This slice claims **14** and every one is named by id:
    // 6 raw (`sv09-051`/`sv10.5b-076`/`-153` additive, `sv06-018`/`-170`/
    // `sv08.5-010` multiply) + 8 split (Terapagos ex ×7, Volbeat `sv06-009`).
    // ⚠️ **THE FORECAST SAID THE RESIDUE MIGHT MOVE AND IT DID NOT** — a split
    // anchor re-reads sentences no row claimed only if the readers are loosened,
    // and none was: the split hands over a WHOLE sentence to unchanged `^…$`
    // anchors, so it cannot reach a printing that was not already 13 named rows.
    // 🆕 D283 — 207 → 215, and **THE GAP HOLDS AT EXACTLY 2 FOR THE TWELFTH
    // SLICE RUNNING** (215 measured, 213 claimed). This slice claims **8** and
    // every one is named by id: 6 raw (Budew `sv08.5-004`, Frillish
    // `sv10.5w-044`/`-126`, Galvantula ex `sv07-051`/`-159`/`-168`) + 2 split
    // (Scream Tail ex `sv06-094`/`-197`). ⚠️ **THE FORECAST SAID THE RAW SWEEP
    // WOULD STAND STILL AND IT DID NOT** — but the residue is what tells you
    // whether that was a LOOSENING or a WIDER POPULATION, and it says the second:
    // all three new anchors are `^…$`, all 6 raw printings are named by id, and
    // the unexplained remainder did not grow by one.
    // 🆕 D285 — 215 → 216, and **THE GAP HOLDS AT EXACTLY 2 FOR THE THIRTEENTH
    // SLICE RUNNING** (216 measured, 214 claimed). This slice claims **1** and it
    // is named by id: Bronzong `sv05-069` "Evolution Jammer", raw. ⚠️ **THE RAW
    // SWEEP MOVED, AND THE RESIDUE IS AGAIN WHAT TELLS YOU WHETHER THAT WAS A
    // LOOSENING** — the new anchor is `^…$`, the one new printing is named, and
    // the unexplained remainder did not grow by one, so the move is a WIDER
    // POPULATION rather than a reader that started swallowing sentences.
    expect(BUILT.attack - 922).toBe(216);
    expect(
      13 + 8 + 13 + 20 + 28 + 21 + 12 + 20 + 9 + 10 + 8 + 7 + 3 + 10 + 3 + 4 + 2 + 14 + 8,
    ).toBe(213);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);
  });

  it("the eight rows are a NAMED FRACTION of the unbuilt attack column, not all of it", () => {
    const unbuiltAttack = POPULATION.attackUnits - BUILT.attack;
    expect(unbuiltAttack).toBe(594); // 595 at D283/D284, 603 at D282, 617 at D248, 619 at D247

    // Row 0 (evolve-from-deck) is measured here but is NOT one of rows 9-16 — it
    // sits in the doc's separately-priced table, blocked on "the interpreter must
    // never evolve" (registry.ts, `rareCandy`). Excluded from the fraction.
    const inRows = ROWS.filter((r) => r.row !== 0).reduce((sum, r) => sum + printings(r), 0);
    // ⚠️ D241 MOVES BOTH HALVES AT ONCE — 52 → 42 and 636 → 626 — which is the
    // ORDINARY shape and worth naming beside the two anomalies below: row 11 was
    // in `ROWS` before the slice and is still in it after, so its 10 printings
    // leave the numerator and the denominator together.
    // ⚠️ UNCHANGED AT D240, AND THAT IS THE POINT RATHER THAN AN OVERSIGHT. Row
    // 17's 3 printings were measured INTO the doc by D239 and deliberately kept
    // OUT of the fraction it reported ("counted from the next slice, not
    // retro-fitted into a fraction measured before it existed"). D240 built all
    // three, so the row never entered `ROWS` at all: the numerator stands still
    // while the DENOMINATOR falls by 3. 🆕 **A ROW CAN BE BORN AND DIE WITHOUT
    // EVER APPEARING IN THIS TABLE**, which is the opposite failure mode from
    // D238's residue (work that moved `BUILT.attack` and not `inRows`) and has
    // the same cause: the ranked table is a snapshot, not a ledger.
    // ⚠️ D248 — 35 → 33, and it is the ORDINARY shape a third slice running: row
    // 9 was in `ROWS` before the slice and is still in it after, so its 2
    // printings leave the numerator and the denominator together (35 → 33, 619 →
    // 617). Both halves moving by the same 2 still takes the fraction DOWN,
    // because the numerator is a twentieth of the denominator: equal absolute
    // moves are unequal relative ones, which is why this figure keeps falling
    // even on the slices that move nothing else.
    expect(inRows).toBe(33); // 35 at D247, minus the 2 D248 read out of row 9

    // 🛑 THE STRUCTURAL FINDING, PINNED: 42 of 626 is **7 %** (52 of 636 was
    // 8 %, 59 of 646 was
    // 9 %, 63 of 654 was 10 %, 73 of 664 was 11 %, 82 of 673 was 12 %, 102 of 693
    // was 15 %, 114 of 705 was 16 %). D187's backlog was fat families; what is
    // left is a long tail, and eight rows of it is under a twelfth.
    // ⚠️ **THE FRACTION FELL RATHER THAN ROSE, FOR THE SEVENTH SLICE RUNNING**,
    // which is the shape of every slice from here: taking a named row shrinks the
    // named part of the backlog faster than it shrinks the whole, because the
    // unnamed 267-string tail is untouched by anything an anchor can do.
    // ⚠️ AND ROW 15 IS THE FIRST ROW TO GO DOWN TO **TWO** WITHOUT BEING FINISHED
    // BY AN ARM: both survivors are SUPPLY-SIDE ABSENCES (`Ancient`, `Future`), so
    // no anchor can ever take them and the residual 2 is a permanent floor until
    // the INGEST changes. A row can be exhausted without being emptied.
    // ⚠️ D240 LEFT IT AT 8 % WITH A SMALLER DENOMINATOR (52 of 636), the first
    // slice since D233 not to move this figure at all; D241 takes it to **7 %**.
    // ⚠️ D246 TAKES IT TO **6 %** (39 of 623) AND MOVES BOTH HALVES BY THE SAME 3,
    // which is the ORDINARY shape D241's note named: rows 9 and 12 were in `ROWS`
    // before the slice and are still in it after, so the printings leave the
    // numerator and the denominator together.
    // ⚠️ D248 TAKES IT TO **5 %** (33 of 617) — the eighth consecutive fall.
    // 🆕 D283 TAKES IT TO **6 %** (33 of 595) — and the NUMERATOR did not move.
    // None of this slice's 8 printings was ever in `ROWS`: they were found by
    // re-querying the MECHANISM against D1, not by picking a ranked row, so the
    // denominator falls alone. **A SLICE CAN BUILD REAL WORK THE RANKED TABLE
    // NEVER SAW** — D240's lesson (a row born and dead without appearing here)
    // with the row missing entirely rather than short-lived.
    // 🆕 D285 LEAVES IT AT **6 % (33 of 594)** — the numerator unmoved for the
    // THIRD consecutive slice, and for D283's reason exactly: this slice's one
    // attack printing (Bronzong `sv05-069`) was never in `ROWS` either, because it
    // was found by querying the ACT against D1 rather than by picking a ranked row.
    // ⚠️ **THE DENOMINATOR NOW FALLS ONE AT A TIME AND THE FRACTION IS STUCK** —
    // 595 → 594 does not move a rounded percentage, so this assertion can sit green
    // through several slices in a row. That is a property of the ROUNDING, not
    // evidence that the backlog is static: read `unbuiltAttack` itself, which is
    // asserted on its own line above and moves every time.
    expect(Math.round((inRows / unbuiltAttack) * 100)).toBe(6);
  });
});

// ── D273 — THE LIVE HALF OF THE CENSUS ──────────────────────────────────────
//
// 🛑 **WHY THIS SECTION EXISTS: THE THREE NON-ATTACK COLUMNS ABOVE COULD NOT GO
// RED.** D272 shipped three new registry ability rows and `bun run check` ran
// GREEN with `BUILT.ability` still reading 173. Nothing in this file DERIVED that
// column: the per-sentence decomposition ties `BUILT.ability` to a sum of term
// LENGTHS (both sides hand-edited together), and the D1 `GROUP BY category` join
// that actually produces the number only ever ran when a human ran it. **The tie
// guarded the arithmetic, the join guarded the census, and NEITHER guarded the
// BUMP.** Eleven slices wrote "this line went RED the moment `BUILT.ability` was
// bumped", which describes a guard that fires AFTER the work is already done.
//
// ⚠️ **WHAT IS LIVE HERE AND WHAT IS RECORDED, SAID PLAINLY.** The POOL is live —
// `registryCardIds()` (D272, deliberately not re-exported from the package index)
// and `programFor` compute the 420-id non-attack set on every run. The CATEGORY
// and the LEGALITY are recorded, because they are catalog facts and this suite has
// no catalog: they come from ONE D1 statement (remote D1 `luminous`,
// `id IN (<the 415>) GROUP BY category || ':' || legal_standard`, 2026-08-07),
// whose full output was **Pokemon 181/74, Trainer 74/83, Energy 5/3** (legal /
// not) — 420 rows, every registry id matched, no id missing from the catalog.
//
// ⚠️ **AND THE RECORDED HALF IS A PARTITION, NOT FOUR COUNTS.** Every id in the
// live pool must appear in EXACTLY ONE of the four lists below, and every id in a
// list must be in the live pool. That is the assertion that reddens on a bump: a
// new registry row is in no list, so the partition breaks and the failure NAMES
// the ids. A slice that ships five ability rows and forgets `BUILT.ability` now
// gets five ids back in the diff instead of a green suite.
//
// ⚠️ **THE POOL PREDICATE IS "ANY KEY THAT IS NOT `attack`", NOT A LIST OF
// SURFACE NAMES.** The census recipe in `progress.md` enumerates
// `abilities`/`passive`/`triggered`/`stadium`/`energy`/`trainer`/`rareCandy`; both
// spellings return 420 at HEAD (measured), and the enumerated one is the one that
// silently stops counting when `CardProgram` grows an eighth non-attack surface.
// The negative predicate cannot: a new field is non-attack by default.
//
// ⚠️ **`fix-*` IDS ARE DROPPED, AND THAT IS A CATALOG FACT RATHER THAN A
// CONVENIENCE.** They are constructed demonstrator programs with no printing
// behind them, so no D1 row can classify them and none is legal. The upper-bound
// check D271's truncated regex made mandatory rides here too: the LAST raw
// registry key is asserted to be `fix-experthider`, so a scan that terminated
// early is caught rather than believed.

/** Every registry id whose program carries something other than an `attack`
    table, `fix-*` demonstrators excluded — the pool the D1 census joins against.
    LIVE: it is recomputed from `registryCardIds()` on every run. */
function nonAttackRegistryIds(): string[] {
  return registryCardIds().filter(
    (id) =>
      !id.startsWith("fix-") &&
      Object.keys(programFor(id) ?? {}).some((key) => key !== "attack"),
  );
}

/** The `category = 'Pokemon' AND legal_standard = 1` half of the join — the ids
    behind `BUILT.ability`, recorded one by one rather than as a total. */
const CENSUS_POKEMON_LEGAL: readonly string[] = [
  "sv05-008", "sv05-009", "sv05-010", "sv05-024", "sv05-025", "sv05-050", "sv05-108",
  "sv05-139", "sv05-186", "sv05-189", "sv05-194", "sv05-203", "sv05-205", "sv05-213",
  "sv05-215", "sv06-002", "sv06-020", "sv06-025", "sv06-096", "sv06-112", "sv06-123",
  "sv06-131", "sv06-141", "sv06-171", "sv06-186", "sv06-190", "sv06-199", "sv06-202",
  "sv06-211", "sv06-215", "sv06-216", "sv06-221", "sv06-222", "sv06.5-025", "sv06.5-037",
  "sv06.5-038", "sv06.5-039", "sv06.5-040", "sv06.5-042", "sv06.5-045", "sv06.5-073", "sv06.5-077",
  "sv06.5-083",
  "sv06.5-084", "sv06.5-085", "sv06.5-091", "sv06.5-092", "sv06.5-093", "sv06.5-095",
  "sv07-014", "sv07-038", "sv07-044", "sv07-076", "sv07-107", "sv07-118", "sv07-125",
  "sv07-155", "sv07-156", "sv07-167", "sv08-004", "sv08-009", "sv08-021", "sv08-031", "sv08-049",
  "sv08-052", "sv08-054", "sv08-057", "sv08-076", "sv08-130", "sv08-143", "sv08-150", "sv08-194",
  "sv08-200", "sv08-201", "sv08-213", "sv08-215", "sv08-219", "sv08-220", "sv08-224",
  "sv08-236", "sv08-238", "sv08-239", "sv08-241", "sv08-247", "sv08.5-011", "sv08.5-012",
  "sv08.5-040", "sv08.5-045", "sv08.5-054", "sv08.5-058", "sv08.5-067", "sv08.5-070",
  "sv08.5-074", "sv08.5-077", "sv08.5-085", "sv08.5-088", "sv08.5-145", "sv08.5-160", "sv08.5-163",
  "sv08.5-168",
  "sv08.5-176", "sv08.5-177", "sv08.5-178", "sv08.5-179", "sv09-007", "sv09-018",
  "sv09-024", "sv09-031", "sv09-053", "sv09-055", "sv09-075", "sv09-095", "sv09-098",
  "sv09-117",
  "sv09-136", "sv09-163", "sv09-171", "sv09-172", "sv09-175", "sv09-182", "sv09-183",
  "sv09-185", "sv09-188", "sv09-189", "sv10-008", "sv10-010", "sv10-012", "sv10-020",
  "sv10-039", "sv10-048", "sv10-051", "sv10-065", "sv10-081", "sv10-103", "sv10-108",
  "sv10-113", "sv10-121", "sv10-122", "sv10-136", "sv10-155", "sv10-159", "sv10-184",
  "sv10-185",
  "sv10-186", "sv10-187", "sv10-205", "sv10-209", "sv10-210", "sv10-213", "sv10-217",
  "sv10-230", "sv10-231", "sv10-234", "sv10-239", "sv10-240", "sv10-242", "sv10.5b-003",
  "sv10.5b-009", "sv10.5b-023", "sv10.5b-024", "sv10.5b-031", "sv10.5b-044", "sv10.5b-052",
  "sv10.5b-056", "sv10.5b-067", "sv10.5b-094",
  "sv10.5b-107", "sv10.5b-108", "sv10.5b-114", "sv10.5b-130", "sv10.5b-134", "sv10.5b-156",
  "sv10.5b-159", "sv10.5b-161", "sv10.5b-164", "sv10.5b-167", "sv10.5b-169", "sv10.5w-008",
  "sv10.5w-013", "sv10.5w-043", "sv10.5w-045", "sv10.5w-064", "sv10.5w-077", "sv10.5w-093",
  "sv10.5w-098", "sv10.5w-145", "sv10.5w-160", "sv10.5w-162", "sv10.5w-168", "sv10.5w-170",
  "svp-118", "svp-127", "svp-128", "svp-166",
  "svp-173", "svp-177", "svp-182", "svp-184", "svp-194", "svp-205", "svp-211", "svp-216",
  // 🆕 D281 — the per-attack-index timing gate (`CardProgram.attackGate`), 13
  // printings on 5 bodies. 🛑 **THIS COLUMN IS NAMED `ability` AND NOT ONE OF
  // THESE THIRTEEN CARRIES AN ABILITY — SAY SO RATHER THAN LET THE NEXT CENSUS
  // DISCOVER IT.** The column is really "legal Pokémon ids with a non-attack
  // registry surface", and `attackGate` is the EIGHTH such surface — the one the
  // pool predicate's own doc block predicted would arrive and be caught by the
  // NEGATIVE test ("any key that is not `attack`") while the enumerated spelling
  // silently stopped counting. It is also the FIRST that is not an Ability: the
  // printed sentence is ATTACK text, on an attack whose BODY is still unbuilt.
  // ⚠️ **SO `BUILT.ability` MOVING BY 13 IS NOT 13 MORE BUILT ABILITIES**, and
  // `BUILT.attack` deliberately does NOT move: half a printed attack sentence
  // resolving is not a built attack unit.
  "sv06-009", "sv06-010", "sv06-094", "sv06-197", "sv07-128", "sv07-170", "sv07-173",
  "sv08-001", "sv08-192", "sv08.5-092", "sv08.5-169", "sv08.5-180", "svp-165",
];

/** The `category = 'Trainer' AND legal_standard = 1` half — `BUILT.trainer`. */
const CENSUS_TRAINER_LEGAL: readonly string[] = [
  "sv05-144", "sv05-153", "sv05-154", "sv05-157", "sv06-145", "sv06-148", "sv06-151",
  "sv06-155", "sv06-165", "sv06-204", "sv06-205", "sv06-207", "sv06-217", "sv06-219",
  "sv06-223", "sv06-224", "sv06.5-055", "sv06.5-058", "sv06.5-059", "sv06.5-060",
  "sv06.5-061", "sv06.5-088", "sv07-138", "sv07-139", "sv07-165", "sv07-166", "sv07-172",
  "sv08-165", "sv08-166", "sv08-167", "sv08-173", "sv08-183", "sv08-187", "sv08-229", "sv08-231",
  "sv08-235",
  "sv08-243", "sv08-251", "sv08.5-095", "sv08.5-101", "sv08.5-103", "sv08.5-109",
  "sv08.5-112", "sv08.5-114", "sv08.5-116", "sv08.5-117", "sv08.5-119", "sv08.5-131",
  "sv08.5-137", "sv08.5-173", "sv08.5-175", "sv09-147", "sv09-150", "sv09-153", "sv10-163",
  "sv10-164", "sv10-168", "sv10-169", "sv10-174", "sv10-177", "sv10-220", "sv10-225",
  "sv10-227", "sv10-238", "sv10-244", "sv10.5b-082", "sv10.5b-083", "sv10.5b-084",
  "sv10.5b-162", "sv10.5b-163", "sv10.5b-170", "sv10.5w-081", "sv10.5w-082", "sv10.5w-083",
  "sv10.5w-163", "svp-114",];

/** The `category = 'Energy' AND legal_standard = 1` half — `BUILT.specialEnergy`.
    The population is 11 and not 8 because this column splits by `cards.category`:
    8 Special Energy plus 3 BASIC energy carrying effect text. */
const CENSUS_ENERGY_LEGAL: readonly string[] = [
  "sv05-161", "sv05-162", "sv08-191", "sv09-159", "sv09-190",];

/** The other 160: registry ids whose catalog row is `legal_standard = 0`. They
    are in the pool and in NO column, which is the whole reason this list is
    written down — without it "not in any column" would be indistinguishable from
    "forgot to classify it", and the partition check below could not fire. By
    category: 74 Pokemon, 83 Trainer, 3 Energy. */
const CENSUS_NOT_LEGAL: readonly string[] = [
  "sv01-005", "sv01-006", "sv01-019", "sv01-023", "sv01-041", "sv01-054", "sv01-068",
  "sv01-076", "sv01-086", "sv01-093", "sv01-096", "sv01-099", "sv01-118", "sv01-121",
  "sv01-125", "sv01-142", "sv01-145", "sv01-151", "sv01-167", "sv01-168", "sv01-169",
  "sv01-170", "sv01-171", "sv01-172", "sv01-173", "sv01-174", "sv01-175", "sv01-176",
  "sv01-177", "sv01-178", "sv01-179", "sv01-180", "sv01-181", "sv01-182", "sv01-184",
  "sv01-185", "sv01-186", "sv01-187", "sv01-188", "sv01-189", "sv01-190", "sv01-191",
  "sv01-192", "sv01-193", "sv01-194", "sv01-196", "sv01-197", "sv01-198", "sv01-203",
  "sv01-208", "sv01-209", "sv01-222", "sv01-223", "sv01-228", "sv01-231", "sv01-236",
  "sv01-237", "sv01-238", "sv01-240", "sv01-241", "sv01-243", "sv01-245", "sv01-247",
  "sv01-250", "sv01-251", "sv01-254", "sv01-255", "sv01-256", "sv02-015", "sv02-060",
  "sv02-061", "sv02-089", "sv02-097", "sv02-105", "sv02-113", "sv02-123", "sv02-126",
  "sv02-127", "sv02-140", "sv02-150", "sv02-170", "sv02-171", "sv02-172", "sv02-173",
  "sv02-175", "sv02-176", "sv02-179", "sv02-180", "sv02-181", "sv02-182", "sv02-183",
  "sv02-184", "sv02-185", "sv02-187", "sv02-188", "sv02-189", "sv02-190", "sv02-191",
  "sv02-193", "sv02-210", "sv02-227", "sv02-231", "sv02-236", "sv02-243", "sv02-245",
  "sv02-248", "sv02-250", "sv02-251", "sv02-252", "sv02-253", "sv02-254", "sv02-255",
  "sv02-256", "sv02-261", "sv02-263", "sv02-265", "sv02-266", "sv02-267", "sv02-268",
  "sv02-269", "sv02-270", "sv02-271", "sv02-274", "sv02-275", "sv02-276", "sv02-277",
  "sv03-012", "sv03-030", "sv03-044", "sv03-052", "sv03-070", "sv03-078", "sv03-082",
  "sv03-112", "sv03-120", "sv03-125", "sv03-143", "sv03-174", "sv03-187", "sv03-190",
  "sv03-192", "sv03-193", "sv03-196", "sv03-197", "sv03-201", "sv03-215", "sv03-219",
  "sv03-220", "sv03-223", "sv03-227", "sv03-228", "sv03-229", "sv06.5-096", "swsh10.5-011",
  "swsh10.5-018", "swsh10.5-025", "swsh10.5-055", "swsh10.5-069", "swsh10.5-078",
  "swsh10.5-084",];

describe("D273 — the non-attack BUILT columns, derived from the LIVE registry", () => {
  it("the live non-attack pool is 415 ids and the scan reached the last raw key", () => {
    // The upper bound FIRST — D271 lost its union position to a regex that
    // terminated early, and a pool scan that stops short under-counts silently in
    // exactly the direction that makes every column below look correct.
    const raw = registryCardIds();
    expect(raw[raw.length - 1]).toBe("fix-experthider");
    // 🆕 D278 — **540 → 543**, Eevee "Boosted Evolution" ×3, and NO `fix-*`
    // demonstrator for the second slice running (the suite drives a local
    // `cardPool`, D275's idiom). ⚠️ **BOTH NUMBERS WERE OBSERVED RED BEFORE THEY
    // WERE TOUCHED, WHICH D277 COULD NOT DO** — its inherited tree arrived with
    // the constants already moved. The measurement: `censusAtHead.test.ts` went
    // red in **TWO** places on the untouched constants (this `540` and the
    // partition guard below, which named exactly `sv08-143`/`sv08.5-074`/
    // `svp-173` as unclassified), NOT four — `425` and `BUILT.ability` never
    // fired, because both are ASSERTED THROUGH the list whose size the partition
    // guard checks and a single suite run reports only the first failure in each
    // `it`. **"Four red places" and "four wrong constants" are different
    // numbers**, and only the second one is what a hand-maintained census costs.
    // 🆕 D280 — **547 → 549**, and the step is **+2 for +1 PRINTING**: Call Bell
    // `sv08-165` plus the `fix-callbell` demonstrator the 978-row / 6-set local
    // catalog forces (it holds no `sv08` row, so a fixture id naming the real
    // printing would fail `catalogManifest.test.ts` — Carmine's reason verbatim).
    // ⚠️ **THE TWO LINES BELOW THEREFORE MOVE BY DIFFERENT AMOUNTS**, and that is
    // the point of keeping them as two: `raw` counts every registry KEY including
    // `fix-*`, `nonAttackRegistryIds()` counts only ids the catalog knows, so
    // 432 → **433**. A slice that bumped both by the same number would be wrong
    // in whichever direction it guessed.
    // 🆕 D281 — **549 → 562**, and the step is **+13 for +13 PRINTINGS**, the
    // first slice in this run where the two lines below move by the SAME amount.
    // No `fix-*` demonstrator was needed on any of them: these are Pokémon BODIES
    // driven on a LOCAL `cardPool` (D275's idiom, D277's precedent with Meloetta
    // ex), not Trainers played against `FIXTURE_POOL`, so the real ids carry the
    // programs and no fixture was added anywhere.
    // 🆕 D284 — **562 → 566**, and the step is **+4 for +4 PRINTINGS** on the
    // SAME terms as D281: no `fix-*` demonstrator on any of them, because these
    // are Pokémon BODIES driven on a LOCAL `cardPool` (D275's idiom) rather than
    // Trainers played against `FIXTURE_POOL`. ⚠️ **THE POPULATION WAS 7 AND THIS
    // IS 4** — Copperajah `sv06.5-042`, Team Rocket's Arbok `sv10-113` and
    // Genesect `sv06.5-040` are refused with their missing mechanisms named on
    // `PassiveEffects.preventOpponentHandPlay`, so the CENSUS moves by what the
    // vocabulary reached and not by what the sentence family contains.
    // 🆕 D285 — **566 → 568**, and the step is **+2 for +1 PRINTING**: Team
    // Rocket's Arbok `sv10-113` is the only legal id, and the second key is the
    // `fix-potentglare` demonstrator (`fix-spherical`'s reason — the manifest holds
    // no `sv10` row), which is why the two lines below move by DIFFERENT amounts
    // this time where D284's moved by the same. ⚠️ **THE ATTACK HALF OF THIS ONE
    // MECHANISM IS NOT HERE AT ALL** — Bronzong `sv05-069` is TEXT-DERIVED and
    // authors no registry row, so it moves `BUILT.attack` and nothing on this line.
    // 🆕 D287 — **568 → 569**, and the step is **+1 for +1 PRINTING**: Copperajah
    // `sv06.5-042` is the only legal id and NO `fix-*` demonstrator is owed, on
    // D284's terms rather than D285's — this is a Pokémon BODY driven on a LOCAL
    // `cardPool` (D275's idiom), not a Trainer played against `FIXTURE_POOL`, so
    // the two lines below move by the SAME amount this time where D285's moved by
    // different ones. ⚠️ **THE BARRED SIDE WAS QUERIED TOO** (D286's rule): 26
    // legal Stadium printings under 19 distinct names, so unlike D286's Rare Candy
    // this bar and the cards it stops genuinely meet on a Standard board.
    // 🆕 D294 — **570 → 572**, and the step is **+2 for +2 PRINTINGS**: Mandibuzz
    // `sv10.5w-064`/`-145` are both legal ids and NO `fix-*` demonstrator is owed
    // (D287's terms, not D285's — the Ability is driven on a LOCAL `cardPool`
    // body), so the two lines below move by the SAME amount. ⚠️ **THE ATTACK HALF
    // OF THIS MECHANISM IS NOT HERE AND IS NOT BUILT EITHER**: Lickitung
    // `sv05-124`/`-180` "Tongue Pull" prints the SAME destination as an ATTACK and
    // is REFUSED on a count (see LOOK_FOR_PREY's doc), so unlike D285's Bronzong
    // it moves neither this line nor `BUILT.attack`.
    // 🆕 D295 — **572 → 574, AND THE TWO LINES MOVE BY DIFFERENT AMOUNTS AGAIN**
    // (D285's shape, not D287's/D294's): Chill Teaser Toy `sv08-166` is ONE legal
    // printing, and it OWES a `fix-chillteaser` demonstrator for Call Bell's
    // reason verbatim — it is a TRAINER played against `FIXTURE_POOL`, and the
    // 978-row / 6-set `catalogManifest.ts` holds no `sv08` row at all. So raw
    // takes **+2** and the legal pool below takes **+1**. ✅ **FORCED RATHER THAN
    // REMEMBERED, and the partition fired FIRST**: `unclassified` named exactly
    // `["sv08-166"]` before either number here was touched.
    expect(raw.length).toBe(574); // 540 at D277; 543 at D278; 547 at D279; 549/562 at D280/D281
    expect(nonAttackRegistryIds().length).toBe(456); // 425/428/432/433/446 at D277-D281
  });

  it("the four recorded lists PARTITION the live pool — this is the guard that reddens on a bump", () => {
    const pool = nonAttackRegistryIds();
    const recorded = [
      ...CENSUS_POKEMON_LEGAL,
      ...CENSUS_TRAINER_LEGAL,
      ...CENSUS_ENERGY_LEGAL,
      ...CENSUS_NOT_LEGAL,
    ];
    // No id classified twice — otherwise a column could borrow from another and
    // the sizes would still add up.
    expect(new Set(recorded).size).toBe(recorded.length);
    // ⚠️ BOTH DIRECTIONS, and they fail for different reasons. `unclassified` is
    // a registry row that shipped without a census visit (D272's exact defect);
    // `phantom` is a census entry whose registry row was deleted or renamed.
    const inPool = new Set(pool);
    const inRecorded = new Set(recorded);
    const unclassified = pool.filter((id) => !inRecorded.has(id));
    const phantom = recorded.filter((id) => !inPool.has(id));
    expect(unclassified).toEqual([]);
    expect(phantom).toEqual([]);
  });

  it("BUILT.ability / .trainer / .specialEnergy ARE the sizes of those lists", () => {
    // 🛑 THIS IS THE LINE THE OLD FILE DID NOT HAVE. With the partition above,
    // the only way to add a legal registry row and keep the suite green is to put
    // its id in a column — at which point the column's SIZE moves, and the
    // constant must move with it. The constant is no longer maintained ahead of a
    // measurement; it is read off one.
    expect(CENSUS_POKEMON_LEGAL.length).toBe(BUILT.ability);
    expect(CENSUS_TRAINER_LEGAL.length).toBe(BUILT.trainer);
    expect(CENSUS_ENERGY_LEGAL.length).toBe(BUILT.specialEnergy);
    // And the recorded not-legal remainder closes the 415 arithmetically, so a
    // column that grew by taking from the remainder is caught too.
    expect(
      BUILT.ability + BUILT.trainer + BUILT.specialEnergy + CENSUS_NOT_LEGAL.length,
    ).toBe(456); // 428/432/433/446 at D278-D281 — D284 adds 4, D285/D287/D291 one each, D294 two
  });

  it("every id in a column really has a non-attack registry program — the attribution control", () => {
    // Without this, all three columns would pass just as happily on a broken
    // `programFor` import returning undefined for everything, because the
    // partition is a set comparison and `nonAttackRegistryIds` would then be
    // empty on BOTH sides. `DERIVABLE_CONTROL` does this job for the attack half;
    // this is its non-attack twin.
    for (const id of [...CENSUS_POKEMON_LEGAL, ...CENSUS_TRAINER_LEGAL, ...CENSUS_ENERGY_LEGAL]) {
      const program = programFor(id);
      expect(program, id).toBeDefined();
      expect(Object.keys(program ?? {}).some((key) => key !== "attack"), id).toBe(true);
    }
  });
});

// ── D274 — THE LAST UNGUARDED COLUMN ────────────────────────────────────────
//
// 🛑 **WHY THIS SECTION EXISTS: `BUILT.attack` HAD EXACTLY THE DEFECT D273 CLOSED
// ONE COLUMN OVER.** D273 took `BUILT.ability` / `.trainer` / `.specialEnergy`
// live and wrote, in the resume point it left behind, *"`BUILT.attack` IS STILL
// UNGUARDED IN EXACTLY THE OLD WAY — it is the seven-reader sweep's number plus 4,
// and nothing re-runs the sweep. THE SAME DEFECT, ONE COLUMN OVER."* Every
// paragraph in `BUILT.attack`'s own comment block promises a re-derivation, and
// every one of them was a HUMAN running a sweep by hand at authoring time. Between
// those runs the readers could be widened, narrowed, or broken outright and 1115
// would sit here being green — for TWENTY-EIGHT consecutive slices, which is
// exactly how long the comment block boasts the constant stood still.
//
// ⚠️ **WHAT IS LIVE HERE AND WHAT IS RECORDED — THE HALVES ARE SWAPPED FROM
// D273's.** Above, the POOL is live (`registryCardIds()`) and the CLASSIFICATION
// is recorded (the four-way partition), because the classifier is the catalog.
// Here it is the other way round: the POPULATION is recorded (`censusAttackCorpus.ts`,
// the 640 legal attack sentences with their printing counts, straight off D1) and
// the CLASSIFICATION is live — the seven exported readers are RUN, here, now, over
// every one of those sentences. That is the half that was missing, and it is the
// half a reader edit moves.
//
// ⚠️ **AND THE `+ 4` IS DERIVED TOO, WHICH IS THE PART THE OLD COMMENT COULD NOT
// DO.** `REGISTRY_ATTACKS` names four legal ids on THREE distinct sentences
// (`sv10-050` and `sv10-194` print the same Misty's search). Those three sentences
// are looked up IN THE CORPUS and their printing counts summed — 1 + 2 + 1 = 4 —
// and each is asserted REFUSED by all seven readers, which is what makes the two
// halves disjoint rather than double-counted. So the whole constant is now a
// measurement: **derived units + registry units = `BUILT.attack`**, with no literal
// on either side of the addition.
//
// ✅ **PROVEN RED TWICE, IN TWO DIFFERENT WAYS, BEFORE IT WAS TRUSTED** — the
// discipline `conventions.md` asks for and the one D273 followed:
//   • **PERTURB THE DATA.** Mangling one byte of the corpus's biggest resolving
//     sentence ("During your next turn, this Pokémon can't attack.", 58 printings)
//     drops the live sum 1,111 → 1,053 and reddens both the sum assertion and the
//     `BUILT.attack` tie. That is the case where the catalog rotates under the
//     suite.
//   • **PERTURB THE CODE.** Narrowing one arm of a real reader in `effects.ts`
//     drops the sum by that arm's printings and reddens the same two assertions
//     with a DIFFERENT delta. That is the case the old constant was blind to, and
//     the reason this guard exists at all.
// Neither perturbation was left in the tree; both are transcribed into
// `scripts/mutation/mutants.ts` so they are re-checkable rather than narrated.
//
// ⚠️ **WHAT THIS STILL DOES NOT GUARD, SAID PLAINLY.** The corpus is a SNAPSHOT.
// If the catalog rotates a set out, this file keeps counting the old population and
// nothing here notices — the same standing limitation `POPULATION` has carried
// since D233, and it is why the corpus ships the exact SQL that produced it. What
// it does guard is the thing that actually changes weekly: the readers.

/** The corpus, keyed by sentence. Built per test rather than at module scope so a
    parse failure lands inside the `it` that needs it. */
function corpusBySentence(): Map<string, number> {
  return new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
}

/** The DISTINCT sentences behind `REGISTRY_ATTACKS`'s four ids — three of them,
    because two Misty's printings share one. */
const REGISTRY_ATTACK_SENTENCES = [...new Set(REGISTRY_ATTACKS.map(([, text]) => text))];

/** 🆕 D282 — the printings `BUILT.attack` owes to the SPLIT ANCHOR: Terapagos ex
    `sv07-128`/`-170`/`-173`/`sv08.5-092`/`-169`/`-180`/`svp-165` (7) and Volbeat
    `sv06-009` (1). NOT a literal in the addition — the test above derives it from
    the corpus and asserts it equals this, and every one of the 8 is driven end to
    end in `benchBodySelfScaling.test.ts` / `gateSplitAnchor` §.
    🆕 **D283 — 8 → 10.** Scream Tail ex `sv06-094`/`-197`'s gated body is the
    THIRD gate sentence to resolve behind the split: `preventHandPlay` reads its
    remainder off an `^…$` anchor and NO reader was loosened to get there, which
    is the whole reason this term is measured apart from the raw sweep. */
const SPLIT_ATTACK_UNITS = 10;

describe("D274 — BUILT.attack, derived from the LIVE readers over the committed corpus", () => {
  it("the corpus IS the legal attack column, to the digit D233 has quoted since", () => {
    const corpus = legalAttackCorpus();
    // The three totals together are the transcription's own checksum: a dropped
    // record moves the count AND the units AND the characters, a doubled one moves
    // all three the other way, and a truncated one moves the characters alone —
    // which is the failure a count-only check would sail past.
    // 🛑 BUT A CHECKSUM OVER A CORPUS IS A TRANSCRIPTION CHECK, NOT A CONTENT
    // CHECK, AND THIS PARAGRAPH'S FIRST DRAFT GOT THAT WRONG. It claimed a
    // MISTYPED sentence moves the character total. The perturbation written to
    // prove this whole section red is the counterexample: swapping `é` for `e` is
    // LENGTH-PRESERVING, so all three totals below stayed GREEN and only the live
    // reader run caught it. **Any integrity check whose subject is a SIZE is blind
    // to a SUBSTITUTION** — which is precisely why the derived figure two tests
    // down is COMPUTED rather than recorded beside these three.
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(1732);
    expect(corpus.reduce((sum, [, text]) => sum + [...text].length, 0)).toBe(60467);
    // Distinctness is the `GROUP BY`'s own postcondition — two records for one
    // sentence would let a printing be counted twice below.
    expect(new Set(corpus.map(([, text]) => text)).size).toBe(640);
    // 🛑 AND IT IS THE SAME POPULATION `POPULATION.attackUnits` ALREADY NAMED.
    // Those were two spellings of one D1 query and nothing tied them; now the
    // denominator and the corpus go red together or not at all.
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(POPULATION.attackUnits);
  });

  it("the seven readers, RUN LIVE over the corpus, resolve 292 sentences / 1,123 printings", () => {
    const resolved = legalAttackCorpus().filter(([, text]) => resolvedByAnyReader(text));
    // 🛑 THIS IS THE LINE THE FILE DID NOT HAVE. Every "re-derived by the sweep"
    // paragraph in `BUILT.attack`'s comment block describes exactly this
    // computation, run by hand, once, at authoring time. It runs on every `bun run
    // check` now.
    expect(resolved.length).toBe(293);
    expect(resolved.reduce((sum, [units]) => sum + units, 0)).toBe(1124);
  });

  it("the SPLIT half — 5 gate sentences in the corpus, 3 of them resolving, 10 printings", () => {
    // 🆕 D282. The raw sweep above structurally cannot see this, because the split
    // produces a different string and no anchor was loosened. Measured here in the
    // same shape the `+ 4` uses one test down: IN the corpus, REFUSED whole,
    // RESOLVED split.
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    // The corpus half of D281's census: 13 legal printings on 5 distinct sentences.
    expect(gated.length).toBe(5);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(13);
    for (const [, text] of gated) {
      // 🛑 NONE of them is readable WHOLE — if one ever is, a reader has been
      // loosened to swallow a compound and this term is double-counting.
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    const resolvedSplit = gated.filter(
      ([, text]) => resolvedByAnyReader(splitAttackGateClause(text)?.body ?? text) === true,
    );
    expect(resolvedSplit.length).toBe(3);
    expect(resolvedSplit.reduce((sum, [units]) => sum + units, 0)).toBe(SPLIT_ATTACK_UNITS);
  });

  it("BUILT.attack IS that live sum plus the registry attacks — no literal in the addition", () => {
    const corpus = corpusBySentence();
    const derived = legalAttackCorpus()
      .filter(([, text]) => resolvedByAnyReader(text))
      .reduce((sum, [units]) => sum + units, 0);

    // The "+4" half, derived rather than asserted. Each registry-authored attack
    // must be IN the corpus (it is a legal printing) and REFUSED by every reader
    // (otherwise it is already inside `derived` and adding it double-counts — the
    // exact mistake the old hand-maintained "+4" could not detect).
    expect(REGISTRY_ATTACK_SENTENCES.length).toBe(3);
    let registryUnits = 0;
    for (const text of REGISTRY_ATTACK_SENTENCES) {
      const units = corpus.get(text);
      expect(units, text).toBeDefined();
      expect(resolvedByAnyReader(text), text).toBe(false);
      registryUnits += units ?? 0;
    }
    expect(registryUnits).toBe(REGISTRY_ATTACKS.length);

    // 🆕 D282 — THE THIRD SUMMAND, derived by the same method and disjoint by the
    // same proof. A gate sentence must be IN the corpus, REFUSED whole (so it is
    // not already inside `derived`) and RESOLVED once split.
    let splitUnits = 0;
    for (const [units, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      if (split === null) continue;
      expect(resolvedByAnyReader(text), text).toBe(false);
      if (resolvedByAnyReader(split.body)) splitUnits += units;
    }
    expect(splitUnits).toBe(SPLIT_ATTACK_UNITS);

    // 🛑 THE GUARD. Widen a reader and `derived` rises; break one and it falls;
    // author a fifth registry attack and `registryUnits` moves; break the split
    // and `splitUnits` falls to 0. Any of the four reddens here, and the only way
    // back to green is to move the constant to what was actually measured.
    expect(derived + registryUnits + splitUnits).toBe(BUILT.attack);
  });

  it("the corpus is really the catalog and the readers really run — the attribution controls", () => {
    const corpus = corpusBySentence();
    // ① POSITIVE. Without this the whole section passes on a broken import that
    // makes every reader return null: `derived` would be 0, and a slice could
    // "fix" it by writing 0. D214's control, applied to the live half.
    expect(corpus.get(DERIVABLE_CONTROL)).toBe(22);
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);

    // ② NEGATIVE, AND IT IS THE CROSS-TIE. Every sentence the eight backlog rows
    // name as UNBUILT must appear in the corpus with the SAME printing count the
    // row claims, and must still be refused. That welds the row table — thirty
    // slices of hand-recorded counts — to the one measured population, so a row
    // whose count drifted from the catalog can no longer sit here agreeing with
    // itself.
    for (const row of ROWS) {
      for (const [count, text] of row.attack) {
        expect(corpus.get(text), text).toBe(count);
        expect(resolvedByAnyReader(text), text).toBe(false);
      }
    }
  });
});
