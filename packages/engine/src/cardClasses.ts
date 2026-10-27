// The card classes deck rules and play both read, kept apart from cards.ts so deck-only code
// (@colorless/engine/rules) loads without the rest of the engine.

import type { Card } from "@colorless/schema";

/** `stage` uses the tcgdex vocabulary ("Basic" | "Stage1" | "Stage2" | …). */
export function isBasicPokemon(card: Pick<Card, "category" | "stage">): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

/**
 * A Special Energy (§6.1): tagged "Special", or printing rules text. tcgdex tags some Special
 * Energies "Normal", and Basic Energy prints no rules text. An unauthored Special Energy degrades
 * to a plain Colorless provider.
 */
export function isSpecialEnergy(card: EnergyFace): boolean {
  return card.category === "Energy" && (card.energyType === "Special" || printsRulesText(card));
}

/**
 * The face fields the Basic/Special Energy test reads, so callers without a whole `Card` can use
 * it. A missing `effect` reads as no rules text.
 */
export type EnergyFace = Pick<Card, "category" | "energyType"> & {
  effect?: Card["effect"] | undefined;
};

/** A Basic Energy card (§6.1): tagged "Normal" and printing no rules text. */
export function isBasicEnergy(card: EnergyFace): boolean {
  return card.category === "Energy" && card.energyType === "Normal" && !isSpecialEnergy(card);
}

function printsRulesText(card: EnergyFace): boolean {
  return (card.effect ?? "").trim() !== "";
}
