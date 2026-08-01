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
import { flipCoin } from "./rng";
import {
  COIN_FLIP_DECK,
  FIXTURE_POOL,
  MULTI_COIN_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.77.0 → 0.78.0 — the MULTI-FLIP COUNT FOLD (D127). "Flip N coins. This attack
// does D damage for each heads." (22 printings, N ∈ {2, 3, 4}) — Tandemaus sv01-160
// "Double Hit" ({C}{C}, 30×) flips TWO and Meowth sv06.5-048 "Fury Swipes"
// ({C}{C}, 20×) flips THREE.
//
//   22 PRINTINGS ON ONE REGEX, ONE UNION MEMBER, AND ZERO NEW EVENTS.
//
// D126 built the seam: a printed flip is taken IN FRONT of the §8.5 pipeline, at
// the confusion flip's site, because a flip that gates or scales damage cannot be
// an effect PROGRAM (programs run at attack.ts's tail, strictly after the number is
// computed). D127 is that same site with a bounded LOOP where D126 took a single
// draw — which is why this slice buys no new site, no new event and no new state:
// `ATTACK_EFFECT_COIN_FLIP` already carries exactly one `CoinFace`, so N flips are
// N rows in flip order. The alternative — one row carrying a heads COUNT — would
// owe a new event, a new wire member and a new log arm to say something the reader
// can already count off the rows, and would throw away the ORDER, which is the one
// thing a player watching a three-flip attack actually wants to see.
//
// THE PRINTED BASE IS DROPPED, and that is the slice's whole arithmetic risk. All
// 22 printings carry a "D×" marker whose digits ARE the per-heads D, exactly like
// `deriveAttackDamageMultiplier`'s family — so `scaledBase` must be 0 for a
// `perHeads` attack or Tandemaus on two heads would deal 30 + 60 = 90 instead of
// 60. The three legal totals (0 / 30 / 60) and the three wrong ones (30 / 60 / 90)
// OVERLAP at 30 and 60, so no single seed can settle it: every end-to-end case
// below sweeps until all three outcomes have been SEEN and asserts each, and the
// 0-heads case is the one that cannot be faked (a leaked base deals 30 there).
//
// THIS IS ALSO WHY `perHeads` IS NOT `bonusOnHeads` WITH `flips: 1`. The
// arithmetic coincides — `heads × per` is right for both, and attack.ts computes
// them with one expression on purpose — but the printed marker does not: "+" keeps
// the base, "×" drops it. Collapsing the members would hide that behind a flag,
// so the branch in attack.ts is over CANCELLATION and the base lives at
// `scaledBase`, where the marker is read.
//
// TWO CARDS, TWO DIFFERENT N, ON PURPOSE. One printing cannot tell a READ `flips`
// from a hardcoded 2, and "exactly `flips` rngState steps, never more" is only an
// assertion when two values run the same loop. 20 ≠ 30 for the same reason: the
// two cards' totals (0/30/60 against 0/20/40/60) share only 0 and 60, and 60 needs
// a different heads count on each, so no case can be passing for the other card's
// arithmetic.
//
// AND THE MODIFIER TRAP RECURS EXACTLY WHERE D126 PREDICTED. "30×" hands attack.ts
// a modifier "×", and the coin reader is what consumes it — so `modifierSimulated`
// had to be turned inside out (two of the three members own a marker; only
// `cancelOnTails`, which prints a FLAT number, does not). A build that only
// widened `effectSimulated` resolves every number in this file PERFECTLY and still
// emits a loud ATTACK_EFFECT_SKIPPED row on every attack. The no-skipped-row block
// asserts it on every swept seed, on both cards, on every outcome.
//
// ZERO HEADS IS A RESOLVED ATTACK THAT DEALT NOTHING, not a cancelled one — the
// sharpest behavioural difference from `cancelOnTails`, and its own case below: no
// DAMAGE_DEALT event at all (the `scaledBase + scaledTotal > 0` guard), no
// ATTACK_FAILED row, and the turn still ends.
//
// AND THE REST OF THE FLIP FAMILY STAYS LOUD. Two live "more" printings sit one
// word away from this regex (Melmetal swsh10.5-046 flips 2, Bouffalant sv03-174
// flips until tails), and the two unbounded/board-counted openings ("until you get
// tails", "for each {R} Energy attached") are still unbuilt. Each is pinned below
// with the property that refuses it.

/** Tandemaus sv01-160 "Double Hit", verbatim, and pinned char-for-char against
    FIXTURE_POOL below. TWO flips, so THREE outcomes and three distinct totals —
    0, 30, 60 — which is what makes "the count is read, not assumed" observable at
    all. Tandemaus carries no authored program (see the ZERO-rows block), so the
    sentence IS the wiring: a drifted character does not throw, it drops the card
    onto the loud ATTACK_EFFECT_SKIPPED path AND lets the printed 30 land flat
    every time, which is a wrong number rather than a missing one. */
const DOUBLE_HIT = "Flip 2 coins. This attack does 30 damage for each heads.";

/** Meowth sv06.5-048 "Fury Swipes", verbatim. THREE flips — the second N, and the
    reason the loop's bound is provably read from the string. */
const FURY_SWIPES = "Flip 3 coins. This attack does 20 damage for each heads.";

/** Every flip COUNT the pool's 22 printings carry: 2 (12 prints), 3 (9), 4
    (Unfezant swsh10.5-063, the family's only one). All three must come off the
    SAME regex — there is no table, so a count the deriver refused would be a count
    it could not represent at all. */
const PRINTED_FLIPS = [2, 3, 4] as const;

/** Every per-heads D the pool prints. Nine values, one regex, no rows. */
const PRINTED_PER = [10, 20, 30, 40, 50, 60, 70, 80, 100] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss
    cases below name it instead of carrying it — the mistake this guards against is
    exactly the mistake a literal would make in this file. */
const NBSP = " ";

/** U+00D7, likewise spelled as an escape. It is the printed damage marker on all
    22 printings and the ONE non-ASCII character anywhere in this slice, so the
    `damage` assertions name it rather than typing a character that is one keystroke
    from an ASCII "x". */
const TIMES = "×";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it.
    Copied rather than shared with coinFlipDamage.test.ts, where it is local for the
    same reason: testFixtures.ts is a fixture module, not a string library. */
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

/** Both attackers carry exactly ONE attack, so the index cannot be got wrong —
    named all the same, because a reprint that added a second attack would otherwise
    silently move it. */
const FLIP_INDEX = 0;

/** How far the seed sweeps run, and it is MEASURED, not inherited. Sweeping seeds
    0..199 on this deck, the first seed reaching each outcome is:

      Tandemaus (2 flips): 0 heads → seed 5, 1 head → seed 0, 2 heads → seed 2.
        ALL THREE by seed 5 — six seeds.
      Meowth (3 flips): 0 heads → seed 10, 1 → seed 0, 2 → seed 1, 3 → seed 2.
        ALL FOUR by seed 10 — eleven seeds.

    A 3-flip card genuinely needs more seeds than D126's 2 faces (its all-tails
    outcome is a 1-in-8 draw), which is why the number is measured rather than
    copied. 24 — D126's and coverage.test.ts's established bound — is comfortably
    past both, and every case that uses it asserts it SAW every outcome rather than
    trusting the loop. */
const SEEDS = 24;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4).

    Both Active spots are pinned to the neutral 200 HP fix-bigbody, which has NO
    Weakness at all: every case that is not about Weakness therefore measures the
    folded number and nothing else, and no defender here can be Knocked Out by a
    60. The pin is also what makes the deck open cleanly on EVERY seed in range —
    fix-bigbody is 40 of the 60 cards, so there is no mulligan and no opening the
    sweep has to control. Tandemaus (40 HP) and Meowth (70 HP) would otherwise be
    dealt into openings at the sweep's mercy. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: MULTI_COIN_FLIP_DECK, p2: MULTI_COIN_FLIP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Tandemaus in the seat's Active Spot with Double Hit's {C}{C} paid.
    SURGERY: both attackers are Basic and COULD be dealt, but a swept seed cannot be
    relied on to deal any particular one, so every case fields its attacker. */
function tandemausActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-160"), seat, "fix-energy", 2);
}

/** Meowth in the seat's Active Spot with Fury Swipes' {C}{C} paid. */
function meowthActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv06.5-048"), seat, "fix-energy", 2);
}

/** The 200 HP ×2 COLORLESS body in the seat's Active Spot — the pre-Weakness fold
    defender. Both attackers are Colorless, so the multiplier is live for each; 200
    HP survives 120 (Tandemaus's doubled two heads) and 120 (Meowth's doubled three),
    so no case here is ever about a Knock Out. */
function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-colorless-weak-big");
}

/** The seat's Active damage — read straight off the board so the "nothing
    happened" cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

/** Take `count` flips from `state` by hand, returning the faces IN ORDER and the
    rngState they leave behind. The whole rngState account rests on this: the engine
    must consume exactly this many steps and report exactly these faces, so an
    off-by-one, a double flip or a re-read of the same state all show up as a
    mismatch on one of the two halves. */
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

/** The heads count off the emitted rows — the number every damage assertion below
    is stated against. Counting it from the EVENTS rather than from a recomputed
    rng is deliberate: it makes each case a claim about what the engine REPORTED
    doing, and the rngState block is what separately proves the report is honest. */
function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Tandemaus sv01-160", () => {
    const attack = FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(DOUBLE_HIT);
    expect(attack?.name).toBe("Double Hit");
    // "30×" — a STRING, and the load-bearing field of the whole slice, TWICE over.
    // Its digits ARE the per-heads amount, so the printed base must be dropped; and
    // its "×" is the modifier `modifierSimulated` has to claim. Typed as a number it
    // would parse to a bare 30 with no modifier, and BOTH regressions would become
    // invisible at once.
    expect(attack?.damage).toBe(`30${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv01-160"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-160"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Meowth sv06.5-048", () => {
    const attack = FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FURY_SWIPES);
    expect(attack?.name).toBe("Fury Swipes");
    expect(attack?.damage).toBe(`20${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv06.5-048"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv06.5-048"]?.abilities).toBeNull();
  });

  it("splits both printed markers into base + \"×\" through parseAttackDamage", () => {
    // The exact hand-off the slice depends on: `parseAttackDamage` produces the
    // `base` that `scaledBase` then DROPS and the `modifier` that
    // `modifierSimulated` then claims. Asserting the split here means the two
    // end-to-end claims below (dealt 0/30/60, no ATTACK_EFFECT_SKIPPED) are about
    // attack.ts's decisions and not about a parse that quietly produced nothing.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 20,
      modifier: TIMES,
    });
    // The digits of the marker and the `per` of the derived shape are THE SAME
    // NUMBER printed once — stated explicitly, because the whole "drop the base"
    // rule is only correct because of it. (Read through a narrowing check rather
    // than `?.per`: `cancelOnTails` has no such field, and the union is what says
    // so.)
    for (const [text, damage] of [
      [DOUBLE_HIT, `30${TIMES}`],
      [FURY_SWIPES, `20${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
  });

  it("keeps the card facts the counts are measured against", () => {
    expect(FIXTURE_POOL["sv01-160"]?.name).toBe("Tandemaus");
    expect(FIXTURE_POOL["sv01-160"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-160"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv01-160"]?.hp).toBe(40);
    expect(FIXTURE_POOL["sv01-160"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv01-160"]?.weaknesses).toEqual([{ type: "Fighting", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv01-160"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv06.5-048"]?.name).toBe("Meowth");
    expect(FIXTURE_POOL["sv06.5-048"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv06.5-048"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv06.5-048"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv06.5-048"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-048"]?.weaknesses).toEqual([
      { type: "Fighting", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["sv06.5-048"]?.resistances).toBeNull();

    // BOTH attackers are Colorless, and the Weakness defender is ×2 COLORLESS —
    // which is what makes one synthetic body serve both cards. No printed card has
    // a Colorless Weakness; the pool holds no multi-flip attacker of a type an
    // existing weak body already fields, so the fixture is honest about being
    // invented rather than pretending to be a printing.
    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.weaknesses).toEqual([
      { type: "Colorless", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.resistances).toBeNull();
    // …and the neutral defender has neither, so the non-Weakness cases read the
    // folded number unmodified. 200 HP is above every total in this file.
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
  });

  it("pins the BYTES — and that both sentences are PURE ASCII", () => {
    // Same census D126's pair passed and for the same reason: neither sentence
    // names a Pokémon, so there is no "Pokémon" é in either and bytes and code
    // points are EQUAL. Both are 56 characters, which also happens to make a
    // one-character drift between them impossible to hide behind a length check.
    expect(DOUBLE_HIT.length).toBe(56);
    expect(utf8Bytes(DOUBLE_HIT)).toBe(56);
    expect(FURY_SWIPES.length).toBe(56);
    expect(utf8Bytes(FURY_SWIPES)).toBe(56);
    for (const sentence of [DOUBLE_HIT, FURY_SWIPES]) {
      // PURE ASCII, asserted over the characters rather than inferred from the
      // equal totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP); // the invisible drift
      // The "×" lives in the DAMAGE field, never in the effect text — the one place
      // in this slice a non-ASCII character legitimately appears.
      expect(sentence).not.toContain(TIMES);
      // The shared trailing sentence, char-for-char: the clause whose one missing
      // word ("more") separates this family from Melmetal's and Bouffalant's.
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      expect(sentence).not.toContain("more");
      // No trailing or leading whitespace on the printed row.
      expect(sentence).toBe(sentence.trim());
    }
    // The counts differ in exactly one character, which is the entire difference
    // between a two-flip card and a three-flip one.
    expect(DOUBLE_HIT.startsWith("Flip 2 coins. ")).toBe(true);
    expect(FURY_SWIPES.startsWith("Flip 3 coins. ")).toBe(true);
    // …and NEITHER opens with D126's literal, which is the property that keeps the
    // two slices' readers from ever meeting.
    expect(DOUBLE_HIT.startsWith("Flip a coin.")).toBe(false);
    expect(FURY_SWIPES.startsWith("Flip a coin.")).toBe(false);
  });
});

describe("deriveAttackCoinFlip — the THIRD member, on ONE regex", () => {
  it("reads both fixture sentences to their exact perHeads values", () => {
    expect(deriveAttackCoinFlip(DOUBLE_HIT)).toEqual({ kind: "perHeads", flips: 2, per: 30 });
    expect(deriveAttackCoinFlip(FURY_SWIPES)).toEqual({ kind: "perHeads", flips: 3, per: 20 });
    // Three keys and no more: the member is `flips` + `per` + the tag, and nothing
    // that would have to be answered off the BOARD. That is D126's rule holding for
    // a third member — the count comes from the flips, not from the state, so
    // `scaledAttackDamage` stays pure and no `DamageCountSource` member was added.
    const flip = deriveAttackCoinFlip(DOUBLE_HIT);
    if (flip === null) throw new Error("unreachable");
    expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
    expect(flip).not.toHaveProperty("cond");
    expect(flip).not.toHaveProperty("count");
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: 2, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: 3, per: 20 });
  });

  it("reads every printed COUNT and every printed PER off the one regex", () => {
    // No table exists, so this is not a coverage check on a Map — it is the claim
    // that the shape is PARAMETERISED in both of its numbers, and that every value
    // the pool prints is inside it. 27 combinations, zero rows. A reader built on
    // literal sentences would need one per printing.
    for (const flips of PRINTED_FLIPS) {
      for (const per of PRINTED_PER) {
        const text = `Flip ${flips} coins. This attack does ${per} damage for each heads.`;
        expect(deriveAttackCoinFlip(text)).toEqual({ kind: "perHeads", flips, per });
      }
    }
  });

  it("bounds the COUNT — plural below, MAX_PRINTED_FLIPS above", () => {
    // "Flip 1 coins." is not English and not in the pool: the one-flip form is
    // printed "Flip a coin." and belongs to D126's two patterns. Refusing it — rather
    // than quietly treating it as one flip — keeps the grammar of the sentence and
    // the shape of the value in agreement, and keeps a single string from being
    // readable by two slices at once.
    expect(deriveAttackCoinFlip("Flip 1 coins. This attack does 30 damage for each heads.")).toBe(
      null,
    );
    // …and 0, for the same reason from further below: a zero-flip attack would spend
    // nothing and decide nothing.
    expect(deriveAttackCoinFlip("Flip 0 coins. This attack does 30 damage for each heads.")).toBe(
      null,
    );
    // THE CEILING, at MAX_PRINTED_FLIPS = 10. The digits come out of THIRD-PARTY
    // ingested text, so an unbounded `\d+` would let one malformed row spin the
    // resolution loop arbitrarily long — and a hang is the one failure mode that is
    // not loud. A refusal drops the card onto ATTACK_EFFECT_SKIPPED, which is.
    expect(deriveAttackCoinFlip("Flip 10 coins. This attack does 10 damage for each heads.")).toEqual(
      { kind: "perHeads", flips: 10, per: 10 },
    );
    expect(deriveAttackCoinFlip("Flip 11 coins. This attack does 10 damage for each heads.")).toBe(
      null,
    );
    // A number no ingested row could ever mean, refused by the same bound rather
    // than by a special case.
    expect(
      deriveAttackCoinFlip("Flip 1000000 coins. This attack does 10 damage for each heads."),
    ).toBe(null);
    // The pool's own maximum sits comfortably inside the bound (Unfezant
    // swsh10.5-063 is the family's only 4).
    expect(deriveAttackCoinFlip("Flip 4 coins. This attack does 30 damage for each heads.")).toEqual(
      { kind: "perHeads", flips: 4, per: 30 },
    );
  });

  it("refuses a printed ZERO per — the `per >= 1` guard every arm carries", () => {
    // Nothing in the pool prints it, and the guard is what keeps that a FACT about
    // the pool rather than an assumption: a 0-per printing would spend N flips (and
    // N rngState steps, and N events) to deal nothing at all on every outcome, which
    // is indistinguishable from a bug. Refusing it makes it visible.
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 0 damage for each heads.")).toBe(
      null,
    );
    // …while the smallest REAL value one digit away is read fine.
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 1 damage for each heads.")).toEqual({
      kind: "perHeads",
      flips: 2,
      per: 1,
    });
  });
});

describe("the rest of the flip family stays LOUD", () => {
  it("refuses the two live \"more\" printings — ONE WORD from the mapped shape", () => {
    // THE SHARPEST NEAR-MISSES IN THE POOL, and the reason the regex is anchored on
    // the whole sentence rather than matching "damage for each heads". Both are real
    // printings whose damage marker is "+", not "×" — so their printed base is KEPT
    // and their per-heads amount is added ON TOP. A reader that claimed either would
    // drop a base it must not drop and score the card wrong on every outcome.
    //
    // Melmetal swsh10.5-046 (base "30+") — TWO coins, the same count as Tandemaus,
    // and the only thing separating the two sentences is the word "more".
    const melmetal = "Flip 2 coins. This attack does 90 more damage for each heads.";
    expect(deriveAttackCoinFlip(melmetal)).toBe(null);
    // Bouffalant sv03-174 (base "50+") — "more" AND an unbounded opening, refused
    // twice over.
    const bouffalant = "Flip a coin until you get tails. This attack does 30 more damage for each heads.";
    expect(deriveAttackCoinFlip(bouffalant)).toBe(null);
    // The refusals really are about "more": deleting that one word turns each into a
    // sentence this deriver reads (Melmetal's) or still refuses for the OTHER reason
    // (Bouffalant's unbounded opening). Stating both makes the pair a claim about
    // which property does the work, not just two nulls.
    expect(melmetal.replace(" more", "")).toBe(
      "Flip 2 coins. This attack does 90 damage for each heads.",
    );
    expect(deriveAttackCoinFlip(melmetal.replace(" more", ""))).toEqual({
      kind: "perHeads",
      flips: 2,
      per: 90,
    });
    expect(deriveAttackCoinFlip(bouffalant.replace(" more", ""))).toBe(null);
  });

  it("refuses the UNBOUNDED opening — still unbuilt, and deliberately so", () => {
    // Growlithe sv01-030, and 9 printings share the opening. "Flip a coin until you
    // get tails." is a genuinely different risk from a printed count: the number of
    // flips is unbounded, so the ceiling this deriver enforces has nothing to bite
    // on and the loop would need a different shape entirely. Refusing it keeps those
    // 9 printings on the loud ATTACK_EFFECT_SKIPPED path instead of silently
    // resolving them as some arbitrary fixed number of flips.
    const growlithe = "Flip a coin until you get tails. This attack does 30 damage for each heads.";
    expect(deriveAttackCoinFlip(growlithe)).toBe(null);
    // Its CONSEQUENT is Tandemaus's, word for word past the count — so this is the
    // opening sentence being refused, not the tail.
    expect(growlithe.endsWith("This attack does 30 damage for each heads.")).toBe(true);
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads.")).not.toBe(
      null,
    );
  });

  it("refuses a BOARD-COUNTED number of flips — where the board vocabulary would earn its place", () => {
    // Torkoal sv01-035, 3 printings. This one is the interesting refusal: the count
    // of flips is itself a board fact ("for each {R} Energy attached to this
    // Pokémon"), which is exactly the shape a `BoardCondition` / `DamageCountSource`
    // would answer — and the first place in this family where that vocabulary would
    // buy anything at all. D126 and D127 both bought none because a coin FACE is not
    // a board fact; this sentence is the boundary of that argument, so it is pinned
    // as refused rather than left to be discovered.
    const torkoal =
      "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.";
    expect(deriveAttackCoinFlip(torkoal)).toBe(null);
    expect(torkoal.endsWith("This attack does 80 damage for each heads.")).toBe(true);
  });

  it("refuses the STEPPED PAYOUT table — a count with no per-heads amount at all", () => {
    // Bisharp sv03-149. Three coins, like Meowth, and a payout that is NOT `per ×
    // heads` but a printed table (1 → 20, 2 → 60, all → 120). Reading it as `perHeads`
    // would be arithmetically wrong on every outcome, and it is refused by the
    // consequent rather than by the count.
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 60 more damage. If all of them are heads, this attack does 120 more damage.",
      ),
    ).toBe(null);
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses the anchor, casing and whitespace rewrites", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip 2 coins. This attack does 30 damage for each heads.",
      // Lowercase "this" — the same guard one sentence later.
      "Flip 2 coins. this attack does 30 damage for each heads.",
      // No trailing period is not the whole sentence.
      "Flip 2 coins. This attack does 30 damage for each heads",
      // "!" for "." — the same one-character difference from the other side.
      "Flip 2 coins. This attack does 30 damage for each heads!",
      // The CONSEQUENT ALONE, with no flip in front — the degenerate string a
      // substring matcher would happily claim, and one no printing carries.
      "This attack does 30 damage for each heads.",
      // The OPENING alone — a count with nothing to fold it into.
      "Flip 2 coins.",
      // Leading text pins `^`.
      "Before doing damage, flip 2 coins. This attack does 30 damage for each heads.",
      // A missing space after the flip sentence — invisible in a diff.
      "Flip 2 coins.This attack does 30 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip 2 coins.  This attack does 30 damage for each heads.",
      // "coin" for "coins" — one letter, and D126's mechanism.
      "Flip 2 coin. This attack does 30 damage for each heads.",
      // A spelled-out count, which the `\d+` cannot read (and no printing carries —
      // the one-flip form is the only one printed as a word, as "a coin").
      "Flip two coins. This attack does 30 damage for each heads.",
      // "head" for "heads".
      "Flip 2 coins. This attack does 30 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
      `Flip 2 coins.${NBSP}This attack does 30 damage for each heads.`,
    ]) {
      expect(deriveAttackCoinFlip(text)).toBe(null);
    }
  });

  it("refuses a TRAILING SUFFIX at the `$` — but trims outer whitespace", () => {
    // A SECOND CONSEQUENT riding the same flips is the shape the `$` exists for: the
    // engine would resolve the damage and silently drop the rider. No pool printing
    // extends this exact sentence today, which is precisely why the guard is pinned
    // now — the first one that does must land loudly rather than half-resolve.
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 30 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 30 damage for each heads, and discard an Energy from this Pokémon.",
      ),
    ).toBe(null);
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${DOUBLE_HIT} `)).toEqual({ kind: "perHeads", flips: 2, per: 30 });
    expect(deriveAttackCoinFlip(`  ${FURY_SWIPES}\n`)).toEqual({
      kind: "perHeads",
      flips: 3,
      per: 20,
    });
  });
});

describe("deriver disjointness — a fourth reader that crosses none of the other three", () => {
  it("keeps BOTH multi-flip sentences off the effect/bonus/multiplier/requirement readers", () => {
    // THE DOUBLE-READ CHECK, done EMPIRICALLY rather than by reading the regexes.
    // The risk here is sharper than D126's: the consequent "This attack does 30
    // damage for each heads." is one clause away from
    // `deriveAttackDamageMultiplier`'s whole family ("This attack does 50 damage for
    // each Prize card your opponent has taken."), and "heads" sits exactly where that
    // reader expects a countable board fact. A cross-read would fold the damage
    // TWICE — once from a board count of 0 and once from the coin — or, worse, would
    // make the multiplier reader answer a question the board cannot.
    for (const sentence of [DOUBLE_HIT, FURY_SWIPES]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("keeps a REAL sentence of each of the four families off deriveAttackCoinFlip", () => {
    // The mirror, one live representative per family, so the nulls above are
    // refusals in both directions and not one reader being dead.
    const representatives = [
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — D122's Tool clause (Greedent sv01-152).
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      // deriveAttackDamageMultiplier — the Prize-count "×" shape, and the closest
      // living relative of this slice's consequent.
      "This attack does 50 damage for each Prize card your opponent has taken.",
      // deriveAttackRequirement — D125's Palafin sentence.
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    // …and each really is live for its own reader, so the nulls are refusals and not
    // four dead strings.
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("ZERO registry rows — the cards flip straight off their printed text", () => {
  it("has no program of any kind for either card", () => {
    for (const id of ["sv01-160", "sv06.5-048"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Tandemaus — TWO flips, THREE outcomes, and the base that must not leak", () => {
  it("deals exactly 30 × heads into a neutral body — 0 / 30 / 60, never 30 / 60 / 90", () => {
    // THE CENTRAL CASE. Every outcome is reached by sweeping REAL seeds, so each
    // flip is a flip the engine took at the real site, and every number is stated
    // against the heads count read off the emitted rows rather than against a seed.
    //
    // A leaked printed base gives 30 / 60 / 90 — which OVERLAPS the correct
    // 0 / 30 / 60 at two of three points. Only the full sweep settles it, and the
    // 0-heads outcome is the one that cannot be faked.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = tandemausActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // EXACTLY TWO flips — the printed count, read from the sentence.
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(2);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(30 * heads);
      // …and the three totals the printed base WOULD have produced are absent.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads + 30);
      // Never a Knock Out on a 200 HP body, so every seed measures damage.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // THE SWEEP REACHED EVERY OUTCOME — asserted, not assumed. Measured: all three
    // appear by seed 5, well inside SEEDS.
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("reports base 0 and scaled 30 × heads on the DAMAGE_DEALT row", () => {
    // The event's own account of the fold, which is what an animator and the log
    // read. `base` is the printed base AFTER `scaledBase` dropped it — 0, on every
    // outcome — and the whole number arrives through `scaled`, the same pre-W/R
    // channel the count-scaling clauses and D126's heads bonus use. One channel for
    // "the attack's own extra", not three.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(tandemausActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        // No row at all — the `scaledBase + scaledTotal > 0` guard. Its own case
        // below states the rest of what that means.
        expect(damage).toBeUndefined();
        continue;
      }
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(30 * heads);
      expect(damage?.dealt).toBe(30 * heads);
      expect(damage?.weakness).toBeNull();
      expect(damage?.resistance).toBeNull();
      // The flips are announced BEFORE the damage they decided, in printed order.
      expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe("Meowth — THREE flips, FOUR outcomes, and a second N through the same loop", () => {
  it("deals exactly 20 × heads into a neutral body — 0 / 20 / 40 / 60", () => {
    // The second count, and the reason there are two cards: a suite built on
    // Tandemaus alone cannot tell a `flips` READ from the sentence from a hardcoded
    // 2. 20 ≠ 30 for the same reason — the two cards' total sets share only 0 and
    // 60, and 60 needs a different heads count on each, so no assertion here can be
    // passing for the other card's arithmetic.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = meowthActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(3);
      for (const flip of flips) expect(flip.seat).toBe("p1");
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(20 * heads);
      expect(activeDamage(done, "p2")).not.toBe(20 * heads + 20);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
      } else {
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(20 * heads);
        expect(damage?.dealt).toBe(20 * heads);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // ALL FOUR outcomes. Measured: 3 heads appears at seed 2, 0 heads not until seed
    // 10 — an all-tails triple is a 1-in-8 draw, which is exactly why a 3-flip card
    // needs a wider sweep than D126's two faces and why SEEDS is measured, not
    // inherited.
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("the rngState account — exactly `flips` steps, no more and no fewer", () => {
  it("recomputes both cards' whole flip sequences by hand, in order", () => {
    // THE ASSERTION THAT CATCHES AN OFF-BY-ONE OR A DOUBLE FLIP, and the reason the
    // loop's bound cannot be quietly wrong. D126 recomputed ONE `flipCoin` off the
    // pre-attack state; this recomputes N, and checks BOTH halves:
    //
    //   • the resulting rngState IS `after.rngState` — so N steps were consumed and
    //     nothing else in a plain attack (§8.5, the §8.1 sweep, the §5.3 turn end
    //     and its draw) touched the rng;
    //   • the resulting FACES are the emitted rows' results IN ORDER — so the rows
    //     are the flips that actually happened, not a re-read of one draw or a
    //     shuffled report.
    //
    // Either half alone is weak: a loop that flipped N times but reported the first
    // face N times passes the first, and a loop that reported N distinct faces off a
    // state it forgot to thread passes neither but for confusing reasons. Together
    // they are a total account.
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const [faces, expected] = foldFlips(state.rngState, flips);
        const { state: after, events } = mustApply(state, {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        expect(after.rngState).toBe(expected);
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(faces);
        // One MORE step would have landed here — named explicitly so the assertion
        // above is a claim about the count and not just about a number.
        expect(after.rngState).not.toBe(foldFlips(state.rngState, flips + 1)[1]);
        expect(after.rngState).not.toBe(foldFlips(state.rngState, flips - 1)[1]);
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the flip rows are the ONLY ones", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is
    // the older. An UNCONFUSED attacker must never emit its event and never consume
    // its step, so the N rows in the list are N and are all the attack's own.
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(flips);
    }
  });
});

describe("modifierSimulated — no loud row on ANY outcome, for EITHER card", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep", () => {
    // THE COVERAGE WIN, and D126's trap recurring exactly where D126 predicted it
    // would. Both cards print a "D×" marker, so `parseAttackDamage` hands attack.ts
    // a modifier "×" — and the coin reader is the thing that now consumes it. A
    // build that only widened `effectSimulated` resolves every number in this file
    // PERFECTLY and still flags all 22 printings loudly.
    //
    // Asserted on EVERY swept seed, not one: the row's condition does not depend on
    // the faces, but a future build that made it depend on them (say, by only
    // claiming the modifier when the bonus was non-zero) would fail on the 0-heads
    // outcome alone — which is exactly the outcome a single-seed case would miss.
    const seenTandemaus = new Set<number>();
    const seenMeowth = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const tandemaus = mustApply(tandemausActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const meowth = mustApply(meowthActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(tandemaus.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(meowth.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seenTandemaus.add(headsIn(tandemaus.events));
      seenMeowth.add(headsIn(meowth.events));
    }
    // …and the sweep really did cover every outcome of both, so "no loud row on ANY
    // outcome" is a statement about all seven and not about the ones a seed happened
    // to produce.
    expect([...seenTandemaus].sort()).toEqual([0, 1, 2]);
    expect([...seenMeowth].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("ZERO HEADS — a RESOLVED attack that dealt nothing, not a cancelled one", () => {
  it("emits no DAMAGE_DEALT and no ATTACK_FAILED, and still ends the turn", () => {
    // THE SHARPEST BEHAVIOURAL DIFFERENCE FROM `cancelOnTails`, and it deserves its
    // own case because the two are one union apart and look identical in the damage
    // column. Tarountula's all-tails is an attack that FAILED: it emits
    // ATTACK_FAILED with reason "coinFlip" and returns early from `finishAttack`.
    // Tandemaus's all-tails is an attack that RESOLVED and computed 0 — it walks the
    // whole §8.5 path, finds `scaledBase + scaledTotal === 0`, and skips only the
    // damage step. A build that routed `perHeads`'s zero through the cancel branch
    // would produce the same board and a DIFFERENT, wrong, event stream — and would
    // also skip the attack's effect ops, which this member has none of today but the
    // next one might.
    //
    // Both cards, because "0 heads" is a 1-in-4 draw on one and 1-in-8 on the other
    // and the branch is shared.
    let checked = 0;
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const before = activeDamage(state, "p2");
        const { state: done, events } = mustApply(state, {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        if (headsIn(events) !== 0) continue;
        checked += 1;
        // Every flip still happened and was still announced — the attack was fully
        // resolved, it simply totalled nothing.
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(flips);
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP").every((e) => e.result === "tails")).toBe(true);
        // NOTHING LANDED, stated as a list of absences.
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).not.toContain("COUNTERS_PLACED");
        expect(types(events)).not.toContain("KNOCKED_OUT");
        // …and the defender's damage is identical to before, not merely small.
        expect(activeDamage(done, "p2")).toBe(before);
        expect(activeDamage(done, "p2")).toBe(0);
        // BUT IT WAS NOT CANCELLED. No ATTACK_FAILED row of any reason — this is the
        // assertion that separates the two members.
        expect(types(events)).not.toContain("ATTACK_FAILED");
        expect(find(events, "ATTACK_FAILED")).toBeUndefined();
        // And the turn ended the ordinary way, through the same `finishAttack` every
        // resolved attack takes.
        expect(types(events)).toContain("TURN_ENDED");
        expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
      }
    }
    // Both cards actually reached the outcome — otherwise the block above is a loop
    // that asserted nothing.
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("the fold order — the dropped base and the count land BEFORE Weakness", () => {
  it("deals (0 + 60) × 2 = 120 into a Colorless-weak body, not 180 and not 60", () => {
    // THE ARITHMETIC THAT PINS BOTH HALVES AT ONCE. `coinBonus` is the attack's own
    // printed extra, so it joins `scaled` at the pre-W/R step — and `scaledBase` is
    // 0, so the printed 30 never enters the multiplication. Three numbers that
    // cannot be confused for one another:
    //
    //   120 = (0 + 60) × 2   — correct: base dropped, count folded pre-Weakness
    //   180 = (30 + 60) × 2  — the leaked printed base
    //    60 = 0 × 2 + 60     — the count folded AFTER Weakness (or not doubled)
    //
    // All three sit under fix-colorless-weak-big's 200 HP, so the case measures
    // damage and never a Knock Out or a promotion in the middle of a sweep.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = tandemausActive(opened, "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        // Zero heads doubles to zero, and the `> 0` guard means there is no row at
        // all — the Weakness multiplier never gets a number to multiply.
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
        continue;
      }
      // The multiplier really is live on this board — otherwise "120" below would be
      // a claim about nothing.
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(30 * heads);
      expect(damage?.dealt).toBe(60 * heads);
      expect(activeDamage(done, "p2")).toBe(60 * heads);
      if (heads === 2) {
        // Spelled out at the outcome the comment above is about.
        expect(damage?.dealt).toBe(120);
        expect(damage?.dealt).not.toBe(180);
        expect(damage?.dealt).not.toBe(60);
      } else {
        // ONE head: (0 + 30) × 2 = 60. The pair is what makes the 120 a fold-order
        // claim rather than a number.
        expect(damage?.dealt).toBe(60);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    // Measured: 1 head at seed 0, 2 heads at seed 2, 0 heads at seed 5 — all three
    // well inside SEEDS.
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe("the D126 members are UNTOUCHED", () => {
  it("still reads both one-flip sentences to their old shapes", () => {
    // A widened union is the classic place to break a sibling: the new regex runs
    // BETWEEN the two old ones, so a pattern that was one character looser would
    // swallow a sentence that used to reach `ATTACK_COIN_CANCEL`. Both D126
    // sentences, verbatim, through the widened deriver.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual({
      kind: "bonusOnHeads",
      per: 10,
    });
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    // …and neither acquired a `flips` field on the way past the new arm. The two
    // one-flip members are still one and two keys wide.
    expect(
      Object.keys(
        deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.") ?? {},
      ).sort(),
    ).toEqual(["kind", "per"]);
    expect(
      Object.keys(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.") ?? {}),
    ).toEqual(["kind"]);
  });

  it("still flips exactly ONCE for a cancelOnTails attack — the loop's `flips = 1` path", () => {
    // The end-to-end half, and it is not redundant with coinFlipDamage.test.ts: D127
    // replaced D126's single `flipCoin` draw with a LOOP, and `cancelOnTails` now
    // reaches it through `flips = 1`. A loop bound that defaulted to the wrong
    // number, or a `perHeads`-shaped `flips` read on a member that has none, would
    // burn extra rngState steps here and nowhere else.
    //
    // Tarountula sv01-018 "Surprise Attack" on D126's own deck, both faces swept —
    // one row, one step, and a tails that still cancels.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const opened = mustApply(
        driveSetup(
          seed,
          { p1: COIN_FLIP_DECK, p2: COIN_FLIP_DECK },
          { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
        ),
        { type: "endTurn", seat: "p2" },
      ).state;
      const state = attachFromDeck(
        setActiveFromDeck(opened, "p1", "sv01-018"),
        "p1",
        "fix-grass-energy",
        1,
      );
      const [faces, expected] = foldFlips(state.rngState, 1);
      const { state: after, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(faces);
      expect(after.rngState).toBe(expected);
      if (faces[0] === "heads") {
        sawHeads = true;
        // The printed base is KEPT on this member — the flat 30 lands, which is the
        // exact contrast with the "×" printings above.
        expect(find(events, "DAMAGE_DEALT")?.base).toBe(30);
        expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
      } else {
        sawTails = true;
        // …and tails still CANCELS, which zero heads on a `perHeads` attack does not.
        expect(find(events, "ATTACK_FAILED")?.reason).toBe("coinFlip");
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).toContain("TURN_ENDED");
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("purity", () => {
  it("resolves both multi-flip attacks on a DEEP-FROZEN board", () => {
    // The rngState thread and the damage write both go through fresh objects — a
    // frozen state proves nothing was mutated in place, on BOTH cards and on the
    // Weakness board (which is the one that also rewrites the defender). The loop
    // in attack.ts rebinds `next` on every flip, which is exactly the shape a
    // careless in-place `next.rngState = …` would have taken instead.
    for (let seed = 0; seed < SEEDS; seed++) {
      const tandemaus = deepFreeze(tandemausActive(weakDefender(board(seed), "p2"), "p1"));
      mustApply(tandemaus, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const meowth = deepFreeze(meowthActive(board(seed), "p1"));
      mustApply(meowth, { type: "attack", seat: "p1", index: FLIP_INDEX });
    }
    // …and the DERIVER is a pure function of its string, frozen board or not.
    expect(deriveAttackCoinFlip(DOUBLE_HIT)).toEqual({ kind: "perHeads", flips: 2, per: 30 });
    expect(deriveAttackCoinFlip(FURY_SWIPES)).toEqual({ kind: "perHeads", flips: 3, per: 20 });
  });
});
