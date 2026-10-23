import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  TAILS_GATE_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
  walkProgram,
  findEvent,
  mustDerive,
} from "./testFixtures";

const TAILS_TEXT = "Flip a coin. If tails, during your next turn, this Pokémon can't attack.";
const BARE_TEXT = "During your next turn, this Pokémon can't attack.";

const TAILS_SEEDS = [
  1, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 17, 19, 21, 24, 25, 26, 31, 32, 33, 37, 39, 40,
] as const;
/** …and the complement — the face on which NOTHING is installed, which on this
    sentence is the interesting half. */
const HEADS_SEEDS = [2, 3, 7, 11, 16, 18, 20, 22, 23, 27, 28, 29, 30, 34, 35, 36, 38] as const;

/** The two gated fixtures, with the INDEX and the printed damage each carries —
    the family's two indices, which is the fact no remainder list mentioned. */
const INSTALLERS = [
  { id: "sv01-157", index: 1, damage: 130, attack: "Leg Stomp" },
  { id: "sv02-130", index: 0, damage: 200, attack: "Needle Bone" },
] as const;

function armed(seed: number, installer: string): GameState {
  let state = must(
    applyAction(driveSetup(seed, { p1: TAILS_GATE_DECK, p2: TAILS_GATE_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", installer);
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  if (installer === "sv01-157") return attachFromDeck(state, "p1", "fix-energy", 3);
  if (installer === "sv02-130") {
    return attachFromDeck(attachFromDeck(state, "p1", "fix-dark-energy", 1), "p1", "fix-energy", 2);
  }
  return attachFromDeck(attachFromDeck(state, "p1", "fix-water-energy", 2), "p1", "fix-energy", 1);
}

function installed(seed: number, installer: string, index: number): GameState {
  const { state, events } = mustApply(armed(seed, installer), {
    type: "attack",
    seat: "p1",
    index,
  });
  if (findEvent(events, "ATTACK_LOCKED") === undefined) {
    throw new Error(`seed ${seed} did not lock ${installer} (heads?)`);
  }
  if (state.turn !== 3) throw new Error(`expected P2's turn 3, got ${state.turn}`);
  return state;
}

/** Hand the turn back to P1 — the LOCKED turn, `state.turn + 2` from the install. */
function heldTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (next.turn !== 4) throw new Error(`expected the holder's turn 4, got ${next.turn}`);
  return next;
}

/** The engine's rejection code for an attack, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** The face this declaration's ONE coin came up. Throws when there was no flip —
    a gate that stopped flipping would otherwise read as a permanent heads. */
function faceOf(events: GameEvent[]): "heads" | "tails" {
  const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no ATTACK_EFFECT_COIN_FLIP row");
  return flip.result;
}

describe("the tails gate — derived, not authored", () => {
  it("derives the sentence to a coinFlipGate carrying `onTails`", () => {
    expect(deriveAttackEffect(TAILS_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        then: [{ op: "preventAttack" }],
      },
    ]);
    // The key set, not just the value: the op takes NO other field, and `toEqual`
    // alone would not catch a stray one.
    const op = mustDerive(deriveAttackEffect, TAILS_TEXT)[0] as object;
    expect(Object.keys(op).sort()).toEqual(["onTails", "op", "then"]);
  });

  it("wraps D143's BARE program byte for byte — one action, printed three ways", () => {
    const gated = mustDerive(deriveAttackEffect, TAILS_TEXT);
    expect(gated).toHaveLength(1);
    expect(gated[0]).toMatchObject({ then: deriveAttackEffect(BARE_TEXT) });
    // …and the two anchors are NOT the same reading: the bare one derives a naked
    // op, the gated one a gate. A reader that let either claim the other's string
    // would return the inner op unwrapped (or wrap a sentence with no coin in it).
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "preventAttack" }]);
    expect(deriveAttackEffect(TAILS_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("derives the U+2019 spelling IDENTICALLY (D136/D137)", () => {
    const curly = TAILS_TEXT.replace(/'/g, "’");
    expect(curly).not.toBe(TAILS_TEXT);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(TAILS_TEXT));
  });

  it("is anchored end to end", () => {
    for (const text of [
      `Then, ${TAILS_TEXT}`,
      `${TAILS_TEXT} Draw a card.`,
      TAILS_TEXT.slice(0, -1),
      TAILS_TEXT.toLowerCase(),
      // The two sentences joined without the printed space.
      TAILS_TEXT.replace(". If", ".If"),
      TAILS_TEXT.replace("If tails", "If heads"),
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), which states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${TAILS_TEXT}\n`)).toEqual(deriveAttackEffect(TAILS_TEXT));
  });

  it("keeps the `onTails` field ABSENT on every heads-gated program the engine emits", () => {
    const gates: { where: string; op: Extract<EffectOp, { op: "coinFlipGate" }> }[] = [];
    const walk = (where: string, ops: readonly EffectOp[]) => {
      for (const op of walkProgram(ops)) {
        if (op.op === "coinFlipGate") gates.push({ where, op });
      }
    };
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(`${id} attack ${index}`, derived);
      }
      const authored = programFor(id);
      for (const [index, ops] of Object.entries(authored?.attack ?? {})) {
        walk(`${id} authored attack ${index}`, ops);
      }
      for (const ability of authored?.abilities ?? []) {
        walk(`${id} ${ability.name}`, ability.program);
      }
      walk(`${id} trainer`, authored?.trainer ?? []);
    }
    // The sweep found something — otherwise every assertion below is vacuous,
    // which is the failure mode a "no bad rows" test has by construction.
    expect(gates.length).toBeGreaterThan(3);
    const tailsGates = gates.filter((g) => g.op.onTails === true);
    const headsGates = gates.filter((g) => g.op.onTails !== true);
    expect(tailsGates.length).toBeGreaterThan(0);
    expect(headsGates.length).toBeGreaterThan(0);
    for (const { where, op } of headsGates) {
      expect(Object.keys(op), `${where} carries an onTails key`).not.toContain("onTails");
    }
    const producers = new Set(tailsGates.map((g) => g.where.split(" ")[0]));
    expect([...producers].sort()).toEqual([
      "sv01-157",
      "sv02-063",
      "sv02-130",
      "sv03-054",
      "sv03-183",
    ]);
  });

  it("refuses the OTHER FIVE tails-carrying sentences in the pool", () => {
    for (const text of [
      "Flip a coin. If tails, this attack does nothing.",
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck. If tails, discard a card from your hand.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("costs zero registry rows — both fixtures simulate off their printed text", () => {
    for (const { id } of INSTALLERS) expect(programFor(id)).toBeUndefined();
  });

  it("keeps the fixtures' printed text verbatim — and the family's TWO indices", () => {
    expect(FIXTURE_POOL["sv01-157"]?.attacks?.[1]).toEqual({
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "Leg Stomp",
      damage: 130,
      effect: TAILS_TEXT,
    });
    expect(FIXTURE_POOL["sv02-130"]?.attacks?.[0]).toEqual({
      cost: ["Darkness", "Colorless", "Colorless"],
      name: "Needle Bone",
      damage: 200,
      effect: TAILS_TEXT,
    });
    expect(FIXTURE_POOL["sv01-157"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv02-130"]?.attacks).toHaveLength(1);
    for (const { id, index, damage } of INSTALLERS) {
      expect(FIXTURE_POOL[id]?.attacks?.[index]?.damage).toBe(damage);
    }
    expect(TAILS_TEXT).toContain("can't");
    expect(TAILS_TEXT).not.toContain("’");
  });
});

describe("the tails gate — the seed table, pinned", () => {
  it("lands the face the table claims, on both installers, for every seed", () => {
    for (const { id, index } of INSTALLERS) {
      for (const seed of TAILS_SEEDS) {
        expect(
          faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index }).events),
        ).toBe("tails");
      }
      for (const seed of HEADS_SEEDS) {
        expect(
          faceOf(mustApply(armed(seed, id), { type: "attack", seat: "p1", index }).events),
        ).toBe("heads");
      }
    }
    expect([...TAILS_SEEDS, ...HEADS_SEEDS].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  });

  it("takes the coin on BOTH faces — `rngState` advances either way", () => {
    for (const seed of [TAILS_SEEDS[0], HEADS_SEEDS[0]]) {
      const before = armed(seed, "sv01-157");
      const { state: done } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
      expect(done.rngState).not.toBe(before.rngState);
    }
    const bare = armed(TAILS_SEEDS[0], "sv01-048");
    const { state: done, events } = mustApply(bare, { type: "attack", seat: "p1", index: 1 });
    expect(done.rngState).toBe(bare.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
  });
});

describe("the tails gate — installing it, on BOTH faces", () => {
  it("TAILS installs the lock and stamps `state.turn + 2`", () => {
    for (const [i, { id, index, damage }] of INSTALLERS.entries()) {
      const state = armed(TAILS_SEEDS[i] as number, id);
      const installer = activeUid(state, "p1");
      expect(state.turn).toBe(2);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });

      expect(faceOf(events)).toBe("tails");
      expect(findEvent(events, "ATTACK_LOCKED")).toEqual({
        type: "ATTACK_LOCKED",
        seat: "p1",
        uid: installer,
      });
      expect(done.players.p1.active?.attackLockedTurn).toBe(4);
      expect(done.turn).toBe(3);
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(damage);
      // Attacker-relative: nothing on the opponent's board carries a lock.
      expect(done.players.p2.active?.attackLockedTurn).toBeNull();
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("HEADS installs NOTHING — the same declaration, the same damage, no lock", () => {
    for (const [i, { id, index, damage }] of INSTALLERS.entries()) {
      const { state: done, events } = mustApply(armed(HEADS_SEEDS[i] as number, id), {
        type: "attack",
        seat: "p1",
        index,
      });
      expect(faceOf(events)).toBe("heads");
      expect(types(events)).not.toContain("ATTACK_LOCKED");
      expect(done.players.p1.active?.attackLockedTurn).toBeNull();
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(damage);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("does not inherit down the attack index — Oinkologne's index 0 flips nothing", () => {
    // "Ram" carries no effect text at all, so the declaration takes no coin and
    // installs nothing. The control that proves a program does not leak across
    // indices on a card where one attack has one.
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_LOCKED");
    expect(done.players.p1.active?.attackLockedTurn).toBeNull();
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(50);
  });

  it("reads correctly in the LOG — the coin row and the cost row, in that order", () => {
    const names: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
    const { state: done, events } = mustApply(armed(TAILS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const ctx: LogContext = { names, state: done, elapsed: "+00:07" };
    const text = logFromEvents(events, ctx)
      .filter((entry) => entry.kind !== "turn")
      .map((entry) => entry.segments.map((s) => s.text).join(""));
    expect(text).toContain("flipped tails for the effect");
    expect(text).toContain("Oinkologne can't attack next turn");
    // ORDER: the attack, then the damage it dealt, then the coin, then the cost.
    const at = (needle: string) => text.findIndex((line) => line.includes(needle));
    expect(at("used")).toBeLessThan(at("flipped tails"));
    expect(at("flipped tails")).toBeLessThan(at("can't attack next turn"));
    const heads = mustApply(armed(HEADS_SEEDS[0], "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const headsText = logFromEvents(heads.events, {
      names,
      state: heads.state,
      elapsed: "+00:07",
    }).map((entry) => (entry.kind === "turn" ? "" : entry.segments.map((s) => s.text).join("")));
    expect(headsText).toContain("flipped heads for the effect");
    expect(headsText.some((line) => line.includes("can't attack next turn"))).toBe(false);
  });
});

describe("the tails gate — the WINDOW, driven across the turn boundary on both faces", () => {
  it("TAILS: not live on the opponent's turn, refuses BOTH attacks on the window turn", () => {
    const state = installed(TAILS_SEEDS[1] as number, "sv01-157", 1);
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);

    const held = heldTurn(state);
    expect(held.players.p1.active?.attackLockedTurn).toBe(held.turn);
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(refusal(held, "p1", 0)).toBe("ATTACK_PREVENTED");
  });

  it("TAILS: it is a REJECTION — nothing is spent and the turn stays", () => {
    const held = heldTurn(installed(TAILS_SEEDS[2] as number, "sv01-157", 1));
    deepFreeze(held);
    const result = applyAction(held, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ATTACK_PREVENTED");
      expect(result.error.message).toContain("§11");
    }
    expect(held.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(held.players.p1.active?.energy).toHaveLength(3);
  });

  it("TAILS: the coin is spent ONCE, at the install — nothing between draws again", () => {
    const seed = TAILS_SEEDS[7] as number;
    const afterInstall = installed(seed, "sv01-157", 1);
    const held = heldTurn(afterInstall);
    expect(held.rngState).toBe(afterInstall.rngState);
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    // …and the NEXT legal declaration, two turns on, takes exactly one more.
    let later = must(applyAction(held, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.rngState).toBe(afterInstall.rngState);
    const { state: done, events } = mustApply(later, { type: "attack", seat: "p1", index: 1 });
    expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    expect(done.rngState).not.toBe(later.rngState);
  });

  it("HEADS: the holder attacks freely on the turn a tails would have locked", () => {
    let state = mustApply(armed(HEADS_SEEDS[1] as number, "sv01-157"), {
      type: "attack",
      seat: "p1",
      index: 1,
    }).state;
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    state = heldTurn(state);
    expect(refusal(state, "p1", 1)).toBe("ok");
    expect(refusal(state, "p1", 0)).toBe("ok");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(130);
    expect(faceOf(events)).toBeTruthy();
  });

  it("TAILS: expires by arithmetic — the holder attacks again two turns later", () => {
    let state = heldTurn(installed(TAILS_SEEDS[3] as number, "sv02-130", 0));
    expect(refusal(state, "p1", 0)).toBe("ATTACK_PREVENTED");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(6);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(200);
    // …and the fresh flip decides the NEXT window on its own, whichever way it
    // fell: the two declarations are independent coins.
    expect(faceOf(events)).toBeTruthy();
  });

  it("is NOT a §12 condition — a different code, and no status anywhere", () => {
    const held = heldTurn(installed(TAILS_SEEDS[4] as number, "sv01-157", 1));
    expect(held.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(refusal(held, "p1", 1)).toBe("ATTACK_PREVENTED");
    expect(refusal(setConditions(held, "p1", { rotation: "asleep" }), "p1", 1)).toBe(
      "STATUS_PREVENTS_ATTACK",
    );
  });

  it("the HUD projection agrees with the gate on BOTH faces, attack by attack", () => {
    const locked = redactGame(
      heldTurn(installed(TAILS_SEEDS[5] as number, "sv01-157", 1)),
      "p1",
    ).phase;
    if (locked.kind !== "turn:action") throw new Error(`expected turn:action, got ${locked.kind}`);
    expect(locked.attacks).toHaveLength(2);
    for (const attack of locked.attacks) {
      expect(attack.playable, `attack ${attack.index} offered under a lock`).toBe(false);
    }
    // The HEADS board on the SAME turn offers them — so the assertion above is
    // about the lock rather than about an unpayable cost or a §4 ban.
    const free = redactGame(
      heldTurn(
        mustApply(armed(HEADS_SEEDS[2] as number, "sv01-157"), {
          type: "attack",
          seat: "p1",
          index: 1,
        }).state,
      ),
      "p1",
    ).phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.some((a) => a.playable)).toBe(true);
  });

  it("§10 clears it early — retreating out of a tails-installed lock", () => {
    let held = heldTurn(installed(TAILS_SEEDS[6] as number, "sv01-157", 1));
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
    expect(
      held.players.p1.bench.find((p) => p.stack.includes(locked))?.attackLockedTurn,
    ).toBeNull();
  });
});

describe("the tails gate — `programPlayable` is FACE-AGNOSTIC, asserted", () => {
  it("refuses a card whose TAILS branch could only whiff, exactly as a heads one", () => {
    const state = armed(HEADS_SEEDS[3] as number, "sv01-157");
    const emptyBench = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, bench: [] },
      },
    };
    expect(emptyBench.players.p2.bench).toHaveLength(0);
    const gust: EffectOp[] = [{ op: "gust" }];
    // The bare op is unplayable into an empty opponent Bench (Pokémon Catcher's
    // own rule), which is what makes the two gated forms below say anything.
    expect(programPlayable(emptyBench, gust, "p1")).toBe(false);
    for (const onTails of [undefined, true] as const) {
      const gated: EffectOp[] =
        onTails === undefined
          ? [{ op: "coinFlipGate", then: gust }]
          : [{ op: "coinFlipGate", onTails, then: gust }];
      expect(programPlayable(emptyBench, gated, "p1"), `onTails=${String(onTails)}`).toBe(false);
      // …and PLAYABLE again the moment the branch has a target, on both faces —
      // so the refusal above is about the empty Bench and not about the gate.
      expect(programPlayable(state, gated, "p1"), `onTails=${String(onTails)} (bench)`).toBe(true);
    }
  });
});

describe("the tails gate — the census, asserted as a shape", () => {
  it("pins 5 printings on ONE sentence, and the tails SHAPE at 8 across 3", () => {
    const PRINTINGS = [
      { id: "sv01-157", name: "Oinkologne", index: 1 },
      { id: "sv01-158", name: "Oinkologne ex", index: 1 },
      { id: "sv01-234", name: "Oinkologne ex", index: 1 },
      { id: "sv02-130", name: "Paldean Clodsire ex", index: 0 },
      { id: "sv02-244", name: "Paldean Clodsire ex", index: 0 },
    ] as const;
    expect(PRINTINGS).toHaveLength(5);
    expect(new Set(PRINTINGS.map((p) => p.index))).toEqual(new Set([0, 1]));
    // Both fixtures are real members of that list, at the index it claims.
    for (const { id } of INSTALLERS) {
      const row = PRINTINGS.find((p) => p.id === id);
      expect(row).toBeDefined();
      expect(FIXTURE_POOL[id]?.attacks?.[row?.index ?? -1]?.effect).toBe(TAILS_TEXT);
    }
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
    expect(deriveAttackEffect("This Pokémon also does 60 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 60 },
    ]);
    for (const [gated, bare] of [
      [
        "Flip a coin. If tails, discard all Energy from this Pokémon.",
        "Discard all Energy from this Pokémon.",
      ],
      [
        "Flip a coin. If tails, this Pokémon also does 60 damage to itself.",
        "This Pokémon also does 60 damage to itself.",
      ],
    ] as const) {
      expect(deriveAttackEffect(gated), gated).toEqual([
        {
          op: "coinFlipGate",
          onTails: true,
          then: deriveAttackEffect(bare),
        },
      ]);
    }
  });
});
