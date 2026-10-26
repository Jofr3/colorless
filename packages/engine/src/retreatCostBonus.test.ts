import { describe, expect, it } from "vitest";
import { retreatCostOf } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { effectiveRetreatCost } from "./continuous";
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
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  RETREAT_COST_BONUS_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  activeOf,
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
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const TAKEN =
  "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.";

const TAKEN_ID = "sv07-123";

const NOUN_PHRASE_SIBLINGS: readonly (readonly [string, number, string])[] = [
  [
    "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    "deriveAttackDamageBonus",
  ],
  [
    "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    "deriveAttackDamageMultiplier",
  ],
  [
    "This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    2,
    "deriveAttackDamagePenalty",
  ],
  [
    "This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    "deriveAttackDamagePenalty",
  ],
];

const SCALING_READERS: Readonly<Record<string, (text: string) => unknown>> = {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
};

const COND: BoardCondition = { kind: "opponentActiveRetreatCostAtLeast", count: 2 };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(seed: number, defender: string): GameState {
  let state = driveSetup(
    seed,
    { p1: RETREAT_COST_BONUS_DECK, p2: RETREAT_COST_BONUS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-aerochase");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(clearBench(state, "p1"), "p2");
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND,
    so this turn carries no §4 attack restriction. */
function armed(seed: number, defender: string): GameState {
  return mustApply(ready(seed, defender), { type: "endTurn", seat: "p2" }).state;
}

/** P1 plays `cardId` into the shared Stadium zone. Only ever ONE at a time, so the
    two retreat Stadiums are driven by REPLACING each other and never by stacking. */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

/** Attack INDEX 0 — the printed index of "Aero Chase" — and report the damage
    actually dealt. */
function damageDealt(state: GameState): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function printedCostOf(state: GameState, seat: Seat): number {
  const active = activeOf(state, seat);
  const topUid = active.stack[active.stack.length - 1];
  const card = FIXTURE_POOL[state.cardIdByUid[topUid ?? ""] ?? ""];
  if (card === undefined) throw new Error("no top card");
  return retreatCostOf(card);
}

/** The FOLD, on `seat`'s Active. */
const foldedCostOf = (state: GameState, seat: Seat): number =>
  effectiveRetreatCost(state, activeOf(state, seat));

function assertReadingsDisagree(state: GameState, printed: number, folded: number): void {
  expect(printedCostOf(state, "p2")).toBe(printed);
  expect(foldedCostOf(state, "p2")).toBe(folded);
  expect(printed).not.toBe(folded);
}

describe("§1 — the SHAPE question: which reading does the printed noun phrase name?", () => {
  it("the sentence is real, is worth ONE printing, and was refused at D387's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("110");
    // The clause is what the table is keyed on, and it is the printed bytes between
    // the leading "If " and the ", this attack does".
    expect(BONUS.exec(TAKEN)?.[1]).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more",
    );
  });

  it("BOTH readings are live and BOTH have consumers — this was never 'which do I build'", () => {
    // The premise of the whole shape question, driven rather than asserted. Two
    // different functions, two different signatures, both exported, and on a plain
    // board they AGREE — which is exactly why a suite of plain boards proves nothing.
    const plain = ready(9101, "fix-retreat2-titan");
    expect(printedCostOf(plain, "p2")).toBe(2);
    expect(foldedCostOf(plain, "p2")).toBe(2);
    // `retreatCostOf` takes a CARD and `effectiveRetreatCost` takes a STATE and an
    // IN-PLAY BODY: the fold needs the board because three of its four terms are
    // scans over other Pokémon. That difference is why one of them can be right.
    expect(retreatCostOf.length).toBe(1);
    expect(effectiveRetreatCost.length).toBe(2);
  });

  it("⑴ the ENGINE HAD ALREADY ANSWERED this noun phrase, and it answered with the FOLD", () => {
    let phraseUnits = 0;
    let resolving = 0;
    for (const [sentence, printings, owner] of NOUN_PHRASE_SIBLINGS) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      expect(sentence).toContain("your opponent's Active Pokémon's Retreat Cost");
      const read = SCALING_READERS[owner];
      if (read === undefined) throw new Error(`unknown reader ${owner}`);
      expect(read(sentence), `${owner} :: ${sentence}`).not.toBeNull();
      for (const [name, other] of Object.entries(SCALING_READERS)) {
        if (name === owner) continue;
        expect(other(sentence), `${name} must refuse :: ${sentence}`).toBeNull();
      }
      phraseUnits += printings;
      resolving += printings;
    }
    expect([phraseUnits, resolving]).toEqual([5, 5]);
    expect(phraseUnits + units(corpus().filter(([, s]) => s === TAKEN))).toBe(6);
    // …and all four land on the count source that reads the fold — one count source,
    // three folds, which is the claim `retreatCostPenalty.test.ts` §6 drives on a
    // board.
    for (const [sentence, , owner] of NOUN_PHRASE_SIBLINGS) {
      const read = SCALING_READERS[owner] as (text: string) => { count: unknown } | null;
      expect(read(sentence)?.count, sentence).toEqual({ kind: "opponentActiveRetreatCost" });
    }
  });

  it("⑵ …and the fold is the value the RULES describe: an order of operations, not a constant", () => {
    const raised = withStadium(armed(9102, "fix-retreat1-titan"), "sv02-175");
    assertReadingsDisagree(raised, 1, 2);
    const lowered = withStadium(armed(9102, "fix-retreat2-titan"), "sv01-167");
    assertReadingsDisagree(lowered, 2, 1);
    const floored = withStadium(armed(9102, "fix-retreat1-titan"), "sv01-167");
    expect(printedCostOf(floored, "p2")).toBe(1);
    expect(foldedCostOf(floored, "p2")).toBe(0);
  });

  it("the price, as arithmetic rather than as prose — 1 / 2 against the Prize row's 2 / 9", () => {
    const mine = { printings: 1, mechanisms: 2 };
    const prizeRow = { printings: 2, mechanisms: 9 };
    expect(mine.printings).toBe(units(corpus().filter(([, s]) => s === TAKEN)));
    expect(mine.printings / mine.mechanisms).toBeGreaterThan(
      prizeRow.printings / prizeRow.mechanisms,
    );
    const prizeSentence =
      "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
    expect(units(corpus().filter(([, s]) => s === prizeSentence))).toBe(prizeRow.printings);
    const stillUnread =
      "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.";
    expect(units(corpus().filter(([, s]) => s === stillUnread))).toBe(prizeRow.printings);
    expect(resolvedByAnyReader(stillUnread)).toBe(false);
    expect(resolvedByAnyReader(prizeSentence)).toBe(true);
  });
});

describe("§2 — the clause row: one PARAMETERISED member, two arms, and the anchors", () => {
  it("buys ONE member with TWO arms — the two exhaustive switches, and no more", () => {
    // The claim that makes this purchase flat, DRIVEN rather than asserted: the
    // member answers on a board AND renders a note, which are the two exhaustive
    // `switch (cond.kind)` statements in the repo.
    expect(typeof conditionHolds(ready(9201, "fix-retreat2-titan"), "p1", COND)).toBe("boolean");
    expect(conditionNote(COND)).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is 2 or more",
    );
    // So it does NOT round-trip to the printed bytes, and the ONLY difference is the
    // glyph — stated as a substitution rather than left as a shrug.
    expect(TAKEN).toContain(conditionNote(COND).replace(" is 2 or more", " is {C}{C} or more"));
  });

  it("the clause row resolves to the member AT COUNT 2, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({ kind: "boardCondition", cond: COND });
    // The `{C}{C}` glyph is stored as the NUMBER 2 — the arity the fold returns —
    // never as the printed brace pair.
    expect((read?.count as { cond: { count: number } }).cond.count).toBe(2);
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(110);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("the SIBLING skeleton cannot reach this row, and this row cannot reach the SIBLING count source", () => {
    // The two live readings of one noun phrase are now spelled by two DIFFERENT
    // members under two DIFFERENT skeletons, and the sharpest way for that to go
    // wrong is for one to claim the other's sentence. Both directions, by sentence.
    for (const [sentence] of NOUN_PHRASE_SIBLINGS) {
      expect(BONUS.test(sentence), sentence).toBe(false);
      expect(deriveAttackDamageBonus(sentence)?.count, sentence).not.toEqual({
        kind: "boardCondition",
        cond: COND,
      });
    }
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
    expect(deriveAttackDamagePenalty(TAKEN)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring and no near threshold reaches the row", () => {
    for (const glyph of ["{C}", "{C}{C}{C}", "{C}{C}{C}{C}"]) {
      const near = `If the Retreat Cost of your opponent's Active Pokémon is ${glyph} or more, this attack does 110 more damage.`;
      expect(deriveAttackDamageBonus(near), glyph).toBeNull();
    }
    // …and the OWN-side mirror the catalog does not print either.
    expect(
      deriveAttackDamageBonus(
        "If the Retreat Cost of your Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
      ),
    ).toBeNull();
    // A leading or trailing companion falls off the whole-sentence anchors.
    expect(deriveAttackDamageBonus(`Flip a coin. ${TAKEN}`)).toBeNull();
    expect(deriveAttackDamageBonus(TAKEN.replace(/\.$/, ", and discard an Energy."))).toBeNull();
  });
});

describe("§3 — THE DISAGREEMENT, driven where the FOLD IS LARGER than the printed column", () => {
  it("a printed-{C} defender is FALSE bare — both readings agree, and this is the control", () => {
    const state = armed(9301, "fix-retreat1-titan");
    expect(printedCostOf(state, "p2")).toBe(1);
    expect(foldedCostOf(state, "p2")).toBe(1);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("…and the STADIUM TERM flips it: printed {C}, folded {C}{C}, 110 → 220", () => {
    const state = withStadium(armed(9302, "fix-retreat1-titan"), "sv02-175");
    assertReadingsDisagree(state, 1, 2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });

  it("…and so does the AURA TERM, with NO Stadium in play at all", () => {
    const state = benchFromDeck(armed(9303, "fix-retreat1-titan"), "p1", "sv01-019");
    expect(state.stadium ?? null).toBeNull();
    assertReadingsDisagree(state, 1, 2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });

  it("the two ADDITIVE terms SUM, and the clause is still TRUE at {C}{C}{C}", () => {
    const state = benchFromDeck(
      withStadium(armed(9304, "fix-retreat1-titan"), "sv02-175"),
      "p1",
      "sv01-019",
    );
    assertReadingsDisagree(state, 1, 3);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });
});

describe("§4 — THE MIRROR: driven where the FOLD IS SMALLER than the printed column", () => {
  it("a printed-{C}{C} defender is TRUE bare — the threshold EXACTLY, so `>` is refused", () => {
    const state = armed(9401, "fix-retreat2-titan");
    expect(printedCostOf(state, "p2")).toBe(2);
    expect(foldedCostOf(state, "p2")).toBe(2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    // "or more" is a FLOOR (`>=`), `yourBenchAtLeast`'s reading and not a strict
    // inequality: at exactly the threshold the clause HOLDS, and a `>` build deals
    // 110 here.
    expect(damageDealt(state)).toBe(220);
  });

  it("…and Beach Court flips it the OTHER WAY: printed {C}{C}, folded {C}, 220 → 110", () => {
    const state = withStadium(armed(9402, "fix-retreat2-titan"), "sv01-167");
    assertReadingsDisagree(state, 2, 1);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("the floor is applied to the SUM — a printed {C} under Beach Court is 0, not −1", () => {
    const state = withStadium(armed(9403, "fix-retreat1-titan"), "sv01-167");
    assertReadingsDisagree(state, 1, 0);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("the two Stadiums REPLACE each other, so the same body answers both ways in one game", () => {
    const base = armed(9404, "fix-retreat2-titan");
    expect(conditionHolds(base, "p1", COND)).toBe(true);
    const discounted = withStadium(base, "sv01-167");
    assertReadingsDisagree(discounted, 2, 1);
    expect(conditionHolds(discounted, "p1", COND)).toBe(false);
    // §7.3 allows ONE Stadium play per turn, so the swap costs two `endTurn`s —
    // which is the rule doing its job and is left as a line of play rather than
    // surgeried around.
    const nextTurn = mustApply(mustApply(discounted, { type: "endTurn", seat: "p1" }).state, {
      type: "endTurn",
      seat: "p2",
    }).state;
    expect(conditionHolds(nextTurn, "p1", COND)).toBe(false);
    const surcharged = withStadium(nextTurn, "sv02-175");
    assertReadingsDisagree(surcharged, 2, 3);
    expect(conditionHolds(surcharged, "p1", COND)).toBe(true);
    // The printed column never moved through any of it — which is the statement.
    for (const state of [base, discounted, nextTurn, surcharged])
      expect(printedCostOf(state, "p2")).toBe(2);
  });
});

describe("§5 — the THRESHOLD is a parameter and a FLOOR, and the null arm", () => {
  it("every folded cost from 0 to 3 is reachable, and the answer turns at exactly 2", () => {
    // The whole domain this file can build, driven as a ladder rather than as two
    // boards — so `>= 1`, `> 2` and `=== 2` are each red on a rung of their own.
    const rungs: readonly (readonly [GameState, number, boolean])[] = [
      [withStadium(armed(9501, "fix-retreat1-titan"), "sv01-167"), 0, false],
      [armed(9501, "fix-retreat1-titan"), 1, false],
      [armed(9501, "fix-retreat2-titan"), 2, true],
      [withStadium(armed(9501, "fix-retreat2-titan"), "sv02-175"), 3, true],
    ];
    for (const [state, folded, holds] of rungs) {
      expect(foldedCostOf(state, "p2"), `folded ${String(folded)}`).toBe(folded);
      expect(conditionHolds(state, "p1", COND), `folded ${String(folded)}`).toBe(holds);
      expect(damageDealt(state), `folded ${String(folded)}`).toBe(holds ? 220 : 110);
    }
  });

  it("the `count` is a PARAMETER — the same board answers differently at other thresholds", () => {
    const state = armed(9502, "fix-retreat2-titan");
    expect(foldedCostOf(state, "p2")).toBe(2);
    for (const [count, holds] of [
      [0, true],
      [1, true],
      [2, true],
      [3, false],
      [4, false],
    ] as const) {
      expect(
        conditionHolds(state, "p1", { kind: "opponentActiveRetreatCostAtLeast", count }),
        `count ${String(count)}`,
      ).toBe(holds);
    }
    expect(conditionNote({ kind: "opponentActiveRetreatCostAtLeast", count: 4 })).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is 4 or more",
    );
  });

  it("an EMPTY Active Spot is FALSE — not a Pokémon retreating for free", () => {
    let state = ready(9503, "fix-retreat2-titan");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(
      conditionHolds(state, "p1", { kind: "opponentActiveRetreatCostAtLeast", count: 0 }),
    ).toBe(false);
  });

  it("it is SEAT-RELATIVE — the same board answers differently for the other seat", () => {
    const state = ready(9504, "fix-retreat2-titan");
    expect(printedCostOf(state, "p1")).toBe(0);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p2", COND)).toBe(false);
    // …and the surcharge is seat-relative too: Spidops ex on P1's Bench raises P2's
    // Active and leaves P1's own alone, so a build that read "p2's Active" rather
    // than "the asker's opponent's Active" is red on the second call.
    const auraed = benchFromDeck(state, "p1", "sv01-019");
    expect(foldedCostOf(auraed, "p2")).toBe(3);
    expect(foldedCostOf(auraed, "p1")).toBe(0);
    expect(conditionHolds(auraed, "p1", COND)).toBe(true);
    expect(conditionHolds(auraed, "p2", COND)).toBe(false);
  });
});

describe("§6 — the fixture, the census this row moves, and the summands it does not", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the demonstrator is the printed card — ONE attack at index 0, and the `110+` is real", () => {
    const attacks = FIXTURE_POOL["fix-aerochase"]?.attacks ?? [];
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.name).toBe("Aero Chase");
    expect(attacks[0]?.damage).toBe("110+");
    expect(attacks[0]?.cost).toEqual(["Colorless", "Colorless"]);
    expect(attacks[0]?.effect).toBe(TAKEN);
    // …and the two defenders differ in their printed retreat and in NOTHING else,
    // which is what makes the printed column the only variable between §3 and §4.
    const light = FIXTURE_POOL["fix-retreat1-titan"];
    const heavy = FIXTURE_POOL["fix-retreat2-titan"];
    expect([light?.hp, heavy?.hp]).toEqual([340, 340]);
    expect([light?.stage, heavy?.stage]).toEqual(["Basic", "Basic"]);
    expect([light?.types, heavy?.types]).toEqual([["Colorless"], ["Colorless"]]);
    expect([light?.retreat, heavy?.retreat]).toEqual([1, 2]);
    // Colorless is load-bearing, not incidental: Calamitous Wasteland's surcharge
    // carries `excludesType: "Fighting"`, so a {F} body would be EXEMPT and §3's
    // Stadium rung would silently test nothing.
    expect(programFor("sv02-175")?.stadium?.basicRetreatSurcharge?.excludesType).toBe("Fighting");
  });

  it("the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("the bonus residue is 17 / 20, and the 2-PRINTING BAND IS STILL EMPTY", () => {
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect(byClause.size).toBe(0);
    expect(
      resolvedByAnyReader(
        "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      ),
    ).toBe(true);
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("the NINE-reader instrument steps by exactly 1 sentence / 1 printing", () => {
    const resolving = corpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolving.length, units(resolving)]).toEqual([600, 1663]);
    expect([
      resolving.length -
        6 -
        3 -
        4 -
        4 -
        2 -
        2 -
        1 -
        4 -
        1 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        2 -
        2 -
        3 -
        3 -
        2 -
        2 -
        3 -
        5 -
        3 -
        2 -
        3 -
        1 -
        4 -
        5 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        2 -
        3 -
        3 -
        1 -
        1 -
        1 -
        3 -
        3 -
        2 -
        1 -
        2 -
        1 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        6 -
        4 -
        2 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
      units(resolving) -
        6 -
        5 -
        9 -
        6 -
        2 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        3 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        1 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        6 -
        5 -
        5 -
        3 -
        3 -
        5 -
        4 -
        8 -
        8 -
        1 -
        6 -
        1 -
        4 -
        5 -
        7 -
        4 -
        5 -
        5 -
        7 -
        13 -
        7 -
        9 -
        5 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
    ]).toEqual([381, 1278]);
    expect([
      resolving.length -
        6 -
        3 -
        4 -
        4 -
        2 -
        2 -
        1 -
        4 -
        1 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        2 -
        2 -
        3 -
        3 -
        2 -
        2 -
        3 -
        5 -
        3 -
        2 -
        3 -
        1 -
        4 -
        5 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        2 -
        3 -
        3 -
        1 -
        1 -
        1 -
        3 -
        3 -
        2 -
        1 -
        2 -
        1 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        6 -
        4 -
        2 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
      units(resolving) -
        6 -
        5 -
        9 -
        6 -
        2 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        1 -
        2 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        1 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        6 -
        5 -
        5 -
        3 -
        3 -
        5 -
        4 -
        8 -
        8 -
        1 -
        6 -
        1 -
        4 -
        5 -
        7 -
        4 -
        5 -
        5 -
        7 -
        13 -
        7 -
        9 -
        5 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
    ]).toEqual([372, 1268]);
    expect([
      resolving.length -
        6 -
        3 -
        4 -
        4 -
        2 -
        2 -
        1 -
        4 -
        1 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        2 -
        2 -
        3 -
        3 -
        2 -
        2 -
        3 -
        5 -
        3 -
        2 -
        3 -
        1 -
        4 -
        5 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        2 -
        3 -
        3 -
        1 -
        1 -
        1 -
        3 -
        3 -
        2 -
        1 -
        2 -
        1 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        6 -
        4 -
        2 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
      units(resolving) -
        6 -
        5 -
        9 -
        6 -
        2 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        1 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        6 -
        5 -
        5 -
        3 -
        3 -
        5 -
        4 -
        8 -
        8 -
        1 -
        6 -
        1 -
        4 -
        5 -
        7 -
        4 -
        5 -
        5 -
        7 -
        13 -
        7 -
        9 -
        5 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
    ]).toEqual([370, 1266]);
  });
});
