import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { type LogContext, logFromEvents } from "./log";
import {
  DAMAGE_REDUCTION_DECK,
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
  setDamage,
  setPrizes,
  types,
  findEvent,
} from "./testFixtures";

/** The bare sentence at each printed amount — one anchor, one capture. */
function bare(amount: number): string {
  return `During your opponent's next turn, this Pokémon takes ${String(amount)} less damage from attacks (after applying Weakness and Resistance).`;
}
const COMPOUND = `Discard all Energy from this Pokémon. ${bare(100)}`;
const ALWAYS_ON =
  "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance).";
const BEFORE_WR_ATTACKS = [
  // Houndoom sv06.5-008/-066 "Snarl" ({R}{C}{C}, 100, INDEX 1).
  "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).",
  // Pikachu sv02-062 / Pidove swsh10.5-061 "Growl" ({C}, no damage, INDEX 0).
  "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
  // Florges sv01-093 "Moonblast" ({P}{C}{C}, 120, INDEX 0).
  "During your opponent's next turn, the Defending Pokémon's attacks do 30 less damage (before applying Weakness and Resistance).",
];
const BEFORE_WR_ABILITY =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";

const SEED = 11;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function pipeline(row: {
  base: number;
  bonus?: number;
  weakness: DamageModifier | null;
  resistance: DamageModifier | null;
  reduction?: number;
}): { afterWR: number; beforeWR: number } {
  const raw = row.base + (row.bonus ?? 0);
  const reduction = row.reduction ?? 0;
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented:
  // this oracle is about the ORDER of the steps, and re-deriving what "×2" means
  // would let a bug in that function hide behind a matching bug here.
  const modify = (value: number): number =>
    Math.max(0, applyDamageModifier(applyDamageModifier(value, row.weakness), row.resistance));
  return {
    afterWR: Math.max(0, modify(raw) - reduction),
    beforeWR: modify(Math.max(0, raw - reduction)),
  };
}

function expectAfterWR(row: Extract<GameEvent, { type: "DAMAGE_DEALT" }>): void {
  const { afterWR, beforeWR } = pipeline(row);
  expect(row.dealt).toBe(row.prevented === true ? 0 : afterWR);
  if (row.weakness !== null && (row.reduction ?? 0) > 0 && row.prevented !== true) {
    expect(afterWR).not.toBe(beforeWR);
    expect(row.dealt).not.toBe(beforeWR);
  }
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with whatever energy its attack costs. */
function armed(installer: string, energy: { id: string; count: number }[]): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: DAMAGE_REDUCTION_DECK, p2: DAMAGE_REDUCTION_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

const INSTALLERS = {
  "sv03-169": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "sv01-001": { index: 0, amount: 30, energy: [{ id: "fix-energy", count: 2 }], hit: 10 },
  "sv01-139": {
    index: 1,
    amount: 50,
    energy: [
      { id: "fix-metal-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 90,
  },
  "sv02-048": { index: 1, amount: 100, energy: [{ id: "fix-water-energy", count: 3 }], hit: 100 },
  "sv06.5-043": { index: 0, amount: 30, energy: [{ id: "fix-metal-energy", count: 1 }], hit: 0 },
} as const;

function installed(installer: keyof typeof INSTALLERS): GameState {
  const spec = INSTALLERS[installer];
  const { state, events } = mustApply(armed(installer, [...spec.energy]), {
    type: "attack",
    seat: "p1",
    index: spec.index,
  });
  const row = findEvent(events, "DAMAGE_REDUCTION_APPLIED");
  if (row === undefined) throw new Error(`${installer} did not install a reduction`);
  if (row.amount !== spec.amount) throw new Error(`${installer} installed ${String(row.amount)}`);
  return state;
}

/** The declaration every read-site case is: put `attacker` on P2's Active with the
    energy it needs and swing into the shielded body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number }[],
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  for (const { id, count } of energy) next = attachFromDeck(next, "p2", id, count);
  return mustApply(next, { type: "attack", seat: "p2", index });
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

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("the durated damage reduction — derived, not authored", () => {
  it("derives every printed amount off ONE anchor with ONE capture", () => {
    for (const amount of [20, 30, 50, 100]) {
      expect(deriveAttackEffect(bare(amount))).toEqual([{ op: "reduceDamage", amount }]);
    }
    expect(deriveAttackEffect(bare(70))).toEqual([{ op: "reduceDamage", amount: 70 }]);
  });

  it("refuses a printed ZERO — the guard every arm in this family carries", () => {
    expect(deriveAttackEffect(bare(0))).toBeNull();
  });

  it("folds the typographic apostrophe", () => {
    for (const amount of [20, 30, 50]) {
      expect(deriveAttackEffect(bare(amount).replace(/'/g, "’"))).toEqual(
        deriveAttackEffect(bare(amount)),
      );
    }
    expect(deriveAttackEffect(COMPOUND.replace(/'/g, "’"))).toEqual(deriveAttackEffect(COMPOUND));
  });

  it("is UNGATED — no coin is printed on any of the fourteen", () => {
    const derived = deriveAttackEffect(bare(30)) as EffectOp[];
    expect(derived.map((op) => op.op)).toEqual(["reduceDamage"]);
    // And a coin prefix must not ride in front of the anchor and install silently:
    // the anchor starts at "During", so this is a property of `^` rather than luck.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${bare(30).toLowerCase()}`)).toBeNull();
  });

  it("is anchored end to end", () => {
    expect(deriveAttackEffect(`Then, ${bare(30)}`)).toBeNull();
    expect(deriveAttackEffect(bare(30).slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(bare(30).toLowerCase())).toBeNull();
    expect(deriveAttackEffect(`${bare(30)} Draw a card.`)).toBeNull();
    // The parenthetical is IN the anchor, so dropping it is a different sentence.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks.",
      ),
    ).toBeNull();
  });

  it("refuses the ALWAYS-ON spelling — the duration is the whole difference", () => {
    expect(deriveAttackEffect(ALWAYS_ON)).toBeNull();
    expect(programFor("sv03-174")?.passive?.damageReductionAfterWR).toBe(20);
    expect(programFor("sv01-121")?.passive?.damageReductionAfterWR).toBe(20);
    expect(programFor("sv02-150")?.passive?.damageReductionAfterWR).toBe(30);
    // …and the bare anchor really is that sentence with four words in front of it,
    // so the refusal is a property of the anchor rather than of the shape.
    expect(bare(20)).toBe(`During your opponent's next turn, this ${ALWAYS_ON.slice(5)}`);
  });

  it("refuses the ATTACKER-side family — the OTHER parenthetical", () => {
    for (const text of BEFORE_WR_ATTACKS) {
      expect(deriveAttackEffect(text)).not.toBeNull();
      expect((deriveAttackEffect(text) as EffectOp[])[0]?.op).toBe("weakenDefenderAttacks");
      expect(deriveAttackEffect(text)).not.toEqual([{ op: "reduceDamage", amount: 100 }]);
    }
    expect(deriveAttackEffect(BEFORE_WR_ABILITY)).toBeNull();
    // The two parentheticals differ in ONE WORD; assert that the refusal survives
    // the minimal rewrite rather than depending on the rest of the sentence — and
    // now in BOTH directions, since the "before" spelling has a reader.
    expect(deriveAttackEffect(bare(30).replace("after applying", "before applying"))).toBeNull();
    expect(
      deriveAttackEffect(
        (BEFORE_WR_ATTACKS[0] as string).replace("before applying", "after applying"),
      ),
    ).toBeNull();
  });

  it("derives the COMPOUND to TWO ops in printed order — the free count", () => {
    expect(deriveAttackEffect(COMPOUND)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    const compound = deriveAttackEffect(COMPOUND) as EffectOp[];
    expect(compound[0]).toEqual(
      (deriveAttackEffect("Discard all Energy from this Pokémon.") as EffectOp[])[0],
    );
    // …and the reduction half is byte-identical to the bare reduction anchor's.
    expect(compound[1]).toEqual((deriveAttackEffect(bare(100)) as EffectOp[])[0]);
  });

  it("keeps the two anchors mutually exclusive in BOTH directions", () => {
    // The bare anchor must REFUSE the compound — otherwise it would ship the
    // shield without the cost that buys it…
    expect(deriveAttackEffect(bare(100))).not.toEqual(deriveAttackEffect(COMPOUND));
    expect((deriveAttackEffect(COMPOUND) as EffectOp[]).length).toBe(2);
    // …and the compound anchor must refuse the bare sentence, which is the
    // direction a session only checks when it is told to: a compound anchor that
    // matched the bare string would silently discard a board's whole attachment.
    expect(deriveAttackEffect(bare(100))).toEqual([{ op: "reduceDamage", amount: 100 }]);
    // Mutual exclusion is decided by the capitalised first word plus `^…$`, before
    // either body is considered — assert the prefix relationship that makes it so.
    expect(COMPOUND.endsWith(bare(100))).toBe(true);
    expect(COMPOUND.startsWith("Discard all Energy")).toBe(true);
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
  });

  it("costs zero registry rows — all four cards simulate off their printed text", () => {
    for (const id of Object.keys(INSTALLERS)) expect(programFor(id)?.attack).toBeUndefined();
  });

  it("keeps the fixtures' NAME, text, cost, damage and INDEX verbatim", () => {
    expect(FIXTURE_POOL["sv03-169"]?.name).toBe("Swablu");
    expect(FIXTURE_POOL["sv03-169"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Fluffy Guard",
      effect: bare(20),
    });
    expect(FIXTURE_POOL["sv01-001"]?.name).toBe("Pineco");
    expect(FIXTURE_POOL["sv01-001"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Guard Press",
      damage: 10,
      effect: bare(30),
    });
    expect(FIXTURE_POOL["sv01-139"]?.name).toBe("Forretress");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.name).toBe("Rolling Shell");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.cost).toEqual([
      "Metal",
      "Colorless",
      "Colorless",
    ]);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.damage).toBe(90);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.effect).toBe(bare(50));
    expect(FIXTURE_POOL["sv02-048"]?.name).toBe("Eiscue");
    expect(FIXTURE_POOL["sv02-048"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Water"],
      name: "Frigid Block",
      damage: 100,
      effect: COMPOUND,
    });
    expect(Object.values(INSTALLERS).map((s) => s.index)).toEqual([0, 0, 1, 1, 0]);
    expect(FIXTURE_POOL["sv06.5-043"]?.name).toBe("Varoom");
    expect(FIXTURE_POOL["sv06.5-043"]?.attacks?.[0]).toEqual({
      cost: ["Metal"],
      name: "Rigidify",
      effect: bare(30),
    });
    // Pineco is Forretress's PRE-EVOLUTION, which is what lets the §10 evolve clear
    // and the "the record belongs to the Pokémon" case run off two printed cards.
    expect(FIXTURE_POOL["sv01-139"]?.evolveFrom).toBe("Pineco");
    expect(FIXTURE_POOL["sv01-001"]?.stage).toBe("Basic");
    // The Weakness lines are the reason these four rather than any other four.
    expect(FIXTURE_POOL["sv02-048"]?.weaknesses).toEqual([{ type: "Metal", value: "×2" }]);
    expect(FIXTURE_POOL["sv01-139"]?.types).toEqual(["Metal"]);
    expect(bare(30)).toContain("opponent's");
    expect(bare(30)).not.toContain("’");
  });

  it("emits `reduceDamage` from exactly the four printings, swept over the pool", () => {
    const producers = new Map<string, number[]>();
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of ops) {
        if (op.op === "coinFlipGate") walk(op.then, id);
        else if (op.op === "reduceDamage") {
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
      ["sv01-001", [30]],
      ["sv01-139", [50]],
      ["sv02-048", [100]],
      ["sv03-169", [20]],
      ["sv06.5-043", [30]],
    ]);
  });
});

describe("the durated damage reduction — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn and names the AMOUNT in the actor's voice", () => {
    const state = armed("sv01-001", [{ id: "fix-energy", count: 2 }]);
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(findEvent(events, "DAMAGE_REDUCTION_APPLIED")).toEqual({
      type: "DAMAGE_REDUCTION_APPLIED",
      seat: "p1",
      uid: installer,
      amount: 30,
    });
    expect(done.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 30 });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: nothing else on either board moved.
    expect(done.players.p2.active?.damageReduction).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.damageReduction).toBeNull();
    }
  });

  it("installs the PRINTED amount on all four printings, at their own INDEX", () => {
    for (const [id, spec] of Object.entries(INSTALLERS)) {
      const { state: done, events } = mustApply(armed(id, [...spec.energy]), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      expect(findEvent(events, "DAMAGE_REDUCTION_APPLIED")?.amount, id).toBe(spec.amount);
      expect(done.players.p1.active?.damageReduction, id).toEqual({ turn: 3, amount: spec.amount });
    }
  });

  it("keeps the printed damage — a D125 tail board on the three that hit", () => {
    for (const id of ["sv01-001", "sv01-139", "sv02-048"] as const) {
      const spec = INSTALLERS[id];
      const { events } = mustApply(armed(id, [...spec.energy]), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      const order = types(events);
      // The §8.5 hit lands FIRST and the install rides the tail behind it — free
      // rather than lucky, since the reduction's whole effect is in the future.
      expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("DAMAGE_REDUCTION_APPLIED"));
      const row = findEvent(events, "DAMAGE_DEALT");
      expect(row?.dealt, id).toBe(spec.hit);
      if (row !== undefined) expectAfterWR(row);
    }
    // Swablu prints NO damage at all, so its declaration is the install and
    // nothing else — the control the other three are read against.
    const { events } = mustApply(armed("sv03-169", [{ id: "fix-energy", count: 1 }]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).toContain("DAMAGE_REDUCTION_APPLIED");
  });

  it("does not leak across the attack index", () => {
    // Forretress installs at index 1; its index-0 "Continuous Spin" must not.
    // (It flips, so this is also the one declaration in the suite that moves the
    // rngState — asserted, so the seed-free claim above stays honest.)
    const before = armed("sv01-139", [{ id: "fix-metal-energy", count: 1 }]);
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(done.players.p1.active?.damageReduction).toBeNull();
    expect(done.rngState).not.toBe(before.rngState);
    // …and Eiscue's index-0 "Headbutt" (20, no effect) likewise.
    const eiscue = mustApply(armed("sv02-048", [{ id: "fix-water-energy", count: 1 }]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(eiscue.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(eiscue.state.players.p1.active?.damageReduction).toBeNull();
  });

  it("resolves the COMPOUND in printed order — the cost, then the shield", () => {
    const state = armed("sv02-048", [{ id: "fix-water-energy", count: 3 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const order = types(events);
    // Printed order, and the only order that reads right: the discard is the COST
    // and the reduction is what it buys, so announcing the shield first would
    // describe the card backwards.
    expect(order.indexOf("ENERGY_DISCARDED")).toBeLessThan(
      order.indexOf("DAMAGE_REDUCTION_APPLIED"),
    );
    // …and behind the printed 100, which is the §8.5 hit.
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ENERGY_DISCARDED"));
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(100);
    // The cost is real: all three {W} are gone, so the shielded body cannot attack
    // again — the printed trade, driven rather than described.
    expect(done.players.p1.active?.energy).toEqual([]);
    expect(findEvent(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the durated damage reduction — the §8.5 ORDERING the parenthetical pins", () => {
  it("subtracts AFTER Weakness: Metal 90 into a ×2 Metal body with 100 installed", () => {
    let state = installed("sv02-048");
    const shielded = activeUid(state, "p1");
    state = clearBench(state, "p1");
    const { state: done, events } = swing(
      state,
      "sv01-139",
      [
        { id: "fix-metal-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ],
      1,
    );
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.uid).toBe(shielded);
    expect(row?.base).toBe(90);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.reduction).toBe(100);
    expect(row?.dealt).toBe(80);
    // The reversed reading is 0, i.e. the two are not merely different numbers but
    // opposite CONCLUSIONS about whether the attack did anything at all.
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(0);
      expectAfterWR(row);
    }
    expect(done.players.p1.active?.damage).toBe(80);
    expect(row?.prevented).toBeUndefined();
  });

  it("subtracts AFTER Weakness on the smaller amounts too — 60 Fire, ×2, −50 and −30", () => {
    // Forretress (120 HP, ×2 Fire, 50 installed) takes fix-attacker's Flame (60):
    //   printed  60 × 2 = 120, − 50 = 70
    //   reversed (60 − 50) × 2 = 20
    let state = clearBench(installed("sv01-139"), "p1");
    const forretress = swing(
      state,
      "fix-attacker",
      [
        { id: "fix-fire-energy", count: 1 },
        { id: "fix-energy", count: 1 },
      ],
      1,
    );
    const tank = findEvent(forretress.events, "DAMAGE_DEALT");
    expect(tank?.dealt).toBe(70);
    if (tank !== undefined) {
      expect(pipeline(tank).beforeWR).toBe(20);
      expectAfterWR(tank);
    }
    state = clearBench(installed("sv01-001"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan"); // a promote target
    const pineco = swing(
      state,
      "fix-attacker",
      [
        { id: "fix-fire-energy", count: 1 },
        { id: "fix-energy", count: 1 },
      ],
      1,
    );
    const small = findEvent(pineco.events, "DAMAGE_DEALT");
    expect(small?.dealt).toBe(90);
    if (small !== undefined) {
      expect(pipeline(small).beforeWR).toBe(60);
      expectAfterWR(small);
    }
    expect(types(pineco.events)).toContain("KNOCKED_OUT");
  });

  it("subtracts AFTER Weakness on EVERY ×2 board this pool can build", () => {
    const boards = [
      // installer, its amount, attacker index/energy, printed dealt, reversed dealt
      // Pineco (×2 Fire, 30) taking Bite (30 Fire): 60 − 30 = 30 vs (30−30)×2 = 0.
      { installer: "sv01-001" as const, index: 0, dealt: 30, reversed: 0 },
      // Forretress (×2 Fire, 50) taking Bite (30 Fire): 60 − 50 = 10 vs 0.
      { installer: "sv01-139" as const, index: 0, dealt: 10, reversed: 0 },
      // Varoom (×2 Fire, 30) taking Bite (30 Fire): 60 − 30 = 30 vs 0. A third
      // card, and the one no remainder list ever named.
      { installer: "sv06.5-043" as const, index: 0, dealt: 30, reversed: 0 },
    ];
    for (const board of boards) {
      const state = clearBench(installed(board.installer), "p1");
      const { events } = swing(
        state,
        "fix-attacker",
        [{ id: "fix-energy", count: 1 }],
        board.index,
      );
      const row = findEvent(events, "DAMAGE_DEALT");
      expect(row?.dealt, board.installer).toBe(board.dealt);
      if (row !== undefined) {
        expect(pipeline(row).beforeWR, board.installer).toBe(board.reversed);
        expectAfterWR(row);
      }
    }
  });

  it("COMMUTES with Resistance — which is why only Weakness makes the order visible", () => {
    const resisted = {
      base: 100,
      weakness: null,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
      reduction: 50,
    };
    expect(pipeline(resisted).afterWR).toBe(pipeline(resisted).beforeWR);
    // …and the moment a Weakness joins it, they diverge.
    const weak = {
      base: 100,
      weakness: { op: "multiply", amount: 2 } as DamageModifier,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
      reduction: 50,
    };
    // 100 × 2 = 200, − 30 = 170, − 50 = 120  vs  (100 − 50) × 2 = 100, − 30 = 70.
    expect(pipeline(weak).afterWR).toBe(120);
    expect(pipeline(weak).beforeWR).toBe(70);
  });

  it("CLAMPS at zero and does not go negative — and a clamped 0 is not a prevention", () => {
    // Eiscue's 100 against fix-attacker's Bite (30, Fire — Eiscue is ×2 METAL, so
    // no Weakness): max(0, 30 − 100) = 0. The clamp is `attack.ts`'s existing
    // `Math.max(0, …)`, inherited by summing into the number it already guarded.
    let state = clearBench(installed("sv02-048"), "p1");
    const { state: done, events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.reduction).toBe(100);
    expect(row?.dealt).toBe(0);
    expect(row?.weakness).toBeNull();
    expect(row?.prevented).toBeUndefined();
    // The body took nothing, and the damage field is still exactly 0 rather than
    // having gone negative anywhere on the way.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(row?.damage).toBe(0);
    state = done;
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the durated damage reduction — the four READ SITES", () => {
  it("reduces the §8.5 MAIN HIT", () => {
    // Swablu (50 HP, ×2 Lightning, 20 installed) takes Bite (30, Fire — neutral):
    // 30 − 20 = 10.
    const state = clearBench(installed("sv03-169"), "p1");
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(10);
    expect(row?.reduction).toBe(20);
    if (row !== undefined) expectAfterWR(row);
  });

  it("reduces an Active-target SNIPE — `snipeActive`, the other site that runs W/R", () => {
    let state = clearBench(installed("sv03-169"), "p1"); // one candidate → no park
    state = setDamage(state, "p1", 0);
    const { events } = swing(state, "sv01-069", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.reduction).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(0);
      expectAfterWR(row);
    }
  });

  it("reduces SPREAD damage on the Bench — guarded at a site no printing reaches", () => {
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withReduction(state, "p1", { bench: 0 }, 20);
    const { events } = swing(state, "fix-sniper", [{ id: "fix-energy", count: 1 }]);
    const bench = findAll(events, "DAMAGE_DEALT").find(
      (e) => e.uid === benchTopUid(state, "p1", 0),
    );
    // Spread Shot puts 20 on each benched Pokémon; the installed 20 takes it to 0.
    expect(bench?.base).toBe(20);
    expect(bench?.reduction).toBe(20);
    expect(bench?.dealt).toBe(0);
    // …and §8.5 says no Weakness on the Bench, so this site's `afterWR` and
    // `beforeWR` agree — the reduction is the whole of what it does there.
    if (bench !== undefined) expectAfterWR(bench);
  });

  it("reduces a benched `deals` SNIPE — `placeSnipe`'s damage arm", () => {
    // fix-bramble's per-40 benched snipe, scaled by the Prizes the opponent has
    // TAKEN. One Prize taken → 40 to the single benched target, whose constructed
    // 20 takes it to 20. Same unreachability argument as the spread above.
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withReduction(state, "p1", { bench: 0 }, 20);
    state = setPrizes(state, "p1", 5); // 6 − 5 = 1 Prize taken by P2's opponent…
    const { events } = swing(state, "fix-bramble", [{ id: "fix-energy", count: 1 }]);
    const bench = findAll(events, "DAMAGE_DEALT").find(
      (e) => e.uid === benchTopUid(state, "p1", 0),
    );
    expect(bench?.base).toBe(40);
    expect(bench?.reduction).toBe(20);
    expect(bench?.dealt).toBe(20);
    if (bench !== undefined) expectAfterWR(bench);
  });
});

describe("the durated damage reduction — the LIFETIME", () => {
  it("is DEAD on the holder's own following turn, with the stale stamp left alone", () => {
    // The whole of what a turn STAMP buys: no boundary clear anywhere, so the
    // record simply stops answering. Driven across two turn boundaries.
    let state = clearBench(installed("sv03-169"), "p1");
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    // P2 passes; turn 4 is P1's own and the window has closed.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    // P1 passes back; on turn 5 the same attacker hits for the UNREDUCED number.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(30);
    expect(row?.reduction).toBeUndefined();
  });

  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders INSIDE the window", () => {
    let state = installed("sv03-169");
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
    expect(next.players.p1.bench[benchIndex]?.damageReduction).toBeNull();
    expect(types(gusted.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    // And it is GONE rather than merely unread — the promoted body takes a full hit.
    const { events } = swing(next, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.reduction).toBeUndefined();
  });

  it("ends on EVOLVING — unreachable by construction, written anyway", () => {
    let state = installed("sv01-001");
    // Hand the window back so the holder's controller may act, then re-stamp the
    // record onto the (now current) turn so the clear has something live to remove.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    state = withReduction(state, "p1", "active", 30, 4);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 4, amount: 30 });
    state = handFromDeck(state, "p1", "sv01-139", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-139"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.damageReduction).toBeNull();
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
  });

  it("leaves play with a KNOCKED OUT holder", () => {
    // The promoted body is a DIFFERENT Pokémon and carries no reduction, which is
    // what makes this a per-Pokémon effect rather than a per-player one.
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setDamage(state, "p1", 40); // 50 HP Swablu, 30 Bite − 20 = 10 incoming
    const { state: done, events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(types(events)).toContain("KNOCKED_OUT");
    let next = done;
    expect(next.phase.kind).toBe("ko:takePrizes");
    next = must(applyAction(next, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(next.players.p1.active?.damageReduction).toBeNull();
  });

  it("MERGES by MAX when installed twice in one window, and says nothing when it need not", () => {
    let state = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    state = withReduction(state, "p1", "active", 50, state.turn + 1);
    const bigger = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // The printed 20 landing on top of a 50 must NOT downgrade it…
    expect(bigger.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 50 });
    expect(types(bigger.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");

    let smaller = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    smaller = withReduction(smaller, "p1", "active", 10, smaller.turn + 1);
    const raised = mustApply(smaller, { type: "attack", seat: "p1", index: 0 });
    expect(raised.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    expect(findEvent(raised.events, "DAMAGE_REDUCTION_APPLIED")?.amount).toBe(20);

    // A stamp from a DIFFERENT (stale) window is replaced outright rather than
    // merged — there is nothing to preserve in a record that answers nothing.
    let stale = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    stale = withReduction(stale, "p1", "active", 90, 1);
    const replaced = mustApply(stale, { type: "attack", seat: "p1", index: 0 });
    expect(replaced.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
  });
});

describe("the durated damage reduction — beside D142's block", () => {
  it("is SUPERSEDED by a live block on the same body", () => {
    let state = clearBench(installed("sv02-048"), "p1");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...active, attackBlock: { turn: 3, effects: false } },
        },
      },
    };
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.prevented).toBe(true);
    expect(row?.dealt).toBe(0);
    expect(row?.reduction).toBe(100);
  });

  it("still bites when a `fromClass` block DECLINES — the two are independent reads", () => {
    let state = clearBench(installed("sv01-139"), "p1"); // Forretress, 50 installed
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // A block that only refuses BASIC attackers…
          active: {
            ...active,
            attackBlock: { turn: 3, effects: false, fromClass: { stage: "basic" } },
          },
        },
      },
    };
    // …met by a BASIC attacker: the block matches and nulls everything.
    const basic = swing(
      state,
      "fix-attacker",
      [
        { id: "fix-fire-energy", count: 1 },
        { id: "fix-energy", count: 1 },
      ],
      1,
    );
    expect(findEvent(basic.events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(findEvent(basic.events, "DAMAGE_DEALT")?.dealt).toBe(0);
    const evolved = swing(
      state,
      "sv01-139",
      [
        { id: "fix-metal-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ],
      1,
    );
    const row = findEvent(evolved.events, "DAMAGE_DEALT");
    expect(row?.prevented).toBeUndefined();
    expect(row?.reduction).toBe(50);
    expect(row?.dealt).toBe(40);
    if (row !== undefined) expectAfterWR(row);
  });
});

describe("the durated damage reduction — the VOICE", () => {
  it("renders in the ACTOR's own voice, naming the amount, in sequence", () => {
    const state = armed("sv01-001", [{ id: "fix-energy", count: 2 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const rows = rendered(done, events);
    const shield = rows.findIndex((r) => r.text.includes("less damage from attacks"));
    expect(shield).toBeGreaterThanOrEqual(0);
    expect(rows[shield]?.who).toBe("p1");
    expect(rows[shield]?.text).toBe(
      "Pineco takes 30 less damage from attacks during your opponent's next turn",
    );
    // Read in sequence: the declaration, the hit, then the shield — printed order.
    const hit = rows.findIndex((r) => r.text.includes("10 damage"));
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(shield).toBeGreaterThan(hit);
  });

  it("says NOTHING when the reduction FIRES — `DAMAGE_DEALT.reduction` is the whole story", () => {
    const state = clearBench(installed("sv03-169"), "p1");
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(findEvent(events, "DAMAGE_DEALT")?.reduction).toBe(20);
  });
});
