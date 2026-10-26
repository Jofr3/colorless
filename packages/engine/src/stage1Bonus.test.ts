import { describe, expect, it } from "vitest";
import { isStage1Pokemon, isStage2Pokemon } from "./cards";
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
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  STAGE1_BONUS_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
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

const TAKEN =
  "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.";

const TAKEN_ID = "sv08-018";

const EVOLUTION_SENTENCES: readonly (readonly [string, number])[] = [
  [
    "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.",
    5,
  ],
  [
    "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
    1,
  ],
  [
    "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 80 more damage.",
    2,
  ],
  [
    "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 90 more damage.",
    1,
  ],
];

/** The stage ladder this file's deck IS — one body per printed `stage` word, with
    what each one is here to refuse. */
const LADDER: readonly (readonly [string, string, boolean])[] = [
  ["fix-bigbody", "Basic", false],
  ["fix-stage1-big", "Stage1", true],
  ["fix-stage2", "Stage2", false],
  ["fix-vstar-big", "VSTAR", false],
];

const CHAINLESS_STAGE1 = "fix-exstage1";

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  return driveSetup(seed, { p1: STAGE1_BONUS_DECK, p2: STAGE1_BONUS_DECK }, { first: "p2" });
}

/** P1 fields the printed attacker with {R}{C}{C} paid, P2 fields `defender`, and
    BOTH benches start EMPTY — each board puts exactly the bodies it is about.
    Returned on P2's turn, so the callers that need turns can run them. */
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-spirited");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(clearBench(state, "p1"), "p2");
}

/** …and the same board handed to P1 with the turn already passed. */
function armed(seed: number, defender: string): GameState {
  return mustApply(ready(seed, defender), { type: "endTurn", seat: "p2" }).state;
}

/** Attack INDEX 1 — the printed index of "Spirited Tackle" — and report the damage
    actually dealt. */
function damageDealt(state: GameState): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 1 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the SHAPE question, settled from the catalog before the price one", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the sentence is real, is worth ONE printing, and was refused at D386's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("90");
  });

  it("the SUBSET is a CATALOG COINCIDENCE, not a rule — and the pool prints the exception", () => {
    const pokemon = Object.values(FIXTURE_POOL).filter((c) => c.category === "Pokemon");
    const stage1 = pokemon.filter((c) => isStage1Pokemon(c));
    expect(stage1).toHaveLength(84);
    const chainless = stage1.filter((c) => (c.evolveFrom ?? null) === null);
    expect(chainless.map((c) => c.id)).toEqual(["fix-exstage1"]);
    // …and no Stage 1 is also a Stage 2, which is the only part of the ladder that IS
    // structural: `stage` holds one word.
    for (const card of stage1) expect(isStage2Pokemon(card), card.id).toBe(false);
    // The other direction, which is the one the handoff named: 23 bodies are an
    // Evolution by the chain datum and NOT a Stage 1 by the printed word, so the
    // wide member is TRUE on a whole population this member must refuse.
    const evolutions = pokemon.filter((c) => (c.evolveFrom ?? null) !== null);
    expect(evolutions.filter((c) => !isStage1Pokemon(c))).toHaveLength(27);
  });

  it("…and the BUILD is not a narrowing: the wide member keeps all NINE printings", () => {
    let total = 0;
    for (const [sentence, printings] of EVOLUTION_SENTENCES) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      expect(sentence).toContain("is an Evolution Pokémon");
      total += printings;
    }
    expect(total).toBe(9);
    // The two that end in the plain payoff still read the WIDE member…
    for (const [sentence] of EVOLUTION_SENTENCES.filter(([s]) => BONUS.test(s))) {
      expect(deriveAttackDamageBonus(sentence)?.count, sentence).toEqual({
        kind: "boardCondition",
        cond: { kind: "opponentActiveIsEvolution" },
      });
    }
    const stage1 = ready(6100, "fix-stage1-big");
    expect(conditionHolds(stage1, "p1", { kind: "opponentActiveIsEvolution" })).toBe(true);
    expect(conditionHolds(stage1, "p1", { kind: "opponentActiveIsStage1" })).toBe(true);
  });

  it("the price, as arithmetic rather than as prose — 1 / 3 against the Prize row's 2 / 9", () => {
    const mine = { printings: 1, mechanisms: 3 };
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

describe("§2 — the clause row: one member, two arms, and the anchors that keep it in", () => {
  it("buys ONE member with TWO arms — the two exhaustive switches, and no more", () => {
    // The claim that makes this purchase flat, DRIVEN rather than asserted: the
    // member answers on a board AND renders a note, which are the two exhaustive
    // `switch (cond.kind)` statements in the repo.
    const cond: BoardCondition = { kind: "opponentActiveIsStage1" };
    expect(typeof conditionHolds(ready(6200, "fix-stage1-big"), "p1", cond)).toBe("boolean");
    expect(conditionNote(cond)).toBe("your opponent's Active Pokémon is a Stage 1 Pokémon");
    expect(TAKEN).toContain(conditionNote(cond));
  });

  it("the clause row resolves to the member, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage1" },
    });
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(90);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches the row", () => {
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 90 more damage.`)).toBeNull();
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 90 more damage`)).toBeNull();
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 90 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });

  it("the Stage 2 row is ONE PRINTED DIGIT away and neither reaches the other", () => {
    const stage2 =
      "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.";
    expect(deriveAttackDamageBonus(stage2)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage2" },
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage1" },
    });
    const a = BONUS.exec(TAKEN)?.[1] ?? "";
    const b = BONUS.exec(stage2)?.[1] ?? "";
    expect(a.replace("Stage 1", "Stage 2")).toBe(b);
    expect(a).not.toBe(b);
  });
});

describe("§3 — the stage LADDER: the four sibling members driven apart on one deck", () => {
  it("the truth table of one printed word, one body per rung", () => {
    for (const [id, stage, expected] of LADDER) {
      expect(FIXTURE_POOL[id]?.stage, id).toBe(stage);
      const state = ready(6300, id);
      expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" }), id).toBe(expected);
      expect(conditionHolds(state, "p1", { kind: "opponentActiveIsBasic" }), id).toBe(
        stage === "Basic",
      );
      expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage2" }), id).toBe(
        stage === "Stage2",
      );
      expect(conditionHolds(state, "p1", { kind: "opponentActiveIsEvolution" }), id).toBe(
        stage !== "Basic",
      );
    }
    // The ladder really is four DISTINCT printed words, so no rung is a duplicate of
    // another dressed up — the thing a hand-kept table rots into.
    expect(new Set(LADDER.map(([, stage]) => stage)).size).toBe(4);
  });

  it("the FIFTH rung: a Stage 1 that is NOT an Evolution, and the two readings part", () => {
    const card = FIXTURE_POOL[CHAINLESS_STAGE1];
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom ?? null).toBeNull();
    expect(card === undefined ? null : isStage1Pokemon(card)).toBe(true);
    // …and the wide member's own predicate says the opposite on the same card, which
    // is what makes "a subset" a statement about the catalog rather than about the code.
    expect((card?.evolveFrom ?? null) !== null).toBe(false);
  });

  it("an EMPTY Active Spot is FALSE, and so is a defender that is not a Pokémon", () => {
    // The null arm every member in this family carries. The attack gate guarantees a
    // Defending Pokémon at the one live read site, so this covers the
    // directly-invoked edge — and it is FALSE rather than a throw.
    let state = ready(6301, "fix-stage1-big");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(false);
    const item = FIXTURE_POOL["fix-item"];
    const energy = FIXTURE_POOL["fix-energy"];
    expect(item?.category).toBe("Trainer");
    expect(energy?.category).toBe("Energy");
    expect(item === undefined ? null : isStage1Pokemon(item)).toBe(false);
    expect(energy === undefined ? null : isStage1Pokemon(energy)).toBe(false);
  });

  it("it is SEAT-RELATIVE — the same board answers differently for the other seat", () => {
    const state = ready(6302, "fix-stage1-big");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveIsStage1" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveIsBasic" })).toBe(true);
  });
});

describe("§4 — the LITERAL row won, and the token map learned nothing", () => {
  it("the loose type template still MISSES 'Stage 1' — proved on a template with no row", () => {
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    expect(deriveAttackDamageBonus(TAKEN)).not.toBeNull();
  });

  it("every other non-type stays LOUD through the same pattern", () => {
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 30 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsBanner", banner: "Tera" } });
    for (const notAType of ["Stage 3", "Evolution", "{Z}", "{}", "constructor"]) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon is a ${notAType} Pokémon, this attack does 30 more damage.`,
        ),
        notAType,
      ).toBeNull();
    }
  });
});

describe("§5 — driven on boards: the printed word decides the damage", () => {
  it("a STAGE 1 defender takes 90 + 90", () => {
    expect(damageDealt(armed(6400, "fix-stage1-big"))).toBe(180);
  });

  it("every other rung of the ladder takes the base 90 and nothing more", () => {
    for (const [id, stage, expected] of LADDER) {
      expect(damageDealt(armed(6401, id)), `${id} (${stage})`).toBe(expected ? 180 : 90);
    }
  });

  it("the defender BECOMES a Stage 1 by a real §10 evolve, and the bonus switches on", () => {
    let state = ready(6402, "fix-bigbody");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(false);
    // P2's turn 1 → P1's turn 1 → P2's turn 2. §4 forbids evolving on your own first
    // turn, so the evolve cannot happen any earlier than this.
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = handFromDeck(state, "p2", "fix-stage1-big", 1);
    const uid = state.players.p2.hand[state.players.p2.hand.length - 1] ?? "";
    state = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid,
      target: { spot: "active" },
    }).state;
    expect(state.players.p2.active?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsBasic" })).toBe(false);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(damageDealt(state)).toBe(180);
  });

  it("reads at DECLARATION, off the board in front of the attack", () => {
    const state = armed(6403, "fix-stage1-big");
    expect(state.players.p2.active?.damage).toBe(0);
    const after = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(after.state.players.p2.active?.damage).toBe(180);
    // 220 HP, so the boosted hit does NOT knock out and no prize tail crosses the
    // reading — the reason this file's Stage 1 is not the pool's 90 HP one.
    expect(after.state.players.p2.active).not.toBeNull();
  });

  it("the OTHER printed attack is untouched — index 0 is a real attack, not a hole", () => {
    const attacks = FIXTURE_POOL["fix-spirited"]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Rear Kick");
    expect(attacks[0]?.effect ?? null).toBeNull();
    expect(attacks[1]?.name).toBe("Spirited Tackle");
    expect(attacks[1]?.effect).toBe(TAKEN);
    const after = mustApply(armed(6404, "fix-stage1-big"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
      | { damage?: number }
      | undefined;
    expect(dealt?.damage).toBe(30);
  });
});

describe("§6 — the census this row moves, and the summands it does not", () => {
  it("the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("the bonus residue is 18 / 21, and the 2-PRINTING BAND IS STILL EMPTY", () => {
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
});
