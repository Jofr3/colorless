import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { boostedAttackDamage, everyAttackBoostOf } from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck } from "./testFixtures";
import { topUid } from "./cards";
import { type InPlayPokemon, evolveOnto } from "./types";

// ── 🆕🆕🆕 D563 — FERALIGATR "TORRENTIAL HEART" ──
//
//   Feraligatr  svp-089 / sv05-041  Stage 2  "Torrential Heart" — "Once during your turn, you
//   may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by
//   this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying
//   Weakness and Resistance)."
//
// Two riders on two shipped ops: `damageSelf { on: "source", source: "ability" }` places the
// counters on THIS body wherever it sits, and `boostAttack { attack: null, holder: "source",
// thisTurn: true }` writes the D546 all-attacks record on THIS body, stamped for THIS turn.
// Driven on the REAL ids, on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Text,
// stage and legality off tcgdex (the audit's card JSON), 2026-09-28. Readings R-TH (UNRULED)
// and the shared slot: docs/decisions.md D563.

const FERALIGATR = "svp-089";
const FERALIGATR_REPRINT = "sv05-041";
const FLUTTER_MANE = "sv05-078";
const WALL = "d563f-wall";
const PIVOT = "d563f-pivot";
const SNIPER = "d563f-sniper";
const WATER = "fix-water-energy";

const TORRENTIAL_HEART =
  "Once during your turn, you may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";

function feraligatr(id: string): Card {
  return battler(id, {
    name: "Feraligatr",
    stage: "Stage2",
    evolveFrom: "Croconaw",
    types: ["Water"],
    hp: 180,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Torrential Heart", effect: TORRENTIAL_HEART }],
    attacks: [
      {
        cost: ["Water", "Water"],
        name: "Giant Wave",
        damage: 160,
        effect: "During your next turn, this Pokémon can't use Giant Wave.",
      },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [FERALIGATR]: feraligatr(FERALIGATR),
  [FERALIGATR_REPRINT]: feraligatr(FERALIGATR_REPRINT),
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {
    name: "Flutter Mane",
    types: ["Psychic"],
    hp: 90,
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
  }),
  // Weak to {W} ×2, so "before applying Weakness" is observable: (160 + 120) × 2.
  [WALL]: battler(WALL, {
    name: "D563 Wall",
    types: ["Colorless"],
    hp: 900,
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [PIVOT]: battler(PIVOT, { name: "D563 Pivot", types: ["Colorless"], hp: 100, retreat: 0 }),
  [SNIPER]: battler(SNIPER, {
    name: "D563 Sniper",
    types: ["Colorless"],
    hp: 100,
    attacks: [
      {
        cost: [],
        name: "Arrow",
        effect:
          "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [FERALIGATR]: 2,
  [FERALIGATR_REPRINT]: 2,
  [FLUTTER_MANE]: 1,
  [WALL]: 20,
  [PIVOT]: 4,
  [SNIPER]: 1,
  [WATER]: 20,
  "fix-energy": 10,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — `count` {W} from `seat`'s deck onto the body at `spot`. */
function water(state: GameState, seat: Seat, spot: "active" | number, count: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === WATER).slice(0, count);
  if (uids.length < count) throw new Error("not enough Water");
  const taken = new Set(uids);
  const feed = (p: InPlayPokemon): InPlayPokemon => ({ ...p, energy: [...p.energy, ...uids] });
  const active = side.active;
  if (spot === "active" && active === null) throw new Error("no Active");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => !taken.has(u)),
        active: spot === "active" && active !== null ? feed(active) : active,
        bench: side.bench.map((p, i) => (i === spot ? feed(p) : p)),
      },
    },
  };
}

/** p1's turn 2: `active` (with `energy` {W}) against the Wall (or `defender`), p1's Bench
    EXACTLY `bench` (each benched Feraligatr fed `benchEnergy` {W}), p2's Bench empty. */
function table(opts: {
  active?: string;
  energy?: number;
  bench?: string[];
  benchEnergy?: number;
  defender?: string;
  damage?: number;
  seed?: number;
}): GameState {
  let state = opened(opts.seed ?? 5631);
  const active = opts.active ?? FERALIGATR;
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  const defender = opts.defender ?? WALL;
  state = setActiveFromDeck(ensureInDeck(state, "p2", defender), "p2", defender);
  state = clearBench(clearBench(state, "p1"), "p2");
  if ((opts.energy ?? 2) > 0) state = water(state, "p1", "active", opts.energy ?? 2);
  for (const [i, id] of (opts.bench ?? []).entries()) {
    state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
    if (id !== PIVOT && (opts.benchEnergy ?? 0) > 0) state = water(state, "p1", i, opts.benchEnergy ?? 0);
  }
  if (opts.damage !== undefined) {
    const a = state.players.p1.active;
    if (a === null) throw new Error("no Active");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: { ...a, damage: opts.damage } } } };
  }
  return state;
}

function body(p: InPlayPokemon | null | undefined): InPlayPokemon {
  if (p === null || p === undefined) throw new Error("no body");
  return p;
}

function find<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const useActive = (state: GameState) =>
  run(state, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Torrential Heart" });
const useBench = (state: GameState, index: number) =>
  run(state, { type: "useAbility", seat: "p1", target: { spot: "bench", index }, abilityName: "Torrential Heart" });
const attack = (state: GameState, index = 0) => run(state, { type: "attack", seat: "p1", index });

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the row.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the registry row: one activated Ability, two ops, two riders", () => {
  it("both printings share ONE object: once per turn, usable from the Bench, no `attack` key", () => {
    expect(engineVersion).toBe("0.544.0");
    const row = programFor(FERALIGATR);
    expect(programFor(FERALIGATR_REPRINT)).toBe(row);
    expect(Object.keys(row ?? {})).toEqual(["abilities"]);
    expect(row?.abilities).toEqual([
      {
        name: "Torrential Heart",
        oncePerTurn: true,
        activeOnly: false,
        program: [
          { op: "damageSelf", amount: 50, on: "source", source: "ability" },
          { op: "boostAttack", attack: null, amount: 120, holder: "source", thisTurn: true },
        ],
      },
    ]);
  });

  it("the fixture carries the printed Ability VERBATIM", () => {
    expect(POOL[FERALIGATR]?.abilities?.[0]?.effect).toBe(TORRENTIAL_HEART);
    expect(POOL[FERALIGATR]?.attacks?.map((a) => a.name)).toEqual(["Giant Wave"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — used on the Active.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — used on the ACTIVE: 5 counters on itself, +120 this turn before W/R", () => {
  it("places 50 on THIS body, filed as an ABILITY placement", () => {
    const start = table({});
    const { state, events } = useActive(start);
    const placed = find(events, "COUNTERS_PLACED");
    expect(placed).toMatchObject({ seat: "p1", amount: 50, source: "ability" });
    expect(placed?.uid).toBe(topUid(body(start.players.p1.active)));
    expect(body(state.players.p1.active).damage).toBe(50);
    expect(body(state.players.p2.active).damage).toBe(0);
  });

  it("🛑 writes an all-attacks record stamped THIS turn (not `turn + 2`)", () => {
    const start = table({});
    const { state } = useActive(start);
    expect(body(state.players.p1.active).boostedAttack).toEqual({
      turn: start.turn,
      attackIndex: null,
      amount: 120,
    });
    expect(everyAttackBoostOf(state, body(state.players.p1.active))).toBe(120);
    expect(boostedAttackDamage(state, body(state.players.p1.active), 0)).toBe(120);
  });

  it("🛑 the main hit pays +120 BEFORE Weakness: (160 + 120) × 2 = 560", () => {
    const { state } = useActive(table({}));
    const { events } = attack(state);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 160, bonus: 120, dealt: 560 });
  });

  it("the control: without the Ability the same hit is 160 × 2 = 320 and no counters land", () => {
    const { events } = attack(table({}));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 160, dealt: 320 });
    expect(find(events, "DAMAGE_DEALT")?.bonus).toBeUndefined();
  });

  it("the row says THIS turn, under both seats, and never 'next turn' or 'null'", () => {
    const { state, events } = useActive(table({}));
    const rows = render(events, state);
    expect(rows).toContainEqual({ who: "p1", text: "Feraligatr's attacks do 120 more damage this turn" });
    expect(rows.some((r) => r.text.includes("next turn") || r.text.includes("null"))).toBe(false);
    const boosted = find(events, "ATTACK_BOOSTED");
    expect(boosted).toMatchObject({ attack: null, amount: 120, thisTurn: true });
    expect(render(boosted === undefined ? [] : [{ ...boosted, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "Feraligatr's attacks do 120 more damage this turn" },
    ]);
  });

  it("a NAMED this-turn row (no printing writes one) would name its attack and still say 'this turn'", () => {
    const { state, events } = useActive(table({}));
    const boosted = find(events, "ATTACK_BOOSTED");
    if (boosted === undefined) throw new Error("no row");
    expect(render([{ ...boosted, attack: "Giant Wave" }], state)).toEqual([
      { who: "p1", text: "Feraligatr's Giant Wave does 120 more damage this turn" },
    ]);
  });

  it("the D546 next-turn install still says 'next turn' — the branch keys on `thisTurn` alone", () => {
    const { state, events } = useActive(table({}));
    const boosted = find(events, "ATTACK_BOOSTED");
    if (boosted === undefined) throw new Error("no row");
    const { thisTurn: _dropped, ...nextTurn } = boosted;
    expect(render([nextTurn], state)).toEqual([
      { who: "p1", text: "Feraligatr's attacks do 120 more damage next turn" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — used from the Bench.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — used from the BENCH: the counters and the record land on the BENCHED body", () => {
  it("places on the benched Feraligatr and writes its record, leaving the Active untouched", () => {
    const start = table({ active: PIVOT, energy: 0, bench: [FERALIGATR], benchEnergy: 2 });
    const { state, events } = useBench(start, 0);
    const benched = body(state.players.p1.bench[0]);
    expect(benched.damage).toBe(50);
    expect(benched.boostedAttack).toEqual({ turn: start.turn, attackIndex: null, amount: 120 });
    expect(body(state.players.p1.active).damage).toBe(0);
    expect(body(state.players.p1.active).boostedAttack).toBeNull();
    expect(find(events, "ATTACK_BOOSTED")?.uid).toBe(topUid(benched));
    expect(find(events, "COUNTERS_PLACED")?.uid).toBe(topUid(benched));
  });

  it("🛑 promoted by a RETREAT the same turn, it still pays: Bench → Active does not clear", () => {
    const start = table({ active: PIVOT, energy: 0, bench: [FERALIGATR], benchEnergy: 2 });
    let state = useBench(start, 0).state;
    state = run(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }).state;
    expect(body(state.players.p1.active).boostedAttack).toEqual({
      turn: start.turn,
      attackIndex: null,
      amount: 120,
    });
    expect(find(attack(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 160, bonus: 120, dealt: 560 });
  });

  it("a Feraligatr at bench index 1 is found BY UID: its neighbour at index 0 is untouched", () => {
    const start = table({ active: PIVOT, energy: 0, bench: [PIVOT, FERALIGATR], benchEnergy: 2 });
    const { state } = useBench(start, 1);
    expect(body(state.players.p1.bench[1]).damage).toBe(50);
    expect(body(state.players.p1.bench[1]).boostedAttack?.amount).toBe(120);
    expect(body(state.players.p1.bench[0]).damage).toBe(0);
    expect(body(state.players.p1.bench[0]).boostedAttack).toBeNull();
  });

  it("the record is on the BODY and not the seat: the Active beside it attacks unboosted", () => {
    const start = table({ active: SNIPER, energy: 0, bench: [FERALIGATR], benchEnergy: 2 });
    const { state } = useBench(start, 0);
    expect(everyAttackBoostOf(state, body(state.players.p1.active))).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the window: shed, expiry, lock.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — R-TH: the record SHEDS when switched out, EXPIRES next turn, and ignores a later lock", () => {
  it("🛑 R-TH — used on the Active and RETREATED to the Bench: the record is shed (§10)", () => {
    const start = table({ bench: [PIVOT] });
    let state = useActive(start).state;
    const gatorUid = topUid(body(state.players.p1.active));
    const pay = body(state.players.p1.active).energy.slice(0, 2);
    state = run(state, { type: "retreat", seat: "p1", discardEnergy: pay, promoteBenchIndex: 0 }).state;
    const benched = state.players.p1.bench.find((p) => topUid(p) === gatorUid);
    expect(body(benched).boostedAttack).toBeNull();
    expect(everyAttackBoostOf(state, body(benched))).toBe(0);
    // The counters, being damage, stay.
    expect(body(benched).damage).toBe(50);
  });

  it("🛑 it EXPIRES: on the holder's next turn the same body attacks for the printed 160", () => {
    let state = useActive(table({})).state;
    state = run(state, { type: "endTurn", seat: "p1" }).state;
    state = run(state, { type: "endTurn", seat: "p2" }).state;
    expect(boostedAttackDamage(state, body(state.players.p1.active), 0)).toBe(0);
    expect(find(attack(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 160, dealt: 320 });
  });

  it("🛑 LOCK-IMMUNE ONCE INSTALLED: a Flutter Mane Active after the use does not stop the +120", () => {
    let state = useActive(table({})).state;
    state = clearBench(setActiveFromDeck(ensureInDeck(state, "p2", FLUTTER_MANE), "p2", FLUTTER_MANE), "p2");
    expect(find(attack(state).events, "DAMAGE_DEALT")).toMatchObject({ base: 160, bonus: 120 });
  });

  it("…but a lock BEFORE the use refuses the Ability itself (the control)", () => {
    const state = table({ defender: FLUTTER_MANE });
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Torrential Heart",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_DISABLED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — once per turn, per body; the lethal self-placement.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — once per turn PER BODY, and a lethal self-placement is a mid-turn KO", () => {
  it("a second use by the SAME body is refused ABILITY_ALREADY_USED", () => {
    const state = useActive(table({})).state;
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Torrential Heart",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("a SECOND Feraligatr uses its own on the same turn (the scope is the body)", () => {
    let state = useActive(table({ bench: [FERALIGATR_REPRINT], benchEnergy: 2 })).state;
    state = useBench(state, 0).state;
    expect(body(state.players.p1.active).damage).toBe(50);
    expect(body(state.players.p1.bench[0]).damage).toBe(50);
    expect(body(state.players.p1.bench[0]).boostedAttack?.amount).toBe(120);
  });

  it("🛑 a LETHAL self-placement is swept mid-turn and the Prize goes to the OPPONENT", () => {
    const start = table({ damage: 140, bench: [PIVOT] });
    const p2Prizes = start.players.p2.prizes.length;
    const p1Prizes = start.players.p1.prizes.length;
    const gatorUid = topUid(body(start.players.p1.active));
    const { state, events } = useActive(start);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    expect(state.players.p1.discard).toContain(gatorUid);
    // The OPPONENT is owed the Prize: p1's pile is untouched, p2's is taken or pending.
    expect(state.players.p1.prizes.length).toBe(p1Prizes);
    const p2Took =
      state.players.p2.prizes.length < p2Prizes ||
      (state.phase.kind === "ko:takePrizes" && state.phase.seat === "p2");
    expect(p2Took).toBe(true);
  });

  it("a non-lethal total leaves the body in play (the control, one counter short)", () => {
    const { state, events } = useActive(table({ damage: 120 }));
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(false);
    expect(body(state.players.p1.active).damage).toBe(170);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the two riders, driven through the interpreter directly.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the riders: `on`/`holder: \"source\"` find the body by uid; absent is the shipped reading", () => {
  function runOn(state: GameState, program: readonly EffectOp[], sourceUid?: string) {
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      program,
      { seat: "p1", ...(sourceUid === undefined ? {} : { sourceUid }) },
      events,
    );
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    return { state: result.state, events };
  }

  it("`damageSelf` WITHOUT `on` still places on the seat's Active, whatever the source", () => {
    const start = table({ active: PIVOT, energy: 0, bench: [FERALIGATR] });
    const benchedUid = topUid(body(start.players.p1.bench[0]));
    const { state } = runOn(start, [{ op: "damageSelf", amount: 50, source: "ability" }], benchedUid);
    expect(body(state.players.p1.active).damage).toBe(50);
    expect(body(state.players.p1.bench[0]).damage).toBe(0);
  });

  it("`boostAttack` WITHOUT `holder`/`thisTurn` still writes the Active, stamped `turn + 2`", () => {
    const start = table({ active: PIVOT, energy: 0, bench: [FERALIGATR] });
    const benchedUid = topUid(body(start.players.p1.bench[0]));
    const { state, events } = runOn(start, [{ op: "boostAttack", attack: null, amount: 120 }], benchedUid);
    expect(body(state.players.p1.active).boostedAttack).toEqual({
      turn: start.turn + 2,
      attackIndex: null,
      amount: 120,
    });
    expect(body(state.players.p1.bench[0]).boostedAttack).toBeNull();
    expect(find(events, "ATTACK_BOOSTED")?.thisTurn).toBeUndefined();
  });

  it("a source that has LEFT the board: both riders whiff silently (no row, no write)", () => {
    const start = table({});
    const { state, events } = runOn(start, programFor(FERALIGATR)?.abilities?.[0]?.program ?? [], "gone");
    expect(events).toEqual([]);
    expect(state).toEqual(start);
  });

  it("a program with NO source uid (a Trainer-shaped ctx) whiffs on both riders too", () => {
    const start = table({});
    const { events } = runOn(start, programFor(FERALIGATR)?.abilities?.[0]?.program ?? []);
    expect(events).toEqual([]);
  });

  it("`holder: \"source\"` on the ACTIVE source writes the Active slot (not a Bench slot)", () => {
    const start = table({ bench: [PIVOT] });
    const uid = topUid(body(start.players.p1.active));
    const { state } = runOn(start, [{ op: "boostAttack", attack: null, amount: 120, holder: "source" }], uid);
    expect(body(state.players.p1.active).boostedAttack).toEqual({
      turn: start.turn + 2,
      attackIndex: null,
      amount: 120,
    });
    expect(body(state.players.p1.bench[0]).boostedAttack).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the other reader, and the shared slot.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `snipeActive` pays the record through `everyAttackBoostOf`; the slot is one per body", () => {
  it("🛑 a this-turn record on an attacker whose snipe lands on the ACTIVE pays +120 (`snipeActive`)", () => {
    // TEST SURGERY: the record Torrential Heart writes, moved onto a sniper's body — the
    // record shape is the ONLY input `snipeActive`'s fold reads (`everyAttackBoostOf`).
    const installed = useActive(table({})).state;
    const record = body(installed.players.p1.active).boostedAttack;
    let state = benchFromDeck(table({ active: SNIPER, energy: 0 }), "p2", WALL);
    const sniper = body(state.players.p1.active);
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: { ...sniper, boostedAttack: record } } } };
    const parked = attack(state).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const done = run(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ base: 30, bonus: 120 });
  });

  it("the SHARED SLOT: a use over a live NAMED next-turn record replaces it (per-address, D155)", () => {
    let state = table({});
    const gator = body(state.players.p1.active);
    const named = { turn: state.turn, attackIndex: 0, amount: 80 };
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: { ...gator, boostedAttack: named } } } };
    state = useActive(state).state;
    expect(body(state.players.p1.active).boostedAttack).toEqual({
      turn: state.turn,
      attackIndex: null,
      amount: 120,
    });
  });

  it("…and that board is UNREACHABLE: Feraligatr's own attack installs no boost, and evolving sheds", () => {
    // Giant Wave's only rider is a self-lock, so no op of the card's own writes the slot.
    const { state } = attack(table({}));
    expect(state.players.p1.active?.boostedAttack ?? null).toBeNull();
    // A prior stage's named record does not survive the evolution INTO Feraligatr: the §10
    // placement (`evolveOnto`) writes `boostedAttack: null` on the evolved body.
    const board = table({});
    const holder = body(board.players.p1.active);
    const carrying = { ...holder, boostedAttack: { turn: board.turn, attackIndex: 0, amount: 80 } };
    const { evolved } = evolveOnto(board, "p1", { spot: "active" }, -1, carrying, topUid(holder) ?? "", "evo", []);
    expect(evolved.boostedAttack).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — MATCH_RECORD_VERSION holds at 35.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `MATCH_RECORD_VERSION` holds at 35: the record Torrential Heart writes is D546's shape", () => {
  it("🛑 the persisted bytes are D546's three keys — only the stamp's VALUE is this turn's", () => {
    const start = table({});
    const { state } = useActive(start);
    expect(JSON.stringify(body(state.players.p1.active).boostedAttack)).toBe(
      `{"turn":${String(start.turn)},"attackIndex":null,"amount":120}`,
    );
  });

  it("a record saved MID-TURN (after the use, before the attack) revives through JSON and still pays", () => {
    const { state } = useActive(table({}));
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(find(attack(revived).events, "DAMAGE_DEALT")).toMatchObject({ bonus: 120, dealt: 560 });
  });

  it("⚠️ ROLLBACK — the 0.446 readers are unchanged: they pay a this-turn stamp as they pay any live one", () => {
    // `boostedAttackDamage` / `everyAttackBoostOf` compare `turn === state.turn` and were not
    // edited by D563, so a 0.446 deploy resuming this record mid-turn pays the same +120; it
    // cannot WRITE one (no Torrential Heart row), and the counters are plain damage.
    const { state } = useActive(table({}));
    const holder = body(state.players.p1.active);
    expect(boostedAttackDamage(state, holder, 0)).toBe(120);
    expect(everyAttackBoostOf(state, holder)).toBe(120);
    expect(holder.damage).toBe(50);
  });
});
