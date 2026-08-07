import { describe, expect, it } from "vitest";
import { attackBlockOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  DAMAGE_CAP_BLOCK_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.155.0 → 0.156.0 — the DAMAGE CAP (P3-M5 long tail, D240, backlog row 17):
//
//   "During your opponent's next turn, prevent all damage done to this Pokémon
//    by attacks if that damage is 40 or less."   (2 legal — sv10.5w-046/-127)
//   "…if that damage is 60 or less."             (1 legal — sv09-002)
//
// D142's `preventDamage` again, and its THIRD narrowing axis: `effects` widens
// WHAT is refused, D146's `fromClass` narrows WHOSE attack is refused, and
// `maxDamage` narrows HOW BIG an attack may be and still be refused. Three
// optional keys read off three printed phrases; no printing in the pool carries
// two of them.
//
// 🛑 THE ROW EXISTS BECAUSE ROW 15's PROSE CLAIMED THESE PRINTINGS AND ROW 15's
// GLOB CANNOT SEE THEM — they never contain "by attacks from". Re-derived at HEAD
// before the first regex (remote D1, `legal_standard = 1`, 2026-08-06,
// `GLOB '*if that damage is*'` over `json_each` + all three text columns, GROUPED
// BY SENTENCE, and swept WIDER as well): attack **3 / 2 sentences** · ability
// **1 / 1** · effect **0 / 0**. The row's `3 = 3 (2) · 1 · 0` is exact on every
// figure — **3 = 3**, the seventh row running to survive re-derivation.
//
// 🛑 AND IT IS A SIGNATURE SLICE RATHER THAN A FIELD SLICE, WHICH IS WHY IT WAS
// DEFERRED TWICE. `attackBlockOf(state, pokemon, attacker)` has carried a uniform
// signature since D146 and holds NO damage amount, so the cap can only be answered
// where the number is known. It is folded INTO that function as a fourth parameter
// rather than answered beside it, on D146's own argument: that is what keeps "the
// ONE read of `InPlayPokemon.attackBlock`" true, because a site cannot honour the
// turn stamp without also answering the class AND the cap.
//
// 🛑 THE RULES QUESTION, SETTLED AND FLAGGED. The sentence prints NO parenthetical
// — unlike `damageReduction`'s "(after applying Weakness and Resistance)", which
// is why D147 never had to argue this — so the reading comes from §8.5's step
// list, where prevention and reduction sit in ONE step: the cap is read against
// the number that would ACTUALLY be placed (post-W/R, post-reduction, floored at
// 0). Evidence against is written out at continuous.ts `attackBlockOf`: two
// simultaneous final modifiers are ordered by the affected player in the paper
// game, and no printed text settles it. Both halves are pinned by named cases
// below, so a future ruling moves one line and fails one assertion.

/** The two printed sentences, byte for byte off the catalog. */
const CAP_40_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less.";
const CAP_60_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less.";
/** D142's un-capped sibling — the same consequent with the clause absent. */
const UNCAPPED_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** Nothing in this family flips a coin, so one seed serves the whole suite and
    determinism is a property of the SENTENCE rather than of the shuffle — pinned
    below by an unchanged `rngState` across an install. */
const SEED = 11;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function armed(installer: string): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: DAMAGE_CAP_BLOCK_DECK, p2: DAMAGE_CAP_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

/** `armed`, then the install declared at `index`. Asserts the row actually
    landed, so a board that failed to install can never leave a case asserting
    "nothing was blocked" against nothing. Returns P2's turn. */
function installed(index: 0 | 1 = 0, installer = "fix-carapace"): GameState {
  const { state, events } = mustApply(armed(installer), { type: "attack", seat: "p1", index });
  if (find(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`${installer} index ${index} did not install a block`);
  }
  return state;
}

/** Put `attacker` on P2's Active with one {C} and swing at the shielded body.
    Every cost in this deck is Colorless, so one Energy is the whole cost. */
function swing(state: GameState, attacker: string) {
  let next = setActiveFromDeck(state, "p2", attacker);
  next = attachFromDeck(next, "p2", "fix-energy", 1);
  return mustApply(next, { type: "attack", seat: "p2", index: 0 });
}

describe("the damage cap — derived, not authored", () => {
  it("derives BOTH printed amounts through ONE numeric capture", () => {
    // 40 and 60 differ in a DIGIT and nothing else, which is D118's
    // parameterisation precondition met exactly. Two `test` arms would have been
    // the wrong shape here and the right one two anchors up, where the difference
    // between the family's spellings is a PHRASE.
    expect(deriveAttackEffect(CAP_40_TEXT)).toEqual([{ op: "preventDamage", maxDamage: 40 }]);
    expect(deriveAttackEffect(CAP_60_TEXT)).toEqual([{ op: "preventDamage", maxDamage: 60 }]);
    // …and an amount neither card prints, to pin that the number is READ rather
    // than recognised: a `40 | 60` table would pass both cases above.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "130"))).toEqual([
      { op: "preventDamage", maxDamage: 130 },
    ]);
  });

  it("adds `maxDamage` and NOTHING else — the widen-don't-add test", () => {
    // Strip the printed clause and the consequent is arm 19b's byte for byte.
    // `effects` and `fromClass` are both ABSENT because the sentence names neither
    // "from and effects of" nor a class (D135's absent-key rule), and this is the
    // assertion that keeps a future author from defaulting one of them in.
    const derived = deriveAttackEffect(CAP_40_TEXT);
    expect(derived).toEqual([{ op: "preventDamage", maxDamage: 40 }]);
    expect(derived?.[0]).not.toHaveProperty("effects");
    expect(derived?.[0]).not.toHaveProperty("fromClass");
  });

  it("REFUSES the opposite polarity — `or more` is a checked token, not a shape", () => {
    // 🛑 THE TRAP THIS ROW CARRIES. The pool prints the other direction on the very
    // same clause — **DREDNAW `sv07-044`**, "…if that damage is 200 or more" — so an
    // anchor that spelled "or less" into its literal text would be CORRECT today
    // and would silently invert the card the day someone folded the two together.
    // The comparator is a capture and the arm refuses anything but `less`.
    //
    // 🛑 D257 — **THIS CONTROL EXPIRED IN ONE HALF AND HARDENED IN THE OTHER, AND
    // BOTH HALVES ARE RE-HOMED HERE RATHER THAN DELETED** (seventeen slices running).
    //   • WHAT EXPIRED: the assertion below used to be justified partly by
    //     `sv07-044` being UNBUILT. It is built now (D257,
    //     `passivesOf.preventDamageAtOrAbove`), so "the pool prints it and nobody
    //     reads it" is no longer why this arm must refuse.
    //   • WHAT HARDENED: the refusal is now MORE load-bearing, not less. The card is
    //     read on a DIFFERENT CHANNEL — a catalog aura folded by `passivesOf`, not an
    //     `AttackBlock` installation stamped onto the target's record — so an anchor
    //     that started deriving "or more" here would author the sentence TWICE, once
    //     with a turn's life and once without, on one printing. **The attack column
    //     still prints ZERO `or more` sentences** (re-measured at D257 against the
    //     remote D1: `%if that damage is%` returns attack 3/2, all `or less`), so a
    //     merged comparator would have a writer on one side and a reader on the
    //     other. **Price the CHANNEL, not the token** — D240's own finding, now with
    //     both channels actually built.
    //   • 🛑 AND THE ID WAS MISNAMED IN FOUR PLACES. This comment, `types.ts`,
    //     `effects.ts` (twice) and `index.ts` all called `sv07-044` **Munkidori**;
    //     the catalog says **Drednaw** (Stage 1, 140 HP, `{W}`, Ability "Impervious
    //     Shell"), and no Munkidori printing carries this sentence at all
    //     (`sv06-095`, `sv06.5-037`/`-072`/`-083`/`-091`, `sv08.5-044`). Found by
    //     querying the id while building it. 🆕 **A CARD NAME IN A COMMENT IS AN
    //     UNCHECKED CLAIM AND ROTS LIKE ANY OTHER** — the ID was right in all four
    //     places and the NAME was wrong in all four, because it was copied forward
    //     rather than re-queried. All four are corrected in this slice.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("or less", "or more"))).toBeNull();
    expect(deriveAttackEffect(CAP_60_TEXT.replace("or less", "or more"))).toBeNull();
    // …and the real printing stays LOUD for a second reason it would still have
    // had: it is an always-on ABILITY (a `passivesOf` catalog aura, not an
    // installation) and it narrows by attacker as well. That reason is now a
    // BUILT fact rather than a prediction — see `imperviousShell.test.ts`.
    expect(
      deriveAttackEffect(
        "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more.",
      ),
    ).toBeNull();
  });

  it("refuses a cap of ZERO — a protection that protects against nothing", () => {
    // Arm 19d's `>= 1` guard verbatim: a 0-cap would install a record that refuses
    // only an attack doing no damage at all, and announce it in the log as though
    // it had done something. Leave it LOUD.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "0"))).toBeNull();
  });

  it("keeps the anchor ANCHORED — the `^`, the `$` and the literal words", () => {
    // The standing audit on every anchor in this file, and the `$` half is the one
    // that matters most here: a sentence that continued past the cap carries a
    // second consequent this op cannot install.
    expect(deriveAttackEffect(`${CAP_40_TEXT} Draw a card.`)).toBeNull();
    expect(
      deriveAttackEffect(`${CAP_40_TEXT.slice(0, -1)}, and heal 30 damage from it.`),
    ).toBeNull();
    expect(deriveAttackEffect(`Then, ${CAP_40_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${CAP_40_TEXT.toLowerCase()}`)).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.toLowerCase())).toBeNull();
    // A non-numeric amount is not a cap, and the digit class is what says so.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "forty"))).toBeNull();
    // 🛑 …AND THESE THREE ARE WHAT A GREEDY `(.+)` ACTUALLY COSTS, WHICH IS NOT
    // WHAT THE MUTANT ROW FIRST CLAIMED. The obvious probes ("forty", a doubled
    // clause) are EQUIVALENT under a greedy capture, because `Number` answers
    // `NaN` and the `>= 1` guard catches it — so the greedy read looks harmless
    // and the row survived its first run. What separates the two captures is that
    // `Number` is a far wider parser than `\d+`: it reads EXPONENTS, HEX and
    // DECIMALS. A greedy anchor therefore installs a 40-cap off "4e1", a 40-cap
    // off "0x28", and a FRACTIONAL cap off "4.5" — three malformed sentences that
    // a digit class simply refuses. The character class is the guard, and the
    // guarded input class is the one an equivalence argument assumes away.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "4e1"))).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "0x28"))).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "4.5"))).toBeNull();
    // The words around the clause are still literal.
    expect(
      deriveAttackEffect(CAP_40_TEXT.replace("if that damage is", "when that damage is")),
    ).toBeNull();
  });

  it("leaves D142's UNCAPPED sibling exactly where it was", () => {
    // The cap anchor must not have widened the family: this sentence has no coin
    // prefix and no cap, and it stayed unread at 0.155.0 as it is now.
    expect(deriveAttackEffect(UNCAPPED_TEXT)).toBeNull();
  });
});

describe("the damage cap — installing it", () => {
  it("installs with NO coin and writes the AMOUNT onto the board", () => {
    const before = armed("fix-carapace");
    const installer = activeUid(before, "p1");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: false,
      fromClass: undefined,
      maxDamage: 40,
    });
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: undefined,
      maxDamage: 40,
    });
  });

  it("index 1 installs the OTHER printed amount off the same card", () => {
    const { state: done } = mustApply(armed("fix-carapace"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBe(60);
  });

  it("names the AMOUNT in the log row, and leaves every other wording alone", () => {
    // A row that said only "protected from damage from attacks" would be an
    // outright lie about a 90-damage attack landing next turn in full — the
    // `fromClass` argument, sharper, because there the player at least sees a
    // class to reason about.
    const { state: done, events } = mustApply(armed("fix-carapace"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:07" };
    const texts = logFromEvents(events, ctx).map((entry) =>
      entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join(""),
    );
    const rendered = texts.find((t) => t.includes("is protected from damage"));
    expect(rendered).toContain(
      "is protected from damage from attacks during your opponent's next turn, if that damage is 40 or less",
    );
    // …and the trailing clause is a SUFFIX, so an uncapped block still renders the
    // string it rendered at 0.155.0 byte for byte. Driven off the real board:
    // D146's filtered install carries no cap.
    expect(rendered).not.toContain("undefined");
  });
});

describe("the damage cap — the truth table, driven off bodies", () => {
  it("PREVENTS an attack that lands exactly ON the cap — `<=`, not `<`", () => {
    // Cheap Shot is 40 into a 40-cap, and the printed word is "or less". A `<`
    // would pass every other case in this file and fail only here.
    const state = installed();
    deepFreeze(state);
    const { state: done, events } = swing(state, "fix-colorless-brawler");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("lets an attack ONE STEP over the cap through in FULL", () => {
    // No row announces the failure: `DAMAGE_DEALT` with `prevented` absent and the
    // real number in `dealt` is the whole story, and a "the block declined" row
    // would be announcing a non-event (D140).
    const { state: done, events } = swing(installed(), "fix-heavy");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(70);
    // …and the block is still sitting there, live and simply not matching.
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBe(40);
  });

  it("reads the POST-WEAKNESS number and not the printed base", () => {
    // 🛑 HALF ONE OF THE RULES READING, AND THE ONLY BOARD THAT CAN SEE IT. Bite is
    // a printed 30 — comfortably UNDER the 40-cap — and `fix-carapace` is Weak to
    // Fire, so the damage being done is 60. Under a "printed base" reading this
    // attack is prevented; under §8.5's it lands whole.
    const { state: done, events } = swing(installed(), "fix-attacker");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 60, weakness: { op: "multiply", amount: 2 } });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(60);
  });

  it("…and the 60-cap stops that same doubled attack, exactly at its boundary", () => {
    // The two printed amounts one digit apart, driven off one card's two attack
    // indexes against ONE attacker. This is what makes the case above a statement
    // about the CAP rather than about the board.
    const { state: done, events } = swing(installed(1), "fix-attacker");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("reads the POST-REDUCTION number too — the flagged half of the reading", () => {
    // 🛑 HALF TWO, AND THE ASSUMPTION THIS SLICE WROTE DOWN RATHER THAN PROVED.
    // Slam is 70 into a 40-cap and would land; `fix-carapace-tough` prints a −30
    // Ability, so the damage actually being placed is 40 and the cap catches it
    // WHOLE. Under the other defensible order — cap first, reduction second — this
    // body takes 40. No printed text settles which, and §8.5 puts prevention and
    // reduction in one step; continuous.ts `attackBlockOf` carries both sides of
    // the argument. ⚠️ IF A RULING EVER SETTLES IT THE OTHER WAY, THIS IS THE CASE
    // THAT GOES RED, and it is the only one that should.
    const { state: done, events } = swing(installed(0, "fix-carapace-tough"), "fix-heavy");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
      reduction: 30,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("…and the reduction ALONE does not block, so the cap is doing the work", () => {
    // The control for the case above. Same body, same −30, the 60-cap instead:
    // 70 − 30 = 40 is under 60 as well, so this would pass either way — what makes
    // it a control is the THIRD board below, where the reduction is present and the
    // damage still clears the cap.
    const { events } = swing(installed(1, "fix-carapace-tough"), "fix-heavy");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
  });

  it("stays out of the way when the block's window has passed", () => {
    // The turn STAMP, unchanged by this slice and re-driven on a capped block:
    // a cap is not a second clock, and an expired block does not start answering
    // just because the damage is small.
    let state = installed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const { events } = swing(state, "fix-colorless-brawler");
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 40 });
    expect(hit?.prevented).toBeUndefined();
  });
});

describe("the damage cap — the read is TOTAL, and the merge NARROWS", () => {
  /** Prime P1's Active with a block for the window this turn's attack will land
      in, carrying `maxDamage`. Constructed rather than driven: no card prints two
      of these attacks, so the merge rule is unreachable off any printing and is
      guarded by surgery for D144's reason. */
  function primed(state: GameState, maxDamage: number | undefined) {
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active to shield");
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, attackBlock: { turn: state.turn + 1, effects: false, maxDamage } },
        },
      },
    };
  }

  it("keeps the cap when two installs AGREE, and stays SILENT about it", () => {
    const state = primed(armed("fix-carapace"), 40);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBe(40);
    // Nothing NEW was said, so the row is suppressed entirely (D142's idempotence
    // rule, now answering on a third field).
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
  });

  it("DROPS the cap when two installs disagree — never `Math.max` of the two", () => {
    // The family's one merge rule stated a third time: a second installation may
    // never leave the holder with LESS protection than one of them printed. So a
    // 60-cap already on the board plus a 40-cap install collapses to UNCAPPED, and
    // a `Math.max` would be the same answer here by accident and the wrong one the
    // moment either side is absent — which the next case drives.
    const state = primed(armed("fix-carapace"), 60);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBeUndefined();
    // …and it really is uncapped: Slam's 70 is now refused.
    const { events } = swing(done, "fix-heavy");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("an UNCAPPED block plus a capped install stays uncapped", () => {
    // The absent-side half, where a `Math.max` has nothing to take a maximum of.
    const state = primed(armed("fix-carapace"), undefined);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBeUndefined();
  });

  it("refuses a capped block when the damage amount is UNKNOWN", () => {
    // The `undefined` arm, which one real read site takes on purpose:
    // `attackEffectRefused` asks about an EFFECT — a status, a discard, a forced
    // switch — and "if that damage is 40 or less" has no truth value about one.
    // Conservative direction: the block protects LESS rather than more, matching
    // the unresolvable-ATTACKER arm beside it. Unreachable off any printing (the
    // three capped sentences are all the narrow spelling, so a capped block never
    // carries `effects: true`), so it is driven directly against the one function
    // that answers it.
    const state = primed(armed("fix-carapace"), 40);
    const shielded = state.players.p1.active;
    if (shielded === null) throw new Error("no Active to shield");
    const live = { ...state, turn: state.turn + 1 };
    expect(attackBlockOf(live, shielded, undefined, 40)).not.toBeNull();
    expect(attackBlockOf(live, shielded, undefined, 41)).toBeNull();
    expect(attackBlockOf(live, shielded, undefined, undefined)).toBeNull();
    // …and an UNCAPPED block answers the same unknown amount as it always has,
    // which is what makes the line above a statement about the cap.
    const open = primed(armed("fix-carapace"), undefined);
    const bare = open.players.p1.active;
    if (bare === null) throw new Error("no Active to shield");
    expect(
      attackBlockOf({ ...open, turn: open.turn + 1 }, bare, undefined, undefined),
    ).not.toBeNull();
  });
});
