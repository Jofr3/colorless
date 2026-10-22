// Import/export of the plain-text decklist format every Pokémon TCG tool speaks
// (PTCG Live, Limitless, the official site): grouped "{qty} {Name} {SET} {num}"
// lines under "Pokémon:/Trainer:/Energy:" headers. Parsing and formatting are
// pure string functions; resolving parsed names to real cards is injected
// (`resolveDecklist` takes a name → prints lookup — the builder wires it to
// the catalog api in catalog.ts), so everything here unit-tests without a
// network. Import stays tolerant (set/number optional, headers and totals
// ignored, matched by normalized name; a trailing set code + number picks the
// print among a name's reprints) and export canonical.

import { type BuilderCard, isBasicEnergy, SUPERTYPES } from "./cards";
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

/** The print a line names: its trailing set code and collector number. */
export interface PrintRef {
  set: string;
  number: string;
}

export interface ResolveOptions {
  /** Maps a decklist set code ("PRE", or our own export's "SV08.5") to a
      catalog set id; undefined when the code is unknown. May be async (the
      builder's map comes from GET /sets). Without it only the upper-cased
      set id form of a code can match. */
  setIdForCode?: (code: string) => string | undefined | Promise<string | undefined>;
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
// Peels a trailing "<SET> <NUM>" off a name. A set token is short (2–7 chars,
// "PRE", "PR-SV" or our export's "SV10.5B"); the captured head is what's
// left. Only applied when the FULL name fails to resolve, so a real ending
// like "… ex" / "Boss's Orders" isn't shaved off.
const TRAILING_SET_RE = /^(.*?)\s+([A-Za-z][A-Za-z0-9.-]{1,6})\s+([A-Za-z0-9]{1,4})$/;

/** Peel a trailing set code + collector number off a line's name. */
function splitPrint(name: string): { name: string; print?: PrintRef } {
  const m = TRAILING_SET_RE.exec(name);
  if (!m?.[1] || !m[2] || !m[3]) return { name };
  return { name: m[1].trim(), print: { set: m[2], number: m[3] } };
}

/** Collector numbers compare without leading zeros or case: "080" is "80". */
export function numberKey(number: string): string {
  return number.toUpperCase().replace(/^0+(?=.)/, "");
}

/** A tcgdex card id is "<set>-<number>"; set ids can carry hyphens ("30th-c"). */
export function splitCardId(cardId: string): { set: string; number: string } {
  const at = cardId.lastIndexOf("-");
  return at < 0 ? { set: cardId, number: "" } : { set: cardId.slice(0, at), number: cardId.slice(at + 1) };
}

/** Pick the print a line asked for among a name's reprints: the one in the
    named set (`wantedSetId`, or the code read as an upper-cased set id) with
    the named number; failing that any print in that set; and failing that
    the first print, which is also the answer when the line names no set. */
export function choosePrint(
  prints: BuilderCard[],
  print: PrintRef | undefined,
  wantedSetId?: string,
): BuilderCard | undefined {
  const first = prints[0];
  if (first === undefined || prints.length === 1 || print === undefined) return first;
  const code = print.set.toUpperCase();
  const wanted = wantedSetId;
  const inSet = prints.filter((card) => {
    const set = splitCardId(card.cardId).set;
    return set === wanted || set.toUpperCase() === code;
  });
  const number = numberKey(print.number);
  return (
    inSet.find((card) => numberKey(card.number ?? splitCardId(card.cardId).number) === number) ??
    inSet[0] ??
    first
  );
}

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

/** Basic Energy prints are interchangeable (always legal, no copy cap), and
    tcgdex has no art for the energy-only sets (sve, mee, mfb). So when the
    chosen print has no art, a print with art stands in — in practice the sv
    full-art "Basic X Energy" of the same type. Other cards keep the print
    they named: a different print may be a different card. */
export function preferArt(prints: BuilderCard[], card: BuilderCard): BuilderCard {
  if (!isBasicEnergy(card) || card.hasImage !== false) return card;
  return prints.find((print) => isBasicEnergy(print) && print.hasImage === true) ?? card;
}

/** Resolve parsed lines to cards through `findPrints` (every print of an
    exact-by-normalized-name lookup — the catalog-backed one lives in
    catalog.ts). Quantities for the same card are summed; unresolved lines are
    returned so the UI can report them; a lookup that THROWS (network/api
    failure) rejects the whole import rather than mislabeling cards as
    unmatched.

    Resolution tries the WHOLE remainder as a name first, and only strips a
    trailing set+number if that misses — otherwise "4 Iron Hands ex" (no set)
    would be misread as name "Iron" + set "Hands" + number "ex" and dropped.
    The stripped set+number then chooses among the name's prints
    (`choosePrint`), so "Dudunsparce PRE 80" is Prismatic Evolutions 80 and
    not the first Dudunsparce the catalog lists. Lookups are memoized by
    normalized name and warmed in parallel, so a 60-card list costs one round
    trip per unique name, not per line. */
export async function resolveDecklist(
  lines: DecklistLine[],
  findPrints: (name: string) => Promise<BuilderCard[]>,
  options: ResolveOptions = {},
): Promise<ImportResult> {
  const cache = new Map<string, Promise<BuilderCard[]>>();
  const lookup = (name: string): Promise<BuilderCard[]> => {
    const key = nameKey(name);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = findPrints(name);
    cache.set(key, pending);
    return pending;
  };

  // Warm the full-name lookups concurrently; the per-line pass below then
  // resolves from cache (stripped-name retries are the rare second wave).
  await Promise.all(lines.map((line) => lookup(line.name)));

  const merged = new Map<string, DeckEntry>();
  const unmatched: UnmatchedLine[] = [];

  for (const line of lines) {
    let prints = await lookup(line.name);
    let name = line.name;
    let print: PrintRef | undefined;
    if (prints.length === 0) {
      // Strip a trailing set+number and retry; keep the stripped form as the
      // reported name even when it still doesn't resolve.
      const split = splitPrint(line.name);
      if (split.print) {
        name = split.name;
        print = split.print;
        prints = await lookup(name);
      }
    }

    const wantedSetId =
      print && prints.length > 1 ? await options.setIdForCode?.(print.set) : undefined;
    const chosen = choosePrint(prints, print, wantedSetId);
    const card = chosen && preferArt(prints, chosen);
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
  const id = splitCardId(card.cardId);
  const set = id.set.toUpperCase();
  const number = card.number ?? id.number;
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
