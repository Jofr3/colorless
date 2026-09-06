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
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import { MAX_UNTIL_TAILS_FLIPS, flipCoin, flipUntilTails } from "./rng";
import {
  FIXTURE_POOL,
  PER_HEADS_PROGRAM_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

// 0.80.0 → 0.81.0 — the per-heads PROGRAM (D130). "Flip {N} coins|a coin until you
// get tails. For each heads, discard the top {M} cards of your opponent's deck." —
// Wugtrio sv01-057 "Undersea Tunnel" (idx 1, {C}{C}{C}, 3 flips, top 3) and
// Gyarados swsh10.5-022 "Wreak Havoc" (idx 0, {C}, until tails, top 2). Neither
// prints a `damage` field at all.
//
//   THE FIRST COIN CONSEQUENT THAT IS NOT A NUMBER.
//
// D126 built the seam: a printed flip is taken in FRONT of the §8.5 pipeline,
// because a flip that gates or scales damage cannot be an effect PROGRAM (programs
// run at attack.ts's TAIL, strictly after the number is computed). D127, D128 and
// D129 then varied only the flip COUNT — printed, board-read, unbounded — and every
// one of them folded the faces into an ARITHMETIC result. This slice keeps the
// count axis untouched and moves the other one: "For each heads, X" runs an OP per
// heads and folds nothing.
//
// SO THE CARRY IS THE SLICE. The flips are taken at one site and EffectOps run at
// another, and until D130 nothing carried a value between them. The obvious repair
// — thread a heads COUNT through to `runProgram` and teach the interpreter a
// "repeat" op — buys a second way to say "N times" and a new vocabulary member to
// say it with. But "For each heads, X" literally IS X repeated `heads` times, and
// the tail already runs an `EffectOp[]`. So the faces are spent AT THE FLIP SITE
// into a LONGER PROGRAM: `heads` copies of the member's ops, APPENDED to whatever
// program the attack already had (never assigned over it — a registry row must not
// be silently droppable by a coin sentence). `heads === 0` expands to nothing, which
// is why the zero-heads outcome needs no branch and takes the existing no-program
// ending.
//
// TWO PRINTINGS ACROSS TWO FLIP-COUNT SOURCES IS WHAT MAKES IT A SLICE. Wugtrio is
// `{ kind: "printed", count: 3 }` and Gyarados is `{ kind: "untilTails" }`, feeding
// a byte-identical `discardDeckTop` (count 3 against count 2). D128's doc
// block has claimed since it was written that the flip COUNT and the flip
// CONSEQUENT are independent axes; this is the first slice that DEMONSTRATES it
// rather than asserting it, and it reuses `AttackFlipCount` wholesale — that union
// is unchanged by D130.
//
// ONE READER OWNS THE SENTENCE. The ops ride on the coin member rather than being
// produced by `deriveAttackEffect` off the same string, so there is no invariant to
// hold between two derivers reading one printing ("whenever THIS coin member
// appears, THAT deriver must have produced exactly these ops") — the kind of
// invariant nothing can enforce and every future arm can break. The disjointness
// block below asserts all four sibling readers return null for both sentences.
//
// THE OP IS DETERMINISTIC AND NEVER PARKS, AND THAT IS WHY THE EXPANSION IS LEGAL.
// `discardDeckTop` consumes no `rngState` and asks no question, so N copies
// of it is N ordinary steps. The two "For each heads" printings D130 did NOT build
// are exactly the two where that fails: Krookodile sv01-117 discards an Energy (a
// `discardEnergy` that PARKS on a choice — N heads would be N sequential parks
// across a serialized continuation) and Masquerain sv03-007 discards a RANDOM card
// from the hand (the first EffectOp in the engine that would consume `state.rngState`).
// Oinkologne sv03-184 shares the opening and not the shape at all — a heads COUNT
// read as an "up to" ceiling by ONE op. All three stay loud, and are asserted so.
//
// AND MILLING TO ZERO DOES NOT END THE GAME. §14.3 deck-out is a turn-START rule,
// checked at the draw (flow.ts `startTurn`), so a player milled out loses at their
// next draw step and not one instant earlier. The clamp block below is what pins
// that: the loss arrives AFTER TURN_STARTED, with reason "deckOut", and never from
// inside the mill.

/** Wugtrio sv01-057 "Undersea Tunnel", verbatim, and pinned char-for-char against
    FIXTURE_POOL below. Wugtrio carries no authored program (see the ZERO-rows
    block), so the sentence IS the wiring: a drifted character does not throw, it
    drops the card onto the loud ATTACK_EFFECT_SKIPPED path and mills nothing at
    all — a silent no-op, which for a card with no printed damage is the whole
    attack going missing. */
const UNDERSEA_TUNNEL = "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.";

/** Gyarados swsh10.5-022 "Wreak Havoc", verbatim. It was untilTailsFlip.test.ts's
    end-to-end UNMAPPED witness until this slice; that suite's case was re-pointed at
    Krookodile sv01-117 rather than deleted, and the card moved decks with it. */
const WREAK_HAVOC =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

/** The consequent both printings share, char-for-char apart from the count. It is
    what the two regexes anchor on past their (different) leading sentences, and the
    reason the slice is one shape rather than two: the flip COUNT varies, the
    CONSEQUENT does not. */
const FOR_EACH_HEADS_TAIL = "For each heads, discard the top ";

/** Wiglett sv01-056 "Dig a Little", verbatim off the local D1 — THE near-miss, and
    the sharpest one in the slice: the same game action on the same zone, printed by
    Wugtrio's own PRE-EVOLUTION. The anchor refuses it on THREE separate counts (a
    SINGULAR "the top card" with no digits, a bare "Flip a coin." count, and a GATE
    consequent rather than a repeat), which is what makes the refusal an argument
    instead of an accident. */
const DIG_A_LITTLE = "Flip a coin. If heads, discard the top card of your opponent's deck.";

/** 🛑🛑 **D452 — RE-MEASURED OFF `censusAttackCorpus.ts` AND CORRECTED, AND ONE OF
    THE THREE WAS A SENTENCE NO CARD PRINTS.** D130 wrote these as *"verbatim off the
    local D1 (2026-08-01)"* — Krookodile sv01-117, Masquerain sv03-007 and Oinkologne
    sv03-184. Two of the three were verbatim. **The Masquerain entry was not**: it
    carried KROOKODILE'S leading sentence (*"Flip a coin until you get tails."*) glued
    to Masquerain's consequent, a 97-character string the `legal_standard = 1` column
    prints ZERO times. Masquerain's real sentence is 78 characters and opens *"Flip 3
    coins."* — it is corpus line 216, and **D452 BUILDS IT**, so it leaves this set
    through the front door rather than being quietly corrected in place.

    ⚠️ **THE BYTE PIN WAS GREEN AND FALSE FOR THE WHOLE OF THAT TIME** (`.length` 97,
    which the invented string really is). This file's own doc blocks name NBSP and
    U+2019 as escapes precisely because *"a hand-retyped near-miss is the only way one
    can enter the codebase"*; the near-miss that entered was a hand-retyped OPENING,
    which no byte pin on the whole string can catch. **The repair is the source, not
    the pin**: every entry below is now a `legalAttackCorpus()` row, cited by its
    corpus LINE (which is a file line in `censusAttackCorpus.ts`, D448's convention),
    and §1 asserts each one is really in that corpus rather than merely plausible.

    **THE FOUR THAT STAY LOUD AFTER D452, each refused on its own count:**
      · line **200** — *"Flip 2 coins. For each heads, discard an Energy from your
        opponent's Active Pokémon."* (1 printing). `discardEnergy` PARKS on a genuine
        choice, so N heads is N sequential `effect:choose` phases.
      · line **217** — *"Flip 3 coins. For each tails, discard an Energy from this
        Pokémon."* (1). The same park PLUS a FACE axis this union does not have:
        `programPerHeads` counts heads in its name and in its expansion.
      · line **219** — *"Flip 3 coins. Put a number of cards up to the number of heads
        from your discard pile into your hand."* (2). Shares WUGTRIO'S OPENING verbatim
        and nothing else — a heads COUNT read as an "up to" ceiling by ONE op, not a
        repeat. Refused by the consequent rather than by the count.
      · line **234** — *"Flip a coin until you get tails. For each heads, discard an
        Energy from your opponent's Active Pokémon."* (1). Line 200's consequent over
        D129's flip count; Krookodile sv01-117, and this suite's FIELDED end-to-end
        loud witness.

    ⚠️ **AND D130's STATED REASON FOR THE TWO `discardEnergy` ROWS IS WRONG WHERE IT IS
    ABSOLUTE.** It says a park is *"the one thing D130's expansion cannot express"*.
    `resumeProgram` ends in `runProgram(applied, rest, …)`, so an op in `rest` that
    parks parks again, and the expansion puts its copies in `rest` like any other
    program. The refusal is a COST — a fielded witness re-pointed across five files
    (D418's rule), and an N-park end-to-end drive — not a capability. Corrected and
    dated here (D423), and priced in the D452 block in effects.ts.
    🆕🆕 **D463 PAID EXACTLY THAT PRICE** — two anchors, two arms, the fielded witness
    re-pointed, and `perHeadsEnergyDiscard.test.ts` driving the N parks on a board.

    🆕🆕 **D463 — THE SET IS NOW TWO, AND THE TWO THAT LEFT ARE THE TWO THIS BLOCK
    NAMED AS ONE REFUSAL.** Lines 200 and 234 were refused above on ONE shared count
    (*"`discardEnergy` PARKS"*) and D463 built both. 🛑 **A REFUSAL THAT GROUPS N ROWS UNDER
    ONE REASON IS N REFUSALS UNTIL EACH HAS BEEN PRICED**: the shared reason was a COST, which
    the paragraph below already said in prose while this array still asserted it as a fact.
    What is left is refused on two DIFFERENT counts and neither is about parking — line 217 by
    a FACE axis, line 219 by its consequent.

    🆕🆕 **D476 — THE SET IS NOW ONE, AND THE FACE AXIS IS BUILT.** Line 217 leaves through
    `AttackCoinFlip.programPerHeads.face`; what is left is line 219 alone, refused by its
    CONSEQUENT (a heads count read as an "up to" ceiling by one op, not a repeat) and by
    nothing else. ⚠️ **THE BYTE PINS ON THE ROW THAT LEFT ARE KEPT, NOT DELETED** — D463's
    rule read the other way round: they were never evidence the sentence was refused, they are
    evidence it is the sentence the CORPUS prints. */
const OUT_OF_SCOPE = [
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.",
] as const;

/** 🆕🆕 **D476 — THE ROW THIS FILE REFUSED FOR TWENTY-FOUR DECISIONS AND NOW DERIVES**,
    corpus file line 217 verbatim. A NAMED SET of one rather than a deletion, for the reason
    `BUILT_AT_D463` is one: every rung below that used to say "this stays loud" now says the
    opposite about it, and a deleted array says nothing at all (D418). */
const BUILT_AT_D476 = ["Flip 3 coins. For each tails, discard an Energy from this Pokémon."] as const;

/** 🆕🆕 **D463 — THE TWO ROWS THIS FILE REFUSED AND NOW DERIVES**, verbatim off
    `censusAttackCorpus.ts` file lines 200 and 234, in that order. Kept as a NAMED SET rather
    than deleted, for the reason a witness is re-pointed rather than removed: every rung below
    that used to say "these stay loud" now says the opposite about these two, and a deleted
    array says nothing at all. Line 234 is Krookodile sv01-117 "Chomp Chomp Bite". */
const BUILT_AT_D463 = [
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss cases
    below name it instead of carrying it — the mistake this guards against is exactly
    the mistake a literal would make in this file. */
const NBSP = "\u00a0";

/** U+2019, the CURLY apostrophe, likewise spelled as an escape. Both of this
    slice's sentences contain an ASCII `'` (in "your opponent's deck") and the pool
    holds ZERO U+2019 anywhere, so a hand-retyped near-miss is the only way one can
    enter the codebase — which is exactly when naming it is worth the line. */
const RSQUO = "\u2019";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no platform
    global is in scope and `tsc -b` — which CI runs — would reject it. Copied rather
    than shared with the four sibling coin suites, where it is local for the same
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

/** Wugtrio prints a flat "Headbutt" ({W}, 30) FIRST, which puts Undersea Tunnel at
    index 1 and gives this suite its control for "the coin reader is keyed to the
    TEXT of the attack declared, not to the card carrying it". Gyarados prints Wreak
    Havoc first. Named rather than inlined, so a reprint that added or reordered an
    attack fails on the fixture guards below rather than silently moving every board
    case onto the wrong sentence. */
const TUNNEL_INDEX = 1;
const HEADBUTT_INDEX = 0;
const HAVOC_INDEX = 0;

/** The two mill counts, named because every delta assertion in the file is stated in
    terms of them and a hardcoded 3 would be indistinguishable from a hardcoded 2 on
    a one-heads outcome. */
const TUNNEL_MILL = 3;
const HAVOC_MILL = 2;

/** How far the seed sweeps run, MEASURED on THIS deck and not inherited from a
    sibling. Sweeping seeds 0..199, the first seed reaching each heads count is:

      Wugtrio (3 printed flips)      Gyarados (until tails)
        0 heads → seed 10              0 heads → seed 0     4 heads → seed 53
        1 head  → seed 0               1 head  → seed 6     5 heads → seed 2
        2 heads → seed 1               2 heads → seed 30    7 heads → seed 142
        3 heads → seed 2               3 heads → seed 3     8 heads → seed 120

    WUGTRIO'S ZERO-HEADS OUTCOME IS WHAT SETS IT. Three flips all landing tails is
    the rarest outcome either card has inside a short sweep (1 in 8 by weight, and
    first actually reached at seed 10), and it is the outcome every "nothing
    happened" assertion in the file rests on — no DECK_TOP_DISCARDED rows, the deck
    and the discard pile untouched, and no ATTACK_EFFECT_SKIPPED. So SEEDS is set
    just above it, at 12, which is the smallest sweep that reaches:

      Wugtrio  {0, 1, 2, 3} — the FULL outcome space of a 3-flip printing
      Gyarados {0, 1, 3, 5} — 0 and several counts ≥ 2, from a geometric tail

    Gyarados's set is deliberately NOT asserted exactly: its count is unbounded, so
    an exact-set claim would be a statement about the seeds rather than about the
    shape, and would have to be rewritten every time the deck's shuffle moved. The
    outcome-coverage block below asserts the SUPERSET facts the cases need — 0 seen,
    and at least one ≥ 2 seen, for each card — and nothing more.

    The sibling coin suites run 24 and 32; neither number was copied, and neither is
    needed here. What this slice's cases turn on is the ZERO outcome and the "more
    than one op ran" outcome, and 12 seeds reach both on both cards. */
const SEEDS = 12;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first unrestricted
    turn, so the attack step is legal (§4).

    Both Active spots are pinned to fix-titan (340 HP, no Weakness, no Resistance, NO
    ATTACKS) by SURGERY. Neither printing in this slice deals any damage at all, so
    the defender is not chosen against an arithmetic worst case the way D129's was —
    it is chosen so that NOTHING ELSE HAPPENS: no Knock Out can park a swept seed on
    a promotion and truncate the row sequence, and no defender attack can interleave
    rows with the ones being counted. The board under test here is not the Pokémon,
    it is P2's DECK. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PER_HEADS_PROGRAM_DECK, p2: PER_HEADS_PROGRAM_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Wugtrio in the seat's Active Spot with Undersea Tunnel's {C}{C}{C} paid.
    SURGERY: both attackers are Stage 1 and could never be dealt as an opening
    Active, so every case fields its own. */
function wugtrioActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-057"), seat, "fix-energy", 3);
}

/** Wugtrio with ONE {W} paid instead — enough for "Headbutt" ({W}, 30) at index 0
    and NOT enough for Undersea Tunnel, which is the point: the control is declared
    off the same card and the same board, and its cost cannot be confused for the
    coin attack's. */
function headbuttActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-057"), seat, "fix-water-energy", 1);
}

/** Gyarados in the seat's Active Spot with Wreak Havoc's single {C} paid. */
function gyaradosActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "swsh10.5-022"), seat, "fix-energy", 1);
}

/** Take `count` flips from `state` by hand, returning the faces IN ORDER and the
    rngState they leave behind — the sibling suites' helper, re-declared locally as
    each of them does. It is the account for Wugtrio's PRINTED count and the
    one-step-either-side probe for Gyarados's unbounded one. */
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

/** The heads count off the emitted rows — the number every mill assertion below is
    stated against. Counting it from the EVENTS rather than from a recomputed rng is
    deliberate: it makes each case a claim about what the engine REPORTED doing, and
    the rngState block is what separately proves the report is honest. */
function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** The faces off the emitted rows, IN ORDER. */
function facesIn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

/** Every uid the mill moved, in the order the rows named them — the expansion runs
    one op per heads and each op emits its OWN row, so this flattens N rows rather
    than reading one. That shape is asserted separately; this is what the "came off
    the top, in order" claim is stated against. */
function milledUids(events: GameEvent[]): string[] {
  return all(events, "DECK_TOP_DISCARDED").flatMap((e) => e.uids);
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Wugtrio sv01-057", () => {
    const attack = FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX];
    expect(attack?.effect).toBe(UNDERSEA_TUNNEL);
    expect(attack?.name).toBe("Undersea Tunnel");
    // NO PRINTED DAMAGE AT ALL — asserted, because it is what makes `scaledBase`'s
    // "this member KEEPS the base" branch unobservable on any board and therefore
    // something the code has to get right from the rule rather than from a test.
    expect(attack?.damage).toBeUndefined();
    expect(attack?.cost).toEqual(["Colorless", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason TUNNEL_INDEX is 1 on this card: a
    // bare number with no effect and no modifier, on the same card and the same
    // board as the coin attack.
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.name).toBe("Headbutt");
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.damage).toBe(30);
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-057"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-057"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Gyarados swsh10.5-022", () => {
    const attack = FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX];
    expect(attack?.effect).toBe(WREAK_HAVOC);
    expect(attack?.name).toBe("Wreak Havoc");
    expect(attack?.damage).toBeUndefined();
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["swsh10.5-022"]?.abilities).toBeNull();
    // ITS OTHER ATTACK IS THE OP AIMED THE OTHER WAY: "Wild Splash" discards the
    // top 5 of YOUR OWN deck. D130 kept it deliberately unmapped — the sentence
    // `discardOpponentDeckTop` refused to grow a `whose:` field for until a second
    // reading was in hand (D104's minimal shape) — and D131 mapped it, widening
    // that op to `discardDeckTop { whose }`. So the assertion FLIPPED rather than
    // being deleted: the coin reader must still refuse it (a bare sentence is not a
    // flip sentence, which is the reader boundary this case exists to pin), while
    // the op reader now claims it. Having both directions printed on ONE card is
    // what made the widening's proof case free.
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[1]?.name).toBe("Wild Splash");
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[1]?.effect).toBe(
      "Discard the top 5 cards of your deck.",
    );
    expect(deriveAttackCoinFlip("Discard the top 5 cards of your deck.")).toBeNull();
    expect(deriveAttackEffect("Discard the top 5 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 5 },
    ]);
  });

  it("keeps the card facts the boards are built on", () => {
    expect(FIXTURE_POOL["sv01-057"]?.name).toBe("Wugtrio");
    expect(FIXTURE_POOL["sv01-057"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv01-057"]?.evolveFrom).toBe("Wiglett");
    expect(FIXTURE_POOL["sv01-057"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["sv01-057"]?.hp).toBe(90);

    expect(FIXTURE_POOL["swsh10.5-022"]?.name).toBe("Gyarados");
    expect(FIXTURE_POOL["swsh10.5-022"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["swsh10.5-022"]?.evolveFrom).toBe("Magikarp");
    expect(FIXTURE_POOL["swsh10.5-022"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["swsh10.5-022"]?.hp).toBe(170);

    // THE NEUTRAL DEFENDER DOES NOTHING AND SURVIVES EVERYTHING, which is what this
    // slice needs from it: neither attack deals damage, so what matters is that
    // fix-titan cannot attack back, cannot be Knocked Out, and cannot modify a
    // number — its whole job is to hold the Active Spot while P2's DECK is measured.
    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
  });

  it("pins the BYTES — pure ASCII, an ASCII apostrophe, and ZERO U+2019", () => {
    // Both sentences name a ZONE ("your opponent's deck") and no Pokémon, so there is
    // no "Pokémon" é in either and bytes and code points are EQUAL. The apostrophe is
    // the load-bearing character: it sits inside the shared consequent, so a curly
    // one would break BOTH regexes at once and drop both cards onto the loud path
    // with no visible damage change (neither prints a number).
    expect(UNDERSEA_TUNNEL.length).toBe(78);
    expect(utf8Bytes(UNDERSEA_TUNNEL)).toBe(78);
    expect(WREAK_HAVOC.length).toBe(97);
    expect(utf8Bytes(WREAK_HAVOC)).toBe(97);
    for (const sentence of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      // PURE ASCII, asserted over the characters rather than inferred from the equal
      // totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain(NBSP); // the invisible drift
      expect(sentence).not.toContain("×"); // lives in `damage`, and neither card has one
      // THE APOSTROPHE IS ASCII U+0027 AND THERE IS EXACTLY ONE OF IT.
      expect(sentence).toContain("your opponent's deck");
      expect(sentence).not.toContain(RSQUO);
      expect([...sentence].filter((ch) => ch === "'")).toHaveLength(1);
      expect([...sentence].filter((ch) => ch === RSQUO)).toHaveLength(0);
      expect(RSQUO.codePointAt(0)).toBe(0x2019);
      // The shared CONSEQUENT, char-for-char — what the two regexes anchor on past
      // their different leading sentences.
      expect(sentence).toContain(FOR_EACH_HEADS_TAIL);
      expect(sentence.endsWith(" cards of your opponent's deck.")).toBe(true);
      // …and NEITHER says "This attack does", which is what keeps them off all five
      // of the folding arms.
      expect(sentence).not.toContain("This attack does");
      expect(sentence).not.toContain("damage");
      // No trailing or leading whitespace on the printed row.
      expect(sentence).toBe(sentence.trim());
    }
    // The two differ ONLY in the leading sentence and the count — stated as a
    // rewrite, so "one consequent, two flip counts" is an assertion and not a claim
    // in a comment.
    expect(UNDERSEA_TUNNEL.startsWith("Flip 3 coins. ")).toBe(true);
    expect(WREAK_HAVOC.startsWith("Flip a coin until you get tails. ")).toBe(true);
    expect(UNDERSEA_TUNNEL.slice(UNDERSEA_TUNNEL.indexOf(FOR_EACH_HEADS_TAIL))).toBe(
      WREAK_HAVOC.slice(WREAK_HAVOC.indexOf(FOR_EACH_HEADS_TAIL)).replace("top 2", "top 3"),
    );
  });

  it("pins Wiglett sv01-056's near-miss sentence too — the pre-evolution one card away", () => {
    // ⚠️ D452 — this sentence is NOT in `legalAttackCorpus()`: Wiglett sv01-056 has
    // rotated out of Standard, like both cards this file fields. It is kept as a
    // hand-transcribed near-miss for the reason the block below gives, and the fact
    // that it is off-column is stated rather than left to be assumed.
    expect(legalAttackCorpus().some(([, sentence]) => sentence === DIG_A_LITTLE)).toBe(false);
    // Not fielded (it is not in this deck) but pinned, because the refusal case below
    // is a claim about THIS string and a hand-typed near-miss nobody pinned is a
    // near-miss that can drift into agreement with the pattern.
    expect(DIG_A_LITTLE.length).toBe(68);
    expect(utf8Bytes(DIG_A_LITTLE)).toBe(68);
    expect(DIG_A_LITTLE).not.toContain(RSQUO);
    // THE COUNTS IT IS REFUSED ON, each stated as a property of the string.
    //   1. 🛑 SINGULAR — "the top card", no digits at all. **THIS COUNT IS SPENT AS
    //      OF D452**, which builds the singular mill: the property below is still
    //      true of the string and no longer refuses anything, so it is kept as a
    //      BYTE fact and the refusal now rests on 2 and 3 alone. Keeping it and
    //      saying so is D418's rule — a re-pointed rung must name what the old claim
    //      caught that the new one cannot, and what this one caught is now caught by
    //      the "Flip a coin." anchor instead.
    expect(DIG_A_LITTLE).toContain("the top card of your opponent's deck");
    expect(DIG_A_LITTLE).not.toContain("cards");
    //   2. a BARE one-flip count, which is D126's sentence and not either of ours;
    expect(DIG_A_LITTLE.startsWith("Flip a coin. ")).toBe(true);
    expect(DIG_A_LITTLE.startsWith("Flip a coin until")).toBe(false);
    //   3. a GATE consequent ("If heads, …" — one flip, one conditional run) rather
    //      than a REPEAT ("For each heads, …" — N flips, N runs).
    expect(DIG_A_LITTLE).toContain("If heads,");
    expect(DIG_A_LITTLE).not.toContain(FOR_EACH_HEADS_TAIL);
    // …and it really is the same card LINE, which is what makes it the sharpest
    // near-miss available rather than a constructed one.
    expect(FIXTURE_POOL["sv01-057"]?.evolveFrom).toBe("Wiglett");
  });

  it("pins the TWO out-of-scope printings and the TWO D463 built — each in the CORPUS", () => {
    // 🛑 THE SOURCE RUNG, AND IT IS THE ONE D130 DID NOT HAVE. Every entry is a
    // row of `legalAttackCorpus()` — the `legal_standard = 1` column — so a
    // hand-retyped opening cannot survive here the way the old Masquerain entry did
    // for 322 decisions. A byte pin on an invented string is green by construction;
    // membership in the measured corpus is not.
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    for (const sentence of [...OUT_OF_SCOPE, ...BUILT_AT_D476, ...BUILT_AT_D463]) {
      expect(sentence).toBe(sentence.trim());
      expect(sentence).not.toContain(RSQUO);
      expect(corpus.has(sentence), `not a corpus sentence: ${sentence}`).toBe(true);
      // NONE of them mills a deck, which is the word the two D130 regexes turn on
      // past "For each heads,", and none of them takes a random card from a hand,
      // which is the phrase D452's second arm turns on.
      expect(sentence).not.toContain("cards of your opponent's deck");
      expect(sentence).not.toContain("card of your opponent's deck");
      expect(sentence).not.toContain("random card from your opponent's hand");
    }
    // The printing counts, off the corpus rather than off this file: three singletons
    // and one pair. A set that drifted onto a different sentence would move these.
    expect(OUT_OF_SCOPE.map((sentence) => corpus.get(sentence))).toEqual([2]);
    expect(BUILT_AT_D476.map((sentence) => corpus.get(sentence))).toEqual([1]);
    expect(BUILT_AT_D463.map((sentence) => corpus.get(sentence))).toEqual([1, 1]);

    // 🆕🆕 BUILT_AT_D476[0] — line 217, the FACE axis, BUILT. The ONLY corpus sentence in this
    // whole family that counts TAILS, which is why the axis has exactly one printing — a fact
    // about the column that is still true after the build and is asserted here for that reason.
    expect(BUILT_AT_D476[0].length).toBe(66);
    expect(utf8Bytes(BUILT_AT_D476[0])).toBe(67);
    expect(BUILT_AT_D476[0]).toContain("For each tails,");
    expect(
      [...OUT_OF_SCOPE, ...BUILT_AT_D476, ...BUILT_AT_D463].filter((s) =>
        s.includes("For each tails,"),
      ),
    ).toHaveLength(1);
    // OUT_OF_SCOPE[0] — Oinkologne, line 219: shares WUGTRIO'S OPENING verbatim — "Flip 3
    // coins." — and nothing else. A heads COUNT read as an "up to" ceiling by one op, not a
    // repeat, which is why it is refused by the consequent rather than by the count.
    expect(OUT_OF_SCOPE[0].startsWith("Flip 3 coins. ")).toBe(true);
    expect(UNDERSEA_TUNNEL.startsWith("Flip 3 coins. ")).toBe(true);
    expect(OUT_OF_SCOPE[0]).not.toContain("For each heads");
    expect(OUT_OF_SCOPE[0].length).toBe(100);
    // 🆕🆕 D463 — BUILT_AT_D463[0], line 200: the PRINTED-count `discardEnergy`. It names a
    // Pokémon, so its bytes exceed its length by one (the é). The byte pins are KEPT after the
    // build, for D452's reason read the other way round: they were never evidence the sentence
    // was refused, they are evidence it is the sentence the CORPUS prints.
    expect(BUILT_AT_D463[0].length).toBe(84);
    expect(utf8Bytes(BUILT_AT_D463[0])).toBe(85);
    expect(BUILT_AT_D463[0].startsWith("Flip 2 coins. For each heads, ")).toBe(true);
    // 🆕🆕 D463 — BUILT_AT_D463[1], line 234: Krookodile. D129's leading sentence over the SAME
    // consequent as [0], which is the count axis a third time and now with BOTH halves built.
    expect(BUILT_AT_D463[1].length).toBe(103);
    expect(utf8Bytes(BUILT_AT_D463[1])).toBe(104);
    expect(BUILT_AT_D463[1]).toContain(FOR_EACH_HEADS_TAIL.slice(0, "For each heads, ".length));
    expect(BUILT_AT_D463[1].endsWith(BUILT_AT_D463[0].slice("Flip 2 coins. ".length))).toBe(true);
  });
});

describe("deriveAttackCoinFlip — ONE consequent, TWO flip counts, ZERO table rows", () => {
  it("reads Wugtrio to programPerHeads over a PRINTED count of 3", () => {
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    // THE MEMBER IS THE POINT, not just the payload: a `perHeads` reading would fold
    // a number this sentence does not print, and a `bonusOnHeads` one would add it to
    // a base that does not exist either. Stated as a tag assertion so a build that
    // produced the right ops under the wrong constructor fails here.
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind).toBe("programPerHeads");
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).not.toHaveProperty("per");
    // The two 3s in the sentence are DIFFERENT NUMBERS that happen to coincide — the
    // flip count and the mill count — which is exactly the confusion a single-card
    // slice could ship. Gyarados is what tells them apart, and the case below states
    // it directly.
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toHaveProperty("flips.count", 3);
  });

  it("reads Gyarados to programPerHeads over an UNBOUNDED count — the SAME consequent", () => {
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
    // THE SLICE, IN ONE ASSERTION: same member, same op, DIFFERENT flip count. Count
    // and consequent are independent axes — D128's doc block has claimed it since it
    // was written, and two printings on one op is the first demonstration.
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).toBe(
      deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind,
    );
    const havoc = deriveAttackCoinFlip(WREAK_HAVOC);
    const tunnel = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    if (havoc?.kind !== "programPerHeads" || tunnel?.kind !== "programPerHeads") {
      throw new Error("expected two programPerHeads printings");
    }
    expect(havoc.flips).not.toEqual(tunnel.flips);
    expect(havoc.ops[0]?.op).toBe(tunnel.ops[0]?.op);
    // …and `untilTails` carries NO payload, which is the whole vocabulary cost of
    // that member (D129) and is untouched here: `AttackFlipCount` is REUSED, not
    // widened.
    expect(Object.keys(havoc.flips)).toEqual(["kind"]);
    expect(Object.keys(tunnel.flips).sort()).toEqual(["count", "kind"]);
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX]?.effect ?? ""),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX]?.effect ?? ""),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });

  it("reads counts no card prints — the shape is PARAMETERISED, not two rows", () => {
    // The pool prints (3 flips, mill 3) and (until tails, mill 2). Sweeping both holes
    // across both arms is what says the numbers are CAPTURED rather than enumerated:
    // a reader built on the two literal sentences would pass every case above and
    // fail every row here.
    for (const flips of [2, 3, 4, 5, 10]) {
      for (const mill of [1, 2, 3, 7, 30]) {
        expect(
          deriveAttackCoinFlip(
            `Flip ${flips} coins. For each heads, discard the top ${mill} cards of your opponent's deck.`,
          ),
        ).toEqual({
          kind: "programPerHeads",
          flips: { kind: "printed", count: flips },
          ops: [{ op: "discardDeckTop", whose: "opponent", count: mill }],
          face: "heads",
        });
      }
    }
    for (const mill of [1, 2, 3, 7, 30]) {
      expect(
        deriveAttackCoinFlip(
          `Flip a coin until you get tails. For each heads, discard the top ${mill} cards of your opponent's deck.`,
        ),
      ).toEqual({
        kind: "programPerHeads",
        flips: { kind: "untilTails" },
        ops: [{ op: "discardDeckTop", whose: "opponent", count: mill }],
        face: "heads",
      });
    }
    // THE TWO NUMBERS ARE READ INDEPENDENTLY, stated on the one sentence where they
    // differ most: 2 flips milling 9 is not 9 flips milling 2.
    const swapped = deriveAttackCoinFlip(
      "Flip 2 coins. For each heads, discard the top 9 cards of your opponent's deck.",
    );
    expect(swapped).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 9 }],
      face: "heads",
    });
    expect(swapped).not.toEqual(
      deriveAttackCoinFlip(
        "Flip 9 coins. For each heads, discard the top 2 cards of your opponent's deck.",
      ),
    );
  });

  it("leaves all five D126–D129 readings EXACTLY as they were", () => {
    // A widened union is the classic place to break a sibling, and this slice's two
    // arms run AFTER all five of theirs — so the risk runs the other way too: a
    // sentence of theirs that fell THROUGH to here would silently change member.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual(
      { kind: "bonusOnHeads", flips: { kind: "printed", count: 1 }, per: 10 },
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
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
      ),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
    // …and each of this slice's two sentences shares its OPENING with one of them
    // (Wugtrio with D127's, Gyarados with D129's) and still lands on a different
    // member, which is the disjointness claim stated from the sharpest angle.
    expect(
      deriveAttackCoinFlip("Flip 3 coins. This attack does 30 damage for each heads.")?.kind,
    ).toBe("perHeads");
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind).toBe("programPerHeads");
  });
});

describe("deriver DISJOINTNESS — one reader owns each sentence", () => {
  it("returns NULL from all four sibling readers for both printings", () => {
    // THE DOUBLE-READ CHECK, done EMPIRICALLY rather than by reading the regexes. It
    // matters more for this member than for any before it, because this is the first
    // coin member that produces OPS — the exact thing `deriveAttackEffect` produces.
    // A sentence read by both would run its mill twice: once expanded at the flip
    // site, once as the attack's own program at the tail.
    for (const sentence of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(deriveAttackCoinFlip(sentence)).not.toBeNull();
    }
    // The mirror, one live representative per family, so the nulls above are refusals
    // in both directions and not one reader being dead.
    const representatives = [
      "Your opponent's Active Pokémon is now Paralyzed.",
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      "This attack does 50 damage for each Prize card your opponent has taken.",
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) expect(deriveAttackCoinFlip(sentence)).toBeNull();
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });

  it("keeps parseAttackDamage out of it — neither card prints a number to split", () => {
    // The hand-off that ISN'T. Every previous coin slice had to state which side of
    // `scaledBase` its printings landed on; these two have no `damage` field at all,
    // so `parseAttackDamage` produces nothing and `modifierSimulated` has nothing to
    // claim. That is not an accident of the pool — it is why this member must NOT
    // claim a modifier (attack.ts), and why the branch is written from the rule.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX]?.damage)).toEqual({
      base: 0,
      modifier: null,
    });
    expect(parseAttackDamage(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX]?.damage)).toEqual(
      { base: 0, modifier: null },
    );
    // …while the control on the same card DOES split, which is what says the two
    // results above are a fact about the printings and not about a dead parse.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: null,
    });
  });
});

describe("constructed near-misses stay NULL", () => {
  it("refuses Wiglett sv01-056's real sentence — on the TWO counts D452 leaves it", () => {
    // The live near-miss, and the only one in this file taken verbatim off a printed
    // card. D130 refused it on THREE counts — a SINGULAR "the top card", a bare
    // "Flip a coin." count, and a GATE consequent ("If heads,") rather than a repeat.
    // 🆕🆕 D452 BUILT THE SINGULAR, so that count is spent: the sentence
    // "Flip 2 coins. For each heads, discard the top card of your opponent's deck."
    // now derives (corpus line 201, 1 legal printing). TWO counts remain and each is
    // still sufficient on its own — which is what the rungs below take apart, one
    // token at a time.
    //
    // ⚠️ THE REFUSAL IS NARROWER, NOT WEAKER (D450's rule). The claim it makes is
    // unchanged in kind: a GATE is one flip and one conditional run, a REPEAT is N
    // flips and N runs, and nothing in this family may confuse the two.
    expect(deriveAttackCoinFlip(DIG_A_LITTLE)).toBeNull();
    // …and it is not quietly picked up by anything else either, so it stays on the
    // loud path rather than being half-resolved somewhere.
    expect(deriveAttackDamageBonus(DIG_A_LITTLE)).toBeNull();
    expect(deriveAttackDamageMultiplier(DIG_A_LITTLE)).toBeNull();
    expect(deriveAttackRequirement(DIG_A_LITTLE)).toBeNull();
    // COUNT 1 — THE BARE FLIP COUNT. Give it the repeat consequent and leave the
    // "Flip a coin." opening, and it is still null: D126 owns that opening, and both
    // printed arms of this member require the plural "coins".
    expect(
      deriveAttackCoinFlip("Flip a coin. For each heads, discard the top card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip a coin. For each heads, discard the top 1 cards of your opponent's deck."),
    ).toBeNull();
    // COUNT 2 — THE GATE CONSEQUENT. Give it the plural flip count and leave "If
    // heads,", and it is still null on BOTH mill spellings.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. If heads, discard the top card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 2 coins. If heads, discard the top 1 cards of your opponent's deck."),
    ).toBeNull();
    // 🆕 BOTH REMAINING COUNTS MOVED — and the SINGULAR spelling is now a
    // sentence this deriver reads, at a literal count of 1. This is corpus line 201.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top card of your opponent's deck."),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      face: "heads",
    });
    // 🛑 AND THE TWO SPELLINGS ARE THE SAME VALUE AT COUNT 1, which is the whole
    // argument for two anchors rather than one optional group: they agree where the
    // catalog prints both readings of "one card" and they refuse the crossings the
    // catalog prints neither of (see the four rungs in the D452 block below).
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top 1 cards of your opponent's deck."),
    ).toEqual(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top card of your opponent's deck."),
    );
  });

  it("refuses `Flip 1 coins.` and `Flip 11 coins.` — the two printed-count guards", () => {
    // `flips >= 2` because the regex's own "coins" is PLURAL: the one-flip form is
    // printed "Flip a coin." (D126) and "Flip 1 coins." is neither English nor in the
    // pool. Refusing it — rather than quietly treating it as one flip — keeps the
    // grammar of the sentence and the shape of the value in agreement.
    expect(
      deriveAttackCoinFlip("Flip 1 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 0 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    // `flips <= MAX_PRINTED_FLIPS` (10) is the ingested-text ceiling, and it bites
    // HARDER here than on any sibling: the digits come from third-party text, and an
    // unbounded `\d+` would spin the flip loop AND grow the expanded program one copy
    // per heads. 10 is admitted, 11 is not — the boundary stated from both sides.
    expect(
      deriveAttackCoinFlip("Flip 10 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 10 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(
      deriveAttackCoinFlip("Flip 11 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 9999 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    // THE CEILING IS OWED TO THE PRINTED COUNT ALONE, D128/D129's provenance rule:
    // the untilTails arm has no ceiling and must not grow one, because its bound
    // belongs to the RNG (`MAX_UNTIL_TAILS_FLIPS`) and not to the sentence.
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toHaveProperty("flips.kind", "untilTails");
  });

  it("refuses `discard the top 0 cards` — the mill count's own `>= 1` guard", () => {
    // The guard every arm of this family carries, in this member's currency: a
    // 0-card mill would spend the flips, the rngState steps and N expanded ops to
    // move nothing at all — indistinguishable from a bug, and worse than a loud skip.
    // Refused on BOTH arms, because the deriver has two returns and only one of them
    // is on the printed path.
    expect(
      deriveAttackCoinFlip("Flip 3 coins. For each heads, discard the top 0 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top 0 cards of your opponent's deck.",
      ),
    ).toBeNull();
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip("Flip 3 coins. For each heads, discard the top 1 cards of your opponent's deck."),
    ).toHaveProperty("ops", [{ op: "discardDeckTop", whose: "opponent", count: 1 }]);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toHaveProperty("ops", [{ op: "discardDeckTop", whose: "opponent", count: 1 }]);
  });

  it("is CASE SENSITIVE — there is no /i on either pattern", () => {
    // A capitalised first word is half of what keeps a MID-SENTENCE clause off the
    // derived path and the anchors are the other half. `flip 3 Coins.` is the probe:
    // one letter down at the front and one up in the middle, neither of which any
    // printing carries.
    expect(
      deriveAttackCoinFlip("flip 3 Coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 3 Coins. For each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 3 coins. for each heads, discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 3 coins. For each heads, Discard the top 3 cards of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
      ),
    ).toBeNull();
  });

  it("refuses the anchor, punctuation and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD is not the whole sentence — the `$` sits after it.
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck",
      "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck",
      // "!" for "." — the same one-character difference from the other side.
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck!",
      // A missing period on the FIRST sentence, which is the half the two patterns
      // are told apart by.
      "Flip 3 coins For each heads, discard the top 3 cards of your opponent's deck.",
      // A missing COMMA after "For each heads", invisible at a glance.
      "Flip 3 coins. For each heads discard the top 3 cards of your opponent's deck.",
      // The CONSEQUENT ALONE — the degenerate string a substring matcher would claim,
      // and the sentence the pool's SEVEN unconditional mills (Chi-Yu ex sv02-040,
      // Garganacl sv02-123, Skwovet sv03-178, …) actually print. They are the same op
      // with no coin in front of them and stay unmapped until a slice reads them.
      "For each heads, discard the top 3 cards of your opponent's deck.",
      "Discard the top 2 cards of your opponent's deck.",
      "Discard the top card of your opponent's deck.",
      // The OPENING alone — flips with nothing to spend them on.
      "Flip 3 coins.",
      "Flip a coin until you get tails.",
      // Leading text — ⚠️ **AND THIS ROW DOES NOT PIN `^`, WHICH IS WHAT ITS COMMENT
      // CLAIMED UNTIL D452.** The `f` here is LOWERCASE, so the string is refused by
      // the case-sensitivity of "Flip" and would stay refused with the anchor gone.
      // The real anchor rungs are in the case directly below, and they were added
      // because a D452 mutant that deleted the `^` from `ATTACK_COIN_MILL_PRINTED`
      // SURVIVED against this whole file (D418: after re-pointing a rung, ask what the
      // old claim could catch that the new one cannot — here the claim was never true).
      "Before doing damage, flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip 3 coins.For each heads, discard the top 3 cards of your opponent's deck.",
      // An INTERIOR double space is not trimmable.
      "Flip 3 coins.  For each heads, discard the top 3 cards of your opponent's deck.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip 3 coins.${NBSP}For each heads, discard the top 3 cards of your opponent's deck.`,
      // (The CURLY APOSTROPHE pair used to sit here, refused. It is now ACCEPTED and
      // asserted below — see the block after this loop for why that was the bug.)
      // "coin" for "coins" and "coins" for "coin" — the one-letter swap between the
      // two arms' own leading sentences.
      "Flip 3 coin. For each heads, discard the top 3 cards of your opponent's deck.",
      "Flip a coins until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
      // "until you get HEADS" — a sentence that would never terminate the same way.
      "Flip a coin until you get heads. For each heads, discard the top 2 cards of your opponent's deck.",
      // "For each tails" — the opening is the mapped one verbatim, so this is refused
      // by the consequent, and reading it as heads would score every outcome upside
      // down (a sequence that ends in tails has exactly one).
      "Flip a coin until you get tails. For each tails, discard the top 2 cards of your opponent's deck.",
      // YOUR deck rather than your OPPONENT's — the op's deliberately-absent `whose:`
      // field, and a sentence the pool really prints (Gyarados's own "Wild Splash").
      "Flip 3 coins. For each heads, discard the top 3 cards of your deck.",
      // A SECOND CONSEQUENT riding the same flips — the shape the `$` exists for. No
      // pool printing extends these sentences today, which is precisely why the guard
      // is pinned now: the first one that does must land loudly rather than
      // half-resolve, dropping a rider the engine never saw.
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck, and this attack does 30 damage.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not — on BOTH arms, because
    // the trim happens once and both arms have to benefit from it.
    expect(deriveAttackCoinFlip(`${UNDERSEA_TUNNEL} `)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(`  ${WREAK_HAVOC}\n`)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });

  it("\U0001f6d1 the `^` REALLY pins the front — a CAPITALISED leading clause, on both arms", () => {
    // \U0001f6d1 **THE GAP D452's MUTANT FOUND.** Every "leading text" rung in this file used
    // a LOWERCASE "flip", so all of them were refused by case rather than by the
    // anchor and a build with no `^` passed the file. These four keep the printed
    // capital and vary only the prefix, which is the one axis the anchor owns.
    //
    // The prefixes are real printed openings (a self-discard cost, a pre-damage
    // clause), so each string is a plausible COMPOUND rather than a constructed
    // oddity — and claiming one whole would silently drop its head.
    for (const prefix of ["Discard an Energy from this Pokémon. ", "Before doing damage, ", "Then, "]) {
      expect(
        deriveAttackCoinFlip(`${prefix}Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.`),
        prefix,
      ).toBeNull();
      expect(
        deriveAttackCoinFlip(
          `${prefix}Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.`,
        ),
        prefix,
      ).toBeNull();
    }
    // …and the unprefixed sentences still derive, which is what makes the six nulls a
    // fence rather than a regression.
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).not.toBeNull();
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toBeNull();
  });

  it("ACCEPTS the U+2019 spelling of `opponent's` on both arms — the class, not a near-miss", () => {
    // This pair was pinned as REFUSED until the D135 review, on the reasoning that the
    // pool holds zero U+2019 so only a hand-retype could produce one. True, and beside
    // the point: `effects.ts` states the opposite convention at the top of the regex
    // block — every sibling reading this same noun phrase (DECK_TOP_MILL,
    // FLIP_DECK_TOP_MILL, DEFENDER_NOW…) carries `['’]` explicitly "so a re-ingest
    // changing only punctuation cannot silently un-derive" the sentence. These two
    // regexes were the ones that missed it.
    //
    // The asymmetry is what made it a bug rather than a style slip. A catalog
    // re-ingest normalising to U+2019 would leave the UNCONDITIONAL mills deriving
    // (D131 has the class) while these two dropped to the loud path — a regression
    // that reads as "two cards broke", with the punctuation nowhere in sight. Same
    // noun phrase, same slice, so it is one rule or it is nothing.
    //
    // Asserted as EQUALITY WITH THE STRAIGHT FORM, not merely as non-null: the point
    // is that the apostrophe is not semantic, so the two spellings must produce the
    // same member, not merely both produce one.
    for (const straight of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      const curly = straight.replace("opponent's", `opponent${RSQUO}s`);
      expect(curly).not.toBe(straight); // the rewrite actually fired
      expect(deriveAttackCoinFlip(curly)).toEqual(deriveAttackCoinFlip(straight));
      expect(deriveAttackCoinFlip(curly)).not.toBeNull();
    }
  });

  it("leaves the ONE out-of-scope printing on the loud path, on EVERY reader", () => {
    // 🆕 D452 — and the strong form: not "on the five readers this file imports"
    // but on the WHOLE live surface, taken off the module. A refusal rung that names
    // its own reader list is a rung that goes QUIET when a thirteenth reader claims
    // the sentence (D418), and this is the file where that would be least visible.
    for (const sentence of OUT_OF_SCOPE) {
      expect(resolvedByAnyReader(sentence), `newly resolved: ${sentence}`).toBe(false);
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
    // 🆕🆕 **D476 — THE OTHER HALF OF WHAT THIS LOOP USED TO COVER, INVERTED IN THE SAME
    // RUNG.** Line 217 used to sit in the array above; the null it asserted is replaced by a
    // reading that names the member, the FACE and the op, so a build that read the sentence at
    // all would pass a `not.toBeNull()` and still redden here (D418). The FACE is what makes
    // this stronger than the D463 inversion below: the two anchors that share this opening
    // shape differ in one word of the sentence and one field of the value.
    for (const built of BUILT_AT_D476) {
      expect(resolvedByAnyReader(built), built).toBe(true);
      expect(deriveAttackCoinFlip(built), built).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: 3 },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
      // The FOUR other readers still refuse it, which is the "one reader owns the sentence"
      // claim asserted rather than assumed — and `deriveAttackEffect`'s null is the one that
      // matters, because the string ENDS in `SELF_DISCARD_ONE`'s exact bytes apart from the
      // capital, so a float there would discard once flatly AND once per tails.
      expect(deriveAttackEffect(built), built).toBeNull();
      expect(deriveAttackDamageBonus(built), built).toBeNull();
      expect(deriveAttackDamageMultiplier(built), built).toBeNull();
      expect(deriveAttackRequirement(built), built).toBeNull();
    }
    // 🆕🆕 **D463 — THE SAME RUNG, INVERTED, AND IT IS STRONGER THAN THE ONE IT REPLACES.**
    // It used to say: swap the `discardEnergy` consequent for a mill and the sentence starts
    // deriving, so the null above was about the TAIL and not about the opening. Both halves of
    // that pair now derive on their own, so the claim becomes a DISCRIMINATION rather than an
    // existence proof — one opening over two different consequents must yield two DIFFERENT
    // `ops` and the SAME `flips`, which is what says each anchor reads its whole sentence.
    for (const builtSentence of BUILT_AT_D463) {
      const opening = builtSentence.slice(0, builtSentence.indexOf("For each heads"));
      const asMill = deriveAttackCoinFlip(
        `${opening}For each heads, discard the top 2 cards of your opponent's deck.`,
      );
      const asEnergy = deriveAttackCoinFlip(builtSentence);
      expect(asEnergy, builtSentence).not.toBeNull();
      expect(JSON.stringify(asEnergy)).not.toBe(JSON.stringify(asMill));
      expect(asEnergy).toMatchObject({
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      });
      expect(JSON.stringify((asEnergy as { flips: unknown }).flips)).toBe(
        JSON.stringify((asMill as { flips: unknown } | null)?.flips),
      );
    }
    for (const refused of [BUILT_AT_D463[0], BUILT_AT_D463[1]]) {
      const head = refused.slice(0, refused.indexOf("For each heads"));
      expect(
        deriveAttackCoinFlip(`${head}For each heads, discard the top 2 cards of your opponent's deck.`),
      ).not.toBeNull();
    }
    // The PRINTED-count opening reaches both D452 arms; the UNTIL-TAILS opening
    // reaches neither, because neither of D452's sentences is printed that way and an
    // anchor for one would author a card.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top card of your opponent's deck."),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip("Flip 2 coins. For each heads, discard a random card from your opponent's hand."),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
      ),
    ).toBeNull();
  });
});

describe("ZERO registry rows — both cards mill straight off their printed text", () => {
  it("has no program of any kind for either id", () => {
    for (const id of ["sv01-057", "swsh10.5-022"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
      // Stated per ATTACK INDEX too, because the registry seam is index-keyed (D97):
      // "no row for the card" and "no row for this attack" are different claims, and
      // it is the second one attack.ts actually reads.
      expect(programFor(id)?.attack?.[0]).toBeUndefined();
      expect(programFor(id)?.attack?.[1]).toBeUndefined();
    }
    // …and the near-miss's card has none either, so its refusal is the anchor's doing
    // and not a hand-written row picking it up.
    expect(programFor("sv01-056")).toBeUndefined();
  });
});

describe("Wugtrio — the PRINTED count: 3 flips, one op per heads, 3 cards each", () => {
  it("announces exactly THREE rows and mills 3 × heads off the top, in order", () => {
    // THE CENTRAL CASE OF THE PRINTED ARM, and every number in it is stated against
    // the heads count read off the emitted rows rather than against a recomputed rng
    // — so this is a claim about what the engine REPORTED doing, and the rngState
    // block below is what separately proves the report honest.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = wugtrioActive(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const discardBefore = state.players.p2.discard.length;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      // ALWAYS THREE FLIPS. The printed count does not depend on the faces or on the
      // board, which is the whole difference from Gyarados below.
      expect(facesIn(events)).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");

      // ONE ROW PER HEADS, each naming its OWN op's cards — the expansion is `heads`
      // copies of one op, and each copy emits its own DECK_TOP_DISCARDED. A build
      // that merged them into a single row would pass every count assertion below and
      // fail here, and it would be lying about how many times the op ran.
      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        // THE SEAT IS THE VICTIM, not the actor: the event names the deck's OWNER.
        expect(row.seat).toBe("p2");
        expect(row.uids).toHaveLength(TUNNEL_MILL);
      }

      // THE CARDS CAME OFF THE TOP, IN ORDER — the strongest form of the claim, and
      // the one a count-only assertion cannot make.
      const milled = milledUids(events);
      expect(milled).toHaveLength(TUNNEL_MILL * heads);
      expect(milled).toEqual(deckBefore.slice(0, TUNNEL_MILL * heads));
      // …and they landed in the OPPONENT's discard pile, at its end, in that order.
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...deckBefore.slice(0, TUNNEL_MILL * heads),
      ]);
      expect(done.players.p2.discard.length - discardBefore).toBe(TUNNEL_MILL * heads);

      // THE DECK SHRANK BY THE MILL PLUS EXACTLY ONE, and the one is P2's own
      // turn-start draw: attacking ends the turn (§5.3), so P2's §5.1 draw lands
      // inside this same batch. Naming it rather than hiding it is what keeps the
      // mill delta exact — and the drawn card is the one the mill stopped at, which
      // is a second statement that the mill took from the TOP.
      expect(deckBefore.length - done.players.p2.deck.length).toBe(TUNNEL_MILL * heads + 1);
      expect(done.players.p2.hand).toContain(deckBefore[TUNNEL_MILL * heads]);
      expect(done.players.p2.deck).toEqual(deckBefore.slice(TUNNEL_MILL * heads + 1));

      // The ATTACKER's own deck and discard are untouched — the op is opponent-only,
      // and nothing about it reads or writes this side.
      expect(done.players.p1.discard).toEqual(state.players.p1.discard);

      // No damage anywhere: neither printing has a `damage` field, so the §8.5 gate
      // never opens and `scaledBase`'s "keeps the base" branch has nothing to keep.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(done.players.p2.active?.damage).toBe(0);
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The sweep covered the whole outcome space of a 3-flip printing.
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("orders the rows behind the flips that caused them", () => {
    // THE PRINTED ORDER OF RESOLUTION, asserted: the flips are taken in FRONT of the
    // §8.5 pipeline and the expanded ops run at the TAIL, so every coin row precedes
    // every mill row. A build that ran the op inside the announce loop would produce
    // an interleaved stream and pass every count assertion above.
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const order = types(events);
      if (!order.includes("DECK_TOP_DISCARDED")) continue;
      expect(order.lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        order.indexOf("DECK_TOP_DISCARDED"),
      );
      // …and the whole mill sits inside the attack, before the turn ends.
      expect(order.lastIndexOf("DECK_TOP_DISCARDED")).toBeLessThan(order.indexOf("TURN_ENDED"));
    }
  });

  it("leaves Wugtrio's OTHER attack completely alone — a flat 30, no flips, no mill", () => {
    // The control, on the same card and the same board. "Headbutt" prints a bare
    // number with no effect and no modifier, so it must take NO flip, mill NOTHING,
    // keep its printed base and emit no loud row — which is what says the coin reader
    // is keyed to the TEXT of the attack being declared and not to the card carrying
    // it. (It is paid with a {W} that cannot pay Undersea Tunnel, so the two cannot
    // be confused at the cost check either.)
    const state = headbuttActive(board(0), "p1");
    const before = state.rngState;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEADBUTT_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(before);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(find(events, "DAMAGE_DEALT")?.base).toBe(30);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Gyarados — the UNBOUNDED count: the SAME op, a different number of runs", () => {
  it("announces a heads* + tails sequence and mills 2 × heads off the top, in order", () => {
    // THE SLICE'S POINT, END TO END. Everything below is Wugtrio's case with two
    // numbers changed — the flip count is a property of the FACES rather than of the
    // text, and the mill is 2 rather than 3 — and NOTHING else moves. One consequent,
    // two flip-count sources.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = gyaradosActive(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      const faces = facesIn(events);
      // AT LEAST ONE FLIP, ALWAYS, and it ends in TAILS — the sequence's own shape is
      // the evidence that the loop terminated rather than being cut off at the cap.
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      const heads = headsIn(events);
      expect(heads).toBe(faces.length - 1);
      seen.add(heads);

      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        expect(row.seat).toBe("p2");
        expect(row.uids).toHaveLength(HAVOC_MILL);
      }
      const milled = milledUids(events);
      expect(milled).toHaveLength(HAVOC_MILL * heads);
      expect(milled).toEqual(deckBefore.slice(0, HAVOC_MILL * heads));
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...deckBefore.slice(0, HAVOC_MILL * heads),
      ]);
      expect(deckBefore.length - done.players.p2.deck.length).toBe(HAVOC_MILL * heads + 1);
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The unbounded arm's outcome space is a geometric tail, so this is a SUPERSET
    // claim: 0 was seen and something ≥ 2 was seen. An exact set would be a statement
    // about the seeds rather than about the shape.
    expect(seen.has(0)).toBe(true);
    expect([...seen].some((h) => h >= 2)).toBe(true);
  });

  it("mills a DIFFERENT number per heads than Wugtrio, off the same op", () => {
    // 2 against 3, read out of the two sentences by one shape. A build that hardcoded
    // either count would pass one card's whole block and fail the other's — and both
    // cards run on the same board here, so the comparison is exact.
    for (let seed = 0; seed < SEEDS; seed++) {
      const wug = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const gya = mustApply(gyaradosActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      expect(milledUids(wug.events)).toHaveLength(TUNNEL_MILL * headsIn(wug.events));
      expect(milledUids(gya.events)).toHaveLength(HAVOC_MILL * headsIn(gya.events));
      // …and the ROW SHAPES differ where the mills differ: 3 uids per row against 2.
      for (const row of all(wug.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(3);
      for (const row of all(gya.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(2);
    }
  });
});

describe("the ZERO-HEADS outcome — nothing runs, and nothing is skipped either", () => {
  it("mills nothing, emits no row, and takes the existing NO-PROGRAM ending", () => {
    // THE OUTCOME THE EXPANSION MAKES FREE. `heads === 0` expands to an EMPTY op
    // list, so `program` stays null and the attack takes attack.ts's existing
    // no-program ending — there is no zero-heads branch anywhere in the slice, which
    // is the argument for spending the faces into a program rather than threading a
    // count to `runProgram` (where zero would have been a case to handle).
    //
    // MEASURED: seed 10 is Wugtrio's first three-tails sweep, and seed 0 is
    // Gyarados's first-flip tails.
    for (const [label, field, index, seed, flips] of [
      ["Wugtrio (3 printed flips)", wugtrioActive, TUNNEL_INDEX, 10, 3],
      ["Gyarados (until tails)", gyaradosActive, HAVOC_INDEX, 0, 1],
    ] as const) {
      const state = field(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      // The flips WERE taken and announced — a zero-heads attack still spends its
      // sequence, which is what separates it from an attack that never flipped.
      expect(facesIn(events), label).toHaveLength(flips);
      expect(headsIn(events), label).toBe(0);
      expect(facesIn(events).every((f) => f === "tails"), label).toBe(true);
      // ZERO ROWS — not one carrying an empty uid list.
      expect(all(events, "DECK_TOP_DISCARDED"), label).toHaveLength(0);
      // The deck and the discard are untouched by the ATTACK; the single missing deck
      // card is P2's own turn-start draw, and the discard is exactly as it was.
      expect(done.players.p2.discard, label).toEqual(state.players.p2.discard);
      expect(done.players.p2.deck, label).toEqual(deckBefore.slice(1));
      // AND NO LOUD ROW. `effectSimulated` is true because the coin reader read the
      // sentence, and it does not depend on the faces — a build that only claimed the
      // sentence when something actually happened would fail here and nowhere else.
      expect(types(events), label).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(events), label).not.toContain("ATTACK_FAILED");
      expect(types(events), label).not.toContain("DAMAGE_DEALT");
      expect(types(events), label).toContain("TURN_ENDED");
    }
  });
});

describe("modifierSimulated / effectSimulated — no loud row on ANY outcome", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on both cards", () => {
    // D126's trap, recurring for the FIFTH time — and this slice is the first where
    // the answer runs the other way. `effectSimulated` needs no new term (the
    // `coinFlip !== null` one already covers this member and is right to), while
    // `modifierSimulated` must EXCLUDE it: `programPerHeads` folds no damage, so it
    // explains no "+"/"×" and claiming one would suppress a loud row the engine has
    // not earned.
    //
    // NEITHER PRINTING HAS A `damage` FIELD, so no board here can tell the two
    // answers apart — the exclusion is correctness in principle, and this case pins
    // the half that IS observable: whatever `modifierSimulated` says, the absent
    // modifier must not produce a row.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const wug = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const gya = mustApply(gyaradosActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      expect(types(wug.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(gya.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seen.add(headsIn(wug.events));
    }
    // …and the sweep really did cover the zero-heads outcome, so "no loud row on ANY
    // outcome" is a statement about the one that could plausibly have been special.
    expect(seen.has(0)).toBe(true);
  });
});

describe("outcome coverage — the sweep reaches the outcomes the cases rest on", () => {
  it("sees 0 heads and at least one ≥ 2 on BOTH cards inside SEEDS", () => {
    // MEASURED, NOT INHERITED, and this is the case that sets SEEDS = 12. Sweeping
    // 0..199 on this deck, the first seed reaching each count is:
    //
    //   Wugtrio  0→10  1→0  2→1  3→2
    //   Gyarados 0→0   1→6  2→30  3→3  4→53  5→2  7→142  8→120
    //
    // Wugtrio's THREE-TAILS outcome at seed 10 is the binding one — it is the rarest
    // outcome either card has in a short sweep and the one every "nothing happened"
    // assertion rests on. 12 is the smallest sweep that reaches it, and it reaches
    // Wugtrio's FULL outcome space {0,1,2,3} on the way.
    //
    // Gyarados's set inside 12 is {0, 1, 3, 5} — note that it never sees exactly 2,
    // which is the unbounded fold's geometric tail showing itself and the reason the
    // claim here is a SUPERSET one ("saw 0, and saw something ≥ 2") rather than an
    // exact set. An exact set would be a statement about the seeds, not the shape.
    const wugtrio = new Set<number>();
    const gyarados = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      wugtrio.add(
        headsIn(
          mustApply(wugtrioActive(board(seed), "p1"), {
            type: "attack",
            seat: "p1",
            index: TUNNEL_INDEX,
          }).events,
        ),
      );
      gyarados.add(
        headsIn(
          mustApply(gyaradosActive(board(seed), "p1"), {
            type: "attack",
            seat: "p1",
            index: HAVOC_INDEX,
          }).events,
        ),
      );
    }
    expect(wugtrio.has(0)).toBe(true);
    expect([...wugtrio].some((h) => h >= 2)).toBe(true);
    expect(gyarados.has(0)).toBe(true);
    expect([...gyarados].some((h) => h >= 2)).toBe(true);
    // Wugtrio's outcome space IS bounded (3 flips), so its set can be pinned exactly
    // — and doing so is what says the printed count really is 3 and not 2 or 4.
    expect([...wugtrio].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...wugtrio)).toBe(3);
    // Gyarados's cannot be, and is asserted only where it is a fact about the shape:
    // it exceeds the printed arm's ceiling on this very sweep, which no bounded count
    // could do.
    expect(Math.max(...gyarados)).toBeGreaterThan(3);
  });
});

describe("the CLAMP — a deck shallower than the printed number", () => {
  it("discards the WHOLE deck, reports the short list, and does not throw", () => {
    // §8.6 "do as much as you can", in the mill's currency. Seed 2 is a three-heads
    // Wugtrio (nine cards wanted); `trimDeckTo` leaves P2 with TWO, which no seed
    // could be relied on to produce. The first op takes both, and the two behind it
    // find an empty deck and emit NOTHING — a zero-card mill is silent, which is the
    // sibling producer's "only fires with ≥1" rule.
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2);
    const deckBefore = [...state.players.p2.deck];
    const discardBefore = [...state.players.p2.discard];
    expect(deckBefore).toHaveLength(2);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    // ONE row, carrying the REAL (short) list — not three rows, and not a row padded
    // to the printed 3.
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seat).toBe("p2");
    expect(rows[0]?.uids).toEqual(deckBefore);
    expect(rows[0]?.uids).toHaveLength(2);
    expect(done.players.p2.deck).toEqual([]);
    expect(done.players.p2.discard).toEqual([...discardBefore, ...deckBefore]);
  });

  it("clamps only the op that runs short — an earlier full one is unaffected", () => {
    // THE PARTIAL CLAMP, which a single all-or-nothing case would miss entirely. Four
    // cards against three heads × 3: the first op takes 3, the SECOND takes the last
    // 1, and the third takes none. Three different answers from three copies of one
    // op, which is the sharpest statement that the expansion runs the op N times
    // rather than computing N × 3 once.
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 4);
    const deckBefore = [...state.players.p2.deck];
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.uids).toEqual(deckBefore.slice(0, 3));
    expect(rows[1]?.uids).toEqual(deckBefore.slice(3, 4));
    expect(milledUids(events)).toEqual(deckBefore);
    expect(done.players.p2.deck).toEqual([]);
  });

  it("does NOT end the game at the mill — the loss is owed to the DRAW STEP", () => {
    // §14.3 IS A TURN-START RULE, and this is the case that pins it. Milling a deck to
    // zero does not lose the game on the spot: the loss happens when the milled player
    // must DRAW and cannot, exactly as a short `drawCards` short-draws rather than
    // losing. The op therefore checks nothing and flow.ts's `startTurn` owns the rule.
    //
    // ATTACKING ENDS THE TURN (§5.3), so P2's next turn starts inside this same batch
    // and the deck-out really does arrive here — which means the claim cannot be "no
    // GAME_OVER row" and has to be the sharper one: WHERE the row sits. It follows
    // TURN_ENDED and TURN_STARTED, it carries reason "deckOut", and there is nothing
    // between the mill and the end of the turn. A build that ended the game inside the
    // op would emit it before TURN_ENDED and would win P1 the game a full turn early.
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    const order = types(events);
    const over = find(events, "GAME_OVER");
    expect(over?.outcome).toEqual({ result: "win", winner: "p1", reason: "deckOut" });
    // THE ORDER IS THE ASSERTION.
    expect(order.indexOf("DECK_TOP_DISCARDED")).toBeLessThan(order.indexOf("TURN_ENDED"));
    expect(order.indexOf("TURN_ENDED")).toBeLessThan(order.indexOf("TURN_STARTED"));
    expect(order.indexOf("TURN_STARTED")).toBeLessThan(order.indexOf("GAME_OVER"));
    // …and the losing player is the one whose TURN it now is, which is what "at the
    // draw step" means. They never drew — deck-out is checked before the draw, so
    // there is no CARDS_DRAWN row for it.
    expect(order.lastIndexOf("CARDS_DRAWN")).toBeLessThan(order.indexOf("TURN_ENDED"));
    expect(done.players.p2.deck).toEqual([]);
    // The mill itself reported only the cards it moved; it neither knew nor said
    // anything about the deck being empty afterwards.
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
  });

  it("mills an ALREADY-EMPTY deck silently — no row, no throw, no game over yet", () => {
    // The degenerate end, reached the same deliberate way. Every op finds nothing, so
    // every op is a no-op and the event stream carries the flips and nothing else.
    // The game still does not end here — P2 loses at their draw, one row later, for
    // the same reason as above.
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    const order = types(events);
    expect(order.indexOf("TURN_STARTED")).toBeLessThan(order.indexOf("GAME_OVER"));
    expect(find(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "deckOut",
    });
  });
});

describe("the rngState account — exactly the sequence, no more and no fewer steps", () => {
  it("recomputes both boards' whole face sequence, in order", () => {
    // THE ASSERTION THAT CATCHES AN OFF-BY-ONE OR A DOUBLE FLIP, and it is stated
    // against the two DIFFERENT primitives the two flip counts use — `foldFlips` (a
    // counted fold, for the printed 3) and `flipUntilTails` (the engine's own loop,
    // for the unbounded one). Both halves are checked on every board:
    //
    //   • the resulting rngState IS `after.rngState` — so exactly the sequence's
    //     worth of steps was consumed, and nothing else in this attack touched the
    //     rng. THE EXPANDED OPS ARE THE POINT: `discardDeckTop` consumes no
    //     randomness, so N copies of it must leave the state exactly where the flips
    //     left it. A mill that reached for the rng would fail here on every seed with
    //     a heads in it, and nowhere else in the file.
    //   • the resulting FACES are the emitted rows' results IN ORDER.
    for (let seed = 0; seed < SEEDS; seed++) {
      const wugState = wugtrioActive(board(seed), "p1");
      const [wugFaces, wugAfter] = foldFlips(wugState.rngState, 3);
      const wug = mustApply(wugState, { type: "attack", seat: "p1", index: TUNNEL_INDEX });
      expect(wug.state.rngState).toBe(wugAfter);
      expect(facesIn(wug.events)).toEqual(wugFaces);
      // ONE MORE STEP would have landed here, and one FEWER here — so this is a claim
      // about the LENGTH of the sequence and not just about a number.
      expect(wug.state.rngState).not.toBe(foldFlips(wugState.rngState, 4)[1]);
      expect(wug.state.rngState).not.toBe(foldFlips(wugState.rngState, 2)[1]);

      const gyaState = gyaradosActive(board(seed), "p1");
      const [gyaFaces, gyaAfter] = flipUntilTails(gyaState.rngState, MAX_UNTIL_TAILS_FLIPS);
      const gya = mustApply(gyaState, { type: "attack", seat: "p1", index: HAVOC_INDEX });
      expect(gya.state.rngState).toBe(gyaAfter);
      expect(facesIn(gya.events)).toEqual(gyaFaces);
      expect(gya.state.rngState).not.toBe(foldFlips(gyaState.rngState, gyaFaces.length + 1)[1]);
      expect(gya.state.rngState).not.toBe(foldFlips(gyaState.rngState, gyaFaces.length - 1)[1]);
      // …and the two helpers agree on the unbounded run, which is what lets the ±1
      // probes above be stated in terms of a counted fold at all.
      expect(foldFlips(gyaState.rngState, gyaFaces.length)[1]).toBe(gyaAfter);
    }
  });

  it("spends the same steps whatever the mill DOES — a clamped run costs no more", () => {
    // The mill's determinism, stated where it could most plausibly break: a clamped
    // board moves fewer cards than the sentence asks for, and it must still consume
    // exactly the flips' worth of rng. If the op ever grew a random element (a
    // shuffle, a random pick), the two states below would diverge.
    const full = wugtrioActive(board(2), "p1");
    const clamped = trimDeckTo(full, "p2", 2);
    const empty = trimDeckTo(full, "p2", 0);
    const [, expected] = foldFlips(full.rngState, 3);
    for (const state of [full, clamped, empty]) {
      const { state: after } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      expect(after.rngState).toBe(expected);
    }
  });

  it("does not double-flip with §8's CONFUSION check", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is
    // the older. An UNCONFUSED attacker must never emit its event and never consume
    // its step, so the rows in the list are the attack's own.
    for (const [field, index] of [
      [wugtrioActive, TUNNEL_INDEX],
      [gyaradosActive, HAVOC_INDEX],
    ] as const) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
    }
  });
});

describe("purity", () => {
  it("resolves both printings on a DEEP-FROZEN board, at every outcome", () => {
    // The rngState thread, the deck slice and the discard append all go through fresh
    // objects — a frozen state proves nothing was mutated in place. This member is
    // where that stops being routine: the expansion builds a NEW array by appending
    // to `program`, and the shortest wrong version of it (`program.push(...)`, or an
    // in-place `side.deck.splice`) would be caught here and by nothing else in the
    // file. The clamped and empty boards ride along, since those are the branches
    // where a mutation would be easiest to slip into a guard.
    for (let seed = 0; seed < SEEDS; seed++) {
      mustApply(deepFreeze(wugtrioActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      mustApply(deepFreeze(gyaradosActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
    }
    mustApply(deepFreeze(trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2)), {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    mustApply(deepFreeze(trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 0)), {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    // …and the DERIVER is a pure function of its string, on both arms, and hands back
    // a FRESH ops array each time — the expansion references the member's array
    // `heads` times, so a caller that could poison it would poison every later
    // resolution of the same card.
    const first = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    const second = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    expect(first).toEqual(second);
    if (first?.kind !== "programPerHeads" || second?.kind !== "programPerHeads") {
      throw new Error("expected two programPerHeads printings");
    }
    expect(first.ops).not.toBe(second.ops);
    first.ops.push({ op: "shuffleDeck" });
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toEqual(second);
  });
});
