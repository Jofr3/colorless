import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { registryCardIds } from "./registry";
import { flipCoin, randomIndex } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const SINGLE_MILL = "Flip 2 coins. For each heads, discard the top card of your opponent's deck.";

const HAND_PICK = "Flip 3 coins. For each heads, discard a random card from your opponent's hand.";

const D130_PRINTED =
  "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.";
const D130_UNTIL =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

const BUILT_AT_D476 = [
  "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
] as const;

const BUILT_AT_D463 = [
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
] as const;

const MILL = 0; // {C}, no damage — line 201
const PICK = 1; // {C}, no damage — line 216
const PLAIN = 2; // {C}, no damage, no effect — the ONE-AXIS control
const MILL3 = 3;

const LOCAL_CARDS: Record<string, Card> = {
  "fix-perheads": battler("fix-perheads", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Single Mill", effect: SINGLE_MILL },
      { cost: ["Colorless"], name: "Hand Pick", effect: HAND_PICK },
      { cost: ["Colorless"], name: "Plain Slap" },
      { cost: ["Colorless"], name: "Triple Mill", effect: D130_PRINTED },
    ],
  }),
  /** 320 HP, no attacks — the victim and the bench filler. Nothing in this suite
      deals damage, so it exists to keep every promotion forced and every board legal
      rather than to survive anything. */
  "fix-perheads-body": battler("fix-perheads-body", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const PER_HEADS_DECK = deckOf({
  "fix-perheads": 12,
  "fix-perheads-body": 22,
  "fix-energy": 22,
  // A SECOND, DIFFERENT Energy card — §9 needs the victim's Active to hold two that
  // are not interchangeable, because a park at a single class of candidate
  // auto-resolves (the M1 doctrine) and would prove nothing about parking.
  "fix-water-energy": 4,
});

/** How many seeds every sweep walks. Wide enough that both a 2-flip and a 3-flip
    attack reach every heads count — asserted in §6 rather than hoped for. */
const SEEDS = 40;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function faces(events: GameEvent[]): ("heads" | "tails")[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

function headsIn(events: GameEvent[]): number {
  return faces(events).filter((f) => f === "heads").length;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: PER_HEADS_DECK, p2: PER_HEADS_DECK }, { pool: POOL, first });
}

/** p1 owns TURN 2 with the demonstrator Active and one {C} attached; p2 goes first
    and ends turn 1 immediately (§4 forbids the going-first player's turn-1 attack).
    p2's bench holds one body so any promotion is FORCED. */
function armed(seed: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "fix-perheads");
  state = setActiveFromDeck(state, "p2", "fix-perheads-body");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-perheads-body");
  return state;
}

function attack(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

describe("§1 — two sentences, two printings, and the family enumerated", () => {
  it("both are corpus rows at ONE legal printing each", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(SINGLE_MILL)).toBe(1);
    expect(corpus.get(HAND_PICK)).toBe(1);
    expect(legalAttackCorpus()).toHaveLength(640);
    expect(legalAttackCorpus().reduce((n, [units]) => n + units, 0)).toBe(1732);
  });

  it("the WHOLE per-heads family, enumerated by the printed PHRASE and not by a verb", () => {
    const perFace = legalAttackCorpus().filter(
      ([, s]) => /For each (heads|tails),/.test(s) && !s.includes("This attack does"),
    );
    expect(perFace.map(([, s]) => s).sort()).toEqual(
      [SINGLE_MILL, HAND_PICK, ...BUILT_AT_D463, ...BUILT_AT_D476].sort(),
    );
    expect(perFace).toHaveLength(5);
    expect(perFace.reduce((n, [units]) => n + units, 0)).toBe(5);
    // The two ceilings, named so the enumeration's boundary is a measurement.
    const ceilings = legalAttackCorpus().filter(([, s]) => s.includes("up to the number of heads"));
    expect(ceilings).toHaveLength(2);
    for (const [, s] of ceilings) expect(s).not.toContain("For each heads,");
  });

  it("D130's OWN TWO SENTENCES CARRY ZERO LEGAL PRINTINGS AT THIS HEAD", () => {
    const sentences = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(sentences.has(D130_PRINTED)).toBe(false);
    expect(sentences.has(D130_UNTIL)).toBe(false);
    expect(deriveAttackCoinFlip(D130_PRINTED)).not.toBeNull();
    expect(deriveAttackCoinFlip(D130_UNTIL)).not.toBeNull();
    const mills = legalAttackCorpus().filter(([, s]) =>
      /[Dd]iscard the top .*of your opponent's deck/.test(s),
    );
    expect(mills.map(([, s]) => s)).toEqual([
      "Discard the top 2 cards of your opponent's deck.",
      "Discard the top 3 cards of your opponent's deck.",
      "Discard the top card of your opponent's deck.",
      "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      SINGLE_MILL,
    ]);
  });

  it("both resolve through the reader SURFACE, and the surface did not grow", () => {
    expect(resolvedByAnyReader(SINGLE_MILL)).toBe(true);
    expect(resolvedByAnyReader(HAND_PICK)).toBe(true);
    for (const sentence of BUILT_AT_D476) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
    for (const sentence of BUILT_AT_D463) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: two anchors, and the crossings they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the co-variance is fenced", () => {
  it("each sentence derives the exact literal", () => {
    expect(deriveAttackCoinFlip(SINGLE_MILL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(HAND_PICK)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "randomFromOpponentHand", to: "discard" }],
      face: "heads",
    });
  });

  it("the ops are BYTE-IDENTICAL to what the BARE sentences already derive", () => {
    const bareMill = (deriveAttackEffect("Discard the top card of your opponent's deck.") ?? [])[0];
    const bareHand = (deriveAttackEffect("Discard a random card from your opponent's hand.") ??
      [])[0];
    const coinMill = (deriveAttackCoinFlip(SINGLE_MILL) as { ops: EffectOp[] }).ops[0];
    const coinHand = (deriveAttackCoinFlip(HAND_PICK) as { ops: EffectOp[] }).ops[0];
    expect(JSON.stringify(coinMill)).toBe(JSON.stringify(bareMill));
    expect(JSON.stringify(coinHand)).toBe(JSON.stringify(bareHand));
  });

  it("refuses the CROSS PRODUCT — the digits and the plural `s` CO-VARY", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top 3 card of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top cards of your opponent's deck.",
      ),
    ).toBeNull();
    // …and both PRINTED spellings still derive, which is what makes the two nulls a
    // fence rather than a gap.
    expect(deriveAttackCoinFlip(SINGLE_MILL)).not.toBeNull();
    expect(deriveAttackCoinFlip(D130_PRINTED)).not.toBeNull();
  });

  it("the UNBOUNDED twin of each new arm is DELIBERATELY absent", () => {
    const untilRows = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("Flip a coin until you get tails."),
    );
    expect(untilRows.filter(([, s]) => s.includes("For each heads, discard the top"))).toHaveLength(
      0,
    );
    expect(
      untilRows.filter(([, s]) => s.includes("random card from your opponent's hand")),
    ).toHaveLength(0);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
      ),
    ).toBeNull();
  });

  it("carries the family's flip guards, and NO count guard on the singular", () => {
    // `flips >= 2` (the regex's own "coins" is PLURAL) and `flips <= MAX_PRINTED_FLIPS`
    // (10, the ingested-text ceiling), copied from the plural twin deliberately.
    for (const n of [0, 1, 11, 99]) {
      expect(
        deriveAttackCoinFlip(
          `Flip ${n} coins. For each heads, discard the top card of your opponent's deck.`,
        ),
        `mill ${n}`,
      ).toBeNull();
      expect(
        deriveAttackCoinFlip(
          `Flip ${n} coins. For each heads, discard a random card from your opponent's hand.`,
        ),
        `hand ${n}`,
      ).toBeNull();
    }
    for (const n of [2, 3, 10]) {
      expect(
        deriveAttackCoinFlip(
          `Flip ${n} coins. For each heads, discard the top card of your opponent's deck.`,
        ),
      ).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: n },
        ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
        face: "heads",
      });
    }
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top 0 cards of your opponent's deck.",
      ),
    ).toBeNull();
  });

  it("accepts the U+2019 spelling and refuses a NON-BREAKING space", () => {
    for (const straight of [SINGLE_MILL, HAND_PICK]) {
      const curly = straight.replace("opponent's", "opponent’s");
      expect(curly).not.toBe(straight);
      expect(deriveAttackCoinFlip(curly)).toEqual(deriveAttackCoinFlip(straight));
      const nbsp = straight.replace("For each", "For each");
      expect(deriveAttackCoinFlip(nbsp)).toBeNull();
    }
  });

  it("is CASE SENSITIVE and whole-sentence ANCHORED", () => {
    for (const straight of [SINGLE_MILL, HAND_PICK]) {
      expect(deriveAttackCoinFlip(straight.toLowerCase())).toBeNull();
      expect(deriveAttackCoinFlip(straight.replace("For each", "for each"))).toBeNull();
      expect(deriveAttackCoinFlip(`Then, ${straight}`)).toBeNull();
      expect(deriveAttackCoinFlip(`${straight} Then, draw a card.`)).toBeNull();
      // …but outer whitespace is trimmed, like every sibling reader.
      expect(deriveAttackCoinFlip(`  ${straight}  `)).toEqual(deriveAttackCoinFlip(straight));
    }
  });

  it("ONE reader owns each sentence — every sibling returns null", () => {
    for (const sentence of [SINGLE_MILL, HAND_PICK]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("leaves all four D126–D130 readings EXACTLY as they were", () => {
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads."),
    ).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 30,
    });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
      ),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(deriveAttackCoinFlip(D130_UNTIL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — `MATCH_RECORD_VERSION` STAYS 29, driven over the SERIALIZED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — no new persisted byte, in three directions", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // **DIRECTION 1 — FORWARD: the literals this deploy writes, whole.**
    const mill = (deriveAttackCoinFlip(SINGLE_MILL) as { ops: EffectOp[] }).ops[0] as EffectOp;
    const pick = (deriveAttackCoinFlip(HAND_PICK) as { ops: EffectOp[] }).ops[0] as EffectOp;
    expect(JSON.stringify(mill)).toBe('{"op":"discardDeckTop","whose":"opponent","count":1}');
    expect(JSON.stringify(pick)).toBe('{"op":"randomFromOpponentHand","to":"discard"}');
    expect(Object.keys(mill).sort()).toEqual(["count", "op", "whose"]);
    expect(Object.keys(pick).sort()).toEqual(["op", "to"]);
    expect(roundTrip(mill)).toEqual(mill);
    expect(roundTrip(pick)).toEqual(pick);
    expect(
      JSON.stringify(deriveAttackEffect("Discard the top card of your opponent's deck.")?.[0]),
    ).toBe(JSON.stringify(mill));
    expect(
      JSON.stringify(deriveAttackEffect("Discard a random card from your opponent's hand.")?.[0]),
    ).toBe(JSON.stringify(pick));

    let parked = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const index of [MILL, PICK]) {
        const { state } = attack(armed(seed), index);
        if (state.phase.kind === "effect:choose") parked += 1;
      }
    }
    expect(parked).toBe(0);
    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    expect(authored.length).toBeGreaterThan(0);

    const events: GameEvent[] = [];
    const board = armed(3);
    const noCount = JSON.parse(
      JSON.stringify(mill, (k, v) => (k === "count" ? undefined : v)),
    ) as EffectOp;
    expect(Object.keys(noCount)).not.toContain("count");
    const milled = runProgram(board, [noCount], { seat: "p1", invokedBy: "attack" }, events);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(milled.state.players.p2.deck).toEqual(board.players.p2.deck);
    const noTo = JSON.parse(
      JSON.stringify(pick, (k, v) => (k === "to" ? undefined : v)),
    ) as EffectOp;
    const events2: GameEvent[] = [];
    const picked = runProgram(board, [noTo], { seat: "p1", invokedBy: "attack" }, events2);
    expect(all(events2, "RANDOM_CARD_TAKEN")).toHaveLength(1);
    expect(all(events2, "SHUFFLE")).toHaveLength(1);
    expect(picked.state.players.p2.discard).toEqual(board.players.p2.discard);
    expect(picked.state.rngState).not.toBe(board.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE SINGULAR MILL, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — 2 flips, one op per heads, ONE card each", () => {
  it("announces exactly TWO rows and mills 1 × heads off the top, in order", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = armed(seed);
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = attack(state, MILL);
      // ALWAYS TWO FLIPS — the printed count does not depend on the faces.
      expect(faces(events)).toHaveLength(2);
      const heads = headsIn(events);
      seen.add(heads);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");

      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        expect(row.seat).toBe("p2");
        expect(row.actor).toBe("p1");
        expect(row.uids).toHaveLength(1);
      }
      // THE CARDS CAME OFF THE TOP, IN ORDER.
      const milledUids = rows.flatMap((r) => r.uids);
      expect(milledUids).toEqual(deckBefore.slice(0, heads));
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...deckBefore.slice(0, heads),
      ]);
      expect(deckBefore.length - done.players.p2.deck.length).toBe(heads + 1);
      expect(done.players.p1.discard).toEqual(state.players.p1.discard);
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("orders every mill row BEHIND every flip row", () => {
    // The flips are taken in FRONT of the §8.5 pipeline and the expanded ops run at
    // the TAIL. A build that ran the op inside the announce loop would interleave.
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed), MILL);
      const lastFlip = events.map((e) => e.type).lastIndexOf("ATTACK_EFFECT_COIN_FLIP");
      for (const [i, e] of events.entries()) {
        if (e.type === "DECK_TOP_DISCARDED") expect(i).toBeGreaterThan(lastFlip);
      }
    }
  });

  it("mills a DIFFERENT number per heads than D130's arm, off the same op", () => {
    // ONE card against THREE, on the same board and the same seed — which is what
    // makes `count` a parameter of the arm rather than a constant of the op.
    for (let seed = 0; seed < 12; seed++) {
      const one = attack(armed(seed), MILL);
      const three = attack(armed(seed), MILL3);
      for (const row of all(one.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(1);
      for (const row of all(three.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(3);
    }
  });

  it("CLAMPS on a short deck, reports the short list, and does not throw", () => {
    // A deck of exactly one card under a 2-flip attack: at two heads the second copy
    // finds nothing and emits NOTHING, which is the arm's own "zero cards emit nothing"
    // rule reached through the expansion.
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = trimDeckTo(armed(seed), "p2", 1);
      const { state: done, events } = attack(state, MILL);
      const heads = headsIn(events);
      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(Math.min(heads, 1));
      expect(done.players.p2.discard.length - state.players.p2.discard.length).toBe(
        Math.min(heads, 1),
      );
      expect(rows.flatMap((r) => r.uids)).toEqual(
        state.players.p2.deck.slice(0, Math.min(heads, 1)),
      );
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE RANDOM HAND PICK, end to end — N INDEPENDENT picks.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — 3 flips, one pick per heads, over a SHRINKING hand", () => {
  it("announces exactly THREE rows and takes 1 × heads DISTINCT cards", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = armed(seed);
      const handBefore = [...state.players.p2.hand];
      const { state: done, events } = attack(state, PICK);
      expect(faces(events)).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);

      const taken = all(events, "RANDOM_CARD_TAKEN");
      expect(taken).toHaveLength(Math.min(heads, handBefore.length));
      for (const row of taken) {
        expect(row.seat).toBe("p2"); // the hand's OWNER
        expect(row.actor).toBe("p1"); // the player whose card did it
        expect(row.to).toBe("discard");
        expect(handBefore).toContain(row.uid);
      }
      expect(new Set(taken.map((r) => r.uid)).size).toBe(taken.length);
      // …and every one of them landed in the OPPONENT'S discard, in pick order.
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...taken.map((r) => r.uid),
      ]);
      // The hand lost exactly the taken cards and gained exactly p2's turn-start draw.
      const gone = new Set(taken.map((r) => r.uid));
      expect(done.players.p2.hand.filter((uid) => gone.has(uid))).toEqual([]);
      expect(done.players.p2.hand.length).toBe(handBefore.length - taken.length + 1);
      // NOTHING WAS SHUFFLED — the `discard` route does not touch the deck, and a
      // build that took the `deck` arm would fire a SHUFFLE and burn an rng step.
      expect(types(events)).not.toContain("SHUFFLE");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("orders every pick row BEHIND every flip row", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed), PICK);
      const lastFlip = events.map((e) => e.type).lastIndexOf("ATTACK_EFFECT_COIN_FLIP");
      for (const [i, e] of events.entries()) {
        if (e.type === "RANDOM_CARD_TAKEN") expect(i).toBeGreaterThan(lastFlip);
      }
    }
  });

  it("a hand SHORTER than the heads count takes what it can and then nothing", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = armed(seed);
      const drop = state.players.p2.hand.slice(1);
      state = {
        ...state,
        players: {
          ...state.players,
          p2: {
            ...state.players.p2,
            hand: state.players.p2.hand.slice(0, 1),
            discard: [...state.players.p2.discard, ...drop],
          },
        },
      };
      const { events } = attack(state, PICK);
      const heads = headsIn(events);
      expect(all(events, "RANDOM_CARD_TAKEN")).toHaveLength(Math.min(heads, 1));
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ZERO HEADS, and the outcome coverage the cases above rest on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — zero heads runs nothing and skips nothing", () => {
  it("emits no consequent row and takes the existing NO-PROGRAM ending", () => {
    let zeroMill = 0;
    let zeroPick = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const mill = attack(armed(seed), MILL);
      if (headsIn(mill.events) === 0) {
        zeroMill += 1;
        expect(all(mill.events, "DECK_TOP_DISCARDED")).toHaveLength(0);
        expect(types(mill.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
        expect(types(mill.events)).toContain("TURN_ENDED");
        expect(mill.state.players.p2.discard).toEqual(armed(seed).players.p2.discard);
      }
      const pick = attack(armed(seed), PICK);
      if (headsIn(pick.events) === 0) {
        zeroPick += 1;
        expect(all(pick.events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
        expect(types(pick.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
        expect(types(pick.events)).toContain("TURN_ENDED");
      }
    }
    expect(zeroMill).toBeGreaterThan(0);
    expect(zeroPick).toBeGreaterThan(0);
  });

  it("the PLAIN control takes no flip at all", () => {
    // The one-axis control: the same card, the same board, an attack with no printed
    // effect. Zero flips, zero rows — so every flip above is owed to the sentence.
    for (let seed = 0; seed < 8; seed++) {
      const { events } = attack(armed(seed), PLAIN);
      expect(faces(events)).toHaveLength(0);
      expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
      expect(all(events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE rngState ACCOUNT: one sequence, flips then picks.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the seed, recomputed", () => {
  it("the MILL spends exactly its two flips and NOTHING else", () => {
    // `discardDeckTop` reads no rng, so the whole account is the two flips — and the
    // FACE SEQUENCE is reproduced by hand off the pre-attack state, not merely counted.
    for (let seed = 0; seed < SEEDS; seed++) {
      const before = armed(seed);
      const { events } = attack(before, MILL);
      const [f1, s1] = flipCoin(before.rngState);
      const [f2] = flipCoin(s1);
      expect(faces(events)).toEqual([f1, f2]);
    }
  });

  it("the PICK's flips come FIRST and its picks come out of the SAME sequence", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const before = armed(seed);
      const { state: done, events } = attack(before, PICK);
      let rng = before.rngState;
      const expected: ("heads" | "tails")[] = [];
      for (let i = 0; i < 3; i += 1) {
        const [face, next] = flipCoin(rng);
        expected.push(face);
        rng = next;
      }
      expect(faces(events)).toEqual(expected);
      // …and now the picks, off the SAME advanced state, over a hand that shrinks.
      let hand = [...before.players.p2.hand];
      const predicted: string[] = [];
      for (let i = 0; i < expected.filter((f) => f === "heads").length; i += 1) {
        if (hand.length === 0) break;
        const [index, next] = randomIndex(hand.length, rng);
        rng = next;
        predicted.push(hand[index] as string);
        hand = hand.filter((uid) => uid !== hand[index]);
      }
      expect(all(events, "RANDOM_CARD_TAKEN").map((r) => r.uid)).toEqual(predicted);
      // The engine's state ends on the same integer this recomputation did — apart
      // from p2's own turn-start draw, which takes no rng. Asserted as an EQUALITY so
      // an extra burned step (a whiffed pick, a stray shuffle) fails here.
      expect(done.rngState).toBe(rng);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — PURITY.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity", () => {
  it("resolves both printings on a DEEP-FROZEN board, at every outcome", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const index of [MILL, PICK]) {
        expect(() => attack(deepFreeze(armed(seed)), index)).not.toThrow();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — WHAT WAS REFUSED, AND WHY NO REFUSAL SURVIVED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the last refused row, BUILT at D476, and its axis measured", () => {
  it("D476 — it is BUILT, and the inverted rung catches more than the `false` did", () => {
    for (const sentence of BUILT_AT_D476) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      expect(deriveAttackCoinFlip(sentence), sentence).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: 3 },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
  });

  it("D463 — and the two that left derive `programPerHeads`, not `null`", () => {
    for (const sentence of BUILT_AT_D463) {
      const read = deriveAttackCoinFlip(sentence);
      expect(read, sentence).toMatchObject({
        kind: "programPerHeads",
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
        face: "heads",
      });
      // …and `deriveAttackEffect` still refuses BOTH, which is the disjointness that keeps
      // `FLIP_OPPONENT_ACTIVE_DISCARD` from claiming a sentence it only ENDS in.
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
    expect(deriveAttackCoinFlip(BUILT_AT_D463[0])).toHaveProperty("flips.kind", "printed");
    expect(deriveAttackCoinFlip(BUILT_AT_D463[1])).toHaveProperty("flips.kind", "untilTails");
  });

  it("the refusal is a COST, not a capability — D130's `cannot express` is FALSE", () => {
    const board = armed(5);
    const one = (deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.") ??
      [])[0] as EffectOp;
    expect(JSON.stringify(one)).toBe(
      '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}',
    );
    // The victim needs TWO DIFFERENT Energy for the pick to be a genuine choice —
    // interchangeable candidates auto-resolve (the M1 doctrine), so a same-card board
    // would prove nothing about parking.
    let armedBoard = attachFromDeck(board, "p2", "fix-energy", 1);
    armedBoard = attachFromDeck(armedBoard, "p2", "fix-water-energy", 1);
    const events: GameEvent[] = [];
    const run = runProgram(armedBoard, [one, one], { seat: "p1", invokedBy: "attack" }, events);
    expect(run.kind).toBe("parked");
    if (run.kind !== "parked") throw new Error("expected a park");
    expect(run.cont.rest).toHaveLength(1);
    expect(JSON.stringify(run.cont.rest[0])).toBe(JSON.stringify(one));
    expect(JSON.stringify(run.cont.pendingOp)).toBe(JSON.stringify(one));
  });

  it("the FACE axis has exactly ONE printing, and the PAYLOAD is what decided it", () => {
    const tails = legalAttackCorpus().filter(([, s]) => /For each tails,/.test(s));
    expect(tails.map(([, s]) => s)).toEqual([
      "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
    ]);
    expect(tails.reduce((n, [units]) => n + units, 0)).toBe(1);
    let coincide = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const f = faces(attack(armed(seed), MILL).events);
      if (f.filter((x) => x === "heads").length === f.filter((x) => x === "tails").length)
        coincide += 1;
    }
    expect(coincide).toBeGreaterThan(0);
    for (let seed = 0; seed < SEEDS; seed++) {
      const f = faces(attack(armed(seed), PICK).events);
      expect(f.filter((x) => x === "heads").length).not.toBe(f.filter((x) => x === "tails").length);
    }
  });
});
