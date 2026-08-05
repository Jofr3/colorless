import type { ReactNode } from "react";
import { GLASS_PANEL } from "../lib/glass";
import { SpinnerIcon } from "./icons";

// The app's shared "the page has no content yet" surfaces: a status panel
// (sign-in prompt, not-found, load failure) and a loading spinner. Shared by
// the deck builder, the decks page and the online deck picker so the states
// read identically everywhere — page-specific centring/sizing wrappers stay
// at the call sites.

/** Centred panel for a page's non-content states: icon, heading, supporting
    line, one action. The default "panel" variant is the glass card the full
    pages use; "dialog" is the quieter chrome-less rendering inside the deck
    picker (single message line, no heading). */
export function StatusPanel({
  icon,
  title,
  description,
  action,
  variant = "panel",
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "panel" | "dialog";
}) {
  if (variant === "dialog") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        {icon}
        <p className="text-sm font-medium text-white/40">{title}</p>
        {action}
      </div>
    );
  }
  return (
    <section
      className={`flex flex-col items-center gap-4 rounded-3xl p-8 text-center ${GLASS_PANEL}`}
    >
      {icon}
      <div>
        <h2 className="text-base font-semibold text-white/90">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </section>
  );
}

/** Quiet centred spinner for the loading states. <output> carries the
    implicit status role, and aria-busy + the label make it a named busy
    region — an aria-label hung on a role-less div reads as nothing to
    assistive tech. Layout stays at the call site. */
export function StatusSpinner({
  label,
  className = "flex justify-center",
}: {
  label: string;
  className?: string;
}) {
  return (
    <output aria-busy="true" aria-label={label} className={className}>
      <SpinnerIcon aria-hidden className="h-6 w-6 animate-spin text-white/30" />
    </output>
  );
}
