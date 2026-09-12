import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { matchesFilter } from "./cards";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp, GameState } from "./index";
import { programFor } from "./index";
import {
  BENCH_SEARCH_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.146.0 → 0.147.0 — D230, THE DECK SEARCH ONTO YOUR OWN BENCH: row 6 of
// `coverage-backlog-legal.md`, the biggest single count this reader has taken
// since D131's 16-printing mill, and the FIRST derived arm whose program is TWO
// OPS.
//
//   "Search your deck for a Basic Pokémon and put it onto your Bench.
//    Then, shuffle your deck."                                        ( 7 legal)
//   "…up to 2 Basic Pokémon…"                                         ( 7 legal)
//   "…up to 3 Basic Pokémon…"                                         ( 2 legal)
//   "…up to 3 Charjabug…" / "…up to 2 Grubbin…" / "…up to 2 Froakie…"
//   / "…a Pikachu…"                                                   ( 4 legal)
//
// **20 Standard-legal printings for ONE anchor.** No new op, no new op FIELD, no
// new `CardFilter` member, no interpreter diff, no wire/schema/client diff:
// `searchDeck` + `shuffleDeck` is Nest Ball's program, authored in the registry
// since M4, and all that was ever missing was a reader for the sentence printed
// as an ATTACK.
//
// 🛑 THE ROW PRICED IT AT **22 PRINTINGS / ~9 ARMS** AND BOTH HALVES ARE WRONG —
// the fifth `needs` cell on this branch to misprice, and the second in a row to
// miss in both directions at once. Re-derived (never inherited) against the
// remote D1 `luminous` — 3,786 rows / 20 sets, 2,021 `legal_standard = 1` — on
// 2026-08-05 over `json_each` + `GLOB`, all three text columns, and **grouped BY
// SENTENCE before anything was priced** (D229's lesson, applied as instructed):
// the family is **25 legal printings over 12 distinct sentences** in the attack
// column, and it is **ONE** anchor. Nine "arms" was nine NOUNS; the sentence around
// them never varied.
//
// ⚠️ AND 25 IS THE SECOND FIGURE THIS SLICE MEASURED. The first sweep said 24 and
// was CASE-SENSITIVE on the opening verb, so it structurally could not see Lillie's
// Comfey `sv09-068` (*"**You may** search…"*). What caught it was the arithmetic
// row in this file going red — which is the whole reason a census is written down
// as an assertion instead of a paragraph.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did a card reach the Bench". Both ops
// have run since M4 and `searchMove` is shared verbatim, so the board move has
// four suites behind it already. What is NEW is a NOUN read off text, and the
// whole risk of the slice is that the noun is a capture: a build with a `(.+)`
// there would derive the same program for four printed sentences that mean
// something narrower, and every generic search assertion in this repo would stay
// green. So the near misses are driven, not listed.

/** The four printed FORMS this one anchor reads, with the program each derives
    to and the printings measured for it. Census re-derived (not inherited) on
    2026-08-05 against the remote D1 `luminous` over `json_each` +
    `json_extract(value,'$.effect')` with `GLOB` rather than `LIKE` — SQLite's
    `LIKE` is ASCII case-insensitive and has cost this repo a census.

    ⚠️ SWEPT OVER ALL THREE TEXT COLUMNS, and the negative result is part of the
    census: `abilities_json` returns exactly ONE legal row for this shape (Koffing
    `sv10-125`, a §9 TRIGGER over a noun no filter spells) and the `effect` column
    returns five TRAINER rows, none of them attack text. So no printing of this
    family is a played Ability, and `programPlayable` — the read site the backlog
    row wanted priced — is reached by none of it. Driven below rather than argued.

    Both figures per row: `printings` over the whole remote catalog,
    `legalPrintings` over the Standard pool. A count without a population AND a
    legality is not a fact. */
const CLAUSES = [
  {
    text: "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for a Basic Pokémon onto your Bench.",
    printings: 16,
    legalPrintings: 7,
  },
  {
    text: "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 2 Basic Pokémon onto your Bench.",
    printings: 11,
    legalPrintings: 7,
  },
  {
    text: "Search your deck for up to 3 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 3 Basic Pokémon onto your Bench.",
    printings: 2,
    legalPrintings: 2,
  },
  {
    // The NAMED noun, folded into the same anchor's second capture. Four printed
    // sentences share this row: Charjabug `sv07-052` (3), Grubbin `sv05-018` (2),
    // Froakie `sv06-056` (2) and "a Pikachu" `svp-085` (1) — one legal each.
    text: "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.",
    program: [
      { op: "searchDeck", filter: { kind: "byName", name: "Charjabug" }, dest: "bench", max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    note: "Search your deck for up to 3 Charjabug onto your Bench.",
    printings: 4,
    legalPrintings: 4,
  },
] as const;

const ONE = 0;
const TWO = 1;
const THREE = 2;
const NAMED = 3;

/** The other three named printings, which ride the SAME anchor row above. They
    are here so the "4 legal" figure has four live subjects rather than one and a
    multiplication — the shape D229's near-miss note asks for. */
const OTHER_NAMED: readonly (readonly [string, string, number])[] = [
  ["Search your deck for up to 2 Grubbin and put them onto your Bench. Then, shuffle your deck.", "Grubbin", 2],
  ["Search your deck for up to 2 Froakie and put them onto your Bench. Then, shuffle your deck.", "Froakie", 2],
  ["Search your deck for a Pikachu and put it onto your Bench. Then, shuffle your deck.", "Pikachu", 1],
];

/** ⚠️⚠️ D238 — THE ONE CATALOG SENTENCE THIS ANCHOR GAINED, and the ONLY printed
    witness in the whole 3,786-row catalog for `typedPokemon.stage`. **1 printing,
    0 legal** — read anyway, because *an arm transfers across sets and a registry
    row does not* (D180/D187), and because without it the `stage` rider would be a
    field no printing drives, which this repo does not ship.

    🛑 IT IS ALSO THE ONE ANCHOR OF THE THREE THAT GAINED A **CAPTURE GROUP**.
    `ATTACK_HAND_SEARCH` needed no regex change (its lazy noun capture already
    admitted a brace phrase) and `ATTACK_DISCARD_RETRIEVAL` needed none either
    (its noun ALTERNATION widened) — this one dispatches on WHICH GROUP MATCHED,
    so a third alternative is a third group. That is why the slice's written
    prediction of "one capture group per anchor, three anchors" was graded WRONG
    at a factor of three. */
const TYPED: readonly (readonly [string, EffectOp[]])[] = [
  [
    "Search your deck for a Basic {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    [
      {
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Grass", stage: "basic" },
        dest: "bench",
        max: 1,
      },
      { op: "shuffleDeck" },
    ],
  ],
];

/** 🛑 THE FAMILY'S NEAR MISSES, AND THREE OF THE FOUR ARE **LEGAL** — which is
    strictly better evidence than D229's (whose typed sibling was a real catalog
    row but 0 legal, and whose trailing-clause case had to be constructed). Every
    one of these is a printed sentence that a `(.+)` noun would have swallowed,
    and every one of them means something the derived program could not say. */
const NEAR_MISSES: readonly (readonly [string, string])[] = [
  [
    // ⚠️ THE WORST ONE, AND IT IS ALREADY BUILT — which is exactly why it is here:
    // `programFor("sv10-083")` wins over the deriver, so a wrong anchor would be
    // INVISIBLE on this card and would fire on the next owner-prefixed printing
    // that arrives without a registry row.
    "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "an owner-narrowed noun (sv10-083, 1 legal, registry-authored)",
  ],
  [
    "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "an owner-narrowed noun behind a 'You may' (sv09-068, 1 legal, registry-authored)",
  ],
  [
    // Printed as a disjunction BECAUSE `byName` is exact in paper too: "Maushold
    // ex" is a different card name from "Maushold", and the card says so.
    // 🆕 **D339 — THE REASON HERE WAS STALE AND IS REPAIRED, THE ASSERTION IS NOT.**
    // It used to read "no CardFilter member"; `anyOf` IS that member (D337 on the
    // Trainer surface, D338 on the attack surface), and this sentence is BUILT at
    // D339 as the registry row `FAMILIAL_MARCH`. It stays in this table, and
    // `deriveAttackEffect(text)` is still asserted null below, for the same reason
    // `sv10-083` and `sv09-068` do: **the DERIVER must refuse a registry-authored
    // sentence rather than re-read it** (D314's distinction). Refused ≠ unbuilt.
    "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.",
    "a DISJUNCTION of two names (sv08-158, 1 legal, registry-authored at D339)",
  ],
  // ⚠️⚠️ RE-HOMED AT D238, NOT DELETED. This slot held "a Basic {G} Pokémon" —
  // the TYPE-narrowed noun, 1 catalog printing and 0 legal — as a near miss the
  // capture had to refuse. D238 spells it (`typedPokemon` with the `stage`
  // rider), so the subject moved to `TYPED` below and the CLAIM re-homed onto a
  // brace code the maps do not spell: `{Q}` is not a printed type, so the
  // PATTERN matches and the MAP refuses, which is the layer that has to say no.
  [
    "Search your deck for a Basic {Q} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    "a brace code that is not a printed type — `POKEMON_TYPE_BY_CODE` has no `Q`",
  ],
  [
    "Search your deck for a {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
    "the typed noun WITHOUT the printed `Basic` — no catalog sentence benches an unmarked type, so this anchor's group spells `Basic` and refuses the rest",
  ],
  [
    "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.",
    "an HP predicate (3 legal, all TRAINERS) — out of this reader's column entirely",
  ],
];

/** The two legal printings this slice DEFERS, each on something that is not this
    sentence, pinned derived-to-null so the deferral is a fact about the code
    rather than a note.

    🆕🆕 **D502 COLLECTED THE SECOND ONE, SO THIS LIST IS ONE ROW — AND THE
    DEFERRAL WAS SPLIT RATHER THAN SHORTENED (D441).** The stated reason was never
    shared: `sv06-009` is blocked on the §4 going-first licence (a `CardProgram`
    field plus the §8 declaration gate), `sv06-046` was blocked on
    `searchDeck.recordAs` plus a record-pinned `moveEnergy` destination. Checking
    that the surviving row's reason was never about the collected one is the whole
    of D441's rule, and here it holds by inspection: the two share no clause.

    🛑 **AND THE COLLECTED ROW IS RE-POINTED, NOT DELETED (D418/D438/D444).** A
    `toBeNull` on a sentence the catalog PRINTS is a liability the day somebody
    builds it, and its replacement is never "drop the assertion": `DEFERRED_BUILT`
    below keeps `sv06-046` as a subject and asserts, by name, what now owns it AND
    that **this file's own anchor still refuses it** — which is the claim
    `D230-anchor-drops-the-tail` rests on. Re-pointing to a bare `.not.toBeNull()`
    would have been true under a `$`-less `BENCH_SEARCH_TAIL` as well, and that row
    would have gone quiet. */
const DEFERRED: readonly (readonly [string, string])[] = [
  [
    "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    "sv06-009 Volbeat — the §4 licence, `trainerFirstTurnExempt`'s ATTACK twin",
  ],
];

/** 🆕🆕 **D502 — the row that LEFT `DEFERRED`, and the two halves of what replaced
    its `toBeNull`.** `derivedBenchSearchMove.test.ts` owns the sentence; this slot
    exists so the ARITHMETIC below still names every one of the family's 25
    printings, and so the head anchor's refusal of it stays executable here. */
const DEFERRED_BUILT =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

// ── The board. Indices 17-19 on `fix-trainerops`, appended by D230. ──
const CALL_FOR_FAMILY = 17;
const FORM_RANKS = 18;
const PARALLEL_PLACEMENT = 19;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_SEARCH_DECK, p2: BENCH_SEARCH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` over a Bench of `ownBench` bodies; p2 holds a
    `fix-bigbody` Active and a Bench of its own — set explicitly on BOTH sides,
    because the crossed build this file guards against reaches for the other
    seat's. */
function ready(seed: number, { ownBench = 0 }: { ownBench?: number } = {}): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** The parked `chooseCards` prompt an attack produced. */
function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a prompt is offering, sorted — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR — one regex, four printed forms, two filters
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — nine printed nouns, ONE sentence", () => {
  it("derives each printed form to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    // …and the three other NAMED printings ride the identical row, differing only
    // in the captured name and the printed number.
    for (const [text, name, max] of OTHER_NAMED) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "searchDeck", filter: { kind: "byName", name }, dest: "bench", max },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("adds up: 20 of the family's 25 legal printings, on ONE anchor", () => {
    // The arithmetic stated rather than described. The backlog row said 22 legal
    // for ~9 arms; measured by sentence, it is 25 legal for ONE.
    //
    // 🛑 THIS ROW HAS ALREADY GONE RED ONCE, ON ITS OWN AUTHOR. The first census
    // said 24 because its `GLOB` was case-sensitive on the opening verb and could
    // not see `sv09-068`'s "You may search…"; the residual list below did not
    // balance, and the number moved. That is the argument for writing a census as
    // arithmetic rather than as prose, made by the census itself.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(20);
    expect(CLAUSES[ONE].legalPrintings).toBe(7);
    expect(CLAUSES[TWO].legalPrintings).toBe(7);
    expect(CLAUSES[THREE].legalPrintings).toBe(2);
    expect(CLAUSES[NAMED].legalPrintings).toBe(4);
    // The five legal printings left, each pinned below: 20 read + 2 already BUILT
    // as registry rows (`sv10-083`, `sv09-068` — in NEAR_MISSES, because the
    // deriver must refuse them whether or not they are simulated) + 1 disjunctive
    // noun (`sv08-158`) + 1 §4 licence (`sv06-009`) + 1 §9.2 tail
    // (`sv06-046`) = 25.
    // 🆕 **D339 — THE LABEL ON THE THIRD TERM MOVED AND THE ARITHMETIC DID NOT.**
    // `sv08-158` was called "unspellable"; it is spellable (`anyOf` of two `byName`s)
    // and is BUILT as `FAMILIAL_MARCH`. It keeps its own term rather than joining the
    // `+2`, because that term is captioned "in NEAR_MISSES" and this id is in
    // `DEFERRED` — the two tables are different pins and merging the counts would
    // make the sum stop matching the tables it is a census OF. **Still `= 25`.**
    // 🆕🆕 **D502 — THE LABEL ON THE LAST TERM MOVED AND THE ARITHMETIC DID NOT**,
    // which is D339's move at a second term. `sv06-046` is no longer in `DEFERRED`;
    // it is BUILT, by `ATTACK_BENCH_SEARCH_THEN_MOVE` in the same file as this
    // anchor. It keeps its own term for D339's stated reason — the terms are a
    // census OF the tables, so folding it into the `20` would make the sum stop
    // matching the table it counts. **Still `= 25`.**
    expect(20 + 2 + 1 + 1 + 1).toBe(25);
    for (const [text] of DEFERRED) expect(deriveAttackEffect(text), text).toBeNull();
    // 🛑 **THE RE-POINT, AND IT IS TWO CLAIMS RATHER THAN ONE** (D438: name what
    // now owns it AND keep the refusal). Under a `$`-less `BENCH_SEARCH_TAIL` the
    // head anchor above would claim this string and answer the BARE two-op program,
    // silently dropping the §9.2 tail — so the second rung is what
    // `D230-anchor-drops-the-tail` dies on, and it is a REAL printing rather than a
    // construction, exactly as that row's `what` has claimed since D230.
    expect(deriveAttackEffect(DEFERRED_BUILT)).not.toBeNull();
    expect(deriveAttackEffect(DEFERRED_BUILT)).not.toEqual(CLAUSES[ONE].program);
    expect((deriveAttackEffect(DEFERRED_BUILT) ?? []).map((o) => o.op)).toEqual([
      "searchDeck",
      "shuffleDeck",
      "recordGate",
    ]);
    // ⚠️ **THE HONEST LIMIT OF THIS RE-POINT, MEASURED AT BOTH LAYERS (D490/D491).**
    // It asserts the program's OP LIST, not its fields — so it is BLIND to the two
    // mutations D502's own suite exists for: the arm dropping `destRecorded` (a READER
    // mutation) and the interpreter's narrowing going vacuous (an EXECUTOR one) both
    // leave this list byte-identical, and both were driven here and came back GREEN.
    // What this rung DOES cover is the one thing `derivedBenchSearchMove.test.ts`
    // cannot cover on its own behalf: a `$`-less `BENCH_SEARCH_TAIL`, under which the
    // anchor ABOVE claims D502's sentence first and answers `["searchDeck",
    // "shuffleDeck"]` — driven, and that is `D230-anchor-drops-the-tail`'s kill.
  });

  it("🆕 D238 — the TYPED noun derives, and the `stage` rider is in the program", () => {
    // The re-homed near miss, inverted. Both halves matter: the FILTER carries
    // the resolved type (not the printed code) and the RIDER carries the printed
    // "Basic", so a build that dropped either produces a different program for
    // the same bytes.
    for (const [text, program] of TYPED) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
    // …and the unmarked form, which no catalog sentence benches, is refused by
    // this anchor's group rather than admitted and then narrowed — the reason the
    // group spells "Basic" instead of making it optional.
    expect(
      deriveAttackEffect(
        "Search your deck for a {G} Pokémon and put it onto your Bench. Then, shuffle your deck.",
      ),
    ).toBeNull();
    // 🛑 THE FILTER'S OWN FALSIFIABILITY PAIR, on the two fixtures that differ by
    // exactly one field: the rider must refuse the Stage 1 of the same type.
    const marked: CardFilter = { kind: "typedPokemon", pokemonType: "Grass", stage: "basic" };
    expect(matchesFilter(FIXTURE_POOL["fix-grass-basic"], marked)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], marked)).toBe(false);
  });

  it("🛑 REFUSES all six near misses — three of them LEGAL, one of them BUILT", () => {
    // A `(.+)` noun would have taken every one of these and derived a search for
    // "any Basic Pokémon" (or, worse, for a card named "Basic {G} Pokémon"). This
    // is the assertion the whole capture design exists for.
    for (const [text, why] of NEAR_MISSES) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    // …and the owner-narrowed pair is BUILT, so the refusal above is not the
    // engine failing to simulate them — the registry answers for both, which is
    // also why a wrong anchor would have been invisible on exactly these two.
    expect(programFor("sv10-083")?.attack?.[0]).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Steven", stage: "basic" },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv09-068")?.attack?.[0]?.[0]).toMatchObject({
      op: "searchDeck",
      filter: { kind: "ownerPokemon", owner: "Lillie", stage: "basic" },
    });
  });

  it("the article and numeric forms are ONE anchor, and the missing group IS max 1", () => {
    // The alternation, asserted as behaviour: "a Basic Pokémon … put it" and "up
    // to 2 Basic Pokémon … put them" derive to programs that differ in `max` and
    // in NOTHING else. A build that split them into two anchors would pass every
    // accept case above and is a third of the "~9 arms" the backlog row priced.
    const [one] = deriveAttackEffect(CLAUSES[ONE].text) ?? [];
    const [two] = deriveAttackEffect(CLAUSES[TWO].text) ?? [];
    expect(one).toEqual({ ...two, max: 1 });
    // …and a number the catalog does not print today rides the same arm, which is
    // why the count is captured rather than alternated over 1, 2 and 3.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 9 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 9 },
      { op: "shuffleDeck" },
    ]);
  });

  it("the NAMED form differs by its FILTER and by nothing else", () => {
    const [basic] = deriveAttackEffect(CLAUSES[THREE].text) ?? [];
    const [named] = deriveAttackEffect(CLAUSES[NAMED].text) ?? [];
    expect(named).toEqual({ ...basic, filter: { kind: "byName", name: "Charjabug" } });
    // …which is the one noun phrase that differs in print, too.
    expect(CLAUSES[NAMED].text).toBe(CLAUSES[THREE].text.replace("Basic Pokémon", "Charjabug"));
  });

  it("the NAME group is ONE capitalised word, and that is the guard", () => {
    // Every named printing in the family prints one; a hyphenated, spaced or
    // apostrophised name falls through to the loud ATTACK_EFFECT_SKIPPED path
    // rather than being approximated. Named here so a future widening has to walk
    // past this line rather than discover it.
    const shape = (noun: string) =>
      `Search your deck for a ${noun} and put it onto your Bench. Then, shuffle your deck.`;
    expect(deriveAttackEffect(shape("Charjabug"))).not.toBeNull();
    for (const noun of ["Mr. Mime", "Iron Thorns", "Ho-Oh", "Farfetch'd", "charjabug"]) {
      expect(deriveAttackEffect(shape(noun)), noun).toBeNull();
    }
  });

  it("carries NO new op, NO new op field and NO new filter member", () => {
    // The honest price of the slice, asserted. Both ops have been in the union
    // since M4 and are byte-for-byte Nest Ball's program; the only thing this
    // slice adds to either is that a DERIVER can now produce them.
    for (const { program } of CLAUSES) {
      expect(program.map((o) => o.op)).toEqual(["searchDeck", "shuffleDeck"]);
      const [search, shuffle] = program;
      expect(Object.keys(search as object).sort()).toEqual(["dest", "filter", "max", "op"]);
      expect(Object.keys(shuffle as object)).toEqual(["op"]);
    }
    // …and the same two ops, in the same order, are what Nest Ball has authored
    // since M4 — the sentence read off a Trainer instead of an attack.
    expect(programFor("sv01-181")?.trainer).toEqual(CLAUSES[ONE].program);
  });

  it("refuses the anchor, punctuation and case rewrites", () => {
    const bare = CLAUSES[ONE].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats. ⚠️ NOT CONSTRUCTED:
      // `sv06-009` prints exactly this, with the §4 licence in front.
      `Draw a card. ${bare}`,
      // A trailing clause — the shape a `^`-only build eats. ⚠️ ALSO NOT
      // CONSTRUCTED: `sv06-046` prints exactly this, with a §9.2 rider behind.
      `${bare} Your opponent draws a card.`,
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Bench", "bench"),
      // The trailing period, and the trailing SENTENCE — the shuffle is printed,
      // so a build that made it optional would read a card that never says it.
      bare.slice(0, -1),
      "Search your deck for a Basic Pokémon and put it onto your Bench.",
      // The pronoun crossed with the quantity — no printing spells either, and
      // the alternation refuses both by construction rather than by a guard.
      "Search your deck for a Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      // The DESTINATION changed, which is the whole content of `dest` and is also
      // a real printed shape. ⚠️ D231 CORRECTED THIS PARENTHETICAL: it said "41
      // legal printings search into the HAND", and 41 is the **`effect` (Trainer)
      // column**. The ATTACK column — the only one this reader can reach — holds
      // **42**, re-measured 2026-08-06. Two denominators one word apart, inside
      // one family. ⚠️ AND THE REWRITE BELOW IS STILL NULL even though D231 now
      // reads to-hand searches — but for a DIFFERENT reason at each reader: this
      // anchor refuses the destination, and D231's anchor MATCHES the sentence and
      // then refuses the NOUN, because no printing searches for "a Basic Pokémon"
      // into the hand and its table is authored off the bytes.
      "Search your deck for a Basic Pokémon and put it into your hand. Then, shuffle your deck.",
      // The opponent's board, which no member of this family reaches.
      "Search your deck for a Basic Pokémon and put it onto your opponent's Bench. Then, shuffle your deck.",
      // The DISCARD PILE — `discardPileRetrieval`'s zone, a different op.
      "Search your discard pile for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      // A printed ZERO. ⚠️ CONSTRUCTED, AND SAID SO: no card prints "up to 0", so
      // this is the guard every arm in this file carries with no catalog witness.
      // It stays loud rather than deriving a search the interpreter turns into a
      // silent no-op that still shuffles.
      "Search your deck for up to 0 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    // ⚠️ A PREDICTION ABOUT A SIBLING CENSUS, WHICH IS THE CHEAPEST CHECK THERE
    // IS (D229's note predicted its own 88 by name). `clauseApostrophe.test.ts`
    // sweeps every FIXTURE_POOL attack sentence CONTAINING an apostrophe; these
    // four carry none, so that census must be UNMOVED by this slice — still 88.
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries the three forms at 17-19", () => {
  it("fields the family at indices 17-19, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    // 48 at D236, which appended 43-47 (attach from the HAND); 43 at D235, which
    // appended 35-42 (the deck search that ATTACHES); 35 at
    // D234, which appended 29-34 (the discard-pile attach); 29 at D232, which
    // appended 25-28 (the opponent-hand family); 25 at D231, which appended
    // 20-24 (the deck search into your own HAND); 20 at D230 (17 at D229, 14 at
    // D228, 13 at D227, 9 at D189, 8 at D181). TEN slices, ten appends, zero
    // inserts — which is what every index constant in ten suites depends on.
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
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[CALL_FOR_FAMILY]?.effect).toBe(CLAUSES[ONE].text);
    expect(attacks[FORM_RANKS]?.effect).toBe(CLAUSES[TWO].text);
    expect(attacks[PARALLEL_PLACEMENT]?.effect).toBe(CLAUSES[NAMED].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks[14]?.effect).toBe("Move an Energy from this Pokémon to 1 of your Benched Pokémon.");
    expect(attacks[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("NO printed base damage on any of the three — and here that IS the catalog", () => {
    // ⚠️ THE OPPOSITE CALL FROM D229's THREE ROWS, SAID OUT LOUD SO THE REASON DOES
    // NOT TRANSFER BY ACCIDENT. There the omission is a deliberate divergence
    // (Iron Thorns ex prints 120); here every one of the family's 24 legal attack
    // printings prints a bare effect and no `damage` at all, re-read off the
    // remote D1 on 2026-08-05.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const index of [CALL_FOR_FAMILY, FORM_RANKS, PARALLEL_PLACEMENT]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these three rows and not about the fixture at large.
    expect(attacks[3]?.damage).toBe(60);
  });

  it("⚠️ index 19's COST diverges from its printing, and says so here", () => {
    // Charjabug `sv07-052` "Parallel Placement" costs {L}. Every attack on this
    // demonstrator costs {C}, because its decks carry a Colorless Energy line —
    // so the divergence is asserted with its reason rather than left in a comment
    // beside a claim that covers the effect string only (D228's finding).
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[PARALLEL_PLACEMENT]?.cost).toEqual(["Colorless"]);
    for (const attack of attacks) expect(attack.cost).not.toContain("Lightning");
  });

  it("`fix-charjabug` is a STAGE 1 named Charjabug — both halves load-bearing", () => {
    const card = FIXTURE_POOL["fix-charjabug"];
    // The NAME is what `byName` matches, and it is the only body in this pool
    // whose name is not its own id.
    expect(card?.name).toBe("Charjabug");
    expect(card?.id).toBe("fix-charjabug");
    // The STAGE is what makes it a discriminator: `basicPokemon` cannot admit it,
    // so the two filters this anchor emits have DISJOINT candidate sets on the
    // one board below.
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Grubbin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — whose deck, whose Bench, and which noun
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — out of the ATTACKER's deck, onto the ATTACKER's Bench", () => {
  it("parks offering the actor's own Basic Pokémon, bound for the actor's Bench", () => {
    const state = ready(11);
    deepFreeze(state);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);

    const prompt = cardsPrompt(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(1);
    // "up to" — declining is a legal answer, which is also why no `optional`
    // wrapper is owed for a "You may search…" printing (D186's finding).
    expect(prompt.min).toBe(0);
    expect(prompt.note).toBe(CLAUSES[ONE].note);
    // 🛑 EVERY CANDIDATE IS IN THE ACTOR'S OWN DECK. A build that scanned the
    // opponent's would park on a plausible-looking prompt of the same shape.
    for (const uid of prompt.candidates) expect(parked.players.p1.deck).toContain(uid);
    // …and every one of them is a BASIC: `fix-charjabug` is in this deck and is a
    // Stage 1, so the filter has something to refuse rather than admitting the
    // whole deck by accident.
    expect(new Set(offered(parked))).toEqual(new Set(["fix-basic-1", "fix-bigbody", "fix-trainerops"]));
    expect(offered(parked)).not.toContain("fix-charjabug");
    // Nothing has moved yet.
    expect(parked.players.p1.bench).toHaveLength(0);
  });

  it("resolving benches the pick on the ACTOR's side, and shuffles after", () => {
    const state = ready(12);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);
    const pick = cardsPrompt(parked).candidates[0] as string;
    const opponentBench = parked.players.p2.bench.length;
    const { state: done, events } = resolve(parked, [pick]);

    // 🛑 THE ASSERTION THE WHOLE SLICE IS ABOUT: the card left the ACTOR's deck
    // and landed on the ACTOR's Bench. A one-`otherSeat` build lands it opposite.
    expect(done.players.p1.bench.map((p) => p.stack[0])).toEqual([pick]);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(done.players.p2.bench).toHaveLength(opponentBench);
    expect(done.players.p2.deck).not.toContain(pick);
    // …and the TRAILING op fired, in printed order. `DECK_SEARCHED` then `SHUFFLE`
    // is the whole printed sentence, and a build that dropped the second op would
    // leave the deck's order readable to a player who just looked through it.
    expect(types(events).filter((t) => t === "DECK_SEARCHED" || t === "SHUFFLE")).toEqual([
      "DECK_SEARCHED",
      "SHUFFLE",
    ]);
  });

  it("🛑 the NAMED noun and the BASIC noun have DISJOINT candidate sets", () => {
    // ⚠️ THE PAIR THAT MAKES THE SECOND CAPTURE LOAD-BEARING, and the one case a
    // crossed build cannot survive. Same seed, same board, same op, same prompt
    // kind: only the noun differs. `fix-charjabug` is a Stage 1, so a build that
    // emitted `basicPokemon` for "up to 3 Charjabug" would offer three bodies
    // that sentence never names — and a build that emitted `byName` for "a Basic
    // Pokémon" would offer a card no Basic filter admits.
    const state = ready(13);
    const basics = new Set(offered(attack(state, CALL_FOR_FAMILY).state));
    const named = new Set(offered(attack(state, PARALLEL_PLACEMENT).state));
    expect(named).toEqual(new Set(["fix-charjabug"]));
    for (const id of named) expect(basics.has(id)).toBe(false);
    expect(basics.size).toBeGreaterThan(0);
  });

  it("the NAMED search takes up to three, and a Stage 1 really does reach the Bench", () => {
    // Charjabug `sv07-052` is itself a Stage 1 and its attack puts three more of
    // them straight onto the Bench — a §10 sequence no evolution rule allows and
    // the printed card does anyway, which is why this is driven rather than
    // assumed to be "just a search".
    const state = ready(14);
    const { state: parked } = attack(state, PARALLEL_PLACEMENT);
    expect(cardsPrompt(parked).max).toBe(3);
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench.map((p) => done.cardIdByUid[p.stack[0] as string])).toEqual([
      "fix-charjabug",
      "fix-charjabug",
      "fix-charjabug",
    ]);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
  });

  it("the printed max is CLAMPED to the remaining bench space, never to the number", () => {
    // Three bodies benched → two slots left, and the prompt says two. The clamp
    // is the interpreter's (`Math.min(op.max, benchSpace(...))`), which is also
    // the answer to "does a bench search need a `programPlayable` gate" — driven
    // below.
    const state = ready(15, { ownBench: 3 });
    const { state: parked } = attack(state, PARALLEL_PLACEMENT);
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe("Search your deck for up to 2 Charjabug onto your Bench.");
  });

  it("a FULL Bench takes no park at all — and the deck is still shuffled", () => {
    // The clamp's other end, and the case that says the trailing op is an OP: the
    // search is a no-op, the attack resolves inline, and the printed "Then,
    // shuffle your deck." still happens. A `shuffle?: true` rider on `searchDeck`
    // would have to re-derive that; this program gets it for free.
    const state = ready(16, { ownBench: 5 });
    const { state: done, events } = attack(state, CALL_FOR_FAMILY);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.bench).toHaveLength(5);
  });

  it("a WHIFF still shuffles — the candidate set is empty and the sentence completes", () => {
    // Every Charjabug out of the deck, so the named search can find nothing. Same
    // ending as the full Bench, arrived at from the other side.
    let state = ready(17);
    const copies = state.players.p1.deck.filter(
      (uid) => state.cardIdByUid[uid] === "fix-charjabug",
    ).length;
    expect(copies).toBeGreaterThan(0);
    state = discardFromDeck(state, "p1", "fix-charjabug", copies);
    const { state: done, events } = attack(state, PARALLEL_PLACEMENT);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
    expect(done.players.p1.bench).toHaveLength(0);
  });

  it("DECLINING is legal, benches nothing, and still shuffles", () => {
    const state = ready(18);
    const { state: parked } = attack(state, CALL_FOR_FAMILY);
    const { state: done, events } = resolve(parked, []);
    expect(done.players.p1.bench).toHaveLength(0);
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the numeric form takes TWO, and the note names the number", () => {
    const state = ready(19);
    const { state: parked } = attack(state, FORM_RANKS);
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe(CLAUSES[TWO].note);
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE READ SITES THE BACKLOG ROW ASKED TO PRICE — both measured at ZERO
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites, priced by driving them rather than by arguing", () => {
  it("🛑 `programPlayable` owes NO bench-space arm, and the positive case proves it", () => {
    // The backlog row named this as part of the price ("a bench search needs Bench
    // SPACE"). It is NOT: a deck search is "playable enough" because the deck is
    // not public knowledge (ruling/284's line), and the space question is answered
    // one level down in the interpreter, where the clamp runs before anything
    // leaves the deck. Driven from BOTH ends so the claim can go red either way.
    const full = ready(20, { ownBench: 5 });
    for (const { program } of CLAUSES) {
      expect(programPlayable(full, program, "p1")).toBe(true);
    }
    // …and the predicate is not simply saying yes to everything: the same board
    // refuses a gust with an empty opponent Bench, which is the shape a bench-space
    // arm would have copied.
    const empty = clearBench(full, "p2");
    expect(programPlayable(empty, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(empty, CLAUSES[ONE].program, "p1")).toBe(true);
  });

  it("no printing of this family is a played ABILITY — the sweep's negative result", () => {
    // The three-column census returned ONE ability row (Koffing sv10-125) and it
    // is a §9 TRIGGER, not a played Ability; the five `effect`-column rows are
    // TRAINERS. So nothing in this family reaches `programPlayable` at all, and
    // this line is what would go red if a fixture ever printed the sentence as an
    // Ability — the point at which the paragraph above stops being true.
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const ability of card.abilities ?? []) {
        const text = ability.effect ?? "";
        expect(
          text.includes("earch your deck") && text.includes("onto your Bench"),
          `${card.id} — ${ability.name}`,
        ).toBe(false);
      }
    }
    // …and the sweep is not vacuous on the words alone: the pool DOES print
    // "onto your Bench" on an Ability (Bloodmoon Ursaluna `sv06.5-025`'s
    // "when you play this Pokémon … onto your Bench"), which is a different
    // sentence and stays green here exactly as it should.
    expect(
      Object.values(FIXTURE_POOL).some((card) =>
        (card.abilities ?? []).some((a) => (a.effect ?? "").includes("onto your Bench")),
      ),
    ).toBe(true);
  });
});
