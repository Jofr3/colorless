import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
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
import type { BoardCondition, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  HEALED_THIS_TURN_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 🆕🆕 D386 — THE HEALED-THIS-TURN CLAUSE: THE LAST 2-PRINTING ROW IN THE BONUS
// RESIDUE, DEFERRED SEVEN TIMES ON A PRICE THAT HAD STOPPED BEING A DIFFERENTIATOR.
//
//   Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`, index 0 of two —
//   confirmed by id against tcgdex, which returns "Pierce" ({G}{C}, 50, no effect
//   text) at index 1, and both printings byte-identical in rules text)
//     "If this Pokémon was healed during this turn, this attack does 100 more damage."
//     **2 legal printings.**
//
// 🛑 THE SLICE WAS A PRICING DECISION FIRST AND THE FACE-UP PRIZE ROW LOST AGAIN, ON
// A DIFFERENT ARGUMENT THAN LAST TIME. D385 refused that row at 0.22 printings-per-
// mechanism against a 0.33 rival, and seven slices refused THIS one because it moves
// `MATCH_RECORD_VERSION`. Both survivors now move it, so the record bump separates
// nothing at all. Re-priced in D382's units: the Prize row is 2 printings / 9
// mechanisms = **0.22**; this row is 2 / 5 = **0.40**. The five are the field plus its
// initialiser, the stamp, the member plus its two arms, the clause row and the bump.
// The four it does NOT buy are the whole difference: no player CHOICE (hence no park,
// no prompt, no choice kind, no `preventBlock` pair, no `programWalk` rows), no INDEX
// REMAP when a Prize is taken, no THIRD payoff anchor for a trailing reminder
// parenthetical, and no WIRE shape plus UI. ⚠️ And on the axis the arithmetic does not
// show, D385 measured the Prize gate's false arm as needing the attack used six times;
// both arms of this one are ordinary play, and §3–§6 reach them from the printed card.
//
// 🛑 THE SHAPE QUESTION WAS ORDERED FIRST AND THE COMPILER REFUSED TO ANSWER IT — a
// finding about the METHOD, not about this card. All three spellings were applied to
// `types.ts` and `bunx tsc -b --force` was read: `InPlayPokemon.healedTurn` costs
// 1 file / 1 site, `PlayerSide.healedThisTurn` costs 1 file / 1 site, and
// `GameState.healedThisTurn` costs 1 file / 1 site. A DEAD HEAT. D385's `prizes`
// measurement separated 1 from 17 and settled a four-slice argument in four minutes;
// it separates a WIDENING from a SHAPE CHANGE, and all three of these are widenings.
// So the answer came from the two things the compiler cannot see — the printed SUBJECT
// is "this Pokémon" (§5 drives the board where a per-seat boolean is wrong) and the
// CLOCK, because only a turn STAMP expires without a boundary clear (§6 drives that).
//
// 🛑 WHAT GOES RED HERE, STATED FIRST (D200 → D214):
//   (1) drop the stamp from any `healedBody` caller → §8's site census fails BY COUNT;
//   (2) make the stamp per-SEAT → §5 fails: a benched heal would arm the Active;
//   (3) clear the stamp at a turn boundary instead of comparing turn numbers, or
//       compare with `!== null` → §6 fails from the far side;
//   (4) stamp on a WHIFF (drop a caller's zero-guard) → §4 fails;
//   (5) read the OTHER seat's Active in the arm → §7 fails on p2's own turn;
//   (6) drop the clause row, or spell it with a different byte → §2 fails, and so does
//       §3's 120;
//   (7) re-home the printed base outside the gate → §3's unhealed hit stops being 20.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The TEN live readers, run as one — the set `censusAtHead.test.ts` keeps, and the
    only one that may be used as a REFUSAL ORACLE (D385: four suites run a NINE-reader
    array that is a census instrument and not an oracle). ⚠️ THIS SLICE ADDS NO
    ELEVENTH: the sentence resolves through `deriveAttackDamageBonus`, which has read
    this skeleton since D115. */
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
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const TAKEN = "If this Pokémon was healed during this turn, this attack does 100 more damage.";
const TAKEN_CLAUSE = "this Pokémon was healed during this turn";

/** The member, and the PROMOTION stamp's clause one row up in the same table — the
    per-turn cluster's other per-body stamp, and this file's control for "a second
    stamp on one body is two facts and not one". */
const HEALED: BoardCondition = { kind: "yourActiveHealedThisTurn" };
const PROMOTED: BoardCondition = { kind: "yourActivePromotedThisTurn" };

/** interpreter.ts as TEXT, for §8's stamp-site census. A GLOB rather than `node:fs`
    for `progressLog.test.ts`'s reason verbatim: this package has no `"types": ["node"]`
    in its tsconfig (it runs in a Worker and in the browser), and widening that to read
    one file would put Node globals in scope for the whole engine. */
const SOURCES: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./interpreter.ts", { query: "?raw", import: "default", eager: true });

function interpreterSource(): string {
  const text = SOURCES["./interpreter.ts"];
  if (text === undefined) {
    throw new Error(`interpreter.ts is not readable from the glob — keys: ${Object.keys(SOURCES).join(", ")}`);
  }
  return text;
}

// ── boards ─────────────────────────────────────────────────────────────────────

/** P2 opens and immediately ends, so every case below runs inside P1's turn 2 with a
    hand this file has not drawn into. `extraDraw` is pinned at 0 on both seats for
    `purgingStrike.test.ts`'s reason (a draw is a shuffle), and both Actives are pinned
    to `fix-bigbody` so the fixture is ASYMMETRIC before any assertion is made about
    either seat — D380's finding: a seat defect hides inside a symmetric board. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: HEALED_THIS_TURN_DECK, p2: HEALED_THIS_TURN_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `fix-lively` in `seat`'s Active Spot with its one {G} paid, a 200 HP `fix-bigbody`
    across the table, and both benches cleared. `board` opens P1's turn, so a P2 case
    passes once more — a p1-only suite cannot tell "reads YOUR Active" apart from
    "reads p1's Active" (D366's open question, and §7 is the board for it). */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-lively");
  state = attachFromDeck(state, seat, "fix-grass-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Play a Potion from `seat`'s hand at `ref`. Potion's program is
    `{ op: "healChosen", amount: 30 }`, which PARKS whenever two or more of the
    controller's Pokémon are in play and resolves INLINE when exactly one is
    (`parkOrForce`), so both shapes are handled here rather than at each call site. */
function potion(state: GameState, seat: Seat, ref?: PokemonRef): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, seat, "sv01-188", 1);
  const uid = handUid(withCard, seat, "sv01-188");
  const played = mustApply(withCard, { type: "playTrainer", seat, uid });
  if (played.state.phase.kind !== "effect:choose") return played;
  const prompt = played.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected a choosePokemon prompt");
  const pick =
    ref ?? prompt.candidates.find((c) => c.spot.spot === "active");
  if (pick === undefined) throw new Error("no candidate matched");
  const done = mustApply(played.state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "pokemon", ref: pick },
  });
  return { state: done.state, events: [...played.events, ...done.events] };
}

/** Play a Picnic Basket from `seat`'s hand: `{ op: "healEachAll", amount: 30 }`, the
    ONE route in this pool that writes a stamp onto the OPPONENT's board. Never parks. */
function picnicBasket(state: GameState, seat: Seat): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, seat, "sv01-184", 1);
  const uid = handUid(withCard, seat, "sv01-184");
  return mustApply(withCard, { type: "playTrainer", seat, uid });
}

/** THREE SEEDS (D270's rule). Nothing on this seam flips a coin, but the opening hand
    is a shuffle and this file plays Trainers out of it. */
const SEEDS = [7001, 7013, 7027] as const;

describe("§1 — the price, RE-DERIVED: the residue steps, and the 2-printing band EMPTIES", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the residue goes 20 / 24 → 19 / 22, and the band it leaves behind is EMPTY", () => {
    // Both figures are re-derived off the ten live readers over `legalAttackCorpus()`
    // rather than quoted, and the DEPARTURE and the SIZE are asserted separately: a
    // guard that only checked 19 / 22 could not tell "the row landed" from "a reader
    // broke".
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
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
    expect(refused.length).toBe(5); // 🆕🆕 D436 -2 sentences (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 8 -> 7, the DECK-SIZE READ, and the LAST buildable sentence in this residue
    expect(units(refused)).toBe(5); // 🆕🆕 D436 -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 11 -> 10, the DECK-SIZE READ's one printing
    // 🛑 A 1:2 STEP, which is the shape seven earlier slices in this family took —
    // D384's was the family's only 1:1. Written as offsets off the LIVE head so a
    // successor inherits the history without freezing it: D384's 20/24, D378's 21/25,
    // D377's 22/26, D376's 24/28.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 15, units(refused) + 19]).toEqual([20, 24]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 16, units(refused) + 20]).toEqual([21, 25]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 17, units(refused) + 21]).toEqual([22, 26]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 19, units(refused) + 23]).toEqual([24, 28]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🛑 THE 2-PRINTING BAND IS NOW EMPTY, WHICH IS D379's SATURATION SHAPE AND IS WHY
    // THIS RUNG IS NOT JUST `toEqual([])`. An emptied population cannot go red for the
    // reason that matters, so the refusal is driven from OUTSIDE it: the WHOLE
    // distribution is asserted, and the largest thing in the residue — the 5-printing
    // declaration clause D368 disqualified on SHAPE — is still there and still refused.
    // What turns this red: a reader narrowing so any clause re-enters at 2, this row
    // regressing (the healed clause returns at 2), or the 5-printing clause being
    // claimed or lost.
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    const distribution = new Map<number, number>();
    for (const n of byClause.values()) distribution.set(n, (distribution.get(n) ?? 0) + 1);
    // 🆕🆕 D387 — `{1: 17, 5: 1}` -> `{1: 16, 5: 1}`: the STAGE 1 clause left the
    // singleton band and nothing else moved.
    // 🆕🆕 D388 — `{1: 16, 5: 1}` -> `{1: 15, 5: 1}`: the RETREAT-COST THRESHOLD left
    // the singleton band and nothing else moved.
    // 🆕🆕 D391 — `{1: 13, 5: 1}` -> `{1: 12, 5: 1}`: the TYPED PER-BODY ENERGY
    // THRESHOLD left the singleton band and nothing else moved.
    // 🆕🆕 D392 — `{1: 12, 5: 1}` -> `{1: 11, 5: 1}`: the SUBSTRING NAME READ left the
    // singleton band and nothing else moved.
    // 🆕🆕 D393 — `{1: 11, 5: 1}` -> `{1: 9, 5: 1}`: the EVOLVE PAIR took TWO
    // singletons out at once, the first two-step this line has taken since D377.
    // 🆕🆕 D398 — `{1: 6, 5: 1}` -> `{1: 5, 5: 1}`: the DECK-SIZE READ took the LAST
    // BUILDABLE singleton out, and the 5-printing band is D368's SHAPE refusal, unmoved.
    // 🆕🆕 **D436 — `{1: 5, 5: 1}` -> `{1: 5}`.** The 5-printing band was D368's SHAPE
    // refusal and D436 claims it, so the distribution loses its only non-singleton
    // entry while the singleton band stands still at 5. ⚠️ THE WHOLE DISTRIBUTION IS
    // STILL ASSERTED (D379's saturation rule), so this reddens if any band reappears.
    expect([...distribution].sort((a, b) => a[0] - b[0])).toEqual([[1, 5]]);
    // 🆕🆕 D387 — 18 -> **17**: the STAGE 1 clause left the 1-printing band, which is
    // the ONLY band that moved. The 2-printing band was already empty and stays empty,
    // and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D388 — 17 -> **16**: the RETREAT-COST THRESHOLD left the 1-printing band,
    // which is the ONLY band that moved. The 2-printing band was already empty and stays
    // empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D389 — 16 -> **15** and 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT BENCH
    // COUNT and then the OPPONENT-SEAT TYPE READ, each a singleton leaving the same
    // band, with the 2-printing band already empty and staying empty.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    // 🆕🆕 **D436 — 5 → 1: THE DECLARATION CLAUSE LEFT AND THE RESIDUE IS FLAT.** The
    // paragraph above is right about the SHAPE and D436 does not contradict it: no
    // `BoardCondition` answers *"in addition to this attack's cost"*, and none does
    // now. The sentence is claimed by a `DamageCountSource` instead, whose fold runs
    // inside `attack()` where the declared cost is a local. ⚠️ **A REFUSAL SCOPED TO
    // ONE VOCABULARY IS NOT A REFUSAL OF THE SENTENCE.** The rung is kept and inverted
    // rather than deleted (D418): a FLAT maximum reddens the moment any clause returns
    // above one printing, which is the direction that still matters.
    expect(Math.max(...byClause.values())).toBe(1);
    // …and the clause this slice bought is not in the map at all, which is a different
    // claim from "no clause has 2 printings" and fails on its own if the row is dropped.
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
  });

  it("🛑 ONE sentence, TWO printings — and the CLAUSE is the whole population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    // …and no second sentence carries the clause under a different amount, so the row
    // cannot be short and cannot rot on a reprint at another number.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    // 🛑 AND THE WORD "healed" APPEARS IN THE LEGAL ATTACK COLUMN EXACTLY ONCE, WHICH
    // IS THE MEASUREMENT BEHIND THE ROW'S "no polarity partner" NOTE. `promotedTurn`'s
    // row has Palafin's "didn't move …" twin one table over; a "wasn't healed" printing
    // does not exist, so this row has nothing to be told apart from.
    const anyHealed = corpus().filter(([, s]) => s.includes("healed"));
    expect(anyHealed.map(([, s]) => s)).toEqual([TAKEN]);
  });
});

describe("§2 — the reading: ONE clause row, and every other reader refuses the sentence", () => {
  it("🛑 the printed sentence reads as +100 behind the member, byte for byte", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: HEALED },
    });
  });

  it("🛑 the OTHER NINE readers refuse it — the disjointness this family rests on", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN)).toBeNull();
    }
  });

  it("🛑 the note ROUND-TRIPS to the printed clause with the pronoun resolved (D116)", () => {
    // The printed subject is "this Pokémon"; a note read off the board by a person has
    // to spell it "your Active Pokémon". Everything after it is the printed clause.
    expect(conditionNote(HEALED)).toBe("your Active Pokémon was healed during this turn");
    expect(conditionNote(HEALED).endsWith("was healed during this turn")).toBe(true);
    // …and the note of the stamp one row up is NOT this one, which is the assertion
    // that a copy-pasted arm cannot pass.
    expect(conditionNote(PROMOTED)).not.toBe(conditionNote(HEALED));
  });

  it("🛑 a NEAR-MISS spelling is refused rather than mapped", () => {
    // The table is keyed on the whole clause, so a paraphrase the catalog does not
    // print falls through to null and stays LOUD (D183).
    expect(deriveAttackDamageBonus("If this Pokémon was healed this turn, this attack does 100 more damage.")).toBeNull();
    expect(deriveAttackDamageBonus("If this Pokémon healed during this turn, this attack does 100 more damage.")).toBeNull();
  });
});

describe("§3 — the board: the REAL printing, healed and unhealed", () => {
  it.each(SEEDS)("🛑 seed %i — an unhealed Maractus deals the printed 20", (seed) => {
    const state = ready(seed);
    const { state: after, events } = attack(state);
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(20);
    expect(after.players.p2.active?.damage).toBe(20);
    // …and the stamp really is absent rather than merely unequal.
    expect(state.players.p1.active?.healedTurn).toBeNull();
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
  });

  it.each(SEEDS)("🛑 seed %i — a Potion on the wounded Active buys the printed +100", (seed) => {
    // 50 damage on a 100 HP body: a comfortable non-lethal wound, and 30 of it comes
    // off. The Potion is played from HAND as an ordinary Item, which is the line the
    // printed card is designed for — this gate's true arm needs no constructed board.
    let state = setDamage(ready(seed), "p1", 50);
    const healed = potion(state, "p1");
    state = healed.state;
    expect(find(healed.events, "HEALED")?.amount).toBe(30);
    expect(state.players.p1.active?.damage).toBe(20);
    expect(state.players.p1.active?.healedTurn).toBe(state.turn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(true);
    const { events } = attack(state);
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(120);
  });

  it.each(SEEDS)("🛑 seed %i — the two arms differ by exactly the printed 100", (seed) => {
    const base = ready(seed);
    const cold = find(attack(base).events, "DAMAGE_DEALT")?.damage ?? 0;
    const warm = find(attack(potion(setDamage(base, "p1", 50), "p1").state).events, "DAMAGE_DEALT")
      ?.damage ?? 0;
    // 🛑 THE SUBTRACTION IS THE ASSERTION. A build that re-homed the printed base
    // OUTSIDE the gate would still deal 120 on the warm arm and would deal 0 on the
    // cold one, so checking only the boosted number cannot see it.
    expect(warm - cold).toBe(100);
    expect([cold, warm]).toEqual([20, 120]);
  });
});

describe("§4 — a WHIFF is not a heal, and the board is ordinary", () => {
  it.each(SEEDS)("🛑 seed %i — a Potion on an UNDAMAGED Active files no event and writes no stamp", (seed) => {
    const state = ready(seed);
    expect(state.players.p1.active?.damage).toBe(0);
    const played = potion(state, "p1");
    // The play is LEGAL — Potion prints no precondition (the Potion doctrine) — and it
    // heals nothing, so no HEALED row is filed and no stamp is written.
    expect(find(played.events, "HEALED")).toBeUndefined();
    expect(played.state.players.p1.active?.healedTurn).toBeNull();
    expect(conditionHolds(played.state, "p1", HEALED)).toBe(false);
    expect(find(attack(played.state).events, "DAMAGE_DEALT")?.damage).toBe(20);
  });
});

describe("§5 — the SUBJECT is 'this Pokémon', not the seat", () => {
  it.each(SEEDS)("🛑 seed %i — healing a BENCHED body leaves the Active's clause cold", (seed) => {
    // THE BOARD THAT SETTLES THE SHAPE QUESTION THE COMPILER COULD NOT (D214's
    // attribution control): a `PlayerSide.healedThisTurn` boolean is TRUE here and the
    // printed clause is FALSE, and a player reaches this board by playing a Potion on
    // their Bench — no construction required.
    let state = benchFromDeck(ready(seed), "p1", "fix-bigbody");
    state = setBenchDamage(state, "p1", 0, 50);
    const benchRef: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const healed = potion(state, "p1", benchRef);
    state = healed.state;
    expect(find(healed.events, "HEALED")?.uid).toBe(benchTopUid(state, "p1", 0));
    expect(state.players.p1.bench[0]?.healedTurn).toBe(state.turn);
    // …the ACTIVE is untouched on both the field and the clause…
    expect(state.players.p1.active?.healedTurn).toBeNull();
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    // …and the PER-SEAT reading, computed here beside the member off the same board,
    // disagrees — which is the whole content of the shape decision.
    const perSeatReading =
      (state.players.p1.active?.healedTurn === state.turn) ||
      state.players.p1.bench.some((b) => b.healedTurn === state.turn);
    expect(perSeatReading).toBe(true);
    expect(perSeatReading).not.toBe(conditionHolds(state, "p1", HEALED));
    expect(find(attack(state).events, "DAMAGE_DEALT")?.damage).toBe(20);
  });

  it.each(SEEDS)("🛑 seed %i — the stamp SURVIVES the bench→Active move, and so does the clause", (seed) => {
    // The same board, promoted: heal the Benched body and then RETREAT it into the
    // Active Spot. `retreat` spreads the whole Pokémon, so the stamp travels with it —
    // the printed sentence asks whether THIS POKÉMON was healed, not where it was
    // standing at the time. ⚠️ And it lands on a body that is now ALSO
    // `promotedTurn`-stamped, which is the board that shows the two per-turn stamps are
    // two facts and not one.
    let state = benchFromDeck(ready(seed), "p1", "fix-lively");
    state = setBenchDamage(state, "p1", 0, 50);
    const benchRef: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    state = potion(state, "p1", benchRef).state;
    const healedUid = benchTopUid(state, "p1", 0);
    // The retreat cost is paid by the {G} `ready` attached to the body that is
    // LEAVING — the one card on this board that is not the subject of anything here.
    const paying = state.players.p1.active?.energy ?? [];
    expect(paying).toHaveLength(1);
    state = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [...paying],
      promoteBenchIndex: 0,
    }).state;
    expect(activeUid(state, "p1")).toBe(healedUid);
    expect(state.players.p1.active?.healedTurn).toBe(state.turn);
    expect(state.players.p1.active?.promotedTurn).toBe(state.turn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(true);
    expect(conditionHolds(state, "p1", PROMOTED)).toBe(true);
  });
});

describe("§6 — the CLOCK: a turn STAMP expires by arithmetic, with no boundary clear", () => {
  it.each(SEEDS)("🛑 seed %i — healed on this turn, cold on the NEXT one this seat owns", (seed) => {
    let state = setDamage(ready(seed), "p1", 50);
    state = potion(state, "p1").state;
    const healedOn = state.turn;
    expect(state.players.p1.active?.healedTurn).toBe(healedOn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(true);
    // Round-trip to P1's next turn. Nothing walks the board at a turn boundary and
    // nothing clears the field — the comparison is what expires.
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(state.turn).toBeGreaterThan(healedOn);
    // 🛑 THE FIELD IS STILL SET — this is the assertion that separates a STAMP from a
    // FLAG, and a build that cleared it at `startTurn` would fail here while passing
    // every other case in this file.
    expect(state.players.p1.active?.healedTurn).toBe(healedOn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    expect(find(attack(state).events, "DAMAGE_DEALT")?.damage).toBe(20);
  });
});

describe("§7 — the SEAT: the arm reads the ASKER's Active, on a board that can tell", () => {
  it.each(SEEDS)("🛑 seed %i — P2's own Maractus collects the +100 on P2's turn", (seed) => {
    // The mirror of §3, one seat over. `ready` opens P2's turn for this case, so a
    // build that hard-coded `p1` reads a cold clause here and deals 20.
    let state = setDamage(ready(seed, "p2"), "p2", 50);
    state = potion(state, "p2").state;
    expect(conditionHolds(state, "p2", HEALED)).toBe(true);
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    expect(find(attack(state, "p2").events, "DAMAGE_DEALT")?.damage).toBe(120);
  });

  it.each(SEEDS)("🛑 seed %i — a CROSS-BOARD heal stamps the opponent, and expires before they can ask", (seed) => {
    // Picnic Basket (`healEachAll`) is the one route in this pool that writes onto the
    // OTHER seat's bodies, and it is what makes "during this turn" a question about
    // WHOSE turn rather than about whose Pokémon. P1 plays it while P2's Maractus is
    // wounded: the stamp lands with P1's turn number.
    let state = ready(seed);
    state = setActiveFromDeck(state, "p2", "fix-lively");
    state = attachFromDeck(state, "p2", "fix-grass-energy", 1);
    state = setDamage(state, "p2", 50);
    const played = picnicBasket(state, "p1");
    state = played.state;
    const p1Turn = state.turn;
    expect(state.players.p2.active?.healedTurn).toBe(p1Turn);
    // …and inside P1's own turn the clause is TRUE for P2, which is correct and
    // unobservable: P2 cannot attack during P1's turn.
    expect(conditionHolds(state, "p2", HEALED)).toBe(true);
    // Hand the turn over. `state.turn` advances, so the stamp P1 wrote reads FALSE for
    // the seat that owns the body — which is the printed reading of "this turn".
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.turn).toBeGreaterThan(p1Turn);
    expect(state.players.p2.active?.healedTurn).toBe(p1Turn);
    expect(conditionHolds(state, "p2", HEALED)).toBe(false);
    expect(find(attack(state, "p2").events, "DAMAGE_DEALT")?.damage).toBe(20);
  });
});

describe("§8 — the STAMP SITES: one helper, and the count is the guard", () => {
  it("🛑 every `HEALED` event site writes its body through `healedBody`", () => {
    // 🛑 WHAT THIS IS FOR. Six of the seven heal routes are unreachable from this
    // suite's 60 cards, so a behavioural guard here would cover two of them and be
    // silent about the rest. The invariant that actually matters is STRUCTURAL — the
    // event and the stamp are written together — so it is checked where it lives.
    //
    // WHAT TURNS IT RED: adding a `HEALED` event site without routing its body write
    // through the helper (the counts diverge), deleting a call (the same), or
    // introducing a second body-writing helper that skips the stamp (the pushes stay
    // at 7 and the calls drop). ⚠️ It cannot be satisfied by a doc comment — D210's
    // failure mode — because the pattern it counts includes `events.push({`, which no
    // prose in this file spells.
    const src = interpreterSource();
    const pushes = src.split('events.push({ type: "HEALED"').length - 1;
    const declarations = src.split("function healedBody(").length - 1;
    const calls = src.split("healedBody(").length - 1 - declarations;
    expect(declarations).toBe(1);
    expect(pushes).toBe(7);
    expect(calls).toBe(pushes);
  });

  it("🛑 the helper is the ONLY writer of the field, outside its own initialiser", () => {
    // `healedTurn:` appears in interpreter.ts exactly once — inside `healedBody` — so
    // no arm can stamp the field on its own terms. (`makeInPlay`'s `healedTurn: null`
    // lives in types.ts and is the absence, not a write.)
    const src = interpreterSource();
    expect(src.split("healedTurn:").length - 1).toBe(1);
    // …and it is READ exactly once, in the `conditionHolds` arm.
    expect(src.split("healedTurn ===").length - 1).toBe(1);
  });
});
