import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { matchesFilter } from "./cards";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import type { GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  HAND_SEARCH_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.147.0 → 0.148.0 — D231, THE DECK SEARCH INTO YOUR OWN HAND: row 8 of
// `coverage-backlog-legal.md`, D230's sibling one word over, and the BIGGEST
// single count this reader has ever taken.
//
// 🛑 THE ROW PRICED IT AT **25 LEGAL PRINTINGS / ~15 ARMS**, AND BOTH HALVES ARE
// WRONG IN THE SAME DIRECTION D230's WERE NOT. Re-derived (never inherited)
// against the remote D1 `luminous` — 3,786 rows / 20 sets, 2,021
// `legal_standard = 1` — on 2026-08-06 over `json_each` + `GLOB
// '*[Ss]earch your deck*'`, all three text columns, and **grouped BY SENTENCE
// before anything was priced**: the ATTACK column holds **42 legal printings over
// 23 distinct sentences**, and it is **ONE anchor**. The row under-counted the
// population by a THIRD and over-counted the arms by fifteen — the sixth `needs`
// cell on this branch to misprice, and the third running to miss in both
// directions at once.
//
// ⚠️ AND 42 CORRECTS A FIGURE THIS REPO ALREADY WROTE DOWN ONE FILE OVER.
// `derivedBenchSearch.test.ts` says *"(41 legal printings search into the HAND)"*;
// 41 is the **`effect` (Trainer) column**, and the ATTACK column — the only one
// this reader can reach — is 42. Two denominators one word apart inside a single
// family, which is the "every count carries a POPULATION" rule biting at close
// range. The parenthetical is corrected in place, with its reason.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did a card reach the hand". `searchDeck`
// at `dest: "hand"` has run since M4 and has four suites behind it. What is NEW is
// (a) a NOUN read off text through a closed table and (b) the **`reveal` rider read
// off the printed clause rather than off the destination** — and (b) is the half
// that can be wrong silently, because a build that revealed unconditionally would
// pass every "the card reached the hand" assertion in this repo while leaking a
// hand that seven legal printings keep private.

/** The eight printed noun phrases this one anchor reads, singular and plural,
    with the program each derives to. Census re-derived on 2026-08-06 against the
    remote D1 over `json_each` + `json_extract(value,'$.effect')` with `GLOB`
    (SQLite's `LIKE` is ASCII case-insensitive and has cost this repo a census),
    and with the CASE CLASS on the opening verb — D230's first sweep was
    case-sensitive and could not see a "You may search…" printing, and three of
    the rows below open exactly that way.

    ⚠️ THE FIRST THREE ROWS ARE THE POINT OF THE `anyCard` MEMBER: they are the
    only printings in the family that carry NO "reveal it/them", and D225's census
    says that is not a coincidence — every no-reveal sentence in the whole catalog
    searches for uncategorised "card"/"cards". Without them in the table the
    optional reveal group would have no printed witness that omits the clause, and
    a hard-coded `reveal: true` would be an unkillable mutant. */
const CLAUSES = [
  {
    text: "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 1,
    reveal: false,
    legalPrintings: 3, // sv06-106, sv06-198, sv06-214
  },
  {
    text: "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 3,
    reveal: false,
    legalPrintings: 3, // sv10.5b-003, sv10.5b-156, sv10.5b-164
  },
  {
    text: "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyCard" },
    max: 2,
    reveal: false,
    legalPrintings: 1, // sv05-127
  },
  {
    text: "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "anyPokemon" },
    max: 1,
    reveal: true,
    legalPrintings: 3, // sv06-126, sv06-185, sv08-047
  },
  {
    text: "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyPokemon" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // sv06.5-011
  },
  {
    text: "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "item" },
    max: 1,
    reveal: true,
    legalPrintings: 4, // sv05-047, sv10-072, sv10.5w-072, sv10.5w-152
  },
  {
    text: "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "supporter" },
    max: 1,
    reveal: true,
    legalPrintings: 3, // sv06.5-027, sv10-127, sv10-200
  },
  {
    text: "Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "stadium" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv09-086
  },
  {
    text: "Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "toolCard" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv07-103
  },
  {
    text: "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 2,
    reveal: true,
    legalPrintings: 5, // svp-123, sv06-024, sv08-097, sv10.5b-068, sv10.5b-145
  },
  {
    text: "Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // sv06-087
  },
  {
    text: "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 1,
    reveal: true,
    legalPrintings: 1, // sv05-026
  },
  {
    text: "Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "anyEnergy" },
    max: 4,
    reveal: true,
    legalPrintings: 1, // sv08-155
  },
  // ⚠️⚠️ D238 — THE THREE ROWS THE BRACE CODE BOUGHT, moved up out of `DEFERRED`
  // rather than added beside it, because the deferral was the CLAIM and the claim
  // has expired. All three were pinned derived-to-null one commit ago and all
  // three were blocked on the SAME mechanism as `derivedDiscardRetrieval`'s two
  // and `derivedBenchSearch`'s one — which is the whole reason that slice was
  // worth taking as one.
  //
  // 🛑 **AND THIS ANCHOR NEEDED NO REGEX CHANGE AT ALL.** Its `[^,.]+?` noun
  // capture has always admitted a brace phrase; the closed TABLE's silence was
  // the entire refusal, exactly as this file's own "the NOUN is a closed TABLE"
  // case says. The fix here is one `??` — which is also why the slice's written
  // prediction of "one capture group per anchor" was graded WRONG.
  {
    text: "Search your deck for up to 3 {D} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "typedPokemon", pokemonType: "Darkness" },
    max: 3,
    reveal: true,
    legalPrintings: 2, // sv10.5w-055, sv10.5w-136
  },
  {
    text: "Search your deck for up to 2 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "typedPokemon", pokemonType: "Lightning" },
    max: 2,
    reveal: true,
    legalPrintings: 1, // sv08-065
  },
  // …and the OTHER noun, which resolves to a filter that has existed since
  // Chien-Pao: `basicEnergy.energyType`. Half of what the backlog row called "a
  // type-narrowed Pokémon CardFilter" was already spellable and blocked on the
  // anchor alone.
  {
    text: "Search your deck for up to 3 Basic {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy", energyType: "Grass" },
    max: 3,
    reveal: true,
    legalPrintings: 1, // svp-199
  },
  // 🆕🆕🆕 **D513 — THE ROW A DISTINCTNESS CONSTRAINT BOUGHT, MOVED UP OUT OF
  // `DEFERRED` RATHER THAN ADDED BESIDE IT** — D238's call three rows up, for the same
  // reason: the deferral was the CLAIM, and the claim has expired. It was pinned
  // derived-to-null one commit ago with the reason *"a DISTINCTNESS constraint on the
  // pick"*, which was true about the mechanism and WRONG about the carrier — the two
  // shipped refusal comments in `effects.ts` both said the missing piece was a
  // *"distinctness `CardFilter`"*, and no `CardFilter` could ever have expressed it.
  //
  // 🛑 **AND THIS ANCHOR NEEDED ONE OPTIONAL GROUP, NOT A SECOND ANCHOR — BUT IT DID
  // NEED ONE, WHICH IS WHERE D238's PARAGRAPH ABOVE AND THIS ONE COME APART.** D238's
  // three rows were admitted by the `[^,.]+?` capture and refused by the TABLE alone.
  // This row was ALSO admitted by that capture — measured, not assumed: it captured
  // `Basic Energy cards of different types` whole — so the anchor was never the blocker
  // here either. What the new group does is move the phrase OUT of the noun so the
  // closed table is asked about a noun it can name, and hand the phrase to a rider.
  // **Same diagnosis as D238, different repair.**
  {
    text: "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.",
    filter: { kind: "basicEnergy" },
    max: 3,
    reveal: true,
    distinctEnergyTypes: true,
    legalPrintings: 1, // sv06.5-050
  },
] as const satisfies readonly {
  text: string;
  filter: CardFilter;
  max: number;
  reveal: boolean;
  distinctEnergyTypes?: true;
  legalPrintings: number;
}[];

/** The same anchor's ZERO-LEGAL printings — read anyway, because an arm is a text
    parser and transfers to the H/I reprint the day one is ingested (D187). Seven
    more distinct sentences, so the anchor covers **20 of the family's 23+7 printed
    sentences** rather than the thirteen the count above is drawn from. */
const ROTATED: readonly (readonly [string, CardFilter, number, boolean])[] = [
  [
    "Search your deck for up to 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "anyPokemon" },
    2,
    true,
  ],
  [
    "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    2,
    false,
  ],
  [
    "Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    3,
    false,
  ],
  [
    "Search your deck for a card and put it into your hand. Then, shuffle your deck.",
    { kind: "anyCard" },
    1,
    false,
  ],
  [
    "Search your deck for up to 3 Pokémon Tool cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "toolCard" },
    3,
    true,
  ],
  [
    "Search your deck for up to 2 Supporter cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    { kind: "supporter" },
    2,
    true,
  ],
  [
    "Search your deck for an Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
    { kind: "anyEnergy" },
    1,
    true,
  ],
];

/** 🛑 THE TEN LEGAL PRINTINGS LEFT (fourteen at D231; D238's brace code took
    four), AND EVERY ONE OF THEM IS STILL DEFERRED ON A **NOUN**, not on the
    sentence — which is the finding that makes the noun a TABLE rather than a
    wildcard. A `[^,.]+` capture handed straight to a filter would have swallowed
    every one of these and derived a search for something the card does not say;
    the table refuses them by having no row, and they land on the loud
    ATTACK_EFFECT_SKIPPED path.

    ⚠️ **THE REFUSAL IS NOW TWO LAYERS AND THE TABLE IS ONLY THE FIRST**, which is
    what D238 changed here: a phrase no row claims is offered to the brace-code
    pattern before it is refused. Three of these sentences CONTAIN a brace code
    and are refused anyway — the typed DISJUNCTION and the two "in any
    combination of" forms — so the pattern is narrow rather than a wildcard with
    extra steps, and that is asserted below rather than argued.

    Each entry is `[printed sentence, why it is left, legal printings]`. */
const DEFERRED: readonly (readonly [string, string, number])[] = [
  [
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    "`ownerPokemon` behind a possessive capture (sv10-050/-194)",
    2,
  ],
  [
    "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    "a typed DISJUNCTION (sv10.5w-019/-104) — D230's Maushold case, typed",
    2,
  ],
  [
    "You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    "`byName` at an UNBOUNDED max the (\\d+) group cannot spell (sv10.5b-036/-117)",
    2,
  ],
  [
    "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    "a BOARD-DEPENDENT noun (sv07-065) — the filter would read the attacker",
    1,
  ],
  [
    "Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.",
    "a DYNAMIC max (svp-188) — `max` is a number, not an expression",
    1,
  ],
  [
    "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    "a §9.2 LEADING clause (sv07-011) — refused by the VERB'S CASE, not by `^`",
    1,
  ],
];

// ── The board. Indices 20-24 on `fix-trainerops`, appended by D231. ──
const MEAL_TIME = 20; // anyCard, max 1, NO reveal
const BIG_MEAL = 21; // anyCard, max 3, NO reveal
const ENERGY_SEARCH = 22; // basicEnergy, max 2, reveal
const ITEM_HUNT = 23; // item, max 1, reveal
const STADIUM_SEARCH = 24; // stadium, max 1, reveal

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_SEARCH_DECK, p2: HAND_SEARCH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`; p2 holds a Bench of its own, set explicitly,
    because the crossed build this file guards against reaches for the other
    seat's deck. */
function ready(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The distinct card ids a prompt is offering — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): Set<string> {
  return new Set(cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] as string));
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** The one action row a batch produced that mentions a deck read, flattened to
    the exact string an OPPONENT reads in their log (revealClause.test.ts's own
    helper — the two files assert the same formatter from two producers). */
function searchRow(state: GameState, events: GameEvent[]): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("searched their deck")),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

/** The `chooseCards` note the interpreter builds, RECONSTRUCTED FROM THE PRINTED
    SENTENCE by deleting exactly the two clauses the program does not caption: the
    optional "You may" opener and the printed reveal. Everything else — including
    the noun phrase and its ARTICLE — has to survive byte for byte, which is what
    makes this the round trip between `effects.ts`'s noun table and
    `interpreter.ts`'s `retrieveNoun`. The two live in different files (effects.ts
    cannot import from interpreter.ts), so nothing but this assertion keeps them
    in step, and it goes red from either side. */
function noteFromPrint(text: string): string {
  return text
    .replace(/^You may search/, "Search")
    .replace(/, reveal (?:it|them),/, "")
    .replace(
      / and put (?:it|them) into your hand\. Then, shuffle your deck\.$/,
      " into your hand.",
    );
}

/** The program a clause row means. */
function programOf(clause: (typeof CLAUSES)[number]): EffectOp[] {
  return [
    {
      op: "searchDeck",
      filter: clause.filter,
      dest: "hand",
      max: clause.max,
      ...(clause.reveal ? { reveal: true } : {}),
      // 🆕🆕🆕 D513 — the printed *"of different types"*. Optional on the row
      // for the same reason `reveal` is: the ABSENT key is a different wire value from
      // `false` (D135), and these programs are compared by VALUE against the twelve
      // rows that print no such phrase.
      ...("distinctEnergyTypes" in clause ? { distinctEnergyTypes: true } : {}),
    },
    { op: "shuffleDeck" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — one regex, one closed noun table, one optional rider
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — seventeen printed sentences, ONE regex", () => {
  it("derives each printed sentence to its program", () => {
    for (const clause of CLAUSES) {
      expect(deriveAttackEffect(clause.text), clause.text).toEqual(programOf(clause));
    }
  });

  it("reads the ROTATED printings too — an arm transfers across sets", () => {
    // D187's rule: a deriver arm is a text parser, so it serves the H/I reprint
    // the day one is ingested and is safe to build regardless of the legality of
    // the printing that prompted it. These seven sentences are 0 legal today and
    // cost this slice nothing.
    for (const [text, filter, max, reveal] of ROTATED) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "searchDeck", filter, dest: "hand", max, ...(reveal ? { reveal: true } : {}) },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("adds up: 28 of the family's 42 legal printings, on ONE anchor", () => {
    // 🛑 THE ARITHMETIC, STATED RATHER THAN DESCRIBED — D230's rule, and the row
    // that caught its own author's census a slice ago. The backlog row said 25
    // legal for ~15 arms; measured BY SENTENCE it is 42 legal for ONE.
    // ⚠️ THE HEADING'S COUNT WAS STALE BEFORE THIS SLICE TOUCHED IT, and it is
    // recorded rather than quietly fixed (D433's derived noun, D425's rotting doc
    // figure). It read "thirteen" — D231's measured `CLAUSES` length — and D238 added
    // THREE rows without moving it, so it was wrong for 275 decisions. Measured here:
    // `CLAUSES` holds SEVENTEEN rows, sixteen before this slice.
    // ⚠️ D238 moved 4 printings over 3 sentences from `DEFERRED` into `CLAUSES`
    // (28 → 32 read, 14 → 10 left). 🆕 D513 moved ONE more printing over ONE sentence
    // the same way (32 → 33 read, 10 → 9 left). The 42 is UNMOVED across both and is
    // the same census D231 measured — a family total does not change because a reader
    // got wider, which is exactly what the third rung below asserts.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(33);
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0)).toBe(9);
    expect(33 + 9).toBe(42);
    // …and the six left are all pinned derived-to-null, so the deferral is a
    // fact about the code rather than a note in a comment. ⚠️ The count in this
    // sentence is a DERIVED NOUN and has rotted twice (D433): it read "fourteen" while
    // `DEFERRED` held seven sentences / ten printings, because it was written against
    // the PRINTINGS figure of a table that has since been stepped twice. It now names
    // the SENTENCES, which is what the loop below actually walks.
    for (const [text, why] of DEFERRED) expect(deriveAttackEffect(text), why).toBeNull();
  });

  it("🛑 the NOUN is a closed TABLE, and an unknown phrase is a REFUSAL", () => {
    // The whole design of the capture. `[^,.]+` matches every one of these, so
    // the regex is NOT what refuses them — the table is, by having no row. A build
    // that handed the captured phrase to a filter (or fell back to "any card")
    // would derive a program for all of them.
    const unknown = [
      // ⚠️⚠️ RE-HOMED AT D238, NOT DELETED. This slot used to hold "up to 3 {D}
      // Pokémon" on the grounds that no filter spelled a printed TYPE; D238
      // spells it, so that subject expired and is now a `CLAUSES` row. The claim
      // — that a noun the reader cannot name is a REFUSAL rather than an
      // approximation — is re-stated on the possessive, which is still unnamed
      // and is the largest thing left in `DEFERRED`.
      "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      // A PROPER NOUN — D230's `byName` case, which this reader deliberately does
      // NOT take: the only attack printings that name a card search at an
      // unbounded max ("any number of Fennel cards"), so a `byName` row here would
      // serve zero printings and invite exactly the wrong-but-plausible program
      // the "exact map or flag" rule forbids.
      "Search your deck for a Fennel card, reveal it, and put it into your hand. Then, shuffle your deck.",
      // ⚠️⚠️ RE-HOMED TWICE NOW — D237, THEN D238, EACH ON SCHEDULE. It held "a
      // Trainer card" until D237 added that row, then "a Basic {G} Energy card"
      // until D238 resolved the brace code. **That is two expiries in two
      // slices, and neither was a deletion**; the claim outlives its subject
      // every time, which is the whole argument for re-homing rather than
      // dropping an "unbuilt" control. It now sits on a noun no layer can name:
      // a brace code inside a DISJUNCTION, where the type resolves fine and the
      // "in any combination of" does not.
      "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      // The BENCH family's noun on the HAND family's sentence: no printing spells
      // it, and the table is authored off the bytes rather than off the union.
      "Search your deck for a Basic Pokémon and put it into your hand. Then, shuffle your deck.",
      // ⚠️ D238 — THE BRACE PATTERN'S OWN REFUSALS, and this anchor is the ONLY
      // place they can be driven: its noun capture is a lazy `[^,.]+?`, so the
      // regex admits every one of these and the RESOLVER is what says no. The
      // two sibling anchors spell their nouns as alternations and refuse these at
      // the pattern, which is a weaker witness for the same three rules.
      //   · the grammatical NUMBER is welded ("up to 3 … Energy CARD");
      "Search your deck for up to 3 Basic {G} Energy card, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · so is the article, the other way round;
      "Search your deck for a Basic {G} Energy cards, reveal it, and put it into your hand. Then, shuffle your deck.",
      //   · a typed Energy noun WITHOUT "Basic" is `providesEnergy`, a different
      //     filter for a different question — and `matchesFilter` answers FALSE
      //     for it in every pile, so the search would find nothing;
      "Search your deck for up to 3 {G} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · and `{N}` IS a printed Pokémon type (Dragon) with NO Basic Energy
      //     card behind it, which is why the two code maps are separate.
      "Search your deck for up to 3 Basic {N} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      //   · `{Q}` is not a printed type at all — the pattern matches, the MAP
      //     refuses, and that is the layer that has to say no.
      "Search your deck for up to 3 {Q} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    ];
    for (const text of unknown) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the POSITIVE control on the same pattern, so "everything is refused"
    // cannot pass on a resolver that returns `undefined` for everything.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Basic {N} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Dragon", stage: "basic" },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🆕 D237 — the table gained a row one family over, and THIS anchor gained it too", () => {
    // The other half of the re-homing above, asserted rather than assumed: the
    // noun table is SHARED with `ATTACK_DISCARD_RETRIEVAL` (backlog row 13), so
    // `trainerCard` arriving for `sv08-087` is admitted here on the same commit.
    // **ZERO printings today** — measured over all 3,786 catalog rows, the attack
    // column spells no deck search for "a Trainer card" — and it is read anyway,
    // for the reason this file takes every slice: *an arm transfers across sets
    // and a registry row does not* (D180/D187).
    expect(
      deriveAttackEffect(
        "Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "trainerCard" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    // …and it did NOT widen the four subtype rows into it: each still resolves to
    // its own filter, so the new row is an addition rather than a collapse.
    expect(
      deriveAttackEffect(
        "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
      )?.[0],
    ).toHaveProperty("filter", { kind: "supporter" });
  });

  it("🛑 the `reveal` RIDER is the printed clause and NOTHING else", () => {
    // D225's finding, re-asserted from the deriver side: `reveal` is a property of
    // the SENTENCE, not of `dest` and not of how narrow the filter is. The two
    // sentences below differ by exactly the clause, and by nothing else at all.
    const bare =
      "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.";
    const revealing =
      "You may search your deck for up to 3 cards, reveal them, and put them into your hand. Then, shuffle your deck.";
    const [withoutIt] = deriveAttackEffect(bare) ?? [];
    const [withIt] = deriveAttackEffect(revealing) ?? [];
    expect(withIt).toEqual({ ...withoutIt, reveal: true });
    // ABSENT, never `false` — D135's rule, because these ops are compared by value
    // against hand-authored registry rows and `{reveal: undefined}` is not
    // `toEqual`-identical to an absent key.
    expect(Object.keys(withoutIt as object)).not.toContain("reveal");
    // 🛑 AND THE NO-REVEAL BRANCH HAS SEVEN LEGAL PRINTED WITNESSES, which is the
    // only reason this assertion is not vacuous: without `anyCard` in the table
    // every sentence this arm read would carry the clause.
    const noReveal = CLAUSES.filter((c) => !c.reveal);
    expect(noReveal.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(7);
    for (const clause of noReveal) expect(clause.filter.kind).toBe("anyCard");
  });

  it("the article and the numeric forms are ONE anchor, and the missing group IS max 1", () => {
    // "a card … put it" and "up to 3 cards … put them" derive to programs that
    // differ in `max` and in nothing else. A build that split them into two
    // anchors would pass every accept case above.
    const [one] = deriveAttackEffect(CLAUSES[0].text) ?? [];
    const [three] = deriveAttackEffect(CLAUSES[1].text) ?? [];
    expect(one).toEqual({ ...three, max: 1 });
    // …and a number the catalog does not print today rides the same arm.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 7 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "anyEnergy" }, dest: "hand", max: 7, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it('"You may search" and "Search" derive to the SAME program', () => {
    // Not a shortcut: `searchDeck` parks at `min: 0`, so declining is already a
    // legal answer to every printing here and an `optional` wrapper would ask the
    // same question twice (D186/D202's finding, from the other side). It is why
    // the leading alternative is not a capture — nothing downstream could use it.
    expect(deriveAttackEffect(CLAUSES[2].text)).toEqual(
      deriveAttackEffect(CLAUSES[2].text.replace("You may search", "Search")),
    );
  });

  it("refuses the anchor, punctuation, pronoun and case rewrites", () => {
    const bare = CLAUSES[5].text; // "…an Item card, reveal it, …"
    const rewrites = [
      // 🛑 THE LEADING-CLAUSE WITNESS IS PRINTED AND LEGAL — `sv07-011` — BUT IT
      // DOES NOT KILL THE `^`, AND A MUTANT PROVED IT RATHER THAN A READING. This
      // comment first claimed the opposite (D230's family really does have such a
      // witness, and the claim transferred by habit); `bun run mutants` reported
      // `D231-anchor-drops-the-caret` SURVIVED, because **every printed leading
      // clause in this family LOWERCASES the verb** — "If you do, search…",
      // "If heads, search…" — so the capital `S` in the alternation refuses them
      // with or without the anchor. The `^` is therefore
      // `unreachable-population` from the catalog, exactly D202's finding one
      // family over, and it is closed with a CONSTRUCTED witness LABELLED as one
      // rather than declared away.
      "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      // ⚠️ CONSTRUCTED, AND SAID SO: the same leading clause with the verb
      // CAPITALISED, which is the only string shape that can distinguish an
      // anchored pattern from an unanchored one here. No card prints it.
      "Draw a card. Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      // ⚠️ AND SO IS THE TRAILING ONE (`sv06.5`-era, 0 legal but really printed).
      "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck. You may switch this Pokémon with 1 of your Benched Pokémon.",
      // A real printed leading clause of a THIRD shape — the coin gate.
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Item", "item"),
      // The trailing period, and the trailing SENTENCE — the shuffle is printed,
      // so a build that made it optional would read a card that never says it.
      bare.slice(0, -1),
      "Search your deck for an Item card, reveal it, and put it into your hand.",
      // The pronoun crossed with the quantity — no printing spells either, and the
      // alternation refuses both by construction rather than by a guard.
      "Search your deck for an Item card, reveal it, and put them into your hand. Then, shuffle your deck.",
      "Search your deck for up to 2 Item cards, reveal them, and put it into your hand. Then, shuffle your deck.",
      // The reveal's own NUMBER crossed — "reveal them" on a singular find.
      "Search your deck for an Item card, reveal them, and put it into your hand. Then, shuffle your deck.",
      // The DESTINATION changed — the whole content of `dest`, and D230's family.
      "Search your deck for an Item card, reveal it, and put it onto your Bench. Then, shuffle your deck.",
      // The ZONE changed — `discardPileRetrieval`'s, a different op.
      "Search your discard pile for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
      // The OWNER changed — no member of this family reaches the other deck.
      "Search your opponent's deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
      // A printed ZERO. ⚠️ CONSTRUCTED, AND SAID SO: no card prints "up to 0", so
      // this is the one guard in this file with no catalog witness. It stays loud
      // rather than deriving a search that moves nothing and shuffles anyway.
      "Search your deck for up to 0 cards and put them into your hand. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const clause of CLAUSES) expect(deriveAttackCoinFlip(clause.text), clause.text).toBeNull();
    // ⚠️ A PREDICTION ABOUT A SIBLING CENSUS (D229/D230's habit): none of these
    // thirteen sentences carries an apostrophe, so `clauseApostrophe.test.ts`'s
    // count must be UNMOVED by this slice — still 88.
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE THREE NEW FILTER MEMBERS — the only engine code outside the deriver
// ─────────────────────────────────────────────────────────────────────────────

describe("the CardFilter members this slice adds, at their read site", () => {
  const card = (id: string) => FIXTURE_POOL[id];

  it("🛑 `item` is DISJOINT from `toolCard` — the pre-SM reading is the mutant", () => {
    // In the XY era a Pokémon Tool really was a kind of Item, and a reader who
    // remembered that would write `trainerType !== "Supporter"` or fold Tools in.
    // The catalog is the datum and it disagrees: 116 `Item` rows, 60 `Tool`, none
    // both. So "Search your deck for an Item card" must not offer a Tool.
    expect(matchesFilter(card("fix-item"), { kind: "item" })).toBe(true);
    for (const id of ["fix-tool", "fix-gatedsup", "fix-stadium", "fix-basic-1", "fix-energy"]) {
      expect(matchesFilter(card(id), { kind: "item" }), id).toBe(false);
    }
  });

  it("`stadium` completes the four printed Trainer subtypes", () => {
    expect(matchesFilter(card("fix-stadium"), { kind: "stadium" })).toBe(true);
    for (const id of ["fix-item", "fix-tool", "fix-gatedsup", "fix-basic-1"]) {
      expect(matchesFilter(card(id), { kind: "stadium" }), id).toBe(false);
    }
    // …and the four members now partition the Trainer category exactly, which is
    // what "closed enum" means here: every Trainer in the pool matches exactly one.
    const kinds: CardFilter[] = [
      { kind: "item" },
      { kind: "supporter" },
      { kind: "stadium" },
      { kind: "toolCard" },
    ];
    for (const pooled of Object.values(FIXTURE_POOL)) {
      if (pooled.category !== "Trainer") continue;
      const hits = kinds.filter((k) => matchesFilter(pooled, k)).length;
      expect(hits, pooled.id).toBe(1);
    }
  });

  it("`anyCard` is true for every real card — and FALSE for a missing one", () => {
    for (const pooled of Object.values(FIXTURE_POOL)) {
      expect(matchesFilter(pooled, { kind: "anyCard" }), pooled.id).toBe(true);
    }
    // The guard that makes it "any CARD" rather than "any uid" — decided one level
    // up, and the line a `return true` written above the undefined check would
    // break.
    expect(matchesFilter(undefined, { kind: "anyCard" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries five of the forms at 20-24", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 20-24, appended and not inserted", () => {
    // 48 at D236, which appended 43-47 (attach from the HAND); 43 at D235, which
    // appended 35-42 (the deck search that ATTACHES — the
    // family whose opening five words are this one's, and which this file's own
    // "into your hand" weld is what keeps apart); 35 at D234, which appended 29-34
    // (the discard-pile attach); 29 at D232, which appended 25-28 (the
    // opponent-hand family); 25 at D231 (20 at D230, 17 at D229, 14 at D228, 13 at
    // D227, 9 at D189, 8 at D181). TEN slices, ten appends, zero inserts — which
    // is what every index constant in ten suites depends on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks()).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks()[MEAL_TIME]?.effect).toBe(CLAUSES[0].text);
    expect(attacks()[BIG_MEAL]?.effect).toBe(CLAUSES[1].text);
    expect(attacks()[ENERGY_SEARCH]?.effect).toBe(CLAUSES[9].text);
    expect(attacks()[ITEM_HUNT]?.effect).toBe(CLAUSES[5].text);
    expect(attacks()[STADIUM_SEARCH]?.effect).toBe(CLAUSES[7].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[17]?.effect).toBe(
      "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
    );
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("NO printed base damage on any of the five — and here that IS the catalog", () => {
    // Every one of the family's 42 legal attack printings prints a bare effect,
    // re-read off the remote D1 on 2026-08-06.
    for (const index of [MEAL_TIME, BIG_MEAL, ENERGY_SEARCH, ITEM_HUNT, STADIUM_SEARCH]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("⚠️ the COSTS diverge from their printings, and say so here", () => {
    // D228's finding: the claim a fixture makes has to cover the fields it
    // fabricates, not only the one it copies. The effect strings above are the
    // catalog; these costs are not.
    for (const index of [MEAL_TIME, BIG_MEAL, ENERGY_SEARCH, ITEM_HUNT, STADIUM_SEARCH]) {
      expect(attacks()[index]?.cost, `index ${index}`).toEqual(["Colorless"]);
    }
  });

  it("the deck holds all four Trainer subtypes AND both Energy classes", () => {
    // The deck is the discriminator (see its doc): six of its seven lines exist to
    // be REFUSED by some filter this anchor emits. If any of them left, the
    // "disjoint candidate sets" assertions below would still pass — vacuously.
    const ids = new Set(HAND_SEARCH_DECK);
    for (const id of ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.has("fix-energy")).toBe(true); // Basic
    expect(ids.has("fix-special")).toBe(true); // Special — NOT a `basicEnergy`
    expect(HAND_SEARCH_DECK).toHaveLength(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE POINT OF THE SLICE — whose deck, which noun, into whose hand
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — out of the ATTACKER's deck, into the ATTACKER's hand", () => {
  it("parks offering the actor's own cards, bound for the actor's hand", () => {
    const state = ready(11);
    deepFreeze(state);
    const { state: parked } = attack(state, ITEM_HUNT);

    const prompt = cardsPrompt(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(prompt.dest).toBe("hand");
    expect(prompt.max).toBe(1);
    // "up to" — declining is a legal answer, which is also why no `optional`
    // wrapper is owed for a "You may search…" printing.
    expect(prompt.min).toBe(0);
    // 🛑 EVERY CANDIDATE IS IN THE ACTOR'S OWN DECK. A build that scanned the
    // opponent's would park on a plausible-looking prompt of the same shape.
    for (const uid of prompt.candidates) expect(parked.players.p1.deck).toContain(uid);
    // …and every one of them is an ITEM: three other Trainer subtypes sit in this
    // deck, so the filter has something to refuse rather than admitting them all.
    expect(offered(parked)).toEqual(new Set(["fix-item"]));
  });

  it("🛑 the eight nouns are told apart ON ONE BOARD — disjoint candidate sets", () => {
    // ⚠️ THE ASSERTION THE NOUN TABLE EXISTS FOR, and the one case a crossed build
    // cannot survive. Same seed, same board, same op, same prompt kind: only the
    // noun differs. A table that mapped two phrases to one filter, or fell back to
    // `anyCard`, would collapse these sets into each other.
    const state = ready(12);
    const items = offered(attack(state, ITEM_HUNT).state);
    const stadiums = offered(attack(state, STADIUM_SEARCH).state);
    const energies = offered(attack(state, ENERGY_SEARCH).state);
    const anything = offered(attack(state, MEAL_TIME).state);

    expect(items).toEqual(new Set(["fix-item"]));
    expect(stadiums).toEqual(new Set(["fix-stadium"]));
    // 🛑 `basicEnergy` REFUSES THE SPECIAL ENERGY sitting beside it in the deck —
    // the one pair that tells `basicEnergy` and `anyEnergy` apart, and the reason
    // `fix-special` is a deck line.
    expect(energies).toEqual(new Set(["fix-energy"]));
    expect(energies.has("fix-special")).toBe(false);
    // …while `anyCard` is the UNION and then some: every id in the deck.
    for (const set of [items, stadiums, energies]) {
      for (const id of set) expect(anything.has(id), id).toBe(true);
    }
    expect(anything.size).toBeGreaterThan(4);
    expect(anything.has("fix-special")).toBe(true);
  });

  it("resolving puts the pick in the ACTOR's hand, and shuffles after", () => {
    const state = ready(13);
    const { state: parked } = attack(state, ITEM_HUNT);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done, events } = resolve(parked, [pick]);

    // 🛑 THE ASSERTION THE WHOLE SLICE IS ABOUT: the card left the ACTOR's deck and
    // landed in the ACTOR's hand. A one-`otherSeat` build lands it opposite.
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.deck).not.toContain(pick);
    // ⚠️ NOT a count on the other side — the attack ENDS THE TURN, so p2 draws
    // for theirs a moment later and a length would move for a reason that has
    // nothing to do with this op. The uid is the fact.
    expect(done.players.p2.hand).not.toContain(pick);
    expect(done.players.p2.deck).not.toContain(pick);
    // …and the TRAILING op fired, in printed order.
    expect(types(events).filter((t) => t === "DECK_SEARCHED" || t === "SHUFFLE")).toEqual([
      "DECK_SEARCHED",
      "SHUFFLE",
    ]);
  });

  it("the plural form takes THREE, and every one of them lands", () => {
    const state = ready(14);
    const { state: parked } = attack(state, BIG_MEAL);
    expect(cardsPrompt(parked).max).toBe(3);
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const before = parked.players.p1.hand.length;
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.hand).toHaveLength(before + 3);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
  });

  it("a WHIFF still shuffles — the candidate set is empty and the sentence completes", () => {
    // Every Stadium out of the deck, so the search can find nothing. The trailing
    // op is an OP, not a rider: the printed "Then, shuffle your deck." happens on
    // the boards where nothing was found too.
    let state = ready(15);
    const copies = state.players.p1.deck.filter(
      (uid) => state.cardIdByUid[uid] === "fix-stadium",
    ).length;
    expect(copies).toBeGreaterThan(0);
    state = discardFromDeck(state, "p1", "fix-stadium", copies);
    const { state: done, events } = attack(state, STADIUM_SEARCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("DECLINING is legal, takes nothing, and still shuffles", () => {
    const state = ready(16);
    const { state: parked } = attack(state, MEAL_TIME);
    const before = parked.players.p1.hand.length;
    const { state: done, events } = resolve(parked, []);
    expect(done.players.p1.hand).toHaveLength(before);
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("🛑 the prompt NOTE is the printed sentence, round-tripped through retrieveNoun", () => {
    // ⚠️ THE GUARD THAT TIES `effects.ts`'s NOUN TABLE TO `interpreter.ts`'s
    // `retrieveNoun`. They cannot share a constant (effects.ts is upstream), so
    // the only thing keeping them in step is that the note a search parks with is
    // built from the FILTER while the sentence is read from the TEXT — and this
    // asserts they produce the same noun phrase, article included.
    //
    // It goes red from either side: change the table's "an Item card" to "a Item
    // card" and the derive breaks; change `retrieveNoun`'s and this breaks.
    const state = ready(17);
    const pairs: readonly (readonly [number, string])[] = [
      [MEAL_TIME, CLAUSES[0].text],
      [BIG_MEAL, CLAUSES[1].text],
      [ENERGY_SEARCH, CLAUSES[9].text],
      [ITEM_HUNT, CLAUSES[5].text],
      [STADIUM_SEARCH, CLAUSES[7].text],
    ];
    for (const [index, text] of pairs) {
      expect(cardsPrompt(attack(state, index).state).note, text).toBe(noteFromPrint(text));
    }
    // …and the reconstruction is not a tautology — it really does delete two
    // clauses and keep everything else.
    expect(noteFromPrint(CLAUSES[9].text)).toBe(
      "Search your deck for up to 2 Basic Energy cards into your hand.",
    );
    expect(noteFromPrint(CLAUSES[0].text)).toBe("Search your deck for a card into your hand.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE READ SITES THE RESUME POINT NAMED — log.ts and redact.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites, priced by driving them from an ATTACK", () => {
  it("🛑 a REVEALING search NAMES the cards in the log the opponent reads", () => {
    // D225 wired the rider into `log.ts`; what is new is that an ATTACK can now
    // produce the event. Without the rider the opponent reads a bare COUNT, which
    // is the information debt `TEAM_ROCKETS_PROTON`'s doc records.
    const state = ready(18);
    const { state: parked } = attack(state, ITEM_HUNT);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { state: done, events } = resolve(parked, [pick]);
    expect(searchRow(done, events)).toBe(
      "searched their deck — revealed fix-item and put it in hand",
    );
  });

  it("🛑 a NON-revealing search stays a COUNT — the seven printings that would leak", () => {
    // The other half, and the half that can only be wrong silently: these are the
    // printings D225 measured as carrying no reveal, and naming their cards would
    // leak a hand the print keeps private. A build that hard-coded `reveal: true`
    // is green everywhere else and red here.
    const state = ready(19);
    const { state: parked } = attack(state, BIG_MEAL);
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done, events } = resolve(parked, [...picks]);
    expect(searchRow(done, events)).toBe("searched their deck — put 2 cards in hand");
    // …and the singular reads as one card, not "1 cards".
    const solo = ready(20);
    const { state: soloParked } = attack(solo, MEAL_TIME);
    const one = cardsPrompt(soloParked).candidates.slice(0, 1);
    const resolved = resolve(soloParked, [...one]);
    expect(searchRow(resolved.state, resolved.events)).toBe(
      "searched their deck — put 1 card in hand",
    );
  });

  it("🛑 `redact.ts` resolves the candidates to the ACTOR ALONE — the first ATTACK to", () => {
    // The resume point's second read site, priced by driving it: a to-hand search
    // parks a `chooseCards` whose candidates are the actor's own DECK cards, and
    // this is the first time an ATTACK produces one. The barrier is the ANSWERER
    // gate, which keys on the phase and not on what produced it — so the price is
    // ZERO engine code, and that is measured here rather than argued.
    const state = ready(21);
    const { state: parked } = attack(state, ENERGY_SEARCH);
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("expected the actor to receive a chooseCards prompt");
    }
    expect(mine.phase.prompt.candidates.length).toBeGreaterThan(0);
    for (const candidate of mine.phase.prompt.candidates) {
      expect(candidate.cardId).toBe("fix-energy");
    }
    expect(mine.phase.prompt.dest).toBe("hand");
    // 🛑 AND THE OPPONENT GETS NOTHING — not the identities, not the count, not the
    // prompt. A search that revealed its candidates over the wire would hand the
    // opponent a read of the deck the printed "reveal" does not licence (only the
    // cards actually TAKEN are revealed, and those ride the log row above).
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "not-a-park").toBeNull();
    // …and a SPECTATOR is refused too, on the same gate.
    const watcher = redactGame(parked, "p1", true);
    expect(watcher.phase.kind === "effect:choose" ? watcher.phase.prompt : "not-a-park").toBeNull();
  });

  it("`programPlayable` owes NO arm — and the positive control proves it is asking", () => {
    // The third read site, and the same answer D230 measured for the Bench form: a
    // deck search is "playable enough" because the deck is not public knowledge
    // (ruling/284), and `searchDeck` carries no gate at all. Driven from both ends
    // so the claim can go red either way.
    const state = ready(22);
    for (const clause of CLAUSES) {
      expect(programPlayable(state, programOf(clause), "p1"), clause.text).toBe(true);
    }
    // …and the predicate is not simply saying yes to everything: the same board
    // refuses a gust with an empty opponent Bench.
    const empty = clearBench(state, "p2");
    expect(programPlayable(empty, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(empty, programOf(CLAUSES[0]), "p1")).toBe(true);
  });

  it("no printing of this family is a played ABILITY in this pool", () => {
    // ⚠️ THE HONEST DIFFERENCE FROM D230, SAID OUT LOUD: the three-column sweep
    // returns EIGHT ability sentences for the to-hand form (14 legal printings —
    // "Once during your turn, you may search your deck for …"), where the Bench
    // form had one. They are a DIFFERENT family — every one carries a "Once during
    // your turn" §9 opener this reader does not parse and an ability deriver would
    // own — so none of them reaches this arm, and this sweep is what goes red if a
    // fixture ever prints one.
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const ability of card.abilities ?? []) {
        expect(deriveAttackEffect(ability.effect ?? ""), `${card.id} — ${ability.name}`).toBeNull();
      }
    }
    // …and the sweep is NOT vacuous: the pool prints a whole §9 deck-search
    // ability verbatim (`sv01-076`/`sv01-209` Pachirisu), so the line above is
    // "this arm refuses that shape", not "the pool happens to print none".
    expect(FIXTURE_POOL["sv01-076"]?.abilities?.[0]?.effect).toBe(
      "Once during your turn, you may search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    );
  });
});
