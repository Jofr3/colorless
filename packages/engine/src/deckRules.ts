// Deck construction (rules §3.1): formats, the card classes the rules single out, and the one
// verdict on whether a deck may be played in a format. Online matches refuse a deck this rejects;
// local play runs any deck `createGame` accepts.

import type { Card } from "@colorless/schema";
import { type EnergyFace, isBasicEnergy, isBasicPokemon } from "./cardClasses";
import { DECK_SIZE } from "./types";

export interface Format {
  id: string;
  name: string;
  /** Required deck size. */
  deckSize: number;
  /** Max copies of any one card by name (Basic Energy is exempt). */
  maxCopiesByName: number;
  /** Minimum Basic Pokémon a legal deck must contain. */
  minBasicPokemon: number;
  /** The `card.legal` flag this format reads, which is also GET /cards' `legal` param, so the
      validator and the builder's legal-only filter read the same bit. Undefined means every card
      is legal. */
  legalFlag?: "standard" | "expanded";
  description: string;
}

const STANDARD_FORMAT: Format = {
  id: "standard",
  name: "Standard",
  deckSize: DECK_SIZE,
  maxCopiesByName: 4,
  minBasicPokemon: 1,
  legalFlag: "standard",
  description: "Most recent sets — the default tournament format.",
};

export const FORMATS: readonly Format[] = [
  STANDARD_FORMAT,
  {
    id: "expanded",
    name: "Expanded",
    deckSize: DECK_SIZE,
    maxCopiesByName: 4,
    minBasicPokemon: 1,
    legalFlag: "expanded",
    description: "Black & White onward — a far wider card pool.",
  },
];

export const DEFAULT_FORMAT = STANDARD_FORMAT;

/** A format by id. A deck with no format, or one this build doesn't know, plays Standard. */
export function formatById(id: string | null): Format {
  return FORMATS.find((f) => f.id === id) ?? DEFAULT_FORMAT;
}

/** The card fields the deck rules read. A full `Card` and a catalog brief both carry them. */
export type DeckRuleCard = Pick<Card, "name" | "category" | "stage" | "rarity" | "legal"> &
  EnergyFace;

export interface DeckRuleEntry {
  card: DeckRuleCard;
  count: number;
}

/** The most copies of all ACE SPEC cards combined a deck may hold. */
export const ACE_SPEC_LIMIT = 1;

/** The most Radiant Pokémon, across every name, a deck may hold. */
export const RADIANT_LIMIT = 1;

/** The most copies of one Prism Star name a deck may hold. */
export const PRISM_STAR_LIMIT = 1;

/** An ACE SPEC card, marked by its rarity (the catalog spells it "ACE SPEC Rare"). */
export function isAceSpec(card: { rarity?: string | null } | undefined): boolean {
  return (card?.rarity ?? "").includes("ACE SPEC");
}

// Radiant and Prism Star are classes the game defines by name ("Radiant X", "X ◇"), so a name
// check is the structured detection.

export function isRadiantPokemon(card: Pick<Card, "category" | "name">): boolean {
  return card.category === "Pokemon" && card.name.startsWith("Radiant ");
}

/** tcgdex prints the "◇" suffix; the spelled-out form covers other decklist sources. */
export function isPrismStar(card: Pick<Card, "name">): boolean {
  return card.name.includes("◇") || card.name.endsWith(" Prism Star");
}

/** The catalog's verdict for `format`; there is no printed-mark fallback. */
export function isLegalInFormat(card: Pick<Card, "legal">, format: Format): boolean {
  if (format.legalFlag === undefined) return true;
  return card.legal[format.legalFlag];
}

/** Copies per card name, every print of a name counting together, with one card of each name. */
function namesOf(
  entries: readonly DeckRuleEntry[],
): Map<string, { card: DeckRuleCard; count: number }> {
  const byName = new Map<string, { card: DeckRuleCard; count: number }>();
  for (const { card, count } of entries) {
    const seen = byName.get(card.name);
    byName.set(card.name, { card: seen?.card ?? card, count: (seen?.count ?? 0) + count });
  }
  return byName;
}

/**
 * Why `count` copies of `card`'s name break the per-name limit, or null. Basic Energy is exempt,
 * and ACE SPEC and Radiant cards answer to their deck-wide limits instead.
 */
export function copyLimitReason(card: DeckRuleCard, count: number, format: Format): string | null {
  if (isBasicEnergy(card) || isAceSpec(card) || isRadiantPokemon(card)) return null;
  if (isPrismStar(card)) {
    return count > PRISM_STAR_LIMIT
      ? `${count} copies of ${card.name} — Prism Star cards are limited to ${PRISM_STAR_LIMIT}.`
      : null;
  }
  return count > format.maxCopiesByName
    ? `${count} copies of ${card.name} — max ${format.maxCopiesByName}.`
    : null;
}

function copiesWhere(entries: readonly DeckRuleEntry[], test: (card: DeckRuleCard) => boolean) {
  return entries.reduce((sum, e) => sum + (test(e.card) ? e.count : 0), 0);
}

/**
 * Every construction rule except the deck size: per-name copies, the Basic Pokémon minimum, the
 * ACE SPEC and Radiant limits, and the format's card pool.
 */
export function contentReasons(entries: readonly DeckRuleEntry[], format: Format): string[] {
  const reasons: string[] = [];
  for (const { card, count } of namesOf(entries).values()) {
    const reason = copyLimitReason(card, count, format);
    if (reason !== null) reasons.push(reason);
  }
  if (copiesWhere(entries, isBasicPokemon) < format.minBasicPokemon) {
    reasons.push(`Add at least ${format.minBasicPokemon} Basic Pokémon.`);
  }
  const aceSpecs = copiesWhere(entries, isAceSpec);
  if (aceSpecs > ACE_SPEC_LIMIT) {
    reasons.push(`${aceSpecs} ACE SPEC cards — only ${ACE_SPEC_LIMIT} is allowed.`);
  }
  const radiants = copiesWhere(entries, isRadiantPokemon);
  if (radiants > RADIANT_LIMIT) {
    reasons.push(`${radiants} Radiant Pokémon — only ${RADIANT_LIMIT} is allowed.`);
  }
  const outOfFormat = new Set<string>();
  for (const { card } of entries) if (!isLegalInFormat(card, format)) outOfFormat.add(card.name);
  for (const name of outOfFormat) reasons.push(`${name} is not legal in ${format.name}.`);
  return reasons;
}

/** Why the deck can't be played in `format`; empty when it is legal. */
export function validateDeck(entries: readonly DeckRuleEntry[], format: Format): string[] {
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const size =
    total === format.deckSize
      ? []
      : [`The deck has ${total} cards — it needs exactly ${format.deckSize}.`];
  return [...size, ...contentReasons(entries, format)];
}

/**
 * Why a saved deck can't be played in its own format, a null format reading as the default. Its
 * cards are looked up in `pool`; one missing there is a reason of its own.
 */
export function savedDeckReasons(
  cards: readonly { cardId: string; count: number }[],
  format: string | null,
  pool: Readonly<Record<string, Card>>,
): string[] {
  const entries: DeckRuleEntry[] = [];
  for (const { cardId, count } of cards) {
    const card = Object.hasOwn(pool, cardId) ? pool[cardId] : undefined;
    if (card === undefined) return ["The deck has a card that's no longer in the catalog."];
    entries.push({ card, count });
  }
  return validateDeck(entries, formatById(format));
}
