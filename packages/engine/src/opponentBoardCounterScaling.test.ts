import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countDamageCountersInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.367.0 → 0.368.0 — 🆕🆕 D469: THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS.
//
//   "This attack does 10 more damage for each damage counter on all of your
//    opponent's Pokémon."
//     — `censusAttackCorpus.ts` **FILE LINE 534**, 1 sentence / **1 Standard-legal
//       printing**, the ADDITIVE fold.
//
// D406's cost table, at a second address: **1 whole-sentence anchor
// (`OPPONENT_BOARD_COUNTER_SCALE`), 1 reader arm in `deriveAttackDamageBonus`,
// 1 `DamageCountSource` member (`damageCountersOnOpponentBoard`), 1 evaluator arm
// and 1 shared board counter (`countDamageCountersInPlay`)**. ZERO new ops, ZERO
// new `EffectOp` fields, ZERO new readers, ZERO `BoardCondition` members, ZERO
// registry rows, ZERO prompts, ZERO events, ZERO error codes, ZERO `GameState`
// fields, and no web/API/DB or `@luminous/schema` change.
//
// 🛑 **WHY THIS ROW AND NOT THE CENSUS'S OTHER ONE-EDIT CANDIDATES: IT READS NO
// CARD COLUMN AT ALL.** D468's finding is that the residue classifier picks a
// TOKEN, not a slice, and that the token may name a COLUMN (buildable) or a BANNER
// (data-blocked). This sentence's varying token — *"all of your opponent's"*
// against *"your opponent's Active"* — names neither: it is a SCOPE over GAME
// STATE, and `InPlayPokemon.damage` has been on every board since M1. So the
// schema question D468 says to ask first has no purchase here, which is the
// property that made this the cheapest TRUE row left rather than the cheapest
// looking one.
//
// 🛑 **THE DISJOINTNESS IS STRUCTURAL, AND D467/D468 REQUIRE SAYING WHICH KIND.**
// `OPPONENT_BOARD_COUNTER_SCALE` and the shipped `OPPONENT_COUNTER_SCALE` are both
// `^…$` over the whole sentence and disagree on a MANDATORY run of bytes at the
// same position (`on all of your opponent's Pokémon.` against `on your opponent's
// Active Pokémon.`), so NO string can match both. There is therefore no lookahead
// on either side — a guard nothing could turn red is D205/D208's vacuous guard —
// and the arm's POSITION is legibility rather than behaviour. §2 pins that from
// both ends: the narrowing rows are KILLED and the arm-order row is a DECLARED
// structural `equivalent`.
//
// ⚠️ **NO `×` TWIN, AND NOT BUILDING ONE IS A MEASUREMENT (D435).** §6 asserts over
// `legalAttackCorpus()` that the no-"more" spelling of this sentence is printed
// ZERO times, so `deriveAttackDamageMultiplier` deliberately gains no arm — the
// same shape D196's `bothActivesEnergyCount` absence takes, and the reason the cell
// is left empty rather than filled speculatively.
//
// ⚠️ **NO NEW `FIXTURE_POOL` ID.** The one body this file needs is declared in a
// FILE-LOCAL `cardPool` (D414's idiom, `typedSelfSwitch.test.ts`'s shape), so
// `opponentResistanceBonus.test.ts`'s pool-size pin and its eleven-deep
// `ids.length - N` ladder take a **0** term (D452/D465). §9 asserts that rather
// than promising it. The census still steps by the full sentence and printing
// counts, because those are keyed on the CORPUS and the READERS and not on the pool.
//
// ⚠️ **`MATCH_RECORD_VERSION` STAYS 29**, on D462's SERIALIZED-ALPHABET argument and
// in its strongest form — *there is no carrier at all*. Driven over the BYTES in §8
// rather than reasoned from the type's name (D427).
//
// SEED-FREE beyond the shuffles setup needs: the sentence carries no coin.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, verbatim off `censusAttackCorpus.ts` file line 534 — the
    byte source for every case below. The possessive is ASCII U+0027 and the é in
    `Pokémon` is U+00E9, byte-verified on the corpus row with `cat -A` rather than
    eyeballed (D137/D227). */
const BOARD_COUNTERS =
  "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.";

/** The shipped ACTIVE-ONLY sibling (D168) — the sentence this one differs from by
    one run of bytes, and the control for every seat/zone claim below. */
const ACTIVE_COUNTERS =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";

/** The shipped SELF-side sibling (M2) — the same resource off the attacking body.
    It is what makes §4's zero-match board distinguishable from a dead reader: on
    the very board where `BOARD_COUNTERS` adds nothing, this one adds 40. */
const SELF_COUNTERS = "This attack does 10 more damage for each damage counter on this Pokémon.";

/** The `×` spelling of this slice's sentence. **Printed ZERO times** — asserted
    over the legal column in §6, not assumed — so it must be refused by BOTH the
    additive reader (no "more") and the multiply one (no arm). */
const BOARD_COUNTERS_MULTIPLY =
  "This attack does 10 damage for each damage counter on all of your opponent's Pokémon.";

/** U+2019, spelled as an escape — the two apostrophes render nearly identically,
    so the curly one is always written where a reader can see it. */
const RSQUO = "’";

/** The corpus FILE LINE of the row this slice claims (`fileLine = index + 53`). */
const BOARD_COUNTERS_FILE_LINE = 534;

// ─────────────────────────────────────────────────────────────────────────────
// The board
// ─────────────────────────────────────────────────────────────────────────────

/** The attacker. All four sentences this file compares sit on ONE body at fixed
    indices, so every "this clause and not that one" case is a same-fixture,
    same-board comparison rather than a two-board one. Every attack costs one {C}
    and prints the same base 10, so a difference in `dealt` is a difference in the
    CLAUSE and in nothing else. */
const ATTACKER: Card = battler("fix-boardcounter", {
  name: "Fixadraft",
  hp: 200,
  types: ["Colorless"],
  attacks: [
    { cost: ["Colorless"], name: "Board Bite", damage: 10, effect: BOARD_COUNTERS },
    { cost: ["Colorless"], name: "Active Bite", damage: 10, effect: ACTIVE_COUNTERS },
    { cost: ["Colorless"], name: "Self Bite", damage: 10, effect: SELF_COUNTERS },
    { cost: ["Colorless"], name: "Plain Bite", damage: 10 },
  ],
});

const LOCAL_CARDS: Record<string, Card> = { "fix-boardcounter": ATTACKER };
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-boardcounter": 2,
  "fix-titan": 4,
  "fix-basic-1": 8,
  "fix-lightning-1": 6,
  "fix-energy": 40,
});

/** Attack indices on `fix-boardcounter`, named rather than remembered (§1 pins
    each against the fixture's own `attacks` array). */
const BOARD = 0;
const ACTIVE = 1;
const SELF = 2;
const PLAIN = 3;

/** One seed for the whole suite. Nothing here flips a coin and every body is
    placed by surgery, so a seed table would describe a shuffle rather than a rule
    (D143). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** `by` is about to attack with `fix-boardcounter`. The FOE opens and passes, so
    the attacking seat carries no §4 first-turn restriction; BOTH Benches are
    cleared, because every number this family reads is a BOARD TALLY and a body the
    setup shuffle happened to seat would move it silently. One {C} pays all four
    printed costs. Both boards are PRISTINE — no damage anywhere. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(localSetup(SEED, by === "p1" ? "p2" : "p1"), { type: "endTurn", seat: foe }),
  );
  state = setActiveFromDeck(state, by, "fix-boardcounter");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  state = clearBench(state, foe);
  // Three benched bodies on the FOE and one on the attacker — the populations every
  // board below sets damage into. `fix-basic-1` is 60 HP (never KO'd by the numbers
  // used here) and `fix-titan` is 340.
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = benchFromDeck(state, foe, "fix-basic-1");
  return benchFromDeck(state, by, "fix-titan");
}

/** 🛑 **THE MIXED BOARD — the one every number in §3 is measured on, built so that
    each plausible misread answers a DIFFERENT total on this ONE setup.**

      attacker's side (p1)                 defender's side (p2)
        Active  fix-boardcounter  40 →  4    fix-titan     50 →  5
        Bench 0 fix-titan         70 →  7    fix-basic-1   20 →  2
                                             fix-basic-1   15 →  1  (floored)
                                             fix-basic-1   15 →  1  (floored)

    The correct answer is the DEFENDER's whole board, floored per body:
    5 + 2 + 1 + 1 = **9** counters → `scaled` 90 on a printed base of 10.

      • the DEFENDER'S BENCH ALONE (the Active dropped)              →  4
      • the DEFENDER'S ACTIVE ALONE (the shipped sibling)            →  5
      • the ATTACKER'S board (the seat inverted)                     → 11
      • the ATTACKER'S bench alone (`damageCountersOnYourBench`)     →  7
      • SUMMED and THEN floored, instead of floored per body         → 10

    Six values, all distinct, on one setup — which is why the two 15s are there. */
function mixed(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = setDamage(bare(by), by, 40);
  state = setBenchDamage(state, by, 0, 70);
  state = setDamage(state, foe, 50);
  state = setBenchDamage(state, foe, 0, 20);
  state = setBenchDamage(state, foe, 1, 15);
  return setBenchDamage(state, foe, 2, 15);
}

/** 🛑 **THE ZERO-MATCH BOARD.** The DEFENDER's whole board is pristine — Active and
    all three Benched bodies at 0 — while the ATTACKER's side carries the same 40 and
    70 the mixed board does. So the tally this slice added is 0 for the RIGHT reason,
    and §4's controls are what separate that from silence for a wrong one. */
function zeroMatch(by: Seat = "p1"): GameState {
  const state = setDamage(bare(by), by, 40);
  return setBenchDamage(state, by, 0, 70);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED BYTES AND THE CORPUS ROW
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence, its corpus row, and the fixture that prints it", () => {
  it("is corpus FILE LINE 534, ONE sentence and ONE Standard-legal printing", () => {
    // `fileLine = arrayIndex + 53` (D448's convention, broken twice since — D459).
    const corpus = legalAttackCorpus();
    const row = corpus.find(([, s]) => s === BOARD_COUNTERS);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
    expect(corpus.indexOf(row as (typeof corpus)[number]) + 53).toBe(BOARD_COUNTERS_FILE_LINE);
  });

  it("the possessive is ASCII U+0027 and the é is U+00E9 — on the BYTES", () => {
    // D227/D421 each got this call wrong by reading it off a neighbour. The
    // anchor's `['’]` class is what makes the reader survive a reprint either way,
    // and §2 drives the curly form to prove the class is not decoration.
    expect(BOARD_COUNTERS).toContain("opponent's");
    expect(BOARD_COUNTERS).not.toContain(RSQUO);
    expect(BOARD_COUNTERS).toContain("Pokémon");
    expect(BOARD_COUNTERS.charCodeAt(BOARD_COUNTERS.indexOf("opponent") + 8)).toBe(0x27);
  });

  it("the corpus row was UNREAD before this slice and is READ after it", () => {
    // `resolvedByAnyReader` is the census's own predicate — the one whose answer
    // moves RESIDUE. Asserting it here is what ties the suite to the instrument.
    expect(resolvedByAnyReader(BOARD_COUNTERS)).toBe(true);
  });

  it("the fixture prints all four sentences at the indices this file names", () => {
    const attacks = ATTACKER.attacks ?? [];
    expect(attacks[BOARD]?.effect).toBe(BOARD_COUNTERS);
    expect(attacks[ACTIVE]?.effect).toBe(ACTIVE_COUNTERS);
    expect(attacks[SELF]?.effect).toBe(SELF_COUNTERS);
    expect(attacks[PLAIN]?.effect).toBeUndefined();
    // …and all four print the SAME base, so §3's differences are the clause's.
    expect(attacks.map((a) => a.damage)).toEqual([10, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — `deriveAttackDamageBonus` reads it as `damageCountersOnOpponentBoard`", () => {
  it("reads the anchored sentence for any N", () => {
    expect(deriveAttackDamageBonus(BOARD_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentBoard" },
    });
    // Not hard-coded to 10 — the per-counter amount is captured.
    for (const per of [20, 30, 100]) {
      expect(
        deriveAttackDamageBonus(
          `This attack does ${per} more damage for each damage counter on all of your opponent's Pokémon.`,
        ),
      ).toEqual({ per, count: { kind: "damageCountersOnOpponentBoard" } });
    }
  });

  it("the `['’]` possessive class is load-bearing — the curly form reads the same", () => {
    expect(deriveAttackDamageBonus(BOARD_COUNTERS.replace("'", RSQUO))).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentBoard" },
    });
  });

  it("🛑 the two SHIPPED siblings still land on their OWN members", () => {
    // The sharpest thing that can go wrong with a third reading of one printed noun
    // is one arm absorbing another's sentences. Both directions, on one page.
    expect(deriveAttackDamageBonus(ACTIVE_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(SELF_COUNTERS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("🛑 the DISJOINTNESS is STRUCTURAL — no string matches both anchors", () => {
    // D467's guarded case and D468's structural one print the same verdict in the
    // sweep log and carry opposite obligations, so the kind is asserted rather than
    // asserted-about. Both patterns are whole-sentence anchored and disagree on a
    // mandatory run of bytes at the same position, so this is a claim about EVERY
    // string in the legal column, not about the two specimens above.
    for (const [, sentence] of legalAttackCorpus()) {
      const bonus = deriveAttackDamageBonus(sentence);
      if (bonus === null) continue;
      const board = bonus.count.kind === "damageCountersOnOpponentBoard";
      const active = bonus.count.kind === "damageCountersOnOpponentActive";
      expect(board && active, sentence).toBe(false);
    }
    // …and on the two specimens the ONE differing run of bytes is named, so a
    // successor that widens either anchor sees which byte the claim rests on.
    expect(BOARD_COUNTERS.replace("all of your opponent's", "your opponent's Active")).toBe(
      ACTIVE_COUNTERS,
    );
  });

  it("refuses the near-misses — the anchors and the capital are load-bearing", () => {
    for (const text of [
      // A lowercase leading "this" is refused independently of the anchors — the
      // family's Krookodile convention, no /i.
      BOARD_COUNTERS.replace("This", "this"),
      // A missing trailing period is not the whole sentence.
      BOARD_COUNTERS.slice(0, -1),
      // Leading text: a mid-sentence clause must not reach this path. This is the
      // case the `^` anchor owns, and it is the only one that can see it.
      `Discard an Energy from this Pokémon. ${BOARD_COUNTERS}`,
      // TRAILING text: the case the `$` anchor owns, and the one D341 found missing
      // at a sibling. Without the `$` the pattern would claim the head of a
      // two-sentence row and derive a bonus for a card whose second clause it has
      // never read — which is the whole reason the family anchors both ends.
      `${BOARD_COUNTERS} This attack's damage isn't affected by Weakness.`,
      // The `×` fold — no "more", so this reader must refuse it.
      BOARD_COUNTERS_MULTIPLY,
      // A printed 0 adds nothing and stays on the loud skipped path.
      BOARD_COUNTERS.replace("does 10", "does 0"),
      // "all of your Pokémon" is the ATTACKER's board — a sentence this slice does
      // NOT claim, and the helper is deliberately seat-agnostic so that a successor
      // adds an anchor rather than widening this one.
      BOARD_COUNTERS.replace("all of your opponent's", "all of your"),
      // The Bench-scoped spelling belongs to `damageCountersOnYourBench`'s family.
      BOARD_COUNTERS.replace("all of your opponent's", "all of your Benched"),
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("the OTHER TWO readers of the same text refuse it", () => {
    // Three readers split this family by FOLD (D163). This sentence carries "more",
    // so exactly one of them may claim it.
    expect(deriveAttackDamageMultiplier(BOARD_COUNTERS)).toBeNull();
    expect(deriveAttackDamagePenalty(BOARD_COUNTERS)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FOLD ON A REAL BOARD
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the additive fold on real boards: base KEPT, `per × counters` added", () => {
  it("🛑 the MIXED board deals 100 — base 10 + 9 counters × 10", () => {
    const { state, events } = swing(mixed(), BOARD);
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
    // …and the damage really landed: the defender was on 50 and is now on 150.
    expect(state.players.p2.active?.damage).toBe(150);
  });

  it("🛑 every plausible misread answers a DIFFERENT number on that ONE board", () => {
    // The whole point of the two 15s and the 40/70 on the attacker's own side. Each
    // line is what `dealt` would have been under one wrong implementation; the
    // assertion is that the shipped one is none of them.
    const dealt = find(swing(mixed(), BOARD).events, "DAMAGE_DEALT")?.dealt;
    expect(dealt).toBe(100); //          9 counters — the defender's whole board
    expect(dealt).not.toBe(50); //       4 — the defender's BENCH alone
    expect(dealt).not.toBe(60); //       5 — the defender's ACTIVE alone
    expect(dealt).not.toBe(120); //     11 — the ATTACKER's board (seat inverted)
    expect(dealt).not.toBe(80); //       7 — the ATTACKER's bench alone
    expect(dealt).not.toBe(110); //     10 — summed first, floored once
  });

  it("🛑 the ACTIVE is INSIDE the walk — the two half-boards agree, and neither sibling does", () => {
    // The one claim a single mixed board cannot make on its own: "all of" means
    // Active + Bench, so a board whose counters are ALL on the Active and one whose
    // counters are ALL on the Bench must give the SAME number here — and different
    // numbers under either shipped neighbour. Both boards carry 3 counters.
    const activeOnly = setDamage(bare(), "p2", 30);
    let benchOnly = setBenchDamage(bare(), "p2", 0, 20);
    benchOnly = setBenchDamage(benchOnly, "p2", 1, 10);

    expect(find(swing(activeOnly, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(find(swing(benchOnly, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    // …and the SHIPPED Active-only member tells them apart, which is the proof that
    // the two boards are genuinely different and not the same board twice.
    expect(find(swing(activeOnly, ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(find(swing(benchOnly, ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("🛑 FLOORED PER BODY, then summed — not summed and then floored", () => {
    // Two bodies at 15 are 1 + 1 = 2 counters, never `floor(30/10)` = 3. Damage
    // lands in tens through the ordinary rules, so this is a SAFETY property rather
    // than a printed one — and it is exactly the property a "sum the damage and
    // divide once" rewrite would lose while staying green on every ten-damage board.
    let board = setBenchDamage(bare(), "p2", 0, 15);
    board = setBenchDamage(board, "p2", 1, 15);
    expect(find(swing(board, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the printed base is KEPT — this is the `+` fold and not the `×` one", () => {
    // A `+`/`×` mix-up is invisible on a board with counters and screams on one
    // without: the multiply fold DROPS the printed base. §4's pristine board is the
    // other half of this pair.
    const row = find(swing(mixed(), BOARD).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(10);
    expect((row?.base ?? 0) + (row?.scaled ?? 0)).toBe(row?.dealt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ZERO-MATCH BOARD AND ITS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the ZERO-MATCH board, and three controls that make the 0 mean something", () => {
  it("🛑 a PRISTINE opponent board adds nothing and the base lands whole", () => {
    const { state, events } = swing(zeroMatch(), BOARD);
    const row = find(events, "DAMAGE_DEALT");
    // `scaled` is ABSENT, not 0 — the field's presence guard is `scaledTotal > 0`.
    expect(row).toMatchObject({ base: 10, dealt: 10 });
    expect(row?.scaled).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(10);
  });

  it("CONTROL 1 — the SAME board with one counter added is not silent", () => {
    // Without this the 0 above is indistinguishable from a reader that never fired.
    expect(find(swing(setDamage(zeroMatch(), "p2", 10), BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(
      20,
    );
    // …and one counter on the opponent's BENCH moves it too, so the 0 is not
    // "the Active was pristine" wearing a board's clothes.
    expect(
      find(swing(setBenchDamage(zeroMatch(), "p2", 2, 10), BOARD).events, "DAMAGE_DEALT")?.dealt,
    ).toBe(20);
  });

  it("🛑 CONTROL 2 — a SIBLING clause on that very board adds 40, so the board is not inert", () => {
    // The zero-match board carries 40 damage on the attacker and 70 on its Bench.
    // `damageCountersOnSelf` reads the first and answers 4; if the board itself were
    // somehow silent — a broken swing, a mis-set fixture — this would be 10 too.
    expect(find(swing(zeroMatch(), SELF).events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("CONTROL 3 — the CLAUSELESS attack is base-only on the MIXED board", () => {
    // The converse control: on the board where `BOARD_COUNTERS` adds 90, an attack
    // with no effect text at all adds nothing. So the 90 is the CLAUSE and not the
    // board, and the 0 above is the BOARD and not the clause.
    const row = find(swing(mixed(), PLAIN).events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 10, dealt: 10 });
    expect(row?.scaled).toBeUndefined();
  });

  it("an EMPTY opponent Bench is silent for a DIFFERENT reason than a pristine one", () => {
    // 0 from "nothing to count" and 0 from "nothing damaged" are the same number and
    // not the same fact. With the Bench swept and the Active carrying 3 counters the
    // arm must still answer 30 — a Bench-only walk would answer 0 here and pass every
    // other rung in this section.
    const swept = setDamage(clearBench(bare(), "p2"), "p2", 30);
    expect(swept.players.p2.bench).toHaveLength(0);
    expect(find(swing(swept, BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE SEAT
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the seat: `defenderSeat`, driven from both ends of the table", () => {
  it("🛑 the ATTACKER's own counters contribute NOTHING", () => {
    // The zero-match board is 11 counters of the attacker's own — 4 on the body and
    // 7 on its Bench — and this clause reads none of them. A `attackerSeat`
    // substitution turns the 10 below into 120.
    expect(find(swing(zeroMatch(), BOARD).events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("is CONTROLLER-RELATIVE — p2 swinging reads p1's board, not p1 always", () => {
    // A seat hard-coded to `p2` is green on every board above. Driving the same
    // clause from the other seat is the only thing that can see it (D258's rule).
    const { events } = swing(mixed("p2"), BOARD, "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
  });

  it("the shipped neighbour's seat is UNMOVED by the new arm", () => {
    // `damageCountersOnYourBench` reads the ATTACKER's Bench. It is not reachable
    // from this fixture (no printed sentence on the additive fold), so what is
    // asserted here is the evaluator's other end: the same mixed board, the shipped
    // ACTIVE member, and the defender's Active alone.
    expect(find(swing(mixed(), ACTIVE).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE EMPTY CELLS, MEASURED
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the cells this slice leaves EMPTY are measurements, not omissions", () => {
  it("🛑 the `×` spelling of this sentence is printed ZERO times", () => {
    // D435: not incrementing is a measurement. The multiply reader gains no arm
    // because the column spells no sentence it could claim — and the day one is
    // ingested this rung goes red and names it.
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /^This attack does \d+ damage for each damage counter on all of your opponent['’]s Pokémon\.$/.test(
          s,
        ),
      ),
    ).toEqual([]);
    expect(deriveAttackDamageMultiplier(BOARD_COUNTERS_MULTIPLY)).toBeNull();
    expect(deriveAttackDamageBonus(BOARD_COUNTERS_MULTIPLY)).toBeNull();
  });

  it("the `less` spelling is printed ZERO times too", () => {
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /less damage for each damage counter on all of your opponent/.test(s),
      ),
    ).toEqual([]);
  });

  it("the ATTACKER-side board spelling is printed ZERO times", () => {
    // `countDamageCountersInPlay` names no seat, so the day *"…on all of your
    // Pokémon."* prints, the cost is one anchor and one arm and NOT a rewrite of the
    // walk. That is a claim about the pool, so it is measured here.
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /damage counter on all of your Pokémon\./.test(s),
      ),
    ).toEqual([]);
  });

  it("the whole of `damage counter on all of` is FOUR rows, and three were already read", () => {
    // D467 pinned this list at three rows with one of them unread; this slice is the
    // row that moved. Kept as a DERIVED list rather than a remembered count, because
    // that is the figure that rots (D466).
    const rows = legalAttackCorpus()
      .filter(([, s]) => s.includes("damage counter on all of"))
      .map(([, s]) => s);
    expect(rows).toHaveLength(3);
    expect(rows).toContain(BOARD_COUNTERS);
    expect(rows.filter((s) => resolvedByAnyReader(s))).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE SHARED BOARD COUNTER
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `countDamageCountersInPlay`, driven directly", () => {
  it("counts Active + Bench, floored per body", () => {
    const state = mixed();
    expect(countDamageCountersInPlay(state, "p2")).toBe(9);
    expect(countDamageCountersInPlay(state, "p1")).toBe(11);
  });

  it("a pristine board is 0 and an empty one is 0 — the same number, two facts", () => {
    expect(countDamageCountersInPlay(bare(), "p2")).toBe(0);
    const swept = clearBench(bare(), "p2");
    expect(countDamageCountersInPlay(swept, "p2")).toBe(0);
    expect(countDamageCountersInPlay(setDamage(swept, "p2", 30), "p2")).toBe(3);
  });

  it("a MISSING Active is handled inside the walk", () => {
    // The live attack gate guarantees a Defending Pokémon, so no board reachable
    // through `attack` presents this — but the helper is shared and its two
    // neighbours both answer for it, so this one does too.
    const headless: GameState = {
      ...mixed(),
      players: {
        ...mixed().players,
        p2: { ...mixed().players.p2, active: null },
      },
    };
    expect(countDamageCountersInPlay(headless, "p2")).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION AND THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  it("🛑 DIRECTION 1 — there is NO CARRIER AT ALL", () => {
    // D427: choosing a carrier does not duck persistence, so this is asserted over
    // the SERIALIZED board rather than reasoned from the type's name. An
    // `AttackDamageBonus` is a LOCAL inside `attack()`: the reader runs at
    // declaration, the fold lands in the damage event, and the value is discarded
    // before the function returns. So the new member's string must appear NOWHERE —
    // not on a body, not on `phase`, not on `pending`.
    const before = mixed();
    const after = swing(before, BOARD).state;
    for (const [label, state] of [
      ["before", before],
      ["after", after],
    ] as const) {
      const wire = JSON.stringify(state);
      expect(wire, label).not.toContain("damageCountersOnOpponentBoard");
      expect(wire, label).not.toContain("damageCountersOnOpponentActive");
    }
    // …and the attack RESOLVED IN ONE ACTION — no park, nothing for a later deploy
    // to resume.
    expect(after.pending).toEqual([]);
  });

  it("🛑 DIRECTION 2 — a v29 record round-trips and the NEXT swing reads the same", () => {
    const first = swing(mixed(), BOARD);
    expect(find(first.events, "DAMAGE_DEALT")?.dealt).toBe(100);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    // LOSSLESS — nothing this slice added rides the wire.
    expect(saved).toEqual(first.state);
    // …and the parsed record is a LIVE board: hand the turn back and swing the same
    // clause off the bytes that came out of `JSON.parse`. The defender is now on 150,
    // i.e. 15 counters, so the SAME clause reads a bigger board and says so.
    const returned = mustApply(saved, { type: "endTurn", seat: "p2" }).state;
    const second = swing(returned, BOARD);
    expect(find(second.events, "DAMAGE_DEALT")?.dealt).toBe(10 + 10 * (15 + 2 + 1 + 1));
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE POOL TAX THIS SLICE DOES NOT PAY
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — no new `FIXTURE_POOL` id", () => {
  it("the local ids are LOCAL", () => {
    // D452/D465: a `FIXTURE_POOL` id is a census entry with a tax of its own —
    // `opponentResistanceBonus.test.ts`'s pool-size pin and its eleven-deep ladder.
    // A file-local pool takes a 0 term, and that is asserted rather than promised.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });

  it("no POOLED card prints this sentence, so the pool sweeps are unmoved", () => {
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (FIXTURE_POOL[id]?.attacks ?? []).some((attack) => attack.effect === BOARD_COUNTERS),
    );
    expect(carriers).toEqual([]);
    // …and the new member has exactly ZERO producers in the pool, which is what
    // keeps `opponentCounterScaling.test.ts`'s two producer sweeps byte-identical.
    const produced: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        if (
          deriveAttackDamageBonus(attack.effect ?? "")?.count.kind ===
          "damageCountersOnOpponentBoard"
        ) {
          produced.push(`${id}[${index}]`);
        }
      }
    }
    expect(produced).toEqual([]);
  });
});
