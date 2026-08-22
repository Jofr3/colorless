import { describe, expect, it } from "vitest";
import { isStage1Pokemon, isStage2Pokemon } from "./cards";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
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

// 🆕🆕 D387 — A SUBSET THAT IS NOT A NARROWING, AND THE FIRST SLICE IN THIS RUN
// WHOSE WINNER IS WORTH A SINGLE PRINTING.
//
// D386 handed over TWO candidates and ordered the SHAPE question settled before the
// price one (D368's rule): the face-up PRIZE row at **2 printings / 9 mechanisms =
// 0.22**, and this one at **1 / 3 = 0.33** — with the warning that
// `opponentActiveIsEvolution` is `evolveFromOf(top) !== null`, *"which a Stage 1
// ALSO satisfies, so this is a NARROWING of a live member"*, and D362 prices a
// narrowing at 31 sites across 7 files.
//
// 🛑 **THE SET RELATION IS A SUBSET AND THE BUILD IS NOT A NARROWING, AND THOSE ARE
// DIFFERENT CLAIMS.** A member is narrowed by changing what its own arms read.
// Nothing here changes: `opponentActiveIsEvolution` keeps its predicate, keeps its
// clause row — FOUR printed sentences worth NINE legal printings, every one of them
// spelling the word *"Evolution"* — and keeps both exhaustive-switch arms. §1 drives
// that rather than asserting it, so the third mechanism really is free and the
// handed price stands. D296 wrote this paragraph one stage UP as a warning; this is
// the first slice to need it as an ANSWER.
//
// WHAT SHIPS: **1 `cards.ts` predicate** (`isStage1Pokemon`), **1 union member**
// (`opponentActiveIsStage1`) with **2 reader arms**, and **1 literal clause row**.
// Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, 90+, **+90**, index 1 of
// two), **1 legal printing**. `MATCH_RECORD_VERSION` **STAYS 23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    `undamagedBonus.test.ts` and `benchNamedBonus.test.ts` use. */
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
];
const resolvedByAnyReader = (text: string): boolean => READERS.some((read) => read(text) !== null);

/** THE SENTENCE THIS SLICE BUYS, byte for byte off the printing. */
const TAKEN = "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.";

/** The one id behind it — Paldean Tauros `sv08-018`, "Spirited Tackle" at index 1
    of two, confirmed by id against tcgdex (`/v2/en/cards/sv08-018`), which returns
    "Rear Kick" ({R}, 30, NO effect text) at index 0, 130 HP, `stage: "Basic"` and
    `types: ["Fire"]`. The printing count is `legalAttackCorpus()`'s, not the web's. */
const TAKEN_ID = "sv08-018";

/** The clause the member this slice does NOT touch already carries, at every
    printed amount and under BOTH of the family's consequents. Nine legal printings
    across four sentences, and all nine spell the word "Evolution". */
const EVOLUTION_SENTENCES: readonly (readonly [string, number])[] = [
  [
    "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.",
    5,
  ],
  ["If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.", 1],
  ["If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 80 more damage.", 2],
  ["If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 90 more damage.", 1],
];

/** The stage ladder this file's deck IS — one body per printed `stage` word, with
    what each one is here to refuse. */
const LADDER: readonly (readonly [string, string, boolean])[] = [
  ["fix-bigbody", "Basic", false],
  ["fix-stage1-big", "Stage1", true],
  ["fix-stage2", "Stage2", false],
  ["fix-vstar-big", "VSTAR", false],
];

/** …and the FIFTH rung, which is not in this file's deck and is driven by the card
    predicate alone: a body that IS a Stage 1 by the printed word and is NOT an
    Evolution by the chain datum. It is the direction the handoff's "a Stage 1 ALSO
    satisfies `evolveFromOf(...) !== null`" does not reach. */
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
  it("🛑 the sentence is real, is worth ONE printing, and was refused at D386's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // It reaches the skeleton and used to miss at the table — refused by VOCABULARY
    // and never by the ANCHOR, which is D363's distinction and an order of magnitude
    // in price.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("90");
  });

  it("🛑 the SUBSET is a CATALOG COINCIDENCE, not a rule — and the pool prints the exception", () => {
    // 🛑 **THE HALF OF THE HANDOFF'S WARNING THAT LOOKED SAFEST IS THE ONE THE
    // MEASUREMENT MOVED.** "Every Stage 1 is an Evolution" reads like a rule of the
    // game, and it is really a fact about two INDEPENDENT columns: `stage` is a
    // printed word and `evolveFrom` is a chain datum, and nothing makes them agree.
    // Swept over the pool: 67 bodies carry `stage: "Stage1"`, and **ONE of them has a
    // NULL `evolveFrom`** — `fix-exstage1` ("Fixgrown ex"), a synthetic body written
    // for another suite. So on this engine's own data the two readings disagree in
    // BOTH directions, and a build that had reached for "any Evolution" would have
    // been leaning on a coincidence rather than on a rule.
    const pokemon = Object.values(FIXTURE_POOL).filter((c) => c.category === "Pokemon");
    const stage1 = pokemon.filter((c) => isStage1Pokemon(c));
    // 🆕🆕 D390 — 67 -> **68**, and the mover is again a slice that is not about stages:
    // `fix-shortcircuit` is Electivire, a printed Stage 1, added by the OPPONENT-SEAT
    // TYPE READ. 🛑 ITS `evolveFrom` IS TRANSCRIBED ("Electabuzz") PRECISELY SO THIS
    // FILE'S FINDING SURVIVES — a synthetic Stage 1 with a null chain would have made
    // the singleton below a pair and turned an inherited measurement into an artefact.
    // 🆕🆕 D391 — 68 -> **69**: `fix-frozenwood`, the Abomasnow demonstrator, is a
    // Stage 1 — and its `evolveFrom` is the printed `"Snover"` precisely so THIS file's
    // chainless-Stage-1 rung below stays at ONE. D390 paid that lesson; this row is it applied.
    expect(stage1).toHaveLength(69);
    const chainless = stage1.filter((c) => (c.evolveFrom ?? null) === null);
    expect(chainless.map((c) => c.id)).toEqual(["fix-exstage1"]);
    // …and no Stage 1 is also a Stage 2, which is the only part of the ladder that IS
    // structural: `stage` holds one word.
    for (const card of stage1) expect(isStage2Pokemon(card), card.id).toBe(false);
    // The other direction, which is the one the handoff named: 23 bodies are an
    // Evolution by the chain datum and NOT a Stage 1 by the printed word, so the
    // wide member is TRUE on a whole population this member must refuse.
    const evolutions = pokemon.filter((c) => (c.evolveFrom ?? null) !== null);
    // 🆕🆕 D388 — 24 -> **25**, and the mover is a SLICE THAT IS NOT ABOUT STAGES AT
    // ALL: `fix-aerochase` is a Stage 2 with a named `evolveFrom`, so the RETREAT-COST
    // slice's demonstrator lands squarely in this population. **THE NUMBER THIS RUNG
    // CARRIES IS A FACT ABOUT THE WHOLE POOL, NOT ABOUT THIS FILE'S DECK** — which is
    // exactly why it is derived live and re-measured rather than frozen.
    expect(evolutions.filter((c) => !isStage1Pokemon(c))).toHaveLength(25);
  });

  it("🛑 …and the BUILD is not a narrowing: the wide member keeps all NINE printings", () => {
    // THE MEASUREMENT THAT SETTLES D362's QUESTION. A narrowing changes what a live
    // member's own arms read, and D362 prices that against every existing consumer.
    // `opponentActiveIsEvolution` has THREE consumers — its clause row and the two
    // exhaustive `switch (cond.kind)` statements — and none of them moves. The clause
    // row is driven by sentence, at every printed amount and under both consequents.
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
    // …and on a STAGE 1 board the wide member is STILL TRUE, which is the exact
    // board a narrowing would have taken away from those nine printings.
    const stage1 = ready(6100, "fix-stage1-big");
    expect(conditionHolds(stage1, "p1", { kind: "opponentActiveIsEvolution" })).toBe(true);
    expect(conditionHolds(stage1, "p1", { kind: "opponentActiveIsStage1" })).toBe(true);
  });

  it("the price, as arithmetic rather than as prose — 1 / 3 against the Prize row's 2 / 9", () => {
    // D382's practice, inherited by five consecutive slices. The mechanisms are
    // counted D386's way ("the member plus its two arms" is ONE): a `cards.ts`
    // predicate, the member with its two arms, and the clause row.
    const mine = { printings: 1, mechanisms: 3 };
    const prizeRow = { printings: 2, mechanisms: 9 };
    expect(mine.printings).toBe(units(corpus().filter(([, s]) => s === TAKEN)));
    expect(mine.printings / mine.mechanisms).toBeGreaterThan(
      prizeRow.printings / prizeRow.mechanisms,
    );
    // …and the loser's printing count is still what D385 measured, so the comparison
    // is between two live numbers and not between a live one and a remembered one.
    const prizeSentence =
      "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
    expect(units(corpus().filter(([, s]) => s === prizeSentence))).toBe(prizeRow.printings);
    expect(resolvedByAnyReader(prizeSentence)).toBe(false);
  });
});

describe("§2 — the clause row: one member, two arms, and the anchors that keep it in", () => {
  it("🛑 buys ONE member with TWO arms — the two exhaustive switches, and no more", () => {
    // The claim that makes this purchase flat, DRIVEN rather than asserted: the
    // member answers on a board AND renders a note, which are the two exhaustive
    // `switch (cond.kind)` statements in the repo.
    const cond: BoardCondition = { kind: "opponentActiveIsStage1" };
    expect(typeof conditionHolds(ready(6200, "fix-stage1-big"), "p1", cond)).toBe("boolean");
    // The note is the PRINTED clause verbatim — this card spells the adjective as a
    // whole clause already, so unlike D296's there is no noun phrase to re-voice.
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
    // The amount is captured one layer up, never off the clause row — which is why
    // this one row would serve a second printed amount for free.
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

  it("🛑 the Stage 2 row is ONE PRINTED DIGIT away and neither reaches the other", () => {
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
    // The two CLAUSES differ by exactly that digit, stated so the near-miss is
    // measured rather than described. Keys are whole printed clauses and never
    // substrings, which is what makes "neither reaches the other" structural.
    const a = BONUS.exec(TAKEN)?.[1] ?? "";
    const b = BONUS.exec(stage2)?.[1] ?? "";
    expect(a.replace("Stage 1", "Stage 2")).toBe(b);
    expect(a).not.toBe(b);
  });
});

describe("§3 — the stage LADDER: the four sibling members driven apart on one deck", () => {
  it("🛑 the truth table of one printed word, one body per rung", () => {
    // THE BOARD THAT REFUSES BOTH WRONG SPELLINGS AT ONCE. `evolveFromOf(...) !==
    // null` ("any Evolution") is TRUE on three of these four rungs and this member is
    // TRUE on exactly one; "not Basic and not Stage 2" is TRUE on two. The VSTAR is
    // the rung that separates the second pair, and it carries a NON-NULL `evolveFrom`
    // on purpose so it is an Evolution by the chain datum and not a Stage 1 by the
    // printed word — D262's VSTAR clause, one stage down.
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

  it("🛑 the FIFTH rung: a Stage 1 that is NOT an Evolution, and the two readings part", () => {
    // The rung the handoff's warning cannot reach, and the reason this member is a
    // CARD read rather than a rider on the wide one. `fix-exstage1` prints
    // `stage: "Stage1"` with a NULL `evolveFrom`, so the printed word says Stage 1 and
    // the chain datum says Basic-or-nothing. It is not in this file's deck — the
    // predicate is driven directly, because what is being separated is two COLUMNS of
    // one card and not two boards.
    const card = FIXTURE_POOL[CHAINLESS_STAGE1];
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom ?? null).toBeNull();
    expect(card === undefined ? null : isStage1Pokemon(card)).toBe(true);
    // …and the wide member's own predicate says the opposite on the same card, which
    // is what makes "a subset" a statement about the catalog rather than about the code.
    expect((card?.evolveFrom ?? null) !== null).toBe(false);
  });

  it("🛑 an EMPTY Active Spot is FALSE, and so is a defender that is not a Pokémon", () => {
    // The null arm every member in this family carries. The attack gate guarantees a
    // Defending Pokémon at the one live read site, so this covers the
    // directly-invoked edge — and it is FALSE rather than a throw.
    let state = ready(6301, "fix-stage1-big");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(false);
    // …and the CARD predicate refuses a Trainer and an Energy outright, which is the
    // one way `isStage1Pokemon` could have been written wrong (a `stage` equality with
    // no `category` conjunct answers `undefined === "Stage1"` and is merely false by
    // luck — this states it).
    const item = FIXTURE_POOL["fix-item"];
    const energy = FIXTURE_POOL["fix-energy"];
    expect(item?.category).toBe("Trainer");
    expect(energy?.category).toBe("Energy");
    expect(item === undefined ? null : isStage1Pokemon(item)).toBe(false);
    expect(energy === undefined ? null : isStage1Pokemon(energy)).toBe(false);
  });

  it("it is SEAT-RELATIVE — the same board answers differently for the other seat", () => {
    // P1's Active is the printed Basic attacker and P2's is the Stage 1, so the two
    // seats must disagree. This is the shape the still-open seat-parameter question
    // (D365/D366) needs concrete boards for.
    const state = ready(6302, "fix-stage1-big");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsStage1" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveIsStage1" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveIsBasic" })).toBe(true);
  });
});

describe("§4 — the LITERAL row won, and the token map learned nothing", () => {
  it("🛑 the loose type template still MISSES 'Stage 1' — proved on a template with no row", () => {
    // `OPPONENT_ACTIVE_TYPE_CLAUSE` captures `(.+)`, so this slice's clause reaches
    // `CLAUSE_POKEMON_TYPES` and misses it; `boardConditionForClause` consults the
    // LITERAL table first, so the row wins outright. The control is the SAME token
    // handed to a template that shares that map and has NO literal row behind it —
    // if the map had learned "Stage 1", this would resolve too.
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    // …and the row this slice DID buy resolves, on the very same token.
    expect(deriveAttackDamageBonus(TAKEN)).not.toBeNull();
  });

  it("every other non-type stays LOUD through the same pattern", () => {
    for (const notAType of ["Stage 3", "Tera", "Evolution", "{Z}", "{}", "constructor"]) {
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

  it("🛑 the defender BECOMES a Stage 1 by a real §10 evolve, and the bonus switches on", () => {
    // THE RUNG THAT MAKES "the TOP card is the current identity" (§1.2) a line of
    // play rather than surgery. The same body is the FALSE arm and then the TRUE one:
    // `fix-stage1-big` evolves from `fix-bigbody`, so nothing about the board changes
    // except the printed word on top of the stack.
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
    // The fixture carries BOTH printings at their printed indices (D306), so the
    // index under test is a claim about the card rather than about the fixture.
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
  it("🛑 the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    // The standing-still of the other summands, MEASURED not assumed: a
    // READER-keyed move must be shown not to touch the REGISTRY-keyed one.
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("🛑 the bonus residue is 18 / 21, and the 2-PRINTING BAND IS STILL EMPTY", () => {
    // Re-derived from the parts rather than quoted, and the DEPARTURE is what the
    // band rung asserts (D379's saturation rule): an absence is not a measurement,
    // so the whole distribution is stated and the refusal is driven from OUTSIDE
    // the emptied band.
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕 D388 — 18 / 21 -> **17 / 20**: the RETREAT-COST THRESHOLD left this residue
    // — ONE sentence at ONE printing (Talonflame `sv07-123` "Aero Chase", +110) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 16, 5: 1}` -> `{1: 15, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D389 — 17 / 20 -> **16 / 19**: the OPPONENT-SEAT BENCH COUNT left this
    // residue — ONE sentence at ONE printing (Iron Crown `sv08-132` "Deleting Slash",
    // +80) — re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS
    // EMPTY and the distribution goes `{1: 15, 5: 1}` -> `{1: 14, 5: 1}`, so every
    // band rung is still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D390 — 16 / 19 -> **15 / 18**: the OPPONENT-SEAT TYPE READ left this
    // residue — ONE sentence at ONE printing (Electivire `sv05-054` "Short-Circuit
    // Knuckle", +120) — re-derived live rather than decremented. 🛑 THE 2-PRINTING
    // BAND STAYS EMPTY and the distribution goes `{1: 14, 5: 1}` -> `{1: 13, 5: 1}`,
    // so every band rung is still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D391 — 15 / 18 -> **14 / 17**: the TYPED PER-BODY ENERGY THRESHOLD left this
    // residue — ONE sentence at ONE printing (Abomasnow `sv10-060` "Frozen Wood", +120) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and the
    // distribution goes `{1: 13, 5: 1}` -> `{1: 12, 5: 1}`, so every band rung is still aimed
    // at the WHOLE distribution (D379). ⚠️ AND IT IS THE FIRST STEP IN THIS RUN TAKEN BY AN
    // OPTIONAL FIELD ON A SHIPPED MEMBER rather than by a new one.
    expect([refused.length, units(refused)]).toEqual([14, 17]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D387 — `{1: 17, 5: 1}` → `{1: 16, 5: 1}`. The band `n > 1` is STILL `[5]`
    // and still the DECLARATION clause D368 disqualified on SHAPE, which is outside
    // the 2-printing band by construction and is what keeps this rung able to go red
    // for the reason that matters: a reader narrowing so any clause returns to 2
    // fails it, as does that clause being claimed.
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left the singleton band,
    // the same trade one slice on — a 1-printing clause bought for ONE parameterised
    // member plus one anchored template. The band above is STILL empty, and the only
    // clause left above one printing is the 5-printing declaration one, disqualified
    // on SHAPE.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(12);
    // 🆕🆕 D388 — 17 -> **16**: the RETREAT-COST THRESHOLD left the 1-printing band,
    // which is the ONLY band that moved. The 2-printing band was already empty and stays
    // empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D389 — 16 -> **15**, and 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT BENCH
    // COUNT and then the OPPONENT-SEAT TYPE READ, each a singleton leaving the same band.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    expect(byClause.size).toBe(13);
    expect(
      resolvedByAnyReader(
        "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      ),
    ).toBe(false);
    // …and this slice's sentence has LEFT the residue, which is the step itself.
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });
});
