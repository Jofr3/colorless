import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { disabledAbilityUids, opposingAttackDebuff } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PRESSURE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  findEvent,
  findEvents,
} from "./testFixtures";

const PRESSURE =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";
/** The printed amount, likewise. */
const AMOUNT = 20;
const GROWL =
  "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).";

const SEED = 7;

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
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented.
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

const ATTACKERS = {
  "sv02-062": {
    index: 1,
    energy: [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // Pikachu "Pika Bolt" (30)
  "sv01-048": {
    index: 0,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // Alomomola "Surf" (30, WATER)
  "sv02-127": { index: 0, energy: [{ id: "fix-fighting-energy", count: 3 }] }, // Ting-Lu ex "Land Scoop" (150)
  "sv01-069": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Rotom "Linear Attack" (snipe 20)
  "fix-feint": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Feint Attack" ({C}, 50, ignoreWR)
  "fix-sniper": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Spread Shot" (30 + 20 each benched)
  "fix-bramble": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Bramble" (40 per taken Prize, benched)
  "sv03-030": { index: 0, energy: [{ id: "fix-energy", count: 3 }] }, // Entei "Blaze Ball" (60, no {R} in this deck)
} as const;

function board(attacker: keyof typeof ATTACKERS, defender: string): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: PRESSURE_DECK, p2: PRESSURE_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p1", attacker);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", defender);
  return state;
}

function swing(state: GameState, attacker: keyof typeof ATTACKERS, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
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

/** Put damage counters on a seat's Active — the switch that arms Ting-Lu ex's
    "Cursed Land" against it (the lock's printed clause is "that have any damage
    counters on them"). */
function withDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to damage");
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, damage } } },
  };
}

describe("the printed datum — re-queried, not inherited", () => {
  it("carries Entei's NAME, its printed Ability and its printed attack verbatim", () => {
    expect(FIXTURE_POOL["sv03-030"]?.name).toBe("Entei");
    expect(FIXTURE_POOL["sv03-030"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv03-030"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-030"]?.abilities).toEqual([
      { type: "Ability", name: "Pressure", effect: PRESSURE },
    ]);
    expect(FIXTURE_POOL["sv03-030"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Blaze Ball",
        damage: "60+",
        effect: "This attack does 20 more damage for each {R} Energy attached to this Pokémon.",
      },
    ]);
  });

  it("is AUTHORED in the registry and still REFUSED by the attack deriver", () => {
    expect(programFor("sv03-030")?.passive).toEqual({ opponentActiveAttackDebuff: AMOUNT });
    expect(programFor("sv03-030")?.attack).toBeUndefined();
    expect(deriveAttackEffect(PRESSURE)).toBeNull();
    // The DURATED sibling still derives, and neither sentence reaches the other's
    // reader — the family's taxonomy is unchanged by the aura landing.
    expect(deriveAttackEffect(GROWL)).toEqual([{ op: "weakenDefenderAttacks", amount: 20 }]);
  });

  it("is the ONLY printing — the census, run as its own question", () => {
    const ids = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.opponentActiveAttackDebuff !== undefined,
    );
    expect(ids).toEqual(["sv03-030"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The scan: both Active clauses, and what leaving the spot does.
// ─────────────────────────────────────────────────────────────────────────────

describe("opposingAttackDebuff — the cross-board scan", () => {
  it("reads 20 for the opponent's Active while Entei is Active, and 0 for Entei's side", () => {
    const state = board("sv02-062", "sv03-030");
    const p1Active = state.players.p1.active;
    const p2Active = state.players.p2.active;
    if (p1Active === null || p2Active === null) throw new Error("board");
    // The TARGET end: P1's Active is "your opponent's Active Pokémon".
    expect(opposingAttackDebuff(state, p1Active)).toBe(AMOUNT);
    // …and the aura never weakens its OWN side. Entei's own "Blaze Ball" is not
    // "attacks used by your opponent's Active Pokémon", and asking the source is
    // the cheapest way to say so.
    expect(opposingAttackDebuff(state, p2Active)).toBe(0);
  });

  it("SOURCE clause: a BENCHED Entei does nothing (contrast opposingRetreatSurcharge)", () => {
    let state = board("sv02-062", "fix-titan");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-030");
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("board");
    expect(opposingAttackDebuff(state, p1Active)).toBe(0);
  });

  it("TARGET clause: a BENCHED attacker reads 0 even with Entei Active", () => {
    let state = board("sv02-062", "sv03-030");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("board");
    expect(opposingAttackDebuff(state, benched)).toBe(0);
  });

  it("an empty opposing Active Spot reads 0 rather than throwing", () => {
    // Totality, `opposingRetreatBlocked`'s arm verbatim: between a KO and the
    // promotion the spot really is null.
    const state = board("sv02-062", "sv03-030");
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(opposingAttackDebuff(empty, p1Active)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four read sites, driven end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("the four damage sites — 20 off every one", () => {
  it("attack.ts main hit: Pika Bolt 30 into Entei lands 10, and the row REPORTS the 20", () => {
    const { events } = swing(board("sv02-062", "sv03-030"), "sv02-062");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(30);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(10);
    expectBeforeWR(row);
  });

  it("THE PARENTHETICAL IS OBSERVABLE: Surf 30 into ×2-Water Entei lands 20, not 40", () => {
    // The one board in the pool where the two placements of the subtraction give
    // different numbers off a printed card. (30 − 20) × 2 = 20; 30 × 2 − 20 = 40.
    const { events } = swing(board("sv01-048", "sv03-030"), "sv01-048");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(20);
    expectBeforeWR(row); // …and asserts the OTHER reading is a different number.
  });

  it("interpreter spreadDamage: the aura comes off the BENCH splash too", () => {
    let state = board("fix-sniper", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { events } = swing(state, "fix-sniper");
    const rows = findEvents(events, "DAMAGE_DEALT");
    expect(rows.map((r) => r.dealt)).toEqual([10, 0]);
    expect(rows.map((r) => r.debuff)).toEqual([AMOUNT, AMOUNT]);
    for (const row of rows) expectBeforeWR(row);
  });

  it("interpreter placeSnipe `deals` arm: a benched pick is weakened as well", () => {
    let state = board("fix-bramble", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setPrizes(state, "p2", 4); // 2 taken → Bramble is 80
    const { events } = swing(state, "fix-bramble");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(80);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(60);
    expectBeforeWR(row);
  });

  it("interpreter snipeActive: Linear Attack's 20 into Entei clamps to 0", () => {
    const { events } = swing(clearBench(board("sv01-069", "sv03-030"), "p2"), "sv01-069");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(20);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(0);
  });

  it("`ignoreWR` NULLS THE AURA AT snipeActive AND ONLY THERE", () => {
    const state = clearBench(board("fix-feint", "sv03-030"), "p2");
    const { events } = swing(state, "fix-feint");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(50);
    // The control: the same attacker under a STAMP keeps paying it, so "nulled" is
    // a statement about the AURA and not about this site reading nothing at all.
    const stamped = swing(withDebuff(state, "p1", 20), "fix-feint");
    expect(findEvent(stamped.events, "DAMAGE_DEALT")?.debuff).toBe(20);
    expect(findEvent(stamped.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("…but NOT at placeSnipe's bench arm, where the source is a DIFFERENT body", () => {
    let state = board("fix-feint", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    expect(pick).toBeDefined();
    if (pick === undefined) return;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(AMOUNT);
    expect(row?.dealt).toBe(30);
    expect(benchTopUid(parked, "p2", 0)).toBe(row?.uid);
  });

  it("Entei's OWN attack is untouched — the aura is one-directional", () => {
    const { events } = swing(board("sv03-030", "fix-titan"), "sv03-030", "p1");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(60); // no {R} in PRESSURE_DECK, so "60+" is a flat 60
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two halves of one number.
// ─────────────────────────────────────────────────────────────────────────────

describe("summation with D149's stamp, and the §9 pair", () => {
  it("SUMS: a stamped 20 plus the aura's 20 takes 40 off one hit", () => {
    const state = withDebuff(board("sv02-127", "sv03-030"), "p1", 20);
    const { events } = swing(state, "sv02-127");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBe(40);
    expect(row.dealt).toBe(110);
    expectBeforeWR(row);
  });

  it("THE §9 PAIR ON ONE BOARD — the lock silences the AURA and not the STAMP", () => {
    const armed = withDebuff(board("sv02-127", "sv03-030"), "p1", 20);
    const locked = withDamage(armed, "p2", 10);

    const enteiUid = activeUid(locked, "p2");
    expect(disabledAbilityUids(armed).has(enteiUid)).toBe(false); // undamaged: free
    expect(disabledAbilityUids(locked).has(enteiUid)).toBe(true); // damaged: silenced

    // The scan itself, before any damage is dealt.
    const attacker = locked.players.p1.active;
    if (attacker === null) throw new Error("board");
    expect(opposingAttackDebuff(locked, attacker)).toBe(0);

    // …and driven end to end: 150 − 20 (stamp only), where the unlocked board took
    // 40 off. The stamp survives the very lock that killed the aura.
    const { events } = swing(locked, "sv02-127");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBe(20);
    expect(row.dealt).toBe(130);
  });

  it("the lock is the ONLY difference — the same board with no stamp reads 0", () => {
    const locked = withDamage(board("sv02-127", "sv03-030"), "p2", 10);
    const { events } = swing(locked, "sv02-127");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log — rendered and READ, not copied", () => {
  it("renders the aura's crumb under the DAMAGED seat's row, and it is honest", () => {
    const { state, events } = swing(board("sv02-062", "sv03-030"), "sv02-062");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx)
      .flatMap((entry) =>
        entry.kind === "turn"
          ? []
          : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
    expect(rendered).toContain("weakened −20");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.seat).toBe("p2");
  });
});
