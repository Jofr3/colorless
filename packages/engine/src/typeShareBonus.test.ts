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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  TYPE_SHARE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D375 — THE CROSS-BOARD TYPE INTERSECTION, AND A SLICE WHOSE ENTIRE PRICE
// WAS THE SHAPE.
//
// D374 handed over *"If any of your Pokémon in play are the same type as any of
// your opponent's Pokémon in play, this attack does 120 more damage."* — Enamorus
// `sv06-093` "Love Resonance" (80+, **+120**) and its Illustration-rare reprint
// `sv06-180`, **1 sentence / 2 legal printings** — with D207's SUPPLY question
// already answered (`Card.types` has four readers in this union alone) and both
// ways the build could go vacuous NAMED IN ADVANCE. Both are defeated on boards
// here, and neither could have been defeated by argument.
//
// ✅ **THE IDS CAME OFF THE WEB, THE THIRD SLICE RUNNING** (D373 a ruling, D374 an
// existence count). The committed corpus is sentences-with-counts and holds no ids;
// this container still has no D1 credentials. limitlesstcg's `text:` search returns
// 8 cards for *"same type as any of your opponent"*, two of them Standard-era, and
// tcgdex confirms `sv06-093` / `sv06-180` — Twilight Masquerade, **Psychic**, 120
// HP. ⚠️ The web still cannot give a LEGAL-PRINTING COUNT; the 2 in §1 is
// `legalAttackCorpus()`'s and nowhere else's.
//
// 🛑 **VACUITY (1): "in play" READ AS "Active".** D279's refutation, and it lands
// on BOTH halves of this sentence — the printed words say "in play" twice. ⚠️ AND
// IT IS NOT THE VACUOUS KIND OF WRONG THAT D370 HAD. There, widening the zone made
// the clause satisfy itself off the attacker and go unconditionally TRUE. Here the
// attacker's own type is a LEGITIMATE term of the left-hand set — the printing is
// Psychic and means it — so an Active-only reading is right on most boards and
// silently under-pays on the rest. §4 computes BOTH narrowed readings beside the
// member on five boards: they agree on two and disagree on three.
//
// 🛑 **VACUITY (2): `types` ARRAYS COMPARED INSTEAD OF INTERSECTED.** "The same
// type" is satisfied by ANY shared member. **No Standard-legal Pokémon is
// dual-typed** (measured on the remote D1 at D238), so the catalog itself cannot
// tell an array equality from an intersection, and a suite built only from real
// shapes would be green on a build that compared arrays. §5 turns on
// `fix-dualbody` (`["Water", "Metal"]`, D370) and on nothing else.
//
// ✅ **THE EMPTY-SET BOUNDARY WAS READ BEFORE IT WAS ARGUED, AND IT IS FORCED.**
// §15b of `docs/reference/ptcg-rules.md` (D373) says which of these are forced and
// which are chosen: this is a positive existential — two of them nested — so an
// empty side is FALSE by logic. Calling it a choice would have been the mirror of
// the error D373 corrected in D369. §6 drives it on a hand-emptied Active Spot.
//
// WHAT SHIPS: 1 new `BoardCondition` member (`inPlayTypesIntersect`, NULLARY), its
// 2 reader arms, 1 LITERAL clause-table row. Zero new imports, patterns, maps or
// vocabulary.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `benchTypeBonus.test.ts` use. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D419 — the THREE readers this list never had (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard below diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

/** THE SENTENCE THIS SLICE BUYS, and the clause inside it. */
const TAKEN =
  "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.";
const TAKEN_CLAUSE =
  "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play";

const SHARED: BoardCondition = { kind: "inPlayTypesIntersect" };

// ── the WRONG readings, spelled out so they can be run beside the member ────────
//
// D214's attribution control, and this file needs three of them: a check whose
// subject is a shared artifact — here, the member's answer — is worth nothing
// unless something ELSE computes the alternative and the two are shown to differ
// on a real board. These are the three builds an author would plausibly write.

/** Every `Card.types` value on `seat`'s side, read through the stack TOP — the
    same walk the member makes, kept local so a mutant in the arm cannot quietly
    edit the control too. */
function typesInPlay(state: GameState, seat: Seat): string[][] {
  const side = state.players[seat];
  return [side.active, ...side.bench].flatMap((p) => {
    if (p === null) return [];
    const top = p.stack.at(-1);
    const card = top === undefined ? undefined : state.cardPool[state.cardIdByUid[top] ?? ""];
    return [card?.types ?? []];
  });
}

/** WRONG READING A — only the two ACTIVE bodies are consulted. */
function activesOnly(state: GameState, seat: Seat): boolean {
  const own = state.players[seat].active;
  const theirs = state.players[seat === "p1" ? "p2" : "p1"].active;
  if (own === null || theirs === null) return false;
  const [mine] = typesInPlay(state, seat);
  const [yours] = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return (mine ?? []).some((t) => (yours ?? []).includes(t));
}

/** WRONG READING B — the two `types` ARRAYS compared for equality. Green on every
    single-type board, which is every board the catalog can build. */
function arraysEqual(state: GameState, seat: Seat): boolean {
  const mine = typesInPlay(state, seat);
  const theirs = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return mine.some((a) =>
    theirs.some((b) => a.length === b.length && a.every((t, i) => t === b[i])),
  );
}

/** WRONG READING C — only `types[0]` on each body. Agrees with the member unless
    the shared type sits SECOND in some array. */
function firstTypeOnly(state: GameState, seat: Seat): boolean {
  const mine = typesInPlay(state, seat);
  const theirs = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return mine.some((a) => theirs.some((b) => a[0] !== undefined && a[0] === b[0]));
}

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TYPE_SHARE_DECK, p2: TYPE_SHARE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-typeshare` (FAIRY) in `seat`'s Active Spot with the `{C}` paid, `oppActive`
    across the table, and BOTH benches EMPTY — each case then benches exactly the
    bodies it is about. The default opposing Active is the 200 HP COLORLESS
    `fix-bigbody`, so the opening board shares no type at all and every TRUE below
    is something a case put there. `board` opens P1's turn, so a P2 case passes once
    more: a p1-only suite cannot tell "reads YOUR side" apart from "reads p1's". */
function ready(seed: number, seat: Seat = "p1", oppActive = "fix-bigbody"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-typeshare");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), oppActive);
  return clearBench(clearBench(state, seat), other(seat));
}

function benched(state: GameState, seat: Seat, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
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
    of bench[index]'s stack, so the benched body's IDENTITY (§1.2) is the pushed
    card while the card underneath is unchanged. Every uid stays in exactly one
    zone. `benchTypeBonus.test.ts`' helper verbatim — it exists to drive the
    `topCardOf` read directly, because a real evolution needs an `evolvesFrom`
    chain these synthetic bodies do not carry. */
function pushOnBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.bench[index];
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

/** TEST SURGERY, local to this file: empty `seat`'s ACTIVE SPOT, returning its
    cards to the deck so every uid stays in exactly one zone. No legal action
    reaches this state mid-turn — a KO promotes immediately — and the empty-set
    boundary §15b forces has to be answerable on it anyway. */
function emptyActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  if (side.active === null) return state;
  const returned = [...side.active.stack, ...side.active.energy, ...side.active.tools];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: null, deck: [...side.deck, ...returned] },
    },
  };
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the `needs` column", () => {
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

  it("🛑 the residue steps by exactly this sentence, and the 2-printing band by one", () => {
    // D374 left the residue at 26 / 32 with THREE clauses pinned at 2 printings.
    // Both figures are re-derived here off the same instrument — the nine live
    // readers over `legalAttackCorpus()` — rather than quoted from the handoff.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 25 / 30 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
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
    expect(refused.length).toBe(5); // 🆕🆕 D436 -2 sentences (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 8 -> 7, the DECK-SIZE READ, and the LAST buildable sentence in this residue
    expect(units(refused)).toBe(5); // 🆕🆕 D436 -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 11 -> 10, the DECK-SIZE READ's one printing
    // The recorded residues of D374, D373, D372, D371, D370 and D369, re-derived
    // from THIS head: add the sentences back rather than freezing the pair that
    // measured them. The step here is 1 sentence / 2 printings — the 1:2 shape for
    // the sixth time in seven slices.
    // 🆕🆕 D376 — one more term on every chain below, same 1:2 step (the FILTERED
    // DISCARD-PILE THRESHOLD). ⚠️ THE HEAD IS NOW 24 / 28, so every OFFSET here moved
    // by one sentence and two printings while the expected values stayed put — which
    // is the point of writing them as offsets off the live head at all.
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(refused.length + 19).toBe(24);
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(units(refused) + 23).toBe(28);
    expect(refused.length + 20).toBe(25);
    expect(units(refused) + 25).toBe(30);
    expect(refused.length + 21).toBe(26);
    expect(units(refused) + 27).toBe(32);
    expect(refused.length + 22).toBe(27);
    expect(units(refused) + 29).toBe(34);
    expect(refused.length + 23).toBe(28);
    expect(units(refused) + 31).toBe(36);
    expect(refused.length + 25).toBe(30);
    expect(units(refused) + 33).toBe(38);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // THREE -> TWO. The list is spelled out so a successor inherits the tie-break
    // MEASURED, and it is re-derived live rather than edited down. Both survivors
    // were priced in D374's handoff and neither price is re-taken here: the HEALED
    // clause needs a per-turn flag on the state (a persisted-shape change, so a
    // `MATCH_RECORD_VERSION` bump on top of the engine bump) and the discard-pile
    // one is a THRESHOLD over a filtered zone count.
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
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);// 🆕🆕 D436 the `n > 1` BAND IS NOW EMPTY — its one occupant was the 5-printing DECLARATION clause and this slice claims it. The rung still goes RED the moment any reader narrows so that a clause returns above one printing (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
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
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    // The 5-printing declaration clause D368 disqualified on SHAPE is still the
    // largest thing in the residue and still refused, so nothing here re-priced it.
    // 🆕🆕 **D436 — 5 → 1: THE DECLARATION CLAUSE LEFT AND THE RESIDUE IS FLAT.** The
    // paragraph above is right about the SHAPE and D436 does not contradict it: no
    // `BoardCondition` answers *"in addition to this attack's cost"*, and none does
    // now. The sentence is claimed by a `DamageCountSource` instead, whose fold runs
    // inside `attack()` where the declared cost is a local. ⚠️ **A REFUSAL SCOPED TO
    // ONE VOCABULARY IS NOT A REFUSAL OF THE SENTENCE.** The rung is kept and inverted
    // rather than deleted (D418): a FLAT maximum reddens the moment any clause returns
    // above one printing, which is the direction that still matters.
    expect(Math.max(...byClause.values())).toBe(1);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    // ONE record, because the corpus is a `GROUP BY` over distinct sentences.
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // ⚠️ THE IDS ARE `sv06-093` / `sv06-180` (Enamorus, Twilight Masquerade) and
    // they are NOT asserted here, deliberately: they were measured on the WEB and
    // this suite has no catalog to check them against. A rung over an unverifiable
    // string would be a guard that can only go red by being edited.
  });

  it("🛑 the `needs` column: NO existing member answers this, and the near ones DISAGREE", () => {
    // D199's rule, driven rather than listed. ONE board — a Fairy attacker facing a
    // Colorless body with a Fairy body on the OPPONENT's Bench — and the members
    // that read either the FIELD or the two-sided SHAPE this one needs.
    const state = benched(ready(6400), "p2", "fix-fairybody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    // Same FIELD, one body, wrong side of the table: their ACTIVE is Colorless.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Fairy" })).toBe(
      false,
    );
    // Same FIELD, one body, right side, wrong zone: YOUR Bench is empty.
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(false);
    // The two CROSS-BOARD members: both compare SCALARS on NAMED bodies, and
    // neither can see a type at all. `handSizesEqual` is a coincidence of the deal
    // and is asserted only to show it is not this clause's answer.
    expect(conditionHolds(state, "p1", { kind: "activeEnergyCountsEqual" })).toBe(false);
    // …and the whole reason no widening was priced: this member quantifies over
    // Active + Bench on BOTH seats. Moving the Fairy body to YOUR Bench keeps this
    // member's answer the same while every member above answers differently.
    const mirrored = benched(ready(6401), "p1", "fix-fairybody");
    expect(conditionHolds(mirrored, "p1", SHARED)).toBe(false);
    expect(conditionHolds(mirrored, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(true);
  });
});

describe("§2 — the LITERAL row: 120 from the sentence, and the near misses stay LOUD", () => {
  it("maps the printed sentence onto the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: SHARED },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`))
        .toEqual({ per, count: { kind: "boardCondition", cond: SHARED } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`)).toBeNull();
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 125 code points; the clause inside it is 87. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(125);
    expect(TAKEN_CLAUSE.length).toBe(87);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The apostrophe is ASCII, as everything the catalog prints is (D137).
    expect(TAKEN).toContain("opponent's");
    expect(TAKEN).not.toContain("’");
    // "in play" is printed TWICE and both are load-bearing (§4).
    expect(TAKEN_CLAUSE.split("in play")).toHaveLength(3);
  });

  it("🛑 D137's fold reaches this row — a CURLED re-ingest still lands on the member", () => {
    // `literalClauseRow` retries a clause-table miss with U+2019 folded to U+0027,
    // so the KEY survives a punctuation-normalising re-ingest. Unlike D374's row the
    // VALUE carries no text at all, so there is no second side to fold — which is
    // the one thing that makes this member cheaper than its predecessor.
    const curled = TAKEN.replace("opponent's", "opponent’s");
    expect(curled).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curled)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: SHARED },
    });
  });

  it("refuses CONSTRUCTED rewrites of the clause — the key is char-for-char", () => {
    for (const clause of [
      // The PARAPHRASE, first — D183's defect, and the one a hand-transcribed row
      // is most likely to carry: both "in play" phrases dropped.
      "any of your Pokémon are the same type as any of your opponent's Pokémon",
      // One "in play" dropped, each side in turn.
      "any of your Pokémon in play are the same type as any of your opponent's Pokémon",
      "any of your Pokémon are the same type as any of your opponent's Pokémon in play",
      // The NARROWING §4 refutes on a board, spelled as a sentence nobody printed.
      "any of your Pokémon in play are the same type as your opponent's Active Pokémon",
      // The seat collapsed — one side named twice.
      "any of your Pokémon in play are the same type as any of your Pokémon in play",
      // The quantifier changed: a UNIVERSAL is the case §15b had to CHOOSE about,
      // and it is not this sentence.
      "all of your Pokémon in play are the same type as any of your opponent's Pokémon in play",
      // The verb changed.
      "any of your Pokémon in play have the same type as any of your opponent's Pokémon in play",
      // De-accented: the exact silent failure the byte guard above exists for.
      "any of your Pokemon in play are the same type as any of your opponent's Pokemon in play",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 120 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("🛑 the two CROSS-BOARD siblings still answer their own sentences", () => {
    // The row was appended beside them, and keys are whole printed clauses, so
    // neither can be reached from the other. Driven rather than claimed.
    expect(
      deriveAttackDamageBonus(
        "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.",
      ),
    ).toEqual({ per: 90, count: { kind: "boardCondition", cond: { kind: "handSizesEqual" } } });
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.",
      ),
    ).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "activeEnergyCountsEqual" } },
    });
    // …and the TEMPLATES are untouched: a literal row is consulted first and this
    // one's key cannot be reached by either type pattern.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type: "Dragon" } },
    });
  });
});

describe("§3 — the note: VERBATIM, and the first cross-board one that round-trips BOTH ways", () => {
  it("🛑 round-trips to the printed BYTES *and* to the member", () => {
    // D116 has no pronoun to resolve here and D118 no card-face glyph to spell out:
    // the printed clause is already written in the second person a reject pill is
    // read in. So — unlike its two cross-board neighbours — this note IS the key.
    expect(conditionNote(SHARED)).toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(SHARED)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: SHARED } });
  });

  it("🛑 …and the two NEIGHBOURS deliberately do NOT, which is why this is stated", () => {
    // The property above is a fact about THIS sentence, not a rule for the family.
    // `activeEnergyCountsEqual` drops the printed "this Pokémon" (D116) and
    // `yourBenchHasType` spells the type name out instead of the brace code (D118);
    // both notes therefore differ from their keys and both still re-derive to their
    // members. Asserted so a successor does not "fix" one into the other.
    const energy: BoardCondition = { kind: "activeEnergyCountsEqual" };
    expect(conditionNote(energy)).not.toBe(
      "this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached",
    );
    const bench: BoardCondition = { kind: "yourBenchHasType", type: "Metal" };
    expect(conditionNote(bench)).toBe("you have any Metal Pokémon on your Bench");
    expect(conditionNote(bench)).not.toContain("{M}");
  });
});

describe("§4 — the ZONE: 'in play' is BOTH sides, and each half is its own refutation", () => {
  it("the base board shares NO type — the printed base and nothing more", () => {
    // A FAIRY attacker against a COLORLESS `fix-bigbody`, both benches empty. If
    // this were TRUE every rung below would be worthless.
    const state = ready(6410);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("the ATTACKER's OWN type counts — Active against Active, 10 + 120", () => {
    // The board the real printing leans on, and the one where the narrowed reading
    // is RIGHT: `fix-bigfairy` is a 200 HP Fairy body in the opposing Active Spot.
    // This is the attribution control for the two rungs below — without it, "the
    // narrowing disagrees" could just mean "the narrowing is always false".
    const state = ready(6411, "p1", "fix-bigfairy");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("🛑 THEIR BENCH is in play — an opponent-Active-only reading MISSES it", () => {
    // Their Active is Colorless and their BENCH holds the Fairy body. The member
    // pays; the narrowed reading does not, on the same board.
    const state = benched(ready(6412), "p2", "fix-fairybody");
    expect(state.players.p2.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("🛑 YOUR BENCH is in play — a your-Active-only reading MISSES it", () => {
    // The mirror half, and it needs a different type: the attacker is Fairy, so the
    // match has to come off a benched COLORLESS body meeting the Colorless
    // `fix-bigbody` across the table.
    const state = benched(ready(6413), "p1", "fix-benchfiller");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("🛑 BENCH against BENCH — neither Active is involved at all", () => {
    // Both halves narrowed at once: a Metal body on each Bench, a Fairy attacker,
    // a Colorless defender. This is the board that separates the member from a
    // build that got ONE of the two spreads right.
    let state = benched(ready(6414), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("a body of the WRONG type on either Bench arms nothing", () => {
    // The complement of the three rungs above: benching bodies that share no type
    // leaves the clause false, so "any Bench body at all" is refuted too.
    let state = benched(ready(6415), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-water-basic");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(state.players.p2.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });
});

describe("§5 — the INTERSECTION: the dual-type boards, and nothing else can see them", () => {
  it("🛑 DUAL vs SINGLE — an ARRAY EQUALITY answers FALSE and the member TRUE", () => {
    // `fix-dualbody` is `["Water", "Metal"]` and `fix-water-basic` is `["Water"]`.
    // The arrays are not equal; they MEET at Water. **No Standard-legal Pokémon is
    // dual-typed (D238), so this board cannot be built out of real cards** — which
    // is exactly why the fixture exists.
    let state = benched(ready(6420), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-water-basic");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(arraysEqual(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("🛑 DUAL vs SINGLE on the SECOND member — a `types[0]` reading answers FALSE", () => {
    // The same fixture against `["Metal"]`: Metal sits SECOND in `["Water",
    // "Metal"]`, so a build that compared first elements misses it. A board that
    // used Water instead would leave that build green.
    let state = benched(ready(6421), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(firstTypeOnly(state, "p1")).toBe(false);
    // …and the equality reading misses it too, for the other reason.
    expect(arraysEqual(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("the two wrong readings are NOT always false — the control board", () => {
    // D214: an alternative that can never be true proves nothing about the boards
    // where it differs. On a single-type match all three readings agree TRUE…
    const shared = ready(6422, "p1", "fix-bigfairy");
    expect(conditionHolds(shared, "p1", SHARED)).toBe(true);
    expect(arraysEqual(shared, "p1")).toBe(true);
    expect(firstTypeOnly(shared, "p1")).toBe(true);
    // …and on the base board all three agree FALSE.
    const apart = ready(6423);
    expect(conditionHolds(apart, "p1", SHARED)).toBe(false);
    expect(arraysEqual(apart, "p1")).toBe(false);
    expect(firstTypeOnly(apart, "p1")).toBe(false);
  });

  it("DUAL against DUAL meets on BOTH members, and one match is enough", () => {
    // The printed word is "any": a single shared member arms it, and a body that
    // carries two does not arm it twice.
    let state = benched(ready(6424), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-dualbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(arraysEqual(state, "p1")).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("ONE match among MANY is enough — an existential on each side", () => {
    // Three bodies benched on each side and exactly one pair meets, in the LAST
    // slot on both — a reader that stopped at slot 0 would answer FALSE.
    let state = benched(ready(6425), "p1", "fix-benchfiller", "fix-water-basic", "fix-metalbody");
    state = benched(state, "p2", "fix-fairybody", "fix-bigfairy", "fix-metalbody");
    expect(state.players.p1.bench).toHaveLength(3);
    expect(state.players.p2.bench).toHaveLength(3);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });
});

describe("§6 — the boundaries: the empty set, the stack TOP, the seat, and the corpus", () => {
  it("🛑 an EMPTY side is FALSE, and §15b says that is FORCED rather than chosen", () => {
    // A positive existential — two of them nested — over the empty set. The engine
    // does not get to choose this one, and §15b of ptcg-rules.md separates it from
    // the positive universal D373 DID have to choose about. Both directions, and
    // from both seats, because intersection commutes.
    const shared = ready(6430, "p1", "fix-bigfairy");
    expect(conditionHolds(shared, "p1", SHARED)).toBe(true);
    const noneOfMine = emptyActive(shared, "p1");
    expect(noneOfMine.players.p1.active).toBeNull();
    expect(noneOfMine.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(noneOfMine, "p1", SHARED)).toBe(false);
    expect(conditionHolds(noneOfMine, "p2", SHARED)).toBe(false);
    const noneOfTheirs = emptyActive(shared, "p2");
    expect(conditionHolds(noneOfTheirs, "p1", SHARED)).toBe(false);
    expect(conditionHolds(noneOfTheirs, "p2", SHARED)).toBe(false);
    // …and an empty side does not become true by the OTHER side being large.
    const stacked = benched(emptyActive(shared, "p2"), "p1", "fix-fairybody", "fix-metalbody");
    expect(conditionHolds(stacked, "p1", SHARED)).toBe(false);
  });

  it("🛑 the identity is the STACK TOP (§1.2) — an evolution DISARMS it", () => {
    // A Metal body on each Bench arms the clause; pushing a Fairy card onto MY
    // benched body makes it a Fairy Pokémon and the shared type is gone. Reading
    // `stack[0]` would still answer Metal and keep paying.
    let state = benched(ready(6431), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    state = pushOnBench(state, "p1", 0, "fix-fairybody");
    expect(state.players.p1.bench[0]?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 …and an evolution ARMS it, which is the same read from the other end", () => {
    // The mirror: a Metal body on my Bench and a Colorless `fix-bigbody` across the
    // table share nothing, until a Colorless card is pushed onto my benched body.
    let state = benched(ready(6432), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    state = pushOnBench(state, "p1", 0, "fix-benchfiller");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("🛑 SEAT-SYMMETRIC: the same board answers the same for both seats", () => {
    // The union's THIRD such member, after `handSizesEqual` and (D372)
    // `activeEnergyCountsEqual`. Set intersection commutes, so this is a property
    // and not a coincidence of the boards above — asserted on five of them.
    for (const seed of [6440, 6441, 6442, 6443]) {
      const apart = ready(seed);
      expect(conditionHolds(apart, "p1", SHARED), `${seed} apart`).toBe(
        conditionHolds(apart, "p2", SHARED),
      );
      const meeting = benched(ready(seed + 10), "p2", "fix-fairybody");
      expect(conditionHolds(meeting, "p1", SHARED), `${seed} meeting`).toBe(
        conditionHolds(meeting, "p2", SHARED),
      );
      expect(conditionHolds(meeting, "p2", SHARED), `${seed} meeting p2`).toBe(true);
    }
  });

  it("answers from BOTH seats on a real attack — it reads the board, not p1's", () => {
    // A p2 attacker pays the same +120, which is what tells "reads both sides"
    // apart from "reads p1's side and p2's side" spelled the wrong way round.
    const state = benched(ready(6450, "p2"), "p1", "fix-fairybody");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(conditionHolds(state, "p2", SHARED)).toBe(true);
    expect(damageDealt(state, "p2")).toBe(130);
  });

  it("🛑 the corpus totals STAND STILL — this slice adds no catalog row", () => {
    // The population is a committed transcription and this slice does not touch it.
    // Asserted here because every figure in §1 is a fraction of it: a corpus that
    // moved would make the residue step look like a reader change.
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });
});
