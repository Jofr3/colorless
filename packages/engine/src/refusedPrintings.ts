// Test-only, not exported from the package index; nothing at runtime reads this file.

/**
 * The registry surfaces `programFor` covers. There is no "attack" member because attacks are built
 * by a deriver, not a row.
 */
type RefusalSurface = "trainer" | "tool" | "ability" | "passive" | "specialEnergy";

/** One printing whose REGISTRY-surface program is refused at HEAD. */
export type RefusedPrinting = {
  /** The printed card id, exactly as the catalog spells it. */
  readonly id: string;
  /** The card, for the red line to be readable without a lookup. */
  readonly card: string;
  /** Which surface is refused. */
  readonly surface: RefusalSurface;
  readonly why: string;
  /** The decision that recorded the refusal. */
  readonly since: string;
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
  },
];

/** One printing a stale refusal named that is built at HEAD. */
type ResolvedRefusal = {
  readonly id: string;
  readonly card: string;
  /** The decision that actually shipped the row. */
  readonly builtBy: string;
  /** The decision whose refusal this falsifies. */
  readonly refusedBy: string;
};

/** Printings found already built behind a stale refusal, asserted built. */
export const RESOLVED_REFUSALS: readonly ResolvedRefusal[] = [
  {
    id: "sv06-165",
    card: "Unfair Stamp",
    builtBy: "D271",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
  },
  {
    id: "sv10-170",
    card: "Team Rocket's Archer",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
  },
  {
    id: "sv10-223",
    card: "Team Rocket's Archer (alternate art)",
    builtBy: "D326",
    refusedBy: "D270 (registry.ts `HARLEQUIN`, effects.ts `handRefresh`), re-asserted by D479",
  },
];
