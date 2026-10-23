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
import type { EffectOp, GameState, Seat } from "./index";
import {
  OPTIONAL_COST_BOOST_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
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

const CETITAN = "You may discard a Stadium in play. If you do, this attack does 140 more damage.";

const STILL_OWED: Readonly<Record<string, string>> = {};

const TAKEN_SINCE = {
  energy:
    "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  prize:
    "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)",
} as const;

const FAMILY = /^You may .*If you do,/;

const HAND_DISCARD =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";
const BEACH_COURT = "sv01-167";
const NEUTRALIZATION_ZONE = "sv06.5-060";

// ── boards ─────────────────────────────────────────────────────────────────────

function playStadium(state: GameState, seat: Seat, stadiumId: string): GameState {
  const withCard = handFromDeck(state, seat, stadiumId, 1);
  const uid = handUid(withCard, seat, stadiumId);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

function board(seed: number, stadiumId: string | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: OPTIONAL_COST_BOOST_DECK, p2: OPTIONAL_COST_BOOST_DECK },
    { first: "p2" },
  );
  if (stadiumId !== null) state = playStadium(state, "p2", stadiumId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", "fix-crushpress");
  state = attachFromDeck(state, "p1", "fix-water-energy", 3);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return state;
}

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

const SEEDS = [7001, 7013, 7027] as const;

describe("§1 — the price, MEASURED IN REFUSED SENTENCES, before and after", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the family is 7 sentences / 14 printings, and it partitions 5 forward / 2 reversed… ", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    expect([family.length, units(family)]).toEqual([7, 14]);
    const forward = family.filter(([, s]) => deriveAttackOptionalBoost(s) !== null);
    expect([forward.length, units(forward)]).toEqual([4, 5]);
    const reversed = family.filter(([, s]) => deriveAttackOptionalCostBoost(s) !== null);
    expect([reversed.length, units(reversed)]).toEqual([3, 9]);
    for (const [, s] of family) {
      expect(
        [deriveAttackOptionalBoost(s), deriveAttackOptionalCostBoost(s)].filter((r) => r !== null)
          .length,
        s,
      ).toBeLessThan(2);
    }
  });

  it("…the refused half went 3 sentences / 9 printings → 1 / 2, in TWO slices", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect(refused.map(([, s]) => s)).toEqual([]);
    expect(Object.values(STILL_OWED)).toHaveLength(0);
    expect(resolvedByAnyReader(TAKEN_SINCE.prize)).toBe(true);
    const withoutThisReader = (text: string): boolean =>
      READERS.filter((read) => read !== deriveAttackOptionalCostBoost).some(
        (read) => read(text) !== null,
      );
    const before = family.filter(([, s]) => !withoutThisReader(s));
    expect([before.length, units(before)]).toEqual([3, 9]);
    expect(
      before
        .filter(([, s]) => !refused.some(([, r]) => r === s))
        .map(([, s]) => s)
        .sort(),
    ).toEqual([CETITAN, TAKEN_SINCE.energy, TAKEN_SINCE.prize].sort());
  });

  it("the sentence carries TWO printings, and no near spelling hides behind it", () => {
    const rows = corpus().filter(([, s]) => s === CETITAN);
    expect([rows.length, units(rows)]).toEqual([1, 2]);
    const both = corpus().filter(([, s]) => s.includes("If you do,") && s.includes("Stadium"));
    expect(both.map(([, s]) => s)).toEqual([CETITAN]);
    const offered = corpus().filter(([, s]) => /^You may discard .{0,20}stadium/i.test(s));
    expect([offered.length, units(offered)]).toEqual([2, 4]);
    expect(offered.map(([, s]) => s).sort()).toEqual(
      ["You may discard a Stadium in play.", CETITAN].sort(),
    );
  });

  it("…and the FAMILY IS EIGHT WHEN THE CONNECTIVE IS SHORTENED, not seven", () => {
    const strict = corpus().filter(([, s]) => FAMILY.test(s));
    const wide = corpus().filter(([, s]) => /^You may .*\. If /.test(s));
    expect([strict.length, units(strict)]).toEqual([7, 14]);
    expect([wide.length, units(wide)]).toEqual([8, 15]);
    const extra = wide.filter(([, s]) => !strict.some(([, t]) => t === s));
    expect(extra.map(([n, s]) => [n, s])).toEqual([[1, HAND_DISCARD]]);
    expect(resolvedByAnyReader(HAND_DISCARD)).toBe(true);
    expect(deriveAttackOptionalCostBoost(HAND_DISCARD)).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard your hand. If you do, this attack does 120 more damage.",
      ),
    ).toEqual(deriveAttackOptionalCostBoost(HAND_DISCARD));
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your face-down Prize cards face up. If you discarded any cards in this way, this attack does 80 more damage.",
      ),
    ).toEqual(deriveAttackOptionalCostBoost(TAKEN_SINCE.prize));
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your opponent's face-down Prize cards face up. If you discarded any cards in this way, this attack does 80 more damage.",
      ),
    ).toBeNull();
  });
});

describe("§2 — BOTH halves dispatched, and each refusal driven from OUTSIDE the population", () => {
  it("the printed sentence reads as a precondition, a cost and a DISPATCHED payoff", () => {
    expect(deriveAttackOptionalCostBoost(CETITAN)).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      payoff: { kind: "moreDamage", bonus: 140 },
    });
  });

  it("D383 — and the SECOND printed payoff reads as the SAME shape, one row over", () => {
    expect(deriveAttackOptionalCostBoost(TAKEN_SINCE.energy)).toEqual({
      // The one new `BoardCondition` member, carrying the digit the anchor CAPTURED.
      cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: 3,
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "benchSnipe", amount: 120, count: 1 },
    });
  });

  it("the COST half's refusal is the COST's, not the reminder text's", () => {
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toEqual(deriveAttackOptionalCostBoost(TAKEN_SINCE.prize));
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your opponent's face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 2 of your face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to your opponent's Active Pokémon into your deck. If you do, this attack does 120 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to this Pokémon into your discard pile. If you do, this attack does 120 more damage.",
      ),
    ).toBeNull();
    // …and the control that makes those refusals mean something: the SAME payoff
    // behind the cost the table DOES read, at a captured count of 2.
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 2 Energy attached to this Pokémon into your deck. If you do, this attack does 120 more damage.",
      ),
    ).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 2 },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: 2,
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack does 80 more damage.",
      ),
    ).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      payoff: { kind: "moreDamage", bonus: 80 },
    });
  });

  it("the PAYOFF half's refusal is the PAYOFF's, on a cost the table reads", () => {
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 120 damage to 1 of your opponent's Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 120 damage to each of your opponent's Benched Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost("You may discard a Stadium in play. If you do, draw 3 cards."),
    ).toBeNull();
    // …and the printed 0 guard on the SECOND payoff too, which has its own captured
    // amount and therefore its own `>= 1`.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toBeNull();
    // A printed 0 buys nothing — the guard every captured amount in effects.ts carries,
    // and here it is the whole stake: a Stadium charged for no extra damage.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack does 0 more damage.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE at BOTH ends, so a compound printing is refused", () => {
    expect(Object.values(STILL_OWED)).toHaveLength(0);
    for (const sentence of Object.values(STILL_OWED)) {
      expect(deriveAttackOptionalCostBoost(sentence), sentence).toBeNull();
    }
    expect(deriveAttackOptionalCostBoost(TAKEN_SINCE.energy)).not.toBeNull();
    expect(deriveAttackOptionalCostBoost(TAKEN_SINCE.prize)).not.toBeNull();
    expect(deriveAttackOptionalCostBoost(`${TAKEN_SINCE.prize} Draw a card.`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${CETITAN}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${CETITAN} Draw a card.`)).toBeNull();
    expect(deriveAttackOptionalCostBoost("You may discard a Stadium in play.")).toBeNull();
  });

  it("the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(CETITAN), read.name).toBeNull();
    }
    for (const [, s] of corpus().filter(([, s]) => deriveAttackOptionalBoost(s) !== null)) {
      expect(deriveAttackOptionalCostBoost(s), s).toBeNull();
    }
  });
});

describe("§3 — the program, pinned byte-for-byte: two gates, and BOTH carry a decline arm", () => {
  it("the cost is spliced IN FRONT of the boosted hit, and both declines deal the base", () => {
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        ops: [
          {
            op: "optional",
            note: CETITAN,
            ops: [{ op: "discardStadium" }, { op: "damageDefender", amount: 280 }],
            otherwise: [{ op: "damageDefender", amount: 140 }],
          },
        ],
        otherwise: [{ op: "damageDefender", amount: 140 }],
      },
    ];
    expect(optionalCostBoostProgram(reading, 140, CETITAN)).toEqual(expected);
  });

  it("the DECLINE arm is the printed base and NOT nothing, on both gates", () => {
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    const gate = optionalCostBoostProgram(reading, 140, CETITAN)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    expect(gate.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
    const ask = gate.ops[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
    // The confirm's note is the WHOLE printed sentence and not a re-voicing — the op's
    // own contract, and what the dialog shows.
    expect(ask.note).toBe(CETITAN);
  });

  it("the base TRACKS the attack rather than being pinned, and the bonus is CAPTURED", () => {
    for (const trial of [0, 30, 140, 250]) {
      const reading = deriveAttackOptionalCostBoost(CETITAN);
      if (reading === null) throw new Error("expected the reading");
      const gate = optionalCostBoostProgram(reading, trial, CETITAN)[0];
      if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
      expect(gate.otherwise).toEqual([{ op: "damageDefender", amount: trial }]);
      const ask = gate.ops[0];
      if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
      expect(ask.ops[1]).toEqual({ op: "damageDefender", amount: trial + 140 });
    }
  });
});

describe("§4 — the board: the printed ORDER, on the one Stadium that can see it", () => {
  it.each(SEEDS)("seed %i — Beach Court: YES discards to the OWNER and deals 280", (seed) => {
    const before = board(seed, BEACH_COURT);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadium.owner).toBe("p2");
    const parked = attack(before);
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(findEvent(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: CETITAN,
    });
    expect(types(parked.events)).not.toContain("DAMAGE_DEALT");

    const done = say(parked.state, true);
    expect(done.state.stadium).toBeNull();
    expect(done.state.players.p2.discard).toEqual([
      ...parked.state.players.p2.discard,
      stadium.uid,
    ]);
    expect(done.state.players.p1.discard).toEqual(parked.state.players.p1.discard);
    expect(findEvent(done.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
    expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it.each(SEEDS)(
    "seed %i — NEUTRALIZATION ZONE: the order is observable, and it is 280",
    (seed) => {
      const before = board(seed, NEUTRALIZATION_ZONE);
      const stadium = before.stadium;
      if (stadium === null) throw new Error("expected P2's Stadium in the zone");
      const defender = before.players.p2.active;
      if (defender === null) throw new Error("expected P2's Active");
      expect(defender.damage).toBe(0);

      const done = say(attack(before).state, true);
      expect(done.state.stadium).toBeNull();
      expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
      const after = done.state.players.p2.active;
      if (after === null) throw new Error("expected P2's Active");
      expect(after.damage).toBe(280);
    },
  );

  it.each(SEEDS)(
    "seed %i — and the CONTROL: the same Zone with the confirm DECLINED deals 0",
    (seed) => {
      // The other end of the same board, and it is what proves the 280 above came from
      // the DISCARD rather than from the Zone never mattering: decline, the Zone stays,
      // and the printed 140 is prevented in full.
      const before = board(seed, NEUTRALIZATION_ZONE);
      const stadium = before.stadium;
      if (stadium === null) throw new Error("expected P2's Stadium in the zone");
      const done = say(attack(before).state, false);
      expect(done.state.stadium).toEqual(stadium);
      expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0 });
      const after = done.state.players.p2.active;
      if (after === null) throw new Error("expected P2's Active");
      expect(after.damage).toBe(0);
    },
  );
});

describe("§5 — the confirm: a decline still deals the base, and an empty zone is not asked", () => {
  it.each(SEEDS)("seed %i — NO leaves the Stadium alone and deals the printed 140", (seed) => {
    const before = board(seed, BEACH_COURT);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const done = say(attack(before).state, false);
    expect(done.state.stadium).toEqual(stadium);
    expect(done.state.players.p2.discard).not.toContain(stadium.uid);
    expect(types(done.events)).not.toContain("STADIUM_DISCARDED");
    // …and the rung a dropped `optional.otherwise` reddens on.
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 140 });
  });

  it.each(SEEDS)(
    "seed %i — an EMPTY zone is not asked at all, and pays 140 rather than 280",
    (seed) => {
      const before = board(seed, null);
      expect(before.stadium).toBeNull();
      const result = attack(before);
      expect(result.state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).not.toContain("EFFECT_PENDING");
      expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // The gate refuses the QUESTION, never the attack — the rung a dropped
      // `conditionGate.otherwise` reddens on.
      expect(findEvent(result.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 140 });
    },
  );

  it.each(SEEDS)(
    "seed %i — ONE §8.5 hit, never two: exactly one DAMAGE_DEALT per answer",
    (seed) => {
      for (const yes of [true, false]) {
        const done = say(attack(board(seed, BEACH_COURT)).state, yes);
        expect(types(done.events).filter((t) => t === "DAMAGE_DEALT")).toHaveLength(1);
      }
      const empty = attack(board(seed, null));
      expect(types(empty.events).filter((t) => t === "DAMAGE_DEALT")).toHaveLength(1);
    },
  );
});

describe("§6 — what this slice did NOT buy", () => {
  it("the ONE remaining printing stays LOUD, waiting on a named mechanism ( D548: NONE remains — the mechanism was built)", () => {
    expect(Object.values(STILL_OWED)).toHaveLength(0);
    for (const sentence of Object.values(STILL_OWED)) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(false);
    }
    const left = corpus().filter(([, s]) =>
      (Object.values(STILL_OWED) as readonly string[]).includes(s),
    );
    expect([left.length, units(left)]).toEqual([0, 0]);
    expect(
      corpus()
        .filter(([, s]) => s === TAKEN_SINCE.prize)
        .map(([n]) => n),
    ).toEqual([2]);
    expect(resolvedByAnyReader(TAKEN_SINCE.prize)).toBe(true);
    expect(resolvedByAnyReader(TAKEN_SINCE.energy)).toBe(true);
    expect(
      corpus()
        .filter(([, s]) => s === TAKEN_SINCE.energy)
        .map(([n]) => n),
    ).toEqual([5]);
  });

  it("bought no new op and no new BoardCondition member — every step already existed", () => {
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    expect(deriveAttackEffect("Discard a Stadium in play.")).toEqual(reading.ops);
    expect(reading.cond).toEqual({ kind: "stadiumInPlay" });
  });

  it("bought no registry row — the reading reaches the board through attack text only", () => {
    const rows = corpus().filter(([, s]) => s === CETITAN);
    expect(units(rows)).toBe(2);
    expect(rows).toHaveLength(1);
  });
});
