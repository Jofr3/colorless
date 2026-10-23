import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import { deriveAttackCancelRequirement, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { runProgram, resumeProgram } from "./interpreter";
import {
  completeSetup,
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  itemTrainer,
  must,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

const PRINTED =
  "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The shipped SIBLINGS this arm sits between, all three real printed rows rather than
    constructed ones — they are what §2's axis substitutions land on, and what §3's
    disjointness rungs are asserted against. */
const BOARD_DISCARD_SCALED =
  "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.";
const SELF_DISCARD_SNIPE =
  "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SCALED_SNIPE_ON_SELF =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const LOUD = "Put this Pokémon and all attached cards into your hand.";

/** The program the anchor derives. Written once and asserted against
    `deriveAttackEffect` in §3, so every later section drives the SAME object the reader
    produces rather than a hand-copy of it. */
const PROGRAM: readonly EffectOp[] = [
  {
    op: "payFromHand",
    count: "any",
    cap: 3,
    to: "discard",
    filter: { kind: "anyEnergy" },
    recordAs: "discarded",
  },
  {
    op: "damageChosen",
    target: "opponentAny",
    amount: 60,
    count: 1,
    source: "attack",
    deals: true,
    perRecorded: "discarded",
  },
];

/** The v29 byte strings: the SAME two ops with the new bytes ABSENT — an EXACT payment
    where the new arm is declinable, and an UNSCALED snipe where the new rider names a
    slot. §7 reads them back and drives that they still mean what a v29 writer meant. */
const V29_PAYMENT: readonly EffectOp[] = [
  {
    op: "payFromHand",
    count: 2,
    to: "discard",
    filter: { kind: "anyEnergy" },
    recordAs: "discarded",
  },
];
const V29_SNIPE: readonly EffectOp[] = [
  {
    op: "damageChosen",
    target: "opponentAny",
    amount: 60,
    count: 1,
    source: "attack",
    deals: true,
  },
];

const SEED = 20260909;

/** The Energy ids on this board, as a set, so the fixture rungs in §5 read the same
    fact the interpreter does rather than a name prefix that could drift. */
const ENERGY_IDS = new Set(["d489-fire", "d489-water", "d489-grass", "d489-en-d", "d489-cost"]);

const HAND_PURGE = 0;
const PLAIN_CUFF = 1;
const LOUD_SWING = 2;

const D489_CARDS: Record<string, Card> = {
  "d489-thrower": battler("d489-thrower", {
    name: "D489 Thrower",
    types: ["Water"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Hand Purge", effect: PRINTED },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Borrowed Reach", effect: LOUD },
    ],
  }),
  "d489-wall": battler("d489-wall", {
    name: "D489 Wall",
    types: ["Colorless"],
    hp: 340,
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  /** The BENCHED victim — no weakness, so §8.5's *"not for Benched Pokémon"* is
      observable as a flat number beside the Active's doubled one. */
  "d489-bench": battler("d489-bench", { name: "D489 Bench", types: ["Colorless"], hp: 200 }),
  "d489-cost": basicEnergy("d489-cost"),
  "d489-fire": typedEnergy("d489-fire", "Fire"),
  "d489-water": typedEnergy("d489-water", "Water"),
  "d489-grass": typedEnergy("d489-grass", "Grass"),
  "d489-en-d": basicEnergy("d489-en-d"),
  /** The NON-Energy in hand. Without them the printed noun `Energy cards` is
      unfalsifiable: every candidate would match every filter. */
  "d489-item-1": itemTrainer("d489-item-1"),
  "d489-item-2": itemTrainer("d489-item-2"),
  "d489-item-3": itemTrainer("d489-item-3"),
};

const D489_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D489_CARDS };

const D489_DECK = deckOf({
  "d489-thrower": 4,
  "d489-wall": 4,
  "d489-bench": 4,
  "d489-cost": 4,
  "d489-fire": 4,
  "d489-water": 12,
  "d489-grass": 4,
  "d489-en-d": 4,
  "d489-item-1": 12,
  "d489-item-2": 4,
  "d489-item-3": 4,
});

const HAND = [
  "d489-fire",
  "d489-water",
  "d489-water",
  "d489-water",
  "d489-grass",
  "d489-item-1",
  "d489-item-2",
] as const;

/** The PRE-SEEDED discard pile: four cards, TWO of them Energy. On an empty pile
    *"count what the slot recorded"* and *"count the Energy in the pile afterwards"* are
    the same number for every pick; here they are 60×k against 60×(2+k). */
const PILE = ["d489-en-d", "d489-en-d", "d489-item-3", "d489-item-3"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: D489_DECK, p2: D489_DECK },
    cardPool: D489_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }),
  );
  table = completeSetup(table);
  return table;
}

function withZones(
  state: GameState,
  seat: Seat,
  handIds: readonly string[],
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
  const hand = take(handIds);
  const discard = take(discardIds);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand, discard, deck: pool } },
  };
}

function table(
  hand: readonly string[] = HAND,
  pile: readonly string[] = PILE,
  attacker: Seat = "p1",
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d489-thrower");
  state = setActiveFromDeck(state, defender, "d489-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = benchFromDeck(state, defender, "d489-bench");
  state = attachFromDeck(state, attacker, "d489-cost", 2);
  return withZones(state, attacker, hand, pile);
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
function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const types_ = (events: GameEvent[]): string[] => events.map((e) => e.type);

function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The chooseCards prompt a parked hand discard raises, or a throw. */
function handPrompt(state: GameState): {
  candidates: readonly string[];
  min: number;
  max: number;
  note: string;
  dest: string;
} {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return {
    candidates: prompt.candidates,
    min: prompt.min,
    max: prompt.max,
    note: prompt.note,
    dest: String(prompt.dest),
  };
}
/** The choosePokemonMulti prompt the snipe raises, or a throw. */
function snipePrompt(state: GameState): {
  candidates: readonly PokemonRef[];
  min: number;
  max: number;
  note: string;
} {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti")
    throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  return { candidates: prompt.candidates, min: prompt.min, max: prompt.max, note: prompt.note };
}
const uidsOf = (state: GameState, cands: readonly string[], id: string, n: number): string[] =>
  cands.filter((uid) => idOf(uid, state) === id).slice(0, n);
const answerCards = (state: GameState, uids: readonly string[]) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });
const answerBody = (state: GameState, ref: PokemonRef) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [ref] },
  });

describe("D489 §1 — the printed row, off the column rather than off this file", () => {
  it("the sentence is in `legalAttackCorpus()` at exactly 2 printings, and its apostrophes are U+0027", () => {
    const rows = legalAttackCorpus();
    const hit = rows.filter(([, s]) => s === PRINTED);
    expect(hit).toHaveLength(1);
    expect(units(hit)).toBe(2);
    const apostrophes = [...PRINTED].flatMap((ch, i) => (ch === "'" || ch === "’" ? [i] : []));
    expect(apostrophes).toHaveLength(2);
    for (const at of apostrophes) expect(PRINTED.codePointAt(at)).toBe(0x27);
    for (const text of [BOARD_DISCARD_SCALED, SELF_DISCARD_SNIPE, SCALED_SNIPE_ON_SELF]) {
      expect(
        rows.some(([, s]) => s === text),
        text,
      ).toBe(true);
    }
  });

  it("the anchor claims THIS row and no other in the whole 640-sentence column", () => {
    const rows = legalAttackCorpus();
    const taken = rows.filter(
      ([, s]) =>
        /^Discard up to \d+ Energy cards from your hand\./.test(s) && readersClaiming(s).length > 0,
    );
    expect(taken).toEqual([[2, PRINTED]]);
    expect(readersClaiming(PRINTED)).toEqual(["deriveAttackEffect"]);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(readersClaiming(LOUD)).toEqual([]);
  });

  it("the reader surface stands still at THIRTEEN — no reader was added", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("no CANCEL clause is printed, which is what makes the D420 escape a question at all", () => {
    // §4 of `handEnergyCancel.test.ts` owns the guard; this rung owns the PREMISE it
    // rests on. If this sentence ever gained a printed cancel the escape would be
    // unnecessary, and the rung there would be green for the wrong reason.
    expect(deriveAttackCancelRequirement(PRINTED)).toBeNull();
  });
});

describe("D489 §2 — AXIS DELETION: which half of this sentence already shipped?", () => {
  const AXES: readonly (readonly [string, (s: string) => string])[] = [
    ["FILTER", (s) => s.replace("3 Energy cards", "3 {G} Energy cards")],
    ["ZONE", (s) => s.replace("from your hand", "from your Pokémon")],
    ["CHOSEN", (s) => s.replace(" to 1 of your opponent's Pokémon", "")],
    [
      "COUNT-NOUN",
      (s) => s.replace("for each Energy card you discarded", "for each card you discarded"),
    ],
    ["W/R", (s) => s.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", "")],
  ];
  /** Every point of the 2⁵ lattice, as `[bitmask, axes applied, text]`. */
  const lattice = Array.from({ length: 32 }, (_, mask) => {
    let text = PRINTED;
    const names: string[] = [];
    AXES.forEach(([name, apply], i) => {
      if ((mask & (1 << i)) !== 0) {
        text = apply(text);
        names.push(name);
      }
    });
    return { mask, names, text };
  });

  it("exactly THREE of the 32 points build, and TWO of them are this slice's own anchor", () => {
    const building = lattice.filter(({ text }) => readersClaiming(text).length > 0);
    expect(building.map(({ names }) => names.join("+") || "PRINTED")).toEqual([
      "PRINTED",
      "W/R",
      "FILTER+ZONE+CHOSEN+COUNT-NOUN+W/R",
    ]);
    const only = building[2];
    if (only === undefined) throw new Error("no all-five point");
    // …and it lands on the SHIPPED board-discard sibling's anchor, at this file's own
    // numbers. Naming what it lands on is what makes the lattice a price rather than a
    // count: five axes, and the fifth is where the family already is.
    expect(only.text).toBe(
      "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
    );
    expect(deriveAttackEffect(only.text)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Grass" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
  });

  it("no SINGLE, PAIR, TRIPLE or QUADRUPLE substitution reaches a claimed string", () => {
    const OURS = new Set(["", "W/R"]);
    for (const arity of [0, 1, 2, 3, 4]) {
      const points = lattice.filter(({ names }) => names.length === arity);
      expect(points.length, `arity ${arity}`).toBe([1, 5, 10, 10, 5][arity]);
      for (const { names, text } of points) {
        if (OURS.has(names.join("+"))) {
          // …and the excluded pair is asserted to be OURS, so the exemption cannot
          // quietly cover a point some other reader started claiming.
          expect(readersClaiming(text), names.join("+")).toEqual(["deriveAttackEffect"]);
          expect(deriveAttackEffect(text), names.join("+")).toEqual(PROGRAM);
          continue;
        }
        expect(readersClaiming(text), `${arity}: ${names.join("+")} :: ${text}`).toEqual([]);
      }
    }
  });

  it("this row is ALONE: no other residue sentence shares either of its two blockers", () => {
    const rows = legalAttackCorpus();
    const residue = rows.filter(([, s]) => !resolvedByAnyReader(s));
    const GATED_OPPONENT_DISCARD =
      "Discard a card from your hand. If you do, your opponent discards a card from their hand.";
    const handDiscards = residue.filter(([, s]) => /^Discard [^.]* from your hand\./.test(s));
    expect(handDiscards.map(([, s]) => s)).toEqual([]);
    expect(deriveAttackEffect(GATED_OPPONENT_DISCARD)).not.toBeNull();
    expect(deriveAttackEffect("Your opponent discards a card from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    expect(effects.splitAttackGateClause(GATED_OPPONENT_DISCARD)).toBeNull();
    expect(effects.splitAttackTrailingClause(GATED_OPPONENT_DISCARD)).toBeNull();
    const scaledChosen = residue.filter(
      ([, s]) => /for each/i.test(s) && /to 1 of your opponent/.test(s),
    );
    const TARGET_COUNTER_SNIPE =
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(rows.some(([, s]) => s === TARGET_COUNTER_SNIPE)).toBe(true);
    expect(deriveAttackEffect(TARGET_COUNTER_SNIPE)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    expect(scaledChosen.map(([, s]) => s)).toEqual([]);
  });
});

describe("D489 §3 — the READING: two ops in printed order, and what each byte refuses", () => {
  it("the printed sentence derives to the payment then the scaled snipe", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("a printed 0 in EITHER position stays LOUD, each against its own twin", () => {
    for (const [bad, good] of [
      [
        PRINTED.replace("up to 3 Energy", "up to 0 Energy"),
        PRINTED.replace("up to 3 Energy", "up to 1 Energy"),
      ],
      [
        PRINTED.replace("does 60 damage", "does 0 damage"),
        PRINTED.replace("does 60 damage", "does 1 damage"),
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });

  it("every GENERALISATION of this anchor claims the same 1 sentence / 2 printings", () => {
    const rows = legalAttackCorpus();
    const wider: readonly (readonly [string, RegExp])[] = [
      [
        "arity CAPTURED",
        /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to \d+ of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/,
      ],
      [
        "zone OPENED",
        /^Discard up to \d+ Energy cards from (?:your hand|this Pokémon|your Pokémon)\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/,
      ],
      [
        "quantifier OPENED",
        /^Discard (?:all|any amount of|up to \d+) Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/,
      ],
      [
        "count noun CAPTURED",
        /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each [^.]+ you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/,
      ],
      [
        "`Energy cards?` alternation",
        /^Discard up to \d+ Energy(?: cards)? from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/,
      ],
      [
        "W/R MANDATORY",
        /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/,
      ],
    ];
    for (const [label, re] of wider) {
      const hit = rows.filter(([, s]) => re.test(s));
      expect(
        hit.map(([, s]) => s),
        label,
      ).toEqual([PRINTED]);
      expect(units(hit), label).toBe(2);
    }
  });

  it("the W/R clarifier is OPTIONAL, which is the family's rule and not this anchor's choice", () => {
    const bare = PRINTED.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", "");
    expect(deriveAttackEffect(bare)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, s]) => s === bare)).toBe(false);
  });

  it("LEADING TEXT stays LOUD — the `^` is what refuses it, and nothing else", () => {
    const LEADING = `Draw a card. ${PRINTED}`;
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
    expect(deriveAttackEffect(LEADING)).toBeNull();
    expect(readersClaiming(LEADING)).toEqual([]);
    expect(legalAttackCorpus().some(([, t]) => t !== PRINTED && t.includes(PRINTED))).toBe(false);
  });

  it("STRUCTURALLY DISJOINT from all three neighbours, with no guard anywhere", () => {
    expect(deriveAttackEffect(SELF_DISCARD_SNIPE)?.[0]?.op).toBe("discardEnergy");
    expect(deriveAttackEffect(BOARD_DISCARD_SCALED)?.[0]?.op).toBe("discardEnergy");
    expect(deriveAttackEffect(SCALED_SNIPE_ON_SELF)?.[0]?.op).toBe("damageChosen");
    expect(deriveAttackEffect(PRINTED)?.[0]?.op).toBe("payFromHand");
    for (const other of [SELF_DISCARD_SNIPE, BOARD_DISCARD_SCALED, SCALED_SNIPE_ON_SELF]) {
      expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(other));
    }
  });
});

describe("D489 §4 — the DECLINABLE payment: the offer, the ceiling and the noun", () => {
  it("parks a chooseCards whose FLOOR is 0, whose ceiling is the printed cap, and whose note is the printed head", () => {
    const { state: parked, events } = swing(table(), HAND_PURGE);
    expect(types_(events)).toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Nothing has been paid yet — the park comes BEFORE the move.
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    const prompt = handPrompt(parked);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("discard");
    expect(prompt.note).toBe("Discard up to 3 Energy cards from your hand.");
    expect(PRINTED.startsWith(prompt.note)).toBe(true);
    expect(prompt.candidates.map((uid) => idOf(uid, parked)).sort()).toEqual(
      ["d489-fire", "d489-water", "d489-water", "d489-water", "d489-grass"].sort(),
    );
  });

  it("the interchangeable class is NOT collapsed below the cap — three copies, three rows", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const bs = prompt.candidates.filter((uid) => idOf(uid, parked) === "d489-water");
    expect(bs).toHaveLength(3);
    expect(new Set(bs).size).toBe(3);
  });

  it("the attacker's ATTACHED cost Energy is never on offer, and is still attached afterwards", () => {
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    const prompt = handPrompt(parked);
    for (const uid of prompt.candidates) expect(idOf(uid, parked)).not.toBe("d489-cost");
    const { state: picked } = answerCards(
      parked,
      uidsOf(parked, prompt.candidates, "d489-fire", 1),
    );
    const ref = snipePrompt(picked).candidates.find((r) => r.spot.spot !== "active");
    if (ref === undefined) throw new Error("no benched candidate");
    const { state: done } = answerBody(picked, ref);
    expect(done.players.p1.active?.energy.map((uid) => idOf(uid, done))).toEqual([
      "d489-cost",
      "d489-cost",
    ]);
  });

  it("REJECTS an over-cap pick, a repeat and a card that was never offered", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const bs = uidsOf(parked, prompt.candidates, "d489-water", 3);
    const a = uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string;
    const c = uidsOf(parked, prompt.candidates, "d489-grass", 1)[0] as string;
    for (const uids of [
      [...bs, a],
      [a, a],
      [a, parked.players.p1.deck[0] as string],
    ]) {
      const rejected = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids },
      });
      expect(rejected.ok, JSON.stringify(uids)).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [a, c, bs[0] as string] },
      }).ok,
    ).toBe(true);
  });

  it("an EMPTY offer whiffs inline: no park, an empty slot, and no snipe at all", () => {
    // A hand with no Energy at all. The recording op files `[]` — the whiff every
    // recording op takes — so the fold reads an honest 0 and `damageChosen` returns
    // before it builds a prompt. **The attack asks for no target and deals nothing.**
    const { state: done, events } = swing(table(["d489-item-1", "d489-item-2"], PILE), HAND_PURGE);
    expect(types_(events)).not.toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    expect(types_(events)).not.toContain("DAMAGE_DEALT");
    expect(types_(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a single candidate STILL PARKS — the printed `up to` is a decision at every non-empty hand", () => {
    const { state: parked } = swing(table(["d489-fire", "d489-item-1"], PILE), HAND_PURGE);
    const prompt = handPrompt(parked);
    expect(prompt.candidates).toHaveLength(1);
    expect([prompt.min, prompt.max]).toEqual([0, 1]);
  });
});

describe("D489 §5 — the board arithmetic, computed BEFORE it is asserted", () => {
  const PER = 60;
  const PICKED = 2;
  const PILE_ENERGY_BEFORE = 2;
  const HAND_SIZE_BEFORE = 7;
  const CAP = 3;
  const READINGS: readonly (readonly [string, number])[] = [
    ["CORRECT — 60 × the slot", PER * PICKED],
    ["the rider is dropped (unscaled hit)", PER],
    ["the count is the printed CAP", PER * CAP],
    ["the count is the whole discard PILE afterwards", PER * (PILE_ENERGY_BEFORE + PICKED)],
    ["the count is the HAND SIZE before the discard", PER * HAND_SIZE_BEFORE],
    ["the rider names the WRONG slot (empty)", 0],
    ["the record is lost across the park", 0],
  ];

  it("the six candidate readings answer SIX different numbers on this board", () => {
    expect(READINGS.map(([, n]) => n)).toEqual([120, 60, 180, 240, 420, 0, 0]);
    const distinct = new Set(READINGS.map(([, n]) => n));
    // SIX distinct values over SEVEN readings: the two zeroes collide by construction
    // and are separated by a different axis — one has no PARK at all, the other parks
    // and then deals nothing. §6 asserts that axis rather than the number.
    expect(distinct.size).toBe(6);
  });

  it("the fixture's composition is a MEASUREMENT, not a preference", () => {
    expect(HAND.filter((id) => ENERGY_IDS.has(id)).length).toBeGreaterThan(CAP);
    expect(HAND.filter((id) => !ENERGY_IDS.has(id)).length).toBeGreaterThan(0);
    expect(HAND.filter((id) => id === "d489-water")).toHaveLength(3);
    expect(PILE.filter((id) => ENERGY_IDS.has(id)).length).toBe(PILE_ENERGY_BEFORE);
    expect(HAND).toHaveLength(HAND_SIZE_BEFORE);
  });
});

describe("D489 §6 — the boards: two parks, one sentence", () => {
  it("discard TWO, hit the BENCH for 120 — flat, and the pile keeps its own cards", () => {
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    const prompt = handPrompt(parked);
    const picked = [
      uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string,
      uidsOf(parked, prompt.candidates, "d489-water", 1)[0] as string,
    ];
    const { state: paid, events: e1 } = answerCards(parked, picked);
    expect(find(e1, "HAND_COST_PAID")).toMatchObject({ seat: "p1", to: "discard" });
    // The cards left the hand for the pile, and the PRE-SEEDED pile is still under them.
    expect(idsIn(paid, "p1", "discard")).toEqual([
      "d489-en-d",
      "d489-en-d",
      "d489-item-3",
      "d489-item-3",
      "d489-fire",
      "d489-water",
    ]);
    expect(idsIn(paid, "p1", "hand").sort()).toEqual(
      ["d489-water", "d489-water", "d489-grass", "d489-item-1", "d489-item-2"].sort(),
    );
    // …then the SECOND park, on the opponent's whole board (Active + Bench).
    const snipe = snipePrompt(paid);
    expect(snipe.candidates).toHaveLength(2);
    expect(snipe.candidates.map((r) => r.seat)).toEqual(["p2", "p2"]);
    expect(snipe.note).toContain("120");
    expect(snipe.note).not.toContain("60 damage");
    const bench = snipe.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const { state: done, events: e2 } = answerBody(paid, bench);
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      weakness: null,
      dealt: 120,
    });
    expect(types_(e2)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p2.bench[0]?.damage).toBe(120);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the same two cards aimed at the ACTIVE take WEAKNESS — 240, which is what `deals` buys", () => {
    // The pair that separates *"this is attack damage"* from *"these are placed
    // counters"*: a `deals`-less build puts 120 flat counters on a body whose Weakness
    // doubles a real hit. Same board, same pick, different target.
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, [
      uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string,
      uidsOf(parked, prompt.candidates, "d489-water", 1)[0] as string,
    ]);
    const active = snipePrompt(paid).candidates.find((r) => r.spot.spot === "active");
    if (active === undefined) throw new Error("no Active candidate");
    const { state: done, events } = answerBody(paid, active);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 120, dealt: 240 });
    expect(done.players.p2.active?.damage).toBe(240);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
  });

  it("discard THREE — the cap is spent, and 180 is not the pile's number", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, uidsOf(parked, prompt.candidates, "d489-water", 3));
    const bench = snipePrompt(paid).candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const { state: done, events } = answerBody(paid, bench);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, dealt: 180 });
    expect(done.players.p2.bench[0]?.damage).toBe(180);
    expect(idsIn(done, "p1", "discard").filter((id) => ENERGY_IDS.has(id))).toHaveLength(5);
  });

  it("DECLINE the discard and the attack asks for no target at all", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const { state: done, events } = answerCards(parked, []);
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    expect(types_(events)).not.toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("DAMAGE_DEALT");
    expect(types_(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(idsIn(done, "p1", "hand")).toHaveLength(7);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the LOUD control still fires, so a silent board means something", () => {
    const { events } = swing(table(), LOUD_SWING);
    expect(types_(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("a PLAIN attack on the same board is unaffected — the control for every zero above", () => {
    const { state: done, events } = swing(table(), PLAIN_CUFF);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, dealt: 20 });
    expect(done.players.p2.active?.damage).toBe(20);
    expect(idsIn(done, "p1", "hand")).toHaveLength(7);
  });
});

describe("D489 §7 — `MATCH_RECORD_VERSION` stays 29, driven over v29 bytes", () => {
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  it("the program really does park TWICE, and the record rides between the two", () => {
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // Park ONE: the payment is pending and the snipe is the whole of `rest`.
    expect(parked.phase.cont.pendingOp.op).toBe("payFromHand");
    expect(parked.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    // Nothing recorded yet — the slot is filed when the pick resolves.
    expect(parked.phase.cont.record).toBeUndefined();
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, uidsOf(parked, prompt.candidates, "d489-water", 2));
    if (paid.phase.kind !== "effect:choose") throw new Error("expected a SECOND effect:choose");
    // Park TWO: the snipe is pending, `rest` is empty, and **the record is carried** —
    // which is what makes the caption and the hit the same number on both sides.
    expect(paid.phase.cont.pendingOp.op).toBe("damageChosen");
    expect(paid.phase.cont.rest).toEqual([]);
    expect(paid.phase.cont.record?.discarded).toHaveLength(2);
  });

  it("a v29 PAYMENT (exact `count`, no `cap`) still means an exact payment", () => {
    // The LOSS direction: reconstruct the bytes a v29 writer could have written and
    // replay them through the real interpreter. An exact `count: 2` must still be
    // mandatory — `min === max` — because that is what those bytes meant.
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, V29_PAYMENT, ctx, events);
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([run.prompt.min, run.prompt.max]).toEqual([2, 2]);
    expect(run.prompt.note).toBe("Discard 2 Energy cards from your hand.");
  });

  it("a v29 SNIPE (no `perRecorded`) still deals its printed amount, unscaled", () => {
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, V29_SNIPE, ctx, events, { discarded: ["x", "y"] });
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(run.prompt.note).toContain("60");
    const bench = run.prompt.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const resumed = resumeProgram(
      run.state,
      run.cont,
      { kind: "pokemonMulti", refs: [bench] },
      events,
    );
    if (resumed.kind !== "done") throw new Error("expected done");
    expect(resumed.state.players.p2.bench[0]?.damage).toBe(60);
  });

  it("and the NEW bytes on the SAME board answer differently — the control for both", () => {
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, [PROGRAM[1] as EffectOp], ctx, events, { discarded: ["x", "y"] });
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(run.prompt.note).toContain("120");
    const bench = run.prompt.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const resumed = resumeProgram(
      run.state,
      run.cont,
      { kind: "pokemonMulti", refs: [bench] },
      events,
    );
    if (resumed.kind !== "done") throw new Error("expected done");
    expect(resumed.state.players.p2.bench[0]?.damage).toBe(120);
  });

  it("an EMPTY record makes the new rider deal nothing and ask nothing", () => {
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, [PROGRAM[1] as EffectOp], ctx, events, {});
    expect(run.kind).toBe("done");
    if (run.kind !== "done") throw new Error("expected done");
    expect(run.state.players.p2.bench[0]?.damage).toBe(0);
    expect(run.state.players.p2.active?.damage).toBe(0);
  });
});

describe("D489 §8 — the DESCRIBER obligation, discharged rather than asserted", () => {
  it("`withConsequence` is UNREACHABLE for this program, and the reason is the CALL PATH", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    expect(parked.phase.cont.rest.some((op) => op.op === "recordGate")).toBe(false);
    // …and the observable consequence: the note carries NO "If you do" clause.
    expect(handPrompt(parked).note).toBe("Discard up to 3 Energy cards from your hand.");
    expect(handPrompt(parked).note).not.toContain("If you do");
  });
});

describe("D489 §9 — the census this row moves, and the summands it does not", () => {
  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
  });

  it("engineVersion is 0.555.0 and the bump is owed for BEHAVIOUR", () => {
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});
