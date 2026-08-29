import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  PRISM_ENERGY_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D300 — PRISM ENERGY `sv10.5b-086`, THE SECOND CARRIER OF D262's STAGE-GATED
// PROVISION AND THE ROW THAT TURNED ITS FIELD **NAME** INTO A FIELD **VALUE**.
//
//   "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//    If this card is attached to a Basic Pokémon, this card provides every type
//    of Energy but provides only 1 Energy at a time."
//
// ── THE CARD WAS READ END TO END, AND THE HANDOFF'S QUOTE WAS HALF OF IT ─────
// 🛑 The backlog and three consecutive resume points quoted the SECOND paragraph
// alone and priced the row off it. `length(effect)` is **194** against a
// ~130-character quote, and D299 flagged the 64-character gap as the thing most
// likely to be wrong about its own forecast. It was right to: the gap is a FIRST
// paragraph, and it is Jet's, Spiky's, Mist's and Neo Upper's line verbatim
// (`provides: ["Colorless"]`), shipped since M4 slice 5. So the second clause is
// the only new thing on the card — the forecast's CONCLUSION ("one field") holds
// and its PREMISE ("one printed sentence") was false. Both halves are asserted
// below rather than argued, because that is the difference this slice can leave
// behind for the next unread card.
//
// ── THE CENSUS, RE-QUERIED AND NOT INHERITED ─────────────────────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a),
// `instr(effect,'provides every type of Energy') > 0 AND legal_standard = 1`,
// 2026-08-09: **4 printings**, exactly the four D298 recorded —
//   • `sv04-266` Reversal Energy   (337 chars) — REFUSED, see below
//   • `sv05-162` Neo Upper Energy  (196 chars) — BUILT at D262
//   • `sv06-167` Legacy Energy     (342 chars) — BUILT at D298
//   • `sv10.5b-086` Prism Energy   (194 chars) — THIS ROW
// ⚠️ **TWO of the four were already BUILT, not the ONE the handoff predicted**, so
// the row's reachable size is **1 of the remaining 2** and not "2 of 3". The
// remaining one is Reversal Energy `sv04-266`, refused on its ANTECEDENT and not
// on its provision: it conjoins a PRIZE COMPARISON with *"an Evolution Pokémon
// that doesn't have a Rule Box"*. Typed: a missing COMPOSITION — the provision
// half is this very field, and the prize-count half is `onKoPrize`'s neighbour,
// but no `EnergyProgram` field can carry a two-term board predicate today.
//
// ── WHY THE FIELD WAS WIDENED AND NOT SIBLINGED ──────────────────────────────
// D262 named its field `promoteOnStage2Holder` — a name that carries its own
// condition — because ONE printing carried the shape. A second printing with the
// other stage word makes that name a lie on half its users, and the choice was
// between a sibling `promoteOnBasicHolder?: string[]` and a widened
// `promoteOnHolderStage?: { stage, units }`.
// 🛑 THE WIDENING WON ON A MEASUREMENT, NOT A TASTE. Four riders in this repo
// already carry a stage word as DATA (`disableAbilities.stage`,
// `noRetreatCostAura.stage`, `ownerPokemon.stage`, `typedPokemon.stage`), so the
// shape is the house spelling rather than an invention; and a sibling boolean
// would have made `D300-stage-value-ignored` UNREACHABLE — with two fields there
// is no dispatch to get wrong, and the defect moves from "a mutant kills it" to
// "a fourth stage needs a fourth field". ⚠️ It is still a SIBLING of
// `demoteWithOtherSpecial` and not a widening of IT, for D262's reason unchanged:
// that condition is about the holder's OTHER ATTACHED ENERGY and this one about
// its PRINTED STAGE, so merging THOSE needs a discriminant. Merging Basic with
// Stage 2 needs none. **That asymmetry is the whole design of this slice.**
//
// ── WHAT THE ROW COSTS ───────────────────────────────────────────────────────
// `registry.ts` (one widened field + one new program + two map ids),
// `continuous.ts unitsOf` (one line: the predicate is SELECTED, not branched
// around) and `testFixtures.ts` (three fixtures + a deck). NO new op, NO new
// event, NO new read site, NO signature change anywhere — `unitsOf` already took
// the holder, because D262 widened it for exactly this question.

/** Setup, then open P1's turn 2 (P2 went first and passed) — D262's opener,
    reused whole. Seed-free: nothing in this cast flips a coin. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: PRISM_ENERGY_DECK, p2: PRISM_ENERGY_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return active;
}

/** P1's SECOND turn — `p1Turn2` plus a full round. Needed only by the EVOLVE
    boards: §4/§10 refuse an evolve on a player's FIRST turn, which is what
    `p1Turn2` actually opens. */
function p1LaterTurn(seed: number): GameState {
  let state = p1Turn2(seed);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1's turn 2 with `bodyId` Active and `count` copies of `energyId` on it. */
function holding(seed: number, bodyId: string, energyId: string, count = 1): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", bodyId);
  return attachFromDeck(state, "p1", energyId, count);
}

/** `holding`, on a turn where §10 lets P1 evolve. */
function holdingLater(seed: number, bodyId: string, energyId: string): GameState {
  let state = p1LaterTurn(seed);
  state = setActiveFromDeck(state, "p1", bodyId);
  return attachFromDeck(state, "p1", energyId, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ROW IS DATA, AND BOTH PRINTED PARAGRAPHS ARE ON IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §1 — Prism Energy's row, and the paragraph the handoff did not quote", () => {
  it("🛑 authors the FIRST paragraph — the {C} provision four shipped Energies share", () => {
    // ⚠️ THE CLAUSE D299's FLAG WAS ABOUT. The card prints TWO paragraphs; this is
    // the one the 194-vs-130 character gap turned out to be, and it needed no new
    // code because four other rows already say it.
    expect(programFor("sv10.5b-086")?.energy?.provides).toEqual(["Colorless"]);
    for (const id of ["sv02-190", "sv05-161", "sv05-162", "sv08-191"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("authors the SECOND paragraph as a stage VALUE, not a field name", () => {
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage).toEqual({
      stage: "Basic",
      units: [ANY_ENERGY],
    });
    // …and the OTHER carrier of the same field disagrees on BOTH values, which is
    // what makes the shape earn itself.
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage).toEqual({
      stage: "Stage2",
      units: [ANY_ENERGY, ANY_ENERGY],
    });
  });

  it("🛑 provides ONE wildcard unit and not two — the multiset half, mirrored", () => {
    // `costMet` consumes a FLAT LIST, so a row with two entries pays a two-symbol
    // cost this card must never pay. "…but provides only 1 Energy at a time" is a
    // COUNT, and it is the exact mirror of Neo Upper's two.
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage?.units).toHaveLength(1);
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toHaveLength(2);
    // Observable at the matcher, one layer below any board.
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
    expect(costMet(["Psychic"], [ANY_ENERGY])).toBe(true);
    // And it is NOT the other conditional wearing a new name.
    expect(programFor("sv10.5b-086")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv10.5b-086")?.energy?.passive).toBeUndefined();
    expect(programFor("sv10.5b-086")?.energy?.onAttach).toBeUndefined();
  });

  it("carries the printed sentence on the fixture demonstrator, BOTH paragraphs", () => {
    // ⚠️ A `sv10.5b` fixture id may not be added (the 978-row / 6-set committed
    // manifest holds sv01/sv02/sv03/sv06.5 only), so the demonstrator carries the
    // text and the real id carries the program — `fix-mist-energy`'s idiom, and
    // the two are asserted to be the SAME object.
    const printed =
      "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.";
    expect(FIXTURE_POOL["fix-prism-energy"]?.effect).toBe(printed);
    expect(printed).toHaveLength(194); // the remote D1 `length(effect)`, to the character
    expect(programFor("fix-prism-energy")).toBe(programFor("sv10.5b-086"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE GATE — AND THE STAGE 2 BOARD, WHICH IS THE ONE THAT MATTERS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §2 — provision is gated on the HOLDER's printed stage (§6.3)", () => {
  it("provides ONE wildcard on a BASIC holder", () => {
    const state = holding(1, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
  });

  it("provides {C} on a STAGE 1 holder", () => {
    const state = holding(2, "fix-prism-stage1", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 provides {C} on a STAGE 2 holder — the wrong-predicate executioner", () => {
    // THE BOARD THE `{ stage, units }` SHAPE EXISTS FOR. A dispatch that ignored
    // `promote.stage`, or swapped the two predicates, promotes here. Neo Upper's
    // suite cannot see this board and this suite cannot see Neo Upper's, which is
    // why both are in the corpus against the same line.
    const state = holding(3, "fix-neo-stage2", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 the two carriers SWAP on the same two bodies — the stage is a value", () => {
    // The cleanest statement the pair can make. On a BASIC, Prism is a wildcard
    // and Neo Upper is {C}; on a STAGE 2 the answers trade places. One board each
    // would let a hard-coded predicate through; the cross does not.
    const basic = holding(4, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(basic, activeOf(basic, "p1"))).toEqual([ANY_ENERGY]);
    const basicNeo = holding(5, "fix-prism-basic", "fix-neo-upper-energy");
    expect(providedEnergy(basicNeo, activeOf(basicNeo, "p1"))).toEqual(["Colorless"]);

    const stage2 = holding(6, "fix-neo-stage2", "fix-prism-energy");
    expect(providedEnergy(stage2, activeOf(stage2, "p1"))).toEqual(["Colorless"]);
    const stage2Neo = holding(7, "fix-neo-stage2", "fix-neo-upper-energy");
    expect(providedEnergy(stage2Neo, activeOf(stage2Neo, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });

  it("promotes EVERY copy on the same Basic — the condition is about the HOLDER", () => {
    // Two copies attached: two wildcard units, one per card. The antecedent names
    // the body, so it is the same question for each card sitting on it.
    const state = holding(8, "fix-prism-basic", "fix-prism-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("is NOT demoted by another Special Energy on the holder", () => {
    // The discrimination that keeps this field from being `demoteWithOtherSpecial`
    // wearing a new name: Jet is another Special, and Luminous would collapse to
    // {C} here. Prism prints no such clause, so it does not.
    let state = holding(9, "fix-prism-basic", "fix-prism-energy");
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — another Special
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("does NOT promote a Luminous sharing the same Basic body", () => {
    // The mirror: the stage gate is a property of the ROW, not of the board. And
    // Luminous DOES demote once Prism joins it — the two fields are read on the
    // same funnel and neither reaches into the other.
    let state = holding(10, "fix-prism-basic", "sv02-191", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
    state = attachFromDeck(state, "p1", "fix-prism-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a Basic", () => {
    // Both reach the same funnel; neither has a program to promote. ⚠️ This is the
    // board a gate keyed on the HOLDER alone (rather than on the CARD's row) would
    // fail: the body is a Basic, so a misplaced condition promotes everything on it.
    let state = holding(11, "fix-prism-basic", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LIVE READ — RUN DOWNWARD, WHICH D262 COULD NOT DO.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §3 — the provision is LIVE-READ, and here it is LOST (§1.2 + §10)", () => {
  it("🛑 DEMOTES ON THE SPOT when the Basic holder EVOLVES into a Stage 1", () => {
    // 🛑 THE SHARPEST CLAIM THIS ROW CAN MAKE, AND IT RUNS THE OTHER WAY FROM
    // D262's. Neo Upper drives an evolve that GAINS a provision; a stamped
    // implementation fails that board because the stamp is stale. This board
    // LOSES one — and a stamped implementation fails it for the opposite reason,
    // keeping a wildcard the card no longer provides. Same defect, and only a
    // build that re-reads the top card on every call passes both.
    let state = holdingLater(12, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);

    state = handFromDeck(state, "p1", "fix-prism-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-prism-stage1"),
        target: { spot: "active" },
      }),
    );

    // Same card, same uid, same energy — a different top card, and therefore a
    // WEAKER provision, in the same breath.
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IT PAYS A REAL ATTACK COST (§8.2).
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §4 — the provision spent in the currency §8.2 actually pays", () => {
  it("pays the single {P} of Prism Jab off the one attached card", () => {
    let state = holding(13, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 REJECTS Prism Smash {P}{W} on the SAME board — one wildcard, two slots", () => {
    // The payability form of the "only 1 at a time" claim, and the board that
    // separates this row from Neo Upper's two-unit one. A row that shipped
    // `[ANY_ENERGY, ANY_ENERGY]` passes the test above and fails only here.
    let state = holding(14, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("pays Prism Smash {P}{W} once a SECOND Prism is attached to the Basic", () => {
    // Two cards, two wildcards, two typed slots — the count is per CARD, so the
    // cost is reachable the honest way and the rejection above is about arithmetic
    // rather than about the attack being unpayable in principle.
    let state = holding(15, "fix-prism-basic", "fix-prism-energy", 2);
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 REJECTS Prism Jab {P} on the STAGE 1 — the same card, the same cost, {C} only", () => {
    let state = holding(16, "fix-prism-stage1", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 LOSES a payable attack across the evolve — the live read, priced in §8.2", () => {
    // The attack that resolves on the Basic is REFUSED on the Stage 1 the body
    // becomes, with no change to the attached card at all. D262's board in
    // reverse, and the one a stamped build passes by accident there and fails here.
    let state = holdingLater(17, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = handFromDeck(state, "p1", "fix-prism-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-prism-stage1"),
        target: { spot: "active" },
      }),
    );
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MATCH_RECORD_VERSION — DRIVEN BOTH DIRECTIONS, AND RECORDED AS A **SKIP**.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §5 — the persisted shape does NOT move, and that is measured", () => {
  it("🛑 the LITERAL key anchor — the whole GameState key list, spelled out", () => {
    // D279's rule: a diff between two boards from one build is a half-guard, blind
    // to "every board grew a key". So the diff is PAIRED with a literal.
    // ⚠️ **THIS IS THE TWELFTH ENGINE SUITE TO CARRY `oncePerGameSpent`, AND THE
    // FIRST DRAFT OF THIS COMMENT SAID "ELEVENTH".** `git grep -l "oncePerGameSpent"
    // HEAD~1 -- 'packages/engine/src/*.test.ts'` returns ELEVEN files, so this one
    // is the twelfth (thirteen counting `apps/api`'s `match.test.ts`, which is not
    // an engine suite). 🛑 **NOTHING IN `bun run check` READS THIS SENTENCE** — it
    // is the same object as D298's doc-recorded version bump that never landed, one
    // abstraction down, and it was wrong for the same reason: a sequence was
    // CONTINUED instead of MEASURED. Grep the count; do not inherit it.
    const state = holding(18, "fix-prism-basic", "fix-prism-energy");
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

  it("🛑 D300's build writes NO persisted byte — the SKIP, stated as a measurement", () => {
    // 🛑 **THE VERSION LITERAL IS 17 AT BOTH ENDS OF THIS SLICE AND THAT IS A
    // DECISION, NOT AN OMISSION.** D298 recorded a bump that never happened and it
    // survived a green check AND a green sweep, because nothing in either reads the
    // docs. So the claim is asserted here instead of promised in a doc: the whole
    // row is a READ over `cardIdByUid` + the registry, and a v17 record written
    // before this slice replays identically after it.
    //
    // The witness is the BOARD. Attaching a Prism and evolving under it changes
    // `players`, `cardIdByUid` and nothing else — no `GameState` key, no
    // `InPlayPokemon` key, no `PlayerSide` key, and no stamped unit list anywhere.
    const state = holding(19, "fix-prism-basic", "fix-prism-energy");
    const active = activeOf(state, "p1");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackLockedTurn",
        "boostedAttack",
        "conditions",
        "damage",
        "damageReduction",
        "energy",
        // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
        // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
        // key, and what it asserts is that none of them was added HERE.
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
        // wrote nothing; the pin is on the HEAD's key set.
        "usedAttack",
      ].sort(),
    );
    // 🛑 THE PROVISION IS NOWHERE ON THE BODY. It is recomputed from the stack's
    // top card and the attached uids on every call, which is exactly why the
    // record shape is untouched — and why the evolve boards above can work at all.
    expect(JSON.stringify(active)).not.toContain(ANY_ENERGY);
    expect(providedEnergy(state, active)).toEqual([ANY_ENERGY]);
  });

  it("the SAME board round-trips through JSON with the provision re-derived", () => {
    // Both directions: a serialised board rehydrates and the wildcard is computed
    // again from the top card, not restored from a field that does not exist.
    const state = holding(20, "fix-prism-basic", "fix-prism-energy");
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round).toEqual(state);
    expect(providedEnergy(round, activeOf(round, "p1"))).toEqual([ANY_ENERGY]);
  });
});
