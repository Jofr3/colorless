import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  DECK_TOP_MILL_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

// 0.81.0 → 0.82.0 — the UNCONDITIONAL MILL, both directions (D131). "Discard the
// top [{N} cards|card] of your [opponent's] deck." — 16 printings / 7 distinct
// clauses on ONE anchored regex and ONE deriver arm, the largest single mapping any
// slice in this family has taken.
//
// THE OP WAS ALREADY BUILT. D130 shipped `discardOpponentDeckTop` for the coin
// family and wrote into its own doc block that the own-deck reading was a live
// unmapped sentence which "the first slice that maps it widens this field then, with
// two readings in hand rather than one guessed at". This suite is the receipt for
// that: `discardDeckTop { whose: "self" | "opponent"; count }`, one widened field, no
// new member, and the interpreter arm grew ONE ternary.
//
// WHAT THIS FILE PINS, and why each half is here:
//   • THE ANCHOR, on all 7 distinct clauses and against the 5 REAL catalog rows it
//     must refuse. Four of those five are one clause away from a match, and the
//     fifth (Camerupt sv03-032) is the same words aimed at BOTH decks with a damage
//     bonus riding on what was discarded — the one that would do real damage if the
//     anchor loosened.
//   • THE SINGULAR BRANCH. "the top card" captures no digits and must still mean 1 —
//     the only place the deriver invents a number rather than reading one. The
//     alternation is about the two printed SPELLINGS; it does not filter "the top 1
//     cards" (unprinted, but unambiguous), and "the top cards" names no amount at all.
//   • THE DIRECTION, end to end and on BOTH seats — including the case that makes
//     the widening honest: Gyarados swsh10.5-022 mills the OPPONENT at index 0 (D130,
//     behind a coin) and its OWN deck at index 1 (D131, flat), so one card runs one
//     action both ways and a `whose` that were ignored would fail here and nowhere
//     else.
//   • THE ORDER. Nine of the sixteen printings carry printed damage, and the ops run
//     at attack.ts's TAIL (D125), so "230 damage, then discard 5 of your own"
//     resolves in the printed order for free — asserted rather than assumed.
//   • §14.3 IS STILL A DRAW-STEP RULE, on the direction that is new. An OPPONENT
//     mill-out loses in the same event batch (attacking ends the turn, so their turn
//     starts here); a SELF mill-out loses A FULL TURN LATER, and that asymmetry is
//     entirely in the rule rather than in the op.
//   • NO RNG, NO PARK, NO REGISTRY ROW.

/** The seven distinct clauses of the pool, verbatim, and the op each derives to.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string, 16
    printings in all: this is the whole mapped set and nothing else in 978 cards / 6 sets
    prints the shape. Named here rather than inlined so a table-driven case and the
    end-to-end cases below cannot drift apart. */
const CLAUSES = [
  // OPPONENT-side — 7 printings across 2 clauses.
  {
    text: "Discard the top card of your opponent's deck.",
    op: { op: "discardDeckTop", whose: "opponent", count: 1 },
    // Garganacl sv02-123 + Diggersby sv03-113 ("Knocking Hammer"), Paldean Clodsire
    // sv03-128 ("Muddy Hammer"), Skwovet sv03-178 ("Nicked Nibble").
    printings: 4,
  },
  {
    text: "Discard the top 2 cards of your opponent's deck.",
    op: { op: "discardDeckTop", whose: "opponent", count: 2 },
    // Chi-Yu ex sv02-040 / -234 / -259 ("Jealously Singe") — three printings, one card.
    printings: 3,
  },
  // OWN-side — 9 printings across 5 clauses, and the reading D130 declined.
  {
    text: "Discard the top card of your deck.",
    op: { op: "discardDeckTop", whose: "self", count: 1 },
    // Fraxure sv06.5-045 / -077 ("Dragon Pulse"), Diglett sv03-103.
    printings: 3,
  },
  {
    text: "Discard the top 2 cards of your deck.",
    op: { op: "discardDeckTop", whose: "self", count: 2 },
    // Tyranitar ex sv03-066 / -211 ("Mountain Hurl").
    printings: 2,
  },
  {
    text: "Discard the top 3 cards of your deck.",
    op: { op: "discardDeckTop", whose: "self", count: 3 },
    // Haxorus sv06.5-046 ("Dragon Pulse" — the same attack NAME as Fraxure's, a
    // different count, which is why the census is over the TEXT and not the name).
    printings: 1,
  },
  {
    text: "Discard the top 4 cards of your deck.",
    op: { op: "discardDeckTop", whose: "self", count: 4 },
    // Tyranitar sv02-135 / -222 ("Dread Mountain").
    printings: 2,
  },
  {
    text: "Discard the top 5 cards of your deck.",
    op: { op: "discardDeckTop", whose: "self", count: 5 },
    // Gyarados swsh10.5-022 ("Wild Splash") — the fixture this suite drives.
    printings: 1,
  },
] as const;

/** The FIVE real catalog rows this anchor must refuse, verbatim off the local D1.
    Every one of them contains the mapped words; not one of them is the mapped
    sentence, and the refusal is the anchors alone in every case. They are this
    file's "stays LOUD" witnesses, and better ones than an invented string would be:
      • Wiglett sv01-056 — the same action on the same zone, GATED behind a flip,
        printed by a card one evolution below Wugtrio. SIMULATED SINCE 0.85.0 by
        `FLIP_DECK_TOP_MILL` (D134), which is why its case below is a SHAPE claim
        rather than a null: what this file asserts is that the BARE anchor does not
        claim it, and the proof is that the derived program is a `coinFlipGate` whose
        branch is this anchor's own singular reading — not a bare mill.
      • Wugtrio sv01-057 / Gyarados swsh10.5-022 idx 0 — D130's per-heads programs.
        They ARE simulated, by `deriveAttackCoinFlip`; what is pinned here is that
        the BARE reader does not also claim them, because two readers on one string
        is an invariant nobody enforces.
      • Whiscash sv03-109 — a BOARD-COUNTED amount ("For each {F} Energy attached to
        this Pokémon, discard the top card of your opponent's deck."). Genuinely
        unmapped, and the shape D128 would answer if anyone wanted it.
      • Camerupt sv03-032 — "Discard the top card of EACH PLAYER'S deck. This attack
        does 100 more damage for each Energy card discarded in this way." Two decks
        AND a damage bonus that reads WHAT was discarded. The dangerous one: a
        loosened anchor would mill one deck and silently drop the bonus. */
const REAL_NEAR_MISSES = [
  "Flip a coin. If heads, discard the top card of your opponent's deck.",
  "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.",
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
  "For each {F} Energy attached to this Pokémon, discard the top card of your opponent's deck.",
  "Discard the top card of each player's deck. This attack does 100 more damage for each Energy card discarded in this way.",
] as const;

/** U+2019, the CURLY apostrophe, spelled as an ESCAPE rather than typed. The
    opponent-side clauses carry an ASCII `'` and the pool holds ZERO U+2019 anywhere,
    so a hand-retyped near-miss is the only way one enters the codebase — and it
    would drop four printings onto the loud path with no number to notice it by. The
    regex accepts BOTH (`['’]`), which is the family's standing choice; this pins
    that the acceptance is deliberate rather than accidental. */
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

/** Skwovet prints "Nicked Nibble" (the mill) FIRST and "Gentle Slap" (a flat 10)
    second; Gyarados prints "Wreak Havoc" (D130's coin mill) first and "Wild Splash"
    (this slice's own-deck mill) second. Named rather than inlined, so a reprint that
    reordered an attack fails on the fixture guards below rather than silently moving
    every board case onto the wrong sentence. */
const NIBBLE_INDEX = 0;
const SLAP_INDEX = 1;
const SPLASH_INDEX = 1;

/** The two mill counts and the one printed damage, named because every delta
    assertion is stated in terms of them. */
const NIBBLE_MILL = 1;
const SPLASH_MILL = 5;
const SPLASH_DAMAGE = 230;

/** ATTACKING ENDS THE TURN (§5.3), so the OPPONENT's turn starts inside the same
    event batch and they DRAW — one more card off the very deck an opponent-side mill
    just shortened. Named rather than folded into the numbers, because it is the one
    thing that makes "P2's deck is 1 shorter" mean two different things depending on
    which attack ran, and a silent `+ 1` in a slice about deck sizes is exactly the
    kind of arithmetic that hides an off-by-one in the op. The ATTACKER never draws
    here, which is why the self-mill assertions carry no such term. */
const TURN_START_DRAW = 1;

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account — which is itself part
    of what the suite claims (see the rng case at the end).

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery: Wild Splash's 230 cannot KO it, so no
    promotion can park mid-batch and truncate a row sequence, and no defender attack
    can interleave rows with the ones being counted. The board under test is not the
    Pokémon — it is the DECKS. */
function board(): GameState {
  let state = driveSetup(7, { p1: DECK_TOP_MILL_DECK, p2: DECK_TOP_MILL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Skwovet Active with one {C} paid — enough for EITHER of its attacks, which is the
    point: the two cost the same, so nothing but the declared INDEX tells them apart
    and an implementation keyed to the card rather than to the attack's text fails on
    the control. */
function skwovetActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-178"), seat, "fix-energy", 1);
}

/** Gyarados Active with Wild Splash's {W}{W}{C}{C} paid. SURGERY: it is a Stage 1
    and could never be dealt as an opening Active. */
function gyaradosActive(state: GameState, seat: Seat): GameState {
  const withWater = attachFromDeck(
    setActiveFromDeck(state, seat, "swsh10.5-022"),
    seat,
    "fix-water-energy",
    2,
  );
  return attachFromDeck(withWater, seat, "fix-energy", 2);
}

/** The uids named by the mill rows, in order — the account every delta is checked
    against. Read off the EVENTS rather than recomputed from the deck, because an op
    that moved the right NUMBER of wrong cards is the failure this catches. */
function milledUids(events: GameEvent[]): string[] {
  return all(events, "DECK_TOP_DISCARDED").flatMap((e) => e.uids);
}

describe("the anchor — 16 printings, 7 clauses, both directions", () => {
  it("derives every distinct clause the pool prints, aimed the printed way", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    // THE CENSUS, ASSERTED AS A SHAPE. 7 distinct clauses / 16 printings, split 2 and
    // 5 by direction and 7 and 9 by printing. These are the numbers the slice claims
    // and the numbers a re-census has to reproduce; keeping them in the table means a
    // clause added without its printing count fails here rather than quietly drifting.
    const sum = (whose: string) =>
      CLAUSES.filter((c) => c.op.whose === whose).reduce((n, c) => n + c.printings, 0);
    expect(CLAUSES).toHaveLength(7);
    expect(CLAUSES.filter((c) => c.op.whose === "opponent")).toHaveLength(2);
    expect(CLAUSES.filter((c) => c.op.whose === "self")).toHaveLength(5);
    expect(sum("opponent")).toBe(7);
    expect(sum("self")).toBe(9);
    expect(sum("opponent") + sum("self")).toBe(16);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering six clauses.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
  });

  it("reads the SINGULAR as one — the arm that captures nothing", () => {
    // "the top card" has no digits at all, so `count: 1` is invented by the deriver
    // rather than parsed. Both directions take that arm.
    expect(deriveAttackEffect("Discard the top card of your opponent's deck.")).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 1 },
    ]);
    expect(deriveAttackEffect("Discard the top card of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 1 },
    ]);
    // "the top cards" — the plural WORDING with no number — names no amount and is
    // refused. That is what the alternation is for: the two branches are two printed
    // spellings, and a sentence belonging to neither has no reading.
    expect(deriveAttackEffect("Discard the top cards of your deck.")).toBeNull();
    // "the top 1 cards" IS accepted, and deliberately not special-cased. It is not
    // English and no card prints it, but `\d+` covers it and the only way to refuse
    // it would be a digit class that exists to reject one string — buying nothing,
    // since the reading is unambiguous and identical to the singular's. Pinned so
    // that "the alternation is about SPELLING, not about filtering 1" is on the
    // record rather than rediscovered from a regex.
    expect(deriveAttackEffect("Discard the top 1 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 1 },
    ]);
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    // A "top 0 cards" printing is not a real card and would derive to a silent
    // no-op: the attack would report a simulated effect and move nothing. Loud path.
    expect(deriveAttackEffect("Discard the top 0 cards of your deck.")).toBeNull();
    expect(deriveAttackEffect("Discard the top 0 cards of your opponent's deck.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the op CLAMPS to the deck (§8.6),
    // so a malformed large count mills a deck and stops. That is a legal board state,
    // not a runaway — the thing D129 refused to add a ceiling for.
    expect(deriveAttackEffect("Discard the top 999 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 999 },
    ]);
  });

  it("refuses the FIVE real catalog rows that share its words", () => {
    for (const [index, text] of REAL_NEAR_MISSES.entries()) {
      // Index 0 (Wiglett, gated) has been simulated since 0.85.0 by ANOTHER arm of
      // this same reader, so a null is no longer the right claim for it — see the
      // gated case below, which is strictly stronger. Every other row must still
      // derive to nothing here.
      if (index === 0) continue;
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // The two that ARE simulated are simulated by the OTHER reader, which is the
    // boundary this file and perHeadsProgram.test.ts share: one anchored reader per
    // printed string, never two.
    expect(deriveAttackCoinFlip(REAL_NEAR_MISSES[1])).not.toBeNull();
    expect(deriveAttackCoinFlip(REAL_NEAR_MISSES[2])).not.toBeNull();
    // Camerupt's second sentence is a `+` clause, and the bonus reader does not claim
    // the printing either (its subject is "each Energy card discarded in this way",
    // which nothing counts). So the whole row stays loud on BOTH readers — a genuine
    // gap, not a half-simulation.
    expect(deriveAttackDamageBonus(REAL_NEAR_MISSES[4])).toBeNull();
  });

  it("leaves Wiglett's GATED printing to the flip anchor — and the mill inside it is THIS one", () => {
    // RE-POINTED AT 0.85.0 (D134). Wiglett sv01-056 "Dig a Little" was this file's
    // sharpest near-miss from 0.82.0 until `FLIP_DECK_TOP_MILL` mapped it; per the
    // standing rule the case was re-pointed rather than deleted, and it now makes a
    // stronger claim than the null did. THIS anchor still refuses the string — it
    // starts at `^Discard` and the gated printing does not — so the gate cannot be
    // dropped by a loosened body, which is the danger the case always guarded.
    const gated = REAL_NEAR_MISSES[0];
    expect(gated.startsWith("Discard")).toBe(false);
    // The proof is the SHAPE: what comes back is a `coinFlipGate` whose branch is
    // exactly what this anchor derives for the bare singular — including the
    // `count: 1` it invents rather than reads. A build that let the bare body claim
    // the gated string would return that inner op at the TOP level, unwrapped.
    expect(deriveAttackEffect(gated)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: deriveAttackEffect("Discard the top card of your opponent's deck."),
      },
    ]);
    // And the coin reader still does not claim it either — a gated op is not an
    // `AttackCoinFlip` shape, which is what keeps exactly one reader answering for
    // the string.
    expect(deriveAttackCoinFlip(gated)).toBeNull();
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Discard the top 2 cards of your deck",
      "Discard the top card of your opponent's deck",
      // "!" for "." — the same one-character difference from the other side.
      "Discard the top 2 cards of your deck!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Whiscash's "…, discard the top card…" above is exactly that clause),
      // and the reason no /i flag is on this regex.
      "discard the top 2 cards of your deck.",
      "discard the top card of your opponent's deck.",
      // A CURLY apostrophe is ACCEPTED (`['’]`), unlike the drifts around it — the
      // family's standing choice, pinned so it reads as deliberate. The pool holds
      // zero U+2019, so this arm is latent by design.
      // (asserted positively below, not here)
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Discard the top${NBSP}2 cards of your deck.`,
      // An INTERIOR double space is not trimmable.
      "Discard the top  2 cards of your deck.",
      // Leading text pins `^` — and this is not hypothetical: it is how a rider
      // sentence would arrive.
      "Before doing damage, discard the top 2 cards of your deck.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for. No
      // pool printing extends these clauses today, which is precisely why the guard
      // is pinned now: the first one that does must land LOUDLY rather than
      // half-resolve, dropping a rider the engine never saw. (Camerupt is the live
      // proof that such printings exist at all.)
      "Discard the top 2 cards of your deck. Your opponent's Active Pokémon is now Confused.",
      "Discard the top card of your opponent's deck. Then, shuffle your deck.",
      // THE OTHER ZONES. "hand" and "discard pile" are different zones and different
      // ops; "your opponent's deck" with no "top" is a different action again.
      "Discard the top card of your opponent's hand.",
      "Discard the top 2 cards of your discard pile.",
      // A THIRD-PARTY reading nothing prints: neither "your" nor "your opponent's".
      "Discard the top 2 cards of each player's deck.",
      "Discard the top 2 cards of their deck.",
      // "Put" / "Shuffle" for "Discard" — the same zone, a different action.
      "Put the top 2 cards of your deck in the discard pile.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // The CURLY apostrophe IS read, on the one clause family that has an apostrophe.
    expect(deriveAttackEffect(`Discard the top 2 cards of your opponent${RSQUO}s deck.`)).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 2 },
    ]);
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not — on BOTH directions, because the
    // trim happens once and both arms have to benefit from it.
    expect(deriveAttackEffect("  Discard the top 5 cards of your deck.\n")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 5 },
    ]);
    expect(deriveAttackEffect("\tDiscard the top card of your opponent's deck. ")).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 1 },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Skwovet sv03-178", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here (ASCII apostrophes, and the
    // exact absence of a `damage` field on the mill attack).
    expect(FIXTURE_POOL["sv03-178"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Nicked Nibble",
        effect: "Discard the top card of your opponent's deck.",
      },
      { cost: ["Colorless"], name: "Gentle Slap", damage: 10 },
    ]);
    expect(FIXTURE_POOL["sv03-178"]?.name).toBe("Skwovet");
    expect(FIXTURE_POOL["sv03-178"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-178"]?.hp).toBe(60);
    expect(FIXTURE_POOL["sv03-178"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv03-178"]?.abilities).toBeNull();
    // "Nicked Nibble" prints NO `damage` field at all, so a mis-read has no number to
    // land on: the mill is the whole visible result of the declaration.
    expect(FIXTURE_POOL["sv03-178"]?.attacks?.[NIBBLE_INDEX]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["sv03-178"]?.attacks?.[NIBBLE_INDEX]?.effect).not.toContain(RSQUO);
  });

  it("matches FIXTURE_POOL char-for-char for Gyarados's OWN-deck attack", () => {
    // THE WIDENING'S PROOF CASE, and it needed no new bytes: D130 already fielded
    // "Wild Splash" on this fixture as its refused near-miss, verbatim off the D1.
    const splash = FIXTURE_POOL["swsh10.5-022"]?.attacks?.[SPLASH_INDEX];
    expect(splash).toEqual({
      cost: ["Water", "Water", "Colorless", "Colorless"],
      name: "Wild Splash",
      effect: "Discard the top 5 cards of your deck.",
      damage: SPLASH_DAMAGE,
    });
    // ONE CARD, ONE ACTION, BOTH DIRECTIONS. Index 0 mills the OPPONENT (D130, behind
    // an until-tails coin); index 1 mills its OWN deck (D131, flat). If `whose` were
    // ignored anywhere downstream, THIS is the card it would show up on.
    expect(deriveAttackEffect(splash?.effect ?? "")).toEqual([
      { op: "discardDeckTop", whose: "self", count: SPLASH_MILL },
    ]);
    expect(deriveAttackCoinFlip(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[0]?.effect ?? "")).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });

  it("pins Paldean Clodsire's second attack, which D131 turned from control to case", () => {
    // sv03-128 "Muddy Hammer" ({D}{C}{C}, 100) was retreatLock.test.ts's "one card,
    // one derived attack" control while it was UNSIMULATED. It is now simulated, and
    // that suite's "does not inherit down the attack index" case became STRONGER: the
    // index-1 attack derives a DIFFERENT op rather than none, so the lock being absent
    // there is a statement about the declared attack's text and not about an absence.
    expect(FIXTURE_POOL["sv03-128"]?.attacks?.[1]?.effect).toBe(
      "Discard the top card of your opponent's deck.",
    );
    expect(deriveAttackEffect(FIXTURE_POOL["sv03-128"]?.attacks?.[1]?.effect ?? "")).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 1 },
    ]);
  });
});

describe("the OPPONENT reading, end to end — Skwovet 'Nicked Nibble'", () => {
  it("moves the top card of the DEFENDER's deck to the DEFENDER's discard", () => {
    const state = skwovetActive(board(), "p1");
    const deckBefore = state.players.p2.deck;
    const ownDeckBefore = state.players.p1.deck;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: NIBBLE_INDEX,
    });
    // The cards named are the TOP ones, in deck order, and they are the same cards
    // the defender's discard pile gained.
    expect(milledUids(events)).toEqual(deckBefore.slice(0, NIBBLE_MILL));
    // The mill took the top card; P2's own turn-start draw then took the next one.
    // Stating both terms is what keeps this an assertion about the OP rather than
    // about the deck's length.
    expect(done.players.p2.deck).toEqual(deckBefore.slice(NIBBLE_MILL + TURN_START_DRAW));
    expect(done.players.p2.hand).toContain(deckBefore[NIBBLE_MILL]);
    expect(done.players.p2.discard).toEqual([
      ...state.players.p2.discard,
      ...deckBefore.slice(0, NIBBLE_MILL),
    ]);
    // THE ATTACKER'S OWN DECK IS UNTOUCHED — the direction, asserted from the side
    // that must NOT move. A `whose` read the wrong way round passes every count
    // assertion above and fails exactly here.
    expect(done.players.p1.deck).toEqual(ownDeckBefore);
    // The row belongs to the seat whose deck shrank (events.ts: `seat` is the OWNER).
    expect(find(events, "DECK_TOP_DISCARDED")?.seat).toBe("p2");
    // Simulated, not skipped — and no damage, because the printing has none.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("runs on the OTHER seat too, aimed back the other way", () => {
    // Same card, opposite chair: the op resolves against `ctx.seat`'s opponent, not
    // against a hardcoded seat. Cheap, and the only thing that catches a `"p2"`
    // literal that happens to be right on every P1 board.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = skwovetActive(state, "p2");
    const victimDeck = state.players.p1.deck;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: NIBBLE_INDEX,
    });
    expect(milledUids(events)).toEqual(victimDeck.slice(0, NIBBLE_MILL));
    expect(find(events, "DECK_TOP_DISCARDED")?.seat).toBe("p1");
    expect(done.players.p2.deck).toEqual(state.players.p2.deck);
  });

  it("the index-1 control mills NOTHING — the reader is keyed to the declared text", () => {
    // "Gentle Slap" costs the same single {C} off the same card on the same board and
    // prints a flat 10 with no effect. Nothing but the INDEX distinguishes them.
    const state = skwovetActive(board(), "p1");
    const deckBefore = state.players.p2.deck;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SLAP_INDEX,
    });
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    // P2's deck is shorter by their turn-start DRAW and by nothing else — which is
    // the sharpest form the claim can take, since "unchanged" would be false here
    // for a reason that has nothing to do with the mill.
    expect(done.players.p2.deck).toEqual(deckBefore.slice(TURN_START_DRAW));
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(done.players.p2.active?.damage).toBe(10);
    // An effect-less attack is not a SKIPPED one: there was nothing to skip.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("the OWN reading, end to end — Gyarados 'Wild Splash'", () => {
  it("mills the ATTACKER's own deck, and damages the defender for 230", () => {
    const state = gyaradosActive(board(), "p1");
    const ownDeckBefore = state.players.p1.deck;
    const victimDeckBefore = state.players.p2.deck;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLASH_INDEX,
    });
    // THE DIRECTION. Five cards off P1's OWN deck into P1's OWN discard, and P2's
    // deck never moves — the mirror image of the Skwovet case, on the same op.
    expect(milledUids(events)).toEqual(ownDeckBefore.slice(0, SPLASH_MILL));
    expect(done.players.p1.deck).toEqual(ownDeckBefore.slice(SPLASH_MILL));
    expect(done.players.p1.discard).toEqual([
      ...state.players.p1.discard,
      ...ownDeckBefore.slice(0, SPLASH_MILL),
    ]);
    // P2's deck lost exactly their turn-start draw — no mill row touched it.
    expect(done.players.p2.deck).toEqual(victimDeckBefore.slice(TURN_START_DRAW));
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    // The row belongs to the ATTACKER here — the one producer whose `seat` swings.
    expect(find(events, "DECK_TOP_DISCARDED")?.seat).toBe("p1");
    // And the printed damage still lands: fix-titan has no Weakness or Resistance, so
    // 230 arrives unmodified and does not KO its 340 HP.
    expect(done.players.p2.active?.damage).toBe(SPLASH_DAMAGE);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("does the DAMAGE FIRST and the mill after — D125's tail placement, asserted", () => {
    // Nine of the sixteen printings carry printed damage, and the printed order is
    // "230 damage, then discard 5". Ops run at attack.ts's TAIL, strictly after the
    // §8.5 pipeline, so that order is free — but "free" is exactly the kind of claim
    // that stops being true silently, so it is pinned on the one card that shows it.
    const { events } = mustApply(gyaradosActive(board(), "p1"), {
      type: "attack",
      seat: "p1",
      index: SPLASH_INDEX,
    });
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("DECK_TOP_DISCARDED"));
  });

  it("runs BOTH of one card's directions on one board — index 0 out, index 1 in", () => {
    // THE CASE THE WIDENING EXISTS FOR. Gyarados's index 0 is D130's coin mill at the
    // OPPONENT; its index 1 is D131's flat mill at ITSELF. Same card, same op, and the
    // only thing that decides which deck shrinks is the op's `whose` field.
    const start = gyaradosActive(board(), "p1");
    const splash = mustApply(start, { type: "attack", seat: "p1", index: SPLASH_INDEX });
    expect(splash.state.players.p1.deck.length).toBe(start.players.p1.deck.length - SPLASH_MILL);
    expect(splash.state.players.p2.discard).toEqual(start.players.p2.discard);
    expect(splash.state.players.p2.deck.length).toBe(
      start.players.p2.deck.length - TURN_START_DRAW,
    );

    // "Wreak Havoc" at index 0 costs a single {C}, already paid by the {C}{C} above.
    const havoc = mustApply(start, { type: "attack", seat: "p1", index: 0 });
    // The ATTACKER's deck is untouched by the OTHER direction — the mirror of the
    // line above, and the pair is the whole claim.
    expect(havoc.state.players.p1.deck.length).toBe(start.players.p1.deck.length);
    expect(havoc.state.players.p1.discard).toEqual(start.players.p1.discard);
    // Its mill is coin-driven, so the COUNT is a fact about the seed; the DIRECTION is
    // not, and the direction is the whole claim here. (Zero heads mills nothing, which
    // is still "not the attacker's deck".)
    for (const row of all(havoc.events, "DECK_TOP_DISCARDED")) {
      expect(row.seat).toBe("p2");
    }
    for (const row of all(havoc.events, "DECK_TOP_DISCARDED")) {
      expect(row.seat).toBe("p2");
    }
  });
});

describe("the deck's edge — clamped, silent at zero, and §14.3 owed to the DRAW", () => {
  it("CLAMPS to a shallow deck and reports the SHORT list (§8.6)", () => {
    // Wild Splash asks for 5 off a deck holding 3. "Do as much as you can": three
    // cards move, the event names three, and nothing throws.
    const state = trimDeckTo(gyaradosActive(board(), "p1"), "p1", 3);
    const deckBefore = state.players.p1.deck;
    expect(deckBefore).toHaveLength(3);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLASH_INDEX,
    });
    expect(milledUids(events)).toEqual(deckBefore);
    expect(done.players.p1.deck).toEqual([]);
    // The row reported what MOVED, not what was printed — the log and the wire agree
    // with the board rather than with the number on the card.
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(3);
  });

  it("mills an ALREADY-EMPTY deck silently — no row, no throw", () => {
    // Every op finds nothing, so the op is a no-op and emits nothing. A zero-card row
    // would announce that nothing happened, which is the one thing a log must not do.
    const state = trimDeckTo(skwovetActive(board(), "p1"), "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: NIBBLE_INDEX,
    });
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("an OPPONENT mill-out loses at THEIR draw — inside this same batch", () => {
    // §14.3 is a turn-START rule. Milling to zero does not end the game; the loss
    // happens when the milled player must DRAW and cannot. Attacking ends the turn
    // (§5.3), so P2's next turn starts inside this batch and the row really does
    // arrive here — which makes the claim about WHERE it sits, not whether it exists.
    const state = trimDeckTo(skwovetActive(board(), "p1"), "p2", NIBBLE_MILL);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: NIBBLE_INDEX,
    });
    const order = types(events);
    expect(find(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "deckOut",
    });
    // THE ORDER IS THE ASSERTION. A build that ended the game inside the op would
    // emit GAME_OVER before TURN_ENDED and win P1 the game a full turn early.
    expect(order.indexOf("DECK_TOP_DISCARDED")).toBeLessThan(order.indexOf("TURN_ENDED"));
    expect(order.indexOf("TURN_ENDED")).toBeLessThan(order.indexOf("TURN_STARTED"));
    expect(order.indexOf("TURN_STARTED")).toBeLessThan(order.indexOf("GAME_OVER"));
    expect(done.players.p2.deck).toEqual([]);
  });

  it("a SELF mill-out loses a FULL TURN LATER — the asymmetry is the RULE, not the op", () => {
    // THE CASE ONLY THE NEW DIRECTION CAN STATE, and the reason the self-mill needed
    // no special handling. Wild Splash empties P1's OWN deck. P1's turn ends
    // immediately after the attack — but the next DRAW is P2's, and P2 has a deck. So
    // nothing happens in this batch at all: no GAME_OVER, no loss, an empty deck and a
    // perfectly legal board.
    const state = trimDeckTo(gyaradosActive(board(), "p1"), "p1", SPLASH_MILL);
    const { state: attacked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPLASH_INDEX,
    });
    expect(attacked.players.p1.deck).toEqual([]);
    expect(types(events)).not.toContain("GAME_OVER");
    expect(attacked.phase.kind).not.toBe("gameOver");
    // P2 takes their turn and passes. NOW P1 must draw and cannot.
    const { state: done, events: later } = mustApply(attacked, { type: "endTurn", seat: "p2" });
    expect(find(later, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p2",
      reason: "deckOut",
    });
    expect(done.players.p1.deck).toEqual([]);
    // The loss is P1's — the player who milled themselves — which is what makes the
    // self-mill a printed COST rather than a bug in the direction.
  });
});

describe("what the mill costs the rest of the engine — nothing", () => {
  it("consumes NO rng: the state's rngState is untouched on both directions", () => {
    // The op takes the cards in the order they already sit in. That determinism is
    // what let D130 repeat it once per heads, and it is what lets this whole suite run
    // on ONE board with no seed sweep — so it is worth an assertion rather than a
    // comment. (Contrast Gyarados's index 0, whose coin does consume rng.)
    const skwovet = skwovetActive(board(), "p1");
    expect(
      mustApply(skwovet, { type: "attack", seat: "p1", index: NIBBLE_INDEX }).state.rngState,
    ).toBe(skwovet.rngState);
    const gyarados = gyaradosActive(board(), "p1");
    expect(
      mustApply(gyarados, { type: "attack", seat: "p1", index: SPLASH_INDEX }).state.rngState,
    ).toBe(gyarados.rngState);
  });

  it("never PARKS — the attack resolves to an ordinary action phase", () => {
    // No choice in "the top N", so no prompt and no continuation. The turn simply
    // ends, which is what every non-parking attack does.
    const { state: done } = mustApply(skwovetActive(board(), "p1"), {
      type: "attack",
      seat: "p1",
      index: NIBBLE_INDEX,
    });
    // Not `effect:choose`, not `ko:*` — and the seat has already passed to P2, which
    // is what "the attack finished" looks like from outside.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("costs ZERO registry rows — all three cards simulate off their printed text", () => {
    // If any of these grew a row the registry would win (`programFor(id)?.attack?.
    // [index] ?? derive`) and every assertion above would keep passing while testing
    // nothing about the text.
    for (const id of ["sv03-178", "swsh10.5-022", "sv03-128"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});
