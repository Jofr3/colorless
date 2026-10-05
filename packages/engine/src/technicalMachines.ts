import type { Attack } from "@luminous/schema";

// 🆕🆕🆕 D578 — THE TECHNICAL MACHINES' GRANTED ATTACKS, HAND-WRITTEN, keyed by printing id.
//
// A Technical Machine is a Pokémon Tool that prints an ATTACK on the Trainer card: *"The
// Pokémon this card is attached to can use the attack on this card. (You still need the
// necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon,
// discard it at the end of your turn."* One is Standard-legal and built here:
//
//   sv08-188  Technical Machine: Fluorite  "Fluorite"  {G}{W}{P}
//             "Discard all Energy from this Pokémon, and heal all damage from each of your
//             Tera Pokémon."
//
// 🛑 THE ATTACK IS WRITTEN HERE BECAUSE THE INGEST DROPS IT. tcgdex carries the `attacks`
// array on the Trainer row (the audit card JSON, 2026-09-25), but `apps/api/src/ingest/map.ts`
// builds every row from a base that nulls `attacksJson`, and its Trainer branch refills only
// `trainerType` and `effect` — so the catalog `Card` the engine is handed for this id has
// `attacks: null`. The Antique Fossils' face (`fossils.ts`, D576) is the precedent: a fixed
// fact about a PRINTING, written by an engine table keyed by id, never fetched at runtime.
//
// ⚠️ NAMED USER FOLLOW-UP (decisions.md D576, D578): widen map.ts's Trainer branch to keep
// `attacks` (and `hp` / `abilities`), re-ingest the remote D1, regenerate the catalog manifest
// and the fixtures — after which this table could be checked against the catalog instead of
// standing in for it.
//
// ⚠️ THE TABLE IS DATA, NOT LOGIC. No schema, D1, ingest, wire or `Card` change. It sits
// OUTSIDE the mutation whitelist (D538): a mutant must never name this file — the text is
// pinned LITERALLY by `tmFluoriteD578.test.ts`, copied verbatim from the card JSON. The
// registry row (`toolAttacks`) carries it by reference; the PROGRAM is the registry row's own
// `attack` key.

/** Technical Machine: Fluorite `sv08-188` — its one printed attack, verbatim. */
export const TM_FLUORITE_ATTACKS: readonly Attack[] = [
  {
    cost: ["Grass", "Water", "Psychic"],
    name: "Fluorite",
    effect: "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon.",
  },
];
