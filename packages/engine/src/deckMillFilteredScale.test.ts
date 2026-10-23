import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import { deriveAttackDiscardScaledBoost, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import type { GameState, Seat } from "./index";
import { matchesFilter } from "./cards";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  itemTrainer,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
  mustDerive,
} from "./testFixtures";

const MILL_ENERGY =
  "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.";
const MILL_MISTY =
  "Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon that you discarded in this way.";
const HAIL_BLADE =
  "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
/** The shipped bare MILL — this sentence's own head, and what a dropped tail reads as. */
const BARE_MILL = "Discard the top 3 cards of your deck.";
const LOUD =
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.";

const ENERGY_PROGRAM: readonly EffectOp[] = [
  { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
  { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "anyEnergy" } },
];
const MISTY_PROGRAM: readonly EffectOp[] = [
  { op: "discardDeckTop", whose: "self", count: 7, recordAs: "discarded" },
  {
    op: "damageDefender",
    per: 70,
    count: "discarded",
    countFilter: { kind: "ownerPokemon", owner: "Misty" },
  },
];
/** The v29 byte strings: the SAME two ops with the new keys ABSENT. §9 reads them back
    and drives that they still mean what they meant. */
const V29_MILL: readonly EffectOp[] = [{ op: "discardDeckTop", whose: "self", count: 3 }];
const V29_SCALE: readonly EffectOp[] = [{ op: "damageDefender", per: 80, count: "discarded" }];

const MILL_HEAD = /^Discard the top \d+ cards of your deck, and this attack does /;

const SEED = 20260908;

const ENERGY_SWING = 0;
const MISTY_SWING = 1;
const PLAIN_CUFF = 2;
const LOUD_SWING = 3;

const D488_CARDS: Record<string, Card> = {
  "d488-miller": battler("d488-miller", {
    name: "D488 Miller",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Sediment", damage: 80, effect: MILL_ENERGY },
      { cost: ["Colorless"], name: "Tidal Sweep", damage: 70, effect: MILL_MISTY },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Borrowed Reach", effect: LOUD },
    ],
  }),
  /** The defender. Big enough that nothing this file's CORRECT readings do Knocks it
      Out — a KO would end the batch before the zones could be read. */
  "d488-wall": battler("d488-wall", { name: "D488 Wall", types: ["Colorless"], hp: 340 }),
  "d488-water-1": basicEnergy("d488-water-1"),
  "d488-water-2": basicEnergy("d488-water-2"),
  "d488-water-3": basicEnergy("d488-water-3"),
  "d488-water-4": basicEnergy("d488-water-4"),
  "d488-water-5": basicEnergy("d488-water-5"),
  "d488-item-1": itemTrainer("d488-item-1"),
  "d488-item-2": itemTrainer("d488-item-2"),
  "d488-item-3": itemTrainer("d488-item-3"),
  "d488-item-4": itemTrainer("d488-item-4"),
  "d488-item-5": itemTrainer("d488-item-5"),
  /** The OWNER-PREFIXED Pokémon. `ownerPokemon` is `card.name.startsWith("Misty's ")`,
      so the NAME is the datum here and the id is not — which is why these ids are not
      spelled `misty` and the names are. */
  "d488-m1": battler("d488-m1", { name: "Misty's Psyduck", types: ["Water"], hp: 60 }),
  "d488-m2": battler("d488-m2", { name: "Misty's Starmie", types: ["Water"], hp: 90 }),
  "d488-m3": battler("d488-m3", { name: "Misty's Goldeen", types: ["Water"], hp: 60 }),
  "d488-m4": battler("d488-m4", { name: "Misty's Seaking", types: ["Water"], hp: 90 }),
  "d488-m5": battler("d488-m5", { name: "Misty's Horsea", types: ["Water"], hp: 50 }),
  "d488-e1": battler("d488-e1", { name: "Erika's Bellsprout", types: ["Grass"], hp: 60 }),
  "d488-e2": battler("d488-e2", { name: "Erika's Oddish", types: ["Grass"], hp: 60 }),
  /** A Pokémon with NO owner prefix at all — the third point of the noun triangle. */
  "d488-plain": battler("d488-plain", { name: "D488 Plain", types: ["Colorless"], hp: 60 }),
};

const D488_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D488_CARDS };

const D488_DECK = deckOf({
  "d488-miller": 3,
  "d488-wall": 3,
  "d488-water-1": 3,
  "d488-water-2": 3,
  "d488-water-3": 3,
  "d488-water-4": 3,
  "d488-water-5": 3,
  "d488-item-1": 3,
  "d488-item-2": 3,
  "d488-item-3": 3,
  "d488-item-4": 3,
  "d488-item-5": 3,
  "d488-m1": 3,
  "d488-m2": 3,
  "d488-m3": 3,
  "d488-m4": 3,
  "d488-m5": 3,
  "d488-e1": 3,
  "d488-e2": 3,
  "d488-plain": 3,
});

const ENERGY_DECK = [
  "d488-water-1", // milled — MATCHES `anyEnergy`
  "d488-m1", //      milled — a Pokémon, not an Energy
  "d488-item-1", //  milled — an Item, not an Energy
  "d488-water-2", // stays: what a MILL-side filter would have reached instead
  "d488-water-3",
  "d488-water-4",
  "d488-water-5",
  "d488-m2",
  "d488-plain",
] as const;
/** Board A's PRE-SEEDED discard pile — 5 cards of which 3 are Energy. It exists so that
    *count-the-whole-pile* is a DIFFERENT number from *count-the-record*; on an empty
    pile the two are identical and this file would prove nothing. */
const ENERGY_PILE = [
  "d488-water-3",
  "d488-water-4",
  "d488-water-5",
  "d488-item-2",
  "d488-item-3",
] as const;

const MISTY_DECK = [
  "d488-m1", //     milled — MATCHES `ownerPokemon "Misty"`
  "d488-e1", //     milled — a Pokémon, WRONG owner
  "d488-water-1", //milled — an Energy
  "d488-item-1", // milled — an Item
  "d488-m2", //     milled — MATCHES
  "d488-e2", //     milled — a Pokémon, WRONG owner
  "d488-item-2", // milled — an Item
  "d488-m3", //     stays
  "d488-item-3",
  "d488-plain",
] as const;
/** Board B's PRE-SEEDED pile — 4 cards of which 3 are Misty's. §5's reason. */
const MISTY_PILE = ["d488-m4", "d488-m5", "d488-m3", "d488-item-4"] as const;

/** The ZERO-MATCH board: the mill happens and NOTHING it moved counts. Three Items on
    top, so `anyEnergy` scores 0 while the mill itself is fully observable. */
const ZERO_DECK = [
  "d488-item-1",
  "d488-item-2",
  "d488-item-3",
  "d488-water-1",
  "d488-water-2",
  "d488-plain",
] as const;

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: D488_DECK, p2: D488_DECK }, { pool: D488_POOL, first });
}

function withZones(
  state: GameState,
  seat: Seat,
  deckIds: readonly string[],
  discardIds: readonly string[],
): GameState {
  const side = state.players[seat];
  const pool = [...side.deck, ...side.hand, ...side.discard];
  const take = (ids: readonly string[]): string[] =>
    ids.map((id) => {
      const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
      if (at < 0) throw new Error(`${seat} has no spare ${id}`);
      const [uid] = pool.splice(at, 1);
      if (uid === undefined) throw new Error("splice returned nothing");
      return uid;
    });
  const deck = take(deckIds);
  const discard = take(discardIds);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck, discard, hand: pool } },
  };
}

/** p1 owns TURN 2 with the Miller Active, `deck` as its whole library and `pile` as its
    whole discard pile, both in order. */
function table(
  deck: readonly string[],
  pile: readonly string[] = [],
  attacker: Seat = "p1",
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d488-miller");
  state = setActiveFromDeck(state, defender, "d488-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d488-water-1", 1);
  return withZones(state, attacker, deck, pile);
}

const idOf = (uid: string, state: GameState): string => {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
};
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}
const countOf = <T extends GameEvent["type"]>(events: GameEvent[], type: T): number =>
  events.filter((e) => e.type === type).length;

function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const matching = (ids: readonly string[], filter: CardFilter): number =>
  ids.filter((id) => matchesFilter(D488_POOL[id], filter)).length;

/** A candidate reading of the printed sentence, as a pure function of the board:
    `(milled, pileBefore, per, filter, printedBase) => damage`. §5 fills the table. */
type Reading = (
  milled: readonly string[],
  pileBefore: readonly string[],
  per: number,
  filter: CardFilter,
  printedBase: number,
) => number;

describe("D488 §1 — the two printed rows, off the column rather than off this file", () => {
  it("both sentences are in `legalAttackCorpus()` at exactly 1 printing each", () => {
    const rows = legalAttackCorpus();
    for (const text of [MILL_ENERGY, MILL_MISTY]) {
      const hit = rows.filter(([, s]) => s === text);
      expect(hit, text).toHaveLength(1);
      expect(units(hit), text).toBe(1);
    }
    const taken = rows.filter(([, s]) => readersClaiming(s).length > 0 && MILL_HEAD.test(s));
    expect([...taken].sort()).toEqual(
      [
        [1, MILL_ENERGY],
        [1, MILL_MISTY],
      ].sort(),
    );
    expect(units(taken)).toBe(2);
  });

  it("the wider `discarded in this way` family is still 12 sentences / 27 printings", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
    const read = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(read).toHaveLength(12);
    expect(units(read)).toBe(27);
    const left = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left).toEqual([]);
    const twoDeck = family.filter(
      ([, s]) =>
        s ===
        "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
    );
    expect(twoDeck.map(([n]) => n)).toEqual([2]);
    // …and it is `deriveAttackDiscardScaledBoost`'s, NOT this file's subject: a build
    // that let `DECK_MILL_FILTERED_SCALED_DAMAGE` reach across the sentence break would
    // pass a bare "it is read" rung and fail this one.
    expect(deriveAttackEffect(twoDeck[0]?.[1] as string)).toBeNull();
    expect(deriveAttackDiscardScaledBoost(twoDeck[0]?.[1] as string)).toEqual({
      kind: "eachDeckMill",
      per: 140,
    });
  });

  it("the reader surface stands still at THIRTEEN — no reader was added", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });
});

describe("D488 §2 — AXIS DELETION: are these two rows really one row?", () => {
  it("deleting the FILTER collapses both rows to ONE string — which is still refused", () => {
    const unfiltered = (n: number, per: number) =>
      `Discard the top ${n} cards of your deck, and this attack does ${per} damage for each card you discarded in this way.`;
    expect(unfiltered(3, 80)).toBe(
      MILL_ENERGY.replace(" for each Energy card you", " for each card you"),
    );
    expect(unfiltered(7, 70)).toBe(
      MILL_MISTY.replace(" for each Misty's Pokémon that you", " for each card you"),
    );
    for (const text of [unfiltered(3, 80), unfiltered(7, 70)]) {
      expect(readersClaiming(text), text).toEqual([]);
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
  });

  it("deleting the MILL HEAD leaves the FILTERED COUNT refused on its own", () => {
    for (const tail of [
      "This attack does 80 damage for each Energy card you discarded in this way.",
      "This attack does 70 damage for each Misty's Pokémon that you discarded in this way.",
    ]) {
      const text = `Discard all {W} Energy from this Pokémon. ${tail}`;
      expect(readersClaiming(text), text).toEqual([]);
    }
    expect(
      readersClaiming(
        "Discard all {W} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      ),
    ).toEqual(["deriveAttackEffect"]);
  });

  it("deleting the SCALING leaves two heads that BOTH already built, to one op", () => {
    expect(deriveAttackEffect(BARE_MILL)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3 },
    ]);
    expect(deriveAttackEffect("Discard the top 7 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 7 },
    ]);
  });

  it("the verdict: ONE mechanism serves both, and the two filters are free", () => {
    const a = mustDerive(deriveAttackEffect, MILL_ENERGY);
    const b = mustDerive(deriveAttackEffect, MILL_MISTY);
    expect(a).toEqual(ENERGY_PROGRAM);
    expect(b).toEqual(MISTY_PROGRAM);
    expect(a.map((op) => op.op)).toEqual(b.map((op) => op.op));
    expect(a).toHaveLength(2);
    const filters = [a[1], b[1]].map((op) =>
      op !== undefined && op.op === "damageDefender" ? op.countFilter : undefined,
    );
    expect(filters).toEqual([{ kind: "anyEnergy" }, { kind: "ownerPokemon", owner: "Misty" }]);
  });
});

describe("D488 §3 — the parse: every capture is a field, and the noun group is LAZY", () => {
  it("the three captures are the mill count, the per-unit and the noun", () => {
    expect(deriveAttackEffect(MILL_ENERGY)).toEqual(ENERGY_PROGRAM);
    expect(deriveAttackEffect(MILL_MISTY)).toEqual(MISTY_PROGRAM);
    expect(
      deriveAttackEffect(
        "Discard the top 5 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      ),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 5, recordAs: "discarded" },
      { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
    expect(
      deriveAttackEffect(
        "Discard the top 3 cards of your deck, and this attack does 10 damage for each Energy card you discarded in this way.",
      ),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 10, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
    expect(
      deriveAttackEffect(
        "Discard the top 3 cards of your deck, and this attack does 80 damage for each Item card you discarded in this way.",
      ),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "item" } },
    ]);
  });

  it("the noun group is LAZY, and corpus line 129 is the WHOLE witness for it", () => {
    const greedy =
      /^Discard the top (\d+) cards of your deck, and this attack does (\d+) damage for each (.+) (?:that )?you discarded in this way\.$/;
    expect(greedy.exec(MILL_MISTY)?.[3]).toBe("Misty's Pokémon that");
    expect(greedy.exec(MILL_ENERGY)?.[3]).toBe("Energy card");
    const scale = mustDerive(deriveAttackEffect, MILL_MISTY);
    const op = scale[1];
    if (op === undefined || op.op !== "damageDefender") throw new Error("not a damageDefender");
    expect(op.countFilter).toEqual({ kind: "ownerPokemon", owner: "Misty" });
    // The pronoun is a SPELLING and not an axis: written or not, the program is the
    // same shape at the same fields.
    expect(
      deriveAttackEffect(
        "Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon you discarded in this way.",
      ),
    ).toEqual(MISTY_PROGRAM);
  });

  it("refuses an UNSPELLABLE noun LOUDLY rather than counting everything", () => {
    for (const noun of ["Future card", "Special Energy card", "Pokémon", "Basic Pokémon"]) {
      const text = `Discard the top 3 cards of your deck, and this attack does 80 damage for each ${noun} you discarded in this way.`;
      expect(deriveAttackEffect(text), noun).toBeNull();
      expect(readersClaiming(text), noun).toEqual([]);
    }
  });

  it("refuses the anchor, the fold, the direction and the singular — one axis each", () => {
    for (const text of [
      // NO TRAILING PERIOD, and a "!" for it — the `$`.
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way",
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way!",
      // A LOWERCASE first word — half of what keeps a mid-sentence clause off this path,
      // and the reason there is no /i flag (the family's standing choice).
      "discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top 3 cards of your deck, and this attack does 80 more damage for each Energy card you discarded in this way.",
      "Discard the top 3 cards of your opponent's deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top card of each player's deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      // THE SINGULAR. `DECK_TOP_MILL` spells it as a separate branch; this compound
      // prints only the plural, so the branch is not written (arms no sentence drives).
      "Discard the top card of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      // THE CONNECTIVE. A PERIOD is the shape `deckTopMill.test.ts` pins the mill's `$`
      // against; this anchor demands the comma, which is what makes the two disjoint by
      // construction rather than by ordering.
      "Discard the top 3 cards of your deck. This attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card in your discard pile.",
      "Discard the top 0 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top 3 cards of your deck, and this attack does 0 damage for each Energy card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      readersClaiming(
        "Discard the top 3 cards of your deck, and this attack does 80 more damage for each Energy card you discarded in this way.",
      ),
    ).toEqual([]);
  });

  it("the 13 SHIPPED printings that already read a slot are BYTE-IDENTICAL", () => {
    expect(deriveAttackEffect(HAIL_BLADE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
    for (const [, text] of legalAttackCorpus().filter(
      ([, s]) =>
        s.includes("discarded in this way") && deriveAttackEffect(s) !== null && !MILL_HEAD.test(s),
    )) {
      for (const op of mustDerive(deriveAttackEffect, text)) {
        if (op.op === "damageDefender") expect(Object.keys(op), text).not.toContain("countFilter");
        if (op.op === "discardDeckTop") expect(Object.keys(op), text).not.toContain("recordAs");
      }
    }
    // …and the bare mill, which is the same claim at the other op.
    expect(Object.keys(mustDerive(deriveAttackEffect, BARE_MILL)[0] ?? {})).toEqual([
      "op",
      "whose",
      "count",
    ]);
  });
});

describe("D488 §4 — the COMPOSITION question, driven, with its counterweight", () => {
  it("the nearest shipped spelling EXISTS and is DERIVABLE — and it is a different program", () => {
    const pileRead = "This attack does 80 damage for each Energy card in your discard pile.";
    expect(effects.deriveAttackDamageMultiplier(pileRead)).toEqual({
      per: 80,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: { kind: "anyEnergy" } },
    });
    expect(effects.deriveAttackDamageMultiplier(MILL_ENERGY)).toBeNull();
    expect(readersClaiming(MILL_ENERGY)).toEqual(["deriveAttackEffect"]);
    expect(
      effects.deriveAttackDamageMultiplier(
        "This attack does 70 damage for each Misty's Pokémon in your discard pile.",
      ),
    ).toBeNull();
  });

  it("NAMING THE BOARD: the pile candidate and the record candidate agree on an EMPTY pile", () => {
    const milled = ["d488-water-1", "d488-m1", "d488-item-1"];
    const filter: CardFilter = { kind: "anyEnergy" };
    expect(matching(milled, filter)).toBe(matching([...[], ...milled], filter));
    // The separating board is therefore any board whose pile is NOT empty, and the
    // separation is a real number rather than a shape: on `ENERGY_PILE` the record
    // reading is 1 and the pile reading is 4.
    expect(matching(milled, filter)).toBe(1);
    expect(matching([...ENERGY_PILE, ...milled], filter)).toBe(4);
    const topAllMatch = ["d488-water-1", "d488-water-2", "d488-water-3"];
    expect(matching(topAllMatch, filter)).toBe(3);
    expect(
      matching(
        topAllMatch.filter((id) => matchesFilter(D488_POOL[id], filter)),
        filter,
      ),
    ).toBe(3);
  });
});

describe("D488 §5 — the candidate readings, computed BEFORE the boards were chosen", () => {
  const READINGS: Record<string, Reading> = {
    /** ① SHIPPED — the record, narrowed by the printed noun. */
    recordMatching: (m, _p, per, f, _base) => per * matching(m, f),
    /** ② the record, UNFILTERED — what dropping `countFilter` means. */
    recordAll: (m, _p, per) => per * m.length,
    /** ③ the record NEVER FILED — what dropping `recordAs` means. An empty slot is 0,
        and `amount <= 0` means no damage event at all. */
    noRecord: () => 0,
    /** ④ the whole pile AFTERWARDS, narrowed — the `cardsInDiscardPile` candidate of
        §4, and the reading an empty-pile board cannot tell from ①. */
    pileMatching: (m, p, per, f) => per * matching([...p, ...m], f),
    /** ⑤ the whole pile afterwards, UNFILTERED — the crudest pile read. */
    pileAll: (m, p, per) => per * (p.length + m.length),
    baseKept: (m, _p, per, f, base) => base + per * matching(m, f),
    /** ⑦ the WRONG NOUN, widened to any Pokémon — what reading "Misty's Pokémon" as
        "Pokémon" would deal. */
    anyPokemonNoun: (m, _p, per) => per * matching(m, { kind: "anyPokemon" }),
    /** ⑧ the WRONG NOUN, narrowed to Energy — the other misresolution. */
    anyEnergyNoun: (m, _p, per) => per * matching(m, { kind: "anyEnergy" }),
  };

  it("BOARD A separates six of the eight, and the two it cannot are named", () => {
    const milled = ENERGY_DECK.slice(0, 3);
    const answers = Object.fromEntries(
      Object.entries(READINGS).map(([name, read]) => [
        name,
        read(milled, ENERGY_PILE, 80, { kind: "anyEnergy" }, 80),
      ]),
    );
    expect(answers).toEqual({
      recordMatching: 80,
      recordAll: 240,
      noRecord: 0,
      pileMatching: 320,
      pileAll: 640,
      baseKept: 160,
      anyPokemonNoun: 80,
      anyEnergyNoun: 80,
    });
    const distinct = new Set(Object.values(answers));
    expect(distinct.size).toBe(6);
  });

  it("BOARD B separates ALL EIGHT — which is why the file fields two decks", () => {
    const milled = MISTY_DECK.slice(0, 7);
    const answers = Object.entries(READINGS).map(([name, read]) => [
      name,
      read(milled, MISTY_PILE, 70, { kind: "ownerPokemon", owner: "Misty" }, 70),
    ]);
    expect(Object.fromEntries(answers)).toEqual({
      recordMatching: 140,
      recordAll: 490,
      noRecord: 0,
      pileMatching: 350,
      pileAll: 770,
      baseKept: 210,
      anyPokemonNoun: 280,
      anyEnergyNoun: 70,
    });
    expect(new Set(answers.map(([, v]) => v)).size).toBe(8);
  });
});

describe("D488 §6 — BOARD A on a real board: the Energy noun, and the pile that separates it", () => {
  it("mills 3, counts ONE Energy among them, and deals 80 — not 240, 320 or 640", () => {
    const state = table(ENERGY_DECK, ENERGY_PILE);
    expect(idsIn(state, "p1", "deck")).toEqual([...ENERGY_DECK]);
    expect(idsIn(state, "p1", "discard")).toEqual([...ENERGY_PILE]);
    const { state: done, events } = swing(state, ENERGY_SWING);

    const milled = findEvent(events, "DECK_TOP_DISCARDED");
    expect(milled).toMatchObject({ seat: "p1", actor: "p1" });
    expect(milled?.uids).toHaveLength(3);
    expect(idsIn(done, "p1", "deck")).toEqual([...ENERGY_DECK.slice(3)]);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE, ...ENERGY_DECK.slice(0, 3)]);

    // THE DAMAGE — 80 × 1. Every rival reading of §5 is a different number on this
    // board, so this single assertion refuses five of them at once.
    const damage = findEvent(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", dealt: 80 });
    expect(damage?.weakness).toBeNull();
    expect(done.players.p2.active?.damage).toBe(80);
    expect(countOf(events, "DAMAGE_DEALT")).toBe(1);
    // The printed order is the op order: the mill files its cards, then the damage
    // reads what it filed.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DECK_TOP_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the ZERO-MATCH board deals NOTHING — with four controls against silence", () => {
    const state = table(ZERO_DECK, ENERGY_PILE);
    const { state: done, events } = swing(state, ENERGY_SWING);

    // ① THE MILL RAN — three cards left the deck and are in the pile.
    expect(findEvent(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(3);
    expect(idsIn(done, "p1", "deck")).toEqual([...ZERO_DECK.slice(3)]);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE, ...ZERO_DECK.slice(0, 3)]);
    // ② THE EFFECT WAS SIMULATED — no coverage flag, so the silence is a RESULT.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // ③ NO DAMAGE AT ALL, and the defender is untouched. A build that ignored the
    //    filter would have dealt 240 here.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    // ④ THE TURN STILL ENDED — the attack HAPPENED and chose to do nothing, which is
    //    Hail Blade's declined-pick shape at a board that had no choice to make.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // …and the same swing on a board with ONE Energy on top deals 80, so the zero is
    // not this attack being dead.
    const live = swing(table([...ENERGY_DECK], ENERGY_PILE), ENERGY_SWING);
    expect(findEvent(live.events, "DAMAGE_DEALT")?.dealt).toBe(80);
  });

  it("a SHORT deck mills what it has, and the count follows the board not the print", () => {
    // §8.6 "do as much as you can": the printed 3 against a deck of 2. The mill reports
    // the SHORT list and the damage scales off what actually moved — a build that
    // scaled off the printed number would deal 240 here.
    const shallow = ["d488-water-1", "d488-water-2"] as const;
    const { state: done, events } = swing(table(shallow, ENERGY_PILE), ENERGY_SWING);
    expect(findEvent(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(2);
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(160);
    // Milling to zero does NOT end the game — §14.3 deck-out is a turn-START rule, so
    // the attacker loses at their NEXT draw and not one instant earlier.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an EMPTY deck mills nothing, files nothing and deals nothing", () => {
    const { state: done, events } = swing(table([], ENERGY_PILE), ENERGY_SWING);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE]);
  });
});

describe("D488 §7 — BOARD B: the OWNER-PREFIXED noun, and the wrong owner beside it", () => {
  it("mills 7, counts the TWO Misty's among them, and deals 140", () => {
    const state = table(MISTY_DECK, MISTY_PILE);
    const { state: done, events } = swing(state, MISTY_SWING);

    expect(findEvent(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(7);
    expect(idsIn(done, "p1", "deck")).toEqual([...MISTY_DECK.slice(7)]);
    expect(idsIn(done, "p1", "discard")).toEqual([...MISTY_PILE, ...MISTY_DECK.slice(0, 7)]);

    // 140 = 70 × 2. On this board every one of §5's eight readings is a DIFFERENT
    // number, so this assertion refuses all seven rivals at once — including both
    // wrong-noun readings, which board A could not separate.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(countOf(events, "DAMAGE_DEALT")).toBe(1);
    expect(done.players.p2.active?.damage).toBe(140);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the WRONG OWNER is milled and does not score — `anyPokemon` would have dealt 280", () => {
    // The two Erika's Pokémon are in the milled seven and land in the pile like
    // everything else; what they do not do is count. This is the rung that tells
    // `ownerPokemon` from `anyPokemon`, and §5 names the number the wrong reading gives.
    const { state: done } = swing(table(MISTY_DECK, MISTY_PILE), MISTY_SWING);
    const pile = idsIn(done, "p1", "discard");
    expect(pile).toContain("d488-e1");
    expect(pile).toContain("d488-e2");
    expect(done.players.p2.active?.damage).toBe(140);
    expect(done.players.p2.active?.damage).not.toBe(280);
    const misty: CardFilter = { kind: "ownerPokemon", owner: "Misty" };
    expect(matchesFilter(D488_POOL["d488-m1"], misty)).toBe(true);
    expect(matchesFilter(D488_POOL["d488-e1"], misty)).toBe(false);
    expect(matchesFilter(D488_POOL["d488-plain"], misty)).toBe(false);
    // The prefix is matched WITH its trailing space and exact-case, so a card merely
    // NAMED "Misty" is not one of hers — the conjunct `ownerPokemon`'s doc names.
    expect(matchesFilter({ ...(D488_POOL["d488-m1"] as Card), name: "Mistyveil" }, misty)).toBe(
      false,
    );
    // …and an owner-prefixed NON-Pokémon is not one either (Team Rocket's Energy is the
    // printed instance of that hazard).
    expect(
      matchesFilter({ ...(D488_POOL["d488-item-1"] as Card), name: "Misty's Ticket" }, misty),
    ).toBe(false);
  });
});

describe("D488 §8 — the STALE SLOT: an op that ran and moved nothing must overwrite", () => {
  it("a milled-out deck files an EMPTY answer over an earlier writer's uids", () => {
    const state = table([], ENERGY_PILE);
    const stale = state.players.p1.discard.slice(0, 3);
    expect(stale).toHaveLength(3);

    const events: GameEvent[] = [];
    const record = { discarded: [...stale] };
    const run = runProgram(state, ENERGY_PROGRAM, { seat: "p1" }, record, events);
    expect(run.kind).toBe("done");
    // The mill moved nothing, so the slot is EMPTY and the damage is zero — not the
    // 3 × 80 = 240 the stale uids would have bought.
    expect(record.discarded).toEqual([]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
  });

  it("…and a mill that DID move cards replaces the stale value rather than appending", () => {
    const state = table(ENERGY_DECK, ENERGY_PILE);
    const stale = state.players.p1.discard.slice(0, 3);
    const events: GameEvent[] = [];
    const record = { discarded: [...stale] };
    runProgram(state, ENERGY_PROGRAM, { seat: "p1" }, record, events);
    expect(record.discarded).toHaveLength(3);
    for (const uid of stale) expect(record.discarded).not.toContain(uid);
    // 80, not 320: the three stale Energy uids are NOT added to the one milled Energy.
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ dealt: 80 });
  });

  it("a uid the state cannot resolve does not count", () => {
    // `cardOfUid` returns undefined for a uid with no catalog id and `matchesFilter`
    // answers FALSE — the direction `hpOf`'s null takes one file over. Driven so the
    // `undefined` arm is a decision rather than an accident.
    const state = table([], ENERGY_PILE);
    const events: GameEvent[] = [];
    const record = { discarded: ["not-a-uid", "also-not-a-uid"] };
    runProgram(state, [ENERGY_PROGRAM[1] as EffectOp], { seat: "p1" }, record, events);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
    const both: GameEvent[] = [];
    runProgram(
      state,
      [{ op: "damageDefender", per: 80, count: "discarded" }],
      { seat: "p1" },
      {
        discarded: ["not-a-uid", "also-not-a-uid"],
      },
      both,
    );
    expect(both.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 160 });
  });
});

describe("D488 §9 — `MATCH_RECORD_VERSION` stays 29, driven at the address that persists", () => {
  it("a v29 byte string with BOTH new keys absent still means what it meant", () => {
    const state = table(ENERGY_DECK, ENERGY_PILE);

    // ① The v29 mill: no `recordAs`. It moves the same three cards and files NOTHING.
    const millEvents: GameEvent[] = [];
    const v29Record: { discarded?: string[] } = {};
    const milled = runProgram(state, V29_MILL, { seat: "p1" }, v29Record, millEvents);
    expect(milled.kind).toBe("done");
    expect(v29Record.discarded).toBeUndefined();
    expect(millEvents.filter((e) => e.type === "DECK_TOP_DISCARDED")).toHaveLength(1);
    if (milled.kind !== "done") throw new Error("expected done");
    expect(idsIn(milled.state, "p1", "deck")).toEqual([...ENERGY_DECK.slice(3)]);
    expect(idsIn(milled.state, "p1", "discard")).toEqual([
      ...ENERGY_PILE,
      ...ENERGY_DECK.slice(0, 3),
    ]);

    const scaleEvents: GameEvent[] = [];
    runProgram(
      state,
      V29_SCALE,
      { seat: "p1" },
      {
        discarded: [...state.players.p1.deck.slice(0, 3)],
      },
      scaleEvents,
    );
    expect(scaleEvents.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 240 });
  });

  it("neither key is REQUIRED, and the flat arm cannot carry the new one", () => {
    const bare: EffectOp = { op: "discardDeckTop", whose: "self", count: 3 };
    const flat: EffectOp = { op: "damageDefender", amount: 90 };
    expect(bare).toEqual({ op: "discardDeckTop", whose: "self", count: 3 });
    expect(flat).toEqual({ op: "damageDefender", amount: 90 });
  });
});

describe("D488 §10 — the DESCRIBER obligation, resolved by following the CALL PATH", () => {
  it("neither op PARKS, so there is no caption this slice could have left incomplete", () => {
    const events: GameEvent[] = [];
    const run = runProgram(
      table(ENERGY_DECK, ENERGY_PILE),
      ENERGY_PROGRAM,
      { seat: "p1" },
      {},
      events,
    );
    expect(run.kind).toBe("done");
    const misty: GameEvent[] = [];
    expect(
      runProgram(table(MISTY_DECK, MISTY_PILE), MISTY_PROGRAM, { seat: "p1" }, {}, misty).kind,
    ).toBe("done");
    // …and on the real board the state is never left pending either.
    const { state: done } = swing(table(MISTY_DECK, MISTY_PILE), MISTY_SWING);
    expect(done.pending).toEqual([]);
    expect(done.phase.kind).toBe("turn:action");
  });
});

describe("D488 §11 — the LOUD control, and the neighbours that must not have moved", () => {
  it("a residue sentence on the SAME card still flags ATTACK_EFFECT_SKIPPED", () => {
    expect(readersClaiming(LOUD)).toEqual([]);
    expect(resolvedByAnyReader(LOUD)).toBe(false);
    const { events } = swing(table(ENERGY_DECK, ENERGY_PILE), LOUD_SWING);
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("an attack with NO effect text touches neither deck nor pile", () => {
    // The third silence: index 2 prints a damage box and nothing else, so it is the
    // control that says the mill belongs to the SENTENCE and not to the swing.
    const { state: done, events } = swing(table(ENERGY_DECK, ENERGY_PILE), PLAIN_CUFF);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(idsIn(done, "p1", "deck")).toEqual([...ENERGY_DECK]);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("the bare MILL sentence is unchanged — it neither records nor scales", () => {
    expect(deriveAttackEffect(BARE_MILL)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3 },
    ]);
    expect(deriveAttackEffect("Discard the top card of your opponent's deck.")).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 1 },
    ]);
  });
});
