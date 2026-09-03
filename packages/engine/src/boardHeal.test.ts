import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  BOARD_HEAL_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// 0.83.0 → 0.84.0 — the OWN-BOARD HEAL sentence (D133). "Heal {N} damage from each
// of your Pokémon." — 7 printings / 2 distinct clauses on ONE anchored regex and ONE
// deriver arm, with NO interpreter diff at all.
//
// D132 A SECOND TIME, AND THAT IS THE POINT. `healEach` has shipped since 0.x,
// produced by Garganacl's between-turns "Blessed Salt" Ability; what was missing was
// a reader for the same action printed as an ATTACK. The inventory rule (D132 — ask
// what an existing arm already emits before pricing a shape) found this one the same
// way it found the bare self-heal, and it cost the same: one regex, one arm, zero
// mechanism.
//
// WHAT IS ACTUALLY NEW HERE, and why the suite is not a copy of selfHeal.test.ts:
//   • THE READING OF "EACH OF YOUR POKÉMON". It is the Active AND the whole Bench
//     (§1.1 — the Active is one of your Pokémon; only the printed word "Benched"
//     would exclude it). `healEach` was already written that way, but it had only
//     ever been reached from a CHECKUP trigger — never from an attack, where the
//     Active is the ATTACKER. So the reading is asserted end to end rather than
//     inherited from the op's doc comment.
//   • THE PER-POKÉMON CLAMP. Each body's heal is bounded by its OWN damage, so a
//     board of {100, 80, 10} heals {30, 30, 10} off one printed 30. A shared clamp,
//     or a clamp read off the Active, passes a one-body board and fails here.
//   • THE SEAT SCOPE, which is the boundary against `healEachAll` (Picnic Basket's
//     "each Pokémon (both yours and your opponent's)"). The opponent's board is
//     DAMAGED in the end-to-end case precisely so it can be asserted unhealed.
//   • THE SILENT WHIFF, PER POKÉMON. An undamaged body in the middle of a damaged
//     board emits NO row — the count of HEALED rows is the count of Pokémon that
//     actually moved, not the count of Pokémon on the board.
//   • THE WITH- AND NO-DAMAGE HALVES, as ever: Skeledirge ex heals 30 across the
//     board WHILE dealing 50, Cresselia heals 20 and does nothing else.
//   • NO RNG, NO PARK, NO REGISTRY ROW.

/** The two distinct clauses of the pool, verbatim, and the op each derives to.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string, 7
    printings in all: this is the whole mapped set and nothing else in the pool
    prints the shape. Every printing is a STANDALONE single sentence — the compound
    check D131 established was run and came back clean. */
const CLAUSES = [
  {
    text: "Heal 30 damage from each of your Pokémon.",
    op: { op: "healEach", amount: 30 },
    // Skeledirge ex sv02-037 / -233 / -258 / -272 ("Vitality Song", 50 — the fixture
    // this suite drives) + Steenee sv03-017 ("Aromatherapy", no damage).
    printings: 5,
  },
  {
    text: "Heal 20 damage from each of your Pokémon.",
    op: { op: "healEach", amount: 20 },
    // Cresselia sv06.5-021 / -071 ("Healing Pirouette", no damage — the other fixture
    // this suite drives).
    printings: 2,
  },
] as const;

/** The real catalog rows this anchor must refuse, verbatim off the local D1. Every
    one contains the mapped words; not one is the mapped sentence:
      • Nacli sv02-121 / -220 "Salt Coating" — a CHOSEN target rather than the board.
        (SIMULATED SINCE 0.86.0 by `CHOSEN_HEAL` — D135. It keeps its case: the claim
        here never was "unmapped", it is that a chosen target is not the board.)
      • Tropius sv01-007 "Fresh-Picked Fruit" — a chosen BENCHED target. (SAME, 0.86.0:
        the zone filter `healEach` still does not have is now a FIELD on the op that
        does the choosing, which is the whole difference between the two sentences.)
      • Blissey swsh10.5-052 / Arboliva sv03-021 — a chosen Benched target healed for
        "all". THE AMOUNT IS NOT A NUMBER, which is the half this arm could not carry
        even if the target matched: `healEach`'s `amount` is a number, and that is
        still true at 0.86.0 — `healChosen`'s has taken `number | "all"` since 0.x.
      • Fuecoco sv02-035 / -201 — a SELF heal gated behind a flip. Neighbouring
        family, SIMULATED SINCE 0.85.0 by `FLIP_SELF_HEAL` (D134) — so it is refused
        here for TWO reasons at once (wrong target, wrong anchor) and its case moves
        out of the null loop below.
      • 🆕🆕 **BUILT AT D427.** This bullet named Iron Moth sv06.5-009 "Suction" — *"an
        amount read off the damage just dealt"* — which is exactly what D427 built. The
        slot is RE-POINTED (see the comment on the list entry) rather than emptied.
      • Saguaro sv02-187 / -255 / -270 — THE DANGEROUS ONE. It prints "…and heal 50
        damage from each of them.": the mapped words, mid-sentence, behind a CHOICE
        of up to 2 Pokémon. A reader without `^` would take its tail and heal the
        whole board unconditionally. (It is a Supporter and never reaches this
        deriver in production — which is exactly why the guard is asserted here
        rather than left to routing.)
      • Picnic Basket sv01-184 — "each Pokémon (both yours and your opponent's)",
        the `healEachAll` sentence. The SEAT boundary, in text form.

    STANDING NOTE: when a later slice maps one of these, RE-POINT the case at another
    still-unmapped clause — never delete it. The suite's claim is that an unread
    sentence stays LOUD, and that claim needs a live witness to keep being about
    anything. */
const REAL_NEAR_MISSES = [
  "Heal 20 damage from 1 of your Pokémon.",
  "Heal 60 damage from 1 of your Benched Pokémon.",
  "Heal all damage from 1 of your Benched Pokémon.",
  "Flip a coin. If heads, heal 30 damage from this Pokémon.",
  // 🆕🆕 RE-POINTED AT D461 (0.359.0 → 0.360.0), FOR THE SECOND TIME. This slot held
  // *"Heal from this Pokémon the same amount of damage you did to your opponent's Active
  // Pokémon."* until D427 BUILT it, then *"Heal 100 damage from each of your **Basic**
  // Pokémon."* until **D461 BUILT THAT TOO** (2 legal printings, corpus file line 273;
  // `deriveAttackEffect` arm 17b over `healEach.basicOnly`). Re-pointed rather than
  // deleted, per the STANDING NOTE above, onto the one row of the printed heal family
  // that is STILL refused by every reader — and refused for a reason no arm can fix:
  // the banner `Ancient` is in NO column of the persisted catalog (`PREVENT_DAMAGE_FROM_CLASS`,
  // re-read at D439/D451/D461), so the falsifier is an INGEST change. It is a NEARER
  // miss for this anchor than either predecessor on the zone word and a FARTHER one on
  // the determiner, which is exactly the pair of axes this anchor is anchored against.
  // 1 legal printing, corpus file line 272.
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  "Heal 30 damage from each Pokémon (both yours and your opponent's).",
] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. Byte-different from an ASCII
    space and INVISIBLE in a diff, which is exactly why the case names it instead of
    carrying it — a re-ingest that swapped one in would un-simulate five printings
    with nothing on screen to see. */
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

/** Both fixtures print the board heal FIRST and an unmapped clause from another
    family second. Named rather than inlined, so a re-ingest that reordered an attack
    fails on the fixture guards below rather than silently moving every board case
    onto the wrong sentence. */
const VITALITY_SONG_INDEX = 0;
const HEALING_PIROUETTE_INDEX = 0;
const CRESCENT_PURGE_INDEX = 1;

/** The two heal amounts and the one printed damage. They are two different N
    precisely so that a hardcoded amount somewhere downstream cannot satisfy both. */
const VITALITY_SONG_HEAL = 30;
const VITALITY_SONG_DAMAGE = 50;
const HEALING_PIROUETTE_HEAL = 20;

/** The damaged-board figures every delta is stated in terms of. The THREE are
    deliberately different from each other and straddle both heal amounts, which is
    what makes the per-Pokémon clamp visible: 100 and 80 are unclamped by either N,
    and 10 is clamped by both. A board where every body carried the same damage would
    pass under a clamp read once off the Active. */
const ACTIVE_HURT = 100;
const BENCH_HURT = 80;
/** LESS than either printed N — the clamped body. */
const BENCH_BARELY_HURT = 10;
/** The opponent's damage, on a board that must come back UNCHANGED. Distinct from
    every own-side figure so a mixed-up seat cannot land on a number that happens to
    be right. */
const OPPONENT_HURT = 70;

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account.

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery, then the attacker is replaced per case:
    Vitality Song's 50 cannot come near KOing a titan, so no promotion can park
    mid-batch and truncate a row sequence, and no defender attack can interleave rows
    with the ones being counted.

    ⚠️ AND BOTH BENCHES ARE EMPTIED, which is not housekeeping — it is the difference
    between this suite and every heal suite before it. `setActiveFromDeck` DISPLACES
    the Active it replaces onto the bench, so each surgery leaves a benched body
    behind; a file that only asserts the Active never notices, and a file whose whole
    claim is about the SIDE would count strangers. Every benched body below is put
    there by a case, on purpose, with a damage figure that case chose. */
function board(): GameState {
  let state = driveSetup(7, { p1: BOARD_HEAL_DECK, p2: BOARD_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Skeledirge ex Active with Vitality Song's single {R} paid, carrying `damage` HP.
    SURGERY on both counts: it is a STAGE 2 (Fuecoco → Crocalor → Skeledirge) and
    could never be dealt as an opening Active, and the damage arrives by `setDamage`
    rather than by scripting the attacks that would place it. */
function skeledirgeActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-037"), seat),
    seat,
    "fix-fire-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

/** Cresselia Active with Healing Pirouette's single {P} paid, carrying `damage` HP.
    A Basic, so `setActiveFromDeck` is a convenience here rather than a necessity —
    but the board is kept the same shape as Skeledirge's on purpose. */
function cresseliaActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv06.5-021"), seat),
    seat,
    "fix-psychic-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

/** Bench `damages.length` titans on `seat` and set each one's damage. fix-titan is
    the body for the reason the deck comment gives: 340 HP carries any figure a case
    wants without the attack epilogue's KO sweep removing it from under the
    assertion mid-count. */
function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

describe("the anchor — 7 printings, 2 clauses, one sentence", () => {
  it("derives both distinct clauses the pool prints, to the SAME single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    // THE CENSUS, ASSERTED AS A SHAPE. 2 distinct clauses / 7 printings — the numbers
    // the slice claims and the numbers a re-census has to reproduce.
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(7);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    // Every row is ONE op, and the op is the SAME shape with one number varying.
    // That is the whole slice: the clause set differs in a digit and nothing else,
    // which is why it cost one regex and no new member.
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "healEach" });
    }
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    // A "Heal 0 damage" printing is not a real card and would derive to a whole
    // board's worth of silent no-ops: the attack would report a simulated effect and
    // move nothing, which is indistinguishable at the log from the all-whiffed case
    // below and means something completely different. Loud path.
    expect(deriveAttackEffect("Heal 0 damage from each of your Pokémon.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the interpreter CLAMPS PER
    // POKÉMON to the damage present, so a malformed large amount heals the board to
    // full and stops. That is a legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 999 },
    ]);
  });

  it("refuses the SEVEN real catalog rows that share its words", () => {
    for (const [index, text] of REAL_NEAR_MISSES.entries()) {
      // Indices 0–2 (the CHOSEN heals, mapped at 0.86.0 by `CHOSEN_HEAL` — D135) and
      // index 3 (Fuecoco's gated self-heal, 0.85.0 — D134) are all simulated by
      // ANOTHER arm of this same reader, so "derives to nothing" is no longer the
      // right claim for them — "does not derive to a BOARD heal" is, and it is the
      // claim this file always meant. Rows 4–6 are unmapped everywhere.
      //
      // FOUR OF SEVEN ROWS NOW LAND ON A NEIGHBOUR, which is what a family being
      // finished looks like from the inside. Per the standing note above they were
      // RE-POINTED rather than deleted, and each now makes a stronger claim than its
      // null did: a build where this arm's `each of your` loosened to `1 of your`
      // would fail here whether or not any other reader existed.
      if (index <= 3) {
        expect(deriveAttackEffect(text)).not.toContainEqual(
          expect.objectContaining({ op: "healEach" }),
        );
        continue;
      }
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // SAGUARO IS THE ONE THAT MATTERS. Its tail — "…and heal 50 damage from each of
    // them." — is the mapped action behind a choice of up to 2 Pokémon, and a reader
    // without `^` would take it and heal the whole board for free. Stated on its own
    // line rather than left inside the loop, because it is the reason the anchor is
    // anchored and not a merely-similar string.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[5])).toBeNull();
    // PICNIC BASKET is the SEAT boundary in text form: "each Pokémon (both yours and
    // your opponent's)" is `healEachAll`, a different op with a different blast
    // radius. This arm must not reach it — and the board case below asserts the same
    // boundary from the other side, on a damaged opponent that stays damaged.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[6])).toBeNull();
  });

  it("is DISJOINT from the bare self-heal — neither anchor can claim the other", () => {
    // Both are `^…$`-anchored on a differing middle, so the ordering of the two arms
    // in the deriver is immaterial — an invariant worth asserting rather than
    // arguing, since it is what keeps this family at one regex per sentence with no
    // dispatch table. Asserted in BOTH directions on the same N.
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 30 },
    ]);
    // And the two ops are genuinely different — a build that collapsed them would
    // pass every single-Pokémon board in either suite.
    expect(deriveAttackEffect("Heal 30 damage from each of your Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 30 damage from this Pokémon."),
    );
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 30 damage from each of your Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 30 damage from each of your Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Saguaro's tail is exactly that clause), and the reason no /i flag is
      // on this regex.
      "heal 30 damage from each of your Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Heal${NBSP}30 damage from each of your Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  30 damage from each of your Pokémon.",
      // THE OTHER SIDE. Healing the opponent's board is not a thing this arm can do,
      // and a reader that dropped the possessive would do it silently.
      "Heal 30 damage from each of your opponent's Pokémon.",
      // "all" for a number: a real printed amount (Blissey, Arboliva) that this op
      // cannot carry — `amount` is a number.
      "Heal all damage from each of your Pokémon.",
      // A LEADING RIDER sentence pins `^`, and this is not hypothetical: it is how a
      // gated or conditional printing arrives.
      "Flip a coin. If heads, heal 30 damage from each of your Pokémon.",
      "If this Pokémon is Burned, heal 30 damage from each of your Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for. No
      // pool printing extends these clauses today, which is precisely why the guard
      // is pinned now: the first one that does must land LOUDLY rather than
      // half-resolve, dropping a rider the engine never saw.
      "Heal 30 damage from each of your Pokémon. This Pokémon is now Asleep.",
      "Heal 30 damage from each of your Pokémon. Then, shuffle your deck.",
      // PLURAL DRIFT in the quantifier. "each" is the printed word; "all of your" and
      // "every" are not, and a reader that accepted them would be guessing at text
      // the ingest has never produced.
      "Heal 30 damage from all of your Pokémon.",
      "Heal 30 damage from every one of your Pokémon.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 3 damage counters from each of your Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // 🆕🆕 THE ZONE WORD MOVED OUT OF THAT LIST AT D461, AND THE COMMENT IT CARRIED
    // WAS FALSE BEFORE IT MOVED. It read *"nothing in the pool prints this spread form
    // at all today"* — and the pool prints it TWICE (corpus file line 274, *"Heal 100
    // damage from each of your Benched Pokémon."*, 2 legal printings). The rest of that
    // comment was right and is what D461 built: "Benched" EXCLUDES the Active (D120's
    // rule, honour the printed zone), so it is a different target — but it is the SAME
    // op with a rider rather than "a different op", which is the other half the old
    // comment guessed at. Corrected in place and dated (D423) rather than deleted.
    //
    // The claim this rung makes now is STRONGER than the null it replaces: the zone
    // word derives, and it derives to something that is NOT the unnarrowed board heal.
    // A build that let the narrowed anchor fall through to arm 17 passes a `toBeNull`
    // and fails here.
    expect(deriveAttackEffect("Heal 30 damage from each of your Benched Pokémon.")).toEqual([
      { op: "healEach", amount: 30, benchOnly: true },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from each of your Benched Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 30 damage from each of your Pokémon."),
    );
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 30 damage from each of your Pokémon.\n")).toEqual([
      { op: "healEach", amount: 30 },
    ]);
    expect(deriveAttackEffect("\tHeal 20 damage from each of your Pokémon. ")).toEqual([
      { op: "healEach", amount: 20 },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Skeledirge ex sv02-037", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here — including the printed 50,
    // which is what makes this the WITH-DAMAGE occupant of the slice.
    const vitalitySong = FIXTURE_POOL["sv02-037"]?.attacks?.[VITALITY_SONG_INDEX];
    expect(vitalitySong).toEqual({
      cost: ["Fire"],
      name: "Vitality Song",
      effect: "Heal 30 damage from each of your Pokémon.",
      damage: VITALITY_SONG_DAMAGE,
    });
    expect(deriveAttackEffect(vitalitySong?.effect ?? "")).toEqual([
      { op: "healEach", amount: VITALITY_SONG_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-037"]?.name).toBe("Skeledirge ex");
    // A STAGE 2, which is why every board below reaches it by surgery.
    expect(FIXTURE_POOL["sv02-037"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv02-037"]?.hp).toBe(340);
  });

  it("matches FIXTURE_POOL char-for-char for Cresselia sv06.5-021", () => {
    // The NO-DAMAGE half of the census, and the second clause — so a hardcoded 30
    // anywhere downstream cannot satisfy both fixtures.
    const pirouette = FIXTURE_POOL["sv06.5-021"]?.attacks?.[HEALING_PIROUETTE_INDEX];
    expect(pirouette).toEqual({
      cost: ["Psychic"],
      name: "Healing Pirouette",
      effect: "Heal 20 damage from each of your Pokémon.",
    });
    expect(FIXTURE_POOL["sv06.5-021"]?.name).toBe("Cresselia");
    expect(FIXTURE_POOL["sv06.5-021"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv06.5-021"]?.hp).toBe(120);
    expect(FIXTURE_POOL["sv06.5-021"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-021"]?.abilities).toBeNull();
    // "Healing Pirouette" prints NO `damage` field at all (not a zero, not an empty
    // string), so a mis-read has no number to land on: the board heal is the whole
    // visible result of the declaration.
    expect(pirouette?.damage).toBeUndefined();
    expect(deriveAttackEffect(pirouette?.effect ?? "")).toEqual([
      { op: "healEach", amount: HEALING_PIROUETTE_HEAL },
    ]);
  });
});

describe("end to end — Skeledirge ex 'Vitality Song' (heal 30 each, WITH a printed 50)", () => {
  it("heals the ACTIVE and EVERY benched body — and clamps each one separately", () => {
    // THE CLAIM OF THE WHOLE SLICE, on the board that makes it visible: three own
    // bodies carrying three different damage figures, two of which the printed 30
    // does not reach and one of which it overshoots.
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const attacker = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    // THE ACTIVE IS ONE OF YOUR POKÉMON (§1.1). This is the reading the slice adds —
    // `healEach` was written this way for a Checkup trigger, but from an ATTACK the
    // Active is the attacker, and a build that healed "the rest of the board" would
    // pass every bench assertion below and fail on this line alone.
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - VITALITY_SONG_HEAL);
    // THE PER-POKÉMON CLAMP. 10 damage takes 10 of the printed 30 and lands at 0 —
    // it does not go negative, and it does not consume the other bodies' heal.
    expect(done.players.p1.bench[1]?.damage).toBe(0);
    // ONE ROW PER BODY THAT MOVED, in the interpreter's order (Active, then bench by
    // index), each reporting what actually moved rather than what was printed.
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: benchA, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: benchB, amount: BENCH_BARELY_HURT },
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("leaves the OPPONENT's damaged board untouched — the healEachAll boundary", () => {
    // `healEach` is seat-scoped through `ctx.seat`; `healEachAll` (Picnic Basket) is
    // not. The distinction is invisible on an undamaged opponent, so the opponent is
    // DAMAGED here — Active and Bench both — and must come back at exactly the same
    // figures plus the printed 50 on the Active.
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", OPPONENT_HURT);
    state = benchTitans(state, "p2", [OPPONENT_HURT]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    // The opponent's ACTIVE gains the printed 50 and loses nothing.
    expect(done.players.p2.active?.damage).toBe(OPPONENT_HURT + VITALITY_SONG_DAMAGE);
    // The opponent's BENCH is not in the attack's path at all: no damage, no heal.
    expect(done.players.p2.bench[0]?.damage).toBe(OPPONENT_HURT);
    // Every HEALED row belongs to the attacker's seat, and there are exactly as many
    // as the attacker has damaged bodies (2).
    expect(all(events, "HEALED")).toHaveLength(2);
    for (const healed of all(events, "HEALED")) expect(healed.seat).toBe("p1");
    // Simulated, not skipped — and the printed damage landed, so the sentence and
    // the number are both live on one declaration (D125's tail placement).
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: VITALITY_SONG_DAMAGE });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("runs on the OTHER seat too, healing THAT seat's whole board", () => {
    // Same card, opposite chair: the op resolves against `ctx.seat`, not against a
    // hardcoded seat. Cheap, and the only thing that catches a `"p1"` literal that
    // happens to be right on every P1 board.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = skeledirgeActive(state, "p2", ACTIVE_HURT);
    state = benchTitans(state, "p2", [BENCH_HURT]);
    const attacker = activeUid(state, "p2");
    const benched = benchTopUid(state, "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p2", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p2", uid: benched, amount: VITALITY_SONG_HEAL },
    ]);
    expect(done.players.p2.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p2.bench[0]?.damage).toBe(BENCH_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p1.active?.damage).toBe(VITALITY_SONG_DAMAGE);
  });

  it("WHIFFS SILENTLY per Pokémon — an undamaged body emits NO row", () => {
    // A row count equal to the BOARD size would be the natural bug here, and it is
    // the one thing a log must not do: announce that nothing happened. The board is
    // arranged so the undamaged body sits BETWEEN two damaged ones, which also pins
    // that the skip does not truncate the rest of the sequence.
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [0, BENCH_HURT]);
    const attacker = activeUid(state, "p1");
    const damagedBench = benchTopUid(state, "p1", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: damagedBench, amount: VITALITY_SONG_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // And the attack is NOT skipped — "the op ran and had nothing to do for this
    // body" and "the sentence was never read" are different facts, and only the
    // second deserves a loud row.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("WHIFFS SILENTLY on a fully undamaged board — no rows at all, still SIMULATED", () => {
    let state = skeledirgeActive(board(), "p1", 0);
    state = benchTitans(state, "p1", [0]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // The printed damage is unaffected by the whiff: the two halves of the
    // declaration are independent.
    expect(done.players.p2.active?.damage).toBe(VITALITY_SONG_DAMAGE);
  });

  it("heals an EMPTY bench without incident — the Active alone is 'each'", () => {
    // The degenerate board, and a real one: a player whose Bench is empty still has
    // one Pokémon, and the sentence still names it. A loop written over the bench
    // alone reports nothing here and would look identical to a whiff.
    const state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
  });
});

describe("end to end — Cresselia 'Healing Pirouette' (heal 20 each, NO printed damage)", () => {
  it("heals 20 across the board and deals NOTHING — the heal is the whole result", () => {
    // Three of the seven printings have no `damage` field at all, so the heal is the
    // entire visible outcome. An implementation that folded the heal into the §8.5
    // damage pipeline rather than running it as a tail op would pass every Skeledirge
    // assertion above and fail here.
    let state = cresseliaActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const attacker = activeUid(state, "p1");
    const benched = benchTopUid(state, "p1", 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEALING_PIROUETTE_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: HEALING_PIROUETTE_HEAL },
      { type: "HEALED", seat: "p1", uid: benched, amount: HEALING_PIROUETTE_HEAL },
    ]);
    // NO damage, from either side of the claim: no row, and no damage on the board.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("uses a DIFFERENT N from Skeledirge's — 20, not 30", () => {
    // Two fixtures, two clauses. A hardcoded 30 anywhere downstream of the deriver
    // would satisfy every Vitality Song case in this file and fail on this one line:
    // the board carries enough damage that a 30 would have been unclamped too, so
    // the number the heal used is the only explanation left.
    const state = cresseliaActive(board(), "p1", ACTIVE_HURT);
    const { state: done } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEALING_PIROUETTE_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - HEALING_PIROUETTE_HEAL);
    expect(HEALING_PIROUETTE_HEAL).not.toBe(VITALITY_SONG_HEAL);
    expect(ACTIVE_HURT).toBeGreaterThan(VITALITY_SONG_HEAL);
  });

  it("the index-1 control derives NOTHING — the reader is keyed to the declared text", () => {
    // "Crescent Purge" prints real, unmapped text on the SAME card. Its {P}{P}{P} is
    // not payable out of BOARD_HEAL_DECK in one turn, so the control is stated at the
    // deriver — which is all it claims: a neighbouring sentence on the same card
    // derives no op, and no card-keyed lookup can hand it index 0's sentence.
    const purge = FIXTURE_POOL["sv06.5-021"]?.attacks?.[CRESCENT_PURGE_INDEX];
    expect(purge?.name).toBe("Crescent Purge");
    expect(deriveAttackEffect(purge?.effect ?? "")).toBeNull();
  });
});

describe("what the own-board heal costs the rest of the engine — nothing", () => {
  it("consumes NO rng: the state's rngState is untouched", () => {
    // No coin, no shuffle, no random pick — "each of your Pokémon" is not a choice
    // and the amount is printed. That determinism is what lets this whole suite run
    // on ONE board with no seed sweep, so it is worth an assertion rather than a
    // comment.
    const skeledirge = benchTitans(skeledirgeActive(board(), "p1", ACTIVE_HURT), "p1", [
      BENCH_HURT,
    ]);
    expect(
      mustApply(skeledirge, { type: "attack", seat: "p1", index: VITALITY_SONG_INDEX }).state
        .rngState,
    ).toBe(skeledirge.rngState);
    const cresselia = cresseliaActive(board(), "p1", ACTIVE_HURT);
    expect(
      mustApply(cresselia, { type: "attack", seat: "p1", index: HEALING_PIROUETTE_INDEX }).state
        .rngState,
    ).toBe(cresselia.rngState);
  });

  it("never PARKS — the attack resolves to an ordinary action phase", () => {
    // "Each of your Pokémon" names its targets outright, so there is no prompt and no
    // continuation, however many bodies are on the board. That is the visible
    // difference between this op and its `healChosen` sibling, which parks on the
    // neighbouring "1 of your Pokémon" sentence — and it is why a whole board's worth
    // of heals still costs one tail op rather than N sequential parks.
    const state = benchTitans(skeledirgeActive(board(), "p1", ACTIVE_HURT), "p1", [
      BENCH_HURT,
      BENCH_BARELY_HURT,
    ]);
    const { state: done } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    // If either grew a row the registry would win (`programFor(id)?.attack?.[index]
    // ?? derive`) and every assertion above would keep passing while testing nothing
    // about the text.
    for (const id of ["sv02-037", "sv06.5-021"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });

  it("emits the SAME op Garganacl's Ability does — one action, two readers", () => {
    // `healEach { amount: 20 }` is byte-identical to the program the "Blessed Salt"
    // registry row carries (registry.ts). That is the point of the whole slice: there
    // is one action here, reached from an Ability and from an attack, and the second
    // route cost no mechanism at all — no new op, no new event, no interpreter diff.
    expect(deriveAttackEffect("Heal 20 damage from each of your Pokémon.")).toEqual(
      programFor("sv02-123")?.triggered?.[0]?.program,
    );
  });
});
