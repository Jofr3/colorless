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
  attack: 1093,
  ability: 88,
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
    attack: [
      [2, "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon."],
      [1, "Attach an Energy card from your discard pile to this Pokémon."],
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
    attack: [
      [
        3,
        "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      ],
      [3, "Look at the top 5 cards of your opponent's deck and put them back in any order."],
      [3, "Look at the top card of your deck. You may discard that card."],
      [
        2,
        "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
      ],
      [
        2,
        "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
      ],
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
    attack: [
      [
        4,
        "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
      ],
      [
        1,
        "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.",
      ],
      [
        1,
        "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
      ],
      [
        1,
        "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.",
      ],
    ],
    abilityIds: [
      "svp-116",
      "sv06-033",
      "sv06-173",
      "sv06.5-025",
      "sv07-014",
      "sv07-156",
      "sv07-167",
      "sv08.5-011",
      "sv08.5-054",
      "sv09-107",
    ],
    effectIds: [],
  },
];

/** Row 14 has NO attack-column half: it is the three biggest reprint groups left
    in the ABILITY column, each one registry program for six legal printings. They
    are listed apart from `ROWS` precisely because no reader can ever reach them —
    the deriver-sweep half of this file does not apply. */
const ROW_14_ABILITY_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  [
    "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.",
    ["svp-205", "svp-216", "sv10-081", "sv10-213", "sv10-231", "sv10-240"],
  ],
  [
    "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.",
    ["svp-177", "sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168"],
  ],
  [
    "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
    ["svp-128", "sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176"],
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
      // D234 — was 17; the anchor took 12.
      "attach from the DISCARD PILE (attachEnergyFrom, source side)": 5,
      "look at the top N (lookAtTopN)": 15,
      // D237 — was 16; the new anchor took 10. D238 — the brace code took 4 more.
      "the discard pile into the hand or onto the Bench (discardPileRetrieval)": 2,
      'copy an attack ("…and use it as this attack")': 13,
      "evolve out of the DECK — NOT a backlog row, see the doc's blocked table": 13,
      // D239 — was 9; the widened anchor took 7 (all one card, Terapagos ex).
      "prevent all damage by ATTACKER CLASS (preventDamage.fromClass)": 2,
      // D236 — was 16; the mirrored anchor took 9.
      "attach from the HAND (attachEnergyFrom, hand side)": 7,
    });
  });

  it("every non-attack id these rows count as UNBUILT has no registry program", () => {
    const authored: string[] = [];
    for (const row of ROWS) {
      for (const id of [...row.abilityIds, ...row.effectIds]) {
        if (programFor(id) !== undefined) authored.push(`row ${row.row}: ${id}`);
      }
    }
    for (const [, ids] of ROW_14_ABILITY_GROUPS) {
      for (const id of ids) if (programFor(id) !== undefined) authored.push(`row 14: ${id}`);
    }
    // ⚠️ "These ids are unbuilt" is nearly always true (conventions.md), so this
    // row is NOT the guard — it is the bookkeeping that goes red the day one of
    // them is authored and the doc's non-attack count needs decrementing. The
    // guard is the deriver sweep above, which drives real functions.
    expect(authored).toEqual([]);
  });

  it("row 14 is three reprint groups of exactly six legal printings each", () => {
    expect(ROW_14_ABILITY_GROUPS.map(([, ids]) => ids.length)).toEqual([6, 6, 6]);
    const flat = ROW_14_ABILITY_GROUPS.flatMap(([, ids]) => ids);
    expect(new Set(flat).size).toBe(flat.length);
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
    // D239 — 1,233 at D238, 1,225 at D237, 1,215 at D236, 1,206 at D235, 1,186 at
    // D234, 1,174 at D233; the widened attacker class moved 7.
    expect(built).toBe(1240);
    expect(units - built).toBe(1143);

    // The non-attack half is the figure the page has been carrying forward by
    // hand since D221 ("147 of 651, 22.6 %"). Re-measured, it is exactly right —
    // the only running total on that page that survived re-derivation.
    const nonAttackUnits =
      POPULATION.abilityUnits + POPULATION.trainerUnits + POPULATION.specialEnergyUnits;
    expect(nonAttackUnits).toBe(651);
    expect(BUILT.ability + BUILT.trainer + BUILT.specialEnergy).toBe(147);

    // ⚠️ AND THE ATTACK HALF IS THE ONE THAT DID NOT. The slices since `02b839c`
    // claim 169 attack printings between them (D227 13, D228 8, D229 13, D230 20,
    // D231 28, D232 21, D234 12, D235 20, D236 9, D237 10, D238 8, **D239 7**);
    // the sweep measures 171. The
    // extra 2 are ONE sentence no row claimed — "Move all damage counters from 1
    // of your Benched Pokémon to 1 of your opponent's Pokémon.", which D216's
    // `moveCountersChosen` made derivable as a side effect. A slice can move
    // printings it never counted.
    //
    // ⚠️ THE GAP IS STILL EXACTLY 2, WHICH IS THE USEFUL PART, AND **SIXTH SLICE
    // RUNNING**. D239's own 7 is unusually easy to be sure of: all seven printings
    // are ONE card (Terapagos ex "Crown Opal", attack INDEX 1), so the yield is a
    // reprint group rather than a sentence family and the delta cannot hide a
    // second string.
    expect(BUILT.attack - 922).toBe(171);
    expect(13 + 8 + 13 + 20 + 28 + 21 + 12 + 20 + 9 + 10 + 8 + 7).toBe(169);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);
  });

  it("the eight rows are a NAMED FRACTION of the unbuilt attack column, not all of it", () => {
    const unbuiltAttack = POPULATION.attackUnits - BUILT.attack;
    expect(unbuiltAttack).toBe(639); // 646 at D238, 654 at D237, 664 at D236

    // Row 0 (evolve-from-deck) is measured here but is NOT one of rows 9-16 — it
    // sits in the doc's separately-priced table, blocked on "the interpreter must
    // never evolve" (registry.ts, `rareCandy`). Excluded from the fraction.
    const inRows = ROWS.filter((r) => r.row !== 0).reduce((sum, r) => sum + printings(r), 0);
    expect(inRows).toBe(52); // 59 at D238, minus the 7 of row 15 D239 read

    // 🛑 THE STRUCTURAL FINDING, PINNED: 52 of 639 is **8 %** (59 of 646 was
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
    expect(Math.round((inRows / unbuiltAttack) * 100)).toBe(8);
  });
});
