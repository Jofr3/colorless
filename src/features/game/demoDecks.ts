// Built-in decks for /play — always available, no account needed. Every id
// is a real catalog id verified against the live api (2026-07-16; the M3
// status attackers re-verified against local + remote D1 2026-07-17) and
// every card has a scan (`image` non-null), so the board renders real art.
// Design constraints (engine M2): mostly Basic Pokémon so setup rarely
// mulligans, only basic energy, every printed attack payable from the deck's
// own energy (the engine matches Colorless to anything), and the two decks
// run different types — the Fire side is weak to Water, so the tide deck's
// attacks show the ×2 weakness math. M3 makes special conditions reachable
// in a real game: Numel Burns, Luvdisc puts to sleep, and Slowpoke's Rest
// (self-Asleep + heal 30) now actually resolves. M4 makes evolution reachable:
// each deck carries a real line off a Basic it already runs — Ember's
// Fuecoco→Crocalor→Skeledirge (a full Stage 2 chain) and Tidal's
// Buizel→Floatzel — so a hot-seat game can evolve on turn 3+.

import type { DeckCard } from "@luminous/schema";

export interface DemoDeck {
  name: string;
  ids: string[];
}

/** Expand `{cardId, count}` rows (the persisted Deck shape) into the flat id
    list createGame expects. Shared by the demo decks and saved-deck loading. */
export function expandDeck(cards: readonly DeckCard[]): string[] {
  const ids: string[] = [];
  for (const { cardId, count } of cards) {
    for (let i = 0; i < count; i++) ids.push(cardId);
  }
  return ids;
}

/** 24 Basic Fire Pokémon (sv01 + sv03) + the Fuecoco→Crocalor→Skeledirge
    evolution line (M4) + 31 Basic Fire Energy (sv03-230). */
const EMBER_STARTERS: DemoDeck = {
  name: "Ember Starters",
  ids: expandDeck([
    { cardId: "sv01-036", count: 4 }, // Fuecoco — Gnaw [C] 10 · Combustion [FFC] 50
    { cardId: "sv01-033", count: 4 }, // Houndour — Bite [C] 10 · Flare [FC] 30
    { cardId: "sv01-039", count: 4 }, // Charcadet — Ember [F] 30 (effect flagged)
    { cardId: "sv01-035", count: 4 }, // Torkoal — Stampede [CC] 30 · Concentrated Fire [FCC] 80×
    { cardId: "sv01-030", count: 4 }, // Growlithe 70 HP — Relentless Flames [F] 30×
    { cardId: "sv01-031", count: 1 }, // Growlithe 90 HP
    { cardId: "sv03-031", count: 3 }, // Numel 90 HP — Hot Magma [FC] 20: defender Burned (M3)
    { cardId: "sv01-037", count: 3 }, // Crocalor — Stage 1, evolves from Fuecoco (M4)
    { cardId: "sv01-038", count: 2 }, // Skeledirge — Stage 2, evolves from Crocalor (M4)
    { cardId: "sv03-230", count: 31 }, // Basic Fire Energy
  ]),
};

/** 24 Basic Water Pokémon (sv01 + sv02) + the Buizel→Floatzel evolution line
    (M4) + 33 Basic Water Energy (sv02-279). */
const TIDAL_SPLASH: DemoDeck = {
  name: "Tidal Splash",
  ids: expandDeck([
    { cardId: "sv01-052", count: 4 }, // Quaxly — Pound [C] 10 · Kick [WC] 20
    { cardId: "sv01-046", count: 4 }, // Buizel — Rain Splash [W] 10 · Razor Fin [CC] 20
    { cardId: "sv01-042", count: 4 }, // Slowpoke — Rest [C] self-Asleep + heal 30 (M3) · Headbutt [WC] 20
    { cardId: "sv01-048", count: 4 }, // Alomomola — Surf [WC] 30 · Aqua Slash [WWC] 120
    { cardId: "sv01-058", count: 1 }, // Cetoddle — Tackle [CC] 30
    { cardId: "sv02-047", count: 3 }, // Luvdisc 70 HP — Water Pulse [W] 20: defender Asleep (M3); Matching flagged
    { cardId: "sv01-051", count: 2 }, // Bruxish — Wave Splash [WC] 60
    { cardId: "sv01-061", count: 2 }, // Dondozo — Heavy Splash [WWCC] 120
    { cardId: "sv01-047", count: 3 }, // Floatzel — Stage 1, evolves from Buizel (M4)
    { cardId: "sv02-279", count: 33 }, // Basic Water Energy
  ]),
};

export const DEMO_DECKS: readonly DemoDeck[] = [EMBER_STARTERS, TIDAL_SPLASH];
