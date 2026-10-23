import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { weaknessOf } from "./cards";
import {
  disabledAbilityUids,
  passivesOf,
  seatDamageReduction,
  seatPreWRDamageBonus,
  seatWeaknessRewrite,
} from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  must,
  ensureInDeck,
} from "./testFixtures";

const LILLIE = ["sv09-056", "sv09-173", "sv09-184", "svp-195"] as const;
const FLUTTER = ["sv05-078", "sv08.5-043", "svp-097"] as const;
const GASTRODON = "sv08-107";
const ORTHWORM = ["sv07-110", "sv07-162"] as const;
const MARACTUS = ["sv09-008", "sv09-160"] as const;
const KLINKLANG = ["sv10.5b-063", "sv10.5b-141"] as const;
const REGIROCK = "sv09-082";
const SERPERIOR = "sv10.5b-003";
const TINKATON = "sv02-105"; // Stage 2, "Gather Materials" (activated, not Active-only)
const KLEFKI = "sv01-096";
const FLORGES = "sv01-093"; // Stage 2, "Blooming Garden"

const FAIRY_ZONE_TEXT =
  "The Weakness of each of your opponent's {N} Pokémon in play is now {P}. (Apply Weakness as ×2.)";
const FLUTTERING_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.";
const STICKY_BIND_TEXT =
  "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities.";
const BENCH_CLAUSE = "(Don't apply Weakness and Resistance for Benched Pokémon.)";

const lillie = (id: string): Card =>
  battler(id, {
    name: "Lillie's Clefairy ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    weaknesses: id === "svp-195" ? null : [{ type: "Metal", value: "×2" }],
    abilities: [{ type: "Ability", name: "Fairy Zone", effect: FAIRY_ZONE_TEXT }],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Full Moon Rondo",
        damage: "20+",
        effect:
          "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
      },
    ],
  });
const flutter = (id: string): Card =>
  battler(id, {
    name: "Flutter Mane",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [{ type: "Ability", name: "Midnight Fluttering", effect: FLUTTERING_TEXT }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Hex Hurl",
        damage: 90,
        effect: "Put 2 damage counters on your opponent's Benched Pokémon in any way you like.",
      },
    ],
  });

const STRIKE = { cost: ["Colorless"], name: "Strike", damage: 50 };
const PICK_OFF = {
  cost: ["Colorless"],
  name: "Pick Off",
  effect: `This attack does 30 damage to 1 of your opponent's Pokémon. ${BENCH_CLAUSE}`,
};
const CLEAN = {
  cost: ["Colorless"],
  name: "Clean Strike",
  damage: 50,
  effect: "This attack's damage isn't affected by Weakness or Resistance.",
};
const SHRED = {
  cost: ["Colorless"],
  name: "Shred",
  damage: 50,
  effect: "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
};
const ATTACKS = [STRIKE, PICK_OFF, CLEAN, SHRED];
const [I_STRIKE, I_PICK, I_CLEAN, I_SHRED] = [0, 1, 2, 3];

const PSY = "d559-psy"; // a {P} attacker — the type Fairy Zone names
const NORM = "d559-norm";
const GRASSY = "d559-grassy"; // a {G} attacker — the printed Weakness the rewrite REPLACES
const DRAGON = "d559-dragon";
const DRAGON_GRASS = "d559-dragon-grass";
const DRAGON_RES = "d559-dragon-res";
const WALL = "d559-wall"; // a {C} body — the non-Dragon control

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(LILLIE.map((id) => [id, lillie(id)])),
  ...Object.fromEntries(FLUTTER.map((id) => [id, flutter(id)])),
  [GASTRODON]: battler(GASTRODON, {
    name: "Gastrodon",
    stage: "Stage1",
    evolveFrom: "Shellos",
    hp: 130,
    retreat: 3,
    types: ["Fighting"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [{ type: "Ability", name: "Sticky Bind", effect: STICKY_BIND_TEXT }],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Mud Shot", damage: 80 }],
  }),
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
  }),
  [SERPERIOR]: battler(SERPERIOR, {
    name: "Serperior ex",
    stage: "Stage2",
    evolveFrom: "Servine",
    hp: 320,
    retreat: 2,
    types: ["Grass"],
    abilities: [
      {
        type: "Ability",
        name: "Regal Cheer",
        effect:
          "Attacks used by your Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      },
    ],
  }),
  [PSY]: battler(PSY, {
    name: "D559 Psy",
    hp: 300,
    retreat: 1,
    types: ["Psychic"],
    attacks: ATTACKS,
  }),
  [NORM]: battler(NORM, {
    name: "D559 Norm",
    hp: 300,
    retreat: 1,
    types: ["Colorless"],
    attacks: ATTACKS,
  }),
  [GRASSY]: battler(GRASSY, {
    name: "D559 Grassy",
    hp: 300,
    retreat: 1,
    types: ["Grass"],
    attacks: ATTACKS,
  }),
  [DRAGON]: battler(DRAGON, {
    name: "D559 Drake",
    hp: 900,
    retreat: 2,
    types: ["Dragon"],
    weaknesses: null,
  }),
  [DRAGON_GRASS]: battler(DRAGON_GRASS, {
    name: "D559 Moss Drake",
    hp: 900,
    retreat: 2,
    types: ["Dragon"],
    weaknesses: [{ type: "Grass", value: "×2" }],
  }),
  [DRAGON_RES]: battler(DRAGON_RES, {
    name: "D559 Warded Drake",
    hp: 900,
    retreat: 2,
    types: ["Dragon"],
    weaknesses: null,
    resistances: [{ type: "Psychic", value: "-30" }],
  }),
  [WALL]: battler(WALL, {
    name: "D559 Wall",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: null,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [LILLIE[0]]: 1,
  [LILLIE[1]]: 1,
  [LILLIE[2]]: 1,
  [LILLIE[3]]: 1,
  [FLUTTER[0]]: 1,
  [FLUTTER[1]]: 1,
  [FLUTTER[2]]: 1,
  [GASTRODON]: 1,
  [KLINKLANG[0]]: 1,
  [KLINKLANG[1]]: 1,
  [ORTHWORM[0]]: 1,
  [MARACTUS[0]]: 1,
  [REGIROCK]: 1,
  [SERPERIOR]: 1,
  [TINKATON]: 1,
  [KLEFKI]: 1,
  [FLORGES]: 1,
  [PSY]: 2,
  [NORM]: 2,
  [GRASSY]: 1,
  [DRAGON]: 2,
  [DRAGON_GRASS]: 1,
  [DRAGON_RES]: 1,
  [WALL]: 3,
  "fix-metal-energy": 6,
  "fix-energy": 25,
});

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

/** `id` as `seat`'s Active — kept if setup already put it there (a lone copy cannot be
    pulled from the deck), else pulled through `ensureInDeck`. */
function seatActive(state: GameState, seat: Seat, id: string): GameState {
  const active = state.players[seat].active;
  const top = active?.stack[active.stack.length - 1];
  if (top !== undefined && state.cardIdByUid[top] === id) return state;
  return setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
}

/** p1's turn 2 with `active` / `bench` for p1 and `oppActive` / `oppBench` for p2, and one
    Colorless Energy on p1's Active (every attack here costs {C}). */
function table(
  active: string,
  bench: readonly string[],
  oppActive: string,
  oppBench: readonly string[] = [],
): GameState {
  let state = opened(5591);
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return attachFromDeck(ensureInDeck(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
}

function body(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}
function uidOf(state: GameState, seat: Seat, spot: "active" | number = "active"): string {
  const b = body(state, seat, spot);
  return b.stack[b.stack.length - 1] as string;
}
const cardOf = (id: string) => POOL[id] as Card;

function dealtBy(state: GameState, index: number): number | undefined {
  const { events } = mustApply(state, { type: "attack", seat: "p1", index });
  return (
    events.find((e) => e.type === "DAMAGE_DEALT") as
      | Extract<GameEvent, { type: "DAMAGE_DEALT" }>
      | undefined
  )?.dealt;
}

/** The snipe site (`snipeActive`): Pick Off, answered onto p2's ACTIVE. */
function snipedActive(state: GameState): number | undefined {
  const declared = mustApply(state, { type: "attack", seat: "p1", index: I_PICK });
  const parked = declared.state;
  expect(parked.phase.kind).toBe("effect:choose"); // every snipe board fields a p2 Bench
  const done = mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
  });
  return (
    done.events.find((e) => e.type === "DAMAGE_DEALT") as
      | Extract<GameEvent, { type: "DAMAGE_DEALT" }>
      | undefined
  )?.dealt;
}

/** TEST SURGERY — rewrite `seat`'s Active with `patch` (turn-neutral). */
function patchActive(state: GameState, seat: Seat, patch: Partial<InPlayPokemon>): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...body(state, seat), ...patch } } },
  };
}
const retyped = (state: GameState, seat: Seat = "p2") =>
  patchActive(state, seat, { weaknessRetype: { turn: state.turn, type: "Colorless" } });

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §1 — the seven registry rows: 15 printings, 7 objects, NO `attack` key", () => {
  const ROWS: readonly { name: string; ids: readonly string[]; passive: unknown }[] = [
    {
      name: "Lillie's Clefairy ex",
      ids: LILLIE,
      passive: { opponentWeaknessRewrite: { targetType: "Dragon", weaknessType: "Psychic" } },
    },
    {
      name: "Flutter Mane",
      ids: FLUTTER,
      passive: {
        disableAbilities: {
          side: "opponent",
          requiresActive: true,
          targetZone: "active",
          exemptAbilityNamed: "Midnight Fluttering",
        },
      },
    },
    {
      name: "Gastrodon",
      ids: [GASTRODON],
      passive: {
        disableAbilities: {
          side: "both",
          stage: "Stage2",
          sourceOnBench: true,
          targetZone: "bench",
        },
      },
    },
    {
      name: "Orthworm ex",
      ids: ORTHWORM,
      passive: { damageAttacker: { amount: 20, perAttachedEnergy: "Metal" } },
    },
    {
      name: "Maractus",
      ids: MARACTUS,
      passive: { damageAttackerOnKo: { amount: 60, activeOnly: true } },
    },
    {
      name: "Klinklang",
      ids: KLINKLANG,
      passive: { seatDamageReductionAfterWR: { amount: 20, beneficiaryHasEnergy: "Metal" } },
    },
    { name: "Regirock", ids: [REGIROCK], passive: { damageReductionAfterWRIfEnergy: 30 } },
  ];

  for (const row of ROWS) {
    it(`${row.name}: every printing maps to ONE object whose key set is exactly ["passive"]`, () => {
      const first = programFor(row.ids[0] as string);
      for (const id of row.ids) {
        expect(programFor(id), id).toBe(first); // the reprint idiom (D190b) — one object
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]); // attacks keep deriving
        expect(programFor(id)?.passive, id).toEqual(row.passive);
      }
      // …and the printed card the suite fields names the same Ability the program answers.
      expect(cardOf(row.ids[0] as string).name).toBe(row.name);
    });
  }

  it("15 ids on 7 distinct objects", () => {
    const ids = ROWS.flatMap((r) => r.ids);
    expect(ids.length).toBe(15);
    expect(new Set(ids.map((id) => programFor(id))).size).toBe(7);
  });

  it("the LOOK-ALIKES are not keyed: sv08-096 Flutter Mane (no Ability row — D569 keys its attack), sv10.5b-008/-093 Maractus, sv07-101 Klinklang (no Gear Coating row — D572 keys its in-hand Ability)", () => {
    for (const id of ["sv10.5b-008", "sv10.5b-093"]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(Object.keys(programFor("sv08-096") ?? {})).toEqual(["attack"]);
    expect(Object.keys(programFor("sv07-101") ?? {})).toEqual(["benchFromHand"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §2 — Fairy Zone at the MAIN HIT (attack.ts): R-FZ4, the granted ×2", () => {
  it("R-FZ4: a Dragon printing NO Weakness takes ×2 from a {P} attacker → 100", () => {
    expect(dealtBy(table(PSY, [LILLIE[0]], DRAGON), I_STRIKE)).toBe(100);
  });
  it("…the same board without Lillie's Clefairy ex: not weak → 50", () => {
    expect(dealtBy(table(PSY, [], DRAGON), I_STRIKE)).toBe(50);
  });
  it("a non-{P} attacker gets no ×2 → 50", () => {
    expect(dealtBy(table(NORM, [LILLIE[1]], DRAGON), I_STRIKE)).toBe(50);
  });
  it("a non-Dragon defender is untouched → 50", () => {
    expect(dealtBy(table(PSY, [LILLIE[2]], WALL), I_STRIKE)).toBe(50);
  });
  it("Resistance is untouched: (50 × 2) − 30 = 70 on a {P}-resistant Dragon", () => {
    expect(dealtBy(table(PSY, [LILLIE[3]], DRAGON_RES), I_STRIKE)).toBe(70);
  });
  it("the rewrite REPLACES the printed entry: a ×2 {G} Dragon is no longer {G}-weak → 50…", () => {
    expect(dealtBy(table(GRASSY, [LILLIE[0]], DRAGON_GRASS), I_STRIKE)).toBe(50);
    expect(dealtBy(table(GRASSY, [], DRAGON_GRASS), I_STRIKE)).toBe(100);
  });
  it("…and is {P}-weak instead → 100", () => {
    expect(dealtBy(table(PSY, [LILLIE[0]], DRAGON_GRASS), I_STRIKE)).toBe(100);
  });
  it("Fairy Zone on the DEFENDER's own side does nothing (\"your opponent's\") → 50", () => {
    expect(dealtBy(table(PSY, [], DRAGON, [LILLIE[0]]), I_STRIKE)).toBe(50);
  });
  it("an ACTIVE Clefairy is a source too (no zone clause) — at the scan", () => {
    const state = table(LILLIE[0], [], DRAGON);
    expect(seatWeaknessRewrite(state, "p2", cardOf(DRAGON))).toBe("Psychic");
    expect(seatWeaknessRewrite(state, "p1", cardOf(DRAGON))).toBeNull(); // the other direction
    expect(seatWeaknessRewrite(state, "p2", cardOf(WALL))).toBeNull();
    expect(seatWeaknessRewrite(state, "p2", undefined)).toBeNull();
  });
});

describe("D559 §3 — the null paths win (R-FZ2), suppression drops it (R-FZ3), the retype re-points it (R-FZ1)", () => {
  it("R-FZ2 (UNRULED): Blooming Garden on the defender's side — no Weakness → 50", () => {
    expect(dealtBy(table(PSY, [LILLIE[0]], DRAGON, [FLORGES]), I_STRIKE)).toBe(50);
  });
  it("R-FZ2: D432's installed no-Weakness bar (constructed) → 50", () => {
    const state = table(PSY, [LILLIE[0]], DRAGON);
    expect(dealtBy(patchActive(state, "p2", { noWeaknessTurn: state.turn }), I_STRIKE)).toBe(50);
  });
  it('R-FZ2: "isn\'t affected by Weakness or Resistance" → 50', () => {
    expect(dealtBy(table(PSY, [LILLIE[0]], DRAGON), I_CLEAN)).toBe(50);
  });
  it("R-FZ3: \"isn't affected by any effects on your opponent's Active Pokémon\" drops the rewrite → 50", () => {
    expect(dealtBy(table(PSY, [LILLIE[0]], DRAGON), I_SHRED)).toBe(50);
  });
  it("R-FZ1 (UNRULED, main hit): rewrite first, THEN the retype — {C}×2: a {C} attacker 100…", () => {
    expect(dealtBy(retyped(table(NORM, [LILLIE[0]], DRAGON)), I_STRIKE)).toBe(100);
  });
  it("…and the {P} attacker is NOT weak any more → 50", () => {
    expect(dealtBy(retyped(table(PSY, [LILLIE[0]], DRAGON)), I_STRIKE)).toBe(50);
  });
  it("…the control: the retype ALONE on a no-Weakness Dragon grants nothing (D552 R2) → 50", () => {
    expect(dealtBy(retyped(table(NORM, [], DRAGON)), I_STRIKE)).toBe(50);
  });
  it("cards.ts `weaknessOf`: the rewrite replaces, the retype re-points the rewritten entry", () => {
    const psy = cardOf(PSY);
    const norm = cardOf(NORM);
    const grassy = cardOf(GRASSY);
    const mossDrake = cardOf(DRAGON_GRASS);
    expect(weaknessOf(psy, cardOf(DRAGON))).toBeNull();
    expect(weaknessOf(psy, cardOf(DRAGON), null, "Psychic")).toEqual({ op: "multiply", amount: 2 });
    expect(weaknessOf(grassy, mossDrake, null, "Psychic")).toBeNull();
    expect(weaknessOf(grassy, mossDrake, null, null)).toEqual({ op: "multiply", amount: 2 });
    expect(weaknessOf(norm, cardOf(DRAGON), "Colorless", "Psychic")).toEqual({
      op: "multiply",
      amount: 2,
    });
    expect(weaknessOf(psy, cardOf(DRAGON), "Colorless", "Psychic")).toBeNull();
  });
});

describe("D559 §4 — Fairy Zone at the SNIPE SITE (`snipeActive`), on its OWN board", () => {
  it("a chosen 30 onto the Dragon Active is ×2 → 60", () => {
    expect(snipedActive(table(PSY, [LILLIE[0]], DRAGON, [WALL]))).toBe(60);
  });
  it("…without Lillie's Clefairy ex → 30", () => {
    expect(snipedActive(table(PSY, [], DRAGON, [WALL]))).toBe(30);
  });
  it("…Lillie's Clefairy ex on the DEFENDER's side → 30", () => {
    expect(snipedActive(table(PSY, [], DRAGON, [LILLIE[1]]))).toBe(30);
  });
  it("R-FZ1 (UNRULED, snipe): the retype re-points the rewrite — {C} 60, {P} 30", () => {
    expect(snipedActive(retyped(table(NORM, [LILLIE[0]], DRAGON, [WALL])))).toBe(60);
    expect(snipedActive(retyped(table(PSY, [LILLIE[0]], DRAGON, [WALL])))).toBe(30);
  });
  it("R-FZ2 at the snipe: Blooming Garden on the defender's side → 30", () => {
    expect(snipedActive(table(PSY, [LILLIE[0]], DRAGON, [FLORGES]))).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §5 — Midnight Fluttering: the opponent's ACTIVE, from the Active Spot, except itself", () => {
  it("an Active Flutter Mane silences the opposing Active and nothing else", () => {
    const state = table(FLUTTER[0], [LILLIE[0]], TINKATON, [LILLIE[1]]);
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p2"))).toBe(true); // the opposing Active (a Stage 2 — any stage)
    expect(locked.has(uidOf(state, "p2", 0))).toBe(false); // targetZone "active": not the Bench
    expect(locked.has(uidOf(state, "p1", 0))).toBe(false); // side "opponent": not its own side
    expect(locked.size).toBe(1);
  });
  it("a BENCHED Flutter Mane locks nothing (requiresActive)", () => {
    const state = table(PSY, [FLUTTER[0]], TINKATON);
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });
  it("the mirror: two Active Flutter Mane both keep Midnight Fluttering (the exemption by name)", () => {
    const state = table(FLUTTER[0], [], FLUTTER[1]);
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });
  it("the ACTIVATED read site: an Active Tinkaton opposite Flutter Mane refuses ABILITY_DISABLED", () => {
    const state = table(TINKATON, [], FLUTTER[0]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Gather Materials",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("ABILITY_DISABLED");
  });
  it("…and the same Tinkaton on the BENCH is accepted (the lock reaches the Active only)", () => {
    const state = table(PSY, [TINKATON], FLUTTER[0]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    expect(result.ok).toBe(true);
  });
  it("the PASSIVE read site: an opposing Active Flutter Mane silences an Active Orthworm ex, Maractus and Regirock", () => {
    const withMetal = (s: GameState) => attachFromDeck(s, "p1", "fix-metal-energy", 2);
    const orthOn = withMetal(table(ORTHWORM[0], [], FLUTTER[0]));
    const orthOff = withMetal(table(ORTHWORM[0], [], WALL));
    expect(passivesOf(orthOff, body(orthOff, "p1")).damageAttacker).toBe(40); // 2 {M} × 20
    expect(passivesOf(orthOn, body(orthOn, "p1")).damageAttacker).toBe(0);
    const maraOn = table(MARACTUS[0], [], FLUTTER[0]);
    const maraOff = table(MARACTUS[0], [], WALL);
    expect(passivesOf(maraOff, body(maraOff, "p1")).damageAttackerOnKo).toBe(60);
    expect(passivesOf(maraOn, body(maraOn, "p1")).damageAttackerOnKo).toBe(0);
    const rockOn = table(REGIROCK, [], FLUTTER[0]);
    const rockOff = table(REGIROCK, [], WALL);
    expect(passivesOf(rockOff, body(rockOff, "p1")).damageReductionAfterWR).toBe(30);
    expect(passivesOf(rockOn, body(rockOn, "p1")).damageReductionAfterWR).toBe(0);
  });
  it("…and an Active Lillie's Clefairy ex: Fairy Zone is OFF (the scan's §9 gate)", () => {
    const on = table(LILLIE[0], [], FLUTTER[0]);
    expect(disabledAbilityUids(on).has(uidOf(on, "p1"))).toBe(true);
    expect(seatWeaknessRewrite(on, "p2", cardOf(DRAGON))).toBeNull();
    const off = table(LILLIE[0], [], WALL);
    expect(seatWeaknessRewrite(off, "p2", cardOf(DRAGON))).toBe("Psychic");
  });
  it("the HUD redactor follows the same Set with no client diff: the Active Tinkaton row greys", () => {
    const phaseOf = (s: GameState) => {
      const phase = redactGame(s, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error("expected turn:action");
      return phase.abilities.find((row) => row.abilityName === "Gather Materials");
    };
    expect(phaseOf(table(TINKATON, [], FLUTTER[0]))?.disabled).toBe(true);
    expect(phaseOf(table(TINKATON, [], WALL))?.disabled).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §6 — Sticky Bind: from the Bench, BENCHED Stage 2 Pokémon, both sides", () => {
  it("a benched Gastrodon silences benched Stage 2 bodies on BOTH sides, and nothing else", () => {
    const state = table(TINKATON, [GASTRODON, KLINKLANG[0], LILLIE[0]], WALL, [SERPERIOR]);
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p1", 1))).toBe(true); // own benched Klinklang (Stage 2)
    expect(locked.has(uidOf(state, "p2", 0))).toBe(true); // opposing benched Serperior ex (Stage 2)
    expect(locked.has(uidOf(state, "p1"))).toBe(false); // an ACTIVE Stage 2 (targetZone "bench")
    expect(locked.has(uidOf(state, "p1", 2))).toBe(false); // a benched BASIC (stage "Stage2")
    expect(locked.has(uidOf(state, "p1", 0))).toBe(false); // Gastrodon itself (a Stage 1)
    expect(locked.size).toBe(2);
  });
  it("an ACTIVE Gastrodon locks nothing (sourceOnBench)", () => {
    const state = table(GASTRODON, [KLINKLANG[0]], WALL, [SERPERIOR]);
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });
  it("the ACTIVATED read site: a benched Stage 2 Tinkaton refuses ABILITY_DISABLED…", () => {
    const state = table(PSY, [TINKATON], WALL, [GASTRODON]);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("ABILITY_DISABLED");
  });
  it("…and is accepted with no Gastrodon in play", () => {
    const state = table(PSY, [TINKATON], WALL);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Gather Materials",
    });
    expect(result.ok).toBe(true);
  });
  it("a benched Serperior ex loses Regal Cheer — end to end, from the OPPONENT's Bench", () => {
    expect(dealtBy(table(PSY, [SERPERIOR], WALL), I_STRIKE)).toBe(70); // 50 + 20
    expect(dealtBy(table(PSY, [SERPERIOR], WALL, [GASTRODON]), I_STRIKE)).toBe(50);
    const locked = table(PSY, [SERPERIOR], WALL, [GASTRODON]);
    expect(seatPreWRDamageBonus(locked, "p1", cardOf(PSY))).toBe(0);
  });
  it("a benched Klinklang under a benched Gastrodon loses Gear Coating; an ACTIVE one keeps it", () => {
    const metalActive = (s: GameState) => attachFromDeck(s, "p1", "fix-metal-energy", 1);
    const benched = metalActive(table(PSY, [KLINKLANG[0], GASTRODON], WALL));
    expect(seatDamageReduction(benched, body(benched, "p1"), "all", "p2")).toBe(0);
    const benchedFree = metalActive(table(PSY, [KLINKLANG[0]], WALL));
    expect(seatDamageReduction(benchedFree, body(benchedFree, "p1"), "all", "p2")).toBe(20);
    const active = metalActive(table(KLINKLANG[0], [GASTRODON], WALL));
    expect(seatDamageReduction(active, body(active, "p1"), "all", "p2")).toBe(20);
  });
  it("the HUD redactor greys the benched Tinkaton row under Gastrodon, and only then", () => {
    const rowOf = (s: GameState) => {
      const phase = redactGame(s, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error("expected turn:action");
      return phase.abilities.find((row) => row.abilityName === "Gather Materials");
    };
    expect(rowOf(table(PSY, [TINKATON, GASTRODON], WALL))?.disabled).toBe(true);
    expect(rowOf(table(PSY, [TINKATON], WALL))?.disabled).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D559 §7 — R-LK1: lock-vs-lock stays UNGATED (both locks stay on), pinned on rotated Klefki ( D571: STRATIFIED now, R-LK2 — a MUTUAL pair still stays both-on)", () => {
  it("Klefki (Active) vs Flutter Mane (Active): each silences the other, and BOTH auras still bite", () => {
    const state = table(KLEFKI, [LILLIE[0]], FLUTTER[0], [LILLIE[1]]);
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p2"))).toBe(true); // Klefki's lock on the Basic Flutter Mane
    expect(locked.has(uidOf(state, "p1"))).toBe(true); // Flutter Mane's lock on the opposing Active
    // …and neither silenced source stopped locking: Klefki's lock still reaches every
    // other Basic on both Benches (by the printed rules a silenced Klefki would not).
    expect(locked.has(uidOf(state, "p1", 0))).toBe(true);
    expect(locked.has(uidOf(state, "p2", 0))).toBe(true);
  });
  it("R-LK1's argument, on the built legal pair: Gastrodon's lock never reaches Flutter Mane (a Basic), nor Flutter Mane's a benched Gastrodon", () => {
    const state = table(FLUTTER[0], [GASTRODON], FLUTTER[1], [GASTRODON]);
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });
  it('D571 — the tripwire FIRED: Iron Thorns ex "Initialization" is BUILT (and the stratified pass with it, `ironThornsD571.test.ts`); Team Rocket\'s Watchtower is BUILT (D566) and silences neither built lock source', () => {
    for (const id of ["sv06-077", "sv06-196", "sv08.5-032"]) {
      expect(programFor(id)?.passive?.disableAbilities).toEqual({
        side: "both",
        requiresActive: true,
        ruleBox: true,
        exemptBanner: "Future",
      });
    }
    expect(programFor("sv10-180")?.stadium?.disableAbilities).toEqual({
      side: "both",
      targetType: "Colorless",
    });
    const pair = table(FLUTTER[0], [GASTRODON], FLUTTER[1], [GASTRODON]);
    // TEST SURGERY: one deck uid re-labelled as the Watchtower and stood in the Stadium zone
    // (this suite's pool carries no Stadium card; `stadiumEffectsOf` reads the id alone).
    const towerUid = pair.players.p1.deck[0];
    if (towerUid === undefined) throw new Error("no deck uid to stand in the Stadium zone");
    const towered: GameState = {
      ...pair,
      cardIdByUid: { ...pair.cardIdByUid, [towerUid]: "sv10-180" },
      stadium: { uid: towerUid, owner: "p1" },
    };
    expect(disabledAbilityUids(towered)).toEqual(new Set());
  });
});
