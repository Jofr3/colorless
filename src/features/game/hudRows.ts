// The row-shaped buttons the two match HUDs share — `GameHud` (local hot seat)
// and `online/components/OnlineHud` (the redacted wire). Every string here was
// previously restated, byte for byte, in BOTH files: three as identically-named
// local constants and six more inline at the call sites.
//
// WHY THIS MODULE AND NOT `lib/glass.ts`. The unit of sharing is decided by the
// READ SITE, and these have exactly two: the two HUDs. `glass.ts` is imported by
// ~33 modules across seven features and its own header scopes it to "glass"
// paint (backdrop-blur + inset shadow + a ring-white/N glass ring); these rows
// carry none of that, so parking them there would widen their audience sixteen-
// fold and dilute that contract. `features/game` is already the cross-surface
// home for HUD presentation the online client reuses over its own data shape —
// `OnlineHud` imports `EnergyDots` from here for exactly that reason (the
// D62/D63 restate-per-surface choice is about the WIRE SHAPE, and a string of
// Tailwind classes has no wire shape to restate).
//
// THE D90 INVARIANT TRAVELS WITH THEM: every constant below that carries a
// `transition-*` also carries `motion-reduce:transition-none`, so a
// `prefers-reduced-motion: reduce` user gets an instant state change from the
// CONSTANT rather than from each call site. This is the same root-cause
// placement D90 chose for `glass.ts` (and it is why D89's call-site placement is
// not the precedent here). `index.css`'s global rule only neutralises `<body>`
// and `.route-view`; it never reaches a component Tailwind utility. Guard is
// inert unless the user has asked for reduced motion.

/** Shared row shape. `text-sm` is deliberately NOT here — the attack row sizes
    its own children (name and damage carry their own `text-sm`). */
const ROW_SHAPE =
  "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all motion-reduce:transition-none";

/** The attack rows in the turn:action panel. */
export const ATTACK_ROW_BASE = ROW_SHAPE;

/** The compact left-aligned row button — the Trainer / Ability / Stadium lists
    and the effect picker share it (the same look as the attack rows). */
export const ROW_BUTTON_BASE = `${ROW_SHAPE} text-sm`;

/** The single-line picker row (the discard-Energy chooser): no flex layout, so a
    long card name simply runs in flow. */
export const PICK_ROW_BASE =
  "w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all motion-reduce:transition-none";

/** The same picker row as a two-column flex row (name + damage) — the Bench
    choosers. */
export const PICK_ROW_SPLIT_BASE = `${PICK_ROW_BASE} flex items-center justify-between`;

/** The ENABLED paint every row above wears when it can be pressed — the four
    constants here are the interchangeable state half of the shape half. Not
    specific to any one picker: `PROMOTE_ROW` below pins it on permanently
    because ko:promote has no disabled state, and the rest swap between them. */
export const ROW_BUTTON_ENABLED =
  "cursor-pointer bg-white/[0.06] text-white/90 ring-white/15 hover:bg-white/[0.1] active:scale-[0.98]";
export const ROW_BUTTON_DISABLED = "cursor-default bg-white/[0.03] text-white/40 ring-white/8";
export const ROW_BUTTON_SELECTED = "bg-white/[0.12] text-white ring-white/40";
export const ROW_BUTTON_UNSELECTED =
  "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.08]";

/** ko:promote's Bench row: the split picker row, permanently in the enabled
    paint. (`cursor-pointer` appears in both halves; a repeated utility is
    inert.) */
export const PROMOTE_ROW = `${PICK_ROW_SPLIT_BASE} ${ROW_BUTTON_ENABLED}`;

/** The face-down prize tiles in the ko:takePrizes picker. Not a row — the one
    member of this family that isn't — but the same byte-identical duplication
    across both HUDs, and the same unguarded transition. */
export const PRIZE_CARD_BASE =
  "h-16 w-11 cursor-pointer rounded-md bg-gradient-to-br from-sky-800 to-indigo-950 ring-2 transition-all motion-reduce:transition-none";
export const PRIZE_CARD_PICKED = "ring-white/80 shadow-[0_0_14px_rgba(255,255,255,0.35)]";
export const PRIZE_CARD_IDLE = "ring-white/15 hover:ring-white/40";
