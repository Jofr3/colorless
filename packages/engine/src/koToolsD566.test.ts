import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "./events";
import { resolveMidTurnKnockOuts } from "./flow";
import { applyAction } from "./index";
import type { GameAction, GameState, PendingStage, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  must,
  mustApply as run,
  driveSetup,
} from "./testFixtures";
import { koHolderToolTriggersOf, koToolTriggersOf } from "./triggers";
import type { InPlayPokemon } from "./types";

const HEAVY_BATON = "sv05-151";
const AMULET = "sv08-162";
const POWERGLASS = ["sv06.5-063", "sv06.5-097"] as const;
const EXP_SHARE = "sv01-174"; // rotated; in FIXTURE_POOL — the first-match pin only
const JAMMING_TOWER = "sv06-153";
const WASTELAND = "sv02-175"; // Calamitous Wasteland — +1 Retreat on Basic non-{F}
const BEACH_COURT = "sv01-167"; // Beach Court — -1 Retreat on Basic
const AMARYS = "sv08.5-093";
const ENERGY = "fix-energy";
const ATTACKER = "d566k-attacker";
const GLASS_ATTACKER = "d566k-glass";
const HEAVY = "d566k-heavy"; // Retreat 4, 30 HP
const THREE = "d566k-three"; // Retreat 3, 30 HP
const FIVE = "d566k-five"; // Retreat 5, 30 HP — "exactly 4" refuses it too
const FRAIL = "d566k-frail"; // Retreat 1, 20 HP — a Bench snipe victim
const FILLER = "d566k-filler";

const LOCAL_CARDS: Record<string, Card> = {
  [HEAVY_BATON]: { ...trainerCard(HEAVY_BATON, "Tool", "…"), name: "Heavy Baton" },
  [AMULET]: { ...trainerCard(AMULET, "Tool", "…"), name: "Amulet of Hope" },
  ...Object.fromEntries(
    POWERGLASS.map((id) => [id, { ...trainerCard(id, "Tool", "…"), name: "Powerglass" }]),
  ),
  [JAMMING_TOWER]: { ...trainerCard(JAMMING_TOWER, "Stadium", "…"), name: "Jamming Tower" },
  [AMARYS]: { ...trainerCard(AMARYS, "Supporter", "…"), name: "Amarys" },
  [ATTACKER]: battler(ATTACKER, {
    name: "D566 Attacker",
    types: ["Fire"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Recoil",
        damage: 30,
        effect: "This Pokémon also does 30 damage to itself.",
      },
      {
        cost: ["Colorless"],
        name: "Yawn",
        effect: "Your opponent's Active Pokémon is now Asleep.",
      },
      {
        cost: ["Colorless"],
        name: "Doom",
        effect: "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.",
      },
    ],
  }),
  [GLASS_ATTACKER]: battler(GLASS_ATTACKER, {
    name: "D566 Glass Attacker",
    types: ["Fire"],
    hp: 30,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Recoil",
        damage: 30,
        effect: "This Pokémon also does 30 damage to itself.",
      },
    ],
  }),
  [HEAVY]: battler(HEAVY, { name: "D566 Heavy", types: ["Water"], hp: 30, retreat: 4 }),
  [THREE]: battler(THREE, { name: "D566 Three", types: ["Water"], hp: 30, retreat: 3 }),
  [FIVE]: battler(FIVE, { name: "D566 Five", types: ["Water"], hp: 30, retreat: 5 }),
  [FRAIL]: battler(FRAIL, { name: "D566 Frail", types: ["Water"], hp: 20, retreat: 1 }),
  [FILLER]: battler(FILLER, { name: "D566 Filler", types: ["Water"], hp: 900, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [HEAVY_BATON]: 2,
  [AMULET]: 2,
  [POWERGLASS[0]]: 1,
  [POWERGLASS[1]]: 1,
  [EXP_SHARE]: 1,
  [JAMMING_TOWER]: 1,
  [WASTELAND]: 1,
  [BEACH_COURT]: 1,
  [AMARYS]: 1,
  [ATTACKER]: 3,
  [GLASS_ATTACKER]: 1,
  [HEAVY]: 3,
  [THREE]: 2,
  [FIVE]: 1,
  [FRAIL]: 3,
  [ENERGY]: 14,
  [FILLER]: 22,
});

function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id} in the deck`);
    deck = deck.filter((u) => u !== uid);
    hand.push(uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => state.cardIdByUid[u] !== id);
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

type Spot = "active" | number;

function bodyAt(state: GameState, seat: Seat, spot: Spot): InPlayPokemon {
  const side = state.players[seat];
  const p = spot === "active" ? side.active : side.bench[spot];
  if (p === null || p === undefined) throw new Error(`no body at ${seat} ${String(spot)}`);
  return p;
}

function withBody(
  state: GameState,
  seat: Seat,
  spot: Spot,
  f: (p: InPlayPokemon) => InPlayPokemon,
): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — attach a deck copy of `id` to the body, as Energy or as a Tool. */
function attach(
  state: GameState,
  seat: Seat,
  spot: Spot,
  id: string,
  as: "energy" | "tools" = "energy",
): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  const moved = {
    ...next,
    players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
  return withBody(moved, seat, spot, (p) => ({ ...p, [as]: [...p[as], uid] }));
}

/** TEST SURGERY — `id` out of `seat`'s deck into the Stadium zone. */
function stadium(state: GameState, seat: Seat, id: string): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id) as string;
  return {
    ...next,
    stadium: { uid, owner: seat },
    players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

function toDiscard(state: GameState, seat: Seat, id: string): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id) as string;
  return {
    ...next,
    players: {
      ...next.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        discard: [...side.discard, uid],
      },
    },
  };
}

interface Field {
  victim?: string;
  bench?: readonly string[];
  attacker?: string;
  attackerBench?: readonly string[];
  seed?: number;
}

/** p1's turn 2: p1 `attacker` (one {C} attached) + `attackerBench`; p2 `victim` + `bench`. Hands empty. */
function field(opts: Field = {}): GameState {
  let state = setHand(setHand(opened(opts.seed ?? 5681), "p1", []), "p2", []);
  const victim = opts.victim ?? HEAVY;
  state = setActiveFromDeck(ensureInDeck(state, "p2", victim), "p2", victim);
  state = clearBench(state, "p2");
  for (const id of opts.bench ?? [FILLER, FILLER])
    state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  const attacker = opts.attacker ?? ATTACKER;
  state = setActiveFromDeck(ensureInDeck(state, "p1", attacker), "p1", attacker);
  state = clearBench(state, "p1");
  for (const id of opts.attackerBench ?? [FILLER])
    state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  return attach(state, "p1", "active", ENERGY);
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Answer every prize / promotion interrupt with its first option, collecting events, until the
    board parks on an effect or the turn changes hands. */
function drain(start: { state: GameState; events: GameEvent[] }): {
  state: GameState;
  events: GameEvent[];
} {
  let { state, events } = start;
  for (let i = 0; i < 20; i++) {
    const phase = state.phase;
    if (phase.kind === "ko:takePrizes") {
      const next = run(state, {
        type: "takePrizes",
        seat: phase.seat,
        prizeIndices: Array.from({ length: phase.count }, (_, k) => k),
      });
      state = next.state;
      events = [...events, ...next.events];
    } else if (phase.kind === "ko:promote") {
      const next = run(state, { type: "promote", seat: phase.seat, benchIndex: 0 });
      state = next.state;
      events = [...events, ...next.events];
    } else {
      return { state, events };
    }
  }
  throw new Error("drain did not settle");
}

function parked(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints and the registry rows", () => {
  it("Heavy Baton: the NEW self timing, a declinable up-to-3 Basic Energy move from the dying Active to the Bench in any way", () => {
    expect(programFor(HEAVY_BATON)).toEqual({
      triggered: [
        {
          name: "Heavy Baton",
          trigger: "onHolderActiveKnockedOut",
          program: [
            {
              op: "moveEnergy",
              filter: { kind: "basicEnergy" },
              max: 3,
              route: "selfToBench",
              anyDest: true,
            },
          ],
        },
      ],
    });
  });

  it("Amulet of Hope: the NEW after-the-KO timing, an UNREVEALED up-to-3 any-card search, then the shuffle", () => {
    expect(programFor(AMULET)).toEqual({
      triggered: [
        {
          name: "Amulet of Hope",
          trigger: "onHolderKnockedOut",
          program: [
            { op: "searchDeck", filter: { kind: "anyCard" }, max: 3, dest: "hand" },
            { op: "shuffleDeck" },
          ],
        },
      ],
    });
  });

  it('Powerglass: the NEW end-of-turn timing, Charging Up\'s discard attach to itself plus the printed "you may"; the reprint shares the object', () => {
    const first = programFor(POWERGLASS[0]);
    expect(first).toEqual({
      triggered: [
        {
          name: "Powerglass",
          trigger: "atEndOfYourTurnInActive",
          program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true, declinable: true }],
        },
      ],
    });
    expect(programFor(POWERGLASS[1])).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — Heavy Baton: the self arm of the KO-moment Tool scan", () => {
  /** p2's Active `victim` carries Heavy Baton and three Basic Energy; two filler bodies benched. */
  function baton(victim = HEAVY, seed = 5682): GameState {
    let state = field({ victim, seed });
    state = attach(state, "p2", "active", HEAVY_BATON, "tools");
    for (let i = 0; i < 3; i++) state = attach(state, "p2", "active", ENERGY);
    return state;
  }

  it("Retreat 4, Active, KO'd by Bite: the move PARKS for p2 — the dying Active's three Energy, both Bench bodies, `anyDest`, up to 3", () => {
    const state = baton();
    const energy = bodyAt(state, "p2", "active").energy;
    const after = run(state, attack(0)).state;
    const phase = parked(after);
    expect(phase.seat).toBe("p2");
    if (phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    expect(phase.prompt.movable.map((m) => m.uid).sort()).toEqual([...energy].sort());
    expect(phase.prompt.destinations).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
    expect(phase.prompt.max).toBe(3);
    expect(phase.prompt.anyDest).toBe(true);
  });

  it("answered 2 + 1 across the Bench: the Energy lands, THEN the KO takes the body (nothing moved is discarded)", () => {
    const state = baton();
    const [a, b, c] = bodyAt(state, "p2", "active").energy as [string, string, string];
    const after = run(state, attack(0)).state;
    const bench0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;
    const bench1 = { seat: "p2", spot: { spot: "bench", index: 1 } } as const;
    const answered = drain(
      run(after, {
        type: "resolveEffect",
        seat: "p2",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: a, dest: bench0 },
            { uid: b, dest: bench0 },
            { uid: c, dest: bench1 },
          ],
        },
      }),
    );
    const ko = all(answered.events, "KNOCKED_OUT");
    expect(ko).toHaveLength(1);
    expect(ko[0]?.discarded).not.toContain(a);
    const p2 = answered.state.players.p2;
    const carried = [p2.active, ...p2.bench].flatMap((p) => p?.energy ?? []);
    expect(carried).toEqual(expect.arrayContaining([a, b, c]));
  });

  it('the printed "you may": an empty answer declines, and the Energy goes down with the body', () => {
    const state = baton();
    const energy = bodyAt(state, "p2", "active").energy;
    const after = run(state, attack(0)).state;
    const declined = drain(
      run(after, { type: "resolveEffect", seat: "p2", choice: { kind: "moveEnergy", picks: [] } }),
    );
    expect(all(declined.events, "KNOCKED_OUT")[0]?.discarded).toEqual(
      expect.arrayContaining([...energy]),
    );
  });

  it("Retreat 3 and Retreat 5: NOT exactly 4 — no park, the Energy is discarded with the body", () => {
    for (const victim of [THREE, FIVE]) {
      const { state, events } = drain(run(baton(victim), attack(0)));
      expect(state.phase.kind, victim).not.toBe("effect:choose");
      expect(all(events, "KNOCKED_OUT"), victim).toHaveLength(1);
    }
  });

  it("R-HB (UNRULED): the EFFECTIVE cost — printed 3 under Calamitous Wasteland (+1) is 4 and FIRES; printed 4 under Beach Court (-1) is 3 and does NOT", () => {
    const wasteland = run(stadium(baton(THREE), "p1", WASTELAND), attack(0)).state;
    expect(parked(wasteland).prompt.kind).toBe("moveEnergy");
    const court = drain(run(stadium(baton(HEAVY), "p1", BEACH_COURT), attack(0)));
    expect(court.state.phase.kind).not.toBe("effect:choose");
  });

  it("not Knocked Out (Yawn deals nothing): the seeded stage re-asks lethality and does nothing", () => {
    const { state } = run(baton(), attack(3));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(bodyAt(state, "p2", "active").energy).toHaveLength(3);
  });

  it("a Heavy Baton on a BENCH body does not fire for the Active's KO (the self arm reads ONLY the dying body)", () => {
    let state = field({ victim: HEAVY, seed: 5683 });
    state = attach(state, "p2", 0, HEAVY_BATON, "tools");
    state = attach(state, "p2", "active", ENERGY);
    const { state: after } = drain(run(state, attack(0)));
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("the scan: the KO'd body's Heavy Baton answers the SELF timing; an Exp. Share on it would NOT (THE KO'D BODY IS SKIPPED for the ally timing)", () => {
    const state = baton();
    const koed = bodyAt(state, "p2", "active").stack.at(-1) as string;
    expect(koToolTriggersOf(state, "p2", koed).map((e) => e.ability.name)).toEqual(["Heavy Baton"]);
    let share = field({ victim: HEAVY, seed: 5684 });
    share = attach(share, "p2", "active", EXP_SHARE, "tools");
    const shareKoed = bodyAt(share, "p2", "active").stack.at(-1) as string;
    expect(koToolTriggersOf(share, "p2", shareKoed)).toEqual([]);
  });

  it("FIRST MATCH ONLY (a stated limitation): Heavy Baton on the dying Active precedes an Exp. Share on the Bench, and only the Baton asks", () => {
    let state = baton();
    state = attach(state, "p2", 0, EXP_SHARE, "tools");
    const koed = bodyAt(state, "p2", "active").stack.at(-1) as string;
    expect(koToolTriggersOf(state, "p2", koed).map((e) => e.ability.name)).toEqual([
      "Heavy Baton",
      "Exp. Share",
    ]);
    const after = run(state, attack(0)).state;
    const prompt = parked(after).prompt;
    if (prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    expect(prompt.anyDest).toBe(true);
    expect(prompt.max).toBe(3);
    const done = drain(
      run(after, { type: "resolveEffect", seat: "p2", choice: { kind: "moveEnergy", picks: [] } }),
    );
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("the parked move round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36)", () => {
    const after = JSON.parse(JSON.stringify(run(baton(), attack(0)).state)) as GameState;
    const [a] = bodyAt(after, "p2", "active").energy as [string];
    const dest = { seat: "p2", spot: { spot: "bench", index: 1 } } as const;
    const done = drain(
      run(after, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "moveEnergy", picks: [{ uid: a, dest }] },
      }),
    );
    expect(done.state.players.p2.bench.some((p) => p.energy.includes(a))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Amulet of Hope: a koTrigger per Tool, AFTER the Knock Out", () => {
  function amulet(opts: Field & { amuletOn?: readonly Spot[] } = {}): GameState {
    let state = field({ victim: FILLER, bench: [FRAIL, FILLER], ...opts });
    state = withBody(state, "p2", "active", (p) => ({ ...p, damage: 890 }));
    for (const spot of opts.amuletOn ?? ["active"])
      state = attach(state, "p2", spot, AMULET, "tools");
    return state;
  }

  const searchPark = (state: GameState) => {
    const phase = parked(state);
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    return { phase, prompt: phase.prompt };
  };

  it("an ACTIVE KO'd by an attack: PRIZES → the Amulet's search (p2, up to 3, any card, NOT revealed) → PROMOTION", () => {
    const state = amulet();
    const { state: after, events } = drain(run(state, attack(0)));
    expect(all(events, "PRIZES_TAKEN").length + all(events, "PRIZES_OWED").length).toBeGreaterThan(
      0,
    );
    const { phase, prompt } = searchPark(after);
    expect(phase.seat).toBe("p2");
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
    expect(prompt.candidates).toHaveLength(after.players.p2.deck.length);
    expect(after.pending.some((stage) => stage.kind === "promote")).toBe(true);
    const picks = after.players.p2.deck.slice(0, 3);
    const answered = run(after, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: picks },
    });
    expect(picks.every((u) => answered.state.players.p2.hand.includes(u))).toBe(true);
    expect(all(answered.events, "DECK_SEARCHED")[0]?.reveal).toBeUndefined();
    expect(all(answered.events, "SHUFFLE")).toHaveLength(1);
  });

  it("the stage carries the Tool's uid and sits between the prize stage and the promotion (the inherited grouping)", () => {
    const state = amulet();
    const toolUid = bodyAt(state, "p2", "active").tools[0] as string;
    const after = run(state, attack(0)).state;
    const kinds = after.pending.map((stage) => stage.kind);
    const trigger = after.pending.find((stage) => stage.kind === "koTrigger") as Extract<
      PendingStage,
      { kind: "koTrigger" }
    >;
    expect(trigger.toolUid).toBe(toolUid);
    expect(kinds.indexOf("koTrigger")).toBeLessThan(kinds.indexOf("promote"));
    expect(kinds.indexOf("takePrizes")).toBeLessThan(kinds.indexOf("koTrigger"));
  });

  it("a BENCH body KO'd by the attack's snipe fires it too (Active OR Bench)", () => {
    let state = field({ victim: FILLER, bench: [FRAIL, FILLER], seed: 5685 });
    state = attach(state, "p2", 0, AMULET, "tools");
    const { state: after } = drain(run(state, attack(1)));
    expect(searchPark(after).phase.seat).toBe("p2");
  });

  it("TWO Amulets in one batch (Active and Bench, one Spread Shot): TWO searches, one after the other", () => {
    const state = amulet({ amuletOn: ["active", 0], seed: 5686 });
    const first = drain(run(state, attack(1))).state;
    expect(first.pending.filter((stage) => stage.kind === "koTrigger")).toHaveLength(1);
    const second = drain(
      run(first, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [] } }),
    ).state;
    expect(searchPark(second).phase.seat).toBe("p2");
    const done = drain(
      run(second, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [] } }),
    ).state;
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("a CHECKUP KO does not fire it (no attack)", () => {
    let state = amulet({ seed: 5687 });
    state = withBody(state, "p2", "active", (p) => ({
      ...p,
      damage: 890,
      conditions: { ...p.conditions, poisonDamage: 10 },
    }));
    const { state: after, events } = drain(run(state, { type: "endTurn", seat: "p1" }));
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("a MID-TURN KO does not fire it (the sweep passes no attacker)", () => {
    let state = amulet({ seed: 5688 });
    state = withBody(state, "p2", "active", (p) => ({ ...p, damage: 900 }));
    const events: GameEvent[] = [];
    const result = resolveMidTurnKnockOuts(state, "p1", ["p1", "p2"], events);
    if (!result.ok) throw new Error("sweep failed");
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(result.state.pending.some((stage) => stage.kind === "koTrigger")).toBe(false);
  });

  it("an OWN-RECOIL KO does not fire it (the attacker's own body — not \"your opponent's Pokémon\")", () => {
    let state = field({ attacker: GLASS_ATTACKER, victim: FILLER, seed: 5689 });
    state = attach(state, "p1", "active", AMULET, "tools");
    const { state: after, events } = drain(run(state, attack(0)));
    expect(all(events, "KNOCKED_OUT").map((e) => e.seat)).toEqual(["p1"]);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it('a KO WITHOUT DAMAGE (Doom\'s "it is Knocked Out") does not fire it ("by damage from an attack")', () => {
    const state = amulet({ seed: 5690 });
    const { state: after, events } = drain(
      run(
        withBody(state, "p2", "active", (p) => ({ ...p, damage: 0 })),
        attack(4),
      ),
    );
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("under Jamming Tower the Amulet does nothing (the scan reads `toolsInEffect`)", () => {
    const state = stadium(amulet({ seed: 5691 }), "p1", JAMMING_TOWER);
    const body = bodyAt(state, "p2", "active");
    expect(koHolderToolTriggersOf(state, body)).toEqual([]);
    const { state: after } = drain(run(state, attack(0)));
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("the parked search round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36)", () => {
    const after = JSON.parse(
      JSON.stringify(drain(run(amulet({ seed: 5692 }), attack(0))).state),
    ) as GameState;
    const pick = after.players.p2.deck[0] as string;
    const done = run(after, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(done.state.players.p2.hand).toContain(pick);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Powerglass: the first end-of-turn stage that can park", () => {
  function glass(seed = 5693, energyInDiscard = true): GameState {
    let state = field({ victim: FILLER, seed });
    state = attach(state, "p1", "active", POWERGLASS[0], "tools");
    return energyInDiscard ? toDiscard(state, "p1", ENERGY) : state;
  }

  it("a turn ended with no attack: p1 is asked BEFORE `TURN_ENDED`, and answering attaches the discard Energy to the Active", () => {
    const state = glass();
    const energy = state.players.p1.discard.find((u) => state.cardIdByUid[u] === ENERGY) as string;
    const { state: after, events } = run(state, { type: "endTurn", seat: "p1" });
    const phase = parked(after);
    expect(phase.seat).toBe("p1");
    expect(phase.prompt.kind).toBe("choosePokemon");
    expect(all(events, "TURN_ENDED")).toHaveLength(0);
    expect(after.pending.map((stage) => stage.kind)).toEqual(["endTurn", "checkup", "startTurn"]);
    const answered = run(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } } },
    });
    expect(bodyAt(answered.state, "p1", "active").energy).toContain(energy);
    expect(all(answered.events, "TURN_ENDED")).toHaveLength(1);
    expect(answered.state.phase.kind).toBe("turn:action");
  });

  it('the printed "you may": a decline attaches nothing, and the turn still ends', () => {
    const after = run(glass(5694), { type: "endTurn", seat: "p1" }).state;
    const declined = run(after, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
    expect(bodyAt(declined.state, "p1", "active").energy).toHaveLength(1);
    expect(all(declined.events, "TURN_ENDED")).toHaveLength(1);
  });

  it("after an ATTACK too — the Bite resolves, then Powerglass asks, then the turn ends", () => {
    const after = drain(run(glass(5695), attack(3))).state;
    expect(parked(after).seat).toBe("p1");
    const done = run(after, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
    expect(all(done.events, "TURN_ENDED")).toHaveLength(1);
  });

  it("no Basic Energy in the discard: nothing to ask, and the queue is the ordinary one", () => {
    const { state, events } = run(glass(5696, false), { type: "endTurn", seat: "p1" });
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "TURN_ENDED")).toHaveLength(1);
  });

  it('a Powerglass on a BENCH body is not seeded ("in the Active Spot")', () => {
    let state = field({ victim: FILLER, seed: 5697 });
    state = attach(state, "p1", 0, POWERGLASS[1], "tools");
    state = toDiscard(state, "p1", ENERGY);
    const { state: after } = run(state, { type: "endTurn", seat: "p1" });
    expect(after.phase.kind).toBe("turn:action");
    expect(after.phase.kind === "turn:action" ? after.phase.seat : null).toBe("p2");
  });

  it("the OPPONENT's Powerglass does not fire on YOUR turn end (the turn owner's Active only)", () => {
    let state = field({ victim: FILLER, seed: 5698 });
    state = attach(state, "p2", "active", POWERGLASS[0], "tools");
    state = toDiscard(state, "p2", ENERGY);
    expect(run(state, { type: "endTurn", seat: "p1" }).state.phase.kind).toBe("turn:action");
  });

  it("ORDER, pinned: Powerglass asks BEFORE Amarys's end-of-turn discard (moot — it moves no hand card)", () => {
    let state = glass(5699);
    state = setHand(state, "p1", [FILLER, FILLER, FILLER, FILLER, FILLER]);
    state = { ...state, allowances: { ...state.allowances, endOfTurnHandDiscard: 5 } };
    const after = run(state, { type: "endTurn", seat: "p1" }).state;
    expect(after.players.p1.hand).toHaveLength(5);
    const done = run(after, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
    expect(done.state.players.p1.hand).toHaveLength(0);
  });

  it("the parked question round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36): the re-queued `endTurn` carries `toolsDone`", () => {
    const after = JSON.parse(
      JSON.stringify(run(glass(5700), { type: "endTurn", seat: "p1" }).state),
    ) as GameState;
    expect(after.pending[0]).toEqual({ kind: "endTurn", seat: "p1", toolsDone: true });
    const done = run(after, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });
    expect(all(done.events, "TURN_ENDED")).toHaveLength(1);
  });
});
