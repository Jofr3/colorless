import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  POKEMON_TYPES,
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
  BENCH_NAMED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D367 — THE BONUS CONSEQUENT'S ZERO-VOCABULARY FLOOR, AND A HANDED
// CANDIDATE REFUSED ON A MEASUREMENT.
//
// D366 handed over ONE sentence — *"If your opponent has 3 or more Benched
// Pokémon, this attack does 80 more damage."*, **1 legal printing**, needing **one
// new `BoardCondition` member** — and said in its own handoff that it must be
// PRICED rather than taken for being the seat-mirror of what D366 shipped.
//
// 🛑 **PRICED, AND REFUSED.** §1 runs the nine live readers over the whole
// `legalAttackCorpus()` under the `CONDITIONAL_DAMAGE_BONUS` anchor and finds the
// candidate inside a residue of **43 sentences / 60 printings** at D366's head.
// Partitioning that residue by **WHAT ACTUALLY REFUSES EACH** — against the live
// union, which is the partition D363 and D365 both got wrong in opposite
// directions — gives a **ZERO-NEW-VOCABULARY FLOOR of 9 sentences / 13 legal
// printings**: nine sentences that are an EXISTING member at an EXISTING
// parameter, refused only because no row or token spells them.
//
// **THIRTEEN PRINTINGS FOR ZERO MEMBERS BOUGHT, AGAINST ONE PRINTING FOR ONE
// MEMBER BOUGHT.** D363 found an inherited price too HIGH, D365 found one too
// LOW, D366 found the floor was ZERO. This is the first slice in the family where
// the floor is the LARGEST thing on the table — and naming it is the finding.
//
// WHAT SHIPS: **7 literal rows** in `CONDITIONAL_DAMAGE_CLAUSES` and **one token
// map widened** (`CLAUSE_POKEMON_TYPES` learns the brace notation its sibling
// `CLAUSE_ENERGY_TOKENS` has carried since D118). ZERO new union members, ops,
// events, error codes, regexes, registry rows, state fields, prompt kinds or
// choice kinds; `MATCH_RECORD_VERSION` STAYS 22.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `precociousEvolution.test.ts` use. Duplicated rather than exported across
    files because the point is to run them a SECOND time, from outside. */
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

/** The NINE sentences this slice claims, with the printings the catalog prints and
    the EXISTING member each resolves to. Every count here is re-derived against
    the committed corpus below rather than trusted. */
const TAKEN: readonly (readonly [string, number, BoardCondition])[] = [
  [
    "If Durant is on your Bench, this attack does 20 more damage.",
    2,
    { kind: "yourBenchHasNamed", name: "Durant" },
  ],
  [
    "If Illumise is on your Bench, this attack does 60 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Illumise" },
  ],
  [
    "If Mightyena is on your Bench, this attack does 90 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Mightyena" },
  ],
  [
    "If Beldum and Metang are on your Bench, this attack does 150 more damage.",
    1,
    {
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Beldum" },
        { kind: "yourBenchHasNamed", name: "Metang" },
      ],
    },
  ],
  [
    "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
    2,
    { kind: "opponentActiveIsStage2" },
  ],
  [
    "If your opponent has 5 or fewer cards in their hand, this attack does 60 more damage.",
    1,
    { kind: "opponentHandAtMost", count: 5 },
  ],
  [
    "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage.",
    2,
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
  ],
  [
    "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    2,
    { kind: "opponentActiveHasType", type: "Psychic" },
  ],
  [
    "If your opponent's Active Pokémon is a {D} Pokémon, this attack does 100 more damage.",
    1,
    { kind: "opponentActiveHasType", type: "Darkness" },
  ],
];

/** The ids behind the thirteen printings — remote D1 `luminous`, `$.effect`, the
    extractor verified against the 640 / 1,732 / 60,467 total FIRST, 2026-08-19.
    Every one `legal_standard = 1` and `category = 'Pokemon'`, and NONE of the nine
    sentences has a `legal_standard = 0` copy anywhere in the catalog. */
const TAKEN_IDS: readonly string[] = [
  "sv10.5w-070",
  "sv10.5w-150",
  "sv06-009",
  "sv06-114",
  "sv09-063",
  "sv10-101",
  "sv10-214",
  "sv07-084",
  "svp-151",
  "sv08-038",
  "sv05-068",
  "sv05-170",
  "sv10-028",
];

/** The handed candidate, NOT taken — and the four biggest things left behind the
    bonus skeleton after this slice, each with what it still costs. */
const HANDED_CANDIDATE =
  "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";

const LEFT: readonly (readonly [string, number, string])[] = [
  [
    "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
    3,
    // 🛑🆕🆕 D368 — THIS COST DESCRIPTION WAS WRONG, AND THE CORRECTION IS THE
    // FINDING. It is not "a member no one has written yet": it is NOT A BOARD FACT
    // AT ALL. The identical clause is printed on Electivire ex `sv10-069`/`-212`
    // ({L}{L}{C}) and Jellicent ex `sv10.5w-045`/`-160`/`-168` ({P}{C}), so the
    // SAME board answers it differently depending on which attack was declared —
    // and `conditionHolds(state, seat, cond)` is handed no attack. Priced and
    // disqualified on SHAPE in `undamagedBonus.test.ts` §1.
    "NOT A `BoardCondition` AT ALL — the clause reads THIS ATTACK'S COST, which two printings set to two different values, so no state+seat predicate can answer it",
  ],
  // 🛑🆕🆕 D388 — AND AGAIN, FOR THE NINTH SLICE RUNNING. The RETREAT-COST THRESHOLD
  // that sat here — named by D387 as the cheapest thing in the whole residue at
  // 1 printing / 2 mechanisms = **0.50**, and DELIBERATELY LEFT because its SHAPE
  // question was open — was taken by D388 (`retreatCostBonus.test.ts`) for ONE
  // PARAMETERISED `BoardCondition` member with its two arms and ONE literal clause
  // row. ZERO new card predicates. `MATCH_RECORD_VERSION` stayed 23.
  //
  // 🛑 **AND THE SHAPE QUESTION D387 HANDED ON WAS REAL, WHICH IS THIS ROW'S FINDING.**
  // The printed noun phrase *"the Retreat Cost of your opponent's Active Pokémon"* has
  // TWO live readings in this engine — `retreatCostOf` (the printed column) and
  // `effectiveRetreatCost` (the board fold, D322) — that DISAGREE on any board with a
  // retreat Stadium or a retreat aura. D388 took the FOLD, because attack.ts has read
  // that same printed noun phrase through it since 0.61.0 (D159) and because the game's
  // own rules give Retreat Cost an order of operations rather than a constant. **The
  // rungs that settle it are the ones a build of the other reading turns RED**: five of
  // them, in both directions, driven on Calamitous Wasteland, Beach Court and Spidops ex.
  //
  // 🛑 **THE PRICE D386 GOT WRONG AND D387 CORRECTED HAS NOW BEEN PAID AT THE
  // CORRECTED NUMBER**, which is the whole point of re-measuring a "cheapest" claim
  // over the WHOLE residue rather than over the rows already in mind.
  // 🛑🆕🆕 D389 — AND AGAIN, FOR THE TENTH SLICE RUNNING. The OPPONENT-SEAT BENCH COUNT
  // that sat here — this file's own `HANDED_CANDIDATE`, named by D366 and priced by
  // D367 at 1 printing against the zero-vocabulary floor's 13 — was taken by D389
  // (`opponentBenchCount.test.ts`) for ONE PARAMETERISED `BoardCondition` member with
  // its two arms and ONE literal clause row. ZERO new card predicates.
  // `MATCH_RECORD_VERSION` stayed 23.
  //
  // 🛑 **AND THE SHAPE QUESTION THIS ROW CARRIED FOR TWENTY-TWO SLICES WAS THE RUN'S
  // OLDEST: A SECOND MEMBER, OR A *SEAT PARAMETER* ON `yourBenchAtLeast`?** The
  // candidate differs from the shipped member in the SEAT ALONE, which is the strongest
  // case a parameter ever had here. It is a SECOND MEMBER on three measured grounds:
  // the union already answers the seat question THREE times without a seat field
  // (`yourActiveDamaged`, `yourActivePoisoned`, `yourActiveHasToolAttached` and their
  // `opponent*` twins); D362's 31-site price RE-MEASURED at this head is 22 executable
  // sites across 5 files, so the order of magnitude stands; and `conditionNote` prints
  // a DIFFERENT sentence per seat, so a `seat` field saves no body and pays the rename
  // on top.
  // 🛑🆕🆕 D390 — AND AGAIN, FOR THE ELEVENTH SLICE RUNNING. The OPPONENT-SEAT TYPE
  // READ that sat here — 1 printing, named by D389 as the next candidate — was taken by
  // D390 (`inPlayTypeBonus.test.ts`) for ONE PARAMETERISED `BoardCondition` member
  // (`opponentInPlayHasType`) with its two arms and ONE anchored TEMPLATE reusing
  // `CLAUSE_POKEMON_TYPES` whole. ZERO new vocabulary. `MATCH_RECORD_VERSION` stayed 23.
  //
  // 🛑 **AND THE SHAPE QUESTION IT CARRIED WAS AN *ANCHOR* QUESTION, WHICH IS A KIND
  // THIS TABLE HAD NOT PRICED BEFORE.** D389 had already settled the seat half; what was
  // left is that `boardConditionForClause`'s four template patterns each assert mutual
  // exclusivity IN A COMMENT, and a FIFTH pattern can falsify that silently. D390 wrote
  // the 5×4 head×tail cross product (`clauseTemplateAnchors.test.ts`) at the head BEFORE
  // the pattern existed, carrying this very sentence as an unbuilt row — so the guard is
  // older than the thing it guards, and the tripwire fired on the commit that built it.
  // 🛑🆕🆕 D391 — AND AGAIN, FOR THE TWELFTH SLICE RUNNING. The TYPED PER-BODY
  // ENERGY THRESHOLD that sat here — *"If this Pokémon has 2 or more {G} Energy attached,
  // this attack does 120 more damage."*, Abomasnow `sv10-060` "Frozen Wood" at ONE legal
  // printing — was taken by D391 (`typedEnergyThreshold.test.ts`) for **ONE OPTIONAL
  // FIELD** on the shipped `yourActiveEnergyAtLeast` member, ONE literal clause row and
  // TWO **edited** arms. ZERO new members. `MATCH_RECORD_VERSION` stayed 23.
  //
  // 🛑 **AND THIS ROW'S `needs` COLUMN ASKED THE SHAPE QUESTION THE RIGHT WAY AND
  // GOT AN ANSWER NINE SLICES OF PRECEDENT WOULD HAVE GOT WRONG.** It said the sentence
  // is "one FIELD short of one member and one ZONE short of the other" — and the FIELD
  // won, which is the OPPOSITE of what D389 decided one axis over. The discriminator is
  // not the precedent but the arithmetic: D389's seat field would have been REQUIRED (a
  // rename across 22 executable sites) and would have saved no note body; `energy?` is
  // OPTIONAL, edits ZERO of `yourActiveEnergyAtLeast`'s 11 executable sites, drops into
  // ONE interpolation slot of a note that already existed, and hands
  // `countAttachedEnergy` a filter it has taken as a parameter since D128. **A COMPARAND
  // IS A SHAPE AND TAKES A MEMBER; A FILTER THE DELEGATE ALREADY ACCEPTS IS A FIELD.**
];

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_NAMED_DECK, p2: BENCH_NAMED_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with one Energy paid, P2 fields a 200 HP body that
    survives every printed base here, and BOTH benches start EMPTY — each case
    puts exactly the bodies it is about. */
function ready(seed: number, attacker: string, energy: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", energy, 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

function benched(state: GameState, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, "p1", id);
  return next;
}

/** Attack index 0 and report the damage actually dealt. */
function damageDealt(state: GameState): { damage: number; kinds: string[] } {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return { damage: dealt?.damage ?? 0, kinds: types(after.events) };
}

describe("§1 — the candidate was PRICED against the whole residue, not inherited", () => {
  it("🛑 the bonus skeleton's residue at D366's head was 43 sentences / 60 printings", () => {
    // Re-derived from the parts rather than quoted: everything under the anchor,
    // minus everything the nine readers now carry, plus what this slice took.
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const carried = openers.filter(([, s]) => resolvedByAnyReader(s));
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    // THE PARTITION SUMS — parts that do not add to the population are not a
    // partition, however carefully each half is measured.
    expect(carried.length + refused.length).toBe(openers.length);
    expect(units(carried) + units(refused)).toBe(units(openers));
    // 🆕🆕 D372 — the residue is 28 / 36. D372 took **TWO sentences / TWO
    // printings** (ONE clause, the CROSS-BOARD EQUAL-ENERGY one, printed at two
    // amounts — `sameEnergyBonus.test.ts`), so the two terms of this chain stop
    // stepping in the 1-and-2 pattern the four slices before it kept, and every
    // earlier head is still re-derived from the measured one rather than quoted.
    // 🆕🆕 D371 — the residue was 30 / 38. D371 took ONE sentence / TWO printings
    // (the OPPONENT-RESISTANCE clause, `opponentResistanceBonus.test.ts`), so the
    // whole chain below gains one more term and every earlier head is still
    // re-derived from the measured one rather than quoted.
    // 🆕🆕 D370 — the residue was 31 / 40. D370 took ONE sentence / TWO printings
    // (the bench-scoped {M} TYPE clause, `benchTypeBonus.test.ts`), so the whole
    // chain below gains one term and every earlier head is still re-derived from
    // the measured one rather than quoted.
    // 🆕🆕 D369 — the residue was 32 / 42; at D368's head it was 33 / 44, at D367's
    // 34 / 47, and before D367 34 + 9 and 47 + 13. D369 took ONE sentence / TWO
    // printings (the cross-board Pokémon Tool clause, `opponentToolBonus.test.ts`),
    // so BOTH numbers step again and every figure below is re-derived from the
    // measured head rather than left frozen at the head that measured it.
    // 🆕🆕 D373 — the residue is 27 / 34. D373 took ONE sentence / TWO printings (the
    // UNIVERSAL-OVER-THE-BENCH clause, `benchAllDamagedBonus.test.ts`), so the chain
    // gains one more term and every earlier head is still re-derived from the
    // measured one rather than quoted.
    // 🆕🆕 D374 — the residue is 26 / 32. D374 took ONE sentence / TWO printings (the
    // NAMED-ENERGY clause, `trEnergyBonus.test.ts`) — the candidate this file's own
    // `LEFT` table has carried since D367 — so the chain gains one more term and
    // every earlier head is still re-derived from the measured one rather than quoted.
    // 🆕🆕 D375 — the residue is 25 / 30. D375 took ONE sentence / TWO printings (the
    // CROSS-BOARD TYPE INTERSECTION, `typeShareBonus.test.ts`) — the candidate this
    // file's own `LEFT` table promoted at D374 — so the chain gains one more term.
    // 🆕🆕 D376 — the residue is 24 / 28. D376 took ONE sentence / TWO printings (the
    // FILTERED DISCARD-PILE THRESHOLD, `basicEnergyDiscard.test.ts`) — the candidate
    // this file's own `LEFT` table promoted at D375 — so the chain gains one more term
    // and every earlier head is still re-derived from the measured one.
    // 🆕🆕 D377 — 24 / 28 -> 22 / 26: the CROSS-BOARD STATUS PAIR left this residue —
    // TWO sentences at ONE printing each (*"…is Burned"* +40, *"…is Confused"* +90) —
    // so the step is 2:2 rather than the 1:2 the six slices before it took. Re-derived
    // live rather than decremented. ⚠️ AND THAT SLICE'S THIRD PRINTING IS NOT IN THIS
    // NUMBER: the same board fact is printed once more under the "does nothing"
    // consequent, which is a different skeleton and a different residue.
        // 🆕🆕 D378 — 22 / 26 -> 21 / 25: STADIUM PRESENCE (`stadiumInPlay`) left this
    // residue — ONE sentence at ONE printing (Probopass `sv10-098` "Mountain Drop",
    // +70) — re-derived live rather than decremented. ⚠️ AND TWO OF THAT SLICE'S
    // THREE PRINTINGS ARE NOT IN THIS NUMBER: the same board fact is printed under
    // the "does nothing" consequent by Fan Rotom, which is a different skeleton and a
    // different residue — and there it is the BIGGER half.
    // 🆕🆕 D384 — 21 / 25 -> 20 / 24: the STRICT-INEQUALITY TWIN left this residue —
    // ONE sentence at ONE printing (Swalot `sv07-092` "Devouring Mouth", +160) — and
    // it is the family's FIRST 1:1 step, re-derived live rather than decremented.
    // ⚠️ AND IT IS THE SENTENCE D372 PRICED AND REFUSED: the same two Active bodies as
    // `activeEnergyCountsEqual`, under `>` instead of `===`, on a SECOND nullary member.
    // 🆕🆕 D386 — 20 / 24 -> 19 / 22: the HEALED-THIS-TURN clause left this residue —
    // ONE sentence at TWO printings (Maractus `sv10.5b-008`/`-093` "Lively Needles",
    // +100) — re-derived live rather than decremented, and it EMPTIES the 2-printing
    // band that the `LEFT` table above has tracked since D376.
    // 🆕🆕 D387 — 19 / 22 -> **18 / 21**: the STAGE 1 clause left this residue — ONE
    // sentence at ONE printing (Paldean Tauros `sv08-018` "Spirited Tackle", +90), a
    // 1:1 step and a SINGLETON, so the whole step falls on the 1-printing band.
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
    // 🆕🆕 D392 — 14 / 17 -> **13 / 16**: the SUBSTRING NAME READ left this residue — ONE
    // sentence at ONE printing (Team Rocket's Nidoqueen `sv10-116` "Love Impact", +120) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and the
    // distribution goes `{1: 12, 5: 1}` -> `{1: 11, 5: 1}`. ⚠️ AND THIS STEP WAS TAKEN BY A
    // SECOND MEMBER, the OPPOSITE shape from D391's one slice back — the measurements that
    // decided it are driven in `benchNameSubstring.test.ts` §2.
    expect([refused.length, units(refused)]).toEqual([7, 10]); // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    // 🆕🆕 D392 — every OFFSET below gains one on each axis, because the HEAD moved and
    // the earlier heads did not: each line still names the residue at a past slice.
    expect([refused.length + 17, units(refused) + 18]).toEqual([24, 28]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    expect([refused.length + 18, units(refused) + 20]).toEqual([25, 30]);
    expect([refused.length + 19, units(refused) + 22]).toEqual([26, 32]);
    expect([refused.length + 20, units(refused) + 24]).toEqual([27, 34]);
    expect([refused.length + 21, units(refused) + 26]).toEqual([28, 36]);
    expect([refused.length + 23, units(refused) + 28]).toEqual([30, 38]);
    expect([refused.length + 24, units(refused) + 30]).toEqual([31, 40]);
    expect([refused.length + 25, units(refused) + 32]).toEqual([32, 42]);
    expect([refused.length + 26, units(refused) + 34]).toEqual([33, 44]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, D366's did not.
    expect([refused.length + 27, units(refused) + 34 + 3]).toEqual([34, 47]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, D366's did not.
    expect([refused.length + 27 + TAKEN.length, units(refused) + 37 + 13]).toEqual([43, 60]);
  });

  it("🛑 the ZERO-VOCABULARY FLOOR over that residue was 9 sentences / 13 printings", () => {
    // The floor stated as a NUMBER measurement can contradict, D366's form. Each
    // of the nine is an EXISTING member at an EXISTING parameter — which is what
    // makes this slice's purchase ZERO union members — and the printing count is
    // re-derived from the corpus rather than carried.
    expect(TAKEN).toHaveLength(9);
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBe(13);
    for (const [sentence, printings] of TAKEN) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
    }
  });

  it("🛑 …and 13 beat the handed candidate's 1 — which is why D367 refused it, and D389 took it", () => {
    // 🆕🆕 D389 — THE TRIPWIRE FIRED, AND THIS IS WHAT IT WAS FOR. The handed sentence
    // is still real and still worth ONE printing, and it is now BUILT: D389 added the
    // clause row and the seat-twin member (`opponentBenchAtLeast`), twenty-two slices
    // after this file priced it at 1 against the floor's 13. The rung is re-aimed at
    // the ARITHMETIC that made the refusal correct AT THE TIME rather than deleted,
    // because what this file measured was a RATIO and not an absence.
    expect(units(corpus().filter(([, s]) => s === HANDED_CANDIDATE))).toBe(1);
    expect(resolvedByAnyReader(HANDED_CANDIDATE)).toBe(true);
    expect(deriveAttackDamageBonus(HANDED_CANDIDATE)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentBenchAtLeast", count: 3 },
    });
    // …and it arrived through the BONUS consequent alone, so D125's disjointness held
    // across twenty-two slices of this sentence sitting unclaimed.
    expect(deriveAttackRequirement(HANDED_CANDIDATE)).toBeNull();
    // 13 to 1 — the comparison written as arithmetic so it cannot rot into prose.
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(
      units(corpus().filter(([, s]) => s === HANDED_CANDIDATE)) * 12,
    );
  });

  it("names what is LEFT, with what each still costs — and every one is still refused", () => {
    for (const [sentence, printings, cost] of LEFT) {
      expect(units(corpus().filter(([, s]) => s === sentence)), cost).toBe(printings);
      expect(resolvedByAnyReader(sentence), cost).toBe(false);
      // Refused by VOCABULARY, not by the ANCHOR — D363's distinction, which is
      // an order of magnitude in price. Each matches the skeleton and misses at
      // the table.
      expect(BONUS.test(sentence.trim()), sentence).toBe(true);
    }
    // 🆕🆕 D368 — the largest single item left is STILL 3 printings, but it is now
    // the DISQUALIFIED one: D368 took the other 3-printing entry (the undamaged
    // complement) and the declaration-fact clause cannot be taken at any price.
    // ⚠️ **SO THE LARGEST REMAINING *PURCHASABLE* ITEM IS 2**, which is the number
    // a successor should actually inherit — stated separately from the raw maximum
    // so the two cannot be confused for each other.
    expect(Math.max(...LEFT.map(([, n]) => n))).toBe(3);
    const purchasable = LEFT.filter(([, , cost]) => !cost.startsWith("NOT A `BoardCondition`"));
    // 🆕🆕 D386 — 2 -> **1**. The healed-this-turn row was the last purchasable 2, and
    // taking it EMPTIES the band: every remaining candidate in this residue is worth
    // exactly ONE printing, so a successor's tie-break stops being arithmetic and
    // becomes a cost comparison among equals. 🛑 THAT IS D379's SATURATION SHAPE, and
    // the rung stays able to go red from the OTHER side: a reader narrowing so any
    // clause returns to 2 fails it, as does the disqualified row being claimed.
    // 🆕🆕 D388 — 3 -> **2**: the RETREAT-COST THRESHOLD left this list, and the
    // purchasable maximum STANDS STILL at 1 — a second consecutive singleton, so the
    // saturation D386 recorded is not a one-slice artefact.
    // 🆕🆕 D389 — the OPPONENT-SEAT BENCH COUNT left it too and the NEXT candidate
    // replaced it, so the length STANDS STILL at 2 while both entries changed. ⚠️ **A
    // LENGTH THAT DOES NOT MOVE IS NOT A LIST THAT DID NOT MOVE**, which is why the
    // rungs above walk the entries by SENTENCE and this one only closes the arithmetic.
    // The purchasable maximum is a singleton for a THIRD consecutive slice.
    //
    // 🛑🆕🆕 D391 — **AND NOW THE PURCHASABLE HALF OF THIS FILE'S LIST IS EMPTY.** The
    // TYPED PER-BODY ENERGY THRESHOLD was the last entry D366 named that anything could
    // buy, and D391 bought it; what remains is the ONE row disqualified on SHAPE
    // (D368's *"extra Energy … in addition to this attack's cost"*, which is not a
    // `BoardCondition` at all). So `Math.max` over an empty list is no longer written —
    // it would be `-Infinity`, a shape nothing means — and the emptiness is asserted
    // DIRECTLY instead, which is D379's saturation rule applied to a list rather than
    // to a band. ⚠️ **THIS RUNG CAN STILL GO RED IN BOTH DIRECTIONS**: it fails if the
    // disqualified row is ever claimed (it is driven as unresolved just below), and it
    // fails if a future candidate is appended here without being bought.
    expect(purchasable).toEqual([]);
    expect(LEFT).toHaveLength(1);
    expect(LEFT[0]?.[2].startsWith("NOT A `BoardCondition`")).toBe(true);
    expect(resolvedByAnyReader(LEFT[0]?.[0] ?? "")).toBe(false);
  });
});

describe("§2 — every taken sentence resolves to the EXISTING member, by value", () => {
  it("maps all nine to their member and their printed amount", () => {
    for (const [sentence, , cond] of TAKEN) {
      const read = deriveAttackDamageBonus(sentence);
      expect(read, sentence).not.toBeNull();
      expect(read?.count, sentence).toEqual({ kind: "boardCondition", cond });
      // The amount comes off the OUTER skeleton, never off the clause row — which
      // is why one row serves both Durant printings and both Regirock ex ones.
      expect(read?.per, sentence).toBe(Number(BONUS.exec(sentence)?.[2]));
    }
  });

  it("🛑 buys ZERO new union members — every member here already had both reader arms", () => {
    // The claim that makes this slice cheap, driven rather than asserted: each
    // condition answers on a board AND renders a note, which are the two
    // exhaustive `switch (cond.kind)` statements in the repo. A member added by
    // this slice would have needed two new arms; none did.
    const state = ready(4700, "fix-durant", "fix-energy");
    for (const [sentence, , cond] of TAKEN) {
      expect(typeof conditionHolds(state, "p1", cond), sentence).toBe("boolean");
      expect(conditionNote(cond), sentence).not.toBe("");
    }
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on all nine", () => {
    for (const [sentence] of TAKEN) {
      // The requirement reader must never see a sentence meaning "+N".
      expect(deriveAttackRequirement(sentence), sentence).toBeNull();
      // …and the cancel spelling of the same clause must never reach the bonus
      // table, which is the direction that would score a bonus off a cancel.
      const clause = BONUS.exec(sentence)?.[1] ?? "";
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`),
        clause,
      ).toBeNull();
    }
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches a row", () => {
    const [sentence] = TAKEN[0] ?? ["", 0, { kind: "yourStadiumInPlay" } as BoardCondition];
    const clause = BONUS.exec(sentence)?.[1] ?? "";
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 20 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 20 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 20 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });
});

describe("§3 — the SELF-NAMING boards: 'on your Bench' is not 'in play', on two more cards", () => {
  it("🛑 Durant's clause names DURANT — the attacker's own card, and it must NOT satisfy itself", () => {
    // The board that refutes the widening in one line: a Durant in the ACTIVE
    // SPOT and an EMPTY Bench. `yourBenchHasNamed` is false; an "in play" reading
    // of the same name would be TRUE and the +20 would be unconditional.
    const alone = ready(4701, "fix-durant", "fix-energy");
    const topUid = alone.players.p1.active?.stack.at(-1) ?? "";
    expect(alone.cardIdByUid[topUid]).toBe("fix-durant");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(false);
    expect(damageDealt(alone).damage).toBe(20);
    // …and with a SECOND Durant on the Bench the same board pays the bonus.
    const paired = benched(ready(4702, "fix-durant", "fix-energy"), "fix-durant");
    expect(conditionHolds(paired, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(true);
    expect(damageDealt(paired).damage).toBe(40);
  });

  it("🛑 Mightyena's clause names MIGHTYENA — the same refutation, a second card", () => {
    const alone = ready(4703, "fix-mightyena", "fix-dark-energy");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(
      false,
    );
    expect(damageDealt(alone).damage).toBe(30);
    const pack = benched(ready(4704, "fix-mightyena", "fix-dark-energy"), "fix-mightyena");
    expect(conditionHolds(pack, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(true);
    expect(damageDealt(pack).damage).toBe(120);
  });

  it("Volbeat is the CONTROL — it names a DIFFERENT card, so the member is not 'another copy of me'", () => {
    // Two boards, one difference: the benched body's NAME. A nameless filler does
    // not satisfy the clause; Illumise does. That is what stops `yourBenchHasNamed`
    // being read as a self-reference, which the three self-naming printings above
    // could not distinguish on their own.
    const filler = benched(ready(4705, "fix-durant", "fix-energy"), "fix-benchfiller");
    expect(conditionHolds(filler, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(
      false,
    );
    const real = benched(ready(4706, "fix-durant", "fix-energy"), "fix-illumise");
    expect(conditionHolds(real, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(true);
    // 3 SELF-NAMING printings and 1 that is not — stated as a number, because "the
    // pool prints one" is the exact claim this slice found rotted in the table.
    expect(
      TAKEN.filter(([s]) => s.includes("is on your Bench") || s.includes("are on your Bench")),
    ).toHaveLength(4);
  });

  it("🛑 the `allOf` row needs BOTH bodies — one conjunct is not the conjunction", () => {
    const cond = TAKEN[3]?.[2] as BoardCondition;
    const neither = ready(4707, "fix-durant", "fix-energy");
    expect(conditionHolds(neither, "p1", cond)).toBe(false);
    const beldum = benched(ready(4708, "fix-durant", "fix-energy"), "fix-beldum");
    expect(conditionHolds(beldum, "p1", cond)).toBe(false);
    const metang = benched(ready(4709, "fix-durant", "fix-energy"), "fix-metang");
    expect(conditionHolds(metang, "p1", cond)).toBe(false);
    const both = benched(ready(4710, "fix-durant", "fix-energy"), "fix-beldum", "fix-metang");
    expect(conditionHolds(both, "p1", cond)).toBe(true);
    // …and the polarity is the OPPOSITE of D365's Mesprit row, which spells the
    // same two-name conjunction under a CANCEL where the skeleton owns the
    // negation. Same combinator, two consequents, no crossover.
    expect(
      deriveAttackRequirement("If you don't have Uxie and Azelf on your Bench, this attack does nothing."),
    ).not.toBeNull();
  });
});

describe("§4 — the Stage 2 row is not the Evolution row narrowed", () => {
  it("🛑 an Evolution defender that is a STAGE 1 does not satisfy it — driven both ways", () => {
    const cond: BoardCondition = { kind: "opponentActiveIsStage2" };
    const evolution: BoardCondition = { kind: "opponentActiveIsEvolution" };
    let stage1 = setActiveFromDeck(board(4720), "p2", "fix-stage1");
    stage1 = clearBench(stage1, "p2");
    expect(conditionHolds(stage1, "p1", evolution)).toBe(true);
    // The board that separates them: TRUE for the row three above, FALSE here.
    expect(conditionHolds(stage1, "p1", cond)).toBe(false);
    let stage2 = setActiveFromDeck(board(4721), "p2", "fix-stage2");
    stage2 = clearBench(stage2, "p2");
    expect(conditionHolds(stage2, "p1", cond)).toBe(true);
    expect(conditionHolds(stage2, "p1", evolution)).toBe(true);
  });

  it("the two rows are DIFFERENT keys and neither reaches the other", () => {
    const stage2 = TAKEN[4]?.[0] ?? "";
    expect(deriveAttackDamageBonus(stage2)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage2" },
    });
    // 🆕🆕 D387 — THE STAGE 1 SIBLING THIS RUNG PINNED AS UNBOUGHT WAS BOUGHT, so the
    // rung is re-aimed at what it was really about: the two rows are DIFFERENT KEYS
    // and neither reaches the other. It used to say "still refused"; it now says
    // "resolved, and to its OWN member" — which is the stronger claim and the one a
    // wrong build would fail. Driven on boards in `stage1Bonus.test.ts` §3.
    const stage1Sentence =
      "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.";
    expect(units(corpus().filter(([, s]) => s === stage1Sentence))).toBe(1);
    expect(deriveAttackDamageBonus(stage1Sentence)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage1" },
    });
    // …and the two keys differ by ONE PRINTED DIGIT, which is what makes the
    // whole-clause key the thing keeping them apart.
    expect(stage1Sentence.replace("Stage 1", "Stage 2")).not.toBe(stage2);
  });
});

describe("§5 — 'N or fewer' as an enumerated set, complete over the domain", () => {
  it("🛑 the prize row answers identically to `<= 4` at every representable count 0-6", () => {
    // The claim that makes a set exact rather than merely convenient: prize counts
    // are 0-6 by §3.8, so an enumeration over the whole domain and a threshold
    // cannot disagree on any board this engine can build. Driven at all SEVEN
    // values rather than at the boundary.
    const cond = TAKEN[6]?.[2] as { kind: "opponentPrizesRemaining"; counts: readonly number[] };
    expect(cond.counts).toEqual([0, 1, 2, 3, 4]);
    for (let n = 0; n <= 6; n += 1) {
      expect(cond.counts.includes(n), `prizes ${String(n)}`).toBe(n <= 4);
    }
    // …and the spelling is the one the repo ALREADY uses: `registry.ts` authors
    // the same shape for a printed "3 or fewer", the 0 included. Two producers,
    // one convention.
    const authored = registryCardIds().filter((id) =>
      JSON.stringify(programFor(id) ?? {}).includes('"opponentPrizesRemaining"'),
    );
    expect(authored.length).toBeGreaterThanOrEqual(2);
    for (const id of authored) {
      expect(JSON.stringify(programFor(id)), id).toContain("[0,1,2,3]");
    }
  });

  it("the hand row is the SAME member at a SECOND threshold, and both still resolve", () => {
    expect(deriveAttackDamageBonus(TAKEN[5]?.[0] ?? "")?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentHandAtMost", count: 5 },
    });
    // The row that was there first is untouched — a new threshold must not
    // re-interpret the old one, which whole-clause keys guarantee by construction.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentHandAtMost", count: 3 } });
  });
});

describe("§6 — the token map: an ASYMMETRY between two sibling templates, closed", () => {
  it("🛑 BOTH notations now resolve, and they resolve to the SAME member", () => {
    // The defect: `CLAUSE_ENERGY_TOKENS` carries codes AND names and says why;
    // `CLAUSE_POKEMON_TYPES` carried names alone, so three legal printings spelled
    // in the other notation were refused by all nine readers.
    const glyph = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    );
    const name = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a Psychic Pokémon, this attack does 30 more damage.",
    );
    expect(glyph).not.toBeNull();
    // EQUALITY, not merely non-null: two spellings of one board fact must produce
    // one value, which is D136's shape for the apostrophe fold applied to notation.
    expect(glyph).toEqual(name);
  });

  it("resolves EVERY member of POKEMON_TYPES in BOTH notations", () => {
    // Totality, so the map cannot rot the way a hand-kept alternation does. The
    // code map is already canonical against POKEMON_TYPES; this is the rung that
    // says the CLAUSE map inherited that.
    const CODE_OF: Readonly<Record<string, string>> = {
      Grass: "G",
      Fire: "R",
      Water: "W",
      Lightning: "L",
      Psychic: "P",
      Fighting: "F",
      Darkness: "D",
      Metal: "M",
      Fairy: "Y",
      Dragon: "N",
      Colorless: "C",
    };
    expect(POKEMON_TYPES).toHaveLength(11);
    for (const type of POKEMON_TYPES) {
      const code = CODE_OF[type];
      expect(code, type).toBeDefined();
      const byName = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a ${type} Pokémon, this attack does 30 more damage.`,
      );
      const byCode = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a {${String(code)}} Pokémon, this attack does 30 more damage.`,
      );
      expect(byName, type).not.toBeNull();
      expect(byCode, type).toEqual(byName);
      expect(byCode?.count, type).toEqual({
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type },
      });
    }
  });

  it("🛑 D387's literal row won its clause, and the TYPE MAP learned nothing from it", () => {
    // The control the rung below used to be able to make with "Stage 1" in its list.
    // `YOUR_BENCH_TYPE_CLAUSE` shares `CLAUSE_POKEMON_TYPES` with the Active-type
    // pattern and has NO literal row behind it, so the same token through that
    // template is the measurement that separates "the row won" from "the map grew".
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 30 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } });
  });

  it("🛑 the pattern is still LOOSE and the MAP is still the vocabulary — non-types stay LOUD", () => {
    // The regex captures `(.+)`, so every one of these reaches the lookup and
    // MISSES it. If the map ever became the regex, these would silently resolve to
    // a type that does not exist.
    // 🆕🆕 D387 — "Stage 1" LEFT THIS LIST, and it left through the LITERAL table
    // rather than through the map: D387 added a whole-clause row for it, and
    // `boardConditionForClause` consults that table first. The map itself learned
    // NOTHING — the rung directly below drives the same token through a template that
    // shares the map and has no literal row behind it, and it is still null.
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

describe("§7 — the census moves in exactly ONE summand, and the other three are measured", () => {
  it("🛑 raw 1,207 → 1,220 → 🆕 1,223 and resolving sentences 335 → 344 → 🆕 345", () => {
    const resolved = corpus().filter(([, text]) => resolvedByAnyReader(text));
    expect(resolved).toHaveLength(395); // 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — Wo-Chien `sv08-015` "Hazardous Greed" behind a `conditionGate`, plus the FOUR printings the flat rider was refusing on the literal count `1`; a READER-keyed move, so no registry summand moves) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE) // 🆕🆕 D391 +1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, **+120**, index 1 of TWO) at 1 legal printing: ONE **OPTIONAL FIELD** (`energy?`) on the shipped `yourActiveEnergyAtLeast` member (D383), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO **edited** exhaustive-switch arms — a FIELD and NOT a second member, the OPPOSITE of D389's answer and RE-MEASURED rather than inherited: the field is OPTIONAL and edits ZERO of that member's 11 executable sites, and `countAttachedEnergy` already took exactly this filter) // 🆕🆕 D390 +1 sentence (THE OPPONENT-SEAT TYPE READ — Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentInPlayHasType { type }`), ONE anchored TEMPLATE reusing `CLAUSE_POKEMON_TYPES` whole and TWO exhaustive-switch arms — the family's FIFTH template pattern, and the first shipped behind a CROSS-PRODUCT anchor rung written at the PREVIOUS head) // 🆕🆕 D389 +1 sentence (THE OPPONENT-SEAT BENCH COUNT — Iron Crown `sv08-132` "Deleting Slash" ({M}{C}, `40+`, **+80**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentBenchAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — a SECOND MEMBER and not a seat parameter on `yourBenchAtLeast`, which is the shape question THIS FILE handed on at D367 and which was refused on a re-measurement rather than on D362's quoted price) // 🆕🆕 D388 +1 sentence (THE RETREAT-COST THRESHOLD — Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentActiveRetreatCostAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — ZERO new card predicates, because the printed noun phrase names `effectiveRetreatCost` (continuous.ts, D322) and not the printed `retreatCostOf` column, which is the SHAPE question D387 left open and this slice settled) // 🆕🆕 D387 +1 sentence (THE STAGE 1 CLAUSE — Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, `90+`, **+90**) at 1 legal printing: ONE `cards.ts` predicate (`isStage1Pokemon`), ONE `BoardCondition` member (`opponentActiveIsStage1`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — a SUBSET of `opponentActiveIsEvolution` that is NOT a narrowing of it, so that member and all NINE of its printings stand still) // 🆕🆕 D386 +1 sentence (THE HEALED-THIS-TURN CLAUSE — Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`, **+100**) at 2 legal printings: ONE `BoardCondition` member (`yourActiveHealedThisTurn`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row, TWO exhaustive-switch arms and ONE new REQUIRED `InPlayPokemon` field — the FIRST entry on this chain to move `MATCH_RECORD_VERSION`, 22 -> 23) // 🆕🆕 D384 +1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth" ({D}, `10+`, **+160**) at 1 legal printing: ONE nullary `BoardCondition` member (`moreActiveEnergyThanOpponent`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — the sentence D372 priced, refused and pinned as its own near miss) // 🆕🆕 D382 +1 sentence (THE `. Then, ` JOIN — D317's shape with the printed comma changed: Chi-Yu `sv06-039` "Ground Melter" ({R}{C}, `60+`) at 1 legal printing, ONE anchor constant and ONE consequent row on `deriveAttackBonusConsequent`, ZERO new readers and ZERO new ops) // 🆕🆕 D380 +2 sentences (THE STADIUM-DISCARD OP — `discardStadium`: *"Discard a Stadium in play."* at 4 legal printings and *"You may discard a Stadium in play."* at 2, ONE new FIELD-FREE `EffectOp` behind TWO whole-sentence anchors — the first slice in this run to buy an OP rather than a `BoardCondition`) // 🆕🆕 D379 +1 sentence (THE EXACT HAND-SIZE READ — `yourHandExactly { count }`: ONE CANCEL sentence at 2 legal printings, Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo", and NO bonus twin — ONE new PARAMETERISED `BoardCondition` member and ONE `ATTACK_REQUIREMENT_CLAUSES` row, ZERO `CONDITIONAL_DAMAGE_CLAUSES` rows) // 🆕🆕 D378 **+2 SENTENCES / +3 PRINTINGS** (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 **+3 SENTENCES / +3 PRINTINGS** (the CROSS-BOARD STATUS PAIR — TWO bonus sentences at 1 legal printing each, *"…is Burned"* +40 and *"…is Confused"* +90, PLUS one CANCEL sentence on the SAME member, *"…isn't Burned"*; TWO new NULLARY `BoardCondition` members, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D376 +1 sentence (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 +1 sentence (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 +1 sentence (the NAMED-ENERGY clause) // 🆕🆕 D373 +1 sentence (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 +2 sentences (ONE clause at TWO amounts) // 🆕🆕 D371 +1 sentence // 🆕🆕 D370 +1 sentence // 🆕🆕 D369 +1 sentence // 🆕🆕 D368 +1 sentence
    expect(units(resolved)).toBe(1320); // 🆕🆕 D406 +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, the `×` fold, so the printed `30×` base is DROPPED and a Tool-less board deals nothing) 🆕🆕 D405 +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE anchor and ONE `deriveAttackEffect` arm over an already-shipped op and an already-shipped destination) 🆕🆕 D402 +13 printings (THE DISCARD-COUNT-SCALED ATTACK) // 🆕🆕 D401 +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE) // 🆕🆕 D400 +9 printings (THE ANY-TARGET ARITY) // 🆕🆕 D399 +5 printings (THE TWIN CONSEQUENT AND THE ARITY) // 🆕🆕 D398 +1 printing (THE DECK-SIZE READ) // 🆕🆕 D397 +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, READER-keyed) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` and Misty's Starmie `sv10-047`, one printing each, both READER-keyed) // 🆕🆕 D392 +1 printing (THE SUBSTRING NAME READ — one sentence, one printing: the 1:1 shape for a seventh slice running, and the first taken by a member whose payload field is deliberately NOT named `name`) // 🆕🆕 D391 +1 printing (THE TYPED PER-BODY ENERGY THRESHOLD — one sentence, one printing: the 1:1 shape for a sixth slice running, and the FIRST taken by an OPTIONAL FIELD on a shipped `BoardCondition` member rather than by a new member) // 🆕🆕 D390 +1 printing (THE OPPONENT-SEAT TYPE READ — one sentence, one printing: the 1:1 shape for the fourth slice running) // 🆕🆕 D389 +1 printing (THE OPPONENT-SEAT BENCH COUNT — one sentence, one printing: the 1:1 shape for the third slice running) // 🆕🆕 D388 +1 printing (THE RETREAT-COST THRESHOLD — one sentence, one printing: the 1:1 shape, and the fold is the reading the engine had already given this noun phrase since 0.61.0) // 🆕🆕 D387 +1 printing (THE STAGE 1 CLAUSE — one sentence, one legal printing; the family's third 1:1 step) // 🆕🆕 D386 +2 printings (THE HEALED-THIS-TURN CLAUSE — one sentence, two legal printings, a 1:2 step) // 🆕🆕 D384 +1 printing (THE STRICT-INEQUALITY TWIN — one sentence, one legal printing; the family's FIRST 1:1 step) // 🆕🆕 D382 +1 printing (THE `. Then, ` JOIN — one sentence, one legal printing) // 🆕🆕 D380 +6 printings (THE STADIUM-DISCARD OP — TWO sentences, 4 + 2 legal printings, on ONE new FIELD-FREE `EffectOp`) // 🆕🆕 D379 +2 (THE EXACT HAND-SIZE READ — one sentence, both printings under the CANCEL consequent) // 🆕🆕 D378 +3 (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 +3 // 🆕🆕 D376 +2 printings (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 +2 printings (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 +2 printings (the NAMED-ENERGY clause) // 🆕🆕 D373 +2 printings (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 +2 printings (the CROSS-BOARD EQUAL-ENERGY clause) // 🆕🆕 D371 +2 printings (the OPPONENT-RESISTANCE clause) // 🆕🆕 D370 +2 printings (the bench-scoped {M} TYPE clause) // 🆕🆕 D369 +2 printings (the CROSS-BOARD Pokémon Tool clause) // 🆕🆕 D368 +3 printings
    // The delta is EXACTLY this slice's nine sentences / thirteen printings —
    // re-added from the parts rather than incremented.
    // 🆕🆕 D369 — the two subtrahends each gain this slice's step (1 sentence /
    // 2 printings), so both figures below are still D366's head, re-derived from
    // the live total rather than frozen at the head that measured them.
    // 🆕🆕 D370 — a THIRD subtrahend on each line, same shape: this slice's step is
    // 1 sentence / 2 printings, so D366's head is still re-derived from the live
    // total rather than frozen at the head that measured it.
    // 🆕🆕 D371 — a FOURTH, and the same 1 / 2 step (the OPPONENT-RESISTANCE clause).
    // 🆕🆕 D372 — a FIFTH, and the FIRST that is not a 1 / 2 step: TWO sentences and
    // TWO printings, because one clause is printed at two amounts. The sentence term
    // therefore takes a `- 2` where the four before it each took a `- 1`, while the
    // printing term takes the same `- 2` they did — which is the whole arithmetic of
    // "a clause-keyed band entry is not a sentence count", written as a subtraction.
    // 🆕🆕 D373 — a SIXTH subtrahend on each line, and a 1 / 2 step again: the
    // sentence term takes a `- 1` where D372's took a `- 2`.
    // 🆕🆕 D374 — a SEVENTH subtrahend on each line, and another 1 / 2 step (the
    // NAMED-ENERGY clause), so the sentence term takes one more `- 1`.
    // 🆕🆕 D375 — an EIGHTH, and a 1 / 2 step again (the TYPE INTERSECTION).
    // 🆕🆕 D376 — a NINTH, and a 1 / 2 step again (the FILTERED DISCARD-PILE THRESHOLD).
    // 🆕🆕 D377 — a `- 3` term: the CROSS-BOARD STATUS PAIR resolved THREE sentences at once
    // (two bonus, one cancel), so D366's head is still re-derived from the live total.
    // 🆕🆕 D378 — a `- 2` / `- 3` pair: STADIUM PRESENCE resolved TWO sentences worth THREE
    // printings, so the two terms differ for the second time in this chain (D372 was the
    // first, the other way round) — one clause under two consequents is not one sentence.
    // 🆕🆕 D379 — a `- 1` / `- 2` pair, the ordinary step: the EXACT HAND-SIZE READ
    // resolved ONE sentence worth TWO printings, and it is the first slice in this
    // chain whose sentence arrives entirely under the CANCEL consequent.
    // 🆕🆕 D380 — a `- 2` / `- 6` pair at the head, the WIDEST ratio in this chain:
    // the STADIUM-DISCARD OP resolved TWO sentences worth SIX printings, and it is
    // the first term here bought by an `EffectOp` rather than a `BoardCondition`.
    // 🆕🆕 D382 — a `- 1` / `- 1` pair at the FRONT of both chains: the `. Then, `
    // JOIN resolved ONE sentence worth ONE printing, on zero new readers and zero
    // new ops. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    expect(
    // 🆕🆕 D384 — a `- 1` / `- 1` pair at the FRONT of both chains again: the
    // STRICT-INEQUALITY TWIN resolved ONE sentence worth ONE printing, the family's
    // first 1:1 step through THIS instrument as well. ⚠️ **BOTH CHAINS ARE EDITED AT
    // THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D387 — a `- 1` / `- 1` pair at the FRONT of both chains for the third time:
    // the STAGE 1 CLAUSE resolved ONE sentence worth ONE printing. ⚠️ **BOTH CHAINS
    // ARE EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D391 — a `- 1` / `- 1` pair at the FRONT of both chains again: the TYPED
    // PER-BODY ENERGY THRESHOLD resolved ONE sentence worth ONE printing, and it is the
    // first term in either chain contributed by an OPTIONAL FIELD on a member that was
    // already shipped rather than by a new one.
      resolved.length -
        // 🆕🆕 D406 — a `- 1` term at the FRONT: THE COUNTED TOOL SCALER, ONE sentence
        // worth FIVE printings, so this chain and the printings chain take DIFFERENT
        // steps again. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        1 -
        // 🆕🆕 D405 — a `- 1` term at the FRONT: THE MANDATORY OWN-BOARD ENERGY
        // RETRIEVAL, ONE sentence worth FIVE printings, so this chain and the printings
        // chain take DIFFERENT steps again. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        1 -
        // 🆕🆕 D404 — a `- 1` term at the FRONT: THE MANDATORY HAND WIPE AND REFILL, ONE
        // sentence worth SEVEN printings, so this chain and the printings chain take
        // DIFFERENT steps again. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        1 -
        // 🆕🆕 D402 — a `- 6` term at the FRONT: the DISCARD-COUNT-SCALED ATTACK, SIX
        // sentences worth THIRTEEN printings, so this chain and the printings chain
        // take DIFFERENT steps again. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        6 -
        // 🆕🆕 D401 — a `- 4` term at the FRONT: the SELF-DISCARD COST BEFORE AN
        // ANY-TARGET SNIPE, FOUR sentences worth SEVEN printings, so this chain and
        // the printings chain take DIFFERENT steps. ⚠️ EDITED AT THE FRONT, NEVER AT
        // THE END — the tail is a FROZEN past-head figure (D397's rule).
        4 -
        // 🆕🆕 D400 — a `- 2` term at the FRONT: the ANY-TARGET ARITY, TWO sentences
        // worth NINE printings, so this chain and the printings chain below take
        // DIFFERENT steps. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        2 -
        // 🆕🆕 D399 — a `- 3` term at the FRONT of the chain: the TWIN CONSEQUENT AND
        // THE ARITY resolved THREE sentences (worth FIVE printings), so the sentence
        // term takes a `- 3` where the printing chain below takes a `- 5`. ⚠️ THE
        // CHAIN IS EDITED AT THE FRONT, NEVER AT THE END — the tail is a FROZEN
        // past-head figure (D397's rule, and D398's two ways of getting it wrong).
        3 -
        // 🆕🆕 D398 — one more term at the FRONT of the chain: the DECK-SIZE READ, 1 sentence / 1 printing.
        1 -
        // 🆕🆕 D397 — one more term at the FRONT of the chain: the BENCHED-CUBONE FILTER, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        1 -
      // 🆕🆕 D394 — TWO more `- 1` terms at the FRONT of the chain: the USED-ATTACK PAIR
      // resolved TWO sentences worth TWO printings. ⚠️ THE CHAIN IS EDITED AT THE FRONT.
        1 -
        1 -
        // 🆕🆕 D393 — two more `- 1` at the FRONT: the EVOLVE PAIR, 2 sentences / 2 printings.
        1 -
        1 -
        // 🆕🆕 D392 — one more `- 1` at the FRONT: the SUBSTRING NAME READ, 1 sentence.
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        TAKEN.length -
        3 -
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
        1,
    ).toBe(335);
    expect(
      units(resolved) -
        // 🆕🆕 D406 — a `- 5` term at the FRONT: THE COUNTED TOOL SCALER's FIVE printings,
        // on ONE sentence. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        5 -
        // 🆕🆕 D405 — a `- 5` term at the FRONT: THE MANDATORY OWN-BOARD ENERGY
        // RETRIEVAL's FIVE printings, on ONE sentence. ⚠️ EDITED AT THE FRONT, NEVER AT
        // THE END.
        5 -
        // 🆕🆕 D404 — a `- 7` term at the FRONT: THE MANDATORY HAND WIPE AND REFILL's
        // SEVEN printings, on ONE sentence. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        7 -
        // 🆕🆕 D402 — a `- 13` term at the FRONT: the DISCARD-COUNT-SCALED ATTACK's
        // THIRTEEN printings. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        13 -
        // 🆕🆕 D401 — a `- 7` term at the FRONT: the SELF-DISCARD COST BEFORE AN
        // ANY-TARGET SNIPE's SEVEN printings. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        7 -
        // 🆕🆕 D400 — a `- 9` term at the FRONT: the ANY-TARGET ARITY's NINE printings.
        // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        9 -
        // 🆕🆕 D399 — a `- 5` term at the FRONT: the TWIN CONSEQUENT AND THE ARITY,
        // THREE sentences worth FIVE printings, so this chain and the sentence chain
        // above take DIFFERENT steps. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        5 -
        // 🆕🆕 D398 — one more term at the FRONT of the chain: the DECK-SIZE READ, 1 sentence / 1 printing.
        1 -
        // 🆕🆕 D397 — one more term at the FRONT of the chain: the BENCHED-CUBONE FILTER, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
        1 -
      // 🆕🆕 D394 — TWO more `- 1` terms at the FRONT of the chain: the USED-ATTACK PAIR
      // resolved TWO sentences worth TWO printings. ⚠️ THE CHAIN IS EDITED AT THE FRONT.
        1 -
        1 -
        // 🆕🆕 D393 — two more `- 1` at the FRONT: the EVOLVE PAIR, 2 sentences / 2 printings.
        1 -
        1 -
        // 🆕🆕 D392 — one more `- 1` at the FRONT: the SUBSTRING NAME READ, 1 printing.
        1 -
        1 -
        1 -
        1 -
        1 - 1 - 2 - 1 - 1 - 6 - 2 - 3 - 13 - 3 - 3 - 2 - 2 - 2 - 2 - 2 - 2 - 2 - 2,
    ).toBe(1207);
  });

  it("🛑 NONE of the thirteen ids is a registry ATTACK, so the +16 stands still", () => {
    // D366's rule: the registry summand is REGISTRY-keyed and the raw one is
    // READER-keyed, so a reader move must be shown not to touch the other.
    const ids = new Set(registryCardIds());
    // 🆕🆕 D396 — 710 -> **713**: THREE registry keys on ONE program object,
    // Sylveon ex `sv08-086`/`sv08.5-041`/`sv08.5-156` — a bare `attackGate` at index
    // **1** carrying `barredIf`, the SECOND gate in that field at a NON-ZERO index
    // and the first on which the gate NAMES its own attack. Real catalog ids and NOT
    // `fix-*` keys (the suite drives a LOCAL `cardPool`, D275's idiom), and the row
    // authors no `attack` program, so the ATTACK summand cannot move with them.
    // 🆕🆕 D395 — 709 -> **710**: ONE registry key, Miltank `sv08.5-081`
    // — a bare `attackGate` at index **1**, the first gate in that field at a
    // NON-ZERO index. A real catalog id and NOT a `fix-*` key (its suite drives a
    // LOCAL `cardPool`, D275's idiom), and it authors no `attack` program, so the
    // ATTACK summand cannot move with it.
    // 🆕🆕 D391 — 708 -> **709**: ONE `EnergyProgram` key, `fix-grassdouble`, the
    // FIXTURE Special providing `{G}{G}` — the first `provides` row to spell one type
    // TWICE, and the only board on which a CARD count and a UNIT count disagree under a
    // typed filter. A `fix-*` key, so no catalog printing moved with it.
    expect(ids.size).toBe(713);
    // ⚠️ ONE of the thirteen IS in the registry — Volbeat `sv06-009` — and it is
    // there on an ABILITY program, which is exactly the count a slice does not
    // think it is checking. Named, rather than glossed by an "all absent" claim
    // that would have been false.
    const present = TAKEN_IDS.filter((id) => ids.has(id));
    expect(present).toEqual(["sv06-009"]);
    // Its program's ONLY key is `attackGate` — an ability-driven gate, not an
    // authored attack — which is why `REGISTRY_ATTACKS` does not hold it and the
    // +16 cannot move. The key set is the reason, not the habit (D338's rule).
    expect(Object.keys(programFor("sv06-009") ?? {})).toEqual(["attackGate"]);
    for (const id of TAKEN_IDS) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("the SPLIT summand cannot move either — no taken sentence carries a gate clause", () => {
    for (const [sentence] of TAKEN) {
      // Each resolves WHOLE, so it can never enter the split term, which is
      // "refused whole, resolved once the gate clause is taken off".
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });
});
