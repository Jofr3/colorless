import { HIDDEN_CARD_ID } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
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
import { engineVersion, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, countCardsInDiscardPile, countCardsInHand } from "./boardCondition";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  DISCARD_ATTACH_DECK,
  FIXTURE_POOL,
  OPPONENT_HAND_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  roundTrip,
} from "./testFixtures";

const REVEAL_TRAINER_SCALE =
  "Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.";
const REVEAL_DISCARD = "Your opponent reveals their hand. Discard a card you find there.";
const HAND_COUNT = "This attack does 30 damage for each card in your opponent's hand.";

/** The three, in fixture-attack order (68, 69, 70). */
const CLAIMED = [REVEAL_TRAINER_SCALE, REVEAL_DISCARD, HAND_COUNT] as const;

const REVEAL_SWEEP =
  "Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.";
const REVEAL_COPY =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

const CONSTRUCTED_YOUR_HAND = "This attack does 30 damage for each card in your hand.";

const OTHERS = [
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

const SEED = 20260901;

const HAND_READ = 68;
const SNATCH = 69;
const HAND_COUNT_IDX = 70;

const TRAINER: CardFilter = { kind: "trainerCard" };
const ANY_CARD: CardFilter = { kind: "anyCard" };

const FOE_HAND = [
  "fix-item",
  "fix-item",
  "fix-item",
  "fix-tool",
  "fix-gatedsup",
  "fix-energy",
  "fix-basic-1",
] as const;

const OWN_HAND = ["fix-stadium", "fix-energy", "fix-energy", "fix-basic-1"] as const;

/** Rebuild `seat`'s HAND outright — every dealt card back into the deck, then exactly
    `ids` dealt off it (`opponentHandFamily.test.ts`'s `withHand`, which this file
    needs for the same reason: the hand is the zone under test at BOTH seats). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

function board(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OPPONENT_HAND_DECK, p2: OPPONENT_HAND_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-trainerops");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-basic-1");
  state = clearBench(state, foe);
  state = withHand(state, by, OWN_HAND);
  state = withHand(state, foe, FOE_HAND);
  state = discardFromDeck(state, foe, "fix-stadium", 2);
  return discardFromDeck(state, by, "fix-tool", 1);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return findEvent(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, the population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the three printed sentences, their population, and the fixture", () => {
  it("the column prints the three on three records, 6 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1]);
    expect(rows.map((r) => r[0]?.[0])).toEqual([3, 2, 1]);
    expect(rows.reduce((sum, r) => sum + (r[0]?.[0] ?? 0), 0)).toBe(6);
  });

  it("the WHOLE 'reveals their hand' family, printed whole and classified", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
        "1 Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.",
        "1 Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
        "2 Your opponent reveals their hand. Discard a card you find there.",
        "2 Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.",
        "3 Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
        "7 Your opponent reveals their hand.",
      ].sort(),
    );
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(17);
  });

  it("carries fix-trainerops' three appended attacks, `50×`/`30×` markers included", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect([HAND_READ, SNATCH, HAND_COUNT_IDX].map((i) => attacks[i]?.effect)).toEqual([
      ...CLAIMED,
    ]);
    expect([HAND_READ, SNATCH, HAND_COUNT_IDX].map((i) => attacks[i]?.damage)).toEqual([
      "50×",
      undefined,
      "30×",
    ]);
    expect(programFor("fix-trainerops")?.attack).toBeUndefined();
  });

  it("the apostrophe byte is U+0027, measured and not remembered", () => {
    const row = legalAttackCorpus().find(([, s]) => s === HAND_COUNT);
    const text = row?.[1] ?? "";
    expect(text.indexOf("'")).toBe(57);
    expect(text.codePointAt(57)).toBe(0x27);
    // The other two carry none at all — so this is the only one of the three the
    // re-ingest sweep in `clauseApostrophe.test.ts` can see.
    expect(REVEAL_TRAINER_SCALE.includes("'")).toBe(false);
    expect(REVEAL_DISCARD.includes("'")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the anchors, the vocabulary, and THE DUAL CLAIM.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two anchors, one noun map, and the first two-reader sentence", () => {
  it("THE DUAL CLAIM: row 675 is owned by TWO readers and refused by the other eleven", () => {
    expect(deriveAttackEffect(REVEAL_TRAINER_SCALE)).toEqual([{ op: "revealOpponentHand" }]);
    expect(deriveAttackDamageMultiplier(REVEAL_TRAINER_SCALE)).toEqual({
      per: 50,
      count: { kind: "cardsInOpponentHand", filter: TRAINER },
    });
    for (const read of OTHERS) expect(read(REVEAL_TRAINER_SCALE)).toBeNull();
  });

  it("…and it is ONE of exactly TWO sentences in the column with two owners", () => {
    const readers = [deriveAttackEffect, deriveAttackDamageMultiplier, ...OTHERS] as const;
    const dual = legalAttackCorpus().filter(
      ([, text]) => readers.filter((read) => read(text) !== null).length > 1,
    );
    expect(dual.map(([, s]) => s)).toEqual([
      "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
      "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.",
      "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
      REVEAL_TRAINER_SCALE,
    ]);
    expect(dual).toHaveLength(5);
  });

  it("the bare-reveal and bare-count sentences keep exactly ONE owner each", () => {
    expect(deriveAttackEffect("Your opponent reveals their hand.")).toEqual([
      { op: "revealOpponentHand" },
    ]);
    expect(deriveAttackDamageMultiplier("Your opponent reveals their hand.")).toBeNull();
    expect(deriveAttackDamageMultiplier(HAND_COUNT)).toEqual({
      per: 30,
      count: { kind: "cardsInOpponentHand", filter: ANY_CARD },
    });
    expect(deriveAttackEffect(HAND_COUNT)).toBeNull();
    for (const read of OTHERS) expect(read(HAND_COUNT)).toBeNull();
  });

  it("the discard destination derives with NO filter and NO upTo", () => {
    expect(deriveAttackEffect(REVEAL_DISCARD)).toEqual([
      { op: "bottomFromOpponentHand", dest: "discard" },
    ]);
    expect(deriveAttackDamageMultiplier(REVEAL_DISCARD)).toBeNull();
    for (const read of OTHERS) expect(read(REVEAL_DISCARD)).toBeNull();
  });

  it("the noun map REFUSES what it cannot spell, and the sentence stays LOUD", () => {
    expect(
      deriveAttackDamageMultiplier(
        "Your opponent reveals their hand. This attack does 50 damage for each Ancient card you find there.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each Ancient card in your opponent's hand.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand. This attack does 50 damage for each Ancient card you find there.",
      ),
    ).toBeNull();
  });

  it("THE SEAT the member has no field for: a YOUR-hand fold is refused", () => {
    expect(deriveAttackDamageMultiplier(CONSTRUCTED_YOUR_HAND)).toEqual({
      per: 30,
      count: { kind: "cardsInYourHand" },
    });
    expect(deriveAttackDamageBonus(CONSTRUCTED_YOUR_HAND)).toBeNull();
  });

  it("the whole-sentence anchors hold at both ends, on the capital, and on the zero", () => {
    for (const text of CLAIMED) {
      const lowered = `If heads, ${text[0]?.toLowerCase()}${text.slice(1)}`;
      expect(deriveAttackEffect(lowered)).toBeNull();
      expect(deriveAttackDamageMultiplier(lowered)).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
      expect(deriveAttackDamageMultiplier(`${text} Draw a card.`)).toBeNull();
    }
    // The printed-zero guard every arm in both families carries.
    expect(
      deriveAttackDamageMultiplier(
        "Your opponent reveals their hand. This attack does 0 damage for each Trainer card you find there.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 0 damage for each card in your opponent's hand.",
      ),
    ).toBeNull();
  });

  it("the U+2019 spelling resolves IDENTICALLY on the one sentence that has one", () => {
    const curly = HAND_COUNT.replaceAll("'", "’");
    expect(curly).not.toBe(HAND_COUNT);
    expect(deriveAttackDamageMultiplier(curly)).toEqual(deriveAttackDamageMultiplier(HAND_COUNT));
  });

  it("no splitter composes on any of the three, before OR after this slice", () => {
    for (const text of CLAIMED) {
      expect(splitAttackTrailingClause(text)).toBeNull();
      expect(splitAttackGateClause(text)).toBeNull();
      expect(splitAttackRequirementClause(text)).toBeNull();
      expect(splitAttackCancelClause(text)).toBeNull();
    }
    expect(
      deriveAttackEffect("This attack does 50 damage for each Trainer card you find there."),
    ).toBeNull();
  });
});

function typedEnergyHands(): GameState {
  const state = must(
    applyAction(
      driveSetup(SEED, { p1: DISCARD_ATTACH_DECK, p2: DISCARD_ATTACH_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  return withHand(withHand(state, "p1", ["fix-water-energy"]), "p2", [
    "fix-fighting-energy",
    "fix-fighting-energy",
    "fix-fighting-energy",
    "fix-water-energy",
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — `countCardsInHand`: the zone, the filter, and the SHARED walk.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countCardsInHand`: the hand, seat-relative, filtered", () => {
  it("the canonical hands answer 7 / 5 / 3 / 1 / 1 / 1 / 0 and 4 / 1", () => {
    const state = board();
    const foe = (f: CardFilter) => countCardsInHand(state, "p2", f);
    expect(foe(ANY_CARD)).toBe(7);
    expect(foe(TRAINER)).toBe(5);
    expect(foe({ kind: "item" })).toBe(3);
    expect(foe({ kind: "toolCard" })).toBe(1);
    expect(foe({ kind: "supporter" })).toBe(1);
    expect(foe({ kind: "anyPokemon" })).toBe(1);
    expect(foe({ kind: "stadium" })).toBe(0);
    // …and the ATTACKER's own hand is a DIFFERENT number on both printed filters, so a
    // seat mistake is never a coincidence.
    expect(countCardsInHand(state, "p1", ANY_CARD)).toBe(4);
    expect(countCardsInHand(state, "p1", TRAINER)).toBe(1);
  });

  it("THE ZONE: the same filters over the PILE and the BOARD are different numbers", () => {
    // ⑵'s control, and it is what makes a walk over the wrong zone a visible wrong
    // ANSWER rather than an empty one.
    const state = board();
    expect(countCardsInDiscardPile(state, "p2", TRAINER)).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", ANY_CARD)).toBe(2);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(state.players.p2.active).not.toBeNull();
  });

  it("an EMPTY hand is 0 and an UNRESOLVABLE uid contributes 0, on every filter", () => {
    const state = board();
    const empty = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, hand: [] } },
    };
    for (const f of [ANY_CARD, TRAINER, { kind: "item" } as CardFilter]) {
      expect(countCardsInHand(empty, "p2", f)).toBe(0);
    }
    // `cardOfUid` answers undefined and `matchesFilter`'s first line answers false, so a
    // uid the catalog cannot resolve is skipped rather than thrown on.
    const ghost = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, hand: [...state.players.p2.hand, "no-such-uid"] },
      },
    };
    expect(countCardsInHand(ghost, "p2", ANY_CARD)).toBe(7);
    expect(countCardsInHand(ghost, "p2", TRAINER)).toBe(5);
  });

  it("the GENERALISED walk and D420's threshold cannot disagree", () => {
    const state = typedEnergyHands();
    const fighting: CardFilter = { kind: "basicEnergy", energyType: "Fighting" };
    const held = countCardsInHand(state, "p2", fighting);
    expect(held).toBe(3);
    for (let n = 0; n <= 5; n += 1) {
      expect(
        conditionHolds(state, "p2", {
          kind: "yourBasicEnergyInHandAtLeast",
          energy: "Fighting",
          count: n,
        }),
        `count ${n}`,
      ).toBe(held >= n);
    }
    // The TYPE really narrows — the same hand answers 1 for Water and 0 for Grass, so a
    // walk that dropped the filter would be a different number at every threshold.
    expect(countCardsInHand(state, "p2", { kind: "basicEnergy", energyType: "Water" })).toBe(1);
    expect(countCardsInHand(state, "p2", { kind: "basicEnergy", energyType: "Grass" })).toBe(0);
    // …and the threshold reads the ASKER's own hand, so the two seats answer differently
    // on one board: p1 holds none of it.
    expect(countCardsInHand(state, "p1", fighting)).toBe(0);
    expect(
      conditionHolds(state, "p1", {
        kind: "yourBasicEnergyInHandAtLeast",
        energy: "Fighting",
        count: 1,
      }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold, and the ORDER of the reveal.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: two attacks, two numbers, one board", () => {
  it("the canonical board deals 250 and 210", () => {
    const state = board();
    expect(dealt(state, HAND_READ)).toBe(250); // 50 × 5 Trainers
    expect(dealt(state, HAND_COUNT_IDX)).toBe(210); // 30 × 7 cards
  });

  it("every wrong ZONE, SEAT and FILTER is a different number on the same swing", () => {
    const state = board();
    const foeHand = countCardsInHand(state, "p2", TRAINER);
    expect([
      countCardsInDiscardPile(state, "p2", TRAINER) * 50,
      countCardsInHand(state, "p1", TRAINER) * 50,
      countCardsInHand(state, "p2", { kind: "item" }) * 50,
      countCardsInHand(state, "p2", ANY_CARD) * 50,
    ]).toEqual([100, 50, 150, 350]);
    expect(foeHand * 50).toBe(250);
    expect([
      countCardsInDiscardPile(state, "p2", ANY_CARD) * 30,
      countCardsInHand(state, "p1", ANY_CARD) * 30,
      countCardsInHand(state, "p2", TRAINER) * 30,
    ]).toEqual([60, 120, 150]);
  });

  it("the SAME two numbers from the other chair — the mirror board", () => {
    const state = board("p2");
    expect(dealt(state, HAND_READ, "p2")).toBe(250);
    expect(dealt(state, HAND_COUNT_IDX, "p2")).toBe(210);
    // …and the inversion evidence, re-read on the mirror board: the attacker's own hand
    // is 1 Trainer / 4 cards there too, so a build reading it deals 50 and 120.
    expect(countCardsInHand(state, "p2", TRAINER) * 50).toBe(50);
    expect(countCardsInHand(state, "p2", ANY_CARD) * 30).toBe(120);
  });

  it("the MULTIPLY fold DROPS the printed base — an EMPTY hand deals NOTHING", () => {
    const state = withHand(board(), "p2", []);
    expect(countCardsInHand(state, "p2", ANY_CARD)).toBe(0);
    expect(dealt(state, HAND_READ)).toBeUndefined();
    expect(dealt(state, HAND_COUNT_IDX)).toBeUndefined();
    const out = swing(state, HAND_READ);
    expect(findEvent(out.events, "HAND_REVEALED")?.uids).toEqual([]);
  });

  it("BOTH HALVES OF ROW 675 RESOLVE, and dropping either is observable", () => {
    // ⑴ driven on a board. A build reading only the fold deals 250 and files no
    // HAND_REVEALED; a build reading only the reveal deals 0 (the `×` base is dropped)
    // and reveals. Only the real build does both.
    const state = board();
    const out = swing(state, HAND_READ);
    expect(findEvent(out.events, "DAMAGE_DEALT")?.dealt).toBe(250);
    expect(findEvent(out.events, "HAND_REVEALED")?.seat).toBe("p2");
    expect(findEvent(out.events, "HAND_REVEALED")?.uids).toEqual(state.players.p2.hand);
    // …and the CONTROL: the sentence with no printed reveal files no reveal.
    const bare = swing(state, HAND_COUNT_IDX);
    expect(findEvent(bare.events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(findEvent(bare.events, "HAND_REVEALED")).toBeUndefined();
  });

  it("THE REVEAL RUNS AFTER THE DAMAGE, AND THAT IS A DECISION (D426)", () => {
    const out = swing(board(), HAND_READ);
    const order = out.events.map((e) => e.type);
    expect(order).toContain("DAMAGE_DEALT");
    expect(order).toContain("HAND_REVEALED");
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("HAND_REVEALED"));
    // …and the hand the fold counted is the hand the reveal named, byte for byte, which
    // is the property that makes the order unobservable in the numbers.
    expect(findEvent(out.events, "HAND_REVEALED")?.uids).toHaveLength(7);
    expect(findEvent(out.events, "DAMAGE_DEALT")?.dealt).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the DISCARD destination: the park, the arity, the event, the log.
// ─────────────────────────────────────────────────────────────────────────────

describe('§5 — `bottomFromOpponentHand.dest: "discard"`', () => {
  it("parks the pick with the card's OWN printed sentence as the note", () => {
    // The round trip that `bottomFromOpponentHandNote` is grown one printed form per
    // card for: the caption is this card's text, character for character, and the two
    // files are checked against each other by driving rather than by eye.
    const state = board();
    const before = [...state.players.p2.hand];
    const { state: parked, events } = swing(deepFreeze(state), SNATCH);
    expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual(before);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.note).toBe(REVEAL_DISCARD);
    // The pick is MANDATORY and exactly one — the printed article, not a number.
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(prompt.dest).toBe("discard");
    expect(prompt.candidates).toHaveLength(5);
  });

  it("the ANSWER moves the card into the OWNER's pile and files the event", () => {
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    // The card left the OWNER's hand for the OWNER's own pile — never the actor's.
    expect(resolved.state.players.p2.hand).not.toContain(uid);
    expect(resolved.state.players.p2.discard).toContain(uid);
    expect(resolved.state.players.p1.discard).not.toContain(uid);
    const kept = state.players.p2.hand.filter((u) => resolved.state.players.p2.hand.includes(u));
    expect(kept).toHaveLength(6);
    expect(state.players.p2.hand.filter((u) => !kept.includes(u))).toEqual([uid]);
    const row = findEvent(resolved.events, "CARD_DISCARDED_FROM_HAND");
    expect(row).toEqual({ type: "CARD_DISCARDED_FROM_HAND", seat: "p2", uid, actor: "p1" });
    expect(findEvent(resolved.events, "HAND_REVEALED")).toBeUndefined();
  });

  it("ONE interchangeable class resolves INLINE — the M1 no-choice rule", () => {
    const state = withHand(board(), "p2", ["fix-item", "fix-item"]);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "HAND_REVEALED")?.uids).toHaveLength(2);
    const row = findEvent(events, "CARD_DISCARDED_FROM_HAND");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    // One of the two left the hand (the turn-start draw replaces it — see the rung above
    // for why the count is taken against the original hand).
    expect(state.players.p2.hand.filter((u) => done.players.p2.hand.includes(u))).toHaveLength(1);
    expect(done.players.p2.discard).toHaveLength(3); // the board's two Stadiums + this one
  });

  it("an EMPTY hand WHIFFS — the reveal still happens, nothing moves, no park", () => {
    const state = withHand(board(), "p2", []);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual([]);
    expect(findEvent(events, "CARD_DISCARDED_FROM_HAND")).toBeUndefined();
    expect(done.players.p2.discard).toHaveLength(2);
  });

  it("the LOG says CHOSE, which is what tells it from the RANDOM twin", () => {
    const state = withHand(board(), "p2", ["fix-item", "fix-item"]);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(findEvent(events, "CARD_DISCARDED_FROM_HAND")?.uid).toBeDefined();
    expect(rowText(done, events, "chose")).toBe("chose fix-item from Tide's hand and discarded it");
    const ctx: LogContext = { names: NAMES, state: done, elapsed: formatElapsed(0) };
    const row = logFromEvents(events, ctx).find(
      (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("chose")),
    );
    expect(row?.kind === "action" ? row.who : null).toBe("p1");
    expect(rowText(done, events, "chose")).not.toContain("random");
  });

  it("the hand stays HIDDEN afterwards, and EXACTLY the discarded card is public", () => {
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    const seen = redactGame(resolved.state, "p1");
    // The discarded card IS in the opponent's public pile, by uid (the `id` field on a
    // `RedactedCard` is the engine uid).
    expect(seen.board.opponent.discard.map((c) => c.id)).toContain(uid);
    // …and every card STILL in that hand is absent from the whole snapshot.
    const wire = JSON.stringify(seen);
    for (const still of resolved.state.players.p2.hand) {
      expect(wire.includes(`"${still}"`), still).toBe(false);
    }
    expect(seen.board.opponent.hand).toHaveLength(resolved.state.players.p2.hand.length);
    expect(new Set(seen.board.opponent.hand.map((c) => c.cardId))).toEqual(
      new Set([HIDDEN_CARD_ID]),
    );
    expect(JSON.stringify(resolved.state)).not.toContain("revealed");
  });

  it("the OPPONENT never receives the prompt — the answerer gate", () => {
    // The candidates are the DEFENDER's own hand cards, resolved to identities for the
    // ATTACKER because the hand was just revealed. The gate is `answerer`, and the
    // defender is not it.
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const mine = redactGame(parked, "p1");
    const theirs = redactGame(parked, "p2");
    expect(mine.phase.kind).toBe("effect:choose");
    expect(mine.phase.kind === "effect:choose" ? mine.phase.prompt : "absent").not.toBeNull();
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "absent").toBeNull();
  });
});

describe("§6 — the population claims this slice rests on", () => {
  it("NO corpus sentence carries a FILTERED hand count without a printed reveal", () => {
    const DECK_WINDOW_FUTURE =
      "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.";
    const allFolds = legalAttackCorpus().filter(([, s]) =>
      /damage for each .*(in your opponent's hand|you find there)\./.test(s),
    );
    expect(allFolds.map(([, s]) => s).sort()).toEqual(
      [HAND_COUNT, REVEAL_TRAINER_SCALE, DECK_WINDOW_FUTURE].sort(),
    );
    expect(resolvedByAnyReader(DECK_WINDOW_FUTURE)).toBe(false);
    const handFolds = allFolds.filter(([, s]) => s !== DECK_WINDOW_FUTURE);
    expect(handFolds.map(([, s]) => s).sort()).toEqual([HAND_COUNT, REVEAL_TRAINER_SCALE].sort());
    for (const [, s] of handFolds) {
      const count = deriveAttackDamageMultiplier(s)?.count;
      if (count?.kind !== "cardsInOpponentHand") throw new Error(`not a hand fold: ${s}`);
      // The bare `anyCard` reading needs no reveal — a hand's SIZE is public. Anything
      // NARROWER must print one, and must have it SIMULATED (a printed reveal the engine
      // does not perform would be the same leak with better manners).
      if (count.filter.kind === "anyCard") continue;
      expect(s, s).toContain("Your opponent reveals their hand.");
      expect(deriveAttackEffect(s), s).toEqual([{ op: "revealOpponentHand" }]);
    }
  });

  it("NO corpus sentence folds damage over YOUR OWN hand — the missing `seat` field", () => {
    const yourHand = legalAttackCorpus().filter(
      ([, s]) =>
        /damage for each .*in your hand\./.test(s) || /damage for each .*in their hand\./.test(s),
    );
    expect(yourHand).toEqual([]);
  });

  it("REFUSAL 1 IS SPENT — the mandatory SWEEP is BUILT, and its own falsifier fired", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === REVEAL_SWEEP)).toHaveLength(1);
    expect(resolvedByAnyReader(REVEAL_SWEEP)).toBe(true);
    expect(deriveAttackEffect(REVEAL_SWEEP)).toEqual([
      { op: "revealOpponentHand" },
      {
        op: "discardFromOpponentHand",
        filter: { kind: "anyOf", filters: [{ kind: "item" }, { kind: "toolCard" }] },
      },
    ]);
    const TAIL = "Discard all Item cards and Pokémon Tool cards you find there.";
    expect(REVEAL_SWEEP.endsWith(` ${TAIL}`)).toBe(true);
    expect(resolvedByAnyReader(TAIL)).toBe(false);
    expect(splitAttackTrailingClause(`Draw 3 cards. ${TAIL}`)).toBeNull();
    expect(splitAttackGateClause(REVEAL_SWEEP)).toBeNull();
  });

  it("REFUSAL 2 — the Supporter COPY: still refused by every READER, and BUILT at D580 as a REGISTRY row (D445's refusal retired)", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === REVEAL_COPY)).toHaveLength(1);
    expect(resolvedByAnyReader(REVEAL_COPY)).toBe(false);
    expect(splitAttackTrailingClause(REVEAL_COPY)).toBeNull();
    // The head of the compound IS claimed — which is what makes the refusal a decision
    // about the TAIL rather than an accident of the anchor.
    expect(deriveAttackEffect("Your opponent reveals their hand.")).not.toBeNull();
  });

  it("the family's arithmetic still adds up: 6 claimed, 1 refused by every reader (built at D580 as a registry row), 17 printings", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    const claimed = family.filter(([, s]) => resolvedByAnyReader(s));
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect([claimed.length, claimed.reduce((n, [u]) => n + u, 0)]).toEqual([6, 16]);
    expect(refused.map(([, s]) => s)).toEqual([REVEAL_COPY]);
    expect(programFor("sv05-063")?.attack?.[0]).toEqual([
      { op: "revealOpponentHand" },
      { op: "useOpponentSupporterEffect" },
    ]);
    expect(refused.reduce((n, [u]) => n + u, 0)).toBe(1);
    expect(claimed.length + refused.length).toBe(family.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  it("DIRECTION 1 — a v29 record with NO `dest` still replays as the bottom-of-deck pick", () => {
    // The old byte string, reconstructed: a parked `bottomFromOpponentHand` written by a
    // deploy that had never heard of `"discard"`. It is replayed through the REAL action
    // API and must still put the card under the opponent's deck.
    const state = board();
    const { state: parked } = swing(deepFreeze(state), 28);
    const wire = roundTrip(parked);
    if (wire.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    expect(JSON.stringify(wire.phase.cont.pendingOp)).not.toContain('"dest"');
    const prompt = wire.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(wire, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    expect(resolved.state.players.p2.deck.at(-1)).toBe(uid);
    expect(resolved.state.players.p2.discard).not.toContain(uid);
  });

  it("DIRECTION 2 — the NEW value round-trips and lands in the pile, not the deck", () => {
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    const wire = roundTrip(parked);
    expect(JSON.stringify(wire)).toContain('"dest":"discard"');
    if (wire.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = wire.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(wire, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    expect(resolved.state.players.p2.discard).toContain(uid);
    expect(resolved.state.players.p2.deck).not.toContain(uid);
  });

  it("DIRECTION 3 — nothing the COUNT produces is on the board at all", () => {
    const before = board();
    const after = swing(before, HAND_READ).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("cardsInOpponentHand");
    expect(wire).not.toContain("trainerCard");
    // …the control: the sentence text IS there, so the rung above is about the SHAPE and
    // not about a string that happens to be missing.
    expect(wire).toContain("for each Trainer card you find there");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity, and the engine version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the frozen board and the engine version", () => {
  it("hands the FROZEN board back untouched — the purity pair", () => {
    const state = deepFreeze(board());
    expect(dealt(state, HAND_READ)).toBe(250);
    expect(dealt(state, HAND_COUNT_IDX)).toBe(210);
    expect(state.players.p2.hand).toHaveLength(7);
  });

  it("the engine version moved with the behaviour, and the two files agree", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
