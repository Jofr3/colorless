import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { programFor } from "./registry";

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
  attack: 1115,
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
  // ⚠️ 136 at D253 (INCREMENTED, since MEASURED); 133 at D252; 131 at D251; 124 at
  // D249; 120 at D245–D248; 114 at D244; 107 at D243; 100 at D242.
  ability: 137,
  trainer: 57,
  specialEnergy: 2,
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
      "svp-153",
      "svp-159",
      "sv08-059",
      "sv08-130",
      "sv08-224",
      "sv08-241",
      "sv09-085",
      "sv09-166",
      "sv10-020",
      "sv10-187",
      "sv10.5b-031",
      "sv10.5b-114",
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
      "sv06-151",
      "sv06-205",
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
    abilityIds: ["sv10-159", "sv10-205", "sv10.5b-024", "sv10.5b-108"],
    effectIds: ["sv06-155", "sv06-207", "sv06-219"],
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
    abilityIds: [
      "sv05-108",
      "sv05-194",
      "sv07-044",
      "sv08.5-040",
      "sv10-010",
      "sv10-012",
      "sv10-185",
      "sv10-186",
    ],
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
    expect(built).toBe(1311);
    expect(units - built).toBe(1072);

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
        SPHERICAL_SHIELD_IDS.length,
    );
    // …and every id in the new terms really is authored, which is what stops a
    // term from being a number that happens to fit.
    for (const id of [
      ...RIPENING_CHARGE_IDS,
      ...BATTLE_HARDENED_IDS,
      ...CORNERSTONE_STANCE_IDS,
      ...MIGHTY_SHELL_IDS,
      ...CURIOUS_TEA_PARTY_IDS,
      ...SPHERICAL_SHIELD_IDS,
    ]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
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
    expect(nonAttackUnits).toBe(651);
    expect(BUILT.ability + BUILT.trainer + BUILT.specialEnergy).toBe(196);

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
    expect(BUILT.attack - 922).toBe(193);
    expect(13 + 8 + 13 + 20 + 28 + 21 + 12 + 20 + 9 + 10 + 8 + 7 + 3 + 10 + 3 + 4 + 2).toBe(191);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);
  });

  it("the eight rows are a NAMED FRACTION of the unbuilt attack column, not all of it", () => {
    const unbuiltAttack = POPULATION.attackUnits - BUILT.attack;
    expect(unbuiltAttack).toBe(617); // 619 at D247, 623 at D246, 626 at D241, 636 at D240

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
    expect(Math.round((inRows / unbuiltAttack) * 100)).toBe(5);
  });
});
