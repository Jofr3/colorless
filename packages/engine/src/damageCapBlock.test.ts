import { describe, expect, it } from "vitest";
import { attackBlockOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameState } from "./index";
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
  findEvent,
} from "./testFixtures";

/** The two printed sentences, byte for byte off the catalog. */
const CAP_40_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less.";
const CAP_60_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less.";
const UNCAPPED_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** Nothing in this family flips a coin, so one seed serves the whole suite and
    determinism is a property of the SENTENCE rather than of the shuffle — pinned
    below by an unchanged `rngState` across an install. */
const SEED = 11;

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

function installed(index: 0 | 1 = 0, installer = "fix-carapace"): GameState {
  const { state, events } = mustApply(armed(installer), { type: "attack", seat: "p1", index });
  if (findEvent(events, "ATTACK_BLOCK_APPLIED") === undefined) {
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
    expect(deriveAttackEffect(CAP_40_TEXT)).toEqual([{ op: "preventDamage", maxDamage: 40 }]);
    expect(deriveAttackEffect(CAP_60_TEXT)).toEqual([{ op: "preventDamage", maxDamage: 60 }]);
    // …and an amount neither card prints, to pin that the number is READ rather
    // than recognised: a `40 | 60` table would pass both cases above.
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "130"))).toEqual([
      { op: "preventDamage", maxDamage: 130 },
    ]);
  });

  it("adds `maxDamage` and NOTHING else — the widen-don't-add test", () => {
    const derived = deriveAttackEffect(CAP_40_TEXT);
    expect(derived).toEqual([{ op: "preventDamage", maxDamage: 40 }]);
    expect(derived?.[0]).not.toHaveProperty("effects");
    expect(derived?.[0]).not.toHaveProperty("fromClass");
  });

  it("REFUSES the opposite polarity — `or more` is a checked token, not a shape", () => {
    expect(deriveAttackEffect(CAP_40_TEXT.replace("or less", "or more"))).toBeNull();
    expect(deriveAttackEffect(CAP_60_TEXT.replace("or less", "or more"))).toBeNull();
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
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "4e1"))).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "0x28"))).toBeNull();
    expect(deriveAttackEffect(CAP_40_TEXT.replace("40", "4.5"))).toBeNull();
    // The words around the clause are still literal.
    expect(
      deriveAttackEffect(CAP_40_TEXT.replace("if that damage is", "when that damage is")),
    ).toBeNull();
  });

  it("leaves D142's UNCAPPED sibling exactly where it was", () => {
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
    expect(findEvent(events, "ATTACK_BLOCK_APPLIED")).toEqual({
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("lets an attack ONE STEP over the cap through in FULL", () => {
    const { state: done, events } = swing(installed(), "fix-heavy");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(70);
    // …and the block is still sitting there, live and simply not matching.
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBe(40);
  });

  it("reads the POST-WEAKNESS number and not the printed base", () => {
    const { state: done, events } = swing(installed(), "fix-attacker");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 60, weakness: { op: "multiply", amount: 2 } });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(60);
  });

  it("…and the 60-cap stops that same doubled attack, exactly at its boundary", () => {
    // The two printed amounts one digit apart, driven off one card's two attack
    // indexes against ONE attacker. This is what makes the case above a statement
    // about the CAP rather than about the board.
    const { state: done, events } = swing(installed(1), "fix-attacker");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("reads the POST-REDUCTION number too — the flagged half of the reading", () => {
    const { state: done, events } = swing(installed(0, "fix-carapace-tough"), "fix-heavy");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
      reduction: 30,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("…and the reduction ALONE does not block, so the cap is doing the work", () => {
    const { events } = swing(installed(1, "fix-carapace-tough"), "fix-heavy");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
  });

  it("stays out of the way when the block's window has passed", () => {
    let state = installed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const { events } = swing(state, "fix-colorless-brawler");
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 40 });
    expect(hit?.prevented).toBeUndefined();
  });
});

describe("the damage cap — the read is TOTAL, and the merge NARROWS", () => {
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
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
  });

  it("DROPS the cap when two installs disagree — never `Math.max` of the two", () => {
    const state = primed(armed("fix-carapace"), 60);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBeUndefined();
    // …and it really is uncapped: Slam's 70 is now refused.
    const { events } = swing(done, "fix-heavy");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("an UNCAPPED block plus a capped install stays uncapped", () => {
    // The absent-side half, where a `Math.max` has nothing to take a maximum of.
    const state = primed(armed("fix-carapace"), undefined);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.active?.attackBlock?.maxDamage).toBeUndefined();
  });

  it("refuses a capped block when the damage amount is UNKNOWN", () => {
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
