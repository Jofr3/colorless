import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  NEO_UPPER_ENERGY_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D262 — NEO UPPER ENERGY `sv05-162`, THE SPECIAL ENERGY COLUMN'S CONDITIONAL
// PROVISION.
//
//   "As long as this card is attached to a Pokémon, it provides {C} Energy.
//
//    If this card is attached to a Stage 2 Pokémon, this card provides every type
//    of Energy but provides only 2 Energy at a time."
//
// ── THE CENSUS, RE-DERIVED AND NOT INHERITED ─────────────────────────────────
// D261 closed this column, so this slice ran the COLUMN query rather than an
// exploratory ladder (remote D1 `luminous` 735f0fb5-cdc3-494d-8b97-74a8ade0124a,
// `legal_standard = 1 AND category='Energy' AND energy_type='Special' AND
// effect <> ''`, GROUPED BY `effect`, 2026-08-07): **7 sentences / 8 printings**,
// unchanged. `sv05-162` is **1 legal printing on ONE sentence**, in the `effect`
// column, and it is the ONLY id carrying it. `BUILT.specialEnergy` was measured
// 4 at HEAD and 5 after, by the 11-id join both times (D261's recipe), never
// incremented.
//
// The residue after this slice is **3 printings on 3 sentences** — `sv06-166`
// (a post-attack re-attach that needs to know WHY a card left a body), `sv06-167`
// (a prize hook plus a per-game latch) and `sv10-182` (an attach restriction plus
// a continuous self-discard) — each still named with its blocker in
// `mistEnergy.test.ts`'s header, which is where that residue lives.
//
// ── WHAT THIS ROW COSTS, AND WHY IT IS NOT A NEW SEAM ────────────────────────
// It is `demoteWithOtherSpecial`'s SHAPE with a different antecedent. That field
// already answers "provides X INSTEAD when <condition about the holder>"; this
// sentence changes the condition from "another Special is attached" to "the holder
// is a Stage 2" and the replacement units to `[ANY_ENERGY, ANY_ENERGY]`. So the
// engine diff is `registry.ts` (a field + a row), `continuous.ts unitsOf` (one
// signature widening + one arm) and `cards.ts` (`isStage2Pokemon`). `interpreter.ts`,
// `attack.ts`, `effects.ts`, `types.ts`, `turn.ts`, `redact.ts` and `log.ts` take a
// ZERO diff: no new op, no new event, no new read site.
//
// 🛑 THE SIGNATURE WIDENING WAS GREPPED BEFORE THE ROW WAS PROMISED. `unitsOf`
// took `(state, uid, specialUids)` and did not know the HOLDER, which a stage gate
// needs. BOTH call sites — `providedEnergy(state, pokemon)` and
// `unitsProvidedBy(state, pokemon, uid)` — already held an `InPlayPokemon`, so this
// is a widening and not a plumbing job. That is the whole difference between a
// three-file row and a six-file one, and it is a measurement rather than a hope.
//
// ⚠️ `isStage2Pokemon` IS NEW AND THAT WAS CHECKED, NOT ASSUMED. `matchesFilter`'s
// `stage` vocabulary (D245) is `"basic"` with an else-arm of "any Evolution"; it
// cannot express Stage 2, and a build that reached for it would promote on a
// STAGE 1 holder. The board below that puts the card on `fix-neo-stage1` is that
// mistake's executioner.

/** Setup, then open P1's turn 2 (P2 went first and passed) — `specialEnergy.test.ts`'s
    opener, reused whole. Seed-free: nothing in this cast flips a coin. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: NEO_UPPER_ENERGY_DECK, p2: NEO_UPPER_ENERGY_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return active;
}

/** P1's SECOND turn — `p1Turn2` plus a full round. ⚠️ NEEDED ONLY BY THE EVOLVE
    BOARDS: §4/§10 refuse an evolve on a player's FIRST turn, which is what
    `p1Turn2` actually opens (P2 went first, so P1's "turn 2" is P1's turn ONE).
    The surgery runs AFTER the round, and `setActiveFromDeck` stamps `makeInPlay(uid, 0)`,
    so the came-into-play-this-turn clause never fires on a surgical body. */
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

describe("Neo Upper Energy — the ROW is data, and both printed halves are on it", () => {
  it("authors `sv05-162` with the {C} provision Jet, Spiky and Mist already share", () => {
    // ⚠️ THE FIRST PARAGRAPH WAS ALREADY BUILT. Asserted rather than assumed
    // because it is the half that makes this row a RIDER on shipped machinery.
    expect(programFor("sv05-162")?.energy?.provides).toEqual(["Colorless"]);
    for (const id of ["sv02-190", "sv05-161", "sv08-191", "sv09-159"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("🛑 provides TWO wildcard units and not one — the multiset half", () => {
    // The half that can go wrong silently: `costMet` consumes a FLAT LIST, so a
    // row with one entry pays every one-symbol cost and fails only a two-symbol
    // one. "…but provides only 2 Energy at a time" is a COUNT.
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toEqual([ANY_ENERGY, ANY_ENERGY]);
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toHaveLength(2);
    // And the two-ness is observable at the matcher, one layer below any board:
    // one wildcard cannot cover two typed slots.
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY, ANY_ENERGY])).toBe(true);
  });

  it("carries NO on-attach arm and NO continuous passive — both are ABSENT from the print", () => {
    // The sentence prints neither an attach-time clause (Jet, Enriching) nor a
    // while-attached clause (Therapeutic, Mist). A row that grew either would be
    // authoring text this card does not have.
    expect(programFor("sv05-162")?.energy?.onAttach).toBeUndefined();
    expect(programFor("sv05-162")?.energy?.passive).toBeUndefined();
    // …and it is NOT the other conditional wearing a new name.
    expect(programFor("sv05-162")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv02-191")?.energy?.promoteOnHolderStage).toBeUndefined();
  });

  it("carries the printed sentence on the fixture demonstrator", () => {
    const printed =
      "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Stage 2 Pokémon, this card provides every type of Energy but provides only 2 Energy at a time.";
    expect(FIXTURE_POOL["fix-neo-upper-energy"]?.effect).toBe(printed);
    expect(programFor("fix-neo-upper-energy")).toBe(programFor("sv05-162"));
  });

  it("⚠️ ENUMERATES every card in the pool with a CONDITIONAL provision — measured", () => {
    // A POPULATION claim, and it belongs to a POOL SWEEP rather than to any one
    // board (D261's headline loss, applied a slice later). It goes RED on a new
    // FIXTURE as much as on new code, which is the point: a third conditional
    // arriving in silence is exactly what this catches.
    const conditional = Object.keys(FIXTURE_POOL)
      .filter((id) => {
        const energy = programFor(id)?.energy;
        return (
          energy?.demoteWithOtherSpecial !== undefined ||
          energy?.promoteOnHolderStage !== undefined
        );
      })
      .sort();
    // ⚠️ THE VIEW IS `FIXTURE_POOL` AND NOT THE REGISTRY MAP, which is not
    // exported — the same view `therapeuticEnergy.test.ts`'s sweep uses, and the
    // reason `sv05-162` is absent here while `sv02-191` is present: the real
    // Luminous id IS a fixture, the real Neo Upper id is not (the manifest
    // generator cannot run, so no `sv05` Energy fixture may be added). The real
    // id is pinned by its own assertions above, and the two demonstrators are
    // asserted to be the SAME object.
    // 🆕 D300 — `fix-prism-energy` JOINS THIS LIST, AND THIS ASSERTION IS WHY THE
    // NEW CARRIER COULD NOT ARRIVE IN SILENCE: it reddened on the fixture before
    // a line of `prismEnergy.test.ts` existed. Prism `sv10.5b-086` carries the
    // SAME field with the other stage word, which is exactly the arrival this
    // sweep was written to catch.
    // 🆕 D302 — `fix-reversal-energy` JOINS IT, and the sweep did its job for the
    // SECOND consecutive Energy slice: it reddened on the FIXTURE before a line of
    // `reversalEnergy.test.ts` was written. ⚠️ **AND THIS CARRIER IS THE ONE THE
    // SWEEP'S SHAPE ALMOST MISSED** — Reversal sets `noRuleBox` and
    // `whileMorePrizesRemaining` as well, and a filter written against the RIDERS
    // rather than against the FIELD would not have seen the two carriers that set
    // neither. The predicate is `promoteOnHolderStage !== undefined`, so a fourth
    // carrier with a fourth rider combination still cannot arrive in silence.
    expect(conditional).toEqual([
      "fix-neo-upper-energy",
      "fix-prism-energy",
      "fix-reversal-energy",
      "sv02-191",
    ]);

    // 🛑 AND NO PRINTING CARRIES BOTH FIELDS, which is what makes `unitsOf`'s
    // field order unobservable rather than a decision nobody wrote down.
    for (const id of conditional) {
      const energy = programFor(id)?.energy;
      const both =
        energy?.demoteWithOtherSpecial !== undefined && energy?.promoteOnHolderStage !== undefined;
      expect(both, `${id} carries BOTH conditional provisions`).toBe(false);
    }
  });
});

describe("Neo Upper Energy — provision is gated on the HOLDER's printed stage (§6.3)", () => {
  it("provides {C} on a BASIC holder", () => {
    const state = holding(1, "fix-basic-1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("🛑 provides {C} on a STAGE 1 holder — the mistake a reused `stage` filter makes", () => {
    // `matchesFilter`'s non-basic arm is `evolveFromOf(card) !== null`, which a
    // Stage 1 satisfies. If this board came back with wildcards, the gate would be
    // "is an Evolution" and not "is a Stage 2".
    const state = holding(2, "fix-neo-stage1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("provides TWO wildcards on a STAGE 2 holder", () => {
    const state = holding(3, "fix-neo-stage2", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("promotes EVERY copy on the same Stage 2 — the condition is about the HOLDER", () => {
    // Two copies attached: four wildcard units, not two. The antecedent names the
    // body, so it is the same question for each card sitting on it (and unlike
    // Luminous's, a second copy does not interfere with the first).
    const state = holding(4, "fix-neo-stage2", "fix-neo-upper-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });

  it("is NOT demoted by another Special Energy on the holder", () => {
    // The discrimination that keeps this field from being `demoteWithOtherSpecial`
    // wearing a new name: Jet is another Special, and Luminous would collapse to
    // {C} here. Neo Upper prints no such clause, so it does not.
    let state = holding(5, "fix-neo-stage2", "fix-neo-upper-energy");
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — another Special
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("does NOT promote a Luminous sharing the same Stage 2 body", () => {
    // The mirror: the stage gate is a property of the ROW, not of the board, so a
    // Stage 2 holder does not upgrade the OTHER conditional. Luminous is a
    // one-at-a-time wildcard here, and demotes to {C} the moment Neo Upper joins it.
    let state = holding(6, "fix-neo-stage2", "sv02-191", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
    state = attachFromDeck(state, "p1", "fix-neo-upper-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a Stage 2", () => {
    // Both reach the same funnel; neither has a program to promote.
    let state = holding(7, "fix-neo-stage2", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

describe("Neo Upper Energy — the provision is LIVE-READ, not stamped (§1.2 + §10)", () => {
  it("🛑 UPGRADES ON THE SPOT when the holder EVOLVES into a Stage 2", () => {
    // THE SHARPEST CLAIM THIS ROW CAN MAKE, and the one a stamped implementation
    // would get wrong in silence: a unit list frozen at attach time passes every
    // static board above and fails only this one. Driven with a real `evolve`
    // action rather than by surgery.
    let state = holdingLater(8, "fix-neo-stage1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);

    state = handFromDeck(state, "p1", "fix-neo-stage2", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-neo-stage2"),
        target: { spot: "active" },
      }),
    );

    // Same card, same uid, same energy — a different top card, and therefore a
    // different provision, in the same breath.
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });
});

describe("Neo Upper Energy — it pays a real attack cost (§8.2)", () => {
  it("pays the two DIFFERENT typed symbols of Neo Smash {P}{W} off ONE card", () => {
    // The payability form of the multiset claim: two wildcards, two typed slots,
    // one attached Energy. A one-entry row cannot reach this.
    let state = holding(9, "fix-neo-stage2", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("pays the single {P} of Neo Jab off the same card", () => {
    // The control the mutant that drops the second unit would still pass — kept
    // deliberately, so the pair says WHICH half moved.
    let state = holding(10, "fix-neo-stage2", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 REJECTS Neo Jab {P} on the STAGE 1 — the same card, the same cost, {C} only", () => {
    let state = holding(11, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("rejects Neo Smash {P}{W} when only ONE Neo Upper is on the Stage 1", () => {
    let state = holding(12, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("pays Neo Smash on a Stage 2 the moment the body EVOLVES into one", () => {
    // The live read again, priced in the currency §8.2 actually spends: the very
    // attack refused two tests up resolves once the body is a Stage 2, with no
    // change to the attached card at all.
    let state = holdingLater(13, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = handFromDeck(state, "p1", "fix-neo-stage2", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-neo-stage2"),
        target: { spot: "active" },
      }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });
});
