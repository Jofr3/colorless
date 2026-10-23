import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handUid,
  handFromDeck,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
  must,
} from "./testFixtures";

const GURDURR = "sv06-104";
const OGERPON = "sv06-040";
const FLORAGATO = "sv09-017";
/** The `onDamagedByAttack` holder (§9) — Scorching Armor Burns the attacker. */
const ARMAROUGE = "sv03-044";
/** The `damageAttacker` TOOL (§9) — 2 counters = 20 HP onto the attacker. */
const HELMET = "sv01-193";

const EVOLVED = "fix-rmh-evolved";
const FILLER = "fix-rmh-filler";
const FIRE = "fix-rmh-fire";
const FIGHT = "fix-rmh-fight";
const GRASS = "fix-rmh-grass";

const GURDURR_TEXT =
  "You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.";
const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";
const FLORAGATO_TEXT =
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  [GURDURR]: battler(GURDURR, {
    name: "Gurdurr",
    hp: 140,
    stage: "Stage1",
    evolveFrom: "Timburr",
    retreat: 2,
    types: ["Fighting"],
    attacks: [
      // The CONTROL attack — a flat printed hit that never leaves `attack.ts`.
      { cost: ["Fighting"], name: "Knuckle Punch", damage: 20 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Superpower",
        damage: "50+",
        effect: GURDURR_TEXT,
      },
    ],
  }),
  [OGERPON]: battler(OGERPON, {
    name: "Hearthflame Mask Ogerpon ex",
    hp: 210,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Ember", damage: 10 },
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Dynamic Blaze",
        effect: OGERPON_TEXT,
        damage: "140+",
      },
    ],
  }),
  [FLORAGATO]: battler(FLORAGATO, {
    name: "Floragato",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Sprigatito",
    retreat: 1,
    types: ["Grass"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Magical Leaf",
        effect: FLORAGATO_TEXT,
        damage: "30+",
      },
    ],
  }),
  [ARMAROUGE]: battler(ARMAROUGE, {
    name: "Armarouge",
    types: ["Fire"],
    hp: 400,
    abilities: [
      { type: "Ability", name: "Scorching Armor", effect: "…the Attacking Pokémon is now Burned." },
    ],
  }),
  [EVOLVED]: battler(EVOLVED, {
    name: "Rehomed Evolved Wall",
    types: ["Colorless"],
    hp: 400,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [FILLER]: battler(FILLER, { name: "Rehomed Filler", types: ["Colorless"], hp: 60 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [FIGHT]: typedEnergy(FIGHT, "Fighting"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [GURDURR]: 4,
  [OGERPON]: 4,
  [FLORAGATO]: 4,
  [ARMAROUGE]: 4,
  [EVOLVED]: 4,
  [FILLER]: 4,
  [HELMET]: 4,
  [FIRE]: 12,
  [FIGHT]: 12,
  [GRASS]: 8,
});

const SEEDS = [4021, 4099] as const;
const COIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY — `count` Energy of one printed type onto p1's Active. */
function fuel(state: GameState, energyId: string, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board on p1's turn: `defender` standing opposite wearing Rocky Helmet (P2
    goes first, so the Tool is attached by a REAL `attachTool` action rather than
    by surgery), and `attacker` Active with `energy × count` on it. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  defender: string;
  helmet?: boolean;
  seed?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0]);
  state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  if (opts.helmet !== false) {
    state = handFromDeck(state, "p2", HELMET, 1);
    state = must(
      applyAction(state, {
        type: "attachTool",
        seat: "p2",
        uid: handUid(state, "p2", HELMET),
        target: { spot: "active" },
      }),
    );
    expect(state.players.p2.active?.tools).toHaveLength(1);
  }
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy, opts.count);
}

const PUNCH = { type: "attack", seat: "p1", index: 0 } as const;
const SUPERPOWER = { type: "attack", seat: "p1", index: 1 } as const;
const BLAZE = { type: "attack", seat: "p1", index: 1 } as const;
const LEAF = { type: "attack", seat: "p1", index: 0 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

function recoil(events: readonly GameEvent[]) {
  return events.find((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack");
}

/** The §9 trigger's two rows — the Ability announcement and the Burn it lands on
    the ATTACKER's seat. */
function burned(events: readonly GameEvent[]): boolean {
  return (
    events.some((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Scorching Armor") &&
    events.some((e) => e.type === "STATUS_APPLIED" && e.seat === "p1" && e.status === "burned")
  );
}

/** Both reactions, asserted together — they share a seeding site and they shared
    the defect, so a board that drives one and not the other would leave half of
    the repair unpinned. */
function expectBothReactions(events: readonly GameEvent[], where: string): void {
  expect(recoil(events), `${where}: Rocky Helmet's recoil`).toMatchObject({
    seat: "p1",
    amount: 20,
    source: "counterattack",
  });
  expect(burned(events), `${where}: Scorching Armor's Burn`).toBe(true);
}

// ────────────────────────────────────────────────────────────────────────────
describe("§1 — THE CONTROL: a flat printed hit fires both §9 reactions", () => {
  for (const seed of SEEDS) {
    it(`Knuckle Punch (20, no effect text) recoils AND Burns (seed ${seed})`, () => {
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const { events } = must2(applyAction(state, PUNCH));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 20 });
      expectBothReactions(events, "flat hit");
    });
  }
});

function must2(result: ReturnType<typeof applyAction>): {
  state: GameState;
  events: readonly GameEvent[];
} {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — D316's `optional` gate: BOTH arms are damage from an attack", () => {
  for (const seed of SEEDS) {
    it(`the ACCEPTED arm (80) recoils AND Burns (seed ${seed})`, () => {
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const parked = must2(applyAction(state, SUPERPOWER));
      // The whole hit is inside the gate — nothing has landed yet.
      expect(count(parked.events, "DAMAGE_DEALT")).toBe(0);
      const done = must2(applyAction(parked.state, YES));
      expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 80 });
      expectBothReactions(done.events, "optional YES");
    });

    it(`the DECLINED arm (50) recoils AND Burns (seed ${seed})`, () => {
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const parked = must2(applyAction(state, SUPERPOWER));
      const done = must2(applyAction(parked.state, NO));
      expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 50 });
      expectBothReactions(done.events, "optional NO");
    });
  }

  it("the recoil lands ONCE, not once per gate arm", () => {
    const state = board({ attacker: GURDURR, energy: FIGHT, count: 3, defender: ARMAROUGE });
    const done = must2(applyAction(must2(applyAction(state, SUPERPOWER)).state, YES));
    expect(
      done.events.filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack"),
    ).toHaveLength(1);
    expect(
      done.events.filter((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Scorching Armor"),
    ).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — D317's `conditionGate`: both sides of the board condition", () => {
  for (const seed of SEEDS) {
    it(`the NO arm (140, a Basic defender) recoils AND Burns (seed ${seed})`, () => {
      const state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: ARMAROUGE, seed });
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expectBothReactions(events, "conditionGate NO");
    });

    it(`the YES arm (280, an Evolution defender) recoils (seed ${seed})`, () => {
      // The Evolution body carries no Ability, so this board drives the RECOIL
      // half alone — which is exactly the half a Tool can grant to any body.
      const state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED, seed });
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
      expect(recoil(events), "conditionGate YES: Rocky Helmet's recoil").toMatchObject({
        seat: "p1",
        amount: 20,
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — D317's `coinFlipGate`: both faces of one flip", () => {
  function leaf(seed: number) {
    const state = board({
      attacker: FLORAGATO,
      energy: GRASS,
      count: 2,
      defender: ARMAROUGE,
      seed,
    });
    const { events } = must2(applyAction(state, LEAF));
    return {
      face: find(events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      dealt: find(events, "DAMAGE_DEALT")?.dealt,
      events,
    };
  }

  it("BOTH faces are reached across the seed sweep — neither arm is dead", () => {
    expect(new Set(COIN_SEEDS.map((seed) => leaf(seed).face))).toEqual(new Set(["heads", "tails"]));
  });

  for (const seed of COIN_SEEDS) {
    it(`the flip's arm recoils AND Burns (seed ${seed})`, () => {
      const run = leaf(seed);
      expect(run.dealt, `seed ${seed} ${run.face}`).toBe(run.face === "heads" ? 60 : 30);
      expectBothReactions(run.events, `coinFlipGate ${run.face}`);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — 'even if this Pokémon is Knocked Out' survives the re-homing too", () => {
  for (const seed of SEEDS) {
    it(`🛑 a LETHAL re-homed hit still recoils and still Burns, before the §8.1 sweep (seed ${seed})`, () => {
      let state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: ARMAROUGE, seed });
      state = setDamage(state, "p2", 380);
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expectBothReactions(events, "lethal conditionGate NO");
      expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
      const order = events.map((e) => e.type);
      expect(order.indexOf("STATUS_APPLIED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§6 — the boundary: no damage, no reaction", () => {
  it("a PREVENTED-to-zero board is not 'damaged by an attack'", () => {
    const state = board({
      attacker: OGERPON,
      energy: FIRE,
      count: 3,
      defender: EVOLVED,
      helmet: false,
    });
    const { events } = must2(applyAction(state, BLAZE));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
    expect(recoil(events)).toBeUndefined();
    expect(burned(events)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§6 (D456) — the INSTALLED half of the recoil, through this same funnel", () => {
  function armScaledOn(state: GameState, seat: Seat): GameState {
    const side = state.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...side,
          active: {
            ...body,
            installedRecoil: { turn: state.turn, amount: 0, ofDamageTaken: true },
          },
        },
      },
    };
  }

  for (const [label, defender, expected] of [
    ["the NO arm, a Basic defender", ARMAROUGE, 140],
    ["the YES arm, an Evolution defender", EVOLVED, 280],
  ] as const) {
    it(`${label} — the retaliation is the RE-HOMED hit's own number`, () => {
      const state = armScaledOn(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender }),
        "p2",
      );
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: expected });
      expect(recoil(events), label).toMatchObject({ seat: "p1", amount: expected + 20 });
      expect(
        events.filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack"),
        label,
      ).toHaveLength(1);
    });
  }

  it("the CONTROL on the same axis — a FLAT installed record is unmoved by the hit", () => {
    let state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED });
    const side = state.players.p2;
    const body = side.active;
    if (body === null) throw new Error("p2 has no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: { ...side, active: { ...body, installedRecoil: { turn: state.turn, amount: 50 } } },
      },
    };
    const { events } = must2(applyAction(state, BLAZE));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
    expect(recoil(events)).toMatchObject({ seat: "p1", amount: 50 + 20 });
  });
});
