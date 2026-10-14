import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { BANNER_BY_ID, bannerOf } from "./banners";
import { LEGAL_EX_POOL } from "./bannerPool";
import { isTeraPokemon, matchesFilter } from "./cards";
import { benchShieldedFromDamage, disabledAbilityUids, seatPreWRDamageBonus } from "./continuous";
import { deriveAttackDamageBonus, deriveAttackDamageMultiplier, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { conditionHolds, conditionNote, retrieveNoun } from "./interpreter";
import { PARADOX_POOL } from "./paradoxPool";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
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

// ── 🆕🆕🆕 D569 — THE PARADOX BANNER UNLOCK, SLICE 2 PART a: 20 PRINTINGS ──────────────────────
//
//   The datum      banners.ts `Banner = "Tera" | "Ancient" | "Future"`, +86 ids (Ancient 44, Future 42)
//   Vocabulary     cards.ts `bannerCard` (ANY category); `BoardCondition` `opponentBannerPokemonInPlay`
//                  and `yourPlayedBannerSupporterThisTurn`; `healChosen.filter`,
//                  `moveCountersToDefender.filter`, `drawCards.per` → `pokemonInPlay`,
//                  `attachFromDiscard.targetBanner` / `.each`, `seatDamageBonusBeforeWR.exceptName`
//   Attacks (+12)  Miraidon sv05-121/svp-092 "Peak Acceleration", Great Tusk sv05-097/sv08.5-055 "Land
//                  Collapse", Scream Tail sv05-077 "Supportive Singing", Flutter Mane sv08-096
//                  "Perplexing Transfer" (registry rows); Koraidon sv05-119/svp-091 "Primordial
//                  Beatdown", Roaring Moon sv05-109/sv08.5-065 "Vengeance Fletching", Iron Valiant
//                  sv05-080 "Majestic Sword", Slither Wing sv06.5-026 "Iron Smasher" (deriver rows)
//   Abilities (+6) Iron Crown ex "Cobalt Command" sv05-081/-191/-206/-216, sv08.5-158, svp-146
//   Trainers (+2)  Awakening Drum sv05-141, Reboot Pod sv05-158
//
// Driven on REAL ids in a LOCAL `cardPool` (D275) — the table knows no `fix-*` id — with the card
// bodies transcribed from the tcgdex card JSON (the audit's, 2026-10-02). Rulings R-PX1 … R-PX5 are
// ⚠️ UNRULED: docs/decisions.md D569.

const KORAIDON = "sv05-119"; // Ancient — Primordial Beatdown 30× per own Ancient in play
const ROARING_MOON = "sv05-109"; // Ancient — Vengeance Fletching 70+, +10 per Ancient CARD in discard
const IRON_VALIANT = "sv05-080"; // Future — Majestic Sword 100+, +100 after a Future Supporter
const SLITHER_WING = "sv06.5-026"; // Ancient — Iron Smasher 20+, +120 vs any opposing Future body
const MIRAIDON = "sv05-121"; // Future — Peak Acceleration 40, attach up to 2 onto Future
const GREAT_TUSK = "sv05-097"; // Ancient — Land Collapse, mill 1 (+3 after an Ancient Supporter)
const SCREAM_TAIL = "sv05-077"; // Ancient — Supportive Singing, heal 100 from a Benched Ancient
const FLUTTER_MANE = "sv08-096"; // Ancient — Perplexing Transfer, move a Benched Ancient's counters
const IRON_CROWN = "sv05-081"; // Future ex — Cobalt Command
const IRON_THORNS_EX = "sv06-077"; // Future ex — Initialization (UNBUILT at D569; 🆕🆕🆕 D571 (D539): BUILT, `INITIALIZATION`)
const DRUM = "sv05-141"; // Ancient Item
const POD = "sv05-158"; // Future Item
const GUIDANCE = "sv05-147"; // Ancient Supporter — Explorer's Guidance
const CIPHER = "sv05-145"; // Future Supporter — Ciphermaniac's Codebreaking
const TERAPAGOS_EX = "sv07-128"; // Tera ex — the Bench-shield control
const BRIAR = "sv07-132"; // Tera Supporter — the WRONG-banner played Supporter
const KLEFKI = "sv01-096"; // Mischievous Lock — the §9 control (FIXTURE_POOL)
const FILLER = "d569-filler";
const STRIKER = "d569-striker";
const R = "d569-R";
const W = "d569-W";
const L = "d569-L";
const P = "d569-P";
const F = "d569-F";
const D = "d569-D";
const C_ = "d569-C";

const BENCH_SPREAD =
  "This attack also does 20 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const LOCAL_CARDS: Record<string, Card> = {
  [KORAIDON]: battler(KORAIDON, {"name":"Koraidon","hp":140,"types":["Dragon"],"retreat":2,"attacks":[{"cost":["Fighting","Colorless"],"name":"Primordial Beatdown","damage":"30×","effect":"This attack does 30 damage for each of your Ancient Pokémon in play."},{"cost":["Fire","Fighting","Colorless"],"name":"Shred","damage":130,"effect":"This attack's damage isn't affected by any effects on your opponent's Active Pokémon."}]}),
  [ROARING_MOON]: battler(ROARING_MOON, {"name":"Roaring Moon","hp":140,"types":["Darkness"],"retreat":2,"weaknesses":[{"type":"Grass","value":"×2"}],"attacks":[{"cost":["Darkness","Darkness"],"name":"Vengeance Fletching","damage":"70+","effect":"This attack does 10 more damage for each Ancient card in your discard pile."},{"cost":["Darkness","Colorless","Colorless","Colorless"],"name":"Speed Wing","damage":120}]}),
  [IRON_VALIANT]: battler(IRON_VALIANT, {"name":"Iron Valiant","hp":130,"types":["Psychic"],"retreat":2,"weaknesses":[{"type":"Metal","value":"×2"}],"attacks":[{"cost":["Psychic"],"name":"Calculation","effect":"Look at the top 4 cards of your deck and put them back in any order."},{"cost":["Psychic","Psychic","Colorless"],"name":"Majestic Sword","damage":"100+","effect":"If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage."}]}),
  [SLITHER_WING]: battler(SLITHER_WING, {"name":"Slither Wing","hp":140,"types":["Fighting"],"retreat":3,"weaknesses":[{"type":"Psychic","value":"×2"}],"attacks":[{"cost":["Fighting","Colorless"],"name":"Iron Smasher","damage":"20+","effect":"If your opponent has any Future Pokémon in play, this attack does 120 more damage."},{"cost":["Fighting","Fighting","Colorless"],"name":"Smashing Wing","damage":130,"effect":"Discard 2 Energy from this Pokémon."}]}),
  [MIRAIDON]: battler(MIRAIDON, {"name":"Miraidon","hp":110,"types":["Dragon"],"retreat":2,"attacks":[{"cost":["Colorless"],"name":"Peak Acceleration","damage":40,"effect":"Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck."},{"cost":["Lightning","Lightning","Psychic"],"name":"Sparking Strike","damage":160}]}),
  [GREAT_TUSK]: battler(GREAT_TUSK, {"name":"Great Tusk","hp":140,"types":["Fighting"],"retreat":3,"weaknesses":[{"type":"Psychic","value":"×2"}],"attacks":[{"cost":["Colorless","Colorless"],"name":"Land Collapse","effect":"Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way."},{"cost":["Fighting","Fighting","Colorless","Colorless"],"name":"Giant Tusk","damage":160}]}),
  [SCREAM_TAIL]: battler(SCREAM_TAIL, {"name":"Scream Tail","hp":90,"types":["Psychic"],"retreat":1,"weaknesses":[{"type":"Darkness","value":"×2"}],"attacks":[{"cost":["Colorless"],"name":"Supportive Singing","effect":"Heal 100 damage from 1 of your Benched Ancient Pokémon."},{"cost":["Colorless","Colorless"],"name":"Hyper Voice","damage":40}]}),
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {"name":"Flutter Mane","hp":90,"types":["Psychic"],"retreat":1,"weaknesses":[{"type":"Metal","value":"×2"}],"attacks":[{"cost":["Colorless","Colorless"],"name":"Perplexing Transfer","effect":"Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon."},{"cost":["Psychic","Psychic"],"name":"Moonblast","damage":70,"effect":"During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance)."}]}),
  [IRON_CROWN]: battler(IRON_CROWN, {"name":"Iron Crown ex","hp":220,"types":["Psychic"],"retreat":2,"weaknesses":[{"type":"Darkness","value":"×2"}],"attacks":[{"cost":["Psychic","Colorless","Colorless"],"name":"Twin Shotels","effect":"This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon."}],"abilities":[{"type":"Ability","name":"Cobalt Command","effect":"Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."}]}),
  [IRON_THORNS_EX]: battler(IRON_THORNS_EX, {"name":"Iron Thorns ex","hp":230,"types":["Lightning"],"retreat":4,"weaknesses":[{"type":"Fighting","value":"×2"}],"attacks":[{"cost":["Lightning","Colorless","Colorless"],"name":"Volt Cyclone","damage":140,"effect":"Move an Energy from this Pokémon to 1 of your Benched Pokémon."}],"abilities":[{"type":"Ability","name":"Initialization","effect":"As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)"}]}),
  [DRUM]: { ...trainerCard(DRUM, "Item", "Draw a card for each of your Ancient Pokémon in play."), name: "Awakening Drum" },
  [POD]: { ...trainerCard(POD, "Item", "Attach a Basic Energy card from your discard pile to each of your Future Pokémon."), name: "Reboot Pod" },
  [GUIDANCE]: { ...trainerCard(GUIDANCE, "Supporter", "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards."), name: "Explorer's Guidance" },
  [CIPHER]: { ...trainerCard(CIPHER, "Supporter", "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order."), name: "Ciphermaniac's Codebreaking" },
  [TERAPAGOS_EX]: battler(TERAPAGOS_EX, {"name":"Terapagos ex","hp":230,"types":["Colorless"],"retreat":2,"weaknesses":[{"type":"Fighting","value":"×2"}],"attacks":[{"cost":["Colorless","Colorless"],"name":"Unified Beatdown","damage":"30×","effect":"If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon."},{"cost":["Grass","Water","Lightning"],"name":"Crown Opal","damage":180,"effect":"During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon."}]}),
  [BRIAR]: {
    ...trainerCard(
      BRIAR,
      "Supporter",
      "You can use this card only if your opponent has exactly 2 Prize cards remaining.\n\nDuring this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your Tera Pokémon, take 1 more Prize card.",
    ),
    name: "Briar",
  },
  [FILLER]: battler(FILLER, { name: "D569 Filler", hp: 900, types: ["Water"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [STRIKER]: battler(STRIKER, {
    name: "D569 Striker",
    hp: 900,
    types: ["Water"],
    attacks: [{ cost: [], name: "Spread Out", damage: 10, effect: BENCH_SPREAD }],
  }),
  [C_]: battler(C_, { name: "D569 Plain", hp: 900, types: ["Water"] }),
  [R]: typedEnergy(R, "Fire"),
  [W]: typedEnergy(W, "Water"),
  [L]: typedEnergy(L, "Lightning"),
  [P]: typedEnergy(P, "Psychic"),
  [F]: typedEnergy(F, "Fighting"),
  [D]: typedEnergy(D, "Darkness"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [KORAIDON]: 2,
  [ROARING_MOON]: 1,
  [IRON_VALIANT]: 1,
  [SLITHER_WING]: 1,
  [MIRAIDON]: 2,
  [GREAT_TUSK]: 1,
  [SCREAM_TAIL]: 1,
  [FLUTTER_MANE]: 1,
  [IRON_CROWN]: 2,
  [IRON_THORNS_EX]: 1,
  [TERAPAGOS_EX]: 1,
  [KLEFKI]: 1,
  [DRUM]: 1,
  [POD]: 1,
  [GUIDANCE]: 2,
  [CIPHER]: 1,
  [BRIAR]: 1,
  [STRIKER]: 1,
  [C_]: 2,
  [R]: 3,
  [W]: 3,
  [L]: 3,
  [P]: 4,
  [F]: 4,
  [D]: 3,
  [FILLER]: 16,
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

/** Prized/hand copies of `id` swapped into the deck until the deck holds at least `k` copies. */
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
  for (const id of ids) next = ensureCopies(next, seat, id, ids.filter((x) => x === id).length);
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

/** TEST SURGERY — every Basic Energy (and every other card) out of `seat`'s discard pile, back into the deck. */
function emptyDiscard(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck: [...side.deck, ...side.discard], discard: [] } },
  };
}

/** TEST SURGERY — `id` "played from the hand this turn": the card goes to the discard pile and
    the turn's allowances record it, exactly the two writes `playTrainer` makes (cardplay.ts). */
function playedSupporter(state: GameState, seat: Seat, id: string): GameState {
  const next = discard(state, seat, id);
  const side = next.players[seat];
  const uid = side.discard[side.discard.length - 1] as string;
  return { ...next, allowances: { ...next.allowances, supporterPlayed: true, supporterPlayedUid: uid } };
}

/** Both boards laid out by surgery on p1's first turn; both hands emptied. */
function table(
  opts: { p1?: string; p1Bench?: readonly string[]; p2?: string; p2Bench?: readonly string[] } = {},
  seed = 5691,
): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = emptyDiscard(emptyDiscard(state, "p1"), "p2");
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

const benchRef = (seat: Seat, index: number): PokemonRef => ({ seat, spot: { spot: "bench", index } });

function phasePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
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

const dealt = (events: readonly GameEvent[]): number | undefined => all(events, "DAMAGE_DEALT")[0]?.dealt;
const card = (id: string): Card => POOL[id] as Card;
const roundTrip = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the datum: `banners.ts`' 86 Paradox ids, two sources plus the printed face", () => {
  const paradox = Object.keys(BANNER_BY_ID).filter((id) => BANNER_BY_ID[id] !== "Tera");
  const exPool = new Map(LEGAL_EX_POOL.map((row) => [row[0], row] as const));
  const pool = new Map(PARADOX_POOL.map((row) => [row[0], row] as const));

  it("86 ids: Ancient 44 (40 Pokémon + 4 Trainers), Future 42 (38 Pokémon + 4 Trainers)", () => {
    expect(paradox).toHaveLength(86);
    const count = (banner: string, category: string) =>
      paradox.filter(
        (id) =>
          BANNER_BY_ID[id] === banner &&
          (exPool.has(id) ? "Pokemon" : (pool.get(id)?.[2] ?? "missing")) === category,
      ).length;
    expect([count("Ancient", "Pokemon"), count("Ancient", "Trainer")]).toEqual([40, 4]);
    expect([count("Future", "Pokemon"), count("Future", "Trainer")]).toEqual([38, 4]);
  });

  it("🛑 every Paradox id is a legal printing in one of the two local pools (ex rows in `LEGAL_EX_POOL`)", () => {
    for (const id of paradox) expect(exPool.has(id) || pool.has(id), id).toBe(true);
    expect(PARADOX_POOL).toHaveLength(47);
  });

  it("🛑 the eight Trainers are the four printed names, and the Ancient/Future split is by name", () => {
    const trainers = paradox.filter((id) => pool.get(id)?.[2] === "Trainer");
    expect(trainers.map((id) => [id, pool.get(id)?.[1], BANNER_BY_ID[id]]).sort()).toEqual(
      [
        ["sv05-141", "Awakening Drum", "Ancient"],
        ["sv05-145", "Ciphermaniac's Codebreaking", "Future"],
        ["sv05-147", "Explorer's Guidance", "Ancient"],
        ["sv05-158", "Reboot Pod", "Future"],
        ["sv05-198", "Ciphermaniac's Codebreaking", "Future"],
        ["sv05-200", "Explorer's Guidance", "Ancient"],
        ["sv08.5-104", "Ciphermaniac's Codebreaking", "Future"],
        ["sv08.5-107", "Explorer's Guidance", "Ancient"],
      ].sort(),
    );
  });

  it("🛑 REPRINT CONSISTENCY: same name, HP, attacks and abilities agree on the banner — over BOTH pools", () => {
    const groups = new Map<string, string[]>();
    const add = (id: string, key: unknown) => {
      const k = JSON.stringify(key);
      groups.set(k, [...(groups.get(k) ?? []), id]);
    };
    for (const [id, name, hp, attacks, abilities] of LEGAL_EX_POOL) add(id, [name, hp, attacks, abilities]);
    for (const [id, name, , hp, attacks, abilities] of PARADOX_POOL) add(id, [name, hp, attacks, abilities]);
    const split = [...groups.values()].filter((members) => new Set(members.map((id) => BANNER_BY_ID[id])).size > 1);
    expect(split).toEqual([]);
    // ⚠️ NOT VACUOUS: Iron Crown ex is SIX printings of one text, all Future.
    const crown = [...groups.values()].find((members) => members.includes(IRON_CROWN));
    expect(crown?.sort()).toEqual(["sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158", "svp-146"]);
    for (const id of crown ?? []) expect(BANNER_BY_ID[id], id).toBe("Future");
  });

  it("🛑 THE NAME IS NOT THE BANNER — three same-species legal printings carry NO banner (the tcgdex image)", () => {
    expect(pool.get("sv07-090")?.slice(0, 2)).toEqual(["sv07-090", "Koraidon"]);
    expect(pool.get("svp-148")?.slice(0, 2)).toEqual(["svp-148", "Miraidon"]);
    expect(exPool.get("svp-197")?.slice(0, 2)).toEqual(["svp-197", "Koraidon ex"]);
    for (const id of ["sv07-090", "svp-148", "svp-197"]) expect(BANNER_BY_ID[id], id).toBeUndefined();
    // …while their banner siblings ARE keyed — the table is by ID (D135).
    expect(BANNER_BY_ID[KORAIDON]).toBe("Ancient");
    expect(BANNER_BY_ID["sv05-120"]).toBe("Ancient"); // Koraidon ex
    expect(BANNER_BY_ID[MIRAIDON]).toBe("Future");
  });

  it("the ~~Tera~~ `sv` Tera rows are untouched: 98, and no id carries two banners (a Record cannot) (🆕🆕🆕 D582 (D539): *the Tera rows are 98* WITHDRAWN — 103: 98 `sv` + 5 `me` reprints)", () => {
    // 🆕🆕🆕 D582 — the `sv` Tera rows are still 98; the table gained FIVE `me` Tera reprints
    // (`me02.5-*`, `reprintAliasMeD582.test.ts`), so 103 Tera / 189 in all.
    const tera = Object.keys(BANNER_BY_ID).filter((id) => BANNER_BY_ID[id] === "Tera");
    expect(tera.filter((id) => !id.startsWith("me"))).toHaveLength(98);
    expect(tera).toHaveLength(103);
    expect(Object.keys(BANNER_BY_ID)).toHaveLength(189);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — `bannerCard` (any category) against `bannerPokemon` (Pokémon only)", () => {
  it("🛑 an Ancient TRAINER is an Ancient card and NOT an Ancient Pokémon — the undercount `bannerPokemon` would ship", () => {
    const ancientCard = { kind: "bannerCard", banner: "Ancient" } as const;
    const ancientPokemon = { kind: "bannerPokemon", banner: "Ancient" } as const;
    expect(matchesFilter(card(GUIDANCE), ancientCard)).toBe(true);
    expect(matchesFilter(card(GUIDANCE), ancientPokemon)).toBe(false);
    expect(matchesFilter(card(DRUM), ancientCard)).toBe(true);
    expect(matchesFilter(card(KORAIDON), ancientCard)).toBe(true);
    expect(matchesFilter(card(KORAIDON), ancientPokemon)).toBe(true);
    // The OTHER banner, a bannerless card, an unresolvable card: all false.
    expect(matchesFilter(card(POD), ancientCard)).toBe(false);
    expect(matchesFilter(card(IRON_VALIANT), ancientCard)).toBe(false);
    expect(matchesFilter(card(FILLER), ancientCard)).toBe(false);
    expect(matchesFilter(undefined, ancientCard)).toBe(false);
    expect(retrieveNoun(ancientCard)).toEqual({ singular: "an Ancient card", plural: "Ancient cards" });
    expect(retrieveNoun({ kind: "bannerCard", banner: "Future" })).toEqual({
      singular: "a Future card",
      plural: "Future cards",
    });
  });

  it("🛑 the Tera rule stays TERA: no Ancient or Future Pokémon is `isTeraPokemon`", () => {
    for (const id of [KORAIDON, IRON_CROWN, MIRAIDON, IRON_THORNS_EX]) expect(isTeraPokemon(card(id)), id).toBe(false);
    expect(isTeraPokemon(card(TERAPAGOS_EX))).toBe(true);
    expect(bannerOf(card(IRON_CROWN))).toBe("Future");
  });

  it("🛑 the Tera Bench shield does NOT extend to Ancient/Future: a benched Koraidon and Iron Crown ex take the spread", () => {
    let state = table({ p1: STRIKER, p2Bench: [KORAIDON, IRON_CROWN, TERAPAGOS_EX] });
    expect(benchShieldedFromDamage(state, bodyAt(state, "p2", 0), "all")).toBe(false);
    expect(benchShieldedFromDamage(state, bodyAt(state, "p2", 2), "all")).toBe(true);
    state = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(bodyAt(state, "p2", 0).damage).toBe(20);
    expect(bodyAt(state, "p2", 1).damage).toBe(20);
    expect(bodyAt(state, "p2", 2).damage).toBe(0); // the Tera control
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the two NEW board conditions, read on real boards", () => {
  it("🛑 `opponentBannerPokemonInPlay`: the OTHER seat's Active AND Bench, never your own", () => {
    const cond = { kind: "opponentBannerPokemonInPlay", banner: "Future" } as const;
    expect(conditionHolds(table({ p2Bench: [IRON_VALIANT] }), "p1", cond)).toBe(true);
    expect(conditionHolds(table({ p2: MIRAIDON }), "p1", cond)).toBe(true);
    expect(conditionHolds(table({ p1Bench: [IRON_VALIANT], p2Bench: [KORAIDON] }), "p1", cond)).toBe(false);
    expect(conditionNote(cond)).toBe("your opponent has any Future Pokémon in play");
  });

  it("🛑 `yourPlayedBannerSupporterThisTurn`: the PLAYED Supporter's printing, its banner, the turn owner only", () => {
    const ancient = { kind: "yourPlayedBannerSupporterThisTurn", banner: "Ancient" } as const;
    const future = { kind: "yourPlayedBannerSupporterThisTurn", banner: "Future" } as const;
    const base = table();
    expect(conditionHolds(base, "p1", ancient)).toBe(false); // no Supporter
    const guided = playedSupporter(base, "p1", GUIDANCE);
    expect(conditionHolds(guided, "p1", ancient)).toBe(true);
    expect(conditionHolds(guided, "p1", future)).toBe(false); // the WRONG banner
    expect(conditionHolds(guided, "p2", ancient)).toBe(false); // not the turn owner
    expect(conditionHolds(playedSupporter(base, "p1", BRIAR), "p1", ancient)).toBe(false); // a Tera Supporter
    expect(conditionNote(ancient)).toBe("you played an Ancient Supporter card from your hand during this turn");
    expect(conditionNote(future)).toBe("you played a Future Supporter card from your hand during this turn");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the four deriver arms: Primordial Beatdown, Vengeance Fletching, Majestic Sword, Iron Smasher", () => {
  it("🛑 the four sentences derive to the banner readers, and nothing else does the reading", () => {
    expect(deriveAttackDamageMultiplier("This attack does 30 damage for each of your Ancient Pokémon in play.")).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "bannerPokemon", banner: "Ancient" } },
    });
    expect(deriveAttackDamageBonus("This attack does 10 more damage for each Ancient card in your discard pile.")).toEqual({
      per: 10,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: { kind: "bannerCard", banner: "Ancient" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "yourPlayedBannerSupporterThisTurn", banner: "Future" } });
    expect(
      deriveAttackDamageBonus("If your opponent has any Future Pokémon in play, this attack does 120 more damage.")?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentBannerPokemonInPlay", banner: "Future" } });
    // No registry row: these six printings simulate off their printed text.
    for (const id of [KORAIDON, "svp-091", ROARING_MOON, "sv08.5-065", IRON_VALIANT, SLITHER_WING]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("🛑 Koraidon: 30 × YOUR Ancient Pokémon in play — itself included, the opponent's and a Future body not", () => {
    const beat = (bench: readonly string[], p2Bench: readonly string[] = []) => {
      let state = table({ p1: KORAIDON, p1Bench: bench, p2Bench });
      state = energize(state, "p1", "active", F, 2);
      return dealt(run(state, { type: "attack", seat: "p1", index: 0 }).events);
    };
    expect(beat([])).toBe(30);
    expect(beat([GREAT_TUSK, SCREAM_TAIL])).toBe(90);
    expect(beat([GREAT_TUSK, IRON_VALIANT], [KORAIDON, FLUTTER_MANE])).toBe(60);
  });

  it("🛑 Roaring Moon: +10 per Ancient CARD in YOUR discard — the Trainer counts, a Future card does not", () => {
    const fletch = (pile: readonly string[]) => {
      let state = table({ p1: ROARING_MOON });
      state = energize(state, "p1", "active", D, 2);
      for (const id of pile) state = discard(state, "p1", id);
      state = discard(state, "p2", GUIDANCE); // the opponent's pile is not read
      return dealt(run(state, { type: "attack", seat: "p1", index: 0 }).events);
    };
    expect(fletch([])).toBe(70);
    expect(fletch([GUIDANCE])).toBe(80); // Explorer's Guidance — an Ancient TRAINER
    expect(fletch([GUIDANCE, DRUM, KORAIDON, POD, IRON_VALIANT, FILLER])).toBe(100);
  });

  it("🛑 Iron Valiant: +100 ONLY after a FUTURE Supporter — none, Ancient and Tera Supporters do not pay", () => {
    const sword = (prep: (s: GameState) => GameState) => {
      let state = table({ p1: IRON_VALIANT });
      state = energize(state, "p1", "active", P, 3);
      return dealt(run(prep(state), { type: "attack", seat: "p1", index: 1 }).events);
    };
    expect(sword((s) => s)).toBe(100);
    expect(sword((s) => playedSupporter(s, "p1", GUIDANCE))).toBe(100);
    expect(sword((s) => playedSupporter(s, "p1", BRIAR))).toBe(100);
    expect(sword((s) => playedSupporter(s, "p1", CIPHER))).toBe(200);
  });

  it("🛑 Slither Wing: +120 against ANY opposing Future body (Active or Bench) — your own Future bodies are not read", () => {
    const smash = (opts: { p1Bench?: string[]; p2?: string; p2Bench?: string[] }) => {
      let state = table({ p1: SLITHER_WING, ...opts });
      state = energize(state, "p1", "active", F, 2);
      return dealt(run(state, { type: "attack", seat: "p1", index: 0 }).events);
    };
    expect(smash({})).toBe(20);
    expect(smash({ p2Bench: [IRON_CROWN] })).toBe(140);
    expect(smash({ p1Bench: [IRON_VALIANT], p2Bench: [KORAIDON] })).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — the four registry attacks", () => {
  it("🛑 Peak Acceleration: up to 2 Basic Energy onto FUTURE bodies only, 40 damage, the deck shuffled", () => {
    let state = table({ p1: MIRAIDON, p1Bench: [KORAIDON, IRON_VALIANT, FILLER] });
    state = energize(state, "p1", "active", W);
    const first = run(state, { type: "attack", seat: "p1", index: 0 });
    const prompt = phasePrompt(first.state);
    if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
    expect(prompt.targets).toEqual([{ seat: "p1", spot: { spot: "active" } }, benchRef("p1", 1)]);
    expect(prompt.max).toBe(2);
    expect(prompt.note).toBe(
      "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like.",
    );
    const [a, b] = prompt.candidates as [string, string];
    const answer = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: a, to: benchRef("p1", 1) }, { uid: b, to: benchRef("p1", 1) }] },
    } as GameAction;
    // An Ancient body is not a target — the validator refuses it by the PROMPT.
    expect(
      rejected(first.state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [{ uid: a, to: benchRef("p1", 0) }] },
      } as GameAction),
    ).toBe("BAD_EFFECT_CHOICE");
    const done = run(first.state, answer);
    expect(bodyAt(done.state, "p1", 1).energy).toEqual([a, b]);
    expect(all([...first.events, ...done.events], "SHUFFLE").length).toBeGreaterThan(0);
    expect(dealt([...first.events, ...done.events])).toBe(40);
    // 🛑 THE PARKED OP SURVIVES A JSON ROUND TRIP (the match record's bytes) and resolves identically.
    const replayed = run(roundTrip(first.state), answer);
    expect(bodyAt(replayed.state, "p1", 1).energy).toEqual([a, b]);
  });

  it("🛑 Land Collapse: mill 1; +3 ONLY after an ANCIENT Supporter (a real Explorer's Guidance) — none, a Tera Briar, a Future Supporter do not", () => {
    const collapse = (prep: (s: GameState) => GameState) => {
      let state = table({ p1: GREAT_TUSK });
      state = energize(state, "p1", "active", F, 2);
      state = prep(state);
      // Read off the opponent's DISCARD PILE: the attack ends the turn [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] and p2 draws, so the
      // deck count would carry a draw the mill never made.
      const before = state.players.p2.discard.length;
      const after = run(state, { type: "attack", seat: "p1", index: 0 }).state;
      return after.players.p2.discard.length - before;
    };
    expect(collapse((s) => s)).toBe(1);
    expect(collapse((s) => playedSupporter(s, "p1", CIPHER))).toBe(1);
    // A REAL play of Briar (Tera) — opponent at exactly 2 Prizes — sets the uid the gate reads.
    expect(collapse((s) => play(setPrizes(s, "p2", 2), BRIAR).state)).toBe(1);
    // A REAL play of Explorer's Guidance, its look-at-6 answered: the Ancient banner pays.
    expect(
      collapse((s) => {
        const parked = play(s, GUIDANCE).state;
        const prompt = phasePrompt(parked);
        if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
        return run(parked, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "cards", uids: prompt.candidates.slice(0, prompt.max) },
        } as GameAction).state;
      }),
    ).toBe(4);
  });

  it("🛑 Supportive Singing: 100 off ONE BENCHED ANCIENT — the Active and a Future body are not candidates", () => {
    let state = table({ p1: SCREAM_TAIL, p1Bench: [IRON_VALIANT, KORAIDON] });
    state = energize(state, "p1", "active", P);
    for (const spot of [0, 1] as const) state = withBody(state, "p1", spot, (p) => ({ ...p, damage: 120 }));
    state = withBody(state, "p1", "active", (p) => ({ ...p, damage: 60 })); // Scream Tail has 90 HP
    // ONE candidate: forced, no park (`parkOrForce`).
    const forced = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(forced.state.phase.kind).not.toBe("effect:choose");
    expect(bodyAt(forced.state, "p1", 1).damage).toBe(20);
    expect(bodyAt(forced.state, "p1", 0).damage).toBe(120);
    expect(bodyAt(forced.state, "p1", "active").damage).toBe(60);
    // TWO Benched Ancients: a park naming exactly them, and the round trip resolves identically.
    let two = benchFromDeck(ensureCopies(state, "p1", GREAT_TUSK), "p1", GREAT_TUSK);
    two = withBody(two, "p1", 2, (p) => ({ ...p, damage: 50 }));
    const parked = run(two, { type: "attack", seat: "p1", index: 0 }).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toEqual([benchRef("p1", 1), benchRef("p1", 2)]);
    expect(prompt.note).toBe("Heal which of your Benched Ancient Pokémon?");
    const answer = { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: benchRef("p1", 2) } } as GameAction;
    expect(bodyAt(run(roundTrip(parked), answer).state, "p1", 2).damage).toBe(0);
    expect(rejected(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: benchRef("p1", 0) } } as GameAction)).toBe(
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 R-PX4 — Supportive Singing and Perplexing Transfer WHIFF with no Benched Ancient: no park, no heal, no counters", () => {
    let sing = table({ p1: SCREAM_TAIL, p1Bench: [IRON_VALIANT] });
    sing = withBody(energize(sing, "p1", "active", P), "p1", 0, (p) => ({ ...p, damage: 60 }));
    const sung = run(sing, { type: "attack", seat: "p1", index: 0 });
    expect(sung.state.phase.kind).not.toBe("effect:choose");
    expect(all(sung.events, "HEALED")).toEqual([]);
    expect(bodyAt(sung.state, "p1", 0).damage).toBe(60);
    let move = table({ p1: FLUTTER_MANE, p1Bench: [IRON_VALIANT] });
    move = withBody(energize(move, "p1", "active", P, 2), "p1", 0, (p) => ({ ...p, damage: 60 }));
    const moved = run(move, { type: "attack", seat: "p1", index: 0 });
    expect(moved.state.phase.kind).not.toBe("effect:choose");
    expect(bodyAt(moved.state, "p1", 0).damage).toBe(60);
    expect(bodyAt(moved.state, "p2", "active").damage).toBe(0);
  });

  it("🛑 Perplexing Transfer: ALL counters off ONE Benched Ancient onto the opponent's Active", () => {
    let state = table({ p1: FLUTTER_MANE, p1Bench: [IRON_VALIANT, KORAIDON, GREAT_TUSK] });
    state = energize(state, "p1", "active", P, 2);
    state = withBody(state, "p1", 0, (p) => ({ ...p, damage: 90 }));
    state = withBody(state, "p1", 1, (p) => ({ ...p, damage: 70 }));
    state = withBody(state, "p1", 2, (p) => ({ ...p, damage: 30 }));
    const parked = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toEqual([benchRef("p1", 1), benchRef("p1", 2)]);
    expect(prompt.note).toBe("Move the damage counters off which of your Benched Ancient Pokémon?");
    const answer = { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: benchRef("p1", 1) } } as GameAction;
    for (const from of [parked, roundTrip(parked)]) {
      const done = run(from, answer).state;
      expect(bodyAt(done, "p1", 1).damage).toBe(0);
      expect(bodyAt(done, "p1", 0).damage).toBe(90); // the Future body is untouched
      expect(bodyAt(done, "p2", "active").damage).toBe(70);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — Iron Crown ex \"Cobalt Command\": +20 to your FUTURE Pokémon's attacks, except any Iron Crown ex", () => {
  it("the row, exactly as authored, on all six printings", () => {
    for (const id of ["sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158", "svp-146"]) {
      expect(programFor(id), id).toBe(programFor(IRON_CROWN));
    }
    expect(programFor(IRON_CROWN)).toEqual({
      passive: {
        seatDamageBonusBeforeWR: {
          amount: 20,
          beneficiary: { kind: "bannerPokemon", banner: "Future" },
          exceptName: "Iron Crown ex",
        },
      },
    });
  });

  it("🛑 the beneficiary: a Future attacker +20, an Ancient or bannerless attacker 0, and ANY Iron Crown ex 0", () => {
    const state = table({ p1Bench: [IRON_CROWN] });
    expect(seatPreWRDamageBonus(state, "p1", card(MIRAIDON))).toBe(20);
    expect(seatPreWRDamageBonus(state, "p1", card(IRON_THORNS_EX))).toBe(20); // R-PX5 — a Future ex
    expect(seatPreWRDamageBonus(state, "p1", card(KORAIDON))).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", card(FILLER))).toBe(0);
    expect(seatPreWRDamageBonus(state, "p1", card(IRON_CROWN))).toBe(0); // the exclusion, by NAME
    expect(seatPreWRDamageBonus(state, "p1", undefined)).toBe(0);
    // The OTHER seat's attackers get nothing from p1's aura.
    expect(seatPreWRDamageBonus(state, "p2", card(MIRAIDON))).toBe(0);
  });

  it("🛑 R-PX2 — it STACKS across copies (no `noStack` is printed): Peak Acceleration 40 → 60 → 80", () => {
    const peak = (bench: readonly string[], p2?: string) => {
      let state = table({ p1: MIRAIDON, p1Bench: bench, ...(p2 === undefined ? {} : { p2 }) });
      state = energize(state, "p1", "active", W);
      state = { ...state, players: { ...state.players, p1: { ...state.players.p1, deck: [] } } }; // nothing to search: no park
      return dealt(run(state, { type: "attack", seat: "p1", index: 0 }).events);
    };
    expect(peak([])).toBe(40);
    expect(peak([IRON_CROWN])).toBe(60);
    expect(peak([IRON_CROWN, IRON_CROWN])).toBe(80);
    // 🛑 §9: an Active Klefki ("Mischievous Lock") silences every Basic in play — Iron Crown ex is one.
    expect(peak([IRON_CROWN], KLEFKI)).toBe(40);
  });

  it("🛑 Iron Crown ex's own attack is NOT boosted (its Twin Shotels is a two-target snipe besides)", () => {
    const state = table({ p1: IRON_CROWN, p1Bench: [IRON_CROWN] });
    expect(seatPreWRDamageBonus(state, "p1", card(IRON_CROWN))).toBe(0);
    expect(disabledAbilityUids(state).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — Awakening Drum and Reboot Pod", () => {
  it("🛑 Awakening Drum draws one card per YOUR Ancient Pokémon in play (Active + Bench); none draws 0 and is still played (R-PX6 ⚠️ UNRULED)", () => {
    const drum = (opts: { p1?: string; p1Bench?: string[]; p2Bench?: string[] }) => {
      const { events } = play(table(opts), DRUM);
      return all(events, "CARDS_DRAWN").reduce((n, e) => n + e.uids.length, 0);
    };
    expect(drum({ p1: KORAIDON, p1Bench: [GREAT_TUSK, IRON_VALIANT] })).toBe(2);
    expect(drum({ p1Bench: [IRON_VALIANT], p2Bench: [KORAIDON] })).toBe(0);
    expect(programFor(DRUM)?.trainer).toEqual([
      {
        op: "drawCards",
        count: 1,
        per: { kind: "pokemonInPlay", seat: "you", filter: { kind: "bannerPokemon", banner: "Ancient" } },
      },
    ]);
  });

  it("🛑 Reboot Pod: ONE park over every Future body, one card each; a short answer is TOPPED UP (R-PX1)", () => {
    let state = table({ p1: MIRAIDON, p1Bench: [IRON_VALIANT, KORAIDON, IRON_CROWN] });
    // A NON-Energy card first in the pile, then 1 Lightning and 3 Psychic: four Energy for three
    // Future bodies, so ONE Psychic is left over — the top-up must stop at the offered bodies.
    state = discard(discard(discard(state, "p1", FILLER), "p1", L), "p1", P, 3);
    const parked = play(state, POD).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
    expect(prompt.targets).toEqual([{ seat: "p1", spot: { spot: "active" } }, benchRef("p1", 0), benchRef("p1", 2)]);
    expect(prompt.maxPerTarget).toBe(1);
    expect(prompt.max).toBe(3);
    expect(prompt.note).toBe("Attach a Basic Energy card from your discard pile to each of your Future Pokémon.");
    const lightning = prompt.candidates.find((u) => parked.cardIdByUid[u] === L) as string;
    // The player sends ONE assignment; the other two Future bodies are topped up from the pile.
    const answer = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: lightning, to: benchRef("p1", 2) }] },
    } as GameAction;
    for (const from of [parked, roundTrip(parked)]) {
      const { state: done, events } = run(from, answer);
      expect(bodyAt(done, "p1", 2).energy).toEqual([lightning]);
      expect(bodyAt(done, "p1", "active").energy).toHaveLength(1);
      expect(bodyAt(done, "p1", 0).energy).toHaveLength(1);
      expect(bodyAt(done, "p1", 1).energy).toEqual([]); // the Ancient body
      expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
      // Every card the top-up attached is a Basic Energy from the pile — never the filler first in it.
      for (const spot of ["active", 0] as const) {
        expect(bodyAt(done, "p1", spot).energy.map((u) => done.cardIdByUid[u])).toEqual([P]);
      }
      expect(done.players.p1.discard.filter((u) => done.cardIdByUid[u] === P)).toHaveLength(1);
      expect(done.players.p1.discard.some((u) => done.cardIdByUid[u] === FILLER)).toBe(true);
    }
    // An EMPTY answer is not a decline: all three bodies are topped up.
    const declined = run(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments: [] } } as GameAction);
    expect(all(declined.events, "ENERGY_ATTACHED")).toHaveLength(3);
  });

  it("🛑 Reboot Pod with FEWER Energy than Future bodies PARKS: WHICH Future Pokémon get the cards is the player's (R-PX1)", () => {
    // ONE identity in the pile but a SHORT one (1 Psychic, 3 Future bodies): the identity
    // collapse leaves no choice of CARD, but the printed sentence still leaves the choice of
    // BODY, so the inline path is refused and the same `attachCards` prompt parks.
    let state = table({ p1: MIRAIDON, p1Bench: [IRON_VALIANT, IRON_CROWN] });
    state = discard(state, "p1", P);
    const parked = play(state, POD).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
    expect(prompt.targets).toEqual([{ seat: "p1", spot: { spot: "active" } }, benchRef("p1", 0), benchRef("p1", 1)]);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.max).toBe(1);
    expect(prompt.maxPerTarget).toBe(1);
    const [psychic] = prompt.candidates as [string];
    // The player puts it on the LAST Future body — not the Active the target order would pick.
    const answer = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: psychic, to: benchRef("p1", 1) }] },
    } as GameAction;
    for (const from of [parked, roundTrip(parked)]) {
      const { state: done, events } = run(from, answer);
      expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
      expect(bodyAt(done, "p1", 1).energy).toEqual([psychic]);
      expect(bodyAt(done, "p1", "active").energy).toEqual([]);
      expect(bodyAt(done, "p1", 0).energy).toEqual([]);
    }
    // TWO Psychic for three bodies parks too, with a ceiling of 2.
    const two = play(discard(table({ p1: MIRAIDON, p1Bench: [IRON_VALIANT, IRON_CROWN] }), "p1", P, 2), POD).state;
    const twoPrompt = phasePrompt(two);
    if (twoPrompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${twoPrompt.kind}`);
    expect(twoPrompt.max).toBe(2);
    // An EMPTY answer on a short pile is still not a decline (R-PX1): the player forfeits the
    // choice of body, and the top-up gives the one card in target order (the Active).
    const forfeited = run(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments: [] } } as GameAction);
    expect(all(forfeited.events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(bodyAt(forfeited.state, "p1", "active").energy).toEqual([psychic]);
  });

  it("🛑 Reboot Pod over a single-identity pile that COVERS every Future body attaches INLINE (no decision left)", () => {
    // Exactly as many Psychic as Future bodies — the boundary of the guard — and one more.
    for (const count of [3, 4]) {
      let state = table({ p1: MIRAIDON, p1Bench: [IRON_VALIANT, KORAIDON, IRON_CROWN] });
      state = discard(state, "p1", P, count);
      const { state: done, events } = play(state, POD);
      expect(done.phase.kind, String(count)).not.toBe("effect:choose");
      expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
      for (const spot of ["active", 0, 2] as const) {
        expect(bodyAt(done, "p1", spot).energy.map((u) => done.cardIdByUid[u])).toEqual([P]);
      }
      expect(bodyAt(done, "p1", 1).energy).toEqual([]); // the Ancient Koraidon
      expect(done.players.p1.discard.filter((u) => done.cardIdByUid[u] === P)).toHaveLength(count - 3);
    }
  });

  it("🛑 Reboot Pod is REFUSED with no Future Pokémon in play, or no Basic Energy in the discard (Glass Trumpet's precedent)", () => {
    expect(playRejected(discard(table({ p1: KORAIDON }), "p1", P), POD)).toBe("NO_LEGAL_TARGET");
    expect(playRejected(table({ p1: MIRAIDON }), POD)).toBe("NO_LEGAL_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — R-PX5: Iron Thorns ex is FUTURE now, and its own Initialization stays unbuilt (🆕🆕🆕 D571: BUILT — `ironThornsD571.test.ts`)", () => {
  it("🛑 it receives Cobalt Command and Peak Acceleration as a Future body; it has no program (🆕🆕🆕 D571: it HAS one — Initialization)", () => {
    // 🆕🆕🆕 D571 (D539) — INVERTED: `programFor(IRON_THORNS_EX)` was asserted UNDEFINED (R-PX5's
    // "Initialization stays UNBUILT"). D571 built it, so the program is now DEFINED and carries
    // the lock. The `size === 0` line below STILL holds, now for a different reason: both bodies
    // on this board are FUTURE, which Initialization exempts (and Iron Crown ex is the only
    // Rule Box body besides the source).
    expect(programFor(IRON_THORNS_EX)?.passive?.disableAbilities?.exemptBanner).toBe("Future");
    expect(bannerOf(card(IRON_THORNS_EX))).toBe("Future");
    const state = table({ p1: IRON_THORNS_EX, p1Bench: [IRON_CROWN] });
    expect(seatPreWRDamageBonus(state, "p1", card(IRON_THORNS_EX))).toBe(20);
    expect(disabledAbilityUids(state).size).toBe(0); // no lock is built for it (🆕🆕🆕 D571: it is — and both bodies are Future, so it silences neither)
  });

  it("the four registry sentences stay UNREAD by the deriver (index-keyed rows play them)", () => {
    for (const text of [
      "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
      "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the version", () => {
  it("the engine is 0.530.0", () => {
    expect(engineVersion).toBe("0.530.0");
    expect(manifest.version).toBe("0.530.0");
  });
});
