// The one color-per-energy-name source of the app. Two UIs paint energy —
// the deck builder's ENERGY_TYPE_META (tile pips, the type-distribution bar)
// and the game HUD's attack-cost dots — and each keeps its OWN key set (the
// builder drops the retired Fairy and adds Dragon; the HUD keys on printed
// cost symbols, where Fairy exists and Dragon doesn't). The COLORS come from
// here, so "Fire" is the same red everywhere. Plain hex values: usable as
// inline `backgroundColor`, SVG fills, or any other CSS color.

import type { BasicEnergyType } from "@luminous/schema";

/** Every energy name any UI paints: the schema's basic-energy vocabulary
    (the compile-time anchor — a new/renamed basic energy is a missing key
    HERE, not a silent fallback tint downstream) plus the two UI-only names:
    Dragon (a Pokémon type with no Basic Energy) and Colorless (a cost
    symbol, not an attachable type). */
export type PaintedEnergyName = BasicEnergyType | "Dragon" | "Colorless";

/** Accent hex per energy name, tuned to read on the app's dark glass while
    staying recognisably "Fire = red, Water = blue, …" (the deck builder's
    original palette — the older precedent — plus Fairy for the HUD's cost
    dots). */
export const ENERGY_COLORS: Record<PaintedEnergyName, string> = {
  Grass: "#5bbd6b",
  Fire: "#ef5a3c",
  Water: "#3ba3e6",
  Lightning: "#f1c640",
  Psychic: "#b964cc",
  Fighting: "#d07a3a",
  Darkness: "#5a6072",
  Metal: "#9aa3b2",
  Fairy: "#e57ab1",
  Dragon: "#caa12c",
  Colorless: "#cfcfda",
};
