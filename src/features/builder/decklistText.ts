// Import/export of the plain-text decklist format every Pokémon TCG tool speaks
// (PTCG Live, Limitless, the official site): grouped "{qty} {Name} {SET} {num}"
// lines under "Pokémon:/Trainer:/Energy:" headers. Parsing and formatting are
// pure string functions; resolving parsed names to real cards is injected
// (`resolveDecklist` takes a name → card lookup — the builder wires it to the
// catalog api in catalog.ts), so everything here unit-tests without a network.
// Import stays tolerant (set/number optional, headers and totals ignored,
// matched by normalized name) and export canonical.

import { type BuilderCard, SUPERTYPES } from "./cards";
import type { Deck, DeckEntry } from "./deckMath";

/** A "<qty> <name…>" card line lifted from the pasted text. */
export interface DecklistLine {
  quantity: number;
  /** Everything after the quantity — possibly still carrying "SET NUM". */
  name: string;
  raw: string;
}

/** A decklist line we couldn't resolve to a catalog card. */
export interface UnmatchedLine {
  quantity: number;
  name: string;
  raw: string;
}

export interface ImportResult {
  entries: DeckEntry[];
  unmatched: UnmatchedLine[];
}

/** Collapse to a stable match key: lowercased, whitespace-collapsed, with the
    decorative bits that drift between exporters removed. Doubles as the
    catalog lookup term for a line (the api's `nameExact` match is ASCII
    case-insensitive whole-name equality, so the lowercasing is harmless
    there). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^basic\s+/, "") // "Basic Fire Energy" === "Fire Energy"
    .trim();
}

// A card line starts with a quantity; everything after is the name, possibly
// with a trailing set code + collector number ("SVI 189", "PR-SV 50").
const QTY_RE = /^(\d+)\s+(.+)$/;
// Peels a trailing "<SET> <NUM>" off a name. A set token is short (2–6 chars);
// the captured head is what's left. Only applied when the FULL name fails to
// resolve, so a real ending like "… ex" / "Boss's Orders" isn't shaved off.
const TRAILING_SET_RE = /^(.*?)\s+[A-Za-z][A-Za-z0-9-]{1,5}\s+[A-Za-z0-9]{1,4}$/;

/** Parse a text decklist into its card lines. Header lines ("Pokémon: 12",
    "Total Cards: 60") and anything not starting with a quantity are ignored;
    what a line's name means is the resolver's problem. */
export function parseDecklist(text: string): DecklistLine[] {
  const lines: DecklistLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(QTY_RE);
    // Not "<n> …" — a header, total, comment or blank-ish line. Skip it.
    if (!m) continue;
    const quantity = Number.parseInt(m[1] ?? "", 10);
    const name = (m[2] ?? "").trim();
    if (!Number.isFinite(quantity) || quantity <= 0 || !name) continue;
    lines.push({ quantity, name, raw: line });
  }
  return lines;
}

/** Resolve parsed lines to cards through `findByName` (an exact-by-normalized-
    name lookup — the catalog-backed one lives in catalog.ts). Quantities for
    the same card are summed; unresolved lines are returned so the UI can
    report them; a lookup that THROWS (network/api failure) rejects the whole
    import rather than mislabeling cards as unmatched.

    Resolution tries the WHOLE remainder as a name first, and only strips a
    trailing set+number if that misses — otherwise "4 Iron Hands ex" (no set)
    would be misread as name "Iron" + set "Hands" + number "ex" and dropped.
    Lookups are memoized by normalized name and warmed in parallel, so a
    60-card list costs one round trip per unique name, not per line. */
export async function resolveDecklist(
  lines: DecklistLine[],
  findByName: (name: string) => Promise<BuilderCard | undefined>,
): Promise<ImportResult> {
  const cache = new Map<string, Promise<BuilderCard | undefined>>();
  const lookup = (name: string): Promise<BuilderCard | undefined> => {
    const key = nameKey(name);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = findByName(name);
    cache.set(key, pending);
    return pending;
  };

  // Warm the full-name lookups concurrently; the per-line pass below then
  // resolves from cache (stripped-name retries are the rare second wave).
  await Promise.all(lines.map((line) => lookup(line.name)));

  const merged = new Map<string, DeckEntry>();
  const unmatched: UnmatchedLine[] = [];

  for (const line of lines) {
    let card = await lookup(line.name);
    let name = line.name;
    if (!card) {
      // Strip a trailing set+number and retry; keep the stripped form as the
      // reported name even when it still doesn't resolve.
      const stripped = TRAILING_SET_RE.exec(line.name)?.[1]?.trim();
      if (stripped) {
        name = stripped;
        card = await lookup(stripped);
      }
    }

    if (!card) {
      unmatched.push({ quantity: line.quantity, name, raw: line.raw });
      continue;
    }
    const existing = merged.get(card.cardId);
    if (existing) existing.quantity += line.quantity;
    else merged.set(card.cardId, { card, quantity: line.quantity });
  }

  return { entries: [...merged.values()], unmatched };
}

/** Set code + collector number for a card, e.g. "SV06.5 001" — derived from
    the tcgdex id when the explicit number is missing. Used on export and as a
    subtle on-tile caption. */
export function cardSetLabel(card: BuilderCard): string {
  const [setPart, numPart] = card.cardId.split("-");
  const set = (setPart ?? card.cardId).toUpperCase();
  const number = card.number ?? numPart ?? "";
  return number ? `${set} ${number}` : set;
}

/** Render a deck as the canonical grouped text format. */
export function formatDecklist(deck: Deck): string {
  const lines: string[] = [];
  for (const supertype of SUPERTYPES) {
    const group = deck.filter((e) => e.card.supertype === supertype);
    if (group.length === 0) continue;
    const subtotal = group.reduce((sum, e) => sum + e.quantity, 0);
    if (lines.length > 0) lines.push("");
    lines.push(`${supertype}: ${subtotal}`);
    for (const { card, quantity } of group) {
      lines.push(`${quantity} ${card.name} ${cardSetLabel(card)}`.trimEnd());
    }
  }
  const total = deck.reduce((sum, e) => sum + e.quantity, 0);
  if (lines.length > 0) lines.push("");
  lines.push(`Total Cards: ${total}`);
  return lines.join("\n");
}
