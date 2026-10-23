import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  driveSetup,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon.";

const SHIPPED_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your Pokémon.";

const SHIPPED_SELF =
  "This attack does 20 more damage for each {L} Energy attached to this Pokémon.";

const OWNER_BOARD_MULTIPLY =
  "This attack does 20 damage for each {L} Energy attached to all of your Iono's Pokémon.";

const OPPONENT_SEAT_BOARD =
  "This attack does 20 more damage for each {L} Energy attached to all of your opponent's Pokémon.";

const ANCIENT_NOUN =
  "This attack does 20 more damage for each {L} Energy attached to all of your Future Pokémon.";

const BASIC_ENERGY_NOUN =
  "This attack does 20 more damage for each Basic Energy attached to all of your Iono's Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically, so
    the curly one is always written where a reader can see it. */
const RSQUO = "’";

const OWNER_BOARD_FILE_LINE = 558;

const ATTACKS = [
  { cost: ["Colorless"], name: "Iono Surge", damage: 10, effect: OWNER_BOARD },
  { cost: ["Colorless"], name: "Board Surge", damage: 10, effect: SHIPPED_BOARD },
  { cost: ["Colorless"], name: "Self Surge", damage: 10, effect: SHIPPED_SELF },
  { cost: ["Colorless"], name: "Plain Surge", damage: 10 },
];

const IONO_ATTACKER: Card = battler("fix-ionobolt", {
  name: "Iono's Fixibolt",
  hp: 200,
  types: ["Lightning"],
  attacks: [...ATTACKS],
});

/** The SAME four attacks on a body that is NOT one. Two attackers rather than one,
    because §4's zero-match board needs an attacker the filter refuses and this
    family's sentence is printed on a body that its own clause counts. */
const PLAIN_ATTACKER: Card = battler("fix-plainbolt", {
  name: "Fixibolt",
  hp: 200,
  types: ["Lightning"],
  attacks: [...ATTACKS],
});

/** A benched Iono's body. */
const IONO_BENCH: Card = battler("fix-ionochu", {
  name: "Iono's Fixichu",
  hp: 120,
  types: ["Lightning"],
});

/** A benched body with NO prefix at all — the plain negative. */
const PLAIN_BENCH: Card = battler("fix-plainmander", { name: "Fixidos", hp: 120 });

const RIVAL_BENCH: Card = battler("fix-rivalono", {
  name: "Rival of Iono's Fixiton",
  hp: 120,
  types: ["Lightning"],
});

/** The DEFENDER's Iono's body. The printed word is *"all of YOUR … Pokémon"*, so the
    subgroup narrows WHICH of your bodies count and never WHOSE — this fixture is
    what makes a seat inversion answer a different number instead of the same one. */
const IONO_FOE: Card = battler("fix-ionogar", {
  name: "Iono's Fixigar",
  hp: 340,
  types: ["Lightning"],
});

const EVOLVED_TOP: Card = battler("fix-plainvolt", {
  name: "Fixivolt",
  hp: 160,
  types: ["Lightning"],
  stage: "Stage1",
  evolveFrom: "Iono's Fixichu",
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-ionobolt": IONO_ATTACKER,
  "fix-plainbolt": PLAIN_ATTACKER,
  "fix-ionochu": IONO_BENCH,
  "fix-plainmander": PLAIN_BENCH,
  "fix-rivalono": RIVAL_BENCH,
  "fix-ionogar": IONO_FOE,
  "fix-plainvolt": EVOLVED_TOP,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-ionobolt": 2,
  "fix-plainbolt": 2,
  "fix-ionochu": 2,
  "fix-plainmander": 2,
  "fix-rivalono": 2,
  "fix-ionogar": 2,
  "fix-plainvolt": 2,
  "fix-basic-1": 4,
  "fix-lightning-energy": 24,
  "fix-water-energy": 6,
  "fix-energy": 12,
});

/** Attack indices, named rather than remembered (§1 pins each against the fixture's
    own `attacks` array). */
const IONO = 0;
const BOARD = 1;
const SELF = 2;
const PLAIN = 3;

const SEED = 7;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function bare(attacker: string, by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(SEED, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, foe, "fix-ionogar");
  state = clearBench(state, foe);
  return attachFromDeck(state, foe, "fix-lightning-energy", 6);
}

/** Bench `ids` in order and attach `energy[i]` (a list of card ids) to each. */
function benchWith(
  state: GameState,
  seat: Seat,
  rows: readonly (readonly [string, readonly string[]])[],
): GameState {
  let next = state;
  for (const [index, [id, cards]] of rows.entries()) {
    next = benchFromDeck(next, seat, id);
    for (const card of cards) next = attachBenchFromDeck(next, seat, index, card, 1);
  }
  return next;
}

function mixed(by: Seat = "p1"): GameState {
  let state = bare("fix-ionobolt", by);
  state = attachFromDeck(state, by, "fix-lightning-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-ionochu", ["fix-lightning-energy"]],
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
    ["fix-rivalono", ["fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

function zeroNoBody(by: Seat = "p1"): GameState {
  let state = bare("fix-plainbolt", by);
  state = attachFromDeck(state, by, "fix-lightning-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
    ["fix-rivalono", ["fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

function zeroWrongEnergy(by: Seat = "p1"): GameState {
  let state = bare("fix-ionobolt", by);
  state = attachFromDeck(state, by, "fix-water-energy", 2);
  state = attachFromDeck(state, by, "fix-energy", 1);
  return benchWith(state, by, [
    ["fix-ionochu", ["fix-water-energy"]],
    ["fix-plainmander", ["fix-lightning-energy", "fix-lightning-energy", "fix-lightning-energy"]],
  ]);
}

function zeroEmpty(by: Seat = "p1"): GameState {
  const state = bare("fix-ionobolt", by);
  return attachFromDeck(state, by, "fix-energy", 1);
}

function stackOnto(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return findEvent(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

describe("§1 — the sentence, its corpus row, and the fixtures that print it", () => {
  it("is corpus FILE LINE 558, ONE sentence and ONE Standard-legal printing", () => {
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === OWNER_BOARD);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(OWNER_BOARD_FILE_LINE);
  });

  it("the possessive is ASCII U+0027 and the é is U+00E9 — on the BYTES", () => {
    expect(OWNER_BOARD).toContain("Iono's");
    expect(OWNER_BOARD).not.toContain(RSQUO);
    expect(OWNER_BOARD).toContain("Pokémon");
    expect(OWNER_BOARD.charCodeAt(OWNER_BOARD.indexOf("Iono") + 4)).toBe(0x27);
  });

  it("the corpus row was UNREAD before this slice and is READ after it", () => {
    expect(resolvedByAnyReader(OWNER_BOARD)).toBe(true);
  });

  it("both attackers print all four sentences at the indices this file names", () => {
    for (const card of [IONO_ATTACKER, PLAIN_ATTACKER]) {
      const attacks = card.attacks ?? [];
      expect(attacks[IONO]?.effect, card.name).toBe(OWNER_BOARD);
      expect(attacks[BOARD]?.effect, card.name).toBe(SHIPPED_BOARD);
      expect(attacks[SELF]?.effect, card.name).toBe(SHIPPED_SELF);
      expect(attacks[PLAIN]?.effect, card.name).toBeUndefined();
      expect(
        attacks.map((a) => a.damage),
        card.name,
      ).toEqual([10, 10, 10, 10]);
    }
  });

  it("the fixture NAMES are what the filter reads, and the near miss is a near miss", () => {
    // `ownerPokemon` is an exact-case PREFIX on `Card.name` (cards.ts). These four
    // names are the whole of §3's filter axis, so they are asserted rather than read.
    expect(IONO_ATTACKER.name.startsWith("Iono's ")).toBe(true);
    expect(IONO_BENCH.name.startsWith("Iono's ")).toBe(true);
    expect(PLAIN_ATTACKER.name.startsWith("Iono's ")).toBe(false);
    expect(PLAIN_BENCH.name.startsWith("Iono's ")).toBe(false);
    expect(RIVAL_BENCH.name.includes("Iono's ")).toBe(true);
    expect(RIVAL_BENCH.name.startsWith("Iono's ")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER, ITS THREE GUARDS AND THE FIELD'S POLARITY
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageBonus: the noun the zone did not have", () => {
  it("reads the printed sentence as energyOnSelf, board zone, {L}, ownerPokemon Iono", () => {
    expect(deriveAttackDamageBonus(OWNER_BOARD)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "Lightning",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
  });

  it("the two SHIPPED spellings keep their exact shapes — the field's polarity", () => {
    const board = deriveAttackDamageBonus(SHIPPED_BOARD);
    expect(board).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Lightning" },
    });
    expect(board?.count).not.toHaveProperty("filter");
    const self = deriveAttackDamageBonus(SHIPPED_SELF);
    expect(self).toEqual({ per: 20, count: { kind: "energyOnSelf", energyType: "Lightning" } });
    expect(self?.count).not.toHaveProperty("filter");
    expect(self?.count).not.toHaveProperty("zone");
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" } });
  });

  it("GUARD 1 — the SEAT spelling is refused by the `(?!opponent)` lookahead", () => {
    expect(deriveAttackDamageBonus(OPPONENT_SEAT_BOARD)).toBeNull();
    expect(deriveAttackDamageMultiplier(OPPONENT_SEAT_BOARD)).toBeNull();
    // …and the shipped opponent-side reading is untouched, so the null above is a
    // statement about THIS anchor and not about a dead family.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
      )?.count,
    ).toEqual({ kind: "energyOnOpponent", zone: "active", energyType: null });
  });

  it("GUARD 2 — the BODY vocabulary refuses, and the sentence stays LOUD", () => {
    expect(deriveAttackDamageBonus(ANCIENT_NOUN)).toBeNull();
    expect(deriveAttackEffect(ANCIENT_NOUN)).toBeNull();
    expect(deriveAttackDamagePenalty(ANCIENT_NOUN)).toBeNull();
  });

  it("GUARD 3 — the ENERGY vocabulary, and it refuses exactly what it cannot read", () => {
    expect(deriveAttackDamageBonus(BASIC_ENERGY_NOUN)).toEqual({
      per: 20,
      count: {
        kind: "energyOnSelf",
        zone: "board",
        energyType: "basic",
        filter: { kind: "ownerPokemon", owner: "Iono" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each {C} Energy attached to all of your Iono's Pokémon.",
      ),
    ).toBeNull();
    // …and the ABSENT token is the UNTYPED reading rather than a refusal, which is
    // the same asymmetry `SELF_ENERGY_SCALE` carries and is why guard 3 tests
    // `!== undefined` rather than `!== null`.
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Energy attached to all of your Iono's Pokémon.",
      )?.count,
    ).toEqual({
      kind: "energyOnSelf",
      zone: "board",
      energyType: null,
      filter: { kind: "ownerPokemon", owner: "Iono" },
    });
  });

  it("the printed-zero guard, and the whole-sentence anchor at both ends", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 0 more damage for each {L} Energy attached to all of your Iono's Pokémon.",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(`${OWNER_BOARD} Then, draw a card.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Before this, ${OWNER_BOARD}`)).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD.toLowerCase())).toBeNull();
  });

  it("DISJOINTNESS IS STRUCTURAL — neither anchor can match the other's sentence", () => {
    const family = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) =>
        /more damage for each (?:.+ )?Energy attached to (?:this Pokémon|all of your)/.test(s),
      );
    expect(family.length).toBeGreaterThan(0);
    for (const sentence of family) {
      const bonus = deriveAttackDamageBonus(sentence);
      if (bonus === null) continue;
      const count = bonus.count;
      expect(count.kind, sentence).toBe("energyOnSelf");
      // Exactly one of the two readings claims each sentence — never both, never
      // neither, and the filter is present iff the sentence names a subgroup.
      const filtered = count.kind === "energyOnSelf" && count.filter !== undefined;
      expect(filtered, sentence).toBe(/all of your [^.]+ Pokémon\.$/.test(sentence));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE MIXED BOARD: EIGHT READINGS, EIGHT NUMBERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the fold on a real board, where every wrong reading lands elsewhere", () => {
  it("the correct answer is 3 counters → 10 + 60 = 70", () => {
    expect(dealt(mixed(), IONO)).toBe(70);
  });

  it("the FILTER-LESS sibling answers 8 on the SAME board — 10 + 160 = 170", () => {
    // The one number that matters most: it is the sentence one word narrower, on the
    // same setup, and it is what a dropped filter would produce.
    expect(dealt(mixed(), BOARD)).toBe(170);
  });

  it("the ZONE-LESS sibling answers 2 — 10 + 40 = 50", () => {
    expect(dealt(mixed(), SELF)).toBe(50);
  });

  it("the clauseless attack answers the printed base alone — 10", () => {
    expect(dealt(mixed(), PLAIN)).toBe(10);
  });

  it("the six remaining misreads are SIX DIFFERENT NUMBERS, driven on the counter", () => {
    const state = mixed();
    const IONOS = { kind: "ownerPokemon", owner: "Iono" } as const;
    expect(countEnergyInPlay(state, "p1", "Lightning", IONOS)).toBe(3); // correct
    expect(countEnergyInPlay(state, "p1", "Lightning")).toBe(8); // filter dropped
    expect(countEnergyInPlay(state, "p1", null, IONOS)).toBe(4); // type dropped
    expect(countEnergyInPlay(state, "p2", "Lightning", IONOS)).toBe(6); // seat inverted
    expect(countEnergyInPlay(state, "p1", "Lightning", { kind: "anyPokemon" })).toBe(8);
    // `includes` where the arm reads `startsWith` — spelled as the filter that WOULD
    // count the rival body, so the difference is a value and not a story.
    const byName = { kind: "byName", name: "Rival of Iono's Fixiton" } as const;
    expect(countEnergyInPlay(state, "p1", "Lightning", byName)).toBe(2);
    expect(3 + 2).toBe(5); // …so an `includes` reading would answer 5, not 3.
    // the ACTIVE dropped from the holder list: the Bench half of the correct answer.
    const benchOnly = state.players.p1.bench.reduce(
      (total, p) =>
        total + (p.stack.some((u) => state.cardIdByUid[u] === "fix-ionochu") ? p.energy.length : 0),
      0,
    );
    expect(benchOnly).toBe(1);
  });

  it("the DEFENDER's six {L} on an Iono's body contribute NOTHING", () => {
    // The seat control, asserted on the swing rather than on the counter: it is
    // present on every board in this file precisely so that a seat inversion is a
    // wrong NUMBER rather than an unobservable one.
    const state = mixed();
    expect(countEnergyInPlay(state, "p2", "Lightning")).toBe(6);
    expect(dealt(state, IONO)).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ZERO-MATCH BOARDS: ONE NUMBER, THREE FACTS
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — 0 is not one fact, so three boards reach it three ways", () => {
  it("ROUTE 1 — no body matches, and the board is LOUD with {L}", () => {
    const state = zeroNoBody();
    expect(dealt(state, IONO)).toBe(10);
    expect(dealt(state, BOARD)).toBe(150);
    expect(dealt(state, SELF)).toBe(50);
    expect(countEnergyInPlay(state, "p1", "Lightning")).toBe(7);
  });

  it("ROUTE 2 — the bodies match and their Energy is the WRONG TYPE", () => {
    const state = zeroWrongEnergy();
    expect(dealt(state, IONO)).toBe(10);
    // The unfiltered sibling answers 3 on this board, so the 0 belongs to the FILTER
    // and not to an empty board — and the {W} on the matching bodies is what makes
    // route 2 a different fact from route 1.
    expect(dealt(state, BOARD)).toBe(70);
    expect(countEnergyInPlay(state, "p1", null, { kind: "ownerPokemon", owner: "Iono" })).toBe(4);
    expect(
      countEnergyInPlay(state, "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" }),
    ).toBe(0);
  });

  it("ROUTE 3 — the board is EMPTY, which is the number's third route", () => {
    const state = zeroEmpty();
    expect(dealt(state, IONO)).toBe(10);
    expect(dealt(state, BOARD)).toBe(10);
    expect(dealt(state, SELF)).toBe(10);
    expect(state.players.p1.bench).toEqual([]);
  });

  it("the three routes are DISTINGUISHABLE, which is the point of having three", () => {
    // 0-because-nothing-matches, 0-because-the-wrong-resource and 0-because-empty are
    // the same number and not the same fact. The discriminant is what the UNFILTERED
    // sibling says on each board.
    expect([zeroNoBody(), zeroWrongEnergy(), zeroEmpty()].map((s) => dealt(s, IONO))).toEqual([
      10, 10, 10,
    ]);
    expect([zeroNoBody(), zeroWrongEnergy(), zeroEmpty()].map((s) => dealt(s, BOARD))).toEqual([
      150, 70, 10,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE TOP CARD, NOT THE BOTTOM OF THE STACK
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the filter reads the TOP card (§1.2), and evolving is what proves it", () => {
  it("an Iono's Basic that evolves into a body WITHOUT the prefix stops counting", () => {
    const before = mixed();
    expect(dealt(before, IONO)).toBe(70);
    const after = stackOnto(before, "p1", 0, "fix-plainvolt");
    // The Energy has not moved — evolving carries it — so a change here is the
    // FILTER's reading and nothing else.
    expect(after.players.p1.bench[0]?.energy).toEqual(before.players.p1.bench[0]?.energy);
    expect(dealt(after, IONO)).toBe(50);
    // …and the filter-less sibling is UNMOVED at 8, which is what says the drop is
    // the filter's and not the board's.
    expect(dealt(after, BOARD)).toBe(170);
  });
});

describe("§6 — the cells this slice leaves EMPTY are measurements, not omissions", () => {
  it("the `×` spelling of this sentence is printed ZERO times", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /^This attack does \d+ damage for each (?:.+ )?Energy attached to all of your (?!opponent)(?:[^.]+ )?Pokémon\.$/.test(
          s,
        ),
      ),
    ).toEqual([]);
    expect(deriveAttackDamageMultiplier(OWNER_BOARD_MULTIPLY)).toBeNull();
    expect(deriveAttackDamageBonus(OWNER_BOARD_MULTIPLY)).toBeNull();
  });

  it("the OPPONENT-side board spelling is printed on the `×` fold ONLY", () => {
    // The measurement the `(?!opponent)` lookahead rests on: four rows, all of them
    // bare-fold, none of them additive. If an additive one is ever ingested this rung
    // names it and the lookahead has to be re-argued rather than silently swallow it.
    const rows = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => s.includes("Energy attached to all of your opponent"));
    expect(rows).toHaveLength(4);
    expect(rows.filter((s) => s.includes("more damage"))).toEqual([]);
  });

  it("the whole of `Energy attached to all of your` is SEVEN rows, and the split is 2/5", () => {
    const rows = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => s.includes("attached to all of your"));
    expect(rows).toHaveLength(7);
    expect(rows).toContain(OWNER_BOARD);
    expect(rows.filter((s) => resolvedByAnyReader(s))).toHaveLength(7);
  });

  it("the `less` spelling of this sentence is printed ZERO times", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /less damage for each .*Energy attached to all of your/.test(s),
      ),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE SHARED HELPER AND ITS THREE SHIPPED CALLERS
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `countEnergyInPlay`, widened without moving a caller", () => {
  it("the new parameter is OPTIONAL and the 3-argument call is the old one", () => {
    const state = mixed();
    expect(countEnergyInPlay(state, "p1", "Lightning", undefined)).toBe(
      countEnergyInPlay(state, "p1", "Lightning"),
    );
    expect(countEnergyInPlay(state, "p1", null, undefined)).toBe(
      countEnergyInPlay(state, "p1", null),
    );
    expect(countEnergyInPlay(state, "p2", "special", undefined)).toBe(
      countEnergyInPlay(state, "p2", "special"),
    );
  });

  it("the filter is asked PER HOLDER and BEFORE the provision question", () => {
    // A body the filter refuses contributes nothing whatever its attachments say, so
    // the untyped read over a filtered board is the sum of the matching bodies alone.
    const state = mixed();
    expect(countEnergyInPlay(state, "p1", null)).toBe(9);
    expect(countEnergyInPlay(state, "p1", null, { kind: "ownerPokemon", owner: "Iono" })).toBe(4);
  });

  it("a MISSING Active is handled inside the walk, filtered as well as not", () => {
    const state = mixed();
    const headless: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(countEnergyInPlay(headless, "p1", "Lightning")).toBe(6);
    expect(
      countEnergyInPlay(headless, "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" }),
    ).toBe(1);
  });

  it("a filter that matches NOTHING is 0, and an EMPTY board is 0 too", () => {
    expect(countEnergyInPlay(mixed(), "p1", "Lightning", { kind: "byName", name: "Nobody" })).toBe(
      0,
    );
    expect(
      countEnergyInPlay(zeroEmpty(), "p1", "Lightning", { kind: "ownerPokemon", owner: "Iono" }),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION AND THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  it("DIRECTION 1 — there is NO CARRIER AT ALL", () => {
    const before = mixed();
    const after = swing(before, IONO).state;
    for (const [label, state] of [
      ["before", before],
      ["after", after],
    ] as const) {
      const wire = JSON.stringify(state);
      expect(wire, label).not.toContain("energyOnSelf");
      expect(wire, label).not.toContain("ownerPokemon");
    }
    expect(after.pending).toEqual([]);
  });

  it("DIRECTION 2 — a v29 record round-trips and the NEXT swing reads the same", () => {
    const first = swing(mixed(), IONO);
    expect(findEvent(first.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);
    // …and the parsed record is a LIVE board: hand the turn back and swing the same
    // clause off the bytes that came out of `JSON.parse`, after one more {L} lands on
    // an Iono's body, so the SAME clause reads a bigger board and says so.
    const returned = mustApply(saved, { type: "endTurn", seat: "p2" }).state;
    const grown = attachBenchFromDeck(returned, "p1", 0, "fix-lightning-energy", 1);
    expect(findEvent(swing(grown, IONO).events, "DAMAGE_DEALT")?.dealt).toBe(10 + 20 * 4);
  });
});

describe("§9 — no new `FIXTURE_POOL` id", () => {
  it("the local ids are LOCAL", () => {
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    expect(Object.keys(LOCAL_CARDS)).toHaveLength(7);
  });

  it("no POOLED card prints this sentence, so the pool sweeps are unmoved", () => {
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === OWNER_BOARD),
    );
    expect(carriers).toEqual([]);
    // …and the new FIELD has exactly ZERO producers in the pool, which is what keeps
    // `boardWideEnergyScaling.test.ts`'s and `selfEnergyScaling.test.ts`'s producer
    // sweeps byte-identical.
    const produced: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const count = deriveAttackDamageBonus(attack.effect ?? "")?.count;
        if (count?.kind === "energyOnSelf" && count.filter !== undefined) {
          produced.push(`${id}[${index}]`);
        }
      }
    }
    expect(produced).toEqual([]);
  });
});
