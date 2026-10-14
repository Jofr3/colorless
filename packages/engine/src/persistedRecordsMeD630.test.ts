// 🆕🆕🆕 D630 — M1 of the Mega backlog: THE PERSISTED-RECORD BUNDLE, 8 texts / 13 `me` printings, and
// `MATCH_RECORD_VERSION` 43 → 44 (apps/api match.ts "43 → 44 AT D630", `recordKeysMigrationD630.test.ts`).
//
//   • Mega Heracross ex `me02-004` / `-108` "Juggernaut Horn" (100+) and Lycanroc `30th-085` / `-138` "Counter"
//     (10+): *"If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that
//     much more damage."* — the NEW `InPlayPokemon.attackDamageTaken`, written at the four §8.5 sites, read as
//     `DamageCountSource.attackDamageTakenLastTurnOnSelf` (R-JH1 ⚠️ UNRULED).
//   • Heatran `me05-007` "Lava Wall", Manectric `me05-024` / `-089` "Flashing Barrier", Deoxys `me04-033` "Psy
//     Protection": `preventDamage` on the NEW `AttackerClass.stage` members `burned` / `evolution` / `hasAbility`
//     (R-LVW1, R-PSY1 ⚠️ UNRULED).
//   • Bronzong `me05-064` "Metal Block": `reduceDamage` with the NEW `DamageReduction.fromClass`.
//   • Iron Defender `me01-118` / `me05-110` (Item): Jasmine's Gaze's op with the NEW `pokemonType`, on
//     `PlayerSide.sideDamageReduction` made a SUMMED list (R-ID1 ⚠️ UNRULED).
//   • Okidogi `me02.5-122` "Settle the Score": the NEW `PlayerSide.prizesTakenOnTurn` (flow.ts
//     `resolveTakePrizes`), read as `DamageCountSource.opponentPrizesTakenLastTurn` (R-STS1 ⚠️ UNRULED).
//   • Mabosstiff `me05-058` "Plunging Headbutt": the NEW op `exposeSelf` on D547's `damageVulnerability`
//     (no new key; R-PH1 ⚠️ UNRULED: summed with a live record of the same window).
//
// Texts byte for byte off the LOCAL D1 (2026-10-10, `legal_standard = 1`); driven on the real ids in a LOCAL
// `cardPool` (D275) in the suite's OWN 60-card deck (D270). Attack COSTS are dropped to `[]` on the local faces
// (no Energy is needed to drive a declaration); names, stages, HP, types, Weakness and Resistance are printed.

import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackDamageBonus, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion, formatElapsed, logFromEvents } from "./index";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  trainerCard,
} from "./testFixtures";
import { attackDamageTakenLastTurn, prizesTakenOnLastTurn, withAttackDamageTaken } from "./types";

// ── THE PRINTED TEXTS ──

const JUGGERNAUT =
  "If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage.";
const LAVA_WALL =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon.";
const FLASHING_BARRIER =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon.";
const PSY_PROTECTION =
  "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability.";
const METAL_BLOCK =
  "During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance).";
const SETTLE =
  "This attack does 60 more damage for each Prize card your opponent took during their last turn.";
const HEADBUTT =
  "During your opponent's next turn, this Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance).";
const IRON_DEFENDER_TEXT =
  "During your opponent's next turn, all of your {M} Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). (This includes new Pokémon that come into play.)";

const HERACROSS = "me02-004";
const LYCANROC = "30th-085";
const HEATRAN = "me05-007";
const MANECTRIC = "me05-024";
const DEOXYS = "me04-033";
const BRONZONG = "me05-064";
const OKIDOGI = "me02.5-122";
const MABOSSTIFF = "me05-058";
const IRON_DEFENDER = "me01-118";

const weak = (type: string): Card["weaknesses"] => [{ type, value: "×2" }] as Card["weaknesses"];

/** The 13 printings' local faces, read off the LOCAL D1 (costs dropped). */
const ME_FACES: Record<string, Card> = {
  ...Object.fromEntries(
    [HERACROSS, "me02-108"].map((id) => [
      id,
      battler(id, {
        name: "Mega Heracross ex",
        hp: 280,
        types: ["Grass"],
        retreat: 0,
        weaknesses: weak("Fire"),
        attacks: [
          { cost: [], name: "Juggernaut Horn", damage: "100+", effect: JUGGERNAUT },
          {
            cost: [],
            name: "Mountain Ramming",
            damage: 170,
            effect: "Discard the top 2 cards of your opponent's deck.",
          },
        ],
      }),
    ]),
  ),
  ...Object.fromEntries(
    [LYCANROC, "30th-138"].map((id) => [
      id,
      battler(id, {
        name: "Lycanroc",
        stage: "Stage1",
        hp: 130,
        types: ["Fighting"],
        retreat: 0,
        weaknesses: weak("Grass"),
        attacks: [
          { cost: [], name: "Counter", damage: "10+", effect: JUGGERNAUT },
          { cost: [], name: "Boulder Crush", damage: 80 },
        ],
      }),
    ]),
  ),
  [HEATRAN]: battler(HEATRAN, {
    name: "Heatran",
    hp: 140,
    types: ["Fire"],
    retreat: 0,
    weaknesses: weak("Water"),
    attacks: [
      { cost: [], name: "Singe", effect: "Your opponent's Active Pokémon is now Burned." },
      { cost: [], name: "Lava Wall", damage: 120, effect: LAVA_WALL },
    ],
  }),
  ...Object.fromEntries(
    [MANECTRIC, "me05-089"].map((id) => [
      id,
      battler(id, {
        name: "Manectric",
        stage: "Stage1",
        evolveFrom: "Electrike",
        hp: 120,
        types: ["Lightning"],
        retreat: 0,
        weaknesses: weak("Fighting"),
        attacks: [
          { cost: [], name: "Flashing Barrier", damage: 50, effect: FLASHING_BARRIER },
          {
            cost: [],
            name: "Sonic Edge",
            damage: 110,
            effect:
              "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
          },
        ],
      }),
    ]),
  ),
  [DEOXYS]: battler(DEOXYS, {
    name: "Deoxys",
    hp: 130,
    types: ["Psychic"],
    retreat: 0,
    weaknesses: weak("Darkness"),
    attacks: [{ cost: [], name: "Psy Protection", damage: 80, effect: PSY_PROTECTION }],
  }),
  [BRONZONG]: battler(BRONZONG, {
    name: "Bronzong",
    stage: "Stage1",
    evolveFrom: "Bronzor",
    hp: 130,
    types: ["Metal"],
    retreat: 0,
    weaknesses: weak("Fire"),
    resistances: [{ type: "Grass", value: "-30" }] as Card["resistances"],
    attacks: [
      { cost: [], name: "Gentle Slap", damage: 40 },
      { cost: [], name: "Metal Block", damage: 120, effect: METAL_BLOCK },
    ],
  }),
  [OKIDOGI]: battler(OKIDOGI, {
    name: "Okidogi",
    hp: 140,
    types: ["Fighting"],
    retreat: 0,
    weaknesses: weak("Psychic"),
    attacks: [
      { cost: [], name: "Light Punch", damage: 20 },
      { cost: [], name: "Settle the Score", damage: "80+", effect: SETTLE },
    ],
  }),
  [MABOSSTIFF]: battler(MABOSSTIFF, {
    name: "Mabosstiff",
    stage: "Stage1",
    evolveFrom: "Maschiff",
    hp: 140,
    types: ["Darkness"],
    retreat: 0,
    weaknesses: weak("Grass"),
    attacks: [
      { cost: [], name: "Bite", damage: 60 },
      { cost: [], name: "Plunging Headbutt", damage: 210, effect: HEADBUTT },
    ],
  }),
  ...Object.fromEntries(
    [IRON_DEFENDER, "me05-110"].map((id) => [
      id,
      { ...trainerCard(id, "Item", IRON_DEFENDER_TEXT), name: "Iron Defender" },
    ]),
  ),
};

// ── THE SUITE'S OWN BODIES ──

const WALL = "d630-wall"; // a 900-HP {C} Basic with no attack: the Active a hit is measured on
const RAIDER = "d630-raider"; // a 900-HP {C} Basic: 60 to the Active, a 30 snipe, a 10 spread
const EVOLVED = "d630-evolved"; // the same attacks on a Stage 1 (an Evolution Pokémon)
const ABLE = "d630-able"; // the same attacks on a Basic that prints an Ability
const FIRE = "d630-fire"; // a {R} Stage 1: 80 to the Active (Metal Block's Weakness rung)
const FRAGILE = "d630-fragile"; // a 60-HP {C} Basic the Raider Knocks Out
const FRAGILE_EX = "d630-fragile-ex"; // "D630 Fragile ex", the same at 60 HP: 2 Prize cards
const STEEL = "d630-steel"; // a 900-HP {M} Basic with no attack
const FILLER = "d630-filler";
const DUSCLOPS = "sv06.5-019"; // "Cursed Blast": the off-turn take (its user's own Pokémon Knocked Out)

const JAB = 60;
const RAIDER_ATTACKS: Card["attacks"] = [
  { cost: [], name: "Jab", damage: JAB },
  {
    cost: [],
    name: "Pick",
    effect:
      "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
  {
    cost: [],
    name: "Splash",
    damage: 10,
    effect:
      "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
  { cost: [], name: "Heave", damage: 150 },
];

const mon = (id: string, name: string, types: string[], extra: Partial<Card> = {}): Card =>
  battler(id, { name, hp: 900, types, retreat: 0, attacks: [], ...extra });

const LOCAL: Record<string, Card> = {
  ...ME_FACES,
  [WALL]: mon(WALL, "D630 Wall", ["Colorless"]),
  [RAIDER]: mon(RAIDER, "D630 Raider", ["Colorless"], { attacks: RAIDER_ATTACKS }),
  [EVOLVED]: mon(EVOLVED, "D630 Evolved", ["Colorless"], {
    stage: "Stage1",
    evolveFrom: "D630 Raider",
    attacks: RAIDER_ATTACKS,
  }),
  [ABLE]: mon(ABLE, "D630 Able", ["Colorless"], {
    abilities: [
      { type: "Ability", name: "Idle Hum", effect: "This Pokémon hums." },
    ] as Card["abilities"],
    attacks: RAIDER_ATTACKS,
  }),
  [FIRE]: mon(FIRE, "D630 Fire", ["Fire"], {
    stage: "Stage1",
    evolveFrom: "D630 Raider",
    attacks: [{ cost: [], name: "Flare", damage: 80 }],
  }),
  [FRAGILE]: mon(FRAGILE, "D630 Fragile", ["Colorless"], { hp: 60 }),
  [FRAGILE_EX]: mon(FRAGILE_EX, "D630 Fragile ex", ["Colorless"], { hp: 60 }),
  [STEEL]: mon(STEEL, "D630 Steel", ["Metal"]),
  [FILLER]: mon(FILLER, "D630 Filler", ["Colorless"]),
  // Off the LOCAL D1 (`legal_standard = 1`), cost dropped.
  [DUSCLOPS]: battler(DUSCLOPS, {
    name: "Dusclops",
    stage: "Stage1",
    evolveFrom: "Duskull",
    hp: 90,
    types: ["Psychic"],
    retreat: 2,
    weaknesses: weak("Darkness"),
    resistances: [{ type: "Fighting", value: "-30" }] as Card["resistances"],
    abilities: [
      {
        type: "Ability",
        name: "Cursed Blast",
        effect:
          "Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.",
      },
    ] as Card["abilities"],
    attacks: [{ cost: [], name: "Will-O-Wisp", damage: 50 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [HERACROSS]: 1,
  [LYCANROC]: 1,
  [HEATRAN]: 1,
  [MANECTRIC]: 1,
  [DEOXYS]: 1,
  [BRONZONG]: 1,
  [OKIDOGI]: 1,
  [MABOSSTIFF]: 1,
  [IRON_DEFENDER]: 2,
  "me05-110": 1,
  "me05-089": 1,
  [WALL]: 3,
  [RAIDER]: 3,
  [EVOLVED]: 2,
  [ABLE]: 2,
  [FIRE]: 2,
  [FRAGILE]: 2,
  [FRAGILE_EX]: 2,
  [STEEL]: 3,
  [FILLER]: 9,
  [DUSCLOPS]: 1,
  "fix-fire-energy": 13,
  "fix-energy": 6, // the prize row
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Hands and prize rows reset: every hand back into the deck, the six `fix-energy` the prize row. */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => next.cardIdByUid[u] === "fix-energy");
    next = {
      ...next,
      players: {
        ...next.players,
        [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return next;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed: turn 2). */
function p1First(): GameState {
  const created = createGame({ seed: 6300, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  return reset(state);
}

/** P1: `active` + `bench`; P2: `foe` Active + `foeBench`. Hands empty. Turn 2, P1 to act. */
function board(
  active: string,
  bench: readonly string[] = [],
  foe: string = RAIDER,
  foeBench: readonly string[] = [FILLER],
): GameState {
  let state = clearBench(setActiveFromDeck(p1First(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", foe), "p2");
  for (const id of foeBench) state = benchFromDeck(state, "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
/** An attack ENDS the turn (§5.3): the returned state is the opponent's next turn unless a ko:* park holds it. */
const attack = (state: GameState, seat: Seat, index = 0) =>
  mustApply(state, { type: "attack", seat, index });
const endTurn = (state: GameState, seat: Seat) =>
  must(applyAction(state, { type: "endTurn", seat }));
const snipeAt = (seat: Seat, ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: [ref] } }) as GameAction;
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
const topOf = (state: GameState, seat: Seat) => state.players[seat].active?.stack.at(-1);
const dealtTo = (events: readonly GameEvent[], uid: string | undefined) =>
  all(events, "DAMAGE_DEALT").find((e) => e.uid === uid)?.dealt;
function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("no body");
  return pokemon;
}
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = next.players.p1.hand.filter((u) => next.cardIdByUid[u] === id).pop() as string;
  return mustApply(next, { type: "playTrainer", seat: "p1", uid });
}
/** Every pending ko:* interrupt answered: the first `count` prizes, the first Benched body. */
function settle(state: GameState): GameState {
  let next = state;
  for (let i = 0; i < 6; i++) {
    const phase = next.phase;
    if (phase.kind === "ko:takePrizes") {
      const prizeIndices = Array.from({ length: phase.count }, (_, k) => k);
      next = must(applyAction(next, { type: "takePrizes", seat: phase.seat, prizeIndices }));
    } else if (phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: phase.seat, benchIndex: 0 }));
    } else break;
  }
  return next;
}
function rows(events: GameEvent[], state: GameState): string[] {
  const entries = logFromEvents(events, {
    names: { p1: "Ana", p2: "Bo" },
    state,
    elapsed: formatElapsed(0),
  });
  return entries.flatMap((e) =>
    e.kind === "turn" ? [] : [e.segments.map((s) => s.text).join("")],
  );
}

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §1 — the readers: each printed sentence and its near misses", () => {
  it("the three attacker-class prevents read onto the NEW members; arm 19c's Basic sentence is unmoved", () => {
    expect(deriveAttackEffect(LAVA_WALL)).toEqual([
      { op: "preventDamage", fromClass: { stage: "burned" } },
    ]);
    expect(deriveAttackEffect(FLASHING_BARRIER)).toEqual([
      { op: "preventDamage", fromClass: { stage: "evolution" } },
    ]);
    expect(deriveAttackEffect(PSY_PROTECTION)).toEqual([
      { op: "preventDamage", fromClass: { stage: "hasAbility" } },
    ]);
    expect(deriveAttackEffect(LAVA_WALL.replace("Burned", "Basic"))).toEqual([
      { op: "preventDamage", fromClass: { stage: "basic" } },
    ]);
    for (const near of [
      LAVA_WALL.replace("Burned", "Poisoned"),
      FLASHING_BARRIER.replace("Evolution", "Stage 2"),
      PSY_PROTECTION.replace("have an Ability", "have a Rule Box"),
      LAVA_WALL.replace("this Pokémon", "each of your Pokémon"),
      LAVA_WALL.replace(/\.$/, ""),
    ]) {
      expect(deriveAttackEffect(near), near).toBeNull();
    }
  });

  it("Metal Block reads `reduceDamage` with the class; the unclassed sentence keeps arm 19d", () => {
    expect(deriveAttackEffect(METAL_BLOCK)).toEqual([
      { op: "reduceDamage", amount: 100, fromClass: { stage: "evolution" } },
    ]);
    expect(deriveAttackEffect(METAL_BLOCK.replace(" from Evolution Pokémon", ""))).toEqual([
      { op: "reduceDamage", amount: 100 },
    ]);
    for (const near of [
      METAL_BLOCK.replace("100", "0"),
      METAL_BLOCK.replace("Evolution", "Basic"),
    ]) {
      expect(deriveAttackEffect(near), near).toBeNull();
    }
  });

  it("Plunging Headbutt reads the NEW `exposeSelf`; D547's defender sentence keeps `exposeDefender`", () => {
    expect(deriveAttackEffect(HEADBUTT)).toEqual([{ op: "exposeSelf", amount: 100 }]);
    expect(deriveAttackEffect(HEADBUTT.replace("100", "0"))).toBeNull();
    expect(
      deriveAttackEffect(
        "During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ op: "exposeDefender", amount: 50 }]);
  });

  it("the two count readers: `per` 60 on the last-turn Prizes, `per` 1 on the damage taken", () => {
    expect(deriveAttackDamageBonus(SETTLE)).toEqual({
      per: 60,
      count: { kind: "opponentPrizesTakenLastTurn" },
    });
    expect(deriveAttackDamageBonus(JUGGERNAUT)).toEqual({
      per: 1,
      count: { kind: "attackDamageTakenLastTurnOnSelf" },
    });
    expect(
      deriveAttackDamageBonus(
        "This attack does 60 more damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({
      per: 60,
      count: { kind: "opponentPrizesTaken" },
    });
    for (const near of [
      SETTLE.replace("60", "0"),
      SETTLE.replace("their last turn", "your last turn"),
      JUGGERNAUT.replace("that much", "30"),
      JUGGERNAUT.replace("your opponent's last turn", "your last turn"),
    ]) {
      expect(deriveAttackDamageBonus(near), near).toBeNull();
    }
  });

  it("Iron Defender = Jasmine's Gaze's op with the {M} holder type", () => {
    for (const id of [IRON_DEFENDER, "me05-110"]) {
      expect(programFor(id), id).toEqual({
        trainer: [{ op: "installSideDamageReductionNextTurn", amount: 30, pokemonType: "Metal" }],
      });
    }
    expect(programFor("me01-118")).toBe(programFor("me05-110"));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §2 — the damage record: written at the four §8.5 sites, summed per turn", () => {
  it("withAttackDamageTaken: 0 records nothing; the same turn sums; an older turn is replaced", () => {
    const fresh = body(board(HERACROSS).players.p1.active);
    expect(fresh.attackDamageTaken).toBeNull();
    expect(withAttackDamageTaken(fresh, 3, 0)).toBe(fresh);
    const once = withAttackDamageTaken(fresh, 3, 60);
    expect(once.attackDamageTaken).toEqual({ turn: 3, amount: 60 });
    expect(withAttackDamageTaken(once, 3, 30).attackDamageTaken).toEqual({ turn: 3, amount: 90 });
    expect(withAttackDamageTaken(once, 5, 10).attackDamageTaken).toEqual({ turn: 5, amount: 10 });
  });

  it("the main hit records its `dealt` on the defending Active, read only on the turn after", () => {
    const hit = attack(endTurn(board(HERACROSS), "p1"), "p2");
    expect(hit.state.turn).toBe(4);
    expect(hit.state.players.p1.active?.attackDamageTaken).toEqual({ turn: 3, amount: JAB });
    const damaged = body(hit.state.players.p1.active);
    expect(attackDamageTakenLastTurn(hit.state, damaged)).toBe(JAB);
    expect(attackDamageTakenLastTurn({ ...hit.state, turn: 3 }, damaged)).toBe(0); // the turn it was dealt
    expect(attackDamageTakenLastTurn({ ...hit.state, turn: 6 }, damaged)).toBe(0); // two turns on
  });

  it("a snipe onto the Bench (`placeSnipe`'s `deals` arm) and onto the Active (`snipeActive`) both record", () => {
    const window = endTurn(board(FILLER, [HERACROSS]), "p1");
    const parked = mustApply(window, { type: "attack", seat: "p2", index: 1 }).state;
    const bench = must(
      applyAction(parked, snipeAt("p2", { seat: "p1", spot: { spot: "bench", index: 0 } })),
    );
    expect(bench.players.p1.bench[0]?.attackDamageTaken).toEqual({ turn: 3, amount: 30 });
    const active = must(
      applyAction(parked, snipeAt("p2", { seat: "p1", spot: { spot: "active" } })),
    );
    expect(active.players.p1.active?.attackDamageTaken).toEqual({ turn: 3, amount: 30 });
  });

  it("a spread records on every Benched body it damaged", () => {
    const hit = attack(endTurn(board(FILLER, [HERACROSS, LYCANROC]), "p1"), "p2", 2);
    expect(hit.state.players.p1.active?.attackDamageTaken).toEqual({ turn: 3, amount: 10 });
    for (const b of hit.state.players.p1.bench)
      expect(b.attackDamageTaken).toEqual({ turn: 3, amount: 10 });
  });

  it("a prevented hit records nothing (Flashing Barrier against an Evolution Pokémon)", () => {
    const shielded = attack(board(MANECTRIC, [], EVOLVED), "p1").state;
    const hit = attack(shielded, "p2");
    expect(hit.state.players.p1.active?.damage).toBe(0);
    expect(hit.state.players.p1.active?.attackDamageTaken).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §3 — Juggernaut Horn / Counter: that much more damage (R-JH1)", () => {
  /** P1's turn 4 after P2's turn-3 attack at `index` (a parked snipe answered at `ref`). */
  function afterHit(state: GameState, index: number, ref?: unknown): GameState {
    let next = mustApply(endTurn(state, "p1"), { type: "attack", seat: "p2", index }).state;
    if (ref !== undefined) next = must(applyAction(next, snipeAt("p2", ref)));
    return next;
  }

  it("damaged by 60 last turn: 100 + 60 to the Defending Pokémon", () => {
    const turn4 = afterHit(board(HERACROSS, [], RAIDER, []), 0);
    expect(turn4.turn).toBe(4);
    const horn = attack(turn4, "p1");
    expect(dealtTo(horn.events, topOf(horn.state, "p2"))).toBe(100 + JAB);
  });

  it("not damaged last turn: 100", () => {
    const turn4 = endTurn(endTurn(board(HERACROSS, [], RAIDER, []), "p1"), "p2");
    const horn = attack(turn4, "p1");
    expect(dealtTo(horn.events, topOf(horn.state, "p2"))).toBe(100);
  });

  it("damaged two turns back only: 100 (the record is the opponent's LAST turn, `turn - 1`)", () => {
    const turn4 = afterHit(board(HERACROSS, [], RAIDER, []), 0);
    const turn6 = endTurn(endTurn(turn4, "p1"), "p2");
    const horn = attack(turn6, "p1");
    expect(dealtTo(horn.events, topOf(horn.state, "p2"))).toBe(100);
  });

  it("R-JH1 (UNRULED): sniped on the Bench, then switched in: 100 + 30 — the record follows the body", () => {
    const turn4 = afterHit(board(FILLER, [HERACROSS], RAIDER, []), 1, {
      seat: "p1",
      spot: { spot: "bench", index: 0 },
    });
    const up = must(
      applyAction(turn4, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    expect(up.players.p1.active?.attackDamageTaken).toEqual({ turn: 3, amount: 30 });
    const horn = attack(up, "p1");
    expect(dealtTo(horn.events, topOf(horn.state, "p2"))).toBe(100 + 30);
  });

  it("Counter: 10 + 60; the record survives a JSON round trip", () => {
    const turn4 = revived(afterHit(board(LYCANROC, [], RAIDER, []), 0));
    const counter = attack(turn4, "p1");
    expect(dealtTo(counter.events, topOf(counter.state, "p2"))).toBe(10 + JAB);
  });

  it("the bonus is a pre-W/R `+`: into a body Weak to {G}, (100 + 60) × 2", () => {
    // The bonus is a pre-W/R `+` (the additive fold): into a body Weak to {G}, (100 + 60) × 2.
    const weakWall = { ...POOL[WALL], id: WALL, weaknesses: weak("Grass") } as Card;
    const pool = { ...POOL, [WALL]: weakWall };
    const turn4 = afterHit(board(HERACROSS, [], RAIDER, []), 0);
    const swapped = clearBench(setActiveFromDeck({ ...turn4, cardPool: pool }, "p2", WALL), "p2");
    const horn = attack(swapped, "p1");
    expect(dealtTo(horn.events, topOf(horn.state, "p2"))).toBe((100 + JAB) * 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §4 — the three attacker classes on `preventDamage`", () => {
  it("Lava Wall: a Burned attacker's damage is prevented; an unburned one lands (R-LVW1: read at the hit)", () => {
    const walled = attack(board(HEATRAN), "p1", 1);
    expect(walled.state.players.p1.active?.attackBlock).toEqual({
      turn: 3,
      effects: false,
      fromClass: { stage: "burned" },
      maxDamage: undefined,
    });
    expect(rows(walled.events, walled.state)).toContain(
      "Heatran is protected from damage from Burned Pokémon's attacks during your opponent's next turn",
    );
    const window = walled.state;
    expect(attack(window, "p2").state.players.p1.active?.damage).toBe(JAB);
    const burned = attack(setConditions(window, "p2", { burned: true }), "p2");
    expect(burned.state.players.p1.active?.damage).toBe(0);
  });

  it("Flashing Barrier: an Evolution attacker is prevented, a Basic one lands; both printings", () => {
    for (const id of [MANECTRIC, "me05-089"]) {
      const evolved = attack(attack(board(id, [], EVOLVED), "p1").state, "p2");
      expect(evolved.state.players.p1.active?.damage, id).toBe(0);
      const basic = attack(attack(board(id, [], RAIDER), "p1").state, "p2");
      expect(basic.state.players.p1.active?.damage, id).toBe(JAB);
    }
  });

  it("Psy Protection: an attacker that prints an Ability is prevented, one without lands (R-PSY1)", () => {
    const able = attack(attack(board(DEOXYS, [], ABLE), "p1").state, "p2");
    expect(able.state.players.p1.active?.damage).toBe(0);
    const plain = attack(attack(board(DEOXYS, [], RAIDER), "p1").state, "p2");
    expect(plain.state.players.p1.active?.damage).toBe(JAB);
    const walled = attack(board(DEOXYS, [], ABLE), "p1");
    expect(rows(walled.events, walled.state)).toContain(
      "Deoxys is protected from damage from attacks from Pokémon that have an Ability during your opponent's next turn",
    );
  });

  it("the class is a DAMAGE block only: the effects funnel reads no body, so a Burned attacker's effects pass", () => {
    const walled = attack(board(HEATRAN), "p1", 1);
    expect(walled.state.players.p1.active?.attackBlock?.effects).toBe(false);
  });

  it("the block expires: a Burned attacker two turns later lands", () => {
    const later = endTurn(endTurn(attack(board(HEATRAN), "p1", 1).state, "p2"), "p1");
    const burned = attack(setConditions(later, "p2", { burned: true }), "p2");
    expect(burned.state.players.p1.active?.damage).toBe(JAB);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §5 — Metal Block: 100 less from Evolution attackers, after Weakness and Resistance", () => {
  it("installs the classed record and says so", () => {
    const blocked = attack(board(BRONZONG), "p1", 1);
    expect(blocked.state.players.p1.active?.damageReduction).toEqual({
      turn: 3,
      amount: 100,
      fromClass: { stage: "evolution" },
    });
    expect(rows(blocked.events, blocked.state)).toContain(
      "Bronzong takes 100 less damage from attacks from Evolution Pokémon during your opponent's next turn",
    );
  });

  it("an Evolution attacker's 150 lands as 50; a Basic attacker's 150 lands whole", () => {
    const evolved = attack(attack(board(BRONZONG, [], EVOLVED), "p1", 1).state, "p2", 3);
    expect(evolved.state.players.p1.active?.damage).toBe(50);
    // 150 Knocks the 130-HP Bronzong Out, so the row is read rather than the body.
    const basicBoard = attack(board(BRONZONG, [], RAIDER), "p1", 1).state;
    const basic = attack(basicBoard, "p2", 3);
    expect(dealtTo(basic.events, topOf(basicBoard, "p1"))).toBe(150);
  });

  it("after Weakness: a Fire Stage 1's 80 into the Fire-weak Bronzong is 80 × 2 − 100 = 60", () => {
    const fire = attack(attack(board(BRONZONG, [], FIRE), "p1", 1).state, "p2");
    expect(fire.state.players.p1.active?.damage).toBe(60);
  });

  it("an unclassed reduction (arm 19d's shape) still reduces every attacker", () => {
    const result = runProgram(
      board(BRONZONG),
      [{ op: "reduceDamage", amount: 100 }],
      { seat: "p1", invokedBy: "attack" },
      [],
    );
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
    const basic = attack(endTurn(result.state, "p1"), "p2", 3);
    expect(basic.state.players.p1.active?.damage).toBe(50);
  });

  it("a same-window re-install with another class widens to every attacker (`preventDamage`'s rule)", () => {
    const once = runProgram(
      board(BRONZONG),
      [
        { op: "reduceDamage", amount: 100, fromClass: { stage: "evolution" } },
        { op: "reduceDamage", amount: 30, fromClass: { stage: "basic" } },
      ],
      { seat: "p1", invokedBy: "attack" },
      [],
    );
    if (once.kind !== "done") throw new Error("expected done");
    expect(once.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §6 — Iron Defender: your {M} Pokémon take 30 less; two plays stack (R-ID1)", () => {
  it("appends a typed entry on the player's side for the opponent's next turn", () => {
    const played = play(board(STEEL), IRON_DEFENDER);
    expect(played.state.players.p1.sideDamageReduction).toEqual([
      { turn: 3, amount: 30, pokemonType: "Metal" },
    ]);
    expect(rows(played.events, played.state)).toContain(
      "Metal Pokémon take 30 less damage from attacks during the opponent's next turn (after Weakness and Resistance), including Pokémon that come into play",
    );
  });

  it("a {M} Active takes 60 − 30; a {C} Active takes 60", () => {
    const steel = attack(endTurn(play(board(STEEL), IRON_DEFENDER).state, "p1"), "p2");
    expect(steel.state.players.p1.active?.damage).toBe(JAB - 30);
    const plain = attack(endTurn(play(board(FILLER), IRON_DEFENDER).state, "p1"), "p2");
    expect(plain.state.players.p1.active?.damage).toBe(JAB);
  });

  it("two plays SUM: 60 − 60 = 0 (an Item; D564's overwrite is withdrawn)", () => {
    const twice = play(play(board(STEEL), IRON_DEFENDER).state, "me05-110");
    expect(twice.state.players.p1.sideDamageReduction).toHaveLength(2);
    expect(attack(endTurn(twice.state, "p1"), "p2").state.players.p1.active?.damage).toBe(0);
  });

  it("a {M} body Benched AFTER the play is covered (the printed parenthesis): the 30 snipe lands as 0", () => {
    const played = play(board(FILLER), IRON_DEFENDER).state;
    const benched = benchFromDeck(played, "p1", STEEL);
    const parked = mustApply(endTurn(benched, "p1"), {
      type: "attack",
      seat: "p2",
      index: 1,
    }).state;
    const hit = must(
      applyAction(parked, snipeAt("p2", { seat: "p1", spot: { spot: "bench", index: 0 } })),
    );
    expect(hit.players.p1.bench[0]?.damage).toBe(0);
  });

  it("expired entries are pruned at the next install; the window passes by arithmetic", () => {
    const played = play(board(STEEL), IRON_DEFENDER).state;
    const turn4 = endTurn(endTurn(played, "p1"), "p2");
    const again = play(turn4, "me05-110");
    expect(again.state.players.p1.sideDamageReduction).toEqual([
      { turn: 5, amount: 30, pokemonType: "Metal" },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §7 — Settle the Score: +60 for each Prize card the opponent took during their last turn (R-STS1)", () => {
  /** P2's turn-3 Jab Knocks Out P1's `victim`; Okidogi is promoted; P1's turn 4. */
  function afterKo(victim: string): GameState {
    const turn3 = endTurn(board(victim, [OKIDOGI], RAIDER, []), "p1");
    const hit = mustApply(turn3, { type: "attack", seat: "p2", index: 0 }).state;
    const turn4 = settle(hit);
    if (turn4.turn !== 4)
      throw new Error(`expected turn 4, got ${turn4.turn} (${turn4.phase.kind})`);
    return turn4;
  }

  it("the take is recorded on the taker's side: one Prize, then two for a Pokémon ex", () => {
    const turn4 = afterKo(FRAGILE);
    expect(turn4.players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 1 });
    expect(prizesTakenOnLastTurn(turn4, "p2")).toBe(1);
    expect(afterKo(FRAGILE_EX).players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 2 });
  });

  it("two Knock Outs in one turn are two takes, SUMMED on the turn's record: 80 + 120", () => {
    let state = board(OKIDOGI, [FRAGILE, FRAGILE], RAIDER, []);
    state = setBenchDamage(setBenchDamage(state, "p1", 0, 50), "p1", 1, 50);
    const splash = mustApply(endTurn(state, "p1"), { type: "attack", seat: "p2", index: 2 }).state;
    const turn4 = settle(splash);
    expect(turn4.turn).toBe(4);
    expect(turn4.players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 2 });
    const hit = attack(turn4, "p1", 1);
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))).toBe(80 + 120);
  });

  it("80 + 60 after one Prize; 80 + 120 after two", () => {
    const one = attack(afterKo(FRAGILE), "p1", 1);
    expect(dealtTo(one.events, topOf(one.state, "p2"))).toBe(80 + 60);
    const two = attack(afterKo(FRAGILE_EX), "p1", 1);
    expect(dealtTo(two.events, topOf(two.state, "p2"))).toBe(80 + 120);
  });

  it("no Prize last turn: 80; a take two turns back counts nothing", () => {
    const quiet = attack(endTurn(endTurn(board(OKIDOGI, [], RAIDER, []), "p1"), "p2"), "p1", 1);
    expect(dealtTo(quiet.events, topOf(quiet.state, "p2"))).toBe(80);
    const turn6 = endTurn(endTurn(afterKo(FRAGILE), "p1"), "p2");
    const late = attack(turn6, "p1", 1);
    expect(dealtTo(late.events, topOf(late.state, "p2"))).toBe(80);
  });

  it("an OFF-turn take is not recorded: P1's own Cursed Blast on turn 4 leaves P2's turn-3 record, 80 + 120", () => {
    const turn4 = benchFromDeck(afterKo(FRAGILE_EX), "p1", DUSCLOPS);
    expect(turn4.players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 2 });
    // P2's lone Raider is the one target, so the placement auto-resolves; Dusclops is Knocked Out on
    // P1's OWN turn and P2 takes a Prize stamped turn 4.
    const parked = mustApply(turn4, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: turn4.players.p1.bench.length - 1 },
      abilityName: "Cursed Blast",
    }).state;
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const blasted = settle(parked);
    expect(blasted.turn).toBe(4);
    expect(blasted.players.p2.prizes.length).toBe(turn4.players.p2.prizes.length - 1); // P2 DID take
    expect(blasted.players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 2 });
    const hit = attack(blasted, "p1", 1);
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))).toBe(80 + 120);
  });

  it("a Checkup Knock Out's take is stamped with the ENDING turn: Poison after P2's turn 3 counts, 80 + 60", () => {
    let state = board(FRAGILE, [OKIDOGI], RAIDER, []);
    state = endTurn(state, "p1");
    state = setConditions(setDamage(state, "p1", 50), "p1", { poisonDamage: 10 });
    const turn4 = settle(endTurn(state, "p2"));
    expect(turn4.turn).toBe(4);
    expect(turn4.players.p2.prizesTakenOnTurn).toEqual({ turn: 3, count: 1 });
    const hit = attack(turn4, "p1", 1);
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))).toBe(80 + 60);
  });

  it("the ATTACKER's own takes do not count: the record read is the opponent's", () => {
    const turn4 = afterKo(FRAGILE);
    const rigged: GameState = {
      ...turn4,
      players: {
        ...turn4.players,
        p1: { ...turn4.players.p1, prizesTakenOnTurn: { turn: 3, count: 3 } },
        p2: { ...turn4.players.p2, prizesTakenOnTurn: null },
      },
    };
    const hit = attack(rigged, "p1", 1);
    expect(dealtTo(hit.events, topOf(hit.state, "p2"))).toBe(80);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §8 — Plunging Headbutt: this Pokémon takes 100 more during the opponent's next turn (R-PH1)", () => {
  it("stamps the attacker's own Active for `turn + 1` and says so", () => {
    const butt = attack(board(MABOSSTIFF), "p1", 1);
    expect(butt.state.players.p1.active?.damageVulnerability).toEqual({ turn: 3, amount: 100 });
    expect(rows(butt.events, butt.state)).toContain(
      "Mabosstiff takes 100 more damage from attacks during your opponent's next turn",
    );
  });

  it("the opponent's 60 lands as 160 next turn; two turns later the record has expired", () => {
    const window = attack(board(MABOSSTIFF), "p1", 1).state;
    // 160 Knocks the 140-HP Mabosstiff Out, so the row is read rather than the body.
    expect(dealtTo(attack(window, "p2").events, topOf(window, "p1"))).toBe(JAB + 100);
    const later = endTurn(endTurn(window, "p2"), "p1");
    expect(attack(later, "p2").state.players.p1.active?.damage).toBe(JAB);
  });

  it("R-PH1 (UNRULED): a live record of the same window is SUMMED (an opponent's +50 and this +100)", () => {
    const base = board(MABOSSTIFF);
    const exposed = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          active: { ...body(base.players.p1.active), damageVulnerability: { turn: 3, amount: 50 } },
        },
      },
    };
    const result = runProgram(
      exposed,
      [{ op: "exposeSelf", amount: 100 }],
      { seat: "p1", invokedBy: "attack" },
      [],
    );
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.active?.damageVulnerability).toEqual({ turn: 3, amount: 150 });
    // An expired record is replaced, not summed.
    const stale = {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...base.players.p1,
          active: { ...body(base.players.p1.active), damageVulnerability: { turn: 2, amount: 50 } },
        },
      },
    };
    const fresh = runProgram(
      stale,
      [{ op: "exposeSelf", amount: 100 }],
      { seat: "p1", invokedBy: "attack" },
      [],
    );
    if (fresh.kind !== "done") throw new Error("expected done");
    expect(fresh.state.players.p1.active?.damageVulnerability).toEqual({ turn: 3, amount: 100 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D630 §9 — the ids, and the version", () => {
  it("no attack id is keyed (every reading is derived from the text); Iron Defender is", () => {
    for (const id of [
      HERACROSS,
      "me02-108",
      LYCANROC,
      "30th-138",
      HEATRAN,
      MANECTRIC,
      "me05-089",
      DEOXYS,
      BRONZONG,
      OKIDOGI,
      MABOSSTIFF,
    ])
      expect(programFor(id), id).toBeUndefined();
    expect(Object.keys(programFor(IRON_DEFENDER) ?? {})).toEqual(["trainer"]);
  });

  it("a fresh side and body carry the NEW keys empty", () => {
    const state = board(HERACROSS);
    expect(state.players.p1.sideDamageReduction).toEqual([]);
    expect(state.players.p1.prizesTakenOnTurn).toBeNull();
    expect(state.players.p1.active?.attackDamageTaken).toBeNull();
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.529.0");
  });
});
