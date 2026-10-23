import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter, topCardOf } from "./cards";
import { effectiveTypesOf, inPlayCardOf, preventsAttackerType } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { attachEnergyTargets, conditionHolds, runProgram } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, must, mustApply as run } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const SCOVILLAIN = "sv08-037";
const SCOVILLAIN_ALT = "sv08-216";
const CAPSAKID = "d578s-capsakid";
const IRON_THORNS = "sv06-077";
const WEAK_G = "d578s-weak-grass";
const WEAK_R = "d578s-weak-fire";
const WEAK_GR = "d578s-weak-both";
const RES_GR = "d578s-resist-both";
const PLAIN = "d578s-plain";
const FILLER = "d578s-filler";

const scovillainFace = (id: string): Card =>
  battler(id, {
    name: "Scovillain ex",
    stage: "Stage1",
    evolveFrom: "Capsakid",
    hp: 260,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Double Type",
        effect: "As long as this Pokémon is in play, it is {G} and {R} type.",
      },
    ],
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Spicy Rage",
        damage: "10+",
        effect: "This attack does 70 more damage for each damage counter on this Pokémon.",
      },
      { cost: [], name: "Test Strike", damage: 50 },
    ],
  });

const defender = (id: string, extra: Partial<Card>): Card =>
  battler(id, {
    name: id,
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
    ...extra,
  });

const LOCAL_CARDS: Record<string, Card> = {
  [SCOVILLAIN]: scovillainFace(SCOVILLAIN),
  [SCOVILLAIN_ALT]: scovillainFace(SCOVILLAIN_ALT),
  [CAPSAKID]: battler(CAPSAKID, { name: "Capsakid", hp: 70, types: ["Fire"] }),
  // Iron Thorns ex "Initialization" (Active: Rule Box Pokémon have no Abilities, except Future
  // Pokémon) — a LOCAL face with a test-only {G} Weakness, so the lock's effect on §8.5 shows.
  [IRON_THORNS]: defender(IRON_THORNS, {
    name: "Iron Thorns ex",
    hp: 900,
    types: ["Lightning"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Initialization",
        effect:
          "As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
      },
    ],
  }),
  [WEAK_G]: defender(WEAK_G, { weaknesses: [{ type: "Grass", value: "×2" }] }),
  [WEAK_R]: defender(WEAK_R, { weaknesses: [{ type: "Fire", value: "×2" }] }),
  [WEAK_GR]: defender(WEAK_GR, {
    weaknesses: [
      { type: "Grass", value: "×2" },
      { type: "Fire", value: "×2" },
    ],
  }),
  [RES_GR]: defender(RES_GR, {
    resistances: [
      { type: "Grass", value: "-30" },
      { type: "Fire", value: "-30" },
    ],
  }),
  [PLAIN]: defender(PLAIN, {}),
  [FILLER]: defender(FILLER, { retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [SCOVILLAIN]: 2,
  [SCOVILLAIN_ALT]: 1,
  [CAPSAKID]: 2,
  [IRON_THORNS]: 1,
  [WEAK_G]: 1,
  [WEAK_R]: 1,
  [WEAK_GR]: 1,
  [RES_GR]: 1,
  [PLAIN]: 2,
  [FILLER]: 28,
  "fix-energy": 20,
});

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
  under?: readonly string[];
  damage?: number;
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s (an evolved body carries its
    `under` cards beneath the top), every hand emptied back into the deck. */
function table(opts: {
  p1: Spot;
  p1Bench?: readonly Spot[];
  p2: Spot;
  p2Bench?: readonly Spot[];
}): GameState {
  let state = opened(5781);
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
  const body = (seat: Seat, spot: Spot): InPlayPokemon => {
    const stack: string[] = [];
    for (const id of [...(spot.under ?? []), spot.id]) {
      const pulled = pull(state, seat, id);
      state = pulled.state;
      stack.push(pulled.uid);
    }
    return { ...makeInPlay(stack[0] ?? "", 0), stack, damage: spot.damage ?? 0 };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = body(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) =>
      body(seat, s),
    );
    state = withSide(state, seat, { active, bench });
  }
  return state;
}

function damageRow(events: readonly GameEvent[]): Extract<GameEvent, { type: "DAMAGE_DEALT" }> {
  const row = events.find(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
  if (row === undefined) throw new Error("no DAMAGE_DEALT");
  return row;
}

const SCOV_SPOT: Spot = { id: SCOVILLAIN, under: [CAPSAKID] };

describe("D578 Scovillain §1 — the registry row", () => {
  it("both printings carry the ONE object: `typesInPlay` [Grass, Fire], no attack key (Spicy Rage keeps deriving)", () => {
    expect(programFor(SCOVILLAIN)).toEqual({ passive: { typesInPlay: ["Grass", "Fire"] } });
    expect(programFor(SCOVILLAIN_ALT)).toBe(programFor(SCOVILLAIN));
  });

  it("the excluded mark-G printing sv05-022 is NOT registered", () => {
    expect(programFor("sv05-022")).toBeUndefined();
  });
});

describe("D578 Scovillain §2 — `inPlayCardOf`: in play it is {G} and {R}, Active and Bench alike", () => {
  it("the Active and a Benched Scovillain ex both read [Grass, Fire]; the printed card stays [Fire]", () => {
    const state = table({
      p1: SCOV_SPOT,
      p1Bench: [{ id: SCOVILLAIN_ALT, under: [CAPSAKID] }],
      p2: { id: PLAIN },
    });
    const active = state.players.p1.active as InPlayPokemon;
    const bench = state.players.p1.bench[0] as InPlayPokemon;
    expect(effectiveTypesOf(state, active)).toEqual(["Grass", "Fire"]);
    expect(effectiveTypesOf(state, bench)).toEqual(["Grass", "Fire"]);
    expect(POOL[SCOVILLAIN]?.types).toEqual(["Fire"]);
    // The view is the card's own in every other field.
    const view = inPlayCardOf(state, active);
    expect(view?.id).toBe(SCOVILLAIN);
    expect(view?.attacks).toEqual(POOL[SCOVILLAIN]?.attacks);
    expect(view?.weaknesses).toEqual(POOL[SCOVILLAIN]?.weaknesses);
  });

  it("a body WITHOUT the key is handed the catalog card itself (identity — every pre-D578 board reads what it read)", () => {
    const state = table({ p1: { id: PLAIN }, p2: { id: WEAK_G } });
    const active = state.players.p1.active as InPlayPokemon;
    expect(inPlayCardOf(state, active)).toBe(topCardOf(state, active));
    expect(effectiveTypesOf(state, active)).toEqual(["Colorless"]);
  });

  it("the HAND card is printed — 'As long as this Pokémon is in play': a {G} filter refuses it", () => {
    expect(matchesFilter(POOL[SCOVILLAIN], { kind: "typedPokemon", pokemonType: "Grass" })).toBe(
      false,
    );
    expect(matchesFilter(POOL[SCOVILLAIN], { kind: "typedPokemon", pokemonType: "Fire" })).toBe(
      true,
    );
  });
});

describe("D578 Scovillain §3 — Weakness and Resistance (§8.5): each applies ONCE", () => {
  const strike = (def: string, attacker: Spot = SCOV_SPOT) => {
    const state = table({ p1: attacker, p2: { id: def } });
    return damageRow(run(state, { type: "attack", seat: "p1", index: 1 }).events);
  };

  it("a {G}-Weakness defender takes ×2 from Scovillain ex (the {G} it IS in play)", () => {
    const row = strike(WEAK_G);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a {R}-Weakness defender takes ×2 (the printed type still counts)", () => {
    const row = strike(WEAK_R);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a defender weak to BOTH {G} and {R} takes ×2 ONCE — `weakResModifier` returns on the first match", () => {
    const row = strike(WEAK_GR);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a defender resisting BOTH {G} and {R} takes −30 ONCE", () => {
    const row = strike(RES_GR);
    expect(row.resistance).toEqual({ op: "subtract", amount: 30 });
    expect(row.dealt).toBe(20);
  });

  it("a plain defender takes the printed 50 (control)", () => {
    const row = strike(PLAIN);
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(50);
  });
});

describe("D578 Scovillain §4 — the type-keyed reads see {G} and {R}", () => {
  it("`preventsAttackerType` — a {G} shield refuses the in-play Scovillain ex, the printed card passes it", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    const active = state.players.p1.active as InPlayPokemon;
    expect(preventsAttackerType(["Grass"], inPlayCardOf(state, active))).toBe(true);
    expect(preventsAttackerType(["Fire"], inPlayCardOf(state, active))).toBe(true);
    expect(preventsAttackerType(["Grass"], POOL[SCOVILLAIN])).toBe(false);
  });

  it("`opponentActiveHasType` — the OPPONENT's clause sees a {G} and an {R} Active", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Grass" })).toBe(
      true,
    );
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Fire" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Water" })).toBe(
      false,
    );
  });

  it("`yourActiveHasType` and `yourBenchHasType` — the holder's own side", () => {
    const state = table({ p1: { id: PLAIN }, p1Bench: [SCOV_SPOT], p2: { id: PLAIN } });
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Grass" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasType", type: "Grass" })).toBe(false);
    const flipped = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    expect(conditionHolds(flipped, "p1", { kind: "yourActiveHasType", type: "Grass" })).toBe(true);
  });

  it("a typed IN-PLAY filter — an attach to 'your {G} Pokémon' offers the Benched Scovillain ex", () => {
    const state = table({ p1: { id: PLAIN }, p1Bench: [SCOV_SPOT], p2: { id: PLAIN } });
    expect(attachEnergyTargets(state, "p1", { targetType: "Grass" })).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Water" })).toEqual([]);
  });

  it("a typed heal ('each of your {G} Pokémon') heals the Scovillain ex and not the {C} body", () => {
    const state = table({
      p1: { id: PLAIN, damage: 30 },
      p1Bench: [{ ...SCOV_SPOT, damage: 40 }],
      p2: { id: PLAIN },
    });
    const result = runProgram(
      state,
      [{ op: "healEach", amount: 30, pokemonType: "Grass" }],
      { seat: "p1" },
      [],
    );
    expect(result.state.players.p1.bench[0]?.damage).toBe(10);
    expect(result.state.players.p1.active?.damage).toBe(30);
  });
});

describe("D578 Scovillain §5 — a §9 Ability lock hands back the printed {R}", () => {
  it("an opposing Active Iron Thorns ex (Initialization: Rule Box Pokémon have no Abilities) — Scovillain ex is {R} only, Active and Bench", () => {
    const state = table({
      p1: SCOV_SPOT,
      p1Bench: [{ id: SCOVILLAIN_ALT, under: [CAPSAKID] }],
      p2: { id: IRON_THORNS },
    });
    expect(effectiveTypesOf(state, state.players.p1.active as InPlayPokemon)).toEqual(["Fire"]);
    expect(effectiveTypesOf(state, state.players.p1.bench[0] as InPlayPokemon)).toEqual(["Fire"]);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Grass" })).toBe(
      false,
    );
  });

  it("…so the locked attacker's hit on a {G}-weak Iron Thorns ex takes NO Weakness (50, not 100)", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: IRON_THORNS } });
    const row = damageRow(run(state, { type: "attack", seat: "p1", index: 1 }).events);
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(50);
  });
});

describe("D578 Scovillain §6 — R-WT1: the Watchtower's {C} read stays PRINTED and stays exact", () => {
  // The printed types of every `typesInPlay` holder, from the audit card JSON (tcgdex,
  // 2026-09-25). A new holder must be added here — with its printed types — before it lands.
  const HOLDER_PRINTED_TYPES: Record<string, readonly string[]> = {
    "sv08-037": ["Fire"],
    "sv08-216": ["Fire"],
    "sv05-118": ["Metal"],
    "me02.5-117": ["Fighting"],
    "me02.5-242": ["Fighting"],
  };

  it("every `typesInPlay` value, and every holder's printed types, exclude {C} — a retype can neither add nor remove {C}", () => {
    const holders = registryCardIds().filter(
      (id) => programFor(id)?.passive?.typesInPlay !== undefined,
    );
    expect(holders.sort()).toEqual(Object.keys(HOLDER_PRINTED_TYPES).sort());
    for (const id of holders) {
      expect(programFor(id)?.passive?.typesInPlay).not.toContain("Colorless");
      expect(HOLDER_PRINTED_TYPES[id]).not.toContain("Colorless");
    }
  });
});
