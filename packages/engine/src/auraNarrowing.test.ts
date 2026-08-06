import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { seatPreWRDamageBonus } from "./continuous";
import type { CardFilter } from "./effects";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./index";
import {
  AURA_NARROWING_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.160.0 → 0.161.0 — D245, BACKLOG ROW 14-B(b)-R: THE AURA FAMILY'S THREE
// DEFERRED SINGLES, AND THE FOURTH SENTENCE ONE OF THEM UNLOCKS.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RE-DERIVATION — the row's 3 hold, and the FIELD's query returns 6.
// ─────────────────────────────────────────────────────────────────────────────
//
// Row 14-B(b)-R says **3** = 0 · 3 · 0 and prices them as "1 `CardFilter`
// disjunction · 1 `typedPokemon.stage` widening · 1 TARGET-side narrowing". The
// resume point wrote the prediction down: *"the count re-derives at 3 on 3
// sentences; the arm count is ZERO; `BUILT.ability` 114 → 117; `row14Unbuilt`
// 13 → 10; no `MATCH_RECORD_VERSION` bump"*, and flagged *"three sentences, three
// singles"* as the clause most likely to lose.
//
// The query, re-run against the remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a) over MCP on 2026-08-06, GROUPED BY
// SENTENCE and swept across ALL THREE text columns (`abilities_json`,
// `attacks_json`, `effect`) with `legal_standard = 1`:
//
//   WITH t AS (SELECT c.id, c.legal_standard AS ls, 'ability' AS col,
//                     json_extract(v.value,'$.effect') AS txt
//                FROM cards c, json_each(COALESCE(c.abilities_json,'[]')) v
//              UNION ALL …attacks_json… UNION ALL …effect…)
//   SELECT col, txt, COUNT(*), GROUP_CONCAT(id) FROM t
//    WHERE ls = 1 AND lower(txt) LIKE '%attacks used by your%more damage%'
//    GROUP BY col, txt;
//
// ✅ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE TWELFTH ROW RUNNING**: the three
// singles are 1 · 1 · 1 on three distinct sentences, exactly the three ids the row
// names (`sv09-007`, `sv08-021`, `sv07-038`).
//
// 🛑 **AND THE FLAGGED CLAUSE LOSES, ON AN AXIS THE FLAG DID NOT NAME.** The
// prediction's warning was that another printing of THESE sentences would turn up.
// None did. What turned up instead is another sentence of one of the FIELDS: run
// `typedPokemon.stage`'s own query rather than the aura's —
//
//   …WHERE ls = 1 AND lower(txt) LIKE '%evolution {%' GROUP BY col, txt;
//     → ability · "…your Evolution {R} Pokémon do 10 more damage…"        1
//     → ability · "…up to 2 Evolution {M} Pokémon, reveal them…"          3
//
// — and the second is Genesect ex "Metallic Signal" (`sv10.5b-067`/`-161`/`-169`),
// a DECK SEARCH with no aura in it at all. 🆕 **A ROW IS A SET OF IDS, AN OP FIELD
// IS A SET OF SENTENCES, AND A FIELD *VALUE* IS A SET OF MECHANISMS.** D244 widened
// from ids to a PRONOUN and stayed inside one op; widening from ids to a FIELD
// VALUE crosses ops, and that is where the extra 3 came from. `BUILT.ability` is
// **120**, not the predicted 117, re-derived by `programFor` over all 376 legal
// ability units.
//
// 🛑 **AND `row14Unbuilt` 13 → 10 IS A CLEAN LOSS ON A PREMISE.** It stands at
// **13**. The three singles were never rows of `ROW_14_ABILITY_GROUPS` — that table
// holds row 14 proper plus 14-B(a)/(b), and 14-B(b)-R is a separate doc row that
// no census constant tracked. **A PREDICTION ABOUT A CONSTANT MUST NAME THE TABLE
// THE CONSTANT IS COMPUTED FROM**, which this one did not.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE `needs` CLAIMS, GRADED. Two right, one wrong, and the wrong one is
// wrong in the most interesting available way.
// ─────────────────────────────────────────────────────────────────────────────
//
//   1. ✅ *"a `CardFilter` disjunction … `CardFilter` cannot spell it (it is a flat
//      union, not a combinator)"* — exact. `anyOf` is the union's first combinator
//      and its first member whose payload is `CardFilter` itself.
//   2. ✅ *"`typedPokemon.stage` admits only `"basic"` where `ownerPokemon.stage`
//      admits both, so the two stage riders disagree by construction and one of
//      them is wrong"* — exact, AND it names the right one as wrong. D238's union
//      comment asserted *"There is no `"evolution"` value here … **no printing
//      spells one** (measured over all 3,786 catalog rows)"*, and the query above
//      returns two sentences that do. 🆕 **A "NO PRINTING SPELLS THIS" IS A COUNT
//      WITH A ZERO IN IT AND IT ROTS LIKE ANY OTHER COUNT ON THIS PAGE.**
//   3. 🛑 *"narrows the TARGET … i.e. `damageBonusBeforeWRIfTarget`'s seam (which
//      stores a `PokemonSuffix`, not a stage)"* — **the parenthesis is right and
//      the seam is wrong.** `damageBonusBeforeWRIfTarget` is folded by
//      `passivesOf(attacker)`: it is a HOLDER passive, so its source and its
//      beneficiary are one body (Choice Belt, attached to the attacker). Primal
//      Knowledge is printed on a Carracosta that need not be attacking and pays
//      every body the seat owns. It can only live on the seat-SCANNED field, as a
//      `target` rider beside `beneficiary`. 🆕 **A `needs` COLUMN CAN NAME A REAL
//      FIELD, DESCRIBE ITS PAYLOAD CORRECTLY, AND STILL BE WRONG — BECAUSE THE
//      FIELD IT NAMES IS ON THE OTHER SIDE OF A FOLD.** The `needs` scoreboard is
//      now D242 wrong-about-a-card, D243 right, D244 right on all three, D245 two
//      of three.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE READ SITES, PRICED BY GREPPING THE FUNCTION (the score was 1-1-0; now 2-1-0).
// ─────────────────────────────────────────────────────────────────────────────
//
//   1. `matchesFilter` (cards.ts) — **NON-ZERO, twice.** One new arm (`anyOf`, the
//      only recursive one in the switch) and one CHANGED arm: `typedPokemon`'s
//      stage line was `filter.stage === undefined || isBasicPokemon(card)`, which
//      answers "is it Basic?" to a filter that now says "evolution". It is
//      `ownerPokemon`'s ternary byte for byte, which is the point — the two riders
//      DISAGREED and now cannot.
//   2. `retrieveNoun` (interpreter.ts) — **NON-ZERO, twice, and the resume point
//      was right that nobody prices the describers.** One new arm and one changed
//      noun (`"Basic "` unconditional → the printed stage word).
//   3. `seatPreWRDamageBonus` (continuous.ts) — one optional parameter and one
//      guard. Optional is what keeps every pre-D245 caller byte-identical.
//   4. `attackerPreWRBonus` (interpreter.ts) — one argument. **ZERO signature
//      diff**, because `defenderCard` has been its fourth parameter since Choice
//      Belt; both damage sites take a zero diff for the second slice running.
//   5. `energyNoun` (interpreter.ts) — **ZERO, and it is a fall-through rather
//      than an omission**: it spells two kinds and returns "Energy" for the rest,
//      so a filter that is not an Energy filter was already handled.
//   6. `matchesAttached` / `attachEnergyTargets` / `subgroupRefs` /
//      `conditionHolds` — **ZERO, all four, measured by `tsc`.** None switches
//      exhaustively on `CardFilter["kind"]`; they delegate to `matchesFilter` or
//      read one member by name. The resume point named all four as sites to price
//      and all four owe nothing, which is why they are listed rather than omitted.
//   7. `BENCHABLE_RETRIEVAL_KINDS` (effects.ts) — **ZERO, and deliberately so.**
//      `anyOf` is not in the set: no printed sentence benches a disjunction, and a
//      set membership added speculatively is the mistake that set exists to catch.
//   8. `MATCH_RECORD_VERSION` — **NO BUMP, measured.** Three catalog predicates
//      re-read from the board and one registry program; nothing here is persisted.
//
// ⚠️ **THE DERIVER ARM COUNT IS ZERO AND THAT PART OF THE PREDICTION HELD.**
// `TYPED_NOUN` still spells `(?:a )?(Basic )?\{X\} (Pokémon|Energy cards?)`; both
// "Evolution {X}" sentences are ABILITIES and this repo has no ability deriver, so
// widening the pattern would be an arm no sentence drives.

const SUNNY_DAY_TEXT =
  "Attacks used by your {G} Pokémon and {R} Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const VICTORY_CHEER_TEXT =
  "Attacks used by your Evolution {R} Pokémon do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
const PRIMAL_KNOWLEDGE_TEXT =
  "Attacks used by your Pokémon do 30 more damage to your opponent's Active Evolution Pokémon (before applying Weakness and Resistance).";
const METALLIC_SIGNAL_TEXT =
  "Once during your turn, you may search your deck for up to 2 Evolution {M} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";

const SEED = 43;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup on P1's turn 3 (two passes past the §4 first-turn ban), both benches
    emptied and both Active spots normalised to the inert `fix-basic-1`, so every
    board below is exactly what its own surgeries put on it. */
function board(): GameState {
  let state = driveSetup(
    SEED,
    { p1: AURA_NARROWING_DECK, p2: AURA_NARROWING_DECK },
    { first: "p1" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

/** P1 attacks with `attacker`; `benched` aura sources sit on P1's Bench beside it.
    `defender` is P2's Active. One Energy attached — every attack here costs one. */
function attacking(attacker: string, defender: string, ...benched: string[]): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p2", defender), "p2");
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const id of benched) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The damage P1's Active actually deals, off a real declaration. Every attacker
    in this cast prints a base of 50, so the delta from 50 IS the aura. */
function dealt(state: GameState): number | undefined {
  const hit = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  return find(hit.events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SIX REGISTRY ROWS — four programs, three narrowings, one search.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — the six registry rows", () => {
  it("authors `sv09-007` as a DISJUNCTION beneficiary and nothing else", () => {
    const program = programFor("sv09-007");
    expect(program?.passive).toEqual({
      seatDamageBonusBeforeWR: {
        amount: 20,
        beneficiary: {
          kind: "anyOf",
          filters: [
            { kind: "typedPokemon", pokemonType: "Grass" },
            { kind: "typedPokemon", pokemonType: "Fire" },
          ],
        },
      },
    });
    // 🛑 NOT the holder field, and not a `target`. A build reaching for
    // `damageBonusBeforeWR` would pass every board on which the Lilligant itself
    // attacks — which, because Lilligant IS a {G} body, is most of them.
    expect(program?.passive?.damageBonusBeforeWR).toBeUndefined();
    expect(program?.passive?.seatDamageBonusBeforeWR?.target).toBeUndefined();
  });

  it('authors `sv08-021` at `typedPokemon.stage: "evolution"`', () => {
    expect(programFor("sv08-021")?.passive?.seatDamageBonusBeforeWR).toEqual({
      amount: 10,
      beneficiary: { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
    });
  });

  it("authors `sv07-038` on the TARGET side — the seam the row got wrong", () => {
    const aura = programFor("sv07-038")?.passive?.seatDamageBonusBeforeWR;
    expect(aura).toEqual({ amount: 30, target: { kind: "evolutionPokemon" } });
    // 🛑 THE NEGATIVE THE BACKLOG ROW MAKES NECESSARY. It priced this printing at
    // `damageBonusBeforeWRIfTarget`, which is a HOLDER passive folded by
    // `passivesOf(attacker)`. Authoring it there would be green on every board
    // where the Carracosta attacks and silent on every board it is played for.
    expect(programFor("sv07-038")?.passive?.damageBonusBeforeWRIfTarget).toBeUndefined();
    // …and `beneficiary` is ABSENT, not a redundant `anyPokemon`: the printed
    // subject really is "your Pokémon", i.e. no narrowing at all on that end.
    expect(aura?.beneficiary).toBeUndefined();
  });

  it("authors all THREE `sv10.5b` Genesect printings — the sentence no backlog row names", () => {
    for (const id of ["sv10.5b-067", "sv10.5b-161", "sv10.5b-169"]) {
      expect(programFor(id)?.abilities, id).toEqual([
        {
          name: "Metallic Signal",
          oncePerTurn: true,
          activeOnly: false,
          program: [
            {
              op: "searchDeck",
              filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
              dest: "hand",
              max: 2,
              reveal: true,
            },
            { op: "shuffleDeck" },
          ],
        },
      ]);
    }
  });

  it("the six are SIX, and the FIVE printings the family still cannot reach are named", () => {
    const shipped = [
      "sv09-007",
      "sv08-021",
      "sv07-038",
      "sv10.5b-067",
      "sv10.5b-161",
      "sv10.5b-169",
    ];
    expect(new Set(shipped).size).toBe(6);
    for (const id of shipped) expect(programFor(id), id).toBeDefined();
    // The `Future` group, still blocked on the INGEST rather than the engine — and
    // asserted UNBUILT beside the positives off the SAME field, so the pair can
    // only both pass if this slice built exactly the narrowings a column answers.
    for (const id of ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-sunnyday"]?.abilities?.[0]?.effect).toBe(SUNNY_DAY_TEXT);
    expect(FIXTURE_POOL["fix-victorycheer"]?.abilities?.[0]?.effect).toBe(VICTORY_CHEER_TEXT);
    expect(FIXTURE_POOL["fix-primalknowledge"]?.abilities?.[0]?.effect).toBe(PRIMAL_KNOWLEDGE_TEXT);
    // …and each maps to the SAME program object as its real printing, so every
    // board below tests the authored row and not a fixture-only copy.
    expect(programFor("fix-sunnyday")).toBe(programFor("sv09-007"));
    expect(programFor("fix-victorycheer")).toBe(programFor("sv08-021"));
    expect(programFor("fix-primalknowledge")).toBe(programFor("sv07-038"));
    expect(FIXTURE_POOL["fix-metallicsignal"]?.abilities?.[0]?.effect).toBe(METALLIC_SIGNAL_TEXT);
    expect(programFor("fix-metallicsignal")).toBe(programFor("sv10.5b-067"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. THE PROMPT — and it exists because a mutant SURVIVED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — the search prompt reads the printed STAGE WORD", () => {
  // 🛑 THIS BLOCK IS A REPAIR, NOT A FLOURISH. The first full corpus run left
  // `D245-evolution-noun-reads-basic` ALIVE: `retrieveNoun`'s new stage word was
  // authored, typechecked, and read by no board, so a build captioning an
  // "Evolution {M}" search as "up to 2 Basic Metal Pokémon" — the exact COMPLEMENT
  // of the set it then offers — passed the whole suite. 🆕 **A DESCRIBER ARM IS
  // ONLY BUILT WHEN A BOARD READS IT**, and the three aura printings could never
  // supply one: a PASSIVE parks nothing. The 3 printings the widened query found
  // are what make this line drivable at all — the same shape as D244's seventh.

  it("captions the offer with the PRINTED stage, not with `basicPokemon`'s", () => {
    const state = clearBench(setActiveFromDeck(board(), "p1", "fix-metallicsignal"), "p1");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Metallic Signal",
    });
    const phase = parked.phase;
    if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected a chooseCards park, got ${phase.kind}`);
    }
    expect(phase.prompt.note).toBe(
      "Search your deck for up to 2 Evolution Metal Pokémon into your hand.",
    );
    // …and the OFFER agrees with the caption: every candidate is an Evolution {M}
    // body, and the Basic {M} bodies in the same deck are absent. A caption and an
    // offer that disagree is the defect the mutant installs.
    expect(phase.prompt.candidates.length).toBeGreaterThan(0);
    const offered = new Set(phase.prompt.candidates.map((uid) => parked.cardIdByUid[uid]));
    expect([...offered]).toEqual(["fix-metal-stage1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `anyOf` — the union's first COMBINATOR, at `matchesFilter`.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — `CardFilter.anyOf`", () => {
  const GRASS_OR_FIRE: CardFilter = {
    kind: "anyOf",
    filters: [
      { kind: "typedPokemon", pokemonType: "Grass" },
      { kind: "typedPokemon", pokemonType: "Fire" },
    ],
  };

  it("🛑 admits a body in EITHER arm — the printed 'and' is a UNION", () => {
    // THE CASE THE WHOLE MEMBER EXISTS FOR. A `{G}`-only body and a `{R}`-only
    // body are both inside "your {G} Pokémon and {R} Pokémon"; an intersection
    // reading (`.every`) refuses both, and the Standard pool holds NO dual
    // Grass/Fire body, so that reading would make the aura pay nobody.
    expect(matchesFilter(FIXTURE_POOL["fix-grass-attacker"], GRASS_OR_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], GRASS_OR_FIRE)).toBe(true);
  });

  it("REFUSES a body in neither arm — it is not `anyPokemon` in disguise", () => {
    // `fix-plain-body` is printed Colorless. Without this the combinator would be
    // indistinguishable from a filter that admits every Pokémon.
    expect(matchesFilter(FIXTURE_POOL["fix-plain-body"], GRASS_OR_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-plain-body"], { kind: "anyPokemon" })).toBe(true);
  });

  it("RECURSES — an arm may itself carry a rider, and the rider is honoured", () => {
    const evolutionFireOrGrass: CardFilter = {
      kind: "anyOf",
      filters: [
        { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
        { kind: "typedPokemon", pokemonType: "Grass", stage: "evolution" },
      ],
    };
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], evolutionFireOrGrass)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], evolutionFireOrGrass)).toBe(true);
    // The BASIC {R} body is in the type arm and out of the stage rider, so this is
    // the board that proves the recursion carries the whole inner filter and not
    // just its `kind`.
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], evolutionFireOrGrass)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], GRASS_OR_FIRE)).toBe(true);
  });

  it("an EMPTY list names the EMPTY set, which is what `.some` says", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-grass-attacker"], { kind: "anyOf", filters: [] })).toBe(
      false,
    );
  });

  it("a dangling uid is still FALSE — the top-of-function guard, not the arm", () => {
    expect(matchesFilter(undefined, GRASS_OR_FIRE)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. `typedPokemon.stage: "evolution"` — the value D238 measured as unprinted.
// ─────────────────────────────────────────────────────────────────────────────

describe('D245 — `typedPokemon.stage` admits `"evolution"`', () => {
  const EVOLUTION_FIRE: CardFilter = {
    kind: "typedPokemon",
    pokemonType: "Fire",
    stage: "evolution",
  };
  const BASIC_FIRE: CardFilter = { kind: "typedPokemon", pokemonType: "Fire", stage: "basic" };
  const ANY_FIRE: CardFilter = { kind: "typedPokemon", pokemonType: "Fire" };

  it("🛑 the three readings are THREE DIFFERENT SETS on one pair of bodies", () => {
    // The case that separates the widened arm from the old one. Before D245 the
    // stage line read `stage === undefined || isBasicPokemon(card)`, so
    // EVOLUTION_FIRE and BASIC_FIRE were the SAME predicate and this block's first
    // two rows would both be false.
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], EVOLUTION_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], EVOLUTION_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], BASIC_FIRE)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], BASIC_FIRE)).toBe(true);
    // …and the unmarked filter admits both, which is what makes the rider a rider.
    expect(matchesFilter(FIXTURE_POOL["fix-fire-stage1"], ANY_FIRE)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-victorycheer"], ANY_FIRE)).toBe(true);
  });

  it("the TYPE conjunct still binds — an Evolution of the wrong type is refused", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-grass-stage1"], EVOLUTION_FIRE)).toBe(false);
    expect(
      matchesFilter(FIXTURE_POOL["fix-grass-stage1"], {
        kind: "typedPokemon",
        pokemonType: "Grass",
        stage: "evolution",
      }),
    ).toBe(true);
  });

  it("🆕 the TWO STAGE RIDERS now AGREE, which is what the row asked to be checked", () => {
    // Backlog row 14-B(b)-R: "the two stage riders already disagree by
    // construction and one of them is wrong — grep both and say which before
    // widening either." `ownerPokemon` was right; `typedPokemon` was the wrong
    // one. On every body in this pool the two now answer the same question about
    // the stage, which is asserted rather than narrated.
    for (const id of ["fix-fire-stage1", "fix-victorycheer", "fix-grass-stage1", "fix-basic-1"]) {
      const card = FIXTURE_POOL[id];
      const isEvolution = card?.evolveFrom !== undefined && card.evolveFrom !== null;
      expect(matchesFilter(card, { kind: "evolutionPokemon" }), id).toBe(isEvolution);
      // The typed rider agrees with the bare `evolutionPokemon` member wherever the
      // type matches — the same "agree by construction" claim `ownerPokemon`'s
      // doc-comment already makes for its own stage word.
      const typed: CardFilter = {
        kind: "typedPokemon",
        pokemonType: (card?.types?.[0] ?? "Colorless") as never,
        stage: "evolution",
      };
      expect(matchesFilter(card, typed), id).toBe(isEvolution);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE SCAN AND THE DAMAGE — all three narrowings on a real declaration.
// ─────────────────────────────────────────────────────────────────────────────

describe("D245 — the three narrowings on a real board", () => {
  it("SUNNY DAY pays a {G} attacker and a {R} attacker, and no one else", () => {
    expect(dealt(attacking("fix-grass-attacker", "fix-basic-1", "fix-sunnyday"))).toBe(70);
    expect(dealt(attacking("fix-victorycheer", "fix-basic-1", "fix-sunnyday"))).toBe(70);
    // 🛑 THE COLORLESS CONTROL. Without it every board above is equally green
    // under a `beneficiary` that was dropped entirely.
    expect(dealt(attacking("fix-plain-body", "fix-basic-1", "fix-sunnyday"))).toBe(50);
  });

  it("SUNNY DAY's filter is matched against the ATTACKER, never the SOURCE", () => {
    // The source is itself a {G} body, which is the trap `CHEER_ON_TO_GLORY`
    // already carries: a scan filtering BOTH ends passes here and is still wrong.
    // The separating board is a Colorless attacker beside a {G} source — filtering
    // the source alone would pay 70, filtering both would pay 50, and only
    // filtering the attacker is right. The 50 above is that assertion; this one
    // pins the direction by showing the source's own membership changes nothing.
    expect(
      matchesFilter(FIXTURE_POOL["fix-sunnyday"], { kind: "typedPokemon", pokemonType: "Grass" }),
    ).toBe(true);
    expect(
      seatPreWRDamageBonus(
        attacking("fix-plain-body", "fix-basic-1", "fix-sunnyday"),
        "p1",
        FIXTURE_POOL["fix-plain-body"],
      ),
    ).toBe(0);
  });

  it("🛑 VICTORY CHEER's source is OUTSIDE its own beneficiary set", () => {
    // The board no other aura in the family can build: Victini is a BASIC {R}
    // body and its own filter says "Evolution {R}". A build that let the source
    // pay itself reads 60 here.
    const selfOnly = attacking("fix-victorycheer", "fix-basic-1");
    expect(dealt(selfOnly)).toBe(50);
    // …while a benched Victini pays an EVOLUTION {R} attacker.
    expect(dealt(attacking("fix-fire-stage1", "fix-basic-1", "fix-victorycheer"))).toBe(60);
    // …and refuses a BASIC {R} one, which is `stage: "evolution"` doing the work
    // at the damage seam rather than only at `matchesFilter`.
    expect(dealt(attacking("fix-victorycheer", "fix-basic-1", "fix-victorycheer"))).toBe(50);
  });

  it("PRIMAL KNOWLEDGE reads the DEFENDER, and the two riders are independent", () => {
    // An EVOLUTION defender takes the 30; a BASIC one does not. The attacker is
    // the same Colorless body on both boards, which is what makes this a target
    // read and not a beneficiary one.
    expect(dealt(attacking("fix-plain-body", "fix-grass-stage1", "fix-primalknowledge"))).toBe(80);
    expect(dealt(attacking("fix-plain-body", "fix-basic-1", "fix-primalknowledge"))).toBe(50);
    // 🛑 AND THE CROSS-WIRING CONTROL. If the scan read `target` against the
    // ATTACKER's card, this board — Basic attacker, Evolution defender — would
    // read 50 where it must read 80, and the board above it (Evolution attacker
    // would be needed) would be the green one. Asserted from the scan directly so
    // the failure is attributable.
    const crossed = attacking("fix-plain-body", "fix-grass-stage1", "fix-primalknowledge");
    expect(
      seatPreWRDamageBonus(
        crossed,
        "p1",
        FIXTURE_POOL["fix-plain-body"],
        FIXTURE_POOL["fix-grass-stage1"],
      ),
    ).toBe(30);
    // …and with the defender withheld the aura fails CLOSED, which is
    // `beneficiary`'s conservative direction applied to the other end.
    expect(seatPreWRDamageBonus(crossed, "p1", FIXTURE_POOL["fix-plain-body"])).toBe(0);
  });

  it("the THREE auras STACK, because three printed Abilities are three effects", () => {
    // An Evolution {R} attacker into an Evolution defender, under all three: the
    // disjunction (20, {R} is an arm), the stage filter (10, it is an Evolution
    // {R}) and the target filter (30, the defender is an Evolution) = 110.
    const all = attacking(
      "fix-fire-stage1",
      "fix-grass-stage1",
      "fix-sunnyday",
      "fix-victorycheer",
      "fix-primalknowledge",
    );
    expect(dealt(all)).toBe(50 + 20 + 10 + 30);
  });

  it("is SEAT-RELATIVE — the opponent's narrowed aura never pays you", () => {
    let state = attacking("fix-grass-attacker", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-sunnyday");
    expect(
      seatPreWRDamageBonus(
        state,
        "p1",
        FIXTURE_POOL["fix-grass-attacker"],
        FIXTURE_POOL["fix-basic-1"],
      ),
    ).toBe(0);
    expect(
      seatPreWRDamageBonus(
        state,
        "p2",
        FIXTURE_POOL["fix-grass-attacker"],
        FIXTURE_POOL["fix-basic-1"],
      ),
    ).toBe(20);
  });

  it("§9 — a locked source pays nothing, on all three narrowings", () => {
    // Klefki "Mischievous Lock" silences Basic Pokémon's Abilities while it is
    // ACTIVE. All three fixture sources are Basics (declared in `testFixtures.ts`
    // — the FIXTURE's shape, not the PRINT's, for two of the three), so the lock
    // reaches every one of them; this is the CHANNEL claim, that the narrowed
    // bonus rides the §9-suppressible ability path and not a turn-stamped
    // installation.
    const locked = attacking("fix-fire-stage1", "sv01-096", "fix-sunnyday", "fix-victorycheer");
    expect(
      seatPreWRDamageBonus(locked, "p1", FIXTURE_POOL["fix-fire-stage1"], FIXTURE_POOL["sv01-096"]),
    ).toBe(0);
    // 🛑 THE CONTROL THAT STOPS THIS BEING "A KLEFKI IS IN PLAY, THEREFORE ZERO".
    // Mischievous Lock carries `requiresActive`, so a plain Active lifts it and
    // both narrowed sources come back — 20 from the disjunction, 10 from the
    // stage filter, on the same Evolution {R} attacker.
    const lifted = attacking("fix-fire-stage1", "fix-basic-1", "fix-sunnyday", "fix-victorycheer");
    expect(dealt(lifted)).toBe(80);
  });
});
