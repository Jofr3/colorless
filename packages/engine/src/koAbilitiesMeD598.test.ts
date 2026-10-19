import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { disabledAbilityUids, koSurvivalCoinFlip, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { koByOpponentAttack, koByOpponentPokemonEx } from "./flow";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  battler,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setConditions,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

// ── 🆕🆕🆕 D598 — WP32: KO / DAMAGE-TAKEN ABILITIES ──
//
// 6 printed texts / 13 `me` printings: Mega Gengar ex "Shadowy Concealment" ×5 (a seat-wide Prize
// reduction on the KO'd side, `seatKoPrizeReduction`), Mega Hawlucha ex "Tenacious Body" ×3 and
// Annihilape "Durable Body" (the coin-flip survival, `survivesKoOnCoinFlip`), Shedinja "Fragile Husk"
// ×2 (the `pokemonExAttackPrevent` Prize guard), Gengar "Infinite Shadow" (`koSelfToHand`) and
// Pecharunt "Final Chain" (an on-KO program behind `byOpponentAttack`). Every id and text off the
// LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`. No `me` row
// is a fixture, so the printed bytes are carried HERE.

const SHADOWY_CONCEALMENT =
  "If 1 of your {D} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, that player takes 1 fewer Prize card. The effect of Shadowy Concealment doesn't stack.";
const TENACIOUS_BODY =
  "If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10.";
const FRAGILE_HUSK =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon ex, your opponent can't take any Prize cards for it.";
const INFINITE_SHADOW =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, put it into your hand instead of the discard pile. (Discard all attached cards.)";
const FINAL_CHAIN =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for a card and put it into your hand. Then, shuffle your deck.";

const MEGA_GENGAR = ["me02-056", "me02.5-125", "me02.5-269", "me02.5-284", "mep-073"] as const;
const MEGA_HAWLUCHA = ["me02.5-116", "me02.5-268", "me02.5-283"] as const;
const ANNIHILAPE = "me05-041";
const SHEDINJA = ["me01-061", "me01-144"] as const;
const GENGAR = "me03-050";
const PECHARUNT = "me02.5-143";

describe("D598 §1 — the texts and the registry rows", () => {
  it("13 keys on 6 objects, each a printed Ability at the printed parameters", () => {
    for (const id of MEGA_GENGAR) {
      expect(programFor(id), id).toEqual({
        passive: {
          seatKoPrizeReduction: {
            ability: "Shadowy Concealment",
            by: 1,
            koTarget: { kind: "typedPokemon", pokemonType: "Darkness" },
          },
        },
      });
    }
    for (const id of MEGA_HAWLUCHA) {
      expect(programFor(id), id).toEqual({ passive: { survivesKoOnCoinFlip: "Tenacious Body" } });
    }
    expect(programFor(ANNIHILAPE)).toEqual({ passive: { survivesKoOnCoinFlip: "Durable Body" } });
    for (const id of SHEDINJA) {
      expect(programFor(id), id).toEqual({
        triggered: [
          { name: "Fragile Husk", trigger: "onKnockOut", program: [], onKoPrizeGuard: "pokemonExAttackPrevent" },
        ],
      });
    }
    expect(programFor(GENGAR)).toEqual({ passive: { koSelfToHand: true } });
    expect(programFor(PECHARUNT)?.triggered?.[0]).toMatchObject({
      name: "Final Chain",
      trigger: "onKnockOut",
      byOpponentAttack: true,
    });
    // One object per text; the two survival texts are one sentence under two names.
    expect(programFor(MEGA_GENGAR[0])).toBe(programFor(MEGA_GENGAR[4]));
    expect(programFor(SHEDINJA[0])).toBe(programFor(SHEDINJA[1]));
    expect(programFor(MEGA_HAWLUCHA[0])).not.toBe(programFor(ANNIHILAPE));
  });

  it("Final Chain's program is the attack reader's for the same consequent, byte for byte", () => {
    const consequent = FINAL_CHAIN.slice(FINAL_CHAIN.indexOf("search")).replace(/^s/, "S");
    expect(programFor(PECHARUNT)?.triggered?.[0]?.program).toEqual(deriveAttackEffect(consequent));
  });

  it("the five dropped WP32 texts stay unkeyed (decisions.md D598) (🆕🆕🆕 D626 (D539): ~~five~~ — Fainting Spell ×2 and Photon Cord ×2 are keyed since D626, K1) (🆕🆕🆕 D632 (D539): WITHDRAWN for Damp — keyed since D632, D1) (🆕🆕🆕 D642 (D539): WITHDRAWN for the rest — Spiteful Swirl ×2 and Counterattack Grouping keyed since D642, K2)", () => {
    // Spiteful Swirl ×2, Counterattack Grouping [🆕🆕🆕 D642 (D539): BUILT at D642], Damp [🆕🆕🆕 D632 (D539): BUILT at D632]. [🆕🆕🆕 D626 (D539): Fainting Spell ×2 and Photon Cord ×2
    // BUILT at D626 — `koTriggerRestMeD626.test.ts`.]
    // 🆕🆕🆕 D632 (D539) — Damp `me02.5-039` / `-040` left this list: keyed at D632 (`dampD632.test.ts`).
    // 🆕🆕🆕 D642 (D539) — WITHDRAWN for Spiteful Swirl ×2 and Counterattack Grouping: keyed since D642 (K2,
    // `stadiumWatchedMeD642.test.ts`); the rung is inverted.
    for (const id of ["me01-087", "me01-148", "30th-022"]) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of ["me02.5-039", "me02.5-040"]) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    for (const id of ["30th-090", "30th-154", "me05-028", "mep-082"]) expect(programFor(id), id).toBeDefined();
  });
});

// ── ON A BOARD ──

const FILLER = "d598-filler"; // {C} Basic, 400 HP
const FOE = "d598-foe"; // a non-ex attacker
const FOE_EX = "d598-foe-ex"; // an ex attacker
const DARK = "d598-dark"; // a {D} non-ex Basic, 100 HP
const DARK_EX = "d598-dark-ex"; // a {D} Basic ex, 200 HP
const PSY_EX = "d598-psy-ex"; // a {P} Basic ex, 200 HP
const GASTLY = "d598-gastly";
const HAUNTER = "d598-haunter";
/** Flutter Mane — "Midnight Fluttering" (registry `MIDNIGHT_FLUTTERING`): the opposing Active has no Abilities. */
const FLUTTER = "sv05-078";
/** Iron Thorns ex — "Initialization" (registry `INITIALIZATION`): while Active, Rule Box Pokémon have no Abilities. */
const IRON_THORNS = "sv06-077";
/** Milotic — "Mentally Calm" (registry `MENTALLY_CALM`): the opponent's in-play cards can't go to their hand. */
const MILOTIC = "sv06-050";
/** Legacy Energy — 1 fewer Prize, once per game (registry `LEGACY_ENERGY`). */
const LEGACY = "sv06-167";
/** Togekiss — "Wonder Kiss" (registry `WONDER_KISS`): a coin for 1 more Prize when the opposing Active is KO'd. */
const TOGEKISS = "sv08-072";
/** Survival Brace — the full-HP KO-survival Tool (registry, D562): answers before the coin (R-SB2). */
const BRACE = "sv06-164";
const E = "fix-energy";
const D = "d598-darkness";
/** Never on a board: the Prize swap's stock. */
const SPARE = "d598-spare";

const SPREAD =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SNIPE = "This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const WIDE_SPREAD =
  "This attack also does 200 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const WIDE_SNIPE =
  "This attack does 300 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** Attack 0 hits the Active for 300; 1 spreads 10 onto the Bench; 2 snipes 50 at a chosen body; 3 taps for 10;
    4 spreads 200 onto the Bench; 5 snipes 300 at a chosen body (4 and 5 reach a full-HP benched body lethally). */
const MOVES: Card["attacks"] = [
  { cost: ["Colorless"], name: "Crush", damage: 300 },
  { cost: ["Colorless"], name: "Splash", damage: 10, effect: SPREAD },
  { cost: ["Colorless"], name: "Snipe", effect: SNIPE },
  { cost: ["Colorless"], name: "Tap", damage: 10 },
  { cost: ["Colorless"], name: "Wide Splash", damage: 10, effect: WIDE_SPREAD },
  { cost: ["Colorless"], name: "Wide Snipe", effect: WIDE_SNIPE },
];
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const ability = (name: string, effect: string) => ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 1, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  [MEGA_GENGAR[0]]: mon(MEGA_GENGAR[0], "Mega Gengar ex", 350, "Darkness", TAP, {
    stage: "Stage2",
    evolveFrom: "Haunter",
    ...ability("Shadowy Concealment", SHADOWY_CONCEALMENT),
  }),
  [MEGA_GENGAR[1]]: mon(MEGA_GENGAR[1], "Mega Gengar ex", 350, "Darkness", TAP, {
    stage: "Stage2",
    evolveFrom: "Haunter",
    ...ability("Shadowy Concealment", SHADOWY_CONCEALMENT),
  }),
  [MEGA_HAWLUCHA[0]]: mon(MEGA_HAWLUCHA[0], "Mega Hawlucha ex", 250, "Fighting", TAP, ability("Tenacious Body", TENACIOUS_BODY)),
  [ANNIHILAPE]: mon(ANNIHILAPE, "Annihilape", 150, "Psychic", TAP, {
    stage: "Stage2",
    evolveFrom: "Primeape",
    ...ability("Durable Body", TENACIOUS_BODY),
  }),
  [SHEDINJA[0]]: mon(SHEDINJA[0], "Shedinja", 60, "Psychic", TAP, {
    stage: "Stage1",
    evolveFrom: "Nincada",
    ...ability("Fragile Husk", FRAGILE_HUSK),
  }),
  [GENGAR]: mon(GENGAR, "Gengar", 130, "Darkness", TAP, {
    stage: "Stage2",
    evolveFrom: "Haunter",
    ...ability("Infinite Shadow", INFINITE_SHADOW),
  }),
  [PECHARUNT]: mon(PECHARUNT, "Pecharunt", 80, "Darkness", TAP, ability("Final Chain", FINAL_CHAIN)),
  [FILLER]: mon(FILLER, "D598 Filler", 400, "Colorless", TAP),
  [FOE]: mon(FOE, "D598 Foe", 400, "Colorless", MOVES),
  [FOE_EX]: mon(FOE_EX, "D598 Foe ex", 400, "Colorless", MOVES),
  [DARK]: mon(DARK, "D598 Dark", 100, "Darkness", TAP),
  [DARK_EX]: mon(DARK_EX, "D598 Dark ex", 200, "Darkness", TAP),
  [PSY_EX]: mon(PSY_EX, "D598 Psy ex", 200, "Psychic", TAP),
  [GASTLY]: mon(GASTLY, "Gastly", 50, "Darkness", TAP),
  [HAUNTER]: mon(HAUNTER, "Haunter", 80, "Darkness", TAP, { stage: "Stage1", evolveFrom: "Gastly" }),
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, "Psychic", MOVES, ability("Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.")),
  [IRON_THORNS]: mon(IRON_THORNS, "Iron Thorns ex", 230, "Lightning", MOVES, ability("Initialization", "As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) (except any Future Pokémon) have no Abilities.")),
  [MILOTIC]: mon(MILOTIC, "Milotic", 120, "Water", TAP, ability("Mentally Calm", "Your opponent's Pokémon in play and all attached cards can't be put into your opponent's hand.")),
  [LEGACY]: specialEnergy(LEGACY, "Legacy Energy", "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time. If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This effect of your Legacy Energy can't be applied more than once per game."),
  [TOGEKISS]: mon(TOGEKISS, "Togekiss", 140, "Psychic", TAP, {
    stage: "Stage2",
    evolveFrom: "Togetic",
    ...ability("Wonder Kiss", "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more Prize card. The effect of Wonder Kiss doesn't stack."),
  }),
  [BRACE]: {
    ...trainerCard(
      BRACE,
      "Tool",
      "If the Pokémon this card is attached to has full HP and would be Knocked Out by damage from an attack from your opponent's Pokémon, it is not Knocked Out, and its remaining HP becomes 10. Then, discard this card.",
    ),
    name: "Survival Brace",
  },
  [D]: typedEnergy(D, "Darkness"),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [MEGA_GENGAR[0]]: 1,
  [MEGA_GENGAR[1]]: 1,
  [MEGA_HAWLUCHA[0]]: 1,
  [ANNIHILAPE]: 1,
  [SHEDINJA[0]]: 1,
  [GENGAR]: 1,
  [PECHARUNT]: 1,
  [FILLER]: 10,
  [FOE]: 1,
  [FOE_EX]: 1,
  [DARK]: 1,
  [DARK_EX]: 2,
  [PSY_EX]: 1,
  [GASTLY]: 1,
  [HAUNTER]: 1,
  [FLUTTER]: 1,
  [IRON_THORNS]: 1,
  [MILOTIC]: 1,
  [LEGACY]: 1,
  [TOGEKISS]: 1,
  [BRACE]: 1,
  [E]: 8,
  [D]: 4,
});
const BOARD_IDS = Object.keys(LOCAL)
  .filter((id) => id !== SPARE)
  .concat([E]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5984, decks: { p1: [...DECK, ...FILLERS], p2: [...DECK, ...FILLERS] }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}
/** Plain Energy padding so the Prize swap never draws a board card. */
const FILLERS: string[] = deckOf({ [SPARE]: 17 });

/** TEST SURGERY — every Prize whose id is in `ids` swapped with a deck card whose id is not. */
function unprize(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  const kept = new Set(ids);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with one Energy; P2's Active is `defender` over `bench`. 6 Prizes each. */
function table(attacker: string, defender: string, bench: readonly string[] = [FILLER]): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) {
    state = clearBench(setActiveFromDeck(state, s, FILLER), s);
    state = unprize(state, s, BOARD_IDS);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = benchFromDeck(attachFromDeck(state, "p1", E, 1), "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

type Body = NonNullable<GameState["players"]["p1"]["active"]>;
function edit(state: GameState, seat: Seat, where: "active" | number, change: (b: Body) => Body): GameState {
  const side = state.players[seat];
  if (where === "active") {
    if (side.active === null) throw new Error(`no ${seat} Active`);
    return { ...state, players: { ...state.players, [seat]: { ...side, active: change(side.active) } } };
  }
  const bench = side.bench.map((b, i) => (i === where ? change(b) : b));
  return { ...state, players: { ...state.players, [seat]: { ...side, bench } } };
}
const hurt = (state: GameState, seat: Seat, where: "active" | number, damage: number) =>
  edit(state, seat, where, (b) => ({ ...b, damage }));

/** The first rng state at or after `from` whose NEXT flip is `face`. */
function rngFor(face: "heads" | "tails", from = 1): number {
  for (let r = from; ; r += 1) if (flipCoin(r)[0] === face) return r;
}
const seeded = (state: GameState, face: "heads" | "tails") => ({ ...state, rngState: rngFor(face) });

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const top = (state: GameState, seat: Seat) => state.players[seat].active?.stack.at(-1) ?? "";
/** The Prize count P1 is owed after a Knock Out: the parked pick, or 0 when none parked. */
const owed = (state: GameState) => (state.phase.kind === "ko:takePrizes" ? state.phase.count : 0);

describe("D598 §2 — Shadowy Concealment: 1 fewer Prize for a {D} body KO'd by an ex's attack", () => {
  const gengarBench = (defender: string, attacker = FOE_EX, bench: readonly string[] = [MEGA_GENGAR[0]]) =>
    table(attacker, defender, bench);

  it("a {D} ex KO'd by an ex: 2 → 1, the reduction logged on the Mega Gengar", () => {
    const state = gengarBench(DARK_EX);
    const gengar = state.players.p2.bench[0]?.stack.at(-1);
    const dying = top(state, "p2");
    const { state: after, events } = mustApply(state, attack(0));
    expect(owed(after)).toBe(1);
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: gengar, ability: "Shadowy Concealment" },
    ]);
    expect(of(events, "PRIZE_REDUCED")).toEqual([{ type: "PRIZE_REDUCED", seat: "p2", uid: dying, by: 1, count: 1 }]);
    // No other KO Ability on this board: no coin, and the body goes to the discard pile.
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(after.players.p2.hand).toEqual([]);
    expect(after.players.p2.discard).toContain(dying);
  });

  it("the Mega Gengar ex itself, KO'd by an ex: 3 → 2 (the dying body's own Ability answers)", () => {
    const state = hurt(gengarBench(MEGA_GENGAR[0], FOE_EX, [FILLER]), "p2", "active", 100);
    expect(owed(mustApply(state, attack(0)).state)).toBe(2);
  });

  it("a non-ex attacker, a non-{D} victim, or no Mega Gengar: no reduction", () => {
    expect(owed(mustApply(gengarBench(DARK_EX, FOE), attack(0)).state)).toBe(2);
    expect(owed(mustApply(gengarBench(PSY_EX), attack(0)).state)).toBe(2);
    expect(owed(mustApply(gengarBench(DARK_EX, FOE_EX, [FILLER]), attack(0)).state)).toBe(2);
  });

  it("a 1-Prize {D} body KO'd by an ex: 1 → 0, so no Prize is taken", () => {
    const { state: after, events } = mustApply(gengarBench(DARK), attack(0));
    expect(owed(after)).toBe(0);
    expect(after.players.p1.prizes).toHaveLength(6);
    expect(of(events, "PRIZE_REDUCED").map((e) => e.count)).toEqual([0]);
  });

  // 🆕🆕🆕 D601 — R-GC2 (UNRULED): the attached reductions answer BEFORE Shadowy Concealment, so a Legacy
  // Energy on a 1-Prize {D} body is spent (its once-per-game latch) and Concealment finds 0. Reversal:
  // Concealment first, which reaches 0 alone and leaves Legacy unspent.
  it("nothing left to reduce is not an application: Legacy Energy took the 1-Prize {D} body to 0 first (R-GC2)", () => {
    const state = attachFromDeck(gengarBench(DARK), "p2", LEGACY, 1);
    const { state: after, events } = mustApply(state, attack(0));
    expect(owed(after)).toBe(0);
    expect(of(events, "PRIZE_REDUCED")).toHaveLength(1);
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(after.oncePerGameSpent.p2).toHaveLength(1); // the Legacy latch is the one spent
  });

  it("doesn't stack: two Mega Gengar ex reduce once", () => {
    const { state: after, events } = mustApply(gengarBench(DARK_EX, FOE_EX, [MEGA_GENGAR[0], MEGA_GENGAR[1]]), attack(0));
    expect(owed(after)).toBe(1);
    expect(of(events, "ABILITY_TRIGGERED")).toHaveLength(1);
  });

  // 🆕🆕🆕 D601 — R-GC3 (UNRULED): "If 1 of your {D} Pokémon is Knocked Out … 1 fewer" is read PER KNOCK
  // OUT, so one ex attack that KOs two {D} bodies reduces each. The reversal (1 fewer for the whole
  // Prize-taking) would leave 3 here.
  it("R-GC3: two {D} ex KO'd by one ex attack (the Active and a benched one): 1 fewer for EACH, 2 → 1 twice", () => {
    const state = hurt(gengarBench(DARK_EX, FOE_EX, [MEGA_GENGAR[0], DARK_EX]), "p2", "active", 190);
    const gengar = state.players.p2.bench[0]?.stack.at(-1);
    const active = top(state, "p2");
    const benched = state.players.p2.bench[1]?.stack.at(-1);
    const { state: after, events } = mustApply(state, attack(4)); // Wide Splash: 10 to the Active, 200 to each Benched
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid).sort()).toEqual([active, benched].sort());
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: gengar, ability: "Shadowy Concealment" },
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: gengar, ability: "Shadowy Concealment" },
    ]);
    expect(of(events, "PRIZE_REDUCED").map((e) => [e.uid, e.by, e.count])).toEqual([
      [active, 1, 1],
      [benched, 1, 1],
    ]);
    // Two Prize stages of 1 each (the first is the parked pick): P1 takes 2, not 4 and not 3.
    expect(owed(after)).toBe(1);
    expect(after.pending.filter((s) => s.kind === "takePrizes").map((s) => s.count)).toEqual([1, 1]);
  });

  it("§9: an Active Iron Thorns ex (an ex attacker) silences the benched Mega Gengar ex", () => {
    const state = gengarBench(DARK_EX, IRON_THORNS);
    expect(disabledAbilityUids(state).has(state.players.p2.bench[0]?.stack.at(-1) ?? "")).toBe(true);
    expect(owed(mustApply(state, attack(0)).state)).toBe(2);
  });

  it("a Checkup Knock Out has no attack: no reduction", () => {
    let state = setConditions(hurt(gengarBench(DARK_EX), "p2", "active", 190), "p2", { poisonDamage: 10 });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1", count: 2 });
  });
});

describe("D598 §3 — the \"KO'd by an ex\" condition, by clause", () => {
  const state = table(FOE_EX, DARK_EX);
  const ref = { seat: "p2" as Seat, uid: top(state, "p2") };
  const exUid = top(state, "p1");
  const plainUid = state.players.p1.bench[0]?.stack.at(-1) ?? "";

  it("holds for an attack epilogue from the other seat by an ex; each clause refuses alone", () => {
    expect(koByOpponentPokemonEx(state, ref, "p1", exUid)).toBe(true);
    expect(koByOpponentPokemonEx(state, ref, undefined, exUid)).toBe(false);
    expect(koByOpponentPokemonEx(state, ref, "p2", exUid)).toBe(false);
    expect(koByOpponentPokemonEx(state, ref, "p1", undefined)).toBe(false);
    expect(koByOpponentPokemonEx(state, ref, "p1", plainUid)).toBe(false);
  });

  it("a `knockOutDefender` doom is not damage", () => {
    const doomed = edit(state, "p2", "active", (b) => ({ ...b, markers: [...b.markers, koByEffectMarker(state.turn)] }));
    expect(koByOpponentAttack(doomed, ref, "p1")).toBe(false);
    expect(koByOpponentPokemonEx(doomed, ref, "p1", exUid)).toBe(false);
    expect(koByOpponentAttack(state, ref, "p1")).toBe(true);
  });

  // 🆕🆕🆕 D601 (D598 review M2) — a ref with no body on the board answers FALSE, not `byAttackFor`'s TRUE:
  // the D598 rows had no pre-D414 behaviour to degrade to, so a miss withholds (decisions.md D601).
  it("a ref whose body is not on the board answers false (fail-closed, unlike `byAttackFor`)", () => {
    const ghost = { seat: "p2" as Seat, uid: "d601-no-such-body" };
    expect(koByOpponentAttack(state, ghost, "p1")).toBe(false);
    expect(koByOpponentPokemonEx(state, ghost, "p1", exUid)).toBe(false);
  });
});

describe("D598 §4 — Fragile Husk: no Prize for a KO by an ex's attack", () => {
  it("KO'd by an ex: PRIZE_PREVENTED, no Prize taken", () => {
    const state = table(FOE_EX, SHEDINJA[0]);
    const husk = top(state, "p2");
    const { state: after, events } = mustApply(state, attack(0));
    expect(owed(after)).toBe(0);
    expect(after.players.p1.prizes).toHaveLength(6);
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: husk, ability: "Fragile Husk" },
    ]);
    expect(of(events, "PRIZE_PREVENTED")).toEqual([{ type: "PRIZE_PREVENTED", seat: "p2", uid: husk }]);
  });

  it("KO'd by a non-ex: 1 Prize, nothing logged", () => {
    const { state: after, events } = mustApply(table(FOE, SHEDINJA[0]), attack(0));
    expect(owed(after)).toBe(1);
    expect(of(events, "PRIZE_PREVENTED")).toEqual([]);
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([]);
  });

  it("a PROHIBITION (D323): the attacker's Togekiss does not flip Wonder Kiss for a prevented Prize", () => {
    const state = seeded(benchFromDeck(table(FOE_EX, SHEDINJA[0]), "p1", TOGEKISS), "heads");
    const { state: after, events } = mustApply(state, attack(0));
    expect(owed(after)).toBe(0);
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
    // The control: a non-ex KO pays 1, and Wonder Kiss flips (heads) for 1 more.
    const control = mustApply(seeded(benchFromDeck(table(FOE, SHEDINJA[0]), "p1", TOGEKISS), "heads"), attack(0));
    expect(owed(control.state)).toBe(2);
  });
});

describe("D598 §5 — Tenacious Body / Durable Body: a coin for the would-be Knock Out", () => {
  const hawlucha = (attacker = FOE) => table(attacker, MEGA_HAWLUCHA[0]);

  it("heads at the main hit: not Knocked Out, 10 HP left, `survived: true`", () => {
    const state = seeded(hawlucha(), "heads");
    const uid = top(state, "p2");
    const { state: after, events } = mustApply(state, attack(0));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([
      { type: "ABILITY_COIN_FLIP", seat: "p2", uid, ability: "Tenacious Body", result: "heads" },
    ]);
    expect(of(events, "KNOCKED_OUT")).toEqual([]);
    expect(after.players.p2.active?.damage).toBe(240);
    expect(of(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 300, damage: 240, survived: true });
    // The coin is drawn once, from the board's rng.
    expect(after.rngState).toBe(flipCoin(rngFor("heads"))[1]);
  });

  it("tails: Knocked Out, the row carries no `survived`", () => {
    const { events } = mustApply(seeded(hawlucha(), "tails"), attack(0));
    expect(of(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual(["tails"]);
    expect(of(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(of(events, "DAMAGE_DEALT")[0]?.survived).toBeUndefined();
  });

  it("a hit that would not Knock Out flips nothing", () => {
    const { events } = mustApply(seeded(hawlucha(), "heads"), attack(3));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
  });

  it("no full-HP antecedent: a damaged Hawlucha flips too", () => {
    const { state: after, events } = mustApply(seeded(hurt(hawlucha(), "p2", "active", 240), "heads"), attack(3));
    expect(of(events, "ABILITY_COIN_FLIP")).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(240);
  });

  it("a Bench spread finishing a benched Annihilape flips under its own name", () => {
    let state = table(FOE, FILLER, [ANNIHILAPE]);
    state = seeded(hurt(state, "p2", 0, 140), "heads");
    const uid = state.players.p2.bench[0]?.stack.at(-1);
    const { state: after, events } = mustApply(state, attack(1));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([
      { type: "ABILITY_COIN_FLIP", seat: "p2", uid, ability: "Durable Body", result: "heads" },
    ]);
    expect(after.players.p2.bench[0]?.damage).toBe(140);
    expect(of(events, "DAMAGE_DEALT").find((e) => e.uid === uid)?.survived).toBe(true);
  });

  it("two coins in one spread are two draws: Durable Body heads, then Tenacious Body tails", () => {
    // The rng each body's flip reads must be the previous flip's advance (`spreadDamage`'s `rng`).
    let seed = 1;
    while (flipCoin(seed)[0] !== "heads" || flipCoin(flipCoin(seed)[1])[0] !== "tails") seed += 1;
    let state = table(FOE, FILLER, [ANNIHILAPE, MEGA_HAWLUCHA[0]]);
    state = { ...hurt(hurt(state, "p2", 0, 140), "p2", 1, 240), rngState: seed };
    const { state: after, events } = mustApply(state, attack(1));
    expect(of(events, "ABILITY_COIN_FLIP").map((e) => [e.ability, e.result])).toEqual([
      ["Durable Body", "heads"],
      ["Tenacious Body", "tails"],
    ]);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([140]);
    expect(after.rngState).toBe(flipCoin(flipCoin(seed)[1])[1]);
  });

  it("a chosen snipe: the Bench arm and the Active arm both flip", () => {
    const pick = (spot: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
      ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot }] } }) as GameAction;
    // The Bench arm (`placeSnipe`'s `deals` arm).
    let state = seeded(hurt(table(FOE, FILLER, [ANNIHILAPE]), "p2", 0, 140), "heads");
    let parked = mustApply(state, attack(2)).state;
    let done = mustApply(parked, pick({ spot: "bench", index: 0 }));
    expect(of(done.events, "ABILITY_COIN_FLIP").map((e) => e.ability)).toEqual(["Durable Body"]);
    expect(done.state.players.p2.bench[0]?.damage).toBe(140);
    // The coin's draw is kept: the board's rng is the flip's advance, not the parked one.
    expect(done.state.rngState).toBe(flipCoin(parked.rngState)[1]);
    // The Active arm (`snipeActive`).
    state = seeded(hurt(hawlucha(), "p2", "active", 220), "heads");
    parked = mustApply(state, attack(2)).state;
    done = mustApply(parked, pick({ spot: "active" }));
    expect(of(done.events, "ABILITY_COIN_FLIP").map((e) => e.ability)).toEqual(["Tenacious Body"]);
    expect(done.state.players.p2.active?.damage).toBe(240);
    expect(of(done.events, "DAMAGE_DEALT")[0]?.survived).toBe(true);
    expect(done.state.rngState).toBe(flipCoin(parked.rngState)[1]);
  });

  it("§9: Flutter Mane's lock on the Active Hawlucha — no coin, Knocked Out", () => {
    const state = seeded(hurt(table(FLUTTER, MEGA_HAWLUCHA[0]), "p2", "active", 240), "heads");
    expect(passivesOf(state, state.players.p2.active as Body).survivesKoOnCoinFlip).toBeNull();
    const { events } = mustApply(state, attack(3));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(of(events, "KNOCKED_OUT")).toHaveLength(1);
  });

  it("an already lethally damaged body flips nothing; the coin advances the rng once", () => {
    const state = hurt(hawlucha(), "p2", "active", 250);
    const body = state.players.p2.active as Body;
    const events: GameEvent[] = [];
    expect(koSurvivalCoinFlip(state, body, "p2", 10, events)).toEqual([null, state.rngState]);
    expect(events).toEqual([]);
    const live = hurt(hawlucha(), "p2", "active", 240);
    const [saved, rng] = koSurvivalCoinFlip(seeded(live, "heads"), live.players.p2.active as Body, "p2", 10, events);
    expect([saved, rng]).toEqual([240, flipCoin(rngFor("heads"))[1]]);
  });

  it("R-SB2: a Survival Brace answers first at all four writes — the Brace is spent, no coin, the rng unmoved", () => {
    const pick = (spot: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
      ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot }] } }) as GameAction;
    const braced = (where: "active" | number) => {
      const base = where === "active" ? hawlucha() : table(FOE, FILLER, [ANNIHILAPE]);
      return seeded(attachToolFromDeck(base, "p2", where, BRACE), "heads");
    };
    // Each survivor is left at 10 HP (Hawlucha 250 → 240, Annihilape 150 → 140); a heads seed, so a
    // coin asked after the Brace would show as an ABILITY_COIN_FLIP row and an advanced rng.
    // The main hit (attack.ts).
    let state = braced("active");
    let done = mustApply(state, attack(0));
    expect(of(done.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.state.players.p2.active?.damage).toBe(240);
    expect(done.state.rngState).toBe(state.rngState);
    expect(done.state.players.p2.discard.map((u) => done.state.cardIdByUid[u])).toContain(BRACE);
    // The Bench spread (`spreadDamage`).
    state = braced(0);
    done = mustApply(state, attack(4));
    expect(of(done.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.state.players.p2.bench[0]?.damage).toBe(140);
    expect(done.state.rngState).toBe(state.rngState);
    expect(done.state.players.p2.discard.map((u) => done.state.cardIdByUid[u])).toContain(BRACE);
    // The chosen snipe's Bench arm (`placeSnipe`'s `deals`).
    state = braced(0);
    let parked = mustApply(state, attack(5)).state;
    done = mustApply(parked, pick({ spot: "bench", index: 0 }));
    expect(of(done.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.state.players.p2.bench[0]?.damage).toBe(140);
    expect(done.state.rngState).toBe(parked.rngState);
    // The chosen snipe's Active arm (`snipeActive`).
    state = braced("active");
    parked = mustApply(state, attack(5)).state;
    done = mustApply(parked, pick({ spot: "active" }));
    expect(of(done.events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(done.state.players.p2.active?.damage).toBe(240);
    expect(done.state.rngState).toBe(parked.rngState);
    expect(done.state.players.p2.discard.map((u) => done.state.cardIdByUid[u])).toContain(BRACE);
  });
});

describe("D598 §6 — Infinite Shadow: KO'd by an opponent's attack, the Pokémon goes to the hand", () => {
  /** P2's Active Gengar evolved from Gastly and Haunter, with one {D} Energy attached. */
  const shadow = (attacker = FOE) => {
    let state = attachFromDeck(table(attacker, GENGAR), "p2", D, 1);
    const side = state.players.p2;
    const gastly = side.deck.find((u) => state.cardIdByUid[u] === GASTLY) ?? "";
    const haunter = side.deck.find((u) => state.cardIdByUid[u] === HAUNTER) ?? "";
    state = { ...state, players: { ...state.players, p2: { ...side, deck: side.deck.filter((u) => u !== gastly && u !== haunter) } } };
    return edit(state, "p2", "active", (b) => ({ ...b, stack: [gastly, haunter, ...b.stack] }));
  };

  it("the whole Pokémon (Gastly, Haunter, Gengar) to the hand; the Energy to the discard; the Prize still taken", () => {
    const state = shadow();
    const body = state.players.p2.active as Body;
    const { state: after, events } = mustApply(state, attack(0));
    expect(of(events, "KNOCKED_OUT")).toEqual([
      { type: "KNOCKED_OUT", seat: "p2", uid: body.stack.at(-1), discarded: [...body.energy], toHand: [...body.stack] },
    ]);
    expect(after.players.p2.hand).toEqual(body.stack);
    expect(after.players.p2.discard).toEqual(body.energy);
    expect(owed(after)).toBe(1);
  });

  it("the log tail counts what MOVED: 3 Pokémon cards, not D572's \"Basic Energy\"", () => {
    const state = shadow();
    const body = state.players.p2.active as Body;
    const { state: after, events } = mustApply(state, attack(0));
    const ctx = { names: { p1: "Ember", p2: "Tide" }, state: after, elapsed: formatElapsed(0) };
    const render = (list: readonly GameEvent[]) =>
      logFromEvents(list, ctx).flatMap((entry) => (entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")]));
    expect(render(of(events, "KNOCKED_OUT"))).toEqual([
      "Gengar was Knocked Out — 3 Pokémon cards put into the hand instead of the discard pile",
    ]);
    // A mixed split (Huntail's Energy beside a Pokémon card) names both; one card is singular.
    const uid = body.stack.at(-1) ?? "";
    const mixed: GameEvent = { type: "KNOCKED_OUT", seat: "p2", uid, discarded: [], toHand: [uid, ...body.energy] };
    expect(render([mixed])).toEqual([
      "Gengar was Knocked Out — 1 Pokémon card and 1 Basic Energy put into the hand instead of the discard pile",
    ]);
  });

  it("a Checkup Knock Out is not an attack: everything to the discard", () => {
    let state = setConditions(hurt(shadow(), "p2", "active", 120), "p2", { poisonDamage: 10 });
    const body = state.players.p2.active as Body;
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.players.p2.hand).toEqual([]);
    expect(state.players.p2.discard).toEqual(expect.arrayContaining([...body.stack, ...body.energy]));
  });

  it("§9: Flutter Mane's lock on the Active Gengar — the discard", () => {
    const { state: after } = mustApply(hurt(shadow(FLUTTER), "p2", "active", 120), attack(3));
    expect(after.players.p2.hand).toEqual([]);
  });

  it("Milotic's Mentally Calm across the table — the discard", () => {
    const state = benchFromDeck(shadow(), "p1", MILOTIC);
    const { state: after, events } = mustApply(state, attack(0));
    expect(after.players.p2.hand).toEqual([]);
    expect(of(events, "KNOCKED_OUT")[0]?.toHand).toBeUndefined();
  });
});

describe("D598 §7 — Final Chain: an on-KO search behind the printed cause", () => {
  it("KO'd by an opponent's attack: after the Prize, Final Chain parks P2's deck search", () => {
    const state = table(FOE, PECHARUNT);
    const uid = top(state, "p2");
    const afterAttack = mustApply(state, attack(0)).state;
    expect(afterAttack.pending.map((s) => s.kind).slice(0, 3)).toEqual(["takePrizes", "koTrigger", "promote"]);
    const { state: parked, events } = mustApply(afterAttack, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([{ type: "ABILITY_TRIGGERED", seat: "p2", uid, ability: "Final Chain" }]);
    expect(parked.phase).toMatchObject({ kind: "effect:choose", seat: "p2" });
  });

  it("a Checkup Knock Out: no koTrigger is queued", () => {
    let state = setConditions(hurt(table(FOE, PECHARUNT), "p2", "active", 70), "p2", { poisonDamage: 10 });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.pending.some((s) => s.kind === "koTrigger")).toBe(false);
  });
});

describe("D598 §8 — the version", () => {
  it("is built at engine 0.539.0", () => {
    expect(engineVersion).toBe("0.539.0");
  });
});
