import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { returnsAfterAttackDiscard } from "./continuous";
import type { GameEvent } from "./events";
import { advance } from "./flow";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, specialEnergy } from "./testFixtures";
import { type PendingStage, makeInPlay } from "./types";

// ── 🆕🆕🆕 D577 — BOOMERANG ENERGY `sv06-166`: DISCARDED BY ITS HOLDER'S OWN ATTACK, BACK AFTER ATTACKING ──
//
// *"As long as this card is attached to a Pokémon, it provides {C} Energy. If this card is discarded by an
// effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile
// to that Pokémon after attacking."*
//
// R-BE1 (only the ATTACKER's own Boomerang, only to the DISCARD PILE, only by the attack's program), R-BE2
// (re-attached at the `attackEpilogue`, found by uid, nothing if the attacker or the card is gone), R-BE3
// (each Boomerang returns), R-BE4 (a COPIED attack's discard returns to the copier — the record belongs to
// the epilogue that runs), R-BE5 (the one writer is `discardEnergyApply`) — decisions.md D577.

const BOOMERANG = "sv06-166";
const DISCARDER = "d577b-discarder";
const DOUBLE_DISCARDER = "d577b-double-discarder";
const TO_HAND = "d577b-to-hand";
const STRIPPER = "d577b-stripper";
const COPIER = "d577b-copier";
const PLAIN = "d577b-plain";
const FILLER = "d577b-filler";

const LOCAL_CARDS: Record<string, Card> = {
  [BOOMERANG]: specialEnergy(
    BOOMERANG,
    "Boomerang Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy. If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile to that Pokémon after attacking.",
  ),
  [DISCARDER]: battler(DISCARDER, {
    name: "D577 Discarder",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Fling", damage: 30, effect: "Discard an Energy from this Pokémon." }],
  }),
  [DOUBLE_DISCARDER]: battler(DOUBLE_DISCARDER, {
    name: "D577 Double Discarder",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Double Fling", damage: 30, effect: "Discard 2 Energy from this Pokémon." }],
  }),
  [TO_HAND]: battler(TO_HAND, {
    name: "D577 To Hand",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Recall", damage: 10, effect: "Put an Energy attached to this Pokémon into your hand." }],
  }),
  [STRIPPER]: battler(STRIPPER, {
    name: "D577 Stripper",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Strip", damage: 10, effect: "Discard an Energy from your opponent's Active Pokémon." }],
  }),
  [COPIER]: battler(COPIER, {
    name: "D577 Copier",
    hp: 900,
    types: ["Colorless"],
    attacks: [
      {
        cost: [],
        name: "Foul Play",
        effect: "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
      },
    ],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "D577 Plain",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D577 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [BOOMERANG]: 4,
  [DISCARDER]: 2,
  [DOUBLE_DISCARDER]: 1,
  [TO_HAND]: 1,
  [STRIPPER]: 1,
  [COPIER]: 1,
  [PLAIN]: 1,
  [FILLER]: 30,
  "fix-energy": 19,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: withSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: withSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

/** p1's turn 2: p1 `active` carrying `energy` (ids), plus `bench`; p2 `oppActive` carrying `oppEnergy`. */
function table(opts: {
  active: string;
  energy?: readonly string[];
  bench?: readonly string[];
  oppActive?: string;
  oppEnergy?: readonly string[];
}): { state: GameState; energy: string[]; oppEnergy: string[] } {
  let state = opened(5773);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const place = (seat: Seat, id: string, energyIds: readonly string[]): string[] => {
    let pulled = pull(state, seat, id);
    state = pulled.state;
    const body = makeInPlay(pulled.uid, 0);
    const energy: string[] = [];
    for (const e of energyIds) {
      pulled = pull(state, seat, e);
      state = pulled.state;
      energy.push(pulled.uid);
    }
    state = withSide(state, seat, { active: { ...body, energy } });
    return energy;
  };
  const energy = place("p1", opts.active, opts.energy ?? []);
  const oppEnergy = place("p2", opts.oppActive ?? FILLER, opts.oppEnergy ?? []);
  for (const id of opts.bench ?? []) {
    const pulled = pull(state, "p1", id);
    state = withSide(pulled.state, "p1", { bench: [...pulled.state.players.p1.bench, makeInPlay(pulled.uid, 0)] });
  }
  return { state, energy, oppEnergy };
}

describe("D577 Boomerang §1 — the registry row", () => {
  it("provides {C} and carries the one flag", () => {
    expect(programFor(BOOMERANG)).toEqual({ energy: { provides: ["Colorless"], returnAfterAttackDiscard: true } });
  });

  it("returnsAfterAttackDiscard reads the card, not the zone", () => {
    const { state, energy } = table({ active: DISCARDER, energy: [BOOMERANG, "fix-energy"] });
    // 🆕🆕🆕 D604 — the predicate takes the holder too (Nitro Fire's {R} gate); Boomerang names no type.
    const holder = state.players.p1.active;
    if (holder === null) throw new Error("no Active");
    expect(energy.map((uid) => returnsAfterAttackDiscard(state, uid, holder))).toEqual([true, false]);
  });
});

describe("D577 Boomerang §2 — its holder's attack discards it: it comes back after attacking (R-BE1/R-BE2)", () => {
  it("the only Energy, discarded by 'Discard an Energy from this Pokémon.' — re-attached before the turn ends", () => {
    const { state, energy } = table({ active: DISCARDER, energy: [BOOMERANG] });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p1.active?.energy).toEqual(energy);
    expect(attacked.state.players.p1.discard).not.toContain(energy[0]);
    const kinds = attacked.events.map((e) => e.type);
    expect(kinds).toContain("ENERGY_DISCARDED");
    const attach = attacked.events.findIndex((e) => e.type === "ENERGY_ATTACHED");
    expect(attach).toBeGreaterThan(kinds.indexOf("ENERGY_DISCARDED"));
    expect(attach).toBeLessThan(kinds.indexOf("TURN_ENDED"));
    expect(attacked.events[attach]).toEqual({
      type: "ENERGY_ATTACHED",
      seat: "p1",
      uid: energy[0],
      target: { spot: "active" },
    });
  });

  it("two Boomerangs discarded by 'Discard 2 Energy' both return (R-BE3); a plain Energy discarded with them stays", () => {
    const { state, energy } = table({ active: DOUBLE_DISCARDER, energy: [BOOMERANG, BOOMERANG] });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p1.active?.energy).toEqual(energy);
  });

  it("a plain Energy discarded beside a Boomerang stays in the discard pile", () => {
    const { state, energy } = table({ active: DOUBLE_DISCARDER, energy: [BOOMERANG, "fix-energy"] });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p1.active?.energy).toEqual([energy[0]]);
    expect(attacked.state.players.p1.discard).toContain(energy[1]);
  });

  it("put into the HAND is not 'discarded': it stays in the hand", () => {
    const { state, energy } = table({ active: TO_HAND, energy: [BOOMERANG] });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p1.active?.energy).toEqual([]);
    expect(attacked.state.players.p1.hand).toContain(energy[0]);
  });

  it("discarded by the OPPONENT's attack: not 'used by the Pokémon this card is attached to' — it stays", () => {
    const { state, oppEnergy } = table({ active: STRIPPER, oppActive: PLAIN, oppEnergy: [BOOMERANG] });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.state.players.p2.active?.energy).toEqual([]);
    expect(attacked.state.players.p2.discard).toContain(oppEnergy[0]);
  });

  it("a COPIED attack's discard returns to the COPIER — the record rides the epilogue that runs (R-BE4)", () => {
    const { state, energy } = table({ active: COPIER, energy: [BOOMERANG], oppActive: DISCARDER });
    let next = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (next.phase.kind === "effect:choose") {
      next = run(next, { type: "resolveEffect", seat: "p1", choice: { kind: "attack", index: 0 } }).state;
    }
    expect(next.players.p1.active?.energy).toEqual(energy);
    expect(next.players.p1.discard).not.toContain(energy[0]);
  });
});

describe("D577 Boomerang §3 — the epilogue's re-attach, driven at the stage (R-BE2)", () => {
  /** p1's attacker `uid` somewhere on the board, a Boomerang `b` in p1's discard, and the epilogue queued. */
  function epilogueBoard(where: "active" | "bench" | "gone", damage = 0): { state: GameState; b: string; uid: string } {
    const { state: base } = table({ active: PLAIN, bench: [FILLER] });
    let state = base;
    const pulled = pull(state, "p1", BOOMERANG);
    state = withSide(pulled.state, "p1", { discard: [...pulled.state.players.p1.discard, pulled.uid] });
    const active = state.players.p1.active;
    const benched = state.players.p1.bench[0];
    if (active === null || benched === undefined) throw new Error("no bodies");
    let uid = active.stack[0] ?? "";
    if (where === "bench") {
      // The attacker self-switched: it is now Benched, the filler Active.
      state = withSide(state, "p1", { active: benched, bench: [active] });
    } else if (where === "gone") {
      uid = "p1#nowhere";
    }
    if (damage > 0 && state.players.p1.active !== null) {
      state = withSide(state, "p1", { active: { ...state.players.p1.active, damage } });
    }
    const epilogue: PendingStage = { kind: "attackEpilogue", seat: "p1", uid, attack: "Tap", boomerang: [pulled.uid] };
    return { state: { ...state, pending: [epilogue] }, b: pulled.uid, uid };
  }

  it("the attacker SELF-SWITCHED to the Bench: found by uid, the Boomerang lands on the Benched attacker", () => {
    const { state, b } = epilogueBoard("bench");
    const events: GameEvent[] = [];
    const result = advance(state, events);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.players.p1.bench[0]?.energy).toEqual([b]);
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(events.find((e) => e.type === "ENERGY_ATTACHED")).toEqual({
      type: "ENERGY_ATTACHED",
      seat: "p1",
      uid: b,
      target: { spot: "bench", index: 0 },
    });
  });

  it("the attacker LEFT PLAY: nothing attaches, the card stays in the discard pile", () => {
    const { state, b } = epilogueBoard("gone");
    const result = advance(state, []);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.players.p1.discard).toContain(b);
  });

  it("the card LEFT THE DISCARD PILE: nothing attaches", () => {
    const { state: board, b } = epilogueBoard("active");
    const state = withSide(board, "p1", {
      discard: board.players.p1.discard.filter((u) => u !== b),
      hand: [...board.players.p1.hand, b],
    });
    const result = advance(state, []);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(result.state.players.p1.hand).toContain(b);
  });

  it("a lethal attacker gets it back FIRST, then the sweep Knocks it Out with the Boomerang under it", () => {
    const { state, b } = epilogueBoard("active", 900);
    const events: GameEvent[] = [];
    const result = advance(state, events);
    if (!result.ok) throw new Error(result.error.message);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("ENERGY_ATTACHED")).toBeLessThan(kinds.indexOf("KNOCKED_OUT"));
    expect(result.state.players.p1.discard).toContain(b);
  });
});

describe("D577 Boomerang §4 — only an ATTACK's program records it (R-BE1, the invokedBy gate)", () => {
  it("the same discard run as a NON-attack program (no `invokedBy`) records nothing on a queued epilogue", () => {
    const { state: board, energy } = table({ active: DISCARDER, energy: [BOOMERANG] });
    const uid = board.players.p1.active?.stack[0] ?? "";
    const epilogue: PendingStage = { kind: "attackEpilogue", seat: "p1", uid, attack: "Fling" };
    const state = { ...board, pending: [epilogue] };
    const op = { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } } as const;
    const asAbility = runProgram(state, [op], { seat: "p1", sourceUid: uid }, []);
    expect(asAbility.state.pending).toEqual([epilogue]);
    expect(asAbility.state.players.p1.discard).toContain(energy[0]);
    const asAttack = runProgram(state, [op], { seat: "p1", sourceUid: uid, invokedBy: "attack" }, []);
    expect(asAttack.state.pending).toEqual([{ ...epilogue, boomerang: energy }]);
  });

  it("the attack's discard off ANOTHER own body (a Benched one) records nothing — 'the Pokémon this card is attached to' is the attacker", () => {
    const { state: board } = table({ active: DISCARDER, bench: [FILLER] });
    const pulled = pull(board, "p1", BOOMERANG);
    const benched = pulled.state.players.p1.bench[0];
    if (benched === undefined) throw new Error("no bench");
    const state0 = withSide(pulled.state, "p1", { bench: [{ ...benched, energy: [pulled.uid] }] });
    const uid = state0.players.p1.active?.stack[0] ?? "";
    const epilogue: PendingStage = { kind: "attackEpilogue", seat: "p1", uid, attack: "Fling" };
    const state = { ...state0, pending: [epilogue] };
    const sweep = { op: "discardEnergy", from: "yours", filter: { kind: "anyEnergy" }, count: "all" } as const;
    const ran = runProgram(state, [sweep], { seat: "p1", sourceUid: uid, invokedBy: "attack" }, []);
    expect(ran.kind).toBe("done");
    expect(ran.state.players.p1.discard).toContain(pulled.uid);
    expect(ran.state.pending).toEqual([epilogue]);
  });
});
