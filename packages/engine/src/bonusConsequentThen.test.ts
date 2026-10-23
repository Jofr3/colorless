import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
} from "./effects";
import type { EffectOp } from "./effects";
import {
  applyAction,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  walkProgram,
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

const MELTER_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";
const ALLURE_TEXT = "Draw 2 cards.";

const BARE_ANTECEDENT = "If a Stadium is in play, this attack does 70 more damage.";
const BARE_CONSEQUENT = "Discard a Stadium in play.";
/** …and the consequent as it is actually printed INSIDE the sentence — lowercase
    and anaphoric, which no standalone reader claims. */
const INNER_CONSEQUENT = "discard that Stadium.";

const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";

const TINGLU_TEXT =
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const CHIYU = "sv06-039";
const BEACH_COURT = "sv01-167";
const DEFENDER = "fix-bigbody";
const FIRE = "fix-fire-energy";
const COLORLESS = "fix-energy";

/** The ATTRIBUTION CONTROL's card — the SAME antecedent and the SAME `. Then, `
    join with a consequent no anchor reads, so the whole sentence must stay on the
    loud path. */
const UNREAD = "fix-d382-unread";
const UNREAD_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, hum a little tune.";

const LOCAL_CARDS: Record<string, Card> = {
  [CHIYU]: battler(CHIYU, {
    name: "Chi-Yu",
    hp: 110,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Allure", effect: ALLURE_TEXT },
      {
        cost: ["Fire", "Colorless"],
        name: "Ground Melter",
        effect: MELTER_TEXT,
        damage: "60+",
      },
    ],
  }),
  [UNREAD]: battler(UNREAD, {
    hp: 110,
    types: ["Fire"],
    attacks: [
      { cost: ["Colorless"], name: "Allure", effect: ALLURE_TEXT },
      {
        cost: ["Fire", "Colorless"],
        name: "Hummed Melter",
        effect: UNREAD_TEXT,
        damage: "60+",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [CHIYU]: 4,
  [UNREAD]: 4,
  [BEACH_COURT]: 6,
  [FIRE]: 8,
  [COLORLESS]: 8,
  [DEFENDER]: 30,
});

const SEEDS = [4021, 4099] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return must(applyAction(withCard, { type: "playTrainer", seat, uid }));
}

/** TEST SURGERY — `count` Energy of one printed type onto `seat`'s Active. */
function fuel(state: GameState, seat: Seat, energyId: string, count: number): GameState {
  const side = state.players[seat];
  const body = side.active;
  if (body === null) throw new Error(`${seat} has no Active`);
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

function board(opts: { attacker: string; stadium?: Seat | null; seed?: number }): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", DEFENDER);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", DEFENDER);
  if (opts.stadium === "p2") state = playStadium(state, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (opts.stadium === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", DEFENDER);
  state = fuel(state, "p1", FIRE, 1);
  return fuel(state, "p1", COLORLESS, 1);
}

const MELTER = { type: "attack", seat: "p1", index: 1 } as const;

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The other ELEVEN readers, run as one — the disjointness control. */
const OTHER_READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §1 — the print, and the reading it gets", () => {
  it("the fixture carries the printed sentence VERBATIM, with its '+' marker", () => {
    expect(POOL[CHIYU]?.attacks?.[1]?.effect).toBe(MELTER_TEXT);
    expect(POOL[CHIYU]?.attacks?.[1]?.damage).toBe("60+");
    expect(POOL[CHIYU]?.attacks?.[1]?.cost).toEqual(["Fire", "Colorless"]);
    expect(corpus().filter(([, s]) => s === MELTER_TEXT)).toEqual([[1, MELTER_TEXT]]);
  });

  it("the sentence reads into its DECIDER, its bonus and the op the yes arm buys", () => {
    expect(deriveAttackBonusConsequent(MELTER_TEXT)).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "stadiumInPlay" } },
      bonus: 60,
      ops: [{ op: "discardStadium" }],
    });
  });

  it("the DECIDER is byte-identical to the one the BARE antecedent derives", () => {
    // The clause goes through `boardConditionForClause`'s shared fold, so a
    // sentence meaning "does N more damage if a Stadium is out" means the same
    // thing here as it does one reader over. Asserted, not argued.
    const bare = deriveAttackDamageBonus(BARE_ANTECEDENT);
    expect(bare).toMatchObject({ count: { kind: "boardCondition" } });
    const reading = deriveAttackBonusConsequent(MELTER_TEXT);
    expect(reading?.decider).toEqual({
      kind: "boardCondition",
      cond: (bare as { count: { cond: unknown } }).count.cond,
    });
  });

  it("the ops are BYTE-IDENTICAL to the ones the BARE consequent derives", () => {
    expect(deriveAttackBonusConsequent(MELTER_TEXT)?.ops).toEqual(
      deriveAttackEffect(BARE_CONSEQUENT),
    );
  });

  it("NO registry ATTACK row is authored for the printing — an ARM serves it", () => {
    expect(programFor(CHIYU)).toBeUndefined();
  });

  it("INDEX PRECISION — Chi-Yu's other attack is read by a DIFFERENT reader", () => {
    expect(POOL[CHIYU]?.attacks?.[0]?.effect).toBe(ALLURE_TEXT);
    expect(deriveAttackBonusConsequent(ALLURE_TEXT)).toBeNull();
    expect(deriveAttackEffect(ALLURE_TEXT)).toEqual([{ op: "drawCards", count: 2 }]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §2 — the REFUSALS, which are what keep an unread sentence loud", () => {
  it("D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    expect(
      [...OTHER_READERS.map((read) => read.name), "deriveAttackBonusConsequent"].sort(),
    ).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("all ELEVEN other readers refuse the sentence", () => {
    expect(resolvedByAnyReader(MELTER_TEXT), MELTER_TEXT).toBe(true);
    for (const read of OTHER_READERS) expect(read(MELTER_TEXT)).toBeNull();
  });

  it("and the BARE halves stay with the readers that already owned them", () => {
    expect(deriveAttackDamageBonus(BARE_ANTECEDENT)).not.toBeNull();
    expect(deriveAttackBonusConsequent(BARE_ANTECEDENT)).toBeNull();
    expect(deriveAttackEffect(BARE_CONSEQUENT)).toEqual([{ op: "discardStadium" }]);
    expect(deriveAttackBonusConsequent(BARE_CONSEQUENT)).toBeNull();
  });

  it("the INNER consequent is lowercase and ANAPHORIC, and NOTHING reads it alone", () => {
    expect(MELTER_TEXT.endsWith(` Then, ${INNER_CONSEQUENT}`)).toBe(true);
    expect(deriveAttackEffect(INNER_CONSEQUENT)).toBeNull();
    expect(resolvedByAnyReader(INNER_CONSEQUENT), INNER_CONSEQUENT).toBe(false);
    for (const read of OTHER_READERS) expect(read(INNER_CONSEQUENT)).toBeNull();
  });

  it("THE CATALOG'S OWN NEAR MISS — same antecedent, same consequent, REFUSED by the JOIN reader — D522: and BUILT by `deriveAttackEffect`, the carrier the refusal did not name", () => {
    expect(corpus().filter(([, s]) => s === TINGLU_TEXT)).toEqual([[1, TINGLU_TEXT]]);
    expect(deriveAttackBonusConsequent(TINGLU_TEXT)).toBeNull();
    expect(resolvedByAnyReader(TINGLU_TEXT), TINGLU_TEXT).toBe(true);
    for (const read of OTHER_READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TINGLU_TEXT), read.name).toBeNull();
    }
    expect(deriveAttackEffect(TINGLU_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        ops: [
          { op: "spreadDamage", target: "opponentBench", amount: 30 },
          { op: "discardStadium" },
        ],
      },
    ]);
  });

  it("an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    expect(deriveAttackBonusConsequent(UNREAD_TEXT)).toBeNull();
  });

  it("the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    expect(
      deriveAttackBonusConsequent(
        "If a Stadium is in play, this attack does 60 more damage. Then, Discard that Stadium.",
      ),
    ).toBeNull();
  });

  it("a printed ZERO on the bonus is refused", () => {
    expect(
      deriveAttackBonusConsequent(
        "If a Stadium is in play, this attack does 0 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-STRING — leading or trailing text is refused", () => {
    expect(deriveAttackBonusConsequent(`${MELTER_TEXT} Then, draw a card.`)).toBeNull();
    expect(deriveAttackBonusConsequent(`Before anything else, ${MELTER_TEXT}`)).toBeNull();
  });

  it("an UNMAPPED antecedent clause refuses too, and stays LOUD", () => {
    expect(
      deriveAttackBonusConsequent(
        "If the moon is full, this attack does 60 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §3 — THE TWO JOINS ARE DISJOINT, AND THE `??` IS ORDER-FREE", () => {
  it("neither printed sentence carries the OTHER's join", () => {
    // The byte claim the disjointness rests on: the `. Then, ` anchor demands a
    // literal ". " where the `, and ` anchor demands a literal ", " at the same
    // offset in the same sentence, so no sentence can match both.
    expect(MELTER_TEXT.includes("more damage, and ")).toBe(false);
    expect(OGERPON_TEXT.includes("more damage. Then, ")).toBe(false);
    // …and no sentence in the whole legal attack column carries both.
    const both = corpus().filter(
      ([, s]) => s.includes("more damage, and ") && s.includes("more damage. Then, "),
    );
    expect(both).toEqual([]);
  });

  it("THE JOIN IS PARAMETERISED, NOT A SPECIAL CASE — both crosses read", () => {
    const ogerponWithThen = OGERPON_TEXT.replace(
      "more damage, and discard all Energy",
      "more damage. Then, discard all Energy",
    );
    expect(deriveAttackBonusConsequent(ogerponWithThen)).toEqual(
      deriveAttackBonusConsequent(OGERPON_TEXT),
    );
    const melterWithAnd = MELTER_TEXT.replace(
      "more damage. Then, discard that Stadium.",
      "more damage, and discard that Stadium.",
    );
    expect(deriveAttackBonusConsequent(melterWithAnd)).toEqual(
      deriveAttackBonusConsequent(MELTER_TEXT),
    );
  });

  it("the COIN form is NOT widened, and the catalog is why", () => {
    const coinThen = /^Flip a coin\. If heads, this attack does (\d+) more damage\. Then, (.+)$/;
    expect(corpus().filter(([, s]) => coinThen.test(s))).toEqual([]);
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 60 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §4 — the ASSEMBLER: both arms, and the PRINTED ORDER inside the gate", () => {
  const program = (): EffectOp[] => {
    const reading = deriveAttackBonusConsequent(MELTER_TEXT);
    if (reading === null) throw new Error("Ground Melter did not read");
    return bonusConsequentProgram(reading, 60);
  };

  it("the whole hit moves inside the gate, on BOTH arms", () => {
    expect(program()).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        ops: [{ op: "damageDefender", amount: 120 }, { op: "discardStadium" }],
        otherwise: [{ op: "damageDefender", amount: 60 }],
      },
    ]);
  });

  it("THE DECLINE ARM IS THE PRINTED BASE, NEVER AN ABSENT BRANCH", () => {
    const gate = program()[0];
    expect(gate).toMatchObject({ op: "conditionGate" });
    expect((gate as { otherwise?: EffectOp[] }).otherwise).toEqual([
      { op: "damageDefender", amount: 60 },
    ]);
  });

  it("THE DAMAGE COMES FIRST AND THE DISCARD SECOND — the PRINTED order", () => {
    const gate = program()[0] as { ops: EffectOp[] };
    expect(gate.ops.map((op) => op.op)).toEqual(["damageDefender", "discardStadium"]);
  });

  it("the two arms are DISTINCT OBJECTS, not one array shared", () => {
    const gate = program()[0] as { ops: EffectOp[]; otherwise: EffectOp[] };
    expect(gate.ops).not.toBe(gate.otherwise);
    expect(walkProgram(program()).map((op) => op.op)).toEqual([
      "conditionGate",
      "damageDefender",
      "discardStadium",
      "damageDefender",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §5 — CHI-YU ON A REAL BOARD: both arms, and the zone", () => {
  for (const seed of SEEDS) {
    it(`🛑 with a Stadium out the hit is 120 in ONE row and the zone EMPTIES (seed ${seed})`, () => {
      const start = board({ attacker: CHIYU, stadium: "p2", seed });
      expect(start.stadium).not.toBeNull();
      const { state: done, events } = apply(start, MELTER);
      // ONE hit, at base + bonus. Two hits would be two rows and §8.5 twice.
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 120 });
      expect(done.players.p2.active?.damage).toBe(120);
      // …and the printed consequent ran: the zone is empty and the card is in its
      // OWNER's discard pile, which is the half a constructed `state.stadium` could
      // never have shown.
      expect(done.stadium).toBeNull();
      const discarded = findEvent(events, "STADIUM_DISCARDED");
      expect(discarded).toMatchObject({ seat: "p2" });
      expect(done.players.p2.discard).toContain(discarded?.uid);
    });

    it(`🛑 with the zone EMPTY the hit is the printed 60 and nothing is discarded (seed ${seed})`, () => {
      const start = board({ attacker: CHIYU, stadium: null, seed });
      expect(start.stadium).toBeNull();
      const { state: done, events } = apply(start, MELTER);
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 60 });
      expect(done.players.p2.active?.damage).toBe(60);
      expect(count(events, "STADIUM_DISCARDED")).toBe(0);
      expect(done.stadium).toBeNull();
    });
  }

  it("the Stadium may be the ATTACKER'S OWN — `stadiumInPlay`, not `yourStadiumInPlay`", () => {
    const start = board({ attacker: CHIYU, stadium: "p1" });
    expect(start.stadium).toMatchObject({ owner: "p1" });
    const { state: done, events } = apply(start, MELTER);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 120 });
    expect(done.stadium).toBeNull();
    expect(findEvent(events, "STADIUM_DISCARDED")).toMatchObject({ seat: "p1" });
  });

  it("the attack still ends the turn [ D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] on the DECLINE arm — nothing here is a cancellation", () => {
    const { state: done } = apply(board({ attacker: CHIYU, stadium: null }), MELTER);
    expect(done.phase).toMatchObject({ seat: "p2" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §6 — the LOUD path closed: the sentence and its '+' are both simulated", () => {
  it("no ATTACK_EFFECT_SKIPPED on EITHER arm", () => {
    for (const stadium of ["p2", null] as const) {
      const { events } = apply(board({ attacker: CHIYU, stadium }), MELTER);
      expect(count(events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    }
  });

  it("the ATTRIBUTION CONTROL — the SAME antecedent and join with an unread tail IS flagged", () => {
    const { events } = apply(board({ attacker: UNREAD, stadium: "p2" }), MELTER);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 60 });
    // …and the Stadium is still standing, because the consequent never ran.
    expect(count(events, "STADIUM_DISCARDED")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §7 — the CENSUS, re-derived off the corpus rather than quoted", () => {
  const AND_JOIN = /^If (.+), this attack does (\d+) more damage, and (.+)$/;
  const THEN_JOIN = /^If (.+), this attack does (\d+) more damage\. Then, (.+)$/;

  it("the `. Then, ` join is ONE sentence and ONE printing; `, and ` is ONE and FIVE", () => {
    const then = corpus().filter(([, s]) => THEN_JOIN.test(s));
    expect([then.length, units(then)]).toEqual([1, 1]);
    expect(then[0]?.[1]).toBe(MELTER_TEXT);
    const and = corpus().filter(([, s]) => AND_JOIN.test(s));
    expect([and.length, units(and)]).toEqual([1, 5]);
    expect(and[0]?.[1]).toBe(OGERPON_TEXT);
  });

  it("every sentence either anchor matches is now READ by this reader", () => {
    const matched = corpus().filter(([, s]) => AND_JOIN.test(s) || THEN_JOIN.test(s));
    expect(matched).toHaveLength(2);
    for (const [, s] of matched) expect(deriveAttackBonusConsequent(s)).not.toBeNull();
  });

  it("`discard that Stadium` is TWO sentences and this slice claims ONE of them — D522: the family is 2 / 2 BUILT by TWO readers, 1 / 1 each", () => {
    const family = corpus().filter(([, s]) => s.includes("discard that Stadium"));
    expect([family.length, units(family)]).toEqual([2, 2]);
    const claimed = family.filter(([, s]) => deriveAttackBonusConsequent(s) !== null);
    expect(claimed.map(([, s]) => s)).toEqual([MELTER_TEXT]);
    const left = family.filter(([, s]) => deriveAttackBonusConsequent(s) === null);
    expect(left.map(([, s]) => s)).toEqual([TINGLU_TEXT]);
    expect(deriveAttackEffect(TINGLU_TEXT)).not.toBeNull();
    expect(deriveAttackEffect(MELTER_TEXT)).toBeNull();
    for (const [, s] of family) expect(resolvedByAnyReader(s), s).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §8 — the `conditionGate` ARM'S FIRST `FIXTURE_POOL` PRODUCER", () => {
  it("the DEMONSTRATOR prints the sentence, so the shared sweeps can see the shape", () => {
    const demo = FIXTURE_POOL["fix-groundmelter"];
    expect(demo?.attacks?.[0]?.effect).toBe(MELTER_TEXT);
    expect(demo?.attacks?.[0]?.damage).toBe("60+");
    expect(deriveAttackBonusConsequent(demo?.attacks?.[0]?.effect ?? "")).not.toBeNull();
  });

  it("and it is the ONLY `FIXTURE_POOL` card whose reading uses the BOARD-FACT decider", () => {
    const byDecider = (kind: string): string[] =>
      Object.entries(FIXTURE_POOL)
        .filter(([, card]) =>
          (card.attacks ?? []).some(
            (a) => deriveAttackBonusConsequent(a.effect ?? "")?.decider.kind === kind,
          ),
        )
        .map(([id]) => id);
    expect(byDecider("boardCondition")).toEqual(["fix-groundmelter"]);
    expect(byDecider("coinFlip")).toEqual(["fix-bonusconsequent"]);
  });
});
