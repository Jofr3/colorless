import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  REVERSAL_ENERGY_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

// D302 — REVERSAL ENERGY `sv04-266`, THE LAST UNBUILT MEMBER OF THE "PROVIDES
// EVERY TYPE OF ENERGY" FAMILY, AND A ROW TWO HANDOFFS REFUSED FOR A REASON THAT
// WAS NEVER TRUE.
//
//   "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//    If you have more Prize cards remaining than your opponent, and if this card
//    is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon
//    ex, Pokémon V, etc. have Rule Boxes), this card provides every type of
//    Energy but provides only 3 Energy at a time."
//
// ── THE CARD WAS READ END TO END, AND FOR THE SECOND SLICE RUNNING THAT REMOVED
//    A PARAGRAPH FROM THE BILL ────────────────────────────────────────────────
// 🛑 `length(effect)` is **337** (remote D1 `luminous`, 2026-08-09), and five
// consecutive resume points priced this row by quoting the SECOND paragraph and
// charging it for all 337 characters. The first paragraph is Jet's, Spiky's,
// Mist's, Neo Upper's, Prism's and Legacy's line verbatim (`provides:
// ["Colorless"]`), shipped since M4 slice 5. D300's card did exactly this; D301
// predicted this card would too and was RIGHT. **Every Special Energy in this
// family prints the provision line first**, which is now a pattern with three
// confirmations rather than an anecdote — so the next unread Energy row should be
// priced at its SECOND paragraph before a blocker is typed against it.
//
// ── THE POPULATION, RE-QUERIED AND KEYED ON `cards.category` ─────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-09:
// `name = 'Reversal Energy'` returns **2 printings** — `sv02-192`
// (`legal_standard = 0`) and `sv04-266` (`legal_standard = 1`, reg mark G, Hyper
// rare). ⚠️ **1 LEGAL, NOT 2**, and the illegal one is a reprint of the same text,
// so a census keyed on the SENTENCE rather than on legality would have doubled it.
// With this row the family's four legal printings (`instr(effect,'provides every
// type of Energy') > 0 AND legal_standard = 1`) are 4 of 4 BUILT: `sv05-162`
// D262, `sv06-167` D298, `sv10.5b-086` D300, `sv04-266` here.
//
// ── 🛑 D300's REFUSAL WAS WRONG IN ITS **TYPE**, NOT MERELY IN ITS SIZE ───────
// It was typed a missing COMPOSITION — *"no `EnergyProgram` field carries a
// two-term board predicate"* — and D301 predicted the honest re-typing would be
// MISSING CODE at one read site. **BOTH ARE WRONG, AND IN THE SAME DIRECTION.**
// There was never a composition to find and no read site was missing:
//   • the antecedent's three terms are not a `BoardCondition` conjunction needing
//     `allOf`; they are THREE DIRECT READS;
//   • continuous.ts had ALREADY IMPORTED the data for two of them before this
//     slice began — `hasRuleBox` on its line 5, `takenPrizes` from types.ts;
//   • the third is `topCardOf`, which `unitsOf` was already calling.
// ⚠️ **AND THE ONE REAL STRUCTURAL FACT IS THE OPPOSITE OF THE ONE NAMED.** The
// vocabulary DOES carry the prize clause — `BoardCondition.morePrizesThanOpponent`,
// whose doc block has listed *"Defiance Band, Luxray and Reversal Energy"* since
// D40, and whose clause table (effects.ts) maps this card's printed words
// **verbatim**. It is unreachable HERE because `conditionHolds` lives in
// interpreter.ts and interpreter.ts imports continuous.ts, so a `BoardCondition`
// read from the provision scan closes an import cycle. That is not a missing
// mechanism: it is a decision this repo already made ONCE and wrote down, at
// `noRetreatCostSelf` (registry.ts), for this exact reason in this exact file.
// **THE BLOCKER WAS A GREP AWAY FOR TWO SLICES AND NEITHER SLICE RAN IT.**
//
// ── WHAT THE ROW COSTS ───────────────────────────────────────────────────────
// `registry.ts` (two OPTIONAL riders + a third stage VALUE on an existing field,
// one new program, two map ids), `continuous.ts` (one 3-way ternary, two guard
// terms, one seat-derivation helper), `cards.ts` (`isEvolutionPokemon`) and
// `testFixtures.ts` (four fixtures + a deck). ZERO new `BoardCondition` members,
// ZERO new `EffectOp`s, ZERO new `GameState` fields, ZERO exported-signature
// changes — the seat the prize comparison needs is DERIVED by `hasFreeRetreatAura`'s
// top-uid trick rather than plumbed through three exported functions.

/** Setup, then open P1's turn 2 (P2 went first and passed) — D262's opener,
    reused whole. Seed-free: nothing in this cast flips a coin. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: REVERSAL_ENERGY_DECK, p2: REVERSAL_ENERGY_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return active;
}

/** P1's SECOND turn — needed only by the EVOLVE boards (§4/§10 refuse an evolve
    on a player's FIRST turn, which is what `p1Turn2` actually opens). */
function p1LaterTurn(seed: number): GameState {
  let state = p1Turn2(seed);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1's turn 2 with `bodyId` Active, `count` copies of `energyId` on it, and P2's
    prize row shrunk to `opponentPrizes`.

    🛑 **THE DEFAULT IS `4`, WHICH MAKES THE PRIZE TERM TRUE, AND THE DEFAULT BOARD
    IS THEREFORE NOT THE NEUTRAL ONE.** A fresh game is 6–6 — EQUAL — and "more
    Prize cards remaining than your opponent" is STRICT, so a fresh board promotes
    nothing. Every case that wants the promotion has to say so, which is the point:
    the term cannot be satisfied by accident here. */
function holding(
  seed: number,
  bodyId: string,
  energyId: string,
  count = 1,
  opponentPrizes = 4,
): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", bodyId);
  state = attachFromDeck(state, "p1", energyId, count);
  return setPrizes(state, "p2", opponentPrizes);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ROW IS DATA, AND ALL THREE TERMS ARE ON IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §1 — Reversal Energy's row, and the paragraph five handoffs did not quote", () => {
  it("🛑 authors the FIRST paragraph — the {C} provision six shipped Energies share", () => {
    // The half the 337-character price was charging for and that was already built.
    expect(programFor("sv04-266")?.energy?.provides).toEqual(["Colorless"]);
    for (const id of ["sv02-190", "sv05-161", "sv05-162", "sv08-191", "sv10.5b-086"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("authors the SECOND paragraph as a stage VALUE plus TWO optional riders", () => {
    expect(programFor("sv04-266")?.energy?.promoteOnHolderStage).toEqual({
      stage: "Evolution",
      noRuleBox: true,
      whileMorePrizesRemaining: true,
      units: [ANY_ENERGY, ANY_ENERGY, ANY_ENERGY],
    });
  });

  it("🛑 the RIDERS ARE OPTIONAL — the family's other two carriers set NEITHER", () => {
    // The widening's whole claim: Neo Upper and Prism reach the same `return` they
    // reached before this slice, because an ABSENT rider is UNGATED. A build that
    // made either rider required, or defaulted it to `true`, breaks both rows —
    // and a build that defaulted it to "false means skip the promotion" breaks
    // them silently, which is why this is asserted on the DATA and driven below.
    for (const id of ["sv05-162", "sv10.5b-086"]) {
      const promote = programFor(id)?.energy?.promoteOnHolderStage;
      expect(promote?.noRuleBox, id).toBeUndefined();
      expect(promote?.whileMorePrizesRemaining, id).toBeUndefined();
    }
    // …and the three carriers now hold three DISTINCT stage values and three
    // DISTINCT unit counts, so no two of them can cover for each other.
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage?.stage).toBe("Basic");
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.stage).toBe("Stage2");
    expect(programFor("sv04-266")?.energy?.promoteOnHolderStage?.stage).toBe("Evolution");
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage?.units).toHaveLength(1);
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toHaveLength(2);
    expect(programFor("sv04-266")?.energy?.promoteOnHolderStage?.units).toHaveLength(3);
  });

  it("🛑 provides THREE wildcard units — the multiset half, observable at the matcher", () => {
    // "…but provides only 3 Energy at a time" is a COUNT. `costMet` consumes a
    // FLAT list, so three entries pay a three-symbol cost and fail a four-symbol
    // one — one layer below any board.
    expect(costMet(["Psychic", "Water", "Fighting"], [ANY_ENERGY, ANY_ENERGY, ANY_ENERGY])).toBe(
      true,
    );
    expect(
      costMet(["Psychic", "Water", "Fighting", "Grass"], [ANY_ENERGY, ANY_ENERGY, ANY_ENERGY]),
    ).toBe(false);
    // And it is none of the other Energy surfaces wearing a new name.
    expect(programFor("sv04-266")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv04-266")?.energy?.passive).toBeUndefined();
    expect(programFor("sv04-266")?.energy?.onAttach).toBeUndefined();
  });

  it("carries the printed sentence on the fixture demonstrator, BOTH paragraphs", () => {
    // `fix-mist-energy`'s idiom: an `sv04` fixture id may not be added (the
    // committed 978-row manifest holds sv01/sv02/sv03/sv06.5 only), so the
    // demonstrator carries the TEXT and the real id carries the PROGRAM — and the
    // two are asserted to be the SAME object.
    const printed =
      "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf you have more Prize cards remaining than your opponent, and if this card is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon ex, Pokémon V, etc. have Rule Boxes), this card provides every type of Energy but provides only 3 Energy at a time.";
    expect(FIXTURE_POOL["fix-reversal-energy"]?.effect).toBe(printed);
    expect(printed).toHaveLength(337); // the remote D1 `length(effect)`, to the character
    expect(programFor("fix-reversal-energy")).toBe(programFor("sv04-266"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE THREE-TERM GATE — EACH TERM DENIED ON ITS OWN BOARD.
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §2 — the antecedent is a CONJUNCTION, and each term has its own denial", () => {
  it("promotes on a no-Rule-Box EVOLUTION while ahead on Prizes remaining", () => {
    // The one board where all three terms hold. Everything below removes exactly
    // one term from THIS board and expects {C}.
    const state = holding(1, "fix-reversal-stage1", "fix-reversal-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });

  it("🛑 term 1 denied — a BASIC holder provides {C}, with the other two terms TRUE", () => {
    const state = holding(2, "fix-reversal-basic", "fix-reversal-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 term 2 denied — the RULE-BOX Evolution provides {C}, and it is a NAME parse", () => {
    // `fix-reversal-ex` is `fix-reversal-stage1` in every field except its NAME —
    // same stage, same evolveFrom, same attacks, same HP. So this board differs
    // from the promoting one by the rule-box suffix ALONE, and a build that
    // dropped the `noRuleBox` guard passes every other case in this file.
    const state = holding(3, "fix-reversal-ex", "fix-reversal-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 term 3 denied — LEVEL on Prizes provides {C}, because the comparison is STRICT", () => {
    // ⚠️ THE BOARD A NATURAL SUITE NEVER WRITES. 6–6 is the board every game
    // starts on, "more remaining" is strict, and an implementation using `>=`
    // promotes here. It is also the board on which the POLARITY flip is invisible
    // — which is why the two cases below exist as well.
    const state = holding(4, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 term 3 denied the OTHER way — BEHIND on Prizes remaining provides {C}", () => {
    // 🛑 THE POLARITY EXECUTIONER. "More Prize cards REMAINING" means you have
    // TAKEN FEWER — you are LOSING. Here P1 has taken 4 and P2 none, so P1 is
    // WINNING and the card does nothing. An implementation that read the clause as
    // "ahead on Prizes taken" is green on §2's promoting board only if it also
    // inverts it there, and green on the LEVEL board either way — this is the case
    // that separates the two readings, and the mutation corpus carries the flip.
    let state = p1Turn2(5);
    state = setActiveFromDeck(state, "p1", "fix-reversal-stage1");
    state = attachFromDeck(state, "p1", "fix-reversal-energy", 1);
    state = setPrizes(state, "p1", 2); // P1 has 2 remaining, P2 still 6
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 the SEAT is derived, not assumed — the mirror board on P2 promotes", () => {
    // The prize comparison is SEAT-RELATIVE, and `unitsOf` is handed no seat. A
    // derivation that always answered "p1" promotes P1's holder on the board above
    // and refuses P2's here. Same cards, opposite side, opposite prize row.
    let state = p1Turn2(6);
    state = setActiveFromDeck(state, "p2", "fix-reversal-stage1");
    state = attachFromDeck(state, "p2", "fix-reversal-energy", 1);
    state = setPrizes(state, "p1", 3); // P2 has 6 remaining, P1 only 3
    expect(providedEnergy(state, activeOf(state, "p2"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
    // …and P1's own holder, on the SAME state, is denied by the same comparison.
    let mirrored = setActiveFromDeck(state, "p1", "fix-reversal-stage1");
    mirrored = attachFromDeck(mirrored, "p1", "fix-reversal-energy", 1);
    expect(providedEnergy(mirrored, activeOf(mirrored, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 the riders NARROW the stage gate — Neo Upper is UNAFFECTED by the prize row", () => {
    // The widening's sharpest statement. On a board where Reversal is denied by
    // its PRIZE term, the other carrier of the SAME field — which sets no riders —
    // still answers off the stage alone. A build that hoisted either rider out of
    // the row and into the read site kills this.
    const denied = holding(7, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    expect(providedEnergy(denied, activeOf(denied, "p1"))).toEqual(["Colorless"]);
    let neo = p1Turn2(8);
    neo = setActiveFromDeck(neo, "p1", "fix-neo-stage2");
    neo = attachFromDeck(neo, "p1", "fix-neo-upper-energy", 1);
    neo = setPrizes(neo, "p2", 6); // the SAME level prize row
    expect(providedEnergy(neo, activeOf(neo, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("promotes EVERY copy on the same body — the antecedent names the HOLDER", () => {
    const state = holding(9, "fix-reversal-stage1", "fix-reversal-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toHaveLength(6);
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a promoting body", () => {
    // ⚠️ The board a gate keyed on the HOLDER rather than on the CARD's row fails:
    // all three terms hold here, so a misplaced condition promotes everything.
    let state = holding(10, "fix-reversal-stage1", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LIVE READ — ON **TWO** AXES, WHICH NO EARLIER MEMBER OF THIS FAMILY HAD.
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §3 — every term is LIVE-READ, and the prize term moves without a card moving", () => {
  it("🛑 GAINS the provision the instant the Basic holder EVOLVES", () => {
    // D262's direction, on a three-term antecedent: the other two terms are
    // already true, so the evolve alone flips the answer. A stamped unit list
    // frozen at attach time keeps {C} here.
    let state = p1LaterTurn(11);
    state = setActiveFromDeck(state, "p1", "fix-reversal-basic");
    state = attachFromDeck(state, "p1", "fix-reversal-energy", 1);
    state = setPrizes(state, "p2", 4);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);

    state = handFromDeck(state, "p1", "fix-reversal-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-reversal-stage1"),
        target: { spot: "active" },
      }),
    );
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });

  it("🛑 evolving into the RULE-BOX twin gains NOTHING — the same evolve, the other body", () => {
    // The identical action on the identical board, differing only in which
    // Evolution card leaves the hand. The stage term flips TRUE and the
    // `noRuleBox` term flips FALSE in the same breath, so the answer must not move.
    let state = p1LaterTurn(12);
    state = setActiveFromDeck(state, "p1", "fix-reversal-basic");
    state = attachFromDeck(state, "p1", "fix-reversal-energy", 1);
    state = setPrizes(state, "p2", 4);
    state = handFromDeck(state, "p1", "fix-reversal-ex", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-reversal-ex"),
        target: { spot: "active" },
      }),
    );
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 the PRIZE term moves the answer with NO card touched at all", () => {
    // ⚠️ THE AXIS THIS FAMILY HAS NEVER HAD. Neo Upper's and Prism's antecedents
    // can only change when a card moves; this one changes when a PRIZE is taken,
    // so the same board answers differently with the same cards in the same spots.
    // A stamped implementation is not merely stale here — it can never be right.
    const level = holding(13, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    expect(providedEnergy(level, activeOf(level, "p1"))).toEqual(["Colorless"]);
    const behind = setPrizes(level, "p2", 5);
    expect(providedEnergy(behind, activeOf(behind, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IT PAYS A REAL ATTACK COST (§8.2).
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §4 — the provision spent in the currency §8.2 actually pays", () => {
  it("pays Reversal Strike {P}{W}{F} off the ONE attached card", () => {
    // THREE DIFFERENT types off one card — a cost no other member of this family
    // can pay, because no other member provides three units.
    let state = holding(14, "fix-reversal-stage1", "fix-reversal-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 REJECTS Reversal Storm's FOUR types on the same board — 'only 3 at a time'", () => {
    // The payability form of the count. A row that shipped four units passes the
    // case above and fails only here.
    let state = holding(15, "fix-reversal-stage1", "fix-reversal-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 REJECTS Reversal Strike on a LEVEL prize row — the same body, the same card", () => {
    // The prize term priced in §8.2 rather than in `providedEnergy`. Nothing about
    // the holder or the attachment differs from the paying board; only the
    // opponent's prize count does.
    let state = holding(16, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 REJECTS Reversal Strike on the RULE-BOX twin — the name is the whole difference", () => {
    let state = holding(17, "fix-reversal-ex", "fix-reversal-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("pays the single {C} of Reversal Tap on EVERY denied board — the first paragraph", () => {
    // The half that was always built, driven so a build that broke the fallback
    // while adding the riders cannot hide behind the rejections above.
    for (const [seed, body, prizes] of [
      [18, "fix-reversal-basic", 4],
      [19, "fix-reversal-ex", 4],
      [20, "fix-reversal-stage1", 6],
    ] as const) {
      let state = holding(seed, body, "fix-reversal-energy", 1, prizes);
      state = setActiveFromDeck(state, "p2", "fix-victim");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 2 });
      expect(types(events), body).toContain("DAMAGE_DEALT");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MATCH_RECORD_VERSION — DRIVEN, AND RECORDED AS A **SKIP**.
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §5 — the persisted shape does NOT move, and that is measured", () => {
  it("🛑 the LITERAL key anchor — the whole GameState key list, spelled out", () => {
    // D279's rule: a diff between two boards from one build is a half-guard, blind
    // to "every board grew a key", so the diff is PAIRED with a literal.
    const state = holding(21, "fix-reversal-stage1", "fix-reversal-energy");
    expect(Object.keys(state).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("🛑 D302's build writes NO persisted byte — the SKIP, stated as a measurement", () => {
    // 🛑 **`MATCH_RECORD_VERSION` IS 17 AT BOTH ENDS OF THIS SLICE AND THAT IS A
    // DECISION.** The whole row is a READ over `cardIdByUid`, the registry and the
    // two prize arrays, so a v17 record written before this slice replays
    // identically after it. ⚠️ THE PRIZE TERM IS THE CLAUSE THAT MAKES THIS WORTH
    // ASSERTING RATHER THAN ASSUMING: it is the first provision condition that
    // reads a zone OUTSIDE the holder's own stack, and a build that had cached the
    // answer would have needed somewhere to put it.
    const promoting = holding(22, "fix-reversal-stage1", "fix-reversal-energy");
    const active = activeOf(promoting, "p1");
    // No unit list, no cached provision, no prize snapshot anywhere on the body.
    expect(Object.keys(active)).not.toContain("units");
    expect(Object.keys(active)).not.toContain("providedEnergy");
    // The SAME board with the prize term denied carries the SAME keys — the answer
    // moved and the shape did not. ⚠️ The denial shrinks P1's OWN row rather than
    // growing P2's: `setPrizes` only ever shrinks (it returns the surplus to the
    // deck), so `setPrizes(state, "p2", 6)` on a 4-card row is a NO-OP and would
    // have compared a board against itself. That is exactly the "two identical
    // boards" half-guard this case exists to avoid, and it was caught by driving.
    const denied = setPrizes(promoting, "p1", 3);
    expect(Object.keys(activeOf(denied, "p1")).sort()).toEqual(Object.keys(active).sort());
    expect(Object.keys(denied.players.p1).sort()).toEqual(Object.keys(promoting.players.p1).sort());
    // …and the two answers genuinely differ, so the shape claim is made on a pair
    // that actually moved rather than on two identical boards.
    expect(providedEnergy(promoting, active)).toHaveLength(3);
    expect(providedEnergy(denied, activeOf(denied, "p1"))).toHaveLength(1);
  });
});
