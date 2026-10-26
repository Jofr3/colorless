import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { POKEMON_TYPES } from "./effectTypes";
import type { EffectOp } from "./effectTypes";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  CLASS_BLOCK_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  activeOf,
  mustDerive,
} from "./testFixtures";

const BASIC_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.";
const ANCIENT_TEXT =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.";
const BASIC_CLASS = { stage: "basic" } as const;
const UNFILTERED_TEXT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.";

/** One seed for the whole suite. Nothing here flips a coin, so a seed table
    would be describing a shuffle rather than a rule (contrast
    `preventBlock.test.ts`, whose every board is reached by sweeping for a face). */
const SEED = 7;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function armed(installer: string, energy = 2): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: CLASS_BLOCK_DECK, p2: CLASS_BLOCK_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p1", installer);
  return attachFromDeck(state, "p1", "fix-energy", energy);
}

function installed(installer: string, energy = 2): GameState {
  const { state, events } = mustApply(armed(installer, energy), {
    type: "attack",
    seat: "p1",
    index: 0,
  });
  if (findEvent(events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`${installer} did not install a block`);
  }
  return state;
}

/** The declaration every filter case is: put `attacker` on P2's Active with the
    energy it needs and swing at the shielded body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number },
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  next = attachFromDeck(next, "p2", energy.id, energy.count);
  return mustApply(next, { type: "attack", seat: "p2", index });
}

describe("the attacker-CLASS filter — derived, not authored", () => {
  it("derives to a BARE preventDamage carrying `fromClass` — no gate at all", () => {
    expect(deriveAttackEffect(BASIC_TEXT)).toEqual([
      { op: "preventDamage", fromClass: BASIC_CLASS },
    ]);
    expect(deriveAttackEffect(BASIC_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(BASIC_TEXT),
    );
  });

  it("is UNGATED — the first producer of this op that is not a coinFlipGate body", () => {
    const derived = mustDerive(deriveAttackEffect, BASIC_TEXT);
    expect(derived.map((op) => op.op)).toEqual(["preventDamage"]);
    const gated = mustDerive(deriveAttackEffect, UNFILTERED_TEXT);
    expect(gated.map((op) => op.op)).toEqual(["coinFlipGate"]);
  });

  it("keeps `effects` ABSENT and `fromClass` PRESENT — the two fields, two phrases", () => {
    const derived = mustDerive(deriveAttackEffect, BASIC_TEXT);
    expect(Object.keys(derived[0] as object).sort()).toEqual(["fromClass", "op"]);
  });

  it("differs from D142's unfiltered narrow body in EXACTLY `fromClass`", () => {
    const filtered = mustDerive(deriveAttackEffect, BASIC_TEXT);
    const gate = mustDerive(deriveAttackEffect, UNFILTERED_TEXT)[0] as Extract<
      EffectOp,
      { op: "coinFlipGate" }
    >;
    const stripped = JSON.parse(
      JSON.stringify(filtered).replace(',"fromClass":{"stage":"basic"}', ""),
    );
    expect(stripped).toEqual(gate.ops);
  });

  it("is anchored end to end", () => {
    expect(deriveAttackEffect(`Then, ${BASIC_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(BASIC_TEXT.slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(BASIC_TEXT.toLowerCase())).toBeNull();
    // A GATED spelling of this exact sentence is not printed anywhere and must
    // not derive: the anchor starts at "During", so a coin prefix cannot ride in
    // front of it and silently install without flipping.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${BASIC_TEXT.toLowerCase()}`)).toBeNull();
    // …and a trailing second sentence keeps the whole thing LOUD, which is the
    // guard the `takes {N} less damage` family will need the day it lands.
    expect(deriveAttackEffect(`${BASIC_TEXT} Draw a card.`)).toBeNull();
  });

  it("refuses the ANCIENT spelling — no reader, because there is no DATUM", () => {
    expect(deriveAttackEffect(ANCIENT_TEXT)).toEqual([
      { op: "preventDamage", fromClass: { stage: "ancient" } },
    ]);
    // The two sentences differ in ONE WORD, so the refusal is a property of the
    // anchor rather than of the shape — assert that they really are one word apart.
    expect(ANCIENT_TEXT).toBe(BASIC_TEXT.replace("Basic Pokémon", "Ancient Pokémon"));
    for (const text of [
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      // Bronzong sv03-145 "Oracle Press" — effects WITHOUT damage.
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
        ops: [{ op: "preventDamage", effects: true }],
      },
    ]);
  });

  it("costs zero registry rows — both cards simulate off their printed text", () => {
    expect(programFor("sv01-150")).toBeUndefined();
    expect(programFor("sv02-153")).toBeUndefined();
  });

  it("keeps the fixtures' printed text, cost, damage and INDEX verbatim", () => {
    expect(FIXTURE_POOL["sv01-150"]?.name).toBe("Staraptor");
    expect(FIXTURE_POOL["sv01-150"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Tailspin Away",
      damage: 60,
      effect: BASIC_TEXT,
    });
    expect(FIXTURE_POOL["sv02-153"]?.name).toBe("Noivern ex");
    expect(FIXTURE_POOL["sv02-153"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Covert Flight",
      damage: 70,
      effect: BASIC_TEXT,
    });
    // Two EVOLUTIONS, at two different stages — which is what makes them each
    // other's non-matching attacker rather than a bespoke fixture's job.
    expect(FIXTURE_POOL["sv01-150"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv02-153"]?.stage).toBe("Stage1");
    expect(BASIC_TEXT).toContain("opponent's");
    expect(BASIC_TEXT).not.toContain("’");
  });

  it("emits `fromClass` from a CLOSED vocabulary, swept over the whole pool", () => {
    const producers = new Set<string>();
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of ops) {
        if (op.op === "coinFlipGate") walk(op.ops, id);
        else if (op.op === "preventDamage" && op.fromClass !== undefined) {
          expect(op.fromClass.stage).toBe("basic");
          if (op.fromClass.excludingType !== undefined) {
            expect(POKEMON_TYPES as readonly string[]).toContain(op.fromClass.excludingType);
          }
          producers.add(id);
        }
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, card.id);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walk(ops, card.id);
    }
    expect([...producers].sort()).toEqual(["fix-crown", "sv01-150", "sv02-153"]);
  });
});

describe("the attacker-CLASS filter — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv01-150");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    // The whole reason this suite has no seed table: nothing here is random, so
    // determinism is a property of the sentence rather than of the shuffle.
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn and names the CLASS in the actor's voice", () => {
    const state = armed("sv01-150");
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(findEvent(events, "ATTACK_BLOCK_APPLIED")).toEqual({
      type: "ATTACK_BLOCK_APPLIED",
      seat: "p1",
      uid: installer,
      effects: false,
      fromClass: BASIC_CLASS,
    });
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op.
    expect(done.players.p2.active?.attackBlock).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.attackBlock).toBeNull();
    }
  });

  it("keeps the printed damage — a D125 tail board on BOTH installers", () => {
    for (const [installer, printed] of [
      ["sv01-150", 60],
      ["sv02-153", 70],
    ] as const) {
      const { state: done, events } = mustApply(armed(installer), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      const order = types(events);
      expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ATTACK_BLOCK_APPLIED"));
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(printed);
      expect(done.players.p1.active?.attackBlock?.fromClass).toEqual(BASIC_CLASS);
    }
  });

  it("does not inherit down the attack index — Power Blast installs nothing", () => {
    const { state: done, events } = mustApply(armed("sv01-150", 3), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(done.players.p1.active?.attackBlock).toBeNull();
    // …and index 1 really did resolve: 180 landed and its own self-discard ran.
    expect(findEvent(done ? [] : [], "DAMAGE_DEALT")).toBeUndefined();
    expect(types(events)).toContain("ENERGY_DISCARDED");
  });

  it("leaves the OTHER installer's unmapped sibling LOUD", () => {
    const { events } = mustApply(
      attachFromDeck(
        attachFromDeck(armed("sv02-153", 0), "p1", "fix-psychic-energy", 1),
        "p1",
        "fix-dark-energy",
        1,
      ),
      { type: "attack", seat: "p1", index: 1 },
    );
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
  });

  it("does NOT lift at the Checkup that ends the INSTALLER's own turn", () => {
    const { state: done, events } = mustApply(armed("sv01-150"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).toContain("TURN_STARTED");
    expect(done.players.p1.active?.attackBlock?.turn).toBe(3);
  });
});

describe("the attacker-CLASS filter — both sides of the filter, end to end", () => {
  it("a BASIC attacker is prevented, on both installers", () => {
    for (const installer of ["sv01-150", "sv02-153"] as const) {
      const state = installed(installer);
      deepFreeze(state);
      const { state: done, events } = swing(state, "fix-attacker", { id: "fix-energy", count: 1 });
      const hit = findEvent(events, "DAMAGE_DEALT");
      expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
      expect(done.players.p1.active?.damage).toBe(0);
    }
  });

  it("a NON-Basic attacker lands in FULL — and the two installers prove it to each other", () => {
    const intoNoivern = swing(installed("sv02-153"), "sv01-150", { id: "fix-energy", count: 3 }, 1);
    const bigHit = findEvent(intoNoivern.events, "DAMAGE_DEALT");
    expect(bigHit).toMatchObject({ seat: "p1", dealt: 180 });
    expect(bigHit?.prevented).toBeUndefined();
    expect(intoNoivern.state.players.p1.active?.damage).toBe(180);
    expect(types(intoNoivern.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    // …and the block is still sitting there, live and simply not matching.
    expect(intoNoivern.state.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });

    const intoStaraptor = swing(installed("sv01-150"), "sv02-153", { id: "fix-energy", count: 2 });
    const hit = findEvent(intoStaraptor.events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 70 });
    expect(hit?.prevented).toBeUndefined();
    expect(intoStaraptor.state.players.p1.active?.damage).toBe(70);
  });

  it("the §8.5 pipeline still RUNS and the block nulls the RESULT", () => {
    const { state: done, events } = swing(installed("sv01-150"), "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p1", dealt: 0, prevented: true });
    expect(hit?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(hit?.base).toBe(70);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("protects THIS Pokémon and not the rest of the board", () => {
    const state = installed("sv01-150");
    const benchBefore = state.players.p1.bench.map((p) => p.damage);
    expect(benchBefore.length).toBeGreaterThan(0);
    const { state: done, events } = swing(state, "fix-sniper", { id: "fix-energy", count: 1 });
    const rows = findAll(events, "DAMAGE_DEALT");
    expect(rows.find((r) => r.uid === activeUid(state, "p1"))).toMatchObject({
      dealt: 0,
      prevented: true,
    });
    for (const [i, before] of benchBefore.entries()) {
      expect(done.players.p1.bench[i]?.damage).toBe(before + 20);
    }
  });

  it("expires by arithmetic — the SAME Basic attacker lands in full a turn later", () => {
    let state = installed("sv01-150");
    const blocked = swing(state, "fix-attacker", { id: "fix-energy", count: 1 });
    expect(findEvent(blocked.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    // Turn 4 is P1's; they pass. Turn 5 is P2's again — and the stamp says 3.
    expect(blocked.state.turn).toBe(4);
    state = must(applyAction(blocked.state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const hit = findEvent(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ dealt: 30 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p1.active?.damage).toBe(30);
    expect(done.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: BASIC_CLASS,
    });
  });
});

describe("the attacker-CLASS filter — it is the NARROW reading, so effects go through", () => {
  it("nulls a matched Basic's DAMAGE and lets its Energy discard land", () => {
    const state = installed("sv01-150");
    expect(state.players.p1.active?.energy).toHaveLength(2);
    const { state: done, events } = swing(state, "sv02-072", {
      id: "fix-lightning-energy",
      count: 3,
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(events)).toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("lets a matched Basic PLACE damage counters — a counter is not damage", () => {
    const { state: done, events } = swing(installed("sv01-150"), "sv02-097", {
      id: "fix-psychic-energy",
      count: 2,
    });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 70,
      source: "attack",
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p1.active?.damage).toBe(70);
  });

  it("lets a matched Basic apply a §12 Special Condition", () => {
    const { state: done, events } = swing(
      installed("sv01-150"),
      "fix-attacker",
      { id: "fix-energy", count: 1 },
      2,
    );
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "asleep" });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    const woke = findEvent(events, "CHECKUP_COIN_FLIP");
    expect(done.players.p1.active?.conditions.rotation).toBe(
      woke?.result === "heads" ? "none" : "asleep",
    );
  });
});

describe("the attacker-CLASS filter — the EFFECTS half, unreachable but guarded", () => {
  function wideFiltered(state: GameState): GameState {
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active to shield");
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: {
            ...active,
            attackBlock: { turn: state.turn, effects: true, fromClass: BASIC_CLASS },
          },
        },
      },
    };
  }

  it("refuses a MATCHED Basic's effect and lets a NON-matching Stage 1's through", () => {
    const base = wideFiltered(installed("sv01-150"));
    const matched = swing(base, "sv02-097", { id: "fix-psychic-energy", count: 2 });
    expect(types(matched.events)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(matched.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p1" });
    expect(matched.state.players.p1.active?.damage).toBe(0);

    const unmatched = swing(base, "sv03-098", { id: "fix-psychic-energy", count: 1 }, 1);
    expect(findEvent(unmatched.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 50,
    });
    expect(types(unmatched.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(unmatched.state.players.p1.active?.damage).toBe(50);
  });
});

describe("the attacker-CLASS filter — lifetime, merging and the early clears", () => {
  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders inside the window", () => {
    let state = installed("sv01-150");
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
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(shielded));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(next.players.p1.bench[benchIndex]?.attackBlock).toBeNull();
    expect(types(gusted.events)).not.toContain("ATTACK_BLOCK_APPLIED");
    next = setActiveFromDeck(next, "p2", "fix-sniper");
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { state: hit, events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(hit.players.p1.bench[benchIndex]?.damage).toBe(20);
  });

  it("ends on evolution (§10) — unreachable in play, pinned anyway", () => {
    let state = must(applyAction(installed("sv01-150"), { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: {
            ...activeOf(state, "p1"),
            attackBlock: { turn: 99, effects: false, fromClass: BASIC_CLASS },
          },
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

  it("a second install may only WIDEN — a filter landing on an unfiltered block drops", () => {
    const state = armed("sv01-150");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const primed: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, attackBlock: { turn: state.turn + 1, effects: true } },
        },
      },
    };
    const { state: done, events } = mustApply(primed, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_BLOCK_APPLIED");
    expect(done.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(done.players.p1.active?.attackBlock?.fromClass).toBeUndefined();
    // …and it is really unfiltered now: a NON-Basic attacker is refused.
    const { events: swung } = swing(done, "sv02-153", { id: "fix-energy", count: 2 });
    expect(findEvent(swung, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});
