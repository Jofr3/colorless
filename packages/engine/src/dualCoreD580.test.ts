import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter, topCardOf } from "./cards";
import { effectiveTypesOf, inPlayCardOf, toolsInEffect } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { attachEnergyTargets, conditionHolds } from "./interpreter";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, trainerCard } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D580 — IRON TREADS `sv05-118` "DUAL CORE" — THE LAST ABILITY ──
//
// *"As long as this Pokémon has a Future Booster Energy Capsule attached, it is {F} and {M}
// type."* D578's `PassiveEffects.typesInPlay` (["Fighting", "Metal"]) behind the new
// `typesInPlayWhileToolNamed` condition, read by continuous.ts `inPlayCardOf` ONLY.
//
// 🛑🛑🛑 **DUAL CORE CAN NEVER FIRE IN A STANDARD-LEGAL DECK.** Its condition card, Future Booster
// Energy Capsule `sv05-149`, is regulation G and NOT Standard-legal, and it is not ingested. Every
// behaviour below is proven on a CONSTRUCTED fixture Tool that merely carries that NAME
// (`d580dc-capsule`). In a legal game the condition is always false and Iron Treads is always its
// printed {M}.
//
// Rulings (decisions.md D580): R-DC1 (UNRULED) — the condition reads the ATTACHED Tools
// (`pokemon.tools`), not `toolsInEffect`, so a Jamming Tower does not lift the retype (reversal:
// read `toolsInEffect`). R-DC2 (by text) — a §9 Ability lock hands back the printed {M}. R-DC3
// (by text) — the Tool is matched by its card NAME.
//
// Its OWN Weakness ({R}) and Resistance ({G}) stay as printed: being {F}{M} changes what ITS
// attacks hit for Weakness / Resistance and what the type-keyed effects see; it does NOT make the
// body take Fighting-keyed Weakness.

const IRON_TREADS = "sv05-118";
const CAPSULE = "d580dc-capsule"; // CONSTRUCTED: the name of the non-legal `sv05-149`
const OTHER_TOOL = "d580dc-other-tool";
const JAMMING_TOWER = "sv06-153";
const KLEFKI = "sv01-096";
const WEAK_F = "d580dc-weak-fighting";
const WEAK_M = "d580dc-weak-metal";
const PLAIN = "d580dc-plain";
const FIRE_HITTER = "d580dc-fire-hitter";
const GRASS_HITTER = "d580dc-grass-hitter";
const FIGHTING_HITTER = "d580dc-fighting-hitter";
const FILLER = "d580dc-filler";

const ironTreadsFace: Card = battler(IRON_TREADS, {
  name: "Iron Treads",
  hp: 130,
  types: ["Metal"],
  retreat: 2,
  weaknesses: [{ type: "Fire", value: "×2" }],
  resistances: [{ type: "Grass", value: "-30" }],
  abilities: [
    {
      type: "Ability",
      name: "Dual Core",
      effect: "As long as this Pokémon has a Future Booster Energy Capsule attached, it is {F} and {M} type.",
    },
  ],
  attacks: [
    {
      cost: ["Metal", "Colorless"],
      name: "Wheel Pass",
      damage: 60,
      effect: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    },
    // Test-only: a free flat hit so the §8.5 arithmetic is readable.
    { cost: [], name: "Test Strike", damage: 50 },
  ],
});

const body = (id: string, extra: Partial<Card>): Card =>
  battler(id, { name: id, hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 50 }], ...extra });

const LOCAL_CARDS: Record<string, Card> = {
  [IRON_TREADS]: ironTreadsFace,
  [CAPSULE]: { ...trainerCard(CAPSULE, "Tool", "(constructed)"), name: "Future Booster Energy Capsule" },
  [OTHER_TOOL]: { ...trainerCard(OTHER_TOOL, "Tool", "(constructed)"), name: "Future Booster Energy Capsule II" },
  [JAMMING_TOWER]: { ...trainerCard(JAMMING_TOWER, "Stadium", "Jamming Tower"), name: "Jamming Tower" },
  [WEAK_F]: body(WEAK_F, { weaknesses: [{ type: "Fighting", value: "×2" }] }),
  [WEAK_M]: body(WEAK_M, { weaknesses: [{ type: "Metal", value: "×2" }] }),
  [PLAIN]: body(PLAIN, {}),
  [FIRE_HITTER]: body(FIRE_HITTER, { types: ["Fire"] }),
  [GRASS_HITTER]: body(GRASS_HITTER, { types: ["Grass"] }),
  [FIGHTING_HITTER]: body(FIGHTING_HITTER, { types: ["Fighting"] }),
  [FILLER]: body(FILLER, { retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [IRON_TREADS]: 2,
  [CAPSULE]: 2,
  [OTHER_TOOL]: 1,
  [JAMMING_TOWER]: 1,
  [KLEFKI]: 1,
  [WEAK_F]: 1,
  [WEAK_M]: 1,
  [PLAIN]: 2,
  [FIRE_HITTER]: 1,
  [GRASS_HITTER]: 1,
  [FIGHTING_HITTER]: 1,
  [FILLER]: 26,
  "fix-energy": 20,
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

interface Spot {
  id: string;
  tools?: readonly string[];
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s (each with its attached Tools),
    every hand emptied back into the deck; `stadium` puts a Stadium in play. */
function table(opts: { p1: Spot; p1Bench?: readonly Spot[]; p2: Spot; stadium?: string }): GameState {
  let state = opened(5801);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy, ...side.active.tools]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const make = (seat: Seat, spot: Spot): InPlayPokemon => {
    const top = pull(state, seat, spot.id);
    state = top.state;
    const tools: string[] = [];
    for (const id of spot.tools ?? []) {
      const t = pull(state, seat, id);
      state = t.state;
      tools.push(t.uid);
    }
    return { ...makeInPlay(top.uid, 0), tools };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = make(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : []).map((s) => make(seat, s));
    state = withSide(state, seat, { active, bench });
  }
  if (opts.stadium !== undefined) {
    const s = pull(state, "p2", opts.stadium);
    state = { ...s.state, stadium: { uid: s.uid, owner: "p2" } };
  }
  return state;
}

function damageRow(events: readonly GameEvent[]): Extract<GameEvent, { type: "DAMAGE_DEALT" }> {
  const row = events.find((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
  if (row === undefined) throw new Error("no DAMAGE_DEALT");
  return row;
}

const CORED: Spot = { id: IRON_TREADS, tools: [CAPSULE] };
const BARE: Spot = { id: IRON_TREADS };
const active = (state: GameState, seat: Seat) => state.players[seat].active as InPlayPokemon;

describe("D580 Dual Core §0 — the version and the registry row", () => {
  it("is built at engine 0.503.0", () => {
    expect(engineVersion).toBe("0.503.0");
  });

  it("sv05-118 carries `typesInPlay` [Fighting, Metal] behind the Tool NAME, no attack key (Wheel Pass keeps deriving)", () => {
    expect(programFor(IRON_TREADS)).toEqual({
      passive: { typesInPlay: ["Fighting", "Metal"], typesInPlayWhileToolNamed: "Future Booster Energy Capsule" },
    });
  });

  it("🛑 the condition card `sv05-149` is NOT registered and NOT in the pool — Dual Core never fires in a Standard-legal deck", () => {
    expect(programFor("sv05-149")).toBeUndefined();
    expect(FIXTURE_POOL["sv05-149"]).toBeUndefined();
  });
});

describe("D580 Dual Core §1 — with the (constructed) Capsule attached it is {F} and {M}", () => {
  it("effectiveTypesOf is [Fighting, Metal], Active and Bench alike; the printed card stays [Metal]", () => {
    const state = table({ p1: CORED, p1Bench: [CORED], p2: { id: PLAIN } });
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Fighting", "Metal"]);
    expect(effectiveTypesOf(state, state.players.p1.bench[0] as InPlayPokemon)).toEqual(["Fighting", "Metal"]);
    expect(POOL[IRON_TREADS]?.types).toEqual(["Metal"]);
  });

  it("its attacks hit a {F}-weak defender for Weakness (the {F} it IS) and a {M}-weak one (printed)", () => {
    const f = damageRow(run(table({ p1: CORED, p2: { id: WEAK_F } }), { type: "attack", seat: "p1", index: 1 }).events);
    expect(f.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(f.dealt).toBe(100);
    const m = damageRow(run(table({ p1: CORED, p2: { id: WEAK_M } }), { type: "attack", seat: "p1", index: 1 }).events);
    expect(m.dealt).toBe(100);
  });

  it("type-keyed reads see both: opponentActiveHasType, yourBenchHasType, a {F}-typed attach target", () => {
    const state = table({ p1: CORED, p1Bench: [CORED], p2: { id: PLAIN } });
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Fighting" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Metal" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fighting" })).toBe(true);
    expect(attachEnergyTargets(state, "p1", { targetType: "Fighting" })).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
  });

  it("its OWN Weakness and Resistance stay printed: a {R} hit is ×2, a {G} hit is −30, a {F} hit is plain", () => {
    const fire = damageRow(run(table({ p1: { id: FIRE_HITTER }, p2: CORED }), { type: "attack", seat: "p1", index: 0 }).events);
    expect(fire.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(fire.dealt).toBe(100);
    const grass = damageRow(run(table({ p1: { id: GRASS_HITTER }, p2: CORED }), { type: "attack", seat: "p1", index: 0 }).events);
    expect(grass.dealt).toBe(20);
    const fighting = damageRow(
      run(table({ p1: { id: FIGHTING_HITTER }, p2: CORED }), { type: "attack", seat: "p1", index: 0 }).events,
    );
    expect(fighting.weakness).toBeNull();
    expect(fighting.dealt).toBe(50);
  });
});

describe("D580 Dual Core §2 — without the Capsule it is its printed {M}", () => {
  it("no Tool: printed [Metal], the catalog card itself, and a {F}-weak defender takes no Weakness", () => {
    const state = table({ p1: BARE, p2: { id: WEAK_F } });
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Metal"]);
    expect(inPlayCardOf(state, active(state, "p1"))).toBe(topCardOf(state, active(state, "p1")));
    const row = damageRow(run(state, { type: "attack", seat: "p1", index: 1 }).events);
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(50);
  });

  it("R-DC3: a DIFFERENTLY named Tool is not the Capsule — printed", () => {
    const state = table({ p1: { id: IRON_TREADS, tools: [OTHER_TOOL] }, p2: { id: PLAIN } });
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Metal"]);
  });

  it("per BODY, not per card: a cored Active and a bare Benched Iron Treads read differently on one board", () => {
    const state = table({ p1: CORED, p1Bench: [BARE], p2: { id: PLAIN } });
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Fighting", "Metal"]);
    expect(effectiveTypesOf(state, state.players.p1.bench[0] as InPlayPokemon)).toEqual(["Metal"]);
    // …the bare body asked AGAIN after the cored one filled the per-card cache, so that cache cannot leak…
    expect(effectiveTypesOf(state, state.players.p1.bench[0] as InPlayPokemon)).toEqual(["Metal"]);
    // …and asked in the OTHER order on a fresh board: the bare body FIRST, then the cored one.
    const fresh = table({ p1: CORED, p1Bench: [BARE], p2: { id: PLAIN } });
    expect(effectiveTypesOf(fresh, fresh.players.p1.bench[0] as InPlayPokemon)).toEqual(["Metal"]);
    expect(effectiveTypesOf(fresh, active(fresh, "p1"))).toEqual(["Fighting", "Metal"]);
  });

  it("hand, deck and discard cards are printed (a {F} filter refuses the card)", () => {
    expect(matchesFilter(POOL[IRON_TREADS], { kind: "typedPokemon", pokemonType: "Fighting" })).toBe(false);
    expect(matchesFilter(POOL[IRON_TREADS], { kind: "typedPokemon", pokemonType: "Metal" })).toBe(true);
  });
});

describe("D580 Dual Core §3 — the locks", () => {
  it("R-DC2: under a §9 Ability lock (an opposing Active Klefki, Mischievous Lock) it is printed even with the Capsule", () => {
    const state = table({ p1: CORED, p2: { id: KLEFKI } });
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Metal"]);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Fighting" })).toBe(false);
  });

  it("R-DC1 (UNRULED): under Jamming Tower (Tools have no effect) the retype STILL applies — the condition reads ATTACHMENT", () => {
    const state = table({ p1: CORED, p2: { id: PLAIN }, stadium: JAMMING_TOWER });
    // The premise: the Tower really is silencing the Tool's effects.
    expect(toolsInEffect(state, active(state, "p1"))).toEqual([]);
    expect(active(state, "p1").tools.length).toBe(1);
    expect(effectiveTypesOf(state, active(state, "p1"))).toEqual(["Fighting", "Metal"]);
  });
});
