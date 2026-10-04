import type { Card } from "@luminous/schema";

// 🆕🆕🆕 D568 — THE BANNER DATUM: which printings carry the TERA banner.
// (🆕🆕🆕 D569: and the two PARADOX banners, ANCIENT and FUTURE — the D569 block below.)
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
// grants an attack — no Technical Machine attack is built). (🆕🆕🆕 D573 (D539): Mimikyu is
// WITHDRAWN from that list — Gemstone Mimicry is BUILT, the copy-attack substitution reading
// `isTeraPokemon` off this table; 4 are left. 🆕🆕🆕 D577 (D539): *"4 are left"* is WITHDRAWN —
// Area Zero Underdepths ×3 is BUILT, `benchLimitOf` reading `isTeraPokemon` off this table; ONE is
// left, TM Fluorite.) Before this table the
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
//   So 94 − 1 + 1 + 4 = 98. ~~Ancient and Future printings are NOT here (Slice 2 widens
//   `Banner`; its table is single-source so far and owes the same close).~~
//   (🆕🆕🆕 D569 (D539): WITHDRAWN — Slice 2 part a (D569) widened `Banner` and added the 86
//   Ancient/Future ids below, closed on TWO sources plus the printed face; see the next block.)
//
// 🆕🆕🆕 D569 — THE PARADOX BANNERS: "Ancient" (44 ids) and "Future" (42 ids), 86 in all —
// Ancient Pokémon 40 + Ancient Trainers 4 (Awakening Drum `sv05-141`, Explorer's Guidance
// `sv05-147`/`-200`/`sv08.5-107`), Future Pokémon 38 + Future Trainers 4 (Reboot Pod
// `sv05-158`, Ciphermaniac's Codebreaking `sv05-145`/`-198`/`sv08.5-104`). UNLIKE TERA, A
// PARADOX BANNER IS PRINTED ON TRAINERS TOO ("an Ancient card" counts them — `bannerCard`),
// and on non-ex Pokémon. HOW THE 86 WERE MEASURED (2026-10-02), TWO SOURCES PLUS THE FACE:
//   1. pokemon-tcg-data's `subtypes` ("Ancient" / "Future") over the eleven Standard sets —
//      107 tagged printings — joined to the tcgdex ids and filtered to `legal.standard`: 86.
//   2. (limitlesstcg does not print the Paradox tag, so the D568 second source is not
//      available.) A NAME cross-check over EVERY legal printing in the pool: every printing
//      whose name (minus " ex") is one of the 11 Ancient species (Great Tusk, Scream Tail,
//      Brute Bonnet, Flutter Mane, Slither Wing, Sandy Shocks, Roaring Moon, Koraidon, Walking
//      Wake, Gouging Fire, Raging Bolt), the 11 Future species (Iron Treads, Iron Bundle, Iron
//      Hands, Iron Jugulis, Iron Moth, Iron Thorns, Iron Valiant, Miraidon, Iron Leaves, Iron
//      Boulder, Iron Crown) or a source-1-tagged Trainer name. It agreed on all 86 and
//      disagreed on exactly three legal printings, each settled against the tcgdex image:
//        • `sv07-090` Koraidon (130 HP, Resolute Fang) — the image prints NO banner. OUT.
//        • `svp-148` Miraidon (120 HP, Electric Claws / Mach Bolt) — NO banner. OUT.
//        • `svp-197` Koraidon ex (230 HP, Claw Slash / Revenge Buster) — NO banner. OUT.
//      `svp-166` … `svp-225` (past source 1's promo cut at `svp-165`) were walked by name:
//      `svp-197` is the only Paradox species there. So the NAME IS NOT THE BANNER (three
//      same-species printings without it) — the runtime stays id-keyed (D135); the name was
//      a measurement aid only.

/** A printed banner class. ~~One member today; Slice 2 (Paradox) widens it with
    "Ancient" and "Future".~~ (🆕🆕🆕 D569 (D539): WITHDRAWN — three members now; Slice 2
    part a widened it.) */
export type Banner = "Tera" | "Ancient" | "Future";

/** Printing id → banner. A literal, keyed by the catalog's tcgdex id. Every TERA id is a
    Standard-legal Pokémon ex (pinned by `teraBannerD568.test.ts`); every ANCIENT/FUTURE id
    is a Standard-legal Pokémon (ex or not) or Trainer (🆕🆕🆕 D569, pinned by
    `paradoxBannerD569.test.ts`). */
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
  // ── 🆕🆕🆕 D569 — the Paradox banners (Slice 2 part a), 86 ids. ──
  // Ancient — 44 (40 Pokémon, 4 Trainers)
  "sv05-038": "Ancient", // Gouging Fire ex
  "sv05-050": "Ancient", // Walking Wake ex
  "sv05-077": "Ancient", // Scream Tail
  "sv05-078": "Ancient", // Flutter Mane
  "sv05-096": "Ancient", // Great Tusk
  "sv05-097": "Ancient", // Great Tusk
  "sv05-098": "Ancient", // Sandy Shocks
  "sv05-109": "Ancient", // Roaring Moon
  "sv05-119": "Ancient", // Koraidon
  "sv05-120": "Ancient", // Koraidon ex
  "sv05-123": "Ancient", // Raging Bolt ex
  "sv05-141": "Ancient", // Awakening Drum (Trainer)
  "sv05-147": "Ancient", // Explorer's Guidance (Trainer)
  "sv05-188": "Ancient", // Gouging Fire ex
  "sv05-189": "Ancient", // Walking Wake ex
  "sv05-196": "Ancient", // Raging Bolt ex
  "sv05-200": "Ancient", // Explorer's Guidance (Trainer)
  "sv05-204": "Ancient", // Gouging Fire ex
  "sv05-205": "Ancient", // Walking Wake ex
  "sv05-208": "Ancient", // Raging Bolt ex
  "sv05-214": "Ancient", // Gouging Fire ex
  "sv05-215": "Ancient", // Walking Wake ex
  "sv05-218": "Ancient", // Raging Bolt ex
  "sv06-063": "Ancient", // Walking Wake
  "sv06-094": "Ancient", // Scream Tail ex
  "sv06-118": "Ancient", // Brute Bonnet
  "sv06-197": "Ancient", // Scream Tail ex
  "sv06.5-026": "Ancient", // Slither Wing
  "sv07-111": "Ancient", // Raging Bolt
  "sv08-038": "Ancient", // Gouging Fire
  "sv08-096": "Ancient", // Flutter Mane
  "sv08-116": "Ancient", // Koraidon
  "sv08.5-043": "Ancient", // Flutter Mane
  "sv08.5-055": "Ancient", // Great Tusk
  "sv08.5-065": "Ancient", // Roaring Moon
  "sv08.5-107": "Ancient", // Explorer's Guidance (Trainer)
  "sv08.5-166": "Ancient", // Raging Bolt ex
  "sv08.5-178": "Ancient", // Walking Wake ex
  "svp-091": "Ancient", // Koraidon
  "svp-097": "Ancient", // Flutter Mane
  "svp-127": "Ancient", // Walking Wake ex
  "svp-144": "Ancient", // Gouging Fire ex
  "svp-145": "Ancient", // Raging Bolt ex
  "svp-151": "Ancient", // Gouging Fire
  // Future — 42 (38 Pokémon, 4 Trainers)
  "sv05-025": "Future", // Iron Leaves ex
  "sv05-061": "Future", // Iron Hands
  "sv05-062": "Future", // Iron Thorns
  "sv05-079": "Future", // Iron Valiant
  "sv05-080": "Future", // Iron Valiant
  "sv05-081": "Future", // Iron Crown ex
  "sv05-099": "Future", // Iron Boulder ex
  "sv05-118": "Future", // Iron Treads
  "sv05-121": "Future", // Miraidon
  "sv05-122": "Future", // Miraidon ex
  "sv05-139": "Future", // Iron Jugulis
  "sv05-145": "Future", // Ciphermaniac's Codebreaking (Trainer)
  "sv05-158": "Future", // Reboot Pod (Trainer)
  "sv05-186": "Future", // Iron Leaves ex
  "sv05-191": "Future", // Iron Crown ex
  "sv05-192": "Future", // Iron Boulder ex
  "sv05-198": "Future", // Ciphermaniac's Codebreaking (Trainer)
  "sv05-203": "Future", // Iron Leaves ex
  "sv05-206": "Future", // Iron Crown ex
  "sv05-207": "Future", // Iron Boulder ex
  "sv05-213": "Future", // Iron Leaves ex
  "sv05-216": "Future", // Iron Crown ex
  "sv05-217": "Future", // Iron Boulder ex
  "sv06-019": "Future", // Iron Leaves
  "sv06-062": "Future", // Iron Bundle
  "sv06-077": "Future", // Iron Thorns ex
  "sv06-196": "Future", // Iron Thorns ex
  "sv06.5-009": "Future", // Iron Moth
  "sv07-071": "Future", // Iron Boulder
  "sv08-055": "Future", // Iron Bundle
  "sv08-069": "Future", // Miraidon
  "sv08-132": "Future", // Iron Crown
  "sv08.5-032": "Future", // Iron Thorns ex
  "sv08.5-046": "Future", // Iron Boulder
  "sv08.5-104": "Future", // Ciphermaniac's Codebreaking (Trainer)
  "sv08.5-158": "Future", // Iron Crown ex
  "sv08.5-176": "Future", // Iron Leaves ex
  "svp-092": "Future", // Miraidon
  "svp-098": "Future", // Iron Thorns
  "svp-128": "Future", // Iron Leaves ex
  "svp-146": "Future", // Iron Crown ex
  "svp-147": "Future", // Iron Boulder ex
};

/** The banner `card` prints, or `undefined` — read by printing ID (D135), so a `fix-*`
    test card or an unknown id is bannerless. `undefined` in, `undefined` out. */
export function bannerOf(card: Card | undefined): Banner | undefined {
  return card === undefined ? undefined : BANNER_BY_ID[card.id];
}
