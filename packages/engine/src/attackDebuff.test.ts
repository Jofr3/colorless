import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { type LogContext, logFromEvents } from "./log";
import {
  ATTACK_DEBUFF_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
  walkProgram,
  findEvent,
} from "./testFixtures";

/** Sentence ONE at each printed amount — the majority spelling (3 of 5). */
function possessive(amount: number): string {
  return `During your opponent's next turn, the Defending Pokémon's attacks do ${String(amount)} less damage (before applying Weakness and Resistance).`;
}
/** Sentence TWO at each printed amount — Houndoom sv06.5-008/-066 "Snarl". */
function usedBy(amount: number): string {
  return `During your opponent's next turn, attacks used by the Defending Pokémon do ${String(amount)} less damage (before applying Weakness and Resistance).`;
}
const ALWAYS_ON =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";
const AFTER_WR =
  "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).";

const SEED = 7;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function pipeline(row: {
  base: number;
  scaled?: number;
  bonus?: number;
  debuff?: number;
  weakness: DamageModifier | null;
  resistance: DamageModifier | null;
  reduction?: number;
}): { beforeWR: number; afterWR: number } {
  const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
  const debuff = row.debuff ?? 0;
  const reduction = row.reduction ?? 0;
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented:
  // this oracle is about the ORDER of the steps, and re-deriving what "×2" means
  // would let a bug in that function hide behind a matching bug here.
  const modify = (value: number): number =>
    Math.max(0, applyDamageModifier(applyDamageModifier(value, row.weakness), row.resistance));
  return {
    beforeWR: Math.max(0, modify(Math.max(0, raw - debuff)) - reduction),
    afterWR: Math.max(0, modify(raw) - debuff - reduction),
  };
}

function expectBeforeWR(row: Extract<GameEvent, { type: "DAMAGE_DEALT" }>): void {
  const { beforeWR, afterWR } = pipeline(row);
  expect(row.dealt).toBe(row.prevented === true ? 0 : beforeWR);
  if (row.weakness !== null && (row.debuff ?? 0) > 0 && row.prevented !== true) {
    expect(beforeWR).not.toBe(afterWR);
    expect(row.dealt).not.toBe(afterWR);
  }
}

const INSTALLERS = {
  "sv02-062": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "swsh10.5-061": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "sv01-093": {
    index: 0,
    amount: 30,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 120,
  },
  "sv06.5-008": {
    index: 1,
    amount: 100,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 100,
  },
} as const;

function armed(
  installer: keyof typeof INSTALLERS,
  victim: string,
  victimEnergy: { id: string; count: number }[] = [],
): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: ATTACK_DEBUFF_DECK, p2: ATTACK_DEBUFF_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  for (const { id, count } of INSTALLERS[installer].energy) {
    state = attachFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", victim);
  for (const { id, count } of victimEnergy) state = attachFromDeck(state, "p2", id, count);
  return state;
}

function installed(
  installer: keyof typeof INSTALLERS,
  victim: string,
  victimEnergy: { id: string; count: number }[] = [],
): GameState {
  const spec = INSTALLERS[installer];
  const { state, events } = mustApply(armed(installer, victim, victimEnergy), {
    type: "attack",
    seat: "p1",
    index: spec.index,
  });
  const row = findEvent(events, "ATTACK_DEBUFF_APPLIED");
  if (row === undefined) throw new Error(`${installer} did not install a debuff`);
  if (row.amount !== spec.amount) throw new Error(`${installer} installed ${String(row.amount)}`);
  return state;
}

/** The debuffed body swings back: P2 declares `index` on the turn the window is
    open. Everything it needs is already attached by `armed`. */
function swingBack(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p2", index });
}

function withDebuff(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackDamageDebuff: { turn, amount } } },
    },
  };
}

function withReduction(
  state: GameState,
  seat: Seat,
  where: "active" | { bench: number },
  amount: number,
  turn = state.turn,
): GameState {
  const side = state.players[seat];
  const stamp = { turn, amount };
  if (where === "active") {
    const active = side.active;
    if (active === null) throw new Error("no Active to stamp");
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, active: { ...active, damageReduction: stamp } },
      },
    };
  }
  const bench = side.bench.map((p, i) =>
    i === where.bench ? { ...p, damageReduction: stamp } : p,
  );
  return { ...state, players: { ...state.players, [seat]: { ...side, bench } } };
}

function withWideBlock(state: GameState, seat: Seat, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to block with");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackBlock: { turn, effects: true } } },
    },
  };
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:07" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("the attacker-side debuff — derived, not authored", () => {
  it("derives BOTH printed sentences off ONE op, at every printed amount", () => {
    expect(deriveAttackEffect(possessive(20))).toEqual([
      { op: "weakenDefenderAttacks", amount: 20 },
    ]);
    expect(deriveAttackEffect(possessive(30))).toEqual([
      { op: "weakenDefenderAttacks", amount: 30 },
    ]);
    expect(deriveAttackEffect(usedBy(100))).toEqual([{ op: "weakenDefenderAttacks", amount: 100 }]);
    expect(deriveAttackEffect(possessive(70))).toEqual([
      { op: "weakenDefenderAttacks", amount: 70 },
    ]);
    expect(deriveAttackEffect(usedBy(70))).toEqual([{ op: "weakenDefenderAttacks", amount: 70 }]);
  });

  it("shares the OP between the two sentences — asserted, not argued", () => {
    expect(deriveAttackEffect(possessive(50))).toEqual(deriveAttackEffect(usedBy(50)));
    // And they really are two DIFFERENT strings — i.e. this is not one regex being
    // asserted against itself.
    expect(possessive(50)).not.toBe(usedBy(50));
    expect(possessive(50).length).not.toBe(usedBy(50).length);
  });

  it("refuses a printed ZERO — the guard every arm in this family carries", () => {
    expect(deriveAttackEffect(possessive(0))).toBeNull();
    expect(deriveAttackEffect(usedBy(0))).toBeNull();
  });

  it("folds the typographic apostrophe — and sentence ONE carries TWO slots", () => {
    for (const amount of [20, 30]) {
      expect(deriveAttackEffect(possessive(amount).replace(/'/g, "’"))).toEqual(
        deriveAttackEffect(possessive(amount)),
      );
    }
    expect(deriveAttackEffect(usedBy(100).replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(usedBy(100)),
    );
    // …and mixing the two spellings within one sentence still derives, which is the
    // only assertion that proves BOTH slots are classed rather than one of them.
    expect(deriveAttackEffect(possessive(20).replace("opponent's", "opponent’s"))).toEqual(
      deriveAttackEffect(possessive(20)),
    );
    expect(deriveAttackEffect(possessive(20).replace("Pokémon's", "Pokémon’s"))).toEqual(
      deriveAttackEffect(possessive(20)),
    );
  });

  it("is UNGATED — no coin is printed on any of the five", () => {
    expect((deriveAttackEffect(possessive(20)) as EffectOp[]).map((op) => op.op)).toEqual([
      "weakenDefenderAttacks",
    ]);
    // And a coin prefix must not ride in front of either anchor and install
    // silently: both start at "During", so this is a property of `^` and not luck.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${possessive(20).toLowerCase()}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${usedBy(100).toLowerCase()}`)).toBeNull();
  });

  it("is anchored end to end, on both sentences", () => {
    for (const text of [possessive(30), usedBy(100)]) {
      expect(deriveAttackEffect(`Then, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
      // The parenthetical is IN both anchors, so dropping it is a different
      // sentence — and the pool prints no such sentence, so it stays LOUD.
      expect(
        deriveAttackEffect(text.replace(" (before applying Weakness and Resistance)", "")),
      ).toBeNull();
    }
  });

  it("REFUSES D147's SENTENCE, AND D147's ANCHOR REFUSES THESE — the parenthetical is the taxonomy", () => {
    expect(deriveAttackEffect(AFTER_WR)).toEqual([{ op: "reduceDamage", amount: 30 }]);
    expect(deriveAttackEffect(possessive(30))).toEqual([
      { op: "weakenDefenderAttacks", amount: 30 },
    ]);
    // …and the ONE WORD that separates them is load-bearing IN BOTH DIRECTIONS.
    expect(deriveAttackEffect(AFTER_WR.replace("after applying", "before applying"))).toBeNull();
    expect(
      deriveAttackEffect(possessive(30).replace("before applying", "after applying")),
    ).toBeNull();
  });

  it("refuses the ALWAYS-ON Ability — the duration AND the body are the difference", () => {
    expect(deriveAttackEffect(ALWAYS_ON)).toBeNull();
    expect(programFor("sv03-030")?.passive).toEqual({ opponentActiveAttackDebuff: 20 });
    expect(programFor("sv03-030")?.attack).toBeUndefined();
    expect(FIXTURE_POOL["sv03-030"]?.abilities).toEqual([
      { type: "Ability", name: "Pressure", effect: ALWAYS_ON },
    ]);
  });

  it("costs zero registry rows — all four cards simulate off their printed text", () => {
    for (const id of Object.keys(INSTALLERS)) expect(programFor(id)?.attack).toBeUndefined();
  });

  it("keeps the fixtures' NAME, text, cost, damage and INDEX verbatim", () => {
    expect(FIXTURE_POOL["sv02-062"]?.name).toBe("Pikachu");
    expect(FIXTURE_POOL["sv02-062"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Growl",
      effect: possessive(20),
    });
    expect(FIXTURE_POOL["sv02-062"]?.attacks?.[1]).toEqual({
      cost: ["Lightning", "Colorless"],
      name: "Pika Bolt",
      damage: 30,
    });
    expect(FIXTURE_POOL["swsh10.5-061"]?.name).toBe("Pidove");
    expect(FIXTURE_POOL["swsh10.5-061"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Growl",
      effect: possessive(20),
    });
    expect(FIXTURE_POOL["sv01-093"]?.name).toBe("Florges");
    expect(FIXTURE_POOL["sv01-093"]?.attacks?.[0]).toEqual({
      cost: ["Psychic", "Colorless", "Colorless"],
      name: "Moonblast",
      damage: 120,
      effect: possessive(30),
    });
    expect(FIXTURE_POOL["sv06.5-008"]?.name).toBe("Houndoom");
    expect(FIXTURE_POOL["sv06.5-008"]?.attacks?.[1]).toEqual({
      cost: ["Fire", "Colorless", "Colorless"],
      name: "Snarl",
      damage: 100,
      effect: usedBy(100),
    });
    expect(Object.values(INSTALLERS).map((s) => s.index)).toEqual([0, 0, 0, 1]);
    // The Weakness lines are the reason these cards rather than any others: each
    // installer is the body its own debuffed victim swings back into.
    expect(FIXTURE_POOL["sv06.5-008"]?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-061"]?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-061"]?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(FIXTURE_POOL["sv01-048"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["sv02-062"]?.types).toEqual(["Lightning"]);
    // …and Florges carries BOTH readings on one card, which is the interaction the
    // ordering section turns on.
    expect(FIXTURE_POOL["sv01-093"]?.abilities?.[0]?.name).toBe("Blooming Garden");
    expect(possessive(20)).toContain("opponent's");
    expect(possessive(20)).not.toContain("’");
  });

  it("emits `weakenDefenderAttacks` from exactly the four printings, swept over the pool", () => {
    const producers = new Map<string, number[]>();
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of walkProgram(ops)) {
        if (op.op === "weakenDefenderAttacks") {
          producers.set(id, [...(producers.get(id) ?? []), op.amount]);
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
    expect([...producers.entries()].sort()).toEqual([
      ["fix-bonevengeance", [40]],
      ["sv01-093", [30]],
      ["sv02-062", [20]],
      ["sv06.5-008", [100]],
      ["swsh10.5-061", [20]],
    ]);
  });
});

describe("the attacker-side debuff — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv02-062", "sv01-069");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn ON THE OPPONENT'S BODY, and names the AMOUNT", () => {
    const state = armed("swsh10.5-061", "sv02-062");
    const victim = activeUid(state, "p2");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(findEvent(events, "ATTACK_DEBUFF_APPLIED")).toEqual({
      type: "ATTACK_DEBUFF_APPLIED",
      seat: "p2",
      uid: victim,
      amount: 20,
    });
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Defender-relative: nothing on the INSTALLER's own board moved, which is the
    // exact inverse of `reduceDamage`'s assertion one suite over.
    expect(done.players.p1.active?.attackDamageDebuff).toBeNull();
    expect(done.players.p1.active?.damageReduction).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) {
        expect(benched.attackDamageDebuff).toBeNull();
      }
    }
  });

  it("installs the PRINTED amount on all four printings, at their own INDEX", () => {
    for (const [id, spec] of Object.entries(INSTALLERS)) {
      const key = id as keyof typeof INSTALLERS;
      const { state: done, events } = mustApply(armed(key, "fix-titan"), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      expect(findEvent(events, "ATTACK_DEBUFF_APPLIED")?.amount, id).toBe(spec.amount);
      expect(done.players.p2.active?.attackDamageDebuff, id).toEqual({
        turn: 3,
        amount: spec.amount,
      });
      const hit = findEvent(events, "DAMAGE_DEALT");
      expect(hit?.dealt ?? 0, id).toBe(spec.hit);
      if (spec.hit > 0) {
        expect(types(events).indexOf("DAMAGE_DEALT")).toBeLessThan(
          types(events).indexOf("ATTACK_DEBUFF_APPLIED"),
        );
      }
    }
  });

  it("does not leak across the attack index", () => {
    // Houndoom installs at INDEX 1; its index-0 "Bite" (50) must not…
    const { state: bite, events: biteEvents } = mustApply(armed("sv06.5-008", "fix-titan"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(biteEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(bite.players.p2.active?.attackDamageDebuff).toBeNull();
    expect(findEvent(biteEvents, "DAMAGE_DEALT")?.dealt).toBe(50);
    // …and Pikachu installs at INDEX 0, so its index-1 "Pika Bolt" (30) must not.
    const { state: bolt, events: boltEvents } = mustApply(
      attachFromDeck(armed("sv02-062", "fix-titan"), "p1", "fix-lightning-energy", 1),
      { type: "attack", seat: "p1", index: 1 },
    );
    expect(types(boltEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(bolt.players.p2.active?.attackDamageDebuff).toBeNull();
  });

  it("writes onto the body that was Active when the attack RESOLVED (§8 step 5)", () => {
    // "The Defending Pokémon" is a term of art, not "whatever is Active later": the
    // debuff lands on the victim standing in front of the attack, and the victim's
    // own Bench takes nothing — so a promotion after the fact inherits nothing.
    let state = armed("swsh10.5-061", "sv01-069");
    state = benchFromDeck(state, "p2", "fix-titan");
    const victim = activeUid(state, "p2");
    const benched = benchTopUid(state, "p2", state.players.p2.bench.length - 1);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.stack).toContain(victim);
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    const stillBenched = done.players.p2.bench.find((p) => p.stack.includes(benched ?? ""));
    expect(stillBenched?.attackDamageDebuff).toBeNull();
  });
});

describe("the attacker-side debuff — the §8.5 ORDERING the parenthetical pins", () => {
  it("subtracts BEFORE Weakness: Water 120 into a ×2 Water body with 100 installed", () => {
    const state = installed("sv06.5-008", "sv01-048", [
      { id: "fix-water-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    expect(state.players.p2.active?.damage).toBe(100); // Snarl landed
    const installer = activeUid(state, "p1");
    const { state: done, events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.uid).toBe(installer);
    expect(row?.base).toBe(120);
    expect(row?.debuff).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(40);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(140);
      expectBeforeWR(row);
    }
    expect(done.players.p1.active?.damage).toBe(40);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(row?.prevented).toBeUndefined();
  });

  it("subtracts BEFORE Weakness on the small amount too — 30 Lightning, ×2, −20", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(40);
      expectBeforeWR(row);
    }
  });

  it("CANNOT bite on Florges's OWN board — Blooming Garden nulls the Weakness", () => {
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = benchFromDeck(state, "p1", "sv01-093");
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.weakness).toBeNull();
    expect(row?.dealt).toBe(10);
    // The two placements AGREE here, which is the whole content of the case: with
    // no multiplicative step there is nothing for the parenthetical to decide.
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(pipeline(row).afterWR);
      expectBeforeWR(row);
    }
  });

  it("COMMUTES with Resistance — which is why only Weakness makes the order visible", () => {
    const resisted = {
      base: 100,
      debuff: 40,
      weakness: null,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
    };
    expect(pipeline(resisted).beforeWR).toBe(pipeline(resisted).afterWR);
    expect(pipeline(resisted).beforeWR).toBe(30);
    // …and the moment a Weakness joins it, they diverge.
    const weak = {
      base: 100,
      debuff: 40,
      weakness: { op: "multiply", amount: 2 } as DamageModifier,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
    };
    // printed  (100 − 40) × 2 = 120, − 30 = 90   vs  100 × 2 − 30 = 170, − 40 = 130
    expect(pipeline(weak).beforeWR).toBe(90);
    expect(pipeline(weak).afterWR).toBe(130);
  });

  it("CLAMPS at the pre-W/R step, and a clamped 0 is not a prevention", () => {
    const state = installed("sv06.5-008", "sv01-048", [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: done, events } = swingBack(state, 0);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(0);
    expect(row?.prevented).toBeUndefined();
    // Nothing went negative on the way, and the defender's total is untouched.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(row?.damage).toBe(0);
    const additive = {
      base: 50,
      debuff: 100,
      weakness: { op: "add", amount: 20 } as DamageModifier,
      resistance: null,
    };
    expect(pipeline(additive).beforeWR).toBe(20); // max(0, 50 − 100) + 20
    expect(pipeline(additive).afterWR).toBe(0); // 50 + 20 − 100 → clamp
  });

  it("a clamped-to-zero hit did NOT 'do damage' — the §9 recoil boundary, BOTH ways", () => {
    const helmeted = (): GameState => {
      let state = armed("sv06.5-008", "sv01-048", [
        { id: "fix-water-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ]);
      state = handFromDeck(state, "p1", "sv01-193", 1);
      const { state: worn } = mustApply(state, {
        type: "attachTool",
        seat: "p1",
        uid: handUid(state, "p1", "sv01-193"),
        target: { spot: "active" },
      });
      const { state: installed } = mustApply(worn, { type: "attack", seat: "p1", index: 1 });
      return installed;
    };
    // Surf (30) clamped to 0 by the 100 → NOTHING happened to the holder, so the
    // Helmet says nothing either.
    const clamped = swingBack(helmeted(), 0);
    expect(findEvent(clamped.events, "DAMAGE_DEALT")?.dealt).toBe(0);
    expect(types(clamped.events)).not.toContain("COUNTERS_PLACED");
    expect(types(clamped.events)).not.toContain("KNOCKED_OUT");
    expect(clamped.state.players.p1.active?.damage).toBe(0);
    // The attack still HAPPENED — it was used, the turn ended, and §8.1 swept.
    expect(types(clamped.events)).toContain("ATTACK_DECLARED");
    expect(clamped.state.turn).toBe(4);
    // Aqua Slash (120) survives the same 100 at 40, so the Helmet DOES fire — same
    // board, same Tool, same debuff, and the only difference is whether `dealt` was
    // positive.
    const through = swingBack(helmeted(), 1);
    expect(findEvent(through.events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(findEvent(through.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: 20,
      source: "counterattack",
    });
  });
});

describe("the attacker-side debuff — the four READ SITES", () => {
  it("weakens the §8.5 MAIN HIT", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) expectBeforeWR(row);
  });

  it("weakens an Active-target SNIPE — `snipeActive`, the other site that runs W/R", () => {
    let state = installed("swsh10.5-061", "sv01-069", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1"); // one candidate → no park
    const { events } = swingBack(state, 0);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.debuff).toBe(20);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(0);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(20);
      expectBeforeWR(row);
    }
  });

  it("weakens SPREAD damage on the BENCH, where the pre-W/R BONUS deliberately does not reach", () => {
    let state = installed("swsh10.5-061", "fix-sniper", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const benched = benchTopUid(state, "p1", 0);
    const { events } = swingBack(state, 0);
    const rows = findAll(events, "DAMAGE_DEALT");
    const main = rows.find((e) => e.uid === activeUid(state, "p1"));
    const bench = rows.find((e) => e.uid === benched);
    expect(main?.debuff).toBe(20);
    expect(main?.dealt).toBe(10);
    expect(bench?.base).toBe(20);
    expect(bench?.debuff).toBe(20);
    expect(bench?.dealt).toBe(0);
    // §8.5 says no Weakness on the Bench, so this site's two placements agree — the
    // debuff is the whole of what it does there.
    if (bench !== undefined) expectBeforeWR(bench);
    if (main !== undefined) expectBeforeWR(main);
  });

  it("weakens a benched `deals` SNIPE — `placeSnipe`'s damage arm", () => {
    // fix-bramble's per-40 benched snipe, scaled by the Prizes the opponent has
    // TAKEN. One Prize taken → 40 to the single benched target, and the 20 debuff
    // takes it to 20.
    let state = installed("swsh10.5-061", "fix-bramble", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setPrizes(state, "p1", 5); // 6 − 5 = 1 Prize taken
    const benched = benchTopUid(state, "p1", 0);
    const { events } = swingBack(state, 0);
    const bench = findAll(events, "DAMAGE_DEALT").find((e) => e.uid === benched);
    expect(bench?.base).toBe(40);
    expect(bench?.debuff).toBe(20);
    expect(bench?.dealt).toBe(20);
    if (bench !== undefined) expectBeforeWR(bench);
  });

  it("does NOT touch a PLACED counter — a counter is not damage from an attack", () => {
    const put = deriveAttackEffect("Put 5 damage counters on your opponent's Active Pokémon.");
    expect(put?.[0]?.op).toBe("damageActive");
    // …and the debuff op is nowhere near it: two different questions, two ops.
    expect(JSON.stringify(put)).not.toContain("weaken");
  });
});

describe("the attacker-side debuff — meeting D147's reduction on one exchange", () => {
  it("both are live at once, and each takes its own bite at its own STEP", () => {
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = withReduction(state, "p1", "active", 20);
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.reduction).toBe(20);
    expect(row?.dealt).toBe(0);
    if (row !== undefined) expectBeforeWR(row);
    // …and the THREE-WAY separation, which is what makes "each takes its own bite"
    // a measurement rather than a description: the same board with only one of the
    // two live gives two different non-zero numbers, and with neither, 60.
    const both = row as Extract<GameEvent, { type: "DAMAGE_DEALT" }>;
    expect(pipeline({ ...both, reduction: undefined }).beforeWR).toBe(20); // debuff only
    expect(pipeline({ ...both, debuff: undefined }).beforeWR).toBe(40); // reduction only
    expect(pipeline({ ...both, debuff: undefined, reduction: undefined }).beforeWR).toBe(60);
  });

  it("the two records coexist on ONE body without either answering the other", () => {
    // A body can be the attacker of a debuffed swing AND the holder of its own
    // reduction — the fields are read by different sites for different questions,
    // and neither reader may see the other's number.
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = withReduction(state, "p2", "active", 50);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    expect(state.players.p2.active?.damageReduction).toEqual({ turn: 3, amount: 50 });
    // The debuffed body's own attack is cut by 20 (its debuff) and NOT by 50.
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(20);
    expect(row?.reduction).toBeUndefined(); // the reduction is on the ATTACKER, not the target
    expect(row?.dealt).toBe(20);
  });
});

describe("the attacker-side debuff — the LIFETIME", () => {
  it("is DEAD outside its one turn, with the stale stamp left alone", () => {
    // The whole of what a turn STAMP buys: no boundary clear anywhere, so the
    // record simply stops answering. Driven across two turn boundaries.
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    expect(state.turn).toBe(3);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    // P2 passes without attacking; turn 4 is P1's, then P1 passes back.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    // On turn 5 the SAME attacker hits for the undebuffed number: 30 × 2 = 60.
    const { events } = swingBack(state, 1);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(60);
  });

  it("is NOT live on the installing turn — the printed word is 'next'", () => {
    const state = installed("swsh10.5-061", "sv02-062");
    expect(state.players.p2.active?.attackDamageDebuff?.turn).toBe(3);
    expect(state.players.p2.active?.attackDamageDebuff?.turn).not.toBe(2);
  });

  it("ends when the victim RETREATS out of it — the victim's own counterplay", () => {
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const victim = activeUid(state, "p2");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv01-048");
    const { state: retreated, events: retreatEvents } = mustApply(state, {
      type: "retreat",
      seat: "p2",
      discardEnergy: [state.players.p2.active?.energy[0] as string],
      promoteBenchIndex: 0,
    });
    const benched = retreated.players.p2.bench.find((p) => p.stack.includes(victim ?? ""));
    expect(benched?.attackDamageDebuff).toBeNull();
    expect(types(retreatEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // …and the promoted body attacks at FULL strength, so the clear is real rather
    // than merely unread.
    let next = attachFromDeck(retreated, "p2", "fix-water-energy", 1);
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(30); // Surf 30, Pidove is Colorless-neutral to Water
  });

  it("ends on a SWITCH inside the window", () => {
    let state = installed("swsh10.5-061", "sv02-062");
    const victim = activeUid(state, "p2");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = handFromDeck(state, "p2", "sv01-194", 1);
    const { state: done } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv01-194"),
    });
    let next = done;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = next.players.p2.bench.find((p) => p.stack.includes(victim ?? ""));
    expect(benched?.attackDamageDebuff).toBeNull();
  });

  it("ends on EVOLVING — a PLAYED LINE, and the cheapest counterplay there is", () => {
    let state = installed("sv06.5-008", "sv01-048");
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    state = handFromDeck(state, "p2", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p2.active?.attackDamageDebuff).toBeNull();
    // Silent, like every §10 clear in this family.
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // …and the evolution attacks at full: "Bubble" ({W}, 40) into Houndoom, which is
    // ×2 WATER, so 80 rather than the max(0, 40 − 100) = 0 the debuff would have made.
    const armedEvo = attachFromDeck(done, "p2", "fix-water-energy", 1);
    const { events: hit } = mustApply(armedEvo, { type: "attack", seat: "p2", index: 0 });
    const row = findEvent(hit, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(80);
  });

  it("does not travel to the promoted body when the victim is Knocked Out", () => {
    // Snarl's printed 100 into a body it also debuffs is a LINE rather than a
    // corner. Alomomola survives at 120 HP; Rotom (60 HP) does not — and the
    // promoted Pokémon is a different Pokémon carrying nothing.
    let state = armed("sv06.5-008", "sv01-069");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const victim = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(types(events).indexOf("ATTACK_DEBUFF_APPLIED")).toBeLessThan(
      types(events).indexOf("KNOCKED_OUT"),
    );
    // The victim is gone; whoever is promoted into the empty spot is a DIFFERENT
    // Pokémon and carries nothing — the stamp left with the stack (§8.1).
    let next = done;
    if (next.phase.kind === "ko:takePrizes") {
      next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p2", benchIndex: 0 }));
    }
    expect(next.players.p2.active).not.toBeNull();
    expect(next.players.p2.active?.attackDamageDebuff).toBeNull();
    expect(next.players.p2.discard.some((uid) => uid === victim)).toBe(true);
  });

  it("MERGES by Math.max — unreachable off any printing, DRIVEN through the interpreter", () => {
    let state = withDebuff(armed("sv06.5-008", "sv01-048"), "p2", 50, 3);
    let done = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(done.state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    expect(findEvent(done.events, "ATTACK_DEBUFF_APPLIED")?.amount).toBe(100);
    state = withDebuff(armed("swsh10.5-061", "sv01-048"), "p2", 100, 3);
    done = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    expect(types(done.events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // A SUM would have said 120 here and 150 above; a plain overwrite 20 and 100.
    // Both are refused by the two assertions together.
  });
});

describe("the attacker-side debuff — the §11 block REFUSES it", () => {
  it("a wide block on the Defending Pokémon refuses the install, and says so", () => {
    let state = armed("sv06.5-008", "sv01-048");
    state = withWideBlock(state, "p2", state.turn);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(done.players.p2.active?.attackDamageDebuff).toBeNull();
    // The DAMAGE half is nulled by the same block, on its own field.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
  });

  it("…and an EXPIRED block does not refuse it", () => {
    // The other side of the same gate: a block whose stamp is not this turn stops
    // answering, so the install lands normally. Without this the case above would
    // pass for a build that refused every install unconditionally.
    let state = armed("sv06.5-008", "sv01-048");
    state = withWideBlock(state, "p2", state.turn + 5);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the attacker-side debuff — the LOG", () => {
  it("renders in the VICTIM's voice and names the VICTIM's own next turn", () => {
    const state = armed("swsh10.5-061", "sv02-062");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const rows = rendered(done, events);
    const row = rows.find((r) => r.text.includes("less damage"));
    expect(row?.who).toBe("p2"); // the VICTIM's seat, not the actor's
    expect(row?.text).toBe("Pikachu's attacks do 20 less damage next turn");
    expect(row?.text).not.toContain("your opponent's next turn");
    const declared = rows.findIndex((r) => r.text.includes("Growl"));
    const applied = rows.findIndex((r) => r.text.includes("less damage"));
    expect(declared).toBeGreaterThanOrEqual(0);
    expect(applied).toBeGreaterThan(declared);
    expect(rows[declared]?.who).toBe("p1");
  });

  it("reports the number on the hit it shrank — and emits no second row for firing", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: done, events } = swingBack(state, 1);
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    const line = rendered(done, events).find((r) => r.text.includes("dealt"));
    expect(line?.text).toContain("weakened −20");
    expect(line?.text).toContain("weakness");
    // …and the crumb sits BEFORE the Weakness one, so the log reconstructs §8.5 in
    // printed order rather than in field order.
    expect(line?.text.indexOf("weakened") ?? -1).toBeLessThan(line?.text.indexOf("weakness") ?? 0);
  });

  it("says nothing at all when the debuff is not live", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    let next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    next = must(applyAction(next, { type: "endTurn", seat: "p1" }));
    const { state: done, events } = swingBack(next, 1);
    const line = rendered(done, events).find((r) => r.text.includes("dealt"));
    expect(line?.text).not.toContain("weakened");
  });
});
