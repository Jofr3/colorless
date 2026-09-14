import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  COMPOUND_COMPOSE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

// 0.313.0 → 0.314.0 — 🆕🆕 D409: THE TRAILING-CLAUSE COMPOSITION PATH, AND THE
// FIRST TIME THIS ENGINE READS ONE PRINTED STRING AS TWO CLAUSES.
//
// 🛑 THE SHAPE QUESTION CAME FIRST (D368) AND IT DECIDED EVERYTHING ELSE. The
// residue held FIVE sentences / ELEVEN printings whose every clause is already
// read independently and which no reader claims as a whole. Two answers were
// available: five more hand-written whole-sentence anchors, or ONE splitter plus
// ONE composition site. The splitter won, and it won on a MEASUREMENT rather than
// on taste — §2 below runs the predicate over the whole committed
// `legal_standard = 1` attack column (640 sentences / 1,732 printings) and it
// admits exactly those five and NOTHING ELSE. A per-sentence anchor buys its own
// printing; this buys the five and every future compound whose clauses this file
// already reads.
//
// ⚠️ THE HAND-ANCHOR ROUTE ALSO LOST ON PRICE, AND THE PRICE IS NOT FIVE REGEXES.
// Two of the five put a `deriveAttackDamageBonus` clause in FRONT of a
// `deriveAttackEffect` one (8 of the 11 printings), and the two readers return
// DIFFERENT KINDS — a bonus that `attack.ts` folds into §8.5 and an `EffectOp[]`
// that runs after it. As whole-sentence anchors those two sentences need an arm in
// BOTH readers, each tolerating the other's clause: four arms for two sentences,
// and two readers made mutually aware of each other's grammar forever.
//
// 🛑 AND THE FALSIFIER THAT DID NOT FIRE, RE-DERIVED RATHER THAN INHERITED. The
// handoff warned that a composition path which only concatenates `EffectOp[]`
// could not take the two Prize compounds at all. `attack.ts` was OPENED instead of
// reasoned about (D406's rule): the bonus reader and the effect reader are read off
// the SAME string into TWO INDEPENDENT locals there, and nothing has ever stopped
// both from being non-null. So the composition is not "concatenate two op lists" —
// it is "give the HEAD to the readers that were already reading, and append the
// TAIL's ops" — and the cross-reader pair is the easy case rather than the
// impossible one.
//
// SEED-FREE: not one of the five compounds carries a coin, so a seed table would
// describe a shuffle rather than a rule.
//
// 0.314.0 → 0.315.0 — 🆕🆕 D410: THE BARE RETREAT LOCK ON THE OPPONENT SEAT, AND
// THE FIRST SLICE PRICED BY *"WHICH UNREAD CLAUSE COMPLETES THE MOST COMPOUNDS"*.
//
// 🛑 ONCE ONE STRING CAN BE READ AS TWO CLAUSES, THE BACKLOG STOPS BEING RANKED BY
// SENTENCE. The residue at D409's head held **21 sentences / 32 printings across 17
// distinct unread clauses, and NOT ONE of the 17 prints standalone anywhere in the
// column** — so every one of them is invisible to a sentence-ranked backlog and
// visible only to the instrument §2 below is. The top of that list is *"During your
// opponent's next turn, that Pokémon can't retreat."*: 4 printings, 2 compounds,
// ZERO standalone printings. ONE `^…$` anchor and ONE arm returning the shipped
// zero-field `preventRetreat` unchanged buys both.
//
// 🛑 AND IT PUTS THE SHADOW REFUSAL UNDER REAL LOAD FOR THE FIRST TIME. Until this
// slice, no sentence claimed WHOLE by an anchor also had both halves independently
// readable — the refusal was a guard against a case the catalog did not yet print.
// It does now: *"…is now Poisoned. During your opponent's next turn, that Pokémon
// can't retreat."* (arm 5c, 3 printings) has BOTH clauses claimed as of this slice,
// so it is splittable in principle and the refusal is the only thing keeping 5c's
// program. §5 asserts BOTH halves of that — the splitter still refuses it, AND the
// composition it would have produced is byte-for-byte what 5c returns.
//
// ⚠️ THE SELF-SIDE TWIN IS PRICED SEPARATELY AND STAYS UNBUILT, RE-DERIVED BY
// OPENING `interpreter.ts` RATHER THAN INHERITED. *"During your next turn, this
// Pokémon can't retreat."* (3 printings / 2 compounds, both behind a "Heal N damage
// from this Pokémon." head) locks the ATTACKER's body, and `preventRetreat` is
// `{ op: "preventRetreat" }` with `otherSeat(ctx.seat)` hard-coded at its
// interpreter arm. A `target` on a shipped zero-field op is a persisted-shape
// question and it is not this slice's.

/** The five printed compounds, byte for byte off `legalAttackCorpus()`. */
const PRIZE_THEN_DISCARD =
  "This attack does 50 more damage for each Prize card your opponent has taken. Discard an Energy from this Pokémon.";
const PRIZE_THEN_RECOIL =
  "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.";
const DISCARD_TWO_THEN_REDUCTION =
  "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";
const DISCARD_ALL_THEN_PARALYZE =
  "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.";
const POISON_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, the Defending Pokémon can't retreat.";
/** 🆕🆕 D410 — the two compounds the PRONOUN clause completes, byte for byte off
    `legalAttackCorpus()` (2 legal printings each). They differ from each other in
    exactly one word and from `POISON_THEN_NO_RETREAT_ANCHORED` in exactly one more,
    which is why the family is three sentences and one clause. */
const BURN_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat.";
const CONFUSE_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Confused. During your opponent's next turn, that Pokémon can't retreat.";
/** The shared TAIL — the whole subject of D410, and a string the legal column
    prints on ZERO cards as a whole attack effect (asserted in §2). */
const PRONOUN_LOCK = "During your opponent's next turn, that Pokémon can't retreat.";
/** 🆕🆕 D412 — the two compounds the SELF-side lock completes. Their head is
    `SELF_HEAL`, a `deriveAttackEffect` reader, so both land in the SAME-READER half
    of the 8 / N split below. Byte-for-byte off `legalAttackCorpus()`. */
const HEAL_50_THEN_SELF_LOCK =
  "Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";
const HEAL_60_THEN_SELF_LOCK =
  "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";

/** 🆕🆕 D424 — THE TENTH, AND IT ARRIVED WITHOUT THE SPLITTER CHANGING AT ALL.
    Its TAIL has been D189's `switchActive` since D189; its HEAD became readable the
    moment `DEFENDER_STATUS_PAIR` landed, and the admission followed from the
    predicate that was already here. That is the property D409 bought the splitter
    for — *"every future compound whose clauses this file already reads"* — observed
    rather than argued: this slice wrote no anchor for this string and no line of
    this file's production code. ⚠️ AND IT IS A `cross`-ROW THAT IS NOT: unlike the
    two 8-printing members whose heads only a DAMAGE reader claims, this head is
    claimed by `deriveAttackEffect` itself, so `cross` stands still at 2 / 8 and the
    whole step lands on the non-cross side (10 → 11). */
const CONFUSE_POISON_THEN_SWITCH =
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.";

/** 🆕🆕 D435 — the ELEVENTH admitted compound (corpus row 113, **2 legal printings**).
    Its HEAD is D431's *"Discard all Energy from this Pokémon."* and its TAIL is the
    delayed family's KNOCK-OUT payload, claimed by a BARE anchor D435 wrote precisely
    so that the shadow refusal would not take the compound whole. D434 measured this
    string being REFUSED and named the condition that would admit it; this is that
    condition, arriving. */
const DISCARD_ALL_THEN_DELAYED_KO =
  "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";

const COMPOUNDS = [
  PRIZE_THEN_DISCARD,
  PRIZE_THEN_RECOIL,
  DISCARD_TWO_THEN_REDUCTION,
  DISCARD_ALL_THEN_PARALYZE,
  POISON_THEN_NO_RETREAT,
  BURN_THEN_NO_RETREAT,
  CONFUSE_THEN_NO_RETREAT,
  HEAL_50_THEN_SELF_LOCK,
  HEAL_60_THEN_SELF_LOCK,
  CONFUSE_POISON_THEN_SWITCH,
  DISCARD_ALL_THEN_DELAYED_KO,
] as const;

/** The two SHIPPED whole-sentence anchors that are one token away from a member of
    the five — `DEFENDER_POISON_CANT_RETREAT` (arm 5c, the other noun phrase) and
    `SELF_DISCARD_ALL_THEN_REDUCTION` (the other count). They are what makes §5 a
    comparison of two ROUTES rather than a snapshot of one. */
const POISON_THEN_NO_RETREAT_ANCHORED =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.";
const DISCARD_ALL_THEN_REDUCTION_ANCHORED =
  "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";

/** The printed sentence break this slice reads: a period, then whitespace, then a
    capital or an opening parenthesis. A COPY of `effects.ts`'s
    `COMPOUND_CLAUSE_BREAK`, deliberately — the census rungs below have to be able
    to disagree with the implementation, which a shared import would prevent. */
const BREAK = /(?<=\.)\s+(?=[A-Z(])/;

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The `deriveAttack`-prefixed reader surface, taken from the MODULE rather than
    from a list.

    🆕🆕 D419 — **THIS WAS THE LAST PRIVATE COPY OF THE DERIVATION AND IT IS NOW A
    CALL.** The expression lived here, in `precociousEvolution.test.ts` (since D306)
    and in `censusAtHead.test.ts` (since D417) — three files deriving the same surface
    three ways, which is the *duplication* half of the defect D418 spent a slice on.
    ⚠️ **IT IS A WEAKER DEFECT THAN THE HAND-KEPT ARRAYS AND WAS STILL WORTH CLOSING**:
    a derived copy cannot go STALE the way a literal list can, so nothing here was ever
    wrong — but three derivations are three places for the PREFIX CONVENTION to drift,
    and the whole point of D418/D419 is that the surface has exactly one definition.
    ⚠️ D419's own close-out claimed this copy was already gone; it was not, and the
    claim was checked rather than taken. */
const EXPORTED_ATTACK_READERS = attackReaderSurface();

const readerNamed = (name: string): ((text: string) => unknown) =>
  (effects as unknown as Record<string, (text: string) => unknown>)[name] as (
    text: string,
  ) => unknown;

const claimedByAny = (text: string): boolean =>
  EXPORTED_ATTACK_READERS.some((name) => readerNamed(name)(text) !== null);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const ops = (text: string): EffectOp[] | null => deriveAttackEffect(text);

/** `fix-compound`'s attack indices — the five compounds in census order, then the
    SHIPPED twin of index 4, then the refusal control. */
const PRIZE_DISCARD_INDEX = 0;
const PRIZE_RECOIL_INDEX = 1;
const REDUCTION_INDEX = 2;
const PARALYZE_INDEX = 3;
const POISON_INDEX = 4;
const POISON_ANCHORED_INDEX = 5;
const UNREAD_TAIL_INDEX = 6;
// 🆕🆕 D410 — the two compounds the pronoun clause completes.
const BURN_INDEX = 7;
const CONFUSE_INDEX = 8;
// 🆕🆕 D412 — the two SELF-side compounds, appended rather than inserted: every
// index above is quoted in this suite's prose and in D409's/D410's, and renumbering
// them would rewrite claims that are still true.
const HEAL_50_SELF_LOCK_INDEX = 9;
const HEAL_60_SELF_LOCK_INDEX = 10;

const SEED = 31;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function board(seed: number, opts: { energy: number; defender?: string }): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-compound");
  state = setActiveFromDeck(state, "p1", "fix-compound");
  if (state.turn !== 2) throw new Error(`board() expected turn 2, got ${state.turn}`);
  return attachFromDeck(state, "p1", "fix-energy", opts.energy);
}

describe("§1 — the quantifier is over EVERY reader, and the list is DRIVEN not trusted", () => {
  it("the module exports exactly the eleven readers `effects.ts`'s array names", () => {
    // ⚠️ THE TRIPWIRE, and it has fired three times before (D316, D317, D381) and
    // been RE-POINTED rather than relaxed each time. `splitAttackTrailingClause`'s
    // refusal is "no reader claims this whole string" and its admission is "some
    // reader claims the head"; both quantify over `ATTACK_WHOLE_SENTENCE_READERS`
    // in `effects.ts`, and a TWELFTH reader added there and forgotten in that array
    // would make the splitter re-answer a compound that reader already reads whole.
    // Adding one reddens this line by name, and the fix is the array.
    // 🆕🆕 D417 — ELEVEN -> **TWELVE**, the FOURTH firing of this rung, and it was
    // re-pointed rather than relaxed: `deriveAttackCancelRequirement` (the TRAILING,
    // ANAPHORIC cancel) landed and this line went red naming it.
    expect(EXPORTED_ATTACK_READERS).toEqual([
      "deriveAttackBonusConsequent",
      "deriveAttackCancelRequirement",
      "deriveAttackCoinFlip",
      "deriveAttackDamageBonus",
      "deriveAttackDamageMultiplier",
      "deriveAttackDamagePenalty",
      "deriveAttackDamageSuppression",
      "deriveAttackDiscardScaledBoost",
      "deriveAttackEffect",
      "deriveAttackOptionalBoost",
      "deriveAttackOptionalCostBoost",
      // 🆕🆕 D428 — TWELVE -> **THIRTEEN**, the FIFTH firing of this rung, re-pointed
      // rather than relaxed: `deriveAttackPreDamage` (the PRE-DAMAGE Tool discard)
      // landed and this line went red naming it.
      "deriveAttackPreDamage",
      "deriveAttackRequirement",
    ]);
  });

  it("🛑 every reader's OWN printed sentence works as a head — the array, driven", () => {
    // 🛑 A COUNT IS A TRIPWIRE; THIS IS THE GUARD. For each of the eleven readers,
    // take the first sentence in the committed column that READER claims and append
    // a tail `deriveAttackEffect` claims. If the reader is in `effects.ts`'s array
    // the splitter admits the pair and hands back that exact head; if it were
    // dropped from the array the head would be claimed by nobody and the splitter
    // would REFUSE — so this goes red by reader name on a dropped entry, which the
    // count above cannot do.
    const tail = "Discard an Energy from this Pokémon.";
    const admitted: string[] = [];
    const shadowed: string[] = [];
    for (const name of EXPORTED_ATTACK_READERS) {
      const read = readerNamed(name);
      const row = legalAttackCorpus().find(([, s]) => s !== tail && read(s) !== null);
      expect(row, `${name} claims no corpus sentence`).toBeDefined();
      const head = (row as readonly [number, string])[1];
      const compound = `${head} ${tail}`;
      const split = splitAttackTrailingClause(compound);
      if (split === null) {
        // ⚠️ NAMED AS EMPTY RATHER THAN SKIPPED (D400). One reader lands here and
        // it is not a hole: `deriveAttackRequirement`'s own anchor tolerates a
        // trailing companion (D363), so it claims the synthetic compound WHOLE and
        // the shadow refusal fires — the anchor winning, which is the design. Drop
        // it from the array and this compound stops being claimed whole, the
        // splitter ADMITS it, and this branch goes red from the other side.
        expect(claimedByAny(compound), `${name}: refused but not shadowed`).toBe(true);
        shadowed.push(name);
        continue;
      }
      expect(split.head, name).toBe(head);
      expect(split.tail, name).toBe(tail);
      admitted.push(name);
    }
    // 🆕🆕 D417 — 10 -> **11**, and the twelfth reader lands in `admitted` rather
    // than beside `deriveAttackRequirement` in `shadowed`. The asymmetry is the two
    // anchors' own: D363's tolerates a TRAILING companion, so it claims the
    // synthetic compound whole and the shadow refusal fires; D417's is `$`-anchored
    // on its clause, so the compound is refused, the HEAD (its own printed sentence)
    // is claimed by this very array, and the splitter admits the pair.
    // 🆕🆕 D428 — 11 -> **12**, and the thirteenth reader lands in `admitted` for
    // D417's reason verbatim: `deriveAttackPreDamage` is `$`-anchored on its whole
    // sentence, so the synthetic compound is refused whole, the HEAD (its own printed
    // sentence) is claimed by this very array, and the splitter admits the pair.
    // `shadowed` is unmoved and still names exactly `deriveAttackRequirement`.
    expect(admitted).toHaveLength(12);
    expect(shadowed).toEqual(["deriveAttackRequirement"]);
  });
});

describe("§2 — the census: the predicate admits NINE sentences / EIGHTEEN printings", () => {
  it("🛑 exactly the nine, over the whole 640-sentence legal column", () => {
    // The measurement that decided the shape. It is the WHOLE column and not the
    // residue, so a sentence some reader already claims cannot hide inside it.
    // 🆕🆕 D410 — 5 / 11 → **7 / 15**, and the step came from ONE new clause rather
    // than from two new sentences: the Burned and Confused compounds share a tail,
    // so one `^…$` anchor completed both. That is the property the composition path
    // was built for, measured a slice after it shipped.
    // 🆕🆕 D412 — 7 / 15 → **9 / 18**, and the property held a SECOND time on the
    // other seat: one `^…$` anchor for "During your next turn, this Pokémon can't
    // retreat." completed both heal compounds. ⚠️ AND THE STEP IS THE WHOLE
    // POPULATION OF THAT SENTENCE — 3 printings, 3 admitted, nothing left over.
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    expect(units(corpus)).toBe(1732);
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    expect([...admitted].map(([, s]) => s).sort()).toEqual([...COMPOUNDS].sort());
    // 🆕🆕 D435 — 10 / 19 → **11 / 21**, and the step is D424's shape rather than
    // D410's or D412's: ONE new compound, admitted because its TAIL became readable
    // rather than because a splitter changed. Nothing about `splitAttackTrailingClause`
    // moved this slice. ⚠️ AND THE STEP IS THE WHOLE POPULATION OF THAT SENTENCE — 2
    // printings, 2 admitted, nothing left over.
    expect(admitted).toHaveLength(11); // 🆕🆕 D435 the ELEVENTH admitted compound. 🆕🆕 D424 the TENTH.
    expect(units(admitted)).toBe(21); // 🆕🆕 D435 +2 printings. 🆕🆕 D424 +1 printing.
  });

  it("the eighteen split 8 / 10 across the two SHAPES, which is why the seam had to move", () => {
    // 8 of the 15 are the CROSS-READER pair (a `deriveAttackDamageBonus` head), 7
    // are SAME-READER (a `deriveAttackEffect` head). Named because the price
    // argument in the header rests on it: a concatenate-only composition path would
    // have taken the 7 and left the 8. 🆕🆕 D410 — the CROSS half stands still at
    // 2 / 8 and the SAME-READER half steps 3 → 7, which is this slice's whole shape:
    // both new compounds put an effect clause in front of an effect clause.
    // 🆕🆕 D412 — the CROSS half stands still at 2 / 8 for a SECOND slice running
    // and the SAME-READER half steps 7 → 10. ⚠️ THE CROSS FIGURE HOLDING IS THE
    // INFORMATIVE HALF, not a spare assertion: it says the two new compounds were
    // taken by the path the price argument predicted, and a head that had quietly
    // fallen out of `deriveAttackEffect` would move it.
    const corpus = legalAttackCorpus();
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    const cross = admitted.filter(([, s]) => {
      const head = (splitAttackTrailingClause(s) as { head: string }).head;
      return deriveAttackEffect(head) === null;
    });
    expect(cross).toHaveLength(2);
    expect(units(cross)).toBe(8);
    expect(units(admitted) - units(cross)).toBe(13); // 🆕🆕 D435 11 → 13 — `cross` stands still at 2 / 8 for a THIRD slice running, because the new member's HEAD (D431's energy discard) is claimed by `deriveAttackEffect` and not merely by a damage reader. 🆕🆕 D424 10 → 11 — `cross` stands still at 2 / 8 because the new member's HEAD is claimed by `deriveAttackEffect`, not merely by a damage reader.
    // …and every one of the eighteen has EXACTLY TWO clauses, which is why the
    // splitter is not recursive: a three-clause compound whose parts are all
    // readable is a family of ZERO today and stays LOUD until it is not. 🆕🆕 D410
    // re-derives that at SEVEN sentences rather than carrying it from five — the
    // handoff named "one of these may need three clauses" as a thing to measure.
    for (const [, s] of admitted) expect(s.split(BREAK), s).toHaveLength(2);
  });

  it("🛑 D410 — the PRONOUN clause prints STANDALONE nowhere, and its antecedent is swept", () => {
    // 🛑 THE GUARD THE NEW ARM OWES, AND IT IS A GUARD RATHER THAN A PARAGRAPH
    // (D406→D407). "That Pokémon" is a BACK-REFERENCE: read standalone it has no
    // antecedent, and answering "the Defending Pokémon" is a CHOICE. What warrants
    // the choice is a POPULATION — every printing that carries this tail names the
    // opponent's Active in the clause in front of it — so the population is swept
    // here and reddens BY NAME the day a head with a different antecedent prints it.
    const corpus = legalAttackCorpus();
    // ① The clause is never a whole printed attack effect. This is why the anchor is
    //    reachable only through the splitter, and why claiming it moves `rawHead` by
    //    ZERO while `COMPOUND_ATTACK_UNITS` takes the whole delta.
    expect(corpus.filter(([, text]) => text === PRONOUN_LOCK)).toHaveLength(0);
    // ② …and yet the arm claims it, which is the half ① alone cannot show.
    expect(deriveAttackEffect(PRONOUN_LOCK)).toEqual([{ op: "preventRetreat" }]);
    // ③ THE ANTECEDENT SWEEP. Every sentence in the column that ENDS with this
    //    clause — three of them, seven printings — opens by naming the opponent's
    //    Active Pokémon. A future head saying "This Pokémon is now …" would bind the
    //    pronoun to the ATTACKER and this arm would lock the wrong body silently.
    const carriers = corpus.filter(([, text]) => text !== PRONOUN_LOCK && text.endsWith(PRONOUN_LOCK));
    expect(carriers).toHaveLength(3);
    expect(units(carriers)).toBe(7);
    for (const [, text] of carriers) {
      const head = text.slice(0, text.length - PRONOUN_LOCK.length).trim();
      expect(head, text).toMatch(/^Your opponent['’]s Active Pokémon is now [A-Za-z]+\.$/);
    }
    // ④ …and of the three, exactly ONE is claimed WHOLE by an anchor (5c's poison
    //    compound) and the other two arrive by composition. 3 = 1 + 2 is the whole
    //    accounting of this family, and it is asserted rather than described.
    const anchored = carriers.filter(([, text]) => claimedByAny(text));
    expect(anchored.map(([, text]) => text)).toEqual([POISON_THEN_NO_RETREAT_ANCHORED]);
    expect(units(anchored)).toBe(3);
    const composed = carriers.filter(([, text]) => splitAttackTrailingClause(text) !== null);
    expect(composed.map(([, text]) => text).sort()).toEqual(
      [BURN_THEN_NO_RETREAT, CONFUSE_THEN_NO_RETREAT].sort(),
    );
    expect(units(composed)).toBe(4);
  });

  it("every clause of every one of the seven is claimed INDEPENDENTLY", () => {
    // The supply check, re-derived rather than inherited: this is the property that
    // makes composition sound, and it is asserted per clause rather than per
    // sentence.
    for (const s of COMPOUNDS) {
      expect(claimedByAny(s), `${s} must be refused WHOLE`).toBe(false);
      const parts = s.split(BREAK);
      expect(parts, s).toHaveLength(2);
      for (const part of parts) expect(claimedByAny(part), part).toBe(true);
      // …and the TAIL specifically is an effect clause, which is the half the
      // caller appends.
      expect(deriveAttackEffect(parts[1] as string), s).not.toBeNull();
    }
  });
});

describe("§3 — the parenthesis measurement, which is why this is a REGEX", () => {
  it("🛑 ZERO of the 640 sentences are split inside parentheses", () => {
    // ⚠️ THE NAMED FALSIFIER THAT DID NOT FIRE, WITH ITS NUMBER WRITTEN DOWN. The
    // handoff's second field was that the catalog prints periods inside
    // parentheticals, so the split would need a parenthesis-aware SCANNER rather
    // than a regex. It does print them — 54 sentences / 114 printings carry a `.`
    // inside parentheses — and the regex splits NONE of them, because
    // `(?<=\.)\s+(?=[A-Z(])` needs whitespace and a capital after the period and
    // the parenthetical periods are all sentence-final ("…(Discard all cards
    // attached to this Pokémon.)"). A scanner would be a function written for a
    // population of zero. THE DAY THAT STOPS BEING TRUE THIS RUNG GOES RED.
    const corpus = legalAttackCorpus();
    const insideParens = (s: string, at: number): boolean => {
      let depth = 0;
      for (let i = 0; i < at; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth = Math.max(0, depth - 1);
      }
      return depth > 0;
    };
    const withParenPeriod = corpus.filter(([, s]) => {
      let depth = 0;
      for (const [i, c] of [...s].entries()) {
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "." && depth > 0 && i < s.length) return true;
      }
      return false;
    });
    expect(withParenPeriod).toHaveLength(54);
    expect(units(withParenPeriod)).toBe(114);

    let splitInsideParens = 0;
    for (const [, s] of corpus) {
      const scan = new RegExp(BREAK.source, "g");
      let m = scan.exec(s);
      while (m !== null) {
        if (insideParens(s, m.index)) splitInsideParens++;
        m = scan.exec(s);
      }
    }
    expect(splitInsideParens).toBe(0);
  });

  it("exactly ONE sentence prints a `. ` inside parentheses, and the lookahead refuses it", () => {
    // The single near-miss, named: "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"
    // — the word after that period is LOWERCASE, so `(?=[A-Z(])` is what keeps it
    // whole. Widen the lookahead to `.` and this sentence starts splitting mid
    // parenthetical, which is the mistake this rung exists to catch.
    const corpus = legalAttackCorpus();
    const dotSpaceInParens = corpus.filter(([, s]) => {
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "." && depth > 0 && s[i + 1] === " ") return true;
      }
      return false;
    });
    expect(dotSpaceInParens).toHaveLength(1);
    const only = (dotSpaceInParens[0] as readonly [number, string])[1];
    expect(only).toContain("etc. have Rule Boxes.");
    // It DOES break once — before the opening parenthesis, where the parenthetical
    // begins — and that boundary is OUTSIDE the parens, which is the distinction
    // the rung above measures. The `etc. have` period inside them is not a break.
    const parts = only.split(BREAK);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe("(Pokémon ex, Pokémon V, etc. have Rule Boxes.)");
    // …and the splitter still refuses it, because no reader claims either half.
    expect(claimedByAny(parts[0] as string)).toBe(false);
    expect(splitAttackTrailingClause(only)).toBeNull();
  });
});

describe("§4 — the SHADOW REFUSAL: the anchor wins, the splitter is the fallback", () => {
  it("🛑 🆕🆕 D420 — 153 sentences / 430 printings are multi-clause AND claimed whole — all refused", () => {
    // 🛑 THE GUARD THAT MAKES THIS SAFE TO SHIP. Without `claimedByAnyReader(text)`
    // in front of the split, every one of these would be re-answered by composition
    // instead of by the whole-sentence anchor its author wrote — the same program
    // in the lucky cases and a different one in the rest, with nothing able to tell
    // which. `SELF_DISCARD_ONE_THEN_DEFENDER_LOCK`, `DEFENDER_POISON_CANT_RETREAT`,
    // `COUNTER_PUT_ANY_THEN_SELF_LOCK` and `SELF_DISCARD_ALL_THEN_REDUCTION` are
    // four of the 149. Delete the refusal and this rung goes red 149 times.
    // 🆕🆕 D413 — 145 / 415 → **147 / 420**, and the step is a change of CLAIM rather
    // than a change of CORPUS, which is why the 271 / 613 pair below STANDS STILL
    // while this one moves. Both of the ADDITIVE MULTI-COIN FOLD's sentences —
    // *"Flip 2 coins. This attack does 30 more damage for each heads."* (3 printings)
    // and *"…does 50 more damage for each heads."* (2) — have ALWAYS been two-clause
    // (`Flip 2 coins.` ‖ `This attack does N more damage for each heads.`) and have
    // always sat inside the multi-clause population above. What D413 changed is that
    // `deriveAttackCoinFlip` now claims each of them WHOLE, so they cross out of the
    // multi-clause remainder and INTO the shadow-refusal population this rung counts
    // — and the loop below now owes a null on 147 sentences rather than 145.
    // 🆕🆕 D414 — 147 / 420 → **148 / 421**, a change of CLAIM and not of CORPUS
    // again, so the 271 / 613 pair below STANDS STILL a second slice running.
    // 🛑 AND ONLY **ONE** OF THE SLICE'S THREE SENTENCES LANDS HERE, WHICH IS THE
    // WHOLE POINT OF COUNTING CLAUSES RATHER THAN SENTENCES. The KO-without-damage
    // subset is +3 sentences / +4 printings through the RAW summand, but this rung
    // counts only the multi-clause members of that step: *"If your opponent's Active
    // Pokémon is a Basic Pokémon, it is Knocked Out."* (2 printings) breaks on a
    // COMMA and *"Both Active Pokémon are Knocked Out."* (1) has no internal break at
    // all, so both are ONE clause and were never in the 271 to begin with. Only
    // *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your
    // opponent's Active Pokémon is Knocked Out."* (1 printing) is multi-clause —
    // THREE clauses on two `BREAK`s — and it has always sat in the 271; what D414
    // changed is that `deriveAttackEffect` now claims it WHOLE, so it crosses out of
    // the multi-clause remainder and INTO the shadow-refusal population. Hence
    // +1 / +1 here against +3 / +4 on the census: 148 = 147 + 1, 421 = 420 + 1, and
    // the other +2 sentences / +3 printings are invisible to this rung by
    // construction. The loop below now owes a null on 148 sentences rather than 147.
    // 🆕🆕 D416 — 148 / 421 → **149 / 425**, a change of CLAIM and not of CORPUS a
    // THIRD slice running, so the 271 / 613 pair below STANDS STILL again.
    // 🛑 AND ONLY **ONE** OF THE PARKING KO PAIR'S TWO SENTENCES LANDS HERE, counted
    // off the `BREAK` boundaries rather than off the slice note. *"Flip a coin. If
    // heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of
    // your opponent's Benched Basic Pokémon."* (**4 printings**) carries TWO breaks —
    // `Flip a coin.` ‖ `If heads, …` ‖ `If tails, …` — so it is THREE clauses, it has
    // ALWAYS sat inside the 271, and what D416 changed is that `deriveAttackEffect`
    // arm 6d now claims it WHOLE: it crosses out of the multi-clause remainder and
    // INTO the shadow-refusal population this rung counts. *"Knock Out 1 of your
    // opponent's Pokémon that has exactly 6 damage counters on it."* (**2 printings**)
    // has NO internal break at all — one sentence, one clause, the D414 Basic-gate
    // shape — so it was never in the 271 and cannot enter here. Hence +1 / +4 here
    // against +2 / +6 on the census, and the printing steps DIFFER as well as the
    // sentence steps: 149 = 148 + 1, 425 = 421 + 4, and the counter-window sentence's
    // other +1 sentence / +2 printings are invisible to this rung by construction.
    // The loop below now owes a null on 149 sentences rather than 148.
    const corpus = legalAttackCorpus();
    const multiClause = corpus.filter(([, s]) => s.split(BREAK).length >= 2);
    expect(multiClause).toHaveLength(271);
    expect(units(multiClause)).toBe(613);
    // 🆕🆕 D417 — 149 / 425 -> **150 / 426**, a 1:1 step and the SMALLEST this rung
    // has taken. `deriveAttackCancelRequirement` joined `ATTACK_WHOLE_SENTENCE_READERS`
    // and its ONE printing (Eternatus `sv08-141`, *"Discard a Stadium in play. If you
    // can't, this attack does nothing."*) is multi-clause, so it crosses out of the
    // multi-clause remainder and into this shadow-refusal population. ⚠️ **THE
    // `toBeNull()` LOOP BELOW GAINS A MEMBER THAT WAS ALREADY NULL**, which is the
    // whole content of D417's own measurement: the trailing splitter refused that
    // string on its TAIL test before this reader existed (a does-nothing clause is
    // not an effect it claims), so the shadow refusal is belt to a brace that was
    // already fastened. That is why the step is countable here and invisible
    // everywhere else.
    // 🆕🆕 D420 — 150 / 426 -> **153 / 430**, a change of CLAIM and not of CORPUS for the
    // FIFTH slice running, so the 271 / 613 pair above STANDS STILL again.
    // 🛑 AND THIS IS THE FIRST SLICE SINCE D413 WHOSE STEP HERE EQUALS ITS STEP ON THE
    // CENSUS — +3 / +4 against +3 / +4 — which is a FACT ABOUT THE PRINTED STRINGS and
    // not a coincidence worth relaxing about. D414 landed 1 of 3 here and D416 landed 1
    // of 2, because those slices' other sentences broke on a COMMA or carried no internal
    // break at all and so were never in the 271. ALL THREE of the HAND-ENERGY COST
    // FAMILY's sentences carry a sentence-boundary `BREAK` — the cost prints, then the
    // cancel prints as its own sentence — so each is TWO clauses:
    //   *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's
    //    Active Pokémon."* ‖ *"If you can't discard 6 cards in this way, this attack does
    //    nothing."*  (2 printings)
    //   *"Discard 2 Basic {G} Energy cards from your hand."* ‖ *"If you can't discard 2
    //    cards in this way, this attack does nothing."*  (1)
    //   *"Discard a Basic {G} Energy card from your hand."* ‖ *"If you can't, this attack
    //    does nothing."*  (1)
    // ⚠️ NOTE WHERE THE COMMA JOIN SITS AND WHY IT DOES **NOT** COST THIS RUNG A MEMBER:
    // the six-Energy sentence's `", and "` join is INSIDE its first clause, so it is the
    // reason that sentence needed an arm of its own (`deriveAttackEffect` 6g) rather than
    // the composition path — but the clause count this rung reads is taken off the
    // sentence boundary before the cancel, which every one of the three carries.
    // ⚠️ ALL THREE HAVE ALWAYS SAT INSIDE THE 271, so the CORPUS term cannot move: what
    // D420 changed is that `deriveAttackCancelRequirement` — its `ATTACK_CANCEL_TRAILING`
    // head list WIDENED past D417's Stadium-only head — now claims each of them WHOLE, so
    // all three cross out of the multi-clause remainder and INTO the shadow-refusal
    // population this rung counts. 153 = 150 + 3, 430 = 426 + 4, and NOTHING of this
    // slice is invisible here for once.
    // ⚠️ AND THE `toBeNull()` LOOP BELOW GAINS THREE MEMBERS THAT WERE ALREADY NULL, for
    // D417's reason verbatim: the trailing splitter refused all three on its TAIL test
    // before this anchor widened (a does-nothing clause is not an effect it claims), so
    // the shadow refusal is belt to a brace that was already fastened.
    const claimedWhole = multiClause.filter(([, s]) => claimedByAny(s));
    // 🆕🆕 D458 +1 sentence / +2 printings — THE SECOND PRINTED NOUN
    // (`censusAttackCorpus.ts` line **410**, *"Search your deck for up to 2 Basic {G} Energy
    // cards **and up to 2 Basic {L} Energy cards** and attach them to your Pokémon in any way
    // you like. Then, shuffle your deck."*), claimed WHOLE by `deriveAttackEffect` through ONE
    // optional group on D235's existing anchor plus a second `attachFromDeck` op: ZERO new
    // anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS.
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DIFFER, 1 vs 2** — one sentence, two legal
    // printings — so a pass that copied one number into the other kind of site would be wrong
    // in half of them (D451).
    expect(claimedWhole).toHaveLength(208);  // (🆕🆕🆕 **D513 +1 multi-clause sentence claimed WHOLE — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) 🆕🆕🆕 **D505 +1 — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517): this sentence is MULTI-CLAUSE — the `(Don't apply …)` parenthetical is a depth-0 segment after a `.` — AND claimed WHOLE by arm 6-i, so it enters this SHADOW-REFUSAL population as well as the reader census. A change of CLAIM and not of CORPUS, so the multi-clause total below STANDS STILL.** // 🆕🆕🆕 **D490 +1 — THE MILL OF BOTH DECKS: this sentence is MULTI-CLAUSE (a period joiner) AND claimed WHOLE, so it enters this population as well as the resolving one. ⚠️ A census site is its PREDICATE, not its unit (D461) — the +1 here is a SENTENCE step even though the resolving chains take +2 printings.** (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER; `censusAttackCorpus.ts` FILE LINE 138. ⚠️ THE TWO STEPS DISAGREE, 1 AND 2** — a `.length` site takes +1 where a `units(…)` site takes +2.) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 multi-clause sentence claimed whole — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, *"Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`; ZERO new `CardFilter` members and reader surface still **13**. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED at this head.) // (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 D483 +2 multi-clause sentences claimed whole — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 multi-clause sentence claimed whole — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) //🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **AND THIS SITE MOVES**, which is D475's finding one slice on and is NOT inferable from the resolving census: `claimedWhole` counts sentences that are MULTI-CLAUSE **and** claimed whole (D461), and this row is two `. `-joined clauses — *"Flip 3 coins."* and the consequent — so its second conjunct holds. **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** here, and `COMPOUND_ATTACK_UNITS` stands still, because a string a reader claims WHOLE never reaches `splitAttackTrailingClause` — D426's mechanism, re-measured rather than assumed.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) ⚠️ AND THIS SITE MOVES WHERE D474's DID NOT: `claimedWhole` counts sentences that are MULTI-CLAUSE **and** claimed whole (D461), and this one is two `. `-joined clauses, so its second conjunct holds. A slice that stepped by analogy would have got this wrong in either direction. // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.) 🆕🆕 D463 +2 sentences (THE PER-HEADS ENERGY DISCARD — `censusAttackCorpus.ts` **file lines 200 and 234**, *"Flip {2 coins|a coin until you get tails}. For each heads, discard an Energy from your opponent's Active Pokémon."*). 🛑 **BOTH ARE MULTI-CLAUSE AND BOTH ARE NOW CLAIMED WHOLE**, which is exactly the population this rung counts, so the step lands here rather than being invisible: the claimant is `deriveAttackCoinFlip`, whose anchors span the WHOLE two-sentence string, and the shadow refusal below is what says the splitter never gets a look at them. 🆕🆕 D461 **UNMOVED AT 176, AND THE STANDING-STILL IS THE MEASUREMENT** (D435: not incrementing is also a measurement). The SCOPED BOARD HEAL adds 4 claimed printings to the corpus (`censusAttackCorpus.ts` file lines 273 and 274) and NONE of them reaches this rung, because this rung counts printings that are MULTI-CLAUSE **and** claimed whole — and both new sentences hold ZERO `. ` joiners, so `splitAttackTrailingClause` returns null on each before the anchor is ever consulted. 🛑 A FIRST PASS OF D461 STEPPED THIS LINE TO 180 BY ANALOGY WITH THE OTHER PRINTING SITES AND IT WAS WRONG: *"every printing site moves by the same delta"* is false the moment a site carries a SECOND predicate, and the cheap disproof was running the suite rather than reasoning about it. 🆕🆕 D461 +2 sentences / +4 printings (THE SCOPED BOARD HEAL — `censusAttackCorpus.ts` **file lines 273 and 274**, *"Heal 100 damage from each of your {Basic|Benched} Pokémon."*, **2 sentences / 4 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 17b through ONE new anchor (`OWN_BOARD_HEAL_NARROWED`), ONE two-row noun MAP (`OWN_BOARD_HEAL_NOUNS`) and **TWO new OPTIONAL FIELDS on the SHIPPED `healEach` op** — `basicOnly` (a CARD read, `matchesFilter`'s `basicPokemon` arm) and `benchOnly` (a BOARD read no `CardFilter` can express at any width). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 4** — both file lines carry 2 legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site rather than at half of them. ZERO new `EffectOp` MEMBERS, readers (surface unmoved at 13), `CardFilter` members, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; `MATCH_RECORD_VERSION` STAYS 29.) 🆕🆕 D460 +3 sentences / +4 printings (THE COIN-COUNT THRESHOLD — `censusAttackCorpus.ts` **file lines 213, 214 and 228**, *"Flip {2|4} coins. This attack does {90|60} damage for each heads. If {either of them is heads|both of them are tails|at least 2 of them are heads}, your opponent's Active Pokémon is now {Paralyzed|Confused}."*, **3 sentences / 4 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and the coin union's FIFTH member `perHeadsThenThreshold`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 3 vs 4** — file line 214 carries 2 legal printings and 213/228 carry 1 each, so a pass that copied one number into the other kind of site would be wrong in half of them. **ZERO new `EffectOp`s, op FIELDS, prompt fields, `packages/schema` bytes, `redact.ts` bytes or registry rows, and the reader SURFACE stands still at 13** — the consequent is the shipped `applyStatus` op and the arm rides an existing whole-sentence reader. `MATCH_RECORD_VERSION` STAYS 29.) 🆕🆕 D457 +2 sentences / +3 printings (THE BATCH ONTO ONE BODY — `censusAttackCorpus.ts` lines **403** and **412**, *"Search your deck for up to 2 Basic [{P} ]Energy cards and attach them to 1 of your [Benched ]Pokémon. Then, shuffle your deck."*, **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`. ⚠️ **ZERO NEW ANCHORS AND ZERO NEW READERS — surface unmoved at 13**: D235's `DECK_SEARCH_ATTACH` already MATCHED both sentences and refused them on one condition (`destination.batch || count === 1`), so what shipped is ONE new op FIELD, `attachFromDeck.oneTarget`, and the deletion of that condition. ⚠️ **THE SENTENCE AND PRINTING STEPS DISAGREE, 2 vs 3** — line 403 carries 2 printings and line 412 carries 1 — so a pass that copied one number into the other kind of site would be wrong in half of them (D451's lesson, re-paid a second time). ZERO new ops, `CardFilter` members, prompt KINDS, events, error codes or registry rows; ONE prompt FIELD (`attachCards.oneTarget`) and therefore NON-ZERO `packages/schema` and `redact.ts` bytes, which is what separates this slice from D456. 🛑 **`MATCH_RECORD_VERSION` STAYS 29** — the field reaches storage through a PARK, and an absent optional key on a parked prompt is what a v29 deploy already writes.) 🆕🆕 D452 +2 sentences / +2 printings (THE TWO PER-HEADS CONSEQUENTS THAT NEED NO PARK — `censusAttackCorpus.ts` lines **201** and **216**, **2 sentences / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through TWO new anchors and **ZERO new vocabulary**: both produce `programPerHeads` — shipped since D130 — carrying ops `deriveAttackEffect` already emits off the BARE sentence. ⚠️ **THE MECHANISM IS A PROGRAM REPEAT, NOT AN AMOUNT FOLD.** ZERO new readers — surface unmoved at **13**; `MATCH_RECORD_VERSION` **STAYS 29**.) // 🆕🆕🆕 D448 +2 sentences (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — *"This attack does {20|30} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply …)"* (corpus lines 552 and 570), **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` — an optional count clause taking group 3, which SHIFTED `ignoreWR` to 4 and the number word to 5, D447's index trap — over ONE new OPTIONAL `damageChosen` field `perEnergyOnSelf`. **ZERO new anchors, ZERO new readers, ZERO new ops, ZERO new `DamageCountSource` members, ZERO new `CardFilter` members, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes.** `MATCH_RECORD_VERSION` **STAYS 29** — the op PARKS, so its literal really is persisted at `phase.cont.pendingOp`, but a NEW OPTIONAL KEY whose ABSENCE means what it always meant is D125's widening and not D359's rename; driven over the SERIALIZED BYTES in three directions in `scaledAnySnipe.test.ts` §3. 🛑 **THE WORK ORDER'S PREMISE FAILED AND IS CORRECTED IN PLACE (D442): the snipe's amount has scaled since Wo-Chien "Covetous Ivy".** `snipeAmount` (interpreter.ts) is a SECOND, PARALLEL fold — `scaledAttackDamage`'s §8.5 fold reaches the DEFENDING Active only, speaks `DamageCountSource`, lives in a module that imports the interpreter and needs a `cost` `EffectContext` does not carry — so this slice gives an EXISTING fold its second inhabitant rather than building one. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` (16 units / 10 sentences), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence's only `. ` joiner precedes the W/R parenthetical, which `deriveAttackEffect` does not claim on its own, so `splitAttackTrailingClause` refused both at its TAIL test BEFORE the widening and refuses them at the SHADOW REFUSAL after it — D426's mechanism, two different refusals and one unmoved summand.) // 🆕🆕 D447 +3 sentences (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (*"This attack also does {10|40} damage to 1 of your Benched Pokémon. (Don't apply …)"*) and row 587 (*"This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply …)"*), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` (`(?:also )?` and a possessive CAPTURE) over ONE new `damageChosen.target` member `yourBench`. Reader SURFACE unmoved at 13.) // 🆕🆕 D445 +2 sentences / +5 printings: BOTH of the reveal compounds this slice claims are MULTI-CLAUSE (*"Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there."*, 3 printings, and *"Your opponent reveals their hand. Discard a card you find there."*, 2), and both are now CLAIMED WHOLE — so both cross into the shadow-refusal population this rung counts. 🛑 **THIS IS THE RUNG THAT MATTERS MOST FOR THIS SLICE**: row 675 is an EFFECT head with a DAMAGE tail, which is the exact MIRROR of `splitAttackTrailingClause`'s predicate, and the shadow refusal is what makes the two whole-sentence anchors — rather than an inverted splitter — the thing that owns it. The third sentence (corpus 564) is single-clause and is invisible here, which is why the step is 2 / 5 and not 3 / 6. // 🆕🆕 D437 +1 sentence: the printed W/R parenthetical makes it MULTI-CLAUSE, and this slice makes it CLAIMED WHOLE, which is exactly the shadow refusal this section is about (THE FILTERED BENCH SNIPE — *"This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` gaining a THIRD capture and ONE optional op field `damageChosen.damagedOnly`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader) and `REGISTRY_ATTACK_UNITS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES OF THE WIDENING: at D436's head `splitAttackTrailingClause` refused this sentence at its TAIL test — the only `. ` joiner in it precedes the W/R parenthetical, and `deriveAttackEffect` does not claim *"(Don't apply Weakness and Resistance for Benched Pokémon.)"* on its own — and after the widening it refuses at the SHADOW REFUSAL one line earlier, because a string a reader claims whole never reaches composition. Two different refusals, one unmoved summand: the printing arrives through the anchor and `COMPOUND_ATTACK_UNITS` stands still, D426's mechanism.) // 🆕🆕 D429 +2 (TWO of the three new pre-damage sentences are MULTI-CLAUSE — row 72 carries its cancel branch as a second printed sentence and row 74 its Paralyze consequent — and both are now claimed WHOLE by `deriveAttackPreDamage`, so both join the shadow-refusal population. Row 71 is single-clause and is NOT in this count, which is why the step is 2 where the resolution censuses move 3.) 🆕🆕 D425 155 → 158 / 432 → 437: all THREE own-side bench-spread sentences (*"This attack also does {10|20|30} damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*) are MULTI-CLAUSE — the W/R parenthetical is the second clause — and are now claimed WHOLE by `SPREAD_EACH_BENCH`, so they cross into this shadow-refusal population. ⚠️ **THE SPLITTER'S OWN UNITS DO NOT MOVE, AND THAT IS THE POINT OF COUNTING BOTH**: a sentence claimed WHOLE never reaches `splitAttackTrailingClause`, which is why `COMPOUND_ATTACK_UNITS` stands still while this figure steps by 3. `BUILT.attack` therefore gains RAW +5 and COMPOUND +0. 🆕🆕 D424 153 → 155: BOTH *"Flip a coin. If heads, …is now {X} and {Y}."* rows are multi-clause AND are now claimed WHOLE by `FLIP_DEFENDER_STATUS_PAIR`, so the shadow refusal gains two members. The BARE pair sentence is single-clause and is not here.
    // 🆕🆕 D458 +1 sentence / +2 printings — THE SECOND PRINTED NOUN
    // (`censusAttackCorpus.ts` line **410**, *"Search your deck for up to 2 Basic {G} Energy
    // cards **and up to 2 Basic {L} Energy cards** and attach them to your Pokémon in any way
    // you like. Then, shuffle your deck."*), claimed WHOLE by `deriveAttackEffect` through ONE
    // optional group on D235's existing anchor plus a second `attachFromDeck` op: ZERO new
    // anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS.
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DIFFER, 1 vs 2** — one sentence, two legal
    // printings — so a pass that copied one number into the other kind of site would be wrong
    // in half of them (D451).
    expect(units(claimedWhole)).toBe(508);  // (🆕🆕🆕 **D513 +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) 🆕🆕🆕 **D505 +3 printings — the same row, and the PRINTING step is 3 where the SENTENCE step one line up is 1 (D451). The `toBeNull()` loop below gains a member that was ALREADY null: the trailing splitter refuses it on its TAIL test, because `(Don't apply Weakness and Resistance for Benched Pokémon.)` is claimed by no reader — belt to a brace that was already fastened.** // 🆕🆕🆕 **D490 +2 printings — THE MILL OF BOTH DECKS: the sentence is MULTI-CLAUSE (a PERIOD joiner) AND claimed WHOLE, so it enters this population too. ⚠️ A census site is its PREDICATE, not its unit (D461) — and here the SENTENCE site above took +1 while this PRINTINGS site takes +2.** (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER; `censusAttackCorpus.ts` FILE LINE 138. ⚠️ THE TWO STEPS DISAGREE, 1 AND 2** — read the head name, not the neighbouring term.) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 printing on a multi-clause sentence claimed whole — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`; ZERO new `CardFilter` members, reader surface still **13**. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED at this head.) // (🆕🆕🆕 D483 +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) //🆕🆕 D476 +1 printing — THE FACE AXIS, `censusAttackCorpus.ts` **FILE LINE 217**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND ITS SENTENCE SIBLING IN THE SAME `it` THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.) 🆕🆕 D463 +2 printings (THE PER-HEADS ENERGY DISCARD — `censusAttackCorpus.ts` **file lines 200 and 234**, ONE legal printing each). 🛑 **BOTH ARE MULTI-CLAUSE AND BOTH ARE NOW CLAIMED WHOLE**, so this printings chain steps by the SAME 2 as its sentence sibling above — the two halves AGREE for this slice, which is the opposite of D460/D461/D462 and the one thing about it most likely to be copied wrongly. 🆕🆕 D460 +3 sentences / +4 printings (THE COIN-COUNT THRESHOLD — `censusAttackCorpus.ts` **file lines 213, 214 and 228**, **3 sentences / 4 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and the coin union's FIFTH member `perHeadsThenThreshold`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 3 vs 4.** ZERO new `EffectOp`s, op FIELDS, prompt fields, `packages/schema` bytes, `redact.ts` bytes or registry rows; the reader SURFACE stands still at 13 and the step arrives through the RAW summand ALONE.) 🆕🆕 D457 +2 sentences / +3 printings (THE BATCH ONTO ONE BODY — `censusAttackCorpus.ts` lines **403** and **412**, the two *"attach them to 1 of your [Benched ]Pokémon"* sentences, claimed WHOLE by `deriveAttackEffect` through D235's OWN anchor once `attachFromDeck.oneTarget` existed. ⚠️ BOTH are MULTI-CLAUSE — the printed *"Then, shuffle your deck."* — so they land in THIS population as well as in the resolving one, which is why this figure moves at all.) // 🆕🆕 D452 +2 sentences / +2 printings (THE TWO PER-HEADS CONSEQUENTS THAT NEED NO PARK — `censusAttackCorpus.ts` lines **201** and **216**, **2 sentences / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through TWO new anchors and **ZERO new vocabulary**. ⚠️ **THE MECHANISM IS A PROGRAM REPEAT, NOT AN AMOUNT FOLD.** Surface unmoved at **13**; `MATCH_RECORD_VERSION` **STAYS 29**.) // 🆕🆕🆕 D448 +3 printings (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — *"This attack does {20|30} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply …)"* (corpus lines 552 and 570), **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` — an optional count clause taking group 3, which SHIFTED `ignoreWR` to 4 and the number word to 5, D447's index trap — over ONE new OPTIONAL `damageChosen` field `perEnergyOnSelf`. **ZERO new anchors, ZERO new readers, ZERO new ops, ZERO new `DamageCountSource` members, ZERO new `CardFilter` members, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes.** `MATCH_RECORD_VERSION` **STAYS 29** — the op PARKS, so its literal really is persisted at `phase.cont.pendingOp`, but a NEW OPTIONAL KEY whose ABSENCE means what it always meant is D125's widening and not D359's rename; driven over the SERIALIZED BYTES in three directions in `scaledAnySnipe.test.ts` §3. 🛑 **THE WORK ORDER'S PREMISE FAILED AND IS CORRECTED IN PLACE (D442): the snipe's amount has scaled since Wo-Chien "Covetous Ivy".** `snipeAmount` (interpreter.ts) is a SECOND, PARALLEL fold — `scaledAttackDamage`'s §8.5 fold reaches the DEFENDING Active only, speaks `DamageCountSource`, lives in a module that imports the interpreter and needs a `cost` `EffectContext` does not carry — so this slice gives an EXISTING fold its second inhabitant rather than building one. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` (16 units / 10 sentences), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence's only `. ` joiner precedes the W/R parenthetical, which `deriveAttackEffect` does not claim on its own, so `splitAttackTrailingClause` refused both at its TAIL test BEFORE the widening and refuses them at the SHADOW REFUSAL after it — D426's mechanism, two different refusals and one unmoved summand.) // 🆕🆕 D447 +3 printings (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (own side, at 10 and 40) and 587 (the BARE opponent-side wording), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` over ONE new `damageChosen.target` member `yourBench`.) // 🆕🆕 D445 +2 sentences / +5 printings: BOTH of the reveal compounds this slice claims are MULTI-CLAUSE (*"Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there."*, 3 printings, and *"Your opponent reveals their hand. Discard a card you find there."*, 2), and both are now CLAIMED WHOLE — so both cross into the shadow-refusal population this rung counts. 🛑 **THIS IS THE RUNG THAT MATTERS MOST FOR THIS SLICE**: row 675 is an EFFECT head with a DAMAGE tail, which is the exact MIRROR of `splitAttackTrailingClause`'s predicate, and the shadow refusal is what makes the two whole-sentence anchors — rather than an inverted splitter — the thing that owns it. The third sentence (corpus 564) is single-clause and is invisible here, which is why the step is 2 / 5 and not 3 / 6. // 🆕🆕 D437 +3 printings: the sentence is MULTI-CLAUSE (its W/R parenthetical is a second printed clause) and this slice makes it CLAIMED WHOLE, so it joins the shadow-refusal population rather than the composed one (THE FILTERED BENCH SNIPE — *"This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` gaining a THIRD capture and ONE optional op field `damageChosen.damagedOnly`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader) and `REGISTRY_ATTACK_UNITS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES OF THE WIDENING: at D436's head `splitAttackTrailingClause` refused this sentence at its TAIL test — the only `. ` joiner in it precedes the W/R parenthetical, and `deriveAttackEffect` does not claim *"(Don't apply Weakness and Resistance for Benched Pokémon.)"* on its own — and after the widening it refuses at the SHADOW REFUSAL one line earlier, because a string a reader claims whole never reaches composition. Two different refusals, one unmoved summand: the printing arrives through the anchor and `COMPOUND_ATTACK_UNITS` stands still, D426's mechanism.) // 🆕🆕 D429 +2 printings (1 each, rows 72 and 74). 🆕🆕 D425 +5 printings (10 ×3, 20 ×1, 30 ×1). 🆕🆕 D424 +2 printings (1 each). // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
    for (const [, s] of claimedWhole) expect(splitAttackTrailingClause(s), s).toBeNull();
  });

  it("an UNREADABLE tail refuses the whole compound — the cost never ships alone", () => {
    // The family's safety property, spelled per clause. The head here is a sentence
    // `deriveAttackDamageBonus` claims and the tail is an old-era phrasing NO
    // reader claims, so the compound stays LOUD in full. A prefix match would fold
    // the +50 and silently drop the rider.
    const head = "This attack does 50 more damage for each Prize card your opponent has taken.";
    const unreadable = "The Defending Pokémon is now Asleep.";
    expect(claimedByAny(unreadable)).toBe(false);
    expect(claimedByAny(head)).toBe(true);
    expect(splitAttackTrailingClause(`${head} ${unreadable}`)).toBeNull();
  });

  it("🛑 a tail claimed only by a DAMAGE reader refuses — the fold has nowhere to go", () => {
    // 🛑 THE MIRROR OF THE RUNG ABOVE, AND IT IS A RULE RATHER THAN A CATALOG FACT.
    // The tail guard names `deriveAttackEffect` SPECIFICALLY, not "any reader", and
    // the reason is structural: the five damage readers are all given the HEAD, so
    // a trailing clause only THEY claim would be accounted for by the splitter and
    // then applied by nobody — the cost-without-the-payoff failure, arriving
    // through the guard meant to prevent it.
    //
    // ⚠️ WRITTEN BECAUSE THE MUTANT SURVIVED WITHOUT IT. Widening that guard to
    // `claimedByAnyReader(tail)` changes NOTHING on the committed column — the
    // printed compounds all put the damage clause FIRST — so every census rung in
    // this file stayed green on a splitter that would silently swallow a trailing
    // fold. The catalog cannot discriminate this; a synthetic compound built from
    // two PRINTED sentences in the other order can, and does.
    const head = "Discard an Energy from this Pokémon.";
    const tail = "This attack does 50 more damage for each Prize card your opponent has taken.";
    // Both halves are real printed clauses of the column, in the order the catalog
    // does not currently print them. ⚠️ NAMED PRECISELY (D400): the HEAD is a
    // standalone printing, and the TAIL is not — it is the LEADING clause of the
    // two Prize compounds this slice takes, which is exactly why the order matters
    // and why the catalog cannot tell these two guards apart on its own.
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(printed.has(head)).toBe(true);
    expect(printed.has(tail)).toBe(false);
    expect(PRIZE_THEN_DISCARD.startsWith(`${tail} `)).toBe(true);
    expect(PRIZE_THEN_RECOIL.startsWith(`${tail} `)).toBe(true);
    // The tail IS claimed — by the bonus reader — and is NOT an effect clause.
    expect(claimedByAny(tail)).toBe(true);
    expect(deriveAttackEffect(tail)).toBeNull();
    expect(claimedByAny(`${head} ${tail}`)).toBe(false);
    expect(splitAttackTrailingClause(`${head} ${tail}`)).toBeNull();
  });

  it("an unreadable HEAD refuses too, and a single sentence is never split", () => {
    const readableTail = "Discard an Energy from this Pokémon.";
    expect(splitAttackTrailingClause(`The Defending Pokémon is now Asleep. ${readableTail}`)).toBeNull();
    expect(splitAttackTrailingClause(readableTail)).toBeNull();
    expect(splitAttackTrailingClause("")).toBeNull();
  });
});

describe("§5 — the two SHIPPED twins: composition and anchor must agree byte for byte", () => {
  it("🛑 the poison compound composes into `DEFENDER_POISON_CANT_RETREAT`'s program", () => {
    // 🛑 THE STRONGEST RUNG IN THIS FILE, AND IT ANSWERS THE HANDOFF'S THIRD
    // QUESTION. The column prints this rule with TWO noun phrases — "that Pokémon"
    // (arm 5c, shipped since D120) and "the Defending Pokémon" (this slice). The
    // question was whether to take the second by widening 5c's character class or
    // by the splitter, and the answer is the splitter BECAUSE THIS EQUALITY IS
    // CHECKABLE: widening 5c would have produced one program from one regex and
    // proved nothing, while composing the halves and comparing against the shipped
    // anchor is a claim that can go RED from either side. Change either arm and the
    // two programs diverge.
    const anchored = ops(POISON_THEN_NO_RETREAT_ANCHORED);
    expect(anchored).not.toBeNull();
    const split = splitAttackTrailingClause(POISON_THEN_NO_RETREAT);
    expect(split).not.toBeNull();
    const composed = [
      ...(ops((split as { head: string }).head) ?? []),
      ...(ops((split as { tail: string }).tail) ?? []),
    ];
    expect(composed).toEqual(anchored);
    expect(composed).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
  });

  it("🛑 the 2-Energy reduction composes into `SELF_DISCARD_ALL_THEN_REDUCTION`'s shape", () => {
    // The SECOND twin, one token over on the other axis: the shipped anchor reads
    // the "all" count and this slice's compound reads "2". Everything but `count`
    // must be identical, which is a sharper claim than "both are two ops" — it says
    // the composition reuses the SAME two producers rather than resembling them.
    const anchored = ops(DISCARD_ALL_THEN_REDUCTION_ANCHORED);
    const split = splitAttackTrailingClause(DISCARD_TWO_THEN_REDUCTION);
    expect(split).not.toBeNull();
    const composed = [
      ...(ops((split as { head: string }).head) ?? []),
      ...(ops((split as { tail: string }).tail) ?? []),
    ];
    expect(composed).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      { op: "reduceDamage", amount: 100 },
    ]);
    expect(anchored).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    // The second op is byte-identical across the two routes; only `count` differs.
    expect(composed[1]).toEqual((anchored as EffectOp[])[1]);
  });

  it("🛑 D410 — the ANCHOR still wins the poison compound, and the two routes now genuinely overlap", () => {
    // 🛑 THE RUNG THIS SLICE PUTS THE SHADOW REFUSAL UNDER REAL LOAD WITH. Until
    // D410, `POISON_THEN_NO_RETREAT_ANCHORED` was refused by the splitter for a
    // BORING reason — its tail was a clause no reader claimed — so the refusal was
    // never the thing doing the work. Adding arm 5d makes that tail readable, so
    // the sentence is now splittable in every respect EXCEPT the shadow refusal,
    // which is the only thing left standing between it and a second route.
    //
    // ⚠️ A NEAR-MISS THE PREDICATE ALREADY REFUSES FOR ANOTHER REASON PROVES
    // NOTHING ABOUT THE GUARD AROUND IT (D399's rule). So both halves are asserted:
    // the refusal fires, AND the composition it suppresses would have produced
    // exactly 5c's program. If those two ever disagree, the anchor and the arm have
    // drifted apart and this rung is the only thing that can say so.
    expect(claimedByAny(POISON_THEN_NO_RETREAT_ANCHORED)).toBe(true);
    expect(splitAttackTrailingClause(POISON_THEN_NO_RETREAT_ANCHORED)).toBeNull();
    const parts = POISON_THEN_NO_RETREAT_ANCHORED.split(BREAK);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe(PRONOUN_LOCK);
    const wouldCompose = [...(ops(parts[0] as string) ?? []), ...(ops(parts[1] as string) ?? [])];
    expect(wouldCompose).toEqual(ops(POISON_THEN_NO_RETREAT_ANCHORED));
    expect(wouldCompose).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
  });

  it("🛑 D410 — one clause, two compounds: Burned and Confused compose into the SAME tail op", () => {
    // The claim the price argument rests on: ONE anchor bought BOTH printings pairs.
    // Asserted as "the two programs differ in exactly the status and nothing else",
    // which is sharper than "both are two ops" — it says the composition reuses the
    // same producer for the tail rather than resembling it.
    const compose = (text: string): EffectOp[] => {
      const split = splitAttackTrailingClause(text);
      if (split === null) throw new Error(`refused: ${text}`);
      return [...(ops(split.head) ?? []), ...(ops(split.tail) ?? [])];
    };
    expect(compose(BURN_THEN_NO_RETREAT)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "preventRetreat" },
    ]);
    expect(compose(CONFUSE_THEN_NO_RETREAT)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "preventRetreat" },
    ]);
    // The TAIL op is byte-identical across all three carriers — the two composed
    // ones and the shipped anchor — which is the "one clause" claim itself.
    const tailOf = (program: EffectOp[]): EffectOp | undefined => program[1];
    expect(tailOf(compose(BURN_THEN_NO_RETREAT))).toEqual({ op: "preventRetreat" });
    expect(tailOf(compose(CONFUSE_THEN_NO_RETREAT))).toEqual(
      tailOf(compose(BURN_THEN_NO_RETREAT)),
    );
    expect(tailOf(ops(POISON_THEN_NO_RETREAT_ANCHORED) as EffectOp[])).toEqual(
      tailOf(compose(BURN_THEN_NO_RETREAT)),
    );
  });

  it("the other three compose into their two clauses' own ops, in PRINTED order", () => {
    const compose = (text: string): EffectOp[] => {
      const split = splitAttackTrailingClause(text);
      if (split === null) throw new Error(`refused: ${text}`);
      return [...(ops(split.head) ?? []), ...(ops(split.tail) ?? [])];
    };
    expect(compose(DISCARD_ALL_THEN_PARALYZE)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "applyStatus", target: "defender", status: "paralyzed" },
    ]);
    // The two Prize compounds have a head `deriveAttackEffect` REFUSES (it is a
    // damage-bonus clause), so the composed op list is the TAIL alone — the fold
    // lives in `attack.ts`'s `damageBonus` local, and §6 is where the two halves
    // are seen together.
    expect(compose(PRIZE_THEN_DISCARD)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(compose(PRIZE_THEN_RECOIL)).toEqual([{ op: "damageSelf", amount: 30 }]);
  });
});

describe("§6 — the BOARDS: a fold and an op off ONE printed string", () => {
  it("🛑 the Prize compound folds the +50/Prize AND discards the Energy", () => {
    // 🛑 THE CASE THE WHOLE SLICE IS FOR. One printed string, two readers, two
    // effects on one board: p2 has taken 2 Prizes → 50 × 2 = 100 folded onto the
    // printed base 40 → 140, and the trailing clause then discards one of the
    // attacker's Energy. Before this slice NEITHER happened — the compound was
    // refused whole and the attack was reported ATTACK_EFFECT_SKIPPED with its "+"
    // unexplained. Revert the rebind at `attack.ts`'s `compoundSplit` and the fold
    // disappears; revert the `derivedTail` concatenation and the discard does.
    let state = board(SEED, { energy: 3 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const energyBefore = state.players.p1.active?.energy.length ?? 0;
    expect(energyBefore).toBe(3);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PRIZE_DISCARD_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
    // The tail ran: one Energy off the attacker, into its own discard pile.
    expect(after.players.p1.active?.energy.length).toBe(2);
    expect(find(events, "ENERGY_DISCARDED")).toBeDefined();
  });

  it("the recoil twin folds the same 100 and then hits ITSELF for 30", () => {
    // The second cross-reader compound: same head, a different trailing op, and the
    // self-damage lands AFTER the fold rather than being folded into it.
    let state = board(SEED + 1, { energy: 1 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PRIZE_RECOIL_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("the head alone is UNMOVED — `fix-attacker`'s 'Bounty' still reads as it always did", () => {
    // ⚠️ D214's ATTRIBUTION CONTROL. "Bounty" prints the LEADING clause of the two
    // Prize compounds ALONE, so it is claimed WHOLE by `deriveAttackDamageBonus`
    // and the splitter never sees it. If the rebind had changed what the damage
    // readers are given on an ordinary single-sentence printing, this case is where
    // it would show — 629 of the 640 sentences take that path.
    let state = must(
      applyAction(
        driveSetup(
          SEED + 2,
          { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p2", "fix-compound");
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 5 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
  });

  it("the status compound discards ALL Energy and then Paralyzes the defender", () => {
    const state = board(SEED + 3, { energy: 2 });
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PARALYZE_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(after.players.p1.active?.energy).toEqual([]);
    expect(after.players.p2.active?.conditions.rotation).toBe("paralyzed");
  });

  it("the poison compound and its SHIPPED twin leave the SAME board", () => {
    // The §5 program equality, driven to a board: two attacks on one fixture, one
    // read by the composition path and one by arm 5c, and the two states agree on
    // both halves of the rule.
    const viaSplit = mustApply(board(SEED + 4, { energy: 2 }), {
      type: "attack",
      seat: "p1",
      index: POISON_INDEX,
    }).state;
    const viaAnchor = mustApply(board(SEED + 4, { energy: 2 }), {
      type: "attack",
      seat: "p1",
      index: POISON_ANCHORED_INDEX,
    }).state;
    expect(viaSplit.players.p2.active?.conditions.poisonDamage).toBe(10);
    expect(viaSplit.players.p2.active?.conditions.poisonDamage).toBe(
      viaAnchor.players.p2.active?.conditions.poisonDamage,
    );
    expect(viaSplit.players.p2.active?.retreatBlocked).toBe(
      viaAnchor.players.p2.active?.retreatBlocked,
    );
    expect(viaSplit.players.p2.active?.retreatBlocked).toBe(true);
  });

  it("🛑 D410 — the Burned compound Burns AND locks the retreat, off ONE printed string", () => {
    // 🛑 THE CASE THE SLICE IS FOR, ON A BOARD. Neither half happened before this
    // slice: `deriveAttackEffect` refused the whole string, so the attack was
    // reported on the loud ATTACK_EFFECT_SKIPPED path with the Burn AND the lock
    // both invisible. Both halves are asserted, and the SKIP is asserted absent —
    // a build that resolved the head alone would satisfy the Burn and leave the
    // lock silently unbuilt, which is the direction this family refuses.
    const { state: after, events } = mustApply(board(SEED + 7, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: BURN_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(after.players.p2.active?.retreatBlocked).toBe(true);
    // …and the printed damage still landed, so the composition did not eat the §8.5
    // pipeline on its way past.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(find(events, "RETREAT_BLOCKED")?.seat).toBe("p2");
    // 🛑 AND THE BURN IS ASSERTED THROUGH ITS §12 TICK RATHER THAN THROUGH THE FLAG
    // ON THE BODY, WHICH IS A FACT THIS SLICE MEASURED RATHER THAN A STYLE CHOICE.
    // The attack ENDS THE TURN, so the Checkup runs inside this one `applyAction`:
    // Burn places 20 counters and then flips to cure (§13.2), and on this seed the
    // flip is HEADS — so `conditions.burned` reads FALSE afterwards even though the
    // op ran perfectly. The counters are the flip-independent witness. ⚠️ THIS IS
    // ALSO WHY THE FILE'S "SEED-FREE" HEADER NOTE NO LONGER COVERS EVERY MEMBER:
    // none of the SEVEN compounds carries a coin, but the Burned one's board
    // outcome passes through the CHECKUP's coin, which belongs to §13 and not here.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      source: "burn",
      amount: 20,
    });
  });

  it("🛑 D410 — the Confused twin differs in the STATUS and in nothing else", () => {
    // The pair, driven. One clause completes both compounds, so the two boards must
    // agree on the lock and disagree only on the rotation status — which is a
    // stronger claim than either board alone, and the one a second hand-written
    // anchor could have got wrong without any assertion noticing.
    const burnedRun = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: BURN_INDEX,
    });
    const confusedRun = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: CONFUSE_INDEX,
    });
    const burned = burnedRun.state;
    const confused = confusedRun.state;
    // 🛑 THE BURN IS READ OFF ITS §12 WITNESS, NOT OFF THE FLAG — the test one above
    // measured why, and this twin is the case that would have hidden it. The attack
    // ENDS THE TURN, so §13.2's cure flip runs inside this same `applyAction`, and on
    // THIS seed it comes up heads: `conditions.burned` reads FALSE on a board where
    // the op ran perfectly. Asserting the flag here would have made the rung a
    // reading of the RNG rather than of the composition — which is exactly what it
    // did before this line was written, and the only reason the suite went red.
    // The STATUS event and the counters are flip-independent; the rotation is too,
    // because Confusion carries no Checkup coin.
    expect(find(burnedRun.events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      status: "burned",
    });
    expect(find(burnedRun.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      source: "burn",
    });
    expect(find(confusedRun.events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      status: "confused",
    });
    expect(find(confusedRun.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(confused.players.p2.active?.conditions.rotation).toBe("confused");
    expect(confused.players.p2.active?.conditions.burned).toBe(false);
    expect(burned.players.p2.active?.conditions.rotation).toBe("none");
    // The half they share.
    expect(confused.players.p2.active?.retreatBlocked).toBe(true);
    expect(confused.players.p2.active?.retreatBlocked).toBe(
      burned.players.p2.active?.retreatBlocked,
    );
    // …and it is the SAME half the shipped anchor installs at index 5.
    const anchored = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: POISON_ANCHORED_INDEX,
    }).state;
    expect(anchored.players.p2.active?.retreatBlocked).toBe(
      burned.players.p2.active?.retreatBlocked,
    );
  });

  it("🛑 the UNREADABLE tail keeps the whole compound LOUD, fold and all", () => {
    // The refusal, on a board. `fix-compound` index 6 prints the same +50/Prize head
    // with an old-era trailing sentence no reader claims, so nothing is folded and
    // nothing is applied — the printed "+" is reported unexplained beside the whole
    // string. This is the direction a "too loose" split fails in, and the case that
    // makes §4's unit refusal a fact about the engine rather than about a function.
    let state = board(SEED + 5, { energy: 1 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: UNREAD_TAIL_INDEX,
    });
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Prize Riddle",
      damageModifier: "+",
    });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.dealt).toBe(40);
  });
});

describe("§7 — the persisted question, asked and DRIVEN", () => {
  it("🛑 the TAIL rides `EffectContinuation.rest` across a park", () => {
    // 🛑 THE ONE PLACE THIS SLICE REACHES A SAVED RECORD, AND IT IS DRIVEN RATHER
    // THAN ARGUED. `discardEnergy` PARKS when the choice is real, so on the
    // 2-Energy compound the trailing `reduceDamage` is still unrun when the state is
    // handed back — it rides `phase.cont.rest`, which is persisted. That is a fact
    // about the field, so the question is whether `rest` can already carry it, and
    // it can: `SELF_DISCARD_ALL_THEN_REDUCTION` has shipped the SAME two ops in the
    // same order since 0.x, so a v25 record could already hold exactly this
    // continuation. Composition put nothing new into one.
    // ⚠️ TWO {C} AND ONE {R}, NOT THREE {C}. `interchangeableCandidates` collapses
    // identical Energy and `forcedDiscards` then takes the set inline, so three
    // identical {C} produce NO continuation at all — the park this rung inspects
    // only exists when the pick is a real decision. Measured, not assumed: the
    // three-identical board resolves to `turn:action` with both ops already run.
    let state = attachFromDeck(board(SEED + 6, { energy: 2 }), "p1", "fix-fire-energy", 1);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REDUCTION_INDEX,
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("discardEnergy");
    // THE ASSERTION THE SLICE OWES: the trailing clause's op is in `rest`.
    expect(parked.phase.cont.rest).toEqual([{ op: "reduceDamage", amount: 100 }]);
    expect(parked.phase.cont.pendingOp).toMatchObject({ op: "discardEnergy", count: 2 });
    // …and resuming runs it: two Energy gone AND the reduction installed.
    const uids = (parked.players.p1.active?.energy ?? []).slice(0, 2);
    expect(uids).toHaveLength(2);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).toHaveLength(1);
    expect(done.players.p1.active?.damageReduction).toBeDefined();
    state = done;
    expect(state.players.p1.active?.damageReduction?.amount).toBe(100);
  });

  it("MATCH_RECORD_VERSION stays 25 — every op composed is one a v25 record held", () => {
    // ⚠️ NOT AN EXPORTED CONSTANT (D406), so the claim is DRIVEN. The composition
    // introduces no `EffectOp` inhabitant and no field: every op the five compounds
    // produce is already produced today by the SAME clause read alone, and the only
    // one that parks (`discardEnergy`) already rides a continuation whose `rest` a
    // shipped anchor fills with the very same `reduceDamage`.
    for (const text of COMPOUNDS) {
      const split = splitAttackTrailingClause(text);
      expect(split, text).not.toBeNull();
      const parts = text.split(BREAK);
      expect(ops((split as { tail: string }).tail)).toEqual(ops(parts[1] as string));
      const headOps = ops((split as { head: string }).head);
      expect(headOps).toEqual(ops(parts[0] as string));
    }
  });

  it("the engine version moved with the behaviour", () => {
    // 🆕🆕 D416 — 0.319.0 → **0.320.0**, moved with the behaviour: THE PARKING KO PAIR (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2 printings — **2 sentences / 6 printings**, both claimed WHOLE by `deriveAttackEffect`) is a WIDENING — ONE new PARKING `EffectOp` (`knockOutChosen`, required `target` plus two optional riders) reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep, ZERO new persisted record fields — so the engine version moves and `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads).
    // 🆕🆕 D417 — 0.320.0 → **0.321.0**, moved with the behaviour: THE TRAILING CANCEL (*"Discard a Stadium in play. If you can't, this attack does nothing."*, Eternatus `sv08-141`, **1 legal printing**) gains a TWELFTH whole-sentence reader, `deriveAttackCancelRequirement` — the anaphoric cancel `deriveAttackRequirement`'s leading `^If` could never see. `MATCH_RECORD_VERSION` **STAYS 26**, asked rather than assumed: the reader returns an EXISTING `BoardCondition` through the EXISTING requirement channel and adds NO persisted field, so no v26 record gains a shape this deploy would not already read.
    expect(engineVersion).toBe("0.400.0");
  });
});

describe("§8 — the fixture IS the deck, and the deck is 60", () => {
  it("`fix-compound` prints the nine compounds at the indices this suite names", () => {
    const card = FIXTURE_POOL["fix-compound"];
    expect(card).toBeDefined();
    expect(card?.stage).toBe("Basic");
    expect(card?.hp).toBe(340);
    expect(card?.attacks).toHaveLength(11);
    const effectAt = (i: number): string => card?.attacks?.[i]?.effect ?? "";
    expect(effectAt(PRIZE_DISCARD_INDEX)).toBe(PRIZE_THEN_DISCARD);
    expect(effectAt(PRIZE_RECOIL_INDEX)).toBe(PRIZE_THEN_RECOIL);
    expect(effectAt(REDUCTION_INDEX)).toBe(DISCARD_TWO_THEN_REDUCTION);
    expect(effectAt(PARALYZE_INDEX)).toBe(DISCARD_ALL_THEN_PARALYZE);
    expect(effectAt(POISON_INDEX)).toBe(POISON_THEN_NO_RETREAT);
    expect(effectAt(POISON_ANCHORED_INDEX)).toBe(POISON_THEN_NO_RETREAT_ANCHORED);
    expect(effectAt(HEAL_50_SELF_LOCK_INDEX)).toBe(HEAL_50_THEN_SELF_LOCK);
    expect(effectAt(HEAL_60_SELF_LOCK_INDEX)).toBe(HEAL_60_THEN_SELF_LOCK);
    expect(effectAt(BURN_INDEX)).toBe(BURN_THEN_NO_RETREAT);
    expect(effectAt(CONFUSE_INDEX)).toBe(CONFUSE_THEN_NO_RETREAT);
    // …and every one of the seven is a sentence the COLUMN prints, byte for byte.
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const s of COMPOUNDS) expect(printed.has(s), s).toBe(true);
    expect(printed.has(POISON_THEN_NO_RETREAT_ANCHORED)).toBe(true);
    // 🛑 AND THE OTHER TWIN IS *NOT* IN THIS COLUMN, WHICH IS A RESULT RATHER THAN
    // AN OVERSIGHT — NAMED AS EMPTY (D400). `SELF_DISCARD_ALL_THEN_REDUCTION` was
    // measured against the SIX-SET local D1 (978 cards / 6 sets) and its printing is
    // not `legal_standard = 1` today, while its "Discard 2" twin — the one this
    // slice composes — IS. Two populations, two answers, and the anchor is still
    // right about its own. §5 compares the two ROUTES rather than their legality.
    expect(printed.has(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).toBe(false);
    expect(deriveAttackEffect(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).not.toBeNull();
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(COMPOUND_COMPOSE_DECK).toHaveLength(60);
    for (const id of new Set(COMPOUND_COMPOSE_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
