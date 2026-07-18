// Built-in decks for /play — always available, no account needed. Every id
// is a real catalog id verified against the live api (2026-07-16; the M3
// status attackers re-verified against local + remote D1 2026-07-17; the M4
// slice-2 Trainers/Abilities verified against local D1 2026-07-17) and every
// card has a scan (`image` non-null), so the board renders real art.
// Design constraints (engine M2): mostly Basic Pokémon so setup rarely
// mulligans, only basic energy, every printed attack payable from the deck's
// own energy (the engine matches Colorless to anything), and the two decks
// run different types — the Fire side is weak to Water, so the tide deck's
// attacks show the ×2 weakness math. M3 makes special conditions reachable
// in a real game: Numel Burns, Luvdisc puts to sleep, and Slowpoke's Rest
// (self-Asleep + heal 30) resolves. M4 makes evolution reachable (each deck
// carries a real line off a Basic it runs) and — slice 2 — Trainers and
// Abilities: both decks share the SHARED_TRAINERS suite (draw / search / gust
// / switch / heal), the Tidal deck runs Chien-Pao ex (activated Ability
// "Shivery Chill"), and the Ember deck runs Bouffalant (passive "Bouffer").
// Slice 3 adds the persistent zones, DIFFERENT per deck so the §7.3 replace
// path is reachable live: Ember runs Beach Court (Stadium) + Vitality Band
// (Tool), Tidal runs Pokémon League Headquarters (Stadium) + Bravery Charm
// (Tool). Slice 5 adds Special Energy, DIFFERENT per deck (type-neutral, so the
// disjoint-energy rule keeps them split): Ember runs Jet Energy (switch-on-
// bench-attach), Tidal runs Luminous Energy (a wildcard that pays any 1 type).
// Slice 7 adds Rare Candy to Ember (it already runs the Fuecoco → Crocalor →
// Skeledirge line): the Basic→Stage 2 evolve-skip is reachable off Fuecoco.

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

/** Trainers BOTH demo decks run. Trainers are type-neutral — real decks of any
    archetype share the same staples — so unlike the type-specific Pokémon and
    energy, these ids overlap between the two lists (demoDecks.test asserts the
    overlap is EXACTLY this set). M4 slice 2 makes each one playable at /play. */
const SHARED_TRAINERS: readonly DeckCard[] = [
  { cardId: "sv01-189", count: 2 }, // Professor's Research (Supporter) — discard hand, draw 7
  { cardId: "sv01-181", count: 2 }, // Nest Ball (Item) — search a Basic → Bench
  { cardId: "sv02-172", count: 2 }, // Boss's Orders (Supporter) — gust the opponent's Active
  { cardId: "sv01-194", count: 2 }, // Switch (Item) — swap your Active with a Benched Pokémon
  { cardId: "sv01-188", count: 2 }, // Potion (Item) — heal 30 from one of your Pokémon
  { cardId: "sv01-172", count: 1 }, // Energy Search (Item) — search a Basic Energy → hand
];

/** The ids in SHARED_TRAINERS — the exact set the two decks are allowed to
    share (the type-identity that must NOT overlap is Pokémon + energy). */
export const SHARED_TRAINER_IDS: readonly string[] = SHARED_TRAINERS.map((c) => c.cardId);

/** Fire Pokémon (sv01 + sv03) incl. the Fuecoco→Crocalor→Skeledirge line
    (M4) and Bouffalant (passive "Bouffer"), the shared Trainers, Rare Candy ×2
    (slice 7 — the Fuecoco→Skeledirge skip), Beach Court + Vitality Band
    (slice 3), Jet Energy ×3 (slice 5), and 12 Basic Fire Energy (sv03-230). */
const EMBER_STARTERS: DemoDeck = {
  name: "Ember Starters",
  ids: expandDeck([
    { cardId: "sv01-036", count: 4 }, // Fuecoco — Gnaw [C] 10 · Combustion [FFC] 50
    { cardId: "sv01-033", count: 4 }, // Houndour — Bite [C] 10 · Flare [FC] 30
    { cardId: "sv01-039", count: 3 }, // Charcadet — Ember [F] 30 (effect flagged)
    { cardId: "sv01-035", count: 3 }, // Torkoal — Stampede [CC] 30 · Concentrated Fire [FCC] 80×
    { cardId: "sv01-030", count: 4 }, // Growlithe 70 HP — Relentless Flames [F] 30×
    { cardId: "sv03-031", count: 3 }, // Numel 90 HP — Hot Magma [FC] 20: defender Burned (M3)
    { cardId: "sv01-037", count: 3 }, // Crocalor — Stage 1, evolves from Fuecoco (M4)
    { cardId: "sv01-038", count: 2 }, // Skeledirge — Stage 2, evolves from Crocalor (M4)
    { cardId: "sv03-174", count: 2 }, // Bouffalant — passive "Bouffer": −20 damage after W/R (M4)
    ...SHARED_TRAINERS,
    { cardId: "sv01-191", count: 2 }, // Rare Candy — Item: Fuecoco → Skeledirge, skip Crocalor (slice 7)
    { cardId: "sv01-167", count: 2 }, // Beach Court — Stadium: Basic retreat −1 (slice 3)
    { cardId: "sv01-197", count: 2 }, // Vitality Band — Tool: +10 damage before W/R (slice 3)
    { cardId: "sv02-190", count: 3 }, // Jet Energy — Special: {C} + switch on bench attach (slice 5)
    { cardId: "sv03-230", count: 12 }, // Basic Fire Energy
  ]),
};

/** Water Pokémon (sv01 + sv02) incl. the Buizel→Floatzel line (M4) and
    Chien-Pao ex (activated Ability "Shivery Chill"), the shared Trainers,
    Pokémon League Headquarters + Bravery Charm (slice 3), Luminous Energy ×3
    (slice 5), and 17 Basic Water Energy (sv02-279). */
const TIDAL_SPLASH: DemoDeck = {
  name: "Tidal Splash",
  ids: expandDeck([
    { cardId: "sv01-052", count: 4 }, // Quaxly — Pound [C] 10 · Kick [WC] 20
    { cardId: "sv01-046", count: 4 }, // Buizel — Rain Splash [W] 10 · Razor Fin [CC] 20
    { cardId: "sv01-042", count: 4 }, // Slowpoke — Rest [C] self-Asleep + heal 30 (M3) · Headbutt [WC] 20
    { cardId: "sv01-048", count: 3 }, // Alomomola — Surf [WC] 30 · Aqua Slash [WWC] 120
    { cardId: "sv02-047", count: 3 }, // Luvdisc 70 HP — Water Pulse [W] 20: defender Asleep (M3)
    { cardId: "sv01-051", count: 2 }, // Bruxish — Wave Splash [WC] 60
    { cardId: "sv01-047", count: 3 }, // Floatzel — Stage 1, evolves from Buizel (M4)
    { cardId: "sv02-061", count: 2 }, // Chien-Pao ex — Ability "Shivery Chill": search 2 Water Energy (M4)
    ...SHARED_TRAINERS,
    { cardId: "sv03-192", count: 2 }, // Pokémon League Headquarters — Stadium: Basic attacks +{C} (slice 3)
    { cardId: "sv02-173", count: 2 }, // Bravery Charm — Tool: Basic holder +50 HP (slice 3)
    { cardId: "sv02-191", count: 3 }, // Luminous Energy — Special: wildcard, any 1 type (slice 5)
    { cardId: "sv02-279", count: 17 }, // Basic Water Energy
  ]),
};

export const DEMO_DECKS: readonly DemoDeck[] = [EMBER_STARTERS, TIDAL_SPLASH];
