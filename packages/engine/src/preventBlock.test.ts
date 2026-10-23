import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackEffect,
  deriveAttackOptionalCostBoost,
  optionalCostBoostProgram,
} from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  PREVENT_BLOCK_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
  types,
  walkProgram,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

const WIDE_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";
const NARROW_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 27, 28, 30, 34, 35, 38] as const;
/** …and the complement, so the tails face is driven rather than assumed. */
const TAILS_SEEDS = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function armed(seed: number, installer: string): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: PREVENT_BLOCK_DECK, p2: PREVENT_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function installed(seed: number, installer: string): GameState {
  const { state, events } = mustApply(armed(seed, installer), {
    type: "attack",
    seat: "p1",
    index: 0,
  });
  if (find(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`seed ${seed} did not install a block on ${installer} (tails?)`);
  }
  return state;
}

describe("the gated PREVENT clause — derived, not authored", () => {
  it("derives the WIDE spelling to a gated preventDamage carrying `effects`", () => {
    expect(deriveAttackEffect(WIDE_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventDamage", effects: true }],
      },
    ]);
    expect(deriveAttackEffect(WIDE_TEXT.replace(/'/g, "’"))).toEqual(deriveAttackEffect(WIDE_TEXT));
  });

  it("derives the NARROW spelling with the `effects` key ABSENT, not false", () => {
    const derived = deriveAttackEffect(NARROW_TEXT);
    expect(derived).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventDamage" }],
      },
    ]);
    const gate = derived?.[0] as Extract<EffectOp, { op: "coinFlipGate" }>;
    expect(Object.keys(gate.then[0] as object)).toEqual(["op"]);
    expect(deriveAttackEffect(NARROW_TEXT.replace(/'/g, "’"))).toEqual(derived);
  });

  it("the two spellings differ in EXACTLY the `effects` field", () => {
    const wide = deriveAttackEffect(WIDE_TEXT) as EffectOp[];
    const narrow = deriveAttackEffect(NARROW_TEXT) as EffectOp[];
    const stripped = JSON.parse(JSON.stringify(wide).replace(',"effects":true', ""));
    expect(stripped).toEqual(narrow);
  });

  it("is anchored end to end", () => {
    for (const text of [WIDE_TEXT, NARROW_TEXT]) {
      expect(deriveAttackEffect(`Then, ${text}`), `leading text — ${text}`).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1)), `truncated — ${text}`).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase()), `lowercased — ${text}`).toBeNull();
    }
    for (const body of [
      "During your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "During your opponent's next turn, prevent all damage done to this Pokémon by attacks.",
    ]) {
      expect(deriveAttackEffect(body), `ungated body — ${body}`).toBeNull();
    }
  });

  it("refuses the FOUR printings of this family it deliberately does not map", () => {
    for (const text of [
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentKnockedOutByDamage" },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [{ op: "preventDamage", effects: true }],
      },
    ]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage", fromClass: { stage: "ancient" } }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage", fromClass: { stage: "basic" } }]);
    expect(
      deriveAttackEffect("During your opponent's next turn, the Defending Pokémon can't retreat."),
    ).toEqual([{ op: "preventRetreat" }]);
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    expect(programFor("sv03-004")).toBeUndefined();
    expect(programFor("sv03-151")).toBeUndefined();
    expect(programFor("sv02-097")?.attack).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — the sentence is load-bearing", () => {
    expect(FIXTURE_POOL["sv03-004"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Agility",
      damage: 10,
      effect: WIDE_TEXT,
    });
    expect(FIXTURE_POOL["sv03-151"]?.attacks?.[0]?.effect).toBe(NARROW_TEXT);
    // No printed `damage` on the narrow installer — the install is the entire
    // visible result of that declaration.
    expect(FIXTURE_POOL["sv03-151"]?.attacks?.[0]?.damage).toBeUndefined();
    for (const text of [WIDE_TEXT, NARROW_TEXT]) {
      expect(text).toContain("opponent's");
      expect(text).toContain("Pokémon");
      expect(text).not.toContain("’");
    }
  });
});

describe("the gated PREVENT clause — installing it", () => {
  it("HEADS stamps the OPPONENT's next turn and announces it in the actor's voice", () => {
    const state = armed(HEADS_SEEDS[0], "sv03-004");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: true,
    });
    // THE STAMP IS THE DURATION: turn 2 installed it, turn 3 is the opponent's,
    // and that is the only turn it answers on. Not a flag, so nothing anywhere
    // has to remember to clear it.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: the DEFENDER is untouched, and so
    // is every benched body on both boards.
    expect(done.players.p2.active?.attackBlock).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackBlock).toBeNull();
    }
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("keeps the printed 10 — a D125 tail board, damage AND an install", () => {
    const state = armed(HEADS_SEEDS[1], "sv03-004");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BLOCK_APPLIED"));
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("the NARROW spelling installs `effects: false`, and prints no damage at all", () => {
    const state = armed(HEADS_SEEDS[0], "sv03-151");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_BLOCK_APPLIED")?.effects).toBe(false);
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: false });
    // No printed damage on "Defense Curl", so the install is the whole result.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("TAILS installs nothing — and is a RESOLVED attack, not a skipped effect", () => {
    for (const seed of TAILS_SEEDS.slice(0, 4)) {
      const { state: done, events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
      expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
      expect(done.players.p1.active?.attackBlock).toBeNull();
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    }
  });

  it("the coin is TAKEN on both faces — rngState advances either way", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const before = armed(seed, "sv03-004");
      const { state: after } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
      expect(after.rngState).not.toBe(before.rngState);
    }
    // …and the seed table itself is pinned, so a deck edit that reshuffles this
    // suite fails HERE rather than turning every cross-turn case vacuous.
    for (const seed of HEADS_SEEDS) {
      const { events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    }
    for (const seed of TAILS_SEEDS) {
      const { events } = mustApply(armed(seed, "sv03-004"), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    }
  });

  it("does not inherit down the attack index — Cut installs nothing", () => {
    let state = armed(HEADS_SEEDS[0], "sv03-004");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(done.players.p1.active?.attackBlock).toBeNull();
  });
});

describe("the gated PREVENT clause — the DAMAGE half (both spellings)", () => {
  it("nulls the main §8.5 hit to 0 and flags it prevented", () => {
    for (const installer of ["sv03-004", "sv03-151"] as const) {
      let state = installed(HEADS_SEEDS[2], installer);
      state = setActiveFromDeck(state, "p2", "fix-attacker");
      state = attachFromDeck(state, "p2", "fix-energy", 1);
      deepFreeze(state);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });

      const hit = find(events, "DAMAGE_DEALT");
      expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
      expect(hit?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(done.players.p1.active?.damage).toBe(0);
    }
  });

  it("protects THIS Pokémon and not the rest of the board", () => {
    // One declaration, two answers: Spread Shot's 30 on the shielded Active is
    // prevented while its 20 lands on every benched body — "done to this Pokémon"
    // is a per-Pokémon claim, and the block never travels off the card it is on.
    let state = installed(HEADS_SEEDS[3], "sv03-004");
    state = setActiveFromDeck(state, "p2", "fix-sniper");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const benchBefore = state.players.p1.bench.map((p) => p.damage);
    expect(benchBefore.length).toBeGreaterThan(0);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });

    const rows = findAll(events, "DAMAGE_DEALT");
    const activeRow = rows.find((r) => r.uid === activeUid(state, "p1"));
    expect(activeRow).toMatchObject({ dealt: 0, prevented: true });
    for (const [i, before] of benchBefore.entries()) {
      expect(done.players.p1.bench[i]?.damage).toBe(before + 20);
    }
  });

  it("expires by arithmetic — the very next hit a turn later lands in full", () => {
    let state = installed(HEADS_SEEDS[4], "sv03-004");
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    // Turn 3 (the opponent's next turn): prevented.
    const blocked = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    // Turn 4 is P1's; they pass. Turn 5 is P2's again — and the stamp says 3.
    expect(blocked.state.turn).toBe(4);
    expect(blocked.state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    const p2Again = must(applyAction(blocked.state, { type: "endTurn", seat: "p1" }));
    expect(p2Again.turn).toBe(5);
    const { state: done, events } = mustApply(p2Again, { type: "attack", seat: "p2", index: 0 });
    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ dealt: 60 }); // ×2 Fire weakness, unblocked
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(60);
    // The stale stamp is STILL SITTING THERE and answers nothing — which is the
    // whole design: no boundary walk clears it and none has to.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });

  it("does NOT lift at the Checkup that ends the INSTALLER's own turn", () => {
    const { state: done, events } = mustApply(armed(HEADS_SEEDS[5], "sv03-004"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });
});

describe("the gated PREVENT clause — the EFFECTS half, and the field that splits it", () => {
  /** The same declaration into a WIDE block and into a NARROW one — the pair
      every case below runs, because the field's whole content is the difference. */
  function against(
    installer: string,
    seed: number,
    attacker: string,
    energy: { id: string; count: number },
    index = 0,
  ) {
    let state = installed(seed, installer);
    state = setActiveFromDeck(state, "p2", attacker);
    state = attachFromDeck(state, "p2", energy.id, energy.count);
    return mustApply(state, { type: "attack", seat: "p2", index });
  }

  it("refuses a §12 Special Condition — and the NARROW block does not", () => {
    const wide = against(
      "sv03-004",
      HEADS_SEEDS[6],
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(types(wide.events)).not.toContain("STATUS_APPLIED");
    expect(find(wide.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p1" });
    expect(wide.state.players.p1.active?.conditions.rotation).toBe("none");

    const narrow = against(
      "sv03-151",
      HEADS_SEEDS[6],
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(find(narrow.events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(types(narrow.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(narrow.state.players.p1.active?.conditions.rotation).toBe("asleep");
  });

  it("refuses the §11 RETREAT LOCK — two durated blocks meeting, one refusing the other", () => {
    const wide = against("sv03-004", HEADS_SEEDS[7], "sv02-016", {
      id: "fix-grass-energy",
      count: 1,
    });
    expect(types(wide.events)).not.toContain("RETREAT_BLOCKED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.retreatBlocked).toBe(false);
    // The attack's DAMAGE is refused by the other half of the same block.
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    const narrow = against("sv03-151", HEADS_SEEDS[7], "sv02-016", {
      id: "fix-grass-energy",
      count: 1,
    });
    expect(find(narrow.events, "RETREAT_BLOCKED")).toMatchObject({ seat: "p1" });
    expect(narrow.state.players.p1.active?.retreatBlocked).toBe(true);
    // …while the DAMAGE is still refused, because both spellings stop damage.
    expect(find(narrow.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("refuses a placed damage COUNTER — the sharpest split, because it is NOT damage", () => {
    const wide = against("sv03-004", HEADS_SEEDS[8], "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(types(wide.events)).not.toContain("COUNTERS_PLACED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.damage).toBe(0);

    const narrow = against("sv03-151", HEADS_SEEDS[8], "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(find(narrow.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 70,
      source: "attack",
    });
    expect(narrow.state.players.p1.active?.damage).toBe(70);
  });

  it("refuses an Energy discard off the defender — and takes the WHOLE op, not the prompt", () => {
    // Pincurchin "Needle Crush" is 70 damage AND a discard, so ONE declaration
    // shows the two halves together (wide) and SPLIT (narrow).
    const wide = against("sv03-004", HEADS_SEEDS[9], "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(find(wide.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(wide.events)).not.toContain("ENERGY_DISCARDED");
    expect(types(wide.events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(wide.state.players.p1.active?.energy).toHaveLength(1);
    // The refusal is taken in FRONT of the candidate scan, so the opponent is
    // never parked on a pick that will not happen.
    expect(wide.state.phase.kind).not.toBe("effect:choose");

    const narrow = against("sv03-151", HEADS_SEEDS[9], "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(find(narrow.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(narrow.events)).toContain("ENERGY_DISCARDED");
    expect(narrow.state.players.p1.active?.energy).toHaveLength(0);
  });

  it("a counter PUT through the NARROW block can still KNOCK OUT the holder", () => {
    let state = installed(HEADS_SEEDS[10], "sv03-151");
    state = setDamage(state, "p1", 20); // 80 HP Togedemaru, 70 counters incoming
    state = setActiveFromDeck(state, "p2", "sv02-097");
    state = attachFromDeck(state, "p2", "fix-psychic-energy", 2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p2" });
    expect(done.phase.kind).toBe("ko:takePrizes");
  });
});

describe("the gated PREVENT clause — what it does NOT block", () => {
  it("a TRAINER inside the window — the same op, refused only for an ATTACK", () => {
    let state = installed(HEADS_SEEDS[0], "sv03-004");
    expect(state.players.p1.active?.energy).toHaveLength(1);
    state = handFromDeck(state, "p2", "fix-hammer", 1);
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "fix-hammer"),
    });
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.energy).toHaveLength(0);
    // …and the block is untouched by the Trainer having resolved.
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
  });

  it("an ABILITY on the SAME op, inside the window — Trevenant's Checkup counter", () => {
    let state = installed(HEADS_SEEDS[3], "sv03-004");
    state = setActiveFromDeck(state, "p2", "sv03-012");
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Forest Miasma" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 10,
      source: "ability",
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.damage).toBe(10);
  });

  it("a §13 Checkup tick — a Special Condition is not an attack", () => {
    // Poison placed before the window (surgery: the deck prints no poisoner) still
    // ticks at the Checkup that ends the opponent's turn, INSIDE the window. The
    // block refuses effects of ATTACKS; §12/§13 is neither.
    let state = installed(HEADS_SEEDS[1], "sv03-004");
    state = setConditions(state, "p1", { poisonDamage: 10 });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", source: "poison" });
    expect(done.players.p1.active?.damage).toBe(10);
  });

  it("nothing the HOLDER does on their own turn — the stamp makes that structural", () => {
    let state = installed(HEADS_SEEDS[2], "sv03-004");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    state = setActiveFromDeck(state, "p1", "sv02-016");
    state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("the gated PREVENT clause — the early clears (an effect of an attack ends)", () => {
  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders inside the window", () => {
    // THE REACHABLE CLEAR, and the one the retreat block could not have: the
    // holder is the ATTACKER's own body, so the opponent can drag it off the spot
    // during the very turn the block covers, and the protection goes with it.
    let state = installed(HEADS_SEEDS[3], "sv03-151");
    const shielded = activeUid(state, "p1");
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
    const benched = next.players.p1.bench.find((p) => p.stack.includes(shielded));
    expect(benched?.attackBlock).toBeNull();
    expect(types(gusted.events)).not.toContain("ATTACK_BLOCK_APPLIED");
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(shielded));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    next = setActiveFromDeck(next, "p2", "fix-sniper");
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { state: hit, events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(hit.players.p1.bench[benchIndex]?.damage).toBe(20);
  });

  it("ends on evolution (§10) — unreachable in play, pinned anyway", () => {
    let state = must(
      applyAction(installed(HEADS_SEEDS[4], "sv03-004"), {
        type: "endTurn",
        seat: "p2",
      }),
    );
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: the surgery above set it.
          active: { ...state.players.p1.active!, attackBlock: { turn: 99, effects: true } },
        },
      },
    };
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.attackBlock).toBeNull();
  });

  it("ends on a RETREAT, the deliberate half of the same move", () => {
    let state = armed(HEADS_SEEDS[5], "sv03-004");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // biome-ignore lint/style/noNonNullAssertion: armed() places the Active.
          active: { ...state.players.p1.active!, attackBlock: { turn: 99, effects: true } },
        },
      },
    };
    const shielded = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    const { state: done } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: state.players.p1.active?.energy ?? [],
      promoteBenchIndex: 0,
    });
    const benched = done.players.p1.bench.find((p) => p.stack.includes(shielded));
    expect(benched?.attackBlock).toBeNull();
  });

  it("installing again REPLACES the stamp rather than accumulating", () => {
    // Two installs, two turns apart. The second writes its own window; nothing
    // adds up and nothing lingers, which is what a stamp buys over a counter.
    let state = installed(HEADS_SEEDS[6], "sv03-004");
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    const again = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const flip = find(again.events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === "heads") {
      expect(again.state.players.p1.active?.attackBlock).toEqual({ turn: 5, effects: true });
    } else {
      // A tails leaves the stale turn-3 stamp exactly where it was — harmless,
      // because it answers nothing, which is the point of not clearing it.
      expect(again.state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    }
  });
});

describe("the gated PREVENT clause — the guard is SWEPT, not listed", () => {
  function walkKinds(ops: readonly EffectOp[], kinds: Set<string>): Set<string> {
    for (const op of walkProgram(ops)) kinds.add(op.op);
    return kinds;
  }

  function attackOpKinds(): Set<string> {
    const kinds = new Set<string>();
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walkKinds(derived, kinds);
        const coin = attack.effect === undefined ? null : deriveAttackCoinFlip(attack.effect);
        if (coin !== null && coin.kind === "programPerHeads") walkKinds(coin.ops, kinds);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walkKinds(ops, kinds);
    }
    for (const effect of OFF_POOL_ATTACK_TEXT) {
      const derived = deriveAttackEffect(effect);
      expect(derived, `off-pool sentence stopped deriving: ${effect}`).not.toBeNull();
      if (derived !== null) walkKinds(derived, kinds);
    }
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const reading =
          attack.effect === undefined ? null : deriveAttackOptionalCostBoost(attack.effect);
        if (reading !== null)
          walkKinds(optionalCostBoostProgram(reading, 0, attack.effect ?? ""), kinds);
      }
    }
    return kinds;
  }

  const OFF_POOL_ATTACK_TEXT: readonly string[] = [
    "Look at the top 4 cards of your deck and put them back in any order.",
    "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.",
    "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon.",
    "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.",
    "During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).",
    "During your opponent's next turn, attacks used by the Defending Pokémon cost {C} more, and its Retreat Cost is {C} more.",
    "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.",
    "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)",
  ];

  const CLASSIFIED: Record<string, "blocked" | "untouched"> = {
    // — reaches one of the opponent's Pokémon —
    applyStatus: "blocked", // §12 condition on the defender (the "self" arm is inert)
    preventRetreat: "blocked", // the §11 rider
    damageActive: "blocked",
    counterEachAll: "blocked",
    counterUntilRemainingHp: "blocked",
    damageChosen: "blocked", // put-counter arm an effect; `deals` arm damage
    moveCountersToDefender: "blocked",
    moveCountersChosen: "blocked",
    spreadDamage: "blocked", // attack damage, on the Bench (nulled by the damage half)
    discardEnergy: "blocked", // the `opponentActive` arm; `yourActive` is the cost
    // — cannot touch the opponent's board at all —
    heal: "untouched",
    healEach: "untouched",
    healChosen: "untouched",
    damageSelf: "untouched",
    damageDefender: "blocked",
    discardDeckTop: "untouched", // the opponent's DECK is not a Pokémon
    bottomFromOpponentHand: "untouched", // …nor is their hand
    coinFlipGate: "untouched", // procedure; its body is classified above
    conditionGate: "untouched",
    optional: "untouched",
    recordGate: "untouched",
    preventDamage: "untouched",
    preventAttack: "blocked",
    reduceDamage: "untouched",
    installNoWeakness: "untouched",
    weakenDefenderAttacks: "blocked",
    flipLockAttack: "blocked",
    exposeDefender: "blocked",
    retypeDefenderWeakness: "blocked",
    taxDefender: "blocked",
    bountyDefender: "blocked",
    lockSideAttacks: "untouched",
    scheduleCounters: "blocked",
    installRecoil: "untouched",
    preventAttackUse: "untouched",
    boostAttack: "untouched",
    preventChosenAttack: "blocked",
    clearStatus: "untouched",
    drawCards: "untouched",
    drawUntilHandSize: "untouched",
    discardHand: "untouched",
    turnPrizeFaceUp: "untouched",
    discardPileRetrieval: "untouched",
    gust: "untouched",
    switchActive: "untouched",
    opponentSwitchOut: "untouched",
    damageNewActive: "blocked",
    moveEnergy: "untouched",
    searchDeck: "untouched",
    shuffleDeck: "untouched",
    revealOpponentHand: "untouched",
    randomFromOpponentHand: "untouched",
    opponentDiscardsFromHand: "untouched",
    attachEnergyFrom: "untouched",
    attachFromDeck: "untouched",
    lookAtTopN: "untouched",
    reorderTop: "untouched",
    attachFromTop: "untouched",
    attachFromHand: "untouched",
    returnSelf: "untouched",
    discardStadium: "untouched",
    knockOutDefender: "blocked",
    takePrize: "untouched",
  };

  it("classifies EVERY op an attack in the pool can produce", () => {
    const kinds = [...attackOpKinds()].sort();
    expect(kinds.length).toBeGreaterThan(10);
    for (const kind of kinds) {
      expect(CLASSIFIED[kind], `unclassified attack op: ${kind}`).toBeDefined();
    }
    // …and nothing in the table is dead weight, so it cannot rot into a list of
    // ops the deriver stopped emitting.
    for (const kind of Object.keys(CLASSIFIED)) expect(kinds).toContain(kind);
  });

  it("the sweep DESCENDS every gate, not only the coin", () => {
    const gated = deriveAttackEffect(
      "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
    );
    expect(gated?.[0]?.op).toBe("conditionGate");
    expect([...walkKinds(gated ?? [], new Set<string>())].sort()).toEqual([
      "conditionGate",
      "preventAttack",
    ]);
    expect(
      [
        ...walkKinds(
          [
            {
              op: "conditionGate",
              cond: { kind: "opponentActiveIsBasic" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [{ op: "preventAttack", target: "defender" }],
              otherwise: [{ op: "preventRetreat" }],
            },
          ],
          new Set<string>(),
        ),
      ].sort(),
    ).toEqual(["conditionGate", "preventAttack", "preventRetreat"]);
    // …and the sweep the table actually runs sees the gate off the pool.
    expect(attackOpKinds().has("conditionGate")).toBe(true);
  });

  it("…and D227's two: the `optional` wrapper and the §9.2 gate", () => {
    const wrapped = deriveAttackEffect(
      "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
    expect(wrapped?.[0]?.op).toBe("optional");
    expect([...walkKinds(wrapped ?? [], new Set<string>())].sort()).toEqual([
      "opponentSwitchOut",
      "optional",
    ]);
    const compound = deriveAttackEffect(
      "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
    expect(compound?.[1]?.op).toBe("recordGate");
    expect([...walkKinds(compound ?? [], new Set<string>())].sort()).toEqual([
      "opponentSwitchOut",
      "recordGate",
      "switchActive",
    ]);
    // …and the pool really does reach both gates, so the table's rows for them are
    // not dead weight either.
    expect(attackOpKinds().has("optional")).toBe(true);
    expect(attackOpKinds().has("recordGate")).toBe(true);
  });

  it("`invokedBy` and D139/D140's `source` agree on every op the deriver emits", () => {
    const walk = (ops: EffectOp[], expected: "ability" | "attack") => {
      for (const op of walkProgram(ops)) {
        if (op.op === "damageActive" || op.op === "damageChosen") {
          expect(op.source, `${op.op} under ${expected}`).toBe(expected);
        }
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, "attack");
      }
      for (const ability of programFor(card.id)?.abilities ?? []) walk(ability.program, "ability");
      for (const trigger of programFor(card.id)?.triggered ?? []) walk(trigger.program, "ability");
    }
  });

  /** The board every probe runs on: a live WIDE block on P1's Active, P2 to
      move on turn 3 with an Active of their own (the attacker `invokedBy`
      resolves through), and P2's own bodies damaged so the heals have work. */
  function probeBoard(): GameState {
    let state = installed(HEADS_SEEDS[0], "sv03-004");
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(state.turn).toBe(3);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    state = setDamage(state, "p2", 30);
    return state;
  }

  function benchBlockedBoard(): GameState {
    const state = probeBoard();
    const bench = state.players.p1.bench;
    expect(bench.length).toBeGreaterThan(0);
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: bench.map((p, i) =>
            i === 0 ? { ...p, attackBlock: { turn: 3, effects: true } } : p,
          ),
        },
      },
    };
  }

  type Probe = {
    op: EffectOp;
    /** The board, when the standard one will not do. */
    board?: () => GameState;
    sourceUid?: (state: GameState) => string | undefined;
    /** Did the op LAND? Read off the run, not off the absence of a refusal —
        "nothing was prevented" is not evidence that anything happened. */
    landed: (r: {
      before: GameState;
      after: GameState;
      events: GameEvent[];
      parked: boolean;
    }) => boolean;
  };

  const p1Active = (s: GameState) => s.players.p1.active;
  const p2Active = (s: GameState) => s.players.p2.active;

  const PROBES: Record<string, Probe> = {
    // — the seven ops that carry an `attackEffectRefused` check of their own —
    applyStatus: {
      op: { op: "applyStatus", target: "defender", status: "asleep" },
      landed: (r) => p1Active(r.after)?.conditions.rotation === "asleep",
    },
    preventRetreat: {
      op: { op: "preventRetreat" },
      landed: (r) => p1Active(r.after)?.retreatBlocked === true,
    },
    damageActive: {
      op: { op: "damageActive", amount: 30, source: "attack" },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    counterEachAll: {
      op: {
        op: "counterEachAll",
        amount: 30,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
      board: () => {
        const state = probeBoard();
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, bench: [] } },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    counterUntilRemainingHp: {
      op: {
        op: "counterUntilRemainingHp",
        target: "opponentActive",
        remainingHp: 10,
        source: "attack",
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    damageChosen: {
      op: { op: "damageChosen", target: "opponentAny", amount: 30, count: 1, source: "attack" },
      board: () => {
        const state = probeBoard();
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, bench: [] } },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    moveCountersToDefender: {
      op: { op: "moveCountersToDefender" },
      board: () => {
        // `setActiveFromDeck` displaces the current Active onto the Bench, which
        // is how this board gets the benched SOURCE the printed "move" needs.
        const state = setActiveFromDeck(probeBoard(), "p2", "fix-attacker");
        const bench = state.players.p2.bench;
        expect(bench.length).toBeGreaterThan(0);
        // Exactly ONE damaged benched body, so the source pick is forced.
        return {
          ...state,
          players: {
            ...state.players,
            p2: {
              ...state.players.p2,
              bench: bench.map((p, i) => (i === 0 ? { ...p, damage: 20 } : { ...p, damage: 0 })),
            },
          },
        };
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    moveCountersChosen: {
      op: { op: "moveCountersChosen" },
      board: () => {
        const state = setActiveFromDeck(probeBoard(), "p2", "fix-attacker");
        const bench = state.players.p2.bench;
        expect(bench.length).toBe(1); // the displaced Active — the forced SOURCE
        return clearBench(
          {
            ...state,
            players: {
              ...state.players,
              p2: { ...state.players.p2, bench: bench.map((p) => ({ ...p, damage: 20 })) },
            },
          },
          "p1",
        );
      },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    discardEnergy: {
      op: { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
      landed: (r) =>
        (p1Active(r.after)?.energy.length ?? 0) < (p1Active(r.before)?.energy.length ?? 0),
    },
    preventAttack: {
      op: { op: "preventAttack", target: "defender" },
      landed: (r) => p1Active(r.after)?.attackLockedTurn != null,
    },
    weakenDefenderAttacks: {
      op: { op: "weakenDefenderAttacks", amount: 20 },
      landed: (r) => p1Active(r.after)?.attackDamageDebuff != null,
    },
    flipLockAttack: {
      op: { op: "flipLockAttack" },
      landed: (r) => p1Active(r.after)?.attackFlipLockTurn != null,
    },
    taxDefender: {
      op: { op: "taxDefender" },
      landed: (r) => p1Active(r.after)?.costTaxTurn != null,
    },
    bountyDefender: {
      op: { op: "bountyDefender", amount: 2 },
      landed: (r) => p1Active(r.after)?.koBounty != null,
    },
    lockSideAttacks: {
      op: { op: "lockSideAttacks", whose: "opponent", maxEnergy: 2 },
      landed: (r) => r.after.players.p1.sideAttackLock != null,
    },
    exposeDefender: {
      op: { op: "exposeDefender", amount: 50 },
      landed: (r) => p1Active(r.after)?.damageVulnerability != null,
    },
    retypeDefenderWeakness: {
      op: { op: "retypeDefenderWeakness", type: "Colorless" },
      landed: (r) => p1Active(r.after)?.weaknessRetype != null,
    },
    scheduleCounters: {
      op: { op: "scheduleCounters", amount: 90 },
      landed: (r) => p1Active(r.after)?.scheduledEffect != null,
    },
    spreadDamage: {
      op: { op: "spreadDamage", target: "opponentBench", amount: 20 },
      board: benchBlockedBoard,
      landed: (r) =>
        (r.after.players.p1.bench[0]?.damage ?? 0) > (r.before.players.p1.bench[0]?.damage ?? 0),
    },
    damageDefender: {
      // The §9.2 slot count is fed directly — the op multiplies `per` by what an
      // earlier op recorded, and `runProgram` takes that record as an argument.
      op: { op: "damageDefender", per: 30, count: "discarded" },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    damageNewActive: {
      op: { op: "damageNewActive", amount: 30 },
      landed: (r) => (p1Active(r.after)?.damage ?? 0) > (p1Active(r.before)?.damage ?? 0),
    },
    // — and the ops a live block has no business near: every one LANDS —
    heal: {
      op: { op: "heal", target: "self", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    healEach: {
      op: { op: "healEach", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    healChosen: {
      // One damaged own body, so the pick is forced and the run completes.
      op: { op: "healChosen", amount: 10 },
      landed: (r) =>
        (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0) || r.parked,
    },
    damageSelf: {
      op: { op: "damageSelf", amount: 10 },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) > (p2Active(r.before)?.damage ?? 0),
    },
    discardDeckTop: {
      op: { op: "discardDeckTop", whose: "opponent", count: 1 },
      landed: (r) => r.after.players.p1.deck.length < r.before.players.p1.deck.length,
    },
    clearStatus: {
      op: { op: "clearStatus" },
      board: () => setConditions(probeBoard(), "p2", { burned: true }),
      landed: (r) =>
        p2Active(r.before)?.conditions.burned === true &&
        p2Active(r.after)?.conditions.burned === false,
    },
    bottomFromOpponentHand: {
      op: { op: "bottomFromOpponentHand", filter: { kind: "supporter" } },
      board: () => handFromDeck(probeBoard(), "p1", "sv02-172", 1),
      landed: (r) => r.parked || r.after.players.p1.hand.length < r.before.players.p1.hand.length,
    },
    discardStadium: {
      op: { op: "discardStadium" },
      board: () => {
        const state = probeBoard();
        const [uid, ...rest] = state.players.p1.deck;
        if (uid === undefined) throw new Error("p1's deck is empty");
        return {
          ...state,
          players: { ...state.players, p1: { ...state.players.p1, deck: rest } },
          stadium: { uid, owner: "p1" as const },
        };
      },
      landed: (r) => r.before.stadium !== null && r.after.stadium === null,
    },
    coinFlipGate: {
      // A procedure: the evidence it ran is that the COIN WAS TAKEN. Its body is
      // classified on its own line, which is what makes this the right witness
      // rather than a weaker one about the branch.
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      op: { op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 10 }] },
      landed: (r) => types(r.events).includes("ATTACK_EFFECT_COIN_FLIP"),
    },
    conditionGate: {
      // Both arms heal, so the branch taken does not decide the witness — the
      // question here is whether the GATE runs at all under a live block.
      op: {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "heal", target: "self", amount: 10 }],
        otherwise: [{ op: "heal", target: "self", amount: 10 }],
      },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    optional: {
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      op: { op: "optional", note: "You may draw a card.", then: [{ op: "drawCards", count: 1 }] },
      landed: (r) => r.parked,
    },
    recordGate: {
      op: {
        op: "recordGate",
        slot: "discarded",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "heal", target: "self", amount: 10 }],
      },
      landed: (r) => (p2Active(r.after)?.damage ?? 0) < (p2Active(r.before)?.damage ?? 0),
    },
    preventDamage: {
      op: { op: "preventDamage", effects: true },
      landed: (r) => p2Active(r.after)?.attackBlock != null,
    },
    reduceDamage: {
      op: { op: "reduceDamage", amount: 20 },
      landed: (r) => p2Active(r.after)?.damageReduction != null,
    },
    installNoWeakness: {
      op: { op: "installNoWeakness" },
      landed: (r) => p2Active(r.after)?.noWeaknessTurn != null,
    },
    installRecoil: {
      op: { op: "installRecoil", amount: 100 },
      landed: (r) => p2Active(r.after)?.installedRecoil != null,
    },
    preventAttackUse: {
      op: { op: "preventAttackUse", attack: "Bite" },
      board: () => setActiveFromDeck(probeBoard(), "p2", "fix-attacker"),
      landed: (r) => (p2Active(r.after)?.lockedAttacks.length ?? 0) > 0,
    },
    boostAttack: {
      op: { op: "boostAttack", attack: "Bite", amount: 100 },
      board: () => setActiveFromDeck(probeBoard(), "p2", "fix-attacker"),
      landed: (r) => p2Active(r.after)?.boostedAttack != null,
    },
    preventChosenAttack: {
      op: { op: "preventChosenAttack" },
      landed: (r) => r.parked || (p1Active(r.after)?.lockedAttacks.length ?? 0) > 0,
    },
    drawCards: {
      op: { op: "drawCards", count: 1 },
      landed: (r) => r.after.players.p2.hand.length > r.before.players.p2.hand.length,
    },
    turnPrizeFaceUp: {
      op: { op: "turnPrizeFaceUp" },
      board: () => setPrizes(probeBoard(), "p2", 1),
      landed: (r) =>
        !r.parked &&
        r.before.players.p2.faceUpPrizes.length === 0 &&
        r.after.players.p2.faceUpPrizes.length === 1 &&
        r.after.players.p2.faceUpPrizes[0] === r.before.players.p2.prizes[0],
    },
    discardHand: {
      op: { op: "discardHand" },
      landed: (r) =>
        r.after.players.p2.hand.length === 0 &&
        r.after.players.p2.discard.length ===
          r.before.players.p2.discard.length + r.before.players.p2.hand.length &&
        r.before.players.p2.hand.length > 0,
    },
    drawUntilHandSize: {
      op: { op: "drawUntilHandSize", size: 5 },
      board: () => {
        const state = probeBoard();
        const p2 = state.players.p2;
        expect(p2.hand.length).toBeGreaterThan(1);
        return {
          ...state,
          players: {
            ...state.players,
            p2: { ...p2, hand: p2.hand.slice(0, 1), deck: [...p2.hand.slice(1), ...p2.deck] },
          },
        };
      },
      landed: (r) => r.after.players.p2.hand.length === 5,
    },
    gust: {
      op: { op: "gust" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.bench.length).toBeGreaterThan(0);
        return {
          ...state,
          players: {
            ...state.players,
            p1: { ...state.players.p1, bench: state.players.p1.bench.slice(0, 1) },
          },
        };
      },
      landed: (r) => r.after.players.p1.active?.stack[0] !== r.before.players.p1.active?.stack[0],
    },
    switchActive: {
      op: { op: "switchActive" },
      board: () => {
        // The ACTOR's own Bench, which the standard board does not have — every
        // other probe on this page reaches ACROSS the table, so P2's side has
        // never needed one. Exactly one body, so `parkOrForce` forces.
        const state = benchFromDeck(probeBoard(), "p2", "fix-titan");
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      // The ACTOR's Active changed — and the assertion is deliberately about P2's
      // spot, not P1's: a build that ran `gust` here would move P1's and this
      // would read `false`.
      landed: (r) => r.after.players.p2.active?.stack[0] !== r.before.players.p2.active?.stack[0],
    },
    opponentSwitchOut: {
      op: { op: "opponentSwitchOut" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.bench.length).toBeGreaterThan(0);
        return {
          ...state,
          players: {
            ...state.players,
            p1: { ...state.players.p1, bench: state.players.p1.bench.slice(0, 1) },
          },
        };
      },
      landed: (r) => r.after.players.p1.active?.stack[0] !== r.before.players.p1.active?.stack[0],
    },
    moveEnergy: {
      op: { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
      board: () => {
        const state = benchFromDeck(
          attachFromDeck(probeBoard(), "p2", "fix-energy", 1),
          "p2",
          "fix-titan",
        );
        expect(state.players.p2.active?.energy.length).toBeGreaterThan(0);
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    searchDeck: {
      op: { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      board: () => {
        const state = probeBoard();
        expect(state.players.p2.bench.length).toBeLessThan(5);
        const basics = state.players.p2.deck.filter(
          (uid) => FIXTURE_POOL[state.cardIdByUid[uid] ?? ""]?.stage === "Basic",
        );
        expect(basics.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => r.parked,
    },
    shuffleDeck: {
      op: { op: "shuffleDeck" },
      landed: (r) => types(r.events).includes("SHUFFLE"),
    },
    revealOpponentHand: {
      op: { op: "revealOpponentHand" },
      board: () => {
        const state = probeBoard();
        // The op reads P2's OPPONENT, i.e. P1 — whose hand must be non-empty, or
        // "the reveal happened" and "there was nothing to reveal" look alike.
        expect(state.players.p1.hand.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => (find(r.events, "HAND_REVEALED")?.uids.length ?? 0) > 0,
    },
    randomFromOpponentHand: {
      op: { op: "randomFromOpponentHand", to: "discard" },
      board: () => {
        const state = probeBoard();
        expect(state.players.p1.hand.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) =>
        r.after.players.p1.hand.length < r.before.players.p1.hand.length &&
        r.after.rngState !== r.before.rngState,
    },
    opponentDiscardsFromHand: {
      op: { op: "opponentDiscardsFromHand", count: 1 },
      board: () => {
        const state = probeBoard();
        // Strictly greater than the printed count, or this parks nothing.
        expect(state.players.p1.hand.length).toBeGreaterThan(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    attachEnergyFrom: {
      op: { op: "attachEnergyFrom", source: "discard" },
      board: () => {
        const state = benchFromDeck(
          discardFromDeck(probeBoard(), "p2", "fix-energy", 1),
          "p2",
          "fix-titan",
        );
        expect(state.players.p2.discard).toHaveLength(1);
        expect(state.players.p2.active).not.toBeNull();
        expect(state.players.p2.bench).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    discardPileRetrieval: {
      op: { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 1 },
      board: () => {
        const state = discardFromDeck(probeBoard(), "p2", "fix-energy", 1);
        expect(state.players.p2.discard).toHaveLength(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    attachFromDeck: {
      op: { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
      board: () => {
        const state = probeBoard();
        expect(
          state.players.p2.deck.filter((uid) => state.cardIdByUid[uid]?.includes("energy")).length,
        ).toBeGreaterThan(0);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    lookAtTopN: {
      op: { op: "lookAtTopN", n: 7, filter: { kind: "anyCard" }, max: 1 },
      board: () => {
        const state = probeBoard();
        // The window has to hold something, or the op no-ops for a reason that
        // has nothing to do with the block — the vacuous-probe shape.
        expect(state.players.p2.deck.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) => r.parked,
    },
    reorderTop: {
      op: { op: "reorderTop", n: 5 },
      board: () => {
        const state = probeBoard();
        // Two or more, or the op resolves inline for a reason that has nothing to
        // do with the block — the vacuous-probe shape, and here it is arithmetic:
        // one card admits exactly one ordering, so a 1-card deck never parks.
        expect(state.players.p2.deck.length).toBeGreaterThan(1);
        return state;
      },
      landed: (r) => r.parked,
    },
    attachFromTop: {
      op: { op: "attachFromTop", n: 10, filter: { kind: "anyEnergy" }, max: "any" },
      board: () => {
        const state = probeBoard();
        expect(
          state.players.p2.deck
            .slice(0, 10)
            .filter((uid) => state.cardIdByUid[uid]?.includes("energy")).length,
        ).toBeGreaterThan(0);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    attachFromHand: {
      op: { op: "attachFromHand", filter: { kind: "basicEnergy" } },
      board: () => {
        const state = handFromDeck(probeBoard(), "p2", "fix-energy", 2);
        expect(
          state.players.p2.hand.filter((uid) => state.cardIdByUid[uid] === "fix-energy").length,
        ).toBeGreaterThanOrEqual(2);
        expect(state.players.p2.active).not.toBeNull();
        return state;
      },
      landed: (r) => r.parked,
    },
    returnSelf: {
      op: { op: "returnSelf", dest: "deck" },
      sourceUid: (state) => {
        const active = state.players.p2.active;
        expect(active).not.toBeNull();
        return active === null ? undefined : active.stack[active.stack.length - 1];
      },
      landed: (r) => r.before.players.p2.active !== null && r.after.players.p2.active === null,
    },
    knockOutDefender: {
      op: { op: "knockOutDefender" },
      board: () => {
        const state = probeBoard();
        // Undoomed to start with, or "did not land" would be true for a reason
        // that has nothing to do with §11 — the vacuous-probe shape.
        expect(p1Active(state)?.damage).toBe(0);
        expect(p1Active(state)?.markers).toEqual([]);
        return state;
      },
      landed: (r) => {
        const after = p1Active(r.after);
        if (after === null || after === undefined) return false;
        return (
          after.markers.includes(koByEffectMarker(r.before.turn)) &&
          after.damage > (p1Active(r.before)?.damage ?? 0)
        );
      },
    },
    takePrize: {
      op: { op: "takePrize" },
      board: () => {
        const state = probeBoard();
        // Nothing owed to start with, or "did not land" would be true for a reason
        // that has nothing to do with §11 — the vacuous-probe shape `knockOutDefender`
        // above spells out.
        expect(state.pending).toEqual([]);
        expect(state.players.p2.prizes.length).toBeGreaterThan(0);
        return state;
      },
      landed: (r) =>
        r.after.pending.some(
          (stage) => stage.kind === "takePrizes" && stage.seat === "p2" && stage.count === 1,
        ),
    },
  };

  /** One probe run: the op fed to the interpreter as an ATTACK's program, from
      P2's chair, against P1's shielded Active. */
  function drive(kind: string): {
    before: GameState;
    after: GameState;
    events: GameEvent[];
    parked: boolean;
    refused: boolean;
    nulled: boolean;
  } {
    const probe = PROBES[kind] as Probe;
    const before = (probe.board ?? probeBoard)();
    const events: GameEvent[] = [];
    const sourceUid = probe.sourceUid?.(before);
    const result = runProgram(
      before,
      [probe.op],
      sourceUid === undefined
        ? { seat: "p2", invokedBy: "attack" }
        : { seat: "p2", invokedBy: "attack", sourceUid },
      events,
      { discarded: ["one-card"] },
    );
    const damage = findAll(events, "DAMAGE_DEALT");
    return {
      before,
      after: result.state,
      events,
      parked: result.kind === "parked",
      refused: types(events).includes("ATTACK_EFFECT_PREVENTED"),
      nulled: damage.length > 0 && damage.every((row) => row.prevented === true && row.dealt === 0),
    };
  }

  it("has a driven probe for EVERY classified op, and no probe for anything else", () => {
    for (const kind of Object.keys(CLASSIFIED)) {
      expect(PROBES[kind], `classified but never driven: ${kind}`).toBeDefined();
    }
    for (const kind of Object.keys(PROBES)) {
      expect(CLASSIFIED[kind], `driven but never classified: ${kind}`).toBeDefined();
    }
  });

  it("drives every `blocked` op under a live wide block — and the block STOPS it", () => {
    const blocked = Object.keys(CLASSIFIED).filter((k) => CLASSIFIED[k] === "blocked");
    expect(blocked.length).toBeGreaterThanOrEqual(9);
    for (const kind of blocked) {
      const r = drive(kind);
      // The op did not land…
      expect(PROBES[kind]?.landed(r), `${kind} landed under a live wide block`).toBe(false);
      expect(r.refused || r.nulled, `${kind} was silently inert, not blocked`).toBe(true);
      if (r.refused) {
        expect(find(r.events, "ATTACK_EFFECT_PREVENTED")).toEqual({
          type: "ATTACK_EFFECT_PREVENTED",
          seat: "p1",
          uid: activeUid(r.before, "p1"),
        });
      }
    }
  });

  it("drives every `untouched` op under the SAME live block — and it lands in full", () => {
    // The other half, and the reason a one-sided proof would not have been one:
    // a guard that refused EVERYTHING would pass the case above and fail here.
    const untouched = Object.keys(CLASSIFIED).filter((k) => CLASSIFIED[k] === "untouched");
    expect(untouched.length).toBeGreaterThanOrEqual(9);
    for (const kind of untouched) {
      const r = drive(kind);
      expect(PROBES[kind]?.landed(r), `${kind} did not land under a live wide block`).toBe(true);
      expect(r.refused, `${kind} was refused by a block that has no business near it`).toBe(false);
      expect(r.nulled, `${kind} had its damage nulled`).toBe(false);
    }
  });

  it("the probes are driven against a block that is actually LIVE", () => {
    // The case that stops every assertion above from going vacuous the day the
    // seed table drifts or the stamp arithmetic changes: the same board, with
    // the block SURGICALLY REMOVED, must let a `blocked` op through.
    const bare = (() => {
      const state = probeBoard();
      return {
        ...state,
        players: {
          ...state.players,
          // biome-ignore lint/style/noNonNullAssertion: installed() places the Active.
          p1: { ...state.players.p1, active: { ...state.players.p1.active!, attackBlock: null } },
        },
      };
    })();
    const events: GameEvent[] = [];
    const after = runProgram(
      bare,
      [{ op: "preventRetreat" }],
      { seat: "p2", invokedBy: "attack" },
      events,
    );
    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(after.state.players.p1.active?.retreatBlocked).toBe(true);
  });
});
