import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
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
import type { CardFilter, CountSeat } from "./effectTypes";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { countCardsInDiscardPile, countPokemonInPlay } from "./boardCondition";
import {
  FIXTURE_POOL,
  PILE_NAME_FRAGMENT_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  activeOf,
  findEvent,
} from "./testFixtures";

const PRINTED =
  'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.';

/** The printed fragment, and the ONE string this suite's every number turns on. */
const FRAGMENT = "Team Rocket";

const PILE_ATTACK_NAME_TWIN =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

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

const TR_SUPPORTER: CardFilter = { kind: "supporterNameContaining", fragment: FRAGMENT };
const SUPPORTER: CardFilter = { kind: "supporter" };
const TR_BY_NAME: CardFilter = { kind: "byName", name: FRAGMENT };
const ANY_CARD: CardFilter = { kind: "anyCard" };

/** One seed for the whole suite. Nothing here flips a coin and every card in either
    pile and on either board is placed by surgery, so a seed table would describe a
    shuffle rather than a rule. */
const SEED = 1;

function pileCards(state: GameState, seat: Seat) {
  return state.players[seat].discard.map((uid) => FIXTURE_POOL[state.cardIdByUid[uid] ?? ""]);
}

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: PILE_NAME_FRAGMENT_DECK, p2: PILE_NAME_FRAGMENT_DECK },
        { first: foe },
      ),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-pilerocket");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = discardFromDeck(state, by, "fix-trsupporter", 2);
  state = discardFromDeck(state, by, "fix-trgrunt", 1);
  state = discardFromDeck(state, by, "fix-trtransceiver", 2);
  state = discardFromDeck(state, by, "fix-ethansadventure", 1);
  state = discardFromDeck(state, by, "fix-titan", 2);
  return discardFromDeck(state, foe, "fix-trsupporter", 6);
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

function dealt(state: GameState, seat: Seat = "p1"): number | undefined {
  return findEvent(swing(state, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the fixtures", () => {
  it("the column prints it on exactly ONE record, for exactly TWO legal printings", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows.map(([, s]) => s)).toEqual([PRINTED]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it('the printed delimiters are ASCII U+0022, on ALL THREE rows that print "… in its name"', () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("in its name"));
    expect(family.map(([, s]) => s).sort()).toEqual(
      [
        'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.',
        PRINTED,
        'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).',
      ].sort(),
    );
    expect(family).toHaveLength(3);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(5);
    for (const [, text] of family) {
      const quotes = [...text]
        .map((c, i) => [i, c.codePointAt(0) ?? 0] as const)
        .filter(([, cp]) => cp === 0x22 || cp === 0x201c || cp === 0x201d);
      expect(quotes.length % 2).toBe(0);
      expect(quotes.length).toBeGreaterThanOrEqual(2);
      expect(new Set(quotes.map(([, cp]) => cp))).toEqual(new Set([0x22]));
    }
    expect(PRINTED.includes("'")).toBe(false);
    expect(PRINTED.includes("’")).toBe(false);
  });

  it("the holder carries the printed sentence verbatim, with the `×` marker", () => {
    expect(
      FIXTURE_POOL["fix-pilerocket"]?.attacks?.map((a) => [a.name, a.damage, a.effect]),
    ).toEqual([["Rocket Dossier", "20×", PRINTED]]);
    expect(FIXTURE_POOL["fix-pilerocket"]?.category).toBe("Pokemon");
  });

  it("the four pile fixtures answer FOUR DIFFERENT SUBSETS of the two conjuncts", () => {
    const table = [
      ["fix-trsupporter", true, true, true],
      ["fix-trgrunt", true, true, false],
      ["fix-trtransceiver", false, true, true],
      ["fix-ethansadventure", true, false, false],
    ] as const;
    for (const [id, isSupporter, contains, starts] of table) {
      const card = FIXTURE_POOL[id];
      expect([id, matchesFilter(card, SUPPORTER)]).toEqual([id, isSupporter]);
      expect([id, card?.name.includes(FRAGMENT) ?? false]).toEqual([id, contains]);
      expect([id, card?.name.startsWith(FRAGMENT) ?? false]).toEqual([id, starts]);
      // …and the member itself is exactly the CONJUNCTION of the first two columns.
      expect([id, matchesFilter(card, TR_SUPPORTER)]).toEqual([id, isSupporter && contains]);
    }
    expect(FIXTURE_POOL["fix-trgrunt"]?.name.indexOf(FRAGMENT)).toBeGreaterThan(0);
    expect(FIXTURE_POOL["fix-trsupporter"]?.name.indexOf(FRAGMENT)).toBe(0);
    // …and the printed fragment is a PROPER substring of both, never the whole name —
    // the reason `byName`'s exact read answers 0 on this pile.
    expect(FIXTURE_POOL["fix-trsupporter"]?.name).not.toBe(FRAGMENT);
    expect(matchesFilter(FIXTURE_POOL["fix-trsupporter"], TR_BY_NAME)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the named owner, the kept refusals, the resolver and the axes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the resolver, its owner, and the three live axes", () => {
  it("the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the value", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
    for (const reader of OTHERS) expect(reader(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("no splitter composes on it, before OR after this slice", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
  });

  it("the three LIVE axes are literals, and each near-miss differs on exactly ONE", () => {
    const NEAR: readonly (readonly [string, string])[] = [
      [
        "the HEAD NOUN — an Item card, the neighbouring printed Trainer subtype",
        'This attack does 20 damage for each Item card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the HEAD NOUN — the bare category",
        'This attack does 20 damage for each Trainer card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the PREDICATE — a printed ATTACK name, D508's shipped narrowing",
        "This attack does 20 damage for each Supporter card that has the Round attack in your discard pile.",
      ],
      [
        "the WORD ORDER — the narrowing AFTER the zone, D508's shipped shape",
        'This attack does 20 damage for each Supporter card in your discard pile that has "Team Rocket" in its name.',
      ],
      [
        "🛑 LEADING TEXT INSIDE THE NOUN — the printed banner adjective, which the column DOES spell elsewhere",
        'This attack does 20 damage for each Ancient Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the QUOTES — the fragment unquoted",
        "This attack does 20 damage for each Supporter card that has Team Rocket in its name in your discard pile.",
      ],
      [
        "the EMPTY fragment — the one value that would match every Supporter",
        'This attack does 20 damage for each Supporter card that has "" in its name in your discard pile.',
      ],
      [
        "the printed ZERO — the guard every arm in both families carries",
        'This attack does 0 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "a lowercased `this`",
        'this attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "a missing trailing period",
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile',
      ],
      [
        "leading text",
        'Flip a coin. This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "🛑 a TRAILING CLAUSE — the compound the `$` refuses",
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile. Then, shuffle your deck.',
      ],
    ];
    for (const [label, text] of NEAR) {
      expect(deriveAttackDamageMultiplier(text), label).toBeNull();
      expect(deriveAttackDamageBonus(text), label).toBeNull();
      expect(resolvedByAnyReader(text), label).toBe(false);
    }
  });

  it("each refused spelling is printed ZERO times — the arms are not merely unwritten", () => {
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    const count = (re: RegExp) => corpus.filter(([, s]) => re.test(s)).length;
    // ⑴ the HEAD NOUN: no OTHER noun is printed in front of a quoted-fragment narrowing
    //    inside a discard-pile fold…
    expect(
      count(/for each (?!Supporter card that has ")[^.]* that has "[^"]+" in its name in your/),
    ).toBe(0);
    // ⑵ the PREDICATE: `Supporter card` is printed with NO other narrowing in this zone…
    expect(
      count(/for each Supporter card (?!that has "Team Rocket" in its name)[^.]*discard pile/),
    ).toBe(0);
    // ⑶ the WORD ORDER: the fragment narrowing is never printed AFTER the zone phrase…
    expect(count(/discard pile that has "[^"]+" in its name/)).toBe(0);
    expect(
      count(/for each Supporter card that has "[^"]+" in its name in your discard pile\./),
    ).toBe(1);
    // …and the printed narrowing the column DOES put after the zone phrase, which is
    // what makes ⑶ a statement about the FRAGMENT rather than about the position.
    expect(count(/discard pile that has the [^.]+ attack\./)).toBe(1);
  });

  it("the LITERAL table still wins, and the two branches cannot both be reached", () => {
    const KEYS = ["Energy card", "Basic Energy card", "Item card", "Ethan's Adventure card"];
    for (const key of KEYS) {
      expect([key, /^Supporter card that has "([^"]+)" in its name$/.test(key)]).toEqual([
        key,
        false,
      ]);
      // …and each key still resolves through the map, unchanged by the new branch.
      expect(
        deriveAttackDamageMultiplier(
          `This attack does 30 damage for each ${key} in your discard pile.`,
        ),
      ).not.toBeNull();
    }
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
  });

  it("D508's row still derives to its OWN filter — this slice widened nothing", () => {
    expect(deriveAttackDamageMultiplier(PILE_ATTACK_NAME_TWIN)).toEqual({
      per: 20,
      count: {
        kind: "cardsInDiscardPile",
        seat: "you",
        filter: { kind: "attackNamePokemon", attack: "United Wings" },
      },
    });
    const mine = deriveAttackDamageMultiplier(PRINTED)?.count;
    expect(mine?.kind === "cardsInDiscardPile" ? mine.filter.kind : null).toBe(
      "supporterNameContaining",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: seven wrong builds, seven different numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the canonical board and the seven separated wrong builds", () => {
  it("the printed swing deals 20 × 3 = 60", () => {
    expect(dealt(canonical())).toBe(60);
  });

  it("the six wrong builds read six OTHER numbers on the SAME board", () => {
    const state = canonical();
    // the print, read through the walk the arm uses.
    expect(countCardsInDiscardPile(state, "p1", TR_SUPPORTER)).toBe(3);
    // ⑵ the FRAGMENT dropped: bare `supporter` over the same pile.
    expect(countCardsInDiscardPile(state, "p1", SUPPORTER)).toBe(4);
    // ⑷ the exact `byName` read of the same string.
    expect(countCardsInDiscardPile(state, "p1", TR_BY_NAME)).toBe(0);
    // ⑸ the SEAT: `DiscardPileSeat` is controller-relative and the print says `your`.
    expect(countCardsInDiscardPile(state, "p1", ANY_CARD)).toBe(8);
    expect(countCardsInDiscardPile(state, "p2", TR_SUPPORTER)).toBe(6);
    const cards = pileCards(state, "p1");
    expect(cards).toHaveLength(8);
    // ⑶ the prefix build: the SAME head-noun conjunct, `startsWith` instead of
    // `includes`. `fix-trgrunt` is the only card the two readings disagree about.
    expect(
      cards.filter((c) => matchesFilter(c, SUPPORTER) && (c?.name.startsWith(FRAGMENT) ?? false)),
    ).toHaveLength(2);
    // ⑴ the head noun dropped: the fragment alone, over every card class. The two
    // `fix-trtransceiver` are Items and the print excludes them.
    expect(cards.filter((c) => c?.name.includes(FRAGMENT) ?? false)).toHaveLength(5);
    // Seven DISTINCT counts, asserted as a set so a board edit that collapsed two of
    // them cannot pass by coincidence.
    const counts = [3, 4, 0, 8, 6, 2, 5];
    expect(new Set(counts).size).toBe(counts.length);
    // At 20 per card that is 60 / 80 / — / 160 / 120 / 40 / 100, and the defender
    // survives the largest of them, so every rung reads DAMAGE_DEALT, not a Knock Out.
    expect(FIXTURE_POOL["fix-titan"]?.hp ?? 0).toBeGreaterThan(160);
  });

  it("⑹ THE ZONE IS A LOUD ZERO, which is the OPPOSITE of D508's zone control", () => {
    const state = canonical();
    expect(countPokemonInPlay(state, "p1", TR_SUPPORTER)).toBe(0);
    expect(countPokemonInPlay(state, "p1", SUPPORTER)).toBe(0);
    expect(state.players.p1.bench.filter((b) => b !== null)).toHaveLength(0);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" })).toBe(1);
  });

  it("the OTHER seat swings the same 60 — the count is CONTROLLER-relative", () => {
    const mirror = canonical("p2");
    expect(countCardsInDiscardPile(mirror, "p2", TR_SUPPORTER)).toBe(3);
    expect(countCardsInDiscardPile(mirror, "p1", TR_SUPPORTER)).toBe(6);
    expect(dealt(mirror, "p2")).toBe(60);
  });

  it("an empty pile is a LOUD ZERO, and the `×` fold drops the printed base", () => {
    expect(dealt(bare())).toBeUndefined();
    expect(activeOf(swing(bare()).state, "p2").damage).toBe(0);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const before = frozen.players.p1.discard.length;
    const after = swing(frozen);
    expect(frozen.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p2.discard).toHaveLength(6);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(60);
  });
});

describe("§4 — the census step this slice is", () => {
  it("the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => {
      const v = deriveAttackDamageMultiplier(s) ?? deriveAttackDamageBonus(s);
      return (
        v !== null &&
        v.count.kind === "cardsInDiscardPile" &&
        v.count.filter.kind === "supporterNameContaining"
      );
    });
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it("the lattice subtraction, keyed on the DERIVED VALUE rather than on the anchor", () => {
    const NOUN = ["Supporter card", "Pokémon"] as const;
    const PRED = [`that has "${FRAGMENT}" in its name`, "that has the Round attack"] as const;
    const SEAT = ["your", "your opponent's"] as const;
    const FOLD = ["damage", "more damage"] as const;
    const point = (b: number): string => {
      const noun = NOUN[b & 1] ?? "";
      const pred = PRED[(b >> 1) & 1] ?? "";
      const seat = SEAT[(b >> 3) & 1] ?? "";
      const fold = FOLD[(b >> 4) & 1] ?? "";
      return ((b >> 2) & 1) === 0
        ? `This attack does 20 ${fold} for each ${noun} ${pred} in ${seat} discard pile.`
        : `This attack does 20 ${fold} for each ${noun} in ${seat} discard pile ${pred}.`;
    };
    const points = [...Array(32).keys()].map(point);
    expect(new Set(points).size).toBe(32);
    expect(points[0]).toBe(PRINTED);
    const claimed = points.filter((s) => {
      const v = deriveAttackDamageMultiplier(s) ?? deriveAttackDamageBonus(s);
      return (
        v !== null &&
        v.count.kind === "cardsInDiscardPile" &&
        v.count.filter.kind === "supporterNameContaining"
      );
    });
    // THE FOUR POINTS THIS BUILD ADDED: the printed one, plus the two axes the shipped
    // anchor pair already varies on its own (SEAT and FOLD) — which is precisely why
    // those two flip 1/16 on the flip table and the other three flip 5/16.
    expect(claimed.sort()).toEqual(
      [
        PRINTED,
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
        'This attack does 20 more damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
        'This attack does 20 more damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
      ].sort(),
    );
    const built = points.filter((s) => resolvedByAnyReader(s));
    expect(built).toHaveLength(5);
    expect(built.filter((s) => !claimed.includes(s))).toEqual([
      "This attack does 20 damage for each Pokémon in your discard pile that has the Round attack.",
    ]);
    for (const s of points) {
      expect(splitAttackGateClause(s), s).toBeNull();
      expect(splitAttackTrailingClause(s), s).toBeNull();
    }
  });

  it("`:583` IS BUILT AT D512 — the refusal is RE-POINTED, and its falsifier REPAIRED", () => {
    const twin =
      'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).';
    const rows = legalAttackCorpus().filter(([, s]) => s === twin);
    expect(rows.map(([, s]) => s)).toEqual([twin]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(resolvedByAnyReader(twin)).toBe(true);
    expect(deriveAttackDamageMultiplier(twin)?.count.kind).toBe("bothSidesPokemonInPlay");
    // …and the RETURN TYPE, which is why a composition was never available: ONE count,
    // not a list. A build that summed two counts would have had to change this shape.
    const derived = deriveAttackDamageMultiplier(twin);
    expect(Array.isArray(derived?.count)).toBe(false);
    expect(Object.keys(derived ?? {}).sort()).toEqual(["count", "per"]);
    const SEATS: Record<CountSeat, Seat> = { you: "p1", opponent: "p2" };
    expect(Object.keys(SEATS).sort()).toEqual(["opponent", "you"]);
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
    expect(
      deriveAttackDamageMultiplier(
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
      ),
    ).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: TR_SUPPORTER },
    });
  });
});
