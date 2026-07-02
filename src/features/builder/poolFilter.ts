// Pure search / filter / sort over the card pool — the function behind the
// centre grid. Kept out of the component so it's unit-tested and so a heavy
// pool can be memoised on the inputs without React in the way.

import {
  type BuilderCard,
  cardMatchesCategories,
  type EnergyType,
  type Rarity,
  type Supertype,
} from "./cards";

export type SortKey = "name" | "hp-desc" | "set";

export interface Filters {
  /** Free-text name / set / id search. */
  query: string;
  /** "all" or one supertype. */
  supertype: "all" | Supertype;
  /** Selected energy types; empty means no type restriction. */
  types: EnergyType[];
  /** Selected subtypes (Basic / Stage 1 / Item / Supporter / …); empty = all. */
  subtypes: string[];
  /** Selected rarities (Common / Uncommon / Double Rare / …); empty = all. */
  rarities: Rarity[];
  /** Hide cards illegal in the active format (by regulation mark). On by default
      so the grid can't be filled with rotated-out cards; only bites when the
      format actually restricts marks (Standard, not Expanded). */
  legalOnly: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  supertype: "all",
  types: [],
  subtypes: [],
  rarities: [],
  legalOnly: true,
  sort: "name",
};

/** True when a filter deviates from the defaults — used to show a "reset"
    affordance only when it would do something (sort is excluded). */
export function filtersActive(filters: Filters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.supertype !== "all" ||
    filters.types.length > 0 ||
    filters.subtypes.length > 0 ||
    filters.rarities.length > 0 ||
    !filters.legalOnly
  );
}

function matches(card: BuilderCard, filters: Filters, legalMarks?: string[]): boolean {
  if (filters.supertype !== "all" && card.supertype !== filters.supertype) return false;

  if (filters.types.length > 0) {
    // A type filter only keeps cards that carry one of the chosen types — so
    // untyped Trainers drop out, which is the intent of picking an energy type.
    if (!card.types?.some((t) => filters.types.includes(t))) return false;
  }

  if (filters.subtypes.length > 0 && !cardMatchesCategories(card, filters.subtypes)) return false;

  if (
    filters.rarities.length > 0 &&
    (card.rarity === undefined || !filters.rarities.includes(card.rarity))
  ) {
    return false;
  }

  // Format legality (only when the format restricts marks and the toggle is on).
  // An unmarked card (basic Energy) is always legal.
  if (
    filters.legalOnly &&
    legalMarks &&
    card.regulationMark &&
    !legalMarks.includes(card.regulationMark)
  ) {
    return false;
  }

  const q = filters.query.trim().toLowerCase();
  if (q) {
    const haystack = `${card.name} ${card.setName ?? ""} ${card.cardId}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function compare(a: BuilderCard, b: BuilderCard, sort: SortKey): number {
  if (sort === "hp-desc") {
    const d = (b.hp ?? -1) - (a.hp ?? -1);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  }
  if (sort === "set") {
    const setCmp = (a.setName ?? "").localeCompare(b.setName ?? "");
    if (setCmp !== 0) return setCmp;
    const an = Number.parseInt(a.number ?? "0", 10);
    const bn = Number.parseInt(b.number ?? "0", 10);
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

/** Apply a filter set to the pool and return a sorted copy (never mutates).
    `legalMarks` (the active format's legal regulation marks, if any) powers the
    `legalOnly` toggle. */
export function filterPool(
  pool: BuilderCard[],
  filters: Filters,
  legalMarks?: string[],
): BuilderCard[] {
  return pool
    .filter((card) => matches(card, filters, legalMarks))
    .sort((a, b) => compare(a, b, filters.sort));
}
