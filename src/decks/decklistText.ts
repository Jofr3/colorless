// Import and export of the plain-text decklist format (PTCG Live, Limitless): "{qty} {Name} {SET}
// {num}" lines under Pokémon/Trainer/Energy headers. Name resolution is injected, so this module
// stays pure.

import { MAX_DECK_CARD_ENTRIES } from "@colorless/schema";
import { type BuilderCard, isBasicEnergy, SUPERTYPES } from "./cards";
import type { Deck, DeckEntry } from "./deckMath";

/** The most card lines an import resolves: a list with more is refused before any lookup. A deck
    holds at most MAX_DECK_CARD_ENTRIES distinct cards, so a longer list could not be saved. */
export const MAX_DECKLIST_LINES = MAX_DECK_CARD_ENTRIES;
/** The longest card line looked up. The longest card name is about 40 characters, so a longer line
    is reported unknown without asking the catalog. */
export const MAX_DECKLIST_LINE_LENGTH = 120;
/** Name lookups in flight at once, for an import that asks the API per name. */
export const DECKLIST_LOOKUP_CONCURRENCY = 8;

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
  /** Set when the list had more than MAX_DECKLIST_LINES card lines and nothing was looked up. */
  tooManyLines?: true;
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
  /** A looser lookup, tried for a line only after the exact ones (its full name, then the name
      with a trailing set and number stripped) all miss. The catalog's is a substring search,
      which reads a large part of the table, so it must not run for every PTCG Live line whose
      set suffix makes the full-name lookup miss. */
  findLoosely?: (name: string) => Promise<BuilderCard[]>;
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
// A set token is short (2–7 chars: "PRE", "PR-SV", our export's "SV10.5B" or "30TH"), and a
// collector number is 1–4 letters or digits.
const SET_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{1,6}$/;
const NUMBER_TOKEN_RE = /^[A-Za-z0-9]{1,4}$/;

/** Peel a trailing "<SET> <NUM>" off a line's name; the head is what's left. Only applied when the
    FULL name fails to resolve, so a real ending like "… ex" / "Boss's Orders" isn't shaved off.
    It inspects the last two whitespace-separated tokens, linear in the name's length. */
export function splitPrint(name: string): { name: string; print?: PrintRef } {
  // Tokens at even positions, the whitespace between them at odd ones.
  const parts = name.trim().split(/(\s+)/);
  const set = parts[parts.length - 3];
  const number = parts[parts.length - 1];
  const head = parts.slice(0, -4).join("").trim();
  if (set === undefined || number === undefined || head === "") return { name };
  if (!SET_TOKEN_RE.test(set) || !NUMBER_TOKEN_RE.test(number)) return { name };
  return { name: head, print: { set, number } };
}

/** Collector numbers compare without leading zeros or case: "080" is "80". */
export function numberKey(number: string): string {
  return number.toUpperCase().replace(/^0+(?=.)/, "");
}

/** A tcgdex card id is "<set>-<number>"; set ids can carry hyphens ("30th-c"). */
export function splitCardId(cardId: string): { set: string; number: string } {
  const at = cardId.lastIndexOf("-");
  return at < 0
    ? { set: cardId, number: "" }
    : { set: cardId.slice(0, at), number: cardId.slice(at + 1) };
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

/** `find`, called once per normalized name. */
function memoByKey(
  find: (name: string) => Promise<BuilderCard[]>,
): (name: string) => Promise<BuilderCard[]> {
  const cache = new Map<string, Promise<BuilderCard[]>>();
  return (name) => {
    const key = nameKey(name);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = find(name);
    cache.set(key, pending);
    return pending;
  };
}

/** A semaphore: `run` calls its task once fewer than `max` tasks it started are unsettled. */
function concurrencyLimit(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    // A finishing task hands its slot straight to the next waiter, so `active` never passes max.
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** A line too long to be a card line, reported unknown without a lookup. */
const tooLong = (line: DecklistLine) => line.raw.length > MAX_DECKLIST_LINE_LENGTH;

/**
 * Resolve parsed lines to cards through `findPrints`. Quantities for the same card are summed and
 * unresolved lines are returned for the UI. A lookup that throws rejects the whole import rather
 * than marking cards unmatched. At most DECKLIST_LOOKUP_CONCURRENCY lookups run at once.
 */
export async function resolveDecklist(
  lines: DecklistLine[],
  findPrints: (name: string) => Promise<BuilderCard[]>,
  options: ResolveOptions = {},
): Promise<ImportResult> {
  const run = concurrencyLimit(DECKLIST_LOOKUP_CONCURRENCY);
  const lookup = memoByKey((name) => run(() => findPrints(name)));
  const { findLoosely } = options;
  const lookupLoosely = findLoosely && memoByKey((name) => run(() => findLoosely(name)));

  // Warm the full-name lookups concurrently, then the stripped-name retries of
  // the lines that missed (every line of a PTCG Live export, whose names end in
  // a set and number); the per-line pass below then resolves from cache.
  const lookedUp = lines.filter((line) => !tooLong(line));
  const full = await Promise.all(lookedUp.map((line) => lookup(line.name)));
  await Promise.all(
    lookedUp.flatMap((line, index) => {
      const split = full[index]?.length === 0 ? splitPrint(line.name) : undefined;
      return split?.print ? [lookup(split.name)] : [];
    }),
  );

  const merged = new Map<string, DeckEntry>();
  const unmatched: UnmatchedLine[] = [];

  for (const line of lines) {
    if (tooLong(line)) {
      unmatched.push({
        quantity: line.quantity,
        name: `${line.name.slice(0, 24)}...`,
        raw: line.raw,
      });
      continue;
    }
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
    if (prints.length === 0 && lookupLoosely) prints = await lookupLoosely(name);

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
