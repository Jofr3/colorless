import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { disabledAbilityUids, seatBurnExtraCounters } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { attackerPreWRBonus, conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
} from "./testFixtures";

// ── 🆕🆕🆕 D560 — THE ABILITY BUNDLE, PART 2: THE THREE PASSIVES, MAGMORTAR, AND THE TWO
//    ACTIVATED ABILITIES ──
//
//   Slaking ex   sv08-147 / -227     "Born to Slack"     cantAttackUnless opponentHasExOrVInPlay (V2)
//   Annihilape   sv10-092            "Lose Cool"         +120 pre-W/R, yourActiveDamageCountersAtLeast 2 (V3)
//   Galvantula   sv06.5-002          "Compound Eyes"     +50 pre-W/R, opponentActiveHasAbility (V4)
//   Magmortar    sv09-021            "Magma Surge"       opponentBurnExtraCounters 30 (the §13.2 scan)
//   Thwackey     sv06-015 / svp-115  "Boom Boom Groove"  playableIf yourActiveHasAbility "Festival Lead" (V1)
//   Cradily      sv07-006            "Selective Slime"   coinFlipGate → two labelled binary confirms
//
// Part 1 (the five triggered Abilities and the eleven registry rows) is
// `abilityTriggersD560.test.ts`. Every board rides a LOCAL `cardPool` (D275) in the suite's
// OWN 60-card deck (D270): the printed cards transcribed from the tcgdex JSON (2026-09-26)
// plus `d560-*` demonstrators. Readings R-SL, R-AN, R-GV, R-MG, R-TW, R-CR: docs/decisions.md
// D560.

const SLAKING = ["sv08-147", "sv08-227"] as const;
const ANNIHILAPE = "sv10-092";
const GALVANTULA = "sv06.5-002"; // FIXTURE_POOL's own transcription
const MAGMORTAR = "sv09-021";
const THWACKEY = ["sv06-015", "svp-115"] as const;
const GOLDEEN = "sv06-044"; // Basic, "Festival Lead" (unbuilt — PRINTED is what V1 reads)
const DIPPLIN = "sv06-018"; // Stage 1, "Festival Lead"
const CRADILY = "sv07-006";
const FLUTTER = "sv05-078";
const GASTRODON = "sv08-107";
const KLEFKI = "sv01-096"; // Basic, "Mischievous Lock" (Active-sourced, Basics)
const SPIRITOMB = "sv02-089"; // Basic, "Fettered in Misfortune" (Bench-live, Basic V)

const FESTIVAL_LEAD = {
  type: "Ability",
  name: "Festival Lead",
  effect:
    "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.",
};
const STRIKE = { cost: ["Colorless"], name: "Strike", damage: 50 };
const PICK_OFF = {
  cost: ["Colorless"],
  name: "Pick Off",
  effect:
    "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
};
const IMPACT_BLOW = {
  cost: ["Fighting", "Fighting"],
  name: "Impact Blow",
  damage: 160,
  effect: "During your next turn, this Pokémon can't use Impact Blow.",
};
const LOSE_COOL_TEXT =
  "If this Pokémon has 2 or more damage counters on it, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";

const NORM = "d560-norm"; // a {C} attacker: Strike 50 / Pick Off 30
const WALL = "d560-wall"; // 900 HP {C}, no Ability, no Weakness — the plain defender
const WALL_EX = "d560-wall-ex"; // 900 HP Basic ex, no Ability
const WALL_V = "d560-wall-v"; // 900 HP Basic V, no Ability
const WALL_VMAX = "d560-wall-vmax"; // a VMAX — NOT "ex or V" (D107)
const ABLE = "d560-able"; // 900 HP Basic WITH an Ability
const ABLE_V = "d560-able-v"; // 900 HP Basic V WITH an Ability (Spiritomb's target)
const PSY_WEAK_ABLE = "d560-psy-weak-able"; // ×2 {G} Weakness WITH an Ability — the order board

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    SLAKING.map((id) => [
      id,
      battler(id, {
        name: "Slaking ex",
        stage: "Stage2",
        evolveFrom: "Vigoroth",
        hp: 340,
        retreat: 4,
        types: ["Colorless"],
        weaknesses: [{ type: "Fighting", value: "×2" }],
        abilities: [
          {
            type: "Ability",
            name: "Born to Slack",
            effect: "If your opponent has no Pokémon ex or Pokémon V in play, this Pokémon can't attack.",
          },
        ],
        attacks: [
          {
            cost: ["Colorless", "Colorless"],
            name: "Great Swing",
            damage: 280,
            effect: "Discard an Energy from this Pokémon.",
          },
        ],
      }),
    ]),
  ),
  // ⚠️ TEST SURGERY: the printed card PLUS a demonstrator snipe at index 1, so the
  // `snipeActive` site can be driven with Lose Cool on the attacker (the passive is keyed
  // by id; index 0 is the printed attack, unchanged).
  [ANNIHILAPE]: battler(ANNIHILAPE, {
    name: "Annihilape",
    stage: "Stage2",
    evolveFrom: "Primeape",
    hp: 150,
    retreat: 2,
    types: ["Fighting"],
    weaknesses: [{ type: "Psychic", value: "×2" }],
    abilities: [{ type: "Ability", name: "Lose Cool", effect: LOSE_COOL_TEXT }],
    attacks: [IMPACT_BLOW, PICK_OFF],
  }),
  [MAGMORTAR]: battler(MAGMORTAR, {
    name: "Magmortar",
    stage: "Stage1",
    evolveFrom: "Magmar",
    hp: 130,
    retreat: 2,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Magma Surge",
        effect: "During Pokémon Checkup, put 3 more damage counters on your opponent's Burned Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Searing Flame",
        damage: 90,
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Burned.",
      },
    ],
  }),
  ...Object.fromEntries(
    THWACKEY.map((id) => [
      id,
      battler(id, {
        name: "Thwackey",
        stage: "Stage1",
        evolveFrom: "Grookey",
        hp: 100,
        retreat: 2,
        types: ["Grass"],
        weaknesses: [{ type: "Fire", value: "×2" }],
        abilities: [
          {
            type: "Ability",
            name: "Boom Boom Groove",
            effect:
              "Once during your turn, if your Active Pokémon has the Festival Lead Ability, you may search your deck for a card and put it into your hand. Then, shuffle your deck.",
          },
        ],
        attacks: [{ cost: ["Grass", "Grass"], name: "Beat", damage: 50 }],
      }),
    ]),
  ),
  [GOLDEEN]: battler(GOLDEEN, {
    name: "Goldeen",
    hp: 50,
    retreat: 1,
    types: ["Water"],
    abilities: [FESTIVAL_LEAD],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Whirlpool",
        damage: 10,
        effect: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  }),
  [DIPPLIN]: battler(DIPPLIN, {
    name: "Dipplin",
    stage: "Stage1",
    evolveFrom: "Applin",
    hp: 80,
    retreat: 2,
    types: ["Grass"],
    abilities: [FESTIVAL_LEAD],
    attacks: [
      {
        cost: ["Grass"],
        name: "Do the Wave",
        damage: "20×",
        effect: "This attack does 20 damage for each of your Benched Pokémon.",
      },
    ],
  }),
  [CRADILY]: battler(CRADILY, {
    name: "Cradily",
    stage: "Stage2",
    evolveFrom: "Lileep",
    hp: 150,
    retreat: 3,
    types: ["Grass"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Selective Slime",
        effect:
          "Once during your turn, you may flip a coin. If heads, choose Burned, Confused, or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition.",
      },
    ],
    attacks: [
      {
        cost: ["Grass"],
        name: "Miasma Wind",
        damage: "100×",
        effect:
          "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.",
      },
    ],
  }),
  [FLUTTER]: battler(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Hex Hurl", damage: 90 }],
  }),
  [GASTRODON]: battler(GASTRODON, {
    name: "Gastrodon",
    stage: "Stage1",
    evolveFrom: "Shellos",
    hp: 130,
    retreat: 3,
    types: ["Fighting"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Sticky Bind",
        effect:
          "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities.",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Mud Shot", damage: 80 }],
  }),
  [NORM]: battler(NORM, { name: "D560 Norm", hp: 300, retreat: 1, types: ["Colorless"], attacks: [STRIKE, PICK_OFF] }),
  [WALL]: battler(WALL, { name: "D560 Wall", hp: 900, retreat: 2, types: ["Colorless"], weaknesses: null }),
  [WALL_EX]: battler(WALL_EX, { name: "D560 Wall ex", hp: 900, retreat: 2, types: ["Colorless"], weaknesses: null }),
  [WALL_V]: battler(WALL_V, { name: "D560 Wall V", hp: 900, retreat: 2, types: ["Colorless"], weaknesses: null }),
  [WALL_VMAX]: battler(WALL_VMAX, {
    name: "D560 Wall VMAX",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: null,
  }),
  [ABLE]: battler(ABLE, {
    name: "D560 Able",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: null,
    abilities: [{ type: "Ability", name: "D560 Aura", effect: "This Ability does nothing." }],
  }),
  [ABLE_V]: battler(ABLE_V, {
    name: "D560 Able V",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: null,
    abilities: [{ type: "Ability", name: "D560 Aura", effect: "This Ability does nothing." }],
  }),
  [PSY_WEAK_ABLE]: battler(PSY_WEAK_ABLE, {
    name: "D560 Weak Able",
    hp: 900,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [{ type: "Ability", name: "D560 Aura", effect: "This Ability does nothing." }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [SLAKING[0]]: 1,
  [SLAKING[1]]: 1,
  [ANNIHILAPE]: 1,
  [GALVANTULA]: 1,
  [MAGMORTAR]: 2,
  [THWACKEY[0]]: 1,
  [THWACKEY[1]]: 1,
  [GOLDEEN]: 1,
  [DIPPLIN]: 1,
  [CRADILY]: 1,
  [FLUTTER]: 1,
  [GASTRODON]: 1,
  [KLEFKI]: 1,
  [SPIRITOMB]: 1,
  [NORM]: 2,
  [WALL]: 4,
  [WALL_EX]: 1,
  [WALL_V]: 1,
  [WALL_VMAX]: 1,
  [ABLE]: 1,
  [ABLE_V]: 1,
  [PSY_WEAK_ABLE]: 1,
  "fix-grass-energy": 4,
  "fix-fighting-energy": 4,
  "fix-energy": 25,
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

/** TEST SURGERY — `count` copies of `id` into `seat`'s DECK (back from the hand, or
    swapped out of the Prizes for the deck's bottom cards). Every uid stays in one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string, count = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= count) return next;
    const held = side.hand.find((u) => next.cardIdByUid[u] === id);
    if (held !== undefined) {
      const moved = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
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

/** `id` as `seat`'s Active — kept if setup already put it there, else pulled from the deck. */
function seatActive(state: GameState, seat: Seat, id: string): GameState {
  const active = state.players[seat].active;
  const top = active?.stack[active.stack.length - 1];
  if (top !== undefined && state.cardIdByUid[top] === id) return state;
  return setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
}

/** p1's turn 2 with the named boards, and `energy` on p1's Active. */
function table(
  active: string,
  bench: readonly string[],
  oppActive: string,
  oppBench: readonly string[] = [],
  energy: readonly [string, number][] = [["fix-energy", 1]],
  seed = 5601,
): GameState {
  let state = opened(seed);
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", oppActive);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  for (const [id, n] of energy) state = attachFromDeck(ensureInDeck(state, "p1", id, n), "p1", id, n);
  return state;
}

function body(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}
const topOf = (pokemon: InPlayPokemon) => pokemon.stack[pokemon.stack.length - 1] as string;

function find<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function dealtBy(state: GameState, index: number) {
  return find(mustApply(state, { type: "attack", seat: "p1", index }).events, "DAMAGE_DEALT");
}

/** The snipe site (`snipeActive`): Pick Off at `index`, answered onto p2's ACTIVE. */
function snipedActive(state: GameState, index: number) {
  const parked = mustApply(state, { type: "attack", seat: "p1", index }).state;
  expect(parked.phase.kind).toBe("effect:choose"); // every snipe board fields a p2 Bench
  const done = mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
  });
  return find(done.events, "DAMAGE_DEALT");
}

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}
const withCoin = (state: GameState, face: "heads" | "tails"): GameState => ({
  ...state,
  rngState: cursorFor(face),
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §1 — the four NEW `BoardCondition` members: arms and notes", () => {
  it("each note is the printed clause in the reject voice", () => {
    expect(conditionNote({ kind: "yourActiveHasAbility", name: "Festival Lead" })).toBe(
      "your Active Pokémon has the Festival Lead Ability",
    );
    expect(conditionNote({ kind: "opponentHasExOrVInPlay" })).toBe(
      "your opponent has a Pokémon ex or Pokémon V in play",
    );
    expect(conditionNote({ kind: "yourActiveDamageCountersAtLeast", count: 2 })).toBe(
      "your Active Pokémon has 2 or more damage counters on it",
    );
    expect(conditionNote({ kind: "opponentActiveHasAbility" })).toBe(
      "your opponent's Active Pokémon has an Ability",
    );
  });

  it("every arm is seat-relative: the same board answers differently from the two seats", () => {
    const state = table(GOLDEEN, [], WALL_EX, [], []);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasAbility", name: "Festival Lead" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "yourActiveHasAbility", name: "Festival Lead" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentHasExOrVInPlay" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentHasExOrVInPlay" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasAbility" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasAbility" })).toBe(false);
    const hurt = setDamage(state, "p1", 20);
    expect(conditionHolds(hurt, "p1", { kind: "yourActiveDamageCountersAtLeast", count: 2 })).toBe(true);
    expect(conditionHolds(hurt, "p2", { kind: "yourActiveDamageCountersAtLeast", count: 2 })).toBe(false);
  });

  it("an EMPTY Active Spot is FALSE for all four", () => {
    const state = table(GOLDEEN, [], ABLE, [], []);
    const empty = {
      ...state,
      players: {
        p1: { ...state.players.p1, active: null },
        p2: { ...state.players.p2, active: null },
      },
    };
    expect(conditionHolds(empty, "p1", { kind: "yourActiveHasAbility", name: "Festival Lead" })).toBe(false);
    expect(conditionHolds(empty, "p1", { kind: "opponentActiveHasAbility" })).toBe(false);
    expect(conditionHolds(empty, "p1", { kind: "yourActiveDamageCountersAtLeast", count: 0 })).toBe(false);
    expect(conditionHolds(empty, "p1", { kind: "opponentHasExOrVInPlay" })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §2 — Slaking ex \"Born to Slack\": can't attack with no ex / V opposite (R-SL)", () => {
  const slaking = (oppActive: string, oppBench: readonly string[] = []) =>
    table(SLAKING[0], [], oppActive, oppBench, [["fix-energy", 2]]);

  it("no Pokémon ex or V anywhere on the other side: ATTACK_PREVENTED, naming the clause", () => {
    const result = applyAction(slaking(WALL, [WALL, ABLE]), { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ATTACK_PREVENTED");
    expect(result.error.message).toContain("your opponent has a Pokémon ex or Pokémon V in play");
  });

  it("an opposing ACTIVE ex lets it attack: Great Swing's 280", () => {
    expect(dealtBy(slaking(WALL_EX), 0)?.dealt).toBe(280);
  });

  it("🛑 an opposing BENCHED ex or V is enough — the Bench is \"in play\" (R-SL)", () => {
    expect(dealtBy(slaking(WALL, [WALL_EX]), 0)?.dealt).toBe(280);
    expect(dealtBy(slaking(WALL, [WALL_V]), 0)?.dealt).toBe(280);
  });

  it("a VMAX is not \"ex or V\" (D107's `isExOrV`), and OWN ex do not count", () => {
    expect(applyAction(slaking(WALL_VMAX), { type: "attack", seat: "p1", index: 0 }).ok).toBe(false);
    const ownEx = table(SLAKING[1], [WALL_EX, WALL_V], WALL, [], [["fix-energy", 2]]);
    expect(applyAction(ownEx, { type: "attack", seat: "p1", index: 0 }).ok).toBe(false);
  });

  it("a §9 lock silences the DRAWBACK: an opposing Active Flutter Mane lets Slaking ex attack", () => {
    // Flutter Mane is not ex / V, so without the lock Slaking ex could not attack at all.
    expect(dealtBy(slaking(FLUTTER), 0)?.dealt).toBe(280);
  });

  it("the HUD reads the same gate (redact.ts `attackBarredByAbility`): both printings keyed", () => {
    for (const id of SLAKING) {
      expect(programFor(id)?.passive?.cantAttackUnless).toEqual({ kind: "opponentHasExOrVInPlay" });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §3 — Annihilape \"Lose Cool\": +120 at 2+ counters, at BOTH pre-W/R sites (R-AN)", () => {
  const ape = (damage: number, oppBench: readonly string[] = []) =>
    setDamage(
      table(ANNIHILAPE, [], WALL, oppBench, [
        ["fix-fighting-energy", 2],
        ["fix-energy", 1],
      ]),
      "p1",
      damage,
    );

  it("the main hit: 10 damage (1 counter) pays nothing — Impact Blow's printed 160", () => {
    const row = dealtBy(ape(10), 0);
    expect(row?.bonus).toBeUndefined();
    expect(row?.dealt).toBe(160);
  });

  it("the main hit: 20 damage (2 counters) pays +120 → 280", () => {
    const row = dealtBy(ape(20), 0);
    expect(row?.bonus).toBe(120);
    expect(row?.dealt).toBe(280);
  });

  it("the snipe site (`snipeActive`): 30 → 150 at 20 damage, 30 at 10", () => {
    expect(snipedActive(ape(20, [WALL]), 1)?.dealt).toBe(150);
    expect(snipedActive(ape(10, [WALL]), 1)?.dealt).toBe(30);
  });

  // This cannot go red through V3's arm: a Benched Annihilape is not the attacker, so Lose
  // Cool never enters `passivesOf(attacker)` whatever the arm reads. It guards only against a
  // seat-wide aura reading of the passive; the ACTIVE reading itself is held by the 10-vs-20 rungs.
  it("no seat-wide aura: a damaged BENCHED Annihilape adds nothing to the Active's hit", () => {
    let state = table(NORM, [ANNIHILAPE], WALL);
    const side = state.players.p1;
    state = {
      ...state,
      players: { ...state.players, p1: { ...side, bench: side.bench.map((b) => ({ ...b, damage: 50 })) } },
    };
    expect(dealtBy(state, 0)?.dealt).toBe(50);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §4 — Galvantula \"Compound Eyes\": +50 into an Active that HAS an Ability (R-GV)", () => {
  const galv = (oppActive: string, oppBench: readonly string[] = [], bench: readonly string[] = []) =>
    table(GALVANTULA, bench, oppActive, oppBench, [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
    ]);

  it("into a defender WITHOUT an Ability: Shocking Web's printed 50", () => {
    const row = dealtBy(galv(WALL), 0);
    expect(row?.bonus).toBeUndefined();
    expect(row?.dealt).toBe(50);
  });

  it("into a defender WITH an Ability: 50 + 50 = 100", () => {
    const row = dealtBy(galv(ABLE), 0);
    expect(row?.bonus).toBe(50);
    expect(row?.dealt).toBe(100);
  });

  it("🛑 the ORDER with ×2 Weakness: (50 + 50) × 2 = 200, never 50 × 2 + 50", () => {
    expect(dealtBy(galv(PSY_WEAK_ABLE), 0)?.dealt).toBe(200);
  });

  it("the fold both pre-W/R sites call (`attackerPreWRBonus`), read directly — not a snipe-path drive", () => {
    // Galvantula prints one attack and no snipe, so the snipeActive PATH is not driven here;
    // this calls the one fold both sites share. The snipe path itself is driven in §3 (Annihilape).
    const state = galv(ABLE);
    const card = POOL[ABLE] as Card;
    expect(attackerPreWRBonus(state, body(state, "p1"), "p1", card)).toBe(50);
    expect(attackerPreWRBonus(galv(WALL), body(galv(WALL), "p1"), "p1", POOL[WALL] as Card)).toBe(0);
  });

  it("the lock boards: an Active Klefki and an Active Gastrodon each HAVE an Ability", () => {
    expect(dealtBy(galv(KLEFKI), 0)?.dealt).toBe(100);
    // Gastrodon is ×2 {G}: the bonus lands BEFORE Weakness, (50 + 50) × 2 = 200. An Active
    // Gastrodon's own lock is off (`sourceOnBench`), and its Ability is still printed.
    const row = dealtBy(galv(GASTRODON), 0);
    expect(row?.bonus).toBe(50);
    expect(row?.dealt).toBe(200);
  });

  it("🛑 R-GV: a LOCKED Ability still counts — Spiritomb on p1's Bench silences the Basic V", () => {
    const state = galv(ABLE_V, [], [SPIRITOMB]);
    expect(disabledAbilityUids(state).has(topOf(body(state, "p2")))).toBe(true);
    expect(dealtBy(state, 0)?.dealt).toBe(100);
  });

  it("and an opposing Active Flutter Mane silences Compound Eyes ITSELF: 50, not 100", () => {
    // Flutter Mane has an Ability (so the gate holds) — but it locks the OPPOSING Active,
    // which is Galvantula, so the passive never reaches the fold.
    const state = galv(FLUTTER);
    expect(disabledAbilityUids(state).has(topOf(body(state, "p1")))).toBe(true);
    expect(dealtBy(state, 0)?.dealt).toBe(50);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §5 — Magmortar \"Magma Surge\": 3 more counters on the opposing Burn (R-MG)", () => {
  /** p1's board with `mine` in play, p2's Active Burned; p1 ends the turn → the Checkup. */
  function checkup(active: string, bench: readonly string[], oppActive = WALL, face?: "heads" | "tails") {
    let state = setConditions(table(active, bench, oppActive, [], []), "p2", { burned: true });
    if (face !== undefined) state = withCoin(state, face);
    return mustApply(state, { type: "endTurn", seat: "p1" });
  }
  const burnRow = (events: GameEvent[], seat: Seat) =>
    events.find((e) => e.type === "COUNTERS_PLACED" && e.seat === seat && e.source === "burn") as
      | Extract<GameEvent, { type: "COUNTERS_PLACED" }>
      | undefined;

  it("no Magmortar: the rulebook's 20", () => {
    expect(burnRow(checkup(NORM, []).events, "p2")?.amount).toBe(20);
  });

  it("one Magmortar (Active or Benched): 20 + 30 = 50, ONE summed row", () => {
    for (const board of [checkup(MAGMORTAR, []), checkup(NORM, [MAGMORTAR])]) {
      const rows = board.events.filter((e) => e.type === "COUNTERS_PLACED" && e.seat === "p2");
      expect(rows).toHaveLength(1);
      expect(burnRow(board.events, "p2")?.amount).toBe(50);
      expect(body(board.state, "p2").damage).toBe(50);
    }
  });

  it("🛑 it stacks per Magmortar: two give 20 + 60 = 80", () => {
    expect(burnRow(checkup(MAGMORTAR, [MAGMORTAR]).events, "p2")?.amount).toBe(80);
  });

  it("🛑 the counters land BEFORE the cure flip: 50 on heads (Burn cured) AND on tails", () => {
    for (const face of ["heads", "tails"] as const) {
      const { state, events } = checkup(MAGMORTAR, [], WALL, face);
      const order = events.map((e) => e.type);
      expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("CHECKUP_COIN_FLIP"));
      expect(find(events, "CHECKUP_COIN_FLIP")?.result).toBe(face);
      expect(body(state, "p2").damage).toBe(50);
      expect(body(state, "p2").conditions.burned).toBe(face === "tails");
    }
  });

  it("\"your OPPONENT's\" — p2's own Magmortar adds nothing to p2's Burn", () => {
    expect(burnRow(checkup(NORM, [], MAGMORTAR).events, "p2")?.amount).toBe(20);
    expect(seatBurnExtraCounters(table(NORM, [], MAGMORTAR, [], []), "p2")).toBe(0);
    expect(seatBurnExtraCounters(table(NORM, [], MAGMORTAR, [], []), "p1")).toBe(30);
  });

  it("🛑 silenced by a §9 lock: an opposing Active Flutter Mane over an Active Magmortar → 20", () => {
    expect(burnRow(checkup(MAGMORTAR, [], FLUTTER).events, "p2")?.amount).toBe(20);
    // …and a BENCHED Magmortar is out of Flutter Mane's reach: 50.
    expect(burnRow(checkup(NORM, [MAGMORTAR], FLUTTER).events, "p2")?.amount).toBe(50);
  });

  it("an un-Burned Active takes nothing, Magmortar or not", () => {
    const { events } = mustApply(table(MAGMORTAR, [], WALL, [], []), { type: "endTurn", seat: "p1" });
    expect(burnRow(events, "p2")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §6 — Thwackey \"Boom Boom Groove\": the printed Festival Lead gate (R-TW)", () => {
  const use = (state: GameState) =>
    applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Boom Boom Groove",
    });

  it("gate TRUE (a Festival Lead Active, Basic or Stage 1): parks a 1-card search into the hand", () => {
    for (const lead of [GOLDEEN, DIPPLIN]) {
      const result = use(table(lead, [THWACKEY[0]], WALL, [], []));
      expect(result.ok, lead).toBe(true);
      if (!result.ok) continue;
      expect(result.state.phase.kind).toBe("effect:choose");
      const prompt = (result.state.phase as { prompt: { kind: string; max: number; dest: string } }).prompt;
      expect(prompt).toMatchObject({ kind: "chooseCards", max: 1, dest: "hand" });
    }
  });

  it("gate FALSE (an Active with no Festival Lead): ABILITY_CONDITION_NOT_MET, naming it", () => {
    for (const active of [WALL, ABLE]) {
      const result = use(table(active, [THWACKEY[1]], WALL, [], []));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("ABILITY_CONDITION_NOT_MET");
      expect(result.error.message).toContain("your Active Pokémon has the Festival Lead Ability");
    }
  });

  it("🛑 R-TW: a LOCKED Festival Lead Active still satisfies it (an opposing Flutter Mane)", () => {
    const state = table(GOLDEEN, [THWACKEY[0]], FLUTTER, [], []);
    expect(disabledAbilityUids(state).has(topOf(body(state, "p1")))).toBe(true);
    expect(use(state).ok).toBe(true);
  });

  it("the search takes ANY card, then shuffles; once per turn per Thwackey", () => {
    const state = table(GOLDEEN, [THWACKEY[0]], WALL, [], []);
    const parked = must(use(state));
    const deck = parked.players.p1.deck;
    const pick = deck.find((u) => parked.cardIdByUid[u] === "fix-grass-energy") as string;
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(after.players.p1.hand).toContain(pick);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
    const again = use(after);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §7 — Cradily \"Selective Slime\": heads, then two binary picks (R-CR)", () => {
  const use = (face: "heads" | "tails") =>
    mustApply(withCoin(table(NORM, [CRADILY], WALL, [], []), face), {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Selective Slime",
    });
  const confirm = (state: GameState, yes: boolean) =>
    mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
  const labels = (state: GameState) => (state.phase as { prompt: { labels?: unknown } }).prompt.labels;

  it("tails: nothing is asked and nothing lands", () => {
    const { state, events } = use("tails");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(events.some((e) => e.type === "STATUS_APPLIED")).toBe(false);
  });

  it("heads → yes \"Burned\": the opposing Active is Burned", () => {
    const parked = use("heads").state;
    expect(labels(parked)).toEqual({ yes: "Burned", no: "Confused or Poisoned" });
    const done = confirm(parked, true).state;
    expect(body(done, "p2").conditions).toMatchObject({ burned: true, rotation: "none", poisonDamage: 0 });
  });

  it("heads → no → yes \"Confused\"", () => {
    const second = confirm(use("heads").state, false).state;
    expect(labels(second)).toEqual({ yes: "Confused", no: "Poisoned" });
    const done = confirm(second, true).state;
    expect(body(done, "p2").conditions).toMatchObject({ burned: false, rotation: "confused", poisonDamage: 0 });
  });

  it("heads → no → no \"Poisoned\"", () => {
    const done = confirm(confirm(use("heads").state, false).state, false).state;
    expect(body(done, "p2").conditions).toMatchObject({ burned: false, rotation: "none", poisonDamage: 10 });
  });
});
