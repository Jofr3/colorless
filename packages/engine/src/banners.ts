import type { Card } from "@colorless/schema";

// Which printings carry the Tera, Ancient or Future banner. No ingested column classifies the
// banner, so it is an engine table keyed by printing id, never by name: reprints of one species can
// differ (Pikachu ex `sv08-057` is Tera, `sv08.5-028` is not). Paradox banners also appear on
// Trainers and non-ex Pokémon.

/** A printed banner class. */
export type Banner = "Tera" | "Ancient" | "Future";

/** Printing id → banner, keyed by the catalog's tcgdex id. */
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
  "me02.5-038": "Tera", // Cinderace ex (= sv07-157)
  "me02.5-057": "Tera", // Pikachu ex, reprint of sv08-057
  "me02.5-160": "Tera", // Dragapult ex (= sv06-130)
  "me02.5-179": "Tera", // Terapagos ex, reprint of sv07-128
  "me02.5-277": "Tera", // Pikachu ex, reprint of sv08-057
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

/**
 * The banner `card` prints, or `undefined`. Read by printing id, so test cards and unknown ids have
 * no banner.
 */
export function bannerOf(card: Card | undefined): Banner | undefined {
  return card === undefined ? undefined : BANNER_BY_ID[card.id];
}
