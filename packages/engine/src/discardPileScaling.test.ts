import { HIDDEN_CARD_ID } from "@colorless/schema";
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
import { programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, countCardsInDiscardPile } from "./interpreter";
import {
  DISCARD_PILE_COUNT_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const ENERGY_PILE = "This attack does 20 more damage for each Energy card in your discard pile.";
const ETHAN_PILE =
  "This attack does 60 more damage for each Ethan's Adventure card in your discard pile.";
const FOE_BASIC_PILE =
  "This attack does 30 damage for each Basic Energy card in your opponent's discard pile.";
const FOE_ITEM_PILE =
  "This attack does 30 damage for each Item card in your opponent's discard pile.";

/** The four, in fixture-attack order. */
const CLAIMED = [ENERGY_PILE, ETHAN_PILE, FOE_BASIC_PILE, FOE_ITEM_PILE] as const;

const ANCIENT_PILE = "This attack does 10 more damage for each Ancient card in your discard pile.";
const FUTURE_PILE = "This attack does 10 more damage for each Future card in your discard pile.";

const TR_NAME_PILE =
  'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.';

const UNITED_WINGS_PILE =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

const COUNTER_PLACEMENT_PILE =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

const CONSTRUCTED_SCALE_FOES =
  "This attack does 40 more damage for each Item card in your opponent's discard pile.";
const CONSTRUCTED_MULTIPLY_YOURS =
  "This attack does 40 damage for each Energy card in your discard pile.";

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

/** One seed for the whole suite. Nothing here flips a coin and every card in either
    pile is placed by surgery, so a seed table would describe a shuffle rather than a
    rule. */
const SEED = 1;

const ANY_ENERGY: CardFilter = { kind: "anyEnergy" };
const BASIC_ENERGY: CardFilter = { kind: "basicEnergy" };
const ITEM: CardFilter = { kind: "item" };
const ETHAN_BY_NAME: CardFilter = { kind: "byName", name: "Ethan's Adventure" };

/** The four printed filters, in the same order as `CLAIMED`. */
const FILTERS: readonly CardFilter[] = [ANY_ENERGY, ETHAN_BY_NAME, BASIC_ENERGY, ITEM];

/** The four in NOUN order (any / basic / item / byName), which is the order the pile
    tables in §3 read — deliberately NOT the attack order, so a rung that transcribed
    one list into the other's slot is a different number rather than a coincidence. */
const NOUNS: readonly CardFilter[] = [ANY_ENERGY, BASIC_ENERGY, ITEM, ETHAN_BY_NAME];

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

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: DISCARD_PILE_COUNT_DECK, p2: DISCARD_PILE_COUNT_DECK },
        { first: foe },
      ),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-discardpile");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = discardFromDeck(state, by, "fix-energy", 2);
  state = discardFromDeck(state, by, "fix-special", 1);
  state = discardFromDeck(state, by, "fix-ethansadv", 1);
  state = discardFromDeck(state, by, "fix-ethansadventure", 1);
  state = discardFromDeck(state, by, "fix-item", 1);
  state = discardFromDeck(state, by, "fix-titan", 1);
  state = discardFromDeck(state, foe, "fix-fire-energy", 2);
  state = discardFromDeck(state, foe, "fix-energy", 1);
  state = discardFromDeck(state, foe, "fix-special", 1);
  state = discardFromDeck(state, foe, "fix-item", 2);
  state = discardFromDeck(state, foe, "fix-ethansadventure", 1);
  return discardFromDeck(state, foe, "fix-titan", 1);
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

describe("§1 — the four printed sentences, their population, and the fixture", () => {
  it("the column prints the four on four records, 8 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1, 1]);
    expect(rows.map((r) => r.reduce((sum, [n]) => sum + n, 0))).toEqual([2, 2, 2, 2]);
    expect(rows.flat().reduce((sum, [n]) => sum + n, 0)).toBe(8);
  });

  it("the WHOLE 'for each … discard pile' family, printed whole and classified", () => {
    const family = legalAttackCorpus()
      .filter(([, s]) => s.includes("for each") && s.includes("discard pile"))
      .map(([, s]) => s)
      .sort();
    expect(family).toEqual(
      [
        ENERGY_PILE,
        ETHAN_PILE,
        FOE_BASIC_PILE,
        FOE_ITEM_PILE,
        ANCIENT_PILE,
        TR_NAME_PILE,
        UNITED_WINGS_PILE,
        COUNTER_PLACEMENT_PILE,
      ].sort(),
    );
    expect(family).toHaveLength(8);
  });

  it("carries fix-discardpile's four printed attacks, `×` and `+` markers included", () => {
    expect(FIXTURE_POOL["fix-discardpile"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["20+", ENERGY_PILE],
      ["60+", ETHAN_PILE],
      ["30×", FOE_BASIC_PILE],
      ["30×", FOE_ITEM_PILE],
    ]);
    expect(FIXTURE_POOL["fix-ethansadv"]?.name).toBe("Ethan's Adventure");
    expect(FIXTURE_POOL["fix-ethansadventure"]?.name).toBe("fix-ethansadventure");
    expect(FIXTURE_POOL["fix-ethansadv"]?.trainerType).toBe("Supporter");
    expect(FIXTURE_POOL["fix-ethansadventure"]?.trainerType).toBe("Supporter");
  });

  it("AUTHORS nothing — every printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the claim
    // that says the text path is the one being driven below.
    expect(programFor("fix-discardpile")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the two anchors, the vocabulary, and the seat/fold confound.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the two anchors, the vocabulary, and the seat/fold confound", () => {
  it("reads each printed noun as the `CardFilter` member that already spelled it", () => {
    expect(deriveAttackDamageBonus(ENERGY_PILE)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ANY_ENERGY },
    });
    expect(deriveAttackDamageBonus(ETHAN_PILE)).toEqual({
      per: 60,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ETHAN_BY_NAME },
    });
    expect(deriveAttackDamageMultiplier(FOE_BASIC_PILE)).toEqual({
      per: 30,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: BASIC_ENERGY },
    });
    expect(deriveAttackDamageMultiplier(FOE_ITEM_PILE)).toEqual({
      per: 30,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: ITEM },
    });
  });

  it("`basicEnergy` is UNTYPED here, which the printed noun decides", () => {
    const bonus = deriveAttackDamageMultiplier(FOE_BASIC_PILE);
    expect(bonus?.count).toEqual({
      kind: "cardsInDiscardPile",
      seat: "opponent",
      filter: { kind: "basicEnergy" },
    });
    expect((bonus?.count as { filter: { energyType?: string } }).filter.energyType).toBeUndefined();
  });

  it("THE SEAT/FOLD CONFOUND, MEASURED — and then broken on CONSTRUCTED text", () => {
    const claimed = legalAttackCorpus().filter(([, s]) =>
      (CLAIMED as readonly string[]).includes(s),
    );
    expect(claimed).toHaveLength(4);
    for (const [, s] of claimed) {
      const bonus = deriveAttackDamageBonus(s);
      const multiply = deriveAttackDamageMultiplier(s);
      const read = bonus ?? multiply;
      expect(read).not.toBeNull();
      const seat = (read?.count as { seat: string }).seat;
      expect(bonus === null ? "opponent" : "you", `${s} breaks the confound`).toBe(seat);
    }

    expect(legalAttackCorpus().some(([, s]) => s === CONSTRUCTED_SCALE_FOES)).toBe(false);
    expect(legalAttackCorpus().some(([, s]) => s === CONSTRUCTED_MULTIPLY_YOURS)).toBe(false);
    expect(deriveAttackDamageBonus(CONSTRUCTED_SCALE_FOES)).toEqual({
      per: 40,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: ITEM },
    });
    expect(deriveAttackDamageMultiplier(CONSTRUCTED_MULTIPLY_YOURS)).toEqual({
      per: 40,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ANY_ENERGY },
    });
  });

  it("the ONE vocabulary refusal that is left, and the one that stopped being one", () => {
    expect(deriveAttackDamageBonus(FUTURE_PILE)).toBeNull();
    expect(deriveAttackDamageMultiplier(FUTURE_PILE.replace("more damage", "damage"))).toBeNull();
    expect(resolvedByAnyReader(FUTURE_PILE)).toBe(false);
    expect(deriveAttackDamageBonus(ANCIENT_PILE)).toEqual({
      per: 10,
      count: {
        kind: "cardsInDiscardPile",
        seat: "you",
        filter: { kind: "bannerCard", banner: "Ancient" },
      },
    });
    expect(deriveAttackDamageMultiplier(ANCIENT_PILE)).toBeNull();
    // …and the one that moved, asserted AT THE VALUE rather than dropped from the file,
    // so this rung now pins the DIRECTION of the change as well as the survivor.
    expect(deriveAttackDamageMultiplier(TR_NAME_PILE)).toEqual({
      per: 20,
      count: {
        kind: "cardsInDiscardPile",
        seat: "you",
        filter: { kind: "supporterNameContaining", fragment: "Team Rocket" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each Item card in your discard pile.",
      ),
    ).toEqual({
      per: 10,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ITEM },
    });
  });

  it("the United Wings row is claimed by a THIRD anchor, and NOT by either of ours", () => {
    expect(UNITED_WINGS_PILE.endsWith("discard pile.")).toBe(false);
    // The MULTIPLY fold, and the filter is `attackNamePokemon` — NOT one of this file's
    // four nouns, which is what says the new arm and not a widened map claimed it.
    expect(deriveAttackDamageMultiplier(UNITED_WINGS_PILE)).toEqual({
      per: 20,
      count: {
        kind: "cardsInDiscardPile",
        seat: "you",
        filter: { kind: "attackNamePokemon", attack: "United Wings" },
      },
    });
    const count = deriveAttackDamageMultiplier(UNITED_WINGS_PILE)?.count;
    // `"filter" in count` rather than a cast: three members of this union carry no
    // filter at all, and the narrowing is what says so out loud.
    const filter = count !== undefined && "filter" in count ? count.filter : null;
    expect(filter).not.toBeNull();
    for (const noun of NOUNS) expect(filter).not.toEqual(noun);
    expect(deriveAttackDamageBonus(UNITED_WINGS_PILE)).toBeNull();
    expect(
      legalAttackCorpus().filter(([, text]) => {
        const value = deriveAttackDamageMultiplier(text);
        return (
          value !== null &&
          value.count.kind === "cardsInDiscardPile" &&
          value.count.filter.kind === "attackNamePokemon"
        );
      }),
    ).toHaveLength(1);
  });

  it("the whole-sentence anchor holds at both ends, on the capital, and on the zero", () => {
    const NEAR = [
      // a lowercased "this"
      "this attack does 20 more damage for each Energy card in your discard pile.",
      // a missing trailing period
      "This attack does 20 more damage for each Energy card in your discard pile",
      // leading text
      "Flip a coin. This attack does 20 more damage for each Energy card in your discard pile.",
      // a printed 0 — the guard every arm in both families carries
      "This attack does 0 more damage for each Energy card in your discard pile.",
      "This attack does 0 damage for each Item card in your opponent's discard pile.",
      // the DECK, not the pile — one noun phrase over, and printed nowhere in this shape
      "This attack does 20 more damage for each Energy card in your deck.",
      // a THIRD seat phrasing the anchor does not spell
      "This attack does 20 more damage for each Energy card in each discard pile.",
      "This attack does 20 more damage for each Energy card in your discard pile. Then, shuffle your deck.",
      "This attack does 30 damage for each Item card in your opponent's discard pile. Discard the top card of your deck.",
    ];
    for (const text of NEAR) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
    }
  });

  it("the U+2019 spelling resolves IDENTICALLY, and the KEY is why that is a rung", () => {
    const curly = (s: string) => s.replaceAll("'", "’");
    for (const text of CLAIMED) {
      expect(deriveAttackDamageBonus(curly(text))).toEqual(deriveAttackDamageBonus(text));
      expect(deriveAttackDamageMultiplier(curly(text))).toEqual(deriveAttackDamageMultiplier(text));
    }
    // …and at least one of them still says something, so the equality is not four nulls
    // agreeing with four nulls.
    expect(deriveAttackDamageBonus(curly(ETHAN_PILE))?.count).toEqual({
      kind: "cardsInDiscardPile",
      seat: "you",
      filter: ETHAN_BY_NAME,
    });
    expect(deriveAttackDamageMultiplier(curly(FOE_ITEM_PILE))?.per).toBe(30);
  });

  it("the sentences are claimed by EXACTLY the two readers named, and refused by the rest", () => {
    for (const text of [ENERGY_PILE, ETHAN_PILE]) {
      expect(deriveAttackDamageBonus(text)).not.toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    for (const text of [FOE_BASIC_PILE, FOE_ITEM_PILE]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    for (const text of [TR_NAME_PILE]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    for (const text of [ANCIENT_PILE]) {
      expect(deriveAttackDamageBonus(text)).not.toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    expect(deriveAttackDamageBonus(COUNTER_PLACEMENT_PILE)).toBeNull();
    expect(deriveAttackDamageMultiplier(COUNTER_PLACEMENT_PILE)).toBeNull();
    // The owner is NAMED and the other ten are still refused one by one — the same
    // thirteen-way shape the five claimed rows above are asserted through, with the one
    // reader that took it lifted out by identity rather than the loop weakened.
    for (const reader of OTHERS.filter((r) => r !== deriveAttackEffect)) {
      expect(reader(COUNTER_PLACEMENT_PILE)).toBeNull();
    }
    expect(OTHERS.filter((r) => r !== deriveAttackEffect)).toHaveLength(10);
    expect(resolvedByAnyReader(COUNTER_PLACEMENT_PILE)).toBe(true);
    expect(deriveAttackEffect(COUNTER_PLACEMENT_PILE)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
  });

  it("no splitter composes on any of the eight, before OR after this slice", () => {
    for (const text of [
      ENERGY_PILE,
      ETHAN_PILE,
      FOE_BASIC_PILE,
      FOE_ITEM_PILE,
      ANCIENT_PILE,
      TR_NAME_PILE,
      UNITED_WINGS_PILE,
      COUNTER_PLACEMENT_PILE,
    ]) {
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackCancelClause(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real pile: the zone, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countCardsInDiscardPile`: the pile, seat-relative, filtered", () => {
  it("the canonical piles answer 3 / 2 / 1 / 1 and 4 / 3 / 2 / 0", () => {
    const state = canonical();
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p1", f))).toEqual([3, 2, 1, 1]);
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p2", f))).toEqual([4, 3, 2, 0]);
  });

  it("every NEIGHBOURING filter answers a different number on the same piles", () => {
    // ⑷ driven rather than argued: the four printed members against the three nearest
    // members nobody printed here, plus the pile LENGTH, which is what a build that
    // skipped the noun phrase entirely would read.
    const state = canonical();
    expect(countCardsInDiscardPile(state, "p1", { kind: "supporter" })).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", { kind: "supporter" })).toBe(1);
    expect(countCardsInDiscardPile(state, "p1", { kind: "trainerCard" })).toBe(3);
    expect(countCardsInDiscardPile(state, "p2", { kind: "trainerCard" })).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", { kind: "specialEnergy" })).toBe(1);
    expect(state.players.p1.discard).toHaveLength(7);
    expect(state.players.p2.discard).toHaveLength(8);
  });

  it("THE PRINT, NEVER THE PROVISION — §6.5 on the one card that shows it", () => {
    const state = canonical();
    expect(countCardsInDiscardPile(state, "p1", ANY_ENERGY)).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", BASIC_ENERGY)).toBe(2);
    expect(
      countCardsInDiscardPile(state, "p1", { kind: "providesEnergy", energyType: "Water" }),
    ).toBe(0);
    expect(
      countCardsInDiscardPile(state, "p2", { kind: "providesEnergy", energyType: "Fire" }),
    ).toBe(0);
  });

  it("an EMPTY pile is 0 and an UNRESOLVABLE uid contributes 0, on every filter", () => {
    // Both are properties of the walk rather than of any board a game can reach, so
    // they are driven on the function. `cardOfUid` returns undefined for a uid the
    // catalog cannot resolve and `matchesFilter`'s first line answers false for it.
    const empty = bare();
    expect(NOUNS.map((f) => countCardsInDiscardPile(empty, "p1", f))).toEqual([0, 0, 0, 0]);
    const state = canonical();
    const haunted: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, discard: [...state.players.p1.discard, "p1#ghost"] },
      },
    };
    expect(haunted.players.p1.discard).toHaveLength(8);
    expect(NOUNS.map((f) => countCardsInDiscardPile(haunted, "p1", f))).toEqual([3, 2, 1, 1]);
  });

  it("the GENERALISED walk and D376's threshold cannot disagree", () => {
    const state = canonical();
    // The defender's pile holds two Basic {R} and one Basic {C}, so the typed reading is
    // 2 and the untyped one is 3 — which is also the `energyType` rung ⑷ in miniature.
    const typed: CardFilter = { kind: "basicEnergy", energyType: "Fire" };
    expect(countCardsInDiscardPile(state, "p2", typed)).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", BASIC_ENERGY)).toBe(3);
    for (const count of [0, 1, 2, 3]) {
      expect(
        conditionHolds(state, "p2", {
          kind: "yourBasicEnergyInDiscardAtLeast",
          energy: "Fire",
          count,
        }),
        `threshold ${count}`,
      ).toBe(countCardsInDiscardPile(state, "p2", typed) >= count);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the count actually scaling damage.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: four attacks, four numbers, one board", () => {
  it("the canonical board deals 80 / 120 / 90 / 60", () => {
    const state = canonical();
    expect([0, 1, 2, 3].map((i) => dealt(state, i))).toEqual([80, 120, 90, 60]);
  });

  it("the MULTIPLY fold DROPS the printed base and the ADDITIVE one KEEPS it", () => {
    const state = canonical();
    const rows = [0, 1, 2, 3].map((i) => find(swing(state, i).events, "DAMAGE_DEALT"));
    expect(rows.map((r) => r?.base)).toEqual([20, 60, 0, 0]);
    expect(rows.map((r) => r?.scaled)).toEqual([60, 60, 90, 60]);
  });

  it("the EMPTY-pile board: the `+` fold pays its base, the `×` fold deals nothing", () => {
    const state = bare();
    expect(state.players.p1.discard).toHaveLength(0);
    expect(state.players.p2.discard).toHaveLength(0);
    expect([0, 1].map((i) => dealt(state, i))).toEqual([20, 60]);
    expect(find(swing(state, 2).events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(swing(state, 3).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("THE ZONE: the attached Energy is NOT the pile, and the wrong walk is non-zero", () => {
    const state = canonical();
    expect(activeOf(state, "p1").energy).toHaveLength(1);
    expect(countCardsInDiscardPile(state, "p1", ANY_ENERGY)).toBe(3);
    expect(dealt(state, 0)).toBe(80);
  });

  it("THE SEAT, driven through `attack()`: all four numbers move under an inversion", () => {
    // ⑴ as arithmetic rather than as an argument. The inverted reading of each attack is
    // computed from the OTHER pile with the SAME filter, and no attack lands on its own
    // number: 80→100, 120→60, 90→60, 60→30.
    const state = canonical();
    const perAttack = [20, 60, 30, 30];
    const base = [20, 60, 0, 0];
    const wrongSeat: Seat[] = ["p2", "p2", "p1", "p1"];
    const inverted = FILTERS.map(
      (f, i) =>
        (base[i] ?? 0) +
        countCardsInDiscardPile(state, wrongSeat[i] ?? "p1", f) * (perAttack[i] ?? 0),
    );
    expect(inverted).toEqual([100, 60, 60, 30]);
    expect([0, 1, 2, 3].map((i) => dealt(state, i))).toEqual([80, 120, 90, 60]);
    for (const [i, value] of inverted.entries()) expect(dealt(state, i)).not.toBe(value);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the same four numbers from the other chair.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the same four numbers from the other chair", () => {
  it("p2 attacking reads p2's pile for 'your' and p1's for 'your opponent's'", () => {
    // The seat rung driven through `attack()` from the other end: the piles are built
    // the same way around the attacker, so the four numbers are identical while the
    // physical seats are swapped — which is what "controller-relative" means.
    const state = canonical("p2");
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p2", f))).toEqual([3, 2, 1, 1]);
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p1", f))).toEqual([4, 3, 2, 0]);
    expect([0, 1, 2, 3].map((i) => dealt(state, i, "p2"))).toEqual([80, 120, 90, 60]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — persistence, redaction, the pinned absences, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions", () => {
  it("DIRECTION 1 — a v29 record round-trips and STILL scores all four counts", () => {
    const record = JSON.parse(JSON.stringify(canonical())) as GameState;
    expect([0, 1, 2, 3].map((i) => dealt(record, i))).toEqual([80, 120, 90, 60]);
  });

  it("DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    const before = canonical();
    const after = swing(before, 0).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("cardsInDiscardPile");
    expect(wire).not.toContain("anyEnergy");
    expect(wire).not.toContain("byName");
    // …and no body gained a key: the attacker's key set equals the untouched defender's
    // and equals its own from before the swing, which is the shape a new
    // `InPlayPokemon` field would break.
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("the OPPONENT-side read is ONLINE-EVALUABLE — the pile ships face up to BOTH seats", () => {
    const state = canonical();
    const view = redactGame(state, "p1").board;
    expect(view.opponent.discard).toHaveLength(8);
    expect(view.you.discard).toHaveLength(7);
    // Names, not counts — the projection carries full identity, which is what makes the
    // count answerable client-side.
    expect(view.opponent.discard.filter((c) => c.trainerType === "Item")).toHaveLength(2);
    expect(view.opponent.discard.filter((c) => c.category === "Energy")).toHaveLength(4);
    expect(view.you.discard.filter((c) => c.name === "Ethan's Adventure")).toHaveLength(1);
    // …and the opponent's HAND is still shut, which is the attribution control: the
    // claim is about the PILE and not about a projection that shows everything.
    expect(view.opponent.hand.map((c) => c.cardId)).toEqual(
      Array.from(view.opponent.hand, () => HIDDEN_CARD_ID),
    );
    expect(view.opponent.hand.length).toBeGreaterThan(0);
  });

  it("the TWO REFUSALS ARE PINNED ON THE POPULATION, and they are TWO claims", () => {
    const ancient = legalAttackCorpus().filter(
      ([, s]) => s.includes("Ancient card") && s.includes("discard pile"),
    );
    expect(ancient.map(([, s]) => s)).toEqual([ANCIENT_PILE]);
    expect(ancient.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(resolvedByAnyReader(ANCIENT_PILE)).toBe(true);

    const substring = legalAttackCorpus().filter(
      ([, s]) => s.includes('has "Team Rocket" in its name') && s.includes("discard pile"),
    );
    expect(substring.map(([, s]) => s)).toEqual([TR_NAME_PILE]);
    expect(substring.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(resolvedByAnyReader(TR_NAME_PILE)).toBe(true);
    expect(countCardsInDiscardPile(canonical(), "p1", { kind: "byName", name: "Ethan's" })).toBe(0);
    expect(countCardsInDiscardPile(canonical(), "p1", ETHAN_BY_NAME)).toBe(1);
    expect(resolvedByAnyReader(ANCIENT_PILE)).toBe(true);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const pileBefore = frozen.players.p1.discard.length;
    const after = swing(frozen, 0);
    // The count is a READ: every card it walked is still in the pile afterwards, on the
    // new board as well as on the frozen one, and only the defender moved.
    expect(frozen.players.p1.discard).toHaveLength(pileBefore);
    expect(after.state.players.p1.discard).toHaveLength(pileBefore);
    expect(after.state.players.p2.discard).toHaveLength(8);
    expect(activeOf(frozen, "p1").energy).toHaveLength(1);
    expect(activeOf(after.state, "p1").energy).toHaveLength(1);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(80);
  });
});
