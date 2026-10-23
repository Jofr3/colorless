import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveAttackCost, selfAttackCostDiscount } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  trainerCard,
  activeOf,
} from "./testFixtures";

/** The printed sentences, byte-for-byte. */
const FOOD_PREP_TEXT =
  "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile.";
const HUSTLE_PLAY_TEXT =
  "Attacks used by this Pokémon cost {C} less for each of your opponent's Benched Pokémon.";

/** Veluza's printed attack cost — FOUR bare {C} and no typed symbol, which is what
    makes "free at four Kofu" a real board rather than a limit. */
const SONIC_EDGE = ["Colorless", "Colorless", "Colorless", "Colorless"] as const;
/** Crabominable's, and Incineroar ex's: one typed symbol behind four {C}. */
const HAYMAKER = ["Water", "Colorless", "Colorless", "Colorless", "Colorless"] as const;
const BLAZE_BLAST = ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"] as const;

const KOFU_TEXT =
  "Put 2 cards from your hand on the bottom of your deck in any order. If you put 2 cards on the bottom of your deck in this way, draw 4 cards. (If you can't put 2 cards from your hand on the bottom of your deck, you can't use this card.)";

const SEED = 31;

function abilityBody(id: string, name: string, effect: string, overrides: Partial<Card>): Card {
  return battler(id, {
    retreat: 1,
    ...overrides,
    abilities: [{ type: "Ability", name, effect }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  // ── "Food Prep" ×4, ONE sentence, TWO card names, THREE stages between them.
  "svp-134": abilityBody("svp-134", "Food Prep", FOOD_PREP_TEXT, {
    name: "Crabominable",
    hp: 160,
    stage: "Stage1",
    evolveFrom: "Crabrawler",
    types: ["Water"],
    attacks: [{ name: "Haymaker", cost: [...HAYMAKER], damage: 250 }],
  }),
  "sv07-042": abilityBody("sv07-042", "Food Prep", FOOD_PREP_TEXT, {
    name: "Crabominable",
    hp: 160,
    stage: "Stage1",
    evolveFrom: "Crabrawler",
    types: ["Water"],
    attacks: [{ name: "Haymaker", cost: [...HAYMAKER], damage: 250 }],
  }),
  "sv07-149": abilityBody("sv07-149", "Food Prep", FOOD_PREP_TEXT, {
    name: "Crabominable",
    hp: 160,
    stage: "Stage1",
    evolveFrom: "Crabrawler",
    types: ["Water"],
    attacks: [{ name: "Haymaker", cost: [...HAYMAKER], damage: 250 }],
  }),
  "sv07-045": abilityBody("sv07-045", "Food Prep", FOOD_PREP_TEXT, {
    name: "Veluza",
    hp: 130,
    stage: "Basic",
    types: ["Water"],
    attacks: [{ name: "Sonic Edge", cost: [...SONIC_EDGE], damage: 110 }],
  }),
  // ── "Hustle Play" ×2 — Stage 2, so NO Basic-only §9 lock reaches it.
  "sv05-034": abilityBody("sv05-034", "Hustle Play", HUSTLE_PLAY_TEXT, {
    name: "Incineroar ex",
    hp: 320,
    stage: "Stage2",
    evolveFrom: "Torracat",
    types: ["Fire"],
    attacks: [{ name: "Blaze Blast", cost: [...BLAZE_BLAST], damage: 240 }],
  }),
  "sv05-187": abilityBody("sv05-187", "Hustle Play", HUSTLE_PLAY_TEXT, {
    name: "Incineroar ex",
    hp: 320,
    stage: "Stage2",
    evolveFrom: "Torracat",
    types: ["Fire"],
    attacks: [{ name: "Blaze Blast", cost: [...BLAZE_BLAST], damage: 240 }],
  }),
  "sv07-138": { ...trainerCard("sv07-138", "Supporter", KOFU_TEXT), name: "Kofu" },
  "sv07-165": { ...trainerCard("sv07-165", "Supporter", KOFU_TEXT), name: "Kofu" },
  /** THE NEAR MISS, and the reason the count is not "any Supporter": a card whose
      name CONTAINS "Kofu" and is not Kofu contributes NOTHING. */
  "fix-notkofu": { ...trainerCard("fix-notkofu", "Supporter", KOFU_TEXT), name: "Kofu's Wailord" },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const FOOD_DECK = deckOf({
  "svp-134": 2,
  "sv07-042": 2,
  "sv07-149": 2,
  "sv07-045": 2,
  "sv05-034": 2,
  "sv05-187": 2,
  "sv07-138": 12,
  "sv07-165": 12,
  "fix-notkofu": 6,
  "sv01-096": 2, // Klefki — "Mischievous Lock", the §9 lock that reaches a BASIC
  "fix-titan": 12, // 340 HP inert Basic — the dominant starter and every neutral body
  "fix-energy": 4,
});

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: FOOD_DECK, p2: FOOD_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

function board(): GameState {
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-titan"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-titan"), "p2");
}

function active(state: GameState, seat: Seat, cardId: string): GameState {
  return clearBench(setActiveFromDeck(state, seat, cardId), seat);
}

/** Put `count` bodies on `seat`'s bench, one at a time off the deck. */
function benchN(state: GameState, seat: Seat, count: number): GameState {
  let next = clearBench(state, seat);
  for (let i = 0; i < count; i += 1) next = benchFromDeck(next, seat, "fix-titan");
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE REGISTRY ROWS, and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 the registry rows", () => {
  const FOOD_IDS = ["svp-134", "sv07-042", "sv07-045", "sv07-149"] as const;
  const HUSTLE_IDS = ["sv05-034", "sv05-187"] as const;

  it("authors all FOUR Food Prep printings as ONE object — a discard-pile count and NOTHING else", () => {
    for (const id of FOOD_IDS) {
      expect(programFor(id), `${id} is not keyed`).toEqual({
        passive: { attackCostDiscountPerNamedInDiscard: { name: "Kofu", amount: 1 } },
      });
      // The absence is an assertion: an `attack` map here would silently take over
      // the printed-text derivation `deriveAttackEffect` performs for "During your
      // next turn, this Pokémon can't use Haymaker".
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.abilities).toBeUndefined();
    }
    for (const id of FOOD_IDS) expect(programFor(id)).toBe(programFor("svp-134"));
  });

  it("authors BOTH Hustle Play printings as ONE object — a bench count and NOTHING else", () => {
    for (const id of HUSTLE_IDS) {
      expect(programFor(id), `${id} is not keyed`).toEqual({
        passive: { attackCostDiscountPerOpponentBenched: 1 },
      });
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(programFor("sv05-187")).toBe(programFor("sv05-034"));
  });

  it("the two rows are DIFFERENT objects, and neither carries the other's field", () => {
    expect(programFor("svp-134")).not.toBe(programFor("sv05-034"));
    expect(programFor("svp-134")?.passive?.attackCostDiscountPerOpponentBenched).toBeUndefined();
    expect(programFor("sv05-034")?.passive?.attackCostDiscountPerNamedInDiscard).toBeUndefined();
    expect(programFor("svp-134")?.passive?.attackCostDiscountPerOpponentPrize).toBeUndefined();
    expect(programFor("sv05-034")?.passive?.attackCostDiscountPerOpponentPrize).toBeUndefined();
  });

  it("FOUR printings and TWO card names — the group a name-keyed reader closes one id short", () => {
    const names = FOOD_IDS.map((id) => POOL[id]?.name);
    expect(names).toEqual(["Crabominable", "Crabominable", "Veluza", "Crabominable"]);
    expect(new Set(names).size).toBe(2);
    // …and the STAGES, which is what makes the §9 control below a controlled pair
    // rather than two unrelated boards.
    expect(POOL["sv07-045"]?.stage).toBe("Basic");
    expect(POOL["sv07-042"]?.stage).toBe("Stage1");
    expect(POOL["sv05-034"]?.stage).toBe("Stage2");
  });

  it("fields the printed text VERBATIM on every one of the six", () => {
    for (const id of FOOD_IDS) {
      expect(POOL[id]?.abilities?.[0]).toEqual({
        type: "Ability",
        name: "Food Prep",
        effect: FOOD_PREP_TEXT,
      });
    }
    for (const id of HUSTLE_IDS) {
      expect(POOL[id]?.abilities?.[0]?.name).toBe("Hustle Play");
      expect(POOL[id]?.abilities?.[0]?.effect).toBe(HUSTLE_PLAY_TEXT);
    }
    // Both sentences say "Attacks", PLURAL — which is why the unscoped field is
    // exact here and needs no flagged assumption, unlike `SEASONED_SKILL`.
    expect(FOOD_PREP_TEXT.startsWith("Attacks used by this Pokémon")).toBe(true);
    expect(HUSTLE_PLAY_TEXT.startsWith("Attacks used by this Pokémon")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — FOOD PREP: the count is over YOUR discard, BY NAME.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 Food Prep — the discard-pile count", () => {
  it("takes nothing off with an empty discard, and hands back the PRINTED ARRAY ITSELF", () => {
    const state = active(board(), "p1", "sv07-045");
    const printed = [...SONIC_EDGE];
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // Reference identity: `effectiveAttackCost` returns the caller's own array at a
    // zero net delta, and `redactedAttacksOf` leans on that to keep the wire frame
    // byte-identical.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), printed)).toBe(printed);
  });

  it("removes one {C} per Kofu in the discard, leaving the typed symbol alone", () => {
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "sv07-138", 2);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(2);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), HAYMAKER)).toEqual([
      "Water",
      "Colorless",
      "Colorless",
    ]);
  });

  it("counts BOTH Kofu printings, because the sentence says 'each Kofu card'", () => {
    // The whole reason the field carries a NAME and not an id. `sv07-138` and
    // `sv07-165` are two ids for one printed card, and a discard holding one of
    // each is a discard holding TWO Kofu.
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "sv07-138", 1);
    state = discardFromDeck(state, "p1", "sv07-165", 1);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(2);
  });

  it("counts NOTHING for a card whose name merely contains 'Kofu'", () => {
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "fix-notkofu", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    expect(POOL["fix-notkofu"]?.name).toBe("Kofu's Wailord");
  });

  it("the pile is YOURS — four Kofu in the OPPONENT's discard discount nothing", () => {
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p2", "sv07-138", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // …and the same four on P1's own side is the full four.
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(4);
  });

  it("goes FREE at four Kofu on Veluza's four bare {C} — a real board, not a limit", () => {
    let state = active(board(), "p1", "sv07-045");
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(4);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), SONIC_EDGE)).toEqual([]);
  });

  it("SELF-FLOORS past the last Colorless and never eats a typed symbol", () => {
    // The structural claim of the whole seam, driven: this cost is an ARRAY, so the
    // removal loop runs out of Colorless to spend itself on and no `Math.max` is
    // owed — the sharpest difference from `effectiveRetreatCost`.
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    state = discardFromDeck(state, "p1", "sv07-165", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(8);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), HAYMAKER)).toEqual(["Water"]);
  });

  it("holds on a BENCHED holder — the sentence prints no Active clause", () => {
    let state = board();
    state = benchFromDeck(state, "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "sv07-138", 3);
    const benched = state.players.p1.bench[0];
    expect(benched).toBeDefined();
    expect(benched && selfAttackCostDiscount(state, benched)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — HUSTLE PLAY: the count is over the OPPONENT's bench.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 Hustle Play — the opposing-bench count", () => {
  it("takes nothing off against an EMPTY opposing bench", () => {
    const state = active(board(), "p1", "sv05-034");
    expect(state.players.p2.bench).toHaveLength(0);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
  });

  it("removes one {C} per Benched body the OPPONENT has, up to the full five", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      let state = active(board(), "p1", "sv05-034");
      state = benchN(state, "p2", n);
      expect(state.players.p2.bench, `bench of ${n}`).toHaveLength(n);
      expect(selfAttackCostDiscount(state, activeOf(state, "p1")), `bench of ${n}`).toBe(n);
    }
  });

  it("counts the BENCH and not the ACTIVE — a full board is FIVE, never six", () => {
    let state = active(board(), "p1", "sv05-034");
    state = benchN(state, "p2", 5);
    expect(state.players.p2.active).not.toBeNull();
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(5);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), BLAZE_BLAST)).toEqual(["Fire"]);
  });

  it("counts the OPPONENT's bench and not YOUR OWN", () => {
    let state = active(board(), "p1", "sv05-034");
    state = benchN(state, "p1", 4);
    expect(state.players.p1.bench).toHaveLength(4);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
  });

  it("is symmetric — the same row on P2 reads P1's bench", () => {
    let state = active(board(), "p2", "sv05-187");
    state = benchN(state, "p1", 3);
    expect(selfAttackCostDiscount(state, activeOf(state, "p2"))).toBe(3);
  });
});

describe("§4 the sentence → count-source mapping, driven both ways", () => {
  it("Food Prep ignores a FULL opposing bench, on a board where Hustle Play would read five", () => {
    let state = active(board(), "p1", "sv07-042");
    state = benchN(state, "p2", 5);
    expect(state.players.p2.bench).toHaveLength(5);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
  });

  it("Hustle Play ignores EIGHT Kofu, on a board where Food Prep would read eight", () => {
    let state = active(board(), "p1", "sv05-034");
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    state = discardFromDeck(state, "p1", "sv07-165", 4);
    expect(state.players.p1.discard.length).toBeGreaterThanOrEqual(8);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
  });

  it("NEITHER reads the seam's FIRST count source — six taken Prizes discount nothing", () => {
    for (const id of ["sv07-042", "sv05-034"]) {
      let state = active(board(), "p1", id);
      state = setPrizes(state, "p2", 0);
      expect(selfAttackCostDiscount(state, activeOf(state, "p1")), id).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE §9 LOCK, in BOTH directions, on ONE program.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 the §9 lock — the seam's first NEGATIVE control", () => {
  /** Klefki `sv01-096` "Mischievous Lock" into the opposing Active spot, WITHOUT
      clearing that side's bench — the bench is a load-bearing count for Hustle
      Play, and `active()` above would silently zero it. */
  function withLock(state: GameState): GameState {
    return setActiveFromDeck(state, "p2", "sv01-096");
  }

  it("SILENCES Veluza — a BASIC holder, so D113's reachability rule reaches it", () => {
    let state = active(board(), "p1", "sv07-045");
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(4);
    state = withLock(state);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // …and the printed cost snaps back whole.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), SONIC_EDGE)).toEqual([...SONIC_EDGE]);
  });

  it("does NOT silence Crabominable — SAME program object, STAGE 1 holder", () => {
    let state = active(board(), "p1", "sv07-042");
    state = discardFromDeck(state, "p1", "sv07-138", 4);
    state = withLock(state);
    expect(programFor("sv07-042")).toBe(programFor("sv07-045"));
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(4);
  });

  it("does NOT silence Incineroar ex — a STAGE 2 holder", () => {
    // The lock goes in FIRST and the bench is built behind it, because promoting a
    // body out of the Active spot pushes the displaced one onto the bench — which
    // would make the count 4 and the assertion accidental.
    let state = withLock(active(board(), "p1", "sv05-034"));
    state = benchN(state, "p2", 3);
    expect(state.players.p2.bench).toHaveLength(3);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(3);
  });
});
