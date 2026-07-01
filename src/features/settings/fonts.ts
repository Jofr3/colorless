// Single source of truth for the selectable UI fonts. The settings page reads
// this to build its dropdown; FontProvider applies the choice app-wide.
//
// NOTE: the Google Fonts stylesheet for these families is loaded once,
// statically, in index.html so the default font paints with no flash. If you
// add or remove a family here, update that <link> to match.

export type FontOption = {
  /** Stable key persisted to localStorage. */
  id: string;
  label: string;
  /** Google Fonts family name; "" means the native system stack. */
  family: string;
};

export const SYSTEM_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

// A spread of clean geometric sans + a few techy/sci-fi faces that suit a
// dark, glowing trading-card-game UI. Rajdhani is the default.
export const FONT_OPTIONS: FontOption[] = [
  { id: "rajdhani", label: "Rajdhani", family: "Rajdhani" },
  { id: "system", label: "System default", family: "" },
  { id: "inter", label: "Inter", family: "Inter" },
  { id: "manrope", label: "Manrope", family: "Manrope" },
  { id: "space-grotesk", label: "Space Grotesk", family: "Space Grotesk" },
  { id: "sora", label: "Sora", family: "Sora" },
  { id: "outfit", label: "Outfit", family: "Outfit" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans", family: "Plus Jakarta Sans" },
  { id: "lexend", label: "Lexend", family: "Lexend" },
  { id: "urbanist", label: "Urbanist", family: "Urbanist" },
  { id: "dm-sans", label: "DM Sans", family: "DM Sans" },
  { id: "chakra-petch", label: "Chakra Petch", family: "Chakra Petch" },
  { id: "exo-2", label: "Exo 2", family: "Exo 2" },
  { id: "orbitron", label: "Orbitron", family: "Orbitron" },
];

export const DEFAULT_FONT_ID = "rajdhani";
export const FONT_STORAGE_KEY = "luminous_ui.font";

/** The CSS font-family value for an option (system stack appended as fallback). */
export function fontFamilyValue(family: string): string {
  return family ? `"${family}", ${SYSTEM_STACK}` : SYSTEM_STACK;
}

/** Resolve an option id to a CSS font-family string, defaulting gracefully. */
export function fontFamilyFor(id: string): string {
  const option = FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0];
  return fontFamilyValue(option?.family ?? "");
}
