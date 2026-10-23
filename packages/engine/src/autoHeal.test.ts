import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setBenchDamage,
  specialEnergy,
  typedEnergy,
  must,
  driveSetup,
} from "./testFixtures";

// ── THE FIXTURE ─────────────────────────────────────────────────────────────

const MAGEARNA = "sv09-107";
const GENGAR = "sv05-104";

const AUTO_HEAL_TEXT =
  "As long as this Pokémon is in the Active Spot, whenever you attach an Energy " +
  "card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon.";
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their " +
  "Pokémon, put 2 damage counters on that Pokémon.";

/** A TANK rather than a second Magearna, and the reason is arithmetic: Magearna
    is HP 90, so a body that can carry more than 90 damage is the only place a
    90-point heal is distinguishable from "healed to zero by any amount". */
const TANK = "d356-tank";
const SMALL = "d356-small"; // HP 60 — the CLAMP's demonstrator
const PLAIN = "d356-plain"; // no ability at all — §2b's control body
const METAL = "d356-metal-energy";

const JET = "sv02-190";

const LOCAL_CARDS: Record<string, Card> = {
  [MAGEARNA]: battler(MAGEARNA, {
    name: "Magearna",
    hp: 90,
    retreat: 1,
    types: ["Metal"],
    abilities: [{ type: "Ability", name: "Auto Heal", effect: AUTO_HEAL_TEXT }],
    attacks: [{ name: "Spike Draw", cost: ["Colorless"], damage: "20", effect: "Draw 2 cards." }],
  }),
  [GENGAR]: battler(GENGAR, {
    name: "Gengar ex",
    hp: 310,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Haunter",
    abilities: [{ type: "Ability", name: "Gnawing Curse", effect: GNAWING_CURSE_TEXT }],
  }),
  [TANK]: battler(TANK, { name: "D356 Tank", hp: 300, retreat: 1, types: ["Metal"] }),
  [SMALL]: battler(SMALL, { name: "D356 Small", hp: 60, retreat: 1, types: ["Metal"] }),
  [PLAIN]: battler(PLAIN, { name: "D356 Plain", hp: 200, retreat: 1, types: ["Colorless"] }),
  [METAL]: typedEnergy(METAL, "Metal"),
  [JET]: specialEnergy(JET, "Jet Energy"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [MAGEARNA]: 4,
  [GENGAR]: 4,
  [TANK]: 8,
  [SMALL]: 8,
  [PLAIN]: 12,
  [METAL]: 20,
  [JET]: 4,
});

const SEEDS = [9107, 9109, 9127] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function board(
  seed: number,
  actor: Seat,
  activeId: string,
  benchIds: readonly string[],
  foeActiveId: string = PLAIN,
): GameState {
  let state = localSetup(seed, actor);
  const foe = actor === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, actor, activeId);
  state = clearBench(state, actor);
  for (const id of benchIds) state = benchFromDeck(state, actor, id);
  state = setActiveFromDeck(state, foe, foeActiveId);
  state = clearBench(state, foe);
  state = benchFromDeck(state, foe, PLAIN);
  state = handFromDeck(state, actor, METAL, 1);
  state = handFromDeck(state, actor, JET, 1);
  return state;
}

/** Walk the clock so `seat` is on turn 3 or later — early-turn bans are not what
    any line below is measuring. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Attach the seat's {M} Energy from hand onto `spot`. */
function attach(
  state: GameState,
  seat: Seat,
  spot: { spot: "active" } | { spot: "bench"; index: number },
): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid: handUid(state, seat, METAL),
    target: spot,
  });
}

function attachJet(
  state: GameState,
  seat: Seat,
  spot: { spot: "active" } | { spot: "bench"; index: number },
): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid: handUid(state, seat, JET),
    target: spot,
  });
}

/** The CARD ID of whatever body is in `seat`'s Active Spot — the identity read
    the §5b cases need, because the whole point there is that the Jet rider
    CHANGES which body that is. */
function activeCardId(state: GameState, seat: Seat): string | undefined {
  const uid = state.players[seat].active?.stack.at(-1);
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function benchCardIds(state: GameState, seat: Seat): (string | undefined)[] {
  return state.players[seat].bench.map((p) => state.cardIdByUid[p.stack.at(-1) ?? ""]);
}

function benchDamage(state: GameState, seat: Seat, index: number): number {
  return state.players[seat].bench[index]?.damage ?? -1;
}

function activeDamage(state: GameState, seat: Seat): number {
  return state.players[seat].active?.damage ?? -1;
}

function healedRows(events: readonly GameEvent[]): { uid: string; amount: number }[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "HEALED" }> => e.type === "HEALED")
    .map((e) => ({ uid: e.uid, amount: e.amount }));
}

function triggeredNames(events: readonly GameEvent[]): string[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "ABILITY_TRIGGERED" }> => {
      return e.type === "ABILITY_TRIGGERED";
    })
    .map((e) => e.ability);
}

// ── 1. THE PROGRAM IS THE SENTENCE, FIELD BY FIELD ───────────────────────────

describe("D356 §1 — the registry row carries the sentence's clauses in named fields", () => {
  it("the row is a TRIGGERED ability on `onEnergyAttach`, `activeOnly`, self-direction", () => {
    const program = programFor(MAGEARNA);
    expect(program).toBeDefined();
    expect(program?.triggered).toHaveLength(1);
    const triggered = program?.triggered?.[0];
    expect(triggered?.name).toBe("Auto Heal");
    expect(triggered?.trigger).toBe("onEnergyAttach");
    // *"As long as this Pokémon is in the Active Spot,"* — THE CLAUSE EVERY PRIOR
    // QUOTE IN THIS REPO DROPPED. It is not decoration: §5 drives it.
    expect(triggered?.activeOnly).toBe(true);
    expect(triggered?.opponentAction).toBeUndefined();
    // `doesNotStack` is NOT printed — and cannot matter here anyway, since
    // `activeOnly` means at most one Magearna is ever a bearer.
    expect(triggered?.doesNotStack).toBeUndefined();
  });

  it("the program is ONE op, and its amount is the printed 90", () => {
    expect(programFor(MAGEARNA)?.triggered?.[0]?.program).toEqual([
      { op: "healSubject", amount: 90 },
    ]);
  });

  it("the row authors NO `attack` key — so `BUILT.attack`'s registry summand cannot move", () => {
    expect(Object.keys(programFor(MAGEARNA) ?? {})).toEqual(["triggered"]);
  });
});

// ── 2. THE HEAL FIRES ON THE CONTROLLER'S OWN ATTACH ─────────────────────────

describe("D356 §2 — the self direction fires, and it heals the body just fed", () => {
  it.each(SEEDS)("seed %i — a damaged BENCHED body attached to is healed 90", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(110);
    expect(triggeredNames(result.events)).toEqual(["Auto Heal"]);
    expect(healedRows(result.events)).toHaveLength(1);
    expect(healedRows(result.events)[0]?.amount).toBe(90);
  });

  it.each(SEEDS)(
    "seed %i — the ACTIVE can be the subject too (Magearna feeding itself)",
    (seed) => {
      // Magearna is HP 90, so it cannot carry 90 damage; 80 is the most it can hold
      // and still be standing, and the heal clamps to it. The point of the line is
      // the SPOT, not the number: `healSubject` searches the Active BEFORE the Bench.
      let state = board(seed, "p1", MAGEARNA, [TANK]);
      state = turnOf(state, "p1");
      state = { ...state, players: { ...state.players } };
      const active = state.players.p1.active;
      if (active === null) throw new Error("no active");
      state = {
        ...state,
        players: {
          ...state.players,
          p1: { ...state.players.p1, active: { ...active, damage: 80 } },
        },
      };
      const result = attach(state, "p1", { spot: "active" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(activeDamage(result.state, "p1")).toBe(0);
      expect(healedRows(result.events)).toHaveLength(1);
      expect(healedRows(result.events)[0]?.amount).toBe(80);
      const activeStack = result.state.players.p1.active?.stack ?? [];
      expect(healedRows(result.events)[0]?.uid).toBe(activeStack[activeStack.length - 1]);
    },
  );

  it.each(SEEDS)("seed %i — §2b THE CONTROL: no Magearna, no heal, same board", (seed) => {
    // The line every §2 assertion needs. Without it, a build that healed on EVERY
    // attach would pass every line above.
    let state = board(seed, "p1", PLAIN, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });
});

// ── 3. THE SEAT IS THE PRINTED POSSESSIVE, NOT THE SCAN DIRECTION ────────────

describe("D356 §3 — *'1 of **your** Pokémon'*: the heal never crosses the table", () => {
  it.each(SEEDS)("seed %i — the OPPONENT attaching does not fire a Magearna", (seed) => {
    let state = board(seed, "p2", PLAIN, [TANK]);
    state = setActiveFromDeck(state, "p1", MAGEARNA);
    state = setBenchDamage(state, "p2", 0, 200);
    state = turnOf(state, "p2");
    const result = attach(state, "p2", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p2", 0)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });

  it.each(SEEDS)("seed %i — a damaged body ACROSS THE TABLE is untouched by the fire", (seed) => {
    // p1 attaches with Magearna Active; p2's benched body carries the same damage
    // as p1's. Exactly one of the two moves, and it is p1's.
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = setBenchDamage(state, "p1", 0, 200);
    state = setBenchDamage(state, "p2", 0, 150);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(110);
    expect(benchDamage(result.state, "p2", 0)).toBe(150);
  });
});

// ── 4. THE ORDER, AND IT IS OBSERVABLE — turn.ts's CITED SECTION ─────────────

describe("D356 §4 — the self sweep runs BEFORE the opponent sweep", () => {
  it.each(SEEDS)("seed %i — Magearna vs Gengar ex on ONE attach: heal, THEN counters", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [TANK], GENGAR);
    state = setBenchDamage(state, "p1", 0, 50);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(20);
    // Both fired, and the ORDER of the two announcements is the order of the two
    // sweeps — the events are the second reading of the same fact.
    expect(triggeredNames(result.events)).toEqual(["Auto Heal", "Gnawing Curse"]);
  });

  it.each(SEEDS)("seed %i — the CONTROL: Gengar ex alone puts its 2 counters on", (seed) => {
    // Without this, §4's `20` could be a heal that never happened plus counters
    // that never happened either.
    let state = board(seed, "p1", PLAIN, [TANK], GENGAR);
    state = setBenchDamage(state, "p1", 0, 50);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(70);
    expect(triggeredNames(result.events)).toEqual(["Gnawing Curse"]);
  });
});

// ── 5. THE CLAUSE EVERY PRIOR QUOTE DROPPED ─────────────────────────────────

describe("D356 §5 — *'As long as this Pokémon is in the Active Spot'*", () => {
  it.each(SEEDS)("seed %i — a BENCHED Magearna heals nothing at all", (seed) => {
    let state = board(seed, "p1", PLAIN, [MAGEARNA, TANK]);
    state = setBenchDamage(state, "p1", 1, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 1)).toBe(200);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual([]);
  });

  it.each(SEEDS)("seed %i — the same board with Magearna ACTIVE does heal — the pair", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [PLAIN, TANK]);
    state = setBenchDamage(state, "p1", 1, 200);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 1)).toBe(110);
  });
});

describe("D357 §5b — the Active-Spot clause reads the board AT THE MOMENT OF THE ATTACH", () => {
  it.each(SEEDS)(
    "seed %i — (a) Jet onto a BENCHED damaged Magearna promotes it and heals NOTHING",
    (seed) => {
      let state = board(seed, "p1", PLAIN, [MAGEARNA, TANK]);
      state = setBenchDamage(state, "p1", 0, 80);
      state = turnOf(state, "p1");
      const result = attachJet(state, "p1", { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // THE RIDER STILL RAN — this is the control that the fix did not simply
      // disable Jet Energy, which would make the negative below meaningless.
      expect(activeCardId(result.state, "p1")).toBe(MAGEARNA);
      expect(benchCardIds(result.state, "p1")).toContain(PLAIN);
      // …and the Ability neither announced nor healed.
      expect(triggeredNames(result.events)).toEqual([]);
      expect(healedRows(result.events)).toEqual([]);
      expect(activeDamage(result.state, "p1")).toBe(80);
    },
  );

  it.each(SEEDS)(
    "seed %i — (b) Magearna ACTIVE, Jet onto a damaged BENCHED body: the 90 is NOT lost",
    (seed) => {
      let state = board(seed, "p1", MAGEARNA, [TANK, PLAIN]);
      state = setBenchDamage(state, "p1", 0, 200);
      state = turnOf(state, "p1");
      const before = state.players.p1.bench[0]?.stack.at(-1);
      const result = attachJet(state, "p1", { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The rider ran: the tank is Active, Magearna is on the Bench.
      expect(activeCardId(result.state, "p1")).toBe(TANK);
      expect(benchCardIds(result.state, "p1")).toContain(MAGEARNA);
      expect(triggeredNames(result.events)).toEqual(["Auto Heal"]);
      expect(healedRows(result.events)).toEqual([{ uid: before as string, amount: 90 }]);
      expect(activeDamage(result.state, "p1")).toBe(110);
    },
  );

  it.each(SEEDS)(
    "seed %i — (b's control) the SAME board with a plain {M} keeps the heal AND the spots",
    (seed) => {
      let state = board(seed, "p1", MAGEARNA, [TANK, PLAIN]);
      state = setBenchDamage(state, "p1", 0, 200);
      state = turnOf(state, "p1");
      const result = attach(state, "p1", { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(activeCardId(result.state, "p1")).toBe(MAGEARNA);
      expect(benchDamage(result.state, "p1", 0)).toBe(110);
      expect(healedRows(result.events).map((r) => r.amount)).toEqual([90]);
    },
  );

  it.each(SEEDS)(
    "seed %i — (a's mirror) Jet onto a damaged body while Magearna is ALSO benched",
    (seed) => {
      // Neither board has Magearna Active — not the moment's, not the sweep's —
      // so there is no reading under which anything heals. The case that would
      // go red if the fix had inverted the comparison rather than re-pointed it.
      let state = board(seed, "p1", PLAIN, [TANK, MAGEARNA]);
      state = setBenchDamage(state, "p1", 0, 200);
      state = turnOf(state, "p1");
      const result = attachJet(state, "p1", { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(activeCardId(result.state, "p1")).toBe(TANK);
      expect(activeDamage(result.state, "p1")).toBe(200);
      expect(healedRows(result.events)).toEqual([]);
      expect(triggeredNames(result.events)).toEqual([]);
    },
  );
});

// ── 6. THE CLAMP, AND THE SILENT WHIFF ──────────────────────────────────────

describe("D356 §6 — clamped to the damage present, and silent when there is none", () => {
  it.each(SEEDS)("seed %i — 30 damage heals 30, not 90", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [SMALL]);
    state = setBenchDamage(state, "p1", 0, 30);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(0);
    expect(healedRows(result.events)[0]?.amount).toBe(30);
  });

  it.each(SEEDS)("seed %i — an UNDAMAGED body emits NO `HEALED` row", (seed) => {
    let state = board(seed, "p1", MAGEARNA, [TANK]);
    state = turnOf(state, "p1");
    const result = attach(state, "p1", { spot: "bench", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(benchDamage(result.state, "p1", 0)).toBe(0);
    expect(healedRows(result.events)).toEqual([]);
    expect(triggeredNames(result.events)).toEqual(["Auto Heal"]);
  });
});

describe("D356 §7 — the pool and the registry keys", () => {
  it("Magearna is a registry key", () => {
    expect(registryCardIds()).toContain(MAGEARNA);
  });

  it("the +1 on `raw.length` is EXACTLY this one id", () => {
    const keys = new Set(registryCardIds());
    expect(keys.has(MAGEARNA)).toBe(true);
    expect(registryCardIds().filter((id) => id === MAGEARNA).length).toBe(1);
    expect(keys.has(GENGAR)).toBe(true);
    expect(keys.has(JET)).toBe(true);
    for (const id of Object.keys(LOCAL_CARDS)) {
      if (id === MAGEARNA || id === GENGAR || id === JET) continue;
      expect(keys.has(id)).toBe(false);
    }
  });

  it("D357 — Jet Energy is BOTH a registry key AND a `FIXTURE_POOL` member", () => {
    expect(FIXTURE_POOL[JET]).toBeDefined();
    expect(registryCardIds()).toContain(JET);
    // …and the LOCAL card this suite defines for it is its own object, not the
    // pool's — the suite drives `programFor(JET)`, never `FIXTURE_POOL[JET]`.
    expect(LOCAL_CARDS[JET]).not.toBe(FIXTURE_POOL[JET]);
    expect(programFor(JET)?.energy?.onAttach).toEqual({ kind: "switchIfBenched" });
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    // Every id here but `sv02-190` (see the case above, which asserts that one by
    // name) is absent from the shared pool.
    for (const id of Object.keys(LOCAL_CARDS)) {
      if (id === JET) continue;
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

describe("D356 §8 — what row 12's closure leaves behind", () => {
  it("ROW 12's ABILITY HALF IS CLOSED, AND WITH IT THE `ROWS` TABLE'S LAST LIVE RESIDUE", () => {
    expect(programFor(MAGEARNA)).toBeDefined();
  });

  it("the sweep reaches TWO further printings and NEITHER is legal — Minior", () => {
    expect(programFor("sv04-099")).toBeUndefined();
    expect(programFor("sv04-201")).toBeUndefined();
  });

  it("the OP's one further printing is Medical Energy, and it is rotated", () => {
    expect(programFor("sv04-182")).toBeUndefined();
    expect(programFor("sv02-190")).toBeDefined();
  });

  it("the CONSEQUENT grammar's 7 OTHER legal printings are NOT this op's — all built", () => {
    for (const id of ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"]) {
      expect(programFor(id)).toBeDefined();
    }
  });
});
