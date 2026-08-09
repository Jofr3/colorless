import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect, programFor } from "./index";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  FLIP_GATED_OP_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.84.0 → 0.85.0 — the FLIP-GATED OP family (D134). "Flip a coin. If heads,
// <action>." — 3 printings / 2 distinct clauses on TWO anchored regexes and TWO
// deriver arms, with NO interpreter diff at all.
//
// D132'S INVENTORY RULE FOR THE THIRD SLICE RUNNING, and the cheapest form it has
// taken yet: BOTH consequents already existed (`heal { target: "self" }` since 0.x,
// `discardDeckTop` since D130) and so did the gate (`coinFlipGate`, since 0.x). What
// was missing was two readers. So the derived program's `then` is BYTE-IDENTICAL to
// what the bare anchor derives for the same clause, and that identity — asserted in
// both directions below — is the family's whole checkable claim.
//
// WHY THE TWO SHIP TOGETHER, which is the only judgement call in the slice. Fuecoco
// is 2 printings and clears D121's warrant alone; Wiglett is ONE and does not. Taken
// together the SHAPE is 3 printings / 2 clauses, and the engine already reads two
// other instances of it (`FLIP_DEFENDER_NOW`, `FLIP_OPPONENT_ACTIVE_DISCARD`) — so
// Wiglett is a fourth member of a family rather than a bespoke row for one card.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of selfHeal/deckTopMill:
//   • THE TAILS FACE. Every claim in this file is really a pair of claims, because
//     the interesting half is the one where NOTHING happens — and "nothing happened"
//     must be distinguishable from "the sentence was never read". A build that
//     dropped the gate passes every heads assertion in this file.
//   • THE FLIP IS TAKEN ON BOTH FACES. `rngState` advances even on tails (the coin
//     was flipped; the branch was not spliced), which is the opposite of the boards
//     in boardHeal.test.ts and is asserted as such.
//   • A TAILS FLIP IS NOT A SKIPPED EFFECT. No ATTACK_EFFECT_SKIPPED on either face:
//     the sentence WAS read and the coin decided. The loud row would be a lie.
//   • TWO CONSEQUENTS THAT SHARE NO VOCABULARY — one heals the attacker's own body,
//     the other mills a hidden zone on the other side of the table. That is the
//     evidence for two LITERAL arms rather than one D120 template.
//   • NEITHER PRINTS `damage`, so on tails the whole declaration moves nothing
//     anywhere and there is no number for a half-simulation to hide behind.

/** The two distinct clauses of the family, verbatim, and the program each derives
    to. Censused against the local D1 (2026-08-01) over the WHOLE effect string
    (`attacks_json LIKE '%Flip a coin. If heads,%'`, 978 cards / 6 sets): 3 printings in all,
    and this is the whole mapped set. Both are STANDALONE single sentences. */
const CLAUSES = [
  {
    text: "Flip a coin. If heads, heal 30 damage from this Pokémon.",
    // Fuecoco sv02-035 / -201 ("Spacing Out", no printed damage).
    printings: 2,
    inner: { op: "heal", target: "self", amount: 30 },
    /** The BARE sentence the gate wraps — the same action printed without a coin in
        front of it, which `deriveAttackEffect` has read since 0.83.0 (D132). */
    bare: "Heal 30 damage from this Pokémon.",
  },
  {
    text: "Flip a coin. If heads, discard the top card of your opponent's deck.",
    // Wiglett sv01-056 ("Dig a Little", no printed damage).
    printings: 1,
    inner: { op: "discardDeckTop", whose: "opponent", count: 1 },
    /** The bare sentence, read since 0.82.0 (D131) — and the SINGULAR branch of it,
        the one place the deriver invents a count instead of reading one. */
    bare: "Discard the top card of your opponent's deck.",
  },
] as const;

/** The real catalog rows these two anchors must refuse, verbatim off the local D1 —
    every one of them a "Flip a coin. If heads, …" printing, so the shared prefix is
    never what does the refusing. Three groups, and the middle one is the reason the
    list is worth having:

      • UNMAPPED EVERYWHERE (indices 0–2). Pincurchin's Special-Condition choice,
        Cetitan's shuffle-a-Benched-Pokémon and Kangaskhan's Energy search: three
        consequents this reader has no op for at all. They are this file's "stays
        LOUD" witnesses.
      • MAPPED BY ANOTHER ARM OF THIS VERY READER (indices 3–5). The Paralyze form
        (`FLIP_DEFENDER_NOW`, 16 printings), the Energy hammer
        (`FLIP_OPPONENT_ACTIVE_DISCARD`, 4) and — since D181 — the GATED GUST
        (`ATTACK_FLIP_GUST`). They must NOT be claimed by either new anchor — which
        is what makes "one anchored reader per printed string" a property of this
        family rather than an accident of arm ordering.
      • MAPPED BY A DIFFERENT READER (index 6). "…this attack does 20 more damage." is
        D126's `deriveAttackCoinFlip`, which folds pre-damage and is disjoint from the
        op deriver entirely.

    ⚠️ D181 MOVED BOMBIRDIER'S SWITCH-IN FROM THE FIRST GROUP TO THE SECOND, WHICH IS
    THIS NOTE'S STANDING INSTRUCTION BEING FOLLOWED RATHER THAN A REWRITE. The row was
    RE-POINTED, not deleted: three unmapped witnesses remain, so the "an unread
    sentence stays LOUD" claim still has live subjects. ⚠️ AND IT IS ALSO THE STRONGEST
    PROVENANCE D181's gated-gust anchor has. That slice ran without the catalog (see
    `derivedDrawAndGust.test.ts`), and this row — transcribed VERBATIM off the local D1
    by D134 on 2026-08-01, off an ATTACK — is the only in-repo evidence that the gated
    gust sentence is printed on an attack at all, and that it is byte-identical to
    Pokémon Catcher's Item text. ⚠️ It also names a card the 2026-08-04 backlog's gust
    row does NOT list (that row's only flip-gated printing is Tarountula `sv01-016`
    "String Haul"), so that family is at least one printing wider than the doc says.

    STANDING NOTE: when a later slice maps one of indices 0–2, RE-POINT the case at
    another still-unmapped clause — never delete it. The suite's claim is that an
    unread sentence stays LOUD, and that claim needs a live witness. */
const REAL_NEAR_MISSES = [
  "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
  // 🆕 **RE-POINTED AT D299, THE STANDING INSTRUCTION BEING FOLLOWED FOR THE
  // SECOND TIME.** This slot held Sylveon `svp-172`/`sv06.5-022`'s *"…choose 1 of
  // your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards
  // into their deck."*, which `returnBenched` now READS (through the existing
  // `coinFlipGate`, which is what makes it a mapped row rather than a near-miss).
  // Its replacement is the nearest surviving unmapped neighbour in the same
  // census — Ethan's Sudowoodo `sv10-093`'s printed *"choose 1 of your opponent's
  // Active Pokémon's attacks and use it as this attack"* (**1 legal printing**,
  // id re-queried against the remote D1 on 2026-08-09 rather than inferred from
  // the corpus line) — so the slot keeps the property that made the old
  // witness worth having: a LOWERCASE mid-sentence "choose" behind the shared
  // prefix, refused by the consequent and not by the prefix.
  "Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
  "Flip a coin. If heads, search your deck for up to 5 Grass Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
  "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  "Flip a coin. If heads, this attack does 20 more damage.",
] as const;

/** The three of the seven that are unmapped EVERYWHERE. Split out rather than sliced
    inline, because the other four's exclusion is a CLAIM (they are simulated, by a
    named arm or a named reader) and not a loop bound. */
const UNMAPPED_NEAR_MISSES = REAL_NEAR_MISSES.slice(0, 3);

/** U+00A0, spelled as an ESCAPE rather than typed. Byte-different from an ASCII
    space and INVISIBLE in a diff, which is exactly why the case names it instead of
    carrying it — a re-ingest that swapped one in would un-simulate all three
    printings with nothing on screen to see. */
const NBSP = "\u00a0";

/** U+2019, the CURLY apostrophe, likewise an escape. Wiglett's clause carries an
    ASCII `'` and the pool holds ZERO U+2019 anywhere, so a hand-retyped near-miss is
    the only way one enters the codebase. The regex accepts BOTH (`['’]`), which is
    the family's standing choice; this pins that the acceptance is deliberate. */
const RSQUO = "\u2019";

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

/** The face the declaration's single flip came up. `undefined` would mean no flip was
    taken at all, which is a distinct failure from either face and is asserted as
    such wherever it matters. */
function face(events: GameEvent[]): CoinFace | undefined {
  return find(events, "ATTACK_EFFECT_COIN_FLIP")?.result;
}

/** Both fixtures print the gated sentence FIRST and an effect-less control second.
    Named rather than inlined, so a re-ingest that reordered an attack fails on the
    fixture guards below rather than silently moving every case onto the wrong one. */
const SPACING_OUT_INDEX = 0;
const FLARE_INDEX = 1;
const DIG_A_LITTLE_INDEX = 0;
const RAM_INDEX = 1;

/** The gated amounts, and the two controls' printed damage. */
const SPACING_OUT_HEAL = 30;
const FLARE_DAMAGE = 30;
const DIG_A_LITTLE_MILL = 1;
const RAM_DAMAGE = 20;

/** Fuecoco's damage on the boards that measure the heal. GREATER than the printed 30
    on purpose, so a heads flip leaves a NON-ZERO remainder: a board healed exactly to
    zero cannot tell "healed 30" from "healed everything". And WELL UNDER Fuecoco's
    printed 90 HP, which is not a detail — the attacker here carries its damage before
    it declares, so a figure at or above its HP is a body the attack epilogue sweeps
    off the board mid-case, and every assertion below would then be about a promoted
    stranger rather than about the heal. */
const ATTACKER_HURT = 50;
/** LESS than the printed 30 — the clamped board, where heads lands at 0 and must not
    go negative. */
const ATTACKER_BARELY_HURT = 10;

/** P2's turn-start draw, stated as a named term. Every deck-length assertion about
    the DEFENDER carries it: P2 draws at the start of their turn, which happens inside
    the same `apply` that resolves P1's attack, so "P2's deck is 1 shorter" means two
    different things depending on whether the mill ran. A silent `+ 1` in a slice
    about a one-card mill is exactly where an off-by-one hides. */
const TURN_START_DRAW = 1;

/** The seeds every face-sweep runs. Eight is enough to see both faces on either
    fixture and small enough to stay a fixed, deterministic list — no seed here is
    load-bearing on its own, which is why the sweeps assert over the COLLECTED faces
    rather than over a chosen one. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery: neither control's 30 comes near KOing it, so
    no promotion can park mid-flight and no defender attack can interleave rows.
    BOTH BENCHES ARE EMPTIED because `setActiveFromDeck` DISPLACES the Active it
    replaces onto the bench (D133's trap) — nothing here reads the bench, but a
    stranger on it would silently change the DECK these cases measure.

    ⚠️ THE SEED IS A PARAMETER HERE, unlike in the heal and mill suites: this family
    takes a coin, so a board is only half a case and every end-to-end claim is a
    sweep over `SEEDS` collecting both faces. */
function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: FLIP_GATED_OP_DECK, p2: FLIP_GATED_OP_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Fuecoco Active with a single {C} paid — enough for "Spacing Out" but NOT for
    "Flare" ({R}{C}), which is why the control helper attaches separately. `damage`
    arrives by `setDamage` surgery rather than by scripting the attacks that would
    place it. */
function fuecocoActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-035"), seat),
    seat,
    "fix-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

/** Wiglett Active with a single {C} paid — enough for EITHER of its attacks, which is
    the point: "Dig a Little" and "Ram" both come off the same Colorless line, so
    nothing but the declared INDEX tells them apart and an implementation keyed to the
    card rather than to the attack's text fails on the control. (Ram wants {C}{C}, so
    the control helper tops it up.) */
function wiglettActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv01-056"), seat),
    seat,
    "fix-energy",
    1,
  );
}

/** The uids named by the mill rows, in order — read off the EVENTS rather than
    recomputed from the deck, because an op that moved the right NUMBER of wrong cards
    is the failure this catches. */
function milledUids(events: GameEvent[]): string[] {
  return all(events, "DECK_TOP_DISCARDED").flatMap((e) => e.uids);
}

describe("the anchors — 3 printings, 2 clauses, two literal arms", () => {
  it("derives both clauses to a coinFlipGate over the BARE anchor's own program", () => {
    for (const { text, inner, bare } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      expect(ops).toEqual([{ op: "coinFlipGate", then: [inner] }]);
      // THE CLAIM OF THE WHOLE SLICE, and the reason it cost no mechanism: the gated
      // program's `then` is BYTE-IDENTICAL to what the bare sentence derives. There
      // is one action here, printed two ways, and the coin is procedure in front of
      // it — not a modifier on the op, not a second op, not a new member.
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      expect(deriveAttackEffect(text)?.[0]).toMatchObject({ then: deriveAttackEffect(bare) });
    }
    // THE CENSUS, ASSERTED AS A SHAPE. 2 distinct clauses / 3 printings — the numbers
    // the slice claims and the numbers a re-census has to reproduce.
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(3);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    // Every row is exactly ONE op at the top level, and it is the gate.
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "coinFlipGate" });
    }
  });

  it("keeps the TWO ARMS genuinely separate — the consequents share no vocabulary", () => {
    // The evidence for LITERAL arms over a D120 template. That rule licenses a
    // template only when the varying token has a CLOSED reading (the five status
    // words, the nine energy codes); here the varying token is the whole consequent,
    // and these two share not one word after "If heads, ". A template over this would
    // be a template over "everything an EffectOp can express".
    const [heal, mill] = CLAUSES;
    const tailOf = (text: string) => text.slice("Flip a coin. If heads, ".length);
    expect(tailOf(heal.text)).not.toBe(tailOf(mill.text));
    const words = (text: string) => new Set(tailOf(text).replace(/[.,]/g, "").split(" "));
    const shared = [...words(heal.text)].filter((w) => words(mill.text).has(w));
    expect(shared).toEqual([]);
    // And the two gates wrap different ops, so no downstream code can treat them as
    // one shape either.
    expect(deriveAttackEffect(heal.text)).not.toEqual(deriveAttackEffect(mill.text));
  });

  it("refuses a printed ZERO heal — the guard every arm of this reader carries", () => {
    // A "heal 0" printing is not a real card, and behind a gate it is worse than
    // elsewhere: the attack would flip a coin and then do nothing on EITHER face,
    // which looks from the log like a tails that happened to be a heads. The guard
    // sits OUTSIDE the gate for exactly that reason.
    expect(
      deriveAttackEffect("Flip a coin. If heads, heal 0 damage from this Pokémon."),
    ).toBeNull();
    // No CEILING, by contrast: the interpreter clamps the heal to the damage present,
    // so a malformed large amount heals to full and stops — a legal board state.
    expect(
      deriveAttackEffect("Flip a coin. If heads, heal 999 damage from this Pokémon."),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    ).toEqual([{ op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 999 }] }]);
  });

  it("refuses the THREE unmapped catalog rows that share its prefix", () => {
    // All three are real "Flip a coin. If heads, …" printings whose consequent this
    // reader has no op for — a chosen Special Condition, a BORROWED ATTACK and an
    // Energy search. The shared prefix is never what refuses them, which is the
    // point of choosing witnesses that carry it. (The switch-in that used to head
    // this list is D181's, and moved to the mapped group above; the Benched
    // shuffle-back that sat second is D299's `returnBenched`, and this list was
    // RE-POINTED rather than shortened — the claim needs three live witnesses.)
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(UNMAPPED_NEAR_MISSES).toHaveLength(REAL_NEAR_MISSES.length - 4);
    // …and they are not quietly picked up by the coin reader either, so each row is a
    // genuine gap rather than a half-simulation.
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
  });

  it("leaves the family's THREE OTHER members to their own arms", () => {
    // `FLIP_DEFENDER_NOW` (16 printings), `FLIP_OPPONENT_ACTIVE_DISCARD` (4) and —
    // since D181 — `ATTACK_FLIP_GUST` are read by this same function and must not be
    // claimed by either of THIS slice's anchors. Since all of them share a prefix and
    // only the consequent differs, "one anchored reader per printed string" is a real
    // invariant here rather than a slogan — and the shape of what comes back is the
    // proof, since a wrong claim would still return a `coinFlipGate` and only the
    // `then` would betray it.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[3])).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[4])).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[5])).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "gust" }],
      },
    ]);
  });

  it("leaves D126's pre-damage flip to the OTHER reader entirely", () => {
    // "…this attack does 20 more damage." shares the whole prefix and is NOT an op at
    // all: it folds into the printed base BEFORE the §8.5 pipeline, so it belongs to
    // `deriveAttackCoinFlip` and the op deriver must return null for it. The two
    // readers are disjoint by construction (attack.ts runs ops at the tail), and this
    // is the pair of assertions that says so on one string.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[6])).toBeNull();
    expect(deriveAttackCoinFlip(REAL_NEAR_MISSES[6])).not.toBeNull();
    // And the converse, on both of ours: the coin reader does not claim either gated
    // sentence. A build where both fired would flip twice for one printed coin.
    for (const { text } of CLAUSES) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
  });

  it("is DISJOINT from the two BARE anchors — neither can claim the other's string", () => {
    // The bare anchors start at `^Heal` / `^Discard`; these start at `^Flip`. So the
    // ordering of the four arms in the deriver is immaterial, which is what keeps this
    // family at one regex per sentence with no dispatch table. Asserted in BOTH
    // directions on each clause.
    for (const { text, bare, inner } of CLAUSES) {
      expect(deriveAttackEffect(bare)).toEqual([inner]);
      expect(deriveAttackEffect(text)).not.toEqual(deriveAttackEffect(bare));
      expect(bare.startsWith("Flip")).toBe(false);
      expect(text.startsWith("Flip a coin. If heads, ")).toBe(true);
    }
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Flip a coin. If heads, heal 30 damage from this Pokémon",
      "Flip a coin. If heads, discard the top card of your opponent's deck",
      // A CAPITALISED consequent. The printed text lowercases it (it is mid-sentence),
      // and a capital here is the bare anchor's spelling pasted behind a gate.
      "Flip a coin. If heads, Heal 30 damage from this Pokémon.",
      "Flip a coin. If heads, Discard the top card of your opponent's deck.",
      // A LOWERCASE "Flip". Half of what keeps a mid-sentence gate clause off this
      // path, and the reason no /i flag is on either regex.
      "flip a coin. If heads, heal 30 damage from this Pokémon.",
      // "if" for "If" — the other half of the same guard.
      "Flip a coin. if heads, heal 30 damage from this Pokémon.",
      // TAILS, not heads. A real printed word in this pool ("If tails, this attack
      // does nothing." — D126) and the one substitution that would invert the whole
      // meaning of the sentence while changing four characters.
      "Flip a coin. If tails, heal 30 damage from this Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip a coin. If heads,${NBSP}heal 30 damage from this Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Flip a coin.  If heads, heal 30 damage from this Pokémon.",
      // MISSING the comma after "If heads".
      "Flip a coin. If heads heal 30 damage from this Pokémon.",
      // A MULTI-FLIP count. "Flip 2 coins." is D127's sentence, and a gate over N
      // flips is not a gate at all — it is a fold. Nothing may read it here.
      "Flip 2 coins. If heads, heal 30 damage from this Pokémon.",
      "Flip a coin until you get tails. If heads, heal 30 damage from this Pokémon.",
      // A PER-HEADS repeat (D130) rather than a gate: N flips, N runs.
      "Flip a coin. For each heads, discard the top card of your opponent's deck.",
      // THE MILL'S WIDENINGS, none of which the pool prints behind a gate. Accepting
      // any of them would be inventing a reading, which is the guess this family
      // refuses everywhere else.
      "Flip a coin. If heads, discard the top 2 cards of your opponent's deck.",
      "Flip a coin. If heads, discard the top card of your deck.",
      "Flip a coin. If heads, discard the top card of each player's deck.",
      // THE HEAL'S NEIGHBOURING TARGETS, likewise unprinted behind a gate.
      "Flip a coin. If heads, heal 30 damage from each of your Pokémon.",
      "Flip a coin. If heads, heal 30 damage from 1 of your Pokémon.",
      "Flip a coin. If heads, heal all damage from this Pokémon.",
      // A SECOND SENTENCE riding the gate — the shape the `$` exists for. No pool
      // printing extends these clauses today, which is why the guard is pinned now:
      // the first one that does must land LOUDLY rather than half-resolve.
      "Flip a coin. If heads, heal 30 damage from this Pokémon. If tails, this attack does nothing.",
      "Flip a coin. If heads, discard the top card of your opponent's deck. Then, shuffle your deck.",
      // A LEADING RIDER pins `^` from the other side.
      "This attack does 20 damage. Flip a coin. If heads, heal 30 damage from this Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(
      deriveAttackEffect("  Flip a coin. If heads, heal 30 damage from this Pokémon.\n"),
    ).toEqual(
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      [{ op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 30 }] }],
    );
    expect(
      deriveAttackEffect("\tFlip a coin. If heads, discard the top card of your opponent's deck. "),
    ).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: [{ op: "discardDeckTop", whose: "opponent", count: 1 }] },
    ]);
  });

  it("accepts BOTH apostrophes in the mill clause — deliberately, not accidentally", () => {
    // The pool holds ZERO U+2019 anywhere, so a curly apostrophe can only enter by a
    // hand-retyped string or a re-ingest that normalizes punctuation. `['’]` is the
    // family's standing choice; this pins that the acceptance is intended and that
    // the ASCII printing is the one the census counted.
    const printed = CLAUSES[1].text;
    expect(printed).not.toContain(RSQUO);
    expect(deriveAttackEffect(printed.replace("'", RSQUO))).toEqual(deriveAttackEffect(printed));
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Fuecoco sv02-035", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const spacingOut = FIXTURE_POOL["sv02-035"]?.attacks?.[SPACING_OUT_INDEX];
    expect(spacingOut).toEqual({
      cost: ["Colorless"],
      name: "Spacing Out",
      effect: CLAUSES[0].text,
    });
    // NO `damage` field at all (not a zero, not an empty string), so the gated heal is
    // the entire visible result of the declaration — and a tails moves nothing.
    expect(spacingOut?.damage).toBeUndefined();
    expect(deriveAttackEffect(spacingOut?.effect ?? "")).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: SPACING_OUT_HEAL }] },
    ]);
    expect(FIXTURE_POOL["sv02-035"]?.name).toBe("Fuecoco");
    expect(FIXTURE_POOL["sv02-035"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-035"]?.hp).toBe(90);
    // The index-1 control: real printed damage, no effect text at all.
    const flare = FIXTURE_POOL["sv02-035"]?.attacks?.[FLARE_INDEX];
    expect(flare).toEqual({ cost: ["Fire", "Colorless"], name: "Flare", damage: FLARE_DAMAGE });
    expect(flare?.effect).toBeUndefined();
  });

  it("matches FIXTURE_POOL char-for-char for Wiglett sv01-056", () => {
    const digALittle = FIXTURE_POOL["sv01-056"]?.attacks?.[DIG_A_LITTLE_INDEX];
    expect(digALittle).toEqual({
      cost: ["Colorless"],
      name: "Dig a Little",
      effect: CLAUSES[1].text,
    });
    expect(digALittle?.damage).toBeUndefined();
    expect(deriveAttackEffect(digALittle?.effect ?? "")).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardDeckTop", whose: "opponent", count: DIG_A_LITTLE_MILL }],
      },
    ]);
    expect(FIXTURE_POOL["sv01-056"]?.name).toBe("Wiglett");
    expect(FIXTURE_POOL["sv01-056"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-056"]?.hp).toBe(60);
    // The index-1 control shares the Colorless line with the gated attack, so nothing
    // but the INDEX tells the two apart on the same board.
    const ram = FIXTURE_POOL["sv01-056"]?.attacks?.[RAM_INDEX];
    expect(ram).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Ram",
      damage: RAM_DAMAGE,
    });
    expect(ram?.effect).toBeUndefined();
  });
});

describe("end to end — Fuecoco 'Spacing Out' (gated heal 30, NO printed damage)", () => {
  it("heals 30 on HEADS and nothing at all on TAILS", () => {
    // THE CLAIM OF THE WHOLE SLICE, and it takes both faces to state: the heads board
    // is what a gate-less build would produce on EVERY seed, so only the tails row
    // distinguishes the two. Collected over a fixed seed list rather than a chosen
    // seed, because no single seed is load-bearing here.
    const faces = new Map<CoinFace, { damage: number | undefined; healed: number }>();
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      const result = face(events);
      expect(result).toBeDefined();
      faces.set(result as CoinFace, {
        damage: done.players.p1.active?.damage,
        healed: all(events, "HEALED").length,
      });
    }
    // BOTH FACES WERE SEEN — otherwise the pair below would pass vacuously on one.
    expect([...faces.keys()].sort()).toEqual(["heads", "tails"]);
    expect(faces.get("heads")).toEqual({ damage: ATTACKER_HURT - SPACING_OUT_HEAL, healed: 1 });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_HURT, healed: 0 });
  });

  it("takes the coin on BOTH faces — a tails is a flip, not a no-op", () => {
    // `rngState` advances even when the branch is not spliced, which is what makes a
    // gate different from a condition (conditionGate reads public state and emits no
    // event). The opposite of the boards in boardHeal.test.ts, and worth asserting
    // rather than assuming: a build that checked the face BEFORE flipping would leave
    // the rng untouched on tails and desynchronise an online match on the next coin.
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_HURT);
      deepFreeze(state);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      expect(done.rngState).not.toBe(state.rngState);
      // EXACTLY ONE flip per declaration — one printed coin, one row, either face.
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.seat).toBe("p1");
      // And a TAILS is not a skipped effect: the sentence was read and the coin
      // decided. The loud row would be a lie, and it is the lie a reader that
      // returned null for gated text would tell.
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // No printed damage on either face — the heal is the whole declaration.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(done.players.p2.active?.damage).toBe(0);
    }
  });

  it("CLAMPS on heads and stays silent on tails — the same board, both faces", () => {
    // 10 damage against a printed 30 heals 10 and lands at 0 on heads; on tails the
    // 10 is still there. A clamp that went negative and a gate that always fired
    // would BOTH show up here, and nowhere else in the file.
    const faces = new Map<CoinFace, { damage: number | undefined; amounts: number[] }>();
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_BARELY_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        damage: done.players.p1.active?.damage,
        amounts: all(events, "HEALED").map((e) => e.amount),
      });
    }
    expect(faces.get("heads")).toEqual({ damage: 0, amounts: [ATTACKER_BARELY_HURT] });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_BARELY_HURT, amounts: [] });
  });

  it("WHIFFS SILENTLY on an undamaged attacker — even on HEADS, and still SIMULATED", () => {
    // Three states are distinguishable here and all three are real: tails (no branch),
    // heads-with-nothing-to-heal (branch ran, op whiffed), and skipped (never read).
    // Only the third deserves a loud row, and none of them deserves a HEALED.
    let sawHeads = false;
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", 0);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      if (face(events) === "heads") sawHeads = true;
      expect(all(events, "HEALED")).toHaveLength(0);
      expect(done.players.p1.active?.damage).toBe(0);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    expect(sawHeads).toBe(true);
  });

  it("runs on the OTHER seat too, healing THAT seat's attacker", () => {
    // Same card, opposite chair: `heal` resolves against `ctx.seat`, and the flip's
    // row carries that seat too. Cheap, and the only thing that catches a `"p1"`
    // literal that happens to be right on every P1 board.
    const faces = new Map<CoinFace, { damage: number | undefined; seat: string | undefined }>();
    for (const seed of SEEDS) {
      let state = board(seed);
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      state = fuecocoActive(state, "p2", ATTACKER_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p2",
        index: SPACING_OUT_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        damage: done.players.p2.active?.damage,
        seat: find(events, "ATTACK_EFFECT_COIN_FLIP")?.seat,
      });
    }
    expect(faces.get("heads")).toEqual({ damage: ATTACKER_HURT - SPACING_OUT_HEAL, seat: "p2" });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_HURT, seat: "p2" });
  });

  it("the index-1 control takes NO coin — the reader is keyed to the declared text", () => {
    // "Flare" prints a flat 30 with no effect text on the SAME card. It must flip
    // nothing, heal nothing and leave `rngState` alone — the sharpest form of "the
    // gate belongs to the sentence, not to the Pokémon".
    let state = fuecocoActive(board(3), "p1", ATTACKER_HURT);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLARE_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(state.rngState);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(done.players.p2.active?.damage).toBe(FLARE_DAMAGE);
    // An effect-less attack is not a SKIPPED one: there was nothing to skip.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("end to end — Wiglett 'Dig a Little' (gated mill 1, NO printed damage)", () => {
  it("mills ONE off the opponent's deck on HEADS and nothing on TAILS", () => {
    // The other consequent, and the other side of the table. Same pair of claims,
    // measured on a hidden zone instead of a damage counter — which is why the uids
    // are read off the EVENT and compared against the deck snapshot rather than
    // inferred from a length.
    const faces = new Map<
      CoinFace,
      { milled: string[]; deck: string[]; discard: string[]; rows: number }
    >();
    for (const seed of SEEDS) {
      const state = wiglettActive(board(seed), "p1");
      const victimDeck = state.players.p2.deck;
      const victimDiscard = state.players.p2.discard;
      deepFreeze(state);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      const result = face(events) as CoinFace;
      // The deltas are stated against THIS seed's deck, so the map below can hold
      // booleans-in-disguise rather than uids that differ per seed.
      faces.set(result, {
        milled: milledUids(events),
        // On heads the mill takes the top card and P2's turn-start draw takes the
        // next; on tails the draw is the only thing that moved. Naming both terms is
        // what keeps this an assertion about the OP rather than about a length.
        deck: victimDeck.slice(
          result === "heads" ? DIG_A_LITTLE_MILL + TURN_START_DRAW : TURN_START_DRAW,
        ),
        discard: [
          ...victimDiscard,
          ...victimDeck.slice(0, result === "heads" ? DIG_A_LITTLE_MILL : 0),
        ],
        rows: all(events, "DECK_TOP_DISCARDED").length,
      });
      expect(done.players.p2.deck).toEqual(faces.get(result)?.deck);
      expect(done.players.p2.discard).toEqual(faces.get(result)?.discard);
      expect(milledUids(events)).toEqual(
        victimDeck.slice(0, result === "heads" ? DIG_A_LITTLE_MILL : 0),
      );
    }
    expect([...faces.keys()].sort()).toEqual(["heads", "tails"]);
    expect(faces.get("heads")?.rows).toBe(1);
    expect(faces.get("heads")?.milled).toHaveLength(DIG_A_LITTLE_MILL);
    expect(faces.get("tails")?.rows).toBe(0);
    expect(faces.get("tails")?.milled).toEqual([]);
  });

  it("never touches the ATTACKER's own deck — the direction, on both faces", () => {
    // `whose: "opponent"` read the wrong way round passes every count assertion above
    // and fails exactly here. Both faces, because a gate that fired on tails would
    // show up as an own-deck delta on the seeds where it should not have run.
    for (const seed of SEEDS) {
      const state = wiglettActive(board(seed), "p1");
      const ownDeckBefore = state.players.p1.deck;
      const ownDiscardBefore = state.players.p1.discard;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      expect(done.players.p1.deck).toEqual(ownDeckBefore);
      expect(done.players.p1.discard).toEqual(ownDiscardBefore);
      // The row belongs to the seat whose deck shrank (events.ts: `seat` is the
      // OWNER), while the FLIP's row belongs to the attacker. Two seats, one
      // declaration — the pair that a single hardcoded seat cannot satisfy.
      if (face(events) === "heads") {
        expect(find(events, "DECK_TOP_DISCARDED")?.seat).toBe("p2");
      }
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.seat).toBe("p1");
      // No printed damage on either face, and never a skipped row.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(done.players.p2.active?.damage).toBe(0);
    }
  });

  it("runs on the OTHER seat too, aimed back the other way", () => {
    const faces = new Map<CoinFace, { rows: number; victimSeat: string | undefined }>();
    for (const seed of SEEDS) {
      let state = board(seed);
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      state = wiglettActive(state, "p2");
      const ownDeckBefore = state.players.p2.deck;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p2",
        index: DIG_A_LITTLE_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        rows: all(events, "DECK_TOP_DISCARDED").length,
        victimSeat: find(events, "DECK_TOP_DISCARDED")?.seat,
      });
      expect(done.players.p2.deck).toEqual(ownDeckBefore);
    }
    expect(faces.get("heads")).toEqual({ rows: 1, victimSeat: "p1" });
    expect(faces.get("tails")).toEqual({ rows: 0, victimSeat: undefined });
  });

  it("the index-1 control takes NO coin — off the SAME Colorless line", () => {
    // "Ram" costs {C}{C} where "Dig a Little" costs {C}, both out of the same
    // fix-energy line on the same card and the same board. Nothing but the declared
    // INDEX distinguishes them, so an implementation keyed to the card rather than to
    // the attack's text fails here.
    let state = wiglettActive(board(4), "p1");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const victimDeck = state.players.p2.deck;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RAM_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(state.rngState);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    // P2's deck is shorter by their turn-start DRAW and by nothing else — sharper
    // than "unchanged", which would be false here for a reason unrelated to the mill.
    expect(done.players.p2.deck).toEqual(victimDeck.slice(TURN_START_DRAW));
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(done.players.p2.active?.damage).toBe(RAM_DAMAGE);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("what the flip-gated family costs the rest of the engine — nothing", () => {
  it("never PARKS on either face — the attack resolves to an ordinary action phase", () => {
    // Neither consequent is a choice ("this Pokémon" is the attacker; "the top card"
    // is not a pick), so no face of either coin can leave a continuation behind. That
    // is the visible difference between this family and the flip-gated
    // `discardEnergy` twin, which DOES park inside its heads branch — same gate,
    // different consequent, which is the clearest possible statement that the gate
    // adds nothing of its own.
    for (const seed of SEEDS) {
      const heal = mustApply(fuecocoActive(board(seed), "p1", ATTACKER_HURT), {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      expect(heal.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
      expect(heal.state.pending).toEqual([]);
      const mill = mustApply(wiglettActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      expect(mill.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
      expect(mill.state.pending).toEqual([]);
    }
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    // If either grew a row the registry would win (`programFor(id)?.attack?.[index]
    // ?? derive`) and every assertion above would keep passing while testing nothing
    // about the text. Wiglett in particular has been a NEAR-MISS witness in two other
    // files since 0.81.0, so a hand-written row for it is exactly the shortcut this
    // pins shut.
    for (const id of ["sv02-035", "sv01-056"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });

  it("emits the SAME ops the bare anchors do — one action, two printings, no mechanism", () => {
    // The inventory rule, stated as an equality rather than described. `heal` has
    // shipped since 0.x and `discardDeckTop` since D130; this slice added a gate in
    // front of each and nothing else, so the inner programs are byte-identical to
    // what the bare sentences derive.
    expect(deriveAttackEffect(CLAUSES[0].text)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: deriveAttackEffect("Heal 30 damage from this Pokémon.") },
    ]);
    expect(deriveAttackEffect(CLAUSES[1].text)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: deriveAttackEffect("Discard the top card of your opponent's deck."),
      },
    ]);
  });
});
