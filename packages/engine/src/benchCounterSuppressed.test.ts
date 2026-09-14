import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion, logFromEvents } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D493 — THE BENCH-COUNTER FOLD WITH ITS PRINTED WEAKNESS-ONLY SUPPRESSION
// RIDER: `censusAttackCorpus.ts` FILE LINE 529, 1 sentence / 1 legal printing.
//
//   "This attack does 10 damage for each damage counter on all of your Benched
//    Cynthia's Pokémon. This attack's damage isn't affected by Weakness."
//
// 🛑 **WHY THIS ROW NEEDED TWO READERS AND NOT A COMPOSITION SEAM.** The printed
// sentence carries a `per × count` fold AND a §8.5 step suppression. Those land at
// two different SEAMS — the fold before the pipeline, the suppression inside it — so
// D445's rule applies: COUNT THE SEAMS, NOT THE ANCHORS. `attack.ts` already hands
// the identical `effect` string to `deriveAttackDamageMultiplier` and to
// `deriveAttackDamageSuppression`, so one new anchor read by both costs ZERO bytes in
// that file. This is the corpus's SECOND dual-claimed sentence (the first is D445's,
// pinned as a POPULATION in `opponentHandScaling.test.ts` §2, which is where this one
// was named).
//
// 🛑 **THE FORK, PRICED IN BOTH DIRECTIONS, AND THEY FREE THE SAME ONE ROW.** D467
// wrote this row's two remaining blockers as executable rungs in
// `benchNounScaling.test.ts` §10 — (A) `DAMAGE_SUPPRESSION` has no bare-`Weakness`
// arm, (B) `splitAttackTrailingClause` demands a `deriveAttackEffect` tail — and both
// were re-derived TRUE at D493's head. **They are not independent, and that is what
// decided the design.** Measured over all 640 corpus rows, §3 below:
//
//   • (B) alone frees **0 sentences / 0 printings** — this tail is refused by all
//     thirteen readers, so a suppression-tail composition path has nothing to compose;
//   • (A) alone frees **0 / 0** as a whole-sentence claim — the column prints the bare
//     clause STANDALONE zero times;
//   • (A) + (B) together free **1 / 1** — exactly this row, exactly what the anchor
//     frees, for a fifth splitter plus an `attack.ts` seam plus a 10-pair splitter
//     disjointness matrix more.
//
// D447 already refused a mirror trailing splitter at *"1 sentence / 2 printings, which
// does not pay for a splitter"*. This one pays less.
//
// 🛑 **AND THE IN-PLACE FORM OF (B) IS AN ARMED MUTANT.** The pre-build tripwire audit
// over all 2,373 corpus rows found `D409-tail-guard-widened-to-any-reader`, whose
// `replace` is `if (!claimedByAnyReader(tail)) return null;` — byte for byte the
// widening — and whose `what` states the defect it ships: *"a tail claimed only by a
// DAMAGE reader would then be admitted, and the caller has nowhere to put it … SILENT
// IN EVERY CENSUS"*. `attack.ts` appends `compoundSplit.tail`'s OPS to the program and
// a suppression has none. Building that branch would have disarmed the tripwire that
// describes it — D436's GAP, avoided rather than paid.
//
// ⚠️ **WHAT WOULD CONSTRAIN A SUPPRESSION TAIL IF SOMEBODY DID BUILD THE SEAM: nothing,
// and that is not the problem.** D485 refused a tail-only anchor because *"you find
// there"* is an ANAPHOR pointing out of its clause. A suppression clause has no
// anaphor at all — its subject is *"this attack"*, fixed by the READ SITE and not by
// the head — so composing it behind any claimed head is semantically harmless. The
// blocker is not meaning, it is that the CALLER has no slot for the answer.
//
// ⚠️ **THE VOCABULARY WAS DELIBERATELY NOT WIDENED, AND THREE SHIPPED RUNGS DEPEND ON
// THAT.** `DAMAGE_SUPPRESSION` is byte-unchanged; the standalone sentence is still
// refused by every reader; `damageSuppression.test.ts`, `benchNounScaling.test.ts` §10
// and `selfEnergyScaling.test.ts`'s REASON 3 all still hold. §4 drives that.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, and its two halves. ⚠️ NOT retyped: §1 asserts the whole
    string is a row of `legalAttackCorpus()` and reads its printing count off the
    corpus rather than quoting one (D452/D490 — a byte pin measures an invention as
    faithfully as it measures the truth). */
const PRINTED =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.";
const HEAD =
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon.";
const TAIL = "This attack's damage isn't affected by Weakness.";

/** U+2019, spelled as an escape (`clauseApostrophe.test.ts`'s idiom). The printed row
    carries THREE straight apostrophes — `Cynthia's`, `attack's`, `isn't` — and they
    are resolved by three different mechanisms: the first by `IN_PLAY_OWNER_NOUN`'s
    `literalClauseRow`, the other two by the pattern's own `['’]` classes. */
const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

// ── THE FIXTURE — a file-local `cardPool` (D414), so `FIXTURE_POOL` is untouched and
// every id ladder in the repo takes a ZERO term. Card ids are UNRESOLVABLE in this
// checkout (no D1), so they are synthetic and say so rather than being invented as
// real ones (D425).
const ATTACKER = "d493-cynthia-garchomp";
const CYN_BODY = "d493-cynthia-gible";
const PLAIN_BODY = "d493-plain";
const WALL = "d493-weak-tough";
const FIRE = "d493-fire-energy";

const LOCAL_CARDS: Record<string, Card> = {
  /** 🛑 **THE ATTACKER IS ITSELF A `Cynthia's ` POKÉMON AND THAT IS THE ZONE AXIS, NOT
      FLAVOUR.** The printed noun is BENCH-scoped, so the wrong build this family
      invites is the "in play" walk that also counts the ACTIVE — and that walk is
      unobservable unless the Active satisfies the noun and carries counters. It does
      both (§5). FIRE, because the wall's Weakness and Resistance are both keyed on the
      ATTACKER's type. */
  [ATTACKER]: battler(ATTACKER, {
    name: "Cynthia's Garchomp",
    hp: 200,
    types: ["Fire"],
    attacks: [{ cost: ["Colorless"], name: "Bench Reckoning", damage: "10×", effect: PRINTED }],
  }),
  /** The COUNTED body. `matchesFilter`'s `ownerPokemon` arm appends the possessive and
      the space itself, so the NAME must begin `Cynthia's ` and the card must be a
      Pokémon (D440: that arm requires `category === "Pokemon"`). */
  [CYN_BODY]: battler(CYN_BODY, { name: "Cynthia's Gible", hp: 90 }),
  /** The FILTER's negative — same zone, same counters, no possessive. Without it the
      filtered and unfiltered walks answer the same number and the mutant that drops
      the filter survives a suite that looks thorough (D448). */
  [PLAIN_BODY]: battler(PLAIN_BODY, { name: "D493 Plain", hp: 90 }),
  /** ×2 Fire Weakness **and** −30 Fire Resistance off one body — `fix-weak-tough`'s
      shape, and SYNTHETIC for the reason that fixture states: joining
      `weaknesses_json` against `resistances_json` on `$.type` over all 3,786 D1 rows
      returns ZERO cards. It is the only board on which `{ weakness }` and
      `{ weakness, resistance }` answer different numbers, which is the whole reason
      `AttackDamageSuppression` keeps them as two fields. */
  [WALL]: battler(WALL, {
    name: "D493 Wall",
    hp: 340,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const DECK = deckOf({
  [ATTACKER]: 4,
  [CYN_BODY]: 8,
  [PLAIN_BODY]: 8,
  [WALL]: 4,
  [FIRE]: 36,
});

/** Three seeds, so no claim below rests on one shuffle (D270). Every body and every
    Energy is placed by surgery, so the seed only decides which physical copies move. */
const SEEDS = [4930, 4931, 4933] as const;

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

/** `autoHeal.test.ts`'s `localSetup`, verbatim in shape: `driveSetup` builds its game
    through `mustCreate`, which reads `FIXTURE_POOL`, so a local pool needs its own
    drive. p2 opens and passes, so p1 carries no §4 first-turn restriction. */
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
    the board).
 *
 *     p1                                          p2
 *       Active  Cynthia's Garchomp  90 damage       D493 Wall  (Fire ×2 / Fire −30)
 *       Bench   Cynthia's Gible     30 damage
 *               Cynthia's Gible     40 damage
 *               Cynthia's Gible     50 damage
 *               D493 Plain          60 damage
 *               D493 Plain          10 damage
 *
 *   The printed fold is `damageCountersOnYourBench { ownerPokemon: "Cynthia" }` — the
 *   attacker's BENCH, narrowed by the printed possessive, counted in COUNTERS.
 *   3 + 4 + 5 = **12 counters**, × 10 = a base of **120**, and every wrong build reads
 *   a different number on this ONE board:
 *
 *     • the UNFILTERED bench walk (the optional `filter` ignored)      19 → 190
 *     • an "IN PLAY" walk (the Active is a Cynthia's body, on purpose) 21 → 210
 *     • BODIES instead of counters, filtered                            3 →  30
 *     • BODIES unfiltered                                               5 →  50
 *     • a SEAT INVERSION (p2's bench is EMPTY)                          0 →   0
 *
 *   …and then §8.5 separates the SUPPRESSION readings off that same base of 120:
 *
 *     • `{ weakness }`             — the printed answer   120     − 30 =  **90**
 *     • `{ weakness, resistance }` — the sibling arm      120            = **120**
 *     • no suppression at all      — the rider dropped    120 × 2 − 30 = **210**
 *     • `{ resistance }`           — the wrong boolean    120 × 2      = **240**
 *
 *   🛑 **THE SECOND AND FIRST OF THOSE ARE THE POINT OF THE WHOLE FIXTURE.** They are
 *   the only pair a printed board cannot separate — no D1 card lists one type in both
 *   the Weakness and the Resistance column — and they are what makes
 *   `AttackDamageSuppression.weakness` a field rather than half of `resistance`.
 */
function board(seed: number): GameState {
  // The shared surgery helpers in `testFixtures.ts` are ZONE MOVERS that consult no
  // pool at all — they read `state.cardIdByUid` — so a locally-created game uses them
  // unchanged. Only the SETUP drive had to be local.
  let state = setActiveFromDeck(localSetup(seed), "p1", ATTACKER);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", FIRE, 1);
  state = setDamage(state, "p1", 90);
  for (const id of [CYN_BODY, CYN_BODY, CYN_BODY, PLAIN_BODY, PLAIN_BODY]) {
    state = benchFromDeck(state, "p1", id);
  }
  for (const [index, damage] of [[0, 30], [1, 40], [2, 50], [3, 60], [4, 10]] as const) {
    state = setBenchDamage(state, "p1", index, damage);
  }
  state = setActiveFromDeck(state, "p2", WALL);
  return clearBench(state, "p2");
}

function swing(state: GameState) {
  const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the specimen IS a corpus row, at its committed printing count", () => {
  it("🛑 the printed sentence is `legalAttackCorpus()` FILE LINE 529, 1 legal printing", () => {
    // D452/D490: a byte pin measures an invention exactly as faithfully as it measures
    // the truth, so the specimen is asserted to be a ROW and its count is READ off the
    // corpus rather than typed. The card id is UNRESOLVABLE in this checkout and is
    // therefore not named at all (D425), the FILE LINE standing in for it.
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    // …and the two halves are NOT corpus rows, which is why neither could be claimed
    // on its own without authoring text no card prints (D440).
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    // The fixture carries the printed bytes rather than a paraphrase (D183).
    expect(POOL[ATTACKER]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ATTACKER]?.attacks?.[0]?.damage).toBe("10×");
  });
});

describe("§2 — TWO readers own it, and the other eleven still refuse", () => {
  it("🛑 the fold and the suppression, by VALUE, with the refusals kept beside them", () => {
    // D438: a positive replacement for a negated disjunction is a claim about NONE of
    // the disjuncts, so the OWNERS are named and the eleven refusals stay.
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 10,
      count: {
        kind: "damageCountersOnYourBench",
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
      },
    });
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const owners = ["deriveAttackDamageMultiplier", "deriveAttackDamageSuppression"];
    for (const name of attackReaderSurface()) {
      if (owners.includes(name)) continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(PRINTED) ?? null, name).toBeNull();
    }
    // The surface COUNT beside the loop, because a loop over a shrinking surface stays
    // green (D417: pin the diff AND the count).
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("the COMPOUND's fold is the HEAD's fold — two anchors that cannot drift apart", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(deriveAttackDamageMultiplier(HEAD));
  });
});

describe("§3 — the fork, measured over all 640 rows rather than argued", () => {
  const readers = attackReaderSurface().map(
    (n) => (effectsModule as unknown as Record<string, (t: string) => unknown>)[n],
  );
  const claimedByAny = (s: string): boolean => readers.some((r) => (r?.(s) ?? null) !== null);

  it("🛑 (A) ALONE frees NOTHING: the bare clause is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    // …and it is printed as a TAIL exactly twice — file lines 337 and 529 — which is
    // the measurement D192 kept `weakness` as its own boolean for.
    const asTail = legalAttackCorpus().filter(([, s]) => s !== TAIL && s.endsWith(` ${TAIL}`));
    expect(asTail).toHaveLength(2);
    expect(asTail.map(([, s]) => s)).toContain(PRINTED);
    // The OTHER one does not join this slice, and the reason is its own LEADING half
    // (D488's axis test: two rows are one slice iff they refuse and build TOGETHER on
    // every axis — these do not).
    const other = asTail.map(([, s]) => s).find((s) => s !== PRINTED) ?? "";
    expect(other).toBe(
      "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
    );
    // 🆕🆕🆕 **D494 BUILT THAT ROW, SO THE OLD CLAIM'S SUBJECT IS GONE AND THE RUNG IS
    // RE-POINTED RATHER THAN RELAXED (D444).** The two lines here used to read
    // `claimedByAny(<the other row's head>) === false` and `claimedByAny(other) === false`,
    // which is exactly what made *(A) alone frees nothing* true: the OTHER bare-Weakness
    // tail sat behind a head no reader took. D494 taught `boardConditionForClause` the
    // printed clause and added `CONDITIONAL_BONUS_SUPPRESSED`, so both are now claimed.
    //
    // 🛑 **THE CLAIM THIS RUNG IS ABOUT SURVIVES INTACT, AND IT IS STRONGER STATED
    // THIS WAY**: the two rows were never one slice (D488's axis test), and the proof is
    // that they were built by TWO DIFFERENT ANCHORS reading TWO DIFFERENT FOLDS —
    // `deriveAttackDamageMultiplier` here, `deriveAttackDamageBonus` there — one slice
    // apart. A `.not.toBeNull()` on `other` would have been true under a mistaken
    // widening of THIS anchor as well (D418/D438), so the owner is named instead.
    expect(deriveAttackDamageMultiplier(other)).toBeNull();
    expect(deriveAttackDamageSuppression(other)).toEqual({ weakness: true });
    expect(
      (effectsModule as unknown as Record<string, (t: string) => unknown>).deriveAttackDamageBonus?.(
        other,
      ),
    ).not.toBeNull();
    // …and the ORIGINAL discrimination is kept on a subject that still has the property:
    // this anchor's own head, with the tail removed, is claimed by nobody but the bare
    // multiply sibling — so widening THIS pattern's tail is still visible here.
    expect(claimedByAny(`${HEAD} Draw a card.`)).toBe(false);
  });

  it("🛑 (B) ALONE frees NOTHING: no residue compound has a head-claimed + suppression tail", () => {
    // The composition path admits `<claimed head>. <tail some reader claims>`. Over the
    // WHOLE column, the number of sentences that are refused whole, unserved by the four
    // splitters, whose head is claimed and whose tail is claimed by a NON-`deriveAttack
    // Effect` reader — i.e. exactly what widening the tail guard would newly admit — is
    // ZERO, before this slice and after it. A seam with an empty population is a
    // mechanism written for nobody (D447's arithmetic, reproduced from the other end).
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const wouldCompose = legalAttackCorpus().filter(([, s]) => {
      if (claimedByAny(s)) return false;
      if (splitAttackTrailingClause(s) !== null) return false;
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return (
        claimedByAny(head) && claimedByAny(tail) && deriveAttackEffect(tail) === null
      );
    });
    expect(wouldCompose).toEqual([]);
  });

  it("🛑 (A)+(B) TOGETHER free exactly the ONE row this anchor frees", () => {
    // The pair's payoff, derived: a widened suppression vocabulary plus a suppression-
    // tail composition path would newly serve every refused compound whose head is
    // claimed and whose tail is the bare clause. That set is this row alone — so the
    // seam's whole payoff is what one constant already bought.
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const pairWouldFree = legalAttackCorpus().filter(([, s]) => {
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return tail === TAIL && claimedByAny(head);
    });
    // 🆕🆕🆕 **D494 — THE POPULATION IS TWO NOW, AND IT IS THE SAME MEASUREMENT.**
    // The other member is the row D493 measured as blocked on its own leading half;
    // D494 unblocked that half, so the set this rung computes gained a member WITHOUT
    // the seam ever being built. **That is the finding, not a regression**: the seam's
    // whole payoff over the entire column is TWO sentences / TWO printings, and both of
    // them were bought instead by one whole-sentence anchor apiece — a fifth splitter,
    // an `attack.ts` seam and a 10-pair disjointness matrix cheaper (D447 refused a
    // mirror splitter at 1 sentence / 2 printings as not paying; this is the same
    // arithmetic reached from the other end). The list is corpus-sorted.
    expect(pairWouldFree.map(([, s]) => s)).toEqual([
      "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
      PRINTED,
    ]);
    expect(pairWouldFree.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // …and neither is served by the composition path today, which is what makes the
    // rung above (`(B) ALONE frees NOTHING`) still true after both builds.
    for (const [, s] of pairWouldFree) expect(splitAttackTrailingClause(s), s).toBeNull();
  });

  it("⚠️ the anchor's TIGHT tail buys the same rows a LOOSE one would (D472)", () => {
    // D472: before generalising an anchor, measure what the generalisation claims over
    // the whole corpus; if the answer is "the same rows", the generality is pure risk.
    // Three spellings of the tail — the printed word, the five-object suppression
    // alternation, and a bare `(.+)` — all claim ONE sentence / ONE printing.
    const HEAD_SRC =
      "This attack does (\\d+) damage for each damage counter on all of your Benched ([^.]+ Pokémon)\\.";
    const spellings = [
      new RegExp(`^${HEAD_SRC} This attack['’]s damage isn['’]t affected by Weakness\\.$`),
      new RegExp(
        `^${HEAD_SRC} This attack['’]s damage isn['’]t affected by (?:Weakness or Resistance|Resistance|Weakness)\\.$`,
      ),
      new RegExp(`^${HEAD_SRC} (.+)$`),
    ];
    for (const re of spellings) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect(hits.map(([, s]) => s), re.source).toEqual([PRINTED]);
      expect(hits.reduce((sum, [n]) => sum + n, 0), re.source).toBe(1);
    }
    // …and the new anchor is STRUCTURALLY disjoint from the bare sibling it sits beside
    // (D467's rule 1: prefer structural disjointness, and then no guard can rot). One
    // demands `$` immediately after the head's period; the other demands a space and a
    // further whole sentence there, so no string can match both.
    const bare = new RegExp(`^${HEAD_SRC}$`);
    const compound = spellings[0] as RegExp;
    expect(legalAttackCorpus().filter(([, s]) => bare.test(s) && compound.test(s))).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => bare.test(s)).length).toBeGreaterThan(0);
  });
});

describe("§4 — the PAIRING GATE: the two readers cannot half-build a sentence", () => {
  it("🛑 an UNMAPPED printed noun leaves the WHOLE sentence loud, not half-read", () => {
    // D445's defect, refused: a bare `.test()` on the suppression side would claim this
    // string while the multiplier refuses it for its vocabulary, so `resolvedByAnyReader`
    // would be true, `BUILT.attack` would step, and the fold would silently vanish.
    // `Ancient` is in NO ingested column (D461/D462), so it is the permanent case.
    const ancient =
      "This attack does 10 damage for each damage counter on all of your Benched Ancient Pokémon. This attack's damage isn't affected by Weakness.";
    expect(deriveAttackDamageMultiplier(ancient)).toBeNull();
    expect(deriveAttackDamageSuppression(ancient)).toBeNull();
    expect(resolvedByAnyReader(ancient)).toBe(false);
  });

  it("🛑 a PRINTED ZERO leaves the WHOLE sentence loud — the family's other guard", () => {
    const zero = PRINTED.replace("does 10 damage", "does 0 damage");
    expect(deriveAttackDamageMultiplier(zero)).toBeNull();
    expect(deriveAttackDamageSuppression(zero)).toBeNull();
    expect(resolvedByAnyReader(zero)).toBe(false);
  });

  it("⚠️ …and the vocabulary is UNCHANGED: the bare clause is still refused by all 13", () => {
    // The half of this slice that was deliberately NOT built. Three shipped `toBeNull`
    // rungs in three other files rest on this, and the falsifier is executable: the day
    // the column prints the clause standalone, §3's first rung is what changes.
    expect(deriveAttackDamageSuppression(TAIL)).toBeNull();
    expect(resolvedByAnyReader(TAIL)).toBe(false);
    // The CONTROL that keeps the line above from passing on a dead reader (D424).
    expect(
      deriveAttackDamageSuppression("This attack's damage isn't affected by Weakness or Resistance."),
    ).toEqual({ weakness: true, resistance: true });
  });

  it("🛑 the `^` END: a sentence with LEADING text stays on the LOUD path", () => {
    // D464: the two ends of a whole-sentence anchor fail DIFFERENTLY, and the `^` end
    // is the one still demonstrable on the loud path. Without the caret the anchor
    // would claim a compound whose FIRST clause nothing reads, and both readers would
    // answer about a sentence the engine cannot score.
    const led = `Discard an Energy from this Pokémon. ${PRINTED}`;
    expect(deriveAttackDamageMultiplier(led)).toBeNull();
    expect(deriveAttackDamageSuppression(led)).toBeNull();
    expect(resolvedByAnyReader(led)).toBe(false);
    // The CONTROL on the same axis (D424): the leading clause is one the engine DOES
    // read on its own, so the refusal above is the anchor's and not the clause's.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).not.toBeNull();
  });

  it("🛑 the `$` END: a sentence CONTINUING past the rider is a SPLIT, not a claim", () => {
    // D464's other half, and it cannot be demonstrated with a `toBeNull` — now that the
    // printed sentence derives, `splitAttackTrailingClause` sees a claimed HEAD and a
    // claimed TAIL and COMPOSES. So the assertion is the SPLIT itself: the trailing
    // clause must reach the program through the splitter and NOT be swallowed by this
    // anchor. Drop the anchor's `\.$` and the compound is claimed whole instead, and
    // the printed draw silently never runs.
    const trailed = `${PRINTED} Draw a card.`;
    expect(splitAttackTrailingClause(trailed)).toEqual({ head: PRINTED, tail: "Draw a card." });
    expect(deriveAttackDamageMultiplier(trailed)).toBeNull();
    expect(deriveAttackDamageSuppression(trailed)).toBeNull();
    // ⚠️ AND NO SUCH COMPOUND IS PRINTED — checked over the whole column, so the rung
    // above is about the ANCHOR's edge and not about a card (D464: say so).
    expect(
      legalAttackCorpus().filter(([, t]) => t !== PRINTED && t.startsWith(`${PRINTED} `)),
    ).toEqual([]);
  });

  it("⚠️ the SPLITTERS still refuse it, now at the SHADOW refusal rather than the tail", () => {
    // D486: a rung passing is not evidence it still tests its stated claim. Before this
    // slice `splitAttackTrailingClause` refused this string at its TAIL test; it now
    // refuses one line earlier, because a string a reader claims whole never reaches
    // composition. Same verdict, different mechanism, and saying so is the rung.
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(deriveAttackEffect(TAIL)).toBeNull();
  });
});

describe("§5 — the BOARD: the fold, the zone, the filter and the §8.5 step", () => {
  it("🛑 the printed answer is 90, and it is the same from every seed", () => {
    for (const seed of SEEDS) {
      const dealt = find(swing(board(seed)).events, "DAMAGE_DEALT")?.dealt;
      expect(dealt, `seed ${seed}`).toBe(90);
    }
  });

  it("🛑 the row reports WHICH §8.5 steps ran — Weakness NULLED, Resistance APPLIED", () => {
    // The number alone cannot separate "Weakness suppressed" from "the card has no
    // Weakness"; the log row carries the reconstruction (D430: when a fix does not
    // change what is emitted, read the BOARD — here, the row's own fields).
    const row = find(swing(board(SEEDS[0])).events, "DAMAGE_DEALT");
    // ⚠️ `base` is the PRINTED figure and it is **0** — the card prints `10×`, so the
    // whole number is the fold, which arrives in `scaled`. Read off the row rather
    // than predicted from the sentence (D482: compute what each reading answers).
    expect(row).toMatchObject({
      base: 0,
      scaled: 120,
      weakness: null,
      resistance: { op: "subtract", amount: 30 },
      dealt: 90,
    });
    // 🛑 THE DISCRIMINATOR THE WHOLE FIXTURE EXISTS FOR: `{ weakness }` and
    // `{ weakness, resistance }` are DIFFERENT answers on this body — 90 against 120 —
    // so the two booleans are observably separate for the first time in this engine.
    // The sibling arm's value is asserted here rather than described, and the printed
    // row's is the one that ships.
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(deriveAttackDamageSuppression(PRINTED)).not.toEqual({
      weakness: true,
      resistance: true,
    });
    // …and the base is the FOLD, which pins the zone and the filter in one number:
    // 12 counters × 10. Every wrong walk enumerated in `board`'s block answers a
    // different base (190 / 210 / 30 / 50 / 0).
    expect(row?.scaled).toBe(120);
    expect(row?.dealt).toBe(90);
  });

  it("⚠️ the sentence is SIMULATED — no `ATTACK_EFFECT_SKIPPED` row", () => {
    // The loud channel is the engine's one honest failure signal, so a slice that claims
    // a sentence owes the assertion that it stopped firing (D444: half a sentence can
    // fail loudly while the other half fails in silence).
    const events = swing(board(SEEDS[0])).events;
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });
});

describe("§5b — the LOG ROW, rendered (D456: render it before calling the slice done)", () => {
  it("🛑 the row prints the FOLD and prints NO Weakness segment", () => {
    // ⚠️ **THE SUPPRESSION HAS NO CRUMB OF ITS OWN AND IS OBSERVABLE ONLY BY ABSENCE**
    // (`log.ts`'s own note): the `×2` segment is emitted when `event.weakness !== null`,
    // and `attack.ts` writes `null` there under suppression. So the assertion that
    // carries this slice is a `not.toContain`, and it needs the POSITIVE crumbs beside
    // it or it would pass on a build that rendered nothing at all.
    const result = swing(board(SEEDS[0]));
    const lines = logFromEvents(result.events, {
      names: { p1: "P1", p2: "P2" },
      state: result.state,
      elapsed: "+00:10",
    });
    const text = lines
      .flatMap((l) => (l.kind === "action" ? l.segments.map((seg) => seg.text) : []))
      .join("");
    expect(text).toContain("scaled +120");
    expect(text).toContain("90");
    // The Weakness step did not run…
    expect(text).not.toContain("×2");
    // …and the Resistance step DID, which is the control that keeps the line above from
    // passing on a build that suppressed everything (D424: a refusal owes an admission
    // on the same axis).
    expect(text).toContain("−30");
  });
});

describe("§6 — the U+2019 fold, on BOTH readers", () => {
  it("reads the curly spelling IDENTICALLY, and not merely non-null", () => {
    // D136/D137's shape: EQUALITY with the straight form. The row carries three
    // apostrophes resolved by two different mechanisms — the pattern's `['’]` classes
    // and `IN_PLAY_OWNER_NOUN`'s `literalClauseRow` — so a slice that classed only the
    // pattern's two would pass a `not.toBeNull()` and fail this.
    expect(deriveAttackDamageSuppression(curly(PRINTED))).toEqual(
      deriveAttackDamageSuppression(PRINTED),
    );
    expect(deriveAttackDamageMultiplier(curly(PRINTED))).toEqual(
      deriveAttackDamageMultiplier(PRINTED),
    );
    expect(deriveAttackDamageMultiplier(curly(PRINTED))).not.toBeNull();
    expect(curly(PRINTED).split(RSQUO)).toHaveLength(4); // three apostrophes rewritten
  });
});

describe("§7 — `MATCH_RECORD_VERSION` stays 29: there is NO CARRIER", () => {
  it("🛑 the reading is in NO byte of a persisted record, and the NUMBER is", () => {
    // The argument SHAPE is named before it is made (D463): this is D470/D472/D473's
    // NO CARRIER, not D450's reachability (which is about `EffectOp`s and would be the
    // wrong question here) and not D125's widening (nothing widened).
    // `AttackDamageSuppression` and `AttackDamageBonus` are PARSE-TIME types — `const`
    // locals inside `attack()`, absent from `packages/schema`, reached by no op, no
    // prompt and no event — and a `MatchRecord` is `{version, seed, startedAt, state,
    // log, names}`.
    //
    // DRIVEN rather than reasoned (D427: drive the record, do not reason from the
    // carrier's name). The whole post-attack `GameState` is serialised — that is what
    // `MatchRecord.state` holds — and neither the fold nor the suppression appears in
    // it, while the damage the two decide is on the board.
    const after = swing(board(SEEDS[0])).state;
    const bytes = JSON.stringify(after);
    // The DERIVED shapes — the count member and its filter — appear NOWHERE. They are
    // computed inside `attack()` from the card's text and discarded in the same tick.
    for (const needle of ["damageCountersOnYourBench", "ownerPokemon"]) {
      expect(bytes.includes(needle), needle).toBe(false);
    }
    // ⚠️ **AND THE POSITIVE HALF, WHICH IS THE ACTUAL ARGUMENT**: what a saved record
    // DOES hold is the printed SENTENCE (a `GameState` carries its `cardPool`), and
    // the reading is re-derived from that string at every declaration. So a v29
    // record's bytes are byte-identical before and after this slice; only what this
    // build reads OUT of them changed, which is not a thing a version can be about.
    // That is why the argument here is NO CARRIER (D470/D472/D473) and not D125's
    // widening — the widening question needs a persisted shape to widen.
    expect(bytes.includes(PRINTED)).toBe(true);
    // The number the reading decided IS in the bytes, which is what makes the absence
    // above a measurement rather than a serialisation that dropped everything.
    expect(after.players.p2.active?.damage).toBe(90);
    // …and no continuation was written at all: this program parks nowhere, so `rest`
    // cannot carry anything either (D465's first-position form of the same argument).
    expect(after.phase.kind).not.toBe("effect:choose");
  });
});

describe("§8 — the version", () => {
  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A card can reach this: file line 529's printing scores a number it did not score
    // at 0.387.0, and skips a §8.5 step it did not skip.
    expect(engineVersion).toBe("0.400.0");
  });
});
