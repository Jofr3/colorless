import type { Card } from "@colorless/schema";
import { redactedEffectPromptSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  deckOf,
  typedEnergy,
  must,
  mustApply as run,
  effectPrompt,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const WAKE = "sv06-063";
const AURORA_GAIN = "Heal 20 damage from this Pokémon.";
const UNDULATING =
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.";
const WALL = "d579w-wall";
const WEAK = "d579w-weak";
const RESIST = "d579w-resist";
const FRAIL = "d579w-frail";
const FILLER = "d579w-filler";
const W = "d579w-water";

const LOCAL_CARDS: Record<string, Card> = {
  [WAKE]: battler(WAKE, {
    name: "Walking Wake",
    hp: 130,
    types: ["Water"],
    weaknesses: [{ type: "Lightning", value: "×2" }],
    retreat: 1,
    attacks: [
      { cost: ["Water"], name: "Aurora Gain", effect: AURORA_GAIN, damage: 20 },
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Undulating Slice",
        effect: UNDULATING,
        damage: "20×",
      },
    ],
  }),
  [WALL]: battler(WALL, {
    name: "D579 Wall",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [WEAK]: battler(WEAK, {
    name: "D579 Weak",
    hp: 900,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [RESIST]: battler(RESIST, {
    name: "D579 Resist",
    hp: 900,
    types: ["Grass"],
    resistances: [{ type: "Water", value: "-30" }],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [FRAIL]: battler(FRAIL, {
    name: "D579 Frail",
    hp: 100,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D579 Filler",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [W]: typedEnergy(W, "Water"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [WAKE]: 2,
  [WALL]: 2,
  [WEAK]: 1,
  [RESIST]: 1,
  [FRAIL]: 1,
  [FILLER]: 25,
  [W]: 8,
  "fix-energy": 20,
});

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

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

function withSide(
  state: GameState,
  seat: Seat,
  patch: Partial<GameState["players"]["p1"]>,
): GameState {
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

interface Spot {
  id: string;
  energy?: readonly string[];
  damage?: number;
}

/** p1's turn: each seat's Active and Bench built from `Spot`s; every hand emptied into the deck. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p2: Spot;
  p2Bench?: readonly Spot[];
}): GameState {
  let state = opened(5791);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, {
      hand: [],
      active: null,
      bench: [],
      deck: [...side.deck, ...back],
    });
  }
  const take = (seat: Seat, id: string): string => {
    const pulled = pull(state, seat, id);
    state = pulled.state;
    return pulled.uid;
  };
  const build = (seat: Seat, spot: Spot): InPlayPokemon => {
    const top = take(seat, spot.id);
    const energy = (spot.energy ?? []).map((id) => take(seat, id));
    return { ...makeInPlay(top, 0), energy, damage: spot.damage ?? 0 };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) =>
      build(seat, s),
    );
    state = withSide(state, seat, { active, bench });
  }
  return state;
}

const ACTIVE_REF = { seat: "p1" as const, spot: { spot: "active" as const } };
const slice: GameAction = { type: "attack", seat: "p1", index: 1 };
const put = (take?: number): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref: ACTIVE_REF, ...(take === undefined ? {} : { take }) },
  }) as GameAction;
const decline: GameAction = {
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "pokemon" },
} as GameAction;

const wake = (damage = 0): Spot => ({ id: WAKE, energy: [W, W, W], damage });
const active = (state: GameState, seat: Seat): InPlayPokemon =>
  state.players[seat].active as InPlayPokemon;
const top = (body: InPlayPokemon): string => body.stack[body.stack.length - 1] ?? "";

function sliced(board: GameState, answer: GameAction): { state: GameState; events: GameEvent[] } {
  const parked = run(board, slice);
  return run(parked.state, answer);
}

describe("D579 Walking Wake §1 — the registry row, and the sentence stays REGISTRY-held", () => {
  it("index 1 is the two-op program, the damage op TOP-LEVEL; index 0 (Aurora Gain) keeps deriving", () => {
    expect(programFor(WAKE)?.attack?.[1]).toEqual([
      { op: "putCountersOnSelfChosen", upTo: 9 },
      { op: "damageDefender", per: 20, count: "placed" },
    ]);
    expect(programFor(WAKE)?.attack?.[0]).toBeUndefined();
    expect(deriveAttackEffect(AURORA_GAIN)).not.toBeNull();
  });

  it("no READER resolves the sentence — the census keeps it RAW and `builds()` serves it by id", () => {
    expect(resolvedByAnyReader(UNDULATING)).toBe(false);
    expect(deriveAttackEffect(UNDULATING)).toBeNull();
  });
});

describe('D579 Walking Wake §2 — ALWAYS PARKED over ONE candidate, `upTo: 9`, `takeVerb: "put"`', () => {
  it("the lone candidate does NOT auto-resolve the quantity: the prompt is the whole question", () => {
    const { state } = run(table({ p1: wake(), p2: { id: WALL } }), slice);
    expect(effectPrompt(state)).toEqual({
      kind: "choosePokemon",
      candidates: [ACTIVE_REF],
      upTo: 9,
      takeVerb: "put",
      note: "Put up to 9 damage counters on this Pokémon? This attack does damage for each one you put. Decline to put none.",
    });
    // Nothing is placed and nothing is dealt before the answer.
    expect(active(state, "p1").damage).toBe(0);
    expect(active(state, "p2").damage).toBe(0);
  });

  it('the WIRE carries the verb, and the wire SCHEMA keeps `"put"` (a strict literal would refuse the frame)', () => {
    const { state } = run(table({ p1: wake(), p2: { id: WALL } }), slice);
    const wire = redactGame(state, "p1").phase;
    if (wire.kind !== "effect:choose" || !("prompt" in wire))
      throw new Error("expected the answerer's prompt");
    expect(wire.prompt).toMatchObject({ kind: "choosePokemon", upTo: 9, takeVerb: "put" });
    expect(redactedEffectPromptSchema.parse(wire.prompt)).toMatchObject({ takeVerb: "put" });
    expect(redactedEffectPromptSchema.safeParse({ ...wire.prompt, takeVerb: "pour" }).success).toBe(
      false,
    );
  });

  it("a quantity over the printed ceiling is refused (BAD_EFFECT_CHOICE); 0 beside a body is refused too", () => {
    const { state } = run(table({ p1: wake(), p2: { id: WALL } }), slice);
    expect(rejected(state, put(10))).toBe("BAD_EFFECT_CHOICE");
    expect(rejected(state, put(0))).toBe("BAD_EFFECT_CHOICE");
  });
});

describe("D579 Walking Wake §3 — `take` counters on itself, 20 × that many to the Defender", () => {
  it("3 put: 30 on Walking Wake (a flat COUNTERS_PLACED, source self), 60 to the Defender — the printed 20× base NOT on top", () => {
    const board = table({ p1: wake(), p2: { id: WALL } });
    const { state, events } = sliced(board, put(3));
    expect(active(state, "p1").damage).toBe(30);
    expect(active(state, "p2").damage).toBe(60);
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toEqual([
      {
        type: "COUNTERS_PLACED",
        seat: "p1",
        uid: top(active(board, "p1")),
        amount: 30,
        source: "self",
      },
    ]);
  });

  it("an ABSENT `take` is the printed 9: 90 on itself, 180 dealt", () => {
    const { state } = sliced(table({ p1: wake(), p2: { id: WALL } }), put());
    expect(active(state, "p1").damage).toBe(90);
    expect(active(state, "p2").damage).toBe(180);
  });

  it("R-W2 — the DECLINE puts none and DEALS NONE (the 20× base does not leak through)", () => {
    const { state, events } = sliced(table({ p1: wake(), p2: { id: WALL } }), decline);
    expect(active(state, "p1").damage).toBe(0);
    expect(active(state, "p2").damage).toBe(0);
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toEqual([]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toEqual([]);
  });

  it("each count from 1 to 9 deals exactly 20 × the count — the slot holds ONE entry per counter", () => {
    for (const n of [1, 2, 5, 9]) {
      const { state } = sliced(table({ p1: wake(), p2: { id: WALL } }), put(n));
      expect([active(state, "p1").damage, active(state, "p2").damage], `take ${n}`).toEqual([
        10 * n,
        20 * n,
      ]);
    }
  });
});

describe("D579 Walking Wake §4 — R-W3: Weakness and Resistance apply ONCE to 20 × n", () => {
  it("a Water-weak Defender takes (20 × 3) × 2 = 120", () => {
    const { state } = sliced(table({ p1: wake(), p2: { id: WEAK } }), put(3));
    expect(active(state, "p2").damage).toBe(120);
  });

  it("a Water-resistant Defender takes 20 × 3 − 30 = 30, NOT 3 × (20 − 30) = 0 — one hit, one subtraction", () => {
    const { state } = sliced(table({ p1: wake(), p2: { id: RESIST } }), put(3));
    expect(active(state, "p2").damage).toBe(30);
  });
});

describe("D579 Walking Wake §5 — R-W1: Walking Wake may Knock ITSELF Out, and the hit still lands", () => {
  it("60 already on it + 9 put = 150 ≥ 130: it is Knocked Out AND the Defender takes 180", () => {
    const board = table({ p1: wake(60), p2: { id: WALL }, p1Bench: [{ id: FILLER }] });
    const { state, events } = sliced(board, put(9));
    const kos = events.filter((e) => e.type === "KNOCKED_OUT");
    expect(kos.map((e) => (e.type === "KNOCKED_OUT" ? [e.seat, e.uid] : []))).toEqual([
      ["p1", top(active(board, "p1"))],
    ]);
    expect(active(state, "p2").damage).toBe(180);
    // The opponent takes the Prize for the attacker's own Knock Out (§8.1's two-seat sweep).
    expect(state.phase.kind).toBe("ko:takePrizes");
    if (state.phase.kind === "ko:takePrizes") expect(state.phase.seat).toBe("p2");
  });

  it("BOTH Knock Outs are swept by the one epilogue: the 100-HP Defender falls to the same 9-counter hit", () => {
    const board = table({
      p1: wake(60),
      p2: { id: FRAIL },
      p1Bench: [{ id: FILLER }],
      p2Bench: [{ id: FILLER }],
    });
    const { events } = sliced(board, put(9));
    const kos = events
      .filter((e) => e.type === "KNOCKED_OUT")
      .map((e) => (e.type === "KNOCKED_OUT" ? e.seat : ""));
    expect(kos.sort()).toEqual(["p1", "p2"]);
  });
});
