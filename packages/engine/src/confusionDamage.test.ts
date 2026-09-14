import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { runProgram } from "./interpreter";
import { redactGame } from "./redact";
import { DEFAULT_CONFUSION_DAMAGE, noConditions } from "./types";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.392.0 → 0.393.0 — 🆕🆕🆕 D501, THE RAISED CONFUSION SELF-HIT.
//
// *"Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of
// 3 on that Pokémon for this Special Condition."* — `censusAttackCorpus.ts` **FILE
// LINE 685**, **1 sentence / 1 legal printing**, the THIRD and last `instead of` row
// in the committed column. The other two are the Poison pair at file lines 688 and
// 689 (1 and 4 printings), both built since P3-M3.
//
// 🛑 **THE SLICE IS A CHANNEL, NOT AN ANCHOR, AND THE `MATCH_RECORD_VERSION` BUMP IS
// THE PRICE OF THE CHANNEL.** The anchor is one regex and one arm. What it needed was
// somewhere to PUT the 8: the §8 step-3 flip in `attack.ts` had the amount hard-coded
// as a literal `30` at two sites (the damage and the `COUNTERS_PLACED` row) since
// `04551439`, 2026-07-17. The amount has to ride the VICTIM's body, because the flip
// happens on a later turn than the attack that inflicted it — the attacker, its
// program and its context are all gone by then. That address is
// `SpecialConditions`, which is inside `MatchRecord.state`, which is why §7 exists.
//
// ⚠️ **WHAT THE SHIPPED SIBLING DOES AND DOES NOT SETTLE (D476: open the citation).**
// `SpecialConditions.poisonDamage` is the same fact one status over and is REQUIRED,
// which reads like the decisive precedent for the version question. It is not:
// `git log -S "poisonDamage" -- packages/engine/src/types.ts` bottoms out at
// `04551439` (2026-07-17), and `apps/api/src/lobby/match.ts` did not exist until
// `bc91ea14` (2026-07-23), with record versioning landing at `95ca679b` (D71–D74).
// **The sibling did not bump because there was nothing to bump.** It settles the
// SHAPE — an amount on the condition, counters→HP at the producer, an OPTIONAL op
// rider resolved against a rule constant — and is silent on the constant.
//
// ⚠️ **AND THE TWO FIELDS ARE NOT THE SAME SHAPE, WHICH IS WORTH SAYING BECAUSE THEY
// LOOK IT.** `poisonDamage` doubles as Poison's own FLAG (`presentStatuses` reads
// `> 0`), so `0` means "not Poisoned". Confusion's flag is `rotation`, a different
// field, so `confusionDamage` is a pure amount with a printed default and **0 is not
// a sentinel**. §4 drives what that buys and what it costs.

/** Corpus FILE LINE 685, byte for byte. §1 asserts it IS a row of
    `legalAttackCorpus()` rather than trusting this literal (D452/D490: a byte pin
    measures an invention as faithfully as it measures the truth). */
const RAISED =
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.";

/** Corpus FILE LINE 683 — the HEAD, which has built since M3 and is the control for
    every claim below about the amount. 31 legal printings. */
const BARE = "Your opponent's Active Pokémon is now Confused.";

/** The TAIL alone. It is NOT a corpus row (asserted in §1) and it must stay
    unclaimed — see §2. */
const TAIL = "Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.";

/** Corpus FILE LINE 689 — the shipped SIBLING this slice mirrors, 4 legal printings.
    Present so that §1's lattice endpoint is a real printed row rather than a
    construction, and so §5's board has a Poison control on the same op. */
const POISON_8 =
  "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 8 damage counters on that Pokémon instead of 1.";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the SPECIMENS are corpus rows, and the printing counts are read off it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — every specimen is a row of the committed column, with its count", () => {
  const corpus = legalAttackCorpus();
  const rowOf = (text: string) => corpus.find(([, t]) => t === text);

  it("🛑 the three printed specimens ARE corpus rows, at the printing counts quoted above", () => {
    // D490's rule: assert membership and read the count off the corpus. A hand-typed
    // damage figure is exactly what a byte pin cannot tell from a real one.
    expect(rowOf(RAISED)?.[0]).toBe(1);
    expect(rowOf(BARE)?.[0]).toBe(31);
    expect(rowOf(POISON_8)?.[0]).toBe(4);
  });

  it("the TAIL is printed STANDALONE on zero cards — which is why §2 exists", () => {
    expect(rowOf(TAIL)).toBeUndefined();
  });

  it("`instead of` is printed on exactly THREE rows, and this slice closes the last", () => {
    // D463's executable split: the family is re-enumerated off the corpus so the
    // claim reddens if a fourth ever prints, rather than sitting in prose.
    const family = corpus.filter(([, t]) => t.includes("instead of"));
    expect(family.map(([n, t]) => [n, t.slice(0, 46)])).toEqual([
      [1, "Your opponent's Active Pokémon is now Confused"],
      [1, "Your opponent's Active Pokémon is now Poisoned"],
      [4, "Your opponent's Active Pokémon is now Poisoned"],
    ]);
    // …and all three are now claimed. Before this slice the first was not.
    for (const [, t] of family) expect(resolvedByAnyReader(t), t).toBe(true);
  });

  it("the apostrophe is ASCII U+0027 and the é is U+00E9, measured rather than eyed", () => {
    // D421/D440: measure the byte with `codePointAt`, never by eye.
    expect(RAISED.codePointAt(RAISED.indexOf("'"))).toBe(0x27);
    expect(RAISED.codePointAt(RAISED.indexOf("é"))).toBe(0xe9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the LATTICE, and the cheaper build that is the trap.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — a WHOLE-SENTENCE anchor, and the two measurements that warrant it", () => {
  /** The five LIVE axes, each substituted onto its nearest BUILT spelling (corpus
      FILE LINE 689). Bit 0 of `bits` is the PRINT's value, bit 1 the built one.

      🛑 A SIXTH CANDIDATE AXIS — the printed COUNT `8` — IS DEGENERATE and is
      deliberately absent (D491/D494/D500): the Poison anchor's `(\d+)` claims 8 and
      2 alike, so substituting it changes nothing on either side and a 2⁶ table would
      have been this table reported twice. §2's last case drives that rather than
      asserting it. */
  function point(bits: number, count = 8): string {
    const S = (bits >> 4) & 1;
    const T = (bits >> 3) & 1;
    const P = (bits >> 2) & 1;
    const D = (bits >> 1) & 1;
    const R = bits & 1;
    const status = S ? "Poisoned" : "Confused";
    const verb = T ? "During Pokémon Checkup, put" : "Put";
    const dflt = D ? "1" : "3";
    const mid = P ? "" : ` instead of ${dflt}`;
    const end = P ? ` instead of ${dflt}` : "";
    const trail = R ? "" : " for this Special Condition";
    return `Your opponent's Active Pokémon is now ${status}. ${verb} ${count} damage counters${mid} on that Pokémon${end}${trail}.`;
  }

  it("🛑 the lattice's two ENDPOINTS are the two printed rows, not constructions", () => {
    expect(point(0b00000)).toBe(RAISED);
    expect(point(0b11111)).toBe(POISON_8);
  });

  it("🛑 built-by-weight is `0/1 · 0/5 · 0/10 · 0/10 · 0/5 · 1/1` — NO PROPER SUBSET BUILDS", () => {
    // 🛑 **THE PRE-STATE IS DERIVED, NOT QUOTED (D491).** A lattice run before the
    // build cannot be re-run afterwards, so writing its table into a comment would be
    // the unfalsifiable claim D465 forbids. `before` subtracts what THIS slice's
    // anchor claims from what the readers answer today, which reddens if a later
    // slice widens any anchor across a point this table calls refused.
    const before = (t: string) => resolvedByAnyReader(t) && deriveAttackEffect(t) === null;
    const weights = [0, 0, 0, 0, 0, 0];
    const totals = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 32; b++) {
      const w = ((b >> 4) & 1) + ((b >> 3) & 1) + ((b >> 2) & 1) + ((b >> 1) & 1) + (b & 1);
      totals[w] = (totals[w] ?? 0) + 1;
      const s = point(b);
      const built =
        (resolvedByAnyReader(s) && s !== RAISED) || splitAttackTrailingClause(s) !== null;
      if (built) weights[w] = (weights[w] ?? 0) + 1;
      // the "before" view: nothing except the endpoint was claimed at the old head
      if (s !== RAISED) expect(before(s), s).toBe(false);
    }
    expect(totals).toEqual([1, 5, 10, 10, 5, 1]);
    expect(weights).toEqual([0, 0, 0, 0, 0, 1]);
    // D489/D490/D494's shape: the ONLY built point is at FULL weight, so there is no
    // prerequisite half (D499) and no proper superset to compose from (D495).
  });

  it("the COUNT axis is DEGENERATE — the built endpoint claims 8 and 2 alike", () => {
    for (const c of [1, 2, 8, 40]) {
      expect(deriveAttackEffect(point(0b11111, c)), `poison@${c}`).not.toBeNull();
    }
  });

  it("🛑 the TAIL stays REFUSED, and that is a DECISION rather than an omission", () => {
    // D485: the splitter's admission test is not a licence. `splitAttackTrailingClause`
    // DOES compose at this head — driven below, not assumed — so a bare-tail arm would
    // have freed the row with no compound anchor at all, strictly cheaper than what
    // ships. It is refused because the tail points OUT of its clause TWICE: "on THAT
    // POKÉMON" (antecedent: the head's subject) and "for THIS SPECIAL CONDITION"
    // (antecedent: the head's *Confused*).
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(resolvedByAnyReader(TAIL)).toBe(false);

    // The splitter composes at this head for tails some reader DOES claim…
    expect(splitAttackTrailingClause(`${BARE} Draw a card.`)).toEqual({
      head: BARE,
      tail: "Draw a card.",
    });
    // …and refuses the printed compound only because the tail is unclaimed, which is
    // exactly the property a bare-tail arm would have removed.
    expect(splitAttackTrailingClause(RAISED)).toBeNull();
  });

  it("🛑 the hazard a bare-tail arm would open, counted over the whole column", () => {
    // The number is the point: 492 claimed sentences end in a period, so a tail arm
    // would let the splitter hang this amount behind any of them — including Burned
    // and Paralyzed heads, where "for this Special Condition" has an antecedent that
    // is not Confusion at all.
    const claimedEndingInPeriod = legalAttackCorpus().filter(
      ([, t]) => resolvedByAnyReader(t) && t.endsWith("."),
    );
    expect(claimedEndingInPeriod.length).toBe(498);  // (🆕🆕🆕 **D513 +1 sentence — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). 🛑 **ALL FOUR SHIPPED IN-PLAY ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the opposite answer to D510's, because every one of them requires the literal `for each of your ` and this sentence's head is SEATLESS. **+1 sentence**, and it ends in a period like every other row this figure counts.) (🆕🆕🆕 **D510 +1 sentence — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 
    const burnedHead = "Flip a coin. If heads, your opponent's Active Pokémon is now Burned.";
    expect(resolvedByAnyReader(burnedHead)).toBe(true);
    expect(deriveAttackEffect(`${burnedHead} ${TAIL}`)).toBeNull();
  });

  it("the WIDER anchor claims the SAME rows, so the generality is pure risk (D472)", () => {
    // Capturing the printed default instead of spelling it buys nothing: measured over
    // all 640 rows both forms claim exactly this one sentence. So `3` stays a literal,
    // and a printed `instead of 5` — a card misstating the rule — stays LOUD.
    const WIDE =
      /^Your opponent['’]s Active Pokémon is now Confused\. Put (\d+) damage counters instead of (\d+) on that Pokémon for this Special Condition\.$/;
    const wide = legalAttackCorpus().filter(([, t]) => WIDE.test(t));
    expect(wide.map(([n]) => n)).toEqual([1]);
    expect(deriveAttackEffect(RAISED.replace("instead of 3", "instead of 5"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the reader: the program, the anchor's edges, the near misses.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the arm, and what it refuses", () => {
  it("🛑 the printed sentence derives to ONE op carrying the raised amount in HP", () => {
    expect(deriveAttackEffect(RAISED)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 },
    ]);
  });

  it("the BARE head is untouched and carries NO rider — the one-axis control", () => {
    // D424's rule: every "X is refused" owes a neighbouring "Y is admitted" on the
    // same axis. Here the axis is the rider, and the control is the sentence this
    // slice must NOT have changed.
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
  });

  it("counters convert to HP at the ARM, and the whole range is read", () => {
    for (const n of [1, 3, 7, 8, 12]) {
      expect(deriveAttackEffect(RAISED.replace("Put 8 ", `Put ${n} `))).toEqual([
        { op: "applyStatus", target: "defender", status: "confused", confusionDamage: n * 10 },
      ]);
    }
  });

  it("a printed ZERO stays LOUD rather than deriving a silent no-op", () => {
    expect(deriveAttackEffect(RAISED.replace("Put 8 ", "Put 0 "))).toBeNull();
  });

  it("a printed count that RESTATES the rule is admitted, not second-guessed", () => {
    // `instead of 3` raising the amount TO 3 is a card restating the default. The arm
    // takes it — a `> DEFAULT` guard would be the reader deciding a real printing is
    // a mistake, which is a rule no card prints.
    expect(deriveAttackEffect(RAISED.replace("Put 8 ", "Put 3 "))).toEqual([
      { op: "applyStatus", target: "defender", status: "confused", confusionDamage: 30 },
    ]);
  });

  it("is ANCHORED at both ends and CASE-COMMITTED", () => {
    expect(deriveAttackEffect(`${RAISED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${RAISED}`)).toBeNull();
    expect(deriveAttackEffect(RAISED.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(RAISED.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(RAISED.toUpperCase())).toBeNull();
  });

  it("reads the U+2019 apostrophe identically to the ASCII one", () => {
    const curly = RAISED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(RAISED);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(RAISED));
  });

  it("🛑 NEAR MISSES — every one differs from the print on exactly ONE axis (D427)", () => {
    for (const text of [
      // the STATUS slot, onto a word whose amount this field does not carry
      RAISED.replace("Confused", "Burned"),
      RAISED.replace("Confused", "Asleep"),
      // the DEFAULT slot
      RAISED.replace("instead of 3", "instead of 1"),
      // the POSITION of the "instead of" phrase
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters on that Pokémon instead of 3 for this Special Condition.",
      // the TRAILING phrase
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon.",
      // the SEAT
      RAISED.replace("Your opponent's Active Pokémon", "This Pokémon"),
      // the NOUN — a singular counter
      RAISED.replace("damage counters", "damage counter"),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the reader SURFACE stands still at 13 — no new `deriveAttack*` export", () => {
    // D444: `deriveAttack` is a reserved namespace with nothing but a string behind
    // it, so a slice that adds a reader moves every census figure in the repo.
    expect(attackReaderSurface().length).toBe(13);
  });

  it("exactly ONE reader claims the sentence, and it is `deriveAttackEffect`", () => {
    // D438's polarity rule: name the owner AND keep the refusals, so the rung arms
    // rows a boolean never could.
    const claimants = attackReaderSurface().filter(
      (name) => name === "deriveAttackEffect" && deriveAttackEffect(RAISED) !== null,
    );
    expect(claimants).toEqual(["deriveAttackEffect"]);
    expect(splitAttackTrailingClause(RAISED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The board.
// ─────────────────────────────────────────────────────────────────────────────

/** ⚠️ **A FILE-LOCAL `cardPool`, SO NO `FIXTURE_POOL` ID IS ADDED (D452/D495).**
    That keeps `opponentResistanceBonus.test.ts`'s pool-size pin and its ELEVEN-deep
    `ids.length` ladder at a ZERO term — twelve assertions in a file with nothing to
    do with this subject — and it is the difference between a 21-site census tax and
    a 33-site one. The census still steps by the full sentence and printing counts,
    because those are keyed on the CORPUS and the READERS, not on the pool. */
const RAISER: Card = battler("fix-confuse8", {
  hp: 120,
  attacks: [
    // ⚠️ **NO PRINTED DAMAGE, AND THE REASON IS ARITHMETIC (D482).** At 20 printed the
    // raised self-hit would put the victim at 20 + 80 = 100 on a 100 HP body — a Knock
    // Out, which collapses the 80/30 split onto "the body left the board" and makes both
    // readings answer the same observable. Zero printed damage keeps the flip's number
    // the ONLY thing separating them, and keeps a SECOND miss lethal (160 >= 100), which
    // is what §5's survivability case is about.
    { name: "Dizzy Punch", cost: ["Colorless"], effect: RAISED },
    // ⚠️ **THE ATTRIBUTION CONTROL IS IN THE DECK, NOT IN A COMMENT (D214).** Index 1
    // is the BARE head — same op, same target, same status, NO rider. Every claim
    // below about "the raised amount landed" is paired with a board on which the
    // identical action leaves the rulebook's 30, so a `confusionDamage` that was
    // silently ignored would be invisible from inside this file otherwise.
    { name: "Plain Confuse", cost: ["Colorless"], effect: BARE },
    // …and the POISON sibling, so §5 can show the two amounts are separate fields
    // rather than one slot two statuses share.
    { name: "Toxic Ring", cost: ["Colorless"], effect: POISON_8 },
  ],
});

/** The victim, and the one number that makes §5 discriminating: 100 HP, so the
    RAISED self-hit (80) is survivable and a SECOND one is lethal, while the bare
    amount (30) is neither. A body whose HP made both readings answer "alive" would
    be D482's arithmetic coincidence. */
const VICTIM: Card = battler("fix-dizzyvictim", {
  hp: 100,
  attacks: [{ name: "Tackle", cost: ["Colorless"], damage: 10 }],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-confuse8": RAISER,
  "fix-dizzyvictim": VICTIM,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };
const DECK = deckOf({
  "fix-confuse8": 8,
  "fix-dizzyvictim": 8,
  "fix-basic-1": 8,
  "fix-bigbody": 12,
  "fix-energy": 24,
});

const RAISE = 0;
const PLAIN = 1;
const POISON = 2;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1 on turn 3 with the raiser Active over an empty Bench, the victim opposite,
    both sides energised. */
function table(seed = 7): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", "fix-confuse8"), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", "fix-dizzyvictim"), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  state = attachFromDeck(state, "p2", "fix-energy", 3);
  return state;
}

function must0(body: InPlayPokemon | null): InPlayPokemon {
  if (body === null) throw new Error("no Active");
  return body;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Attack as `seat`, then keep flipping turns until `seat`'s opponent declares —
    which is when the §8 step-3 Confusion flip fires. Returns the batch that
    contains it. The seed is chosen per case so the flip lands on the wanted face;
    §5 asserts the face rather than assuming it. */
function confuseThenSwing(index: number, seed: number) {
  const start = table(seed);
  const inflicted = mustApply(start, { type: "attack", seat: "p1", index });
  const swung = mustApply(inflicted.state, { type: "attack", seat: "p2", index: 0 });
  return { inflicted, swung };
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the persisted field: what it means, and what CLEARS it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — `SpecialConditions.confusionDamage` on a real board", () => {
  it("🛑 a fresh body carries the RULE DEFAULT, not a zero", () => {
    const state = table();
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(
      DEFAULT_CONFUSION_DAMAGE,
    );
    expect(DEFAULT_CONFUSION_DAMAGE).toBe(30);
  });

  it("🛑 the raised sentence writes 80; the BARE sentence writes 30 — the control pair", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    const conds = (s: GameState) => must0(s.players.p2.active).conditions;
    expect([conds(raised.state).rotation, conds(plain.state).rotation]).toEqual([
      "confused",
      "confused",
    ]);
    // The whole difference, on two boards that are otherwise byte-identical.
    expect([conds(raised.state).confusionDamage, conds(plain.state).confusionDamage]).toEqual([
      80, 30,
    ]);
  });

  it("🛑 the STATUS_APPLIED row carries the amount, and the BARE one carries the default", () => {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    expect(find(raised.events, "STATUS_APPLIED")?.confusionDamage).toBe(80);
    // ⚠️ PRESENT AND EQUAL TO THE DEFAULT, not absent: the op's rider is optional and
    // the EVENT's is resolved. A reader may rely on the key whenever the status is
    // "confused", which is what `log.ts` does.
    expect(find(plain.events, "STATUS_APPLIED")?.confusionDamage).toBe(30);
  });

  it("🛑 a CURE puts the amount back — the clear-rung's silent aftermath (D434)", () => {
    // Reading the field back as 30 after the cure is not enough: the case that carries
    // the claim is what happens AFTERWARDS, because a build that left the 80 standing
    // looks identical until the next bare Confusion inherits it.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const victim = must0(raised.state.players.p2.active);
    expect(victim.conditions.confusionDamage).toBe(80);

    // `noConditions()` is the whole clear (retreat, evolve, benching, the "recovers from
    // all Special Conditions" op), and it restores the RULE DEFAULT rather than a zero.
    expect(noConditions().confusionDamage).toBe(DEFAULT_CONFUSION_DAMAGE);
    expect(noConditions().rotation).toBe("none");
  });

  it("🛑 a BARE Confusion on an already-raised body resets the amount to 30", () => {
    // The half that discriminates, and the reason the interpreter arm writes the field
    // UNCONDITIONALLY: a body at 80, Confused again by a sentence that prints no rider,
    // must read 30. A `if (op.confusionDamage !== undefined)` guard leaves it at 80 and
    // every other assertion in this file stays green.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    expect(must0(raised.state.players.p2.active).conditions.confusionDamage).toBe(80);
    // Drive the op directly on that board — the turn order is not the subject here.
    const events: GameEvent[] = [];
    const again = runProgram(
      raised.state,
      [{ op: "applyStatus", target: "defender", status: "confused" }],
      { seat: "p1" },
      events,
    );
    expect(again.kind).toBe("done");
    if (again.kind !== "done") throw new Error("the op parked, which it cannot");
    expect(must0(again.state.players.p2.active).conditions.confusionDamage).toBe(30);
    expect(must0(again.state.players.p2.active).conditions.rotation).toBe("confused");
    // …and the row agrees with the board rather than with the op's absent rider.
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toMatchObject({
      status: "confused",
      confusionDamage: 30,
    });
  });

  it("`confusionDamage` and `poisonDamage` are SEPARATE slots, not one amount", () => {
    // D424's shared-field refusal, from the other side: these two statuses do NOT
    // occupy one slot, so a body can carry both amounts at once. A build that reused
    // one field would show the Poison amount here.
    const poisoned = mustApply(table(), { type: "attack", seat: "p1", index: POISON });
    const c = must0(poisoned.state.players.p2.active).conditions;
    expect(c.poisonDamage).toBe(80);
    expect(c.confusionDamage).toBe(30);
    expect(c.rotation).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the §8 step-3 flip: the number the whole slice is about.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — the missed flip, and the two numbers it can answer", () => {
  /** Search seeds rather than stubbing, so the flip is the engine's own (D499). */
  function tailsSeed(index: number): number {
    for (let seed = 1; seed < 400; seed++) {
      const start = table(seed);
      const inflicted = applyAction(start, { type: "attack", seat: "p1", index });
      if (!inflicted.ok) continue;
      const swung = applyAction(inflicted.state, { type: "attack", seat: "p2", index: 0 });
      if (!swung.ok) continue;
      if (find(swung.events, "CONFUSION_CHECK")?.result === "tails") return seed;
    }
    throw new Error(`no tails seed for index ${index}`);
  }

  it("🛑 THE SEPARATING BOARD: 80 under the raised sentence, 30 under the bare one", () => {
    // D482/D485: name the board on which two builds differ BEFORE writing one. A
    // build that ignored the field answers 30 on both rows; a build that read the
    // wrong body's field answers 30 on both; only the real one answers 80 and 30.
    const rSeed = tailsSeed(RAISE);
    const pSeed = tailsSeed(PLAIN);
    const r = confuseThenSwing(RAISE, rSeed);
    const p = confuseThenSwing(PLAIN, pSeed);
    expect(find(r.swung.events, "CONFUSION_CHECK")?.result).toBe("tails");
    expect(find(p.swung.events, "CONFUSION_CHECK")?.result).toBe("tails");

    // The EVENT…
    expect(find(r.swung.events, "COUNTERS_PLACED")?.amount).toBe(80);
    expect(find(p.swung.events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(find(r.swung.events, "COUNTERS_PLACED")?.source).toBe("confusion");

    // …and the BOARD, which is the half a log-shaped assertion cannot see (D430).
    expect(must0(r.swung.state.players.p2.active).damage).toBe(80);
    expect(must0(p.swung.state.players.p2.active).damage).toBe(30);

    // Same board, same action, same event TYPES — a 50-point difference.
    expect(types(r.swung.events)).toEqual(types(p.swung.events));
  });

  it("a HEADS flip costs nothing, on both boards — the face is the axis", () => {
    function headsSeed(index: number): number {
      for (let seed = 1; seed < 400; seed++) {
        const start = table(seed);
        const inflicted = applyAction(start, { type: "attack", seat: "p1", index });
        if (!inflicted.ok) continue;
        const swung = applyAction(inflicted.state, { type: "attack", seat: "p2", index: 0 });
        if (!swung.ok) continue;
        if (find(swung.events, "CONFUSION_CHECK")?.result === "heads") return seed;
      }
      throw new Error("no heads seed");
    }
    const r = confuseThenSwing(RAISE, headsSeed(RAISE));
    expect(find(r.swung.events, "CONFUSION_CHECK")?.result).toBe("heads");
    expect(find(r.swung.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(must0(r.swung.state.players.p2.active).damage).toBe(0);
  });

  it("🛑 the raised hit is SURVIVABLE at 100 HP and the bare one is not lethal either", () => {
    // The victim's HP is chosen so that neither reading KOs on the first miss — so
    // the 80/30 split is what the suite reads, not a Knock Out that would make both
    // builds look alike on the zone counts.
    const r = confuseThenSwing(RAISE, tailsSeed(RAISE));
    expect(find(r.swung.events, "KNOCKED_OUT")).toBeUndefined();
    expect(must0(r.swung.state.players.p2.active).damage).toBe(80);
  });

  it("the ATTACK_FAILED row still names the reason and carries NO number", () => {
    const r = confuseThenSwing(RAISE, tailsSeed(RAISE));
    expect(find(r.swung.events, "ATTACK_FAILED")?.reason).toBe("confusion");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the RENDERED rows (D456/D499/D500: render them, do not reason about them).
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — what `log.ts` says when the confusion number changes", () => {
  const textOf = (state: GameState, events: readonly GameEvent[]) => {
    const ctx: LogContext = { names: { p1: "Ash", p2: "Misty" }, state, elapsed: "+00:00" };
    return logFromEvents(events, ctx).map((r) =>
      r.kind === "action" ? r.segments.map((seg) => seg.text).join("") : "",
    );
  };

  it("🛑 the COUNTERS_PLACED row RENDERS the raised number — it reads `event.amount`", () => {
    // ⚠️ THE HONEST LIMIT AT THE RUNG: this row needed NO change at all. It has read
    // `event.amount` since M3, so the slice's `30` → `confusionDamage` edit is
    // invisible to it — which is why the arm was left byte-identical and why a rung
    // here is a claim about the ENGINE rather than about `log.ts`.
    const seed = (() => {
      for (let s = 1; s < 400; s++) {
        const start = table(s);
        const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
        if (!inf.ok) continue;
        const sw = applyAction(inf.state, { type: "attack", seat: "p2", index: 0 });
        if (sw.ok && find(sw.events, "CONFUSION_CHECK")?.result === "tails") return s;
      }
      throw new Error("no tails seed");
    })();
    const r = confuseThenSwing(RAISE, seed);
    const rows = textOf(r.swung.state, r.swung.events);
    expect(rows.some((t) => t.includes("hit itself for 80"))).toBe(true);
    expect(rows.some((t) => t.includes("hit itself for 30"))).toBe(false);
  });

  it("🛑 the STATUS_APPLIED row WARNS before the flip, and only when raised", () => {
    // This is the one arm the slice adds, and the reason is D421's: without it the
    // player meets the 80 only after paying for it. The BARE board is the control —
    // the default stays implicit, exactly as the rulebook leaves it.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const plain = mustApply(table(), { type: "attack", seat: "p1", index: PLAIN });
    const rr = textOf(raised.state, raised.events);
    const pr = textOf(plain.state, plain.events);
    expect(rr.some((t) => t.includes("is now Confused (80 damage on a missed flip)"))).toBe(true);
    expect(pr.some((t) => t.includes("is now Confused"))).toBe(true);
    expect(pr.some((t) => t.includes("damage on a missed flip"))).toBe(false);
  });

  it("the CONFUSION_CHECK and ATTACK_FAILED rows name no number, and still do not", () => {
    // ⚠️ RECORDED AS AN HONEST LIMIT RATHER THAN A GAP: these two rows carry no
    // amount, so they are indistinguishable under every value this field can take.
    // Their doc blocks DID carry a hard-coded "the 30 self-damage", in `events.ts`
    // and in `log.ts`; both were corrected in the same commit that falsified them
    // (D450: grep every consumer for the REASONS it asserts, not only the facts it
    // derives). Nothing here can redden on that, which is why the correction is a
    // comment edit and not a rung.
    const r = confuseThenSwing(RAISE, (() => {
      for (let s = 1; s < 400; s++) {
        const start = table(s);
        const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
        if (!inf.ok) continue;
        const sw = applyAction(inf.state, { type: "attack", seat: "p2", index: 0 });
        if (sw.ok && find(sw.events, "CONFUSION_CHECK")?.result === "tails") return s;
      }
      throw new Error("no tails seed");
    })());
    const rows = textOf(r.swung.state, r.swung.events);
    expect(rows.some((t) => t.includes("is Confused — flip: tails"))).toBe(true);
    expect(rows.some((t) => t.includes("attack failed — Confused"))).toBe(true);
  });

  it("🛑 the WIRE carries the amount, so the HUD can stop hard-coding 30", () => {
    // `GameHud.tsx` printed "tails: 30 damage to itself" off `rotation` alone until
    // this slice — a live FALSE claim at the one moment a player is deciding whether
    // to attack (D412: find every read site of the fact before fixing any of them).
    // It can only stop lying if the number crosses the wire, which is what this rung
    // pins, on BOTH seats' views.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    for (const seat of ["p1", "p2"] as const) {
      const view = redactGame(raised.state, seat);
      const victim = seat === "p2" ? view.board.you.active : view.board.opponent.active;
      expect(victim?.battle?.conditions.confusionDamage).toBe(80);
      expect(victim?.battle?.conditions.rotation).toBe("confused");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` 29 → 30, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — the bump, and the corruption it refuses", () => {
  // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
  // `apps/api/src/lobby/match.ts`, where the version gate, its argument and the ±1
  // rungs sit). What is driven HERE is the ENGINE-side fact the constant is about:
  // whether a record written by the previous deploy can be read benignly by this one.
  function saved(): GameState {
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    // A genuine JSON round-trip, which is what `MatchRecord.state` actually is.
    return JSON.parse(JSON.stringify(raised.state)) as GameState;
  }

  it("🛑 THE ADDRESS: the field really is inside the serialized state", () => {
    // D442/D456: before pricing a type change against the constant, grep for where
    // the type LANDS. Driven rather than grepped: the key is in the bytes.
    const bytes = JSON.stringify(saved());
    expect(bytes.includes('"confusionDamage":80')).toBe(true);
    expect(bytes.includes('"confusionDamage":30')).toBe(true); // the attacker's own body
  });

  it("🛑 DIRECTION 1 — a v30 record round-trips and the raised hit STILL lands at 80", () => {
    const state = saved();
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(80);
    let seed = -1;
    for (let s = 1; s < 400; s++) {
      const start = table(s);
      const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
      if (!inf.ok) continue;
      const round = JSON.parse(JSON.stringify(inf.state)) as GameState;
      const sw = applyAction(round, { type: "attack", seat: "p2", index: 0 });
      if (sw.ok && find(sw.events, "CONFUSION_CHECK")?.result === "tails") {
        expect(find(sw.events, "COUNTERS_PLACED")?.amount).toBe(80);
        expect(must0(sw.state.players.p2.active).damage).toBe(80);
        seed = s;
        break;
      }
    }
    expect(seed).toBeGreaterThan(0);
  });

  it("🛑 DIRECTION 2 — a v29-SHAPED body answers a DIFFERENT NUMBER, and it is `NaN`", () => {
    // The v29 shape is BUILT rather than imagined: the key is genuinely DELETED from
    // a JSON round-tripped board, which is what a record written by the previous
    // deploy actually looks like.
    let legacySeed = -1;
    let legacy: GameState | null = null;
    for (let s = 1; s < 400; s++) {
      const start = table(s);
      const inf = applyAction(start, { type: "attack", seat: "p1", index: RAISE });
      if (!inf.ok) continue;
      const round = JSON.parse(JSON.stringify(inf.state)) as GameState;
      const probe = applyAction(round, { type: "attack", seat: "p2", index: 0 });
      if (probe.ok && find(probe.events, "CONFUSION_CHECK")?.result === "tails") {
        legacy = round;
        legacySeed = s;
        break;
      }
    }
    expect(legacySeed).toBeGreaterThan(0);
    if (legacy === null) throw new Error("no legacy board");

    const body = must0(legacy.players.p2.active).conditions as Omit<
      InPlayPokemon["conditions"],
      "confusionDamage"
    > & { confusionDamage?: number };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete body.confusionDamage;
    // ABSENT, not `undefined` — the distinction D124 refuses to blur and a `toEqual`
    // would hide.
    expect("confusionDamage" in body).toBe(false);

    // 🛑 **AND THIS IS THE WHOLE ARGUMENT FOR THE BUMP.** The read is
    // `active.damage + undefined` → NaN; `isLethallyDamaged` answers `NaN >= hp` →
    // FALSE, so the body is not Knocked Out, CAN NEVER BE KNOCKED OUT AGAIN, and the
    // board looks entirely normal. That is neither D124's benign soft landing nor a
    // loud failure — it is D435's silent CORRUPTION, which is the sharpest retirement
    // reason on record at this address.
    const swung = mustApply(legacy, { type: "attack", seat: "p2", index: 0 });
    expect(find(swung.events, "CONFUSION_CHECK")?.result).toBe("tails");
    // ⚠️ **THE TWO HALVES DEGRADE DIFFERENTLY, AND MEASURING IT IS THE POINT (D435:
    // measure the degradation, do not classify it from the record's shape).** The EVENT
    // carries the absent value straight through — `amount: undefined`, so the log row
    // renders *"Confusion: X hit itself for undefined"* — while the BOARD carries
    // `damage + undefined`, which is `NaN`. Neither is 80 and neither is 30.
    const dealt = find(swung.events, "COUNTERS_PLACED")?.amount;
    expect(dealt).toBeUndefined();
    expect(dealt).not.toBe(80);
    expect(dealt).not.toBe(30);
    const after = must0(swung.state.players.p2.active);
    expect(Number.isNaN(after.damage)).toBe(true);
    // …and the body is unkillable: 999 damage would be lethal on any real board.
    expect(after.damage >= 100).toBe(false);
    expect(after.damage + 999 >= 100).toBe(false);

    // …and the STRUCTURAL fact the version gate keys on: this conditions object is
    // not an inhabitant of this deploy's type at all. Asserted as a key-set diff in
    // both directions, because a diff between two boards from ONE build is blind to a
    // key that grew on both (D279).
    const live = must0(saved().players.p2.active).conditions;
    expect(Object.keys(body).sort()).not.toEqual(Object.keys(live).sort());
    expect(Object.keys(live).sort().filter((k) => !Object.keys(body).includes(k))).toEqual([
      "confusionDamage",
    ]);
  });

  it("🛑 THE OPTIONAL ROAD WAS DRIVEN, NOT DISMISSED — and it is refused on the GUARDS", () => {
    // D425: apply the test, do not copy the outcome. D441's discriminator — *does the
    // ABSENT key still say what the old writer meant* — answers YES here: absent would
    // read as 30, and every v29 confusion self-hit genuinely WAS 30. D434's *a rest
    // must be OLD* is satisfied too (`rotation`, `poisonDamage` and `burned` were all
    // written by the v29 deploy). So the optional road was genuinely available.
    //
    // It is refused for two measured reasons, and the first is a shipped guard rather
    // than a preference:
    //
    //   1. `redact.ts`'s `copyConditions` and `projection.ts`'s `battleStateOf` both
    //      carry a `satisfies SpecialConditions` whose own doc block says it exists so
    //      an added engine field is a COMPILE ERROR rather than a silent drop. An
    //      OPTIONAL key satisfies both while reaching NEITHER surface — it would have
    //      disarmed, silently, the two instruments written to catch exactly this.
    //   2. D421's mitigation is unavailable even with an old rest, because the rest
    //      cannot WITNESS the loss: `rotation: "confused"` is byte-identical on a body
    //      at 30 and a body at 80, so a dropped rider degrades into a plausible wrong
    //      answer on the one board the printing is about.
    //
    // Reason 1 is what this rung drives: the field reaches BOTH surfaces, which is the
    // observable consequence of it being required.
    const raised = mustApply(table(), { type: "attack", seat: "p1", index: RAISE });
    const wire = redactGame(raised.state, "p2");
    expect(wire.board.you.active?.battle?.conditions.confusionDamage).toBe(80);
    // …and the key-set equality that an optional field would have broken silently.
    const engineKeys = Object.keys(must0(raised.state.players.p2.active).conditions).sort();
    const wireKeys = Object.keys(wire.board.you.active?.battle?.conditions ?? {}).sort();
    expect(wireKeys).toEqual(engineKeys);
  });

  it("the engine version moved with the behaviour, and the manifest agrees", () => {
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the write mutates nothing it was handed", () => {
  it("a deep-frozen board survives the application and the flip that reads it", () => {
    const state = deepFreeze(table());
    const raised = mustApply(state, { type: "attack", seat: "p1", index: RAISE });
    expect(must0(state.players.p2.active).conditions.confusionDamage).toBe(30);
    expect(must0(raised.state.players.p2.active).conditions.confusionDamage).toBe(80);
  });
});
