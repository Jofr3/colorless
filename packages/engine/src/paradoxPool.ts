// 🆕🆕🆕 D569 — TEST-ONLY: not exported from the package index, like `bannerPool.ts` and
// `testFixtures.ts`.
//
// The PARADOX twin of `bannerPool.ts`' `LEGAL_EX_POOL` (D275's rule: tests read real ids out of a
// committed pool, never out of a network or a dev database). `LEGAL_EX_POOL` already mirrors every
// legal Pokémon ex; a Paradox banner is ALSO printed on non-ex Pokémon and on Trainers, so this
// file mirrors the rest: one row per Standard-legal printing that is either a NON-ex Pokémon of one
// of the 22 Paradox species (the 11 Ancient — Great Tusk, Scream Tail, Brute Bonnet, Flutter Mane,
// Slither Wing, Sandy Shocks, Roaring Moon, Koraidon, Walking Wake, Gouging Fire, Raging Bolt — and
// the 11 Future — Iron Treads, Iron Bundle, Iron Hands, Iron Jugulis, Iron Moth, Iron Thorns, Iron
// Valiant, Miraidon, Iron Leaves, Iron Boulder, Iron Crown), banner or not, or a Trainer whose name
// pokemon-tcg-data tags Ancient/Future anywhere: `[id, name, category, hp, attack names, ability
// names]`. Measured 2026-10-02 from the tcgdex card JSON the 2026-09-25 coverage audit fetched (the
// ingest's own upstream), `legal.standard === true`: 47 rows (39 Pokémon, 8 Trainers). It exists for
// `banners.ts`' Paradox rungs (`paradoxBannerD569.test.ts`): every Ancient/Future id is a row here or
// in `LEGAL_EX_POOL`, same-text reprints agree on the banner, and the three SAME-SPECIES printings
// with NO banner (`sv07-090` Koraidon, `svp-148` Miraidon here; `svp-197` Koraidon ex in
// `LEGAL_EX_POOL`) are rows the table does not key. A snapshot, not a source of truth.

export type ParadoxPoolRow = readonly [
  id: string,
  name: string,
  category: "Pokemon" | "Trainer",
  hp: number | null,
  attacks: readonly string[],
  abilities: readonly string[],
];

export const PARADOX_POOL: readonly ParadoxPoolRow[] = [
  ["sv05-061", "Iron Hands", "Pokemon", 140, ["Volt Wave", "Superalloy Hands"], []],
  ["sv05-062", "Iron Thorns", "Pokemon", 140, ["Destructo-Press", "Megaton Lariat"], []],
  ["sv05-077", "Scream Tail", "Pokemon", 90, ["Supportive Singing", "Hyper Voice"], []],
  ["sv05-078", "Flutter Mane", "Pokemon", 90, ["Hex Hurl"], ["Midnight Fluttering"]],
  ["sv05-079", "Iron Valiant", "Pokemon", 130, ["Gemini Laser", "Zen Blade"], []],
  ["sv05-080", "Iron Valiant", "Pokemon", 130, ["Calculation", "Majestic Sword"], []],
  ["sv05-096", "Great Tusk", "Pokemon", 140, ["Lunge Out", "Wrathful Charge"], []],
  ["sv05-097", "Great Tusk", "Pokemon", 140, ["Land Collapse", "Giant Tusk"], []],
  ["sv05-098", "Sandy Shocks", "Pokemon", 120, ["Magnetic Burst", "Power Gem"], []],
  ["sv05-109", "Roaring Moon", "Pokemon", 140, ["Vengeance Fletching", "Speed Wing"], []],
  ["sv05-118", "Iron Treads", "Pokemon", 130, ["Wheel Pass"], ["Dual Core"]],
  ["sv05-119", "Koraidon", "Pokemon", 140, ["Primordial Beatdown", "Shred"], []],
  ["sv05-121", "Miraidon", "Pokemon", 110, ["Peak Acceleration", "Sparking Strike"], []],
  ["sv05-139", "Iron Jugulis", "Pokemon", 130, ["Blasting Wind"], ["Automated Combat"]],
  ["sv05-141", "Awakening Drum", "Trainer", null, [], []],
  ["sv05-145", "Ciphermaniac's Codebreaking", "Trainer", null, [], []],
  ["sv05-147", "Explorer's Guidance", "Trainer", null, [], []],
  ["sv05-158", "Reboot Pod", "Trainer", null, [], []],
  ["sv05-198", "Ciphermaniac's Codebreaking", "Trainer", null, [], []],
  ["sv05-200", "Explorer's Guidance", "Trainer", null, [], []],
  ["sv06-019", "Iron Leaves", "Pokemon", 120, ["Recovery Net", "Avenging Edge"], []],
  ["sv06-062", "Iron Bundle", "Pokemon", 90, ["Interjet"], []],
  ["sv06-063", "Walking Wake", "Pokemon", 130, ["Aurora Gain", "Undulating Slice"], []],
  ["sv06-118", "Brute Bonnet", "Pokemon", 120, ["Poison Spray", "Relentless Punches"], []],
  ["sv06.5-009", "Iron Moth", "Pokemon", 120, ["Suction", "Anachronism Repulsor"], []],
  ["sv06.5-026", "Slither Wing", "Pokemon", 140, ["Iron Smasher", "Smashing Wing"], []],
  ["sv07-071", "Iron Boulder", "Pokemon", 140, ["Adjusted Horn"], []],
  ["sv07-090", "Koraidon", "Pokemon", 130, ["Resolute Fang"], []],
  ["sv07-111", "Raging Bolt", "Pokemon", 130, ["Thunderburst Storm", "Dragon Headbutt"], []],
  ["sv08-038", "Gouging Fire", "Pokemon", 130, ["Lunge Out", "Blazing Charge"], []],
  ["sv08-055", "Iron Bundle", "Pokemon", 100, ["Gusting Collision"], []],
  ["sv08-069", "Miraidon", "Pokemon", 120, ["C.O.D.E.: Protect", "Thunder Claws"], []],
  ["sv08-096", "Flutter Mane", "Pokemon", 90, ["Perplexing Transfer", "Moonblast"], []],
  ["sv08-116", "Koraidon", "Pokemon", 130, ["Unrelenting Onslaught", "Hammer In"], []],
  ["sv08-132", "Iron Crown", "Pokemon", 130, ["Deleting Slash", "Slicing Blade"], []],
  ["sv08.5-043", "Flutter Mane", "Pokemon", 90, ["Hex Hurl"], ["Midnight Fluttering"]],
  ["sv08.5-046", "Iron Boulder", "Pokemon", 140, ["Adjusted Horn"], []],
  ["sv08.5-055", "Great Tusk", "Pokemon", 140, ["Land Collapse", "Giant Tusk"], []],
  ["sv08.5-065", "Roaring Moon", "Pokemon", 140, ["Vengeance Fletching", "Speed Wing"], []],
  ["sv08.5-104", "Ciphermaniac's Codebreaking", "Trainer", null, [], []],
  ["sv08.5-107", "Explorer's Guidance", "Trainer", null, [], []],
  ["svp-091", "Koraidon", "Pokemon", 140, ["Primordial Beatdown", "Shred"], []],
  ["svp-092", "Miraidon", "Pokemon", 110, ["Peak Acceleration", "Sparking Strike"], []],
  ["svp-097", "Flutter Mane", "Pokemon", 90, ["Hex Hurl"], ["Midnight Fluttering"]],
  ["svp-098", "Iron Thorns", "Pokemon", 140, ["Destructo-Press", "Megaton Lariat"], []],
  ["svp-148", "Miraidon", "Pokemon", 120, ["Electric Claws", "Mach Bolt"], []],
  ["svp-151", "Gouging Fire", "Pokemon", 130, ["Lunge Out", "Blazing Charge"], []],
];
