import type { Card } from "@luminous/schema";

// 🆕🆕🆕 D576 — THE ANTIQUE FOSSILS' POKÉMON FACE, HAND-WRITTEN, keyed by printing id.
//
// Four Standard-legal Item printings on three texts print *"Play this card as if it were a
// 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't
// retreat. At any time during your turn, you may discard this card from play."* plus ONE
// printed Ability each:
//
//   sv07-129, sv10.5b-080  Antique Cover Fossil  "Protective Cover"
//   sv07-130               Antique Root Fossil   "Primal Root"
//   sv10.5w-079            Antique Plume Fossil  "Plume Protection"
//
// 🛑 THE FACE IS WRITTEN HERE BECAUSE THE INGEST DROPS IT. tcgdex carries `hp: 60` and an
// `abilities` array on all four rows (the audit card JSON, 2026-09-25), but
// `apps/api/src/ingest/map.ts` builds every row from a base that nulls `hp` and
// `abilitiesJson`, and its Trainer branch refills only `trainerType` and `effect`. So the
// catalog `Card` the engine is handed for these ids is a plain Item with `hp: null` and
// `abilities: null`, and no engine read could find the 60 or the Ability. The banner table
// (`banners.ts`) is the precedent: a fixed fact about a PRINTING, written by an engine table
// keyed by id, never fetched at runtime.
//
// ⚠️ NAMED USER FOLLOW-UP (decisions.md D576): widen map.ts's Trainer branch to keep `hp` and
// `abilities`, re-ingest the remote D1, regenerate the catalog manifest and the fixtures —
// after which this table could be checked against the catalog instead of standing in for it.
//
// ⚠️ THE TABLE IS DATA, NOT LOGIC. No schema, D1, ingest, wire or `Card` change. It sits
// OUTSIDE the mutation whitelist (D538): a mutant must never name this file — the texts are
// pinned LITERALLY by `antiqueFossilsD576.test.ts`, copied verbatim from the card JSON.
//
// The face applies ONLY WHILE THE CARD IS IN PLAY (R-FO2): `cardOfUid` (cards.ts) returns the
// synthesized Pokémon card for a fossil uid that sits in an in-play stack, and the catalog
// Item everywhere else (hand, deck, discard, prizes) — so a fossil is played as an Item, is
// never a setup Basic, and no deck or hand Pokémon search can find it.

/** The hit points the printed rule names ("as if it were a 60-HP Basic {C} Pokémon"). */
export const FOSSIL_HP = 60;

/** One fossil's printed Ability, verbatim. */
interface FossilAbility {
  name: string;
  effect: string;
}

const PROTECTIVE_COVER: FossilAbility = {
  name: "Protective Cover",
  effect:
    "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
};

const PRIMAL_ROOT: FossilAbility = {
  name: "Primal Root",
  effect:
    "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Basic Pokémon cost {C} more.",
};

const PLUME_PROTECTION: FossilAbility = {
  name: "Plume Protection",
  effect:
    "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks from your opponent's Pokémon.",
};

/** Printing id → the Ability its Pokémon face prints. Four rows, three texts. */
const FOSSIL_ABILITIES: Readonly<Record<string, FossilAbility>> = {
  "sv07-129": PROTECTIVE_COVER, // Antique Cover Fossil (Stellar Crown)
  "sv10.5b-080": PROTECTIVE_COVER, // Antique Cover Fossil (Black Bolt)
  "sv07-130": PRIMAL_ROOT, // Antique Root Fossil (Stellar Crown)
  "sv10.5w-079": PLUME_PROTECTION, // Antique Plume Fossil (White Flare)
};

/** Every fossil printing id — `cardOfUid`'s hot-path test reads this FIRST, so a non-fossil
    lookup pays one `Set.has` and nothing else. */
export const FOSSIL_IDS: ReadonlySet<string> = new Set(Object.keys(FOSSIL_ABILITIES));

/** The printed Ability of fossil printing `id`, or undefined for any other id. */
export function fossilAbilityOf(id: string): FossilAbility | undefined {
  return FOSSIL_ABILITIES[id];
}

// Memoized per id, and re-synthesized only if a DIFFERENT catalog object arrives for the same
// id (a suite's local pool) — so the in-play face of one pool never leaks into another's.
const synthesized = new Map<string, { source: Card; face: Card }>();

/** The in-play Pokémon face of fossil `card` (R-FO2): a Basic {C} Pokémon with 60 HP, its
    printed Ability, no attacks, no Weakness, no Resistance and no Retreat Cost. The name, id,
    image and the rest of the printed row are the card's own. `card` itself for any non-fossil
    id. */
export function fossilPokemonCard(card: Card): Card {
  const ability = FOSSIL_ABILITIES[card.id];
  if (ability === undefined) return card;
  const cached = synthesized.get(card.id);
  if (cached !== undefined && cached.source === card) return cached.face;
  const face: Card = {
    ...card,
    category: "Pokemon",
    stage: "Basic",
    hp: FOSSIL_HP,
    types: ["Colorless"],
    retreat: 0,
    abilities: [{ type: "Ability", name: ability.name, effect: ability.effect }],
    attacks: [],
    weaknesses: [],
    resistances: [],
    trainerType: null,
  };
  synthesized.set(card.id, { source: card, face });
  return face;
}
