import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_HEAL_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.82.0 → 0.83.0 — the BARE SELF-HEAL sentence (D132). "Heal {N} damage from this
// Pokémon." — 18 printings / 4 distinct clauses on ONE anchored regex and ONE
// deriver arm, and the cheapest slice this family has taken: NO new op, NO new
// event, NO new mechanism.
//
// THE OP WAS ALREADY BUILT, AND HAS BEEN SINCE 0.x. `heal { target: "self" }` has
// shipped from the beginning, produced by the COMPOUND sentence "This Pokémon is now
// Asleep. Heal {N} damage from it." (SELF_SLEEP_HEAL). What was missing was never a
// mechanism — it was a reader for the same action printed WITHOUT the Sleep clause.
// The interpreter did not change; neither did the events, the ops, or the wire.
//
// WHAT THIS FILE PINS, and why each part is here:
//   • THE ANCHOR, on all 4 distinct clauses (N = 10, 20, 30, 50) and against the 6
//     REAL catalog rows it must refuse. Five of those six name a DIFFERENT target
//     (one of your Pokémon, a Benched one) or gate the same action behind a coin, or
//     read the amount off the board; the sixth is the compound Sleep form, refused
//     HERE and simulated by the OTHER anchor — the one-reader-per-printed-string
//     boundary, asserted rather than assumed.
//   • THE GUARD. A printed "Heal 0 damage" derives to null: a silent no-op that
//     reported a simulated effect is worse than a loud unsimulated one, and every
//     arm of this reader carries the same guard.
//   • THE DIRECTION. `target: "self"` means the CONTROLLER's Active, and Ceruledge
//     "Life Sucker" heals 30 WHILE dealing 50 — so a `target` read the wrong way
//     round passes every count assertion and fails on exactly one line: the
//     defender must be damaged and NOT healed.
//   • THE CLAMP, which lives in the interpreter and not in the deriver. Heal 30 off
//     an Active carrying 10 heals 10, reports 10, and lands at 0.
//   • THE WHIFF IS SILENT. An undamaged attacker emits NO HEALED row at all — and
//     is still SIMULATED, not skipped. "The op ran and had nothing to do" and "the
//     sentence was never read" are different facts and must not share a log.
//   • THE NO-DAMAGE HALF. Six of the eighteen printings heal and do nothing else
//     (Natu "Nap"), so the heal is the whole visible result: zero DAMAGE_DEALT.
//   • NO RNG, NO PARK, NO REGISTRY ROW.

/** The four distinct clauses of the pool, verbatim, and the op each derives to.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string, 18
    printings in all: this is the whole mapped set and nothing else in the pool
    prints the shape. Named here rather than inlined so a table-driven case and the
    end-to-end cases below cannot drift apart. */
const CLAUSES = [
  {
    text: "Heal 30 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 30 },
    // Horsea sv06.5-010 / -067 + Slowpoke swsh10.5-019 ("Hold Still", no damage),
    // Slowbro sv01-043 + Azumarill sv02-045 ("Bubble Drain", 60 / 50), Brambleghast
    // sv02-024 ("Absorb Life", 30), Ceruledge sv02-098 ("Life Sucker", 50 — the
    // fixture this suite drives), Dolliv sv03-020 ("Sunny Wind", 30).
    printings: 8,
  },
  {
    text: "Heal 20 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 20 },
    // Natu swsh10.5-032 ("Nap", NO damage — the other fixture this suite drives),
    // Tropius sv02-007 / -195 ("Leaf Drain", 20), Marill sv02-044 / -204 ("Bubble
    // Drain", 20).
    printings: 5,
  },
  {
    text: "Heal 10 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 10 },
    // Shroomish sv01-003 + Smoliv sv03-019 ("Absorb", 10), Bramblin sv02-023 / -198
    // ("Blot", 10).
    printings: 4,
  },
  {
    text: "Heal 50 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 50 },
    // Ariados swsh10.5-007 ("Absorb", 50) — the pool's only printing of the biggest
    // N, and the one that HEALS EXACTLY WHAT IT DEALT.
    printings: 1,
  },
] as const;

/** The SIX real catalog rows this anchor must refuse, verbatim off the local D1.
    Every one of them contains the mapped words; not one of them is the mapped
    sentence, and the refusal is the anchors alone in every case. They are this
    file's "stays LOUD" witnesses, and better ones than invented strings would be —
    each names a real card that is genuinely unsimulated today (except the last,
    which is simulated by the OTHER anchor and is pinned as such):
      • Nacli sv02-121 / -220 "Salt Coating" — a CHOSEN target.
        (SIMULATED SINCE 0.86.0 by `CHOSEN_HEAL` — D135. Like Fuecoco below it keeps
        its case: the claim was never "unmapped", it is that THIS anchor's target is
        "this Pokémon" and a chosen one is a different op.)
      • Tropius sv01-007 "Fresh-Picked Fruit" — a chosen BENCHED target for a printed
        amount. (SAME, 0.86.0: `healChosen` grew the Bench FILTER it lacked, as a
        FIELD rather than a second op.)
        (RE-POINTED at 0.84.0. This slot held Steenee sv03-017 "Aromatherapy" / the
        Skeledirge ex "Vitality Song" clause — "Heal {N} damage from each of your
        Pokémon." — until D133 mapped it onto `healEach`. Per the standing note below
        the case was re-pointed, not deleted; the mapped sentence's own refusals now
        live in boardHeal.test.ts.)
      • Blissey swsh10.5-052 / Arboliva sv03-021 — a chosen BENCHED target, healed
        for "all". Two things unmapped at once: the zone and the amount.
        (SIMULATED SINCE 0.86.0 — D135 took both halves in one arm, because
        `healChosen.amount` had taken `number | "all"` since 0.x.)
      • Fuecoco sv02-035 / -201 — THE SAME ACTION, THE SAME TARGET, GATED BEHIND A
        FLIP. The dangerous one: a reader without `^` would take the tail of this
        sentence and heal unconditionally, turning a coin into a certainty.
        (SIMULATED SINCE 0.85.0, by `FLIP_SELF_HEAL` — D134. It stays in this list
        and keeps its case, because the claim about it never was "unmapped": it is
        that THIS anchor does not reach it. What changed is the shape of the proof —
        the gated program's `then` is now byte-identical to what this anchor derives
        for the same N, which is a sharper statement than a null was.)
      • 🆕🆕 **BUILT AT D427, AND THE SLOT IS RE-POINTED RATHER THAN EMPTIED.** This
        bullet named Iron Moth sv06.5-009 "Suction" — *"the same target, an amount that
        is not a number at all but a read of the damage this attack just dealt"* — and
        that is exactly the sentence D427 built (`heal.amount: number | "dealt"`, the
        figure carried on `EffectContext.dealt`). The list slot now holds *"Heal 100
        damage from each of your Benched Pokémon."* (2 legal printings, corpus line
        274), refused by every one of the twelve readers today. ⚠️ THE OLD CLAIM'S
        DISCRIMINATION IS NOT LOST WITH IT (D418's second half): what it could catch
        was an anchor whose amount slot accepted something that is not a numeral, and
        `selfHealDealt.test.ts` §2 now pins the two anchors apart directly — the bare
        sentence derives `amount: 30`, the echo sentence derives `amount: "dealt"`, and
        neither anchor takes the other's string.
      • Slowpoke sv01-042 / -204 "Rest" — the COMPOUND form, refused by THIS anchor
        and simulated by SELF_SLEEP_HEAL. Its presence here is the boundary case.
      • Floette sv01-092 "Magical Leaf" — ADDED at 0.86.0, and the file's sharpest
        live witness now that D135 mapped three of the six above. It prints THIS
        anchor's exact action, in lowercase, at the tail of a gated sentence that
        ALSO carries a damage bonus: "Flip a coin. If heads, this attack does 30 more
        damage, and heal 30 damage from this Pokémon." ⚠️ **"GENUINELY UNMAPPED
        EVERYWHERE" WAS TRUE WHEN WRITTEN AT 0.86.0 AND HAS ROTTED — measured at D427,
        `deriveAttackBonusConsequent` CLAIMS this string** and returns
        `{decider:{kind:"coinFlip"}, bonus:30, ops:[{op:"heal",target:"self",amount:30}]}`,
        which is precisely the "bonus is pre-damage math and the two cannot ride one op"
        that the next clause says is impossible; D317 built the op that carries both.
        The ASSERTION below is unaffected and stays true — THIS anchor still refuses it
        — so the row is annotated rather than moved, and the correction is dated rather
        than back-written (D423). D427 did not need this slot and did not take it. So
        the row stays loud on this reader, and a reader that dropped
        `^` or added /i would half-resolve it and silently forget the 30.

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
  // Pokémon."* until D427 BUILT it, then *"Heal 100 damage from each of your Benched
  // Pokémon."* until **D461 BUILT THAT TOO** (2 legal printings, corpus file line 274;
  // `deriveAttackEffect` arm 17b over `healEach.benchOnly`). Re-pointed rather than
  // deleted, per the STANDING NOTE above, onto the last row of the printed heal family
  // that no reader claims — and the reason it is unclaimed is DATA rather than shape:
  // the banner `Ancient` is in NO column of the persisted catalog, so the falsifier is
  // an INGEST change. It is a NEARER miss for THIS anchor than either predecessor on
  // the amount and the verb, and a farther one on the target, which is what the anchor
  // is anchored against. 1 legal printing, corpus file line 272.
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "This Pokémon is now Asleep. Heal 30 damage from it.",
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
] as const;

/** The rows that are unmapped EVERYWHERE — the ones that must derive to nothing on
    this reader because they derive to nothing on any reader. Split out rather than
    sliced inline, because the excluded rows' exclusion is a CLAIM and not a loop
    bound: indices 0–2 (the CHOSEN heals) are simulated by `CHOSEN_HEAL` since 0.86.0,
    index 3 (Fuecoco, gated) by `FLIP_SELF_HEAL` since 0.85.0, and index 5 (the
    compound Sleep form) by `SELF_SLEEP_HEAL` since 0.x. Each keeps its own case
    below — a loop over all seven would be asserting that a simulated card is
    unsimulated.

    IT IS STILL TWO AT D427, AND BOTH SENTENCES IN IT CHANGED IDENTITY. The claim this
    paragraph used to make — "the only real catalog rows sharing these words that
    NOTHING reads are Iron Moth's damage-echo and Floette's compound gate" — is false in
    both halves as of D427 and was already false in one: the damage-echo is BUILT here,
    and Floette's gate is claimed by `deriveAttackBonusConsequent` (D317) and has been
    for a long time.

    🆕🆕 **IT IS STILL TWO AT D461, AND INDEX 4 CHANGED IDENTITY AGAIN — FOR THE SAME
    REASON AND ONE FAMILY OVER.** *"Heal 100 damage from each of your Benched Pokémon."*
    was the live witness here for 34 decisions and D461 BUILT it, so the slot moves to
    the one heal sentence whose blocker no arm in this package can reach: *"Heal 100
    damage from 1 of your Benched **Ancient** Pokémon."* (corpus file line 272, 1 legal
    printing). ⚠️ **AND THE NEW WITNESS IS A DIFFERENT KIND OF WITNESS, WHICH IS WORTH
    SAYING RATHER THAN LETTING A READER ASSUME.** Its predecessors were unbuilt because
    no slice had priced them; this one is unbuilt because the datum the sentence names
    is in NO column of the persisted catalog, so it cannot be built by a reader at any
    width. That makes it the most STABLE witness this slot has ever held — and if it
    ever goes green, the thing that changed is the INGEST, which is exactly what a
    witness should be able to tell you. Index 6 is Floette's, refused by THIS anchor,
    which is the only claim the assertion below ever made about it. */
const UNMAPPED_NEAR_MISSES = [REAL_NEAR_MISSES[4], REAL_NEAR_MISSES[6]] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. Byte-different from an ASCII
    space and INVISIBLE in a diff, which is exactly why the case names it instead of
    carrying it — a re-ingest that swapped one in would un-simulate eight printings
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

/** Ceruledge prints "Life Sucker" (the heal + 50) FIRST and "Fighting Sword" (the
    scaling clause clauseTable.test.ts owns) second; Natu prints "Nap" (the bare
    heal) first and "Peck" (a flat 20, no effect) second. Named rather than inlined,
    so a re-ingest that reordered an attack fails on the fixture guards below rather
    than silently moving every board case onto the wrong sentence. */
const LIFE_SUCKER_INDEX = 0;
const NAP_INDEX = 0;
const PECK_INDEX = 1;

/** The two heal amounts, the one printed damage, and the damaged-board figures every
    delta assertion is stated in terms of. LIFE_SUCKER_HEAL and NAP_HEAL are two
    different N precisely so that a hardcoded amount somewhere downstream cannot
    satisfy both. */
const LIFE_SUCKER_HEAL = 30;
const LIFE_SUCKER_DAMAGE = 50;
const NAP_HEAL = 20;
/** A damaged attacker with room to spare on both sides of the heal: 100 is more than
    either N, so the heal is CLAMPED BY NOTHING here and the delta is the printed
    amount exactly. (Ceruledge has 140 HP, so 100 is damaged and alive.) */
const HURT = 100;
/** NATU's damaged board, and it cannot be HURT: Natu has FIFTY HP, so 100 damage is
    not a damaged Pokémon at all — it is a corpse the attack epilogue's KO sweep would
    clear out from under the assertion. 40 is more than Nap's 20, which is what the
    case needs (an unclamped heal), and 10 short of lethal, which is what the BOARD
    needs. Named separately from HURT rather than reused, because the two fixtures'
    HP is the whole reason they differ and a shared constant would hide it. */
const NATU_HURT = 40;
/** LESS than Life Sucker's 30 — the clamp's board. */
const BARELY_HURT = 10;

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account — which is itself part
    of what the suite claims (see the rng case at the end).

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery, then the attacker is replaced per case: Life
    Sucker's 50 cannot come near KOing a titan, so no promotion can park mid-batch
    and truncate a row sequence, and no defender attack can interleave rows with the
    ones being counted. The board under test is the ATTACKER's own damage. */
function board(): GameState {
  let state = driveSetup(7, { p1: SELF_HEAL_DECK, p2: SELF_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Ceruledge Active with Life Sucker's {C}{C} paid, carrying `damage` HP of damage.
    SURGERY on both counts: it is a STAGE 1 (from Charcadet) and could never be dealt
    as an opening Active, and the damage arrives by `setDamage` rather than by
    scripting the attacks that would place it. */
function ceruledgeActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(setActiveFromDeck(state, seat, "sv02-098"), seat, "fix-energy", 2);
  return setDamage(fielded, seat, damage);
}

/** Natu Active with Nap's single {C} paid, carrying `damage` HP of damage. A Basic,
    so `setActiveFromDeck` is a convenience here rather than a necessity — but the
    board is kept the same shape as Ceruledge's on purpose. */
function natuActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    setActiveFromDeck(state, seat, "swsh10.5-032"),
    seat,
    "fix-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

describe("the anchor — 18 printings, 4 clauses, one sentence", () => {
  it("derives every distinct clause the pool prints, to the SAME single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    // THE CENSUS, ASSERTED AS A SHAPE. 4 distinct clauses / 18 printings. These are
    // the numbers the slice claims and the numbers a re-census has to reproduce;
    // keeping them in the table means a clause added without its printing count
    // fails here rather than quietly drifting.
    expect(CLAUSES).toHaveLength(4);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(18);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering three clauses.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    // Every row is ONE op, and the op is the SAME shape with one number varying.
    // That is the whole slice: the clause set differs in a digit and nothing else,
    // which is why it cost one regex and no new member.
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "heal", target: "self" });
    }
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    // A "Heal 0 damage" printing is not a real card and would derive to a silent
    // no-op: the attack would report a simulated effect and heal nothing, which is
    // indistinguishable at the log from the whiff case below and means something
    // completely different. Loud path.
    expect(deriveAttackEffect("Heal 0 damage from this Pokémon.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the interpreter CLAMPS the heal
    // to the damage present (`healSelf`), so a malformed large amount heals an
    // Active to full and stops. That is a legal board state, not a runaway — the
    // clamp is asserted on a real board further down.
    expect(deriveAttackEffect("Heal 999 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 999 },
    ]);
  });

  it("refuses the TWO unmapped catalog rows that share its words", () => {
    // Two of the seven are unmapped everywhere and must derive to nothing at all. The
    // other five — the three CHOSEN heals, Fuecoco's gated form and the compound
    // Sleep form — are refused by THIS anchor and claimed by ANOTHER, which is a
    // different statement and gets its own case below; a loop over all seven would be
    // asserting that a simulated card is unsimulated.
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(UNMAPPED_NEAR_MISSES).toHaveLength(REAL_NEAR_MISSES.length - 5);
  });

  it("hands the CHOSEN forms to their own anchor — and none of them is a self-heal", () => {
    // RE-POINTED AT 0.86.0 (D135). These three rows were this file's oldest live
    // witnesses; `CHOSEN_HEAL` mapped all three in one arm, so per the standing note
    // they were re-pointed rather than deleted and now make a SHAPE claim instead of
    // a null. The claim that matters is the one this anchor always meant: "this
    // Pokémon" is the ATTACKER and nobody else, so no rewrite of the target may ever
    // derive to `{ op: "heal", target: "self" }`.
    for (const text of [REAL_NEAR_MISSES[0], REAL_NEAR_MISSES[1], REAL_NEAR_MISSES[2]]) {
      const ops = deriveAttackEffect(text);
      expect(ops).not.toBeNull();
      expect(ops).not.toContainEqual(expect.objectContaining({ op: "heal" }));
      expect(ops).toEqual([expect.objectContaining({ op: "healChosen" })]);
    }
    // AND THE ZONE WORD IS LOAD-BEARING, asserted here rather than only next door:
    // the two Benched rows carry it and the bare one does not, which is the entire
    // difference between healing the attacker's own board and healing everything but
    // the attacker.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[0])).toEqual([
      { op: "healChosen", amount: 20 },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toEqual([
      { op: "healChosen", amount: 60, zone: "bench" },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[2])).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
  });

  it("hands the GATED form to the flip anchor — and the heal inside it is THIS one", () => {
    // RE-POINTED AT 0.85.0 (D134). Fuecoco sv02-035 "Spacing Out" was this file's
    // sharpest near-miss from 0.83.0 until `FLIP_SELF_HEAL` mapped it; per the
    // standing note the case was re-pointed rather than deleted, and it now makes a
    // STRONGER claim than the null did. THIS anchor still refuses the string — it
    // starts at `^Heal` and the gated printing does not — so the danger it was
    // guarding against (a reader without `^` taking the tail and healing
    // unconditionally, turning a coin into a certainty) is still pinned shut.
    const gated = REAL_NEAR_MISSES[3];
    expect(gated.startsWith("Heal")).toBe(false);
    // What the gated sentence derives to is a `coinFlipGate` whose branch is the
    // program THIS anchor produces for the same N, byte for byte. One action, two
    // printings, no mechanism between them.
    expect(deriveAttackEffect(gated)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: deriveAttackEffect("Heal 30 damage from this Pokémon.") },
    ]);
    // And the COIN reader still does not claim it: a gated heal is not an
    // `AttackCoinFlip` shape (those fold pre-damage). So exactly one reader answers
    // for the string, which is this family's standing invariant.
    expect(deriveAttackCoinFlip(gated)).toBeNull();
  });

  it("hands the COMPOUND Sleep form to the OTHER anchor — one reader per string", () => {
    // Slowpoke sv01-042 "Rest" prints the same action with a Sleep clause in front of
    // it and the pronoun "it" in place of "this Pokémon". THIS anchor refuses it (it
    // does not start at `^Heal`), and SELF_SLEEP_HEAL simulates it — so the two
    // anchors cannot both claim one printed string, which is an invariant nothing
    // else in the codebase enforces.
    const compound = REAL_NEAR_MISSES[5];
    const compoundOps = deriveAttackEffect(compound);
    expect(compoundOps).not.toBeNull();
    // And the heal it produces is BYTE-IDENTICAL to the one the bare anchor produces
    // for the same N. That is the point of the whole slice: there is one action here,
    // reached by two sentences, and the second sentence cost no mechanism at all.
    const bare = deriveAttackEffect("Heal 30 damage from this Pokémon.");
    expect(compoundOps?.[1]).toEqual(bare?.[0]);
    expect(compoundOps).toEqual([
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: 30 },
    ]);
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 30 damage from this Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 30 damage from this Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Fuecoco's "…, heal 30 damage from this Pokémon." is exactly that
      // clause), and the reason no /i flag is on this regex.
      "heal 30 damage from this Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Heal${NBSP}30 damage from this Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  30 damage from this Pokémon.",
      // THE PRONOUN. "from it" is the COMPOUND sentence's tail and has no referent on
      // its own — the bound pronoun is bound by a clause that is not here.
      "Heal 30 damage from it.",
      // "all" for a number: a real printed amount (Blissey, Arboliva) that this op
      // cannot carry — `amount` is a number, and "heal to full" is a reading nothing
      // in this arm expresses.
      "Heal all damage from this Pokémon.",
      // A LEADING RIDER sentence pins `^`, and this is not hypothetical: it is how a
      // gated or conditional printing arrives.
      "Before doing damage, heal 30 damage from this Pokémon.",
      "If this Pokémon is Burned, heal 30 damage from this Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for. No
      // pool printing extends these clauses today, which is precisely why the guard
      // is pinned now: the first one that does must land LOUDLY rather than
      // half-resolve, dropping a rider the engine never saw.
      "Heal 30 damage from this Pokémon. This Pokémon is now Asleep.",
      "Heal 30 damage from this Pokémon. Then, shuffle your deck.",
      // OTHER TARGETS, spelled the way the pool spells them. Each is a different op
      // (healChosen / healEach / healEachAll) or no op at all — and the point of the
      // list is that THIS anchor refuses all of them, whether or not some other
      // anchor claims them. The list has SHRUNK TWICE for the same reason: "each of
      // your Pokémon" left at 0.84.0 (D133) and both "1 of your [Benched] Pokémon"
      // spellings at 0.86.0 (D135), because asserting a null for a sentence that now
      // derives would be false. What replaces them are targets nothing reads —
      // "your Active Pokémon" (the pool never spells the Active that way in a heal)
      // and the opponent's, which no printing heals at all.
      "Heal 30 damage from your Active Pokémon.",
      "Heal 30 damage from your opponent's Active Pokémon.",
      "Heal 30 damage from your opponent's Benched Pokémon.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 3 damage counters from this Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 30 damage from this Pokémon.\n")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    expect(deriveAttackEffect("\tHeal 10 damage from this Pokémon. ")).toEqual([
      { op: "heal", target: "self", amount: 10 },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Ceruledge sv02-098", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here — including the printed 50,
    // which is what makes this the WITH-DAMAGE occupant of the slice.
    const lifeSucker = FIXTURE_POOL["sv02-098"]?.attacks?.[LIFE_SUCKER_INDEX];
    expect(lifeSucker).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Life Sucker",
      effect: "Heal 30 damage from this Pokémon.",
      damage: LIFE_SUCKER_DAMAGE,
    });
    expect(deriveAttackEffect(lifeSucker?.effect ?? "")).toEqual([
      { op: "heal", target: "self", amount: LIFE_SUCKER_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-098"]?.name).toBe("Ceruledge");
    // A STAGE 1, which is why every board below reaches it by surgery.
    expect(FIXTURE_POOL["sv02-098"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv02-098"]?.hp).toBe(140);
  });

  it("matches FIXTURE_POOL char-for-char for Natu swsh10.5-032", () => {
    // The NO-DAMAGE half of the census, and a second N — so a hardcoded 30 anywhere
    // downstream cannot satisfy both fixtures.
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Nap",
        effect: "Heal 20 damage from this Pokémon.",
      },
      { cost: ["Psychic", "Colorless"], name: "Peck", damage: 20 },
    ]);
    expect(FIXTURE_POOL["swsh10.5-032"]?.name).toBe("Natu");
    expect(FIXTURE_POOL["swsh10.5-032"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["swsh10.5-032"]?.hp).toBe(50);
    expect(FIXTURE_POOL["swsh10.5-032"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["swsh10.5-032"]?.abilities).toBeNull();
    // "Nap" prints NO `damage` field at all (not a zero, not an empty string), so a
    // mis-read has no number to land on: the heal is the whole visible result of the
    // declaration. "Peck" is the mirror image — a number and no effect text.
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[NAP_INDEX]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[PECK_INDEX]?.effect).toBeUndefined();
    expect(
      deriveAttackEffect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[NAP_INDEX]?.effect ?? ""),
    ).toEqual([{ op: "heal", target: "self", amount: NAP_HEAL }]);
  });
});

describe("end to end — Ceruledge 'Life Sucker' (heal 30, WITH a printed 50)", () => {
  it("heals the ATTACKER by 30 and damages the DEFENDER by 50", () => {
    const state = ceruledgeActive(board(), "p1", HURT);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    // THE HEAL. 100 → 70, and the row names the amount actually removed.
    expect(done.players.p1.active?.damage).toBe(HURT - LIFE_SUCKER_HEAL);
    const healed = find(events, "HEALED");
    expect(healed).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attacker,
      amount: LIFE_SUCKER_HEAL,
    });
    // THE DIRECTION, asserted from the side that must NOT heal. fix-titan has no
    // Weakness and no Resistance, so 50 arrives unmodified — and it must STAY
    // arrived. A `target` read the wrong way round passes every count assertion in
    // this file and fails exactly here.
    expect(done.players.p2.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(find(events, "HEALED")?.seat).not.toBe("p2");
    // Simulated, not skipped — and the printed damage landed, so the sentence and
    // the number are both live on one declaration.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: LIFE_SUCKER_DAMAGE });
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("runs on the OTHER seat too, healing THAT seat's Active", () => {
    // Same card, opposite chair: the op resolves against `ctx.seat`, not against a
    // hardcoded seat. Cheap, and the only thing that catches a `"p1"` literal that
    // happens to be right on every P1 board.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = ceruledgeActive(state, "p2", HURT);
    const attacker = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: LIFE_SUCKER_INDEX,
    });
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p2",
      uid: attacker,
      amount: LIFE_SUCKER_HEAL,
    });
    expect(done.players.p2.active?.damage).toBe(HURT - LIFE_SUCKER_HEAL);
    expect(done.players.p1.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
  });

  it("CLAMPS to the damage present — heal 30 off 10 heals TEN, and lands at 0", () => {
    // The clamp lives in the interpreter (`healSelf`'s Math.min), which is exactly
    // why the deriver needs no ceiling: the printed number is a MAXIMUM, and the
    // board decides the rest. A build that subtracted blindly would leave damage at
    // −20, a state nothing else in the engine is prepared for.
    const state = ceruledgeActive(board(), "p1", BARELY_HURT);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(0);
    // The row reports what MOVED, not what was printed — the log and the wire agree
    // with the board rather than with the number on the card.
    expect(find(events, "HEALED")?.amount).toBe(BARELY_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("WHIFFS SILENTLY on an undamaged attacker — no row, and still SIMULATED", () => {
    // An undamaged Active has nothing to heal. The op runs, finds nothing, and emits
    // NOTHING: a zero-amount HEALED row would announce that nothing happened, which
    // is the one thing a log must not do. And crucially the attack is NOT skipped —
    // "the op ran and had nothing to do" and "the sentence was never read" are
    // different facts, and only the second deserves a loud row.
    const state = ceruledgeActive(board(), "p1", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // The printed damage is unaffected by the whiff: the two halves of the
    // declaration are independent.
    expect(done.players.p2.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
  });
});

describe("end to end — Natu 'Nap' (heal 20, NO printed damage)", () => {
  it("heals 20 and deals NOTHING — the heal is the whole result", () => {
    // Six of the eighteen printings have no `damage` field at all, so the heal is
    // the entire visible outcome. An implementation that folded the heal into the
    // §8.5 damage pipeline rather than running it as a tail op would pass every
    // Ceruledge assertion above and fail here.
    const state = natuActive(board(), "p1", NATU_HURT);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: NAP_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(NATU_HURT - NAP_HEAL);
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attacker,
      amount: NAP_HEAL,
    });
    // NO damage, from either side of the claim: no row, and no damage on the board.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("uses a DIFFERENT N from Ceruledge's — 20, not 30", () => {
    // Two fixtures, two clauses. A hardcoded 30 anywhere downstream of the deriver
    // would satisfy every Life Sucker case in this file and fail on this one line —
    // the delta is 20 and the board carries enough damage (40) that a 30 would have
    // been unclamped too, so the number the heal used is the only explanation left.
    const state = natuActive(board(), "p1", NATU_HURT);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: NAP_INDEX });
    expect(done.players.p1.active?.damage).toBe(NATU_HURT - NAP_HEAL);
    expect(NATU_HURT - NAP_HEAL).not.toBe(NATU_HURT - LIFE_SUCKER_HEAL);
    expect(NATU_HURT).toBeGreaterThan(LIFE_SUCKER_HEAL);
  });

  it("the index-1 control heals NOTHING — the reader is keyed to the declared text", () => {
    // "Peck" prints a flat 20 and no effect text, on the SAME card and the same
    // board. Its {P} is not paid by SELF_HEAL_DECK, so the control is stated at the
    // deriver — which is all it claims: an attack with no effect text derives no op,
    // and no card-keyed lookup can hand it index 0's sentence.
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[PECK_INDEX]?.effect).toBeUndefined();
    expect(deriveAttackEffect("")).toBeNull();
  });
});

describe("what the bare heal costs the rest of the engine — nothing", () => {
  it("consumes NO rng: the state's rngState is untouched", () => {
    // No coin, no shuffle, no random pick — "this Pokémon" is not a choice and the
    // amount is printed. That determinism is what lets this whole suite run on ONE
    // board with no seed sweep, so it is worth an assertion rather than a comment.
    const ceruledge = ceruledgeActive(board(), "p1", HURT);
    expect(
      mustApply(ceruledge, { type: "attack", seat: "p1", index: LIFE_SUCKER_INDEX }).state.rngState,
    ).toBe(ceruledge.rngState);
    const natu = natuActive(board(), "p1", NATU_HURT);
    expect(mustApply(natu, { type: "attack", seat: "p1", index: NAP_INDEX }).state.rngState).toBe(
      natu.rngState,
    );
  });

  it("never PARKS — the attack resolves to an ordinary action phase", () => {
    // "This Pokémon" names its target outright, so there is no prompt and no
    // continuation. The turn simply ends, which is what every non-parking attack
    // does — and is the visible difference between this op and its `healChosen`
    // sibling, which parks on exactly this kind of sentence with "1 of your Pokémon"
    // in place of "this Pokémon".
    const { state: done } = mustApply(ceruledgeActive(board(), "p1", HURT), {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    // If either grew a row the registry would win (`programFor(id)?.attack?.[index]
    // ?? derive`) and every assertion above would keep passing while testing nothing
    // about the text.
    for (const id of ["sv02-098", "swsh10.5-032"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});
