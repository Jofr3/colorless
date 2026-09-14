import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { countAttachedEnergy, providedEnergy } from "./continuous";
import { deriveAttackDamageBonus, deriveAttackRequirement } from "./effects";
import { effectiveAttackCost, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  EXTRA_ENERGY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D436 — THE "EXTRA ENERGY" CLAUSE: A DECLARATION FACT, COLLECTED — AND THE
// ONE PLACE THIS ENGINE COUNTS ENERGY IN **UNITS** RATHER THAN IN **CARDS**.
//
//   "If this Pokémon has at least 2 extra Energy attached (in addition to this
//    attack's cost), this attack does 80 more damage."    — 3 legal printings
//   "…, this attack does 100 more damage."                 — 2 legal printings
//
// **2 sentences / 5 legal printings on ONE clause**, the largest record left behind
// the `CONDITIONAL_DAMAGE_BONUS` skeleton, and the record D368 disqualified on SHAPE.
//
// 🛑 **D368's REFUSAL IS COLLECTED, NOT OVERTURNED, AND THE DIFFERENCE IS THE WHOLE
// SLICE.** That refusal says: the clause reads THIS ATTACK'S COST; the identical
// clause is printed on two attacks with two DIFFERENT costs (Electivire ex
// `sv10-069`/`-212` {L}{L}{C} and Jellicent ex `sv10.5w-045`/`-160`/`-168` {P}{C}),
// so the same board answers it differently depending on which attack was declared;
// and `conditionHolds(state, seat, cond)` is handed no attack. **Every clause of that
// is still true and §1 re-drives it.** What it refuses is a `BoardCondition`, and
// this slice does not add one: `DamageCountSource` is evaluated by
// `scaledAttackDamage` INSIDE `attack()`, where the declared attack's effective cost
// is already a local (the §8.2 check computed it ~380 lines earlier). ⚠️ **A REFUSAL
// SCOPED TO ONE VOCABULARY IS NOT A REFUSAL OF THE SENTENCE** — D423's scoped-claim
// rule, arriving at a refusal instead of at a census — and four shipped rungs carried
// it as though it were, which is what this slice re-points rather than deletes.
//
// 🛑 **UNITS, NOT CARDS. THE TEST IS APPLIED, NOT THE OUTCOME COPIED (D425).**
// D121's rule — *"one Energy card is one Energy however many units it provides"* —
// governs every sentence that COUNTS Energy against a printed constant
// (`yourActiveEnergyAtLeast`) or against another BODY (`activeEnergyCountsEqual`).
// This sentence counts it against **a cost**, and three things follow, each driven in
// §2 rather than argued:
//   • a cost is a multiset of SYMBOLS which §6.4 pays in UNITS OF PROVISION
//     (`costMet` consumes `providedEnergy`), so the subtraction only has a meaning in
//     units — cards-minus-symbols is not a quantity;
//   • the CARDS reading goes NEGATIVE on a board §8.2 admits: one `fix-grassdouble`
//     provides {G}{G} and pays a whole {C}{C} cost by itself, `1 - 2 = -1`, and no
//     printed "extra" can be less than none once the cost has been met;
//   • the two readings give DIFFERENT DAMAGE with the CARD COUNT HELD CONSTANT — two
//     attached cards deal 20 or 100 depending only on what they provide.
//
// 🛑 **AND THE COST IS THE EFFECTIVE ONE (D169), on the precedent one arm over in
// the same switch**: `opponentActiveRetreatCost` reads `effectiveRetreatCost` because
// *"a Stadium that changes what it costs to retreat changes what these attacks hit
// for"*. §3 drives both live surcharge sources — the Stadium (Basics only) and the
// opposing aura (stage-agnostic) — and a build reading `declared.cost` fails both.
//
// ⚠️ **§8.2 IS A CHECK AND NOT A PAYMENT** (`docs/reference/ptcg-rules.md` §8 step 2,
// verbatim: *"Attacking does not discard the energy unless the attack text says to"*),
// so "extra" is measured against everything still attached at §8.5. Nothing between
// the gate and the fold can move either operand: the pre-damage seam discards TOOLS.
//
// WHAT SHIPS: **1 whole-sentence anchor** (`EXTRA_ENERGY_BONUS`), **1 reader arm**
// inside `deriveAttackDamageBonus`, **1 `DamageCountSource` member**
// (`extraEnergyUnitsBeyondCost`), **1 evaluator arm** and **1 new parameter** on
// `scaledAttackDamage` (its two call sites in the same function). ZERO new
// `BoardCondition` members, clause-table rows, templates, ops, events, error codes,
// state fields, prompts, registry rows or `packages/schema` bytes;
// `MATCH_RECORD_VERSION` **STAYS 29** and §7 drives that in both directions.

/** The two printed sentences, byte-for-byte off `censusAttackCorpus.ts` rows 319/320. */
const CLAUSE =
  "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";
const SENTENCE_80 = `If ${CLAUSE}, this attack does 80 more damage.`;
const SENTENCE_100 = `If ${CLAUSE}, this attack does 100 more damage.`;
/** …and their legal printings, off the committed column. */
const PRINTED: readonly (readonly [string, number])[] = [
  [SENTENCE_80, 3],
  [SENTENCE_100, 2],
];

const APOS = "'";
const RSQUO = "’";
const curly = (text: string): string => text.replaceAll(APOS, RSQUO);

const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** Both seats field the same 60 (D270). */
const DECKS = { p1: EXTRA_ENERGY_DECK, p2: EXTRA_ENERGY_DECK };

/** Play `cardId` out of `seat`'s hand — the Stadium seam, D169's idiom. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  return mustApply(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) }).state;
}

/** `attacker` fields `cardId` carrying exactly `attach`; the other seat fields
    `defender` (the inert 340 HP body unless a board needs the aura's carrier), and
    BOTH benches are emptied — a stray body is precisely what a suite about counting
    must not have.

    ⚠️ THE ATTACKER GOES **SECOND**, so the board is returned on its own turn 2 and no
    §4 first-turn restriction is ever the reason an attack is refused. The seat is a
    PARAMETER because a `BoardCondition`-shaped defect would be invisible from one
    seat (D380), and this member reads the attacker's own body. */
function ready(
  seed: number,
  attacker: Seat,
  cardId: string,
  attach: Readonly<Record<string, number>>,
  opts: { defender?: string; stadium?: boolean } = {},
): GameState {
  const other: Seat = attacker === "p1" ? "p2" : "p1";
  let state = driveSetup(seed, DECKS, { first: other });
  state = mustApply(state, { type: "endTurn", seat: other }).state;
  state = setActiveFromDeck(state, attacker, cardId);
  for (const [id, n] of Object.entries(attach)) state = attachFromDeck(state, attacker, id, n);
  state = setActiveFromDeck(state, other, opts.defender ?? "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  if (opts.stadium === true) state = withStadium(state, attacker, "sv03-192");
  return state;
}

/** Swing at index 0 and report the damage actually dealt (0 when no row is filed). */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return body;
}

/** The printed cost of the Active's attack 0, and the cost §8.2 actually charges. */
function costs(state: GameState, seat: Seat): { printed: readonly string[]; effective: readonly string[] } {
  const body = activeOf(state, seat);
  const card = state.cardIdByUid[body.stack[body.stack.length - 1] ?? ""] ?? "";
  const printed = FIXTURE_COSTS[card] ?? [];
  return { printed, effective: effectiveAttackCost(state, body, printed) };
}

/** The three fixture attackers' printed costs, transcribed from `testFixtures.ts`
    rather than read back through the same accessor the engine uses — a cost read
    through the code under test could not disagree with it. */
const FIXTURE_COSTS: Readonly<Record<string, readonly string[]>> = {
  "fix-powerpress": ["Psychic", "Colorless"],
  "fix-highvoltage": ["Lightning", "Lightning", "Colorless"],
  "fix-extraprobe": ["Colorless", "Colorless"],
};

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the price, RE-DERIVED, and D368's refusal collected rather than reversed", () => {
  it("the corpus prints exactly TWO sentences on ONE clause, worth 5 legal printings", () => {
    // ⚠️ THE PATTERN IS PUBLISHED (D424/D425): a LOOSE `/extra Energy/i` over all 640
    // corpus sentences — not a shape, not the skeleton — and every hit is read. The
    // variant a narrower pattern would exclude is exactly the one worth finding.
    const loose = corpus().filter(([, s]) => /extra energy/i.test(s));
    expect(loose.map(([, s]) => s).sort()).toEqual([SENTENCE_100, SENTENCE_80].sort());
    expect(units(loose)).toBe(5);
    for (const [sentence, printings] of PRINTED) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
    }
    // ONE clause under two amounts — which is what makes this one anchor and not two.
    const SKELETON = /^If (.+), this attack does (\d+) more damage\.$/;
    expect(new Set(PRINTED.map(([s]) => SKELETON.exec(s)?.[1]))).toEqual(new Set([CLAUSE]));
  });

  it("🛑 both sentences are CLAIMED, and the reader SURFACE stands still at 13", () => {
    // The arm lives inside `deriveAttackDamageBonus`, an existing reader — so this is
    // a READER-keyed census move with no fourteenth reader behind it. Derived from the
    // module rather than from a hand-kept list (D417/D419).
    expect(attackReaderSurface()).toHaveLength(13);
    for (const [sentence] of PRINTED) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });

  it("the THRESHOLD comes off the clause and the AMOUNT off the skeleton", () => {
    expect(deriveAttackDamageBonus(SENTENCE_80)).toEqual({
      per: 80,
      count: { kind: "extraEnergyUnitsBeyondCost", extra: 2 },
    });
    expect(deriveAttackDamageBonus(SENTENCE_100)).toEqual({
      per: 100,
      count: { kind: "extraEnergyUnitsBeyondCost", extra: 2 },
    });
    // 🛑 NEITHER DIGIT IS HARD-CODED, and this is the probe that says so — D206's
    // rule, where a `* 30` literal survived every real printing because every real
    // printing prints 30. The catalog prints the threshold ONLY at 2 (asserted on the
    // POPULATION below, not on this specimen), so a constant `2` would pass every
    // corpus rung and fail here.
    expect(deriveAttackDamageBonus(`If ${CLAUSE.replace("least 2", "least 3")}, this attack does 80 more damage.`)).toEqual(
      { per: 80, count: { kind: "extraEnergyUnitsBeyondCost", extra: 3 } },
    );
    expect(corpus().filter(([, s]) => /at least \d+ extra Energy/.test(s) && !s.includes("at least 2 extra"))).toHaveLength(0);
  });

  it("🛑 D368's disqualification is RE-DRIVEN and still holds — two costs, one board", () => {
    // The measurement that refused a `BoardCondition`, re-run against the FIXTURES
    // that carry those recorded costs. `conditionHolds(state, seat, cond)` takes a
    // state and a seat and no attack; these two attacks want DIFFERENT thresholds off
    // the SAME board, so no such predicate can answer.
    expect(FIXTURE_COSTS["fix-powerpress"]).toHaveLength(2);
    expect(FIXTURE_COSTS["fix-highvoltage"]).toHaveLength(3);
    const thresholds = new Set(
      ["fix-powerpress", "fix-highvoltage"].map((id) => (FIXTURE_COSTS[id] ?? []).length + 2),
    );
    expect([...thresholds].sort()).toEqual([4, 5]);
    // …and it is a DIFFERENCE ON A BOARD, not on paper: four single-unit Energy arms
    // the cost-2 printing and leaves the cost-3 one unarmed, board for board.
    expect(damageDealt(ready(4360, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 }))).toBe(100);
    expect(damageDealt(ready(4361, "p1", "fix-highvoltage", { "fix-lightning-energy": 2, "fix-energy": 2 }))).toBe(20);
  });

  it("the two CONSEQUENTS stay disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(SENTENCE_80)).toBeNull();
    expect(deriveAttackRequirement(SENTENCE_100)).toBeNull();
    expect(deriveAttackDamageBonus(`If ${CLAUSE}, this attack does nothing.`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — CARDS versus UNITS: the discriminating boards", () => {
  it("🛑 TWO ATTACHED CARDS deal 20 or 100 — the card count HELD CONSTANT", () => {
    // The whole decision in one pair. `fix-extraprobe` costs {C}{C}; both boards
    // attach exactly TWO Energy CARDS and both pay the cost, so a reading that counts
    // CARDS answers `2 - 2 = 0` on both and can never separate them.
    const asUnits = ready(4362, "p1", "fix-extraprobe", { "fix-grassdouble": 2 });
    const asCards = ready(4363, "p1", "fix-extraprobe", { "fix-energy": 2 });
    expect(countAttachedEnergy(asUnits, activeOf(asUnits, "p1"), null)).toBe(2);
    expect(countAttachedEnergy(asCards, activeOf(asCards, "p1"), null)).toBe(2);
    // …and the UNITS differ, which is the only thing that does.
    expect(providedEnergy(asUnits, activeOf(asUnits, "p1"))).toHaveLength(4);
    expect(providedEnergy(asCards, activeOf(asCards, "p1"))).toHaveLength(2);
    expect(damageDealt(asUnits)).toBe(100);
    expect(damageDealt(asCards)).toBe(20);
  });

  it("🛑 the CARDS reading goes NEGATIVE on a board §8.2 admits", () => {
    // ONE `fix-grassdouble` provides {G}{G} and pays the whole {C}{C} cost by itself.
    // `cards - symbols` is **-1** here — a quantity no printed "extra" can mean — while
    // `units - symbols` is 0, the floor the cost check guarantees. That asymmetry is
    // the argument for the units reading, and it is a board rather than a paragraph.
    const board = ready(4364, "p1", "fix-extraprobe", { "fix-grassdouble": 1 });
    const body = activeOf(board, "p1");
    const cost = costs(board, "p1").effective;
    expect(cost).toHaveLength(2);
    expect(countAttachedEnergy(board, body, null) - cost.length).toBe(-1);
    expect(providedEnergy(board, body).length - cost.length).toBe(0);
    // The attack is legal — so this is not an unreachable arithmetic curiosity — and
    // the bonus is correctly absent under either reading at this attachment.
    expect(damageDealt(board)).toBe(20);
  });

  it("🛑 …and the same disagreement on a PRINTED cost, not only on the probe", () => {
    // `fix-powerpress` costs {P}{C}. Three cards providing four units: UNITS says
    // `4 - 2 = 2` and arms the clause, CARDS says `3 - 2 = 1` and does not.
    const board = ready(4365, "p1", "fix-powerpress", {
      "fix-grassdouble": 1,
      "fix-psychic-energy": 1,
      "fix-energy": 1,
    });
    const body = activeOf(board, "p1");
    expect(countAttachedEnergy(board, body, null)).toBe(3);
    expect(providedEnergy(board, body)).toHaveLength(4);
    expect(damageDealt(board)).toBe(100);
    // The control differs on ONE axis — the same three cards, all single-unit — and
    // the bonus goes away.
    const single = ready(4366, "p1", "fix-powerpress", {
      "fix-psychic-energy": 1,
      "fix-energy": 2,
    });
    expect(countAttachedEnergy(single, activeOf(single, "p1"), null)).toBe(3);
    expect(providedEnergy(single, activeOf(single, "p1"))).toHaveLength(3);
    expect(damageDealt(single)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the cost is the EFFECTIVE one, on both live surcharge sources", () => {
  it("🛑 the STADIUM's Basic surcharge takes the bonus away — same attachment", () => {
    const bare = ready(4367, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 });
    const charged = ready(4368, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 }, { stadium: true });
    // The two costs really do differ, which is what makes the damage difference
    // attributable to the fold and not to the board.
    expect(costs(bare, "p1").effective).toEqual(["Psychic", "Colorless"]);
    expect(costs(charged, "p1").effective).toEqual(["Psychic", "Colorless", "Colorless"]);
    // The PRINTED cost is identical on both boards — so a build reading
    // `declared.cost` answers 100 twice and cannot tell them apart.
    expect(costs(bare, "p1").printed).toEqual(costs(charged, "p1").printed);
    expect(damageDealt(bare)).toBe(100);
    expect(damageDealt(charged)).toBe(20);
  });

  it("🛑 …and the OPPOSING AURA does the same thing, with no Stadium in play", () => {
    // Seismitoad `sv03-052` "Quaking Zone" is stage-agnostic, so this board settles
    // the reading for the two real printings (a Stage 1 and a Stage 2) that the
    // Stadium's "each Basic Pokémon" gate would never have reached.
    const bare = ready(4369, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 });
    const aura = ready(4370, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 }, { defender: "sv03-052" });
    expect(aura.stadium).toBeNull();
    expect(costs(aura, "p1").effective).toHaveLength(3);
    expect(damageDealt(bare)).toBe(100);
    expect(damageDealt(aura)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the threshold swept around its boundary, on both seats", () => {
  // ⚠️ SWEPT AT cost+1, cost+2 AND cost+3, because `>=` against `>` differs on
  // EXACTLY ONE value: a suite that drives only "armed" and "unarmed" cannot tell
  // the two operators apart, and a suite that drives only the boundary cannot tell
  // an off-by-one from a constant.
  for (const seat of ["p1", "p2"] as const) {
    it(`the cost-2 printing (+80) is 20 / 100 / 100 at 3, 4 and 5 units — ${seat}`, () => {
      const at = (seed: number, colorless: number): number =>
        damageDealt(
          ready(seed, seat, "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": colorless }),
          seat,
        );
      expect([at(4371, 2), at(4372, 3), at(4373, 4)]).toEqual([20, 100, 100]);
    });

    it(`the cost-3 printing (+100) is 20 / 120 / 120 at 4, 5 and 6 units — ${seat}`, () => {
      const at = (seed: number, colorless: number): number =>
        damageDealt(
          ready(seed, seat, "fix-highvoltage", {
            "fix-lightning-energy": 2,
            "fix-energy": colorless,
          }),
          seat,
        );
      expect([at(4374, 2), at(4375, 3), at(4376, 4)]).toEqual([20, 120, 120]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — near-misses, ONE axis apiece, each with an ADMITTED twin", () => {
  const admitted = (sentence: string): void => {
    expect(deriveAttackDamageBonus(sentence), sentence).not.toBeNull();
  };
  const refused = (sentence: string): void => {
    expect(deriveAttackDamageBonus(sentence), sentence).toBeNull();
  };

  it("the printed-0 guard — and its twin one damage point up", () => {
    refused(`If ${CLAUSE}, this attack does 0 more damage.`);
    admitted(`If ${CLAUSE}, this attack does 1 more damage.`);
  });

  it("the adjective: no `more` is a different arithmetic and a different reader", () => {
    refused(`If ${CLAUSE}, this attack does 80 damage.`);
    admitted(SENTENCE_80);
  });

  it("the trailing period, and the leading capital", () => {
    refused(`If ${CLAUSE}, this attack does 80 more damage`);
    refused(`if ${CLAUSE}, this attack does 80 more damage.`);
    admitted(SENTENCE_80);
  });

  it("the é is REAL (U+00E9): an ASCII `e` is refused and the twin is admitted", () => {
    refused(SENTENCE_80.replace("Pokémon", "Pokemon"));
    admitted(SENTENCE_80);
  });

  it("the parenthetical is LOAD-BEARING — dropping it drops the cost from the sentence", () => {
    refused("If this Pokémon has at least 2 extra Energy attached, this attack does 80 more damage.");
    admitted(SENTENCE_80);
  });

  it("the `['’]` class: the U+2019 re-ingest derives IDENTICALLY (D136/D137)", () => {
    for (const [sentence] of PRINTED) {
      expect(curly(sentence)).not.toBe(sentence);
      expect(curly(sentence)).toContain(RSQUO);
      expect(deriveAttackDamageBonus(curly(sentence)), sentence).toEqual(
        deriveAttackDamageBonus(sentence),
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — the loud channel stays silent in BOTH directions", () => {
  it("no ATTACK_EFFECT_SKIPPED, armed or unarmed", () => {
    for (const [seed, colorless] of [
      [4377, 1],
      [4378, 3],
    ] as const) {
      const after = mustApply(
        ready(seed, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": colorless }),
        { type: "attack", seat: "p1", index: 0 },
      );
      expect(after.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
      // ⚠️ THE COUNTER IS NOT VACUOUS — it finds the row that IS filed on the same
      // stream. ⚠️ AND THIS IS NOT AN ATTRIBUTION CONTROL, stated as the partial it
      // is (D433): this 60 fields no card printing an unread sentence, so nothing
      // here proves the skip channel could fire at all. The channel's own witnesses
      // live in the suites that own an unread printing.
      expect(after.events.filter((e) => e.type === "ATTACK_DECLARED")).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from
  // this package; what is driven HERE is the engine-side fact it is about — whether
  // anything this slice produces reaches a persisted board.
  const armed = (): GameState =>
    ready(4379, "p1", "fix-powerpress", { "fix-psychic-energy": 1, "fix-energy": 3 });

  it("🛑 DIRECTION 1 — a v29 record round-trips and STILL scores the bonus", () => {
    const record = JSON.parse(JSON.stringify(armed())) as GameState;
    expect(damageDealt(record)).toBe(100);
  });

  it("🛑 DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    // `DamageCountSource` is a PARSE-TIME type: derived from card text and consumed
    // in the same tick by `scaledAttackDamage`. No op carries one, no field stores
    // one. Driven as a property of the SERIALIZED board rather than asserted.
    const before = armed();
    const after = mustApply(before, { type: "attack", seat: "p1", index: 0 }).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("extraEnergyUnitsBeyondCost");
    expect(wire).not.toContain("extraEnergy");
    // …and the attacker's own body gained no key: same key set as the untouched
    // defender's, which is the shape a new `InPlayPokemon` field would break.
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(armed());
    const attachedBefore = activeOf(frozen, "p1").energy.length;
    const after = mustApply(frozen, { type: "attack", seat: "p1", index: 0 });
    // §8.2 is a CHECK and not a payment: the Energy that armed the clause is still
    // attached afterwards, on the new board as well as on the frozen one.
    expect(activeOf(frozen, "p1").energy).toHaveLength(attachedBefore);
    expect(activeOf(after.state, "p1").energy).toHaveLength(attachedBefore);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(100);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});
