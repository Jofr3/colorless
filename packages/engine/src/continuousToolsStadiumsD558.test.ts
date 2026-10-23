import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  activeRetreatSurcharge,
  disabledAbilityUids,
  effectiveAttackCost,
  effectiveRetreatCost,
  passivesOf,
  seatDamageReduction,
  seatPreWRDamageBonus,
  toolAttackCostDiscount,
  toolFreesRetreat,
  toolRetreatDiscount,
} from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { attackerPreWRBonus, runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  trainerCard,
  must,
  ensureInDeck,
  driveSetup,
} from "./testFixtures";

const COUNTER_GAIN = ["sv08-169", "sv08-249"] as const;
const HOPS_BAND = "sv09-148";
const BANGLE = "sv10.5w-080";
const BALLOON = "sv10.5b-079";
const RESCUE = ["sv05-159", "sv06-225", "sv08.5-126"] as const;
const GEMSTONE = "sv07-137";
const FML = "sv05-148";
const GRANITE = "sv10-166";
const POSTWICK = "sv09-154";
const NS_CASTLE = "sv09-152";
const PARADISE = ["svp-150", "svp-224"] as const;
const BEACH_COURT = "sv01-167";
const WASTELAND = "sv02-175";
const TING_LU = "sv02-127";
const RADIANT_CHARIZARD = "swsh10.5-011";
const HOP_SNORLAX = "fix-hop-aura";

const TEXT: Record<string, string> = {
  "Counter Gain":
    "If you have more Prize cards remaining than your opponent, attacks used by the Pokémon this card is attached to cost {C} less.",
  "Hop's Choice Band":
    "Attacks used by the Hop's Pokémon this card is attached to cost {C} less and do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
  "Brave Bangle":
    "If the Pokémon this card is attached to doesn't have a Rule Box, the attacks it uses do 30 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance). (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
  "Air Balloon": "The Retreat Cost of the Pokémon this card is attached to is {C}{C} less.",
  "Rescue Board":
    "The Retreat Cost of the Pokémon this card is attached to is {C} less. If that Pokémon's remaining HP is 30 or less, it has no Retreat Cost.",
  "Gravity Gemstone":
    "As long as the Pokémon this card is attached to is in the Active Spot, the Retreat Cost of both Active Pokémon is {C} more.",
  "Full Metal Lab":
    "{M} Pokémon (both yours and your opponent's) take 30 less damage from attacks from the opponent's Pokémon (after applying Weakness and Resistance).",
  "Granite Cave":
    "Steven's Pokémon (both yours and your opponent's) take 30 less damage from attacks from the opponent's Pokémon (after applying Weakness and Resistance).",
  Postwick:
    "Attacks used by Hop's Pokémon (both yours and your opponent's) do 30 more damage to the opponent's Active Pokémon (before applying Weakness and Resistance).",
  "N's Castle": "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost.",
  "Paradise Resort":
    "The Retreat Cost of each Psyduck in play (both yours and your opponent's) is {C} less.",
};

function printed(id: string, name: string, trainerType: string): Card {
  return { ...trainerCard(id, trainerType, TEXT[name] as string), name };
}
function printings(ids: readonly string[], name: string, trainerType: string) {
  return Object.fromEntries(ids.map((id) => [id, printed(id, name, trainerType)]));
}

const STRIKE = [{ cost: ["Colorless"], name: "Strike", damage: 50 }];
const PLAIN = "d558c-plain";
const HOP = "d558c-hop";
const HOP_EVO = "d558c-hop-evo";
const EX_BODY = "d558c-ex";
const WALL = "d558c-wall";
const WALL_EX = "d558c-wall-ex";
const WALL_V = "d558c-wall-v";
const METAL = "d558c-metal";
const STEVEN = "d558c-steven";
const N_BASIC = "d558c-n";
const N_STAGE1 = "d558c-n1";
const PSYDUCK = "d558c-psyduck";
const GOLDUCK = "d558c-golduck";
const STAGE1 = "d558c-stage1";
const BIG = "d558c-big";

const LOCAL_CARDS: Record<string, Card> = {
  ...printings(COUNTER_GAIN, "Counter Gain", "Tool"),
  [HOPS_BAND]: printed(HOPS_BAND, "Hop's Choice Band", "Tool"),
  [BANGLE]: printed(BANGLE, "Brave Bangle", "Tool"),
  [BALLOON]: printed(BALLOON, "Air Balloon", "Tool"),
  ...printings(RESCUE, "Rescue Board", "Tool"),
  [GEMSTONE]: printed(GEMSTONE, "Gravity Gemstone", "Tool"),
  [FML]: printed(FML, "Full Metal Lab", "Stadium"),
  [GRANITE]: printed(GRANITE, "Granite Cave", "Stadium"),
  [POSTWICK]: printed(POSTWICK, "Postwick", "Stadium"),
  [NS_CASTLE]: printed(NS_CASTLE, "N's Castle", "Stadium"),
  ...printings(PARADISE, "Paradise Resort", "Stadium"),
  [PLAIN]: battler(PLAIN, {
    name: "D558 Plain",
    hp: 200,
    retreat: 3,
    types: ["Colorless"],
    attacks: STRIKE,
  }),
  [HOP]: battler(HOP, {
    name: "Hop's D558 Wooloo",
    hp: 200,
    retreat: 2,
    types: ["Colorless"],
    attacks: STRIKE,
  }),
  [HOP_EVO]: battler(HOP_EVO, {
    name: "D558 Dubwool",
    stage: "Stage1",
    evolveFrom: "Hop's D558 Wooloo",
    hp: 200,
    retreat: 2,
    types: ["Colorless"],
    attacks: STRIKE,
  }),
  [EX_BODY]: battler(EX_BODY, {
    name: "D558 Striker ex",
    hp: 300,
    retreat: 2,
    types: ["Colorless"],
    attacks: STRIKE,
  }),
  [WALL]: battler(WALL, { name: "D558 Wall", hp: 900, retreat: 2, types: ["Fighting"] }),
  [WALL_EX]: battler(WALL_EX, { name: "D558 Wall ex", hp: 900, retreat: 2, types: ["Fighting"] }),
  [WALL_V]: battler(WALL_V, { name: "D558 Wall V", hp: 900, retreat: 2, types: ["Fighting"] }),
  [METAL]: battler(METAL, {
    name: "D558 Steel",
    hp: 900,
    retreat: 2,
    types: ["Metal"],
    attacks: STRIKE,
  }),
  [STEVEN]: battler(STEVEN, {
    name: "Steven's D558 Beldum",
    hp: 900,
    retreat: 2,
    types: ["Psychic"],
  }),
  [N_BASIC]: battler(N_BASIC, { name: "N's D558 Zorua", hp: 200, retreat: 2, types: ["Darkness"] }),
  [N_STAGE1]: battler(N_STAGE1, {
    name: "N's D558 Zoroark",
    stage: "Stage1",
    evolveFrom: "N's D558 Zorua",
    hp: 200,
    retreat: 3,
    types: ["Darkness"],
  }),
  [PSYDUCK]: battler(PSYDUCK, { name: "Psyduck", hp: 200, retreat: 2, types: ["Water"] }),
  [GOLDUCK]: battler(GOLDUCK, {
    name: "Golduck",
    stage: "Stage1",
    evolveFrom: "Psyduck",
    hp: 200,
    retreat: 2,
    types: ["Water"],
  }),
  [BIG]: battler(BIG, {
    name: "D558 Big",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Heave", damage: 60 }],
  }),
  [STAGE1]: battler(STAGE1, {
    name: "D558 Stage1",
    stage: "Stage1",
    evolveFrom: "D558 Plain",
    hp: 200,
    retreat: 2,
    types: ["Colorless"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [COUNTER_GAIN[0]]: 2,
  [COUNTER_GAIN[1]]: 1,
  [HOPS_BAND]: 2,
  [BANGLE]: 1,
  [BALLOON]: 2,
  [RESCUE[0]]: 1,
  [RESCUE[1]]: 1,
  [RESCUE[2]]: 1,
  [GEMSTONE]: 2,
  [FML]: 1,
  [GRANITE]: 1,
  [POSTWICK]: 1,
  [NS_CASTLE]: 1,
  [PARADISE[0]]: 1,
  [PARADISE[1]]: 1,
  [BEACH_COURT]: 1,
  [WASTELAND]: 1,
  [TING_LU]: 1,
  [RADIANT_CHARIZARD]: 1,
  [HOP_SNORLAX]: 1,
  [PLAIN]: 6,
  [HOP]: 2,
  [HOP_EVO]: 1,
  [EX_BODY]: 1,
  [WALL]: 2,
  [WALL_EX]: 1,
  [WALL_V]: 1,
  [METAL]: 2,
  [STEVEN]: 2,
  [N_BASIC]: 2,
  [N_STAGE1]: 1,
  [PSYDUCK]: 2,
  [GOLDUCK]: 1,
  [STAGE1]: 1,
  [BIG]: 1,
  "fix-energy": 10,
});

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** `id` as `seat`'s Active — kept if setup already put it there (a lone copy cannot be
    pulled from the deck), else pulled through `ensureInDeck`. */
function seatActive(state: GameState, seat: Seat, id: string): GameState {
  const active = state.players[seat].active;
  const top = active?.stack[active.stack.length - 1];
  if (top !== undefined && state.cardIdByUid[top] === id) return state;
  return setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
}

/** p1's turn 2 with `active` / `bench` for p1 and `oppActive` / `oppBench` for p2, and
    one Colorless Energy on p1's Active (every attack here costs {C}). */
function table(
  active: string = PLAIN,
  bench: readonly string[] = [],
  oppActive: string = WALL,
  oppBench: readonly string[] = [],
): GameState {
  let state = opened(5581);
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return attachFromDeck(ensureInDeck(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
}

/** TEST SURGERY — a Tool from `seat`'s deck onto its Active or bench[index]. */
const tool = (state: GameState, seat: Seat, spot: "active" | number, id: string) =>
  attachToolFromDeck(ensureInDeck(state, seat, id), seat, spot, id);

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** TEST SURGERY — p2's Active becomes Ting-Lu ex and `seat`'s Active takes 10 damage, so
    "Cursed Land" disables the Abilities of p1's damaged Active (non-ex, Active source). */
function lockP1(state: GameState): GameState {
  let next = setActiveFromDeck(ensureInDeck(state, "p2", TING_LU), "p2", TING_LU);
  next = setDamage(next, "p1", (next.players.p1.active?.damage ?? 0) + 10);
  expect(disabledAbilityUids(next).has(topUidOf(next, "p1")), "the lock is live").toBe(true);
  return next;
}

function body(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}
function topUidOf(state: GameState, seat: Seat): string {
  const b = body(state, seat);
  return b.stack[b.stack.length - 1] as string;
}
const retreat = (state: GameState, seat: Seat = "p1", spot: "active" | number = "active") =>
  effectiveRetreatCost(state, body(state, seat, spot));
const CCC = ["Colorless", "Colorless", "Colorless"] as const;
const cost = (state: GameState, seat: Seat = "p1", printedCost: readonly string[] = CCC) =>
  effectiveAttackCost(state, body(state, seat), printedCost);
const cardOf = (id: string) => POOL[id] as Card;

function dealt(state: GameState): Extract<GameEvent, { type: "DAMAGE_DEALT" }> {
  const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const row = events.find((e) => e.type === "DAMAGE_DEALT");
  if (row === undefined || row.type !== "DAMAGE_DEALT") throw new Error("no DAMAGE_DEALT");
  return row;
}

function runAttackProgram(state: GameState, text: string): GameState {
  const program = deriveAttackEffect(text);
  if (program === null) throw new Error(`does not derive: ${text}`);
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, []);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}
const BENCH_CLAUSE = "(Don't apply Weakness and Resistance for Benched Pokémon.)";
const ownSpread = (state: GameState) =>
  runAttackProgram(
    state,
    `This attack also does 30 damage to each of your Benched Pokémon. ${BENCH_CLAUSE}`,
  );
const oppSpread = (state: GameState) =>
  runAttackProgram(
    state,
    `This attack also does 30 damage to each of your opponent's Benched Pokémon. ${BENCH_CLAUSE}`,
  );
const ownSnipe = (state: GameState) =>
  runAttackProgram(
    state,
    `This attack also does 40 damage to 1 of your Benched Pokémon. ${BENCH_CLAUSE}`,
  );
const oppSnipe = (state: GameState) =>
  runAttackProgram(
    state,
    `This attack also does 40 damage to 1 of your opponent's Benched Pokémon. ${BENCH_CLAUSE}`,
  );

/** p1 has MORE Prize cards remaining than p2: 6 against 5. */
const p1Ahead = (state: GameState) => setPrizes(state, "p2", 5);

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §1 — the prints, and the registry rows that map them", () => {
  const ROWS: readonly { name: string; ids: readonly string[]; program: unknown }[] = [
    {
      name: "Counter Gain",
      ids: COUNTER_GAIN,
      program: { passive: { attackCostDiscount: { amount: 1, ifMorePrizesRemaining: true } } },
    },
    {
      name: "Hop's Choice Band",
      ids: [HOPS_BAND],
      program: {
        passive: {
          attackCostDiscount: { amount: 1, holder: { kind: "ownerPokemon", owner: "Hop" } },
          damageBonusBeforeWRIf: { amount: 30, cond: { kind: "yourActiveOwner", owner: "Hop" } },
        },
      },
    },
    {
      name: "Brave Bangle",
      ids: [BANGLE],
      program: {
        passive: {
          damageBonusBeforeWRIfTarget: {
            amount: 30,
            targetSuffix: "ex",
            holder: { kind: "anyPokemon", noRuleBox: true },
          },
        },
      },
    },
    {
      name: "Air Balloon",
      ids: [BALLOON],
      program: { passive: { retreatCostDiscount: { amount: 2 } } },
    },
    {
      name: "Rescue Board",
      ids: RESCUE,
      program: { passive: { retreatCostDiscount: { amount: 1, freeAtRemainingHpAtMost: 30 } } },
    },
    {
      name: "Gravity Gemstone",
      ids: [GEMSTONE],
      program: { passive: { activeRetreatSurchargeBoth: 1 } },
    },
    {
      name: "Full Metal Lab",
      ids: [FML],
      program: {
        stadium: {
          damageReductionAfterWR: {
            amount: 30,
            beneficiary: { kind: "typedPokemon", pokemonType: "Metal" },
          },
        },
      },
    },
    {
      name: "Granite Cave",
      ids: [GRANITE],
      program: {
        stadium: {
          damageReductionAfterWR: {
            amount: 30,
            beneficiary: { kind: "ownerPokemon", owner: "Steven" },
          },
        },
      },
    },
    {
      name: "Postwick",
      ids: [POSTWICK],
      program: {
        stadium: {
          damageBonusBeforeWR: { amount: 30, attacker: { kind: "ownerPokemon", owner: "Hop" } },
        },
      },
    },
    {
      name: "N's Castle",
      ids: [NS_CASTLE],
      program: {
        stadium: { retreat: { filter: { kind: "ownerPokemon", owner: "N" }, free: true } },
      },
    },
    {
      name: "Paradise Resort",
      ids: PARADISE,
      program: {
        stadium: { retreat: { filter: { kind: "byName", name: "Psyduck" }, discount: 1 } },
      },
    },
  ];

  it("eleven texts / fifteen printings, each pinned by toEqual and shared by its reprints", () => {
    expect(ROWS).toHaveLength(11);
    expect(ROWS.reduce((n, r) => n + r.ids.length, 0)).toBe(15);
    for (const { name, ids, program } of ROWS) {
      const first = programFor(ids[0] as string);
      expect(first, name).toEqual(program);
      for (const id of ids) {
        expect(programFor(id), id).toBe(first);
        expect(POOL[id]?.name, id).toBe(name);
        expect(POOL[id]?.effect, id).toBe(TEXT[name]);
      }
    }
  });

  it("the Tools attach from hand and the Stadiums play from hand (none is TRAINER_NOT_SIMULATED)", () => {
    for (const id of [COUNTER_GAIN[0], HOPS_BAND, BANGLE, BALLOON, RESCUE[0], GEMSTONE]) {
      let board = table();
      const ensured = ensureInDeck(board, "p1", id);
      const side = ensured.players.p1;
      const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
      board = {
        ...ensured,
        players: {
          ...ensured.players,
          p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
        },
      };
      const { state } = mustApply(board, {
        type: "attachTool",
        seat: "p1",
        uid,
        target: { spot: "active" },
      });
      expect(body(state, "p1").tools, id).toEqual([uid]);
    }
    for (const id of [FML, GRANITE, POSTWICK, NS_CASTLE, PARADISE[0]]) {
      const ensured = ensureInDeck(table(), "p1", id);
      const side = ensured.players.p1;
      const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
      const board = {
        ...ensured,
        players: {
          ...ensured.players,
          p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
        },
      };
      const { state } = mustApply(board, { type: "playTrainer", seat: "p1", uid });
      expect(state.stadium, id).toEqual({ uid, owner: "p1" });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §2 — Counter Gain: {C} less while YOU have more Prizes remaining (R-T2)", () => {
  it("6 remaining against 5: the holder's {C}{C}{C} costs {C}{C}", () => {
    const state = tool(p1Ahead(table()), "p1", "active", COUNTER_GAIN[0]);
    expect(cost(state)).toEqual(["Colorless", "Colorless"]);
    expect(toolAttackCostDiscount(state, body(state, "p1"))).toBe(1);
  });

  it("a TIE discounts nothing — the comparison is strict", () => {
    const state = tool(table(), "p1", "active", COUNTER_GAIN[1]);
    expect(state.players.p1.prizes.length).toBe(state.players.p2.prizes.length);
    expect(cost(state)).toEqual([...CCC]);
  });

  it("FEWER remaining discounts nothing", () => {
    const state = tool(setPrizes(table(), "p1", 5), "p1", "active", COUNTER_GAIN[0]);
    expect(cost(state)).toEqual([...CCC]);
  });

  it("\"you\" is the HOLDER's controller — p2's Counter Gain reads p2's count, on p1's turn", () => {
    let state = tool(setPrizes(table(), "p1", 5), "p2", "active", COUNTER_GAIN[0]);
    expect(cost(state, "p2")).toEqual(["Colorless", "Colorless"]);
    state = tool(p1Ahead(table()), "p2", "active", COUNTER_GAIN[0]);
    expect(cost(state, "p2")).toEqual([...CCC]);
  });

  it("a typed symbol is never removed — {F}{F} stays {F}{F}", () => {
    const state = tool(p1Ahead(table()), "p1", "active", COUNTER_GAIN[0]);
    expect(cost(state, "p1", ["Fighting", "Fighting"])).toEqual(["Fighting", "Fighting"]);
  });

  it("a {C}{C}{C} attack is PAYABLE with TWO Energy (attack.ts reads the same cost)", () => {
    const two = attachFromDeck(
      ensureInDeck(p1Ahead(table(BIG)), "p1", "fix-energy"),
      "p1",
      "fix-energy",
      1,
    );
    expect(body(two, "p1").energy).toHaveLength(2);
    expect(applyAction(two, { type: "attack", seat: "p1", index: 0 }).ok).toBe(false);
    expect(dealt(tool(two, "p1", "active", COUNTER_GAIN[0])).dealt).toBe(60);
  });

  it("R-T1 — a §9 lock over the holder leaves the Tool's {C} standing", () => {
    const state = lockP1(tool(p1Ahead(table()), "p1", "active", COUNTER_GAIN[0]));
    expect(cost(state)).toEqual(["Colorless", "Colorless"]);
  });

  it("R-T1 — and silences the HOLDER's own printed discount beside it (Radiant Charizard)", () => {
    // p2 has taken 2 (4 remaining), p1 has 6 remaining: Excited Heart −2, Counter Gain −1.
    const FIRE = ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"];
    let state = setPrizes(table(RADIANT_CHARIZARD), "p2", 4);
    expect(cost(state, "p1", FIRE)).toEqual(["Fire", "Colorless", "Colorless"]);
    state = tool(state, "p1", "active", COUNTER_GAIN[0]);
    expect(cost(state, "p1", FIRE)).toEqual(["Fire", "Colorless"]);
    const locked = lockP1(state);
    expect(cost(locked, "p1", FIRE)).toEqual(["Fire", "Colorless", "Colorless", "Colorless"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §3 — Hop's Choice Band: {C} less on the HOLDER, +30 on YOUR ACTIVE (R-T3)", () => {
  it("on a Hop's Pokémon: {C} less, and its attack does +30 (before W/R)", () => {
    const state = tool(table(HOP), "p1", "active", HOPS_BAND);
    expect(cost(state)).toEqual(["Colorless", "Colorless"]);
    const row = dealt(state);
    expect(row.bonus).toBe(30);
    expect(row.dealt).toBe(80);
  });

  it("on a non-Hop's Pokémon: nothing at all", () => {
    const state = tool(table(PLAIN), "p1", "active", HOPS_BAND);
    expect(cost(state)).toEqual([...CCC]);
    const row = dealt(state);
    expect(row.bonus).toBeUndefined();
    expect(row.dealt).toBe(50);
  });

  it("the cost half is matched on the HOLDER — a Benched Hop's holder is discounted too", () => {
    const state = tool(table(PLAIN, [HOP]), "p1", 0, HOPS_BAND);
    expect(toolAttackCostDiscount(state, body(state, "p1", 0))).toBe(1);
    expect(toolAttackCostDiscount(state, body(state, "p1"))).toBe(0);
  });

  it("the holder filter is LIVE — the Band on a Hop's body evolved out of the noun stops discounting", () => {
    let state = tool(table(HOP), "p1", "active", HOPS_BAND);
    const active = body(state, "p1");
    const evo = ensureInDeck(state, "p1", HOP_EVO);
    const uid = evo.players.p1.deck.find((u) => evo.cardIdByUid[u] === HOP_EVO) as string;
    state = {
      ...evo,
      players: {
        ...evo.players,
        p1: {
          ...evo.players.p1,
          deck: evo.players.p1.deck.filter((u) => u !== uid),
          active: { ...active, stack: [...active.stack, uid] },
        },
      },
    };
    expect(cost(state)).toEqual([...CCC]);
  });

  it("R-T1 — under a §9 lock both halves stand", () => {
    const state = lockP1(tool(table(HOP), "p1", "active", HOPS_BAND));
    expect(cost(state)).toEqual(["Colorless", "Colorless"]);
    expect(attackerPreWRBonus(state, body(state, "p1"), "p1", cardOf(TING_LU))).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §4 — Brave Bangle: +30 to an ex, only on a holder with no Rule Box", () => {
  it("a plain holder hits an ex for +30", () => {
    const row = dealt(tool(table(PLAIN, [], WALL_EX), "p1", "active", BANGLE));
    expect(row.bonus).toBe(30);
    expect(row.dealt).toBe(80);
  });

  it("…and a non-ex, and a Pokémon V, for nothing", () => {
    expect(dealt(tool(table(PLAIN, [], WALL), "p1", "active", BANGLE)).dealt).toBe(50);
    expect(dealt(tool(table(PLAIN, [], WALL_V), "p1", "active", BANGLE)).dealt).toBe(50);
  });

  it("an ex HOLDER gets nothing — the entry is never pushed by the fold", () => {
    const state = tool(table(EX_BODY, [], WALL_EX), "p1", "active", BANGLE);
    expect(passivesOf(state, body(state, "p1")).targetConditionalDamageBonusBeforeWR).toEqual([]);
    expect(dealt(state).dealt).toBe(50);
    const plain = tool(table(PLAIN, [], WALL_EX), "p1", "active", BANGLE);
    expect(passivesOf(plain, body(plain, "p1")).targetConditionalDamageBonusBeforeWR).toHaveLength(
      1,
    );
  });

  it("R-T1 — a §9 lock over the holder leaves the +30 standing", () => {
    const state = lockP1(tool(table(PLAIN, [], WALL_EX), "p1", "active", BANGLE));
    expect(attackerPreWRBonus(state, body(state, "p1"), "p1", cardOf(WALL_EX))).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §5 — Air Balloon: {C}{C} less, inside the one floored sum", () => {
  it("3 → 1, and 2 → 0 (floored, never negative)", () => {
    expect(retreat(tool(table(PLAIN), "p1", "active", BALLOON))).toBe(1);
    const state = tool(table(HOP), "p1", "active", BALLOON);
    expect(retreat(state)).toBe(0);
    expect(toolRetreatDiscount(state, body(state, "p1"))).toBe(2);
  });

  it("it is a TERM, so it offsets a surcharge before the floor (Gemstone + Balloon on a 2)", () => {
    let state = tool(table(HOP), "p1", "active", BALLOON);
    state = tool(state, "p1", "active", GEMSTONE);
    expect(retreat(state)).toBe(1);
  });

  it("R-T1 — a §9 lock over the holder leaves it standing", () => {
    expect(retreat(lockP1(tool(table(PLAIN), "p1", "active", BALLOON)))).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §6 — Rescue Board: {C} less, and FREE at 30 remaining HP or less (R-RB)", () => {
  const board = (damage: number) =>
    setDamage(tool(table(PLAIN), "p1", "active", RESCUE[0]), "p1", damage);

  it("full HP: 3 → 2", () => {
    expect(retreat(board(0))).toBe(2);
    expect(toolFreesRetreat(board(0), body(board(0), "p1"))).toBe(false);
  });

  it("40 remaining: still 2; 30 remaining: FREE; 10 remaining: FREE", () => {
    expect(retreat(board(160))).toBe(2);
    expect(retreat(board(170))).toBe(0);
    expect(retreat(board(190))).toBe(0);
  });

  it("the free tier BEATS a surcharge the −1 could not absorb (Gemstone + Wasteland)", () => {
    let state = tool(board(170), "p1", "active", GEMSTONE);
    state = stadium(state, WASTELAND);
    expect(retreat(state)).toBe(0);
    expect(retreat(setDamage(state, "p1", 0))).toBe(4);
  });

  it("LIVE — healed back out of the window, the cost returns", () => {
    expect(retreat(setDamage(board(170), "p1", 100))).toBe(2);
  });

  it("R-T1 — a §9 lock leaves both halves standing", () => {
    expect(retreat(lockP1(board(0)))).toBe(2);
    expect(retreat(lockP1(board(160)))).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §7 — Gravity Gemstone: BOTH Actives {C} more, per Gemstone, only while Active (R-GG)", () => {
  it("on p1's Active: p1's Active AND p2's Active are taxed, the Bench is not", () => {
    const state = tool(table(PLAIN, [HOP], WALL), "p1", "active", GEMSTONE);
    expect(retreat(state)).toBe(4);
    expect(retreat(state, "p2")).toBe(3);
    expect(retreat(state, "p1", 0)).toBe(2);
    expect(activeRetreatSurcharge(state, body(state, "p1", 0))).toBe(0);
  });

  it("a BENCHED holder taxes nothing", () => {
    const state = tool(table(PLAIN, [HOP], WALL), "p1", 0, GEMSTONE);
    expect(retreat(state)).toBe(3);
    expect(retreat(state, "p2")).toBe(2);
    expect(retreat(state, "p1", 0)).toBe(2);
  });

  it("stacks per Gemstone — one on each Active taxes both by {C}{C}", () => {
    let state = tool(table(PLAIN, [], WALL), "p1", "active", GEMSTONE);
    state = tool(state, "p2", "active", GEMSTONE);
    expect(retreat(state)).toBe(5);
    expect(retreat(state, "p2")).toBe(4);
  });

  it("not §9-gated — a locked holder still taxes both", () => {
    const state = tool(table(PLAIN), "p1", "active", GEMSTONE);
    const locked = lockP1(state);
    expect(retreat(locked)).toBe(4);
    expect(retreat(locked, "p2")).toBe(5); // Ting-Lu ex prints 4
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §8 — Full Metal Lab: {M} Pokémon take 30 less, both sides, both scopes (R-ST)", () => {
  it("p1 hits a {M} Active for 50 − 30 = 20", () => {
    const row = dealt(stadium(table(PLAIN, [], METAL), FML));
    expect(row.reduction).toBe(30);
    expect(row.dealt).toBe(20);
  });

  it("a non-{M} Active takes the full 50", () => {
    expect(dealt(stadium(table(PLAIN, [], WALL), FML)).dealt).toBe(50);
  });

  it("BOTH sides — p1's own {M} Active is shielded too, whoever owns the Stadium", () => {
    const state = stadium(table(METAL), FML, "p2");
    expect(seatDamageReduction(state, body(state, "p1"), "all", "p2")).toBe(30);
    expect(seatDamageReduction(state, body(state, "p1"), "all", "p1")).toBe(0);
  });

  it("R-ST — Feint Attack's `othersOnly` KEEPS it (a Stadium is no effect on that Pokémon)", () => {
    const state = stadium(table(PLAIN, [], METAL), FML);
    expect(seatDamageReduction(state, body(state, "p2"), "othersOnly", "p1")).toBe(30);
    expect(seatDamageReduction(state, body(state, "p2"), "all", "p1")).toBe(30);
  });

  it("R-ST2 — a §9 lock over the damaged body does not reach it", () => {
    const state = lockP1(stadium(table(METAL), FML));
    expect(seatDamageReduction(state, body(state, "p1"), "all", "p2")).toBe(30);
  });

  it("a SPREAD onto a benched {M} is reduced too — which makes Ting-Lu's spread-THEN-discard order observable", () => {
    const program = deriveAttackEffect(
      "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    if (program === null) throw new Error("the sentence derives");
    const board = stadium(table(PLAIN, [], WALL, [METAL, WALL]), FML);
    const run = (ops: readonly EffectOp[]) => {
      const result = runProgram(board, ops, { seat: "p1", invokedBy: "attack" }, []);
      if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
      return result.state;
    };
    const printed = run(program);
    expect(printed.stadium).toBeNull();
    expect(printed.players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
    // The CONTROL: the same two ops in the SWAPPED order pay the {M} body the full 30.
    const gate = program[0];
    if (gate?.op !== "conditionGate") throw new Error("expected the Stadium gate");
    const swapped = run([...gate.then].reverse());
    expect(swapped.players.p2.bench.map((b) => b.damage)).toEqual([30, 30]);
  });

  it("R-ST3 — p1's OWN bench-wide spread onto its benched {M} is NOT reduced (both ways)", () => {
    const own = stadium(table(PLAIN, [METAL, WALL]), FML);
    expect(ownSpread(own).players.p1.bench.map((b) => b.damage)).toEqual([30, 30]);
    expect(ownSpread(table(PLAIN, [METAL, WALL])).players.p1.bench.map((b) => b.damage)).toEqual([
      30, 30,
    ]);
    // The opponent-directed twin of the same sentence, on the same Stadium: reduced.
    const across = stadium(table(PLAIN, [], WALL, [METAL, WALL]), FML);
    expect(oppSpread(across).players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
  });

  it("R-ST3 — p1's OWN single-target bench hit (`placeSnipe`'s own arm) is NOT reduced (both ways)", () => {
    const own = stadium(table(PLAIN, [METAL]), FML);
    expect(ownSnipe(own).players.p1.bench.map((b) => b.damage)).toEqual([40]);
    const across = stadium(table(PLAIN, [], WALL, [METAL]), FML);
    expect(oppSnipe(across).players.p2.bench.map((b) => b.damage)).toEqual([10]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §9 — Granite Cave: Steven's Pokémon take 30 less", () => {
  it("a Steven's Active takes 20; a non-Steven's takes 50", () => {
    expect(dealt(stadium(table(PLAIN, [], STEVEN), GRANITE)).dealt).toBe(20);
    expect(dealt(stadium(table(PLAIN, [], WALL), GRANITE)).dealt).toBe(50);
  });

  it("BOTH sides, and not §9-gated", () => {
    const state = stadium(table(STEVEN), GRANITE, "p2");
    expect(seatDamageReduction(state, body(state, "p1"), "all", "p2")).toBe(30);
    const locked = lockP1(state);
    expect(seatDamageReduction(locked, body(locked, "p1"), "othersOnly", "p2")).toBe(30);
  });

  it("R-ST3 — p1's OWN spread onto its benched Steven's Pokémon is NOT reduced", () => {
    const board = stadium(table(PLAIN, [STEVEN, WALL]), GRANITE);
    expect(ownSpread(board).players.p1.bench.map((b) => b.damage)).toEqual([30, 30]);
    expect(seatDamageReduction(board, body(board, "p1", 0), "all", "p1")).toBe(0);
    expect(seatDamageReduction(board, body(board, "p1", 0), "all", "p2")).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §10 — Postwick: Hop's Pokémon do 30 more, matched on the ATTACKER", () => {
  it("a Hop's attacker does 80; a plain one does 50", () => {
    expect(dealt(stadium(table(HOP), POSTWICK)).dealt).toBe(80);
    expect(dealt(stadium(table(PLAIN), POSTWICK)).dealt).toBe(50);
  });

  it("a Hop's DEFENDER earns a plain attacker nothing", () => {
    const state = stadium(table(PLAIN), POSTWICK);
    expect(seatPreWRDamageBonus(state, "p1", cardOf(PLAIN), cardOf(HOP))).toBe(0);
  });

  it("BOTH sides — p2's Hop's attacker is paid too", () => {
    const state = stadium(table(), POSTWICK);
    expect(seatPreWRDamageBonus(state, "p2", cardOf(HOP), cardOf(PLAIN))).toBe(30);
  });

  it('stacks with Hop\'s Snorlax "Extra Helpings" (noStack keys an Ability name) and the Band', () => {
    let state = stadium(table(HOP_SNORLAX), POSTWICK);
    expect(dealt(state).bonus).toBe(60);
    state = tool(state, "p1", "active", HOPS_BAND);
    expect(dealt(state).bonus).toBe(90);
  });

  it("R-ST2 — a §9 lock over the attacker leaves the Stadium's +30", () => {
    const state = lockP1(stadium(table(HOP), POSTWICK));
    expect(attackerPreWRBonus(state, body(state, "p1"), "p1", cardOf(TING_LU))).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §11 — N's Castle: N's Pokémon have no Retreat Cost, at ANY stage (R-NC)", () => {
  it("an N's Basic 2 → 0 and an N's Stage 1 3 → 0; a plain body keeps its 3", () => {
    let state = stadium(table(N_BASIC, [N_STAGE1]), NS_CASTLE);
    expect(retreat(state)).toBe(0);
    expect(retreat(state, "p1", 0)).toBe(0);
    state = stadium(table(PLAIN), NS_CASTLE);
    expect(retreat(state)).toBe(3);
  });

  it("BOTH sides, and it beats a Gemstone surcharge (the free tier)", () => {
    let state = stadium(table(PLAIN, [], N_STAGE1), NS_CASTLE);
    expect(retreat(state, "p2")).toBe(0);
    state = tool(state, "p1", "active", GEMSTONE);
    expect(retreat(state, "p2")).toBe(0);
    expect(retreat(state)).toBe(4);
  });

  it("not §9-gated — a locked N's Active still retreats free", () => {
    expect(retreat(lockP1(stadium(table(N_BASIC), NS_CASTLE)))).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §12 — Paradise Resort: each Psyduck's Retreat Cost {C} less", () => {
  it("Psyduck 2 → 1 on both sides; Golduck and a plain body are untouched", () => {
    const state = stadium(table(PSYDUCK, [GOLDUCK, PLAIN], PSYDUCK), PARADISE[1]);
    expect(retreat(state)).toBe(1);
    expect(retreat(state, "p2")).toBe(1);
    expect(retreat(state, "p1", 0)).toBe(2);
    expect(retreat(state, "p1", 1)).toBe(3);
  });

  it("not §9-gated", () => {
    expect(retreat(lockP1(stadium(table(PSYDUCK), PARADISE[0])))).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D558 §13 — Beach Court and Calamitous Wasteland stay BASIC-ONLY (the per-term gate)", () => {
  it("a Stage 1 keeps its printed 2 under Beach Court AND under Wasteland", () => {
    expect(retreat(stadium(table(PLAIN, [STAGE1]), BEACH_COURT), "p1", 0)).toBe(2);
    expect(retreat(stadium(table(PLAIN, [STAGE1]), WASTELAND), "p1", 0)).toBe(2);
  });

  it("the CONTROL — a Basic with the same printed 2 moves both ways", () => {
    expect(retreat(stadium(table(HOP), BEACH_COURT))).toBe(1);
    expect(retreat(stadium(table(HOP), WASTELAND))).toBe(3);
  });
});
