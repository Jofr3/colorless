import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  mustApply,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

const GATED = "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed.";

const BARE = "Your opponent's Active Pokémon is now Paralyzed.";

const TERA = "If your opponent's Active Pokémon is a Tera Pokémon, it is now Paralyzed.";

const BASIC_KO = "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.";

const GATED_FILE_LINE = 384;

const READERS: readonly (readonly [string, (text: string) => unknown])[] = [
  ["deriveAttackBonusConsequent", deriveAttackBonusConsequent],
  ["deriveAttackCancelRequirement", deriveAttackCancelRequirement],
  ["deriveAttackCoinFlip", deriveAttackCoinFlip],
  ["deriveAttackDamageBonus", deriveAttackDamageBonus],
  ["deriveAttackDamageMultiplier", deriveAttackDamageMultiplier],
  ["deriveAttackDamagePenalty", deriveAttackDamagePenalty],
  ["deriveAttackDamageSuppression", deriveAttackDamageSuppression],
  ["deriveAttackDiscardScaledBoost", deriveAttackDiscardScaledBoost],
  ["deriveAttackEffect", deriveAttackEffect],
  ["deriveAttackOptionalBoost", deriveAttackOptionalBoost],
  ["deriveAttackOptionalCostBoost", deriveAttackOptionalCostBoost],
  ["deriveAttackPreDamage", deriveAttackPreDamage],
  ["deriveAttackCopy", deriveAttackCopy],
  ["deriveAttackRequirement", deriveAttackRequirement],
];

/** The program the printed sentence must derive to, spelled once. */
const GATED_PROGRAM = [
  {
    op: "conditionGate",
    cond: { kind: "opponentActiveHasType", type: "Dragon" },
    then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
  },
];

const SWINGS = [
  { cost: ["Colorless"], name: "Drake Lock", damage: 10, effect: GATED },
  { cost: ["Colorless"], name: "Plain Lock", damage: 10, effect: BARE },
  { cost: ["Colorless"], name: "Bare Swipe", damage: 10 },
  { cost: ["Colorless"], name: "Banner Lock", damage: 10, effect: TERA },
];

/** The attacker that IS a `{N}` Pokémon. The printed clause reads the OPPONENT's
    Active, so this body contributes nothing to a correct answer and everything to a
    seat inversion — which is exactly its job on board B. */
const DRAGON_SWINGER: Card = battler("fix-d472-drakeswing", {
  name: "Fixidraco",
  hp: 200,
  types: ["Dragon"],
  attacks: [...SWINGS],
});

/** The same four attacks on a body that is NOT a `{N}` Pokémon. Two attackers rather
    than one, because the seat axis needs the attacker's own type to vary while every
    other fact on the board holds still. */
const WATER_SWINGER: Card = battler("fix-d472-tideswing", {
  name: "Fixitide",
  hp: 200,
  types: ["Water"],
  attacks: [...SWINGS],
});

/** The DEFENDING body the printed clause is TRUE of. */
const DRAGON_FOE: Card = battler("fix-d472-drakefoe", {
  name: "Fixigon",
  hp: 340,
  types: ["Dragon"],
});

/** The DEFENDING body the printed clause is FALSE of. */
const WATER_FOE: Card = battler("fix-d472-tidefoe", {
  name: "Fixiluga",
  hp: 340,
  types: ["Water"],
});

const DUAL_FOE: Card = battler("fix-d472-dualfoe", {
  name: "Fixidrake",
  hp: 340,
  types: ["Water", "Dragon"],
});

const DRAGON_SITTER: Card = battler("fix-d472-drakesit", {
  name: "Fixibagon",
  hp: 120,
  types: ["Dragon"],
});

/** A benched body of the wrong type — the control that makes a benched Dragon a
    variable rather than a constant. */
const WATER_SITTER: Card = battler("fix-d472-tidesit", {
  name: "Fixidra",
  hp: 120,
  types: ["Water"],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-d472-drakeswing": DRAGON_SWINGER,
  "fix-d472-tideswing": WATER_SWINGER,
  "fix-d472-drakefoe": DRAGON_FOE,
  "fix-d472-tidefoe": WATER_FOE,
  "fix-d472-dualfoe": DUAL_FOE,
  "fix-d472-drakesit": DRAGON_SITTER,
  "fix-d472-tidesit": WATER_SITTER,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-d472-drakeswing": 4,
  "fix-d472-tideswing": 4,
  "fix-d472-drakefoe": 4,
  "fix-d472-tidefoe": 4,
  "fix-d472-dualfoe": 4,
  "fix-d472-drakesit": 4,
  "fix-d472-tidesit": 4,
  "fix-basic-1": 4,
  "fix-energy": 28,
});

/** Attack indices, named rather than remembered (§1 pins each against the fixture's
    own `attacks` array). */
const DRAKE_LOCK = 0;
const PLAIN_LOCK = 1;
const BARE_SWIPE = 2;
const BANNER_LOCK = 3;

const SEED = 11;

function pick<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function every<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function localSetup(first: Seat): GameState {
  return driveSetup(SEED, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

interface Table {
  /** the ATTACKER's Active */
  swinger: string;
  /** the ATTACKER's one benched body, or none */
  ourBench?: string;
  /** the DEFENDER's Active */
  foe: string;
  /** the DEFENDER's one benched body, or none */
  theirBench?: string;
  by?: Seat;
}

function table({ swinger, ourBench, foe, theirBench, by = "p1" }: Table): GameState {
  const other: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: other }),
  );
  state = setActiveFromDeck(state, by, swinger);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, other, foe);
  state = clearBench(state, other);
  if (ourBench !== undefined) state = benchFromDeck(state, by, ourBench);
  if (theirBench !== undefined) state = benchFromDeck(state, other, theirBench);
  return attachFromDeck(state, by, "fix-energy", 1);
}

function swing(state: GameState, index: number, by: Seat = "p1") {
  return mustApply(state, { type: "attack", seat: by, index });
}

function conditionsOf(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active.conditions;
}

const BOARDS: readonly (readonly [string, Table])[] = [
  [
    "A — their Active is the Dragon",
    {
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-tidesit",
      foe: "fix-d472-drakefoe",
      theirBench: "fix-d472-tidesit",
    },
  ],
  [
    "B — OUR Active is the Dragon",
    {
      swinger: "fix-d472-drakeswing",
      ourBench: "fix-d472-tidesit",
      foe: "fix-d472-tidefoe",
      theirBench: "fix-d472-tidesit",
    },
  ],
  [
    "C — OUR Bench holds the Dragon",
    {
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-drakesit",
      foe: "fix-d472-tidefoe",
      theirBench: "fix-d472-tidesit",
    },
  ],
  [
    "D — THEIR Bench holds the Dragon",
    {
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-tidesit",
      foe: "fix-d472-tidefoe",
      theirBench: "fix-d472-drakesit",
    },
  ],
  [
    "E — their Active is dual, Dragon SECOND",
    {
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-tidesit",
      foe: "fix-d472-dualfoe",
      theirBench: "fix-d472-tidesit",
    },
  ],
];

/** The five-bit signature of "seat's Active ends Paralyzed", A..E as MSB..LSB. */
function signature(seat: "defender" | "attacker", index: number, by: Seat = "p1"): number {
  const other: Seat = by === "p1" ? "p2" : "p1";
  let bits = 0;
  for (const [, spec] of BOARDS) {
    const { state } = swing(table({ ...spec, by }), index, by);
    const read = conditionsOf(state, seat === "defender" ? other : by);
    bits = bits * 2 + (read.rotation === "paralyzed" ? 1 : 0);
  }
  return bits;
}

describe("§1 — the sentence, its corpus row, and the fixtures that print it", () => {
  it("is corpus FILE LINE 384, ONE sentence and TWO Standard-legal printings", () => {
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === GATED);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(2);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(GATED_FILE_LINE);
  });

  it("the BYTES are the printed ones — U+0027 and U+00E9, measured not eyeballed", () => {
    expect(GATED.codePointAt(GATED.indexOf("'"))).toBe(0x27);
    expect(GATED.includes("’")).toBe(false);
    expect(GATED.codePointAt(GATED.indexOf("Pok") + 3)).toBe(0xe9);
  });

  it("the corpus totals STAND STILL — this slice adds no catalog row", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(1732);
  });

  it("the local fixtures carry the four sentences at the indices this file names", () => {
    for (const card of [DRAGON_SWINGER, WATER_SWINGER]) {
      expect(card.attacks?.[DRAKE_LOCK]?.effect).toBe(GATED);
      expect(card.attacks?.[PLAIN_LOCK]?.effect).toBe(BARE);
      expect(card.attacks?.[BARE_SWIPE]?.effect).toBeUndefined();
      expect(card.attacks?.[BANNER_LOCK]?.effect).toBe(TERA);
    }
    // The types are the whole subject of this file, so they are pinned rather than
    // trusted to `battler`'s default (which is `["Colorless"]` for an invented id).
    expect(DRAGON_SWINGER.types).toEqual(["Dragon"]);
    expect(WATER_SWINGER.types).toEqual(["Water"]);
    expect(DRAGON_FOE.types).toEqual(["Dragon"]);
    expect(WATER_FOE.types).toEqual(["Water"]);
    expect(DUAL_FOE.types).toEqual(["Water", "Dragon"]);
    expect(DRAGON_SITTER.types).toEqual(["Dragon"]);
    expect(WATER_SITTER.types).toEqual(["Water"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER: WHO OWNS IT, WHO STILL REFUSES IT, AND WHAT THE VOCABULARY IS
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the reader, named rather than counted", () => {
  it("`deriveAttackEffect` owns it, BY VALUE and not by non-nullity", () => {
    expect(deriveAttackEffect(GATED)).toEqual(GATED_PROGRAM);
  });

  it("…and the other TWELVE readers still refuse it", () => {
    for (const [name, read] of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(GATED), name).toBeNull();
    }
    expect(resolvedByAnyReader(GATED)).toBe(true);
    // …and no splitter is involved: this is the RAW summand alone.
    expect(splitAttackGateClause(GATED)).toBeNull();
    expect(splitAttackTrailingClause(GATED)).toBeNull();
  });

  it("`{N}` was a LIVE map entry with NO printing, and this row is its first", () => {
    const braceN = legalAttackCorpus().filter(([, s]) => s.includes("{N}"));
    expect(braceN).toHaveLength(2);
    expect(braceN.some(([, s]) => s === GATED)).toBe(true);
    const clauses = legalAttackCorpus().filter(([, s]) =>
      /Active Pokémon is a \{N\} Pokémon/.test(s),
    );
    expect(clauses.map(([, s]) => s)).toEqual([GATED]);
    expect(deriveAttackEffect(GATED.replace("{N}", "Dragon"))).toEqual(GATED_PROGRAM);
  });

  it("the open slots admit what the family's vocabulary admits, and nothing else", () => {
    expect(
      deriveAttackEffect("If your opponent's Active Pokémon is a {P} Pokémon, it is now Burned."),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasType", type: "Psychic" },
        then: [{ op: "applyStatus", target: "defender", status: "burned" }],
      },
    ]);
    // …and the clause slot reaches the LITERAL table too, not only the type
    // patterns, because it is `boardConditionForClause` and not a private lookup.
    expect(
      deriveAttackEffect(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, it is now Asleep.",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsStage1" },
        then: [{ op: "applyStatus", target: "defender", status: "asleep" }],
      },
    ]);
  });

  it("the UNGATED sibling's SHAPE is printed 74 times and its `Paralyzed` slot ZERO", () => {
    const bareShape = legalAttackCorpus().filter(([, s]) =>
      /^Your opponent's Active Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/.test(
        s,
      ),
    );
    expect(bareShape.map(([units, s]) => [units, s.replace(/^.*is now /, "")])).toEqual([
      [15, "Asleep."],
      [14, "Burned."],
      [31, "Confused."],
      [14, "Poisoned."],
    ]);
    expect(bareShape.reduce((sum, [units]) => sum + units, 0)).toBe(74);
    expect(bareShape.some(([, s]) => s === BARE)).toBe(false);
    // …and the reader takes it anyway, which is what makes it usable as a control.
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "applyStatus", target: "defender", status: "paralyzed" },
    ]);
  });

  it("the U+2019 re-ingest derives the SAME program, not merely a non-null one", () => {
    expect(deriveAttackEffect(GATED.replace("'", "’"))).toEqual(GATED_PROGRAM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE BANNER STAYS LOUD, ON A BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `Tera` was refused AT THE MAP; D568 reads it as a BANNER row, and the gate is false on a non-Tera board", () => {
  it("D568: the derived value is the BANNER gate, and the type slot still refuses the token", () => {
    // The capture is `.+` on purpose: the MAP is the vocabulary, not the regex. A
    // `(Grass|Fire|…)` alternation would refuse this at the anchor — the same answer
    // today, and a hand-kept list that rots the day a type is added to the schema.
    const [gate] = deriveAttackEffect(TERA) ?? [];
    expect(gate?.op === "conditionGate" ? gate.cond : undefined).toEqual({
      kind: "opponentActiveIsBanner",
      banner: "Tera",
    });
    expect(TERA.replace("Tera", "{N}")).toBe(GATED);
  });

  it("…and on a board with a NON-Tera defender the gate is false: nothing skipped, nothing applied (D568)", () => {
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      BANNER_LOCK,
    );
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("…and the SAME board under the built clause paralyses, which is the control", () => {
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      DRAKE_LOCK,
    );
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(conditionsOf(state, "p2").rotation).toBe("paralyzed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ANCHOR'S EDGES, EVERY ONE OF THEM ONE AXIS WIDE
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the anchor's edges, driven synthetically because no near miss prints", () => {
  it("NO single-axis loosening of this anchor claims anything else in the column", () => {
    const S = "Asleep|Burned|Confused|Paralyzed|Poisoned";
    const LOOSENINGS: readonly (readonly [string, RegExp])[] = [
      [
        "^ dropped",
        new RegExp(`If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (${S})\\.$`),
      ],
      [
        "\\.$ dropped",
        new RegExp(`^If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (${S})\\.`),
      ],
      [
        "status slot widened",
        /^If your opponent['’]s Active Pokémon is a (.+) Pokémon, it is now (.+)\.$/,
      ],
      ["subject widened", new RegExp(`^If (.+), it is now (${S})\\.$`)],
      [
        "noun tail dropped",
        new RegExp(`^If your opponent['’]s Active Pokémon is a (.+), it is now (${S})\\.$`),
      ],
      [
        "apostrophe class narrowed",
        new RegExp(`^If your opponent's Active Pokémon is a (.+) Pokémon, it is now (${S})\\.$`),
      ],
      ["BOTH ends widened", /^If (.+), it is now (.+)\.$/],
    ];
    for (const [label, pattern] of LOOSENINGS) {
      const hit = legalAttackCorpus().filter(([, s]) => pattern.test(s));
      expect(
        hit.map(([, s]) => s),
        label,
      ).toEqual([GATED]);
      expect(
        hit.reduce((sum, [units]) => sum + units, 0),
        label,
      ).toBe(2);
    }
  });

  it("the SUBJECT is load-bearing for the ANAPHOR, not for the catalog", () => {
    const WIDE_SUBJECT = "If you have any {M} Pokémon on your Bench, it is now Paralyzed.";
    expect(deriveAttackEffect(WIDE_SUBJECT)).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type: "Metal" } },
    });
  });

  it("arm 6a's sentence and this one are STRUCTURALLY disjoint — an inequality, not a null", () => {
    expect(deriveAttackEffect(BASIC_KO)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    expect(deriveAttackEffect(BASIC_KO)).not.toEqual(deriveAttackEffect(GATED));
    // The byte that does it: `it is ` followed by `now ` here and by `Knocked` there.
    expect(GATED.includes(", it is now ")).toBe(true);
    expect(BASIC_KO.includes(", it is now ")).toBe(false);
    expect(
      deriveAttackEffect(
        "If your opponent's Active Pokémon is a Basic Pokémon, it is now Paralyzed.",
      ),
    ).toBeNull();
  });

  it("the `^` end fails LOUD and the `$` end fails through the SPLITTER (D464)", () => {
    // Leading text: nothing claims the head, so the whole string stays unread.
    expect(deriveAttackEffect(`This attack does 30 damage. ${GATED}`)).toBeNull();
    const compound = `${GATED} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(splitAttackTrailingClause(compound)).toEqual({ head: GATED, tail: "Draw a card." });
    // …and NO such compound prints, so nothing is authored by that path.
    const carriers = legalAttackCorpus().filter(([, s]) => s.includes(GATED) && s !== GATED);
    expect(carriers).toEqual([]);
  });

  it("the case, the pronoun and the STATUS SLOT are load-bearing, one axis each", () => {
    expect(deriveAttackEffect(GATED.replace("If", "if"))).toBeNull();
    expect(deriveAttackEffect(GATED.replace(", it is now ", ", it is "))).toBeNull();
    expect(deriveAttackEffect(GATED.replace("Paralyzed", "Knocked Out"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE GATE ON A REAL BOARD: IT FIRES, AND THE THREE ROUTES TO SILENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the condition on a real board, and three routes to silence", () => {
  it("it FIRES — asserted on the FIELDS, with the event row beside it", () => {
    const { state, events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      DRAKE_LOCK,
    );
    expect(conditionsOf(state, "p2")).toEqual({
      rotation: "paralyzed",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(every(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["paralyzed"]);
    // …and the ATTACKER is untouched, which is the `target: "self"` control.
    expect(conditionsOf(state, "p1").rotation).toBe("none");
  });

  it("BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    const { state } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe", by: "p2" }),
      DRAKE_LOCK,
      "p2",
    );
    expect(conditionsOf(state, "p1").rotation).toBe("paralyzed");
    expect(conditionsOf(state, "p2").rotation).toBe("none");
  });

  it("ZERO-MATCH ROUTE 1 — their Active is the wrong type while OUR Active is right", () => {
    const board = table({ swinger: "fix-d472-drakeswing", foe: "fix-d472-tidefoe" });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("ZERO-MATCH ROUTE 2 — the Dragon is on THEIR Bench, not in their Active Spot", () => {
    // The printed clause names the ACTIVE SPOT. `opponentInPlayHasType` is a real
    // sibling member one lookup away in the same function, and this is the board
    // that tells the two apart.
    const board = table({
      swinger: "fix-d472-tideswing",
      foe: "fix-d472-tidefoe",
      theirBench: "fix-d472-drakesit",
    });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("ZERO-MATCH ROUTE 3 — the Dragon is on OUR Bench, which is a different member", () => {
    // `yourBenchHasType` is the third live member reading the same map, and it reads
    // the other seat's Bench. Same number, third fact.
    const board = table({
      swinger: "fix-d472-tideswing",
      ourBench: "fix-d472-drakesit",
      foe: "fix-d472-tidefoe",
    });
    const { state, events } = swing(board, DRAKE_LOCK);
    expect(conditionsOf(state, "p2").rotation).toBe("none");
    expect(pick(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(pick(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(conditionsOf(swing(board, PLAIN_LOCK).state, "p2").rotation).toBe("paralyzed");
  });

  it("the DUAL-TYPED defender is Paralyzed though `Dragon` is its SECOND type", () => {
    // `types` is an array. `types[0] === "Dragon"` agrees with `includes` on every
    // other board in this file and disagrees here.
    const { state } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-dualfoe" }),
      DRAKE_LOCK,
    );
    expect(conditionsOf(state, "p2").rotation).toBe("paralyzed");
  });

  it("the gate emits NO event of its own — the condition is public", () => {
    const { events } = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-tidefoe" }),
      DRAKE_LOCK,
    );
    expect(events.map((e) => e.type)).not.toContain("EFFECT_PENDING");
    expect(every(events, "STATUS_APPLIED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SIGNATURE: EIGHT READINGS, EIGHT DIFFERENT NUMBERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — one board family, eight readings, eight different numbers", () => {
  it("the DEFENDER signature is 17 and the ATTACKER signature is 0", () => {
    // See `BOARDS`'s block for the full table. The value 17 is 1,0,0,0,1 over boards
    // A..E, and no other reading in that table produces it; the second figure is what
    // separates `target: "self"` (0, 17) from the wrong type constant (0, 0).
    expect([signature("defender", DRAKE_LOCK), signature("attacker", DRAKE_LOCK)]).toEqual([17, 0]);
  });

  it("the UNGATED sibling answers 31 on the same family, which prices the gate", () => {
    expect(signature("defender", PLAIN_LOCK)).toBe(31);
  });

  it("the DATA-BLOCKED banner answers 0, and the clauseless attack answers 0", () => {
    // Two more real programs on the same family: a sentence the reader refuses (loud,
    // 0) and an attack with no sentence at all (0). Together with 17 and 31 they say
    // the signature is measuring the CLAUSE and not the harness.
    expect(signature("defender", BANNER_LOCK)).toBe(0);
    expect(signature("defender", BARE_SWIPE)).toBe(0);
  });

  it("the same family read from p2 gives the same two numbers", () => {
    expect([
      signature("defender", DRAKE_LOCK, "p2"),
      signature("attacker", DRAKE_LOCK, "p2"),
    ]).toEqual([17, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 29, ARGUED AND THEN DRIVEN
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the persisted bytes, and why 29 does not move", () => {
  it("SERIALIZED ALPHABET — no new op, op FIELD or op VALUE (D462)", () => {
    const program = deriveAttackEffect(GATED);
    expect(JSON.stringify(program)).toBe(
      JSON.stringify([
        {
          op: "conditionGate",
          cond: { kind: "opponentActiveHasType", type: "Dragon" },
          then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
        },
      ]),
    );
  });

  it("REACHABILITY — the program is LENGTH ONE and the gate never becomes a `pendingOp`", () => {
    expect(deriveAttackEffect(GATED)).toHaveLength(1);
    for (const foe of ["fix-d472-drakefoe", "fix-d472-tidefoe"]) {
      const { state } = swing(table({ swinger: "fix-d472-tideswing", foe }), DRAKE_LOCK);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(JSON.stringify(state)).not.toContain("conditionGate");
      expect(JSON.stringify(state)).not.toContain("opponentActiveHasType");
    }
  });

  it("a record round-trips and the parsed bytes are a LIVE board", () => {
    const first = swing(
      table({ swinger: "fix-d472-tideswing", foe: "fix-d472-drakefoe" }),
      DRAKE_LOCK,
    );
    const saved = roundTrip(first.state);
    expect(saved).toEqual(first.state);
    expect(conditionsOf(saved, "p2").rotation).toBe("paralyzed");
  });
});

describe("§8 — no new `FIXTURE_POOL` id and no new vocabulary", () => {
  it("the local ids are LOCAL", () => {
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    expect(Object.keys(LOCAL_CARDS)).toHaveLength(7);
  });

  it("no POOLED card prints any of this file's four sentences", () => {
    const carriers: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        if ([GATED, TERA].includes(attack.effect ?? "")) carriers.push(`${id}[${index}]`);
      }
    }
    expect(carriers).toEqual([]);
  });

  it("the local fixtures carry NO possessive and NO evolution stage", () => {
    for (const card of Object.values(LOCAL_CARDS)) {
      expect(card.name.includes("'"), card.id).toBe(false);
      expect(card.name.includes("’"), card.id).toBe(false);
      expect(card.stage, card.id).toBe("Basic");
      expect(card.evolveFrom, card.id).toBeNull();
    }
  });
});
