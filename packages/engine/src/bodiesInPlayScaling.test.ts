import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  POKEMON_TYPES,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter } from "./effects";
import { engineVersion, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction } from "./index";
import { countOwnerPokemonInPlay, countPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  IN_PLAY_BODIES_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.340.0 → 0.341.0 — 🆕🆕 D439: DAMAGE SCALED BY THE BODIES YOU HAVE IN PLAY,
// FILTERED BY THE PRINTED NOUN.
//
//   "This attack does 20 damage for each of your Pokémon in play."            1
//   "This attack does 20 damage for each of your Basic Pokémon in play."      1
//   "This attack does 30 damage for each of your Team Rocket's Pokémon in play."  2
//   "This attack does 30 damage for each of your {G} Pokémon in play."        2
//   "This attack does 40 more damage for each of your Evolution Pokémon in play." 2
//                                          — 5 sentences / 8 LEGAL printings
//
// THE FIFTEENTH `DamageCountSource`, AND THE FIRST WHOSE PAYLOAD IS A `CardFilter`.
// It is also the first BODY count in this union that reads the ACTIVE SPOT: the
// three that came before it (`yourBenchCount`, `opponentBenchCount`,
// `bothSidesBenchCount`) all read the printed word "Benched" and deliberately skip
// it, and this one reads the printed words "in play", which §4 defines as the
// Active plus the Bench.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
// The build has FIVE ways to be wrong and every one of them is a real neighbouring
// arm rather than a straw:
//
//   ⑴ THE ZONE. `benchBodies` sits three `case`s up in the same `switch` and is
//      what a slice reaching for the structurally nearest neighbour would call.
//      §3's canonical board fields ONE Active and FIVE Benched on the attacker's
//      side, and in `FILTERS` order (any / Basic / Team Rocket's / {G} / Evolution)
//      the truth is **6 / 2 / 1 / 3 / 4** while a Bench-only walk reads
//      **5 / 2 / 0 / 3 / 3**. ⚠️ **IT IS RIGHT ON TWO OF THE FIVE** — `basicPokemon`
//      and `typedPokemon`, because the Active is neither a Basic nor Grass — which
//      is exactly why the board is driven on all five filters rather than on one.
//   ⑵ THE SEAT. The printed word is "YOUR", and the attack damages the opponent,
//      so the seats are opposite ends of one swing. The defender's side is shaped
//      to answer **5 / 3 / 2 / 1 / 2** against the attacker's **6 / 2 / 1 / 3 / 4**,
//      so a side inversion moves every one of the five.
//   ⑶ THE FILTER. Five nouns, five `CardFilter` members, and the board gives five
//      DIFFERENT counts — so a build that read the wrong member is a different
//      number in every rung rather than a coincidence in one.
//   ⑷ THE FOLD. Four of the five sentences carry no "more" and land on the
//      MULTIPLY fold, where the printed base is DROPPED; the fifth carries "more"
//      and keeps it. §4 drives a board that matches NOTHING and asserts no
//      `DAMAGE_DEALT` at all on the `×` fold — a build that kept the base would
//      deal 30 there and be green everywhere else in this file.
//   ⑸ THE VOCABULARY. Two sentences reach the anchors and are DELIBERATELY LEFT
//      LOUD, for two different reasons — see §2.
//
// ⚠️ **THE ZONE WALK IS `countOwnerPokemonInPlay`'s, GENERALISED IN PLACE.** D242
// already answered *"how many of your <noun> Pokémon are in play"* for a
// `BoardCondition`; a second walk would have made "in play" a question with two
// implementations, and — because `D242-count-skips-the-active-spot` quotes that
// function's first line verbatim — a byte-identical copy would also have broken a
// shipped mutant row into a `2×` ERROR without anybody touching it (D416/D437).
// So the old function is now a two-line adapter over `countPokemonInPlay`, and §3
// drives BOTH names on ONE board to pin that they cannot disagree.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes, off `legalAttackCorpus()` — the committed `legal_standard = 1`
// attack column. `Pokémon` carries the real é (U+00E9) in every slot and the
// possessive in the owner sentence is U+0027, checked rather than remembered
// (D421's byte, and the reason this comment names it).
// ─────────────────────────────────────────────────────────────────────────────
const ANY_BODIES = "This attack does 20 damage for each of your Pokémon in play.";
const BASIC_BODIES = "This attack does 20 damage for each of your Basic Pokémon in play.";
const TR_BODIES = "This attack does 30 damage for each of your Team Rocket's Pokémon in play.";
const GRASS_BODIES = "This attack does 30 damage for each of your {G} Pokémon in play.";
const EVOLUTION_BODIES = "This attack does 40 more damage for each of your Evolution Pokémon in play.";

/** The five, in fixture-attack order. */
const CLAIMED = [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES, EVOLUTION_BODIES] as const;

/** 🛑 THE TWO SENTENCES THE ANCHORS REACH AND THE VOCABULARY REFUSES, AND THEY ARE
    REFUSED FOR TWO DIFFERENT REASONS. Both are real catalog rows. */
const ANCIENT_BODIES = "This attack does 30 damage for each of your Ancient Pokémon in play.";
const STAGE1_BODIES = "This attack does 40 damage for each of your Stage 1 Pokémon in play.";

/** 🛑 THE OPPONENT-SIDE ROWS — real printings, refused by the `(?!opponent)`
    lookahead before the vocabulary is ever consulted. */
const FOE_EX_BODIES = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";
const FOE_EX_V_BODIES =
  "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.";

/** 🛑 THE COMPOUND — the family's one, and it does NOT compose. */
const DRIFLOON_COMPOUND =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** 🛑 THE MID-SENTENCE NOUN — 3 sentences / 6 printings, the largest countable
    record in this family and the one this slice does NOT take. Its noun is not a
    prefix noun (" in play" sits in the MIDDLE), so it cannot ride these anchors at
    all, and it needs a `CardFilter` member reading `attacksOf`. */
const ROUND_BODIES = "This attack does 20 damage for each of your Pokémon in play that has the Round attack.";

/** The BENCHED twin of this member's noun — a real printing, already built as
    `yourBenchCount` (D282). It is the whole of ⑴ above stated as printed text:
    the same verb, the same fold, one word different, and a different number on
    every board with an Active. */
const BENCHED_BODIES = "This attack does 20 damage for each of your Benched Pokémon.";

/** One seed for the whole suite. Nothing here flips a coin and every Active and
    every Benched body is placed by surgery, so a seed table would describe a
    shuffle rather than a rule. */
const SEED = 1;

/** The five filters, in the same order as `CLAIMED`. */
const FILTERS: readonly CardFilter[] = [
  { kind: "anyPokemon" },
  { kind: "basicPokemon" },
  { kind: "ownerPokemon", owner: "Team Rocket" },
  { kind: "typedPokemon", pokemonType: "Grass" },
  { kind: "evolutionPokemon" },
];

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active`);
  return body;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both Actives are placed by surgery and BOTH Benches are
    cleared to nothing: every number this suite reads is a POPULATION, so a body
    the setup shuffle happened to place would move the answer silently. One {C} is
    attached to pay the printed cost of all five attacks. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: IN_PLAY_BODIES_DECK, p2: IN_PLAY_BODIES_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-inplaybodies");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function benched(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

/** 🛑 **THE CANONICAL BOARD, AND THE FIVE FILTERS ANSWER FIVE DIFFERENT NUMBERS.**

      attacker's side                          defender's side
        Active  fix-inplaybodies (TR, Dark, Stage 1)   fix-titan (Colorless Basic)
        Bench   fix-grass-stage1 ×2                     fix-tr-stage1 ×2
                fix-stage1                              fix-grass-basic
                fix-benchfiller                         fix-benchfiller
                fix-grass-basic

    In `FILTERS` / attack-index order — any, Basic, Team Rocket's, {G}, Evolution:

      anyPokemon       6   ×20 → 120        (opponent 5)
      basicPokemon     2   ×20 →  40        (opponent 3)
      ownerPokemon     1   ×30 →  30        (opponent 2)
      typedPokemon{G}  3   ×30 →  90        (opponent 1)
      evolutionPokemon 4   40 + 4×40 → 200  (opponent 2)

    Every wrong answer is a different number from every other wrong answer, on one
    setup: a Bench-only walk reads **5 / 2 / 0 / 3 / 3**, a seat inversion reads
    **5 / 3 / 2 / 1 / 2**, and a wrong filter reads one of the other four rows. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = benched(bare(by), by, [
    "fix-grass-stage1",
    "fix-grass-stage1",
    "fix-stage1",
    "fix-benchfiller",
    "fix-grass-basic",
  ]);
  state = benched(state, foe, [
    "fix-tr-stage1",
    "fix-tr-stage1",
    "fix-grass-basic",
    "fix-benchfiller",
  ]);
  return state;
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, the population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the five printed sentences, their population, and the fixture", () => {
  it("the column prints the five on five records, 8 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1, 1, 1]);
    expect(rows.map((r) => r.reduce((sum, [n]) => sum + n, 0))).toEqual([1, 1, 2, 2, 2]);
    expect(rows.flat().reduce((sum, [n]) => sum + n, 0)).toBe(8);
  });

  it("🛑 the WHOLE 'for each of your … in play' family, printed whole and classified", () => {
    // ⚠️ **THE ENUMERATION IS THE UNRELIABLE PART** (D424/D428), so this rung takes
    // the LOOSEST plausible shape — every corpus row containing "for each of your"
    // and ending " in play." — and asserts the WHOLE list rather than a count. It
    // cannot be truncated on either axis, because a missing row is a `toEqual`
    // failure naming the row.
    const family = legalAttackCorpus()
      .filter(([, s]) => s.includes("for each of your") && s.endsWith(" in play."))
      .map(([, s]) => s)
      .sort();
    expect(family).toEqual(
      [
        ANY_BODIES,
        BASIC_BODIES,
        ANCIENT_BODIES,
        TR_BODIES,
        GRASS_BODIES,
        STAGE1_BODIES,
        EVOLUTION_BODIES,
        FOE_EX_BODIES,
        FOE_EX_V_BODIES,
      ].sort(),
    );
    // …so the family is NINE sentences, of which this slice claims FIVE. The other
    // four are the two data/vocabulary refusals and the two opponent-side rows.
    expect(family).toHaveLength(9);
  });

  it("carries fix-inplaybodies's five printed attacks, `×` and `+` markers included", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode). ⚠️ THE TRAILING MARKERS ARE LOAD-BEARING: `×` is what tells attack.ts
    // to DROP the printed base and `+` is what tells it to keep it, and four of
    // these five sentences land on the `×` fold.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["20×", ANY_BODIES],
      ["20×", BASIC_BODIES],
      ["30×", TR_BODIES],
      ["30×", GRASS_BODIES],
      ["40+", EVOLUTION_BODIES],
    ]);
    // The prefixed NAME is the load-bearing field for the owner filter, and it is a
    // SECOND prefixed body distinct from `fix-tr-stage1`.
    expect(FIXTURE_POOL["fix-inplaybodies"]?.name).toBe("Team Rocket's Fixmon");
    expect(FIXTURE_POOL["fix-tr-stage1"]?.name).toBe("Team Rocket's Persian");
  });

  it("AUTHORS nothing — every printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-inplaybodies")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the readers, the vocabulary, and the near misses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the two anchors and the `inPlayBodyFilter` vocabulary", () => {
  it("reads each printed noun as the `CardFilter` member that already spelled it", () => {
    expect(deriveAttackDamageMultiplier(ANY_BODIES)).toEqual({
      per: 20,
      count: { kind: "yourPokemonInPlay", filter: { kind: "anyPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(BASIC_BODIES)).toEqual({
      per: 20,
      count: { kind: "yourPokemonInPlay", filter: { kind: "basicPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(TR_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "yourPokemonInPlay",
        filter: { kind: "ownerPokemon", owner: "Team Rocket" },
      },
    });
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).toEqual({
      per: 30,
      count: {
        kind: "yourPokemonInPlay",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    // …and the ONE sentence on the additive fold, which is the one that carries
    // "more". The adjective picks the fold, exactly as it does for the Bench trio.
    expect(deriveAttackDamageBonus(EVOLUTION_BODIES)).toEqual({
      per: 40,
      count: { kind: "yourPokemonInPlay", filter: { kind: "evolutionPokemon" } },
    });
  });

  it("🛑 the FOLD is the adjective and nothing else — each sentence reaches ONE reader", () => {
    // Turns red the moment somebody gives the other fold a matching arm "for
    // symmetry", which would author four cards the catalog does not print.
    for (const text of [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamagePenalty(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackDamageMultiplier(EVOLUTION_BODIES)).toBeNull();
    expect(deriveAttackDamagePenalty(EVOLUTION_BODIES)).toBeNull();
    expect(deriveAttackEffect(EVOLUTION_BODIES)).toBeNull();
  });

  it("🛑 the two LOUD sentences are refused by the VOCABULARY, not by the anchor", () => {
    // ⚠️ **TWO REFUSALS, TWO REASONS, AND THE DISTINCTION IS THE POINT.**
    //   • `Ancient` is DATA-BLOCKED and permanently so — the banner is in no
    //     catalog column and no tcgdex field, and a name-keyed species table is
    //     refused at `PREVENT_DAMAGE_FROM_CLASS`'s own site because the banner is a
    //     per-PRINTING fact. Nothing in effects.ts can ever be the fix.
    //   • `Stage 1` is merely UNBUILT: `isBasicPokemon` and `evolveFromOf` both
    //     exist, but no `CardFilter` member reads a printed stage ORDINAL.
    // Both must stay on the loud ATTACK_EFFECT_SKIPPED path.
    for (const text of [ANCIENT_BODIES, STAGE1_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    // ⚠️ **AND THE ADMISSION THAT MAKES THE REFUSAL MEAN SOMETHING** (D424): the
    // anchors really do reach both strings, so what refuses them is the map. The
    // near-miss differs from `ANCIENT_BODIES` on exactly ONE axis — the noun —
    // and is claimed.
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).not.toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Evolution Pokémon in play.",
      ),
    ).toEqual({
      per: 30,
      count: { kind: "yourPokemonInPlay", filter: { kind: "evolutionPokemon" } },
    });
  });

  it("🛑 the `(?!opponent)` lookahead refuses the two REAL opponent-side printings", () => {
    // 🛑 **D407's DEFECT, REACHED FROM THE CAPTURE SIDE.** `for each of your ` is
    // also the head of "for each of your opponent's …", so without the lookahead
    // the noun would capture as `opponent's Pokémon ex` and the sentence would be
    // scored off the ATTACKER's board. Today the vocabulary would refuse that noun
    // anyway; the lookahead is what stops the refusal turning into a WRONG CARD
    // the day a rule-box `CardFilter` member lands.
    for (const text of [FOE_EX_BODIES, FOE_EX_V_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
    // ⚠️ **THE ONE-AXIS CONTROL, AND ITS ADMITTED TWIN**: the same sentence with
    // `opponent's ` deleted and NOTHING else changed is a constructed string (the
    // catalog prints no own-side "Pokémon ex" count), so it is labelled as
    // constructed — and it is still refused, because `Pokémon ex` is not in the
    // vocabulary either. So this rung proves the lookahead is reached, and the
    // rung above proves the map is what answers.
    expect(
      deriveAttackDamageMultiplier("This attack does 60 damage for each of your Pokémon ex in play."),
    ).toBeNull();
    // …while the same edit on a noun the map DOES hold is claimed, which is what
    // makes "the lookahead is doing the refusing" a testable claim rather than a
    // description: `opponent's` in front of a KNOWN noun is refused, the noun
    // alone is taken.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's {G} Pokémon in play.",
      ),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(GRASS_BODIES)).not.toBeNull();
    // 🛑 **THE STRING THE LOOKAHEAD ACTUALLY SAVES US FROM, AND IT IS THE OWNER
    // PATTERN THAT MAKES IT DANGEROUS.** `IN_PLAY_OWNER_NOUN` captures its owner
    // rather than listing it — deliberately, so a sixth prefix printing needs no
    // code — which means the noun `opponent's Pokémon` RESOLVES, to
    // `{ kind: "ownerPokemon", owner: "opponent" }`, scored off the ATTACKER's
    // board. Without the lookahead this constructed sentence derives instead of
    // staying null, and the card it authors counts bodies whose names begin
    // "opponent's ". ⚠️ STATED AS CONSTRUCTED (D121/D420): the catalog prints no
    // such row, so no board and no census figure moves either way — this rung is
    // the ONLY place the lookahead is observable, and it is where its mutant dies.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's Pokémon in play.",
      ),
    ).toBeNull();
  });

  it("🛑 the `[^.]+` capture cannot cross a sentence break — the COMPOUND stays whole", () => {
    // A greedy `(.+)` would let the anchor span the break on any compound that
    // happens to end in a period, which is the anchor-swallows-a-compound defect
    // D207 paid for three times. A class that cannot match `.` cannot do it.
    expect(deriveAttackDamageMultiplier(DRIFLOON_COMPOUND)).toBeNull();
    expect(deriveAttackDamageBonus(DRIFLOON_COMPOUND)).toBeNull();
    // The constructed two-sentence form built out of a noun the map DOES hold —
    // one axis from `GRASS_BODIES`, which is claimed.
    expect(deriveAttackDamageMultiplier(`${GRASS_BODIES} ${GRASS_BODIES}`)).toBeNull();
    // 🛑 **AND THE COMPOUND THAT A GREEDY `(.+)` WOULD ACTUALLY CLAIM.** The owner
    // pattern's own open-endedness is again what makes the swallow dangerous: with
    // `.+` the capture spans the sentence break and ends on `…'s Pokémon`, so
    // `IN_PLAY_OWNER_NOUN` matches and the engine authors a filter whose `owner` is
    // half a printed card. ⚠️ CONSTRUCTED, and labelled so — but the SHAPE is real:
    // the family's one printed compound (`DRIFLOON_COMPOUND`) is two sentences of
    // exactly this form, and it is only its parenthetical third part that keeps it
    // off this pattern today.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your Pokémon in play. Discard 2 of your Team Rocket's Pokémon in play.",
      ),
    ).toBeNull();
  });

  it("🛑 the COMPOUND does not COMPOSE either, and the reason is its TAIL", () => {
    // D426's mechanism at the three-way end, measured rather than assumed:
    // `COMPOUND_CLAUSE_BREAK` splits this row into THREE parts, so the tail is the
    // parenthetical W/R reminder — which `deriveAttackEffect` refuses. That is the
    // FIRST guard `splitAttackTrailingClause` applies, so the head is never even
    // consulted and claiming the head buys ZERO census printings.
    expect(splitAttackTrailingClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(splitAttackGateClause(DRIFLOON_COMPOUND)).toBeNull();
    expect(deriveAttackEffect("(Don't apply Weakness and Resistance for Benched Pokémon.)")).toBeNull();
    // …and the row is therefore STILL unresolved at this head, which is the honest
    // statement of what this slice did and did not buy.
    expect(resolvedByAnyReader(DRIFLOON_COMPOUND)).toBe(false);
  });

  it("🛑 the MID-SENTENCE noun cannot ride these anchors — the Round family stays LOUD", () => {
    // 3 sentences / 6 printings, the largest countable record in this family and
    // the one this slice does NOT take. Its " in play" sits in the MIDDLE of the
    // noun phrase, so the trailing ` in play\.$` cannot match it at all — it needs
    // its OWN anchor AND a `CardFilter` member reading `attacksOf`, and a
    // `CardFilter` member is a widening of a union with two other consumers
    // (`retrieveNoun`'s switch and `BENCHABLE_RETRIEVAL_KINDS`).
    expect(deriveAttackDamageMultiplier(ROUND_BODIES)).toBeNull();
    expect(deriveAttackDamageBonus(ROUND_BODIES)).toBeNull();
    // ⚠️ **THE FALSIFIER IS EXECUTABLE**: the day the Round family is claimed this
    // rung goes RED and the refusal above has to be rewritten rather than trusted.
    expect(resolvedByAnyReader(ROUND_BODIES)).toBe(false);
    const round = legalAttackCorpus().filter(
      ([, s]) => s.includes("in play that has the Round attack"),
    );
    expect(round).toHaveLength(3);
    expect(round.reduce((sum, [n]) => sum + n, 0)).toBe(6);
  });

  it("the whole-sentence anchor holds at both ends and on the leading capital", () => {
    // The family's stated anchor discipline: no /i, a required trailing period, a
    // capital `This`, and no leading or trailing text. Each of these would be
    // admitted by a search-style pattern, and each differs from `GRASS_BODIES` on
    // exactly ONE axis.
    expect(
      deriveAttackDamageMultiplier("this attack does 30 damage for each of your {G} Pokémon in play."),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your {G} Pokémon in play"),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${GRASS_BODIES}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(`${GRASS_BODIES} Discard an Energy from this Pokémon.`),
    ).toBeNull();
    // A printed 0 does nothing and stays LOUD — the guard every arm in both
    // families carries, and it is a SEPARATE guard from the vocabulary: this string
    // has a noun the map holds, so only `per >= 1` can be refusing it.
    expect(
      deriveAttackDamageMultiplier("This attack does 0 damage for each of your {G} Pokémon in play."),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("This attack does 0 more damage for each of your Evolution Pokémon in play."),
    ).toBeNull();
    // …and the capture really is a capture, driven on CONSTRUCTED text that is
    // labelled as constructed rather than presented as a card (D121).
    expect(
      deriveAttackDamageMultiplier("This attack does 70 damage for each of your {G} Pokémon in play."),
    ).toEqual({
      per: 70,
      count: { kind: "yourPokemonInPlay", filter: { kind: "typedPokemon", pokemonType: "Grass" } },
    });
  });

  it("🛑 the vocabulary's three branches are PAIRWISE DISJOINT, over the whole of it", () => {
    // ⚠️ **THIS RUNG REPLACES A CLAIM THAT WAS FALSE WHEN WRITTEN, AND THE THING
    // THAT CAUGHT IT WAS A MUTANT SURVIVING.** `inPlayBodyFilter`'s doc block first
    // said the branch ORDER was behaviour — that a TYPE-first order would send
    // "Team Rocket's Pokémon" to null, because `^(.+) Pokémon$` matches it. It does
    // match it and it does NOT swallow it: the typed arm returns only when
    // `CLAUSE_POKEMON_TYPES` resolves the token, so an unresolved one falls THROUGH.
    // `D439-vocabulary-order-loses-the-owner` is kept as a declared `equivalent`
    // survivor, and THIS is the property the declaration rests on — measured over
    // the whole vocabulary rather than argued, so it goes RED the day the sets
    // overlap and the survivor's reason stops being true.
    const OWNER_SHAPE = /['\u2019]s Pokémon$/;
    for (const type of POKEMON_TYPES) {
      // No Pokémon type name ends in a possessive, in EITHER notation…
      expect(OWNER_SHAPE.test(`${type} Pokémon`)).toBe(false);
      // …and every one of them really does reach the typed reading, which is what
      // stops this being a vacuous assertion about strings nobody parses.
      expect(
        deriveAttackDamageMultiplier(`This attack does 10 damage for each of your ${type} Pokémon in play.`),
      ).toEqual({
        per: 10,
        count: { kind: "yourPokemonInPlay", filter: { kind: "typedPokemon", pokemonType: type } },
      });
    }
    // …and the three EXACT nouns carry no apostrophe either, so they cannot reach
    // the owner branch on any ordering.
    for (const noun of ["Pokémon", "Basic Pokémon", "Evolution Pokémon"]) {
      expect(OWNER_SHAPE.test(noun)).toBe(false);
    }
    expect(deriveAttackDamageMultiplier(TR_BODIES)).toEqual({
      per: 30,
      count: { kind: "yourPokemonInPlay", filter: { kind: "ownerPokemon", owner: "Team Rocket" } },
    });
    // The owner is CAPTURED, not listed — a second prefix is admitted the day it is
    // ingested and this file never learns a card name. Constructed, and labelled so.
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your Ethan's Pokémon in play."),
    ).toEqual({
      per: 30,
      count: { kind: "yourPokemonInPlay", filter: { kind: "ownerPokemon", owner: "Ethan" } },
    });
    // …and the SPELLED-OUT type notation resolves through the same shared map, so a
    // token meaning Grass in one clause of this file means Grass in every other.
    expect(
      deriveAttackDamageMultiplier("This attack does 30 damage for each of your Grass Pokémon in play."),
    ).toEqual({
      per: 30,
      count: { kind: "yourPokemonInPlay", filter: { kind: "typedPokemon", pokemonType: "Grass" } },
    });
  });

  it("🛑 the BENCHED twin is a DIFFERENT sentence with a DIFFERENT member", () => {
    // ⑴ stated as printed text: one word apart, and `yourBenchCount` has served it
    // since D282. If this slice's anchor ever widened onto it, the Active Spot
    // would start counting toward a sentence that says "Benched".
    expect(deriveAttackDamageMultiplier(BENCHED_BODIES)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("🛑 the sentences are claimed by EXACTLY the two readers named, and refused by the rest", () => {
    // ⚠️ **A NAMED CLAIM PLUS ELEVEN KEPT REFUSALS, AND NOT `resolvedByAnyReader === true`**
    // (D438, and the shape that produced D436's GAP): a bare `=== true` is a claim
    // about NO reader, and it stays green under any mistaken widening. This asserts
    // WHICH reader owns each sentence AND that every other reader still says no.
    const OTHERS = [
      deriveAttackEffect,
      deriveAttackDamagePenalty,
      deriveAttackDamageSuppression,
      deriveAttackCoinFlip,
      deriveAttackRequirement,
      deriveAttackCancelRequirement,
      deriveAttackPreDamage,
      deriveAttackBonusConsequent,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackDiscardScaledBoost,
    ] as const;
    for (const text of [ANY_BODIES, BASIC_BODIES, TR_BODIES, GRASS_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    expect(deriveAttackDamageBonus(EVOLUTION_BODIES)).not.toBeNull();
    expect(deriveAttackDamageMultiplier(EVOLUTION_BODIES)).toBeNull();
    for (const reader of OTHERS) expect(reader(EVOLUTION_BODIES)).toBeNull();
    expect(resolvedByAnyReader(EVOLUTION_BODIES)).toBe(true);
    // …and the four the family leaves behind are refused by EVERY reader, which is
    // the thirteen-way negative kept rather than replaced.
    for (const text of [ANCIENT_BODIES, STAGE1_BODIES, FOE_EX_BODIES, FOE_EX_V_BODIES]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real board: the zone, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countPokemonInPlay`: Active + Bench, seat-relative, filtered", () => {
  it("🛑 the canonical board answers 6 / 2 / 4 / 3 / 1 on the attacker's side", () => {
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([6, 2, 1, 3, 4]);
  });

  it("🛑 and 5 / 3 / 2 / 1 / 2 on the defender's — every one of the five moves", () => {
    // The seat rung. No pair of these lists shares a value at the same index, so a
    // build reading the wrong board is wrong on ALL FIVE rather than on one.
    const state = canonical();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([5, 3, 2, 1, 2]);
  });

  it("🛑 'in play' is ACTIVE + BENCH — the Active contributes, and is FILTERED", () => {
    // The zone rung, driven from both ends.
    //   • The attacker's Active is an Evolution, owner-prefixed, Darkness and NOT a
    //     Basic, so it contributes to `anyPokemon`, `ownerPokemon` and
    //     `evolutionPokemon` and NOT to `basicPokemon` or `typedPokemon` — a
    //     Bench-only build is RIGHT about two of the five, which is exactly why one
    //     filter would not have shown it.
    const state = canonical();
    const benchOnly = (f: CardFilter) =>
      state.players.p1.bench.filter((b) => countPokemonInPlay({ ...state, players: { ...state.players, p1: { ...state.players.p1, active: b, bench: [] } } }, "p1", f) === 1).length;
    expect(FILTERS.map(benchOnly)).toEqual([5, 2, 0, 3, 3]);
    //   • so the Active's own contribution, filter by filter, is the difference:
    const BENCH_ONLY = [5, 2, 0, 3, 3] as const;
    expect(
      FILTERS.map((f, i) => countPokemonInPlay(state, "p1", f) - (BENCH_ONLY[i] ?? -1)),
    ).toEqual([1, 0, 1, 0, 1]);
  });

  it("🛑 the NULL-ACTIVE board answers with the Bench and does not throw", () => {
    // A seat whose Active Spot is empty is a real mid-resolution board (§8.1, before
    // the promotion is answered), and the walk must survive it. Driven on the
    // function rather than through `attack()`, because the ATTACKER's own Active can
    // never be null at declaration — the gate required it.
    const state = canonical();
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(FILTERS.map((f) => countPokemonInPlay(empty, "p1", f))).toEqual([5, 2, 0, 3, 3]);
    // …and an EMPTY SIDE is 0 rather than a throw, on every filter.
    const barren: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null, bench: [] } },
    };
    expect(FILTERS.map((f) => countPokemonInPlay(barren, "p1", f))).toEqual([0, 0, 0, 0, 0]);
  });

  it("🛑 the GENERALISED walk and D242's adapter cannot disagree", () => {
    // The two names, one walk. This is what a second copy of the loop would have
    // broken, and it goes red the day somebody re-inlines one of them.
    const state = canonical();
    for (const seat of ["p1", "p2"] as const) {
      expect(countOwnerPokemonInPlay(state, seat, "Team Rocket")).toBe(
        countPokemonInPlay(state, seat, { kind: "ownerPokemon", owner: "Team Rocket" }),
      );
    }
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p2", "Team Rocket")).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the count actually scaling damage.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: five attacks, five numbers, one board", () => {
  it("🛑 the canonical board deals 120 / 40 / 30 / 90 / 200", () => {
    const state = canonical();
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("🛑 the MULTIPLY fold DROPS the printed base and the ADDITIVE one KEEPS it", () => {
    // The four `×` sentences have `base: 0` in the event even though the card prints
    // `20×` / `30×`; the one `+` sentence carries its printed 40. A build that got
    // the fold wrong would be off by the base on every board, including the ones
    // above — but only this rung says WHICH half of the number is which.
    const state = canonical();
    const rows = [0, 1, 2, 3, 4].map((i) => find(swing(state, i).events, "DAMAGE_DEALT"));
    expect(rows.map((r) => r?.base)).toEqual([0, 0, 0, 0, 40]);
    expect(rows.map((r) => r?.scaled)).toEqual([120, 40, 30, 90, 160]);
  });

  it("🛑 the ACTIVE ALONE still scores — the Bench-only build reads ZERO here", () => {
    // ⑴'s killing board: the attacker's Bench is empty, so the only countable body
    // is the one in the Active Spot. Three of the five filters match it, and a walk
    // that skipped the Active deals NO DAMAGE AT ALL on those three.
    const state = bare();
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([1, 0, 1, 0, 1]);
    expect(dealt(state, 0)).toBe(20);
    expect(dealt(state, 2)).toBe(30);
    expect(dealt(state, 4)).toBe(80);
    // …and the two it does NOT match are the printed floor, below.
    expect(find(swing(state, 1).events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(swing(state, 3).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("🛑 the BENCH ALONE still scores — the count is not the Active's alone either", () => {
    // The mirror of the rung above: five Benched bodies and an Active that matches
    // only `anyPokemon`/`ownerPokemon`/`evolutionPokemon`. `basicPokemon` and
    // `typedPokemon` therefore score off the BENCH exclusively, so an Active-only
    // walk deals nothing on those two and the pair pins the union.
    const state = canonical();
    expect(dealt(state, 1)).toBe(40);
    expect(dealt(state, 3)).toBe(90);
  });

  it("🛑 THE PRINTED FLOOR — a board matching NOTHING files no DAMAGE_DEALT at all", () => {
    // On the `×` fold the base is dropped, so a zero count is zero damage and the
    // engine files no damage row. That is rules-correct and it is the case a build
    // that kept the base would fail: it would deal 20 here.
    const state = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(countPokemonInPlay(state, "p1", { kind: "typedPokemon", pokemonType: "Grass" })).toBe(0);
    const after = swing(state, 3);
    expect(find(after.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(activeOf(after.state, "p2").damage).toBe(0);
    // ⚠️ AND THE ATTACK REALLY RAN — the declaration is on the stream, so this is a
    // zero rather than a refusal.
    expect(find(after.events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("🛑 the ADDITIVE fold KEEPS its base — and its zero is UNREACHABLE, stated", () => {
    // The other half of the floor, and the one that tells the two folds apart.
    // ⚠️ **A ZERO EVOLUTION COUNT IS NOT REACHABLE THROUGH `attack()` ON THIS
    // BOARD, AND THAT IS SAID RATHER THAN FAKED**: the holder is itself an
    // Evolution and it is the Active Spot the attack is declared from, so the count
    // it reads can never be 0. The smallest reachable value is 1, and the base is
    // exactly what separates the additive 40 + 40 from a multiply 40 × 1.
    const state = bare();
    expect(countPokemonInPlay(state, "p1", { kind: "evolutionPokemon" })).toBe(1);
    expect(dealt(state, 4)).toBe(80);
    const row = find(swing(state, 4).events, "DAMAGE_DEALT");
    expect([row?.base, row?.scaled]).toEqual([40, 40]);
    // …and the zero IS driven, on the function, off a board with no Evolution in
    // play at all — which is what proves the arm floors rather than throws.
    const barren: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null, bench: [] } },
    };
    expect(countPokemonInPlay(barren, "p1", { kind: "evolutionPokemon" })).toBe(0);
  });

  it("no ATTACK_EFFECT_SKIPPED is filed, in either direction", () => {
    // The claimed sentences never reach the loud path…
    const state = canonical();
    for (const i of [0, 1, 2, 3, 4]) {
      const after = swing(state, i);
      expect(after.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
      expect(after.events.filter((e) => e.type === "ATTACK_DECLARED")).toHaveLength(1);
    }
    // …and the counter is not vacuous — the same board on the ZERO-count board files
    // none either, which is the case a build that treated 0 as "unreadable" would
    // fail. ⚠️ THIS IS NOT AN ATTRIBUTION CONTROL AND IS STATED AS THE PARTIAL IT IS
    // (D433): this 60 fields no card printing an unread sentence, so nothing here
    // proves the skip channel could fire at all. Its witnesses live in the suites
    // that own an unread printing.
    const floor = benched(bare(), "p1", ["fix-benchfiller"]);
    expect(swing(floor, 3).events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the same five numbers from the other chair", () => {
  it("🛑 p2 attacking reads p2's board, and it is a DIFFERENT board", () => {
    // The seat rung driven through `attack()` rather than through the helper: the
    // canonical shapes are mirrored, so p2 swinging reads 6 / 2 / 4 / 3 / 1 off its
    // own side while p1's side holds 5 / 3 / 2 / 1 / 2.
    const state = canonical("p2");
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p2", f))).toEqual([6, 2, 1, 3, 4]);
    expect(FILTERS.map((f) => countPokemonInPlay(state, "p1", f))).toEqual([5, 3, 2, 1, 2]);
    expect([0, 1, 2, 3, 4].map((i) => dealt(state, i, "p2"))).toEqual([120, 40, 30, 90, 200]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — persistence, purity, and the census this row moves.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
  // this package; what is driven HERE is the engine-side fact it is about — whether
  // anything this slice produces reaches a persisted board.

  it("🛑 DIRECTION 1 — a v29 record round-trips and STILL scores all five counts", () => {
    const record = JSON.parse(JSON.stringify(canonical())) as GameState;
    expect([0, 1, 2, 3, 4].map((i) => dealt(record, i))).toEqual([120, 40, 30, 90, 200]);
  });

  it("🛑 DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    // `DamageCountSource` is a PARSE-TIME type: derived from card text and consumed
    // in the same tick by `scaledAttackDamage`. No op carries one, no field stores
    // one, no event names one. Driven as a property of the SERIALIZED bytes rather
    // than reasoned from the type's name (D427: choosing a carrier does not duck
    // persistence, so the record is what answers).
    const before = canonical();
    const after = swing(before, 0).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("yourPokemonInPlay");
    expect(wire).not.toContain("anyPokemon");
    expect(wire).not.toContain("ownerPokemon");
    // …and no body gained a key: the attacker's key set equals the untouched
    // defender's and equals its own from before the swing, which is the shape a new
    // `InPlayPokemon` field would break.
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const benchBefore = frozen.players.p1.bench.length;
    const after = swing(frozen, 0);
    // The count is a READ: the bodies it walked are all still there afterwards, on
    // the new board as well as on the frozen one, and only the defender moved.
    expect(frozen.players.p1.bench).toHaveLength(benchBefore);
    expect(after.state.players.p1.bench).toHaveLength(benchBefore);
    expect(activeOf(frozen, "p1").energy).toHaveLength(1);
    expect(activeOf(after.state, "p1").energy).toHaveLength(1);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(120);
  });

  it("🛑 the OPPONENT-SIDE sibling is an ABSENCE, pinned on the POPULATION", () => {
    // ⚠️ **THIS IS THE FALSIFIER FOR "NO `side` FIELD"** and it is pinned on the
    // corpus rather than on a specimen (D423): the union spells a side into the
    // member NAME, and the three opponent-side printings this family holds are
    // refused for their FILTER — no `CardFilter` member reads a rule-box class —
    // and not for their side. The day one does, these rows become buildable and
    // this member gains an `opponentPokemonInPlay` sibling; this rung goes RED then
    // and not before.
    const foeSide = legalAttackCorpus().filter(
      ([, s]) => s.includes("for each of your opponent's") && s.endsWith(" in play."),
    );
    expect(foeSide.map(([, s]) => s).sort()).toEqual([FOE_EX_BODIES, FOE_EX_V_BODIES].sort());
    expect(foeSide.reduce((sum, [n]) => sum + n, 0)).toBe(3);
    for (const [, s] of foeSide) expect(resolvedByAnyReader(s)).toBe(false);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.347.0");
  });
});
