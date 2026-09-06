import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  parseAttackDamage,
  programFor,
} from "./index";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { MAX_UNTIL_TAILS_FLIPS, flipCoin, flipUntilTails } from "./rng";
import {
  FIXTURE_POOL,
  UNTIL_TAILS_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.79.0 → 0.80.0 — the UNBOUNDED FOLD (D129). "Flip a coin until you get tails.
// This attack does D [more] damage for each heads." — Growlithe sv01-030
// "Relentless Flames" ({R}, 30×) and Chansey sv01-144 "Egg Rolling" ({C}{C}{C},
// 60×) are the MULTIPLY form; Bouffalant sv03-174 "Damage Rush" ({C}{C}, 50+) is
// the pool's only ADDITIVE one.
//
//   THE FIRST FLIP COUNT BOUNDED BY NEITHER THE TEXT NOR THE BOARD.
//
// D126 built the seam (a printed flip is taken in FRONT of the §8.5 pipeline, at
// §8 step 3's site, because a flip that gates or scales damage cannot be an effect
// PROGRAM — programs run at attack.ts's tail, strictly after the number is
// computed). D127 put a bounded LOOP on it and read the bound out of the sentence.
// D128 read the bound off the BOARD. This slice has no bound to read from either
// place: "until you get tails" is a fact about the RNG, and the count is a property
// of the FACES — known only once they are drawn.
//
// SO THE RESOLUTION SIDE RETURNS A SEQUENCE, NOT A COUNT, and that is the whole
// shape change. D128's `flipCount` computed a number and handed it to a `for` loop,
// which is the only reading `printed` and `attachedEnergy` admit; asking "how many
// times?" first for THIS member would mean flipping to find out how many times to
// flip. `takeFlips` answers all three members with one signature, and attack.ts's
// flip block has no `untilTails` branch in it at all — which is the point.
//
// AND THE TERMINATION ARGUMENT IS THIS SLICE'S REAL COST. There is nothing to
// refuse (the sentence is legal and fully specified, unlike a malformed printed N)
// and nothing to bound (the board answers nothing), so D127's ceiling has no
// purchase here. What buys the loop's safety is a fact about mulberry32 that can be
// MEASURED rather than assumed: its pre-states advance by a fixed odd stride, so
// the face sequence is ONE fixed cycle over 2³² steps, and the longest run of
// consecutive heads anywhere in that cycle is 31. `MAX_UNTIL_TAILS_FLIPS = 64` is
// twice that — a guard that is dead code by construction, which is exactly what a
// guard of this kind should be. The `flipUntilTails` block below is the largest in
// this file, because a bound nothing can reach is a bound nothing tests unless the
// test drives the parameter directly.
//
// BOTH DAMAGE MEMBERS ARE REACHED BY ONE FLIP COUNT, and that is the slice's one
// surprise. D128 widened a field because the consequent was untouched; here the
// word "more" moves the printed base between KEPT and DROPPED, which is the one
// difference the coin union already spends two members on. So the additive form is
// `bonusOnHeads` (base 50 kept, +30 per heads) and the multiply form is `perHeads`
// (base dropped, 30 per heads) — the SAME two members, now reached by a second flip
// count, and `bonusOnHeads` had to grow a `flips` field to say so. Its D126
// printings now read `{ kind: "printed", count: 1 }`, which is what they always
// were implicitly.
//
// THE PAIR THAT PINS THE TWO MEMBERS APART IS THE ZERO-HEADS OUTCOME. On a first
// flip of tails, Growlithe deals NOTHING (0 × 30, printed base dropped, no
// DAMAGE_DEALT row at all) and Bouffalant deals exactly 50 (printed base kept, one
// flip row, no bonus). One flip, one seed, two numbers that cannot be confused —
// and the outcome a build that collapsed the members into one would get wrong on
// every card in the file. It has its own case below and is asserted explicitly.
//
// 🆕🆕 **D463 — KROOKODILE sv01-117 IS BUILT, AND THE PARAGRAPH BELOW IS KEPT AS THE
// RECORD OF WHAT IT USED TO CLAIM.** Its sentence (corpus file line 234) now derives
// `programPerHeads` over `untilTails` carrying the shipped `discardEnergy` op, so this
// file's end-to-end witness is RE-POINTED from "stays loud" to "derives, flips, and
// still lands its flat 50" rather than deleted (D418) — what the old claim caught was
// that the two D129 regexes are anchored on the WHOLE sentence, and the new one catches
// that plus WHICH member the whole sentence reads to.
// 🛑 **AND THE SECOND ENTRY OF `FOR_EACH_HEADS` IS A STRING NO CARD PRINTS.** D452
// measured this and corrected it in `perHeadsProgram.test.ts`; the same invented string
// — Krookodile's OPENING glued to Masquerain's consequent — was left standing here, and
// is labelled rather than deleted below, because as a NEVER-PRINTED near-miss it is
// still the sharpest refusal witness this file has.
//
// AND TWO PRINTINGS OF THE SAME LEADING SENTENCE STAY LOUD. Krookodile sv01-117
// and Masquerain sv03-007 print "Flip a coin until you get tails. For each heads,
// <effect>." — an EffectOp repeated per heads rather than a number folded, which is
// a different mechanism at a different site. They differ from the five mapped
// sentences ONLY in the consequent, which makes them the sharpest witnesses this
// file has: they are what says the two new regexes are anchored on their whole
// sentence and not on the opening they share. Krookodile is fielded rather than
// merely derived, so the claim is END TO END — it reaches ATTACK_EFFECT_SKIPPED,
// takes NO flip at all, and still lands its printed 50.
//
// THERE WERE THREE, AND D130 MAPPED ONE OF THEM. Gyarados swsh10.5-022 ("For each
// heads, discard the top 2 cards of your opponent's deck.") was this file's
// end-to-end LOUD witness until the per-heads PROGRAM member was built; it now
// derives to `programPerHeads` and lives in perHeadsProgram.test.ts. The witness
// was RE-POINTED at Krookodile rather than deleted (docs/progress.md's standing
// rule): a witness left asserting "stays loud" after it is mapped is a failing
// test, and one quietly removed is worse — it takes the disjointness claim with it.
// Krookodile is the survivor that can be fielded (its flat `damage: 50` gives the
// declaration something to land); Masquerain prints no damage and stays
// deriver-level, exactly as it was.

/** Growlithe sv01-030 "Relentless Flames", verbatim, and pinned char-for-char
    against FIXTURE_POOL below. Growlithe carries no authored program (see the
    ZERO-rows block), so the sentence IS the wiring: a drifted character does not
    throw, it drops the card onto the loud ATTACK_EFFECT_SKIPPED path AND lets the
    printed 30 land flat every time, which is a wrong number rather than a missing
    one. Rellor sv02-026's "Ball Roll" is this string BYTE FOR BYTE. */
const RELENTLESS_FLAMES =
  "Flip a coin until you get tails. This attack does 30 damage for each heads.";

/** Rellor sv02-026 "Ball Roll", verbatim — and deliberately spelled out rather than
    aliased to the constant above, because the fact that the two are IDENTICAL is
    what D121's warrant rests on. Two printings, on cards of different types, costs
    and sets, and not even one token varies: that is a shape, not a row. */
const BALL_ROLL = "Flip a coin until you get tails. This attack does 30 damage for each heads.";

/** Forretress sv01-139 "Continuous Spin", verbatim — the family's middle per (50).
    Covered at the DERIVER level only and deliberately without a board case: it is
    byte-identical to Growlithe's sentence except for its per-heads amount, so an
    end-to-end case would re-run Growlithe's arithmetic with a different constant.
    What it DOES prove is that `per` is captured rather than assumed. */
const CONTINUOUS_SPIN =
  "Flip a coin until you get tails. This attack does 50 damage for each heads.";

/** Chansey sv01-144 "Egg Rolling", verbatim — the family's LARGEST per (60), and
    the second card the board cases run, for the reason D127 fielded two: one
    printing cannot tell a `per` READ off the regex from a hardcoded 30. */
const EGG_ROLLING = "Flip a coin until you get tails. This attack does 60 damage for each heads.";

/** Bouffalant sv03-174 "Damage Rush", verbatim — the ADDITIVE printing, and the one
    word ("more") that separates the two arms. Its "50+" marker is the reason the
    printed base is KEPT here and dropped on all four of its siblings. */
const DAMAGE_RUSH =
  "Flip a coin until you get tails. This attack does 30 more damage for each heads.";

/** The TWO printings that share D129's leading sentence and stay UNMAPPED after
    D130 — Krookodile sv01-117 "Chomp Chomp Bite" and Masquerain sv03-007
    "Panic-Prompting Pattern", verbatim off the local D1 (2026-08-01). Each repeats
    an EffectOp per heads instead of folding a number, which is a different
    mechanism at a different site (an effect PROGRAM runs at attack.ts's tail, where
    these five sentences must land in FRONT of the §8.5 pipeline). They are the
    suite's own "stays LOUD" witnesses.

    D130 BUILT THAT MECHANISM AND STILL DID NOT REACH THESE TWO, which is what makes
    them better witnesses now than they were. Its expansion appends `heads` copies
    of a DETERMINISTIC, NON-PARKING op to the attack's program; Krookodile's
    `discardEnergy` PARKS on a choice (N heads is N sequential parks across a
    serialized continuation) and Masquerain's would be the first EffectOp in the
    engine to consume `state.rngState`. Their refusal is therefore no longer "no
    regex yet" — it is a cost neither slice has paid.

    🆕🆕 **D463 — [0] IS BUILT AND [1] IS NOT A PRINTED SENTENCE AT ALL. BOTH HALVES OF
    "verbatim off the local D1 (2026-08-01)" ABOVE ARE NOW KNOWN TO BE WRONG, in opposite
    directions.**
      · **[0], Krookodile sv01-117** — verbatim, and `censusAttackCorpus.ts` FILE LINE 234.
        D463 built it: `programPerHeads` over `untilTails` carrying `discardEnergy
        {from: "opponentActive", filter: {kind: "anyEnergy"}}`. The cost D452 priced (an
        N-park drive, and this witness re-pointed across five files) was paid, not avoided.
      · **[1], "Masquerain's"** — 97 characters that the `legal_standard = 1` column prints
        **ZERO** times. It is Krookodile's OPENING glued to Masquerain's consequent;
        Masquerain's real sentence is 78 characters and opens *"Flip 3 coins."* (corpus
        file line 216, BUILT at D452). D452 found this and repaired its own file; this one
        was missed, and the byte pin below was green and false for the whole of that time.
    🛑 **[1] IS KEPT, RELABELLED, RATHER THAN CORRECTED IN PLACE OR DELETED.** As a
    *printed* sentence it was never real; as a **NEVER-PRINTED NEAR-MISS** it is the best
    refusal witness in this file — it shares D129's opening byte for byte and its
    consequent is one this engine now derives at a DIFFERENT opening, so a regex that
    dropped its leading anchor would read it. Correcting it to Masquerain's real sentence
    would delete that; deleting it would delete it twice over. ⚠️ **DO NOT ASSERT IT IS IN
    `legalAttackCorpus()` — IT IS NOT, AND §1 SAYS SO EXECUTABLY.** */
const FOR_EACH_HEADS = [
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
] as const;

/** Gyarados swsh10.5-022 "Wreak Havoc", verbatim — the printing that USED to be the
    third member of the list above and is MAPPED as of D130 (`programPerHeads` over
    `untilTails`, expanding to one `discardDeckTop { whose: "opponent", count: 2 }` per heads).
    Kept here, out of the loud list, for one job: it is the sentence closest to this
    file's five and it must now derive to something OTHER than a fold, which is a
    sharper disjointness claim than a null ever was. */
const WREAK_HAVOC =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

/** The leading sentence all EIGHT printings share, char-for-char. It is what denies
    `^Flip a coin\.` its literal period and `^Flip (\d+) coins\.` its digits — the
    property that keeps this slice's two regexes disjoint from all four siblings —
    and, within the slice, it is the half the three LOUD printings also carry, which
    is why the anchoring has to reach the consequent. */
const UNTIL_TAILS_OPENING = "Flip a coin until you get tails. ";

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss cases
    below name it instead of carrying it — the mistake this guards against is
    exactly the mistake a literal would make in this file. */
const NBSP = " ";

/** U+00D7, likewise spelled as an escape. It is the printed damage marker on the
    four multiply printings and the ONE non-ASCII character anywhere in their card
    data, so the `damage` assertions name it rather than typing a character that is
    one keystroke from an ASCII "x". */
const TIMES = "×";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no platform
    global is in scope and `tsc -b` — which CI runs — would reject it. Copied rather
    than shared with the three sibling coin suites, where it is local for the same
    reason: testFixtures.ts is a fixture module, not a string library. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

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

/** Growlithe and Bouffalant each print exactly ONE attack, so index 0 cannot be got
    wrong; Chansey prints a flat "Pound" first, which puts Egg Rolling at index 1 and
    also gives this suite its control for "the coin reader is keyed to the TEXT of
    the attack declared, not to the card carrying it". Named rather than inlined, so
    a reprint that added or reordered an attack fails on the fixture guards below
    rather than silently moving every board case onto the wrong sentence. */
const FLIP_INDEX = 0;
const EGG_INDEX = 1;
const POUND_INDEX = 0;

/** How far the seed sweeps run, and it is MEASURED on THIS deck, not inherited.
    Sweeping seeds 0..199, the first seed reaching each heads count is:

      0 heads → seed 0     3 heads → seed 3     7 heads → seed 142
      1 head  → seed 6     4 heads → seed 53    8 heads → seed 120
      2 heads → seed 30    5 heads → seed 2

    ALL THREE OF 0, 1 AND 2 BY SEED 30, which is what sets 32 — the three sibling
    coin suites all run 24, and 24 is NOT enough here (it reaches {0, 1, 3, 5} and
    never 2). That is the unbounded fold's outcome space showing itself: the counts
    are not a small fixed set that a short sweep exhausts, they are a geometric tail,
    so the cases below assert the sweep SAW 0, 1 and 2 rather than asserting an exact
    set. The maximum reached inside 32 seeds is 5 heads, which is what the defender's
    HP is chosen against.

    All three attackers draw off the SAME rngState at the flip site on a given seed
    (same deck, same setup, same surgery), so they see the same sequence and the only
    thing that differs between them is the arithmetic. That is a feature here: the
    `bonusOnHeads`/`perHeads` contrast can be stated on one seed. */
const SEEDS = 32;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first unrestricted
    turn, so the attack step is legal (§4).

    Both Active spots are pinned to fix-titan (340 HP, NO Weakness and NO Resistance,
    no attacks of its own) by SURGERY, as perEnergyFlip.test.ts does and for a reason
    this slice sharpens: an unbounded sequence has no PRINTED maximum, so the
    defender is chosen against the sweep's MEASURED worst case rather than against an
    arithmetic one. Five heads is the most any seed in range produces — 150 for
    Growlithe, 300 for Chansey, 50 + 150 = 200 for Bouffalant — and 340 survives all
    three. No swept seed may end on a Knock Out: a KO parks the turn on a promotion
    and truncates every sequence assertion after it. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: UNTIL_TAILS_FLIP_DECK, p2: UNTIL_TAILS_FLIP_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Growlithe in the seat's Active Spot with Relentless Flames' single {R} paid.
    SURGERY: all three attackers are Basic and COULD be dealt, but a swept seed
    cannot be relied on to deal any particular one, so every case fields its own. */
function growlitheActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-030"), seat, "fix-fire-energy", 1);
}

/** Chansey in the seat's Active Spot with Egg Rolling's {C}{C}{C} paid — three
    symbols, which also pays Pound's {C}{C} for the control case. */
function chanseyActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-144"), seat, "fix-energy", 3);
}

/** Bouffalant in the seat's Active Spot with Damage Rush's {C}{C} paid. Its own
    "Bouffer" passive reduces damage it TAKES and has nothing to say about an attack
    it makes, which is why the same card can be this file's attacker and five other
    suites' defender. */
function bouffalantActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-174"), seat, "fix-energy", 2);
}

/** Krookodile in the seat's Active Spot with Chomp Chomp Bite's single {F} paid —
    the UNMAPPED consequent, fielded so "stays LOUD" is a claim about a declared
    attack and not only about a null out of the deriver. It replaced Gyarados here
    when D130 mapped Gyarados's sentence; a Stage 2 reaches the Active Spot by the
    same surgery a Basic does. */
function krookodileActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-117"), seat, "fix-fighting-energy", 1);
}

/** The seat's Active damage — read straight off the board, so the "nothing happened"
    cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

/** Take `count` flips from `state` by hand, returning the faces IN ORDER and the
    rngState they leave behind — D127's helper, re-declared locally as its two
    siblings do. It is the ONE-STEP-EITHER-SIDE probe in this file rather than the
    main account: `flipUntilTails` is what the engine calls, so the main account
    compares against that, and this is what names the states the engine did NOT
    reach. */
function foldFlips(state: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let rng = state;
  for (let i = 0; i < count; i += 1) {
    const [face, next] = flipCoin(rng);
    faces.push(face);
    rng = next;
  }
  return [faces, rng];
}

/** The heads count off the emitted rows — the number every damage assertion below is
    stated against. Counting it from the EVENTS rather than from a recomputed rng is
    deliberate: it makes each case a claim about what the engine REPORTED doing, and
    the rngState block is what separately proves the report is honest. */
function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** The faces off the emitted rows, IN ORDER — the sequence itself, which is the one
    thing this slice's event stream carries that a heads COUNT would throw away. */
function facesIn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Growlithe sv01-030", () => {
    const attack = FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(RELENTLESS_FLAMES);
    expect(attack?.name).toBe("Relentless Flames");
    // "30×" — a STRING, and the load-bearing field TWICE over. Its digits ARE the
    // per-heads amount, so the printed base must be DROPPED; and its "×" is the
    // modifier `modifierSimulated` has to claim. Typed as a number it would parse to
    // a bare 30 with no modifier and BOTH regressions would become invisible at once.
    expect(attack?.damage).toBe(`30${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // ONE symbol, which is what makes this the cheapest board in the family: the only
    // thing varying across a swept seed is the flip sequence.
    expect(attack?.cost).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-030"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-030"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Chansey sv01-144", () => {
    const attack = FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX];
    expect(attack?.effect).toBe(EGG_ROLLING);
    expect(attack?.name).toBe("Egg Rolling");
    expect(attack?.damage).toBe(`60${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason EGG_INDEX is 1 on this card: a
    // bare number with no effect and no modifier, on the same card and the same
    // board as the flip attack.
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.name).toBe("Pound");
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.damage).toBe(40);
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-144"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-144"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Bouffalant sv03-174 — the ADDITIVE one", () => {
    const attack = FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(DAMAGE_RUSH);
    expect(attack?.name).toBe("Damage Rush");
    // "50+" — the marker that KEEPS the printed base, and the entire reason this
    // printing lands on a different union member from its four siblings. A "+" is
    // one character from a "×" and the two mean opposite things about the base.
    expect(attack?.damage).toBe("50+");
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.damage).not.toContain(TIMES);
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv03-174"]?.attacks).toHaveLength(1);
    // …and it DOES carry an Ability ("Bouffer"), unlike every other card in this
    // file. It reduces damage the card TAKES, so it has nothing to say about an
    // attack the card makes — stated here because the ZERO-rows block below has to
    // make an exception for it and an unexplained exception is a bug in waiting.
    expect(FIXTURE_POOL["sv03-174"]?.abilities).toHaveLength(1);
    expect(FIXTURE_POOL["sv03-174"]?.abilities?.[0]?.name).toBe("Bouffer");
  });

  it("matches FIXTURE_POOL char-for-char for the two DERIVER-ONLY printings", () => {
    // Rellor and Forretress carry no board case (a board case on either would re-run
    // Growlithe's or Chansey's arithmetic on a captured number), but their text is
    // pinned all the same: the deriver cases below read it off the fixture, and a
    // fixture nobody pinned is a fixture that can drift into agreement with a wrong
    // constant.
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.effect).toBe(BALL_ROLL);
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.name).toBe("Ball Roll");
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.damage).toBe(`30${TIMES}`);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.effect).toBe(CONTINUOUS_SPIN);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.name).toBe("Continuous Spin");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.damage).toBe(`50${TIMES}`);
    // BALL ROLL IS RELENTLESS FLAMES, byte for byte — the fact D121's warrant rests
    // on, asserted rather than noted. Two printings, two sets, two types, two costs,
    // and not one token varies between the sentences.
    expect(BALL_ROLL).toBe(RELENTLESS_FLAMES);
    expect(FIXTURE_POOL["sv02-026"]?.types).not.toEqual(FIXTURE_POOL["sv01-030"]?.types);
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.cost).not.toEqual(
      FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.cost,
    );
  });

  it("matches FIXTURE_POOL char-for-char for the RE-POINTED Krookodile sv01-117", () => {
    const attack = FIXTURE_POOL["sv01-117"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FOR_EACH_HEADS[0]);
    expect(attack?.name).toBe("Chomp Chomp Bite");
    // A FLAT PRINTED 50 — a number, with NO modifier, which is what makes this the
    // end-to-end witness D130 could re-point the case onto. The loud row is one
    // claim; the printed damage landing unmodified is the other, and a card with no
    // damage at all (Masquerain) can only make the first.
    expect(attack?.damage).toBe(50);
    expect(typeof attack?.damage).toBe("number");
    expect(attack?.cost).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["sv01-117"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-117"]?.abilities).toBeNull();
  });

  it("keeps the RE-POINTED witness honest — Gyarados swsh10.5-022 is now MAPPED", () => {
    // The standing rule (docs/progress.md): a loud-skip witness this repo MAPS gets
    // re-pointed at another unmapped clause, never deleted. D130 mapped Gyarados, so
    // the end-to-end case above moved to Krookodile — and this is the assertion that
    // says the move was necessary rather than cosmetic.
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[FLIP_INDEX]?.effect).toBe(WREAK_HAVOC);
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toBeNull();
    // …and it derives to something that is NOT a fold, which is the disjointness
    // claim this file actually needs from it: it shares D129's leading sentence
    // verbatim and must still not reach either of D129's two members.
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).toBe("programPerHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).not.toBe("perHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).not.toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toHaveProperty("per");
    // …on the SAME flip count as the five folds in this file, which is the fact
    // D130 rests on: count and consequent are independent axes.
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toHaveProperty("flips.kind", "untilTails");
    expect(WREAK_HAVOC.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
  });

  it('splits the printed markers into base + "×" / "+" through parseAttackDamage', () => {
    // The exact hand-off the slice depends on: `parseAttackDamage` produces the
    // `base` that `scaledBase` either DROPS or KEEPS, and the `modifier` that
    // `modifierSimulated` claims. Asserting the split here means the end-to-end
    // claims below (30 × heads, 50 + 30 × heads, no ATTACK_EFFECT_SKIPPED) are about
    // attack.ts's decisions and not about a parse that quietly produced nothing.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX]?.damage)).toEqual({
      base: 60,
      modifier: TIMES,
    });
    // THE ONE THAT IS DIFFERENT. Bouffalant's modifier is "+", so its base is KEPT —
    // and 50 is NOT its per-heads amount, where 30 and 60 above are exactly that.
    expect(parseAttackDamage(FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 50,
      modifier: "+",
    });
    // The digits of a "×" marker and the `per` of the derived shape are THE SAME
    // NUMBER printed once — stated explicitly, because the whole "drop the base" rule
    // is only correct because of it. (Read through a narrowing check rather than
    // `?.per`: `cancelOnTails` has no such field, and the union is what says so.)
    for (const [text, damage] of [
      [RELENTLESS_FLAMES, `30${TIMES}`],
      [CONTINUOUS_SPIN, `50${TIMES}`],
      [EGG_ROLLING, `60${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
    // …and on the ADDITIVE printing the two numbers are DIFFERENT, which is the
    // sharpest statement this file can make that the marker is read separately from
    // the sentence: 50 is the base, 30 is the per.
    const rush = deriveAttackCoinFlip(DAMAGE_RUSH);
    if (rush?.kind !== "bonusOnHeads") throw new Error("expected a bonusOnHeads printing");
    expect(rush.per).toBe(30);
    expect(parseAttackDamage("50+").base).toBe(50);
    expect(parseAttackDamage("50+").base).not.toBe(rush.per);
    // …and the flat control carries NO modifier at all, which is why it can never be
    // confused for a member of this family.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.damage)).toEqual({
      base: 40,
      modifier: null,
    });
  });

  it("keeps the card facts the sequences are measured against", () => {
    expect(FIXTURE_POOL["sv01-030"]?.name).toBe("Growlithe");
    expect(FIXTURE_POOL["sv01-030"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-030"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-030"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv01-030"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-030"]?.weaknesses).toEqual([{ type: "Water", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv01-030"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv01-144"]?.name).toBe("Chansey");
    expect(FIXTURE_POOL["sv01-144"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-144"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv01-144"]?.hp).toBe(110);
    expect(FIXTURE_POOL["sv01-144"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-144"]?.weaknesses).toEqual([
      { type: "Fighting", value: `${TIMES}2` },
    ]);

    expect(FIXTURE_POOL["sv03-174"]?.name).toBe("Bouffalant");
    expect(FIXTURE_POOL["sv03-174"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-174"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv03-174"]?.hp).toBe(120);

    // THE NEUTRAL DEFENDER HAS NEITHER WEAKNESS NOR RESISTANCE, so every total in
    // this file is the printed number unmodified — and 340 HP is above the sweep's
    // measured worst case (5 heads: 150 / 300 / 200), so no seed ends on a Knock Out
    // and truncates a sequence assertion. It also has NO attacks, so nothing it does
    // can interleave with the rows being counted.
    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
  });

  it("pins the BYTES — and that all five mapped sentences are PURE ASCII", () => {
    // The census D126's and D127's sentences passed and D128's failed: none of these
    // five names a Pokémon, so there is no "Pokémon" é in any of them and bytes and
    // code points are EQUAL. The three multiply sentences are 75 characters each and
    // differ from one another in exactly two digits; the additive one is 80, and the
    // five extra characters are the space and the word "more".
    expect(RELENTLESS_FLAMES.length).toBe(75);
    expect(utf8Bytes(RELENTLESS_FLAMES)).toBe(75);
    expect(CONTINUOUS_SPIN.length).toBe(75);
    expect(EGG_ROLLING.length).toBe(75);
    expect(DAMAGE_RUSH.length).toBe(80);
    expect(utf8Bytes(DAMAGE_RUSH)).toBe(80);
    expect(DAMAGE_RUSH.length - RELENTLESS_FLAMES.length).toBe(" more".length);
    for (const sentence of [
      RELENTLESS_FLAMES,
      BALL_ROLL,
      CONTINUOUS_SPIN,
      EGG_ROLLING,
      DAMAGE_RUSH,
    ]) {
      // PURE ASCII, asserted over the characters rather than inferred from the equal
      // totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP); // the invisible drift
      // The "×" lives in the DAMAGE field, never in the effect text — the one place
      // in this slice a non-ASCII character legitimately appears.
      expect(sentence).not.toContain(TIMES);
      // The shared LEADING sentence, char-for-char: the literal that denies D126 its
      // period and D127 its digits.
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
      expect(sentence.startsWith("Flip a coin.")).toBe(false);
      expect(sentence.startsWith("Flip 2 coins.")).toBe(false);
      // …and the shared TRAILING clause, which is D127's and D128's verbatim. The
      // consequent is not what tells these families apart — the opening is.
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      // No trailing or leading whitespace on the printed row.
      expect(sentence).toBe(sentence.trim());
    }
    // "more" appears on EXACTLY ONE of the five, and that one word is the whole
    // difference between a kept base and a dropped one.
    expect(
      [RELENTLESS_FLAMES, CONTINUOUS_SPIN, EGG_ROLLING, DAMAGE_RUSH].filter((s) =>
        s.includes("more"),
      ),
    ).toEqual([DAMAGE_RUSH]);
    // The three multiply sentences differ from each other in exactly their per.
    expect(RELENTLESS_FLAMES.replace("30", "50")).toBe(CONTINUOUS_SPIN);
    expect(RELENTLESS_FLAMES.replace("30", "60")).toBe(EGG_ROLLING);
    // …and the additive one is the multiply one plus one word, which is what makes
    // the two regexes' disjointness a claim about `(\d+) damage` refusing to span
    // "30 more damage" rather than about two unrelated patterns.
    expect(RELENTLESS_FLAMES.replace(" damage", " more damage")).toBe(DAMAGE_RUSH);
  });

  it("pins the TWO unmapped sentences too — same opening, different consequent", () => {
    // The witnesses are pinned char-for-char for the same reason the mapped ones are:
    // the claim below is that they are refused by the CONSEQUENT, and that is only a
    // claim if the opening they share is byte-identical to the mapped one.
    for (const sentence of FOR_EACH_HEADS) {
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
      expect(sentence).toContain("For each heads,");
      // …and NONE of them says "damage for each heads" at all: they repeat an
      // EffectOp, they do not fold a number, which is why they belong at a different
      // site and not merely on a different regex.
      expect(sentence).not.toContain("damage for each heads");
      expect(sentence).not.toContain("This attack does");
      expect(sentence).toBe(sentence.trim());
    }
    // Krookodile's names a Pokémon and so carries the family's only é; Masquerain's
    // is pure ASCII. Pinned because a re-ingest that mangled the accent would change
    // that sentence and nothing else in this file.
    expect(FOR_EACH_HEADS[0].length).toBe(103);
    expect(utf8Bytes(FOR_EACH_HEADS[0])).toBe(104);
    expect(FOR_EACH_HEADS[1].length).toBe(97);
    expect(utf8Bytes(FOR_EACH_HEADS[1])).toBe(97);
    // The re-pointed-away sentence is pinned by the same rule and for a new reason:
    // its length is what says the two witnesses above were not merely renamed.
    expect(WREAK_HAVOC.length).toBe(97);
    expect(utf8Bytes(WREAK_HAVOC)).toBe(97);
    expect(WREAK_HAVOC).not.toBe(FOR_EACH_HEADS[1]);
  });

  it("🆕🆕 D463 — [0] IS a corpus row and [1] is NOT, said off the measured column", () => {
    // 🛑 **THE REPAIR IS THE SOURCE, NOT THE PIN** (D452's rule, paid here on the file it
    // was never applied to). The byte pins above were green for the whole life of this
    // array while [1] was a hand-retyped OPENING glued to another card's consequent — and
    // no pin on a whole string can catch that, because the invented string really is 97
    // characters. Membership in `legalAttackCorpus()` can, and this is the rung that says
    // so. It is deliberately the LAST assertion about these two strings rather than the
    // first, so that reading the file top to bottom reaches the pins and then the fact the
    // pins could not establish.
    const corpus = new Set(legalAttackCorpus().map(([, sentence]) => sentence));
    expect(corpus.has(FOR_EACH_HEADS[0])).toBe(true);
    expect(corpus.has(FOR_EACH_HEADS[1])).toBe(false);
    // …and the sentence [1] was MEANT to be — Masquerain sv03-007's, corpus file line 216
    // — is in the column, is 78 characters, and opens with a PRINTED count. Named so the
    // absence above is attributable to the opening rather than to the consequent.
    const masquerain = "Flip 3 coins. For each heads, discard a random card from your opponent's hand.";
    expect(corpus.has(masquerain)).toBe(true);
    expect(masquerain).toHaveLength(78);
    expect(FOR_EACH_HEADS[1].endsWith(masquerain.slice("Flip 3 coins. ".length))).toBe(true);
    // …and the corpus prints EXACTLY ONE `until you get tails. For each heads,` row: [0].
    // A TOTAL check rather than a claim about two strings — if a re-ingest ever added a
    // second, the anchors above would owe it an answer and this reddens instead of
    // quietly covering it.
    const untilTailsRepeats = legalAttackCorpus().filter(
      ([, s]) => s.startsWith(UNTIL_TAILS_OPENING) && s.includes("For each heads,"),
    );
    expect(untilTailsRepeats.map(([, s]) => s)).toEqual([FOR_EACH_HEADS[0]]);
  });
});

describe("deriveAttackCoinFlip — the FIFTH shape, on two regexes and ZERO table rows", () => {
  it("reads all FOUR multiply printings to perHeads/untilTails, with their own per", () => {
    // 30 twice (Growlithe and Rellor, byte-identical), 50 and 60 — every per the
    // pool prints for this sentence, off ONE regex and no table. A reader built on
    // literal sentences would need four rows for what is one shape with one hole.
    for (const [text, per] of [
      [RELENTLESS_FLAMES, 30],
      [BALL_ROLL, 30],
      [CONTINUOUS_SPIN, 50],
      [EGG_ROLLING, 60],
    ] as const) {
      expect(deriveAttackCoinFlip(text)).toEqual({
        kind: "perHeads",
        flips: { kind: "untilTails" },
        per,
      });
    }
    // THE MEMBER IS THE POINT, not just the number. `printed` would mean "flip this
    // many times whatever the faces say" and `attachedEnergy` would ask the board a
    // question it cannot answer; both would be a different attack. Stated as a tag
    // assertion too, so a build that produced the right `per` under the wrong
    // constructor fails here rather than three cases down.
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).not.toHaveProperty("flips.count");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).not.toHaveProperty("flips.energy");
  });

  it("reads the ADDITIVE printing to bonusOnHeads/untilTails — the SAME count, the other member", () => {
    // Bouffalant, and the slice's one surprise: a single flip count reaches BOTH
    // damage members, because the flip COUNT and the printed BASE are independent
    // axes. The word "more" is what moves it, and `bonusOnHeads` had to grow a
    // `flips` field to receive it — D128's rule ("a bound is owed to the SOURCE of
    // the number") applied to the other member.
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    // The two arms produce the SAME flip count and DIFFERENT members off one word.
    // Stated as an equality and an inequality on the same pair, so neither half can
    // be satisfied by accident.
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)?.kind).not.toBe(
      deriveAttackCoinFlip(RELENTLESS_FLAMES)?.kind,
    );
  });

  it("carries NO PAYLOAD on the count — `untilTails` is one key wide", () => {
    // The whole vocabulary cost of the member, stated structurally. `printed` carries
    // a count and `attachedEnergy` carries a type filter; this one carries NOTHING,
    // because there is nothing at derivation OR at the flip site to carry — the
    // number is a property of the faces. That is also why `per >= 1` is the entire
    // validation in both new arms and why there is no ceiling: the bound that makes
    // this terminate belongs to the RNG, not to the sentence.
    for (const text of [RELENTLESS_FLAMES, EGG_ROLLING, DAMAGE_RUSH]) {
      const flip = deriveAttackCoinFlip(text);
      if (flip === null) throw new Error("unreachable");
      expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
      if (flip.kind === "cancelOnTails") throw new Error("unreachable");
      expect(Object.keys(flip.flips)).toEqual(["kind"]);
      // No `cond` and no `count` source: D126's rule is untouched. The DAMAGE count
      // still comes from the faces, so `scaledAttackDamage` stays pure and no
      // `DamageCountSource` member was added for the fifth time running.
      expect(flip).not.toHaveProperty("cond");
      expect(flip).not.toHaveProperty("count");
    }
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit. All five printings, including the two with no board case.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 50 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 60 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
  });

  it("reads a per no card prints — the shape is PARAMETERISED, not four rows", () => {
    // The pool prints 30, 50 and 60 for the multiply arm and 30 for the additive one.
    // Sweeping the whole scaling family's value range through both arms is what says
    // the number is captured rather than enumerated: a reader built on literal
    // sentences would pass the four cases above and fail every row here.
    for (const per of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 250]) {
      expect(
        deriveAttackCoinFlip(
          `${UNTIL_TAILS_OPENING}This attack does ${per} damage for each heads.`,
        ),
      ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per });
      expect(
        deriveAttackCoinFlip(
          `${UNTIL_TAILS_OPENING}This attack does ${per} more damage for each heads.`,
        ),
      ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per });
    }
  });
});

describe("the two new regexes are DISJOINT — from each other, and from all four siblings", () => {
  it("separates the arms by the word `more` — `(\\d+) damage` cannot span `30 more damage`", () => {
    // THE ORDER BETWEEN THE TWO ARMS IS FREE, and this is what says so. The additive
    // pattern is tested first only because it is the narrower sentence; if the
    // multiply pattern ran first it would still refuse Bouffalant, because its
    // `(\d+) damage` cannot match across the word "more". Asserted from both sides on
    // the same pair of strings, so the claim is about the patterns and not about the
    // order they happen to sit in.
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)?.kind).toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)?.kind).toBe("perHeads");
    // Deleting the one word turns the additive sentence into the multiply one, and
    // inserting it does the reverse. Two edits, two members, one flip count.
    expect(DAMAGE_RUSH.replace(" more", "")).toBe(RELENTLESS_FLAMES);
    expect(deriveAttackCoinFlip(DAMAGE_RUSH.replace(" more", ""))).toEqual(
      deriveAttackCoinFlip(RELENTLESS_FLAMES),
    );
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES.replace(" damage", " more damage"))).toEqual(
      deriveAttackCoinFlip(DAMAGE_RUSH),
    );
    // …and the `per` really is read from the digits either way, not defaulted from
    // the arm: 60 through the additive arm is a sentence no card prints and it still
    // reads 60.
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 60 more damage for each heads.`),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 60 });
  });

  it("leaves the four D126/D127/D128 readings EXACTLY as they were", () => {
    // A widened union is the classic place to break a sibling, and this slice's two
    // arms run AFTER all three of theirs — so the risk runs the other way too: a
    // pattern one character looser here could not swallow their sentences, but a
    // sentence of theirs that fell THROUGH to here would silently change member. All
    // four live readings, verbatim, through the widened deriver.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual(
      {
        kind: "bonusOnHeads",
        flips: { kind: "printed", count: 1 },
        per: 10,
      },
    );
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 30 });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 80 });
    // D126's `bonusOnHeads` printings are the ones D129 actually touched, and what it
    // touched is the COUNT and nothing else: `printed 1` is what they always were
    // implicitly, and the consequent (base KEPT, `heads × per` folded pre-W/R) did not
    // move. Bouffalant is the same member over a different count — stated as the
    // inequality that says the two counts are told apart.
    const litwick = deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.");
    const bouffalant = deriveAttackCoinFlip(DAMAGE_RUSH);
    expect(litwick?.kind).toBe(bouffalant?.kind);
    expect(litwick).toHaveProperty("flips.kind", "printed");
    expect(bouffalant).toHaveProperty("flips.kind", "untilTails");
  });

  it("is refused by all four SIBLING READERS, and refuses a live sentence of each", () => {
    // THE DOUBLE-READ CHECK, done EMPIRICALLY rather than by reading the regexes. The
    // risk is D127's exactly: the consequent "This attack does 30 damage for each
    // heads." is one clause away from `deriveAttackDamageMultiplier`'s whole family
    // ("… for each Prize card your opponent has taken."), and "heads" sits where that
    // reader expects a countable board fact. A cross-read would fold the damage TWICE
    // — once from a board count of 0 and once from the coin.
    for (const sentence of [RELENTLESS_FLAMES, CONTINUOUS_SPIN, EGG_ROLLING, DAMAGE_RUSH]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
    // The mirror, one live representative per family, so the nulls above are refusals
    // in both directions and not one reader being dead.
    const representatives = [
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — the additive "+" family on a count that reader
      // really does answer.
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      // deriveAttackDamageMultiplier — the "×" shape on a board count, and the
      // closest living relative of this slice's consequent.
      "This attack does 50 damage for each Prize card your opponent has taken.",
      // deriveAttackRequirement — D125's Palafin sentence.
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("the two `For each heads` sentences — one BUILT at D463, one never printed", () => {
  it("🆕🆕 D463 — [0] derives programPerHeads/untilTails; [1] stays NULL on every reader", () => {
    // Krookodile sv01-117 and Masquerain sv03-007. They print D129's leading sentence
    // VERBATIM and differ only in the consequent, which makes them the sharpest
    // disjointness witnesses this file has: if the new regexes were anchored on the
    // opening rather than on the whole sentence, these two would be read as folds of
    // a number that is not printed anywhere in them.
    //
    // WHY THEY ARE UNBUILT IS NOT "not yet", and it stopped being "no regex yet" when
    // D130 built the per-heads PROGRAM. That member expands "For each heads, X" into
    // `heads` copies of X at the flip site, which works only because X is
    // deterministic and never parks. Krookodile's X is a `discardEnergy` that PARKS
    // on a choice — N heads would be N sequential parks across a serialized
    // continuation — and Masquerain's would be the first EffectOp in the engine to
    // consume `state.rngState`. Both are real slices with costs of their own.
    // 🆕🆕 **D463 — [0] IS READ, AND BY EXACTLY ONE READER.** The four SIBLING readers
    // still refuse it, which is the disjointness claim this rung was always making and is
    // now making about a sentence that is CLAIMED rather than unclaimed — a stronger
    // statement, because a null everywhere is also what an unreachable string produces.
    // ⚠️ `deriveAttackEffect` refusing it is the sharpest of the four: `Chomp Chomp Bite`
    // ENDS in `FLIP_OPPONENT_ACTIVE_DISCARD`'s exact words, so that null is the leading `^`
    // and the mid-sentence lowercase "discard" doing their job (effects.ts says so at the
    // pattern), and a silent single discard is what it buys.
    expect(deriveAttackCoinFlip(FOR_EACH_HEADS[0])).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
    for (const sentence of FOR_EACH_HEADS) {
      // …and by nothing else in the family either, so what reads [0] is ONE reader and
      // what reads [1] is none.
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      // The opening really is the mapped one, so what separates the two is the CONSEQUENT
      // and not the `^` anchor.
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
    }
    // 🛑 **[1] STAYS NULL ON THE COIN READER TOO, AND IT IS THE ONE THAT MATTERS**: it is
    // D129's opening over D452's PRINTED-count consequent, so a reader that read the
    // consequent without its opening would claim a string the catalog prints zero times.
    expect(deriveAttackCoinFlip(FOR_EACH_HEADS[1])).toBeNull();
    // …while the same consequent at the opening the column really prints IS read (D452).
    expect(
      deriveAttackCoinFlip("Flip 3 coins. For each heads, discard a random card from your opponent's hand."),
    ).not.toBeNull();
    // …and swapping each one's consequent for the mapped one turns it into a sentence
    // this deriver reads, which is what makes the three nulls above a claim about
    // which half of the string was refused.
    for (const sentence of FOR_EACH_HEADS) {
      const swapped = `${UNTIL_TAILS_OPENING}This attack does 30 damage for each heads.`;
      expect(sentence.slice(0, UNTIL_TAILS_OPENING.length)).toBe(
        swapped.slice(0, UNTIL_TAILS_OPENING.length),
      );
      expect(deriveAttackCoinFlip(swapped)).not.toBeNull();
    }
  });

  it("🆕🆕 D463 — FLIPS, announces every face, and STILL lands its flat 50 — Krookodile", () => {
    // 🛑 **THE INVERTED WITNESS (D418), AND WHAT THE OLD CLAIM CAUGHT THAT THIS ONE MUST
    // NOT LOSE.** It used to assert: `ATTACK_EFFECT_SKIPPED` names the attack and quotes
    // the sentence IN FULL, zero coin rows, `rngState` UNMOVED, no Energy discarded, and
    // the printed 50 lands unmodified. Four of those five were about being loud and one
    // (the flat 50) was about not being broken. The build inverts the first four — and the
    // *strong* forms survive rather than being dropped:
    //   · no `ATTACK_EFFECT_SKIPPED` at all, which is a claim about an EVENT and not about
    //     a deriver, so a regex that matched but produced nothing would still redden it;
    //   · the coin rows are announced and their COUNT equals the sequence `flipUntilTails`
    //     takes from the same seed — the old rung's "a flip taken and not announced would
    //     pass the first and fail this one" argument, kept and pointed the other way;
    //   · `rngState` lands exactly where taking that same sequence by hand leaves it;
    //   · **the flat 50 still lands, unmodified** — the one assertion that was never about
    //     loudness, and the reason Krookodile was chosen as the witness in the first place.
    // ⚠️ **NO ENERGY IS DISCARDED HERE AND THAT IS THE BOARD, NOT THE READER.** `board()`
    // gives p2 a bare `fix-titan` Active with nothing attached, so every expanded copy of
    // `discardEnergy` finds an EMPTY candidate set and whiffs. The op firing on a board
    // that HAS Energy — and PARKING on the choice — is driven in
    // `perHeadsEnergyDiscard.test.ts`; this rung deliberately keeps the same board it
    // always had, so the only thing that moved between the two versions is the reader.
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = krookodileActive(board(seed), "p1");
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // The attack WAS declared.
      expect(types(events)).toContain("ATTACK_DECLARED");
      // …and it is no longer on the loud path at all.
      expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // THE SEQUENCE, TAKEN BY HAND FROM THE SAME SEED, matches row for row and ends in
      // TAILS — the same probe the mapped cases in this file use.
      const [expectedFaces, expectedRng] = flipUntilTails(before, MAX_UNTIL_TAILS_FLIPS);
      const announced = all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
      expect(announced).toEqual(expectedFaces);
      expect(announced.length).toBeGreaterThanOrEqual(1);
      expect(announced[announced.length - 1]).toBe("tails");
      expect(done.rngState).toBe(expectedRng);
      expect(done.rngState).not.toBe(before);
      // …and no Energy left the defender, because it had none to lose: the expansion ran
      // `announced.filter(heads).length` copies of an op whose candidate set was empty.
      expect(types(events)).not.toContain("ENERGY_DISCARDED");
      // The printed 50 lands unmodified (fix-titan has neither Weakness nor
      // Resistance), and the turn ends the ordinary way.
      expect(find(events, "DAMAGE_DEALT")?.base).toBe(50);
      expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(50);
      expect(activeDamage(done, "p2")).toBe(50);
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses a printed ZERO per — the `per >= 1` guard every arm of the family carries", () => {
    // Nothing in the pool prints it, and the guard is what keeps that a FACT about
    // the pool rather than an assumption. Here it is sharper than in any sibling: a
    // 0-per printing would spend an UNBOUNDED number of flips (and rngState steps,
    // and events) to deal nothing at all on every outcome, which is indistinguishable
    // from a bug that hangs. Refused on BOTH arms, because the deriver has two
    // returns here and only one of them is on the additive path.
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 0 damage for each heads.`),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 0 more damage for each heads.`),
    ).toBeNull();
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 1 damage for each heads.`),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 1 });
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 1 more damage for each heads.`),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 1 });
  });

  it("refuses `until you get HEADS` — the sentence that would never terminate the same way", () => {
    // THE ONE-WORD DRIFT WITH A MECHANISM BEHIND IT. No card prints it, and if one
    // did it would be a DIFFERENT loop: `flipUntilTails` stops on tails, so a reader
    // that admitted this sentence would run the mapped loop and score a card that
    // asks for the mirror sequence. It is refused at the literal, like every other
    // drift, which is exactly why the leading sentence is spelled out in the pattern
    // rather than matched as "Flip a coin until …".
    for (const text of [
      "Flip a coin until you get heads. This attack does 30 damage for each heads.",
      "Flip a coin until you get heads. This attack does 30 more damage for each heads.",
      "Flip a coin until you get tails. This attack does 30 damage for each tails.",
      "Flip a coin until you get tails. This attack does 30 more damage for each tails.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    // The "for each tails" pair is the sharper of the two: its OPENING is the mapped
    // one verbatim, so it is refused by the consequent, and folding it as a
    // heads-count would score every outcome upside down (a sequence that ends in
    // tails has exactly one).
    expect(
      "Flip a coin until you get tails. This attack does 30 damage for each tails.".startsWith(
        UNTIL_TAILS_OPENING,
      ),
    ).toBe(true);
  });

  it("refuses the anchor, casing, whitespace and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin until you get tails. This attack does 30 damage for each heads.",
      // Lowercase "this" one sentence later.
      "Flip a coin until you get tails. this attack does 30 damage for each heads.",
      // NO TRAILING PERIOD is not the whole sentence — the `$` sits after it.
      "Flip a coin until you get tails. This attack does 30 damage for each heads",
      "Flip a coin until you get tails. This attack does 30 more damage for each heads",
      // "!" for "." — the same one-character difference from the other side.
      "Flip a coin until you get tails. This attack does 30 damage for each heads!",
      // A missing period on the FIRST sentence, which is the half this slice's
      // anchoring is built on.
      "Flip a coin until you get tails This attack does 30 damage for each heads.",
      // The CONSEQUENT ALONE — the degenerate string a substring matcher would claim,
      // and the one `deriveAttackDamageMultiplier`'s family lives next door to.
      "This attack does 30 damage for each heads.",
      // The OPENING alone — an unbounded sequence with nothing to fold it into.
      "Flip a coin until you get tails.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin until you get tails. This attack does 30 damage for each heads.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip a coin until you get tails.This attack does 30 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip a coin until you get tails.  This attack does 30 damage for each heads.",
      // "coins" for "coin" — one letter, and D127's mechanism.
      "Flip a coins until you get tails. This attack does 30 damage for each heads.",
      // "head" for "heads".
      "Flip a coin until you get tails. This attack does 30 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
      `Flip a coin until you get tails.${NBSP}This attack does 30 damage for each heads.`,
      // (A CURLY APOSTROPHE variant of Gyarados's sentence used to sit here. It was
      // never this file's to refuse: none of the FIVE sentences THIS file maps
      // contains an apostrophe, so the string was borrowed from D130's family, and it
      // was pinned null on the strength of the U+2019 — which the D135 review found
      // to be a missing `['’]` class rather than a property of the sentence. D130's
      // suite now asserts it ACCEPTED, and this list keeps only near-misses of the
      // folds this file actually owns.)
      // A SECOND CONSEQUENT riding the same sequence — the shape the `$` exists for.
      // No pool printing extends this exact sentence today, which is precisely why the
      // guard is pinned now: the first one that does must land loudly rather than
      // half-resolve, dropping a rider the engine never saw.
      "Flip a coin until you get tails. This attack does 30 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin until you get tails. This attack does 30 damage for each heads, and discard an Energy from this Pokémon.",
      "Flip a coin until you get tails. This attack does 30 more damage for each heads. If tails, this attack does nothing.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not — on BOTH arms, because
    // the trim happens once and both arms have to benefit from it.
    expect(deriveAttackCoinFlip(`${RELENTLESS_FLAMES} `)).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    expect(deriveAttackCoinFlip(`  ${DAMAGE_RUSH}\n`)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
  });
});

describe("ZERO registry rows — the cards fold straight off their printed text", () => {
  it("has no ATTACK program for any of the five, authored or otherwise", () => {
    // The two multiply attackers and the deriver-only pair carry no registry entry at
    // all: the sentence IS the wiring.
    for (const id of ["sv01-030", "sv02-026", "sv01-139", "sv01-144"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
    // BOUFFALANT IS THE EXCEPTION AND IT IS A NARROW ONE. It carries a registry entry
    // for "Bouffer" — a PASSIVE, read when the card is DAMAGED — and no attack
    // program whatsoever. Its "Damage Rush" is derived from the printed sentence like
    // every other card in this file, which is the claim the `attack === undefined`
    // below actually makes.
    expect(programFor("sv03-174")).toBeDefined();
    expect(programFor("sv03-174")?.passive).toBeDefined();
    expect(programFor("sv03-174")?.attack).toBeUndefined();
    // …and the unmapped witness has none either, which is why it lands on the loud
    // path rather than being resolved by a hand-written row.
    expect(programFor("sv01-117")).toBeUndefined();
    // The re-pointed-away card has none EITHER, and that is a different claim worth
    // keeping: Gyarados is MAPPED as of D130 and still carries zero registry rows, so
    // the shape it now resolves through is the printed sentence and nothing else.
    expect(programFor("swsh10.5-022")).toBeUndefined();
  });
});

describe("Growlithe — the MULTIPLY form: one row per face, and the base that must not leak", () => {
  it("announces the whole sequence IN ORDER and ends it in TAILS", () => {
    // THE SHAPE OF THE EVENT STREAM, and the thing a heads COUNT on a single row
    // would have thrown away. `ATTACK_EFFECT_COIN_FLIP` carries exactly one
    // `CoinFace`, so the sequence is announced as a sequence — and for THIS member
    // that is not a stylistic choice: the sequence's own shape (heads*, then tails)
    // is the only evidence a reader has that the loop terminated rather than being
    // cut off. A truncated run would be all heads, which is the one shape this
    // assertion refuses.
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = growlitheActive(board(seed), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const faces = facesIn(events);
      // AT LEAST ONE FLIP, ALWAYS. "Until you get tails" takes the first flip
      // unconditionally — there is no board state and no printed count that can make
      // this sequence empty, which is exactly the difference from D128's zero count.
      expect(faces.length).toBeGreaterThanOrEqual(1);
      // Every face but the last is heads, and the last is tails.
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      // …stated the other way round too, so a sequence like ["tails", "heads"] (a
      // loop that kept going after its stop condition) fails here rather than passing
      // a heads count by luck.
      expect(faces.filter((f) => f === "tails")).toHaveLength(1);
      expect(faces.filter((f) => f === "heads")).toHaveLength(faces.length - 1);
      expect(headsIn(events)).toBe(faces.length - 1);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");
      // The flips are announced BEFORE the damage they decided, in printed order.
      if (types(events).includes("DAMAGE_DEALT")) {
        expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
          types(events).indexOf("DAMAGE_DEALT"),
        );
      }
    }
  });

  it("deals exactly 30 × heads with the printed base DROPPED — never 30 + 30 × heads", () => {
    // THE CENTRAL CASE OF THE MULTIPLY ARM. Growlithe prints "30×", so its digits ARE
    // the per-heads amount and `scaledBase` must be 0: a two-heads Growlithe deals 60,
    // not 30 + 60 = 90. The correct set (0 / 30 / 60 / 90 / …) and the leaked-base set
    // (30 / 60 / 90 / 120 / …) OVERLAP everywhere except at ZERO HEADS, which is
    // exactly why the sweep has to reach it and why the assertion is stated against
    // the heads count read off the rows.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = growlitheActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(30 * heads);
      // The total the printed base WOULD have produced, named as an absence.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads + 30);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        // No row at all — the `scaledBase + scaledTotal > 0` guard. A leaked base
        // deals 30 here, which is the one outcome that cannot be faked.
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
      } else {
        // `base` is the printed 30 AFTER `scaledBase` dropped it, and the whole
        // number arrives through `scaled` — the same pre-W/R channel the
        // count-scaling clauses and D126's heads bonus use. One channel for "the
        // attack's own extra", not three.
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(30 * heads);
        expect(damage?.dealt).toBe(30 * heads);
        expect(damage?.weakness).toBeNull();
        expect(damage?.resistance).toBeNull();
      }
      // 340 HP is above the sweep's worst case, so every seed measures damage rather
      // than ending on a promotion.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The sweep reached 0 heads, which is the outcome the whole case rests on.
    expect(seen.has(0)).toBe(true);
  });

  it("deals exactly 60 × heads for CHANSEY — `per` is captured, not assumed", () => {
    // The second per, and the reason there are two multiply cards: a suite built on
    // Growlithe alone cannot tell a `per` READ off the regex from a hardcoded 30. 60
    // ≠ 30 and the two cards' total sets share only 0, so no assertion here can be
    // passing for the other card's arithmetic — and both run the SAME sequence on a
    // given seed, so the only thing that differs is the multiplication.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const chansey = mustApply(chanseyActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      // SAME BOARD, SAME rngState, SAME SEQUENCE — asserted, because the whole
      // comparison below depends on it.
      expect(facesIn(chansey.events)).toEqual(facesIn(growlithe.events));
      const heads = headsIn(chansey.events);
      seen.add(heads);
      expect(activeDamage(chansey.state, "p2")).toBe(60 * heads);
      expect(activeDamage(chansey.state, "p2")).not.toBe(60 * heads + 60);
      // …and it is TWICE Growlithe's on the same faces, which is what says the number
      // came off the sentence rather than out of the loop.
      expect(activeDamage(chansey.state, "p2")).toBe(
        2 * (activeDamage(growlithe.state, "p2") ?? 0),
      );
      expect(types(chansey.events)).not.toContain("KNOCKED_OUT");
    }
    expect(seen.has(0)).toBe(true);
  });

  it("leaves Chansey's OTHER attack completely alone — a flat 40, no flips, base kept", () => {
    // The control, on the same card and the same board. "Pound" prints a bare number
    // with no effect and no modifier, so it must take NO flip, KEEP its printed base,
    // and emit no loud row — which is what says the coin reader is keyed to the TEXT
    // of the attack being declared and not to the card carrying it.
    const state = chanseyActive(board(0), "p1");
    const before = state.rngState;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: POUND_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(before);
    expect(find(events, "DAMAGE_DEALT")?.base).toBe(40);
    // `scaled` is "present only when it applied", so its ABSENCE is the claim:
    // nothing was folded in front of Weakness at all.
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(activeDamage(done, "p2")).toBe(40);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Bouffalant — the ADDITIVE form: the printed base is KEPT", () => {
  it("deals 50 + 30 × heads, and 50 on the very first tails", () => {
    // THE CASE THAT PINS THE TWO MEMBERS APART, and the zero-heads outcome is the
    // whole of it. Bouffalant prints "50+", so `scaledBase` keeps the base and the
    // fold rides on top; Growlithe prints "30×" and its base is dropped. On a first
    // flip of TAILS the two are as far apart as they ever get:
    //
    //   Bouffalant → 50 dealt, ONE flip row, no bonus at all
    //   Growlithe  → nothing dealt, no DAMAGE_DEALT row, ONE flip row
    //
    // A build that collapsed the members into one — the arithmetic coincides, since
    // `heads × per` is right for both — would get one of those two wrong on every
    // seed in this file.
    const seen = new Set<number>();
    let checkedZero = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = bouffalantActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const faces = facesIn(events);
      const heads = headsIn(events);
      seen.add(heads);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      const damage = find(events, "DAMAGE_DEALT");
      // THE PRINTED BASE IS KEPT — the assertion the whole member exists for.
      expect(damage?.base).toBe(50);
      expect(damage?.dealt).toBe(50 + 30 * heads);
      expect(activeDamage(done, "p2")).toBe(50 + 30 * heads);
      // …and the multiply arm's total is named as an absence, so "kept" is a claim
      // about this card rather than a number that happens to match.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads);
      if (heads === 0) {
        checkedZero += 1;
        // THE EXPLICIT ZERO-HEADS CASE. One flip, tails, and the flat printed 50 —
        // which a `perHeads` reading would report as nothing at all.
        expect(faces).toEqual(["tails"]);
        expect(damage?.dealt).toBe(50);
        expect(activeDamage(done, "p2")).toBe(50);
        // `scaled` is present only when the attack's own extra actually landed, and
        // on this outcome it did not.
        expect(damage?.scaled).toBeUndefined();
        // …and the same seed on Growlithe deals NOTHING and emits no damage row at
        // all. The pair, on one board, is the sharpest statement of the split.
        const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        expect(facesIn(growlithe.events)).toEqual(["tails"]);
        expect(find(growlithe.events, "DAMAGE_DEALT")).toBeUndefined();
        expect(activeDamage(growlithe.state, "p2")).toBe(0);
      } else {
        // On every other outcome the bonus arrives through `scaled`, the same pre-W/R
        // channel the multiply arm's whole number arrives through — one channel for
        // "the attack's own extra", and the BASE is what differs between the members.
        expect(damage?.scaled).toBe(30 * heads);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The zero-heads outcome really was reached — otherwise the block above is a loop
    // that asserted the easy half. Measured: seed 0 is a first-flip tails.
    expect(checkedZero).toBeGreaterThanOrEqual(1);
    expect(seen.has(0)).toBe(true);
  });
});

describe("the rngState account — exactly the sequence, no more and no fewer steps", () => {
  it("recomputes every board's whole sequence with flipUntilTails, in order", () => {
    // THE ASSERTION THAT CATCHES AN OFF-BY-ONE OR A DOUBLE FLIP, and here the
    // recomputation is against `flipUntilTails` itself rather than against a counted
    // fold — because for this member there is no count to fold. Both halves are
    // checked on every board:
    //
    //   • the resulting rngState IS `after.rngState` — so exactly the sequence's
    //     worth of steps was consumed and nothing else in a plain attack (§8.5, the
    //     §8.1 sweep, the §5.3 turn end and its draw) touched the rng;
    //   • the resulting FACES are the emitted rows' results IN ORDER — so the rows are
    //     the flips that actually happened, not a re-read of one draw.
    //
    // Either half alone is weak: a loop that drew the right number of faces but
    // reported the first one repeatedly passes the first, and one that reported
    // distinct faces off a state it forgot to thread passes neither but for confusing
    // reasons. Together they are a total account — and the ±1 probes below are what
    // make it a claim about the LENGTH rather than about a number.
    for (const [label, field, index] of [
      ["Growlithe (30×)", growlitheActive, FLIP_INDEX],
      ["Chansey (60×)", chanseyActive, EGG_INDEX],
      ["Bouffalant (50+)", bouffalantActive, FLIP_INDEX],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const [faces, expected] = flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS);
        const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index });
        expect(after.rngState, label).toBe(expected);
        expect(facesIn(events), label).toEqual(faces);
        // ONE MORE STEP would have landed here, and one FEWER here — named explicitly,
        // so the assertion above is a claim about the length of the sequence and not
        // just about a number. (`foldFlips` is used for these because the engine's own
        // helper cannot be asked for a wrong-length answer.)
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, faces.length + 1)[1]);
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, faces.length - 1)[1]);
        // …and the two helpers agree, which is what lets the ±1 probes be stated in
        // terms of a counted fold at all.
        expect(foldFlips(state.rngState, faces.length)[1], label).toBe(expected);
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the sequence rows are the ONLY ones", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is
    // the older. An UNCONFUSED attacker must never emit its event and never consume
    // its step, so the rows in the list are the attack's own — which for THIS member
    // matters more than for its siblings, since the row count is not a printed number
    // anyone can check the list against.
    for (const field of [growlitheActive, bouffalantActive]) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(facesIn(events)).toEqual(flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS)[0]);
    }
  });
});

describe("outcome coverage — an unbounded fold has an unbounded outcome space", () => {
  it("sees 0, 1 and 2 heads across the sweep, and never an empty sequence", () => {
    // MEASURED, NOT INHERITED, and this is the case that sets SEEDS. Sweeping seeds
    // 0..199 on this deck, the first seed reaching each heads count is:
    //
    //   0 heads → seed 0     3 heads → seed 3     7 heads → seed 142
    //   1 head  → seed 6     4 heads → seed 53    8 heads → seed 120
    //   2 heads → seed 30    5 heads → seed 2
    //
    // The three sibling coin suites all run 24 seeds; 24 is NOT enough here (it
    // reaches {0, 1, 3, 5} and never 2), which is the unbounded fold's outcome space
    // showing itself — the counts are a geometric tail, not a small fixed set a short
    // sweep exhausts. So the claim is a SUPERSET one: the sweep must have seen 0, 1
    // and 2, and it may see more. An exact-set assertion here would be a statement
    // about the seeds rather than about the fold, and would have to be rewritten
    // every time the deck's shuffle moved.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const faces = facesIn(events);
      // THE SEQUENCE IS NEVER EMPTY. "Until you get tails" takes its first flip
      // unconditionally — there is no board fact and no printed count that can make
      // this zero, which is the sharpest behavioural difference from D128's
      // zero-count branch (no rows at all, no rngState step).
      expect(faces.length).toBeGreaterThanOrEqual(1);
      // …and the heads count is exactly one less than the length, always, because the
      // last face is the tails that stopped it.
      expect(headsIn(events)).toBe(faces.length - 1);
      seen.add(headsIn(events));
    }
    for (const heads of [0, 1, 2]) expect([...seen]).toContain(heads);
    // Measured inside the sweep: the largest count reached is 5, which is the number
    // fix-titan's 340 HP is chosen against (Chansey's 5 heads is 300).
    expect(Math.max(...seen)).toBe(5);
  });
});

describe("modifierSimulated — no loud row on ANY outcome, on EITHER member", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on all three cards", () => {
    // D126's trap, recurring for the FOURTH time, and this slice is the first where it
    // recurs on BOTH markers at once: the multiply printings hand attack.ts a "×" and
    // Bouffalant hands it a "+", and the coin reader is what consumes each. A build
    // that only widened `effectSimulated` resolves every number in this file PERFECTLY
    // and still flags all five printings loudly.
    //
    // Asserted on EVERY swept seed, not one: the row's condition is computed from the
    // DERIVED VALUE and does not depend on the faces, but a future build that made it
    // depend on them (say, by only claiming the modifier when the bonus was non-zero)
    // would fail on the zero-heads outcome alone — which is exactly the outcome a
    // single-seed case would miss.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const chansey = mustApply(chanseyActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      const bouffalant = mustApply(bouffalantActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(growlithe.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(chansey.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(bouffalant.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seen.add(headsIn(growlithe.events));
    }
    // …and the sweep really did cover the zero-heads outcome, so "no loud row on ANY
    // outcome" is a statement about the one that could plausibly have been special
    // and not only about the ones a seed happened to produce.
    expect(seen.has(0)).toBe(true);
    // The other two printings have no board case (Rellor's sentence is Growlithe's
    // byte for byte and Forretress's differs only in its per), so their coverage is
    // stated where it is decided: the derived value is non-null, which is the single
    // term that makes both `effectSimulated` and `modifierSimulated` true.
    expect(deriveAttackCoinFlip(BALL_ROLL)).not.toBeNull();
    expect(deriveAttackCoinFlip(CONTINUOUS_SPIN)).not.toBeNull();
  });
});

describe("flipUntilTails — the TERMINATION ARGUMENT, which is this slice's real cost", () => {
  it("always ends in tails, and never approaches the cap, across a swept range", () => {
    // The engine's own call, driven at the engine's own cap, over 2000 consecutive
    // states. Three claims per state, and the third is the one the cap exists for:
    //
    //   • the sequence is NON-EMPTY — the first flip is unconditional;
    //   • every face but the last is heads and the last is TAILS — i.e. the loop
    //     stopped because it got its stop condition, not because it ran out of cap.
    //     A truncated run is all heads with no tails at the end, and that is the one
    //     shape this refuses;
    //   • the length is nowhere near 64.
    let longest = 0;
    for (let state = 0; state < 2000; state += 1) {
      const [faces] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      expect(faces.length).toBeLessThan(MAX_UNTIL_TAILS_FLIPS);
      longest = Math.max(longest, faces.length);
    }
    // MEASURED over exactly this window: the longest sequence from any state in
    // [0, 2000) is 11 faces — 10 heads then a tails. Pinned as an equality rather
    // than a bound so a change to `nextU32` shows up here as a number rather than as
    // a silently-still-passing inequality.
    expect(longest).toBe(11);
    expect(longest).toBeLessThan(MAX_UNTIL_TAILS_FLIPS / 2);
  });

  it("TRUNCATES at a small cap — the one shape the guard would ever produce", () => {
    // THE BRANCH THE ENGINE'S OWN CAP CANNOT REACH, and the reason `cap` is a
    // parameter rather than a read of the constant: the bound is set above what the
    // real RNG can produce, so a test that could only drive `MAX_UNTIL_TAILS_FLIPS`
    // could never observe what the bound DOES. Driving a small cap is what pins it.
    //
    // State 0's natural run is heads-then-tails. Capped at ONE flip it returns
    // ["heads"] — ALL HEADS, no tails at the end, which is exactly the shape a caller
    // can test for and exactly the lie about the game the cap is set high enough to
    // avoid. And it advances by EXACTLY ONE step, not by the whole natural run.
    expect(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(["heads", "tails"]);
    const [capped1, after1] = flipUntilTails(0, 1);
    expect(capped1).toEqual(["heads"]);
    expect(capped1.every((f) => f === "heads")).toBe(true);
    expect(capped1[capped1.length - 1]).not.toBe("tails");
    expect(after1).toBe(flipCoin(0)[1]);
    expect(after1).toBe(foldFlips(0, 1)[1]);
    expect(after1).not.toBe(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS)[1]);

    // State 4 has TWO leading heads, so the same claim one length up: capped at two
    // it returns two heads and two steps, where its natural run is three faces.
    expect(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(["heads", "heads", "tails"]);
    const [capped2, after2] = flipUntilTails(4, 2);
    expect(capped2).toEqual(["heads", "heads"]);
    expect(capped2[capped2.length - 1]).not.toBe("tails");
    expect(after2).toBe(foldFlips(4, 2)[1]);
    expect(after2).not.toBe(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[1]);

    // A cap ABOVE the natural run does not truncate and does not over-draw — the
    // sequence stops at its tails and the cap is simply never reached, which is the
    // engine's own situation on every seed.
    for (const cap of [2, 3, 8, MAX_UNTIL_TAILS_FLIPS]) {
      expect(flipUntilTails(0, cap)).toEqual(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS));
    }
    for (const cap of [3, 4, 16, MAX_UNTIL_TAILS_FLIPS]) {
      expect(flipUntilTails(4, cap)).toEqual(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS));
    }
  });

  it("takes NO FLIP at all for a cap of zero or below, and advances nothing", () => {
    // The degenerate end of the parameter, and it is a real answer rather than a
    // guard: no faces, and the state comes back BYTE-IDENTICAL. Anything else would
    // burn an rngState step to decide nothing — the same failure D128's zero-count
    // branch refuses on the board side.
    for (const state of [0, 1, 7, 123456, -5, -2147483648, 2147483647]) {
      for (const cap of [0, -1, -64]) {
        expect(flipUntilTails(state, cap)).toEqual([[], state]);
      }
      // …and a cap of ONE is the first that does anything, which is what makes the
      // zero above a boundary rather than a shrug.
      expect(flipUntilTails(state, 1)[0]).toHaveLength(1);
      expect(flipUntilTails(state, 1)[1]).not.toBe(state);
    }
  });

  it("agrees face-for-face with repeated flipCoin from the same state", () => {
    // `flipUntilTails` is not allowed to be its own source of truth about the RNG. It
    // is a LOOP over `flipCoin`, so every face it returns and the state it leaves
    // must be exactly what stepping `flipCoin` by hand produces — which is also the
    // property that lets the board cases above state their ±1 probes with `foldFlips`.
    for (let state = 0; state < 500; state += 1) {
      const [faces, next] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      const [byHand, handNext] = foldFlips(state, faces.length);
      expect(byHand).toEqual(faces);
      expect(handNext).toBe(next);
      // …and one more `flipCoin` from the returned state is NOT part of the sequence,
      // which is what says the loop stopped where it said it did.
      expect(flipCoin(next)[1]).not.toBe(next);
      expect(foldFlips(state, faces.length + 1)[1]).not.toBe(next);
    }
  });

  it("pins MAX_UNTIL_TAILS_FLIPS at the MEASURED worst case, doubled", () => {
    // THE CONSTANT IS A MEASUREMENT, NOT A FEELING, and that distinction is the whole
    // argument. mulberry32's pre-states advance by a FIXED ODD STRIDE
    // (`state + 0x6d2b79f5`), so successive flips walk `n · K mod 2³²` and, over 2³²
    // steps, visit every int32 exactly once. The face sequence is therefore ONE fixed
    // cycle and its worst case is a NUMBER rather than a probability: measured over
    // all 4 294 967 296 steps (plus the wrap — the cycle ends "…HH" and begins "H…",
    // so no run straddles the seam), THE LONGEST RUN OF CONSECUTIVE HEADS IS 31.
    //
    // 64 is twice that. With the current `flipCoin` the cap is unreachable from any
    // seed, so the guard is dead code by construction — which is exactly what a guard
    // of this kind should be, and the reason the truncation case above has to drive
    // the parameter to see it work at all.
    //
    // TO RE-DERIVE AFTER CHANGING `nextU32`: scan `n · 0x6d2b79f5` for n in [0, 2³²),
    // take the longest run of states whose `flipCoin` says "heads", and set this to
    // twice it. A run of 40s of arithmetic answers it exactly; there is no need to
    // guess, and guessing is the failure this comment exists to prevent.
    expect(MAX_UNTIL_TAILS_FLIPS).toBe(64);
    expect(MAX_UNTIL_TAILS_FLIPS).toBeGreaterThan(31);
    expect(MAX_UNTIL_TAILS_FLIPS).toBe(2 * 32);
    // A ceiling chosen by feel would have been 10 or 20 — numbers a fair sequence
    // really does reach, and reaching one would TRUNCATE, which is a lie about the
    // game rather than a slow attack. Named as the thing this constant is not.
    expect(MAX_UNTIL_TAILS_FLIPS).toBeGreaterThan(20);
  });

  it("finds no run reaching the cap in a bounded scan of the state space", () => {
    // A WINDOW, NOT A PROOF, and it is labelled as one: 400 000 consecutive states is
    // about 0.01% of the 2³² cycle, so this cannot establish the 31 above — the full
    // scan does that, offline, and its result is recorded in rng.ts. What this DOES
    // establish is that the constant is not merely large in principle: on the states
    // the engine actually walks, the longest run is nowhere near it, and the scan is
    // cheap enough (well under a second) to run on every commit.
    //
    // MEASURED over exactly this window: the longest sequence is 21 faces — 20 heads
    // then a tails, comfortably inside 64 and comfortably outside the 10-or-20 a
    // hand-picked ceiling would have used. Pinned as an equality so a change to
    // `nextU32` reports a number here instead of quietly still passing.
    let longest = 0;
    for (let state = 0; state < 400000; state += 1) {
      const [faces] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      if (faces.length > longest) longest = faces.length;
    }
    expect(longest).toBe(21);
    expect(longest).toBeLessThan(MAX_UNTIL_TAILS_FLIPS);
    // …and it is above the ceiling a "surely enough" guess would have picked, which is
    // the concrete reason this constant was measured rather than chosen.
    expect(longest).toBeGreaterThan(20);
  });
});

describe("purity", () => {
  it("resolves every unbounded fold on a DEEP-FROZEN board", () => {
    // The rngState thread and the damage write both go through fresh objects — a
    // frozen state proves nothing was mutated in place, on all three attackers and on
    // the unmapped witness (which must leave `next` alone entirely). attack.ts draws
    // the whole sequence and rebinds `next` ONCE, which is exactly the shape a
    // careless in-place `next.rngState = …` inside the announce loop would have taken
    // instead — and a per-face rebind is what the counted members used to do, so the
    // regression is a live one.
    for (let seed = 0; seed < SEEDS; seed++) {
      mustApply(deepFreeze(growlitheActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      mustApply(deepFreeze(chanseyActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      mustApply(deepFreeze(bouffalantActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      mustApply(deepFreeze(krookodileActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
    }
    // …and `flipUntilTails` is a pure function of its two numbers: same inputs, same
    // faces and same state, and the array it hands back is a fresh one each time (so
    // a caller that mutated the sequence could not poison the next call).
    const [facesA, nextA] = flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS);
    const [facesB, nextB] = flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS);
    expect(facesA).toEqual(facesB);
    expect(nextA).toBe(nextB);
    expect(facesA).not.toBe(facesB);
    facesA.push("heads");
    expect(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(facesB);
    // …and the DERIVER is a pure function of its string, frozen board or not, on both
    // arms.
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
  });
});
