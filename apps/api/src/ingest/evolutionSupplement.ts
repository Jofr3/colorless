// Stage and evolution for Pokémon whose tcgdex payload carries no `evolveFrom`. Source letters:
// M another printing of the same name in the catalog, B the base species' printings ("X" for
// "X ex" and "Mega X ex"; a Mega Evolution Pokémon ex shares X's stage and evolution), T a tcgdex
// English printing outside the catalog scope, named after the letter. `stage` is given only where
// tcgdex sends the wrong one, and replaces a tcgdex stage of Basic or none whether or not tcgdex
// sends an `evolveFrom`; an evolving stage or an `evolveFrom` from tcgdex wins over the table's.

export interface EvolutionSupplement {
  stage?: "Stage1" | "Stage2";
  evolveFrom: string;
  /** Source letters, see the header. */
  from: string;
}

export const EVOLUTION_SUPPLEMENT: Readonly<Record<string, EvolutionSupplement>> = {
  "30th-002": { evolveFrom: "Exeggcute", from: "M" }, // Alolan Exeggutor
  "30th-007": { evolveFrom: "Cherubi", from: "T bw8-7" }, // Cherrim
  "30th-008": { evolveFrom: "Spewpa", from: "M" }, // Vivillon
  "30th-010": { evolveFrom: "Vulpix", from: "M" }, // Ninetales
  "30th-059": { evolveFrom: "Toxel", from: "M" }, // Toxtricity
  "30th-060": { evolveFrom: "Toxel", from: "M" }, // Toxtricity
  "30th-068": { evolveFrom: "Marill", from: "M" }, // Azumarill
  "30th-069": { evolveFrom: "Eevee", from: "M" }, // Espeon
  "30th-075": { evolveFrom: "Lampent", from: "M" }, // Chandelure
  "30th-079": { evolveFrom: "Cosmog", from: "T sm1-65" }, // Cosmoem
  "30th-080": { evolveFrom: "Cosmoem", from: "T sm2-61" }, // Lunala
  "30th-083": { evolveFrom: "Riolu", from: "M" }, // Lucario
  "30th-084": { evolveFrom: "Palpitoad", from: "M" }, // Seismitoad
  "30th-085": { evolveFrom: "Rockruff", from: "M" }, // Lycanroc
  "30th-088": { evolveFrom: "Nidoran♀", from: "M" }, // Nidorina
  "30th-091": { evolveFrom: "Eevee", from: "M" }, // Umbreon
  "30th-096": { evolveFrom: "Zorua", from: "M" }, // Zoroark
  "30th-098": { evolveFrom: "Deino", from: "M" }, // Zweilous
  "30th-099": { evolveFrom: "Zweilous", from: "M" }, // Hydreigon
  "30th-104": { evolveFrom: "Ferroseed", from: "M" }, // Ferrothorn
  "30th-105": { evolveFrom: "Cosmoem", from: "T sm2-87" }, // Solgaleo
  "30th-108": { evolveFrom: "Gimmighoul", from: "M" }, // Gholdengo
  "30th-111": { evolveFrom: "Jangmo-o", from: "T sm2-99" }, // Hakamo-o
  "30th-112": { evolveFrom: "Hakamo-o", from: "T sm4-77" }, // Kommo-o
  "30th-123": { evolveFrom: "Hisuian Zorua", from: "T swsh11-076" }, // Hisuian Zoroark
  "30th-125": { evolveFrom: "Tandemaus", from: "M" }, // Maushold
  "30th-129": { evolveFrom: "Exeggcute", from: "M" }, // Alolan Exeggutor
  "30th-134": { evolveFrom: "Toxel", from: "M" }, // Toxtricity
  "30th-137": { evolveFrom: "Lampent", from: "M" }, // Chandelure
  "30th-138": { evolveFrom: "Rockruff", from: "M" }, // Lycanroc
  "30th-142": { evolveFrom: "Gimmighoul", from: "M" }, // Gholdengo
  "30th-143": { evolveFrom: "Hakamo-o", from: "T sm4-77" }, // Kommo-o
  "30th-146": { evolveFrom: "Tandemaus", from: "M" }, // Maushold
  "30th-c-001": { evolveFrom: "Charmeleon", from: "M" }, // Charizard
  "30th-c-002": { evolveFrom: "Skitty", from: "M" }, // Delcatty
  "30th-c-003": { evolveFrom: "Metang", from: "M" }, // Metagross
  "30th-c-006": { evolveFrom: "Dark Pupitar", from: "T ex7-19" }, // Dark Tyranitar
  "30th-c-018": { evolveFrom: "Haunter", from: "M" }, // Gengar
  "me06-003": { evolveFrom: "Surskit", from: "M" }, // Masquerain
  "me06-005": { evolveFrom: "Cacnea", from: "M" }, // Cacturne
  "me06-007": { evolveFrom: "Combee", from: "M" }, // Vespiquen
  "me06-011": { stage: "Stage1", evolveFrom: "Wimpod", from: "B" }, // Mega Golisopod ex
  "me06-013": { evolveFrom: "Sprigatito", from: "M" }, // Floragato
  "me06-014": { stage: "Stage2", evolveFrom: "Floragato", from: "M" }, // Meowscarada ex
  "me06-016": { evolveFrom: "Smoliv", from: "M" }, // Dolliv
  "me06-017": { evolveFrom: "Dolliv", from: "M" }, // Arboliva
  "me06-019": { evolveFrom: "Growlithe", from: "M" }, // Arcanine
  "me06-021": { evolveFrom: "Magmar", from: "M" }, // Magmortar
  "me06-028": { evolveFrom: "Frillish", from: "T bw3-31" }, // Jellicent
  "me06-031": { evolveFrom: "Electabuzz", from: "M" }, // Electivire
  "me06-032": { evolveFrom: "Eevee", from: "M" }, // Jolteon
  "me06-038": { evolveFrom: "Pawmi", from: "M" }, // Pawmo
  "me06-039": { evolveFrom: "Pawmo", from: "M" }, // Pawmot
  "me06-041": { evolveFrom: "Wattrel", from: "M" }, // Kilowattrel
  "me06-044": { evolveFrom: "Drowzee", from: "M" }, // Hypno
  "me06-047": { stage: "Stage1", evolveFrom: "Golett", from: "B" }, // Mega Golurk ex
  "me06-050": { evolveFrom: "Sandshrew", from: "M" }, // Sandslash
  "me06-052": { evolveFrom: "Onix", from: "M" }, // Steelix
  "me06-056": { evolveFrom: "Nidoran♀", from: "M" }, // Nidorina
  "me06-057": { evolveFrom: "Nidorina", from: "M" }, // Nidoqueen
  "me06-059": { evolveFrom: "Spinarak", from: "M" }, // Ariados
  "me06-062": { evolveFrom: "Carvanha", from: "M" }, // Sharpedo
  "me06-065": { evolveFrom: "Purrloin", from: "M" }, // Liepard
  "me06-067": { stage: "Stage1", evolveFrom: "Zorua", from: "B" }, // Zoroark ex
  "me06-069": { stage: "Stage1", evolveFrom: "Inkay", from: "B" }, // Mega Malamar ex
  "me06-074": { evolveFrom: "Jangmo-o", from: "T sm2-99" }, // Hakamo-o
  "me06-075": { evolveFrom: "Hakamo-o", from: "T sm4-77" }, // Kommo-o
  "me06-082": { evolveFrom: "Swablu", from: "M" }, // Altaria
  "me06-087": { evolveFrom: "Fletchling", from: "M" }, // Fletchinder
  "me06-088": { stage: "Stage2", evolveFrom: "Fletchinder", from: "B" }, // Talonflame ex
  "me06-104": { evolveFrom: "Surskit", from: "M" }, // Masquerain
  "me06-107": { evolveFrom: "Magmar", from: "M" }, // Magmortar
  "me06-108": { evolveFrom: "Electabuzz", from: "M" }, // Electivire
  "me06-116": { evolveFrom: "Swablu", from: "M" }, // Altaria
  "me06-118": { stage: "Stage1", evolveFrom: "Wimpod", from: "B" }, // Mega Golisopod ex
  "me06-122": { stage: "Stage1", evolveFrom: "Golett", from: "B" }, // Mega Golurk ex
  "me06-123": { stage: "Stage1", evolveFrom: "Inkay", from: "B" }, // Mega Malamar ex
  "me06-124": { stage: "Stage2", evolveFrom: "Fletchinder", from: "B" }, // Talonflame ex
  "me06-135": { stage: "Stage1", evolveFrom: "Wimpod", from: "B" }, // Mega Golisopod ex
  "me06-137": { stage: "Stage1", evolveFrom: "Golett", from: "B" }, // Mega Golurk ex
  "mfb-2": { evolveFrom: "Bulbasaur", from: "M" }, // Ivysaur
  "mfb-26": { evolveFrom: "Squirtle", from: "M" }, // Wartortle
  "mfb-4": { evolveFrom: "Oddish", from: "M" }, // Gloom
};

/** Pokémon the engine can neither play as a Basic nor evolve into, which the ingest's and
    db-check's evolution guards let through while they stay listed here. */
export const UNPLAYABLE_EVOLUTIONS: Readonly<Record<string, string>> = {
  "30th-c-006": "Dark Tyranitar evolves from Dark Pupitar, which no catalog card is",
  "30th-c-009": "Greninja BREAK: tcgdex sends no evolveFrom",
  "30th-c-026": "Mew VMAX: tcgdex sends no evolveFrom",
};
