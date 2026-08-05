import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  RETREAT_LOCK_DECK,
  activeUid,
  attachFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.62.0 → 0.63.0 — the retreat-LOCK seam (P3-M5 long tail, D112): "During your
// opponent's next turn, the Defending Pokémon can't retreat."
//
// The biggest single family left unbuilt — 16 printings / 14 names in the local
// pool, three sentence shapes, of which this slice builds the two attack riders:
//
//   L1 the bare rider (15 printings / 13 names — Espathra, Bombirdier ×2,
//      Tarountula, Talonflame, Corvisquire, Trevenant, Wugtrio, Houndstone ex,
//      Stunfisk, Inkay, Sneasel, Dusknoir ×2, Onix), and
//   L2 Paldean Clodsire's two-clause "Poison Ring", whose second sentence says
//      "that Pokémon" and is bound by the first to the same Defending Pokémon.
//
// (L3 — Snorlax swsh10.5-055 "Block", a continuous Ability aura — is a different
// mechanism and stays unbuilt.)
//
// It shares nothing with the D108–D111 retreat-COST seam but the word "retreat":
// this is a CONDITION on the Pokémon. The three things it turns on:
//
//   • the flag is NOT a §12 Special Condition — no Checkup tick, no status chip,
//     no attack gate, and it never crosses the wire as one (RedactedConditions
//     pins that shape), so it lives on InPlayPokemon, not in `conditions`;
//   • its LIFETIME is §13.4's paralysis clock reused verbatim — cleared in
//     runCheckup for `endedSeat` only, which is exactly "during your opponent's
//     next turn" once you follow which seat ends which turn;
//   • it ends EARLY wherever an effect of an attack ends: leaving the Active
//     Spot (a Switch dodges it — the block refuses retreating, not switching)
//     or evolving.

const BIND_DOWN_TEXT = "During your opponent's next turn, the Defending Pokémon can't retreat.";
const POISON_RING_TEXT =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    locker goes on P1's Active, the locked body on P2's, and P2 gets the two {C}
    its retreat 2 costs — so the ONLY thing that can refuse that retreat is the
    block itself. */
function armed(seed: number, locker = "sv02-016", energy = "fix-grass-energy"): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: RETREAT_LOCK_DECK, p2: RETREAT_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", locker);
  state = attachFromDeck(state, "p1", energy, 1);
  state = setActiveFromDeck(state, "p2", "fix-retreat2");
  return attachFromDeck(state, "p2", "fix-energy", 2);
}

/** P2's redacted retreat option — it rides the turn:action phase, and only the
    turn owner gets one. */
function retreatOnWire(state: GameState) {
  const phase = redactGame(state, "p2").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.retreat;
}

/** The retreat P2's armed body could otherwise pay: both attached {C}, promoting
    whatever the setup left on its bench. */
function p2Retreat(state: GameState) {
  return {
    type: "retreat" as const,
    seat: "p2" as const,
    discardEnergy: state.players.p2.active?.energy ?? [],
    promoteBenchIndex: 0,
  };
}

describe("the retreat lock — derived, not authored", () => {
  it("derives the bare rider to a single preventRetreat op", () => {
    expect(deriveAttackEffect(BIND_DOWN_TEXT)).toEqual([{ op: "preventRetreat" }]);
    // The typographic apostrophe derives identically — a re-ingest that changes
    // only punctuation must not silently un-simulate 15 printings.
    const typographic = BIND_DOWN_TEXT.replace(/'/g, "’");
    expect(deriveAttackEffect(typographic)).toEqual([{ op: "preventRetreat" }]);
  });

  it("derives Poison Ring's two clauses in printed order", () => {
    expect(deriveAttackEffect(POISON_RING_TEXT)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
  });

  it("is anchored end to end", () => {
    // Leading text, a missing period, a lowercase opener — each keeps the
    // attack on the loud ATTACK_EFFECT_SKIPPED path rather than half-simulating.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${BIND_DOWN_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(BIND_DOWN_TEXT.replace(".", ""))).toBeNull();
    expect(deriveAttackEffect(BIND_DOWN_TEXT.toLowerCase())).toBeNull();
    // Clodsire's LOCK CLAUSE alone is not the bare rider — it says "that
    // Pokémon". Matching it loosely would have swallowed the Poison in front.
    expect(
      deriveAttackEffect("During your opponent's next turn, that Pokémon can't retreat."),
    ).toBeNull();
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    expect(programFor("sv02-016")).toBeUndefined();
    expect(programFor("sv03-128")).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — the sentence is load-bearing", () => {
    // On the deriver path a one-character drift un-simulates the card with no
    // other failure anywhere, so the bytes get pinned here (ASCII apostrophes,
    // a real é — what the live D1 holds).
    expect(FIXTURE_POOL["sv02-016"]?.attacks?.[0]).toEqual({
      cost: ["Grass"],
      name: "Bind Down",
      damage: 10,
      effect: BIND_DOWN_TEXT,
    });
    expect(FIXTURE_POOL["sv03-128"]?.attacks?.[0]?.effect).toBe(POISON_RING_TEXT);
    expect(BIND_DOWN_TEXT).toContain("opponent's");
    expect(BIND_DOWN_TEXT).toContain("Pokémon");
    expect(BIND_DOWN_TEXT).not.toContain("’");
  });
});

describe("the retreat lock — applying it", () => {
  it("locks the DEFENDER and nothing else", () => {
    const state = armed(1);
    const defender = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "RETREAT_BLOCKED")).toEqual({
      type: "RETREAT_BLOCKED",
      seat: "p2",
      uid: defender,
    });
    expect(done.players.p2.active?.retreatBlocked).toBe(true);
    // Attacker-relative, like every "defender" op: the attacker's own Active is
    // untouched, and so is the bench on both boards.
    expect(done.players.p1.active?.retreatBlocked).toBe(false);
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) {
        expect(benched.retreatBlocked).toBe(false);
      }
    }
    // The card stops being flagged loudly — that is the whole point of a
    // deriver-path slice.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("is not a §12 Special Condition", () => {
    const { state: done, events } = mustApply(armed(2), { type: "attack", seat: "p1", index: 0 });
    // No STATUS_APPLIED, and `conditions` — the shape the wire and the playmat
    // status chips mirror field-by-field — is untouched.
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(done.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
  });

  it("applies Poison Ring's Poison AND its lock, in printed order", () => {
    const state = armed(3, "sv03-128", "fix-dark-energy");
    const defender = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    const applied = types(events);
    expect(applied.indexOf("STATUS_APPLIED")).toBeLessThan(applied.indexOf("RETREAT_BLOCKED"));
    expect(find(events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      uid: defender,
      status: "poisoned",
      poisonDamage: 10,
    });
    expect(done.players.p2.active?.retreatBlocked).toBe(true);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("does not inherit down the attack index — Muddy Hammer locks nothing", () => {
    let state = armed(4, "sv03-128", "fix-dark-energy");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("RETREAT_BLOCKED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });
});

describe("the retreat lock — the §11 gate", () => {
  it("refuses the very retreat the same board otherwise allows", () => {
    // Control: no attack, so nothing is locked — the retreat goes through.
    const control = armed(5);
    const promoted = benchTopUid(control, "p2", 0);
    const { state: retreated, events: ok } = mustApply(
      must(applyAction(control, { type: "endTurn", seat: "p1" })),
      p2Retreat(control),
    );
    expect(types(ok)).toContain("RETREATED");
    expect(activeUid(retreated, "p2")).toBe(promoted);

    // The same retreat, after Bind Down.
    const locked = mustApply(armed(5), { type: "attack", seat: "p1", index: 0 }).state;
    deepFreeze(locked);
    expectErr(locked, p2Retreat(locked), "RETREAT_PREVENTED");
  });

  it("blocks retreating but NOT attacking (unlike Asleep/Paralyzed)", () => {
    let locked = mustApply(armed(6), { type: "attack", seat: "p1", index: 0 }).state;
    expect(locked.phase.kind).toBe("turn:action");
    locked = attachFromDeck(locked, "p2", "fix-energy", 1);
    // fix-retreat2 has no attacks of its own, so put a locker on the Active and
    // re-apply the block: the point is that a blocked Pokémon still attacks.
    locked = setActiveFromDeck(locked, "p2", "sv02-016");
    locked = attachFromDeck(locked, "p2", "fix-grass-energy", 1);
    locked = {
      ...locked,
      players: {
        ...locked.players,
        p2: {
          ...locked.players.p2,
          // biome-ignore lint/style/noNonNullAssertion: the surgery above set it.
          active: { ...locked.players.p2.active!, retreatBlocked: true },
        },
      },
    };
    const { events } = mustApply(locked, { type: "attack", seat: "p2", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("closes the wire's `can` without a new wire field", () => {
    // The cost is unchanged — the block is not a cost modifier (D108–D111), so
    // the whole projection of it is one `&&` inside the existing `can`.
    const locked = mustApply(armed(7), { type: "attack", seat: "p1", index: 0 }).state;
    expect(retreatOnWire(locked)).toEqual({ cost: 2, can: false });
    const free = must(applyAction(armed(7), { type: "endTurn", seat: "p1" }));
    expect(retreatOnWire(free)).toEqual({ cost: 2, can: true });
  });
});

describe("the retreat lock — the lifetime is §13.4's paralysis clock", () => {
  it("survives the Checkup that ends the ATTACKER's turn, then lifts at the next one", () => {
    // The attack ends P1's turn, so a Checkup runs immediately with
    // endedSeat = p1. The block must NOT lift there — it is P2 who owes the turn.
    const { state: p2Turn, events: attackEvents } = mustApply(armed(8), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(attackEvents)).not.toContain("RETREAT_BLOCK_ENDED");
    expect(p2Turn.phase.kind).toBe("turn:action");
    expect(p2Turn.players.p2.active?.retreatBlocked).toBe(true);
    expectErr(p2Turn, p2Retreat(p2Turn), "RETREAT_PREVENTED");

    // P2 spends its locked turn and ends it — NOW the Checkup lifts the block.
    const locked = activeUid(p2Turn, "p2");
    const { state: p1Turn, events: endEvents } = mustApply(p2Turn, {
      type: "endTurn",
      seat: "p2",
    });
    expect(find(endEvents, "RETREAT_BLOCK_ENDED")).toEqual({
      type: "RETREAT_BLOCK_ENDED",
      seat: "p2",
      uid: locked,
    });
    expect(p1Turn.players.p2.active?.retreatBlocked).toBe(false);

    // …and on P2's next turn the retreat it was refused goes through.
    const back = must(applyAction(p1Turn, { type: "endTurn", seat: "p1" }));
    expect(types(mustApply(back, p2Retreat(back)).events)).toContain("RETREATED");
  });

  it("lifts only for the seat whose turn ended", () => {
    // P1's own Active is never blocked here, so the endedSeat-only clear has
    // nothing to do on P1's side: exactly one RETREAT_BLOCK_ENDED per lock.
    const p2Turn = mustApply(armed(9), { type: "attack", seat: "p1", index: 0 }).state;
    const { events } = mustApply(p2Turn, { type: "endTurn", seat: "p2" });
    expect(events.filter((e) => e.type === "RETREAT_BLOCK_ENDED")).toHaveLength(1);
  });
});

describe("the retreat lock — the early clears (an effect of an attack ends)", () => {
  it("ends when the Pokémon leaves the Active Spot — a Switch dodges it", () => {
    let state = mustApply(armed(10), { type: "attack", seat: "p1", index: 0 }).state;
    const locked = activeUid(state, "p2");
    state = handFromDeck(state, "p2", "sv01-194", 1);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv01-194"),
    });
    expect(types(events)).toContain("POKEMON_SWITCHED");
    const benched = done.players.p2.bench.find((p) => p.stack.includes(locked));
    expect(benched?.retreatBlocked).toBe(false);
    // Silent: the switch row already tells the story (events.ts).
    expect(types(events)).not.toContain("RETREAT_BLOCK_ENDED");
  });

  it("ends on evolution (§10)", () => {
    let state = armed(11);
    state = setActiveFromDeck(state, "p2", "fix-basic-1");
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(state.players.p2.active?.retreatBlocked).toBe(true);

    state = handFromDeck(state, "p2", "fix-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "fix-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });
});
