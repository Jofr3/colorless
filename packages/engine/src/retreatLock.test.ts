import { describe, expect, it } from "vitest";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  COMPOUND_COMPOSE_DECK,
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
  setDamage,
  types,
} from "./testFixtures";

const BIND_DOWN_TEXT = "During your opponent's next turn, the Defending Pokémon can't retreat.";
const POISON_RING_TEXT =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.";
const PRONOUN_LOCK_TEXT = "During your opponent's next turn, that Pokémon can't retreat.";
const SELF_LOCK_TEXT = "During your next turn, this Pokémon can't retreat.";
const SELF_HEAL_COMPOUND_50 =
  "Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";
const SELF_HEAL_COMPOUND_60 =
  "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
    expect(
      deriveAttackEffect("During your opponent's next turn, that Pokémon can't retreat."),
    ).toEqual([{ op: "preventRetreat" }]);
    expect(deriveAttackEffect(POISON_RING_TEXT)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
    // …and the clause anchor is anchored too — it must not eat the compound.
    expect(splitAttackTrailingClause(POISON_RING_TEXT)).toBeNull();
  });

  it("D410 — derives the PRONOUN clause to the same single op, both apostrophes", () => {
    expect(deriveAttackEffect(PRONOUN_LOCK_TEXT)).toEqual([{ op: "preventRetreat" }]);
    expect(deriveAttackEffect(PRONOUN_LOCK_TEXT.replace(/'/g, "’"))).toEqual([
      { op: "preventRetreat" },
    ]);
    // …and it is `^…$` like every sibling: a leading fragment, a missing period and
    // a lowercase opener all keep the attack on the loud path.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${PRONOUN_LOCK_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(PRONOUN_LOCK_TEXT.replace(".", ""))).toBeNull();
    expect(deriveAttackEffect(PRONOUN_LOCK_TEXT.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(SELF_LOCK_TEXT)).toEqual([{ op: "preventRetreat", target: "self" }]);
    expect(deriveAttackEffect(SELF_LOCK_TEXT.replace(/'/g, "’"))).toEqual([
      { op: "preventRetreat", target: "self" },
    ]);
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
      confusionDamage: 30,
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
    const locked = mustApply(armed(7), { type: "attack", seat: "p1", index: 0 }).state;
    expect(retreatOnWire(locked)).toEqual({ cost: 2, can: false });
    const free = must(applyAction(armed(7), { type: "endTurn", seat: "p1" }));
    expect(retreatOnWire(free)).toEqual({ cost: 2, can: true });
  });
});

describe("the retreat lock — the lifetime is §13.4's paralysis clock", () => {
  it("survives the Checkup that ends the ATTACKER's turn, then lifts at the next one", () => {
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

function selfArmed(seed: number): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-compound");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setDamage(state, "p1", 100);
}

/** The retreat P1's own armed body could otherwise pay. */
function p1Retreat(state: GameState) {
  return {
    type: "retreat" as const,
    seat: "p1" as const,
    discardEnergy: state.players.p1.active?.energy ?? [],
    promoteBenchIndex: 0,
  };
}

describe("D412 — the SELF-side retreat lock, composed off a heal head", () => {
  it("composes both printed compounds in printed order — heal, then lock", () => {
    for (const [text, amount] of [
      [SELF_HEAL_COMPOUND_50, 50],
      [SELF_HEAL_COMPOUND_60, 60],
    ] as const) {
      const split = splitAttackTrailingClause(text);
      expect(split).not.toBeNull();
      if (split === null) throw new Error("unreachable");
      expect(deriveAttackEffect(split.head)).toEqual([{ op: "heal", target: "self", amount }]);
      expect(deriveAttackEffect(split.tail)).toEqual([{ op: "preventRetreat", target: "self" }]);
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("locks the ATTACKER's own body, not the defender — the polarity trap", () => {
    const before = selfArmed(20);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: 9 });
    expect(find(events, "RETREAT_BLOCKED")).toEqual({
      type: "RETREAT_BLOCKED",
      seat: "p1",
      uid: activeUid(before, "p1"),
    });
    // The DEFENDER is untouched — the whole point of the seat being the near one.
    expect(state.players.p2.active?.retreatBlocked).toBe(false);
    expect(state.players.p2.active?.retreatLockedTurn).toBeNull();
    // …and the head ran: 100 damage healed by 50.
    expect(state.players.p1.active?.damage).toBe(50);
  });

  it("writes the STAMP and never the boolean, so the endedSeat clear cannot see it", () => {
    const before = selfArmed(21);
    const installTurn = before.turn;
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: 9 });
    const locked = state.players.p1.active;
    // `state.turn + 2` — the installer's OWN next turn, one full round away. The
    // `+ 1` its four sibling records use is a window on the OPPONENT's turn.
    expect(locked?.retreatLockedTurn).toBe(installTurn + 2);
    expect(locked?.retreatBlocked).toBe(false);
  });

  it("is still live on the installer's OWN next turn — the board the boolean fails", () => {
    let state = mustApply(selfArmed(22), { type: "attack", seat: "p1", index: 9 }).state;
    // The attack ended P1's turn, so a Checkup has already run with endedSeat = p1.
    // Walk to P1's next turn: P2 spends and ends theirs.
    expect(state.phase.kind).toBe("turn:action");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));

    expect(state.turn).toBe(state.players.p1.active?.retreatLockedTurn);
    expectErr(state, p1Retreat(state), "RETREAT_PREVENTED");
    // …and the wire agrees, through the same one reader rather than a second
    // hand-spelled disjunction: an offered retreat the gate then refuses is an
    // afford-then-reject.
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    expect(phase.retreat).toEqual({ cost: 1, can: false });
  });

  it("expires BY ARITHMETIC one round later, with no event and no clear", () => {
    let state = mustApply(selfArmed(23), { type: "attack", seat: "p1", index: 9 }).state;
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    // P1 sits out its locked turn; P2 takes another.
    const { events: p1End } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(p1End)).not.toContain("RETREAT_BLOCK_ENDED");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));

    // The stamp is UNCHANGED on the body — nothing cleared it — and it has simply
    // stopped answering, which is the difference between a stamp and a flag.
    expect(state.players.p1.active?.retreatLockedTurn).not.toBeNull();
    expect(state.turn).not.toBe(state.players.p1.active?.retreatLockedTurn);
    expect(types(mustApply(state, p1Retreat(state)).events)).toContain("RETREATED");
  });

  it("the 60-damage twin is the same program on a different scalar", () => {
    // The pair differs in the printed heal and in nothing else, so a board that
    // credited the lock to the wrong clause would disagree here.
    const before = setDamage(selfArmed(24), "p1", 100);
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: 10 });
    expect(state.players.p1.active?.damage).toBe(40);
    expect(state.players.p1.active?.retreatLockedTurn).toBe(before.turn + 2);
  });

  it("the 35 bare printings are byte-identical — the widening is additive", () => {
    const before = armed(26);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "RETREAT_BLOCKED")?.seat).toBe("p2");
    expect(state.players.p2.active?.retreatBlocked).toBe(true);
    // …and the bare arm writes the BOOLEAN, never the stamp: two halves, two
    // fields, and the imposed one keeps its own clock.
    expect(state.players.p2.active?.retreatLockedTurn).toBeNull();
    expect(state.players.p1.active?.retreatBlocked).toBe(false);
  });
});
