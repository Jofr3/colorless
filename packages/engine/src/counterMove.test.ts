import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type { GameEvent, GameState, PokemonRef, Seat, applyAction } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_MOVE_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// 0.86.0 → 0.87.0 — the COUNTER MOVE (D138). "Move all damage counters from 1 of
// your Benched Pokémon to your opponent's Active Pokémon." — 2 printings / 1 clause
// on ONE anchored regex with NO CAPTURE, ONE deriver arm and ONE NEW OP with NO
// FIELDS.
//
// THE FIRST DERIVED ATTACK OP THAT TOUCHES BOTH BOARDS IN ONE ACTION. Every heal
// arm before it (D132/D133/D135) moves damage only on the controller's side, and
// every snipe only on the opponent's. This one takes counters OFF a Pokémon the
// attacker chose and puts the SAME NUMBER onto the defender — so nearly every case
// below is an EQUALITY across the seat boundary, and the sharpest failures a wrong
// build produces are two different numbers rather than a missing row.
//
// WHAT THE RESUME POINT CLAIMED, AND WHAT WAS TRUE (checked before anything was
// built — D135's own lesson, and this file's first case is the check):
//   • "The CHOICE half is free" — TRUE, exactly. `ownBenchRefs` through
//     `parkOrForce` is byte-for-byte the candidate set D135 built for
//     `healChosen.zone: "bench"`, so the park, its three endings and the
//     illegal-pick refusal all cost nothing.
//   • "The move half is new" — TRUE. No op in the union moves a counter:
//     `damageActive` PLACES on the defender, `healChosen` REMOVES on your side,
//     and nothing did both.
//   • "Dedechange" — FALSE. The attack is "Tail Swap", and the local D1 prints no
//     attack named "Dedechange" at all. Pinned in the fixture-bytes case.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of chosenHeal.test.ts:
//   • THE TWO ROWS CARRY ONE NUMBER. `HEALED` for what came off and
//     `COUNTERS_PLACED` for what went on, and their `amount`s must be equal — that
//     equality IS the word "move". Every end-to-end case asserts the pair.
//   • THE PLACEMENT IS FLAT. A moved counter is not attack damage, so §8.5's
//     Weakness and the reduction passive both skip it. Driven against a ×2 PSYCHIC
//     defender under a PSYCHIC attacker, where a build that routed the placement
//     through the damage pipeline reads 160 instead of 80.
//   • IT CAN KNOCK THE DEFENDER OUT, and the sweep that catches it is the attack
//     EPILOGUE's — reached from BOTH endings, the forced inline one and the one on
//     the far side of a park, because `resumeTail` keeps `attackEpilogue` queued
//     behind the question.
//   • THE LOG ROWS ARE A SLICE CLAIM, not a formatting detail: `COUNTERS_PLACED`'s
//     `seat` owns the DAMAGED Pokémon, which here is the attacker's OPPONENT, so a
//     row in that seat's voice would credit the victim with the move (D136's
//     finding 1). The new `"moved"` source renders as a SYSTEM row.
//   • NO RNG AND NO REGISTRY ROW, and neither printing carries a `damage` field:
//     the move is the entire visible result of the declaration.

/** The pool's ONE clause of this shape, verbatim, and the op it derives to.
    Censused against the local D1 (2026-08-02) over the WHOLE effect string (978
    cards / 6 sets): every attack effect containing "damage counter" is 56 printings / 31
    distinct clauses, and exactly one of them MOVES counters rather than PUTTING
    them. Both printings are the same attack on the same card in two rarities. */
const CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

/** The op, field-less on purpose (D104's minimal shape, with D130's
    `discardOpponentDeckTop` as the precedent for putting the direction in the
    NAME). Every varying token of the neighbouring sentences is fixed in this one —
    the amount is the word "all", the source zone is the word "Benched", the
    destination is spelled out — so there is nothing for a field to carry. */
const MOVE_OP = { op: "moveCountersToDefender" } as const;

/** Both printings, by id: sv02-093 (Double rare) and sv02-239 (Ultra Rare) are ONE
    attack in two rarities, which is what meets D121's second-printing warrant
    without borrowing a family argument. Named rather than inlined because the
    zero-registry-row sweep quotes it. */
const CENSUS_IDS = ["sv02-093", "sv02-239"] as const;

/** The real catalog rows this anchor must refuse, verbatim off the local D1. The
    first two are the whole rest of the counter-MOVE neighbourhood; the rest share
    its destination noun phrase and PUT counters instead of moving them:
      • Munkidori sv06.5-072 "Adrena-Brain" — an ABILITY that moves UP TO 3
        counters, from ANY of your Pokémon, to a CHOSEN one of your opponent's.
        Three axes away, and the closest live text in the pool.
      • Slowbro sv01-043 "Strange Behavior" — an ABILITY that moves 1 counter to
        YOUR OWN side. The destination reversed, which is the one difference a
        loose matcher on "move … damage counter" would get catastrophically wrong.
      • Ninetales sv03-029/-199 "Nine-Tailed Dance" — "Put 9 damage counters on 1
        of your opponent's Pokémon. During your next turn, this Pokémon can't
        attack." The same VERB and a bare count, behind an any-zone target and a
        second sentence. RE-POINTED HERE AT D139, which mapped the previous
        occupant of this slot (Mimikyu sv02-097 "Ghost Eye" — "Put 7 damage
        counters on your opponent's Active Pokémon."); the witness moved rather
        than being deleted, because the claim is that an UNREAD sentence stays
        loud and that claim needs a still-unread sentence to be about.
      • Alolan Raticate swsh10.5-042 "Super Fang" — the same destination as the
        mapped PUT anchor, with the amount read off the TARGET's remaining HP
        instead of off the text. Still unmapped after D139, and the reason that
        anchor captures `(\d+)` rather than making the count optional.
      • ✅ **SPENT AT D348** — Drifblim sv01-090 "Curse Spreading" was listed here
        as "'in any way you like', a distribution across the opponent's whole
        board". It is MAPPED: arm 23a reads it as N repeated `damageChosen` ops,
        which is a PUT sequence and still not this anchor's MOVE verb — so the row
        left this list by being built, not by being reclassified. Recorded as spent
        rather than re-aimed (D346's rule: a rewritten note disagrees with
        nothing). The array's own witness WAS re-pointed, below.
      • Vespiquen ex sv03-096/-212 "Phantom Queen" — "each of your opponent's
        BENCHED Pokémon **that has any damage counters on it**": the same zone as
        D140's anchor with a per-target FILTER on top, which nothing in the
        vocabulary expresses. ⚠️ RE-POINTED AT D140, and the entry it replaced is
        the standing note working: this slot held Ting-Lu ex sv02-127 "Land Scoop"
        (the opponent's Bench, singular target), which D139 CORRECTED from "the one
        on this list the engine already simulates" to "unmapped, derives to null" —
        and which D140 then mapped. Two slices, one line, three states; the witness
        moved rather than being deleted each time.

    STANDING NOTE: when a later slice maps one of these, RE-POINT the case at
    another still-unmapped clause — never delete it. The suite's claim is that an
    unread sentence stays LOUD, and that claim needs a live witness to keep being
    about anything. */
const REAL_NEAR_MISSES = [
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
  "As often as you like during your turn, you may move 1 damage counter from 1 of your other Pokémon to this Pokémon.",
  // 🛑 **RE-POINTED A THIRD TIME AT D456 — AND THE OCCUPANT IT REPLACES WAS NOT A
  // CATALOG ROW AT ALL, WHICH IS THE FINDING.** The slot has held four sentences:
  // Ninetales sv03-029/-199's "Nine-Tailed Dance" (mapped D143), Lycanroc ex's "Scary
  // Fangs" (mapped D152), then the retaliation-with-an-unprinted-amount — spelled here
  // with *"(even if **it** is Knocked Out)"*. **The catalog prints that sentence with
  // *"(even if **this Pokémon** is Knocked Out)"* and nothing else.** Corpus line 180 is
  // the only printing of it, and this string was one parenthetical away from it, so the
  // rung asserted a hand-written paraphrase stayed null while the real printing was
  // never asked about — D183's defect (*"an arm written from a paraphrased sentence
  // passes a test written against the same paraphrase and matches no real card"*)
  // reaching a REFUSAL instead of an arm. FOUR files carried the same paraphrase; D456
  // found all four by grepping the phrase rather than the vocabulary.
  //
  // The replacement is a REAL corpus row (1 legal printing) and is this anchor's nearest
  // unread neighbour by a distance no other candidate comes close to: the SAME verb, the
  // SAME quantifier, the SAME destination, and ONE inserted adjective in the source noun
  // phrase. It is refused on that adjective alone — a `Benched Ancient Pokémon` filter
  // this anchor has no capture for — which is exactly what a near-miss slot is for.
  "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
  // ⚠️ RE-POINTED AT D451. This slot held *"Put damage counters on your opponent's
  // Active Pokémon until its remaining HP is 10."*, which D451 MAPPED (arm 23g over
  // the new op `counterUntilRemainingHp`), so the witness MOVED rather than being
  // deleted. The replacement is the SCALED TWIN — 3 legal printings, still unread and
  // still the family's largest single refusal: a PUT rather than a MOVE (this anchor's
  // verb difference, which is what the slot is for) whose count is a `cardsInDiscardPile`
  // PAYLOAD no rider carries, and whose tail no reader claims.
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
  // ⚠️ RE-POINTED AT D348 — the slot's THIRD occupant after Ninetales (D143) and
  // Lycanroc ex (D152). It held "Put 8 damage counters on your opponent's Pokémon in
  // any way you like." (sv01-090/sv04.5-156), which D348 MAPPED as arm 23a; the
  // witness moved rather than being deleted. The replacement is Cofagrigus
  // sv08-083 "Law of the Underworld", 1 legal — a PUT rather than a MOVE (this
  // anchor's verb), a filtered fold over BOTH boards rather than a source and a
  // destination, and no pick anywhere in it. ⚠️ **NOT the Cofagrigus this family
  // already reads** — sv10.5w-040/-123 "Extended Damagriiigus" is the mapped
  // chosen-destination MOVE (D216). Same card NAME, different printing, different
  // family, and naming both here is the point: the near miss is one printing away.
  // ⚠️ RE-POINTED AT D450 — this slot held the both-seats Ability fold (corpus line 418), which D450 MAPPED (arms 23d/23e/23f
  // over `counterEachAll`), so the witness MOVED rather than being deleted (the standing
  // note above). The replacement is the HP-TARGET row at 50, **2 legal printings** and still unread: a PUT rather than a MOVE (this anchor's verb difference, which is what the slot is for) whose amount is read off the TARGET rather than printed. The sentence it replaced is not gone from this
  // file: the claim about it is now an INEQUALITY of derived programs below the loop,
  // which is D418's second half and strictly stronger than the `toBeNull` it had.
  // ⚠️ RE-POINTED A SECOND TIME AT D451, ONE SLICE AFTER D450 FILLED IT. This slot
  // held the HP-TARGET row at 50, which D451 MAPPED (arm 23g), so the witness MOVED
  // again. The replacement is the CONFUSION SUBSTITUTION, 1 legal printing and still
  // unread: a PUT rather than a MOVE, and refused on the VERB twice over — the counters
  // RAISE the Checkup's per-condition amount rather than being placed or moved at all.
  // 🛑 A SLOT RE-POINTED IN TWO CONSECUTIVE SLICES IS A SIGNAL, NOT A CHORE: this
  // anchor's near-miss population is being consumed faster than the catalog refills it,
  // and the claim about both departed sentences now lives below the loop as an
  // INEQUALITY of derived programs (D418's second half).
  // 🆕🆕🆕 D501 — corpus FILE LINE 685 LEFT THIS LIST. It is claimed WHOLE by `deriveAttackEffect` through `DEFENDER_CONFUSION_N`, into an `applyStatus` carrying the raised amount — a STATUS op, which is what this family's refusal always said it would be. Re-pointed onto the OP rather than decremented (D465/D488): a count that steps says something left and nothing about what, where naming the op reddens on a reader widened past the count clause and stays green only on the build that actually shipped.
  // The positive that replaces it is pinned in `confusionDamage.test.ts` §3.
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
] as const;

/** U+2019, spelled as an ESCAPE rather than typed — the curly apostrophe a
    punctuation-normalising re-ingest would produce. D137's fold is a property of
    the READER, and this regex carries the `['’]` class in its own source; the
    assertion is EQUALITY with the straight form, never merely "non-null". */
const RSQUO = "\u2019";

/** U+00A0, likewise an escape. Byte-different from an ASCII space and INVISIBLE in
    a diff, which is exactly why the case names it instead of carrying it. */
const NBSP = "\u00a0";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `choosePokemon` prompt, narrowed — a state that did NOT park fails
    here with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** Dedenne ex prints the move FIRST and a big damaging attack second. Named rather
    than inlined, so a re-ingest that reordered the attacks fails on the fixture
    guards below rather than silently moving every case onto the wrong sentence. */
const TAIL_SWAP_INDEX = 0;
const WONDROUS_SHOT_INDEX = 1;
const WONDROUS_SHOT_DAMAGE = 170;

/** The benched pile the move carries. Chosen so that no single figure in this file
    can be confused with another: it is not the defender's HP, not a printed damage,
    and not a round multiple of anything the epilogue computes. */
const BENCH_HURT = 80;

/** A SECOND pile, on the body a case declines. Different from BENCH_HURT so a build
    that moved "whatever was on the Bench" rather than "the pick's counters" reads
    the wrong number rather than the right one by luck. */
const OTHER_BENCH_HURT = 30;

/** The defender's damage BEFORE the move, on the boards that measure an addition
    rather than a KO — so the assertion is `before + moved` and not just `moved`. */
const DEFENDER_HURT = 40;

/** fix-titan is 340 HP: 300 + BENCH_HURT is 380, so the moved pile is what tips it
    over. Written as the HP minus a margin the move covers, not as a magic number. */
const TITAN_HP = 340;
const DEFENDER_NEARLY_DEAD = 300;

/** fix-psychic-weak-big is 200 HP and ×2 PSYCHIC, and Dedenne ex is a PSYCHIC
    attacker: a build that routed the placement through §8.5 would double the pile.
    200 survives BOTH numbers, so that case measures the amount and never a
    promotion. */
const WEAK_DEFENDER_HP = 200;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const P1_BENCH_1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account (pinned by an
    unchanged `rngState` across a whole park-and-resolve below).

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery, and BOTH BENCHES ARE EMPTIED (D133's trap:
    `setActiveFromDeck` DISPLACES the Active it replaces onto the Bench, so every
    surgery leaves a stranger behind — invisible to a file that only asserts the
    Active, fatal to a file whose every claim is about a CANDIDATE LIST). Every
    benched body below is put there by a case, on purpose, with a figure that case
    chose. */
function board(): GameState {
  let state = driveSetup(7, { p1: COUNTER_MOVE_DECK, p2: COUNTER_MOVE_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Dedenne ex as `seat`'s Active with `energy` {P} paid, on a freshly emptied
    Bench. Two pays "Tail Swap"; three pays "Wondrous Shot". It is a Basic, so the
    surgery is a convenience rather than a necessity — the bench clear is not. */
function dedenneActive(state: GameState, seat: Seat, energy = 2): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-093"), seat),
    seat,
    "fix-psychic-energy",
    energy,
  );
}

/** Bench one titan per entry on `seat` and set each one's damage. fix-titan's 340
    HP carries any pile a case wants without the epilogue's KO sweep removing a
    candidate from under the assertion. */
function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

/** Declare `index` on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted here because this file drives a dozen. */
function declare(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index });
}

/** The one answer every parked case gives, as an action. */
function pick(ref: PokemonRef, seat: Seat = "p1") {
  return { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } } as const;
}

describe("the anchor — 2 printings, 1 clause, one regex with NO capture", () => {
  it("derives the ONE printed clause to a FIELD-LESS op", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([MOVE_OP]);
    // ONE op, and it carries nothing but its name. That is the slice's shape claim:
    // every token that varies among the neighbouring sentences is FIXED in this one
    // (the amount is "all", the source zone is "Benched", the destination is spelled
    // out), so there is no capture in the regex and no field on the op.
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object)).toEqual(["op"]);
    // THE CENSUS, ASSERTED AS A SHAPE: 1 distinct clause, 2 printings, 2 ids — the
    // numbers a re-census has to reproduce.
    expect(CENSUS_IDS).toHaveLength(2);
    expect(new Set(CENSUS_IDS).size).toBe(2);
  });

  it("is NOT a healChosen, in both directions — the neighbouring anchor's shape", () => {
    // The CHOICE half is shared (`ownBenchRefs` + `parkOrForce`, D135's own
    // candidate set) and the ACTION half is not, which is exactly why this is a new
    // op member rather than a field on `healChosen` (D131's widen-don't-add rule
    // applied and FAILING). A build that took the shortcut passes every park
    // assertion in this file and silently heals the Bench without damaging anybody.
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "healChosen" }),
    );
    // …and the sentence whose candidate set this one borrows still derives ITS own
    // op. Both anchors are `^…$` on a differing FIRST WORD, so no ordering of the
    // arms can matter.
    expect(deriveAttackEffect("Heal 60 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: 60, zone: "bench" },
    ]);
    expect(deriveAttackEffect("Heal 60 damage from 1 of your Benched Pokémon.")).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
  });

  it("refuses the FIVE real catalog rows that share its words", () => {
    for (const text of REAL_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // THE TWO THAT MATTER are the other counter MOVES, and they are dangerous in
    // opposite directions. Munkidori bounds the amount ("up to 3") and chooses its
    // destination; Slowbro moves counters ONTO the controller's own side. A matcher
    // built on "move … damage counter" rather than on the whole sentence would map
    // Slowbro's text to an op that damages the opponent — the widest possible miss.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[0])).toBeNull();
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toBeNull();
    // 🆕🆕🆕 **D451 — THE TWO HP-TARGET ROWS THAT LEFT THIS LIST, AS AN INEQUALITY.**
    // Both share this anchor's noun phrase (*"your opponent's Active Pokémon"*) and its
    // DESTINATION, and differ on the verb: a MOVE takes counters off one body to put
    // them on another, where these PUT new ones. An anchor keyed on the destination
    // rather than on the whole sentence would claim both, so the claim is made in the
    // form that still goes red on that defect.
    for (const hp of [
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(deriveAttackEffect(hp)?.[0]?.op, hp).toBe("counterUntilRemainingHp");
      expect(deriveAttackEffect(hp), hp).not.toEqual(deriveAttackEffect(CLAUSE));
    }
    // VESPIQUEN EX'S FILTERED BENCH SPREAD — unmapped, and the slot Ting-Lu ex's
    // "Land Scoop" vacated when D140 mapped it. A re-point, never a deletion.
    // 🆕🆕🆕 D501 — BY VALUE, NOT BY INDEX. Corpus FILE LINE 685 left this
    //     array, which SHIFTED every index after it — and an index shift is silent at
    //     every caller the compiler does not happen to catch (D447/D458). Spelling the
    //     string makes the reference immune to the next departure.
    expect(
      deriveAttackEffect(
        "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
    // …and the sentence that LEFT this list now derives, which is what makes the
    // re-point a fact rather than a bookkeeping preference.
    expect(
      deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Benched Pokémon."),
    ).not.toBeNull();
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path — Munkidori's and Slowbro's "move" are both lowercase and both mid
      // sentence — and the reason no /i flag is on this regex.
      "move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      // THE AMOUNT. "all" is the printed word; a number is Munkidori's shape and
      // this op has no field to put one in, so a reader that accepted it would
      // silently move the WHOLE pile for a printing that bounded it.
      "Move 3 damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      "Move up to 3 damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      // THE SOURCE ZONE. "Benched" is the printed word and the whole reason the
      // candidate set excludes the attacker; dropping it is Munkidori's source and
      // would silently offer the Active.
      "Move all damage counters from 1 of your Pokémon to your opponent's Active Pokémon.",
      // THE COUNT. "1" is the printed quantifier; "2 of your Benched Pokémon" is a
      // multi-pick this op cannot express and must not narrow to one.
      "Move all damage counters from 2 of your Benched Pokémon to your opponent's Active Pokémon.",
      // THE DESTINATION, reversed and re-aimed. Both are real readings elsewhere in
      // the pool and neither is this one.
      "Move all damage counters from 1 of your Benched Pokémon to your Active Pokémon.",
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Benched Pokémon.",
      // THE SEAT, swapped at the source. "1 of your opponent's Benched Pokémon" is a
      // sentence that would move THEIR damage onto THEIR Active — nonsense the
      // engine must not invent.
      "Move all damage counters from 1 of your opponent's Benched Pokémon to your opponent's Active Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE, not
      // typed: it is byte-different from a space and INVISIBLE in a diff.
      `Move${NBSP}all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Move  all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      // A LEADING RIDER sentence pins `^` — this is how a gated printing arrives.
      "Flip a coin. If heads, move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for. No
      // pool printing extends this clause today, which is precisely why the guard is
      // pinned now: the first one that does must land LOUDLY rather than
      // half-resolve, dropping a rider the engine never saw.
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon. This Pokémon is now Asleep.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${CLAUSE}\n`)).toEqual([MOVE_OP]);
  });

  it("derives the CURLY apostrophe identically — D137's class, not D137's fold", () => {
    // "your opponent's Active Pokémon" is the pool's most re-printed noun phrase and
    // every sibling regex on it carries `['’]` in its OWN source (D136/D137). The
    // claim is EQUALITY with the straight form, never merely "the curly one is
    // non-null" — a non-null check passes on a reader that folded the clause into
    // some other row. The discovered sweep in clauseApostrophe.test.ts picks this
    // sentence up from the FIXTURE, which is why that file's census moved 32 → 33.
    const curly = CLAUSE.replaceAll("'", RSQUO);
    expect(curly).not.toBe(CLAUSE);
    expect(curly).toContain(RSQUO);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(curly)).toEqual([MOVE_OP]);
  });
});

describe("the fixture's printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Dedenne ex sv02-093 — and it is TAIL SWAP", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const tailSwap = FIXTURE_POOL["sv02-093"]?.attacks?.[TAIL_SWAP_INDEX];
    expect(tailSwap).toEqual({
      cost: ["Psychic", "Psychic"],
      name: "Tail Swap",
      effect: CLAUSE,
    });
    // ⚠️ THE NAME. Three consecutive remainder lists called this attack
    // "Dedechange"; the local D1 prints no attack of that name anywhere in its 978
    // cards. The wrong name never reaches the engine — this reader keys on the
    // EFFECT — but it is pinned here because it is the reason the slice re-ran the
    // census instead of trusting the note (D135's lesson, applied to D135's note).
    expect(tailSwap?.name).not.toBe("Dedechange");
    // NO `damage` field at all (not a zero, not an empty string) — true of BOTH
    // printings, so the move (and the park in front of it) is the entire visible
    // result of the declaration. There is no number for a half-simulation to hide
    // behind.
    expect(tailSwap?.damage).toBeUndefined();
    expect(deriveAttackEffect(tailSwap?.effect ?? "")).toEqual([MOVE_OP]);
    expect(FIXTURE_POOL["sv02-093"]?.name).toBe("Dedenne ex");
    expect(FIXTURE_POOL["sv02-093"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-093"]?.hp).toBe(170);
    expect(FIXTURE_POOL["sv02-093"]?.abilities).toBeNull();
  });

  it("carries a control read by a DIFFERENT arm of the SAME deriver at index 1", () => {
    // A sharper control than the family's usual effect-less second attack: one card,
    // two attacks, two sentences, two DIFFERENT ops — so neither anchor can be
    // reaching the other's string, and the disjointness claim is made on real
    // printed bytes rather than on constructed text.
    const wondrousShot = FIXTURE_POOL["sv02-093"]?.attacks?.[WONDROUS_SHOT_INDEX];
    expect(wondrousShot).toEqual({
      cost: ["Psychic", "Psychic", "Psychic"],
      name: "Wondrous Shot",
      damage: WONDROUS_SHOT_DAMAGE,
      effect: "Discard an Energy from this Pokémon.",
    });
    expect(deriveAttackEffect(wondrousShot?.effect ?? "")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect(wondrousShot?.effect ?? "")).not.toEqual(deriveAttackEffect(CLAUSE));
  });

  it("costs ZERO registry rows — both printings simulate off their printed text", () => {
    // If either grew a row the registry would win (`programFor(id)?.attack?.[index]
    // ?? derive`) and every assertion above would keep passing while testing nothing
    // about the text.
    for (const id of CENSUS_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(programFor("sv02-093")).toBeUndefined();
    expect(programFor("sv02-239")).toBeUndefined();
  });
});

describe("end to end — the park, and the two halves of one move", () => {
  it("PARKS on a two-body Bench — and the attack epilogue WAITS behind the question", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: parked, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).toContain("EFFECT_PENDING");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p1");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    expect(parked.phase.cont.ctx.sourceUid).toBe(find(events, "ATTACK_DECLARED")?.uid);

    // THE CANDIDATE SET IS THE BENCH AND NOTHING ELSE — the printed word "Benched",
    // and the attacker is standing right there with two Energy on it.
    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([P1_BENCH_0, P1_BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(P1_ACTIVE);
    expect(prompt.note).toBe("Move the damage counters off which of your Benched Pokémon?");

    // NOTHING HAS MOVED YET, on EITHER board — which is the half a one-sided build
    // gets right by accident. And no turn end: the epilogue is QUEUED, so the §8.1
    // KO sweep and §5.3's turn end are still ahead of the answer.
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(types(events)).not.toContain("TURN_ENDED");
    // D189 — the stage names the ATTACKER by uid (the ATTACK_DECLARED row's).
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        // 🆕 D394 — the stage also names the ATTACK, off the same row, for the same
        // reason: `finishAttack` stamps `usedAttack` and cannot re-derive the name.
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
    expect(parked.players.p2.active?.damage).toBe(DEFENDER_HURT);
    // No printed damage anywhere: the move is the whole declaration.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("moves ONE pile ACROSS the seat boundary — the same number off and on", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const source = benchTopUid(state, "p1", 0);
    const defender = activeUid(state, "p2");
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    deepFreeze(parked);

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));

    // THE EQUALITY IS THE WORD "MOVE". Two rows, two seats, ONE number — a build
    // that healed a printed amount and placed a different one produces both rows and
    // the wrong game, which no single-row assertion would catch.
    const healed = all(events, "HEALED");
    const placed = all(events, "COUNTERS_PLACED");
    expect(healed).toEqual([{ type: "HEALED", seat: "p1", uid: source, amount: BENCH_HURT }]);
    expect(placed).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: defender, amount: BENCH_HURT, source: "moved" },
    ]);
    expect(healed[0]?.amount).toBe(placed[0]?.amount);

    // The BOARD, on both sides: the source is at exactly zero (the printed word is
    // "all"), the defender carries what it had PLUS the pile.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + BENCH_HURT);
    // ONE pick: the other benched body keeps every point, and the attacker — which
    // was never a candidate — is untouched.
    expect(done.players.p1.bench[1]?.damage).toBe(OTHER_BENCH_HURT);
    expect(done.players.p1.active?.damage).toBe(0);

    // …and only THEN the §5.3 tail ran, in one batch. The ORDER is the assertion: the
    // placement is the row that can Knock the defender Out, so it must land before
    // the epilogue rather than after it.
    expect(types(events)).toEqual([
      "HEALED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("FORCES a single benched body — one action, no prompt at all", () => {
    // `parkOrForce`'s middle case: exactly one candidate is not a decision, so it is
    // applied INLINE and the whole declaration resolves in a single action, both
    // halves included. A build that parked here would stop the game to ask a
    // question with one answer.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const source = benchTopUid(state, "p1", 0);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: source,
      amount: BENCH_HURT,
    });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p2.active?.damage).toBe(BENCH_HURT);
    expect(done.pending).toEqual([]);
  });

  it("WHIFFS SILENTLY on an EMPTY Bench — no park, no rows, and still SIMULATED", () => {
    // `parkOrForce`'s zero case, and the only board that reaches it: the source zone
    // is Bench-only, so a lone-Active Dedenne ex reads its sentence, finds nobody to
    // take counters from, and ends the turn in ONE action with no question asked.
    // The D134 three-state distinction, one slice on: SKIPPED (never read) ≠
    // ran-and-whiffed (this) ≠ moved.
    let state = dedenneActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    // THE DEFENDER IS UNTOUCHED, which is the half that matters here: an empty Bench
    // must not be read as "move nothing, but place something anyway".
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT);
    // AND NOT SKIPPED. The sentence WAS read — `deriveAttackEffect` returned a
    // program, so `effectSimulated` is true — and the loud row would be a lie about
    // the one thing the loud row exists to say.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("OFFERS an UNDAMAGED body, and picking it moves NOTHING — silently", () => {
    // The printed sentence carries no damaged restriction, so hiding a clean body
    // would be a rule the card does not print (the Potion doctrine `healChosen`
    // follows for the same reason). Picking it is a legal answer that moves zero,
    // and zero is announced by NEITHER row — a log must not say that nothing
    // happened, and a COUNTERS_PLACED of 0 would read as a hit.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [0, BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: parked, events: attackEvents } = declare(state, TAIL_SWAP_INDEX);
    expect(choosePrompt(parked).candidates).toEqual([P1_BENCH_0, P1_BENCH_1]);
    expect(types(attackEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    // The DAMAGED body it declined keeps its pile — the whiff took the PICK, not
    // "whatever was movable".
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_HURT);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("REJECTS every illegal pick — the Active, the opponent's board, an index past the end", () => {
    // "1 of your Benched Pokémon" is a zone AND a seat scope, and `candidates` is the
    // whole legality rule, so all three refusals come from one membership test.
    // Neither coordinate is hypothetical on a wire: an index is a number a client
    // computes and a seat is a field it fills in.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = benchTitans(state, "p2", [OTHER_BENCH_HURT]);
    state = setDamage(state, "p1", 0);
    state = benchTitans(state, "p1", [OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    // THE ATTACKER ITSELF. It is in play and it is the controller's, and on D135's
    // any-zone reading it would be a legal pick — the printed word "Benched" is the
    // entire difference, so this is the assertion that the word did work.
    expectErr(parked, resolve({ kind: "pokemon", ref: P1_ACTIVE }), "BAD_EFFECT_CHOICE");
    // THE OPPONENT'S BENCH — a real Pokémon, damaged, on the wrong side. A build that
    // dropped the seat check would move THEIR counters onto THEIR Active.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } }),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(parked, resolve({ kind: "pokemon", ref: P2_ACTIVE }), "BAD_EFFECT_CHOICE");
    // AN INDEX PAST THE END — p1 has exactly two benched bodies, so index 2 names
    // nothing.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 2 } } }),
      "BAD_EFFECT_CHOICE",
    );
    // And the multi-pick shape does not answer a single prompt.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P1_BENCH_0] }), "BAD_EFFECT_CHOICE");
    // A rejection leaves the park exactly where it was — the question is still open.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("consumes NO rng across the WHOLE resolution — park and resolve alike", () => {
    // No coin, no shuffle, no random pick: the amount is read off the board and the
    // target is CHOSEN by a player, which is the opposite of random. That determinism
    // is what lets this whole suite run on one board with no seed sweep, so it is
    // worth an assertion rather than a comment — and it is taken across BOTH actions,
    // since a park is the one place a second `apply` could quietly draw.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, pick(P1_BENCH_0));
    expect(done.rngState).toBe(state.rngState);
  });

  it("the parked state survives a JSON round-trip and resolves identically (D14)", () => {
    // The park is a wire object: `phase.prompt`, `phase.cont` and the `pending` queue
    // all cross the network between the question and the answer. A `cont` holding
    // anything JSON cannot carry works perfectly in-process and desynchronises an
    // online match — and this op's `cont` is the first to carry a field-less member.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    const rehydrated = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(rehydrated).toEqual(parked);
    const a = mustApply(parked, pick(P1_BENCH_1));
    const b = mustApply(rehydrated, pick(P1_BENCH_1));
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe("the destination half — a MOVED counter is not attack damage", () => {
  it("skips WEAKNESS entirely — a ×2 Psychic defender takes what came off the Bench", () => {
    // THE SHARPEST CLAIM OF THE DESTINATION HALF. Dedenne ex is a PSYCHIC attacker
    // and this defender is ×2 PSYCHIC, so a build that routed the placement through
    // the §8.5 pipeline reads 160 where the printed sentence says 80. "Put damage
    // counters" is not damage from an attack — no Weakness/Resistance and no
    // `damageReductionAfterWR` passive — which is `damageActive`'s rule verbatim.
    let state = dedenneActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-weak-big");
    state = clearBench(state, "p2");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const defender = activeUid(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-093"]?.types).toEqual(["Psychic"]);

    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p2.active?.damage).toBe(BENCH_HURT);
    expect(done.players.p2.active?.damage).not.toBe(BENCH_HURT * 2);
    // NOT A DAMAGE_DEALT ROW AT ALL — the event type is the claim as much as the
    // number is. `DAMAGE_DEALT` carries `weakness`/`resistance` fields precisely
    // because it went through the pipeline; this did not.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // …and the body survives both readings, so this case measures the amount and
    // never a promotion.
    expect(WEAK_DEFENDER_HP).toBeGreaterThan(BENCH_HURT * 2);
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.hp).toBe(WEAK_DEFENDER_HP);
  });

  it("runs from the OTHER SEAT too — the rows are seat-derived, not hardcoded", () => {
    // Every case above attacks from p1, so a build that wrote "p1" into the HEALED
    // row and "p2" into the placement passes all of them. Driving the same
    // declaration from p2 is what makes the two `seat` fields claims rather than
    // coincidences — and it is cheap, because both seats run the same deck.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = dedenneActive(state, "p2");
    state = benchTitans(state, "p2", [BENCH_HURT]);
    state = setDamage(state, "p1", DEFENDER_HURT);
    const source = benchTopUid(state, "p2", 0);
    const defender = activeUid(state, "p1");
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX, "p2");

    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p2",
      uid: source,
      amount: BENCH_HURT,
    });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(done.players.p1.active?.damage).toBe(DEFENDER_HURT + BENCH_HURT);
  });
});

describe("the KNOCK OUT the move can cause — the epilogue sweep, from both endings", () => {
  it("KOs the defender through a PARK — prize to the ATTACKER, and the turn ends last", () => {
    // THE INTERACTION THE SENTENCE ACTUALLY HAS, and the ending that could have gone
    // wrong: the counters land INSIDE a resumed program, after the attack's own
    // damage step is long past. The op never KOs — it only raises damage — and the
    // sweep that catches this is the attack EPILOGUE's two-seat one, still sitting on
    // `state.pending` because `resumeTail` kept it there across the question (D135).
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchTitans(state, "p2", [0]); // somebody to promote into
    const defender = activeUid(state, "p2");
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    // The KO has NOT happened at the park — the pile is still on p1's Bench, so a
    // build that resolved the placement at declaration would already have swept it.
    expect(parked.players.p2.active?.damage).toBe(DEFENDER_NEARLY_DEAD);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));

    // The pile tips the defender over its printed HP, and the ORDER says which row
    // caused which: off the Bench, onto the defender, then the Knock Out.
    expect(DEFENDER_NEARLY_DEAD + BENCH_HURT).toBeGreaterThanOrEqual(TITAN_HP);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: defender });
    const order = types(events);
    expect(order).toEqual(["HEALED", "COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    // THE PRIZE IS OWED TO THE ATTACKER — the seat that declared, not the seat that
    // owns the KO'd body. fix-titan carries no rule box, so it is exactly one, and
    // WHICH prize card is a decision, so the resolution stops here rather than
    // taking one for the player.
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the turn has NOT ended: the prize pick and the opponent's promotion are
    // both still in front of §5.3's tail, which is exactly the queue `resumeTail`
    // preserved across the move's own question.
    expect(order).not.toContain("TURN_ENDED");
  });

  it("KOs the defender INLINE too — the forced ending reaches the same sweep", () => {
    // The other `parkOrForce` ending, and it is a different code path into the same
    // epilogue: no park, no second action, so the whole attack — move, Knock Out,
    // prize — lands in ONE event batch. A build that only wired the sweep into the
    // resumed path passes the case above and loses every forced KO.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchTitans(state, "p2", [0]);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // The source body is still at zero on the far side of a KO sweep — the removal
    // half is not undone by the board changing under it.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });
});

describe("the log — two rows that read as one move", () => {
  it("renders the placement as a SYSTEM row, not in the victim's voice", () => {
    // D136's finding 1, refused at the source. `COUNTERS_PLACED.seat` OWNS the
    // damaged Pokémon — here the attacker's OPPONENT — and rows render after their
    // seat's name, so an active-voice row under this seat would credit the victim
    // with the move. `"moved"` is its own source member for exactly that reason:
    // reusing `"ability"` would print "Ability:" on an ATTACK as well.
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:11" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placedIndex = rendered.findIndex((r) => r.text.startsWith("Moved:"));
    const healedIndex = rendered.findIndex((r) => r.text.includes("healed"));
    expect(placedIndex).toBeGreaterThanOrEqual(0);
    expect(healedIndex).toBeGreaterThanOrEqual(0);
    const placed = rendered[placedIndex];
    const healed = rendered[healedIndex];
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(BENCH_HURT));
    // The removal row above it is in the CONTROLLER's voice and carries the SAME
    // number — which is what makes the pair legible as one move rather than as a
    // heal and an unrelated hit.
    expect(healed?.who).toBe("p1");
    expect(healed?.text).toContain(String(BENCH_HURT));
    expect(healedIndex).toBeLessThan(placedIndex);
    // And it is NOT the Ability row — the label a reused source member would print
    // on an ATTACK, which is the second half of why `"moved"` is its own member.
    expect(placed?.text).not.toContain("Ability");
  });
});
