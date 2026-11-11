// Pure deck arithmetic: counts, grouping and type distribution, plus the
// builder's view of the engine's construction rules (deckRules.ts). No I/O —
// everything here is a function of a DeckEntry[], so it's trivially
// unit-tested and reused by the UI without duplication.

import {
  ACE_SPEC_LIMIT,
  contentReasons,
  copyLimitReason,
  type DeckRuleEntry,
  type Format,
  isAceSpec,
  isLegalInFormat,
  isPrismStar,
  isRadiantPokemon,
  PRISM_STAR_LIMIT,
  RADIANT_LIMIT,
} from "@colorless/engine/rules";
import {
  type BuilderCard,
  deckRuleCardOf,
  isBuilderBasicEnergy,
  isBuilderBasicPokemon,
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
  return deck.reduce((sum, e) => sum + (isBuilderBasicPokemon(e.card) ? e.quantity : 0), 0);
}

function ruleEntriesOf(deck: Deck): DeckRuleEntry[] {
  return deck.map((e) => ({ card: deckRuleCardOf(e.card), count: e.quantity }));
}

function copiesWhere(deck: Deck, test: (card: BuilderCard) => boolean): number {
  return deck.reduce((sum, e) => sum + (test(e.card) ? e.quantity : 0), 0);
}

const isRadiant = (card: BuilderCard) => isRadiantPokemon(deckRuleCardOf(card));

/** The server's per-entry copy cap (deckCardSchema: count ≤ 99) — the add
    guard below and the decklist-import clamp both stop there, so the builder
    can never assemble a deck whose PATCH the api rejects with a 400. */
const MAX_COPIES_PER_ENTRY = 99;

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
  const aceTotal = copiesWhere(deck, isAceSpec);
  const radiantTotal = copiesWhere(deck, isRadiant);
  return (card) => {
    if (isBuilderBasicEnergy(card)) {
      return Math.max(0, MAX_COPIES_PER_ENTRY - (names.get(card.name) ?? 0));
    }
    const own = names.get(card.name) ?? 0;
    if (isAceSpec(card)) return deckWideRemaining(aceTotal, own, ACE_SPEC_LIMIT);
    if (isRadiant(card)) return deckWideRemaining(radiantTotal, own, RADIANT_LIMIT);
    if (isPrismStar(card)) return Math.max(0, PRISM_STAR_LIMIT - own);
    return Math.max(0, format.maxCopiesByName - own);
  };
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

/** Names of deck entries that are illegal on their own: not legal in the
    format, or holding more copies than their name allows. Deck-wide rules
    (size, Basic count, ACE SPEC / Radiant totals) belong to the deck, not to
    a card, so they are not attributed here. Drives the per-row "!" alert. */
export function illegalCardNames(deck: Deck, format: Format): Set<string> {
  const names = new Set<string>();
  for (const [name, count] of copiesByName(deck)) {
    const card = deck.find((e) => e.card.name === name)?.card;
    if (card === undefined) continue;
    if (
      !isLegalInFormat(card, format) ||
      copyLimitReason(deckRuleCardOf(card), count, format) !== null
    ) {
      names.add(name);
    }
  }
  return names;
}

/** Validate a deck against a format: the engine's construction rules as
    errors, with the deck size judged here so the under-size state is a
    warning and a half-built deck doesn't scream red while you work. `legal`
    requires completeness and zero errors, the engine's `validateDeck`
    verdict. */
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
  for (const message of contentReasons(ruleEntriesOf(deck), format)) {
    issues.push({ level: "error", message });
  }

  const complete = total === deckSize;
  const legal = complete && !issues.some((i) => i.level === "error");
  return { total, deckSize, complete, legal, issues };
}
