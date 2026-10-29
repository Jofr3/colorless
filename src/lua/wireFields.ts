/** The field order of every row the TypeScript adapters publish to Lua. Emitters encode through
 * `wireRow`, and `scripts/lua-constants.ts` gives Lua (`ui/wire_fields.lua`, 1-based) and host.js
 * (0-based) the same names, so no reader counts columns. A tagged row's tag is its first column. */

export type WireValue = string | number | boolean;

export interface RowKind {
  readonly tags?: readonly [string, ...string[]];
  readonly fields: readonly string[];
}

export type WireRecord<K extends RowKind> = { readonly [F in K["fields"][number]]: WireValue };

/** A kind with several tags must name the one; a single tag is implied. */
export type TagArg<K extends RowKind> = K["tags"] extends readonly [string, string, ...string[]]
  ? [tag: K["tags"][number]]
  : [];

export const WIRE_ROWS = {
  sim: {
    header: {
      fields: [
        "revision",
        "phase",
        "you",
        "opponent",
        "turn",
        "gamePhase",
        "message",
        "title",
        "hint",
        "turnIndex",
        "turnCount",
        "waitingOn",
        "activePlayer",
        "seat",
        "energyAttached",
        "supporterPlayed",
        "retreated",
        "outcome",
        "outcomeDetail",
        "shuffled",
        "matchId",
      ],
    },
    lifecycle: {
      tags: ["L"],
      fields: ["mode", "spectating", "awayName", "awayMs", "flags", "allow"],
    },
    rareCandy: { tags: ["R"], fields: ["uid"] },
    knockedOut: { tags: ["D"], fields: ["uid"] },
    side: {
      tags: ["S"],
      fields: ["owner", "deck", "prizes", "hand", "discard", "mulligans"],
    },
    card: {
      tags: ["C"],
      fields: [
        "uid",
        "cardId",
        "name",
        "owner",
        "zone",
        "index",
        "hidden",
        "category",
        "trainerType",
        "stage",
        "hp",
        "damage",
        "energies",
        "tools",
        "status",
        "types",
        "draggable",
        "displayIndex",
      ],
    },
    cardAction: {
      tags: ["K"],
      fields: [
        "token",
        "uid",
        "label",
        "colour",
        "disabled",
        "targetUid",
        "group",
        "cost",
        "damage",
        "hasCost",
      ],
    },
    sidebar: { tags: ["A"], fields: ["token", "label", "colour", "disabled", "slot"] },
    menu: {
      tags: ["M"],
      fields: [
        "kind",
        "title",
        "note",
        "mandatory",
        "id",
        "hideTargetOutline",
        "counterSourceUid",
        "counterTransfer",
      ],
    },
    /** `O` is a menu option, `F` a menu footer button. */
    option: {
      tags: ["O", "F"],
      fields: ["token", "label", "colour", "disabled", "selected", "cardId", "uid", "dimmed"],
    },
    info: {
      tags: ["I"],
      fields: [
        "cardId",
        "category",
        "trainerType",
        "stage",
        "hp",
        "types",
        "retreat",
        "weakness",
        "resistance",
        "effect",
        "abilities",
        "attacks",
        "energyType",
        "name",
      ],
    },
  },
  library: {
    header: {
      fields: [
        "revision",
        "phase",
        "busy",
        "message",
        "query",
        "sort",
        "page",
        "pages",
        "total",
        "result",
      ],
    },
    deck: { tags: ["D"], fields: ["id", "name", "count", "tint", "illegal"] },
  },
  builder: {
    header: {
      fields: [
        "revision",
        "phase",
        "name",
        "format",
        "saveStatus",
        "message",
        "busy",
        "page",
        "pages",
        "total",
        "count",
        "selected",
        "details",
        "transfer",
        "cover",
        "importing",
        "dirty",
        "retry",
      ],
    },
    /** `C` a catalog result, `D` a deck entry, `S` the selected card. */
    card: {
      tags: ["C", "D", "S"],
      fields: [
        "cardId",
        "name",
        "supertype",
        "subtype",
        "quantity",
        "remaining",
        "hp",
        "mark",
        "number",
        "copyLimit",
        "illegal",
        "gaps",
      ],
    },
    /** A deck entry whose card details are still on their way: no card fields, no controls. */
    pending: { tags: ["L"], fields: ["cardId", "name", "quantity"] },
    validation: { tags: ["V"], fields: ["message", "pokemon", "trainer", "energy"] },
    option: {
      tags: ["O"],
      fields: ["key", "label", "value", "count", "index", "selected"],
    },
    picker: { tags: ["P"], fields: ["key", "label", "page", "pages", "query"] },
    choice: { tags: ["Q"], fields: ["value", "label", "selected"] },
    field: { tags: ["F"], fields: ["key", "value"] },
  },
  online: {
    header: {
      fields: [
        "revision",
        "step",
        "busy",
        "message",
        "code",
        "role",
        "link",
        "countdown",
        "notice",
        "deckPhase",
        "name",
        "account",
        "canKick",
        "status",
      ],
    },
    /** One row per seat, `seat` being `you` or `opponent`. */
    seat: {
      tags: ["P"],
      fields: ["seat", "present", "name", "connected", "ready", "deckId", "deckName", "hasDeck"],
    },
    deck: {
      tags: ["D"],
      fields: ["id", "name", "count", "standard", "expanded", "online", "formatName"],
    },
  },
  sandbox: {
    header: { fields: ["revision", "phase", "busy", "message", "first", "second"] },
    deck: { tags: ["D"], fields: ["id", "name", "count"] },
  },
  account: {
    header: {
      fields: [
        "revision",
        "status",
        "busy",
        "message",
        "id",
        "displayName",
        "email",
        "hasPassword",
        "namePrompt",
      ],
    },
  },
} as const satisfies Record<string, Record<string, RowKind>>;

/** A row's columns in declared order, its tag first; a kind with several tags names the one. */
export function wireRow<K extends RowKind>(
  kind: K,
  record: WireRecord<K>,
  ...tag: TagArg<K>
): WireValue[] {
  const fields = record as Record<string, WireValue>;
  const values = kind.fields.map((name) => fields[name] as WireValue);
  const first = (tag as string[])[0] ?? kind.tags?.[0];
  return first === undefined ? values : [first, ...values];
}

/** A field's 0-based column in the encoded row. */
export function wireColumn<K extends RowKind>(kind: K, field: K["fields"][number]): number {
  return kind.fields.indexOf(field) + (kind.tags ? 1 : 0);
}
