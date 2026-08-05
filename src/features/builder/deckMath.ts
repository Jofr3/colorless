// Pure deck arithmetic: counts, grouping, type distribution and format
// legality. No React, no I/O — everything here is a function of a DeckEntry[],
// so it's trivially unit-tested and reused by the UI without duplication.

import {
  ACE_SPEC_LIMIT,
  type BuilderCard,
  type EnergyType,
  ENERGY_TYPES,
  type Format,
  isAceSpec,
  isBasicEnergy,
  isBasicPokemon,
  isLegalInFormat,
  isPrismStar,
  isRadiantPokemon,
  RADIANT_LIMIT,
  type Supertype,
} from "./cards";

/** A card in the deck plus how many copies. The deck is an ordered list of
    these — order is insertion order, which the UI preserves within each group. */
export interface DeckEntry {
  card: BuilderCard;
  quantity: number;
}

export type Deck = DeckEntry[];

/** Total number of cards (sum of quantities). */
export function totalCount(deck: Deck): number {
  return deck.reduce((sum, e) => sum + e.quantity, 0);
}

/** Copies broken down by the three supertypes. */
export function countsBySupertype(deck: Deck): Record<Supertype, number> {
  const counts: Record<Supertype, number> = { Pokémon: 0, Trainer: 0, Energy: 0 };
  for (const { card, quantity } of deck) counts[card.supertype] += quantity;
  return counts;
}

/** Copies of each card name (different prints of the same name sum together) —
    the basis of the 4-copies-per-name rule. */
export function copiesByName(deck: Deck): Map<string, number> {
  const byName = new Map<string, number>();
  for (const { card, quantity } of deck) {
    byName.set(card.name, (byName.get(card.name) ?? 0) + quantity);
  }
  return byName;
}

/** Number of Basic Pokémon copies — a legal deck needs at least one. */
export function basicPokemonCount(deck: Deck): number {
  return deck.reduce((sum, e) => sum + (isBasicPokemon(e.card) ? e.quantity : 0), 0);
}

/** Copies of each energy type across the Pokémon in the deck, attributed to
    each type a Pokémon carries (almost always one). Drives the type-distribution
    bar. Returned in canonical wheel order, omitting types with no copies. */
export function pokemonTypeDistribution(deck: Deck): { type: EnergyType; count: number }[] {
  const counts = new Map<EnergyType, number>();
  for (const { card, quantity } of deck) {
    if (card.supertype !== "Pokémon" || !card.types) continue;
    for (const t of card.types) counts.set(t, (counts.get(t) ?? 0) + quantity);
  }
  return ENERGY_TYPES.map((type) => ({ type, count: counts.get(type) ?? 0 })).filter(
    (e) => e.count > 0,
  );
}

/** Copies of all ACE SPEC cards combined — the deck may hold only one. */
export function aceSpecCount(deck: Deck): number {
  return deck.reduce((sum, e) => sum + (isAceSpec(e.card) ? e.quantity : 0), 0);
}

/** Copies of all Radiant Pokémon combined — the deck may hold only one. */
export function radiantCount(deck: Deck): number {
  return deck.reduce((sum, e) => sum + (isRadiantPokemon(e.card) ? e.quantity : 0), 0);
}

/** The server's per-entry copy cap (deckCardSchema: count ≤ 99) — the add
    guard below and the decklist-import clamp both stop there, so the builder
    can never assemble a deck whose PATCH the api rejects with a 400. */
export const MAX_COPIES_PER_ENTRY = 99;

/** Remaining copies under a deck-wide single-slot rule (ACE SPEC, Radiant):
    a DIFFERENT card already filling the slot blocks this one entirely;
    otherwise the card's own copies count against the limit. */
function deckWideRemaining(total: number, own: number, limit: number): number {
  return total - own > 0 ? 0 : Math.max(0, limit - own);
}

/** Build a fast "how many more of this card may I add?" function bound to the
    current deck + format. Computes the per-name and deck-wide tallies once, so
    the grid can ask for every pool card without re-summing the deck each time.
    Basic Energy has no per-name game rule but stops at the server's 99-copy
    cap; ACE SPECs and Radiant Pokémon are each capped at one *in total* across
    the whole deck; Prism Star cards at one per name; everything else at the
    format's per-name limit. */
export function remainingAllowedFor(deck: Deck, format: Format): (card: BuilderCard) => number {
  const names = copiesByName(deck);
  const aceTotal = aceSpecCount(deck);
  const radiantTotal = radiantCount(deck);
  return (card) => {
    if (isBasicEnergy(card)) {
      return Math.max(0, MAX_COPIES_PER_ENTRY - (names.get(card.name) ?? 0));
    }
    const own = names.get(card.name) ?? 0;
    if (isAceSpec(card)) return deckWideRemaining(aceTotal, own, ACE_SPEC_LIMIT);
    if (isRadiantPokemon(card)) return deckWideRemaining(radiantTotal, own, RADIANT_LIMIT);
    if (isPrismStar(card)) return Math.max(0, 1 - own);
    return Math.max(0, format.maxCopiesByName - own);
  };
}

/** Single-shot convenience wrapper around {@link remainingAllowedFor}. */
export function remainingAllowed(deck: Deck, card: BuilderCard, format: Format): number {
  return remainingAllowedFor(deck, format)(card);
}

export interface DeckIssue {
  level: "error" | "warning";
  message: string;
}

export interface DeckValidation {
  total: number;
  deckSize: number;
  /** total === deckSize. */
  complete: boolean;
  /** Complete *and* free of error-level issues — i.e. tournament-legal. */
  legal: boolean;
  issues: DeckIssue[];
}

/** Validate a deck against a format. Errors are hard illegalities (over the
    size, over the copy limit — 1 per Prism Star name, ACE SPEC and Radiant
    each over their deck-wide slot, no Basic Pokémon, an out-of-format card);
    the under-60 state is surfaced as a warning so a half-built deck doesn't
    scream red while you work. `legal` requires completeness and zero errors. */
export function validateDeck(deck: Deck, format: Format): DeckValidation {
  const total = totalCount(deck);
  const deckSize = format.deckSize;
  const issues: DeckIssue[] = [];

  if (total > deckSize) {
    issues.push({ level: "error", message: `Deck has ${total} cards — ${deckSize} is the limit.` });
  } else if (total < deckSize) {
    const missing = deckSize - total;
    issues.push({
      level: "warning",
      message: `${missing} more ${missing === 1 ? "card" : "cards"} to reach ${deckSize}.`,
    });
  }

  for (const [name, count] of copiesByName(deck)) {
    // Any print of the name serves — the classes below are name-defined, so
    // every print of a name shares them.
    const card = deck.find((e) => e.card.name === name)?.card;
    if (card === undefined) continue; // Unreachable: the name came from the deck.
    // Basic Energy is exempt from the per-name cap; ACE SPECs and Radiant
    // Pokémon are governed by their deck-wide rules below, so skip them here
    // to avoid a redundant (and wrongly "max 4"-worded) message.
    if (isBasicEnergy(card) || isAceSpec(card) || isRadiantPokemon(card)) continue;
    // Prism Star: one copy of the name, superseding the format cap.
    if (isPrismStar(card)) {
      if (count > 1) {
        issues.push({
          level: "error",
          message: `${count} copies of ${name} — Prism Star cards are limited to 1.`,
        });
      }
    } else if (count > format.maxCopiesByName) {
      issues.push({
        level: "error",
        message: `${count} copies of ${name} — max ${format.maxCopiesByName}.`,
      });
    }
  }

  if (basicPokemonCount(deck) < format.minBasicPokemon) {
    issues.push({
      level: "error",
      message: `Add at least ${format.minBasicPokemon} Basic Pokémon.`,
    });
  }

  const aceTotal = aceSpecCount(deck);
  if (aceTotal > ACE_SPEC_LIMIT) {
    issues.push({
      level: "error",
      message: `${aceTotal} ACE SPEC cards — only ${ACE_SPEC_LIMIT} is allowed.`,
    });
  }

  const radiantTotal = radiantCount(deck);
  if (radiantTotal > RADIANT_LIMIT) {
    issues.push({
      level: "error",
      message: `${radiantTotal} Radiant Pokémon — only ${RADIANT_LIMIT} is allowed.`,
    });
  }

  // Format legality: the catalog's structured `card.legal` verdict, via the
  // format's legalFlag — the only mechanism, with no printed-mark path behind
  // it (D191). See isLegalInFormat.
  const illegal = new Set<string>();
  for (const { card } of deck) {
    if (!isLegalInFormat(card, format)) illegal.add(card.name);
  }
  for (const name of illegal) {
    issues.push({ level: "error", message: `${name} is not legal in ${format.name}.` });
  }

  const complete = total === deckSize;
  const legal = complete && !issues.some((i) => i.level === "error");
  return { total, deckSize, complete, legal, issues };
}
