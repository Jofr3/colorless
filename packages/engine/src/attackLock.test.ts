import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  ATTACK_LOCK_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const BARE_TEXT = "During your next turn, this Pokémon can't attack.";
const COMPOUND_TEXT =
  "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
const PUT_HALF_ONLY = "Put 9 damage counters on 1 of your opponent's Pokémon.";

/** Ninetales' 9 counters in HP (§12 — one counter = 10). */
const NINE_COUNTERS_HP = 90;

const SEED = 7;

function armed(installer: "sv01-048" | "sv03-029"): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: ATTACK_LOCK_DECK, p2: ATTACK_LOCK_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  // The displaced setup Active is now on P1's bench, which is what the retreat
  // and switch cases need — asserted, because a bench-less board would make three
  // of them vacuous.
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  state =
    installer === "sv01-048"
      ? attachFromDeck(attachFromDeck(state, "p1", "fix-water-energy", 2), "p1", "fix-energy", 1)
      : attachFromDeck(state, "p1", "fix-fire-energy", 2);
  return state;
}

function installed(installer: "sv01-048" | "sv03-029"): GameState {
  const { state, events } = mustApply(armed(installer), { type: "attack", seat: "p1", index: 1 });
  let next = state;
  let rows = events;
  if (next.phase.kind === "effect:choose") {
    const resolved = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    next = resolved.state;
    rows = [...rows, ...resolved.events];
  }
  if (findEvent(rows, "ATTACK_LOCKED") === undefined) {
    throw new Error(`${installer} installed no lock`);
  }
  if (next.turn !== 3) throw new Error(`expected P2's turn 3, got ${next.turn}`);
  return next;
}

/** Hand the turn back to P1 — the LOCKED turn, `state.turn + 2` from the install. */
function heldTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${next.turn}`);
  return next;
}

/** The engine's rejection code for an action, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

describe("the self-lock — derived, not authored", () => {
  it("derives the BARE sentence to a bare `preventAttack`", () => {
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
    const op = (deriveAttackEffect(BARE_TEXT) as EffectOp[])[0] as object;
    expect(Object.keys(op)).toEqual(["op"]);
    expect(deriveAttackEffect(BARE_TEXT.replace(/'/g, "’"))).toEqual([{ op: "preventAttack" }]);
  });

  it("derives the COMPOUND to TWO ops in PRINTED ORDER", () => {
    expect(deriveAttackEffect(COMPOUND_TEXT)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: NINE_COUNTERS_HP,
        count: 1,
        source: "attack",
      },
      { op: "preventAttack" },
    ]);
    expect(deriveAttackEffect(COMPOUND_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(COMPOUND_TEXT),
    );
  });

  it("the compound's SECOND op is byte-identical to the bare sentence's only op", () => {
    const compound = deriveAttackEffect(COMPOUND_TEXT) as EffectOp[];
    expect(compound[1]).toEqual((deriveAttackEffect(BARE_TEXT) as EffectOp[])[0]);
  });

  it("reads the compound's FIRST SENTENCE alone as ONE op — the anchor is not a prefix", () => {
    expect(deriveAttackEffect(PUT_HALF_ONLY)).toHaveLength(1);
    expect(deriveAttackEffect(COMPOUND_TEXT)).toHaveLength(2);
    expect((deriveAttackEffect(PUT_HALF_ONLY) as EffectOp[])[0]).toEqual(
      (deriveAttackEffect(COMPOUND_TEXT) as EffectOp[])[0],
    );
    expect(deriveAttackEffect(PUT_HALF_ONLY)).not.toContainEqual({ op: "preventAttack" });
    expect(
      deriveAttackEffect(
        "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.",
      ),
    ).toBeNull();
  });

  it("is anchored end to end", () => {
    for (const text of [
      `Then, ${BARE_TEXT}`,
      BARE_TEXT.slice(0, -1),
      BARE_TEXT.toLowerCase(),
      `${COMPOUND_TEXT} Draw a card.`,
      COMPOUND_TEXT.slice(0, -1),
      // The two halves joined without the printed space.
      COMPOUND_TEXT.replace(". During", ".During"),
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), which states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BARE_TEXT}\n`)).toEqual([{ op: "preventAttack" }]);
  });

  it("refuses the TWO self-lock printings it deliberately does not map", () => {
    for (const text of [
      // An OPTIONAL damage bonus whose acceptance installs the lock (Copperajah
      // sv06.5-042) — a player decision in FRONT of the §8.5 pipeline.
      "You may do 100 more damage. If you do, during your next turn, this Pokémon can't attack.",
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("…and the THIRD is now MAPPED — the TAILS gate, re-pointed rather than deleted", () => {
    const gated = deriveAttackEffect(
      "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
    );
    expect(gated).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: deriveAttackEffect(BARE_TEXT),
      },
    ]);
    // …and this anchor does NOT claim the gated string, which is what keeps the
    // capitalised "During" plus `^…$` load-bearing rather than decorative.
    expect(gated).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("refuses the PER-ATTACK lock — the field warrant this anchor still declines", () => {
    for (const text of [
      // A TRAINER-scoped lock on a different turn and a whole board (Geeta
      // sv03-188/-218/-226) — not an attack effect at all, and refused here by
      // every property at once.
      "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck. During this turn, your Pokémon can't attack. (This includes Pokémon that come into play this turn.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ]);
    expect(
      deriveAttackEffect(
        "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Torrential Cannon."),
    ).toEqual([{ op: "preventAttackUse", attack: "Torrential Cannon" }]);
    expect(
      deriveAttackEffect("During your next turn, this Pokémon can't use Dirty Headbutt."),
    ).toEqual([{ op: "preventAttackUse", attack: "Dirty Headbutt" }]);
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "boostAttack", attack: "Echoed Voice", amount: 100 }]);
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
  });

  it("refuses a printed ZERO on the compound but accepts the ungrammatical singular", () => {
    // A printed "Put 0 damage counters" would PARK the attacker on a choice with
    // no possible outcome AND install a drawback for nothing — worse than an
    // unread sentence, so it stays LOUD.
    expect(deriveAttackEffect(COMPOUND_TEXT.replace("9 damage", "0 damage"))).toBeNull();
    expect(deriveAttackEffect(COMPOUND_TEXT.replace("9 damage", "1 damage"))).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 1, source: "attack" },
      { op: "preventAttack" },
    ]);
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    expect(programFor("sv01-048")).toBeUndefined();
    expect(programFor("sv03-029")).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim, at INDEX 1 on both", () => {
    expect(FIXTURE_POOL["sv01-048"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Colorless"],
      name: "Aqua Slash",
      damage: 120,
      effect: BARE_TEXT,
    });
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[1]).toEqual({
      cost: ["Fire", "Fire"],
      name: "Nine-Tailed Dance",
      effect: COMPOUND_TEXT,
    });
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[1]?.damage).toBeUndefined();
    // Index 0 on both is a plain hit with NO effect text: the control that proves
    // no program leaks across indices, and the attack a locked body is refused.
    expect(FIXTURE_POOL["sv01-048"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-029"]?.attacks?.[0]?.effect).toBeUndefined();
    for (const text of [BARE_TEXT, COMPOUND_TEXT]) {
      expect(text).toContain("can't");
      expect(text).not.toContain("’");
    }
  });
});

describe("the self-lock — installing it", () => {
  it("stamps `state.turn + 2` and announces it in the actor's voice", () => {
    const state = armed("sv01-048");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });

    expect(findEvent(events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid: installer,
    });
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: nothing on the opponent's board and
    // nothing on either Bench carries a lock.
    expect(done.players.p2.active?.attackLockedTurn).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackLockedTurn).toBeNull();
    }
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("keeps the printed 120 — a D125 tail board, damage AND a drawback", () => {
    const { events, state: done } = mustApply(armed("sv01-048"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_LOCKED"));
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(done.players.p2.active?.damage).toBe(120);
  });

  it("the COMPOUND parks on the pick and installs the lock on the RESUMED tail", () => {
    const state = armed("sv03-029");
    const installer = activeUid(state, "p1");
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Sentence one PARKS — the opponent has an Active and a Bench, so which body
    // takes the counters is a real decision. The lock has NOT installed yet.
    expect(opened.state.phase.kind).toBe("effect:choose");
    expect(types(opened.events)).not.toContain("ATTACK_LOCKED");
    expect(opened.state.players.p1.active?.attackLockedTurn).toBeNull();
    // Ninetales prints no damage, so nothing has happened on the board at all.
    expect(types(opened.events)).not.toContain("DAMAGE_DEALT");

    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    const order = types(resolved.events);
    // PRINTED ORDER, across the park: the counters, then the drawback.
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("ATTACK_LOCKED"));
    expect(findEvent(resolved.events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p1",
      uid: installer,
    });
    expect(resolved.state.players.p1.active?.attackLockedTurn).toBe(4);
    expect(resolved.state.turn).toBe(3);
  });

  it("places the counters FLAT on the chosen ACTIVE — §8.5 does not touch them", () => {
    let state = armed("sv03-029");
    // fix-titan is neutral; use a body with a real ×2 so the claim can fail.
    state = setActiveFromDeck(state, "p2", "sv01-048"); // Alomomola, ×2 Lightning
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(findEvent(resolved.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: NINE_COUNTERS_HP,
      source: "attack",
    });
    expect(resolved.state.players.p2.active?.damage).toBe(NINE_COUNTERS_HP);
    expect(types(resolved.events)).not.toContain("DAMAGE_DEALT");
  });

  it("places them flat on a BENCH pick too, and can Knock it Out", () => {
    let state = armed("sv03-029");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 60 HP — 90 counters is lethal
    const benchIndex = state.players.p2.bench.length - 1;
    const opened = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [{ seat: "p2", spot: { spot: "bench", index: benchIndex } }],
      },
    });
    const order = types(resolved.events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(findEvent(resolved.events, "PRIZES_OWED")).toMatchObject({ seat: "p1" });
    // …and the LOCK still installed, behind the Knock Out it caused. A build that
    // stopped the program at the KO would silently hand the attacker a free turn.
    expect(order.indexOf("ATTACK_LOCKED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(resolved.state.phase.kind).toBe("ko:takePrizes");
  });

  it("auto-takes with no park when the opponent has ONLY an Active", () => {
    // `opponentAny` candidates are never empty during an attack (the Active is
    // always there), so the degenerate board is one candidate rather than none —
    // the mandatory-snipe auto-take, not a whiff. The lock lands inline.
    let state = armed("sv03-029");
    state = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(NINE_COUNTERS_HP);
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
  });

  it("does not inherit down the attack index — index 0 installs nothing", () => {
    for (const installer of ["sv01-048", "sv03-029"] as const) {
      const { state: done, events } = mustApply(armed(installer), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(types(events)).not.toContain("ATTACK_LOCKED");
      expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    }
  });

  it("takes NO coin — the rngState is unchanged across a whole park-and-resolve", () => {
    const before = armed("sv03-029");
    const opened = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    const resolved = mustApply(opened.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(resolved.state.rngState).toBe(before.rngState);
    expect(types([...opened.events, ...resolved.events])).not.toContain("ATTACK_EFFECT_COIN_FLIP");
  });
});

describe("the self-lock — the WINDOW, driven across four turn boundaries", () => {
  it("is NOT live on the opponent's turn — the turn between install and window", () => {
    // The + 1 mutation's tombstone. A stamp of `state.turn + 1` would put the
    // window HERE, on a turn the holder cannot act on at all, and the card's
    // entire printed drawback would vanish without a single test noticing.
    const state = installed("sv01-048");
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    // The OPPONENT attacks normally inside it — the lock is not a board-wide
    // effect and never touched their body.
    let opponentTurn = setActiveFromDeck(state, "p2", "fix-attacker");
    opponentTurn = attachFromDeck(opponentTurn, "p2", "fix-energy", 1);
    const { events } = mustApply(opponentTurn, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("refuses BOTH of the holder's attacks on the window turn", () => {
    for (const installer of ["sv01-048", "sv03-029"] as const) {
      const held = heldTurn(installed(installer));
      expect(held.players.p1.active?.attackLockedTurn).toBe(held.turn);
      expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
      expect(refusal(held, "p1", 0)).toBe("ATTACK_PREVENTED");
    }
  });

  it("is a REJECTION, not a resolved attack — nothing is spent and the turn stays", () => {
    const held = heldTurn(installed("sv01-048"));
    deepFreeze(held);
    const result = applyAction(held, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      expect(result.error.message).toContain("§11");
    }
    // The board is untouched: still P1's turn, still their Energy, still their HP.
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(held.players.p1.active?.energy).toHaveLength(3);
  });

  it("expires by arithmetic — the holder attacks again two turns later", () => {
    let state = heldTurn(installed("sv01-048"));
    expect(refusal(state, "p1", 1)).toBe("ATTACK_PREVENTED");
    // Turn 5 is P2's, turn 6 is P1's again — and the stamp still says 4.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(6);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    // …and the NEW install replaces the stale stamp rather than accumulating on
    // top of it. Two installs, four turns apart, one number.
    expect(done.players.p1.active?.attackLockedTurn).toBe(8);
  });

  it("does NOT lift at the Checkup that ends the installer's own turn", () => {
    const { state: done, events } = mustApply(armed("sv01-048"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackLockedTurn).toBe(4);
    // …nor at the Checkup ending the OPPONENT's turn, the one immediately before
    // the window opens.
    const held = heldTurn(done);
    expect(held.players.p1.active?.attackLockedTurn).toBe(4);
  });

  it("gates ONLY attacking — every other turn action is still legal", () => {
    const held = heldTurn(installed("sv01-048"));
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");

    // ATTACH ENERGY — the §5.2 allowance is untouched.
    const withEnergy = handFromDeck(held, "p1", "fix-energy", 1);
    expect(
      applyAction(withEnergy, {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(withEnergy, "p1", "fix-energy"),
        target: { spot: "active" },
      }).ok,
    ).toBe(true);
    // PLAY A BASIC TO THE BENCH.
    const withBasic = handFromDeck(held, "p1", "fix-titan", 1);
    expect(
      applyAction(withBasic, {
        type: "playBasicToBench",
        seat: "p1",
        uid: handUid(withBasic, "p1", "fix-titan"),
      }).ok,
    ).toBe(true);
    // RETREAT (§11) — the lock is not `retreatBlocked`.
    expect(
      applyAction(held, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (held.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }).ok,
    ).toBe(true);
    // PLAY A TRAINER.
    const withTrainer = handFromDeck(held, "p1", "sv01-194", 1);
    expect(
      applyAction(withTrainer, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(withTrainer, "p1", "sv01-194"),
      }).ok,
    ).toBe(true);
    // END THE TURN.
    expect(applyAction(held, { type: "endTurn", seat: "p1" }).ok).toBe(true);
  });

  it("is NOT a §12 condition — a different code, and no status anywhere", () => {
    const held = heldTurn(installed("sv01-048"));
    expect(held.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    const asleep = setConditions(held, "p1", { rotation: "asleep" });
    expect(refusal(asleep, "p1", 1)).toBe("STATUS_PREVENTS_ATTACK");
  });

  it("the HUD projection agrees with the gate, attack by attack", () => {
    const held = heldTurn(installed("sv01-048"));
    const locked = redactGame(held, "p1").phase;
    if (locked.kind !== "turn:action") throw new Error(`expected turn:action, got ${locked.kind}`);
    expect(locked.attacks).toHaveLength(2);
    for (const attack of locked.attacks) {
      expect(attack.playable, `attack ${attack.index} offered under a lock`).toBe(false);
      expect(refusal(held, "p1", attack.index)).toBe("ATTACK_PREVENTED");
    }
    // …and two turns later the same projection offers them again, so the assertion
    // above is about the LOCK rather than about an unpayable cost.
    let later = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    const free = redactGame(later, "p1").phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.some((a) => a.playable)).toBe(true);
  });
});

describe("the self-lock — the §10 early clears, every one a LINE OF PLAY", () => {
  it("RETREATING clears it, and a Switch brings the body back able to attack", () => {
    let held = heldTurn(installed("sv01-048"));
    const locked = activeUid(held, "p1");
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");

    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (held.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    const benched = held.players.p1.bench.find((p) => p.stack.includes(locked));
    expect(benched?.attackLockedTurn).toBeNull();

    // …and GONE rather than merely unread. Switch it back and it attacks.
    held = handFromDeck(held, "p1", "sv01-194", 1);
    const switched = mustApply(held, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(held, "p1", "sv01-194"),
    });
    let back = switched.state;
    if (back.phase.kind === "effect:choose") {
      const index = back.players.p1.bench.findIndex((p) => p.stack.includes(locked));
      expect(index).toBeGreaterThanOrEqual(0);
      back = must(
        applyAction(back, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index } } },
        }),
      );
    }
    expect(activeUid(back, "p1")).toBe(locked);
    expect(back.players.p1.active?.attackLockedTurn).toBeNull();
    // The retreat discarded 2 of its 3 Energy, so put the cost back and declare.
    back = attachFromDeck(back, "p1", "fix-water-energy", 2);
    const { events } = mustApply(back, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    // …and the fresh declaration installs a FRESH window — "applied twice", with
    // both applications real rather than surgeried.
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
  });

  it("a Boss's Orders from the OPPONENT clears it — the gift they did not mean to give", () => {
    // The forced half of the same move, played on the turn BEFORE the window. The
    // opponent drags the locked body off the Active Spot to hit something softer,
    // and §10 un-locks it on the way out.
    let state = installed("sv01-048");
    const locked = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = next.players.p1.bench.find((p) => p.stack.includes(locked));
    expect(benched?.attackLockedTurn).toBeNull();
    expect(types(gusted.events)).not.toContain("ATTACK_LOCKED");
  });

  it("EVOLVING clears it, and the evolved body attacks the same turn", () => {
    let held = heldTurn(installed("sv01-048"));
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    held = handFromDeck(held, "p1", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    // §10 carried the Energy through, so the evolution attacks immediately.
    const attacked = mustApply(done, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(attacked.events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("a KNOCKED OUT holder takes the lock out of play with the stack", () => {
    // The promoted body is a DIFFERENT Pokémon and carries no lock — the fact that
    // makes this a per-Pokémon effect rather than a per-player one.
    let state = installed("sv01-048");
    state = setDamage(state, "p1", 100); // 110 HP Alomomola, 30 incoming from Bite
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: koed, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(koed.phase.kind).toBe("ko:takePrizes");
    let next = must(applyAction(koed, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    // Turn 4 is the window the dead Pokémon stamped — and the new Active is free.
    expect(next.turn).toBe(4);
    expect(next.players.p1.active?.attackLockedTurn).toBeNull();
  });
});

describe("the self-lock — two windows on ONE body", () => {
  it("carries D142's block and D143's lock at once, on two different turns", () => {
    let state = installed("sv01-048");
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: installed() places the Active.
          active: { ...state.players.p1.active!, attackBlock: { turn: 3, effects: true } },
        },
      },
    };
    // TURN 3 — the block's window. The opponent's attack is prevented, and the
    // lock is inert because it is not this turn.
    let attacker = setActiveFromDeck(state, "p2", "fix-attacker");
    attacker = attachFromDeck(attacker, "p2", "fix-energy", 1);
    const blocked = mustApply(attacker, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    // TURN 4 — the lock's window, reached by the attack itself ENDING turn 3
    // (§5.3). The block has expired by arithmetic while the lock is live: one
    // turn apart, one body, and no single number describes both.
    const held = blocked.state;
    expect(held.turn).toBe(4);
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(held.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(held.players.p1.active?.attackLockedTurn).toBe(4);
  });
});

describe("the self-lock — the §10 clear set is SWEPT, not listed", () => {
  function fullyEncumbered(pokemon: InPlayPokemon, retreatBlocked: boolean): InPlayPokemon {
    return {
      ...pokemon,
      // CONFUSED rather than Asleep: §12 lets a Confused Pokémon retreat, and
      // this case needs all three §10 routes to be legal on one board. It is shed
      // by exactly the same line.
      conditions: { rotation: "confused", poisonDamage: 20, burned: true, confusionDamage: 30 },
      retreatBlocked,
      attackBlock: { turn: 99, effects: true },
      attackLockedTurn: 99,
      retreatLockedTurn: 99,
      noWeaknessTurn: 99,
      scheduledEffect: { turn: 99, kind: "counters", amount: 90 },
      damageReduction: { turn: 99, amount: 20 },
      attackDamageDebuff: { turn: 99, amount: 20 },
      installedRecoil: { turn: 99, amount: 40 },
      lockedAttacks: [{ turn: 99, attackIndex: 0 }],
      boostedAttack: { turn: 99, attackIndex: 0, amount: 20 },
      handAttachMark: { turn: 99, barred: true, endsTurn: true, tripped: false, counters: 8 },
    };
  }

  /** What survived — the fields whose §10 value is not the shed one. */
  function stillSet(pokemon: InPlayPokemon | null | undefined): string[] {
    if (pokemon === null || pokemon === undefined) return ["<missing>"];
    const set: string[] = [];
    if (pokemon.conditions.rotation !== "none") set.push("rotation");
    if (pokemon.conditions.poisonDamage !== 0) set.push("poisonDamage");
    if (pokemon.conditions.burned) set.push("burned");
    if (pokemon.retreatBlocked) set.push("retreatBlocked");
    if (pokemon.attackBlock !== null) set.push("attackBlock");
    if (pokemon.attackLockedTurn !== null) set.push("attackLockedTurn");
    if (pokemon.retreatLockedTurn !== null) set.push("retreatLockedTurn");
    if (pokemon.noWeaknessTurn !== null) set.push("noWeaknessTurn");
    if (pokemon.scheduledEffect !== null) set.push("scheduledEffect");
    if (pokemon.damageReduction !== null) set.push("damageReduction");
    if (pokemon.attackDamageDebuff !== null) set.push("attackDamageDebuff");
    if (pokemon.installedRecoil !== null) set.push("installedRecoil");
    if (pokemon.lockedAttacks.length > 0) set.push("lockedAttacks");
    if (pokemon.boostedAttack !== null) set.push("boostedAttack");
    if (pokemon.handAttachMark !== null) set.push("handAttachMark");
    return set;
  }

  function encumbered(state: GameState, retreatBlocked: boolean): GameState {
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: heldTurn keeps the Active.
          active: fullyEncumbered(state.players.p1.active!, retreatBlocked),
        },
      },
    };
  }

  it("all THREE §10 routes shed the SAME fields — retreat, forced switch, evolve", () => {
    const held = heldTurn(installed("sv01-048"));
    const base = encumbered(held, true);
    const locked = activeUid(base, "p1");

    // 1. RETREAT (turn.ts clearOnLeavingActive) — on the one board it can be
    // entered from, i.e. without the retreat block that would refuse the action.
    const retreatable = encumbered(held, false);
    const retreated = must(
      applyAction(retreatable, {
        type: "retreat",
        seat: "p1",
        discardEnergy: (retreatable.players.p1.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    const afterRetreat = stillSet(retreated.players.p1.bench.find((p) => p.stack.includes(locked)));

    // 2. FORCED SWITCH (interpreter.ts switchInto), via the Switch Item.
    const withSwitch = handFromDeck(base, "p1", "sv01-194", 1);
    let switched = must(
      applyAction(withSwitch, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(withSwitch, "p1", "sv01-194"),
      }),
    );
    if (switched.phase.kind === "effect:choose") {
      switched = must(
        applyAction(switched, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const afterSwitch = stillSet(switched.players.p1.bench.find((p) => p.stack.includes(locked)));

    // 3. EVOLVE (turn.ts placeEvolution).
    const withEvo = handFromDeck(base, "p1", "fix-mola-stage1", 1);
    const evolved = must(
      applyAction(withEvo, {
        type: "evolve",
        seat: "p1",
        uid: handUid(withEvo, "p1", "fix-mola-stage1"),
        target: { spot: "active" },
      }),
    );
    const afterEvolve = stillSet(evolved.players.p1.active);

    // Every route sheds EVERYTHING, and — the load-bearing half — they agree.
    expect(afterRetreat).toEqual([]);
    expect(afterSwitch).toEqual([]);
    expect(afterEvolve).toEqual([]);
    // …and the encumbered body really was encumbered, so the three assertions
    // above are about the clears rather than about a board that never carried
    // anything.
    expect(stillSet(base.players.p1.active)).toEqual([
      "rotation",
      "poisonDamage",
      "burned",
      "retreatBlocked",
      "attackBlock",
      "attackLockedTurn",
      "retreatLockedTurn",
      "noWeaknessTurn",
      "scheduledEffect",
      "damageReduction",
      "attackDamageDebuff",
      "installedRecoil",
      "lockedAttacks",
      "boostedAttack",
      "handAttachMark",
    ]);
  });
});
