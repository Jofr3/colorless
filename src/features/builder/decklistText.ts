// Import/export of the plain-text decklist format every Pokémon TCG tool speaks
// (PTCG Live, Limitless, the official site): grouped "{qty} {Name} {SET} {num}"
// lines under "Pokémon:/Trainer:/Energy:" headers. Pure string<->Deck functions,
// tolerant on import (set/number optional, headers and totals ignored, matched
// by name against the pool) and canonical on export.

import { type BuilderCard, SUPERTYPES } from "./cards";
import type { Deck, DeckEntry } from "./deckMath";

/** A decklist line we couldn't resolve to a card in the pool. */
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
    decorative bits that drift between exporters removed. */
function nameKey(name: string): string {
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

/** Parse a text decklist, resolving each card line against `pool` by name.
    Quantities for the same card are summed; unresolved lines are returned so the
    UI can report them. Header lines ("Pokémon: 12", "Total Cards: 60") and any
    line not starting with a quantity are ignored.

    Resolution tries the WHOLE remainder as a name first, and only strips a
    trailing set+number if that misses — otherwise "4 Iron Hands ex" (no set)
    would be misread as name "Iron" + set "Hands" + number "ex" and dropped. */
export function parseDecklist(text: string, pool: BuilderCard[]): ImportResult {
  const byName = new Map<string, BuilderCard>();
  for (const card of pool) {
    const key = nameKey(card.name);
    if (!byName.has(key)) byName.set(key, card);
  }

  const merged = new Map<string, DeckEntry>();
  const unmatched: UnmatchedLine[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(QTY_RE);
    // Not "<n> …" — a header, total, comment or blank-ish line. Skip it.
    if (!m) continue;
    const quantity = Number.parseInt(m[1] ?? "", 10);
    const rest = (m[2] ?? "").trim();
    if (!Number.isFinite(quantity) || quantity <= 0 || !rest) continue;

    let card = byName.get(nameKey(rest));
    let name = rest;
    if (!card) {
      // Strip a trailing set+number and retry; keep the stripped form as the
      // reported name even when it still doesn't resolve.
      const stripped = TRAILING_SET_RE.exec(rest)?.[1]?.trim();
      if (stripped) {
        name = stripped;
        card = byName.get(nameKey(stripped));
      }
    }

    if (!card) {
      unmatched.push({ quantity, name, raw: line });
      continue;
    }
    const existing = merged.get(card.cardId);
    if (existing) existing.quantity += quantity;
    else merged.set(card.cardId, { card, quantity });
  }

  return { entries: [...merged.values()], unmatched };
}

/** Set code + collector number for a card, e.g. "SV8 125" — derived from the
    Scrydex id when explicit fields are missing. Used on export and as a subtle
    on-tile caption. */
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
