import type { RedactedCard } from "@colorless/schema";

/** A colour key of frontend/lua/ui/theme.lua; Lua falls back to blue for unknown keys. */
export type ThemeColour =
  | "red"
  | "blue"
  | "green"
  | "gold"
  | "orange"
  | "paleGreen"
  | "tray"
  | "profile"
  | "ink"
  | "panel"
  | "white"
  | "paper"
  | "jokerGrey"
  | "grey"
  | "textDark"
  | "money"
  | "paleGold"
  | "purple";
export interface SimOption {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** Visual de-emphasis without blocking selection replacement. */
  dimmed?: boolean;
  selected?: boolean;
  card?: RedactedCard;
  colour?: ThemeColour;
  /** Board/prize menus: the top-card uid or `prize:<index>` Lua highlights. */
  uid?: string;
  /** Grouped card count on a collapsed card tray option; absent or 1 for a single card. */
  count?: number;
  /** Sidebar placement: primary (blue, big), danger (red), minor. */
  slot?: "primary" | "danger" | "minor";
}
export type SimMenuKind =
  | "list"
  | "confirm"
  | "cards"
  | "board"
  | "prizes"
  | "coin"
  | "log"
  | "pile"
  | "attach";
/** A drag-to-attach prompt: the hand shows only `cards`, and dropping one on a Pokémon assigns it. */
export interface SimAttach {
  cards: readonly RedactedCard[];
  /** Assigned card uid → the target's top-card uid; these draw attached instead of in hand. */
  assigned: ReadonlyMap<string, string>;
  /** Assigns a card to the Pokémon whose top card is `targetUid`; returns why not, or "". */
  assign: (uid: string, targetUid: string) => string;
  /** Whether the rest of the hand shows beside the offered cards (the eye toggle). */
  showHand: boolean;
  toggleHand: () => void;
  /** A move: each offered card's current host (top-card uid); it is drawn there until moved. */
  from?: ReadonlyMap<string, string>;
}
/** Cards dropped on a Pokémon whose attach the engine has yet to finish (its card question). */
export interface StagedAttach {
  cards: readonly RedactedCard[];
  targetUid: string;
}
export interface SimMenu {
  kind: SimMenuKind;
  title: string;
  note?: string;
  header?: SimOption[];
  options: SimOption[];
  footer?: SimOption[];
  mandatory?: boolean;
  hideTargetOutline?: boolean;
  /** Selected Adrena-Brain source stays raised while choosing its destination. */
  counterSourceUid?: string;
  counterTransfer?: boolean;
  attach?: SimAttach;
}
/** An action attached to a card (Balatro's use/sell buttons). Targeted actions
 * share a `group` and name their `targetUid`; Lua collapses them into one
 * button that turns the table into a target picker. */
export interface SimCardAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  colour?: ThemeColour;
  targetUid?: string;
  group?: string;
  cost?: readonly string[];
  /** Printed damage, drawn at the right of an attack row. */
  damage?: string;
}
