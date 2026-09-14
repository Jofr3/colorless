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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { countCardsInDiscardPile, countPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  PILE_ATTACK_NAME_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.396.0 → 0.397.0 — 🆕🆕 D508: DAMAGE SCALED BY A COUNT OF POKÉMON IN YOUR
// DISCARD PILE THAT HAVE A NAMED ATTACK.
//
//   "This attack does 20 damage for each Pokémon in your discard pile that has the
//    United Wings attack."                      — 1 sentence / 1 LEGAL printing
//                                                 (`censusAttackCorpus.ts` FILE LINE 542)
//
// 🛑 THE WHOLE SLICE IS ONE ANCHOR AND ONE ARM. The COUNT is D440's shipped
// `DamageCountSource.cardsInDiscardPile` and the FILTER is D446's shipped
// `CardFilter.attackNamePokemon`; this sentence is their CROSS PRODUCT and it
// costs **ZERO new members in either union, ZERO new `EffectOp`s and ZERO
// evaluator bytes** — `attack.ts`'s `cardsInDiscardPile` arm has always taken an
// arbitrary `CardFilter`, and `matchesFilter`'s `attackNamePokemon` arm has always
// read `attacksOf(card)`.
//
// 🛑 AND IT OVERTURNS A REFUSAL THAT WAS RIGHT FOR ONE REASON AND HAD ALREADY
// BEEN CORRECTED ONCE. D440's census block listed this row as blocked TWICE —
// once on the ANCHOR (*"the noun is SPLIT AROUND the zone phrase, so the sentence
// does not END at `discard pile.`"*) and once on the FILTER (*"it also needs a
// `CardFilter` member reading `attacksOf`"*). D446 built that member for the
// IN-PLAY twin of this very noun and corrected the second half in place, leaving
// the row *"blocked ONCE where it used to be blocked twice"*. This slice is the
// once. **Both re-pointed refusal rungs — `discardPileScaling.test.ts` §2 and
// `bodiesInPlayScaling.test.ts` §2 — went RED against this build before they were
// rewritten**, which is what a refusal rung is for.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   ⑴ THE ZONE. The count walks the PILE, not the board. The canonical board
//      fields THREE `fix-wingsbody` in the attacker's pile and TWO on the
//      attacker's BENCH, so the in-play walk one `DamageCountSource` member over
//      reads 40 where the print reads 60.
//   ⑵ THE SEAT. `DiscardPileSeat` is CONTROLLER-RELATIVE and the print says
//      *"your discard pile"*, so the count is the ATTACKER's. The defender's pile
//      holds FOUR of the same body: a seat inversion reads 80.
//   ⑶ THE NAME. `attackNamePokemon` is an exact `===` on `attacksOf(card)[].name`.
//      `fix-roundbody` is `fix-wingsbody` one string over — same defaults, same HP,
//      same cost, same absent effect text — and the pile holds ONE, so a build
//      carrying the wrong captured name reads 20.
//   ⑷ THE FILTER'S WIDTH, twice over. `anyPokemon` over the same pile reads 7
//      (140), a build asking `attacksOf(card).length > 0` reads 5 (100), and a
//      build counting the pile's LENGTH reads 8 (160). Seven distinct totals.
//   ⑸ THE ANCHOR. Four printed axes are spelled as LITERALS — the zone phrase,
//      the seat word `your`, the head noun `Pokémon` and the bare `×` fold — and
//      each of the four is driven as a near-miss that differs on exactly ONE axis
//      (D427), together with the measurement that says the column prints each of
//      those spellings ZERO times.
//   ⑹ THE DISJOINTNESS. No corpus row matches more than one of the three anchors
//      this family now owns, so the arm ORDER in `deriveAttackDamageMultiplier`
//      is free. Driven over all 640 rows rather than argued.

/** The one printed sentence, transcribed byte for byte from
    `censusAttackCorpus.ts` FILE LINE 542. */
const PRINTED =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

/** The IN-PLAY twin, shipped at D446. It differs from `PRINTED` on the ZONE and on
    nothing else that this union can see — both derive to the same filter — which is
    what makes it the right control for ⑴. */
const IN_PLAY_TWIN =
  "This attack does 20 damage for each of your Pokémon in play that has the Round attack.";

/** The twelve readers this sentence must NOT reach, so §2 can assert a NAMED owner
    plus eleven kept refusals rather than a bare `resolvedByAnyReader` (D438: a
    negative over a disjunction is a claim about every disjunct; its positive
    replacement is a claim about none of them). */
const OTHERS = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
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

const WINGS: CardFilter = { kind: "attackNamePokemon", attack: "United Wings" };
const ROUND: CardFilter = { kind: "attackNamePokemon", attack: "Round" };
const ANY_POKEMON: CardFilter = { kind: "anyPokemon" };

/** One seed for the whole suite. Nothing here flips a coin and every card in either
    pile and on either board is placed by surgery, so a seed table would describe a
    shuffle rather than a rule. */
const SEED = 1;

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

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared, so
    every number this suite reads is a POPULATION the test put there. One {C} is
    attached to pay the one printed cost. **BOTH PILES ARE EMPTY HERE**, which is
    the board §4 drives for the printed zero. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PILE_ATTACK_NAME_DECK, p2: PILE_ATTACK_NAME_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-pilewings");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

/** 🛑 **THE CANONICAL BOARD — SEVEN WRONG BUILDS, SEVEN DIFFERENT DAMAGE NUMBERS.**

      attacker's pile (8 cards)        attacker IN PLAY     defender's pile (5)
        fix-wingsbody  ×3                Active fix-pilewings  fix-wingsbody ×4
        fix-roundbody  ×1                Bench fix-wingsbody ×2 fix-titan     ×1
        fix-attacker-ex ×1
        fix-benchfiller ×1
        fix-item       ×1
        fix-titan      ×1

    At the printed 20 per card: the print **60**; the NAME wrong 20; the ZONE wrong
    40; the SEAT wrong 80; `anyPokemon` 140; has-attacks 100; the pile LENGTH 160. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = discardFromDeck(state, by, "fix-wingsbody", 3);
  state = discardFromDeck(state, by, "fix-roundbody", 1);
  state = discardFromDeck(state, by, "fix-attacker-ex", 1);
  state = discardFromDeck(state, by, "fix-benchfiller", 1);
  state = discardFromDeck(state, by, "fix-item", 1);
  state = discardFromDeck(state, by, "fix-titan", 1);
  state = benchFromDeck(state, by, "fix-wingsbody");
  state = benchFromDeck(state, by, "fix-wingsbody");
  state = discardFromDeck(state, foe, "fix-wingsbody", 4);
  return discardFromDeck(state, foe, "fix-titan", 1);
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

function dealt(state: GameState, seat: Seat = "p1"): number | undefined {
  return find(swing(state, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the fixture", () => {
  it("the column prints it on exactly ONE record, for exactly ONE legal printing", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows.map(([, s]) => s)).toEqual([PRINTED]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("🛑 the sentence carries NO apostrophe, which is why the anchor spells no `['’]`", () => {
    // D137's insurance applies to a pattern that SPELLS an apostrophe; this one spells
    // none, because the seat token it carries is the bare `your`. Measured with
    // `codePointAt` over the CORPUS row rather than read off the page (D421's byte,
    // D440's habit): the single non-ASCII byte is the real é of `Pokémon`.
    const row = legalAttackCorpus().find(([, s]) => s === PRINTED);
    expect(row).toBeDefined();
    const text = row?.[1] ?? "";
    const exotic = [...text].map((c, i) => [i, c.codePointAt(0) ?? 0] as const).filter(
      ([, cp]) => cp > 127 || cp === 0x27,
    );
    expect(exotic).toEqual([[39, 0x00e9]]);
    expect(text.includes("'")).toBe(false);
    expect(text.includes("’")).toBe(false);
  });

  it("the fixture carries the printed sentence verbatim, with the `×` marker", () => {
    // The whole attack list, so the fixture cannot be wrong by OMISSION (D156).
    // ⚠️ THE TRAILING `×` IS LOAD-BEARING: it tells attack.ts to DROP the printed base,
    // which is what makes the empty-pile board in §4 a ZERO rather than a 20.
    expect(FIXTURE_POOL["fix-pilewings"]?.attacks?.map((a) => [a.name, a.damage, a.effect])).toEqual(
      [["Flock Memory", "20×", PRINTED]],
    );
    // 🛑 AND THE HOLDER'S OWN ATTACK IS NOT THE NAMED ONE — the fixture's single design
    // decision. A holder that counted itself would move the pile number and the board
    // number together and leave ⑴ untestable.
    expect(FIXTURE_POOL["fix-pilewings"]?.attacks?.some((a) => a.name === "United Wings")).toBe(
      false,
    );
    expect(FIXTURE_POOL["fix-wingsbody"]?.attacks?.map((a) => a.name)).toEqual(["United Wings"]);
    expect(FIXTURE_POOL["fix-roundbody"]?.attacks?.map((a) => a.name)).toEqual(["Round"]);
    // The two negatives, and they are DIFFERENT negatives (D446's own pairing, reused):
    // one is false through the empty attack list, one through the NAME.
    expect(FIXTURE_POOL["fix-benchfiller"]?.attacks ?? []).toHaveLength(0);
    expect(FIXTURE_POOL["fix-attacker-ex"]?.attacks?.length ?? 0).toBeGreaterThan(0);
    expect(
      FIXTURE_POOL["fix-attacker-ex"]?.attacks?.some((a) => a.name === "United Wings"),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the named owner, the eleven kept refusals, and the anchor.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor, its owner, and the four literal axes", () => {
  it("🛑 the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the value", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: WINGS },
    });
    for (const reader of OTHERS) expect(reader(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 no splitter composes on it, before OR after this slice", () => {
    // D426's mechanism, driven rather than asserted. The sentence carries no `. `
    // joiner and no leading `If …,`, so there is no composition path any splitter
    // could have claimed a head through — which is also why the readers-only and
    // splitter-inclusive readings of this row's lattice are provably identical.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
  });

  it("🛑 the four printed axes are LITERALS, and each near-miss differs on exactly ONE", () => {
    // D427: a near-miss that differs on more than one axis tests neither. Each of these
    // is `PRINTED` with a single axis moved, and each must stay on the loud
    // ATTACK_EFFECT_SKIPPED path.
    const NEAR: readonly (readonly [string, string])[] = [
      [
        "the SEAT — the opponent's pile",
        "This attack does 20 damage for each Pokémon in your opponent's discard pile that has the United Wings attack.",
      ],
      [
        "the FOLD — the additive spelling",
        "This attack does 20 more damage for each Pokémon in your discard pile that has the United Wings attack.",
      ],
      [
        "the HEAD NOUN — a narrowed Pokémon",
        "This attack does 20 damage for each Basic Pokémon in your discard pile that has the United Wings attack.",
      ],
      [
        "the ZONE — the deck, one noun phrase over",
        "This attack does 20 damage for each Pokémon in your deck that has the United Wings attack.",
      ],
      [
        "the printed ZERO — the guard every arm in both families carries",
        "This attack does 0 damage for each Pokémon in your discard pile that has the United Wings attack.",
      ],
      [
        "a lowercased `this`",
        "this attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.",
      ],
      [
        "a missing trailing period",
        "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack",
      ],
      [
        "leading text",
        "Flip a coin. This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.",
      ],
      [
        "🛑 a TRAILING CLAUSE — the compound the `$` refuses",
        "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack. Then, shuffle your deck.",
      ],
    ];
    for (const [label, text] of NEAR) {
      expect(deriveAttackDamageMultiplier(text), label).toBeNull();
      expect(deriveAttackDamageBonus(text), label).toBeNull();
      expect(resolvedByAnyReader(text), label).toBe(false);
    }
  });

  it("🛑 each refused spelling is printed ZERO times — the arms are not merely unwritten", () => {
    // `IN_PLAY_BODY_NOUNS`' rule: an arm no sentence drives is not written. The three
    // literals above are literals BECAUSE the column prints nothing else, and that is a
    // measurement over all 640 rows rather than a habit. ⚠️ This rung is also the
    // falsifier: the day the column prints one of these, it goes RED and the anchor's
    // narrowness stops being true loudly (D422/D428).
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    const count = (re: RegExp) => corpus.filter(([, s]) => re.test(s)).length;
    expect(count(/opponent['’]s discard pile that has/)).toBe(0);
    expect(count(/more damage for each [^.]* in your discard pile that has/)).toBe(0);
    expect(count(/for each (?!Pokémon in your discard pile)[^.]* in your discard pile that has/)).toBe(0);
    // …and the ADMITTED case on the same axis, so the zeros are not passing because the
    // pattern matches nothing at all (D424: every "X is printed nowhere" owes a "Y is").
    expect(count(/in your discard pile that has the ([^.]+) attack\./)).toBe(1);
  });

  it("🛑 no corpus row reaches two of the three anchors — the arm ORDER is free", () => {
    // The three whole-sentence patterns this family now owns, re-spelled here so the
    // claim is about BEHAVIOUR rather than about a module-private constant: the
    // unnarrowed pile fold, the in-play attack-name fold, and this slice's cross
    // product. Run over all 640 rows rather than argued from their shapes.
    const PILE = /^This attack does (\d+) damage for each ([^.]+) in (your opponent['’]s|your) discard pile\.$/;
    const IN_PLAY = /^This attack does (\d+) damage for each of your Pokémon in play that has the ([^.]+) attack\.$/;
    const CROSS = /^This attack does (\d+) damage for each Pokémon in your discard pile that has the ([^.]+) attack\.$/;
    const doubled = legalAttackCorpus().filter(
      ([, s]) => [PILE.test(s), IN_PLAY.test(s), CROSS.test(s)].filter(Boolean).length > 1,
    );
    expect(doubled).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => CROSS.test(s)).map(([, s]) => s)).toEqual([PRINTED]);
  });

  it("🛑 the IN-PLAY twin still derives to its OWN count, and the two differ only in ZONE", () => {
    // The control that says this slice widened nothing it was not asked to: D446's
    // sentence still answers `pokemonInPlay`, and the two derived values are the same
    // object one `kind` apart. A build that had relaxed the in-play anchor into an
    // alternation over zones would show up here as one reader claiming both.
    expect(deriveAttackDamageMultiplier(IN_PLAY_TWIN)).toEqual({
      per: 20,
      count: { kind: "pokemonInPlay", seat: "you", filter: ROUND },
    });
    expect(deriveAttackDamageMultiplier(PRINTED)?.count.kind).toBe("cardsInDiscardPile");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: seven wrong builds, seven different damage numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the canonical board and the seven separated wrong builds", () => {
  it("the printed swing deals 20 × 3 = 60", () => {
    expect(dealt(canonical())).toBe(60);
  });

  it("🛑 the six wrong builds read six OTHER numbers on the SAME board", () => {
    const state = canonical();
    // ⑶ the NAME: an exact `===` on `attacksOf(card)[].name`.
    expect(countCardsInDiscardPile(state, "p1", ROUND)).toBe(1);
    // ⑵ the SEAT: `DiscardPileSeat` is controller-relative and the print says `your`.
    expect(countCardsInDiscardPile(state, "p2", WINGS)).toBe(4);
    // ⑷ the FILTER's width, twice.
    expect(countCardsInDiscardPile(state, "p1", ANY_POKEMON)).toBe(7);
    expect(state.players.p1.discard).toHaveLength(8);
    // ⑴ the ZONE: the same filter over BODIES IN PLAY, which is the member one case up
    // in `attack.ts`'s own switch.
    expect(countPokemonInPlay(state, "p1", WINGS)).toBe(2);
    // …and the print itself, read through the walk the arm uses.
    expect(countCardsInDiscardPile(state, "p1", WINGS)).toBe(3);
    // Seven DISTINCT counts, asserted as a set so a board edit that collapsed two of
    // them cannot pass by coincidence.
    const counts = [3, 1, 4, 7, 8, 2];
    expect(new Set(counts).size).toBe(counts.length);
    // At 20 per card that is 60 / 20 / 80 / 140 / 160 / 40 — and the defender survives
    // the largest of them, so every rung reads DAMAGE_DEALT rather than a Knock Out.
    expect(FIXTURE_POOL["fix-titan"]?.hp ?? 0).toBeGreaterThan(160);
  });

  it("🛑 the has-attacks near-miss is a FIFTH number, and it is the one a plausible build reads", () => {
    // A build asking `attacksOf(card).length > 0` instead of the NAME counts
    // `fix-attacker-ex` as well as the four named bodies: 5, i.e. 100 damage. It is the
    // wrong build `matchesFilter`'s arm comment names, driven here on a real pile.
    const state = canonical();
    const withAttacks = state.players.p1.discard.filter((uid) => {
      const card = FIXTURE_POOL[state.cardIdByUid[uid] ?? ""];
      return (card?.attacks?.length ?? 0) > 0;
    });
    expect(withAttacks).toHaveLength(5);
    expect(countCardsInDiscardPile(state, "p1", WINGS)).toBe(3);
  });

  it("🛑 the OTHER seat swings the same 60 — the count is CONTROLLER-relative", () => {
    // `DiscardPileSeat.you` is *the seat that declared the attack*, never `p1`, so the
    // SAME derived object must follow the attacker onto the mirrored board. The mirror
    // puts THREE named bodies in p2's pile and FOUR in p1's, so the two candidate
    // readings are different numbers: a build that hard-coded `p1` deals 80 here and a
    // build that read the declaring seat deals 60. Driven on both seats rather than
    // asserted once (D213: one side passing says nothing about the other).
    const mirror = canonical("p2");
    expect(countCardsInDiscardPile(mirror, "p2", WINGS)).toBe(3);
    expect(countCardsInDiscardPile(mirror, "p1", WINGS)).toBe(4);
    expect(dealt(mirror, "p2")).toBe(60);
  });

  it("an empty pile is a LOUD ZERO, and the `×` fold drops the printed base", () => {
    // No DAMAGE_DEALT row at all — the printed floor of a `×` sentence with a zero
    // count, and the rung that says the 60 above came from the count rather than from
    // the base.
    expect(dealt(bare())).toBeUndefined();
    expect(activeOf(swing(bare()).state, "p2").damage).toBe(0);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const before = frozen.players.p1.discard.length;
    const after = swing(frozen);
    expect(frozen.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p2.discard).toHaveLength(5);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census step, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the census step this slice is", () => {
  it("🛑 the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    // D439's rule: the delta of a whole-corpus sweep should equal the slice. Every
    // corpus row whose claim this build could have changed is the one row it names.
    const claimed = legalAttackCorpus().filter(([, s]) => {
      const v = deriveAttackDamageMultiplier(s);
      return (
        v !== null &&
        v.count.kind === "cardsInDiscardPile" &&
        v.count.filter.kind === "attackNamePokemon"
      );
    });
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});
