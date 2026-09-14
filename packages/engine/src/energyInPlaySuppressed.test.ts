import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion, logFromEvents } from "./index";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D494 — THE CONDITIONAL BONUS WITH ITS PRINTED WEAKNESS-ONLY SUPPRESSION
// RIDER: `censusAttackCorpus.ts` FILE LINE 337, 1 sentence / 1 legal printing.
//
//   "If you have 3 or more Energy in play, this attack does 70 more damage. This
//    attack's damage isn't affected by Weakness."
//
// 🛑 **THREE AXES, COUNTED FROM THE PRINT, AND THE LATTICE SAYS NO PROPER SUBSET
// BUILDS.** The nearest BUILT spelling is corpus file line 341 — *"If you have at
// least 3 {D} Energy in play, this attack does 50 more damage."* — and the print
// differs from it on QUANTIFIER (`3 or more` / `at least 3`), on TYPE (untyped /
// `{D}`) and on TAIL (present / absent). ⚠️ **A FOURTH CANDIDATE AXIS WAS MEASURED
// AND IS DEGENERATE (D491)**: the printed AMOUNT (70 against 341's 50) is a capture
// on the shipped anchor, so its printed value already builds and it cannot move the
// verdict. §3 runs the 2 × 2 × 3 lattice over all thirteen readers and exactly one
// of its twelve points builds — the all-three substitution, which IS line 341.
//
// 🛑 **THE TAIL AXIS IS THREE-VALUED, AND THAT IS THE "one more" THE BRIEF ASKED
// FOR.** `This attack's damage isn't affected by Weakness.` is refused by all
// thirteen readers standing alone; its nearest BUILT sibling is the `Weakness or
// Resistance` spelling (corpus file line 627, 2 printings, `DAMAGE_SUPPRESSION`
// arm 2). So the tail is not merely present-or-absent — it is present at a SCOPE
// the vocabulary does not have, which is exactly the blocker D493 measured on the
// only other row printing the same clause.
//
// 🛑 **EVERY BRANCH FREES 0 / 0 ALONE, SO THE FORK WAS NEVER A FORK** (D493's
// rule). Measured over all 640 corpus rows in §3:
//
//   • the QUANTIFIER alone (`N or more ⟨typed⟩ Energy in play`)         0s / 0p
//   • the TYPE alone (`at least N Energy in play`, untyped)             0s / 0p
//   • QUANTIFIER + TYPE — the printed HEAD as a standalone sentence     0s / 0p
//   • the TAIL alone (the bare clause as a `DAMAGE_SUPPRESSION` arm)    0s / 0p
//   • the COMPOSITION seam (a suppression tail on the trailing split)   0s / 0p
//   • ALL OF THEM — which is one whole-sentence anchor                  1s / 1p
//
// 🛑 **AND THE COMPOSITION SEAM IS AN ARMED MUTANT, FOR THE SECOND SLICE RUNNING.**
// The pre-build tripwire audit over all 2,379 corpus rows found
// `D409-tail-guard-widened-to-any-reader`, whose `replace` is
// `if (!claimedByAnyReader(tail)) return null;` — byte for byte that widening — and
// whose `what` names the defect it ships. Building it would have disarmed the
// tripwire that describes it (D436's GAP), and it would have bought nothing.
//
// ⚠️ **D493's IDIOM TRANSFERS, AND IT WAS TRACED RATHER THAN ASSUMED.** D493 put two
// readers on one string because `attack.ts` hands the same `effect` to all five
// damage readers. That file's `damageBonus` binding and its `damageSuppression`
// binding both read that identical local, and the suppression is DELIBERATELY not
// chained onto the `damageBonus !== null` ladder — its own block calls that "the one
// placement decision here". So this sentence costs ONE constant, ONE clause row and
// ZERO bytes in `attack.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence and its two halves. ⚠️ NOT retyped: §1 asserts the whole
    string is a row of `legalAttackCorpus()` and reads its printing count off the
    corpus (D452/D490 — a byte pin measures an invention as faithfully as the truth). */
const PRINTED =
  "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.";
const HEAD = "If you have 3 or more Energy in play, this attack does 70 more damage.";
const TAIL = "This attack's damage isn't affected by Weakness.";
/** The nearest BUILT spelling — corpus file line 341, the row the lattice substitutes
    onto. Asserted to be a corpus row in §1 for the same reason `PRINTED` is. */
const BUILT_SIBLING = "If you have at least 3 {D} Energy in play, this attack does 50 more damage.";
/** The printed clause this slice teaches `boardConditionForClause`, and its shipped
    neighbour. Both are read off the sentences above rather than retyped. */
const CLAUSE = "you have 3 or more Energy in play";

/** U+2019, spelled as an escape (`clauseApostrophe.test.ts`'s idiom). The printed row
    carries TWO straight apostrophes — `attack's` and `isn't` — and both are the
    pattern's own `['’]` classes; the head half carries none. */
const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

// ── THE FIXTURE — a file-local `cardPool` (D414/D452), so `FIXTURE_POOL` is untouched
// and every id ladder in the repo takes a ZERO term. Card ids are UNRESOLVABLE in this
// checkout (no D1), so they are synthetic and say so rather than being invented (D425).
const ATTACKER = "d494-attacker";
const RESERVE = "d494-reserve";
const WALL = "d494-wall";
const WATER = "d494-water";
const DARK = "d494-dark";

const LOCAL_CARDS: Record<string, Card> = {
  /** WATER, because the wall's Weakness and its Resistance are both keyed on the
      ATTACKER's type and the whole point of the board is that those two are
      separately observable. The cost is ONE `Colorless` so any single Energy pays it
      and the §6.4 check never becomes the thing under test. */
  [ATTACKER]: battler(ATTACKER, {
    name: "D494 Threshold Drake",
    hp: 200,
    types: ["Water"],
    attacks: [{ cost: ["Colorless"], name: "Surging Reserve", damage: "100+", effect: PRINTED }],
  }),
  /** A plain BENCHED body, and it is the ZONE axis rather than scenery: the printed
      noun is "in play" (§6.3 — Active **plus** Bench), so the wrong build this family
      invites is `countAttachedEnergy` on the declaring body alone. That walk answers 1
      on the board below where the printed one answers 3. */
  [RESERVE]: battler(RESERVE, { name: "D494 Reserve", hp: 90 }),
  /** ×2 Water Weakness **and** −30 Water Resistance off one body — `fix-weak-tough`'s
      shape, SYNTHETIC for the reason that fixture states: joining `weaknesses_json`
      against `resistances_json` on `$.type` over all 3,786 D1 rows returns ZERO cards.
      It is the only board on which `{ weakness }` and `{ weakness, resistance }`
      answer different numbers. HP 400 so every candidate reading lands short of a
      Knock Out and the §8.1 clamp is never the thing being measured. */
  [WALL]: battler(WALL, {
    name: "D494 Wall",
    hp: 400,
    weaknesses: [{ type: "Water", value: "×2" }],
    resistances: [{ type: "Water", value: "-30" }],
  }),
  [WATER]: typedEnergy(WATER, "Water"),
  /** The TYPE axis's control. With 2 {W} and 1 {D} in play, the untyped count is 3 and
      **every** typed count is below the printed threshold — `{W}` reads 2, `{D}` reads
      1 — so a build that kept `energy` narrowed answers 0 on this board whatever type
      it narrowed to. A single-type board could not say that (D448: when the claim is
      "count X regardless of Y", the board must contain a Y that differs). */
  [DARK]: typedEnergy(DARK, "Darkness"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const DECK = deckOf({
  [ATTACKER]: 4,
  [RESERVE]: 8,
  [WALL]: 4,
  [WATER]: 32,
  [DARK]: 12,
});

/** Three seeds, so no claim below rests on one shuffle (D270). Every body and every
    Energy is placed by surgery, so the seed only decides which physical copies move. */
const SEEDS = [4940, 4941, 4943] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** `benchCounterSuppressed.test.ts`'s `localSetup`, verbatim in shape: `driveSetup`
    builds its game through `mustCreate`, which reads `FIXTURE_POOL`, so a local pool
    needs its own drive. p2 opens and passes, so p1 carries no §4 first-turn bar. */
function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** 🛑 **THE BOARD, AND EVERY NUMBER ON IT IS A MEASUREMENT RATHER THAN A CONVENIENCE**
    (D482/D485/D488: compute what each candidate implementation answers BEFORE choosing
    the board). `opponentEnergy` and `benchDark` are the two knobs the three boards
    below turn; everything else is fixed.
 *
 *     p1                                          p2
 *       Active  D494 Threshold Drake  1 × {W}       D494 Wall (Water ×2 / Water −30)
 *       Bench   D494 Reserve          1 × {W}         + `opponentEnergy` × {W}
 *                                     + {D} if `benchDark`
 *
 *   The printed clause is `yourEnergyInPlayAtLeast { energy: null, count: 3 }` — the
 *   attacker's OWN side, Active **plus** Bench (§6.3 "in play"), counting Energy
 *   CARDS with no type asked. On the DEFAULT board (`benchDark`, `opponentEnergy: 0`)
 *   the printed count is **3**, and every wrong reading answers something else:
 *
 *     • the ACTIVE alone (`countAttachedEnergy` on the declaring body)   1  → fails
 *     • the BENCH alone                                                  2  → fails
 *     • narrowed to `{W}`                                                2  → fails
 *     • narrowed to `{D}`                                                1  → fails
 *     • the OPPONENT's side                                              0  → fails
 *     • a STRICT `>` instead of the printed floor                     3 > 3 → fails
 *
 *   …so the bonus is 70 under the printed reading and 0 under all six, and the printed
 *   base of 100 turns that into a pre-§8.5 figure of **170** against **100**. §8.5
 *   then separates the four suppression readings off that same 170:
 *
 *     • `{ weakness }`             — the printed answer   170     − 30 = **140**
 *     • `{ weakness, resistance }` — the sibling arm      170            = **170**
 *     • no suppression at all      — the rider dropped    170 × 2 − 30 = **310**
 *     • `{ resistance }`           — the wrong boolean    170 × 2      = **340**
 *
 *   🛑 **THE FIRST TWO ARE THE POINT OF THE WHOLE FIXTURE.** They are the only pair a
 *   printed board cannot separate — no D1 card lists one type in both the Weakness and
 *   the Resistance column — and they are what makes `AttackDamageSuppression.weakness`
 *   a field rather than half of `resistance` (D192's own argument, whose SECOND solo
 *   inhabitant this row is).
 */
function board(
  seed: number,
  opts: { benchDark?: boolean; opponentEnergy?: number } = {},
): GameState {
  const benchDark = opts.benchDark ?? true;
  const opponentEnergy = opts.opponentEnergy ?? 0;
  // The shared surgery helpers in `testFixtures.ts` are ZONE MOVERS that consult no
  // pool at all — they read `state.cardIdByUid` — so a locally-created game uses them
  // unchanged. Only the SETUP drive had to be local.
  let state = setActiveFromDeck(localSetup(seed), "p1", ATTACKER);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", WATER, 1);
  state = benchFromDeck(state, "p1", RESERVE);
  state = attachBenchFromDeck(state, "p1", 0, WATER, 1);
  if (benchDark) state = attachBenchFromDeck(state, "p1", 0, DARK, 1);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  if (opponentEnergy > 0) state = attachFromDeck(state, "p2", WATER, opponentEnergy);
  return state;
}

function swing(state: GameState) {
  const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return result;
}

/** The thirteen readers, off the MODULE surface rather than a hand-kept list (D418). */
const readerByName = effectsModule as unknown as Record<string, (t: string) => unknown>;
const claimedByAny = (s: string): boolean =>
  attackReaderSurface().some((n) => (readerByName[n]?.(s) ?? null) !== null);
const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the specimens ARE corpus rows, at their committed printing counts", () => {
  it("🛑 the printed sentence is `legalAttackCorpus()` FILE LINE 337, 1 legal printing", () => {
    // D452/D490: a byte pin measures an invention exactly as faithfully as it measures
    // the truth, so each specimen is asserted to be a ROW and its count is READ off the
    // corpus rather than typed. The card id is UNRESOLVABLE in this checkout and is
    // therefore not named at all (D425), the FILE LINE standing in for it.
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    // The nearest BUILT spelling — the lattice's substitution target — is a row too.
    const sibling = legalAttackCorpus().filter(([, s]) => s === BUILT_SIBLING);
    expect(sibling).toHaveLength(1);
    expect(sibling[0]?.[0]).toBe(1);
    // …and the two halves are NOT corpus rows, which is why neither could be claimed on
    // its own without authoring text no card prints (D440).
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    // The fixture carries the printed bytes rather than a paraphrase (D183).
    expect(POOL[ATTACKER]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ATTACKER]?.attacks?.[0]?.damage).toBe("100+");
    // The clause is a SUBSTRING of the printed row rather than a retyped constant.
    expect(PRINTED.startsWith(`If ${CLAUSE}, `)).toBe(true);
  });

  it("⚠️ `Energy in play` is exactly these TWO rows in the whole column", () => {
    // The pair is the warning rather than a filing habit — one counts PROVISION of one
    // type, the other counts CARDS regardless — so the population is pinned, not the
    // specimens (D423). A third spelling reddens this and gets read on purpose.
    const inPlay = legalAttackCorpus().filter(([, s]) => s.includes("Energy in play"));
    expect(inPlay.map(([, s]) => s).sort()).toEqual([PRINTED, BUILT_SIBLING].sort());
    expect(units(inPlay)).toBe(2);
  });
});

describe("§2 — TWO readers own it, and the other eleven still refuse", () => {
  it("🛑 the fold and the suppression, by VALUE, with the refusals kept beside them", () => {
    // D438: a positive replacement for a negated disjunction is a claim about NONE of
    // the disjuncts, so the OWNERS are named by value and the eleven refusals stay.
    expect(deriveAttackDamageBonus(PRINTED)).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 },
      },
    });
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const owners = ["deriveAttackDamageBonus", "deriveAttackDamageSuppression"];
    for (const name of attackReaderSurface()) {
      if (owners.includes(name)) continue;
      expect(readerByName[name]?.(PRINTED) ?? null, name).toBeNull();
    }
    // The surface COUNT beside the loop, because a loop over a shrinking surface stays
    // green (D417: pin the diff AND the count).
    expect(attackReaderSurface()).toHaveLength(13);
    // …and no splitter serves it either, so the claim is genuinely WHOLE-SENTENCE.
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("the COMPOUND's fold is the HEAD's fold — two anchors that cannot drift apart", () => {
    // One arm, two anchors, the sibling's capture order: the clause lookup, the printed
    // zero guard and the returned member are literally the same code.
    expect(deriveAttackDamageBonus(PRINTED)).toEqual(deriveAttackDamageBonus(HEAD));
  });

  it("🛑 this is the corpus's THIRD dual-claimed sentence, and it arrived on purpose", () => {
    // D445 pinned "at most one reader per sentence" as a POPULATION so a second could
    // not arrive by accident; D493 made it two. ⚠️ **AND THE RUNG IS BLIND TO
    // CORRECTNESS** (D493's own finding): it asserts HOW MANY readers claim, never WHAT
    // they answer — a reader mutated to the wrong member leaves it green. §5 is what
    // covers that.
    const dual = legalAttackCorpus().filter(
      ([, s]) => attackReaderSurface().filter((n) => (readerByName[n]?.(s) ?? null) !== null).length > 1,
    );
    expect(dual.map(([, s]) => s)).toContain(PRINTED);
    expect(dual).toHaveLength(3);
  });
});

describe("§3 — the axis lattice and the fork, measured over all 640 rows", () => {
  /** The 2 × 2 × 3 lattice, built from the PRINT rather than from a description.
      ⚠️ The AMOUNT is NOT an axis (D491): §3's last rung measures that its printed
      value already builds under the shipped anchor, so substituting it cannot move a
      verdict and a 2 × 2 × 2 × 3 table would be this one reported twice. */
  const QUANT = ["3 or more", "at least 3"] as const;
  const TYPE = ["Energy", "{D} Energy"] as const;
  const TAILS = [
    ` ${TAIL}`,
    " This attack's damage isn't affected by Weakness or Resistance.",
    "",
  ] as const;
  const point = (q: number, t: number, tl: number): string =>
    `If you have ${QUANT[q]} ${TYPE[t]} in play, this attack does 70 more damage.${TAILS[tl]}`;

  it("🛑 EXACTLY ONE of the twelve points builds, and it is the all-three substitution", () => {
    // \U0001f6d1 **THE PRE-SLICE VERDICT IS DERIVED, NOT QUOTED (D491).** A lattice run
    // AFTER the build is not the lattice, and writing the old table into a suite as
    // prose is exactly the unfalsifiable claim D465 forbids. The executable form is
    // `before = now && !NEW.test(point)` — subtract what this slice's two additions
    // claim — plus the rung below asserting that the points they claim are EXACTLY
    // the ones that moved.
    const NEW_ANCHOR =
      /^If (.+), this attack does (\d+) more damage\. This attack['’]s damage isn['’]t affected by Weakness\.$/;
    const NEW_CLAUSE = `If ${CLAUSE}, `;
    const beforeSlice = (s: string): boolean =>
      claimedByAny(s) && !NEW_ANCHOR.test(s) && !s.startsWith(NEW_CLAUSE);
    const built: string[] = [];
    const moved: string[] = [];
    for (let q = 0; q < 2; q++)
      for (let t = 0; t < 2; t++)
        for (let tl = 0; tl < 3; tl++) {
          const s = point(q, t, tl);
          if (beforeSlice(s)) built.push(`${q}${t}${tl}`);
          if (!beforeSlice(s) && claimedByAny(s)) moved.push(`${q}${t}${tl}`);
        }
    // The points this slice CLAIMED, named, so a later widening across a point the
    // lattice called refused reddens here rather than passing quietly. THREE of the
    // twelve, and the three are worth reading: `000` is the PRINT; `002` is its HEAD
    // alone, which the shipped `CONDITIONAL_DAMAGE_BONUS` picks up for free the moment
    // the clause row lands; `110` is the built sibling's clause under the new compound
    // anchor. ⚠️ **`010`, `012` and `100` STAY REFUSED, and that is the measurement
    // that keeps the clause table two LITERAL rows rather than a template** — the
    // crossings (`3 or more {D}`, `at least 3` untyped) are printed nowhere and are not
    // authored. ⚠️ **`001` STAYS REFUSED TOO**: the anchor's tail is spelled
    // `Weakness` and not the five-object alternation, so the `Weakness or Resistance`
    // crossing is not claimed either (D472, measured in §4).
    expect(moved.sort()).toEqual(["000", "002", "110"]);
    // Weight 3 — quantifier AND type AND tail all substituted — is the only point, and
    // it is corpus file line 341 at this slice's printed amount.
    expect(built).toEqual(["112"]);
    expect(point(1, 1, 2)).toBe("If you have at least 3 {D} Energy in play, this attack does 70 more damage.");
    // …and the AXIS COUNT is 3, not 4: the printed AMOUNT already builds (D491).
    expect(deriveAttackDamageBonus(BUILT_SIBLING.replace("50 more", "70 more"))).not.toBeNull();
  });

  it("🛑 (QUANTIFIER) ALONE frees NOTHING — no column row prints `N or more ⟨typed⟩ Energy in play`", () => {
    const hits = legalAttackCorpus().filter(([, s]) => /\d+ or more \{[A-Z]\} Energy in play/.test(s));
    expect(hits).toEqual([]);
  });

  it("🛑 (TYPE) ALONE frees NOTHING — no column row prints `at least N Energy in play` untyped", () => {
    const hits = legalAttackCorpus().filter(([, s]) => /at least \d+ Energy in play/.test(s));
    expect(hits).toEqual([]);
  });

  it("🛑 (QUANTIFIER + TYPE) ALONE frees NOTHING — the HEAD is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    const asHead = legalAttackCorpus().filter(([, s]) => s !== HEAD && s.startsWith(`${HEAD} `));
    expect(asHead.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(asHead)).toBe(1);
  });

  it("🛑 (TAIL) ALONE frees NOTHING — the bare clause is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    // …and it is printed as a TAIL exactly twice — file lines 337 and 529 — which is
    // the measurement D192 kept `weakness` as its own boolean for. BOTH are now claimed
    // WHOLE, by two different anchors, and neither by widening `DAMAGE_SUPPRESSION`.
    const asTail = legalAttackCorpus().filter(([, s]) => s !== TAIL && s.endsWith(` ${TAIL}`));
    expect(asTail).toHaveLength(2);
    expect(asTail.map(([, s]) => s)).toContain(PRINTED);
    for (const [, s] of asTail) expect(claimedByAny(s), s).toBe(true);
  });

  it("🛑 (COMPOSITION) ALONE frees NOTHING — no residue compound has a claimed head + suppression tail", () => {
    // The composition path admits `<claimed head>. <tail some reader claims>`. Over the
    // WHOLE column, the number of sentences refused whole, unserved by the four
    // splitters, whose head is claimed and whose tail is claimed by a NON-`deriveAttack
    // Effect` reader — exactly what widening the tail guard would newly admit — is ZERO,
    // before this slice and after it. ⚠️ **AND THAT WIDENING IS AN ARMED MUTANT**:
    // `D409-tail-guard-widened-to-any-reader`'s `replace` IS the line, and its `what`
    // states the defect. This rung is the reason nobody has to write it to find out.
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const wouldCompose = legalAttackCorpus().filter(([, s]) => {
      if (claimedByAny(s)) return false;
      if (splitAttackTrailingClause(s) !== null) return false;
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return claimedByAny(head) && claimedByAny(tail) && deriveAttackEffect(tail) === null;
    });
    expect(wouldCompose).toEqual([]);
  });

  it("🛑 ALL OF THEM TOGETHER free exactly the ONE row this anchor frees", () => {
    // The whole fork's payoff, derived: a widened clause vocabulary plus a suppression-
    // tail composition path would newly serve every refused compound whose head carries
    // this clause and whose tail is the bare suppression. That set is this row alone —
    // so the seam's entire payoff is what one constant already bought, and D447 already
    // refused a mirror splitter at 1 sentence / 2 printings as not paying.
    const pairWouldFree = legalAttackCorpus().filter(
      ([, s]) => s.startsWith(`If ${CLAUSE}, `) && s.endsWith(` ${TAIL}`),
    );
    expect(pairWouldFree.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(pairWouldFree)).toBe(1);
  });
});

describe("§4 — the anchor's TIGHT tail buys what a LOOSE one would, and looser is a DEFECT", () => {
  it("⚠️ three spellings of the tail, measured over all 640 rows (D472)", () => {
    const HEAD_SRC = "If (.+), this attack does (\\d+) more damage\\.";
    const tight = new RegExp(`^${HEAD_SRC} This attack['’]s damage isn['’]t affected by Weakness\\.$`);
    const alternation = new RegExp(
      `^${HEAD_SRC} This attack['’]s damage isn['’]t affected by (?:Weakness or Resistance|Resistance|Weakness)\\.$`,
    );
    for (const re of [tight, alternation]) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect(hits.map(([, s]) => s), re.source).toEqual([PRINTED]);
      expect(units(hits), re.source).toBe(1);
    }
    // 🛑 **AND THE BARE `(.+)` TAIL IS NOT MERELY UNPAID, IT IS A LIVE DEFECT** — it
    // additionally claims a sentence whose trailing half is a real OP this reader has
    // nowhere to put, which would be silently dropped while the census recorded the row
    // BUILT (D445's half-a-sentence failure). That is the case D472's rule exists for.
    const loose = new RegExp(`^${HEAD_SRC} (.+)$`);
    const looseHits = legalAttackCorpus().filter(([, s]) => loose.test(s));
    expect(looseHits).toHaveLength(2);
    const extra = looseHits.map(([, s]) => s).filter((s) => s !== PRINTED);
    expect(extra).toEqual([
      "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.",
    ]);
    // …and that sentence is BUILT today, by a different reader, which is what makes the
    // loose anchor a collision rather than a widening.
    expect(claimedByAny(extra[0] ?? "")).toBe(true);
  });

  it("⚠️ the two anchors are STRUCTURALLY disjoint, so the order is legibility (D467/D468)", () => {
    // A string cannot end two ways: the bare anchor demands `$` immediately after the
    // consequent's period, this one demands a space and a further whole sentence there.
    // Measured over the whole column in both directions, so no guard exists and
    // correctly none does.
    const bare = /^If (.+), this attack does (\d+) more damage\.$/;
    const compound = /^If (.+), this attack does (\d+) more damage\. This attack['’]s damage isn['’]t affected by Weakness\.$/;
    for (const [, s] of legalAttackCorpus()) {
      expect(bare.test(s) && compound.test(s), s).toBe(false);
    }
  });
});

describe("§5 — the board, and every wrong reading answers a different number", () => {
  it.each(SEEDS)("🛑 the printed answer is 140 on seed %i", (seed) => {
    const result = swing(board(seed));
    const dealt = find(result.events, "DAMAGE_DEALT");
    // 100 printed + 70 scaled = 170, Weakness SUPPRESSED, Resistance −30 applied.
    expect(dealt?.dealt).toBe(140);
    expect(dealt?.scaled).toBe(70);
    // ⚠️ **THE CRUMBS ARE THE ATTRIBUTION** (D456: render the row before calling the
    // slice done). Weakness is `null` because the sentence suppressed it; Resistance is
    // NOT, which is what separates `{ weakness }` from `{ weakness, resistance }`.
    expect(dealt?.weakness).toBeNull();
    expect(dealt?.resistance).not.toBeNull();
    expect(result.state.players.p2.active?.damage).toBe(140);
  });

  it("🛑 the condition is a FLOOR over the whole SIDE, counting CARDS", () => {
    const state = board(SEEDS[0]);
    const cond: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 };
    // The printed reading: Active + Bench, no type asked.
    expect(countEnergyInPlay(state, "p1", null)).toBe(3);
    expect(conditionHolds(state, "p1", cond)).toBe(true);
    // …and every narrowing of it is BELOW the printed threshold on this same board, so
    // a build that kept `energy` typed answers 0 whatever type it kept (D448).
    expect(countEnergyInPlay(state, "p1", "Water")).toBe(2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(1);
    expect(conditionHolds(state, "p1", { ...cond, energy: "Water" })).toBe(false);
    expect(conditionHolds(state, "p1", { ...cond, energy: "Darkness" })).toBe(false);
    // The ACTIVE alone is 1 — the `countAttachedEnergy` near miss the import block makes
    // available (D383's shape at this member) — and the OPPONENT's side is 0.
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p2", null)).toBe(0);
    expect(conditionHolds(state, "p2", cond)).toBe(false);
    // The FLOOR, driven at the boundary: `>=` holds at exactly 3 and `>` would not.
    expect(conditionHolds(state, "p1", { ...cond, count: 4 })).toBe(false);
  });

  it("🛑 the bonus WITHHELD is 70 damage, and 0 is a value in the signature (D472)", () => {
    // Two Energy in play: the clause is false, the fold contributes nothing, and the
    // suppression still fires — 100 − 30. Without this board the suite could not tell
    // "the bonus applied" from "the reader answered a constant".
    const result = swing(board(SEEDS[0], { benchDark: false }));
    const dealt = find(result.events, "DAMAGE_DEALT");
    expect(dealt?.dealt).toBe(70);
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.weakness).toBeNull();
  });

  it("🛑 the SEAT is the attacker's, and the inversion is visible on ONE board", () => {
    // p1 holds 2 and p2 holds 5, so the printed reading fails and a seat inversion
    // holds. A mirror board would prove nothing (D445: a mirror is not a seat
    // inversion) — the evidence has to come off one table.
    const state = board(SEEDS[0], { benchDark: false, opponentEnergy: 5 });
    expect(countEnergyInPlay(state, "p1", null)).toBe(2);
    expect(countEnergyInPlay(state, "p2", null)).toBe(5);
    const dealt = find(swing(state).events, "DAMAGE_DEALT");
    expect(dealt?.dealt).toBe(70);
  });
});

describe("§6 — the LOG row, rendered rather than reasoned about (D456)", () => {
  it("\u26a0\ufe0f the row prints the scaled bonus and the Resistance, and NO Weakness crumb", () => {
    // D421/D456: a log row is a claim with the same standing as a predicate, and this
    // site is invisible from the engine — only rendering it can show what a player is
    // told. `log.ts` needs NO new arm: it pushes a `weakness` crumb only when the
    // event carries one, and a suppressed step carries `null`.
    const result = swing(board(SEEDS[0]));
    const rows = logFromEvents(result.events, {
      names: { p1: "Ash", p2: "Gary" },
      state: result.state,
      elapsed: "+00:00",
    })
      .filter((e) => e.kind === "action")
      .map((e) => (e.kind === "action" ? e.segments.map((seg) => seg.text).join("") : ""));
    expect(rows).toContain("dealt 140 damage to D494 Wall \u00b7 scaled +70 \u00b7 resistance \u221230");
    // \u26a0\ufe0f **AND THE HONEST LIMIT, STATED RATHER THAN GLOSSED**: the absence of a
    // crumb cannot tell a player "Weakness was SUPPRESSED" from "this body has no
    // Weakness". That is D192's shipped design and this slice does not change it —
    // recorded here so a successor meets the gap rather than assuming it was checked.
    const withoutWall = rows.find((r) => r.includes("dealt"));
    expect(withoutWall?.includes("weakness")).toBe(false);
  });
});

describe("§7 — the clause vocabulary, and the caption arm that nothing can render", () => {
  it("🛑 `conditionNote` answers the untyped branch, and it round-trips to the print", () => {
    // A wrong branch here is SILENT — `${null} Energy` interpolates to "null Energy" and
    // `tsc` says nothing — so it is driven directly rather than left to a board.
    const cond: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 };
    // \u26a0\ufe0f **IT DOES NOT ROUND-TRIP TO THE PRINTED CLAUSE, AND THE DIFFERENCE IS THE
    // QUANTIFIER RATHER THAN A BRACE CODE.** Its two neighbours fail to round-trip
    // because they spell `{D}`/`{R}` as "Darkness"/"Fire" (D118); this one carries no
    // brace code at all and still differs, because the note says *"at least 3"* where
    // the key says *"3 or more"* — the sibling's phrasing, kept so the three pills read
    // alike. Asserted in BOTH directions so a successor cannot "fix" one into the other:
    // the note is not the key, and the key is not the note.
    expect(conditionNote(cond)).toBe("you have at least 3 Energy in play");
    expect(conditionNote(cond)).not.toBe(CLAUSE);
    expect(CLAUSE).toBe("you have 3 or more Energy in play");
    expect(conditionNote(cond).includes("null")).toBe(false);
    // The two shipped branches are untouched beside it (D424: a refusal owes an
    // admission on the same axis).
    expect(conditionNote({ ...cond, energy: "Darkness" })).toBe(
      "you have at least 3 Darkness Energy in play",
    );
    expect(conditionNote({ ...cond, energy: "special" })).toBe(
      "you have at least 3 Special Energy in play",
    );
  });

  it("⚠️ the caption is OWED and UNRENDERABLE, and that is asserted rather than claimed (D446)", () => {
    // `conditionNote`'s five call sites are all attack / ability / card-play GATES. This
    // member is produced only into a parse-time `DamageCountSource`, never into an op,
    // so no board can render the phrase. Swept over every op the derived attack column
    // produces rather than argued.
    const emitted: string[] = [];
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program !== null) emitted.push(JSON.stringify(program));
    }
    expect(emitted.some((s) => s.includes("yourEnergyInPlayAtLeast"))).toBe(false);
  });
});

describe("§8 — the standalone tail is STILL refused, and three shipped rungs rest on that", () => {
  it("🛑 `DAMAGE_SUPPRESSION` is byte-unchanged: the bare clause alone derives to null", () => {
    // The vocabulary was deliberately NOT widened. `damageSuppression.test.ts`,
    // `benchNounScaling.test.ts` §10 and `selfEnergyScaling.test.ts`'s REASON 3 all rest
    // on this, and all three are green after this slice — the difference between
    // claiming a PRINTED ROW and widening a vocabulary (D440).
    expect(deriveAttackDamageSuppression(TAIL)).toBeNull();
    expect(claimedByAny(TAIL)).toBe(false);
    // …and the GATE is what keeps the pair from half-building: a clause this engine has
    // never read leaves BOTH readers silent rather than one of them claiming alone
    // (D445's `.test()`-beside-an-`.exec()` defect).
    const unread = "If you have 3 or more Rainbow Badges in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.";
    expect(deriveAttackDamageBonus(unread)).toBeNull();
    expect(deriveAttackDamageSuppression(unread)).toBeNull();
    expect(claimedByAny(unread)).toBe(false);
    // …and a printed ZERO is refused by the same shared guard, on both anchors.
    expect(deriveAttackDamageBonus(PRINTED.replace("70 more", "0 more"))).toBeNull();
    expect(deriveAttackDamageSuppression(PRINTED.replace("70 more", "0 more"))).toBeNull();
  });

  it("🛑 the `^` end and the `$` end fail DIFFERENTLY, and only one is loud (D464)", () => {
    expect(deriveAttackDamageSuppression(PRINTED.replace(". This attack's", ". this attack's"))).toBeNull();
    expect(deriveAttackDamageSuppression(PRINTED.replace(/\.$/, ""))).toBeNull();
    // \u2460 THE `^` END IS LOUD. Leading text is claimed by nobody, so
    // `ATTACK_EFFECT_SKIPPED` fires and a `toBeNull` can say so — on BOTH readers,
    // because they share the anchor and therefore share its ends.
    expect(deriveAttackDamageSuppression(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(claimedByAny(`Draw a card. ${PRINTED}`)).toBe(false);
    // \u2461 THE `$` END IS NOT, AND A `toBeNull` THERE WOULD GO RED ON ITS FIRST RUN.
    // Once the printed sentence derives, `splitAttackTrailingClause` sees a claimed HEAD
    // and a `deriveAttackEffect` TAIL and COMPOSES the compound — correctly. So the
    // claim to assert is the SPLIT, not nullity, and that is what a `\.$` deletion
    // breaks: under it this anchor would claim the whole string and the printed draw
    // would silently never run (D464's rule, D493's C6 at this address).
    expect(deriveAttackDamageBonus(`${PRINTED} Draw a card.`)).toBeNull();
    expect(splitAttackTrailingClause(`${PRINTED} Draw a card.`)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
  });
});

describe("§9 — the U+2019 fold, on BOTH readers", () => {
  it("reads the curly spelling IDENTICALLY, and not merely non-null", () => {
    expect(deriveAttackDamageSuppression(curly(PRINTED))).toEqual(
      deriveAttackDamageSuppression(PRINTED),
    );
    expect(deriveAttackDamageBonus(curly(PRINTED))).toEqual(deriveAttackDamageBonus(PRINTED));
    expect(deriveAttackDamageBonus(curly(PRINTED))).not.toBeNull();
    expect(curly(PRINTED).split(RSQUO)).toHaveLength(3); // two apostrophes rewritten
    // The HEAD carries none, so the clause key needs no `literalClauseRow` fold (D440).
    expect(HEAD.includes("'")).toBe(false);
  });
});

describe("§10 — `MATCH_RECORD_VERSION` stays 29, and the slice has TWO addresses", () => {
  it("🛑 the READING has no carrier; the widened FIELD has one and is a WIDENING", () => {
    // D443: enumerate the slice's shape changes and give each its own address. There are
    // two and the argument differs.
    //
    // ⑴ **`AttackDamageBonus` / `AttackDamageSuppression` — NO CARRIER** (D470/D472/
    // D473, D493's argument verbatim). Both are parse-time types, `const` locals inside
    // `attack()`, absent from `packages/schema`, reached by no op, no prompt and no
    // event. Driven rather than reasoned (D427).
    const after = swing(board(SEEDS[0])).state;
    const bytes = JSON.stringify(after);
    for (const needle of ["boardCondition", "yourEnergyInPlayAtLeast"]) {
      expect(bytes.includes(needle), needle).toBe(false);
    }
    // What a saved record DOES hold is the printed SENTENCE, re-derived at every
    // declaration — so a v29 record's bytes are byte-identical before and after.
    expect(bytes.includes(PRINTED)).toBe(true);
    expect(after.players.p2.active?.damage).toBe(140);
    // …and no continuation was written at all: this program parks nowhere.
    expect(after.phase.kind).not.toBe("effect:choose");
    //
    // ⑵ **`BoardCondition.yourEnergyInPlayAtLeast.energy` — A PERSISTED ADDRESS, SO THE
    // NO-CARRIER ARGUMENT IS UNAVAILABLE AND IS NOT USED.** That union rides
    // `conditionGate.cond`, which is an `EffectOp`, which reaches
    // `phase.cont.pendingOp` and `rest`. The argument is D125/D333's WIDENING: `null` is
    // a NEW INHABITANT of an existing field, and no v29 deploy could write it because no
    // v29 producer existed — so no old byte re-means. The LOSS direction is inert for
    // the same reason: an old record holds `"Darkness"` or `"special"` and both still
    // mean exactly what they meant.
    const v29 = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const rebuilt = JSON.parse(JSON.stringify(v29)) as BoardCondition;
    expect(conditionHolds(after, "p1", rebuilt)).toBe(false); // 2 {W} + 1 {D} in play
    expect(conditionHolds(after, "p1", { ...v29, energy: null })).toBe(true);
    // …and the two answers DIFFER on this board, which is what makes the widening a real
    // inhabitant rather than a synonym for the old one.
    expect(conditionHolds(after, "p1", rebuilt)).not.toBe(
      conditionHolds(after, "p1", { ...v29, energy: null }),
    );
  });
});

describe("§11 — the version", () => {
  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A card can reach this: file line 337's printing scores a number it did not score
    // at 0.388.0, and skips a §8.5 step it did not skip.
    expect(engineVersion).toBe("0.400.0");
  });
});
