import type { Card } from "@luminous/schema";

// 🆕🆕🆕 D568 — THE BANNER DATUM: which printings carry the TERA banner.
//
// A Tera Pokémon prints the word "Tera" under its name and, beside it, the rule
// "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon
// by attacks (both yours and your opponent's)." TWENTY-FOUR Standard-legal printings
// name the class ("your Tera Pokémon", "a Tera Pokémon") — measured over the legal card
// JSON, every text surface: 13 Trainers (Briar ×4, Area Zero Underdepths ×3, Glass
// Trumpet ×2, Sparkling Crystal ×2, Tera Orb, and Technical Machine: Fluorite `sv08-188`,
// whose Tera sentence is on the ATTACK the TM grants), 7 Abilities (Milotic ex ×3,
// Noctowl ×3, Azumarill) and 4 Pokémon attacks (Ho-Oh `sv08-019`, Terapagos `sv08-161`,
// Regigigas `sv08.5-086`, Team Rocket's Mimikyu `sv10-087`). D568 builds 19; the 5 left
// are Underdepths ×3 (Bench size), Mimikyu (copy-attack) and TM Fluorite (a Tool that
// grants an attack — no Technical Machine attack is built). Before this table the
// engine could not read one of them: NO INGESTED COLUMN CLASSIFIES
// THE BANNER (still true, and not changed here — `cardSchema` carries no subtype
// list, and D1 has no column for it). The fix is not an ingest change: the banner is
// a fixed fact about a PRINTING, so an engine table keyed by printing id is its
// writer, exactly as the registry is the writer of every program (`programFor`).
// Keyed by ID and never by species or name (D135): Pikachu ex `sv08-057` is Tera and
// Pikachu ex `sv08.5-028` is not.
//
// ⚠️ THE TABLE IS DATA, NOT LOGIC. No schema, D1, ingest, wire or `Card` change; it
// is never fetched at runtime. It sits OUTSIDE the mutation whitelist (D538) — a
// mutant that deletes a row is a data edit, pinned by `teraBannerD568.test.ts`'s
// census rungs rather than by the corpus.
//
// HOW THE 98 WERE MEASURED (2026-09-30), TWO SOURCES PLUS THE PRINTED FACE:
//   1. pokemon-tcg-data's `subtypes` ("Tera") over the eleven Standard sets, joined to
//      the tcgdex ids the catalog uses and filtered to `legal.standard` — 94 ids.
//   2. limitlesstcg.com's card page ("Tera" in the type line) over EVERY Standard-legal
//      Pokémon ex in the pool — all 353, not only the 94 — which agreed everywhere but:
//        • `sv08.5-028` Pikachu ex (190 HP, Tail Whap / Thunder) — source 1 says Tera,
//          limitless says not. REMOVED: the tcgdex card image
//          (assets.tcgdex.net/en/sv/sv08.5/028) prints no Tera banner.
//        • `sv08.5-092` Terapagos ex (230 HP, Unified Beatdown / Crown Opal) — source 1
//          says not, limitless says Tera. ADDED: the image prints the banner and the
//          Tera rule, and its six same-text reprints are all Tera (the REPRINT
//          CONSISTENCY rung in the suite catches exactly this row).
//        • `svp-166`, `svp-174`, `svp-175`, `svp-176` — absent from source 1's promo
//          set (it stops at `svp-165`); limitless shows Tera. ADDED (the images of
//          `-166` and `-174` print the banner; `-175`/`-176` have no tcgdex image and
//          are the same texts as the Tera Espeon ex / Umbreon ex of `sv08.5`).
//        • `svp-215` Toxtricity ex — limitless has no page; the image prints no banner.
//      `svp-177` … `svp-218` otherwise checked: none is Tera.
//   So 94 − 1 + 1 + 4 = 98. Ancient and Future printings are NOT here (Slice 2 widens
//   `Banner`; its table is single-source so far and owes the same close).

/** A printed banner class. One member today; Slice 2 (Paradox) widens it with
    "Ancient" and "Future". */
export type Banner = "Tera";

/** Printing id → banner. A literal, keyed by the catalog's tcgdex id. Every id is a
    Standard-legal Pokémon ex (pinned by `teraBannerD568.test.ts`). */
export const BANNER_BY_ID: Readonly<Record<string, Banner>> = {
  "sv05-060": "Tera", // Wugtrio ex
  "sv05-108": "Tera", // Farigiraf ex
  "sv05-190": "Tera", // Wugtrio ex
  "sv05-194": "Tera", // Farigiraf ex
  "sv06-025": "Tera", // Teal Mask Ogerpon ex
  "sv06-029": "Tera", // Magcargo ex
  "sv06-040": "Tera", // Hearthflame Mask Ogerpon ex
  "sv06-064": "Tera", // Wellspring Mask Ogerpon ex
  "sv06-106": "Tera", // Greninja ex
  "sv06-112": "Tera", // Cornerstone Mask Ogerpon ex
  "sv06-130": "Tera", // Dragapult ex
  "sv06-190": "Tera", // Teal Mask Ogerpon ex
  "sv06-191": "Tera", // Magcargo ex
  "sv06-192": "Tera", // Hearthflame Mask Ogerpon ex
  "sv06-194": "Tera", // Wellspring Mask Ogerpon ex
  "sv06-198": "Tera", // Greninja ex
  "sv06-199": "Tera", // Cornerstone Mask Ogerpon ex
  "sv06-200": "Tera", // Dragapult ex
  "sv06-211": "Tera", // Teal Mask Ogerpon ex
  "sv06-212": "Tera", // Hearthflame Mask Ogerpon ex
  "sv06-213": "Tera", // Wellspring Mask Ogerpon ex
  "sv06-214": "Tera", // Greninja ex
  "sv06-215": "Tera", // Cornerstone Mask Ogerpon ex
  "sv06-221": "Tera", // Teal Mask Ogerpon ex
  "sv06.5-015": "Tera", // Revavroom ex
  "sv06.5-081": "Tera", // Revavroom ex
  "sv07-028": "Tera", // Cinderace ex
  "sv07-032": "Tera", // Lapras ex
  "sv07-051": "Tera", // Galvantula ex
  "sv07-128": "Tera", // Terapagos ex
  "sv07-157": "Tera", // Cinderace ex
  "sv07-158": "Tera", // Lapras ex
  "sv07-159": "Tera", // Galvantula ex
  "sv07-168": "Tera", // Galvantula ex
  "sv07-170": "Tera", // Terapagos ex
  "sv07-173": "Tera", // Terapagos ex
  "sv08-036": "Tera", // Ceruledge ex
  "sv08-057": "Tera", // Pikachu ex
  "sv08-086": "Tera", // Sylveon ex
  "sv08-091": "Tera", // Palossand ex
  "sv08-106": "Tera", // Flygon ex
  "sv08-119": "Tera", // Hydreigon ex
  "sv08-133": "Tera", // Alolan Exeggutor ex
  "sv08-142": "Tera", // Tatsugiri ex
  "sv08-159": "Tera", // Cyclizar ex
  "sv08-219": "Tera", // Pikachu ex
  "sv08-221": "Tera", // Palossand ex
  "sv08-222": "Tera", // Flygon ex
  "sv08-223": "Tera", // Hydreigon ex
  "sv08-225": "Tera", // Alolan Exeggutor ex
  "sv08-226": "Tera", // Tatsugiri ex
  "sv08-228": "Tera", // Cyclizar ex
  "sv08-238": "Tera", // Pikachu ex
  "sv08-240": "Tera", // Hydreigon ex
  "sv08-242": "Tera", // Alolan Exeggutor ex
  "sv08-247": "Tera", // Pikachu ex
  "sv08-248": "Tera", // Alolan Exeggutor ex
  "sv08.5-006": "Tera", // Leafeon ex
  "sv08.5-012": "Tera", // Teal Mask Ogerpon ex
  "sv08.5-014": "Tera", // Flareon ex
  "sv08.5-017": "Tera", // Hearthflame Mask Ogerpon ex
  "sv08.5-023": "Tera", // Vaporeon ex
  "sv08.5-026": "Tera", // Glaceon ex
  "sv08.5-027": "Tera", // Wellspring Mask Ogerpon ex
  "sv08.5-030": "Tera", // Jolteon ex
  "sv08.5-034": "Tera", // Espeon ex
  "sv08.5-041": "Tera", // Sylveon ex
  "sv08.5-058": "Tera", // Cornerstone Mask Ogerpon ex
  "sv08.5-060": "Tera", // Umbreon ex
  "sv08.5-073": "Tera", // Dragapult ex
  "sv08.5-075": "Tera", // Eevee ex
  "sv08.5-092": "Tera", // Terapagos ex
  "sv08.5-144": "Tera", // Leafeon ex
  "sv08.5-145": "Tera", // Teal Mask Ogerpon ex
  "sv08.5-146": "Tera", // Flareon ex
  "sv08.5-147": "Tera", // Ceruledge ex
  "sv08.5-148": "Tera", // Hearthflame Mask Ogerpon ex
  "sv08.5-149": "Tera", // Vaporeon ex
  "sv08.5-150": "Tera", // Glaceon ex
  "sv08.5-152": "Tera", // Wellspring Mask Ogerpon ex
  "sv08.5-153": "Tera", // Jolteon ex
  "sv08.5-155": "Tera", // Espeon ex
  "sv08.5-156": "Tera", // Sylveon ex
  "sv08.5-160": "Tera", // Cornerstone Mask Ogerpon ex
  "sv08.5-161": "Tera", // Umbreon ex
  "sv08.5-165": "Tera", // Dragapult ex
  "sv08.5-167": "Tera", // Eevee ex
  "sv08.5-169": "Tera", // Terapagos ex
  "sv08.5-177": "Tera", // Teal Mask Ogerpon ex
  "sv08.5-179": "Tera", // Pikachu ex
  "sv08.5-180": "Tera", // Terapagos ex
  "svp-163": "Tera", // Cinderace ex
  "svp-164": "Tera", // Lapras ex
  "svp-165": "Tera", // Terapagos ex
  "svp-166": "Tera", // Teal Mask Ogerpon ex
  "svp-174": "Tera", // Eevee ex
  "svp-175": "Tera", // Espeon ex
  "svp-176": "Tera", // Umbreon ex
};

/** The banner `card` prints, or `undefined` — read by printing ID (D135), so a `fix-*`
    test card or an unknown id is bannerless. `undefined` in, `undefined` out. */
export function bannerOf(card: Card | undefined): Banner | undefined {
  return card === undefined ? undefined : BANNER_BY_ID[card.id];
}
