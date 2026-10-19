import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackCostAt } from "./attack";
import { BANNER_BY_ID, bannerOf } from "./banners";
import { LEGAL_EX_POOL } from "./bannerPool";
import { costMet, isTeraPokemon, matchesFilter, preventsAttackerBanner } from "./cards";
import {
  anyTypeCostRemoval,
  benchShieldedFromDamage,
  benchShieldedFromEffects,
  disabledAbilityUids,
  effectiveAttackCost,
  passivesOf,
  providedEnergy,
} from "./continuous";
import { deriveAttackDamageBonus, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { briarPrizeBonus } from "./flow";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setPrizes,
  trainerCard,
  typedEnergy,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";
import { koByEffectMarker } from "./types";

// ── 🆕🆕🆕 D568 — THE TERA BANNER UNLOCK, SLICE 1: 19 PRINTINGS ─────────────────────────────
//
//   The datum      banners.ts `BANNER_BY_ID` (~~98~~ Tera ids) / `bannerOf` / cards.ts `isTeraPokemon`
//                  (🆕🆕🆕 D582 (D539): *98 Tera ids* WITHDRAWN — 103: 98 `sv` + 5 `me` reprints)
//   The rule       continuous.ts `benchShieldScan` — "As long as this Pokémon is on your Bench,
//                  prevent all damage done to this Pokémon by attacks (both yours and your
//                  opponent's)." — R-TB1 ⚠️ UNRULED (Feint Attack does not null it)
//   Trainers (+9)  Sparkling Crystal sv07-142/sv08.5-129 (Tool, ACE SPEC), Tera Orb sv08-189,
//                  Glass Trumpet sv07-135/sv08.5-110, Briar sv07-132/-163/-171, sv08.5-100
//   Abilities (+7) Milotic ex "Sparkling Scales" sv08-042/-217/-237, Noctowl "Jewel Seeker"
//                  sv07-115/sv08.5-078/svp-141, Azumarill "Glistening Bubbles" sv08-074
//   Attacks (+3)   Ho-Oh sv08-019 "Shining Blaze", Regigigas sv08.5-086 "Jewel Breaker" (deriver
//                  rows), Terapagos sv08-161 "Prism Charge" (a registry attack)
//
// Driven on REAL ids in a LOCAL `cardPool` (D275) — the table knows no `fix-*` id — with the
// card bodies transcribed from the tcgdex card JSON (the audit's, 2026-09-30). Readings:
// docs/decisions.md D568.

const CYCLIZAR = "sv08-159"; // Cyclizar ex — Tera, Basic {C}; Break Through snipes the Bench
const UMBREON = "sv08.5-060"; // Umbreon ex — Tera, Stage 1; Moon Mirage Confuses (an EFFECT)
const TERAPAGOS_EX = "sv07-128"; // Terapagos ex — Tera, Basic {C}
const PIKACHU_EX = "sv08.5-028"; // Pikachu ex — NOT Tera (the corrected id)
const CINDERACE = "sv07-028"; // Cinderace ex — Tera, Stage 2; Garnet Volley hits 1 of the opponent's Pokémon
const FLYGON = "sv08-106"; // Flygon ex — Tera, Stage 2; Reversing Storm may switch ITSELF out before the Knock Out
const MILOTIC = "sv08-042";
const HOOTHOOT = "sv07-114";
const NOCTOWL = "sv07-115";
const MARILL = "sv08-073";
const AZUMARILL = "sv08-074";
const HO_OH = "sv08-019";
const REGIGIGAS = "sv08.5-086";
const TERAPAGOS = "sv08-161"; // Terapagos — NOT Tera (only the ex is)
const CRYSTAL = "sv07-142";
const ORB = "sv08-189";
const TRUMPET = "sv07-135";
const BRIAR = "sv07-132";
const FILLER = "d568-filler";
const WEAK = "d568-weak";
const STRIKER = "d568-striker";
const PLAIN_C = "d568-plain";
const ITEM = "d568-item";
const R = "d568-R";
const W = "d568-W";
const L = "d568-L";
const P = "d568-P";
const D = "d568-D";
const G = "d568-G";
const F = "d568-F";

const CRYSTAL_TEXT =
  "When the Tera Pokémon this card is attached to uses an attack, that attack costs 1 Energy less. (The Energy can be of any type.)";
const ORB_TEXT =
  "Search your deck for a Tera Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const TRUMPET_TEXT =
  "You can use this card only if you have any Tera Pokémon in play.\n\nChoose up to 2 of your Benched {C} Pokémon and attach a Basic Energy card from your discard pile to each of them.";
const BRIAR_TEXT =
  "You can use this card only if your opponent has exactly 2 Prize cards remaining.\n\nDuring this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your Tera Pokémon, take 1 more Prize card.";

const BENCH_SPREAD =
  "This attack also does 20 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const OWN_SPREAD =
  "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SNIPE =
  "This attack does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const CURSE = "Put 3 damage counters on 1 of your opponent's Benched Pokémon.";
const FEINT =
  "This attack does 30 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  [CYCLIZAR]: battler(CYCLIZAR, { name: "Cyclizar ex", hp: 210, types: ["Colorless"], retreat: 1, weaknesses: [{"type": "Fighting", "value": "×2"}], attacks: [{"cost": ["Colorless", "Colorless", "Colorless"], "name": "Break Through", "damage": 130, "effect": "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"}, {"cost": ["Grass", "Fire", "Psychic"], "name": "Zircon Road", "damage": 180, "effect": "You may draw 5 cards."}] }),
  [UMBREON]: battler(UMBREON, { name: "Umbreon ex", stage: "Stage1", evolveFrom: "Eevee", hp: 280, types: ["Darkness"], retreat: 2, weaknesses: [{"type": "Grass", "value": "×2"}], attacks: [{"cost": ["Darkness", "Colorless", "Colorless"], "name": "Moon Mirage", "damage": 160, "effect": "Your opponent's Active Pokémon is now Confused."}, {"cost": ["Lightning", "Psychic", "Darkness"], "name": "Onyx", "effect": "Discard all Energy from this Pokémon, and take a Prize card."}] }),
  [TERAPAGOS_EX]: battler(TERAPAGOS_EX, { name: "Terapagos ex", hp: 230, types: ["Colorless"], retreat: 2, weaknesses: [{"type": "Fighting", "value": "×2"}], attacks: [{"cost": ["Colorless", "Colorless"], "name": "Unified Beatdown", "damage": "30×", "effect": "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon."}, {"cost": ["Grass", "Water", "Lightning"], "name": "Crown Opal", "damage": 180, "effect": "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon."}] }),
  [PIKACHU_EX]: battler(PIKACHU_EX, { name: "Pikachu ex", hp: 190, types: ["Lightning"], retreat: 1, weaknesses: [{"type": "Fighting", "value": "×2"}], attacks: [{"cost": ["Colorless"], "name": "Tail Whap", "damage": 30}, {"cost": ["Lightning", "Lightning", "Colorless"], "name": "Thunder", "damage": 220, "effect": "This Pokémon also does 30 damage to itself."}] }),
  [MILOTIC]: battler(MILOTIC, { name: "Milotic ex", stage: "Stage1", evolveFrom: "Feebas", hp: 270, types: ["Water"], retreat: 2, weaknesses: [{"type": "Lightning", "value": "×2"}], attacks: [{"cost": ["Water", "Colorless", "Colorless"], "name": "Hypno Splash", "damage": 160, "effect": "Your opponent's Active Pokémon is now Asleep."}], abilities: [{"type": "Ability", "name": "Sparkling Scales", "effect": "Prevent all damage from and effects of attacks from your opponent's Tera Pokémon done to this Pokémon."}] }),
  [HOOTHOOT]: battler(HOOTHOOT, { name: "Hoothoot", hp: 70, types: ["Colorless"], retreat: 1, weaknesses: [{"type": "Lightning", "value": "×2"}], attacks: [{"cost": ["Colorless"], "name": "Triple Stab", "damage": "10×", "effect": "Flip 3 coins. This attack does 10 damage for each heads."}] }),
  [NOCTOWL]: battler(NOCTOWL, { name: "Noctowl", stage: "Stage1", evolveFrom: "Hoothoot", hp: 100, types: ["Colorless"], retreat: 1, weaknesses: [{"type": "Lightning", "value": "×2"}], attacks: [{"cost": ["Colorless", "Colorless"], "name": "Speed Wing", "damage": 60}], abilities: [{"type": "Ability", "name": "Jewel Seeker", "effect": "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, if you have any Tera Pokémon in play, you may search your deck for up to 2 Trainer cards, reveal them, and put them into your hand. Then, shuffle your deck."}] }),
  [MARILL]: battler(MARILL, { name: "Marill", hp: 60, types: ["Psychic"], retreat: 1, weaknesses: [{"type": "Metal", "value": "×2"}], attacks: [{"cost": ["Psychic"], "name": "Rolling Tackle", "damage": 20}] }),
  [AZUMARILL]: battler(AZUMARILL, { name: "Azumarill", stage: "Stage1", evolveFrom: "Marill", hp: 120, types: ["Psychic"], retreat: 2, weaknesses: [{"type": "Metal", "value": "×2"}], attacks: [{"cost": ["Psychic", "Psychic", "Psychic", "Psychic"], "name": "Double-Edge", "damage": 230, "effect": "This Pokémon also does 50 damage to itself."}], abilities: [{"type": "Ability", "name": "Glistening Bubbles", "effect": "If you have any Tera Pokémon in play, this Pokémon can use the Double-Edge attack for {P}."}] }),
  [HO_OH]: battler(HO_OH, { name: "Ho-Oh", hp: 130, types: ["Fire"], retreat: 2, weaknesses: [{"type": "Lightning", "value": "×2"}], attacks: [{"cost": ["Fire", "Colorless"], "name": "Flap", "damage": 50}, {"cost": ["Fire", "Fire", "Colorless"], "name": "Shining Blaze", "damage": "100+", "effect": "If you have any Tera Pokémon on your Bench, this attack does 100 more damage."}] }),
  [REGIGIGAS]: battler(REGIGIGAS, { name: "Regigigas", hp: 160, types: ["Colorless"], retreat: 4, weaknesses: [{"type": "Fighting", "value": "×2"}], attacks: [{"cost": ["Colorless", "Colorless", "Colorless", "Colorless"], "name": "Jewel Breaker", "damage": "100+", "effect": "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."}] }),
  [TERAPAGOS]: battler(TERAPAGOS, { name: "Terapagos", hp: 120, types: ["Colorless"], retreat: 2, weaknesses: [{"type": "Fighting", "value": "×2"}], attacks: [{"cost": ["Colorless"], "name": "Prism Charge", "effect": "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck."}, {"cost": ["Colorless", "Colorless", "Colorless"], "name": "Hard Tackle", "damage": 100}] }),
  [CINDERACE]: battler(CINDERACE, { name: "Cinderace ex", stage: "Stage2", evolveFrom: "Raboot", hp: 320, types: ["Fire"], retreat: 0, weaknesses: [{"type": "Water", "value": "×2"}], attacks: [{"cost": ["Fire", "Colorless", "Colorless"], "name": "Flare Strike", "damage": 280, "effect": "During your next turn, this Pokémon can't use Flare Strike."}, {"cost": ["Fire", "Fighting", "Darkness"], "name": "Garnet Volley", "effect": "This attack does 180 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"}] }),
  [FLYGON]: battler(FLYGON, { name: "Flygon ex", stage: "Stage2", evolveFrom: "Vibrava", hp: 310, types: ["Fighting"], retreat: 1, weaknesses: [{"type": "Grass", "value": "×2"}], attacks: [{"cost": ["Fighting"], "name": "Reversing Storm", "damage": 130, "effect": "You may switch this Pokémon with 1 of your Benched Pokémon."}, {"cost": ["Water", "Fighting", "Metal"], "name": "Sonic Peridot", "effect": "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance."}] }),
  [CRYSTAL]: { ...trainerCard(CRYSTAL, "Tool", CRYSTAL_TEXT), name: "Sparkling Crystal", rarity: "ACE SPEC Rare" },
  [ORB]: { ...trainerCard(ORB, "Item", ORB_TEXT), name: "Tera Orb" },
  [TRUMPET]: { ...trainerCard(TRUMPET, "Item", TRUMPET_TEXT), name: "Glass Trumpet" },
  [BRIAR]: { ...trainerCard(BRIAR, "Supporter", BRIAR_TEXT), name: "Briar" },
  [FILLER]: battler(FILLER, {
    name: "D568 Filler",
    hp: 900,
    types: ["Water"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [WEAK]: battler(WEAK, { name: "D568 Weak", hp: 30, types: ["Water"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [STRIKER]: battler(STRIKER, {
    name: "D568 Striker",
    hp: 900,
    types: ["Colorless"],
    attacks: [
      { cost: [], name: "Spread Out", damage: 10, effect: BENCH_SPREAD },
      { cost: [], name: "Self Splash", damage: 10, effect: OWN_SPREAD },
      { cost: [], name: "Snipe", effect: SNIPE },
      { cost: [], name: "Curse", effect: CURSE },
      { cost: [], name: "Feint", effect: FEINT },
      { cost: [], name: "Smash", damage: 300 },
    ],
  }),
  [PLAIN_C]: battler(PLAIN_C, { name: "D568 Plain", hp: 60, types: ["Colorless"] }),
  [ITEM]: { ...trainerCard(ITEM, "Item", "A D568 test Item."), name: "D568 Item" },
  [R]: typedEnergy(R, "Fire"),
  [W]: typedEnergy(W, "Water"),
  [L]: typedEnergy(L, "Lightning"),
  [P]: typedEnergy(P, "Psychic"),
  [D]: typedEnergy(D, "Darkness"),
  [G]: typedEnergy(G, "Grass"),
  [F]: typedEnergy(F, "Fighting"),
};
const WATCHTOWER = "sv10-180";
LOCAL_CARDS[WATCHTOWER] = {
  ...trainerCard(WATCHTOWER, "Stadium", "Colorless Pokémon in play (both yours and your opponent's) have no Abilities."),
  name: "Team Rocket's Watchtower",
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [CYCLIZAR]: 2,
  [UMBREON]: 1,
  [CINDERACE]: 1,
  [FLYGON]: 1,
  [TERAPAGOS_EX]: 2,
  [PIKACHU_EX]: 1,
  [MILOTIC]: 1,
  [HOOTHOOT]: 2,
  [NOCTOWL]: 1,
  [MARILL]: 1,
  [AZUMARILL]: 1,
  [HO_OH]: 1,
  [REGIGIGAS]: 1,
  [TERAPAGOS]: 1,
  [CRYSTAL]: 1,
  [ORB]: 1,
  [TRUMPET]: 1,
  [BRIAR]: 1,
  [WATCHTOWER]: 1,
  [WEAK]: 2,
  [STRIKER]: 2,
  [PLAIN_C]: 2,
  [ITEM]: 1,
  [R]: 3,
  [W]: 3,
  [L]: 3,
  [P]: 3,
  [D]: 3,
  [G]: 3,
  [F]: 2,
  [FILLER]: 11,
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

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

/** p2 went first and passed: p1's turn 2 — p1's FIRST turn. */
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

/** Prized copies of `id` swapped into the deck until the deck holds at least `k` copies. */
function ensureCopies(state: GameState, seat: Seat, id: string, k = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= k) return next;
    const fromHand = side.hand.find((u) => next.cardIdByUid[u] === id);
    if (fromHand !== undefined) {
      next = {
        ...next,
        players: {
          ...next.players,
          [seat]: { ...side, hand: side.hand.filter((u) => u !== fromHand), deck: [...side.deck, fromHand] },
        },
      };
      continue;
    }
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    if (prized === undefined) throw new Error(`${seat} has fewer than ${k} ${id} to seat`);
    const swap =
      side.deck.find((u) => next.cardIdByUid[u] === FILLER) ?? side.deck.find((u) => next.cardIdByUid[u] !== id);
    if (swap === undefined) throw new Error("no card to swap");
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          prizes: side.prizes.map((u) => (u === prized ? swap : u)),
          deck: [...side.deck.filter((u) => u !== swap), prized],
        },
      },
    };
  }
}

/** Every hand card back into the deck, then `ids` into the hand. */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  const back = next.players[seat];
  next = { ...next, players: { ...next.players, [seat]: { ...back, deck: [...back.deck, ...back.hand], hand: [] } } };
  for (const id of ids) {
    next = ensureCopies(next, seat, id, ids.filter((x) => x === id).length);
  }
  const side = next.players[seat];
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id} in the deck`);
    deck = deck.filter((u) => u !== uid);
    hand.push(uid);
  }
  return { ...next, players: { ...next.players, [seat]: { ...side, hand, deck } } };
}

type Spot = "active" | number;

function bodyAt(state: GameState, seat: Seat, spot: Spot): InPlayPokemon {
  const side = state.players[seat];
  const p = spot === "active" ? side.active : side.bench[spot];
  if (p === null || p === undefined) throw new Error(`no body at ${seat} ${String(spot)}`);
  return p;
}

function withBody(state: GameState, seat: Seat, spot: Spot, f: (p: InPlayPokemon) => InPlayPokemon): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — `count` copies of an Energy out of `seat`'s deck onto the body at `spot`. */
function energize(state: GameState, seat: Seat, spot: Spot, id: string, count = 1): GameState {
  let next = ensureCopies(state, seat, id, count);
  const side = next.players[seat];
  const uids = side.deck.filter((u) => next.cardIdByUid[u] === id).slice(0, count);
  next = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => !uids.includes(u)) } } };
  return withBody(next, seat, spot, (p) => ({ ...p, energy: [...p.energy, ...uids] }));
}

/** TEST SURGERY — `count` copies of `id` out of `seat`'s deck into their discard pile. */
function discard(state: GameState, seat: Seat, id: string, count = 1): GameState {
  const next = ensureCopies(state, seat, id, count);
  const side = next.players[seat];
  const uids = side.deck.filter((u) => next.cardIdByUid[u] === id).slice(0, count);
  return {
    ...next,
    players: {
      ...next.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !uids.includes(u)), discard: [...side.discard, ...uids] },
    },
  };
}

/** TEST SURGERY — every deck copy of `id` to the discard pile. */
function purge(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  const gone = side.deck.filter((u) => state.cardIdByUid[u] === id);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !gone.includes(u)), discard: [...side.discard, ...gone] },
    },
  };
}

/** TEST SURGERY — `id` out of `seat`'s deck into the Stadium zone. */
function stadium(state: GameState, seat: Seat, id: string): GameState {
  const next = ensureCopies(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id) as string;
  return {
    ...next,
    stadium: { uid, owner: seat },
    players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** Both boards laid out by surgery on p1's first turn; both hands emptied. */
function table(
  opts: { p1?: string; p1Bench?: readonly string[]; p2?: string; p2Bench?: readonly string[] } = {},
  seed = 5681,
): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureCopies(state, "p1", opts.p1 ?? FILLER), "p1", opts.p1 ?? FILLER);
  state = setActiveFromDeck(ensureCopies(state, "p2", opts.p2 ?? FILLER), "p2", opts.p2 ?? FILLER);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.p1Bench ?? []) state = benchFromDeck(ensureCopies(state, "p1", id), "p1", id);
  for (const id of opts.p2Bench ?? []) state = benchFromDeck(ensureCopies(state, "p2", id), "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const topOf = (p: InPlayPokemon) => p.stack[p.stack.length - 1] as string;
const benchRef = (seat: Seat, index: number): PokemonRef => ({ seat, spot: { spot: "bench", index } });

function phasePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** Declare attack `index` for p1; if it parks on a Pokémon pick, answer `pick`. */
function attack(state: GameState, index: number, pick?: PokemonRef): { state: GameState; events: GameEvent[] } {
  const first = run(state, { type: "attack", seat: "p1", index });
  if (first.state.phase.kind !== "effect:choose" || pick === undefined) return first;
  const prompt = first.state.phase.prompt;
  const choice =
    prompt.kind === "choosePokemonMulti" ? { kind: "pokemonMulti", refs: [pick] } : { kind: "pokemon", ref: pick };
  const second = run(first.state, { type: "resolveEffect", seat: "p1", choice } as GameAction);
  return { state: second.state, events: [...first.events, ...second.events] };
}

function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const before = setHand(state, "p1", [id]);
  const uid = before.players.p1.hand[0] as string;
  return run(before, { type: "playTrainer", seat: "p1", uid });
}

function playRejected(state: GameState, id: string): string {
  const before = setHand(state, "p1", [id]);
  const uid = before.players.p1.hand[0] as string;
  return rejected(before, { type: "playTrainer", seat: "p1", uid });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the datum: `banners.ts`' ~~98~~ Tera ids, two sources plus the printed face (🆕🆕🆕 D582 (D539): *98* WITHDRAWN — 103: 98 `sv` + 5 `me` reprints)", () => {
  // 🆕🆕🆕 D569 — RE-SCOPED TO THE TERA ROWS. The table now also carries the 86 Ancient/Future
  // ids (Slice 2 part a, `paradoxBannerD569.test.ts` pins them), so "every id is Tera" and "every
  // id is a legal Pokémon ex" are claims about the TERA rows only — a Paradox banner is printed on
  // non-ex Pokémon and on Trainers too. `ids` is the Tera subset; the whole table is pinned beside.
  const ids = Object.keys(BANNER_BY_ID).filter((id) => BANNER_BY_ID[id] === "Tera");
  const pool = new Map(LEGAL_EX_POOL.map((row) => [row[0], row] as const));

  it("~~98~~ Tera ids (🆕 D569: beside 86 Ancient/Future ids — Slice 2 part a) (🆕🆕🆕 D582 (D539): *98* WITHDRAWN — 103: 98 `sv` + 5 `me` reprints)", () => {
    // 🆕🆕🆕 D582 — 98 `sv` Tera ids, plus FIVE `me` Tera reprints (`me02.5-038`/`-057`/`-160`/
    // `-179`/`-277`, each printed face checked on tcgdex's image and pinned BY ID in
    // `reprintAliasMeD582.test.ts`): 103 Tera, 189 in all.
    expect(ids.filter((id) => !id.startsWith("me"))).toHaveLength(98);
    expect(ids).toHaveLength(103);
    // (🆕🆕🆕 D569 (D539): ~~Ancient/Future are Slice 2 and are NOT here~~ WITHDRAWN — they are
    // here now: 98 + 86 = 184, three banner values.) (🆕🆕🆕 D582: 184 + 5 = 189.)
    expect(Object.keys(BANNER_BY_ID)).toHaveLength(189);
    expect(new Set(Object.values(BANNER_BY_ID))).toEqual(new Set(["Tera", "Ancient", "Future"]));
  });

  it("🛑 every ~~TERA~~ `sv` TERA id is a Standard-legal Pokémon ex in the local pool (353 rows) (🆕🆕🆕 D582 (D539): *every TERA id* WITHDRAWN — the 5 `me` Tera ids are not in this `sv` pool; pinned by id in `reprintAliasMeD582.test.ts`)", () => {
    expect(LEGAL_EX_POOL).toHaveLength(353);
    for (const row of LEGAL_EX_POOL) expect(row[1].endsWith(" ex"), row[0]).toBe(true);
    // 🆕🆕🆕 D582 — the pool is the `sv` serie's (353 rows); the five `me` Tera ids are pinned BY ID
    // in `reprintAliasMeD582.test.ts` (on a placeholder battler — no `me` face is a fixture or in
    // this pool, so their printed faces are a recorded check on tcgdex's images, not a pin).
    for (const id of ids.filter((i) => !i.startsWith("me"))) expect(pool.has(id), id).toBe(true);
  });

  it("🛑 REPRINT CONSISTENCY: legal printings sharing name, HP, attack and ability names agree on membership", () => {
    const groups = new Map<string, string[]>();
    for (const [id, name, hp, attacks, abilities] of LEGAL_EX_POOL) {
      const key = JSON.stringify([name, hp, attacks, abilities]);
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    // 🆕🆕🆕 D569 — membership is TERA membership (the Paradox ex reprints are consistent too, and
    // pinned on their own pool in `paradoxBannerD569.test.ts`).
    const split = [...groups.values()].filter(
      (members) => new Set(members.map((id) => BANNER_BY_ID[id] === "Tera")).size > 1,
    );
    expect(split).toEqual([]);
    // ⚠️ NOT VACUOUS: the Terapagos ex group is SEVEN printings, and dropping the one id the
    // first source missed (`sv08.5-092`) splits it — the rung is the reason that id is here.
    const terapagos = [...groups.values()].find((members) => members.includes("sv08.5-092"));
    expect(terapagos?.sort()).toEqual(
      ["sv07-128", "sv07-170", "sv07-173", "sv08.5-092", "sv08.5-169", "sv08.5-180", "svp-165"].sort(),
    );
  });

  it("🛑 the two CORRECTIONS are pinned by name, and the promo additions by id", () => {
    // Removed: pokemon-tcg-data lists it as Tera; limitless and the printed face do not.
    expect(pool.get("sv08.5-028")?.slice(0, 4)).toEqual(["sv08.5-028", "Pikachu ex", 190, ["Tail Whap", "Thunder"]]);
    expect(bannerOf(POOL[PIKACHU_EX])).toBeUndefined();
    // Added: the first source omits it; limitless and the printed face say Tera.
    expect(pool.get("sv08.5-092")?.slice(0, 4)).toEqual([
      "sv08.5-092",
      "Terapagos ex",
      230,
      ["Unified Beatdown", "Crown Opal"],
    ]);
    expect(BANNER_BY_ID["sv08.5-092"]).toBe("Tera");
    // The promos the first source stops short of (it ends at svp-165), and the one it cannot see.
    for (const id of ["svp-163", "svp-164", "svp-165", "svp-166", "svp-174", "svp-175", "svp-176"]) {
      expect(BANNER_BY_ID[id], id).toBe("Tera");
    }
    expect(BANNER_BY_ID["svp-215"]).toBeUndefined();
    // The other Pikachu ex IS Tera — the reason the table is keyed by ID and never by name.
    expect(BANNER_BY_ID["sv08-057"]).toBe("Tera");
  });

  it("the readers: `bannerOf`, `isTeraPokemon`, `matchesFilter(bannerPokemon)` — by id, never by name", () => {
    expect(bannerOf(undefined)).toBeUndefined();
    expect(bannerOf(POOL["fix-attacker-ex"])).toBeUndefined();
    expect(isTeraPokemon(POOL[CYCLIZAR])).toBe(true);
    expect(isTeraPokemon(POOL[PIKACHU_EX])).toBe(false);
    expect(isTeraPokemon(POOL[TERAPAGOS])).toBe(false); // Terapagos (not ex) is not Tera
    expect(isTeraPokemon(undefined)).toBe(false);
    // A Pikachu ex CARD carrying a Tera id's name would still be judged by its id.
    expect(isTeraPokemon({ ...(POOL[PIKACHU_EX] as Card), name: "Pikachu ex" })).toBe(false);
    const tera = { kind: "bannerPokemon", banner: "Tera" } as const;
    expect(matchesFilter(POOL[TERAPAGOS_EX], tera)).toBe(true);
    expect(matchesFilter(POOL[PIKACHU_EX], tera)).toBe(false);
    expect(matchesFilter(POOL[ORB], tera)).toBe(false);
    expect(matchesFilter({ ...(POOL[ORB] as Card), id: CYCLIZAR }, tera)).toBe(false); // category conjunct
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — THE PRINTED TERA RULE: a benched Tera Pokémon takes no damage from attacks", () => {
  it("🛑 the OPPONENT's spread: the benched Tera body takes 0, its non-Tera neighbour 20", () => {
    const state = table({ p1: STRIKER, p2Bench: [TERAPAGOS_EX, FILLER] });
    const after = attack(state, 0).state;
    expect(bodyAt(after, "p2", 0).damage).toBe(0);
    expect(bodyAt(after, "p2", 1).damage).toBe(20);
  });

  it("🛑 YOUR OWN attack too (\"both yours and your opponent's\"): the own-bench spread skips it", () => {
    const state = table({ p1: STRIKER, p1Bench: [CYCLIZAR, FILLER] });
    const after = attack(state, 1).state;
    expect(bodyAt(after, "p1", 0).damage).toBe(0);
    expect(bodyAt(after, "p1", 1).damage).toBe(20);
  });

  it("the chosen snipe: 0 on a benched Tera body, 30 on a non-Tera one", () => {
    const state = table({ p1: STRIKER, p2Bench: [CYCLIZAR, FILLER] });
    expect(bodyAt(attack(state, 2, benchRef("p2", 0)).state, "p2", 0).damage).toBe(0);
    expect(bodyAt(attack(state, 2, benchRef("p2", 1)).state, "p2", 1).damage).toBe(30);
  });

  it("🛑 the ACTIVE Tera Pokémon is NOT shielded — the rule is a Bench rule", () => {
    const state = table({ p1: FILLER, p2: TERAPAGOS_EX });
    const after = attack(state, 0).state;
    expect(bodyAt(after, "p2", "active").damage).toBe(10);
  });

  it("🛑 damage COUNTERS are not damage: the Curse still lands on a benched Tera body", () => {
    const state = table({ p1: STRIKER, p2Bench: [CYCLIZAR] });
    expect(bodyAt(attack(state, 3, benchRef("p2", 0)).state, "p2", 0).damage).toBe(30);
  });

  it("🛑 a RULE, not an Ability: Team Rocket's Watchtower silences the {C} Tera body and it is still shielded", () => {
    let state = table({ p1: STRIKER, p2Bench: [TERAPAGOS_EX] });
    state = stadium(state, "p1", WATCHTOWER);
    const benched = bodyAt(state, "p2", 0);
    // The body's Abilities (it prints none, but the lock is ON it) — the §9 set holds its uid…
    expect(disabledAbilityUids(state).has(topOf(benched))).toBe(true);
    // …and the rule is not in that set's reach.
    expect(benchShieldedFromDamage(state, benched, "all")).toBe(true);
    expect(bodyAt(attack(state, 0).state, "p2", 0).damage).toBe(0);
  });

  it("🛑 R-TB1 (⚠️ UNRULED): Feint Attack's \"any effects on that Pokémon\" does NOT null the printed rule", () => {
    const state = table({ p1: STRIKER, p2Bench: [CYCLIZAR, FILLER] });
    const benched = bodyAt(state, "p2", 0);
    expect(benchShieldedFromDamage(state, benched, "othersOnly")).toBe(true);
    expect(bodyAt(attack(state, 4, benchRef("p2", 0)).state, "p2", 0).damage).toBe(0);
    // …the control: Feint Attack at the non-Tera neighbour lands.
    expect(bodyAt(attack(state, 4, benchRef("p2", 1)).state, "p2", 1).damage).toBe(30);
  });

  it("damage ONLY: the effects scan never answers for it, and a non-Tera benched body is not shielded", () => {
    const state = table({ p2Bench: [CYCLIZAR, FILLER] });
    expect(benchShieldedFromEffects(state, bodyAt(state, "p2", 0))).toBe(false);
    expect(benchShieldedFromDamage(state, bodyAt(state, "p2", 1), "all")).toBe(false);
    expect(benchShieldedFromDamage(state, bodyAt(state, "p2", "active"), "all")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the rows, exactly as authored", () => {
  it("the Trainers: Crystal, Tera Orb, Glass Trumpet, Briar (one object per text, reprints share it)", () => {
    const tera = { kind: "bannerPokemon", banner: "Tera" } as const;
    expect(programFor(CRYSTAL)).toEqual({ passive: { attackCostDiscount: { amount: 1, holder: tera, anyType: true } } });
    expect(programFor("sv08.5-129")).toBe(programFor(CRYSTAL));
    expect(programFor(ORB)).toEqual({
      trainer: [
        { op: "searchDeck", filter: tera, dest: "hand", max: 1, reveal: true },
        { op: "shuffleDeck" },
      ],
    });
    expect(programFor(TRUMPET)).toEqual({
      trainer: [
        {
          op: "attachFromDiscard",
          filter: { kind: "basicEnergy" },
          max: 2,
          maxPerTarget: 1,
          targetType: "Colorless",
          benchOnly: true,
        },
      ],
      trainerPlayableIf: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
    });
    expect(programFor("sv08.5-110")).toBe(programFor(TRUMPET));
    expect(programFor(BRIAR)).toEqual({
      trainer: [],
      trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [2] },
      supporterKoPrizeBonus: { amount: 1, attacker: tera },
    });
    for (const id of ["sv07-163", "sv07-171", "sv08.5-100"]) expect(programFor(id)).toBe(programFor(BRIAR));
  });

  it("the Abilities: Sparkling Scales, Jewel Seeker, Glistening Bubbles", () => {
    expect(programFor(MILOTIC)).toEqual({ passive: { preventDamageAndEffectsFromBanner: "Tera" } });
    for (const id of ["sv08-217", "sv08-237"]) expect(programFor(id)).toBe(programFor(MILOTIC));
    expect(programFor(NOCTOWL)).toEqual({
      triggered: [
        {
          name: "Jewel Seeker",
          trigger: "onEvolve",
          optional: true,
          program: [
            {
              op: "conditionGate",
              cond: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [
                { op: "searchDeck", filter: { kind: "trainerCard" }, dest: "hand", max: 2, reveal: true },
                { op: "shuffleDeck" },
              ],
            },
          ],
        },
      ],
    });
    for (const id of ["sv08.5-078", "svp-141"]) expect(programFor(id)).toBe(programFor(NOCTOWL));
    expect(programFor(AZUMARILL)).toEqual({
      passive: {
        attackCostClause: {
          attack: "Double-Edge",
          gate: {
            kind: "alternateCostIf",
            condition: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
            cost: ["Psychic"],
          },
        },
      },
    });
  });

  it("the attacks: Prism Charge is a REGISTRY row at index 0; Ho-Oh and Regigigas are DERIVED and keyless", () => {
    expect(programFor(TERAPAGOS)).toEqual({
      attack: {
        0: [
          {
            op: "attachFromDeck",
            filter: { kind: "basicEnergy" },
            max: 3,
            distinctEnergyTypes: true,
            targetBanner: "Tera",
          },
          { op: "shuffleDeck" },
        ],
      },
    });
    expect(programFor(HO_OH)).toBeUndefined();
    expect(programFor(REGIGIGAS)).toBeUndefined();
    const hoOh = POOL[HO_OH]?.attacks?.[1]?.effect ?? "";
    const regi = POOL[REGIGIGAS]?.attacks?.[0]?.effect ?? "";
    expect(deriveAttackDamageBonus(hoOh)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "yourBannerPokemonOnBench", banner: "Tera" } },
    });
    expect(deriveAttackDamageBonus(regi)).toEqual({
      per: 230,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsBanner", banner: "Tera" } },
    });
    // The deriver still refuses Prism Charge — it is the registry row that builds it.
    expect(deriveAttackEffect(POOL[TERAPAGOS]?.attacks?.[0]?.effect ?? "")).toBeNull();
  });

  it("the three BoardConditions read back as the printed clauses", () => {
    expect(conditionNote({ kind: "yourBannerPokemonInPlay", banner: "Tera" })).toBe(
      "you have any Tera Pokémon in play",
    );
    expect(conditionNote({ kind: "yourBannerPokemonOnBench", banner: "Tera" })).toBe(
      "you have any Tera Pokémon on your Bench",
    );
    expect(conditionNote({ kind: "opponentActiveIsBanner", banner: "Tera" })).toBe(
      "your opponent's Active Pokémon is a Tera Pokémon",
    );
  });

  it("🛑 the conditions, seat-relative and zone-exact", () => {
    const inPlay = { kind: "yourBannerPokemonInPlay", banner: "Tera" } as const;
    const onBench = { kind: "yourBannerPokemonOnBench", banner: "Tera" } as const;
    const oppActive = { kind: "opponentActiveIsBanner", banner: "Tera" } as const;
    const activeOnly = table({ p1: CYCLIZAR });
    expect(conditionHolds(activeOnly, "p1", inPlay)).toBe(true);
    expect(conditionHolds(activeOnly, "p1", onBench)).toBe(false); // the Active is not "on your Bench"
    expect(conditionHolds(activeOnly, "p2", inPlay)).toBe(false); // the other seat's
    expect(conditionHolds(activeOnly, "p2", oppActive)).toBe(true);
    expect(conditionHolds(activeOnly, "p1", oppActive)).toBe(false);
    const benchOnly = table({ p1Bench: [TERAPAGOS_EX] });
    expect(conditionHolds(benchOnly, "p1", inPlay)).toBe(true);
    expect(conditionHolds(benchOnly, "p1", onBench)).toBe(true);
    const none = table({ p1: PIKACHU_EX, p1Bench: [TERAPAGOS] });
    expect(conditionHolds(none, "p1", inPlay)).toBe(false);
    expect(conditionHolds(none, "p1", onBench)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Sparkling Crystal: 1 Energy of ANY type off a Tera holder's attacks, chosen against its Energy", () => {
  /** p1's Active `holder` with a Crystal and the named Energy attached. */
  function crystal(holder: string, energy: readonly string[], withCrystal = true): GameState {
    let state = table({ p1: holder });
    for (const id of energy) state = energize(state, "p1", "active", id);
    return withCrystal ? attachToolFromDeck(ensureCopies(state, "p1", CRYSTAL), "p1", "active", CRYSTAL) : state;
  }
  const cost = (state: GameState, printed: readonly string[]) =>
    effectiveAttackCost(state, bodyAt(state, "p1", "active"), printed);

  it("🛑 {R}{R}{C} with only {R}{C} attached is charged {R}{C} — a TYPED symbol goes, and the attack is payable", () => {
    const state = crystal(CYCLIZAR, [R, W]);
    const charged = cost(state, ["Fire", "Fire", "Colorless"]);
    expect(charged).toEqual(["Fire", "Colorless"]);
    expect(costMet(charged, providedEnergy(state, bodyAt(state, "p1", "active")))).toBe(true);
    // The Colorless-only loop would have charged {R}{R} — unpayable on this very board.
    expect(costMet(["Fire", "Fire"], providedEnergy(state, bodyAt(state, "p1", "active")))).toBe(false);
  });

  it("an already-payable cost loses a Colorless (the printed typed symbols stay visible)", () => {
    const state = crystal(CYCLIZAR, [R, R, R]);
    expect(cost(state, ["Fire", "Fire", "Colorless"])).toEqual(["Fire", "Fire"]);
  });

  it("an all-Colorless cost loses a Colorless", () => {
    expect(cost(crystal(CYCLIZAR, []), ["Colorless", "Colorless", "Colorless"])).toEqual(["Colorless", "Colorless"]);
  });

  it("🛑 a NON-Tera holder gets nothing (the printed noun), and no Crystal is the printed array itself", () => {
    const printed = ["Fire", "Fire", "Colorless"];
    expect(cost(crystal(PIKACHU_EX, [R, W]), printed)).toEqual(printed);
    const bare = crystal(CYCLIZAR, [R, W], false);
    expect(cost(bare, printed)).toBe(printed);
  });

  it("`anyTypeCostRemoval`, pure: the short typed symbol, never a covered one", () => {
    expect(anyTypeCostRemoval(["Fire", "Water", "Colorless"], ["Fire", "Colorless"], 1)).toEqual(["Fire", "Colorless"]);
    expect(anyTypeCostRemoval(["Fire", "Water", "Colorless"], ["Colorless"], 1)).toEqual(["Fire", "Colorless"]);
    expect(anyTypeCostRemoval(["Fire", "Water"], ["Water", "Water"], 1)).toEqual(["Water"]);
    expect(anyTypeCostRemoval([], ["Fire"], 1)).toEqual([]);
    expect(anyTypeCostRemoval(["Fire", "Fire", "Colorless"], ["Fire", "Colorless"], 0)).toEqual([
      "Fire",
      "Fire",
      "Colorless",
    ]);
  });

  it("🛑 end to end: Cyclizar ex's Break Through ({C}{C}{C}) is declared with TWO Energy under a Crystal, refused without it", () => {
    const withCrystal = crystal(CYCLIZAR, [R, W]);
    expect(attackCostAt(withCrystal, "p1", bodyAt(withCrystal, "p1", "active"), 0, ["Fire", "Water"])).toEqual([
      "Colorless",
      "Colorless",
    ]);
    const hit = run(withCrystal, { type: "attack", seat: "p1", index: 0 });
    expect(all(hit.events, "DAMAGE_DEALT").some((e) => e.dealt === 130)).toBe(true);
    expect(rejected(crystal(CYCLIZAR, [R, W], false), { type: "attack", seat: "p1", index: 0 })).toBe(
      "ATTACK_COST_UNMET",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — Tera Orb and Glass Trumpet", () => {
  it("🛑 Tera Orb offers ONLY the deck's Tera Pokémon (never Terapagos, never Pikachu ex `sv08.5-028`)", () => {
    let state = table();
    for (const id of [CYCLIZAR, TERAPAGOS_EX, UMBREON, CINDERACE, FLYGON]) state = ensureCopies(state, "p1", id);
    const parked = play(state, ORB).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    const ids = new Set(prompt.candidates.map((uid) => parked.cardIdByUid[uid]));
    expect([...ids].sort()).toEqual([CYCLIZAR, TERAPAGOS_EX, UMBREON, CINDERACE, FLYGON].sort());
    expect(prompt.note).toContain("Tera Pokémon");
  });

  it("Tera Orb with no Tera Pokémon in the deck whiffs into the shuffle — no park", () => {
    let state = table();
    for (const id of [CYCLIZAR, TERAPAGOS_EX, UMBREON, CINDERACE, FLYGON]) state = purge(state, "p1", id);
    const { state: after, events } = play(state, ORB);
    expect(after.phase.kind).toBe("turn:action");
    expect(all(events, "SHUFFLE").length).toBeGreaterThan(0);
  });

  it("🛑 Glass Trumpet is REFUSED without a Tera Pokémon in play, and the reason is the printed clause", () => {
    const state = discard(table({ p1Bench: [PLAIN_C] }), "p1", R);
    expect(playRejected(state, TRUMPET)).toBe("PLAY_CONDITION_NOT_MET");
    // The REASON, not only the code: the refusal names the printed "only if" clause.
    const before = setHand(state, "p1", [TRUMPET]);
    const result = applyAction(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string });
    if (result.ok) throw new Error("Glass Trumpet was accepted");
    expect(result.error.message).toBe("Glass Trumpet can only be used if you have any Tera Pokémon in play");
  });

  it("🛑 with a Tera Pokémon in play: ONE attach park, the Benched {C} bodies only, max 2, one per body", () => {
    let state = table({ p1: CYCLIZAR, p1Bench: [PLAIN_C, FILLER, PLAIN_C] });
    state = discard(discard(state, "p1", R, 2), "p1", W, 1);
    const parked = play(state, TRUMPET).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
    expect(prompt.targets).toEqual([benchRef("p1", 0), benchRef("p1", 2)]); // the Water filler and the Active are out
    expect(prompt.max).toBe(2);
    expect(prompt.maxPerTarget).toBe(1);
    expect(prompt.note).toBe(
      "Choose up to 2 of your Benched Colorless Pokémon and attach a Basic Energy card from your discard pile to each of them.",
    );
    // The DISCARD PILE's Basic Energy only — the played Trumpet itself sits there too, and is not offered.
    for (const uid of prompt.candidates) expect([R, W]).toContain(parked.cardIdByUid[uid]);
    expect(parked.players.p1.discard.some((u) => parked.cardIdByUid[u] === TRUMPET)).toBe(true);
    const [first, second] = prompt.candidates as [string, string];
    // Two to ONE body is refused by the validator ("to each of them").
    expect(
      rejected(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [{ uid: first, to: benchRef("p1", 0) }, { uid: second, to: benchRef("p1", 0) }] },
      } as GameAction),
    ).toBe("BAD_EFFECT_CHOICE");
    const done = run(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: first, to: benchRef("p1", 0) }, { uid: second, to: benchRef("p1", 2) }] },
    } as GameAction).state;
    expect(bodyAt(done, "p1", 0).energy).toEqual([first]);
    expect(bodyAt(done, "p1", 2).energy).toEqual([second]);
    expect(done.players.p1.discard).not.toContain(first);
    expect(all(run(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: first, to: benchRef("p1", 0) }] },
    } as GameAction).events, "ENERGY_ATTACHED")).toHaveLength(1);
  });

  it("a Tera BENCHED body satisfies the gate too; an empty discard pile makes the card unplayable", () => {
    const benchedTera = discard(table({ p1Bench: [TERAPAGOS_EX, PLAIN_C] }), "p1", G);
    expect(phasePrompt(play(benchedTera, TRUMPET).state).kind).toBe("attachCards");
    // Terapagos ex is a Benched {C} body too — so it is a target (the print says {C}, and it is).
    const prompt = phasePrompt(play(benchedTera, TRUMPET).state);
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(prompt.targets).toEqual([benchRef("p1", 0), benchRef("p1", 1)]);
    expect(playRejected(table({ p1: CYCLIZAR, p1Bench: [PLAIN_C] }), TRUMPET)).toBe("NO_LEGAL_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — Briar: +1 Prize when a Tera Pokémon's attack damage Knocks Out the opponent's Active", () => {
  /** p1 Active `attacker` (energised for index 0), p2 Active `victim`; p2 at `prizes`; Briar played. */
  function briarBoard(
    attacker: string,
    victim: string,
    opts: { prizes?: number; play?: boolean; p1Bench?: readonly string[]; p2Bench?: readonly string[] } = {},
  ) {
    let state = table({ p1: attacker, p1Bench: opts.p1Bench ?? [], p2: victim, p2Bench: opts.p2Bench ?? [] });
    if (attacker === CYCLIZAR) state = energize(state, "p1", "active", R, 3);
    if (attacker === FLYGON) state = energize(state, "p1", "active", F, 1);
    state = setPrizes(state, "p2", opts.prizes ?? 2);
    if (opts.play === false) return state;
    return play(state, BRIAR).state;
  }

  it("🛑 the gate is EXACTLY 2: refused at 3 (and at 1), accepted at 2", () => {
    const at = (n: number) => setPrizes(table(), "p2", n);
    expect(playRejected(at(3), BRIAR)).toBe("PLAY_CONDITION_NOT_MET");
    expect(playRejected(at(1), BRIAR)).toBe("PLAY_CONDITION_NOT_MET");
    const { events } = play(at(2), BRIAR);
    expect(all(events, "TRAINER_PLAYED")).toHaveLength(1);
  });

  it("🛑 a Tera attacker (Cyclizar ex) Knocks Out the Active: ONE PRIZE_BONUS, +1, no ABILITY_TRIGGERED", () => {
    const { events } = attack(briarBoard(CYCLIZAR, WEAK), 0);
    const bonus = all(events, "PRIZE_BONUS");
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({ seat: "p2", by: 1, count: 2 });
    expect(all(events, "ABILITY_TRIGGERED")).toEqual([]);
  });

  it("🛑 a NON-Tera attacker (the Striker) Knocks Out the same Active: no bonus", () => {
    const { events } = attack(briarBoard(STRIKER, WEAK), 5);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
  });

  it("🛑 without Briar played this turn: no bonus (the datum is the turn's played Supporter)", () => {
    const { events } = attack(briarBoard(CYCLIZAR, WEAK, { play: false }), 0);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
  });

  it("🛑 a BENCHED body Knocked Out by the Tera attacker's snipe: no bonus (the Active only)", () => {
    const { events } = attack(briarBoard(CYCLIZAR, FILLER, { p2Bench: [WEAK] }), 0, benchRef("p2", 0));
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
  });

  /** Flygon ex's Reversing Storm into the 30-HP Active, answering its printed "may" with `yes`. */
  function reversingStorm(yes: boolean) {
    const first = run(briarBoard(FLYGON, WEAK, { p1Bench: [FILLER] }), { type: "attack", seat: "p1", index: 0 });
    expect(phasePrompt(first.state).kind).toBe("confirm");
    const second = run(first.state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
    return { state: second.state, events: [...first.events, ...second.events] };
  }

  it("🛑 \"used by your Tera Pokémon\" is the USER, not the spot: Flygon ex switched ITSELF out and still pays", () => {
    // Reversing Storm: "130. You may switch this Pokémon with 1 of your Benched Pokémon." The
    // switch lands BEFORE the Knock Out resolves, so at Knock Out time the Active is the
    // (non-Tera) Filler — and the attack was still used by a Tera Pokémon. The bonus is read off
    // `attackerUid` and its seat, never off `players[taker].active`.
    const { state, events } = reversingStorm(true);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(state.cardIdByUid[topOf(bodyAt(state, "p1", "active"))]).toBe(FILLER);
    const bonus = all(events, "PRIZE_BONUS");
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({ seat: "p2", by: 1, count: 2 });
  });

  it("…and declining the switch pays the same +1 (the control)", () => {
    const { state, events } = reversingStorm(false);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(state.cardIdByUid[topOf(bodyAt(state, "p1", "active"))]).toBe(FLYGON);
    expect(all(events, "PRIZE_BONUS")).toEqual([expect.objectContaining({ seat: "p2", by: 1, count: 2 })]);
  });

  it("🛑 the Checkup is not \"damage from an attack\": a Poison Knock Out of the Active pays nothing, with a Tera Pokémon Active", () => {
    // A TERA attacker stands Active (Cyclizar ex) and Briar is played, so every conjunct but
    // "by an attack" holds. ⚠️ What this end-to-end rung does and does NOT redden: the Checkup
    // hands `koPrizeBonus` no `attackerUid` (flow.ts' Checkup batch omits it), so dropping
    // `briarPrizeBonus`' `checkup` conjunct ALONE leaves this rung green — that conjunct is
    // pinned by the unit rung below (`D568-briar-checkup-counts`). This rung pins the WIRING:
    // a Checkup batch that started reading the Active as "the attacker" would pay here.
    let state = briarBoard(CYCLIZAR, WEAK);
    state = withBody(state, "p2", "active", (p) => ({
      ...p,
      damage: 20,
      conditions: { ...p.conditions, poisonDamage: 10 },
    }));
    const { events } = run(state, { type: "endTurn", seat: "p1" });
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(all(events, "PRIZE_BONUS")).toEqual([]);
  });

  it("🛑 `briarPrizeBonus`, conjunct by conjunct, on one Briar board", () => {
    const state = briarBoard(CYCLIZAR, WEAK);
    const dying = bodyAt(state, "p2", "active");
    const attacker = topOf(bodyAt(state, "p1", "active"));
    expect(briarPrizeBonus(state, "p1", dying, "p1", attacker, false)).toBe(1);
    // the mid-turn sweep (an Ability's counters) passes no attacker…
    expect(briarPrizeBonus(state, "p1", dying, undefined, undefined, false)).toBe(0);
    // …the Checkup is refused…
    expect(briarPrizeBonus(state, "p1", dying, "p1", attacker, true)).toBe(0);
    // …a benched KO has no Active body to hand in…
    expect(briarPrizeBonus(state, "p1", null, "p1", attacker, false)).toBe(0);
    // …a body doomed by an EFFECT (`knockOutDefender`) is not "by damage"…
    const doomed = { ...dying, markers: [...dying.markers, koByEffectMarker(state.turn)] };
    expect(briarPrizeBonus(state, "p1", doomed, "p1", attacker, false)).toBe(0);
    // …the attack must be the TAKER's own ("used by YOUR Tera Pokémon"): the same Tera uid
    // handed in under the other seat is refused…
    expect(briarPrizeBonus(state, "p1", dying, "p2", attacker, false)).toBe(0);
    // …and the attacker's card is read off its UID, wherever it now stands: a benched Tera
    // body's uid pays (Flygon ex's switch-out, end to end above), a non-Tera one does not.
    const benched = briarBoard(FILLER, WEAK, { p1Bench: [CYCLIZAR] });
    expect(briarPrizeBonus(benched, "p1", bodyAt(benched, "p2", "active"), "p1", topOf(bodyAt(benched, "p1", 0)), false)).toBe(1);
    expect(briarPrizeBonus(benched, "p1", bodyAt(benched, "p2", "active"), "p1", topOf(bodyAt(benched, "p1", "active")), false)).toBe(0);
    // A non-Tera attacker in the same seat: nothing.
    const plain = briarBoard(STRIKER, WEAK);
    expect(briarPrizeBonus(plain, "p1", bodyAt(plain, "p2", "active"), "p1", topOf(bodyAt(plain, "p1", "active")), false)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — Milotic ex \"Sparkling Scales\": damage AND effects from the opponent's Tera Pokémon", () => {
  it("the fold: one banner, off the holder's own row; empty on every other body", () => {
    const state = table({ p2: MILOTIC });
    expect(passivesOf(state, bodyAt(state, "p2", "active")).preventDamageAndEffectsFromBanners).toEqual(["Tera"]);
    expect(passivesOf(state, bodyAt(state, "p1", "active")).preventDamageAndEffectsFromBanners).toEqual([]);
    expect(preventsAttackerBanner(["Tera"], POOL[UMBREON])).toBe(true);
    expect(preventsAttackerBanner(["Tera"], POOL[PIKACHU_EX])).toBe(false);
    expect(preventsAttackerBanner([], POOL[UMBREON])).toBe(false);
    expect(preventsAttackerBanner(["Tera"], undefined)).toBe(false);
  });

  it("🛑 Umbreon ex (Tera) Moon Mirage into the Active Milotic ex: NO damage and NO Confusion", () => {
    let state = table({ p1: UMBREON, p2: MILOTIC });
    state = energize(state, "p1", "active", D, 3);
    const { state: after, events } = attack(state, 0);
    expect(bodyAt(after, "p2", "active").damage).toBe(0);
    expect(bodyAt(after, "p2", "active").conditions.rotation).toBe("none");
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("🛑 the SAME attack into a non-Milotic Active lands both halves — the control", () => {
    let state = table({ p1: UMBREON, p2: FILLER });
    state = energize(state, "p1", "active", D, 3);
    const after = attack(state, 0).state;
    expect(bodyAt(after, "p2", "active").damage).toBe(160);
    expect(bodyAt(after, "p2", "active").conditions.rotation).toBe("confused");
  });

  it("🛑 a NON-Tera attacker is not refused: the Striker's 300 lands on Milotic ex", () => {
    const after = attack(table({ p1: STRIKER, p2: MILOTIC }), 5).state;
    expect(after.players.p2.discard.some((u) => after.cardIdByUid[u] === MILOTIC)).toBe(true);
  });

  it("🛑 the `snipeActive` arm: Cinderace ex's Garnet Volley aimed at the ACTIVE Milotic ex does nothing, at a filler 180", () => {
    const volley = (victim: string) => {
      let state = table({ p1: CINDERACE, p2: victim, p2Bench: [FILLER] });
      state = energize(energize(energize(state, "p1", "active", R), "p1", "active", F), "p1", "active", D);
      return bodyAt(attack(state, 1, { seat: "p2", spot: { spot: "active" } }).state, "p2", "active").damage;
    };
    expect(volley(MILOTIC)).toBe(0);
    expect(volley(FILLER)).toBe(180);
  });

  it("no zone clause: a BENCHED Milotic ex refuses the Tera attacker's snipe", () => {
    let state = table({ p1: CYCLIZAR, p2Bench: [MILOTIC, FILLER] });
    state = energize(state, "p1", "active", R, 3);
    expect(bodyAt(attack(state, 0, benchRef("p2", 0)).state, "p2", 0).damage).toBe(0);
    expect(bodyAt(attack(state, 0, benchRef("p2", 1)).state, "p2", 1).damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — Noctowl \"Jewel Seeker\" and Azumarill \"Glistening Bubbles\"", () => {
  function evolveNoctowl(active: string): { state: GameState; events: GameEvent[] } {
    let state = table({ p1: active, p1Bench: [HOOTHOOT] });
    state = { ...state, turn: 4 }; // p1's SECOND turn: the benched Hoothoot may evolve
    state = withBody(state, "p1", 0, (p) => ({ ...p, turnPlayed: 1 }));
    state = setHand(state, "p1", [NOCTOWL]);
    const uid = state.players.p1.hand[0] as string;
    return run(state, { type: "evolve", seat: "p1", uid, target: { spot: "bench", index: 0 } } as GameAction);
  }

  it("🛑 evolved from the hand with a Tera Pokémon in play: the search parks, Trainer cards only, up to 2", () => {
    const { state } = evolveNoctowl(CYCLIZAR);
    const prompt = phasePrompt(state);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect(prompt.max).toBe(2);
    for (const uid of prompt.candidates) expect(POOL[state.cardIdByUid[uid] ?? ""]?.category).toBe("Trainer");
  });

  it("🛑 …and with NO Tera Pokémon in play the Ability does nothing — no park, no search, no shuffle", () => {
    const { state, events } = evolveNoctowl(FILLER);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "SHUFFLE")).toEqual([]);
  });

  it("🛑 Double-Edge costs {P} with a Tera Pokémon in play, its printed {P}{P}{P}{P} without", () => {
    const withTera = energize(table({ p1: AZUMARILL, p1Bench: [TERAPAGOS_EX] }), "p1", "active", P);
    expect(attackCostAt(withTera, "p1", bodyAt(withTera, "p1", "active"), 0, ["Psychic"])).toEqual(["Psychic"]);
    const without = energize(table({ p1: AZUMARILL }), "p1", "active", P);
    expect(attackCostAt(without, "p1", bodyAt(without, "p1", "active"), 0, ["Psychic"])).toEqual([
      "Psychic",
      "Psychic",
      "Psychic",
      "Psychic",
    ]);
    // …and the alternate is charged only while payable: nothing attached → the printed cost.
    const bare = table({ p1: AZUMARILL, p1Bench: [TERAPAGOS_EX] });
    expect(attackCostAt(bare, "p1", bodyAt(bare, "p1", "active"), 0, [])).toHaveLength(4);
    const hit = attack(withTera, 0);
    expect(all(hit.events, "DAMAGE_DEALT").some((e) => e.dealt === 230)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the three attacks: Shining Blaze, Jewel Breaker, Prism Charge", () => {
  it("🛑 Ho-Oh +100 with a Tera Pokémon on YOUR BENCH — not a non-Tera ex, not the OPPONENT's Tera Active", () => {
    // Ho-Oh is itself the Active here, so YOUR Active can never be a Tera Pokémon on this
    // board; "an Active Tera is not on your Bench" is pinned zone-exactly by §3's
    // `conditionHolds` rung (`activeOnly` → `onBench` false). What this board adds is the
    // SEAT half: a Tera Pokémon in the OPPONENT's Active Spot does not count.
    const blaze = (bench: readonly string[], p2?: string) => {
      let state = table({ p1: HO_OH, p1Bench: bench, ...(p2 === undefined ? {} : { p2 }) });
      state = energize(state, "p1", "active", R, 3);
      return all(attack(state, 1).events, "DAMAGE_DEALT")[0]?.dealt;
    };
    expect(blaze([CYCLIZAR])).toBe(200);
    expect(blaze([PIKACHU_EX])).toBe(100);
    expect(blaze([])).toBe(100);
    expect(blaze([], CYCLIZAR)).toBe(100);
  });

  it("🛑 Regigigas +230 into a Tera Active, printed 100 otherwise", () => {
    const breaker = (victim: string) => {
      let state = table({ p1: REGIGIGAS, p2: victim });
      state = energize(energize(state, "p1", "active", W, 2), "p1", "active", L, 2);
      return all(attack(state, 0).events, "DAMAGE_DEALT")[0]?.dealt;
    };
    expect(breaker(TERAPAGOS_EX)).toBe(330);
    expect(breaker(PIKACHU_EX)).toBe(100);
  });

  it("🛑 Prism Charge: one card PER TYPE, targets only the Tera bodies, the printed caption", () => {
    let state = table({ p1: TERAPAGOS, p1Bench: [CYCLIZAR, FILLER, TERAPAGOS_EX] });
    state = energize(state, "p1", "active", W);
    for (const id of [R, W, L, P]) state = ensureCopies(state, "p1", id, 2);
    const parked = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
    const types = prompt.candidates.map((uid) => POOL[parked.cardIdByUid[uid] ?? ""]?.name);
    expect(new Set(types).size).toBe(types.length); // one candidate per type
    expect(types.length).toBeGreaterThanOrEqual(4);
    expect(prompt.max).toBe(3);
    expect(prompt.maxPerTarget).toBeUndefined(); // "in any way you like"
    expect(prompt.targets).toEqual([benchRef("p1", 0), benchRef("p1", 2)]); // Terapagos itself is NOT Tera
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like.",
    );
    const [a, b, c] = prompt.candidates as [string, string, string];
    const done = run(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: a, to: benchRef("p1", 0) },
          { uid: b, to: benchRef("p1", 0) },
          { uid: c, to: benchRef("p1", 2) },
        ],
      },
    } as GameAction);
    expect(bodyAt(done.state, "p1", 0).energy).toEqual([a, b]);
    expect(bodyAt(done.state, "p1", 2).energy).toEqual([c]);
    expect(all(done.events, "SHUFFLE").length).toBeGreaterThan(0);
  });

  it("🛑 Prism Charge with NO Tera Pokémon in play: nothing to attach to — no park, and the shuffle still runs", () => {
    let state = table({ p1: TERAPAGOS, p1Bench: [FILLER] });
    state = energize(state, "p1", "active", W);
    const { state: after, events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "SHUFFLE").length).toBeGreaterThan(0);
    expect(all(events, "ENERGY_ATTACHED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — the version", () => {
  it("the engine is 0.555.0", () => {
    expect(engineVersion).toBe("0.555.0");
    expect(manifest.version).toBe("0.555.0");
  });
});
