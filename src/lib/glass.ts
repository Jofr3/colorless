// The app's APP-WIDE shared Tailwind class fragments. The "glass" paint family
// is the largest but not the only one — `FOCUS_RING`, `ERROR_TEXT` and the
// `CORNER_*` constants have never been glass, and D217 added three more
// non-glass families (see the bottom of this file). Each exported constant holds
// ONLY the classes common to every site that uses it; per-site layout (size,
// shape, position, padding) stays at the call site, composed via a template
// literal.
//
// WHAT BELONGS HERE. The unit of sharing is decided by the READ SITE. This
// module is imported by ~34 modules across seven features, so a string earns a
// place here only when its readers really are spread that wide. D214 kept the
// two-reader match-HUD row classes OUT of this file for exactly that reason
// (they live in `features/game/hudRows.ts`); D217's three additions have SEVEN,
// FIVE and THREE readers across five, three and three features respectively,
// with no narrower module containing them all.
//
// Constants are deliberately split where the originals genuinely differ — e.g.
// the HUD glass buttons use ring-white/9 while the page ghost buttons use
// ring-white/10, and the dialog ghost buttons use ring-white/12. Those are NOT
// standardised; merging them would be a visual change.
//
// Every constant that carries a `transition-*` also carries
// `motion-reduce:transition-none`, so a `prefers-reduced-motion: reduce` user
// gets an instant state change (no fade, and the active:scale snaps rather than
// animating) app-wide, from the constant rather than each call site. This is the
// root-cause version of the call-site guards P5-8/P5-9 added (see D90).

/** Standard focus-visible ring used by nearly every interactive control. */
export const FOCUS_RING =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** Inset focus-visible ring (negative offset) for controls whose ring must sit
    inside their bounds (overlay/inset buttons). */
export const FOCUS_RING_INSET =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50";

/** Glass paint for the playmat HUD buttons (ring-white/9, inset+drop shadow,
    blur, hover lift). Layout — flex/size/shape/position/padding — stays at the
    call site. The trailing focus ring is the standard FOCUS_RING. */
export const GLASS_HUD_BUTTON = `bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white/9 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.06] hover:text-white/85 active:scale-95 ${FOCUS_RING}`;

/** Page "ghost" pill button paint (ring-white/10, no shadow, hover to /90). */
export const GLASS_GHOST_BUTTON = `bg-white/[0.05] text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.08] hover:text-white/90 active:scale-95 ${FOCUS_RING}`;

/** Dialog "cancel/ghost" button paint (ring-white/12, no shadow/blur, hover to
    full white). Includes shape + padding + type since all members share them. */
export const GLASS_DIALOG_GHOST_BUTTON = `cursor-pointer rounded-full bg-white/[0.05] px-4 py-2 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/12 transition-all motion-reduce:transition-none hover:bg-white/[0.09] hover:text-white active:scale-95 ${FOCUS_RING}`;

/** Dialog inner panel surface (no width — the width class stays at the call
    site since it differs: 22rem vs 24rem). */
export const GLASS_DIALOG_PANEL =
  "rounded-3xl bg-[#16161f]/85 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/10 backdrop-blur-xl";

/** Accent icon tile (the rounded square that holds a feature icon on the
    Settings header and placeholder pages). Size (h-/w-) stays at the call site. */
export const GLASS_ICON_TILE =
  "flex items-center justify-center rounded-2xl bg-white/[0.05] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_30px_rgba(0,0,0,0.40)] ring-1 ring-inset ring-white/10";

/** Primary "accent" button paint — the inverse of the glass buttons: a light
    accent fill with dark text under a pure white ring. Layout (flex/size/shape/
    padding/gap) and any disabled: states stay at the call site. */
export const GLASS_ACCENT_BUTTON = `bg-accent/80 text-zinc-950 shadow-[0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-accent/90 active:scale-95 ${FOCUS_RING}`;

/** Neutral filled-glass button paint (a heavier fill/ring than GLASS_GHOST_BUTTON),
    used for secondary actions like "Join lobby" / "Cancel ready". Layout and
    disabled: states stay at the call site. */
export const GLASS_NEUTRAL_BUTTON = `bg-white/[0.06] text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.1] active:scale-95 ${FOCUS_RING}`;

/** Elevated glass panel surface (the raised card used for Settings sections, the
    lobby code card, and the online create/join panels). Radius + padding stay at
    the call site (rounded-2xl vs 3xl, p-5 vs p-6). */
export const GLASS_PANEL =
  "bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_30px_rgba(0,0,0,0.40)] ring-1 ring-inset ring-white/10 backdrop-blur-md";

/** Round filter-rail toggle beside a page's search field, sized to match the
    field's height (p-2.5 + a 20px glyph ≈ the input's py-2.5 + text-sm line).
    /decks and the builder share it byte-for-byte; the open/active vs idle
    paint (bg/text/ring tints) stays at the call sites. */
export const GLASS_FILTER_TOGGLE = `relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2.5 ring-1 ring-inset backdrop-blur-md transition-all motion-reduce:transition-none active:scale-95 ${FOCUS_RING}`;

/** Pill text-input paint (auth form fields, the decks/builder search bars).
    Padding and placeholder tint stay at the call site (the builder's search
    placeholder is deliberately lighter). The deck picker's in-dialog search
    keeps its own heavier fill (bg-white/[0.06], no blur) — not standardised. */
export const GLASS_INPUT =
  "w-full rounded-full bg-white/[0.045] text-sm text-white/90 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

/** The app's shared error red (deck legality warnings, auth/lobby form errors,
    rolled-back mutation notices). */
export const ERROR_TEXT = "text-[#ff8a9b]";

// ---- Bottom-right corner controls -------------------------------------------
// SettingsButton sits in the corner; AccountButton stacks directly above it.
// The two share position column (right-3) and the round glass shape, so they
// read as one column of matched controls.

/** Round 40px corner-control shape (paint comes from GLASS_HUD_BUTTON). */
export const CORNER_CONTROL_SHAPE =
  "flex h-10 w-10 cursor-pointer items-center justify-center rounded-full";

/** Fixed position of the bottom corner control (SettingsButton). */
export const CORNER_SETTINGS_POSITION = "fixed bottom-3 right-3 z-50";

/** Fixed position of the control stacked above it (AccountButton). */
export const CORNER_ACCOUNT_POSITION = "fixed bottom-[3.75rem] right-3 z-50";

// ---- Non-glass control paint (D217) -----------------------------------------
// Three families that were restated verbatim across the app. They carry no
// glass paint (no backdrop-blur, no inset shadow, no ring-white/N glass ring),
// which is why their names do not say GLASS — but their READ SITES are as wide
// as this module's audience, which is what decides the home. Each carries the
// D90 guard so the read sites do not.

/** The back/up arrow that slides left on hover, inside a `group` back
    affordance. SEVEN read sites: `components/PlaceholderPage`,
    `builder/DeckBuilder` (×2), `decks/Decks`, `online/DeckPickerDialog`,
    `online/MatchPlaceholder`, `settings/Settings` — byte-identical at all of
    them, so the size travels with the paint rather than staying at the call
    site. */
export const BACK_ARROW_ICON =
  "h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none";

/** The round ghost icon-button — a dialog/drawer close X or a pill's dismiss.
    Paint only: `flex`, the size (h-8 w-8 vs h-7 w-7), `shrink-0` and any
    `disabled:` states stay at the call site, since those are the only things
    its FIVE readers disagree about (`builder/CardDetailDialog`,
    `builder/CoverDialog`, `builder/ImportExportDialog`, `builder/DeckBuilder`,
    `components/TransientErrorPill`). */
export const GHOST_ICON_BUTTON = `cursor-pointer items-center justify-center rounded-full text-white/55 transition-colors motion-reduce:transition-none hover:bg-white/10 hover:text-white ${FOCUS_RING_INSET}`;

/** The solid-white primary action — the one "do this" button on a surface that
    is otherwise glass (a confirm dialog's confirm, the result panel's Rematch).
    Padding stays at the call site: the dialogs use px-4, the wider Rematch px-5.
    THREE readers: `online/ConfirmDialog`, `playmat/BackToMenu`,
    `online/OnlineMatch` — whose own comment already called it "the leave
    dialog's confirm styling", i.e. a copy. */
export const SOLID_PRIMARY_BUTTON = `cursor-pointer rounded-full bg-white text-sm font-semibold text-zinc-950 ring-1 ring-inset ring-white/40 transition-all motion-reduce:transition-none hover:bg-white/90 active:scale-95 ${FOCUS_RING}`;
