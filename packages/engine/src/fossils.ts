import type { Card } from "@colorless/schema";

// Antique Fossils' in-play Pokémon face, keyed by printing id. They print "Play this card as if it
// were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't
// retreat. At any time during your turn, you may discard this card from play." plus one Ability,
// which is read from the catalog row. The face applies only while the card is in play: `cardOfUid`
// returns the synthesized Pokémon for an in-play fossil and the catalog Item everywhere else.

/** The hit points the printed rule names ("as if it were a 60-HP Basic {C} Pokémon"). */
export const FOSSIL_HP = 60;

/**
 * Every Antique Fossil printing; `cardOfUid` checks this first so a non-fossil lookup costs one
 * `Set.has`.
 */
export const FOSSIL_IDS: ReadonlySet<string> = new Set([
  "sv07-129", // Antique Cover Fossil (Stellar Crown)
  "sv10.5b-080", // Antique Cover Fossil (Black Bolt)
  "sv07-130", // Antique Root Fossil (Stellar Crown)
  "sv10.5w-079", // Antique Plume Fossil (White Flare)
  "me03-068", // Antique Jaw Fossil
  "me03-069", // Antique Sail Fossil
  "me05-072", // Antique Armor Fossil
  "me05-073", // Antique Skull Fossil
]);

// Memoized per id, and re-synthesized only if a DIFFERENT catalog object arrives for the same
// id (a suite's local pool) — so the in-play face of one pool never leaks into another's.
const synthesized = new Map<string, { source: Card; face: Card }>();

/**
 * The in-play face of fossil `card`: a 60-HP Basic {C} Pokémon with its catalog Ability and no
 * attacks, Weakness, Resistance or Retreat Cost. Returns `card` itself for any non-fossil id.
 */
export function fossilPokemonCard(card: Card): Card {
  if (!FOSSIL_IDS.has(card.id)) return card;
  const cached = synthesized.get(card.id);
  if (cached !== undefined && cached.source === card) return cached.face;
  const face: Card = {
    ...card,
    category: "Pokemon",
    stage: "Basic",
    hp: FOSSIL_HP,
    types: ["Colorless"],
    retreat: 0,
    abilities: card.abilities ?? [],
    attacks: [],
    weaknesses: [],
    resistances: [],
    trainerType: null,
  };
  synthesized.set(card.id, { source: card, face });
  return face;
}
