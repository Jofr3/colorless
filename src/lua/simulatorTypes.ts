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
  | "pile";
export interface SimMenu {
  kind: SimMenuKind;
  title: string;
  note?: string;
  options: SimOption[];
  footer?: SimOption[];
  mandatory?: boolean;
  hideTargetOutline?: boolean;
  /** Selected Adrena-Brain source stays raised while choosing its destination. */
  counterSourceUid?: string;
  counterTransfer?: boolean;
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
