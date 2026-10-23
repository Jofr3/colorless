// Test-only, not exported from the package index; nothing at runtime reads this file.

/**
 * The registry surfaces `programFor` covers. There is no "attack" member because attacks are built
 * by a deriver, not a row.
 */
export type RefusalSurface = "trainer" | "tool" | "ability" | "passive" | "specialEnergy";

/** One printing whose REGISTRY-surface program is refused at HEAD, and the doc
    block that says so. */
export type RefusedPrinting = {
  /** The printed card id, exactly as the catalog spells it. */
  readonly id: string;
  /** The card, for the red line to be readable without a lookup. */
  readonly card: string;
  /** Which surface is refused — the oracle's scope (limit 1 above). */
  readonly surface: RefusalSurface;
  /** Why, in the vocabulary of the doc block cited below. */
  readonly why: string;
  /** The decision that recorded the refusal. */
  readonly since: string;
  /** Where the claim is written. `excerpt` must be a single line occurring
      EXACTLY ONCE in `file` and must itself name `id` — a line number rots
      silently, a unique string rots loudly (`mutants.ts`'s rule, borrowed). */
  readonly cite: { readonly file: string; readonly excerpt: string };
};

/**
 * Printings asserted unbuilt on their named surface; building one without deleting its row fails
 * `refusedPrintings.test.ts`.
 */
export const REFUSED_PRINTINGS: readonly RefusedPrinting[] = [
  {
    id: "sv01-127",
    card: 'Muk "Poison Sacs"',
    surface: "ability",
    why: 'The NEGATIVE form of the status-clear family — a modifier on §10\'s evolution clear (turn.ts, `reason: "evolved"`) carrying no op and no moment of its own. Refused as "a rule about a clear this op never performs", and named rather than left so the next census greps the repo and finds it already counted (D171\'s Corviknight rule).',
    since: "D171",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: '// Muk sv01-127 "Poison Sacs": "Your opponent\'s Poisoned Pokémon don\'t recover',
    },
  },
];

/** Whether `excerpt` actually names `id`, guarding against typos. */
export function excerptNamesId(excerpt: string, id: string): boolean {
  const split = id.lastIndexOf("-");
  if (split <= 0) return false;
  const set = id.slice(0, split);
  const number = id.slice(split);
  return excerpt.includes(id) || (excerpt.includes(set) && excerpt.includes(number));
}

/** One printing a doc block DID refuse and that is built at HEAD, with the
    correction that records it. */
export type ResolvedRefusal = {
  readonly id: string;
  readonly card: string;
  /** The decision that actually shipped the row. */
  readonly builtBy: string;
  /** The decision whose refusal this falsifies. */
  readonly refusedBy: string;
  /** The DATED CORRECTION, not the refusal — `cite.excerpt` must occur exactly
      once in `cite.file`. Deleting the stamp, or reverting the file to the state
      in which the refusal stood alone, goes red. */
  readonly cite: { readonly file: string; readonly excerpt: string };
};

/** Printings found already built behind a stale refusal, asserted built. */
export const RESOLVED_REFUSALS: readonly ResolvedRefusal[] = [
  {
    id: "sv06-165",
    card: "Unfair Stamp",
    builtBy: "D271",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/registry.ts",
      excerpt: "    🛑🛑 **D480 — THE PARAGRAPH ABOVE IS FALSE AT HEAD, AND ITS REFUTATION IS IN",
    },
  },
  {
    id: "sv10-170",
    card: "Team Rocket's Archer",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: "      🛑🛑 **D480 — THE PARAGRAPH DIRECTLY ABOVE IS D479'S OWN CORRECTION, AND ITS",
    },
  },
  {
    id: "sv10-223",
    card: "Team Rocket's Archer (alternate art)",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
    cite: {
      file: "packages/engine/src/effects.ts",
      excerpt: "    🛑 **D480 — THE WORD `unbuilt-but-same-shape` FOUR LINES UP IS FALSE, AND HAS",
    },
  },
];
