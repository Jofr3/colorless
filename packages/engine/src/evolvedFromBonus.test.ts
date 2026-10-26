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
} from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  EVOLVED_FROM_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const GOLD =
  "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.";
const GOLD_CLAUSE = "this Pokémon evolved from Gimmighoul during this turn";
const STAR =
  "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.";
const STAR_CLAUSE = "this Pokémon evolved from Misty's Staryu during this turn";

const SALANDIT =
  "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";

const GIMMIGHOUL: BoardCondition = {
  kind: "yourActiveEvolvedFromThisTurn",
  name: "Gimmighoul",
};
const STARYU: BoardCondition = {
  kind: "yourActiveEvolvedFromThisTurn",
  name: "Misty's Staryu",
};

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(
  seed: number,
  opts: { active: string; bench?: readonly string[]; energy: string },
): GameState {
  let state = driveSetup(seed, { p1: EVOLVED_FROM_DECK, p2: EVOLVED_FROM_DECK }, { first: "p2" });
  for (const seat of ["p2", "p1", "p2"] as const) {
    state = mustApply(state, { type: "endTurn", seat }).state;
  }
  state = setActiveFromDeck(state, "p1", opts.active);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", opts.energy, 3);
}

/** Play `cardId` out of P1's hand as an evolution onto `target`. The card is
    moved deck → hand first, so no board below depends on what the opening draw
    happened to contain. */
function evolve(state: GameState, cardId: string, target: number | "active"): GameState {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  return mustApply(withCard, {
    type: "evolve",
    seat: "p1",
    uid: handUid(withCard, "p1", cardId),
    target: target === "active" ? { spot: "active" } : { spot: "bench", index: target },
  }).state;
}

/** Declare P1's attack at `index` and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

const activeOf = (state: GameState, seat: Seat) => state.players[seat].active;

// ────────────────────────────────────────────────────────────────────────────
describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the PAIR is real, is worth 2 printings, and both reached the SKELETON all along", () => {
    for (const [sentence, clause, amount] of [
      [GOLD, GOLD_CLAUSE, "90"],
      [STAR, STAR_CLAUSE, "80"],
    ] as const) {
      expect(corpus().filter(([, s]) => s === sentence)).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === sentence))).toBe(1);
      // Both were refused at the CLAUSE, not at the skeleton: the bonus pattern
      // always matched and always captured the printed amount.
      expect(BONUS.test(sentence)).toBe(true);
      expect(BONUS.exec(sentence)?.[1]).toBe(clause);
      expect(BONUS.exec(sentence)?.[2]).toBe(amount);
    }
    const pair = corpus().filter(([, s]) => s === GOLD || s === STAR);
    expect(pair).toHaveLength(2);
    expect(units(pair)).toBe(2);
    expect(new Set(pair.map(([, s]) => BONUS.exec(s)?.[2]))).toEqual(new Set(["90", "80"]));
  });

  it("the FAMILY is THREE and the third is refused by THIS file's SKELETON, not by its clause", () => {
    const family = corpus().filter(([, s]) => s.includes("evolved from"));
    expect(family).toHaveLength(3);
    expect(units(family)).toBe(3);
    const shaped = family.filter(([, s]) => BONUS.test(s.trim()));
    expect(shaped).toHaveLength(2);
    expect(new Set(shaped.map(([, s]) => s))).toEqual(new Set([GOLD, STAR]));
    expect(corpus().some(([, s]) => s === SALANDIT)).toBe(true);
    expect(BONUS.test(SALANDIT.trim())).toBe(false);
    expect(deriveAttackBonusConsequent(SALANDIT)).toBeNull();
    expect(deriveAttackDamageBonus(SALANDIT)).toBeNull();
    // …and it is claimed by exactly ONE reader, which is not one of this file's two.
    expect(resolvedByAnyReader(SALANDIT)).toBe(true);
    expect(READERS.filter((read) => read(SALANDIT) !== null).map((read) => read.name)).toEqual([
      "deriveAttackEffect",
    ]);
    expect(deriveAttackEffect(SALANDIT)?.[1]).toMatchObject({
      op: "conditionGate",
      cond: { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" },
    });
  });

  it("the residue steps by exactly TWO sentences and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 11 / 14 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === GOLD)).toBe(false);
    expect(refused.some(([, s]) => s === STAR)).toBe(false);
    expect(resolvedByAnyReader(GOLD)).toBe(true);
    expect(resolvedByAnyReader(STAR)).toBe(true);
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect([refused.length + 13, units(refused) + 16]).toEqual([13, 16]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect(byClause.size).toBe(0);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — the SHAPE questions, measured on the running code rather than argued", () => {
  it("ONE member serves BOTH printings — the pair shares a `kind` and differs in `name`", () => {
    // The union half, and the whole argument for pricing the pair as a pair: the two
    // clause rows resolve to the SAME member at DIFFERENT names, so a second member
    // (or a second field) would have been two spellings of one board fact.
    expect(deriveAttackDamageBonus(GOLD)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: GIMMIGHOUL },
    });
    expect(deriveAttackDamageBonus(STAR)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: STARYU },
    });
    expect(GIMMIGHOUL.kind).toBe(STARYU.kind);
  });

  it("the note takes a SLOT, not a second SENTENCE — and round-trips to BOTH keys", () => {
    expect(conditionNote(GIMMIGHOUL)).toBe(
      "your Active Pokémon evolved from Gimmighoul during this turn",
    );
    expect(conditionNote(STARYU)).toBe(
      "your Active Pokémon evolved from Misty's Staryu during this turn",
    );
    expect(conditionNote(GIMMIGHOUL).replace("your Active Pokémon", "this Pokémon")).toBe(
      GOLD_CLAUSE,
    );
    expect(conditionNote(STARYU).replace("your Active Pokémon", "this Pokémon")).toBe(STAR_CLAUSE);
    // The round trip through the table, at the PRINTED clause rather than the note.
    expect(
      deriveAttackDamageBonus(`If ${GOLD_CLAUSE}, this attack does 90 more damage.`)?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: GIMMIGHOUL,
    });
    expect(
      deriveAttackDamageBonus(`If ${STAR_CLAUSE}, this attack does 80 more damage.`)?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: STARYU,
    });
  });

  it("TWO LITERAL ROWS AND NO SIXTH TEMPLATE — an unprinted name resolves to NOTHING", () => {
    for (const name of ["Rayquaza", "Staryu", "gimmighoul", "Misty's Starmie"]) {
      const invented = `If this Pokémon evolved from ${name} during this turn, this attack does 90 more damage.`;
      expect(resolvedByAnyReader(invented), name).toBe(false);
    }
  });

  it("the PRE-EVOLUTION NAME is read off the STACK, so the member buys only ONE field", () => {
    const state = evolve(
      ready(11, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    const active = activeOf(state, "p1");
    expect(active?.stack).toHaveLength(2);
    expect(state.cardIdByUid[active?.stack[0] ?? ""]).toBe("fix-gimmighoul");
    expect(state.cardIdByUid[active?.stack[1] ?? ""]).toBe("fix-strikeitrich");
    // …and the field that IS bought is one number, on the body, equal to the turn.
    expect(active?.evolvedTurn).toBe(state.turn);
    expect(Object.keys(active ?? {})).toContain("evolvedTurn");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — the two printed cards, on boards, at the printed numbers", () => {
  it("Gholdengo: 30 un-evolved, 120 when it evolved from Gimmighoul THIS turn", () => {
    // FALSE — placed straight into play, so `evolvedTurn` is null and the printed
    // base stands alone. This is the case that goes red if the arm ever answers
    // TRUE off `evolveFrom` (a fact about the CARD) instead of off the stamp.
    const flat = ready(1, { active: "fix-strikeitrich", energy: "fix-metal-energy" });
    expect(conditionHolds(flat, "p1", GIMMIGHOUL)).toBe(false);
    expect(damageDealt(flat)).toBe(30);
    // TRUE — a Gimmighoul evolved into it on this very turn: 30 + 90.
    const armed = evolve(
      ready(1, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(armed, "p1", GIMMIGHOUL)).toBe(true);
    expect(damageDealt(armed)).toBe(120);
  });

  it("Misty's Starmie: 60 un-evolved, 140 when it evolved from Misty's Staryu THIS turn", () => {
    const flat = ready(2, { active: "fix-abruptflash", energy: "fix-water-energy" });
    expect(conditionHolds(flat, "p1", STARYU)).toBe(false);
    expect(damageDealt(flat)).toBe(60);
    const armed = evolve(
      ready(2, { active: "fix-mistystaryu", energy: "fix-water-energy" }),
      "fix-abruptflash",
      "active",
    );
    expect(conditionHolds(armed, "p1", STARYU)).toBe(true);
    expect(damageDealt(armed)).toBe(140);
  });

  it("THE CROSS-CONTROL: each armed board leaves the OTHER card's clause FALSE", () => {
    const gold = evolve(
      ready(3, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(gold, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(gold, "p1", STARYU)).toBe(false);
    const star = evolve(
      ready(3, { active: "fix-mistystaryu", energy: "fix-water-energy" }),
      "fix-abruptflash",
      "active",
    );
    expect(conditionHolds(star, "p1", STARYU)).toBe(true);
    expect(conditionHolds(star, "p1", GIMMIGHOUL)).toBe(false);
  });

  it("THE CLOCK: an evolution made on an EARLIER turn stops paying, with no clear", () => {
    let state = evolve(
      ready(4, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    const stamped = activeOf(state, "p1")?.evolvedTurn;
    expect(stamped).toBe(state.turn);
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    // …round the table once and ask again. The STAMP is untouched and the ANSWER
    // has changed, which is the difference between an expiring fact and a cleared one.
    for (const seat of ["p1", "p2"] as const) {
      state = mustApply(state, { type: "endTurn", seat }).state;
    }
    expect(activeOf(state, "p1")?.evolvedTurn).toBe(stamped);
    expect(state.turn).not.toBe(stamped);
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(false);
    expect(damageDealt(state)).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — the board that REFUTES a per-seat record, driven rather than argued", () => {
  it("a BENCHED body evolving does NOT arm the Active's clause", () => {
    const state = evolve(
      ready(5, {
        active: "fix-abruptflash",
        bench: ["fix-mistystaryu"],
        energy: "fix-water-energy",
      }),
      "fix-abruptflash",
      0,
    );
    // The seat DID evolve, this turn, from exactly the printed card…
    const benched = state.players.p1.bench[0];
    expect(benched?.evolvedTurn).toBe(state.turn);
    expect(state.cardIdByUid[benched?.stack[0] ?? ""]).toBe("fix-mistystaryu");
    // …and the Active did not, so the clause is FALSE and the attack does its base.
    expect(activeOf(state, "p1")?.evolvedTurn).toBeNull();
    expect(conditionHolds(state, "p1", STARYU)).toBe(false);
    expect(damageDealt(state)).toBe(60);
  });

  it("TWO bodies evolving in one turn is the case a seat-level TURN cannot express", () => {
    const state = evolve(
      evolve(
        ready(6, {
          active: "fix-gimmighoul",
          bench: ["fix-mistystaryu"],
          energy: "fix-metal-energy",
        }),
        "fix-strikeitrich",
        "active",
      ),
      "fix-abruptflash",
      0,
    );
    expect(activeOf(state, "p1")?.evolvedTurn).toBe(state.turn);
    expect(state.players.p1.bench[0]?.evolvedTurn).toBe(state.turn);
    // Same turn, same seat, two bodies, two DIFFERENT pre-evolution names — and the
    // Active's is the only one the printed clause is about.
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(state, "p1", STARYU)).toBe(false);
    expect(damageDealt(state)).toBe(120);
  });

  it("the stamp is SEAT-BLIND, because `state.turn` is global", () => {
    const state = evolve(
      ready(7, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(state, "p2", GIMMIGHOUL)).toBe(false);
    expect(activeOf(state, "p2")?.evolvedTurn).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — the fixtures, the persisted shape, and the premise this slice killed", () => {
  it("the four fixtures carry the printed bytes, chains included", () => {
    const gold = FIXTURE_POOL["fix-strikeitrich"];
    expect(gold?.name).toBe("Gholdengo");
    expect(gold?.stage).toBe("Stage1");
    expect(gold?.evolveFrom).toBe("Gimmighoul");
    expect(gold?.hp).toBe(130);
    expect(gold?.attacks?.[0]?.name).toBe("Strike It Rich");
    expect(gold?.attacks?.[0]?.effect).toBe(GOLD);
    expect(gold?.attacks?.[0]?.damage).toBe("30+");
    expect(gold?.attacks?.[1]?.name).toBe("Surf Back");
    const star = FIXTURE_POOL["fix-abruptflash"];
    expect(star?.name).toBe("Misty's Starmie");
    expect(star?.stage).toBe("Stage1");
    expect(star?.evolveFrom).toBe("Misty's Staryu");
    expect(star?.attacks).toHaveLength(1);
    expect(star?.attacks?.[0]?.effect).toBe(STAR);
    expect(FIXTURE_POOL["fix-gimmighoul"]?.name).toBe("Gimmighoul");
    expect(FIXTURE_POOL["fix-mistystaryu"]?.name).toBe("Misty's Staryu");
    expect(FIXTURE_POOL["fix-mistystaryu"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-gimmighoul"]?.stage).toBe("Basic");
  });

  it("the key with the APOSTROPHE is U+0027, and the fold reaches it for real", () => {
    expect(STAR_CLAUSE.includes("'")).toBe(true);
    expect(STAR_CLAUSE.includes("’")).toBe(false);
    expect(GOLD_CLAUSE.includes("'")).toBe(false);
    expect(corpus().some(([, s]) => s === STAR)).toBe(true);
    // …and the curly spelling of the SAME sentence resolves to the SAME member,
    // which is what the fold is for.
    const curly = STAR.replace("'", "’");
    expect(curly).not.toBe(STAR);
    expect(deriveAttackDamageBonus(curly)?.count).toEqual({
      kind: "boardCondition",
      cond: STARYU,
    });
  });

  it("`evolvedTurn` is REQUIRED and every in-play body carries it — the 23 → 24 case", () => {
    const state = ready(8, {
      active: "fix-strikeitrich",
      bench: ["fix-gimmighoul", "fix-mistystaryu"],
      energy: "fix-metal-energy",
    });
    const bodies = [
      ...(["p1", "p2"] as const).flatMap((seat) => [
        state.players[seat].active,
        ...state.players[seat].bench,
      ]),
    ];
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    for (const body of bodies) {
      expect(body === null || "evolvedTurn" in body).toBe(true);
      expect(body?.evolvedTurn ?? null).toBeNull();
    }
  });
});
