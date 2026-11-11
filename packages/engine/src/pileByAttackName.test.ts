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
import type { CardFilter } from "./effectTypes";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { countCardsInDiscardPile, countPokemonInPlay } from "./boardCondition";
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
  activeOf,
  findEvent,
} from "./testFixtures";

const PRINTED =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

const IN_PLAY_TWIN =
  "This attack does 20 damage for each of your Pokémon in play that has the Round attack.";

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
  return findEvent(swing(state, seat).events, "DAMAGE_DEALT")?.dealt;
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

  it("the sentence carries NO apostrophe, which is why the anchor spells no `['’]`", () => {
    const row = legalAttackCorpus().find(([, s]) => s === PRINTED);
    expect(row).toBeDefined();
    const text = row?.[1] ?? "";
    const exotic = [...text]
      .map((c, i) => [i, c.codePointAt(0) ?? 0] as const)
      .filter(([, cp]) => cp > 127 || cp === 0x27);
    expect(exotic).toEqual([[39, 0x00e9]]);
    expect(text.includes("'")).toBe(false);
    expect(text.includes("’")).toBe(false);
  });

  it("the fixture carries the printed sentence verbatim, with the `×` marker", () => {
    expect(
      FIXTURE_POOL["fix-pilewings"]?.attacks?.map((a) => [a.name, a.damage, a.effect]),
    ).toEqual([["Flock Memory", "20×", PRINTED]]);
    expect(FIXTURE_POOL["fix-pilewings"]?.attacks?.some((a) => a.name === "United Wings")).toBe(
      false,
    );
    expect(FIXTURE_POOL["fix-wingsbody"]?.attacks?.map((a) => a.name)).toEqual(["United Wings"]);
    expect(FIXTURE_POOL["fix-roundbody"]?.attacks?.map((a) => a.name)).toEqual(["Round"]);
    expect(FIXTURE_POOL["fix-benchfiller"]?.attacks ?? []).toHaveLength(0);
    expect(FIXTURE_POOL["fix-attacker-ex"]?.attacks?.length ?? 0).toBeGreaterThan(0);
    expect(FIXTURE_POOL["fix-attacker-ex"]?.attacks?.some((a) => a.name === "United Wings")).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the named owner, the eleven kept refusals, and the anchor.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor, its owner, and the four literal axes", () => {
  it("the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the value", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: WINGS },
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

  it("the four printed axes are LITERALS, and each near-miss differs on exactly ONE", () => {
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

  it("each refused spelling is printed ZERO times — the arms are not merely unwritten", () => {
    const corpus = legalAttackCorpus();
    const count = (re: RegExp) => corpus.filter(([, s]) => re.test(s)).length;
    expect(count(/opponent['’]s discard pile that has/)).toBe(0);
    expect(count(/more damage for each [^.]* in your discard pile that has/)).toBe(0);
    expect(
      count(/for each (?!Pokémon in your discard pile)[^.]* in your discard pile that has/),
    ).toBe(0);
    expect(count(/in your discard pile that has the ([^.]+) attack\./)).toBe(1);
  });

  it("no corpus row reaches two of the three anchors — the arm ORDER is free", () => {
    const PILE =
      /^This attack does (\d+) damage for each ([^.]+) in (your opponent['’]s|your) discard pile\.$/;
    const IN_PLAY =
      /^This attack does (\d+) damage for each of your Pokémon in play that has the ([^.]+) attack\.$/;
    const CROSS =
      /^This attack does (\d+) damage for each Pokémon in your discard pile that has the ([^.]+) attack\.$/;
    const doubled = legalAttackCorpus().filter(
      ([, s]) => [PILE.test(s), IN_PLAY.test(s), CROSS.test(s)].filter(Boolean).length > 1,
    );
    expect(doubled).toEqual([]);
    expect(
      legalAttackCorpus()
        .filter(([, s]) => CROSS.test(s))
        .map(([, s]) => s),
    ).toEqual([PRINTED]);
  });

  it("the IN-PLAY twin still derives to its OWN count, and the two differ only in ZONE", () => {
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

  it("the six wrong builds read six OTHER numbers on the SAME board", () => {
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

  it("the has-attacks near-miss is a FIFTH number, and it is the one a plausible build reads", () => {
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

  it("the OTHER seat swings the same 60 — the count is CONTROLLER-relative", () => {
    const mirror = canonical("p2");
    expect(countCardsInDiscardPile(mirror, "p2", WINGS)).toBe(3);
    expect(countCardsInDiscardPile(mirror, "p1", WINGS)).toBe(4);
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
    expect(after.state.players.p2.discard).toHaveLength(5);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(60);
  });
});

describe("§4 — the census step this slice is", () => {
  it("the row moved from the residue to the built set, and it is the ONLY one that did", () => {
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
});
