// Weakness / Resistance for Pokémon whose tcgdex (English) payload carries neither.
//
// tcgdex ships NO `weaknesses` / `resistances` for every Pokémon in White Flare
// (sv10.5w) and Black Bolt (sv10.5b) and for 30 SVP promos (svp-166 … svp-207), so
// the catalog stored NULL and the engine applied no Weakness to 342 Standard-legal
// printings (card revision B39). Gathered 2026-10-20 from three independent sources:
//
//   P  pokemontcg.io v2 (`/cards?q=set.id:rsv10pt5|zsv10pt5|svp`; matched by number + name)
//   T  TCGplayer product data via tcgcsv.com (groups 24326, 24325, 22872; "Rx2" / "F-30")
//   J  tcgdex Japanese (SV11W / SV11B; matched by Pokédex number, the numbering differs)
//   M  the same Pokémon's printings in me02.5 / me05 (already in the catalog)
//   X  the printed Metal-type pattern (Fire ×2, Grass −30)
//   S  one source only, equal to the same card's regular-art printing in this table
//
// 323 entries have two or three sources agreeing. The five that do not are resolved
// AGAINST TCGplayer: Vullaby / Mandibuzz sv10.5w-063 / -064 / -144 / -145 (T: Grass ×2;
// P, J and M: Lightning ×2, Fighting −30) and Dialga ex svp-180 (T: Fighting −30; P and X:
// Grass −30). My First Battle (mfb) and the three 30th-c cards are absent from all three
// sources and stay NULL; none is Standard-legal.
//
// Applied by `mapCard` ONLY when tcgdex sends neither field, so an upstream fix wins.

import type { TcgdexWeakRes } from "@colorless/schema";

export interface WeakResSupplement {
  weaknesses: TcgdexWeakRes[];
  resistances?: TcgdexWeakRes[];
  /** Source letters, see the header. */
  from: string;
}

export const WEAK_RES_SUPPLEMENT: Readonly<Record<string, WeakResSupplement>> = {
  "sv10.5b-001": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Snivy
  "sv10.5b-002": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Servine
  "sv10.5b-003": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Serperior ex
  "sv10.5b-004": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Pansage
  "sv10.5b-005": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Simisage
  "sv10.5b-006": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Petilil
  "sv10.5b-007": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Lilligant
  "sv10.5b-008": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Maractus
  "sv10.5b-009": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Karrablast
  "sv10.5b-010": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Foongus
  "sv10.5b-011": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Amoonguss
  "sv10.5b-012": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Victini
  "sv10.5b-013": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Darumaka
  "sv10.5b-014": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Darmanitan
  "sv10.5b-015": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Larvesta
  "sv10.5b-016": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Volcarona
  "sv10.5b-017": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Panpour
  "sv10.5b-018": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Simipour
  "sv10.5b-019": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Tympole
  "sv10.5b-020": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Palpitoad
  "sv10.5b-021": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Seismitoad
  "sv10.5b-022": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Tirtouga
  "sv10.5b-023": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Carracosta
  "sv10.5b-024": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Alomomola
  "sv10.5b-025": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Cubchoo
  "sv10.5b-026": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Beartic
  "sv10.5b-027": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Cryogonal
  "sv10.5b-028": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Kyurem ex
  "sv10.5b-029": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Emolga
  "sv10.5b-030": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Tynamo
  "sv10.5b-031": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eelektrik
  "sv10.5b-032": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eelektross
  "sv10.5b-033": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Thundurus
  "sv10.5b-034": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zekrom ex
  "sv10.5b-035": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Munna
  "sv10.5b-036": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Musharna
  "sv10.5b-037": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Solosis
  "sv10.5b-038": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Duosion
  "sv10.5b-039": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Reuniclus
  "sv10.5b-040": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Elgyem
  "sv10.5b-041": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Beheeyem
  "sv10.5b-042": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Golett
  "sv10.5b-043": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Golurk
  "sv10.5b-044": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Meloetta ex
  "sv10.5b-045": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Drilbur
  "sv10.5b-046": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Excadrill ex
  "sv10.5b-047": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Timburr
  "sv10.5b-048": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Gurdurr
  "sv10.5b-049": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Conkeldurr
  "sv10.5b-050": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Throh
  "sv10.5b-051": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Dwebble
  "sv10.5b-052": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Crustle
  "sv10.5b-053": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Landorus
  "sv10.5b-054": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Venipede
  "sv10.5b-055": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Whirlipede
  "sv10.5b-056": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Scolipede
  "sv10.5b-057": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Sandile
  "sv10.5b-058": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Krokorok
  "sv10.5b-059": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Krookodile
  "sv10.5b-060": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "TS" }, // Escavalier
  "sv10.5b-061": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klink
  "sv10.5b-062": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klang
  "sv10.5b-063": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klinklang
  "sv10.5b-064": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Pawniard
  "sv10.5b-065": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Bisharp
  "sv10.5b-066": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Cobalion
  "sv10.5b-067": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Genesect ex
  "sv10.5b-071": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Pidove
  "sv10.5b-072": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Tranquill
  "sv10.5b-073": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Unfezant
  "sv10.5b-074": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Audino
  "sv10.5b-075": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Minccino
  "sv10.5b-076": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Cinccino
  "sv10.5b-077": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Rufflet
  "sv10.5b-078": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Braviary
  "sv10.5b-087": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Snivy
  "sv10.5b-088": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Servine
  "sv10.5b-089": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Pansage
  "sv10.5b-090": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Simisage
  "sv10.5b-091": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Petilil
  "sv10.5b-092": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Lilligant
  "sv10.5b-093": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Maractus
  "sv10.5b-094": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Karrablast
  "sv10.5b-095": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Foongus
  "sv10.5b-096": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Amoonguss
  "sv10.5b-097": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Darumaka
  "sv10.5b-098": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Darmanitan
  "sv10.5b-099": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Larvesta
  "sv10.5b-100": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Volcarona
  "sv10.5b-101": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Panpour
  "sv10.5b-102": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Simipour
  "sv10.5b-103": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Tympole
  "sv10.5b-104": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Palpitoad
  "sv10.5b-105": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Seismitoad
  "sv10.5b-106": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Tirtouga
  "sv10.5b-107": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Carracosta
  "sv10.5b-108": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Alomomola
  "sv10.5b-109": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Cubchoo
  "sv10.5b-110": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Beartic
  "sv10.5b-111": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Cryogonal
  "sv10.5b-112": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Emolga
  "sv10.5b-113": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Tynamo
  "sv10.5b-114": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eelektrik
  "sv10.5b-115": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eelektross
  "sv10.5b-116": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Munna
  "sv10.5b-117": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Musharna
  "sv10.5b-118": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Solosis
  "sv10.5b-119": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Duosion
  "sv10.5b-120": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Elgyem
  "sv10.5b-121": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Beheeyem
  "sv10.5b-122": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Golett
  "sv10.5b-123": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PS" }, // Golurk
  "sv10.5b-124": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Drilbur
  "sv10.5b-125": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Timburr
  "sv10.5b-126": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Gurdurr
  "sv10.5b-127": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Conkeldurr
  "sv10.5b-128": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Throh
  "sv10.5b-129": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Dwebble
  "sv10.5b-130": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Crustle
  "sv10.5b-131": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Landorus
  "sv10.5b-132": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Venipede
  "sv10.5b-133": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Whirlipede
  "sv10.5b-134": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Scolipede
  "sv10.5b-135": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Sandile
  "sv10.5b-136": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Krokorok
  "sv10.5b-137": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Krookodile
  "sv10.5b-138": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Escavalier
  "sv10.5b-139": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klink
  "sv10.5b-140": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klang
  "sv10.5b-141": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Klinklang
  "sv10.5b-142": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Pawniard
  "sv10.5b-143": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Bisharp
  "sv10.5b-144": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PS" }, // Cobalion
  "sv10.5b-148": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Pidove
  "sv10.5b-149": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Tranquill
  "sv10.5b-150": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Unfezant
  "sv10.5b-151": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Audino
  "sv10.5b-152": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Minccino
  "sv10.5b-153": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Cinccino
  "sv10.5b-154": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Rufflet
  "sv10.5b-155": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Braviary
  "sv10.5b-156": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Serperior ex
  "sv10.5b-157": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Kyurem ex
  "sv10.5b-158": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zekrom ex
  "sv10.5b-159": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Meloetta ex
  "sv10.5b-160": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Excadrill ex
  "sv10.5b-161": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Genesect ex
  "sv10.5b-164": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Serperior ex
  "sv10.5b-165": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Kyurem ex
  "sv10.5b-166": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zekrom ex
  "sv10.5b-167": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Meloetta ex
  "sv10.5b-168": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Excadrill ex
  "sv10.5b-169": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Genesect ex
  "sv10.5b-171": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Victini
  "sv10.5b-172": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zekrom ex
  "sv10.5w-001": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Sewaddle
  "sv10.5w-002": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Swadloon
  "sv10.5w-003": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Leavanny
  "sv10.5w-004": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Cottonee
  "sv10.5w-005": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Whimsicott ex
  "sv10.5w-006": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Deerling
  "sv10.5w-007": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Sawsbuck
  "sv10.5w-008": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Shelmet
  "sv10.5w-009": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Accelgor
  "sv10.5w-010": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Virizion
  "sv10.5w-011": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Tepig
  "sv10.5w-012": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Pignite
  "sv10.5w-013": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Emboar
  "sv10.5w-014": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Pansear
  "sv10.5w-015": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Simisear
  "sv10.5w-016": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Litwick
  "sv10.5w-017": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Lampent
  "sv10.5w-018": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Chandelure
  "sv10.5w-019": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Heatmor
  "sv10.5w-020": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Reshiram ex
  "sv10.5w-021": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Oshawott
  "sv10.5w-022": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Dewott
  "sv10.5w-023": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Samurott
  "sv10.5w-024": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Basculin
  "sv10.5w-025": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Ducklett
  "sv10.5w-026": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Swanna
  "sv10.5w-027": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanillite
  "sv10.5w-028": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanillish
  "sv10.5w-029": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanilluxe
  "sv10.5w-030": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Keldeo ex
  "sv10.5w-031": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Blitzle
  "sv10.5w-032": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zebstrika
  "sv10.5w-033": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Joltik
  "sv10.5w-034": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Galvantula
  "sv10.5w-035": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Stunfisk
  "sv10.5w-036": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Woobat
  "sv10.5w-037": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Swoobat
  "sv10.5w-038": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Sigilyph
  "sv10.5w-039": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Yamask
  "sv10.5w-040": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Cofagrigus
  "sv10.5w-041": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Gothita
  "sv10.5w-042": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Gothorita
  "sv10.5w-043": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Gothitelle
  "sv10.5w-044": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Frillish
  "sv10.5w-045": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Jellicent ex
  "sv10.5w-046": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Roggenrola
  "sv10.5w-047": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Boldore
  "sv10.5w-048": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Gigalith
  "sv10.5w-049": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Sawk
  "sv10.5w-050": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Archen
  "sv10.5w-051": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Archeops
  "sv10.5w-052": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Mienfoo
  "sv10.5w-053": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Mienshao
  "sv10.5w-054": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Terrakion
  "sv10.5w-055": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Purrloin
  "sv10.5w-056": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Liepard
  "sv10.5w-057": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scraggy
  "sv10.5w-058": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scrafty
  "sv10.5w-059": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Trubbish
  "sv10.5w-060": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Garbodor
  "sv10.5w-061": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zorua
  "sv10.5w-062": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zoroark
  "sv10.5w-063": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PJM" }, // Vullaby
  "sv10.5w-064": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PJM" }, // Mandibuzz
  "sv10.5w-065": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Deino
  "sv10.5w-066": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zweilous
  "sv10.5w-067": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Hydreigon ex
  "sv10.5w-068": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Ferroseed
  "sv10.5w-069": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Ferrothorn
  "sv10.5w-070": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Durant
  "sv10.5w-072": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Patrat
  "sv10.5w-073": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Watchog
  "sv10.5w-074": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Lillipup
  "sv10.5w-075": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Herdier
  "sv10.5w-076": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Stoutland
  "sv10.5w-077": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Bouffalant ex
  "sv10.5w-078": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PTJ" }, // Tornadus
  "sv10.5w-087": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Sewaddle
  "sv10.5w-088": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Swadloon
  "sv10.5w-089": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Leavanny
  "sv10.5w-090": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Cottonee
  "sv10.5w-091": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Deerling
  "sv10.5w-092": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Sawsbuck
  "sv10.5w-093": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Shelmet
  "sv10.5w-094": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Accelgor
  "sv10.5w-095": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PTJ" }, // Virizion
  "sv10.5w-096": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Tepig
  "sv10.5w-097": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Pignite
  "sv10.5w-098": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Emboar
  "sv10.5w-099": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Pansear
  "sv10.5w-100": { weaknesses: [{ type: "Water", value: "×2" }], from: "PTJ" }, // Simisear
  "sv10.5w-101": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Litwick
  "sv10.5w-102": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Lampent
  "sv10.5w-103": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Chandelure
  "sv10.5w-104": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Heatmor
  "sv10.5w-105": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Oshawott
  "sv10.5w-106": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Dewott
  "sv10.5w-107": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Samurott
  "sv10.5w-108": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Basculin
  "sv10.5w-109": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Ducklett
  "sv10.5w-110": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Swanna
  "sv10.5w-111": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanillite
  "sv10.5w-112": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanillish
  "sv10.5w-113": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Vanilluxe
  "sv10.5w-114": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Blitzle
  "sv10.5w-115": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Zebstrika
  "sv10.5w-116": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Joltik
  "sv10.5w-117": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Galvantula
  "sv10.5w-118": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Stunfisk
  "sv10.5w-119": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Woobat
  "sv10.5w-120": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Swoobat
  "sv10.5w-121": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Sigilyph
  "sv10.5w-122": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Yamask
  "sv10.5w-123": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Cofagrigus
  "sv10.5w-124": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Gothita
  "sv10.5w-125": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Gothorita
  "sv10.5w-126": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Frillish
  "sv10.5w-127": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Roggenrola
  "sv10.5w-128": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Boldore
  "sv10.5w-129": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Gigalith
  "sv10.5w-130": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Sawk
  "sv10.5w-131": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Archen
  "sv10.5w-132": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Archeops
  "sv10.5w-133": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Mienfoo
  "sv10.5w-134": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Mienshao
  "sv10.5w-135": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Terrakion
  "sv10.5w-136": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Purrloin
  "sv10.5w-137": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Liepard
  "sv10.5w-138": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scraggy
  "sv10.5w-139": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scrafty
  "sv10.5w-140": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Trubbish
  "sv10.5w-141": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Garbodor
  "sv10.5w-142": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zorua
  "sv10.5w-143": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zoroark
  "sv10.5w-144": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PJM" }, // Vullaby
  "sv10.5w-145": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PJM" }, // Mandibuzz
  "sv10.5w-146": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Deino
  "sv10.5w-147": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Zweilous
  "sv10.5w-148": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Ferroseed
  "sv10.5w-149": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Ferrothorn
  "sv10.5w-150": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Durant
  "sv10.5w-152": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Patrat
  "sv10.5w-153": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Watchog
  "sv10.5w-154": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Lillipup
  "sv10.5w-155": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Herdier
  "sv10.5w-156": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Stoutland
  "sv10.5w-157": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Whimsicott ex
  "sv10.5w-158": { weaknesses: [{ type: "Water", value: "×2" }], from: "PS" }, // Reshiram ex
  "sv10.5w-159": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PS" }, // Keldeo ex
  "sv10.5w-160": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PS" }, // Jellicent ex
  "sv10.5w-161": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PS" }, // Hydreigon ex
  "sv10.5w-162": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PS" }, // Bouffalant ex
  "sv10.5w-165": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Whimsicott ex
  "sv10.5w-166": { weaknesses: [{ type: "Water", value: "×2" }], from: "PS" }, // Reshiram ex
  "sv10.5w-167": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PS" }, // Keldeo ex
  "sv10.5w-168": { weaknesses: [{ type: "Darkness", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PS" }, // Jellicent ex
  "sv10.5w-169": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PS" }, // Hydreigon ex
  "sv10.5w-170": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PS" }, // Bouffalant ex
  "sv10.5w-172": { weaknesses: [{ type: "Water", value: "×2" }], from: "PS" }, // Victini
  "sv10.5w-173": { weaknesses: [{ type: "Water", value: "×2" }], from: "PS" }, // Reshiram ex
  "svp-166": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Teal Mask Ogerpon ex
  "svp-167": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // Flareon
  "svp-168": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Vaporeon
  "svp-169": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Jolteon
  "svp-170": { weaknesses: [{ type: "Fire", value: "×2" }], from: "PT" }, // Leafeon
  "svp-171": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Glaceon
  "svp-172": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Sylveon
  "svp-173": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eevee
  "svp-174": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Eevee ex
  "svp-177": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Bloodmoon Ursaluna ex
  "svp-178": { weaknesses: [{ type: "Lightning", value: "×2" }], from: "PT" }, // Kyogre ex
  "svp-179": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Xerneas ex
  "svp-180": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PX" }, // Dialga ex
  "svp-181": { weaknesses: [{ type: "Water", value: "×2" }], from: "PT" }, // N's Darmanitan
  "svp-182": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Iono's Kilowattrel
  "svp-183": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Lillie's Ribombee
  "svp-184": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Hop's Snorlax
  "svp-185": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Yanma
  "svp-186": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scraggy
  "svp-187": { weaknesses: [{ type: "Lightning", value: "×2" }], resistances: [{ type: "Fighting", value: "-30" }], from: "PT" }, // Yanmega
  "svp-188": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Scrafty
  "svp-189": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PS" }, // N's Zorua
  "svp-190": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "TS" }, // Pikachu
  "svp-193": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Hop's Zacian ex
  "svp-194": { weaknesses: [{ type: "Fighting", value: "×2" }], from: "PT" }, // Iono's Bellibolt ex
  "svp-195": { weaknesses: [{ type: "Metal", value: "×2" }], from: "PT" }, // Lillie's Clefairy ex
  "svp-197": { weaknesses: [{ type: "Psychic", value: "×2" }], from: "PT" }, // Koraidon ex
  "svp-198": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Zacian ex
  "svp-206": { weaknesses: [{ type: "Grass", value: "×2" }], from: "PT" }, // Marnie's Morpeko
  "svp-207": { weaknesses: [{ type: "Fire", value: "×2" }], resistances: [{ type: "Grass", value: "-30" }], from: "PT" }, // Steven's Beldum
};
