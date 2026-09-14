import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { engineVersion } from "./index";
import { programPlayable } from "./cardplay";
import { programFor, registryCardIds } from "./registry";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { POKEMON_TYPE_BY_CODE, POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import type { EffectPrompt } from "./interpreter";
import {
  DECK_SEARCH_ATTACH_DECK,
  FIXTURE_POOL,
  TWO_NOUN_SEARCH_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.150.0 → 0.151.0 — D235, THE DECK SEARCH THAT **ATTACHES**: backlog row 10,
// the biggest attack-column count left on the D233 page, and the FIRST prediction
// on that page to be graded PART WRONG.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT — and unlike D234 the WHOLE row does, not
// just the half an anchor can take. Remote D1 `luminous`, `legal_standard = 1`,
// `json_each` over `attacks_json`/`abilities_json` plus the bare `effect` column,
// GLOB (never LIKE), GROUPED BY SENTENCE, 2026-08-06:
//
//   WHERE t GLOB '*[Ss]earch your deck for*Energy card*attach*' GROUP BY col;
//   -- attack 28 / 17 · ability 5 / 3 · effect 5 / 2
//
// The row says **28 (17 sentences) · 4 · 1**. The ability and Trainer halves are
// the 5 and 5 above minus what is already authored — `sv10-136` (Marnie's
// Grimmsnarl ex) and the four-printing Janine's Secret Art sentence. **33 = 33**,
// two rows running.
//
// 🛑 THE PREDICTION AND ITS GRADE, WHICH IS THE PART WORTH TRANSFERRING. Written
// down before the first regex, so it could be falsified rather than adjusted:
//   • *"ONE anchor plus one optional trailing group, not seventeen arms"* —
//     ✅ CORRECT. D232's rule holds a third time.
//   • *"23 of the 28 legal printings"* — 🛑 **WRONG, it is 20.** The miss has a
//     name: **A DESTINATION TABLE IS NOT PORTABLE BETWEEN TWO OPS JUST BECAUSE
//     ITS KEYS ARE.** D234's table spells every phrase this family prints, so it
//     was priced as free — but `attachEnergyFrom` has `count` (a batch pinned to
//     ONE chosen body, D205) and `attachFromDeck` has no such field, because its
//     park answers with a MAP from card to target. "attach **them** to **1 of**
//     your Pokémon" is expressible one op over and NOT here.
//
// 🛑 20 OF THE 28 ON 12 OF THE 14 READABLE SENTENCES; the 8 left are FOUR
// SEPARATE BLOCKERS (`UNREAD` below), two of which the backlog row priced up
// front and two of which it did not. A residue is a measurement, not a remainder.
//
// 🆕🆕 **D457 MADE IT 23 OF 28 ON 14 SENTENCES AND D458 MAKES IT 25 OF 28 ON 15**
// — read those figures off the `adds up` rung below, never off this paragraph,
// which rots by construction. **BOTH SLICES SPENT A BLOCKER THIS FILE HAD
// MIS-PRICED RATHER THAN ONE IT HAD MEASURED**: D457's was a field priced on the
// wrong op's vocabulary, D458's an arm priced on D232's rule pointing the other
// way when the rule is read instead of cited. The TWO that remain are DATA-blocked
// (no ingested column classifies the Future or Tera banner), which is the first
// kind of refusal in this family whose falsifier is an INGEST change rather than
// an anchor.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy attach".
// `attachFromDeck` has run since M5 with Charizard ex and Janine's Secret Art
// behind it, and `attachFromDeck.test.ts` owns the op's own behaviour. What is
// NEW is a TEXT PARSER, and its two real risks are both one printed word wide:
// the `batch` rule (a sentence that says "1 of" must not derive to a program that
// permits a split), and the §9.2 tail (a sentence that prints no poison clause
// must not derive to a program that poisons). Every case that could survive a
// crossed build is paired with one that could not.

/** The twelve sentences this one anchor reads, with the program each derives to
    and the printings measured for it. Both figures per row: `printings` over the
    whole remote catalog (3,786 rows / 20 sets), `legalPrintings` over the
    Standard pool (2,021 rows) — a count without a POPULATION and a LEGALITY is
    not a fact. */
const CLAUSES = [
  {
    text: "Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1, toSelf: true },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 1,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 4,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for a Basic {M} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Metal" },
        max: 1,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for up to 2 Basic {W} Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Water" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 3 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        benchOnly: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {W} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Water" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {R} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Fire" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {G} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Search your deck for a Basic {F} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Fighting" }, max: 1 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  /** ⚠️ THE ONE SENTENCE WITH A §9.2 TAIL, and the only three-op program in the
      family. `recordAs` is set ONLY here, because the gate that reads it exists
      only here — an unread filing would be a field with no observable meaning
      (D135), and these rows are compared BY VALUE against Janine's hand-authored
      registry ones. */
  {
    text: "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 2,
        toSelf: true,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
  /** 🆕🆕 **D457 — THE TWO SENTENCES D235 REFUSED, APPENDED LAST.**
      *"attach **them** to **1 of** your Pokémon"*: the batch is pinned to ONE
      chosen body by `attachFromDeck.oneTarget`, the field D235 measured as missing
      and priced on `attachEnergyFrom`'s vocabulary. APPENDED rather than filed
      beside their singular twins, because every index constant below is a position
      in this array and §2's PROVENANCE rungs read the demonstrator's rows in this
      order — the `FAMILIAL_MARCH` rule (D339), one file over. */
  {
    text: "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2, oneTarget: true },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
    program: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        max: 2,
        benchOnly: true,
        oneTarget: true,
      },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  /** 🆕🆕 **D458 — THE SECOND PRINTED NOUN, AND THE FAMILY'S ONLY MULTI-SEARCH
      PROGRAM.** Corpus line **410**. The printed cap is PER NOUN — *"up to 2 Basic
      {G} … **and** up to 2 Basic {L} …"* — so the two quotas are two `max`es and
      the sentence derives to TWO `attachFromDeck` ops in sequence plus ONE trailing
      `shuffleDeck`, because the card prints one shuffle.

      🛑 **ZERO NEW OP FIELDS, WHICH THE `known` RUNG BELOW EXECUTES RATHER THAN
      CLAIMS.** Both ops carry only keys `attachFromDeck` has had since M5-D50.
      APPENDED rather than filed beside its {G}/{L} single-noun neighbours, for
      D457's reason: every index constant below is a position in this array. */
  {
    text: "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    program: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 2 },
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2 },
      { op: "shuffleDeck" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
] as const;

const SELF_BARE = 0;
const SELF_LIGHTNING = 1;
const SELF_METAL = 2;
const SELF_WATER_TWO = 3;
const ANY_WAY_THREE = 4;
const BENCH_ANY_WAY = 6;
const ONE_OF_WATER = 7;
const POISON_TAIL = 11;
// D457's two, appended last (see the rows themselves for why they are appended).
const ONE_OF_TWO = 12;
const ONE_OF_BENCH_TWO = 13;
// D458's one, appended last for the same reason.
const TWO_NOUNS = 14;

/** 🛑 THE RESIDUE, MEASURED. 🆕🆕 **D458 — THREE legal printings over TWO
    sentences** (D457: five over three; D235: eight over five), each refused for a
    DIFFERENT reason, each pinned derived-to-null. `[text, legal, why]` — and the `why` is what the
    backlog sub-row carries, because "the rest of row 10" is how a row acquires a
    count nobody can reproduce.

    ⚠️ TWO OF THE ORIGINAL FIVE WERE PRICED BY THE ROW UP FRONT AND TWO WERE NOT,
    which is itself the measurement: a row that prices its blockers is still only
    as good as the op vocabulary the pricer had in mind.

    🛑 **AND THE TWO THAT LEFT ARE THE TWO THE ROW DID NOT PRICE — BOTH OF THEM,
    ON ONE FIELD.** `oneTarget` (D457) is the batch-onto-one-body gap, and D235's
    own words for it were *"UNREPRESENTABLE here"*: true of `attachEnergyFrom`'s
    `count`, false of this op, which needed a flag on the MAP rather than a count
    beside it. **A refusal that names the wrong carrier reads as a fact about the
    sentence** — so what expired here is a PRICE, not a census.

    ⚠️ THE THREE THAT REMAIN ARE UNCHANGED AND RE-MEASURED BY MINIMAL PAIR at
    D457's head: for `sv08-161` (the Tera row) dropping EITHER blocker alone still
    derives to null, which is what makes it two blockers on one printing rather
    than one wearing two names.

    🛑🛑 **D458 — THE THIRD ROW LEFT, AND D235's PRICE FOR IT DID NOT SURVIVE
    EITHER.** The second printed noun was filed here as *"a different sentence
    SHAPE, so its own arm by D232's rule"*. **D232's rule says the opposite when it
    is read rather than cited**: a family collapses to ONE arm when its sentences
    differ in a NOUN and splits when they differ in a VERB, and it splits a family
    only where an alternation would have to loosen the punctuation, the
    conjunction, the pronoun AND the verb form together. Corpus line 410 differs
    from its neighbours in the NOUN COUNT alone — same verb, same pronoun, same
    destination vocabulary, same trailing shuffle — so it cost **one optional group
    on the anchor already here, ZERO new anchors and ZERO new op fields**. **That is
    now TWO consecutive slices in which this table's stated blocker named the wrong
    carrier**: D457's was a field priced on the wrong op, this one an arm priced on
    a rule pointing the other way. ⚠️ **THE TWO THAT REMAIN ARE BOTH
    DATA-BLOCKED** — the ingested `cardSchema` carries no column that classifies the
    Future or Tera banner — which is a different KIND of refusal from either
    expired one, and the condition that would reverse it is an INGEST change, not an
    arm. */
const UNREAD = [
  [
    "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
    2,
    "a SUBGROUP target — `targetType` reads `card.types`, and Future is not a type; priced by the row",
  ],
  [
    "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
    1,
    "BOTH blockers on one printing (sv08-161): the Tera subgroup AND a distinctness constraint the anchor's welded `Energy cards and attach them` does not even admit — \ud83c\udd95 D513 corrected the CARRIER, which read `CardFilter`; no filter can express a pairwise relation among the picks, and the hand-side twin (corpus FILE LINE 473) was built instead through `searchDeck.distinctEnergyTypes` + `chooseCards.caps`",
  ],
] as const;

/** 🛑 THE FAMILY'S REAL NEAR MISSES, catalog rows rather than constructions. The
    first is row 9 — the anchor D234 wrote, one ZONE over — and the second is the
    ability-column printing of this very family, which begins with a §9 trigger
    clause the `^` must refuse. A build that dropped either boundary would read
    text belonging to a different op or a different entry point.

    🆕🆕 **D347 — `ABILITY_SIDE_NEAR_MISS` IS NOW A BUILT CARD, AND THE ASSERTION
    BELOW IS UNCHANGED AND STILL CORRECT.** Yanmega ex `sv10-003`/`sv10-206`/
    `sv10-228` "Buzzing Boost" is a registry program as of this slice
    (`buzzingBoost.test.ts`). The deriver must STILL refuse this string, because an
    Ability has no text deriver in this engine at all — `programFor` is its only
    reader — so "the `^` refuses it" and "the card is built" are claims about two
    different entry points and were never in tension. **Recorded because a future
    slice grepping this constant will find a shipped card and must not conclude the
    negative fixture has rotted: what would rot it is a DERIVER learning the
    sentence, and nothing here does.**

    ⚠️ **AND THE ROW-10 RESIDUE IT SITS BESIDE HAS MOVED, WHICH THIS FILE DOES NOT
    OWN.** `UNREAD[0]`'s blocker — *"batch onto ONE body; `attachFromDeck` has no
    `attachEnergyFrom.count`"* — is UNSPENT and unaffected. Yanmega's batch lands on
    the SOURCE, not on a chosen body, so `toSelf` returns a one-element target list
    and the `attachCards` prompt does the whole job. **The printed pronoun is the
    difference between the two, and a slice that priced by count alone would have
    read them as one gap.** */
const DISCARD_SIDE_NEAR_MISS =
  "Attach a Basic Energy card from your discard pile to 1 of your Pokémon.";
const ABILITY_SIDE_NEAR_MISS =
  "Once during your turn, when this Pokémon moves from your Bench to the Active Spot, you may search your deck for up to 3 Basic {G} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

// ── The board. Indices 35-42 on `fix-trainerops`, appended by D235. ──
const ENERGY_ASSIST = 35;
const ZAP_CHARGE = 36;
const AQUA_SUPPLY = 37;
const ENERGY_BOUNTY = 38;
const BENCH_CHARGE = 39;
const TOXIC_RESERVE = 40;
const WATER_DRAW = 41;
const SPLIT_SUPPLY = 42;
// 🆕🆕 D458 — index 72, appended by this slice: the second printed noun, and the
// only row in this family whose program parks TWICE. See `testFixtures.ts` for why
// it needed an index of its own rather than a reused one.
const SPLIT_HARVEST = 72;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DECK_SEARCH_ATTACH_DECK, p2: DECK_SEARCH_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order. Unlike row 9's board nothing has to be moved into a pile
    first — the DECK is where the cards already are, which is the whole difference
    between the two families' setups. */
function ready(seed: number, bench: readonly string[] = ["fix-basic-1", "fix-basic-1"]): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** 🆕🆕 **D458 — THE SAME BOARD OVER `TWO_NOUN_SEARCH_DECK`**, which is a
    SEPARATE deck constant rather than an edit to the one above: `deckOf` order
    feeds the shuffle, so a card added to a shared deck moves every seed-pinned
    board that reads it (D412 reddened three unrelated slices that way). The
    {G}/{L} pair Split Harvest prints is not in `DECK_SEARCH_ATTACH_DECK` at all —
    it stocks {W}/{L}/{D} — so this is an addition, not a duplication. */
function readyTwoNoun(
  seed: number,
  bench: readonly string[] = ["fix-basic-1", "fix-basic-1"],
): GameState {
  const start = mustApply(
    driveSetup(seed, { p1: TWO_NOUN_SEARCH_DECK, p2: TWO_NOUN_SEARCH_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(start, "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

/** p1's deck with every printing of `id` removed — the shape the "no matching
    Energy" rungs need, lifted out of one of them so D458's ZERO-OF-ONE-TYPE board
    reads the same rule rather than a second copy of it. */
function withoutCard(state: GameState, id: string): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        deck: state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] !== id),
      },
    },
  };
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `attachCards` prompt an attack produced — the COMPOUND one (which
    cards, and where each goes), which is what separates this op from row 9's. */
function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — fifteen printed sentences, ONE arm and TWO optional groups", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 25 of the row's 28 legal printings, and the residue is 3", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one destination row would still pass every accept case above.
    // 🆕 D457 — 12 → 14 sentences and 20 → 23 printings; the DENOMINATORS did not
    // move, because this slice read two sentences the row always counted and
    // ingested nothing.
    // 🆕🆕 D458 — 14 → 15 and 23 → 25, and the denominators are unmoved for the
    // same reason: one more sentence the row always counted, nothing ingested.
    expect(CLAUSES).toHaveLength(15);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(25);
    expect(UNREAD).toHaveLength(2);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(3);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 25 + 3 = 28 and 15 + 2 = 17: exactly the census this row was measured with.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 3).toBe(28);
    expect(CLAUSES.length + UNREAD.length).toBe(17);
  });

  it("🆕🛑 D458 — the SECOND printed noun is ONE optional group, and the axis is the NOUN COUNT", () => {
    // 🛑 **THE MINIMAL PAIRS THAT ISOLATE THE BLOCKER, DRIVEN RATHER THAN
    // ASSERTED (D457's method, one row over).** Deleting EITHER printed noun from
    // line 410 leaves a sentence this anchor has read since D235 — so the whole of
    // what was missing was the second noun, and nothing about the destination, the
    // pronoun, the count or the shuffle was ever in question.
    const both = CLAUSES[TWO_NOUNS].text;
    const grassOnly =
      "Search your deck for up to 2 Basic {G} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.";
    const lightningOnly =
      "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.";
    // The pairs are TEXTUAL deletions of the printed sentence, not hand-written
    // neighbours — a near-miss that differs on more than one axis tests nothing
    // about either (D427).
    expect(both.replace(" and up to 2 Basic {L} Energy cards", "")).toBe(grassOnly);
    expect(both.replace("up to 2 Basic {G} Energy cards and ", "")).toBe(lightningOnly);
    // …and each half derives to exactly the op the two-noun program's own half is.
    expect(deriveAttackEffect(grassOnly)).toEqual([
      CLAUSES[TWO_NOUNS].program[0],
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(lightningOnly)).toEqual([
      CLAUSES[TWO_NOUNS].program[1],
      { op: "shuffleDeck" },
    ]);
    // 🛑 **THE TWO QUOTAS ARE TWO `max`es, NOT ONE SUM.** A build that read the
    // sentence as one search for four Energy passes every "the sentence derives"
    // assertion; it fails here, and the merged spelling is a real corpus shape
    // (line 418, *"up to 3 Basic Energy cards"* at one cap).
    expect(deriveAttackEffect(both)).toHaveLength(3);
    expect(
      deriveAttackEffect(
        "Search your deck for up to 4 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 4 },
      { op: "shuffleDeck" },
    ]);
    // 🛑 **AND ONE `shuffleDeck`, AT THE END, BECAUSE THE CARD PRINTS ONE.** A
    // two-op build that shuffled after each search is the mistake this asserts
    // against — it would scramble the deck at a moment no sentence names.
    expect(deriveAttackEffect(both)?.filter((op) => op.op === "shuffleDeck")).toHaveLength(1);
    expect(deriveAttackEffect(both)?.at(-1)).toEqual({ op: "shuffleDeck" });
  });

  it("🆕🛑 D458 — the second noun is REFUSED beside a coupling it cannot honour, and ADMITTED without one", () => {
    // 🛑 **THE TWO PRECONDITIONS THAT MAKE TWO OPS EQUAL ONE PRINTED SENTENCE.**
    // Two sequential searches carry two maps and two §9.2 filings, so any printed
    // rule that couples the two batches would be silently broken by the
    // decomposition. Both are refused rather than mis-built (D190b/D199: a
    // wrong-but-plausible program is strictly worse than an unbuilt one), and
    // **each refusal is paired with the admission that differs from it on ONE
    // axis** — without the pair, a reader that refused everything would pass
    // (D424).
    const twoNounRefusals = [
      // (a) `destination.batch === false`: "attach them to **1 of** your Pokémon"
      // is D457's `oneTarget`, a constraint on the MAP. Two maps could put the
      // {G} batch on one body and the {L} batch on another.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.",
      // (b) the §9.2 poison tail files `recordAs: "moved"`, and two ops filing one
      // slot means the second OVERWRITES the first — a board where the {G} search
      // attached and the {L} search whiffed would file `[]` and the printed gate
      // would answer NO about an attach that happened.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
    ];
    for (const text of twoNounRefusals) expect(deriveAttackEffect(text), text).toBeNull();
    // ⚠️ THE CONTROLS, one axis each. Drop the second noun and both derive; keep
    // the second noun and drop the coupling and it derives.
    for (const text of twoNounRefusals) {
      expect(
        deriveAttackEffect(text.replace(" and up to 2 Basic {L} Energy cards", "")),
        text,
      ).not.toBeNull();
    }
    // "this Pokémon" is a `batch: true` row — the op resolves it to a 0-or-1 ref
    // list — so the second noun IS admitted there once the §9.2 tail is gone.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 2,
        toSelf: true,
      },
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ]);
    // ⚠️ **THE REFUSALS ARE READ OFF THE MODEL, NOT LISTED** (D424): the `batch`
    // flag is the table's own, so a destination row added there is classified by
    // construction. The GENERATED brace-coded rows prove it — the "1 of your {c}"
    // spelling is refused and the "your {c} … in any way you like" spelling is
    // admitted, on rows nobody wrote by hand.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to 1 of your {R} Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your {R} Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        max: 2,
        targetType: "Fire",
      },
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Lightning" },
        max: 2,
        targetType: "Fire",
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🆕 D458 — the second noun's own grammar rewrites are refused", () => {
    // The optional group is welded as a UNIT, which is what stops it loosening the
    // anchor for every OTHER sentence in the family. Each rewrite is one token off
    // the printed line.
    const rewrites = [
      // The SINGULAR branch cannot take the group — the pronoun stays welded.
      "Search your deck for a Basic {G} Energy card and up to 2 Basic {L} Energy cards and attach it to your Pokémon in any way you like. Then, shuffle your deck.",
      // "Basic" is not optional on the second noun either.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // A brace code the ENERGY map refuses, on the SECOND noun this time.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {C} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // A printed 0 and the shared ingested-text ceiling, both on the SECOND cap —
      // the guards are duplicated deliberately, because a build that checked only
      // the first count passes every accept case in this file.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 0 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic {G} Energy cards and up to 11 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // A THIRD noun. The group is optional, not repeatable — no printing spells
      // one, and an unbounded build would silently drop the third cap.
      "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and up to 2 Basic {W} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      // The `in any combination of` UNION shape — ONE pool with a SHARED cap,
      // which is a different printed rule and is registry-built where the catalog
      // spells it (corpus lines 416 and 427). It must not fall into this arm.
      "Search your deck for up to 2 in any combination of Basic {G} Energy cards and Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("🛑 D235's PREDICTION WAS 23, ITS ANSWER WAS 20, AND D457 MAKES THE ANSWER 23 — for the reason the grade named", () => {
    // ⚠️ THE GRADE, DRIVEN RATHER THAN NARRATED — and now the REPAIR is driven on
    // the same three printings. D235 over-counted by exactly the two "attach THEM
    // to 1 OF your …" sentences (3 legal), on the ground that the printed phrase
    // *"means something `attachEnergyFrom` can say and `attachFromDeck` cannot"*.
    // The first half was true and the second was about a FIELD rather than about
    // the op: `oneTarget` says it on the map, so the same three printings now
    // derive — and they derive WITH the coupling, which is the whole difference
    // between reading the sentence and reading past it.
    const repaired = [CLAUSES[ONE_OF_TWO], CLAUSES[ONE_OF_BENCH_TWO]] as const;
    expect(repaired.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(3);
    for (const { text, program } of repaired) {
      expect(text).toContain("attach them to 1 of your");
      expect(deriveAttackEffect(text), text).toEqual(program);
      // 🛑 THE RUNG THAT REPLACES THE OLD REFUSAL, AND IT HAS TO ASSERT THE RIDER
      // RATHER THAN NON-NULLNESS: "this sentence now derives" is true under a
      // build that dropped the coupling as well as under this one, and only the
      // coupling is what the card prints (the re-pointing rule, D418).
      expect(deriveAttackEffect(text)?.[0]).toHaveProperty("oneTarget", true);
    }
    // …and the SIBLING op still reads the same destination phrase at the same
    // count through its OWN field, which is what makes the two readings a pair
    // rather than one mechanism spelled twice.
    expect(
      deriveAttackEffect(
        "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard", count: 2 }]);
  });

  it("🛑 the BATCH rule: the SAME destination phrase is read BARE at 1 and COUPLED at 2", () => {
    // ⚠️ THE FALSIFIABILITY PAIR (D231), re-pointed by D457 rather than deleted.
    // Both sentences are printed AND legal and they differ by the NUMBER alone,
    // so the pair still isolates one axis — what moved is the answer at the
    // plural: it used to be `null` and it is now the same program wearing
    // `oneTarget`. A build that dropped the rider derives the second to `max: 2`
    // with no target coupling — two Energy free to land on two different Pokémon
    // off a card that prints "1 of" — and it passes every generic attach
    // assertion in this repo, which is exactly what made the old refusal worth
    // keeping and what makes this rung its replacement rather than its deletion.
    expect(deriveAttackEffect(CLAUSES[ONE_OF_WATER].text)).toEqual(CLAUSES[ONE_OF_WATER].program);
    expect(CLAUSES[ONE_OF_WATER].program[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[ONE_OF_TWO].text)).toEqual(CLAUSES[ONE_OF_TWO].program);
    expect(CLAUSES[ONE_OF_TWO].program[0]).toHaveProperty("oneTarget", true);
    expect(CLAUSES[ONE_OF_WATER].legalPrintings).toBeGreaterThan(0);
    expect(CLAUSES[ONE_OF_TWO].legalPrintings).toBeGreaterThan(0);
    // …and it is the DESTINATION that decides whether the rider is owed, not the
    // count: the same "up to 2" carries NO coupling when the phrase admits a
    // batch, which is the half of the rule a `count > 1` build alone would lose.
    expect(deriveAttackEffect(CLAUSES[SELF_WATER_TWO].text)).toEqual(
      CLAUSES[SELF_WATER_TWO].program,
    );
    expect(CLAUSES[SELF_WATER_TWO].program[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[ANY_WAY_THREE].text)?.[0]).not.toHaveProperty("oneTarget");
    expect(deriveAttackEffect(CLAUSES[BENCH_ANY_WAY].text)?.[0]).not.toHaveProperty("oneTarget");
    // The benched twin on both sides, so the rule is not read as "un-narrowed
    // destinations only": the rider rides beside `benchOnly` at 2 and is absent
    // at 1.
    expect(deriveAttackEffect(CLAUSES[ONE_OF_BENCH_TWO].text)).toEqual(
      CLAUSES[ONE_OF_BENCH_TWO].program,
    );
    expect(
      deriveAttackEffect(
        "Search your deck for a Basic {P} Energy card and attach it to 1 of your Benched Pokémon. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        max: 1,
        benchOnly: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the §9.2 TAIL is an OPTIONAL GROUP, and its absence changes the PROGRAM", () => {
    // The tail sentence and the tail-less sentence differ by one printed clause
    // and by a whole op. A build that hard-wired the gate poisons a Wiglett; a
    // build that ignored the clause silently drops the card's second sentence.
    const gated = deriveAttackEffect(CLAUSES[POISON_TAIL].text) ?? [];
    const bare = deriveAttackEffect(CLAUSES[SELF_WATER_TWO].text) ?? [];
    expect(gated).toHaveLength(3);
    expect(bare).toHaveLength(2);
    expect(gated[2]).toEqual({
      op: "recordGate",
      slot: "moved",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
    });
    // `recordAs` rides the gate and NOTHING else — an unread filing is a field
    // with no observable meaning.
    expect(gated[0]).toHaveProperty("recordAs", "moved");
    for (const { program, text } of CLAUSES) {
      if (text === CLAUSES[POISON_TAIL].text) continue;
      for (const op of program) expect(op, text).not.toHaveProperty("recordAs");
    }
    // …and the tail is matched as a LITERAL, so a paraphrase is refused whole
    // rather than read as the bare sentence with a clause thrown away.
    expect(
      deriveAttackEffect(
        `${CLAUSES[SELF_WATER_TWO].text} If you attached Energy to a Pokémon in this way, this Pokémon is now Asleep.`,
      ),
    ).toBeNull();
  });

  it("the NOUN and the DESTINATION are independent axes, which is why it is one arm", () => {
    // ⚠️ THE PREDICTION'S CORRECT HALF, DRIVEN. If the twelve sentences were
    // twelve arms, changing the noun would be free to change something other than
    // `filter.energyType`, and changing the destination free to change something
    // other than the riders. Both are asserted as "differs in exactly one key".
    const [bare] = deriveAttackEffect(CLAUSES[SELF_BARE].text) ?? [];
    const [typed] = deriveAttackEffect(CLAUSES[SELF_LIGHTNING].text) ?? [];
    const [metal] = deriveAttackEffect(CLAUSES[SELF_METAL].text) ?? [];
    expect(typed).toEqual({ ...bare, filter: { kind: "basicEnergy", energyType: "Lightning" } });
    expect(metal).toEqual({ ...bare, filter: { kind: "basicEnergy", energyType: "Metal" } });
    // …and the count rides the same arm at a value no card prints today, which is
    // the whole reason it is a capture rather than an alternation over 2 and 3.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 7 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 7, benchOnly: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("a SINGULAR printing emits `max: 1`, never a missing max", () => {
    // The absent count IS the article. Unlike `attachEnergyFrom.count` this field
    // is REQUIRED on the op, so "absent means 1" resolves at the anchor rather
    // than at the interpreter — stated because the sibling family's identical
    // sentence resolves the other way, and a reader who learned that rule there
    // would carry the wrong one here.
    for (const index of [SELF_BARE, SELF_LIGHTNING, SELF_METAL, ONE_OF_WATER]) {
      expect(CLAUSES[index]?.program[0]).toHaveProperty("max", 1);
    }
  });

  it("🛑 the ZONE is one word from row 9, and the ENTRY POINT one clause from the ability half", () => {
    // Both are CATALOG rows. The discard-pile spelling is a different op entirely
    // (D234's anchor, 5 legal printings still owed); the ability spelling is 4
    // legal printings of THIS family that no reader may ever reach, because an
    // Ability is a hand-authored registry row forever.
    expect(deriveAttackEffect(DISCARD_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    expect(deriveAttackEffect(ABILITY_SIDE_NEAR_MISS)).toBeNull();
    expect(ABILITY_SIDE_NEAR_MISS).toContain("you may search your deck for");
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[SELF_BARE].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats. ⚠️ THE POOL HAS A REAL
      // ONE: `ABILITY_SIDE_NEAR_MISS` above.
      `Draw a card. ${bare}`,
      // 🛑 A TRAILING CLAUSE — the shape a `$`-only build eats, and here it is the
      // mutant that matters: with an OPTIONAL tail group on the anchor, dropping
      // `$` makes this derive with the clause silently thrown away. Constructed,
      // and said so — no printing in this family carries an unrecognised tail.
      `${bare} Draw a card.`,
      // Case, both ends.
      bare.replace("Search", "search"),
      bare.replace("Basic", "basic"),
      // The trailing period.
      bare.slice(0, -1),
      // The printed shuffle, which every card in the family prints and which the
      // trailing `shuffleDeck` op is.
      bare.replace(" Then, shuffle your deck.", ""),
      // 🛑 THE GRAMMATICAL CROSSES, which the pronoun weld exists to refuse: no
      // card prints either, and an `it|them` build would read both.
      "Search your deck for a Basic Energy card and attach them to this Pokémon. Then, shuffle your deck.",
      "Search your deck for up to 2 Basic Energy cards and attach it to this Pokémon. Then, shuffle your deck.",
      // A printed 0 would derive to a search that moves nothing and shuffles anyway.
      "Search your deck for up to 0 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      // …and past the shared ingested-text ceiling.
      "Search your deck for up to 11 Basic Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      // The DISCARD PILE, which is row 9's op (`attachEnergyFrom`).
      "Search your discard pile for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      // A destination the table does not name — the residue's own shape, and the
      // reason the phrase is a Map lookup rather than a `.+` the arm trusts.
      "Search your deck for a Basic Energy card and attach it to your opponent's Active Pokémon. Then, shuffle your deck.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Search your deck for a Basic {C} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      // A SPECIAL Energy — the noun is welded to "Basic", and `attachableEnergies`
      // could not honour the wider one anyway.
      "Search your deck for an Energy card and attach it to this Pokémon. Then, shuffle your deck.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("carries NO new op, and ONE new op FIELD — the honest price, D457's and D458's halves included", () => {
    // `attachFromDeck` has run since M5-D50 with every key any arm here sets
    // EXCEPT `oneTarget` (D457, the batch-onto-one-body coupling);
    // `shuffleDeck`, `recordGate` and `applyStatus` are all older still.
    // 🆕🆕 **D458 ADDS ZERO KEYS TO THIS LIST AND THIS RUNG IS THE PROOF, NOT THE
    // CLAIM.** The second printed noun is a second `attachFromDeck` op, so the
    // `known` map is unchanged and the loop below simply walks one program longer.
    // A build that reached for a `secondFilter`/`maxTwo` field instead would redden
    // here.
    // ⚠️ THE TITLE IS PART OF THE ASSERTION. D235's read "NO new op FIELD" and was
    // true when it was written; leaving it there while adding a key to the list
    // below would be a doc-block justification outliving its measurement (D425),
    // and the list is what the successor greps.
    const known: Record<string, readonly string[]> = {
      attachFromDeck: [
        "op",
        "filter",
        "max",
        "toSelf",
        "benchOnly",
        "targetType",
        "recordAs",
        "oneTarget",
      ],
      shuffleDeck: ["op"],
      recordGate: ["op", "slot", "then"],
    };
    for (const { program, text } of CLAUSES) {
      for (const op of program) {
        expect(Object.keys(known), text).toContain(op.op);
        for (const key of Object.keys(op)) expect(known[op.op], `${op.op}.${key}`).toContain(key);
      }
    }
  });

  it("the brace-coded destination is generated from POKEMON_TYPE_BY_CODE, not listed", () => {
    // ⚠️ THE MAP IS TOTAL OVER `POKEMON_TYPES` BY CONSTRUCTION — a type added to
    // the schema is admitted here without an edit. BOTH generated forms, because
    // this table carries the "in any way you like" spelling as well as the "1 of"
    // one, and the two land on opposite sides of the `batch` rule.
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(
          `Search your deck for a Basic Energy card and attach it to 1 of your {${code}} Pokémon. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1, targetType: type },
        { op: "shuffleDeck" },
      ]);
      expect(
        deriveAttackEffect(
          `Search your deck for up to 2 Basic Energy cards and attach them to your {${code}} Pokémon in any way you like. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2, targetType: type },
        { op: "shuffleDeck" },
      ]);
      // 🆕 D457 — …and the "1 of" form now COUPLES at the plural, generated rows
      // included: the `batch` rule is a property of the TABLE, not of five
      // hand-written rows, and so is the rider it now selects.
      expect(
        deriveAttackEffect(
          `Search your deck for up to 2 Basic Energy cards and attach them to 1 of your {${code}} Pokémon. Then, shuffle your deck.`,
        ),
        code,
      ).toEqual([
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy" },
          max: 2,
          targetType: type,
          oneTarget: true,
        },
        { op: "shuffleDeck" },
      ]);
    }
    // …and a code in NEITHER map is refused rather than silently dropped.
    expect(
      deriveAttackEffect(
        "Search your deck for a Basic Energy card and attach it to 1 of your {Z} Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries eight of the sentences at 35-42, and D458's at 72", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 35-42, appended and not inserted", () => {
    // 48 at D236, which appended 43-47 (attach from the HAND — this family's own
    // op one SOURCE ZONE and one op over); 43 at D235, which appended 35-42; 35 at
    // D234, 29 at D232, 25 at D231, 20 at
    // D230, 17 at D229, 14 at D228, 13 at D227, 9 at D189, 8 at D181. TEN slices,
    // ten appends, zero inserts — which is what every index constant in ten
    // suites depends on.
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
    expect(attacks()[ENERGY_ASSIST]?.effect).toBe(CLAUSES[SELF_BARE].text);
    expect(attacks()[ZAP_CHARGE]?.effect).toBe(CLAUSES[SELF_LIGHTNING].text);
    expect(attacks()[AQUA_SUPPLY]?.effect).toBe(CLAUSES[SELF_WATER_TWO].text);
    expect(attacks()[ENERGY_BOUNTY]?.effect).toBe(CLAUSES[ANY_WAY_THREE].text);
    expect(attacks()[BENCH_CHARGE]?.effect).toBe(CLAUSES[BENCH_ANY_WAY].text);
    expect(attacks()[TOXIC_RESERVE]?.effect).toBe(CLAUSES[POISON_TAIL].text);
    expect(attacks()[WATER_DRAW]?.effect).toBe(CLAUSES[ONE_OF_WATER].text);
    // 🆕🆕 D457 — the row that used to be *"the one that is DELIBERATELY
    // UNREAD, fielded so the refusal has a live subject"* (D181's `Strafe`
    // precedent). It is the same fixture bytes and it is now READ: `Split Supply`
    // prints CLAUSES[ONE_OF_TWO], so the live subject stopped serving a refusal
    // and started serving the coupling — see §3's end-to-end pair. **The fixture
    // did not move; what it demonstrates did.**
    expect(attacks()[SPLIT_SUPPLY]?.effect).toBe(CLAUSES[ONE_OF_TWO].text);
    // 🆕🆕 D458 — index 72, OUTSIDE the 35-42 block and deliberately so: the
    // append discipline is what every sibling suite's constants depend on, and a
    // family's rows do not have to be contiguous to be its rows.
    expect(attacks()[SPLIT_HARVEST]?.effect).toBe(CLAUSES[TWO_NOUNS].text);
    // ⚠️ …and index 71 still prints the sentence NO reader claims, which is
    // `optionalSelfSwitch.test.ts` §7's attribution-control subject. D458 appends
    // beside it rather than over it, and this rung is what would go red if a
    // successor "tidied" the two together.
    expect(deriveAttackEffect(attacks()[71]?.effect ?? "")).toBeNull();
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[34]?.effect).toBe(
      "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    );
  });

  it("NO printed base damage on any of the eight — stated, because it is MEASURED", () => {
    // All 28 legal printings in this family print a bare effect. Said out loud
    // because D229's identical omission is a deliberate DIVERGENCE from the
    // catalog, and a reader who learned the reason there would carry the wrong one
    // here.
    for (const index of [
      ENERGY_ASSIST,
      ZAP_CHARGE,
      AQUA_SUPPLY,
      ENERGY_BOUNTY,
      BENCH_CHARGE,
      TOXIC_RESERVE,
      WATER_DRAW,
      SPLIT_SUPPLY,
      SPLIT_HARVEST,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    // The round trip: the fixture strings are the CLAIM, so they are read back
    // through the deriver rather than compared to the constants alone. An arm
    // authored against a paraphrase passes a test written against the same
    // paraphrase and matches no real card (D183).
    expect(deriveAttackEffect(attacks()[TOXIC_RESERVE]?.effect ?? "")).toEqual(
      CLAUSES[POISON_TAIL].program,
    );
    // 🆕 D457 — the round trip on the sentence this slice built, off the
    // FIXTURE bytes rather than off the constant, which is the whole point of the
    // rung: an arm authored against a paraphrase would pass against the same
    // paraphrase and match no printed card.
    expect(deriveAttackEffect(attacks()[SPLIT_SUPPLY]?.effect ?? "")).toEqual(
      CLAUSES[ONE_OF_TWO].program,
    );
    // 🆕 D458 — the same round trip on the two-noun sentence, off the FIXTURE
    // bytes. This is the rung that would catch an arm written against a
    // paraphrase of the second noun (D183).
    expect(deriveAttackEffect(attacks()[SPLIT_HARVEST]?.effect ?? "")).toEqual(
      CLAUSES[TWO_NOUNS].program,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — where the Energy lands
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — an ATTACK searching its own deck for Energy", () => {
  it("the SELF target forces the DESTINATION and still asks WHICH card", () => {
    // ⚠️ THE PARK IS COMPOUND HERE, which is the structural difference from row
    // 9's `choosePokemon`: `toSelf` collapses the TARGET list to one ref, and the
    // question that remains is which cards leave the deck.
    const state = ready(3);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });

    const prompt = promptOf(parked);
    // 🛑 ONE TARGET, and it is the ATTACKER — the discriminator against a build
    // that dropped `toSelf`: with two Benched bodies on this board, THAT build
    // offers three.
    expect(prompt.targets).toEqual([ACTIVE_REF]);
    expect(prompt.max).toBe(2);
    // 🛑 AND THE TYPE FILTER BIT: the deck holds {C}, {L} and {D} too, and only
    // {W} was offered. A build that dropped `filter.energyType` offers the lot.
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set(["fix-water-energy"]));

    const { state: done, events } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: ACTIVE_REF },
      { uid: prompt.candidates[1] as string, to: ACTIVE_REF },
    ]);
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "active" });
    expect(done.players.p1.active?.energy).toHaveLength(3); // the {C} cost + two {W}
    expect(activeUid(done, "p1")).toBe(attacker);
    // …and the printed shuffle ran: the deck is the same size minus what moved.
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the BENCH-ONLY spread offers the Bench alone — the attacker is not a target", () => {
    const state = ready(5);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_CHARGE,
    });

    const prompt = promptOf(parked);
    // 🛑 THE ASSERTION THE `benchOnly` RIDER IS ABOUT: two Benched bodies, and the
    // ATTACKER — in play, the controller's, eligible under an un-narrowed set —
    // is absent.
    expect(prompt.targets).toHaveLength(2);
    for (const ref of prompt.targets) expect(ref.spot.spot).toBe("bench");
    expect(prompt.targets).not.toContainEqual(ACTIVE_REF);

    // …and "in any way you like" means the two cards may land APART, which is the
    // half of the printed phrase a per-target cap would forbid.
    const { state: done, events } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: benchRef(0) },
      { uid: prompt.candidates[1] as string, to: benchRef(1) },
    ]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(1); // the {C} cost, untouched
  });

  it("the un-narrowed spread offers the ATTACKER too, and all three may land on ONE body", () => {
    const state = ready(7);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENERGY_BOUNTY,
    });

    const prompt = promptOf(parked);
    expect(prompt.targets).toHaveLength(3);
    expect(prompt.targets).toContainEqual(ACTIVE_REF);
    expect(prompt.max).toBe(3);
    // 🛑 NO `maxPerTarget`: the printed "in any way you like" permits every card
    // on one Pokémon, and this is the board that says so.
    expect(prompt).not.toHaveProperty("maxPerTarget");
    const { state: done, events } = attach(
      parked,
      prompt.candidates.slice(0, 3).map((uid) => ({ uid, to: benchRef(0) })),
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(3);
  });

  it("🛑 the §9.2 TAIL poisons the attacker — and only when something attached", () => {
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TOXIC_RESERVE,
    });
    const prompt = promptOf(parked);
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set(["fix-darkness-energy"]));
    // ⚠️ THE PARK ANNOUNCES WHAT ITS ANSWER BUYS — `withConsequence` reads the
    // gate out of the queue and appends the clause. This is the FIRST attack
    // program in the pool to reach that describer, and it prices at zero because
    // the `self` arm of `applyStatus` was already written for Janine.
    expect(prompt.note).toContain("If you do, it is now Poisoned");

    const { state: done } = attach(parked, [
      { uid: prompt.candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(done.players.p1.active?.conditions.poisonDamage).toBeGreaterThan(0);
  });

  it("🛑 …and an EMPTY answer files nothing, so the gate does NOT poison", () => {
    // ⚠️ THE PAIR THAT MAKES THE GATE LOAD-BEARING. Same board, same attack, same
    // prompt — the player declines, `attachFromDeck` files an empty record, and
    // `recordGateHolds` reads false. A build that put the poison beside the attach
    // instead of behind the gate poisons here too, and passes the case above.
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TOXIC_RESERVE,
    });
    const { state: done, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the TAIL-LESS sibling never poisons, on the same board", () => {
    // The other direction of the same pair: Aqua Supply prints no §9.2 clause, so
    // a build that hard-wired the poison onto every `toSelf` batch fails here.
    const state = ready(9);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });
    const { state: done } = attach(parked, [
      { uid: promptOf(parked).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(done.players.p1.active?.energy).toHaveLength(2);
    expect(done.players.p1.active?.conditions.poisonDamage).toBe(0);
  });

  it("a deck with NO matching Energy is a silent whiff, not a refusal", () => {
    // 🛑 THE HALF THAT SEPARATES AN ATTACK FROM A CARD PLAY, and the reason
    // `programPlayable` prices at ZERO for this slice — twice over. §8: the attack
    // was declared and paid for, so a program that can do nothing still RESOLVES.
    // And `attachFromDeck` is deliberately UNGATED even on the card-play path
    // (cardplay.ts), because every carrier prints a shuffle, which always
    // resolves (ruling/284) — so unlike row 9's op the contrast is NOT a refusal.
    const state = ready(11);
    const emptied: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          deck: state.players.p1.deck.filter(
            (uid) => state.cardIdByUid[uid] !== "fix-water-energy",
          ),
        },
      },
    };
    deepFreeze(emptied);
    const { state: done, events } = mustApply(emptied, {
      type: "attack",
      seat: "p1",
      index: AQUA_SUPPLY,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // 🛑 AND THE CARD-PLAY GATE AGREES ON BOTH BOARDS, which is the measurement
    // rather than the assumption: this op is not in `programPlayable`'s list at
    // all, so an empty deck is still "playable".
    expect(programPlayable(emptied, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
    expect(programPlayable(state, CLAUSES[SELF_WATER_TWO].program, "p1")).toBe(true);
  });

  it("🆕🛑 D457 — the ONE-OF sentence parks, and BOTH cards may land on one body", () => {
    // The rung this replaces asserted the same board resolved to NOTHING, and it
    // was the refusal's live subject (D181's `Strafe` precedent). The subject did
    // not change — `Split Supply` is the same printed attack on the same
    // demonstrator over the same deck full of Basic Energy — only the verdict did.
    // ⚠️ **THE PARK IS THE FIRST HALF AND THE ANSWER IS THE SECOND**: a build
    // that read the sentence and dropped the coupling parks here too, so the
    // discriminating half is the pair of ANSWERS below, not the park.
    const state = ready(13);
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    const prompt = promptOf(parked);
    expect(prompt.oneTarget).toBe(true);
    expect(prompt.max).toBe(2);
    // ⚠️ THE OFFER IS NOT NARROWED BY THE RIDER, and that is the asymmetry with
    // `maxPerTarget`: one body may take the whole batch, so the board term never
    // reduces `max` (interpreter.ts `attachFromDeckOffer`). More than one target is
    // OFFERED — the constraint is on the ANSWER, not on the list.
    expect(prompt.targets.length).toBeGreaterThan(1);
    // …and the printed phrase is what the dialog says, not "in any way you like".
    expect(prompt.note).toContain("attach them to 1 of your Pokémon");
    expect(prompt.note).not.toContain("in any way you like");
    const [first, second] = prompt.candidates as [string, string];
    const { state: done, events: attached } = attach(parked, [
      { uid: first, to: benchRef(0) },
      { uid: second, to: benchRef(0) },
    ]);
    expect(all(attached, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy ?? []).toHaveLength(0);
  });

  it("🆕🛑 D457 — the SPLIT the card does not print is refused on the wire", () => {
    // The other direction of the same pair, and the one a build without the rider
    // cannot pass: two Energy off a card that prints "1 of" landing on two
    // different Pokémon. It is refused by `validateEffectChoice` (cardplay.ts),
    // which is where every other coupling on this prompt lives — the apply
    // re-derives none of them.
    const state = ready(13);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    const [first, second] = promptOf(parked).candidates as [string, string];
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: first, to: benchRef(0) },
            { uid: second, to: benchRef(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    // ⚠️ AND THE DECLINE IS STILL LEGAL — the rider caps the targets an answer
    // may NAME, and an empty answer names none. "Up to 2" includes none (§9.1),
    // so a build that read `oneTarget` as "exactly one" would break the printed
    // right to take fewer.
    const { state: declined, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(declined.phase.kind).not.toBe("effect:choose");
    // ⚠️ …and ONE card on one body is legal too, which is the other end of
    // "up to": the constraint is on distinct TARGETS, never on the count.
    const { state: one, events: oneEvents } = attach(parked, [{ uid: first, to: benchRef(1) }]);
    expect(all(oneEvents, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(one.players.p1.bench[1]?.energy).toHaveLength(1);
  });

  it("🆕🛑 D458 — the second printed noun asks TWICE, and the two searches are FILTERED apart", () => {
    // 🛑 **QUESTION 1, DRIVEN: TWO OPS MEANS TWO PARKS.** Every other sentence in
    // this family resolves ONE prompt, so a build that summed the two printed caps
    // into a single `max: 4` search passes every board in this file except this
    // one. The observable is that the second decision EXISTS — `derivedDiscardAttach`
    // §"asks TWICE" is the same assertion one op and one zone over.
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // PARK ONE is the FIRST printed noun, and only it: the deck holds {L} and {W}
    // too, so a build that dropped either `filter` offers them here.
    const grass = promptOf(parked);
    expect(new Set(idsOf(parked, grass.candidates))).toEqual(new Set(["fix-grass-energy"]));
    expect(grass.max).toBe(2);
    expect(grass.note).toContain("in any way you like");
    const { state: mid, events: firstEvents } = attach(parked, [
      { uid: grass.candidates[0] as string, to: benchRef(0) },
      { uid: grass.candidates[1] as string, to: benchRef(0) },
    ]);
    expect(all(firstEvents, "ENERGY_ATTACHED")).toHaveLength(2);
    // 🛑 **THE SECOND PARK. A one-op build has finished by now.**
    expect(mid.phase.kind).toBe("effect:choose");
    const lightning = promptOf(mid);
    expect(new Set(idsOf(mid, lightning.candidates))).toEqual(new Set(["fix-lightning-energy"]));
    expect(lightning.max).toBe(2);
    const { state: done, events: secondEvents } = attach(mid, [
      { uid: lightning.candidates[0] as string, to: benchRef(1) },
      { uid: lightning.candidates[1] as string, to: benchRef(1) },
    ]);
    expect(all(secondEvents, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    // 🛑 **QUESTION 2, DRIVEN: THE DESTINATION IS SHARED ACROSS THE TWO PARKS.**
    // The printed clause is one *"attach **them** to your Pokémon in any way you
    // like"*, and the two answers land on DIFFERENT bodies here — a distribution a
    // single park would also reach, and one that proves the second search is not
    // pinned to whatever the first chose.
    expect(idsOf(done, done.players.p1.bench[0]?.energy ?? [])).toEqual([
      "fix-grass-energy",
      "fix-grass-energy",
    ]);
    expect(idsOf(done, done.players.p1.bench[1]?.energy ?? [])).toEqual([
      "fix-lightning-energy",
      "fix-lightning-energy",
    ]);
    // ⚠️ …and FOUR cards left p1's deck and no more — the two printed caps, both
    // spent. Resolving the last park ends p1's turn, so the only other movement
    // §3 permits is p2's turn-start draw, which comes off the OTHER deck.
    expect(state.players.p1.deck.length - done.players.p1.deck.length).toBe(4);
  });

  it("🆕🛑 D458 — …and ALL FOUR may land on ONE body, which is the other end of the shared destination", () => {
    // The pair that makes the split load-bearing. Nothing about the sequential
    // model narrows the second park's targets, so the printed *"in any way you
    // like"* still reaches the all-on-one distribution across BOTH searches.
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    const grass = promptOf(parked);
    // ⚠️ The ACTIVE is offered on both parks — the destination is un-narrowed, so
    // `benchOnly` would show up here as a missing target rather than as a wrong
    // attach.
    expect(grass.targets).toContainEqual(ACTIVE_REF);
    const { state: mid } = attach(
      parked,
      grass.candidates.slice(0, 2).map((uid) => ({ uid, to: ACTIVE_REF })),
    );
    const lightning = promptOf(mid);
    expect(lightning.targets).toContainEqual(ACTIVE_REF);
    const { state: done } = attach(
      mid,
      lightning.candidates.slice(0, 2).map((uid) => ({ uid, to: ACTIVE_REF })),
    );
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
      "fix-grass-energy",
      "fix-lightning-energy",
      "fix-lightning-energy",
    ]);
    expect(done.players.p1.bench.every((b) => b.energy.length === 0)).toBe(true);
  });

  it("🆕🛑 D458 — a deck with ZERO of the SECOND type still resolves the FIRST", () => {
    // 🛑 **QUESTION 3, DRIVEN, AND NO NEW ZERO-SHAPE WAS ADDED.** `attachFromDeck`
    // has answered an empty candidate set since M5 by returning the board and
    // filing an empty §9.2 record (`interpreter.ts`, the dead end above
    // `attachFromDeckOffer`) — the same shape the "no matching Energy" rung above
    // drives on a ONE-noun sentence. The two-op program inherits it: the second
    // search whiffs, does not park, and the printed shuffle still runs.
    const state = withoutCard(readyTwoNoun(5), "fix-lightning-energy");
    expect(state.players.p1.deck.filter((u) => state.cardIdByUid[u] === "fix-grass-energy").length)
      .toBeGreaterThan(1);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    const grass = promptOf(parked);
    expect(new Set(idsOf(parked, grass.candidates))).toEqual(new Set(["fix-grass-energy"]));
    const { state: done, events } = attach(
      parked,
      grass.candidates.slice(0, 2).map((uid) => ({ uid, to: benchRef(0) })),
    );
    // 🛑 THE WHOLE POINT: ONE park, and the attack FINISHES. A build that parked
    // on an empty second search would hang the turn on a prompt with no candidates.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
  });

  it("🆕🛑 D458 — …and ZERO of the FIRST type does not stop the SECOND", () => {
    // The mirror, and the one a build that ran the searches in the wrong order — or
    // that abandoned the program on the first whiff — cannot pass. The FIRST search
    // has nothing to offer, so the FIRST park is the {L} one.
    const state = withoutCard(readyTwoNoun(5), "fix-grass-energy");
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const lightning = promptOf(parked);
    expect(new Set(idsOf(parked, lightning.candidates))).toEqual(new Set(["fix-lightning-energy"]));
    const { state: done } = attach(parked, [
      { uid: lightning.candidates[0] as string, to: benchRef(1) },
    ]);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(idsOf(done, done.players.p1.bench[1]?.energy ?? [])).toEqual(["fix-lightning-energy"]);
  });

  it("🆕🛑 D458 — a deck with NEITHER type is a silent whiff on BOTH searches", () => {
    // The zero-shape at its far end: no park at all, no `ATTACK_EFFECT_SKIPPED`
    // (the sentence IS read — that row is the loud path for a sentence no reader
    // claims), and the attack still resolves because §8 already paid for it.
    const state = withoutCard(
      withoutCard(readyTwoNoun(7), "fix-grass-energy"),
      "fix-lightning-energy",
    );
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
  });

  it("the search is the ATTACKER's own deck and own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's deck, or attached on their side, would pass every count
    // assertion above. Both zones are named.
    const state = ready(15);
    const opponentDeck = state.players.p2.deck.length;
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENERGY_BOUNTY,
    });
    for (const ref of promptOf(parked).targets) expect(ref.seat).toBe("p1");
    for (const uid of promptOf(parked).candidates) {
      expect(state.players.p1.deck).toContain(uid);
    }
    const { state: done } = attach(parked, [
      { uid: promptOf(parked).candidates[0] as string, to: ACTIVE_REF },
    ]);
    // ⚠️ EXACTLY ONE card left p2's deck and it is the TURN-START DRAW: resolving
    // the last park finishes the attack, which ends the turn. Asserted as the
    // number rather than skipped, because "the opponent's deck did not move" is
    // the claim and 1 is the only movement §3 permits here.
    expect(opponentDeck - done.players.p2.deck.length).toBe(1);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 🆕🆕 D457 — `MATCH_RECORD_VERSION` 29, DRIVEN OVER THE SERIALIZED BYTES
// ─────────────────────────────────────────────────────────────────────────────

describe("🆕🆕 D457 §4 — `MATCH_RECORD_VERSION` STAYS 29, driven over the SERIALIZED BYTES", () => {
  it("🛑 the version PREDICTION in THREE directions, LOSS included", () => {
    // 🛑 **WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED (D386/D443).** D456
    // held 29 on `match.ts`'s discriminator because its field was a `GameState` one,
    // and explicitly NOT on *"an `EffectOp` reaches storage only through a park"*.
    // **THIS SLICE IS THE PARK CASE, AND THE PARK IS NOT A REASON TO SKIP THE
    // QUESTION — IT IS THE ROAD TO STORAGE.** `attachFromDeck.oneTarget` rides
    // `EffectContinuation.pendingOp` and `attachCards.oneTarget` rides the persisted
    // `effect:choose` phase, so BOTH addresses are in a saved record and the
    // discriminator is the same one either way: *does the OLD byte string still mean
    // what it meant?*
    const state = ready(13);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_SUPPLY,
    });
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const prompt = parked.phase.prompt;
    const [first, second] = prompt.candidates as [string, string];
    const split = [
      { uid: first, to: benchRef(0) },
      { uid: second, to: benchRef(1) },
    ];

    // **DIRECTION 1 — BACKWARD: a v29 record written BEFORE this slice.** Every
    // `attachCards` park a v29 deploy could write carries NO `oneTarget`, and its
    // absence has to keep meaning exactly "in any way you like". ⚠️ THE LITERAL BYTES
    // ARE PARSED RATHER THAN THE OBJECT SPREAD, because a spread that dropped a key
    // and a wire that never had one are the same object and NOT the same claim.
    const v29 = JSON.parse(
      JSON.stringify(prompt, (k, v) => (k === "oneTarget" ? undefined : v)),
    ) as Extract<EffectPrompt, { kind: "attachCards" }>;
    expect(Object.keys(v29)).toEqual(["kind", "candidates", "targets", "max", "note"]);
    const legacy: GameState = { ...parked, phase: { ...parked.phase, prompt: v29 } };
    const { state: spread } = mustApply(legacy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: split },
    });
    expect(spread.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(spread.players.p1.bench[1]?.energy).toHaveLength(1);

    // **DIRECTION 2 — FORWARD: the bytes this deploy writes, whole and round-tripped.**
    // The key set is asserted rather than eyeballed — "the object looked right" is how
    // a key goes missing — and the wire spells `true` and never `false`, the schema's
    // `z.literal(true).optional()` read back off the engine side.
    const wire = JSON.stringify(prompt);
    expect(wire).toContain('"oneTarget":true');
    expect(wire).not.toContain('"oneTarget":false');
    expect(Object.keys(prompt)).toEqual([
      "kind",
      "candidates",
      "targets",
      "max",
      "oneTarget",
      "note",
    ]);
    const round = JSON.parse(wire) as Extract<EffectPrompt, { kind: "attachCards" }>;
    const revived: GameState = { ...parked, phase: { ...parked.phase, prompt: round } };
    expectErr(
      revived,
      { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments: split } },
      "BAD_EFFECT_CHOICE",
    );

    // **DIRECTION 3 — LOSS: a build (or an older deploy) that DROPS the key.** The
    // degradation is a RELAXATION and not a corruption — the answer is accepted, the
    // Energy attach, nothing is `NaN` and no body becomes un-Knock-Outable (D435's
    // failure, the reason an optional key is safe here). Direction 1 IS that state, so
    // the behaviour is already driven above; what this half adds is D421's criterion:
    // **is losing the key DETECTABLE?**
    //
    // 🛑 **IT IS, AND THE DETECTOR IS THE REST OF THE RECORD.** `note` is built from
    // the SAME field (`attachFromDeckNote` branches on `op.oneTarget`), so a park whose
    // note says *"attach them to 1 of your Pokémon"* while carrying no rider is a byte
    // string this deploy cannot write — the two halves would have to disagree at the
    // moment of writing. A reader who finds one has found the dropped key.
    expect(v29.note).toContain("attach them to 1 of your Pokémon");
    expect(v29).not.toHaveProperty("oneTarget");
    expect(round.note).toBe(v29.note);

    // …and the converse, MEASURED over the whole corpus rather than asserted: every
    // `attachFromDeck` this deploy can derive whose printed sentence spells the plural
    // "1 of" carries the rider, and every one that does not spell it does not.
    let coupled = 0;
    for (const [, text] of legalAttackCorpus()) {
      for (const op of deriveAttackEffect(text) ?? []) {
        if (op.op !== "attachFromDeck") continue;
        const printed = text.includes("attach them to 1 of your");
        expect(op.oneTarget === true, text).toBe(printed);
        if (printed) coupled++;
      }
    }
    expect(coupled).toBe(2);
    // …and NO registry row authors the field at all, so the reader is its only
    // producer and the corpus sweep above is the whole population (D135's rule: these
    // programs are compared by value against hand-authored ones).
    for (const id of registryCardIds()) {
      for (const program of Object.values(programFor(id)?.attack ?? {})) {
        for (const op of program) {
          if (op.op === "attachFromDeck") expect(op.oneTarget, id).toBeUndefined();
        }
      }
    }
  });

  it("🆕🛑 D458 — `MATCH_RECORD_VERSION` STAYS 29 for the TWO-PARK continuation, driven over the bytes", () => {
    // 🛑 **WHICH SITUATION THIS IS, RE-DERIVED AND NOT INHERITED.** D457 held 29
    // for a PARK carrying a new optional key. **D458 adds no key anywhere**: zero
    // new op fields, zero new prompt fields, zero new phase keys. What is new in a
    // saved record is that `EffectContinuation.rest` holds a SECOND
    // `attachFromDeck` — a LONGER list of ops the union already spelled, not a
    // wider one — and that shape is not new either: `deriveAttackEffect`'s
    // discard-attach arm has written N sequential `attachEnergyFrom` ops into one
    // continuation since D234. **A v29 reader parsing this record meets no token it
    // did not already have to understand.**
    const state = readyTwoNoun(3);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLIT_HARVEST,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = parked.phase.cont;

    // **DIRECTION 1 — FORWARD: the bytes this deploy writes.** The pending op is
    // the FIRST printed noun and the SECOND is queued in `rest` beside the printed
    // shuffle. Key sets are asserted rather than eyeballed: "the object looked
    // right" is how a key goes missing.
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(cont.pendingOp).toEqual({
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Grass" },
      max: 2,
    });
    expect(cont.rest).toEqual([
      { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2 },
      { op: "shuffleDeck" },
    ]);
    // ⚠️ NO `oneTarget` ANYWHERE IN THE RECORD — this destination is *"in any way
    // you like"*, so a v29 record written by this program is byte-identical in
    // vocabulary to one a pre-D457 deploy could write.
    const wire = JSON.stringify(cont);
    expect(wire).not.toContain("oneTarget");
    expect(wire).not.toContain("recordAs");

    // **DIRECTION 2 — BACKWARD / ROUND TRIP: the record parsed back and resumed.**
    // The bytes are PARSED rather than the object spread, because a spread that
    // preserved a key and a wire that carried one are the same object and not the
    // same claim.
    const revived: GameState = {
      ...parked,
      phase: { ...parked.phase, cont: JSON.parse(wire) as typeof cont },
    };
    const grass = promptOf(revived);
    const { state: mid } = attach(revived, [{ uid: grass.candidates[0] as string, to: ACTIVE_REF }]);
    expect(mid.phase.kind).toBe("effect:choose");
    const { state: done } = attach(mid, [
      { uid: promptOf(mid).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(idsOf(done, done.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
      "fix-lightning-energy",
    ]);

    // **DIRECTION 3 — LOSS, AND THE ANSWER IS THE UNCOMFORTABLE ONE.** There is no
    // optional rider to drop here, so the loss to test is a record whose `rest`
    // lost its second op. It degrades into a sentence the catalog DOES print (the
    // single-noun {G} search, corpus line 405-shaped) and:
    //
    // 🛑 **IT IS NOT DETECTABLE FROM THE RECORD.** Nothing else in the frame is
    // built from the op list — there is no `note` twin the way `oneTarget` has one
    // (D457 §4), because the second search's caption is only written when its park
    // is. **That is an argument FOR having added no optional key rather than a
    // defect in this one**: D421's rule is to choose the rest of the record so that
    // losing the new information is detectable, and the shape that satisfies it
    // here is the shape with nothing losable in it. A truncated `rest` is data
    // corruption, which no `MATCH_RECORD_VERSION` protects against and which this
    // slice does not make newly possible.
    const truncated: GameState = {
      ...parked,
      phase: { ...parked.phase, cont: { ...cont, rest: [{ op: "shuffleDeck" as const }] } },
    };
    const { state: short } = attach(truncated, [
      { uid: promptOf(truncated).candidates[0] as string, to: ACTIVE_REF },
    ]);
    expect(short.phase.kind).not.toBe("effect:choose");
    expect(idsOf(short, short.players.p1.active?.energy ?? [])).toEqual([
      "fix-energy",
      "fix-grass-energy",
    ]);
    // …and "not detectable from the record" stated as an ASSERTION rather than as
    // prose: the PROMPT — the half a client renders and a log row quotes — is
    // byte-identical in the truncated record and the whole one. Everything a reader
    // could compare the op list against says the same thing in both.
    expect(JSON.stringify(truncated.phase)).not.toBe(JSON.stringify(parked.phase));
    if (truncated.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.stringify(truncated.phase.prompt)).toBe(JSON.stringify(parked.phase.prompt));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 🆕🆕 D458 — THE VERSION PINS
// ─────────────────────────────────────────────────────────────────────────────

describe("🆕🆕 D458 §5 — the engine version moved and the record version did not", () => {
  it("engineVersion is 0.400.0 and `manifest.version` agrees", () => {
    // 🛑 **THE PIN THIS SLICE AUTHORS**, which is the one every version-tax note in
    // this repo has forgotten to count (D427's mechanism): a slice counts the pins
    // it INHERITED and never the one it is about to write. 34 assertions existed
    // before this line; there are 35 after it.
    //
    // ⚠️ **THE BUMP IS OWED BECAUSE BEHAVIOUR MOVED.** A sentence that derived to
    // `null` at 0.356.0 derives to a three-op program at 0.357.0. It is owed for
    // that alone — no new op, no new field and no new prompt key were spent, so a
    // reader looking for a vocabulary diff would find none and conclude wrongly.
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
    // …and the historical values never come back, the shape every sibling pin uses.
    expect(engineVersion).not.toBe("0.355.0");
    expect(engineVersion).not.toBe("0.356.0");
  });
});
