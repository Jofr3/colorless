import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  countAttachedEnergy,
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
  FIXTURE_POOL,
  PER_ENERGY_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.78.0 → 0.79.0 — the BOARD-COUNTED FLIP COUNT (D128). "Flip a coin for each
// [{X}] Energy attached to this Pokémon. This attack does D damage for each heads."
// (3 printings) — Torkoal sv01-035 "Concentrated Fire" ({R}{C}{C}, 80×) counts the
// TYPED {R}; Ambipom swsh10.5-057 "Full Tilt Fling" ({C}, 60×) and Bellossom
// sv03-003 "Powerful Dance" ({G}, 90×) count attached Energy CARDS.
//
//   THE FLIP COUNT IS A BOARD FACT. THE DAMAGE COUNT IS STILL NOT.
//
// D126 built the seam (a printed flip is taken in front of the §8.5 pipeline) and
// D127 put a bounded LOOP on it. Both refused the board vocabulary for the same
// reason: a coin FACE is not a board fact, so `scaledAttackDamage` stayed pure and
// no `DamageCountSource` member was added. That rule is UNTOUCHED here — the damage
// still comes from the faces. What the board answers is HOW MANY TIMES TO FLIP,
// which is the one number the coin cannot answer, and that is why this slice is a
// WIDENED `flips` (`AttackFlipCount` = a printed N | an attached-Energy count)
// rather than a fourth `AttackCoinFlip` member. The fold, the loop, the one-row-
// per-flip event sequence and the dropped printed base are all D127's, verbatim,
// and this file re-asserts them on a count nobody printed.
//
// THE CENTRAL CASE IS THAT THE TYPED COUNT IS NOT THE ENERGY COUNT, and Torkoal is
// the card that can state it on ONE board: {R}{C}{C} is MET by 1 Fire + 2 Water
// (the Fire pays {R}, the two Waters pay {C}{C}), and the {R} COUNT is still 1. So
// the attack flips exactly ONCE for a maximum of 80 — where a reader that counted
// attached CARDS instead of the filter would flip three times and could deal 240.
// A cost check and a filtered count are different questions about the same pile,
// and 80 ≠ 240 is what proves the engine asks the second one.
//
// THE UNTYPED READING IS A GENUINELY DIFFERENT TALLY, not a filter that matches
// everything — which is the whole reason `energy` is NULLABLE rather than defaulted
// to some catch-all type. A FILTERED count reads by PROVISION (D118's rule, through
// `providesEnergyType`): an Energy that can pay a {R} cost is exactly an Energy a
// {R} clause counts, so a wildcard Luminous counts for EVERY type. An UNFILTERED
// count reads CARDS: a Special Energy that provides nothing typed is still one
// Energy attached, and a wildcard providing every type is still exactly ONE card.
// Collapsing null into "the type that matches everything" would quietly make the
// second question the first, and get Ambipom wrong on any board holding a demoted
// Special. `countAttachedEnergy`'s unit block below is where the two readings are
// made to DISAGREE on one Pokémon.
//
// A ZERO COUNT MEANS ZERO FLIPS, WHICH IS NOT ZERO HEADS — the sharpest new
// behaviour in the slice, and the one no printing can reach: all three carry a cost
// floor of at least one Energy, and Torkoal's {R} cost IS the {R} its filter counts.
// So the case runs on a CONSTRUCTED fixture (fix-flip-filter: a {C} cost against a
// {W} filter, the one combination that separates what PAYS from what COUNTS). Zero
// flips means no ATTACK_EFFECT_COIN_FLIP rows at all and NO rngState step consumed
// — where D127's zero-HEADS outcome spends every flip and announces every one of
// them. Both land on the same ending: no damage, and the turn still ends.
//
// AND THE BOUND DELIBERATELY DID NOT TRAVEL. D127's `MAX_PRINTED_FLIPS = 10` guards
// the `printed` member alone, because a bound is owed to the SOURCE of the number:
// printed digits come out of ingested third-party text and have no other ceiling,
// while an attached-Energy count is read off the engine's own state and is bounded
// by the deck that produced it. A ceiling here would refuse a legal board rather
// than a malformed row — the opposite of what that constant is for.
//
// THE TOKEN VOCABULARY IS D118's, NOT A LOCAL {R} LOOKUP. `CLAUSE_ENERGY_TOKENS`
// resolves brace codes ({R}) and spelled-out names (Fire) to the same member, plus
// `Special`, so a swsh-era reprint reading "for each Water Energy" is admitted by
// CONSTRUCTION. Both notations are asserted below on constructed probes, because
// today's only filtered printing is brace-coded and a code-only parser would look
// perfectly healthy right up until the pool prints the other spelling. An
// unresolvable token — {C}, {N}, Dragon, junk — is told apart from the UNFILTERED
// sentence by the token's PRESENCE, not by the lookup, so it falls through to the
// loud ATTACK_EFFECT_SKIPPED path instead of silently counting every attached card.
// {C} in particular must be refused: Colorless is the conservative provision
// fallback for every unauthored Special Energy, so a {C} filter would count cards
// nobody meant.

/** Torkoal sv01-035 "Concentrated Fire", verbatim, and pinned char-for-char against
    FIXTURE_POOL below. The pool's ONLY coin effect containing a brace token, and the
    one printing where the filter can be told apart from the cost on a single board.
    Torkoal carries no authored program (see the ZERO-rows block), so the sentence IS
    the wiring: a drifted character does not throw, it drops the card onto the loud
    ATTACK_EFFECT_SKIPPED path AND lets the printed 80 land flat every time, which is
    a wrong number rather than a missing one. */
const CONCENTRATED_FIRE =
  "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.";

/** Bellossom sv03-003 "Powerful Dance", verbatim — the UNTYPED reading, where the
    count is attached Energy CARDS and the type of each is irrelevant. */
const POWERFUL_DANCE =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 90 damage for each heads.";

/** Ambipom swsh10.5-057 "Full Tilt Fling" ({C}, 60×) — the untyped reading's SECOND
    printing, and the reason `energy: null` is a shape rather than a special case
    (D121's warrant: two printings, one token varying). Covered at the DERIVER level
    only and deliberately without a fixture: it is byte-identical to Bellossom's
    sentence except for its per-heads amount, so a board case would re-run
    Bellossom's arithmetic with a different number and prove nothing the deriver has
    not already said. What it DOES prove is that `per` is captured rather than
    assumed — 60 ≠ 90 off the same regex. */
const FULL_TILT_FLING =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 60 damage for each heads.";

/** fix-flip-filter's printed sentence — CONSTRUCTED, and the only route in this
    suite to a zero count. A {C} cost against a {W} filter: legal to declare with a
    single Fire attached, and counting zero. See the fixture for why no printing can
    reach this branch. */
const FILTERED_FLIP =
  "Flip a coin for each {W} Energy attached to this Pokémon. This attack does 50 damage for each heads.";

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss cases
    below name it instead of carrying it. */
const NBSP = " ";

/** U+00E9, likewise an escape. Unlike D126's and D127's sentences, EVERY sentence in
    this family names "Pokémon" — so all three are non-ASCII, their byte count is one
    more than their length, and the accent is the character a re-ingest is most
    likely to mangle. */
const E_ACUTE = "é";

/** U+00D7 — the printed damage marker on all three printings ("80×" / "90×" / "60×"),
    and the modifier `modifierSimulated` has to claim. Named rather than typed: it is
    one keystroke from an ASCII "x". */
const TIMES = "×";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no platform
    global is in scope and `tsc -b` — which CI runs — would reject it. Copied rather
    than shared with multiCoinFlip.test.ts / coinFlipDamage.test.ts, where it is local
    for the same reason: testFixtures.ts is a fixture module, not a string library.

    It earns more here than in either sibling: those slices' sentences are pure ASCII,
    where this family's are not, so length ≠ bytes is a REAL distinction this file can
    assert rather than a coincidence it can note. */
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

/** The flip attack's index on BOTH faithful printings. Torkoal prints "Stampede"
    ({C}{C}, a flat 30) first and Bellossom prints "Sleep Powder" ({C}, 30, a status)
    first, so index 1 is the coin attack on each — the same number by luck of the two
    printings, stated once so a reprint that added or reordered an attack fails here
    rather than silently moving every board case onto the wrong text. */
const FLIP_INDEX = 1;

/** …and index 0 on the constructed fixture, which prints exactly one attack. */
const FILTER_INDEX = 0;

/** Torkoal's OTHER attack — a flat 30 with no effect and no modifier. It is the
    control for every "the coin reader did not touch this" claim: the same card, the
    same board, no flip rows and no dropped base. */
const FLAT_INDEX = 0;

/** How far the seed sweeps run, and it is MEASURED on THIS deck, not inherited.
    Sweeping seeds 0..59, the first seed reaching each outcome is:

      ONE flip  (Torkoal, 1 Fire + 2 Water): 0 heads → seed 0, 1 head → seed 2.
      THREE flips (Torkoal on 3 Fire, and Bellossom on a 3-card mixed pile — the
        two land on the SAME rng draws, which is itself the point that the count is
        the only thing the two boards differ by): 0 → seed 10, 1 → seed 0,
        2 → seed 1, 3 → seed 2.

    ALL FOUR by seed 10, exactly as D127 measured for its own three-flip card (the
    all-tails triple is a 1-in-8 draw, which is what sets the number). 24 — D126's
    and D127's established bound — is comfortably past it, and every case that uses
    it ASSERTS it saw every outcome rather than trusting the loop. */
const SEEDS = 24;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first unrestricted
    turn, so the attack step is legal (§4).

    Both Active spots are pinned to fix-titan (340 HP, NO Weakness and NO Resistance,
    no attacks of its own) by SURGERY rather than through `driveSetup`'s hand pin,
    because two of the three attackers cannot be dealt into an opening at all
    (Bellossom is a Stage 2; fix-flip-filter is a constructed body) and the third must
    be fielded with a controlled Energy pile anyway. 340 HP is chosen against the
    biggest total in the file — Bellossom's three heads is 270 — so no swept seed can
    end on a Knock Out and park the turn on a promotion, and no case here is ever
    about §8.1. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PER_ENERGY_FLIP_DECK, p2: PER_ENERGY_FLIP_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Attach a pile onto `seat`'s Active, in the order given — the suite's whole
    board-building vocabulary, because every case here differs from every other ONLY
    in which Energy is attached. Must run AFTER the attacker is fielded
    (`attachFromDeck` attaches to whatever is in the Active Spot). */
function pile(state: GameState, seat: Seat, spec: [id: string, count: number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Torkoal in the seat's Active Spot, with the pile the case wants.
    SURGERY: Torkoal is a Basic and COULD be dealt, but a swept seed cannot be relied
    on to deal any particular card, so every case fields its attacker. */
function torkoalActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "sv01-035"), seat, spec);
}

/** Bellossom in the seat's Active Spot, with the pile the case wants. It is a
    STAGE 2 and there is no Gloom or Oddish in the deck, so surgery is the only way it
    reaches the Active Spot — the same route Tinkaton and Spidops ex take in their own
    suites. What is being tested is the flip count, not the evolution chain. */
function bellossomActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "sv03-003"), seat, spec);
}

/** The constructed {W}-filter body in the seat's Active Spot, with the pile the case
    wants. Its {C} cost is paid by ANY one Energy, which is what lets a case attach a
    pile its filter counts NOTHING in. */
function filterActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "fix-flip-filter"), seat, spec);
}

/** The 210 HP ×2 FIRE body in the seat's Active Spot — the pre-Weakness fold
    defender. Torkoal is a Fire attacker, so the multiplier is live against it; 210 HP
    survives 160 (one head doubled), so the fold-order case measures damage and never
    a Knock Out. */
function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-pokemon-v-weak");
}

/** The seat's Active damage — read straight off the board, so the "nothing happened"
    cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

/** Take `count` flips from `state` by hand, returning the faces IN ORDER and the
    rngState they leave behind — D127's helper, and the whole rngState account rests
    on it. `count === 0` is a REAL call here and not a degenerate one: it returns the
    input state unchanged, which is exactly the claim the zero-count case makes. */
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

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Torkoal sv01-035", () => {
    const attack = FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(CONCENTRATED_FIRE);
    expect(attack?.name).toBe("Concentrated Fire");
    // "80×" — a STRING, and the load-bearing field TWICE over. Its digits ARE the
    // per-heads amount, so the printed base must be dropped; and its "×" is the
    // modifier `modifierSimulated` has to claim. Typed as a number it would parse to
    // a bare 80 with no modifier and BOTH regressions would become invisible at once.
    expect(attack?.damage).toBe(`80${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // THE COST IS THE CASE. {R}{C}{C} is what makes "the cost is met and the count is
    // still 1" a board this suite can build — a card whose cost were {R}{R}{R} could
    // not tell a filtered count from an unfiltered one at all.
    expect(attack?.cost).toEqual(["Fire", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason FLIP_INDEX is 1 on this card.
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.name).toBe("Stampede");
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.damage).toBe(30);
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-035"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-035"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Bellossom sv03-003", () => {
    const attack = FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(POWERFUL_DANCE);
    expect(attack?.name).toBe("Powerful Dance");
    expect(attack?.damage).toBe(`90${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // ONE symbol, which is what lets a legal declaration hold a pile of three
    // different types — the board that separates "counts CARDS" (3) from "counts
    // Grass" (1).
    expect(attack?.cost).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv03-003"]?.attacks?.[FLAT_INDEX]?.name).toBe("Sleep Powder");
    expect(FIXTURE_POOL["sv03-003"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv03-003"]?.abilities).toBeNull();
  });

  it("matches the CONSTRUCTED zero-count probe, and says why it is constructed", () => {
    const attack = FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX];
    expect(attack?.effect).toBe(FILTERED_FLIP);
    expect(attack?.damage).toBe(`50${TIMES}`);
    // THE ONLY REASON THIS CARD EXISTS: a cost that shares NO symbol with the filter.
    // Every real printing has a cost floor of at least one Energy, and Torkoal's {R}
    // cost IS the {R} its filter counts — so on a legal declaration the count is
    // never 0. A {C} cost against a {W} filter breaks that coupling.
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(attack?.cost).not.toContain("Water");
    expect(FILTERED_FLIP).toContain("{W}");
    expect(FIXTURE_POOL["fix-flip-filter"]?.attacks).toHaveLength(1);
    // …and the three real printings' costs really do all include an Energy the card
    // can count, stated as the fact that makes the branch unreachable in the pool.
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.cost).toContain("Fire");
    expect(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.cost).toHaveLength(1);
  });

  it('splits all three printed markers into base + "×" through parseAttackDamage', () => {
    // The exact hand-off the slice depends on: `parseAttackDamage` produces the `base`
    // that `scaledBase` then DROPS and the `modifier` that `modifierSimulated` then
    // claims. Asserting the split here means the end-to-end claims below (dealt
    // 80 × heads, no ATTACK_EFFECT_SKIPPED) are about attack.ts's decisions and not
    // about a parse that quietly produced nothing.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 80,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 90,
      modifier: TIMES,
    });
    expect(
      parseAttackDamage(FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX]?.damage),
    ).toEqual({ base: 50, modifier: TIMES });
    // The digits of the marker and the `per` of the derived shape are THE SAME NUMBER
    // printed once — stated explicitly, because the whole "drop the base" rule is only
    // correct because of it. (Read through a narrowing check rather than `?.per`:
    // `cancelOnTails` has no such field, and the union is what says so.)
    for (const [text, damage] of [
      [CONCENTRATED_FIRE, `80${TIMES}`],
      [POWERFUL_DANCE, `90${TIMES}`],
      [FILTERED_FLIP, `50${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
    // …and the flat control carries NO modifier at all, which is why it can never be
    // confused for a member of this family.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: null,
    });
  });

  it("keeps the card facts the counts are measured against", () => {
    expect(FIXTURE_POOL["sv01-035"]?.name).toBe("Torkoal");
    expect(FIXTURE_POOL["sv01-035"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-035"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-035"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv01-035"]?.retreat).toBe(3);
    expect(FIXTURE_POOL["sv01-035"]?.weaknesses).toEqual([{ type: "Water", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv01-035"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["sv01-035"]?.evolveFrom).toBeNull();

    // A STAGE 2 that evolves from Gloom — pinned because it is why every case force-
    // places this card, and because a fixture that quietly became a Basic would make
    // the surgery look unnecessary.
    expect(FIXTURE_POOL["sv03-003"]?.name).toBe("Bellossom");
    expect(FIXTURE_POOL["sv03-003"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv03-003"]?.evolveFrom).toBe("Gloom");
    expect(FIXTURE_POOL["sv03-003"]?.types).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv03-003"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv03-003"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv03-003"]?.weaknesses).toEqual([{ type: "Fire", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv03-003"]?.resistances).toBeNull();

    // TORKOAL IS FIRE and the weak body is ×2 FIRE — which is what makes the fold-order
    // case a claim about this attacker rather than about a body nothing here can hit.
    // 210 HP is above 160 (one head doubled), so that case measures damage.
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.weaknesses).toEqual([
      { type: "Fire", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.hp).toBe(210);
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.resistances).toBeNull();
    // …and the neutral defender has NEITHER, so every other case reads the folded
    // number unmodified. 340 HP is above every total in this file (Bellossom's three
    // heads is 270), so no swept seed ends on a Knock Out.
    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
  });

  it("pins the BYTES — and that every sentence in THIS family is non-ASCII", () => {
    // THE CENSUS THIS FAMILY FAILS WHERE D126's AND D127's PASSED. Their sentences
    // name no Pokémon, so bytes and code points were equal; every sentence here says
    // "attached to this Pokémon", so each carries exactly one U+00E9 and each is one
    // BYTE longer than it is characters. That difference is the guard: a re-ingest
    // that mangled the accent (é → e, or a decomposed e + U+0301) changes the byte
    // count without changing much else, and the deriver would refuse the row silently.
    expect(CONCENTRATED_FIRE.length).toBe(100);
    expect(utf8Bytes(CONCENTRATED_FIRE)).toBe(101);
    expect(POWERFUL_DANCE.length).toBe(96);
    expect(utf8Bytes(POWERFUL_DANCE)).toBe(97);
    expect(FILTERED_FLIP.length).toBe(100);
    expect(utf8Bytes(FILTERED_FLIP)).toBe(101);
    expect(FULL_TILT_FLING.length).toBe(96);
    expect(utf8Bytes(FULL_TILT_FLING)).toBe(97);
    for (const sentence of [CONCENTRATED_FIRE, POWERFUL_DANCE, FILTERED_FLIP, FULL_TILT_FLING]) {
      // EXACTLY ONE non-ASCII character, and it is the accent — asserted over the
      // characters rather than inferred from the byte total, which a pair of
      // compensating drifts could fake.
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([E_ACUTE]);
      expect(sentence).toContain(`this Pok${E_ACUTE}mon`);
      // A DECOMPOSED accent is byte-different and looks identical in a diff.
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP); // the invisible drift
      // The "×" lives in the DAMAGE field, never in the effect text.
      expect(sentence).not.toContain(TIMES);
      // The shared trailing sentence, char-for-char: the clause whose one missing word
      // ("more") separates this family from the additive one.
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      expect(sentence).not.toContain("more");
      // The shared OPENING, which is what denies these strings D125's and D115's `^If`
      // anchor and keeps them off the other three readers.
      expect(sentence.startsWith("Flip a coin for each ")).toBe(true);
      // …and it is NOT D127's opening, which is the property that keeps the two coin
      // arms from ever meeting.
      expect(sentence.startsWith("Flip 2 coins.")).toBe(false);
      expect(sentence).toBe(sentence.trim());
    }
    // The TYPED and UNTYPED sentences differ by exactly the token and its space, which
    // is the entire difference between the two readings.
    expect(CONCENTRATED_FIRE.replace("{R} ", "").replace("80", "90")).toBe(POWERFUL_DANCE);
    // …and the two untyped printings differ by exactly their per-heads amount.
    expect(POWERFUL_DANCE.replace("90", "60")).toBe(FULL_TILT_FLING);
  });
});

describe("deriveAttackCoinFlip — the FOURTH shape, and the first flip count read off the BOARD", () => {
  it("reads Torkoal's TYPED sentence to an attachedEnergy count", () => {
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    // THE MEMBER IS THE POINT, not just the number: `printed` would mean "flip this
    // many times whatever the board says", which for a card whose count IS the board
    // is a different attack. Stated as a tag assertion too, so a build that produced
    // the right value under the wrong constructor fails here rather than three cases
    // down.
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toHaveProperty("flips.kind", "attachedEnergy");
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).not.toHaveProperty("flips.count");
    // Three keys on the member and two inside the count, and nothing else: the shape
    // gained a BOUND, not a consequent. In particular there is no `cond` and no
    // `count` source — D126's rule still holds and `scaledAttackDamage` was not asked
    // a new question.
    const flip = deriveAttackCoinFlip(CONCENTRATED_FIRE);
    if (flip === null) throw new Error("unreachable");
    expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
    if (flip.kind !== "perHeads") throw new Error("expected perHeads");
    expect(Object.keys(flip.flips).sort()).toEqual(["energy", "kind"]);
    expect(flip).not.toHaveProperty("cond");
  });

  it("reads BOTH untyped printings to energy: null, with their own per", () => {
    // Bellossom and Ambipom are the same sentence with a different number, which is
    // D121's warrant for a shape rather than a row: exactly one token varies, and it
    // is one the regex already captures. Ambipom is covered HERE and nowhere else —
    // an end-to-end case would re-run Bellossom's arithmetic on a different constant.
    expect(deriveAttackCoinFlip(POWERFUL_DANCE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
    expect(deriveAttackCoinFlip(FULL_TILT_FLING)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 60,
    });
    // NULL IS A READING, NOT A FAILURE — and this is the assertion that says so. An
    // unresolvable token also produces "no type", but it produces it by refusing the
    // whole sentence (the next block), so the two are told apart by the token's
    // PRESENCE. A build that conflated them would return this same value for
    // "for each {C} Energy attached…" and count every attached card on a card that
    // asked for one type.
    const flip = deriveAttackCoinFlip(POWERFUL_DANCE);
    if (flip?.kind !== "perHeads" || flip.flips.kind !== "attachedEnergy") {
      throw new Error("expected an attachedEnergy perHeads printing");
    }
    expect(flip.flips.energy).toBeNull();
    // 60 ≠ 90 off ONE regex: `per` is captured, not assumed.
    expect(deriveAttackCoinFlip(FULL_TILT_FLING)).not.toEqual(deriveAttackCoinFlip(POWERFUL_DANCE));
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 80 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per: 90 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Water" }, per: 50 });
  });
});

describe("both notations, one vocabulary — a spelled-out type derives identically to its brace code", () => {
  it("reads every basic type through BOTH spellings, off the one regex", () => {
    // D118's rule, re-applied rather than re-derived: the pool prints energy types two
    // ways, split cleanly by set (sv* brace-codes, swsh10.5 spells them out), and
    // today ALL THREE printings of this sentence sit on the side that needs neither —
    // Torkoal brace-codes, the other two carry no filter. So this is the case that
    // stops a code-only parser from looking perfectly healthy right up until the pool
    // prints "for each Water Energy", which it eventually will.
    //
    // Nine types × two notations off ONE pattern and ZERO table rows. A reader built
    // on literal sentences would need eighteen.
    const codes: Record<string, string> = {
      Grass: "{G}",
      Fire: "{R}",
      Water: "{W}",
      Lightning: "{L}",
      Psychic: "{P}",
      Fighting: "{F}",
      Darkness: "{D}",
      Metal: "{M}",
      Fairy: "{Y}",
    };
    for (const type of BASIC_ENERGY_TYPES) {
      const code = codes[type];
      if (code === undefined) throw new Error(`no brace code for ${type}`);
      const braced = `Flip a coin for each ${code} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      const spelled = `Flip a coin for each ${type} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      const expected = {
        kind: "perHeads",
        flips: { kind: "attachedEnergy", energy: type },
        per: 50,
      };
      expect(deriveAttackCoinFlip(braced)).toEqual(expected);
      expect(deriveAttackCoinFlip(spelled)).toEqual(expected);
      // …and the two notations really are the SAME value, not two values that happen
      // to satisfy the same literal.
      expect(deriveAttackCoinFlip(spelled)).toEqual(deriveAttackCoinFlip(braced));
    }
    // The one real filtered printing sits inside that sweep, so the sweep is a claim
    // about the pool and not only about constructed text.
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE.replace("{R}", "Fire"))).toEqual(
      deriveAttackCoinFlip(CONCENTRATED_FIRE),
    );
  });

  it("reads `Special` — the CARD CLASS, which is not a type at all", () => {
    // The third thing `CLAUSE_ENERGY_TOKENS` resolves, and it answers a different
    // question from every type above: `special` counts CARDS THAT ARE Special Energy,
    // read off `isSpecialEnergy` rather than through provision — so a Special that
    // provides only {C} still counts, and a BASIC Fire never does however it is
    // spelled. No printing of THIS sentence carries it today; it is admitted because
    // the vocabulary is shared with D118's clause, where two printings do.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Special Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "special" }, per: 50 });
    // Lower-cased it is NOT the token — the map is keyed on the printed capital.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each special Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
  });
});

describe("unresolvable tokens stay LOUD — a filter nobody can resolve is not an unfiltered count", () => {
  it("refuses {C} — because Colorless is the SPECIAL-ENERGY FALLBACK, not a type", () => {
    // THE SHARPEST REFUSAL IN THE SLICE, and the one with a reason rather than a rule.
    // {C} is absent from `ENERGY_TYPE_BY_CODE` on purpose: Colorless is the
    // conservative provision fallback every UNAUTHORED Special Energy falls back to,
    // so a `{C}` filter would count cards nobody meant — every unauthored Special on
    // the board would answer it. Refusing the sentence outright drops the card onto
    // the loud ATTACK_EFFECT_SKIPPED path, where a silent over-count would not be
    // visible at all.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {C} Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    // …and the spelled-out form is refused by the same absence, from the other
    // notation: `Colorless` is deliberately not in BASIC_ENERGY_TYPES (it is a cost
    // SYMBOL, not an attachable basic type), so the name map cannot resolve it either.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Colorless Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect((BASIC_ENERGY_TYPES as readonly string[]).includes("Colorless")).toBe(false);
  });

  it("refuses every OTHER token that resolves to nothing — codes, names and junk", () => {
    // The rest of the unresolvable space, and each one is refused by the LOOKUP rather
    // than by the pattern: they all match the sentence perfectly and fail on the token.
    // The failure mode being guarded is the same in every row — falling back to the
    // UNFILTERED reading and counting every attached card.
    for (const token of [
      "{N}", // no such code in either notation
      "{Q}", // ditto — a plausible-looking one
      "{c}", // the right code, wrong case
      "Dragon", // a real Pokémon TYPE with no Basic Energy at all, so not in the map
      "Fake", // junk
      "{R", // a truncated brace
      "R", // a bare code letter with no braces
      "{R} Basic", // a compound the greedy `.+` will happily capture whole
    ]) {
      const text = `Flip a coin for each ${token} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      expect(deriveAttackCoinFlip(text)).toBe(null);
      // …and the SAME sentence with the token removed is the unfiltered reading, which
      // is what makes each null above a claim about the token and not about the shape.
      expect(deriveAttackCoinFlip(text.replace(`${token} `, ""))).toEqual({
        kind: "perHeads",
        flips: { kind: "attachedEnergy", energy: null },
        per: 50,
      });
    }
  });

  it("refuses a printed ZERO per — the `per >= 1` guard every arm of the family carries", () => {
    // Nothing in the pool prints it, and the guard is what keeps that a FACT about the
    // pool rather than an assumption: a 0-per printing would spend N flips (and N
    // rngState steps, and N events) to deal nothing on every outcome, which is
    // indistinguishable from a bug. Refused on BOTH readings, because the deriver has
    // two returns here and only one of them is on the path a filtered sentence takes.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 0 damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 0 damage for each heads.",
      ),
    ).toBe(null);
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 1 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per: 1 });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 1 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 1 });
  });

  it('refuses the NEAR-MISSES — "more", the wrong subject, and the missing accent', () => {
    // THE WORD "more" IS THE FAMILY LINE, exactly as it is for D127 and for the two
    // scaling readers. A "more" printing keeps its printed base and adds on top, so
    // reading one here would drop a base it must not drop and score the card wrong on
    // every outcome. No live printing carries this variant today, which is precisely
    // why it is pinned now — the first one that appears must land loudly.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 50 more damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 50 more damage for each heads.",
      ),
    ).toBe(null);
    // THE WRONG SUBJECT. "attached to YOUR POKÉMON" is a whole-BOARD count, a strictly
    // bigger number than the self-count this shape resolves, and `countAttachedEnergy`
    // is a per-Pokémon reader that cannot answer it (`countEnergyInPlay` is the
    // board-wide sibling, and nothing here calls it). Reading this sentence would flip
    // once per Energy on the entire bench.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to your Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to each of your Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    // THE MISSING ACCENT — the one drift a re-ingest is most likely to introduce, and
    // the reason the byte guard above exists. "Pokemon" is not "Pokémon".
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokemon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE.replace(E_ACUTE, "e"))).toBe(null);
  });

  it("refuses the anchor, casing, whitespace and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // Lowercase "this" one sentence later.
      "Flip a coin for each Energy attached to this Pokémon. this attack does 50 damage for each heads.",
      // No trailing period is not the whole sentence.
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads",
      // The CONSEQUENT ALONE — the degenerate string a substring matcher would claim.
      "This attack does 50 damage for each heads.",
      // The OPENING alone — a count with nothing to fold it into.
      "Flip a coin for each Energy attached to this Pokémon.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip a coin for each Energy attached to this Pokémon.This attack does 50 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip a coin for each Energy attached to this Pokémon.  This attack does 50 damage for each heads.",
      // "coins" for "coin" — D127's plural, which belongs to the other arm.
      "Flip a coins for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // "head" for "heads".
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip a coin for each Energy attached to this Pokémon.${NBSP}This attack does 50 damage for each heads.`,
      // A SECOND CONSEQUENT riding the same flips — the shape the `$` exists for. The
      // engine would resolve the damage and silently drop the rider.
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads, and discard an Energy from this Pokémon.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBe(null);
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${CONCENTRATED_FIRE} `)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(`  ${POWERFUL_DANCE}\n`)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
  });
});

describe("deriver disjointness — a fourth SHAPE that crosses none of the other four readers", () => {
  it("keeps all three sentences off the effect/bonus/multiplier/requirement readers", () => {
    // THE DOUBLE-READ CHECK, done EMPIRICALLY rather than by reading the regexes, and
    // the risk here is the sharpest in the whole coin family: the sentence contains
    // BOTH halves of `deriveAttackDamageMultiplier`'s family ("This attack does N
    // damage for each …") AND the exact clause `deriveAttackDamageBonus` reads for
    // Entei's "Blaze Ball" ("… for each {R} Energy attached to this Pokémon."). A
    // cross-read would fold the damage TWICE — once off the board and once off the
    // coin — which is a bigger number on the same event.
    for (const sentence of [CONCENTRATED_FIRE, POWERFUL_DANCE, FILTERED_FLIP, FULL_TILT_FLING]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("keeps a REAL sentence of each of the four families off deriveAttackCoinFlip", () => {
    // The mirror, one live representative per family, so the nulls above are refusals
    // in both directions and not one reader being dead. The second row is Entei's
    // actual printing, which is the nearest live neighbour this slice has.
    const representatives = [
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — the additive "+" family, on a count that reader
      // really does answer.
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      // deriveAttackDamageMultiplier — the "×" shape on a board count.
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

  it("keeps Entei's ATTACHED-ENERGY count off the COIN reader — now that damage reads it", () => {
    // THE NEAREST LIVE NEIGHBOUR THIS SLICE HAS, and the one case where "unmapped
    // stays LOUD" could plausibly have been broken by accident. Entei sv03-030 "Blaze
    // Ball" counts THE SAME NOUN this slice counts — "for each {R} Energy attached to
    // this Pokémon" — and D128 deliberately did NOT give that noun to the coin reader:
    // what THIS slice counts is FLIPS, not damage.
    //
    // ⚠️ THE DAMAGE HALF OF THIS ASSERTION INVERTED IN 0.126.0 (D196), AND THAT MAKES
    // IT A BETTER TEST, NOT A WEAKER ONE. `energyOnSelf` now reads Blaze Ball as an
    // additive bonus. So the sentence is live on the DAMAGE side and must still be
    // dead on the COIN side — which is the disjointness this file is actually about,
    // and it could not be stated at all while both sides were null. A null pair is
    // consistent with two dead readers; a live/dead pair is not.
    const blazeBall =
      "This attack does 20 more damage for each {R} Energy attached to this Pokémon.";
    expect(FIXTURE_POOL["sv03-030"]?.attacks?.[0]?.effect).toBe(blazeBall);
    expect(deriveAttackCoinFlip(blazeBall)).toBeNull();
    expect(deriveAttackDamageBonus(blazeBall)).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    // The `×` twin still refuses it — "more" is the fold discriminator, and a
    // sentence that reaches BOTH damage readers would fold twice.
    expect(deriveAttackDamageMultiplier(blazeBall)).toBeNull();
    // The two sentences share their counted noun VERBATIM, which is what makes the
    // coin reader's null a statement about the CONSEQUENT rather than about the text:
    // CONCENTRATED_FIRE contains the identical clause and DOES derive a flip count.
    expect(blazeBall.endsWith("for each {R} Energy attached to this Pokémon.")).toBe(true);
    expect(CONCENTRATED_FIRE).toContain("for each {R} Energy attached to this Pokémon.");
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).not.toBeNull();
    // …and the coin sentence must not have started deriving DAMAGE either, which is
    // the mirror risk `energyOnSelf` introduces: its pattern's optional type token is
    // `(.+)`, and a dropped `^This attack does` anchor would let it swallow a flip
    // printing whose tail is the same clause.
    expect(deriveAttackDamageBonus(CONCENTRATED_FIRE)).toBeNull();
    expect(deriveAttackDamageMultiplier(CONCENTRATED_FIRE)).toBeNull();
  });

  it("leaves the other AttackCoinFlip readings exactly where they were", () => {
    // A widened field is the classic place to break a sibling: the new arm runs
    // BETWEEN the multi-flip one and the cancel test, so a pattern one character
    // looser would swallow a sentence that used to reach one of them, and a `flips`
    // that changed shape would show up on D127's member first.
    //
    // D129 THEN WIDENED THE OTHER MEMBER THE SAME WAY, which is why the first
    // expectation below carries a `flips` this case originally asserted was ABSENT.
    // `bonusOnHeads` had to say where its flip count comes from once "Flip a coin
    // until you get tails. This attack does 30 more damage for each heads."
    // (Bouffalant sv03-174) turned up as its consequent over an unbounded count —
    // D128's own rule, applied to the other member. `printed 1` is what D126's 20
    // printings always were implicitly, and their CONSEQUENT (base kept, `heads ×
    // per` folded pre-W/R) is untouched.
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
    // D127's member, with its count under the OTHER `AttackFlipCount` constructor —
    // the assertion that the two members of the new union are both live and are told
    // apart by the sentence.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 30 });
    expect(
      deriveAttackCoinFlip("Flip 3 coins. This attack does 20 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 3 }, per: 20 });
    // `cancelOnTails` did NOT acquire one, and the asymmetry is deliberate: that
    // member IS "flip once, then take the printed branch", so attack.ts spells its
    // single flip as a local value rather than as a field nothing would vary.
    expect(
      Object.keys(
        deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.") ?? {},
      ).sort(),
    ).toEqual(["flips", "kind", "per"]);
    expect(
      Object.keys(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.") ?? {}),
    ).toEqual(["kind"]);
    // THE UNBOUNDED OPENING IS THE SHAPE D129 BUILT, and this slice's arm runs BEFORE
    // both of its regexes — so "the board-counted arm must not swallow it" is a live
    // claim, not a historical one, and the `flips` TAG is what states it. This case
    // used to pin the same two sentences as REFUSED; the witness is RE-POINTED at the
    // shape they now read to rather than deleted, because a witness dropped when its
    // subject gets built is a witness that was never load-bearing. (Their own suite
    // is untilTailsFlip.test.ts.)
    for (const [text, expected] of [
      [
        "Flip a coin until you get tails. This attack does 30 damage for each heads.",
        { kind: "perHeads", flips: { kind: "untilTails" }, per: 30 },
      ],
      [
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
        { kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 },
      ],
    ] as const) {
      expect(deriveAttackCoinFlip(text)).toEqual(expected);
      // NOT this slice's constructor: `attachedEnergy` would mean a count read off a
      // board that has nothing to say about it, and would flip once per attached
      // Energy on a card whose count is a property of the FACES.
      expect(deriveAttackCoinFlip(text)).not.toHaveProperty("flips.energy");
      expect(deriveAttackCoinFlip(text)).toHaveProperty("flips.kind", "untilTails");
    }
    // 🆕🆕 **D463 — THE LAST UNMAPPED SENTENCE OF THIS OPENING IS NOW MAPPED, AND THE
    // WITNESS IS RE-POINTED RATHER THAN DELETED** (the rule this same rung applied to its
    // own pair eleven lines above, applied to itself). Krookodile sv01-117 derives
    // `programPerHeads` over `untilTails`, so the claim it carried — *"the board-counted
    // arm must not swallow D129's opening"* — is now stated in the STRONG form: it is not
    // that nothing reads the sentence, it is that what reads it reads the FACES and not the
    // BOARD. A `null` could have been produced by the sentence being unreachable; this
    // cannot.
    // ⚠️ **AND THE DISCRIMINATION IS BETTER THAN THE ONE IT REPLACES.** `toBe(null)` was
    // satisfied by every possible bug in this file's arm as well as by the correct
    // behaviour. `flips.kind === "untilTails"` with no `flips.energy` is satisfied by
    // exactly one of them.
    const krookodile = deriveAttackCoinFlip(
      "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
    );
    expect(krookodile).not.toBeNull();
    expect(krookodile).toHaveProperty("kind", "programPerHeads");
    expect(krookodile).toHaveProperty("flips.kind", "untilTails");
    expect(krookodile).not.toHaveProperty("flips.energy");
    // …and Masquerain's real sentence (corpus line 216, "Flip 3 coins.") is the one that
    // still has nothing to do with this arm: a PRINTED count, not an unbounded one, and not
    // an attached-Energy one either. D452 built it; the near-miss this file cares about is
    // that neither of them reaches `attachedEnergy`.
    expect(
      deriveAttackCoinFlip("Flip 3 coins. For each heads, discard a random card from your opponent's hand."),
    ).toHaveProperty("flips.kind", "printed");
  });
});

describe("ZERO registry rows — all three cards flip straight off their printed text", () => {
  it("has no program of any kind for any of them", () => {
    for (const id of ["sv01-035", "sv03-003", "fix-flip-filter"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Torkoal — the TYPED count is not the ENERGY count, on a board where the cost is MET", () => {
  it("flips ONCE on 1 Fire + 2 Water: 0 or 80, and never the 240 an unfiltered count gives", () => {
    // THE CENTRAL CASE OF THE SLICE. The pile pays {R}{C}{C} in full — the Fire covers
    // {R}, the two Waters cover {C}{C} — so the attack is legal with THREE Energy
    // attached. The {R} COUNT is 1.
    //
    //   1 flip  → 0 or 80          — correct: the filter counts Fire
    //   3 flips → 0/80/160/240     — the bug: the count ignored its filter
    //
    // The two outcome sets OVERLAP at 0 and 80, so no single seed settles it: what
    // settles it is the ROW COUNT, asserted on every swept seed, plus the explicit
    // absence of the totals only three flips could produce.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = torkoalActive(board(seed), "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 2],
      ]);
      // The board really is the one described: three Energy cards attached, of which
      // exactly one is Fire. Without this the case could pass on a board that simply
      // failed to attach the Waters.
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(80 * heads);
      // The three totals an unfiltered count could have produced, named as absences.
      expect(activeDamage(done, "p2")).not.toBe(240);
      expect(activeDamage(done, "p2")).not.toBe(160);
      // …and the printed base never leaks: one head is 80, not 160.
      expect(activeDamage(done, "p2")).not.toBe(80 * heads + 80);
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // BOTH outcomes of the single flip were reached — asserted, not assumed.
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it("reports base 0 and scaled 80 on the DAMAGE_DEALT row, and no row at all on tails", () => {
    // The event's own account of the fold, which is what an animator and the log read.
    // `base` is the printed 80 AFTER `scaledBase` dropped it — 0 on every outcome —
    // and the whole number arrives through `scaled`, the same pre-W/R channel the
    // count-scaling clauses and D126's heads bonus use. One channel for "the attack's
    // own extra", not three.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(
        torkoalActive(board(seed), "p1", [
          ["fix-fire-energy", 1],
          ["fix-water-energy", 2],
        ]),
        { type: "attack", seat: "p1", index: FLIP_INDEX },
      );
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        // No row at all — the `scaledBase + scaledTotal > 0` guard, D127's ending
        // reached through a board-counted flip.
        expect(damage).toBeUndefined();
        continue;
      }
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(80);
      expect(damage?.dealt).toBe(80);
      expect(damage?.weakness).toBeNull();
      expect(damage?.resistance).toBeNull();
      // The flip is announced BEFORE the damage it decided.
      expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it("flips THREE times on 3 Fire — the same card, the same text, a different board", () => {
    // THE COUNT IS READ, AND THIS IS WHERE THAT BECOMES PROVABLE. D127 needed two
    // CARDS to tell a read count from a hardcoded one; this slice needs only two
    // BOARDS, because the number lives on the board rather than in the string. One
    // Fire gives one flip and three give three, off one printing and one derived value.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = torkoalActive(board(seed), "p1", [["fix-fire-energy", 3]]);
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      // 0 / 80 / 160 / 240, and the printed base is dropped on every one of them: a
      // leaked base would read 80 / 160 / 240 / 320, which OVERLAPS the correct set at
      // two points — only the 0-heads outcome cannot be faked, and the sweep reaches it.
      expect(activeDamage(done, "p2")).toBe(80 * heads);
      expect(activeDamage(done, "p2")).not.toBe(80 * heads + 80);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
      } else {
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(80 * heads);
        expect(damage?.dealt).toBe(80 * heads);
      }
      // 240 into 340 HP is not a Knock Out, so every seed measures damage.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // ALL FOUR outcomes. Measured: 3 heads at seed 2, 0 heads not until seed 10 — an
    // all-tails triple is a 1-in-8 draw, which is what sets SEEDS.
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("leaves the card's OTHER attack completely alone — a flat 30, no flips, base kept", () => {
    // The control, on the same card and the same board. "Stampede" prints a bare
    // number with no effect and no modifier, so it must take NO flip, keep its printed
    // base, and emit no loud row — which is what says the coin reader is keyed to the
    // TEXT of the attack being declared and not to the card carrying it.
    const state = torkoalActive(board(0), "p1", [["fix-water-energy", 2]]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLAT_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(find(events, "DAMAGE_DEALT")?.base).toBe(30);
    // `scaled` is "present only when it applied", so its ABSENCE is the claim: nothing
    // was folded in front of Weakness at all, where the flip attack's whole number
    // arrives through that field.
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(activeDamage(done, "p2")).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Bellossom — the UNTYPED count reads CARDS, whatever each one provides", () => {
  it("flips once per attached Energy on a THREE-TYPE pile — 3 flips, not the 1 a Grass filter gives", () => {
    // THE OTHER READING, end to end. The pile is Grass + Fire + Water and the cost is
    // a single {G}, so the attack is legal and only ONE of the three cards has
    // anything to do with paying for it. The count is 3 because "each Energy attached"
    // counts CARDS.
    //
    //   3 flips → 0/90/180/270   — correct
    //   1 flip  → 0/90           — the bug: null read as "the Grass filter"
    //
    // The two sets overlap at 0 and 90, so again it is the ROW COUNT that settles it,
    // asserted on every seed, backed by the two totals only three flips can reach.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = bellossomActive(board(seed), "p1", [
        ["fix-grass-energy", 1],
        ["fix-fire-energy", 1],
        ["fix-water-energy", 1],
      ]);
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(90 * heads);
      // The printed "90×" base is dropped here too — a leaked one reads 90 more.
      expect(activeDamage(done, "p2")).not.toBe(90 * heads + 90);
      // 270 into 340 HP survives, so the sweep never ends on a promotion.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("counts a WILDCARD Special as exactly ONE card — the reading that makes `null` nullable", () => {
    // A Luminous Energy alone pays the {G} (it provides every type) AND is exactly one
    // attached card, so the attack flips ONCE. That is the untyped reading in its
    // sharpest form: a card that answers every TYPE question still answers the CARD
    // question with one, and a build that implemented `null` as "the filter that
    // matches everything" would agree here by luck — which is why the disagreement is
    // pinned at the unit level below, where the two readings give different numbers.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = bellossomActive(board(seed), "p1", [["sv02-191", 1]]);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      expect(activeDamage(done, "p2")).toBe(90 * heads);
      if (heads === 1) sawHeads = true;
      else sawTails = true;
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("ZERO COUNT — zero FLIPS, which is not zero HEADS", () => {
  it("takes no flip, spends no rngState step, deals nothing, and STILL ends the turn", () => {
    // THE BRANCH NO PRINTING CAN REACH, and the reason fix-flip-filter exists: a {C}
    // cost paid by a single FIRE Energy, against a {W} filter. The declaration is
    // legal — the cost is met — and the count is 0.
    //
    // CONTRAST WITH D127's ZERO-HEADS OUTCOME, which is the whole point of the case.
    // Tandemaus on two tails SPENDS both flips: two ATTACK_EFFECT_COIN_FLIP rows, two
    // rngState steps, both announced, and only the damage step skipped. This attack
    // announces NOTHING and spends NOTHING — there was never a coin to flip. Both then
    // land on the SAME ending (no DAMAGE_DEALT, no ATTACK_FAILED, the turn still ends
    // through `finishAttack`), which is what makes them one mechanism rather than two.
    //
    // A build that treated a 0 count as "flip once" would emit a row and burn a step
    // here; one that routed it through the cancel branch would emit ATTACK_FAILED and
    // skip the effect ops a future member will have. Both are pinned below.
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = filterActive(board(seed), "p1", [["fix-fire-energy", 1]]);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      // The attack was DECLARED — this is a resolved attack, not a rejected one.
      expect(types(events)).toContain("ATTACK_DECLARED");
      // ZERO ROWS. Not "no heads" — no coin at all.
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
      // NO rngState STEP. Byte-identical to the state before the attack, which is a
      // strictly stronger claim than "no rows": a flip that was taken and not
      // announced would pass the assertion above and fail this one.
      expect(done.rngState).toBe(before);
      expect(done.rngState).toBe(foldFlips(before, 0)[1]);
      expect(done.rngState).not.toBe(foldFlips(before, 1)[1]);
      // NOTHING LANDED.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("COUNTERS_PLACED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(activeDamage(done, "p2")).toBe(0);
      // BUT IT WAS NOT CANCELLED — no ATTACK_FAILED of any reason. This is the
      // assertion that separates a zero count from `cancelOnTails`.
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(find(events, "ATTACK_FAILED")).toBeUndefined();
      // …and the turn ended the ordinary way, through the same `finishAttack` every
      // resolved attack takes.
      expect(types(events)).toContain("TURN_ENDED");
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("flips EXACTLY ONCE the moment a Water joins the same pile", () => {
    // The pair that makes the zero above a claim about the COUNT rather than about a
    // card that simply never flips. Same fixture, same cost, same seed sweep — one
    // more attached card, of the type the filter names, and the attack takes exactly
    // one flip and can deal exactly 50. The Fire is still attached and still counts
    // for nothing.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = filterActive(board(seed), "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 1],
      ]);
      expect(state.players.p1.active?.energy).toHaveLength(2);
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      seen.add(heads);
      // TWO cards attached, ONE flip — the filter is doing the work, not the pile size.
      expect(activeDamage(done, "p2")).toBe(50 * heads);
      expect(activeDamage(done, "p2")).not.toBe(100);
      expect(done.rngState).toBe(foldFlips(before, 1)[1]);
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

describe("the rngState account — exactly `count` steps, no more and no fewer", () => {
  it("recomputes every board's whole flip sequence by hand, in order", () => {
    // THE ASSERTION THAT CATCHES AN OFF-BY-ONE OR A DOUBLE FLIP, and here it does one
    // thing D127's could not: it runs the SAME derived value over three different
    // counts (0, 1, 3), so "the loop is bounded by what the board says" is checked
    // rather than "the loop is bounded by what the string said". Both halves are
    // checked on every board:
    //
    //   • the resulting rngState IS `after.rngState` — so exactly `count` steps were
    //     consumed and nothing else in a plain attack (§8.5, the §8.1 sweep, the §5.3
    //     turn end and its draw) touched the rng;
    //   • the resulting FACES are the emitted rows' results IN ORDER — so the rows are
    //     the flips that actually happened, not a re-read of one draw.
    //
    // Either half alone is weak: a loop that flipped N times but reported the first
    // face N times passes the first, and the zero-count row would pass BOTH trivially
    // if `count + 1` were not also named as a state the engine did not reach.
    const boards: [
      label: string,
      build: (state: GameState) => GameState,
      count: number,
      index: number,
    ][] = [
      [
        "Torkoal, 1 Fire + 2 Water → the {R} count is 1",
        (s) =>
          torkoalActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 2],
          ]),
        1,
        FLIP_INDEX,
      ],
      ["Torkoal, 3 Fire", (s) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), 3, FLIP_INDEX],
      [
        "Bellossom, 3 mixed cards",
        (s) =>
          bellossomActive(s, "p1", [
            ["fix-grass-energy", 1],
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        3,
        FLIP_INDEX,
      ],
      [
        "fix-flip-filter, 1 Fire against a {W} filter → ZERO",
        (s) => filterActive(s, "p1", [["fix-fire-energy", 1]]),
        0,
        FILTER_INDEX,
      ],
    ];
    for (const [label, build, count, index] of boards) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = build(board(seed));
        const [faces, expected] = foldFlips(state.rngState, count);
        const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index });
        expect(after.rngState, label).toBe(expected);
        expect(
          all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result),
          label,
        ).toEqual(faces);
        // One MORE step would have landed here — named explicitly, so the assertion
        // above is a claim about the COUNT and not just about a number. (The zero row
        // has no "one fewer", which is why that side is guarded rather than asserted.)
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, count + 1)[1]);
        if (count > 0) {
          expect(after.rngState, label).not.toBe(foldFlips(state.rngState, count - 1)[1]);
        }
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the flip rows are the ONLY ones", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is the
    // older. An UNCONFUSED attacker must never emit its event and never consume its
    // step, so the rows in the list are the attack's own — including on the board where
    // there are none.
    for (const [build, count, index] of [
      [(s: GameState) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), 3, FLIP_INDEX],
      [(s: GameState) => filterActive(s, "p1", [["fix-fire-energy", 1]]), 0, FILTER_INDEX],
    ] as const) {
      const state = build(board(5));
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(count);
    }
  });
});

describe("modifierSimulated — no loud row on ANY outcome, on ANY count, including ZERO", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on all three cards", () => {
    // D126's trap, recurring for the third time. All three printings carry a "D×"
    // marker, so `parseAttackDamage` hands attack.ts a modifier "×" — and the coin
    // reader is what consumes it. A build that only widened `effectSimulated` resolves
    // every number in this file PERFECTLY and still flags all three loudly.
    //
    // THE ZERO-COUNT BOARD IS THE ONE THIS CASE EXISTS FOR. `modifierSimulated` is
    // computed from the DERIVED VALUE, not from what the flips did, so a build that
    // tied it to a non-empty flip sequence (or to a non-zero bonus) would pass every
    // other row here and fail on the board where nothing was flipped — which is
    // exactly the board a suite without a constructed fixture could not reach.
    const seenTorkoal = new Set<number>();
    const seenBellossom = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const torkoal = mustApply(torkoalActive(board(seed), "p1", [["fix-fire-energy", 3]]), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const bellossom = mustApply(
        bellossomActive(board(seed), "p1", [
          ["fix-grass-energy", 1],
          ["fix-fire-energy", 1],
          ["fix-water-energy", 1],
        ]),
        { type: "attack", seat: "p1", index: FLIP_INDEX },
      );
      const zero = mustApply(filterActive(board(seed), "p1", [["fix-fire-energy", 1]]), {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      expect(types(torkoal.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(bellossom.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(zero.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // …and the zero board really did flip nothing, so the row above is absent on a
      // board that took no coin rather than on one that quietly took some.
      expect(all(zero.events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
      seenTorkoal.add(headsIn(torkoal.events));
      seenBellossom.add(headsIn(bellossom.events));
    }
    // …and the sweep really did cover every outcome of both flipping boards, so "no
    // loud row on ANY outcome" is a statement about all four and not about the ones a
    // seed happened to produce.
    expect([...seenTorkoal].sort()).toEqual([0, 1, 2, 3]);
    expect([...seenBellossom].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("the fold order — the board-counted flips land BEFORE Weakness", () => {
  it("deals (0 + 80) × 2 = 160 into a Fire-weak body, not 320 and not 80", () => {
    // THE ARITHMETIC THAT PINS BOTH HALVES AT ONCE. `coinBonus` is the attack's own
    // printed extra, so it joins `scaled` at the pre-W/R step — and `scaledBase` is 0,
    // so the printed 80 never enters the multiplication. Three numbers that cannot be
    // confused for one another:
    //
    //   160 = (0 + 80) × 2   — correct: base dropped, count folded pre-Weakness
    //   320 = (80 + 80) × 2  — the leaked printed base
    //    80 = 0 × 2 + 80     — the count folded AFTER Weakness (or not doubled)
    //
    // All three sit under fix-pokemon-v-weak's 210 HP, so the case measures damage and
    // never a Knock Out or a promotion in the middle of a sweep. The pile is the
    // central case's — 1 Fire + 2 Water — so the flip count here is 1 and the ONLY
    // variable is the face.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = torkoalActive(opened, "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 2],
      ]);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        // Zero heads doubles to zero, and the `> 0` guard means there is no row at all
        // — the Weakness multiplier never gets a number to multiply.
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
        continue;
      }
      // The multiplier really is live on this board — otherwise "160" below would be a
      // claim about nothing. (Torkoal is Fire; the body is ×2 Fire.)
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(80);
      expect(damage?.dealt).toBe(160);
      expect(damage?.dealt).not.toBe(320);
      expect(damage?.dealt).not.toBe(80);
      expect(activeDamage(done, "p2")).toBe(160);
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

describe("countAttachedEnergy — three readings of one pile, and where they DISAGREE", () => {
  it('counts CARDS for null, PROVISION for a type, and the CARD CLASS for "special"', () => {
    // The unit half of the slice, on ONE Pokémon holding Fire + Water + an UNAUTHORED
    // Special (which falls back to providing Colorless — i.e. nothing typed):
    //
    //   null      → 3   every attached CARD
    //   "Fire"    → 1   provision, and the Special provides no Fire
    //   "Water"   → 1   ditto
    //   "Grass"   → 0   nothing on this pile provides it
    //   "special" → 1   the card CLASS, read off isSpecialEnergy
    //
    // THE DISAGREEMENT IS THE POINT. 3 ≠ 1 + 1 + 0, and the missing card is the
    // Special: it counts for the untyped reading and for no type at all. A build that
    // implemented `null` as "sum the type counts" or as "the filter that matches
    // everything" gets 2 here, and would get Ambipom wrong on any board holding one.
    const state = bellossomActive(board(0), "p1", [
      ["fix-fire-energy", 1],
      ["fix-water-energy", 1],
      ["fix-special", 1],
    ]);
    const mon = state.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(mon.energy).toHaveLength(3);
    expect(countAttachedEnergy(state, mon, null)).toBe(3);
    expect(countAttachedEnergy(state, mon, "Fire")).toBe(1);
    expect(countAttachedEnergy(state, mon, "Water")).toBe(1);
    expect(countAttachedEnergy(state, mon, "Grass")).toBe(0);
    expect(countAttachedEnergy(state, mon, "special")).toBe(1);
    // Stated as the inequality it is, so the case cannot be satisfied by three
    // separately-correct-looking numbers that happen to add up.
    expect(countAttachedEnergy(state, mon, null)).not.toBe(
      countAttachedEnergy(state, mon, "Fire") +
        countAttachedEnergy(state, mon, "Water") +
        countAttachedEnergy(state, mon, "Grass"),
    );
    // An empty pile answers 0 to all three, on the same Pokémon before anything was
    // attached — the trivial reading, pinned because "0" is also what a broken filter
    // returns and the suite should be able to tell the two apart elsewhere.
    const bare = setActiveFromDeck(board(0), "p1", "sv03-003").players.p1.active;
    if (bare === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(state, bare, null)).toBe(0);
    expect(countAttachedEnergy(state, bare, "Fire")).toBe(0);
    expect(countAttachedEnergy(state, bare, "special")).toBe(0);
  });

  it("counts a WILDCARD for EVERY type and still as exactly ONE card", () => {
    // THE REASON THE FIELD IS NULLABLE, stated as an equality and an inequality on one
    // board. A lone Luminous Energy provides every type, so `providesEnergyType` says
    // yes for all nine — it IS a {R} Energy, a {G} Energy and a {M} Energy at once,
    // which is the same answer §8.2's cost check gives. And it is still ONE card, so
    // the untyped reading says 1 rather than 9. Those two numbers are the two
    // questions, and no single filter can answer both.
    const state = bellossomActive(board(0), "p1", [["sv02-191", 1]]);
    const mon = state.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(mon.energy).toHaveLength(1);
    for (const type of BASIC_ENERGY_TYPES) {
      expect(countAttachedEnergy(state, mon, type)).toBe(1);
    }
    expect(countAttachedEnergy(state, mon, null)).toBe(1);
    expect(countAttachedEnergy(state, mon, "special")).toBe(1);

    // …AND PROVISION IS READ ON THE HOST, so the answer moves with the board. Attach a
    // SECOND Special and Luminous is demoted to {C} — it stops being a {R} Energy
    // while remaining, obviously, a card. The untyped count goes 1 → 2 (a card was
    // added) and every TYPE count goes 1 → 0 (the wildcard is gone and the unauthored
    // Special provides nothing typed): the two readings move in OPPOSITE directions on
    // the same edit, which is the sharpest statement this file can make that they are
    // not the same tally.
    const demoted = pile(state, "p1", [["fix-special", 1]]);
    const after = demoted.players.p1.active;
    if (after === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(demoted, after, null)).toBe(2);
    expect(countAttachedEnergy(demoted, after, "special")).toBe(2);
    for (const type of BASIC_ENERGY_TYPES) {
      expect(countAttachedEnergy(demoted, after, type)).toBe(0);
    }
  });

  it("is the number the FLIP COUNT uses — the unit reading and the board reading agree", () => {
    // The two halves of the slice, joined. Whatever `countAttachedEnergy` says about a
    // board is exactly how many ATTACK_EFFECT_COIN_FLIP rows that board produces —
    // asserted rather than assumed, because `flipCount` reads the count at the FLIP
    // SITE off `next` and a build that read it at declaration (or off the wrong
    // Pokémon, or off the defender) would still produce a plausible number here.
    const cases: [
      build: (s: GameState) => GameState,
      energy: "Fire" | "Water" | null,
      pileSize: number,
      expected: number,
      index: number,
    ][] = [
      // The three central boards: the filtered count BELOW the pile size, the filtered
      // count EQUAL to it, and the unfiltered count that IS it.
      [
        (s) =>
          torkoalActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 2],
          ]),
        "Fire",
        3,
        1,
        FLIP_INDEX,
      ],
      [(s) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), "Fire", 3, 3, FLIP_INDEX],
      [
        (s) =>
          bellossomActive(s, "p1", [
            ["fix-grass-energy", 1],
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        null,
        3,
        3,
        FLIP_INDEX,
      ],
      // …and the two filter boards, including the ZERO one.
      [(s) => filterActive(s, "p1", [["fix-fire-energy", 1]]), "Water", 1, 0, FILTER_INDEX],
      [
        (s) =>
          filterActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        "Water",
        2,
        1,
        FILTER_INDEX,
      ],
    ];
    let differed = 0;
    for (const [build, energy, pileSize, expected, index] of cases) {
      const state = build(board(3));
      const mon = state.players.p1.active;
      if (mon === null) throw new Error("no Active to count");
      // The pile really is the size the row claims — otherwise "counted ≠ pile" below
      // could be true because the attach silently did nothing.
      expect(mon.energy).toHaveLength(pileSize);
      const counted = countAttachedEnergy(state, mon, energy);
      expect(counted).toBe(expected);
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(counted);
      if (counted !== pileSize) differed += 1;
    }
    // THREE of the five boards have a count that is NOT the pile size (1 of 3, 0 of 1
    // and 1 of 2), which is what keeps this case from being an identity restated
    // twice: on a board where the two coincide, "the flips followed the count" and
    // "the flips followed the pile" are the same sentence, and only the boards where
    // they diverge can tell them apart.
    expect(differed).toBe(3);
  });
});

describe("purity", () => {
  it("resolves every board-counted attack on a DEEP-FROZEN board", () => {
    // The rngState thread and the damage write both go through fresh objects — a
    // frozen state proves nothing was mutated in place, on all three cards, on the
    // Weakness board (which also rewrites the defender) and on the ZERO-count board
    // (which must leave `next` alone entirely). The loop in attack.ts rebinds `next`
    // on every flip, which is exactly the shape a careless in-place
    // `next.rngState = …` would have taken instead.
    for (let seed = 0; seed < SEEDS; seed++) {
      const torkoal = deepFreeze(
        torkoalActive(weakDefender(board(seed), "p2"), "p1", [
          ["fix-fire-energy", 1],
          ["fix-water-energy", 2],
        ]),
      );
      mustApply(torkoal, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const bellossom = deepFreeze(
        bellossomActive(board(seed), "p1", [
          ["fix-grass-energy", 1],
          ["fix-fire-energy", 1],
          ["fix-water-energy", 1],
        ]),
      );
      mustApply(bellossom, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const zero = deepFreeze(filterActive(board(seed), "p1", [["fix-fire-energy", 1]]));
      mustApply(zero, { type: "attack", seat: "p1", index: FILTER_INDEX });
    }
    // …and the COUNTER is a pure read of the board, frozen or not.
    const frozen = deepFreeze(torkoalActive(board(0), "p1", [["fix-fire-energy", 2]]));
    const mon = frozen.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(frozen, mon, "Fire")).toBe(2);
    // …and the DERIVER is a pure function of its string.
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(POWERFUL_DANCE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
  });
});
