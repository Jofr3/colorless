import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  CONDITIONAL_DAMAGE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  types,
} from "./testFixtures";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const EARTHEN_POWER = "If you have a Stadium in play, this attack does 80 more damage.";
const REVENGEFUL_STORM =
  "If you have more Prize cards remaining than your opponent, this attack does 100 more damage.";
const TYRANNICAL_TAIL =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.";
const CROSS_CUT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.";

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: CONDITIONAL_DAMAGE_DECK, p2: CONDITIONAL_DAMAGE_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Put a Beach Court into `seat`'s hand and play it — the Stadium zone then
    carries `owner: seat`, which is the ONLY thing "you have a Stadium in play"
    reads (boardCondition.test.ts's helper, reused). */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "sv01-167", 1);
  const uid = handUid(withCard, seat, "sv01-167");
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on all four cards", () => {
    expect(FIXTURE_POOL["sv02-096"]?.attacks?.[1]?.effect).toBe(EARTHEN_POWER);
    expect(FIXTURE_POOL["sv02-043"]?.attacks?.[0]?.effect).toBe(REVENGEFUL_STORM);
    expect(FIXTURE_POOL["sv01-045"]?.attacks?.[1]?.effect).toBe(TYRANNICAL_TAIL);
    expect(FIXTURE_POOL["sv02-137"]?.attacks?.[1]?.effect).toBe(CROSS_CUT);
    // And the printed "+" markers the modifier assertions below turn off.
    expect(FIXTURE_POOL["sv02-096"]?.attacks?.[1]?.damage).toBe("80+");
    expect(FIXTURE_POOL["sv02-043"]?.attacks?.[0]?.damage).toBe("80+");
    expect(FIXTURE_POOL["sv01-045"]?.attacks?.[1]?.damage).toBe("180+");
    expect(FIXTURE_POOL["sv02-137"]?.attacks?.[1]?.damage).toBe("50+");
  });

  it("carries ASCII apostrophes and a real U+00E9 é — the byte facts", () => {
    // The two cross-board clauses are the only ones with either character, and
    // both are exactly where a re-ingest would drift.
    for (const text of [TYRANNICAL_TAIL, CROSS_CUT]) {
      expect(text).toContain("Pokémon");
      expect(text).not.toContain("’");
      expect(text).toContain("opponent's");
    }
    expect(EARTHEN_POWER).not.toContain("'");
    expect(REVENGEFUL_STORM).not.toContain("'");
  });
});

describe("deriveAttackDamageBonus — the conditional flat bonus, all four clauses", () => {
  it("reads Earthen Power as yourStadiumInPlay (an ALREADY-existing member)", () => {
    expect(deriveAttackDamageBonus(EARTHEN_POWER)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourStadiumInPlay" } },
    });
  });

  it("reads Revengeful Storm as morePrizesThanOpponent (the other reused member)", () => {
    expect(deriveAttackDamageBonus(REVENGEFUL_STORM)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "morePrizesThanOpponent" } },
    });
  });

  it("reads Tyrannical Tail as opponentActiveDamaged", () => {
    expect(deriveAttackDamageBonus(TYRANNICAL_TAIL)).toEqual({
      per: 180,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveDamaged" } },
    });
  });

  it("reads Cross-Cut as opponentActiveIsEvolution", () => {
    expect(deriveAttackDamageBonus(CROSS_CUT)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
    });
  });

  it("captures the printed N rather than hard-coding one per clause", () => {
    // The same clause at a different amount — Meowscarada ex's +60 shares
    // Tyrannical Tail's condition, so nothing may key the amount off the clause.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage.",
      ),
    ).toEqual({
      per: 60,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveDamaged" } },
    });
  });

  it("still reads the three `for each` arms — the new arm is LAST, not first", () => {
    // The conditional arm's clause capture is the loosest pattern in the reader,
    // so this pins that it did not shadow the exact ones it sits behind.
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnSelf" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentActiveRetreatCost" } });
  });
});

describe("deriveAttackDamageBonus — the anchor guards (everything else stays LOUD)", () => {
  it("refuses the coin-flip rider, the near-misses and an UNMAPPED clause", () => {
    for (const text of [
      "Flip a coin. If heads, this attack does 20 more damage.",
      // A lowercase leading "if" — refused independently of the anchors (no /i).
      "if you have a Stadium in play, this attack does 80 more damage.",
      // No trailing period is not the whole sentence.
      "If you have a Stadium in play, this attack does 80 more damage",
      // A real trailing clause pins `$`.
      "If you have a Stadium in play, this attack does 80 more damage. Then, draw a card.",
      // Leading text pins `^` (a constructed probe — the pool's real leading-text
      // case is Cresselia's "You may turn 1 of your face-down Prize cards face
      // up. If you do, …", whose "if you do" reads a CHOICE, not the board).
      "Draw a card. If you have a Stadium in play, this attack does 80 more damage.",
      // A printed 0 adds nothing — the guard every arm in this family carries.
      "If you have a Stadium in play, this attack does 0 more damage.",
      "If this Pokémon evolved from Nymble during this turn, this attack does 100 more damage.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });

  it("does NOT match a `less damage` twin — the pool prints none, and neither do we", () => {
    expect(
      deriveAttackDamageBonus("If you have a Stadium in play, this attack does 80 less damage."),
    ).toBeNull();
  });
});

describe("the two derivers stay disjoint", () => {
  it("deriveAttackEffect matches none of the four sentences", () => {
    // The op deriver reads sentences that run AFTER damage; this family folds
    // BEFORE the §8.5 pipeline. No text may derive twice.
    for (const text of [EARTHEN_POWER, REVENGEFUL_STORM, TYRANNICAL_TAIL, CROSS_CUT]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // The control from the SAME card: Gyarados's second attack does derive — as an
    // op, and only through deriveAttackEffect.
    const recoil = "This Pokémon also does 50 damage to itself.";
    expect(FIXTURE_POOL["sv02-043"]?.attacks?.[1]?.effect).toBe(recoil);
    expect(deriveAttackEffect(recoil)).toEqual([{ op: "damageSelf", amount: 50 }]);
    expect(deriveAttackDamageBonus(recoil)).toBeNull();
  });

  it("deriveAttackDamageMultiplier refuses all four — the no-'more' twin owns nothing here", () => {
    // Verified against the pool: there is no "If …, this attack does N damage."
    // (no-"more") print, so the multiply reader is deliberately untouched.
    for (const text of [EARTHEN_POWER, REVENGEFUL_STORM, TYRANNICAL_TAIL, CROSS_CUT]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });
});

describe("Palossand 'Earthen Power' — yourStadiumInPlay, read for the ATTACKER", () => {
  /** P1 fields Palossand with {P}{C}{C} paid, against the pinned neutral Active. */
  function earthenPower(state: GameState): GameState {
    const fielded = setActiveFromDeck(state, "p1", "sv02-096");
    return pay(fielded, "p1", [
      ["fix-psychic-energy", 1],
      ["fix-energy", 2],
    ]);
  }

  it("with an EMPTY Stadium zone the printed 80 stands — and nothing is flagged", () => {
    const state = earthenPower(board(1));
    expect(state.stadium).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The condition is FALSE and the "+" is still simulated: `effectSimulated` /
    // `modifierSimulated` both ride `scaling !== null`, not on the clause holding.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 80, dealt: 80 });
    // `scaled` is omitted at 0 — the clause genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 80 once the ATTACKER has a Stadium out", () => {
    // The additive family keeps its printed base, so "80+" is 80 + 80 = 160 — well
    // inside the neutral defender's 200 HP, so the arithmetic stands alone.
    const state = playStadium(earthenPower(board(2)), "p1");
    expect(state.stadium?.owner).toBe("p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 80, dealt: 160 });
  });

  it("is OWNERSHIP, not presence — the OPPONENT's Beach Court in the shared zone does not count", () => {
    // The Stadium ZONE is shared: the same card, in the same slot, played by P2.
    // P2 goes first, plays it on its own turn 1, then passes into P1's turn 2.
    let state = driveSetup(
      3,
      { p1: CONDITIONAL_DAMAGE_DECK, p2: CONDITIONAL_DAMAGE_DECK },
      { first: "p2" },
    );
    state = playStadium(state, "p2");
    expect(state.stadium?.owner).toBe("p2");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = earthenPower(state);

    expect(state.stadium?.owner).toBe("p2");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Back to the printed 80 — and still not flagged.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 80, dealt: 80 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("Gyarados 'Revengeful Storm' — morePrizesThanOpponent, the §14 comeback", () => {
  /** P1 fields Gyarados with {W}{C}{C} paid. */
  function revengefulStorm(state: GameState): GameState {
    const fielded = setActiveFromDeck(state, "p1", "sv02-043");
    return pay(fielded, "p1", [
      ["fix-water-energy", 1],
      ["fix-energy", 2],
    ]);
  }

  it("adds nothing at EQUAL prizes — the condition is STRICT", () => {
    const state = revengefulStorm(board(4));
    expect(state.players.p1.prizes.length).toBe(state.players.p2.prizes.length);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, dealt: 80 });
  });

  it("adds 100 once the ATTACKER is ahead on prizes REMAINING (behind on prizes taken)", () => {
    // P2 has taken 2 (4 left) against P1's 6 — P1 is the one BEHIND, which is what
    // "more Prize cards remaining" means. 80 + 100 = 180, inside the 200 HP body.
    const state = setPrizes(revengefulStorm(board(5)), "p2", 4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 100, dealt: 180 });
  });

  it("is the ATTACKER's seat, not the defender's — the asymmetry, run backwards", () => {
    const state = setPrizes(revengefulStorm(board(5)), "p1", 4);
    expect(conditionHolds(state, "p2", { kind: "morePrizesThanOpponent" })).toBe(true);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, dealt: 80 });
  });
});

describe("Gyarados ex 'Tyrannical Tail' — opponentActiveDamaged, read at DECLARATION", () => {
  /** P1 fields Gyarados ex with the cast's deepest cost paid — {W}{W}{W}{C}{C}. */
  function tyrannicalTail(state: GameState): GameState {
    const fielded = setActiveFromDeck(state, "p1", "sv01-045");
    return pay(fielded, "p1", [
      ["fix-water-energy", 3],
      ["fix-energy", 2],
    ]);
  }

  it("vs an UNDAMAGED Active the printed 180 stands — the attack cannot bootstrap itself", () => {
    // THE reading of the printed "already": the indicator is evaluated before this
    // attack's own damage lands, so an undamaged defender takes 180, NOT 360. A
    // post-damage read would double every opening hit in the game.
    const state = tyrannicalTail(board(6));
    expect(state.players.p2.active?.damage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 180, dealt: 180 });
    expect(dealt?.scaled).toBeUndefined();
    // And the defender really did end up damaged — the state the SECOND attack of
    // a real game would read, which is the only way this bonus is ever earned.
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(180);
  });

  it("vs an ALREADY damaged Active it adds the whole 180 → 360", () => {
    // One counter is enough — "any damage counters on it" carries no threshold.
    const state = setDamage(tyrannicalTail(board(7)), "p2", 10);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, scaled: 180, dealt: 360 });
  });

  it("reads the OPPONENT's Active — damage on the ATTACKER's own body scores nothing", () => {
    // Cross-board by construction: the same 10 counters, on the wrong side.
    const state = setDamage(tyrannicalTail(board(8)), "p1", 10);
    expect(state.players.p2.active?.damage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, dealt: 180 });
  });
});

describe("Seviper 'Cross-Cut' — opponentActiveIsEvolution, the D105 reading", () => {
  /** P1 fields Seviper with {D}{C} paid. */
  function crossCut(state: GameState): GameState {
    const fielded = setActiveFromDeck(state, "p1", "sv02-137");
    return pay(fielded, "p1", [
      ["fix-dark-energy", 1],
      ["fix-energy", 1],
    ]);
  }

  it("vs a BASIC Active the printed 50 stands", () => {
    // fix-bigbody: a Basic, Colorless, no Weakness and no Resistance — so the
    // number is the fold and nothing else.
    const state = crossCut(board(9));
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs an EVOLUTION Active it adds 50 → 100", () => {
    const state = setActiveFromDeck(crossCut(board(10)), "p2", "sv02-043");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, scaled: 50, dealt: 100 });
  });

  it("folds the bonus BEFORE §8.5 Weakness — (base + scaled) is what doubles", () => {
    const state = setActiveFromDeck(crossCut(board(11)), "p2", "sv02-096");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 50,
      scaled: 50,
      weakness: { op: "multiply", amount: 2 },
      dealt: 200,
    });
  });
});

describe("conditionHolds / conditionNote — the two NEW members, directly", () => {
  it("opponentActiveDamaged is cross-board, per seat, and 0-exclusive", () => {
    const clean = board(12);
    expect(clean.players.p1.active?.damage).toBe(0);
    expect(clean.players.p2.active?.damage).toBe(0);
    expect(conditionHolds(clean, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "opponentActiveDamaged" })).toBe(false);

    // Damage on P2's Active is P1's condition, not P2's own — both directions off
    // one board, which is what a mis-scoped `state.players[seat]` would fail.
    const hurt = setDamage(clean, "p2", 10);
    expect(conditionHolds(hurt, "p1", { kind: "opponentActiveDamaged" })).toBe(true);
    expect(conditionHolds(hurt, "p2", { kind: "opponentActiveDamaged" })).toBe(false);

    // Mirrored: damage on P1's Active is P2's condition.
    const mirrored = setDamage(clean, "p1", 10);
    expect(conditionHolds(mirrored, "p2", { kind: "opponentActiveDamaged" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
  });

  it("opponentActiveIsEvolution reads the stack TOP, both seats, and is false with no Active", () => {
    const basics = board(13);
    expect(conditionHolds(basics, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);
    expect(conditionHolds(basics, "p2", { kind: "opponentActiveIsEvolution" })).toBe(false);

    // A Stage 1 opposite P1 satisfies it for P1 only.
    const evolved = setActiveFromDeck(basics, "p2", "sv02-096");
    expect(conditionHolds(evolved, "p1", { kind: "opponentActiveIsEvolution" })).toBe(true);
    expect(conditionHolds(evolved, "p2", { kind: "opponentActiveIsEvolution" })).toBe(false);

    // And mirrored onto the other seat — nothing here is P1-shaped.
    const mirrored = setActiveFromDeck(basics, "p1", "sv01-045");
    expect(conditionHolds(mirrored, "p2", { kind: "opponentActiveIsEvolution" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw. Unreachable through `attack` (the
    // gate requires a Defending Pokémon), so only a direct call finds it.
    const empty = clearActive(evolved, "p2");
    expect(empty.players.p2.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);
    expect(conditionHolds(empty, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
  });

  it("names both new conditions in the reject/tooltip vocabulary", () => {
    // Neither is reachable from a play gate today (both arrive through attack
    // text), so nothing else would catch a typo in the copy.
    expect(conditionNote({ kind: "opponentActiveDamaged" })).toBe(
      "your opponent's Active Pokémon has damage counters on it",
    );
    expect(conditionNote({ kind: "opponentActiveIsEvolution" })).toBe(
      "your opponent's Active Pokémon is an Evolution Pokémon",
    );
  });
});

describe("the family is PURE — a frozen board is never mutated", () => {
  it("resolves every clause, true and false, off a deep-frozen state", () => {
    const cases: { build: (seed: number) => GameState; index: number }[] = [
      {
        build: (seed) =>
          playStadium(
            pay(setActiveFromDeck(board(seed), "p1", "sv02-096"), "p1", [
              ["fix-psychic-energy", 1],
              ["fix-energy", 2],
            ]),
            "p1",
          ),
        index: 1,
      },
      {
        build: (seed) =>
          setPrizes(
            pay(setActiveFromDeck(board(seed), "p1", "sv02-043"), "p1", [
              ["fix-water-energy", 1],
              ["fix-energy", 2],
            ]),
            "p2",
            4,
          ),
        index: 0,
      },
      {
        build: (seed) =>
          setDamage(
            pay(setActiveFromDeck(board(seed), "p1", "sv01-045"), "p1", [
              ["fix-water-energy", 3],
              ["fix-energy", 2],
            ]),
            "p2",
            10,
          ),
        index: 1,
      },
      {
        build: (seed) =>
          setActiveFromDeck(
            pay(setActiveFromDeck(board(seed), "p1", "sv02-137"), "p1", [
              ["fix-dark-energy", 1],
              ["fix-energy", 1],
            ]),
            "p2",
            "sv02-043",
          ),
        index: 1,
      },
    ];
    for (const [i, { build, index }] of cases.entries()) {
      const state = deepFreeze(build(20 + i));
      expect(() => mustApply(state, { type: "attack", seat: "p1", index })).not.toThrow();
    }
  });
});
