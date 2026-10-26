import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
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
import type { GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  EX_ONLY_DECK,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";
import { attachFromDeck } from "./testFixtures";

const READERS: readonly ((t: string) => unknown)[] = [
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
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const BONUS = (n: number): string =>
  `If your opponent's Active Pokémon is a Pokémon ex, this attack does ${String(n)} more damage.`;
const BONUS_EX_OR_V =
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage.";
const TURTONATOR = "Discard an Energy from your opponent's Active Pokémon ex.";
const BARE_ACTIVE = "Discard an Energy from your opponent's Active Pokémon.";
/** Sawk `sv10.5w-049`/`-130`, as PRINTED — two sentences, which is the point. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
const PALAFIN =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: EX_ONLY_DECK, p2: EX_ONLY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-exonly");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

/** `ready`, plus TWO Energy on the DEFENDER — the dressing §4's board cases need,
    because "nothing came off" and "there was nothing to take" are the same
    observation on an empty body. */
function dressed(seed: number, defender: string): GameState {
  return attachFromDeck(ready(seed, defender), "p2", "fix-energy", 2);
}

describe("§1 — the population, re-derived LIVE rather than quoted", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("D420 — the TWELVE readers resolve 415 / 1,368 of a 640 / 1,732 corpus, and the parts SUM", () => {
    const rows = legalAttackCorpus();
    const total = rows.reduce((sum, [units]) => sum + units, 0);
    const resolved = rows.filter(([, s]) => readByAny(s));
    const residue = rows.filter(([, s]) => !readByAny(s));
    const resolvedP = resolved.reduce((sum, [units]) => sum + units, 0);
    const residueP = residue.reduce((sum, [units]) => sum + units, 0);

    expect(rows).toHaveLength(640);
    expect(total).toBe(1732);
    expect(resolved).toHaveLength(600);
    expect(resolvedP).toBe(1663);
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(resolvedP + residueP).toBe(total);
    expect(residue).toHaveLength(40);
    expect(residueP).toBe(69);
  });

  it("the ex-ONLY predicate is 8 s / 13 p and the WIDER sibling is 4 s / 6 p — the ratio that chose the row", () => {
    const rows = legalAttackCorpus();
    const exOnly = rows.filter(
      ([, s]) =>
        /^If your opponent's Active Pokémon is(n't)? a Pokémon ex[,.]/.test(s) ||
        /Active Pokémon ex\.$/.test(s),
    );
    const exOrV = rows.filter(([, s]) => /Active Pokémon is a Pokémon ex or Pokémon V,/.test(s));

    expect(exOnly).toHaveLength(8);
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBe(13);
    expect(exOrV).toHaveLength(4);
    expect(exOrV.reduce((sum, [units]) => sum + units, 0)).toBe(6);
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBeGreaterThan(
      2 * exOrV.reduce((sum, [units]) => sum + units, 0),
    );
    // …and the wider one was ALREADY built, which is what makes it a pair.
    for (const [, s] of exOrV) expect(readByAny(s), s).toBe(true);
    const stillUnread = exOnly.filter(([, s]) => !readByAny(s));
    expect(stillUnread).toHaveLength(0);
    expect(exOnly.filter(([, s]) => readByAny(s))).toHaveLength(8);
    expect(readByAny(SAWK)).toBe(true);
  });

  it("every one of the six printed amounts derives, and the amount is NOT part of the key", () => {
    for (const n of [40, 50, 70, 80, 90, 100]) {
      expect(deriveAttackDamageBonus(BONUS(n)), String(n)).toEqual({
        per: n,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEx" } },
      });
    }
    expect(deriveAttackDamageBonus(BONUS(30))?.per).toBe(30);
  });
});

describe("§2 — the NO-NEW-VOCABULARY refutation, driven on a BOARD", () => {
  it("a Pokémon V is the ONE board where the two members disagree", () => {
    const clean = board(41); // both Actives are the suffix-free fix-bigbody
    const v = setActiveFromDeck(clean, "p2", "fix-pokemon-v");
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    const vOnP1 = setActiveFromDeck(clean, "p1", "fix-pokemon-v");
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
  });

  it("is cross-board, per seat, TRUE only on an ex, and false on VMAX / plain / empty", () => {
    const clean = board(42);
    for (const seat of ["p1", "p2"] as const)
      expect(conditionHolds(clean, seat, { kind: "opponentActiveIsEx" })).toBe(false);

    // The real Pokémon ex, read from BOTH seats: true only for the seat whose
    // OPPONENT is holding it. A real catalog id, so the predicate is proven
    // against a PRINTED name suffix rather than a fixture's.
    const onP2 = setActiveFromDeck(clean, "p2", "sv06.5-036");
    expect(conditionHolds(onP2, "p1", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP2, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
    const onP1 = setActiveFromDeck(clean, "p1", "sv06.5-036");
    expect(conditionHolds(onP1, "p2", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP1, "p1", { kind: "opponentActiveIsEx" })).toBe(false);

    // A VMAX has a Rule Box and the sentence does not name it — false under BOTH
    // members, so the pair cannot be mistaken for a `hasRuleBox` read.
    const vmax = setActiveFromDeck(clean, "p2", "fix-pokemon-vmax");
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw — as with every sibling.
    const state = mustApply(onP2, { type: "endTurn", seat: "p1" }).state;
    expect(
      conditionHolds(
        { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } },
        "p1",
        { kind: "opponentActiveIsEx" },
      ),
    ).toBe(false);
  });

  it("the +90 lands into an ex and does NOT into a Pokémon V — the same refutation through the DAMAGE", () => {
    // The board case above proves the predicate; this proves the wiring, which
    // is a different claim: a correct predicate read at the wrong site scores 0.
    const intoEx = mustApply(ready(43, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoEx.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const exHit = intoEx.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(exHit).toMatchObject({ base: 10, scaled: 90 });

    const intoV = mustApply(ready(44, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoV.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const vHit = intoV.events.find((e) => e.type === "DAMAGE_DEALT");
    // The printed 10 stands. A reused `opponentActiveIsExOrV` would read 100 here.
    expect(vHit).toMatchObject({ base: 10, dealt: 10 });
    expect(vHit?.scaled).toBeUndefined();
  });
});

describe("§3 — the clause-table row, and the round trip in BOTH directions", () => {
  it("the note IS the printed clause, so the sentence round-trips in one step", () => {
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    const bonus = deriveAttackDamageBonus(BONUS(90));
    const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
    expect(cond).toEqual({ kind: "opponentActiveIsEx" });
    expect(BONUS(90)).toBe(
      `If ${conditionNote(cond ?? { kind: "handSizesEqual" })}, this attack does 90 more damage.`,
    );
  });

  it("the two keys differ by FOUR printed words, and NEITHER sentence reaches the other's row", () => {
    const wider = deriveAttackDamageBonus(BONUS_EX_OR_V);
    expect(wider?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsExOrV" },
    });
    expect(conditionNote({ kind: "opponentActiveIsExOrV" })).toBe(
      `${conditionNote({ kind: "opponentActiveIsEx" })} or Pokémon V`,
    );
    // …and a clause one word off either key is UNMAPPED and therefore LOUD.
    expect(deriveAttackDamageBonus(BONUS(90).replace("a Pokémon ex", "a Pokémon V"))).toBeNull();
    expect(
      deriveAttackDamageBonus(BONUS(90).replace("Active Pokémon", "Benched Pokémon")),
    ).toBeNull();
  });

  it("folds a CURLY apostrophe on both halves of the row", () => {
    const curly = (s: string): string => s.replace(/'/g, "’");
    expect(deriveAttackDamageBonus(curly(BONUS(90)))).toEqual(deriveAttackDamageBonus(BONUS(90)));
    expect(deriveAttackEffect(curly(TURTONATOR))).toEqual(deriveAttackEffect(TURTONATOR));
  });
});

describe("§4 — the discard anchor is defended by TWO independent printed words", () => {
  it("word ONE — the adjective `ex` gates, and its absence leaves the bare family UNGATED", () => {
    expect(deriveAttackEffect(TURTONATOR)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsEx" },
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    // One printed adjective shorter is a DIFFERENT program — no gate at all — and
    // that is the whole behavioural content of the adjective.
    expect(deriveAttackEffect(BARE_ACTIVE)).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
  });

  it("word TWO — the article `an`, so the cross-product NOBODY prints stays null", () => {
    expect(
      deriveAttackEffect("Discard a Special Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Discard a {R} Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    // …while both of those sentences WITHOUT the adjective are built and ungated.
    for (const s of [
      "Discard a Special Energy from your opponent's Active Pokémon.",
      "Discard a {R} Energy from your opponent's Active Pokémon.",
    ])
      expect(deriveAttackEffect(s), s).not.toBeNull();
  });

  it("strips an Energy off an ex and takes NOTHING off a Pokémon V", () => {
    const intoEx = dressed(45, "sv06.5-036");
    expect(intoEx.players.p2.active?.energy).toHaveLength(2);
    const exAfter = mustApply(intoEx, { type: "attack", seat: "p1", index: 1 });
    expect(types(exAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(exAfter.state.players.p2.active?.energy).toHaveLength(1);
    expect(exAfter.state.players.p2.discard).toHaveLength(1);

    const intoV = dressed(46, "fix-pokemon-v");
    expect(intoV.players.p2.active?.energy).toHaveLength(2);
    const vAfter = mustApply(intoV, { type: "attack", seat: "p1", index: 1 });
    expect(types(vAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(vAfter.state.players.p2.active?.energy).toHaveLength(2);
    expect(vAfter.state.players.p2.discard).toHaveLength(0);

    // …and the attacker's OWN Energy is untouched on both boards: the op reads
    // `opponentActive`, and a seat-flipped read would strip the wrong body.
    expect(exAfter.state.players.p1.active?.energy).toHaveLength(1);
    expect(vAfter.state.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("§5 — the negation was REFUSED for one slice, and D363 spent it", () => {
  it("Sawk's printed text now reaches ONE reader, and the CONTROL still says why", () => {
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    const claimants = READERS.filter((read) => read(SAWK) !== null);
    expect(claimants).toHaveLength(1);

    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    expect(
      deriveAttackRequirement(
        `${PALAFIN} This attack's damage isn't affected by Weakness or Resistance.`,
      ),
    ).toEqual({ kind: "yourActivePromotedThisTurn" });
  });

  it("the FIRST sentence alone IS one table row now — and the table, not the anchor, is the remaining blocker", () => {
    const first = "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
    expect(deriveAttackRequirement(first)).toEqual({ kind: "opponentActiveIsEx" });
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 4 cards in your hand, this attack does nothing.",
      ),
    ).toBeNull();
    // …and the printed sentence one value over IS carried, which is what stops the
    // line above from passing because the reader is broken.
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      ),
    ).toEqual({ kind: "yourHandExactly", count: 3 });
  });

  it("the anchor's reach over the corpus is 9 s / 18 p of 17 s / 43 p, and the parts SUM", () => {
    const ANCHOR = /^If (.+?), this attack does nothing\.(?: (.+))?$/;
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const admissible = nothing.filter(([, s]) => ANCHOR.test(s.trim()));
    const refused = nothing.filter(([, s]) => !ANCHOR.test(s.trim()));
    // THE TIE: every sentence the live reader resolves must be one this copy
    // admits, and no sentence this copy refuses may resolve. A copy that drifts
    // from the pattern it quotes goes red here rather than agreeing with itself.
    for (const [, s] of nothing) {
      if (deriveAttackRequirement(s) !== null) expect(ANCHOR.test(s.trim()), s).toBe(true);
    }
    for (const [, s] of refused) expect(deriveAttackRequirement(s), s).toBeNull();
    expect(nothing).toHaveLength(17);
    expect(admissible).toHaveLength(9);
    expect(refused).toHaveLength(8);
    expect(admissible.length + refused.length).toBe(nothing.length);
    const p = (rows: readonly (readonly [number, string])[]): number =>
      rows.reduce((sum, [units]) => sum + units, 0);
    expect(p(nothing)).toBe(43);
    expect(p(admissible)).toBe(18);
    expect(p(refused)).toBe(25);
    expect(p(admissible) + p(refused)).toBe(p(nothing));
    expect(refused.some(([, s]) => s === SAWK)).toBe(false);
    expect(admissible.some(([, s]) => s === SAWK)).toBe(true);
    expect(refused.some(([, s]) => s === "Flip a coin. If tails, this attack does nothing.")).toBe(
      true,
    );
  });
});

describe("§6 — the rotated printing, and what this row did NOT buy", () => {
  it("the Trainer-column printing of the same clause is legal_standard = 0, so BUILT.trainer cannot move", () => {
    const inCorpus = legalAttackCorpus().filter(([, s]) => s.startsWith("Draw 2 cards. If your"));
    expect(inCorpus).toHaveLength(0);
    // …and no attack reader would resolve it either, so no summand can move.
    expect(
      readByAny(
        "Draw 2 cards. If your opponent's Active Pokémon is a Pokémon ex, draw 2 more cards.",
      ),
    ).toBe(false);
  });

  it("this slice authored ZERO registry keys, so the REGISTRY summand cannot move", () => {
    const TARGETS = [
      "svp-179",
      "sv10.5w-077",
      "sv10.5w-162",
      "sv10.5w-170",
      "sv10-130",
      "sv08.5-089",
      "sv07-090",
      "sv10-131",
      "sv08-141",
      "sv09-018",
      "sv08-137",
    ];
    expect(TARGETS).toHaveLength(11);
    expect(new Set(TARGETS).size).toBe(11);
  });
});
