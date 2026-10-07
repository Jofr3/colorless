import type { Card } from "@luminous/schema";

// 🆕🆕🆕 D576 — THE ANTIQUE FOSSILS' POKÉMON FACE, keyed by printing id.
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
// 🆕 D581 — THE ABILITY IS READ OFF THE CATALOG ROW, NOT HAND-WRITTEN. Until D581
// `apps/api/src/ingest/map.ts` built every Trainer row from a base that nulled `hp` and
// `abilitiesJson`, so the catalog `Card` for these ids had neither and this file carried the
// Ability's name and text by hand (D576). D581 widened the Trainer branch: a fossil's row now
// carries tcgdex's `hp: 60` and its printed `abilities`, and the face below takes the Ability
// from the `Card` it is handed — the same read the engine makes for every Pokémon's Ability.
// The table this file used to hold is gone; `antiqueFossilsD576.test.ts` builds its fossil rows
// from `CATALOG_MANIFEST.trainerFaces` (the local D1, measured) so a row that drifts from the
// print fails there.
//
// ⚠️ DEPLOY ORDER (D581) — THREE WINDOWS, SO RE-INGEST AND DEPLOY BACK TO BACK, RE-INGEST FIRST:
// (1) THIS engine on a catalog not re-ingested since D581 is handed a fossil row with
// `abilities: null`, and the face then has NO Ability (its passive, which `registry.ts` keys by
// id, still applies); TM Fluorite grants nothing. (2) the 0.464 engine on a re-ingested catalog
// has no category guard in `hasPrintedAbility` / `attacksOf` / `hpOf`, so a fossil Item in the
// hand or the deck matches `abilityPokemon` and TM Fluorite matches `attackNamePokemon` (no
// harmful reach found in review), and the 0.464 API's `/cards` HP filter and sort admit the 12
// HP-printing Trainers. (2) is the benign window. (3) the API's KV catalog cache (1-hour TTL)
// serves `/cards/:id` — the match pool's fetch — so a row cached before the re-ingest keeps (1)
// open after it whatever the order, and 0.464's cached `?hpMin` / `hp-desc` bodies keep the
// Trainers; D581 bumps `CACHE_VERSION` to v7 (apps/api catalog/cache.ts) so 0.465 starts cold,
// which closes (3) only if the remote re-ingest has FINISHED before the deploy.
// [🆕🆕🆕 D582 (D539): *"the match pool"* is WITHDRAWN for the ONLINE match — its Durable Object reads the pool
// from D1 directly (lobby/cardPool.ts `loadCardPool`) and never touches the KV cache; only the LOCAL match
// fetches through `/cards/:id`. And the pool is PERSISTED in every match (`GameState.cardPool`), so a match
// created before the re-ingest keeps the old rows for its whole life whatever the cache holds — a FOURTH
// window, named in apps/api lobby/match.ts "STAYS 41 AT D582".]
//
// What stays here is RULE text, not printed face: WHICH printings are Antique Fossils (the
// banner-table precedent, `banners.ts` — a fixed fact about a printing, keyed by id), and the
// rule's "60-HP Basic {C}" — the number the effect sentence prints, equal to the row's `hp`
// (pinned in the suite). It sits OUTSIDE the mutation whitelist (D538): a mutant must never
// name this file.
//
// The face applies ONLY WHILE THE CARD IS IN PLAY (R-FO2): `cardOfUid` (cards.ts) returns the
// synthesized Pokémon card for a fossil uid that sits in an in-play stack, and the catalog
// Item everywhere else (hand, deck, discard, prizes) — so a fossil is played as an Item, is
// never a setup Basic, and no deck or hand Pokémon search can find it (D581: `hasPrintedAbility`
// and `attacksOf` ask the category, so the Item's catalog Ability is not a Pokémon's either).

/** The hit points the printed rule names ("as if it were a 60-HP Basic {C} Pokémon"). */
export const FOSSIL_HP = 60;

/** Every Antique Fossil printing the engine builds — `cardOfUid`'s hot-path test reads this
    FIRST, so a non-fossil lookup pays one `Set.has` and nothing else. Four rows, three texts.
    (me03-068 / me03-069 / me05-072 / me05-073, the Mega Evolution serie's four fossils, are
    ingested at D581 and NOT built: each prints a fourth-to-seventh Ability text.) */
export const FOSSIL_IDS: ReadonlySet<string> = new Set([
  "sv07-129", // Antique Cover Fossil (Stellar Crown)
  "sv10.5b-080", // Antique Cover Fossil (Black Bolt)
  "sv07-130", // Antique Root Fossil (Stellar Crown)
  "sv10.5w-079", // Antique Plume Fossil (White Flare)
]);

// Memoized per id, and re-synthesized only if a DIFFERENT catalog object arrives for the same
// id (a suite's local pool) — so the in-play face of one pool never leaks into another's.
const synthesized = new Map<string, { source: Card; face: Card }>();

/** The in-play Pokémon face of fossil `card` (R-FO2): a Basic {C} Pokémon with 60 HP, its
    printed Ability AS THE CATALOG ROW CARRIES IT (D581), no attacks, no Weakness, no
    Resistance and no Retreat Cost. The name, id, image and the rest of the printed row are the
    card's own. `card` itself for any non-fossil id. */
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
