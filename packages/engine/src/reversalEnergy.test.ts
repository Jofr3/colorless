import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState } from "./index";
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
  activeOf,
} from "./testFixtures";

function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: REVERSAL_ENERGY_DECK, p2: REVERSAL_ENERGY_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1's SECOND turn — needed only by the EVOLVE boards (§4/§10 refuse an evolve
    on a player's FIRST turn, which is what `p1Turn2` actually opens). */
function p1LaterTurn(seed: number): GameState {
  let state = p1Turn2(seed);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

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

describe("D302 §1 — Reversal Energy's row, and the paragraph five handoffs did not quote", () => {
  it("authors the FIRST paragraph — the {C} provision six shipped Energies share", () => {
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

  it("the RIDERS ARE OPTIONAL — the family's other two carriers set NEITHER", () => {
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

  it("provides THREE wildcard units — the multiset half, observable at the matcher", () => {
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

  it("term 1 denied — a BASIC holder provides {C}, with the other two terms TRUE", () => {
    const state = holding(2, "fix-reversal-basic", "fix-reversal-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("term 2 denied — the RULE-BOX Evolution provides {C}, and it is a NAME parse", () => {
    const state = holding(3, "fix-reversal-ex", "fix-reversal-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("term 3 denied — LEVEL on Prizes provides {C}, because the comparison is STRICT", () => {
    const state = holding(4, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("term 3 denied the OTHER way — BEHIND on Prizes remaining provides {C}", () => {
    let state = p1Turn2(5);
    state = setActiveFromDeck(state, "p1", "fix-reversal-stage1");
    state = attachFromDeck(state, "p1", "fix-reversal-energy", 1);
    state = setPrizes(state, "p1", 2); // P1 has 2 remaining, P2 still 6
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("the SEAT is derived, not assumed — the mirror board on P2 promotes", () => {
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

  it("the riders NARROW the stage gate — Neo Upper is UNAFFECTED by the prize row", () => {
    const denied = holding(7, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    expect(providedEnergy(denied, activeOf(denied, "p1"))).toEqual(["Colorless"]);
    let neo = p1Turn2(8);
    neo = setActiveFromDeck(neo, "p1", "fix-neo-stage2");
    neo = attachFromDeck(neo, "p1", "fix-neo-upper-energy", 1);
    neo = setPrizes(neo, "p2", 6);
    expect(providedEnergy(neo, activeOf(neo, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("promotes EVERY copy on the same body — the antecedent names the HOLDER", () => {
    const state = holding(9, "fix-reversal-stage1", "fix-reversal-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toHaveLength(6);
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a promoting body", () => {
    let state = holding(10, "fix-reversal-stage1", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LIVE READ — ON **TWO** AXES, WHICH NO EARLIER MEMBER OF THIS FAMILY HAD.
// ─────────────────────────────────────────────────────────────────────────────

describe("D302 §3 — every term is LIVE-READ, and the prize term moves without a card moving", () => {
  it("GAINS the provision the instant the Basic holder EVOLVES", () => {
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

  it("evolving into the RULE-BOX twin gains NOTHING — the same evolve, the other body", () => {
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

  it("the PRIZE term moves the answer with NO card touched at all", () => {
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

  it("REJECTS Reversal Storm's FOUR types on the same board — 'only 3 at a time'", () => {
    let state = holding(15, "fix-reversal-stage1", "fix-reversal-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("REJECTS Reversal Strike on a LEVEL prize row — the same body, the same card", () => {
    // The prize term priced in §8.2 rather than in `providedEnergy`. Nothing about
    // the holder or the attachment differs from the paying board; only the
    // opponent's prize count does.
    let state = holding(16, "fix-reversal-stage1", "fix-reversal-energy", 1, 6);
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("REJECTS Reversal Strike on the RULE-BOX twin — the name is the whole difference", () => {
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
  it("the LITERAL key anchor — the whole GameState key list, spelled out", () => {
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
      "recentAttackers",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("D302's build writes NO persisted byte — the SKIP, stated as a measurement", () => {
    const promoting = holding(22, "fix-reversal-stage1", "fix-reversal-energy");
    const active = activeOf(promoting, "p1");
    // No unit list, no cached provision, no prize snapshot anywhere on the body.
    expect(Object.keys(active)).not.toContain("units");
    expect(Object.keys(active)).not.toContain("providedEnergy");
    const denied = setPrizes(promoting, "p1", 3);
    expect(Object.keys(activeOf(denied, "p1")).sort()).toEqual(Object.keys(active).sort());
    expect(Object.keys(denied.players.p1).sort()).toEqual(Object.keys(promoting.players.p1).sort());
    // …and the two answers genuinely differ, so the shape claim is made on a pair
    // that actually moved rather than on two identical boards.
    expect(providedEnergy(promoting, active)).toHaveLength(3);
    expect(providedEnergy(denied, activeOf(denied, "p1"))).toHaveLength(1);
  });
});
