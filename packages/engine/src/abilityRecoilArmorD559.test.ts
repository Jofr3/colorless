import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { passivesOf, seatDamageReduction } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// ── 🆕🆕🆕 D559 — THE ABILITY BUNDLE, PART 2: THE RECOIL AND THE REDUCTIONS ──
//
//   Orthworm ex  sv07-110 / -162        "Pummeling Payback"  damageAttacker × {M} count
//   Maractus     sv09-008 / -160        "Exploding Needles"  damageAttackerOnKo, activeOnly
//   Klinklang    sv10.5b-063 / -141     "Gear Coating"       seatDamageReductionAfterWR, {M} holders
//   Regirock     sv09-082               "Rock Armor"         damageReductionAfterWR while any Energy
//
// Part 1 (the registry rows, Fairy Zone and the two locks, incl. Gastrodon's reach over a
// benched Klinklang) is `abilityBundleD559.test.ts`. A LOCAL `cardPool` (D275) in the
// suite's OWN 60-card deck (D270). Readings R-O1 (⚠️ a reachable DEVIATION), R-M1, R-GC
// (D558 ⑶-bis inherited) and R-RA: docs/decisions.md D559.

const ORTHWORM = ["sv07-110", "sv07-162"] as const;
const MARACTUS = ["sv09-008", "sv09-160"] as const;
const KLINKLANG = ["sv10.5b-063", "sv10.5b-141"] as const;
const REGIROCK = "sv09-082";
const LUMINOUS = "sv02-191"; // Luminous Energy — provides every type while alone (D118 provision)
const METAL = "fix-metal-energy";
const PLAIN_ENERGY = "fix-energy";

const BENCH_CLAUSE = "(Don't apply Weakness and Resistance for Benched Pokémon.)";
const ATTACKS = [
  { cost: ["Colorless"], name: "Strike", damage: 50 },
  { cost: ["Colorless"], name: "Heave", damage: 130 },
  {
    cost: ["Colorless"],
    name: "Sweep",
    damage: 10,
    effect: `This attack also does 30 damage to each of your opponent's Benched Pokémon. ${BENCH_CLAUSE}`,
  },
  {
    cost: ["Colorless"],
    name: "Backfire",
    damage: 10,
    effect: `This attack also does 30 damage to each of your Benched Pokémon. ${BENCH_CLAUSE}`,
  },
  {
    cost: ["Colorless"],
    name: "Needle",
    damage: 10,
    effect: `This attack also does 40 damage to 1 of your opponent's Benched Pokémon. ${BENCH_CLAUSE}`,
  },
];
const [STRIKE, HEAVE, SWEEP, BACKFIRE, NEEDLE] = [0, 1, 2, 3, 4];

const STRIKER = "d559r-striker";
const WALL = "d559r-wall";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    ORTHWORM.map((id) => [
      id,
      battler(id, {
        name: "Orthworm ex",
        hp: 220,
        retreat: 4,
        types: ["Metal"],
        weaknesses: [{ type: "Fire", value: "×2" }],
        resistances: [{ type: "Grass", value: "-30" }],
        abilities: [
          {
            type: "Ability",
            name: "Pummeling Payback",
            effect:
              "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon for each {M} Energy attached to this Pokémon.",
          },
        ],
        attacks: [
          {
            cost: ["Colorless", "Colorless", "Colorless", "Colorless"],
            name: "Rock Tomb",
            damage: 150,
            effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
          },
        ],
      }),
    ]),
  ),
  ...Object.fromEntries(
    MARACTUS.map((id) => [
      id,
      battler(id, {
        name: "Maractus",
        hp: 110,
        retreat: 2,
        types: ["Grass"],
        weaknesses: [{ type: "Fire", value: "×2" }],
        abilities: [
          {
            type: "Ability",
            name: "Exploding Needles",
            effect:
              "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, put 6 damage counters on the Attacking Pokémon.",
          },
        ],
        attacks: [
          {
            cost: ["Colorless"],
            name: "Corner",
            damage: 20,
            effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
          },
        ],
      }),
    ]),
  ),
  ...Object.fromEntries(
    KLINKLANG.map((id) => [
      id,
      battler(id, {
        name: "Klinklang",
        stage: "Stage2",
        evolveFrom: "Klang",
        hp: 150,
        retreat: 3,
        types: ["Metal"],
        weaknesses: null,
        abilities: [
          {
            type: "Ability",
            name: "Gear Coating",
            effect:
              "All of your Pokémon that have any {M} Energy attached take 20 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
          },
        ],
        attacks: [{ cost: ["Metal", "Colorless", "Colorless"], name: "Hammer In", damage: 120 }],
      }),
    ]),
  ),
  [REGIROCK]: battler(REGIROCK, {
    name: "Regirock",
    hp: 130,
    retreat: 3,
    types: ["Fighting"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Rock Armor",
        effect:
          "If this Pokémon has any Energy attached, it takes 30 less damage from attacks (after applying Weakness and Resistance).",
      },
    ],
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Fighting"],
        name: "Breaching Lariat",
        damage: 120,
        effect: "This attack's damage isn't affected by Resistance.",
      },
    ],
  }),
  [STRIKER]: battler(STRIKER, {
    name: "D559 Striker",
    hp: 300,
    retreat: 1,
    types: ["Colorless"],
    attacks: ATTACKS,
  }),
  [WALL]: battler(WALL, {
    name: "D559 Bulwark",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: null,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [ORTHWORM[0]]: 1,
  [ORTHWORM[1]]: 1,
  [MARACTUS[0]]: 1,
  [MARACTUS[1]]: 1,
  [KLINKLANG[0]]: 1,
  [KLINKLANG[1]]: 1,
  [REGIROCK]: 1,
  [STRIKER]: 3,
  [WALL]: 4,
  [LUMINOUS]: 2,
  [METAL]: 14,
  [PLAIN_ENERGY]: 30,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — `count` copies of `id` into `seat`'s DECK (back from the hand, or swapped
    out of the Prizes for a deck card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string, count = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= count) return next;
    const held = side.hand.find((u) => next.cardIdByUid[u] === id);
    if (held !== undefined) {
      const moved = {
        ...side,
        hand: side.hand.filter((u) => u !== held),
        deck: [...side.deck, held],
      };
      next = { ...next, players: { ...next.players, [seat]: moved } };
      continue;
    }
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    const swap = side.deck.find((u) => next.cardIdByUid[u] !== id);
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
    const moved = {
      ...side,
      prizes: side.prizes.map((u) => (u === prized ? swap : u)),
      deck: [...side.deck.filter((u) => u !== swap), prized],
    };
    next = { ...next, players: { ...next.players, [seat]: moved } };
  }
}

/** `id` as `seat`'s Active — kept if setup already put it there (a lone copy cannot be
    pulled from the deck), else pulled through `ensureInDeck`. */
function seatActive(state: GameState, seat: Seat, id: string): GameState {
  const active = state.players[seat].active;
  const top = active?.stack[active.stack.length - 1];
  if (top !== undefined && state.cardIdByUid[top] === id) return state;
  return setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
}

/** p1's turn 2 with STRIKER Active (one Colorless Energy) plus `bench`, and `oppActive` /
    `oppBench` for p2. */
function table(
  bench: readonly string[],
  oppActive: string,
  oppBench: readonly string[] = [],
): GameState {
  let state = opened(5592);
  state = seatActive(state, "p1", STRIKER);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return attachFromDeck(ensureInDeck(state, "p1", PLAIN_ENERGY), "p1", PLAIN_ENERGY, 1);
}

/** TEST SURGERY — `count` copies of Energy `id` from `seat`'s deck onto its Active or bench[i]. */
function energize(
  state: GameState,
  seat: Seat,
  spot: "active" | number,
  id: string,
  count: number,
): GameState {
  const ready = ensureInDeck(state, seat, id, count);
  if (spot === "active") return attachFromDeck(ready, seat, id, count);
  const side = ready.players[seat];
  const uids = side.deck.filter((u) => ready.cardIdByUid[u] === id).slice(0, count);
  const taken = new Set(uids);
  const bench = side.bench.map((b, i) =>
    i === spot ? { ...b, energy: [...b.energy, ...uids] } : b,
  );
  return {
    ...ready,
    players: {
      ...ready.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !taken.has(u)), bench },
    },
  };
}

function body(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}

/** p1 declares attack `index`; a parked bench pick is answered onto p2's bench[0]. */
function swing(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  const first = mustApply(state, { type: "attack", seat: "p1", index });
  if (first.state.phase.kind !== "effect:choose") return first;
  const done = mustApply(first.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 0 } }] },
  });
  return { state: done.state, events: [...first.events, ...done.events] };
}
const recoils = (events: GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> =>
      e.type === "COUNTERS_PLACED" && e.source === "counterattack",
  );
const recoilTotal = (events: GameEvent[]) => recoils(events).reduce((sum, e) => sum + e.amount, 0);
const dealtTo = (events: GameEvent[], seat: Seat, uid: string) =>
  (
    events.find((e) => e.type === "DAMAGE_DEALT" && e.seat === seat && e.uid === uid) as
      | Extract<GameEvent, { type: "DAMAGE_DEALT" }>
      | undefined
  )?.dealt;
const topOf = (b: InPlayPokemon) => b.stack[b.stack.length - 1] as string;

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §1 — Pummeling Payback: 2 counters on the attacker per {M} Energy (the main hit)", () => {
  it("🛑 two {M} Energy → 40 on the Attacking Pokémon, labelled `counterattack`", () => {
    const state = energize(table([], ORTHWORM[0]), "p2", "active", METAL, 2);
    const { state: after, events } = swing(state, STRIKE);
    expect(recoilTotal(events)).toBe(40);
    expect(recoils(events)[0]?.seat).toBe("p1");
    expect(body(after, "p1").damage).toBe(40);
  });
  it("three {M} → 60; the reprint `sv07-162` is the same program → 40 on two", () => {
    expect(
      recoilTotal(swing(energize(table([], ORTHWORM[0]), "p2", "active", METAL, 3), STRIKE).events),
    ).toBe(60);
    expect(
      recoilTotal(swing(energize(table([], ORTHWORM[1]), "p2", "active", METAL, 2), STRIKE).events),
    ).toBe(40);
  });
  it("🛑 0 {M} Energy pays 0 — two Colorless-only Energy attached, no row at all", () => {
    const state = energize(table([], ORTHWORM[0]), "p2", "active", PLAIN_ENERGY, 2);
    const { state: after, events } = swing(state, STRIKE);
    expect(recoils(events)).toEqual([]);
    expect(body(after, "p1").damage).toBe(0);
  });
  it("🛑 counted by PROVISION (D118): a Luminous Energy providing {M} counts → 1 {M} + Luminous = 40", () => {
    let state = energize(table([], ORTHWORM[0]), "p2", "active", METAL, 1);
    state = energize(state, "p2", "active", LUMINOUS, 1);
    expect(recoilTotal(swing(state, STRIKE).events)).toBe(40);
  });
  it('🛑 "even if this Pokémon is Knocked Out": a lethal hit still pays 40 (read before the §8.1 sweep)', () => {
    let state = energize(table([], ORTHWORM[0], [WALL]), "p2", "active", METAL, 2);
    state = setDamage(state, "p2", 200); // 220 HP: the 50 is lethal
    const { state: after, events } = swing(state, STRIKE);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(recoilTotal(events)).toBe(40);
    expect(body(after, "p1").damage).toBe(40);
  });
  it("the fold answers the same number on the body (a zero diff at both read sites)", () => {
    const state = energize(table([], ORTHWORM[0]), "p2", "active", METAL, 2);
    expect(passivesOf(state, body(state, "p2")).damageAttacker).toBe(40);
  });
});

describe("D559 §2 — ⚠️ R-O1, a reachable DEVIATION: a BENCHED Orthworm ex does not retaliate", () => {
  it("🛑 a benched Orthworm ex with two {M} hit by a Bench SPREAD: no recoil (the print says it should)", () => {
    const state = energize(table([], WALL, [ORTHWORM[0]]), "p2", 0, METAL, 2);
    const { state: after, events } = swing(state, SWEEP);
    expect(dealtTo(events, "p2", topOf(body(state, "p2", 0)))).toBe(30); // it WAS damaged by an attack
    expect(recoils(events)).toEqual([]); // R-O1: the recoil read is Active-only
    expect(body(after, "p1").damage).toBe(0);
  });
  it("🛑 …and by a Bench SNIPE: no recoil either", () => {
    const state = energize(table([], WALL, [ORTHWORM[0]]), "p2", 0, METAL, 2);
    const { state: after, events } = swing(state, NEEDLE);
    expect(dealtTo(events, "p2", topOf(body(state, "p2", 0)))).toBe(40);
    expect(recoils(events)).toEqual([]);
    expect(body(after, "p1").damage).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §3 — Exploding Needles: 6 counters, ONLY when Knocked Out in the Active Spot (R-M1)", () => {
  it("🛑 an Active Maractus Knocked Out by an attack → 60 on the Attacking Pokémon", () => {
    const state = table([], MARACTUS[0], [WALL]);
    const { state: after, events } = swing(state, HEAVE);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(recoilTotal(events)).toBe(60);
    expect(body(after, "p1").damage).toBe(60);
  });
  it("the reprint `sv09-160` pays the same 60", () => {
    expect(recoilTotal(swing(table([], MARACTUS[1], [WALL]), HEAVE).events)).toBe(60);
  });
  it("🛑 an Active Maractus merely DAMAGED pays 0 (the Knock Out is the antecedent)", () => {
    const { state: after, events } = swing(table([], MARACTUS[0], [WALL]), STRIKE);
    expect(recoils(events)).toEqual([]);
    expect(body(after, "p1").damage).toBe(0);
  });
  it("🛑 a BENCHED Maractus Knocked Out by a spread pays 0 (`activeOnly`, read while it is still seated)", () => {
    let state = table([], WALL, [MARACTUS[0]]);
    state = setBenchDamage(state, "p2", 0, 90); // 110 HP: the spread's 30 is lethal
    const { state: after, events } = swing(state, SWEEP);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(recoils(events)).toEqual([]);
    expect(body(after, "p1").damage).toBe(0);
  });
  it("the fold: 60 in the Active Spot, 0 on the Bench — the zone is the gate", () => {
    const active = table([], MARACTUS[0]);
    expect(passivesOf(active, body(active, "p2")).damageAttackerOnKo).toBe(60);
    const benched = table([], WALL, [MARACTUS[0]]);
    expect(passivesOf(benched, body(benched, "p2", 0)).damageAttackerOnKo).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §4 — Gear Coating: {M}-Energy bodies take 20 less (after W/R), summed (R-GC)", () => {
  it("🛑 a defender with {M} attached, Klinklang benched → 50 − 20 = 30", () => {
    const state = energize(table([], WALL, [KLINKLANG[0]]), "p2", "active", METAL, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(30);
  });
  it("🛑 no {M} Energy on the damaged body → 50 (the beneficiary clause)", () => {
    const state = energize(table([], WALL, [KLINKLANG[0]]), "p2", "active", PLAIN_ENERGY, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(50);
  });
  it('🛑 TWO Klinklang STACK (no "doesn\'t stack" printed) → 50 − 40 = 10', () => {
    const state = energize(table([], WALL, [KLINKLANG[0], KLINKLANG[1]]), "p2", "active", METAL, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(10);
    expect(seatDamageReduction(state, body(state, "p2"), "all", "p1")).toBe(40);
  });
  it("by PROVISION: a Luminous Energy providing {M} qualifies → 30", () => {
    const state = energize(table([], WALL, [KLINKLANG[0]]), "p2", "active", LUMINOUS, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(30);
  });
  it("self-inclusive: an Active Klinklang with {M} attached shields itself → 30", () => {
    const state = energize(table([], KLINKLANG[0]), "p2", "active", METAL, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(30);
  });
  it("the SPREAD site: a benched {M} body takes 30 − 20 = 10; a benched non-{M} body takes 30", () => {
    let state = table([], WALL, [KLINKLANG[0], WALL, WALL]);
    state = energize(state, "p2", 1, METAL, 1);
    state = energize(state, "p2", 2, PLAIN_ENERGY, 1);
    const { events } = swing(state, SWEEP);
    expect(dealtTo(events, "p2", topOf(body(state, "p2", 1)))).toBe(10);
    expect(dealtTo(events, "p2", topOf(body(state, "p2", 2)))).toBe(30);
  });
  it("🆕 B19 (was ⚠️ D558 ⑶-bis INHERITED): an OWN-side spread onto a benched {M} body is NOT reduced → 30", () => {
    // *"…take 20 less damage from attacks from your opponent's Pokémon"*: the holder's own spread
    // is not one. Card revision B19 paid D558's debt in `seatDamageReduction`.
    let state = table([KLINKLANG[0], WALL], WALL);
    state = energize(state, "p1", 1, METAL, 1);
    const { events } = swing(state, BACKFIRE);
    expect(dealtTo(events, "p1", topOf(body(state, "p1", 1)))).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §5 — Rock Armor: 30 less (after W/R) while ANY Energy is attached (R-RA)", () => {
  it("🛑 one Energy attached → 50 − 30 = 20", () => {
    const state = energize(table([], REGIROCK), "p2", "active", PLAIN_ENERGY, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(20);
  });
  it("🛑 no Energy attached → 50", () => {
    const state = table([], REGIROCK);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(50);
  });
  it('any TYPE counts — a {M} Energy is "any Energy" too → 20', () => {
    const state = energize(table([], REGIROCK), "p2", "active", METAL, 1);
    expect(dealtTo(swing(state, STRIKE).events, "p2", topOf(body(state, "p2")))).toBe(20);
  });
  it("the SPREAD site: a benched Regirock with Energy takes 30 − 30 = 0", () => {
    const state = energize(table([], WALL, [REGIROCK]), "p2", 0, PLAIN_ENERGY, 1);
    expect(dealtTo(swing(state, SWEEP).events, "p2", topOf(body(state, "p2", 0)))).toBe(0);
  });
  it('🛑 R-RA: "from attacks" (no "opponent\'s") — an OWN-side spread is reduced too → 0; without Energy → 30', () => {
    const armed = energize(table([REGIROCK], WALL), "p1", 0, PLAIN_ENERGY, 1);
    expect(dealtTo(swing(armed, BACKFIRE).events, "p1", topOf(body(armed, "p1", 0)))).toBe(0);
    const bare = table([REGIROCK], WALL);
    expect(dealtTo(swing(bare, BACKFIRE).events, "p1", topOf(body(bare, "p1", 0)))).toBe(30);
  });
});
