import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
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
  optionalCostBoostProgram,
} from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import type { BoardCondition, EffectOp, GameState, Seat } from "./index";
import {
  PURGING_STRIKE_DECK,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const PURGING =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";
const CRUSHING_PRESS =
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.";
const TORRENTIAL =
  "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PRIZE_FLIP =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";

const NARROW = /^You may .*If you do,/;
const WIDE = /^You may .*\. If /;

const HAND_NOT_EMPTY: BoardCondition = { kind: "yourHandNotEmpty" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PURGING_STRIKE_DECK, p2: PURGING_STRIKE_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", "fix-purging");
  state = attachFromDeck(state, "p1", "fix-water-energy", 2);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function setHandSize(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  if (size > side.hand.length) throw new Error(`${seat} hand is ${side.hand.length}, cannot grow`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.slice(0, size),
        discard: [...side.discard, ...side.hand.slice(size)],
      },
    },
  };
}

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

const SEEDS = [9001, 9013, 9029] as const;

describe("§1 — the price, MEASURED IN REFUSED SENTENCES, before and after", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the reading goes 7 sentences / 14 printings → 8 / 15, and the REFUSED half stands still", () => {
    const narrow = corpus().filter(([, s]) => NARROW.test(s));
    expect([narrow.length, units(narrow)]).toEqual([7, 14]);
    const wide = corpus().filter(([, s]) => WIDE.test(s));
    expect([wide.length, units(wide)]).toEqual([8, 15]);
    const read = wide.filter(([, s]) => deriveAttackOptionalCostBoost(s) !== null);
    const forward = wide.filter(([, s]) => deriveAttackOptionalBoost(s) !== null);
    const refused = wide.filter(([, s]) => !resolvedByAnyReader(s));
    expect([read.length, units(read)]).toEqual([4, 10]);
    expect([forward.length, units(forward)]).toEqual([4, 5]);
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect(refused.map(([, s]) => s)).toEqual([]);
    expect(read.map(([, s]) => s)).toContain(PRIZE_FLIP);
    // …and the parts sum, which is what makes a partition a partition.
    expect(read.length + forward.length + refused.length).toBe(wide.length);
    expect(units(read) + units(forward) + units(refused)).toBe(units(wide));
    const before = wide.filter(
      ([, s]) => s === PURGING || s === PRIZE_FLIP || !resolvedByAnyReader(s),
    );
    expect([before.length, units(before)]).toEqual([2, 3]);
    for (const [, s] of wide) {
      expect(
        [deriveAttackOptionalBoost(s), deriveAttackOptionalCostBoost(s)].filter((r) => r !== null)
          .length,
        s,
      ).toBeLessThan(2);
    }
  });

  it("the sentence carries ONE printing, and the census is asked TWICE", () => {
    const rows = corpus().filter(([, s]) => s === PURGING);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    const offered = corpus().filter(([, s]) => /^You may discard your hand\b/.test(s));
    expect(offered.map(([, s]) => s)).toEqual([PURGING]);
    const connective = corpus().filter(([, s]) =>
      /^You may .*\. If you discarded any cards in this way, /.test(s),
    );
    expect(connective.map(([, s]) => s)).toEqual([PURGING]);
  });

  it("the MANDATORY hand discard was a DIFFERENT slice, and D404 took it", () => {
    const mandatory = corpus().filter(([, s]) => s === "Discard your hand and draw 6 cards.");
    expect([mandatory.length, units(mandatory)]).toEqual([1, 7]);
    expect(resolvedByAnyReader("Discard your hand and draw 6 cards.")).toBe(true);
    expect(deriveAttackOptionalCostBoost("Discard your hand and draw 6 cards.")).toBeNull();
  });

  it("NO own-hand THRESHOLD is printed anywhere, which is why the member is NULLARY", () => {
    const floors = corpus().filter(([, s]) =>
      /\d+ or more cards in your hand|at least \d+ cards? in your hand/.test(s),
    );
    expect(floors).toEqual([]);
    // The controls that make that mean something: the two thresholds the catalog DOES
    // print are both about the OPPONENT's hand or about an exact own count.
    const printed = corpus().filter(
      ([, s]) => /cards in (your|their) hand,/.test(s) && /^If /.test(s),
    );
    expect(printed.length).toBeGreaterThan(0);
  });
});

describe("§2 — the CONNECTIVE is a closed alternation, and every refusal is driven", () => {
  it("the printed sentence reads as a precondition, ONE cost op and the moreDamage payoff", () => {
    expect(deriveAttackOptionalCostBoost(PURGING)).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
  });

  it("the ALTERNATION is CLOSED — a third connective is refused, not guessed", () => {
    const at = (connective: string) =>
      deriveAttackOptionalCostBoost(
        `You may discard your hand. ${connective}, this attack does 120 more damage.`,
      );
    // The two the anchor spells.
    expect(at("If you do")).not.toBeNull();
    expect(at("If you discarded any cards in this way")).not.toBeNull();
    // …and the near misses. A bare `. If ` would claim all of these, and each of them
    // asks a question this reading does not answer: a COUNT, a different zone, or a
    // fact about the board rather than about the cost.
    expect(at("If you discarded 3 or more cards in this way")).toBeNull();
    expect(at("If you discarded any Energy in this way")).toBeNull();
    expect(at("If your opponent's Active Pokémon is Burned")).toBeNull();
    expect(at("if you do")).toBeNull();
    // …and the COMMA is not optional: the anchor splits the sentence on it.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard your hand. If you do this attack does 120 more damage.",
      ),
    ).toBeNull();
  });

  it("the COST anchor is whole-clause, and the near nouns are refused", () => {
    const at = (cost: string) =>
      deriveAttackOptionalCostBoost(
        `You may ${cost}. If you discarded any cards in this way, this attack does 120 more damage.`,
      );
    expect(at("discard your hand")).not.toBeNull();
    expect(at("discard 3 cards from your hand")).toBeNull();
    // The SEAT: the printed subject is "you", and the opponent's hand is neither this
    // op nor this member.
    expect(at("discard your opponent's hand")).toBeNull();
    // The ZONE: a shuffle is `handRefresh`, not `discardHand`.
    expect(at("shuffle your hand into your deck")).toBeNull();
    // The VERB, lowercase at its own anchor.
    expect(at("Discard your hand")).toBeNull();
  });

  it("the two OTHER cost rows accept the NEW connective, which is what makes it one reading", () => {
    const swapped = (text: string) =>
      text.replace(". If you do,", ". If you discarded any cards in this way,");
    expect(deriveAttackOptionalCostBoost(swapped(CRUSHING_PRESS))).toEqual(
      deriveAttackOptionalCostBoost(CRUSHING_PRESS),
    );
    expect(deriveAttackOptionalCostBoost(swapped(TORRENTIAL))).toEqual(
      deriveAttackOptionalCostBoost(TORRENTIAL),
    );
    expect(deriveAttackOptionalCostBoost(swapped(PRIZE_FLIP))).toEqual(
      deriveAttackOptionalCostBoost(PRIZE_FLIP),
    );
    expect(deriveAttackOptionalCostBoost(PRIZE_FLIP)).not.toBeNull();
    expect(resolvedByAnyReader(PRIZE_FLIP)).toBe(true);
    const theirs = PRIZE_FLIP.replace("of your face-down", "of your opponent's face-down");
    expect(deriveAttackOptionalCostBoost(theirs)).toBeNull();
    expect(deriveAttackOptionalCostBoost(swapped(theirs))).toBeNull();
  });

  it("the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(PURGING), read.name).toBeNull();
    }
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${PURGING}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${PURGING} Draw a card.`)).toBeNull();
  });
});

describe("§3 — `yourHandNotEmpty`, and the EQUIVALENCE that licenses the connective", () => {
  it.each(SEEDS)("seed %i — `> 0` and not `>= 0`: 0, 1 and 2 cards each read", (seed) => {
    const state = board(seed);
    for (const size of [0, 1, 2]) {
      expect(conditionHolds(setHandSize(state, "p1", size), "p1", HAND_NOT_EMPTY), `${size}`).toBe(
        size > 0,
      );
    }
    expect(state.players.p1.hand.length).toBeGreaterThan(0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
  });

  it.each(SEEDS)("seed %i — it is SEAT-RELATIVE, and a one-seat board cannot say so", (seed) => {
    // The member is read from the ATTACKER's seat; a suite that only ever asked p1
    // could not tell "reads the attacker's hand" from "reads p1's hand". Empty ONE
    // hand and read BOTH seats.
    const state = setHandSize(board(seed), "p1", 0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(false);
    expect(conditionHolds(state, "p2", HAND_NOT_EMPTY)).toBe(true);
    const mirrored = setHandSize(board(seed), "p2", 0);
    expect(conditionHolds(mirrored, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(mirrored, "p2", HAND_NOT_EMPTY)).toBe(false);
  });

  it("the near misses are computed BESIDE it, on a board where they disagree", () => {
    const state = setHandSize(setHandSize(board(SEEDS[0]), "p1", 2), "p2", 0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 2 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 1 })).toBe(false);
    const one = setHandSize(state, "p1", 1);
    expect(conditionHolds(one, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(one, "p1", { kind: "yourHandExactly", count: 2 })).toBe(false);
    // The far-seat sibling reads P2's empty hand and answers TRUE at every threshold —
    // the opposite polarity on the opposite seat.
    expect(conditionHolds(state, "p1", { kind: "opponentHandAtMost", count: 0 })).toBe(true);
    // …and the symmetric one is FALSE here, so no board below can be passing through it.
    expect(conditionHolds(state, "p1", { kind: "handSizesEqual" })).toBe(false);
  });

  it("THE OBLIGATION EVERY COST ROW INHERITS: `cond` is the cost's EXACT payability", () => {
    const rows = [PURGING, CRUSHING_PRESS, TORRENTIAL] as const;
    for (const text of rows) {
      const reading = deriveAttackOptionalCostBoost(text);
      if (reading === null) throw new Error(`expected a reading for ${text}`);
      expect(reading.ops.length, text).toBeGreaterThan(0);
      expect(reading.cond, text).not.toBeUndefined();
    }
    const state = setHandSize(board(SEEDS[0]), "p1", 1);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(state.players.p1.hand).toHaveLength(1);
    const done = say(attack(state).state, true);
    expect(findEvent(done.events, "HAND_DISCARDED")?.uids).toHaveLength(1);
  });

  it("the note is a reject pill, and it is a LITERAL because the member is nullary", () => {
    expect(conditionNote(HAND_NOT_EMPTY)).toBe("you have at least 1 card in your hand");
    expect(conditionNote(HAND_NOT_EMPTY)).not.toContain("in this way");
    // The sibling's pill, for the contrast the two are one line apart in the switch.
    expect(conditionNote({ kind: "yourHandExactly", count: 3 })).toBe(
      "you have exactly 3 cards in your hand",
    );
  });
});

describe("§4 — the program: D381's arm, and BOTH `otherwise`s carry the printed base", () => {
  const reading = () => {
    const parsed = deriveAttackOptionalCostBoost(PURGING);
    if (parsed === null) throw new Error("expected the reading");
    return parsed;
  };

  it("pins the assembly byte-for-byte: the gate, the confirm, the discard, the 240", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "yourHandNotEmpty" },
        then: [
          {
            op: "optional",
            note: PURGING,
            then: [{ op: "discardHand" }, { op: "damageDefender", amount: 240 }],
            otherwise: [{ op: "damageDefender", amount: 120 }],
          },
        ],
        otherwise: [{ op: "damageDefender", amount: 120 }],
      },
    ];
    expect(optionalCostBoostProgram(reading(), 120, PURGING)).toEqual(expected);
  });

  it("the COST goes IN FRONT of the hit, which is `boostedArms`' order REVERSED", () => {
    const gate = optionalCostBoostProgram(reading(), 120, PURGING)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.then.map((o) => o.op)).toEqual(["discardHand", "damageDefender"]);
  });

  it("the two decline arms are DISTINCT OBJECTS, so the program is a tree", () => {
    const gate = optionalCostBoostProgram(reading(), 120, PURGING)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toEqual(gate.otherwise);
    expect(ask.otherwise).not.toBe(gate.otherwise);
  });

  it("the base VARIES the program, which is what says the payoff RE-HOMES it", () => {
    const at = (base: number) => optionalCostBoostProgram(reading(), base, PURGING);
    expect(at(30)).not.toEqual(at(120));
    const torrent = deriveAttackOptionalCostBoost(TORRENTIAL);
    if (torrent === null) throw new Error("expected D383's reading");
    expect(optionalCostBoostProgram(torrent, 30, TORRENTIAL)).toEqual(
      optionalCostBoostProgram(torrent, 120, TORRENTIAL),
    );
  });
});

describe("§5 — the board: the hand reaches the DISCARD PILE, and the hit is 240", () => {
  it.each(SEEDS)(
    "seed %i — YES: the whole hand is discarded and the Defender takes 240",
    (seed) => {
      const before = board(seed);
      const hand = before.players.p1.hand;
      expect(hand.length).toBeGreaterThan(0);
      const pileBefore = before.players.p1.discard.length;

      const parked = attack(before);
      expect(types(parked.events)).not.toContain("DAMAGE_DEALT");
      expect(types(parked.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(parked.state.phase.kind).toBe("effect:choose");
      expect(findEvent(parked.events, "EFFECT_PENDING")).toEqual({
        type: "EFFECT_PENDING",
        seat: "p1",
        note: PURGING,
      });

      const done = say(parked.state, true);
      expect(done.state.players.p1.hand).toEqual([]);
      expect(done.state.players.p1.discard).toHaveLength(pileBefore + hand.length);
      for (const uid of hand) expect(done.state.players.p1.discard).toContain(uid);
      expect(findEvent(done.events, "HAND_DISCARDED")).toEqual({
        type: "HAND_DISCARDED",
        seat: "p1",
        uids: [...hand],
      });
      // …and the boosted hit, ONCE.
      expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({
        seat: "p2",
        base: 240,
        dealt: 240,
      });
      expect(done.state.players.p2.active?.damage).toBe(240);
      expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    },
  );

  it.each(SEEDS)("seed %i — NO: the hand stays put and the printed 120 still lands", (seed) => {
    const before = board(seed);
    const hand = before.players.p1.hand;
    const pileBefore = before.players.p1.discard.length;
    const done = say(attack(before).state, false);
    expect(done.state.players.p1.hand).toEqual(hand);
    expect(done.state.players.p1.discard).toHaveLength(pileBefore);
    expect(types(done.events)).not.toContain("HAND_DISCARDED");
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      dealt: 120,
    });
    expect(done.state.players.p2.active?.damage).toBe(120);
  });
});

describe("§6 — the gate, driven from the REAL printing on an ORDINARY board", () => {
  it.each(SEEDS)("seed %i — an EMPTY HAND is never offered, and the 120 still lands", (seed) => {
    const before = setHandSize(board(seed), "p1", 0);
    expect(conditionHolds(before, "p1", HAND_NOT_EMPTY)).toBe(false);
    const done = attack(before);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(types(done.events)).not.toContain("EFFECT_PENDING");
    expect(types(done.events)).not.toContain("HAND_DISCARDED");
    expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      dealt: 120,
    });
    expect(done.state.players.p2.active?.damage).toBe(120);
    // …and the CONTROL: the same board, the same seed, ONE card in hand — offered.
    const one = setHandSize(board(seed), "p1", 1);
    expect(attack(one).state.phase.kind).toBe("effect:choose");
  });

  it.each(SEEDS)(
    "seed %i — ONE card is the boundary, and it pays the FULL printed bonus",
    (seed) => {
      // The boundary the gate is drawn at, driven rather than described: a hand of one
      // is payable and buys the whole +120 — the printed sentence says *"any cards"*,
      // not *"all of them"*, so there is no proportionality anywhere in this reading.
      const before = setHandSize(board(seed), "p1", 1);
      const done = say(attack(before).state, true);
      expect(findEvent(done.events, "HAND_DISCARDED")?.uids).toHaveLength(1);
      expect(done.state.players.p1.hand).toEqual([]);
      expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ base: 240, dealt: 240 });
    },
  );
});
