import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import type { PokemonType } from "./effects";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { resistanceOf, weaknessOf } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  OPPONENT_RESISTANCE_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D371 — THE OPPONENT-RESISTANCE CLAUSE, AND THE SHAPE QUESTION SETTLED
// BEFORE ANYTHING WAS SPELLED.
//
// D370 handed over *"your opponent's Active Pokémon has {F} Resistance"* — 2 legal
// printings, the cheapest of the SEVEN clauses its own §1 left pinned in the
// residue's 2-printing band — with two things ordered ahead of the build: run the
// SUPPLY check first (D207's rule; D370 owed the VOCABULARY half and had already
// run it), and settle a named SHAPE question before spelling a predicate (D368's
// ordering).
//
// ✅ **SUPPLY: THE FIELD IS INGESTED AND THE ENGINE ALREADY READS IT** (§2).
// D207's failure mode is a predicate over a banner no column CLASSIFIES —
// permanently empty candidate set, a card that can never be played. `resistances`
// is a real `Card` column and the §8.5 pipeline has read it since 0.1.x. ⚠️ The
// only population measurable in this container is `FIXTURE_POOL`, which is a
// FLOOR on a biased sample and is NOT promoted to a census: there are no D1
// credentials here, so the Standard-legal count is unmeasured and not guessed.
//
// 🛑 **THE SHAPE QUESTION, AND IT IS THE WHOLE MEMBER** (§5).
// `resistanceOf(attacker, defender)` returns a modifier ONLY when the defender's
// Resistance names one of the ATTACKER's types — §8.5 asks *"does this Resistance
// apply to THIS attack"*. The printed clause asks whether the defender HAS `{F}`
// Resistance, whoever is attacking. The two disagree on exactly one board and this
// file drives it: a METAL attacker against a FIGHTING-resistant defender, where
// the clause is TRUE (10 + 50 = 60) and `resistanceOf` is NULL. A member routed
// through the helper pays 10 there. `fix-oppresist` is Metal for that reason and
// `fix-oppresist-f` is the same attack on a Fighting body, where both fire and the
// dealt number is 10 + 50 − 30 = 30.
//
// ⚠️ **THE PREDICATE IS ON THE ENTRY'S `type` AND NOTHING ELSE.** `WeakRes.value`
// is optional in the schema and `weakResModifier` HONOURS an entry whose value it
// cannot parse (it falls back to −30), so an entry §8.5 cannot price is still a
// printed Resistance. `fix-dualresist` carries two entries with the matching one
// SECOND and value-less — the single body that separates `.some(…)` from
// `resistances[0]` and a `type`-only predicate from one that also reads `value`.
//
// WHAT SHIPS: 1 new `BoardCondition` member (`opponentActiveHasResistance
// { type }`), its 2 reader arms and 1 new anchored PATTERN reusing
// `CLAUSE_POKEMON_TYPES` whole. ZERO new vocabulary, zero new maps, zero new
// clause-table rows.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    `opponentToolBonus.test.ts` and `benchTypeBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS, and the clause inside it. */
const TAKEN =
  "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.";
const TAKEN_CLAUSE = "your opponent's Active Pokémon has {F} Resistance";

const FIGHTING: BoardCondition = { kind: "opponentActiveHasResistance", type: "Fighting" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_RESISTANCE_DECK, p2: OPPONENT_RESISTANCE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `attacker` in `seat`'s Active Spot with the `{C}` paid, `defender` across the
    table, and BOTH benches EMPTY — nothing in this clause reads a Bench, and an
    empty one keeps the dealt number a statement about the two Active bodies.
    `board` opens P1's turn, so a P2 case passes once more: a p1-only suite cannot
    tell "reads YOUR OPPONENT's Active" apart from "reads p2's". */
function ready(
  seed: number,
  defender: string,
  attacker = "fix-oppresist",
  seat: Seat = "p1",
): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), defender);
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** TEST SURGERY, local to this file: push a card from `seat`'s deck onto the TOP
    of the Active Spot's stack, so the Active body's IDENTITY is the pushed card
    while the card underneath is unchanged. Every uid stays in exactly one zone.
    It drives the `activeTop` read directly — a real evolution needs an
    `evolvesFrom` chain these synthetic bodies do not carry, and the reader's claim
    is about the stack TOP rather than about how it got there. */
function pushOnActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.active;
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...body, stack: [...body.stack, uid] },
      },
    },
  };
}

/** TEST SURGERY: empty an Active Spot. No legal action reaches this board — a seat
    with no Active has lost — but the member commits to answering FALSE there, and
    a commitment nothing drives is a comment. */
function emptyActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], active: null } },
  };
}

describe("§1 — the price, RE-DERIVED: the `needs` column and the band, not the handoff's words", () => {
  it("🛑 the residue steps by exactly this sentence, and the 2-printing band by exactly one", () => {
    // D370 left the residue at 31 / 40 and pinned SEVEN clauses at 2 printings.
    // Both figures are re-derived here off the same instrument — the nine live
    // readers over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 30 / 38 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D372 — 30 / 38 -> **28 / 36**: D372 took the CROSS-BOARD EQUAL-ENERGY
    // clause this file's own band below named among the six, and that clause is
    // printed under TWO sentences at 1 printing each — so the SENTENCE term falls by
    // 2 where the PRINTING term falls by 2, and this file's head is re-derived from
    // the live corpus with each earlier figure coming back off it one term later.
    // 🆕🆕 D373 — 28 / 36 -> 27 / 34: the UNIVERSAL-OVER-THE-BENCH clause left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D374 — 27 / 34 -> 26 / 32: the NAMED-ENERGY clause left the residue
    // (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION left it,
    // (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D376 — 25 / 30 -> 24 / 28: the FILTERED DISCARD-PILE THRESHOLD left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
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
    // +100) — re-derived live rather than decremented. 🛑 AND IT EMPTIES THE 2-PRINTING
    // BAND: it was the last clause in it, so every band rung below is re-aimed off the
    // WHOLE distribution rather than off a list that can no longer be non-empty (D379).
    // 🆕🆕 D387 — 19 / 22 -> **18 / 21**: the STAGE 1 clause left this residue — ONE
    // sentence at ONE printing (Paldean Tauros `sv08-018` "Spirited Tackle", +90) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 17, 5: 1}` -> `{1: 16, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution and its refusal still comes from OUTSIDE
    // the emptied band (D379).
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
    expect(refused.length).toBe(9);
    expect(units(refused)).toBe(12);
    // D371's recorded residue, then D370's, re-derived from THIS head: add the
    // sentences back rather than freezing the pair that measured them.
    // 🆕🆕 D373 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the UNIVERSAL-OVER-THE-BENCH clause).
    // 🆕🆕 D374 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the NAMED-ENERGY clause).
    // 🆕🆕 D375 — one more term again, same 1:2 step (the TYPE INTERSECTION).
    // 🆕🆕 D376 — one more term on every chain below, same 1:2 step (the FILTERED
    // DISCARD-PILE THRESHOLD). ⚠️ THE HEAD IS NOW 24 / 28, so every OFFSET here moved
    // by one sentence and two printings while the expected values stayed put — which
    // is the point of writing them as offsets off the live head at all.
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(refused.length + 15).toBe(24);
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(units(refused) + 16).toBe(28);
    expect(refused.length + 16).toBe(25);
    expect(units(refused) + 18).toBe(30);
    expect(refused.length + 17).toBe(26);
    expect(units(refused) + 20).toBe(32);
    expect(refused.length + 18).toBe(27);
    expect(units(refused) + 22).toBe(34);
    expect(refused.length + 19).toBe(28);
    expect(units(refused) + 24).toBe(36);
    expect(refused.length + 21).toBe(30);
    expect(units(refused) + 26).toBe(38);
    expect(refused.length + 22).toBe(31);
    expect(units(refused) + 28).toBe(40);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D372 — FIVE at 2 printings now: this file left SIX and D372 bought the
    // CROSS-BOARD EQUAL-ENERGY one out of them. Spelled out so a successor inherits
    // the tie-break MEASURED. Every one of them is a different mechanism.
    // 🆕🆕 D374 — FOUR -> THREE: D374 bought the NAMED-ENERGY clause out of the band,
    // and the list is re-derived live rather than edited down.
    // 🆕🆕 D375 — THREE -> TWO: the CROSS-BOARD TYPE INTERSECTION was bought out of
    // it, and the two survivors are the two D374's handoff had already PRICED.
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    // 🆕🆕 D376 — TWO -> ONE: the FILTERED DISCARD-PILE THRESHOLD was bought out of
    // the band (`basicEnergyDiscard.test.ts`), and the ONE survivor is the expensive
    // one D374's handoff already priced — *"this Pokémon was healed during this turn"*
    // needs a per-turn HEALED flag on the state, which is a persisted-shape change and
    // therefore a `MATCH_RECORD_VERSION` bump on top of the engine bump.
    // 🆕🆕 D386 — ONE -> ZERO: the healed-this-turn clause was bought out of the band
    // (`healedThisTurn.test.ts`), and THE 2-PRINTING BAND IS NOW EMPTY. 🛑 D379's
    // SATURATION SHAPE — an emptied population cannot go red for the reason that
    // matters — so the refusal is driven from OUTSIDE it: the ONLY clause left above
    // ONE printing is the 5-printing declaration clause D368 disqualified on SHAPE,
    // and the 1-printing band is SIXTEEN deep (D387 took one out of it).
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D387 — 18 -> **17**: the STAGE 1 clause left the 1-printing band, which is
    // the ONLY band that moved. The 2-printing band was already empty and stays empty,
    // and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D388 — 17 -> **16**: the RETREAT-COST THRESHOLD left the 1-printing band,
    // which is the ONLY band that moved. The 2-printing band was already empty and stays
    // empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D389 — 16 -> **15**: the OPPONENT-SEAT BENCH COUNT left the 1-printing band.
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left it too, and the
    // 1-printing band is again the ONLY band that moved. The 2-printing band was
    // already empty and stays empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(8); // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    // The 5-printing declaration clause D368 disqualified on SHAPE is still the
    // largest thing in the residue and still refused, so nothing here re-priced it.
    expect(Math.max(...byClause.values())).toBe(5);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    // ONE record, because the corpus is a `GROUP BY` over distinct sentences.
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // …and it is the WHOLE population of this clause shape in the corpus: no other
    // sentence asks about a printed Resistance as a CONDITION. Every other
    // occurrence of the word is the §8.5 parenthetical ("Don't apply Weakness and
    // Resistance for Benched Pokémon.") or a suppression clause, and neither is
    // this skeleton.
    const shaped = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon has .+ Resistance, /.test(s),
    );
    expect(shaped.map(([, s]) => s)).toEqual([TAKEN]);
    // ⚠️ THE IDS BEHIND THOSE TWO PRINTINGS ARE NOT RECORDED, DELIBERATELY — D369's
    // finding, unchanged at D371: this container has no D1 credentials (`bunx
    // wrangler d1 execute` returns `CLOUDFLARE_API_TOKEN` unset), so they could not
    // be read and are NOT guessed. Nothing on this path needs them: a TEMPLATE is
    // keyed on the printed shape, so it serves every printing of it in every set —
    // and the other ten types the day one is printed.
  });

  it("🛑 the `needs` column: NO member of this union reads a printed DEFENSIVE column", () => {
    // D199's rule, driven rather than listed. The near member reads the same BODY
    // through the same `activeTop` and a DIFFERENT column, and the two disagree on
    // one board: `fix-fightresist` is a COLORLESS body with a FIGHTING Resistance.
    const state = ready(7100, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    // Same body, the `types` column: Colorless, so the type member answers false
    // for Fighting and true for Colorless. Widening it to take a FIELD would be a
    // RENAME (D362: 31 sites across 7 files) and the two columns do not even have
    // the same shape — `string[]` against `{type, value?}[]`.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Fighting" })).toBe(
      false,
    );
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Colorless" })).toBe(
      true,
    );
    // Same body, the attachment members: nothing is attached across the table.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    // Same body, the class members: a plain Basic, neither ex nor V nor Evolution.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);
    // And the WEAKNESS column, one field over in the same schema, is the near miss
    // a wrong transcription lands on — `fix-fightweak` separates them below (§5).
    const weak = ready(7101, "fix-fightweak");
    expect(conditionHolds(weak, "p1", FIGHTING)).toBe(false);
  });
});

describe("§2 — THE SUPPLY CHECK, run FIRST: the column exists, and the floor is a FLOOR", () => {
  it("🛑 `Card.resistances` is a real ingested column the engine already reads", () => {
    // D207's question, asked before the predicate was designed: *name the field
    // before you design the predicate*. A predicate over a banner no column
    // CLASSIFIES yields a permanently empty candidate set — `Tera`'s shape, where
    // every occurrence is DEMAND and the SUPPLY side is absent. This is not that.
    // The column is on the schema, it is populated, and §8.5 has read it since
    // 0.1.x — `resistanceOf` is exported from the package index.
    const body = FIXTURE_POOL["fix-fightresist"];
    expect(body?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(typeof resistanceOf).toBe("function");
  });

  it("⚠️ the population is a FLOOR on a BIASED SAMPLE and is not promoted to a census", () => {
    // The honest statement of what this container can measure. `FIXTURE_POOL` is
    // the engine's hand-built pool — real printings AND `fix-*` bodies — so it is
    // evidence that the field is populated and is NOT a denominator. The
    // Standard-legal count of Fighting-resistant bodies is UNMEASURED here: no D1
    // credentials, no local sqlite catalog, and a guessed figure would be worth
    // less than an absence (D183's rule about a count with no population).
    const ids = Object.keys(FIXTURE_POOL);
    const withResistance = ids.filter((id) => (FIXTURE_POOL[id]?.resistances ?? []).length > 0);
    const fighting = ids.filter((id) =>
      (FIXTURE_POOL[id]?.resistances ?? []).some((r) => r.type === "Fighting"),
    );
    // 🆕🆕 D372 — 450 -> **453**, and the OTHER TWO COLUMNS STAND STILL. D372 adds
    // three bodies (`fix-sameenergy`, `fix-sameenergy-120`, `fix-energyholder`) and
    // none of them prints a Resistance, so the pool grows and the sample this rung
    // is actually about does not. **THAT IS THE FLOOR BEHAVING LIKE A FLOOR**: a
    // denominator that moved every time an unrelated fixture landed would be worth
    // even less than this one, and the two unmoved columns are what say so.
    // 🆕🆕 D373 — 453 -> **454**, and the other two columns stand still AGAIN: the
    // one body this slice adds (`fix-benchall`) prints no Resistance either.
    // 🆕🆕 D374 — 454 -> **457**, and the other two columns stand still a THIRD time.
    // D374 adds one body (`fix-trbonus`) and TWO Special ENERGY cards
    // (`fix-tr-other-energy`, `fix-not-tr-energy`), and `Card.resistances` is null on
    // every Energy in the catalog — so the pool grows by three and the sample this
    // rung is about does not move at all.
    // 🆕🆕 D375 — 457 -> **459**, and the other two columns stand still a FOURTH
    // time. D375 adds two bodies (`fix-typeshare`, `fix-bigfairy`) and neither prints
    // a Resistance — both are declared with `types` and nothing else, because the
    // column this slice reads is `Card.types`.
    // 🆕🆕 D376 — 459 -> **460**, and the other two columns stand still a FIFTH time.
    // D376 adds ONE body (`fix-emberpillar`) and no Energy at all — the four Energy
    // cards its boards need were already in the pool — and that one body prints no
    // Resistance, because the column this slice reads is the DISCARD PILE.
    // 🆕🆕 D377 — 460 -> **463**, and the other two columns stand still a SIXTH time.
    // D377 adds THREE bodies (`fix-roastheat`, `fix-mindcrush`, `fix-charbreath`) and
    // no Energy at all, and none of the three prints a Resistance — the column that
    // slice reads is `SpecialConditions` on the opponent's Active.
    // 🆕🆕 D378 — 463 -> **465**, and the other two columns stand still a SEVENTH time.
    // D378 adds TWO bodies (`fix-mountaindrop`, `fix-assaultland`) and no Energy at
    // all, and neither prints a Resistance — the column that slice reads is
    // `state.stadium`, which is not on a card at all.
    // 🆕🆕 D379 — 465 -> **466**, and the other two columns stand still an EIGHTH time.
    // D379 adds ONE body (`fix-triocheehoo`) and no Energy at all, and it prints no
    // Resistance — the column that slice reads is the attacker's own HAND LENGTH,
    // which is not on a card at all either.
    // 🆕🆕 D380 — 466 -> **468**, and the other two columns stand still a NINTH time.
    // D380 adds TWO bodies (`fix-blazedestruct`, `fix-knockover`) and no Energy at
    // all, and neither prints a Resistance — the column that slice reads is
    // `state.stadium`, which is not on a card at all. ⚠️ **AND THIS FLOOR MOVES ON
    // THE FIXTURE COUNT, NOT ON THE PRINTED TEXT** — the mirror of the apostrophe
    // census one file over, which moves on the CHARACTER and not on the count.
    // 🆕🆕 D381 — 468 -> **469**, and the other two columns stand still a TENTH time.
    // D381 adds ONE body (`fix-crushpress`, Cetitan ex's "Crushing Press") and no
    // Energy at all, and it prints no Resistance — the column that slice reads is
    // `state.stadium` again, which is not on a card at all. ⚠️ **AND THE ONE THING
    // THAT FIXTURE'S CARD DATA *IS* READ FOR IS ITS NAME**: `Fixceti ex` carries the
    // ex suffix so `isExOrV` sees it, which is a claim about `Card.name` and still
    // not about `Card.resistances`.
    // 🆕🆕 D382 — 469 -> **470**, and the other two columns stand still an ELEVENTH
    // time. D382 adds ONE body (`fix-groundmelter`, Chi-Yu's "Ground Melter") and no
    // Energy at all, and it prints no Resistance — the column that slice reads is
    // `state.stadium` for a THIRD consecutive slice, which is not on a card at all.
    // 🆕🆕 D383 — 470 -> **471**, and the other two columns stand still a TWELFTH
    // time. D383 adds ONE body (`fix-torrent`, Wellspring Mask Ogerpon ex's
    // "Torrential Pump") and no Energy at all, and it prints no Resistance — what
    // that slice reads off a card is the ATTACHED Energy COUNT (`InPlayPokemon.energy`,
    // a board array) rather than any printed column, so `Card.resistances` is
    // untouched for a FOURTH consecutive slice.
    // 🆕🆕 D384 — 471 -> **472**, and the other two columns stand still a THIRTEENTH
    // time. D384 adds ONE body (`fix-moreenergy`, Swalot's "Devouring Mouth") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // the ATTACHED Energy COUNT on two bodies (`InPlayPokemon.energy`) rather than any
    // printed column, so `Card.resistances` is untouched for a FIFTH consecutive slice.
    // 🆕🆕 D385 — 472 -> **473**, and the other two columns stand still a FOURTEENTH
    // time. D385 adds ONE body (`fix-purging`, Veluza ex's "Purging Strike") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // a HAND LENGTH, which is not on a card at all, so `Card.resistances` is untouched
    // for a SIXTH consecutive slice.
    // 🆕🆕 D386 — 473 -> **474**, and the other two columns stand still a FIFTEENTH
    // time. D386 adds ONE body (`fix-lively`, Maractus's "Lively Needles") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // a per-turn STAMP on `InPlayPokemon` (`healedTurn`), which is not a printed column
    // at all, so `Card.resistances` is untouched for a SEVENTH consecutive slice.
    // 🆕🆕 D387 — 474 -> **477**, and the other two columns stand still a SIXTEENTH
    // time. 🛑 **AND IT IS THE FIRST STEP BIGGER THAN ONE SINCE D377**: D387 adds THREE
    // bodies (`fix-spirited`, the printed attacker; `fix-stage1-big` and
    // `fix-vstar-big`, two DEFENDERS that exist only to carry a printed `stage` word),
    // and none of the three prints a Resistance — what that slice reads off a card is
    // `Card.stage`, a printed column that is NOT this one, so `Card.resistances` is
    // untouched for an EIGHTH consecutive slice. ⚠️ **A COUNT THAT MOVES BY THREE IS
    // NOT A DIFFERENT KIND OF MOVE FROM ONE THAT MOVES BY ONE** — what makes the other
    // two columns stand still is WHICH COLUMN the slice reads, never how many bodies
    // it adds.
    // 🆕🆕 D388 — 477 -> **480**, and the other two columns stand still a SEVENTEENTH
    // time. THREE bodies again (`fix-aerochase`, the printed attacker; `fix-retreat1-titan`
    // and `fix-retreat2-titan`, two DEFENDERS that exist only to carry a printed RETREAT
    // cost), and none of the three prints a Resistance — what that slice reads off a card
    // is `Card.retreat`, folded with the board, which is a printed column that is NOT this
    // one, so `Card.resistances` is untouched for a NINTH consecutive slice.
    // 🆕🆕 D389 — 480 -> **481**, and the other two columns stand still an EIGHTEENTH
    // time. ONE body (`fix-deletingslash`, Iron Crown's "Deleting Slash" demonstrator),
    // ZERO Energy, ZERO Resistances — and what D389 reads off a card is nothing at all:
    // its instrument is `PlayerSide.bench.length`, a BOARD array on the OTHER seat, so
    // `Card.resistances` is untouched for a TENTH consecutive slice.
    // 🆕🆕 D390 — 481 -> **484**, and the other two columns stand still a NINETEENTH
    // time. THREE bodies (`fix-shortcircuit`, Electivire's "Short-Circuit Knuckle"
    // demonstrator, and the two Water bodies `fix-waterbody` / `fix-inplaydual`), and
    // none of the three prints a Resistance — what D390 reads off a card is
    // `Card.types`, a printed column that is NOT this one, so `Card.resistances` is
    // untouched for an ELEVENTH consecutive slice. ⚠️ `fix-shortcircuit` does print a
    // ×2 Fighting WEAKNESS, which is the neighbouring column and is deliberately not
    // what this rung counts.
    // 🆕🆕 D391 — 484 -> **486**: TWO fixtures, `fix-frozenwood` (the Abomasnow
    // demonstrator) and `fix-grassdouble` (the Special providing `{G}{G}`). Both `fix-*`, so the
    // FLOOR moves and the catalog behind it does not.
    // 🆕🆕 D392 — 486 -> **489**: THREE fixtures, `fix-loveimpact` (Team Rocket's
    // Nidoqueen, the demonstrator) and the two bench bodies `fix-trnidoking` /
    // `fix-nidoking`. None prints a Resistance — what D392 reads off a card is
    // `Card.name`, a printed column that is not this one — so `Card.resistances` is
    // untouched for a TWELFTH consecutive slice. All three are `fix-*`, so the FLOOR
    // moves and the catalog behind it does not.
    // 🆕🆕 D393 — 489 -> **493**: FOUR fixtures, the EVOLVE PAIR's two attackers
    // (`fix-strikeitrich`, `fix-abruptflash`) and their two printed pre-evolutions
    // (`fix-gimmighoul`, `fix-mistystaryu`). ⚠️ **AND `Card.resistances` MOVES FOR THE
    // FIRST TIME IN TWELVE SLICES** — 27 -> 28 — because Gholdengo `sv08-131` prints
    // a real Grass -30 and D306 says transcribe the card rather than the fields the
    // tests read. The FIGHTING count below is what stands still, which is the rung
    // that keeps this file's own subject separate from a pool that grew beside it.
    expect(ids).toHaveLength(495); // 🆕🆕 D394 — +2 Pokémon fixtures (`fix-alloutattack` Falinks, `fix-crazyblast` Weezing); `withResistance` stands still at 28, because neither printing carries a resistance row
    expect(withResistance).toHaveLength(28);
    expect(fighting).toHaveLength(18);
    // D371 measured this floor at 27 of 450 and D370 at 24 of 444, BEFORE their
    // fixtures landed. The arithmetic is spelled out so the inherited figures and
    // the live ones cannot silently disagree: D372 is +3 bodies / +0 / +0, and
    // D371 was +6 bodies, +3 with a Resistance (`fix-fightweak` has none by
    // design), +2 of them Fighting.
    // 🆕🆕 D374 — one more term on the chain: +3 bodies / +0 / +0.
    // 🆕🆕 D375 — and one more: +2 bodies / +0 / +0.
    // 🆕🆕 D376 — and one more again: +1 body / +0 / +0 (`fix-emberpillar`, which
    // prints no Resistance because the column D376 reads is the discard pile).
    // 🆕🆕 D377 — and one more again: +3 bodies / +0 / +0 (`fix-roastheat`,
    // `fix-mindcrush`, `fix-charbreath`, none of which prints a Resistance because the
    // column D377 reads is the opponent Active's `SpecialConditions`).
    // 🆕🆕 D378 — a `- 2` term at the head of the chain: TWO bodies, ZERO Energy,
    // ZERO Resistances.
    // 🆕🆕 D379 — a `- 1` term ahead of that one: ONE body (`fix-triocheehoo`), ZERO
    // Energy, ZERO Resistances.
    // 🆕🆕 D380 — a `- 2` term at the head: TWO bodies (`fix-blazedestruct`,
    // `fix-knockover`), ZERO Energy, ZERO Resistances — the column D380 reads is
    // `state.stadium`, which is not on a card at all.
    // 🆕🆕 D381 — a `- 1` term at the head of the chain: ONE body (`fix-crushpress`),
    // ZERO Energy, ZERO Resistances — the column D381 reads is `state.stadium` again,
    // and the only card datum its fixture is read for is its NAME.
    // 🆕🆕 D382 — a `- 1` term at the FRONT of the chain: ONE body (`fix-groundmelter`,
    // Chi-Yu's "Ground Melter" demonstrator), ZERO Energy, ZERO Resistances — the
    // column D382 reads is `state.stadium` for a THIRD consecutive slice, and unlike
    // D381's fixture this one's NAME is read by nothing either. ⚠️ **THE CHAIN IS
    // EDITED AT THE FRONT, NEVER AT THE END** — every later operand would shift.
    // 🆕🆕 D383 — a `- 1` term at the FRONT of the chain: ONE body (`fix-torrent`,
    // Wellspring Mask Ogerpon ex's "Torrential Pump" demonstrator), ZERO Energy,
    // ZERO Resistances — and what D383 reads off a card is nothing at all: its
    // instrument is `InPlayPokemon.energy`, a BOARD array, so this is the first
    // slice in four whose fixture's card data is read by neither this column nor a
    // NAME. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D384 — a `- 1` term at the FRONT of the chain, the SECOND consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-moreenergy`, Swalot's "Devouring Mouth" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is `InPlayPokemon.energy` on TWO bodies
    // rather than any printed column. ⚠️ **THE CHAIN IS EDITED AT THE FRONT.**
    // 🆕🆕 D385 — a `- 1` term at the FRONT of the chain, the THIRD consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-purging`, Veluza ex's "Purging Strike" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is a HAND LENGTH — not on a card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D386 — a `- 1` term at the FRONT of the chain, the FOURTH consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-lively`, Maractus's "Lively Needles" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is a per-turn STAMP on `InPlayPokemon` —
    // not on a card at all. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D387 — a `- 3` term at the FRONT of the chain, the first term bigger than
    // one since D377: THREE bodies (`fix-spirited`, `fix-stage1-big`, `fix-vstar-big`),
    // ZERO Energy, ZERO Resistances, and an instrument that is `Card.stage` — a printed
    // column, but not this one. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D388 — a `- 3` term at the FRONT of the chain, the SECOND consecutive slice
    // to add three: THREE bodies (`fix-aerochase`, `fix-retreat1-titan`,
    // `fix-retreat2-titan`), ZERO Energy, ZERO Resistances, and an instrument that is
    // `Card.retreat` FOLDED WITH THE BOARD — a printed column, but not this one, and
    // the first one on this chain that is not read straight off the card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D389 — a `- 1` term at the FRONT of the chain: ONE body
    // (`fix-deletingslash`), ZERO Energy, ZERO Resistances, and an instrument that is a
    // BENCH LENGTH on the opponent's side — not on a card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D390 — a `- 3` term at the FRONT of the chain: THREE bodies
    // (`fix-shortcircuit`, `fix-waterbody`, `fix-inplaydual`), ZERO Energy, ZERO
    // Resistances, and an instrument that is `Card.types` — a printed column, but not
    // this one. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D391 — a `- 2` term at the FRONT: `fix-frozenwood` and `fix-grassdouble`,
    // the Abomasnow demonstrator and the Special providing `{G}{G}`. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — a `- 3` term for this slice's three fixtures, at the FRONT of the chain.
    // 🆕🆕 D394 — a `- 2` at the FRONT of every chain below: the USED-ATTACK PAIR added
    // TWO Pokémon fixtures to the pool. ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT
    // THE END — each line still names the floor at the slice that measured it.
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1).toBe(468);
    // 🆕🆕 D392 — a `- 3` term for this slice's three fixtures, at the FRONT of the chain.
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2).toBe(466);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1).toBe(465);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2).toBe(463);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3).toBe(460);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1).toBe(459);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2).toBe(457);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3).toBe(454);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1).toBe(453);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1 - 3).toBe(450);
    expect(ids.length - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1 - 3 - 6).toBe(444);
    expect(withResistance.length - 3 - 1).toBe(24); // 🆕🆕 D393 — a `- 1` term at the FRONT: Gholdengo `sv08-131` prints a real Grass -30, transcribed whole (D306)
    expect(fighting.length - 2).toBe(16);
  });

  it("the VOCABULARY half is inherited, not re-run: `{F}` is a real `Card.types` value", () => {
    // D370 ran this question for `{M}` and it is the same map here, so this rung
    // records rather than re-derives. It still goes red if the map loses the code.
    expect(POKEMON_TYPE_BY_CODE.F).toBe("Fighting");
    expect((POKEMON_TYPES as readonly string[]).includes("Fighting")).toBe(true);
  });
});

describe("§3 — the template: N from the sentence, and a round trip across NOTATIONS", () => {
  it("maps the printed sentence onto the new member at the printed 50", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: FIGHTING } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("🛑 the MAP is the vocabulary, not the regex — all 22 spellings resolve", () => {
    // The capture is `(.+)`, so the refusal of a non-type happens at the map. That
    // is what this asserts: every one of the eleven types resolves in BOTH
    // notations off one loose pattern. A `(Grass|Fire|…)` alternation would answer
    // the same today and rot the day a type is added to the schema.
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has ${type} Resistance, this attack does 50 more damage.`,
        ),
        type,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has {${code}} Resistance, this attack does 50 more damage.`,
        ),
        code,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
  });

  it("🛑 `conditionNote` is NOT the clause key — and re-derives to the member anyway", () => {
    // D118's rule: the note spells the prose NAME, because a reject pill and a HUD
    // tooltip are read off the board by a person and `{F}` is a card-face glyph. So
    // this note does NOT round-trip to the printed bytes…
    expect(conditionNote(FIGHTING)).toBe("your opponent's Active Pokémon has Fighting Resistance");
    expect(conditionNote(FIGHTING)).not.toBe(TAKEN_CLAUSE);
    expect(conditionNote(FIGHTING)).not.toContain("{F}");
    // …and it DOES round-trip to the same MEMBER, through the map's spelled-out
    // half — the property this family gained at D367 and D370 inherited.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(FIGHTING)}, this attack does 50 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: FIGHTING });
    // And it holds for every type, both directions, which is what makes it a
    // property of the TEMPLATE rather than a fact about Fighting.
    for (const type of POKEMON_TYPES) {
      const cond: BoardCondition = { kind: "opponentActiveHasResistance", type };
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 40 more damage.`)
          ?.count,
        type,
      ).toEqual({ kind: "boardCondition", cond });
    }
  });

  it("🛑 the APOSTROPHE class is load-bearing HERE in a way it was not for D370", () => {
    // D136's hardening, and this is the family's SECOND parameterised clause whose
    // printed sentence spells a possessive — `YOUR_BENCH_TYPE_CLAUSE` carries no
    // class because its sentence has no apostrophe at all. The template pass is
    // handed the RAW clause (`literalClauseRow`'s fold is for TABLE keys), so the
    // `['’]` in this pattern's own source is the only thing standing between a
    // punctuation-normalising re-ingest and both printings going silently unread.
    const curly = TAKEN.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(TAKEN);
    expect(curly).toContain("’");
    expect(deriveAttackDamageBonus(curly)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
    // …and the two spellings produce the SAME value, never merely a non-null one —
    // D137's contract, stated there and asserted here.
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN));
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 86 code points; the clause inside it is 49. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(86);
    expect(TAKEN_CLAUSE.length).toBe(49);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The braces are the catalog's notation and are NOT regex syntax here — the
    // capture is `(.+)` and the map holds the literal `{F}`.
    expect(TAKEN_CLAUSE).toContain("{F}");
    // A STRAIGHT apostrophe is what the catalog prints today (0 of 978 rows carry
    // U+2019, re-verified at D137/D154), which is why the class above is standing
    // insurance rather than a live path.
    expect(TAKEN).toContain("'");
    expect(TAKEN).not.toContain("’");
    // "Resistance" is CAPITALISED as printed, and the matcher has no /i.
    expect(TAKEN_CLAUSE.endsWith(" Resistance")).toBe(true);
  });
});

describe("§4 — the near-misses stay LOUD, and the siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      // The WEAKNESS column, one field over in the same schema and the near miss a
      // wrong transcription lands on. Nothing in the pool prints it as a condition,
      // and until something does it must stay LOUD rather than resolve to this
      // member with the wrong column behind it.
      "your opponent's Active Pokémon has {F} Weakness",
      "your opponent's Active Pokémon has Fighting Weakness",
      // Not a type at all — each of these reaches the map and misses it.
      "your opponent's Active Pokémon has Tera Resistance",
      "your opponent's Active Pokémon has Basic Resistance",
      "your opponent's Active Pokémon has any Resistance",
      "your opponent's Active Pokémon has no Resistance",
      // The other SEAT and the other ZONE.
      "your Active Pokémon has {F} Resistance",
      "this Pokémon has {F} Resistance",
      "any of your opponent's Benched Pokémon has {F} Resistance",
      // The lowercase noun — the matcher has no /i and "Resistance" is printed
      // capitalised in every occurrence in the corpus.
      "your opponent's Active Pokémon has {F} resistance",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent's Active Pokemon has {F} Resistance",
      // The brace stripped — `F` alone is not a key in either half of the map.
      "your opponent's Active Pokémon has F Resistance",
      // The §8.5 phrasing, which is a modifier and not a board fact.
      "your opponent's Active Pokémon has -30 Fighting Resistance",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 50 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 50 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("🛑 the three SIBLING templates still answer their own sentences — nothing was re-pointed", () => {
    // The clause pattern was appended LAST, and the four patterns are mutually
    // exclusive at their anchors. All three siblings are driven here so "appended
    // last" is a measured fact rather than a claim about ordering.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type: "Dragon" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type: "Metal" } },
    });
    // …and the LITERAL table still wins first: the Tool clause on the SAME body is
    // a row (D368), and this template's anchor cannot reach it.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
  });
});

describe("§5 — driven on boards: the printed COLUMN decides it, and `resistanceOf` never does", () => {
  it("🛑 A METAL ATTACKER, A FIGHTING-RESISTANT DEFENDER — the clause is TRUE and §8.5 is NULL", () => {
    // THE BOARD THIS WHOLE FIXTURE PAIR EXISTS FOR, and the shape question settled
    // rather than argued. `weakResModifier` skips every entry whose `type` is not
    // one of the ATTACKER's types, so §8.5 answers "no Resistance here" — while the
    // printed clause asks whether the DEFENDER HAS one, whoever is attacking.
    const state = ready(7110, "fix-fightresist");
    const attacker = FIXTURE_POOL["fix-oppresist"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    // The helper, asked directly: NULL, because Metal is not Fighting.
    expect(attacker.types).toEqual(["Metal"]);
    expect(resistanceOf(attacker, defender)).toBeNull();
    // The member, asked on the same board: TRUE.
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    // …and the dealt number is the difference between the two readings. 10 + 50,
    // with no §8.5 subtraction because the helper is null. A member routed through
    // `resistanceOf` pays 10 here, which is what makes this rung able to go RED.
    expect(damageDealt(state)).toBe(60);
  });

  it("🛑 the SAME attack on a FIGHTING body: both fire, and the numbers stack", () => {
    // The other half of the separation. Here the attacker's own type IS the one the
    // Resistance names, so `resistanceOf` returns −30 and applies for real:
    // 10 + 50 − 30 = 30. Without this board, "it does not go through `resistanceOf`"
    // would be shown only where the helper is null — and a member that answered
    // TRUE unconditionally would pass the rung above.
    const state = ready(7111, "fix-fightresist", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(attacker.types).toEqual(["Fighting"]);
    expect(resistanceOf(attacker, defender)).toEqual({ op: "subtract", amount: 30 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(damageDealt(state)).toBe(30);
  });

  it("a body with NO Resistance column pays the printed base and nothing more", () => {
    const state = ready(7112, "fix-bigbody");
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("a REAL Resistance of the WRONG type arms nothing — two distinct false boards", () => {
    // "No Resistance at all" and "a Resistance that does not match" are different
    // boards, exactly as D370 kept a defaulted Colorless body apart from a declared
    // Fairy one. `fix-grassresist` prints −30 against Grass.
    const state = ready(7113, "fix-grassresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    // …and the member is PARAMETERISED, so the same board answers TRUE one token
    // over. Without this line the false above could be a broken predicate.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" })).toBe(
      true,
    );
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 a FIGHTING WEAKNESS arms nothing — the column one field over, driven", () => {
    // The transcription-one-field-over board. `weaknesses` and `resistances` are the
    // same shape in the same schema and D173/D175 both caught a fixture whose
    // `types` had been copied out of the wrong one. An arm reading `weaknesses`
    // flips here and nowhere else in this file.
    const state = ready(7114, "fix-fightweak");
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(defender.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 …and that Weakness column is LIVE, so the false above is not an inert fixture", () => {
    // THE ATTRIBUTION CONTROL (D214). "The clause is false on `fix-fightweak`" is
    // worth nothing if the fixture's weakness column were unreadable — the board
    // would answer the same under a broken schema. A FIGHTING attacker into the
    // same body doubles: 10 × 2 = 20, with the clause still FALSE and adding
    // nothing. Same body, same column, opposite answer.
    const state = ready(7115, "fix-fightweak", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(weaknessOf(attacker, defender)).toEqual({ op: "multiply", amount: 2 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(20);
  });

  it("🛑 TWO entries, the match SECOND and VALUE-LESS — `.some`, and `type` alone", () => {
    // The one body that separates two readings at once. `fix-dualresist` prints
    // `[{Grass, -30}, {Fighting}]`:
    //   • `resistances[0].type === t` answers Grass and MISSES the Fighting entry;
    //   • a predicate that also required a printed `value` MISSES it too, because
    //     `WeakRes.value` is optional and this entry carries none.
    // §8.5 itself honours a value it cannot parse (it falls back to −30), so an
    // entry the pipeline cannot PRICE is one it still counts as a Resistance.
    const state = ready(7116, "fix-dualresist");
    const defender = FIXTURE_POOL["fix-dualresist"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.resistances).toEqual([{ type: "Grass", value: "-30" }, { type: "Fighting" }]);
    expect(defender.resistances?.[1]?.value).toBeUndefined();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" })).toBe(
      true,
    );
    expect(damageDealt(state)).toBe(60);
  });

  it("🛑 the identity is the STACK TOP — an evolved body answers with the top card's column", () => {
    // Every other Active-Spot member reads through `activeTop`, and this one must
    // too: a Fighting-resistant body with a Resistance-less card pushed on top is
    // no longer a Fighting-resistant Pokémon. Reading `stack[0]` would still say
    // it is.
    let state = ready(7117, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    state = pushOnActive(state, "p2", "fix-bigbody");
    expect(state.players.p2.active?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 it reads the OPPONENT's Active — the seat is half the member", () => {
    // The attacker's OWN side is never the subject. A Fighting-resistant body in
    // p1's own Active Spot arms nothing; without this the predicate could be
    // reading "either Active" and every case above would pass.
    // The mirror board: the Fighting-resistant body is in P1'S OWN Active Spot and
    // the other side of the table holds a body with no Resistance column at all.
    // Asked from p1 the answer must be FALSE — it is p1's own Resistance.
    const mirror = clearBench(
      setActiveFromDeck(ready(7118, "fix-bigbody"), "p1", "fix-fightresist"),
      "p1",
    );
    expect(mirror.players.p1.active).not.toBeNull();
    expect(conditionHolds(mirror, "p1", FIGHTING)).toBe(false);
    // …and from p2, whose OPPONENT is the seat now holding it, TRUE. Same board,
    // opposite answers, so the false above is the SEAT and not a dead predicate.
    expect(conditionHolds(mirror, "p2", FIGHTING)).toBe(true);
    // The ordinary orientation, for the same pair of answers the other way round.
    const state = ready(7119, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p2", FIGHTING)).toBe(false);
  });

  it("answers from BOTH seats — it reads the opponent OF `seat`, not p1's", () => {
    // A p1-only suite cannot tell "reads YOUR OPPONENT's Active" apart from "reads
    // p2's Active". P2 attacks here, and pays the bonus.
    const state = ready(7120, "fix-fightresist", "fix-oppresist", "p2");
    expect(damageDealt(state, "p2")).toBe(60);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, FIGHTING), seat).toBe(seat === "p2");
    }
  });

  it("an EMPTY Active Spot is FALSE, not a throw", () => {
    // The commitment every card-reading member in this union makes, driven rather
    // than commented. No legal action reaches this board, so the surgery is local.
    const state = emptyActive(ready(7121, "fix-fightresist"), "p2");
    expect(state.players.p2.active).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
  });

  it("the parameter is carried, not fixed — the same board answers 11 questions", () => {
    // The member is PARAMETERISED, so the board must answer differently per type.
    // Exactly one of the eleven is true against a single-entry Fighting Resistance.
    const state = ready(7122, "fix-fightresist");
    const held = POKEMON_TYPES.filter((type: PokemonType) =>
      conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type }),
    );
    expect(held).toEqual(["Fighting"]);
  });
});

describe("§6 — the census stands still", () => {
  it("🛑 the corpus totals STAND STILL — this slice adds no catalog row", () => {
    // The population is a committed transcription and this slice does not touch it.
    // Asserted here because every figure in §1 is a fraction of it: a corpus that
    // moved would make the residue step look like a reader change.
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });
});
