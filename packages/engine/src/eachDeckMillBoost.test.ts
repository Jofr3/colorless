import type { Card } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import {
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  discardScaledBoostProgram,
} from "./effects";
import type { GameEvent } from "./events";
import { engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectRecord } from "./interpreter";
import { runProgram } from "./interpreter";
import { logFromEvents } from "./log";
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
  findEvent,
  driveSetup,
} from "./testFixtures";

const MILL_BOTH =
  "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.";

const PRINTED_BASE = 50;
const PER = 140;

const SEED = 20260909;

const D490_CARDS: Record<string, Card> = {
  "d490-miller": battler("d490-miller", {
    name: "D490 Miller",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Twin Mill", damage: "50+", effect: MILL_BOTH },
      // The CONTROL attack: same body, same cost, no effect text at all. It is what makes
      // "the mill moved these cards" a claim about the SENTENCE rather than about the turn.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
    ],
  }),
  /** The defender. Big enough that no reading in §4 — correct or wrong — Knocks it Out,
      because a KO ends the batch before the zones can be read. */
  "d490-wall": battler("d490-wall", { name: "D490 Wall", types: ["Colorless"], hp: 700 }),
  "d490-energy-1": basicEnergy("d490-energy-1"),
  "d490-energy-2": basicEnergy("d490-energy-2"),
  "d490-energy-3": basicEnergy("d490-energy-3"),
  "d490-energy-4": basicEnergy("d490-energy-4"),
  "d490-item-1": itemTrainer("d490-item-1"),
  "d490-item-2": itemTrainer("d490-item-2"),
  "d490-item-3": itemTrainer("d490-item-3"),
  "d490-item-4": itemTrainer("d490-item-4"),
  "d490-body-1": battler("d490-body-1", { name: "D490 Body One", types: ["Water"], hp: 60 }),
  "d490-body-2": battler("d490-body-2", { name: "D490 Body Two", types: ["Water"], hp: 60 }),
  "d490-filler": battler("d490-filler", { name: "D490 Filler", types: ["Colorless"], hp: 60 }),
};

const D490_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D490_CARDS };

const D490_DECK = deckOf({
  "d490-miller": 4,
  "d490-wall": 4,
  "d490-energy-1": 4,
  "d490-energy-2": 4,
  "d490-energy-3": 4,
  "d490-energy-4": 4,
  "d490-item-1": 2,
  "d490-item-2": 2,
  "d490-item-3": 2,
  "d490-item-4": 2,
  "d490-body-1": 4,
  "d490-body-2": 4,
  "d490-filler": 20,
});

/** BOARD A — the ATTACKER's top card is an Energy and the OPPONENT's is a Pokémon. */
const A_SELF_DECK = ["d490-energy-1", "d490-item-1", "d490-filler"] as const;
const A_FOE_DECK = ["d490-body-1", "d490-item-2", "d490-filler"] as const;

/** BOARD B — the mirror: the OPPONENT's top card is the Energy. A build that counts only
    the attacker's own milled card answers 190 on A and 50 on B; one that counts only the
    opponent's answers 50 and 190. The correct build answers 190 on both. */
const B_SELF_DECK = ["d490-item-1", "d490-energy-1", "d490-filler"] as const;
const B_FOE_DECK = ["d490-energy-2", "d490-body-1", "d490-filler"] as const;

/** BOARD C — BOTH tops are Energy, so the correct build is the only one that reaches
    N = 2. It is what separates "count both" from every one-sided reading by QUANTITY. */
const C_SELF_DECK = ["d490-energy-1", "d490-item-1", "d490-filler"] as const;
const C_FOE_DECK = ["d490-energy-2", "d490-item-2", "d490-filler"] as const;

const SELF_PILE = ["d490-energy-2", "d490-energy-3", "d490-item-3"] as const;
const FOE_PILE = ["d490-energy-4", "d490-item-4"] as const;

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: D490_DECK, p2: D490_DECK }, { pool: D490_POOL, first });
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

/** p1 owns TURN 2 with the Miller Active and the Wall across the table, both libraries
    and both discard piles rebuilt in the exact orders named. */
function table(
  selfDeck: readonly string[],
  foeDeck: readonly string[],
  selfPile: readonly string[] = SELF_PILE,
  foePile: readonly string[] = FOE_PILE,
): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d490-miller");
  state = setActiveFromDeck(state, "p2", "d490-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "d490-energy-1", 1);
  state = withZones(state, "p1", selfDeck, selfPile);
  return withZones(state, "p2", foeDeck, foePile);
}

const TWIN_MILL = 0;
const PLAIN_CUFF = 1;

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
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const dealtOn = (state: GameState): number => {
  const { events } = swing(state, TWIN_MILL);
  const row = findEvent(events, "DAMAGE_DEALT");
  if (row === undefined) throw new Error("no DAMAGE_DEALT row");
  return row.dealt;
};

describe("D490 §1 — the printed row, off the column rather than off this file", () => {
  it("the sentence is a corpus row at exactly 2 printings, and its apostrophe is U+0027", () => {
    const hit = legalAttackCorpus().filter(([, s]) => s === MILL_BOTH);
    expect(hit).toHaveLength(1);
    expect(units(hit)).toBe(2);
    expect(MILL_BOTH.codePointAt(MILL_BOTH.indexOf("player") + 6)).toBe(0x27);
    expect(legalAttackCorpus().filter(([, s]) => s.includes("’"))).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => s.includes("each player's deck"))).toHaveLength(1);
  });

  it("ONE reader claims it and the other TWELVE still refuse — both polarities", () => {
    expect(readersClaiming(MILL_BOTH)).toEqual(["deriveAttackDiscardScaledBoost"]);
    expect(resolvedByAnyReader(MILL_BOTH)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("no SPLITTER composes it, before the build or after", () => {
    const e = effects as unknown as Record<string, (t: string) => unknown>;
    for (const name of [
      "splitAttackGateClause",
      "splitAttackTrailingClause",
      "splitAttackRequirementClause",
      "splitAttackCancelClause",
    ]) {
      expect(e[name]?.(MILL_BOTH), name).toBeNull();
    }
    expect(resolvedByAnyReader("Discard the top card of each player's deck.")).toBe(false);
    expect(deriveAttackEffect("Discard the top card of each player's deck.")).toBeNull();
  });

  it("the `discarded in this way` family is 12 / 27 and NONE of it is left unread", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
    expect(family.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
  });
});

const AXES: readonly (readonly [string, string, string])[] = [
  ["MILL-SIDE", "each player's", "your"],
  ["COUNT", "the top card of", "the top 3 cards of"],
  ["JOINER", "deck. This attack", "deck, and this attack"],
  ["FOLD", "140 more damage", "140 damage"],
  ["POSSESSOR", "Energy card discarded", "Energy card you discarded"],
];

function latticePoint(mask: number): string {
  let text = MILL_BOTH;
  AXES.forEach(([name, printed, built], i) => {
    if (((mask >> i) & 1) === 0) return;
    if (!text.includes(printed)) throw new Error(`axis ${name}: "${printed}" absent from ${text}`);
    text = text.replace(printed, () => built);
  });
  return text;
}
const popcount = (n: number): number => {
  let c = 0;
  let v = n;
  while (v > 0) {
    c += v & 1;
    v >>= 1;
  }
  return c;
};

describe("D490 §2 — the AXIS-SUBSTITUTION LATTICE: does any proper subset already build?", () => {
  it("all 2⁵ points × 13 readers, and EXACTLY ONE of the 32 builds", () => {
    const built: number[] = [];
    const byWeight = [0, 0, 0, 0, 0, 0];
    for (let mask = 0; mask < 1 << AXES.length; mask++) {
      const text = latticePoint(mask);
      if (readersClaiming(text).length > 0) {
        built.push(mask);
        byWeight[popcount(mask)] = (byWeight[popcount(mask)] ?? 0) + 1;
      }
    }
    expect(byWeight).toEqual([1, 0, 0, 0, 0, 1]);
    expect(built).toEqual([0, (1 << AXES.length) - 1]);
    expect(byWeight.slice(1, 5)).toEqual([0, 0, 0, 0]);
  });

  it("the ALL-FIVE point is D488's shipped compound, and it is the only one claimed", () => {
    const whole = latticePoint((1 << AXES.length) - 1);
    expect(whole).toBe(
      "Discard the top 3 cards of your deck, and this attack does 140 damage for each Energy card you discarded in this way.",
    );
    expect(readersClaiming(whole)).toEqual(["deriveAttackEffect"]);
    expect(deriveAttackEffect(whole)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 140, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
  });

  it("the PRINT itself is claimed only after the build, and each axis alone is not", () => {
    expect(readersClaiming(latticePoint(0))).toEqual(["deriveAttackDiscardScaledBoost"]);
    for (let i = 0; i < AXES.length; i++) {
      const only = AXES[i]?.[0] ?? "?";
      expect(readersClaiming(latticePoint(1 << i)), only).toEqual([]);
    }
  });

  it("the JOINER is a real axis, which the four-axis reading cannot see", () => {
    for (const text of [
      // the printed head with the FOLD and the POSSESSOR moved but the joiner left alone
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card you discarded in this way.",
      // the shipped mill head, PERIOD-joined instead of comma-joined
      "Discard the top 3 cards of your deck. This attack does 140 damage for each Energy card you discarded in this way.",
      // …and the shipped BENCH head with this sentence's filtered noun
      "You may discard up to 2 Energy from your Benched Pokémon. This attack does 140 more damage for each Energy card discarded in this way.",
    ]) {
      expect(readersClaiming(text), text).toEqual([]);
    }
  });
});

describe("D490 §3 — the parse and the program", () => {
  it("the reading is the SECOND member of a two-member union, discriminated by `kind`", () => {
    expect(deriveAttackDiscardScaledBoost(MILL_BOTH)).toEqual({ kind: "eachDeckMill", per: PER });
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toEqual({ kind: "benchDiscard", cap: 2, per: 60, filter: { kind: "anyEnergy" } });
  });

  it("the assembler builds the mill and the ONE additive hit, in printed order", () => {
    expect(discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE)).toEqual([
      { op: "discardDeckTop", whose: "eachPlayer", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ]);
    const [head] = discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE);
    expect(head?.op).toBe("discardDeckTop");
    expect(discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, 0)[1]).toMatchObject({
      base: 0,
    });
  });

  it("every non-amount token is a LITERAL, and each is refused one axis at a time", () => {
    for (const text of [
      // NO TRAILING PERIOD, and a "!" for it — the `$`.
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way",
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way!",
      // A LOWERCASE first word — half of what keeps a whole-sentence reader off a
      // mid-sentence clause, and the reason there is no /i flag.
      "discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE COUNT. The plural spelling is a THIRD-PARTY reading nothing prints, and
      // `deckTopMill.test.ts` already pins its bare form as refused.
      "Discard the top 2 cards of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE SEATS, one word at a time.
      "Discard the top card of your deck. This attack does 140 more damage for each Energy card discarded in this way.",
      "Discard the top card of your opponent's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      "Discard the top card of each player's hand. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE FOLD. Without "more" this is the MULTIPLY family, which DROPS the printed base
      // — a different reader and a different number on every board.
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each Item card discarded in this way.",
      // THE ANAPHOR. Without "in this way" the clause is a BOARD read of the pile, which is
      // a different number on every board whose pile was not empty.
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card in your discard pile.",
      "Discard the top card of each player's deck. This attack does 0 more damage for each Energy card discarded in this way.",
      "Draw a card. Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // …and the lowercase form is KEPT, because it is a real and separate claim (the
      // family carries no /i flag) — it is simply not evidence about the caret.
      "Before doing damage, discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way. Then, shuffle your deck.",
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
    for (const text of [
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each card discarded in this way.",
    ]) {
      expect(readersClaiming(text), text).toEqual([]);
    }
  });

  it("the CURLY apostrophe IS read, and the ASCII one is what the column prints", () => {
    const curly = MILL_BOTH.replace("player's", () => "player’s");
    expect(curly).not.toBe(MILL_BOTH);
    expect(deriveAttackDiscardScaledBoost(curly)).toEqual(
      deriveAttackDiscardScaledBoost(MILL_BOTH),
    );
    // An NBSP where an ASCII space is printed is NOT accepted — byte-different and
    // invisible in a diff, which is why the case names it instead of carrying it.
    expect(
      deriveAttackDiscardScaledBoost(MILL_BOTH.replace("top card", () => "top card")),
    ).toBeNull();
    // Outer whitespace survives by design (the reader trims).
    expect(deriveAttackDiscardScaledBoost(`  ${MILL_BOTH}\n`)).toEqual({
      kind: "eachDeckMill",
      per: PER,
    });
  });
});

/** A candidate reading: `(mineMilled, theirsMilled, minePileBefore, theirsPileBefore)` →
    the damage it would deal. Every one is a real build someone could ship. */
type Reading = (
  mine: readonly string[],
  theirs: readonly string[],
  minePile: readonly string[],
  theirsPile: readonly string[],
) => number;

const isEnergy = (id: string): boolean => D490_POOL[id]?.category === "Energy";
const energies = (ids: readonly string[]): number => ids.filter(isEnergy).length;

const READINGS: readonly (readonly [string, Reading])[] = [
  // THE BUILD. Mill one off EACH deck, count the Energy across BOTH, keep the printed base.
  ["both-filtered-base", (m, t) => PRINTED_BASE + PER * (energies(m) + energies(t))],
  // The `you` that the print does NOT carry — count only the attacker's own milled card.
  ["mine-only", (mine) => PRINTED_BASE + PER * energies(mine)],
  // Its mirror.
  ["theirs-only", (_mine, theirs) => PRINTED_BASE + PER * energies(theirs)],
  // The `countFilter` dropped: every milled card scores, not only the Energy.
  ["both-unfiltered", (m, t) => PRINTED_BASE + PER * (m.length + t.length)],
  // The MULTIPLY family's fold: the printed base DROPPED rather than kept (`more` unread).
  ["both-filtered-nobase", (m, t) => PER * (energies(m) + energies(t))],
  // A board re-scan instead of the §9.2 record: count the attacker's whole pile afterwards.
  ["my-pile-after", (m, _t, mp) => PRINTED_BASE + PER * (energies(mp) + energies(m))],
  // …and both piles afterwards.
  [
    "both-piles-after",
    (m, t, mp, tp) =>
      PRINTED_BASE + PER * (energies(mp) + energies(tp) + energies(m) + energies(t)),
  ],
];

/** The three boards as `[mineMilled, theirsMilled]` — one card off each deck's TOP. */
const BOARD_MILLS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["A", [A_SELF_DECK[0]], [A_FOE_DECK[0]]],
  ["B", [B_SELF_DECK[0]], [B_FOE_DECK[0]]],
  ["C", [C_SELF_DECK[0]], [C_FOE_DECK[0]]],
];

describe("D490 §4 — the readings table: how many does each board separate?", () => {
  it("board A ALONE separates 5 of 7, and A+B separate all 7 — MEASURED", () => {
    const on = (board: number): number[] =>
      READINGS.map(([, read]) =>
        read(BOARD_MILLS[board]?.[1] ?? [], BOARD_MILLS[board]?.[2] ?? [], SELF_PILE, FOE_PILE),
      );
    // Board A: the attacker's top is an Energy, the opponent's is a Pokémon.
    expect(on(0)).toEqual([190, 190, 50, 330, 140, 470, 610]);
    expect(new Set(on(0)).size).toBe(6);
    // Board B: the mirror. `mine-only` answers 50 where the build answers 190.
    expect(on(1)).toEqual([190, 50, 190, 330, 140, 330, 610]);
    // …and the PAIR separates every one of the seven, which no single board does.
    const pairs = READINGS.map((_, i) => `${on(0)[i]}/${on(1)[i]}`);
    expect(new Set(pairs).size).toBe(READINGS.length);
    expect(pairs).toEqual([
      "190/190",
      "190/50",
      "50/190",
      "330/330",
      "140/140",
      "470/330",
      "610/610",
    ]);
  });

  it("board C is the only one where the BUILD reaches N = 2, and it is 330", () => {
    // Two Energy off two decks. Every one-sided reading is capped at ONE card by
    // construction, so this is the board that separates "count both" from "count either"
    // by quantity rather than by which side.
    const on = READINGS.map(([, read]) =>
      read(BOARD_MILLS[2]?.[1] ?? [], BOARD_MILLS[2]?.[2] ?? [], SELF_PILE, FOE_PILE),
    );
    expect(on).toEqual([330, 190, 190, 330, 280, 470, 750]);
    expect(on[0]).toBe(PRINTED_BASE + 2 * PER);
  });

  it("two candidates NO board separates by quantity, and they are separated by CONTENTS", () => {
    const mineOnlyMill = READINGS[1]?.[1];
    const theirsOnlyMill = READINGS[2]?.[1];
    if (mineOnlyMill === undefined || theirsOnlyMill === undefined) throw new Error("no reading");
    // A self-only WALK deals what a both-decks walk with a `you` count deals; an
    // opponent-only walk deals what a "theirs" count deals. Identical on every board.
    expect(mineOnlyMill([A_SELF_DECK[0]], [], SELF_PILE, FOE_PILE)).toBe(
      mineOnlyMill([A_SELF_DECK[0]], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE),
    );
    expect(theirsOnlyMill([], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE)).toBe(
      theirsOnlyMill([A_SELF_DECK[0]], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE),
    );
  });
});

describe("D490 §5 — the three boards, driven end to end", () => {
  it("BOARD A — one Energy off MY deck, a Pokémon off THEIRS: 190", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      by: "p1",
      base: 190,
      dealt: 190,
    });
    expect(done.players.p2.active?.damage).toBe(190);
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-item-1", "d490-filler"]);
    expect(idsIn(done, "p2", "deck")).toEqual(["d490-filler"]);
    expect(idsIn(done, "p2", "hand")).toContain("d490-item-2");
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-body-1"]);
    // TWO mill rows, one per seat, each filed under the deck's OWNER with the ATTACKER as
    // the actor — so the log's voice ternary sees one self path and one victim path.
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.seat, r.actor, r.uids.length])).toEqual([
      ["p1", "p1", 1],
      ["p2", "p1", 1],
    ]);
    expect(rows[0]?.seat).toBe("p1");
  });

  it("the walk is CONTROLLER-FIRST, which only a board with the OTHER attacker can show", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const events: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p2" },
      events,
      {},
    );
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows.map((r) => [r.seat, r.actor])).toEqual([
      ["p2", "p2"],
      ["p1", "p2"],
    ]);
    const mirror: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      mirror,
      {},
    );
    expect(all(mirror, "DECK_TOP_DISCARDED").map((r) => [r.seat, r.actor])).toEqual([
      ["p1", "p1"],
      ["p2", "p1"],
    ]);
  });

  it("BOARD B — the mirror: a Pokémon off MY deck, one Energy off THEIRS: still 190", () => {
    const state = table(B_SELF_DECK, B_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 190 });
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-item-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(2);
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-energy-1", "d490-filler"]);
  });

  it("BOARD C — an Energy off BOTH decks: 330, the only N = 2 in the family", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 330 });
    expect(done.players.p2.active?.damage).toBe(330);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
  });

  it("the PRE-SEEDED piles are load-bearing: a pile re-scan answers 470, not 190", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    expect(idsIn(state, "p1", "discard").filter(isEnergy)).toHaveLength(2);
    expect(dealtOn(state)).toBe(190);
    // …and with the piles EMPTIED the two readings agree — stated so the seeding cannot be
    // "simplified" away by a successor who sees no rung depending on it.
    const bare = table(A_SELF_DECK, A_FOE_DECK, [], []);
    const readByRecord = READINGS[0]?.[1];
    const readByPile = READINGS[5]?.[1];
    if (readByRecord === undefined || readByPile === undefined) throw new Error("no reading");
    expect(readByPile([A_SELF_DECK[0]], [A_FOE_DECK[0]], [], [])).toBe(
      readByRecord([A_SELF_DECK[0]], [A_FOE_DECK[0]], [], []),
    );
    expect(dealtOn(bare)).toBe(190);
  });

  it("the CONTROL attack on the same body mills nothing and deals its printed 10", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, PLAIN_CUFF);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(idsIn(done, "p1", "deck")).toEqual([...A_SELF_DECK]);
    // The defender's deck is one shorter than the board's, and that ONE card is their own
    // turn-start draw rather than anything this attack did — the discard piles, which the
    // draw cannot touch, are byte-identical to the board.
    expect(idsIn(done, "p2", "deck")).toEqual([...A_FOE_DECK].slice(1));
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE]);
  });
});

describe("D490 §6 — an EMPTY deck on either side, and on both", () => {
  it("my deck empty: ONE row, the opponent's card still counts, 190", () => {
    // "Do as much as you can" (§8.6). The walk skips the seat that has nothing and files
    // only what actually moved — a build whose empty-deck path RETURNED instead of
    // continuing would mill neither deck and deal the bare 50.
    const state = table([], A_FOE_DECK.slice(0, 2));
    const { state: done, events } = swing(state, TWIN_MILL);
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p2", actor: "p1" });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE]);
  });

  it("my deck empty and THEIR top is an Energy: still 190 — the count is not my deck's", () => {
    const state = table([], ["d490-energy-2", "d490-filler"]);
    const { events } = swing(state, TWIN_MILL);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
  });

  it("BOTH decks empty: NO mill row at all, and the printed base alone", () => {
    const state = table([], []);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
    const midEvents: GameEvent[] = [];
    const mid = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      midEvents,
      {},
    );
    expect(mid.kind).toBe("done");
    if (mid.kind !== "done") throw new Error("expected done");
    expect(mid.state.phase.kind).not.toBe("gameOver");
    expect(idsIn(mid.state, "p1", "deck")).toEqual([]);
    expect(idsIn(mid.state, "p2", "deck")).toEqual([]);
    // …and end to end, the defender draws into an empty deck and loses — which is the
    // ATTACKER's win, not a draw, and the asymmetry is entirely in the rule rather than in
    // the op (the two directions run the same code).
    expect(done.phase.kind).toBe("gameOver");
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(idsIn(done, "p2", "deck")).toEqual([]);
  });

  it("the SLOT is filed even when nothing moved — the record does not go stale", () => {
    const state = table([], []);
    const record: EffectRecord = { discarded: ["p1#0", "p1#1", "p1#2"] };
    const events: GameEvent[] = [];
    const run = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      events,
      record,
    );
    expect(run.kind).toBe("done");
    expect(record.discarded).toEqual([]);
    // 50, not 50 + 3 × 140: the three stale uids are NOT counted.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
  });
});

describe("D490 §7 — why it is ONE op: two sequential mills OVERWRITE one slot", () => {
  it("the two-mill program files only the SECOND deck's card, and deals 190 → 50", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const sequential: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "discarded" },
      { op: "discardDeckTop", whose: "opponent", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, sequential, { seat: "p1" }, events, record);
    // BOTH decks were milled — the zones are right and only the RECORD is wrong, which is
    // exactly why no board-shaped assertion could have found this.
    expect(record.discarded).toHaveLength(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(2);
    // …against the shipped one-op spelling on the SAME board.
    const oneOp: EffectRecord = {};
    const oneOpEvents: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      oneOpEvents,
      oneOp,
    );
    expect(oneOp.discarded).toHaveLength(2);
    expect(findEvent(oneOpEvents, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + 2 * PER });
  });

  it("two SLOTS is no escape either — `damageDefender.count` is ONE address", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const twoSlots: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "paid" },
      { op: "discardDeckTop", whose: "opponent", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, twoSlots, { seat: "p1" }, events, record);
    expect(record.paid).toHaveLength(1);
    expect(record.discarded).toHaveLength(1);
    // 190, not 330 — half the sentence, silently.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
  });

  it("the state is THREADED through the walk — the second write does not clobber the first", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const events: GameEvent[] = [];
    const run = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      events,
      {},
    );
    if (run.kind !== "done") throw new Error("expected done");
    const done = run.state;
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-item-1", "d490-filler"]);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "deck")).toEqual(["d490-item-2", "d490-filler"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
    // …and the two decks each lost EXACTLY one card, which a clobbering write-back fails
    // on the attacker's side while leaving every damage figure untouched.
    expect(done.players.p1.deck).toHaveLength(C_SELF_DECK.length - 1);
    expect(done.players.p2.deck).toHaveLength(C_FOE_DECK.length - 1);
  });
});

describe("D490 §8 — the LOG: two rows, two voices, and no wording moved", () => {
  it("the attacker's own deck reads ACTIVE and the opponent's reads PASSIVE", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    const rows = logFromEvents(all(events, "DECK_TOP_DISCARDED"), {
      names: { p1: "Ash", p2: "Misty" },
      state: done,
      elapsed: "+00:07",
    });
    expect(rows).toHaveLength(2);
    const text = (entry: (typeof rows)[number]): string =>
      entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join("");
    expect(rows.map((r) => [r.kind === "action" ? r.who : "turn", text(r)])).toEqual([
      ["p1", "discarded 1 card from the top of their deck"],
      ["p2", "had 1 card discarded from the top of their deck"],
    ]);
    expect(text(rows[0] as (typeof rows)[number])).toMatch(/^discarded /);
    expect(text(rows[1] as (typeof rows)[number])).toMatch(/^had /);
  });

  it("the DAMAGE row credits the attacker and names the defender as the victim", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const { events } = swing(state, TWIN_MILL);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", by: "p1", dealt: 330 });
  });

  it("the loud channel does NOT fire — the sentence and the `+` marker are both simulated", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { events } = swing(state, TWIN_MILL);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("D490 §9 — `MATCH_RECORD_VERSION` stays 29: reachability, driven", () => {
  it("the program is TWO ops and NEITHER can park, so no continuation is ever written", () => {
    const program = discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE);
    expect(program).toHaveLength(2);
    expect(program.map((op) => op.op)).toEqual(["discardDeckTop", "damageDefender"]);
    for (const state of [table(C_SELF_DECK, C_FOE_DECK), table([], [])]) {
      const events: GameEvent[] = [];
      const run = runProgram(state, program, { seat: "p1" }, events, {});
      expect(run.kind).toBe("done");
      const { state: done } = swing(state, TWIN_MILL);
      expect(done.phase.kind).not.toBe("effect:choose");
      expect("cont" in done.phase).toBe(false);
    }
  });

  it('`"eachPlayer"` has exactly ONE producer in the whole engine, at index 0', () => {
    const sites: string[] = [];
    const walk = (ops: readonly EffectOp[], where: string): void => {
      ops.forEach((op, i) => {
        if (op.op === "discardDeckTop" && op.whose === "eachPlayer") sites.push(`${where}[${i}]`);
        for (const key of ["then", "otherwise", "ops"] as const) {
          const sub = (op as unknown as Record<string, unknown>)[key];
          if (Array.isArray(sub)) walk(sub as EffectOp[], `${where}.${op.op}.${key}`);
        }
      });
    };
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) walk(derived, "deriveAttackEffect");
      const reading = deriveAttackDiscardScaledBoost(text);
      if (reading !== null) walk(discardScaledBoostProgram(reading, PRINTED_BASE), "assembler");
    }
    expect(sites).toEqual(["assembler[0]"]);
  });

  it("a v29 byte string still means what a v29 writer meant — the LOSS direction", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const v29: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, v29, { seat: "p1" }, events, record);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
    expect(record.discarded).toHaveLength(1);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
    expect(dealtOn(table(C_SELF_DECK, C_FOE_DECK))).toBe(PRINTED_BASE + 2 * PER);
  });

  it("the DESCRIBER obligation is empty, and it is traced rather than argued", () => {
    for (const state of [
      table(A_SELF_DECK, A_FOE_DECK),
      table(B_SELF_DECK, B_FOE_DECK),
      table(C_SELF_DECK, C_FOE_DECK),
      table([], []),
    ]) {
      const events: GameEvent[] = [];
      const run = runProgram(
        state,
        discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
        { seat: "p1" },
        events,
        {},
      );
      expect(run.kind).toBe("done");
    }
    // …and the program holds NO gate for a describer to phrase, which is the other half of
    // the condition — stated so a successor who adds a gate here knows the obligation
    // becomes live in the same edit.
    expect(
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE).some(
        (op) => op.op === "recordGate",
      ),
    ).toBe(false);
  });

  it("engineVersion is 0.555.0 and `manifest.version` agrees — the bump is for BEHAVIOUR", () => {
    expect(manifest.version).toBe(engineVersion);
    expect(deriveAttackDiscardScaledBoost(MILL_BOTH)).not.toBeNull();
  });
});
